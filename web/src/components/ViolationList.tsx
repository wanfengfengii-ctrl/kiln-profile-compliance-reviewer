import { Violation } from "../types";

export function describeViolation(v: Violation): string {
  if (v.type === "temperature") {
    return (
      `温度违规 · ${v.time}s：实测 ${v.temperature}°C，` +
      `超出阶段 ${v.stage_index + 1} 允许范围 [${v.min_temp}, ${v.max_temp}]°C（含边界）`
    );
  }
  const kind = v.direction === "heating" ? "升温" : "降温";
  return (
    `速率违规 · ${v.start_time}s → ${v.end_time}s：${kind}速率实测 ` +
    `${v.measured}°C/min，超过阶段 ${v.stage_index + 1} 限制 ${v.limit}°C/min`
  );
}

/** 违规定位列表：先温度违规（按采样时间），再速率违规（按后一端点时间）。 */
export function ViolationList({ violations }: { violations: Violation[] }) {
  if (violations.length === 0) {
    return (
      <section className="card">
        <h2>违规定位</h2>
        <p data-testid="no-violations">未发现违规：温度与升降温速率均符合连续工艺阶段要求。</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>违规定位（{violations.length} 项）</h2>
      <ol data-testid="violation-list" className="violation-list">
        {violations.map((v, i) => (
          <li key={i} className={`violation-${v.type}`}>
            {describeViolation(v)}
          </li>
        ))}
      </ol>
    </section>
  );
}
