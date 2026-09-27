/**
 * 入账咽喉协议（#39，C1 架构评审产物）：资产变更单一收口的协议面。
 *
 * 引擎只在此持注册表与形状——改态 + 发事件的咽喉本体在 game.ts 闭包内
 * （需要触碰状态树与事件总线）；消费方（#33 修行录/统计）订阅 EventBus
 * 的 type='ledger' 事件流落账，引擎不持流水状态（D2）。
 *
 * 词汇依据：CONTEXT.md「入账咽喉」词条（2026-09-11）——count 全 kind 带
 * 符号（增正减负），value = 入账时冻结的灵石等价单价（恒正；exp/道韵无
 * 灵石等价记 0，笔净额 = value × count）；被折叠资产标记事件 count=0/
 * value=0 纯展示、会计不计；来源 12 键闭集，content 只管显示文案。
 */

/** 账本来源 12 键闭集（D7，同 STAT_KEYS 注册表形态）：升级不设键（#33 从修为事件衍生）。 */
export const LEDGER_SOURCES = [
  'gather',
  'craft',
  'combat',
  'dungeon',
  'achievement',
  'buy',
  'sell',
  'eat',
  'smelt',
  'reforge',
  'talent',
  'rebirth',
] as const;

export type LedgerSource = (typeof LEDGER_SOURCES)[number];

/** 账本条目 kind 判别（D8）：物品 / 装备实例 / 货币 / 修为。 */
export type LedgerKind = 'item' | 'gear' | 'currency' | 'exp';

/**
 * 引擎货币键闭集：状态树资产字段名即键（#24 中性化后的引擎自有词汇）。
 * **协议预留**（#75 项 10 定性：全仓零消费点）：kind=currency 账目行的 id
 * 键域声明（LedgerData.id 注释即引用本表），#33 修行录按币种聚合时在此
 * 收口——协议面声明删了要补回来更贵，故标注保留而非删除。
 */
export const LEDGER_CURRENCIES = ['gold', 'daoYun'] as const;

export type LedgerCurrency = (typeof LEDGER_CURRENCIES)[number];

/** 归属上下文：挂机/自动行为 vs 前台手动操作（供段聚合器归段，CONTEXT「修行录」）。 */
export type LedgerOrigin = 'idle' | 'user';

/** 折叠方式（D7）：来源记真实出处，折叠方式单独标。 */
export type LedgerAuto = 'sell' | 'smelt';

/** type='ledger' 事件载荷（D8）。offline 只在离线结算时携带（true，不占来源键）。 */
export type LedgerData = {
  kind: LedgerKind;
  source: LedgerSource;
  origin: LedgerOrigin;
  /** 物品键 / 货币键（LEDGER_CURRENCIES）/ 技能键（kind=exp）。 */
  id: string;
  /** 全 kind 带符号：增正减负；折叠标记事件恒 0。**协议不变量**：count=0 行 ⇔ 被折
   * 标记行（折得物必为正额——0 额折得物不发，「0 变化不入账」；修行录折叠补注
   * 的标记/折得物判别依赖本不变量）。 */
  count: number;
  /** 入账时冻结的灵石等价单价（恒正；exp/道韵 = 0）；折叠标记事件恒 0。 */
  value: number;
  offline?: true;
  auto?: LedgerAuto;
  /** 装备实例序号（kind=gear）。 */
  uid?: number;
  /** 稀有度档位键（kind=gear）。 */
  rarity?: string;
};

/**
 * 自动处理三态注册表（#35，互斥单选，同 LEDGER_SOURCES 注册表形态）：
 * 'none' = 不处理（缺省，规则表无条目）；规则条目只存非 none 态（在场即生效），
 * 'none' = 删除条目。校验/文案遍历共用此表，禁各处手拼三态值。
 */
export const AUTO_MODES = ['none', 'sell', 'smelt'] as const;

export type AutoMode = (typeof AUTO_MODES)[number];

/**
 * 配方自动处理规则（#35 规则本体，原 D3 挂点的填充物）：键 = 配方下标
 * （canonical 数字串），值 = 三态之一 + 稀有度阈值。引擎状态（玩家设置
 * 非资产）：随档、云存档、兵解不清；缺省不处理。
 *
 * 阈值语义（票面裁决）：档位高低 = 包内 rarities 数组序（低→高），比较
 * 严格按此序、不按 weight/mult 推断；「≤所选档」的产出才折。普通产出
 * （无稀有度）不受阈值门约束（售卖态全折、熔炼态照常入袋）；装备产出的
 * 阈值缺失/未知稀有度 = 安全回退不折。
 *
 * 判定与转化本体在 game.ts 入账咽喉（foldDecisionOf「来源→规则→入账
 * 转化」单一接缝）；敌人挂点（combat 掉落）的同构规则表归 #36 复用。
 */
export interface RecipeAutoRule {
  readonly mode: LedgerAuto;
  /** 稀有度阈值键（≤该档折）；仅装备产出消费。 */
  readonly maxRarity?: string;
  /** 写入时的配方名（ADR-015 稳定引用：恢复按「下标在册 + 对名一致」双校验，宁弃不换目标）。 */
  readonly name: string;
}

/** 规则条目构造单一形状（写入面 game.ts craft:auto 与恢复面 state.ts 共用，防存档形状漂移）。 */
export function recipeAutoRuleOf(
  mode: LedgerAuto,
  maxRarity: string | undefined,
  name: string,
): RecipeAutoRule {
  return { mode, ...(maxRarity !== undefined ? { maxRarity } : {}), name };
}
