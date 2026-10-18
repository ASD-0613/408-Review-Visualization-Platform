'use strict';
/* ============================================================================
 * coa-io.js —— 【计算机组成原理】I/O 方式与 CPU 时间占比计算器（即时）（前缀 _io）
 * 考情：18 年中 **16 年**考（选 15 + 大题 3）：大 2009-43、2012-43、2016-44（都算 CPU 时间占比）；
 * 选 2010-22、2011-22、2013-22、2014-21、2015-21、2017-32、2019-21·22、2020-22、2022-21、2023-22、
 * 2024-22、2025-21·22、2026-32。
 * （**窗12/窗42** 勘误：旧行写"17 年中 13 年"、"选 9"，且把 16-44 当成选择题；本行已按 RC408.examHistory 现算重写。）
 * 三种方式：程序查询 / 程序中断 / DMA，核心公式 = 该方式每秒占用的 CPU 周期 ÷ CPU 每秒总周期。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-io',
  mode: 'instant',
  title: 'I/O 方式 · CPU 时间占比计算器',

  theory: `
> **为什么要有它**：外设比 CPU 慢几个数量级，CPU 若"干等"就白白浪费——I/O 方式的演进（查询 → 中断 → DMA → 通道）就是**一步步把 CPU 从等待里解放出来**，而真题年年只问一件事：**CPU 为这次 I/O 花了多少时间**。
> **怎么实现**：三种方式各有一个"CPU 参与多少次"的口径，占比统一写成 **CPU 为 I/O 花掉的周期数 ÷ 主频（每秒总周期数）**。
> **记住什么**：**占比公式**（次数 × 每次周期数 ÷ 主频）+ **DMA 只算预处理与后处理**（传输期间 CPU 照常执行程序）+ **中断方式按"每次传多少字节"折算中断次数**。

## 三种方式的工作流程

| 方式 | CPU 做什么 | 谁搬数据 | 响应时机 |
| --- | --- | --- | --- |
| **程序查询**（轮询） | 反复读状态端口，设备没就绪就继续查 | **CPU** | CPU 主动查 |
| **程序中断** | 设备就绪后发中断，CPU 响应后执行服务程序搬数据 | **CPU**（服务程序里） | 设备主动请求 |
| **DMA** | 只在开始前初始化、结束后处理，中间不管 | **DMA 控制器**（硬件） | 设备 / 控制器请求占用总线 |

- **程序查询的代价**：查询循环里 CPU 什么正事也干不了，设备越慢浪费越多；
- **中断方式的代价**：每传**一次**（或一小批）就要一次响应 + 保存现场 + 恢复现场，次数一多开销就上来；
- **中断 I/O 的通路**：设备就绪 → 接口置状态、发中断请求 → CPU 响应（关中断、保存断点、识别中断源）→ **服务程序从数据端口把数据读进内存缓冲区**，全程**不经过主存地址线**（数据只在端口与寄存器 / 内存缓冲区之间搬）；
- **中断 I/O 的隐患**：设备准备数据比 CPU 处理快时，新数据会**覆盖**缓冲区里还没取走的数据，所以字符设备要配缓冲区或流控；
- **DMA 的前提**：设备速度快、数据块大（磁盘、网卡、固态硬盘适合；**键盘、打印机这类慢速字符设备不适合**，2025-21）。

## CPU 开销占比：统一口径

| 方式 | 分母 / 分子 | 说明 |
| --- | --- | --- |
| 程序查询 | (查询次数 × 每次查询周期数) ÷ 主频 | 查询次数 = 传输次数（每次传完还要再查） |
| 程序中断 | (中断次数 × 每次中断周期数) ÷ 主频 | 每次中断周期数含保存现场 + 服务 + 恢复 |
| DMA | (预处理 + 后处理周期数 × 次数) ÷ 主频 | **传输期间 CPU 照常执行程序**，不计入 |

- 分母永远是**主频（每秒总周期数）**，不是"传输次数"；
- 传输次数 = 设备速率 ÷ 每次传送字节数（如 0.5MB/s ÷ 4B/次 = 125000 次/s）。

## DMA 的三种传送方式（与 CPU 抢主存的三种协议）

| 方式 | 做法 | 特点 |
| --- | --- | --- |
| **停止 CPU 访存** | DMA 工作时让 CPU 停止访存（只让出总线） | 控制简单、传输快，但 CPU 长时间不能访存 |
| **周期挪用**（周期窃取） | DMA 每传一个字就"偷"一个存储周期，偷完立刻还给 CPU | 兼顾 CPU 与 DMA，**最常用** |
| **DMA 与 CPU 交替访存** | 把存储周期分成两半，一半给 CPU、一半给 DMA | 不需要申请总线，时序固定 |

- **DMA 与中断的关键区别**：中断是**程序切换**（要保存 / 恢复现场，靠软件搬数据，**申请的是 CPU 时间**），DMA 是**硬件接管总线**（不切换程序、不保存现场，**申请的是总线使用权**）；DMA 请求的优先级**高于中断**（否则高速设备会丢数据）；
- **DMA 的完整流程**：CPU 预处理（在主存里组织**命令块**：设备地址、主存起始地址、字数、方向）→ 写控制寄存器**启动** DMA → 控制器**申请总线使用权**、得到响应后逐字传送 → 全部传完由控制器发**中断**，CPU 做后处理；
- **DMA 控制器**里有：地址寄存器（主存地址）、字计数器（还剩多少字）、数据缓冲寄存器、控制 / 状态寄存器（命令块与状态都经这些端口交换）。

## 大题套路（四步）

1. 由设备速率换算"每秒传输次数"（速率 ÷ 每次字节数）；
2. 按方式选口径：查询 = 每次查询周期数 × 次数；中断 = 每次中断周期数 × 次数；DMA = 预处理 + 后处理 × 次数；
3. 乘起来得到每秒占用周期数；
4. 除以主频得占比（再乘 100% 就是百分比）。

## 考点提醒（易错点）

1. **占比的分母是主频**，不是"传输次数"；
2. **DMA 传输期间 CPU 仍可执行程序**——只有争用总线 / 主存时才暂停（2012-43 问的就是这个）；
3. **DMA 请求优先级高于 CPU 取指**（否则丢数据）；慢速字符设备（键盘、打印机）适合中断、不适合 DMA（2025-21）；
4. **中断服务程序逐字节 / 逐字搬运**，省硬件但 CPU 参与度高；DMA 靠硬件搬，CPU 只在两头参与；
5. 中断方式的"每次传送字节数"决定中断次数：一次传得多、中断次数就少——题目给"每次中断传 4B"时别按 1B 算。

> **真题考情**：**16/18 年（选 15 + 大题 3）**：选 2010-22、2011-22、2013-22、2014-21、2015-21、2017-32、2019-21·22、
> 2020-22、2022-21、2023-22、2024-22、2025-21·22、2026-32；大 2009-43、2016-44（算 CPU 时间占比）、2012-43（问总线带宽、DMA 请求次数与优先级，不只算占比）。
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
      RC408.ui.statCard('DMA 占比', pct(m.dmaPct), `每秒 ${m.dmaOpsPerSec.toExponential(2)} 块 × ${m.dmaCycles} 周期`, 'text-emerald-600') +
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
