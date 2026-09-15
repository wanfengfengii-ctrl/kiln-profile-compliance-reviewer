"""裁决逻辑的单元测试（pytest）。"""
import pytest

from app.adjudicate import adjudicate, stage_index_for_time
from app.schemas import SampleIn, StageIn


def stage(start, end, min_temp="0", max_temp="1000", heat="5.0", cool="5.0"):
    return StageIn(
        start=start,
        end=end,
        min_temp=min_temp,
        max_temp=max_temp,
        max_heat_rate=heat,
        max_cool_rate=cool,
    )


def sample(time, temp):
    return SampleIn(time=time, temp=temp)


def test_compliant_curve_release():
    stages = [stage(0, 100, "10", "50", "2.0", "2.0")]
    samples = [sample(0, "20"), sample(50, "21"), sample(100, "22")]
    result = adjudicate(stages, samples)
    assert result["conclusion"] == "放行"
    assert result["violations"] == []


def test_temperature_violation_above_and_below():
    stages = [stage(0, 100, "10", "50")]
    samples = [sample(0, "9.9"), sample(50, "30"), sample(100, "50.1")]
    result = adjudicate(stages, samples)
    assert result["conclusion"] == "返烧"
    temps = [v for v in result["violations"] if v["type"] == "temperature"]
    assert [v["time"] for v in temps] == [0, 100]
    assert temps[0]["temperature"] == "9.9"
    assert temps[0]["min_temp"] == "10"
    assert temps[0]["max_temp"] == "50"


def test_temperature_bounds_inclusive():
    stages = [stage(0, 100, "10", "50", heat="100", cool="100")]
    samples = [sample(0, "10"), sample(50, "50"), sample(100, "10")]
    result = adjudicate(stages, samples)
    assert result["conclusion"] == "放行"


def test_negative_temperatures_allowed():
    stages = [stage(0, 60, "-50", "-10", "3.0", "3.0")]
    samples = [sample(0, "-20.5"), sample(60, "-18")]
    assert adjudicate(stages, samples)["conclusion"] == "放行"
    bad = [sample(0, "-60"), sample(60, "-15")]
    result = adjudicate(stages, bad)
    assert result["conclusion"] == "返烧"
    assert result["violations"][0]["temperature"] == "-60"


def test_heating_rate_violation():
    stages = [stage(0, 100, "0", "1000", heat="5.0")]
    samples = [sample(0, "0"), sample(10, "20"), sample(100, "25")]
    result = adjudicate(stages, samples)
    assert result["conclusion"] == "返烧"
    rates = [v for v in result["violations"] if v["type"] == "rate"]
    assert len(rates) == 1
    v = rates[0]
    assert v["start_time"] == 0 and v["end_time"] == 10
    assert v["direction"] == "heating"
    assert v["measured"] == "120"  # 20 * 60 / 10
    assert v["limit"] == "5.0"


def test_cooling_rate_violation():
    stages = [stage(0, 100, "0", "1000", cool="2.5")]
    samples = [sample(0, "100"), sample(30, "90"), sample(100, "89")]
    result = adjudicate(stages, samples)
    rates = [v for v in result["violations"] if v["type"] == "rate"]
    assert len(rates) == 1
    assert rates[0]["direction"] == "cooling"
    assert rates[0]["measured"] == "20"  # 10 * 60 / 30
    assert rates[0]["limit"] == "2.5"


def test_rate_equal_limit_compliant():
    stages = [stage(0, 120, "0", "1000", heat="4.0", cool="2.0")]
    samples = [sample(0, "20"), sample(60, "24"), sample(120, "22")]
    # 升温 4*60/60 = 4.0，降温 2*60/60 = 2.0，均等于限制 -> 合规
    assert adjudicate(stages, samples)["conclusion"] == "放行"


def test_cross_stage_rate_not_checked():
    stages = [
        stage(0, 10, "0", "2000", heat="1.0", cool="1.0"),
        stage(10, 20, "0", "2000", heat="1.0", cool="1.0"),
    ]
    # 9 -> 10 跨阶段，即使速率巨大也不检查
    samples = [sample(0, "0"), sample(9, "0"), sample(10, "1000"), sample(20, "1000")]
    result = adjudicate(stages, samples)
    assert result["conclusion"] == "放行"


def test_stage_membership_half_open_interval():
    stages = [
        stage(0, 10, "0", "100", heat="1000", cool="1000"),
        stage(10, 20, "300", "600", heat="1000", cool="1000"),
    ]
    # 边界时刻 10 属于第二阶段 [10,20)，末阶段包含 end=20
    assert stage_index_for_time(10, stages) == 1
    assert stage_index_for_time(20, stages) == 1
    assert stage_index_for_time(9, stages) == 0
    samples = [sample(0, "50"), sample(10, "400"), sample(20, "500")]
    assert adjudicate(stages, samples)["conclusion"] == "放行"


def test_last_stage_end_inclusive_temperature():
    stages = [
        stage(0, 10, "0", "1000"),
        stage(10, 20, "500", "600"),
    ]
    # end=20 仅末阶段包含，温度按末阶段上下限判定
    samples = [sample(0, "10"), sample(20, "550")]
    assert adjudicate(stages, samples)["conclusion"] == "放行"


def test_violation_ordering_temperature_then_rate():
    stages = [stage(0, 10000, "0", "1000", heat="1.0", cool="1000")]
    samples = [
        sample(0, "0"),
        sample(1200, "100"),   # 升温速率 5.0 > 1.0（后一端点 1200）
        sample(5000, "2000"),  # 温度超上限，且升温速率仍超限（后一端点 5000）
        sample(10000, "900"),
    ]
    result = adjudicate(stages, samples)
    types = [v["type"] for v in result["violations"]]
    assert types == ["temperature", "rate", "rate"]
    rate_ends = [v["end_time"] for v in result["violations"] if v["type"] == "rate"]
    assert rate_ends == sorted(rate_ends)


def test_temperature_violations_sorted_by_time():
    stages = [stage(0, 100, "0", "10")]
    samples = [sample(0, "50"), sample(40, "99"), sample(100, "5")]
    result = adjudicate(stages, samples)
    times = [v["time"] for v in result["violations"] if v["type"] == "temperature"]
    assert times == [0, 40]


def test_decimal_precision_exact_division():
    stages = [stage(0, 10, "-100", "100", heat="2.0")]
    # 温差 0.1，秒差 3 -> 速率恰为 2.0，等于限制合规
    samples = [sample(0, "0.1"), sample(3, "0.2"), sample(10, "0.2")]
    assert adjudicate(stages, samples)["conclusion"] == "放行"
    # 限制略低则违规，实测值保持十进制精确
    stages2 = [stage(0, 10, "-100", "100", heat="1.9999999999999999999")]
    result = adjudicate(stages2, samples)
    rates = [v for v in result["violations"] if v["type"] == "rate"]
    assert rates[0]["measured"] == "2.0"


def test_decimal_precision_repeating_division():
    # 60/7 = 8.571428571428571428571428571（28 位十进制精度）
    stages = [stage(0, 10, "0", "100", heat="8.571428571428571428571428571")]
    samples = [sample(0, "0"), sample(7, "1"), sample(10, "1")]
    assert adjudicate(stages, samples)["conclusion"] == "放行"
    stages2 = [stage(0, 10, "0", "100", heat="8.5")]
    result = adjudicate(stages2, samples)
    rates = [v for v in result["violations"] if v["type"] == "rate"]
    assert rates[0]["measured"] == "8.571428571428571428571428571"
    assert rates[0]["limit"] == "8.5"


def test_zero_rate_never_violates():
    stages = [stage(0, 10, "0", "100", heat="0", cool="0")]
    samples = [sample(0, "50"), sample(10, "50")]
    assert adjudicate(stages, samples)["conclusion"] == "放行"


def test_rate_violation_fields_complete():
    stages = [stage(0, 100, "0", "1000", heat="1.0")]
    samples = [sample(0, "0"), sample(100, "100")]
    result = adjudicate(stages, samples)
    v = result["violations"][0]
    assert set(v) == {
        "type",
        "start_time",
        "end_time",
        "direction",
        "measured",
        "limit",
        "stage_index",
    }
