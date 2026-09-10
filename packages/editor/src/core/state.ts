/**
 * 编辑器状态容器（#11）：持有当前内容包 JSON 树 + 脏标记 + 订阅通知。
 *
 * 语义（验收 3「导入坏包：包不被应用」的落点）：`loadPack` 先跑
 * validateContentPack，只有整包合法才替换——坏包被拒于状态之外。
 *
 * 数据可变性：pack 树按引用原地改（表单写回直改子对象），导出时
 * JSON 序列化净化；校验面每次变更后由面板层重跑（validateContentPack
 * 是只读纯函数，无一致性问题）。
 */

import { validateContentPack, type ContentError, type PackValidationResult } from '@wendao/content';

export type StateEvent = 'data' | 'pack';

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
   * 尝试加载整包：合法才替换并触发 'pack' 事件；失败原样返回错误，
   * 当前包不受影响。
   */
  loadPack(json: unknown): PackValidationResult;
  /** 原地修改当前包并标记脏（fn 收到包对象引用）。 */
  update(fn: (pack: Record<string, unknown>) => void): void;
  /** 只改 UI 态（当前节），不标脏。 */
  setSection(section: string | null): void;
  subscribe(fn: (state: EditorState, event: StateEvent) => void): () => void;
  /** 当前包是否已加载（有版本键即可编辑）。 */
  hasPack(): boolean;
}

export function createStore(initial?: unknown): EditorStore {
  let state: EditorState = {
    pack: {},
    dirty: false,
    section: null,
  };
  const listeners = new Set<(state: EditorState, event: StateEvent) => void>();
  const notify = (event: StateEvent): void => {
    for (const listener of listeners) {
      listener(state, event);
    }
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
      notify('pack');
      return result;
    },
    update(fn: (pack: Record<string, unknown>) => void): void {
      fn(state.pack);
      state.dirty = true;
      notify('data');
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
