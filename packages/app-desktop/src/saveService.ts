/**
 * 存档管理服务（#62 P1-1；审计 20261031-191624 F2/F4/N1 修复抽取成可测单元）。
 *
 * 存档字节面（导出编码/导入门禁/槽位写入/受控重载）在壳层——引擎零平台依赖。
 * 导入链三条纪律：
 * 1. 门禁前置：decodeSave 形状/版本门禁不过 = 报失败（页内联），不碰槽位；
 * 2. 写后回读（F2）：#69 保槽闩会**静默拒写**（槽内异版本档时 save/flushSync
 *    无声返回）——写后 load() 回读验证，拒 = 报失败不重载，杜绝假成功；
 * 3. 先摘自动保存再重载（F4）：attachAutoSave 的 pagehide/visibilitychange
 *    flush 不受重载闸管——reload 触发的 pagehide 会用当前局覆掉刚写入的导入档，
 *    必须先 autoSave.stop() 摘监再 reload（N1 随之收口：reloading 旗标由宿主在
 *    reload 闭包内置位，只在验证通过后到达）。
 */
import { decodeSave, type SaveAdapter, type SaveData } from '@wendao/engine';
import type { ShellSaveService } from './pages/types';

/** 存档密文编码：base64(UTF-8 JSON)。 */
export function encodeSaveText(data: SaveData): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** 密文 → JSON 串；非 base64/含空白折行容错；失败 null（导入侧内联报错）。 */
export function decodeSaveCipher(text: string): string | null {
  try {
    const bin = atob(text.replace(/\s+/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

export interface SaveServiceDeps {
  /** 当前局存档快照（导出与对照面）。 */
  readonly snapshot: () => SaveData;
  /** 槽位适配器（flushSync 优先——退出竞态下异步 send 可能不达主进程）。 */
  readonly adapter: SaveAdapter & { flushSync?(data: SaveData): void };
  /** 自动保存句柄窄面：导入成功路径先 stop 摘 pagehide/visibility/interval。 */
  readonly autoSave: { readonly stop: () => void };
  /** 受控重载（宿主闭包：置重载旗标 + location.reload——旗标只在此到达）。 */
  readonly reload: () => void;
}

export function createSaveService(deps: SaveServiceDeps): ShellSaveService {
  return {
    saveNow: () => {
      if (deps.adapter.flushSync) deps.adapter.flushSync(deps.snapshot());
      else deps.adapter.save(deps.snapshot());
    },
    exportText: () => encodeSaveText(deps.snapshot()),
    importText(raw) {
      const decoded = decodeSave(decodeSaveCipher(raw));
      if (!decoded.save) return false;
      if (deps.adapter.flushSync) deps.adapter.flushSync(decoded.save);
      else deps.adapter.save(decoded.save);
      // 写后回读（F2）：保槽闩拒写是静默的——回读 null = 写入丢失，报失败不重载
      //（对照面：desktop 桥读通道故障也返回 null，同走保守失败，不误报成功）。
      if (!deps.adapter.load()) return false;
      // 先摘自动保存（F4）：pagehide flush 会用当前局覆掉刚写入的导入档。
      deps.autoSave.stop();
      deps.reload();
      return true;
    },
  };
}
