'use strict';
/* ============================================================================
 * os-pv.js —— 【操作系统】进程同步与互斥 · PV 操作（生产者-消费者）
 * ----------------------------------------------------------------------------
 * 真题考情：2009-2025 中 **16 年**考 PV（选 4 + 大题 13）：选 2010-27、2011-32、2016-30、2018-25；
 * 大 2009-45、2011-45、2013-45、2014-47、2015-45、2017-46、2019-43、2020-45、2021-45、2022-46、2023-45、
 * 2024-46、2025-45。是操作系统分值占比最高的固定大题（约 7~8 分）。
 *
 * 实现方式：真实调度模拟器——每个进程是一个原子动作序列（生产/P/V/放入/取出/消费），
 * 采用轮转调度：每帧执行一个原子动作；P 操作失败（信号量 < 0）则进程阻塞入对应
 * 等待队列，V 操作按教材约定（S≤0 时唤醒一个等待者）。算法一次性产出全部快照。
 *
 * 快照设计：
 *   { action:'init'|'produce'|'P'|'V'|'put'|'get'|'consume'|'done',
 *     proc       执行本动作的进程名（P1/C1…）
 *     sem        涉及的信号量名（'mutex'|'empty'|'full' 或 null）
 *     sems       三个信号量的当前值（教材约定：S<0 时 |S| = 等待进程数）
 *     waitQ      三个信号量的等待队列
 *     buffer     缓冲区中的产品（产品号数组）
 *     states     各进程状态 {ready|blocked|done}
 *     blocked/woken  本帧是否发生阻塞 / 唤醒了谁
 *     codeLine   当前进程代码行号（用于伪代码高亮）
 *     counters   {produced, consumed, blocked} 累计统计 }
 * ========================================================================== */

/* 生产者 / 消费者伪代码（与快照的 codeLine 对应） */
const _PV_P_CODE = ['生产一个产品', 'P(empty)  // 申请空缓冲区', 'P(mutex)  // 申请进入临界区', '把产品放入缓冲区', 'V(mutex)  // 退出临界区', 'V(full)   // 产品数 +1'];
const _PV_C_CODE = ['P(full)   // 申请产品', 'P(mutex)  // 申请进入临界区', '从缓冲区取出产品', 'V(mutex)  // 退出临界区', 'V(empty)  // 空缓冲区 +1', '消费这个产品'];

/* 死锁演示开关（由快捷按钮置位，parse 读取后自动复位） */
let _PV_DEADLOCK_DEMO = false;

RC408.registerModule({
  id: 'os-pv',
  mode: 'stepper',
  title: '同步与互斥 · PV 操作（生产者-消费者）',

  theory: `
> **为什么要有它**：多个进程共享临界资源时，必须保证"同一时刻只有一个进程进临界区"（**互斥**），且彼此要按正确次序推进（**同步**）——信号量就是这两个需求的统一实现。
> **怎么实现**：先看清互斥的四种软件做法与三种硬件做法（软件法都靠忙等，硬件法的自旋类也一样），再用**记录型信号量**（整型值 + 等待队列）把"等不到就阻塞"交给内核，只暴露 P/V 两个**原子**操作。
> **记住什么**：四条互斥准则里**只有前三条必须满足**（让权等待可选）+ **P 的顺序不能颠倒** + 判"要不要互斥"看是否"同一变量、至少一个写"。

## 并发、临界区与四条准则

- **并发程序的三特征**：间断性（走走停停）、失去封闭性（共享资源被别的程序改）、**不可再现性**（同样输入可能得到不同结果，2011-32 就是语句交错导致结果不唯一）。
- **临界资源 / 临界区**：一次只允许一个进程使用的资源叫临界资源；访问它的那段代码叫**临界区**，进入前要申请、退出后要释放。
- **四条互斥准则**：

| 准则 | 含义 | 是否必须 |
| --- | --- | --- |
| 空闲让进 | 临界区空闲时，应允许一个请求者立即进入 | 必须 |
| 忙则等待 | 已有进程在临界区时，其他请求者必须等 | 必须 |
| 有限等待 | 请求者应在**有限时间**内进入，不能饥饿 | 必须 |
| 让权等待 | 进不去时应**释放处理机**，不要忙等 | **可选**（2020-32） |

- **判"这两段要不要互斥"**：看它们是否访问**同一个变量**且**至少有一个是写**；只读的两段可以并发（2016-30）。
- **Bernstein 条件**：判定两段能否并发而不互相影响的三条——R(P)∩W(Q)=∅、W(P)∩R(Q)=∅、W(P)∩W(Q)=∅；**读-读可以相交**，所以"R(P)∩R(Q)=∅"不在条件里（2026-27）。

## 软件实现互斥（四种，判型看它违背哪条）

| 做法 | 思路 | 违背哪条 |
| --- | --- | --- |
| 单标志法 | 一个 turn，轮到谁谁进 | 违背**空闲让进**（对方不进则临界区空着） |
| 双标志先检查 | 先看对方标志，再置自己的 | 违背**忙则等待**（检查与置位之间有窗口，可能同时进） |
| 双标志后检查 | 先置自己的标志，再检查对方 | 违背**空闲让进 / 有限等待**（都谦让就谁也进不去） |
| Peterson | flag 表示"想进"，turn 表示"让给对方"；两个都成立才等 | 三条都满足，但**不满足让权等待**（忙等，2018-32） |

- **Peterson 的关键**：先置自己的 flag，再把 **turn 置为对方**，然后同时检查"对方想进"与"turn 指向对方"；两人同时想进时，**turn 的较晚一次赋值**决定谁等（2010-27）。
- 它满足**有限等待**、不满足**让权等待**——这是辨析题的高频判据（2018-32）。

## 硬件实现互斥（三种，都靠忙等）

- **关中断**：进临界区前关中断、出来再开——只适用于**单处理机**（多核上别的 CPU 照样跑）。
- **TestAndSet（TSL）**：一条指令"读出旧值并置为 true"，用 while 循环反复试。**退出临界区只把 lock 置 FALSE，并不负责唤醒**；等待者一直卡在 while 里不放弃 CPU（2016-27）。
- **Swap（交换）**：同样用一条指令原子地交换 lock 与局部变量。
- **共同缺点**：除关中断外都是**忙等（自旋）**，都不满足让权等待；优点是实现简单、多处理机下也有效。

## 信号量与 P/V

- **整型信号量**：只有计数值，P 失败就一直循环——仍是忙等。
- **记录型信号量**：value + L（等待队列），P 失败就**阻塞进队列**、V 时**唤醒**——**消除了不让权等待**（2018-32）。
- **P(S) / wait(S)**：S = S − 1；若 **S < 0**，调用者**阻塞**并进 S 的等待队列（原子）。
- **V(S) / signal(S)**：S = S + 1；若 **S ≤ 0**，从等待队列唤醒一个进程（原子）。
- **值的含义**：S > 0 = 还剩 S 个资源且无人等待；S = 0 = 刚好用完、无人等待；**S < 0 时 |S| = 正在等待的进程数**（2010-25）。
- **由信号量值反推**（2026-26）：资源总数 = 初始值；已通过 P 的进程数 = **初始值 − 当前值**；当前值为负时，**负值的绝对值 = 阻塞进程数**，此时资源已被占满。

## 三类关系，三种模板

| 关系 | 信号量 | 初值 | 写法 |
| --- | --- | --- | --- |
| 互斥（争同一个临界资源） | mutex | **1** | P(mutex) … 临界区 … V(mutex) |
| 同步（A 必须先于 B） | S | **0** | A 之后 V(S)；B 之前 P(S) |
| 前驱（图里有几条边） | 每条边一个 | **0** | 前驱活动做完 V，后继活动开始前 P（2020-45、2022-46） |

## 生产者-消费者（本模块的模型）

\`\`\`text
信号量：mutex = 1（互斥访问缓冲区）
        empty = N（空缓冲区数，同步）
        full  = 0（产品数，同步）

生产者：                      消费者：
while(true){                  while(true){
  生产一个产品;                  P(full);
  P(empty);  ← 先申请资源        P(mutex);
  P(mutex);                    从缓冲区取产品;
  放入缓冲区;                   V(mutex);
  V(mutex);                    V(empty);  ← 释放资源
  V(full);                     消费这个产品;
}                             }
\`\`\`

## 考点提醒（易错点）

1. **P(empty) 与 P(mutex) 的顺序不能颠倒**：先 P(mutex) 再 P(empty)，缓冲区满时生产者握着 mutex 等空位、消费者又进不了临界区取产品 → **死锁**（V 的顺序交换无所谓，只影响效率）。
2. **初值的物理意义必须写出来**：mutex=1（临界区只有 1 个）、empty=N（初始 N 个空位）、full=0（初始无产品）。
3. **遇到"哪条准则"的题**：先答前三条必须、**让权等待可选**，再点名"硬件自旋法与 Peterson 都不满足让权等待、记录型信号量消除它"（2020-32、2018-32）。
4. **经典变形**：多生产者-多消费者、消费者须**连续取 k 件**（2014-47）、**信箱问题**（2015-45）——核心永远是"资源计数 + 互斥锁"两个角色的搭配。
5. **答题模板（固定三问）**：列互斥资源 → 给每个信号量写初值与含义 → 写 P/V 伪代码。

> **真题考情**：**16/18 年（选 4 + 大题 13）**：选 2010-27、2011-32、2016-30、2018-25；
> 大 2009-45、2011-45、2013-45、2014-47、2015-45、2017-46、2019-43、2020-45、2021-45、2022-46、2023-45、2024-46、2025-45——OS 必考第一题。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'producers', label: '生产者个数', type: 'select', default: 2, options: [1, 2, 3].map(v => ({ v, t: `${v} 个` })) },
    { key: 'consumers', label: '消费者个数', type: 'select', default: 2, options: [1, 2, 3].map(v => ({ v, t: `${v} 个` })) },
    { key: 'bufferSize', label: '缓冲区容量 N', type: 'select', default: 3, options: [2, 3, 4, 5].map(v => ({ v, t: `${v} 格` })) },
    { key: 'each', label: '每个生产者生产的产品数', type: 'select', default: 2, options: [1, 2, 3].map(v => ({ v, t: `${v} 件` })) },
  ],

  quickActions: [
    { label: '⚠️ 演示：P 顺序颠倒导致死锁', run() { _PV_DEADLOCK_DEMO = true; RC408.Runner.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const producers = parseInt(vals.producers, 10);
    const consumers = parseInt(vals.consumers, 10);
    const N = parseInt(vals.bufferSize, 10);
    const each = parseInt(vals.each, 10);
    const total = producers * each;
    const swapMutex = _PV_DEADLOCK_DEMO;
    _PV_DEADLOCK_DEMO = false;   // 复位：下一次「生成数据」恢复正常顺序
    if (total > 8) throw { message: '总产品数（生产者数 × 每个产量）请控制在 8 件以内，便于观察' };
    if (consumers > total) throw { message: '消费者个数多于产品总数，将有无事可做的消费者' };
    return { producers, consumers, N, each, total, swapMutex };
  },

  /* ---------------- ② 纯算法：调度模拟，产出全部快照 ---------------- */
  buildSnapshots(model) {
    const { producers, consumers, N, each, total, swapMutex } = model;

    /* 进程集合：生产者在前、消费者在后，轮转调度 */
    const procs = [];
    for (let i = 0; i < producers; i++) procs.push({ name: `生产者P${i + 1}`, short: `P${i + 1}`, type: 'P', pc: 0, made: 0, state: 'ready' });
    for (let i = 0; i < consumers; i++) procs.push({ name: `消费者C${i + 1}`, short: `C${i + 1}`, type: 'C', pc: 0, eaten: 0, state: 'ready' });

    const sems = { mutex: 1, empty: N, full: 0 };
    const waitQ = { mutex: [], empty: [], full: [] };
    const buffer = [];
    const states = () => { const o = {}; procs.forEach(p => { o[p.short] = p.state; }); return o; };
    const counters = { produced: 0, consumed: 0, blocked: 0 };
    let itemSeq = 0;
    const snaps = [];

    const push = (action, proc, extra) => snaps.push({
      action, proc: proc ? proc.short : null,
      sems: { ...sems }, waitQ: { mutex: [...waitQ.mutex], empty: [...waitQ.empty], full: [...waitQ.full] },
      buffer: [...buffer], states: states(), counters: { ...counters },
      blocked: false, woken: null, codeLine: 0, procType: proc ? proc.type : null,
      ...extra,
    });

    push('init', null, {
      log: `就绪：${producers} 个生产者（各生产 ${each} 件，共 ${total} 件）、${consumers} 个消费者、缓冲区 ${N} 格。信号量初值 mutex=1, empty=${N}, full=0。`,
      logType: 'info',
      desc: `点击「单步执行」：每帧执行一个原子动作，观察信号量变化与阻塞/唤醒`,
    });

    /** P 操作：S-- ；S<0 则阻塞（pc 不前进，唤醒后视为本次 P 已完成） */
    function doP(proc, sem) {
      sems[sem]--;
      if (sems[sem] < 0) {
        proc.state = 'blocked';
        waitQ[sem].push(proc.short);
        counters.blocked++;
        push('P', proc, {
          sem, blocked: true, codeLine: proc.type === 'P' ? (sem === 'empty' ? 1 : 2) : (sem === 'full' ? 0 : 1),
          log: `${proc.short} 执行 P(${sem})：${sem} = ${sems[sem]} < 0 → **阻塞**，进入 ${sem} 的等待队列（$|${sem}| 的绝对值 = 等待进程数）`,
          logType: 'error',
          desc: `${sem} 资源不足，${proc.short} 阻塞等待`,
        });
        return false;   // 未通过，pc 不前进
      }
      push('P', proc, {
        sem, codeLine: proc.type === 'P' ? (sem === 'empty' ? 1 : 2) : (sem === 'full' ? 0 : 1),
        log: `${proc.short} 执行 P(${sem})：${sem} = ${sems[sem]} ≥ 0 → 申请成功，继续执行`,
        logType: 'info',
        desc: `P(${sem}) 通过（剩余 ${sem} = ${sems[sem]}）`,
      });
      return true;
    }

    /** V 操作：S++ ；S≤0 则唤醒队首 */
    function doV(proc, sem, codeLine) {
      sems[sem]++;
      let woken = null;
      if (sems[sem] <= 0) {
        woken = waitQ[sem].shift();
        const wp = procs.find(p => p.short === woken);
        if (wp) { wp.state = 'ready'; wp.pc++; }   // 唤醒：被阻塞的 P 视为已完成
      }
      push('V', proc, {
        sem, woken, codeLine,
        log: `${proc.short} 执行 V(${sem})：${sem} = ${sems[sem]}` +
          (woken ? ` ≤ 0 → **唤醒**等待队列中的 ${woken}（其 P(${sem}) 已完成，将从阻塞处继续）` : ' → 无等待进程'),
        logType: woken ? 'success' : 'info',
        desc: woken ? `V(${sem}) 唤醒了 ${woken}` : `V(${sem}) 释放资源（${sem} = ${sems[sem]}）`,
      });
    }

    /* 轮转调度主循环 */
    let turn = 0, guard = 0;
    while (counters.consumed < total && guard++ < 400) {
      // 找下一个就绪进程
      let proc = null;
      for (let k = 0; k < procs.length; k++) {
        const cand = procs[(turn + k) % procs.length];
        if (cand.state === 'ready') { proc = cand; turn = (turn + k + 1) % procs.length; break; }
      }
      if (!proc) break;   // 全部阻塞（正常参数下不会发生）

      if (proc.type === 'P') {
        /* ---- 生产者程序（code 数组把 pc 映射到伪代码行；死锁演示时交换 P(empty)/P(mutex)） ---- */
        const code = swapMutex ? [0, 2, 1, 3, 4, 5] : [0, 1, 2, 3, 4, 5];
        switch (code[proc.pc]) {
          case 0: { itemSeq++; counters.produced++; push('produce', proc, { codeLine: 0, log: `${proc.short} 生产了产品（尚未进入缓冲区）`, logType: 'info', desc: `${proc.short} 生产一件产品` }); proc.pc++; break; }
          case 1: { if (doP(proc, 'empty')) proc.pc++; break; }
          case 2: { if (doP(proc, 'mutex')) proc.pc++; break; }
          case 3: { buffer.push(`${proc.short}·${proc.made + 1}`); proc.made++; proc.pc++; push('put', proc, { codeLine: 3, log: `${proc.short} 把产品放入缓冲区（当前 ${buffer.length}/${N} 格）`, logType: 'success', desc: `产品进入临界区——此刻持有 mutex 的只有 ${proc.short}` }); break; }
          case 4: { doV(proc, 'mutex', 4); proc.pc++; break; }
          case 5: { doV(proc, 'full', 5); proc.pc++; if (proc.made >= each) { proc.state = 'done'; push('produce', proc, { codeLine: 5, log: `${proc.short} 已完成全部 ${each} 件产品，进程结束`, logType: 'info', desc: `${proc.short} 运行结束` }); } else proc.pc = 0; break; }
        }
      } else {
        /* ---- 消费者程序 ---- */
        switch (proc.pc) {
          case 0: { if (doP(proc, 'full')) proc.pc++; break; }
          case 1: { if (doP(proc, 'mutex')) proc.pc++; break; }
          case 2: { const got = buffer.shift(); proc.eaten++; counters.consumed++; proc.pc++; push('get', proc, { codeLine: 2, gotItem: got, log: `${proc.short} 从缓冲区取出产品（剩余 ${buffer.length}/${N} 格）`, logType: 'success', desc: `${proc.short} 在临界区内取出 ${got}` }); break; }
          case 3: { doV(proc, 'mutex', 3); proc.pc++; break; }
          case 4: { doV(proc, 'empty', 4); proc.pc++; break; }
          case 5: { push('consume', proc, { codeLine: 5, log: `${proc.short} 消费了取出的产品（已消费 ${counters.consumed}/${total} 件）`, logType: 'success', desc: `消费完成 ${counters.consumed}/${total}` }); proc.pc = 0; break; }
        }
      }
    }

    if (counters.consumed >= total) {
      push('done', null, {
        log: `模拟结束：${total} 件产品全部生产并消费，累计阻塞 ${counters.blocked} 次。回顾：empty 管空位、full 管产品、mutex 管互斥——三者各司其职。`,
        logType: 'success',
        desc: `完成！累计阻塞 ${counters.blocked} 次——每一次阻塞都是同步信号量在起作用`,
      });
    } else {
      push('done', null, {
        log: `💀 **死锁发生！** 所有进程均被阻塞：某生产者持有 mutex 却阻塞在 P(empty)（缓冲区已满），而消费者要取产品必须先 P(mutex)——互相等待，谁也无法推进。这正是"P(empty) 与 P(mutex) 顺序不能颠倒"的原因。`,
        logType: 'error',
        desc: '死锁！互斥锁与同步信号量循环等待——点击「生成数据」可恢复正常顺序重新演示',
      });
    }
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const U = RC408.util;

    /* 信号量卡片 */
    const semCard = (name, role) => {
      const v = s.sems[name];
      const q = s.waitQ[name];
      const active = s.action === 'P' || s.action === 'V' ? s.sem === name : false;
      return `<div class="rounded-xl border p-3 ${active ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}">
        <div class="flex items-baseline gap-2">
          <span class="font-mono font-extrabold text-slate-700">${name}</span>
          <span class="text-[11px] text-slate-400">${role}</span>
        </div>
        <div class="text-2xl font-extrabold mt-1 font-mono ${v < 0 ? 'text-rose-600' : 'text-slate-800'}">${v}</div>
        <div class="text-[11px] mt-1 ${v < 0 ? 'text-rose-500 font-bold' : 'text-slate-400'}">${v < 0 ? `${Math.abs(v)} 个进程在等待` : v === 0 ? '资源已用尽' : '可用资源'}</div>
        <div class="mt-1.5 flex flex-wrap gap-1">${q.length ? q.map(p => RC408.ui.chip(p, 'chip-fault', '阻塞中')).join('') : '<span class="text-[10px] text-slate-300">等待队列空</span>'}</div>
      </div>`;
    };

    /* 缓冲区 */
    const bufCells = Array.from({ length: model.N }, (_, i) => {
      const item = s.buffer[i];
      const touched = (s.action === 'put' && i === s.buffer.length - 1) || (s.action === 'get' && i === -1);
      return `<div class="frame-cell" style="width:56px;height:56px;border-radius:11px">
        ${item ? `<span class="page-num" style="font-size:15px">${item}</span>` : '<span class="text-slate-300 text-lg">·</span>'}
      </div>`;
    }).join('');

    /* 进程状态表 */
    const procRows = Object.keys(s.states).map(name => {
      const st = s.states[name];
      const isCur = s.proc === name && s.action !== 'init' && s.action !== 'done';
      const stCls = st === 'blocked' ? 'bg-rose-100 text-rose-700' : st === 'done' ? 'bg-slate-100 text-slate-400' : 'bg-emerald-100 text-emerald-700';
      return `<tr class="${isCur ? 'row-cur' : ''}">
        <td class="${isCur ? 'col-cur' : ''} font-bold">${name}</td>
        <td class="${isCur ? 'col-cur' : ''}"><span class="px-2 py-0.5 rounded-full text-[11px] font-bold ${stCls}">${{ ready: '就绪', blocked: '阻塞', done: '完成' }[st]}</span></td>
        <td class="${isCur ? 'col-cur' : ''} text-xs">${isCur ? { produce: '生产产品', P: `P(${s.sem})`, V: `V(${s.sem})`, put: '放入缓冲区', get: '取出产品', consume: '消费产品' }[s.action] : '—'}</td>
      </tr>`;
    }).join('');

    /* 伪代码双栏（高亮当前行） */
    const codeBlock = (title, lines, type) => {
      const active = s.procType === type && s.action !== 'init' && s.action !== 'done';
      return `<div class="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div class="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] font-bold text-slate-500">${title}</div>
        <div class="p-2 font-mono text-[11.5px] leading-6">${lines.map((l, i) =>
          `<div class="px-2 rounded ${active && s.codeLine === i ? 'bg-amber-100 text-amber-900 font-bold' : 'text-slate-500'}">${i + 1}　${RC408.util.esc(l)}</div>`).join('')}</div>
      </div>`;
    };

    const stats =
      RC408.ui.statCard('已生产 / 总数', `${s.counters.produced} / ${model.total}`, model.producers + ' 个生产者轮流生产') +
      RC408.ui.statCard('已消费', `${s.counters.consumed}`, model.consumers + ' 个消费者轮流消费', 'text-emerald-600') +
      RC408.ui.statCard('缓冲区占用', `${s.buffer.length} / ${model.N}`, 'empty 信号量 = 剩余空位', 'text-indigo-600') +
      RC408.ui.statCard('累计阻塞次数', s.counters.blocked, '每次阻塞 = 同步信号量生效', s.counters.blocked ? 'text-rose-600' : 'text-slate-400');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="grid grid-cols-3 gap-3">${semCard('mutex', '互斥访问缓冲区')}${semCard('empty', '空缓冲区数（同步）')}${semCard('full', '产品数（同步）')}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle(`共享缓冲区（${model.N} 格 · 受 mutex 保护）`)}
          <div class="flex flex-wrap gap-2 justify-center">${bufCells}</div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${codeBlock('生产者进程', _PV_P_CODE, 'P')}
          ${codeBlock('消费者进程', _PV_C_CODE, 'C')}
        </div>

        <div>
          ${RC408.ui.sectionTitle('进程状态（阻塞 = 停在 P 操作上，唤醒后从阻塞处继续）')}
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="tbl w-full"><thead><tr><th>进程</th><th>状态</th><th>本帧动作</th></tr></thead><tbody>${procRows}</tbody></table>
          </div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '本帧操作的信号量')}
          ${RC408.ui.legend('#e11d48', '阻塞的进程 / 负值信号量')}
          ${RC408.ui.legend('#10b981', '就绪 / 成功')}
        </div>
      </div>`;
  },
});
