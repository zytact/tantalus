# Proxy hubs

Settings lists CLIProxyAPI hubs under `Proxy hubs`. `Add hub` opens a form with `Hub URL`, `Management key`, and an optional `Label`. The main process reads a new hub before saving it, so a URL or key that does not work is never saved and the form shows `Could not add the proxy hub.` with the cause. The saved key stays in the main process, so an edit starts with the key blank and a blank key keeps the old one. A new URL or key is read again before saving; a new label alone is not.

Each hub row has a `<label> proxy hub` switch, `Edit <label>`, and `Remove`. A switched-on hub gets its own allowance section after the direct providers, with one block per pooled Codex or Claude account (`<Provider> account <n>`), and its own tray block. A hub that refuses its key stops being read until it is switched off and on again. Each hub account learns its own pace, apart from the direct provider.

## Preview proof

On `--mock ready`, open Settings, click `Add hub`, then `drive.ts fill textbox "Hub URL" http://127.0.0.1:<fixture port>` (from `/tmp/opencode/tantalus-verify/fixture.port`), `fill textbox "Management key" fixture-management`, and `fill textbox "Label Optional" "Fixture hub"`. Click the form's `Add hub`. Settings must list `Fixture hub` with its switch on, and Allowance must show `Fixture hub` with a Codex Pro and a Claude Max 5x account. Any other key gets a 401 from the fixture and must not be saved. Click `Remove` before teardown.
