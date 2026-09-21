'use strict';
/* ============================================================================
 * ds-dijkstra.js —— 【数据结构】Dijkstra 最短路径（贪心，单源无负权） 前缀 _dj
 * 考情：18 年中 **3 年**考（选 2012-7 确定次序、2016-8 依次确定的顶点；
 * 大 2014-42——以网络拓扑为背景，抽象成无向带权图后求最短路径）。
 * （窗14 勘误：原写"2014-42/43"，真题 2014 只有 42 题属本考点）
 * 快照：每轮两帧——①选最小 dist 顶点并"确定"②松弛其邻边；附每轮 dist 表。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-dijkstra',
  mode: 'stepper',
  title: 'Dijkstra 最短路径（单源，贪心）',

  theory: `
> **为什么要有它**：带权图里"从一点到其余各点的最短路径"要逐轮确定——Dijkstra 用**贪心**，每轮把当前 dist 最小的未确定顶点"敲定"，不再反悔。
> **怎么实现**：**dist[源] = 0**、其余为 \\(\\infty\\)；每轮取未确定顶点中 dist 最小者并入集合 S，再用它**松弛**所有出边；重复 n 轮。
> **记住什么**：**确定次序由 dist 大小决定、不由编号决定** + 已确定的 dist 不再变化 + **只适用于非负权**。

## 算法（贪心，要求边权非负）
1. 初始 **dist[源] = 0**、其余为 \\(\\infty\\)，集合 S 为空，\\(prev\\) 记录前驱；
2. 每轮：取**未确定顶点中 dist 最小者** u 并入 S（此刻 \\(dist[u]\\) 就是最短距离）；
3. **松弛** u 的每条出边 \\((u,v,w)\\)：若 \\(dist[u]+w \\lt dist[v]\\)，则更新 \\(dist[v]\\)、并令 \\(prev[v]=u\\)；
4. 重复 n 轮（或直到所有可达顶点都进入 S）。
- 时间：邻接矩阵 \\(O(n^2)\\)；堆优化 \\(O((n+e)\\log_2 n)\\)。

## 考点提醒（易错点）
1. 每轮"确定"一个顶点，**次序完全由 dist 最小决定**——别按顶点编号顺序猜；
2. 已确定顶点的 dist 不再变化，前提是**非负权**；有负权边必须改用 Floyd / Bellman-Ford；
3. 求具体路径：由 prev 从终点回溯到源，**写答案时要把路径倒过来**；
4. **边权全为 1 时不必用 Dijkstra**，BFS 逐层扩展即可（这是 BFS 与本模块的分界）；
5. 与 Prim 的区别：Dijkstra 累加的是**源点到该点的整条路径长**，Prim 每次只看**一条边的权**。

> **真题考情**：**3/18 年（选 2 题 + 大 1 道）**：选 2012-7（顶点被确定的次序）、2016-8（依次确定的顶点）；
> 大 2014-42（以网络拓扑为背景，抽象成无向带权图后再求最短路径，本质仍是数据结构题）。
`,

  inputs: [
    { key: 'edges', label: '带权边（u-v:w，无向）', type: 'textarea', rows: 4, wide: true,
      default: 'A-B:4\nA-C:1\nB-C:2\nB-D:3\nC-D:4\nC-E:5\nD-E:2' },
    { key: 'src', label: '源点', type: 'select', default: 'A', options: 'ABCDEFGHIJ'.split('').map(c => ({ v: c, t: c })) },
  ],

  quickActions: [
    { label: '含不可达点', run(rt) { rt.setInput('edges', 'A-B:2\nA-C:5\nB-D:1\nE-F:3'); rt.load(); } },
  ],

  parse(vals) {
    const edges = [];
    const nodes = new Set();
    vals.edges.split('\n').map(l => l.trim()).filter(Boolean).forEach((line, i) => {
      const m = line.match(/^(.+?)-(.+?):(.+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${line}」格式错误，应为 A-B:3` };
      const w = Number(m[3]);
      if (!Number.isFinite(w) || w < 0) throw { message: `权值「${m[3]}」须为非负数（Dijkstra 不支持负权）` };
      edges.push({ a: m[1].trim(), b: m[2].trim(), w });
      nodes.add(m[1].trim()); nodes.add(m[2].trim());
    });
    const nl = [...nodes].sort();
    if (nl.length < 2 || nl.length > 8) throw { message: '顶点数须在 2 ~ 8' };
    if (!nl.includes(vals.src)) throw { message: `源点 ${vals.src} 不在图中` };
    return { edges, nodes: nl, src: vals.src };
  },

  buildSnapshots(model) {
    const { edges, nodes, src } = model;
    const INF = Infinity;
    let dist = {}, prev = {}, settled = [];
    nodes.forEach(n => { dist[n] = n === src ? 0 : INF; prev[n] = null; });
    const snaps = [];
    const fmtD = d => d === INF ? '∞' : d;
    const dCopy = () => { const o = {}; nodes.forEach(n => o[n] = dist[n]); return o; };
    const sCopy = () => [...settled];

    snaps.push({ step: 'init', dist: dCopy(), settled: sCopy(), u: null, relaxed: [], graph: { edges, nodes, src },
      log: `就绪：源点 ${src}，dist[${src}] = 0，其余 ∞。每轮确定一个 dist 最小的未确定顶点。`,
      logType: 'info', desc: '点击「单步执行」：观察 dist 最小的贪心选择与松弛传播' });

    while (settled.length < nodes.length) {
      /* ① 选最小 */
      let u = null;
      nodes.forEach(n => { if (!settled.includes(n) && dist[n] !== INF && (u === null || dist[n] < dist[u])) u = n; });
      if (u === null) {
        snaps.push({ step: 'unreachable', dist: dCopy(), settled: sCopy(), u: null, relaxed: [], graph: { edges, nodes, src },
          log: `剩余顶点 dist 均为 ∞（不可达）→ 算法结束。`,
          logType: 'warn', desc: '剩余顶点不可达' });
        break;
      }
      settled.push(u);
      snaps.push({ step: 'settle', dist: dCopy(), settled: sCopy(), u, relaxed: [], graph: { edges, nodes, src },
        log: `第 ${settled.length} 轮：未确定顶点中 dist 最小的是 ${u}（dist = ${fmtD(dist[u])}）→ 其最短路径确定，并入集合 S`,
        logType: 'success', desc: `确定 ${u}：最短距离 = ${fmtD(dist[u])}` });

      /* ② 松弛出边 */
      const relaxed = [];
      edges.filter(e => e.a === u || e.b === u).forEach(e => {
        const v = e.a === u ? e.b : e.a;                      // 无向：两侧都松弛
        if (settled.includes(v)) return;
        const nd = dist[u] + e.w;
        const improved = nd < dist[v];
        relaxed.push({ v, from: u, old: fmtD(dist[v]), nw: fmtD(nd), improved });
        if (improved) { dist[v] = nd; prev[v] = u; }
      });
      if (relaxed.length) {
        snaps.push({ step: 'relax', dist: dCopy(), settled: sCopy(), u, relaxed, graph: { edges, nodes, src },
          log: `松弛 ${u} 的邻边：${relaxed.map(r => `dist[${r.v}] ${r.old}→${r.nw}${r.improved ? ' ✓更新' : '（未更优）'}`).join('；')}`,
          logType: 'info', desc: `松弛 ${u} 的邻边（绿色 = 更新成功）` });
      }
    }

    snaps.push({ step: 'done', dist: dCopy(), settled: sCopy(), u: null, relaxed: [], graph: { edges, nodes, src },
      log: `完成！${nodes.map(n => `${n}: ${fmtD(dist[n])}`).join('，')}（∞ = 不可达）。路径由 prev 前驱数组回溯。`,
      logType: 'success',
      desc: `完成：${nodes.length} 个顶点全部处理，最短距离见 dist 表` });
    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { edges, nodes, src } = s.graph || model;
    const n = nodes.length;
    const pos = {};                                     // 圆形布局
    nodes.forEach((name, i) => {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      pos[name] = { x: 340 + 140 * Math.cos(ang), y: 215 + 140 * Math.sin(ang) };
    });
    const fmtD = d => d === Infinity ? '∞' : d;

    const edgeSvg = edges.map(e => {
      const p = pos[e.a], q = pos[e.b];
      const relaxedHere = (s.relaxed || []).some(r => (r.v === e.b && e.a === s.u) || (r.v === e.a && e.b === s.u));
      const imp = (s.relaxed || []).find(r => (r.v === e.b && e.a === s.u) || (r.v === e.a && e.b === s.u));
      const hot = s.step === 'relax' && relaxedHere;
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${hot ? (imp && imp.improved ? '#10b981' : '#cbd5e1') : '#cbd5e1'}" stroke-width="${hot && imp && imp.improved ? 4 : 2.5}"/>
        <text x="${mid.x}" y="${mid.y}" dy="0.35em" class="knode-text" style="fill:#64748b;font-size:12px">${e.w}</text>`;
    }).join('');

    const nodeSvg = nodes.map(nm => {
      const p = pos[nm];
      const done = s.settled.includes(nm);
      const isU = s.u === nm && s.step === 'settle';
      const isSrc = nm === src;
      const fill = isU ? '#f59e0b' : done ? '#10b981' : '#e2e8f0';
      const txt = done || isU ? '#fff' : '#475569';
      return `${isSrc ? `<circle cx="${p.x}" cy="${p.y}" r="27" fill="none" stroke="#4f46e5" stroke-width="2" stroke-dasharray="4 3"/>` : ''}<circle cx="${p.x}" cy="${p.y}" r="22" class="knode-circle" fill="${fill}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="fill:${txt}">${nm}</text>
        <text x="${p.x}" y="${p.y + 34}" text-anchor="middle" style="font:800 12px Consolas" fill="${done ? '#059669' : '#64748b'}">${fmtD(s.dist[nm])}</text>`;
    }).join('');


    /* dist 表（每轮一列，最多 10 轮） */
    const distRows = nodes.map(nm => `
      <tr><td class="font-bold">${nm}</td><td class="font-mono">${s.dist[nm] === Infinity ? '∞' : s.dist[nm]}</td>
      <td class="font-mono">${s.settled.includes(nm) ? '✓' : '—'}</td></tr>`).join('');

    const stats =
      RC408.ui.statCard('源点', src, '单源最短路径', 'text-indigo-600') +
      RC408.ui.statCard('已确定', `${s.settled.length} / ${nodes.length}`, '并入 S 集合（绿色）', 'text-emerald-600') +
      RC408.ui.statCard('时间复杂度', 'O(n²)', '邻接矩阵/边列表', 'text-slate-600') +
      RC408.ui.statCard('前提', '权值非负', '负权边需改用 Floyd/BF', 'text-rose-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 680 460" class="w-full h-auto mx-auto" style="max-width:680px">${edgeSvg}${nodeSvg}</svg>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>${RC408.ui.sectionTitle('dist 表（当前各顶点最短距离估计）')}
            <table class="tbl w-full"><thead><tr><th>顶点</th><th>dist</th><th>已确定</th></tr></thead><tbody>${distRows}</tbody></table>
          </div>
          <div>${RC408.ui.sectionTitle('贪心选择次序（确定顺序即考点答案）')}
            <div class="flex flex-wrap gap-1.5 items-center">${s.settled.length ? s.settled.map((x, i) => RC408.ui.chip(`${i + 1}. ${x}`, 'chip-hit')).join('<span class="text-slate-300">→</span>') : '<span class="text-xs text-slate-400">（尚未确定任何顶点）</span>'}</div>
          </div>
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#10b981', '已确定最短路径（dist 不再变）')}
          ${RC408.ui.legend('#f59e0b', '本轮选中的最小 dist 顶点')}
          ${RC408.ui.legend('#4f46e5', '双虚线环 = 源点')}
          ${RC408.ui.legend('#10b981', '松弛成功的边')}
        </div>
      </div>`;
  },
});
