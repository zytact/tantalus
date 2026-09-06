import { describe, expect, it } from "vitest";

describe("display contract", () => {
  it("keeps unavailable usage distinct from zero", () => {
    const display = (value: number | null) => value === null ? "Unavailable" : `${Math.round(value)}% used`;
    expect(display(null)).toBe("Unavailable");
    expect(display(0)).toBe("0% used");
  });
});
