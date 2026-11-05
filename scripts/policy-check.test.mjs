// policy-check 金丝雀自测（#82 验收的「人为构造违规样例 → 变红」层，临时 fixture 不改真源码）。
// 运行：node scripts/policy-check.mjs --self-test（或直接跑本文件）。
//
// 「如何变红」（金丝雀巡检用，同 #81 钩子协议）：
//   - DENY 组：改坏/放空对应断言实现 → 该组翻绿（门禁失效信号）。
//   - ALLOW 组：检测面变宽（如改成裸词表）→ 该组翻红（误伤信号，比失效更伤）。
//   - E2E 组：在临时 fixture 树放违规文件跑 runCheck → 必须报错；干净树 → 必须零报。
//   - E2E-P9 组：临时树内 git init+add（#97 持久备注：临时树非 git 仓则 git ls-files
//     收集不到=静默假绿，故本组走真收集路径）；git 不可用时跳过并注明。
// 真仓本体的红由 `node scripts/policy-check.mjs` 直接跑（金丝雀只验证门禁实现本身）。
//
// 本文件含真档路径/平台全局的违禁字样作**用例数据**（字符串，非真实落盘），按豁免纪律
// 声明如下（此行同时是豁免机制的活演示）：
// policy-allow: P4 金丝雀用例数据（模拟违禁输入，非真实写盘路径）
// 注意：无理由的 policy-allow 形态（如行尾就断）在本文件里必须拼接构造——字面连续
// 出现会把本文件自己豁免/提示掉，属自误伤。
// P9 乱码用例一律 \uFFFD 转义构造：转义在源码里是 6 个 ASCII 字符、运行时才成真字符，
// 源文件保持无真实 U+FFFD 字节，防 P9 上线后金丝雀自己踩红。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkFile, runCheck } from "./policy-check.mjs";

// ---------- 用例数据（字符串拼接防自我误伤的部分已注明） ----------

const P1_FILE = "packages/engine/src/probe.ts";
const P3_FILE = "packages/content/src/schema/probe.schema.json";
const P4_FILE = "packages/engine/tests/probe.test.ts";

// DENY：命中即门禁有效的违禁形状
const DENY_CASES = [
  // ---- P1 ----
  ["P1-bare-call", P1_FILE, "setInterval(flush, 1000);", "P1"],
  ["P1-storage-member", P1_FILE, "const v = localStorage.getItem('k');", "P1"],
  ["P1-window-chain", P1_FILE, "window.addEventListener('x', f);", "P1"],
  ["P1-document-member", P1_FILE, "const t = document.title;", "P1"],
  ["P1-globalThis-static", P1_FILE, "const t = globalThis.setTimeout;", "P1"],
  ["P1-node-process", P1_FILE, "const env = process.env.NODE_ENV;", "P1"],
  ["P1-new-xhr", P1_FILE, "const x = new XMLHttpRequest();", "P1"],
  ["P1-raf", P1_FILE, "requestAnimationFrame(step);", "P1"],
  ["P1-type-typeof-query", P1_FILE, "type T = typeof setTimeout;", "P1"],
  // ---- P1 对抗审计加固回归（F1 词法失步 / F2 声明名误报 / F3 跳过区逃逸 / F4 引用位）----
  ["P1-fn-after-regex", P1_FILE, "const re = /['\"]/;\nsetInterval(f, 1);", "P1"],
  ["P1-type-escape", P1_FILE, "type Alias = number\nexport function tick() { setInterval(f, 1); }", "P1"],
  ["P1-ternary-value", P1_FILE, "const x = flag ? document : null;", "P1"],
  ["P1-case-value", P1_FILE, "switch (x) { case document: break; }", "P1"],
  ["P1-spread", P1_FILE, "f(...document);", "P1"],
  ["P1-template-expr", P1_FILE, "const s = `${document}`;", "P1"],
  ["P1-globalthis-optional", P1_FILE, "globalThis?.setTimeout(f, 1);", "P1"],
  ["P1-call-arg-mid", P1_FILE, "report(a, document, b);", "P1"],
  ["P1-param-default-ref", P1_FILE, "function f(a = window) {}", "P1"],
  // ---- P3 ----
  ["P3-defs-key", P3_FILE, '{"$defs": {}, "definitions": {}}', "P3"],
  // ---- P7 ----
  ["P7-math-random", P1_FILE, "const x = Math.random();", "P7"],
  ["P7-date-now", P1_FILE, "const t = Date.now();", "P7"],
  // ---- P4 ----
  ["P4-percent-appdata", P4_FILE, "rmSync(String.raw`%APPDATA%\\问道长生\\saves\\x.json`);", "P4"],
  ["P4-escaped-absolute", P4_FILE, "const p = 'C:\\Users\\me\\AppData\\Roaming\\问道长生\\saves\\x.json';", "P4"],
  ["P4-powershell-env", P4_FILE, "run(`del $env:APPDATA\\问道长生\\saves\\x.json`);", "P4"],
  ["P4-process-env-join", P4_FILE, "const p = path.join(process.env.APPDATA, '问道长生');", "P4"],
  ["P4-linux-form", P4_FILE, "const p = '/home/u/.config/问道长生/saves/x.json';", "P4"],
  ["P4-lowercase-roaming", P4_FILE, "const p = 'roaming\\问道长生\\x.json';", "P4"],
  ["P4-lowercase-env", P4_FILE, "const p = path.join(process.env.appdata, '问道长生');", "P4"],
  ["P4-join-array", P4_FILE, "fs.rmSync(path.join('AppData', 'Roaming', '问道长生', 'x.json'));", "P4"],
  ["P4-pragma-in-string", P4_FILE, "const note = 'policy-allow: P4 已备份';\nrmSync('%APPDATA%\\问道长生\\x');", "P4"],
  // ---- P9（\uFFFD 转义构造：源文件保持无真实乱码字节，运行时才成真字符——见头注）----
  ["P9-fffd-in-md", "docs/probe.md", "前文\uFFFD后文", "P9"],
  ["P9-fffd-in-json", "scripts/probe.json", '{"v": "a\uFFFDb"}', "P9"],
  // ---- P2（review 级，命中=有提示）----
  ["P2-destructure-window", "packages/engine/src/probe.ts", "const { setTimeout } = window;", "P2"],
  ["P2-destructure-console", "packages/engine/src/probe.ts", "const { log } = console;", "P2"],
  ["P2-member-extract", "packages/engine/src/probe.ts", "const si = globalThis.setInterval;", "P2"],
  // ---- P5 / P6（review 级）----
  ["P5-no-date", "docs/research/probe.md", "快照见 D:\\My_Projects\\Reference_Documents\\electron-main", "P5"],
  ["P6-semver", "AGENTS.md", "现役 Electron 38.8.6 暂持", "P6"],
  ["P6-tool-major", "AGENTS.md", "现役 TS 7 = Go 原生编译器", "P6"],
  ["P6-lowercase-tool", "AGENTS.md", "现役 electron 44 暂持", "P6"],
];

// ALLOW：基线合规形状（P1 的五类排除 + P4 的沙箱/URL 夹具 + 探测别名），
// 任何一条翻红 = 检测面变宽误伤（票 #82「宁可漏报不误报」红线）。
const ALLOW_CASES = [
  ["L-bracket-probe", P1_FILE, "const timer = g['setInterval'];"],
  ["L-bracket-probe-storage", P1_FILE, "const s = asStorage(g['localStorage']);"],
  ["L-interface-members", P1_FILE, "interface TimerLike {\n  setInterval(handler: () => void, ms: number): unknown;\n  clearInterval(handle: unknown): void;\n  document: DocumentLike | undefined;\n  window: EventTargetLike | undefined;\n}"],
  ["L-type-block-method", P1_FILE, "type HandlerLike = { setTimeout(handler: () => void): void };"],
  ["L-comment-mention", P1_FILE, "// memory / localStorage 可换（SPEC US-24）；window/document 同理"],
  ["L-string-mention", P1_FILE, "report?.(`save storage unavailable (no localStorage): ${key}`);"],
  ["L-property-key", P1_FILE, "const r = {\n  setInterval: (timer as TimerLike['setInterval']).bind(g),\n  window: asEvents(g['window']),\n};"],
  ["L-destructure-rename", P1_FILE, "const { document: doc, window: win, timer } = platformOf();"],
  ["L-local-object-member", P1_FILE, "const handle = timer ? timer.setInterval(flush, intervalMs) : undefined;"],
  ["L-ident-containing", P1_FILE, "const localStorageSaveAdapter = makeAdapter();"],
  ["L-param-name", P1_FILE, "function attach(window: EventTargetLike): void {}"],
  ["L-probe-alias-then-bind", P1_FILE, "const g = globalThis as Record<string, unknown>;\nconst timer = g['setInterval'];\nconst bound = (timer as TimerLike['setInterval']).bind(g);"],
  ["L-p3-definitions-ref", P3_FILE, '{"item": {"$ref": "#/definitions/item"}}'],
  ["L-p3-ts-comment", "packages/content/src/schema/keywords.ts", "// 勿用 $defs——校验器只认 #/definitions/"],
  ["L-p4-userdata-dir-inject", P4_FILE, "const ctx = makeGame({ userDataDir: tempRoot() });"],
  ["L-p4-file-url-fixture", P4_FILE, "const PACKAGED = 'file:///D:/games/wendao/dist/index.html';\nconst evil = 'file:///C:/evil.html';"],
  ["L-p4-tmpdir", P4_FILE, "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't-'));"],
  ["L-p4-pragma", P4_FILE, "// policy-allow: P4 用例数据（模拟违禁输入）\nconst p = String.raw`%APPDATA%\\问道长生`;"],
  ["L-p5-dated", "docs/research/probe.md", "electron-main 快照 2026-09-29 取档（main 分支）"],
  ["L-p6-node10-mode", "AGENTS.md", "`moduleResolution: node10` 与 draft-07 均为形态名，不是时点版本"],
  ["L-p6-major-only-tool", "AGENTS.md", "vitest 默认池（forks）即可"],
  ["L-p6-ip-not-version", "AGENTS.md", "内网 127.0.0.1:5173 与 draft-07 均非版本号"],
  // ---- P7 合规形状（裸 random/now 与撞名形态、下标探测逃生门不得误伤）----
  ["L-p7-clock-now", P1_FILE, "const t = clock.now();"],
  ["L-p7-perf-now", P1_FILE, "const t = performance.now();"],
  ["L-p7-new-date", P1_FILE, "const d = new Date(iso);"],
  ["L-p7-subscript-probe", P1_FILE, "const rnd = Math['random'];"],
  // ---- P1 对抗审计加固回归（声明名/定义位不得误伤）----
  ["L-regex-string-safety", P1_FILE, "const re = /[\"/];\nconst s = \"document\";"],
  ["L-class-method", P1_FILE, "class T { setInterval(fn: () => void, ms: number): void {} }"],
  ["L-object-method", P1_FILE, "const o = { setInterval(fn) {}, get localStorage() { return 1; } };"],
  ["L-param-plain", P1_FILE, "function f(window) {}"],
  ["L-catch-binding", P1_FILE, "try {} catch (document) {}"],
  ["L-destr-default", P1_FILE, "const { document = d } = x;"],
  ["L-array-destr-default", P1_FILE, "const [document = 1] = arr;"],
  // ---- P9 合规形状（白名单外扩展永不扫描；ASCII 提及「EF BF BD / U+FFFD」字样不是乱码本身）----
  ["L-p9-binary-ext", "assets/logo.png", "\uFFFD 在二进制扩展内，不进文本面"],
  ["L-p9-ascii-mention", "docs/probe.md", "字节序列 EF BF BD 与替换符字样 U+FFFD 均为 ASCII 提及"],
];

// ---------- 断言执行 ----------

function runCaseTable(cases, expectHit) {
  let failed = 0;
  const report = (ok, msg) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  };
  for (const [name, file, content, rule] of cases) {
    const found = checkFile(file, content);
    if (expectHit) {
      const hit = found.some((v) => v.rule === rule);
      report(
        hit,
        `deny  ${name}（期望 ${rule} 命中${found.length ? `，实得 ${found.map((v) => v.rule).join(",")}` : "，实得零命中——门禁失效"}）`,
      );
    } else {
      // allow 组断言「零命中」：任何规则的任何命中都是误伤（跨规则噪声同样算）
      report(
        found.length === 0,
        `allow ${name}${found.length ? `（误伤：${found.map((v) => `${v.rule}:${v.detail}`).join(";")}）` : ""}`,
      );
    }
  }
  return failed;
}

function runE2E() {
  let failed = 0;
  const report = (ok, msg) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "policy-check-canary-"));
  try {
    // 违规树：P1/P3/P4/P7 各放一例 + P5/P6 各一例（review 级）+ package.json 触发 P8（零基线树）
    const bad = {
      "package.json": "{}\n",
      "packages/engine/src/bad.ts": "setInterval(flush, 1000);\nlocalStorage.getItem('k');\n",
      "packages/engine/src/bad2.ts": "const x = Math.random();\nconst t = Date.now();\n",
      "packages/content/src/schema/bad.schema.json": '{"$defs": {}}\n',
      "packages/engine/tests/bad.test.ts": "const p = 'C:\\Users\\me\\AppData\\Roaming\\问道长生\\saves\\x.json';\n",
      "docs/research/nodate.md": "见 D:\\My_Projects\\Reference_Documents\\electron-main\n",
      "AGENTS.md": "现役 Electron 38.8.6\n",
    };
    for (const [rel, content] of Object.entries(bad)) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    const badResult = runCheck(tmp);
    const badRules = new Set(badResult.errors.map((v) => v.rule));
    report(
      badRules.has("P1") && badRules.has("P3") && badRules.has("P4") && badRules.has("P7") && badRules.has("P8"),
      `e2e 违规树 P1/P3/P4/P7/P8 全部报错（实得 ${[...badRules].join(",") || "零"}）`,
    );
    report(badResult.errors.length > 0, `e2e 违规树整体变红（errors=${badResult.errors.length}）`);
    const warnRules = new Set(badResult.warnings.map((v) => v.rule));
    report(warnRules.has("P5") && warnRules.has("P6"), `e2e 违规树 P5/P6 出 review 提示（实得 ${[...warnRules].join(",") || "零"}）`);

    // 干净树：基线合规形状 → 零报
    const clean = path.join(tmp, "clean");
    const good = {
      "packages/engine/src/good.ts": "const g = globalThis as Record<string, unknown>;\nconst timer = g['setInterval'];\nconst { document: doc } = platformOf();\ninterface TimerLike {\n  setInterval(handler: () => void, ms: number): unknown;\n}\nconst handle = timer.setInterval(flush, 1000);\n",
      "packages/content/src/schema/good.schema.json": '{"item": {"$ref": "#/definitions/item"}}\n',
      "packages/app-desktop/tests/good.test.ts": "const ctx = makeGame({ userDataDir: tempRoot() });\nconst u = 'file:///C:/evil.html';\n",
      "docs/research/good.md": "electron-main 快照 2026-09-29 取档\n",
      "AGENTS.md": "动工具链前先读 package.json 的实际版本\n",
    };
    for (const [rel, content] of Object.entries(good)) {
      const abs = path.join(clean, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    const cleanResult = runCheck(clean);
    report(
      cleanResult.errors.length === 0 && cleanResult.warnings.length === 0,
      `e2e 干净树零报（errors=${cleanResult.errors.length} warnings=${cleanResult.warnings.length}）`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return failed;
}

function runPragmaInvalid() {
  // 无理由豁免必须被忽略并提示（拼接构造，防本文件自身被误豁免——见头注）
  const bare = "// policy-allow: " + "P4";
  const content = `${bare}\nconst p = String.raw\`%APPDATA%\\问道长生\`;\n`;
  const found = checkFile("packages/engine/tests/x.test.ts", content);
  const hasP4 = found.some((v) => v.rule === "P4");
  const hasInvalid = found.some((v) => v.detail.includes("豁免未注明理由"));
  let failed = 0;
  if (!hasP4) {
    failed++;
    console.log("FAIL  pragma-invalid 无理由豁免仍须报 P4（实得零命中——豁免失效）");
  } else console.log("PASS  pragma-invalid 无理由豁免仍报 P4");
  if (!hasInvalid) {
    failed++;
    console.log("FAIL  pragma-invalid 无理由豁免须出「未注明理由」提示");
  } else console.log("PASS  pragma-invalid 无理由豁免出「未注明理由」提示");
  return failed;
}

function runPragmaP9() {
  // P9 豁免通路（#97 brief：同一 allowPragmas 机制，正则放宽至 P9——不改则 P9 豁免连
  // 解析都进不去）。无理由形态仍须拼接构造（见头注），防本文件被自家用例豁免/提示。
  let failed = 0;
  const report = (ok, msg) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  };
  const exemptContent = `policy-allow: P9 用例数据（模拟乱码输入）\n乱\uFFFD码\n`;
  report(
    checkFile("docs/probe.md", exemptContent).length === 0,
    "pragma-p9 带理由豁免放行（P9 不再报）",
  );
  const bare = "// policy-allow: " + "P9";
  const bareContent = `${bare}\n乱\uFFFD码\n`;
  const found = checkFile("docs/probe.md", bareContent);
  report(found.some((v) => v.rule === "P9"), "pragma-p9 无理由豁免仍须报 P9");
  report(found.some((v) => v.detail.includes("豁免未注明理由")), "pragma-p9 无理由豁免出「未注明理由」提示");
  return failed;
}

function runE2EP9() {
  // P9 受跟踪面 e2e（#97 持久备注口径）：runE2E 的 mkdtempSync 临时树非 git 仓，
  // git ls-files 收集不到 = 静默假绿——本块在临时树内 git init+add 走真收集路径。
  // git 不可用时整组跳过并注明（扫描/豁免语义已由 DENY/ALLOW/pragma-p9 组覆盖，不依赖 git）。
  let failed = 0;
  let ran = 0;
  const report = (ok, msg) => {
    ran++;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "policy-check-p9-"));
  try {
    const trackedRel = "docs/tracked-mojibake.md";
    const untrackedRel = "docs/untracked-mojibake.md";
    const cleanRel = "docs/clean-mention.md";
    fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmp, trackedRel), "乱\uFFFD码\n", "utf8");
    fs.writeFileSync(path.join(tmp, untrackedRel), "乱\uFFFD码\n", "utf8");
    fs.writeFileSync(path.join(tmp, cleanRel), "字节序列 EF BF BD 与字样 U+FFFD 均为 ASCII 提及\n", "utf8");
    fs.mkdirSync(path.join(tmp, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "assets/logo.png"), "not-text \uFFFD bytes", "utf8");
    const init = spawnSync("git", ["init"], { cwd: tmp });
    const add = spawnSync("git", ["add", trackedRel, cleanRel], { cwd: tmp });
    if (init.status !== 0 || add.status !== 0) {
      console.log("SKIP  e2e-p9 git 不可用/init|add 失败，本组跳过——受跟踪面收集路径未在本机验证");
      return { failed, ran };
    }
    const result = runCheck(tmp);
    const p9Errors = result.errors.filter((v) => v.rule === "P9");
    report(
      p9Errors.length === 1 && p9Errors[0].file === trackedRel,
      `e2e-p9 受跟踪乱码文件恰报一条 P9 且含文件名（实得 ${p9Errors.map((v) => `${v.file}:${v.line}`).join(",") || "零"}）`,
    );
    report(
      !result.errors.some((v) => v.file === untrackedRel) && !result.warnings.some((v) => v.file === untrackedRel),
      "e2e-p9 未跟踪乱码文件不报（受跟踪面过滤）",
    );
    report(
      !result.errors.some((v) => v.file === cleanRel) && !result.warnings.some((v) => v.file === cleanRel),
      "e2e-p9 ASCII 提及乱码字样的干净文本不报（误伤面）",
    );
    report(
      !result.errors.some((v) => v.file.endsWith("logo.png")) && !result.warnings.some((v) => v.file.endsWith("logo.png")),
      "e2e-p9 白名单外扩展（.png）不扫（零误伤构造性保证）",
    );
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true }); // .git 只读对象由 node rm 的 EPERM 重试兜住
    } catch {
      console.log(`WARN  e2e-p9 临时树清理失败（残留：${tmp}）`);
    }
  }
  return { failed, ran };
}

export function runSelfTest() {
  const denyFailed = runCaseTable(DENY_CASES, true);
  const allowFailed = runCaseTable(ALLOW_CASES, false);
  const e2eFailed = runE2E();
  const pragmaFailed = runPragmaInvalid();
  const p9PragmaFailed = runPragmaP9();
  const p9E2E = runE2EP9();
  const failed = denyFailed + allowFailed + e2eFailed + pragmaFailed + p9PragmaFailed + p9E2E.failed;
  const total = DENY_CASES.length + ALLOW_CASES.length + 4 + 2 + 3 + p9E2E.ran;
  console.log(
    failed === 0
      ? `\n金丝雀全绿（deny ${DENY_CASES.length} + allow ${ALLOW_CASES.length} + e2e 4 + pragma 2 + p9-pragma 3 + p9-e2e ${p9E2E.ran}${p9E2E.ran === 0 ? "（git 不可用跳过）" : ""} = ${total} 项）。`
      : `\n${failed} 项失败——门禁失效或误伤，模拟验证未过。`,
  );
  return failed === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  process.exit(runSelfTest() ? 0 : 1);
}
