// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { validateContentPack } from '@wendao/content';
import { xiuxianPackJson } from '@wendao/content/packs/xiuxian';
import {
  exportJsonBytes,
  exportZipBytes,
  readPackFile,
  serializePack,
  suggestFileName,
} from '../src/io/files.js';
import { exportToGame, hostBridgeOf } from '../src/io/gameBridge.js';
import { createStore } from '../src/core/state.js';

function jsonFile(content: string, name = 'pack.json'): File {
  return new File([content], name, { type: 'application/json' });
}

describe('io/files：导入导出往返', () => {
  it('.json 导入：解析为包对象', async () => {
    const file = jsonFile(serializePack(xiuxianPackJson as Record<string, unknown>));
    const info = await readPackFile(file);
    expect(validateContentPack(info.json).ok).toBe(true);
    expect(info.sourceName).toBe('pack.json');
  });

  it('.zip 导入：解包取首个 .json 条目', async () => {
    const zip = exportZipBytes(xiuxianPackJson as Record<string, unknown>);
    const file = new File([zip as BlobPart], 'pack.zip');
    const info = await readPackFile(file);
    expect((info.json as { version: string }).version).toBe('0.1.0');
  });

  it('不支持格式 / 坏 JSON / 空 zip：抛可读错误', async () => {
    await expect(readPackFile(jsonFile('{}', 'pack.txt'))).rejects.toThrow('仅支持');
    await expect(readPackFile(jsonFile('{oops'))).rejects.toThrow();
    const emptyZip = new File([exportZipBytes({ version: '0.1.0' }).slice(0, 0) as BlobPart], 'x.zip');
    await expect(readPackFile(emptyZip)).rejects.toThrow();
  });

  it('JSON 导出字节 ↔ 原包一致（2 空格缩进）', () => {
    const bytes = exportJsonBytes(xiuxianPackJson as Record<string, unknown>);
    const reparsed = JSON.parse(strFromU8(bytes));
    expect(reparsed).toEqual(xiuxianPackJson);
  });

  it('zip 导出往返：解包还原包 JSON', () => {
    const zip = exportZipBytes(xiuxianPackJson as Record<string, unknown>);
    const entries = unzipSync(zip);
    const names = Object.keys(entries);
    expect(names.some((name) => name.endsWith('.json'))).toBe(true);
    const entry = names.find((name) => name.endsWith('.json'))!;
    expect(JSON.parse(strFromU8(entries[entry]!))).toEqual(xiuxianPackJson);
  });

  it('suggestFileName：题材 slug + 版本', () => {
    const pack = xiuxianPackJson as Record<string, unknown>;
    expect(suggestFileName(pack, 'json')).toMatch(/-0\.1\.0\.json$/);
    expect(suggestFileName({ version: '1.2.3' }, 'zip')).toBe('content-pack-1.2.3.zip');
  });
});

describe('io/gameBridge：一键导入游戏', () => {
  it('无宿主桥：降级为下载包（验收 1 的 web 路径）', async () => {
    expect(hostBridgeOf()).toBeUndefined();
    const store = createStore(xiuxianPackJson);
    const result = await exportToGame(store);
    expect(result).toMatchObject({ ok: true, via: 'download' });
  });

  it('有宿主桥：直写游戏 content 目录（desktop 模式）', async () => {
    const writes: { fileName: string; text: string }[] = [];
    (globalThis as { wendaoEditorHost?: unknown }).wendaoEditorHost = {
      mode: 'desktop',
      writePack: async (fileName: string, bytes: Uint8Array) => {
        writes.push({ fileName, text: strFromU8(bytes) });
      },
    };
    try {
      const store = createStore(xiuxianPackJson);
      const result = await exportToGame(store);
      expect(result).toMatchObject({ ok: true, via: 'desktop' });
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]!.text)).toEqual(xiuxianPackJson);
    } finally {
      delete (globalThis as { wendaoEditorHost?: unknown }).wendaoEditorHost;
    }
  });

  it('桥写入失败：ok:false 带错误（不静默降级覆盖问题）', async () => {
    (globalThis as { wendaoEditorHost?: unknown }).wendaoEditorHost = {
      mode: 'desktop',
      writePack: async () => {
        throw new Error('content 目录只读');
      },
    };
    try {
      const store = createStore(xiuxianPackJson);
      const result = await exportToGame(store);
      expect(result).toEqual({ ok: false, error: 'content 目录只读' });
    } finally {
      delete (globalThis as { wendaoEditorHost?: unknown }).wendaoEditorHost;
    }
  });
});
