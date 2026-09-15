import { useState } from "react";
import { adjudicate, ApiError, exposure } from "./api";
import { ConclusionBanner } from "./components/ConclusionBanner";
import { CurveChart } from "./components/CurveChart";
import { ExposurePanel } from "./components/ExposurePanel";
import { SampleTable } from "./components/SampleTable";
import { StageTable } from "./components/StageTable";
import { ViolationList } from "./components/ViolationList";
import { defaultSamples, defaultStages } from "./defaults";
import {
  AdjudicationResult,
  ExposureResult,
  ExposureWindowInput,
  SampleInput,
  StageInput,
} from "./types";

export default function App() {
  const [stages, setStages] = useState<StageInput[]>(defaultStages);
  const [samples, setSamples] = useState<SampleInput[]>(defaultSamples);
  const [result, setResult] = useState<AdjudicationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exposureWindows, setExposureWindows] = useState<ExposureWindowInput[]>([]);
  const [exposureReport, setExposureReport] = useState<ExposureResult[] | null>(null);
  const [exposureError, setExposureError] = useState<string | null>(null);
  const [exposureErrorStages, setExposureErrorStages] = useState<ReadonlySet<number>>(
    new Set()
  );
  const [exposureLoading, setExposureLoading] = useState(false);

  const clearExposure = () => {
    setExposureReport(null);
    setExposureError(null);
    setExposureErrorStages(new Set());
  };

  const runAdjudication = async () => {
    setLoading(true);
    try {
      const r = await adjudicate(stages, samples);
      // 折线、结论、下载 JSON 均来自该同次响应
      setResult(r);
      setError(null);
      // 新一次裁决：按回传阶段重置暴露窗口，清除旧暴露报告
      setExposureWindows(
        r.stages.map(() => ({ min_exposure: "", max_exposure: "" }))
      );
      clearExposure();
    } catch (e) {
      // 任何输入错误都拒绝裁决并清除旧结果
      setResult(null);
      setError(e instanceof ApiError ? e.message : "复核请求失败");
      clearExposure();
    } finally {
      setLoading(false);
    }
  };

  const runExposure = async () => {
    if (!result) return;
    setExposureLoading(true);
    try {
      // 阶段与采样取自该次裁决响应，与放行/返烧结论相互独立
      const r = await exposure(result.stages, result.samples, exposureWindows);
      setExposureReport(r.results);
      setExposureError(null);
      setExposureErrorStages(new Set());
    } catch (e) {
      // 清除旧暴露报告并定位相应阶段
      setExposureReport(null);
      setExposureError(e instanceof ApiError ? e.message : "热暴露复核请求失败");
      setExposureErrorStages(
        new Set(e instanceof ApiError ? e.stageIndices : [])
      );
    } finally {
      setExposureLoading(false);
    }
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "adjudication-result.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <header>
        <h1>窑温曲线复核台</h1>
        <p>试烧完成后，复核窑温曲线是否遵守连续工艺阶段，给出唯一放行/返烧结论。</p>
      </header>

      <StageTable stages={stages} onChange={setStages} />
      <SampleTable samples={samples} onChange={setSamples} />

      <div className="actions">
        <button
          type="button"
          data-testid="adjudicate-button"
          className="primary"
          onClick={runAdjudication}
          disabled={loading}
        >
          {loading ? "复核中…" : "复核"}
        </button>
        <button
          type="button"
          data-testid="reset-button"
          onClick={() => {
            setStages(defaultStages);
            setSamples(defaultSamples);
          }}
        >
          重置默认
        </button>
      </div>

      {error && (
        <div data-testid="error-banner" className="error-banner" role="alert">
          输入错误，已拒绝裁决：{error}
        </div>
      )}

      {result && (
        <>
          <ConclusionBanner
            conclusion={result.conclusion}
            violationCount={result.violations.length}
          />
          <section className="card">
            <h2>窑温曲线</h2>
            <CurveChart
              stages={result.stages}
              samples={result.samples}
              violations={result.violations}
            />
          </section>
          <ViolationList violations={result.violations} />
          <ExposurePanel
            stages={result.stages}
            windows={exposureWindows}
            report={exposureReport}
            error={exposureError}
            errorStages={exposureErrorStages}
            loading={exposureLoading}
            onWindowChange={(i, key, value) => {
              const next = exposureWindows.slice();
              next[i] = { ...next[i], [key]: value };
              setExposureWindows(next);
            }}
            onSubmit={runExposure}
          />
          <div className="actions">
            <button type="button" data-testid="download-json" onClick={downloadJson}>
              下载 JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}
