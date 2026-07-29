import { describe, expect, it } from "vitest";
import { stripHeadingTimestamps } from "./markdownUtils";

describe("stripHeadingTimestamps", () => {
  it("removes chapter ranges from Markdown headings", () => {
    const markdown = "# First chapter (0:01 - 0:15)\n### Long chapter (1:02:03 - 2:04:05)";

    expect(stripHeadingTimestamps(markdown)).toBe("# First chapter\n### Long chapter");
  });

  it("preserves body timestamps and other Markdown content", () => {
    const markdown = [
      "# Chapter (0:01 - 0:15)",
      "Body [00:03] and (0:04 - 0:05) stay intact.",
      "![Chapter](asset://localhost/image.png)",
      "A paragraph with (0:06 - 0:07) stays intact.",
    ].join("\n");

    expect(stripHeadingTimestamps(markdown)).toBe([
      "# Chapter",
      "Body [00:03] and (0:04 - 0:05) stay intact.",
      "![Chapter](asset://localhost/image.png)",
      "A paragraph with (0:06 - 0:07) stays intact.",
    ].join("\n"));
  });

  it("preserves headings whose range is not at the end", () => {
    const markdown = "# Chapter (0:01 - 0:15) extra";

    expect(stripHeadingTimestamps(markdown)).toBe(markdown);
  });
});
