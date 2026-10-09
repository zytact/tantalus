import { failureMessages } from "../shared/failure";
import type { ReadFailureReason } from "../shared/failure";

/** Why a provider could not be read. The message is what the window shows. */
export class ReadFailure extends Error {
  constructor(readonly reason: ReadFailureReason) {
    super(failureMessages[reason]);
  }
}

/** A rejection as an `Error`, so a failed read can stand in for its reading. */
export const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));
