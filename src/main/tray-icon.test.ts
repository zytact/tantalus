import { describe, expect, it } from "vite-plus/test";
import { trayPercent, usageBitmap } from "./tray-icon";
import type { Bitmap } from "./tray-icon";

const mark = (size: number): Bitmap => ({ width: size, height: size, data: Buffer.alloc(size * size * 4, 0x80) });
const pixel = ({ width, data }: Bitmap, x: number, y: number) => [
  ...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];
const inked = ({ width, height, data }: Bitmap) =>
  Array.from({ length: width * height }, (_, index) => index).filter((index) => data[index * 4 + 3] === 255);

describe("tray percent", () => {
  it("is whole and stays within 0 to its limit", () => {
    expect([trayPercent(41.6, 100), trayPercent(-3, 100), trayPercent(140, 100)]).toEqual(["42", "0", "100"]);
    expect([trayPercent(150, 300), trayPercent(320, 300)]).toEqual(["150", "300"]);
  });
});

describe("usage bitmap", () => {
  it("puts the number after the mark in the provider color", () => {
    const bitmap = usageBitmap({ text: "42", color: "#D97757", height: 16, mark: mark(16) });
    expect(bitmap.height).toBe(16);
    expect(bitmap.width).toBeGreaterThan(16);
    expect(pixel(bitmap, 0, 0)).toEqual([0x80, 0x80, 0x80, 0x80]);
    const first = inked(bitmap)[0];
    expect(first % bitmap.width).toBeGreaterThanOrEqual(16);
    expect(pixel(bitmap, first % bitmap.width, Math.floor(first / bitmap.width))).toEqual([0x57, 0x77, 0xd9, 255]);
  });

  it("fits even 100 inside the square when there is no mark", () => {
    for (const height of [16, 32]) {
      for (const text of ["7", "42", "100"]) {
        const bitmap = usageBitmap({ text, color: "#3B82F6", height, mark: null });
        expect([bitmap.width, bitmap.height]).toEqual([height, height]);
        expect(inked(bitmap).length).toBeGreaterThan(0);
      }
    }
  });

  it("widens the square for a pooled number too wide for it, rather than wrapping its pixels", () => {
    const bitmap = usageBitmap({ text: "300", color: "#3B82F6", height: 16, mark: null });
    expect([bitmap.width, bitmap.height]).toEqual([17, 16]);
    const columns = inked(bitmap).map((index) => index % bitmap.width);
    expect([Math.min(...columns), Math.max(...columns)]).toEqual([0, 16]);
  });

  it("draws the 2x representation exactly twice the size of the 1x one", () => {
    for (const height of [16, 18]) {
      const single = usageBitmap({ text: "42", color: "#D97757", height, mark: mark(height) });
      const double = usageBitmap({ text: "42", color: "#D97757", height: height * 2, mark: mark(height * 2) });
      expect([double.width, double.height]).toEqual([single.width * 2, single.height * 2]);
    }
  });

  it("draws the digits larger when the icon is larger", () => {
    const small = usageBitmap({ text: "42", color: "#3B82F6", height: 16, mark: null });
    const large = usageBitmap({ text: "42", color: "#3B82F6", height: 32, mark: null });
    expect(inked(large).length).toBeGreaterThan(inked(small).length * 2);
  });
});
