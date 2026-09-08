// Tantalus verification mock: makes the real React webview drivable in a plain
// browser tab like a user, without the Tauri runtime or real credentials.
//
// Load it BEFORE the app mounts its next root (see remount below). It installs
// the same surface @tauri-apps/api touches: window.__TAURI_INTERNALS__ plus the
// plugin:event listen/emit/unlisten commands. Figures are synthetic scaffolding
// with the same shapes Rust sends (18000 / 604800 windows, credits containers,
// extra_usage); no tokens, no network, no real credential files.
//
// Scenarios mirror src/presentation.ts status words:
//   ready | stale | auth_missing | error | blocked
// Switch with: window.__TANTALUS_MOCK__.scenario("stale").then(m => m)
// (promise chain: the driving harness has no top-level await)

const nowEpoch = () => Math.floor(Date.now() / 1000);

function readySnapshot() {
  const now = nowEpoch();
  return {
    codex: {
      five_hour: { used_percent: 42, limit_window_seconds: 18000, reset_at_epoch: now + 3 * 3600 + 29 * 60 },
      seven_day: { used_percent: 8, limit_window_seconds: 604800, reset_at_epoch: now + 4 * 86400 + 20 * 3600 },
      allowed: true,
      limit_reached: false,
      reset_credits: [{ expires_at_epoch: 1791076477 }, { expires_at_epoch: 1791080077 }],
      reset_credit_count: 2,
      extra_usage: null,
      last_successful_update_epoch: now - 60,
      status: "ready",
      error_message: null,
    },
    claude: {
      five_hour: { used_percent: 65, limit_window_seconds: 18000, reset_at_epoch: now + 3600 },
      seven_day: { used_percent: 74, limit_window_seconds: 604800, reset_at_epoch: now + 86400 },
      allowed: true,
      limit_reached: null,
      reset_credits: [],
      reset_credit_count: null,
      extra_usage: { enabled: true, used_credits: 12.5, monthly_limit: 50, currency: "USD" },
      last_successful_update_epoch: now - 60,
      status: "ready",
      error_message: null,
    },
    enabled: loadEnabled(),
  };
}

function blankProvider() {
  return {
    five_hour: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
    seven_day: { used_percent: null, limit_window_seconds: null, reset_at_epoch: null },
    allowed: null,
    limit_reached: null,
    reset_credits: [],
    reset_credit_count: null,
    extra_usage: null,
    last_successful_update_epoch: null,
    status: "loading",
    error_message: null,
  };
}

function loadEnabled() {
  try {
    const raw = localStorage.getItem("tantalus-mock-enabled");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.codex === "boolean" && typeof parsed.claude === "boolean") return parsed;
    }
  } catch { /* fall through to defaults, mimicking providers.json missing */ }
  return { codex: true, claude: true };
}

function saveEnabled(enabled) {
  try {
    localStorage.setItem("tantalus-mock-enabled", JSON.stringify(enabled));
  } catch { /* storage full or blocked: keep in-memory state only */ }
}

function loadAutostart() {
  try {
    return localStorage.getItem("tantalus-mock-autostart") === "true";
  } catch {
    return false;
  }
}

function saveAutostart(enabled) {
  try {
    localStorage.setItem("tantalus-mock-autostart", String(enabled));
  } catch {
    return;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

let snapshot = readySnapshot();
let mode = "ready";
let autostart = loadAutostart();
let failingCommand = null;
const listeners = new Map(); // event name -> handler ids
const callbacks = new Map(); // handler id -> function

function registerCallback(callback, once = false) {
  const id = window.crypto.getRandomValues(new Uint32Array(1))[0];
  callbacks.set(id, (data) => {
    if (once) callbacks.delete(id);
    if (callback) callback(data);
  });
  return id;
}

function runCallback(id, data) {
  const callback = callbacks.get(id);
  if (callback) callback(data);
}

function publish() {
  for (const id of listeners.get("usage-snapshot") ?? []) {
    runCallback(id, { event: "usage-snapshot", payload: clone(snapshot) });
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function applyModeToEnabled() {
  const now = nowEpoch();
  for (const id of ["codex", "claude"]) {
    if (!snapshot.enabled[id]) continue; // off stays off with cleared figures
    const provider = snapshot[id];
    if (mode === "ready") {
      const fresh = readySnapshot();
      snapshot[id] = fresh[id];
      snapshot[id].last_successful_update_epoch = now;
    } else if (mode === "blocked") {
      provider.status = "ready";
      provider.allowed = false;
      provider.limit_reached = true;
      provider.error_message = null;
      provider.last_successful_update_epoch = now;
    } else if (mode === "stale") {
      provider.status = "stale";
      provider.error_message = "Mock network failure. The last successful reading remains visible.";
    } else if (mode === "auth_missing") {
      const blank = blankProvider();
      snapshot[id] = { ...blank, status: "auth_missing", error_message: "No sign-in was found for this provider" };
    } else if (mode === "error") {
      if (provider.last_successful_update_epoch != null) {
        provider.status = "stale";
        provider.error_message = "Mock refresh failed. The last successful reading remains visible.";
      } else {
        const blank = blankProvider();
        snapshot[id] = { ...blank, status: "error", error_message: "Mock refresh failed." };
      }
    }
  }
}

async function invoke(cmd, args = {}) {
  if (cmd === failingCommand) throw new Error(`mock: ${cmd} failed`);
  if (cmd === "plugin:event|listen") {
    const list = listeners.get(args.event) ?? [];
    list.push(args.handler);
    listeners.set(args.event, list);
    return args.handler;
  }
  if (cmd === "plugin:event|emit") {
    for (const id of listeners.get(args.event) ?? []) {
      runCallback(id, args);
    }
    return null;
  }
  if (cmd === "plugin:event|unlisten") {
    const list = listeners.get(args.event) ?? [];
    listeners.set(args.event, list.filter((id) => id !== args.eventId));
    return null;
  }
  if (cmd === "plugin:app|version") return "0.0.3";
  if (cmd === "plugin:autostart|is_enabled") return autostart;
  if (cmd === "plugin:autostart|enable") {
    autostart = true;
    saveAutostart(autostart);
    return null;
  }
  if (cmd === "plugin:autostart|disable") {
    autostart = false;
    saveAutostart(autostart);
    return null;
  }
  if (cmd === "cached_usage") return clone(snapshot);
  if (cmd === "refresh_usage") {
    await delay(350); // keep the Refreshing / aria-busy state observable
    applyModeToEnabled();
    publish();
    return clone(snapshot);
  }
  if (cmd === "set_provider_enabled") {
    const { provider, enabled } = args;
    snapshot.enabled[provider] = enabled;
    saveEnabled(snapshot.enabled);
    if (!enabled) {
      snapshot[provider] = blankProvider(); // mirrors Rust clearing stored figures
    } else {
      const fresh = readySnapshot();
      snapshot[provider] = clone(fresh[provider]);
      snapshot[provider].last_successful_update_epoch = nowEpoch();
      if (mode !== "ready") applyModeToEnabled();
    }
    publish();
    if (enabled) {
      await delay(350); // enabling refreshes that provider immediately
      publish();
    }
    return clone(snapshot);
  }
  throw new Error(`mock: unknown command ${cmd}`);
}

window.__TAURI_INTERNALS__ = {
  ...(window.__TAURI_INTERNALS__ ?? {}),
  invoke,
  transformCallback: registerCallback,
  unregisterCallback: (id) => { callbacks.delete(id); },
  runCallback,
  callbacks,
  metadata: {
    currentWindow: { label: "main" },
    currentWebview: { windowLabel: "main", label: "main" },
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  ...(window.__TAURI_EVENT_PLUGIN_INTERNALS__ ?? {}),
  unregisterListener: (_event, id) => { callbacks.delete(id); },
};

async function remount() {
  const old = document.getElementById("root");
  if (!old) throw new Error("mock: #root missing, is this the Tantalus page?");
  const fresh = document.createElement("div");
  fresh.id = "root";
  old.replaceWith(fresh);
  snapshot = readySnapshot();
  autostart = loadAutostart();
  // Cache-buster forces Vite to re-execute main.tsx so a new App mounts
  // against the mock. The previous error-state tree stays detached.
  await import(`/src/main.tsx?tantalus-mock=${Date.now()}`);
  return true;
}

window.__TANTALUS_MOCK__ = {
  remount,
  invoke,
  snapshot: () => clone(snapshot),
  async scenario(name) {
    if (!["ready", "stale", "auth_missing", "error", "blocked"].includes(name)) {
      throw new Error(`mock: unknown scenario ${name}`);
    }
    mode = name;
    return mode;
  },
  reset() {
    localStorage.removeItem("tantalus-mock-enabled");
    localStorage.removeItem("tantalus-mock-autostart");
    snapshot = readySnapshot();
    autostart = false;
    failingCommand = null;
    mode = "ready";
    publish();
    return true;
  },
  fail(command) {
    failingCommand = command;
    return failingCommand;
  },
};
