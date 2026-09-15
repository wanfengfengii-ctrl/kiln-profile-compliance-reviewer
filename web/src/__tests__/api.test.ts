import { describe, expect, it } from "vitest";
import { formatDetail } from "../api";

describe("formatDetail", () => {
  it("处理字符串 detail", () => {
    expect(formatDetail({ detail: "出错了" })).toBe("出错了");
  });

  it("处理 FastAPI 422 的数组 detail 并拼接定位", () => {
    const text = formatDetail({
      detail: [
        { loc: ["body", "stages", 0, "start"], msg: "阶段必须满足 start < end" },
        { loc: ["body"], msg: "整体错误" },
      ],
    });
    expect(text).toBe("stages.0.start: 阶段必须满足 start < end；整体错误");
  });

  it("未知结构返回默认文案", () => {
    expect(formatDetail(null)).toBe("请求失败");
    expect(formatDetail({})).toBe("请求失败");
  });
});
