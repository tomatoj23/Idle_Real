/**
 * 存档适配层（issue #3）：SaveAdapter 统一读写接口，
 * memory / localStorage 可换（SPEC US-24，Steam Cloud/Capacitor 随壳接入）。
 *
 * attachAutoSave 是应用显式挂载的基础设施（间隔由调用方给定）——
 * ADR-013 禁的"隐式定时器"指引擎核心逻辑不得依赖隐藏计时器，不与此冲突。
 */
import type { Game } from './game.js';
import type { SaveData } from './types.js';

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
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as SaveData;
      } catch {
        return null;
      }
    },
    save(data: SaveData): void {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, JSON.stringify(data));
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

/** 周期自动保存；页面隐藏/关闭时兜底保存一次。 */
export function attachAutoSave(game: Game, adapter: SaveAdapter, intervalMs = 15000): AutoSaveHandle {
  const flush = (): void => {
    adapter.save(game.snapshot());
  };
  const timer = setInterval(flush, intervalMs);
  const onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
  }
  return {
    flush,
    stop(): void {
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', flush);
      }
    },
  };
}
