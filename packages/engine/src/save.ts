/**
 * 存档适配层（issue #3）：SaveAdapter 统一读写接口，
 * memory / localStorage 可换（SPEC US-24，Steam Cloud/Capacitor 随壳接入）。
 *
 * #69 起本模块兼负存档**读侧门禁**（saveRejection / decodeSave）：适配器层是
 * 坏档能同时做到「不崩」「说得出来」并且（对异型档）「不许被覆掉」的位置；
 * restoreState 里的同门禁是框架直供面的兜底（绕过适配器也要被拦）。
 *
 * attachAutoSave 是应用显式挂载的基础设施（间隔由调用方给定）——
 * ADR-013 禁的"隐式定时器"指引擎核心逻辑不得依赖隐藏计时器，不与此冲突。
 *
 * 平台全局（localStorage/document/window/timer）一律经 globalThis 运行时
 * 探测：engine 的 tsconfig 不含 DOM/node 类型库，也不应隐式依赖宿主环境。
 */
import type { Game } from './game.js';
import { SAVE_VERSION, type SaveData } from './types.js';

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
  const timer = g['setInterval'];
  const clear = g['clearInterval'];
  return {
    storage: asStorage(g['localStorage']),
    document:
      doc && typeof (doc as DocumentLike).visibilityState === 'string'
        ? (doc as DocumentLike)
        : undefined,
    window: asEvents(g['window']),
    // 原生定时器方法必须 bind 宿主再解构：脱离 window 调用会抛
    // "Illegal invocation"（真实浏览器严格校验 this，happy-dom 不校验，
    // 测试环境遮蔽此类问题——2026-09-03 首跑真机暴露）。
    timer:
      typeof timer === 'function' && typeof clear === 'function'
        ? {
            setInterval: (timer as TimerLike['setInterval']).bind(g),
            clearInterval: (clear as TimerLike['clearInterval']).bind(g),
          }
        : undefined,
  };
}

export interface SaveAdapter {
  load(): SaveData | null;
  save(data: SaveData): void;
}

/* ---------- 读侧门禁与诊断（#69） ---------- */

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 存档诊断回调（#69 项 3）：把「这次为什么没读到可用的档/为什么写不进去」说出来。 */
export type SaveDiagnostic = (message: string) => void;

export interface SaveAdapterOptions {
  /** 缺省静默（降级行为同旧，壳层不接也不破）；接上即获诊断面。 */
  readonly onProblem?: SaveDiagnostic;
}

/**
 * 存档形状/版本门禁（#69 项 1）：`SaveData.version` 自此有了读侧消费者。
 * undefined = 可加载；否则给出拒绝判定，两条消费路径都以它为准（decodeSave
 * 据此决定是否保槽，restoreState 据此抛错）。
 */
export interface SaveRejection {
  /**
   * 完整拒绝语句。面向**开发者诊断**（console / wendao.log），不是玩家文案：
   * ADR-016 要求系统文案归 content 包，壳层要呈现给玩家时自行取键，勿直读此串。
   */
  readonly message: string;
  /**
   * 是否保槽（不许覆写这份字节）。判据收窄到**数字版本号且不等于本引擎**——
   * 那是「另一版引擎写的档」的唯一自证形态，且解药（换回能读它的引擎）会让门禁
   * 自然放行，所以值得为它停止落盘。
   * 其余一律不保：非数字的 version（`"1"`/`true`/`{}`/`null`）不成其为版本标记，
   * 保它＝为一堆无自证价值的字节永久断掉存档能力且**没有解除路径**（被保的字节
   * 正是被禁止改写的那份，只能靠人手删文件脱困——复审实测抓出的死锁形态）；
   * 解析不了的碎片同理。拒绝对所有形态一视同仁，保槽只给认得出的那一类。
   */
  readonly holdSlot: boolean;
}

/** 版本值的诊断措辞：总函数——字符串带引号与数字区分，其余只报类型名，
 *  绝不 stringify 未知对象（循环/抛错 toString 都不能让门禁本身抛）。 */
function describeVersion(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `<${typeof value}>`;
}

export function saveRejection(save: unknown): SaveRejection | undefined {
  if (save === null || typeof save !== 'object' || Array.isArray(save)) {
    return { message: 'save rejected: not a save object', holdSlot: false };
  }
  // 自有键域判据（与本票项 4 同一条纪律）：版本从原型链上继承来的对象不是档面，
  // 不能因为它读到 version===1 就放行——那等于让调用方的原型链决定存档格式。
  const version = Object.hasOwn(save, 'version')
    ? (save as { readonly version?: unknown }).version
    : undefined;
  if (version === undefined) {
    return {
      message: `save rejected: save has no version field (engine format ${SAVE_VERSION})`,
      holdSlot: false,
    };
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return {
      message: `save rejected: version is not an integer save format (${describeVersion(version)})`,
      holdSlot: false,
    };
  }
  if (version !== SAVE_VERSION) {
    return {
      message: `save rejected: unsupported save version ${version} (engine format ${SAVE_VERSION})`,
      holdSlot: true,
    };
  }
  return undefined;
}

export interface SaveDecode {
  /** 可加载档；null = 本次无可用档（缺档/坏档/异型档）。 */
  readonly save: SaveData | null;
  /**
   * 保槽判定（#69）：槽位里躺着一份自证为异格式存档的字节，覆盖它 = 那份档消失。
   * 真·无档与读不懂的碎片都是 false（见 saveRejection.holdSlot）；
   * 读通道故障不经此判定（无从证明槽位有货，见 localStorageSaveAdapter.load）。
   */
  readonly holdSlot: boolean;
}

/** JSON 串 → SaveData：解析 + 形状/版本门禁，问题经 diagnostic 说出（缺省静默）。 */
export function decodeSave(
  raw: string | null | undefined,
  diagnostic?: SaveDiagnostic,
): SaveDecode {
  if (raw === null || raw === undefined || raw.length === 0) {
    return { save: null, holdSlot: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // 半写/截断/手改坏的碎片：报出来，但照常允许本局重新落盘（旧行为）。
    // 与下面 saveRejection 分支的分别见 SaveRejection.holdSlot 的理由。
    diagnostic?.(`save parse failed: ${reasonOf(err)}`);
    return { save: null, holdSlot: false };
  }
  const rejection = saveRejection(parsed);
  if (rejection !== undefined) {
    diagnostic?.(rejection.message);
    return { save: null, holdSlot: rejection.holdSlot };
  }
  return { save: parsed as SaveData, holdSlot: false };
}

export interface HoldLatch {
  /** 记住「这份槽位的字节保不得」。 */
  engage(): void;
  /** 解除（读到合法档 / 确认无档 = 没有可被覆盖的字节）；同时让下一次保槽重新出声。 */
  release(): void;
  /** 处于保槽态则返回 true，且本次保槽事件内只点名报一次（周期自动保存会反复触发）。 */
  refuses(): boolean;
}

/**
 * 保槽闩（#69）：「拒绝了还要留住档」这一段判定，localStorage 适配器与桌面桥
 * 适配器共用同一机制与措辞（后者经 @wendao/engine 引）。
 * electron 主进程侧另有一份带键域的（app-desktop/electron/platform.ts
 * createSlotHold）——那边按槽位分别记、判据是 fs 错误码，语义不同故不并一处。
 * 报一次的范围是**单次保槽事件**：解除后再进入保槽（同一适配器实例内）会重新
 * 出声——「静默的第二次拒绝」正是本票要消灭的那类东西（复审实测抓出来的）。
 * 边界如实记：闩是**每适配器实例**的，不跨实例也不跨标签页——另建一个从不 load()
 * 的适配器写同键，仍会覆掉被保的字节。随壳的单例装配（main.ts 一个适配器 +
 * Electron 单实例锁）触发不到它，纯浏览器多开没有那道锁，故记为已知边界。
 */
export function createHoldLatch(subject: string, onProblem?: SaveDiagnostic): HoldLatch {
  let held = false;
  let announced = false;
  return {
    engage: () => {
      held = true;
    },
    release: () => {
      held = false;
      announced = false;
    },
    refuses(): boolean {
      if (!held) return false;
      if (!announced) {
        announced = true;
        onProblem?.(
          `save slot held (foreign-format save on record), refusing to overwrite: ${subject}`,
        );
      }
      return true;
    },
  };
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

/**
 * localStorage 适配器：坏档/不可用降级为全新开局（旧版同策略），但降级不再无声
 * （#69 项 3）——故障经 onProblem 说出。唯一的主动行为差异：读到一份自证为
 * 异格式的存档时保住槽位不再覆写（理由见 saveRejection.holdSlot）。
 */
export function localStorageSaveAdapter(
  key: string,
  options: SaveAdapterOptions = {},
): SaveAdapter {
  const report = options.onProblem;
  const latch = createHoldLatch(key, report);
  return {
    load(): SaveData | null {
      const storage = platformOf().storage;
      if (!storage) {
        report?.(`save storage unavailable (no localStorage): ${key}`);
        return null;
      }
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch (err) {
        // 读通道故障（存储被策略禁用等）：不碰保槽态——既没证明有货，也没证明没货。
        report?.(`save read channel failed: ${reasonOf(err)}`);
        return null;
      }
      const decoded = decodeSave(raw, report);
      if (decoded.holdSlot) latch.engage();
      else latch.release();
      return decoded.save;
    },
    save(data: SaveData): void {
      // 拒绝加载却照常落盘 = 白拒：周期自动保存会把刚拒绝的那份档抹干净。
      if (latch.refuses()) return;
      try {
        platformOf().storage?.setItem(key, JSON.stringify(data));
      } catch (err) {
        // 隐私模式/配额满：保存失败不致命，游戏继续（旧语义）——但如今说得出来。
        report?.(`save write failed: ${reasonOf(err)}`);
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
