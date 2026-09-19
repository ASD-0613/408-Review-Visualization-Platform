'use strict';
/* ============================================================================
 * tcp.js —— 【计算机网络】TCP 连接建立（三次握手）与释放（四次挥手）
 * ----------------------------------------------------------------------------
 * 快照设计：两个场景都是预先定义好的步骤序列，每步一帧：
 *   { msgs    已经发出的报文段列表 [{side:'C2S'|'S2C', kind, label}]
 *     cur     当前这一步发出的报文下标（-1 表示还没发）
 *     stateC / stateS   客户端 / 服务器当前状态
 *     changed 高亮哪一端的状态变化：'C' | 'S' | 'CS' | null
 *     extra   特殊阶段（如 2MSL 等待）的说明 }
 * 视觉：两条生命线 + 报文箭头 + 两端状态卡，当前报文虚线流动。
 * ========================================================================== */

/* 状态名 → 展示色 */
const _TCP_STATE_CLS = {
  CLOSED: 'bg-slate-200 text-slate-500', LISTEN: 'bg-slate-200 text-slate-500',
  'SYN-SENT': 'bg-amber-100 text-amber-700', 'SYN-RCVD': 'bg-amber-100 text-amber-700',
  'FIN-WAIT-1': 'bg-orange-100 text-orange-700', 'FIN-WAIT-2': 'bg-orange-100 text-orange-700',
  'CLOSE-WAIT': 'bg-yellow-100 text-yellow-700', 'LAST-ACK': 'bg-rose-100 text-rose-700',
  'TIME-WAIT': 'bg-sky-100 text-sky-700', ESTABLISHED: 'bg-emerald-100 text-emerald-700',
};

RC408.registerModule({
  id: 'net-tcp-conn',
  mode: 'stepper',
  title: 'TCP 连接建立与释放（三次握手 · 四次挥手）',

  theory: `
> **真题考情**：18 年中 7 年考 TCP 连接管理（2011/2019 选择考握手报文的 seq/ack 推算，2012/2023 大题考报文字段分析，2021/2022/2024 考挥手状态迁移与含 2MSL 的最短时间计算）。

## 为什么要"三次"握手
TCP 是全双工可靠传输，连接的双方都要确认：**自己的发送和接收能力都正常**。
- 第一次（SYN）：客户端 → 服务器，"我想连接（seq=x）"；
- 第二次（SYN+ACK）：服务器 → 客户端，"同意（seq=y），你刚才的请求我收到了（ack=x+1）"；
- 第三次（ACK）：客户端 → 服务器，"你的同意我收到了（ack=y+1）"。
**两次不行**：若第二次后连接即建立，一个**早已失效**的连接请求迟迟到达服务器，服务器单方面建立连接
就会白白等待、浪费资源；第三次握手让客户端有机会拒绝旧的请求。
**四次也不必**：第二、三次可合并（SYN+ACK 一起发）。

## 为什么要"四次"挥手
关闭是**两个方向各自独立**进行的：一方 FIN 只表示"我不再发了"，另一方可能还有数据要发 →
ACK 与 FIN **不能合并**，于是 2（被动方 ACK）+ 2（主动方 FIN、被动方 FIN）= 四次。

## TIME-WAIT 为什么等 2MSL
1. 保证最后一个 ACK 若丢失，对方重传 FIN 时客户端**还能应答**；
2. 让本连接中所有旧报文在网络中消逝，避免污染新连接。

## 考点提示
- 各状态含义与转移条件（SYN-SENT / SYN-RCVD / FIN-WAIT-1、2 / CLOSE-WAIT / LAST-ACK / TIME-WAIT）；
- seq / ack 的数值推导：ack = 对方最后一个 seq + 1（SYN、FIN 各占一个序号）；
- SYN 洪泛攻击与 SYN Cookie；RFC 建议释连接由客户端执行主动关闭（本例）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'scene', label: '演示场景', type: 'select', default: 'open',
      options: [
        { v: 'open', t: '建立连接 —— 三次握手' },
        { v: 'close', t: '释放连接 —— 四次挥手' },
      ],
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    return { scene: vals.scene === 'close' ? 'close' : 'open' };
  },

  /* ---------------- ② 纯算法：预定义步骤快照 ---------------- */
  buildSnapshots(model) {
    const isOpen = model.scene === 'open';
    const M = (side, kind, label) => ({ side, kind, label });

    /* 每一步：[报文, 客户端状态, 服务器状态, 高亮端, 日志, 描述] */
    const steps = isOpen ? [
      [null, 'CLOSED', 'LISTEN', null,
        '初始：客户端 CLOSED，服务器创建监听套接字进入 LISTEN，等待连接请求。',
        '服务器监听中，客户端准备发起连接'],
      [M('C2S', 'syn', 'SYN=1, seq=x'), 'SYN-SENT', 'LISTEN', 'C',
        '第一次握手：客户端发送 SYN 报文（SYN=1, seq=x，消耗一个序号），进入 SYN-SENT。',
        '① 客户端 → 服务器：请求建立连接'],
      [M('S2C', 'syn', 'SYN=1, ACK=1, seq=y, ack=x+1'), 'SYN-SENT', 'SYN-RCVD', 'S',
        '第二次握手：服务器回送 SYN+ACK（SYN=1, ACK=1, seq=y, ack=x+1），进入 SYN-RCVD。',
        '② 服务器 → 客户端：同意连接并确认'],
      [M('C2S', 'ack', 'ACK=1, seq=x+1, ack=y+1'), 'ESTABLISHED', 'SYN-RCVD', 'C',
        '第三次握手：客户端发送 ACK（ack=y+1），进入 ESTABLISHED —— 客户端确认了自己的收发能力都正常。',
        '③ 客户端 → 服务器：确认（此步可携带数据）'],
      [null, 'ESTABLISHED', 'ESTABLISHED', 'CS',
        '服务器收到 ACK 也进入 ESTABLISHED：三次握手完成，双方全双工通信。为什么不能两次？防止"已失效的连接请求"突然到达服务器造成资源浪费。',
        '连接建立完成，可以传输数据了'],
    ] : [
      [null, 'ESTABLISHED', 'ESTABLISHED', null,
        '初始：数据传输结束，双方均处于 ESTABLISHED。客户端决定主动关闭。',
        '双方通信完毕，准备释放连接'],
      [M('C2S', 'fin', 'FIN=1, seq=u'), 'FIN-WAIT-1', 'ESTABLISHED', 'C',
        '第一次挥手：客户端发送 FIN（FIN=1, seq=u），进入 FIN-WAIT-1 —— 停止发送数据，但还能接收。',
        '① 客户端 → 服务器：我的数据发完了'],
      [M('S2C', 'ack', 'ACK=1, ack=u+1'), 'FIN-WAIT-2', 'CLOSE-WAIT', 'CS',
        '第二次挥手：服务器回 ACK（ack=u+1），进入 CLOSE-WAIT；客户端收到后进入 FIN-WAIT-2 —— 此时连接处于"半关闭"，服务器仍可发数据。',
        '② 服务器 → 客户端：知道了（半关闭状态）'],
      [M('S2C', 'fin', 'FIN=1, ACK=1, seq=w, ack=u+1'), 'FIN-WAIT-2', 'LAST-ACK', 'S',
        '第三次挥手：服务器数据发完后发送 FIN（seq=w），进入 LAST-ACK，等待最后的确认。',
        '③ 服务器 → 客户端：我的数据也发完了'],
      [M('C2S', 'ack', 'ACK=1, ack=w+1'), 'TIME-WAIT', 'CLOSED', 'CS',
        '第四次挥手：客户端回 ACK（ack=w+1）后进入 TIME-WAIT；服务器收到 ACK 即 CLOSED。ACK 可能丢失，所以客户端不能立即关闭。',
        '④ 客户端 → 服务器：确认，客户端等待 2MSL'],
      [null, 'TIME-WAIT', 'CLOSED', 'C',
        'TIME-WAIT 等待 2MSL：① 若最后的 ACK 丢失，服务器会重传 FIN，客户端仍可应答；② 让本连接的旧报文在网络中消逝。',
        '客户端 TIME-WAIT：等待 2 倍报文最大生存时间'],
      [null, 'CLOSED', 'CLOSED', 'CS',
        '2MSL 到时，客户端进入 CLOSED，连接完全释放。四次挥手 = 两个方向各自独立地关闭。',
        '连接完全释放'],
    ];

    /* 由步骤表生成快照（每帧携带截至当前的完整报文/状态） */
    const snaps = [];
    const msgs = [];
    steps.forEach(([msg, stateC, stateS, changed, log, desc], i) => {
      if (msg) msgs.push(msg);
      snaps.push({
        msgs: msgs.map(m => ({ ...m })),
        cur: msg ? msgs.length - 1 : -1,
        stateC, stateS, changed,
        extra: (!isOpen && i === 5) ? 'wait' : null,
        log: isOpen ? `[建立连接 ${i}/${steps.length - 1}] ${log}` : `[释放连接 ${i}/${steps.length - 1}] ${log}`,
        logType: i === 0 ? 'info' : (i === steps.length - 1 ? 'success' : 'warn'),
        desc,
      });
    });
    return snaps;
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const isOpen = model.scene === 'open';
    const W = 760, TOP = 66, GAP = 66;
    const H = TOP + 40 + s.msgs.length * GAP + (s.extra === 'wait' ? 70 : 26);
    const xC = 200, xS = 560;
    const kindColor = { syn: '#6366f1', ack: '#059669', fin: '#e11d48' };

    /* 报文箭头 */
    const arrows = s.msgs.map((m, i) => {
      const y = TOP + 40 + i * GAP + 12;
      const cur = i === s.cur;
      const color = cur ? '#f59e0b' : kindColor[m.kind] || '#94a3b8';
      const [x1, x2] = m.side === 'C2S' ? [xC + 56, xS - 56] : [xS - 56, xC + 56];
      const midx = (x1 + x2) / 2;
      return `
        <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="${cur ? 3.5 : 2.5}"
          ${cur ? 'class="kedge-checking"' : ''} marker-end="url(#${cur ? 'arr-cur' : 'arr-' + m.kind})"/>
        <text x="${midx}" y="${y - 11}" text-anchor="middle" style="font:${cur ? 800 : 600} 12px Consolas,monospace"
          fill="${cur ? '#b45309' : '#64748b'}">${isOpen ? '' : ''}${m.label}</text>
        <text x="${x1 + (m.side === 'C2S' ? 6 : -6)}" y="${y + 16}" text-anchor="start" style="font:600 10px sans-serif" fill="#94a3b8">${cur ? '← 当前' : ''}</text>`;
    }).join('');

    /* 2MSL 等待可视化（客户端一侧的沙漏区） */
    const waitZone = s.extra === 'wait' ? (() => {
      const y = TOP + 40 + s.msgs.length * GAP + 8;
      return `
        <rect x="${xC - 90}" y="${y}" width="180" height="52" rx="10" fill="#e0f2fe" stroke="#7dd3fc" stroke-dasharray="6 4"/>
        <text x="${xC}" y="${y + 22}" text-anchor="middle" style="font:800 12px sans-serif" fill="#0369a1">⏳ TIME-WAIT</text>
        <text x="${xC}" y="${y + 40}" text-anchor="middle" style="font:600 11px sans-serif" fill="#0369a1">等待 2MSL 后关闭</text>`;
    })() : '';

    /* 两端状态卡 */
    const stateCard = (who, state, changed, history) => `
      <div class="rounded-xl border ${changed ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'} p-3">
        <div class="text-[11px] font-bold text-slate-400">${who}${changed ? ' · 本步状态变化' : ''}</div>
        <div class="mt-1.5">
          <span class="inline-block px-3 py-1 rounded-full text-xs font-extrabold ${_TCP_STATE_CLS[state] || 'bg-slate-100 text-slate-600'} ${changed ? 'anim-soft-blink' : ''}">${state}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
          ${history.map(h => `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-400 line-through">${h}</span>`).join('')}
        </div>
      </div>`;

    /* 客户端 / 服务器状态历史（从初始态到当前态的轨迹） */
    const trails = _tcpTrails(ctx, model);
    const msgChips = s.msgs.map((m, i) => {
      let cls = i === s.cur ? 'chip-check' : 'chip-hit';
      const icon = m.kind === 'syn' ? '🔗' : m.kind === 'fin' ? '👋' : '✓';
      return RC408.ui.chip(`${icon} ${m.side === 'C2S' ? 'C→S' : 'S→C'}`, i === s.cur ? cls : 'chip', m.label);
    }).join('');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
            <defs>
              <marker id="arr-syn" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#6366f1"/></marker>
              <marker id="arr-ack" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#059669"/></marker>
              <marker id="arr-fin" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#e11d48"/></marker>
              <marker id="arr-cur" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#f59e0b"/></marker>
            </defs>
            <rect x="${xC - 70}" y="12" width="140" height="38" rx="10" fill="#eef2ff" stroke="#a5b4fc"/>
            <text x="${xC}" y="36" text-anchor="middle" style="font:800 13px sans-serif" fill="#4338ca">💻 客户端</text>
            <rect x="${xS - 70}" y="12" width="140" height="38" rx="10" fill="#f0fdfa" stroke="#5eead4"/>
            <text x="${xS}" y="36" text-anchor="middle" style="font:800 13px sans-serif" fill="#0f766e">🖥️ 服务器</text>
            <line x1="${xC}" y1="${TOP}" x2="${xC}" y2="${H - 12}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>
            <line x1="${xS}" y1="${TOP}" x2="${xS}" y2="${H - 12}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>
            ${arrows}${waitZone}
          </svg>
        </div>

        <div class="grid grid-cols-2 gap-3">
          ${stateCard('客户端状态', s.stateC, s.changed === 'C' || s.changed === 'CS', trails.c)}
          ${stateCard('服务器状态', s.stateS, s.changed === 'S' || s.changed === 'CS', trails.s)}
        </div>

        <div>
          ${RC408.ui.sectionTitle('已发送报文段（橙色 = 当前步，悬停可看完整字段）')}
          <div class="flex flex-wrap gap-1.5">${msgChips || '<span class="text-xs text-slate-400">（尚未发送报文）</span>'}</div>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>记忆口诀：</b>${isOpen
            ? '三次握手 = 「请求 → 同意+确认 → 再确认」；SYN 消耗一个序号，所以对方 ack = seq+1。'
            : '四次挥手 = 「我不发了 → 知道了 →（数据发完后）我也不发了 → 确认」；主动方最后要 TIME-WAIT 2MSL。'}
        </div>
      </div>`;
  },
});

/** 由 Runner 全部快照推导两端的状态轨迹（用于状态卡下方的删除线历史） */
function _tcpTrails(ctx, model) {
  const snaps = RC408.Runner.snaps;
  const upto = RC408.Runner.idx;
  const c = [], sh = [];
  for (let i = 0; i <= upto && i < snaps.length; i++) {
    const s = snaps[i];
    if (!c.length || c[c.length - 1] !== s.stateC) c.push(s.stateC);
    if (!sh.length || sh[sh.length - 1] !== s.stateS) sh.push(s.stateS);
  }
  return { c: c.slice(0, -1), s: sh.slice(0, -1) };   // 去掉当前态（单独展示）
}
