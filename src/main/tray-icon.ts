/** Raw pixels in the BGRA order Electron's `toBitmap` and `createFromBitmap` use. */
export type Bitmap = { width: number; height: number; data: Buffer };

/** A 5×7 pixel font, narrowed for the 1, since the tray has no text renderer of its own. */
const glyphs: Record<string, string[]> = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": [".#.", "##.", ".#.", ".#.", ".#.", ".#.", "###"],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
};
const GLYPH_HEIGHT = 7;

/** The used percentage as the tray draws it: whole, and within 0 to 100. */
export function trayPercent(used: number): string {
  return String(Math.round(Math.min(100, Math.max(0, used))));
}

/** Draws `text` in `color` beside `mark`, or alone and centered in a square when there is no mark.
 * The digits take the largest whole pixel scale that fits, so they stay sharp. */
export function usageBitmap({
  text,
  color,
  height,
  mark,
}: {
  text: string;
  color: string;
  height: number;
  mark: Bitmap | null;
}): Bitmap {
  const scale = fittingScale(text, height, mark ? Infinity : height);
  const textWidth = measure(text, scale);
  const gap = mark ? Math.max(1, Math.round(height / 8)) : 0;
  const width = mark ? mark.width + gap + textWidth : height;
  const bitmap: Bitmap = { width, height, data: Buffer.alloc(width * height * 4) };
  if (mark) blit(bitmap, mark, 0, Math.floor((height - mark.height) / 2));
  const left = mark ? mark.width + gap : Math.floor((width - textWidth) / 2);
  drawText(bitmap, text, scale, left, Math.floor((height - GLYPH_HEIGHT * scale) / 2), rgb(color));
  return bitmap;
}

/** Recolors every pixel to `color`, keeping its coverage. Turns a template mark into a fixed one. */
export function tint(bitmap: Bitmap, color: string): Bitmap {
  const [red, green, blue] = rgb(color);
  const data = Buffer.from(bitmap.data);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    // The channels are premultiplied by alpha.
    data[index] = Math.round((blue * alpha) / 255);
    data[index + 1] = Math.round((green * alpha) / 255);
    data[index + 2] = Math.round((red * alpha) / 255);
  }
  return { ...bitmap, data };
}

function fittingScale(text: string, height: number, maxWidth: number): number {
  let scale = 1;
  while (GLYPH_HEIGHT * (scale + 1) <= height * 0.875 && measure(text, scale + 1) <= maxWidth) scale++;
  return scale;
}

const spacing = (scale: number) => Math.max(1, Math.floor(scale / 2));

function measure(text: string, scale: number): number {
  const columns = text.split("").reduce((sum, char) => sum + glyph(char)[0].length, 0);
  return columns * scale + (text.length - 1) * spacing(scale);
}

function glyph(char: string): string[] {
  const rows = glyphs[char];
  if (!rows) throw new Error(`The tray font has no glyph for "${char}".`);
  return rows;
}

function drawText(bitmap: Bitmap, text: string, scale: number, left: number, top: number, color: Rgb) {
  let x = left;
  for (const char of text) {
    const rows = glyph(char);
    rows.forEach((row, rowIndex) =>
      row.split("").forEach((cell, column) => {
        if (cell === "#") fill(bitmap, x + column * scale, top + rowIndex * scale, scale, color);
      }),
    );
    x += rows[0].length * scale + spacing(scale);
  }
}

type Rgb = [number, number, number];

function rgb(color: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) throw new Error(`Expected a #rrggbb color, got "${color}".`);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function fill(bitmap: Bitmap, x: number, y: number, size: number, [red, green, blue]: Rgb) {
  for (let row = y; row < y + size; row++) {
    for (let column = x; column < x + size; column++) {
      const index = (row * bitmap.width + column) * 4;
      bitmap.data[index] = blue;
      bitmap.data[index + 1] = green;
      bitmap.data[index + 2] = red;
      bitmap.data[index + 3] = 255;
    }
  }
}

function blit(target: Bitmap, source: Bitmap, x: number, y: number) {
  for (let row = 0; row < source.height; row++) {
    const from = row * source.width * 4;
    source.data.copy(target.data, ((y + row) * target.width + x) * 4, from, from + source.width * 4);
  }
}
