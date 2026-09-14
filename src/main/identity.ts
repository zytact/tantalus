/** The two apps this code ships as. A preview installs beside the release and keeps its own name,
 * settings, open-at-login entry and single-instance lock. `scripts/package.ts` bundles each one
 * from this table, and the running app finds its entry again by the name it was bundled with, so
 * the tray icon can never disagree with the identity. */
export const identities = {
  release: {
    productName: "Tantalus",
    appId: "dev.arnab.tantalus",
    executableName: "tantalus",
    icons: "build/icons",
  },
  preview: {
    productName: "Tantalus Preview",
    appId: "dev.arnab.tantalus.preview",
    executableName: "tantalus-preview",
    icons: "build/icons/preview",
  },
} as const;

export type Identity = (typeof identities)[keyof typeof identities];
