import { SampleInput } from "../types";

interface Props {
  samples: SampleInput[];
  onChange: (samples: SampleInput[]) => void;
}

/** 大整数安全的 +step 建议值；无法解析时返回空串由用户填写。 */
function nextInt(raw: string, step: bigint): string {
  try {
    return (BigInt(raw.trim()) + step).toString();
  } catch {
    return "";
  }
}

/** 可编辑的时间-温度采样表。 */
export function SampleTable({ samples, onChange }: Props) {
  const update = (i: number, key: keyof SampleInput, value: string) => {
    const next = samples.slice();
    next[i] = { ...next[i], [key]: value };
    onChange(next);
  };
  const remove = (i: number) => onChange(samples.filter((_, j) => j !== i));
  const add = () => {
    const last = samples[samples.length - 1];
    onChange([
      ...samples,
      { time: last ? nextInt(last.time, 600n) : "0", temp: "" },
    ]);
  };

  return (
    <section className="card">
      <h2>时间-温度采样</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>时间(s)</th>
            <th>温度(°C)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input
                  data-testid={`sample-${i}-time`}
                  value={s.time}
                  onChange={(e) => update(i, "time", e.target.value)}
                />
              </td>
              <td>
                <input
                  data-testid={`sample-${i}-temp`}
                  value={s.temp}
                  onChange={(e) => update(i, "temp", e.target.value)}
                />
              </td>
              <td>
                <button
                  type="button"
                  data-testid={`sample-remove-${i}`}
                  onClick={() => remove(i)}
                  disabled={samples.length <= 2}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" data-testid="add-sample" onClick={add}>
        添加采样
      </button>
    </section>
  );
}
