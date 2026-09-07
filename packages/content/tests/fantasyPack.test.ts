import { describe, expect, it } from 'vitest';
import { formatContentErrors, validateContentPack } from '../src/index.js';
import { fantasyPackJson, loadFantasyPack } from '../src/packs/fantasy.js';

describe('西方魔幻迷你包 · 验收 tracer（#28）', () => {
  it('validateContentPack 通过', () => {
    const result = validateContentPack(fantasyPackJson);
    if (!result.ok) {
      console.error(formatContentErrors(result.errors));
    }
    expect(result.ok).toBe(true);
  });

  it('loadFantasyPack 强校验通过并返回完整包', () => {
    const pack = loadFantasyPack();
    expect(pack.skills).toHaveLength(3);
    expect(pack.items).toHaveLength(12);
    expect(pack.recipes).toHaveLength(1);
    expect(pack.enemies).toHaveLength(2);
    expect(pack.gearDrops).toHaveLength(1);
    expect(pack.rarities).toHaveLength(3);
    expect(pack.affixPool).toHaveLength(4);
    expect(pack.shop).toHaveLength(2);
  });

  it('自定义系别键域：arcane/shadow 自声明注册，敌人引用合法（#25 键域开放）', () => {
    const pack = loadFantasyPack();
    expect(pack.elements).toEqual([
      { id: 'arcane', name: 'Arcane' },
      { id: 'shadow', name: 'Shadow' },
    ]);
    const golem = pack.enemies.find((e) => e.id === 'arcane_golem');
    expect(golem?.element).toBe('arcane');
    expect(golem?.affinities).toEqual({ arcane: 50, shadow: -50 });
    // 无系别的洞蝠 = 凡击（缺省约定）。
    const bat = pack.enemies.find((e) => e.id === 'cave_bat');
    expect(bat?.element).toBeUndefined();
  });

  it('引擎兜底网：basic 招式与动词池齐备，引用面（verbStyle/kind/moves 注册键）全命中', () => {
    const pack = loadFantasyPack();
    const ct = pack.combatText;
    expect(ct.moves.basic?.length).toBeGreaterThan(0);
    expect(ct.verbs.basic?.length).toBeGreaterThan(0);
    // 开放键域自声明：sword（武器）/ beast、construct（敌人）三池在案。
    for (const style of ['sword', 'beast', 'construct'] as const) {
      expect(ct.verbs[style]?.length).toBeGreaterThan(0);
    }
    // 招式注册键 = basic + 武器 id + 敌人 id（语义校验闭世界）。
    expect(Object.keys(ct.moves).sort()).toEqual(
      ['basic', 'shortsword', 'rune_blade', 'cave_bat', 'arcane_golem'].sort(),
    );
    // 武器动词风格与敌人 kind 引用命中池。
    const weapons = pack.items.filter((it) => it.type === 'equip' && it.slot === 'weapon');
    for (const weapon of weapons) {
      expect(ct.verbs[weapon.verbStyle ?? 'basic']?.length).toBeGreaterThan(0);
    }
    for (const enemy of pack.enemies) {
      expect(ct.verbs[enemy.kind]?.length).toBeGreaterThan(0);
    }
  });

  it('稀有度/词条词表零默认自声明，showcase 特判走显式 bool（ADR-016）', () => {
    const pack = loadFantasyPack();
    expect(pack.rarities.map((r) => r.id)).toEqual(['plain', 'fine', 'mythic']);
    expect(pack.rarities.filter((r) => r.showcase).map((r) => r.id)).toEqual(['mythic']);
    expect(pack.affixPool.map((a) => a.stat)).toEqual(['atk', 'def', 'hp', 'crit']);
  });

  it('英语战斗文案十键齐备，模板槽在案（#027 非 CJK 上限假设的验收样张）', () => {
    const ct = loadFantasyPack().combatText;
    // 五池模板槽由 schema pattern 钉死；此处断言语义槽确实被使用。
    expect(ct.templates.playerLight[0]).toContain('{weapon}');
    expect(ct.templates.playerHeavy[0]).toContain('{opening}');
    expect(ct.templates.playerCrit[0]).toContain('{critIntro}');
    expect(ct.templates.enemyLight[0]).toContain('{enemy}');
    expect(ct.notes.start[0]).toContain('{enemy}');
    expect(ct.notes.autoConsume[0]).toContain('{item}');
    expect(ct.summary.base[0]).toContain('{rounds}');
    expect(ct.compare.even[0]).toContain('{rounds}');
  });

  it('texts.shell 英语品牌与量纲标记（#26 壳零题材字符串的第二题材样张）', () => {
    const pack = loadFantasyPack();
    expect(pack.texts.shell.brand.name).toBe('Grim Vale');
    expect(pack.texts.shell.brand.locale).toBe('en-US');
    expect(pack.texts.basicName).toBe('bare hands');
    // crit 百分比量纲显式声明，点数系无量纲标记（壳零量纲特判）。
    expect(pack.texts.shell.stats.labels.crit).toEqual({ label: 'CR', percent: true });
    expect(pack.texts.shell.stats.labels.atk).toEqual({ label: 'AT' });
  });

  it('craft 协议面第二题材样张：craft 页签/页面/事件文案英语齐备（#5）', () => {
    const pack = loadFantasyPack();
    expect(pack.texts.shell.tabs.craft).toBe('Crafting');
    expect(pack.texts.shell.pages.craft.title).toBe('Crafting');
    expect(pack.texts.shell.pages.craft.successRate).toContain('{rate}');
    expect(pack.texts.shell.pages.craft.matRow).toContain('{need}');
    expect(pack.texts.shell.events.lootCraft).toContain('{count}');
    expect(pack.texts.shell.events.craftFail).toContain('{name}');
    expect(pack.texts.shell.events.craftHalt).toContain('{name}');
  });

  it('config 槽位节：weapon/body/accessory 三槽英语命名（#16 槽位数据化）', () => {
    const pack = loadFantasyPack();
    expect(pack.config?.slots).toEqual([
      { id: 'weapon', name: 'Weapon', icon: 'W' },
      { id: 'body', name: 'Armor', icon: 'A' },
      { id: 'accessory', name: 'Charm', icon: 'C' },
    ]);
    expect(pack.config?.progression?.maxLevel).toBe(20);
  });

  it('dungeons 秘境样张：英语层表/层奖励/道韵门在案（#7 换包生效第二题材面）', () => {
    const pack = loadFantasyPack();
    expect(pack.dungeons).toHaveLength(1);
    const delve = pack.dungeons![0]!;
    expect(delve.id).toBe('sunken_crypt');
    expect(delve.floors).toBe(5);
    expect(delve.entry).toEqual({ daoYun: 3 });
    // 层表覆盖 5 层（3 行：1-2 / 3-4 / 5）；深层奖励含道韵（与转生联动）。
    expect(delve.layers.map((l) => l.floor)).toEqual([
      { min: 1, max: 2 },
      { min: 3, max: 4 },
      { min: 5, max: 5 },
    ]);
    expect(delve.layers[2]!.rewards).toEqual({
      gold: 200,
      daoYun: 2,
      items: [{ item: 'crystal', count: 4 }],
    });
    expect(delve.layers[0]!.recommendedPower).toEqual({ min: 15, max: 30 });
  });
});
