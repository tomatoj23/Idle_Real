/**
 * 跨测试共享的 texts.shell 夹具（#26 建；#43 D3 改造：键全集由生成器保证）。
 *
 * shell 入 schema required 后，一切"最小合法包"夹具都需要合法 shell 节。
 * 键全集不再手抄（曾与 schema/xiuxian/fantasy 三份镜像连环红），而是从
 * texts.schema.json 的 required/properties **机械生长**：
 * - 值源 = src/schema/textsSample.ts 的 shell 节（#43 D1 双钉样本，全仓唯一
 *   的手写 shell 值树）：语义约束键（locale pattern、statLabels 键域、负路径
 *   用例的破坏锚点）在手写侧维护，夹具与双钉样本共用——值漂移在两个消费面
 *   同时红，不再可能有第二份手抄；
 * - schema 新增 required 键 → 骨架自动长出机械占位（键名截断到 maxLength），
 *   夹具保持合法、测试不再连环红；语义值随后补写进 textsSample 即可
 *   （占位无语义，题材包语义由装配用例承载，见下）；
 * - schema 删除任一 required 键 → 骨架随之收键，依赖该键的负路径用例
 *   （delete 后断言 required）即刻红——键集与 schema 恒同形；
 * - 样本里多出的 schema 外键会原样流出 → validateContent
 *   additionalProperties 红，手写值映射自身也被钉住。
 *
 * 值刻意极短——形态合法性由本夹具承载；语义正确性由修仙/魔幻包装配用例
 * （xiuxianPack.test.ts / fantasyPack.test.ts）承载。
 */
import textsSchemaJson from '../src/schema/texts.schema.json';
import { textsSample } from '../src/schema/textsSample.js';

/** texts.schema.json 的最小 schema 视图（生长器只消费这几个关键字）。 */
interface SchemaNode {
  readonly $ref?: string;
  readonly type?: string;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly minLength?: number;
  readonly maxLength?: number;
}

const TEXTS_SCHEMA = textsSchemaJson as unknown as SchemaNode & {
  readonly definitions?: Readonly<Record<string, SchemaNode>>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** $ref 解析（仅 #/definitions/ 内部引用，与 validate.ts 同约定）。 */
function resolveNode(node: SchemaNode | undefined): SchemaNode {
  const ref = node?.$ref;
  if (ref !== undefined) {
    const target = TEXTS_SCHEMA.definitions?.[ref.slice('#/definitions/'.length)];
    if (target !== undefined) {
      return target;
    }
  }
  return node ?? {};
}

/** 机械占位：键名截到 maxLength，保证过 schema 边界（pattern/键域类约束仍须手写值）。 */
function placeholder(node: SchemaNode, key: string): unknown {
  if (node.type === 'boolean') return true;
  if (node.type === 'integer' || node.type === 'number') return 1;
  if (node.type === 'array') return [];
  const max = node.maxLength;
  return max !== undefined && key.length > max ? key.slice(0, max) : key;
}

/**
 * 骨架生长：以 schema 的 properties/required 为骨架，手写值逐层覆盖合并；
 * required 而无手写值的键长出机械占位，可选且无手写值不造（最小合法）。
 * 开放键域节点（properties 为空、靠 patternProperties/additionalProperties
 * 定形，如 labels/reject）无骨架可长，手写值原样放行。
 */
function grow(node: SchemaNode, values: object): Record<string, unknown> {
  const resolved = resolveNode(node);
  const props = resolved.properties ?? {};
  const propKeys = Object.keys(props);
  const vals: Record<string, unknown> = isObject(values) ? values : {};
  if (propKeys.length === 0) {
    return vals;
  }
  const required = new Set(resolved.required ?? []);
  const out: Record<string, unknown> = {};
  for (const key of new Set([...propKeys, ...Object.keys(vals)])) {
    const child = resolveNode(props[key]);
    const value = vals[key];
    if (isObject(value) && child.type === 'object') {
      out[key] = grow(child, value);
    } else if (value !== undefined) {
      out[key] = value;
    } else if (required.has(key)) {
      out[key] = child.type === 'object' ? grow(child, {}) : placeholder(child, key);
    }
  }
  return out;
}

/**
 * 键全集由 schema 机械保证的 shell 夹具（每调用产出全新深拷贝，用例可就地
 * 破坏）。值源 = 双钉样本的 shell 节（textsSample），但必须 **structuredClone
 * 后入场**：生长器对开放键域子树（labels/reject/resetLabels 等，无骨架可长）
 * 原样放行引用，不拷贝则这些子树别名样本活对象——夹具用例就地破坏会污染
 * textsSample（运行腿的校验载体，protocolGuard 有自持隔离回归测）。
 * TextsSection 接口无隐式索引签名，object 形参承接、grow 内部经 isObject 收窄。
 */
export function shellFixture(): Record<string, unknown> {
  return grow(resolveNode(TEXTS_SCHEMA.properties?.['shell']), structuredClone(textsSample.shell));
}

/**
 * 最小合法内容包（#7/#8 语义校验测试共享）：战斗+炼制双技能、一配方
 * （recipes minItems）、双敌人、全键 shell。测试用例在深拷贝上做单点
 * 破坏断言（结构关卡），语义正确性由修仙/魔幻包装配用例承载。
 */
export function minimalPack(): Record<string, unknown> {
  return {
    version: '0.1.0',
    skills: [
      { id: 'fight', name: '斗法', icon: '斗', kind: 'combat' },
      { id: 'smith', name: '炼器', icon: '器', kind: 'craft' },
    ],
    items: [
      { id: 'herb1', name: '青灵草', icon: '青', type: 'mat', sell: 4 },
      { id: 'key1', name: '钥符', icon: '钥', type: 'mat', sell: 5 },
    ],
    recipes: [
      {
        name: '锻钥符',
        skill: 'smith',
        unlockLevel: 1,
        output: { item: 'key1', count: 1 },
        materials: { herb1: 2 },
        successRate: 1,
        interval: 4000,
        exp: 10,
      },
    ],
    enemies: [
      {
        id: 'e1', name: '青鬃狼', icon: '狼', level: 1, kind: 'claw',
        hp: 60, atk: 9, def: 2, attackInterval: 2800, exp: 16,
        gold: { min: 4, max: 10 }, drops: [],
      },
      {
        id: 'e2', name: '赤尾妖蝎', icon: '蝎', level: 8, kind: 'claw',
        hp: 140, atk: 17, def: 6, attackInterval: 2600, exp: 40,
        gold: { min: 12, max: 24 }, drops: [],
      },
    ],
    gearDrops: [],
    elements: [],
    rarities: [
      { id: 'common', name: '寻常', weight: 70, mult: 1, affix: 0, sell: 1 },
      { id: 'fine', name: '精良', weight: 20, mult: 1.15, affix: 1, sell: 2 },
      { id: 'rare', name: '罕见', weight: 8, mult: 1.3, affix: 2, sell: 4 },
      { id: 'epic', name: '绝世', weight: 2, mult: 1.5, affix: 3, sell: 10, showcase: true },
    ],
    affixPool: [
      { name: '锐锋', stat: 'atk', scale: 0.3 },
      { name: '罡气', stat: 'def', scale: 0.3 },
      { name: '浑厚', stat: 'hp', scale: 1.5 },
      { name: '通明', stat: 'crit', scale: 0.25 },
    ],
    combatText: {
      verbs: {
        basic: [{ v: '击', limbs: ['面门'] }],
        claw: [{ v: '抓', limbs: ['肩头'] }],
      },
      moves: { basic: ['搏兔一击'], e1: ['饿虎扑食'], e2: ['毒尾横扫'] },
      openings: ['你足尖一点'],
      critIntro: ['你气机鼓荡'],
      cons: {
        hit: {
          light: ['{defender}受创{d}点。'],
          mid: ['{defender}受创{d}点。'],
          heavy: ['{defender}受创{d}点。'],
          deadly: ['{defender}受创{d}点。'],
        },
        hurt: {
          light: ['你受创{d}点。'],
          mid: ['你受创{d}点。'],
          heavy: ['你受创{d}点。'],
          deadly: ['你受创{d}点。'],
        },
      },
      fatal: { hit: '{defender}受创{d}点！', hurt: '你受创{d}点。' },
      templates: {
        playerLight: ['你一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
        playerHeavy: ['{opening}——一招「{move}」，{weapon}{verb}向{defender}的{limb}。'],
        playerCrit: ['{critIntro}——「{move}」，{weapon}{verb}向{defender}的{limb}！'],
        enemyLight: ['{enemy}一式「{move}」，{verb}向你的{limb}。'],
        enemyHeavy: ['{enemy}凶性大发——「{move}」，{verb}向你的{limb}！'],
      },
      notes: {
        retreat: ['你收势撤战'],
        retreatToGather: ['你收势离战'],
        retreatWounded: ['你暂且退避'],
        retreatVictory: ['你见好就收'],
        reengage: ['你再度向【{enemy}】出手'],
        start: ['你与【{enemy}】战至一处'],
        autoConsume: ['你服下【{item}】'],
      },
      summary: {
        tiers: {
          light: ['轻痕积胜'], mid: ['稳中求进'], heavy: ['重创连绵'], deadly: ['锋芒毕露'],
        },
        base: ['{rounds} 合击倒 · {flavor}'],
        crit: ['{rounds} 合击倒 · {flavor} · {crits} 会心'],
      },
      compare: {
        revenge: ['今 {rounds} 合雪耻'],
        faster: ['今 {rounds} 合胜'],
        slower: ['今 {rounds} 合方克'],
        even: ['与前番 {rounds} 合如一'],
      },
    },
    texts: {
      basicName: '拳脚',
      reject: { '*': { 'bad-payload': '指令无效' } },
      shell: shellFixture(),
    },
    shop: [{ item: 'herb1', price: 10 }],
  };
}
