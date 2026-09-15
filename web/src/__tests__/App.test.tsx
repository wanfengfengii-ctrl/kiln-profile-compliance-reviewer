import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AdjudicationResult } from "../types";

const releaseResult: AdjudicationResult = {
  conclusion: "放行",
  violations: [],
  stages: [
    {
      start: 0,
      end: 100,
      min_temp: "0",
      max_temp: "100",
      max_heat_rate: "5.0",
      max_cool_rate: "5.0",
    },
  ],
  samples: [
    { time: 0, temp: "10" },
    { time: 50, temp: "20" },
    { time: 100, temp: "30" },
  ],
};

const refireResult: AdjudicationResult = {
  conclusion: "返烧",
  violations: [
    {
      type: "temperature",
      time: 50,
      temperature: "500",
      min_temp: "0",
      max_temp: "100",
      stage_index: 0,
    },
    {
      type: "rate",
      start_time: 0,
      end_time: 50,
      direction: "heating",
      measured: "24.0",
      limit: "5.0",
      stage_index: 0,
    },
  ],
  stages: releaseResult.stages,
  samples: [
    { time: 0, temp: "10" },
    { time: 50, temp: "500" },
    { time: 100, temp: "30" },
  ],
};

function mockResponse(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

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

    // 请求体：整数秒字段发送 number，温度保持字符串
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.stages[0].start).toBe(0);
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
