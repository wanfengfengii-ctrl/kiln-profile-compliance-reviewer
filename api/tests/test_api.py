"""API 层面的集成测试：合法输入裁决、非法输入一律 422 拒绝。"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

VALID_BODY = {
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
}


def post(body):
    return client.post("/api/adjudicate", json=body)


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_valid_release_and_echo():
    resp = post(VALID_BODY)
    assert resp.status_code == 200
    data = resp.json()
    assert data["conclusion"] == "放行"
    assert data["violations"] == []
    # 折线、结论、下载 JSON 取自同次响应：响应内回传裁决所用数据
    assert data["stages"][0]["start"] == 0
    assert data["stages"][1]["max_temp"] == "950"
    assert data["samples"][-1] == {"time": 12600, "temp": "880"}
    assert len(data["samples"]) == 12


def test_refire_with_ordered_violations():
    body = {
        "stages": [dict(s) for s in VALID_BODY["stages"]],
        "samples": [dict(s) for s in VALID_BODY["samples"]],
    }
    body["samples"][1]["temp"] = "500"  # 1200s 超上限并引发升降温速率违规
    resp = post(body)
    assert resp.status_code == 200
    data = resp.json()
    assert data["conclusion"] == "返烧"
    violations = data["violations"]
    assert [v["type"] for v in violations] == ["temperature", "rate", "rate"]
    temp_v = violations[0]
    assert temp_v["time"] == 1200 and temp_v["temperature"] == "500"
    assert temp_v["min_temp"] == "15" and temp_v["max_temp"] == "260"
    heat_v, cool_v = violations[1], violations[2]
    assert (heat_v["start_time"], heat_v["end_time"]) == (0, 1200)
    assert heat_v["direction"] == "heating"
    assert heat_v["measured"] == "24" and heat_v["limit"] == "4.0"
    assert (cool_v["start_time"], cool_v["end_time"]) == (1200, 2400)
    assert cool_v["direction"] == "cooling"
    assert cool_v["measured"] == "16" and cool_v["limit"] == "2.0"


def test_numeric_temperatures_accepted():
    body = {
        "stages": [{"start": 0, "end": 60, "min_temp": -50.5, "max_temp": 100,
                    "max_heat_rate": 100, "max_cool_rate": 100}],
        "samples": [{"time": 0, "temp": -20.25}, {"time": 60, "temp": 30}],
    }
    resp = post(body)
    assert resp.status_code == 200
    assert resp.json()["conclusion"] == "放行"
    assert resp.json()["samples"][0]["temp"] == "-20.25"


@pytest.mark.parametrize(
    "mutate",
    [
        # 阶段时间：非整数、负数、start>=end
        lambda b: b["stages"][0].update(start=1.5),
        lambda b: b["stages"][0].update(start=-1),
        lambda b: b["stages"][0].update(start=True),
        lambda b: b["stages"][0].update(start="0"),
        lambda b: b["stages"][0].update(end=0),
        # 阶段不首尾相接
        lambda b: b["stages"][1].update(start=3599),
        # 温度非法：非有限、非数字、min>max
        lambda b: b["stages"][0].update(min_temp="abc"),
        lambda b: b["stages"][0].update(min_temp="NaN"),
        lambda b: b["stages"][0].update(max_temp="Infinity"),
        lambda b: b["stages"][0].update(min_temp=True),
        lambda b: b["stages"][0].update(min_temp="200", max_temp="100"),
        # 速率非法：负数、非有限
        lambda b: b["stages"][0].update(max_heat_rate="-0.1"),
        lambda b: b["stages"][0].update(max_cool_rate="-Infinity"),
        # 采样时间：非整数、负数、不严格递增、越界、不覆盖首末端点
        lambda b: b["samples"][1].update(time=1200.5),
        lambda b: b["samples"][1].update(time=-3),
        lambda b: b["samples"][1].update(time=0),
        lambda b: b["samples"][1].update(time=12601),
        lambda b: b["samples"][0].update(time=1),
        lambda b: b["samples"][-1].update(time=12599),
        # 采样温度非法
        lambda b: b["samples"][0].update(temp="hot"),
        lambda b: b["samples"][0].update(temp="NaN"),
        lambda b: b["samples"][0].update(temp=None),
        # 结构非法：空阶段、采样不足
        lambda b: b.update(stages=[]),
        lambda b: b.update(samples=[{"time": 0, "temp": "20"}]),
    ],
)
def test_invalid_input_rejected(mutate):
    body = {
        "stages": [dict(s) for s in VALID_BODY["stages"]],
        "samples": [dict(s) for s in VALID_BODY["samples"]],
    }
    mutate(body)
    resp = post(body)
    assert resp.status_code == 422
    assert resp.json()["detail"]  # 返回可读的错误定位信息


def test_missing_fields_rejected():
    resp = post({"stages": VALID_BODY["stages"]})
    assert resp.status_code == 422
    resp = post({})
    assert resp.status_code == 422
