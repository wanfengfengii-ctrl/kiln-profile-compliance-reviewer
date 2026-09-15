import { defineConfig } from "@playwright/test";

/**
 * 真实联调端到端测试：默认打向 docker compose 启动的 Web 入口
 * （WEB_PORT 映射端口），可用 WEB_URL 覆盖，例如本地开发时
 * WEB_URL=http://localhost:5173（vite dev，已代理 /api 到 8000）。
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:8080",
    // 使用完整 Chromium（而非 headless-shell），与 install --no-shell 对应
    channel: "chromium",
  },
});
