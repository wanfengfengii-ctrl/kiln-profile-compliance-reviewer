import {
  AdjudicationResult,
  ExposureResponse,
  ExposureWindowInput,
  SampleInput,
  SampleOut,
  StageInput,
  StageOut,
} from "./types";

export class ApiError extends Error {
  /** 输入错误定位到的阶段下标（热暴露窗口按阶段位置返回明细时用）。 */
  stageIndices: number[] = [];
}

interface ErrorDetailItem {
  loc?: (string | number)[];
  msg?: string;
}

/** 把 FastAPI 的错误响应格式化为可读文本。 */
export function formatDetail(data: unknown): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item: ErrorDetailItem) => {
          const loc = Array.isArray(item.loc)
            ? item.loc.filter((p) => p !== "body").join(".")
            : "";
          return loc ? `${loc}: ${item.msg ?? "输入错误"}` : item.msg ?? "输入错误";
        })
        .join("；");
    }
  }
  return "请求失败";
}

export async function adjudicate(
  stages: StageInput[],
  samples: SampleInput[]
): Promise<AdjudicationResult> {
  // 整数秒以字符串原样发送：超出 Number.MAX_SAFE_INTEGER 的秒数不会被
  // 浮点改写；服务端负责校验并裁决（服务端为唯一权威）。
  const body = {
    stages: stages.map((s) => ({
      start: s.start.trim(),
      end: s.end.trim(),
      min_temp: s.min_temp.trim(),
      max_temp: s.max_temp.trim(),
      max_heat_rate: s.max_heat_rate.trim(),
      max_cool_rate: s.max_cool_rate.trim(),
    })),
    samples: samples.map((s) => ({
      time: s.time.trim(),
      temp: s.temp.trim(),
    })),
  };
  let res: Response;
  try {
    res = await fetch("/api/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("无法连接复核服务");
  }
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    throw new ApiError(formatDetail(data) || `请求被拒绝（HTTP ${res.status}）`);
  }
  return (await res.json()) as AdjudicationResult;
}

/** 从 422 detail 中解析暴露窗口错误对应的阶段下标（去重、按位置升序）。 */
export function exposureErrorStageIndices(data: unknown): number[] {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (Array.isArray(detail)) {
      const indices = new Set<number>();
      for (const item of detail as ErrorDetailItem[]) {
        const loc = item?.loc;
        if (Array.isArray(loc)) {
          const at = loc.indexOf("exposure");
          const idx = loc[at + 1];
          if (at >= 0 && typeof idx === "number") indices.add(idx);
        }
      }
      return [...indices].sort((a, b) => a - b);
    }
  }
  return [];
}

export async function exposure(
  stages: StageOut[],
  samples: SampleOut[],
  windows: ExposureWindowInput[]
): Promise<ExposureResponse> {
  // 阶段与采样来自该次裁决响应，原样回传（整数秒保持十进制字符串）；
  // 服务端负责校验并复核（服务端为唯一权威）。
  const body = {
    stages: stages.map((s) => ({ ...s })),
    samples: samples.map((s) => ({ ...s })),
    exposure: windows.map((w) => ({
      min_exposure: w.min_exposure.trim(),
      max_exposure: w.max_exposure.trim(),
    })),
  };
  let res: Response;
  try {
    res = await fetch("/api/exposure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("无法连接复核服务");
  }
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const err = new ApiError(
      formatDetail(data) || `请求被拒绝（HTTP ${res.status}）`
    );
    err.stageIndices = exposureErrorStageIndices(data);
    throw err;
  }
  return (await res.json()) as ExposureResponse;
}
