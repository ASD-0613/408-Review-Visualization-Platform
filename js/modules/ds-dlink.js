'use strict';
/* ============================================================================
 * ds-dlink.js —— 【数据结构】双链表与循环链表（窗33 新增）
 * ----------------------------------------------------------------------------
 * 前缀：_dl（顶层函数 / 常量都带前缀，避免经典 script 全局污染，见 handover §3.1-3）
 *
 * ── 数据模型与不变量（先钉死再写实现，handover §3.9 P2）──────────────────────
 * 结点池 pool：下标即 id，**一旦建立终生不变**（动画、断言、日志全靠它对齐）
 *   结点 = { id, val, prev, next, isHead }
 *     · val     数据域；头结点用 null 占位（渲染成「头」）
 *     · next    后继的**结点下标**；_dlNULL(−1) = ∧ NULL
 *     · prev    前驱的**结点下标**；单向（单循环链表）模式下恒为 _dlNULL（画面上不画 prior 槽）
 *     · isHead  是否头结点（恒为 id 0 —— 本模块四道题**全部带头结点**）
 *   头指针 headIdx：指向头结点（本模块恒有头结点 ⟹ 永不为 NULL）
 *   尾指针 tailIdx：线性表 = 最后一个数据结点（空表 = 头结点）；循环表 = 尾结点（空表 = 头结点）
 *   链 chain：从 headIdx 沿 next 走出的下标序列（**含头结点**；循环表在回到 headIdx 时停止）。
 *             派生量，快照里也带上 —— 渲染与断言都不必自己再走一遍。
 *   悬空 floating：已摘下、尚未接回的结点（双向插入的 s 在前三条语句期间）
 *   已释放 freed：已 free 的结点（保留在画面上以说明"释放了什么"）
 *
 * 不变量（冒烟脚本逐类断言，见 §3.8-1）：
 *   ① 任何一帧：chain 无重复下标、headIdx 可达、每个 next/prev ∈ {−1} ∪ 池下标；
 *   ② **双向**表里 prev 必须是 next 的逆（next 指到 w ⟹ 若 w 在链上则 w.prev 指回该结点），
 *      **唯一例外**是模式④ `p2fix`——它演示的正是"故意把 prior 改坏"，该模式下改写成
 *      `prev = (next===NULL ? NULL : next.next)`（冒烟里按这条口径逐帧重算）；
 *   ③ 反向一致性只在**稳定帧**（init / done）检查：中途帧本来就不一致（如 ddelete 只改了一条指针）；
 *   ④ chain ∪ floating ∪ freed 两两不相交，且并集 = 已分配的结点池；
 *   ⑤ 稳定帧里 floating **必须为空**；⑥ 稳定帧的数据序列 = 该操作应得的结果（与独立参考实现比对）。
 *
 * ── 快照全量携带（§1.3 铁律：回退 / 跳帧才不出错）────────────────────────────
 *   step      init | move | found | s1..s4 | unl1 | unl2 | chk | setp2 | forward
 *             | test | free | keep | done
 *   nodes     结点池深拷贝 [{id,val,prev,next,isHead}]
 *   headIdx / tailIdx / chain / len           本帧的链状态（全量）
 *   p / q / t 游标（t = 尾指针）；null = 本帧不显示，−1 = 指向头结点本身
 *   newIdx    本帧新建的结点（无则 −1）
 *   newLink   {from,to,which:'prev'|'next'} 本帧**新建 / 改写后**的指针
 *   brokeLink {from,to,which} 本帧**被改掉的旧值**（渲染成红色虚线 + ✂）
 *   moves / visits / delCount / done   累计统计
 *
 * ── 口径（408 / 严蔚敏教材，经 2016-2、2021-1、2026-2 三道真题印证）──────────
 *   双向链表插入（在 p 之后插入 s）四条语句，**顺序不能反**：
 *     s->prior = p;  s->next = p->next;  p->next->prior = s;  p->next = s;
 *     先把 p->next 改掉（第④条提前）⟹ p 原来的后继再也找不到，第②③条无从下手。
 *   双向链表删除（删 p 所指结点）两条语句，**一条都不能少**：
 *     p->prior->next = p->next;  p->next->prior = p->prior;  free(p);
 *     两条读的都是 p 自己的两个指针、互不干扰 ⟹ 可以互换；但少了任何一条都会留下
 *     一条**反向野指针**（指向已 free 的结点）。
 *   线性 vs 循环的差别：循环表里 p->next 永不为 NULL（第②③条总成立）；线性表删尾结点时
 *     `p->next->prior` 会解引用 NULL，必须补 `if (p->next)` 判断。
 *   单循环链表删首元（2021-1）：q = h->next;  h->next = q->next;  if (p == q) p = h;  free(q);
 *     ★ **只有删的是尾结点（表里只剩一个数据结点）时才要动尾指针**，条件写成 if (p != q) 就反了。
 *   2026-2 的 p2 改写：while (cu != null) { if (cu->p1 != null) cu->p2 = cu->p1->p1; else cu->p2 = null;
 *     cu = cu->p1; } —— 本题结构 [p2,d,p1] 里 p1 = next、p2 = prior。它把 prior 改成"next 的直接后继"，
 *     **故意破坏了双向链表的前驱链**；考点是**判空位置**与"前进必须走 p1（p2 正在被改写）"。
 *
 * ── 可查询类名（不配 CSS，只为 harness 断言 / 截图定位；§4.6 窗4 立、窗26 沿用）──
 *   dl-node / dl-head / dl-new / dl-val     结点盒（头结点、本帧新结点）
 *   dl-floating / dl-freed                  悬空 / 已释放的结点盒
 *   dl-arrow / dl-arrow-new / dl-prev / dl-next / dl-head-arrow   各类指针箭头
 *   dl-wrap                                 循环回绕的连线（顶 / 底通道）
 *   dl-null / dl-null-prev / dl-null-next   末结点的 ∧ NULL 标记（prior 槽与 next 槽各带一个专用类，供断言区分）
 *   dl-cut                                  被改掉的旧指针（红色虚线 + ✂）
 *   dl-newlink                              单独画出的新指针（悬空结点 ↔ 链上结点）
 *   dl-ptr-p / dl-ptr-q / dl-ptr-t          p / q / 尾 指针标签
 *   dl-lane                                 模式④「改写后的 prior」专用通道线
 *   dl-stmt / dl-tbl / dl-cost / dl-prog    四条语句 / 结点一览 / 代价对照 / 模式④进度
 * ========================================================================== */

/* ------------------------------ 布局常量（坐标一律由 k 算出，不手写） ------------------------------ */
const _dlPW  = 22;    // 一个指针槽宽（prior 槽 / next 槽）
const _dlDW  = 46;    // 数据域宽
const _dlNH  = 36;    // 结点盒高
const _dlGAP = 46;    // 相邻结点盒的水平间隙（放上下两条箭头）
const _dlX0  = 84;    // 链上第 0 个结点盒左边 x（左侧留给 head 标签与回绕通道）
const _dlTOP = 78;    // 结点行顶边 y（上方放 p / q 徽标与顶回绕通道）
const _dlNW  = _dlPW * 2 + _dlDW;   // 90：双向结点盒（prior | data | next）
const _dlSNW = _dlPW + _dlDW;       // 68：单循环链表结点盒（data | next，无 prior 槽）
const _dlNULL = -1;   // 哨兵：∧ NULL

/* ------------------------------ 纯几何 / 纯工具（_dl 前缀） ------------------------------ */

/** 从 headIdx 沿 next 走出的链（含头结点）；带 visited 保护，循环表也能安全停下 */
function _dlChain(nodes, headIdx) {
  const out = [], seen = {};
  let cur = headIdx;
  while (cur !== _dlNULL && cur !== null && cur !== undefined && cur >= 0 && !seen[cur]) {
    seen[cur] = true;
    out.push(cur);
    cur = nodes[cur] ? nodes[cur].next : _dlNULL;
  }
  return out;
}

/** 链上数据结点个数（头结点不计） */
function _dlLen(nodes, chain) {
  let c = 0;
  for (let i = 0; i < chain.length; i++) if (!nodes[chain[i]].isHead) c++;
  return c;
}

/** 数据序列文本，如 "5 → 9 → 12"（供 desc / 日志；空表给「（空表）」） */
function _dlSeqText(nodes, chain) {
  const vals = [];
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    if (!nodes[id].isHead) vals.push(String(nodes[id].val));
  }
  return vals.length ? vals.join(' → ') : '（空表）';
}

/** 链上名次 k 的结点盒左边 x */
function _dlXOf(nw, k) { return _dlX0 + k * (nw + _dlGAP); }

/** 画布几何。纵向分带（自上而下，互不压盖，见 §3.8-18）：
 *    topChan  = TOP−40   顶通道：循环表「尾 → 头结点」的回绕连线走这里
 *    TOP      = 78       结点盒顶边；p / q 徽标占 [TOP−26, TOP−6]（分列盒左右两端，中间空出来给回绕箭头）
 *    nextY    = cy−9     相邻结点之间的 **next** 直连（间隙上半）
 *    prevY    = cy+9     相邻结点之间的 **prev** 直连（间隙下半）
 *    尾徽标   = [TOP+42, TOP+62]
 *    botChan  = TOP+76   底通道：循环表「头结点 → 尾」的回绕连线走这里
 *    laneY(i) = TOP+60+13i  模式④「改写后的 prior」专用通道（每个结点一条，互不重合）
 *    chanG / chanR        悬空结点 ↔ 链上结点之间的**绿色新指针** / **红色断链幽灵**各占一条水平通道
 *    detLabelY / detY     悬空 / 已 free 那一行的说明文字与盒子
 *  这样"徽标 / 直连 / 通道 / 悬空行"五类图元的 y 区间两两不交 ⟹ 不会出现
 *  窗28 那种"线穿过徽标或说明文字"的相对位置缺陷。
 *  ⚠ **窗33 原分辨率目视实测**：绿线与红线**合用一条通道**时，两条折线在重叠区间上会
 *    "红绿相间"地互相穿，且两个标签的 x 公式都锚在源端 ⟹ ✂ 与"改 prior"几个像素内重叠。
 *    修法 = 两条通道**上下分开**（chanR = chanG + 18）、绿标签抬到线**上方** 9px、
 *    悬空行说明文字改成**短标签**（长文字会被"悬空盒 → 通道"的那段竖线穿过）。 */
function _dlGeom(nw, nChain, nDet, circ, nLanes) {
  const step = nw + _dlGAP;
  const W = Math.max(_dlX0 + Math.max(nChain, 1) * step + 44, 560);
  const cy = _dlTOP + _dlNH / 2;
  const baseBadge = _dlTOP + _dlNH + 30;          // 尾徽标下沿（+8 余量）
  const botChan = circ ? (_dlTOP + _dlNH + 40) : 0;
  const laneY = function (i) { return _dlTOP + _dlNH + 24 + i * 13; };
  const laneBottom = nLanes ? laneY(nLanes - 1) : 0;
  const base = Math.max(baseBadge, botChan, laneBottom);
  const chanG = base + 26;                        // 绿色：本帧新建 / 改写的指针
  const chanR = base + 44;                        // 红色：被改掉的旧指针（单独一条，避免与绿线互穿）
  const detLabelY = base + 68;
  const detY = base + 92;
  const H = nDet ? (detY + _dlNH + 46) : (chanR + 18);
  return {
    W: W, H: H, cy: cy, nextY: cy - 9, prevY: cy + 9,
    topChan: _dlTOP - 40, botChan: circ ? botChan : null,
    chanG: chanG, chanR: chanR,
    detLabelY: detLabelY, detY: detY, step: step, laneY: laneY,
    xOf: function (k) { return _dlXOf(nw, k); },
  };
}

/** 结点盒配色：本帧新结点（绿）> 待删（红）> q（琥珀）> p / 尾（靛）> 头结点（灰）> 普通 */
function _dlCell(s, id) {
  if (id === s.newIdx) return { f: '#ecfdf5', t: '#065f46', st: '#10b981' };
  if ((s.op === 'ddelete' || s.op === 'singcirc') && s.step !== 'init' && id === s.doom) return { f: '#fef2f2', t: '#991b1b', st: '#ef4444' };
  if (id === s.q) return { f: '#fffbeb', t: '#92400e', st: '#f59e0b' };
  if (id === s.p || id === s.t) return { f: '#eef2ff', t: '#3730a3', st: '#6366f1' };
  if (s.nodes[id] && s.nodes[id].isHead) return { f: '#f1f5f9', t: '#475569', st: '#94a3b8' };
  return { f: '#ffffff', t: '#334155', st: '#cbd5e1' };
}

/** 结点盒：可切「prior|data|next」（双向）与「data|next」（单循环链表）。
 *  marks = { prev:'#色', next:'#色' } 用来把某个指针槽的圆点染成"本帧刚改写"的颜色。 */
function _dlBox(x, y, nd, col, cls, dbl, marks) {
  const W = dbl ? _dlNW : _dlSNW;
  const dx = dbl ? _dlPW : 0;
  const mk = marks || {};
  let s = '<g class="' + cls + '" transform="translate(' + x + ',' + y + ')">'
    + '<rect x="0" y="0" width="' + W + '" height="' + _dlNH + '" rx="8" fill="' + col.f
    + '" stroke="' + col.st + '" stroke-width="2.2"' + (col.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
  if (dbl) {
    s += '<line x1="' + _dlPW + '" y1="1.5" x2="' + _dlPW + '" y2="' + (_dlNH - 1.5)
      + '" stroke="' + col.st + '" stroke-width="1.6" opacity="0.7"/>';
  }
  s += '<line x1="' + (dx + _dlDW) + '" y1="1.5" x2="' + (dx + _dlDW) + '" y2="' + (_dlNH - 1.5)
    + '" stroke="' + col.st + '" stroke-width="1.6" opacity="0.7"/>'
    + '<text x="' + (dx + _dlDW / 2) + '" y="' + (_dlNH / 2) + '" dy="0.35em" text-anchor="middle" class="dl-val"'
    + ' style="font:800 13px Consolas,ui-monospace,monospace;fill:' + col.t + '">'
    + RC408.util.esc(nd.isHead ? '头' : String(nd.val)) + '</text>';
  /* next 槽的圆点（实心 = 有后继，空心 = ∧） */
  const nColor = mk.next || col.st;
  s += '<circle cx="' + (dx + _dlDW + _dlPW / 2) + '" cy="' + (_dlNH / 2) + '" r="2.7" fill="'
    + (nd.next !== _dlNULL ? nColor : 'none') + '" stroke="' + nColor + '" stroke-width="1.4"/>';
  /* prior 槽的圆点（只画在双向盒上） */
  if (dbl) {
    const pColor = mk.prev || col.st;
    s += '<circle cx="' + (_dlPW / 2) + '" cy="' + (_dlNH / 2) + '" r="2.7" fill="'
      + (nd.prev !== _dlNULL ? pColor : 'none') + '" stroke="' + pColor + '" stroke-width="1.4"/>';
  }
  return s + '</g>';
}

/** 水平箭头：left=false 时从 x1 向右指到 x2；left=true 时从 x2 向左指到 x1 */
function _dlArrow(x1, x2, y, cls, color, w, left) {
  const head = left
    ? '<polygon points="' + x1 + ',' + y + ' ' + (x1 + 9) + ',' + (y - 4.5) + ' ' + (x1 + 9) + ',' + (y + 4.5) + '" fill="' + color + '"/>'
    : '<polygon points="' + x2 + ',' + y + ' ' + (x2 - 9) + ',' + (y - 4.5) + ' ' + (x2 - 9) + ',' + (y + 4.5) + '" fill="' + color + '"/>';
  const xa = left ? (x1 + 7) : x1, xb = left ? x2 : (x2 - 7);
  return '<g class="' + cls + '"><line x1="' + xa + '" y1="' + y + '" x2="' + xb + '" y2="' + y
    + '" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round"/>' + head + '</g>';
}

/** 竖直箭头：dir='up' 时尖端在 (x,y) 朝上；dir='down' 时朝下（用于回绕连线进入盒子的那一下） */
function _dlVHead(x, y, dir, color) {
  const s = dir === 'up' ? 1 : -1;
  return '<polygon points="' + x + ',' + y + ' ' + (x - 4.5) + ',' + (y + 9 * s) + ' ' + (x + 4.5) + ',' + (y + 9 * s)
    + '" fill="' + color + '"/>';
}

/** 🎲 预设专用：随机的新结点值（−99~99，避开 0） */
function _dlRandVal() {
  const v = RC408.util.rnd(1, 99);
  return Math.random() < 0.5 ? -v : v;
}

/* ============================================================================ */
RC408.registerModule({
  id: 'ds-dlink',
  mode: 'stepper',
  title: '双链表与循环链表（prior/next 双向接链 · 尾指针维护 · 前驱改写）',

  theory: `
> **为什么要有它**：单链表只能顺着 next 往后走，想找前驱得从头再扫一遍；**双向链表**给每个结点加一个 prior 指针，两个方向都能走——代价是插入删除要改**四条 / 两条**指针，少改一条就留下一条指向已释放结点的反向野指针。**循环链表**把尾结点的 next 指回头结点，于是"表尾"也不用判空。
> **怎么实现**：插入 = 先给新结点接好两条（s->prior = p; s->next = p->next），再回头改旧后继的 prior 与 p 自己的 next；删除 = 两个方向**各改一条**（p->prior->next = p->next; p->next->prior = p->prior）。顺序与条数就是全部考点。
> **记住什么**：双向链表插入的四条语句**顺序不能反**；单向循环链表删首元时要顺带维护**尾指针**（p == q 时才把 p 指回头结点）；双向循环链表里**没有 ∧ NULL**，两端都不用判空——这正是它与线性双向链表的唯一差别。

## 双向链表的插入：四条语句，先接后断
| 语句 | 作用 | 顺序写反的后果 |
| --- | --- | --- |
| ① s->prior = p | 新结点的前驱指向 p | —— |
| ② s->next = p->next | 新结点接管 p 原来的后继 | 若先做了 ④，p 的旧后继已经找不回来，第 ②③ 条无从下手 |
| ③ p->next->prior = s | 旧后继的前驱改指 s | 漏掉 ⟹ 旧后继的 prior 仍指 p，反向链断裂 |
| ④ p->next = s | p 的后继改成 s | 提前做 ⟹ 整条尾巴丢失（经典的"断链"错答） |

- **必须判空的场合**：线性双向链表在**尾结点之后**插入时 p->next 是 ∧ NULL，第 ③ 条要写成 if (p->next) p->next->prior = s；**循环双向链表里 p->next 永不为 NULL，这一句判空可以省掉**——两种表在考卷上就靠这一点区分。

## 双向链表的删除：两条语句，一条都不能少
| 语句 | 作用 | 漏掉的后果 |
| --- | --- | --- |
| ① p->prior->next = p->next | 前驱跨过 p（正向链断开） | 正向链还指着 p，而 p 已被 free |
| ② p->next->prior = p->prior | 后继的前驱退回 p 的前驱 | 反向链还指着 p，同样成了野指针 |
| ③ free(p) | 释放结点 | 只改链不释放 ⟹ 内存泄漏 |

- ①② 读的都是 **p 自己的两个指针**，谁先谁后都行；但**少任何一条都会留下一条指向已释放结点的反向野指针**，这是双向链表特有的错法（单链表只有一条链，没有这个问题）；
- 线性双向链表删**尾结点**时 p->next 是 NULL，第 ② 条要补判空；循环双向链表不需要。

## 单循环链表：尾指针是"顺带要维护"的那一个
- 删除第一个元素的正确写法（2021-1）：q = h->next; h->next = q->next; **if (p == q) p = h;** free(q);
  —— 已定位时删除本身是 \\(O(1)\\)，尾巴上那一步"维护尾指针"才是本题的分水岭；
- **判据**：只有被删的 q **正好是尾结点**（即表里只剩一个数据结点）时，尾指针 p 才失效，要指回头结点 h。条件写成 if (p != q) 就恰好反了（2021-1 的选项 C 就埋着这个坑）；
- 选项 A 的错法更基础：先 h->next = h->next->next 再想 q = …，此时**待删结点已经不可达**，无法 free——和单链表"删除先存后跨"是同一条纪律。

## 考点提醒（易错点）
1. 数"改了几条指针"：双向插入 **4 条**（其中 2 条写新结点、2 条改旧链）、双向删除 **2 条** + free；单链表插入删除都只有 2 条；
2. 问"执行哪条语句后断链"：双向插入里**把第 ④ 条提前**就断链；删除里**漏掉第 ①② 中任意一条**就留野指针；
3. **双向循环链表没有 NULL**：p->prior 与 p->next 一定落在某个结点上（表空时头结点的两个指针都指自己），所以"两端特判"在这里不存在；
4. **单循环链表的尾指针**：插在表尾、删表尾都要顺带改它，别只在删首元时想起来；
5. 2026-2 那种"逐结点改写指针"的题：**判空要判在第一层**（cu->p1 != null 才取 cu->p1->p1），并且**前进必须走没被改写的那条链**（这里 p2 正被改写，只能靠 p1 往后退——写反了就是死循环或提前结束）。

> **真题考情**：**4/18 年（选 3 + 大 1）**：选 2016-2（双向循环链表删除 p 所指结点）、2021-1（带头结点单循环链表删除第一个元素 + 维护尾指针）、2026-2（双向链表逐结点改写 prior）；大 2019-42（设计"入队可增空间、出队空间可复用、总空间只增不减"的队列
⟹ 选链式存储（卷面：考情缓存/2019_真题.txt:405-410）；⚠ 归属待复核，也可归 ds-stack-queue）。
`,

  /* ---------------- 输入表单（每一项都必须有 default，§3.8-11） ---------------- */
  inputs: [
    {
      key: 'op', label: '操作（切换后立即重算）', type: 'select', default: 'dinsert', wide: true,
      options: [
        { v: 'dinsert', t: '① 双向链表：在 p 之后插入 s（四条语句 · 先接后断）' },
        { v: 'ddelete', t: '② 双向链表：删除 p 所指结点（2016-2 · 两条语句 + free）' },
        { v: 'singcirc', t: '③ 单循环链表：删除第一个元素（2021-1 · 尾指针维护）' },
        { v: 'p2fix', t: '④ 双向链表：逐结点改写 prior（2026-2 · p2 = p1->p1）' },
      ],
    },
    {
      key: 'vals', label: '初始链表数据（尾插法依次建立）', type: 'textarea', rows: 1, wide: true,
      default: '5,9,12,20,33',
      help: '整数 −99~99，逗号 / 空格分隔，最多 8 个结点；恒为带头结点（四道真题全部带头结点）',
    },
    {
      key: 'pos', label: '位序 i（①②：p 指向第 i 个数据结点）', type: 'text', default: '3',
      help: '模式①：1 ~ n（在 p 之后插入 s）；模式②：1 ~ n（删第 i 个数据结点）；模式③④忽略此项',
    },
    {
      key: 'val', label: '新结点的值 x（仅模式①用）', type: 'text', default: '7',
      help: '模式①要插入的 s 的数据域；其余模式忽略此项',
    },
    {
      key: 'circ', label: '表形态（模式①②用；③恒为单循环、④恒为线性）', type: 'select', default: 'no',
      options: [
        { v: 'no', t: '线性双向链表（两端都是 ∧ NULL；删尾 / 尾插要判空）' },
        { v: 'yes', t: '双向循环链表（尾 next→头结点，头结点 prior→尾；不用判空）' },
      ],
    },
  ],

  /* ---------------- 预设（冒烟脚本会用假 rt 逐个跑通，并断言标签承诺的动作） ---------------- */
  quickActions: [
    {
      label: '🎲 随机数据', run(rt) {
        const pool = [];
        for (let i = 1; i <= 24; i++) pool.push(i);
        pool.sort(function () { return Math.random() - 0.5; });
        const n = RC408.util.rnd(3, 6);
        const vals = pool.slice(0, n).map(function (v) { return Math.random() < 0.5 ? -v : v; });
        rt.setInput('vals', vals.join(','));
        rt.setInput('pos', String(RC408.util.rnd(1, n)));
        rt.setInput('val', String(_dlRandVal()));
        rt.load();
      },
    },
    {
      label: '📝 2016-2 真题（双向循环链表删 p）', run(rt) {
        rt.setInput('op', 'ddelete');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '3');
        rt.setInput('circ', 'yes');
        rt.load();
      },
    },
    {
      label: '📝 2021-1 真题（单循环链表删首元 · 尾指针不动）', run(rt) {
        rt.setInput('op', 'singcirc');
        rt.setInput('vals', '5,9,12,20,33');
        rt.load();
      },
    },
    {
      label: '⚠️ 2021-1 边界（只剩 1 个数据结点 ⟹ 要改尾指针）', run(rt) {
        rt.setInput('op', 'singcirc');
        rt.setInput('vals', '7');
        rt.load();
      },
    },
    {
      label: '📝 2026-2 真题（逐结点改写 prior）', run(rt) {
        rt.setInput('op', 'p2fix');
        rt.setInput('vals', '3,8,4,6,1');
        rt.load();
      },
    },
    {
      label: '📖 教材：线性双向链表在 p 之后插入 s', run(rt) {
        rt.setInput('op', 'dinsert');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '3');
        rt.setInput('val', '7');
        rt.setInput('circ', 'no');
        rt.load();
      },
    },
    {
      label: '📖 教材：循环双向链表插入（第③句可省判空）', run(rt) {
        rt.setInput('op', 'dinsert');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '3');
        rt.setInput('val', '7');
        rt.setInput('circ', 'yes');
        rt.load();
      },
    },
    {
      label: '✂️ 线性双向链表 · 删尾结点（第②句要判空）', run(rt) {
        rt.setInput('op', 'ddelete');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '5');
        rt.setInput('circ', 'no');
        rt.load();
      },
    },
    {
      label: '✂️ 双向循环链表 · 删到只剩头结点', run(rt) {
        rt.setInput('op', 'ddelete');
        rt.setInput('vals', '7');
        rt.setInput('pos', '1');
        rt.setInput('circ', 'yes');
        rt.load();
      },
    },
    {
      label: '🚫 线性双向链表 · 尾插（第③句必须判空）', run(rt) {
        rt.setInput('op', 'dinsert');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '5');
        rt.setInput('val', '7');
        rt.setInput('circ', 'no');
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const rawOp = String(vals.op === undefined || vals.op === null ? '' : vals.op);
    const op = ['dinsert', 'ddelete', 'singcirc', 'p2fix'].indexOf(rawOp) >= 0 ? rawOp : 'dinsert';
    /* ③ 单循环链表：结点结构 data|next，没有 prior 槽；且恒为循环。
       ④ 2026-2 的遍历条件是 while (cu != null) ⟹ 恒为**线性**双向链表。 */
    const dbl = op !== 'singcirc';
    const circ = op === 'singcirc' ? true
      : op === 'p2fix' ? false
        : (String(vals.circ === undefined ? 'no' : vals.circ) === 'yes');

    const rawVals = String(vals.vals === undefined || vals.vals === null ? '' : vals.vals).trim();
    if (!rawVals) throw { message: '请输入初始链表数据，例如 5,9,12,20,33（逗号 / 空格分隔）' };
    const toks = rawVals.split(/[,，、;；\s]+/).filter(Boolean);
    if (toks.length > 8) throw { message: '数据结点最多 8 个（要横向画出整条链与回绕通道，当前 ' + toks.length + ' 个）' };
    const seq = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i].replace(/−/g, '-').replace(/–/g, '-');
      if (!/^-?\d+$/.test(t)) throw { message: '「' + toks[i] + '」不是整数；数据只支持 −99~99 的整数（不要小数、字母）' };
      const v = parseInt(t, 10);
      if (v < -99 || v > 99) throw { message: '数据 ' + v + ' 超出演示范围（只支持 −99~99，便于画结点盒）' };
      seq.push(v);
    }
    if (!seq.length) throw { message: '至少要有 1 个数据结点' };
    const n = seq.length;

    let pos = 0, x = 0;
    if (op === 'dinsert' || op === 'ddelete') {
      const rawPos = String(vals.pos === undefined || vals.pos === null ? '' : vals.pos).trim();
      if (!/^\d+$/.test(rawPos)) throw { message: '位序 i 必须是正整数（当前「' + rawPos + '」）' };
      pos = parseInt(rawPos, 10);
      if (pos < 1 || pos > n) {
        throw { message: '位序 i 要在 1 ~ ' + n + ' 之间（表长 ' + n + '；p 指向第 i 个数据结点），当前 ' + pos };
      }
    }
    if (op === 'dinsert') {
      const rawX = String(vals.val === undefined || vals.val === null ? '' : vals.val).trim().replace(/−/g, '-');
      if (!/^-?\d+$/.test(rawX)) throw { message: '新结点的值 x 必须是整数（−99~99），当前「' + rawX + '」' };
      x = parseInt(rawX, 10);
      if (x < -99 || x > 99) throw { message: '新结点的值 ' + x + ' 超出演示范围（只支持 −99~99）' };
    }
    return { op: op, dbl: dbl, circ: circ, seq: seq, pos: pos, val: x, n: n };
  },

  /* ---------------- ② 纯算法：逐动作产出快照（零 DOM） ---------------- */
  buildSnapshots(model) {
    const op = model.op, seq = model.seq, pos = model.pos, x = model.val;
    const dbl = model.dbl, circ = model.circ;

    /* ---------- 建池：恒为带头结点（四道真题全部带头结点） ---------- */
    const pool = [];
    const alloc = function (v, isHead) {
      pool.push({ id: pool.length, val: v, prev: _dlNULL, next: _dlNULL, isHead: !!isHead });
      return pool.length - 1;
    };
    const headIdx = alloc(null, true);
    let tailIdx = headIdx;
    for (let i = 0; i < seq.length; i++) {
      const nd = alloc(seq[i], false);
      pool[tailIdx].next = nd;
      if (dbl) pool[nd].prev = tailIdx;      // 单循环链表的结点没有 prior 槽
      tailIdx = nd;
    }
    if (circ) {
      pool[tailIdx].next = headIdx;          // 尾的 next 回指头结点
      if (dbl) pool[headIdx].prev = tailIdx; // 头结点的 prior 指向尾（双向循环才维护）
    }
    const chainNow = function () { return _dlChain(pool, headIdx); };

    const snaps = [];
    let floating = [], freed = [];
    let moves = 0, visits = 0, delCount = 0;
    let p = null, q = null, t = null, doom = null;

    const push = function (step, o) {
      const oo = o || {};
      const s = {
        step: step, op: op, dbl: dbl, circ: circ, pos: pos, val: x, n: seq.length,
        nodes: pool.map(function (nd) { return { id: nd.id, val: nd.val, prev: nd.prev, next: nd.next, isHead: !!nd.isHead }; }),
        headIdx: headIdx, tailIdx: tailIdx,
        floating: floating.slice(), freed: freed.slice(),
        p: (oo.p === undefined ? p : oo.p),
        q: (oo.q === undefined ? q : oo.q),
        t: (oo.t === undefined ? t : oo.t),
        doom: (oo.doom === undefined ? doom : oo.doom),
        newIdx: (oo.newIdx === undefined ? _dlNULL : oo.newIdx),
        newLink: oo.newLink || null,
        brokeLink: oo.brokeLink || null,
        moves: moves, visits: visits, delCount: delCount,
        desc: oo.desc || '', log: oo.log || '', logType: oo.logType || 'info',
      };
      s.chain = _dlChain(s.nodes, s.headIdx);
      s.len = _dlLen(s.nodes, s.chain);
      snaps.push(s);
    };

    /* 从"头结点"前进 k 步，返回第 k 个数据结点的下标（k ≤ n） */

    /* ==================== 模式①：双向链表在 p 之后插入 s（四条语句） ==================== */
    if (op === 'dinsert') {
      push('init', {
        desc: '初始' + (circ ? '双向循环' : '线性双向') + '链表（带头结点，尾插法建立）：' + _dlSeqText(pool, chainNow())
          + '。目标：在 p（第 ' + pos + ' 个数据结点）之后插入 s（数据 ' + x + '）。',
        log: '初始链表：' + _dlSeqText(pool, chainNow()) + '（表长 ' + seq.length + '，' + (circ ? '双向循环' : '线性双向') + '）',
        p: null, q: null, t: null,
      });
      p = headIdx;
      for (let k = 1; k <= pos; k++) {
        p = pool[p].next; moves++;
        push('move', {
          p: p,
          desc: 'p 后移第 ' + k + ' 次 → p 指向第 ' + k + ' 个数据结点（还要再移 ' + (pos - k) + ' 次）',
          log: '指针后移 ' + k + ' 次：p = 第 ' + k + ' 个数据结点（数据 ' + pool[p].val + '）',
        });
      }
      push('found', {
        p: p,
        desc: 'p 已到位（数据 ' + pool[p].val + '），指针移动 ' + moves + ' 次。下面四条语句顺序不能反：'
          + '先把新结点 s 的两条指针接好，再回头改旧链的两条。',
        log: '定位完成：指针移动 ' + moves + ' 次；下面四条语句先接后断',
      });
      const sIdx = alloc(x, false);
      const oldNext = pool[p].next;
      floating = [sIdx]; doom = sIdx;
      pool[sIdx].prev = p;
      push('s1', {
        p: p, q: sIdx, newIdx: sIdx, newLink: { from: sIdx, to: p, which: 'prev' },
        desc: '语句① s->prior = p：新结点 s（数据 ' + x + '）的前驱指向 p。这一步只动 s 自己的 prior 槽，链表完全没变。',
        log: '① s->prior = p（s 的前驱指向数据 ' + pool[p].val + '）',
      });
      pool[sIdx].next = oldNext;
      push('s2', {
        p: p, q: sIdx, newIdx: sIdx, newLink: { from: sIdx, to: oldNext, which: 'next' },
        desc: '语句② s->next = p->next：s 接管 p 原来的后继'
          + (oldNext === _dlNULL ? '（p 后面本来是 ∧ NULL，说明 p 是尾结点）' : '（原后继数据 ' + pool[oldNext].val + '）')
          + '。到这一步 s 的两条指针都接好了，它同时指着 p 和 p 的旧后继。',
        log: '② s->next = p->next（s 接住' + (oldNext === _dlNULL ? ' ∧ NULL' : '数据 ' + pool[oldNext].val) + '）',
      });
      if (oldNext === _dlNULL) {
        push('s3', {
          p: p, q: sIdx, newIdx: sIdx,
          desc: '语句③ p->next->prior = s —— 本帧跳过：p 是线性双向链表的尾结点，p->next 是 ∧ NULL，'
            + '解引用它就会崩。教材这里写的是 if (p->next) p->next->prior = s；'
            + '若是双向循环链表，p->next 永不为 NULL，这句判空就可以省掉。',
          log: '③ 跳过（p->next = ∧ NULL，线性表必须判空）',
          logType: 'warn',
        });
      } else {
        pool[oldNext].prev = sIdx;
        push('s3', {
          p: p, q: sIdx, newIdx: sIdx,
          newLink: { from: oldNext, to: sIdx, which: 'prev' }, brokeLink: { from: oldNext, to: p, which: 'prev' },
          desc: '语句③ p->next->prior = s：旧后继（数据 ' + pool[oldNext].val
            + '）的前驱改指 s（红色虚线 ✂ = 被改掉的旧值 p）。这一步把反向链接上，漏掉它就留下一条指向 p 的野 prior。',
          log: '③ p->next->prior = s（数据 ' + pool[oldNext].val + ' 的前驱改成 s）',
        });
      }
      pool[p].next = sIdx;
      floating = [];
      if (p === tailIdx) tailIdx = sIdx;   // 插在尾结点之后（线性表即 p->next = NULL 的那种）⟹ 尾指针前移
      push('s4', {
        p: p, q: sIdx, newIdx: sIdx,
        newLink: { from: p, to: sIdx, which: 'next' }, brokeLink: { from: p, to: oldNext, which: 'next' },
        desc: '语句④ p->next = s：p 的后继改成 s，s 正式进链（红色虚线 ✂ = 被改掉的旧后继）。'
          + '这条必须最后做——提前做的话 p 原来的后继就再也找不到了。',
        log: '④ p->next = s（插入完成：' + _dlSeqText(pool, chainNow()) + '）',
        logType: 'success',
      });
      push('done', {
        desc: '插入完成：表长 ' + seq.length + ' → ' + (seq.length + 1) + '，共改写 4 条指针'
          + (oldNext === _dlNULL ? '（其中第③条因 p 是线性表尾结点而跳过，实际 3 条 + 1 次判空）' : '')
          + '。定位 p 用掉 ' + moves + ' 次移动 ⟹ 定位是 O(n)、改指针本身是 O(1)。',
        log: '完成：' + _dlSeqText(pool, chainNow()) + '（改写 4 条指针，指针移动 ' + moves + ' 次）',
        logType: 'success',
      });
    }

    /* ==================== 模式②：双向链表删除 p 所指结点（2016-2） ==================== */
    if (op === 'ddelete') {
      push('init', {
        desc: '初始' + (circ ? '双向循环' : '线性双向') + '链表（带头结点）：' + _dlSeqText(pool, chainNow())
          + '。目标：删除 p 所指的结点（第 ' + pos + ' 个数据结点）。',
        log: '初始链表：' + _dlSeqText(pool, chainNow()) + '（表长 ' + seq.length + '）',
      });
      p = headIdx;
      for (let k = 1; k <= pos; k++) {
        p = pool[p].next; moves++;
        push('move', {
          p: p,
          desc: 'p 后移第 ' + k + ' 次 → p 指向第 ' + k + ' 个数据结点（数据 ' + pool[p].val + '）',
          log: '指针后移 ' + k + ' 次：p = 第 ' + k + ' 个数据结点（数据 ' + pool[p].val + '）',
        });
      }
      doom = p;
      const pre = pool[p].prev, nxt = pool[p].next;
      push('found', {
        p: p, doom: p,
        desc: 'p 已到位（数据 ' + pool[p].val + '），它的前驱是' + (pool[pre].isHead ? '头结点' : '数据 ' + pool[pre].val)
          + '、后继是' + (nxt === _dlNULL ? '∧ NULL（p 是线性表尾结点）' : (pool[nxt].isHead ? '头结点（循环表）' : '数据 ' + pool[nxt].val))
          + '。下面两条语句一条都不能少。',
        log: '定位完成：指针移动 ' + moves + ' 次；p 的前驱 = ' + (pool[pre].isHead ? '头结点' : pool[pre].val)
          + '，后继 = ' + (nxt === _dlNULL ? '∧' : (pool[nxt].isHead ? '头结点' : pool[nxt].val)),
      });
      pool[pre].next = nxt;
      floating = [p];              // p 已从正向链上摘下：先悬在第二行，等 free
      push('unl1', {
        p: p, doom: p,
        newLink: { from: pre, to: nxt, which: 'next' }, brokeLink: { from: pre, to: p, which: 'next' },
        desc: '语句① p->prior->next = p->next：前驱跨过 p（红色虚线 ✂ = 被改掉的旧指针）。'
          + '正向链已经不再经过 p —— 但反向链还指着它，此时 p 只从一个方向脱离。',
        log: '① p->prior->next = p->next（正向链跳过数据 ' + pool[p].val + '）',
        logType: 'warn',
      });
      if (nxt === _dlNULL) {
        push('unl2', {
          p: p, doom: p,
          desc: '语句② p->next->prior = p->prior —— 本帧跳过：p 是线性双向链表的尾结点，p->next 是 ∧ NULL，'
            + '解引用会崩。教材写的是 if (p->next) p->next->prior = p->prior；'
            + '双向循环链表里 p->next 永不为 NULL，这句判空可以省掉。',
          log: '② 跳过（p->next = ∧ NULL，线性表必须判空）',
          logType: 'warn',
        });
      } else {
        pool[nxt].prev = pre;
        push('unl2', {
          p: p, doom: p,
          newLink: { from: nxt, to: pre, which: 'prev' }, brokeLink: { from: nxt, to: p, which: 'prev' },
          desc: '语句② p->next->prior = p->prior：后继的前驱退回 p 的前驱（红色虚线 ✂ = 被改掉的旧值 p）。'
            + '两个方向都跨过 p 了，它才真正脱离链表。',
          log: '② p->next->prior = p->prior（反向链也跳过数据 ' + pool[p].val + '）',
          logType: 'warn',
        });
      }
      if (p === tailIdx) tailIdx = pre;      // 删的是尾结点 ⟹ 尾指针要前移
      delCount++;
      floating = []; freed = [p];
      push('free', {
        p: p, doom: p,
        desc: '语句③ free(p)：释放结点（数据 ' + pool[p].val + '），表长 ' + seq.length + ' → ' + (seq.length - 1)
          + (circ ? '（循环表删到只剩头结点时，头结点的两个指针都指回它自己 ⟹ 表空）' : '')
          + '。只改一条指针就 free，会留下一条指向已释放结点的反向野指针。',
        log: 'free(p)：结点 ' + pool[p].val + ' 已释放',
        logType: 'warn',
      });
      push('done', {
        desc: '删除完成：表长 ' + seq.length + ' → ' + (seq.length - 1) + '；指针移动 ' + moves + ' 次。'
          + '双向链表删除要改 2 条指针（正、反各一条）' + (nxt === _dlNULL ? '，其中第②条因线性表尾结点而跳过' : '')
          + '；改指针是 O(1)，代价全在定位 p。',
        log: '删除完成：' + _dlSeqText(pool, chainNow()) + '（指针移动 ' + moves + ' 次）',
        logType: 'success',
      });
    }

    /* ==================== 模式③：单循环链表删除第一个元素（2021-1） ==================== */
    if (op === 'singcirc') {
      t = tailIdx;
      push('init', {
        desc: '初始单循环链表（带头结点，结点结构 data|next）：' + _dlSeqText(pool, chainNow())
          + '，尾指针 p 指向尾结点（数据 ' + pool[tailIdx].val + '），尾结点的 next 回指头结点 h。'
          + '目标：删除第一个元素。',
        log: '初始链表：' + _dlSeqText(pool, chainNow()) + '；尾指针 p = 数据 ' + pool[tailIdx].val,
      });
      q = pool[headIdx].next;
      push('s1', {
        p: null, q: q, t: tailIdx,
        desc: '语句① q = h->next：q 指向待删的第一个数据结点（数据 ' + pool[q].val + '）。必须先存下来——'
          + '下一步 h->next 一改，这个结点就再也找不到了（2021-1 的选项 A 就栽在这里）。',
        log: '① q = h->next（q = 数据 ' + pool[q].val + '）',
        logType: 'warn',
      });
      const qIsTail = (q === tailIdx);
      const after = pool[q].next;
      pool[headIdx].next = after;
      floating = [q];              // q 已从链上摘下：先悬在第二行，等 free
      push('s2', {
        p: null, q: q, t: tailIdx,
        newLink: { from: headIdx, to: after, which: 'next' }, brokeLink: { from: headIdx, to: q, which: 'next' },
        desc: '语句② h->next = q->next：头结点跨过 q（红色虚线 ✂ = 被改掉的旧指针）。'
          + (qIsTail ? '此时表里只剩这一个数据结点，q->next 就是头结点 ⟹ 删完变成空表。'
            : 'q->next 是下一个数据结点（数据 ' + pool[after].val + '）⟹ 它成为新的第一个元素。'),
        log: '② h->next = q->next（链变成 ' + _dlSeqText(pool, _dlChain(pool, headIdx)) + '）',
        logType: 'warn',
      });
      push('test', {
        p: null, q: q, t: tailIdx,
        desc: '语句③ 判断 p == q ?：尾指针 p 现在指着' + (qIsTail ? 'q 本身' : '数据 ' + pool[tailIdx].val + '，而 q 是数据 ' + pool[q].val)
          + ' ⟹ ' + (qIsTail ? '成立：被删的正是尾结点，尾指针失效，必须让它指回头结点 h。'
            : '不成立：尾结点还在表里，尾指针不用动。')
          + ' 这就是为什么条件必须写成 p == q —— 写成 p != q 恰好反了（2021-1 的选项 C）。',
        log: '③ 判断 p == q：' + (qIsTail ? '成立 ⟹ 要改尾指针' : '不成立 ⟹ 尾指针不动'),
        logType: qIsTail ? 'warn' : 'info',
      });
      if (qIsTail) {
        tailIdx = headIdx; t = headIdx;
        push('s3', {
          p: null, q: q, t: headIdx,
          desc: '语句③成立，执行 p = h：尾指针指回头结点（表空了，头结点的 next 也是它自己）。'
            + '漏掉这一步，尾指针就成了指向已释放结点的野指针——这是 2021-1 最常错的选项。',
          log: '③ p = h（尾指针指回头结点，表空）',
          logType: 'warn',
        });
      } else {
        push('s3', {
          p: null, q: q, t: tailIdx,
          desc: '语句③不成立，什么都不做：尾指针仍然指着尾结点（数据 ' + pool[tailIdx].val + '），尾结点的 next 仍然回指头结点。',
          log: '③ 条件不成立 ⟹ 尾指针保持不动',
          logType: 'success',
        });
      }
      delCount++;
      floating = []; freed = [q];
      push('free', {
        p: null, q: q, t: tailIdx,
        desc: '语句④ free(q)：释放结点（数据 ' + pool[q].val + '）。单循环链表删首元什么都不用判空：'
          + 'q->next 一定是个结点（空表时就是头结点），这正是循环链表比线性表省事的地方。',
        log: 'free(q)：结点 ' + pool[q].val + ' 已释放',
        logType: 'warn',
      });
      push('done', {
        desc: '删除完成：表长 ' + seq.length + ' → ' + (seq.length - 1)
          + (qIsTail ? '；这次删的正好是尾结点 ⟹ 尾指针已指回头结点' : '；尾结点没被删 ⟹ 尾指针一步没动')
          + '。四条语句里真正"改链"的只有第②条，第③条是循环链表独有的尾指针维护。',
        log: '完成：' + _dlSeqText(pool, chainNow()) + (qIsTail ? '（尾指针 → 头结点）' : '（尾指针不变）'),
        logType: 'success',
      });
    }

    /* ==================== 模式④：逐结点改写 prior（2026-2：p2 = p1->p1） ==================== */
    if (op === 'p2fix') {
      push('init', {
        desc: '初始线性双向链表（带头结点 head，结点结构 [p2,d,p1]，p1 = next、p2 = prior）：'
          + _dlSeqText(pool, chainNow()) + '。目标（2026-2）：把每个结点的 p2 指向 p1 所指结点的直接后继，'
          + '即 cu->p2 = cu->p1->p1。cu 从头结点开始。',
        log: '初始链表：' + _dlSeqText(pool, chainNow()) + '；cu = 头结点，准备逐结点改写 p2',
      });
      let cu = headIdx;
      let guard = 0;
      while (cu !== _dlNULL && cu !== null && cu >= 0 && guard++ < 64) {
        visits++; moves++;
        const p1 = pool[cu].next;
        p = cu;
        push('chk', {
          p: cu, q: p1 >= 0 ? p1 : null, t: null, newIdx: _dlNULL,
          desc: 'cu 指向' + (cu === headIdx ? '头结点' : '数据 ' + pool[cu].val) + '，先判空：cu->p1 '
            + (p1 === _dlNULL ? '是 ∧ NULL ⟹ 按 else 分支把 cu->p2 置为 NULL。'
              : '存在（指向' + (p1 === headIdx ? '头结点' : '数据 ' + pool[p1].val) + '）⟹ 进 if 分支。')
            + ' 判空要判在第一层：只有 cu->p1 非空才能继续取 cu->p1->p1。',
          log: '判 cu->p1：' + (p1 === _dlNULL ? '∧ NULL ⟹ else 分支' : '数据 ' + pool[p1].val + ' ⟹ if 分支'),
        });
        /* ⚠ 先改后推（与 ds-linkedlist 的 linkq/unlink 同一口径）：本帧展示的是"这条语句执行之后"的状态。
           若先推后改，快照会停在语句执行**之前**，绿色新指针就与 nodes 里的值自相矛盾（窗33 实测）。 */
        const np = (p1 === _dlNULL) ? _dlNULL : pool[p1].next;
        const oldPrev = pool[cu].prev;
        pool[cu].prev = np;
        if (p1 !== _dlNULL) {
          push('setp2', {
            p: cu, q: p1, t: np >= 0 ? np : null, newIdx: _dlNULL,
            newLink: { from: cu, to: np, which: 'prev' }, brokeLink: { from: cu, to: oldPrev, which: 'prev' },
            desc: '取 p1->p1：' + (np === _dlNULL
              ? 'cu->p1（数据 ' + pool[p1].val + '）的直接后继是 ∧ NULL ⟹ cu->p2 改成 NULL。'
              : 'cu->p1（数据 ' + pool[p1].val + '）的直接后继是数据 ' + pool[np].val + ' ⟹ 把 cu->p2 改指它。')
              + ' 注意 p1 本身没被改过，所以取 cu->p1->p1 永远是安全的。',
            log: 'p1->p1 = ' + (np === _dlNULL ? '∧ NULL' : '数据 ' + pool[np].val) + ' ⟹ 改写 cu->p2',
          });
        } else {
          push('setp2', {
            p: cu, t: null,
            newLink: { from: cu, to: _dlNULL, which: 'prev' }, brokeLink: { from: cu, to: oldPrev, which: 'prev' },
            desc: 'else 分支：cu->p1 是 ∧ NULL ⟹ 把 cu->p2 置为 NULL。'
              + '（漏掉这个 else 就会让 cu->p2 保持原值，得到错误答案。）',
            log: 'else 分支：cu->p2 = NULL',
          });
        }
        const nxt = pool[cu].next;
        cu = nxt;
        push('forward', {
          p: null, q: null, t: null,
          desc: '前进：cu = cu->p1（走没被改写的那条链）。'
            + (cu === _dlNULL ? ' cu 变成 NULL ⟹ 循环结束，全部结点都处理完了。'
              : ' cu 现在指向' + (cu === headIdx ? '头结点' : '数据 ' + pool[cu].val) + '。')
            + ' 若写成 cu = cu->p2，就会走进刚被改写过的指针里 —— 那是 2026-2 最典型的错法。',
          log: 'cu = cu->p1 ⟹ ' + (cu === _dlNULL ? 'NULL（结束）' : (cu === headIdx ? '头结点' : '数据 ' + pool[cu].val)),
        });
      }
      push('done', {
        desc: '改写完成：' + visits + ' 个结点（含头结点）的 p2 全部按 cu->p1->p1 重算过。'
          + '注意此时的链已经不是标准双向链表了：prior 不再指向前驱、而是指向"next 的后继"（即往后跳两格），'
          + '表尾附近还会变成 ∧ NULL ⟹ 反向遍历、删除等依赖 prior 的操作都会失效。'
          + '本题考的只是指针操作的正确性（判空位置 + 前进走 p1），不是这种链有什么用途。',
        log: '完成：p2 已全部改写（' + visits + ' 个结点）；prior 已不再指向前驱',
        logType: 'success',
      });
    }

    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照） ---------------- */
  render(ctx) {
    const s = ctx.snap, model = ctx.model, stage = ctx.stage;
    const nodes = s.nodes, chain = s.chain;
    const dbl = s.dbl === true;
    const nw = dbl ? _dlNW : _dlSNW;
    const floatIds = s.floating || [], freedIds = s.freed || [];

    /* ---------- 先算"哪些结点的 prior 不是相邻前驱" ⟹ 各占一条专用通道（互不重合） ---------- */
    const lanes = {}; let nLanes = 0;
    if (dbl) {
      chain.forEach(function (id, k) {
        const pv = nodes[id].prev;
        if (pv === _dlNULL || pv === id) return;
        if (k > 0 && pv === chain[k - 1]) return;
        if (k === 0 && s.circ && pv === chain[chain.length - 1]) return;
        lanes[id] = nLanes++;
      });
    }
    const g = _dlGeom(nw, chain.length, floatIds.length + freedIds.length, s.circ === true, nLanes);
    const cy = g.cy, nextY = g.nextY, prevY = g.prevY;
    const inChain = {};
    chain.forEach(function (id) { inChain[id] = true; });
    const rowY = function (id) { return inChain[id] ? _dlTOP : g.detY; };
    const cxOf = function (id) {
      if (inChain[id]) return g.xOf(chain.indexOf(id)) + nw / 2;
      const j = floatIds.concat(freedIds).indexOf(id);
      return g.xOf(j < 0 ? 0 : j) + nw / 2;
    };
    const nl = s.newLink, bl = s.brokeLink;

    let svg = '';

    /* ---------- ① head 指针 ---------- */
    svg += '<g class="dl-ptr-head"><text x="10" y="' + cy + '" dy="0.35em"'
      + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#334155">head</text></g>';
    svg += _dlArrow(48, g.xOf(0), cy, 'dl-arrow dl-head-arrow', '#64748b', 2.2, false);

    /* ---------- ② 相邻结点之间的 next（间隙上半）与 prev（间隙下半）直连 ---------- */
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k], b = chain[k + 1];
      const hotN = !!nl && nl.which === 'next' && nl.from === a && nl.to === b;
      svg += _dlArrow(g.xOf(k) + nw, g.xOf(k + 1), nextY, hotN ? 'dl-arrow dl-next dl-arrow-new' : 'dl-arrow dl-next',
        hotN ? '#10b981' : '#94a3b8', hotN ? 3.2 : 2.2, false);
      if (dbl && nodes[b].prev === a) {
        const hotP = !!nl && nl.which === 'prev' && nl.from === b && nl.to === a;
        svg += _dlArrow(g.xOf(k), g.xOf(k + 1) + nw, prevY, hotP ? 'dl-arrow dl-prev dl-arrow-new' : 'dl-arrow dl-prev',
          hotP ? '#10b981' : '#a78bfa', hotP ? 3.2 : 2.2, true);
      }
    }

    /* ---------- ③ 每个结点的 prior：∧ / 自环 / 循环回绕 / 改写专用通道 ---------- */
    if (dbl) {
      chain.forEach(function (id, k) {
        const pv = nodes[id].prev;
        const bx = g.xOf(k);
        if (pv === _dlNULL) {
          svg += '<text x="' + (bx - 12) + '" y="' + prevY + '" dy="0.35em" text-anchor="middle" class="dl-null dl-null-prev"'
            + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#94a3b8">∧</text>';
          return;
        }
        if (pv === id) {   // 自环（表空时头结点的 prior 指向自己）
          svg += '<g class="dl-wrap"><path d="M ' + (bx + nw / 2 + 15) + ',' + (_dlTOP + _dlNH) + ' Q ' + (bx + nw / 2) + ','
            + (_dlTOP + _dlNH + 34) + ' ' + (bx + nw / 2 - 15) + ',' + (_dlTOP + _dlNH) + '" fill="none" stroke="#a78bfa"'
            + ' stroke-width="2.2"/>' + _dlVHead(bx + nw / 2 - 15, _dlTOP + _dlNH, 'up', '#a78bfa') + '</g>';
          return;
        }
        if (k === 0 && s.circ) {   // 头结点的 prior 指向尾 ⟹ 走底通道
          const tailRight = g.xOf(chain.length - 1) + nw, tx = tailRight + 18;
          svg += '<g class="dl-wrap"><polyline points="' + bx + ',' + prevY + ' ' + (bx - 18) + ',' + prevY + ' '
            + (bx - 18) + ',' + g.botChan + ' ' + tx + ',' + g.botChan + ' ' + tx + ',' + prevY + ' '
            + (tailRight - 18) + ',' + prevY + '" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linejoin="round"/>'
            + _dlArrow(tailRight - 18, tailRight, prevY, 'dl-arrow dl-prev', '#a78bfa', 2.2, true) + '</g>';
          return;
        }
        if (k > 0 && pv === chain[k - 1]) return;      // 已在 ② 里画过
        /* 非相邻 / 向前指的 prior（模式④改写出来的）⟹ 独占一条通道 */
        const j = lanes[id], ty = g.laneY(j);
        const tb = chain.indexOf(pv);
        if (tb < 0) return;                            // 目标不在链上（异常数据）——不画，冒烟会断言这种情况不存在
        const tx = g.xOf(tb) + _dlPW / 2;
        const hotP = !!nl && nl.which === 'prev' && nl.from === id && nl.to === pv;
        const color = hotP ? '#10b981' : '#fdba74';
        svg += '<g class="dl-lane"><polyline points="' + (bx + _dlPW / 2) + ',' + (_dlTOP + _dlNH) + ' '
          + (bx + _dlPW / 2) + ',' + ty + ' ' + tx + ',' + ty + ' ' + tx + ',' + (_dlTOP + _dlNH + 9) + '" fill="none" stroke="'
          + color + '" stroke-width="' + (hotP ? 2.6 : 1.6) + '" stroke-dasharray="' + (hotP ? 'none' : '4 3')
          + '" stroke-linejoin="round"/>'
          + _dlVHead(tx, _dlTOP + _dlNH, 'up', color) + '</g>';
      });
    }

    /* ---------- ④ 末结点的 next：∧ NULL / 自环 / 循环回绕 ---------- */
    if (chain.length) {
      const last = chain[chain.length - 1], lastRight = g.xOf(chain.length - 1) + nw;
      if (nodes[last].next === _dlNULL) {
        svg += '<text x="' + (lastRight + 12) + '" y="' + nextY + '" dy="0.35em" class="dl-null dl-null-next"'
          + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#94a3b8">∧ NULL</text>';
      } else if (nodes[last].next === last) {   // 自环（表空时头结点的 next 指向自己）
        const c = lastRight - nw / 2;
        svg += '<g class="dl-wrap"><path d="M ' + (c + 15) + ',' + _dlTOP + ' Q ' + c + ',' + (_dlTOP - 34) + ' '
          + (c - 15) + ',' + _dlTOP + '" fill="none" stroke="#64748b" stroke-width="2.2"/>'
          + _dlVHead(c - 15, _dlTOP, 'down', '#64748b') + '</g>';
      } else if (nodes[last].next === chain[0]) {   // 尾 → 头结点，走顶通道
        const hx = g.xOf(0) + nw / 2;
        svg += '<g class="dl-wrap"><polyline points="' + lastRight + ',' + nextY + ' ' + (lastRight + 18) + ',' + nextY + ' '
          + (lastRight + 18) + ',' + g.topChan + ' ' + hx + ',' + g.topChan + ' ' + hx + ',' + (_dlTOP - 2)
          + '" fill="none" stroke="#64748b" stroke-width="2.2" stroke-linejoin="round"/>'
          + _dlVHead(hx, _dlTOP, 'down', '#64748b') + '</g>';
      }
    }

    /* ---------- ⑤ 被改掉的旧指针（红色虚线 + ✂）与悬空结点之间的新指针（绿色"接链"） ----------
       两条折线**各占一条水平通道**（g.chanG 绿 / g.chanR 红）：窗33 原分辨率目视实测，合用一条
       时它们在重叠区间上"红绿相间"地互穿，且两个标签都锚在源端 ⟹ ✂ 与"改 prior"重叠。
       §3.8-18：发现即补判据——harness 的逐帧 labelSet 压盖断言就是为这条加的。 */
    const anchor = function (id, which) {
      if (id === _dlNULL) return null;
      const mine = inChain[id] ? true : false;
      return { cx: cxOf(id), y: mine ? _dlTOP + _dlNH : g.detY, chain: mine, which: which };
    };
    if (bl) {
      const a = anchor(bl.from, bl.which), b = anchor(bl.to, bl.which);
      if (a) {
        const my = g.chanR;
        const tx = b ? b.cx : a.cx + 30, ty = b ? b.y : my;
        const dir = (tx >= a.cx) ? 1 : -1;
        svg += '<g class="dl-cut">'
          + '<polyline points="' + a.cx + ',' + a.y + ' ' + a.cx + ',' + my + ' ' + tx + ',' + my + ' ' + tx + ',' + ty
          + '" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>'
          + '<text x="' + (a.cx + dir * 14) + '" y="' + my + '" dy="0.35em" text-anchor="middle"'
          + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#ef4444">✂</text></g>';
      }
    }
    if (nl) {
      const a = anchor(nl.from, nl.which);
      const adjOnChain = !!(a && a.chain && nl.to !== _dlNULL && inChain[nl.to]
        && Math.abs(g.xOf(chain.indexOf(nl.to)) - g.xOf(chain.indexOf(nl.from))) === nw + _dlGAP);
      /* 模式④改写出来的 prior 已由"专用通道"那条线画过 ⟹ 这里不再重复画一条幽灵线 */
      const laneDrawn = dbl && nl.which === 'prev' && lanes[nl.from] !== undefined
        && nl.to !== _dlNULL && inChain[nl.to];
      if (a && !adjOnChain && !laneDrawn) {
        const b = anchor(nl.to, nl.which);
        const my = g.chanG;
        if (b) {
          const dir = (b.cx >= a.cx) ? 1 : -1;
          svg += '<g class="dl-newlink"><polyline points="' + a.cx + ',' + a.y + ' ' + a.cx + ',' + my + ' ' + b.cx + ',' + my
            + ' ' + b.cx + ',' + b.y + '" fill="none" stroke="#10b981" stroke-width="2.6" stroke-dasharray="6 4"'
            + ' stroke-linejoin="round"/><text x="' + (a.cx + dir * 16) + '" y="' + (my - 9)
            + '" dy="0.35em" text-anchor="middle" style="font:800 12px Consolas,ui-monospace,monospace;fill:#10b981">'
            + (nl.which === 'next' ? '接链' : '改 prior') + '</text></g>';
        } else {
          svg += '<g class="dl-newlink">'
            + _dlArrow(a.cx + nw / 2 + 4, a.cx + nw / 2 + 26, a.y + _dlNH / 2, 'dl-arrow dl-arrow-new', '#10b981', 2.6, false)
            + '<text x="' + (a.cx + nw / 2 + 32) + '" y="' + (a.y + _dlNH / 2) + '" dy="0.35em"'
            + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#10b981">∧</text></g>';
        }
      }
    }

    /* ---------- ⑥ 第二行：悬空 / 已 free 的结点 ---------- */
    if (floatIds.length || freedIds.length) {
      /* ⚠ 必须是**短标签**：说明文字左对齐在 x=10，而"悬空盒 ↔ 通道"的那段竖线落在 x ≥ 129
         （第 0 个盒的中心）⟹ 长文字会被竖线穿过（窗28 / 窗33 同一课，§3.8-18）。 */
      const lab = (floatIds.length && freedIds.length) ? '悬空 / 已 free'
        : (floatIds.length ? '悬空结点' : '已 free 结点');
      svg += '<text x="10" y="' + g.detLabelY + '" class="dl-det-label"'
        + ' style="font:700 11px Consolas,ui-monospace,monospace;fill:#94a3b8">' + lab + '</text>';
    }
    floatIds.forEach(function (id) {
      const j = floatIds.indexOf(id);
      svg += _dlBox(g.xOf(j), g.detY, nodes[id], { f: '#fff7ed', t: '#9a3412', st: '#fb923c', dash: true }, 'dl-node dl-floating', dbl, {});
    });
    freedIds.forEach(function (id) {
      const j = floatIds.length + freedIds.indexOf(id);
      svg += _dlBox(g.xOf(j), g.detY, nodes[id], { f: '#f8fafc', t: '#94a3b8', st: '#cbd5e1', dash: true }, 'dl-node dl-freed', dbl, {});
    });

    /* ---------- ⑦ 链上结点盒（画在箭头之后，压住箭头起点） ---------- */
    chain.forEach(function (id, k) {
      const cls = 'dl-node' + (nodes[id].isHead ? ' dl-head' : '') + (id === s.newIdx ? ' dl-new' : '');
      const marks = {};
      if (nl && nl.which === 'prev' && nl.from === id) marks.prev = '#10b981';
      if (bl && bl.which === 'prev' && bl.from === id) marks.prev = '#ef4444';
      if (nl && nl.which === 'next' && nl.from === id) marks.next = '#10b981';
      if (bl && bl.which === 'next' && bl.from === id) marks.next = '#ef4444';
      svg += _dlBox(g.xOf(k), _dlTOP, nodes[id], _dlCell(s, id), cls, dbl, marks);
    });

    /* ---------- ⑧ p / q / 尾 指针徽标（p、q 在盒上方左右两端，尾在盒下方居中） ---------- */
    const ptrs = [];
    const badge = function (id, txt, color, cls, side) {
      if (id === null || id === undefined) return;
      let lx, ly;
      if (inChain[id]) {
        const k = chain.indexOf(id), bx = g.xOf(k);
        lx = side === 'l' ? bx + 15 : side === 'r' ? bx + nw - 15 : bx + nw / 2;
        ly = side === 't' ? _dlTOP + _dlNH + 30 : _dlTOP - 16;
      } else {
        const j = floatIds.concat(freedIds).indexOf(id);
        if (j < 0) return;
        lx = g.xOf(j) + nw / 2; ly = g.detY + _dlNH + 20;
      }
      ptrs.push('<g class="dl-ptr ' + cls + '"><rect x="' + (lx - 13) + '" y="' + (ly - 11) + '" width="26" height="22"'
        + ' rx="7" fill="' + color + '"/><text x="' + lx + '" y="' + ly + '" dy="0.35em" text-anchor="middle"'
        + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#fff">' + txt + '</text></g>');
    };
    badge(s.p, 'p', '#6366f1', 'dl-ptr-p', 'l');
    badge(s.q, 'q', '#f59e0b', 'dl-ptr-q', 'r');
    if (s.t !== null && s.t !== undefined) badge(s.t, '尾', '#0d9488', 'dl-ptr-t', 't');

    const svgAll = '<svg viewBox="0 0 ' + g.W + ' ' + g.H + '" class="w-full h-auto mx-auto" style="max-width:' + Math.max(g.W, 560) + 'px">'
      + svg + ptrs.join('') + '</svg>';

    /* ---------- 统计卡（按模式给不同口径） ---------- */
    const headTxt = (dbl ? '双向' : '单向') + (s.circ ? '循环' : '线性');
    let stats = '';
    if (s.op === 'dinsert') {
      stats = RC408.ui.statCard('表长 n', String(s.len), headTxt + '（带头结点）')
        + RC408.ui.statCard('插入位置', '第 ' + (s.pos + 1) + ' 个', '在 p（第 ' + s.pos + ' 个）之后')
        + RC408.ui.statCard('定位 p 的代价', s.moves + ' 次移动', s.pos + ' 次后移 ⟹ O(n)')
        + RC408.ui.statCard('改写的指针', '4 条', 's->prior ／ s->next ／ p->next->prior ／ p->next', 'text-indigo-600');
    } else if (s.op === 'ddelete') {
      stats = RC408.ui.statCard('表长 n', String(s.len), headTxt + '（' + s.n + ' → ' + s.len + '）')
        + RC408.ui.statCard('删除位置', '第 ' + s.pos + ' 个', 'p 所指的数据结点')
        + RC408.ui.statCard('定位 p 的代价', s.moves + ' 次移动', '改指针是 O(1)，代价全在定位')
        + RC408.ui.statCard('改写的指针', '2 条', '正向 + 反向各一条（少一条就留野指针）', 'text-indigo-600');
    } else if (s.op === 'singcirc') {
      stats = RC408.ui.statCard('表长 n', String(s.len), '单循环链表（带头结点）')
        + RC408.ui.statCard('尾指针 p', s.tailIdx === s.headIdx ? '指向头结点' : '指向数据 ' + s.nodes[s.tailIdx].val,
          s.tailIdx === s.headIdx ? '表空 ⟹ 尾指针已改回 h' : '尾结点还在表里 ⟹ 尾指针不动', 'text-teal-700')
        + RC408.ui.statCard('本次删除', s.delCount + ' 个', '删的永远是第一个元素')
        + RC408.ui.statCard('要判空吗', '不用', 'q->next 一定是结点（空表时就是头结点）', 'text-indigo-600');
    } else {
      const doneN = s.visits;
      stats = RC408.ui.statCard('已处理结点', doneN + ' / ' + (s.n + 1), '含头结点，共 ' + (s.n + 1) + ' 个')
        + RC408.ui.statCard('改写语句', 'cu->p2 = cu->p1->p1', 'p1 = next、p2 = prior', 'text-indigo-600')
        + RC408.ui.statCard('判空位置', '第一层', '只有 cu->p1 非空才继续取 p1->p1')
        + RC408.ui.statCard('前进方向', 'cu = cu->p1', 'p2 正在被改写，只能走 p1', 'text-rose-600');
    }

    /* ---------- 提示条（按模式给考点） ---------- */
    let notice = '';
    if (s.op === 'dinsert') {
      notice = '<div class="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm text-indigo-900">💡 <b>四条语句顺序不能反</b>：先把 s 的两条接好（①②），再回头改旧链的两条（③④）。<b>第④条必须最后做</b>——提前做就丢掉 p 原来那条尾巴。' + (s.circ ? '本次是<b>双向循环链表</b>：p->next 永不为 NULL，第③条不用判空。' : '本次是<b>线性双向链表</b>：p 若是尾结点，第③条必须写成 <code>if (p->next) p->next->prior = s;</code>') + '</div>';
    } else if (s.op === 'ddelete') {
      notice = '<div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">✂️ <b>双向链表删除要改两条指针</b>：① p->prior->next = p->next（正向跨过）；② p->next->prior = p->prior（反向退回）。两条读的都是 p 自己的指针 ⟹ 可以互换，但<b>少任何一条都会留下一条指向已 free 结点的反向野指针</b>——单链表没有这个问题，这是双向链表独有的错法。</div>';
    } else if (s.op === 'singcirc') {
      const qIsTail = s.delCount > 0 && s.tailIdx === s.headIdx;
      notice = '<div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">📝 <b>2021-1 的要害是尾指针</b>：<code>if (p == q) p = h;</code> —— 只有被删的 q 正好是<b>尾结点</b>（表里只剩一个数据结点）时才改尾指针。'
        + (qIsTail ? '本次正好命中：尾指针已指回头结点。' : '本次不命中：尾结点还在，尾指针一步没动。')
        + ' 条件写成 <code>p != q</code> 就恰好反了（选项 C）；写成"先改 h->next 再取 q"则待删结点不可达、无法 free（选项 A）。</div>';
    } else {
      notice = '<div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">📝 <b>2026-2 的两个坑</b>：① <b>判空判在第一层</b>——<code>if (cu-&gt;p1 != null)</code> 成立才继续取 <code>cu-&gt;p1-&gt;p1</code>，写成两层都判或都不判都错；② <b>前进只能走 p1</b>——p2 正在被改写，<code>cu = cu-&gt;p2</code> 会走进刚改过的指针里，得到死循环或提前结束。改写完 prior 不再指向前驱，链表已不是标准双向链表。</div>';
    }

    /* ---------- 结点一览（链序 + 每个结点的 prior / next） ---------- */
    const tbl = chain.map(function (id) {
      const nd = nodes[id];
      const nx = nd.next === _dlNULL ? '∧' : (nodes[nd.next].isHead ? '头' : String(nodes[nd.next].val));
      const pv = nd.prev === _dlNULL ? '∧' : (nodes[nd.prev].isHead ? '头' : String(nodes[nd.prev].val));
      const cls = nd.isHead ? 'chip-future' : (id === s.doom ? 'chip-check' : (id === s.newIdx ? 'chip-hit' : (id === s.p ? 'chip-cur' : 'chip-mst')));
      const txt = (nd.isHead ? '头' : String(nd.val)) + (dbl ? ' │ prior→' + pv : '') + ' │ next→' + nx;
      return RC408.ui.chip(txt, cls + ' dl-tbl',
        (nd.isHead ? '头结点' : '数据 ' + nd.val) + '：' + (dbl ? 'prior → ' + (nd.prev === _dlNULL ? 'NULL' : '数据 ' + nodes[nd.prev].val) + '；' : '')
        + 'next → ' + (nd.next === _dlNULL ? 'NULL' : '数据 ' + nodes[nd.next].val));
    }).join('<span class="text-slate-300 self-center">›</span>');

    /* ---------- 语句进度徽片（模式①②③） ---------- */
    let stmtHtml = '';
    const strips = {
      dinsert: [['① s->prior = p', 's1'], ['② s->next = p->next', 's2'], ['③ p->next->prior = s', 's3'], ['④ p->next = s', 's4']],
      ddelete: [['① p->prior->next = p->next', 'unl1'], ['② p->next->prior = p->prior', 'unl2'], ['③ free(p)', 'free']],
      singcirc: [['① q = h->next', 's1'], ['② h->next = q->next', 's2'], ['③ if (p == q) p = h', 's3'], ['④ free(q)', 'free']],
    };
    if (strips[s.op]) {
      const items = strips[s.op];
      const order = ['init', 'move', 'found'].concat(items.map(function (it) { return it[1]; })).concat(['done']);
      const here = order.indexOf(s.step);
      stmtHtml = '<div>' + RC408.ui.sectionTitle('本次操作的语句序列（当前帧 = 靛框）') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
        + items.map(function (it) {
          const at = order.indexOf(it[1]);
          const cls = at === here ? 'chip-cur' : (at < here ? 'chip-mst' : 'chip-future');
          return RC408.ui.chip(it[0], cls + ' dl-stmt', at === here ? '本帧执行' : (at < here ? '已执行' : '还没执行'));
        }).join('<span class="text-slate-300">›</span>')
        + '</div>';
    }

    /* ---------- 模式④：逐结点处理进度 ---------- */
    let progHtml = '';
    if (s.op === 'p2fix') {
      const at = (s.step === 'chk' || s.step === 'setp2') ? s.visits - 1 : -1;
      const doneUpTo = s.step === 'done' ? chain.length - 1
        : s.step === 'forward' ? s.visits - 1 : s.visits - 2;
      progHtml = '<div>' + RC408.ui.sectionTitle('逐结点处理进度（cu 从头结点开始，绿 = 已改写）') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
        + chain.map(function (id, k) {
            const isAt = k === at;
            const isDone = k <= doneUpTo;
            return RC408.ui.chip(nodes[id].isHead ? '头' : String(nodes[id].val),
              (isAt ? 'chip-cur' : isDone ? 'chip-mst' : 'chip-future') + ' dl-prog',
              isAt ? '正在处理' : isDone ? '已改写 p2' : '还没处理');
          }).join('<span class="text-slate-300">›</span>')
        + '</div>';
    }

    /* ---------- 代价对照 ---------- */
    const costRows = [
      ['双向插入：改 4 条指针（顺序不能反）', s.op === 'dinsert'],
      ['双向删除：改 2 条指针 + free（一条都不能少）', s.op === 'ddelete'],
      ['单循环链表删首元：多的那一步是尾指针', s.op === 'singcirc'],
      ['逐结点改 prior：先判空、前进走没被改的链', s.op === 'p2fix'],
      ['单链表插删：只有 2 条指针（对照 ds-linkedlist）', false],
    ];
    const costHtml = '<div>' + RC408.ui.sectionTitle('四种操作的指针改写量（对照记忆）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
      + costRows.map(function (r) { return RC408.ui.chip(r[0], (r[1] ? 'chip-cur' : 'chip-future') + ' dl-cost', r[1] ? '本次操作' : ''); }).join('')
      + '</div>';

    /* ---------- 图例 ---------- */
    const legend = RC408.ui.legend('#6366f1', 'p 指针（当前结点 / 被删结点）')
      + RC408.ui.legend('#f59e0b', 'q 指针（临时指针）')
      + (s.op === 'singcirc' ? RC408.ui.legend('#0d9488', '尾指针（题干里的 P）') : '')
      + RC408.ui.legend('#94a3b8', 'next 直连（间隙上半）')
      + (dbl ? RC408.ui.legend('#a78bfa', 'prior 直连（间隙下半）；紫虚线 = 改写后的 prior 专用通道') : '')
      + RC408.ui.legend('#10b981', '本帧新建 / 改写的指针（绿色）')
      + RC408.ui.legend('#ef4444', '被改掉的旧指针（红虚线 + ✂）')
      + RC408.ui.legend('#94a3b8', '虚线框 = 悬空 / 已 free 的结点（都不在链上）');

    stage.innerHTML = '<div class="space-y-4">'
      + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + stats + '</div>'
      + notice
      + '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">'
      + svgAll + '</div>'
      + '<div>' + RC408.ui.sectionTitle('结点一览（链序：head → 数据结点 → ' + (s.circ ? '回到头结点' : '∧ NULL') + '；徽片上的 prior / next 就是指针域的值）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + (tbl || '<span class="text-xs text-slate-400">（空表）</span>') + '</div>'
      + stmtHtml
      + progHtml
      + costHtml
      + '<div style="display:flex;flex-wrap:wrap;gap:4px 20px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:12px">' + legend + '</div>'
      + '</div>';
  },
});
