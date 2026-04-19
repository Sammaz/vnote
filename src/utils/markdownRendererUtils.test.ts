import { describe, it, expect } from "vitest";
import { parseEvidenceRanks } from "./markdownRendererUtils";

describe("parseEvidenceRanks", () => {
  it("解析单个证据编号", () => {
    expect(parseEvidenceRanks("[证据1]")).toEqual([1]);
    expect(parseEvidenceRanks("[证据 2]")).toEqual([2]);
  });

  it("解析带半角逗号的多个编号", () => {
    expect(parseEvidenceRanks("[证据1,2]")).toEqual([1, 2]);
    expect(parseEvidenceRanks("[证据1, 3]")).toEqual([1, 3]);
  });

  it("解析带全角逗号的多个编号", () => {
    expect(parseEvidenceRanks("[证据1，2，3]")).toEqual([1, 2, 3]);
  });

  it("解析带顿号的多个编号", () => {
    expect(parseEvidenceRanks("[证据1、2]")).toEqual([1, 2]);
  });

  it("忽略非数字和零", () => {
    expect(parseEvidenceRanks("[证据1,,2]")).toEqual([1, 2]);
    expect(parseEvidenceRanks("[证据0]")).toEqual([]);
  });
});
