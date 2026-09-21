'use strict';
/* ============================================================================
 * coa-disk.js —— 【计算机组成原理】磁盘存储器性能计算器（即时）（前缀 _dk）
 * 考情：18 年中 4 年考（选 2 + 大题 3）：选 2013-21、2015-20；大 2013-44、2016-44、2022-44
 * ——平均存取时间 = 寻道 + 旋转延迟 + 传输。
 * （**窗12** 勘误：原记录的题号表漏了 2013-44 这道大题。）
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-disk',
  mode: 'instant',
  title: '磁盘存储器性能计算器',

  theory: `
> **为什么要有它**：磁盘是机械部件，**平均存取时间**由"找到道 + 等到转过来 + 读出来"三段构成，前两段是机械延迟、只有第三段与要读的数据量有关。
> **怎么实现**：平均存取时间 = 平均寻道时间 + 平均旋转延迟 + 传输时间；旋转延迟取**转一圈周期的一半**。
> **记住什么**：三段公式 + **平均旋转延迟 = (60000 ÷ rpm) ÷ 2 毫秒** + 传输时间按"要读多少"算。

## 平均存取时间三段
- **平均寻道时间**：题给，或按"最大道数 ÷ 2"估；
- **平均旋转延迟** = 转一圈周期 ÷ 2；转速 rpm → 周期 = 60 ÷ rpm 秒 = **60000 ÷ rpm 毫秒**；
- **传输时间** = 要读的数据量 ÷ 数据率（读一个扇区 / 一个磁道 / 一整块，量不同结果不同）。

## 考点提醒（易错点）
1. **单位**：rpm → 毫秒 要用 **60000 ÷ rpm**（别写成 60 ÷ rpm）；数据率 = 每道容量 × 每秒转数；
2. **磁盘地址 = 柱面（磁道）号 + 磁头（盘面）号 + 扇区号**，各字段位数按该维度的数量取 log₂（2022-44）；
3. "读一个随机扇区的平均存取时间"是固定问法——**平均**旋转延迟取**半圈**，不要按整圈算；
4. 磁盘**调度**算法（SSTF / SCAN / C-SCAN）另见「磁盘调度」模块，本模块只算**性能**。

> **真题考情**：**4/18 年（选 2 + 大题 3）**：选 2013-21、2015-20；大 2013-44、2016-44、2022-44——
> 固定问法：平均存取时间 = 寻道 + 半圈旋转 + 传输。
`,

  inputs: [
    { key: 'rpm', label: '转速（rpm，转/分）', type: 'select', default: 7200, options: [5400, 7200, 10000, 15000].map(v => ({ v, t: `${v} rpm` })) },
    { key: 'seek', label: '平均寻道时间（ms）', default: '8' },
    { key: 'trackBytes', label: '每磁道容量（KB）', default: '20' },
    { key: 'sectorBytes', label: '要读取的数据量（字节）', default: '4096', help: '如一个 4KB 扇区/块' },
    { key: 'rate', label: '数据传输率（MB/s，可留空用每道容量推）', default: '', ph: '留空则按 每道容量×转/秒 计算' },
  ],

  quickActions: [
    { label: '2015 真题：7200rpm', run(rt) { rt.setInput('rpm', 7200); rt.setInput('seek', '8'); rt.setInput('trackBytes', '20'); rt.setInput('sectorBytes', '4096'); rt.load(); } },
    { label: '2013 真题：10000rpm', run(rt) { rt.setInput('rpm', 10000); rt.setInput('seek', '6'); rt.setInput('trackBytes', '20'); rt.setInput('sectorBytes', '4096'); rt.load(); } },
  ],

  parse(vals) {
    const rpm = parseInt(vals.rpm, 10);
    const seek = Number(vals.seek);
    const trackKB = Number(vals.trackBytes);
    const bytes = Number(vals.sectorBytes);
    if (!(rpm > 0) || !(seek >= 0) || !(trackKB > 0) || !(bytes > 0)) throw { message: '参数须为非负数（寻道时间可为 0）' };
    const rotMs = 60000 / rpm;                       // 转一圈 ms
    const avgRot = rotMs / 2;
    const trackB = trackKB * 1024;
    const rateMBs = vals.rate.trim() === '' ? trackB * (rpm / 60) / 1e6 : Number(vals.rate);
    if (!(rateMBs > 0)) throw { message: '数据传输率须为正' };
    const transMs = bytes / (rateMBs * 1024 * 1024) * 1000;
    const totalMs = seek + avgRot + transMs;
    return { rpm, seek, avgRot, rotMs, trackB, bytes, rateMBs, transMs, totalMs };
  },

  render(ctx) {
    const { model: m, stage } = ctx;
    const f = x => Number(x.toPrecision(4)).toString();
    const cards =
      RC408.ui.statCard('平均寻道时间', f(m.seek) + ' ms', '题给或最大道数÷2', 'text-amber-600') +
      RC408.ui.statCard('平均旋转延迟', f(m.avgRot) + ' ms', `转速周期 ${f(m.rotMs)} ms ÷ 2`, 'text-rose-600') +
      RC408.ui.statCard('传输时间', f(m.transMs) + ' ms', `${m.bytes}B ÷ ${f(m.rateMBs)} MB/s`, 'text-sky-600') +
      RC408.ui.statCard('平均存取时间', f(m.totalMs) + ' ms', '三段之和', 'text-emerald-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${cards}</div>
        <div class="rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-mono text-slate-600 leading-relaxed">
          ① 转一圈 = 60000 ÷ ${m.rpm} = ${f(m.rotMs)} ms<br>
          ② 平均旋转延迟 = ${f(m.rotMs)} ÷ 2 = <b>${f(m.avgRot)} ms</b><br>
          ③ 数据率 = 每道容量 × 转数/秒 = ${f(m.trackB / 1024)}KB × ${(m.rpm / 60).toFixed(1)} = ${f(m.rateMBs)} MB/s（若题给以题为准）<br>
          ④ 传输 ${m.bytes}B = ${f(m.transMs)} ms<br>
          <b style="color:#059669">平均存取时间 = ${f(m.seek)} + ${f(m.avgRot)} + ${f(m.transMs)} = ${f(m.totalMs)} ms</b>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>①"读一个**随机**扇区"旋转延迟取半圈；②若读**整个磁道**则传输 = 转一圈；
          ③扇区地址 = 柱面号 + 磁头号 + 扇区号，位数按各维度取 log（2022-44）；④磁盘调度 SSTF/SCAN 见 os-disk-sched 模块。
        </div>
      </div>`;
  },
});
