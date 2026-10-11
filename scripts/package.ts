import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "electron-builder";
import { identities, updateHelper } from "../src/main/identity.ts";
import type { Identity } from "../src/main/identity.ts";

/** Bundles the app for the platform it runs on from `dist/` and `dist-electron/`, which `vp build` and
 * `vp pack` write. `--preview` bundles the preview identity, and `--dir` stops at the unpacked app. */
const identity = process.argv.includes("--preview") ? identities.preview : identities.release;
const unpacked = process.argv.includes("--dir");

const output = `release/${identity.executableName}`;

await build({
  publish: "never",
  config: {
    appId: identity.appId,
    productName: identity.productName,
    extraMetadata: {
      name: identity.executableName,
      productName: identity.productName,
      desktopName: identity.productName,
      // A worktree has no `.git/config` for the builder to read the project URL from.
      homepage: "https://github.com/zytact/tantalus",
    },
    directories: { output, buildResources: "build" },
    electronDist: "node_modules/electron/dist",
    files: ["dist/**", "dist-electron/**", "package.json"],
    // Never published by the builder. It is set so the Linux packages record their format in
    // `resources/package-type`, which the updater reads to pick its download.
    publish: { provider: "github", owner: "zytact", repo: "tantalus" },
    linux: {
      target: unpacked ? "dir" : ["deb", "rpm"],
      executableName: identity.executableName,
      icon: `${identity.icons}/icon.png`,
      category: "Utility",
      maintainer: "Arnab",
      syncDesktopName: true,
    },
    deb: {
      artifactName: "${name}_${version}_amd64.${ext}",
      fpm: unpacked ? [] : await updateHelperFiles(identity, "deb"),
    },
    rpm: {
      artifactName: "${name}-${version}.x86_64.${ext}",
      fpm: [
        "--rpm-rpmbuild-define",
        "_build_id_links none",
        ...(unpacked ? [] : await updateHelperFiles(identity, "rpm")),
      ],
    },
    mac: {
      target: unpacked
        ? "dir"
        : [
            { target: "dmg", arch: "arm64" },
            { target: "tar.gz", arch: "arm64" },
          ],
      icon: `${identity.icons}/icon.png`,
      category: "public.app-category.utilities",
      // Ad-hoc, without an Apple Developer ID. The updater checks its own signature instead.
      identity: "-",
      hardenedRuntime: false,
      artifactName: "${productName}_${version}_aarch64.app.${ext}",
    },
    dmg: { artifactName: "${productName}_${version}_aarch64.${ext}" },
    win: {
      target: unpacked ? "dir" : "nsis",
      executableName: identity.executableName,
      icon: `${identity.icons}/icon.png`,
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      include: "build/installer.nsh",
      artifactName: "${productName}_${version}_x64-setup.${ext}",
    },
  },
});

/** Writes the root update helper and its polkit policy, and returns the fpm mappings that install them
 * outside `/opt`. pkexec clears the environment, so the helper is a shell wrapper that starts the app
 * binary as Node on the `update-helper` bundle. Electron reads switches such as `--js-flags` anywhere
 * in its arguments, so the caller's signature reaches it only through the environment. */
async function updateHelperFiles(identity: Identity, format: "deb" | "rpm"): Promise<string[]> {
  const helper = updateHelper(identity);
  const app = `/opt/${identity.productName}`;
  const directory = resolve(output, "update-helper", format);
  const wrapper = join(directory, "helper");
  const policy = join(directory, "policy");
  await mkdir(directory, { recursive: true });
  await writeFile(
    wrapper,
    `#!/bin/sh
export ELECTRON_RUN_AS_NODE=1
export TANTALUS_UPDATE_SIGNATURE="$1"
exec '${app}/${identity.executableName}' '${app}/resources/app.asar/dist-electron/update-helper.mjs' ${format}
`,
    { mode: 0o755 },
  );
  await writeFile(
    policy,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policyconfig PUBLIC "-//freedesktop//DTD PolicyKit Policy Configuration 1.0//EN"
  "http://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
<policyconfig>
  <action id="${helper.action}">
    <description>Install a ${identity.productName} update</description>
    <message>Authentication is required to update ${identity.productName}</message>
    <defaults>
      <allow_any>auth_admin</allow_any>
      <allow_inactive>auth_admin</allow_inactive>
      <allow_active>yes</allow_active>
    </defaults>
    <annotate key="org.freedesktop.policykit.exec.path">${helper.path}</annotate>
  </action>
</policyconfig>
`,
    { mode: 0o644 },
  );
  return [`${wrapper}=${helper.path}`, `${policy}=/usr/share/polkit-1/actions/${helper.action}.policy`];
}
