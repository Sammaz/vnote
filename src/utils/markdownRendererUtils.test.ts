import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseEvidenceRanks, renderDecoratedReactNode, splitTextByUrls } from "./markdownRendererUtils";

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

describe("timestamp range decoration", () => {
  it("seeks to the start of a clickable timestamp range", () => {
    const dispatchEventSpy = vi.mocked(window.dispatchEvent);
    dispatchEventSpy.mockClear();

    render(React.createElement(
      React.Fragment,
      null,
      renderDecoratedReactNode(
        "(0:01 - 0:15)",
        { enableSeekTimestamps: true, enableTimestampRanges: true },
      ),
    ));

    fireEvent.click(screen.getByRole("button", { name: "(0:01 - 0:15)" }));

    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0]?.[0] as CustomEvent<{ time: number }>;
    expect(event.type).toBe("seek-video");
    expect(event.detail.time).toBe(1);
  });

  it("keeps timestamp ranges non-interactive when seeking is disabled", () => {
    render(React.createElement(
      React.Fragment,
      null,
      renderDecoratedReactNode(
        "(1:02:03 - 1:04:05)",
        { enableSeekTimestamps: false, enableTimestampRanges: true },
      ),
    ));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("(1:02:03 - 1:04:05)")).toHaveClass("timestamp-range");
  });
});

describe("model supplement decoration", () => {
  it("renders model supplement markers as badges", () => {
    render(React.createElement(
      React.Fragment,
      null,
      renderDecoratedReactNode("官方网站是 https://example.com [补充·模型]", {}),
    ));

    expect(screen.getByText("补充·模型")).toBeInTheDocument();
    expect(screen.getByTitle("模型知识补充，非笔记原文")).toBeInTheDocument();
  });
});


describe("url autolink decoration", () => {
  it("splits www urls from surrounding text", () => {
    expect(splitTextByUrls("快手官方网址是 www.kuaishou.com [补充·模型]")).toEqual([
      { text: "快手官方网址是 " },
      { text: "www.kuaishou.com", href: "https://www.kuaishou.com" },
      { text: " [补充·模型]" },
    ]);
  });

  it("renders www urls as clickable links", () => {
    render(React.createElement(
      React.Fragment,
      null,
      renderDecoratedReactNode("快手官方网址是 www.kuaishou.com [补充·模型]", {}),
    ));

    const link = screen.getByRole("link", { name: "www.kuaishou.com" });
    expect(link).toHaveAttribute("href", "https://www.kuaishou.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("补充·模型")).toBeInTheDocument();
  });

  it("does not wrap urls that are already inside anchors", () => {
    render(React.createElement(
      React.Fragment,
      null,
      renderDecoratedReactNode(
        React.createElement("a", { href: "https://www.kuaishou.com" }, "www.kuaishou.com"),
        {},
      ),
    ));

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://www.kuaishou.com");
  });
});
