#!/usr/bin/env node
// 机械门禁·PreToolUse 钩子（#81 立，#85 对抗审计收口加固）——三条事故级/明令级规则：
//   钩子 A：D:\My_Projects\Reference_Documents 只读（用户明令）
//   钩子 B：拦字面指向用户真档（%APPDATA%\问道长生 等 userData 落点）的写/删（2026-09-29 删档事故教训）
//   钩子 C：禁经工具调用的 git push/commit --no-verify（含短选项簇 -n、长选项前缀缩写、hooksPath/alias 配置旁路）
// 行为规格：docs/agents/compliance-mechanical-gates.md §1；拒绝文案含规则来源与正确做法。
// 运行方式：harness 以 type:"process" 调用，stdin 收 Claude 兼容 JSON 单行（tool_name/tool_input/cwd…）。
//   放行 = exit 0 静默；拒绝 = exit 2 + stderr 拒绝文案（harness 将 stderr 作为 deny 理由回给模型）。
//   fail-closed：classify 运行时异常一律 exit 2 保守拒；仅 stdin 读失败/JSON 不可解析放行（harness 异常，模型无法影响）。
// 自测/金丝雀：node pretooluse-guard.mjs --self-test
//
// 能力边界（如实声明，勿高估）：
//   - 只见工具调用文本，测试进程内部写盘不可见（普遍保证由 #82 P4 + 测试沙箱承担）。
//   - 管道间接目标（如 find … | xargs rm）与计算路径绕过不可见，属蓄意，交 review / CI。
//   - 编码类绕过（powershell -EncodedCommand 等 base64 载荷）归计算路径豁免，文本面看不见。
//   - 8.3 短名（MY_PROJ~1\REFERE~1）需文件系统查询才能归一，同归豁免面。
//   - 白名单：确需动真档/参考库的合法操作，在 TARGET_WHITELIST 加注释放行，勿整体关掉。

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------- 受保护根 ----------

// 钩子 A：用户明令只读目录（单机仓库，机器绝对路径可接受）
const REF_ROOTS = [String.raw`D:\My_Projects\Reference_Documents`];

// 钩子 B：用户真档 = Electron userData 运行时落点（package.json productName/name 决定）。
// 打包三形态共用 %APPDATA%\问道长生；旧构建残留 @wendao\app-desktop 一并保护。
// 动态解析（勿模块级缓存）：APPDATA 缺失时走限定范围 fail-loud（裁决 3），测试需能切换环境。
function userDataRoots() {
  return process.env.APPDATA
    ? [
        path.join(process.env.APPDATA, "问道长生"),
        path.join(process.env.APPDATA, "@wendao", "app-desktop"),
      ]
    : [];
}

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
  const lookup = (name) => {
    const key = name.replace(/^env:/i, ""); // PowerShell 花括号形态 ${env:VAR}
    return process.env[key] ?? process.env[key.toUpperCase()] ?? null;
  };
  return text
    .replace(/%([^%]+)%/g, (m, name) => lookup(name) ?? m)
    .replace(/\$\{([^}]+)\}/g, (m, name) => lookup(name) ?? m)
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (m, name) => lookup(name) ?? m) // PowerShell 形态
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => lookup(name) ?? m)
    .replace(/^~(?=[\\/]|$)/, os.homedir());
}

// 归一为可比较的路径键：统一反斜杠、剥 Win32 尾点/尾空格、去尾分隔、小写（Windows 大小写不敏感）。
// 尾点/尾空格按 Win32 语义逐段剥（`rmdir "<REF>."` 真删实证，#85 M5）；`.`/`..`/空段原样保留。
function normalizePathKey(p) {
  const slashed = p.replace(/\//g, "\\").replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/i, "");
  const parts = slashed.split("\\").map((seg) => {
    if (seg === "" || seg === "." || seg === "..") return seg;
    const stripped = seg.replace(/[. ]+$/, "");
    return stripped === "" ? seg : stripped;
  });
  return parts.join("\\").replace(/\\+$/, "").toLowerCase();
}

function resolveTarget(cwd, token) {
  let expanded = expandEnv(token);
  // Git Bash 风格 POSIX 绝对路径 /c/Users/… → C:\Users\…
  expanded = expanded.replace(/^\/([a-zA-Z])(?=\/)/, "$1:");
  expanded = expanded.replace(/\//g, "\\");
  const abs = path.win32.isAbsolute(expanded) ? expanded : path.win32.resolve(cwd, expanded);
  return normalizePathKey(abs);
}

function isUnder(p, root) {
  const n = normalizePathKey(root);
  return p === n || p.startsWith(n + "\\");
}

function isProtected(p) {
  if (TARGET_WHITELIST.some((w) => isUnder(p, w))) return false;
  return (
    REF_ROOTS.some((r) => isUnder(p, r)) || userDataRoots().some((r) => isUnder(p, r))
  );
}

function ruleFor(p) {
  if (REF_ROOTS.some((r) => isUnder(p, r))) return "A";
  if (userDataRoots().some((r) => isUnder(p, r))) return "B";
  return null;
}

// 强字面量（仅供包装层文本匹配用；散文提及弱字面量不算路径）。
// 分隔符取 [\\/]+：JS 源码转义的双反斜杠形态（'D:\\My_Projects\\…'）不得漏（#85 活体模拟实测）
const REF_STRONG_RE = /[a-z]:[\\/]+my_projects[\\/]+reference_documents|my_projects[\\/]+reference_documents|(?:^|[\s"'`=(;|&])\.\.[\\/]+reference_documents/i;
const USERDATA_STRONG_RE = new RegExp(
  [
    "(?:%appdata%|\\$\\{?(?:env:)?appdata\\}?|\\$env:appdata|appdata[\\\\/]+roaming|[\\\\/]roaming[\\\\/])",
    "(?:[\\\\/]+roaming[\\\\/]+)?[\\\\/]*(?:问道长生|@wendao[\\\\/]app-desktop)",
  ].join(""),
  "i",
);

function strongLiteralHit(text) {
  return REF_STRONG_RE.test(text) || USERDATA_STRONG_RE.test(text);
}

// APPDATA 缺失 → 限定范围 fail-loud（裁决 3）：写效应调用文本命中真档强字面量即保守拒。
// 强正则不依赖环境变量，环境故障时真档落点无法解析，按最严处置。
function failLoudUserdata(text, out, where) {
  if (userDataRoots().length > 0) return;
  if (!text || !USERDATA_STRONG_RE.test(text)) return;
  out.push({
    rule: "B",
    detail: `环境故障：APPDATA 不可解析，按最严处置——${where}命中真档强字面量，保守拒`,
  });
}

// ---------- shell 文本分析 ----------

// 引号感知地按 shell 操作符切段（&& || ; | & 换行）。
// 反斜杠按字面处理（Windows 路径分隔符优先于 POSIX 转义语义），唯一例外：
// 行尾 `\`+换行 = bash 续行（同一条命令），拼回同段（#85 H1，`rm -rf \` 换行 目标必拒）。
function splitSegments(cmd) {
  const segs = [];
  let buf = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) quote = null;
      if (ch === "\\" && quote !== "'" && (cmd[i + 1] === "\n" || cmd[i + 1] === "\r")) {
        i++; // 双引号内续行同样拼接
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "\\" && (cmd[i + 1] === "\n" || cmd[i + 1] === "\r")) {
      i++;
      if (cmd[i] === "\r" && cmd[i + 1] === "\n") i++;
      continue;
    }
    if (
      ch === "\n" ||
      ch === "\r" ||
      ch === ";" ||
      (ch === "|" && !buf.endsWith(">")) || // >| 强制重定向不是管道（#85 N12）
      (ch === "&" && !buf.endsWith(">")) // >& fd 复制不是后台并联
    ) {
      if (buf.trim()) segs.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) segs.push(buf.trim());
  return segs;
}

// 引号感知分词；> / >> / >| 抽出为 REDIRECT 记号；保留 quoted 标记（选项判定用）
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
      if (seg[i + 1] === "|") i++; // >| 强制覆盖仍是重定向（勿被 | 切段拆散，#85 N12）
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
  "echo", "printf", "date", "printenv", "whoami", "uname", "hostname",
  "id", "which", "where", "type", "realpath", "readlink", "basename", "dirname",
  "sort", "uniq", "cut", "tr", "awk", "strings", "xxd", "od", "hexdump",
  "md5sum", "sha256sum", "shasum", "jq", "yq", "ps", "tasklist", "cygpath",
  // 测试/比较构词（只 stat，无写面）——2026-09-29 活体验收实测误伤后补
  "test", "[", "]", "[[", "]]",
]);
// 控制流/包装前缀：剥掉后对真实动词复判（`if rm -rf X` 不得因 if 而漏判）。
// env 属包装前缀（#85 M4）：`env rm -rf X` 是执行 rm，不是读环境（独词 env 打印环境=无写面，自然放行）。
const CONTROL_PREFIXES = new Set([
  "if", "elif", "while", "until", "do", "then", "else", "!",
  "command", "builtin", "exec", "nohup", "time", "env",
]);
const CD_VERBS = new Set(["cd", "chdir", "pushd"]);
// 循环头动词：`for f in …` 的词表是展开数据不是写目标（体在后续段另行判定，#85 M11）
const LOOP_HEAD_VERBS = new Set(["for", "select"]);
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
// 解包/解压：落盘目标 = 隐式 cwd + -d/-C/--directory 显式目录（#85 H5）
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
// 包装代码层的写信号（与强字面量同时出现才拒，防散文误伤）。
// python open(...,'w'/'a'/'x'/+) 与 write( 补入（#85 M1：node -e writeFile 拦、python open 漏）
const WRITE_SIGNAL_RE =
  /writeFile|appendFile|unlink|rmSync|rmdir|createWriteStream|copyFile|rename|shutil|os\.remove|os\.rmdir|remove-item|out-file|set-content|add-content|clear-content|new-item|move-item|copy-item|remove-itemproperty|\bdel\b|\berase\b|\brd\b|>\s*\S|\bopen\s*\([^)]*['"][rwabx+]*[wax+][rwabx+]*['"]|\bwrite\s*\(/i;

const FIND_WRITE_FLAGS = /(^|\s)(-delete|-exec|-execdir|-ok|-okdir|-fprint0?|-fprintf|-fls)(\s|$)/;

// 选项判定：-/-- 开头的词，或 Windows 开关（/E /I /Y /MT:8 等单段形态）。
// Windows 开关不吞多段路径：/d/My_Projects/… 是 POSIX 路径不是开关（#85 H4 反误伤）。
function isFlag(tok) {
  if (tok.kind !== "word" || tok.quoted) return false;
  if (/^-{1,2}\S/.test(tok.value)) return true;
  return /^\/[A-Za-z0-9?][A-Za-z0-9:.=+,@^-]*$/.test(tok.value);
}

// git 子命令：读类放行，写类按落盘工具对待
const GIT_READ_SUBS = new Set([
  "status", "log", "diff", "show", "ls-files", "ls-tree", "cat-file", "rev-parse",
  "grep", "describe", "blame", "shortlog", "show-ref", "branch", "remote", "stash",
  "config", "help", "version", "var", "count-objects", "cherry", "annotate",
]);

// git 短选项簇里带值的选项字母：其后簇内字符/下一词是选项值（`-mn x` 的 n 是 m 的值，不是 -n，#85 H6）
const GIT_CLUSTER_VALUE_CHARS = new Set(["m", "F", "t", "c", "C"]);
// git 配置旁路关键词（覆写钩子路径或 alias = 等效 --no-verify，#85 H3）
const GIT_HOOK_CONFIG_KEY_RE = /^core\.hooksPath\b|^alias\./i;

function analyzeGit(tokens, cwd, out) {
  // 跳过全局选项（带值的取值一起跳过），首个非选项词 = 子命令
  const GLOBAL_WITH_VALUE = new Set(["-C", "--git-dir", "--work-tree", "--exec-path", "--namespace", "--config-env", "--super-prefix"]);
  // 子命令级带值选项：紧随其后的词是选项值（如 -m "-n" 里的 -n 是消息文本，不是短选项）。
  // 值不是写目标（#85 M11：`git commit -m "<受保护路径>"`、`-F <只读消息文件>` 不得误伤）
  const SUB_WITH_VALUE = new Set([
    "-m", "--message", "-F", "--file", "-t", "--template", "-c", "-C",
    "--fixup", "--squash", "--author", "--date", "--cleanup", "--trailer",
    "--pathspec-from-file", "--fixup-amend",
  ]);

  let sub = null;
  let phase = "global"; // 子命令前 = global（-c/-C 是 git 级配置/上下文），之后 = sub
  let afterDoubleDash = false;
  let skipValueTo = null; // "context" | "config" | "plain"
  const positionals = [];
  const contextPaths = [];
  const pendingC = [];

  const emitConfigValue = (val) => {
    if (/^core\.hooksPath\s*=/i.test(val)) {
      pendingC.push({ kind: "anySub", detail: `git 配置覆写 core.hooksPath=${val.slice(val.indexOf("=") + 1)}（含 NUL/不存在目录等效），禁经配置旁路关钩子` });
      return;
    }
    const am = val.match(/^alias\.[^=]*=(.*)$/is);
    if (am) {
      const body = am[1].trim();
      // alias 体 = 命令文本，按命令语义复判（alias.p='push --no-verify' 必拒）
      if (body.startsWith("!")) analyzeCommand(body.slice(1), cwd, out);
      else analyzeGit(["git", ...tokenize(body)], cwd, out);
    }
  };

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (skipValueTo) {
      if (skipValueTo === "context") contextPaths.push(t.value);
      else if (skipValueTo === "config") emitConfigValue(t.value);
      skipValueTo = null;
      continue;
    }
    if (afterDoubleDash) {
      positionals.push(t.value); // `--` 后是 pathspec/位置词，不是选项（#85 M11）
      continue;
    }
    const v = t.value;
    if (v === "") continue;
    if (v === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (/^--/.test(v)) {
      const eq = v.indexOf("=");
      const base = eq >= 0 ? v.slice(0, eq) : v;
      const inlineVal = eq >= 0 ? v.slice(eq + 1) : null;
      // --no-verify 及唯一前缀缩写（--no-veri 等实证打穿 pre-push）：按前缀判、宁多拒（#85 H2）
      if (/^--no-v/i.test(v)) {
        pendingC.push({ kind: "long", detail: `git 长选项 ${v} 命中 --no-verify（或其前缀缩写形态）` });
        continue;
      }
      if (GLOBAL_WITH_VALUE.has(base)) {
        if (base === "-c" || base === "--config-env") {
          if (inlineVal !== null) emitConfigValue(inlineVal);
          else skipValueTo = "config";
        } else {
          if (inlineVal !== null) contextPaths.push(inlineVal);
          else skipValueTo = "context";
        }
        continue;
      }
      if (SUB_WITH_VALUE.has(base)) {
        if (inlineVal === null) skipValueTo = "plain";
        continue;
      }
      continue;
    }

    if (v !== "-" && /^-/.test(v)) {
      // 短选项簇（#85 H6）：逐字符走，n=--no-verify（仅 commit）；带值字母吃掉其后全部（值里的 n 不算）
      const chars = v.slice(1);
      for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci];
        if (GIT_CLUSTER_VALUE_CHARS.has(ch)) {
          const rest = chars.slice(ci + 1);
          if (phase === "global" && ch === "c") {
            if (rest) emitConfigValue(rest);
            else skipValueTo = "config";
          } else if (phase === "global" && ch === "C") {
            // git -C <path>：切目录，上下文路径是写目标（`git -C <REF> add .` 必拒）
            if (rest) contextPaths.push(rest);
            else skipValueTo = "context";
          } else if (rest) {
            // 值在簇内（-mmsg / -mn：n 是消息值，不是 -n）
          } else {
            skipValueTo = "plain";
          }
          break;
        }
        if (ch === "n") {
          pendingC.push({ kind: "shortn", detail: `git commit 短选项簇 ${v} 含 -n（等价 --no-verify）` });
          continue;
        }
      }
      continue;
    }

    if (sub === null) {
      sub = v.toLowerCase();
      phase = "sub";
      continue;
    }
    positionals.push(v);
  }

  // C 规则命中放行时机：长选项仅 push/commit（git am/merge/rebase --no-verify 属范围外）；
  // 短选项簇 -n 在 push 是 dry-run 不算，仅 commit 算；配置旁路（anySub）与子命令无关一律拒（#85 范围声明）
  for (const p of pendingC) {
    if (p.kind === "anySub") out.push({ rule: "C", detail: p.detail });
    else if (p.kind === "long" && (sub === "commit" || sub === "push")) out.push({ rule: "C", detail: p.detail });
    else if (p.kind === "shortn" && sub === "commit") out.push({ rule: "C", detail: p.detail });
  }

  // git config 写形态覆写 core.hooksPath / alias.*（持久化旁路，与 -c 同罪，#85 H3）
  if (sub === "config") {
    const keyArgs = positionals.filter((a) => GIT_HOOK_CONFIG_KEY_RE.test(a));
    const isWriteForm =
      positionals.length >= 2 ||
      positionals.some((a) => GIT_HOOK_CONFIG_KEY_RE.test(a) && a.includes("=")) ||
      tokens.some((t) => /^--(unset|unset-all|replace-all|add)$/.test(t.value) || t.value === "-f" || t.value === "--file");
    if (keyArgs.length > 0 && isWriteForm) {
      out.push({ rule: "C", detail: `git config 写形态覆写 ${keyArgs[0].split("=")[0]}，等效 --no-verify` });
    }
    return;
  }

  if (sub === null || GIT_READ_SUBS.has(sub)) return; // 读子命令放行
  // 写子命令：位置参数 + 上下文路径（-C/--git-dir 等）都是写目标；选项值已排除（#85 M11）
  for (const a of positionals) {
    const p = resolveTarget(cwd, a);
    if (isProtected(p)) out.push({ rule: ruleFor(p), detail: `git ${sub} 命中受保护路径 ${a}` });
  }
  for (const cp of contextPaths) {
    const p = resolveTarget(cwd, cp);
    if (isProtected(p)) out.push({ rule: ruleFor(p), detail: `git ${sub} 以上下文路径指向受保护路径 ${cp}` });
  }
}

function normalizeVerb(value) {
  return path.win32.basename(value).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
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
  const verb = normalizeVerb(verbTok.value);
  const argWords = words.slice(vi + 1);
  const args = argWords.filter((t) => !isFlag(t) && t.value !== "");

  const checkArg = (tok, why) => {
    const p = resolveTarget(cwd, tok.value);
    if (isProtected(p)) out.push({ rule: ruleFor(p), detail: `${why}命中受保护路径 ${tok.value}` });
  };

  // 目标位解析族（#85 M2）：--opt=<路径> / dd of=<路径> / -o<贴连路径> 的值同过 isProtected
  const checkOptionValues = (why) => {
    for (const t of argWords) {
      if (t.kind !== "word" || t.value === "") continue;
      const v = t.value;
      let val = null;
      let m;
      if ((m = v.match(/^--?[A-Za-z][A-Za-z0-9_.:-]*=(.+)$/))) {
        val = m[1]; // 带横线的 key=value（--output=<路径> / -o=<路径>）
      } else if (!WRITE_FULL_VERBS.has(verb) && (m = v.match(/^[A-Za-z][A-Za-z0-9_.:-]*=(.+)$/))) {
        val = m[1]; // dd of=<路径> 类裸 key=value（代码包装层除外：那是赋值语句，防误伤）
      } else if ((m = v.match(/^-[A-Za-z](.+)$/)) && /[\\/:.%$~]/.test(m[1])) {
        val = m[1]; // 贴连短选项值（curl -o<路径>）
      }
      if (val !== null) checkArg({ value: val, quoted: t.quoted, kind: "word" }, `${why}选项值`);
    }
  };

  if (CD_VERBS.has(verb)) return; // 只改跟踪 cwd，由调用方处理
  if (verb === "popd") return;
  if (LOOP_HEAD_VERBS.has(verb)) return; // 循环头词表不是写目标（体在后续段，#85 M11）

  if (verb === "find") {
    if (FIND_WRITE_FLAGS.test(seg)) for (const a of args) checkArg(a, "find 写效应");
    return;
  }
  if (verb === "sed") {
    if (argHasInPlace(argWords)) for (const a of args) checkArg(a, "sed -i 原地写");
    return;
  }
  if (READ_VERBS.has(verb)) return; // 纯读放行（重定向面已单独判定）

  if (verb === "git") {
    analyzeGit(words.slice(vi), cwd, out);
    return;
  }
  if (SHELL_WRAPPER_VERBS.has(verb)) {
    // bash -c "命令文本"（含 -ec 捆绑簇，#85 M8）→ 递归按命令分析；否则按落盘工具的隐式 cwd 判定
    const cIdx = argWords.findIndex((t) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t.value));
    if (cIdx >= 0 && argWords[cIdx + 1]) {
      analyzeCommand(argWords[cIdx + 1].value, cwd, out);
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

  checkOptionValues(`${verb} 落盘`);

  if (WRITE_ALL_VERBS.has(verb)) {
    for (const a of args) checkArg(a, `${verb} 删除/写入`);
    return;
  }
  if (WRITE_DEST_LAST_VERBS.has(verb)) {
    // -t/--target-directory 值是目标前置形态（#85 M2）
    for (let i = 0; i < argWords.length; i++) {
      const t = argWords[i];
      if (!t.quoted && (t.value === "-t" || t.value === "--target-directory") && argWords[i + 1]) {
        checkArg(argWords[i + 1], `${verb} 复制进入`);
      }
    }
    if (verb === "robocopy") {
      // robocopy 源 目标 [文件…]：第二位置=复制进入；Windows 开关已滤，末位仍查文件过滤形态
      if (args.length > 1) checkArg(args[1], "robocopy 复制进入");
      if (args.length > 0) checkArg(args[args.length - 1], `${verb} 复制进入`);
      // /MOV /MOVE 从源移出 = 源也删
      if (argWords.some((t) => /^\/mov/i.test(t.value))) for (const a of args) checkArg(a, "robocopy /MOV 移出");
      return;
    }
    if (args.length > 0) checkArg(args[args.length - 1], `${verb} 复制进入`);
    return;
  }
  if (WRITE_MOVING_VERBS.has(verb)) {
    for (const a of args) checkArg(a, `${verb} 移动`);
    return;
  }
  if (WRITE_EXTRACT_VERBS.has(verb)) {
    // 解压落盘目标（#85 H5）：unzip -d / tar -C / --directory 的值
    for (let i = 0; i < argWords.length; i++) {
      const t = argWords[i];
      if (t.kind !== "word") continue;
      if (!t.quoted && (t.value === "-C" || t.value === "-d" || t.value === "--directory") && argWords[i + 1]) {
        checkArg(argWords[i + 1], `${verb} 解压落盘目标`);
      }
    }
    return; // 其余参数是源（只读），隐式 cwd 已判
  }

  // WRITE_FULL_VERBS 与未知动词（保守：非白名单读命令之外都不放行写面）
  for (const a of args) checkArg(a, `${verb} 落盘`);
  if (WRITE_FULL_VERBS.has(verb) && strongLiteralHit(seg) && WRITE_SIGNAL_RE.test(seg)) {
    out.push({ rule: REF_STRONG_RE.test(seg) ? "A" : "B", detail: `${verb} 包装内含写效应文本且指向受保护路径` });
  }
  // 包装层 --no-verify 兜底（powershell/cmd/node 等非递归包装内的 git 绕过形态，含前缀缩写）
  if (WRITE_FULL_VERBS.has(verb) && /--no-v/i.test(seg) && /\bgit\b/i.test(seg) && /\b(push|commit)\b/i.test(seg)) {
    out.push({ rule: "C", detail: `${verb} 包装内含 git push/commit --no-verify（或前缀缩写形态）` });
  }
}

// heredoc 体提取：<< / <<-'DELIM' 后首个换行到独占 DELIM 行之间（#85 M9）
function heredocBodies(cmd) {
  const bodies = [];
  const re = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
  let m;
  while ((m = re.exec(cmd))) {
    const stripTabs = m[1] === "-";
    const delim = m[3];
    const nl = cmd.indexOf("\n", m.index);
    if (nl < 0) continue;
    const lines = cmd.slice(nl + 1).split(/\r?\n/);
    const bodyLines = [];
    for (const line of lines) {
      const cmp = stripTabs ? line.replace(/^\t+/, "") : line;
      if (cmp === delim) break;
      bodyLines.push(line);
    }
    bodies.push(bodyLines.join("\n"));
  }
  return bodies;
}

function analyzeCommand(cmd, cwd, out) {
  for (const seg of splitSegments(cmd)) {
    const tokens = tokenize(seg);
    // cd 跟踪：段内 cd <path> 更新后续段的解析基准
    const words = tokens.filter((t) => t.kind === "word" && t.value !== "");
    analyzeSegment(seg, cwd, out);
    const vi = firstVerbIndex(words);
    const verb = words[vi] ? normalizeVerb(words[vi].value) : "";
    if (CD_VERBS.has(verb) && words[vi + 1]) {
      cwd = resolveTarget(cwd, words[vi + 1].value);
    }
  }
  // heredoc 体按代码文本复判（段切分会把体拆成伪命令段，python 写面要靠写信号文本，#85 M9）
  for (const body of heredocBodies(cmd)) {
    if (strongLiteralHit(body) && WRITE_SIGNAL_RE.test(body)) {
      out.push({ rule: REF_STRONG_RE.test(body) ? "A" : "B", detail: "heredoc 体内含写效应文本且指向受保护路径" });
    }
  }
}

// 命令是否有写效应（APPDATA 缺失 fail-loud 的限定条件，裁决 3）
function commandHasWriteEffect(cmd) {
  for (const seg of splitSegments(cmd)) {
    const tokens = tokenize(seg);
    if (tokens.some((t) => t.kind === "redirect")) return true;
    const words = tokens.filter((t) => t.kind === "word" && t.value !== "");
    const vi = firstVerbIndex(words);
    const verbTok = words[vi];
    if (!verbTok) continue;
    const verb = normalizeVerb(verbTok.value);
    if (READ_VERBS.has(verb) || CD_VERBS.has(verb) || LOOP_HEAD_VERBS.has(verb) || verb === "popd") continue;
    if (verb === "find") {
      if (!FIND_WRITE_FLAGS.test(seg)) continue;
      return true;
    }
    if (verb === "sed") {
      if (!argHasInPlace(words.slice(vi + 1))) continue;
      return true;
    }
    if (verb === "git") {
      const sub = gitSubOf(words.slice(vi));
      if (sub !== null && GIT_READ_SUBS.has(sub)) continue;
      return true;
    }
    return true;
  }
  return false;
}

function argHasInPlace(argWords) {
  return argWords.some((t) => !t.quoted && /^-{1,2}i/.test(t.value));
}

function gitSubOf(tokens) {
  let sub = null;
  let skipNext = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (sub === null) {
      if (isFlag(t)) {
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t.value) || /^--(git-dir|work-tree|exec-path|namespace|config-env|super-prefix)(=|$)/.test(t.value) || t.value === "-C") skipNext = !t.value.includes("=");
        continue;
      }
      sub = t.value.toLowerCase();
      break;
    }
  }
  return sub;
}

// ---------- 工具分派 ----------

function checkPathFields(toolInput, cwd, out) {
  for (const key of ["file_path", "path", "notebook_path", "filePath", "target"]) {
    const raw = toolInput?.[key];
    // 数字形态转字符串照判（#85 N19，勿静默跳过）；对象/数组等复合值不是合法路径形态，跳过
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const v = String(raw);
    if (v === "") continue;
    const p = resolveTarget(cwd, v);
    if (isProtected(p)) {
      out.push({ rule: ruleFor(p), detail: `写目标路径位于受保护目录下：${v}` });
    }
    failLoudUserdata(v, out, `写目标路径 ${v}`);
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
    // *** <op> File: 与 *** Move to: 行都是写目标（Move to 补于 #85 M10）
    for (const m of text.matchAll(/\*\*\*\s+(?:\w+\s+File|Move to):\s*(.+)/g)) {
      const target = m[1].trim();
      const p = resolveTarget(base, target);
      if (isProtected(p)) out.push({ rule: ruleFor(p), detail: `补丁写目标位于受保护目录下：${target}` });
      failLoudUserdata(target, out, `补丁写目标 ${target}`);
    }
    return out;
  }
  if (name === "Bash") {
    const rawCmd = toolInput?.command;
    // 非字符串形态不静默跳过（#85 N20）：数组参数拼接后照判
    const cmd = Array.isArray(rawCmd)
      ? rawCmd.map((x) => String(x)).join(" ")
      : typeof rawCmd === "string"
        ? rawCmd
        : typeof rawCmd === "number"
          ? String(rawCmd)
          : "";
    if (cmd) analyzeCommand(cmd, base, out);
    // APPDATA 缺失 fail-loud（裁决 3）：仅写效应命令 + 真档强字面量保守拒，不做全局拒（纯读照常放行）
    if (cmd && out.length === 0 && userDataRoots().length === 0 && USERDATA_STRONG_RE.test(cmd) && commandHasWriteEffect(cmd)) {
      out.push({ rule: "B", detail: "环境故障：APPDATA 不可解析，按最严处置——写效应命令文本命中真档强字面量，保守拒" });
    }
    return out;
  }
  // MCP 写面（裁决 1，#85）：mcp__node_repl__js 的 code 按包装层文本判定（强字面量 + 写信号，不求完备）
  if (name === "mcp__node_repl__js") {
    const code = typeof toolInput?.code === "string" ? toolInput.code : "";
    if (code && strongLiteralHit(code) && WRITE_SIGNAL_RE.test(code)) {
      out.push({ rule: REF_STRONG_RE.test(code) ? "A" : "B", detail: "node_repl 代码含写效应文本且指向受保护路径" });
    }
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
  try {
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
  } catch (err) {
    // fail-closed（#85）：门禁自身运行时异常一律保守拒，勿静默放行
    process.stderr.write(
      `合规门禁自身故障，请修复 pretooluse-guard.mjs（fail-closed 保守拒）：${err?.message ?? err}\n`,
    );
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
