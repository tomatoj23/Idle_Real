import type { GameEvent } from './types.js';

export type EventListener = (event: GameEvent) => void;

/**
 * 事件流：拉取（drain）与订阅（subscribe）两用的小型总线。
 * 引擎只 emit，消费方式由 UI / 测试自选。
 */
export class EventBus {
  readonly limit: number;
  #queue: GameEvent[] = [];
  #listeners = new Set<EventListener>();

  constructor(limit = 256) {
    this.limit = limit;
  }

  emit(event: GameEvent): void {
    this.#queue.push(event);
    if (this.#queue.length > this.limit) {
      this.#queue.splice(0, this.#queue.length - this.limit);
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // 监听器异常不得阻断引擎主循环；骨架期静默吞掉。
      }
    }
  }

  /** 取走当前积压的全部事件并清空队列。 */
  drain(): GameEvent[] {
    const drained = this.#queue;
    this.#queue = [];
    return drained;
  }

  /** 订阅推送，返回退订函数。 */
  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
