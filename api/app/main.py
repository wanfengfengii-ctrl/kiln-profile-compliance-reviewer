"""窑温曲线复核 API。"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .adjudicate import adjudicate, dec_str
from .exposure import review_exposures
from .schemas import AdjudicateRequest, ExposureRequest

app = FastAPI(title="窑温曲线复核 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/adjudicate")
def adjudicate_endpoint(req: AdjudicateRequest) -> dict:
    """复核窑温曲线。

    输入错误由请求模型拒绝（HTTP 422），不产生裁决结果；成功时返回唯一结论、
    有序违规列表以及本次裁决所用的阶段与采样数据，前端折线、结论与下载 JSON
    均取自该同次响应。
    """
    result = adjudicate(req.stages, req.samples)
    return {
        "conclusion": result["conclusion"],
        "violations": result["violations"],
        "stages": [
            {
                "start": str(s.start),
                "end": str(s.end),
                "min_temp": dec_str(s.min_temp),
                "max_temp": dec_str(s.max_temp),
                "max_heat_rate": dec_str(s.max_heat_rate),
                "max_cool_rate": dec_str(s.max_cool_rate),
            }
            for s in req.stages
        ],
        # 整数秒以十进制字符串返回，超出 IEEE 754 安全整数范围也不丢精度
        "samples": [{"time": str(s.time), "temp": dec_str(s.temp)} for s in req.samples],
    }


@app.post("/api/exposure")
def exposure_endpoint(req: ExposureRequest) -> dict:
    """复核每段热暴露是否落在允许窗口内（与放行/返烧结论相互独立）。

    以该次裁决回传的阶段和采样构造分段线性温度曲线，跨阶段线段在边界
    插值切开，曲线穿越该阶段最低温度时再次切分，仅对高于最低温度的
    面积按梯形积分累加并换算为 °C·min；先以精确值比较窗口，再按阶段
    顺序返回最简分数、四舍五入六位的展示值与不足/合格/过量状态。
    输入错误由请求模型拒绝（HTTP 422），多段窗口错误按阶段输入位置
    稳定返回全部明细。
    """
    return {"results": review_exposures(req.stages, req.samples, req.exposure)}
