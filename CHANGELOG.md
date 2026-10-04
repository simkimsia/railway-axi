# Changelog

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
