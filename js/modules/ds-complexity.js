'use strict';
/* ============================================================================
 * ds-complexity.js —— 【数据结构】算法时间复杂度分析（逐行执行次数 → 量级判定）
 * ----------------------------------------------------------------------------
 * 真题考情（**窗30 从零核定**；口径**沿用 §2.1/README 已核定的"9/18 年、全选择题"**，
 *   逐条回 `考情缓存/` 取证，证据行号见 js/exam-history.js 的条目注释）：
 *   **本条目登记 8/18 年**：2011-1（while 倍增）、2012-1（递归式）、2014-1（外层倍增 × 内层 n）、
 *   2017-1（sum += ++i ⟹ O(√n)）、2019-1、2022-1（倍增求和）、2023-1（哪类操作平均 O(1)）、2025-1。
 *   第 9 年 **2013-1**（两升序链表合并的复杂度）按 §2.0② 归**更专**的 `ds-seqlist`
 *   （"顺序 vs 链式的代价辨析"，**窗28 已裁决**，见 exam-history.js:710 与 :995）⟹ 本条目不重复登记。
 *   ⚠ **11 道 DS 算法设计大题（2010-42…2022-42）的收尾小问"说明你所设计算法的时间复杂度"不登记**：
 *     本模块的可视化对象是"**给定代码/递归式 → 数次数 → 判量级**"，大题考的是算法设计；
 *     且 §2.1/README 对该考点的既有核定就是"全选择题"。看着像但按口径不登记的清单见 exam-history 注释。
 *
 * ★ 数据模型（快照只读；每帧**全量**携带，便于任意跳帧回放）
 *   两种模式 kind：
 *   · 'code'（代码逐行计数）：snip = 片段（7 个，其中 3 个是 2011-1 / 2014-1 / 2017-1 的真题结构）
 *       每帧：line = 正在执行的行号；counts = 各行**已执行次数**（拷贝）；vars = 变量当前值（拷贝）；
 *             total = 累计执行次数 f(n)（= Σ counts，就是"语句频度之和"）
 *   · 'rec'（递归式展开）：rec = 递归式（4 个）
 *       每帧：layer = 当前层号；count = 本层子问题个数；sumSizes = 本层各子问题规模之和；
 *             sizeMax = 本层最大子问题规模；layerCost = 本层代价合计；cum = 累计代价 T(n)
 *
 * ★ 五条不变量（本模块全部断言围着它们写，见 tmp_t30_cx_smoke.js）
 *   ① **f(n) = Σ 各行实测次数**，且**末帧 total = 各 freq 表达式之和**（表达式的机器复核是第二条验证路径）；
 *   ② **循环头按"判断次数"计**（`for(i=1;i<=n;i++)` 是 n+1 次：n 次成立 + 最后 1 次不成立）；
 *   ③ **三角形内层 Σi = n(n+1)/2 仍是 O(n²)**；加法组合取最高阶（O(n²)+O(n) = O(n²)）；
 *   ④ **量级判定由机器算**：把各行的 freq 表达式在 n = 16/64/256/1024/4096 处求和，与 7 个候选量级
 *      逐一比比值，**第一个"比值有界"的就是答案**（判据：极差 max/min ≤ 1.6）；
 *   ⑤ **递归式逐层展开**：half 型每层规模之和恒为 n、层数 ⌈log₂n⌉+1；minus 型层数 = n；
 *      2T(n−1)+1 的子问题个数逐层翻倍 ⟹ O(2ⁿ)。
 * ⚠ 快照里的 counts / vars 必须**深拷贝**（对象是引用类型，不拷贝则跳帧会串味，§1.3 铁律）。
 * ⚠ 渲染里的 `cx-*` 是**给 harness 断言的钩子类名**（不参与样式，样式走内联/纯 CSS），
 *   方便脚本数"代码几行、频度表几行、当前行高亮没有、同一行有没有压盖"。
 *
 * ★ 为什么两种模式：选择题的两大题型就是"**给代码段数次数**"（2011/2014/2017/2019/2022/2025 第 1 题）
 *   与"**给递归式求量级**"（2012-1），模式②把"每层代价 × 层数"这件事逐层画出来。
 * ========================================================================== */

/* ------------------------------------------------------------------ *
 * 第一部分：极小表达式求值器（只认 数字 / 变量 / + - * / 与括号）
 *   整数除法向下取整 —— 与 C 里 int 的 `/` 一致（2011-1 与 2017-1 都靠这个语义）。
 * ------------------------------------------------------------------ */
function _cxEval(src, env) {
  const s = String(src);
  let i = 0;
  const skip = () => { while (i < s.length && s.charAt(i) === ' ') i++; };
  function factor() {
    skip();
    if (s.charAt(i) === '(') { i++; const v = expr(); skip(); if (s.charAt(i) === ')') i++; return v; }
    const num = /^[0-9]+/.exec(s.slice(i));
    if (num) { i += num[0].length; return parseInt(num[0], 10); }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { i += id[0].length; return env[id[0]] === undefined ? 0 : env[id[0]]; }
    i++; return 0;
  }
  function term() {
    let v = factor();
    for (;;) {
      skip(); const c = s.charAt(i);
      if (c === '*') { i++; v = v * factor(); }
      else if (c === '/') { i++; const d = factor(); v = d === 0 ? 0 : Math.floor(v / d); }
      else return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      skip(); const c = s.charAt(i);
      if (c === '+') { i++; v = v + term(); }
      else if (c === '-') { i++; v = v - term(); }
      else return v;
    }
  }
  return expr();
}

/* ------------------------------------------------------------------ *
 * 第二部分：模式①的 7 个代码片段
 *   每个片段：lines（给用户看的代码行）｜prog（语句序列，**一行恰好一条语句**）｜
 *            freq（行号 → 频度表达式，给用户看，并被冒烟脚本机器复核）｜fx（同一条公式的可执行版本）
 *   ⚠ freq 与 fx 是**同一条公式的两份写法**：冒烟脚本用独立的小转换器把 freq 串求值，
 *     与 fx、与解释器的实测次数三方对齐 —— 这正是 §3.8-6"自己写的文案也是断言"的落地。
 * ------------------------------------------------------------------ */
const _cxSnips = [
  {
    id: 'seq',
    name: '单层循环求和（顺序语句 + 一层循环）',
    order: 'O(n)',
    lines: ['s = 0;', 'for (i = 1; i <= n; i++)', '    s = s + i;', 'return s;'],
    freq: { 1: '1', 2: 'n+1', 3: 'n', 4: '1' },
    fx: { 1: () => 1, 2: n => n + 1, 3: n => n, 4: () => 1 },
    why: { 1: '顺序语句只执行一次', 2: '判断 n 次成立 + 最后 1 次不成立', 3: '循环体执行 n 次（基本操作）', 4: '返回一次' },
    prog: [
      { k: 'set', line: 1, name: 's', expr: 0 },
      { k: 'for', line: 2, v: 'i', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
        { k: 'add', line: 3, name: 's', expr: 'i' }] },
      { k: 'ret', line: 4 },
    ],
  },
  {
    id: 'nest',
    name: '双层嵌套循环（内层跑满 n 次）',
    order: 'O(n²)',
    lines: ['s = 0;', 'for (i = 1; i <= n; i++)', '    for (j = 1; j <= n; j++)', '        s = s + i * j;', 'return s;'],
    freq: { 1: '1', 2: 'n+1', 3: 'n*(n+1)', 4: 'n*n', 5: '1' },
    fx: { 1: () => 1, 2: n => n + 1, 3: n => n * (n + 1), 4: n => n * n, 5: () => 1 },
    why: { 1: '顺序语句一次', 2: '外层判断 n+1 次', 3: '内层循环头：每次外层进来判断 n+1 次，共 n 次', 4: '内层循环体 n×n 次', 5: '返回一次' },
    prog: [
      { k: 'set', line: 1, name: 's', expr: 0 },
      { k: 'for', line: 2, v: 'i', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
        { k: 'for', line: 3, v: 'j', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
          { k: 'add', line: 4, name: 's', expr: 'i*j' }] }] },
      { k: 'ret', line: 5 },
    ],
  },
  {
    id: 'tri',
    name: '三角形内层（内层只跑 i 次）',
    order: 'O(n²)',
    lines: ['s = 0;', 'for (i = 1; i <= n; i++)', '    for (j = 1; j <= i; j++)', '        s = s + 1;', 'return s;'],
    freq: { 1: '1', 2: 'n+1', 3: 'n*(n+1)/2 + n', 4: 'n*(n+1)/2', 5: '1' },
    fx: { 1: () => 1, 2: n => n + 1, 3: n => n * (n + 1) / 2 + n, 4: n => n * (n + 1) / 2, 5: () => 1 },
    why: { 1: '顺序语句一次', 2: '外层判断 n+1 次', 3: '内层循环头：(i+1) 对 i 求和 = n(n+1)/2 + n', 4: '内层循环体：Σi = n(n+1)/2', 5: '返回一次' },
    prog: [
      { k: 'set', line: 1, name: 's', expr: 0 },
      { k: 'for', line: 2, v: 'i', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
        { k: 'for', line: 3, v: 'j', from: 1, cond: { op: '<=', rhs: 'i' }, step: { add: 1 }, body: [
          { k: 'add', line: 4, name: 's', expr: 1 }] }] },
      { k: 'ret', line: 5 },
    ],
  },
  {
    id: 'half',
    name: '2011-1 型：while 里 i 每次乘 2（倍增）',
    order: 'O(log₂n)',
    lines: ['i = 2;', 'while (i <= n)', '    i = i * 2;', 'return i;'],
    freq: { 1: '1', 2: '⌊log₂n⌋+1', 3: '⌊log₂n⌋', 4: '1' },
    fx: { 1: () => 1, 2: n => Math.max(0, Math.floor(Math.log2(n))) + 1, 3: n => Math.max(0, Math.floor(Math.log2(n))), 4: () => 1 },
    why: { 1: 'i 初值 2', 2: '判断成立 ⌊log₂n⌋ 次 + 最后 1 次不成立', 3: '循环体：i 依次 2,4,8… 共 ⌊log₂n⌋ 次', 4: '返回一次' },
    prog: [
      { k: 'set', line: 1, name: 'i', expr: 2 },
      { k: 'while', line: 2, cond: { lhs: 'i', op: '<=', rhs: 'n' }, body: [
        { k: 'set', line: 3, name: 'i', expr: 'i*2' }] },
      { k: 'ret', line: 4 },
    ],
  },
  {
    id: 'twice',
    name: '2014-1 型：外层倍增 × 内层跑满 n（n log n）',
    order: 'O(n log₂n)',
    lines: ['count = 0;', 'for (k = 1; k <= n; k = k * 2)', '    for (j = 1; j <= n; j++)', '        count = count + 1;', 'return count;'],
    freq: { 1: '1', 2: '⌊log₂n⌋+2', 3: '(⌊log₂n⌋+1)*(n+1)', 4: '(⌊log₂n⌋+1)*n', 5: '1' },
    fx: {
      1: () => 1, 2: n => Math.floor(Math.log2(n)) + 2,
      3: n => (Math.floor(Math.log2(n)) + 1) * (n + 1),
      4: n => (Math.floor(Math.log2(n)) + 1) * n, 5: () => 1,
    },
    why: { 1: '顺序语句一次', 2: '外层判断：⌊log₂n⌋ 次成立 + 1 次不成立', 3: '内层循环头：每层 n+1 次，共 ⌊log₂n⌋+1 层', 4: '内层循环体：每层 n 次', 5: '返回一次' },
    prog: [
      { k: 'set', line: 1, name: 'count', expr: 0 },
      { k: 'for', line: 2, v: 'k', from: 1, cond: { op: '<=', rhs: 'n' }, step: { mul: 2 }, body: [
        { k: 'for', line: 3, v: 'j', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
          { k: 'add', line: 4, name: 'count', expr: 1 }] }] },
      { k: 'ret', line: 5 },
    ],
  },
  {
    id: 'sqrt',
    name: '2017-1 型：while 里 sum += ++i（等差累加 ⟹ √n）',
    order: 'O(√n)',
    lines: ['i = 0;', 'sum = 0;', 'while (sum < n)', '    sum += ++i;', 'return i;'],
    freq: { 1: '1', 2: '1', 3: '⌈(√(8*n+1)-1)/2⌉+1', 4: '⌈(√(8*n+1)-1)/2⌉', 5: '1' },
    fx: {
      1: () => 1, 2: () => 1,
      3: n => Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2) + 1,
      4: n => Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2), 5: () => 1,
    },
    why: { 1: 'i 初值 0', 2: 'sum 初值 0', 3: '循环 k 次后 sum = k(k+1)/2，故 k = ⌈(√(8n+1)−1)/2⌉', 4: '循环体 k 次（一次加法 + 一次自增）', 5: '返回 i = k' },
    prog: [
      { k: 'set', line: 1, name: 'i', expr: 0 },
      { k: 'set', line: 2, name: 'sum', expr: 0 },
      { k: 'while', line: 3, cond: { lhs: 'sum', op: '<', rhs: 'n' }, body: [
        { k: 'addpre', line: 4, name: 'sum', v: 'i' }] },
      { k: 'ret', line: 5 },
    ],
  },
  {
    id: 'add',
    name: '两段循环相加（考"只留最高阶"）',
    order: 'O(n²)',
    lines: ['s = 0;', 'for (i = 1; i <= n; i++)', '    s = s + i;', 'for (j = 1; j <= n; j++)', '    for (k = 1; k <= n; k++)', '        s = s + 1;', 'return s;'],
    freq: { 1: '1', 2: 'n+1', 3: 'n', 4: 'n+1', 5: 'n*(n+1)', 6: 'n*n', 7: '1' },
    fx: { 1: () => 1, 2: n => n + 1, 3: n => n, 4: n => n + 1, 5: n => n * (n + 1), 6: n => n * n, 7: () => 1 },
    why: { 1: '顺序语句一次', 2: '第一段的循环头', 3: '第一段是 O(n)', 4: '第二段的循环头', 5: '第二段内层头（O(n²)）', 6: '第二段内层体（O(n²)）', 7: '返回一次' },
    prog: [
      { k: 'set', line: 1, name: 's', expr: 0 },
      { k: 'for', line: 2, v: 'i', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
        { k: 'add', line: 3, name: 's', expr: 'i' }] },
      { k: 'for', line: 4, v: 'j', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
        { k: 'for', line: 5, v: 'k', from: 1, cond: { op: '<=', rhs: 'n' }, step: { add: 1 }, body: [
          { k: 'add', line: 6, name: 's', expr: 1 }] }] },
      { k: 'ret', line: 7 },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * 第三部分：模式②的 4 个递归式（逐层展开）
 *   split: 'half' 每个子问题拆成 ⌊m/2⌋ 与 ⌈m/2⌉ 两个（规模之和守恒）｜'minus' 拆成 child 个 m−1
 *   cost:  'size' 该层每个子问题的代价 = 它的规模（递推式里的 +n）｜'one' 代价 = 1（+1）
 *   逐层只维护 (count, sumSizes, sizeMax) —— **不需要数组**，n 大时也不会爆内存（窗30 设计）。
 * ------------------------------------------------------------------ */
const _cxRecs = [
  { id: 'tn1', name: 'T(n) = T(n−1) + 1', order: 'O(n)', split: 'minus', child: 1, cost: 'one',
    note: '每层只有 1 个子问题、代价 1，共 n 层 ⟹ 1 × n' },
  { id: 'tnn', name: 'T(n) = T(n−1) + n', order: 'O(n²)', split: 'minus', child: 1, cost: 'size',
    note: '每层子问题规模等于层代价，层代价 n, n−1, … 等差求和' },
  { id: 'thalf', name: 'T(n) = 2T(n/2) + n', order: 'O(n log₂n)', split: 'half', child: 2, cost: 'size',
    note: '每层子问题规模之和恒为 n，共 ⌈log₂n⌉+1 层 ⟹ n × 层数' },
  { id: 't2n1', name: 'T(n) = 2T(n−1) + 1', order: 'O(2ⁿ)', split: 'minus', child: 2, cost: 'one',
    note: '子问题个数逐层翻倍（1,2,4,8…）⟹ 合计 2ⁿ−1' },
];

/* 逐层展开：返回 [{ k, count, sumSizes, sizeMax, cost, cum }]（k 从 0 起）
   ⚠ 守卫 `k < 1024` **只防"递归式定义写坏导致死循环"**，不许当成业务上限：
   窗30 冒烟实测踩过——第一版写的是 `k < 64`，而量级判定的样本取到 **n = 128**，
   于是 128 层被**静默截成 65 层**，f(128) 从 128 变成 65、从 2¹²⁸−1 变成 2⁶⁵ ⟹
   `T(n−1)+1` 与 `2T(n−1)+1` 两个递归式被判成"（未判定）"。
   **教训：给"防死循环"的守卫设上限时，先确认它高于所有合法输入的上界**（§3.8-17 同源）。 */
function _cxLayers(rec, n) {
  const out = [];
  let count = 1, sumSizes = n, sizeMax = n, cum = 0, k = 0;
  while (sizeMax > 1 && k < 1024) {
    const cost = rec.cost === 'size' ? sumSizes : count;
    cum += cost;
    out.push({ k, count, sumSizes, sizeMax, cost, cum });
    const prevCount = count;
    if (rec.split === 'half') {
      count = count * 2;
      sizeMax = Math.ceil(sizeMax / 2);
      /* sumSizes 守恒：⌊m/2⌋+⌈m/2⌉ = m */
    } else {
      count = count * rec.child;
      sumSizes = rec.child * (sumSizes - prevCount);   /* 每个 m ⟹ child 个 (m−1) */
      sizeMax = sizeMax - 1;
    }
    k++;
  }
  /* 最后一层：所有子问题规模为 1（基本情况，本身还有一次代价） */
  const cost = rec.cost === 'size' ? sumSizes : count;
  cum += cost;
  out.push({ k, count, sumSizes, sizeMax, cost, cum });
  return out;
}

/* ------------------------------------------------------------------ *
 * 第四部分：量级判定（机器算，不写死）
 *   candidates 从小到大；对每个候选 g 取 n 的**大样本**算比值 f(n)/g(n)，
 *   **第一个"比值有界"（极差 max/min ≤ 1.6）的 g 就是答案**。
 *   ⚠ 为什么样本要取到 4096（**窗30 实测，不是推测**）：n ≤ 16 时 √n 与 log₂n 的比值都很平，
 *     极差只有 1.41 / 2.00 ⟹ 离阈值 1.6 只剩 1.13 / 1.25 倍余量，判据近乎"蒙对"；
 *     取到 4096 后 √n 极差 1.38（接受余量 1.16）、log₂n 极差 3.88（**拒绝**余量 2.42）⟹
 *     拒绝余量拉开**近 2 倍**。冒烟脚本用"两套样本的余量对比"给这条判据本身做自测（§3.8-17）。
 * ------------------------------------------------------------------ */
const _cxBases = [
  { name: '1', fx: () => 1 },
  { name: 'log₂n', fx: n => Math.log2(n) },
  { name: '√n', fx: n => Math.sqrt(n) },
  { name: 'n', fx: n => n },
  { name: 'n log₂n', fx: n => n * Math.log2(n) },
  { name: 'n²', fx: n => n * n },
  { name: 'n³', fx: n => n * n * n },
  { name: '2ⁿ', fx: n => Math.pow(2, n) },
];
function _cxFit(fOf, samples) {
  const rows = [];
  for (const b of _cxBases) {
    const ratios = samples.map(m => fOf(m) / b.fx(m));
    const lo = Math.min.apply(null, ratios), hi = Math.max.apply(null, ratios);
    const stable = lo > 0 && hi / lo <= 1.6;
    rows.push({ name: b.name, ratios, stable });
    if (stable) return { order: b.name, index: rows.length - 1, rows };
  }
  return { order: '（未判定）', index: -1, rows };
}
const _cxASamples = [16, 64, 256, 1024, 4096];        /* 模式①：表达式求值，取大样本 */
const _cxRSamples = [8, 16, 32, 64, 128];             /* 模式②：逐层展开，2ⁿ 不许再大 */

/* ------------------------------------------------------------------ *
 * 第五部分：模式①的解释器（逐语句执行 → 每执行一行产出一帧）
 *   循环头的计数口径：**判断一次算一次**（成立 n 次 + 不成立 1 次 = n+1）
 * ------------------------------------------------------------------ */
function _cxRun(prog, n, buildFrames) {
  const counts = {}, vars = { n };
  const frames = [];
  let total = 0, truncated = false;
  const MAXF = 1200;

  const emit = (line, extra) => {
    total++;
    counts[line] = (counts[line] || 0) + 1;
    if (!buildFrames) return;
    if (frames.length >= MAXF) { truncated = true; return; }
    const o = { line, counts: Object.assign({}, counts), vars: Object.assign({}, vars), total };
    if (extra) for (const k in extra) o[k] = extra[k];
    frames.push(o);
  };
  const test = c => {
    const a = vars[c.lhs !== undefined ? c.lhs : c.v] || 0;
    const b = _cxEval(c.rhs, vars);
    return c.op === '<=' ? a <= b : c.op === '<' ? a < b : c.op === '>=' ? a >= b : c.op === '>' ? a > b : false;
  };
  function exec(list) {
    for (let idx = 0; idx < list.length; idx++) {
      const st = list[idx];
      if (st.k === 'set') {
        vars[st.name] = _cxEval(st.expr, vars);
        emit(st.line, { note: st.name + ' = ' + vars[st.name], code: st.line });
      } else if (st.k === 'add') {
        vars[st.name] = (vars[st.name] || 0) + _cxEval(st.expr, vars);
        emit(st.line, { note: st.name + ' = ' + vars[st.name], code: st.line });
      } else if (st.k === 'addpre') {
        vars[st.v] = (vars[st.v] || 0) + 1;
        vars[st.name] = (vars[st.name] || 0) + vars[st.v];
        emit(st.line, { note: '++' + st.v + ' ⟹ ' + st.v + ' = ' + vars[st.v] + '，' + st.name + ' = ' + vars[st.name], code: st.line });
      } else if (st.k === 'ret') {
        emit(st.line, { note: '返回', code: st.line, ret: true });
      } else if (st.k === 'for') {
        vars[st.v] = _cxEval(st.from, vars);
        for (;;) {
          const okv = test({ lhs: st.v, op: st.cond.op, rhs: st.cond.rhs });
          emit(st.line, {
            cond: okv, code: st.line,
            note: '判断 ' + st.v + ' ' + st.cond.op + ' ' + st.cond.rhs + ' → ' + (okv ? '成立（' + st.v + ' = ' + vars[st.v] + '）' : '不成立（' + st.v + ' = ' + vars[st.v] + '），退出循环'),
          });
          if (!okv) break;
          exec(st.body);
          if (st.step.mul) vars[st.v] = vars[st.v] * st.step.mul;
          else vars[st.v] = vars[st.v] + (st.step.add || 1);
        }
      } else if (st.k === 'while') {
        for (;;) {
          const okv = test(st.cond);
          emit(st.line, {
            cond: okv, code: st.line,
            note: '判断 ' + st.cond.lhs + ' ' + st.cond.op + ' ' + st.cond.rhs + ' → ' + (okv ? '成立（' + st.cond.lhs + ' = ' + (vars[st.cond.lhs] || 0) + '）' : '不成立，退出循环'),
          });
          if (!okv) break;
          exec(st.body);
        }
      }
    }
  }
  exec(prog);
  return { counts, vars, total, frames, truncated };
}

/* 各片段由 freq 表达式求和得到的 F(n)（据此判量级） */
function _cxSumFx(snip, n) {
  let s = 0;
  Object.keys(snip.fx).forEach(ln => { s += snip.fx[ln](n); });
  return s;
}

RC408.registerModule({
  id: 'ds-complexity',
  mode: 'stepper',
  title: '算法时间复杂度分析（逐行执行次数 → 量级判定）',

  theory: `
> **为什么要有它**：同一道题换一种写法，跑的步数可能差出一个数量级；而机器快慢、常数大小都会变——**时间复杂度**就是把这些都剥掉，只留"执行次数随规模 n 增长的量级"，让算法之间可比。408 第一章就考它，后面查找、排序、图的每一节又都在用它。
> **怎么实现（考试口径的三步）**：① 数**基本操作**的执行次数，写成 n 的函数 f(n)（**循环头按判断次数计**：\\(i=1;i\\le n;i++\\) 是 n+1 次）；② **只留最高阶项**，去掉系数与常数；③ 写成 O(·)：f(n) = 2n²+2n+3 ⟹ O(n²)。
> **记住什么**：四条现成的频度结论（单层 n、双层 n²、三角形 n(n+1)/2 仍是 n²、倍增 ⌊log₂n⌋+1）＋ **递归式展开法**（每层代价 × 层数）。

## 关键机制（频度 → 量级）
| 代码形态 | 该行的频度 f(n) | 量级 |
| --- | --- | --- |
| 顺序语句 | 1 | O(1) |
| \\(for(i=1;i\\le n;i++)\\) | n+1（n 次成立 + 1 次不成立） | O(n) |
| 双层内层跑满 n | n² | O(n²) |
| 三角形内层 \\(j\\le i\\) | n(n+1)/2（仍是 n²） | O(n²) |
| \\(while\\) 里 \\(i=i*2\\) 或 \\(i=i/2\\) | ⌊log₂n⌋+1 | O(log₂n) |
| 外层 n × 内层倍增 | n·(⌊log₂n⌋+1) | O(n log₂n) |
| \\(sum += ++i\\) 累加到 n（2017-1） | ⌈(√(8n+1)−1)/2⌉ | O(√n) |
| 两段循环相加 | 取**最高阶**那段（O(n²)+O(n) = O(n²)） | O(n²) |

**递归式展开（第二个模式）**：
| 递推式 | 每层代价 | 层数 | 合计 T(n) |
| --- | --- | --- | --- |
| T(n) = T(n−1) + 1 | 1 | n | n ⟹ O(n) |
| T(n) = T(n−1) + n | n, n−1, … | n | n(n+1)/2 ⟹ O(n²) |
| T(n) = 2T(n/2) + n | 恒为 n | ⌈log₂n⌉+1 | n·层数 ⟹ O(n log₂n) |
| T(n) = 2T(n−1) + 1 | 1, 2, 4, … | n | 2ⁿ−1 ⟹ O(2ⁿ) |

**判定口径（本模块的机器判定，可核对）**：把各行的频度表达式在 n = 16/64/256/1024/4096 处求和，与 8 个候选量级逐一比比值，**第一个"比值不再增长"的量级就是答案**（判据：极差 ≤ 1.6）。

## 考点提醒（易错点）
1. **循环头算 n+1 次**（判断多一次），写成 n 次是最常见的丢分点。
2. **加法取最大**：O(n²) + O(n) = O(n²)，不是 O(n³)；乘法才是相乘（嵌套循环相乘）。
3. **三角形内层 Σi = n(n+1)/2 仍然是 O(n²)**——别看到 1/2 就往 O(n log n) 上想。
4. **倍增/折半是 log**：\\(i = i * 2\\)、\\(i = i / 2\\)、\\(k *= 2\\) 都让规模每层翻倍或减半 ⟹ O(log₂n)；不要把它当 O(n)。
5. **系数不管**：3n² 与 n²/100 都是 O(n²)；但 **n 与 log₂n 之间不能互相替代**（2012-1 就考这条）。
6. **2017-1 型要会算**：\\(sum += ++i\\) 循环 k 次后 sum = k(k+1)/2，由 k(k+1)/2 ≈ n 得 k ≈ √(2n) ⟹ O(√n)，不是 O(n) 也不是 O(log n)。
7. **递归式先算层数再看每层代价**：2T(n/2) 的子问题个数逐层翻倍但**每层规模之和恒为 n**；2T(n−1) 才是代价自身翻倍。
8. 题目不说"最好/平均"时，408 问的是**最坏情况**。

> **真题考情**：**8/18 年（全为选择题，且都是当年第 1 题）**：2011-1（while 倍增）、2012-1（递归式）、2014-1（外层倍增 × 内层 n）、2017-1（sum += ++i ⟹ √n）、2019-1、2022-1、2023-1（哪类操作平均 O(1)）、2025-1。
> ⚠ 2013-1（两升序链表合并的复杂度）属同类题，但按"选择题归更专的知识点"归 ds-seqlist（顺序 vs 链式的代价辨析），本条目不重复登记。
`,

  /* ---------------- 输入表单（★ 每项都必须有 default，§3.8-11） ---------------- */
  inputs: [
    { key: 'kind', label: '演示模式', type: 'select', default: 'code',
      options: [{ v: 'code', t: '① 代码逐行计数（数基本操作次数 → 判量级）' },
        { v: 'rec', t: '② 递归式逐层展开（每层代价 × 层数）' }],
      help: '选择题的两大题型：给代码段求复杂度 / 给递归式求复杂度' },
    { key: 'snip', label: '代码片段（模式①）', type: 'select', default: 'seq',
      options: _cxSnips.map(s => ({ v: s.id, t: s.name + ' ⟹ ' + s.order })),
      help: '其中 half / twice / sqrt 三个就是 2011-1 / 2014-1 / 2017-1 的真题结构' },
    { key: 'rec', label: '递归式（模式②）', type: 'select', default: 'thalf',
      options: _cxRecs.map(r => ({ v: r.id, t: r.name + ' ⟹ ' + r.order })),
      help: '逐层看"本层几个子问题、每个多大、本层代价多少"' },
    { key: 'n', label: '问题规模 n', type: 'range', min: 1, max: 12, step: 1, default: 8,
      help: '模式①的循环上限 / 模式②的初始规模；调大 n 看帧数怎么涨' },
  ],

  quickActions: [
    { label: '2011-1 真题（while 倍增 ⟹ O(log₂n)）', run(rt) {
        rt.setInput('kind', 'code'); rt.setInput('snip', 'half'); rt.setInput('n', 8); rt.load();
      } },
    { label: '2014-1 真题（倍增 × n ⟹ O(n log₂n)）', run(rt) {
        rt.setInput('kind', 'code'); rt.setInput('snip', 'twice'); rt.setInput('n', 8); rt.load();
      } },
    { label: '2017-1 真题（sum += ++i ⟹ O(√n)）', run(rt) {
        rt.setInput('kind', 'code'); rt.setInput('snip', 'sqrt'); rt.setInput('n', 12); rt.load();
      } },
    { label: '三角形内层（Σi 仍是 O(n²)）', run(rt) {
        rt.setInput('kind', 'code'); rt.setInput('snip', 'tri'); rt.setInput('n', 6); rt.load();
      } },
    { label: '两段循环相加（只留最高阶）', run(rt) {
        rt.setInput('kind', 'code'); rt.setInput('snip', 'add'); rt.setInput('n', 6); rt.load();
      } },
    { label: '递归式 T(n) = 2T(n/2) + n', run(rt) {
        rt.setInput('kind', 'rec'); rt.setInput('rec', 'thalf'); rt.setInput('n', 8); rt.load();
      } },
    { label: '🎲 随机片段 + 随机 n', run(rt) {
        const s = _cxSnips[RC408.util.rnd(0, _cxSnips.length - 1)];
        const kind = RC408.util.rnd(0, 2) === 0 ? 'code' : 'rec';
        rt.setInput('kind', kind);
        if (kind === 'code') rt.setInput('snip', s.id);
        else rt.setInput('rec', _cxRecs[RC408.util.rnd(0, _cxRecs.length - 1)].id);
        rt.setInput('n', RC408.util.rnd(4, 12));
        rt.load();
      } },
  ],

  /* ---------------- ① 解析输入 + 把"量级判定"一次算好（帧无关的量放 model） ---------------- */
  parse(vals) {
    const kind = vals.kind === 'rec' ? 'rec' : 'code';
    const n = parseInt(vals.n, 10);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw { message: '规模 n 只支持 1 ~ 12 的整数' };

    if (kind === 'code') {
      const snip = _cxSnips.filter(s => s.id === vals.snip)[0];
      if (!snip) throw { message: '代码片段 id 不存在：' + String(vals.snip) };
      /* 帧数上限保护：先空跑一遍拿总帧数（mode① 的 total 就是语句执行次数） */
      const probe = _cxRun(snip.prog, n, false);
      if (probe.total > 1200) throw { message: '这个片段在 n = ' + n + ' 时要执行 ' + probe.total + ' 条语句，帧太多（上限 1200）；请把 n 调小' };
      /* 增长表（实测，不是抄的）：n = 4 / 8 / 16 的真实执行次数 */
      const growth = [4, 8, 16].map(m => ({ m, f: _cxRun(snip.prog, m, false).total }));
      /* 量级判定：用已复核过的频度表达式在大样本处求和 */
      const fit = _cxFit(m => _cxSumFx(snip, m), _cxASamples);
      return { kind, n, snip, growth, fit, snipId: snip.id };
    }

    const rec = _cxRecs.filter(r => r.id === vals.rec)[0];
    if (!rec) throw { message: '递归式 id 不存在：' + String(vals.rec) };
    const layers = _cxLayers(rec, n);
    if (layers.length > 40) throw { message: '该递归式在 n = ' + n + ' 时层数太多（' + layers.length + ' 层），请把 n 调小' };
    const fOf = m => { const L = _cxLayers(rec, m); return L[L.length - 1].cum; };
    const growth = [4, 8, 16].map(m => ({ m, f: fOf(m) }));
    const fit = _cxFit(fOf, _cxRSamples);
    return { kind, n, rec, layers, growth, fit, recId: rec.id };
  },

  /* ---------------- ② 纯算法：产出全部快照 ---------------- */
  buildSnapshots(model) {
    const { kind, n } = model;
    const snaps = [];
    const push = (step, o) => snaps.push(Object.assign({ kind, n, step, log: '', logType: 'info', desc: '' }, o));

    if (kind === 'code') {
      const snip = model.snip;
      const res = _cxRun(snip.prog, n, true);
      push('init', {
        line: -1, counts: {}, vars: { n }, total: 0, note: '',
        desc: '就绪：' + snip.lines.length + ' 行代码，n = ' + n + ' —— 点「单步执行」逐行数次数',
        log: '演示「' + snip.name + '」：n = ' + n + '。每执行一行（或判断一次循环条件）算一次基本操作，右侧累计 f(n)。',
      });
      res.frames.forEach(f => {
        const txt = snip.lines[f.line - 1].trim();
        push('exec', {
          line: f.line, counts: f.counts, vars: f.vars, total: f.total, note: f.note,
          cond: f.cond, ret: f.ret,
          desc: '第 ' + f.line + ' 行 · ' + (f.cond === undefined ? txt : (f.note.indexOf('不成立') >= 0 ? '判断不成立，退出循环' : '判断成立，进入循环体')),
          log: '第 ' + f.line + ' 行：' + f.note,
        });
      });
      if (res.truncated) {
        push('done', { line: -1, counts: res.counts, vars: res.vars, total: res.total, note: '',
          desc: '（本片段帧数超过上限，只演示了前 1200 步）', logType: 'warn',
          log: '帧数超过上限，已截断；请把 n 调小。' });
        return snaps;
      }
      push('done', {
        line: -1, counts: res.counts, vars: res.vars, total: res.total, note: '',
        logType: 'success',
        desc: '执行完毕：f(n) = ' + res.total + ' 次（n = ' + n + '）⟹ ' + snip.order,
        log: '完毕：共执行 ' + res.total + ' 次基本操作，只留最高阶、去掉系数 ⟹ ' + snip.order + '（机器判定：' + model.fit.order + '）',
      });
      return snaps;
    }

    /* 模式②：逐层展开 */
    const rec = model.rec;
    push('init', {
      layer: -1, count: 1, sumSizes: n, sizeMax: n, layerCost: 0, cum: 0,
      desc: '就绪：' + rec.name + '，初始规模 n = ' + n + ' —— 点「单步执行」逐层展开',
      log: '逐层展开 ' + rec.name + '：' + rec.note,
    });
    model.layers.forEach(L => {
      push('rec', {
        layer: L.k, count: L.count, sumSizes: L.sumSizes, sizeMax: L.sizeMax, layerCost: L.cost, cum: L.cum,
        desc: '第 ' + L.k + ' 层：' + L.count + ' 个子问题（最大规模 ' + L.sizeMax + '），本层代价 ' + L.cost,
        log: '第 ' + L.k + ' 层：子问题个数 ' + L.count + '、规模之和 ' + L.sumSizes + '、最大规模 ' + L.sizeMax
          + ' ⟹ 本层代价 ' + L.cost + '，累计 T(n) = ' + L.cum,
      });
    });
    const last = model.layers[model.layers.length - 1];
    push('done', {
      layer: last.k, count: last.count, sumSizes: last.sumSizes, sizeMax: last.sizeMax,
      layerCost: last.cost, cum: last.cum, logType: 'success',
      desc: '展开完毕：共 ' + model.layers.length + ' 层，T(n) = ' + last.cum + ' ⟹ ' + rec.order,
      log: '完毕：' + model.layers.length + ' 层累加得 T(n) = ' + last.cum + ' ⟹ ' + rec.order + '（机器判定：' + model.fit.order + '）',
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照） ----------------
   * ⚠ 布局走**内联 style**（display:flex / gap）而不靠 Tailwind 工具类：离线 harness 不加载
   *   Tailwind CDN，工具类全部失效会让"槽位竖成一列"，几何断言与截图就失去依据（窗25/26 同一个坑）。 */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const n = s.n;
    const esc = RC408.util.esc;
    const chip = (txt, color, bg) => '<span style="display:inline-block;font:700 11px Consolas,monospace;padding:2px 7px;border-radius:6px;' +
      'border:1px solid ' + color + '33;background:' + bg + ';color:' + color + '">' + esc(txt) + '</span>';

    /* ---------- 模式①：代码逐行计数 ---------- */
    if (s.kind === 'code') {
      const snip = model.snip;
      const counts = s.counts || {};
      const total = s.total || 0;

      /* 代码区：行号 + 代码 + 本行已执行次数（当前行高亮） */
      const codeRows = snip.lines.map((txt, i) => {
        const no = i + 1;
        const cur = s.line === no;
        const c = counts[no] || 0;
        const isLoop = /\b(for|while)\b/.test(txt);
        return '<div class="cx-line" data-line="' + no + '" style="display:flex;align-items:baseline;gap:8px;padding:3px 8px;border-radius:7px;' +
          'background:' + (cur ? '#eef2ff' : 'transparent') + ';border:1px solid ' + (cur ? '#6366f1' : 'transparent') + '">' +
          '<span style="font:700 11px Consolas,monospace;color:' + (cur ? '#4338ca' : '#cbd5e1') + ';min-width:16px;text-align:right">' + no + '</span>' +
          '<code class="cx-code" style="font:600 12.5px Consolas,monospace;color:' + (cur ? '#312e81' : '#334155') + ';flex:1;white-space:pre">' + esc(txt) + '</code>' +
          '<span class="cx-freq" style="font:700 11px Consolas,monospace;color:' + (c ? '#0f766e' : '#cbd5e1') + ';white-space:nowrap">' +
          (isLoop ? '判断 ' : '执行 ') + c + ' 次</span>' +
          '</div>';
      }).join('');

      /* 频度表：行 | 语句 | 本帧实测 | 频度表达式 | 说明 */
      const freqRows = snip.lines.map((txt, i) => {
        const no = i + 1;
        const cur = s.line === no;
        return '<tr class="' + (cur ? 'row-cur' : '') + ' cx-frow" data-line="' + no + '">' +
          '<td class="font-bold">' + no + '</td>' +
          '<td class="font-mono text-xs">' + esc(txt.trim()) + '</td>' +
          '<td class="font-mono font-bold">' + (counts[no] || 0) + '</td>' +
          '<td class="font-mono">' + esc(snip.freq[no]) + '</td>' +
          '<td class="text-xs">' + esc(snip.why[no]) + '</td></tr>';
      }).join('');

      /* 增长表：n 翻倍时 f(n) 变几倍（实测）
         ⚠ 这一列**只描述"实测倍数"，不写量级名**：窗30 目视截图时抓到——`sqrt` 片段（O(√n)）的
         4→8 / 8→16 实测 ×1.20 / ×1.33，旧文案按"接近 1 倍"写成「对数级」，**把 √n 说成了 log n**
         （§3.8-6：自己写的文案也是断言）。√2 ≈ 1.414 与 log₂ 的"n 翻倍 +1 层"在小 n 处本来就难分，
         所以这里只给倍数与"比 2 倍快/慢"的事实，**量级一律以右边那张判定表为准**。 */
      const g = model.growth;
      const growthRows = g.map((x, i) => {
        const prev = i ? g[i - 1] : null;
        const times = prev ? (x.f / prev.f) : null;
        return '<tr><td class="font-mono font-bold">' + x.m + '</td><td class="font-mono">' + x.f + '</td>' +
          '<td class="font-mono">' + (times === null ? '—' : '× ' + times.toFixed(2)) + '</td>' +
          '<td class="text-xs text-slate-500">' + (times === null ? '基准'
            : times > 2.8 ? 'n 翻倍 ⟹ 代价约 4 倍（乘法规则：嵌套循环）'
              : times > 1.7 ? 'n 翻倍 ⟹ 代价约 2 倍（线性及以上）'
                : times > 1.15 ? 'n 翻倍 ⟹ 代价涨得比 1 倍快、比 2 倍慢（次线性）'
                  : 'n 翻倍 ⟹ 代价几乎不变（次线性）') + '</td></tr>';
      }).join('');

      /* 量级判定表：候选量级 × 大样本比值 */
      const fitRows = model.fit.rows.map((r, i) => {
        const cells = r.ratios.map(x => '<td class="font-mono">' + (x >= 1000 ? x.toExponential(1) : x.toFixed(2)) + '</td>').join('');
        return '<tr class="' + (i === model.fit.index ? 'row-hit' : '') + ' cx-ratio">' +
          '<td class="font-mono font-bold">' + r.name + '</td>' + cells +
          '<td>' + (r.stable ? '✔ 有界 ⟹ 就是这个量级' : '✘ 比值还在涨 ⟹ 太小') + '</td></tr>';
      }).join('');

      /* ⚠ 机器判定的量级名带 O(·) 才能与片段标称值直接比字符串：
         窗30 冒烟实测踩过——fit.order 是 'n'（候选名），snip.order 是 'O(n)'，
         不补 O(·) 就会**永远显示"不一致"**（判据/显示两头都错）。 */
      const fitDisp = 'O(' + model.fit.order + ')';
      const stats =
        RC408.ui.statCard('累计执行 f(n)', total, 'n = ' + n, 'text-indigo-600') +
        RC408.ui.statCard('当前行', s.line < 1 ? '—' : '第 ' + s.line + ' 行', s.line < 1 ? '未开始' : esc((snip.lines[s.line - 1] || '').trim()), 'font-mono') +
        RC408.ui.statCard('本片段量级', snip.order, '机器判定：' + fitDisp, fitDisp === snip.order ? 'text-emerald-600' : 'text-rose-600') +
        RC408.ui.statCard('代码行数', snip.lines.length, '模式①：逐行计数', 'font-mono');

      stage.innerHTML = `
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

          <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
            ${RC408.ui.sectionTitle('代码（高亮行 = 本帧正在执行；右侧是本行已执行 / 已判断的次数）')}
            <div class="cx-codebox" style="display:flex;flex-direction:column;gap:2px">${codeRows}</div>
            <div class="mt-2 text-xs text-slate-500">f(n) = 各行执行次数之和 = <b>${total}</b>（n = ${n}）</div>
          </div>

          <div>
            ${RC408.ui.sectionTitle('频度表：把每行的次数写成 n 的函数（这才是考试要写的东西）')}
            <div class="overflow-x-auto rounded-xl border border-slate-200">
              <table class="tbl w-full cx-tbl"><thead><tr>
                <th>行</th><th>语句</th><th>本帧实测</th><th>频度 f\u1d62(n)</th><th>为什么</th>
              </tr></thead><tbody>${freqRows}</tbody></table>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              ${RC408.ui.sectionTitle('n 翻倍时 f(n) 怎么变（实测）')}
              <div class="rounded-xl border border-slate-200 overflow-hidden">
                <table class="tbl w-full cx-growth"><thead><tr><th>n</th><th>f(n)</th><th>倍数</th><th>读法</th></tr></thead>
                <tbody>${growthRows}</tbody></table>
              </div>
            </div>
            <div>
              ${RC408.ui.sectionTitle('量级判定：比值不再增长的那个就是答案')}
              <div class="rounded-xl border border-slate-200 overflow-hidden">
                <table class="tbl w-full"><thead><tr><th>候选</th>${_cxASamples.map(m => '<th>n=' + m + '</th>').join('')}<th>判据</th></tr></thead>
                <tbody>${fitRows}</tbody></table>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
            ${RC408.ui.legend('#6366f1', '本帧正在执行 / 正在判断的行')}
            ${RC408.ui.legend('#0f766e', '该行已执行的次数（循环头是"判断次数"）')}
            ${RC408.ui.legend('#10b981', '机器判定出的量级（与片段标称值一致才亮绿）')}
          </div>

          <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
            💡 <b>考点提醒：</b>循环头按<b>判断次数</b>计（n 次成立 + 1 次不成立 = n+1）；
            嵌套循环用<b>乘法</b>、并列循环用<b>加法且只留最高阶</b>；三角形内层的 n(n+1)/2 <b>仍然是 O(n²)</b>；
            系数一律去掉（3n² 与 n²/100 都是 O(n²)）。
          </div>
        </div>`;
      return;
    }

    /* ---------- 模式②：递归式逐层展开 ---------- */
    const rec = model.rec;
    const layers = model.layers;
    const cur = s.layer;
    const layerRows = layers.map(L => {
      const on = L.k === cur;
      const sizeTxt = rec.split === 'half'
        ? (L.k === 0 ? 'n = ' + L.sumSizes : '每个 ≈ n/' + Math.pow(2, L.k) + '（合计 ' + L.sumSizes + '）')
        : (L.sizeMax + '（合计 ' + L.sumSizes + '）');
      return '<tr class="' + (on ? 'row-cur' : '') + ' cx-rrow" data-layer="' + L.k + '">' +
        '<td class="font-bold">第 ' + L.k + ' 层</td>' +
        '<td class="font-mono">' + L.count + '</td>' +
        '<td class="font-mono">' + esc(sizeTxt) + '</td>' +
        '<td class="font-mono">' + L.cost + '</td>' +
        '<td class="font-mono font-bold">' + L.cum + '</td></tr>';
    }).join('');

    const g = model.growth;
    const growthRows = g.map((x, i) => {
      const prev = i ? g[i - 1] : null;
      const times = prev ? (x.f / prev.f) : null;
      return '<tr><td class="font-mono font-bold">' + x.m + '</td><td class="font-mono">' + x.f + '</td>' +
        '<td class="font-mono">' + (times === null ? '—' : '× ' + times.toFixed(2)) + '</td></tr>';
    }).join('');

    const fitRows = model.fit.rows.map((r, i) => {
      const cells = r.ratios.map(x => '<td class="font-mono">' + (x >= 1000 ? x.toExponential(1) : x.toFixed(3)) + '</td>').join('');
      return '<tr class="' + (i === model.fit.index ? 'row-hit' : '') + ' cx-ratio">' +
        '<td class="font-mono font-bold">' + r.name + '</td>' + cells +
        '<td>' + (r.stable ? '✔ 有界 ⟹ 就是这个量级' : '✘ 比值还在涨 ⟹ 太小') + '</td></tr>';
    }).join('');

    const fitDisp2 = 'O(' + model.fit.order + ')';
    const stats =
      RC408.ui.statCard('展开到第几层', cur < 0 ? '—' : '第 ' + cur + ' 层', '共 ' + layers.length + ' 层', 'text-indigo-600') +
      RC408.ui.statCard('本层子问题', s.count, '最大规模 ' + s.sizeMax, 'font-mono') +
      RC408.ui.statCard('本层代价', s.layerCost, '规模之和 ' + s.sumSizes, 'text-amber-600') +
      RC408.ui.statCard('累计 T(n)', s.cum, '递推式标称 ' + rec.order + '｜机器判定 ' + fitDisp2,
        fitDisp2 === rec.order ? 'text-emerald-600' : 'text-rose-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle('递推式：' + rec.name + '（n = ' + n + '）')}
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            ${chip('每层子问题个数 × 每个规模', '#4f46e5', '#eef2ff')}
            ${chip(rec.split === 'half' ? '规模之和守恒 = n' : '规模每层减 1', '#0f766e', '#ecfdf5')}
            ${chip(rec.cost === 'size' ? '本层代价 = 规模之和' : '本层代价 = 子问题个数', '#b45309', '#fffbeb')}
          </div>
          <div class="mt-2 text-xs text-slate-500">${esc(rec.note)}</div>
        </div>

        <div>
          ${RC408.ui.sectionTitle('逐层展开表：本层几个子问题 → 每个多大 → 本层代价 → 累计')}
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="tbl w-full cx-tbl"><thead><tr>
              <th>层</th><th>子问题个数</th><th>子问题规模</th><th>本层代价</th><th>累计 T(n)</th>
            </tr></thead><tbody>${layerRows}</tbody></table>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            ${RC408.ui.sectionTitle('n 翻倍时 T(n) 怎么变')}
            <div class="rounded-xl border border-slate-200 overflow-hidden">
              <table class="tbl w-full cx-growth"><thead><tr><th>n</th><th>T(n)</th><th>倍数</th></tr></thead>
              <tbody>${growthRows}</tbody></table>
            </div>
          </div>
          <div>
            ${RC408.ui.sectionTitle('量级判定：比值不再增长的那个就是答案')}
            <div class="rounded-xl border border-slate-200 overflow-hidden">
              <table class="tbl w-full"><thead><tr><th>候选</th>${_cxRSamples.map(m => '<th>n=' + m + '</th>').join('')}<th>判据</th></tr></thead>
              <tbody>${fitRows}</tbody></table>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#6366f1', '本帧正在展开的这一层')}
          ${RC408.ui.legend('#b45309', '本层代价合计（逐层累加得到 T(n)）')}
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>先看<b>层数</b>、再看<b>每层代价</b>。2T(n/2) 的子问题个数逐层翻倍，但<b>每层规模之和恒为 n</b>，
          共 ⌈log₂n⌉+1 层 ⟹ n log₂n；2T(n−1) 是<b>代价自身翻倍</b> ⟹ 指数级；T(n−1)+n 的层代价等差 ⟹ n(n+1)/2 = O(n²)。
        </div>
      </div>`;
  },
});
