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

/** 存档快照。 */
export interface SaveData {
  readonly version: 1;
  /** 存档时的游戏内时间（毫秒）。 */
  readonly time: number;
  /** 引擎扩展的透明状态区：引擎写入，UI 只读。 */
  readonly state: Readonly<Record<string, unknown>>;
}

/**
 * 内容包类型：透明键值容器。
 * content 包负责按 schema 校验，引擎不解读其内部结构。
 */
export type GameContent = Readonly<Record<string, unknown>>;
