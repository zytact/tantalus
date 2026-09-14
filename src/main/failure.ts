const messages = {
  missingFile: "No sign-in was found for this provider",
  parse: "The sign-in file is not valid JSON",
  missingToken: "The sign-in file is missing an access token",
  timeout: "The usage service did not respond in time",
  request: "The usage service could not be reached",
  response: "The usage service returned an unexpected response",
} as const;

/** Why a provider could not be read. The message is what the window shows. */
export class ReadFailure extends Error {
  constructor(readonly reason: keyof typeof messages) {
    super(messages[reason]);
  }
}
