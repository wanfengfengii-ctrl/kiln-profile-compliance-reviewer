"""热暴露复核：分段线性温度曲线上高于阶段最低温度的面积积分。

计算规则：
- 以该次裁决回传的阶段与采样构造分段线性温度曲线；
- 跨阶段线段在阶段边界处插值切开；
- 曲线穿越该阶段最低温度时再次切分；
- 仅对高于最低温度的部分按梯形积分累加（°C·s），再换算为 °C·min；
- 全程由十进制转有理数精确运算，与窗口的比较也用精确值；
- 等于上下限判为合格。
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, localcontext
from fractions import Fraction
from typing import List, Sequence, Tuple

from .adjudicate import dec_str
from .schemas import ExposureWindowIn, SampleIn, StageIn

SECONDS_PER_MINUTE = 60
# 展示值四舍五入到六位小数
DISPLAY_QUANTUM = Decimal("0.000001")

BELOW = "不足"
OK = "合格"
ABOVE = "过量"

# 分段线性曲线上的点：(时刻秒, 温度)，均为有理数精确值
Point = Tuple[Fraction, Fraction]


def curve_points(samples: Sequence[SampleIn]) -> List[Point]:
    """采样点转为 (秒, 温度) 有理数点列（十进制到有理数为精确转换）。"""
    return [(Fraction(s.time), Fraction(s.temp)) for s in samples]


def interp(points: Sequence[Point], t: Fraction) -> Fraction:
    """分段线性曲线上时刻 t 的温度（t 必在采样总范围内）。"""
    for (t1, temp1), (t2, temp2) in zip(points, points[1:]):
        if t1 <= t <= t2:
            return temp1 + (temp2 - temp1) * (t - t1) / (t2 - t1)
    raise ValueError(f"时刻 {t} 越出采样范围")  # 请求校验通过后不会触发


def stage_exposure(
    points: Sequence[Point], start: int, end: int, min_temp: Decimal
) -> Fraction:
    """[start, end] 上 max(T - min_temp, 0) 的精确积分，单位 °C·min。"""
    m = Fraction(min_temp)
    lo, hi = Fraction(start), Fraction(end)
    # 跨阶段线段在边界插值切开：取出该阶段内的折线
    seg: List[Point] = [(lo, interp(points, lo))]
    seg.extend((t, temp) for t, temp in points if lo < t < hi)
    seg.append((hi, interp(points, hi)))

    area = Fraction(0)  # °C·s
    for (t1, temp1), (t2, temp2) in zip(seg, seg[1:]):
        e1, e2 = temp1 - m, temp2 - m
        if e1 * e2 < 0:
            # 曲线穿越最低温度：在穿越点再次切分，只累计高于最低温度的部分
            t_cross = t1 + (t2 - t1) * e1 / (e1 - e2)
            area += max(e1, Fraction(0)) * (t_cross - t1) / 2
            area += max(e2, Fraction(0)) * (t2 - t_cross) / 2
        else:
            # 不穿越时超出量线性不变号，梯形积分即精确值
            area += (max(e1, Fraction(0)) + max(e2, Fraction(0))) * (t2 - t1) / 2
    return area / SECONDS_PER_MINUTE


def fraction_str(value: Fraction) -> str:
    """最简分数的“分子/分母”字符串（Fraction 构造时自动约分）。"""
    return f"{value.numerator}/{value.denominator}"


def display_str(value: Fraction) -> str:
    """四舍五入到六位小数的展示值（不丢大整数部分的精度）。"""
    # 商的整数部分至多 len(numerator) 位，再留 8 位余量覆盖六位小数与进位
    with localcontext() as ctx:
        ctx.prec = len(str(abs(value.numerator))) + 8
        d = Decimal(value.numerator) / Decimal(value.denominator)
        return format(d.quantize(DISPLAY_QUANTUM, rounding=ROUND_HALF_UP), "f")


def review_exposures(
    stages: Sequence[StageIn],
    samples: Sequence[SampleIn],
    windows: Sequence[ExposureWindowIn],
) -> List[dict]:
    """按阶段顺序返回每段的热暴露复核结果。"""
    points = curve_points(samples)
    results: List[dict] = []
    for i, (stage, window) in enumerate(zip(stages, windows)):
        value = stage_exposure(points, stage.start, stage.end, stage.min_temp)
        # 先以精确值比较窗口，等于上下限判为合格
        if value < Fraction(window.min_exposure):
            status = BELOW
        elif value > Fraction(window.max_exposure):
            status = ABOVE
        else:
            status = OK
        results.append(
            {
                "stage_index": i,
                "exposure": fraction_str(value),
                "exposure_display": display_str(value),
                "min_exposure": dec_str(window.min_exposure),
                "max_exposure": dec_str(window.max_exposure),
                "status": status,
            }
        )
    return results
