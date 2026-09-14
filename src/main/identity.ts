/** The two apps this code ships as. A preview installs beside the release and keeps its own name,
 * settings, open-at-login entry, single-instance lock and remote access ports. `scripts/package.ts`
 * bundles each one from this table, and the running app finds its entry again by the name it was
 * bundled with, so the tray icon can never disagree with the identity. */
export const identities = {
  release: {
    productName: "Tantalus",
    appId: "dev.arnab.tantalus",
    executableName: "tantalus",
    icons: "build/icons",
    ports: { web: 4747, tailscale: 8443 },
  },
  preview: {
    productName: "Tantalus Preview",
    appId: "dev.arnab.tantalus.preview",
    executableName: "tantalus-preview",
    icons: "build/icons/preview",
    ports: { web: 4748, tailscale: 8444 },
  },
} as const;

export type Identity = (typeof identities)[keyof typeof identities];
