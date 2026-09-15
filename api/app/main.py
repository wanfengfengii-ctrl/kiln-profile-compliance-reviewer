"""窑温曲线复核 API。"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .adjudicate import adjudicate, dec_str
from .schemas import AdjudicateRequest

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
                "start": s.start,
                "end": s.end,
                "min_temp": dec_str(s.min_temp),
                "max_temp": dec_str(s.max_temp),
                "max_heat_rate": dec_str(s.max_heat_rate),
                "max_cool_rate": dec_str(s.max_cool_rate),
            }
            for s in req.stages
        ],
        "samples": [{"time": s.time, "temp": dec_str(s.temp)} for s in req.samples],
    }
