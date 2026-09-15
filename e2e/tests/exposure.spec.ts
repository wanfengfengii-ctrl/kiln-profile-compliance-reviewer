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

  test("热暴露复核未返回时重新裁决：迟到的旧报告不覆盖新结果区", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("adjudicate-button").click();
    await expect(page.getByTestId("conclusion-banner")).toBeVisible();

    // 让 /api/exposure 的响应延迟返回，模拟复核在途
    await page.route("**/api/exposure", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    const lateResponse = page.waitForResponse("**/api/exposure");
    await page.getByTestId("exposure-min-0").fill("7500");
    await page.getByTestId("exposure-max-0").fill("7500");
    await page.getByTestId("exposure-min-1").fill("37200");
    await page.getByTestId("exposure-max-1").fill("37200");
    await page.getByTestId("exposure-min-2").fill("650");
    await page.getByTestId("exposure-max-2").fill("650");
    await page.getByTestId("exposure-button").click();

    // 旧复核尚未返回时修改采样并重新裁决（新曲线、新结果区）
    await page.getByTestId("sample-1-temp").fill("101");
    await page.getByTestId("adjudicate-button").click();
    await expect(page.getByTestId("conclusion-banner")).toContainText("结论：");

    // 旧复核响应到达后也不得出现在新结果区
    await lateResponse;
    await expect(page.getByTestId("exposure-report")).toHaveCount(0);
    await expect(page.getByTestId("exposure-error-banner")).toHaveCount(0);
    await expect(page.getByTestId("exposure-button")).toBeEnabled();
  });

  test("热暴露复核服务连接失败：不误报为窗口输入错误", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("adjudicate-button").click();
    await expect(page.getByTestId("conclusion-banner")).toBeVisible();

    // 拦截 /api/exposure 并中止，模拟服务连接失败
    await page.route("**/api/exposure", (route) => route.abort());
    await page.getByTestId("exposure-min-0").fill("7500");
    await page.getByTestId("exposure-max-0").fill("7500");
    await page.getByTestId("exposure-min-1").fill("37200");
    await page.getByTestId("exposure-max-1").fill("37200");
    await page.getByTestId("exposure-min-2").fill("650");
    await page.getByTestId("exposure-max-2").fill("650");
    await page.getByTestId("exposure-button").click();

    const error = page.getByTestId("exposure-error-banner");
    await expect(error).toBeVisible();
    await expect(error).toContainText("热暴露复核失败");
    await expect(error).toContainText("无法连接复核服务");
    await expect(error).not.toContainText("输入错误");
    // 连接失败不定位任何阶段
    await expect(page.getByTestId("exposure-row-0")).not.toHaveClass(
      /exposure-row-error/
    );
  });

  test("重新裁决等待返回时复核旧曲线：裁决完成后到达的旧报告不进入新结果区", async ({
    page,
  }) => {
    await page.goto("/");
    // 第二次起裁决延迟 1.5s 返回；热暴露复核延迟 3s，保证晚于新裁决到达
    let adjudicateCalls = 0;
    await page.route("**/api/adjudicate", async (route) => {
      adjudicateCalls += 1;
      if (adjudicateCalls >= 2) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });
    await page.route("**/api/exposure", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    // 第一次裁决（不延迟）：旧曲线结果区展示
    await page.getByTestId("adjudicate-button").click();
    await expect(page.getByTestId("conclusion-banner")).toBeVisible();

    // 重新裁决（等待返回中），随后立即复核旧曲线的热暴露
    await page.getByTestId("adjudicate-button").click();
    const lateExposure = page.waitForResponse("**/api/exposure");
    await page.getByTestId("exposure-min-0").fill("7500");
    await page.getByTestId("exposure-max-0").fill("7500");
    await page.getByTestId("exposure-min-1").fill("37200");
    await page.getByTestId("exposure-max-1").fill("37200");
    await page.getByTestId("exposure-min-2").fill("650");
    await page.getByTestId("exposure-max-2").fill("650");
    await page.getByTestId("exposure-button").click();

    // 新裁决先返回：按钮恢复可用，新结果区展示
    await expect(page.getByTestId("adjudicate-button")).toBeEnabled();
    await expect(page.getByTestId("conclusion-banner")).toContainText(
      "结论：放行"
    );

    // 旧曲线的暴露报告在新裁决完成后到达：必须丢弃
    await lateExposure;
    await expect(page.getByTestId("exposure-report")).toHaveCount(0);
    await expect(page.getByTestId("exposure-error-banner")).toHaveCount(0);
    await expect(page.getByTestId("exposure-button")).toBeEnabled();
  });
});
