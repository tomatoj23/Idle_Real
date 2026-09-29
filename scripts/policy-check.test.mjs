// policy-check 金丝雀自测（#82 验收的「人为构造违规样例 → 变红」层，临时 fixture 不改真源码）。
// 运行：node scripts/policy-check.mjs --self-test（或直接跑本文件）。
//
// 「如何变红」（金丝雀巡检用，同 #81 钩子协议）：
//   - DENY 组：改坏/放空对应断言实现 → 该组翻绿（门禁失效信号）。
//   - ALLOW 组：检测面变宽（如改成裸词表）→ 该组翻红（误伤信号，比失效更伤）。
//   - E2E 组：在临时 fixture 树放违规文件跑 runCheck → 必须报错；干净树 → 必须零报。
// 真仓本体的红由 `node scripts/policy-check.mjs` 直接跑（金丝雀只验证门禁实现本身）。
//
// 本文件含真档路径/平台全局的违禁字样作**用例数据**（字符串，非真实落盘），按豁免纪律
// 声明如下（此行同时是豁免机制的活演示）：
// policy-allow: P4 金丝雀用例数据（模拟违禁输入，非真实写盘路径）
// 注意：无理由的 policy-allow 形态（如行尾就断）在本文件里必须拼接构造——字面连续
// 出现会把本文件自己豁免/提示掉，属自误伤。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  // ---- P3 ----
  ["P3-defs-key", P3_FILE, '{"$defs": {}, "definitions": {}}', "P3"],
  // ---- P4 ----
  ["P4-percent-appdata", P4_FILE, "rmSync(String.raw`%APPDATA%\\问道长生\\saves\\x.json`);", "P4"],
  ["P4-escaped-absolute", P4_FILE, "const p = 'C:\\Users\\me\\AppData\\Roaming\\问道长生\\saves\\x.json';", "P4"],
  ["P4-powershell-env", P4_FILE, "run(`del $env:APPDATA\\问道长生\\saves\\x.json`);", "P4"],
  ["P4-process-env-join", P4_FILE, "const p = path.join(process.env.APPDATA, '问道长生');", "P4"],
  ["P4-linux-form", P4_FILE, "const p = '/home/u/.config/问道长生/saves/x.json';", "P4"],
  // ---- P2（review 级，命中=有提示）----
  ["P2-destructure-window", "packages/engine/src/probe.ts", "const { setTimeout } = window;", "P2"],
  ["P2-destructure-console", "packages/engine/src/probe.ts", "const { log } = console;", "P2"],
  ["P2-member-extract", "packages/engine/src/probe.ts", "const si = globalThis.setInterval;", "P2"],
  // ---- P5 / P6（review 级）----
  ["P5-no-date", "docs/research/probe.md", "快照见 D:\\My_Projects\\Reference_Documents\\electron-main", "P5"],
  ["P6-semver", "AGENTS.md", "现役 Electron 38.8.6 暂持", "P6"],
  ["P6-tool-major", "AGENTS.md", "现役 TS 7 = Go 原生编译器", "P6"],
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
    // 违规树：P1/P3/P4 各放一例 + P5/P6 各一例（review 级）
    const bad = {
      "packages/engine/src/bad.ts": "setInterval(flush, 1000);\nlocalStorage.getItem('k');\n",
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
    report(badRules.has("P1") && badRules.has("P3") && badRules.has("P4"), `e2e 违规树 P1/P3/P4 全部报错（实得 ${[...badRules].join(",") || "零"}）`);
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

export function runSelfTest() {
  const denyFailed = runCaseTable(DENY_CASES, true);
  const allowFailed = runCaseTable(ALLOW_CASES, false);
  const e2eFailed = runE2E();
  const pragmaFailed = runPragmaInvalid();
  const failed = denyFailed + allowFailed + e2eFailed + pragmaFailed;
  const total = DENY_CASES.length + ALLOW_CASES.length + 4 + 2;
  console.log(
    failed === 0
      ? `\n金丝雀全绿（deny ${DENY_CASES.length} + allow ${ALLOW_CASES.length} + e2e 4 + pragma 2 = ${total} 项）。`
      : `\n${failed} 项失败——门禁失效或误伤，模拟验证未过。`,
  );
  return failed === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  process.exit(runSelfTest() ? 0 : 1);
}
