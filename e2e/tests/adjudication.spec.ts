import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test.describe("窑温曲线复核台（真实联调）", () => {
  test("默认数据复核放行：结论、SVG 折线与下载 JSON 来自同次响应", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("adjudicate-button").click();

    const banner = page.getByTestId("conclusion-banner");
    await expect(banner).toContainText("结论：放行");

    // SVG 折线与 12 个默认采样点
    const chart = page.getByTestId("curve-chart");
    await expect(chart).toBeVisible();
    await expect(chart.locator("polyline")).toHaveCount(1);
    await expect(chart.locator("circle.point")).toHaveCount(12);
    await expect(chart.locator("circle.violation")).toHaveCount(0);
    await expect(page.getByTestId("violation-list")).toHaveCount(0);

    // 下载 JSON 与本次响应一致
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-json").click(),
    ]);
    const path = await download.path();
    const data = JSON.parse(readFileSync(path!, "utf-8"));
    expect(data.conclusion).toBe("放行");
    expect(data.violations).toEqual([]);
    expect(data.samples).toHaveLength(12);
    expect(data.stages).toHaveLength(3);
  });

  test("违规采样导致返烧并定位温度与速率违规", async ({ page }) => {
    await page.goto("/");
    // 1200s 采样温度改为 500：超阶段上限，并引发升温/降温速率违规
    await page.getByTestId("sample-1-temp").fill("500");
    await page.getByTestId("adjudicate-button").click();

    await expect(page.getByTestId("conclusion-banner")).toContainText(
      "结论：返烧"
    );
    const list = page.getByTestId("violation-list");
    await expect(list).toBeVisible();
    const items = list.locator("li");
    await expect(items).toHaveCount(3);
    // 先温度违规（按采样时间），再速率违规（按后一端点时间）
    await expect(items.nth(0)).toContainText("温度违规");
    await expect(items.nth(0)).toContainText("1200s");
    await expect(items.nth(1)).toContainText("速率违规");
    await expect(items.nth(1)).toContainText("0s → 1200s");
    await expect(items.nth(1)).toContainText("24");
    await expect(items.nth(2)).toContainText("速率违规");
    await expect(items.nth(2)).toContainText("1200s → 2400s");
    await expect(items.nth(2)).toContainText("16");

    // 图中违规定位：1 个红色温度违规点 + 2 段速率违规线段
    const chart = page.getByTestId("curve-chart");
    await expect(chart.locator("circle.violation")).toHaveCount(1);
    await expect(page.getByTestId("rate-violation-segment")).toHaveCount(2);
  });

  test("非法输入拒绝裁决并清除旧结果", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("adjudicate-button").click();
    await expect(page.getByTestId("conclusion-banner")).toBeVisible();

    // 破坏阶段首尾相接：阶段 1 end 改为 100，与阶段 2 start=3600 脱节
    await page.getByTestId("stage-0-end").fill("100");
    await page.getByTestId("adjudicate-button").click();

    const error = page.getByTestId("error-banner");
    await expect(error).toBeVisible();
    await expect(error).toContainText("首尾相接");
    await expect(page.getByTestId("conclusion-banner")).toHaveCount(0);
    await expect(page.getByTestId("curve-chart")).toHaveCount(0);
    await expect(page.getByTestId("download-json")).toHaveCount(0);
  });

  test("阶段与采样可编辑增删", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("add-stage").click();
    await expect(page.getByTestId("stage-3-start")).toBeVisible();
    await page.getByTestId("stage-remove-3").click();
    await expect(page.getByTestId("stage-3-start")).toHaveCount(0);

    await page.getByTestId("add-sample").click();
    await expect(page.getByTestId("sample-12-time")).toBeVisible();
    await page.getByTestId("sample-remove-12").click();
    await expect(page.getByTestId("sample-12-time")).toHaveCount(0);
  });
});
