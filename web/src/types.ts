export interface StageInput {
  start: string;
  end: string;
  min_temp: string;
  max_temp: string;
  max_heat_rate: string;
  max_cool_rate: string;
}

export interface SampleInput {
  time: string;
  temp: string;
}

/** 响应中的整数秒字段为十进制字符串：任意大整数都不丢精度。 */
export interface StageOut {
  start: string;
  end: string;
  min_temp: string;
  max_temp: string;
  max_heat_rate: string;
  max_cool_rate: string;
}

export interface SampleOut {
  time: string;
  temp: string;
}

export interface TemperatureViolation {
  type: "temperature";
  time: string;
  temperature: string;
  min_temp: string;
  max_temp: string;
  stage_index: number;
}

export interface RateViolation {
  type: "rate";
  start_time: string;
  end_time: string;
  direction: "heating" | "cooling";
  measured: string;
  limit: string;
  stage_index: number;
}

export type Violation = TemperatureViolation | RateViolation;

export type Conclusion = "放行" | "返烧";

/** 一次裁决的完整响应：折线、结论与下载 JSON 均取自该对象。 */
export interface AdjudicationResult {
  conclusion: Conclusion;
  violations: Violation[];
  stages: StageOut[];
  samples: SampleOut[];
}

/** 每段允许热暴露窗口的输入（°C·min）。 */
export interface ExposureWindowInput {
  min_exposure: string;
  max_exposure: string;
}

export type ExposureStatus = "不足" | "合格" | "过量";

/** 一段的热暴露复核结果（与放行/返烧结论相互独立）。 */
export interface ExposureResult {
  stage_index: number;
  /** 精确热暴露量（°C·min）：“分子/分母”最简分数 */
  exposure: string;
  /** 四舍五入六位小数的展示值 */
  exposure_display: string;
  min_exposure: string;
  max_exposure: string;
  status: ExposureStatus;
}

export interface ExposureResponse {
  results: ExposureResult[];
}
