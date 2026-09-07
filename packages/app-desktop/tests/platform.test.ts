// @vitest-environment node
/**
 * #10 验收：桌面平台适配（主进程）——
 * - 模式裁决：无 AppID 环境变量 → mock；有 AppID 且 steamworks 可用 → steam；
 *   init 失败（无 Steam 客户端/原生模块缺失）→ 静默回落 mock；AppID 非法 → mock。
 * - mock 平台：文件槽位读写（缺档 null / 键防路径穿越）+ 成就本地记账（一次且仅一次）。
 * - steam 平台：云存档读写 + 成就上报（假客户端断言调用面）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMockPlatform,
  createSteamPlatform,
  resolvePlatform,
  type SteamClient,
} from '../electron/platform';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'wendao-platform-'));
}

function fakeSteam(log: string[]): SteamClient {
  return {
    achievement: {
      activate: (name: string) => {
        log.push(`activate:${name}`);
        return true;
      },
    },
    cloud: {
      fileExists: (name: string) => name === 'exists.json',
      readFile: (name: string) => (name === 'exists.json' ? '{"version":1}' : ''),
      writeFile: (name: string, content: string) => {
        log.push(`write:${name}:${content.length}`);
        return true;
      },
    },
  };
}

describe('#10 · 模式裁决 resolvePlatform', () => {
  it('无 AppID 环境变量 → mock，日志声明 adapter=mock', () => {
    const logs: string[] = [];
    const platform = resolvePlatform({
      env: {},
      userDataDir: tempRoot(),
      log: (m) => logs.push(m),
      requireSteam: () => {
        throw new Error('should not be called');
      },
    });
    expect(platform.mode).toBe('mock');
    expect(logs.join('\n')).toContain('adapter=mock');
  });

  it('有 STEAM_APPID 且 steamworks init 成功 → steam，日志 adapter=steam', () => {
    const logs: string[] = [];
    const calls: number[] = [];
    const platform = resolvePlatform({
      env: { STEAM_APPID: '480' },
      userDataDir: tempRoot(),
      log: (m) => logs.push(m),
      requireSteam: (appId) => {
        calls.push(appId);
        return fakeSteam(logs);
      },
    });
    expect(platform.mode).toBe('steam');
    expect(calls).toEqual([480]);
    expect(logs.join('\n')).toContain('adapter=steam');
  });

  it('init 抛错（无 Steam 客户端）→ 回落 mock，日志携带原因', () => {
    const logs: string[] = [];
    const platform = resolvePlatform({
      env: { STEAM_APPID: '480' },
      userDataDir: tempRoot(),
      log: (m) => logs.push(m),
      requireSteam: () => {
        throw new Error('Steam client not running');
      },
    });
    expect(platform.mode).toBe('mock');
    expect(logs.join('\n')).toContain('adapter=mock');
  });

  it('AppID 非数字 → mock；STEAMAPPID 别名同律', () => {
    const logs: string[] = [];
    expect(
      resolvePlatform({
        env: { STEAM_APPID: 'abc' },
        userDataDir: tempRoot(),
        log: (m) => logs.push(m),
        requireSteam: () => fakeSteam(logs),
      }).mode,
    ).toBe('mock');
    expect(
      resolvePlatform({
        env: { STEAMAPPID: '42690' },
        userDataDir: tempRoot(),
        log: (m) => logs.push(m),
        requireSteam: () => fakeSteam(logs),
      }).mode,
    ).toBe('steam');
  });
});

describe('#10 · mock 平台（文件槽位 + 成就本地记账）', () => {
  it('槽位写读回环；缺档读 null', () => {
    const root = tempRoot();
    const platform = createMockPlatform(root);
    expect(platform.loadSlot('wendao_changsheng_v3')).toBeNull();
    platform.writeSlot('wendao_changsheng_v3', '{"version":1,"time":5}');
    expect(platform.loadSlot('wendao_changsheng_v3')).toBe('{"version":1,"time":5}');
    // 落盘位置：root/saves/<key>.json（槽位文件可审计）。
    expect(existsSync(join(root, 'saves', 'wendao_changsheng_v3.json'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('键防路径穿越：含分隔符或 .. 的键拒绝且不落盘', () => {
    const root = tempRoot();
    const platform = createMockPlatform(root);
    expect(() => platform.writeSlot('../evil', '{}')).toThrow();
    expect(() => platform.writeSlot('a/b', '{}')).toThrow();
    expect(existsSync(join(root, 'evil.json'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('成就本地记账：新解锁落一条带时间戳记录；重复上报一次且仅一次', () => {
    const root = tempRoot();
    const logs: string[] = [];
    const platform = createMockPlatform(root, (m) => logs.push(m));
    platform.unlockAchievement('cycles_100');
    platform.unlockAchievement('cycles_100'); // 幂等：不重记
    platform.unlockAchievement('first_kill');
    const file = join(root, 'achievements.json');
    expect(existsSync(file)).toBe(true);
    const record = JSON.parse(readFileSync(file, 'utf8')) as {
      achievements: Record<string, string>;
    };
    expect(Object.keys(record.achievements).sort()).toEqual(['cycles_100', 'first_kill']);
    expect(typeof record.achievements['cycles_100']).toBe('string');
    // 日志只记两次真实解锁（重复上报不记）。
    expect(logs.filter((m) => m.includes('cycles_100'))).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('#10 · steam 平台（云存档 + 成就上报）', () => {
  it('槽位读写走 Steam Cloud：有云文件读内容，无云文件读 null', () => {
    const logs: string[] = [];
    const client = fakeSteam(logs);
    const platform = createSteamPlatform(client);
    expect(platform.loadSlot('exists.json')).toBe('{"version":1}');
    expect(platform.loadSlot('missing.json')).toBeNull();
  });

  it('写槽位与成就上报调用真实接口面', () => {
    const logs: string[] = [];
    const platform = createSteamPlatform(fakeSteam(logs));
    platform.writeSlot('wendao_changsheng_v3', '{"version":1}');
    platform.unlockAchievement('cycles_100');
    expect(logs.some((m) => m.startsWith('write:wendao_changsheng_v3:'))).toBe(true);
    expect(logs).toContain('activate:cycles_100');
  });

    it('云接口抛错不外溢：loadSlot null / writeSlot 静默告警', () => {
    const platform = createSteamPlatform({
      achievement: { activate: () => true },
      cloud: {
        fileExists: () => {
          throw new Error('steam down');
        },
        readFile: () => {
          throw new Error('steam down');
        },
        writeFile: () => {
          throw new Error('steam down');
        },
      },
    });
    expect(platform.loadSlot('any')).toBeNull();
    expect(() => platform.writeSlot('any', '{}')).not.toThrow();
  });
});
