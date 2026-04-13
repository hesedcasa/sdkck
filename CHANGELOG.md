# Changelog

## [0.13.0](https://github.com/hesedcasa/sdkck/compare/v0.12.0...v0.13.0) (2026-04-13)


### 🎉 Features

* add comprehensive Sidekick user guide website ([#71](https://github.com/hesedcasa/sdkck/issues/71)) ([a6c44f4](https://github.com/hesedcasa/sdkck/commit/a6c44f4213323d69ad5fbd3ee9cd14115bf6d6d7))
* **docs:** configure static export and add GitHub Pages deployment ([#73](https://github.com/hesedcasa/sdkck/issues/73)) ([411657c](https://github.com/hesedcasa/sdkck/commit/411657c4bc40a8ab5b234297432037e81d9d0279))


### 🛠️ Fixes

* **docs:** add basePath for GitHub Pages subpath deployment ([1df36ea](https://github.com/hesedcasa/sdkck/commit/1df36ea5ca31b9a2a941714f4f58c50f342d6276))

## [0.12.0](https://github.com/hesedcasa/sdkck/compare/v0.11.0...v0.12.0) (2026-04-12)


### 🎉 Features

* add MCP server with search tool and sampling support ([#69](https://github.com/hesedcasa/sdkck/issues/69)) ([5ab797d](https://github.com/hesedcasa/sdkck/commit/5ab797dba1188e15b89fe63a9e7fc982d1fdbcb6))

## [0.11.0](https://github.com/hesedcasa/sdkck/compare/v0.10.0...v0.11.0) (2026-04-02)


### 🎉 Features

* **openapi:** add custom auth type with multiple arbitrary headers ([#63](https://github.com/hesedcasa/sdkck/issues/63)) ([1b02719](https://github.com/hesedcasa/sdkck/commit/1b02719e3821f5b7c3d8b2d3a29e2617940e339a))

## [0.10.0](https://github.com/hesedcasa/sdkck/compare/v0.9.2...v0.10.0) (2026-04-02)


### 🎉 Features

* add Claude Code plugin with sdkck MCP hook ([#53](https://github.com/hesedcasa/sdkck/issues/53)) ([a2567e8](https://github.com/hesedcasa/sdkck/commit/a2567e861e948db9b45f15d39ac5ccd79bf8624f))


### 📄 Documentation

* update Claude Code plugin install commands in README ([#62](https://github.com/hesedcasa/sdkck/issues/62)) ([cf91a2a](https://github.com/hesedcasa/sdkck/commit/cf91a2abe665005ba0fe3f21b91a8c383e2486a6))

## [0.9.2](https://github.com/hesedcasa/sdkck/compare/v0.9.1...v0.9.2) (2026-04-02)


### 🛠️ Fixes

* **search:** update tests to match new output format after UFuzzy refactor ([#59](https://github.com/hesedcasa/sdkck/issues/59)) ([055a4a8](https://github.com/hesedcasa/sdkck/commit/055a4a8cfe587287aba66be51a6e1d78be0c5d13))

## [0.9.1](https://github.com/hesedcasa/sdkck/compare/v0.9.0...v0.9.1) (2026-04-02)


### 🛠️ Fixes

* **search:** unwrap run() return value from results envelope ([#56](https://github.com/hesedcasa/sdkck/issues/56)) ([9eb5619](https://github.com/hesedcasa/sdkck/commit/9eb5619961827bc5da6993fd62824243363785fd))

## [0.9.0](https://github.com/hesedcasa/sdkck/compare/v0.8.0...v0.9.0) (2026-04-02)


### 🎉 Features

* **search:** add token-pool fuzzy scoring and --json output ([#54](https://github.com/hesedcasa/sdkck/issues/54)) ([6732caa](https://github.com/hesedcasa/sdkck/commit/6732caae2cab3e1a43385c4f4e94d2f0031d5372))

## [0.8.0](https://github.com/hesedcasa/sdkck/compare/v0.7.1...v0.8.0) (2026-03-23)


### 🎉 Features

* add Postman collection import support to openapi import command ([#41](https://github.com/hesedcasa/sdkck/issues/41)) ([75a6e0d](https://github.com/hesedcasa/sdkck/commit/75a6e0d1ba6947714a6e87ed9af682a253de60d8))


### 🛠️ Fixes

* remove accidental API key logging in search command ([#43](https://github.com/hesedcasa/sdkck/issues/43)) ([24c1be7](https://github.com/hesedcasa/sdkck/commit/24c1be7a9235d041094ecef4e0ffe14c58abc538))
* simplify openapi import output messages ([#44](https://github.com/hesedcasa/sdkck/issues/44)) ([80d0262](https://github.com/hesedcasa/sdkck/commit/80d0262ccb877c004c0d8d454b93fdff8dcc1464))

## [0.7.1](https://github.com/hesedcasa/sdkck/compare/v0.7.0...v0.7.1) (2026-03-22)


### 🛠️ Fixes

* make dynamic OpenAPI commands dispatchable and visible in commands list ([#39](https://github.com/hesedcasa/sdkck/issues/39)) ([b6a7ef2](https://github.com/hesedcasa/sdkck/commit/b6a7ef2612c0129ef2175eb4f072cca7914a2bca))

## [0.7.0](https://github.com/hesedcasa/sdkck/compare/v0.6.0...v0.7.0) (2026-03-22)


### 🎉 Features

* add JIT plugin auto-installation hook ([#11](https://github.com/hesedcasa/sdkck/issues/11)) ([93a3d0b](https://github.com/hesedcasa/sdkck/commit/93a3d0b01c6830bea8bc266557e86a5e0924b85c))
* add openapi import commands for auto-generating API calls from specs ([#34](https://github.com/hesedcasa/sdkck/issues/34)) ([3506daa](https://github.com/hesedcasa/sdkck/commit/3506daa79286ec3edceeed461bd3657b5509b2c3))
* add plugin command allowlist with allow/disallow/list/export/import/reset ([#26](https://github.com/hesedcasa/sdkck/issues/26)) ([ea5ad4d](https://github.com/hesedcasa/sdkck/commit/ea5ad4deda6c930da9278f4829286cb1f5c79633))
* improve search command with MCP sampling-inspired LLM search ([#18](https://github.com/hesedcasa/sdkck/issues/18)) ([b40d261](https://github.com/hesedcasa/sdkck/commit/b40d26191a88ed06196feb447a9ab8b72c11865a))
* initial commit ([323418d](https://github.com/hesedcasa/sdkck/commit/323418df991ced2d1e2da137101223686b1e798d))


### 🛠️ Fixes

* update fuzzy abbreviation test to avoid excluded plugin commands ([c0b4a63](https://github.com/hesedcasa/sdkck/commit/c0b4a63e2a1462c6bf57c4879f9a628d339b77a9))
* update fuzzy abbreviation test to avoid excluded plugin commands ([0c73528](https://github.com/hesedcasa/sdkck/commit/0c73528e0d36a02f895da5b1d079ee1e2d2a4583))


### 📄 Documentation

* overhaul README and add comprehensive wiki pages ([#33](https://github.com/hesedcasa/sdkck/issues/33)) ([3efe670](https://github.com/hesedcasa/sdkck/commit/3efe670552453e246dfe58403a394a88d2f485d7))
* update README to be more comprehensive ([#38](https://github.com/hesedcasa/sdkck/issues/38)) ([2e442e7](https://github.com/hesedcasa/sdkck/commit/2e442e793e1c9bb409025e47589a042113310433))
* update README.md ([3a270a3](https://github.com/hesedcasa/sdkck/commit/3a270a32da9a7f2adc6b990acdaf87bd7d3f9035))

## [0.6.0](https://github.com/hesedcasa/sdkck/compare/v0.5.1...v0.6.0) (2026-03-21)


### 🎉 Features

* add openapi import commands for auto-generating API calls from specs ([#34](https://github.com/hesedcasa/sdkck/issues/34)) ([3506daa](https://github.com/hesedcasa/sdkck/commit/3506daa79286ec3edceeed461bd3657b5509b2c3))

## [0.5.1](https://github.com/hesedcasa/sdkck/compare/v0.5.0...v0.5.1) (2026-03-20)


### 📄 Documentation

* overhaul README and add comprehensive wiki pages ([#33](https://github.com/hesedcasa/sdkck/issues/33)) ([3efe670](https://github.com/hesedcasa/sdkck/commit/3efe670552453e246dfe58403a394a88d2f485d7))

## [0.5.0](https://github.com/hesedcasa/sdkck/compare/v0.4.0...v0.5.0) (2026-03-18)


### 🎉 Features

* add plugin command allowlist with allow/disallow/list/export/import/reset ([#26](https://github.com/hesedcasa/sdkck/issues/26)) ([ea5ad4d](https://github.com/hesedcasa/sdkck/commit/ea5ad4deda6c930da9278f4829286cb1f5c79633))

## [0.4.0](https://github.com/hesedcasa/sdkck/compare/v0.3.0...v0.4.0) (2026-03-09)


### 🎉 Features

* improve search command with MCP sampling-inspired LLM search ([#18](https://github.com/hesedcasa/sdkck/issues/18)) ([b40d261](https://github.com/hesedcasa/sdkck/commit/b40d26191a88ed06196feb447a9ab8b72c11865a))

## [0.3.0](https://github.com/hesedcasa/sdkck/compare/v0.2.1...v0.3.0) (2026-03-04)


### 🎉 Features

* add JIT plugin auto-installation hook ([#11](https://github.com/hesedcasa/sdkck/issues/11)) ([93a3d0b](https://github.com/hesedcasa/sdkck/commit/93a3d0b01c6830bea8bc266557e86a5e0924b85c))

## [0.2.1](https://github.com/hesedcasa/sdkck/compare/v0.2.0...v0.2.1) (2026-02-26)


### 📄 Documentation

* update README.md ([3a270a3](https://github.com/hesedcasa/sdkck/commit/3a270a32da9a7f2adc6b990acdaf87bd7d3f9035))

## [0.2.0](https://github.com/hesedcasa/sdkck/compare/v0.1.0...v0.2.0) (2026-02-26)


### 🎉 Features

* initial commit ([323418d](https://github.com/hesedcasa/sdkck/commit/323418df991ced2d1e2da137101223686b1e798d))


### 🛠️ Fixes

* update fuzzy abbreviation test to avoid excluded plugin commands ([c0b4a63](https://github.com/hesedcasa/sdkck/commit/c0b4a63e2a1462c6bf57c4879f9a628d339b77a9))
* update fuzzy abbreviation test to avoid excluded plugin commands ([0c73528](https://github.com/hesedcasa/sdkck/commit/0c73528e0d36a02f895da5b1d079ee1e2d2a4583))

## Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
