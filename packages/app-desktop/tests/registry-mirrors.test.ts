import { describe, expect, it } from 'vitest';
import {
  ELEMENT_COMBAT_PRIMITIVES as ENGINE_PRIMITIVES,
  INSCRIPTION_FEATURE_PRIMITIVES as ENGINE_FEATURES,
  KEEP_KEYS as ENGINE_KEEP,
  RESET_KEYS as ENGINE_RESET,
  STAT_KEYS as ENGINE_STATS,
} from '@wendao/engine';
import {
  ELEMENT_COMBAT_PRIMITIVES as PACK_PRIMITIVES,
  INSCRIPTION_FEATURE_PRIMITIVES as PACK_FEATURES,
  REBIRTH_KEEP_KEYS as PACK_KEEP,
  REBIRTH_RESET_KEYS as PACK_RESET,
  STAT_KEYS as PACK_STATS,
} from '@wendao/content';

/**
 * 引擎↔content 注册表镜像同值对拍（#75 项 3，快照法钉期望值；#58 项 2 增
 * 铭纹 feature 原语注册表一行）：
 * content schema 侧手工镜像（pack.ts：机制原语 / 统计键 / 重置+保留键域 /
 * 铭纹 feature 原语）与 engine 同名注册表（combat.ts / stats.ts / state.ts
 * 字段表派生 / contentView.ts）靠人工同步，漂移此前无人报警。本文件把期望值
 * 钉成快照，两侧各对拍一次——任一侧偏离快照即红（「改引擎忘了改镜像」与
 * 「改镜像忘了改引擎」两向都抓）。
 *
 * 放装配层（app-desktop）：content 不引 engine 纪律不动，对拍只能在两侧
 * 都可见处做；键集按集合语义比较（镜像是 Set，序无意）。
 */
const EXPECTED = {
  elementCombatPrimitives: ['defenseBreak', 'slow', 'swift'],
  statKeys: ['cycles', 'deaths', 'dungeonFloorBest', 'fastestKill', 'kills', 'maxHit', 'rebirths'],
  rebirthResetKeys: ['buffs', 'gold', 'items', 'lastEncounter', 'skills'],
  rebirthKeepKeys: ['gear'],
  inscriptionFeaturePrimitives: { chainBolt: 'probability', poisonSpread: 'probability' },
};

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe('注册表镜像对拍（#75 项 3）', () => {
  it('机制原语闭集：engine ↔ content 镜像 ↔ 快照三方同值', () => {
    expect(sorted(ENGINE_PRIMITIVES)).toEqual(EXPECTED.elementCombatPrimitives);
    expect(sorted(PACK_PRIMITIVES)).toEqual(EXPECTED.elementCombatPrimitives);
  });

  it('统计键闭集：engine ↔ content 镜像 ↔ 快照三方同值', () => {
    expect(sorted(ENGINE_STATS)).toEqual(EXPECTED.statKeys);
    expect(sorted(PACK_STATS)).toEqual(EXPECTED.statKeys);
  });

  it('兵解重置键域：engine 字段表派生 ↔ content 镜像 ↔ 快照三方同值', () => {
    expect(sorted(ENGINE_RESET)).toEqual(EXPECTED.rebirthResetKeys);
    expect(sorted(PACK_RESET)).toEqual(EXPECTED.rebirthResetKeys);
  });

  it('兵解保留键域：engine 字段表派生 ↔ content 镜像 ↔ 快照三方同值', () => {
    expect(sorted(ENGINE_KEEP)).toEqual(EXPECTED.rebirthKeepKeys);
    expect(sorted(PACK_KEEP)).toEqual(EXPECTED.rebirthKeepKeys);
  });

  it('铭纹 feature 原语注册表：engine ↔ content 镜像 ↔ 快照三方同值（键与值域类别）', () => {
    expect({ ...ENGINE_FEATURES }).toEqual(EXPECTED.inscriptionFeaturePrimitives);
    expect({ ...PACK_FEATURES }).toEqual(EXPECTED.inscriptionFeaturePrimitives);
  });
});
