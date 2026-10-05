import { describe, expect, it } from "vite-plus/test";
import { nextEnabled } from "./picker";

describe("nextEnabled", () => {
  const options = [{ disabled: true }, {}, { disabled: true }, {}];

  it("skips disabled options in either direction", () => {
    expect(nextEnabled(options, -1, 1)).toBe(1);
    expect(nextEnabled(options, 1, 1)).toBe(3);
    expect(nextEnabled(options, options.length, -1)).toBe(3);
    expect(nextEnabled(options, 3, -1)).toBe(1);
  });

  it("stays put at either end", () => {
    expect(nextEnabled(options, 3, 1)).toBe(3);
    expect(nextEnabled(options, 1, -1)).toBe(1);
  });
});
