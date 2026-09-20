'use strict';
/* ============================================================================
 * coa-disk.js —— 【计算机组成原理】磁盘存储器性能计算器（即时）（前缀 _dk）
 * 考情：2013-21、2015-20、2016-44、2022-44——平均存取时间 = 寻道 + 旋转延迟 + 传输。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-disk',
  mode: 'instant',
  title: '磁盘存储器性能计算器',

  theory: `
> **真题考情**：2013-21、2015-20、2016-44、2022-44；"读一个随机扇区的平均存取时间"是固定问法。

## 平均存取时间三段
\`\`\`text
平均存取时间 = 平均寻道时间 + 平均旋转延迟 + 传输时间
             = 寻道（题给或 最大道数÷2） + 转速周期÷2 + 目标数据量 ÷ 数据率
\`\`\`
- 转速 rpm → 转/秒 = rpm÷60 → 转一圈周期 = 60000/rpm ms；**平均旋转延迟 = 周期÷2**；
- 传输时间按"要读多少"算（一个扇区 / 一个磁道 / 一块），用数据率或"转一圈 × 扇区占比"。

## 考点提示
- 磁盘地址 = 柱面(磁道)号 + 磁头(盘面)号 + 扇区号，位数按各维度数量取 log（2022-44）；
- 数据率 = 每道容量 × 每秒转数（内圈外圈同速率时按格式化容量算）；
- 磁盘调度算法（SSTF/SCAN）见 os-disk-sched 模块。
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
