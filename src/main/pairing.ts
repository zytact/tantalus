import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { PairingCode, RemoteDevices } from "../shared/ipc";
import { nowEpoch } from "../shared/usage";
import { loadDevices, saveSettings } from "./settings";
import type { StoredDevice } from "./settings";

/** Without 0, O, 1, I and L, so a code read aloud or off a screen is not mistyped. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_SECONDS = 300;
const CODE_ATTEMPTS = 5;
/** A device's last visit is saved at most this often, so a busy device does not rewrite the file on
 * every request. */
const SEEN_SAVE_SECONDS = 60;

/** Owns the devices paired to read usage and the one-time code that pairs a new one. Codes live only
 * in memory, so a restart cancels one. */
export class Pairing {
  private devices: StoredDevice[];
  private offered: (PairingCode & { attemptsLeft: number; timer: NodeJS.Timeout }) | null = null;

  constructor(
    private readonly path: string,
    private readonly onChange: () => void,
    private readonly notify: (message: string) => void,
    private readonly now: () => number = nowEpoch,
  ) {
    this.devices = loadDevices(path);
  }

  /** Offers a fresh code, replacing any code already offered. */
  offer() {
    this.cancel();
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const timer = setTimeout(() => this.cancel(), CODE_SECONDS * 1000);
    timer.unref();
    this.offered = { code, expiresAt: this.now() + CODE_SECONDS, attemptsLeft: CODE_ATTEMPTS, timer };
    this.onChange();
  }

  cancel() {
    if (!this.offered) return;
    clearTimeout(this.offered.timer);
    this.offered = null;
    this.onChange();
  }

  /** Trades the offered code for a new device's token, or null when it does not match. Each wrong
   * guess spends an attempt, and the last one withdraws the code. */
  pair(code: string, name: string): string | null {
    const offered = this.offered;
    if (!offered || offered.expiresAt <= this.now()) return null;
    if (normalizedCode(code) !== offered.code) {
      offered.attemptsLeft -= 1;
      if (offered.attemptsLeft === 0) {
        this.cancel();
        this.notify("The pairing code was withdrawn after too many wrong attempts.");
      }
      return null;
    }
    const token = randomBytes(32).toString("base64url");
    const device = { id: randomUUID(), name, tokenHash: hash(token), pairedAt: this.now(), lastSeenAt: null };
    this.save([...this.devices, device]);
    clearTimeout(offered.timer);
    this.offered = null;
    this.onChange();
    return token;
  }

  /** The device holding `token`, recorded as seen now, or null for a token no device holds. */
  authorize(token: string | null): string | null {
    if (!token) return null;
    const tokenHash = hash(token);
    const device = this.devices.find((device) => device.tokenHash === tokenHash);
    if (!device) return null;
    this.seen(device.id);
    return device.id;
  }

  seen(id: string) {
    const now = this.now();
    const device = this.devices.find((device) => device.id === id);
    if (!device || (device.lastSeenAt !== null && now - device.lastSeenAt < SEEN_SAVE_SECONDS)) return;
    this.save(this.devices.map((each) => (each === device ? { ...each, lastSeenAt: now } : each)));
    this.onChange();
  }

  rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A device needs a name.");
    this.change(id, (devices) => devices.map((device) => (device.id === id ? { ...device, name: trimmed } : device)));
  }

  remove(id: string) {
    this.change(id, (devices) => devices.filter((device) => device.id !== id));
  }

  read(connected: ReadonlySet<string>): RemoteDevices {
    const pairing = this.offered && { code: this.offered.code, expiresAt: this.offered.expiresAt };
    const devices = this.devices.map(({ id, name, pairedAt, lastSeenAt }) => ({
      id,
      name,
      pairedAt,
      lastSeenAt,
      connected: connected.has(id),
    }));
    return { devices, pairing };
  }

  private change(id: string, edit: (devices: StoredDevice[]) => StoredDevice[]) {
    if (!this.devices.some((device) => device.id === id)) throw new Error("Unknown device.");
    this.save(edit(this.devices));
    this.onChange();
  }

  private save(devices: StoredDevice[]) {
    saveSettings(this.path, devices);
    this.devices = devices;
  }
}

/** Case, spaces and dashes do not matter when a code is typed. */
const normalizedCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, "");

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
