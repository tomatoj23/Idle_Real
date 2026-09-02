import { EventBus } from './events.js';
import { realClock } from './clock.js';
import type { Clock, GameAction, GameContent, SaveData } from './types.js';

export interface CreateGameOptions {
  /** 由 content 包校验过的内容包；引擎零内容感知，仅透明持有。 */
  readonly content: GameContent;
  /** 恢复存档；缺省从零开局。 */
  readonly save?: SaveData;
  /** 时钟注入点；缺省真实时钟，测试可注入 ManualClock。 */
  readonly clock?: Clock;
}

export interface Game {
  /** 推进 dt 毫秒的游戏内时间，产出相应事件流。 */
  tick(dt: number): void;
  /** 派发玩家动作（骨架期仅登记协议，不产生效果）。 */
  dispatch(action: GameAction): void;
  /** 事件流：drain() 拉取积压事件，subscribe() 订阅推送。 */
  readonly events: EventBus;
  /** 导出存档快照。 */
  snapshot(): SaveData;
}

/**
 * 游戏实例工厂：引擎的唯一入口。
 * 本票（issue #1）只立类型与空实现——tick 仅累计游戏内时间并产出
 * tick 事件，正式状态机与玩法循环由后续票据填充。
 */
export function createGame(options: CreateGameOptions): Game {
  // 骨架期只保存注入点：clock 驱动挂机主循环、content 供状态机读取，
  // 均由后续票据消费（issue #2 接内容校验，issue #3 接玩法循环）。
  const clock = options.clock ?? realClock();
  const content = options.content;
  const events = new EventBus();
  const state: Record<string, unknown> = { ...options.save?.state };
  let time = options.save?.time ?? 0;

  return {
    events,

    tick(dt: number): void {
      if (!Number.isFinite(dt) || dt <= 0) {
        return;
      }
      time += dt;
      events.emit({ type: 'tick', time, data: { dt } });
    },

    dispatch(_action: GameAction): void {
      // 空实现：动作协议与处理在后续票据定义。
    },

    snapshot(): SaveData {
      return { version: 1, time, state: { ...state } };
    },
  };
}
