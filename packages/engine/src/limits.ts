/**
 * 防呆上限具名常量（#75 项 8，单点）：魔数抽名防语义漂移与三副本散落。
 *
 * - MAX_TICK_STEPS：单 tick 内推进循环的硬上限（大 dt × 微间隔把 while 挤成
 *   死循环的兜底；三处共用——采集 settleActivity / 炼制 settleCraft /
 *   战斗 combatRun.step）；
 * - MAX_AFFIX_ROLLS / MAX_INSCRIPTION_ROLLS：词条 / 铭纹抽取的掷点上限
 *   （池耗尽、去重耗尽、权重全零时的抽签死循环兜底，gear.ts 消费）。
 */
export const MAX_TICK_STEPS = 1_000_000;
export const MAX_AFFIX_ROLLS = 20;
export const MAX_INSCRIPTION_ROLLS = 50;
