"""请求数据的严格校验模型。

任何输入错误都会在这里被拒绝（HTTP 422），裁决不会执行：
- 阶段时间为非负整数秒，必须 start < end，阶段首尾相接；
- 温度为有限十进制数（允许负值），最低温度不得高于最高温度；
- 最大升温、降温速率为有限非负十进制数；
- 采样时间为非负整数秒、严格递增、不得越出阶段总范围，并覆盖首末端点；
- 采样温度为有限十进制数；
- 热暴露上下限为有限非负十进制数，且下限不高于上限。
"""
from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation
from typing import Any, List

from pydantic import BaseModel, Field
from pydantic import field_validator, model_validator

_INT_SECONDS_RE = re.compile(r"[+-]?\d+")


def to_non_neg_int_seconds(value: Any) -> int:
    """非负整数秒：接受 JSON 整数或十进制整数字符串。

    字符串形式可无损承载超出 IEEE 754 安全整数范围的秒数（前端不经
    Number() 转换，原样透传），拒绝布尔、浮点与非整数字符串。
    """
    if isinstance(value, bool):
        raise ValueError("必须是非负整数秒，不能是布尔值")
    if isinstance(value, int):
        n = value
    elif isinstance(value, str):
        t = value.strip()
        if not _INT_SECONDS_RE.fullmatch(t):
            raise ValueError(f"必须是非负整数秒，收到: {value!r}")
        n = int(t)
    else:
        raise ValueError(f"必须是非负整数秒，收到类型: {type(value).__name__}")
    if n < 0:
        raise ValueError(f"必须是非负整数秒，收到: {n}")
    return n


def to_finite_decimal(value: Any) -> Decimal:
    """把输入转换为有限十进制数，拒绝布尔、非数字、NaN 与无穷。"""
    if isinstance(value, bool):
        raise ValueError("必须是有限十进制数，不能是布尔值")
    if isinstance(value, Decimal):
        d = value
    elif isinstance(value, int):
        d = Decimal(value)
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("必须是有限十进制数，不能是 NaN 或无穷")
        d = Decimal(str(value))
    elif isinstance(value, str):
        try:
            d = Decimal(value.strip())
        except InvalidOperation:
            raise ValueError(f"必须是有限十进制数，收到: {value!r}")
    else:
        raise ValueError(f"必须是有限十进制数，收到类型: {type(value).__name__}")
    if not d.is_finite():
        raise ValueError("必须是有限十进制数，不能是 NaN 或无穷")
    return d


class StageIn(BaseModel):
    """一个连续工艺阶段：[start, end)，仅末阶段额外包含 end。"""

    start: int
    end: int
    min_temp: Decimal
    max_temp: Decimal
    max_heat_rate: Decimal
    max_cool_rate: Decimal

    _int_seconds = field_validator("start", "end", mode="before")(
        to_non_neg_int_seconds
    )
    _decimals = field_validator(
        "min_temp", "max_temp", "max_heat_rate", "max_cool_rate", mode="before"
    )(to_finite_decimal)

    @model_validator(mode="after")
    def check_stage(self) -> "StageIn":
        if self.start >= self.end:
            raise ValueError(
                f"阶段必须满足 start < end，收到 start={self.start}, end={self.end}"
            )
        if self.min_temp > self.max_temp:
            raise ValueError(
                f"最低温度不得高于最高温度：{self.min_temp} > {self.max_temp}"
            )
        if self.max_heat_rate < 0 or self.max_cool_rate < 0:
            raise ValueError("最大升温、降温速率须为有限非负十进制数")
        return self


class SampleIn(BaseModel):
    """一个时间-温度采样点。"""

    time: int
    temp: Decimal

    _int_seconds = field_validator("time", mode="before")(to_non_neg_int_seconds)
    _decimals = field_validator("temp", mode="before")(to_finite_decimal)


def check_stages_samples(stages: List[StageIn], samples: List[SampleIn]) -> None:
    """阶段与采样的整体一致性校验（/api/adjudicate 与 /api/exposure 共用）。"""
    for prev, cur in zip(stages, stages[1:]):
        if prev.end != cur.start:
            raise ValueError(
                f"阶段必须首尾相接：上一阶段 end={prev.end}，下一阶段 start={cur.start}"
            )
    lo, hi = stages[0].start, stages[-1].end
    times = [s.time for s in samples]
    for a, b in zip(times, times[1:]):
        if b <= a:
            raise ValueError(f"采样时间必须严格递增：{a} 之后出现 {b}")
    if times[0] != lo or times[-1] != hi:
        raise ValueError(
            f"采样必须覆盖首末端点：首采样时间={times[0]}（应={lo}），"
            f"末采样时间={times[-1]}（应={hi}）"
        )
    for t in times:
        if t < lo or t > hi:
            raise ValueError(f"采样时间 {t} 越出阶段总范围 [{lo}, {hi}]")


def to_non_neg_finite_decimal(value: Any) -> Decimal:
    """有限非负十进制数（热暴露上下限用）。"""
    d = to_finite_decimal(value)
    if d < 0:
        raise ValueError(f"必须是有限非负十进制数，收到: {format(d, 'f')}")
    return d


class AdjudicateRequest(BaseModel):
    stages: List[StageIn] = Field(min_length=1)
    samples: List[SampleIn] = Field(min_length=2)

    @model_validator(mode="after")
    def check_request(self) -> "AdjudicateRequest":
        check_stages_samples(self.stages, self.samples)
        return self


class ExposureWindowIn(BaseModel):
    """一个阶段的允许热暴露窗口（°C·min）：有限非负，下限不高于上限。"""

    min_exposure: Decimal
    max_exposure: Decimal

    _decimals = field_validator("min_exposure", "max_exposure", mode="before")(
        to_non_neg_finite_decimal
    )

    @model_validator(mode="after")
    def check_window(self) -> "ExposureWindowIn":
        if self.min_exposure > self.max_exposure:
            raise ValueError(
                "最低允许热暴露量不得高于最高允许热暴露量："
                f"{format(self.min_exposure, 'f')} > {format(self.max_exposure, 'f')}"
            )
        return self


class ExposureRequest(BaseModel):
    """热暴露复核请求：阶段与采样同 /api/adjudicate，另加每段暴露窗口。

    窗口数量必须与阶段数一致；多个窗口的输入错误按阶段输入位置稳定
    返回全部明细（loc 含 exposure 列表下标）。
    """

    stages: List[StageIn] = Field(min_length=1)
    samples: List[SampleIn] = Field(min_length=2)
    exposure: List[ExposureWindowIn] = Field(min_length=1)

    @model_validator(mode="after")
    def check_request(self) -> "ExposureRequest":
        check_stages_samples(self.stages, self.samples)
        if len(self.exposure) != len(self.stages):
            raise ValueError(
                f"暴露窗口数量必须与阶段数一致：收到 {len(self.exposure)} 个窗口、"
                f"{len(self.stages)} 个阶段"
            )
        return self
