'use strict';
/* ============================================================================
 * coa-shift.js —— 【计算机组成原理】数据的移位运算（逻辑 / 算术 / 循环）（前缀 _cs）
 * 模式：stepper（一次移一位 = 一帧；首帧 init、末帧 done）
 *
 * 考情（**窗47 从零核定**：`tools/exam_index.py --ask` 扫 考情缓存/、主线程逐条回原文复核，依据行号见下）：
 *   · 18 年中 **3 年 / 3 题（选 2 + 大题 1）**：
 *     2018-16（选，**直接考"空位到底补什么"**：逻辑移位左右都补 0、算术右移补符号位、算术左移补 0；2018_解析.txt:159-161）、
 *     2026-13（选，机器数 1010 0110B **算术右移 3 位再算术左移 2 位**求结果；2026_解析.txt:207-217）、
 *     2012-44（大，(1) 问算术右移求值、(4) 问用 SHL 实现 2x；2012_解析.txt:738-740 与 750-757。
 *     按 §2.0① 大题可在多处登记 —— 它现也挂在 `coa-assembly` / `coa-pipeline`，不是重复）。
 *     ⚠ 2026-13 在 `tools/exam_index.py` 的科目栏被标成「数据结构」，**科目标错了**（卷面 12~22 是组成原理），
 *     以卷面原文为准；题号取自 `2026_解析.txt:207` 的行首"13."，可靠。
 *   · **不登记（看着像移位、按 §2.0② 归更"专"的模块）**：2015-43（移位寄存器 SRop 位数 → coa-datapath）、
 *     2020-43（乘法 = 加法 + 移位 → coa-muldiv）、2024-15（二进制乘法拆成左移与加法 → coa-muldiv）、
 *     2024-43(3)（slli 的移位位数只用低 5 位 → coa-datapath）、2026-44(4)（ALUBsrc = shamt → coa-datapath）、
 *     2017-44(4)（shl 能否用于 float 的 *2 → coa-float754）、2014-44(2)（左移两位 = 乘 4 推数组间隔 → coa-assembly）、
 *     2009-13（浮点规格化右移 → **窗57 已改判"考纲外"**：自定补码格式、非 IEEE 754）、2010-42（数组循环左移，数据结构题）。
 *     ⚠ **2013-14 不登记在本条**：该题的落点是"**补码相加的结果与是否溢出**"（2013_解析.txt:181-183：
 *     "补码相加为 1 1101000 + 1 1011000 = 1 1000000, 亦无溢出"），算术左移 / 右移只是求 x*2、y/2 的**手段**
 *     ⟹ 按 §2.0② "选择题归更专的那个" **留在 `coa-fixadd`**（窗47 的裁决，见 §6.2.48）。
 *     另：**2026-13 是本窗从 `coa-fixadd` 改挂过来的**（全题无加减）。
 *
 * 数据模型（口径写死在代码里，避免后来者改错）：
 *   · 位串长度 N = **8 或 16**（`width` 可选；真题都是 8 位）；`bits[0]` 是**最高位 b(N−1)**、`bits[N−1]` 是 b0。
 *   · 一次"移位"只做**一位**：向左（高位方向）或向右（低位方向）。
 *   · 方向与补位的口径（**本模块的核心口径**，与 2018-16 的解析逐字对应）：
 *     - 逻辑左移 / 逻辑右移：空位一律**补 0**（所有位都参与移动）；
 *     - 算术右移：**符号位不参与移动**，空位**补符号位**；
 *     - 算术左移：空位**补 0**（与逻辑左移的位操作完全相同，差别只在"是否判溢出"）；
 *     - 循环左移 / 循环右移（不带进位）：**移出的位补回空位**（N 位环）；
 *     - 循环移位（带进位 CF）：把 CF 当作第 N+1 位，`CF` 与数据一起在 N+1 位环里转。
 *   · **CF 的口径**：无论哪种类型，**移出数据寄存器的那一位都写进 CF**（x86 的 SHL/SHR/ROL/ROR 都是这条）。
 *     带进位循环移位时 CF 还会作为输入参与——所以"带进位"与"不带进位"的差别就在这里。
 *   · 有符号值按**补码**解释；算术右移一位等价于"÷2 向负无穷取整"（floor），不是向零取整。
 *
 * 不变量（冒烟断言的对象，§3.8-1 "只写不变量"）：
 *   ① 首帧 init / 末帧 done；其余每帧恰好移**一位**（帧数 = k + k2）；
 *   ② 每帧"移位后"的 N 位由"移位前"逐位搬来 + **恰好 1 个空位**按补位口径填上（空位数守恒 = 1）；
 *   ③ 循环移位（不带进位）**1 的个数守恒**（只是环移，一位不多一位不少）；
 *   ④ 逻辑 / 算术移位：**移出的位若为 1 就是"丢了"**（进 CF，但数据里没了）；
 *   ⑤ 算术左移的溢出判据 = **移位前后符号位不同**；其余类型不按这条判溢出；
 *   ⑥ 每帧的位数组都是**新数组**（改第 k 帧不许污染第 k+1 帧，§1.3）；
 *   ⑦ 末帧结果必须等于**独立参考实现**（用 rotate / 整数移位公式另算一遍）的结果。
 * ========================================================================== */

/* 六种移位类型：dir = 数据往哪边移；fill = 空位补什么 */
const CS_OPS = {
  shl: { t: '逻辑左移', dir: 'l', fill: 'zero', tag: '逻辑左移（LSL）' },
  sal: { t: '算术左移', dir: 'l', fill: 'zero', tag: '算术左移（ASL）' },
  shr: { t: '逻辑右移', dir: 'r', fill: 'zero', tag: '逻辑右移（LSR）' },
  sar: { t: '算术右移', dir: 'r', fill: 'sign', tag: '算术右移（ASR）' },
  rol: { t: '循环左移', dir: 'l', fill: 'rot', tag: '循环左移（ROL）' },
  ror: { t: '循环右移', dir: 'r', fill: 'rot', tag: '循环右移（ROR）' },
};
const CS_ORDER = ['shl', 'sal', 'shr', 'sar', 'rol', 'ror'];
/* 补位口径的颜色（渲染与冒烟共用，避免两处漂移） */
const CS_FILL = {
  zero: { name: '补 0', bc: '#f59e0b', bg: '#fffbeb', fg: '#b45309' },
  sign: { name: '补符号位', bc: '#7c3aed', bg: '#f5f3ff', fg: '#6d28d9' },
  rot: { name: '补移出的那位', bc: '#0891b2', bg: '#ecfeff', fg: '#0e7490' },
  cf: { name: '补 CF', bc: '#db2777', bg: '#fdf2f8', fg: '#be185d' },
};

/* 一次"移一位"。纯函数，不碰外部状态；返回全量新对象（不变量⑥） */
function csStep1(bits, cf, op, cfMode) {
  const N = bits.length;
  const before = bits.slice();
  const def = CS_OPS[op];
  const dir = def.dir;
  const isRot = (op === 'rol' || op === 'ror');
  const carryLoop = isRot && cfMode === 'carry';
  /* 左移：最高位 b(N−1) = bits[0] 移出；右移：最低位 b0 = bits[N−1] 移出 */
  const outIdx = dir === 'l' ? 0 : N - 1;
  const vacIdx = dir === 'l' ? N - 1 : 0;
  const outBit = before[outIdx];

  let fillBit, fillKind;
  if (carryLoop) { fillBit = cf; fillKind = 'cf'; }
  else if (isRot) { fillBit = outBit; fillKind = 'rot'; }
  else if (def.fill === 'sign') { fillBit = before[0]; fillKind = 'sign'; }
  else { fillBit = 0; fillKind = 'zero'; }

  const after = new Array(N);
  const from = new Array(N);           /* 每一位"从哪来"：旧位下标，空位为 −1 */
  if (dir === 'l') {
    for (let i = 0; i < N - 1; i++) { after[i] = before[i + 1]; from[i] = i + 1; }
    after[N - 1] = fillBit; from[N - 1] = -1;
  } else {
    for (let i = 1; i < N; i++) { after[i] = before[i - 1]; from[i] = i - 1; }
    after[0] = fillBit; from[0] = -1;
  }
  const signChanged = before[0] !== after[0];
  return {
    op, dir, before, after, from, cfBefore: cf, cfAfter: outBit,
    outBit, outIdx, vacIdx, fillBit, fillKind, carryLoop, signChanged,
  };
}

/* 网格列数 = N + 1（多出的一列放"移出的那一位"）：左移时它在最左、右移时在最右。
   旧位 j / 新位 i 落在哪一列：（两个方向各自平移一格，用来让"搬过来"的位**对齐同一列**） */
function csColOf(N, dir, isBefore, idx) {
  return dir === 'l' ? (isBefore ? idx : idx + 1) : (isBefore ? idx + 1 : idx);
}

RC408.registerModule({
  id: 'coa-shift',
  mode: 'stepper',
  title: '数据的移位运算（逻辑 / 算术 / 循环）',

  theory: `
> **为什么要有它**：真题问移位，问的几乎永远是同一句话——"**移完之后空出来的那一位补什么**"。逻辑移位左右都补 0；算术右移补**符号位**（所以负数右移还是负数）；算术左移补 0；循环移位把**移出的位补回空位**。把同一个位串摆成上下两行、让"搬过来的位"对齐同一列，空位就一目了然。
> **怎么实现**：一次只移**一位**，逐帧推进；每一帧标出三件事——**哪一位被移出（进 CF）**、**哪一位是空出来的**、**它补的是什么**。第一次移位做完了可以接着做第二次（真题 2026-13 就是"先算术右移 3 位、再算术左移 2 位"）。
> **记住什么**：**空位补什么**（0 / 符号位 / 移出的位 / CF）+ **移出的位进 CF** + **算术左移"移位前后符号位不同就是溢出"** + **算术右移 = ÷2 向负无穷取整**。

## 六种移位，只看"空位补什么"

| 类型 | 数据往哪移 | 空位补什么 | 移出的位 |
| --- | --- | --- | --- |
| 逻辑左移 | 高位 | **0** | 进 CF（为 1 就是丢了） |
| 逻辑右移 | 低位 | **0** | 进 CF（为 1 就是丢了） |
| 算术左移 | 高位 | **0**（与逻辑左移的位操作相同） | 进 CF；**符号位一变就是溢出** |
| 算术右移 | 低位 | **符号位**（符号位不参与移动） | 进 CF |
| 循环左移 | 高位 | **刚移出的最高位** | 同时补回最低位，又进 CF |
| 循环右移 | 低位 | **刚移出的最低位** | 同时补回最高位，又进 CF |

**一句话**：逻辑移位"空位补 0"；算术右移"空位补符号位"；循环移位"空位补自己移出去的那一位"。

## 带进位 CF 的循环移位

把 **CF 当成第 N+1 位**，让 CF 和数据一起在 N+1 位的环里转：
- 带进位循环左移：CF 的旧值补进**最低位**，最高位转出去**进 CF**；
- 带进位循环右移：CF 的旧值补进**最高位**，最低位转出去**进 CF**。
⟹ "带进位"与"不带进位"的差别**就在空位补的是 CF 还是数据自己**——这正是最容易记混的一处。

## 数值视角（做题时的快速校验）

- **逻辑左移 k 位 = 无符号值 ×2^k（mod 2^N）**；逻辑右移 k 位 = 无符号值 ÷2^k 向下取整；
- **算术左移 k 位 = 有符号值 ×2^k**（超出补码范围就是**溢出**，结果是错的）；
- **算术右移 k 位 = 有符号值 ÷2^k 向负无穷取整**（floor，不是向零取整）：−26 = 1110 0110B 算术右移 1 位
  = 1111 0011B = −13（−26/2 = −13 刚好）；而 −27 算术右移 1 位是 −14（−27/2 = −13.5 ⟹ 取 −14）。
- **循环移位不改变"1 的个数"**（只是环移），这条能一眼判出"结果是不是循环移位来的"。

## 最容易错的三处

1. **算术左移与逻辑左移的位操作完全一样**（都补 0）——差别只在算术左移要**判溢出**：移位前后符号位不同 ⟹ 溢出。
2. **"左移 = 乘 2"只对不溢出的情形成立**：溢出时数值不再增大（甚至变号）。
3. **算术右移不是"÷2 向零取整"**：负数时是向负无穷取整（floor）；把 −27 右移一位当成 −13 是常见错答。

> **真题考情**：**3/18 年（选 2 + 大题 1）**：选 2018-16（**逻辑移位补 0 / 算术右移补符号位 / 算术左移补 0**）、2026-13（1010 0110B 算术右移 3 位再算术左移 2 位）；大 2012-44(1)（[x]补 = FDFFH 算术右移 1 位 ⟹ FEFFH）。
`,

  inputs: [
    {
      key: 'width', label: '位宽 N', type: 'select', default: '8',
      options: [{ v: '8', t: '8 位（真题口径）' }, { v: '16', t: '16 位' }],
    },
    {
      key: 'bits', label: '位串（从高位 b(N−1) 写到低位 b0）', type: 'text', default: '10100110', wide: true,
      help: '只写 0 / 1，长度必须等于位宽。默认 1010 0110B 就是 2026-13 那道真题的机器数',
    },
    {
      key: 'op', label: '第一次移位', type: 'select', default: 'sar', wide: true,
      options: CS_ORDER.map(k => ({ v: k, t: CS_OPS[k].tag + '（' + (CS_OPS[k].dir === 'l' ? '向高位' : '向低位') + '，空位' + CS_FILL[CS_OPS[k].fill].name + '）' })),
    },
    {
      key: 'k', label: '第一次移位位数', type: 'text', default: '3',
      help: '1 ~ 64 的整数；每移一位占一帧',
    },
    {
      key: 'op2', label: '第二次移位（可不出）', type: 'select', default: 'sal', wide: true,
      options: [{ v: 'none', t: '不出（只做第一次移位）' }].concat(
        CS_ORDER.map(k => ({ v: k, t: CS_OPS[k].tag }))),
    },
    { key: 'k2', label: '第二次移位位数', type: 'text', default: '2', help: '第二次移位不出时这一项被忽略' },
    {
      key: 'cfMode', label: '循环移位是否带进位 CF', type: 'select', default: 'no',
      options: [
        { v: 'no', t: '不带进位：CF 与数据无关，空位补"移出的那位"' },
        { v: 'carry', t: '带进位：CF 当第 N+1 位，与数据一起循环' },
      ],
    },
    {
      key: 'cf0', label: 'CF 初值（只对"带进位循环"有意义）', type: 'select', default: '0',
      options: [{ v: '0', t: 'CF = 0' }, { v: '1', t: 'CF = 1' }],
    },
  ],

  quickActions: [
    { label: '🎯 2026-13 同款：1010 0110B 算术右移 3 位再算术左移 2 位', run(rt) { rt.setInput('width', '8'); rt.setInput('bits', '10100110'); rt.setInput('op', 'sar'); rt.setInput('k', '3'); rt.setInput('op2', 'sal'); rt.setInput('k2', '2'); rt.load(); } },
    { label: '🎯 2018-16 同款①：算术右移（负数空位补 1，符号位不动）', run(rt) { rt.setInput('width', '8'); rt.setInput('bits', '10010110'); rt.setInput('op', 'sar'); rt.setInput('k', '3'); rt.setInput('op2', 'none'); rt.load(); } },
    { label: '🎯 2018-16 同款②：同一个位串改逻辑右移（空位补 0，符号位也参与移动）', run(rt) { rt.setInput('width', '8'); rt.setInput('bits', '10010110'); rt.setInput('op', 'shr'); rt.setInput('k', '3'); rt.setInput('op2', 'none'); rt.load(); } },
    { label: '📘 算术左移 1 位：符号位一变就是溢出', run(rt) { rt.setInput('width', '8'); rt.setInput('bits', '01100100'); rt.setInput('op', 'sal'); rt.setInput('k', '1'); rt.setInput('op2', 'none'); rt.load(); } },
    { label: '📘 逻辑左移 2 位：最高两位丢掉、低位补 0', run(rt) { rt.setInput('width', '8'); rt.setInput('bits', '11010011'); rt.setInput('op', 'shl'); rt.setInput('k', '2'); rt.setInput('op2', 'none'); rt.load(); } },
    { label: '📘 循环左移 3 位：1 的个数一个不少', run(rt) { rt.setInput('width', '8'); rt.setInput('bits', '10010110'); rt.setInput('op', 'rol'); rt.setInput('k', '3'); rt.setInput('op2', 'none'); rt.setInput('cfMode', 'no'); rt.load(); } },
    { label: '📘 带进位循环右移 1 位（CF = 1）：空位补的是 CF', run(rt) { rt.setInput('width', '8'); rt.setInput('bits', '10010110'); rt.setInput('op', 'ror'); rt.setInput('k', '1'); rt.setInput('op2', 'none'); rt.setInput('cfMode', 'carry'); rt.setInput('cf0', '1'); rt.load(); } },
    { label: '📘 16 位：逻辑右移 4 位（高位补 0，不是补符号位）', run(rt) { rt.setInput('width', '16'); rt.setInput('bits', '1111000010100101'); rt.setInput('op', 'shr'); rt.setInput('k', '4'); rt.setInput('op2', 'none'); rt.load(); } },
  ],

  parse(vals) {
    const width = String(vals.width) === '16' ? 16 : 8;
    const raw = String(vals.bits == null ? '' : vals.bits).trim().replace(/[\s_]/g, '');
    if (!/^[01]+$/.test(raw)) throw { message: `位串「${vals.bits}」只能是 0 和 1（不要写 B / 空格 / 十六进制）` };
    if (raw.length !== width) throw { message: `位串长度 ${raw.length} 与位宽 ${width} 不符：请写满 ${width} 位` };
    const bits = raw.split('').map(c => +c);

    const op = CS_ORDER.indexOf(String(vals.op)) >= 0 ? String(vals.op) : 'sar';
    const op2 = String(vals.op2) === 'none' ? 'none' : (CS_ORDER.indexOf(String(vals.op2)) >= 0 ? String(vals.op2) : 'none');
    const cfMode = String(vals.cfMode) === 'carry' ? 'carry' : 'no';
    const cf0 = String(vals.cf0) === '1' ? 1 : 0;

    const count = (s, name, required) => {
      const t = String(s == null ? '' : s).trim();
      if (t === '' && !required) return 0;
      if (!/^\d{1,2}$/.test(t)) throw { message: `${name}「${s}」要写成 1~64 的整数` };
      const n = +t;
      if (n < 1 || n > 64) throw { message: `${name} = ${n} 超出范围（1 ~ 64）` };
      return n;
    };
    const k = count(vals.k, '第一次移位位数', true);
    const k2 = op2 === 'none' ? 0 : count(vals.k2, '第二次移位位数', true);
    const total = k + k2;
    if (total > 40) throw { message: `总共要移 ${total} 位（每位移一帧），太多了：请把两次移位位数降到 40 以内` };

    /* 帧计划：第一次 k 步（类型 op），第二次 k2 步（类型 op2） */
    const plan = [];
    for (let i = 0; i < k; i++) plan.push({ op, stage: 1 });
    for (let i = 0; i < k2; i++) plan.push({ op: op2, stage: 2 });

    const mask = (1 << width) - 1;
    const u0 = parseInt(raw, 2);
    const s0 = bits[0] ? u0 - (1 << width) : u0;

    /* 参考表：同一个初值，六种类型各移 1 位 —— 这张表就是"空位到底补什么"的复盘 */
    const refTable = CS_ORDER.map(o => {
      const r = csStep1(bits, cf0, o, cfMode);
      const u = parseInt(r.after.join(''), 2);
      const s = r.after[0] ? u - (1 << width) : u;
      return {
        op: o, tag: CS_OPS[o].tag, dir: CS_OPS[o].dir,
        carryLoop: r.carryLoop, fillKind: r.fillKind, fillName: CS_FILL[r.fillKind].name,
        outBit: r.outBit, cfAfter: r.cfAfter, afterText: r.after.join(''),
        unsign: u, sign: s, signChanged: r.signChanged,
        overflow: o === 'sal' ? r.signChanged : false,
      };
    });

    return {
      width, bits, bitsText: raw, mask, hx: v => '0x' + (v & mask).toString(16).toUpperCase().padStart(width / 4, '0'),
      op, op2, k, k2, total, plan, cfMode, cf0, refTable,
      u0, s0, u0Text: String(u0), s0Text: String(s0),
      label: CS_OPS[op].tag + (k > 1 ? ' ' + k + ' 位' : ' 1 位') +
        (op2 === 'none' ? '' : ' → ' + CS_OPS[op2].tag + ' ' + k2 + ' 位'),
    };
  },

  buildSnapshots(model) {
    const m = model, W = m.width, N = W;
    const plan = m.plan;
    const snap0bits = m.bits.slice();

    /* 逐位移；每帧深拷贝一份位数组与 CF（不变量①②⑥） */
    const frames = [];
    let cur = snap0bits.slice(), cf = m.cf0, signEver = cur[0], overflowEver = false;
    plan.forEach((p, i) => {
      const r = csStep1(cur, cf, p.op, m.cfMode);
      const beforeText = cur.join('');
      const afterText = r.after.join('');
      const u = parseInt(afterText, 2);
      const s = r.after[0] ? u - (1 << W) : u;
      if (p.op === 'sal' && r.signChanged) overflowEver = true;
      frames.push(Object.assign({}, r, {
        idx: i + 1, stage: p.stage, op: p.op, dir: r.dir,
        beforeText, afterText, unsign: u, sign: s,
        /* 网格：N+1 列，before / after 各自落列（对齐"搬过来"的位） */
        beforeCells: gridOf(r, true), afterCells: gridOf(r, false),
        overflow: p.op === 'sal' ? r.signChanged : false,
        overflowEver, unsignLost: r.outBit === 1 && r.fillKind !== 'rot' && r.fillKind !== 'cf',
        onesBefore: r.before.reduce((a, b) => a + b, 0), onesAfter: r.after.reduce((a, b) => a + b, 0),
      }));
      cur = r.after; cf = r.cfAfter;
    });

    /* 把"行索引 → 列"算清楚：左移时"移位前"从第 0 列起、"移位后"整体右移一列；
       右移反过来。这样"旧 b(j+1) ⟷ 新 bj"（左移）或"旧 b(j−1) ⟷ 新 bj"（右移）就落在同一列。 */
    function gridOf(r, isBefore) {
      const G = N + 1;
      const cells = new Array(G).fill(null);
      const dir = r.dir;
      for (let j = 0; j < N; j++) {
        const col = csColOf(N, dir, true, j);
        if (isBefore) {
          cells[col] = {
            bit: r.before[j], src: -1, isOut: (j === r.outIdx),
            label: 'b' + (N - 1 - j), isVac: false,
          };
        }
      }
      if (!isBefore) {
        for (let i = 0; i < N; i++) {
          const col = csColOf(N, dir, false, i);
          cells[col] = {
            bit: r.after[i], src: r.from[i], isOut: false,
            label: 'b' + (N - 1 - i), isVac: (r.from[i] === -1),
          };
        }
      }
      return cells;
    }

    const snaps = [];
    const base = {
      width: W, label: m.label, total: m.total, bits0: m.bitsText, cf0: m.cf0, cfMode: m.cfMode,
      op: m.op, op2: m.op2, k: m.k, k2: m.k2, plan: m.plan.map(p => ({ op: p.op, stage: p.stage })),
      refTable: m.refTable.map(o => Object.assign({}, o)),
      u0: m.u0, s0: m.s0,
    };
    const mk = (o) => Object.assign({}, base, o);
    const lastFrame = frames.length ? frames[frames.length - 1] : null;

    snaps.push(mk({
      kind: 'init', idx: 0, stageKey: 'init', gridBefore: null, gridAfter: null,
      cf: m.cf0, cfAfter: null, outBit: null, fillKind: null, fillName: '—',
      curBits: snap0bits.slice(), curText: m.bitsText, unsign: m.u0, sign: m.s0,
      overflowEver: false, ones: snap0bits.reduce((a, b) => a + b, 0),
      doText: m.bitsText,
      desc: `就绪：${m.label}。初值 ${m.bitsText}B = 无符号 ${m.u0} / 补码 ${m.s0}，CF = ${m.cf0}。共移 ${m.total} 次（每次一位、一帧），点"单步"看每一次"哪一位被移出、空位补了什么"。`,
      log: `就绪：${m.bitsText}B（无符号 ${m.u0}、补码 ${m.s0}）｜${m.label}｜CF=${m.cf0}`,
      logType: 'info',
    }));

    frames.forEach(f => {
      const tag = CS_FILL[f.fillKind].name;
      const gone = (f.fillKind === 'rot' || f.fillKind === 'cf') ? '转回来' : '丢了';
      f.doText = '[' + f.beforeText.slice(0, N) + ']';
      snaps.push(mk({
        kind: 'beat', idx: f.idx, stageKey: f.op,
        gridBefore: f.beforeCells.map(c => c && Object.assign({}, c)),
        gridAfter: f.afterCells.map(c => c && Object.assign({}, c)),
        cf: f.cfBefore, cfAfter: f.cfAfter, outBit: f.outBit, fillKind: f.fillKind,
        fillName: tag + (f.carryLoop ? '（带进位循环）' : ''),
        curBits: f.after.slice(), curText: f.afterText, unsign: f.unsign, sign: f.sign,
        overflow: f.overflow, overflowEver: f.overflowEver,
        ones: f.onesAfter, dir: f.dir, vacIdx: f.vacIdx, outIdx: f.outIdx,
        desc: `第 ${f.idx} 次移位（${CS_OPS[f.op].tag}）：${f.beforeText}B → ${f.afterText}B。` +
          `**${'b' + (N - 1 - f.outIdx)} = ${f.outBit} 被移出**、写进 CF（CF ← ${f.cfAfter}）` +
          ((f.fillKind === 'rot' || f.fillKind === 'cf') ? '，同时' : '，那一位' + gone + '；') +
          `空出来的 ${'b' + (N - 1 - f.vacIdx)} ${tag}` +
          `（${tag === '补符号位' ? '符号位不参与移动' : tag === '补 0' ? '逻辑移位 / 算术左移都补 0' : '环移回来的'}）。` +
          `现在 ${f.afterText}B = 无符号 ${f.unsign} / 补码 ${f.sign}。` +
          (f.overflow ? ' ⚠ **符号位变了 ⟹ 算术左移溢出**，这个结果已经不是 ×2 了。' : ''),
        log: `#${f.idx} ${CS_OPS[f.op].t}：${f.beforeText} → ${f.afterText}｜移出 b${N - 1 - f.outIdx}=${f.outBit} 进 CF(${f.cfAfter})｜${'b' + (N - 1 - f.vacIdx)}←${tag}` +
          (f.overflow ? '｜⚠溢出' : ''),
        logType: f.overflow ? 'error' : (f.idx === m.total ? 'success' : 'info'),
      }));
    });

    const fin = lastFrame;
    const gain = fin ? fin.unsign - m.u0 : 0;
    snaps.push(mk({
      kind: 'done', idx: m.total + 1, stageKey: 'done',
      gridBefore: fin ? fin.beforeCells.map(c => c && Object.assign({}, c)) : null,
      gridAfter: fin ? fin.afterCells.map(c => c && Object.assign({}, c)) : null,
      cf: fin ? fin.cfAfter : m.cf0, cfAfter: null, outBit: fin ? fin.outBit : null,
      fillKind: fin ? fin.fillKind : null, fillName: fin ? CS_FILL[fin.fillKind].name : '—',
      curBits: cur.slice(), curText: cur.join(''), unsign: parseInt(cur.join(''), 2),
      sign: cur[0] ? parseInt(cur.join(''), 2) - (1 << W) : parseInt(cur.join(''), 2),
      overflowEver, ones: cur.reduce((a, b) => a + b, 0),
      desc: `完成：${m.label}，共 ${m.total} 次移位（每次一位）。初值 ${m.bitsText}B（无符号 ${m.u0} / 补码 ${m.s0}）` +
        ` ⟹ 结果 ${cur.join('')}B（无符号 ${parseInt(cur.join(''), 2)} / 补码 ${cur[0] ? parseInt(cur.join(''), 2) - (1 << W) : parseInt(cur.join(''), 2)}），CF = ${cf}` +
        (overflowEver ? '；**过程中出现过算术左移溢出**，结果不能按"乘 2 的幂"解释。' : '。'),
      log: `完成：${m.label}｜${m.bitsText} → ${cur.join('')}｜CF=${cf}（无符号差 ${gain >= 0 ? '+' : ''}${gain}）` + (overflowEver ? '｜⚠有过溢出' : ''),
      logType: 'success',
    }));
    return snaps;
  },

  render(ctx) {
    const { snap: s, model: m, stage } = ctx;
    const W = m.width, N = W, G = N + 1;
    const isBeat = s.kind === 'beat';
    const dir = isBeat ? s.dir : m.plan.length ? CS_OPS[m.plan[0].op].dir : 'l';

    /* -------- 一个位格 -------- */
    const CW = W === 8 ? 46 : 34;                        /* 格宽：8 位宽一点、16 位窄一点 */
    const bitCell = (c, tagKind) => {
      if (!c) return `<div class="cs-slot" data-slot="1" style="width:${CW}px;height:52px;box-sizing:border-box"></div>`;
      const isOut = !!c.isOut, isVac = !!c.isVac;
      let bc = '#e2e8f0', bg = '#ffffff', fg = '#0f172a', note = '', strike = '';
      if (isOut) { bc = '#ef4444'; bg = '#fef2f2'; fg = '#b91c1c'; note = '移出 → CF'; strike = 'text-decoration:line-through;'; }
      else if (isVac) {
        const f = CS_FILL[c.fillKind || tagKind || 'zero'];
        bc = f.bc; bg = f.bg; fg = f.fg; note = f.name;
      } else if (c.src >= 0) { note = '← b' + (N - 1 - c.src); }
      return `<div class="cs-cell${isOut ? ' cs-out' : ''}${isVac ? ' cs-vac' : ''}" data-bit="${c.bit}" data-out="${isOut ? 1 : 0}" data-vac="${isVac ? 1 : 0}"
        style="width:${CW}px;height:52px;box-sizing:border-box;border:1.5px solid ${bc};background:${bg};border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:center;font:700 17px Consolas,monospace;color:${fg};${strike}">
        <span>${c.bit}</span>
        <span style="font:600 9px system-ui;color:${isVac || isOut ? fg : '#94a3b8'};white-space:nowrap">${note || c.label}</span></div>`;
    };
    const gridRow = (cells, tagKind, id) => `<div data-grid="${id}" style="display:flex;gap:5px">` +
      cells.map(c => bitCell(c, tagKind)).join('') + `</div>`;

    const beforeRow = s.gridBefore ? gridRow(s.gridBefore, null, 'before') : '';
    /* init 帧没有"移位前 / 移位后"两行，就按寄存器的**槽位**单独画一行当前位串 */
    const initCells = (function () {
      if (s.kind !== 'init') return null;
      const cells = new Array(N + 1).fill(null);
      for (let i = 0; i < N; i++) {
        cells[csColOf(N, dir, false, i)] = { bit: s.curBits[i], src: -1, isOut: false, isVac: false, label: 'b' + (N - 1 - i) };
      }
      return cells;
    })();
    const afterCells = s.gridAfter || initCells;
    /* 每一行配一条自己的**位号尺**：槽位在左、被移出的位在最外侧标"越界"。
       两行的尺各自对齐本行的格子 —— 上一行的尺标签是"原位号"、下一行是"槽位号"，
       所以两把尺本身也错开一格，这正是"位移"本身（§3.8-8 窗47 目视后改）。 */
    const ruler = (cells, id) => {
      const cs = [];
      for (let c = 0; c < N + 1; c++) {
        const cell = cells ? cells[c] : null;
        const txt = !cell ? '' : (cell.isOut ? '越界' : cell.label);
        cs.push(`<div data-ruler="${id}" data-col="${c}" style="width:${CW}px;text-align:center;font:700 10px system-ui;color:${cell && cell.isOut ? '#b91c1c' : (cell ? '#94a3b8' : 'transparent')}">${txt || '·'}</div>`);
      }
      return `<div style="display:flex;gap:5px">${cs.join('')}</div>`;
    };
    const rulerPad = '<span style="width:52px;display:inline-block"></span>';
    const cfBox = (label, v, hot) => `<div data-cf="${label}" style="border:1.5px solid ${hot ? '#db2777' : '#e2e8f0'};background:${hot ? '#fdf2f8' : '#fff'};
      border-radius:7px;padding:4px 10px;font:700 13px Consolas,monospace;color:${hot ? '#be185d' : '#475569'}">${label} = <span style="font-size:15px">${v}</span></div>`;

    /* -------- 六种类型对照表（同一初值各移 1 位） -------- */
    const refRows = s.refTable.map(r => {
      const cur = isBeat ? (r.op === s.stageKey) : false;
      return `<tr data-ref="${r.op}" style="${cur ? 'background:#eef2ff;font-weight:700' : ''}">
        <td style="padding:2px 8px;white-space:nowrap">${r.tag}</td>
        <td style="padding:2px 8px;white-space:nowrap"><span style="color:${CS_FILL[r.fillKind].fg}">${r.fillName}</span></td>
        <td style="padding:2px 8px;font-family:Consolas,monospace">${r.afterText}</td>
        <td style="padding:2px 8px">${r.outBit}</td>
        <td style="padding:2px 8px">${r.cfAfter}</td>
        <td style="padding:2px 8px">${r.unsign}</td>
        <td style="padding:2px 8px">${r.sign}</td>
        <td style="padding:2px 8px;color:${r.overflow ? '#b91c1c' : '#64748b'}">${r.overflow ? '符号位变了 ⟹ 溢出' : (r.signChanged ? '符号位变了（不算溢出）' : '—')}</td>
      </tr>`;
    }).join('');

    const shiftWord = s.kind === 'init' ? '（尚未开始）' : (s.kind === 'done' ? '完成（共 ' + m.total + ' 次）' : s.idx + ' / ' + m.total);
    const cards =
      RC408.ui.statCard('当前位串', s.curText, m.width + ' 位｜' + (s.kind === 'init' ? '初值' : (s.kind === 'done' ? '最终结果' : '第 ' + s.idx + ' 次之后')), 'text-indigo-600') +
      RC408.ui.statCard('移位进度', shiftWord, s.kind === 'init' ? m.label : (s.kind === 'done' ? m.label : CS_OPS[s.stageKey].t), 'text-slate-800') +
      RC408.ui.statCard('无符号 / 补码', s.unsign + ' / ' + s.sign, '初值 ' + m.u0 + ' / ' + m.s0, 'text-emerald-600') +
      RC408.ui.statCard('CF 与空位补什么', isBeat ? 'CF=' + s.cfAfter + '｜' + s.fillName : 'CF=' + s.cf,
        isBeat ? '移出 b' + (N - 1 - s.outIdx) + '=' + s.outBit + ' 进 CF' : '每移一位都会写 CF', s.overflowEver ? 'text-rose-600' : 'text-slate-800');

    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('位格对齐（两行各配一条位号尺：上面那把尺是"移位前的原位号"、下面那把是"移位后的槽位号"，两把尺错开一格就是"位移"本身）')}
          <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">
            <div data-cs-grid="1" style="display:flex;flex-direction:column;gap:4px">
              ${beforeRow ? `<div style="display:flex;align-items:center;gap:8px">${rulerPad}${ruler(s.gridBefore, 'before')}</div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:52px;font:700 11px system-ui;color:#64748b">移位前</span>${beforeRow}</div>` : ''}
              ${afterCells ? `<div style="display:flex;align-items:center;gap:8px">${rulerPad}${ruler(afterCells, 'after')}</div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:52px;font:700 11px system-ui;color:#64748b">移位后</span>${gridRow(afterCells, s.fillKind, 'after')}</div>` : ''}
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
                ${cfBox('CF（移位前）', s.kind === 'init' ? m.cf0 : s.cf, s.kind === 'init')}
                ${cfBox('CF（移位后）', isBeat ? s.cfAfter : (s.kind === 'done' ? s.cf : '—'), isBeat)}
                <span style="font:500 11px system-ui;color:#64748b;align-self:center">移出的那一位<b>一定</b>进 CF；带进位循环时 CF 还会被<b>补回空位</b></span>
              </div>
            </div>
            <div style="flex:1 1 260px;min-width:240px;display:flex;flex-direction:column;gap:6px">
              <div style="font:700 11px system-ui;color:#94a3b8">图例</div>
              ${Object.keys(CS_FILL).map(k => `<div style="display:flex;align-items:center;gap:6px;font:600 11px system-ui;color:${CS_FILL[k].fg}">
                <span style="display:inline-block;width:14px;height:14px;border:1.5px solid ${CS_FILL[k].bc};background:${CS_FILL[k].bg};border-radius:4px"></span>空位${CS_FILL[k].name}</div>`).join('')}
              <div style="display:flex;align-items:center;gap:6px;font:600 11px system-ui;color:#b91c1c">
                <span style="display:inline-block;width:14px;height:14px;border:1.5px dashed #ef4444;background:#fef2f2;border-radius:4px"></span>被移出（划掉 = 数据里已经没了）</div>
              <div style="font:600 11px system-ui;color:#475569">白格 = 原样搬过来的位</div>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('六种类型对照表（同一个初值 ' + m.bitsText + 'B 各移 1 位；当前帧的类型高亮）')}
          <table class="text-sm" data-cs-table="ref" style="width:100%;border-collapse:collapse">
            <thead><tr style="color:#94a3b8;font-size:11px">
              <th style="text-align:left;padding:2px 8px">类型</th><th style="text-align:left;padding:2px 8px">空位补什么</th>
              <th style="text-align:left;padding:2px 8px">1 位后</th><th style="text-align:left;padding:2px 8px">移出位</th>
              <th style="text-align:left;padding:2px 8px">CF</th><th style="text-align:left;padding:2px 8px">无符号</th>
              <th style="text-align:left;padding:2px 8px">补码</th><th style="text-align:left;padding:2px 8px">备注</th>
            </tr></thead><tbody>${refRows}</tbody>
          </table>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
          ${RC408.ui.sectionTitle('本次移位的计划（每移一位一帧，共 ' + m.total + ' 帧）')}
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${m.plan.map((p, i) => `<span data-plan="${i + 1}" style="border:1.5px solid ${i + 1 === s.idx ? '#6366f1' : '#e2e8f0'};background:${i + 1 === s.idx ? '#eef2ff' : '#fff'};border-radius:999px;padding:2px 10px;font:600 11px system-ui;color:${i + 1 === s.idx ? '#3730a3' : '#64748b'}">#${i + 1} ${CS_OPS[p.op].t}${p.stage === 2 ? '（第二次）' : ''}</span>`).join('')}
          </div>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>① <b>逻辑移位左右都补 0</b>（所有位都参与移动）；
          ② <b>算术右移空位补符号位</b>（符号位不参与移动），所以负数右移仍是负数；
          ③ <b>算术左移的位操作与逻辑左移完全相同</b>，差别只在"移位前后符号位不同 ⟹ 溢出"；
          ④ <b>循环移位把移出的位补回空位</b>，1 的个数一个不少；<b>带进位循环</b>时空位补的是 <b>CF</b>；
          ⑤ 不论哪种类型，<b>移出的那一位都写进 CF</b>；
          ⑥ <b>算术右移 = ÷2 向负无穷取整</b>（floor），不是向零取整。
        </div>
      </div>`;
  },
});
