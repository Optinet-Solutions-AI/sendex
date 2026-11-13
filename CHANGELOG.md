# Changelog

## 1.0.0 (2026-11-13)


### Features

* **core:** phone normalisation, logical check, lap planning and ranking (D1-17, D2-03) ([#3](https://github.com/Optinet-Solutions-AI/sendex/issues/3)) ([d9a937a](https://github.com/Optinet-Solutions-AI/sendex/commit/d9a937a25fce6dcee849ccbcaea8eb553be6c75a))
* day 1 integration, lists, campaigns, send engine, billing ([#15](https://github.com/Optinet-Solutions-AI/sendex/issues/15)) ([291ab21](https://github.com/Optinet-Solutions-AI/sendex/commit/291ab21667c2b6573d53dc750c86416c60804050))
* day 2 integration, smpp, links, postbacks, api, ops ([#19](https://github.com/Optinet-Solutions-AI/sendex/issues/19)) ([6e1580d](https://github.com/Optinet-Solutions-AI/sendex/commit/6e1580d78cc040552f905e4304e025b493707b41))
* **links:** production KV namespaces and worker origin for wrangler deploy (D1-08) ([#35](https://github.com/Optinet-Solutions-AI/sendex/issues/35)) ([daaddb2](https://github.com/Optinet-Solutions-AI/sendex/commit/daaddb2c49805c334041a51613b3840de08650eb))
* **providers:** 23Telecom REST adapter, delivery webhook and sandbox route (D2-22) ([#37](https://github.com/Optinet-Solutions-AI/sendex/issues/37)) ([16554bc](https://github.com/Optinet-Solutions-AI/sendex/commit/16554bc2d9f5aaadddcdf653a1f6273993b02cf0))
* **providers:** adapter for SMS Edge on the platform routes with status polling (D2-24) ([#40](https://github.com/Optinet-Solutions-AI/sendex/issues/40)) ([f09f454](https://github.com/Optinet-Solutions-AI/sendex/commit/f09f454e65b01f9311b60e89e6f9232bbd01d8e9))
* **ui:** app shell and primitives after the SMS Edge spec (D4-01) ([#46](https://github.com/Optinet-Solutions-AI/sendex/issues/46)) ([753934a](https://github.com/Optinet-Solutions-AI/sendex/commit/753934a84edfc8f2a0cc43ecee6ced23e98df4b2))
* **web:** a label for every campaign status (D4-08) ([#66](https://github.com/Optinet-Solutions-AI/sendex/issues/66)) ([0f23ab6](https://github.com/Optinet-Solutions-AI/sendex/commit/0f23ab6da5016f79c8814c22e7f318ff98b6c983))
* **web:** campaign page after the SMS Edge spec: laps, AutoSender, routes performance, list filters (D4-02) ([#48](https://github.com/Optinet-Solutions-AI/sendex/issues/48)) ([275f7e0](https://github.com/Optinet-Solutions-AI/sendex/commit/275f7e03c0a9d67f6534be2ca161655ec7b8c0b2))
* **web:** filter campaigns by offer, sender ID and minimum results (D4-13) ([#71](https://github.com/Optinet-Solutions-AI/sendex/issues/71)) ([fbf3328](https://github.com/Optinet-Solutions-AI/sendex/commit/fbf33289c35646980393f5e1e5690ed428a8bd0c))
* **web:** lists, upload, files, list details, unsubscribe and segments after the spec (D4-03, D4-04) ([#49](https://github.com/Optinet-Solutions-AI/sendex/issues/49)) ([59db244](https://github.com/Optinet-Solutions-AI/sendex/commit/59db24426d7dd2cd2e1c19a6c95b658da6d79176))
* **web:** only the United Kingdom can be picked, other countries stay visible (D4-19) ([#79](https://github.com/Optinet-Solutions-AI/sendex/issues/79)) ([de7d4e1](https://github.com/Optinet-Solutions-AI/sendex/commit/de7d4e10280313cbf7663dc68639bea608dae3cf))
* **web:** pages on the new shell: dashboard, campaigns, lists, settings, euro symbol (D4-01) ([#47](https://github.com/Optinet-Solutions-AI/sendex/issues/47)) ([5c8ad0d](https://github.com/Optinet-Solutions-AI/sendex/commit/5c8ad0d1aada107391b0ef0aad6587bec75359c4))
* **web:** remove the routes that brought no clicks after a test (D4-18) ([#78](https://github.com/Optinet-Solutions-AI/sendex/issues/78)) ([4b85302](https://github.com/Optinet-Solutions-AI/sendex/commit/4b85302a72c188da2059ea8805790971a76f350e))
* **web:** reports, dashboard tabs, routes pages and numbers verification (D4-05, D4-06, D4-07) ([#50](https://github.com/Optinet-Solutions-AI/sendex/issues/50)) ([cba52db](https://github.com/Optinet-Solutions-AI/sendex/commit/cba52db4287bc654db4aa79162fa80b430303cd2))
* **web:** same-day and late conversions (D4-12) ([#70](https://github.com/Optinet-Solutions-AI/sendex/issues/70)) ([1495889](https://github.com/Optinet-Solutions-AI/sendex/commit/149588928c082c8fe1cc4530dee57d735be2f33f))
* **web:** save a campaign's routes and copy them on duplicate (D4-09) ([#68](https://github.com/Optinet-Solutions-AI/sendex/issues/68)) ([220517e](https://github.com/Optinet-Solutions-AI/sendex/commit/220517ee5c5037ed74c5ae8f7cbccd71530c5b0f))
* **web:** settings pages say when the worker is not deployed (D3-21) ([#32](https://github.com/Optinet-Solutions-AI/sendex/issues/32)) ([4f12424](https://github.com/Optinet-Solutions-AI/sendex/commit/4f12424933e355a4582baf277b3d652af21c57b9))
* **web:** sort the campaigns list by any column (D4-10) ([#67](https://github.com/Optinet-Solutions-AI/sendex/issues/67)) ([b3b3939](https://github.com/Optinet-Solutions-AI/sendex/commit/b3b39396025fbbc80bd1e9ae078e502307e50a36))
* **web:** suggested sending hours with a notice on the campaign (D4-14) ([#72](https://github.com/Optinet-Solutions-AI/sendex/issues/72)) ([01a06f3](https://github.com/Optinet-Solutions-AI/sendex/commit/01a06f301d9e5051b30540b91615a8d45e969c17))
* **web:** upload contacts import step after SMS Edge (D4-03) ([#52](https://github.com/Optinet-Solutions-AI/sendex/issues/52)) ([83d6320](https://github.com/Optinet-Solutions-AI/sendex/commit/83d6320bbda57cd1070ee712d6d74bba098ab131))
* **worker:** a simple postback URL for trackers that cannot sign (D4-11) ([#69](https://github.com/Optinet-Solutions-AI/sendex/issues/69)) ([e79b413](https://github.com/Optinet-Solutions-AI/sendex/commit/e79b413f66e8735ab730fd36bf0ad95b01eea2f5))
* **worker:** country prefixes in the send allowlist (D2-18) ([#44](https://github.com/Optinet-Solutions-AI/sendex/issues/44)) ([a804c97](https://github.com/Optinet-Solutions-AI/sendex/commit/a804c97be73c7916e1988c695a97a5f5f90ff6c3))
* **worker:** poll 23Telecom for receipts when the delivery webhook is lost (D2-23) ([#39](https://github.com/Optinet-Solutions-AI/sendex/issues/39)) ([4f0d242](https://github.com/Optinet-Solutions-AI/sendex/commit/4f0d242d82613153892901dd742d2bc66d975f37))
* **worker:** send allowlist for first live sends, Philippines as a country (D2-18) ([#43](https://github.com/Optinet-Solutions-AI/sendex/issues/43)) ([be7b3f3](https://github.com/Optinet-Solutions-AI/sendex/commit/be7b3f335cbcc1eb61c6fd90f292bdb1966e5ead))


### Bug fixes

* **ci:** run gitleaks from its container instead of the licensed action (D1-03) ([#1](https://github.com/Optinet-Solutions-AI/sendex/issues/1)) ([3110c1b](https://github.com/Optinet-Solutions-AI/sendex/commit/3110c1b102fcb441434d6ff56bf6c88a725fb9a8))
* **core:** upload reads 49… numbers as mobiles and rejects spreadsheet-damaged ones (D4-16) ([#75](https://github.com/Optinet-Solutions-AI/sendex/issues/75)) ([458811c](https://github.com/Optinet-Solutions-AI/sendex/commit/458811cbc0ba8a6933febe7a6077b4fd6c1a6c0a))
* **db:** count first deposits only as sales, as SMS Edge's Sales (FTD) ([#56](https://github.com/Optinet-Solutions-AI/sendex/issues/56)) ([3cfb72b](https://github.com/Optinet-Solutions-AI/sendex/commit/3cfb72b50e34c90c5df195ad02742bd8b40f65ea))
* **lint:** leave markdown and astro files to their own tools (D1-03) ([#4](https://github.com/Optinet-Solutions-AI/sendex/issues/4)) ([503d46d](https://github.com/Optinet-Solutions-AI/sendex/commit/503d46d2101df5b6c279e9ac2c6fa51adc6b8146))
* **web:** ask for the password in place on deposit, API tokens and secret rotation (D4-15) ([#73](https://github.com/Optinet-Solutions-AI/sendex/issues/73)) ([c604aa5](https://github.com/Optinet-Solutions-AI/sendex/commit/c604aa5054ed1d801881af014abb6a2eb1683644))
* **web:** count the real link in ad texts, enforce Long message, render last name and words (D4-02) ([#55](https://github.com/Optinet-Solutions-AI/sendex/issues/55)) ([188cb31](https://github.com/Optinet-Solutions-AI/sendex/commit/188cb316ab270194274309333c0350f3c0ea50a6))
* **web:** keep the stage-two payment labels inside their buttons (D4-02) ([#62](https://github.com/Optinet-Solutions-AI/sendex/issues/62)) ([a8c53f1](https://github.com/Optinet-Solutions-AI/sendex/commit/a8c53f1a4fcac4dd71f8a81150225bf0d38d8a91))
* **web:** label the Send Calendar's days as UTC (D4-02) ([#59](https://github.com/Optinet-Solutions-AI/sendex/issues/59)) ([8c4542b](https://github.com/Optinet-Solutions-AI/sendex/commit/8c4542b46ebbd7b3e93eeb22b672b83f9cf0a72e))
* **web:** logs tabs, archived list menu and phone width from QA round two (D4-02) ([#58](https://github.com/Optinet-Solutions-AI/sendex/issues/58)) ([80acd0c](https://github.com/Optinet-Solutions-AI/sendex/commit/80acd0c2c0f8e5bfab4a31429b23cb162fd0f377))
* **web:** one Filters button and Export CSV outside the filter row on campaigns (D4-02) ([#53](https://github.com/Optinet-Solutions-AI/sendex/issues/53)) ([defa207](https://github.com/Optinet-Solutions-AI/sendex/commit/defa20728b3c92f92d6c5add1f4edea8be657b07))
* **web:** price the send estimate and budget top-ups per SMS part (D4-02) ([#57](https://github.com/Optinet-Solutions-AI/sendex/issues/57)) ([15745fe](https://github.com/Optinet-Solutions-AI/sendex/commit/15745fec3e9b02e999011157367f70a5336fcd1e))
* **web:** the dashboard counts a sale on the day it was made (D4-17) ([#77](https://github.com/Optinet-Solutions-AI/sendex/issues/77)) ([0a46ad7](https://github.com/Optinet-Solutions-AI/sendex/commit/0a46ad7b094b399b013eb6a03b7ecdeee1898329))
* **worker:** bundle the worker with esbuild so the container image runs (D1-07) ([#34](https://github.com/Optinet-Solutions-AI/sendex/issues/34)) ([0d61606](https://github.com/Optinet-Solutions-AI/sendex/commit/0d616060d787790d15acd46786ef270a291bd6c3))
* **worker:** retire sandbox ids under a live key, cap and back off the 23Telecom poll (D2-23) ([#45](https://github.com/Optinet-Solutions-AI/sendex/issues/45)) ([69aa8ed](https://github.com/Optinet-Solutions-AI/sendex/commit/69aa8ed8ced85a9f58ea2fa12373b51aef15721d))


### Performance

* **web:** resolve the tenant in one query and cache it per request (D3-22) ([#33](https://github.com/Optinet-Solutions-AI/sendex/issues/33)) ([9b22d3e](https://github.com/Optinet-Solutions-AI/sendex/commit/9b22d3e41dab2794f7e69e0577c0a4f00b239f39))
* **worker:** cut idle Redis commands: 30 s drain delay and cached health depths (D3-23) ([#42](https://github.com/Optinet-Solutions-AI/sendex/issues/42)) ([232268e](https://github.com/Optinet-Solutions-AI/sendex/commit/232268eaebedac2d578fc0f378c4c9d751ef9b39))


### Documentation

* 23telecom is on its REST API, and the worker connects again ([#74](https://github.com/Optinet-Solutions-AI/sendex/issues/74)) ([5666b06](https://github.com/Optinet-Solutions-AI/sendex/commit/5666b06c2266b97b052c58e2bdc61f25a77c70ca))
* add ADRs 0001-0004 and the local setup runbook (D3-16) ([#2](https://github.com/Optinet-Solutions-AI/sendex/issues/2)) ([e73a22b](https://github.com/Optinet-Solutions-AI/sendex/commit/e73a22ba5bd068ee1a3d791e2134b7ea1644610d))
* decisions to confirm with Meny and Alex ([#54](https://github.com/Optinet-Solutions-AI/sendex/issues/54)) ([16c0f75](https://github.com/Optinet-Solutions-AI/sendex/commit/16c0f75865798046772ce9f871dea58f42b9a3ae))
* first live 23telecom messages and what they showed ([#76](https://github.com/Optinet-Solutions-AI/sendex/issues/76)) ([d98757b](https://github.com/Optinet-Solutions-AI/sendex/commit/d98757b2c2e02d45660dabe170043ecc3c1688f6))
* **providers:** static egress IP for 23Telecom whitelisting (D2-00) ([#36](https://github.com/Optinet-Solutions-AI/sendex/issues/36)) ([c28298c](https://github.com/Optinet-Solutions-AI/sendex/commit/c28298c0cfe2be81b8b25bdeae3270b1d929156b))
* record the 23telecom connection refusal and how to test it ([#64](https://github.com/Optinet-Solutions-AI/sendex/issues/64)) ([966c99b](https://github.com/Optinet-Solutions-AI/sendex/commit/966c99bf3d1bf2d7f8e33c33f58c8f7cd259e8db))
* record the first answers on costs and conversions ([#61](https://github.com/Optinet-Solutions-AI/sendex/issues/61)) ([c53a304](https://github.com/Optinet-Solutions-AI/sendex/commit/c53a3041a8dcc9f3d45ecf8153dabc01ef2702c3))
* record the second round of answers to the decisions ([#65](https://github.com/Optinet-Solutions-AI/sendex/issues/65)) ([419a4a6](https://github.com/Optinet-Solutions-AI/sendex/commit/419a4a68a5e94b163881342440f90a5864ef5461))
* walkthrough of the TechSMS app for the team ([#63](https://github.com/Optinet-Solutions-AI/sendex/issues/63)) ([fe032d1](https://github.com/Optinet-Solutions-AI/sendex/commit/fe032d1ee959b78bfb748a0d9596413ce5b8d588))
