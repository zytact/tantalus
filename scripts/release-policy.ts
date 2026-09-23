import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { ReleaseNotice } from "../src/shared/ipc";

const DIRECT_UPDATE_LIMIT = 15;

type PublishedRelease = { tag_name: string; draft: boolean; prerelease: boolean };

const validVersion = (version: string) => /^\d+\.\d+\.\d+$/.test(version);
const isNewer = (candidate: string, current: string) => {
  const [a, b] = [candidate, current].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
};

export function releasePolicy(latest: string, releases: PublishedRelease[], notices: ReleaseNotice[]) {
  if (!validVersion(latest)) throw new Error(`Invalid release version: ${latest}`);
  const previous = releases
    .filter(
      ({ tag_name, draft, prerelease }) =>
        !draft && !prerelease && /^v\d+\.\d+\.\d+$/.test(tag_name) && isNewer(latest, tag_name.slice(1)),
    )
    .map(({ tag_name }) => tag_name.slice(1))
    .sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));
  const minimumVersion = previous[DIRECT_UPDATE_LIMIT - 1] ?? previous.at(-1) ?? "0.0.0";
  const ids = new Set<string>();
  for (const notice of notices) {
    if (
      !notice.id ||
      ids.has(notice.id) ||
      !notice.message ||
      !validVersion(notice.fromVersion) ||
      !validVersion(notice.throughVersion) ||
      isNewer(notice.fromVersion, notice.throughVersion) ||
      (notice.platforms && !notice.platforms.every((platform) => ["linux", "darwin", "win32"].includes(platform)))
    ) {
      throw new Error(`Invalid release notice: ${notice.id}`);
    }
    ids.add(notice.id);
  }
  return {
    minimumVersion,
    notices: notices.filter(
      ({ fromVersion, throughVersion }) => !isNewer(minimumVersion, throughVersion) && isNewer(latest, fromVersion),
    ),
  };
}

if (process.argv[1]?.endsWith("scripts/release-policy.ts")) {
  const [tag, repository, output] = process.argv.slice(2);
  if (!tag || !repository || !output) throw new Error("Usage: release-policy.ts TAG REPOSITORY OUTPUT");
  const releases: PublishedRelease[] = JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}/releases?per_page=100`], { encoding: "utf8" }),
  );
  const notices: ReleaseNotice[] = JSON.parse(readFileSync("release-notices.json", "utf8"));
  writeFileSync(output, JSON.stringify(releasePolicy(tag.replace(/^v/, ""), releases, notices)));
}
