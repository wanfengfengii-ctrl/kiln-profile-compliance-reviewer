import { expect, test } from "@playwright/test";

test.describe("热暴露复核（真实联调）", () => {
  test("默认曲线：逐段复核热暴露，精确分数、展示值与状态按阶段展示", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("adjudicate-button").click();
    await expect(page.getByTestId("conclusion-banner")).toContainText(
      "结论：放行"
    );

    // 结果区为每段填写最低、最高允许热暴露量
    // （默认曲线各段精确热暴露：7500、37200、650 °C·min）
    await page.getByTestId("exposure-min-0").fill("7500");
    await page.getByTestId("exposure-max-0").fill("7500");
    await page.getByTestId("exposure-min-1").fill("37000");
    await page.getByTestId("exposure-max-1").fill("38000");
    await page.getByTestId("exposure-min-2").fill("100");
    await page.getByTestId("exposure-max-2").fill("600");
    await page.getByTestId("exposure-button").click();

    // 恰等于上下限判合格；650 > 600 判过量
    await expect(page.getByTestId("exposure-status-0")).toHaveText("合格");
    await expect(page.getByTestId("exposure-status-1")).toHaveText("合格");
    await expect(page.getByTestId("exposure-status-2")).toHaveText("过量");
    await expect(page.getByTestId("exposure-fraction-0")).toHaveText("7500/1");
    await expect(page.getByTestId("exposure-display-0")).toHaveText(
      "7500.000000"
    );
    await expect(page.getByTestId("exposure-fraction-2")).toHaveText("650/1");
    // 放行/返烧结论保持独立
    await expect(page.getByTestId("conclusion-banner")).toContainText(
      "结论：放行"
    );
  });

  test("多个非法窗口：拒绝复核、清除旧报告并定位相应阶段", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("adjudicate-button").click();
    await expect(page.getByTestId("conclusion-banner")).toBeVisible();

    // 先做一次合法复核，产生暴露报告
    await page.getByTestId("exposure-min-0").fill("7500");
    await page.getByTestId("exposure-max-0").fill("7500");
    await page.getByTestId("exposure-min-1").fill("37200");
    await page.getByTestId("exposure-max-1").fill("37200");
    await page.getByTestId("exposure-min-2").fill("650");
    await page.getByTestId("exposure-max-2").fill("650");
    await page.getByTestId("exposure-button").click();
    await expect(page.getByTestId("exposure-report")).toBeVisible();

    // 阶段 1 下限高于上限、阶段 3 下限为负：全部明细按阶段位置返回
    await page.getByTestId("exposure-min-0").fill("9");
    await page.getByTestId("exposure-max-0").fill("1");
    await page.getByTestId("exposure-min-2").fill("-5");
    await page.getByTestId("exposure-button").click();

    const error = page.getByTestId("exposure-error-banner");
    await expect(error).toBeVisible();
    await expect(error).toContainText("最低允许热暴露量不得高于最高允许热暴露量");
    await expect(error).toContainText("必须是有限非负十进制数");
    // 旧暴露报告不残留
    await expect(page.getByTestId("exposure-report")).toHaveCount(0);
    // 定位相应阶段：第 1、3 段高亮，第 2 段不高亮
    await expect(page.getByTestId("exposure-row-0")).toHaveClass(
      /exposure-row-error/
    );
    await expect(page.getByTestId("exposure-row-1")).not.toHaveClass(
      /exposure-row-error/
    );
    await expect(page.getByTestId("exposure-row-2")).toHaveClass(
      /exposure-row-error/
    );
    // 放行/返烧结论保持独立
    await expect(page.getByTestId("conclusion-banner")).toContainText(
      "结论：放行"
    );
  });
});
