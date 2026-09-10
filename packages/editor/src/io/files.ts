/**
 * 内容包导入/导出（#11）：JSON 与 zip 双形态。zip 用 fflate 同步 API
 * （单文件包的容器形态，为多文件包预留）。
 */

import { strFromU8, unzipSync, zipSync } from 'fflate';
import type { EditorStore } from '../core/state.js';

export interface PackFileInfo {
  readonly json: unknown;
  readonly sourceName: string;
}

/**
 * 读取内容包文件：.json 直接解析；.zip 解包取首个 .json 条目。
 * 解析失败抛错（调用方呈现给用户；包数据不受影响）。
 */
export async function readPackFile(file: File): Promise<PackFileInfo> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith('.zip')) {
    const entries = unzipSync(bytes);
    const jsonEntry = Object.keys(entries).find((entry) => entry.toLowerCase().endsWith('.json'));
    if (jsonEntry === undefined) {
      throw new Error('zip 包内未找到 .json 内容文件');
    }
    return { json: JSON.parse(strFromU8(entries[jsonEntry]!)), sourceName: file.name };
  }
  if (name.endsWith('.json')) {
    return { json: JSON.parse(strFromU8(bytes)), sourceName: file.name };
  }
  throw new Error('仅支持 .json / .zip 内容包文件');
}

/** 包 slug（文件名用）：题材名 → ascii 兜底 content-pack。 */
function packSlug(pack: Record<string, unknown>): string {
  const texts = pack['texts'] as { shell?: { brand?: { name?: unknown } } } | undefined;
  const name = texts?.shell?.brand?.name;
  const slug =
    typeof name === 'string'
      ? name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
      : '';
  return slug !== '' ? slug : 'content-pack';
}

/** 序列化当前包（导出面统一：两空格缩进 + 尾换行）。 */
export function serializePack(pack: Record<string, unknown>): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function exportJsonBytes(pack: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(serializePack(pack));
}

export function exportZipBytes(pack: Record<string, unknown>): Uint8Array {
  const fileName = `${packSlug(pack)}.json`;
  return zipSync({ [fileName]: exportJsonBytes(pack) });
}

export function suggestFileName(pack: Record<string, unknown>, ext: 'json' | 'zip'): string {
  const version = typeof pack['version'] === 'string' ? pack['version'] : '0.0.0';
  return `${packSlug(pack)}-${version}.${ext}`;
}

/** 触发浏览器下载（Blob URL 即用即回收）。 */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 导出当前包为 JSON 下载。 */
export function exportJsonDownload(store: EditorStore): string {
  const fileName = suggestFileName(store.state.pack, 'json');
  downloadBytes(exportJsonBytes(store.state.pack), fileName);
  return fileName;
}

/** 导出当前包为 zip 下载。 */
export function exportZipDownload(store: EditorStore): string {
  const fileName = suggestFileName(store.state.pack, 'zip');
  downloadBytes(exportZipBytes(store.state.pack), fileName);
  return fileName;
}
