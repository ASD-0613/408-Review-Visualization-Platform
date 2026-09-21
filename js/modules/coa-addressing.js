'use strict';
/* ============================================================================
 * addressing.js —— 【计算机组成原理】指令寻址方式（确定有效地址 EA 的方法）
 * ----------------------------------------------------------------------------
 * 快照设计：选定一种寻址方式后，按"取指令 → 求有效地址 → 取操作数 → 写回 ACC"
 * 四步产出快照：
 *   { step:'init'|'fetch'|'ea'|'operand'|'done',
 *     hiReg    本步高亮的寄存器（'PC'|'BR'|'IX'|'R2'|null）
 *     ea       有效地址（立即/寄存器寻址为 null）
 *     eaFromA  间接寻址的"中间单元"地址
 *     operand  取到的操作数
 *     memAcc   取操作数的访存次数 }
 * 演示主存共 24 个单元（0~23），寄存器初值可调。
 * ========================================================================== */

/* 关键主存单元的预设值（保证寻址链条有内容可读），其余单元按公式填充 */
const _AD_MEM_SPECIAL = { 10: 20, 13: 99, 14: 55, 18: 73, 20: 66, 22: 81 };
const _AD_MEM_FILL = i => (i * 5 + 7) % 37;

const _AD_MODES = {
  imm:      { name: '立即寻址',     eaText: null, acc: 0, tip: '操作数直接写在指令中（# 操作数），取指后立即得到操作数，不访存；缺点是 A 的位数限制了数的范围。' },
  direct:   { name: '直接寻址',     eaText: 'EA = A', acc: 1, tip: 'EA = A：形式地址就是操作数的真实地址，简单直观，只访存一次；寻址范围受 A 位数限制。' },
  indirect: { name: '间接寻址',     eaText: 'EA = (A)', acc: 2, tip: 'EA = (A)：先从主存 A 单元读出"有效地址"，再按它取操作数，访存两次；优点是扩大寻址范围、便于子程序返回，但速度慢。' },
  reg:      { name: '寄存器寻址',   eaText: '操作数 = (R)', acc: 0, tip: '操作数就在寄存器 R 中，不访存，速度最快；寄存器个数有限。' },
  regind:   { name: '寄存器间接寻址', eaText: 'EA = (R)', acc: 1, tip: 'EA = (R)：寄存器里放的"是地址"，按它访存取操作数，只访存一次；比间接寻址快，是 C 语言指针的硬件基础。' },
  relative: { name: '相对寻址',     eaText: 'EA = (PC) + A', acc: 1, tip: 'EA = (PC) + A：以 PC（已指向下一条指令）为基准偏移 A，程序整体搬移后仍能正确执行（便于程序浮动），常用于转移指令。' },
  base:     { name: '基址寻址',     eaText: 'EA = (BR) + A', acc: 1, tip: 'EA = (BR) + A：基址寄存器 BR 由**操作系统**设定（面向系统），程序只需给出位移量 A —— 有利于多道程序重定位和扩大寻址范围。' },
  index:    { name: '变址寻址',     eaText: 'EA = (IX) + A', acc: 1, tip: 'EA = (IX) + A：变址寄存器 IX 由**用户**设定（面向用户），形式地址 A 作基准、IX 不断变化 —— 特别适合循环处理数组。' },
};

RC408.registerModule({
  id: 'coa-addressing',
  mode: 'stepper',
  title: '指令寻址方式（有效地址 EA 的形成）',

  theory: `
> **为什么要有它**：指令里给出的形式地址 A 几乎都不是操作数的真实位置——**由 A 变换出有效地址 EA 的规则**就是寻址方式，它决定一条指令"能覆盖多大范围、要访存几次、快不快"。
> **怎么实现**：按 EA 的算式分八类——立即 / 直接 / 间接 / 寄存器 / 寄存器间接 / 相对 / 基址 / 变址，区别只在"A 与哪个寄存器、怎样组合"。
> **记住什么**：八种方式的 EA 公式与**取操作数访存次数**；**基址面向系统（重定位）、变址面向用户（数组循环）**。

## 八种常考寻址方式
| 寻址方式 | 有效地址 / 操作数 | 取操作数访存次数 | 特点 |
| --- | --- | --- | --- |
| 立即寻址 | 操作数 = A 本身（#data） | 0 | 最快；范围受 A 位数限制 |
| 直接寻址 | EA = A | 1 | 简单；范围受 A 位数限制 |
| 间接寻址 | EA = (A) | 2 | 扩大范围；多访存一次 |
| 寄存器寻址 | 操作数 = (R) | 0 | 最快；寄存器数量有限 |
| 寄存器间接 | EA = (R) | 1 | 指针的硬件原型 |
| 相对寻址 | EA = (PC) + A | 1 | 程序浮动；转移指令 |
| 基址寻址 | EA = (BR) + A | 1 | BR 由**操作系统**管理；重定位 |
| 变址寻址 | EA = (IX) + A | 1 | IX 由**用户**管理；数组循环 |

## 基址 vs 变址（高频辨析）
- **基址寻址**：BR 由系统设定、**不变**，A 变 → 面向操作系统，解决**程序重定位**；
- **变址寻址**：IX 由用户修改、**变化**，A 不变 → 面向用户，解决**数组 / 循环**的成批访问。

## 考点提醒（易错点）
1. 相对寻址的 (PC) 是**取指后**的值（已指向下一条指令），不是本条指令的地址；
2. **"取操作数访存次数"不含取指**：一次间接寻址取操作数要 2 次（先读 EA，再读操作数）；
3. **"一条指令访存几次"**是最经典的陷阱题，常与页式虚存、TLB、Cache 综合（2015/2016 真题）；
4. 由给定的访存次数或执行结果**反推寻址方式**，是大题常见形式。

> **真题考情**：**8/18 年，全为选择题**（2011-16、2013-17、2014-17、2015-16、2016-17、2018-18、2020-16、2023-17），
> 固定问法：变址/基址求操作数、间接寻址的访存次数、"一条指令访存几次"综合题。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'mode', label: '寻址方式', type: 'select', default: 'indirect', wide: true,
      options: Object.entries(_AD_MODES).map(([v, m]) => ({ v, t: m.name })),
    },
    { key: 'A', label: '形式地址 A', default: '10', help: '立即寻址时 A 本身就是操作数' },
    { key: 'PC', label: '程序计数器 PC（取指后已指向下条）', default: '12' },
    { key: 'BR', label: '基址寄存器 BR', default: '8' },
    { key: 'IX', label: '变址寄存器 IX', default: '4' },
    { key: 'R2', label: '寄存器 R2', default: '13' },
  ],

  /* ---------------- ① 解析与计算（纯函数） ---------------- */
  parse(vals) {
    const num = (s, name) => {
      const v = Number(s);
      if (!/^-?\d+$/.test(String(s).trim()) || !Number.isInteger(v) || v < 0) {
        throw { message: `${name}「${s}」须为非负整数` };
      }
      return v;
    };
    const A = num(vals.A, '形式地址 A');
    const PC = num(vals.PC, 'PC'), BR = num(vals.BR, 'BR'), IX = num(vals.IX, 'IX'), R2 = num(vals.R2, 'R2');
    const mode = _AD_MODES[vals.mode] ? vals.mode : 'direct';
    const m = _AD_MODES[mode];

    const mem = Array.from({ length: 24 }, (_, i) => (_AD_MEM_SPECIAL[i] !== undefined ? _AD_MEM_SPECIAL[i] : _AD_MEM_FILL(i)));

    let ea = null, eaFromA = null, operand = null;
    switch (mode) {
      case 'imm': operand = A; break;
      case 'direct': ea = A; operand = mem[ea]; break;
      case 'indirect': eaFromA = A; ea = mem[A]; operand = mem[ea]; break;
      case 'reg': operand = R2; break;
      case 'regind': ea = R2; operand = mem[ea]; break;
      case 'relative': ea = PC + A; operand = mem[ea]; break;
      case 'base': ea = BR + A; operand = mem[ea]; break;
      case 'index': ea = IX + A; operand = mem[ea]; break;
    }
    const check = (v, label) => {
      if (v !== null && v !== undefined && (v < 0 || v > 23)) {
        throw { message: `${label} = ${v} 超出演示主存范围 0 ~ 23，请调整 A 或寄存器初值` };
      }
    };
    check(eaFromA, `间接寻址的中间地址 (A 所指单元)`);
    check(ea, '有效地址 EA');
    return { mode, m, A, PC, BR, IX, R2, ea, eaFromA, operand, mem };
  },

  /* ---------------- ② 纯算法：四步快照 ---------------- */
  buildSnapshots(model) {
    const { mode, m, A, PC, ea, eaFromA, operand } = model;
    const hasEA = ea !== null;
    const snaps = [{
      step: 'init', hiReg: null, ea, eaFromA, operand,
      log: `就绪：${m.name}。点击「单步执行」观察 有效地址 EA 的形成与操作数的获取。`,
      logType: 'info',
      desc: `${m.name}：${m.tip}`,
    }];

    /* ① 取指令 */
    snaps.push({
      step: 'fetch', hiReg: null, ea, eaFromA, operand,
      log: `取指令：IR = [ 操作码 OP | 形式地址 A = ${A} ]${mode === 'relative' ? `（取指后 PC 已自动 +1，指向下一条指令 = ${PC}）` : ''}`,
      logType: 'info',
      desc: `取指令 → 指令寄存器：操作码 OP + 形式地址 A=${A}${mode === 'imm' ? '（此处的 A 就是操作数！）' : ''}`,
    });

    /* ② 求有效地址（立即 / 寄存器寻址无 EA 概念） */
    const eaLogs = {
      imm: [`立即寻址：无需求 EA —— 操作数 = #${A}，已随指令取出（零次访存，速度最快）`, 'info', `操作数就在指令里：#${A}`],
      direct: [`直接寻址：EA = A = ${ea}，无需任何计算`, 'info', `形式地址即有效地址：EA = ${ea}`],
      indirect: [`间接寻址：访存读取 A 号单元 → M[${A}] = ${ea}，它才是有效地址 EA（第一次访存）`, 'warn', `EA = (A) = M[${A}] = ${ea} —— 多一次访存换更大寻址范围`],
      reg: [`寄存器寻址：无需访存 —— 操作数就在 R2 中（= ${operand}）`, 'info', `操作数 = (R2) = ${operand}`],
      regind: [`寄存器间接寻址：EA = (R2) = ${ea}，R2 里放的是"地址"`, 'info', `EA = (R2) = ${ea} —— 指针的硬件原型`],
      relative: [`相对寻址：EA = (PC) + A = ${PC} + ${A} = ${ea}（PC 已指向下一条指令）`, 'info', `EA = (PC) + A = ${PC} + ${A} = ${ea} —— 程序整体搬家也不怕`],
      base: [`基址寻址：EA = (BR) + A = ${model.BR} + ${A} = ${ea}（BR 由操作系统设定，A 是位移量）`, 'info', `EA = (BR) + A = ${model.BR} + ${A} = ${ea} —— 面向系统的重定位`],
      index: [`变址寻址：EA = (IX) + A = ${model.IX} + ${A} = ${ea}（IX 由用户修改，适合数组循环）`, 'info', `EA = (IX) + A = ${model.IX} + ${A} = ${ea} —— 面向用户的数组遍历`],
    }[mode];
    snaps.push({
      step: 'ea', hiReg: { indirect: null, reg: 'R2', regind: 'R2', relative: 'PC', base: 'BR', index: 'IX' }[mode] || null,
      ea, eaFromA, operand,
      log: eaLogs[0], logType: eaLogs[1],
      desc: eaLogs[2],
    });

    /* ③ 取操作数 */
    snaps.push({
      step: 'operand', hiReg: mode === 'reg' ? 'R2' : null, ea, eaFromA, operand,
      log: m.acc > 0
        ? `按 EA = ${ea} 访问主存，取出操作数 = ${operand}（${mode === 'indirect' ? '第二次访存；' : ''}${m.name}取操作数共访存 ${m.acc} 次）`
        : `${m.name}：不访存，操作数 = ${operand} 已经得到（共访存 0 次）`,
      logType: 'success',
      desc: `取出操作数 ${operand}（绿色单元 / 寄存器）`,
    });

    /* ④ 写回 ACC */
    snaps.push({
      step: 'done', hiReg: null, ea, eaFromA, operand,
      log: `执行完成：ACC ← ${operand}。${m.name}取操作数共访存 ${m.acc} 次（不含取指令）—— ${m.tip}`,
      logType: 'success',
      desc: `完成！${m.name}共访存 ${m.acc} 次取操作数`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { mode, m, A, PC, BR, IX, R2, ea, eaFromA, operand, mem } = model;
    const isDone = s.step === 'done';
    const showEA = s.step === 'ea' || s.step === 'operand' || isDone;
    const showOp = s.step === 'operand' || isDone;

    /* 寄存器面板 */
    const regChip = (name, val, hot, acc) => `
      <div class="reg-chip ${hot ? 'reg-chip-hot' : ''} ${acc ? 'reg-chip-acc' : ''}">
        <span class="reg-name">${name}</span><span class="reg-num">${val}</span>
      </div>`;
    const regsHtml = `
      <div class="flex flex-wrap gap-2">
        ${regChip('PC', PC, s.hiReg === 'PC')}
        ${regChip('BR', BR, s.hiReg === 'BR')}
        ${regChip('IX', IX, s.hiReg === 'IX')}
        ${regChip('R2', R2, s.hiReg === 'R2')}
        ${regChip('ACC', isDone ? operand : '—', false, isDone)}
      </div>`;

    /* 指令格式 */
    const instHtml = `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="px-4 py-2 rounded-lg bg-indigo-500 text-white font-bold text-sm">操作码 OP</span>
        <span class="text-slate-300 font-bold">+</span>
        <span class="px-4 py-2 rounded-lg bg-amber-400 text-white font-bold text-sm font-mono">A = ${A}${mode === 'imm' ? '（= 操作数 #）' : ''}</span>
        <span class="text-xs text-slate-400">← 指令寄存器 IR 中的指令</span>
      </div>`;

    /* 主存 24 单元 */
    const cells = mem.map((v, i) => {
      let cls = 'mem-cell';
      if (s.step !== 'init') {
        if (mode !== 'imm' && mode !== 'reg' && i === A && mode !== 'regind' && mode !== 'relative' && mode !== 'base' && mode !== 'index') cls += ' mem-a';      // 直接/间接：A 是主存地址
        if (s.eaFromA !== null && i === s.eaFromA && showEA) cls += ' mem-mid';   // 间接：中间单元
        if (showEA && ea !== null && i === ea) cls += ' mem-ea';                  // EA 单元
        if (showOp && mode !== 'reg' && mode !== 'imm' && ea !== null && i === ea) cls += ' mem-op'; // 操作数单元
        if (showOp && (mode === 'imm' || mode === 'reg') && false) cls += '';     // 立即/寄存器：不指向主存
      }
      const flash = s.step === 'ea' && ((mode === 'indirect' && i === s.eaFromA) || (mode !== 'imm' && mode !== 'reg' && ea !== null && i === ea && mode !== 'indirect'));
      return `<div class="${cls} ${flash ? 'anim-flash-red' : ''}" style="${flash ? 'animation-iteration-count:1;' : ''}">
        <span class="mem-addr">M[${i}]</span><span class="mem-val">${v}</span>
      </div>`;
    }).join('');
    const memHtml = `
      <div>
        ${RC408.ui.sectionTitle('演示主存（琥珀框 = 形式地址指向 / 中间单元，绿框 = 有效地址，绿底 = 操作数）')}
        <div class="grid grid-cols-6 md:grid-cols-8 gap-1.5 justify-items-center">${cells}</div>
      </div>`;

    /* EA 公式卡 */
    const eaFormula = {
      imm: '立即寻址没有 EA：操作数随指令一起取出',
      direct: `EA = A = ${ea}`,
      indirect: `EA = (A) = M[${A}] = ${ea} → 再按 EA 取操作数`,
      reg: '寄存器寻址没有主存访存：操作数 = (R2)',
      regind: `EA = (R2) = ${ea}`,
      relative: `EA = (PC) + A = ${PC} + ${A} = ${ea}`,
      base: `EA = (BR) + A = ${BR} + ${A} = ${ea}`,
      index: `EA = (IX) + A = ${IX} + ${A} = ${ea}`,
    }[mode];

    const stats =
      RC408.ui.statCard('寻址方式', m.name, `有效地址 ${ea === null ? '—' : 'EA = ' + ea}`, 'text-indigo-600') +
      RC408.ui.statCard('操作数', isDone ? operand : '—', '本步执行结果', isDone ? 'text-emerald-600' : 'text-slate-400') +
      RC408.ui.statCard('取操作数访存', `${m.acc} 次`, '不含取指令本身', 'text-amber-600') +
      RC408.ui.statCard('当前阶段', { init: '待开始', fetch: '① 取指令', ea: '② 求有效地址', operand: '③ 取操作数', done: '🏁 完成' }[s.step], '', 'text-slate-700');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 space-y-4">
          ${RC408.ui.sectionTitle('指令与寄存器')}
          ${instHtml}
          ${regsHtml}
          <div class="rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs font-mono text-slate-600">
            <b style="color:#4f46e5">EA 公式：</b>${eaFormula}
          </div>
        </div>

        ${memHtml}

        <div class="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800 leading-relaxed">
          💡 ${m.tip}
        </div>
      </div>`;
  },
});
