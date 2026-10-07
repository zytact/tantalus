# Extra usage

Claude's paid overflow section follows Reset credits for direct sign-ins and CLIProxyAPI accounts. Codex and Opencode have no equivalent field or section. `parse.ts extraUsage` converts reported minor-unit spend and limit using the provider's decimal places. `presentation.ts remainingCredits` subtracts spend from the limit and clamps the balance between zero and that limit. Unknown spend or limit reads Unavailable.

The section is named Extra usage. Its headline shows the remaining budget with the provider's currency and decimal places. Its subtitle reads remaining while enabled and off otherwise. Monthly limit stays below it. An absent extra-usage object omits the section.

## Preview proof

On `--mock ready`, scroll the direct Claude Extra usage section into view and capture it in light and dark. The headline reads 37.50 USD remaining from a 50.00 USD limit and 12.50 USD spent. Add the fixture hub per `proxy-hubs.md` and confirm hub Claude shows the same balance. On `blocked`, Extra usage is absent. The presentation tests cover missing spend, missing limit, and spending beyond the limit without displaying a negative balance.
