import { failureMessages } from "../shared/failure";
import type { ReadFailureReason } from "../shared/failure";

/** Why a provider could not be read. The message is what the window shows. */
export class ReadFailure extends Error {
  constructor(readonly reason: ReadFailureReason) {
    super(failureMessages[reason]);
  }
}
