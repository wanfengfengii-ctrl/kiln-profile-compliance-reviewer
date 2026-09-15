"""热暴露复核的单元与 API 测试。

覆盖三类核心计算：
- 单段全程高于阈值；
- 阈值穿越并跨阶段（边界插值切开 + 穿越点再切分）；
- 结果恰等于上下限（判合格）；
以及多段非法窗口按阶段输入位置稳定返回全部明细。
"""
import json
from fractions import Fraction

import pytest
from fastapi.testclient import TestClient

from app.exposure import curve_points, display_str, review_exposures, stage_exposure
from app.main import app
from app.schemas import ExposureWindowIn, SampleIn, StageIn

client = TestClient(app)


def stage(start, end, min_temp="0", max_temp="10000", heat="1000", cool="1000"):
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


def window(min_exposure, max_exposure):
    return ExposureWindowIn(min_exposure=min_exposure, max_exposure=max_exposure)


# ---------- 计算：单段全程高于阈值 ----------


def test_single_stage_fully_above_threshold():
    stages = [stage(0, 3600, "15")]
    samples = [sample(0, "20"), sample(3600, "160")]
    points = curve_points(samples)
    # 超出量 5 -> 145 线性，面积 (5+145)/2*3600 = 270000 °C·s = 4500 °C·min
    value = stage_exposure(points, 0, 3600, stages[0].min_temp)
    assert value == Fraction(4500)


def test_curve_below_threshold_contributes_zero():
    stages = [stage(0, 100, "50")]
    samples = [sample(0, "10"), sample(100, "40")]
    points = curve_points(samples)
    assert stage_exposure(points, 0, 100, stages[0].min_temp) == Fraction(0)


# ---------- 计算：阈值穿越并跨阶段 ----------

CROSS_STAGES = [stage(0, 100, "10"), stage(100, 200, "50")]
CROSS_SAMPLES = [sample(0, "0"), sample(150, "300"), sample(200, "100")]


def test_threshold_crossing_and_cross_stage_segment():
    points = curve_points(CROSS_SAMPLES)
    # 阶段1 [0,100) min=10：线段 0->150 跨阶段，在边界 t=100 插值 T=200 切开；
    # 超出量 -10 -> 190，t=5 处穿越阈值再切分，只累计 [5,100]：
    # (0+190)/2*95 = 9025 °C·s
    assert stage_exposure(points, 0, 100, CROSS_STAGES[0].min_temp) == Fraction(9025, 60)
    # 阶段2 [100,200] min=50：边界插值 T(100)=200，全程高于阈值：
    # (150+250)/2*50 + (250+50)/2*50 = 17500 °C·s
    assert stage_exposure(points, 100, 200, CROSS_STAGES[1].min_temp) == Fraction(17500, 60)


def test_crossing_exactly_at_sample_point():
    # 采样点恰在阈值上：无需切分，结果不变
    stages = [stage(0, 100, "10")]
    samples = [sample(0, "0"), sample(50, "10"), sample(100, "20")]
    points = curve_points(samples)
    # [0,50] 不超阈值；[50,100] 超出量 0->10：(0+10)/2*50 = 250 °C·s
    assert stage_exposure(points, 0, 100, stages[0].min_temp) == Fraction(250, 60)


def test_fraction_and_display_format():
    results = review_exposures(
        CROSS_STAGES, CROSS_SAMPLES, [window("0", "100000"), window("0", "100000")]
    )
    assert results[0]["exposure"] == "1805/12"  # 9025/60 约分
    assert results[0]["exposure_display"] == "150.416667"
    assert results[1]["exposure"] == "875/3"
    assert results[1]["exposure_display"] == "291.666667"


def test_display_rounds_half_up_to_six_places():
    # 0.1234565 °C·min 第七位恰为 5：四舍五入得 0.123457
    assert display_str(Fraction(246913, 2000000)) == "0.123457"
    assert display_str(Fraction(0)) == "0.000000"
    assert display_str(Fraction(4500)) == "4500.000000"


def test_huge_integer_seconds_exact():
    big1 = 9007199254740993  # 2**53 + 1，浮点无法精确表示
    big2 = 90071992547409930
    stages = [stage(0, big1, "0"), stage(big1, big2, "0")]
    samples = [sample(0, "1"), sample(big1, "1"), sample(big2, "2")]
    points = curve_points(samples)
    # 阶段1 恒温 1、超出量恒为 1：面积 1 * big1 °C·s，精确不丢
    assert stage_exposure(points, 0, big1, stages[0].min_temp) == Fraction(big1, 60)


# ---------- 状态：恰等于上下限判合格 ----------


def test_equal_to_bounds_is_ok():
    stages = [stage(0, 3600, "15")]
    samples = [sample(0, "20"), sample(3600, "160")]
    # 精确值 4500：等于下限、等于上限、上下限相等均判合格
    for lo, hi in [("4500", "4500"), ("4500", "5000"), ("4000", "4500")]:
        results = review_exposures(stages, samples, [window(lo, hi)])
        assert results[0]["status"] == "合格"
        assert results[0]["exposure"] == "4500/1"
        assert results[0]["exposure_display"] == "4500.000000"
    # 精确比较：窗口略偏即不足/过量，不受展示值舍入影响
    assert (
        review_exposures(stages, samples, [window("4500.000001", "99999")])[0]["status"]
        == "不足"
    )
    assert (
        review_exposures(stages, samples, [window("0", "4499.999999")])[0]["status"]
        == "过量"
    )


# ---------- API ----------

BASE = {
    "stages": [
        {"start": 0, "end": 3600, "min_temp": "15", "max_temp": "260",
         "max_heat_rate": "4.0", "max_cool_rate": "2.0"},
        {"start": 3600, "end": 10800, "min_temp": "250", "max_temp": "950",
         "max_heat_rate": "5.0", "max_cool_rate": "2.0"},
        {"start": 10800, "end": 12600, "min_temp": "850", "max_temp": "950",
         "max_heat_rate": "1.0", "max_cool_rate": "1.0"},
    ],
    "samples": [
        {"time": 0, "temp": "20"}, {"time": 1200, "temp": "100"},
        {"time": 2400, "temp": "180"}, {"time": 3600, "temp": "260"},
        {"time": 4800, "temp": "360"}, {"time": 6000, "temp": "460"},
        {"time": 7200, "temp": "560"}, {"time": 8400, "temp": "660"},
        {"time": 9600, "temp": "760"}, {"time": 10800, "temp": "860"},
        {"time": 11400, "temp": "870"}, {"time": 12600, "temp": "880"},
    ],
    # 默认曲线各段精确热暴露：7500、37200、650 °C·min
    "exposure": [
        {"min_exposure": "7500", "max_exposure": "7500"},
        {"min_exposure": "37200", "max_exposure": "37200"},
        {"min_exposure": "650", "max_exposure": "650"},
    ],
}


def fresh_body():
    return json.loads(json.dumps(BASE))


def post(body):
    return client.post("/api/exposure", json=body)


def test_exposure_equal_bounds_ok_in_stage_order():
    resp = post(BASE)
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert [r["stage_index"] for r in results] == [0, 1, 2]
    assert [r["status"] for r in results] == ["合格", "合格", "合格"]
    assert [r["exposure"] for r in results] == ["7500/1", "37200/1", "650/1"]
    assert [r["exposure_display"] for r in results] == [
        "7500.000000",
        "37200.000000",
        "650.000000",
    ]
    assert results[0]["min_exposure"] == "7500"
    assert results[0]["max_exposure"] == "7500"


def test_exposure_statuses_below_ok_above():
    body = fresh_body()
    body["exposure"] = [
        {"min_exposure": "8000", "max_exposure": "9000"},    # 7500 < 8000 -> 不足
        {"min_exposure": "37200", "max_exposure": "37200"},  # 恰等于 -> 合格
        {"min_exposure": "100", "max_exposure": "600"},      # 650 > 600 -> 过量
    ]
    resp = post(body)
    assert resp.status_code == 200
    assert [r["status"] for r in resp.json()["results"]] == ["不足", "合格", "过量"]


def test_exposure_crossing_and_cross_stage_via_api():
    body = {
        "stages": [
            {"start": 0, "end": 100, "min_temp": "10", "max_temp": "1000",
             "max_heat_rate": "1000", "max_cool_rate": "1000"},
            {"start": 100, "end": 200, "min_temp": "50", "max_temp": "1000",
             "max_heat_rate": "1000", "max_cool_rate": "1000"},
        ],
        "samples": [{"time": 0, "temp": "0"}, {"time": 150, "temp": "300"},
                    {"time": 200, "temp": "100"}],
        "exposure": [
            {"min_exposure": "150.416666", "max_exposure": "150.416667"},
            {"min_exposure": "291.666666", "max_exposure": "291.666667"},
        ],
    }
    resp = post(body)
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert results[0]["exposure"] == "1805/12"
    assert results[0]["exposure_display"] == "150.416667"
    assert results[0]["status"] == "合格"
    assert results[1]["exposure"] == "875/3"
    assert results[1]["exposure_display"] == "291.666667"
    assert results[1]["status"] == "合格"


def test_multiple_invalid_windows_report_all_details_in_stage_order():
    body = fresh_body()
    body["exposure"][0] = {"min_exposure": "-1", "max_exposure": "10"}  # 负数
    body["exposure"][2] = {"min_exposure": "9", "max_exposure": "1"}    # 下限高于上限
    resp = post(body)
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    locs = [tuple(item["loc"]) for item in detail]
    assert ("body", "exposure", 0, "min_exposure") in locs
    assert ("body", "exposure", 2) in locs
    # 全部明细按阶段输入位置稳定排序
    positions = [loc[2] for loc in locs if loc[:2] == ("body", "exposure")]
    assert positions == sorted(positions)
    assert positions == [0, 2]


@pytest.mark.parametrize(
    "mutate",
    [
        # 暴露上下限：负数、非数字、非有限、布尔、下限高于上限
        lambda b: b["exposure"][0].update(min_exposure="-0.1"),
        lambda b: b["exposure"][1].update(max_exposure="-3"),
        lambda b: b["exposure"][0].update(min_exposure="abc"),
        lambda b: b["exposure"][0].update(min_exposure="NaN"),
        lambda b: b["exposure"][2].update(max_exposure="Infinity"),
        lambda b: b["exposure"][0].update(min_exposure=True),
        lambda b: b["exposure"][1].update(min_exposure="40000", max_exposure="30000"),
        # 窗口数量与阶段数不一致
        lambda b: b.update(exposure=b["exposure"][:2]),
        lambda b: b.update(exposure=[]),
        # 阶段与采样沿用 /api/adjudicate 的校验
        lambda b: b["stages"][0].update(end=0),
        lambda b: b["samples"][1].update(time=0),
    ],
)
def test_invalid_exposure_input_rejected(mutate):
    body = fresh_body()
    mutate(body)
    resp = post(body)
    assert resp.status_code == 422
    assert resp.json()["detail"]


def test_exposure_zero_window_and_zero_exposure_ok():
    body = {
        "stages": [{"start": 0, "end": 100, "min_temp": "50", "max_temp": "100",
                    "max_heat_rate": "10", "max_cool_rate": "10"}],
        "samples": [{"time": 0, "temp": "10"}, {"time": 100, "temp": "40"}],
        "exposure": [{"min_exposure": "0", "max_exposure": "0"}],
    }
    resp = post(body)
    assert resp.status_code == 200
    [r] = resp.json()["results"]
    assert r["exposure"] == "0/1"
    assert r["exposure_display"] == "0.000000"
    assert r["status"] == "合格"
