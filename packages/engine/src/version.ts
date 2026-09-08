/**
 * 引擎版本（#12 版本策略）：游戏内页脚版本行展示用。
 *
 * 单一事实源 = 本常量；packages/engine/package.json 的 version 须与之一致
 * （tests/version.test.ts 钉住漂移，发版两处一起改）。不读 package.json——
 * engine 零环境依赖，bundle 内联常量在浏览器/打包产物均可用。
 */
export const ENGINE_VERSION = '0.1.0';
