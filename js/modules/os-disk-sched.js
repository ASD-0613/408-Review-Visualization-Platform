'use strict';
/* ============================================================================
 * os-disk-sched.js —— 【操作系统】磁盘调度算法（FCFS / SSTF / SCAN / C-SCAN）
 * ----------------------------------------------------------------------------
 * 真题考情：18 年中 6 年考（2009-29 SCAN、2010-45 大题 C-SCAN+位图、2015-32 SCAN、
 * 2019-44 大题 SSTF+簇号换算、2021-26 SSTF、2024-32 C-SCAN），磁头移动总量的
 * 计算是固定题型。
 *
 * 快照设计：磁头每移动服务一个请求一帧（另加 init/done，折返/返回各有独立帧）：
 *   { head          本帧结束时磁头位置
 *     from          本帧起点
 *     dist          本帧移动磁道数（|head − from|）
 *     total         累计移动
 *     served        本帧服务的磁道号（折返/返回帧为 null）
 *     kind:'init'|'service'|'reverse'|'return'|'done'
 *     remaining     未服务的请求（渲染红点）
 *     path          磁头轨迹 [{track}]（渲染折线）
 *     order         已确定的服务顺序 [{track, dist}] }
 * SCAN：沿当前方向扫到磁盘边界（0 或 199）才折返；C-SCAN：到达边界后快速返回另一端再单向扫描。
 * ========================================================================== */

RC408.registerModule({
  id: 'os-disk-sched',
  mode: 'stepper',
  title: '磁盘调度（FCFS · SSTF · SCAN · C-SCAN）',

  theory: `
> **真题考情**：18 年中 6 年考（2009-29 SCAN、2015-32 SCAN、2021-26 SSTF、2024-32 C-SCAN、
> 2010-45 与 2019-44 大题），核心计算就一个：**磁头移动总磁道数**（平均寻道长度 = 总移动 ÷ 请求数）。

## 四种算法的移动规则
| 算法 | 规则 | 特点 |
| --- | --- | --- |
| FCFS | 按到达顺序逐个服务 | 公平但移动量大 |
| **SSTF** | 每次选距当前磁头**最近**的请求 | 平均移动小；可能产生"饥饿"（远端请求被插队） |
| **SCAN（电梯）** | 沿当前方向一路扫到**磁盘边界**（0 或 199）才折返 | 不饥饿；中间磁道占便宜（两端请求等待久） |
| **C-SCAN** | 单向扫描：到边界后**快速返回另一端**，再继续同方向扫 | 各磁道等待时间更均匀 |

- LOOK / C-LOOK：到**最远的请求**即折返（不必到边界）——教材将 SCAN 严格版与 LOOK 区分，注意题目口径；
- 本演示的**折返/返回帧**：移动磁道数已计入总量（王道口径）；个别教材不计返回过程，做题时看清题目。

## 考点提示
- 手算时先画 0~199 的磁道轴，把请求标上去再按规则走一遍（本模块的可视化就是这张图）；
- SSTF 的"最近"用 |目标 − 当前| 比较，同距任选（题目一般不会同时给两个等距请求）；
- 平均寻道长度 = 移动总磁道数 ÷ **请求数**（不是磁道数）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'algo', label: '调度算法', type: 'select', default: 'SSTF', wide: true,
      options: [
        { v: 'FCFS', t: 'FCFS 先来先服务' }, { v: 'SSTF', t: 'SSTF 最短寻道时间优先' },
        { v: 'SCAN', t: 'SCAN 电梯调度（扫到磁盘边界）' }, { v: 'CSCAN', t: 'C-SCAN 单向扫描（到边界后返回另一端）' },
      ],
    },
    { key: 'start', label: '磁头初始位置（磁道号）', default: '100' },
    {
      key: 'dir', label: '初始移动方向（SCAN / C-SCAN 用）', type: 'select', default: 'up',
      options: [{ v: 'up', t: '沿磁道号增大方向 →' }, { v: 'down', t: '← 沿磁道号减小方向' }],
    },
    {
      key: 'reqs', label: '磁道请求序列（0~199）', type: 'textarea', rows: 2, wide: true,
      default: '55, 58, 39, 18, 90, 160, 150, 38, 184',
      help: '最多 12 个请求；磁道范围固定 0 ~ 199',
    },
  ],

  quickActions: [
    { label: 'SSTF 示例', run(rt) { rt.setInput('algo', 'SSTF'); rt.setInput('start', '85'); rt.setInput('reqs', '90, 120, 30, 110, 70'); rt.load(); } },
    { label: 'C-SCAN 单向示例', run(rt) { rt.setInput('algo', 'CSCAN'); rt.setInput('start', '120'); rt.setInput('dir', 'down'); rt.setInput('reqs', '150, 60, 90, 170, 30'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const start = parseInt(vals.start, 10);
    if (!Number.isInteger(start) || start < 0 || start > 199) throw { message: '磁头初始位置须在 0 ~ 199' };
    const reqs = vals.reqs.split(/[^0-9]+/).filter(Boolean).map(Number);
    if (!reqs.length) throw { message: '请输入磁道请求序列' };
    if (reqs.length > 12) throw { message: '请求最多 12 个（便于展示）' };
    if (reqs.some(r => r < 0 || r > 199)) throw { message: '磁道号须在 0 ~ 199' };
    const algo = ['FCFS', 'SSTF', 'SCAN', 'CSCAN'].includes(vals.algo) ? vals.algo : 'SSTF';
    const dir = vals.dir === 'down' ? 'down' : 'up';
    return { algo, dir, start, reqs, max: 199 };
  },

  /* ---------------- ② 纯算法：产出调度轨迹快照 ---------------- */
  buildSnapshots(model) {
    const { algo, dir, start, reqs, max } = model;
    const algoName = { FCFS: 'FCFS 先来先服务', SSTF: 'SSTF 最短寻道优先', SCAN: 'SCAN 电梯调度', CSCAN: 'C-SCAN 单向扫描' }[algo];
    const remaining = [...reqs];
    const path = [{ track: start }];
    const order = [];
    let head = start, total = 0, servedCount = 0;
    const snaps = [];

    const push = (kind, served, dist, from, log, logType, desc) => {
      snaps.push({
        kind, head, from, served: served ?? null, dist, total,
        remaining: [...remaining], path: path.map(p => ({ track: p.track })), order: order.map(o => ({ ...o })),
        log, logType, desc,
      });
    };

    push('init', null, 0, head,
      `就绪：磁头位于 ${start} 道${algo === 'SCAN' || algo === 'CSCAN' ? `，初始方向${dir === 'up' ? '增大' : '减小'}` : ''}；待服务请求 ${reqs.length} 个（${reqs.join(', ')}）。${algoName}开始。`,
      'info',
      `点击「单步执行」，红点为待服务请求，绿点为已服务`);

    const move = (target, servedTrack, kind, note) => {
      const from = head;
      const dist = Math.abs(target - head);
      total += dist;
      head = target;
      path.push({ track: target });
      if (servedTrack !== null && servedTrack !== undefined) {
        servedCount++;
        const idx = remaining.indexOf(servedTrack);
        if (idx >= 0) remaining.splice(idx, 1);
        order.push({ track: servedTrack, dist });
      }
      push(kind, servedTrack ?? null, dist, from, note, kind === 'reverse' || kind === 'return' ? 'warn' : 'success',
        `${note}（本步移动 ${dist} 道，累计 ${total}）`);
    };

    if (algo === 'FCFS') {
      remaining.slice().forEach(r => move(r, r, 'service', `FCFS：按到达顺序服务磁道 ${r}`));
    }

    if (algo === 'SSTF') {
      while (remaining.length) {
        let best = 0;
        for (let k = 1; k < remaining.length; k++) {
          if (Math.abs(remaining[k] - head) < Math.abs(remaining[best] - head)) best = k;
        }
        const r = remaining[best];
        move(r, r, 'service', `SSTF：距磁头 ${head} 最近的请求是磁道 ${r}（距离 ${Math.abs(r - head)}）`);
      }
    }

    if (algo === 'SCAN' || algo === 'CSCAN') {
      const up = dir === 'up';
      const forward = remaining.filter(r => up ? r >= head : r <= head).sort((a, b) => up ? a - b : b - a);
      const backward = remaining.filter(r => up ? r < head : r > head).sort((a, b) => up ? b - a : a - b);
      forward.forEach(r => move(r, r, 'service', `${algo === 'SCAN' ? 'SCAN' : 'C-SCAN'}：沿${up ? '增大' : '减小'}方向服务磁道 ${r}`));
      if (backward.length) {
        const edge = up ? max : 0;
        move(edge, null, 'reverse', `到达磁盘${up ? '最大' : '最小'}磁道 ${edge}（${algo === 'SCAN' ? '电梯折返' : '单向扫描到边界'}）`);
        if (algo === 'CSCAN') {
          const other = up ? 0 : max;
          move(other, null, 'return', `快速返回另一端磁道 ${other}（不计服务，回程移动 ${Math.abs(edge - other)} 道已计入总量）`);
        }
        backward.forEach(r => move(r, r, 'service', `${algo === 'SCAN' ? 'SCAN' : 'C-SCAN'}：${up ? '反向' : '沿增大方向'}服务磁道 ${r}`));
      }
    }

    snaps.push({
      kind: 'done', head, from: head, served: null, dist: 0, total,
      remaining: [...remaining], path: path.map(p => ({ track: p.track })), order: order.map(o => ({ ...o })),
      log: `调度完成：${servedCount} 个请求全部服务，磁头共移动 ${total} 道，平均寻道长度 = ${total} ÷ ${reqs.length} = ${(total / reqs.length).toFixed(1)}。`,
      logType: 'success',
      desc: `完成！累计移动 ${total} 道，平均寻道长度 ${(total / reqs.length).toFixed(1)}`,
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const W = 900, H = 190, padL = 46, padR = 20, axisY = 108;
    const px = t => padL + (t / model.max) * (W - padL - padR);

    /* 轨道刻度尺 */
    let ticks = '';
    for (let t = 0; t <= model.max; t += 20) {
      ticks += `<line x1="${px(t)}" y1="${axisY - 5}" x2="${px(t)}" y2="${axisY + 5}" stroke="#94a3b8"/>
                <text x="${px(t)}" y="${axisY + 20}" text-anchor="middle" style="font:600 10px Consolas" fill="#94a3b8">${t}</text>`;
    }
    const ruler = `<line x1="${px(0)}" y1="${axisY}" x2="${px(model.max)}" y2="${axisY}" stroke="#cbd5e1" stroke-width="2"/>${ticks}`;

    /* 请求点：已服务绿、待服务红、当前高亮 */
    const dots = [];
    model.reqs.forEach(r => {
      const idx = s.order.findIndex(o => o.track === r);
      const served = idx >= 0;
      const isCur = s.served === r && s.kind === 'service';
      dots.push(`<circle cx="${px(r)}" cy="${axisY}" r="${isCur ? 6 : 4.5}" fill="${isCur ? '#f59e0b' : served ? '#10b981' : '#f43f5e'}" ${served ? 'opacity="0.85"' : ''}>
        </circle>${isCur ? `<text x="${px(r)}" y="${axisY - 16}" text-anchor="middle" style="font:800 11px sans-serif" fill="#b45309">◀ 磁头</text>` : ''}`);
    });

    /* 磁头轨迹折线 */
    let pathD = '';
    s.path.forEach((p, i) => { pathD += `${i ? 'L' : 'M'}${px(p.track).toFixed(1)},${axisY} `; });
    const pathSvg = s.path.length > 1 ? `<path d="${pathD}" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linejoin="round" opacity="0.9"/>` : '';

    /* 磁头当前位置（终点标记） */
    const headMark = `<polygon points="${px(s.head) - 8},${axisY - 36} ${px(s.head) + 8},${axisY - 36} ${px(s.head)},${axisY - 20}" fill="#4f46e5"/>
      <text x="${px(s.head)}" y="${axisY - 42}" text-anchor="middle" style="font:800 10px sans-serif" fill="#4f46e5">磁头 ${s.head}</text>`;

    /* 服务顺序表 */
    const orderRows = s.order.map((o, i) => `
      <tr class="${i === s.order.length - 1 && s.kind !== 'init' ? 'row-cur' : ''}">
        <td class="font-bold">${i + 1}</td><td class="font-mono">${o.track}</td><td class="font-mono">${o.dist}</td><td class="font-mono">${s.order.slice(0, i + 1).reduce((a, b) => a + b.dist, 0)}</td>
      </tr>`).join('');
    const orderHtml = s.order.length ? `
      <div>
        ${RC408.ui.sectionTitle('服务顺序（每步移动距离与累计值）')}
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="tbl"><thead><tr><th>步</th><th>磁道</th><th>本步移动</th><th>累计移动</th></tr></thead><tbody>${orderRows}</tbody></table>
        </div>
      </div>` : '';

    const avg = model.reqs.length ? (s.total / model.reqs.length).toFixed(1) : '—';
    const stats =
      RC408.ui.statCard('调度算法', { FCFS: 'FCFS', SSTF: 'SSTF', SCAN: 'SCAN 电梯', CSCAN: 'C-SCAN 单向' }[model.algo], `磁头初始 ${model.start} 道，方向${model.dir === 'up' ? '增大' : '减小'}`, 'text-indigo-600') +
      RC408.ui.statCard('已服务', `${servedCountOf(s)} / ${model.reqs.length}`, '待服务红点 → 已服务绿点') +
      RC408.ui.statCard('本帧移动', `${s.dist} 道`, s.served !== null ? `服务磁道 ${s.served}` : { reverse: '折返', return: '返回另一端', init: '—', done: '—' }[s.kind] || '—', 'text-amber-600') +
      RC408.ui.statCard('累计移动', `${s.total} 道`, `平均寻道长度 ${avg}`, 'text-rose-600');

    function servedCountOf(snap) { return snap.order.length; }

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 overflow-x-auto">
          ${RC408.ui.sectionTitle(`磁道轴（0 ~ ${model.max}）：紫线 = 磁头轨迹，🔴 待服务，🟢 已服务，橙 = 当前`)}
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
            ${ruler}${pathSvg}${dots}${headMark}
          </svg>
        </div>

        ${orderHtml}

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f43f5e', '待服务请求')}
          ${RC408.ui.legend('#10b981', '已服务请求')}
          ${RC408.ui.legend('#f59e0b', '磁头当前位置')}
          ${RC408.ui.legend('#6366f1', '磁头移动轨迹')}
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>${model.algo === 'SSTF' ? 'SSTF 只看"离当前最近"，远端请求可能长期得不到服务（饥饿）。' : model.algo === 'SCAN' ? 'SCAN 要扫到磁盘边界（0 / 199）才折返；只到最远请求就折返的是 LOOK。' : model.algo === 'CSCAN' ? 'C-SCAN 单向服务使各磁道等待更均匀；本演示回程移动计入总量，个别教材不计，做题注意口径。' : 'FCFS 公平但磁头来回横跳，移动量通常最大——做对比题时可作为基准。'}
        </div>
      </div>`;
  },
});
