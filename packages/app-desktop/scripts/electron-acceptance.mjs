#!/usr/bin/env node
// Electron 真机验收 harness（工装升格入库，票 #86；原型 .scratch/recovery-80-runtime-*/，
// rev2 8/8 场景实证，按脚本化重写）。「真实浏览器首跑」红线在 Electron 侧的机械执行面：
// 真进程、真崩溃、真事件时序，vitest+happy-dom 冒烟不能替代。
//
// 双模式（同一文件）：
//   node  packages/app-desktop/scripts/electron-acceptance.mjs [--out <目录>] [--scenario <名>]
//         —— runner：全新临时构建（electron main tsc + renderer vite，均落临时根不复用旧
//         dist）→ 逐场景搭隔离沙箱并 spawn 真 electron → 按事件流判定 → 结果落盘。
//   electron packages/app-desktop/scripts/electron-acceptance.mjs <config.json>
//         —— harness（沙箱内真 app main）：重定向 userData/sessionData/crashDumps/logs
//         四路径（在导入真实 main 之前）→ 清 Steam 环境 → dialog.showErrorBox 换记录器
//         （防无人值守模态阻塞）→ 按场景脚本驱动真 BrowserWindow/webContents → 事件 JSONL。
//
// 八场景（原型 rev2 全过）：
//   normal-ui                  真渲染层启动：mock 桥、存档往返落盘、start→running、截屏
//   crash-loop                 真崩溃连发：3 次预算内 reload、第 4 次 escalate → exit 1
//   initial-death              首载中真死：慢资源仍 pending 时 forcefullyCrashRenderer
//   stable-reset               稳定满窗重开预算：3 快崩 → 满窗后第 4 崩 → 预算重开
//   missing-index              无 dist/index.html：did-fail-load 主框架 → fatal 'load failed'
//   close-loading              首载 pending 中正常关窗：零 dialog 零 fatal
//   injected-hidden-eviction   隐藏回收事件注入（非真死）：defer 不 reload，show 后消费
//   injected-still-running     still-running 事件注入（非真死）：ignore 不吃预算
//
// 分级标注（判定与报告双面）：真实崩溃 = `forcefullyCrashRenderer-call` + `render-process-gone`
// （reason ∈ crashed/killed/abnormal-exit/oom 计入 real death）；事件注入 = `injected-render-process-gone`
// 且事件携带 `injected: true, notRealOSRecovery: true`。两者不得混淆申报。
//
// 隔离纪律（2026-09-29 删档事故为上限教训）：userData/sessionData/crashDumps/logs 在导入
// 真实 main **之前**全部重定向进一次性沙箱（os.tmpdir 下 mkdtemp）；Steam 环境变量两处清除；
// 真档与已装应用零接触；dialog.showErrorBox 被记录器替换（无人值守防模态阻塞，errorDialogRecordedNotHumanObserved），
// 不声称人工看过原生弹窗。fixture 慢资源必须等请求真实到达、load 仍 pending 才 crash/关窗。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createServer } from 'node:http';

const selfPath = fileURLToPath(import.meta.url);
const packageDir = resolve(dirname(selfPath), '..');
const repo = resolve(packageDir, '../..');
const ELECTRON_DIR = 'packages/app-desktop/electron';

const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const files = (root) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]))
        .sort()
    : [];
const hashes = (paths, base) =>
  Object.fromEntries(paths.map((path) => [relative(base, path).replaceAll('\\', '/'), hash(path)]));

const SCENARIOS = [
  'normal-ui',
  'crash-loop',
  'initial-death',
  'stable-reset',
  'missing-index',
  'close-loading',
  'injected-hidden-eviction',
  'injected-still-running',
];

if (process.versions.electron) {
  await harnessMain(process.argv[2]);
} else {
  const argv = process.argv.slice(2);
  const option = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  if (argv.includes('--self-test')) selfTest();
  else await runnerMain({ outDir: option('out'), scenario: option('scenario') });
}

// ============================== runner（普通 node） ==============================

async function runnerMain({ outDir, scenario }) {
  const names = scenario ? [scenario] : SCENARIOS;
  for (const name of names) {
    if (!SCENARIOS.includes(name)) throw new Error(`未知场景: ${name}（可选: ${SCENARIOS.join(', ')}）`);
  }
  const evidenceRoot = resolve(outDir ?? join(repo, '.scratch', `electron-acceptance-${stamp()}`));
  mkdirSync(evidenceRoot, { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'smallrpg-electron-acceptance-'));
  const require = createRequire(selfPath);
  const electronPath = require('electron');
  const commands = [];

  const sourceFiles = [
    join(repo, 'tsconfig.base.json'),
    join(packageDir, 'tsconfig.electron.json'),
    join(packageDir, 'vite.config.ts'),
    join(packageDir, 'index.html'),
    ...files(join(packageDir, 'electron')),
    ...files(join(packageDir, 'src')),
    ...files(join(repo, 'packages/engine/src')),
    ...files(join(repo, 'packages/content/src')),
  ];
  const sourceHashes = hashes(sourceFiles, repo);
  const manifest = {
    createdAt: new Date().toISOString(),
    repo,
    packageDir,
    evidenceRoot,
    tempRoot,
    node: process.version,
    installedElectronVersion: require('electron/package.json').version,
    electronPath,
    electronExeSha256: hash(electronPath),
    sourceHashesBefore: sourceHashes,
    safety: {
      onlyNewSandboxWrites: true,
      userDataRedirectedBeforeActualMainImport: true,
      appExitUnmodified: true,
      errorDialogRecordedNotHumanObserved: true,
      noMemoryExhaustion: true,
    },
    scriptHashes: hashes([selfPath], dirname(selfPath)),
  };
  writeFileSync(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ stage: 'sandbox-created', evidenceRoot, tempRoot, electron: manifest.installedElectronVersion }));

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(STEAM_APPID|STEAMAPPID|SteamAppId|SteamGameId|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
  }

  async function execute(name, executable, args, options = {}) {
    const cwd = options.cwd ?? repo;
    const stdoutPath = join(evidenceRoot, `${name}.stdout.log`);
    const stderrPath = join(evidenceRoot, `${name}.stderr.log`);
    const command = {
      name,
      executable,
      args,
      cwd,
      display: [executable, ...args].map((part) => JSON.stringify(part)).join(' '),
      timeoutMs: options.timeoutMs ?? 45000,
    };
    commands.push(command);
    writeFileSync(join(evidenceRoot, 'commands.json'), JSON.stringify(commands, null, 2));
    return await new Promise((resolvePromise, reject) => {
      const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
      command.pid = child.pid;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (data) => {
        stdout += data;
      });
      child.stderr.on('data', (data) => {
        stderr += data;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        console.log(JSON.stringify({ stage: 'timeout', name, spawnedPid: child.pid }));
        // GUI 进程树整体杀（含 renderer 子进程）；SIGKILL 到不了 Windows 的进程树。
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill('SIGKILL');
      }, command.timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        writeFileSync(stdoutPath, stdout);
        writeFileSync(stderrPath, stderr);
        Object.assign(command, { code, signal, timedOut, stdoutPath, stderrPath });
        writeFileSync(join(evidenceRoot, 'commands.json'), JSON.stringify(commands, null, 2));
        resolvePromise({ code, signal, timedOut, stdout, stderr, stdoutPath, stderrPath, pid: child.pid });
      });
    });
  }

  const buildRoot = join(tempRoot, 'build');
  mkdirSync(buildRoot, { recursive: true });
  writeFileSync(join(buildRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));

  // electron main 全新编译：node 直起 typescript/bin/tsc（避开 .bin/*.cmd 的 cmd 双层引号坑）。
  const compile = await execute('build-electron', process.execPath, [
    join(repo, 'node_modules/typescript/bin/tsc'),
    '-p',
    join(packageDir, 'tsconfig.electron.json'),
    '--outDir',
    join(buildRoot, 'dist-electron'),
  ], { timeoutMs: 120000 });
  if (compile.code !== 0) throw new Error(`electron 编译失败 (${compile.code}): ${compile.stderr}\n${compile.stdout}`);

  // renderer 全新构建：--configLoader native 防缓存写盘。
  const rendererBuild = await execute('build-renderer', process.execPath, [
    join(repo, 'node_modules/vite/bin/vite.js'),
    'build',
    '--outDir',
    join(buildRoot, 'dist'),
    '--configLoader',
    'native',
  ], { cwd: packageDir, timeoutMs: 120000 });
  if (rendererBuild.code !== 0) throw new Error(`renderer 全新构建失败 (${rendererBuild.code}): ${rendererBuild.stderr}\n${rendererBuild.stdout}`);

  cpSync(join(packageDir, 'electron/preload.cjs'), join(buildRoot, 'dist-electron/preload.cjs'));
  manifest.sourceHashesAfterBuild = hashes(sourceFiles, repo);
  manifest.sourceFrozenAcrossBuild = JSON.stringify(manifest.sourceHashesAfterBuild) === JSON.stringify(sourceHashes);
  manifest.compiledArtifactHashes = hashes(files(buildRoot), buildRoot);
  writeFileSync(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!manifest.sourceFrozenAcrossBuild) throw new Error('构建期间源码变化：证据不能声明冻结源');

  const compiledRecovery = await import(pathToFileURL(join(buildRoot, 'dist-electron/rendererRecovery.js')).href);
  const stabilityMs = compiledRecovery.RELOAD_STABILITY_WINDOW_MS;
  if (typeof stabilityMs !== 'number') throw new Error('编译产物缺 RELOAD_STABILITY_WINDOW_MS 导出');
  const reloadLimit = compiledRecovery.RELOAD_LIMIT;
  if (typeof reloadLimit !== 'number') throw new Error('编译产物缺 RELOAD_LIMIT 导出');

  const results = [];
  for (const name of names) {
    const sandboxRoot = join(tempRoot, name);
    mkdirSync(sandboxRoot, { recursive: true });
    cpSync(join(buildRoot, 'dist-electron'), join(sandboxRoot, 'dist-electron'), { recursive: true });
    writeFileSync(join(sandboxRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    mkdirSync(join(sandboxRoot, 'dist'));
    if (name === 'normal-ui') cpSync(join(buildRoot, 'dist'), join(sandboxRoot, 'dist'), { recursive: true });
    else if (name !== 'missing-index') {
      writeFileSync(
        join(sandboxRoot, 'dist', 'index.html'),
        '<!doctype html><html><body><button id="fixture">Runtime acceptance fixture</button></body></html>',
      );
    }
    const configPath = join(evidenceRoot, `${name}.config.json`);
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          name,
          sandboxRoot,
          evidenceRoot,
          mainPath: join(sandboxRoot, 'dist-electron/main.js'),
          stabilityMs,
          sourceHashes: {
            main: sourceHashes[`${ELECTRON_DIR}/main.ts`],
            recovery: sourceHashes[`${ELECTRON_DIR}/rendererRecovery.ts`],
          },
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ stage: 'scenario-start', name, sandboxRoot }));
    const run = await execute(name, electronPath, [selfPath, configPath]);

    const eventsPath = join(evidenceRoot, `${name}.events.jsonl`);
    const events = existsSync(eventsPath)
      ? readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
    const loggerPath = join(sandboxRoot, 'userData', 'wendao.log');
    const logger = existsSync(loggerPath) ? readFileSync(loggerPath, 'utf8') : '';
    const judged = judgeScenario(name, { run: { code: run.code, timedOut: run.timedOut }, events, logger, reloadLimit });
    const result = {
      name,
      passed: judged.passed,
      sandboxRoot,
      version: events.find((event) => event.type === 'bootstrap')?.versions,
      code: run.code,
      signal: run.signal,
      pid: run.pid,
      timedOut: run.timedOut,
      eventsPath,
      stdoutPath: run.stdoutPath,
      stderrPath: run.stderrPath,
      loggerPath,
      ...judged,
      rendererArtifactHashes: hashes(files(join(sandboxRoot, 'dist')), join(sandboxRoot, 'dist')),
      eventOrder: events
        .filter((event) =>
          [
            'forcefullyCrashRenderer-call',
            'loadFile-promise-rejected',
            'did-stop-loading',
            'render-process-gone',
            'load-rejection-microtask-observation',
            'load-rejection-setImmediate-observation',
            'gone-setImmediate-observation',
            'dialog-recorded-not-displayed',
          ].includes(event.type))
        .map((event) => ({ seq: event.seq, ms: event.ms, type: event.type, injected: event.injected })),
    };
    results.push(result);
    writeFileSync(join(evidenceRoot, 'results.json'), JSON.stringify({ evidenceRoot, results }, null, 2));
    console.log(JSON.stringify({
      stage: 'scenario-result',
      name,
      passed: result.passed,
      code: result.code,
      timedOut: result.timedOut,
      reloadAttempts: result.reloadAttempts,
      realRendererDeaths: result.realRendererDeaths,
      forcefullyCrashRendererCalls: result.forcefullyCrashRendererCalls,
      injectedGoneEvents: result.injectedGoneEvents,
      recordedDialogs: result.recordedDialogs,
      failures: result.failures,
    }));
  }

  manifest.sourceHashesAfterAllRuns = hashes(sourceFiles, repo);
  manifest.sourceFrozenAcrossRun = JSON.stringify(manifest.sourceHashesAfterAllRuns) === JSON.stringify(sourceHashes);
  writeFileSync(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const passed = results.every((result) => result.passed) && manifest.sourceFrozenAcrossRun;
  writeFileSync(
    join(evidenceRoot, 'results.json'),
    `${JSON.stringify({ completedAt: new Date().toISOString(), passed, evidenceRoot, manifestPath: join(evidenceRoot, 'manifest.json'), commandsPath: join(evidenceRoot, 'commands.json'), sourceFrozen: manifest.sourceFrozenAcrossRun, results }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ stage: 'complete', passed, evidenceRoot, sourceFrozen: manifest.sourceFrozenAcrossRun }));
  process.exitCode = passed ? 0 : 1;
}

// ============================== 判定（纯函数，--self-test 直测） ==============================

/**
 * 场景判定口径。分级标注在此收口：realRendererDeaths 只计真实死亡 reason，
 * forcefullyCrashRendererCalls 只计真崩溃调用，injectedGoneEvents 只计注入事件。
 * reload 口径与 main.ts 日志同源：`→ reload <n>/<RELOAD_LIMIT>`，分母由 runner 从编译产物
 * 读取传入（self-test 走缺省 3）；expectedAttempts 表与各场景的崩溃次数设计仍钉当前
 * RELOAD_LIMIT=3 的行为——改重载上限须同步重拟场景脚本与期望表，不能只改正则。
 */
export function judgeScenario(name, { run, events, logger, reloadLimit = 3 }) {
  const dialogs = events.filter((event) => event.type === 'dialog-recorded-not-displayed');
  const crashCalls = events.filter((event) => event.type === 'forcefullyCrashRenderer-call');
  const gone = events.filter((event) => event.type === 'render-process-gone');
  const realGone = gone.filter((event) => ['crashed', 'killed', 'abnormal-exit', 'oom'].includes(event.details?.reason));
  const failures = events.filter((event) => event.type === 'harness-error' || (event.type === 'assert' && !event.passed));
  const reloadAttempts = [...logger.matchAll(new RegExp(`→ reload (\\d+)\\/${reloadLimit}`, 'g'))].map((match) => Number(match[1]));
  const expectedAttempts = {
    'crash-loop': [1, 2, 3],
    'initial-death': [1],
    'stable-reset': [1, 2, 3, 1, 2],
    'injected-hidden-eviction': [1, 2, 3, 1, 2],
    'injected-still-running': [1, 2, 3, 1],
  };
  let passed = !run.timedOut && failures.length === 0;
  if (name === 'crash-loop') {
    passed = passed && run.code === 1 && crashCalls.length === 4 && realGone.length === 4
      && dialogs.length === 1 && String(dialogs[0]?.content ?? '').includes('renderer unrecoverable')
      && !logger.includes('FATAL load failed');
  } else if (name === 'missing-index') {
    passed = passed && run.code === 1 && dialogs.length === 1
      && String(dialogs[0]?.content ?? '').includes('load failed')
      && events.some((event) => event.type === 'did-fail-load' && event.isMainFrame && event.errorCode !== -3)
      && events.find((event) => event.type === 'loadFile-call')?.fileExists === false;
  } else {
    passed = passed && run.code === 0 && dialogs.length === 0
      && events.some((event) => event.type === 'scenario-success-before-close')
      && !logger.includes('FATAL');
  }
  if (expectedAttempts[name]) passed = passed && JSON.stringify(reloadAttempts) === JSON.stringify(expectedAttempts[name]);
  if (name === 'initial-death') {
    passed = passed && realGone.length === 1
      && events.some((event) => event.type === 'loadFile-promise-rejected')
      && events.some((event) => event.type === 'assert' && event.label === 'initial load is unfinished before real death' && event.passed);
  }
  return {
    passed,
    reloadAttempts,
    realRendererDeaths: realGone.length,
    forcefullyCrashRendererCalls: crashCalls.length,
    injectedGoneEvents: events.filter((event) => event.type === 'injected-render-process-gone').length,
    recordedDialogs: dialogs.length,
    failures,
  };
}

function selfTest() {
  const ok = (label, value) => {
    if (!value) throw new Error(`self-test 失败: ${label}`);
    console.log(`  ok ${label}`);
  };
  const runOk = { code: 0, timedOut: false };
  const gone = (reason) => ({ type: 'render-process-gone', details: { reason } });
  const crash = () => ({ type: 'forcefullyCrashRenderer-call' });
  const injected = (reason) => ({ type: 'injected-render-process-gone', reason, injected: true, notRealOSRecovery: true });
  const reloads = (list) => list.map((n) => `[main] renderer gone (reason=crashed) → reload ${n}/3`).join('\n');
  const dialog = (content) => ({ type: 'dialog-recorded-not-displayed', title: 't', content });

  ok('normal-ui', judgeScenario('normal-ui', {
    run: runOk,
    events: [{ type: 'loadFile-call', fileExists: true }, { type: 'scenario-success-before-close' }],
    logger: '',
  }).passed);
  ok('crash-loop', judgeScenario('crash-loop', {
    run: { code: 1, timedOut: false },
    events: [...Array.from({ length: 4 }, crash), gone('crashed'), gone('crashed'), gone('crashed'), gone('crashed'),
      dialog('问道长生 · renderer unrecoverable')],
    logger: reloads([1, 2, 3]),
  }).passed);
  ok('crash-loop 崩溃数不足必判负', !judgeScenario('crash-loop', {
    run: { code: 1, timedOut: false },
    events: [crash(), crash(), crash(), gone('crashed'), gone('crashed'), gone('crashed'), dialog('renderer unrecoverable')],
    logger: reloads([1, 2]),
  }).passed);
  ok('initial-death', judgeScenario('initial-death', {
    run: runOk,
    events: [{ type: 'loadFile-call', fileExists: true }, crash(), gone('crashed'),
      { type: 'loadFile-promise-rejected' }, { type: 'assert', label: 'initial load is unfinished before real death', passed: true },
      { type: 'scenario-success-before-close' }],
    logger: reloads([1]),
  }).passed);
  ok('stable-reset', judgeScenario('stable-reset', {
    run: runOk,
    events: [...Array.from({ length: 5 }, crash), gone('crashed'), { type: 'scenario-success-before-close' }],
    logger: reloads([1, 2, 3, 1, 2]),
  }).passed);
  ok('missing-index', judgeScenario('missing-index', {
    run: { code: 1, timedOut: false },
    events: [{ type: 'loadFile-call', fileExists: false }, { type: 'did-fail-load', isMainFrame: true, errorCode: -2 },
      dialog('fatal · load failed')],
    logger: '',
  }).passed);
  ok('missing-index 全被 -3 吞掉必判负', !judgeScenario('missing-index', {
    run: { code: 1, timedOut: false },
    events: [{ type: 'loadFile-call', fileExists: false }, { type: 'did-fail-load', isMainFrame: true, errorCode: -3 },
      dialog('load failed')],
    logger: '',
  }).passed);
  ok('close-loading', judgeScenario('close-loading', {
    run: runOk,
    events: [{ type: 'loadFile-call', fileExists: true }, { type: 'scenario-success-before-close' }],
    logger: '',
  }).passed);
  ok('injected-hidden-eviction', judgeScenario('injected-hidden-eviction', {
    run: runOk,
    events: [...Array.from({ length: 5 }, crash), gone('crashed'), injected('memory-eviction'), injected('memory-eviction'),
      { type: 'scenario-success-before-close' }],
    logger: reloads([1, 2, 3, 1, 2]),
  }).passed);
  ok('injected-still-running', judgeScenario('injected-still-running', {
    run: runOk,
    events: [...Array.from({ length: 4 }, crash), gone('crashed'), injected('still-running'), injected('still-running'),
      { type: 'scenario-success-before-close' }],
    logger: reloads([1, 2, 3, 1]),
  }).passed);
  ok('注入不计入真实死亡', judgeScenario('injected-still-running', {
    run: runOk,
    events: [crash(), gone('crashed'), injected('still-running'), { type: 'scenario-success-before-close' }],
    logger: reloads([1]),
  }).realRendererDeaths === 1);
  ok('dialog 出现即判负（normal 面）', !judgeScenario('normal-ui', {
    run: runOk,
    events: [{ type: 'scenario-success-before-close' }, dialog('x')],
    logger: '',
  }).passed);
  ok('超时必判负', !judgeScenario('normal-ui', {
    run: { code: null, timedOut: true },
    events: [{ type: 'scenario-success-before-close' }],
    logger: '',
  }).passed);
  ok('harness-error 必判负', !judgeScenario('normal-ui', {
    run: runOk,
    events: [{ type: 'scenario-success-before-close' }, { type: 'harness-error', message: 'x' }],
    logger: '',
  }).passed);
  console.log('self-test 全过。');
}

// ============================== harness（electron main 沙箱内） ==============================

async function harnessMain(configPath) {
  // electron 侧动态导入：本文件在普通 node 下作 runner 跑，顶层静态 import 'electron' 会在
  // node 侧炸（CJS 包无可命名的静态导出面），故 electron 面只在沙箱模式引入。
  const { app, BrowserWindow, dialog, ipcMain } = await import('electron');

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const root = resolve(config.sandboxRoot);
  const evidence = resolve(config.evidenceRoot);
  const eventsFile = join(evidence, `${config.name}.events.jsonl`);
  let seq = 0;
  const start = performance.now();
  const record = (type, data = {}) => {
    const event = { seq: ++seq, ms: Number((performance.now() - start).toFixed(3)), type, ...data };
    appendFileSync(eventsFile, `${JSON.stringify(event)}\n`);
    console.log(`ACCEPT ${JSON.stringify(event)}`);
  };
  const assert = (value, label, data = {}) => {
    record('assert', { label, passed: Boolean(value), ...data });
    if (!value) throw new Error(`沙箱断言失败: ${label}`);
  };

  // 重定向必须发生在导入真实 main 之前（main.ts 读 userData 落日志）。
  for (const key of Object.keys(process.env)) {
    if (/^(STEAM_APPID|STEAMAPPID|SteamAppId|SteamGameId|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete process.env[key];
  }
  for (const name of ['userData', 'sessionData', 'crashDumps', 'logs']) {
    const target = join(root, name);
    mkdirSync(target, { recursive: true });
    app.setPath(name, target);
    assert(!relative(root, app.getPath(name)).startsWith('..'), `沙箱路径 ${name}`, { path: app.getPath(name) });
  }
  app.commandLine.appendSwitch('disk-cache-dir', join(root, 'sessionData', 'cache'));
  record('bootstrap', {
    versions: process.versions,
    pid: process.pid,
    name: config.name,
    paths: Object.fromEntries(['userData', 'sessionData', 'crashDumps', 'logs'].map((name) => [name, app.getPath(name)])),
    steamEnvironmentAbsent: !Object.keys(process.env).some((key) => /^(STEAM_APPID|STEAMAPPID|SteamAppId|SteamGameId)$/i.test(key)),
    appExitUnmodified: true,
    dialogNotHumanObserved: true,
  });
  dialog.showErrorBox = (title, content) => record('dialog-recorded-not-displayed', { title, content });

  // 慢资源 fixture：请求真实到达后才让场景推进（crash / 关窗），防 fixture 抢跑。
  let slowServer;
  let slowRequests = 0;
  if (['initial-death', 'close-loading'].includes(config.name)) {
    slowServer = createServer((request, response) => {
      slowRequests += 1;
      record('slow-resource-request', { url: request.url, request: slowRequests });
      const timer = setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
          response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="black"/></svg>');
        }
      }, 1500);
      response.on('close', () => clearTimeout(timer));
    });
    await new Promise((resolveListen) => slowServer.listen(0, '127.0.0.1', resolveListen));
    const port = slowServer.address().port;
    writeFileSync(
      join(root, 'dist', 'index.html'),
      `<!doctype html><html><body><button id="fixture">Fixture</button><img src="http://127.0.0.1:${port}/delayed.svg"></body></html>`,
    );
  }

  let win;
  let wc;
  let domCount = 0;
  let crashCount = 0;
  let reloadCount = 0;
  let loadState = 'not-started';
  let lastDomAt;
  let finished = false;
  let normalStarted = false;
  let pendingActionStarted = false;
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      try {
        fn();
      } catch (error) {
        fail(error);
      }
    }, ms);
    timers.add(timer);
  };
  const snapshot = () => {
    const destroyed = !wc || wc.isDestroyed();
    return {
      destroyed,
      isCrashed: destroyed ? null : wc.isCrashed(),
      isLoading: destroyed ? null : wc.isLoading(),
      isLoadingMainFrame: destroyed ? null : wc.isLoadingMainFrame(),
      loadState,
      domCount,
      crashCount,
      reloadCount,
    };
  };
  const fail = (error) => {
    record('harness-error', { message: error.message, stack: error.stack, ...snapshot() });
    app.exit(2);
  };
  const success = (details = {}) => {
    if (finished) return;
    finished = true;
    record('scenario-success-before-close', { ...details, ...snapshot() });
    win.close();
  };
  const realCrash = (label) => {
    crashCount += 1;
    record('forcefullyCrashRenderer-call', {
      label,
      crash: crashCount,
      stableElapsedMs: lastDomAt === undefined ? null : Number((performance.now() - lastDomAt).toFixed(3)),
      ...snapshot(),
    });
    wc.forcefullyCrashRenderer();
  };
  const emitGone = (reason) => {
    record('injected-render-process-gone', { reason, injected: true, notRealOSRecovery: true, ...snapshot() });
    wc.emit('render-process-gone', {}, { reason, exitCode: 0 });
  };

  const realLoadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function (...args) {
    loadState = 'pending';
    record('loadFile-call', { file: args[0], fileExists: existsSync(args[0]) });
    const promise = realLoadFile.apply(this, args);
    promise.then(
      () => {
        loadState = 'resolved';
        record('loadFile-promise-resolved', snapshot());
      },
      (error) => {
        loadState = 'rejected';
        record('loadFile-promise-rejected', { message: error.message, ...snapshot() });
        queueMicrotask(() => record('load-rejection-microtask-observation', snapshot()));
        setImmediate(() => record('load-rejection-setImmediate-observation', snapshot()));
      },
    );
    return promise;
  };

  app.on('web-contents-created', (_event, contents) => {
    wc = contents;
    record('web-contents-created', { id: wc.id });
    const realReload = wc.reload;
    wc.reload = function (...args) {
      reloadCount += 1;
      record('webContents-reload-call', { reload: reloadCount, ...snapshot() });
      return realReload.apply(this, args);
    };
    wc.on('dom-ready', () => {
      domCount += 1;
      lastDomAt = performance.now();
      record('dom-ready', snapshot());
      later(() => onDom(), 30);
    });
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-finish-load', 'destroyed', 'unresponsive', 'responsive']) {
      wc.on(event, () => record(event, snapshot()));
    }
    wc.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) =>
      record('did-fail-load', { errorCode, description, url, isMainFrame, ...snapshot() }));
    wc.on('render-process-gone', (_event, details) => {
      record('render-process-gone', { details, ...snapshot() });
      queueMicrotask(() => record('gone-microtask-observation', snapshot()));
      setImmediate(() => record('gone-setImmediate-observation', snapshot()));
    });
    wc.on('console-message', (details) =>
      record('renderer-console', { level: details.level, message: details.message, sourceId: details.sourceId, lineNumber: details.lineNumber }));
    wc.on('preload-error', (_event, path, error) => record('preload-error', { path, message: error.message }));
  });
  app.on('browser-window-created', (_event, window) => {
    win = window;
    record('browser-window-created', { id: win.id, webPreferences: win.webContents.getLastWebPreferences() });
    for (const event of ['show', 'hide', 'close', 'closed']) win.on(event, () => record(`window-${event}`, snapshot()));
  });
  for (const event of ['before-quit', 'will-quit', 'window-all-closed']) app.on(event, () => record(`app-${event}`, snapshot()));
  process.on('exit', (code) => record('process-exit', { code }));
  ipcMain.on('wendao:save-flush', (event, key, json) => {
    record('save-flush-request-observed', { key, bytes: typeof json === 'string' ? Buffer.byteLength(json) : null });
  });

  async function normalUi() {
    if (normalStarted) return;
    normalStarted = true;
    const before = await wc.executeJavaScript(
      `(() => ({ title: document.title, bridgeMode: window.wendao?.mode, bridgeFunctions: ['loadSave','writeSave','flushSave','reportAchievement'].map(key => [key, typeof window.wendao?.[key]]), buttons: [...document.querySelectorAll('button')].map(b => ({ text:b.textContent.trim(), act:b.dataset.act, disabled:b.disabled })), appText: document.querySelector('#app')?.textContent.slice(0,600), contentError: document.querySelector('.content-error')?.textContent ?? null, nodeRequireType: typeof window.require }))()`,
    );
    record('ui-before', before);
    assert(before.bridgeMode === 'mock' && !before.contentError && before.nodeRequireType === 'undefined', 'fresh game bridge and boot');
    const roundtrip = await wc.executeJavaScript(
      `(() => { const key='acceptance_bridge_probe'; const json=JSON.stringify({sandboxOnly:true,tag:'acceptance',sequence:1}); return {before:window.wendao.loadSave(key),ack:window.wendao.flushSave(key,json),loaded:window.wendao.loadSave(key),expected:json}; })()`,
    );
    record('bridge-roundtrip', roundtrip);
    assert(roundtrip.before === null && roundtrip.ack === 'ok' && roundtrip.loaded === roundtrip.expected, 'synchronous save-flush ack and read roundtrip');
    assert(readFileSync(join(root, 'userData', 'saves', 'acceptance_bridge_probe.json'), 'utf8') === roundtrip.expected, 'roundtrip physically persisted in sandbox');
    const click = await wc.executeJavaScript(
      `(() => {const button=[...document.querySelectorAll('button[data-act="start"]')].find(b=>!b.disabled); if(!button) throw new Error('No existing enabled start button'); const result={selector:'button[data-act="start"]',text:button.textContent.trim(),skill:button.dataset.skill,index:button.dataset.index}; button.click(); return result;})()`,
    );
    record('existing-ui-start-click', click);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2100));
    const after = await wc.executeJavaScript(
      `(() => ({stopButtonPresent:!!document.querySelector('button[data-act="stop"]'),appText:document.querySelector('#app')?.textContent.slice(0,900),bars:[...document.querySelectorAll('[data-act-key]')].map(e=>({key:e.dataset.actKey,text:e.textContent,style:e.getAttribute('style')})),runningCards:document.querySelectorAll('.act-card.running').length,contentError:document.querySelector('.content-error')?.textContent??null}))()`,
    );
    record('ui-after-start-and-ticks', after);
    assert(after.stopButtonPresent && !after.contentError, 'existing UI start transitioned to running stop state after ticks');
    const image = await wc.capturePage();
    const screenshot = join(evidence, 'normal-ui.png');
    writeFileSync(screenshot, image.toPNG());
    record('capturePage-png', { path: screenshot, size: image.getSize(), empty: image.isEmpty(), visuallyInspected: false });
    success({ bridgeRoundtrip: true, gameplayRunning: true });
  }

  function pendingInitialAction() {
    if (pendingActionStarted || finished) return;
    if (slowRequests === 0) {
      assert(loadState === 'pending' && wc.isLoading(), 'slow initial resource remains pending while waiting for request', snapshot());
      later(pendingInitialAction, 10);
      return;
    }
    pendingActionStarted = true;
    const label = config.name === 'initial-death' ? 'initial load is unfinished before real death' : 'normal close occurs during pending initial load';
    assert(loadState === 'pending' && wc.isLoading(), label, { ...snapshot(), slowRequests });
    if (config.name === 'initial-death') realCrash('first load interrupted before completion');
    else success({ normalCloseWhileLoading: true });
  }

  function onDom() {
    if (finished) return;
    switch (config.name) {
      case 'normal-ui':
        normalUi().catch(fail);
        break;
      case 'crash-loop':
        realCrash('rapid post-dom-ready death');
        break;
      case 'initial-death':
        if (domCount === 1) pendingInitialAction();
        else if (!wc.isLoading()) success({ recoveredInitialLoad: true });
        else wc.once('did-finish-load', () => later(() => success({ recoveredInitialLoad: true }), 100));
        break;
      case 'close-loading':
        pendingInitialAction();
        break;
      case 'stable-reset':
        if (domCount <= 3) realCrash('rapid budget use');
        else if (domCount === 4) later(() => realCrash('death after real stability window'), config.stabilityMs + 250);
        else if (domCount === 5) realCrash('next death in reopened budget');
        else success({ stableBudgetReopened: true });
        break;
      case 'injected-hidden-eviction':
        if (domCount <= 3) realCrash('rapid budget use');
        else if (domCount === 4) {
          later(() => {
            win.hide();
            emitGone('memory-eviction');
            emitGone('memory-eviction');
            assert(reloadCount === 3, 'hidden injected eviction defers without reload');
            later(() => win.show(), 180);
          }, config.stabilityMs + 250);
        } else if (domCount === 5) realCrash('real crash after deferred injected eviction reload');
        else success({ hiddenEvictionInjected: true, notRealOSRecovery: true });
        break;
      case 'injected-still-running':
        if (domCount <= 3) realCrash('rapid budget use');
        else if (domCount === 4) {
          later(() => {
            emitGone('still-running');
            emitGone('still-running');
            assert(reloadCount === 3, 'injected still-running does not reload');
            realCrash('real crash after stable period and injected still-running');
          }, config.stabilityMs + 250);
        } else success({ stillRunningInjected: true, notRealOSRecovery: true });
        break;
    }
  }

  record('import-actual-compiled-main', { path: config.mainPath, sourceHashes: config.sourceHashes });
  await import(pathToFileURL(config.mainPath).href);
  record('main-module-imported');
}

function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}
