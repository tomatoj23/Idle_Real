/**
 * 西方魔幻迷你包（Batch1/T6 验收 tracer，#28）。
 *
 * 徒手按协议层（schema+校验+文档）编写的第二题材冒烟包：验证协议层自足、
 * 零引擎改动即可组装第二题材（非第二款游戏本体，只验就绪度）。
 * 与修仙包同律（ADR-017）：不被任何框架代码 import，由壳层/测试显式装配。
 * 暴露原始 JSON 供测试/工具检视，`loadFantasyPack` 负责强校验装配
 * （启动期 fail-fast：坏内容绝不进入运行时）。
 */

import packJson from './fantasy.json';
import { formatContentErrors, validateContentPack } from '../schema/index.js';
import type { ContentPack } from '../schema/index.js';

/** 西方魔幻迷你包原始 JSON（未校验形态）。 */
export const fantasyPackJson: unknown = packJson;

/** 加载并强校验西方魔幻迷你包；失败即抛错（启动期 fail-fast）。 */
export function loadFantasyPack(): ContentPack {
  const result = validateContentPack(fantasyPackJson);
  if (!result.ok) {
    throw new Error(`西方魔幻迷你包校验失败：\n${formatContentErrors(result.errors)}`);
  }
  return result.pack;
}
