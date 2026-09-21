'use strict';
/* ============================================================================
 * ds-topo.js —— 【数据结构】拓扑排序与关键路径（AOE 网）（前缀 _tp）
 * 考情：18 年中 13 年考（选 11 题 + 大 3 道：2011-41 关键路径、2024-41 拓扑唯一性、
 * 2025-42 AOE 网络分析；2013-9/2019-5/2022-7 等选择题考 AOE 时间参数）。拓扑排序用 Kahn 入度消减；
 * 关键路径 = ve 与 vl 相等的活动（余量为 0），关键活动的工期决定工程最短时间。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-topo',
  mode: 'stepper',
  title: '拓扑排序与关键路径（AOE 网）',

  theory: `
> **为什么要有它**：有先修关系的活动（课程、工序）必须排出一个合法先后次序——**拓扑排序**给出这个次序；再给活动加上工期，**关键路径**回答"工程最短要多久、哪些活动不能拖"。
> **怎么实现**：拓扑用 **Kahn 入度消减**（反复输出入度为 0 的顶点并删其出边）；关键路径用两遍递推——按拓扑序正推 \\(ve\\)、按逆拓扑序反推 \\(vl\\)。
> **记住什么**：拓扑序列**不唯一**、有回路则无拓扑序列 + \\(ve/vl\\) 两条公式 + **关键活动 = 余量为 0 的活动**。

## 拓扑排序（Kahn 算法）
反复做两件事：① 选一个**入度为 0** 的顶点输出；② 删除它及其所有出边（后继入度 −1）。
- 每步"可选顶点"可能不唯一 → **拓扑序列不唯一**；若中途找不到入度为 0 的顶点 → 图**有回路**（不是 DAG）；
- 时间 \\(O(n+e)\\)（邻接表）。DFS 的**退栈序列逆序**也是拓扑序列。

## 关键路径（AOE 网）
边 = 活动（工期 w），顶点 = 事件；**工程最短工期 = 汇点的 \\(ve\\)**。
- \\(ve(j)\\)（事件最早发生时刻）= \\(\\max\\{ve(i)+w_{ij}\\}\\)，按**拓扑序正向**推；源点 \\(ve=0\\)；
- \\(vl(i)\\)（事件最迟发生时刻）= \\(\\min\\{vl(j)-w_{ij}\\}\\)，按**逆拓扑序反向**推；汇点 \\(vl=ve\\)；
- 活动 \\(i\\to j\\)：最早开始 \\(e=ve(i)\\)、最迟开始 \\(l=vl(j)-w\\)；**\\(l-e=0\\) 的活动是关键活动**，它们构成**关键路径**；
- **缩短非关键活动的工期不能缩短总工期**；只有关键活动同时缩短才可能有效（**关键路径可能不止一条**）。

## 考点提醒（易错点）
1. 拓扑序列**不唯一**，但"某序列是否是拓扑序列"必须逐条边检查，别只看首个顶点；
2. 判断"拓扑序列唯一"的条件：**每一步入度为 0 的顶点都只有一个**；
3. 关键路径的长度 = 汇点的 \\(ve\\)；求法务必**先拓扑正推、再逆序反推**，顺序反了全错；
4. 缩短工期类题目要**先找出全部关键路径**，再看选项中的活动是否覆盖了每一条路径。

> **真题考情**：**13/18 年（选 11 题 + 大 3 道）**：选 2010-8、2012-6、2013-9（AOE 时间参数）、
> 2014-7、2016-7、2018-7、2019-5、2020-8、2021-7、2022-7、2025-6；大 2011-41、2024-41、2025-42。
`,

  inputs: [
    { key: 'edges', label: '活动边（u-v:工期，构成 AOE 网，v1 为源点）', type: 'textarea', rows: 4, wide: true,
      default: 'v1-v2:3\nv1-v3:2\nv2-v4:2\nv3-v4:3\nv3-v5:4\nv4-v6:2\nv5-v6:3' },
  ],

  quickActions: [
    { label: '含回路(非DAG)示例', run(rt) { rt.setInput('edges', 'v1-v2:1\nv2-v3:2\nv3-v1:2'); rt.load(); } },
  ],

  parse(vals) {
    const edges = [];
    const nodes = new Set();
    vals.edges.split('\n').map(l => l.trim()).filter(Boolean).forEach((line, i) => {
      const m = line.match(/^(.+?)-(.+?):(.+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${line}」格式错误，应为 v1-v2:3` };
      const w = Number(m[3]);
      if (!Number.isFinite(w) || w <= 0) throw { message: `工期「${m[3]}」须为正数` };
      edges.push({ a: m[1].trim(), b: m[2].trim(), w });
      nodes.add(m[1].trim()); nodes.add(m[2].trim());
    });
    const nl = [...nodes].sort();
    if (nl.length < 3 || nl.length > 8) throw { message: '顶点数须在 3 ~ 8' };
    const inDeg = {}; nl.forEach(n => inDeg[n] = 0);
    edges.forEach(e => inDeg[e.b]++);
    return { edges, nodes: nl, inDeg };
  },

  buildSnapshots(model) {
    const { edges, nodes, inDeg: inDeg0 } = model;
    let inDeg = { ...inDeg0 };
    const snaps = [];
    const outSeq = [], removed = [];
    const push = (step, o) => snaps.push({ step, edges: [...edges], nodes: [...nodes], outSeq: [...outSeq],
      removed: [...removed], inDeg: { ...inDeg }, ve: {}, vl: {}, keyActs: [], log: '', logType: 'info', desc: '', ...o });

    push('init', { log: `就绪：${nodes.length} 个顶点、${edges.length} 个活动。入度：${nodes.map(n => n + '=' + inDeg[n]).join('，')}。`, desc: 'Kahn：每步输出一个入度为 0 的顶点' });

    while (outSeq.length < nodes.length) {
      const avail = nodes.filter(n => !outSeq.includes(n) && inDeg[n] === 0);
      if (!avail.length) {
        push('cycle', { log: `无可输出顶点（所有剩余顶点入度 > 0）→ 图中存在**回路**，不是 DAG，拓扑排序失败，AOE 分析无法进行。`, logType: 'error',
          desc: '存在回路，拓扑排序失败' });
        return snaps;
      }
      avail.sort().forEach(u => {
        outSeq.push(u);
        edges.filter(e => e.a === u).forEach(e => inDeg[e.b]--);
        push('pick', { log: `输出 ${u}（入度 = 0），删除其出边 → ${edges.filter(e => e.a === u).map(e => e.b + ' 入度变 ' + inDeg[e.b]).join('，') || '无后继'}`,
          desc: `输出 ${u}（第 ${outSeq.length} 个）` });
      });
    }
    push('topo-done', { log: `拓扑序列：${outSeq.join(' → ')}（不唯一——每步所有入度 0 顶点均可选）。`, logType: 'success',
      desc: `拓扑排序完成：${outSeq.join(' → ')}` });

    /* AOE：ve / vl / 关键活动 */
    const wOf = (a, b) => { const e = edges.find(x => x.a === a && x.b === b); return e ? e.w : null; };
    const ve = {}, vl = {};
    outSeq.forEach(u => { if (ve[u] === undefined) ve[u] = 0; edges.filter(e => e.a === u).forEach(e => { ve[e.b] = Math.max(ve[e.b] ?? 0, ve[u] + e.w); }); });
    const sink = outSeq[outSeq.length - 1];
    vl[sink] = ve[sink];
    [...outSeq].reverse().forEach(u => { edges.filter(e => e.a === u).forEach(e => { vl[u] = Math.min(vl[u] ?? Infinity, vl[e.b] - e.w); }); if (vl[u] === undefined) vl[u] = ve[u]; });
    const keyActs = edges.filter(e => ve[e.a] === vl[e.b] - e.w && ve[e.a] + e.w === vl[e.b]).map(e => e.a + '→' + e.b);
    const total = ve[sink];
    const actRows = edges.map(e => {
      const e0 = ve[e.a], l0 = vl[e.b] - e.w, slack = l0 - e0;
      return { a: e.a, b: e.b, w: e.w, e: e0, l: l0, slack, key: slack === 0 };
    });
    push('done', { ve, vl, actRows, keyActs,
      log: `工程最短工期 = ${total}。关键活动（余量 = 0）：${keyActs.join('、') || '—'}，构成关键路径。缩短非关键活动的工期不能缩短总工期。`,
      logType: 'success', desc: `关键路径长度 = ${total}；关键活动已标红` });
    return snaps;
  },

  render(ctx) {
    const { snap: s, stage } = ctx;
    /* 分层布局：按 DAG 最长路径静态分层（不随排序进度变化），同层顶点垂直居中分布 */
    const layerOf = {};
    s.nodes.forEach(n => { layerOf[n] = 0; });
    let changed = true, guard = 0;
    while (changed && guard++ < 60) {
      changed = false;
      s.edges.forEach(e => {
        if (layerOf[e.b] < layerOf[e.a] + 1) { layerOf[e.b] = layerOf[e.a] + 1; changed = true; }
      });
    }
    const maxL = Math.max(...Object.values(layerOf), 1);
    const byLayer = {};
    s.nodes.forEach(n => { (byLayer[layerOf[n]] = byLayer[layerOf[n]] || []).push(n); });
    const maxWide = Math.max(...Object.values(byLayer).map(a => a.length), 1);
    const W = Math.max(maxL * 170 + 160, 520), H = Math.max(maxWide * 84 + 80, 240);
    const P = {};
    Object.entries(byLayer).forEach(([l, ns]) => {
      ns.sort();
      ns.forEach((n, i) => {
        P[n] = {
          x: 90 + (+l) * ((W - 200) / Math.max(maxL, 1)),
          y: H / 2 + (i - (ns.length - 1) / 2) * 84,
        };
      });
    });

    const isKeyEdge = e => (s.actRows || []).some(a => a.key && a.a === e.a && a.b === e.b);
    const edgeSvg = s.edges.map(e => {
      const p = P[e.a], q = P[e.b]; if (!p || !q) return '';
      const key = (s.actRows || []).length && isKeyEdge(e);
      return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${key ? '#e11d48' : '#cbd5e1'}" stroke-width="${key ? 3.5 : 2.5}"/>
        <text x="${(p.x + q.x) / 2}" y="${(p.y + q.y) / 2 - 6}" text-anchor="middle" style="font:800 11px Consolas" fill="${key ? '#e11d48' : '#64748b'}">${e.w}</text>`;
    }).join('');
    const nodeSvg = s.nodes.map(n => {
      const p = P[n];
      const picked = s.outSeq.includes(n);
      const isLast = s.outSeq[s.outSeq.length - 1] === n && s.step === 'pick';
      return `<circle cx="${p.x}" cy="${p.y}" r="20" class="knode-circle" fill="${picked ? '#10b981' : '#e2e8f0'}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="fill:${picked ? '#fff' : '#475569'};font-size:12px">${n}</text>
        <text x="${p.x}" y="${p.y + 32}" text-anchor="middle" style="font:600 10px Consolas" fill="#94a3b8">入度 ${s.inDeg[n]}</text>`;
    }).join('');

    const seqHtml = s.outSeq.length ? s.outSeq.map((n, i) => RC408.ui.chip(n, 'chip-hit', `第 ${i + 1} 个输出`)).join('<span class="text-slate-300 self-center">→</span>') : '<span class="text-xs text-slate-400">（尚未输出）</span>';

    let actHtml = '';
    if (s.actRows) {
      const rows = s.actRows.map(a => `<tr class="${a.key ? 'row-hit' : ''}">
        <td class="font-mono">${a.a}→${a.b}</td><td class="font-mono">${a.w}</td><td class="font-mono">${a.e}</td>
        <td class="font-mono">${a.l}</td><td class="font-mono">${a.l - a.e}</td>
        <td>${a.key ? '<b style="color:#e11d48">关键活动</b>' : '<span class="text-slate-400">非关键</span>'}</td></tr>`).join('');
      actHtml = `<div>${RC408.ui.sectionTitle('活动时间参数（e = 最早开始，l = 最迟开始，余量 = l − e；余量 0 = 关键活动，图中标红）')}
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="tbl w-full"><thead><tr><th>活动</th><th>工期</th><th>e</th><th>l</th><th>余量</th><th>判定</th></tr></thead><tbody>${rows}</tbody></table>
        </div></div>`;
    }

    const stats =
      RC408.ui.statCard('拓扑输出', `${s.outSeq.length} / ${s.nodes.length}`, s.nodes.length + ' 顶点') +
      RC408.ui.statCard('活动数', s.edges.length, 'AOE 网的边', 'text-indigo-600') +
      RC408.ui.statCard('工程最短工期', s.ve && Object.keys(s.ve).length ? Math.max(...Object.values(s.ve)) : '—', '关键路径长度', 'text-rose-600') +
      RC408.ui.statCard('关键活动', (s.keyActs || []).length || '—', '余量 = 0 的活动', 'text-amber-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          ${RC408.ui.sectionTitle('AOE 网（绿 = 已输出顶点；红边 = 关键活动；结点下数字 = 当前入度）')}
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">${edgeSvg}${nodeSvg}</svg>
        </div>
        <div>${RC408.ui.sectionTitle('拓扑序列（Kahn 入度消减）')}<div class="flex flex-wrap gap-1.5 items-center">${seqHtml}</div></div>
        ${actHtml}
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900">
          💡 <b>考点提醒：</b>关键路径可能不唯一（多条同时最短）；缩短工期只能压缩关键活动，且当关键路径缩短后可能"转移"。
        </div>
      </div>`;
  },
});
