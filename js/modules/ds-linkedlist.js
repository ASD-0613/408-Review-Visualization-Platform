'use strict';
/* ============================================================================
 * ds-linkedlist.js —— 【数据结构】单链表的操作与算法设计（窗28 新增；窗34 并入三个进阶算法）
 * ----------------------------------------------------------------------------
 * 前缀：_ll（顶层函数 / 常量都带前缀，避免经典 script 全局污染，见 handover §3.1-3）
 *
 * ── 七个模式（窗34 起）─────────────────────────────────────────────────────
 *   ①②③④ 局部指针手术（单链范式）：按位序插入 / 按位序删除 / 把 p 的后继搬表头(2024-1) / 删绝对值重复(2015-41)
 *   ⑤ 双指针一趟找倒数第 k 个（2009-42）        ⑥ 两条链的共同后缀(2012-42)    ⑦ 重排 L′(2019-41)
 *   **⑤⑥⑦ 走"多行布局"渲染路径（layout:'multi'），①②③④ 走原来的单链路径（layout:'one'）
 *     —— 旧路径一个字节都没动**（理由见下面"多行布局"一节）。
 *
 * ── 数据模型与不变量（先钉死再写实现，handover §3.9 P2）──────────────────────
 * 结点池 pool：下标即 id，**一旦建立终生不变**（动画、断言、日志全靠它对齐）
 *   结点 = { id, val, next, isHead }
 *     · val     数据域；头结点用 null 占位（渲染成「头」）
 *     · next    后继的**结点下标**；_llHEAD(−1) = NULL
 *     · isHead  是否头结点（带头结点时 id 0）
 *   头指针 headIdx：带头结点 ⟹ 指向头结点；不带头结点 ⟹ 指向第一个数据结点；−1 = 空表
 *   链 chain：从 headIdx 沿 next 走出的下标序列（**含头结点**；派生量，快照里也带上，
 *             这样渲染与断言都不必自己再走一遍）
 *   悬空 floating：已摘下、尚未接回的结点（delete 的 unlink 帧、move2head 的 stmt2/3）
 *   已释放 freed：已 free 的结点（delete 的 free 帧起；保留在画面上以说明"释放了什么"）
 *
 * 不变量（冒烟脚本逐类断言，见 §3.8-1）：
 *   ① 任何一帧：chain 无重复下标、每个 next ∈ {−1} ∪ 池下标、headIdx 可达；
 *   ② chain ∪ floating ∪ freed 两两不相交，且并集 = 已分配的结点池；
 *   ③ 数据结点个数 = chain 里 isHead 为假的结点个数；
 *   ④ 同一模式内 moves / visits 单调不减；
 *   ⑤ 稳定帧（init / done）里 floating **必须为空**——指针手术只可能在中途出现悬空结点；
 *   ⑥ 稳定帧的数据序列 = 该操作应得的结果（冒烟里与**独立参考实现**逐项比对，§3.8-5）。
 *
 * ── 多行布局（模式⑤⑥⑦；窗34 新增）与它的不变量 ──────────────────────────────
 * **为什么要单开一条渲染路径**：①②③④ 是"一条链 + 一行悬空/已释放"的单链范式；而 2012-42 是
 *   **两条链并排、尾部共享同一批结点**，2019-41 要在"前半 / 逆置后半 / 反过来插回去"之间来回搬，
 *   **行数逐帧变化**（1 行 / 2 行 / 3 行）。硬塞进单链路径会同时污染两条路径 ⟹ 旧路径一个字节不动，
 *   新模式全部走 `layout:'multi'`（`_llMxxx` 一组函数），代价只是多一份行渲染器。
 * 行 row = { key, name, headIdx, chain[], off, ptrs[], nullPtrs[], tailNote? }
 *   · name      行首那个小圆角标签（chip）上的文字，如 head1 / r / s / L1 —— **它就是这个链的头指针**
 *   · headIdx   这一行从哪个结点开始走（−1 = 空行，渲染成「∧ NULL（空）」）
 *   · chain     从 headIdx 沿 next 走出的下标序列（**派生量，快照里也带**，渲染与断言都不必再走一遍）
 *   · off       整行右移的**列数**（只给 2012-42 用：把两条链的前缀段右对齐，使共同后缀落在同样的列上
 *               ⟹ "尾部对齐"这件事在画面上**看得见**，也是本题"先求长度差"的由来）
 *   · ptrs      这一行上方的指针 chip：[{txt:'p', id, color}]；id 指向该行链上的某个结点
 *   · nullPtrs  已经越过表尾的指针：[{txt:'p', color}] —— 画在该行末尾的右上方，标注 p=∧
 * 不变量（`checkMultiInvariants`，模式⑤⑥⑦ 逐帧断言；与单链那六条**分开**，因为"并集 = 池"的成立方式不同）：
 *   ① 每一行的 chain：无重复下标、每个 next ∈ {−1} ∪ 池下标、headIdx 可达、且与 nodes 里的 next 完全一致；
 *   ② 同行 chain 里 isHead 为真的结点最多 1 个（只有带表头的那种行才有）；
 *   ③ **任取一帧：每个已分配结点恰好出现在一行里**（模式⑥ 是唯一的例外，见 ④）；
 *   ④ 模式⑥：共同后缀那一段**同时出现在两行**，且在两行里的**列位置完全相同**（这是"画了两遍"的口径，
 *      机器判据 = 取两行里同一 id 的 x 坐标，必须一一相等；不在共同后缀里的结点仍满足 ③）；
 *   ⑤ 模式⑤：p、q 只会在"指针 chip"或"越过末尾（nullPtrs）"里出现其一，不会两边都有；
 *   ⑥ 稳定帧（init / done）里 marks 不许留 'new'（"本帧新建"只属于中途帧）。
 *
 * ── 快照全量携带（§1.3 铁律：回退 / 跳帧才不出错）────────────────────────────
 *   step       init | move | found | linkq | linkp | scan | unlink | free
 *              | stmt1..stmt4 | keep | dup | done | walk | sync | fail | lenA | lenB
 *              | reset | align | mid | split | revinit | rev | mergeinit | merge
 *   nodes      结点池深拷贝 [{id,val,next,isHead}]
 *   headIdx / chain / floating / freed / len     本帧的链状态（全量）
 *   p / q      两个游标；−1 表示"头指针本身"（不带头结点时的头插 / 删首元）；null = 本帧不显示
 *   newIdx     本帧新建的结点（无则 −1）
 *   newLink    {from,to} 本帧**新建**的指针（from = 结点下标 或 −1 表示头指针）
 *   brokeLink  {from,to} 本帧**被断开**的旧指针 ⟹ 渲染成红色虚线 + ✂
 *   seen       删重复模式的辅助数组（全量拷贝）；其余模式 null
 *   moves / visits / delCount   累计统计（定位代价、访问结点数、删除个数）
 *   ── 以下四项只有模式⑤⑥⑦ 用（layout:'multi'）──
 *   rows       行数组（每帧重建、深拷贝语义：chain / ptrs 都是新数组）
 *   mark       {结点下标: 'new'|'cur'|'q'|'hit'|'dim'} 本帧配色（渲染时优先于默认配色）
 *   shared     {from: 起始列, n: 列数} 共同后缀的列区间（模式⑥；画一个跨行的虚线框）
 *   phase      本帧处于算法的哪一段（walk/align/sync/rev/merge…），供页面上的进度徽片用
 *
 * ── 口径（408 / 严蔚敏教材，经 2009-42、2012-42、2015-41、2016-1、2019-41、
 *     2021-1、2024-1 七道真题印证；窗34 新增 ⑤⑥⑦ 三个算法的口径）────────────────
 *   插入（先接后断）：q->next = p->next;  p->next = q;
 *   删除（先存后跨）：q = p->next;  p->next = q->next;  free(q);
 *   带头结点 ⟹ 第 1 个位置与中间位置是**同一套代码**；不带头结点 ⟹ 表头插删要改头指针 h。
 *   按位序插入 / 删除的代价 = **定位前驱 p 的代价** = i−1 次指针后移 ⟹ O(n)；
 *   头插（i=1）无需移动 ⟹ O(1)；尾插（i=n+1）要走完整表 ⟹ O(n)。
 *   2024-1 的四条语句：q=p->next; p->next=q->next; q->next=h->next; h->next=q;
 *     = 把 p 的后继**摘下并头插到表头**（前两句是删除、后两句是头插）——本模块第 3 个模式逐步演示。
 *   2015-41 的思路：辅助数组记录已出现的绝对值，只需一趟扫描 ⟹ O(m) 时间、O(n) 空间。
 * 2009-42（模式⑤）双指针：p、q 都从第一个数据结点出发；**p 先单独走 k 步**，之后 p、q 同步后移；
 *     p 走到 NULL 时 q 正好在倒数第 k 个（= 正数第 n−k+1 个）。p 一共走 n 步 ⟹ **一趟遍历 O(n)**、
 *     只用两个指针 ⟹ O(1)。**k > n 时 p 会在走满 k 步前先到 NULL ⟹ 返回 0（查找失败）**——
 *     失败分支由本模式显式演示（选择 k > 表长的预设）。
 * 2012-42（模式⑥）共同后缀：**先各走一遍求出两条链的长度** len1、len2（O(m+n)）；
 *     让**长的那条**先走 |len1−len2| 步（"尾部对齐"）；然后两条链的指针**同步后移**，
 *     直到 **指针相等（p == q）**——此时指向的结点就是共同后缀的起始位置。空间 O(1)。
 *     ⚠ 本题最大的坑：**必须比较指针、不能比较数据**——两条链的前缀里完全可能出现相同的值
 *     （本模块"⚠️ 数据相同但结点不同"预设就是这个陷阱的构造数据）。
 * 2019-41（模式⑦）重排 L′ = (a1, an, a2, an−1, …)：题干只给了要求（O(1) 空间 + 时间尽可能高效），
 *     标准解法的三步（本模块逐步演示；**这三步是按题干要求推导的通行解法**，不是真题原文的措辞）：
 *       ① **找中间结点**：快慢指针 p 每次 2 步、q 每次 1 步，q 到尾时 p 落在 ⌈n/2⌉ 处 ⟹ O(n)；
 *       ② **把后半段就地逆置**：头插法（每次把 r 的后继摘下来插到 s 的最前面）⟹ O(n)、O(1) 空间；
 *       ③ **交替合并**：把后半段的结点依次插到前半段相邻两结点之间（r = p->next; p->next = q;
 *          q = q->next; p->next->next = r; p = r;）⟹ O(n)。总时间 O(n)、额外空间 O(1)。
 *     题干原文（`考情缓存/2019_真题.txt:377`）："请设计一个空间复杂度为O(1)且时间上尽可能高效的算法，
 *     重新排列L 中的各结点"；L′ 的构成见同文件 :379-401。
 *
 * ── 可查询类名（不配 CSS，只为 harness 断言 / 截图定位；§4.6 窗4 立、窗26 沿用）──
 *   ll-node / ll-head / ll-new / ll-val      结点盒（头结点、本帧新结点）
 *   ll-floating / ll-freed                   悬空 / 已释放的结点盒
 *   ll-arrow / ll-arrow-new / ll-head-arrow  链上箭头（绿色 = 本帧新建）
 *   ll-null                                  末结点的 ∧ NULL 标记
 *   ll-cut                                   被断开的旧指针（红色虚线 + ✂）
 *   ll-newlink                               单独画出的新指针（悬空结点 → 链上）
 *   ll-ptr-p / ll-ptr-q / ll-ptr-head        p / q / head 指针标签
 *   ll-det-label                              悬空 / 已释放那一行的说明文字
 *   ll-tbl / ll-seen / ll-stmt / ll-cost      结点一览 / 辅助数组 / 四条语句 / 代价对照的徽片
 *   ── 多行布局专有（模式⑤⑥⑦；窗34 新增）──
 *   ll-row / ll-row-name                      一行链（g 元素）/ 行首那个头指针 chip
 *   ll-shared / ll-shared-label               共同后缀的跨行虚线框 / 它的说明文字（模式⑥）
 *   ll-nullptr                                已越过表尾的指针 chip（p=∧）
 *   ll-note / ll-phase                        本帧动作条 / 三步进度徽片（模式⑦）
 * ========================================================================== */

/* ------------------------------ 布局常量（坐标一律由 k 算出，不手写） ------------------------------ */
const _llNW   = 68;    // 结点盒宽 = 数据域 46 + 指针域 22
const _llDW   = 46;    // 数据域宽
const _llNH   = 34;    // 结点盒高
const _llGAP  = 42;    // 相邻结点盒的水平间隙（放箭头）
const _llX0   = 76;    // 链上第 0 个结点盒左边 x（左侧留给 head 标签与箭头）
const _llTOP  = 54;    // 结点行顶边 y（上方放 p 指针标签）
const _llLAB  = 26;    // 指针标签中心到盒边的垂直距离
const _llHEAD = -1;    // 哨兵：NULL；同时用作"头指针本身"这个伪结点下标

/* ------------------------------ 纯几何 / 纯工具（_ll 前缀） ------------------------------ */

/** 从 headIdx 沿 next 走出的链（含头结点）；带 visited 保护，即使数据异常也不死循环 */
function _llChain(nodes, headIdx) {
  const out = [], seen = {};
  let cur = headIdx;
  while (cur !== _llHEAD && cur !== null && cur !== undefined && cur >= 0 && !seen[cur]) {
    seen[cur] = true;
    out.push(cur);
    cur = nodes[cur] ? nodes[cur].next : _llHEAD;
  }
  return out;
}

/** 链上数据结点个数（头结点不计） */
function _llLen(nodes, chain) {
  let c = 0;
  for (let i = 0; i < chain.length; i++) if (!nodes[chain[i]].isHead) c++;
  return c;
}

/** 数据序列文本，如 "5 → 9 → 12"（供 desc / 日志；空表给「（空表）」） */
function _llSeqText(nodes, chain) {
  const vals = [];
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    if (!nodes[id].isHead) vals.push(String(nodes[id].val));
  }
  return vals.length ? vals.join(' → ') : '（空表）';
}

/** 画布几何：结点盒 x 由链上名次 k 算出；detY 是"悬空 / 已释放"行的顶边。
 *  ⚠ 窗28 原分辨率目视踩出来的一组"相对位置"缺陷，全部靠这一组 y 恒定式解决（§3.8-18）：
 *    · q 徽标占 [TOP+NH+LAB−11, TOP+NH+LAB+11]（= 103~125）；
 *    · 幽灵 / 接链折线的**水平通道** midY 必须整条落在 q 徽标**之下**（否则线被徽标吃掉一截）；
 *    · "悬空 / 已 free"那一行的说明文字（detLabelY）必须在 midY **之上**（否则线穿过文字）；
 *    · 该行盒子（detY）必须在 midY 之下，且留下画 q 徽标（detY+NH+26）的高度。
 *    另外：说明文字用**短标签**并左对齐在 x=8（右端 ≈85px），而两行的所有竖线都落在 x ≥ 110
 *    （链上第 0 个盒 cx=110、悬空第 0 个盒 cx=110）⟹ 竖线天然不会穿过说明文字。
 *    没有悬空行时 midY 收紧到 TOP+NH+42（省 40px 空白）。 */
function _llGeom(nChain, nDet) {
  const step = _llNW + _llGAP;
  const W = Math.max(_llX0 + Math.max(nChain, 1) * step + 34, 460);
  const detY = _llTOP + _llNH + 84;
  const detLabelY = detY - 44;
  const midY = nDet ? (detLabelY + 22) : (_llTOP + _llNH + 42);
  const H = nDet ? (detY + _llNH + 40) : (_llTOP + _llNH + 54);
  return { W: W, H: H, detY: detY, detLabelY: detLabelY, midY: midY, step: step, xOf: function (k) { return _llX0 + k * step; } };
}

/** 结点盒配色：本帧新结点（绿）> 待删（红，仅 delete）> q（琥珀）> p（靛）> 头结点（灰）> 普通 */
function _llCell(s, id) {
  if (id === s.newIdx) return { f: '#ecfdf5', t: '#065f46', st: '#10b981' };
  if (s.op === 'delete' && id === s.q) return { f: '#fef2f2', t: '#991b1b', st: '#ef4444' };
  if (id === s.q) return { f: '#fffbeb', t: '#92400e', st: '#f59e0b' };
  if (id === s.p) return { f: '#eef2ff', t: '#3730a3', st: '#6366f1' };
  if (s.nodes[id] && s.nodes[id].isHead) return { f: '#f1f5f9', t: '#475569', st: '#94a3b8' };
  return { f: '#ffffff', t: '#334155', st: '#cbd5e1' };
}

/** 结点盒：数据域 + 指针域（指针域的点：实心 = 有后继，空心 = NULL） */
function _llBox(x, y, nd, col, cls) {
  const hasNext = nd.next !== _llHEAD;
  return '<g class="' + cls + '" transform="translate(' + x + ',' + y + ')">'
    + '<rect x="0" y="0" width="' + _llNW + '" height="' + _llNH + '" rx="8" fill="' + col.f
    + '" stroke="' + col.st + '" stroke-width="2.2"' + (col.dash ? ' stroke-dasharray="5 4"' : '') + '/>'
    + '<line x1="' + _llDW + '" y1="1.5" x2="' + _llDW + '" y2="' + (_llNH - 1.5)
    + '" stroke="' + col.st + '" stroke-width="1.6" opacity="0.7"/>'
    + '<text x="' + (_llDW / 2) + '" y="' + (_llNH / 2) + '" dy="0.35em" text-anchor="middle" class="ll-val"'
    + ' style="font:800 13px Consolas,ui-monospace,monospace;fill:' + col.t + '">'
    + RC408.util.esc(nd.isHead ? '头' : String(nd.val)) + '</text>'
    + '<circle cx="' + (_llDW + 11) + '" cy="' + (_llNH / 2) + '" r="2.7" fill="' + (hasNext ? col.st : 'none')
    + '" stroke="' + col.st + '" stroke-width="1.4"/>'
    + '</g>';
}

/** 箭头（含三角箭头），cls 供断言选择 */
function _llArrow(x1, x2, y, cls, color, w) {
  return '<g class="' + cls + '">'
    + '<line x1="' + x1 + '" y1="' + y + '" x2="' + (x2 - 7) + '" y2="' + y + '" stroke="' + color
    + '" stroke-width="' + w + '" stroke-linecap="round"/>'
    + '<polygon points="' + x2 + ',' + y + ' ' + (x2 - 9) + ',' + (y - 4.5) + ' ' + (x2 - 9) + ',' + (y + 4.5)
    + '" fill="' + color + '"/></g>';
}

/* ============================================================================
 * 多行布局渲染器（窗34 新增；只服务模式⑤⑥⑦）
 * ----------------------------------------------------------------------------
 * 与单链路径的关系：**完全并列、互不调用**。单链路径（上面那批 _llXxx + render 的 'one' 分支）
 *   一个字节都没动，冒烟与 harness 仍按原样覆盖它；这里只额外提供"一行 = 一条链"的画法。
 *
 * 坐标一律由列号算出：行 r 上第 k 个盒的左上角 = (xOf(k + off), rowY(r))，off = 整行右移的列数。
 * 竖直方向留够三条带（从下到上）：结点盒 [y, y+NH]、指针 chip [-37, -15]、行首 chip 与盒同高。
 *   行距 _llMROW = NH + 86 ⟹ 下一行的指针 chip 顶边（rowY(r+1)-37）与上一行盒底（rowY(r)+34）
 *   之间还剩 120-34-37 = 49px 空白，指针 chip 与上一行盒子**不会压盖**。
 * ========================================================================== */
const _llMX0  = 124;   // 多行布局：第 0 列的盒左边 x（左侧留给行首 chip + head 箭头）
const _llMROW = 120;   // 相邻两行的行距（= 盒高 34 + 86）
const _llMTOP = 46;    // 第一行盒顶边 y

/** 多行几何：nRows 行、maxCols 列；extraW 给"越过末尾的指针 chip"留宽，extraH 给共同后缀的说明文字留高 */
function _llMGeom(nRows, maxCols, extraW, extraH) {
  const step = _llNW + _llGAP;
  return {
    W: Math.max(_llMX0 + Math.max(maxCols, 1) * step + 36 + (extraW || 0), 520),
    H: _llMTOP + Math.max(nRows - 1, 0) * _llMROW + _llNH + 34 + (extraH || 0),
    step: step,
    nRows: nRows,
    rowY: function (r) { return _llMTOP + r * _llMROW; },
    xOf: function (k) { return _llMX0 + k * step; },
  };
}

/** 圆角 chip（指针 / 行首标签共用）；宽度随文字长度走，避免中文或长标签被截断 */
function _llMChip(x, y, txt, color, cls, light) {
  const w = Math.max(26, String(txt).length * 7.8 + 12);
  return '<g class="' + cls + '">'
    + '<rect x="' + (x - w / 2) + '" y="' + (y - 11) + '" width="' + w + '" height="22" rx="7" fill="'
    + (light ? '#e2e8f0' : color) + '" stroke="' + (light ? '#94a3b8' : 'none') + '" stroke-width="1.2"/>'
    + '<text x="' + x + '" y="' + y + '" dy="0.35em" text-anchor="middle"'
    + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:' + (light ? '#334155' : '#fff') + '">'
    + RC408.util.esc(txt) + '</text></g>';
}

/** 多行布局的结点配色：本帧 mark 优先，其次头结点，再次普通 */
function _llMCell(s, id) {
  const m = (s.mark || {})[id];
  if (m === 'new') return { f: '#ecfdf5', t: '#065f46', st: '#10b981' };
  if (m === 'cur') return { f: '#eef2ff', t: '#3730a3', st: '#6366f1' };
  if (m === 'q') return { f: '#fffbeb', t: '#92400e', st: '#f59e0b' };
  if (m === 'hit') return { f: '#f0fdfa', t: '#115e59', st: '#14b8a6' };
  if (m === 'dim') return { f: '#f8fafc', t: '#94a3b8', st: '#cbd5e1' };
  if (s.nodes[id] && s.nodes[id].isHead) return { f: '#f1f5f9', t: '#475569', st: '#94a3b8' };
  return { f: '#ffffff', t: '#334155', st: '#cbd5e1' };
}

/** 画一行：行首 chip（= 这一行的头指针）→ 链上箭头 → ∧ NULL / 尾部说明 → 结点盒 → 行上方指针 chip */
function _llMRow(s, row, r, g) {
  const y = g.rowY(r), cy = y + _llNH / 2, chain = row.chain || [], nodes = s.nodes;
  const off = row.off || 0;
  const xAt = function (k) { return g.xOf(k + off); };
  let out = '';

  /* ① 行首 chip（它就是这个链的头指针 h / r / s） */
  const nameW = Math.max(42, String(row.name).length * 7.8 + 14);
  out += '<g class="ll-row-name">'
    + '<rect x="8" y="' + (cy - 11) + '" width="' + nameW + '" height="22" rx="7" fill="#e2e8f0"'
    + ' stroke="#94a3b8" stroke-width="1.2"/>'
    + '<text x="' + (8 + nameW / 2) + '" y="' + cy + '" dy="0.35em" text-anchor="middle"'
    + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#334155">' + RC408.util.esc(row.name) + '</text></g>';
  if (chain.length) {
    out += _llArrow(8 + nameW + 10, xAt(0), cy, 'll-arrow ll-head-arrow', '#64748b', 2.2);
  } else {
    out += '<text x="' + (8 + nameW + 12) + '" y="' + cy + '" dy="0.35em" class="ll-null"'
      + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#94a3b8">∧ NULL（空）</text>';
  }

  /* ② 行内箭头 + 末结点的 ∧ / 尾部说明（切分那一帧用它标"p->next = NULL"） */
  for (let k = 0; k + 1 < chain.length; k++) {
    out += _llArrow(xAt(k) + _llNW, xAt(k + 1), cy, 'll-arrow', '#94a3b8', 2.2);
  }
  if (chain.length) {
    const last = chain[chain.length - 1], lx = xAt(chain.length - 1) + _llNW;
    if (nodes[last].next === _llHEAD) {
      if (row.tailNote) {
        out += '<text x="' + (lx + 10) + '" y="' + cy + '" dy="0.35em" class="ll-tailnote"'
          + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:' + (row.tailNote.color || '#ef4444') + '">'
          + RC408.util.esc(row.tailNote.text) + '</text>';
      } else {
        out += _llArrow(lx, lx + 20, cy, 'll-arrow ll-null', '#94a3b8', 2);
        out += '<text x="' + (lx + 26) + '" y="' + cy + '" dy="0.35em" class="ll-null"'
          + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#94a3b8">∧ NULL</text>';
      }
    }
  }

  /* ③ 结点盒（画在箭头之后，压住箭头起点）；mark 也进类名，便于 harness 定位"本帧结论" */
  chain.forEach(function (id, k) {
    const mk = (s.mark || {})[id];
    out += _llBox(xAt(k), y, nodes[id], _llMCell(s, id),
      'll-node' + (nodes[id].isHead ? ' ll-head' : '') + (id === s.newIdx ? ' ll-new' : '')
      + (mk ? ' ll-mark-' + mk : ''));
  });

  /* ④ 行上方的指针 chip（p / q / r）+ 已经越过表尾的 chip（p=∧） */
  (row.ptrs || []).forEach(function (p) {
    const k = chain.indexOf(p.id);
    if (k < 0) return;
    const cx = xAt(k) + _llNW / 2;
    out += '<line x1="' + cx + '" y1="' + (y - 15) + '" x2="' + cx + '" y2="' + (y - 2) + '" stroke="' + p.color
      + '" stroke-width="1.6" stroke-dasharray="3 3"/>'
      + _llMChip(cx, y - 26, p.txt, p.color, 'll-ptr ll-ptr-' + String(p.txt).replace(/[^A-Za-z0-9]/g, ''));
  });
  (row.nullPtrs || []).forEach(function (p, j) {
    const ex = xAt(Math.max(chain.length - 1, 0)) + _llNW;
    out += _llMChip(ex + 40 + j * 36, y - 26, p.txt + '=∧', p.color,
      'll-ptr ll-nullptr ll-ptr-' + String(p.txt).replace(/[^A-Za-z0-9]/g, ''));
  });

  return '<g class="ll-row">' + out + '</g>';
}

/** 多行 SVG 主体：共同后缀虚线框（模式⑥）→ 各行 → 说明文字 */
function _llMSvg(s) {
  const rows = s.rows || [];
  const maxCols = rows.reduce(function (a, r) { return Math.max(a, r.chain.length + (r.off || 0)); }, 1);
  const hasNull = rows.some(function (r) { return (r.nullPtrs || []).length; });
  const g = _llMGeom(rows.length, maxCols, hasNull ? 88 : 0, s.shared ? 40 : 0);
  let svg = '';

  /* 共同后缀：跨行的虚线框（画在最底层当背景），框下给一行说明 */
  if (s.shared && s.shared.n > 0) {
    const x1 = g.xOf(s.shared.from) - 8, x2 = g.xOf(s.shared.from + s.shared.n - 1) + _llNW + 8;
    const y1 = g.rowY(0) - 14, y2 = g.rowY(rows.length - 1) + _llNH + 12;
    svg += '<rect class="ll-shared" x="' + x1 + '" y="' + y1 + '" width="' + (x2 - x1) + '" height="' + (y2 - y1)
      + '" rx="12" fill="#f0fdfa" stroke="#14b8a6" stroke-width="2" stroke-dasharray="7 5"/>'
      + '<text x="' + ((x1 + x2) / 2) + '" y="' + (y2 + 24) + '" text-anchor="middle" class="ll-shared-label"'
      + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#0f766e">共同后缀：两条链共用同一批结点'
      + '（所以画了两遍、列位置完全对齐）</text>';
  }
  rows.forEach(function (row, r) { svg += _llMRow(s, row, r, g); });

  return '<svg viewBox="0 0 ' + g.W + ' ' + g.H + '" class="w-full h-auto mx-auto" style="max-width:'
    + Math.max(g.W, 520) + 'px">' + svg + '</svg>';
}

/* ============================================================================
 * 多行布局的页面装饰（统计卡 / 提示条 / 附加表 / 图例）——只服务模式⑤⑥⑦
 * 一律用 RC408.ui.* + 内联 flex（离线没有 Tailwind 工具类也不会塌，§4.7 窗26）
 * ========================================================================== */
function _llMultiStats(s, model) {
  const num = s.num || {};
  let cards = '';
  if (s.op === 'kth') {
    const kk = model.k;
    const ok = num.ok !== false;
    cards = RC408.ui.statCard('表长 n', String(s.len), '一串结点，p 要走完整整一趟')
      + RC408.ui.statCard('k（倒数第 k 个）', String(kk), kk <= s.len ? '正数第 n − k + 1 = ' + (s.len - kk + 1) + ' 个' : 'k 比表长大 ⟹ 注定失败', 'text-indigo-600')
      + RC408.ui.statCard('指针移动次数', String(s.moves), 'p 走 n 步、q 走 n − k 步 ⟹ 合起来仍是 O(n)')
      + RC408.ui.statCard('结论', ok ? (num.res === undefined ? '进行中' : '数据 ' + num.res) : '返回 0',
        ok ? 'q 落后的结点数始终 = k' : 'p 先到 NULL ⟹ 查找失败', ok ? 'text-emerald-600' : 'text-rose-600');
  } else if (s.op === 'suffix') {
    const done = num.res !== undefined;
    const diff = Math.abs(model.lenA - model.lenB);   /* ⚠ 长度差是**输入的属性**，与"已对齐几步"是两回事 */
    cards = RC408.ui.statCard('链 1 长度', String(model.lenA), '第一趟数出来的')
      + RC408.ui.statCard('链 2 长度', String(model.lenB), '第二趟数出来的')
      + RC408.ui.statCard('长度差', String(diff),
        diff ? '让长链的指针先走这么多步 ⟹ 尾部对齐（已走 ' + (num.align || 0) + ' 步）' : '两条链一样长 ⟹ 不用对齐', 'text-indigo-600')
      + RC408.ui.statCard('共同后缀起点', done ? '数据 ' + num.res : '进行中',
        '同步 ' + (num.sync || 0) + ' 步后 p == q；后缀共 ' + model.suf + ' 个结点', done ? 'text-emerald-600' : 'text-slate-800');
  } else {
    const total = model.n;   /* ⚠ 表长要用 model.n：第一行（前半/L′ 在建）的 s.len 只是它的数据结点数 */
    cards = RC408.ui.statCard('表长 n', String(total), '全程不新建结点')
      + RC408.ui.statCard('前半 / 后半', model.m + ' / ' + (total - model.m), '前半含头结点，中间结点留在前半')
      + RC408.ui.statCard('已逆置', (num.rev || 0) + ' / ' + (total - model.m), '头插法把后半段就地翻转', 'text-indigo-600')
      + RC408.ui.statCard('已合并', (num.merged || 0) + ' / ' + (total - model.m), '每次插到前半相邻两结点之间');
  }
  return '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + cards + '</div>';
}

function _llMultiNotice(s, model) {
  const num = s.num || {};
  if (s.op === 'kth') {
    if (num.ok === false) {
      return '<div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">🚫 <b>失败分支</b>：'
        + 'k = ' + model.k + ' 大于表长 ' + s.len + '。算法在"p 已到 NULL"这一步就返回 0——'
        + '先判空、再后移，是双指针题必须写的一步（少写就是解引用空指针）。</div>';
    }
    return '<div class="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm text-indigo-900">💡 <b>一趟 vs 两趟</b>：'
      + '把表长先数出来、再走 n − k 步要<b>两趟</b>；双指针只用一趟——这就是 2009-42 说的"时间上尽可能高效"。'
      + 'p 走过的总步数正好是 n，q 走的步数正好是 n − k。</div>';
  }
  if (s.op === 'suffix') {
    return '<div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">⚠️ <b>比指针，不比数据</b>：'
      + '循环条件是 <b>p == q</b>（同一个结点）。两条链的前缀里完全可能存着与共同后缀相同的值——'
      + '一旦改成比较 data，就会在"值相同但结点不同"的位置提前收工（本模块"⚠️ 共同后缀的坑"预设就是这个陷阱）。</div>';
  }
  if (s.op === 'reorder' && s.phase === 'merge') {
    return '<div class="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm text-indigo-900">🧩 <b>就地插入的四条语句</b>：'
      + 'r = p->next; p->next = q; q = q->next; p->next->next = r; p = r; ——'
      + '先记下 p 原来的后继 r，再让 p 指向 q，最后把 r 接回 q 后面。没有这一步，前半段剩下的结点就全丢了。</div>';
  }
  return '<div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">📝 <b>2019-41 的三步</b>：'
    + '① 快慢指针找中间结点（p 走 2 步、q 走 1 步）；② 后半段就地头插逆置；③ 把后半段的结点依次插到前半段相邻两结点之间。'
    + '三步都只改指针 ⟹ 时间 O(n)、空间 O(1)，正合题干"空间复杂度 O(1) 且时间上尽可能高效"。</div>';
}

function _llMultiTables(s, model) {
  let html = '';
  if (s.op === 'kth') {
    /* 每个数据结点的"倒数序号"：从表尾往头数，正好让"q 落在倒数第 k 个"看得见 */
    const dataIds = s.chain.filter(function (id) { return !s.nodes[id].isHead; });
    const chips = dataIds.map(function (id, i) {
      const back = dataIds.length - i;
      const isQ = s.mark && s.mark[id] === 'hit';
      return RC408.ui.chip('数据 ' + s.nodes[id].val + '（倒数第 ' + back + '）', isQ ? 'chip-hit' : 'chip-mst',
        '正数第 ' + (i + 1) + ' 个，倒数第 ' + back + ' 个' + (isQ ? '：本帧被 q 指着' : ''));
    }).join('<span class="text-slate-300 self-center">›</span>');
    html += '<div>' + RC408.ui.sectionTitle('每个数据结点的"倒数序号"（从表尾往头数；绿 = 本帧 q 指着它）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' + chips + '</div>';
    html += '<div>' + RC408.ui.sectionTitle('两个指针的距离（p 落后 / q 落后）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + RC408.ui.chip('p 已走 ' + (s.num && s.num.steps !== undefined ? s.num.steps : 0) + ' 步',
        s.phase === 'walk' ? 'chip-cur' : 'chip-mst', 'p 从第一个数据结点开始走的步数')
      + RC408.ui.chip('q 已走 ' + (s.num && s.num.qsteps !== undefined ? s.num.qsteps : 0) + ' 步',
        s.phase === 'sync' ? 'chip-cur' : 'chip-mst', 'q 只在第二阶段动')
      + RC408.ui.chip('差距 = ' + (s.num && s.num.steps !== undefined ? s.num.steps - (s.num.qsteps || 0) : 0) + ' 个结点',
        'chip-future', 'p 与 q 之间的结点数，第一阶段涨到 k，之后保持不变')
      + '</div>';
  } else if (s.op === 'suffix') {
    const shIds = s.chain.filter(function (id) { return !s.nodes[id].isHead; })
      .filter(function (id) { return s.shared && s.chain.indexOf(id) >= (s.shared.from - (s.rows[0].off || 0)); });
    const chips = shIds.map(function (id) {
      return RC408.ui.chip('数据 ' + s.nodes[id].val, (s.mark && s.mark[id] === 'hit') ? 'chip-hit' : 'chip-mst',
        '共同后缀里的结点（两条链共用同一个结点）');
    }).join('<span class="text-slate-300 self-center">→</span>');
    html += '<div>' + RC408.ui.sectionTitle('共同后缀（两条链共用同一批结点，链 1、链 2 的 next 都指进这里）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' + (chips || '<span class="text-xs text-slate-400">（无）</span>') + '</div>';
    html += '<div>' + RC408.ui.sectionTitle('两个指针的处境（判断相等用的是"指针"，不是"数据"）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + RC408.ui.chip('p == q ？', (s.num && s.num.res !== undefined) ? 'chip-hit' : 'chip-future',
        (s.num && s.num.res !== undefined) ? '已经相等：指向共同后缀的第一个结点' : '还没相等，继续同步后移')
      + RC408.ui.chip('已同步 ' + ((s.num && s.num.sync) || 0) + ' 步', 'chip-mst', '尾部对齐之后的同步次数')
      + '</div>';
  } else {
    const order = ['mid', 'split', 'rev', 'merge', 'done'];
    const here = order.indexOf(s.phase);
    const items = [['① 找中间结点（快慢指针）', 'mid'], ['② 后半段就地逆置（头插法）', 'rev'], ['③ 交替合并回原链', 'merge']];
    const posOf = function (key) {
      if (key === 'mid') return 0;
      if (key === 'split') return 1;
      if (key === 'rev') return 2;
      if (key === 'merge') return 3;
      return 4;              // done
    };
    html += '<div>' + RC408.ui.sectionTitle('2019-41 的三步（当前帧 = 靛框，已走过 = 灰）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + items.map(function (it) {
        const at = posOf(it[1]), now = posOf(s.phase);
        const cls = at === now ? 'chip-cur' : (at < now ? 'chip-mst' : 'chip-future');
        return RC408.ui.chip(it[0], cls + ' ll-phase', at === now ? '本帧执行' : (at < now ? '已执行' : '还没执行'));
      }).join('<span class="text-slate-300">›</span>')
      + '</div>';
    const cur = _llSeqText(s.nodes, s.chain);
    html += '<div>' + RC408.ui.sectionTitle('第一行现在的样子（它就是 L′ 的在建状态：在原链上就地插入）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + RC408.ui.chip(cur, 'chip-cur', '当前链上从 head 走的结点序列') + '</div>';
  }
  return html;
}

function _llMultiLegend(s) {
  let L = RC408.ui.legend('#6366f1', 'p 指针（本帧当前）') + RC408.ui.legend('#f59e0b', 'q 指针（另一个游标）');
  if (s.op === 'reorder') L += RC408.ui.legend('#0ea5e9', 'r 指针（p 的后继，合并时临时用）');
  L += RC408.ui.legend('#10b981', '本帧刚接上的结点 / 指针（绿）');
  if (s.op === 'suffix') L += RC408.ui.legend('#14b8a6', '共同后缀（跨行虚线框 = 两条链共用的同一批结点）');
  if (s.op === 'kth') L += RC408.ui.legend('#94a3b8', '点 p=∧ 的灰框 = 这个指针已经越过表尾（NULL）');
  L += RC408.ui.legend('#64748b', '行首 chip = 这一行的头指针（head / r / s）');
  return L;
}

/* ============================================================================ */
RC408.registerModule({
  id: 'ds-linkedlist',
  mode: 'stepper',
  title: '单链表的操作与算法设计（指针手术 + 双指针 / 共同后缀 / 重排 L′）',

  theory: `
> **为什么要有它**：单链表的插入删除**不搬数据、只改指针**——指针赋值的先后顺序写反，就会丢掉整条尾巴或者再也找不到要释放的结点；而算法设计大题考的正是"只靠指针走一趟"能解决什么。
> **怎么实现**：局部手术＝插入**先接后断**、删除**先存后跨**；进阶算法＝**双指针**（快慢指针找倒数第 k 个 / 找中点）、**长度对齐后同步走**（共同后缀）、**就地逆置 + 交替合并**（重排 L′）。
> **记住什么**：带头结点能让"第 1 个位置"和"中间位置"共用同一套代码；进阶算法全部是**一趟或两趟扫描 + 常数个指针** ⟹ 时间线性、空间 O(1)。

## 指针手术的两条铁律
- **插入先接后断**：先 p 的后继交给 q（q->next = p->next），再让 p 指向 q（p->next = q）。反过来做，p 原来的后继就**再也找不回来**（尾巴整条丢失）；
- **删除先存后跨**：先 q = p->next 记住待删结点，再 p->next = q->next 跨过它，最后 free(q)。反过来做，跨过之后 q 已经不可达，**无法释放**（内存泄漏）；
- 两条都只是"改两条指针"，本身 \\(O(1)\\)；真正费时间的是**找前驱 p**。

## 带头结点 vs 不带头结点
| 比较项 | 带头结点 | 不带头结点 |
| --- | --- | --- |
| 表头插入 / 删除 | p 就是头结点，与中间位置**同一套代码** | 要改头指针 h **本身**（此时 p 是"头指针"这个伪结点） |
| 空表表示 | 头结点的 next 为 NULL | 头指针 h 为 NULL |
| 代价 | 多占一个结点的空间 | 省一个结点，但首元结点的插删要特判 |

## 四个位置的代价（表长 n，假定已定位到前驱 p）
| 操作 | 指针移动次数 | 时间复杂度 |
| --- | --- | --- |
| 头插（i=1） | 0 | \\(O(1)\\) |
| 任意位序插入（i） | i−1 | \\(O(n)\\) |
| 尾插（i=n+1） | n | \\(O(n)\\) |
| 按位序删除（i） | i−1 | \\(O(n)\\) |

- **头插 \\(O(1)\\) 的前提**是"已经拿到头结点"——所以**头插法建表**整体 \\(O(n)\\)，且得到的链表与原序列**相反**；**尾插法**若不维护尾指针，每插一个都要走完整表（这正是"尾插法建表 \\(O(n^2)\\)"的来源）；
- **2024-1 的语句序列**：q = p->next；p->next = q->next；q->next = h->next；h->next = q —— 前两句是**删除**（把 q 从原位置摘下），后两句是**头插**（把 q 接到表头），合起来就是"把 p 的后继搬到表头"；
- **2015-41 的思路**：开一个 n+1 格的辅助数组记录已出现过的绝对值，只需对链表做**一趟**扫描 ⟹ \\(O(m)\\) 时间、\\(O(n)\\) 空间，是"以空间换时间"的标准范例；
- **单循环链表**删首元还要顺带维护尾指针（2021-1 的选项 C 就写着 if(p != q) p = h）——本模块演示线性单链表，循环链表的差别只在"尾指针要不要改"。

## 进阶算法一：双指针一趟找倒数第 k 个（2009-42）
| 步骤 | 做法 | 为什么 |
| --- | --- | --- |
| ① 起步 | p、q **都**指向第一个数据结点 | 两个指针，只多花 O(1) 空间 |
| ② p 先走 k 步 | p 单独后移 k 次（中途到 NULL 就说明 k 超过表长，返回 0） | 拉开 k 个结点的"距离" |
| ③ 同步走 | p、q 一起后移，直到 **p == NULL** | 距离始终是 k |
| ④ 结论 | 此时 q 指向的就是**倒数第 k 个**（正数第 \\(n-k+1\\) 个） | p 走了 n 步、q 走 \\(n-k\\) 步 |

- 朴素做法是**先求表长 n、再走 n−k 步**——那要**两趟**；双指针把两趟压成**一趟**，这是 2009-42 要的"时间上尽可能高效"；
- 全程只看指针、不改结构 ⟹ 时间 \\(O(n)\\)、空间 \\(O(1)\\)；**k 大于表长时返回失败**（本模块有专门的预设演示这个分支）。

## 进阶算法二：两条链表的共同后缀（2012-42）
1. **先各走一遍求长度** len1、len2（\\(O(m+n)\\)）；
2. 让**长的那条链**的指针先走 \\(|len1-len2|\\) 步 ⟹ 两条链的指针到表尾的**距离一样**（"尾部对齐"）；
3. 两条链的指针**同步后移**，直到 **p == q**：指向的结点就是共同后缀的**起始位置**；走了 null 都没相等则无共同后缀。
- ⚠ **必须比较指针，不能比较数据**：两条链的前缀里完全可能存着相同的值——比数据会把"值相同但结点不同"的位置误判成共同后缀（本模块"⚠️ 数据相同但结点不同"的那个预设就是为这个坑准备的构造数据）；
- 求长度两趟 + 对齐与同步各一趟 ⟹ 时间 \\(O(m+n)\\)、空间 \\(O(1)\\)。

## 进阶算法三：重排 L′ = (a1, an, a2, an−1, …)（2019-41）
- 题干只给要求：**空间 O(1)**、时间尽可能高效。要在 O(1) 空间里把尾结点搬到第 1 个结点后面，就只能**就地改指针**，通行解法是三步：
| 步骤 | 做法 | 代价 |
| --- | --- | --- |
| ① 找中间结点 | 快慢指针：p 每次 2 步、q 每次 1 步，q 到尾时 p 落在第 \\(\lceil n/2\rceil\\) 个 | \\(O(n)\\) |
| ② 逆置后半段 | 从中间结点的后继开始**头插法**逆置（每次把 r 的后继摘下、插到 s 的最前面） | \\(O(n)\\)、O(1) 空间 |
| ③ 交替合并 | 把后半段的结点**依次插到前半段相邻两结点之间**：r = p->next; p->next = q; q = q->next; p->next->next = r; p = r; | \\(O(n)\\) |
- 三步都只改指针、不新建结点 ⟹ 总时间 \\(O(n)\\)、额外空间 \\(O(1)\\)（正合题干要求）；
- 奇数个结点时**中间结点留在原位**（它就是 L′ 的最后一个）：n = 5 时 L′ = a1, a5, a2, a4, a3。

## 考点提醒（易错点）
1. 问"执行哪条语句后链表断裂"：只看**两条指针赋值的先后顺序**（先断后接必丢尾）；
2. 数"指针移动次数 / 比较次数"：从**头结点**算起（带头结点时头结点不占数据结点名额，但它就是"移动 0 次"的那个起点）；头插是 0 次、不是 1 次；
3. 删除别漏 **free(q)**——题目说"释放"却只改链，是常见错答；
4. **空表与单结点表**是边界：只改一条指针就够，这也是 2024-1 特意写"非空单链表"的原因；
5. 带头结点的题里，h->next 才是第一个**数据**结点；把 h 当数据结点去数会整体错一位；
6. 双指针题的"k 步"要**先判空再走**：p 走到 NULL 还没满 k 步就是"k 超过表长"，不能继续解引用；
7. 共同后缀题**比指针不比数据**（见上）；重排题不要真的去申请数组存后半段——那就不是 O(1) 空间了。

> **真题考情**：**6/18 年（选 2 + 大 4）**：选 2016-1、2024-1；大 2009-42（倒数第 k 个）、2012-42（共同后缀）、2015-41（删绝对值重复）、2019-41（重排 L′）。2021-1 已按"选择题归更专的知识点"改挂 ds-dlink。
`,

  /* ---------------- 输入表单（每一项都必须有 default，§3.8-11） ---------------- */
  inputs: [
    {
      key: 'op', label: '操作 / 算法（切换后立即重算）', type: 'select', default: 'insert', wide: true,
      options: [
        { v: 'insert', t: '① 按位序插入（i=1 头插 · i=n+1 尾插 · 中间插入）' },
        { v: 'delete', t: '② 按位序删除（先存后跨 + free）' },
        { v: 'move2head', t: '③ 把 p 的后继摘下插到表头（2024-1 的四条语句）' },
        { v: 'deldup', t: '④ 删除绝对值重复的结点（2015-41：辅助数组一趟扫描）' },
        { v: 'kth', t: '⑤ 双指针一趟找倒数第 k 个（2009-42）' },
        { v: 'suffix', t: '⑥ 两条链的共同后缀（2012-42：长度对齐 + 比较指针）' },
        { v: 'reorder', t: '⑦ 重排 L′ = a1,an,a2,an−1,…（2019-41：找中点 → 就地逆置 → 交替合并）' },
      ],
    },
    {
      key: 'vals', label: '链表数据（尾插法依次建立）／ 模式⑥的链 1', type: 'textarea', rows: 1, wide: true,
      default: '5,9,12,20,33',
      help: '整数 −99~99，逗号 / 空格分隔，最多 8 个结点。模式⑥里它是链 1 的完整数据（含共同后缀那段）',
    },
    {
      key: 'pos', label: '位序 i（①②）／ p 的位置（③）', type: 'text', default: '3',
      help: '插入：新结点插到第 i 个位置（1 ~ n+1）；删除：删第 i 个（1 ~ n）；模式③：p 指向第 i 个数据结点（1 ~ n−1，p 必须有后继）；其余模式忽略',
    },
    {
      key: 'val', label: '待插入的值 x（仅模式①用）', type: 'text', default: '7',
      help: '模式①要插入的数据；其余模式忽略此项',
    },
    {
      key: 'withHead', label: '是否带头结点（①②③④⑤ 生效）', type: 'select', default: 'yes',
      options: [
        { v: 'yes', t: '带头结点（h 指向头结点，表头插删与中间统一）' },
        { v: 'no', t: '不带头结点（h 直接指向第一个数据结点，表头插删要改 h）' },
      ],
      help: '模式⑥⑦ 按真题口径固定带头结点，此项对它们无效',
    },
    {
      key: 'k', label: '倒数第 k 个（仅模式⑤用）', type: 'text', default: '3',
      help: '1 ~ 12。k 大于表长时算法会在走满 k 步前先到 NULL ⟹ 返回 0（查找失败），这个分支也能演示',
    },
    {
      key: 'vals2', label: '模式⑥的链 2 数据（其余模式忽略）', type: 'textarea', rows: 1, wide: true,
      default: '4,12,20,33',
      help: '链 2 的完整数据。脚本自动取"两条链的最长公共后缀（按数值比较）"作为共同后缀，并把前面那截当前缀；两条链前缀里的值允许与共同后缀重复（这正是"比数据"会出错的陷阱）',
    },
  ],

  /* ---------------- 预设（冒烟脚本会用假 rt 逐个跑通，并断言标签承诺的动作） ---------------- */
  quickActions: [
    {
      label: '🎲 随机数据', run(rt) {
        const pool = [];
        for (let i = 1; i <= 24; i++) pool.push(i);
        pool.sort(function () { return Math.random() - 0.5; });
        const n = RC408.util.rnd(4, 7);
        const vals = pool.slice(0, n).map(function (v) { return Math.random() < 0.5 ? -v : v; });
        rt.setInput('vals', vals.join(','));
        rt.setInput('pos', String(RC408.util.rnd(1, Math.max(1, n - 1))));
        rt.setInput('val', String(RC408.util.rnd(1, 99)));
        rt.load();
      },
    },
    {
      label: '📝 2024-1 真题（把 p 的后继搬表头）', run(rt) {
        rt.setInput('op', 'move2head');
        rt.setInput('vals', '12,34,56,78');
        rt.setInput('pos', '2');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '📝 2015-41 真题（删绝对值重复）', run(rt) {
        rt.setInput('op', 'deldup');
        rt.setInput('vals', '21,3,8,21,15,3,8,7');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '⬅️ 头插 i=1（0 次移动 · O(1)）', run(rt) {
        rt.setInput('op', 'insert');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '1');
        rt.setInput('val', '7');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '🎯 中间插入 i=3（移动 2 次）', run(rt) {
        rt.setInput('op', 'insert');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '3');
        rt.setInput('val', '7');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '➡️ 尾插 i=n+1（要走完整表）', run(rt) {
        rt.setInput('op', 'insert');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '6');
        rt.setInput('val', '7');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '✂️ 删除表头数据结点 i=1', run(rt) {
        rt.setInput('op', 'delete');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '1');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '✂️ 删除表尾结点 i=n', run(rt) {
        rt.setInput('op', 'delete');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '5');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '🚫 不带头结点 · 头插（要改 h 本身）', run(rt) {
        rt.setInput('op', 'insert');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '1');
        rt.setInput('val', '7');
        rt.setInput('withHead', 'no');
        rt.load();
      },
    },
    {
      label: '🚫 不带头结点 · 删第一个（h = h->next）', run(rt) {
        rt.setInput('op', 'delete');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('pos', '1');
        rt.setInput('withHead', 'no');
        rt.load();
      },
    },
    {
      label: '🔁 不带头结点 · 把 p 的后继搬表头', run(rt) {
        rt.setInput('op', 'move2head');
        rt.setInput('vals', '12,34,56,78');
        rt.setInput('pos', '3');
        rt.setInput('withHead', 'no');
        rt.load();
      },
    },
    {
      label: '📝 2009-42 真题（双指针找倒数第 k 个）', run(rt) {
        rt.setInput('op', 'kth');
        rt.setInput('vals', '5,9,12,20,33');
        rt.setInput('k', '2');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '🚫 2009-42 的失败分支（k 大于表长 ⟹ 返回 0）', run(rt) {
        rt.setInput('op', 'kth');
        rt.setInput('vals', '5,9,12');
        rt.setInput('k', '5');
        rt.setInput('withHead', 'yes');
        rt.load();
      },
    },
    {
      label: '📝 2012-42 真题（两条链的共同后缀）', run(rt) {
        rt.setInput('op', 'suffix');
        rt.setInput('vals', '7,9,12,20,33');
        rt.setInput('vals2', '4,12,20,33');
        rt.load();
      },
    },
    {
      label: '⚠️ 共同后缀的坑（数据相同、结点不同）', run(rt) {
        rt.setInput('op', 'suffix');
        rt.setInput('vals', '7,9,12,20,33');
        rt.setInput('vals2', '12,5,12,20,33');
        rt.load();
      },
    },
    {
      label: '📝 2019-41 真题（重排 L′，n=5 奇数）', run(rt) {
        rt.setInput('op', 'reorder');
        rt.setInput('vals', '5,9,12,20,33');
        rt.load();
      },
    },
    {
      label: '📝 2019-41（n=8 偶数，前半后半等长）', run(rt) {
        rt.setInput('op', 'reorder');
        rt.setInput('vals', '1,2,3,4,5,6,7,8');
        rt.load();
      },
    },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const rawOp = String(vals.op === undefined || vals.op === null ? '' : vals.op);
    const op = ['insert', 'delete', 'move2head', 'deldup', 'kth', 'suffix', 'reorder'].indexOf(rawOp) >= 0 ? rawOp : 'insert';
    const withHead = String(vals.withHead === undefined ? 'yes' : vals.withHead) !== 'no';

    /* 解析一串整数（占位符 / 上限 / 字段名都由调用方给，便于两条链共用同一段） */
    const parseSeq = function (raw, field, maxN) {
      const s = String(raw === undefined || raw === null ? '' : raw).trim();
      if (!s) throw { message: '请填写' + field + '，例如 5,9,12,20,33（逗号 / 空格分隔）' };
      const toks = s.split(/[,，、;；\s]+/).filter(Boolean);
      if (toks.length > maxN) throw { message: field + '最多 ' + maxN + ' 个结点（要横向画出整条链，当前 ' + toks.length + ' 个）' };
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i].replace(/−/g, '-').replace(/–/g, '-');
        if (!/^-?\d+$/.test(t)) throw { message: '「' + toks[i] + '」不是整数；数据只支持 −99~99 的整数（不要小数、字母）' };
        const v = parseInt(t, 10);
        if (v < -99 || v > 99) throw { message: '数据 ' + v + ' 超出演示范围（只支持 −99~99，便于画结点盒）' };
        out.push(v);
      }
      if (!out.length) throw { message: field + '至少要有 1 个数据结点' };
      return out;
    };

    const seq = parseSeq(vals.vals, op === 'suffix' ? '链 1 的数据' : '初始链表数据', 8);
    const n = seq.length;
    let pos = 0, x = 0, nmax = 0, k = 0;
    if (op === 'insert' || op === 'delete' || op === 'move2head') {
      const rawPos = String(vals.pos === undefined || vals.pos === null ? '' : vals.pos).trim();
      if (!/^\d+$/.test(rawPos)) throw { message: '位序 i 必须是正整数（当前「' + rawPos + '」）' };
      pos = parseInt(rawPos, 10);
    }
    if (op === 'insert') {
      if (pos < 1 || pos > n + 1) {
        throw { message: '插入位序 i 要在 1 ~ ' + (n + 1) + ' 之间（表长 ' + n + '：i=1 头插、i=' + (n + 1) + ' 尾插），当前 ' + pos };
      }
      const rawX = String(vals.val === undefined || vals.val === null ? '' : vals.val).trim().replace(/−/g, '-');
      if (!/^-?\d+$/.test(rawX)) throw { message: '待插入的值 x 必须是整数（−99~99），当前「' + rawX + '」' };
      x = parseInt(rawX, 10);
      if (x < -99 || x > 99) throw { message: '待插入的值 ' + x + ' 超出演示范围（只支持 −99~99）' };
    }
    if (op === 'delete' && (pos < 1 || pos > n)) {
      throw { message: '删除位序 i 要在 1 ~ ' + n + ' 之间（表长 ' + n + '），当前 ' + pos };
    }
    if (op === 'move2head') {
      if (n < 2) throw { message: '模式③要求至少 2 个数据结点——p 必须有后继，才能"把后继搬到表头"' };
      if (pos < 1 || pos > n - 1) {
        throw { message: '模式③里 p 的位置要在 1 ~ ' + (n - 1) + ' 之间（p 必须有后继），当前 ' + pos };
      }
    }
    if (op === 'deldup') {
      for (let i = 0; i < seq.length; i++) nmax = Math.max(nmax, Math.abs(seq[i]));
      if (nmax > 24) {
        throw { message: '删重复模式要画出 n+1 格的辅助数组，请把数据的绝对值控制在 24 以内（当前最大 ' + nmax + '）' };
      }
    }
    /* 模式⑤：倒数第 k 个。k 允许大于表长（那正是"查找失败"的分支），只限制画得下的上界 */
    if (op === 'kth') {
      const rawK = String(vals.k === undefined || vals.k === null ? '' : vals.k).trim();
      if (!/^\d+$/.test(rawK)) throw { message: 'k 必须是正整数（当前「' + rawK + '」）' };
      k = parseInt(rawK, 10);
      if (k < 1 || k > 12) throw { message: 'k 取 1 ~ 12（要逐步画出 p 先走 k 步，当前 ' + k + '）' };
    }
    /* 模式⑥：两条链。**共同后缀 = 两个序列的最长公共后缀（按数值比较）**，前面那截就是各自的前缀。
       ⟹ 口径写进 parse 返回值，buildSnapshots 直接照它建池（两条链共享后缀那批结点） */
    if (op === 'suffix') {
      const seqB = parseSeq(vals.vals2, '链 2 的数据', 8);
      let sN = 0;
      while (sN < seq.length && sN < seqB.length && seq[seq.length - 1 - sN] === seqB[seqB.length - 1 - sN]) sN++;
      const pa = seq.length - sN, pb = seqB.length - sN;
      if (sN < 1) {
        throw { message: '两条链没有共同后缀（末位数据 ' + seq[seq.length - 1] + ' 与 ' + seqB[seqB.length - 1]
          + ' 就不同）——2012-42 的前提是两链表尾部共享同一段' };
      }
      if (pa === 0 && pb === 0) {
        throw { message: '两条链的数据完全相同就没有"共同后缀"可找（两个头指针一上来就相等）——请让两条链的前缀不同' };
      }
      return { op: op, withHead: true, seq: seq, seqB: seqB, pa: pa, pb: pb, suf: sN,
        lenA: seq.length, lenB: seqB.length, pos: 0, val: 0, nmax: 0, n: seq.length };
    }
    /* 模式⑦：重排 L′。n ≥ 2 才有"后半段"可逆置 */
    if (op === 'reorder') {
      if (n < 2) throw { message: '模式⑦要求至少 2 个数据结点——重排 L′ 要把后半段搬到前面去（当前 ' + n + ' 个）' };
      const m = Math.floor((n + 1) / 2);
      return { op: op, withHead: true, seq: seq, m: m, pos: 0, val: 0, nmax: 0, n: n };
    }
    return { op: op, withHead: withHead, seq: seq, pos: pos, val: x, nmax: nmax, n: n, k: k };
  },

  /* ---------------- ② 纯算法：逐动作产出快照（零 DOM） ---------------- */
  buildSnapshots(model) {
    const op = model.op, seq = model.seq, pos = model.pos, x = model.val, withHead = model.withHead;
    const kOf = model.k || 0;

    /* ---------- 建池：尾插法按输入顺序建立（正序）；带头结点时 id 0 是头结点 ---------- */
    const pool = [];
    const alloc = function (v, isHead) {
      pool.push({ id: pool.length, val: v, next: _llHEAD, isHead: !!isHead });
      return pool.length - 1;
    };
    let headIdx = _llHEAD;
    let headB = _llHEAD;     // 仅模式⑥：链 2 的头结点（两条链都是带头结点的）
    let sharedHead = _llHEAD; // 仅模式⑥：共同后缀的第一个结点
    if (op === 'suffix') {
      /* 模式⑥（2012-42）的池：headA → 链 1 前缀 → **共同后缀** ← 链 2 前缀 ← headB
         ⚠ 共同后缀那批结点**只分配一次**，两条链的 next 都指进同一批结点 ⟹
           "p == q"在数据上就是真的同一个结点（这正是本题"比指针"的依据）。 */
      headIdx = alloc(null, true);
      let t1 = headIdx;
      for (let i = 0; i < model.pa; i++) { const nd = alloc(seq[i], false); pool[t1].next = nd; t1 = nd; }
      for (let i = 0; i < model.suf; i++) {
        const nd = alloc(seq[model.pa + i], false);
        if (sharedHead === _llHEAD) sharedHead = nd;
        pool[t1].next = nd; t1 = nd;
      }
      headB = alloc(null, true);
      let t2 = headB;
      for (let i = 0; i < model.pb; i++) { const nd = alloc(model.seqB[i], false); pool[t2].next = nd; t2 = nd; }
      pool[t2].next = sharedHead;
    } else if (withHead) {
      headIdx = alloc(null, true);
      let tail = headIdx;
      for (let i = 0; i < seq.length; i++) { const nd = alloc(seq[i], false); pool[tail].next = nd; tail = nd; }
    } else {
      let tail = _llHEAD;
      for (let i = 0; i < seq.length; i++) {
        const nd = alloc(seq[i], false);
        if (tail === _llHEAD) headIdx = nd; else pool[tail].next = nd;
        tail = nd;
      }
    }
    const chainNow = function () { return _llChain(pool, headIdx); };
    const firstData = function () { return withHead ? pool[headIdx].next : headIdx; };
    /* 从"头指针（−1）或某个结点"前进一次；不带头结点时 −1 表示头指针本身 */
    const advance = function (cur) { return cur === _llHEAD ? headIdx : pool[cur].next; };

    const snaps = [];
    let floating = [], freed = [], seen = null;
    let moves = 0, visits = 0, delCount = 0;
    /* 模式⑤⑥⑦ 的页头统计量（在分支里就地更新；push 时深拷贝一份进快照） */
    const stat = {};

    const push = function (step, o) {
      const oo = o || {};
      const s = {
        step: step, op: op, withHead: withHead, pos: pos, val: x,
        nodes: pool.map(function (nd) { return { id: nd.id, val: nd.val, next: nd.next, isHead: !!nd.isHead }; }),
        headIdx: headIdx,
        floating: floating.slice(),
        freed: freed.slice(),
        p: (oo.p === undefined ? null : oo.p),
        q: (oo.q === undefined ? null : oo.q),
        newIdx: (oo.newIdx === undefined ? _llHEAD : oo.newIdx),
        newLink: oo.newLink || null,
        brokeLink: oo.brokeLink || null,
        seen: seen ? seen.slice() : null,
        moves: moves, visits: visits, delCount: delCount,
        desc: oo.desc || '', log: oo.log || '', logType: oo.logType || 'info',
        /* 多行布局（模式⑤⑥⑦）：rows 给了就走 layout:'multi'，其余字段只在 multi 下有意义 */
        layout: oo.rows ? 'multi' : 'one',
        rows: oo.rows || null,
        mark: oo.mark || null,
        shared: oo.shared || null,
        phase: oo.phase || '',
        num: oo.num || ((op === 'kth' || op === 'suffix' || op === 'reorder') ? Object.assign({}, stat) : null),
      };
      if (oo.rows) {
        /* 多行下 chain/headIdx 取第一行（渲染与断言都以 rows 为准；这样旧字段仍然有意义） */
        s.headIdx = oo.rows[0].headIdx;
        s.chain = oo.rows[0].chain.slice();
      } else {
        s.chain = _llChain(s.nodes, s.headIdx);
      }
      s.len = _llLen(s.nodes, s.chain);
      snaps.push(s);
    };

    /* ---------- 多行布局的两个小工具（模式⑤⑥⑦ 共用） ---------- */
    /* 造一行：startId = 这一行的头（−1 = 空行）；ptrs 里 id 为 −1 的自动挪到 nullPtrs */
    const mrow = function (key, name, startId, off, ptrs, extra) {
      const ch = (startId === _llHEAD || startId === null || startId === undefined) ? [] : _llChain(pool, startId);
      const ps = [], nps = [];
      (ptrs || []).forEach(function (p) {
        if (p.id === _llHEAD || p.id === null || p.id === undefined) nps.push({ txt: p.txt, color: p.color });
        else ps.push({ txt: p.txt, id: p.id, color: p.color });
      });
      const r = { key: key, name: name, headIdx: (startId === undefined ? _llHEAD : startId),
        chain: ch, off: off || 0, ptrs: ps, nullPtrs: nps };
      if (extra) for (const kk in extra) r[kk] = extra[kk];
      return r;
    };

    /* ==================== 模式①：按位序插入 ==================== */
    if (op === 'insert') {
      push('init', {
        desc: '初始链表（尾插法建立，' + (withHead ? '带头结点' : '不带头结点') + '）：' + _llSeqText(pool, chainNow())
          + '。目标：把 x = ' + x + ' 插到第 ' + pos + ' 个位置。',
        log: '初始链表：' + _llSeqText(pool, chainNow()) + '（表长 ' + seq.length + '）',
      });
      let p = withHead ? headIdx : _llHEAD;
      for (let k = 1; k <= pos - 1; k++) {
        p = advance(p);
        moves++;
        push('move', {
          p: p,
          desc: 'pointer 后移第 ' + k + ' 次 → p 指向第 ' + k + ' 个数据结点（还要再移 ' + (pos - 1 - k) + ' 次才到插入点的前驱）',
          log: '指针后移 ' + k + ' 次：p = 第 ' + k + ' 个数据结点（数据 ' + pool[p].val + '）',
        });
      }
      push('found', {
        p: p,
        desc: 'p 已到位：' + (pos === 1
          ? 'p 就是' + (withHead ? '头结点' : '头指针 h 本身') + '（头插，0 次移动）'
          : 'p 指向第 ' + (pos - 1) + ' 个数据结点（数据 ' + pool[p].val + '）')
          + '。下面两条指针顺序不能反（先接后断）：先让新结点接住 p 的后继。',
        log: '定位完成：指针移动 ' + moves + ' 次' + (pos === 1 ? '（头插，无需移动 ⟹ O(1)）' : '（= i−1 ⟹ 定位是 O(n) 的瓶颈）'),
      });
      const q = alloc(x, false);
      const oldNext = (p === _llHEAD) ? headIdx : pool[p].next;
      pool[q].next = oldNext;
      floating = [q];
      push('linkq', {
        p: p, q: q, newIdx: q, newLink: { from: q, to: oldNext },
        desc: '语句① q->next = p->next：新结点 q（数据 ' + x + '）先接管 p 原来的后继'
          + (oldNext === _llHEAD ? '（p 后面本来是 ∧ NULL，说明这是尾插）' : '（原后继数据 ' + pool[oldNext].val + '）')
          + '。此时链表还没变，两条指针暂时指向同一个后继。',
        log: 'q->next = p->next（先接住旧后继，这就是"先接后断"的第一接）',
      });
      if (p === _llHEAD) headIdx = q; else pool[p].next = q;
      floating = [];
      push('linkp', {
        p: p, q: q, newIdx: q, newLink: { from: p, to: q }, brokeLink: { from: p, to: oldNext },
        desc: '语句② p->next = q：q 正式进入链表，成为第 ' + pos + ' 个结点'
          + '（红色虚线 ✂ = 被改写的旧指针，此时才断开）。插入的两条指针都改完了。',
        log: 'p->next = q（接链完成：' + _llSeqText(pool, chainNow()) + '）',
        logType: 'success',
      });
      push('done', {
        desc: '插入完成：表长 ' + seq.length + ' → ' + (seq.length + 1) + '；' + (pos === 1
          ? '头插只改两条指针、指针移动 0 次 ⟹ O(1)'
          : pos === seq.length + 1
            ? '尾插要走完整表（' + moves + ' 次移动）⟹ O(n)；想 O(1) 就得额外维护尾指针'
            : '定位用掉 ' + moves + ' 次移动 ⟹ O(n)'),
        log: '插入 ' + x + ' 完成：' + _llSeqText(pool, chainNow()) + '（指针移动 ' + moves + ' 次）',
        logType: 'success',
      });
    }

    /* ==================== 模式②：按位序删除 ==================== */
    if (op === 'delete') {
      push('init', {
        desc: '初始链表（' + (withHead ? '带头结点' : '不带头结点') + '）：' + _llSeqText(pool, chainNow())
          + '。目标：删除第 ' + pos + ' 个数据结点。',
        log: '初始链表：' + _llSeqText(pool, chainNow()) + '（表长 ' + seq.length + '）',
      });
      let p = withHead ? headIdx : _llHEAD;
      for (let k = 1; k <= pos - 1; k++) {
        p = advance(p);
        moves++;
        push('move', {
          p: p,
          desc: '指针后移第 ' + k + ' 次 → p 指向第 ' + k + ' 个数据结点（还要再移 ' + (pos - 1 - k) + ' 次）',
          log: '指针后移 ' + k + ' 次：p = 第 ' + k + ' 个数据结点（数据 ' + pool[p].val + '）',
        });
      }
      push('found', {
        p: p,
        desc: 'p 已到位：' + (pos === 1
          ? 'p 就是' + (withHead ? '头结点' : '头指针 h 本身') + '（删除首元，0 次移动）'
          : 'p 指向第 ' + (pos - 1) + ' 个数据结点，它是待删结点的前驱'),
        log: '定位完成：指针移动 ' + moves + ' 次',
      });
      const q = (p === _llHEAD) ? headIdx : pool[p].next;
      push('scan', {
        p: p, q: q,
        desc: '语句① q = p->next：q 指向待删的第 ' + pos + ' 个结点（数据 ' + pool[q].val
          + '）。删除必须先记住 q——跨过它以后就再也找不到它、无法 free。',
        log: 'q = p->next（先存：q 指向数据 ' + pool[q].val + '）',
        logType: 'warn',
      });
      const after = pool[q].next;
      const from = (p === _llHEAD) ? _llHEAD : p;
      if (p === _llHEAD) headIdx = after; else pool[p].next = after;
      floating = [q];
      push('unlink', {
        p: p, q: q, newLink: { from: from, to: after }, brokeLink: { from: from, to: q },
        desc: '语句② p->next = q->next：让前驱跨过 q（红色虚线 ✂ = 被断开的旧指针）。q 已不在链上，先悬在下方等 free。',
        log: 'p->next = q->next（后跨：链变成 ' + _llSeqText(pool, chainNow()) + '）',
        logType: 'warn',
      });
      delCount++;
      floating = []; freed = [q];
      push('free', {
        p: p, q: q,
        desc: '语句③ free(q)：释放结点 q（数据 ' + pool[q].val + '），表长 ' + seq.length + ' → ' + (seq.length - 1)
          + '。只改链不 free 会内存泄漏，是常见的错答。',
        log: 'free(q)：结点 ' + pool[q].val + ' 已释放',
        logType: 'warn',
      });
      push('done', {
        desc: '删除完成：表长 ' + seq.length + ' → ' + (seq.length - 1) + '；指针移动 ' + moves + ' 次'
          + (pos === 1 ? '（删首元）' : pos === seq.length ? '（删表尾，要先走到前驱 ⟹ O(n)）' : '')
          + '。改指针本身是 O(1)，代价全在定位前驱。',
        log: '删除完成：' + _llSeqText(pool, chainNow()) + '（指针移动 ' + moves + ' 次）',
        logType: 'success',
      });
    }

    /* ==================== 模式③：把 p 的后继摘下插到表头（2024-1） ==================== */
    if (op === 'move2head') {
      push('init', {
        desc: '初始链表（' + (withHead ? '带头结点 h' : '不带头结点') + '）：' + _llSeqText(pool, chainNow())
          + '。目标：按 2024-1 的四条语句，把 p（第 ' + pos + ' 个数据结点）的后继 q 摘下并插到表头。',
        log: '初始链表：' + _llSeqText(pool, chainNow()) + '；p 取第 ' + pos + ' 个数据结点',
      });
      let p = withHead ? headIdx : _llHEAD;
      for (let k = 1; k <= pos; k++) {
        p = advance(p);
        moves++;
        push('move', {
          p: p,
          desc: 'p 后移第 ' + k + ' 次 → p 指向第 ' + k + ' 个数据结点（要到第 ' + pos + ' 个）',
          log: '指针后移 ' + k + ' 次：p = 第 ' + k + ' 个数据结点',
        });
      }
      push('found', {
        p: p,
        desc: 'p 指向第 ' + pos + ' 个数据结点（数据 ' + pool[p].val + '），q 即将指向它的后继。四条语句马上开始。',
        log: 'p 就位：数据 ' + pool[p].val + '（指针移动 ' + moves + ' 次）',
      });
      const q = pool[p].next;
      push('stmt1', {
        p: p, q: q,
        desc: '语句① q = p->next：q 指向 p 的后继（数据 ' + pool[q].val + '）——它就是即将被搬到表头的那个结点。',
        log: '① q = p->next（q = 数据 ' + pool[q].val + '）',
      });
      const after = pool[q].next;
      pool[p].next = after;
      floating = [q];
      push('stmt2', {
        p: p, q: q, newLink: { from: p, to: after }, brokeLink: { from: p, to: q },
        desc: '语句② p->next = q->next：把 q 从原位置摘下来（红色虚线 ✂ = 断开的旧指针）。此时 q 悬空：它已不在链上，但还没接回表头——这就是"前两句是删除"。',
        log: '② p->next = q->next（q 已摘下，链变成 ' + _llSeqText(pool, chainNow()) + '）',
        logType: 'warn',
      });
      const nf = withHead ? pool[headIdx].next : headIdx;
      pool[q].next = nf;
      push('stmt3', {
        p: p, q: q, newLink: { from: q, to: nf },
        desc: '语句③ q->next = h->next：让 q 接上原来的第一个数据结点'
          + (nf === _llHEAD ? '（表里已无别的数据结点，所以接的是 ∧ NULL）' : '（数据 ' + pool[nf].val + '）')
          + '。此时 q 已经备好，但还没有任何指针指向它。',
        log: '③ q->next = h->next（q 备好，接上数据 ' + (nf === _llHEAD ? '∧' : pool[nf].val) + '）',
      });
      if (withHead) pool[headIdx].next = q; else headIdx = q;
      floating = [];
      push('stmt4', {
        q: q, newLink: { from: (withHead ? headIdx : _llHEAD), to: q },
        desc: '语句④ h->next = q：q 成为第一个数据结点，四条语句执行完毕（后两句就是"头插"）。',
        log: '④ h->next = q（搬移完成：' + _llSeqText(pool, chainNow()) + '）',
        logType: 'success',
      });
      push('done', {
        desc: '四条语句执行完毕：数据 ' + pool[q].val + ' 从 p 的后面搬到了表头，表长不变（' + seq.length
          + '）。注意①②只动两条指针、③④又只动两条指针，全程 O(1)——这正是"链表插入删除快"的含义（已定位 p 时）。',
        log: '完成：' + _llSeqText(pool, chainNow()) + '（四条语句、O(1)，未移动数据）',
        logType: 'success',
      });
    }

    /* ==================== 模式④：删除绝对值重复的结点（2015-41） ==================== */
    if (op === 'deldup') {
      seen = [];
      for (let i = 0; i <= model.nmax; i++) seen.push(false);
      push('init', {
        seen: seen,
        desc: '初始链表（' + (withHead ? '带头结点' : '不带头结点') + '）：' + _llSeqText(pool, chainNow())
          + '。开一个 ' + (model.nmax + 1) + ' 格的辅助数组 seen[0..' + model.nmax
          + ']，下标 = 数据的绝对值，1 表示这个绝对值已经出现过——以空间换时间，只需一趟扫描。',
        log: '开辅助数组 seen[0..' + model.nmax + ']（全 0），准备一趟扫描',
      });
      let pre = withHead ? headIdx : _llHEAD;
      let cur = firstData();
      while (cur !== _llHEAD && cur !== null && cur >= 0) {
        visits++; moves++;
        const a = Math.abs(pool[cur].val);
        if (seen[a]) {
          push('dup', {
            p: pre, q: cur, seen: seen,
            desc: '第 ' + visits + ' 个结点数据 ' + pool[cur].val + '：绝对值 ' + a
              + ' 在 seen[' + a + '] 上已经是 1 ⟹ 它重复了，要删掉。',
            log: '发现重复：数据 ' + pool[cur].val + '（|' + pool[cur].val + '| = ' + a + ' 已出现过）',
            logType: 'warn',
          });
          const after = pool[cur].next;
          const from = (pre === _llHEAD) ? _llHEAD : pre;
          if (pre === _llHEAD) headIdx = after; else pool[pre].next = after;
          delCount++;
          floating = [];
          freed = freed.concat([cur]);
          push('unlink', {
            p: pre, q: cur, seen: seen, newLink: { from: from, to: after }, brokeLink: { from: from, to: cur },
            desc: '把重复结点摘下并 free(q)：前驱 p 直接跨过它（红色虚线 ✂ = 断开的旧指针）。注意 p 不动，q 后移到下一个待检查结点。',
            log: 'p->next = q->next; free(q)：删除数据 ' + pool[cur].val,
            logType: 'warn',
          });
          cur = after;
        } else {
          seen[a] = true;
          push('keep', {
            p: pre, q: cur, seen: seen,
            desc: '第 ' + visits + ' 个结点数据 ' + pool[cur].val + '：绝对值 ' + a
              + ' 首次出现 ⟹ seen[' + a + '] = 1，保留；p、q 同时后移一步。',
            log: 'seen[' + a + '] = 1（保留数据 ' + pool[cur].val + '）',
            logType: 'success',
          });
          pre = cur;
          cur = pool[cur].next;
        }
      }
      push('done', {
        seen: seen,
        desc: '删除完成：共访问 ' + visits + ' 个结点、删除 ' + delCount + ' 个重复结点，表长 ' + seq.length + ' → '
          + (seq.length - delCount) + '。只做了一趟扫描 ⟹ 时间 O(m) = O(' + visits + ')，空间 O(n) = O('
          + (model.nmax + 1) + ')——2015-41 要的"时间上尽可能高效"就是这么换来的。',
        log: '完成：' + _llSeqText(pool, chainNow()) + '（访问 ' + visits + ' 个结点、删除 ' + delCount + ' 个）',
        logType: 'success',
      });
    }

    /* ==================== 模式⑤：双指针一趟找倒数第 k 个（2009-42） ====================
       口径（见文件头）：p、q 都从第一个数据结点出发；p 先走 k 步（中途到 NULL ⟹ 查找失败），
       之后 p、q 同步后移，p 到 NULL 时 q 就是倒数第 k 个。p 一共走 n 步 ⟹ 一趟 O(n)、两个指针 O(1)。 */
    if (op === 'kth') {
      const NUL = _llHEAD;
      const p0 = firstData();
      stat.steps = 0; stat.qsteps = 0; stat.ok = true;
      /* mark：p 所在结点靛、q 所在结点琥珀（同一个结点时以 p 为准） */
      const mk = function (pId, qId, extra) {
        const m = {};
        if (pId !== null && pId !== NUL) m[pId] = 'cur';
        if (qId !== null && qId !== NUL && qId !== pId) m[qId] = 'q';
        if (extra) for (const kk in extra) m[kk] = extra[kk];
        return m;
      };
      /* 本模式只有一行：行首 chip 就是 head（带头结点时链上第一个盒是头结点） */
      const rowOf = function (pId, qId) {
        return [mrow('L', 'head', headIdx, 0, [{ txt: 'p', id: pId, color: '#6366f1' },
          { txt: 'q', id: qId, color: '#f59e0b' }])];
      };
      push('init', {
        rows: rowOf(p0, p0), mark: mk(p0, p0), phase: 'init',
        desc: '双指针起点：p、q 都指向第一个数据结点（' + (withHead ? '带头结点，头指针 h 全程不动' : '不带头结点')
          + '）。2009-42 要求一趟遍历找到倒数第 ' + kOf + ' 个：先让 p 单独往前走 k 步拉开距离，之后 p、q 同步走；'
          + 'p 走到 NULL 时，q 距表尾正好 k 个结点。',
        log: '初始：p = q = 第一个数据结点（数据 ' + pool[p0].val + '；表长 ' + seq.length + '，k = ' + kOf + '）',
      });
      let p = p0, q = p0, failed = false, pSteps = 0, qSteps = 0;
      for (let t = 1; t <= kOf; t++) {
        if (p === NUL) {
          stat.ok = false;
          push('fail', {
            rows: rowOf(NUL, q), mark: mk(NUL, q), phase: 'fail',
            desc: 'p 已经走到表尾（NULL），可它才走了 ' + pSteps + ' 步，不足 k = ' + kOf + ' 步 ⟹ 表长 n = ' + seq.length
              + ' 比 k 小，倒数第 ' + kOf + ' 个不存在，算法返回 0（查找失败）。这就是"先判空、再后移"的意义：'
              + '少了这个判断就会去解引用 NULL。',
            log: '查找失败：表长 ' + seq.length + ' < k = ' + kOf + '（p 只走了 ' + pSteps + ' 步就到 NULL）',
            logType: 'warn',
          });
          failed = true;
          break;
        }
        p = pool[p].next;
        pSteps++; moves++;
        stat.steps = pSteps; stat.qsteps = qSteps;
        push('walk', {
          rows: rowOf(p, q), mark: mk(p, q), phase: 'walk',
          desc: 'p 先走第 ' + pSteps + ' 步：' + (p === NUL ? 'p 越过尾结点、落到 NULL（k 步正好走满）'
            : 'p 指向第 ' + (pSteps + 1) + ' 个数据结点（数据 ' + pool[p].val + '）')
            + '。q 原地不动，所以 p、q 之间的距离 = ' + pSteps + ' 个结点。',
          log: 'p 第 ' + pSteps + ' 步' + (p === NUL ? ' → NULL' : ' → 数据 ' + pool[p].val) + '（q 停在原地）',
        });
      }
      if (!failed) {
        while (p !== NUL) {
          p = pool[p].next; pSteps++; moves++;
          q = pool[q].next; qSteps++; moves++;
          stat.steps = pSteps; stat.qsteps = qSteps;
          push('sync', {
            rows: rowOf(p, q), mark: mk(p, q), phase: 'sync',
            desc: '距离已经固定为 ' + kOf + ' 个结点 ⟹ p、q 同步后移：p '
              + (p === NUL ? '走到 NULL（到头了，循环结束）' : '指向数据 ' + pool[p].val) + '，q 指向数据 ' + pool[q].val
              + '。无论走到哪一帧，q 落后 p 的结点数始终是 ' + kOf + '。',
            log: '同步后移：p ' + (p === NUL ? '→ NULL' : '→ 数据 ' + pool[p].val) + '、q → 数据 ' + pool[q].val,
          });
        }
        const ex = {}; ex[q] = 'hit';   /* 'hit' = 本帧的结论（稳定帧也可保留）；'new' 只给"本帧刚接上的指针" */
        stat.res = pool[q].val; stat.ok = true;
        push('found', {
          rows: rowOf(NUL, q), mark: mk(NUL, q, ex), newIdx: q, phase: 'found',
          desc: 'p 走到 NULL，循环结束——q 停在数据 ' + pool[q].val + '，它就是倒数第 ' + kOf + ' 个（正数第 '
            + (seq.length - kOf + 1) + ' 个）。注意：q 只走了 ' + qSteps + ' 步，倒数第 ' + kOf + ' 个就是这么"数出来"的。',
          log: '找到倒数第 ' + kOf + ' 个：数据 ' + pool[q].val + '（正数第 ' + (seq.length - kOf + 1) + ' 个）',
          logType: 'success',
        });
        push('done', {
          rows: rowOf(NUL, q), mark: mk(NUL, q, ex), phase: 'done',
          desc: '完成：p 一共走了 ' + pSteps + ' 步 = n（正好一趟遍历）、q 走了 ' + qSteps + ' 步 = n − k，合起来仍是 O(n)；'
            + '额外空间只有两个指针 ⟹ O(1)。对照"先求表长 n、再走 n − k 步"的两趟做法——这就是 2009-42 要的"一趟遍历"。',
          log: '完成：倒数第 ' + kOf + ' 个 = 数据 ' + pool[q].val + '（p 走 ' + pSteps + ' 步、q 走 ' + qSteps + ' 步 ⟹ O(n) / O(1)）',
          logType: 'success',
        });
      } else {
        push('done', {
          rows: rowOf(NUL, q), mark: mk(NUL, q), phase: 'done',
          desc: '本场景 k = ' + kOf + ' 大于表长 ' + seq.length + '：算法在 p 走到 NULL 的那一次判断里就返回 0——'
            + '没有解引用空指针、也没有多跑一趟 ⟹ 时间仍是 O(n)、空间 O(1)。',
          log: '完成：k = ' + kOf + ' > 表长 ' + seq.length + '，返回 0（查找失败）', logType: 'warn',
        });
      }
    }

    /* ==================== 模式⑥：两条链的共同后缀（2012-42） ====================
       口径：先各走一遍求长度（O(m+n)）；让长的那条链先走 |len1−len2| 步对齐尾部；
       然后两条链的指针同步后移，直到 **指针相等**（不是数据相等）——那里就是共同后缀的起始位置。
       ⚠ 池里共同后缀只有一份结点，两条链的 next 都指进它 ⟹ 画面上"两行同一批盒"是真实结构，不是画了两份。 */
    if (op === 'suffix') {
      const NUL = _llHEAD;
      const lenA = model.lenA, lenB = model.lenB, suf = model.suf;
      stat.sync = 0; stat.align = 0;
      const maxPrefix = Math.max(model.pa, model.pb);
      const offA = maxPrefix - model.pa, offB = maxPrefix - model.pb;  // 整行右移：前缀段右对齐
      const shared = { from: 1 + maxPrefix, n: suf };                  // 共同后缀的列区间（含头结点那一列）
      const mk = function (pId, qId, extra) {
        const m = {};
        if (pId !== null && pId !== NUL) m[pId] = 'cur';
        if (qId !== null && qId !== NUL && qId !== pId) m[qId] = 'q';
        if (extra) for (const kk in extra) m[kk] = extra[kk];
        return m;
      };
      const rowsOf = function (pId, qId) {
        return [mrow('A', 'head1', headIdx, offA, [{ txt: 'p', id: pId, color: '#6366f1' }]),
          mrow('B', 'head2', headB, offB, [{ txt: 'q', id: qId, color: '#f59e0b' }])];
      };
      let p = firstData(), q = pool[headB].next;
      push('init', {
        rows: rowsOf(p, q), mark: mk(p, q), shared: shared, phase: 'init',
        desc: '两条带头结点的单链表并排：链 1 长 ' + lenA + '、链 2 长 ' + lenB + '，尾部共享同一段（青色虚线框里'
          + '那 ' + suf + ' 个结点，链 1、链 2 的 next 都指进同一批盒——所以画面上它出现了两遍、列完全对齐）。'
          + '目标：找出共同后缀的起始结点。做法：先各走一遍求长度。',
        log: '两条链：链 1 长 ' + lenA + '、链 2 长 ' + lenB + '，共同后缀 ' + suf + ' 个结点',
      });
      let la = 0;
      while (p !== NUL) {
        p = pool[p].next; la++; moves++;
        push('lenA', {
          rows: rowsOf(p, q), mark: mk(p, q), shared: shared, phase: 'lenA',
          desc: '第一趟：p 沿链 1 走，数出链 1 的长度。已数 ' + la + ' 个结点'
            + (p === NUL ? '，p 到 NULL ⟹ 链 1 长度 = ' + la : '（还差一些）') + '。',
          log: '数链 1：已数 ' + la + ' 个结点' + (p === NUL ? '，到 NULL，链 1 长度 = ' + la : ''),
        });
      }
      let lb = 0;
      while (q !== NUL) {
        q = pool[q].next; lb++; moves++;
        push('lenB', {
          rows: rowsOf(p, q), mark: mk(p, q), shared: shared, phase: 'lenB',
          desc: '第二趟：q 沿链 2 走，数出链 2 的长度。已数 ' + lb + ' 个结点'
            + (q === NUL ? '，q 到 NULL ⟹ 链 2 长度 = ' + lb : '（还差一些）') + '。',
          log: '数链 2：已数 ' + lb + ' 个结点' + (q === NUL ? '，到 NULL，链 2 长度 = ' + lb : ''),
        });
      }
      p = firstData(); q = pool[headB].next;
      push('reset', {
        rows: rowsOf(p, q), mark: mk(p, q), shared: shared, phase: 'reset',
        desc: '两条链的长度都数出来了：' + lenA + ' 与 ' + lenB + '，差 ' + Math.abs(lenA - lenB) + '。'
          + '现在把两个指针放回各自的第一个数据结点，准备"对齐尾部"。',
        log: '长度：链 1 = ' + lenA + '、链 2 = ' + lenB + '（差 ' + Math.abs(lenA - lenB) + '）',
      });
      const diff = lenA - lenB;
      stat.align = Math.abs(diff);
      const longer = diff > 0 ? '链 1' : '链 2';
      const which = diff > 0 ? 'p' : 'q';
      for (let t = 1; t <= Math.abs(diff); t++) {
        if (diff > 0) { p = pool[p].next; } else { q = pool[q].next; }
        moves++;
        push('align', {
          rows: rowsOf(p, q), mark: mk(p, q), shared: shared, phase: 'align',
          desc: '长度差 ' + Math.abs(diff) + ' ⟹ 让长的 ' + longer + ' 的指针 ' + which + ' 先走第 ' + t + ' 步'
            + '（还差 ' + (Math.abs(diff) - t) + ' 步）。走完这一段，两个指针"离表尾的距离"就一样了。',
          log: '对齐尾部：' + which + ' 先走第 ' + t + ' 步（共 ' + Math.abs(diff) + ' 步）',
        });
      }
      let sync = 0, guard = 0;
      while (p !== q && p !== NUL && q !== NUL && guard < 40) {
        p = pool[p].next; q = pool[q].next; sync++; moves++; guard++;
        stat.sync = sync;
        push('sync', {
          rows: rowsOf(p, q), mark: mk(p, q), shared: shared, phase: 'sync',
          desc: '尾部已对齐 ⟹ p、q 同步后移第 ' + sync + ' 次：p ' + (p === NUL ? '到 NULL' : '指向数据 ' + pool[p].val)
            + '，q ' + (q === NUL ? '到 NULL' : '指向数据 ' + pool[q].val) + '。'
            + (p === q ? '这一步之后 p == q：两个指针指向了同一个结点！' : '两者还不相等，继续。'),
          log: '同步第 ' + sync + ' 次：p ' + (p === NUL ? '→NULL' : '→' + pool[p].val) + '、q '
            + (q === NUL ? '→NULL' : '→' + pool[q].val) + (p === q ? '（p == q）' : ''),
        });
      }
      if (p === q && p !== NUL) {
        const ex = {}; ex[p] = 'hit';
        stat.res = pool[p].val;
        push('found', {
          rows: rowsOf(p, q), mark: mk(p, q, ex), newIdx: p, shared: shared, phase: 'found',
          desc: 'p == q ⟹ 指针首次相等的位置就是共同后缀的起始结点：数据 ' + pool[p].val
            + '（在这 ' + suf + ' 个共享结点里的第 1 个）。'
            + '注意判据是"指针相等"而不是"数据相等"——数据相等只会说明值一样，结点可能完全不同。',
          log: '找到共同后缀起点：数据 ' + pool[p].val + '（p == q）', logType: 'success',
        });
        push('done', {
          rows: rowsOf(p, q), mark: mk(p, q, ex), shared: shared, phase: 'done',
          desc: '完成：求长度两趟（' + lenA + ' + ' + lenB + ' 步）、对齐 ' + Math.abs(diff) + ' 步、同步 ' + sync
            + ' 步 ⟹ 时间 O(m+n)、只用两个指针 ⟹ 空间 O(1)。共同后缀从数据 ' + pool[p].val + ' 开始，共 ' + suf + ' 个结点。',
          log: '完成：共同后缀起点 = 数据 ' + pool[p].val + '（同步 ' + sync + ' 步，总时间 O(m+n) / O(1)）',
          logType: 'success',
        });
      } else {
        push('fail', {
          rows: rowsOf(p, q), mark: mk(p, q), shared: shared, phase: 'fail',
          desc: '两个指针都走到 NULL 也没相等 ⟹ 两条链没有共同后缀（按本模块的口径，共同后缀至少 1 个结点，'
            + '所以这里只会在数据异常时出现）。',
          log: '未找到共同后缀', logType: 'warn',
        });
      }
    }

    /* ==================== 模式⑦：重排 L′（2019-41） ====================
       三步都只改指针、不新建结点：① 快慢指针找中间结点；② 后半段就地头插法逆置；
       ③ 后半段的结点依次插到前半段相邻两结点之间（r = p->next; p->next = q; q = q->next; p->next->next = r; p = r;）。
       行数逐帧变化（1 行 → 2 行 → 3 行 → 2 行），所以走多行布局。 */
    if (op === 'reorder') {
      const NUL = _llHEAD;
      const nAll = seq.length, half = model.m;
      stat.rounds = 0; stat.rev = 0; stat.merged = 0;
      const mk = function (extra) {
        const m = {};
        if (extra) for (const kk in extra) m[kk] = extra[kk];
        return m;
      };
      const wholeRow = function (fastId, slowId) {
        return [mrow('L', 'head', headIdx, 0, [{ txt: 'p', id: fastId, color: '#6366f1' },
          { txt: 'q', id: slowId, color: '#f59e0b' }])];
      };
      let fast = firstData(), slow = firstData();
      push('init', {
        rows: wholeRow(fast, slow), mark: mk({}), phase: 'mid',
        desc: '第一步：找中间结点。p 是快指针（每次 2 步）、q 是慢指针（每次 1 步），两个都从第一个数据结点出发。'
          + 'q 走到表尾时，p 正好落在第 ⌈n/2⌉ = ' + half + ' 个结点——它就是前半段的最后一个。',
        log: '第一步找中点：p（快）与 q（慢）都从第一个数据结点出发（n = ' + nAll + '，前半 ' + half + ' 个）',
      });
      let rounds = 0;
      while (pool[fast].next !== NUL && pool[pool[fast].next].next !== NUL) {
        slow = pool[slow].next; moves++;
        fast = pool[pool[fast].next].next; moves++;
        rounds++;
        stat.rounds = rounds;
        push('mid', {
          rows: wholeRow(fast, slow), mark: mk({}), phase: 'mid',
          desc: '第 ' + rounds + ' 轮：q 后移 1 步到数据 ' + pool[slow].val + '、p 后移 2 步到数据 ' + pool[fast].val
            + '。只要 p 还能再走两步，这一轮就继续。',
          log: '第 ' + rounds + ' 轮：q → ' + pool[slow].val + '、p → ' + pool[fast].val,
        });
      }
      const midId = slow;
      stat.mid = pool[midId].val;
      const exMid = {}; exMid[midId] = 'hit';
      push('midfound', {
        rows: wholeRow(fast, slow), mark: mk(exMid), phase: 'mid',
        desc: 'p 没法再走两步了 ⟹ 中间结点就是 q 指着的第 ' + half + ' 个结点（数据 ' + pool[midId].val
          + '）。它就是前半段的最后一个结点，重排后它正好排在 L′ 的最后。',
        log: '中间结点 = 第 ' + half + ' 个（数据 ' + pool[midId].val + '）', logType: 'success',
      });
      /* ② 切分：前半段自成一条链，后半段摘下来 */
      const second = pool[midId].next;
      pool[midId].next = NUL;
      moves++;
      const rowL1 = function (tailNote) {
        return mrow('A', 'head', headIdx, 0, [], tailNote ? { tailNote: tailNote } : null);
      };
      push('split', {
        rows: [rowL1({ text: '✂ p->next = NULL（前半段到这儿为止）', color: '#ef4444' }),
          mrow('R', 'r', second, 0, [])],
        mark: mk(exMid), phase: 'split',
        desc: '在中间结点处断开：把中间结点的 next 置为 NULL，前半段（含头结点，共 ' + half + ' 个数据结点）成为独立的链 1，'
          + '后半段（' + (nAll - half) + ' 个结点）由指针 r 指着。注意全程没有新建结点。',
        log: '切分：前半 ' + half + ' 个、后半 ' + (nAll - half) + ' 个（r 指向后半的第一个结点）', logType: 'warn',
      });
      /* ③ 就地逆置后半段：头插法 */
      let r = second, sHead = NUL, revCount = 0;
      push('revinit', {
        rows: [rowL1(null), mrow('R', 'r', r, 0, []), mrow('S', 's', sHead, 0, [])],
        mark: mk({}), phase: 'rev',
        desc: '第二步：把后半段就地逆置。s 是"已逆置结果"的头（现在是空的），r 是"还没处理"的头。'
          + '每一步把 r 指向的结点摘下来、头插到 s 的最前面（r->next = s; s = r; r = 原来的 r->next）。',
        log: '第二步逆置开始：s = ∧（空）、r = 后半段的第一个结点',
      });
      while (r !== NUL) {
        const nx = pool[r].next;
        pool[r].next = sHead;
        sHead = r;
        r = nx;
        revCount++; moves += 3;
        stat.rev = revCount;
        const exR = {}; exR[sHead] = 'new';
        push('rev', {
          rows: [rowL1(null), mrow('R', 'r', r, 0, []), mrow('S', 's', sHead, 0, [])],
          mark: mk(exR), newIdx: sHead, phase: 'rev',
          desc: '头插第 ' + revCount + ' 个：把数据 ' + pool[sHead].val + ' 摘下来插到 s 的最前面 ⟹ 已逆置 '
            + revCount + ' 个，未处理 ' + (nAll - half - revCount) + ' 个。逆置完成后 s 就是从原表尾往前的顺序。',
          log: '头插：数据 ' + pool[sHead].val + ' → s 最前面（已逆置 ' + revCount + '/' + (nAll - half) + '）',
        });
      }
      /* ④ 交替合并：把后半段的结点依次插到前半段相邻两结点之间 */
      let pp = firstData(), qq = sHead, merged = 0;
      const mergeRows = function (pId, qId, rId, extraA) {
        return [mrow('A', 'head', headIdx, 0, [{ txt: 'p', id: pId, color: '#6366f1' },
          { txt: 'r', id: rId, color: '#0ea5e9' }], extraA),
          mrow('S', 's', qId, 0, [])];
      };
      const rInit = pool[pp].next;   // p 的后继：n = 2 时它就是 NULL（p 后面已经没有别的结点了）
      push('mergeinit', {
        rows: mergeRows(pp, qq, rInit), mark: mk({}), phase: 'merge',
        desc: '第三步：交替合并。p 指向前半段当前结点（数据 ' + pool[pp].val + '）、r = p->next 是它的后继'
          + (rInit === NUL ? '（此时是 NULL——前半段只剩 p 一个结点了）' : '（数据 ' + pool[rInit].val + '）')
          + '，s 指着逆置后的后半段。每次把 s 的头结点摘下来插到 p 与 r 之间，然后 p 走到 r——'
          + '四条语句：r = p->next; p->next = q; q = q->next; p->next->next = r。',
        log: '第三步合并开始：p = ' + pool[pp].val + '、r = ' + (rInit === NUL ? '∧' : pool[rInit].val)
          + '、s 头 = ' + (qq === NUL ? '∧' : pool[qq].val),
      });
      while (qq !== NUL) {
        const rr = pool[pp].next;
        const qn = qq;
        pool[pp].next = qn;
        qq = pool[qn].next;
        pool[qn].next = rr;
        pp = rr;
        merged++; moves += 4;
        stat.merged = merged;
        const exQ = {}; exQ[qn] = 'new';
        push('merge', {
          rows: mergeRows(pp, qq, pool[pp] ? pool[pp].next : NUL, null),
          mark: mk(exQ), newIdx: qn, phase: 'merge',
          desc: '把数据 ' + pool[qn].val + ' 从后半段摘下来、插到 p 之后（p->next = q; q->next = r），'
            + 'p 前进到 r。已合并 ' + merged + ' 个，后半段还剩 ' + (nAll - half - merged) + ' 个。'
            + (merged === nAll - half ? '后半段用完了 ⟹ 合并结束。' : ''),
          log: '合并：数据 ' + pool[qn].val + ' 插到前半段里（已合并 ' + merged + '/' + (nAll - half) + '）',
        });
      }
      const finalSeq = _llSeqText(pool, _llChain(pool, headIdx));
      push('done', {
        rows: [mrow('A', 'head', headIdx, 0, []), mrow('S', 's', NUL, 0, [])],
        mark: mk({}), phase: 'done',
        desc: '完成（表长 n = ' + nAll + '）：L′ = ' + finalSeq + '。三步（找中点 ' + rounds + ' 轮、逆置 ' + revCount + ' 次头插、合并 '
          + merged + ' 次插入）都是"只改指针"，一共走了常数趟 ⟹ 时间 O(n)；除 p、q、r、s 四个指针外没有用任何'
          + '额外空间 ⟹ O(1)——这正是 2019-41 要求的"空间复杂度 O(1) 且时间上尽可能高效"。',
        log: '完成：L′ = ' + finalSeq + '（时间 O(n)、空间 O(1)，全程未新建结点）', logType: 'success',
      });
    }

    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照） ---------------- */
  render(ctx) {
    const s = ctx.snap, model = ctx.model, stage = ctx.stage;
    /* 模式⑤⑥⑦ 走多行布局（行数逐帧变化）；①②③④ 走原来的单链路径 —— 两条路各管各的，互不调用 */
    if (s.layout === 'multi') {
      stage.innerHTML = '<div class="space-y-4">'
        + _llMultiStats(s, model)
        + _llMultiNotice(s, model)
        + '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">'
        + _llMSvg(s) + '</div>'
        + _llMultiTables(s, model)
        + '<div style="display:flex;flex-wrap:wrap;gap:4px 20px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:12px">'
        + _llMultiLegend(s) + '</div>'
        + '</div>';
      return;
    }
    const nodes = s.nodes, chain = s.chain;
    const floatIds = s.floating || [], freedIds = s.freed || [];
    const g = _llGeom(chain.length, floatIds.length + freedIds.length);
    const cy = _llTOP + _llNH / 2;

    /* 位置表：链上 id → {x, cx, y}；悬空 / 已释放 id → D */
    const P = {}, D = {};
    chain.forEach(function (id, k) { const bx = g.xOf(k); P[id] = { x: bx, cx: bx + _llNW / 2, y: _llTOP }; });
    floatIds.concat(freedIds).forEach(function (id, j) { const bx = g.xOf(j); D[id] = { x: bx, cx: bx + _llNW / 2, y: g.detY }; });

    const nl = s.newLink, bl = s.brokeLink;
    const headIsNew = !!nl && nl.from === _llHEAD;

    let svg = '';

    /* ---------- ① 头指针 head 与它的箭头（本帧新建则变绿） ---------- */
    svg += '<g class="ll-ptr-head"><text x="8" y="' + cy + '" dy="0.35em"'
      + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#334155">head</text></g>';
    if (chain.length) {
      svg += _llArrow(44, g.xOf(0), cy, headIsNew ? 'll-arrow ll-head-arrow ll-arrow-new' : 'll-arrow ll-head-arrow',
        headIsNew ? '#10b981' : '#64748b', headIsNew ? 3.2 : 2.2);
    } else {
      svg += '<text x="64" y="' + cy + '" dy="0.35em" class="ll-null"'
        + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#94a3b8">∧（空表）</text>';
    }

    /* ---------- ② 链上相邻结点之间的箭头 + 末结点的 ∧ NULL ---------- */
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k], b = chain[k + 1];
      const hot = !!nl && nl.from === a && nl.to === b;
      svg += _llArrow(g.xOf(k) + _llNW, g.xOf(k + 1), cy,
        hot ? 'll-arrow ll-arrow-new' : 'll-arrow', hot ? '#10b981' : '#94a3b8', hot ? 3.2 : 2.2);
    }
    if (chain.length) {
      const last = chain[chain.length - 1];
      if (nodes[last].next === _llHEAD) {
        const lx = g.xOf(chain.length - 1) + _llNW;
        svg += _llArrow(lx, lx + 20, cy, 'll-arrow ll-null', '#94a3b8', 2);
        svg += '<text x="' + (lx + 26) + '" y="' + cy + '" dy="0.35em" class="ll-null"'
          + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#94a3b8">∧ NULL</text>';
      }
    }

    /* ---------- ③ 被断开的旧指针：红色虚线折线 + ✂（画在结点行下方） ----------
       目标若还在链上，就连到它的**下边**（否则这条竖线会从盒子里穿过去，被盒子盖住一半）；
       目标若已悬空 / 已释放，就连到它的上边（两行之间没有遮挡）。
       水平通道 y 取 g.midY（见 _llGeom 的注释：它保证整条线落在 q 徽标之下、说明文字之上）。
       ✂ 原先放在水平段**中点**，而 q 徽标常在中间 ⟹ 两者压盖；改成贴在**源端**（±14px）。 */
    if (bl) {
      const my = g.midY;
      let sx, sy;
      if (bl.from === _llHEAD) { sx = 44; sy = cy; }
      else { const a = P[bl.from] || D[bl.from]; sx = a ? a.cx : 44; sy = a ? (a.y + _llNH) : cy; }
      let tx, ty;
      if (bl.to === _llHEAD) { tx = sx + 30; ty = sy; }
      else {
        const b = P[bl.to] || D[bl.to];
        tx = b ? b.cx : sx + 30;
        ty = b ? (P[bl.to] ? b.y + _llNH : b.y) : sy;
      }
      svg += '<g class="ll-cut">'
        + '<polyline points="' + sx + ',' + sy + ' ' + sx + ',' + my + ' ' + tx + ',' + my + ' ' + tx + ',' + ty
        + '" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>'
        + '<text x="' + (tx >= sx ? sx + 14 : sx - 14) + '" y="' + my + '" dy="0.35em" text-anchor="middle"'
        + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#ef4444">✂</text></g>';
    }

    /* ---------- ④ 单独画出的新指针（两端不在链上相邻位置时，如"悬空 q → p 的旧后继"） ---------- */
    if (nl && !headIsNew) {
      const aPt = P[nl.from] || D[nl.from] || null;
      const bPt = (nl.to === _llHEAD) ? null : (P[nl.to] || D[nl.to] || null);
      const adjOnChain = !!(P[nl.from] && P[nl.to] && (P[nl.to].x - P[nl.from].x === g.step));
      if (aPt && !adjOnChain) {
        if (bPt) {
          const my = g.midY;   // 与"断链幽灵"共用同一条水平通道，避免两条折线互相穿
          svg += '<g class="ll-newlink">'
            + '<polyline points="' + aPt.cx + ',' + (aPt.y + _llNH) + ' ' + aPt.cx + ',' + my + ' ' + bPt.cx + ',' + my
            + ' ' + bPt.cx + ',' + (bPt.y + _llNH) + '" fill="none" stroke="#10b981" stroke-width="2.6"'
            + ' stroke-dasharray="6 4" stroke-linejoin="round"/>'
            + '<text x="' + (bPt.cx >= aPt.cx ? aPt.cx + 16 : aPt.cx - 16) + '" y="' + my + '" dy="0.35em" text-anchor="middle"'
            + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#10b981">接链</text></g>';
        } else {
          svg += '<g class="ll-newlink">'
            + _llArrow(aPt.x + _llNW, aPt.x + _llNW + 22, aPt.y + _llNH / 2, 'll-arrow ll-arrow-new', '#10b981', 2.6)
            + '<text x="' + (aPt.x + _llNW + 28) + '" y="' + (aPt.y + _llNH / 2) + '" dy="0.35em"'
            + ' style="font:700 12px Consolas,ui-monospace,monospace;fill:#10b981">∧</text></g>';
        }
      }
    }

    /* ---------- ⑤ 第二行：悬空 / 已释放的结点 ----------
       说明文字用**短标签**左对齐在 x=8（右端 ≈85px）：两行的竖线都在 x ≥ 110，故不会穿字。
       不再给每个盒子加"已 free"小字——它会和该盒下方的 q 徽标（detY+NH+26）压盖，
       而整行标签 + 灰/橙配色 + 图例已经能区分"已释放"与"悬空"。 */
    if (floatIds.length || freedIds.length) {
      const lab = (floatIds.length && freedIds.length) ? '摘下 / 已 free'
        : (floatIds.length ? '悬空结点' : '已 free 结点');
      svg += '<text x="8" y="' + g.detLabelY + '" class="ll-det-label"'
        + ' style="font:700 11px Consolas,ui-monospace,monospace;fill:#94a3b8">' + lab + '</text>';
    }
    floatIds.forEach(function (id) {
      const d = D[id];
      svg += _llBox(d.x, d.y, nodes[id], { f: '#fff7ed', t: '#9a3412', st: '#fb923c', dash: true }, 'll-node ll-floating');
    });
    freedIds.forEach(function (id) {
      const d = D[id];
      svg += _llBox(d.x, d.y, nodes[id], { f: '#f8fafc', t: '#94a3b8', st: '#cbd5e1', dash: true }, 'll-node ll-freed');
    });

    /* ---------- ⑥ 链上结点盒（画在箭头之后，压住箭头起点） ---------- */
    chain.forEach(function (id, k) {
      const cls = 'll-node' + (nodes[id].isHead ? ' ll-head' : '') + (id === s.newIdx ? ' ll-new' : '');
      svg += _llBox(g.xOf(k), _llTOP, nodes[id], _llCell(s, id), cls);
    });

    /* ---------- ⑦ p / q 指针标签（p 在上、q 在下；−1 = 头指针本身） ---------- */
    const ptrs = [];
    const drawPtr = function (id, txt, color, cls, above) {
      if (id === null || id === undefined) return;
      let lx, ly, ax, ay;
      if (id === _llHEAD) {
        lx = 26; ly = above ? cy - 40 : cy + 40;
        ax = 26; ay = above ? cy - 14 : cy + 14;
      } else {
        const pt = P[id] || D[id];
        if (!pt) return;
        lx = pt.cx;
        ly = above ? (pt.y - _llLAB) : (pt.y + _llNH + _llLAB);
        ax = pt.cx;
        ay = above ? pt.y : (pt.y + _llNH);
      }
      ptrs.push('<g class="ll-ptr ' + cls + '">'
        + '<line x1="' + lx + '" y1="' + (above ? ly + 11 : ly - 11) + '" x2="' + ax + '" y2="' + ay
        + '" stroke="' + color + '" stroke-width="1.6" stroke-dasharray="3 3"/>'
        + '<rect x="' + (lx - 13) + '" y="' + (ly - 11) + '" width="26" height="22" rx="7" fill="' + color + '"/>'
        + '<text x="' + lx + '" y="' + ly + '" dy="0.35em" text-anchor="middle"'
        + ' style="font:800 12px Consolas,ui-monospace,monospace;fill:#fff">' + txt + '</text></g>');
    };
    drawPtr(s.p, 'p', '#6366f1', 'll-ptr-p', true);
    drawPtr(s.q, 'q', '#f59e0b', 'll-ptr-q', false);

    const svgAll = '<svg viewBox="0 0 ' + g.W + ' ' + g.H + '" class="w-full h-auto mx-auto" style="max-width:'
      + Math.max(g.W, 480) + 'px">' + svg + ptrs.join('') + '</svg>';

    /* ---------- 统计卡（按模式给不同口径） ---------- */
    const headTxt = s.withHead ? '带头结点' : '不带头结点';
    let stats = '';
    if (s.op === 'insert') {
      const isHead = s.pos === 1, isTail = s.pos === model.n + 1;
      stats = RC408.ui.statCard('表长 n', String(s.len), headTxt)
        + RC408.ui.statCard('插入位序 i', String(s.pos), isHead ? '头插' : isTail ? '尾插' : '中间插入', 'text-indigo-600')
        + RC408.ui.statCard('指针移动次数', String(s.moves), '定位前驱 p 的代价 = i − 1')
        + RC408.ui.statCard('本次时间复杂度', isHead ? 'O(1)' : 'O(n)', isHead ? '头插：已拿到头结点，直接改指针' : '瓶颈是定位、不是改指针', isHead ? 'text-emerald-600' : 'text-rose-600');
    } else if (s.op === 'delete') {
      stats = RC408.ui.statCard('表长 n', String(s.len), headTxt)
        + RC408.ui.statCard('删除位序 i', String(s.pos), s.pos === 1 ? '删首元' : s.pos === model.n ? '删表尾' : '删中间', 'text-indigo-600')
        + RC408.ui.statCard('指针移动次数', String(s.moves), '定位前驱 p 的代价 = i − 1')
        + RC408.ui.statCard('已删除结点', String(s.delCount) + ' 个', '改指针 O(1) + free(q)');
    } else if (s.op === 'move2head') {
      stats = RC408.ui.statCard('表长 n', String(s.len), '四条语句执行完仍是 ' + model.n + '（只搬不改数）')
        + RC408.ui.statCard('p 的位置', '第 ' + s.pos + ' 个', 'p 指向的数据结点')
        + RC408.ui.statCard('指针移动次数', String(s.moves), '找 p 的代价 = ' + s.pos + ' 次')
        + RC408.ui.statCard('指针改写次数', '4 次', '① q=p->next ② p->next=q->next ③ q->next=h->next ④ h->next=q', 'text-indigo-600');
    } else {
      stats = RC408.ui.statCard('表长 n', String(s.len), headTxt + '（' + model.n + ' → ' + s.len + '）')
        + RC408.ui.statCard('已访问结点', s.visits + ' 个', '一趟扫描，每个结点只看一次')
        + RC408.ui.statCard('已删除重复', String(s.delCount) + ' 个', '|data| 已出现过就删')
        + RC408.ui.statCard('辅助数组', (model.nmax + 1) + ' 格', '时间 O(m)、空间 O(n) —— 以空间换时间', 'text-indigo-600');
    }

    /* ---------- 提示条（按模式给考点） ---------- */
    let notice = '';
    if (s.op === 'insert') {
      notice = s.pos === 1
        ? '<div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">✓ <b>头插 i=1：指针移动 0 次</b>——因为 p 就是头结点/头指针，不用定位。改两条指针即 O(1)。</div>'
        : s.pos === model.n + 1
          ? '<div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">⚠️ <b>尾插 i=n+1：必须走完整表</b>（' + s.moves + ' 次移动）⟹ O(n)。想 O(1) 就得像循环链表那样额外维护尾指针。</div>'
          : '<div class="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm text-indigo-900">💡 <b>插入两条指针顺序不能反</b>：先 q->next = p->next（接住旧后继）、再 p->next = q。反了就丢掉 p 原来的整条尾巴。</div>';
    } else if (s.op === 'delete') {
      notice = '<div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">✂️ <b>删除三步不能少</b>：q = p->next（先存）→ p->next = q->next（后跨）→ free(q)。只改链不 free 就是内存泄漏。</div>';
    } else if (s.op === 'move2head') {
      notice = '<div class="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm text-indigo-900">📝 <b>2024-1 的语句序列</b>：前两句（q=p->next; p->next=q->next）把 q <b>摘下</b>＝删除，后两句（q->next=h->next; h->next=q）把 q <b>插到表头</b>＝头插；合起来"把 p 的后继搬到表头"，全程 O(1)。</div>';
    } else {
      notice = '<div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">📝 <b>2015-41 的口径</b>：用 ' + (model.nmax + 1) + ' 格的辅助数组记录已出现的绝对值，对链表<b>只做一趟扫描</b> ⟹ 时间 O(m)、空间 O(n)，"以空间换时间"。删除时 <b>p 不动</b>、q 后移。</div>';
    }

    /* ---------- 结点一览（链序 + 每结点的 next） ---------- */
    const tbl = chain.map(function (id) {
      const nd = nodes[id];
      const nxt = nd.next === _llHEAD ? '∧' : String(nodes[nd.next].val);
      const cls = nd.isHead ? 'chip-future' : (id === s.q ? 'chip-check' : (id === s.p ? 'chip-cur' : 'chip-mst'));
      return RC408.ui.chip((nd.isHead ? '头' : String(nd.val)) + ' │ next→' + nxt, cls + ' ll-tbl',
        (nd.isHead ? '头结点' : '数据 ' + nd.val) + '：next 指向 ' + (nd.next === _llHEAD ? 'NULL' : '数据 ' + nodes[nd.next].val));
    }).join('<span class="text-slate-300 self-center">›</span>');

    /* ---------- 辅助数组（仅模式④） ---------- */
    let seenHtml = '';
    if (s.seen) {
      const cells = s.seen.map(function (on, i) {
        return RC408.ui.chip(String(i), (on ? 'chip-hit' : 'chip-future') + ' ll-seen',
          '|data| = ' + i + (on ? '：已出现过' : '：还没出现'));
      }).join('');
      seenHtml = '<div>' + RC408.ui.sectionTitle('辅助数组 seen[0..' + (s.seen.length - 1) + ']（下标 = 数据的绝对值，绿 = 已出现过）') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px">' + cells + '</div>';
    }

    /* ---------- 2024-1 的四条语句进度（仅模式③） ---------- */
    let stmtHtml = '';
    if (s.op === 'move2head') {
      const order = ['init', 'move', 'found', 'stmt1', 'stmt2', 'stmt3', 'stmt4', 'done'];
      const here = order.indexOf(s.step);
      const items = [['① q = p->next', 'stmt1'], ['② p->next = q->next', 'stmt2'],
        ['③ q->next = h->next', 'stmt3'], ['④ h->next = q', 'stmt4']];
      stmtHtml = '<div>' + RC408.ui.sectionTitle('2024-1 的四条语句（当前帧 = 靛框）') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
        + items.map(function (it) {
          const at = order.indexOf(it[1]);
          const cls = at === here ? 'chip-cur' : (at < here ? 'chip-mst' : 'chip-future');
          return RC408.ui.chip(it[0], cls + ' ll-stmt', at === here ? '本帧执行' : (at < here ? '已执行' : '还没执行'));
        }).join('<span class="text-slate-300">›</span>')
        + '</div>';
    }

    /* ---------- 四个位置的代价对照（本模式高亮）= 内联 flex，离线也不塌（§4.7 窗26） ---------- */
    const costRows = [
      ['头插 i=1：移动 0 次 · O(1)', s.op === 'insert' && s.pos === 1],
      ['任意插入 i：移动 i−1 次 · O(n)', s.op === 'insert' && s.pos > 1 && s.pos <= model.n],
      ['尾插 i=n+1：移动 n 次 · O(n)', s.op === 'insert' && s.pos === model.n + 1],
      ['删除第 i 个：移动 i−1 次 · O(n)', s.op === 'delete'],
    ];
    const costHtml = '<div>' + RC408.ui.sectionTitle('四个位置的代价（表长 n，已定位前驱 p）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
      + costRows.map(function (r) { return RC408.ui.chip(r[0], (r[1] ? 'chip-cur' : 'chip-future') + ' ll-cost', r[1] ? '本次操作' : ''); }).join('')
      + '</div>';

    /* ---------- 图例 ---------- */
    const legend = RC408.ui.legend('#6366f1', 'p 指针（前驱 / 当前）')
      + RC408.ui.legend('#f59e0b', 'q 指针（新结点 / 待删 / 正被检查）')
      + RC408.ui.legend('#10b981', '本帧新建的指针（绿色）')
      + RC408.ui.legend('#ef4444', '本帧被断开的旧指针（红虚线 + ✂）')
      + RC408.ui.legend('#94a3b8', '虚线框 = 悬空 / 已 free 的结点（都不在链上）');

    stage.innerHTML = '<div class="space-y-4">'
      + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + stats + '</div>'
      + notice
      + '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">'
      + svgAll + '</div>'
      + '<div>' + RC408.ui.sectionTitle('结点一览（链序：head → 数据结点 → ∧ NULL；徽片上的 next→ 就是指针域的值）') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + (tbl || '<span class="text-xs text-slate-400">（空表：head 直接指向 ∧）</span>') + '</div>'
      + seenHtml
      + stmtHtml
      + costHtml
      + '<div style="display:flex;flex-wrap:wrap;gap:4px 20px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:12px">' + legend + '</div>'
      + '</div>';
  },
});
