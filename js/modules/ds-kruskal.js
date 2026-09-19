'use strict';
/* ============================================================================
 * kruskal.js —— 【数据结构】Kruskal 最小生成树
 * ----------------------------------------------------------------------------
 * 快照设计（buildSnapshots 一次性产出，render 只按快照画图）：
 *   { type:'init'|'check'|'accept'|'reject'|'done',
 *     edge       当前考察的边对象 {id,a,b,w}
 *     mstIds     已加入生成树的边 id 列表
 *     rejectedIds 已判"成环"被放弃的边 id 列表
 *     checkedIds 已考察过的边 id 列表
 *     rootOf     {节点名: 并查集根} —— 节点按根着色，合并即"同色"
 *     sum        当前累计权重 }
 *   同一条边产生 check → accept/reject 两帧：先"橙色流动考察"，再给出结论，
 *   形成"变红闪烁跳过 / 变绿加粗合并"的即时反馈。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-kruskal',
  mode: 'stepper',
  title: 'Kruskal 最小生成树',

  theory: `
> **真题考情**：18 年中 5 年直接考最小生成树（2012 判性质、2015 比较两算法、2017/2018 大题、2020 考 Kruskal 加边顺序），图的应用大题常与最短路径、拓扑排序、关键路径轮换出现——克鲁斯卡尔与普里姆的对比是选择题最爱。

## 一句话理解
**贪心 + 并查集**：把所有边按权值从小到大排队，逐条审视——只要这条边两端的顶点**尚未连通**，就收入生成树；若两端已连通，加入它必然成环，果断丢弃。

## 算法步骤
1. 将图中所有边按权值**从小到大排序**；
2. 依次取出当前最小边 (u, v)；
3. 用**并查集**（Union-Find）查询 u、v 的根：
   - **根不同** → 不构成环，加入最小生成树，并**合并**两个集合；
   - **根相同** → 已连通，加入必成环，**放弃**该边；
4. 已选边数达到 **n−1** 条时提前结束（n 为顶点数），否则继续考察下一条边。

## 伪代码
\`\`\`text
按权值升序排序所有边
for each 边 (u, v) 按序取出:
    if find(u) != find(v):      # 两端不在同一集合
        加入生成树; union(u, v)
    else: 丢弃 (成环)
    if 已选边数 == n-1: break
\`\`\`

## 复杂度
| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 时间 | O(E·logE) | 排序主导；并查集(路径压缩)近似 O(α) |
| 空间 | O(V+E) | 边集数组 + 并查集数组 |

## 与 Prim 算法对比
- **Kruskal**：按"边"贪心，逐边排序，适合**稀疏图**（边少）；
- **Prim**：按"顶点"扩张，逐点找最近邻，适合**稠密图**。

## 考点提示
- 权值相同的边考察顺序可任选，最小生成树的**总权值唯一**（树的形态可能不唯一）；
- 判环的依据是"两端是否已连通"，**不是**"两点间是否已有直接边"；
- 若图不连通，结果是最小生成**森林**（选不满 n−1 条边）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'nodes', label: '节点列表（逗号分隔，2~10 个）', default: 'A,B,C,D,E,F' },
    {
      key: 'edges', label: '边列表（每行一条：起点-终点:权重）', type: 'textarea', rows: 6, wide: true,
      default: 'A-C:1\nD-F:2\nB-E:3\nC-F:4\nA-D:5\nB-C:5\nA-B:6\nB-D:6\nC-E:6\nE-F:6',
      help: '无向带权边，A-B 与 B-A 视为同一条；权重为非负数',
    },
  ],

  quickActions: [
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
    if (nodes.length < 2) throw { message: '至少需要 2 个节点' };
    if (nodes.length > 10) throw { message: '为便于展示，节点数请控制在 10 个以内' };
    if (new Set(nodes).size !== nodes.length) throw { message: '节点名重复' };

    const nodeSet = new Set(nodes);
    const edges = []; const seen = new Set();
    vals.edges.split(/\n+/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
      const m = line.match(/^(.+?)-(.+?):(.+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${line}」格式错误，应为 A-B:3` };
      const a = m[1].trim(), b = m[2].trim(), w = Number(m[3]);
      if (!nodeSet.has(a) || !nodeSet.has(b)) {
        throw { message: `第 ${i + 1} 行引用了未定义的节点「${!nodeSet.has(a) ? a : b}」` };
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
    const parent = {};
    nodes.forEach(n => { parent[n] = n; });

    // 带路径压缩的并查集查询
    const find = x => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    /** 当前时刻：每个节点所属集合的根（渲染时按根着色 → 合并即同色） */
    const rootOf = () => { const m = {}; nodes.forEach(n => { m[n] = find(n); }); return m; };
    /** 某个根对应的集合成员（日志里展示连通分量） */
    const members = root => nodes.filter(n => find(n) === root).join(',');

    const sorted = [...edges].sort((p, q) => p.w - q.w || p.id - q.id);   // 稳定排序
    const snaps = [];
    const st = { mstIds: [], rejectedIds: [], checkedIds: [], sum: 0 };   // 演化中的状态
    const copy = () => ({ mstIds: [...st.mstIds], rejectedIds: [...st.rejectedIds], checkedIds: [...st.checkedIds], sum: st.sum });

    // 第 0 帧：初始化
    snaps.push({
      type: 'init', ...copy(), rootOf: rootOf(),
      log: `就绪：共 ${nodes.length} 个顶点、${edges.length} 条边，已按权值升序排列，依次考察。`,
      logType: 'info',
      desc: '点击「单步执行」从最小权值的边开始考察；绿色 = 已加入，红色闪 = 成环被弃',
    });

    let mstCount = 0, finished = false;

    for (let k = 0; k < sorted.length; k++) {
      const e = sorted[k];
      st.checkedIds.push(e.id);

      // 帧 1：正在考察这条边
      snaps.push({
        type: 'check', edge: e, ...copy(), rootOf: rootOf(),
        log: `考察第 ${k + 1} 条边 (${e.a},${e.b})，权重 ${e.w} —— 用并查集判断两端是否连通…`,
        logType: 'info',
        desc: `正在考察边 (${e.a},${e.b}) 权重 ${e.w}`,
      });

      const ra = find(e.a), rb = find(e.b);
      if (ra === rb) {
        // 帧 2a：成环 → 放弃（下一帧该边显示为灰色虚线）
        st.rejectedIds.push(e.id);
        snaps.push({
          type: 'reject', edge: e, ...copy(), rootOf: rootOf(),
          log: `边 (${e.a},${e.b}) 权重 ${e.w}：两端已连通（同属集合 {${members(ra)}}），加入会形成环 ✘ 放弃`,
          logType: 'error',
          desc: `(${e.a},${e.b}) 两端已连通，加入会成环 —— 变红闪烁后跳过`,
        });
      } else {
        // 帧 2b：不成环 → 加入并合并集合
        parent[ra] = rb;
        st.mstIds.push(e.id); st.sum += e.w; mstCount++;
        snaps.push({
          type: 'accept', edge: e, ...copy(), rootOf: rootOf(),
          log: `边 (${e.a},${e.b}) 权重 ${e.w}：不形成环，加入最小生成树 ✓ 连通分量 {${members(find(e.b))}} 合并，累计权重 ${st.sum}`,
          logType: 'success',
          desc: `(${e.a},${e.b}) 加入生成树 —— 两个集合合并，节点颜色统一`,
        });
        // 提前结束：选满 n-1 条边
        if (mstCount === nodes.length - 1) {
          snaps.push({
            type: 'done', edge: null, ...copy(), rootOf: rootOf(),
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
      const comps = new Set(nodes.map(find)).size;
      snaps.push({
        type: 'done', edge: null, ...copy(), rootOf: rootOf(),
        log: `所有边考察完毕：${complete(mstCount, comps)}。共选 ${mstCount} 条边，总权重 ${st.sum}`,
        logType: mstCount === nodes.length - 1 ? 'success' : 'warn',
        desc: mstCount === nodes.length - 1
          ? `完成！最小生成树共 ${mstCount} 条边，总权重 ${st.sum}`
          : `图不连通，得到最小生成森林（${comps} 个连通分量）`,
      });
    }

    function complete(m, c) { return m === nodes.length - 1 ? '最小生成树构建完成 🎉' : `顶点未全部连通，得到最小生成森林`; }
    return snaps;
  },

  /* ---------------- ③ 纯渲染：按当前快照绘制 ---------------- */
  render(ctx) {
    const { snap, model, stage } = ctx;
    const { nodes, edges } = model;
    const pos = _ksLayout(nodes);                       // 节点圆形布局
    const idxOf = {}; nodes.forEach((n, i) => { idxOf[n] = i; });
    const cur = snap.edge;                            // 当前考察边（init/done 时为 null）
    const has = (arr, id) => arr.includes(id);

    /* ---- 边与权值标签 ---- */
    const palette = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16', '#f97316', '#0ea5e9'];
    const rootColor = {};
    nodes.forEach(n => { const r = snap.rootOf[n]; if (rootColor[r] === undefined) rootColor[r] = palette[Object.keys(rootColor).length % palette.length]; });

    const edgeSvg = edges.map(e => {
      const g = _ksGeom(pos[idxOf[e.a]], pos[idxOf[e.b]]);
      let cls = 'kedge';
      if (has(snap.mstIds, e.id)) cls += ' kedge-mst';
      else if (has(snap.rejectedIds, e.id)) cls += ' kedge-rejected';
      if (cur && cur.id === e.id) {
        if (snap.type === 'check') cls = 'kedge kedge-checking';
        else if (snap.type === 'reject') cls = 'kedge kedge-flash';
        else if (snap.type === 'accept') cls = 'kedge kedge-mst kedge-just';
      }
      const midx = (g.x1 + g.x2) / 2, midy = (g.y1 + g.y2) / 2;
      const ewCls = 'ew' + (has(snap.mstIds, e.id) ? ' ew-mst' : (cur && cur.id === e.id && snap.type === 'check' ? ' ew-cur' : ''));
      return `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" class="${cls}"/>
              <text x="${midx}" y="${midy}" dy="0.35em" class="${ewCls}">${e.w}</text>`;
    }).join('');

    /* ---- 当前考察边两端的节点光环 ---- */
    const halo = (cur && (snap.type === 'check' || snap.type === 'reject' || snap.type === 'accept'))
      ? [cur.a, cur.b].map(n => {
          const color = snap.type === 'check' ? '#f59e0b' : snap.type === 'reject' ? '#ef4444' : '#10b981';
          return `<circle cx="${pos[idxOf[n]].x}" cy="${pos[idxOf[n]].y}" r="27" class="knode-halo" style="stroke:${color}"/>`;
        }).join('')
      : '';

    /* ---- 节点（按并查集根着色） ---- */
    const nodeSvg = nodes.map(n => {
      const p = pos[idxOf[n]];
      return `<g>
        <circle cx="${p.x}" cy="${p.y}" r="20" class="knode-circle" fill="${rootColor[snap.rootOf[n]]}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text">${n}</text>
      </g>`;
    }).join('');

    /* ---- 考察顺序徽片条 ---- */
    const chips = [...edges].sort((p, q) => p.w - q.w || p.id - q.id).map((e, k) => {
      let cls = '', t = `${k + 1}. ${e.a}-${e.b}:${e.w}`;
      if (has(snap.mstIds, e.id)) cls = 'chip-mst';
      else if (has(snap.rejectedIds, e.id)) cls = 'chip-rej';
      if (cur && cur.id === e.id && snap.type === 'check') cls = 'chip-check';
      if (cur && cur.id === e.id && snap.type === 'reject') cls = 'chip-flash';
      if (cur && cur.id === e.id && snap.type === 'accept') cls = 'chip-mst chip-cur';
      return RC408.ui.chip(t, cls);
    }).join('');

    /* ---- 统计卡片 ---- */
    const n = nodes.length;
    const stateText = { init: '待开始', check: '考察中…', accept: '✓ 已加入', reject: '✘ 成环放弃', done: '🏁 已结束' }[snap.type];
    const stats =
      RC408.ui.statCard('已考察边', `${snap.checkedIds.length} / ${edges.length}`, '按权值升序') +
      RC408.ui.statCard('已加入生成树', `${snap.mstIds.length} / ${n - 1}`, n - 1 + ' 条为目标', 'text-emerald-600') +
      RC408.ui.statCard('累计权重', snap.sum, '生成树边权和', 'text-indigo-600') +
      RC408.ui.statCard('当前状态', stateText, snap.type === 'reject' ? '该边已放弃' : '', snap.type === 'reject' ? 'text-rose-500' : 'text-slate-700');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 680 440" class="w-full h-auto mx-auto" style="max-width:720px">
            ${edgeSvg}${halo}${nodeSvg}
          </svg>
        </div>

        <div>
          ${RC408.ui.sectionTitle('考察顺序（按权值升序 · 与并查集判环结果对应）')}
          <div class="flex flex-wrap gap-1.5">${chips}</div>
        </div>

        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#10b981', '已加入生成树（两端节点同色 = 同一集合）')}
          ${RC408.ui.legend('#ef4444', '成环 → 闪烁后放弃')}
          ${RC408.ui.legend('#f59e0b', '正在考察（虚线数据流动）')}
          ${RC408.ui.legend('#cbd5e1', '未考察 / 已跳过')}
        </div>
      </div>`;
  },
});

/* ---- Kruskal 专用：圆形布局与边几何 ---- */
function _ksLayout(nodes) {
  const n = nodes.length, W = 680, H = 440, cx = W / 2, cy = H / 2 + 6;
  const R = n <= 3 ? 120 : Math.min(172, 60 + n * 13);
  return nodes.map((name, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { name, x: +(cx + R * Math.cos(ang)).toFixed(1), y: +(cy + R * Math.sin(ang)).toFixed(1) };
  });
}
/** 边两端收缩到节点圆外侧，避免线条压住节点 */
function _ksGeom(a, b, r = 25) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  return { x1: +(a.x + ux * r).toFixed(1), y1: +(a.y + uy * r).toFixed(1), x2: +(b.x - ux * r).toFixed(1), y2: +(b.y - uy * r).toFixed(1) };
}
