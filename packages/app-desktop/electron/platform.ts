/**
 * 桌面平台适配（#10）：steamworks.js 的 mock 优先接入。
 *
 * 归属划界（ADR-017）：Steam/文件系统能力属壳层义务——engine 禁平台
 * 依赖（AGENTS.md 红线），SaveAdapter 的桌面实现在此提供，经 IPC 桥
 * 注入 renderer（src/desktop.ts 组装为 engine 的 SaveAdapter 形状）。
 *
 * 模式裁决（票面「mock adapter 优先」）：
 * - 无 AppID 环境变量（STEAM_APPID / STEAMAPPID 别名）→ mock：
 *   存档 = userData/saves/<key>.json 文件槽位；成就 = achievements.json 本地记账；
 * - 有 AppID → 尝试 steamworks.js init（需 Steam 客户端在运行）：
 *   失败（客户端未开/原生模块缺失）静默回落 mock，绝不崩壳；
 * - 每次裁决打日志 `adapter=mock|steam`（票面验收）。
 *
 * 约定：content 包成就 id 即 Steam 成就 API 名（零映射配置；
 * 官方成就名表待内容定版后另票引入映射）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export type PlatformMode = 'mock' | 'steam';

export type Logger = (message: string) => void;

/** steamworks.js 客户端的最小接口面（0.4.0 实测：achievement/cloud 在 init() 返回值上）。 */
export interface SteamClient {
  readonly achievement: {
    activate(achievement: string): boolean;
  };
  readonly cloud: {
    readFile(name: string): string;
    writeFile(name: string, content: string): boolean;
    fileExists(name: string): boolean;
  };
}

/** 壳层平台面：renderer 经 IPC 桥消费的全部能力。 */
export interface Platform {
  readonly mode: PlatformMode;
  /** 读存档槽位；无档返回 null。返回原始 JSON 串（解析在 renderer 侧）。 */
  loadSlot(key: string): string | null;
  /** 写存档槽位。 */
  writeSlot(key: string, json: string): void;
  /** 成就上报（平台侧幂等：重复上报不重记/Steam 侧返回 false）。 */
  unlockAchievement(id: string): void;
}

/** 错误信息归一（catch 块日志共用）。 */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ---------- mock：文件槽位 + 成就本地记账 ---------- */

/** 槽位键白名单：字母数字与 ._-，防路径穿越（键由壳常量传入，纵深防御）。 */
function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) {
    throw new Error(`bad save slot key: ${key}`);
  }
}

export function createMockPlatform(rootDir: string, log: Logger = () => {}): Platform {
  const savesDir = join(rootDir, 'saves');
  const slotPath = (key: string): string => {
    assertSafeKey(key);
    return join(savesDir, `${key}.json`);
  };
  const achievementPath = join(rootDir, 'achievements.json');

  const readAchievements = (): Record<string, string> => {
    try {
      const raw = JSON.parse(readFileSync(achievementPath, 'utf8')) as {
        achievements?: Record<string, string>;
      };
      return raw.achievements && typeof raw.achievements === 'object'
        ? { ...raw.achievements }
        : {};
    } catch {
      return {}; // 无记录文件/坏档 = 空账本（记账文件非存档，不救）
    }
  };

  return {
    mode: 'mock',

    loadSlot(key: string): string | null {
      try {
        return readFileSync(slotPath(key), 'utf8');
      } catch {
        return null; // 无档（ENOENT）= null；读失败同律静默降级全新开局
      }
    },

    writeSlot(key: string, json: string): void {
      mkdirSync(savesDir, { recursive: true });
      // 临时文件 + rename：半写状态不留正档（进程被杀也不坏档）。
      const target = slotPath(key);
      const tmp = `${target}.tmp`;
      writeFileSync(tmp, json, 'utf8');
      renameSync(tmp, target);
    },

    unlockAchievement(id: string): void {
      const book = readAchievements();
      if (book[id] !== undefined) return; // 一次且仅一次（与引擎解锁幂等同律）
      book[id] = new Date().toISOString();
      try {
        mkdirSync(rootDir, { recursive: true });
        writeFileSync(achievementPath, JSON.stringify({ achievements: book }, null, 2), 'utf8');
        log(`[platform] achievement unlocked (mock): ${id}`);
      } catch (err) {
        log(`[platform] achievement record failed: ${errMsg(err)}`);
      }
    },
  };
}

/* ---------- steam：Steam Cloud 槽位 + 成就上报 ---------- */

export function createSteamPlatform(client: SteamClient, log: Logger = () => {}): Platform {
  return {
    mode: 'steam',

    loadSlot(key: string): string | null {
      try {
        return client.cloud.fileExists(key) ? client.cloud.readFile(key) : null;
      } catch (err) {
        log(`[platform] cloud read failed: ${errMsg(err)}`);
        return null;
      }
    },

    writeSlot(key: string, json: string): void {
      try {
        if (!client.cloud.writeFile(key, json)) {
          log(`[platform] cloud write rejected: ${key}`);
        }
      } catch (err) {
        log(`[platform] cloud write failed: ${errMsg(err)}`);
      }
    },

    unlockAchievement(id: string): void {
      try {
        // Steam 侧幂等：已解锁再 activate 返回 false，不抛错。
        if (client.achievement.activate(id)) {
          log(`[platform] achievement activated (steam): ${id}`);
        }
      } catch (err) {
        log(`[platform] achievement activate failed: ${errMsg(err)}`);
      }
    },
  };
}

/* ---------- 模式裁决 ---------- */

/** 从环境解析 AppID（STEAM_APPID，兼容 Steamworks SDK 惯用的 STEAMAPPID）。 */
export function appIdFromEnv(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const raw = env['STEAM_APPID'] ?? env['STEAMAPPID'];
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  return Number.parseInt(raw.trim(), 10);
}

function defaultRequireSteam(appId: number): SteamClient {
  // 延迟加载可选依赖（optionalDependencies）：模块缺失/原生加载失败/Steam
  // 客户端未运行一律走异常 → 上层回落 mock。achievement/cloud 命名空间
  // 挂在 init() 返回的 client 上（0.4.0 index.d.ts：init → Omit<Client,...>）。
  const require = createRequire(import.meta.url);
  const steamworks = require('steamworks.js') as {
    init(appId?: number): SteamClient;
  };
  return steamworks.init(appId);
}

export interface ResolvePlatformOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userDataDir: string;
  readonly log?: Logger;
  /** 注入点（测试用）；缺省 = 真实 steamworks.js 延迟加载。 */
  readonly requireSteam?: (appId: number) => SteamClient;
}

/** 裁决 + 装配平台适配（主进程启动时调用一次）。 */
export function resolvePlatform(options: ResolvePlatformOptions): Platform {
  const log = options.log ?? (() => {});
  const appId = appIdFromEnv(options.env);
  if (appId === undefined) {
    log('[platform] adapter=mock (no STEAM_APPID; achievements=local, saves=file slots)');
    return createMockPlatform(options.userDataDir, log);
  }
  try {
    const client = (options.requireSteam ?? defaultRequireSteam)(appId);
    log(`[platform] adapter=steam (appid=${appId})`);
    return createSteamPlatform(client, log);
  } catch (err) {
    log(
      `[platform] adapter=mock (steam init failed for appid=${appId}: ${
        errMsg(err)
      })`,
    );
    return createMockPlatform(options.userDataDir, log);
  }
}
