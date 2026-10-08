# Changelog

## [0.1.0](https://github.com/zytact/tantalus/compare/v0.0.37...v0.1.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* **remote:** browsers that opened the remote page before this release must pair with a one-time code from Settings.

### Features

* **remote:** follow another Tantalus instead of signing in on every machine ([#122](https://github.com/zytact/tantalus/issues/122)) ([0cd54e1](https://github.com/zytact/tantalus/commit/0cd54e1e72bf1b7edfb663c7af12975d8816cd95))
* **remote:** require pairing before another device reads usage ([#121](https://github.com/zytact/tantalus/issues/121)) ([6e7ebd4](https://github.com/zytact/tantalus/commit/6e7ebd45d5a8be5a114946c5f7d4ad17e460fc97))

## [0.0.37](https://github.com/zytact/tantalus/compare/v0.0.36...v0.0.37) (2026-10-08)


### Bug Fixes

* **pace:** face the dragon and tortoise toward 0% remaining ([#118](https://github.com/zytact/tantalus/issues/118)) ([f14be46](https://github.com/zytact/tantalus/commit/f14be469d8b0c94318d09c19c929fe827d85f6be))

## [0.0.36](https://github.com/zytact/tantalus/compare/v0.0.35...v0.0.36) (2026-10-07)


### Features

* **usage:** show remaining allowance first ([#115](https://github.com/zytact/tantalus/issues/115)) ([b717cbd](https://github.com/zytact/tantalus/commit/b717cbd42f4381ba10db8d2444fdd0098594e9b3))

## [0.0.35](https://github.com/zytact/tantalus/compare/v0.0.34...v0.0.35) (2026-10-05)


### Features

* **tray:** shrink the usage number and cut its linux panel width from 70px to 32px ([#114](https://github.com/zytact/tantalus/issues/114)) ([7df1be8](https://github.com/zytact/tantalus/commit/7df1be86cb09c0872cafa5822cf4f2bf79632751))


### Bug Fixes

* **update:** show what's new as clean text for release-please releases ([#112](https://github.com/zytact/tantalus/issues/112)) ([a219b0d](https://github.com/zytact/tantalus/commit/a219b0d11d3a31ba02e0edd7f8053607a4246bae))

## [0.0.34](https://github.com/zytact/tantalus/compare/v0.0.33...v0.0.34) (2026-10-05)


### Features

* **tray:** add up a hub's accounts in the tray and name accounts by email ([#110](https://github.com/zytact/tantalus/issues/110)) ([44339e1](https://github.com/zytact/tantalus/commit/44339e1df4cfc83864049397081fbc6d5b95b32b))

## [0.0.33](https://github.com/zytact/tantalus/compare/v0.0.32...v0.0.33) (2026-10-05)


### Performance Improvements

* **pace:** stop freezing the app while saving what it learned ([#107](https://github.com/zytact/tantalus/issues/107)) ([6270bff](https://github.com/zytact/tantalus/commit/6270bffe5f5f61a0e88630531e74d09c30e8ad12))
* **usage:** show each account as soon as it's read instead of waiting for slow hubs ([#109](https://github.com/zytact/tantalus/issues/109)) ([d86958f](https://github.com/zytact/tantalus/commit/d86958f04590e7b3f9e65d710ea7e037de7b3000))

## [0.0.32](https://github.com/zytact/tantalus/compare/v0.0.31...v0.0.32) (2026-10-05)


### Bug Fixes

* **settings:** replace the white native account dropdown with a glass menu that follows dark mode ([#104](https://github.com/zytact/tantalus/issues/104)) ([7ab4491](https://github.com/zytact/tantalus/commit/7ab449187c5f1ea91a8c54394ff4101c1116a62e))
* **settings:** say hub window starts are waiting, not "not started" ([#106](https://github.com/zytact/tantalus/issues/106)) ([59ac6b3](https://github.com/zytact/tantalus/commit/59ac6b38d4428c0f169676440ad636f8c9cf0f1c))

## [0.0.31](https://github.com/zytact/tantalus/compare/v0.0.30...v0.0.31) (2026-10-05)


### Features

* **settings:** list each account under 5-hour window starts ([#101](https://github.com/zytact/tantalus/issues/101)) ([411fb42](https://github.com/zytact/tantalus/commit/411fb42b26e5d592548bbdefa8abcc54ef51e491))
* **tray:** show your 5-hour usage right in the tray icon ([#103](https://github.com/zytact/tantalus/issues/103)) ([f7fc056](https://github.com/zytact/tantalus/commit/f7fc0566c9f4fad08d6cabbd640c710369d8d00d))


### Bug Fixes

* **hubs:** number hub accounts per provider, not across the hub ([#99](https://github.com/zytact/tantalus/issues/99)) ([f5679be](https://github.com/zytact/tantalus/commit/f5679be8d483b5d0f5ba2ce7bd8987ea186baf3f))
* **window-start:** wait a full grace after a provider is switched back on ([#102](https://github.com/zytact/tantalus/issues/102)) ([5f8428a](https://github.com/zytact/tantalus/commit/5f8428ae52071cf2a0d3988e4e5af3aa398ee207))

## [0.0.30](https://github.com/zytact/tantalus/compare/v0.0.29...v0.0.30) (2026-10-05)


### Features

* **hubs:** enforce provider ownership and add dashboard controls ([#94](https://github.com/zytact/tantalus/issues/94)) ([755c8a3](https://github.com/zytact/tantalus/commit/755c8a3774920b1ae066ba4dc1448b0da61b3ea1))
* **usage:** share usual usage learning by provider and tier ([#95](https://github.com/zytact/tantalus/issues/95)) ([aa68af0](https://github.com/zytact/tantalus/commit/aa68af0bea5660bcc61d632da864e52386f0f956))
* **usage:** start hub windows independently for each account ([#92](https://github.com/zytact/tantalus/issues/92)) ([2516001](https://github.com/zytact/tantalus/commit/251600159d3af147c3c5066b0d06aa565de32586))


### Bug Fixes

* **settings:** show start controls for available providers ([#93](https://github.com/zytact/tantalus/issues/93)) ([0d19031](https://github.com/zytact/tantalus/commit/0d1903117027ae18a8ddabca2fd02d529a3cbbda))
* **verification:** seed shared-tier usual pace ([#97](https://github.com/zytact/tantalus/issues/97)) ([1dc5350](https://github.com/zytact/tantalus/commit/1dc5350f105f972649cf5439bf76375ac17545f5))

## [0.0.29](https://github.com/zytact/tantalus/compare/v0.0.28...v0.0.29) (2026-10-03)


### Features

* **usage:** start 5-hour windows for every polled provider with one switch ([#87](https://github.com/zytact/tantalus/issues/87)) ([2322b73](https://github.com/zytact/tantalus/commit/2322b7314bb6f4a518d54f20a3b0df3bc24cc21e))


### Bug Fixes

* **usage:** avoid waking claude for transient api failures ([#89](https://github.com/zytact/tantalus/issues/89)) ([3a01219](https://github.com/zytact/tantalus/commit/3a0121994ebc5fcfb3e04a45573525d410596846))

## [0.0.28](https://github.com/zytact/tantalus/compare/v0.0.27...v0.0.28) (2026-10-03)


### Features

* **usage:** wake a stale claude sign-in so usage reads again (beta) ([#85](https://github.com/zytact/tantalus/issues/85)) ([cba5efd](https://github.com/zytact/tantalus/commit/cba5efd9561dad5ca38e23326da26fa90c20d353))

## [0.0.27](https://github.com/zytact/tantalus/compare/v0.0.26...v0.0.27) (2026-10-01)


### Features

* **usage:** start idle Claude and Codex windows so the limit resets sooner ([#83](https://github.com/zytact/tantalus/issues/83)) ([35d01f9](https://github.com/zytact/tantalus/commit/35d01f9d3fbe39b9880395d27910af8f35e2f8e7))

## [0.0.26](https://github.com/zytact/tantalus/compare/v0.0.25...v0.0.26) (2026-09-30)


### Bug Fixes

* **pace:** keep depletion and reset times apart in the wording ([#79](https://github.com/zytact/tantalus/issues/79)) ([5197440](https://github.com/zytact/tantalus/commit/51974407b02f9f71b7d096f22fe220d650a41bb3))
