/**
 * 桌面平台适配（#10）：steamworks.js 的 mock 优先接入。
 *
 * 归属划界（ADR-017）：Steam/文件系统能力属壳层义务——engine 禁平台
 * 依赖（AGENTS.md 红线），SaveAdapter 的桌面实现在此提供，经 IPC 桥
 * 注入 renderer（src/desktop.ts 组装为 engine 的 SaveAdapter 形状）。
 *
 * 模式裁决（票面「mock adapter 优先」）：
 * - 无 AppID 环境变量（STEAM_APPID / STEAMAPPID / SteamAppId / SteamGameId）→ mock：
 *   存档 = userData/saves/<key>.json 文件槽位；成就 = achievements.json 本地记账；
 * - 有 AppID → 尝试 steamworks.js init（需 Steam 客户端在运行）：
 *   失败（客户端未开/原生模块缺失）静默回落 mock，绝不崩壳；
 * - 每次裁决打日志 `adapter=mock|steam`（票面验收）。
 *
 * 读侧纪律（#69 项 2，mock 与 steam 两式同律）：loadSlot 分错误类别——
 * ENOENT / 云侧无档 = null（真没档，可以开局）；其余故障也返回 null 但**保槽**，
 * 本槽位后续 writeSlot 一律拒绝。不分这两类的代价是「静默降级全新开局 +
 * 随后的周期自动保存」= 拿一局新档把那份我们读不到的档覆掉，且日志里什么都没有。
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
  /** 读存档槽位；无档返回 null（读故障同样 null，但平台侧就此保槽，见头注）。返回原始 JSON 串（解析在 renderer 侧）。 */
  loadSlot(key: string): string | null;
  /** 写存档槽位；被保槽钉住的键静默拒绝（日志已报，见 createSlotHold）。 */
  writeSlot(key: string, json: string): void;
  /** 成就上报（平台侧幂等：重复上报不重记/Steam 侧返回 false）。 */
  unlockAchievement(id: string): void;
}

/** 错误信息归一（catch 块日志共用）。 */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** fs 错误码提取（#69 项 2 的分类判据：ENOENT 与其余故障不是一回事）。 */
function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * 保槽守卫（#69 项 2）：某槽位「读失败且失败原因不是没有档」时，那字节我们
 * 没见过内容——此后周期自动保存再往同一路径写一次，就是拿全新局覆盖
 * 唯一那份档（不可逆 + 零线索）。故记下它，本槽位的写一律拒绝，直到一次
 * 成功读或 ENOENT（两者都证明了「没有可被覆盖的字节」）解除。
 *
 * 拒绝而非「先备份 .old」是取票面两案之一：备份要在同一块出故障的存储上再做
 * 一次写，且明知要覆掉玩家档还要动手；拒绝把破坏留在发生之前。
 */
function createSlotHold(log: Logger) {
  const held = new Set<string>();
  const announced = new Set<string>();
  return {
    hold(key: string): void {
      held.add(key);
    },
    release(key: string): void {
      held.delete(key);
    },
    /** 该槽位是否处于「只许保、不许覆」态（首次为真时点名报一次，不刷屏）。 */
    refuseOverwrite(key: string): boolean {
      if (!held.has(key)) return false;
      if (!announced.has(key)) {
        announced.add(key);
        log(`[platform] slot held (last read failed), refusing to overwrite: ${key}`);
      }
      return true;
    },
  };
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
  const hold = createSlotHold(log);

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
      // 键校验在 try 之外（slotPath 内）：坏键是调用方 bug，不许被降级成「无档」。
      const target = slotPath(key);
      try {
        const raw = readFileSync(target, 'utf8');
        hold.release(key); // 读通 = 槽位可用，此前的读故障一并作废
        return raw;
      } catch (err) {
        // ENOENT = 真·无档（静默 null，旧语义）；其余是存储故障——槽位里有
        // 我们读不到的字节，绝不能让它在下一次自动保存时被新局覆盖（#69 项 2）。
        if (errorCode(err) === 'ENOENT') {
          hold.release(key); // 确认无货 = 没有可被覆盖的字节
          return null;
        }
        log(`[platform] slot read failed: ${key} (${errorCode(err) ?? 'unknown'}): ${errMsg(err)}`);
        hold.hold(key);
        return null;
      }
    },

    writeSlot(key: string, json: string): void {
      if (hold.refuseOverwrite(key)) return;
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
  const hold = createSlotHold(log);
  return {
    mode: 'steam',

    loadSlot(key: string): string | null {
      try {
        const raw = client.cloud.fileExists(key) ? client.cloud.readFile(key) : null;
        hold.release(key); // 云侧应答正常（有档读到 / 无档不存在）= 不必保槽
        return raw;
      } catch (err) {
        // 云故障与文件故障同律（#69 项 2）：不知道云上那份还在不在，就不许写。
        log(`[platform] cloud read failed: ${errMsg(err)}`);
        hold.hold(key);
        return null;
      }
    },

    writeSlot(key: string, json: string): void {
      if (hold.refuseOverwrite(key)) return;
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

/**
 * 从环境解析 AppID。SDK 文档惯用的 STEAM_APPID / STEAMAPPID 之外，还须认
 * Steam 客户端启动游戏时注入的驼峰 SteamAppId / SteamGameId——depot 构建
 * 排除 steam_appid.txt 后环境变量是正式渠道的唯一线索，漏认 = 恒回 mock。
 * 读值转数字校验：NaN / 负值一律视为未配置（不喂 init 脏值）。
 */
export function appIdFromEnv(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const raw =
    env['STEAM_APPID'] ?? env['STEAMAPPID'] ?? env['SteamAppId'] ?? env['SteamGameId'];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw.trim(), 10);
  return Number.isNaN(parsed) || parsed < 0 ? undefined : parsed;
}

/**
 * init() 返回值形状校验：steamworks 原生面不抛错也可能形状漂移（版本/平台
 * 差异），缺 cloud/achievement 接口 = 云存档静默永久失败（loadSlot 恒 null）。
 * 按 SteamClient 声明面逐一核对函数存在性，不达标与 init 失败同律回 mock。
 */
function looksLikeSteamClient(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const { cloud, achievement } = value as { cloud?: unknown; achievement?: unknown };
  const hasFns = (obj: unknown, names: readonly string[]): boolean =>
    typeof obj === 'object' &&
    obj !== null &&
    names.every((name) => typeof (obj as Record<string, unknown>)[name] === 'function');
  return hasFns(cloud, ['readFile', 'writeFile', 'fileExists']) && hasFns(achievement, ['activate']);
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
    if (!looksLikeSteamClient(client)) {
      // 形状漂移按 init 失败同律：走 catch 回 mock，日志可审计。
      throw new Error('steamworks init returned malformed client (cloud/achievement missing)');
    }
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
