'use strict';
/* ============================================================================
 * tools/t_lib/check.js —— **共享测试库 · 断言与汇总**（2026-10-12 立）
 * ----------------------------------------------------------------------------
 * 焊进去的三条历史教训：
 *   ① **默认静音**（用户 2026-10-12："token 消耗还是很快"）：只打**失败行** + 最后一行汇总；
 *      每条 ✔ 都打进输出就会一直留在上下文里（每跑一次 30~60 行 × 每窗 3~5 次）。要全量看就 `--verbose` 或 `VERBOSE=1`。
 *   ② `expectRed()`（注入自测）：**必须先记 before、跑完把 bad 回滚** —— 否则"故意弄红"的计数会污染最终汇总（窗49/50 都踩过）。
 *   ③ 汇总行格式固定为 `断言 N 条 / 红 M 条`，`exit(bad?1:0)` 由 `finish()` 统一给（别自己 process.exit）。
 * 用法：
 *   const C = require('./tools/t_lib/check');
 *   C.ok(x === 1, '表头恰 1 行（实测 ' + x + '）');
 *   C.expectRed(() => { if (badCond) C.red('注入：顶点数回退'); }, '顶点数回退');
 *   C.finish();     // 打印汇总 + 设好 exit code（不直接退出，方便包一层 close()）
 * ========================================================================== */
const VERBOSE = process.argv.indexOf('--verbose') >= 0 || process.env.VERBOSE === '1';

const state = { n: 0, bad: 0, fails: [], section: '' };
const out = (s) => console.log(s);

function section(title) {
  state.section = title;
  if (VERBOSE) out('===== ' + title + ' =====');
}
function ok(cond, msg) {
  state.n++;
  if (cond) { if (VERBOSE) out('  ✔ ' + msg); return true; }
  state.bad++;
  state.fails.push((state.section ? '[' + state.section + '] ' : '') + msg);
  out('  ❌ ' + msg);
  return false;
}
function eq(got, want, msg) { return ok(got === want, (msg || '') + '（实测 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want) + '）'); }
/* 只记红、不打 ✔（给"批量逐帧扫描"用：几十帧都打出来就是噪声） */
function red(msg) { ok(false, msg); }
function note(msg) { if (VERBOSE) out('  · ' + msg); }

/* 注入自测：故意制造的红不计入最终统计（窗49 立、窗50 沿用）
   ⚠ 窗54 实测的一个真缺陷：回调里若调 `red()`，它内部会 `state.fails.push` 再 `out()` ——
   而 `expectRed` 把 `console.log` 换成了空函数，`out()` 本身不会抛，但**回调一旦走到的分支
   还依赖别的东西就可能静默**；更关键的是**光有 expectRed 只能证明"会红"，证明不了"该绿时绿"**。
   所以配一个 `expectGreen`（反过来：断言它**不**报红），两个一起用才叫"判断规则被样本分开"（§3.8-17 形态⑬）。 */
function expectRed(fn, tag) {
  const before = state.bad;
  const quiet = console.log;
  console.log = () => { };
  try { fn(); } finally { console.log = quiet; }
  const delta = state.bad - before;
  state.bad = before;
  state.n -= delta;                    /* 被回滚的那些断言也不算进 n */
  state.fails = state.fails.slice(0, state.fails.length - delta >= 0 ? state.fails.length - delta : 0);
  ok(delta > 0, '注入自测该红会红：' + tag + '（报红 ' + delta + ' 处）');
}
/* 反向注入：回调这段判据在**正确数据**上必须不报红（证明判据不是恒真、不是恒假） */
function expectGreen(fn, tag) {
  const before = state.bad;
  const quiet = console.log;
  console.log = () => { };
  try { fn(); } finally { console.log = quiet; }
  const delta = state.bad - before;
  state.bad = before;
  state.n -= delta;
  state.fails = state.fails.slice(0, state.fails.length - delta >= 0 ? state.fails.length - delta : 0);
  ok(delta === 0, '注入自测该绿仍绿：' + tag + '（报红 ' + delta + ' 处，期望 0）');
}

function finish(opt) {
  const o = opt || {};
  out('断言 ' + state.n + ' 条 / 红 ' + state.bad + ' 条');
  if (state.bad && o.showFails !== false) state.fails.slice(0, 12).forEach(f => out('  · ' + f));
  return state.bad;
}
function finishAndExit(opt) { process.exit(finish(opt) ? 1 : 0); }

module.exports = { ok, eq, red, note, section, expectRed, expectGreen, finish, finishAndExit, state, VERBOSE };
