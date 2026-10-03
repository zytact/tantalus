export const failureMessages = {
  missingFile: "No sign-in was found for this provider",
  parse: "The sign-in file is not valid JSON",
  missingToken: "The sign-in file is missing an access token",
  expired: "The sign-in has expired",
  rejected: "The usage service rejected the sign-in",
  timeout: "The usage service did not respond in time",
  request: "The usage service could not be reached",
  response: "The usage service returned an unexpected response",
} as const;

export type ReadFailureReason = keyof typeof failureMessages;
