import { describe, expect, it } from "vitest";
import { extractModelSupplements } from "./knowledgeSupplements";

describe("extractModelSupplements", () => {
  it("returns empty when there is no marker", () => {
    expect(extractModelSupplements("笔记中记录了产品定价。")).toEqual([]);
  });

  it("extracts the sentence before a model supplement marker", () => {
    const content = [
      "知识库证据总结：当前检索为空。",
      "缺口说明：笔记中未提及官网地址。",
      "官方网站是 https://example.com [补充·模型]",
      "建议回笔记补充「联系方式」段落。",
    ].join("\n");

    expect(extractModelSupplements(content)).toEqual([
      { kind: "model", sentence: "官方网站是 https://example.com" },
    ]);
  });

  it("supports bullet lines and multiple markers", () => {
    const content = [
      "- 客服电话是 400-000-0000 [补充·模型]",
      "- 标准版售价 99 元 [补充•模型]",
    ].join("\n");

    expect(extractModelSupplements(content)).toEqual([
      { kind: "model", sentence: "客服电话是 400-000-0000" },
      { kind: "model", sentence: "标准版售价 99 元" },
    ]);
  });

  it("ignores duplicate sentences", () => {
    const content = "定义是一种笔记软件 [补充·模型]\n定义是一种笔记软件 [补充·模型]";
    expect(extractModelSupplements(content)).toEqual([
      { kind: "model", sentence: "定义是一种笔记软件" },
    ]);
  });
});
