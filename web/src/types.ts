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

export interface StageOut {
  start: number;
  end: number;
  min_temp: string;
  max_temp: string;
  max_heat_rate: string;
  max_cool_rate: string;
}

export interface SampleOut {
  time: number;
  temp: string;
}

export interface TemperatureViolation {
  type: "temperature";
  time: number;
  temperature: string;
  min_temp: string;
  max_temp: string;
  stage_index: number;
}

export interface RateViolation {
  type: "rate";
  start_time: number;
  end_time: number;
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
