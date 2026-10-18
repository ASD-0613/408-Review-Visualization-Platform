'use strict';
/* ============================================================================
 * tools/t_lib/smoke.js —— **共享测试库 · Node 侧冒烟助手**（2026-10-12 立）
 * ----------------------------------------------------------------------------
 * 以前每窗都要抄：`global.window=global` + 逐个 require（framework / exam-history / 模块）+
 * 取默认输入构造 `vals` + `parse`/`buildSnapshots` + 把每一帧塞进假 stage 渲染一遍扫脏值 +
 * 驱动 `quickActions`（假 `setInput`/`load` 运行时）。这些全在这里。
 * 焊进去的教训：
 *   · **每一帧都要渲染**（只渲染末帧会漏掉中间帧的脏值 / 崩溃；stepper 的 render 还要 `snap`，§6.2.48⑥）；
 *   · 预设必须逐个驱动 —— 它跑不通就是"用户一点就炸"（§6.2.30②：选项字段写成 `value/label` 的坑）。
 * 用法：
 *   const S = require('./tools/t_lib/smoke');
 *   S.load(__dirname, ['js/framework.js', 'js/exam-history.js', 'js/modules/ds-sort.js']);
 *   const def = S.module('ds-sort'); const r = S.run(def, { algo: 'shell' });
 *   const { probs } = S.renderAll(def, r.m, r.s);
 * ========================================================================== */
const path = require('path');

function load(root, files) {
  global.window = global;
  (files || ['js/framework.js', 'js/exam-history.js']).forEach(f => require(path.join(root, f)));
}
/* ⚠ 函数名**不能叫 `module`** —— 那会把 CommonJS 的 `module` 对象屏蔽掉，`module.exports = {...}` 就写到了
   自己身上（本文件第一版就这么栽的：`require` 回来是空对象）。导出里保留 `module` 这个别名供调用方用。 */
function getModule(id) {
  const d = (global.RC408 && RC408.modules) ? RC408.modules[id] : null;
  if (!d) throw new Error('没有模块 ' + id + '（require 了吗？）');
  return d;
}
function valsOf(def, over) {
  const v = {};
  (def.inputs || []).forEach(i => { v[i.key] = i.default === undefined ? '' : String(i.default); });
  Object.keys(over || {}).forEach(k => { v[k] = String(over[k]); });
  return v;
}
function run(def, over) {
  const vals = valsOf(def, over);
  const m = def.parse(vals);
  const s = def.buildSnapshots(m);
  return { m: m, s: s, vals: vals };
}
function last(r) { return r.s[r.s.length - 1]; }

/* 逐帧渲染 + 脏值扫描（假 stage；返回每一帧的 HTML 便于再做结构断言） */
function renderAll(def, model, snaps, opt) {
  const o = opt || {};
  const htmls = [], probs = [];
  (snaps || []).forEach((snap, i) => {
    const stage = { innerHTML: '' };
    try { def.render({ snap: snap, model: model, inputs: o.inputs || {}, stage: stage, idx: i, total: snaps.length }); }
    catch (e) { probs.push('帧 ' + i + ' render 抛错：' + (e && e.message)); return; }
    const h = String(stage.innerHTML);
    htmls.push(h);
    ['NaN', 'undefined', '[object Object]', '${'].forEach(w => {
      if (h.indexOf(w) >= 0) probs.push('帧 ' + i + ' 渲染出现 ' + w);
    });
  });
  return { htmls: htmls, probs: probs };
}

/* 逐个预设：驱动假运行时 → 得到该预设的输入与快照（跑不通就把 err 记下来） */
function presets(def) {
  return (def.quickActions || []).map((qa, i) => {
    const store = {};
    const rt = { setInput: (k, v) => { store[k] = String(v); }, load: () => { } };
    let err = null;
    try { qa.run(rt); } catch (e) { err = (e && e.message) || String(e); }
    const vals = Object.assign(valsOf(def), store);
    let r = null;
    try { r = run(def, vals); } catch (e) { err = err || ((e && e.message) || String(e)); }
    return { i: i, label: qa.label, vals: vals, model: r && r.m, snaps: r && r.s, err: err };
  });
}

/* 契约自检：模块该有的字段 / 输入选项字段名（`o.v` / `o.t`）/ 三问标记 */
function contract(def, opt) {
  const o = opt || {};
  const probs = [];
  ['id', 'mode', 'title', 'theory', 'inputs', 'parse', 'render'].forEach(k => { if (def[k] === undefined) probs.push('缺字段 ' + k); });
  if (!def.buildSnapshots && def.mode === 'stepper') probs.push('stepper 缺 buildSnapshots');
  (def.inputs || []).forEach(i => {
    if (i.type === 'select') {
      if (!Array.isArray(i.options) || !i.options.length) probs.push('下拉 ' + i.key + ' 没有 options');
      (i.options || []).forEach((op, k) => {
        if (!op || op.v === undefined || !op.t) probs.push('下拉 ' + i.key + ' 第 ' + (k + 1) + ' 项字段名不对（要 o.v / o.t）');
      });
      if (i.default !== undefined && !(i.options || []).some(op => String(op.v) === String(i.default))) probs.push('下拉 ' + i.key + ' 的 default 不在 options 里');
    }
  });
  ['为什么要有它', '怎么实现', '记住什么'].forEach(t => { if (String(def.theory || '').indexOf(t) < 0) probs.push('theory 缺三问之一：' + t); });
  if (o.needSnap !== false && def.mode === 'stepper' && typeof def.buildSnapshots === 'function' && typeof def.parse === 'function') {
    let r = null;
    try { r = run(def, o.inputs); } catch (e) { probs.push('默认输入跑不通：' + ((e && e.message) || e)); }
    if (r && (!Array.isArray(r.s) || !r.s.length)) probs.push('buildSnapshots 没给出帧');
  }
  return probs;
}

module.exports = { load, module: getModule, getModule, valsOf, run, last, renderAll, presets, contract };
