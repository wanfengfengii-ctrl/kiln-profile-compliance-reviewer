import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AdjudicationResult, ExposureResponse } from "../types";

const releaseResult: AdjudicationResult = {
  conclusion: "放行",
  violations: [],
  stages: [
    {
      start: "0",
      end: "100",
      min_temp: "0",
      max_temp: "100",
      max_heat_rate: "5.0",
      max_cool_rate: "5.0",
    },
  ],
  samples: [
    { time: "0", temp: "10" },
    { time: "50", temp: "20" },
    { time: "100", temp: "30" },
  ],
};

const refireResult: AdjudicationResult = {
  conclusion: "返烧",
  violations: [
    {
      type: "temperature",
      time: "50",
      temperature: "500",
      min_temp: "0",
      max_temp: "100",
      stage_index: 0,
    },
    {
      type: "rate",
      start_time: "0",
      end_time: "50",
      direction: "heating",
      measured: "24.0",
      limit: "5.0",
      stage_index: 0,
    },
  ],
  stages: releaseResult.stages,
  samples: [
    { time: "0", temp: "10" },
    { time: "50", temp: "500" },
    { time: "100", temp: "30" },
  ],
};

function mockResponse(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

/** 三阶段裁决响应：供热暴露复核用例使用。 */
const exposureAdjudication: AdjudicationResult = {
  conclusion: "放行",
  violations: [],
  stages: [
    { start: "0", end: "3600", min_temp: "15", max_temp: "260", max_heat_rate: "4.0", max_cool_rate: "2.0" },
    { start: "3600", end: "10800", min_temp: "250", max_temp: "950", max_heat_rate: "5.0", max_cool_rate: "2.0" },
    { start: "10800", end: "12600", min_temp: "850", max_temp: "950", max_heat_rate: "1.0", max_cool_rate: "1.0" },
  ],
  samples: [
    { time: "0", temp: "20" },
    { time: "3600", temp: "260" },
    { time: "10800", temp: "860" },
    { time: "12600", temp: "880" },
  ],
};

const exposureResponse: ExposureResponse = {
  results: [
    { stage_index: 0, exposure: "7500/1", exposure_display: "7500.000000", min_exposure: "7500", max_exposure: "7500", status: "合格" },
    { stage_index: 1, exposure: "37200/1", exposure_display: "37200.000000", min_exposure: "37000", max_exposure: "38000", status: "合格" },
    { stage_index: 2, exposure: "650/1", exposure_display: "650.000000", min_exposure: "100", max_exposure: "600", status: "过量" },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function clickAdjudicate() {
  fireEvent.click(screen.getByTestId("adjudicate-button"));
}

describe("复核台", () => {
  it("放行结论：折线、结论与下载 JSON 均来自同次响应", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, releaseResult));
    render(<App />);
    await clickAdjudicate();

    const banner = await screen.findByTestId("conclusion-banner");
    expect(banner).toHaveTextContent("结论：放行");
    expect(screen.queryByTestId("error-banner")).toBeNull();

    // 编辑器默认 12 个采样点，响应只有 3 个：折线必须渲染响应中的数据
    const chart = screen.getByTestId("curve-chart");
    expect(chart.querySelectorAll("circle.point")).toHaveLength(3);
    expect(chart.querySelector("polyline")).not.toBeNull();

    // 请求体：整数秒以字符串原样发送（避免大整数浮点改写），温度保持字符串
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.stages[0].start).toBe("0");
    expect(body.samples[0].time).toBe("0");
    expect(typeof body.samples[0].temp).toBe("string");

    // 下载 JSON 与同次响应完全一致
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:mock";
    });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("download-json"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blobs[0]);
    });
    expect(JSON.parse(text)).toEqual(releaseResult);
    clickSpy.mockRestore();
  });

  it("超出安全整数范围的秒数原样发送、不被改写", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, releaseResult));
    render(<App />);
    // 9007199254740993 = 2**53 + 1，Number() 会改写为 9007199254740992
    fireEvent.change(screen.getByTestId("stage-0-end"), {
      target: { value: "9007199254740993" },
    });
    fireEvent.change(screen.getByTestId("sample-1-time"), {
      target: { value: "9007199254740993" },
    });
    await clickAdjudicate();
    await screen.findByTestId("conclusion-banner");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.stages[0].end).toBe("9007199254740993");
    expect(body.samples[1].time).toBe("9007199254740993");
    // 编辑器中的值也不被改写
    expect(screen.getByTestId("stage-0-end")).toHaveValue("9007199254740993");
    expect(screen.getByTestId("sample-1-time")).toHaveValue("9007199254740993");
  });

  it("返烧结论：违规定位列表与图中红色标记", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, refireResult));
    render(<App />);
    await clickAdjudicate();

    const banner = await screen.findByTestId("conclusion-banner");
    expect(banner).toHaveTextContent("结论：返烧");

    const list = screen.getByTestId("violation-list");
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("温度违规");
    expect(items[0]).toHaveTextContent("50s");
    expect(items[0]).toHaveTextContent("500");
    expect(items[1]).toHaveTextContent("速率违规");
    expect(items[1]).toHaveTextContent("24.0");
    expect(items[1]).toHaveTextContent("5.0");

    const chart = screen.getByTestId("curve-chart");
    expect(chart.querySelectorAll("circle.violation")).toHaveLength(1);
    expect(screen.getByTestId("rate-violation-segment")).toBeInTheDocument();
  });

  it("输入错误：拒绝裁决并清除旧结果", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, releaseResult));
    render(<App />);
    await clickAdjudicate();
    await screen.findByTestId("conclusion-banner");

    fetchMock.mockResolvedValueOnce(
      mockResponse(false, 422, {
        detail: [
          { loc: ["body", "stages", 0], msg: "阶段必须满足 start < end" },
        ],
      })
    );
    fireEvent.change(screen.getByTestId("stage-0-start"), {
      target: { value: "999999" },
    });
    await clickAdjudicate();

    const error = await screen.findByTestId("error-banner");
    expect(error).toHaveTextContent("阶段必须满足 start < end");
    // 旧结果被清除
    expect(screen.queryByTestId("conclusion-banner")).toBeNull();
    expect(screen.queryByTestId("curve-chart")).toBeNull();
    expect(screen.queryByTestId("violation-list")).toBeNull();
    expect(screen.queryByTestId("download-json")).toBeNull();
  });

  it("网络失败同样清除旧结果", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, releaseResult));
    render(<App />);
    await clickAdjudicate();
    await screen.findByTestId("conclusion-banner");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await clickAdjudicate();
    const error = await screen.findByTestId("error-banner");
    expect(error).toHaveTextContent("无法连接复核服务");
    expect(screen.queryByTestId("conclusion-banner")).toBeNull();
  });

  it("阶段与采样表格可编辑、增删", async () => {
    render(<App />);
    // 编辑阶段参数
    fireEvent.change(screen.getByTestId("stage-0-max_temp"), {
      target: { value: "300" },
    });
    expect(screen.getByTestId("stage-0-max_temp")).toHaveValue("300");
    // 添加/删除阶段
    fireEvent.click(screen.getByTestId("add-stage"));
    expect(screen.getByTestId("stage-3-start")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("stage-remove-3"));
    expect(screen.queryByTestId("stage-3-start")).toBeNull();
    // 添加/删除采样
    fireEvent.click(screen.getByTestId("add-sample"));
    expect(screen.getByTestId("sample-12-time")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sample-remove-12"));
    expect(screen.queryByTestId("sample-12-time")).toBeNull();
  });
});

describe("热暴露复核", () => {
  async function adjudicateWithExposureStages() {
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, exposureAdjudication));
    render(<App />);
    await clickAdjudicate();
    await screen.findByTestId("conclusion-banner");
  }

  function fillWindows(windows: [string, string][]) {
    windows.forEach(([min, max], i) => {
      fireEvent.change(screen.getByTestId(`exposure-min-${i}`), {
        target: { value: min },
      });
      fireEvent.change(screen.getByTestId(`exposure-max-${i}`), {
        target: { value: max },
      });
    });
  }

  it("复核热暴露：请求取自该次裁决响应，报告按阶段展示", async () => {
    await adjudicateWithExposureStages();

    // 结果区为每段填写最低、最高允许热暴露量
    fillWindows([
      ["7500", "7500"],
      ["37000", "38000"],
      ["100", "600"],
    ]);
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, exposureResponse));
    fireEvent.click(screen.getByTestId("exposure-button"));

    await screen.findByTestId("exposure-report");
    expect(screen.getByTestId("exposure-status-0")).toHaveTextContent("合格");
    expect(screen.getByTestId("exposure-status-1")).toHaveTextContent("合格");
    expect(screen.getByTestId("exposure-status-2")).toHaveTextContent("过量");
    expect(screen.getByTestId("exposure-fraction-0")).toHaveTextContent("7500/1");
    expect(screen.getByTestId("exposure-display-0")).toHaveTextContent("7500.000000");
    expect(screen.getByTestId("exposure-fraction-2")).toHaveTextContent("650/1");
    // 放行/返烧结论保持独立、不受影响
    expect(screen.getByTestId("conclusion-banner")).toHaveTextContent("结论：放行");

    // 请求发往 /api/exposure，阶段与采样取自该次裁决响应，窗口按阶段顺序
    expect(fetchMock.mock.calls[1][0]).toBe("/api/exposure");
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.stages).toEqual(exposureAdjudication.stages);
    expect(body.samples).toEqual(exposureAdjudication.samples);
    expect(body.exposure).toEqual([
      { min_exposure: "7500", max_exposure: "7500" },
      { min_exposure: "37000", max_exposure: "38000" },
      { min_exposure: "100", max_exposure: "600" },
    ]);
  });

  it("多个非法窗口：清除旧报告并定位相应阶段", async () => {
    await adjudicateWithExposureStages();
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, exposureResponse));
    fireEvent.click(screen.getByTestId("exposure-button"));
    await screen.findByTestId("exposure-report");

    // 阶段 1 下限高于上限、阶段 3 下限为负：全部明细按阶段位置返回
    fetchMock.mockResolvedValueOnce(
      mockResponse(false, 422, {
        detail: [
          {
            loc: ["body", "exposure", 0],
            msg: "最低允许热暴露量不得高于最高允许热暴露量：9 > 1",
          },
          {
            loc: ["body", "exposure", 2, "min_exposure"],
            msg: "必须是有限非负十进制数，收到: -5",
          },
        ],
      })
    );
    fillWindows([
      ["9", "1"],
      ["37000", "38000"],
      ["-5", "600"],
    ]);
    fireEvent.click(screen.getByTestId("exposure-button"));

    const error = await screen.findByTestId("exposure-error-banner");
    expect(error).toHaveTextContent("最低允许热暴露量不得高于最高允许热暴露量");
    expect(error).toHaveTextContent("必须是有限非负十进制数");
    // 旧暴露报告不残留
    expect(screen.queryByTestId("exposure-report")).toBeNull();
    // 定位相应阶段：第 1、3 段高亮，第 2 段不高亮
    expect(screen.getByTestId("exposure-row-0").className).toContain(
      "exposure-row-error"
    );
    expect(screen.getByTestId("exposure-row-1").className).not.toContain(
      "exposure-row-error"
    );
    expect(screen.getByTestId("exposure-row-2").className).toContain(
      "exposure-row-error"
    );
    // 放行/返烧结论保持独立、不受影响
    expect(screen.getByTestId("conclusion-banner")).toHaveTextContent("结论：放行");
  });

  it("热暴露请求失败同样清除旧报告", async () => {
    await adjudicateWithExposureStages();
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, exposureResponse));
    fireEvent.click(screen.getByTestId("exposure-button"));
    await screen.findByTestId("exposure-report");

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByTestId("exposure-button"));
    const error = await screen.findByTestId("exposure-error-banner");
    expect(error).toHaveTextContent("无法连接复核服务");
    expect(screen.queryByTestId("exposure-report")).toBeNull();
  });

  it("新一次裁决清除旧暴露报告并重置窗口", async () => {
    await adjudicateWithExposureStages();
    fillWindows([
      ["7500", "7500"],
      ["37000", "38000"],
      ["100", "600"],
    ]);
    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, exposureResponse));
    fireEvent.click(screen.getByTestId("exposure-button"));
    await screen.findByTestId("exposure-report");

    fetchMock.mockResolvedValueOnce(mockResponse(true, 200, exposureAdjudication));
    await clickAdjudicate();
    await screen.findByTestId("conclusion-banner");
    expect(screen.queryByTestId("exposure-report")).toBeNull();
    expect(screen.queryByTestId("exposure-error-banner")).toBeNull();
    expect(screen.getByTestId("exposure-min-0")).toHaveValue("");
    expect(screen.getByTestId("exposure-max-2")).toHaveValue("");
  });
});
