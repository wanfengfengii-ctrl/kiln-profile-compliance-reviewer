import { SampleInput, StageInput } from "./types";

/** 默认演示数据：一条三段连续工艺与合规采样曲线。 */
export const defaultStages: StageInput[] = [
  { start: "0", end: "3600", min_temp: "15", max_temp: "260", max_heat_rate: "4.0", max_cool_rate: "2.0" },
  { start: "3600", end: "10800", min_temp: "250", max_temp: "950", max_heat_rate: "5.0", max_cool_rate: "2.0" },
  { start: "10800", end: "12600", min_temp: "850", max_temp: "950", max_heat_rate: "1.0", max_cool_rate: "1.0" },
];

export const defaultSamples: SampleInput[] = [
  { time: "0", temp: "20" },
  { time: "1200", temp: "100" },
  { time: "2400", temp: "180" },
  { time: "3600", temp: "260" },
  { time: "4800", temp: "360" },
  { time: "6000", temp: "460" },
  { time: "7200", temp: "560" },
  { time: "8400", temp: "660" },
  { time: "9600", temp: "760" },
  { time: "10800", temp: "860" },
  { time: "11400", temp: "870" },
  { time: "12600", temp: "880" },
];
