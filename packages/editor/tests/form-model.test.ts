import { describe, expect, it } from 'vitest';
import { sectionSchemas, validateContent, type JsonSchema } from '@wendao/content';
import { branchSkeleton, preserveFields, skeletonOf, switchBranch } from '../src/core/defaults.js';
import { buildFormNode, entrySchemaOf, type ArrayNode, type DictNode, type ObjectNode, type OneOfNode } from '../src/core/model.js';

/** 节 schema 投影为控件树（节根，字段名取节名）。 */
function formOf(section: keyof typeof sectionSchemas): ReturnType<typeof buildFormNode> {
  const schema = sectionSchemas[section] as JsonSchema;
  return buildFormNode(schema, schema, '', section, true);
}

describe('form model：节 schema → 控件树', () => {
  it('enemies：array 节 → 条目为封闭对象，required 字段齐全', () => {
    const root = formOf('enemies') as ArrayNode;
    expect(root.kind).toBe('array');
    const item = root.item as ObjectNode;
    expect(item.kind).toBe('object');
    const required = item.fields.filter((f) => f.required).map((f) => f.field);
    expect(required).toEqual(
      expect.arrayContaining(['id', 'name', 'icon', 'level', 'kind', 'hp', 'atk', 'def', 'drops']),
    );
    // 可选字段（系别/原型继承）不进 required。
    expect(required).not.toContain('element');
  });

  it('$ref 解析：enemy 条目内层字段类型正确', () => {
    const root = formOf('enemies') as ArrayNode;
    const fields = (root.item as ObjectNode).fields;
    const byField = Object.fromEntries(fields.map((f) => [f.field, f]));
    // hp/attackInterval 是 number（schema 钉 minimum/exclusiveMinimum 边界）。
    expect(byField['hp']!.kind).toBe('number');
    expect(byField['attackInterval']!.kind).toBe('number');
    // gold 是封闭对象（min/max 必填）。
    const gold = byField['gold'] as ObjectNode;
    expect(gold.kind).toBe('object');
    expect(gold.fields.map((f) => f.field).sort()).toEqual(['max', 'min']);
    // drops 是数组，条目含 item（跨引用 items）与 chance。
    const drops = byField['drops'] as ArrayNode;
    expect(drops.kind).toBe('array');
    const drop = drops.item as ObjectNode;
    expect(drop.fields.map((f) => f.field).sort()).toEqual(['chance', 'item']);
  });

  it('跨引用标注：drops[].item→items、enemy.element→elements、recipe.skill→skills', () => {
    const enemies = formOf('enemies') as ArrayNode;
    const enemyFields = (enemies.item as ObjectNode).fields;
    const byEnemyField = Object.fromEntries(enemyFields.map((f) => [f.field, f]));
    expect(byEnemyField['element']!.xref).toBe('elements');
    const drops = byEnemyField['drops'] as ArrayNode;
    const dropItem = ((drops.item as ObjectNode).fields.find((f) => f.field === 'item'))!;
    expect(dropItem.xref).toBe('items');

    const recipes = formOf('recipes') as ArrayNode;
    const recipeSkill = ((recipes.item as ObjectNode).fields.find((f) => f.field === 'skill'))!;
    expect(recipeSkill.xref).toBe('skills');
  });

  it('items：oneOf 五形态分支，判别值与中文形态名', () => {
    const root = formOf('items') as ArrayNode;
    const item = root.item as OneOfNode;
    expect(item.kind).toBe('oneOf');
    expect(item.branches.map((b) => b.discriminator)).toEqual([
      'mat',
      'consumable',
      'equip',
      'blank',
      'inscription',
    ]);
    expect(item.branches.map((b) => b.label)).toEqual(['材料', '消耗品', '装备', '器胚', '铭纹']);
    // mat 分支内 type 字段是单值 select（判别锁定）。
    const mat = item.branches[0]!.node as ObjectNode;
    const typeField = mat.fields.find((f) => f.field === 'type')!;
    expect(typeField.kind).toBe('select');
    expect((typeField as unknown as { options: { value: string }[] }).options).toEqual([
      { value: 'mat', label: 'mat' },
    ]);
  });

  it('enum 字段：modifier.zone 与 skill.kind', () => {
    const skills = formOf('skills') as ArrayNode;
    const kind = ((skills.item as ObjectNode).fields.find((f) => f.field === 'kind'))!;
    expect(kind.kind).toBe('select');
    expect((kind as unknown as { options: { value: string }[] }).options.map((o) => o.value)).toEqual([
      'gather',
      'craft',
      'combat',
    ]);

    // 铭纹 tiers 内 modifier.zone（深嵌套 $ref）。
    const items = formOf('items') as ArrayNode;
    const inscription = (items.item as OneOfNode).branches[4]!.node as ObjectNode;
    const tiers = inscription.fields.find((f) => f.field === 'tiers') as ArrayNode;
    const tierRow = tiers.item as ArrayNode;
    const modifier = tierRow.item as ObjectNode;
    const zone = modifier.fields.find((f) => f.field === 'zone')!;
    expect(zone.kind).toBe('select');
  });

  it('开放键值容器：combatText.moves/verbs → dict，texts.reasonMap → additionalProperties dict', () => {
    const combatText = formOf('combatText') as ObjectNode;
    const byField = Object.fromEntries(combatText.fields.map((f) => [f.field, f]));
    const moves = byField['moves'] as DictNode;
    expect(moves.kind).toBe('dict');
    expect(moves.valueNode.kind).toBe('array');
    expect((moves.valueNode as ArrayNode).item.kind).toBe('string');
    // verbs 键 pattern + 值为 {v, limbs} 对象数组。
    const verbs = byField['verbs'] as DictNode;
    expect(verbs.kind).toBe('dict');
    expect(verbs.keyPattern).toBeDefined();
    expect((verbs.valueNode as ArrayNode).item.kind).toBe('object');
  });

  it('materials 字典键标注 items 引用（配方材料键=物品 id）', () => {
    const recipes = formOf('recipes') as ArrayNode;
    const materials = ((recipes.item as ObjectNode).fields.find((f) => f.field === 'materials'))!;
    expect(materials.kind).toBe('dict');
    expect((materials as DictNode).keyXref).toBe('items');
    expect((materials as DictNode).valueNode.kind).toBe('integer');
  });

  it('全 16 节可投影（渲染器覆盖面守卫）', () => {
    for (const section of Object.keys(sectionSchemas)) {
      const node = formOf(section as keyof typeof sectionSchemas);
      expect(['array', 'object'], `${section} 投影失败`).toContain(node.kind);
    }
  });

  it('#61 repeatable：天赋条目可选对象字段，maxStacks 必填整数、costs 可选整数组（schema 驱动免费面）', () => {
    const rebirth = formOf('rebirth') as ObjectNode;
    const talents = (rebirth.fields.find((f) => f.field === 'talents')) as ArrayNode;
    const repeatable = (talents.item as ObjectNode).fields.find((f) => f.field === 'repeatable');
    expect(repeatable?.kind).toBe('object');
    expect(repeatable?.required).toBe(false); // 可选字段走「添加字段」入口
    const byField = Object.fromEntries((repeatable as ObjectNode).fields.map((f) => [f.field, f]));
    expect(byField['maxStacks']!.kind).toBe('integer');
    expect(byField['maxStacks']!.required).toBe(true);
    expect(byField['costs']?.kind).toBe('array');
    expect((byField['costs'] as ArrayNode | undefined)?.item.kind).toBe('integer');
  });
});

describe('骨架值', () => {
  it('enemy 骨架：required 齐全且可直接过节 schema（pattern/minLength/exclusiveMinimum 全落合法值）', () => {
    const root = formOf('enemies') as ArrayNode;
    const skeleton = skeletonOf(root.item);
    const result = validateContent([skeleton], sectionSchemas['enemies'] as JsonSchema);
    expect(result.ok ? '' : JSON.stringify(result.errors, null, 1)).toBe('');
    const byField = skeleton as Record<string, unknown>;
    expect(Object.keys(byField).sort()).toEqual(
      [
        'id',
        'name',
        'icon',
        'level',
        'kind',
        'hp',
        'atk',
        'def',
        'attackInterval',
        'exp',
        'gold',
        'drops',
      ].sort(),
    );
    // pattern 字段给了样例；exclusiveMinimum(0) 字段给了 1。
    expect(byField['id']).toBe('placeholder');
    expect(byField['attackInterval']).toBe(1);
    // 可选字段不出现。
    expect('element' in byField).toBe(false);
  });

  it('enemy 骨架可直接过条目级校验（entrySchemaOf 的 $ref 根）', () => {
    const root = formOf('enemies') as ArrayNode;
    const skeleton = skeletonOf(root.item);
    const result = validateContent(skeleton, entrySchemaOf(sectionSchemas['enemies'] as JsonSchema));
    expect(result.ok).toBe(true);
  });

  it('item 骨架走首分支 mat，type 判别值已写入，直接过节 schema', () => {
    const root = formOf('items') as ArrayNode;
    const skeleton = skeletonOf(root.item) as Record<string, unknown>;
    expect(skeleton['type']).toBe('mat');
    const result = validateContent([skeleton], sectionSchemas['items'] as JsonSchema);
    expect(result.ok ? '' : JSON.stringify(result.errors, null, 1)).toBe('');
  });

  it('分支骨架：切到 equip 时 slot 不缺席且可直接过校验', () => {
    const root = formOf('items') as ArrayNode;
    const equip = branchSkeleton(root.item as OneOfNode, 'equip') as Record<string, unknown>;
    expect(equip['type']).toBe('equip');
    expect('slot' in equip).toBe(true);
    const result = validateContent([equip], sectionSchemas['items'] as JsonSchema);
    expect(result.ok).toBe(true);
  });

  it('verbs 骨架带 basic 恒需键，且骨架是合法动词池', () => {
    const combatText = formOf('combatText') as ObjectNode;
    const verbs = combatText.fields.find((f) => f.field === 'verbs')!;
    const skeleton = skeletonOf(verbs) as Record<string, unknown>;
    expect(Object.keys(skeleton)).toEqual(['basic']);
    expect(Array.isArray(skeleton['basic'])).toBe(true);
    expect((skeleton['basic'] as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('preserveFields：形态切换保留公共面', () => {
  const oldMat = {
    id: 'qi9',
    name: '上好灵石',
    icon: '石',
    type: 'mat',
    sell: 99,
    description: '灵气充裕',
  };

  it('切 equip：id/name/icon/sell/description 保留，判别字段锁定为 equip', () => {
    const root = formOf('items') as ArrayNode;
    const merged = switchBranch(oldMat, root.item as OneOfNode, 'equip') as Record<string, unknown>;
    expect(merged['id']).toBe('qi9');
    expect(merged['name']).toBe('上好灵石');
    expect(merged['type']).toBe('equip');
    expect('slot' in merged).toBe(true);
    // mat 分支的 description 覆盖了骨架空串——保留旧值。
    expect(merged['description']).toBe('灵气充裕');
  });

  it('标量类型不符时落骨架值（不迁腐数据）', () => {
    expect(preserveFields({ hp: 'many' }, { hp: 0 })).toEqual({ hp: 0 });
    expect(preserveFields({ tags: 'fire' }, { tags: [] })).toEqual({ tags: [] });
  });
});

/* ==================== #45 字段知识回迁 schema 通道 ==================== */

describe('#45 字段级展示知识全部来自 schema 关键字', () => {
  it('schema 属性无 title 时回显原始键名（D3 零兜底：标签表已退役，无第二份查找）', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        named: { type: 'string', title: '有名字' },
        unnamed: { type: 'string' },
      },
      required: ['named', 'unnamed'],
      additionalProperties: false,
    };
    const node = buildFormNode(schema, schema, '', 'demo', true) as ObjectNode;
    const byField = Object.fromEntries(node.fields.map((f) => [f.field, f]));
    expect(byField['named']!.label).toBe('有名字');
    expect(byField['unnamed']!.label).toBe('unnamed');
  });

  it('验收 2 深度证明：新增测试节只写 schema（title/x-xref），表单树自动携带中文标签与引用域——零 editor 代码/表改动', () => {
    // 虚构新节「灵兽」：只写 schema，不经任何 editor 注册/字典。
    const schema: JsonSchema = {
      type: 'array',
      title: '灵兽',
      items: {
        type: 'object',
        required: ['id', 'name', 'masterItem'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          name: { type: 'string', title: '名称', minLength: 1 },
          masterItem: { type: 'string', title: '本命物', 'x-xref': 'items' },
        },
      },
    };
    const node = buildFormNode(schema, schema, '', 'beasts', true) as ArrayNode;
    // 节级 title 即导航/标题展示名（render/main/panel 直接读 schema.title）。
    expect(schema.title).toBe('灵兽');
    const item = node.item as ObjectNode;
    const byField = Object.fromEntries(item.fields.map((f) => [f.field, f]));
    expect(byField['name']!.label).toBe('名称');
    expect(byField['masterItem']!.label).toBe('本命物');
    expect(byField['masterItem']!.xref).toBe('items');
    // 未写 title 的字段回显键名。
    expect(byField['id']!.label).toBe('id');
  });

  it('x-xref 双读：$ref 目标定义声明生效，属性级声明优先', () => {
    const schema: JsonSchema = {
      type: 'object',
      definitions: { itemRef: { type: 'string', 'x-xref': 'items' } },
      properties: {
        viaDef: { $ref: '#/definitions/itemRef' },
        viaProp: { $ref: '#/definitions/itemRef', 'x-xref': 'skills' },
      },
      additionalProperties: false,
    };
    const node = buildFormNode(schema, schema, '', 'demo', true) as ObjectNode;
    const byField = Object.fromEntries(node.fields.map((f) => [f.field, f]));
    expect(byField['viaDef']!.xref).toBe('items');
    expect(byField['viaProp']!.xref).toBe('skills');
  });

  it('数组条目继承容器 x-xref（pool 条目=物品引用，与旧字段名传播同形）', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        pool: { type: 'array', 'x-xref': 'items', items: { type: 'string' } },
      },
      additionalProperties: false,
    };
    const node = buildFormNode(schema, schema, '', 'demo', true) as ObjectNode;
    const pool = node.fields[0] as ArrayNode;
    expect(pool.xref).toBe('items');
    expect(pool.item.xref).toBe('items');
  });

  it('混合形态开放键值面：minProperties 驱动骨架占位键（equip.bonuses 过新 required）', () => {
    const root = formOf('items') as ArrayNode;
    const equip = branchSkeleton(root.item as OneOfNode, 'equip') as Record<string, unknown>;
    expect(equip['slot']).toBe('placeholder');
    expect(equip['bonuses']).toBeTruthy();
    const result = validateContent([equip], sectionSchemas['items'] as JsonSchema);
    expect(result.ok ? '' : JSON.stringify(result.errors)).toBe('');
  });
});
