import type { GameEvent } from './types.js';

export type EventListener = (event: GameEvent) => void;

/**
 * 监听器异常诊断面（#75 项 1）：可注入（测试/壳层收诊断）；缺省走
 * console.error（AGENTS 红线：globalThis 运行时探测，缺失降级静默）。
 * 异常不阻断引擎主循环与其余监听器的契约不变。
 */
export type EventBusErrorHandler = (error: unknown, event: GameEvent) => void;

/** 缺省诊断面：探测 globalThis.console，缺失时静默（不为诊断引入平台全局名）。 */
function defaultOnError(error: unknown, event: GameEvent): void {
  const host = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console;
  if (host?.error) {
    // 方法调用保宿主 this（勿解构裸调，AGENTS 红线 e93727e 教训）。
    host.error('[EventBus] 监听器异常（事件照发、主循环未阻断）', event.type, error);
  }
}

/**
 * 事件流：拉取（drain）与订阅（subscribe）两用的小型总线。
 * 引擎只 emit，消费方式由 UI / 测试自选。
 */
export class EventBus {
  readonly limit: number;
  #queue: GameEvent[] = [];
  #listeners = new Set<EventListener>();
  #onError: EventBusErrorHandler;
  #overflow = 0;

  constructor(limit = 256, onError: EventBusErrorHandler = defaultOnError) {
    // 上限归一为非负整数（#75 复审）：小数/负限下丢弃计数与 splice 行为不失真。
    this.limit = Math.max(0, Math.floor(limit));
    this.#onError = onError;
  }

  /**
   * 超限丢弃计数（#75 项 5）：队列满时丢最旧、此处累计被丢事件数（正常
   * 节奏每溢出一次恰丢一件 = "计数一次"），只增不清——UI drain 慢丢战斗
   * 日志帧时的零诊断面补丁。当前消费面 = 测试断言；壳层诊断 UI 挂接时消费
   *（协议预留，LEDGER_CURRENCIES 同处置）。
   */
  get overflow(): number {
    return this.#overflow;
  }

  emit(event: GameEvent): void {
    this.#queue.push(event);
    if (this.#queue.length > this.limit) {
      this.#overflow += this.#queue.length - this.limit;
      this.#queue.splice(0, this.#queue.length - this.limit);
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        // 监听器异常不得阻断引擎主循环（契约不变）；诊断面收口（#75 项 1）。
        // 诊断面自身也不得成为新阻断源（#75 复审）：钩子抛错就地吞掉，
        // 不递归上报、不放大，其余监听器照常收事件。
        try {
          this.#onError(error, event);
        } catch {
          // 诊断面异常静默兜底。
        }
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
