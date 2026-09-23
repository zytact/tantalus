import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseReleaseNotices } from "../src/shared/release-notice.ts";
import { isNewer, validVersion } from "../src/shared/version.ts";

const DIRECT_UPDATE_LIMIT = 15;

type PublishedRelease = { tag_name: string; draft: boolean; prerelease: boolean };

export function releasePolicy(latest: string, releases: PublishedRelease[], noticeInput: unknown) {
  if (!validVersion(latest)) throw new Error(`Invalid release version: ${latest}`);
  const notices = parseReleaseNotices(noticeInput);
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
    if (ids.has(notice.id)) throw new Error(`Duplicate release notice: ${notice.id}`);
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
  const notices: unknown = JSON.parse(readFileSync("release-notices.json", "utf8"));
  writeFileSync(output, JSON.stringify(releasePolicy(tag.replace(/^v/, ""), releases, notices)));
}
