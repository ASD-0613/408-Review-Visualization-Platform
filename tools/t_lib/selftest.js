'use strict';
/* ============================================================================
 * tools/t_lib/selftest.js —— **共享测试库自己的自测**（2026-10-12 立；§3.8-17 的纪律：
 *   "立了判据就要能证明它会红"）—— 不碰浏览器，2 秒跑完，任何一条红都说明**库坏了**，
 *   而不是"被测模块坏了"（否则每窗的假红都要从这个方向排查一遍）。
 * 用法：node tools/t_lib/selftest.js
 * ========================================================================== */
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const C = require('./check');
const P = require('./page');
const S = require('./smoke');
const cdp = require('./cdp');

C.section('导出面');
[['cdp', cdp, ['open', 'pickBrowser', 'sleep']], ['page', P, ['buildHarness', 'frameFacts', 'seekLast', 'seekAll', 'overlap', 'dirtyProblems']],
  ['smoke', S, ['load', 'module', 'valsOf', 'run', 'renderAll', 'presets', 'contract']]].forEach(([nm, mod, keys]) => {
  keys.forEach(k => C.ok(typeof mod[k] === 'function', nm + '.' + k + ' 是可调用的'));
});
C.ok(typeof cdp.pickBrowser() === 'string' && fs.existsSync(cdp.pickBrowser()), '能定位到本机浏览器：' + cdp.pickBrowser());

C.section('buildHarness');
const h = P.buildHarness({ root: ROOT, out: 'tmp_harness_lib_selftest.html' });
C.ok(h.bytes > 20000, '生成的离线 harness 有内容（' + h.bytes + ' bytes）');
const html = fs.readFileSync(h.file, 'utf8');
C.ok(html.indexOf('cdn.tailwindcss.com') < 0, 'CDN 那句已摘掉');
C.ok(html.indexOf('window.tailwind = window.tailwind') >= 0 || html.indexOf('tailwind.config') < 0, 'tailwind.config 已改写或不引用');
C.ok(/<!-- Tailwind 兜底（窗34）/.test(html) === false, '窗34 兜底段已摘掉');
fs.unlinkSync(h.file);

C.section('contract 判据（注入自测：坏模块必须被抓）');
S.load(ROOT, ['js/framework.js', 'js/exam-history.js', 'js/modules/ds-dag-expr.js']);
const good = S.module('ds-dag-expr');
C.eq(S.contract(good).length, 0, '真模块契约零问题');
const bad = {
  id: 'x', mode: 'stepper', title: 't', theory: '没有三问',
  inputs: [{ key: 'a', type: 'select', default: 'z', options: [{ value: 1, label: 'x' }] }],
  parse: () => ({}), render: () => { },
  /* 故意不给 buildSnapshots */
};
const probs = S.contract(bad).join(' | ');
C.ok(probs.indexOf('stepper 缺 buildSnapshots') >= 0, '抓到"stepper 缺 buildSnapshots"');
C.ok(probs.indexOf('o.v / o.t') >= 0, '抓到下拉字段名写错（value/label）');
C.ok(probs.indexOf('default 不在 options') >= 0, '抓到 default 不在 options');
C.ok(probs.indexOf('三问') >= 0, '抓到 theory 缺三问');

C.section('renderAll 脏值扫描（注入自测）');
const r = S.run(good);
C.eq(S.renderAll(good, r.m, r.s).probs.length, 0, '真模块逐帧渲染无脏值');
const fake = { render: (ctx) => { ctx.stage.innerHTML = '<b>NaN</b> 与 ${} 与 undefined'; } };
C.ok(S.renderAll(fake, {}, [{}]).probs.length >= 3, '脏值扫描抓到 NaN / ${} / undefined');
const thrower = { render: () => { throw new Error('boom'); } };
C.ok(S.renderAll(thrower, {}, [{}]).probs.join('').indexOf('render 抛错') >= 0, '渲染抛错被记成问题而不是崩掉脚本');

C.section('check 的注入自测回滚');
const before = C.state.bad;
C.expectRed(() => { C.red('故意红'); }, '故意红');
C.eq(C.state.bad, before, 'expectRed 跑完把 bad 回滚（窗49/50 的教训）');

process.exit(C.finish() ? 1 : 0);
