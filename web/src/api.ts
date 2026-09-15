import { AdjudicationResult, SampleInput, StageInput } from "./types";

export class ApiError extends Error {}

/**
 * 整数秒字段：可解析为整数字面量则发送 number，
 * 否则原样发送，由服务端校验并拒绝（服务端为唯一权威）。
 */
export function parseIntField(raw: string): number | string {
  const t = raw.trim();
  if (/^[+-]?\d+$/.test(t)) return Number(t);
  return t;
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
  const body = {
    stages: stages.map((s) => ({
      start: parseIntField(s.start),
      end: parseIntField(s.end),
      min_temp: s.min_temp.trim(),
      max_temp: s.max_temp.trim(),
      max_heat_rate: s.max_heat_rate.trim(),
      max_cool_rate: s.max_cool_rate.trim(),
    })),
    samples: samples.map((s) => ({
      time: parseIntField(s.time),
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
