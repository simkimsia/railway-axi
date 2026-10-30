# Changelog

## [0.1.4](https://github.com/simkimsia/railway-axi/compare/railway-axi-v0.1.3...railway-axi-v0.1.4) (2026-10-30)


### Bug Fixes

* **ssh:** allow tail -c+5 / -c-5 and document refused glued counts ([ad9c67c](https://github.com/simkimsia/railway-axi/commit/ad9c67c2169e3a40164f3bf584437e56276c005a)), closes [#39](https://github.com/simkimsia/railway-axi/issues/39)

## [0.1.3](https://github.com/simkimsia/railway-axi/compare/railway-axi-v0.1.2...railway-axi-v0.1.3) (2026-10-23)


### Features

* add redeploy command ([208b559](https://github.com/simkimsia/railway-axi/commit/208b5591ee72e2da787698e26fde44d7120a5724)), closes [#29](https://github.com/simkimsia/railway-axi/issues/29)
* add ssh command for one-off read-only container commands ([cab9a0d](https://github.com/simkimsia/railway-axi/commit/cab9a0d36a95a07ff5bd2cebc7f9947d32d31dc9)), closes [#28](https://github.com/simkimsia/railway-axi/issues/28) [#32](https://github.com/simkimsia/railway-axi/issues/32)


### Bug Fixes

* read tail +N as a count only before a file operand ([1784787](https://github.com/simkimsia/railway-axi/commit/178478717fcef0dc879d6493d9b46b5db0d538f4)), closes [#35](https://github.com/simkimsia/railway-axi/issues/35)
* refuse obsolete head/tail count syntax that hides a file ([f15f13b](https://github.com/simkimsia/railway-axi/commit/f15f13b25c31329090327b692e5732e7a96a817a)), closes [#35](https://github.com/simkimsia/railway-axi/issues/35)
* restrict ssh file commands to allowlisted paths ([326ebab](https://github.com/simkimsia/railway-axi/commit/326ebabc1577c6ccefa630460109040e9a8632ba)), closes [#35](https://github.com/simkimsia/railway-axi/issues/35)
* shell-quote scope values in printed next-step hints ([a811f49](https://github.com/simkimsia/railway-axi/commit/a811f49b15971da1f689d57f60ad0c27b40404e6)), closes [#32](https://github.com/simkimsia/railway-axi/issues/32)

## [0.1.2](https://github.com/simkimsia/railway-axi/compare/railway-axi-v0.1.1...railway-axi-v0.1.2) (2026-10-07)


### Features

* AXI_DEBUG=1 prints forwarded railway argv to stderr ([a9da1d1](https://github.com/simkimsia/railway-axi/commit/a9da1d1a2650ef13e37a708b783b909805ef5f71)), closes [#26](https://github.com/simkimsia/railway-axi/issues/26)


### Bug Fixes

* give the remaining validation errors a next step ([d6c92a5](https://github.com/simkimsia/railway-axi/commit/d6c92a5d34c572934402c8489e33e412b18f1a6b))

## [0.1.1](https://github.com/simkimsia/railway-axi/compare/railway-axi-v0.1.0...railway-axi-v0.1.1) (2026-10-04)


### Features

* add read-only services, deployments, and logs commands ([607d8d2](https://github.com/simkimsia/railway-axi/commit/607d8d24337a0eba8e598c44c98dde971e27fa96)), closes [#3](https://github.com/simkimsia/railway-axi/issues/3) [#1](https://github.com/simkimsia/railway-axi/issues/1)
* **logs:** add --fields to show structured log attributes ([f445bed](https://github.com/simkimsia/railway-axi/commit/f445bed27aef5a1a48584111c8f6c011e3f7ee43)), closes [#6](https://github.com/simkimsia/railway-axi/issues/6)
* scaffold railway-axi on axi-sdk-js ([fe3f568](https://github.com/simkimsia/railway-axi/commit/fe3f568b0f4b009b584fd3079064fdcdf9f7e3eb))
* ship installable agent skill with vendor-cli fallback protocol ([8d025ad](https://github.com/simkimsia/railway-axi/commit/8d025ade8d63a631202da9af78a595345df35249))
* **variables:** add variables list, get and set ([6f112e7](https://github.com/simkimsia/railway-axi/commit/6f112e7bc5b8a075ff3baa6f3279102c82f1c224)), closes [#10](https://github.com/simkimsia/railway-axi/issues/10)


### Bug Fixes

* keep SDK error codes in formatError and give UNKNOWN errors a next step ([2adcba9](https://github.com/simkimsia/railway-axi/commit/2adcba9680e15d66dc5f0fd45905dd3870485d3c)), closes [#17](https://github.com/simkimsia/railway-axi/issues/17)
* **logs:** suggest only effective --fields in the attributes hint ([ee9a916](https://github.com/simkimsia/railway-axi/commit/ee9a916f2373b012ea9fe3f497d9200607a42cdd))
* **variables:** mask every argv token not known to be safe ([c92fe78](https://github.com/simkimsia/railway-axi/commit/c92fe7819edf25e733d705cdb1d4059a32f3a0ac)), closes [#10](https://github.com/simkimsia/railway-axi/issues/10)
