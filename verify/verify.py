#!/usr/bin/env python3
"""一次性验收服务：对运行中的 Web/API 做真实 HTTP 检查。

通过 docker compose 以一次性容器运行（见 README）：
    docker compose --profile verify run --rm verify

全部检查通过退出码为 0，否则为 1。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

WEB_URL = os.environ.get("WEB_URL", "http://web").rstrip("/")
API_URL = os.environ.get("API_URL", "http://api:8000").rstrip("/")
READY_TIMEOUT = float(os.environ.get("READY_TIMEOUT", "90"))

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


def violating_body():
    body = json.loads(json.dumps(VALID_BODY))
    body["samples"][1]["temp"] = "500"
    return body


def invalid_body():
    body = json.loads(json.dumps(VALID_BODY))
    body["stages"][0]["end"] = 0  # start >= end
    return body


def http(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, None


def get_text(url):
    with urllib.request.urlopen(url, timeout=10) as resp:
        return resp.status, resp.read().decode()


def wait_ready():
    deadline = time.time() + READY_TIMEOUT
    while time.time() < deadline:
        try:
            api_ok = http("GET", f"{API_URL}/api/health")[0] == 200
            web_ok = get_text(f"{WEB_URL}/")[0] == 200
            if api_ok and web_ok:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


CHECKS = []


def check(name):
    def deco(fn):
        CHECKS.append((name, fn))
        return fn
    return deco


@check("API 健康检查")
def check_api_health():
    status, body = http("GET", f"{API_URL}/api/health")
    assert status == 200 and body == {"status": "ok"}, f"got {status} {body}"


@check("Web 提供复核台页面")
def check_web_page():
    status, html = get_text(f"{WEB_URL}/")
    assert status == 200 and 'id="root"' in html, "首页缺少挂载点"


@check("经 Web 代理复核合规曲线 -> 放行，且响应回传折线数据")
def check_release_via_web():
    status, body = http("POST", f"{WEB_URL}/api/adjudicate", VALID_BODY)
    assert status == 200, f"got {status}: {body}"
    assert body["conclusion"] == "放行", body
    assert body["violations"] == [], body
    assert len(body["samples"]) == 12 and len(body["stages"]) == 3
    # 整数秒以十进制字符串精确回传
    assert body["samples"][-1] == {"time": "12600", "temp": "880"}


@check("违规曲线 -> 返烧，温度违规在前、速率违规在后且字段完整")
def check_refire_via_web():
    status, body = http("POST", f"{WEB_URL}/api/adjudicate", violating_body())
    assert status == 200, f"got {status}: {body}"
    assert body["conclusion"] == "返烧", body
    violations = body["violations"]
    assert [v["type"] for v in violations] == ["temperature", "rate", "rate"], violations
    temp_v = violations[0]
    assert temp_v["time"] == "1200" and temp_v["temperature"] == "500", temp_v
    heat_v, cool_v = violations[1], violations[2]
    assert (heat_v["start_time"], heat_v["end_time"]) == ("0", "1200"), heat_v
    assert heat_v["measured"] == "24" and heat_v["limit"] == "4.0", heat_v
    assert (cool_v["start_time"], cool_v["end_time"]) == ("1200", "2400"), cool_v
    assert cool_v["measured"] == "16" and cool_v["limit"] == "2.0", cool_v


@check("非法输入被拒绝（4xx），不产生裁决结果")
def check_invalid_rejected():
    status, body = http("POST", f"{WEB_URL}/api/adjudicate", invalid_body())
    assert status in (400, 422), f"got {status}: {body}"
    assert body and "detail" in body, body
    assert "conclusion" not in (body or {}), body


@check("API 直连复核同样可用")
def check_api_direct():
    status, body = http("POST", f"{API_URL}/api/adjudicate", VALID_BODY)
    assert status == 200 and body["conclusion"] == "放行", f"got {status}: {body}"


@check("速率贴近 60/7 时按有理数精确判定（1°C/7s 超限不得误判放行）")
def check_rate_near_60_over_7():
    body = {
        "stages": [{"start": 0, "end": 10, "min_temp": "0", "max_temp": "100",
                    "max_heat_rate": "8.5714285714285714285714285714",
                    "max_cool_rate": "100"}],
        "samples": [{"time": 0, "temp": "0"}, {"time": 7, "temp": "1"},
                    {"time": 10, "temp": "1"}],
    }
    status, resp = http("POST", f"{WEB_URL}/api/adjudicate", body)
    assert status == 200, f"got {status}: {resp}"
    assert resp["conclusion"] == "返烧", resp
    rates = [v for v in resp["violations"] if v["type"] == "rate"]
    assert len(rates) == 1, resp
    assert rates[0]["measured"] == "8.5714285714285714285714285714285714285714285714286"
    assert rates[0]["limit"] == "8.5714285714285714285714285714"
    # 限制略高于真值 -> 放行
    body["stages"][0]["max_heat_rate"] = "8.5714285714285714285714285715"
    status, resp = http("POST", f"{WEB_URL}/api/adjudicate", body)
    assert status == 200 and resp["conclusion"] == "放行", f"got {status}: {resp}"


@check("超出安全整数范围的秒数精确传输与裁决")
def check_huge_integer_seconds():
    big1 = 9007199254740993   # 2**53 + 1，浮点无法精确表示
    big2 = 90071992547409930
    body = {
        "stages": [
            {"start": 0, "end": big1, "min_temp": "15", "max_temp": "260",
             "max_heat_rate": "5.0", "max_cool_rate": "5.0"},
            {"start": str(big1), "end": str(big2), "min_temp": "250", "max_temp": "950",
             "max_heat_rate": "5.0", "max_cool_rate": "5.0"},
        ],
        "samples": [
            {"time": 0, "temp": "20"},
            {"time": str(big1), "temp": "260"},
            {"time": big2, "temp": "270"},
        ],
    }
    status, resp = http("POST", f"{WEB_URL}/api/adjudicate", body)
    assert status == 200, f"got {status}: {resp}"
    assert resp["conclusion"] == "放行", resp
    assert resp["stages"][0]["end"] == "9007199254740993", resp
    assert resp["stages"][1]["start"] == "9007199254740993", resp
    assert resp["samples"][1]["time"] == "9007199254740993", resp
    assert resp["samples"][2]["time"] == "90071992547409930", resp


@check("热暴露：单段全程高于阈值，梯形面积精确累计")
def check_exposure_single_stage_above_threshold():
    body = {
        "stages": [{"start": 0, "end": 3600, "min_temp": "15", "max_temp": "260",
                    "max_heat_rate": "4.0", "max_cool_rate": "2.0"}],
        "samples": [{"time": 0, "temp": "20"}, {"time": 3600, "temp": "160"}],
        # 超出量 5 -> 145 线性：(5+145)/2*3600 = 270000 °C·s = 4500 °C·min
        "exposure": [{"min_exposure": "4500", "max_exposure": "4500"}],
    }
    status, resp = http("POST", f"{WEB_URL}/api/exposure", body)
    assert status == 200, f"got {status}: {resp}"
    [r] = resp["results"]
    assert r["stage_index"] == 0, r
    assert r["exposure"] == "4500/1", r
    assert r["exposure_display"] == "4500.000000", r
    assert r["status"] == "合格", r  # 恰等于上下限判合格


@check("热暴露：阈值穿越并跨阶段，边界插值切开后按精确分数返回")
def check_exposure_crossing_and_cross_stage():
    body = {
        "stages": [
            {"start": 0, "end": 100, "min_temp": "10", "max_temp": "1000",
             "max_heat_rate": "1000", "max_cool_rate": "1000"},
            {"start": 100, "end": 200, "min_temp": "50", "max_temp": "1000",
             "max_heat_rate": "1000", "max_cool_rate": "1000"},
        ],
        # 线段 0->150 跨阶段边界 t=100（无采样点），阶段1 内在 t=5 穿越阈值 10
        "samples": [{"time": 0, "temp": "0"}, {"time": 150, "temp": "300"},
                    {"time": 200, "temp": "100"}],
        "exposure": [
            {"min_exposure": "150.416666", "max_exposure": "150.416667"},
            {"min_exposure": "291.666666", "max_exposure": "291.666667"},
        ],
    }
    status, resp = http("POST", f"{WEB_URL}/api/exposure", body)
    assert status == 200, f"got {status}: {resp}"
    results = resp["results"]
    assert results[0]["exposure"] == "1805/12", results          # 9025/60 约分
    assert results[0]["exposure_display"] == "150.416667", results
    assert results[0]["status"] == "合格", results
    assert results[1]["exposure"] == "875/3", results            # 17500/60 约分
    assert results[1]["exposure_display"] == "291.666667", results
    assert results[1]["status"] == "合格", results


@check("热暴露：恰等于上下限判合格，不足/合格/过量按精确值判定")
def check_exposure_equal_bounds_and_statuses():
    # 默认曲线各段精确热暴露：7500、37200、650 °C·min
    body = json.loads(json.dumps(VALID_BODY))
    body["exposure"] = [
        {"min_exposure": "7500", "max_exposure": "7500"},
        {"min_exposure": "37200", "max_exposure": "37200"},
        {"min_exposure": "650", "max_exposure": "650"},
    ]
    status, resp = http("POST", f"{WEB_URL}/api/exposure", body)
    assert status == 200, f"got {status}: {resp}"
    results = resp["results"]
    assert [r["stage_index"] for r in results] == [0, 1, 2], results
    assert [r["status"] for r in results] == ["合格"] * 3, results
    assert [r["exposure"] for r in results] == ["7500/1", "37200/1", "650/1"], results
    assert [r["exposure_display"] for r in results] == [
        "7500.000000", "37200.000000", "650.000000"], results
    # 窗口略偏即不足/过量（精确比较，不受展示值舍入影响）
    body["exposure"] = [
        {"min_exposure": "7500.000001", "max_exposure": "99999"},
        {"min_exposure": "37200", "max_exposure": "37200"},
        {"min_exposure": "0", "max_exposure": "649.999999"},
    ]
    status, resp = http("POST", f"{WEB_URL}/api/exposure", body)
    assert status == 200, f"got {status}: {resp}"
    assert [r["status"] for r in resp["results"]] == ["不足", "合格", "过量"], resp


@check("热暴露：多个非法窗口 422，按阶段位置稳定返回全部明细")
def check_exposure_invalid_windows():
    body = json.loads(json.dumps(VALID_BODY))
    body["exposure"] = [
        {"min_exposure": "-1", "max_exposure": "10"},    # 负数
        {"min_exposure": "100", "max_exposure": "200"},  # 合法
        {"min_exposure": "9", "max_exposure": "1"},      # 下限高于上限
    ]
    status, resp = http("POST", f"{WEB_URL}/api/exposure", body)
    assert status in (400, 422), f"got {status}: {resp}"
    assert resp and "detail" in resp, resp
    assert "results" not in (resp or {}), resp
    locs = [tuple(item["loc"]) for item in resp["detail"]]
    assert ("body", "exposure", 0, "min_exposure") in locs, locs
    assert ("body", "exposure", 2) in locs, locs
    positions = [loc[2] for loc in locs if loc[:2] == ("body", "exposure")]
    assert positions == sorted(positions) == [0, 2], locs


def main():
    print(f"验收目标：WEB={WEB_URL} API={API_URL}")
    if not wait_ready():
        print("✗ 服务在限定时间内未就绪")
        return 1
    failed = 0
    for name, fn in CHECKS:
        try:
            fn()
            print(f"✓ {name}")
        except Exception as exc:  # noqa: BLE001 - 验收脚本需报告全部失败
            failed += 1
            print(f"✗ {name}: {exc}")
    total = len(CHECKS)
    print(f"验收结果：{total - failed}/{total} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
