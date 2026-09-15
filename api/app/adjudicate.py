"""裁决逻辑：温度违规与速率违规，全部使用十进制精确计算。

规则要点：
- 阶段区间为 [start, end)，仅末阶段包含 end；
- 各阶段温度上下限均包含边界；
- 速率 = 相邻采样“温差 × 60 ÷ 秒差”（°C/min），仅当两个端点属于同一阶段时
  检查，等于限制合规，跨阶段不检查；
- 返回顺序：先按采样时间升序的温度违规，再按后一端点时间升序的速率违规；
- 唯一结论：无违规为“放行”，否则为“返烧”。
"""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, List, Sequence

from .schemas import SampleIn, StageIn

RELEASE = "放行"
REFIRE = "返烧"


def dec_str(d: Decimal) -> str:
    """十进制数的确定字符串表示（不使用科学计数法，保留完整精度）。"""
    return format(d, "f")


def stage_index_for_time(t: int, stages: Sequence[StageIn]) -> int:
    """时间 t 所属阶段下标：[start, end)，仅末阶段包含 end。"""
    last = len(stages) - 1
    for i, s in enumerate(stages):
        if s.start <= t and (t < s.end or (i == last and t == s.end)):
            return i
    raise ValueError(f"采样时间 {t} 不在任何阶段内")  # 请求校验通过后不会触发


def adjudicate(stages: Sequence[StageIn], samples: Sequence[SampleIn]) -> Dict:
    """返回 {"conclusion": ..., "violations": [...]}。"""
    temp_violations: List[Dict] = []
    for s in samples:
        i = stage_index_for_time(s.time, stages)
        st = stages[i]
        if s.temp < st.min_temp or s.temp > st.max_temp:
            temp_violations.append(
                {
                    "type": "temperature",
                    "time": s.time,
                    "temperature": dec_str(s.temp),
                    "min_temp": dec_str(st.min_temp),
                    "max_temp": dec_str(st.max_temp),
                    "stage_index": i,
                }
            )

    rate_violations: List[Dict] = []
    for a, b in zip(samples, samples[1:]):
        i = stage_index_for_time(a.time, stages)
        if i != stage_index_for_time(b.time, stages):
            continue  # 跨阶段不检查
        st = stages[i]
        seconds = Decimal(b.time - a.time)
        if b.temp > a.temp:
            rate = (b.temp - a.temp) * 60 / seconds
            if rate > st.max_heat_rate:  # 等于限制合规
                rate_violations.append(
                    {
                        "type": "rate",
                        "start_time": a.time,
                        "end_time": b.time,
                        "direction": "heating",
                        "measured": dec_str(rate),
                        "limit": dec_str(st.max_heat_rate),
                        "stage_index": i,
                    }
                )
        elif b.temp < a.temp:
            rate = (a.temp - b.temp) * 60 / seconds
            if rate > st.max_cool_rate:  # 等于限制合规
                rate_violations.append(
                    {
                        "type": "rate",
                        "start_time": a.time,
                        "end_time": b.time,
                        "direction": "cooling",
                        "measured": dec_str(rate),
                        "limit": dec_str(st.max_cool_rate),
                        "stage_index": i,
                    }
                )

    violations = temp_violations + rate_violations
    return {
        "conclusion": RELEASE if not violations else REFIRE,
        "violations": violations,
    }
