// @vitest-environment node
/**
 * #10 验收：桌面平台适配（主进程）——
 * - 模式裁决：无 AppID 环境变量 → mock；有 AppID 且 steamworks 可用 → steam；
 *   init 失败（无 Steam 客户端/原生模块缺失）→ 静默回落 mock；AppID 非法 → mock。
 * - mock 平台：文件槽位读写（缺档 null / 键防路径穿越）+ 成就本地记账（一次且仅一次）。
 * - steam 平台：云存档读写 + 成就上报（假客户端断言调用面）。
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
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

  it('Steam 客户端注入的驼峰 SteamAppId/SteamGameId → steam；非数字同律回 mock', () => {
    const logs: string[] = [];
    // 正式渠道线索：Steam 客户端启动注入的是驼峰键（depot 无 steam_appid.txt）。
    expect(
      resolvePlatform({
        env: { SteamAppId: '480' },
        userDataDir: tempRoot(),
        log: (m) => logs.push(m),
        requireSteam: () => fakeSteam(logs),
      }).mode,
    ).toBe('steam');
    expect(
      resolvePlatform({
        env: { SteamGameId: '42690' },
        userDataDir: tempRoot(),
        log: (m) => logs.push(m),
        requireSteam: () => fakeSteam(logs),
      }).mode,
    ).toBe('steam');
    expect(
      resolvePlatform({
        env: { SteamAppId: 'abc' },
        userDataDir: tempRoot(),
        log: (m) => logs.push(m),
        requireSteam: () => fakeSteam(logs),
      }).mode,
    ).toBe('mock');
  });

  it('init 不抛错但返回形状漂移（缺 cloud）→ 与 init 失败同律回 mock', () => {
    const logs: string[] = [];
    const root = tempRoot();
    const platform = resolvePlatform({
      env: { STEAM_APPID: '480' },
      userDataDir: root,
      log: (m) => logs.push(m),
      // 形状漂移样本：achievement 在而 cloud 缺（云存档将静默永久失败的形态）。
      requireSteam: () => ({ achievement: { activate: () => true } }) as unknown as SteamClient,
    });
    expect(platform.mode).toBe('mock');
    // 回落的 mock 必须功能完整：文件槽位可写读（非半残 steam 面）。
    expect(platform.loadSlot('wendao_changsheng_v3')).toBeNull();
    platform.writeSlot('wendao_changsheng_v3', '{"version":1}');
    expect(platform.loadSlot('wendao_changsheng_v3')).toBe('{"version":1}');
    expect(logs.join('\n')).toContain('adapter=mock');
    expect(logs.join('\n')).toContain('malformed client');
    rmSync(root, { recursive: true, force: true });
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

/* ---------- #69 项 2：读失败分错误类别 + 坏读不得被周期自动保存覆写 ---------- */

describe('#69 · mock 平台读失败分类与保槽', () => {
  it('ENOENT = 真·无档：null、零日志、写路径照常', () => {
    const root = tempRoot();
    const logs: string[] = [];
    const platform = createMockPlatform(root, (m) => logs.push(m));
    expect(platform.loadSlot('slotA')).toBeNull();
    expect(logs).toEqual([]); // 缺档不是故障，不出声
    platform.writeSlot('slotA', '{"version":1}');
    expect(platform.loadSlot('slotA')).toBe('{"version":1}');
    rmSync(root, { recursive: true, force: true });
  });

  it('非 ENOENT 读失败：null + 指名错误码的日志 + 此后该槽位的写一律拒绝覆盖', () => {
    const root = tempRoot();
    const logs: string[] = [];
    const platform = createMockPlatform(root, (m) => logs.push(m));
    mkdirSync(join(root, 'saves'), { recursive: true });
    // 故障注入：槽位路径被同名目录占住 → readFileSync 必失败且非 ENOENT。
    const blocked = join(root, 'saves', 'slotB.json');
    mkdirSync(blocked);

    expect(platform.loadSlot('slotB')).toBeNull();
    const text = logs.join('\n');
    expect(text).toMatch(/read failed/);
    expect(text).toMatch(/EISDIR|EPERM/); // 目录读取的错误码两端不同名，分类判据是「非 ENOENT」

    // 周期自动保存的形态：必须拒绝，而非把读不到的那份档换成新局。
    platform.writeSlot('slotB', '{"version":1,"state":{"gold":0}}');
    expect(logs.join('\n')).toMatch(/refus/i);
    expect(existsSync(`${blocked}.tmp`)).toBe(false); // 拒绝发生在任何写动作之前
    expect(statSync(blocked).isDirectory()).toBe(true); // 槽位本身没被替换/清空
    rmSync(root, { recursive: true, force: true });
  });

  it('保槽只钉住出事的槽位，同平台的其余槽位照写', () => {
    const root = tempRoot();
    const platform = createMockPlatform(root, () => {});
    mkdirSync(join(root, 'saves'), { recursive: true });
    mkdirSync(join(root, 'saves', 'bad.json'));
    platform.loadSlot('bad');
    platform.writeSlot('good', '{"version":1}');
    expect(platform.loadSlot('good')).toBe('{"version":1}');
    rmSync(root, { recursive: true, force: true });
  });

  it('重读成功或确认无档（ENOENT）即解除保槽：瞬时故障不永久断档', () => {
    const root = tempRoot();
    const logs: string[] = [];
    const platform = createMockPlatform(root, (m) => logs.push(m));
    const blocked = join(root, 'saves', 'slotC.json');
    mkdirSync(blocked, { recursive: true });
    expect(platform.loadSlot('slotC')).toBeNull();
    // 故障源清除（目录消失 = 此后该路径读为 ENOENT）→ 槽位重新可写。
    rmSync(blocked, { recursive: true });
    expect(platform.loadSlot('slotC')).toBeNull();
    platform.writeSlot('slotC', '{"version":1,"time":3}');
    expect(platform.loadSlot('slotC')).toBe('{"version":1,"time":3}');
    expect(logs.join('\n')).not.toMatch(/refus/i);
    rmSync(root, { recursive: true, force: true });
  });

  it('写失败不留半档：原档字节纹丝不动（tmp + rename 契约的回归网）', () => {
    const root = tempRoot();
    const logs: string[] = [];
    const platform = createMockPlatform(root, (m) => logs.push(m));
    platform.writeSlot('slotD', 'GOOD-BYTES');
    // 故障注入：临时文件位被目录占住 → writeFileSync 必抛（两端一致）。
    mkdirSync(join(root, 'saves', 'slotD.json.tmp'));
    expect(() => platform.writeSlot('slotD', 'BAD-BYTES')).toThrow();
    expect(platform.loadSlot('slotD')).toBe('GOOD-BYTES');
    // 票面这条写的是「只读目录下 writeSlot 不覆盖好档」，但「只读」在两端的落点
    // 不同：Windows 侧本机实测——目录只读属性既不拦目录内新建、也不拦往目录里
    // rename-over，只有目标**文件**只读才让 rename 吃 EPERM（原字节留存）；
    // POSIX 侧按权限模型应是反向（写与 rename 都取目录写权限，故目录 0444 两样
    // 都拦、文件 0444 谁都不拦；本仓无 POSIX 环境，这一半未实测，留此备查）。
    // 没有一根两端同义的「只读」杠杆，故改钉两端一致的那条性质：写失败时
    // tmp+rename 的临时位被目录占住 → 必抛，而正档字节不动。
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

  it('#69 · 云读失败同律保槽：读不到的档不许被云写覆盖（fileExists 恢复后解除）', () => {
    const logs: string[] = [];
    let broken = true;
    const platform = createSteamPlatform(
      {
        achievement: { activate: () => true },
        cloud: {
          fileExists: () => {
            if (broken) throw new Error('cloud unavailable');
            return true;
          },
          readFile: () => '{"version":1,"time":8}',
          writeFile: () => {
            logs.push('writeFile-called');
            return true;
          },
        },
      },
      (m) => logs.push(m),
    );
    expect(platform.loadSlot('slotS')).toBeNull();
    expect(logs.join('\n')).toMatch(/cloud read failed/);
    platform.writeSlot('slotS', '{"version":1,"state":{}}');
    expect(logs.join('\n')).toMatch(/refus/i);
    expect(logs).not.toContain('writeFile-called'); // 一次都没往云上写

    broken = false; // 云服务恢复：重读成功即解除保槽
    expect(platform.loadSlot('slotS')).toBe('{"version":1,"time":8}');
    platform.writeSlot('slotS', '{"version":1,"time":9}');
    expect(logs).toContain('writeFile-called');
  });
});
