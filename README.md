# 窑温曲线复核台

试烧完成后，质量工程师在此复核窑温曲线是否遵守连续工艺阶段。系统由
**React 前端**与 **FastAPI 后端**真实联调组成：可编辑阶段参数与时间-温度采样，
复核后展示 SVG 折线、违规定位以及唯一的 **放行 / 返烧** 结论，并可下载本次
裁决的 JSON。

## 裁决规则

**输入校验（任何输入错误都拒绝裁决，前端同时清除旧结果）**

- 阶段时间为非负整数秒，必须 `start < end`，阶段首尾相接（上一阶段 `end`
  等于下一阶段 `start`）；阶段区间为 `[start, end)`，仅末阶段包含 `end`。
- 温度为有限十进制数，允许负值；最低温度不得高于最高温度。
- 最大升温、降温速率为有限非负十进制数（°C/min）。
- 采样时间为非负整数秒、严格递增、不得越出阶段总范围，并覆盖首末端点。
- 采样温度为有限十进制数。

**违规判定**

- 温度：各阶段温度上下限均包含边界，越界即温度违规。
- 速率：按相邻采样“温差 × 60 ÷ 秒差”十进制精确计算（°C/min），仅当两个
  端点属于同一阶段时检查；等于限制合规，跨阶段不检查。
- 返回顺序：先按采样时间升序的温度违规，再按后一端点时间升序的速率违规；
  速率项包含两个时间点、实测值与限制。
- 结论唯一：无违规为 **放行**，否则为 **返烧**。

**一致性**：折线、结论与下载 JSON 均取自同一次 `/api/adjudicate` 响应。

## API 契约

`POST /api/adjudicate`

```json
{
  "stages": [
    {"start": 0, "end": 3600, "min_temp": "15", "max_temp": "260",
     "max_heat_rate": "4.0", "max_cool_rate": "2.0"}
  ],
  "samples": [{"time": 0, "temp": "20"}, {"time": 3600, "temp": "160"}]
}
```

- 时间字段为整数（非负秒）；温度/速率字段为十进制数（字符串或 JSON 数值均可，
  推荐字符串以保持精度）。
- 成功 `200`：`{"conclusion": "放行"|"返烧", "violations": [...], "stages": [...],
  "samples": [...]}`（回传裁决所用数据，供折线与下载使用）。
- 输入错误 `422`：`{"detail": [...]}`，不产生裁决结果。
- 健康检查：`GET /api/health`。

## Docker Compose（仅 Web 与 API）

```bash
docker compose up -d --build          # 启动 web(nginx) 与 api
# 覆盖宿主端口：
WEB_PORT=9000 API_PORT=9001 docker compose up -d --build
```

- Web 入口：`http://localhost:${WEB_PORT:-8080}`（nginx 将 `/api` 代理到 API）。
- API 直连：`http://localhost:${API_PORT:-8000}/api/health`。

**一次性验收**（verify 服务，对运行中的栈做真实 HTTP 检查后退出）：

```bash
docker compose --profile verify run --rm verify
# 或：docker compose --profile verify up --exit-code-from verify verify
```

退出码为 0 表示验收通过。

## 本地开发

```bash
# API（Python 3.11+）
cd api
pip install -r requirements-dev.txt
uvicorn app.main:app --reload          # http://localhost:8000

# Web（Node 20+）
cd web
npm install
npm run dev                            # http://localhost:5173（/api 已代理到 8000）
```

## 测试

```bash
# 裁决与 API：pytest
cd api && pytest

# 前端：Vitest（含“同次响应”“错误清除旧结果”等用例）
cd web && npm test

# 真实联调端到端：Playwright（先启动 compose 栈或本地 dev）
cd e2e && npm install && npx playwright install chromium
docker compose up -d --build
npx playwright test                    # 默认打向 http://localhost:8080
WEB_URL=http://localhost:5173 npx playwright test   # 或打向 vite dev
```

## 目录结构

```
api/            FastAPI 裁决服务（app/）与 pytest（tests/）
web/            React + Vite 前端（src/）与 Vitest（src/__tests__/）
e2e/            Playwright 真实联调测试
verify/         一次性验收服务（HTTP 级检查 compose 栈）
docker-compose.yml
```
