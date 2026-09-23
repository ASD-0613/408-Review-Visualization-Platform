'use strict';
/* ============================================================================
 * ds-kruskal.js —— 【数据结构】Kruskal 最小生成树（**边贪心视角**，对比 Prim）  前缀 _ks
 * 考情（窗20 重核：**2015-6 按 §2.0 口径②"选择题尽量单一"移出本模块**——那题问的是
 *   "从 V4 开始"的 Prim 顶点扩张过程；移除后本模块 = **4/18 年**（选 2 题 + 大 2 道）：
 *   选 2012-8（MST 性质概念）、2020-7（按 Kruskal 选边次序）；大 2017-42、2018-42。
 *   ⚠ 2015-6 的新家是 `ds-prim`；两条边的归属口径与依据见 `js/exam-history.js` 的注释。
 *
 * 数据模型与不变量（buildSnapshots 一次产出全部帧，render 只读快照 —— §1.3 铁律）
 *   输入：{ nodes:[顶点名], edges:[{id,a,b,w}] }
 *   每帧**全量携带**下列字段（回退 / 跳帧安全；数组一律 [...拷贝]）：
 *     type/step 'init' | 'check' | 'accept' | 'reject' | 'done'
 *                 —— check → accept/reject 是"同一条边"的两帧：先"橙色流动考察"，
 *                    再给结论（变绿加粗并入 / 变红闪烁跳过）
 *     edge       当前考察的边对象 {id,a,b,w}（init / done 帧为 null）
 *     mstIds     已加入生成树的边 id（顺序 = 加入顺序，**前缀性**：前 k 个就是第 k 帧的树）
 *     rejectedIds 已判"成环"被放弃的边 id；checkedIds 已考察过的边 id（含被放弃的）
 *     rootOf     {顶点名: 并查集根} —— 顶点按根着色，**合并即同色**（本模块的核心教学点）
 *     inVerts    由 mstIds 推出的"已纳入生成树的顶点"（派生量，统计卡与渲染都读它，不再现场重算）
 *     compCount  当前连通分量数（派生量）：初始 = n，每 accept 一次 −1；= 1 表示已连通
 *     sum        当前累计权重 = Σ 已加入边的 w
 *   单位：权重一律**非负**，与原边权完全一致（模块内不做任何换算）；"边数目标" = n − 1。
 *   帧序：init → 每条边 [check → (accept | reject)] → done（选满 n−1 条边时提前 done）。
 *   稳定帧：init 与 done —— 浏览器侧的几何断言 / 截图以这两帧为准。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-kruskal',
  mode: 'stepper',
  title: 'Kruskal 最小生成树（边贪心）',

  theory: `
> **为什么要有它**：要在连通带权图里选出总权值最小的 n−1 条边（最省成本的布线 / 建网）——Kruskal 按"边"从小到大贪心，**只与边数有关**，故稀疏图最快。
> **怎么实现**：所有边按权值升序排队，逐条看两端是否**已连通**（并查集 find）：不连通就收入生成树并 union，已连通就丢弃（加入必成环）。
> **记住什么**：**判环看"两端是否已连通"，不是看"有没有直接边"** + 选够 n−1 条即停 + **总权值唯一、树形可能不唯一**。

## 算法步骤（n 个顶点共选 n−1 条边）
1. 把图中所有边按权值**从小到大**排序（权值相同按输入顺序，保证演示可复现）；
2. 依次取出当前最小边 (u, v)；
3. 用**并查集**查 u、v 的根：**根不同** → 不构成环，加入生成树并合并两个集合；**根相同** → 已连通，加入必成环，**放弃**；
4. 已选边数达到 **n−1** 时提前结束（n 为顶点数）。
- 时间：排序主导 \\(O(E\\log_2 E)\\)（并查集带路径压缩近似 \\(O(\\alpha)\\)）；空间 \\(O(V+E)\\)。

## Kruskal 与 Prim 的对照（选择题常考同一句话）
| 对比项 | Kruskal（本模块） | Prim |
| --- | --- | --- |
| 贪心对象 | **边**：每轮取全局最小且不成环的边 | **顶点**：每轮拉一个"离树最近"的顶点 |
| 选边范围 | 全部边按权值升序依次考察 | 只在**树内 ⟷ 树外**之间选（跨割边） |
| 判据 | 并查集判两端**是否已连通** | 新顶点到树的最小边（lowcost） |
| 适合 | **稀疏图**（\\(O(E\\log_2 E)\\) 看边数） | **稠密图**（\\(O(n^2)\\) 与边数无关） |
| 相同点 | 都要求图连通、都是贪心；**总权值唯一，树形可能不唯一** | 同左 |

## 考点提醒（易错点）
1. 权值相同的边**考察顺序可任选**，但**总权值唯一**——问"最小生成树唯一吗"要先分清问的是权值还是形态；
2. 判环依据是并查集的**连通性**，不是"两点间是否已有直接边"；
3. 手算时按权值排序后逐条画，**每条边都要写清 accept / reject 的理由**（大题给分点）；
4. **Prim 与 Kruskal 选出的边集可能不同、次序也不同，但总权值一定相同**——这是两道真题（2017-42 / 2018-42）都点到的结论。

> **真题考情**：**4/18 年（选 2 题 + 大 2 道）**：选 2012-8（MST 性质概念，Prim / Kruskal 平权）、2020-7（按 Kruskal 选边次序）；
> 大 2017-42、2018-42（最经济布线方案：官方答案明说"手动 Prim 或 Kruskal 均可"，同一张图可两算法对照）。
`,

  /* ---------------- 输入表单（每项都必须显式给 default，§3.8-11） ---------------- */
  inputs: [
    { key: 'nodes', label: '顶点列表（逗号分隔，2~10 个）', default: 'A,B,C,D,E,F' },
    {
      key: 'edges', label: '边列表（每行一条：起点-终点:权重）', type: 'textarea', rows: 6, wide: true,
      default: 'A-C:1\nD-F:2\nB-E:3\nC-F:4\nA-D:5\nB-C:5\nA-B:6\nB-D:6\nC-E:6\nE-F:6',
      help: '无向带权边，A-B 与 B-A 视为同一条；权重为非负数',
    },
  ],

  quickActions: [
    {
      label: '📄 2017-42 同图（与 Prim 对照）',
      run(rt) {
        /* 与 ds-prim 的真题预设**同一张图**（2017_真题_p06 的图 G，权值经官方答案反验）：
         * 边 A-B 6、A-D 4、A-E 5、B-C 4、C-D 6、C-E 5、D-E 4。
         * Kruskal 侧按权值升序：A-D 4 → B-C 4 → D-E 4 →（A-E 5 成环放弃）→ C-E 5 收尾，总权值 17；
         * Prim 侧（从 A 起）的次序是 (A,D) → (D,E) → (C,E) → (B,C) —— **边集不同、总权值相同**。 */
        rt.setInput('nodes', 'A,B,C,D,E');
        rt.setInput('edges', 'A-B:6\nA-D:4\nA-E:5\nB-C:4\nC-D:6\nC-E:5\nD-E:4');
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
    return { nodes, edges };
  },

  /* ---------------- ② 纯算法：产出全部快照 ---------------- */
  buildSnapshots(model) {
    const { nodes, edges } = model;
    const n = nodes.length;
    const parent = {};
    nodes.forEach(v => { parent[v] = v; });

    // 带路径压缩的并查集查询
    const find = x => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    /** 当前时刻：每个顶点所属集合的根（渲染时按根着色 → 合并即同色） */
    const rootOf = () => { const m = {}; nodes.forEach(v => { m[v] = find(v); }); return m; };
    /** 某个根对应的集合成员（日志里展示连通分量） */
    const members = root => nodes.filter(v => find(v) === root).join(',');
    /** 由"已加入的边"推出"已纳入树的顶点"（派生量，避免渲染端自己重算） */
    const vertsOf = (ids) => {
      const s = new Set();
      ids.forEach(id => { s.add(edges[id].a); s.add(edges[id].b); });
      return nodes.filter(v => s.has(v));
    };

    const sorted = [...edges].sort((p, q) => p.w - q.w || p.id - q.id);   // 稳定排序
    const snaps = [];
    const st = { mstIds: [], rejectedIds: [], checkedIds: [], sum: 0 };   // 演化中的状态
    const compOf = () => new Set(nodes.map(find)).size;                    // 当前连通分量数
    const copy = () => ({
      mstIds: [...st.mstIds], rejectedIds: [...st.rejectedIds], checkedIds: [...st.checkedIds],
      sum: st.sum, inVerts: vertsOf(st.mstIds), compCount: compOf(),
    });

    // 第 0 帧：初始化
    snaps.push({
      type: 'init', step: 'init', edge: null, ...copy(), rootOf: rootOf(),
      log: `就绪：共 ${n} 个顶点、${edges.length} 条边，已按权值升序排列，依次考察。`,
      logType: 'info',
      desc: '点击「单步执行」从最小权值的边开始考察；绿色 = 已加入，红色闪 = 成环被弃',
    });

    let mstCount = 0, finished = false;

    for (let k = 0; k < sorted.length; k++) {
      const e = sorted[k];
      st.checkedIds.push(e.id);

      // 帧 1：正在考察这条边
      snaps.push({
        type: 'check', step: 'check', edge: e, ...copy(), rootOf: rootOf(),
        log: `考察第 ${k + 1} 条边 (${e.a},${e.b})，权重 ${e.w} —— 用并查集判断两端是否连通…`,
        logType: 'info',
        desc: `正在考察边 (${e.a},${e.b}) 权重 ${e.w}`,
      });

      const ra = find(e.a), rb = find(e.b);
      if (ra === rb) {
        // 帧 2a：成环 → 放弃（下一帧该边显示为灰色虚线）
        st.rejectedIds.push(e.id);
        snaps.push({
          type: 'reject', step: 'reject', edge: e, ...copy(), rootOf: rootOf(),
          log: `边 (${e.a},${e.b}) 权重 ${e.w}：两端已连通（同属集合 {${members(ra)}}），加入会形成环 ✘ 放弃`,
          logType: 'error',
          desc: `(${e.a},${e.b}) 两端已连通，加入会成环 —— 变红闪烁后跳过`,
        });
      } else {
        // 帧 2b：不成环 → 加入并合并集合
        parent[ra] = rb;
        st.mstIds.push(e.id); st.sum += e.w; mstCount++;
        snaps.push({
          type: 'accept', step: 'accept', edge: e, ...copy(), rootOf: rootOf(),
          log: `边 (${e.a},${e.b}) 权重 ${e.w}：不形成环，加入最小生成树 ✓ 连通分量 {${members(find(e.b))}} 合并，累计权重 ${st.sum}`,
          logType: 'success',
          desc: `(${e.a},${e.b}) 加入生成树 —— 两个集合合并，顶点颜色统一`,
        });
        // 提前结束：选满 n-1 条边
        if (mstCount === nodes.length - 1) {
          snaps.push({
            type: 'done', step: 'done', edge: null, ...copy(), rootOf: rootOf(),
            log: `已选满 n−1 = ${nodes.length - 1} 条边，最小生成树构建完成，剩余边无需再考察。🎉 总权重 = ${st.sum}`,
            logType: 'success',
            desc: `完成！最小生成树共 ${mstCount} 条边，总权重 ${st.sum}`,
          });
          finished = true;
          break;
        }
      }
    }

    // 未提前结束（图不连通 → 生成森林）
    if (!finished) {
      snaps.push({
        type: 'done', step: 'done', edge: null, ...copy(), rootOf: rootOf(),
        log: `所有边考察完毕：${complete(mstCount, compOf())}。共选 ${mstCount} 条边，总权重 ${st.sum}`,
        logType: mstCount === nodes.length - 1 ? 'success' : 'warn',
        desc: mstCount === nodes.length - 1
          ? `完成！最小生成树共 ${mstCount} 条边，总权重 ${st.sum}`
          : `图不连通，得到最小生成森林（${compOf()} 个连通分量）`,
      });
    }

    function complete(m) { return m === nodes.length - 1 ? '最小生成树构建完成 🎉' : `顶点未全部连通，得到最小生成森林`; }
    return snaps;
  },

  /* ---------------- ③ 纯渲染：按当前快照绘制 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const { nodes, edges } = model;
    const n = nodes.length;
    const pos = _ksLayout(nodes);                        // 顶点圆形布局（与 ds-prim 同族）
    const inSet = new Set(s.inVerts);                    // 已纳入生成树的顶点（读快照派生量）
    const cur = s.edge;                                  // 当前考察边（init / done 时为 null）
    const has = (arr, id) => arr.includes(id);
    const sorted = [...edges].sort((p, q) => p.w - q.w || p.id - q.id);

    /* ---- 顶点按并查集根着色（合并即同色） ---- */
    const palette = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16', '#f97316', '#0ea5e9'];
    const rootColor = {};
    nodes.forEach(v => { const r = s.rootOf[v]; if (rootColor[r] === undefined) rootColor[r] = palette[Object.keys(rootColor).length % palette.length]; });

    /* ---- 边与权值标签（窗20：标签沿边错开 + 白描边，稠密图不再互相压盖） ---- */
    const edgeSvg = edges.map(e => {
      const g = _ksGeom(pos[e.a], pos[e.b], e.id);
      let cls = 'kedge';
      if (has(s.mstIds, e.id)) cls += ' kedge-mst';
      else if (has(s.rejectedIds, e.id)) cls += ' kedge-rejected';
      if (cur && cur.id === e.id) {
        if (s.type === 'check') cls = 'kedge kedge-checking';
        else if (s.type === 'reject') cls = 'kedge kedge-flash';
        else if (s.type === 'accept') cls = 'kedge kedge-mst kedge-just';
      }
      const ewCls = 'ew' + (has(s.mstIds, e.id) ? ' ew-mst' : (cur && cur.id === e.id && s.type === 'check' ? ' ew-cur' : ''));
      return `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" class="${cls}"/>
              <text x="${g.mx}" y="${g.my}" dy="0.35em" class="${ewCls}" style="font-size:12px;paint-order:stroke;stroke:#fff;stroke-width:3.5;stroke-linejoin:round">${e.w}</text>`;
    }).join('');

    /* ---- 当前考察边两端的顶点光环 ---- */
    const halo = (cur && (s.type === 'check' || s.type === 'reject' || s.type === 'accept'))
      ? [cur.a, cur.b].map(v => {
          const color = s.type === 'check' ? '#f59e0b' : s.type === 'reject' ? '#ef4444' : '#10b981';
          return `<circle cx="${pos[v].x}" cy="${pos[v].y}" r="28" class="knode-halo" style="stroke:${color}"/>`;
        }).join('')
      : '';

    /* ---- 顶点（按并查集根着色 + 下方标出"根"，让"同色 = 同集合"有文字证据） ---- */
    const nodeSvg = nodes.map(v => {
      const p = pos[v];
      const r = s.rootOf[v];
      return `<circle cx="${p.x}" cy="${p.y}" r="21" class="knode-circle" fill="${rootColor[r]}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text">${v}</text>
        <text x="${p.x}" y="${p.y + 36}" text-anchor="middle" style="font:800 11px Consolas" fill="${inSet.has(v) ? '#059669' : '#94a3b8'}">根 ${r}</text>`;
    }).join('');

    /* ---- 考察顺序徽片条（按权值升序，与并查集判环结果一一对应） ---- */
    const chips = sorted.map((e, k) => {
      let cls = '', t = `${k + 1}. ${e.a}-${e.b}:${e.w}`;
      if (has(s.mstIds, e.id)) cls = 'chip-mst';
      else if (has(s.rejectedIds, e.id)) cls = 'chip-rej';
      if (cur && cur.id === e.id && s.type === 'check') cls = 'chip-check';
      if (cur && cur.id === e.id && s.type === 'reject') cls = 'chip-flash';
      if (cur && cur.id === e.id && s.type === 'accept') cls = 'chip-mst chip-cur';
      return RC408.ui.chip(t, cls);
    }).join('');

    /* ---- 统计卡片（与 ds-prim 同一形状：进度 / 边数 / 权重 / 状态） ---- */
    const stateText = { init: '待开始', check: '考察中…', accept: '✓ 已加入', reject: '✘ 成环放弃', done: '🏁 已结束' }[s.type] || s.type;
    const stats =
      RC408.ui.statCard('已纳入顶点', `${s.inVerts.length} / ${n}`, `连通分量 ${s.compCount} 个`, 'text-emerald-600') +
      RC408.ui.statCard('已加入边', `${s.mstIds.length} / ${n - 1}`, `已考察 ${s.checkedIds.length} / ${edges.length} 条`, 'text-emerald-600') +
      RC408.ui.statCard('累计权重', s.sum, '生成树边权和', 'text-indigo-600') +
      RC408.ui.statCard('当前状态', stateText, s.type === 'reject' ? '该边已放弃' : '', s.type === 'reject' ? 'text-rose-500' : 'text-slate-700');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 680 460" class="w-full h-auto mx-auto" style="max-width:720px">
            ${edgeSvg}${halo}${nodeSvg}
          </svg>
        </div>

        <div>
          ${RC408.ui.sectionTitle('考察顺序（按权值升序 · 与并查集判环结果对应）')}
          <div class="flex flex-wrap gap-1.5">${chips}</div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#10b981', '已加入生成树（两端顶点同色 = 同一集合）')}
          ${RC408.ui.legend('#ef4444', '成环 → 闪烁后放弃')}
          ${RC408.ui.legend('#f59e0b', '正在考察（虚线数据流动）')}
          ${RC408.ui.legend('#cbd5e1', '未考察 / 已跳过')}
        </div>
      </div>`;
  },
});

/* ---- Kruskal 专用：圆形布局与边几何（与 ds-prim 同签名，前缀 _ks 避免与其他模块重名） ---- */
function _ksLayout(nodes) {
  const n = nodes.length, W = 680, H = 460, cx = W / 2, cy = H / 2 + 4;
  const R = n <= 3 ? 120 : Math.min(176, 58 + n * 14);
  return nodes.map((name, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { name, x: +(cx + R * Math.cos(ang)).toFixed(1), y: +(cy + R * Math.sin(ang)).toFixed(1) };
  }).reduce((o, p) => { o[p.name] = p; return o; }, {});
}
/** 边两端收缩到顶点圆外侧（r = 顶点半径 + 4）；权值标签**沿边错开**（窗20 实测的稠密图压盖修复）：
 *  按边 id 决定沿边参数 t（0.37 / 0.50 / 0.63）与垂直偏移（±8px）——同一张图每次结果固定（可断言），
 *  且与顶点圆保持 ≥ 21px。ds-prim 用的是同一套公式，两个模块的同一张图看起来一致。 */
function _ksGeom(a, b, id, r = 25) {
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
