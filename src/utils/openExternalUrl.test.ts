import { describe, expect, it } from "vitest";
import { resolveExternalHttpUrl } from "./openExternalUrl";

describe("resolveExternalHttpUrl", () => {
  it("accepts http and https urls", () => {
    expect(resolveExternalHttpUrl("https://www.kuaishou.com")).toBe("https://www.kuaishou.com/");
    expect(resolveExternalHttpUrl("http://example.com/path")).toBe("http://example.com/path");
  });

  it("rejects javascript and hash links", () => {
    expect(resolveExternalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(resolveExternalHttpUrl("#section")).toBeNull();
    expect(resolveExternalHttpUrl("mailto:hi@example.com")).toBeNull();
  });
});
