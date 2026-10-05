# Changelog

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
