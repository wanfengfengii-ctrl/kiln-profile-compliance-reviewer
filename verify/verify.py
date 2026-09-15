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
    assert body["samples"][-1] == {"time": 12600, "temp": "880"}


@check("违规曲线 -> 返烧，温度违规在前、速率违规在后且字段完整")
def check_refire_via_web():
    status, body = http("POST", f"{WEB_URL}/api/adjudicate", violating_body())
    assert status == 200, f"got {status}: {body}"
    assert body["conclusion"] == "返烧", body
    violations = body["violations"]
    assert [v["type"] for v in violations] == ["temperature", "rate", "rate"], violations
    temp_v = violations[0]
    assert temp_v["time"] == 1200 and temp_v["temperature"] == "500", temp_v
    heat_v, cool_v = violations[1], violations[2]
    assert (heat_v["start_time"], heat_v["end_time"]) == (0, 1200), heat_v
    assert heat_v["measured"] == "24" and heat_v["limit"] == "4.0", heat_v
    assert (cool_v["start_time"], cool_v["end_time"]) == (1200, 2400), cool_v
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
