import { Conclusion } from "../types";

interface Props {
  conclusion: Conclusion;
  violationCount: number;
}

/** 唯一结论横幅：放行 或 返烧。 */
export function ConclusionBanner({ conclusion, violationCount }: Props) {
  const ok = conclusion === "放行";
  return (
    <div data-testid="conclusion-banner" className={`conclusion ${ok ? "ok" : "bad"}`}>
      <span className="conclusion-text">结论：{conclusion}</span>
      <span className="conclusion-sub">
        {ok ? "窑温曲线符合全部连续工艺阶段要求" : `发现 ${violationCount} 项违规，需返烧`}
      </span>
    </div>
  );
}
