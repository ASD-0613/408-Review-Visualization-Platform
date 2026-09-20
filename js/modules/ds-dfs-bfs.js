'use strict';
/* ============================================================================
 * ds-dfs-bfs.js —— 【数据结构】图的遍历（深度优先 DFS / 广度优先 BFS）  前缀 _fb
 * ----------------------------------------------------------------------------
 * 考情（据 408真题及解析/ 逐题核对）：
 *   2012-5 邻接表存储时 BFS 的时间复杂度；2013-8 DFS/BFS 遍历序列判定；
 *   2015-5 有向图 DFS 序列种数；2016-6 DFS 序列合法性；2020-6 DFS 出栈与逆拓扑序；
 *   2023-6 各边权均为 1 时求单源最短路径（答案只有 BFS，属最短路径侧重的双登记题）。
 * 快照：① 起点入栈/入队 ② 每访问一个顶点一帧（DFS 沿边深入 / BFS 出队后批量入队）
 *       ③ 每个顶点退栈一帧（回溯）④ 一个分量遍历完一帧 ⑤ 完成帧。
 *       快照全量携带：visited / tree / container / dist / adj / edges / nodes 副本。
 * 渲染：SVG 圆形布局（布局只由顶点集决定，不随进度变化）+ 邻接表 + 工作栈/队列 + 序列。
 * ========================================================================== */

/** 顶点名自然序比较（V1 < V2 < V10，单个字母即字典序） */
function _fbCmp(a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); }

/** 边的规范化键（无向图忽略方向，保证 a-b 与 b-a 同键） */
function _fbEkey(e, directed) { return directed ? (e.a + '>' + e.b) : [e.a, e.b].sort().join('~'); }

/** 从边列表文本中尽力提取顶点并刷新"起点"下拉框（解析失败静默忽略，不报错） */
function _fbSyncStart(els) {
  if (!els || !els.edges || !els.start) return;
  const verts = [];
  String(els.edges.value || '').split('\n').forEach(line => {
    const m = line.trim().match(/^([A-Za-z0-9]+)\s*(?:->|→|-|—)\s*([A-Za-z0-9]+)$/);
    if (!m) return;
    [m[1], m[2]].forEach(v => {
      const u = v.toUpperCase();
      if (!verts.includes(u)) verts.push(u);
    });
  });
  if (!verts.length) return;
  verts.sort(_fbCmp);
  const keep = verts.includes(els.start.value) ? els.start.value : verts[0];
  els.start.innerHTML = verts.map(v => `<option value="${v}">${v}</option>`).join('');
  els.start.value = keep;
}

/** 随机连通图（先连一棵生成树保证连通，再撒几条额外边） */
function _fbRandomGraph() {
  const pool = 'ABCDEFGH'.split('');
  const n = 5 + Math.floor(Math.random() * 3);           // 5 ~ 7 个顶点
  const vs = pool.slice(0, n);
  const lines = [];
  const has = new Set();
  const add = (a, b) => {
    if (!a || !b || a === b) return;
    const k = [a, b].sort().join('~');
    if (has.has(k)) return;
    has.add(k); lines.push(a + '-' + b);
  };
  for (let i = 1; i < n; i++) add(vs[i], vs[Math.floor(Math.random() * i)]);
  const extra = 1 + Math.floor(Math.random() * 3);
  for (let t = 0; t < extra; t++) add(vs[Math.floor(Math.random() * n)], vs[Math.floor(Math.random() * n)]);
  return { edges: lines.join('\n'), start: vs[0] };
}

RC408.registerModule({
  id: 'ds-dfs-bfs',
  mode: 'stepper',
  title: '图的遍历 DFS / BFS（访问序列 · 栈 / 队列）',

  theory: `
> **真题考情**：2012-5（邻接表存储时 BFS 的时间复杂度）、2013-8（给的序列是 DFS 还是 BFS）、
> 2015-5（有向图深度优先遍历的序列种数）、2016-6（DFS 序列是否合法）、
> 2020-6（DFS 出栈序列是逆拓扑有序序列）、2023-6（各边权均为 1 时求单源最短路径——只有 BFS 可以，
> 解析原文"广度优先遍历按层级顺序逐步扩展"）。

## 一、两种遍历的统一框架
\`\`\`text
visited[n] 标记数组 + 一个辅助容器
DFS（深度优先）：容器 = 栈 —— 访问 v 后沿"第一个未访问邻点"深入；
                  v 的所有邻点都访问过 → 退栈回溯（递归调用即系统栈）
BFS（广度优先）：容器 = 队列 —— 访问 v 后把 v 的所有未访问邻点依次访问并入队；
                  再取队首重复，逐层向外扩散
外层：仍有未访问顶点时，从其中（编号/名字最小的）一个重新开始
      → 非连通图（有向图不可达）得到生成森林
\`\`\`

## 二、复杂度（2012-5 的考点）
| 存储结构 | 时间 | 说明 |
| --- | --- | --- |
| 邻接表 | \\(O(n+e)\\) | 每个顶点入栈/入队一次，每条边（无向图两个方向）各被检查一次 |
| 邻接矩阵 | \\(O(n^2)\\) | 每个顶点都要扫描一整行才能找出全部邻点 |

空间都是 \\(O(n)\\)（visited 数组 + 容器）。

## 三、序列唯一性（2013-8、2016-6 的判定依据）
- **同一个图，DFS/BFS 序列不唯一**——取决于邻接表中邻接点的排列次序，也取决于起点；
- 采用**邻接矩阵**存储时按行下标从小到大扫描，序列**唯一**（本模块的邻接表按顶点名升序，等价于升序扫描）；
- 考试判定"给定序列是否为合法遍历序列"：逐个顶点模拟，看是否满足"沿边前进 / 层序扩散"。

## 四、生成树 / 生成森林与连通性
- 遍历中真正走过的 \\(n-1\\) 条边构成**生成树**；非连通图每轮得到一棵，合起来是**生成森林**；
- **搜索轮数 = 连通分量数**（无向图）；有向图则是各起点可达集的个数；
- BFS 生成树是**以起点为根的层序树**，树高最小；DFS 生成树一般较高（2015 年考过"序列种数"）。

## 五、BFS 与无权图最短路径
BFS 的层号（距起点的边数）就是**无权图上从起点到该顶点的最短路径长度**，
这是"DFS 能做而 BFS 更擅长"的标志性区别：求单个源点的最短路径（无权）只能用 BFS。
DAG 上做 DFS，**退栈序列恰好是逆拓扑有序序列**（2020-6）。

## 考点提示
1. 一定要问清"从哪个顶点出发"——2015-5 就考"从 v0 出发的 DFS 序列有几种"；
2. DFS 用栈、BFS 用队列，别记反；栈里放的是**当前搜索路径**，队列里放的是**待扩展的层**；
3. 非连通图别漏掉后面的连通分量（生成森林的边数 = \\(n\\) − 分量数）。
`,

  inputs: [
    { key: 'edges', label: '边列表（每行一条：A-B 无向；A->B 有向）', type: 'textarea', rows: 6, wide: true,
      default: 'A-B\nA-C\nA-D\nB-E\nC-E\nD-F\nE-F',
      help: '顶点名用字母或字母+数字（如 V1），顶点数 2~8；重名顶点自动合并，重复边自动去重' },
    { key: 'kind', label: '图类型', type: 'select', default: 'undirected',
      options: [{ v: 'undirected', t: '无向图' }, { v: 'directed', t: '有向图（沿出边搜索）' }] },
    { key: 'algo', label: '遍历方式', type: 'select', default: 'dfs',
      options: [{ v: 'dfs', t: '深度优先 DFS（栈）' }, { v: 'bfs', t: '广度优先 BFS（队列）' }] },
    { key: 'start', label: '起点', type: 'select', default: 'A',
      options: 'ABCDEFGH'.split('').map(c => ({ v: c, t: c })),
      help: '下拉项随边列表自动更新；不在图中的起点会给出提示' },
  ],

  quickActions: [
    { label: '🎲 随机连通图', run(rt) {
        const g = _fbRandomGraph();
        rt.setInput('kind', 'undirected');
        rt.setInput('edges', g.edges);
        rt.setInput('start', g.start);
        rt.load();
      } },
    { label: '非连通图（生成森林）', run(rt) {
        rt.setInput('kind', 'undirected');
        rt.setInput('edges', 'A-B\nB-C\nC-A\nD-E\nE-F');
        rt.setInput('start', 'A');
        rt.load();
      } },
    { label: '有向无环图（DFS → 逆拓扑序）', run(rt) {
        rt.setInput('kind', 'directed');
        rt.setInput('algo', 'dfs');
        rt.setInput('edges', 'A->B\nA->C\nB->D\nC->D\nD->E\nE->F');
        rt.setInput('start', 'A');
        rt.load();
      } },
  ],

  /** 边列表改动时刷新起点下拉框（下拉框本身变更由框架自动 load） */
  bindInputs(els) {
    if (els && els.edges) els.edges.addEventListener('input', () => _fbSyncStart(els));
  },
  syncInputs(els) { _fbSyncStart(els); },

  parse(vals) {
    const directed = vals.kind === 'directed';
    const algo = vals.algo === 'bfs' ? 'bfs' : 'dfs';
    const raw = String(vals.edges || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!raw.length) throw { message: '边列表为空：请每行写一条边，如 A-B（无向）或 A->B（有向）' };

    const edges = [];
    const seen = new Set();
    const nodes = new Set();
    let dup = 0, arrowInUndirected = 0;
    raw.forEach((line, i) => {
      const m = line.match(/^([A-Za-z0-9]+)\s*(->|→|-|—)\s*([A-Za-z0-9]+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${line}」格式错误：应形如 A-B 或 A->B（两端只能是字母/数字）` };
      const a = m[1].toUpperCase(), b = m[3].toUpperCase();
      if (m[2] === '->' || m[2] === '→') arrowInUndirected += directed ? 0 : 1;
      if (a === b) throw { message: `第 ${i + 1} 行「${line}」是自环：两端顶点相同，无法用于遍历演示` };
      nodes.add(a); nodes.add(b);
      const key = directed ? a + '>' + b : [a, b].sort().join('~');
      if (seen.has(key)) { dup++; return; }
      seen.add(key);
      edges.push({ a, b });
    });

    if (nodes.size < 2) throw { message: '顶点数不足：至少需要 2 个不同顶点' };
    if (nodes.size > 8) throw { message: `顶点数 ${nodes.size} 过多：演示图请控制在 8 个顶点以内（当前 ${[...nodes].sort(_fbCmp).join('、')}）` };
    if (!edges.length) throw { message: '去除重复边后没有可用的边，请检查边列表' };

    const nl = [...nodes].sort(_fbCmp);
    const adj = {};
    nl.forEach(v => { adj[v] = []; });
    edges.forEach(e => {
      if (!adj[e.a].includes(e.b)) adj[e.a].push(e.b);
      if (!directed && !adj[e.b].includes(e.a)) adj[e.b].push(e.a);
    });
    nl.forEach(v => adj[v].sort(_fbCmp));

    const start = String(vals.start || '').toUpperCase();
    if (!nl.includes(start)) throw { message: `起点「${vals.start}」不在图中：当前顶点为 ${nl.join('、')}，请从下拉框选择` };

    return { nodes: nl, edges, adj, directed, algo, start, dup, arrowInUndirected };
  },

  buildSnapshots(model) {
    const { nodes, edges, adj, start, algo, directed, dup, arrowInUndirected } = model;
    const snaps = [];

    /* ---------------- 遍历状态（随帧全量复制） ---------------- */
    const visited = [];                    // 访问序列
    const vset = new Set();
    const tree = [];                       // 遍历树/森林的边
    const container = [];                  // DFS 栈 / BFS 队列
    const dist = {};                       // BFS 层号（DFS 下恒为空）
    const comps = [];                      // 已完成分量的顶点列表
    const compVerts = [];                  // 当前分量的顶点列表
    let comp = 0, peak = 0;

    const cloneAdj = () => { const o = {}; nodes.forEach(v => { o[v] = [...adj[v]]; }); return o; };
    const push = (step, o) => snaps.push(Object.assign({
      step,
      visited: [...visited],
      tree: tree.map(e => ({ a: e.a, b: e.b })),
      container: [...container],
      dist: Object.assign({}, dist),
      comps: comps.map(c => [...c]),
      compVerts: [...compVerts],
      comp, peak,
      cur: null, from: null, just: [], scanned: [],
      nodes: [...nodes],
      edges: edges.map(e => ({ a: e.a, b: e.b })),
      adj: cloneAdj(),
      start, algo, directed,
      log: '', logType: 'info', desc: '',
    }, o));

    const mark = v => { vset.add(v); visited.push(v); compVerts.push(v); };
    const note = [];
    if (dup) note.push(`已自动去重 ${dup} 条重复边`);
    if (arrowInUndirected) note.push(`${arrowInUndirected} 条箭头边按无向处理（图类型选的是"无向图"）`);
    /* 第一轮必须从用户指定的起点出发；其余顶点按名字升序作为后续各轮的起点 */
    const roots = [start].concat(nodes.filter(v => v !== start));

    push('init', {
      log: `就绪：${directed ? '有向图' : '无向图'}，${nodes.length} 个顶点（${nodes.join('、')}）、${edges.length} 条边；采用${algo === 'dfs' ? '深度优先遍历 DFS（栈）' : '广度优先遍历 BFS（队列）'}，起点 ${start}。${note.length ? '（' + note.join('；') + '）' : ''}`,
      desc: `就绪：点击「单步执行」开始 ${algo === 'dfs' ? 'DFS：沿未访问邻点一路深入，无路可走再退栈回溯' : 'BFS：逐层向外扩散，出队一个顶点就把它的未访问邻点全部入队'}`,
    });

    if (algo === 'dfs') {
      /* ------------------------- 深度优先：显式栈 ------------------------- */
      roots.forEach(root => {
        if (vset.has(root)) return;
        comp++;
        container.length = 0;
        mark(root);
        container.push(root);
        peak = Math.max(peak, container.length);

        push('component', {
          cur: root,
          log: `第 ${comp} 轮搜索：${comp > 1 ? '前一个分量已遍历完，' : ''}从未被访问的顶点 ${root} 出发`,
          desc: `进入第 ${comp} 轮：起点 ${root} 已访问并压入栈（栈深 1）`,
        });

        while (container.length) {
          const v = container[container.length - 1];
          const w = (adj[v] || []).find(x => !vset.has(x));
          if (w === undefined) {
            container.pop();
            push('pop', {
              cur: v,
              log: `回溯：${v} 的邻接点 ${(adj[v] || []).join('、') || '（无）'} 全部访问过 → 栈顶 ${v} 出栈${container.length ? `，回到 ${container[container.length - 1]}` : '，本轮搜索结束'}`,
              desc: `${v} 已无未访问邻点 → 退栈回溯${container.length ? `到 ${container[container.length - 1]}（栈深 ${container.length}）` : '（栈空，第 ' + comp + ' 轮结束）'}`,
            });
          } else {
            mark(w);
            container.push(w);
            peak = Math.max(peak, container.length);
            tree.push({ a: v, b: w });
            push('visit', {
              cur: w, from: v, just: [{ a: v, b: w }],
              log: `${v} 的第一个未访问邻点 ${w} → 访问 ${w} 并入栈（${w} 的邻接点：${(adj[w] || []).join('、') || '无'}）`,
              logType: 'success',
              desc: `沿边 ${v}${directed ? '→' : '–'}${w} 深入，第 ${visited.length} 个访问 ${w}（栈深 ${container.length}）`,
            });
          }
        }
        comps.push([...compVerts]);
        compVerts.length = 0;
        push('compdone', {
          log: `第 ${comp} 个${directed ? '可达' : '连通'}分量遍历完毕：${comps[comp - 1].join(' → ')}`,
          logType: 'info',
          desc: `第 ${comp} 轮结束（该分量 ${comps[comp - 1].length} 个顶点）`,
        });
      });
    } else {
      /* ------------------------- 广度优先：队列 ------------------------- */
      roots.forEach(root => {
        if (vset.has(root)) return;
        comp++;
        container.length = 0;
        mark(root);
        dist[root] = 0;
        container.push(root);
        peak = Math.max(peak, container.length);

        push('component', {
          cur: root,
          log: `第 ${comp} 轮搜索：${comp > 1 ? '前一个分量已遍历完，' : ''}从未被访问的顶点 ${root} 出发，访问并入队（层号 0）`,
          desc: `进入第 ${comp} 轮：起点 ${root} 访问并入队（层号 0，队列长 1）`,
        });

        while (container.length) {
          const v = container.shift();
          push('pop', {
            cur: v,
            log: `队首 ${v} 出队（层号 ${dist[v]}）→ 依次考察它的邻接点：${(adj[v] || []).join('、') || '无'}`,
            desc: `出队 ${v}（层号 ${dist[v]}，队列还剩 ${container.length} 个待扩展顶点）`,
          });

          const added = [];
          const scanned = (adj[v] || []).map(w => {
            const already = vset.has(w);
            if (!already) {
              mark(w);
              dist[w] = dist[v] + 1;
              container.push(w);
              tree.push({ a: v, b: w });
              added.push(w);
            }
            return { w, already };
          });
          peak = Math.max(peak, container.length);

          push('expand', {
            cur: v, scanned,
            just: added.map(w => ({ a: v, b: w })),
            log: added.length
              ? `${v} 的邻接点中 ${added.join('、')} 尚未访问 → 依次访问并入队（层号 ${dist[v] + 1}），队列长度变为 ${container.length}`
              : `${v} 的邻接点 ${(adj[v] || []).join('、') || '（无）'} 都已访问过 → 无新顶点入队`,
            logType: added.length ? 'success' : 'info',
            desc: added.length
              ? `第 ${visited.length - added.length + 1}~${visited.length} 个访问 ${added.join('、')} 并入队（层号 ${dist[v] + 1}）`
              : `${v} 的邻接点都已访问，本帧无新顶点入队`,
          });
        }
        comps.push([...compVerts]);
        compVerts.length = 0;
        push('compdone', {
          log: `第 ${comp} 个${directed ? '可达' : '连通'}分量遍历完毕：${comps[comp - 1].join(' → ')}`,
          logType: 'info',
          desc: `第 ${comp} 轮结束（该分量 ${comps[comp - 1].length} 个顶点，队列已清空）`,
        });
      });
    }

    const compCount = comps.length;
    const reach = visited.length < nodes.length;
    push('done', {
      log: `遍历完成！访问序列：${visited.join(' → ')}；共 ${compCount} 个${directed ? '可达分量' : '连通分量'}，遍历树/森林 ${tree.length} 条边（= ${nodes.length} − ${compCount}）。${algo === 'bfs' ? ' 层号即无权图单源最短路径长度。' : ' 退栈序列在 DAG 上为逆拓扑有序序列。'}`,
      logType: 'success',
      desc: `完成：访问序列 ${visited.join(' → ')}${reach ? `（${nodes.filter(v => !vset.has(v)).join('、')} 不可达，已分 ${compCount} 轮搜索）` : ''}`,
    });

    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const nodes = s.nodes || model.nodes || [];
    const edges = s.edges || model.edges || [];
    const adj = s.adj || model.adj || {};
    const directed = !!s.directed;
    const algo = s.algo === 'bfs' ? 'bfs' : 'dfs';
    const start = s.start;
    const n = nodes.length;
    const visited = s.visited || [];
    const vset = new Set(visited);
    const tree = s.tree || [];
    const container = s.container || [];
    const dist = s.dist || {};
    const comps = s.comps || [];
    const compVerts = s.compVerts || [];
    const justKeys = new Set((s.just || []).map(e => _fbEkey(e, directed)));
    const treeKeys = new Set(tree.map(e => _fbEkey(e, directed)));
    const queued = new Set(container);
    const cur = s.cur;
    const isStack = algo === 'dfs';
    const done = s.step === 'done';

    /* ------------------------- 布局（只由顶点集决定） ------------------------- */
    const R = n <= 4 ? 116 : n <= 6 ? 144 : 156;
    const pos = {};
    nodes.forEach((nm, i) => {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, n);
      pos[nm] = { x: 320 + R * Math.cos(ang), y: 212 + R * Math.sin(ang) };
    });
    const hasE = (a, b) => edges.some(e => e.a === a && e.b === b);

    /* ------------------------- 边 ------------------------- */
    const edgeSvg = edges.map(e => {
      const p = pos[e.a], q = pos[e.b];
      if (!p || !q) return '';
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const gap = 27 + (directed ? 8 : 0);
      const sx = p.x + ux * gap, sy = p.y + uy * gap;
      const ex = q.x - ux * gap, ey = q.y - uy * gap;
      let d, mx, my;
      if (directed && hasE(e.b, e.a)) {
        /* 双向边必须分居两侧（否则完全重叠） */
        const side = e.a < e.b ? 1 : -1;
        mx = (sx + ex) / 2 - uy * 26 * side;
        my = (sy + ey) / 2 + ux * 26 * side;
        d = `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      } else {
        mx = (sx + ex) / 2; my = (sy + ey) / 2;
        d = `M${sx.toFixed(1)},${sy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`;
      }
      const k = _fbEkey(e, directed);
      const inTree = treeKeys.has(k), isJust = justKeys.has(k);
      const cls = isJust ? 'kedge kedge-mst kedge-just' : inTree ? 'kedge kedge-mst' : 'kedge';
      const mark = directed
        ? ` marker-end="url(#${(inTree || isJust) ? '_fb-arw-hi' : '_fb-arw'})"`
        : '';
      return `<path d="${d}" class="${cls}" fill="none"${mark}/>`;
    }).join('');

    /* ------------------------- 顶点 ------------------------- */
    const nodeSvg = nodes.map(nm => {
      const p = pos[nm];
      const no = visited.indexOf(nm) + 1;                       // 0 = 尚未访问
      const isCur = cur === nm;
      const fill = isCur ? '#f59e0b' : no ? '#10b981' : '#e2e8f0';
      const txt = (isCur || no) ? '#ffffff' : '#475569';
      const inQ = queued.has(nm) && !isCur;
      const sub1 = no ? `第 ${no} 个访问` : '';
      const sub2 = !isStack && dist[nm] !== undefined ? `层 ${dist[nm]}` : (inQ ? (isStack ? '在栈中' : '在队列中') : '');
      return `${nm === start ? `<circle cx="${p.x}" cy="${p.y}" r="30" fill="none" stroke="#4f46e5" stroke-width="2" stroke-dasharray="4 3"/>` : ''}
        ${inQ ? `<circle cx="${p.x}" cy="${p.y}" r="27.5" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 3"/>` : ''}
        ${isCur ? `<circle cx="${p.x}" cy="${p.y}" r="34" class="knode-halo" stroke="#f59e0b"/>` : ''}
        <circle cx="${p.x}" cy="${p.y}" r="24" class="knode-circle" fill="${fill}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="fill:${txt}">${RC408.util.esc(nm)}</text>
        ${sub1 ? `<text x="${p.x}" y="${p.y + 40}" text-anchor="middle" style="font:700 11px Consolas" fill="#059669">${sub1}</text>` : ''}
        ${sub2 ? `<text x="${p.x}" y="${p.y + (sub1 ? 53 : 40)}" text-anchor="middle" style="font:700 11px Consolas" fill="#b45309">${sub2}</text>` : ''}`;
    }).join('');

    const defs = `<defs>
      <marker id="_fb-arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#cbd5e1"/></marker>
      <marker id="_fb-arw-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#10b981"/></marker>
    </defs>`;

    /* ------------------------- 统计卡 ------------------------- */
    const stats =
      RC408.ui.statCard('遍历方式', isStack ? '深度优先 DFS' : '广度优先 BFS',
        isStack ? '借助栈（递归即系统栈）· 后进先出' : '借助队列 · 先进先出', 'text-indigo-600') +
      RC408.ui.statCard('已访问顶点', `${visited.length} / ${n}`, `访问序列长度 ${visited.length}`, 'text-emerald-600') +
      RC408.ui.statCard(isStack ? '栈最大深度' : '队列最大长度', String(s.peak || 0),
        isStack ? '当前搜索路径长度' : '同一时刻待扩展顶点数', 'text-amber-600') +
      RC408.ui.statCard('搜索轮数', String(s.comp || 0), `已完成 ${comps.length} 个${directed ? '可达' : '连通'}分量`, 'text-slate-600');

    /* ------------------------- 邻接表 ------------------------- */
    const adjRows = nodes.map(v => {
      const list = adj[v] || [];
      return `<tr><td class="font-bold">${RC408.util.esc(v)}</td>
        <td style="text-align:left"><span class="inline-flex flex-wrap gap-1">${
          list.length
            ? list.map(w => `<span class="chip ${vset.has(w) ? 'chip-hit' : 'chip-future'}" title="${RC408.util.esc(w)}${vset.has(w) ? ' 已访问' : ' 未访问'}">${RC408.util.esc(w)}</span>`).join('')
            : '<span class="chip chip-future">（无）</span>'
        }</span></td>
        <td class="font-mono text-[11px] text-slate-400">${list.length}</td></tr>`;
    }).join('');

    /* ------------------------- 工作栈 / 队列 ------------------------- */
    const containerHtml = container.length
      ? container.map((v, i) => {
          const head = isStack ? i === container.length - 1 : i === 0;
          return `<span class="chip ${head ? 'chip-cur' : ''}" title="${isStack ? (i === 0 ? '栈底' : '') : (i === 0 ? '队首' : '')}">${RC408.util.esc(v)}</span>`;
        }).join('')
      : '<span class="text-xs text-slate-400">（空）</span>';

    /* ------------------------- 本帧考察的邻接点（BFS） ------------------------- */
    const scanned = s.scanned || [];
    const scanHtml = scanned.length
      ? scanned.map(x => `<span class="chip ${x.already ? 'chip-rej' : 'chip-hit'}">${RC408.util.esc(x.w)}${x.already ? ' 已访问 → 跳过' : ' 未访问 → 入队'}</span>`).join('')
      : '';

    /* ------------------------- 访问序列 / 遍历树边 ------------------------- */
    const seqHtml = visited.length
      ? visited.map((v, i) => `<span class="chip ${v === cur ? 'chip-cur' : 'chip-hit'}">${i + 1}.${RC408.util.esc(v)}</span>`).join('<span class="text-slate-300">→</span>')
      : '<span class="text-xs text-slate-400">（尚未访问任何顶点）</span>';

    const treeHtml = tree.length
      ? tree.map(e => {
          const k = _fbEkey(e, directed);
          return `<span class="chip ${justKeys.has(k) ? 'chip-check' : 'chip-mst'}">${RC408.util.esc(e.a)}${directed ? '→' : '–'}${RC408.util.esc(e.b)}</span>`;
        }).join('')
      : '<span class="text-xs text-slate-400">（尚无）</span>';

    /* ------------------------- 分量 ------------------------- */
    const compLines = comps.map((c, i) =>
      `<div><span class="chip chip-mst">分量 ${i + 1}</span> <span class="font-mono text-slate-600">${c.map(v => RC408.util.esc(v)).join(' → ')}</span></div>`).join('');
    const compCur = compVerts.length
      ? `<div><span class="chip chip-cur">分量 ${s.comp} 进行中</span> <span class="font-mono text-slate-600">${compVerts.map(v => RC408.util.esc(v)).join(' → ')}</span></div>`
      : '';

    /* ------------------------- 结论 ------------------------- */
    const unreach = nodes.filter(v => !vset.has(v));
    const conclusion = `
      <div class="rounded-xl border ${done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'} p-3 text-xs text-slate-600 space-y-1.5">
        <div class="font-bold ${done ? 'text-emerald-700' : 'text-slate-500'}">${done ? '遍历结论' : '当前累计（尚未走完）'}</div>
        <div>访问序列：<span class="font-mono font-bold text-slate-800">${visited.join(' → ') || '（空）'}</span></div>
        <div>遍历树 / 森林：<b class="font-mono">${tree.length}</b> 条边　｜　顶点 <b class="font-mono">${n}</b> 个、输入的边 <b class="font-mono">${edges.length}</b> 条　｜　${comps.length > 1 ? `非连通 → 生成<b>森林</b>（${comps.length} 棵）` : '连通 → 生成<b>树</b>'}</div>
        <div>时间复杂度：邻接表 O(n+e) = O(${n}+${edges.length})　｜　邻接矩阵 O(n²) = O(${n * n})　｜　空间 O(n)</div>
        ${!isStack ? `<div>BFS 层号（即无权图单源最短路径边数）：${nodes.map(v => `${RC408.util.esc(v)}:${dist[v] === undefined ? '不可达' : dist[v]}`).join('，')}</div>` : ''}
        ${unreach.length && done ? `<div class="text-rose-600">未访问：${unreach.map(v => RC408.util.esc(v)).join('、')}（${directed ? '从 ' + RC408.util.esc(start) + ' 出发不可达' : '与起点不连通'}）→ 搜索轮数 = ${comps.length}</div>` : ''}
        ${directed ? '<div>有向图：只沿出边搜索；每个起点各得一个可达集，"分量"即各轮可达的顶点集合。</div>' : ''}
      </div>`;

    const tips = `
      <div class="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-[11.5px] text-indigo-900 space-y-1">
        <div class="font-bold">考点提醒</div>
        <div>· 序列不唯一：由邻接表的邻接次序决定（本模块按顶点名升序）；改用邻接矩阵按行扫描则序列唯一 —— 2013-8、2016-6 判定"某序列是否合法"的依据。</div>
        <div>· DFS 借栈、BFS 借队列；每个顶点入栈/入队一次，邻接表下每条边被检查一次（无向图两次）→ O(n+e)；邻接矩阵每个顶点都要扫描整行 → O(n²) —— 2012-5。</div>
        <div>· 非连通图（有向图不可达）→ 生成森林：搜索轮数 = 分量数，生成树边数 = n − 分量数。</div>
        <div>· 只有 BFS 能求无权图单源最短路径（层号即最短边数）；DFS 用递归栈把"当前路径"整条留住，天然适合判断可达性、检测回路 —— 2020-6 DAG 上退栈序列即逆拓扑有序序列。</div>
      </div>`;

    const legendRow = `
      <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-500 border-t border-slate-100 pt-2 mt-1 px-2 justify-center">
        ${RC408.ui.legend('#e2e8f0', '未访问')}
        ${RC408.ui.legend('#10b981', '已访问（圆圈下标注第几个访问）')}
        ${RC408.ui.legend('#f59e0b', '当前处理顶点（' + (isStack ? '栈顶' : '队首') + '）')}
        ${RC408.ui.legend('#4f46e5', '双虚线环 = 起点')}
        ${RC408.ui.legend('#10b981', '遍历树 / 生成森林的边')}
      </div>`;

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
            <svg viewBox="0 0 640 440" class="w-full h-auto mx-auto" style="max-width:640px">${defs}${edgeSvg}${nodeSvg}</svg>
            ${legendRow}
          </div>

          <div class="space-y-3">
            <div>${RC408.ui.sectionTitle('邻接表（顶点表 + 边表；次序决定遍历序列）')}
              <div class="overflow-x-auto"><table class="tbl w-full">
                <thead><tr><th>顶点</th><th>${directed ? '出边表（邻接点）' : '边表（邻接点）'}</th><th>${directed ? '出度' : '度'}</th></tr></thead>
                <tbody>${adjRows}</tbody></table></div>
            </div>

            <div class="rounded-xl border border-slate-200 bg-white p-3">
              ${RC408.ui.sectionTitle(isStack ? 'DFS 工作栈（栈底 → 栈顶）' : 'BFS 队列（队首 → 队尾）')}
              <div class="flex flex-wrap items-center gap-1.5" data-role="container">${containerHtml}</div>
              <div class="mt-2 text-[11px] text-slate-500">
                长度 <b class="font-mono">${container.length}</b>　｜　历史峰值 <b class="font-mono">${s.peak || 0}</b>
                ${isStack ? '　｜　栈里存的就是"当前搜索路径"' : '　｜　队列里存的是"下一层待扩展的顶点"'}
              </div>
              ${scanHtml ? `<div class="mt-2 pt-2 border-t border-slate-100">${RC408.ui.sectionTitle('本帧考察的邻接点')}<div class="flex flex-wrap gap-1.5">${scanHtml}</div></div>` : ''}
            </div>

            <div class="rounded-xl border border-slate-200 bg-white p-3">
              ${RC408.ui.sectionTitle('访问序列（答题就写这一行）')}
              <div class="flex flex-wrap items-center gap-1" data-role="seq">${seqHtml}</div>
            </div>

            <div class="rounded-xl border border-slate-200 bg-white p-3">
              ${RC408.ui.sectionTitle('遍历树 / 生成森林的边')}
              <div class="flex flex-wrap gap-1.5">${treeHtml}</div>
            </div>

            <div class="rounded-xl border border-slate-200 bg-white p-3">
              ${RC408.ui.sectionTitle(directed ? '各轮可达集（有向图）' : '连通分量（每轮一个）')}
              <div class="space-y-1 text-xs">${compLines}${compCur}${(compLines || compCur) ? '' : '<span class="text-xs text-slate-400">（尚未完成任何一轮）</span>'}</div>
            </div>
          </div>
        </div>

        ${conclusion}
        ${tips}
      </div>`;
  },
});
