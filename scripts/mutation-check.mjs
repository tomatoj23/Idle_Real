#!/usr/bin/env node
// 变异验红 runner（工装升格入库，票 #86；原型 .scratch/recovery-80-mutations-*/，按脚本化重写）。
//
// 测试头注钉死的纪律「变异对照…改完必须验红再还原，别信『测试在场』」的机械化执行面：
// 对一份逐票拟定的变异集，在不动真源码的前提下逐条应用 → 跑真 Vitest → 分类
// assertion-killed（红 = 测试承重）/ survived（绿 = 断言对它空转，需补例或撤变异）/
// compile-or-load-error / non-assertion-failure / execution-error / incomplete-suite-error，
// 全程 source/test hash 多时点留痕，报告落盘可复核。
//
// 运行：
//   node scripts/mutation-check.mjs --set scripts/mutation-sets/renderer-recovery-80.mjs
//     [--filter <id 正则>] [--out <报告目录>]
//   node scripts/mutation-check.mjs --self-test     （分类器合成用例自检，不跑真测试）
//
// 变异集 = ESM 数据模块（default export），形状：
//   {
//     name, description,
//     packageDir: 'packages/app-desktop',            // 自动并入该包的 package.json/vite.config.ts/tsconfig*
//     tests: ['tests/xxx.test.ts', ...],             // 相对 packageDir，shadow vitest 的 include
//     inputs: { dirs: ['...'], files: ['...'] },     // 仓库相对路径；dirs 整树、files 单件，全部进快照
//     mutations: [{ id, path, before, after, note }] // path 仓库相对；before 必须在目标文件恰好出现一次
//   }
// 逐票拟定：变异集由实施会话按目标测试头注的「变异对照」段拟定（本目录现存 renderer-recovery-80
// 是 #80 的示例集，不是缺省集）。锚点失配（源码变了）在 setup 即报错并逐条点名，不会烧完才炸。
//
// 隔离纪律（继承原型实测）：全部写入限本报告目录（write() 硬闸）；shadow 是快照镜像 +
// 桩 package.json（勿用真根 package.json——workspace 语义会串场）+ 生成 vitest.config.mts
// （include=变异集 tests、cache false、cacheDir 影子内）；vitest 走仓库 node_modules 绝对入口，
// 不复制/安装依赖；真仓源码与测试零改动，结束时再对 git 全量 tracked 文件做一遍前后 hash 对账。

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (path) => path.replaceAll('\\', '/');
const readIf = (path) => (existsSync(path) ? readFileSync(path) : null);

// ---------- 通用 runner：对任意变异集执行 快照→基线→逐变异→报告 ----------

export async function runMutationCheck({ setPath, filter, outDir }) {
  const set = (await import(pathToFileURL(resolve(setPath)).href)).default;
  const missing = ['name', 'packageDir', 'tests', 'inputs', 'mutations'].filter((key) => !(key in set));
  if (missing.length) throw new Error(`变异集缺字段: ${missing.join(', ')}`);
  const ids = new Set();
  for (const mutation of set.mutations) {
    if (ids.has(mutation.id)) throw new Error(`变异 id 重复: ${mutation.id}`);
    ids.add(mutation.id);
  }
  const selected = filter
    ? set.mutations.filter((mutation) => new RegExp(filter).test(mutation.id))
    : set.mutations;
  if (!selected.length) throw new Error(`--filter 无命中: ${filter}`);

  const home = resolve(outDir ?? join(repo, '.scratch', `mutation-check-${stamp()}`));
  const shadow = join(home, 'shadow');
  const snapshots = join(home, 'snapshot');
  const reports = join(home, 'reports');
  const testTmp = join(home, 'test-tmp');
  mkdirSync(reports, { recursive: true });
  mkdirSync(testTmp, { recursive: true });

  const write = (path, bytes) => {
    const rel = relative(home, resolve(path));
    if (rel.startsWith('..') || resolve(path) === home) {
      throw new Error(`Refusing write outside own report dir: ${path}`);
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  };
  const jsonWrite = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);
  const walk = (path) =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? walk(child) : [child];
    });

  // 输入清单：变异集显式 inputs + packageDir 的构建/测试配置件（存在才收）。
  const inputFiles = () => {
    const files = [
      ...set.inputs.dirs.flatMap((dir) => walk(join(repo, dir)).map((path) => slash(relative(repo, path)))),
      ...set.inputs.files,
    ];
    for (const config of [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'tsconfig.electron.json',
      'tsconfig.tests.json',
    ]) {
      const path = slash(join(set.packageDir, config));
      if (existsSync(join(repo, path))) files.push(path);
    }
    for (const config of ['package.json', 'tsconfig.json', 'tsconfig.base.json']) {
      if (existsSync(join(repo, config))) files.push(config);
    }
    // 根 tsconfig 是 solution-style（references 指向各包）——vite 的 tsconfig 解析链会
    // 走进被引用包的 tsconfig.json，快照里缺了就 TSCONFIG_ERROR（首跑实证）。
    for (const reference of tsconfigReferences()) {
      const path = slash(join(reference, 'tsconfig.json'));
      if (existsSync(join(repo, path))) files.push(path);
    }
    return [...new Set(files)].sort();
  };

  // setup 即验锚点：源码变了（或变异集写错）在这里逐条点名，不烧完 30 分钟才炸。
  const checkAnchors = () => {
    const stale = [];
    for (const mutation of selected) {
      const bytes = readIf(join(repo, mutation.path));
      if (!bytes) {
        stale.push({ id: mutation.id, problem: `目标文件不存在: ${mutation.path}` });
        continue;
      }
      const text = bytes.toString('utf8');
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const count = text.split(mutation.before.replaceAll('\n', eol)).length - 1;
      if (count !== 1) stale.push({ id: mutation.id, problem: `锚点出现 ${count} 次（需恰 1 次）`, path: mutation.path });
    }
    if (stale.length) {
      throw new Error(
        `锚点失配，变异集已过期或目标有误（逐条重拟后再跑）:\n${stale
          .map((item) => `  ${item.id}: ${item.problem}`)
          .join('\n')}`,
      );
    }
  };

const trackedHashes = () =>
  Object.fromEntries(
    execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .map((path) => {
        const full = join(repo, path);
        return [path, existsSync(full) && statSync(full).isFile() ? hash(readFileSync(full)) : null];
      }),
  );

/** 根 tsconfig.json 的 references[].path（solution-style）；解析不动（JSONC 形态）就当没有。 */
const tsconfigReferences = () => {
  try {
    const parsed = JSON.parse(readFileSync(join(repo, 'tsconfig.json'), 'utf8'));
    return (parsed.references ?? []).map((reference) => reference.path).filter(Boolean);
  } catch {
    return [];
  }
};

  const manifestPath = join(home, 'source-manifest.json');
  const assertSources = (stage) => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const current = inputFiles();
    const changes = [];
    if (JSON.stringify(current) !== JSON.stringify(Object.keys(manifest.files).sort())) {
      changes.push({ type: 'input-file-list-changed', current });
    }
    for (const [path, expected] of Object.entries(manifest.files)) {
      const bytes = readIf(join(repo, path));
      const actual = bytes ? hash(bytes) : null;
      if (actual !== expected.sha256) changes.push({ path, expected: expected.sha256, actual });
    }
    const check = { stage, at: new Date().toISOString(), unchanged: changes.length === 0, changes };
    jsonWrite(join(reports, `${stage}.source-hash-check.json`), check);
    if (changes.length) throw new Error(`输入源在 ${stage} 发生变化: ${JSON.stringify(changes)}`);
    return check;
  };

  const restore = () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const path of Object.keys(manifest.files)) {
      if (path === 'package.json') write(join(shadow, path), '{"name":"mutation-shadow","private":true,"type":"module"}\n');
      else write(join(shadow, path), readFileSync(join(snapshots, path)));
    }
    write(
      join(shadow, 'vitest.config.mts'),
      [
        `import originalConfig from './${slash(join(set.packageDir, 'vite.config.ts'))}';`,
        'export default {',
        '  ...originalConfig,',
        `  cacheDir: ${JSON.stringify(join(shadow, '.cache'))},`,
        '  test: {',
        `    include: ${JSON.stringify(set.tests.map((path) => slash(join(set.packageDir, path))))},`,
        '    cache: false,',
        '  },',
        '};',
        '',
      ].join('\n'),
    );
    const restored = Object.entries(manifest.files)
      .filter(([path]) => path !== 'package.json')
      .every(([path, info]) => hash(readFileSync(join(shadow, path))) === info.sha256);
    if (!restored) throw new Error('shadow 还原后 hash 不符');
  };

  const applyMutation = (mutation) => {
    const target = join(shadow, mutation.path);
    const originalBytes = readFileSync(target);
    const original = originalBytes.toString('utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const before = mutation.before.replaceAll('\n', eol);
    const after = mutation.after.replaceAll('\n', eol);
    if (original.split(before).length !== 2) throw new Error(`shadow 内锚点非唯一: ${mutation.id}`);
    const mutated = original.replace(before, after);
    write(target, mutated);
    jsonWrite(join(reports, `${mutation.id}.mutation.json`), {
      ...mutation,
      originalSha256: hash(originalBytes),
      mutatedSha256: hash(mutated),
      changedFiles: [mutation.path],
    });
  };

  const vitestEntry = join(repo, 'node_modules/vitest/vitest.mjs');
  if (!existsSync(vitestEntry)) throw new Error(`vitest 入口不存在: ${vitestEntry}`);
  const run = (id) => {
    const output = join(reports, `${id}.vitest.json`);
    const args = [
      vitestEntry,
      'run',
      '--root',
      shadow,
      '--config',
      join(shadow, 'vitest.config.mts'),
      '--configLoader',
      'runner',
      '--no-cache',
      '--reporter',
      'json',
      '--outputFile',
      output,
      '--includeTaskLocation',
    ];
    const env = { ...process.env, CI: '1', NO_COLOR: '1', TMPDIR: testTmp, TMP: testTmp, TEMP: testTmp };
    delete env.FORCE_COLOR;
    for (const key of ['STEAM_APPID', 'STEAMAPPID', 'SteamAppId', 'SteamGameId', 'VITE_DEV_SERVER_URL']) delete env[key];
    const startedAt = new Date().toISOString();
    const began = Date.now();
    const child = spawnSync(process.execPath, args, {
      cwd: shadow,
      env,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    write(join(reports, `${id}.stdout.log`), child.stdout ?? '');
    write(join(reports, `${id}.stderr.log`), child.stderr ?? '');
    const report = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null;
    const result = classifyRun({ child, report, stderrText: child.stderr ?? '' });
    const settled = { ...result, id, startedAt, durationMs: Date.now() - began, args, cwd: shadow, rawReport: output };
    jsonWrite(join(reports, `${id}.result.json`), settled);
    console.log(
      `${id.padEnd(44)} ${settled.classification.padEnd(24)} total=${settled.totalTests} failed=${settled.failedTests} assertions=${settled.assertionFailureCount} ${settled.durationMs}ms`,
    );
    return settled;
  };

  checkAnchors();
  const files = {};
  for (const path of inputFiles()) {
    const bytes = readFileSync(join(repo, path));
    files[path] = { sha256: hash(bytes), bytes: bytes.length };
    write(join(snapshots, path), bytes);
  }
  jsonWrite(manifestPath, {
    capturedAt: new Date().toISOString(),
    repo,
    set: { name: set.name, description: set.description, file: slash(setPath) },
    nodeVersion: process.version,
    vitestVersion: JSON.parse(readFileSync(join(repo, 'node_modules/vitest/package.json'), 'utf8')).version,
    viteVersion: JSON.parse(readFileSync(join(repo, 'node_modules/vite/package.json'), 'utf8')).version,
    files,
    trackedFiles: trackedHashes(),
    initialGitStatus: execFileSync('git', ['-C', repo, 'status', '--short'], { encoding: 'utf8' }),
  });

  assertSources('baseline-before');
  restore();
  const baseline = run('baseline');
  assertSources('baseline-after');
  if (baseline.classification !== 'green') throw new Error(`基线非绿（${baseline.classification}），先修测试再变异`);

  const results = [];
  for (const mutation of selected) {
    assertSources(`${mutation.id}-before`);
    restore();
    applyMutation(mutation);
    const result = run(mutation.id);
    result.classification = settleClassification(result.classification, result.totalTests, baseline.totalTests);
    results.push({ ...result, mutation });
    restore();
    assertSources(`${mutation.id}-after`);
    jsonWrite(join(home, 'mutation-results.json'), { baseline, results });
  }

  const finalBaseline = run('final-baseline');
  assertSources('final');
  const initial = JSON.parse(readFileSync(manifestPath, 'utf8')).trackedFiles;
  const current = trackedHashes();
  const changes = [...new Set([...Object.keys(initial), ...Object.keys(current)])]
    .filter((path) => initial[path] !== current[path])
    .map((path) => ({ path, before: initial[path], after: current[path] }));
  const checks = readdirSync(reports).filter((path) => path.endsWith('.source-hash-check.json'));
  const final = {
    completedAt: new Date().toISOString(),
    home,
    set: { name: set.name, file: slash(setPath) },
    baseline,
    finalBaseline,
    results,
    summary: {
      total: results.length,
      assertionKilled: results.filter((item) => item.classification === 'assertion-killed').length,
      survivors: results.filter((item) => item.classification === 'survived').map((item) => item.id),
      independentErrors: results
        .filter((item) => !['assertion-killed', 'survived'].includes(item.classification))
        .map((item) => ({ id: item.id, classification: item.classification })),
    },
    sourceHashChecks: { count: checks.length, allUnchanged: checks.every((path) =>
      JSON.parse(readFileSync(join(reports, path), 'utf8')).unchanged) },
    trackedFilesUnchanged: changes.length === 0,
    trackedFileChanges: changes,
    finalGitStatus: execFileSync('git', ['-C', repo, 'status', '--short'], { encoding: 'utf8' }),
  };
  jsonWrite(join(home, 'mutation-results.json'), final);
  console.log(`\n汇总: ${JSON.stringify(final.summary)}`);
  console.log(`hash 留痕: ${final.sourceHashChecks.count} 次核验，全部一致=${final.sourceHashChecks.allUnchanged}`);
  console.log(`报告目录: ${home}`);
  if (finalBaseline.classification !== 'green' || changes.length) process.exitCode = 1;
}

// ---------- 分类器（纯函数，--self-test 直测） ----------

const RUNTIME_OR_COMPILE =
  /Transform failed|ParseError|SyntaxError|Failed to load url|Cannot find (module|package)|Failed to resolve import|Unknown file extension/;
const ASSERTION = /AssertionError:|expected .+ to (be|equal|contain|have|match)/s;

/**
 * 从一次 vitest 子进程运行判定类别。口径（继承原型 rev2）：
 * - execution-error：子进程没起来/被信号杀（没跑成，与被测行为无关）；
 * - compile-or-load-error：转换/解析/模块解析炸了（变异把模块弄坏了，非断言红）；
 * - green：exit 0 且报告 success 且 0 failed（变异存活的前身）；
 * - assertion-killed：exit 非 0 且存在 AssertionError 形态的失败（测试真承重）；
 * - non-assertion-failure：红了但不是断言红（测试自身崩了，结果不可判）。
 */
export function classifyRun({ child, report, stderrText }) {
  const failures = (report?.testResults ?? []).flatMap((suite) =>
    (suite.assertionResults ?? [])
      .filter((item) => item.status === 'failed')
      .map((item) => ({
        file: suite.name,
        title: item.fullName ?? item.title,
        location: item.location,
        messages: item.failureMessages ?? [],
      })),
  );
  const messages = failures.flatMap((failure) => failure.messages).join('\n');
  const suiteMessages = (report?.testResults ?? []).map((suite) => suite.message ?? '').join('\n');
  const assertionFailures = failures.filter((failure) =>
    failure.messages.some((message) => ASSERTION.test(message)));
  let classification;
  if (child?.error || child?.signal || !report) classification = 'execution-error';
  else if (RUNTIME_OR_COMPILE.test(`${stderrText}\n${messages}\n${suiteMessages}`)) classification = 'compile-or-load-error';
  else if (child.status === 0 && report.success && report.numFailedTests === 0) classification = 'green';
  else if (child.status !== 0 && assertionFailures.length > 0) classification = 'assertion-killed';
  else classification = 'non-assertion-failure';
  return {
    classification,
    exitCode: child?.status,
    signal: child?.signal,
    error: child?.error?.message,
    totalTests: report?.numTotalTests,
    passedTests: report?.numPassedTests,
    failedTests: report?.numFailedTests,
    runtimeErrorTestSuites: report?.numRuntimeErrorTestSuites,
    assertionFailureCount: assertionFailures.length,
    failures,
  };
}

/** green 对变异议面收口：用例总数与基线不符 = 套件没跑全，不算 survivor。 */
export function settleClassification(classification, totalTests, baselineTotalTests) {
  if (totalTests !== baselineTotalTests) return 'incomplete-suite-error';
  if (classification === 'green') return 'survived';
  return classification;
}

function stamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '-').slice(0, 19);
}

// ---------- CLI ----------

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

if (argv.includes('--self-test')) {
  selfTest();
} else {
  const setPath = option('set');
  if (!setPath) {
    console.error('用法: node scripts/mutation-check.mjs --set <变异集.mjs> [--filter <id 正则>] [--out <目录>]');
    console.error('示例: node scripts/mutation-check.mjs --set scripts/mutation-sets/renderer-recovery-80.mjs');
    process.exit(2);
  }
  await runMutationCheck({ setPath, filter: option('filter'), outDir: option('out') });
}

function selfTest() {
  const ok = (label, value) => {
    if (!value) throw new Error(`self-test 失败: ${label}`);
    console.log(`  ok ${label}`);
  };
  const base = (overrides) => ({
    child: { status: 0, signal: null, error: undefined },
    report: { success: true, numTotalTests: 61, numPassedTests: 61, numFailedTests: 0, testResults: [] },
    stderrText: '',
    ...overrides,
  });
  ok('green', classifyRun(base()).classification === 'green');
  ok(
    'assertion-killed',
    classifyRun(
      base({
        child: { status: 1, signal: null, error: undefined },
        report: {
          success: false,
          numTotalTests: 61,
          numPassedTests: 59,
          numFailedTests: 2,
          testResults: [
            {
              name: 'rendererRecovery.test.ts',
              assertionResults: [
                { title: 'escalates on 4th crash', fullName: 'x > escalates on 4th crash', status: 'failed',
                  location: { line: 12 },
                  failureMessages: ['AssertionError: expected 4 to be 3'] },
              ],
            },
          ],
        },
      }),
    ).classification === 'assertion-killed',
  );
  ok(
    'compile-or-load-error（stderr 命中）',
    classifyRun(base({ child: { status: 2, signal: null, error: undefined }, report: { success: false, numTotalTests: 0, numFailedTests: 0, testResults: [] },
      stderrText: 'Error: Failed to resolve import "./missing"' })).classification === 'compile-or-load-error',
  );
  ok(
    'compile-or-load-error（失败消息命中）',
    classifyRun(
      base({
        child: { status: 2, signal: null, error: undefined },
        report: {
          success: false, numTotalTests: 61, numPassedTests: 0, numFailedTests: 0,
          testResults: [{ name: 'x.test.ts', message: 'ParseError: unexpected token', assertionResults: [] }],
        },
      }),
    ).classification === 'compile-or-load-error',
  );
  ok(
    'non-assertion-failure（红了但无断言形态）',
    classifyRun(
      base({
        child: { status: 1, signal: null, error: undefined },
        report: {
          success: false, numTotalTests: 61, numPassedTests: 60, numFailedTests: 1,
          testResults: [
            { name: 'x.test.ts', assertionResults: [{ title: 't', status: 'failed', failureMessages: ['TypeError: boom'] }] },
          ],
        },
      }),
    ).classification === 'non-assertion-failure',
  );
  ok('execution-error（无报告）', classifyRun(base({ child: { status: null, signal: 'SIGKILL', error: undefined }, report: null })).classification === 'execution-error');
  ok('execution-error（spawn 失败）', classifyRun(base({ child: { status: null, signal: null, error: new Error('ENOENT') }, report: null })).classification === 'execution-error');
  ok('settle: green→survived', settleClassification('green', 61, 61) === 'survived');
  ok('settle: 总数不符→incomplete-suite-error', settleClassification('green', 60, 61) === 'incomplete-suite-error');
  ok('settle: 非 green 原样保留', settleClassification('assertion-killed', 61, 61) === 'assertion-killed');
  console.log('self-test 全过。');
}
