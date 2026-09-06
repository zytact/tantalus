import { describe, expect, it } from "vitest";
import { usagePercent } from "./presentation";

describe("display contract", () => {
  it("keeps unavailable usage distinct from zero", () => {
    expect(usagePercent(null)).toBe("Unavailable");
    expect(usagePercent(0)).toBe("0% used");
  });
});
