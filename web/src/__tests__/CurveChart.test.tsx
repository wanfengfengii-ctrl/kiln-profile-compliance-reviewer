import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurveChart } from "../components/CurveChart";
import { StageOut } from "../types";

// 超出 Number.MAX_SAFE_INTEGER 的小跨度时间轴：浮点会把相邻秒舍入到一起
const stages: StageOut[] = [
  {
    start: "90071992547409920",
    end: "90071992547409930",
    min_temp: "0",
    max_temp: "100",
    max_heat_rate: "1000",
    max_cool_rate: "1000",
  },
];

const samples = [
  { time: "90071992547409920", temp: "10" },
  { time: "90071992547409925", temp: "20" },
  { time: "90071992547409930", temp: "30" },
];

function renderChart() {
  return render(
    <CurveChart stages={stages} samples={samples} violations={[]} />
  );
}

describe("CurveChart 超大秒数定位", () => {
  it("相邻采样按真实时间间隔等距分布，不重叠", () => {
    const { container } = renderChart();
    const circles = container.querySelectorAll("circle.point");
    expect(circles).toHaveLength(3);
    const cxs = [...circles].map((c) => Number(c.getAttribute("cx")));
    // 两两不重叠
    expect(cxs[1]).toBeGreaterThan(cxs[0]);
    expect(cxs[2]).toBeGreaterThan(cxs[1]);
    // 等时间间隔（5s）-> 等像素间隔
    expect(cxs[1] - cxs[0]).toBeCloseTo(cxs[2] - cxs[1], 1);
    // 首末点分别落在绘图区左右边界
    expect(cxs[0]).toBeCloseTo(68, 1);
    expect(cxs[2]).toBeCloseTo(896, 1);
  });

  it("折线顶点与采样点一致使用精确间隔", () => {
    const { container } = renderChart();
    const polyline = container.querySelector("polyline");
    const xs = (polyline?.getAttribute("points") ?? "")
      .split(" ")
      .map((pair) => Number(pair.split(",")[0]));
    expect(xs).toHaveLength(3);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 1);
  });

  it("x 轴刻度使用精确整数秒标签，不被浮点改写", () => {
    const { container } = renderChart();
    const labels = [...container.querySelectorAll("text.tick")].map(
      (t) => t.textContent
    );
    expect(labels).toContain("90071992547409920");
    expect(labels).toContain("90071992547409930");
    // 中间刻度同样是精确整数（跨度 10s，6 刻度 -> 每 2s 一刻）
    expect(labels).toContain("90071992547409924");
  });
});
