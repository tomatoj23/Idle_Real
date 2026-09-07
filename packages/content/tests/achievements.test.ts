import { describe, expect, it } from 'vitest';
import { validateContentPack } from '../src/index.js';
import type { ContentError } from '../src/index.js';
import { loadXiuxianPack } from '../src/packs/xiuxian.js';
import { loadFantasyPack } from '../src/packs/fantasy.js';
import { minimalPack } from './fixtures.js';

/**
 * #9 验收：achievements 节协议面——
 * - schema 关卡：形状/边界逐字段拒绝；
 * - 语义关卡：id 去重、统计键域闭集（引擎 STAT_KEYS 镜像）、奖励物品 xref；
 * - 可选节零破坏：缺节照常通过；双题材包装配校验通过（换包即换成就）。
 */

const VALID = {
  id: 'kill_100',
  name: '百战',
  icon: '战',
  description: '累计击杀 100 只',
  condition: { stat: 'kills', target: 100 },
  reward: { gold: 200, items: [{ item: 'herb1', count: 3 }] },
};

function expectError(
  result: { readonly ok: boolean; readonly errors?: readonly ContentError[] },
  path: string,
  keyword: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }
  const hit = result.errors.find((e) => e.path === path && e.keyword === keyword);
  expect(hit, `期望 ${path} [${keyword}]，实际：${JSON.stringify(result.errors)}`).toBeDefined();
}

/** minimalPack + 成就节（单点破坏断言基底）。 */
function makePack(achievements: unknown): Record<string, unknown> {
  return { ...minimalPack(), achievements } as Record<string, unknown>;
}

describe('#9 · achievements schema 关卡', () => {
  it('合法条目通过（阈值型 + 反向阈值 + 布尔型 + 隐藏 + 全量奖励）', () => {
    const pack = makePack([
      VALID,
      { id: 'fast_3', name: '速胜', condition: { stat: 'fastestKill', op: 'lte', target: 3 } },
      { id: 'died', name: '败中求生', hidden: true, condition: { stat: 'deaths' } },
      { id: 'rich', name: '千金', condition: { stat: 'kills' }, reward: { daoYun: 5 } },
    ]);
    const result = validateContentPack(pack);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  it('缺 id / name / condition 被拒（required）', () => {
    const noId = [{ ...VALID }] as Record<string, unknown>;
    delete noId[0]['id'];
    expectError(validateContentPack(makePack(noId)), '/achievements/0/id', 'required');

    const noName = [{ ...VALID }] as Record<string, unknown>;
    delete noName[0]['name'];
    expectError(validateContentPack(makePack(noName)), '/achievements/0/name', 'required');

    const noCond = [{ ...VALID }] as Record<string, unknown>;
    delete noCond[0]['condition'];
    expectError(validateContentPack(makePack(noCond)), '/achievements/0/condition', 'required');
  });

  it('id 形态非法（大写开头 / 连字符）被拒', () => {
    expectError(validateContentPack(makePack([{ ...VALID, id: 'Kill_100' }])), '/achievements/0/id', 'pattern');
    expectError(validateContentPack(makePack([{ ...VALID, id: 'kill-100' }])), '/achievements/0/id', 'pattern');
  });

  it('condition.target 0 / 非整数 / op 越界被拒', () => {
    expectError(
      validateContentPack(makePack([{ ...VALID, condition: { stat: 'kills', target: 0 } }])),
      '/achievements/0/condition/target',
      'minimum',
    );
    expectError(
      validateContentPack(makePack([{ ...VALID, condition: { stat: 'kills', target: 1.5 } }])),
      '/achievements/0/condition/target',
      'type',
    );
    expectError(
      validateContentPack(makePack([{ ...VALID, condition: { stat: 'kills', target: 10, op: 'gt' } }])),
      '/achievements/0/condition/op',
      'enum',
    );
  });

  it('未知字段 / 空奖励对象被拒（additionalProperties / minProperties）', () => {
    expectError(
      validateContentPack(makePack([{ ...VALID, secret: true }])),
      '/achievements/0/secret',
      'additionalProperties',
    );
    expectError(
      validateContentPack(makePack([{ ...VALID, reward: {} }])),
      '/achievements/0/reward',
      'minProperties',
    );
    expectError(
      validateContentPack(makePack([{ ...VALID, reward: { gems: 1 } }])),
      '/achievements/0/reward/gems',
      'additionalProperties',
    );
  });
});

describe('#9 · achievements 语义关卡', () => {
  it('id 重复被拒（state.achievements 存档键）', () => {
    expectError(validateContentPack(makePack([VALID, { ...VALID }])), '/achievements/1', 'duplicate');
  });

  it('条件统计键不在引擎注册表 → xref（闭集收口，死条件加载期拒绝）', () => {
    expectError(
      validateContentPack(makePack([{ ...VALID, condition: { stat: 'luck', target: 1 } }])),
      '/achievements/0/condition/stat',
      'xref',
    );
  });

  it('布尔型条件（无 target）声明 op → shape（引擎静默忽略 op 的语义缝隙，加载期拒绝）', () => {
    expectError(
      validateContentPack(makePack([{ ...VALID, condition: { stat: 'deaths', op: 'lte' } }])),
      '/achievements/0/condition/op',
      'shape',
    );
  });

  it('奖励物品不存在于 items → xref', () => {
    expectError(
      validateContentPack(makePack([{ ...VALID, reward: { items: [{ item: 'ghost', count: 1 }] } }])),
      '/achievements/0/reward/items/0/item',
      'xref',
    );
  });

  it('奖励物品为 equip 类 → xref（装备须走掉落/炼制管线实例化，整袋发放成死物）', () => {
    const pack = makePack([
      { ...VALID, reward: { items: [{ item: 'sword1', count: 1 }] } },
    ]) as Record<string, unknown>;
    (pack['items'] as Array<{ id: string; type?: string }>).push({
      id: 'sword1',
      name: '青锋剑',
      icon: '剑',
      type: 'equip',
      sell: 30,
      slot: 'weapon',
      bonuses: { atk: 6 },
    });
    expectError(validateContentPack(pack), '/achievements/0/reward/items/0/item', 'xref');
  });

  it('缺 achievements 节照常通过（可选节零破坏）', () => {
    expect(validateContentPack(minimalPack()).ok).toBe(true);
    expect(validateContentPack(makePack([])).ok).toBe(true); // 空表合法（无成就玩法）
  });
});

describe('#9 · 双题材包装配（换包即换成就，引擎零改动）', () => {
  it('修仙包成就节在案：阈值/反向/布尔/隐藏四型齐备', () => {
    const pack = loadXiuxianPack();
    expect(pack.achievements!.length).toBe(11);
    const byId = Object.fromEntries(pack.achievements!.map((a) => [a.id, a]));
    expect(byId['kill_100']!.condition).toEqual({ stat: 'kills', target: 100 });
    expect(byId['fast_kill_3']!.condition).toEqual({ stat: 'fastestKill', op: 'lte', target: 3 });
    expect(byId['first_death']!.hidden).toBe(true);
    expect(byId['first_death']!.condition.target).toBeUndefined(); // 布尔型
    expect(byId['dungeon_floor_15']!.reward).toEqual({ daoYun: 20 });
    // 统计标签表覆盖引擎注册表（壳统计区呈现面由包声明）。
    expect(Object.keys(pack.texts.shell.pages.achievements.statLabels)).toEqual([
      'kills', 'deaths', 'rebirths', 'cycles', 'dungeonFloorBest', 'maxHit', 'fastestKill',
    ]);
    expect(pack.texts.shell.tabs.achievements).toBe('成就');
    expect(pack.texts.shell.events.achievementToast).toContain('{name}');
  });

  it('西方魔幻迷你包成就节在案（第二题材样张：同引擎不同成就表）', () => {
    const pack = loadFantasyPack();
    expect(pack.achievements!.length).toBe(7);
    const ids = pack.achievements!.map((a) => a.id);
    expect(ids).not.toEqual(loadXiuxianPack().achievements!.map((a) => a.id));
    expect(ids).toContain('kill_25');
    expect(pack.texts.shell.tabs.achievements).toBe('Feats');
    expect(pack.texts.shell.pages.achievements.statLabels['fastestKill']).toContain('rounds');
  });
});
