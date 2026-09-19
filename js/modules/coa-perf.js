'use strict';
/* ============================================================================
 * coa-perf.js —— 【计算机组成原理】CPU 性能指标计算器（即时）（前缀 _pf）
 * 考情：18 年中 6 年直接考性能公式（2012/2013/2017/2022/2023/2025-12 或 18 题），
 * 变体包括"多类指令比例求平均 CPI"、"提速后再算总时间"。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-perf',
  mode: 'instant',
  title: 'CPU 性能指标（主频 · CPI · MIPS）',

  theory: `
> **真题考情**：18 年中 6 年直接考性能公式（2012/2013/2017/2022/2023/2025-12 题），
> 常与"指令比例加权 CPI"、"程序提速后总时间"结合出题。

## 三个核心公式（必背）
\`\`\`text
CPU 执行时间 = 指令条数 × CPI ÷ 主频
MIPS        = 主频 ÷ (CPI × 10⁶)          = 指令条数 ÷ (执行时间 × 10⁶)
FLOPS 系列同理：每秒浮点操作次数（MF/GF/TF/PF…，10⁶ 起每级 ×1000）
\`\`\`
- **平均 CPI**：多类指令按**执行占比**加权：CPI = Σ(CPIᵢ × 占比ᵢ)；
- 主频 = 1 ÷ 时钟周期（Hz）；1 GHz = 每个时钟周期 1 ns。

## 考点提示
- "指令数减 30%、CPI 变 1.2 倍，总时间？"——直接套比例（2014 真题）；
- 基准程序总时间中只提速 CPU 部分 → 分别算两段（2012 真题）；
- MIPS 高 ≠ 一定快：不同指令集比较无意义（2025 年考 CPI 与时钟周期辨析）。
`,

  inputs: [
    { key: 'mode', label: '计算模式', type: 'select', default: 'simple', wide: true,
      options: [{ v: 'simple', t: '单一 CPI：直接给平均 CPI' }, { v: 'mix', t: '多类指令：给"占比:CPI"求加权平均' }] },
    { key: 'ghz', label: '主频（GHz）', default: '1.2' },
    { key: 'n', label: '指令条数', default: '100000000', help: '支持 1e8 科学计数法' },
    { key: 'cpi', label: '平均 CPI（模式一）', default: '2.5' },
    { key: 'mix', label: '各类指令"占比:CPI"（模式二，分号分隔）', type: 'text', default: '0.4:1, 0.3:2, 0.3:4', wide: true,
      help: '如 0.4:1, 0.3:2, 0.3:4 —— 占比之和应为 1' },
  ],

  quickActions: [
    { label: '2012 真题：1.2GHz 四类指令', run(rt) { rt.setInput('mode', 'mix'); rt.setInput('ghz', '1.2'); rt.setInput('mix', '0.4:1, 0.2:2, 0.2:4, 0.2:8'); rt.load(); } },
    { label: '2022 真题：1GHz 80/20', run(rt) { rt.setInput('mode', 'mix'); rt.setInput('ghz', '1'); rt.setInput('mix', '0.8:1, 0.2:10'); rt.load(); } },
    { label: '2023 真题：5GHz CPI 1.2', run(rt) { rt.setInput('mode', 'simple'); rt.setInput('ghz', '5'); rt.setInput('n', '500000'); rt.setInput('cpi', '1.2'); rt.load(); } },
  ],

  parse(vals) {
    const ghz = Number(vals.ghz);
    const n = Number(vals.n);
    if (!(ghz > 0)) throw { message: '主频须为正数' };
    if (!(n > 0)) throw { message: '指令条数须为正数' };
    let cpi;
    if (vals.mode === 'mix') {
      const parts = vals.mix.split(/[,，;；]+/).map(x => x.trim()).filter(Boolean);
      if (!parts.length) throw { message: '请输入各类指令的"占比:CPI"' };
      let sum = 0;
      parts.forEach(p => {
        const mm = p.split(/[:：]/);
        if (mm.length !== 2) throw { message: `「${p}」格式错误，应为 占比:CPI（如 0.4:1）` };
        const share = Number(mm[0]), c = Number(mm[1]);
        if (!(share > 0) || !(c > 0)) throw { message: `「${p}」中占比与 CPI 须为正数` };
        sum += share * c;
      });
      if (Math.abs(parts.reduce((a, p) => a + Number(p.split(/[:：]/)[0]), 0) - 1) > 1e-9) {
        throw { message: '各类指令占比之和应为 1' };
      }
      cpi = sum;
    } else {
      cpi = Number(vals.cpi);
      if (!(cpi > 0)) throw { message: 'CPI 须为正数' };
    }
    const periodNs = 1000 / (ghz * 1000);            // 主频 GHz → 时钟周期 ns
    const timeSec = n * cpi / (ghz * 1e9);
    const mips = ghz * 1000 / cpi / 1000 * 1000 / 1000;  // ghz(MHz)/CPI
    return { mode: vals.mode, ghz, n, cpi, periodNs, timeSec, mips: (ghz * 1e9) / (cpi * 1e6) };
  },

  render(ctx) {
    const { model: m, stage } = ctx;
    const fmtTime = sec => sec >= 1 ? sec.toFixed(2) + ' s' : sec >= 1e-3 ? (sec * 1e3).toFixed(2) + ' ms' : sec >= 1e-6 ? (sec * 1e6).toFixed(2) + ' μs' : (sec * 1e9).toFixed(2) + ' ns';
    const cards =
      RC408.ui.statCard('平均 CPI', m.cpi.toPrecision(4), m.mode === 'mix' ? '按执行占比加权' : '直接给出', 'text-indigo-600') +
      RC408.ui.statCard('时钟周期', m.periodNs.toPrecision(4) + ' ns', `主频 ${m.ghz} GHz`, 'text-amber-600') +
      RC408.ui.statCard('CPU 执行时间', fmtTime(m.timeSec), `${m.n.toExponential(2)} 条指令`, 'text-emerald-600') +
      RC408.ui.statCard('MIPS', m.mips.toPrecision(5), `= 主频 ÷ (CPI×10⁶)`, 'text-rose-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${cards}</div>
        <div class="rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-mono text-slate-600 leading-relaxed">
          CPU 执行时间 = 指令条数 × CPI ÷ 主频 = ${m.n.toExponential(2)} × ${m.cpi} ÷ (${m.ghz}×10⁹) = <b>${fmtTime(m.timeSec)}</b><br>
          MIPS = 主频 ÷ (CPI × 10⁶) = (${m.ghz}×10⁹) ÷ (${m.cpi}×10⁶) = <b>${m.mips.toPrecision(5)}</b>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>"主频高 ≠ 更快"——还要看 CPI 与指令条数（2012/2017 真题比较两机性能）；
          若只有部分程序时间用于 CPU，提速后总时间要分段计算（2012-12）。
        </div>
      </div>`;
  },

  logs(m) {
    return [
      { type: 'info', text: `主频 ${m.ghz} GHz（时钟周期 ${m.periodNs.toPrecision(4)} ns），平均 CPI = ${m.cpi.toPrecision(4)}${m.mode === 'mix' ? '（加权平均）' : ''}` },
      { type: 'success', text: `${m.n.toExponential(2)} 条指令的 CPU 执行时间 = ${m.timeSec.toPrecision(6)} s` },
      { type: 'info', text: `MIPS = ${m.mips.toPrecision(6)}；若为浮点程序可类似换算 FLOPS（10⁶ 起每级 ×1000）` },
    ];
  },
});
