/**
 * True in the standalone Android build, where the server runs inside the app (see src/standalone). There is one
 * local account, no uploads and no sign-in through the services.
 */
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

let saveNow: (() => Promise<void>) | null = null;

/** Set by the standalone runtime: writes changes that are still waiting to be saved. */
export function setSaveNow(save: () => Promise<void>) {
  saveNow = save;
}

/** Call before the app leaves its page itself, so the last changes are not lost with it. */
export async function beforeLeave() {
  await saveNow?.().catch(() => {});
}
