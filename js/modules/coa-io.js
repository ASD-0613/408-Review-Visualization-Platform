'use strict';
/* ============================================================================
 * coa-io.js —— 【计算机组成原理】I/O 方式与 CPU 时间占比计算器（即时）（前缀 _io）
 * 考情：18 年中 11 年考（选 9 + 大题 3；大 09-43、12-43、16-44 算占比；
 * 选 10-22、11-22、13-22、19-21、22-21、23-22、24-22、25-21、25-22）。
 * （**窗12** 勘误：原写"17 年中 13 年"且把 16-44 当成选择题。）
 * 三种方式：程序查询 / 程序中断 / DMA，核心公式 = 该方式每秒占用的 CPU 周期 ÷ CPU 每秒总周期。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-io',
  mode: 'instant',
  title: 'I/O 方式 · CPU 时间占比计算器',

  theory: `
> **为什么要有它**：外设比 CPU 慢几个数量级，CPU 若"干等"就白白浪费——I/O 方式的演进（查询 → 中断 → DMA）就是**一步步把 CPU 从等待里解放出来**。
> **怎么实现**：三种方式各有一个"CPU 参与多少次"的口径，占比统一写成 **CPU 为 I/O 花掉的周期数 ÷ 主频（每秒总周期数）**。
> **记住什么**：**占比公式**（次数 × 每次周期数 ÷ 主频）+ **DMA 只算预处理与后处理**（传输期间 CPU 照常执行程序）。

## 三种方式的 CPU 开销
| 方式 | CPU 做什么 | 占比公式 |
| --- | --- | --- |
| **程序查询** | 一直执行查询循环直到设备就绪 | 查询次数 × 每次查询周期数 ÷ 主频 |
| **程序中断** | 每传输一次打断一次（保存现场 + 服务 + 恢复） | 中断次数/秒 × 每次中断周期数 ÷ 主频 |
| **DMA** | 只做预处理 + 后处理，传输由 DMA 控制器完成 | (预处理 + 后处理) × 次数 ÷ 主频 |

## 大题套路
1. 由设备速率换算"每秒传输次数"（如 0.5MB/s ÷ 4B/次 = 125000 次/s）；
2. 中断方式：次数 × 每次中断周期数（含现场保存，题给如 18 + 2 条指令 × CPI）；
3. DMA：**只算预处理 / 后处理**（如每块 500 周期），**传输期间 CPU 照常执行程序**（周期挪用）；
4. 除以主频，得占比。

## 考点提醒（易错点）
1. **占比的分母是主频（每秒总周期数）**，不是"传输次数"；
2. **DMA 传输期间 CPU 仍可执行程序**——只有争用总线 / Cache 时才暂停（2012-43 问优先级）；
3. **DMA 请求优先级高于 CPU 取指**（否则丢数据）；键盘 / 打印机这类慢速字符设备**不适合 DMA**（2025-21）；
4. 中断服务程序逐字节搬运（每次几个字节），省硬件但 CPU 参与度高。

> **真题考情**：**11/18 年（选 9 + 大题 3）**：大 2009-43、2012-43、2016-44（都算 CPU 时间占比）；
> 选 2010-22、2011-22、2013-22、2019-21、2022-21、2023-22、2024-22、2025-21、2025-22。
`,

  inputs: [
    { key: 'ghz', label: 'CPU 主频（GHz）', default: '0.5', help: '如 0.5 GHz = 5×10⁸ 周期/秒（2009 真题）' },
    { key: 'cpi', label: '平均 CPI', default: '4' },
    { key: 'devRate', label: '设备数据率（MB/s）', default: '0.5' },
    { key: 'unit', label: '每次传输单位（字节）', type: 'select', default: 4, options: [{ v: 1, t: '1 B（字节）' }, { v: 4, t: '4 B（32 位字）' }, { v: 500, t: '500 B（块）' }, { v: 5000, t: '5000 B' }] },
    { key: 'intCycles', label: '中断方式：每次中断的总周期数', default: '80', help: '如服务程序 18 条 × CPI 4 + 开销 8 = 80（2009 真题口径：指令数 × CPI + 中断处理）' },
    { key: 'dmaCycles', label: 'DMA 方式：每次预处理+后处理周期数', default: '500' },
    { key: 'block', label: 'DMA：每块大小（字节）', default: '5000' },
  ],

  quickActions: [
    { label: '2009 大题原参数', run(rt) { rt.setInput('ghz', '0.5'); rt.setInput('cpi', '4'); rt.setInput('devRate', '0.5'); rt.setInput('unit', 4); rt.setInput('intCycles', '80'); rt.setInput('dmaCycles', '500'); rt.setInput('block', '5000'); rt.load(); } },
  ],

  parse(vals) {
    const ghz = Number(vals.ghz), cpi = Number(vals.cpi), devRate = Number(vals.devRate);
    const unit = parseInt(vals.unit, 10), intCycles = Number(vals.intCycles), dmaCycles = Number(vals.dmaCycles);
    const block = parseInt(vals.block, 10);
    if (!(ghz > 0 && cpi > 0 && devRate > 0 && unit > 0 && intCycles > 0 && dmaCycles > 0 && block > 0)) {
      throw { message: '所有数值须为正数' };
    }
    const cpuCyclesPerSec = ghz * 1e9;
    const opsPerSec = devRate * 1e6 / unit;                    // 每秒传输次数
    /* 查询方式：假设每秒必须查询 opsPerSec 次（每次 opCycles = 2 个周期） */
    const queryCycles = opsPerSec * 2;
    const intCyclesPerSec = opsPerSec * intCycles;
    const dmaOpsPerSec = devRate * 1e6 / block;
    const dmaCyclesPerSec = dmaOpsPerSec * dmaCycles;
    return {
      ghz, cpi, cpuCyclesPerSec, devRate, unit, opsPerSec,
      queryPct: queryCycles / cpuCyclesPerSec,
      intPct: intCyclesPerSec / cpuCyclesPerSec,
      dmaPct: dmaCyclesPerSec / cpuCyclesPerSec,
      intCycles, dmaCycles, intCyclesPerSec, dmaOpsPerSec, dmaCyclesPerSec,
    };
  },

  render(ctx) {
    const { model: m, stage } = ctx;
    const pct = x => (x * 100).toPrecision(3) + '%';
    const cards =
      RC408.ui.statCard('程序查询占比', pct(m.queryPct), `每秒查询 ${m.opsPerSec.toExponential(2)} 次 × 2 周期`, 'text-rose-600') +
      RC408.ui.statCard('中断方式占比', pct(m.intPct), `每秒中断 ${m.intCyclesPerSec.toExponential(2)} 次 × ${m.intCycles} 周期`, 'text-amber-600') +
      RC408.ui.statCard('DMA 占比', pct(m.dmaPct), `每秒 ${m.dmaOpsPerSec.toExponential(2)} 块 × ${'${'}}`, 'text-emerald-600') +
      RC408.ui.statCard('CPU 每秒总周期', m.cpuCyclesPerSec.toExponential(2), `主频 ${m.ghz} GHz`, 'text-indigo-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${cards}</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm leading-relaxed">
          <div class="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-rose-900">
            <b>① 程序查询</b><br>= ${m.opsPerSec.toExponential(2)} × 2 ÷ ${m.cpuCyclesPerSec.toExponential(2)}<br>
            <b>${pct(m.queryPct)}</b><span class="text-xs">（全程忙等，占比最高）</span>
          </div>
          <div class="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-amber-900">
            <b>② 程序中断</b><br>= ${m.opsPerSec.toExponential(2)} × ${m.intCycles} ÷ ${m.cpuCyclesPerSec.toExponential(2)}<br>
            <b>${pct(m.intPct)}</b><span class="text-xs">（每传输打断一次）</span>
          </div>
          <div class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-emerald-900">
            <b>③ DMA</b><br>= ${m.dmaOpsPerSec.toExponential(2)} × ${m.dmaCycles} ÷ ${m.cpuCyclesPerSec.toExponential(2)}<br>
            <b>${pct(m.dmaPct)}</b><span class="text-xs">（仅预/后处理）</span>
          </div>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>2009 大题口径</b>：设备 0.5MB/s、按 4B/次中断（服务 18 条 + 2 条开销 ×CPI=4 → 80 周期）→ 中断占比 = 125000×80 ÷ 0.5G；
          DMA 5MB/s、5000B/块、每块 500 周期预处理 → 占比仅 0.5%。<b>结论：查询 > 中断 > DMA</b>，设备越快越应用 DMA；
          DMA 传输期间 CPU 可执行程序，仅在挪用总线周期时暂停。
        </div>
      </div>`;
  },
});
