#!/usr/bin/env node
// policy 断言脚本（机械门禁层①，票 #82）——工程红线的机器可判定面。
//
// 硬性断言（命中即失败，exit 1）：
//   P1  engine 源码无平台全局直接引用（环境能力走 globalThis 运行时探测，缺失降级）
//   P3  schema/packs 无 `$defs`（JSON Schema draft-07 子集，校验器只认 `#/definitions/`）
//   P4  测试代码无用户真档路径字面量（2026-09-29 删档事故教训；防呆不防恶）
// review 级提示（命中只提示，不阻塞——「命不准转 review，不硬失败」）：
//   P2  从 globalThis/window/console 解构原生方法处有 bind 宿主（弱检测）
//   P5  docs/research 引用 Reference_Documents 快照带取档日期标注
//   P6  AGENTS.md 无时点版本数字（ADR-018：时点事实落调研文档/票）
//
// 接线（显式两处，缺一即门禁空转）：.githooks/pre-push 与 .github/workflows/ci.yml。
//   勿挂根 package.json 的 check——两网跑的是 `npm run check --workspaces --if-present`，
//   走各 workspace 自己的 check、不经根脚本（2026-09-29 复核实证，票 #82 复核更正）。
// 金丝雀自测：node scripts/policy-check.mjs --self-test（临时 fixture，不改真源码）。
//
// 检测原则（票 #82）：宁可漏报不误报——误报诱发豁免，比漏报更伤。
//   P1 识别裸标识符/成员访问的直接引用；排除注释、字符串字面量、属性键、声明名、
//      接口/类型块（基线实证：engine/src 词面命中全是这五类合规形状，裸词表必误报）。
//   P4 只认真档落点族（%APPDATA% 族 / AppData\Roaming 绝对形态等），勿扫裸 `userData`
//      （`userDataDir: tempRoot()` 沙箱注入遍地是）；真档落点经 app.getPath('userData')
//      运行时解析，本断言只防呆，不防蓄意（蓄意面交 review / 钩子 B）。
// 豁免：文件内注释写 `policy-allow: P<n> <理由>`（理由必填，同钩子白名单「加注释放行」
//   纪律）；无理由的豁免行会被忽略并提示。
//
// 运行：node scripts/policy-check.mjs [--root <dir>]（缺省 = 本脚本所在仓库根）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------- 规则表（断言 + 来源 + 正确做法，拒绝/提示文案同钩子规格） ----------

const RULES = {
  P1: {
    level: "error",
    title: "engine 禁平台全局直接引用",
    source: "AGENTS.md 工程红线「engine 源码禁引用平台全局名」；compliance-mechanical-gates.md §2 P1（#82）",
    fix: "环境能力走 globalThis 运行时探测并降级（先例 save.ts platformOf() 的 g['名'] 形态），勿裸引用平台全局名。",
  },
  P3: {
    level: "error",
    title: "schema 禁 $defs",
    source: "AGENTS.md 工具链校准「JSON Schema 为 draft-07 子集」；compliance-mechanical-gates.md §2 P3（#82）",
    fix: "schema 引用一律写 #/definitions/；扩关键字先加 packages/content/src/schema/keywords.ts 矩阵行。",
  },
  P4: {
    level: "error",
    title: "测试禁真档路径字面量",
    source: "2026-09-29 删档事故教训（测试严禁动用户真档）；compliance-mechanical-gates.md §2 P4（#82）",
    fix: "测试用沙箱注入（userDataDir: tempRoot() 先例），只删自己造的测试产物；确需真档字样先备份，并加 `policy-allow: P4 <理由>` 豁免。",
  },
  P2: {
    level: "warn",
    title: "解构原生方法须 bind 宿主（review 级）",
    source: "AGENTS.md 工程红线「凡从 globalThis/window 解构原生方法必须 bind 宿主」；compliance-mechanical-gates.md §2 P2（#82）",
    fix: "解构后存函数值前 .bind(宿主)（先例 save.ts timer.setInterval: (...).bind(g)）；无法判定的交 review。",
  },
  P5: {
    level: "warn",
    title: "快照引用须带取档标注（review 级）",
    source: "compliance.md §2「快照引用三纪律/取档标注」；compliance-mechanical-gates.md §2 P5（#82）",
    fix: "引用 Reference_Documents 快照的文档补取档日期字样（如「2026-09-29 取档」）；标注格式以票模板为准（随 #83 收紧）。",
  },
  P6: {
    level: "warn",
    title: "AGENTS.md 时点版本数字（review 级）",
    source: "ADR-018「只写不随版本腐坏的纪律，时点事实不在 AGENTS.md 复制」；compliance-mechanical-gates.md §2 P6（#82）",
    fix: "版本数字挪到 docs/research/ 或票里；AGENTS.md 只留纪律与指针。命中转 review 确认，不阻塞。",
  },
};

// ---------- P1 词表与上下文分类 ----------

// 平台全局（浏览器专属 + Node 专属 + 定时器族）：直接引用即违反「平台无关 + 缺失降级」。
// 刻意不含：console（双端标准对象，探测面归 P2）、location/history/alert 等短词
//   （与领域词撞名风险高，误报诱发豁免）、fetch/crypto/URL 等双端共有对象。
const P1_BANNED = new Set([
  "localStorage", "sessionStorage", "indexedDB",
  "document", "window", "navigator", "XMLHttpRequest",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "setImmediate", "clearImmediate",
  "process", "Buffer", "__dirname", "__filename", "require",
]);

// 成员访问的对象是这些探测根时，属性名仍算「直接引用」（globalThis.document 形态）；
// 其他对象上的同名成员（timer.setInterval 绑后调用）是合规形状。
const GLOBAL_ROOTS = new Set(["globalThis", "window", "self", "global"]);
const DECL_KEYWORDS = new Set(["const", "let", "var", "function", "class", "import", "export", "declare"]);

// ---------- 词法掩码（识别引用上下文的前置：抹掉注释/字符串内容，保留位置与换行） ----------
// strings: 抹字符串内容（P1 用）；comments: 抹注释（P1/P3/P4 都用——
// 注释里提及不算引用/字面量）；模板字面量的 ${…} 表达式按代码保留。

function maskCode(src, opts = {}) {
  const maskStrings = opts.strings !== false;
  const maskComments = opts.comments !== false;
  const out = src.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      const ch = src[k];
      out[k] = ch === "\n" || ch === "\r" ? ch : " ";
    }
  };
  const n = src.length;
  let i = 0;
  let mode = "code";
  const stack = []; // 模板 ${ 表达式上下文栈
  let depth = 0; // 当前代码上下文的花括号深度
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") {
        const j = src.indexOf("\n", i);
        const end = j === -1 ? n : j;
        if (maskComments) blank(i, end);
        i = end;
        continue;
      }
      if (c === "/" && c2 === "*") {
        const j = src.indexOf("*/", i + 2);
        const end = j === -1 ? n : j + 2;
        if (maskComments) blank(i, end);
        i = end;
        continue;
      }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < n && src[j] !== c) {
          if (src[j] === "\\") j++;
          j++;
        }
        const end = Math.min(j + 1, n);
        if (maskStrings) blank(i + 1, end - 1);
        i = end;
        continue;
      }
      if (c === "`") {
        mode = "tmpl";
        i++;
        continue;
      }
      if (c === "{") depth++;
      if (c === "}") {
        if (depth > 0) depth--;
        else if (stack.length > 0) mode = stack.pop();
      }
      i++;
      continue;
    }
    // mode === "tmpl"
    if (c === "`") {
      mode = "code";
      i++;
      continue;
    }
    if (c === "\\") {
      if (maskStrings) blank(i, Math.min(i + 2, n));
      i += 2;
      continue;
    }
    if (c === "$" && c2 === "{") {
      stack.push("tmpl");
      mode = "code";
      depth = 0;
      i += 2;
      continue;
    }
    if (maskStrings) blank(i, i + 1);
    i++;
  }
  return out.join("");
}

// 行号查询（掩码保长，直接按原文偏移算）
function lineIndexer(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// 接口/类型块跳过区（接口方法签名 setInterval(…) 形如调用，必须整块排除）
function declSkipRanges(masked) {
  const ranges = [];
  const re = /\b(interface|type)\s+([A-Za-z_$][\w$]*)/g;
  for (let m = re.exec(masked); m !== null; m = re.exec(masked)) {
    let j = re.lastIndex;
    let open = -1;
    // 向后找块首 {；遇到 ; 或先到行尾语义终结即放弃（type A = B | C; 无块体）
    while (j < masked.length) {
      const ch = masked[j];
      if (ch === "{") {
        open = j;
        break;
      }
      if (ch === ";") break;
      j++;
    }
    if (open === -1) continue;
    let d = 0;
    let k = open;
    for (; k < masked.length; k++) {
      if (masked[k] === "{") d++;
      else if (masked[k] === "}") {
        d--;
        if (d === 0) break;
      }
    }
    if (d === 0) {
      ranges.push([open, k + 1]);
      re.lastIndex = k + 1;
    }
  }
  return ranges;
}

function inRanges(ranges, pos) {
  return ranges.some(([a, b]) => pos >= a && pos < b);
}

function readIdentBefore(masked, end) {
  let q = end - 1;
  while (q >= 0 && /[\w$]/.test(masked[q])) q--;
  return masked.slice(q + 1, end);
}

function skipWs(masked, from) {
  let i = from;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  return i;
}

// ---------- 各断言（纯函数：(relPath, content) -> [{rule, line, detail}]） ----------

function checkP1(relPath, content) {
  const masked = maskCode(content);
  const skip = declSkipRanges(masked);
  const lineOf = lineIndexer(content);
  const out = [];
  const idRe = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = idRe.exec(masked))) {
    const word = m[0];
    if (!P1_BANNED.has(word)) continue;
    const start = m.index;
    const end = start + word.length;
    if (inRanges(skip, start)) continue;

    let p = start - 1;
    while (p >= 0 && /\s/.test(masked[p])) p--;
    const prevCh = p >= 0 ? masked[p] : "";

    if (prevCh === ".") {
      // 成员访问属性位：对象是探测根（globalThis.document）才算直接引用；
      // 本地对象成员（timer.setInterval 绑后调用）放行
      let q = p - 1;
      while (q >= 0 && /\s/.test(masked[q])) q--;
      const obj = readIdentBefore(masked, q + 1);
      if (!GLOBAL_ROOTS.has(obj)) continue;
      out.push({ rule: "P1", line: lineOf(start), detail: `经 ${obj} 静态成员访问平台全局「${word}」` });
      continue;
    }
    // 声明名（const/function 等后）
    if (prevCh !== "" && DECL_KEYWORDS.has(readIdentBefore(masked, p + 1))) continue;

    let nx = skipWs(masked, end);
    // 简写属性键/绑定名 { W }、, W }
    if ((prevCh === "{" || prevCh === ",") && (masked[nx] === "}" || masked[nx] === ",")) continue;
    // 属性键 / 类型注解名 / 标签：下一显著符是 :（含可选 ?）
    if (masked[nx] === "?") nx = skipWs(masked, nx + 1);
    if (masked[nx] === ":") continue;

    const form = masked[nx] === "(" ? "直接调用" : masked[nx] === "." || masked[nx] === "[" ? "成员访问链" : "裸引用";
    out.push({ rule: "P1", line: lineOf(start), detail: `平台全局「${word}」${form}` });
  }
  return out;
}

function checkP3(relPath, content) {
  // 字符串保留（JSON 的键就是字符串）、注释抹掉（「勿用 $defs」的提醒不该误伤）
  const masked = maskCode(content, { strings: false, comments: true });
  const lineOf = lineIndexer(content);
  const out = [];
  let at = masked.indexOf("$defs");
  while (at !== -1) {
    out.push({ rule: "P3", line: lineOf(at), detail: "schema 出现 $defs（draft-07 子集只认 #/definitions/）" });
    at = masked.indexOf("$defs", at + 1);
  }
  return out;
}

// P4 真档落点族（勿扫裸 userData：沙箱注入 userDataDir: tempRoot() 遍地是）。
// 分隔符用 [\\/]+：JS 源码里路径字符串常写成转义双反斜杠（Roaming\\问道长生），
// 单分隔符正则会漏掉那种形态。
const P4_PATTERNS = [
  [/%APPDATA%/i, "%APPDATA% 写形态"],
  [/\$\{APPDATA\}|\$APPDATA\b/, "$APPDATA 形态"],
  [/\$env:APPDATA/i, "$env:APPDATA 形态"],
  [/process\.env(?:\.\s*APPDATA|\[\s*["']APPDATA["']\s*\])/, "process.env.APPDATA 形态"],
  [/AppData[\\/]+Roaming/i, "真档绝对路径（AppData\\Roaming）"],
  [/[["']AppData["']\s*,\s*["']Roaming["']/, "真档路径 join 数组形态"],
  [/Roaming[\\/]+(?:问道长生|@wendao)/, "真档落点（Roaming\\<游戏目录>）"],
  [/Application[ ]Support[\\/]+(?:问道长生|@wendao)/, "macOS userData 落点"],
  [/(?:^|[\\/])\.config[\\/]+(?:问道长生|@wendao)/, "Linux userData 落点"],
];

function checkP4(relPath, content) {
  const masked = maskCode(content, { strings: false, comments: true });
  const lineOf = lineIndexer(content);
  const out = [];
  for (const [re, label] of P4_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(masked))) {
      out.push({ rule: "P4", line: lineOf(m.index), detail: `测试代码含真档路径字面量：${label}` });
    }
  }
  return out;
}

// P2 弱检测：解构/成员抽取原生方法后必须 bind 宿主（Illegal invocation 教训）。
// 只认 globalThis/window/self/console 的静态解构与成员抽取；探测别名（g['名']）
// 与 bind 后使用（save.ts 先例）不在检测面——弱检测，判不了的交 review。
const P2_NATIVE = new Set([
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame",
  "addEventListener", "removeEventListener", "getComputedStyle", "matchMedia",
  "getItem", "setItem", "removeItem", "key",
  "log", "warn", "error", "info", "debug", "trace",
]);
const P2_SOURCES = "globalThis|window|self|console";

function checkP2(relPath, content) {
  const masked = maskCode(content);
  const lineOf = lineIndexer(content);
  const out = [];
  const stmtTail = (from) => {
    const end = masked.indexOf(";", from);
    const nl = masked.indexOf("\n", from);
    const stop = end === -1 ? nl : nl === -1 ? end : Math.min(end, nl);
    return masked.slice(from, stop === -1 ? masked.length : stop);
  };

  const deRe = new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*(${P2_SOURCES})\\b`, "g");
  let m;
  while ((m = deRe.exec(masked))) {
    const names = m[1].split(",").map((s) => s.split(":")[0].trim()).filter(Boolean);
    const hit = names.find((x) => P2_NATIVE.has(x));
    if (!hit) continue;
    if (stmtTail(m.index + m[0].length).includes(".bind(")) continue;
    out.push({ rule: "P2", line: lineOf(m.index), detail: `从 ${m[2]} 解构原生方法「${hit}」未见 bind 宿主` });
  }

  const memRe = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(${P2_SOURCES})\\.([A-Za-z_$][\\w$]*)`, "g");
  while ((m = memRe.exec(masked))) {
    if (!P2_NATIVE.has(m[3])) continue;
    if (stmtTail(m.index + m[0].length).includes(".bind(")) continue;
    out.push({ rule: "P2", line: lineOf(m.index), detail: `从 ${m[2]}.${m[3]} 抽取原生方法未见 bind 宿主` });
  }
  return out;
}

function checkP5(relPath, content) {
  if (!content.includes("Reference_Documents")) return [];
  if (/\d{4}-\d{2}-\d{2}/.test(content)) return [];
  return [{ rule: "P5", line: 1, detail: "引用 Reference_Documents 快照但未见取档日期标注（20xx-xx-xx）" }];
}

// 顺序敏感：先抽「工具名+版本」并抹掉，再抽三段版本号——防「vite 8.3.0」双报
const P6_PATTERNS = [
  [/\b(?:TS|Electron|Node\.js|vite|vitest|npm|oxlint|happy-dom|pnpm|Capacitor)\s+[vV]?\d[\d.]*/g, "工具名+版本"],
  [/\b\d+\.\d+\.\d+\b/g, "三段版本号"],
];

function checkP6(relPath, content) {
  const lineOf = lineIndexer(content);
  const out = [];
  let work = content;
  for (const [re, label] of P6_PATTERNS) {
    const g = new RegExp(re.source, re.flags);
    let m;
    while ((m = g.exec(work))) {
      out.push({ rule: "P6", line: lineOf(m.index), detail: `AGENTS.md 时点版本数字「${m[0]}」（${label}）` });
      if (label === "工具名+版本") {
        work = work.slice(0, m.index) + " ".repeat(m[0].length) + work.slice(m.index + m[0].length);
      }
    }
  }
  return out;
}

// ---------- 豁免（policy-allow: P<n> <理由>，理由必填） ----------

function allowPragmas(content) {
  const lineOf = lineIndexer(content);
  const ok = new Set();
  const out = [];
  const re = /policy-allow:\s*P([1-6])\b([^\n]*)/g;
  let m;
  while ((m = re.exec(content))) {
    const rule = `P${m[1]}`;
    if (/[\p{L}\p{N}]/u.test(m[2])) ok.add(rule);
    else out.push({ rule, line: lineOf(m.index), detail: `policy-allow 豁免未注明理由（${rule}），已忽略` });
  }
  return { ok, invalid: out };
}

// ---------- 文件收集 ----------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".vite", ".zcode", ".scratch", ".codebuddy", "release", "dist-electron"]);
const CODE_RE = /\.([mc]?[jt]s|tsx|jsx)$/i;

function walkFiles(root, visit) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // fail-open：单个目录读不了跳过（权限/竞态），勿让整个门禁挂掉
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(path.join(dir, e.name));
      } else if (e.isFile()) visit(path.join(dir, e.name));
    }
  }
}

function isTestFile(rel) {
  const t = rel.replace(/\\/g, "/");
  return /(^|\/)(tests?|__tests__)(\/|$)/.test(t) || /\.(test|spec)\.[mc]?[jt]sx?$/.test(t);
}

function underPosix(rel, prefix) {
  return rel.replace(/\\/g, "/").startsWith(prefix);
}

// ---------- 汇总检查 ----------

export function checkFile(relPath, content) {
  const found = [];
  const t = relPath.replace(/\\/g, "/");
  const isCode = CODE_RE.test(t);
  if (isCode && underPosix(t, "packages/engine/src/") && !isTestFile(t)) {
    found.push(...checkP1(relPath, content));
  }
  // P2 的 bind 红线覆盖全部跨端代码（壳层真机同样抛 Illegal invocation）
  if (isCode && underPosix(t, "packages/") && !isTestFile(t)) {
    found.push(...checkP2(relPath, content));
  }
  if (underPosix(t, "packages/content/src/schema/") || underPosix(t, "packages/content/src/packs/")) {
    found.push(...checkP3(relPath, content));
  }
  if (isCode && isTestFile(t)) found.push(...checkP4(relPath, content));
  if (underPosix(t, "docs/research/")) found.push(...checkP5(relPath, content));
  if (path.basename(t) === "AGENTS.md") found.push(...checkP6(relPath, content));

  const { ok, invalid } = allowPragmas(content);
  const violations = found.filter((v) => !ok.has(v.rule));
  return [...violations, ...invalid.map((v) => ({ ...v, level: "warn" }))];
}

export function runCheck(root) {
  const errors = [];
  const warnings = [];
  walkFiles(root, (file) => {
    const rel = path.relative(root, file);
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      return; // fail-open：单个文件读不了跳过（编码/竞态），门禁面大于单文件
    }
    for (const v of checkFile(rel, content)) {
      const level = v.level ?? RULES[v.rule].level;
      (level === "error" ? errors : warnings).push({ ...v, file: rel.replace(/\\/g, "/") });
    }
  });
  const byFile = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
  errors.sort(byFile);
  warnings.sort(byFile);
  return { errors, warnings };
}

// ---------- CLI ----------

function report(root, { errors, warnings }) {
  console.log(`policy-check（#82 机械门禁层①）根目录：${root}`);
  for (const v of errors) {
    console.log(`[ERROR] ${v.rule}  ${v.file}:${v.line}  ${v.detail}`);
    console.log(`        规则来源：${RULES[v.rule].source}`);
    console.log(`        正确做法：${RULES[v.rule].fix}`);
  }
  for (const v of warnings) {
    console.log(`[WARN]  ${v.rule}  ${v.file}:${v.line}  ${v.detail}（review 级，不阻塞）`);
  }
  const bad = new Set(errors.map((v) => v.rule));
  const hardRules = Object.keys(RULES).filter((r) => RULES[r].level === "error");
  console.log(
    `结果：硬性断言 ${hardRules.map((r) => `${r}=${bad.has(r) ? "命中" : "通过"}`).join(" ")} | review 提示 ${warnings.length} 条`,
  );
}

async function main(argv) {
  const selfTest = argv.includes("--self-test");
  if (selfTest) {
    // 子进程跑金丝雀，避免测试↔脚本循环 import（同 #81 钩子先例）
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./policy-check.test.mjs", import.meta.url))],
      { stdio: "inherit" },
    );
    process.exit(r.status ?? 1);
  }
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 && argv[rootIdx + 1]
    ? path.resolve(argv[rootIdx + 1])
    : path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const result = runCheck(root);
  report(root, result);
  process.exit(result.errors.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  await main(process.argv.slice(2));
}
