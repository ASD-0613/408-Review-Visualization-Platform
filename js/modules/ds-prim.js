'use strict';
/* ============================================================================
 * ds-prim.js —— 【数据结构】Prim 最小生成树（**顶点扩张视角**，对比 Kruskal）  前缀 _pr
 * 考情（窗20 从零核定，依据 `考情缓存/` 原文，见 js/exam-history.js 的注释）：
 *   3/18 年（选 1 题 + 大 2 道）—— 选 2015-6（从 V4 开始的候选边 / 第二条边）；
 *   大 2017-42（2017_真题_p06 的图 G：从 A 开始求 MST 并判断唯一性）、
 *   大 2018-42（最经济布线方案：两种形态，画图并算总权值）。
 *   ⚠ 2012-8（MST 性质概念题，Prim / Kruskal 平权）按 §2.0 口径②归 ds-kruskal，**本模块不重复登记**；
 *     2015-6 原登记在 ds-kruskal，窗20 按"选择题尽量单一"口径**移出并改归本模块**。
 *
 * 数据模型与不变量（buildSnapshots 一次产出全部帧，render 只读快照 —— §1.3 铁律）
 *   输入：{ nodes:[顶点名], edges:[{id,a,b,w}], start:起点顶点名 }
 *   每帧**全量携带**下列字段（回退 / 跳帧安全）：
 *     type/step 'init' | 'pick' | 'grow' | 'done'
 *     inTree    已在生成树里的顶点（**数组顺序 = 顶点扩张顺序**，含起点）
 *     mstIds    已加入生成树的边 id（顺序 = 加入顺序，与 inTree 一一对应：第 k 条边把 inTree[k] 拉进来）
 *     cand      候选边数组 [{vid, eid, from, w}]：**只覆盖树外顶点**，按 nodes 顺序排列
 *               —— 不变量 ①（Prim 的核心）：每个树外顶点**至多一条**候选边，且它是该顶点到树内顶点的
 *                  **权值最小边**（教材的 lowcost 数组）。行序固定 = 表格不跳动。
 *               —— 不变量 ②（并列取小）：权值相同时取**边 id 较小者**（与 Kruskal 的稳定排序同口径），
 *                  同一输入每次演示结果完全一致（可断言）。
 *               —— 不变量 ③：cand 长度 ≤ n − |inTree|（**等号只在"每个树外顶点都有边连到树内"时成立**；
 *                  树外顶点暂时一条跨割边都没有时，它在表里显示「—（不可达）」，**不是 bug**）。
 *     cur       本帧被选中的最小候选边 {eid,a,b,vid,from,w}（pick / grow 帧有值，其余 null）
 *     addedV    grow 帧刚并入的顶点名（其余帧 null）
 *     dropped   本帧被更小候选取代的旧候选 [{eid,a,b,vid,w,byEid,byW}] —— "候选集更新"的证据
 *     sum       累计权重 = Σ 已加入边的 w；lowcost {顶点: 当前候选边权 | null}
 *     kseq      **静态参照**（Kruskal 对同一图的考察序列，不随帧变化）—— 供"双栏对照"与自校验
 *   单位：权重一律**非负**，与原边权完全一致（模块内不做任何换算）；"边数目标" = n − 1。
 *   帧序：init（只有起点入树）→ 每步 [pick（比较候选集）→ grow（并入顶点 + 候选集更新）] → done。
 *   稳定帧：init 与 done —— 浏览器侧的几何断言 / 截图只在这两帧上做判据。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-prim',
  mode: 'stepper',
  title: 'Prim 最小生成树（顶点扩张）',

  theory: `
> **为什么要有它**：要在连通带权图里选出总权值最小的 n−1 条边（最省的布线 / 建网）。Prim 按**顶点**扩张：每次把**离当前生成树最近的那个顶点**拉进来，与边数无关，故**稠密图更划算**。
> **怎么实现**：起点先入树，维护每个树外顶点的"到树内的最小边"（教材的 **lowcost 数组**：每个树外顶点只留最小的一条）；每轮**选出最小的那条候选边**，把它的树外端点并入树，再用这个新顶点**更新**候选集；重复到全部顶点入树。
> **记住什么**：**比较的是"一条边的权"，不是"路径总长"**（这是与 Dijkstra 的分界）+ 候选边**每个树外顶点只留最小的那条** + 无论从哪个顶点开始，**总权值相同**（树形只在"各环中边权互不相同"时才唯一）。

## 算法步骤（n 个顶点共 n−1 轮）
1. 任取起点 s 入树，集合 S = {s}（本模块默认从 A 开始，可切换）；
2. 对每个**树外**顶点 v，记 \\(lowcost[v]\\) = v 到 S 中顶点的**最小边权**，并记下这条边（每个 v 只留一条）；
3. 在全部候选边中**选出权值最小的那条**，把它与它的树外端点 v 一起并入 S —— 这条边就是本步选出的边；
4. 用新并入的 v **更新**其余树外顶点的候选边（只有更小时才替换）；重复 3、4 直到 n 个顶点全部入树。
- 时间：邻接矩阵实现 \\(O(n^2)\\)（**只与顶点数有关**）；Kruskal 排序主导 \\(O(E\\log_2 E)\\)（**只与边数有关**）。

## Prim 与 Kruskal 的对照（选择题常考同一句话）
| 对比项 | Prim（本模块） | Kruskal |
| --- | --- | --- |
| 贪心对象 | **顶点**：每轮拉一个"离树最近"的顶点 | **边**：每轮取全局最小且不成环的边 |
| 选边范围 | 只在**树内 ⟷ 树外**之间选（跨割边） | 全部边按权值升序依次考察 |
| 判据 | 新顶点到树的最小边（lowcost） | 并查集判两端**是否已连通** |
| 适合 | **稠密图**（\\(O(n^2)\\) 与边数无关） | **稀疏图**（\\(O(E\\log_2 E)\\) 看边数） |
| 相同点 | 都要求图连通、都是贪心；**总权值唯一，树形可能不唯一** | 同左 |

## 考点提醒（易错点）
1. **与 Dijkstra 的分界**：Prim 每轮只比较**一条边的权**，Dijkstra 比较的是**源点到该点的整条路径长**——两个模块代码结构像、含义完全不同；
2. 手算时**要写"当前候选边集"**：每个树外顶点只列它到树内的最小边，不要把所有跨割边都堆出来（2017-42 的官方答案就是逐轮写候选边集）；
3. **从不同顶点开始，选边次序可能不同，但总权值相同**；问"最小生成树唯一吗"要先分清问的是**权值**还是**形态**；
4. 图不连通时只能得到**最小生成森林**（选不满 n−1 条边，候选集会先变空）。

> **真题考情**：**3/18 年（选 1 题 + 大 2 道）**：选 2015-6（从 V4 开始的候选边、第二条边的判定）；
> 大 2017-42（从 A 开始求 MST、选边次序 + 唯一性条件）、2018-42（最经济布线方案：MST 有两种形态，画图并算总权值）。另：2012-8 的 MST 性质概念题按单选口径归 ds-kruskal。
`,

  /* ---------------- 输入表单（每项都必须显式给 default，§3.8-11） ---------------- */
  inputs: [
    { key: 'nodes', label: '顶点列表（逗号分隔，2~10 个）', default: 'A,B,C,D,E' },
    {
      key: 'edges', label: '边列表（每行一条：起点-终点:权重）', type: 'textarea', rows: 6, wide: true,
      default: 'A-B:6\nA-D:4\nA-E:5\nB-C:4\nC-D:6\nC-E:5\nD-E:4',
      help: '无向带权边，A-B 与 B-A 视为同一条；权重为非负数',
    },
    { key: 'start', label: '起点（Prim 从它开始扩张）', type: 'select', default: 'A', options: 'ABCDEFGHIJ'.split('').map(c => ({ v: c, t: c })) },
  ],

  quickActions: [
    {
      label: '📄 真题 2017-42（从 A 开始）',
      run(rt) {
        /* 2017_真题_p06 的图 G（权值经官方答案的逐轮候选边集反验，见 tmp_dp_smoke.js 的真题锚点断言）：
         * 边 A-B 6、A-D 4、A-E 5、B-C 4、C-D 6、C-E 5、D-E 4；
         * 官方答案的选边次序 = (A,D) → (D,E) → (C,E) → (B,C)，总权值 17。 */
        rt.setInput('nodes', 'A,B,C,D,E');
        rt.setInput('edges', 'A-B:6\nA-D:4\nA-E:5\nB-C:4\nC-D:6\nC-E:5\nD-E:4');
        rt.setInput('start', 'A');
        rt.load();
      },
    },
    {
      label: '🎲 随机连通图',
      run(rt) {
        // 先随机生成一棵树骨架保证连通，再补充若干随机边
        const n = RC408.util.rnd(5, 7);
        const names = 'ABCDEFGHIJ'.slice(0, n).split('');
        const seen = new Set(); const lines = [];
        const add = (a, b) => {
          const k = [a, b].sort().join('-');
          if (a === b || seen.has(k)) return;
          seen.add(k); lines.push(`${k}:${RC408.util.rnd(1, 20)}`);
        };
        for (let i = 1; i < n; i++) add(names[RC408.util.rnd(0, i - 1)], names[i]);
        for (let k = 0; k < n; k++) add(names[RC408.util.rnd(0, n - 1)], names[RC408.util.rnd(0, n - 1)]);
        rt.setInput('nodes', names.join(','));
        rt.setInput('edges', lines.join('\n'));
        rt.setInput('start', names[0]);
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入（纯校验，可抛错） ---------------- */
  parse(vals) {
    const nodes = vals.nodes.split(/[,，\s、]+/).map(s => s.trim()).filter(Boolean);
    if (nodes.length < 2) throw { message: '至少需要 2 个顶点' };
    if (nodes.length > 10) throw { message: '为便于展示，顶点数请控制在 10 个以内' };
    if (new Set(nodes).size !== nodes.length) throw { message: '顶点名重复' };

    const nodeSet = new Set(nodes);
    const edges = []; const seen = new Set();
    vals.edges.split(/\n+/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
      const m = line.match(/^(.+?)-(.+?):(.+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${line}」格式错误，应为 A-B:3` };
      const a = m[1].trim(), b = m[2].trim(), w = Number(m[3]);
      if (!nodeSet.has(a) || !nodeSet.has(b)) {
        throw { message: `第 ${i + 1} 行引用了未定义的顶点「${!nodeSet.has(a) ? a : b}」` };
      }
      if (!Number.isFinite(w) || w < 0) throw { message: `第 ${i + 1} 行权重「${m[3]}」须为非负数字` };
      if (a === b) throw { message: `第 ${i + 1} 行是自环（${a}-${b}），最小生成树不允许自环` };
      const key = [a, b].sort().join('-');
      if (seen.has(key)) throw { message: `边 ${key} 重复定义` };
      seen.add(key);
      edges.push({ id: edges.length, a, b, w });
    });
    if (!edges.length) throw { message: '请至少输入一条边' };
    if (!nodeSet.has(vals.start)) throw { message: `起点 ${vals.start} 不在顶点列表中` };
    return { nodes, edges, start: vals.start };
  },

  /* ---------------- ② 纯算法：产出全部快照 ---------------- */
  buildSnapshots(model) {
    const { nodes, edges, start } = model;
    const n = nodes.length;

    const adj = {};                                   // 邻接表：顶点 → 关联边
    nodes.forEach(v => { adj[v] = []; });
    edges.forEach(e => { adj[e.a].push(e); adj[e.b].push(e); });

    /** 树外顶点 v 到树内顶点的最小边（不变量 ① ②：只留一条，并列取边 id 小者） */
    const bestFor = (v, inSet) => {
      let best = null;
      for (const e of adj[v]) {
        const other = e.a === v ? e.b : e.a;
        if (!inSet.has(other)) continue;
        if (!best || e.w < best.w || (e.w === best.w && e.id < best.id)) best = e;
      }
      return best;
    };
    /** 当前候选集：**按 nodes 顺序**（行不跳动），只覆盖有候选边的树外顶点 */
    const candOf = (inSet) => {
      const out = [];
      nodes.forEach(v => {
        if (inSet.has(v)) return;
        const e = bestFor(v, inSet);
        if (e) out.push({ vid: v, eid: e.id, from: e.a === v ? e.b : e.a, w: e.w });
      });
      return out;
    };
    /** 候选集里最小的那条（权小优先，并列取边 id 小者 —— 与 bestFor 同口径） */
    const minCand = (cand) => cand.reduce((p, c) => (p === null || c.w < p.w || (c.w === p.w && c.eid < p.eid)) ? c : p, null);
    const lowcostOf = (cand) => { const o = {}; nodes.forEach(v => { o[v] = null; }); cand.forEach(c => { o[c.vid] = c.w; }); return o; };

    /* 静态参照：Kruskal 对同一图的考察序列（只用于双栏对照与"两条路径互证"） */
    const kseq = (() => {
      const parent = {}; nodes.forEach(v => { parent[v] = v; });
      const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      return [...edges].sort((p, q) => p.w - q.w || p.id - q.id).map(e => {
        const ra = find(e.a), rb = find(e.b);
        const take = ra !== rb;
        if (take) parent[ra] = rb;
        return { eid: e.id, a: e.a, b: e.b, w: e.w, take };
      });
    })();

    const snaps = [];
    const inSet = new Set([start]);
    const inTree = [start];
    const st = { mstIds: [], sum: 0 };
    let cand = candOf(inSet);
    const base = () => ({
      inTree: [...inTree], mstIds: [...st.mstIds], cand: cand.map(c => ({ ...c })),
      dropped: [], cur: null, addedV: null, sum: st.sum, lowcost: lowcostOf(cand), kseq,
    });

    // 第 0 帧：只有起点入树
    snaps.push({
      type: 'init', step: 'init', ...base(),
      log: `就绪：共 ${n} 个顶点、${edges.length} 条边，从顶点 ${start} 开始扩张。当前候选边 ${cand.length} 条（每个树外顶点只保留它到树内的最小边）。`,
      logType: 'info',
      desc: `起点 ${start} 入树；橙色虚线 = 候选边，节点下方的数字 = 该顶点到树内的最小边权`,
    });

    let round = 0, finished = inTree.length === n;
    while (!finished) {
      const best = minCand(cand);
      if (best === null) break;                       // 候选集为空 → 剩余顶点不可达（图不连通）
      round++;
      const e0 = edges[best.eid];

      // 帧 A：比较候选集，选出最小的那条
      snaps.push({
        type: 'pick', step: 'pick', ...base(), cur: { ...best, a: e0.a, b: e0.b },
        log: `第 ${round} 轮：候选边共 ${cand.length} 条，最小的是 (${e0.a},${e0.b}) 权重 ${best.w} —— 它把树外顶点 ${best.vid} 拉到离生成树最近的位置。`,
        logType: 'info',
        desc: `在候选边中选出最小的 (${e0.a},${e0.b}) 权重 ${best.w}（把 ${best.vid} 拉进树）`,
      });

      // 帧 B：并入顶点 + 候选集更新
      inSet.add(best.vid); inTree.push(best.vid);
      st.mstIds.push(best.eid); st.sum += e0.w;
      const oldCand = cand;
      cand = candOf(inSet);
      const newById = {}; cand.forEach(c => { newById[c.vid] = c; });
      const dropped = [];
      oldCand.forEach(c => {
        if (c.vid === best.vid) return;                                      // 它已入树，候选自然取消
        const now = newById[c.vid];
        if (now && now.eid !== c.eid) {
          const e1 = edges[now.eid];
          dropped.push({ ...c, byEid: now.eid, byW: now.w, byA: e1.a, byB: e1.b });
        }
      });
      const upd = dropped.length
        ? dropped.map(d => `${d.vid} 的候选由 (${d.from},${d.vid}) ${d.w} 换成 (${d.byA},${d.byB}) ${d.byW}`).join('；')
        : '无（新顶点没有带来更小的候选边）';
      snaps.push({
        type: 'grow', step: 'grow', ...base(),
        cur: { ...best, a: e0.a, b: e0.b }, addedV: best.vid, dropped,
        log: `顶点 ${best.vid} 并入生成树（第 ${inTree.length - 1} 条边，累计权重 ${st.sum}）。候选集更新：${upd}。`,
        logType: 'success',
        desc: `${best.vid} 已入树，累计权重 ${st.sum}；候选边集随之更新`,
      });

      if (inTree.length === n) {
        finished = true;
        snaps.push({
          type: 'done', step: 'done', ...base(),
          log: `全部 ${n} 个顶点已入树，最小生成树构建完成 🎉 共 ${st.mstIds.length} 条边，总权重 = ${st.sum}。选边次序：${traceText(inTree, st.mstIds, edges)}。`,
          logType: 'success',
          desc: `完成！总权重 ${st.sum}（Kruskal 得到的总权重相同：${kseq.filter(x => x.take).reduce((a, x) => a + x.w, 0)}）`,
        });
      }
    }

    // 未结束 = 图不连通 → 最小生成森林
    if (!finished) {
      snaps.push({
        type: 'done', step: 'done', ...base(),
        log: `候选边集已空，但还有 ${n - inTree.length} 个顶点无法到达 → 图不连通，只能得到最小生成森林：已选 ${st.mstIds.length} 条边，总权重 ${st.sum}。`,
        logType: 'warn',
        desc: `图不连通：得到最小生成森林（${inTree.length} 个顶点、${st.mstIds.length} 条边、总权重 ${st.sum}）`,
      });
    }

    /** "A-D → D-E → …"：把边序列写成真题答案的样子 */
    function traceText(vertices, ids, allEdges) {
      const byId = {}; allEdges.forEach(e => { byId[e.id] = e; });
      return ids.map(id => `(${byId[id].a},${byId[id].b})`).join(' → ');
    }
    return snaps;
  },

  /* ---------------- ③ 纯渲染：按当前快照绘制 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { nodes, edges, start } = model;
    const n = nodes.length;
    const pos = _prLayout(nodes);                       // 圆形布局（与 ds-kruskal 同族）
    const inSet = new Set(s.inTree);
    const edgeById = {}; edges.forEach(e => { edgeById[e.id] = e; });
    const candIds = new Set(s.cand.map(c => c.eid));
    const curId = s.cur ? s.cur.eid : -1;
    const orderOf = {}; s.inTree.forEach((v, i) => { orderOf[v] = i; });

    /* ---- 边：树内（绿实线）/ 本步选中（橙流动虚线 → 绿弹出）/ 候选（浅橙虚线）/ 其余（淡灰） ---- */
    const edgeSvg = edges.map(e => {
      const g = _prGeom(pos[e.a], pos[e.b], e.id);
      const inMst = s.mstIds.includes(e.id);
      let cls = 'kedge', style = '';
      if (e.id === curId && s.type === 'grow') cls = 'kedge kedge-mst kedge-just';
      else if (e.id === curId && s.type === 'pick') cls = 'kedge kedge-checking';
      else if (inMst) cls = 'kedge kedge-mst';
      else if (candIds.has(e.id)) { cls = 'kedge'; style = 'stroke:#fbbf24;stroke-width:3.5;stroke-dasharray:7 5'; }
      else style = 'opacity:.4';
      const ewCls = inMst ? 'ew ew-mst' : (e.id === curId && s.type === 'pick' ? 'ew ew-cur' : 'ew');
      return `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" class="${cls}"${style ? ` style="${style}"` : ''}/>
              <text x="${g.mx}" y="${g.my}" dy="0.35em" class="${ewCls}" style="font-size:12px;paint-order:stroke;stroke:#fff;stroke-width:3.5;stroke-linejoin:round">${e.w}</text>`;
    }).join('');

    /* ---- 顶点：树内绿（下方标"第 k 个入树"）/ 树外灰（下方标 lowcost）/ 刚并入橙 ---- */
    const nodeSvg = nodes.map(nm => {
      const p = pos[nm];
      const inT = inSet.has(nm);
      const just = s.type === 'grow' && s.addedV === nm;
      const fill = just ? '#f59e0b' : inT ? '#10b981' : '#e2e8f0';
      const txt = (inT || just) ? '#fff' : '#475569';
      const lc = s.lowcost[nm];
      const sub = inT ? `第 ${orderOf[nm] + 1} 个` : (lc === null || lc === undefined ? '—' : `候选 ${lc}`);
      const subColor = inT ? '#059669' : (lc === null || lc === undefined ? '#94a3b8' : '#b45309');
      const ring = nm === start ? `<circle cx="${p.x}" cy="${p.y}" r="28" fill="none" stroke="#4f46e5" stroke-width="2" stroke-dasharray="4 3"/>` : '';
      const halo = (just || (s.type === 'pick' && s.cur && s.cur.vid === nm))
        ? `<circle cx="${p.x}" cy="${p.y}" r="28" class="knode-halo" style="stroke:#f59e0b"/>` : '';
      return `${ring}${halo}<circle cx="${p.x}" cy="${p.y}" r="21" class="knode-circle" fill="${fill}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="fill:${txt}">${nm}</text>
        <text x="${p.x}" y="${p.y + 36}" text-anchor="middle" style="font:800 11px Consolas" fill="${subColor}">${sub}</text>`;
    }).join('');

    /* ---- 候选边集表：**每个树外顶点一行**（行序固定，不跳动） ---- */
    const bestId = s.type === 'pick' && s.cur ? s.cur.eid : (s.type === 'grow' && s.cur ? s.cur.eid : -1);
    const droppedVids = {}; s.dropped.forEach(d => { droppedVids[d.vid] = d; });
    const candRows = nodes.filter(nm => !inSet.has(nm)).map(nm => {
      const c = s.cand.find(x => x.vid === nm);
      const d = droppedVids[nm];
      const isNew = s.type === 'grow' && c && c.from === s.addedV;
      let cls = '';
      if (c && c.eid === bestId && s.type === 'pick') cls = 'row-cur';
      else if (isNew || d) cls = 'row-hit';
      const eTxt = c ? `(${c.from},${c.vid})` : '—（不可达）';
      const note = d ? `候选更新：(${d.from},${d.vid}) ${d.w} → (${d.byA},${d.byB}) ${d.byW}`
        : (isNew ? '新顶点带来的候选' : (c ? '每轮只留最小的一条' : '树内已无可达边'));
      return `<tr class="${cls}"><td class="font-bold">${nm}</td><td class="font-mono">${eTxt}</td>
        <td class="font-mono">${c ? c.w : '—'}</td><td class="text-[11px] text-slate-500">${note}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="text-center text-slate-400 text-xs">（无树外顶点）</td></tr>';

    /* ---- 双栏对照：左 = Prim 的扩张过程，右 = Kruskal 的接受序列（同一张图） ---- */
    const primRows = [];
    for (let i = 1; i < s.inTree.length; i++) {
      const e = edgeById[s.mstIds[i - 1]];
      const cum = s.mstIds.slice(0, i).reduce((a, id) => a + edgeById[id].w, 0);
      primRows.push(`<tr class="${i === s.inTree.length - 1 ? 'row-cur' : ''}"><td>${i}</td><td class="font-bold">${s.inTree[i]}</td>
        <td class="font-mono">(${e.a},${e.b})</td><td class="font-mono">${e.w}</td><td class="font-mono">${cum}</td></tr>`);
    }
    if (s.type === 'pick' && s.cur) {
      const e = edgeById[s.cur.eid];
      primRows.push(`<tr class="row-hit"><td>${s.inTree.length}</td><td class="font-bold">${s.cur.vid} ?</td>
        <td class="font-mono">(${e.a},${e.b})</td><td class="font-mono">${e.w}</td><td class="font-mono">本步选中</td></tr>`);
    }
    const kTake = s.kseq.filter(x => x.take);
    const kRows = kTake.map((x, i) => {
      const e = edgeById[x.eid];
      const cum = kTake.slice(0, i + 1).reduce((a, y) => a + y.w, 0);
      const isCur = i === s.mstIds.length - (s.type === 'grow' || s.type === 'done' ? 1 : 0);
      return `<tr class="${isCur ? 'row-cur' : ''}"><td>${i + 1}</td><td class="font-mono">(${e.a},${e.b})</td>
        <td class="font-mono">${e.w}</td><td class="font-mono">${cum}</td></tr>`;
    }).join('');

    const stateText = { init: '待开始', pick: '比较候选集…', grow: '✓ 并入顶点', done: '🏁 已结束' }[s.type] || s.type;
    const stats =
      RC408.ui.statCard('已入树顶点', `${s.inTree.length} / ${n}`, `扩张顺序：${s.inTree.join(' → ')}`, 'text-emerald-600') +
      RC408.ui.statCard('已加入边', `${s.mstIds.length} / ${n - 1}`, 'n−1 条为目标', 'text-emerald-600') +
      RC408.ui.statCard('累计权重', s.sum, '生成树边权和', 'text-indigo-600') +
      RC408.ui.statCard('当前状态', stateText, s.type === 'pick' ? `候选 ${s.cand.length} 条` : '', s.type === 'pick' ? 'text-amber-600' : 'text-slate-700');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 680 460" class="w-full h-auto mx-auto" style="max-width:680px">
            ${edgeSvg}${nodeSvg}
          </svg>
        </div>

        <div>
          ${RC408.ui.sectionTitle('候选边集（每个树外顶点只留"到树内的最小边" —— 这就是 lowcost 数组）')}
          <div class="overflow-x-auto"><table class="tbl w-full"><thead><tr><th>树外顶点</th><th>候选边</th><th>权重</th><th>本帧变化</th></tr></thead><tbody>${candRows}</tbody></table></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            ${RC408.ui.sectionTitle('Prim（顶点扩张 · 本模块）')}
            <table class="tbl w-full"><thead><tr><th>步</th><th>并入顶点</th><th>选中的边</th><th>权</th><th>累计</th></tr></thead><tbody>${primRows.join('') || '<tr><td colspan="5" class="text-center text-slate-400 text-xs">（尚未扩张）</td></tr>'}</tbody></table>
          </div>
          <div>
            ${RC408.ui.sectionTitle('Kruskal（边贪心 · 对照同一张图）')}
            <table class="tbl w-full"><thead><tr><th>条</th><th>接受的边</th><th>权</th><th>累计</th></tr></thead><tbody>${kRows}</tbody></table>
            <div class="text-[11px] text-slate-400 mt-1">共考察 ${s.kseq.length} 条边，其中 ${s.kseq.length - kTake.length} 条因成环被放弃 —— 两条路径的<strong>选边次序</strong>不同（选出的边集可能不同），但<strong>总权值相同</strong>。</div>
          </div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#10b981', '已加入生成树（树内顶点 / 已选边）')}
          ${RC408.ui.legend('#f59e0b', '本步选中的最小候选边 / 刚并入的顶点')}
          ${RC408.ui.legend('#fbbf24', '候选边（树外顶点到树内的最小边）')}
          ${RC408.ui.legend('#4f46e5', '双虚线环 = 起点')}
          ${RC408.ui.legend('#cbd5e1', '树外顶点 / 未入选的边')}
        </div>
      </div>`;
  },
});

/* ---- Prim 专用：圆形布局与边几何（同族写法，前缀 _pr 避免与其他模块重名） ---- */
function _prLayout(nodes) {
  const n = nodes.length, W = 680, H = 460, cx = W / 2, cy = H / 2 + 4;
  const R = n <= 3 ? 120 : Math.min(176, 58 + n * 14);
  return nodes.map((name, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { name, x: +(cx + R * Math.cos(ang)).toFixed(1), y: +(cy + R * Math.sin(ang)).toFixed(1) };
  }).reduce((o, p) => { o[p.name] = p; return o; }, {});
}
/** 边两端收缩到顶点圆外侧（r = 顶点半径 + 4）；权值标签**沿边错开**（窗20 实测）：
 *  稠密图里多条弦的中点会挤在一起（圆上正对的"直径"甚至中点重合），故按边 id 决定
 *  沿边参数 t（0.37 / 0.50 / 0.63）与垂直偏移（±8px）——同一张图每次结果固定（可断言），
 *  且与顶点圆保持 ≥ 21px（t 最小 0.37、最短弦 108px ⟹ 离端点 ≥ 40px）。 */
function _prGeom(a, b, id, r = 25) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const k = id || 0;
  const t = 0.5 + ((k % 3) - 1) * 0.13;
  const off = (k % 2 ? 1 : -1) * 8;
  return {
    x1: +(a.x + ux * r).toFixed(1), y1: +(a.y + uy * r).toFixed(1),
    x2: +(b.x - ux * r).toFixed(1), y2: +(b.y - uy * r).toFixed(1),
    mx: +(a.x + dx * t - uy * off).toFixed(1), my: +(a.y + dy * t + ux * off).toFixed(1),
  };
}
