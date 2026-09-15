import { RateViolation, SampleOut, StageOut, Violation } from "../types";

interface Props {
  stages: StageOut[];
  samples: SampleOut[];
  violations: Violation[];
}

const W = 920;
const H = 400;
const M = { top: 28, right: 24, bottom: 46, left: 68 };
const TICKS = 6;

/**
 * 窑温曲线 SVG 折线图：阶段温区带、采样折线、温度违规点与速率违规段定位。
 * 数据完全来自同一次裁决响应。
 */
export function CurveChart({ stages, samples, violations }: Props) {
  const points = samples.map((s) => ({ t: s.time, temp: Number(s.temp) }));
  const tempViolationTimes = new Set(
    violations.filter((v) => v.type === "temperature").map((v) => v.time)
  );
  const rateViolations = violations.filter(
    (v): v is RateViolation => v.type === "rate"
  );

  const tMin = stages[0].start;
  const tMax = stages[stages.length - 1].end;
  const temps = [
    ...points.map((p) => p.temp),
    ...stages.flatMap((s) => [Number(s.min_temp), Number(s.max_temp)]),
  ];
  let yLo = Math.min(...temps);
  let yHi = Math.max(...temps);
  if (yHi - yLo < 1e-9) {
    yLo -= 1;
    yHi += 1;
  }
  const pad = (yHi - yLo) * 0.06;
  yLo -= pad;
  yHi += pad;

  const x = (t: number) =>
    M.left + ((t - tMin) / (tMax - tMin)) * (W - M.left - M.right);
  const y = (temp: number) =>
    H - M.bottom - ((temp - yLo) / (yHi - yLo)) * (H - M.top - M.bottom);

  const polyline = points.map((p) => `${x(p.t)},${y(p.temp)}`).join(" ");
  const pointAt = new Map(points.map((p) => [p.t, p]));

  const xTicks = Array.from({ length: TICKS }, (_, i) =>
    Math.round(tMin + ((tMax - tMin) * i) / (TICKS - 1))
  );
  const yTicks = Array.from(
    { length: TICKS },
    (_, i) => yLo + ((yHi - yLo) * i) / (TICKS - 1)
  );

  return (
    <svg
      data-testid="curve-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="窑温曲线"
      className="curve-chart"
    >
      {/* 阶段温区带与分界 */}
      {stages.map((s, i) => (
        <g key={i}>
          <rect
            x={x(s.start)}
            y={y(Number(s.max_temp))}
            width={x(s.end) - x(s.start)}
            height={y(Number(s.min_temp)) - y(Number(s.max_temp))}
            className="stage-band"
          />
          <line
            x1={x(s.start)}
            y1={M.top}
            x2={x(s.start)}
            y2={H - M.bottom}
            className="stage-boundary"
          />
          {i === stages.length - 1 && (
            <line
              x1={x(s.end)}
              y1={M.top}
              x2={x(s.end)}
              y2={H - M.bottom}
              className="stage-boundary"
            />
          )}
          <text
            x={(x(s.start) + x(s.end)) / 2}
            y={M.top - 8}
            textAnchor="middle"
            className="stage-label"
          >
            阶段{i + 1}
          </text>
        </g>
      ))}

      {/* 坐标轴与刻度 */}
      <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} className="axis" />
      <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} className="axis" />
      {xTicks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={H - M.bottom} x2={x(t)} y2={H - M.bottom + 5} className="axis" />
          <text x={x(t)} y={H - M.bottom + 20} textAnchor="middle" className="tick">
            {t}
          </text>
        </g>
      ))}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={M.left - 5} y1={y(t)} x2={M.left} y2={y(t)} className="axis" />
          <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="tick">
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" className="axis-label">
        时间 (s)
      </text>
      <text x={14} y={(M.top + H - M.bottom) / 2} textAnchor="middle" className="axis-label"
        transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`}>
        温度 (°C)
      </text>

      {/* 采样折线 */}
      <polyline points={polyline} className="curve" />

      {/* 速率违规段 */}
      {rateViolations.map((v, i) => {
        const a = pointAt.get(v.start_time);
        const b = pointAt.get(v.end_time);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={x(a.t)}
            y1={y(a.temp)}
            x2={x(b.t)}
            y2={y(b.temp)}
            className="violation-segment"
            data-testid="rate-violation-segment"
          />
        );
      })}

      {/* 采样点（温度违规标红） */}
      {points.map((p) => (
        <circle
          key={p.t}
          cx={x(p.t)}
          cy={y(p.temp)}
          r={4.5}
          className={tempViolationTimes.has(p.t) ? "point violation" : "point"}
          data-testid={`point-${p.t}`}
        >
          <title>{`${p.t}s: ${p.temp}°C`}</title>
        </circle>
      ))}

      {/* 图例 */}
      <g className="legend" transform={`translate(${W - M.right - 190}, ${M.top + 4})`}>
        <line x1={0} y1={0} x2={22} y2={0} className="curve" />
        <text x={28} y={4}>采样曲线</text>
        <line x1={88} y1={0} x2={110} y2={0} className="legend-rate-violation" />
        <text x={116} y={4}>速率违规段</text>
        <circle cx={10} cy={16} r={4.5} className="legend-temp-violation" />
        <text x={28} y={20}>温度违规点</text>
      </g>
    </svg>
  );
}
