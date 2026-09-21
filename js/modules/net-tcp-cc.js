'use strict';
/* ============================================================================
 * net-tcp-cc.js —— 【计算机网络】TCP 拥塞控制（慢启动/拥塞避免/快重传快恢复）
 * ----------------------------------------------------------------------------
 * 真题考情（窗13 用 RC408.examHistory 现算）：18 年中 9 年考拥塞控制（选 6 = 2009·2010·2014·2015·2022·2025；
 * 大 3 = 2016-41·2023-47·2026-47），固定题型："第 k 个 RTT 后拥塞窗口多大 / 何时到达阈值 / 丢包后如何变化"。
 *
 * 快照设计：每个 RTT 一帧（丢包时追加一帧"处置"）：
 *   { rtt          当前 RTT 序号
 *     cwndBefore/cwndAfter   本 RTT 前/后的拥塞窗口（MSS 为单位）
 *     ssthresh      当前阈值（超时/快恢复时减半更新）
 *     phase:'slow'|'ca'|'loss-timeout'|'loss-3dup'
 *     history       [{rtt, cwnd, phase, loss}] 已走过的轨迹（渲染折线） }
 * 规则（教材口径）：慢启动每 RTT 翻倍（上限截到 ssthresh），cwnd ≥ ssthresh 后
 * 转拥塞避免每 RTT +1；超时 → ssthresh=cwnd/2、cwnd=1 重新慢启动；
 * 收到 3 个重复确认 → 快重传 + 快恢复：ssthresh=cwnd/2、cwnd=ssthresh，直接转拥塞避免。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-tcp-cc',
  mode: 'stepper',
  title: 'TCP 拥塞控制（慢启动 · 拥塞避免 · 快重传）',

  theory: `
> **为什么要有它**：网络是共享的，若所有发送方都按自己的最大速率猛发，路由器缓冲区一满就大规模丢包、吞吐反而崩塌——**拥塞控制让发送方从"试探网络容量"开始，遇堵就退**。
> **怎么实现**：慢启动（每 RTT 翻倍）→ 到 ssthresh 转拥塞避免（每 RTT +1）；**超时** → ssthresh = cwnd/2、cwnd = 1 重新慢启动；**3 个重复 ACK** → 快重传 + 快恢复：ssthresh = cwnd/2、cwnd = ssthresh，直接进拥塞避免。
> **记住什么**：四条规则 + **发送窗口 = min(cwnd, rwnd)**；两种丢包信号对应两种"退多少"。

## 四条规则（教材口径）
| 事件 | ssthresh | cwnd | 随后 |
| --- | --- | --- | --- |
| 慢启动中每 RTT | 不变 | **×2**（翻过 ssthresh 时截到 ssthresh） | cwnd ≥ ssthresh 后转拥塞避免 |
| 拥塞避免中每 RTT | 不变 | **+1 MSS** | 线性增长 |
| **超时** | **cwnd/2** | **1** | 重新慢启动 |
| **3 个重复 ACK** | **cwnd/2** | **= ssthresh** | 快重传后直接拥塞避免（快恢复） |

## 为什么两种丢包处置不同（真题辨析点）
- **超时**说明网络很可能真的堵死了 ⇒ 彻底收缩（cwnd = 1、重新慢启动）；
- **3 个重复 ACK**说明**后续报文还能到达**（否则触发不了重复确认）⇒ 只丢了个别段，减半即可。

## 手算模板（考场直接套）
1. 列 RTT 表逐拍推：1 → 2 → 4 → …（到 ssthresh 截住），之后每拍 +1；
2. 丢包那一拍**先算完本拍的正常增长，再执行超时 / 快恢复**改 ssthresh 与 cwnd；
3. 问"第 k 个 RTT 后 cwnd 多大"，先看清 k 从**哪个 RTT 数起**（题目口径 0 起还是 1 起）。

## 考点提醒（易错点）
1. **发送窗口 = min(cwnd, rwnd)**：题目给了接收窗口就必须取小——2025-38 的解析原话就是"实际发送窗口 = min(拥塞窗口, 接收窗口)"；
2. 慢启动的翻倍**只发生在还小于 ssthresh 时**，一旦 cwnd ≥ ssthresh 立刻转线性 +1，别一直翻倍；
3. 超时与"3 个重复 ACK"的**新 ssthresh 都是 cwnd/2**，区别只在 cwnd 回到 1 还是回到 ssthresh。

> **真题考情**：**9/18 年（选 6 + 大题 3）**：选 2009-39、2010-39、2014-38、2015-39、2022-38、2025-38；
> 大 2016-41、2023-47、2026-47（固定问法："经过 k 个 RTT 后 cwnd 多大 / 丢包后回到多少"）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'ssthresh0', label: '初始慢启动阈值 ssthresh（MSS 个数）', type: 'select', default: 8, options: [2, 4, 8, 12, 16].map(v => ({ v, t: `${v} MSS` })) },
    {
      key: 'events', label: '丢包事件（RTT:类型，逗号分隔）', wide: true,
      default: '6:timeout, 14:3dup',
      help: '类型：timeout=超时 / 3dup=收到3个重复确认；如 "6:timeout, 14:3dup"',
    },
    { key: 'rtts', label: '演示总时长（RTT 个数）', type: 'select', default: 24, options: [16, 24, 32, 40].map(v => ({ v, t: `${v} 个 RTT` })) },
  ],

  quickActions: [
    { label: '纯增长(无丢包)', run(rt) { rt.setInput('events', ''); rt.setInput('rtts', 16); rt.load(); } },
    { label: '双重超时示例', run(rt) { rt.setInput('ssthresh0', 16); rt.setInput('events', '4:timeout, 12:timeout, 20:3dup'); rt.setInput('rtts', 28); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const ssthresh0 = parseInt(vals.ssthresh0, 10);
    const rtts = parseInt(vals.rtts, 10);
    const events = [];
    vals.events.split(/[,，；;]+/).map(x => x.trim()).filter(Boolean).forEach(tok => {
      const m = tok.match(/^(?:RTT\s*)?(\d+)\s*[:：]\s*(timeout|3dup|3dupack)$/i);
      if (!m) throw { message: `丢包事件「${tok}」格式错误，应为 RTT:类型，如 6:timeout 或 14:3dup` };
      const rtt = parseInt(m[1], 10);
      if (rtt < 1 || rtt > rtts) throw { message: `丢包事件 RTT=${rtt} 超出演示范围 1~${rtts}` };
      events.push({ rtt, type: m[2].toLowerCase() === 'timeout' ? 'timeout' : '3dup' });
    });
    events.sort((a, b) => a.rtt - b.rtt);
    for (let i = 1; i < events.length; i++) {
      if (events[i].rtt === events[i - 1].rtt) throw { message: `RTT ${events[i].rtt} 处定义了两个丢包事件` };
      if (events[i].rtt - events[i - 1].rtt < 2) throw { message: '两个丢包事件之间至少间隔 2 个 RTT（丢包后需要时间恢复）' };
    }
    return { ssthresh0, rtts, events };
  },

  /* ---------------- ② 纯算法：逐 RTT 推演 ---------------- */
  buildSnapshots(model) {
    const { ssthresh0, rtts, events } = model;
    const evMap = {}; events.forEach(e => { evMap[e.rtt] = e.type; });

    let cwnd = 1, ssthresh = ssthresh0;
    const history = [];
    const snaps = [];
    const state = () => ({ history: history.map(h => ({ ...h })), cwnd, ssthresh });

    snaps.push({
      step: 'init', ...state(), rtt: 0, cwndBefore: null, cwndAfter: cwnd, phase: 'init',
      log: `就绪：cwnd = 1 MSS，ssthresh = ${ssthresh0} MSS。每个 RTT 推进一步，共 ${rtts} 个 RTT${events.length ? `，丢包事件：${events.map(e => `RTT ${e.rtt}（${e.type === 'timeout' ? '超时' : '3 个重复 ACK'}）`).join('、')}` : '（无丢包）'}。`,
      logType: 'info',
      desc: '点击「单步执行」：每个 RTT 推进一格，观察折线由指数转线性、丢包处阶跃下降',
    });

    for (let t = 1; t <= rtts; t++) {
      const cwndBefore = cwnd;
      let phase, lossType = null;

      /* 先按当前阶段正常增长 */
      if (cwnd < ssthresh) {
        cwnd = Math.min(cwnd * 2, ssthresh);          // 慢启动（翻倍，截到阈值）
        phase = 'slow';
      } else {
        cwnd = cwnd + 1;                              // 拥塞避免
        phase = 'ca';
      }

      /* 本 RTT 结束时是否丢包 */
      if (evMap[t]) {
        lossType = evMap[t];
        const atLoss = cwnd;
        const newSsthresh = Math.floor(atLoss / 2);
        ssthresh = newSsthresh;
        const oldCwnd = cwnd;
        if (lossType === 'timeout') {
          cwnd = 1;
        } else {
          cwnd = ssthresh;                            // 快恢复：回到新阈值，直接转拥塞避免
        }
        history.push({ rtt: t, cwnd: cwndBefore, phase, loss: lossType, after: cwnd, ssthresh });
        snaps.push({
          step: 'loss', ...state(), rtt: t, cwndBefore, cwndAfter: cwnd, phase: lossType === 'timeout' ? 'loss-timeout' : 'loss-3dup',
          lossAt: atLoss, oldSsthresh: null,
          log: lossType === 'timeout'
            ? `RTT ${t} 发生**超时**（此时 cwnd = ${atLoss}）→ ssthresh = ${atLoss}/2 = ${newSsthresh}，cwnd 重置为 1，重新慢启动（网络疑似严重拥塞，最保守处理）`
            : `RTT ${t} 收到 **3 个重复 ACK**（快重传触发）→ ssthresh = ${atLoss}/2 = ${newSsthresh}，cwnd = ${newSsthresh}（快恢复，直接进入拥塞避免，不回到 1）`,
          logType: 'error',
          desc: lossType === 'timeout'
            ? `超时！ssthresh=${newSsthresh}，cwnd=${oldCwnd} → 1`
            : `快重传+快恢复！ssthresh=${newSsthresh}，cwnd=${oldCwnd} → ${newSsthresh}`,
        });
      } else {
        history.push({ rtt: t, cwnd, phase, loss: null });
        snaps.push({
          step: 'rtt', ...state(), rtt: t, cwndBefore, cwndAfter: cwnd, phase,
          log: `RTT ${t}：${phase === 'slow'
            ? `慢启动——cwnd ${cwndBefore} → ${cwnd}（每 RTT 翻倍，超过 ssthresh=${ssthresh} 时截断）${cwnd >= ssthresh ? '，已到达阈值 → 下一步转入拥塞避免' : ''}`
            : `拥塞避免——cwnd ${cwndBefore} → ${cwnd}（每 RTT +1 MSS 线性爬升）`}`,
          logType: phase === 'slow' ? 'warn' : 'info',
          desc: `${phase === 'slow' ? '慢启动' : '拥塞避免'}：cwnd = ${cwnd} MSS`,
        });
      }
    }

    snaps.push({
      step: 'done', ...state(), rtt: rtts, cwndBefore: cwnd, cwndAfter: cwnd, phase: 'init',
      log: `演示结束：${rtts} 个 RTT 后 cwnd = ${cwnd} MSS，ssthresh = ${ssthresh} MSS。考场速查：慢启动翻倍、拥塞避免加一、超时归一、快恢复减半。`,
      logType: 'success',
      desc: `完成！最终 cwnd = ${cwnd}，ssthresh = ${ssthresh}`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const pts = s.history;
    const n = pts.length || 1;
    const maxCwnd = Math.max(...pts.map(p => p.cwnd), s.ssthresh, 4) + 2;
    const W = 720, H = 400, padL = 46, padB = 34, padT = 18, padR = 16;
    const px = r => padL + ((r - 0.5) / Math.max(n, 8)) * (W - padL - padR);
    const py = c => H - padB - ((c - 0.5) / Math.max(maxCwnd, 8)) * (H - padB - padT);

    /* 阶段背景分带（当前阈值线） */
    const ssthreshY = py(s.ssthresh);
    let polyline = '';
    let prev = null;
    pts.forEach(p => {
      if (prev && p.loss) polyline += `<line x1="${px(prev.rtt)}" y1="${py(prev.cwnd)}" x2="${px(p.rtt)}" y2="${py(prev.cwnd)}" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      polyline += `<line x1="${px(p.rtt)}" y1="${py(p.cwnd)}" x2="${px(p.rtt)}" y2="${py(p.cwnd)}" stroke="none"/>`;
      prev = p;
    });
    // 折线（到当前点）
    let path = '';
    pts.forEach((p, i) => { path += `${i ? 'L' : 'M'}${px(p.rtt).toFixed(1)},${py(p.cwnd).toFixed(1)} `; });
    const lineSvg = pts.length > 1 ? `<path d="${path}" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linejoin="round"/>` : '';

    const dots = pts.map(p => {
      const lossColor = p.loss === 'timeout' ? '#e11d48' : p.phase === 'loss-3dup' ? '#e11d48' : null;
      const color = p.loss ? '#e11d48' : p.phase === 'slow' ? '#f59e0b' : '#059669';
      const isCur = p.rtt === pts.length;
      return `
        ${p.loss ? `<text x="${px(p.rtt)}" y="${py(p.cwnd) - 14}" text-anchor="middle" style="font:800 13px sans-serif" fill="#e11d48">✕</text>
        <text x="${px(p.rtt)}" y="${py(p.cwnd) + 20}" text-anchor="middle" style="font:700 9.5px sans-serif" fill="#e11d48">${p.loss === 'timeout' ? '超时→1' : '快恢复→' + p.after}</text>` : ''}
        <circle cx="${px(p.rtt)}" cy="${py(p.cwnd)}" r="${isCur ? 5.5 : 3.5}" fill="${color}" ${isCur ? 'stroke="#fff" stroke-width="2"' : ''}/>
        ${p.rtt % Math.max(Math.round(n / 12), 1) === 0 || isCur || p.loss ? `<text x="${px(p.rtt)}" y="${py(p.cwnd) - 6}" text-anchor="middle" style="font:600 9.5px Consolas,monospace" fill="#475569">${p.cwnd}</text>` : ''}`;
    }).join('');

    /* 坐标轴刻度 */
    const yTicks = [];
    const yStep = Math.max(Math.ceil(maxCwnd / 8), 1);
    for (let c = yStep; c <= maxCwnd - 1; c += yStep) {
      yTicks.push(`<line x1="${padL}" y1="${py(c)}" x2="${W - padR}" y2="${py(c)}" stroke="#f1f5f9"/><text x="${padL - 6}" y="${py(c) + 3.5}" text-anchor="end" style="font:600 10px Consolas" fill="#94a3b8">${c}</text>`);
    }
    const xTicks = [];
    const xStep = Math.max(Math.round(n / 12), 1);
    for (let r = xStep; r <= n; r += xStep) {
      xTicks.push(`<text x="${px(r)}" y="${H - padB + 16}" text-anchor="middle" style="font:600 10px Consolas" fill="#94a3b8">${r}</text>`);
    }

    const chartSvg = `
      <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:760px">
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#cbd5e1"/>
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#cbd5e1"/>
        ${yTicks.join('')}${xTicks.join('')}
        <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" style="font:700 10px sans-serif" fill="#64748b">cwnd</text>
        <text x="${W - padR}" y="${H - padB + 30}" text-anchor="end" style="font:700 10px sans-serif" fill="#64748b">RTT（轮次）</text>
        <line x1="${padL}" y1="${ssthreshY}" x2="${W - padR}" y2="${ssthreshY}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="6 4"/>
        <text x="${W - padR}" y="${ssthreshY - 5}" text-anchor="end" style="font:700 10px sans-serif" fill="#b45309">ssthresh = ${s.ssthresh}</text>
        ${polyline}${lineSvg}${dots}
      </svg>`;

    /* 阶段标签 */
    const phaseChip = {
      init: RC408.ui.chip('就绪', ''),
      slow: RC408.ui.chip('慢启动（指数增长）', 'chip-check'),
      ca: RC408.ui.chip('拥塞避免（线性增长）', 'chip-hit'),
      'loss-timeout': RC408.ui.chip('超时 → 重来', 'chip-fault'),
      'loss-3dup': RC408.ui.chip('快重传 + 快恢复', 'chip-fault'),
      done: RC408.ui.chip('演示结束', 'chip-mst'),
    }[s.phase] || '';

    const stats =
      RC408.ui.statCard('当前 RTT', `${s.rtt} / ${pts.length ? s.history.length : 0}`, '第几轮传输', 'text-indigo-600') +
      RC408.ui.statCard('cwnd（拥塞窗口）', `${s.cwnd} MSS`, s.cwndBefore !== null && s.cwndAfter !== s.cwndBefore ? `由 ${s.cwndBefore} 变化而来` : '', 'text-emerald-600') +
      RC408.ui.statCard('ssthresh（阈值）', `${s.ssthresh} MSS`, '每次丢包减半', 'text-amber-600') +
      RC408.ui.statCard('当前阶段', { slow: '慢启动', ca: '拥塞避免', 'loss-timeout': '超时重置', 'loss-3dup': '快恢复', init: '—', done: '结束' }[s.phase] || '—', '', 'text-slate-700');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('拥塞窗口 cwnd 随 RTT 的变化（🟠 慢启动 · 🟢 拥塞避免 · ✕ 丢包 · 虚线 = 当前阈值）')}
          ${chartSvg}
        </div>

        <div class="flex flex-wrap items-center gap-2">
          ${phaseChip}
          <span class="text-xs text-slate-400">发送窗口 = min(cwnd, rwnd)，若题目另给接收窗口需再取小（2022 真题）</span>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考场速查：</b>慢启动每 RTT <b>×2</b>（超过阈值截断）；拥塞避免每 RTT <b>+1</b>；
          <b>超时</b>：ssthresh=⌊cwnd/2⌋、cwnd=1；<b>3 个重复 ACK</b>：ssthresh=⌊cwnd/2⌋、cwnd=ssthresh（快恢复）。
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '慢启动阶段的数据点')}
          ${RC408.ui.legend('#059669', '拥塞避免阶段')}
          ${RC408.ui.legend('#e11d48', '丢包点（✕ 与处置标注）')}
          ${RC408.ui.legend('#f59e0b', 'ssthresh 虚线（随丢包下移）')}
        </div>
      </div>`;
  },
});
