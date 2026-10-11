# Updates

Release builds check `latest.json` on the latest GitHub release at launch and every six hours. Failures retry after 5, 10, 20 minutes and continue doubling up to six hours. Preview and debug builds never perform update checks.

A release update appears below the Allowance header, in Settings, and as `Update to v<x>` in the tray. A paired device shows the host's update the same way: the remote access page and a Tantalus following the host both have a check button and the banner, named for the host (see `remote-access.md` and `host-link.md`). They drive the host's own check and install, so the signature check, the notices and the install all run on the host. What's new opens the notes of every published release between the running build and the update, newest first, with each release's changes grouped under New, Fixed, and Changed and tagged with their scope. The main process reads them from the GitHub releases listing in both formats the releases have used: GitHub's generated notes up to v0.0.25, and release-please's from v0.0.26. Any required notices must be acknowledged before Install update becomes available. During installation, a progress strip replaces the offer, measures download progress when the size is known, and shows later steps without a percentage. The main process verifies the Ed25519 signature, installs the platform bundle, and relaunches. Failures restore the action and show an alert. When the installed version is below the release's minimum supported version, the offer instead asks for a fresh install and opens the latest release page. On a paired device that offer only says the host needs a fresh install.

A deb or rpm installs through a root helper the package ships at `/usr/libexec/tantalus-update`, with the polkit action `dev.arnab.tantalus.update` in `/usr/share/polkit-1/actions/`. The preview's are `/usr/libexec/tantalus-preview-update` and `dev.arnab.tantalus.preview.update`. The app runs `pkexec <helper> <signature>` and pipes the package to it. polkit runs the helper without a password for a logged-in desktop session, locked or not, and asks for an administrator password anywhere else, such as an app started from an SSH shell. The helper checks the signature again as root, installs its own copy of the package, and refuses an unsigned package, one signed by another key, and a release older than the installed one. So an install started from a paired device needs nobody at a Linux host that has a desktop session. The update that first brings the helper still installs through `pkexec rpm -U` or `pkexec dpkg -i` and asks for the password once. Windows and macOS hosts install without a prompt.

## Preview proof

Open Settings in the built Tantalus Preview app, confirm the displayed version, and click Check for updates. Capture the window after the action returns. It must show `Dev and preview builds do not check for updates.` Metadata, release notes, notice acknowledgement, progress, signature verification, privilege prompt, tray item, relaunch, and fresh-install fallback need an installed release with a suitable newer signed release and are unreachable from Preview by design. Record that prerequisite rather than simulating a release in Preview. The same holds for a paired device: Preview proves the check button, the host's refusal, the endpoints and the reconnect after a host restart (see `remote-access.md` and `host-link.md`), and `vp test src/main/web-server.test.ts src/main/host-link.test.ts` covers a found update, the acknowledgements, a failed install and an install the host drops. Never install or update the release app during verification.

The release notes parser runs offline in `vp test src/main/release.test.ts`, which covers both formats. To prove it against the live listing, save `https://api.github.com/repos/zytact/tantalus/releases?per_page=100` into the evidence directory, run `parseReleases` from `src/main/release.ts` over it from a temporary Vitest file, and delete that file afterwards. Every change must read as plain text with no Markdown, links, or commit hashes left in it.

## Root helper proof

The helper only does anything once a package has installed it, so this proof installs the preview rpm on a Fedora host, and it needs the user at the keyboard for two password prompts: the first install and the removal. Ask before each. It never touches the release app, whose package, helper and action have other names. There is no harness for the deb, which needs a Debian or Ubuntu machine with a desktop session, since polkit does not behave in a container.

The preview trusts the release key, which is not on a development machine. `signed-preview-rpm.sh RELEASE` builds a preview rpm that trusts a throwaway key kept in the run directory and signs it with that key. It patches the key in `dist-electron/` only, and packs again on exit so the next build trusts the release key.

```sh
PROOF=$(.agents/skills/verify-tantalus/scripts/run-dir.sh)/update-proof
.agents/skills/verify-tantalus/scripts/signed-preview-rpm.sh 1
.agents/skills/verify-tantalus/scripts/signed-preview-rpm.sh 2
pkcheck --action-id org.freedesktop.policykit.exec --process $$   # the old path: auth_admin, exit 2
pkexec rpm -U "$PROOF/tantalus-preview-1.rpm"                      # password, the first install
pkcheck --action-id dev.arnab.tantalus.preview.update --process $$ # exit 0, no password needed
HELPER=/usr/libexec/tantalus-preview-update
pkexec $HELPER bm90IGEgc2lnbmF0dXJl <"$PROOF/tantalus-preview-2.rpm"                          # refused
pkexec $HELPER "$(cat "$PROOF/tantalus-preview-1.rpm.sig")" <"$PROOF/tantalus-preview-2.rpm"  # refused
pkexec $HELPER "$(cat "$PROOF/tantalus-preview-2.rpm.sig")" <"$PROOF/tantalus-preview-2.rpm"  # updates, no password
pkexec $HELPER "$(cat "$PROOF/tantalus-preview-1.rpm.sig")" <"$PROOF/tantalus-preview-1.rpm"  # refused as older
pkexec rpm -e tantalus-preview                                     # password, the removal
```

Run `rpm -q tantalus-preview tantalus` after each step. Each refusal must exit 1 within seconds, leave the installed release number alone and print `the update failed its signature check`, or rpm's `is already installed` for the older release. The update must exit 0 with no prompt and raise the release number. A refusal that takes as long as typing a password means polkit asked. Finish by confirming `rpm -q tantalus` still reports the release app and `rpm -q tantalus-preview` reports nothing.

Preview never runs its updater, so the app's own call into the helper stays unreachable from Preview. `vp test src/main/update-helper.test.ts` covers the helper's refusals offline.
