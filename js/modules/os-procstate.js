'use strict';
/* ============================================================================
 * os-procstate.js —— 【操作系统】进程状态转换（五态模型）（前缀 _ps）
 * 考情：状态迁移事件辨析高频（2018-27 阻塞事件、2022-28 执行→阻塞、
 * 2023-27 时间片用完→就绪、2025-25 调度时机等）。
 * 快照：每次状态迁移一帧——五态图高亮迁移边，记录各进程当前状态。
 * 事件写法（parse 支持）：调度X / X时间片用完 / X请求I/O / I/O完成唤醒X /
 * X创建完成 / X终止。
 * ========================================================================== */

RC408.registerModule({
  id: 'os-procstate',
  mode: 'stepper',
  title: '进程状态转换（五态模型）',

  theory: `
> **真题考情**：18 年中 **10 年**直接考状态迁移事件辨析（2010-26、2012-30、2014-26、2015-25、
> 2017-27、2018-27、2019-24、2021-27、2022-28、2023-27，全为选择题），
> 核心是分清**谁触发**（CPU 调度程序 / 进程自身 / 中断）与**去哪个队列**。

## 五态模型与合法迁移
| 从 → 到 | 触发事件 | 说明 |
| --- | --- | --- |
| 创建 → 就绪 | 进程创建完成（PCB 建好） | 进入就绪队列 |
| 就绪 → 运行 | **被调度程序选中** | 唯一获得 CPU 的入口 |
| 运行 → 就绪 | 时间片用完 / 被高优先级抢占 | 回就绪队列排队 |
| 运行 → 阻塞 | 主动请求等待（I/O、wait 等） | 进程自身行为 |
| 阻塞 → 就绪 | 等待的事件完成（被唤醒） | 由中断/其他进程引发 |
| 运行 → 终止 | exit / 异常 | 释放资源 |

## 三大易错点（高频选项）
1. **阻塞 → 运行不存在**：唤醒后必须先进就绪队列；
2. **就绪 → 阻塞不存在**：就绪态进程没有占用 CPU，无从"等待事件完成"；
3. **时间片用完是 运行 → 就绪**（不是阻塞）；**I/O 请求是 运行 → 阻塞**（不是就绪）。
`,

  inputs: [
    { key: 'event', label: '事件序列（每行/逗号一个；写法见提示）', type: 'textarea', rows: 4, wide: true,
      default: 'P1创建完成, 调度P1, P1请求I/O, I/O完成唤醒P1, 调度P2, P2时间片用完, 调度P3, P3终止',
      help: '支持：调度X ｜ X时间片用完 ｜ X请求I/O ｜ I/O完成唤醒X ｜ X创建完成 ｜ X终止' },
  ],

  parse(vals) {
    const events = vals.event.split(/[,，;；\n]+/).map(x => x.trim()).filter(Boolean).map(e => {
      let m;
      if ((m = e.match(/^调度\s*(\S+)$/))) return { kind: 'dispatch', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)时间片用完$/))) return { kind: 'slice', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)请求I\/?O$/i))) return { kind: 'io-wait', name: m[1], raw: e };
      if ((m = e.match(/^I\/?O完成.*?唤醒\s*(\S+)$/))) return { kind: 'io-done', name: m[1], raw: e };
      if ((m = e.match(/^唤醒\s*(\S+)$/))) return { kind: 'io-done', name: m[1], raw: e };
      if ((m = e.match(/^I\/?O完成，?\s*(\S+)\s*就绪$/))) return { kind: 'io-done', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)创建完成$/))) return { kind: 'new', name: m[1], raw: e };
      if ((m = e.match(/^(.+?)(?:运行出错)?终止$/))) return { kind: 'exit', name: m[1], raw: e };
      throw { message: `事件「${e}」无法解析。支持：调度X / X时间片用完 / X请求I/O / I/O完成唤醒X / X创建完成 / X终止` };
    });
    if (!events.length) throw { message: '请输入至少一个事件' };
    if (events.length > 14) throw { message: '事件最多 14 个' };
    return { events };
  },

  buildSnapshots(model) {
    const { events } = model;
    const states = {};
    const snaps = [];
    const push = (step, ev, legal, note, logType) => snaps.push({
      step, ev: ev ? { ...ev } : null, legal, states: { ...states },
      log: (legal ? '✓ ' : '✗ ') + note, logType, desc: note,
    });

    push('init', null, true, '五态模型就绪。观察每次事件的合法迁移路径。', 'info');

    events.forEach((ev, idx) => {
      let legal = true, note = '';
      const name = ev.name, st = states[name];
      switch (ev.kind) {
        case 'new':
          if (st) { legal = false; note = `${name} 已存在（${st}），不能重复创建`; break; }
          states[name] = '就绪';
          note = `${name} 创建完成 → 进入就绪（PCB 建立，等待调度）`;
          break;
        case 'dispatch':
          if (st === '就绪') { states[name] = '运行'; note = `调度程序选中 ${name}：就绪 → 运行（获得 CPU）`; }
          else { legal = false; note = `${name} 当前是 ${st || '不存在'}，只有就绪态进程能被调度`; }
          break;
        case 'slice':
          if (st === '运行') { states[name] = '就绪'; note = `${name} 时间片用完：运行 → 就绪（注意：不是阻塞！）`; }
          else { legal = false; note = `${name} 不在运行态（当前 ${st || '不存在'}），无法"时间片用完"`; }
          break;
        case 'io-wait':
          if (st === '运行') { states[name] = '阻塞'; note = `${name} 发出 I/O 请求：运行 → 阻塞（主动等待事件）`; }
          else { legal = false; note = `${name} 不在运行态（当前 ${st || '不存在'}），只有运行态能主动请求 I/O`; }
          break;
        case 'io-done':
          if (st === '阻塞') { states[name] = '就绪'; note = `${name} 等待的 I/O 完成：阻塞 → 就绪（被中断唤醒，不能直接去运行）`; }
          else { legal = false; note = `${name} 不在阻塞态（当前 ${st || '不存在'}），无需唤醒`; }
          break;
        case 'exit':
          if (st === '运行') { states[name] = '终止'; note = `${name} 运行结束（exit）→ 终止，释放全部资源`; }
          else { legal = false; note = `${name} 当前是 ${st || '不存在'}，只有运行态能主动终止`; }
          break;
        default: legal = false; note = '未知事件';
      }
      push('event', ev, legal, note, legal ? 'success' : 'error');
    });

    push('done', null, true,
      '演示结束。回看三大易错点：阻塞不能直接去运行、就绪不能去阻塞、时间片用完是回到就绪。',
      'success', '完成！');
    return snaps;
  },

  render(ctx) {
    const { snap: s, ctx: c } = ctx;
    const idx = ctx.idx, total = ctx.total;
    /* 五态图布局（教材经典画法）：
       就绪⇄运行 用上下两条弧分离双向边；运行→阻塞、阻塞→就绪 走左右两条斜线互不交叉；
       不存在的"阻塞→运行"画成右侧红色虚线短箭头示意 */
    const pos = { 创建: [80, 70], 就绪: [250, 70], 运行: [450, 70], 终止: [640, 70], 阻塞: [360, 215] };
    const curEv = s.ev;
    const kind = curEv ? curEv.kind : null;
    const W2 = 760;

    /* 边定义：path 直接给贝塞尔/直线，label 单独定位，避免重叠 */
    const edges = [
      // 创建 → 就绪（水平直线）
      { d: `M 138 70 L 190 70`, lx: 164, ly: 56, label: '创建完成', key: 'new', color: '#94a3b8' },
      // 就绪 → 运行（上弧：被调度）
      { d: `M 308 70 Q 350 18 392 70`, lx: 350, ly: 34, label: '被调度', key: 'dispatch', color: '#f59e0b' },
      // 运行 → 就绪（下弧：时间片用完/抢占）
      { d: `M 392 98 Q 350 148 308 98`, lx: 306, ly: 142, label: '时间片用完/抢占', key: 'slice', color: '#94a3b8' },
      // 运行 → 阻塞（右侧斜线：请求 I/O）
      { d: `M 468 96 L 402 188`, lx: 476, ly: 148, label: '请求 I/O', key: 'io-wait', color: '#94a3b8' },
      // 阻塞 → 就绪（左侧斜线：I/O 完成唤醒）
      { d: `M 318 188 L 254 98`, lx: 222, ly: 148, label: 'I/O 完成唤醒', key: 'io-done', color: '#94a3b8' },
      // 运行 → 终止（水平直线）
      { d: `M 508 70 L 578 70`, lx: 543, ly: 56, label: 'exit / 异常', key: 'exit', color: '#94a3b8' },
      // 不存在的 阻塞 → 运行（右侧红色虚线示意，短箭头+文字）
      { d: `M 470 160 L 520 120`, lx: 545, ly: 148, label: '阻塞→运行 不存在', key: 'illegal-br', color: '#fca5a5', illegal: true },
    ];
    const markers = ['ps-0','ps-1','ps-2','ps-3','ps-4','ps-5','ps-6'].map((id, i) =>
      `<marker id="${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${['#94a3b8','#f59e0b','#94a3b8','#94a3b8','#fca5a5','#94a3b8','#94a3b8'][i]}"/></marker>`).join('');

    const edgeSvg = edges.map(e => {
      const active = kind && e.key === kind;
      const illegal = !!e.illegal;
      return `<path d="${e.d}" fill="none" stroke="${illegal ? '#fca5a5' : active ? '#f59e0b' : e.color}" stroke-width="${active ? 4 : 2.5}" ${illegal || active ? 'stroke-dasharray="7 4"' : ''} marker-end="url(#ps-' + edges.indexOf(e) + ')"/>
        <text x="${e.lx}" y="${e.ly}" text-anchor="middle" style="font:700 11px sans-serif" fill="${illegal ? '#e11d48' : active ? '#b45309' : '#64748b'}">${e.label}</text>`;
    }).join('');

    const endpoints = { new: ['创建', '就绪'], dispatch: ['就绪', '运行'], slice: ['运行', '就绪'],
      'io-wait': ['运行', '阻塞'], 'io-done': ['阻塞', '就绪'], exit: ['运行', '终止'] }[kind] || null;
    const stateNodes = Object.entries(pos).map(([n, [x, y]]) => {
      const occ = Object.entries(s.states).filter(([, st]) => st === n).map(([nm]) => nm);
      const bg = { 创建: '#c7d2fe', 就绪: '#d1fae5', 运行: '#fde68a', 阻塞: '#fecaca', 终止: '#e5e7eb' }[n];
      const isEndpoint = endpoints && (endpoints[0] === n || endpoints[1] === n);
      return `<rect x="${x - 58}" y="${y - 26}" width="116" height="52" rx="12" fill="${bg}" stroke="${isEndpoint ? '#f59e0b' : '#94a3b8'}" stroke-width="${isEndpoint ? 3 : 1.5}"/>
        <text x="${x}" y="${y - 4}" text-anchor="middle" style="font:800 14px sans-serif" fill="#334155">${n}</text>
        <text x="${x}" y="${y + 14}" text-anchor="middle" style="font:600 10px sans-serif" fill="#475569">${occ.length ? occ.join(' ') : '—'}</text>`;
    }).join('');

    const kindLabel = { new: '创建→就绪', dispatch: '就绪→运行', slice: '运行→就绪', 'io-wait': '运行→阻塞', 'io-done': '阻塞→就绪', exit: '运行→终止' }[kind] || '—';
    const stats =
      RC408.ui.statCard('事件进度', `${Math.max(idx, 0)} / ${total - 1}`, '按输入顺序逐个发生', 'text-indigo-600') +
      RC408.ui.statCard('当前事件', curEv ? curEv.raw : '—', kind ? kindLabel : '', 'font-mono text-amber-600') +
      RC408.ui.statCard('本次迁移', s.legal ? '合法 ✓' : '不合法 ✗', s.legal ? '符合五态模型' : '违反状态转换规则', s.legal ? 'text-emerald-600' : 'text-rose-600') +
      RC408.ui.statCard('三大易错', '—', '阻塞→运行 / 就绪→阻塞 不存在', 'text-slate-500');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 760 280" class="w-full h-auto mx-auto" style="max-width:760px">
            <defs>${markers}</defs>${edgeSvg}${stateNodes}
          </svg>
        </div>
        <div class="rounded-xl ${s.legal ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'} px-4 py-2.5 text-xs leading-relaxed">
          💡 <b>辨析要点：</b>就绪→运行只由"调度"触发；运行→阻塞是进程**主动**等待；阻塞→就绪由事件完成触发后仍需排队；
          <b>不存在</b>阻塞→运行、就绪→阻塞。
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#f59e0b', '本帧发生的迁移')}
          ${RC408.ui.legend('#fca5a5', '不存在的迁移（红色虚线）')}
        </div>
      </div>`;
  },
});
