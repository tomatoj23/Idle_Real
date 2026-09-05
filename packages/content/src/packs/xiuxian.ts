/**
 * 《问道长生》修仙题材包（ADR-017 题材包层，#23）。
 *
 * 题材包不再具有"引擎缺省包"地位：框架主入口（`@wendao/content`）零题材，
 * 本模块不被任何框架代码 import——由游戏壳（app-desktop 等）显式装配。
 * 暴露原始 JSON 供测试/工具检视，`loadXiuxianPack` 负责强校验装配
 * （启动期 fail-fast：坏内容绝不进入运行时）。
 */

import packJson from './xiuxian.json';
import { formatContentErrors, validateContentPack } from '../schema/index.js';
import type { ContentPack } from '../schema/index.js';

/** 修仙题材包原始 JSON（未校验形态）。 */
export const xiuxianPackJson: unknown = packJson;

/** 加载并强校验修仙题材包；失败即抛错（启动期 fail-fast）。 */
export function loadXiuxianPack(): ContentPack {
  const result = validateContentPack(xiuxianPackJson);
  if (!result.ok) {
    throw new Error(`修仙题材包校验失败：\n${formatContentErrors(result.errors)}`);
  }
  return result.pack;
}
