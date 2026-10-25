/**
 * 测试夹具单点（#74 项 10）：真包（修仙）入 store 的统一入口。
 *
 * createStore → loadPack 内部 structuredClone 深拷——store 独占编辑副本，
 * 夹具常量不受用例内编辑污染，无需调用方手写 JSON 深拷（旧 19 处
 * `createStore(xiuxianPackJson)` 手写 + 3 处冗余深拷收编于此）。
 */

import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import { createStore, type EditorStore } from '../src/core/state.js';

export function xiuxianStore(): EditorStore {
  return createStore(xiuxianPackJson);
}
