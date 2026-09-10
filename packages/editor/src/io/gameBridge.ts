/**
 * 一键导入游戏（#11）：宿主桥探测——桌面宿主（Electron 壳未来装载编辑器
 * 时）注入 globalThis.wendaoEditorHost，直写游戏 content 目录；纯 web
 * 模式无桥，降级为下载包（票面「desktop 模式）或下载包」二选一路径）。
 */

import type { EditorStore } from '../core/state.js';
import { downloadBytes, exportJsonBytes, suggestFileName } from './files.js';

/** 桌面宿主注入的写入桥。 */
export interface EditorHostBridge {
  readonly mode: 'desktop';
  /** 把内容包字节写入游戏 content 目录（宿主决定落点）。 */
  writePack(fileName: string, bytes: Uint8Array): Promise<void>;
}

interface HostWithBridge {
  readonly wendaoEditorHost?: unknown;
}

function isBridge(candidate: unknown): candidate is EditorHostBridge {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as { mode?: unknown }).mode === 'desktop' &&
    typeof (candidate as { writePack?: unknown }).writePack === 'function'
  );
}

/** 探测宿主桥；纯 web 环境返回 undefined。 */
export function hostBridgeOf(): EditorHostBridge | undefined {
  const host = (globalThis as unknown as HostWithBridge).wendaoEditorHost;
  return isBridge(host) ? host : undefined;
}

export type GameExportResult =
  | { readonly ok: true; readonly via: 'desktop' | 'download'; readonly fileName: string }
  | { readonly ok: false; readonly error: string };

/** 一键导入游戏：有桥直写，无桥降级下载（两者都返回实际动作）。 */
export async function exportToGame(store: EditorStore): Promise<GameExportResult> {
  const fileName = suggestFileName(store.state.pack, 'json');
  const bytes = exportJsonBytes(store.state.pack);
  const bridge = hostBridgeOf();
  if (bridge !== undefined) {
    try {
      await bridge.writePack(fileName, bytes);
      return { ok: true, via: 'desktop', fileName };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
  downloadBytes(bytes, fileName);
  return { ok: true, via: 'download', fileName };
}
