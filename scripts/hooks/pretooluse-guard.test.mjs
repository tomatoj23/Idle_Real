// pretooluse-guard 金丝雀自测（#81 验收的模拟路径验证层）。
// 运行：node scripts/hooks/pretooluse-guard.mjs --self-test（或直接跑本文件）
// 纪律：本套未全绿前，禁止对真实目录（Reference_Documents / 用户真档）发任何写尝试。
// 「如何变红」：改坏规则实现后，对应 DENY 用例会翻绿（即门禁失效）；改坏匹配边界后，
// ALLOW 用例会翻红（即误伤正常操作）。

import { classify, formatDeny } from "./pretooluse-guard.mjs";

const CWD = String.raw`D:\My_Projects\SmallRpg`;
const REF = String.raw`D:\My_Projects\Reference_Documents`;

// 模拟用户真档落点（绝对形态用例按运行时 APPDATA 拼，$APPDATA 形态由守卫自行展开）
const FAKE_APPDATA = process.env.APPDATA ?? String.raw`C:\Users\023\AppData\Roaming`;
const FAKE_USERDATA = `${FAKE_APPDATA}\\问道长生`;

const DENY_CASES = [
  // ---- 钩子 A ----
  ["A-write-tool", "Write", { file_path: `${REF}\\electron-main\\x.md`, content: "y" }, "A"],
  ["A-edit-tool-fwdslash", "Edit", { file_path: "D:/My_Projects/Reference_Documents/foo.txt", old_string: "a", new_string: "b" }, "A"],
  ["A-bash-redirect", "Bash", { command: `echo hi > ${REF}\\probe.txt` }, "A"],
  ["A-bash-rm", "Bash", { command: `rm -rf ${REF}\\electron-main` }, "A"],
  ["A-bash-touch", "Bash", { command: `touch ${REF}\\x` }, "A"],
  ["A-bash-cp-into", "Bash", { command: `cp x.md ${REF}\\` }, "A"],
  ["A-bash-mv-from", "Bash", { command: `mv ${REF}\\x .` }, "A"],
  ["A-bash-sed-inplace", "Bash", { command: `sed -i "s/a/b/" ${REF}\\f.md` }, "A"],
  ["A-bash-cd-then-write-tool", "Bash", { command: `cd ${REF} && npm install` }, "A"],
  ["A-bash-cd-relative", "Bash", { command: `cd ..\\Reference_Documents && touch x` }, "A"],
  ["A-bash-find-delete", "Bash", { command: `find ${REF} -name "*.tmp" -delete` }, "A"],
  ["A-bash-git-write-sub", "Bash", { command: `git -C ${REF} add .` }, "A"],
  ["A-bash-wrapper-write-signal", "Bash", { command: `powershell -Command "Remove-Item '${REF}\\x'"` }, "A"],
  // ---- 钩子 B（含 2026-09-29 事故原形态）----
  ["B-bash-incident-form", "Bash", { command: `rm -rf "$APPDATA/问道长生"` }, "B"],
  ["B-bash-incident-brace", "Bash", { command: `rm -rf "\${APPDATA}/问道长生"` }, "B"],
  ["B-bash-percent", "Bash", { command: `rm -rf %APPDATA%\\问道长生` }, "B"],
  ["B-bash-absolute", "Bash", { command: `rm -rf ${FAKE_APPDATA}\\问道长生` }, "B"],
  ["B-write-overwrite-save", "Write", { file_path: `${FAKE_USERDATA}\\saves\\wendao_changsheng_v3.json`, content: "{}" }, "B"],
  ["B-bash-redirect-save", "Bash", { command: `echo "{}" > "$APPDATA/问道长生/saves/slot-a.json"` }, "B"],
  ["B-bash-cd-then-write", "Bash", { command: `cd "$APPDATA/问道长生" && touch probe` }, "B"],
  // 控制流剥前缀后不得漏判写动词
  ["A-if-then-rm", "Bash", { command: `if [ -x y ]; then rm -rf ${REF}\\x; fi` }, "A"],
  // ---- 钩子 C ----
  ["C-push-no-verify", "Bash", { command: `git push --no-verify` }, "C"],
  ["C-push-no-verify-args", "Bash", { command: `git push origin main --no-verify` }, "C"],
  ["C-commit-no-verify", "Bash", { command: `git commit --no-verify -m x` }, "C"],
  ["C-commit-short", "Bash", { command: `git commit -n -m "x"` }, "C"],
  ["C-commit-short-cluster", "Bash", { command: `git commit -an -m "x"` }, "C"],
  ["C-git-exe-form", "Bash", { command: `git.exe push --no-verify` }, "C"],
  // 引号包裹的独立选项形态（review 发现后补）：git 同样视其为选项
  ["C-push-quoted", "Bash", { command: `git push "--no-verify"` }, "C"],
  ["C-commit-quoted-short", "Bash", { command: `git commit "-n" -m x` }, "C"],
  // 包装层内的 --no-verify（review 发现后补）
  ["C-powershell-wrapper", "Bash", { command: `powershell -Command "git push --no-verify"` }, "C"],
  // PowerShell 环境变量形态（review 发现后补）
  ["B-powershell-env-form", "Bash", { command: `rm -rf "$env:APPDATA/问道长生"` }, "B"],
  ["B-cmd-del-wrapper", "Bash", { command: `cmd /c "del %APPDATA%\\问道长生\\saves\\x.json"` }, "B"],
];

const ALLOW_CASES = [
  ["L-ls-ref", "Bash", { command: `ls ${REF}` }],
  ["L-ls-ref-quoted", "Bash", { command: `ls -la "${REF}\\electron-main"` }],
  ["L-grep-ref", "Bash", { command: `grep -rn "safeStorage" ${REF}\\electron-main\\docs` }],
  ["L-find-ref", "Bash", { command: `find ${REF} -name "*.ts" | head` }],
  ["L-cat-ref", "Bash", { command: `cat ${REF}\\README.md` }],
  ["L-read-tool-ref", "Read", { file_path: `${REF}\\electron-main\\package.json` }],
  ["L-write-repo", "Write", { file_path: `${CWD}\\docs\\x.md`, content: "y" }],
  // 散文提及受保护路径 + 写到工作区 = 正常文档工作，不得误伤
  ["L-echo-prose-mention", "Bash", { command: `echo "用户明令：${REF} 严禁改动" >> docs/agents/compliance.md` }],
  ["L-grep-prose-word", "Bash", { command: `grep -rn "Reference_Documents" docs/` }],
  ["L-git-normal-push", "Bash", { command: `git push origin main` }],
  ["L-git-commit-normal", "Bash", { command: `git commit -m "msg"` }],
  ["L-git-commit-cluster-no-n", "Bash", { command: `git commit -am "msg"` }],
  ["L-git-commit-quoted-dash-n", "Bash", { command: `git commit -m "-n"` }],
  // -am 捆绑带 m：后续词是消息值，不得误判
  ["L-git-commit-am-value", "Bash", { command: `git commit -am "use -n flag"` }],
  ["L-git-push-dry-run-short", "Bash", { command: `git push -n` }],
  ["L-git-status-in-ref", "Bash", { command: `git -C ${REF} status` }],
  ["L-npm-workspaces", "Bash", { command: `npm test --workspaces --if-present` }],
  ["L-npm-scope-slash", "Bash", { command: `npm i -w @wendao/app-desktop foo` }],
  ["L-rm-repo", "Bash", { command: `rm -rf packages/engine/node_modules` }],
  ["L-game-name-prose", "Bash", { command: `grep -rn "问道长生" docs/` }],
  ["L-backup-out-of-userdata", "Bash", { command: `cp "$APPDATA/问道长生/saves/wendao_changsheng_v3.json" .scratch/backup.json` }],
  ["L-bash-c-read-ref", "Bash", { command: `bash -c "ls '${REF}'"` }],
  // 测试构词 = 纯读，不得误伤（2026-09-29 活体验收实测误伤后补）
  ["L-if-test-construct", "Bash", { command: `if [ -e ${REF}\\x ]; then echo y; fi` }],
  ["L-test-construct", "Bash", { command: `test -f "${REF}\\README.md" && echo yes` }],
];

export function runSelfTest() {
  let failed = 0;
  const report = (ok, msg) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  };

  for (const [name, toolName, toolInput, rule] of DENY_CASES) {
    const v = classify({ toolName, toolInput, cwd: CWD });
    const hit = v.some((x) => x.rule === rule);
    report(
      hit,
      `deny  ${name}（期望规则 ${rule}${v.length ? `，实得 ${v.map((x) => x.rule).join(",")}` : "，实得放行——门禁失效"}）`,
    );
    if (hit) {
      const text = formatDeny(v);
      report(text.includes("规则来源") && text.includes("正确做法"), `deny  ${name} 拒绝文案含规则来源与正确做法`);
    }
  }

  for (const [name, toolName, toolInput] of ALLOW_CASES) {
    const v = classify({ toolName, toolInput, cwd: CWD });
    report(
      v.length === 0,
      `allow ${name}${v.length ? `（误伤：${v.map((x) => `${x.rule}:${x.detail}`).join(";")}）` : ""}`,
    );
  }

  console.log(
    failed === 0
      ? `\n金丝雀全绿（${DENY_CASES.length} 拒 + ${ALLOW_CASES.length} 放行）。`
      : `\n${failed} 项失败——门禁失效或误伤，模拟验证未过，禁止对真实目录发写尝试。`,
  );
  return failed === 0;
}

// 直接执行时自跑
import path from "node:path";
import { fileURLToPath } from "node:url";
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
) {
  process.exit(runSelfTest() ? 0 : 1);
}
