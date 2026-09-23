#!/usr/bin/env node
'use strict';
/* 408-handover / scripts / gate.js —— 三条硬门，一条命令跑完（窗17 立）
   ============================================================================
   用法（在任意目录都行，脚本自己找仓库根；沙箱里 python 不在 PATH，故默认写全路径）：
     node .dsh/skills/408-handover/scripts/gate.js
     node .dsh/skills/408-handover/scripts/gate.js --python "D:\\anaconda\\python.exe"
     node .dsh/skills/408-handover/scripts/gate.js --only 2        # 只跑第 2 条门（调试用）

   判据（§6.2.14⑩① 立的）：三条门各自的 exit code 全 0 ⟹ 本脚本 exit 0；
     任一红 ⟹ 本节打 `[门 N 红]` + 末尾汇总表，本脚本 exit 1。
   三条门与 handover 的对应：门 1 = §0.2 第 6 步①（`tools/doc_check.py`）、
     门 2 = §0.2 第 6 步②（`tmp_readme_audit.js check`）、门 3 = §0.2 第 6 步③（`tmp_t14_probe.js`）。

   ⚠ 本脚本只做"跑 + 汇总"，**不含判据本体**——判据在被调的三个脚本里，要改判据改那边
     （§8.3"同一结论只有一个家"）。
   ⚠ 用 `stdio: 'inherit'`（**不是默认的 'pipe'**）：沙箱下 `spawnSync` 用管道捕获子进程输出会
     `EPERM`（§3.5-9② 的同源坑）；inherit 让三个脚本自己把输出打到控制台，本脚本只读 `status`。
   ⚠ 窗17 本来按 §6.2.14⑩① 写的是 `gate.ps1`，实测本机 `pwsh` 其实是 **Windows PowerShell 5.1**：
     无 BOM 的 `.ps1` 按 ANSI(GBK) 解码，中文字符串的中段会把紧随其后的引号吃掉 → `ParserError`。
     改用 node 实现（原文允许 `.ps1` 或 `.js`），且与项目其余工具同语言。依据见 §6.2.15。
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const PY = opt('python', 'D:\\anaconda\\python.exe');
const ONLY = Number(opt('only', '0')) || 0;

/** 仓库根 = 从本文件往上找到的第一个含 `docs/handover.md` 的目录。
 *  不写死层数：`__dirname` 是 `<根>/.dsh/skills/408-handover/scripts`，写死层数会在目录一动就静默找错根。 */
function findRoot(start) {
  let cur = start;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(cur, 'docs', 'handover.md'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return '';
}

const ROOT = findRoot(__dirname);
if (!ROOT) {
  console.log('✖ 找不到仓库根（从本脚本往上没有 `docs/handover.md`）——');
  console.log('  本脚本只能放在 <仓库根>/.dsh/skills/408-handover/scripts/ 下');
  process.exit(1);
}

const GATES = [
  {
    n: 1,
    name: 'doc_check.py（文档计数 + 15 项自检，含 skill ↔ handover 一致性）',
    exe: PY,
    args: ['tools/doc_check.py'],
  },
  {
    n: 2,
    name: 'tmp_readme_audit.js check（README/注释 ↔ exam-history.js，四模式）',
    exe: process.execPath,
    args: ['tmp_readme_audit.js', 'check'],
  },
  {
    n: 3,
    name: 'tmp_t14_probe.js（handover 完整性：五个标题行首各 1）',
    exe: process.execPath,
    args: ['tmp_t14_probe.js'],
  },
];

console.log('仓库根：' + ROOT);
const rows = [];
for (const g of GATES) {
  if (ONLY > 0 && g.n !== ONLY) continue;
  console.log('');
  console.log('===== 门 ' + g.n + '/3：' + g.name + ' =====');

  const target = path.join(ROOT, g.args[0]);
  let code = 1;
  if (!fs.existsSync(target)) {
    console.log('  跑不起来：脚本不存在 → ' + g.args[0]);
  } else if (g.exe === PY && !fs.existsSync(PY)) {
    console.log('  跑不起来：python 不在 ' + PY + '（用 --python <路径> 覆盖，见 §3.5-16）');
  } else {
    const r = spawnSync(g.exe, g.args, { cwd: ROOT, stdio: 'inherit' });
    code = r.status === null ? 1 : r.status;
    if (r.error) console.log('  跑不起来：' + r.error.message);
  }

  if (code === 0) {
    console.log('  [门 ' + g.n + ' 绿]');
  } else {
    console.log('  [门 ' + g.n + ' 红] exit=' + code + ' —— 错在哪看本节上面那些带 ✖ / 不一致 的行');
  }
  rows.push({ n: g.n, name: g.name, code });
}

console.log('');
console.log('===== 三条硬门汇总（口径见 §0.2 第 6 步） =====');
for (const r of rows) {
  console.log('  [' + (r.code === 0 ? '绿' : '红') + '] 门 ' + r.n + '  ' + r.name);
}
const red = rows.filter((r) => r.code !== 0).length;
console.log('  合计：' + rows.length + ' 条门，' + red + ' 红');
if (red > 0) {
  console.log('✖ 有红门 —— 先按它指的位置修，再重跑本脚本（红的那条是上一窗的遗留或本窗的回归）');
  process.exit(1);
}
console.log('✔ 三条硬门全绿：工作区干净，可以开工（§0.2 第 6 步）');
