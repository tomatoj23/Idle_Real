/**
 * 编辑器状态容器（#11）：持有当前内容包 JSON 树 + 脏标记 + 订阅通知。
 *
 * 语义（验收 3「导入坏包：包不被应用」的落点）：`loadPack` 先跑
 * validateContentPack，只有整包合法才替换——坏包被拒于状态之外。
 *
 * 数据可变性：pack 树按引用原地改（表单写回直改子对象），导出时
 * JSON 序列化净化；校验面每次变更后由面板层重跑（validateContentPack
 * 是只读纯函数，无一致性问题）。
 *
 * 历史与异常语义（#73，快照栈裁决）：
 * - 每个 update 提交即快照点：先留整树 clone 再执行 fn，成功才入 undo 栈
 *   （上限 HISTORY_LIMIT，超出挤掉最旧）；undo/redo 整树换装并发 'history'
 *   事件——监听方（main.ts）须 collapseAll + 整节重渲染重绑活引用。
 * - fn 抛错则整树换回快照（半途变异全弃、dirty 不动）并发 'rollback' 事件，
 *   再向调用方原样重抛；happy path 仍是原地变异（渲染树闭包持活引用的
 *   #49 纪律不破，焦点保持）。
 * - loadPack 整树替换截断历史（跨包撤销是语义泥潭，双向清空）；undo/redo
 *   一律标脏——退回原值也不熄「未导出改动」（保守语义，导出幂等无副作用）。
 */

import { validateContentPack, type ContentError, type PackValidationResult } from '@wendao/content';

export type StateEvent = 'data' | 'pack' | 'history' | 'rollback';

/** undo 栈上限（#73 用户裁决：快照栈 50 版，pack KB 级体量下足够）。 */
export const HISTORY_LIMIT = 50;

export interface EditorState {
  /** 当前内容包（未校验形态；loadPack 通过后即合法 ContentPack 形态）。 */
  readonly pack: Record<string, unknown>;
  /** 自上次成功加载以来有未导出改动。 */
  dirty: boolean;
  /** 当前编辑节名。 */
  section: string | null;
}

export interface EditorStore {
  readonly state: EditorState;
  /**
   * 尝试加载整包：合法才替换并触发 'pack' 事件（历史栈清空）；失败原样
   * 返回错误，当前包不受影响。
   */
  loadPack(json: unknown): PackValidationResult;
  /**
   * 原地修改当前包并标记脏（fn 收到包对象引用）。先留整树快照后执行：
   * fn 抛错则整树回滚到快照（发 'rollback'）并原样重抛异常，成功才入历史。
   */
  update(fn: (pack: Record<string, unknown>) => void): void;
  /** 撤销最近一次已提交变更（整树换装，发 'history'）；无可撤销返回 false。 */
  undo(): boolean;
  /** 重做最近一次被撤销的变更；无可重做（含撤销后有新提交）返回 false。 */
  redo(): boolean;
  /** 是否有可撤销的历史（undo 栈非空）。 */
  canUndo(): boolean;
  /** 是否有可重做的历史（redo 栈非空）。 */
  canRedo(): boolean;
  /** 只改 UI 态（当前节），不标脏、不进历史。 */
  setSection(section: string | null): void;
  subscribe(fn: (state: EditorState, event: StateEvent) => void): () => void;
  /** 当前包是否已加载（有版本键即可编辑）。 */
  hasPack(): boolean;
}

/**
 * 脏包载入确认文案（审计修复①）：loadPack 是整树替换，dirty 包被新包
 * 覆盖即丢改动，替换动作必须先经用户确认。
 */
export const DIRTY_LOAD_MESSAGE = '当前包有未导出的修改，载入将丢弃，确认？';

/**
 * 载入新包前的脏确认守卫（数据丢失防护，审计修复①）：包干净（或尚无包）
 * 直接放行；有未导出改动时经 confirmFn 询问，用户取消则返回 false——
 * 调用点必须就此 return，不得调用 loadPack。
 * confirmFn 由调用方注入：浏览器侧传 window.confirm 的方法包裹（直接解构
 * 原生方法存函数值会 Illegal invocation，工程红线），测试侧传 stub。
 */
export function confirmDirtyLoad(
  store: EditorStore,
  confirmFn: (message: string) => boolean,
): boolean {
  if (!store.state.dirty) {
    return true;
  }
  return confirmFn(DIRTY_LOAD_MESSAGE);
}

export function createStore(initial?: unknown): EditorStore {
  let state: EditorState = {
    pack: {},
    dirty: false,
    section: null,
  };
  // 快照栈（#73）：past 存「提交前」整树 clone（末位=最近），future 存
  // 「被撤销的现场」。栈内对象只在进出栈时转正为活树，栈外不持别名。
  const past: Record<string, unknown>[] = [];
  const future: Record<string, unknown>[] = [];
  const listeners = new Set<(state: EditorState, event: StateEvent) => void>();
  const notify = (event: StateEvent): void => {
    for (const listener of listeners) {
      listener(state, event);
    }
  };
  const recordSnapshot = (snapshot: Record<string, unknown>): void => {
    past.push(snapshot);
    if (past.length > HISTORY_LIMIT) {
      past.shift();
    }
  };
  const clonePack = (): Record<string, unknown> => structuredClone(state.pack) as Record<string, unknown>;
  const swapTree = (pack: Record<string, unknown>): void => {
    state = { ...state, pack, dirty: true };
    notify('history');
  };

  const store: EditorStore = {
    get state() {
      return state;
    },
    loadPack(json: unknown): PackValidationResult {
      const result = validateContentPack(json);
      if (!result.ok) {
        return result;
      }
      // 深拷持有：store 独占编辑副本，外部（测试夹具单例/示例包常量/
      // 导入解析结果）不受后续编辑影响。
      state = {
        pack: structuredClone(json) as Record<string, unknown>,
        dirty: false,
        section: state.section,
      };
      // 整树替换截断历史（#73）：undo 退回另一个包是语义泥潭，双向清空。
      past.length = 0;
      future.length = 0;
      notify('pack');
      return result;
    },
    update(fn: (pack: Record<string, unknown>) => void): void {
      // 先留快照（clone）后执行：fn 仍原地改活树（渲染树闭包持活引用的
      // #49 纪律不破，焦点保持）；fn 抛错则整树换回快照——半途变异全弃、
      // dirty 不动，发 'rollback' 让监听方重绑活引用后，异常原样重抛。
      const snapshot = clonePack();
      try {
        fn(state.pack);
      } catch (cause) {
        state = { ...state, pack: snapshot };
        notify('rollback');
        throw cause;
      }
      recordSnapshot(snapshot);
      future.length = 0; // 新提交分叉即弃：被撤销的旧线不可达
      state.dirty = true;
      notify('data');
    },
    undo(): boolean {
      const prev = past.pop();
      if (prev === undefined) {
        return false;
      }
      future.push(clonePack());
      swapTree(prev);
      return true;
    },
    redo(): boolean {
      const next = future.pop();
      if (next === undefined) {
        return false;
      }
      recordSnapshot(clonePack());
      swapTree(next);
      return true;
    },
    canUndo(): boolean {
      return past.length > 0;
    },
    canRedo(): boolean {
      return future.length > 0;
    },
    setSection(section: string | null): void {
      state = { ...state, section };
      notify('data');
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    hasPack(): boolean {
      return typeof state.pack['version'] === 'string';
    },
  };

  if (initial !== undefined) {
    const result = store.loadPack(initial);
    if (!result.ok) {
      throw new Error(`初始包校验失败：${formatFirst(result.errors)}`);
    }
  }
  return store;
}

function formatFirst(errors: readonly ContentError[]): string {
  const first = errors[0];
  return first !== undefined ? `${first.path} ${first.message}` : '';
}
