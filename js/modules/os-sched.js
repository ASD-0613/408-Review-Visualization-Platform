'use strict';
/* ============================================================================
 * os-sched.js —— 【操作系统】处理机调度甘特图（FCFS/SJF/HRRN/RR 非抢占）（前缀 _sch）
 * 考情：18 年中 **16 年**涉及（选 16 + 大题 2）：选 2009-24、2011-23、2012-29、2013-31、2014-23、2016-24、2017-23、
 * 2018-24·29、2019-27、2020-26、2021-25、2022-25、2023-29、2024-30、2025-25；
 * 大 2016-46（动态优先数设计）、2026-45（优先权 + RR 混合、抢占仅时钟中断可触发）。
 * 快照：每个"运行段"一帧（RR 按时间片；其余按进程整段），附就绪队列与甘特图。
 * ========================================================================== */

RC408.registerModule({
  id: 'os-sched',
  mode: 'stepper',
  title: '处理机调度（FCFS · SJF · HRRN · RR）',

  theory: `
> **为什么要有它**：多道程序下 CPU 只有一个，"下一个给谁"直接决定周转时间与响应速度；而"什么时候能换人"同样有约束。
> **怎么实现**：三级调度各管一段（作业进内存 / 进程换出换入 / 选进程上 CPU），下级调度按某条规则从就绪队列选一个；规则不同就是不同算法。
> **记住什么**：六种算法的选取规则与缺点 + **四个指标公式**（大题基本都是让你列表算它们）+ **调度时机的清单**。

## 三级调度与调度方式

| 级别 | 别名 | 做什么 | 频率 |
| --- | --- | --- | --- |
| 高级调度 | 作业调度 | 从外存后备队列选作业装入内存、**创建进程** | 最低 |
| 中级调度 | 对换 / 挂起 | 内存紧张时把进程换出、需要时换入（挂起 / 激活） | 中等 |
| 低级调度 | 进程调度 | 从**就绪队列**选一个进程上 CPU | 最高 |

- **调度方式**：**非抢占**（进程自己放弃 CPU 才换人）与**抢占**（时间片到、更高优先级到达、短作业到达时强行换人）。
- 抢占能改善响应时间，但**切换开销**随之上升。

## 调度时机：什么时候会调度

- **会引起调度的事件**：进程**阻塞**、进程**终止**、**时间片用完**、**中断处理结束**、新进程到达 / 更高优先级进程就绪（抢占）——2021-27 四项全选。
- **不能调度的情形**：**中断处理过程中**、在内核里执行**原语**时。
- ⚠ **进程处于临界区时是可以被调度的**——临界区是用户代码，只要不破坏临界资源的互斥就不会影响调度（2012-30 的正解）。

## 指标公式与算题步骤

**周转时间 = 完成 − 到达**；**带权周转 = 周转 ÷ 运行**；**等待 = 周转 − 运行**；平均周转 = Σ周转 ÷ 进程数。
另有**响应时间**（提交到首次响应）、**CPU 利用率**与**吞吐量**。

**算题三步**：① 画**甘特图**（按时间轴排每个进程实际占用 CPU 的区间）；② 逐进程列"到达 / 运行 / 开始 / 完成 / 周转 / 带权周转"表；③ 求平均。
⚠ 有 I/O 的题必须把 I/O 区间也画进时间轴（2012-29、2016-24），否则开始时间全错。

## 六种调度算法

| 算法 | 选取规则 | 特点 |
| --- | --- | --- |
| FCFS | 按到达顺序 | 公平；对短作业不利，利于长作业与 CPU 繁忙型 |
| SJF | 就绪队列中**运行时间最短** | 平均等待最优；长作业饥饿 |
| HRRN | 响应比 **R = (等待 + 运行) ÷ 运行** 最大者 | 综合 FCFS 与 SJF，**无饥饿** |
| RR | 就绪队首运行 q 后轮转 | 响应快；q 过大退化为 FCFS、过小切换开销大 |
| 优先级 | 优先级最高者 | 静态优先级会饥饿；动态优先级（如按等待时间加）可缓解 |
| 多级反馈队列 | 多队列、优先级递减、时间片递增，用完一片降一级 | 兼顾响应与吞吐，通用 OS 最常用 |

- **多级反馈队列要设计四件事**（2020-26）：**就绪队列的数量**、**各队列的优先级**、**各队列内部用什么调度算法**、**进程在队列间的迁移条件**。
- **优先级怎么定**：静态 / 动态；**I/O 密集型进程应给高优先级**（它一让出 CPU，I/O 设备就能更早被用起来，2013-31）；静态优先级下低优先级进程会被源源不断的高优先级进程**饿死**（2014-23）。
- **RR 需要哪些东西**（2021-25）：进程控制块、**时钟中断处理程序**、**就绪队列**（不需要阻塞队列）。

## 就绪队列与时钟中断

- **就绪队列的实现影响复杂度**（2025-25）：优先级调度用**单链表**时，插入要遍历找位置（O(n)），取最高优先级直接取队头（O(1)）。
- **时钟中断处理与时间有关的信息**（系统时间、进程时间片、延时、定时器、使用 CPU 的时间），并**决定是否触发调度**——所以"时间片轮转"离不开时钟中断（2018-29）。

## 考点提醒（易错点）

1. 算平均周转 / 平均带权周转**先列表**：列"到达 / 运行 / 开始 / 完成 / 周转 / 带权周转"，逐行填再求平均；
2. **RR 的时间片 q**：q ≥ 最长运行时间 ⇒ 退化成 FCFS；q 太小 ⇒ 切换开销压过收益；
3. **抢占的触发者要说清**：时间片到由时钟中断触发，新进程到达在抢占式下也能抢占——2026-45 大题就考"优先权 + RR 混合"；
4. SJF 的"最短"是**运行时间**（不是剩余时间），别与 SRTN（最短剩余时间优先）混；
5. **调度时机的题先排除两项**：中断处理中、内核原语中不能调度；临界区中**可以**调度。

## 问法速查

| 题目里这么问 | 答什么 | 依据 |
| --- | --- | --- |
| 哪种算法综合了 FCFS 与 SJF、又不会饥饿 | 高响应比优先（HRRN） | 长作业等待越久响应比越高（2009-24、2011-23） |
| 静态优先级什么时候会饥饿 | 就绪队列里总有更高优先级的进程 | 一直被插队（2016-46 还问怎么算动态优先级） |
| 多级反馈队列要考虑哪些因素 | 队列数量、各队列优先级、各队列算法、迁移条件 | 四要素全选（2020-26） |
| 时间片轮转需要哪些数据结构 | PCB、时钟中断处理程序、就绪队列 | 时钟中断负责切时间片（2021-25） |
| 哪些事件会引起调度 | 中断处理结束、进程阻塞、进程结束、时间片用完 | 2021-27 |
| 进程在临界区时能调度吗 | 能 | 临界区是用户代码（2012-30） |
| 谁能抢 CPU | 抢占式下：时间片到、更高优先级到达 | 数抢占次数就是数这两类事件（2022-25） |
| 就绪队列用单链表，插入要多久 | O(n) | 要遍历找合适位置（2025-25） |

> **真题考情**：**16/18 年（选 16 + 大题 2）**：选 2009-24、2011-23（高响应比）、2012-29、2013-31、2014-23、2016-24、2017-23（作业调度）、
> 2018-24·29、2019-27、2020-26、2021-25（时间片轮转）、2022-25（抢占优先级）、2023-29（平均周转）、2024-30（RR 周转）、2025-25；大 2016-46、2026-45（优先权 + RR 混合）。
`,

  inputs: [
    { key: 'algo', label: '调度算法', type: 'select', default: 'SJF', wide: true,
      options: [{ v: 'FCFS', t: 'FCFS 先来先服务' }, { v: 'SJF', t: 'SJF 短作业优先（非抢占）' }, { v: 'HRRN', t: 'HRRN 高响应比优先' }, { v: 'RR', t: 'RR 时间片轮转' }] },
    { key: 'q', label: 'RR 时间片', type: 'select', default: 2, options: [1, 2, 3, 4].map(v => ({ v, t: `${v}` })) },
    { key: 'procs', label: '进程（名:到达:运行，每行一个）', type: 'textarea', rows: 4, wide: true,
      default: 'A:0:7\nB:2:4\nC:4:1\nD:5:4' },
  ],

  parse(vals) {
    const procs = vals.procs.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
      const m = l.match(/^([^:：]+)[:：](\d+)[:：](\d+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${l}」格式错误，应为 名:到达:运行（如 A:0:7）` };
      return { name: m[1].trim(), arrive: +m[2], burst: +m[3] };
    });
    if (procs.length < 2 || procs.length > 6) throw { message: '进程数 2 ~ 6' };
    if (procs.some(p => p.burst <= 0)) throw { message: '运行时间须为正' };
    const q = parseInt(vals.q, 10);
    return { algo: vals.algo, q: q || 2, procs };
  },

  buildSnapshots(model) {
    const { algo, q, procs } = model;
    let t = 0; const done = {}; const gantt = [];
    const remain = {}; procs.forEach(p => remain[p.name] = p.burst);
    const snaps = [];
    const push = (kind, runName, runLen, ready, note, logType) => snaps.push({
      kind, t, runName: runName || null, runLen: runLen || 0, ready, gantt: gantt.map(g => ({ ...g })),
      remain: { ...remain }, done: { ...done }, note, log: note, logType: logType || 'info', desc: note,
    });
    const finish = p => { done[p.name] = t; };
    const readyList = t2 => procs.filter(p => p.arrive <= t2 && !done[p.name] && (algo === 'RR' ? remain[p.name] > 0 : !(remain[p.name] <= 0))).filter(p => !(gantt.length && gantt[gantt.length - 1].name === p.name && algo === 'RR' ? false : false));

    push('init', null, 0, [], `就绪：${procs.length} 个进程（${procs.map(p => p.name + ' 到达' + p.arrive + ' 运行' + p.burst).join('；')}）。算法 = ${algo}${algo === 'RR' ? '，时间片 q = ' + q : ''}。`, 'info');

    const nowReady = () => procs.filter(p => p.arrive <= t && !(p.name in done) && remain[p.name] > 0);
    const pick = () => {
      const r = nowReady(); if (!r.length) return null;
      if (algo === 'FCFS') return r.sort((a, b) => a.arrive - b.arrive || a.name.localeCompare(b.name))[0];
      if (algo === 'SJF') return r.sort((a, b) => remain[a.name] - remain[b.name] || a.arrive - b.arrive)[0];
      if (algo === 'HRRN') return r.sort((a, b) => ((t - b.arrive + b.burst) / b.burst) - ((t - a.arrive + a.burst) / a.burst) || a.name.localeCompare(b.name))[0];
      return null;
    };
    let guard = 0;
    if (algo !== 'RR') {
      while (Object.keys(done).length < procs.length && guard++ < 200) {
        let p = pick();
        if (!p) { // 空闲到下一到达
          const next = procs.filter(x => !(x.name in done)).sort((a, b) => a.arrive - b.arrive)[0];
          t = next.arrive; push('idle', null, 0, nowReady().map(x => x.name), `CPU 空闲至 t = ${t}（无就绪进程）`, 'warn');
          continue;
        }
        const start = t; t += remain[p.name]; remain[p.name] = 0;
        gantt.push({ name: p.name, start, len: t - start });
        finish(p);
        const turn = done[p.name] - p.arrive, wait = turn - p.burst;
        push('run', p.name, t - start, nowReady().map(x => x.name),
          `${p.name} 运行 [${start}, ${t}] 完成：周转 ${turn}，带权 ${(turn / p.burst).toFixed(2)}，等待 ${wait}`, 'success');
      }
    } else {
      const queue = [];
      let arrived = [...procs].sort((a, b) => a.arrive - b.arrive || a.name.localeCompare(b.name));
      while (Object.keys(done).length < procs.length && guard++ < 400) {
        arrived.filter(p => p.arrive <= t && remain[p.name] > 0 && !queue.includes(p.name)).forEach(p => queue.push(p.name));
        if (!queue.length) {
          const next = arrived.filter(p => remain[p.name] > 0).sort((a, b) => a.arrive - b.arrive)[0];
          t = next.arrive; push('idle', null, 0, [], `CPU 空闲至 t = ${t}`, 'warn');
          continue;
        }
        const name = queue.shift();
        const run = Math.min(q, remain[name]);
        const start = t; t += run; remain[name] -= run;
        gantt.push({ name, start, len: run });
        arrived.filter(p => p.arrive <= t && remain[p.name] > 0 && !queue.includes(p.name) && p.name !== name).forEach(p => queue.push(p.name));
        if (remain[name] > 0) { queue.push(name); push('run', name, run, queue, `${name} 运行一个时间片（剩 ${remain[name]}），排回就绪队列尾 [${queue.join(',')}]`); }
        else {
          done[name] = t; const p = procs.find(x => x.name === name);
          const turn = t - p.arrive, wait = turn - p.burst;
          push('run', name, run, queue, `${name} 运行完毕：周转 ${turn}，带权 ${(turn / p.burst).toFixed(2)}，等待 ${wait}`, 'success');
        }
      }
    }

    const rows = procs.map(p => {
      const finishT = done[p.name] ?? t, turn = finishT - p.arrive, wait = turn - p.burst;
      return `<tr><td class="font-bold">${p.name}</td><td class="font-mono">${p.arrive}</td><td class="font-mono">${p.burst}</td><td class="font-mono">${finishT}</td><td class="font-mono">${turn}</td><td class="font-mono">${(turn / p.burst).toFixed(2)}</td><td class="font-mono">${wait}</td></tr>`;
    }).join('');
    const avgTurn = (procs.reduce((a, p) => a + ((done[p.name] ?? t) - p.arrive), 0) / procs.length).toFixed(2);
    push('done', null, 0, [], `调度完成：平均周转时间 = ${avgTurn}。算法对比：SJF 平均等待最优但可能饥饿；RR 响应快，q 过大退化为 FCFS。`, 'success',
      `完成！平均周转时间 ${avgTurn}`);
    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const tEnd = Math.max(s.t, 1);
    const W = 860, H = 120, padL = 40;
    const px = t => padL + (t / tEnd) * (W - padL - 30);
    const colors = { A: '#6366f1', B: '#0ea5e9', C: '#10b981', D: '#f59e0b', E: '#ec4899', F: '#8b5cf6' };
    const bars = s.gantt.map((g, i) => {
      const c = colors[g.name] || '#94a3b8';
      return `<rect x="${px(g.start)}" y="30" width="${px(g.start + g.len) - px(g.start)}" height="36" rx="5" fill="${c}" opacity="${i === s.gantt.length - 1 ? 1 : 0.75}"/>
        <text x="${(px(g.start) + px(g.start + g.len)) / 2}" y="53" text-anchor="middle" style="font:800 12px sans-serif" fill="#fff">${g.name}</text>`;
    }).join('');
    const ticks = [];
    for (let t2 = 0; t2 <= tEnd; t2++) {
      if (tEnd > 24 && t2 % Math.ceil(tEnd / 16) !== 0) continue;
      ticks.push(`<line x1="${px(t2)}" y1="66" x2="${px(t2)}" y2="74" stroke="#94a3b8"/><text x="${px(t2)}" y="88" text-anchor="middle" style="font:600 10px Consolas" fill="#94a3b8">${t2}</text>`);
    }

    const rows = model.procs.map(p => {
      const f = s.done[p.name];
      return `<tr><td class="font-bold">${p.name}</td><td class="font-mono">${p.arrive}</td><td class="font-mono">${p.burst}</td><td class="font-mono">${f ?? '—'}</td><td class="font-mono">${f !== undefined ? f - p.arrive : '—'}</td><td class="font-mono">${f !== undefined ? ((f - p.arrive) / p.burst).toFixed(2) : '—'}</td></tr>`;
    }).join('');
    const allDone = model.procs.every(p => s.done[p.name] !== undefined);
    const avgTurn = allDone ? (model.procs.reduce((a, p) => a + (s.done[p.name] - p.arrive), 0) / model.procs.length).toFixed(2) : '—';

    const stats =
      RC408.ui.statCard('算法', model.algo, model.algo === 'RR' ? `时间片 q = ${model.q}` : '非抢占', 'text-indigo-600') +
      RC408.ui.statCard('当前时刻 t', s.t, '甘特图推进到', 'text-slate-600') +
      RC408.ui.statCard('已完成进程', `${Object.keys(s.done).length} / ${model.procs.length}`, '', 'text-emerald-600') +
      RC408.ui.statCard('平均周转时间', avgTurn, 'Σ周转 ÷ 进程数', allDone ? 'text-rose-600' : 'text-slate-400');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('甘特图（每个色块 = 一次占用 CPU 的运行段）')}
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">${bars}${ticks}</svg>
        </div>
        <div>${RC408.ui.sectionTitle('进程指标表')}
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="tbl w-full"><thead><tr><th>进程</th><th>到达</th><th>运行</th><th>完成</th><th>周转</th><th>带权周转</th></tr></thead><tbody>${rows}</tbody></table>
          </div>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900">
          💡 <b>考点提醒：</b>${model.algo === 'HRRN' ? '响应比 R = (等待 + 运行) ÷ 运行，等待越久 R 越大——兼顾短作业与无饥饿（2011 真题）。' : model.algo === 'SJF' ? 'SJF 平均等待时间最优，但长作业可能饥饿（2014 真题）。' : model.algo === 'RR' ? 'RR 中"新到达"通常排在"时间片用完"之前入队（2021 真题细节）；q → ∞ 退化为 FCFS。' : 'FCFS 公平、无饥饿，但对短作业不利。'}
        </div>
      </div>`;
  },
});
