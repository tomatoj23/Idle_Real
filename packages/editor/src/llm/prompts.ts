/**
 * 按内容类型的提示词模板（#11）：怪 / 物品 / 战斗动词池三优先类。
 * 模板注入当前包的实况上下文（动词池键域、可引用物品 id、槽位、系别、
 * 层数上限），约束 LLM 只产跨引用闭合的条目——生成的条目过不过关由
 * schema 校验判定（pipeline），提示词只是把过关率做高。
 */

import type { ChatMessage } from './client.js';

/** 支持的生成目标（票面优先三类）。 */
export type GenKind = 'enemies' | 'items' | 'verbs';

export const GEN_KINDS: readonly { readonly kind: GenKind; readonly label: string }[] = [
  { kind: 'enemies', label: '敌人（怪物条目）' },
  { kind: 'items', label: '物品（材料/消耗品）' },
  { kind: 'verbs', label: '战斗动词池（新风格）' },
];

/** 提示词注入的包实况上下文（由 pipeline 从当前包提取）。 */
export interface PackContext {
  readonly themeName: string;
  readonly verbKeys: readonly string[];
  readonly itemIds: readonly string[];
  readonly enemyIds: readonly string[];
  readonly slotIds: readonly string[];
  readonly elementKeys: readonly string[];
  readonly maxLevel?: number;
}

const SYSTEM_PROMPT = [
  '你是放置游戏的内容策划，为「内容包」批量产出条目。',
  '输出必须是严格合法的 JSON，形态 {"items": [ ... ]}，不要任何解释文字或 markdown 栅栏。',
  '所有条目必须完全符合给定的字段约束；跨引用字段只能取给定清单中的值。',
].join('\n');

export function buildMessages(kind: GenKind, ctx: PackContext, count: number, hint: string): ChatMessage[] {
  const contextLines = [
    `题材主题：${ctx.themeName}`,
    `动词池键域（kind/verbStyle 只能取其中键）：${ctx.verbKeys.join('、')}`,
    `可用物品 id（掉落/产出引用只能取其中）：${ctx.itemIds.join('、')}`,
    `既有敌人 id（新 id 不得重复）：${ctx.enemyIds.join('、')}`,
    `槽位 id 域：${ctx.slotIds.join('、')}`,
    `已注册系别键：${ctx.elementKeys.join('、')}`,
    ctx.maxLevel !== undefined ? `层数上限：${ctx.maxLevel}` : '层数上限：未配置（level 给 1~10 合理值）',
  ];

  const taskByKind: Record<GenKind, string> = {
    enemies: ENEMY_TASK,
    items: ITEM_TASK,
    verbs: VERB_TASK,
  };

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        contextLines.join('\n'),
        '',
        taskByKind[kind].replace('{count}', String(count)),
        hint.trim() !== '' ? `补充要求：${hint.trim()}` : '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    },
  ];
}

const ENEMY_TASK = `批量生成 {count} 个敌人条目，每条字段：
- id：小写蛇形（如 shadow_wolf），不得与既有敌人重复
- name：中文名，1~12 字；icon：单个汉字图标（1 字）
- level：不超过层数上限的整数；kind：从动词池键域中选一个
- hp/atk/def：与 level 匹配的数字（低层怪 hp 数十至数百）；attackInterval：攻击间隔毫秒，须大于 0（如 2200）
- exp：击杀经验数字；gold：{"min": 最小灵石, "max": 最大灵石}，min ≤ max
- drops：掉落数组，每项 {"item": 物品id（取可用清单）, "chance": 0~1 小数}，1~3 项
- element 可省略；如给必须取已注册系别键
输出 {"items": [ … ]}，共 {count} 条。`;

const ITEM_TASK = `批量生成 {count} 个物品条目，只做两类：
- 材料：{"id","name","icon","type":"mat","sell"} —— sell 为出售价整数
- 消耗品：{"id","name","icon","type":"consumable","sell","heal":{"percent":0~1}} 或 {"effect":{"duration":毫秒,"multipliers":{"属性键":倍率}}}
- id 小写蛇形；name 1~12 字中文；icon 单个汉字
- 属性键（multipliers/bonuses 的键）用小写英文如 atk/def/hp/exp
输出 {"items": [ … ]}，共 {count} 条。`;

const VERB_TASK = `生成 {count} 个新的战斗动词风格池，每条字段：
- key：风格键（小写蛇形，如 staff、fan），不得与既有动词池键重复
- list：动词短语数组 4~6 项，每项 {"v": 动词短语（1~12 字，如「拂尘轻扫」）, "limbs": 发力部位数组，1~3 项，每项 1~6 字（如 ["手腕","腰马"]）}
输出 {"items": [ {"key": …, "list": […]}, … ]}，共 {count} 条。`;
