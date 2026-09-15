import { useRef, useState } from "react";
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
  const [exposureErrorKind, setExposureErrorKind] = useState<"input" | "failure">(
    "input"
  );
  const [exposureErrorStages, setExposureErrorStages] = useState<ReadonlySet<number>>(
    new Set()
  );
  const [exposureLoading, setExposureLoading] = useState(false);
  // 热暴露复核序号：重新裁决开始与完成（成功或失败）都会作废旧曲线的
  // 在途复核，迟到的响应被丢弃，不得覆盖新结果区
  const exposureSeq = useRef(0);

  const clearExposure = () => {
    // 作废旧曲线的在途热暴露复核：其迟到响应不得进入新结果区
    exposureSeq.current += 1;
    setExposureReport(null);
    setExposureError(null);
    setExposureErrorStages(new Set());
    setExposureLoading(false);
  };

  const runAdjudication = async () => {
    // 作废旧曲线的在途热暴露复核，其迟到响应不得覆盖新结果区
    exposureSeq.current += 1;
    setExposureLoading(false);
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
    const seq = ++exposureSeq.current;
    setExposureLoading(true);
    try {
      // 阶段与采样取自该次裁决响应，与放行/返烧结论相互独立
      const r = await exposure(result.stages, result.samples, exposureWindows);
      if (seq !== exposureSeq.current) return; // 已有新裁决/新复核，丢弃旧报告
      setExposureReport(r.results);
      setExposureError(null);
      setExposureErrorStages(new Set());
    } catch (e) {
      if (seq !== exposureSeq.current) return; // 迟到的旧错误同样丢弃
      // 清除旧暴露报告并定位相应阶段
      setExposureReport(null);
      const isInput = e instanceof ApiError && e.isInputError;
      setExposureErrorKind(isInput ? "input" : "failure");
      setExposureError(e instanceof ApiError ? e.message : "请求失败");
      setExposureErrorStages(
        new Set(e instanceof ApiError ? e.stageIndices : [])
      );
    } finally {
      if (seq === exposureSeq.current) setExposureLoading(false);
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
            errorKind={exposureErrorKind}
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
