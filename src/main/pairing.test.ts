import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Pairing } from "./pairing";

let directory: string;
let path: string;
let now: number;
let notices: string[];

const pairing = () =>
  new Pairing(
    path,
    () => {},
    (message) => notices.push(message),
    () => now,
  );
const code = (owner: Pairing) => owner.read(new Set()).pairing!.code;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "tantalus-pairing-"));
  path = join(directory, "paired-devices.json");
  now = 1_000;
  notices = [];
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

describe("pairing", () => {
  it("trades a code once for a token that authorizes the device, saving only its hash", () => {
    const owner = pairing();
    owner.offer();
    const offered = code(owner);
    expect(offered).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    const token = owner.pair(` ${offered.slice(0, 3).toLowerCase()}-${offered.slice(3)} `, "Phone")!;
    expect(token).toBeTruthy();
    expect(owner.read(new Set()).pairing).toBeNull();
    expect(owner.pair(offered, "Second")).toBeNull();

    const id = owner.authorize(token)!;
    expect(owner.read(new Set([id])).devices).toEqual([
      { id, name: "Phone", pairedAt: 1_000, lastSeenAt: 1_000, connected: true },
    ]);
    expect(readFileSync(path, "utf8")).not.toContain(token);
    expect(pairing().authorize(token)).toBe(id);
    expect(owner.authorize("forged")).toBeNull();
    expect(owner.authorize(null)).toBeNull();
  });

  it("withdraws a code after five wrong attempts", () => {
    const owner = pairing();
    owner.offer();
    const offered = code(owner);
    for (let attempt = 0; attempt < 5; attempt += 1) expect(owner.pair("WRONG1", "Guess")).toBeNull();
    expect(owner.read(new Set()).pairing).toBeNull();
    expect(owner.pair(offered, "Late")).toBeNull();
    expect(notices).toHaveLength(1);
  });

  it("withdraws a code once it expires", () => {
    vi.useFakeTimers();
    const owner = pairing();
    owner.offer();
    const offered = code(owner);
    now += 300;
    expect(owner.pair(offered, "Late")).toBeNull();
    vi.advanceTimersByTime(300_000);
    expect(owner.read(new Set()).pairing).toBeNull();
  });

  it("renames and removes devices, and saves a visit at most once a minute", () => {
    const owner = pairing();
    owner.offer();
    const token = owner.pair(code(owner), "Phone")!;
    const id = owner.authorize(token)!;
    now += 30;
    owner.authorize(token);
    expect(owner.read(new Set()).devices[0]!.lastSeenAt).toBe(1_000);
    now += 30;
    owner.authorize(token);
    expect(owner.read(new Set()).devices[0]!.lastSeenAt).toBe(1_060);

    owner.rename(id, "  Kitchen tablet ");
    expect(pairing().read(new Set()).devices[0]!.name).toBe("Kitchen tablet");
    expect(() => owner.rename(id, " ")).toThrow();
    owner.remove(id);
    expect(owner.authorize(token)).toBeNull();
    expect(pairing().read(new Set()).devices).toEqual([]);
    expect(() => owner.remove(id)).toThrow("Unknown device.");
  });
});
