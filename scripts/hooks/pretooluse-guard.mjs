#!/usr/bin/env node
// 机械门禁·PreToolUse 钩子（#81）——三条事故级/明令级规则：
//   钩子 A：D:\My_Projects\Reference_Documents 只读（用户明令）
//   钩子 B：拦字面指向用户真档（%APPDATA%\问道长生 等 userData 落点）的写/删（2026-09-29 删档事故教训）
//   钩子 C：禁经工具调用的 git push/commit --no-verify（含 commit 短选项 -n）
// 行为规格：docs/agents/compliance-mechanical-gates.md §1；拒绝文案含规则来源与正确做法。
// 运行方式：harness 以 type:"process" 调用，stdin 收 Claude 兼容 JSON 单行（tool_name/tool_input/cwd…）。
//   放行 = exit 0 静默；拒绝 = exit 2 + stderr 拒绝文案（harness 将 stderr 作为 deny 理由回给模型）。
// 自测/金丝雀：node pretooluse-guard.mjs --self-test
//
// 能力边界（如实声明，勿高估）：
//   - 只见工具调用文本，测试进程内部写盘不可见（普遍保证由 #82 P4 + 测试沙箱承担）。
//   - 管道间接目标（如 find … | xargs rm）与计算路径绕过不可见，属蓄意，交 review / CI。
//   - 白名单：确需动真档/参考库的合法操作，在 TARGET_WHITELIST 加注释放行，勿整体关掉。

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------- 受保护根 ----------

// 钩子 A：用户明令只读目录（单机仓库，机器绝对路径可接受）
const REF_ROOTS = [String.raw`D:\My_Projects\Reference_Documents`];

// 钩子 B：用户真档 = Electron userData 运行时落点（package.json productName/name 决定）。
// 打包三形态共用 %APPDATA%\问道长生；旧构建残留 @wendao\app-desktop 一并保护。
const USERDATA_ROOTS = process.env.APPDATA
  ? [
      path.join(process.env.APPDATA, "问道长生"),
      path.join(process.env.APPDATA, "@wendao", "app-desktop"),
    ]
  : [];

// 误伤豁免白名单：绝对路径（归一化后前缀匹配），加注释说明理由再放行
const TARGET_WHITELIST = [
  // 例：String.raw`D:\My_Projects\Reference_Documents\_incoming`（2026-XX-XX 用户明令可写）
];

// ---------- 拒绝文案（含规则来源与正确做法） ----------

const RULE_META = {
  A: {
    title: "钩子 A｜Reference_Documents 只读",
    source:
      "用户明令「该目录严禁改动，只许读」；docs/agents/compliance-mechanical-gates.md §1 钩子 A（票 #81）",
    fix: "对该目录只做读操作（ls/grep/cat/head/find 等）；如需修改其中内容，先复制到工作区内再改。",
  },
  B: {
    title: "钩子 B｜用户真档保护",
    source:
      "2026-09-29 删档事故教训（测试严禁动用户真档）；docs/agents/compliance-mechanical-gates.md §1 钩子 B（票 #81）",
    fix: "测试用沙箱（userDataDir: tempRoot() 先例），只删自己造的测试产物；确需动真档先备份，并在钩子白名单加注释放行。",
  },
  C: {
    title: "钩子 C｜禁 --no-verify",
    source:
      "AGENTS.md「Git 钩子（交付门禁）」禁 --no-verify 绕过；docs/agents/compliance-mechanical-gates.md §1 钩子 C（票 #81）",
    fix: "正常 push/commit 走 pre-push 全量 check+test，修复失败项后再推，勿绕过钩子。",
  },
};

export function formatDeny(violations) {
  const lines = violations.map((v) => {
    const meta = RULE_META[v.rule];
    return `【合规门禁·${meta.title}】已拒绝本次工具调用。\n- 违规：${v.detail}\n- 规则来源：${meta.source}\n- 正确做法：${meta.fix}`;
  });
  return `合规门禁拦截（机械门禁层①，与模型服从无关）。\n${lines.join("\n")}`;
}

// ---------- 路径工具 ----------

function expandEnv(text) {
  return text
    .replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m)
    .replace(/\$\{([^}]+)\}/g, (m, name) => process.env[name] ?? m)
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (m, name) => process.env[name] ?? m) // PowerShell 形态
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => process.env[name] ?? m)
    .replace(/^~(?=[\\/]|$)/, os.homedir());
}

// 归一为可比较的路径键：统一反斜杠、去尾分隔、小写（Windows 大小写不敏感）
function normalizePathKey(p) {
  return p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function resolveTarget(cwd, token) {
  let expanded = expandEnv(token);
  // Git Bash 风格 POSIX 绝对路径 /c/Users/… → C:\Users\…
  expanded = expanded.replace(/^\/([a-zA-Z])(?=\/)/, "$1:");
  const abs = path.win32.isAbsolute(expanded.replace(/\//g, "\\"))
    ? expanded.replace(/\//g, "\\")
    : path.win32.resolve(cwd, expanded);
  return normalizePathKey(abs);
}

function isUnder(p, root) {
  const n = normalizePathKey(root);
  return p === n || p.startsWith(n + "\\");
}

function isProtected(p) {
  if (TARGET_WHITELIST.some((w) => isUnder(p, w))) return false;
  return (
    REF_ROOTS.some((r) => isUnder(p, r)) || USERDATA_ROOTS.some((r) => isUnder(p, r))
  );
}

function ruleFor(p) {
  if (REF_ROOTS.some((r) => isUnder(p, r))) return "A";
  if (USERDATA_ROOTS.some((r) => isUnder(p, r))) return "B";
  return null;
}

// 强字面量（仅供包装层文本匹配用；散文提及弱字面量不算路径）
const REF_STRONG_RE = /[a-z]:[\\/]my_projects[\\/]reference_documents|my_projects[\\/]reference_documents|(?:^|[\s"'`=(;|&])\.\.[\\/]reference_documents/i;
const USERDATA_STRONG_RE = new RegExp(
  [
    "(?:%appdata%|\\$\\{?appdata\\}?|\\$env:appdata|appdata[\\\\/]roaming|[\\\\/]roaming[\\\\/])",
    "(?:[\\\\/]+roaming[\\\\/]+)?[\\\\/]*(?:问道长生|@wendao[\\\\/]app-desktop)",
  ].join(""),
  "i",
);

function strongLiteralHit(text) {
  return REF_STRONG_RE.test(text) || USERDATA_STRONG_RE.test(text);
}

// ---------- shell 文本分析 ----------

// 引号感知地按 shell 操作符切段（&& || ; | & 换行）。
// 反斜杠按字面处理（Windows 路径分隔符优先于 POSIX 转义语义）。
function splitSegments(cmd) {
  const segs = [];
  let buf = "";
  let quote = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === ";" || ch === "|" || ch === "&") {
      if (buf.trim()) segs.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) segs.push(buf.trim());
  return segs;
}

// 引号感知分词；> / >> 抽出为 REDIRECT 记号；保留 quoted 标记（选项判定用）
function tokenize(seg) {
  const tokens = [];
  let buf = "";
  let quoted = false;
  let quote = null;
  const push = (value, wasQuoted, kind = "word") => {
    if (value !== "" || kind !== "word") tokens.push({ value, quoted: wasQuoted, kind });
  };
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        quoted = true;
      } else buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ">") {
      // 数字 fd 前缀（2>）折叠进重定向记号
      if (/^\d+$/.test(buf)) buf = "";
      push(buf, quoted);
      buf = "";
      quoted = false;
      if (seg[i + 1] === ">") i++;
      if (seg[i + 1] === "&") {
        // >&1 / &>: fd 复制或合并，不是文件目标
        push("", false, "redirectFd");
        i++;
        while (i + 1 < seg.length && /[\d>&]/.test(seg[i + 1])) i++;
      } else {
        push("", false, "redirect");
      }
      continue;
    }
    if (/\s/.test(ch)) {
      push(buf, quoted);
      buf = "";
      quoted = false;
      continue;
    }
    buf += ch;
  }
  push(buf, quoted);
  return tokens;
}

const READ_VERBS = new Set([
  "ls", "grep", "egrep", "fgrep", "rg", "ag", "cat", "head", "tail", "stat",
  "wc", "file", "du", "df", "tree", "less", "more", "diff", "cmp", "pwd",
  "echo", "printf", "date", "env", "printenv", "whoami", "uname", "hostname",
  "id", "which", "where", "type", "realpath", "readlink", "basename", "dirname",
  "sort", "uniq", "cut", "tr", "awk", "strings", "xxd", "od", "hexdump",
  "md5sum", "sha256sum", "shasum", "jq", "yq", "ps", "tasklist", "cygpath",
  // 测试/比较构词（只 stat，无写面）——2026-09-29 活体验收实测误伤后补
  "test", "[", "]", "[[", "]]",
]);
// 控制流/包装前缀：剥掉后对真实动词复判（`if rm -rf X` 不得因 if 而漏判）
const CONTROL_PREFIXES = new Set([
  "if", "elif", "while", "until", "do", "then", "else", "!",
  "command", "builtin", "exec", "nohup", "time",
]);
const CD_VERBS = new Set(["cd", "chdir", "pushd"]);
// 参数全部视为写目标
const WRITE_ALL_VERBS = new Set([
  "rm", "del", "erase", "rmdir", "rd", "touch", "mkdir", "md", "tee",
  "install", "chmod", "chown", "chgrp", "ln", "truncate", "shred", "dd",
  "patch", "rename", "ren", "dos2unix", "unix2dos",
]);
// 仅末参数为写目标（复制进入）
const WRITE_DEST_LAST_VERBS = new Set(["cp", "copy", "xcopy", "robocopy", "scp", "rsync"]);
// 移动：源（移除）与目标都算写效应
const WRITE_MOVING_VERBS = new Set(["mv", "move"]);
// 解包/解压：落盘目标 = 隐式 cwd（参数是源，只读）
const WRITE_EXTRACT_VERBS = new Set(["tar", "unzip", "gunzip", "unzstd", "unar"]);
// 落盘工具：隐式 cwd + 全部非选项参数 + 包装文本检查
const WRITE_FULL_VERBS = new Set([
  "npm", "npx", "pnpm", "yarn", "bun", "node", "deno", "python", "python3", "py",
  "perl", "ruby", "php", "java", "javac", "tsc", "electron", "vite", "esbuild",
  "gh", "curl", "wget", "ffmpeg", "magick", "pandoc", "asar",
  "powershell", "pwsh", "cmd",
]);
// shell 包装：-c 的参数按命令文本递归分析
const SHELL_WRAPPER_VERBS = new Set(["bash", "sh", "zsh", "dash"]);
// 包装代码层的写信号（与强字面量同时出现才拒，防散文误伤）
const WRITE_SIGNAL_RE =
  /writeFile|appendFile|unlink|rmSync|rmdir|createWriteStream|copyFile|rename|shutil|os\.remove|os\.rmdir|remove-item|out-file|set-content|add-content|clear-content|new-item|move-item|copy-item|remove-itemproperty|\bdel\b|\berase\b|\brd\b|>\s*\S/i;

const FIND_WRITE_FLAGS = /(^|\s)(-delete|-exec|-execdir|-ok|-okdir|-fprint0?|-fprintf|-fls)(\s|$)/;

function isFlag(tok) {
  return tok.kind === "word" && !tok.quoted && /^-{1,2}\S/.test(tok.value);
}

// git 子命令：读类放行，写类按落盘工具对待
const GIT_READ_SUBS = new Set([
  "status", "log", "diff", "show", "ls-files", "ls-tree", "cat-file", "rev-parse",
  "grep", "describe", "blame", "shortlog", "show-ref", "branch", "remote", "stash",
  "config", "help", "version", "var", "count-objects", "cherry", "annotate",
]);

function analyzeGit(tokens, cwd, out) {
  // 跳过全局选项（带值的取值一起跳过），首个非选项词 = 子命令
  const GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--exec-path", "--namespace", "--config-env", "--super-prefix"]);
  // 子命令级带值选项：紧随其后的词是选项值（如 -m "-n" 里的 -n 是消息文本，不是短选项）
  const SUB_WITH_VALUE = new Set([
    "-m", "--message", "-F", "--file", "-t", "--template", "-c", "-C",
    "--fixup", "--squash", "--author", "--date", "--cleanup", "--trailer",
    "--pathspec-from-file", "--fixup-amend",
  ]);
  let sub = null;
  let skipNext = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (sub === null) {
      if (isFlag(t)) {
        if (GLOBAL_WITH_VALUE.has(t.value)) i++; // 值一并跳过
        continue;
      }
      sub = t.value.toLowerCase();
      continue;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    // 带值选项（含 -am 这类捆绑进 m 的形态）：值一并跳过
    if (!t.quoted && (SUB_WITH_VALUE.has(t.value) || /^-[a-zA-Z]*m[a-zA-Z]*$/.test(t.value))) {
      skipNext = true;
      continue;
    }
    // 独立位置的 --no-verify / -n（含引号包裹形态：git 同样视其为选项）
    if (sub === "commit" && /^-[a-zA-Z]*n[a-zA-Z]*$/.test(t.value)) {
      out.push({ rule: "C", detail: `git commit 短选项 ${t.value} 等价 --no-verify` });
    }
    if ((sub === "commit" || sub === "push") && t.value === "--no-verify") {
      out.push({ rule: "C", detail: `git ${sub} 带 --no-verify` });
    }
  }
  if (sub === null || GIT_READ_SUBS.has(sub)) return; // 读子命令放行
  // 写子命令：-C/--git-dir 等上下文路径 + 非选项参数都是写目标
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!isFlag(t) && t.value !== "") {
      const p = resolveTarget(cwd, t.value);
      if (isProtected(p)) {
        out.push({ rule: ruleFor(p), detail: `git ${sub} 命中受保护路径 ${t.value}` });
      }
    }
    if (GLOBAL_WITH_VALUE.has(t.value) && tokens[i + 1]) {
      const p = resolveTarget(cwd, tokens[i + 1].value);
      if (isProtected(p)) {
        out.push({ rule: ruleFor(p), detail: `git ${sub} 以 ${t.value} 指向受保护路径 ${tokens[i + 1].value}` });
      }
    }
  }
}

// 动词下标 = 跳过环境赋值与控制流/包装前缀后的首个词
function firstVerbIndex(words) {
  let vi = 0;
  while (
    vi < words.length &&
    ((/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[vi].value) && !words[vi].quoted) ||
      CONTROL_PREFIXES.has(words[vi].value.toLowerCase()))
  ) {
    vi++;
  }
  return vi;
}

function analyzeSegment(seg, cwd, out) {
  const tokens = tokenize(seg);
  const words = tokens.filter((t) => t.kind === "word" && t.value !== "");

  // 重定向目标一律按写目标判定（覆盖 echo/cat 等读命令的落盘面）
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === "redirect" && tokens[i + 1]) {
      const p = resolveTarget(cwd, tokens[i + 1].value);
      if (isProtected(p)) {
        out.push({ rule: ruleFor(p), detail: `重定向写入受保护路径 ${tokens[i + 1].value}` });
      }
      i++;
    }
  }

  const vi = firstVerbIndex(words);
  const verbTok = words[vi];
  if (!verbTok) return;
  const verb = path.win32.basename(verbTok.value).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
  const args = words.slice(vi + 1).filter((t) => !isFlag(t) && t.value !== "");

  const checkArg = (tok, why) => {
    const p = resolveTarget(cwd, tok.value);
    if (isProtected(p)) out.push({ rule: ruleFor(p), detail: `${why}命中受保护路径 ${tok.value}` });
  };

  if (CD_VERBS.has(verb)) return; // 只改跟踪 cwd，由调用方处理
  if (verb === "popd") return;

  if (verb === "find") {
    if (FIND_WRITE_FLAGS.test(seg)) for (const a of args) checkArg(a, "find 写效应");
    return;
  }
  if (verb === "sed") {
    const inPlace = words.slice(vi + 1).some((t) => !t.quoted && /^-{1,2}i/.test(t.value));
    if (inPlace) for (const a of args) checkArg(a, "sed -i 原地写");
    return;
  }
  if (READ_VERBS.has(verb)) return; // 纯读放行（重定向面已单独判定）

  if (verb === "git") {
    analyzeGit(words.slice(vi), cwd, out);
    return;
  }
  if (SHELL_WRAPPER_VERBS.has(verb)) {
    // bash -c "命令文本" → 递归按命令分析；否则按落盘工具的隐式 cwd 判定
    const cIdx = words.findIndex((t, i) => i > vi && !t.quoted && t.value === "-c");
    if (cIdx >= 0 && words[cIdx + 1]) {
      analyzeCommand(words[cIdx + 1].value, cwd, out);
      return;
    }
    const p = resolveTarget(cwd, ".");
    if (isProtected(p)) out.push({ rule: ruleFor(p), detail: `${verb} 在受保护目录内执行` });
    return;
  }

  // 其余动词：先判隐式 cwd（落盘工具在其内执行），再按参数语义判写目标
  const cwdTarget = resolveTarget(cwd, ".");
  if (isProtected(cwdTarget)) {
    out.push({ rule: ruleFor(cwdTarget), detail: `${verb} 在受保护目录内执行（落盘效应）` });
  }

  if (WRITE_ALL_VERBS.has(verb)) {
    for (const a of args) checkArg(a, `${verb} 删除/写入`);
    return;
  }
  if (WRITE_DEST_LAST_VERBS.has(verb)) {
    if (args.length > 0) checkArg(args[args.length - 1], `${verb} 复制进入`);
    return;
  }
  if (WRITE_MOVING_VERBS.has(verb)) {
    for (const a of args) checkArg(a, `${verb} 移动`);
    return;
  }
  if (WRITE_EXTRACT_VERBS.has(verb)) return; // 参数是源（只读），隐式 cwd 已判

  // WRITE_FULL_VERBS 与未知动词（保守：非白名单读命令之外都不放行写面）
  for (const a of args) checkArg(a, `${verb} 落盘`);
  if (WRITE_FULL_VERBS.has(verb) && strongLiteralHit(seg) && WRITE_SIGNAL_RE.test(seg)) {
    out.push({ rule: REF_STRONG_RE.test(seg) ? "A" : "B", detail: `${verb} 包装内含写效应文本且指向受保护路径` });
  }
  // 包装层 --no-verify 兜底（powershell/cmd/node 等非递归包装内的 git 绕过形态）
  if (WRITE_FULL_VERBS.has(verb) && /--no-verify/.test(seg) && /\bgit\b/i.test(seg) && /\b(push|commit)\b/i.test(seg)) {
    out.push({ rule: "C", detail: `${verb} 包装内含 git push/commit --no-verify` });
  }
}

function analyzeCommand(cmd, cwd, out) {
  for (const seg of splitSegments(cmd)) {
    const tokens = tokenize(seg);
    // cd 跟踪：段内 cd <path> 更新后续段的解析基准
    const words = tokens.filter((t) => t.kind === "word" && t.value !== "");
    analyzeSegment(seg, cwd, out);
    const vi = firstVerbIndex(words);
    const verb = words[vi] ? path.win32.basename(words[vi].value).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "") : "";
    if (CD_VERBS.has(verb) && words[vi + 1]) {
      cwd = resolveTarget(cwd, words[vi + 1].value);
    }
  }
}

// ---------- 工具分派 ----------

function checkPathFields(toolInput, cwd, out) {
  for (const key of ["file_path", "path", "notebook_path", "filePath", "target"]) {
    const v = toolInput?.[key];
    if (typeof v !== "string" || v === "") continue;
    const p = resolveTarget(cwd, v);
    if (isProtected(p)) {
      out.push({ rule: ruleFor(p), detail: `写目标路径位于受保护目录下：${v}` });
    }
  }
}

export function classify({ toolName, toolInput, cwd }) {
  const out = [];
  const base = cwd || process.cwd();
  const name = String(toolName ?? "");

  if (name === "Write" || name === "Edit") {
    checkPathFields(toolInput, base, out);
    return out;
  }
  if (name === "ApplyPatch") {
    checkPathFields(toolInput, base, out);
    const text = typeof toolInput?.patch === "string" ? toolInput.patch : JSON.stringify(toolInput ?? {});
    for (const m of text.matchAll(/\*\*\*\s+\w+\s+File:\s*(.+)/g)) {
      const p = resolveTarget(base, m[1].trim());
      if (isProtected(p)) out.push({ rule: ruleFor(p), detail: `补丁写目标位于受保护目录下：${m[1].trim()}` });
    }
    return out;
  }
  if (name === "Bash") {
    const cmd = typeof toolInput?.command === "string" ? toolInput.command : "";
    if (cmd) analyzeCommand(cmd, base, out);
    return out;
  }
  return out; // 其余工具（Read/Grep/Agent 等）不在拦截面
}

// ---------- harness 入口 ----------

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

export async function main() {
  if (process.argv.includes("--self-test")) {
    // 子进程方式跑金丝雀，避免测试↔守卫循环 import
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./pretooluse-guard.test.mjs", import.meta.url))],
      { stdio: "inherit" },
    );
    process.exit(r.status ?? 1);
  }
  let raw;
  try {
    raw = await readStdin();
  } catch {
    return;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // 输入不可解析属 harness 异常，不拦（fail-open，模型无法影响该输入格式）
  }
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  const violations = classify({
    toolName: input.tool_name ?? input.toolName,
    toolInput: input.tool_input ?? input.toolInput,
    cwd: input.cwd,
  });
  if (violations.length > 0) {
    process.stderr.write(formatDeny(violations) + "\n");
    process.exit(2);
  }
}

// 直接执行（非 import）时跑入口；Windows 路径大小写不敏感
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  await main();
}
