import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { app } from "electron";
import type { AvailableUpdate, InstallProgress, ReleaseNotes } from "../shared/ipc";
import { isNewer, matchingNotices, parseManifest, parseReleases, readDownload, verifySignature } from "./release";
import type { Manifest, ReleaseAsset } from "./release";
import { nextBackoff } from "./usage-state";

const MANIFEST_URL = "https://github.com/zytact/tantalus/releases/latest/download/latest.json";
/** GitHub lists releases newest first, so one page reaches back 100 releases. */
const RELEASES_URL = "https://api.github.com/repos/zytact/tantalus/releases?per_page=100";
const REQUEST_TIMEOUT = 30_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
/** A launch at login usually beats the network up, so a failed check comes back well before the
 * next interval. */
const RETRY_START = 5 * 60 * 1000;
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000;

const run = promisify(execFile);

/** The manifest key for the bundle this app was installed from, so an rpm install never downloads
 * the deb. electron-builder records a Linux package's format beside the app. */
export function platformKey(): string | null {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-aarch64";
  if (process.platform === "win32" && process.arch === "x64") return "windows-x86_64";
  if (process.platform !== "linux" || process.arch !== "x64") return null;
  const marker = join(process.resourcesPath, "package-type");
  const packageType = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
  return packageType === "deb" || packageType === "rpm" ? `linux-x86_64-${packageType}` : null;
}

/** Finds signed releases newer than the running build and installs them. The release it last found
 * stays on offer through an install, so a failed one leaves nothing to put back. */
export class Updater {
  private pending: (ReleaseAsset & AvailableUpdate) | null = null;
  private progress: InstallProgress | null = null;

  constructor(
    private readonly announce: (update: AvailableUpdate) => void,
    private readonly report: (progress: InstallProgress | null) => void,
  ) {}

  available(): AvailableUpdate | null {
    return (
      this.pending && {
        version: this.pending.version,
        manualInstall: this.pending.manualInstall,
        notices: this.pending.notices,
      }
    );
  }

  installProgress(): InstallProgress | null {
    return this.progress;
  }

  async check(): Promise<AvailableUpdate | null> {
    const response = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    if (!response.ok) throw new Error(`the release manifest returned ${response.status}`);
    const manifest = parseManifest(await response.json());
    this.pending = selectUpdate(manifest, app.getVersion());
    const update = this.available();
    if (update) this.announce(update);
    return update;
  }

  async releaseNotes(): Promise<ReleaseNotes[]> {
    const update = this.pending;
    if (!update) throw new Error("No update is ready.");
    const response = await fetch(RELEASES_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!response.ok) throw new Error(`Could not load the release notes: GitHub returned ${response.status}`);
    return parseReleases(await response.json(), app.getVersion(), update.version);
  }

  /** Checks at launch and every `CHECK_INTERVAL`, backing off after a failure. */
  async watch() {
    let retry: number | null = null;
    for (;;) {
      const succeeded = await this.check().then(
        () => true,
        (error: unknown) => {
          console.error("Update check failed:", error);
          return false;
        },
      );
      retry = nextBackoff(succeeded, retry, RETRY_START, CHECK_INTERVAL);
      await sleep(retry ?? CHECK_INTERVAL);
    }
  }

  /** Downloads the pending update, verifies its signature, installs it, then relaunches into it. A
   * deb or rpm install asks for an administrator password through polkit. Windows hands over to the
   * NSIS installer, which starts the new version itself. */
  async install(acknowledgedNoticeIds: string[]) {
    const update = this.pending;
    if (!update) throw new Error("No update is ready to install.");
    if (update.manualInstall)
      throw new Error("This version needs a fresh install. Quit Tantalus and install the latest release.");
    if (update.notices.some(({ id }) => !acknowledgedNoticeIds.includes(id))) {
      throw new Error("Read and acknowledge the update notice before installing.");
    }
    if (this.progress) throw new Error("The update is already installing.");
    this.setProgress({ stage: "download", received: 0, total: null });
    let directory: string | null = null;
    try {
      directory = await mkdtemp(join(app.getPath("temp"), "tantalus-update-"));
      // A stalled download would otherwise hold the install open, and every retry refused, for good.
      const response = await fetch(update.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) });
      if (!response.ok) throw new Error(`the download returned ${response.status}`);
      const data = await readDownload(response, (progress) => this.setProgress({ stage: "download", ...progress }));
      this.setProgress({ stage: "install" });
      if (!verifySignature(data, update.signature)) throw new Error("the download failed its signature check");
      const file = join(directory, basename(new URL(update.url).pathname));
      await writeFile(file, data);
      await installBundle(file, directory);
    } catch (error) {
      if (directory) {
        await rm(directory, { recursive: true, force: true }).catch((cleanupError: unknown) =>
          console.error("Failed to remove the update directory:", cleanupError),
        );
      }
      throw new Error(`Could not install the update: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.setProgress(null);
    }
  }

  private setProgress(progress: InstallProgress | null) {
    this.progress = progress;
    this.report(progress);
  }
}

function selectUpdate(manifest: Manifest, currentVersion: string): (ReleaseAsset & AvailableUpdate) | null {
  if (!isNewer(manifest.version, currentVersion)) return null;
  return {
    version: manifest.version,
    manualInstall: isNewer(manifest.minimumVersion ?? currentVersion, currentVersion),
    notices: matchingNotices(manifest.notices, currentVersion, process.platform),
    ...selectAsset(manifest),
  };
}

function selectAsset(manifest: Manifest): ReleaseAsset {
  const key = platformKey() ?? process.platform;
  const asset = manifest.platforms[key];
  if (!asset) throw new Error(`the release has no update for ${key}`);
  return asset;
}

async function installBundle(file: string, directory: string) {
  switch (process.platform) {
    case "win32":
      await launchDetached(file, ["--updated", "/S", "--force-run"]);
      app.exit(0);
      return;
    case "darwin":
      await replaceAppBundle(file);
      app.relaunch();
      break;
    default:
      await installLinuxPackage(file);
  }
  await rm(directory, { recursive: true, force: true }).catch((error: unknown) =>
    console.error("Failed to remove the update directory:", error),
  );
  app.exit(0);
}

async function installLinuxPackage(file: string) {
  // An instance an older release relaunched carries no_new_privs, which pkexec cannot run under.
  if (/^NoNewPrivs:\s*1$/m.test(await readFile("/proc/self/status", "utf8"))) {
    throw new Error("Tantalus needs a restart first. Quit and reopen it, then install again.");
  }
  await run("pkexec", platformKey()?.endsWith("-rpm") ? ["rpm", "-U", file] : ["dpkg", "-i", file]);
  await relaunchLinux().catch((error: unknown) => {
    console.error("Failed to relaunch through the shell:", error);
    app.relaunch();
  });
}

/** `app.relaunch()` starts the new instance with no_new_privs set, so its next pkexec would fail.
 * This shell waits for the current process to exit, freeing the single-instance lock and ports, then
 * execs the app without the flag. */
async function relaunchLinux() {
  await launchDetached("sh", [
    "-c",
    'while kill -0 "$0" 2>/dev/null; do sleep 0.1; done; exec "$@"',
    String(process.pid),
    process.execPath,
    ...process.argv.slice(1),
  ]);
}

async function launchDetached(command: string, args: string[]) {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

/** Unpacks the new bundle beside the running one, so the swap is a rename on one volume, and puts the
 * old bundle back if the swap fails. */
async function replaceAppBundle(archive: string) {
  const bundle = join(process.execPath, "..", "..", "..");
  const staging = await mkdtemp(join(dirname(bundle), ".tantalus-update-"));
  const unpacked = join(staging, basename(bundle));
  const previous = join(staging, "previous.app");
  try {
    await run("tar", ["-xzf", archive, "-C", staging]);
    await access(join(unpacked, "Contents", "Info.plist"));
    await rename(bundle, previous);
    try {
      await rename(unpacked, bundle);
    } catch (error) {
      await rename(previous, bundle);
      throw error;
    }
  } finally {
    // The staging directory holds the previous bundle, so it goes only while an app sits in place.
    if (existsSync(bundle)) await rm(staging, { recursive: true, force: true });
  }
}
