/**
 * 存档适配层（issue #3）：SaveAdapter 统一读写接口，
 * memory / localStorage 可换（SPEC US-24，Steam Cloud/Capacitor 随壳接入）。
 *
 * attachAutoSave 是应用显式挂载的基础设施（间隔由调用方给定）——
 * ADR-013 禁的"隐式定时器"指引擎核心逻辑不得依赖隐藏计时器，不与此冲突。
 *
 * 平台全局（localStorage/document/window/timer）一律经 globalThis 运行时
 * 探测：engine 的 tsconfig 不含 DOM/node 类型库，也不应隐式依赖宿主环境。
 */
import type { Game } from './game.js';
import type { SaveData } from './types.js';

/* ---------- 平台能力探测（全部可选，缺失即降级） ---------- */

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface DocumentLike extends EventTargetLike {
  readonly visibilityState: string;
}

interface TimerLike {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

function platformOf(): {
  storage: StorageLike | undefined;
  document: DocumentLike | undefined;
  window: EventTargetLike | undefined;
  timer: TimerLike | undefined;
} {
  const g = globalThis as Record<string, unknown>;
  const asStorage = (v: unknown): StorageLike | undefined =>
    v !== null &&
    typeof v === 'object' &&
    typeof (v as StorageLike).getItem === 'function' &&
    typeof (v as StorageLike).setItem === 'function'
      ? (v as StorageLike)
      : undefined;
  const asEvents = (v: unknown): EventTargetLike | undefined =>
    v !== null &&
    typeof v === 'object' &&
    typeof (v as EventTargetLike).addEventListener === 'function'
      ? (v as EventTargetLike)
      : undefined;
  const doc = asEvents(g['document']);
  const timer = g['setInterval'] as TimerLike['setInterval'] | undefined;
  const clear = g['clearInterval'] as TimerLike['clearInterval'] | undefined;
  return {
    storage: asStorage(g['localStorage']),
    document:
      doc && typeof (doc as DocumentLike).visibilityState === 'string'
        ? (doc as DocumentLike)
        : undefined,
    window: asEvents(g['window']),
    timer:
      typeof timer === 'function' && typeof clear === 'function'
        ? { setInterval: timer, clearInterval: clear }
        : undefined,
  };
}

export interface SaveAdapter {
  load(): SaveData | null;
  save(data: SaveData): void;
}

export function memorySaveAdapter(): SaveAdapter {
  let current: SaveData | null = null;
  return {
    load: () => current,
    save: (data) => {
      current = data;
    },
  };
}

/** localStorage 适配器：坏档/不可用静默降级为全新开局（旧版同策略）。 */
export function localStorageSaveAdapter(key: string): SaveAdapter {
  return {
    load(): SaveData | null {
      try {
        const raw = platformOf().storage?.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as SaveData;
      } catch {
        return null;
      }
    },
    save(data: SaveData): void {
      try {
        platformOf().storage?.setItem(key, JSON.stringify(data));
      } catch {
        // 隐私模式/配额满：保存失败不致命，游戏继续。
      }
    },
  };
}

export interface AutoSaveHandle {
  /** 立即保存一次。 */
  flush(): void;
  /** 停止自动保存并摘除页面隐藏监听。 */
  stop(): void;
}

/** 周期自动保存；页面隐藏/关闭时兜底保存一次。无定时器环境只保留 flush。 */
export function attachAutoSave(game: Game, adapter: SaveAdapter, intervalMs = 15000): AutoSaveHandle {
  const flush = (): void => {
    adapter.save(game.snapshot());
  };
  const { document: doc, window: win, timer } = platformOf();

  const handle = timer ? timer.setInterval(flush, intervalMs) : undefined;
  const onVisibility = (): void => {
    if (doc && doc.visibilityState === 'hidden') flush();
  };
  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', flush);

  return {
    flush,
    stop(): void {
      if (handle !== undefined) timer?.clearInterval(handle);
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('pagehide', flush);
    },
  };
}
