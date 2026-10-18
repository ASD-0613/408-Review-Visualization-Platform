'use strict';
/* ============================================================================
 * ds-floyd.js —— 【数据结构】Floyd 最短路径（多源，动态规划） 前缀 _fl
 * ----------------------------------------------------------------------------
 * 为什么单开一条：Dijkstra 只解决"一个源点到其余各点"，且要求**权值非负**；
 *   Floyd 一次算出**任意两点间**的最短距离，允许**负权边**（只要没有负权回路）——
 *   两者是同一章"最短路径"的一对：单源 ⟷ 全源、贪心 ⟷ 动态规划、非负 ⟷ 可负边。
 *
 * ★ 数据模型（parse 的产物）
 *   { edges: [{a, b, w}], nodes: [按字母序], idx: {名字 → 下标}, src }
 *   权值 w 允许为**负整数**（Floyd 的卖点），但顶点数限 2~8（矩阵要看得清）。
 *
 * ★ 不变量（本模块所有断言与检查器都围着它们写，见 tmp_t49_smoke.js）
 *   ① 无向图 ⟹ 距离矩阵**对称**、对角线恒 0；
 *   ② D^(k)[i][j] = 只允许用 {0..k} 这些顶点作中转时的最短距离
 *      （k 从 −1 起：D^(−1) 就是邻接矩阵，无边填 ∞）；
 *   ③ **单调不增**：每轮只可能变小 —— D^(k)[i][j] ≤ D^(k−1)[i][j]；
 *   ④ 一轮里被更新的格子必须满足 **D[i][j] \\gt D[i][k] + D[k][j]**（严格改善才更新）；
 *   ⑤ 末态 D[i][j] = 全源最短距离；若某个 **D[i][i] \\lt 0** ⟹ 存在**负权回路**
 *      （此时"最短路径"无意义，模块给警告帧而不是静默给数）；
 *   ⑥ **与 Dijkstra 的对照**：非负权时，Floyd 末态的**第 src 行**必须等于
 *      "以 src 为源的单源 Dijkstra 结果" —— 本模块内部另写了一份**独立**的
 *      Dijkstra（15 行，不共用本模块任何函数）专门用来做这条对照与自检。
 *
 * ★ 帧结构（stepper）：init →（每轮 k：pivot → updates → round）→ done（→ negcycle）
 *   pivot  ：选中中转点 k，说明"本轮拿 k 当中间站"
 *   updates：列出所有被 k 改善的 (i, j)：旧值 → 新值，并写出 i→k→j 这条候选路
 *   round  ：D^(k) 的完整矩阵（矩阵表里的绿格 = 本轮的改善）
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-floyd',
  mode: 'stepper',
  title: 'Floyd 最短路径（多源，DP）',

  theory: `
> **为什么要有它**：Dijkstra 每次只算"一个源点到其余各点"，求"任意两点间"要跑 n 遍；Floyd 用**动态规划**一次算完全部点对，而且**允许负权边**（只要没有负权回路）。
> **怎么实现**：把"允不允许经过某些顶点"当成状态逐轮放开——第 k 轮把顶点 \\(v_k\\) 也放进"可以当中转站"的集合，检查每一对 \\((i,j)\\)：若 \\(D[i][k]+D[k][j]\\) 更小就更新。n 轮之后能中转的顶点用完了，D 就是全源最短路。
> **记住什么**：**状态定义（前 k 个点可中转）** + **三重循环的顺序（k 必须在最外层）** + **D 只减不增** + **对角线变负 ⟹ 负权回路**。

## 算法（三重循环，k 在最外层）

1. 初始 \\(D^{(0)}\\) = 邻接矩阵：\\(D[i][i]=0\\)、有边填权值、无边填 \\(\\infty\\)；
2. **for k = 0..n−1**（中转点，逐个放开）：**for i**：**for j**：
   若 \\(D[i][j] \\gt D[i][k] + D[k][j]\\) 则 \\(D[i][j] = D[i][k] + D[k][j]\\)；
3. n 轮后 \\(D[i][j]\\) 就是 i 到 j 的最短距离；路径可由**记录中转点的 next / path 矩阵**回溯。
- 时间 \\(O(n^3)\\)、空间 \\(O(n^2)\\)；与"以每个顶点为源各跑一次 Dijkstra（\\(O(n^3)\\) 或 \\(O(n^2\\log n)\\) 级）"相比，Floyd 的常数小、代码短，**还能带负权**。
- **为什么 k 必须在最外层**：状态是"只允许前 k 个点中转"，把 k 放进内层就等于"同一个中转点被反复放开又收回"，得到的不是 DP 定义的解。

## 考点提醒（易错点）

1. **k 必须在最外层**（三重循环 \\(k \\to i \\to j\\)）——写成 \\(i \\to j \\to k\\) 就退化成"用当前矩阵反复松弛"，结果不对；
2. **对角线变成负数 ⟹ 存在负权回路**：此时任何"最短距离"都可以再绕一圈变小，表格数值无意义。这条判据就写在矩阵的 \\(D[i][i]\\) 上，不需要另跑一遍算法；
3. **负权边只在有向图里才有意义**：无向图的一条边可以来回走，\\(A\\to B\\to A\\) 的权值是 \\(2w\\)；只要 \\(w \\lt 0\\)，它本身就是负权回路。真题里"给无向图 + 负权边问最短路"多半是**故意设的陷阱**；
4. **与 Dijkstra 的边界**：非负权时"Floyd 的任意一行 = 以该点为源的单源 Dijkstra"，两条路都对；出现负权边后 Dijkstra 的贪心假设失效（已确定的 dist 可能再变小），只有 Floyd / Bellman-Ford 还能用；
5. **求路径要另开数组**：Floyd 的 D 只记距离，要还原"具体走哪条路"得再维护一个 \\(path[i][j]\\)（记录中转点或后继），单看 D 是回推不出路径的。

## 与本章其他模块的分工（一张表看完）

| 模块 | 解决什么 | 复杂度 | 适用条件 |
| --- | --- | --- | --- |
| 图的存储（邻接矩阵/表） | 把图存下来 | \\(O(n^2)\\)／\\(O(n+e)\\) | 一切图算法的基础 |
| 图的遍历 DFS / BFS | 遍历序列；**无权图**最短路 | \\(O(n+e)\\) | BFS 求最短路只对**无权**（或等权）图成立 |
| Kruskal / Prim | **最小生成树**（连接所有点的最小代价） | \\(O(e\\log_2 e)\\)／\\(O(n^2)\\) | 带权**无向**图；与最短路是两回事 |
| Dijkstra | **单源**最短路 | \\(O(n^2)\\)，堆优化 \\(O((n+e)\\log_2 n)\\) | **权值非负**；贪心，每轮敲定一个点 |
| **Floyd（本模块）** | **任意两点间**最短路（全源） | \\(O(n^3)\\) | 允许**负权边**，但**不能有负权回路** |
| 拓扑排序 / 关键路径 | 有向无环图的次序与最长路 | \\(O(n+e)\\) | 必须**无环**（AOV / AOE 网） |

> **真题考情**：**0/18 年（真题暂无单独出题）**：Floyd 属考纲"最短路径"内，18 年真题只在 2025 年解析里被顺带提过一次（"BFS 无法处理带权图，需用 Dijkstra 或 Floyd"）；已考的最短路题都归 Dijkstra（2012-7 确定次序、2016-8、2021-8）与 BFS（无权）。本模块按"考纲内、真题未考"建条目，分布条如实为 0 年。
`,

  inputs: [
    { key: 'edges', label: '带权边（u-v:w 或 u->v:w；权值可为负）', type: 'textarea', rows: 4, wide: true,
      default: 'A-B:4\nA-C:1\nB-C:2\nB-D:3\nC-D:4\nC-E:5\nD-E:2' },
    { key: 'dir', label: '图的类型', type: 'select', default: 'undirected',
      options: [{ v: 'undirected', t: '无向图（A-B 双向）' }, { v: 'directed', t: '有向图（A->B 单向；负权边只在有向图里才有意义）' }] },
    { key: 'src', label: '对照用的源点（与 Dijkstra 对照）', type: 'select', default: 'A',
      options: 'ABCDEFGHIJ'.split('').map(c => ({ v: c, t: c })) },
  ],

  quickActions: [
    { label: '📗 与 ds-dijkstra 同图（无向 · 5 点）', run(rt) { rt.setInput('edges', 'A-B:4\nA-C:1\nB-C:2\nB-D:3\nC-D:4\nC-E:5\nD-E:2'); rt.setInput('dir', 'undirected'); rt.setInput('src', 'A'); rt.load(); } },
    { label: '★ 有向 + 负权边（Dijkstra 会算错：B 先被敲定，随后又被 C 绕过）', run(rt) { rt.setInput('edges', 'A->B:2\nA->C:5\nC->B:-4\nA->D:1\nC->D:1'); rt.setInput('dir', 'directed'); rt.setInput('src', 'A'); rt.load(); } },
    { label: '⚠ 无向图里的负边 = 负权回路（对角线变负）', run(rt) { rt.setInput('edges', 'A-B:4\nA-C:5\nB-C:-3\nC-D:2'); rt.setInput('dir', 'undirected'); rt.setInput('src', 'A'); rt.load(); } },
    { label: '📘 有向图 6 点网络（2014-42 同族）', run(rt) { rt.setInput('edges', 'A->B:6\nA->C:2\nA->D:4\nB->E:3\nC->D:1\nC->E:5\nD->F:4\nE->F:2'); rt.setInput('dir', 'directed'); rt.setInput('src', 'A'); rt.load(); } },
  ],

  parse(vals) {
    const edges = [];
    const nodes = new Set();
    const directed = vals.dir === 'directed';
    vals.edges.split('\n').map(l => l.trim()).filter(Boolean).forEach((line, i) => {
      const m = line.match(/^(.+?)(->|-)(.+?):(.+)$/);
      if (!m) throw { message: '第 ' + (i + 1) + ' 行「' + line + '」格式错误，应为 A-B:3（无向）或 A->B:3（有向）' };
      const w = Number(m[4]);
      if (!Number.isFinite(w)) throw { message: '权值「' + m[4] + '」须是整数（Floyd 允许负数）' };
      const a = m[1].trim(), b = m[3].trim();
      if (a === b) throw { message: '第 ' + (i + 1) + ' 行是自己到自己的边（对角线恒为 0，不用写）' };
      /* 写了 -> 就按有向处理（哪怕类型选的是无向，也如实提示更稳妥——这里按"运算符优先"取有向） */
      edges.push({ a: a, b: b, w: w, dir: (m[2] === '->') || directed });
      nodes.add(a); nodes.add(b);
    });
    const nl = [...nodes].sort();
    if (nl.length < 2 || nl.length > 8) throw { message: '顶点数须在 2 ~ 8（矩阵要看得清）' };
    if (!nl.includes(vals.src)) throw { message: '对照源点 ' + vals.src + ' 不在图中' };
    const idx = {}; nl.forEach((nm, i) => { idx[nm] = i; });
    const anyDirected = edges.some(e => e.dir);
    const allDirected = edges.every(e => e.dir);
    return { edges: edges, nodes: nl, idx: idx, src: vals.src, directed: anyDirected, mixed: anyDirected && !allDirected, sym: !anyDirected };
  },

  buildSnapshots(model) {
    const { edges, nodes, idx, src } = model;
    const n = nodes.length;
    const INF = Infinity;
    const fmt = d => d === INF ? '∞' : String(d);
    /* D 用二维数组（下标 = nodes 的下标），深拷贝进快照 —— 快照必须全量携带视觉状态 */
    let D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : INF));
    edges.forEach(e => {
      const i = idx[e.a], j = idx[e.b];
      /* 平行边取较小者；无向（`-`）两个方向都写，有向（`->`）只写 i→j */
      D[i][j] = Math.min(D[i][j], e.w);
      if (!e.dir) D[j][i] = Math.min(D[j][i], e.w);
    });
    const copy = M => M.map(r => r.slice());
    const snaps = [];
    const graph = { edges, nodes, src, directed: model.directed, mixed: model.mixed, sym: model.sym };
    const cellList = () => {
      const out = [];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ i, j, v: D[i][j] });
      return out;
    };

    snaps.push({ step: 'init', k: -1, D: copy(D), upd: [], pivotRow: [], graph,
      log: '就绪：D⁽⁰⁾ = 邻接矩阵（对角线 0、无边 ∞）。接下来逐个放开顶点当"中转站"。',
      logType: 'info', desc: '点击「单步执行」：第 1 帧选中转点 k，第 2 帧列出被它改善的格子，第 3 帧给出 D⁽ᵏ⁾' });

    for (let k = 0; k < n; k++) {
      const pivotRow = [];
      for (let i = 0; i < n; i++) if (i !== k) pivotRow.push(i);
      snaps.push({ step: 'pivot', k: k, D: copy(D), upd: [], pivotRow, graph,
        log: '第 ' + (k + 1) + ' 轮：把 ' + nodes[k] + ' 放进"可中转集合"（D⁽' + k + '⁾ 只允许用 ' +
          nodes.slice(0, k + 1).join('、') + ' 当中转）',
        logType: 'info', desc: '中转点 k = ' + nodes[k] + '：检查每一对 (i, j) 能否借它变短' });

      /* 本轮的改善：**教科书就地更新**（i、j 都从 0 扫到 n−1，边算边落盘）。
         ⚠ 窗49 实测修掉的两个口径错（写第一版时同时踩中）：
           ① 原写法把 i === k、j === k、i === j 全跳过 ⟹ **对角线永远不动 ⟹ 负权回路再也检测不出来**
              （判据：`negcycle` 帧永不出现，见 tmp_t49_smoke.js ④）；
           ② 原写法拿"本轮开始时的矩阵"统一算候选值（批量更新）⟹ 与教科书**就地更新**不等价
              （有负权回路时 D[k][k] \\lt 0 会让 i→k / k→j 这些格子在本轮内继续被缩短）。
           现在 = 就地更新：候选值 D[i][k] + D[k][j] 用的是**当前**（本轮可能已改过）的值。 */
      const before = copy(D);
      const upd = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const cand = D[i][k] + D[k][j];
          if (cand < D[i][j]) {
            upd.push({ i: i, j: j, from: nodes[i], to: nodes[j], old: D[i][j], nw: cand });
            D[i][j] = cand;
          }
        }
      }
      upd.forEach(u => { /* 已就地落盘 */ });
      if (upd.length) {
        snaps.push({ step: 'updates', k: k, D: copy(D), upd, pivotRow, graph,
          log: upd.map(u => u.from + '→' + u.to + '：' + fmt(u.old) + ' → ' + u.nw + '（走 ' +
            u.from + '→' + nodes[k] + '→' + u.to + '）').join('；'),
          logType: 'success', desc: nodes[k] + ' 改善了 ' + upd.length + ' 对点（矩阵里绿格）' });
      } else {
        snaps.push({ step: 'updates', k: k, D: copy(D), upd: [], pivotRow, graph,
          log: '这一轮没有任何点对能借 ' + nodes[k] + ' 变短（D 不变）',
          logType: 'warn', desc: nodes[k] + ' 没有带来改善' });
      }
      snaps.push({ step: 'round', k: k, D: copy(D), upd: upd, pivotRow, graph,
        log: 'D⁽' + (k + 1) + '⁾ 完成：' + (upd.length ? '本轮改善 ' + upd.length + ' 对' : '本轮无改善'),
        logType: 'success', desc: '第 ' + (k + 1) + ' 轮结束：能中转的点已放开到 ' + nodes[k] });
    }

    /* 负权回路检测：对角线出现负数 ⟹ 从某点出发绕回自己越绕越小 */
    const neg = [];
    for (let i = 0; i < n; i++) if (D[i][i] < 0) neg.push(nodes[i]);
    if (neg.length) {
      const cause = (!model.directed && edges.some(e => e.w < 0))
        ? '本次是无向图里写了负权边：无向边可以来回走，A→B→A 就是一条权值为 2w 的回路，w 为负 ⟹ 必是负权回路。'
        : '图里存在一条总权为负的有向回路（A→…→A），沿它多绕一圈就更短一次。';
      snaps.push({ step: 'negcycle', k: n - 1, D: copy(D), upd: [], pivotRow: [], graph, neg,
        log: '⚠ 对角线出现负数：' + neg.join('、') + ' —— 存在负权回路，此时"最短路径"没有意义（可以越绕越短）。' + cause,
        logType: 'warn', desc: '检测到负权回路：对角线变负（' + neg.join('、') + '）' });
    }

    /* 与 Dijkstra 的独立对照（非负权时两法必须一致；负权时 Dijkstra 本就不适用，只作对照展示） */
    const dij = (function () {
      const dist = {}; nodes.forEach(x => dist[x] = INF); dist[src] = 0;
      const done = new Set();
      while (done.size < n) {
        let u = null;
        nodes.forEach(x => { if (!done.has(x) && dist[x] !== INF && (u === null || dist[x] < dist[u])) u = x; });
        if (u === null) break;
        done.add(u);
        edges.forEach(e => {
          let v = null;
          if (e.dir) { if (e.a === u) v = e.b; }                      /* 有向：只顺 a→b */
          else { v = (e.a === u) ? e.b : (e.b === u ? e.a : null); }  /* 无向：两侧都松弛 */
          if (!v || done.has(v)) return;
          if (dist[u] + e.w < dist[v]) dist[v] = dist[u] + e.w;
        });
      }
      return nodes.map(x => ({ node: x, d: dist[x] }));
    })();
    const srcRow = nodes.map((x, j) => ({ node: x, floyd: D[idx[src]][j], dir: dij[j].d }));
    const consistent = srcRow.every(r => r.floyd === r.dir);

    snaps.push({ step: 'done', k: n - 1, D: copy(D), upd: [], pivotRow: [], graph, srcRow, consistent, neg,
      log: '完成！D 已给出任意两点间的最短距离（' + n + ' 轮放开全部中转点）。' +
        (neg.length ? '⚠ 存在负权回路，上表数值不可当作最短路。' : '') +
        '对照：Floyd 第 ' + src + ' 行 ' + (consistent ? '与单源 Dijkstra 完全一致' : '与 Dijkstra 不一致（含负权边时 Dijkstra 不适用）'),
      logType: neg.length ? 'warn' : 'success',
      desc: neg.length ? '完成（但含负权回路，结果无效）' : '完成：全源最短距离矩阵 + 与 Dijkstra 的对照' });
    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { edges, nodes, src } = (s.graph || model);
    const n = nodes.length;
    const idx = {}; nodes.forEach((nm, i) => { idx[nm] = i; });
    const fmt = d => d === Infinity ? '∞' : String(d);
    const k = s.k;

    /* ---- 左：小图（圆形布局；本帧中转点琥珀、本轮被走的边加粗） ---- */
    const pos = {};
    nodes.forEach((nm, i) => {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      pos[nm] = { x: 200 + 96 * Math.cos(ang), y: 140 + 96 * Math.sin(ang) };
    });
    const inPlay = new Set();
    (s.upd || []).forEach(u => { inPlay.add(u.from + '→' + u.to); });
    const edgeSvg = edges.map(e => {
      const p = pos[e.a], q = pos[e.b];
      const rel = (s.upd || []).some(u => (u.from === e.a && u.to === e.b) || (u.from === e.b && u.to === e.a));
      const stroke = rel ? '#10b981' : '#cbd5e1';
      const wdt = rel ? 4 : 2;
      let extra = '';
      if (e.dir) {
        /* 有向边：在靠近终点处放一个小三角箭头（不然无向/有向看起来一样） */
        const dx = q.x - p.x, dy = q.y - p.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / L, uy = dy / L;
        const tip = { x: q.x - ux * 20, y: q.y - uy * 20 };
        const b1 = { x: tip.x - ux * 9 - uy * 5, y: tip.y - uy * 9 + ux * 5 };
        const b2 = { x: tip.x - ux * 9 + uy * 5, y: tip.y - uy * 9 - ux * 5 };
        extra = '<polygon points="' + tip.x + ',' + tip.y + ' ' + b1.x + ',' + b1.y + ' ' + b2.x + ',' + b2.y +
          '" fill="' + stroke + '"/>';
      }
      const mid = { x: (p.x + q.x) / 2 - (e.dir ? 0 : 0), y: (p.y + q.y) / 2 - 9 };
      return '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '" stroke="' + stroke +
        '" stroke-width="' + wdt + '"/>' + extra +
        '<text x="' + mid.x + '" y="' + mid.y + '" dy="0.35em" text-anchor="middle" style="font:700 11px Consolas;fill:' +
        (e.w < 0 ? '#e11d48' : '#64748b') + '">' + e.w + '</text>';
    }).join('');
    const nodeSvg = nodes.map((nm, i) => {
      const p = pos[nm];
      const isK = i === k && s.step !== 'done' && s.step !== 'init';
      const isSrc = nm === src;
      return (isSrc ? '<circle cx="' + p.x + '" cy="' + p.y + '" r="24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-dasharray="4 3"/>' : '') +
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="19" fill="' + (isK ? '#f59e0b' : '#e2e8f0') + '"/>' +
        '<text x="' + p.x + '" y="' + p.y + '" dy="0.35em" text-anchor="middle" style="font:800 13px sans-serif;fill:' +
        (isK ? '#fff' : '#475569') + '">' + nm + '</text>';
    }).join('');

    /* ---- 右：D 矩阵（本帧主角） ---- */
    const updSet = new Set((s.upd || []).map(u => u.i + ',' + u.j));
    const head = '<tr><th class="text-xs">D</th>' + nodes.map(nm => '<th class="text-xs">' + nm + '</th>').join('') + '</tr>';
    const rows = nodes.map((nm, i) => {
      const isPivot = i === k && s.step !== 'done' && s.step !== 'init';
      const cells = nodes.map((_, j) => {
        const v = s.D[i][j];
        const isUpd = updSet.has(i + ',' + j);
        const isDiag = i === j;
        const bg = isUpd ? '#dcfce7' : (isDiag ? '#f1f5f9' : (isPivot || (j === k && s.step !== 'done' && s.step !== 'init') ? '#fffbeb' : '#fff'));
        const color = v === Infinity ? '#cbd5e1' : (isDiag && v < 0 ? '#e11d48' : (isUpd ? '#047857' : '#334155'));
        return '<td style="background:' + bg + ';color:' + color + ';font:700 12px Consolas;text-align:center;padding:3px 6px">' + fmt(v) + '</td>';
      }).join('');
      return '<tr><th class="text-xs">' + nm + '</th>' + cells + '</tr>';
    }).join('');

    /* ---- 本帧更新明细 / 与 Dijkstra 的对照 ---- */
    const updRows = (s.upd || []).map(u => '<tr><td class="font-mono">' + u.from + '→' + u.to + '</td>' +
      '<td class="font-mono">' + u.from + '→' + nodes[k] + '→' + u.to + '</td>' +
      '<td class="font-mono text-slate-400">' + fmt(u.old) + '</td><td class="font-mono text-emerald-700 font-bold">' + u.nw + '</td></tr>').join('');
    const srcRows = (s.srcRow || []).map(r => '<tr><td class="font-bold">' + r.node + '</td>' +
      '<td class="font-mono">' + fmt(r.floyd) + '</td><td class="font-mono">' + fmt(r.dir) + '</td>' +
      '<td>' + (r.floyd === r.dir ? '<span class="text-emerald-600">一致</span>' : '<span class="text-rose-600">不一致</span>') + '</td></tr>').join('');

    const stats =
      RC408.ui.statCard('顶点数 n', String(n), '矩阵 n×n（全源）', 'text-indigo-600') +
      RC408.ui.statCard('已放开中转点', s.step === 'init' ? '0' : String(Math.max(0, k) + (s.step === 'done' ? 1 : (s.step === 'pivot' ? 0 : 1))) + ' / ' + n,
        s.step === 'init' ? '尚未开始' : '当前可中转：' + nodes.slice(0, (s.step === 'pivot' ? k : k + 1)).join('、'), 'text-amber-600') +
      RC408.ui.statCard('本轮改善', String((s.upd || []).length), '对点对被 k 缩短', 'text-emerald-600') +
      RC408.ui.statCard('图的类型', (s.graph && s.graph.directed) ? '有向' : '无向',
        (s.graph && s.graph.directed) ? '负权边只在有向图里才有意义' : '无向图出现负边 ⟹ 必是负权回路', 'text-slate-600') +
      RC408.ui.statCard('负权边', edges.some(e => e.w < 0) ? '有' : '无', 'Floyd 允许负权边', 'text-rose-600') +
      RC408.ui.statCard('负权回路', (s.neg && s.neg.length) ? '有：' + s.neg.join('、') : '无', '对角线出现负数即有', (s.neg && s.neg.length) ? 'text-rose-600' : 'text-emerald-600');
    /* 方向 × 负权的组合提示（考生最容易踩的坑：无向图里写负权边） */
    const negEdge = edges.some(e => e.w < 0);
    const dirHint = !negEdge ? ''
      : ((s.graph && s.graph.directed)
        ? '<div class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">有向图 + 负权边：Floyd 仍然正确（只要没有总权为负的有向回路）—— 这正是它比 Dijkstra 强的地方。</div>'
        : '<div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">⚠ 无向图里的负权边本身就是负权回路（来回走一次 A→B→A 权值为 2w）：Floyd 会算出对角线为负、结果无意义。要演示负权边，请把「图的类型」切成有向图。</div>');

    stage.innerHTML =
      '<div class="space-y-4">' +
        '<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">' + stats + '</div>' +
        dirHint +
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
          '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2">' +
            '<svg viewBox="0 0 400 280" class="w-full h-auto" style="max-width:400px">' + edgeSvg + nodeSvg + '</svg>' +
            '<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 px-2 pb-1">' +
              RC408.ui.legend('#f59e0b', '本轮中转点 k') +
              RC408.ui.legend('#10b981', '本轮被缩短的点对') +
              RC408.ui.legend('#4f46e5', '虚线环 = 对照源点') +
            '</div>' +
          '</div>' +
          '<div>' + RC408.ui.sectionTitle('距离矩阵 D（本帧状态）') +
            '<div class="overflow-x-auto"><table class="tbl w-full text-center"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
            '<p class="text-xs text-slate-500 mt-2">绿格 = 本轮（k = ' + (k < 0 ? '—' : nodes[k]) + '）刚被缩短；琥珀行/列 = 中转点所在行列；红字 = 负值。</p>' +
          '</div>' +
        '</div>' +
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
          '<div>' + RC408.ui.sectionTitle('本轮更新明细（i→k→j 抄近路）') +
            ((s.upd || []).length
              ? '<table class="tbl w-full"><thead><tr><th>点对</th><th>路径</th><th>旧值</th><th>新值</th></tr></thead><tbody>' + updRows + '</tbody></table>'
              : '<p class="text-sm text-slate-500">' + (s.step === 'init' ? '（还没开始）' : '本帧没有被改善的点对') + '</p>') +
          '</div>' +
          '<div>' + RC408.ui.sectionTitle('与 Dijkstra 的对照（源点 ' + src + '）') +
            (srcRows
              ? '<table class="tbl w-full"><thead><tr><th>顶点</th><th>Floyd 第 ' + src + ' 行</th><th>单源 Dijkstra</th><th>是否一致</th></tr></thead><tbody>' + srcRows + '</tbody></table>' +
                '<p class="text-xs text-slate-500 mt-2">' + (s.consistent
                  ? '两者一致：非负权时 Floyd 的任意一行就等于"以该点为源"的单源最短路。'
                  : '⚠ 不一致：图里有负权边 —— 这正是 Dijkstra 的适用边界（贪心假设不再成立）。') + '</p>'
              : '<p class="text-sm text-slate-500">走到末帧后给出对照表（非负权时两法必须一致）。</p>') +
          '</div>' +
        '</div>' +
        '<div>' + RC408.ui.sectionTitle('本章其他模块的分工（Floyd 站在哪一格）') +
          '<table class="tbl w-full text-xs"><thead><tr><th>模块</th><th>解决什么</th><th>复杂度</th><th>适用条件</th></tr></thead><tbody>' +
            '<tr><td>图的存储</td><td>邻接矩阵 / 邻接表 / 十字链表 / 邻接多重表</td><td>O(n²) / O(n+e)</td><td>一切图算法的基础</td></tr>' +
            '<tr><td>图的遍历 DFS / BFS</td><td>遍历序列；无权图最短路</td><td>O(n+e)</td><td>BFS 最短路只对无权（或等权）图成立</td></tr>' +
            '<tr><td>Kruskal / Prim</td><td>最小生成树（连接所有点的最小代价）</td><td>O(e log e) / O(n²)</td><td>带权无向图；与最短路是两回事</td></tr>' +
            '<tr><td>Dijkstra</td><td>单源最短路（一个点到其余各点）</td><td>O(n²)</td><td>权值非负；贪心，每轮敲定一个点</td></tr>' +
            '<tr style="background:#ecfdf5"><td><b>Floyd（本模块）</b></td><td><b>任意两点间最短路（全源）</b></td><td><b>O(n³)</b></td><td><b>允许负权边，但不能有负权回路</b></td></tr>' +
            '<tr><td>拓扑排序 / 关键路径</td><td>有向无环图的次序与最长路</td><td>O(n+e)</td><td>必须无环（AOV / AOE 网）</td></tr>' +
          '</tbody></table>' +
        '</div>' +
      '</div>';
  },
});
