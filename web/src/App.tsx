import { useState } from "react";
import { adjudicate, ApiError } from "./api";
import { ConclusionBanner } from "./components/ConclusionBanner";
import { CurveChart } from "./components/CurveChart";
import { SampleTable } from "./components/SampleTable";
import { StageTable } from "./components/StageTable";
import { ViolationList } from "./components/ViolationList";
import { defaultSamples, defaultStages } from "./defaults";
import { AdjudicationResult, SampleInput, StageInput } from "./types";

export default function App() {
  const [stages, setStages] = useState<StageInput[]>(defaultStages);
  const [samples, setSamples] = useState<SampleInput[]>(defaultSamples);
  const [result, setResult] = useState<AdjudicationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runAdjudication = async () => {
    setLoading(true);
    try {
      const r = await adjudicate(stages, samples);
      // 折线、结论、下载 JSON 均来自该同次响应
      setResult(r);
      setError(null);
    } catch (e) {
      // 任何输入错误都拒绝裁决并清除旧结果
      setResult(null);
      setError(e instanceof ApiError ? e.message : "复核请求失败");
    } finally {
      setLoading(false);
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
