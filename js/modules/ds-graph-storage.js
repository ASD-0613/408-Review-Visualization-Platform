'use strict';
/* ============================================================================
 * ds-graph-storage.js —— 【数据结构】图的存储结构（前缀 _gs）
 * 考情：18 年中 4 年（选 3 题 + 大 1 道）——2013-7 选（邻接矩阵非对称
 *   ⟹ 有向图，度 = 出度 + 入度）、2015-42 大（写出邻接矩阵 A 与 A²）、
 *   2024-4 选（无向图邻接多重表）、2026-6 选（邻接表求入度的复杂度）。
 *   注：2026-6 全站此前无人登记，本模块登记时一并记在 js/exam-history.js 的 ds-graph-storage 键下。
 *
 * ============================================================================
 * ★ 数据模型与不变量（先写清楚，再写实现；冒烟脚本照这份注释逐条验）
 * ============================================================================
 *
 * 模型（parse 的返回值）：
 *   { nodes: string[]        顶点名，按名字升序（决定矩阵行列序、边结点编号序）
 *     edges: [{a,b}]         输入边；有向图 a→b 保留方向，无向图 a<b 规范化
 *     directed: boolean      输入里出现过 -> / → 就是有向图
 *     n: number, m: number   顶点数 / 边数
 *     adjM: number[][]       **输入邻接矩阵**（有向图非对称、无向图对称），adjM[i][j]=1 ⟺ i→j
 *     out: number[]          出度（= adjM 第 i 行行和）
 *     indeg: number[]        入度（= adjM 第 j 列列和；无向图恒等于 out）
 *   }
 *
 * 三种存储的"真值"定义（三者必须描述同一个图，这是全模块最核心的不变量）：
 *   ① 邻接矩阵 adjM：adjM[i][j] = 1 ⟺ 存在边 nodes[i] → nodes[j]。（本模块的主视图）
 *   ② 邻接表 adjList：adjList[i] = 顶点 i 的出边结点**编号**列表，按邻接点名字升序。
 *        第 k 行 = 顶点 nodes[k] 自己的出边链（有向图 = 出边，无向图 = 边）。
 *   ③ 边结点表 nodeTab（编号 = 存储数组的下标，教材里就是 0/1/2… 或 1/2/3…）：
 *        有向图 → 十字链表 arc：{ id, tail, head, hlink, tlink }
 *            · tail→head 是该弧；tlink = 下一条**同尾(=tail)**的弧编号，hlink = 下一条**同头(=head)**的弧编号
 *            · 于是 adjList[k] 恰好是"从顶点 k 出发沿 tlink 走出来的链"，逆邻接链 = 沿 hlink 走
 *        无向图 → 邻接多重表 edge：{ id, ivex, jvex, ilink, jlink }
 *            · 一条边只存**一个**边结点，ilink 挂在下一条含 ivex 的边、jlink 挂在下一条含 jvex 的边
 *
 * ★ 编号构造算法（保证 ①②③ 天然一致，不许各画各的）：
 *   按顶点序 i = 0..n−1 逐行扫描矩阵；对每个 i 再按 j = 0..n−1 升序扫描：
 *     · 有向图：adjM[i][j]=1 且该弧未编号 → 新建弧结点 {tail:i, head:j}；
 *     · 无向图：adjM[i][j]=1 且该边未编号 → 新建边结点 {ivex:i, jvex:j}，并给两端都挂上编号。
 *   这样每条边/弧的编号唯一、顺序确定（可断言），且 adjList 的链序 = 上面定义。
 *
 * 不变量（冒烟脚本逐帧验；每一条都是"不变量"不是"我算出的常量"）：
 *   I1 矩阵与边集等价：adjM[i][j] = 1 ⟺ 存在一条 i→j 的边（有向）；无向图 ⟺ 存在 {i,j} 边。
 *   I2 无向图的 adjM 必为**对称矩阵**（adjM[i][j] = adjM[j][i]）；有向图则允许非对称。
 *   I3 编号唯一且连续：边结点编号恰为 0..m−1 各一次（m = 边数）。
 *   I4 邻接表链长 = 该顶点出度（无向图 = 度）：adjList[i].length === out[i]；且分量去重无重复。
 *   I5 逐顶点独立重算（最可靠的那条）：对每个 i，adjList[i] 必须**恰好**等于
 *      { j : adjM[i][j] = 1 } 按名字升序去重后的编号序列 —— 右边只从矩阵推、不碰链的构造过程。
 *   I6 有向图：出度 out[i] = 行和、入度 indeg[j] = 列和；总边数 = Σout = Σindeg。
 *   I7 无向图：out[i] = indeg[i] = 行和；Σout = 2m（每条边被两端各记一次）。
 *   I8 十字链表（**链 = 头插法，"新的在前"**）：从顶点结点 `firstout[k]` 出发沿 `tlink` 走，
 *      恰好**不重不漏**地枚举 { tail==k 的弧 }（长度 = out[k]）；从 `firstin[k]` 出发沿 `hlink` 走，
 *      恰好枚举 { head==k 的弧 }（长度 = indeg[k]）。⚠ 因此 `tlink` 指向的是"同尾的**前一条**弧"
 *      （编号更小的一条），**不是下一条** —— 渲染时链按**指针顺序**从左到右排（§3.8-5③ 的独立验法照此写）。
 *   I9 邻接多重表（**链 = 教科书语义，不是"按角色分两条"**）：从顶点 w 的 `firstedge[w]` 出发，
 *      **每到一个边结点就看 w 在这条边里是 ivex 还是 jvex**：是 ivex 走 `ilink`、是 jvex 走 `jlink`；
 *      这条链恰好**不重不漏**地枚举"依附于 w 的所有边"（长度 = 度），最后停在 NULL。
 *      ⚠ 所以 `ilink` 的下一条**不一定**是同 ivex 的边（它挂的是"创建该结点时，上一条依附于 ivex 的边"），
 *      本模块的 I9 老注释曾写成"ilink 链 = 所有含 ivex 的边"，那是**另一种（非教科书的）构造**，窗40 就地改正。
 *   I9b 数度等价式（**2024-4 官方解析的解法**）：顶点 v 在全部边结点的两个**顶点域**里出现的次数之和 = 度
 *      （每条边只存一个结点，v 每出现一次就代表一条依附于它的边）⟹ 渲染里两处都给出，互相印证。
 *   I12 三个顶点结点指针域（新渲染的"从顶点表指出去"的那根箭头，全部由 I8/I9 的链头定义）：
 *      · 有向：`firstout[i]` = outChain[i] 的最后一条（头插法 ⟹ 链头）、`firstin[j]` = inChain[j] 的最后一条；
 *      · 无向：`firstedge[i]` = 依附于 i 的边里**最后创建**的那一条（也就是 i 的链头，走后按 I9 的规则）。
 *   I10 帧序单调：邻接矩阵按**行**推进（第 i 步补齐第 i 行），边结点按编号递增出现 ⟹
 *      任意两帧的差异只允许"新增"，不允许已写好的格子/结点被改写（"只增不改"）。
 *   I11 稳定帧：init（0 个结点）/ settled（一整行刚填完）/ done（全部完成）三类的表必须自洽
 *      （按 §3.8-2：过渡帧只验"已出现部分"的不变量，不套完整结构的公式）。
 *
 * ★ 守卫与合法输入上界（§3.8-17⑦）：一张 n 顶点简单图的邻接表里，一个顶点的出边链最长
 *   只能是 **n−1** 条（无重边、无自环；无向图同理）。故任何"沿指针走链"的防死循环守卫都写成
 *   `while (cur >= 0 && guard < n)`，其中守卫上限 n 恰等于合法输入的**上确界 + 1**，
 *   一旦守卫触发就说明链里出现了重复结点 —— 这本身就是 I8 的判据，绝不能把守卫调小。
 * ========================================================================== */

RC408.registerModule({
  id: 'ds-graph-storage',
  mode: 'stepper',
  title: '图的存储结构（邻接矩阵 / 邻接表 / 十字链表 / 邻接多重表）',

  theory: `
> **为什么要有它**：图有两种基本存储——**邻接矩阵**（二维数组，判断两点是否相邻 O(1)，但 n 个顶点恒占 n² 空间）与**邻接表**（顶点表 + 边表，稀疏图省空间，但判断两点是否相邻要扫链）。选择题里"该选哪一种"考的就是这两条代价曲线。
> **怎么实现**：邻接矩阵 \\(A[i][j]=1\\) 表示存在边；邻接表把每个顶点的邻点串成一条链；**十字链表**给弧结点加两个指针（同尾链 + 同头链），把**出度和入度**都变成 O(1)；**邻接多重表**让无向图的**一条边只存一个结点**。
> **记住什么**：有向图邻接矩阵**非对称**时"度 = 出度 + 入度"；邻接表求**入度**要扫全表（\\(O(n+e)\\)）、求**出度**只用扫本行（\\(O(1)\\) 读表头 + 沿链走）；稀疏图选**邻接表**、稠密图选**邻接矩阵**。

## 一、邻接矩阵（Adjacency Matrix）
用 n×n 的二维数组 \\(A\\) 存图，\\(A[i][j]=1\\) 表示顶点 \\(i\\) 到 \\(j\\) 有一条边（带权图存权值、无边存 \\(\\infty\\)）。
- **无向图的邻接矩阵一定是对称矩阵**（\\(A[i][j]=A[j][i]\\)）；**有向图一般非对称**——这是"只看一个矩阵判断图是否有向"的唯一依据；
- 无向图：第 i 行的 1 的个数 = 顶点 i 的**度**；
- 有向图：第 i 行的 1 的个数 = **出度**，第 j 列的 1 的个数 = **入度**，**度 = 出度 + 入度**；
- 空间恒为 \\(O(n^2)\\)，与边数无关 ⟹ **稠密图**合适、**稀疏图**（\\(e \\ll n^2\\)）浪费空间；
- 判断任意两点是否相邻、以及求两点间边数，都只要 \\(O(1)\\)；
- 无向图的邻接矩阵关于主对角线对称，**实际只需存上（下）三角**。

## 二、邻接表（Adjacency List）
顶点表（顺序存储，每个表目两项：顶点信息 + 指向第一条边结点的指针）＋ 边表（链式存储的边结点）。
- 边结点的两个域：**邻接点域**（该边另一端的顶点下标）与**链域**（同表目下一条边）；
- 无向图的邻接表里，每条边出现**两次**（\\(i\\) 的表里有 \\(j\\)、\\(j\\) 的表里也有 \\(i\\)）⟹ 边结点数 = \\(2e\\)；
- 有向图的邻接表里每个边结点只存**出边** ⟹ 边结点数 = \\(e\\)，称为**出边表**；求入度必须把整张表扫一遍；
- **求有向图某顶点的入度**：邻接表要扫全部 n 个表目、沿链检查 \\(e\\) 个边结点 ⟹ \\(O(n+e)\\)（**2026 年这道选择题就考这一条**）；而邻接矩阵求入度只要数一列 ⟹ \\(O(n)\\)；
- **求某顶点的出度**：邻接表沿本表目的链走一遍即可，与出度成正比；邻接矩阵数一行 ⟹ \\(O(n)\\)；
- 空间：无向图 \\(O(n+2e)\\)、有向图 \\(O(n+e)\\) ⟹ **稀疏图**省空间；
- 邻接表的**表目次序与链上次序都不唯一** ⟹ 由它导出的 DFS/BFS 序列也不唯一（改用邻接矩阵按行扫描则序列唯一）。

## 三、十字链表（Orthogonal List，有向图）
把邻接表和逆邻接表**合二为一**：顶点结点存 <code>firstin / firstout</code> 两个指针，弧结点有 **5 个域**：
<code>tailvex</code>（弧尾顶点下标）、<code>headvex</code>（弧头顶点下标）、<code>hlink</code>（**同弧头**的下一条弧指针）、<code>tlink</code>（**同弧尾**的下一条弧指针）、<code>info</code>（权值等）。
- 从顶点 \\(v\\) 沿 <code>tlink</code> 走 = 它的**出边链**（邻接表）；沿 <code>hlink</code> 走 = 它的**入边链**（逆邻接表）；
- 于是**出度和入度都只需 O(1) 取表头 + 沿链走**，正反两个方向的遍历都方便；
- 每条弧只存一个弧结点 ⟹ 弧结点数恰为 \\(e\\)。

## 四、邻接多重表（Adjacency Multilist，无向图）
邻接表存无向图时每条边要存两遍、删边时要改两处；邻接多重表给**每条边只设一个边结点**：
两个顶点域 <code>ivex / jvex</code> ＋ 两个链域 <code>ilink</code>（指向下一条依附于 <code>ivex</code> 的边）、<code>jlink</code>（指向下一条依附于 <code>jvex</code> 的边）。
- 边结点数恰为 \\(e\\)（不是 \\(2e\\)）；顶点结点的 <code>firstedge</code> 指向依附于它的第一条边；
- 每条边同时挂在两个顶点的链上 ⟹ 删边、标记"边是否被访问过"都只要改一处，遍历无向图更方便；
- 若顶点在边里，则它同时出现在该边的 <code>ilink</code> 侧与 <code>jlink</code> 侧，**数度时同一结点会被两条链各数一次**，不要重复计数。

## 五、考点提醒（易错点）
1. **"有向还是无向"看矩阵对称性**：题目给一个邻接矩阵问度，先看它是否对称——非对称就是有向图，某个顶点的度 = 第 i 行之和 + 第 i 列之和（**2013 年这道题就靠这一步**）；
2. **稀疏图选邻接表、稠密图选邻接矩阵**：判据是空间 \\(O(n+e)\\) 与 \\(O(n^2)\\) 的比较，不是"哪个看起来高级"；
3. **无向图邻接矩阵的 \\(A^2\\)**：\\(A^2[i][j]\\) 等于从 \\(i\\) 到 \\(j\\) 长度为 2 的**路径条数**（**2015-42** 让先写 \\(A\\) 再写 \\(A^2\\)，按这个含义逐项对）；
4. **邻接表求入度是 \\(O(n+e)\\)**（**2026-6**），别答成 \\(O(1)\\) 或 \\(O(n)\\)——\\(O(1)\\) 只在"已经维护好入度数组"时才成立；
5. **十字链表画图时两个指针别串错**：<code>tlink</code> 必须落在**同尾**的弧上、<code>hlink</code> 必须落在**同头**的弧上；本模块把每条弧的两条链都标出编号，可逐条核对；
6. **邻接多重表的边结点数是 \\(e\\) 不是 \\(2e\\)**（**2024-4**），这是它与邻接表存无向图最本质的区别；
7. **邻接多重表里"数度"有两条路**（**2024-4 官方解析**两条都给了）：① 先按链把图还原出来、再数每个顶点的边；② **直接数下标**——顶点 \\(v\\) 的下标在每个边结点的 <code>ivex</code> / <code>jvex</code> 两个域里各算一次，**出现次数之和就是度**（2024-4：下标 1 出现 2 次 ⟹ \\(b\\) 的度 2；下标 3 出现 4 次 ⟹ \\(d\\) 的度 4，答案 **B**）。本模块的链视图把两条路同时摆出来：左边顶点表沿链走一遍带序号，下方表格给"链长"与"下标出现次数"。

> **真题考情**：**18 年中 4 年（选 3 题 + 大 1 道）**：选 2013-7（邻接矩阵非对称 ⟹ 有向图，度 = 行和 + 列和）、
> 2024-4（无向图邻接多重表：**数下标求 \\(b\\)、\\(d\\) 的度**，答案 \\(b=2\\) / \\(d=4\\)）、2026-6（邻接表求入度的复杂度）；大 2015-42（写出邻接矩阵 A 与 A²）。
`,

  inputs: [
    { key: 'edges', label: '边列表（无向图写 A-B，有向图写 A->B；每行一条）', type: 'textarea', rows: 5, wide: true,
      default: 'A->B\nA->C\nB->D\nC->D\nC->E\nD->E\nE->A' },
    { key: 'view', label: '要看的存储结构', type: 'select',
      /* ⚠ 下拉框选项的铁律：对象字段必须是 **`v`（值）/ `t`（显示文本）**——
         framework.js:372 渲染的是 `o.v` / `o.t`，写成 `{value,label}` 会渲染出三个空选项；
         而 `rt.setInput`（framework.js:434）有护栏会当场抛「预设值不在下拉框选项里」。
         本窗踩过：quickActions 全炸、只有默认值还能显示（见 §0.3）。 */
      options: [
        { v: 'matrix', t: '邻接矩阵（主视图）' },
        { v: 'list', t: '邻接表 / 出边表' },
        { v: 'chain', t: '十字链表（有向）/ 邻接多重表（无向）' },
      ],
      default: 'matrix' },
    /* ⚠ 窗40 用户反馈"箭头太密"⟹ 链视图默认**只画当前顶点那条链**：其余盒子的链指针**值仍写在格子里**
       （数字 / ^ 一个不少，正好练 2024-4 那种"数下标"的读法），只是不画线；想看全貌切"显示全部链指针"。 */
    { key: 'show', label: '链指针显示（链视图 / 邻接表视图生效）', type: 'select',
      options: [
        { v: 'cur', t: '只看当前顶点的链（默认，最清爽）' },
        { v: 'all', t: '显示全部链指针（信息全，线多）' },
      ],
      default: 'cur' },
  ],

  quickActions: [
    { label: '有向图（十字链表示例）', run(rt) { rt.setInput('edges', 'A->B\nA->C\nB->D\nC->D\nC->E\nD->E\nE->A'); rt.setInput('view', 'matrix'); rt.load(); } },
    { label: '无向图（邻接多重表示例）', run(rt) { rt.setInput('edges', 'A-B\nA-C\nB-C\nB-D\nC-E\nD-E'); rt.setInput('view', 'matrix'); rt.load(); } },
    /* ⚠ 稀疏图这条**必须设成 list 视图**：它的用途就是展示"邻接表存稀疏图省空间"，
       而且稀疏图的邻接表里会出现「^ 空链」记号（本模块的 D 顶点链尾）。窗31 首次跑
       harness 时这条写成了 matrix，结果"^ 空链"断言永远看不到（视图根本没切过去）。 */
    { label: '稀疏图（4 顶点 3 边）', run(rt) { rt.setInput('edges', 'A-B\nB-C\nC-D'); rt.setInput('view', 'list'); rt.load(); } },
    /* 2024-4 真题图（邻接多重表）：7 条边 ⟹ b 的下标 1 出现 2 次（度 2）、d 的下标 3 出现 4 次（度 4），官方答案 B。
       证据：考情缓存/2024_解析.txt:24 与 :67-69（"b 对应的 1 出现了 2 次，度为 2，d 对应的 3 出现了 4 次。度为 4"）。 */
    { label: '2024-4 真题图（邻接多重表：b 度 2 / d 度 4）', run(rt) { rt.setInput('edges', 'A-B\nA-C\nA-D\nB-D\nC-D\nC-E\nD-E'); rt.setInput('view', 'chain'); rt.load(); } },
  ],

  parse(vals) {
    const raw = String(vals.edges || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!raw.length) throw { message: '边列表为空：请每行写一条边，如 A-B（无向）或 A->B（有向）' };

    const edges = [], seen = new Set(), names = new Set();
    let dup = 0, arrowInUndirected = 0, directed = false;
    raw.forEach((line, i) => {
      const m = line.match(/^([A-Za-z0-9]+)\s*(->|→|-|—)\s*([A-Za-z0-9]+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${line}」格式错误：应形如 A-B 或 A->B（两端只能是字母/数字）` };
      const arrow = (m[2] === '->' || m[2] === '→');
      if (arrow) directed = true;
      const a = m[1].toUpperCase(), b = m[3].toUpperCase();
      if (a === b) throw { message: `第 ${i + 1} 行「${line}」是自环：本模块演示简单图，不支持自环` };
      names.add(a); names.add(b);
      const key = arrow ? a + '>' + b : [a, b].sort().join('~');
      if (seen.has(key)) { dup++; return; }
      seen.add(key);
      edges.push({ a, b, arrow });
    });

    /* 有向性由"整份输入里出现过的箭头"统一决定：只要有一条边写了箭头，整图就有向，
     * 其余写了横线的边按有向边处理；arrowInUndirected 记的就是这些"横线边"的条数（恒 ≥ 0）。 */
    edges.forEach(e => { if (e.arrow) arrowInUndirected++; });
    const nodes = [...names].sort();
    const n = nodes.length;
    if (n < 3) throw { message: '顶点数不足：图的存储结构至少要有 3 个顶点才看得出差别' };
    if (n > 6) throw { message: `顶点数 ${n} 过多：演示图请控制在 6 个顶点以内（当前 ${nodes.join('、')}）` };
    const m = edges.length;
    if (!m) throw { message: '去掉重复边后没有可用的边，请检查边列表' };

    const idx = {}; nodes.forEach((v, i) => { idx[v] = i; });

    /* 输入邻接矩阵：有向图 adjM[i][j]=1 ⟺ i→j；无向图两端都置 1（对称） */
    const adjM = nodes.map(() => nodes.map(() => 0));
    edges.forEach(e => {
      const i = idx[e.a], j = idx[e.b];
      adjM[i][j] = 1;
      if (!directed) adjM[j][i] = 1;
    });
    const out = adjM.map(row => row.reduce((s, x) => s + x, 0));
    const indeg = nodes.map((_, j) => adjM.reduce((s, row) => s + row[j], 0));

    const view = ['matrix', 'list', 'chain'].includes(vals.view) ? vals.view : 'matrix';
    const show = ['cur', 'all'].includes(vals.show) ? vals.show : 'cur';
    return { nodes, edges, directed, n, m, adjM, out, indeg, view, show, dup, arrowInUndirected };
  },

  buildSnapshots(model) {
    const { nodes, edges, directed, n, m, adjM, out, indeg, view, show, dup, arrowInUndirected } = model;
    const snaps = [];

    /* ---- 构造中的三份存储（每帧全量拷贝进快照，绝不放引用） ---- */
    const mat = nodes.map(() => nodes.map(() => 0));   // 逐行填出的运行时矩阵
    const adjList = nodes.map(() => []);               // 顶点 i → 出边结点编号列表
    const nodeTab = [];                                // 边结点表（十字链表弧 / 邻接多重表边）
    const used = edges.map(() => false);               // 与 edges 一一对应的"已编号"标记

    /* 顶点的出/入度结点链（边结点编号），仅作展示，真值仍由上面的 adjList 与 I5 校验 */
    const outChain = nodes.map(() => []);
    const inChain = nodes.map(() => []);

    const cloneNode = nd => (nd === null ? null : Object.assign({}, nd));
    const push = (step, o) => snaps.push(Object.assign({
      step,
      mat: mat.map(r => [...r]),
      adjList: adjList.map(l => [...l]),
      nodeTab: nodeTab.map(cloneNode),
      outChain: outChain.map(l => [...l]),
      inChain: inChain.map(l => [...l]),
      /* 顶点结点的三个指针域（I12）：链头 = 头插法留下的"最后一条" ⟹ 渲染端"从顶点表指出去"的箭头照它画 */
      firstOut: outChain.map(l => (l.length ? l[l.length - 1] : -1)),
      firstIn: inChain.map(l => (l.length ? l[l.length - 1] : -1)),
      firstEdge: outChain.map(l => (l.length ? l[l.length - 1] : -1)),
      nodes: [...nodes],
      edges: edges.map(e => ({ a: e.a, b: e.b, arrow: !!e.arrow })),
      directed, n, m, view, show,
      cur: null, curCell: null, lastCell: null, just: [], justRow: -1, justNode: null,
      phase: 'init', fillRow: -1,
      log: '', logType: 'info', desc: '',
    }, o));

    const note = [];
    if (dup) note.push(`已自动去重 ${dup} 条重复边`);
    if (arrowInUndirected) note.push(`${arrowInUndirected} 条"横线边"按有向边处理（整份输入含箭头 ⟹ 判为有向图）`);

    push('init', {
      phase: 'init',
      log: `就绪：${directed ? '有向图' : '无向图'}，${n} 个顶点（${nodes.join('、')}）、${m} 条${directed ? '弧' : '边'}；三种存储都还没有内容。${note.length ? '（' + note.join('；') + '）' : ''}`,
      desc: `就绪：点击「单步执行」开始 —— 按顶点顺序逐行扫描边，同步补出**邻接矩阵 / 邻接表 / ${directed ? '十字链表' : '邻接多重表'}**，每一步都能看到"同一张图"在三种存储里的样子`,
    });

    /* ---- 主循环：i 从 0 到 n−1 逐行扫描；每个 i 内部按 j 升序编号新边 ---- */
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < n; j++) {
        mat[i][j] = adjM[i][j];
        if (adjM[i][j] !== 1) continue;
        row.push(nodes[j]);

        /* 找这条边在 edges 里的下标（无向图两边都能命中），未编号才新建边结点 */
        const k = edges.findIndex(e => {
          const ei = nodes.indexOf(e.a), ej = nodes.indexOf(e.b);
          if (directed) return ei === i && ej === j;
          return (ei === i && ej === j) || (ei === j && ej === i);
        });
        if (k < 0 || used[k]) continue;
        used[k] = true;
        const id = nodeTab.length;

        if (directed) {
          /* 十字链表弧结点：同尾链 tlink / 同头链 hlink —— 取"已存在的上一条"挂在自己前面 */
          const tlink = outChain[i].length ? outChain[i][outChain[i].length - 1] : -1;
          const hlink = inChain[j].length ? inChain[j][inChain[j].length - 1] : -1;
          nodeTab.push({ id, tail: i, head: j, tlink, hlink });
          outChain[i].push(id);
          inChain[j].push(id);
          adjList[i].push(id);
        } else {
          /* 邻接多重表边结点：一条边只存一个结点，两端各自挂上编号
           * ⚠ 端点必须从**这条边的原始定义** edges[k] 取名字再查下标，不能拿 i/j 当端点：
           *   无向图里 (i,j) 与 (j,i) 是同一格，k 命中的那条边的书写方向可能正好相反。 */
          const up = nodes.indexOf(edges[k].a) === i ? i : j;   // 规范化：ivex = 矩阵行号 i
          const vp = up === i ? j : i;
          const ilink = outChain[up].length ? outChain[up][outChain[up].length - 1] : -1;
          const jlink = outChain[vp].length ? outChain[vp][outChain[vp].length - 1] : -1;
          nodeTab.push({ id, ivex: up, jvex: vp, ilink, jlink });
          outChain[up].push(id);
          outChain[vp].push(id);
          adjList[up].push(id);
          adjList[vp].push(id);
        }
      }
      push('row', {
        phase: 'row', fillRow: i, justRow: i,
        cur: nodes[i], just: row,
        curCell: null, lastCell: { i, j: -1 },
        log: `扫描顶点 ${nodes[i]} 的第 ${i} 行：邻点 ${row.length ? row.join('、') : '（无）'} ${row.length ? `⟹ 出度 ${row.length}` : '⟹ 无穷出边'}；${directed ? `入度看第 ${i} 列 = ${indeg[i]}` : `度 = ${out[i]}`}；本行补齐 ${row.length} 条${directed ? '弧' : '边'}的存储`,
        logType: row.length ? 'success' : 'info',
        desc: `第 ${i} 个顶点 ${nodes[i]}：矩阵第 ${i} 行写出 ${row.length} 个 1${row.length ? `（${row.join('、')}）` : ''}；${directed ? `十字链表` : `邻接多重表`}里为这些${directed ? '弧' : '边'}分配了边结点编号`,
      });
    }

    const dirTxt = directed ? '十字链表' : '邻接多重表';
    push('done', {
      phase: 'done',
      log: `完成：邻接矩阵 ${n}×${n} 与三份存储已全部一致；${directed ? `弧结点 ${m} 个` : `边结点 ${m} 个`}（编号 0..${m - 1}）` +
        `${directed ? `；出度 [${out.join(', ')}]、入度 [${indeg.join(', ')}]` : `；各点度 [${out.join(', ')}]、度之和 = 2m = ${2 * m}`}`,
      logType: 'success',
      desc: `同一张图的四种描述已经对齐：邻接矩阵 / 邻接表（出边表） / ${dirTxt} / ${directed ? '逆邻接链（沿 hlink）' : '两条 ilink·jlink 链'}。切换上方"要看的存储结构"可从不同视角复核。`,
    });

    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const nodes = s.nodes || model.nodes;
    const n = s.n, directed = !!s.directed;
    const mat = s.mat || [], adjList = s.adjList || [], nodeTab = s.nodeTab || [];
    const edges = s.edges || [];
    const cur = s.cur, just = s.just || [], justRow = s.justRow;
    const view = s.view || model.view || 'matrix';
    const done = s.step === 'done';
    /* 数度等价式（2024-4 官方解析的数法）：顶点 v 在全部边结点的**两个顶点域**里出现的次数之和 = 它的度
       （邻接多重表每条边只存一个结点；有向图则是"尾巴里出现次数 + 头里出现次数" = 出度 + 入度） */
    const occ = nodes.map((_, i) => nodeTab.reduce((a, nd) => a + (directed
      ? (nd.tail === i ? 1 : 0) + (nd.head === i ? 1 : 0)
      : (nd.ivex === i ? 1 : 0) + (nd.jvex === i ? 1 : 0)), 0));

    /* ---------------- 布局画布 ----------------
       ⚠ 窗40 用户反馈"图太小看不清" ⟹ **链视图 / 邻接表视图单独用更大的画布 760×540**
       （矩阵视图的几何是按 680×460 精算的，不动它）；再让 SVG 最多能显示到 1.35×（`max-width` 见下方模板），
       宽屏上字就实打实地变大（SVG 缩放不糊），窄屏也能靠 `overflow-x-auto` 横滑。 */
    const W = 680, H = 460;
    const gx = 152, gy = 214;
    const R = n <= 4 ? 72 : n <= 5 ? 80 : 88;
    const pos = {};
    nodes.forEach((nm, i) => {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      pos[nm] = { x: +(gx + R * Math.cos(ang)).toFixed(1), y: +(gy + R * Math.sin(ang)).toFixed(1) };
    });
    const VR = n <= 5 ? 20 : 18;

    /* ---------------- 左：图本体（存储结构的"真值"） ----------------
       ⚠ 窗40 支线：**只有矩阵视图画图本体** —— 链视图（十字链表 / 邻接多重表）的新版面要用满整个画布宽度
       （顶点表从 x=20 起、盒排到 664），左下的图本体圆圈会**压在顶点表上**（原分辨率截图实测）；
       而且 2024-4 真题卷面本身也只有"顶点表 + 边结点"，不画图 —— 与卷面对齐，这里就不画了。 */
    const showGraph = (view === 'matrix');
    const gHas = (a, b) => edges.some(e => e.a === a && e.b === b);
    const edgeSvg = !showGraph ? '' : edges.map(e => {
      const p = pos[e.a], q = pos[e.b];
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const sy = p.y + uy * (VR + 4), sx = p.x + ux * (VR + 4);
      const ex = q.x - ux * (VR + 4), ey = q.y - uy * (VR + 4);
      const hi = cur !== null && cur !== undefined && e.a === cur;
      let d;
      if (directed && gHas(e.b, e.a)) {
        const side = e.a < e.b ? 1 : -1;
        const mx = (sx + ex) / 2 - uy * 18 * side, my = (sy + ey) / 2 + ux * 18 * side;
        d = `M${sx},${sy} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex},${ey}`;
      } else {
        d = `M${sx},${sy} L${ex},${ey}`;
      }
      const cls = hi ? 'kedge kedge-just' : 'kedge';
      const mk = directed ? ` marker-end="url(#${hi ? '_gs-arw-hi' : '_gs-arw'})"` : '';
      return `<path d="${d}" class="${cls}" fill="none"${mk}/>`;
    }).join('');

    const nodeSvg = !showGraph ? '' : nodes.map(nm => {
      const p = pos[nm];
      const isCur = cur === nm;
      const fill = isCur ? '#f59e0b' : '#e2e8f0';
      const txt = isCur ? '#ffffff' : '#475569';
      return `${isCur ? `<circle cx="${p.x}" cy="${p.y}" r="${VR + 7}" class="knode-halo" stroke="#f59e0b"/>` : ''}
        <circle cx="${p.x}" cy="${p.y}" r="${VR}" class="knode-circle" fill="${fill}"/>
        <text x="${p.x}" y="${p.y}" dy="0.35em" class="knode-text" style="fill:${txt}">${RC408.util.esc(nm)}</text>`;
    }).join('');

    const gLabel = !showGraph ? '' : `<text x="${gx}" y="${H - 24}" text-anchor="middle" style="font:700 12px inherit" fill="#94a3b8">图本体（${directed ? '有向图' : '无向图'}：${n} 顶点 · ${s.m} 条${directed ? '弧' : '边'}）</text>`;

    /* ---------------- 右：三种存储视图 ---------------- */
    const ACC = ['#4f46e5', '#0891b2', '#c2410c', '#7c3aed', '#0f766e', '#be123c'];
    let rightSvg = '';

    if (view === 'matrix') {
      /* ---- 邻接矩阵：n×n 格 + 行列标题 + 行和(出度) / 列和(入度) 两个边列 ----
       * ⚠ 几何上限（改布局前先读，两个方向各自算清）：
       *   · 横向：x0 = 260，右缘 260 + n*cw ≤ 672 ⟹ cw ≤ 68.7；本式取 min(62, 69.3 − n*1.2)，
       *     n=6 时得 62.1，右缘 632 ✓（右边还要留 26px 写"行和"标题）。
       *   · 纵向：y0 = 96，格子底 96 + n*ch，再往下 28px 是「列和 = 入度」、48px 是底部提示 ⟹
       *     要求 96 + n*ch + 48 ≤ 460 ⟹ **n*ch ≤ 316 ⟹ ch ≤ 316/n**（n=6 时 52.7 = 316/6）。
       *     故 ch 与 cw 分开算：ch = min(cw, 316/n)，绝不写成 ch = cw（窗31 实测 522 > 460 越界）。
       *     ⚠ 窗31 目视截图发现：「列和 = 入度」若与底部提示同一基线（都 +46），居中标签会被
       *     左侧那行长提示文字横向压过去 ⟹ 两者必须错开基线：标签 +28、提示 +48。 */
      const x0 = 260, y0 = 96, labW = 56;
      const cw = Math.min(62, 69.3 - n * 1.2);
      const ch = Math.min(cw, 316 / n);
      const cellSvg = mat.map((row, i) => row.map((v, j) => {
        const x = x0 + j * cw, y = y0 + i * ch;
        const isJust = i === justRow;
        const fill = v ? (isJust ? '#a7f3d0' : '#d1fae5') : (isJust ? '#f8fafc' : '#ffffff');
        const strk = v ? (isJust ? '#059669' : '#6ee7b7') : '#e2e8f0';
        const fg = v ? '#065f46' : '#cbd5e1';
        return `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${fill}" stroke="${strk}" stroke-width="${v ? 1.6 : 1}"/>
          <text x="${x + cw / 2}" y="${y + ch / 2}" dy="0.35em" text-anchor="middle" style="font:${v ? 800 : 600} ${cw >= 56 ? 15 : 13}px Consolas,ui-monospace,monospace" fill="${fg}">${v}</text>`;
      }).join('')).join('');

      const headSvg = nodes.map((nm, j) =>
        `<text x="${x0 + j * cw + cw / 2}" y="${y0 - 14}" text-anchor="middle" style="font:800 13px Consolas,ui-monospace,monospace" fill="${ACC[j % 6]}">${RC408.util.esc(nm)}</text>`).join('');
      const rowSvg = nodes.map((nm, i) => {
        const isJust = i === justRow;
        return `<text x="${x0 - 12}" y="${y0 + i * ch + ch / 2}" dy="0.35em" text-anchor="end" style="font:800 ${isJust ? 15 : 13}px Consolas,ui-monospace,monospace" fill="${isJust ? '#b45309' : ACC[i % 6]}">${RC408.util.esc(nm)}</text>`;
      }).join('');
      /* 有向图在第 i 行右侧标出度、第 j 列下方标入度；无向图只在行右侧标度 */
      const rowSumSvg = nodes.map((nm, i) =>
        `<text x="${x0 + n * cw + 26}" y="${y0 + i * ch + ch / 2}" dy="0.35em" text-anchor="middle" style="font:800 13px Consolas,ui-monospace,monospace" fill="#0f766e">${mat[i].reduce((a, b) => a + b, 0)}</text>`).join('');
      const colSumSvg = directed ? nodes.map((nm, j) =>
        `<text x="${x0 + j * cw + cw / 2}" y="${y0 + n * ch + 24}" text-anchor="middle" style="font:800 13px Consolas,ui-monospace,monospace" fill="#be123c">${mat.reduce((a, r) => a + r[j], 0)}</text>`).join('') : '';

      const x0f = x0 - labW;
      rightSvg = `
        <text x="${x0f}" y="28" style="font:800 13px inherit" fill="#334155">邻接矩阵 A（${n}×${n}）</text>
        <text x="${x0f}" y="46" style="font:600 11px inherit" fill="#94a3b8">A[i][j] = 1 ⟺ ${directed ? '有 i→j 的弧' : 'i 与 j 相邻'}</text>
        ${headSvg}${rowSvg}${cellSvg}${rowSumSvg}${colSumSvg}
        <text x="${x0 + n * cw + 26}" y="${y0 - 16}" text-anchor="middle" style="font:700 11px inherit" fill="#0f766e">行和</text>
        <text x="${x0 + n * cw + 26}" y="${y0 + n * ch + 26}" text-anchor="middle" style="font:700 11px inherit" fill="#0f766e">${directed ? '= 出度' : '= 度'}</text>
        ${directed ? `<text x="${x0 + n * cw / 2}" y="${y0 + n * ch + 28}" text-anchor="middle" style="font:700 11px inherit" fill="#be123c">列和 = 入度</text>` : ''}
        <text x="${x0f}" y="${y0 + n * ch + 48}" style="font:600 11.5px inherit" fill="#64748b">${directed ? '非对称：第 i 行 1 的个数 = 出度，第 j 列 = 入度，度 = 出度 + 入度' : '对称矩阵：A[i][j] = A[j][i]，第 i 行 1 的个数 = 顶点 i 的度'}</text>`;
    } else {
      /* 邻接表 / 十字链表 / 邻接多重表 三种视图统一走新渲染（窗40 支线：文件末尾 _gsChainSvg）；
         旧版「横排 3 个 + 之字形折行」的代码已删（它在 5 个结点的链上会**盒子重叠** —— 旧判据查不出）。 */
      rightSvg = _gsChainSvg(s, W, H, view === 'list' ? 'list' : 'chain', { all: (s.show || model.show) === 'all', maxK: _gsRowCap(model, directed, nodes) });
    }

    const defs = `<defs>
      <marker id="_gs-arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#cbd5e1"/></marker>
      <marker id="_gs-arw-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f59e0b"/></marker>
      <marker id="_gs-arw-v" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7c3aed"/></marker>
      <marker id="_gs-arw-r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#be123c"/></marker>
    </defs>`;

    /* ---------------- 统计卡 ---------------- */
    const filled = mat.reduce((s2, r) => s2 + r.reduce((a, b) => a + b, 0), 0);
    const wholeMat = mat.reduce((s2, r) => s2 + r.filter(v => v === 1).length, 0);
    const fullMat = model.adjM.reduce((s2, r) => s2 + r.reduce((a, b) => a + b, 0), 0);
    const stats =
      RC408.ui.statCard('图的类型', directed ? '有向图' : '无向图',
        directed ? '输入里有 -> ⟹ 判为有向；矩阵一般非对称' : '矩阵关于主对角线对称', 'text-indigo-600') +
      RC408.ui.statCard('邻接矩阵规模', `${n}×${n} = ${n * n} 格`,
        `已填 1 的个数 ${filled} / ${fullMat}（空间恒为 O(n²)）`, 'text-emerald-600') +
      RC408.ui.statCard('边结点数', `${nodeTab.length} / ${s.m}`,
        directed ? '十字链表：每条弧一个结点' : '邻接多重表：每条边一个结点（邻接表要 2m 个）', 'text-amber-600') +
      RC408.ui.statCard(directed ? '出度 / 入度' : '各顶点的度', directed ? `${s.m} / ${s.m}` : `Σ = ${2 * s.m}`,
        directed ? `${model.out.join(' / ')} 与 ${model.indeg.join(' / ')}（行和 / 列和）` : `${model.out.join(' / ')}（行和，Σ = 2m）`, 'text-rose-600');

    /* ---------------- 下方表格：按视图切换 ---------------- */
    let tableHtml = '';
    if (view === 'matrix') {
      const rows = nodes.map((nm, i) => {
        const isJust = i === justRow;
        return `<tr class="${isJust ? 'row-cur' : ''}">
          <td class="font-bold" style="color:${ACC[i % 6]}">${i}</td>
          <td class="font-bold">${RC408.util.esc(nm)}</td>
          <td class="font-mono">${mat[i].map((v) => `<span class="chip ${v ? 'chip-hit' : 'chip-future'}" style="min-width:22px;justify-content:center">${v}</span>`).join('')}</td>
          <td class="font-mono font-bold text-emerald-700">${mat[i].reduce((a, b) => a + b, 0)}</td>
          <td class="font-mono ${directed ? 'font-bold text-rose-700' : 'text-slate-400'}">${directed ? mat.reduce((a, r) => a + r[i], 0) : '—'}</td>
          <td class="font-mono">${mat[i].reduce((a, b) => a + b, 0) * 2}</td>
          <td class="text-[11px] text-slate-500">${isJust ? (just.length ? `本行邻点：${just.join('、')}` : '本行全 0（无出边）') : ''}</td></tr>`;
      }).join('');
      tableHtml = `
        <div>
          ${RC408.ui.sectionTitle('邻接矩阵逐行核对（行和 = ' + (directed ? '出度' : '度') + (directed ? '，列和 = 入度' : '') + '）')}
          <div class="overflow-x-auto"><table class="tbl w-full">
            <thead><tr><th>下标 i</th><th>顶点</th><th>A[i][ ] 逐列</th><th>${directed ? '第 i 行和 = 出度' : '第 i 行和 = 度'}</th><th>${directed ? '第 i 列和 = 入度' : '（无向图无列和）'}</th><th>度（出+入）</th><th>本帧</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <div class="text-[11px] text-slate-400 mt-1">${directed ? '有向图：度 = 出度 + 入度；' : ''}行和为 0 的顶点孤立（本模块不允许这种输入，因为顶点必须出现在某条边里）。矩阵的 1 的个数${directed ? ' = 弧数 m' : ' = 2m（对称，每条边算了两次）'}。</div>
        </div>`;
    } else {
      const rows = nodes.map((nm, i) => {
        const chain = (adjList[i] || []).map(id => {
          const nd = nodeTab[id];
          if (!nd) return '';
          const nb = directed ? nodes[nd.head] : nodes[nd.jvex === i ? nd.ivex : nd.jvex];
          return `<span class="chip ${cur === nm ? 'chip-check' : 'chip-hit'}" title="边结点 #${id}">#${id}→${RC408.util.esc(nb)}</span>`;
        }).join('<span class="text-slate-300"> </span>') || '<span class="chip chip-future">^ 空链</span>';
        const own = (adjList[i] || []).length;
        return `<tr class="${i === justRow ? 'row-cur' : ''}">
          <td class="font-bold" style="color:${ACC[i % 6]}">${i}</td>
          <td class="font-bold">${RC408.util.esc(nm)}</td>
          <td style="text-align:left">${chain}</td>
          <td class="font-mono font-bold text-emerald-700">${own}</td>
          <td class="font-mono ${directed ? 'text-rose-700' : 'text-slate-400'}">${directed ? '<span title="邻接表求入度必须扫全表">O(n+e) 扫描</span>' : '—'}</td>
          <td class="text-[11px] text-slate-500">${directed ? `行和 = ${own}（出度）；入度见矩阵列和` : `度 = ${own}（链长）`}${view === 'chain' ? (directed
            ? `；下标 ${i} 在 tail / head 域里共出现 ${occ[i]} 次（= 出度 + 入度）`
            : `；下标 ${i} 在两个顶点域里出现 ${occ[i]} 次（2024-4 的数法，应与链长相等）`) : ''}</td></tr>`;
      }).join('');
      tableHtml = `
        <div>
          ${RC408.ui.sectionTitle('顶点表 + 边表链（每个边结点给出：编号 · ' + (directed ? '弧头 / tlink' : '两端点 / ilink·jlink') + '）')}
          <div class="overflow-x-auto"><table class="tbl w-full">
            <thead><tr><th>下标</th><th>顶点</th><th>边结点链（本表目的 first 起）</th><th>链长 = ${directed ? '出度' : '度'}</th><th>${directed ? '入度（邻接表）' : '（无向图无入度）'}</th><th>说明</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          ${nodeTab.length ? `
          <div class="mt-3">${RC408.ui.sectionTitle(directed ? '弧结点表（十字链表：同尾链 tlink / 同头链 hlink）' : '边结点表（邻接多重表：ilink / jlink）')}
            <div class="overflow-x-auto"><table class="tbl w-full">
              <thead><tr><th>编号</th><th>${directed ? 'tailvex' : 'ivex'}</th><th>${directed ? 'headvex' : 'jvex'}</th><th>${directed ? 'tlink（同尾）' : 'ilink（依附 ivex）'}</th><th>${directed ? 'hlink（同头）' : 'jlink（依附 jvex）'}</th><th>本帧</th></tr></thead>
              <tbody>${nodeTab.map(nd => `<tr class="${s.justNode && s.justNode.id === nd.id ? 'row-cur' : ''}">
                <td class="font-bold">#${nd.id}</td>
                <td class="font-mono">${nodes[directed ? nd.tail : nd.ivex]}</td>
                <td class="font-mono">${nodes[directed ? nd.head : nd.jvex]}</td>
                <td class="font-mono ${(directed ? nd.tlink : nd.ilink) >= 0 ? 'text-violet-700' : 'text-slate-300'}">${(directed ? nd.tlink : nd.ilink) >= 0 ? '#' + (directed ? nd.tlink : nd.ilink) : '^ NULL'}</td>
                <td class="font-mono ${(directed ? nd.hlink : nd.jlink) >= 0 ? 'text-violet-700' : 'text-slate-300'}">${(directed ? nd.hlink : nd.jlink) >= 0 ? '#' + (directed ? nd.hlink : nd.jlink) : '^ NULL'}</td>
                <td class="text-[11px] text-slate-500">${directed ? `${nodes[nd.tail]}→${nodes[nd.head]}` : `${nodes[nd.ivex]}—${nodes[nd.jvex]}`}</td></tr>`).join('')}</tbody></table></div>
          </div>` : '<div class="text-xs text-slate-400 mt-2">（还没有边结点：逐行扫描时按编号递增创建）</div>'}
        </div>`;
    }

    /* ---------------- 复杂度对照（本模块的核心考点） ---------------- */
    const cmp = `
      <div class="rounded-xl border border-slate-200 bg-white p-3">
        ${RC408.ui.sectionTitle('两种存储的代价对照（选择题判据）')}
        <div class="overflow-x-auto"><table class="tbl w-full">
          <thead><tr><th>操作</th><th>邻接矩阵</th><th>邻接表</th><th>十字链表 / 邻接多重表</th></tr></thead>
          <tbody>
            <tr><td>空间</td><td class="font-mono">O(n²)＝${n}×${n}</td><td class="font-mono">${directed ? `O(n+e)＝${n}+${s.m}` : `O(n+2e)＝${n}+${2 * s.m}`}</td><td class="font-mono">${directed ? `O(n+e)＝${n}+${s.m}` : `O(n+e)＝${n}+${s.m}`}</td></tr>
            <tr><td>判断 i、j 是否相邻</td><td class="font-mono text-emerald-700">O(1) 直接查 A[i][j]</td><td class="font-mono text-rose-700">O(出度) 扫链</td><td class="font-mono text-rose-700">O(出度) 扫链</td></tr>
            <tr><td>求某顶点<b>出度</b></td><td class="font-mono">O(n) 数一行</td><td class="font-mono text-emerald-700">O(出度) 沿链走</td><td class="font-mono text-emerald-700">O(出度)</td></tr>
            <tr><td>求某顶点<b>入度</b>（有向）</td><td class="font-mono">O(n) 数一列</td><td class="font-mono text-rose-700">O(n+e) 必须扫全表</td><td class="font-mono text-emerald-700">O(入度) 沿 hlink 走</td></tr>
            <tr><td>稀疏图 / 稠密图</td><td class="font-mono text-rose-700">稀疏图浪费</td><td class="font-mono text-emerald-700">稀疏图省空间</td><td class="font-mono text-emerald-700">省空间</td></tr>
          </tbody></table></div>
        <div class="text-[11px] text-slate-500 mt-1.5">本图密度：${s.m} / C(${n},2) = ${s.m} / ${n * (n - 1) / 2} ⟹ ${s.m * 2 > n * (n - 1) / 2 ? '偏稠密，矩阵不算浪费' : '偏稀疏，邻接表更省'}${directed ? '；有向图用邻接表求入度必须扫全表 O(n+e)（2026-6）' : ''}。</div>
      </div>`;

    /* ---------------- 结论 ---------------- */
    const dirTxt = directed ? '十字链表' : '邻接多重表';
    const ok = filled === wholeMat && nodeTab.length === s.m;
    const conclusion = `
      <div class="rounded-xl border ${done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'} p-3 text-xs text-slate-600 space-y-1.5">
        <div class="font-bold ${done ? 'text-emerald-700' : 'text-slate-500'}">${done ? '四种描述已对齐（同一张图）' : '当前累计（尚未扫完）'}</div>
        <div>邻接矩阵：<span class="font-mono font-bold text-slate-800">${filled} / ${fullMat}</span> 个 1 已写入　｜　边结点：<span class="font-mono font-bold">${nodeTab.length} / ${s.m}</span> 个已创建　｜　${ok ? '<span class="text-emerald-700">三份存储一致 ✓</span>' : '<span class="text-amber-600">仍在构造中…</span>'}</div>
        <div>${directed ? `出度 [${model.out.join(', ')}]　入度 [${model.indeg.join(', ')}]　Σout = Σin = m = ${s.m}　｜　十字链表：tlink 串出边链、hlink 串入边链，两个方向都 O(出/入度)` : `各点度 [${model.out.join(', ')}]　Σ度 = 2m = ${2 * s.m}　｜　邻接多重表：边结点 ${s.m} 个（邻接表存无向图要 ${2 * s.m} 个）　｜　数度等价式（2024-4 官方解析的数法）：${nodes.map((v, i) => `${v} 的下标出现 ${occ[i]} 次`).join('，')}`}</div>
        <div>${directed ? `度 = 出度 + 入度：${nodes.map((v, i) => `${v}:${model.out[i]}+${model.indeg[i]}=${model.out[i] + model.indeg[i]}`).join('，')}` : `对称矩阵 ⟹ 只看第 i 行 1 的个数就是顶点 i 的度`}</div>
      </div>`;

    /* ---------------- 考点提醒 ---------------- */
    const tips = `
      <div class="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-[11.5px] text-indigo-900 space-y-1">
        <div class="font-bold">考点提醒（对着本图的数字读）</div>
        <div>· <b>有向还是无向看对称性</b>：本图邻接矩阵${directed ? '非对称 ⟹ 有向图，故某点的度要把第 i 行与第 i 列相加（2013-7）' : '对称 ⟹ 无向图，第 i 行 1 的个数就是度数'}。</div>
        <div>· <b>稀疏图选邻接表</b>：空间 O(n+e) 与 O(n²) 的比较 —— 本图 ${n} 个顶点时矩阵要 ${n * n} 格、邻接表只要 ${directed ? `${n}+${s.m}` : `${n}+${2 * s.m}`} 项。</div>
        <div>· <b>邻接表求入度是 O(n+e)</b>（2026-6）：邻接表只存出边，求入度必须扫完全部顶点的链；十字链表的 hlink 链把它降到 O(入度)。</div>
        <div>· <b>${dirTxt}</b>：${directed ? '每个弧结点同时挂在"同尾链 tlink"与"同头链 hlink"上，把邻接表与逆邻接表合二为一' : '每条边只存一个边结点，ilink / jlink 分别串起依附于两端的边链'}${directed ? '；画图时两个指针最容易串错，用上表的编号逐条核对' : '（2024-4）'}。</div>
      </div>`;

    const legendRow = `
      <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-slate-500 border-t border-slate-100 pt-2 mt-1 px-2 justify-center">
        ${RC408.ui.legend('#cbd5e1', directed ? '弧 / 未处理的边' : '边')}
        ${RC408.ui.legend('#d1fae5', '邻接矩阵里已写入的 1')}
        ${RC408.ui.legend('#f59e0b', '本帧扫描的顶点 / 当前顶点那条链的遍历序号')}
        ${RC408.ui.legend('#7c3aed', directed ? 'tlink（同尾链）' : 'ilink（依附 ivex 的链）')}
        ${RC408.ui.legend('#be123c', directed ? 'hlink（同头链）' : 'jlink（依附 jvex 的链）')}
      </div>
      ${(view === 'chain' || view === 'list') ? `<div class="text-[11px] text-slate-500 text-center px-2">${(s.show || model.show) === 'all'
        ? '当前显示全部链指针 —— 把上方「链指针显示」切回"只看当前顶点的链"会更清爽'
        : '当前只画"当前顶点那条链"；其余盒子的链指针值仍写在格子里（正好练 2024-4 那种"数下标求度"），想看全貌就把上方「链指针显示」切成"显示全部链指针"'}</div>` : ''}`;

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">${defs}${edgeSvg}${nodeSvg}${gLabel}${rightSvg}</svg>
          ${legendRow}
        </div>

        ${tableHtml}
        ${cmp}
        ${conclusion}
        ${tips}
      </div>`;
  },
});

/* ============================================================================
 * 链视图（十字链表 / 邻接多重表）重做 —— 窗40 支线，参考 2024-4 真题卷面的画法
 * ============================================================================
 * 卷面长什么样：左边一列**顶点表**（下标 | 顶点名 | 指针域），每行一根箭头指向"第一条依附于它的边"；
 * 右边是**边结点盒**（4 格，照教科书的字段顺序），盒上的链指针画成箭头，链尾画 ^（NULL）。
 *   · 十字链表（有向）：盒 = tailvex | headvex | hlink | tlink；顶点表 = 下标 | 顶点 | firstout | firstin
 *   · 邻接多重表（无向）：盒 = ivex | ilink | jvex | jlink；顶点表 = 下标 | 顶点 | firstedge
 * 本模块的排布：**行 = 矩阵的扫描行**（有向 = tail，无向 = ivex），行内按编号升序从左到右
 *   ⟹ 第 i 帧正在填的就是第 i 行，和单步动画天然对齐（I10）。
 * 链的走向见 I8（tlink/hlink 头插法，"新的在前"）与 I9（多重表按"当前顶点是 ivex 还是 jvex"选 ilink/jlink）
 *   ⟹ 行内的两条链画**下弯弧**、跨行的画"下潜—横走—上钻"的**正交折线**，顶点表那根箭头走左侧竖通道。
 * 几何上限（§3.8-17⑦，改布局前先读）：简单图 n ≤ 6 ⟹ 一行最多 n−1 = 5 个盒；
 *   盒宽 88 = 4×22、行高 rh = min(58, (H−top0−bottom)/n)；顶点表宽 有向 104 / 无向 78
 *   ⟹ 5 个盒占 5×88 + 4×8 = 472，可用宽 ≥ 522（n=6 时有向）✓；函数开头还有一条**越界守卫**。
 * ========================================================================== */

/* 沿链走一遍（I8 / I9）：kind = 'out'（沿 tlink）、'in'（沿 hlink）、'e'（多重表：按角色选 ilink/jlink）
   守卫 = 2n + 6 ≥ 合法输入上界（一条链最长 n−1，§3.8-17⑦）——守卫一旦触发就说明链里有环 */
function _gsWalk(s, v, kind) {
  const tab = s.nodeTab || [], n = s.n || 0;
  const first = kind === 'out' ? (s.firstOut || [])[v]
    : kind === 'in' ? (s.firstIn || [])[v] : (s.firstEdge || [])[v];
  const out = [];
  let cur = first, guard = 2 * n + 6;
  while (cur !== undefined && cur >= 0 && guard-- > 0) {
    const nd = tab[cur];
    if (!nd) break;
    out.push({ id: cur, link: kind === 'e' ? (nd.ivex === v ? 'ilink' : 'jlink') : (kind === 'out' ? 'tlink' : 'hlink') });
    cur = kind === 'out' ? nd.tlink : kind === 'in' ? nd.hlink : (nd.ivex === v ? nd.ilink : nd.jlink);
  }
  return out;
}

/* 一行最多要放几个盒子（**从模型现算、与帧无关** ⟹ 盒子的 x 位置在整段动画里稳定，不会跳）：
   · 有向：行 = 弧尾 ⟹ 就是最大出度；
   · 无向：行 = ivex ⟹ 建表时"每条边记在较小下标那一行"（`buildSnapshots` 里 ivex = 当前扫描行 i）
     ⟹ 行 i 的盒子数 = #{ j > i : A[i][j] = 1 }。
   ⚠ 别拿"最大度"当行宽：无向图里大度顶点的边大多记在别人那一行，按度预留会把盒子白白压小（窗40 实测：2024-4 那张
   最大度 = 4、而真正的满行只有 3 个盒 ⟹ 白压掉 3px 格宽、间距少 20px）。 */
function _gsRowCap(model, directed, nodes) {
  let best = 1;
  if (directed) {
    (model.out || []).forEach(v => { if (v > best) best = v; });
  } else {
    (model.adjM || []).forEach((row, i) => {
      let c = 0;
      for (let j = i + 1; j < row.length; j++) if (row[j] === 1) c++;
      if (c > best) best = c;
    });
  }
  return best;
}

function _gsChainSvg(s, W, H, mode, opt) {
  opt = opt || {};
  const showAll = !!opt.all;                       /* false（默认）⟹ 只画当前顶点那条链，其余指针只留格子里的数字 */
  const isList = mode === 'list';                  /* 'list' = 邻接表（2 格盒）；否则 = 十字链表 / 邻接多重表（4 格盒） */
  const nodes = s.nodes || [], n = s.n, directed = !!s.directed;
  const tab = s.nodeTab || [];
  const esc = RC408.util.esc;
  const ACC = ['#4f46e5', '#0891b2', '#c2410c', '#7c3aed', '#0f766e', '#be123c'];
  const VIOLET = '#7c3aed', ROSE = '#be123c', NULLC = '#cbd5e1', FAINT = '#cbd5e1';
  const MONO = 'Consolas,ui-monospace,monospace';
  const cur = (s.fillRow === undefined || s.fillRow === null) ? -1 : s.fillRow;
  const p = [];

  /* ---------------- 几何（窗40：盒子与字**按数据自适应放大**）
     合法输入上界：简单图 ⟹ 一行最多 n−1 = 5 个盒；本模块 n ≤ 6 ⟹ 用**模型里的最大度**决定每行要放几个，
     再用剩下的宽度反算格宽 `cw` 与**盒间距 `gapX`**。
     ⚠ **窗40 第二次修正（用户第二轮反馈："整体过大、要的是把节点间距放宽"）**：
     · 画布**收回 680×460**（去掉 1.35× 的放大），所以字不再无限变大；
     · **间距优先**：先按"每行最多 maxK 个盒、至少留 gapMin=22px 缝"定出 cw，再把**剩下的横向空间全给 gapX**（上限 44px）
       ⟹ 稀疏行（常见情形）间距能到 40+ px，密排行（n=6 满行）也保证 ≥22px，不会再挤成一坨；
     · 竖向上限：盒高必须让行间留出 ≥22px（行内链的弧就画在那条缝里）⟹ `cw ≤ ((bottom−top0)/n − 22) / 1.7`。 */
  const maxK = Math.max(1, Math.min(n - 1, (opt.maxK || opt.maxDeg || n - 1)));
  const vCell = directed ? [26, 42, 26, 26] : [26, 42, 28];
  const vw = vCell.reduce((a, b) => a + b, 0);
  const xv = 16, xe0 = xv + vw + 20;
  const cap = W - 14 - xe0;
  const top0 = 92, bottom = H - 26;
  const gapMin = 22, gapMax = 44;
  const cwFit = Math.floor((cap - (maxK - 1) * gapMin) / maxK / 4);
  const cwVert = Math.floor(((bottom - top0) / n - 22) / 1.7);
  const cw = Math.max(18, Math.min(30, cwFit, cwVert));
  const boxW = 4 * cw, boxH = Math.round(cw * 1.7);
  const gapX = Math.max(14, Math.min(gapMax, maxK > 1 ? Math.floor((cap - maxK * boxW) / (maxK - 1)) : gapMax));
  const rh = Math.min(boxH + 34, (bottom - top0) / n);
  const rowTop = i => top0 + i * rh;
  const colX = k => xe0 + k * (boxW + gapX);
  const eTop = i => rowTop(i) + (rh - boxH) / 2 - 4;
  const vTop = i => rowTop(i) + (rh - 48) / 2;
  const cellX = ci => xv + vCell.slice(0, ci).reduce((a, b) => a + b, 0);
  const fsVal = Math.round(cw * 0.56), fsBox = Math.round(cw * 0.36) + 4;
  if (maxK * boxW + Math.max(0, maxK - 1) * gapX > cap + 0.5) {
    return '<text x="20" y="120" style="font:700 12px inherit" fill="#be123c">几何守卫：一行放不下 ' + maxK + ' 个边结点盒（n=' + n + '）</text>';
  }

  /* ---------------- 行分组 ---------------- */
  const rows = nodes.map(() => []);
  tab.forEach(nd => { const r = directed ? nd.tail : nd.ivex; if (rows[r]) rows[r].push(nd.id); });
  rows.forEach(l => l.sort((a, b) => a - b));
  const pos = {};
  rows.forEach((list, i) => list.forEach((id, k) => { pos[id] = { x: colX(k), i, k }; }));

  /* ---------------- 两行标题 ---------------- */
  /* ---------------- 标题（三行，每行都短 —— §3.3-21：长文案必须按最长的量一遍，估宽断言在冒烟里） ---------------- */
  p.push('<text x="' + xv + '" y="40" style="font:800 16px inherit" fill="#334155">' + (isList
    ? (directed ? '邻接表（出边表）· 盒 = 邻接点 | next（沿 tlink 串成出边链）' : '邻接表视角 · 盒 = 另一端点 | next（沿 ivex 侧链）')
    : (directed ? '十字链表 · 盒 = tailvex | headvex | hlink | tlink' : '邻接多重表 · 盒 = ivex | ilink | jvex | jlink')) + '</text>');
  p.push('<text x="' + xv + '" y="60" style="font:600 12px inherit" fill="#94a3b8">顶点表：下标 | 顶点 | ' +
    (directed ? (isList ? 'first' : 'firstout / firstin') : 'firstedge') + '</text>');
  p.push('<text x="' + xv + '" y="78" style="font:600 12px inherit" fill="#94a3b8">' +
    (isList ? '盒 2 格 = 邻接点 + next' : '盒 4 格照教科书写法') + '　｜　数字 = 指针指向的编号（^ = NULL）</text>');

  /* ---------------- 当前顶点那条链（给盒子挂遍历序号） ----------------
     ⚠ 末帧（done）的 `fillRow` 是 -1（"全填完了"），可**最常被看的就是末帧** ⟹ 这时改用最后一个顶点
     来展示"沿链数度"，但**不**给那一行加琥珀高亮（与矩阵视图的末帧观感保持一致）。 */
  const walkFrom = cur >= 0 ? cur : n - 1;
  const walk = walkFrom >= 0 ? _gsWalk(s, walkFrom, directed ? 'out' : 'e') : [];
  const walkNo = {};
  walk.forEach((w, k) => { walkNo[w.id] = k + 1; });

  /* ---------------- 连线工具：行内下弯弧 / 跨行正交折线 ---------------- */
  const wire = (sx, sy, tx, ty, sameRow, stagger) => {
    if (sameRow) {
      return 'M' + sx + ',' + sy + ' Q' + ((sx + tx) / 2).toFixed(1) + ',' + (Math.max(sy, ty) + 20 + stagger).toFixed(1) + ' ' + tx + ',' + ty;
    }
    const mid = (sy + ty) / 2 + (ty > sy ? -stagger : stagger);
    return 'M' + sx + ',' + sy + ' V' + mid.toFixed(1) + ' H' + tx + ' V' + ty;
  };
  const ptrMark = isViolet => 'url(#_gs-arw-' + (isViolet ? 'v' : 'r') + ')';

  /* ---------------- 顶点表（下标 | 顶点 | 指针域） ---------------- */
  nodes.forEach((nm, i) => {
    const y = vTop(i), hi = i === cur;
    p.push('<rect x="' + xv + '" y="' + y + '" width="' + vw + '" height="48" rx="7" fill="' + (hi ? '#fffbeb' : '#ffffff') +
      '" stroke="' + (hi ? '#f59e0b' : '#cbd5e1') + '" stroke-width="' + (hi ? 2.2 : 1.3) + '"/>');
    for (let ci = 1; ci < vCell.length; ci++) {
      p.push('<line x1="' + cellX(ci) + '" y1="' + y + '" x2="' + cellX(ci) + '" y2="' + (y + 48) + '" stroke="' + (hi ? '#fcd34d' : '#e2e8f0') + '" stroke-width="1"/>');
    }
    p.push('<text x="' + (cellX(0) + vCell[0] / 2) + '" y="' + (y + 24) + '" dy="0.35em" text-anchor="middle" style="font:700 13px ' + MONO + '" fill="#94a3b8">' + i + '</text>');
    p.push('<text x="' + (cellX(1) + vCell[1] / 2) + '" y="' + (y + 24) + '" dy="0.35em" text-anchor="middle" style="font:800 18px ' + MONO + '" fill="' + ACC[i % 6] + '">' + esc(nm) + '</text>');
    const ptrs = directed
      ? [{ ci: 2, v: (s.firstOut || [])[i], col: VIOLET }, { ci: 3, v: (s.firstIn || [])[i], col: ROSE }]
      : [{ ci: 2, v: (s.firstEdge || [])[i], col: VIOLET }];
    ptrs.forEach(pt => {
      const by = y + 24, bxEnd = cellX(pt.ci) + vCell[pt.ci];
      const t = (pt.v === undefined || pt.v === null || pt.v < 0) ? -1 : pt.v;
      p.push('<text x="' + (cellX(pt.ci) + vCell[pt.ci] / 2) + '" y="' + by + '" dy="0.35em" text-anchor="middle" style="font:700 ' + (fsVal - 2) + 'px ' + MONO + '" fill="' +
        (t < 0 ? NULLC : pt.col) + '">' + (t < 0 ? '^' : t) + '</text>');
      /* 默认只画**当前顶点**那根箭头（用户反馈"箭头太密"）；其余行的指针值仍在格子里 */
      if (!showAll && i !== walkFrom) {
        if (t < 0) {
          p.push('<line x1="' + bxEnd + '" y1="' + by + '" x2="' + (bxEnd + 10) + '" y2="' + by + '" stroke="#e2e8f0" stroke-width="1.4"/>' +
            '<text x="' + (bxEnd + 17) + '" y="' + by + '" dy="0.35em" text-anchor="middle" style="font:800 ' + (fsVal - 1) + 'px ' + MONO + '" fill="' + NULLC + '">^</text>');
        }
        return;
      }
      if (t < 0) {
        p.push('<line x1="' + bxEnd + '" y1="' + by + '" x2="' + (bxEnd + 12) + '" y2="' + by + '" stroke="#e2e8f0" stroke-width="1.4"/>' +
          '<text x="' + (bxEnd + 19) + '" y="' + by + '" dy="0.35em" text-anchor="middle" style="font:800 ' + (fsVal - 1) + 'px ' + MONO + '" fill="' + NULLC + '">^</text>');
        return;
      }
      const tp = pos[t];
      if (!tp) return;
      const lane = xe0 - 9 - (i % 3) * 6, ty = eTop(tp.i) + boxH / 2;
      const isCurPt = (i === walkFrom);
      p.push('<path d="M' + bxEnd + ',' + by + ' H' + lane + ' V' + ty.toFixed(1) + ' H' + (tp.x - 4) + '" fill="none" stroke="' +
        (isCurPt ? pt.col : FAINT) + '" stroke-width="' + (isCurPt ? 2.4 : 1.2) + '"' + (isCurPt ? '' : ' stroke-opacity="0.8"') +
        ' marker-end="' + ptrMark(pt.col === VIOLET) + '"/>');
    });
  });

  /* ---------------- 边结点盒 + 链指针 ----------------
     默认（showAll = false）**只画当前顶点那条链**：链上每一跳用彩色粗线 + 遍历序号，
     其余盒子的链指针**只把值写在格子里**（数字 / ^ 一个不少）—— 这正是 2024-4"数下标求度"要练的读法。
     切到"显示全部链指针"时全画，但非链上的线一律浅灰细线，避免一屏十几根彩线糊成一团。 */
  const chainLink = {};                            /* 边结点 id → 当前链从它出发用的那个链域名 */
  walk.forEach(w => { chainLink[w.id] = w.link; });
  tab.forEach(nd => {
    const q = pos[nd.id];
    if (!q) return;
    const x = q.x, y = eTop(q.i), hi = q.i === cur;
    const st = hi ? '#f59e0b' : '#cbd5e1', bg = hi ? '#fffbeb' : '#f8fafc';
    const cells = isList
      ? (directed ? [nd.head, nd.tlink] : [nd.jvex, nd.ilink])
      : (directed ? [nd.tail, nd.head, nd.hlink, nd.tlink] : [nd.ivex, nd.ilink, nd.jvex, nd.jlink]);
    const fieldOf = c => (isList ? 'tlink' : (directed ? (c === 2 ? 'hlink' : 'tlink') : (c === 1 ? 'ilink' : 'jlink')));
    const isVioletCell = c => (isList ? c === 1 : (directed ? c === 3 : c === 1));   // tlink / ilink / next = 紫
    const isLinkCell = c => (isList ? c === 1 : (directed ? (c === 2 || c === 3) : (c === 1 || c === 3)));
    const onWalk = walkNo[nd.id] !== undefined;
    p.push('<rect x="' + x + '" y="' + y + '" width="' + boxW + '" height="' + boxH + '" rx="5" fill="' + bg + '" stroke="' +
      (onWalk ? '#7c3aed' : st) + '" stroke-width="' + (onWalk ? 2.6 : (hi ? 2 : 1.2)) + '"/>');
    const cwd = boxW / cells.length;
    for (let c = 1; c < cells.length; c++) p.push('<line x1="' + (x + c * cwd) + '" y1="' + y + '" x2="' + (x + c * cwd) + '" y2="' + (y + boxH) + '" stroke="' + st + '" stroke-width="1"/>');
    p.push('<text x="' + (x + boxW / 2) + '" y="' + (y - 5) + '" text-anchor="middle" style="font:800 ' + fsBox + 'px ' + MONO + '" fill="' + (hi ? '#b45309' : '#94a3b8') + '">#' + nd.id + '</text>');
    cells.forEach((val, c) => {
      const isLink = isLinkCell(c);
      const vt = (val === undefined || val === null) ? -1 : val;
      const col = isLink ? (isVioletCell(c) ? VIOLET : ROSE) : '#0f172a';
      const cxx = x + c * cwd + cwd / 2;
      p.push('<text x="' + cxx + '" y="' + (y + boxH / 2) + '" dy="0.35em" text-anchor="middle" style="font:' +
        (isLink ? 700 : 800) + ' ' + ((isLink && vt < 0) ? fsVal - 2 : fsVal + 1) + 'px ' + MONO + '" fill="' + ((isLink && vt < 0) ? NULLC : col) + '">' +
        ((isLink && vt < 0) ? '^' : String(vt)) + '</text>');
      if (isLink && vt >= 0) {
        const onChain = (chainLink[nd.id] === fieldOf(c));
        if (!showAll && !onChain) return;                 /* 默认：非链上的指针不画线，值已在格子里 */
        const tp = pos[vt];
        if (!tp) return;
        const same = tp.i === q.i;
        const sx = cxx, tx = tp.x + c * cwd + cwd / 2;
        const sy = same ? y + boxH : (tp.i > q.i ? y + boxH : y);
        /* 行内链（头插法 ⟹ 目标总在左边）画"从下沿出、从下沿进"的下弯弧：整条弧都留在行间空隙里，
           不会横穿盒子；跨行链才用"下潜—横走—上钻"的正交折线。 */
        const ty = same ? eTop(tp.i) + boxH : (tp.i > q.i ? eTop(tp.i) : eTop(tp.i) + boxH);
        const stag = ((nd.id + c) % 3) * 6;
        p.push('<path d="' + wire(sx, sy, tx, ty, same, stag) + '" fill="none" stroke="' + (onChain ? col : FAINT) +
          '" stroke-width="' + (onChain ? 2.4 : 1.2) + '"' + (onChain ? '' : ' stroke-opacity="0.75"') +
          ' marker-end="' + ptrMark(isVioletCell(c)) + '"/>');
      }
    });
    if (onWalk) {
      /* 遍历序号画在盒子**左下角**（右上角留给 #编号 标签，避免压字） */
      const br = Math.max(9, Math.round(cw * 0.36));
      p.push('<circle cx="' + (x + br + 1) + '" cy="' + (y + boxH - br - 1) + '" r="' + br + '" fill="#f59e0b"/>' +
        '<text x="' + (x + br + 1) + '" y="' + (y + boxH - br - 1) + '" dy="0.35em" text-anchor="middle" style="font:800 ' + (fsVal - 2) + 'px ' + MONO + '" fill="#ffffff">' + walkNo[nd.id] + '</text>');
    }
  });

  return p.join('');
}
