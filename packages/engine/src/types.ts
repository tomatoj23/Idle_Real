/**
 * 引擎基础类型。
 *
 * 硬原则：引擎零内容感知——content 包注入什么，引擎就透明持有什么，
 * 不理解任何具体玩法字段。
 */

/** 时钟抽象：注入点，测试用假时钟替代真实时间。 */
export interface Clock {
  /** 当前时刻，单位毫秒。 */
  now(): number;
}

/** 玩家动作。骨架期仅定义协议外形，语义由后续票据补充。 */
export interface GameAction {
  readonly type: string;
  readonly payload?: unknown;
}

/** 引擎产出的领域事件。 */
export interface GameEvent {
  readonly type: string;
  /** 事件发生的游戏内时间（自开局累计，毫秒）。 */
  readonly time: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** 玩家属性面板（#4）：经修饰符管线聚合后的快照读数。 */
export interface PlayerStatsView {
  readonly atk: number;
  readonly def: number;
  /** 暴击率百分点（已钳上限）。 */
  readonly crit: number;
  readonly maxHp: number;
}

/** 存档快照。 */
export interface SaveData {
  readonly version: 1;
  /** 存档时的游戏内时间（毫秒）。 */
  readonly time: number;
  /**
   * 保存时刻的墙钟时间（clock.now()）。
   * 离线补偿结算（ADR-013）的基准：重开时以 now - savedAt 折算欠账。
   */
  readonly savedAt?: number;
  /** 引擎扩展的透明状态区：引擎写入，UI 只读。 */
  readonly state: Readonly<Record<string, unknown>>;
  /** 玩家属性面板（#4）：应用层展示用，非存档必需。 */
  readonly stats?: PlayerStatsView;
}

/**
 * 内容包类型：透明容器。content 包负责按 schema 校验并给出精确类型
 * （如 ContentPack），引擎不解读其内部结构，因此这里只要求非原始值。
 *
 * 引擎安全兜底约定（issue #2 确立，战斗票实现）：
 * - 出招文案与战斗解算查找招式名时，若内容包未注册当前武器或敌人 id
 *   （combatText.moves），一律回退拳脚动作（moves.fist + verbs.fist），
 *   不得抛错或渲染空文案；
 * - 内容包校验保证 moves.fist 与 verbs.fist 兜底动词池恒存在
 *   （动词池键域开放后仅 fist 恒需，#021 批 4），
 *   兜底路径永远可用（见 @wendao/content 的 validateContentPack）。
 */
export type GameContent = object;
