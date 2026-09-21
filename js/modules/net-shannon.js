'use strict';
/* ============================================================================
 * net-shannon.js —— 【计算机网络】奈奎斯特定理与香农定理（即时计算器）（前缀 _ph）
 * 考情（窗13 用 RC408.examHistory 现算）：18 年中 11 年考、全为选择题（2009·2011·2013·2015·2016·2017·
 * 2022·2023·2024·2025·2026 的 34 题），两种问法：
 * ① 无噪声：求极限速率（奈奎斯特）；② 有噪声：香农容量 + dB↔比值换算；实际速率取两者较小。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-shannon',
  mode: 'instant',
  title: '物理层 · 奈奎斯特定理与香农定理',

  theory: `
> **为什么要有它**：物理层的核心问题是"**一条信道最高能传多快**"——奈奎斯特给出无噪声时由带宽与码元状态数决定的极限，香农给出有噪声时由带宽与信噪比决定的极限。
> **怎么实现**：奈氏极限 = 2W·log₂V bps（码元速率 ≤ 2W 波特）；香农容量 = W·log₂(1 + S/N)；S/N 常由 dB 换算（dB = 10·log₁₀(S/N)）。
> **记住什么**：两个公式 + **实际速率取两者较小值**（两个限制同时成立）。

## 两大定理
| 定理 | 公式 | 适用 |
| --- | --- | --- |
| **奈奎斯特** | \\(2W\\log_2 V\\) bps（W 为 Hz，V 为码元状态数） | **无噪声**信道；码元速率 ≤ 2W 波特 |
| **香农** | \\(C = W\\log_2(1 + S/N)\\) | **有噪声**信道；S/N 为线性比值 |

- 码元速率 × log₂V = 数据速率；V = 2^n 即每码元 n bit；带宽翻倍 ⇒ 两类极限都翻倍；
- dB ↔ 比值：30dB ⇒ S/N = 1000；20dB ⇒ 100；（求 dB 就代 10·log₁₀）。

## 考点提醒（易错点）
1. **"取较小"别忘**：有噪声信道两个定理都要满足，能用的速率 = min(奈氏, 香农)——2017-34 的解析就是"用奈奎斯特定理算无噪极限、用香农算有噪极限"，2026-34 还要再把分组发送时延算上；
2. **V 与 n 的换算**：V = 2^n（4 种相位 ⇒ 2 bit/码元；16 种状态 ⇒ 4 bit/码元）；
3. 反解题型：给目标速率与信噪比 ⇒ 先算香农容量，再由 2W·log₂V ≥ 速率解出**最少状态数 V**；
4. **时延是另一条线**：分组发送时延 L/R 与传播时延 D 别与极限速率混着算（2026-34 两者都考）。

> **真题考情**：**11/18 年（全为选择题，几乎每年一道）**：2009-34、2011-34、2013-34、2015-34、2016-34、
> 2017-34、2022-34、2023-34、2024-34、2025-34、2026-34；固定套路是奈氏与香农联立取 min，或反求 V / S/N。
`,

  inputs: [
    { key: 'W', label: '信道带宽 W（Hz）', default: '3000', help: '如 3000（3kHz 语音）、4000' },
    { key: 'V', label: '码元状态数 V（如 2/4/16/256）', default: '16', help: 'QAM-16 即 16 种状态 = 4 bit/码元' },
    { key: 'snMode', label: '信噪比输入方式', type: 'select', default: 'db',
      options: [{ v: 'db', t: '以 dB 给出' }, { v: 'ratio', t: '以线性比值给出' }] },
    { key: 'sn', label: '信噪比（按上方方式）', default: '30', help: '30 表示 30dB；或线性比值 1000' },
  ],

  quickActions: [
    { label: '2009 真题：3kHz QAM-16', run(rt) { rt.setInput('W', '3000'); rt.setInput('V', '16'); rt.setInput('snMode', 'db'); rt.setInput('sn', '30'); rt.load(); } },
    { label: '2016 真题：8kHz 30dB 50%', run(rt) { rt.setInput('W', '8000'); rt.setInput('V', '2'); rt.setInput('snMode', 'db'); rt.setInput('sn', '30'); rt.load(); } },
    { label: '2022 真题：200kHz ASK', run(rt) { rt.setInput('W', '200000'); rt.setInput('V', '4'); rt.setInput('snMode', 'ratio'); rt.setInput('sn', '1023'); rt.load(); } },
  ],

  parse(vals) {
    const W = Number(vals.W), V = Number(vals.V);
    const sn = Number(vals.sn);
    if (!(W > 0)) throw { message: '带宽 W 须为正数' };
    if (!Number.isInteger(V) || V < 2) throw { message: '码元状态数 V 须为 ≥2 的整数' };
    if (!(sn > 0)) throw { message: '信噪比须为正数' };
    const snRatio = vals.snMode === 'db' ? Math.pow(10, sn / 10) : sn;
    const nyquist = 2 * W * Math.log2(V);
    const shannon = W * Math.log2(1 + snRatio);
    const dB = vals.snMode === 'db' ? sn : 10 * Math.log10(sn);
    return { W, V, snRatio, dB, nyquist, shannon, actual: Math.min(nyquist, shannon) };
  },

  render(ctx) {
    const { model: m, stage } = ctx;
    const fmt = x => x >= 1e6 ? (x / 1e6).toPrecision(4) + ' Mbps' : x >= 1e3 ? (x / 1e3).toPrecision(4) + ' kbps' : Math.round(x * 100) / 100 + ' bps';
    const limited = m.nyquist <= m.shannon ? '奈奎斯特（码元状态数不足）' : '香农（噪声限制）';
    const cards =
      RC408.ui.statCard('奈奎斯特极限', fmt(m.nyquist), `2W·log₂V = 2×${m.W}×log₂${m.V}`, 'text-sky-600') +
      RC408.ui.statCard('香农容量', fmt(m.shannon), `W·log₂(1+S/N)，S/N = ${m.snRatio.toPrecision(6)}`, 'text-emerald-600') +
      RC408.ui.statCard('实际最大速率', fmt(m.actual), `= min(两者) —— 受${limited}限制`, 'text-indigo-600') +
      RC408.ui.statCard('每码元比特数', `${Math.log2(m.V)} bit`, `V = ${m.V} = 2^${Math.log2(m.V)}`, 'text-amber-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${cards}</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm text-sky-900 leading-relaxed">
            <b>① 奈奎斯特（无噪声）</b><br>
            极限速率 = 2W·log₂V = 2×${m.W} × log₂${m.V} = <b>${fmt(m.nyquist)}</b><br>
            <span class="text-xs text-sky-700">波特率上限 2W = ${2 * m.W} 波特；每波特 ${Math.log2(m.V)} bit</span>
          </div>
          <div class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900 leading-relaxed">
            <b>② 香农（有噪声）</b><br>
            容量 = W·log₂(1+S/N)，S/N = ${m.snRatio.toPrecision(6)}（${m.dB.toFixed(1)} dB）<br>
            = <b>${fmt(m.shannon)}</b>
          </div>
        </div>
        <div class="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-900 leading-relaxed">
          💡 <b>判断：</b>实际可达速率 = min(${fmt(m.nyquist)}, ${fmt(m.shannon)}) = <b>${fmt(m.actual)}</b>，
          本次受<b>${limited}</b>限制。${m.nyquist <= m.shannon ? '想突破需提高码元状态数 V（但状态数太多对信噪比要求苛刻）。' : '想突破需提高信噪比或带宽。'}
        </div>
        <div class="rounded-xl bg-white border border-slate-200 px-4 py-3 text-xs font-mono text-slate-600">
          dB 换算：${m.dB.toFixed(1)} dB = 10·log₁₀(S/N) → S/N = 10^(${m.dB.toFixed(1)}/10) = ${m.snRatio.toPrecision(6)}
        </div>
      </div>`;
  },

  logs(m) {
    return [
      { type: 'info', text: `带宽 W = ${m.W} Hz，码元状态数 V = ${m.V}（${Math.log2(m.V)} bit/码元），信噪比 ${m.dB.toFixed(1)} dB（S/N ≈ ${m.snRatio.toPrecision(6)}）` },
      { type: 'info', text: `奈奎斯特极限 = 2W·log₂V = ${m.nyquist.toPrecision(8)} bps` },
      { type: 'info', text: `香农容量 = W·log₂(1+S/N) = ${m.shannon.toPrecision(8)} bps` },
      { type: 'success', text: `实际最大数据速率 = min(两者) = ${m.actual.toPrecision(8)} bps = ${fmt2(m.actual)}` },
    ];
  },
});

function fmt2(x) { return x >= 1e6 ? (x / 1e6).toPrecision(4) + ' Mbps' : x >= 1e3 ? (x / 1e3).toPrecision(4) + ' kbps' : Math.round(x * 100) / 100 + ' bps'; }
