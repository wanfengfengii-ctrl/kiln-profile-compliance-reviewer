import {
  ExposureResult,
  ExposureStatus,
  ExposureWindowInput,
  StageOut,
} from "../types";

interface Props {
  stages: StageOut[];
  windows: ExposureWindowInput[];
  report: ExposureResult[] | null;
  error: string | null;
  errorStages: ReadonlySet<number>;
  loading: boolean;
  onWindowChange: (
    index: number,
    key: keyof ExposureWindowInput,
    value: string
  ) => void;
  onSubmit: () => void;
}

const STATUS_CLASS: Record<ExposureStatus, string> = {
  不足: "exposure-below",
  合格: "exposure-ok",
  过量: "exposure-above",
};

/**
 * 热暴露复核：在裁决结果区为每段填写最低、最高允许热暴露量并复核。
 * 阶段与采样取自该次裁决响应；复核结论独立于放行/返烧结论。
 * 窗口输入错误时清除旧报告，并按阶段位置定位（高亮）相应行。
 */
export function ExposurePanel({
  stages,
  windows,
  report,
  error,
  errorStages,
  loading,
  onWindowChange,
  onSubmit,
}: Props) {
  return (
    <section className="card">
      <h2>热暴露复核（°C·min）</h2>
      <p className="hint">
        仅累计曲线高于各段最低温度的面积；复核结果独立于上方放行/返烧结论。
      </p>
      <table>
        <thead>
          <tr>
            <th>阶段</th>
            <th>区间(s)</th>
            <th>最低允许热暴露量</th>
            <th>最高允许热暴露量</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <tr
              key={i}
              data-testid={`exposure-row-${i}`}
              className={errorStages.has(i) ? "exposure-row-error" : undefined}
            >
              <td>{i + 1}</td>
              <td>
                {s.start} ~ {s.end}
              </td>
              <td>
                <input
                  data-testid={`exposure-min-${i}`}
                  value={windows[i]?.min_exposure ?? ""}
                  onChange={(e) => onWindowChange(i, "min_exposure", e.target.value)}
                />
              </td>
              <td>
                <input
                  data-testid={`exposure-max-${i}`}
                  value={windows[i]?.max_exposure ?? ""}
                  onChange={(e) => onWindowChange(i, "max_exposure", e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button
          type="button"
          data-testid="exposure-button"
          className="primary"
          onClick={onSubmit}
          disabled={loading}
        >
          {loading ? "复核中…" : "复核热暴露"}
        </button>
      </div>

      {error && (
        <div
          data-testid="exposure-error-banner"
          className="error-banner"
          role="alert"
        >
          热暴露窗口输入错误，已拒绝复核：{error}
        </div>
      )}

      {report && (
        <table data-testid="exposure-report">
          <thead>
            <tr>
              <th>阶段</th>
              <th>热暴露精确值（°C·min）</th>
              <th>展示值（六位）</th>
              <th>允许窗口</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {report.map((r) => (
              <tr key={r.stage_index} data-testid={`exposure-result-${r.stage_index}`}>
                <td>{r.stage_index + 1}</td>
                <td data-testid={`exposure-fraction-${r.stage_index}`}>
                  {r.exposure}
                </td>
                <td data-testid={`exposure-display-${r.stage_index}`}>
                  {r.exposure_display}
                </td>
                <td>
                  [{r.min_exposure}, {r.max_exposure}]
                </td>
                <td
                  data-testid={`exposure-status-${r.stage_index}`}
                  className={STATUS_CLASS[r.status]}
                >
                  {r.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
