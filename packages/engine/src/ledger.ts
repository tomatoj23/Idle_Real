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

/** 引擎货币键闭集：状态树资产字段名即键（#24 中性化后的引擎自有词汇）。 */
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
  /** 全 kind 带符号：增正减负；折叠标记事件恒 0。 */
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

/** 入账即折候选（D3 挂点入参）：炼制产出 / 战斗掉落的物品或装备实例。 */
export interface AutoFoldCandidate {
  readonly source: LedgerSource;
  readonly itemId: string;
  /** 装备实例的稀有度档位键；普通物品无。 */
  readonly rarity?: string;
}

/** 挂点判定：'sell' 折灵石 / 'smelt' 折器屑 / undefined 保持原样入袋。 */
export type AutoFoldDecision = LedgerAuto | undefined;

/**
 * 自动售卖/熔炼规则挂点（D3）：createGame 可选项，缺省 no-op（零行为
 * 差异）。规则本体（玩家设置的阈值表/互斥单选/UI）归 #35/#36——挂点形状
 * 收口在本票：命中即「入账即折」，物品不进乾坤袋直接折算并发成对事件
 * （D10）。挂点按 CONTEXT「自动售卖/熔炼」只对配方（craft 产出）与敌人
 * （combat 掉落）两类挂点咨询（引擎侧收窄）；装备熔炼需 content 配置
 * config.gear.shardItem（器屑经济），未配置 / 无稀有度的物品判 'smelt' =
 * 引擎防御性保持原样。
 */
export type AutoFoldRule = (candidate: AutoFoldCandidate) => AutoFoldDecision;
