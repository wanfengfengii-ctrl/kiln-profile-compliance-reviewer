import { StageInput } from "../types";

const FIELDS: { key: keyof StageInput; label: string }[] = [
  { key: "start", label: "开始(s)" },
  { key: "end", label: "结束(s)" },
  { key: "min_temp", label: "最低温度(°C)" },
  { key: "max_temp", label: "最高温度(°C)" },
  { key: "max_heat_rate", label: "最大升温速率(°C/min)" },
  { key: "max_cool_rate", label: "最大降温速率(°C/min)" },
];

interface Props {
  stages: StageInput[];
  onChange: (stages: StageInput[]) => void;
}

/** 可编辑的连续工艺阶段表。 */
export function StageTable({ stages, onChange }: Props) {
  const update = (i: number, key: keyof StageInput, value: string) => {
    const next = stages.slice();
    next[i] = { ...next[i], [key]: value };
    onChange(next);
  };
  const remove = (i: number) => onChange(stages.filter((_, j) => j !== i));
  const add = () => {
    const last = stages[stages.length - 1];
    const start = last ? last.end : "0";
    const endNum = Number(start);
    onChange([
      ...stages,
      {
        start,
        end: Number.isFinite(endNum) ? String(endNum + 600) : "",
        min_temp: "0",
        max_temp: "1000",
        max_heat_rate: "5.0",
        max_cool_rate: "5.0",
      },
    ]);
  };

  return (
    <section className="card">
      <h2>工艺阶段（[start, end)，仅末阶段含 end）</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            {FIELDS.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {FIELDS.map((f) => (
                <td key={f.key}>
                  <input
                    data-testid={`stage-${i}-${f.key}`}
                    value={s[f.key]}
                    onChange={(e) => update(i, f.key, e.target.value)}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  data-testid={`stage-remove-${i}`}
                  onClick={() => remove(i)}
                  disabled={stages.length <= 1}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" data-testid="add-stage" onClick={add}>
        添加阶段
      </button>
    </section>
  );
}
