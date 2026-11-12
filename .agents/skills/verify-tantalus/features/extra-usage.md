# Extra usage

Claude's paid overflow entry follows Reset credits in the Claude section, for direct sign-ins and CLIProxyAPI accounts alike. Codex and Opencode have no equivalent field or section. `parse.ts extraUsage` converts reported minor-unit spend and limit using the provider's decimal places. `presentation.ts remainingCredits` subtracts spend from the limit and clamps the balance between zero and that limit. Unknown spend or limit reads Unavailable.

The entry is named Extra usage. Its headline adds up the remaining budget of the accounts that have it switched on, with the provider's currency and decimal places, and reads `Off` when none has. Under it each account has a column: a bar of the share of its monthly limit left, then its balance and `of <monthly limit>`. An account with it switched off reads `Off`, and one that reports no extra-usage object reads `Not reported`. The entry is absent when no account reports one. `spendTotal` and `accountSpend` in `presentation.ts` build the headline and the columns.

## Preview proof

On `--mock ready`, scroll the Claude Extra usage entry into view and capture it in light and dark. The headline reads 37.50 USD, over one column reading `37.50 USD of 50.00 USD`. Add the fixture hub per `proxy-hubs.md` and confirm hub Claude shows the same balance. On `hub-multiple` the headline reads 75.00 USD over two such columns. On `blocked`, Extra usage is absent. The presentation tests cover missing spend, missing limit, and spending beyond the limit without displaying a negative balance.
