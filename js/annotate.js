'use strict';
/* ============================================================================
 * annotate.js —— 理论区「手动标注」（用户 2026-09-25 窗24 要求）
 * ----------------------------------------------------------------------------
 * 交互（用户原话）：理论卡头部有个按钮，**单击开启标注模式**；开启后用**鼠标左键拖选**
 *   文本，**松开左键**后选中的文字变红；**红色文字被再选一次则恢复原色**（开关式）。
 *   另有一个「清空标注」（两击确认）入口，清空**当前知识点**的全部标注。
 *
 * ★ 键盘快捷键（窗26 新增，用户要求"一键打开或关闭"）：**按 `A` 键 = 点一次「✏️ 标注」按钮**。
 *   两条路径共用同一个 `toggle()` ⟹ 行为不可能漂移；开启时若理论区是折叠态，会**顺手展开一次**
 *   （否则"模式开了却选不了字"）。守卫写在纯函数 `isToggleKey()` 里（Node 冒烟直接测真值表）：
 *   带 Ctrl / Meta / Alt 的不算、输入控件 / contenteditable 里不算、输入法组字中不算、长按重复不算。
 *   ⚠ 它**只管"开关模式"**，不代替鼠标拖选——**键盘 Shift+方向键选择仍不支持**（见下"已知边界"）。
 *
 * ★ 数据模型（唯一事实源，存 localStorage 的 `rc408.anno.v1`）：
 *     { '<知识点id>': [ { b, s, e }, ... | { b, m }, ... ] }
 *   · **文本区间** `{b, s, e}`：b = `#theory-body` **直接子元素**的下标（**跳过 `.exam-strip` 分布条**）；
 *     s / e = 该块内**可标注文字**的字符区间 [s, e)（半开区间）
 *   · **公式标记** `{b, m}`（**窗55 新增**）：m = 该块内**第几个公式**（`mathEls()` 数组的下标）——
 *     公式整块包一层 `.kp-anno`，**内部一个字符都不动**
 *   ⟹ 只要"块结构 + 文字内容 + 公式个数与次序"不变，偏移量就一直有效。
 *   ⚠ **公式标记不占字符宽度**（公式在 `s/e` 空间里记 0 宽）⟹ 加上这个功能**没有动老数据的偏移空间**，
 *     既有标注与 `js/anno-seed-<年>.js` 的留档全部继续有效（见 §6.2.55 的取舍说明）。
 *
 * ★ 三条不变量（本模块全部断言都围着它们写，见 tmp_t24_anno_smoke.js / tmp_t24_anno_harness.js）：
 *   ① **只加/去 `<span class="kp-anno">`，绝不增删文字**：标注与取消都会复原
 *      `block.textContent`（长度与内容逐字不变）⟹ 偏移量永不失效、反复标注幂等；
 *   ② **只改颜色、不写字重**（`.kp-anno` 的 CSS 里只有 `color`）⟹ 原本在 `**加粗**`
 *      里的字标红后**仍是粗体**（用户明确要求"粗细和原先一致"）；
 *   ③ **公式整块参与、内部不切开**（窗55 改口径）：KaTeX 的 `.katex` 与离线兜底的 `.md-math`
 *      **按元素整块**包一层 `.kp-anno` —— 既不切开公式（显示不崩），又能把公式标红。
 *      ⚠ 窗24~54 的口径是"公式**不参与**标注"，用户 2026-10-12 两次反馈"公式标注不了"后改成本条；
 *      公式在 `s/e` 空间里仍记 0 宽，所以**老标注不需要迁移**。
 *
 * ★ 为什么用"块下标 + 字符偏移"而不是直接搬 DOM：
 *   `Range.extractContents()` 在跨 `<td>` / 跨 `<li>` 时会克隆出非法嵌套（表格里套表格）。
 *   这里改用"只遍历文本节点、就地 splitText 包一层 span"，**永不产生非法结构**。
 *
 * ⚠ 已知边界（都写进手册，别当 bug）：
 *   · 分布条（`.exam-strip`）**标不上**——它是统计图元、不是正文；公式**能标**（整块，见不变量③）；
 *   · 触屏点选不产生 `mouseup`-选区，故不生效（**键盘 Shift+方向键选择同理，仍不做**；
 *     窗26 只补上了"开关模式"的 `A` 键，没有动选区的取得方式）；
 *   · 标注模式**不持久化**（刷新后默认关闭），标注内容持久化；
 *   · `localStorage` 不可用（隐私模式 / 某些 `file://` 策略）时**自动退化为"仅当次会话"**，
 *     读写都 try/catch 兜底，绝不抛错打断渲染。
 *
 * ★ 知识点 id 从哪来（窗24 收尾修掉的一个真 bug）：**一律取 `RC408.Runner.topicId`**
 *   （`framework.js` 的 `open()` 每次都写），**不要只信本模块记住的 `currentId`**——
 *   它只在"渲染后调过 `apply()` 的分支"里更新；若某个渲染路径没调，在那一页标注就会**挂到
 *   上一个知识点的 id 上**（等于污染另一张卡的红字）。见 `curId()`。
 * ========================================================================== */

RC408.anno = (function () {
  const KEY = 'rc408.anno.v1';
  const CLASS = 'kp-anno';

  /* ======================= 一、纯函数：区间运算（Node 侧可单独冒烟） =======================
   * ★ **两种区间**（窗55 新增第二种，用户第二次报"公式标注不了"）：
   *   · **文本区间** `{b, s, e}` —— 沿用至今，`s/e` 是"**可标注文字**"空间里的偏移（公式记 0 宽）
   *   · **公式标记** `{b, m}`     —— `m` = 该块内**第几个公式**（只按元素整块包一层，**内部绝不切开**）
   *   ⚠ 关键取舍：公式标记**不占字符宽度** ⟹ `s/e` 的空间**一个字节都没变** ⟹
   *     用户既有的标注与 `js/anno-seed-2026.js` 的 33 张卡留档**全部继续有效**（不需要迁移）。
   *     若改成"公式也算宽度"，所有历史 `{b,s,e}` 都会整体错位 —— 那等于把老 bug 换一批人再犯一次。 */

  /** 规范化：丢掉空区间、按 (块, 起点) 排序、把同块内相接/重叠的**文本**区间并起来；公式标记按 (b,m) 去重 */
  function normalize(list) {
    const arr = (list || [])
      .filter(r => r && typeof r.b === 'number' && r.b >= 0)
      .map(r => (typeof r.m === 'number'
        ? { b: r.b, s: 0, e: 0, m: r.m }
        : { b: r.b, s: r.s, e: r.e }))
      .filter(r => (typeof r.m === 'number') || (typeof r.s === 'number' && typeof r.e === 'number' && r.e > r.s))
      .sort((x, y) => (x.b - y.b) || (x.s - y.s));
    const txt = [], math = [], seen = {};
    for (const r of arr) {
      if (typeof r.m === 'number') { const k = r.b + ':' + r.m; if (!seen[k]) { seen[k] = 1; math.push(r); } }
      else txt.push(r);
    }
    const out = [];
    for (const r of txt) {
      const last = out[out.length - 1];
      if (last && last.b === r.b && r.s <= last.e) { if (r.e > last.e) last.e = r.e; }
      else out.push({ b: r.b, s: r.s, e: r.e });
    }
    /* 公式标记排在后面：`apply()` 会先包文本再包公式，顺序不影响结果 */
    for (const r of math) out.push({ b: r.b, s: 0, e: 0, m: r.m });
    return out;
  }

  /** 并：把 seg 加进去 */
  function union(list, seg) { return normalize(normalize(list).concat([seg])); }

  /** 差：从 list 里抠掉 seg（文本 seg 落在区间中间时会拆成两条；公式 seg 只按 (b,m) 精确匹配） */
  function subtract(list, seg) {
    const out = [];
    const isMath = typeof seg.m === 'number';
    for (const r of normalize(list)) {
      const rMath = typeof r.m === 'number';
      if (isMath) { if (!(rMath && r.b === seg.b && r.m === seg.m)) out.push(r); continue; }
      if (rMath) { out.push(r); continue; }                       /* 抠文本时不许碰公式标记 */
      if (r.b !== seg.b || r.e <= seg.s || r.s >= seg.e) { out.push(r); continue; }
      if (r.s < seg.s) out.push({ b: r.b, s: r.s, e: seg.s });
      if (r.e > seg.e) out.push({ b: r.b, s: seg.e, e: r.e });
    }
    return normalize(out);
  }

  /** 整段是否已被标红（用户说的"红色文本被再选一次"就是它）；两种区间各比各的 */
  function isCovered(list, seg) {
    const isMath = typeof seg.m === 'number';
    for (const r of normalize(list)) {
      const rMath = typeof r.m === 'number';
      if (isMath) { if (rMath && r.b === seg.b && r.m === seg.m) return true; continue; }
      if (rMath) continue;
      if (r.b === seg.b && r.s <= seg.s && r.e >= seg.e) return true;
    }
    return false;
  }

  /** 一次拖选的最终结果：**逐段**判断——整段已红则抠掉，否则涂红
   *  ★ 混合选区的口径（窗24 定，写在代码里免得下一窗当 bug 改）：选中的一段里
   *    **只要不是全红**（含"半红半黑"）就**整段涂红** —— 这样用户才能靠拖选把已有标注**扩长**；
   *    扩长之后再整段选一次才会全部恢复。若改成"混合就削红"，标注就永远只能变小、扩不动。 */
  function plan(existing, segs) {
    let out = normalize(existing);
    for (const seg of segs) out = isCovered(out, seg) ? subtract(out, seg) : union(out, seg);
    return out;
  }

  /* ======================= 二、存储（读写都兜底，坏数据一律当空） ======================= */

  function store() { try { return window.localStorage; } catch (e) { return null; } }

  function loadAll() {
    const s = store();
    if (!s) return {};
    let o = null;
    try { o = JSON.parse(s.getItem(KEY) || '{}'); } catch (e) { o = null; }
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  }

  function saveAll(o) {
    const s = store();
    if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }

  function getRanges(id) { const o = loadAll(); return Array.isArray(o[id]) ? normalize(o[id]) : []; }

  function setRanges(id, list) {
    if (!id) return;
    const o = loadAll();
    const clean = normalize(list);
    if (clean.length) o[id] = clean; else delete o[id];
    saveAll(o);
  }

  /* ======================= 三、DOM 侧：块枚举 / 偏移测量 / 应用 ======================= */

  /** 参与标注的块 = `#theory-body` 的直接子元素，**排除分布条** */
  function blocks(body) {
    const out = [];
    const kids = (body && body.children) || [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains('exam-strip')) continue;
      out.push(kids[i]);
    }
    return out;
  }

  /** 不参与标注的子树：公式（两种产物）与分布条 */
  function isSkip(el) {
    const c = el && el.classList;
    return !!(c && (c.contains('katex') || c.contains('md-math') || c.contains('exam-strip')));
  }

  /** 块内全部"可标注文本节点"（文档顺序，跳过公式子树） */
  function textNodes(block) {
    const out = [];
    (function walk(node) {
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 3) { if (ch.nodeValue) out.push(ch); continue; }
        if (ch.nodeType !== 1 || isSkip(ch)) continue;
        walk(ch);
      }
    })(block);
    return out;
  }

  /** 块内**最外层**的公式元素（文档顺序）。"最外层"= 祖先里不再有公式，免得 `.katex` 套 `.md-math` 时数两遍。
   *  ⚠ 这是"公式标记"的定位口径：`m` 就是这个数组的下标 —— 只要块内公式的**个数与顺序**不变，标记就一直有效。 */
  function mathEls(block) {
    const out = [];
    (function walk(node) {
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType !== 1) continue;
        if (isSkip(ch)) { if (!ch.classList.contains('exam-strip')) out.push(ch); continue; }
        walk(ch);
      }
    })(block);
    return out;
  }

  /** 把**整个公式元素**包一层标注 span（内部一个字符都不动 —— 这正是"不切开公式"的实现方式） */
  function wrapMath(block, k) {
    const el = mathEls(block)[k];
    if (!el || !el.parentNode) return 0;
    if (el.parentNode.classList && el.parentNode.classList.contains(CLASS)) return 0;   /* 已包过 */
    const span = document.createElement('span');
    span.className = CLASS;
    el.parentNode.insertBefore(span, el);
    span.appendChild(el);
    return 1;
  }

  /** 节点/片段里"可标注文字"的总长度（与 textNodes 同一口径，必须一致） */
  function textLen(root) {
    if (!root) return 0;
    if (root.nodeType === 3) return root.nodeValue ? root.nodeValue.length : 0;
    if (root.nodeType !== 1 && root.nodeType !== 11) return 0;
    if (root.nodeType === 1 && isSkip(root)) return 0;
    let n = 0;
    for (let ch = root.firstChild; ch; ch = ch.nextSibling) n += textLen(ch);
    return n;
  }

  /** 端点 (node, offset) 在 block 内的**可标注**字符偏移；不在这个块里返回 -1。
   *  ★ **窗55 修（用户 2026-10-12 报："我标注公式的时候其他地方莫名其妙变红了，公式没变红"）**：
   *    旧写法对**文本节点**走"在 `textNodes(block)` 列表里查这个节点"，而 `textNodes` **跳过公式子树**
   *    ⟹ 端点落在 `.katex` / `.md-math` 里时那个节点根本不在列表里 ⟹ 返回 **-1**；
   *    调用方 `measure()` 再把 -1 兜成 `0` / `full` ⟹ **从选区另一端一路红到块边界**
   *    （实测：只想选到公式，结果整块被标掉 **102 字**）。
   *    现**统一走 Range 口径**：把 `[块起点, (node, offset))` 之间的"可标注文字"数一遍 ——
   *    `textLen` 对跳过子树记 0，所以端点落在公式内部时会**正好停在公式左边界**：
   *    既不再误伤别处，也不必把公式切开（"公式不参与标注"是既定边界，不改）。 */
  function offsetOfPoint(block, node, offset) {
    if (!node) return -1;
    if (node !== block && !block.contains(node)) return -1;
    const r = document.createRange();
    r.selectNodeContents(block);
    try { r.setEnd(node, offset); } catch (e) { return -1; }
    return textLen(r.cloneContents());
  }

  /** 端点所在的块下标（相对 blocks() 数组；分布条 / 块外一律 -1） */
  function blockIndexOf(body, node) {
    if (!node || node === body) return -1;
    let el = node.nodeType === 1 ? node : node.parentNode;
    while (el && el.parentNode !== body) el = el.parentNode;
    if (!el) return -1;
    return blocks(body).indexOf(el);
  }

  /** 把一次选区翻译成 [{b,s,e}]（跨块自动逐块切分） */
  function measure(body, range) {
    const bs = blocks(body);
    if (!bs.length || !range) return [];
    const startAtBody = range.startContainer === body;
    const endAtBody = range.endContainer === body;
    const sb = startAtBody ? 0 : blockIndexOf(body, range.startContainer);
    const eb = endAtBody ? bs.length - 1 : blockIndexOf(body, range.endContainer);
    if (sb < 0 || eb < 0 || eb < sb) return [];
    const out = [];
    for (let i = sb; i <= eb; i++) {
      const blk = bs[i];
      const full = textLen(blk);
      let s = (i === sb) ? (startAtBody ? 0 : offsetOfPoint(blk, range.startContainer, range.startOffset)) : 0;
      let e = (i === eb) ? (endAtBody ? full : offsetOfPoint(blk, range.endContainer, range.endOffset)) : full;
      /* ★ **窗55 修**：端点**解析不出来**时，旧写法兜成 `0` / `full` —— 那等于"把整块标红"，
         正是用户看到的"别处莫名其妙变红"。现在改成**跳过这一块**：宁可不标，也不标错。
         （`e > full` 仍按原样夹紧：那是"选区比块长"的正常情况，不是解析失败。） */
      if (s < 0 || e < 0) continue;
      if (e > full) e = full;
      if (e > s) out.push({ b: i, s: s, e: e });
      /* ★ **窗55 新增：公式整块参与标注**（用户第二次报"公式标注不了"）。
         只要这次选区**碰到了**公式元素，就把整个公式记成一条 `{b, m}`（m = 块内第几个公式）：
         · 为什么"碰到就算整块"——公式是不可分割的排版单元，选半个公式没有语义；
         · 为什么不记 `s/e`——公式在"可标注文字"空间里宽度为 0，`s/e` 无从表达它，
           而 `m` 作为身份既稳定（块内公式的次序不变则一直有效）又**不动老数据的偏移空间**。 */
      try {
        mathEls(blk).forEach(function (el, k) {
          if (range.intersectsNode && range.intersectsNode(el)) out.push({ b: i, s: 0, e: 0, m: k });
        });
      } catch (e2) { /* intersectsNode 对已脱离文档的节点会抛；忽略，不影响文本标注 */ }
    }
    return out;
  }

  /** 把一个文本节点里的 [from,to) 就地包一层 span（右段先 split，左侧偏移不受影响） */
  function wrapPart(node, from, to) {
    const t = node.splitText(from);
    t.splitText(to - from);
    const span = document.createElement('span');
    span.className = CLASS;
    t.parentNode.insertBefore(span, t);
    span.appendChild(t);
  }

  /** 在块内给 [s,e) 上色；跨多个文本节点时逐节点包（文字一字不动） */
  function wrapRange(block, s, e) {
    let acc = 0, made = 0;
    for (const node of textNodes(block)) {
      const len = node.nodeValue.length;
      const a = Math.max(s, acc), b = Math.min(e, acc + len);
      acc += len;
      if (b > a) { wrapPart(node, a - (acc - len), b - (acc - len)); made++; }
    }
    return made;
  }

  /** 拆掉块内所有标注 span（把子节点搬回原位），并合并相邻文本节点 */
  function unwrap(block) {
    const spans = [].slice.call(block.querySelectorAll('.' + CLASS));
    for (const sp of spans) {
      const p = sp.parentNode;
      if (!p) continue;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      p.removeChild(sp);
    }
    if (block.normalize) block.normalize();
  }

  /** 按数据重画：先全拆、再按区间重包（幂等；这是"取消标注"唯一的还原路径） */
  function apply(id, bodyEl) {
    if (id) currentId = id;
    const body = bodyEl || document.getElementById('theory-body');
    if (!body) return 0;
    const tid = curId();                 // ★ 用真源 id（见下端 curId 的说明）
    const bs = blocks(body);
    for (const b of bs) unwrap(b);
    let n = 0;
    for (const r of getRanges(tid)) {
      const blk = bs[r.b];
      if (!blk) continue;
      if (typeof r.m === 'number') n += wrapMath(blk, r.m);      /* 公式：整块包一层 */
      else n += wrapRange(blk, r.s, r.e);                        /* 文本：逐节点包 */
    }
    syncClear();
    return n;
  }

  /* ======================= 四、交互：模式开关 / 拖选变红 / 清空 ======================= */

  let on = false;          // 标注模式（不持久化：刷新后默认关闭）
  let currentId = null;    // 最近一次渲染的知识点 id（由 framework 的 hook 每次渲染时写入）
  let armed = false;       // "清空标注"的两击确认中间态

  /** ★ 当前知识点 id 的**真源**：框架的 `Runner.topicId`（每次 `open()` 都写）。
   *  只用 `currentId` 不够——它只在"调过 `apply()` 的分支"里更新；某个渲染路径若没调，
   *  在那一页标注就会**挂到上一个知识点的 id 上**（污染另一张卡的红字）。
   *  窗24 收尾时发现并修掉：`Runner.topicId` + 占位页也调 `apply()`，双保险。 */
  function curId() {
    const R = (typeof RC408 !== 'undefined' && RC408.Runner) || null;
    return (R && R.topicId) || currentId;
  }

  function el(id) { return document.getElementById(id); }

  function syncHint() {
    const hint = el('anno-hint');
    const btn = el('anno-toggle');
    if (btn) btn.classList.toggle('anno-on', on);
    if (btn) btn.textContent = on ? '✏️ 标注中 (A)' : '✏️ 标注 (A)';
    if (hint) hint.classList.toggle('hidden', !on);
    const card = el('theory-body');
    if (card) card.classList.toggle('anno-mode', on);
  }

  function syncClear() {
    const btn = el('anno-clear');
    if (!btn) return;
    const has = getRanges(curId()).length > 0;
    btn.classList.toggle('hidden', !has);
    if (!armed) btn.textContent = '清空本卡';
  }

  function setOn(v) {
    on = !!v;
    armed = false;
    syncHint();
    syncClear();
    if (!on) {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    }
  }

  /** 松开左键：把当前选区按"已红则还原、否则涂红"应用，然后取消浏览器自身的蓝底选中 */
  function onMouseUp() {
    if (!on) return;
    const body = el('theory-body');
    if (!body) return;
    const tid = curId();
    if (!tid) return;                      // 没有当前知识点就什么都不做（宁可不动，也不写错 id）
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const segs = measure(body, sel.getRangeAt(0));
    /* ★ 窗55：**无论标没标上都清掉浏览器选区**。原来 `if (!segs.length) return;` 会**连选区一起留着**，
       用户看到"蓝底还挂在那儿、什么也没发生"，很自然就报"标注不了"（用户 2026-10-12 第二次反馈）。
       而且即便标不上，也已经没有任何可做的了；清掉选区至少给了一个"这一下收到了"的反馈。 */
    if (segs.length) setRanges(tid, plan(getRanges(tid), segs));
    apply(tid, body);
    if (sel.removeAllRanges) sel.removeAllRanges();
  }

  /* ======================= 六、标注留档的"一键载入"（窗48 新增，用户要求） ======================= */
  /** 把 `RC408.annoSeeds` 里的留档合并进本机标注（**默认就载入** —— 用户 2026-10-09 明确：
   *  "我是说在网站上标注出来，让我能看到"，打开站点就该看见，不该再去手敲 URL 参数）。
   *  · 已在 localStorage 里的同 id 数据**不覆盖**（用户自己的标注优先）；
   *  · URL 上带 `?anno=<key>` 时只载入那一个留档（便于挑着看 / 复核）；带 `?anno=off` 时**一律不载入**；
   *  · 数据写在 `js/anno-seed-2026.js`，本函数只做合并 + 兜底，绝不抛错打断渲染。 */
  function seedFromUrl() {
    try {
      const q = (window.location && window.location.search) || '';
      const m = /[?&]anno=([A-Za-z0-9_-]+)/.exec(q);
      if (m && m[1] === 'off') return 0;
      const seeds = (typeof RC408 !== 'undefined' && RC408.annoSeeds) || null;
      if (!seeds) return 0;
      const keys = (m && seeds[m[1]]) ? [m[1]] : Object.keys(seeds);
      const all = loadAll();
      let n = 0;
      keys.forEach(k => {
        const seed = seeds[k];
        if (!seed || typeof seed !== 'object') return;
        Object.keys(seed).forEach(id => {
          if (Array.isArray(all[id]) && all[id].length) return;   /* 用户自己标过 ⟹ 不覆盖 */
          const list = normalize(seed[id]);
          if (list.length) { all[id] = list; n++; }
        });
      });
      saveAll(all);
      return n;
    } catch (e) { return 0; }   // 坏数据 / 无 localStorage 都不能打断渲染
  }

  function init() {
    seedFromUrl();               /* 先载入留档（若有），再绑按钮 —— 顺序不影响 apply（框架渲染时会重画） */
    const btn = el('anno-toggle');
    if (!btn || btn.dataset.annoBound === '1') return false;
    btn.dataset.annoBound = '1';
    /* 头部整行是"折叠/展开"的点击区 ⟹ 两个按钮都必须 stopPropagation */
    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    const clear = el('anno-clear');
    if (clear) clear.addEventListener('click', e => {
      e.stopPropagation();
      const tid = curId();
      if (!tid) return;
      if (!armed) {
        armed = true;
        clear.textContent = '确认清空？';
        setTimeout(() => { armed = false; syncClear(); }, 3000);
        return;
      }
      armed = false;
      setRanges(tid, []);
      apply(tid);
    });
    document.addEventListener('mouseup', onMouseUp);
    /* 窗26：一键开关的键盘绑定（与上面的按钮共用 toggle()） */
    document.addEventListener('keydown', onKeyDown);
    syncHint();
    syncClear();
    return true;
  }

  /* ======================= 五、键盘快捷键：一键开关（窗26 新增，用户要求） ======================= */

  /** 事件目标是不是"正在输入"的控件？（在里头按 A 是在打字，不是在开关标注） */
  function isEditable(t) {
    if (!t || t.nodeType !== 1) return false;      // 非元素（如 document）不算
    if (t.isContentEditable) return true;          // 浏览器对 contenteditable 会连祖先一起判
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!(t.closest && t.closest('[contenteditable="true"]'));
  }

  /** ★ 这个 keydown 该不该触发"一键开关"？（纯函数，Node 冒烟直接测真值表）
   *  只认单个 A 键：① 带 Ctrl / Meta / Alt 的一律让给浏览器（**不许抢 `Ctrl+A` 全选**）；
   *  ② 输入控件 / contenteditable 里不算；③ 输入法组字中不算；④ 长按重复不算（免得一按到底来回翻转）。
   *  ★ 与框架既有快捷键（→ ← 空格 R，见 `framework.js`）不冲突：那边按 `e.key` 各自分支，
   *    这里只吃掉 A；两边的"输入控件里不拦"守卫是同一套口径。 */
  function isToggleKey(e) {
    if (!e) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.isComposing || e.keyCode === 229) return false;   // 输入法组字中的 keydown
    if (e.repeat) return false;
    if (String(e.key || '').toLowerCase() !== 'a') return false;
    return !isEditable(e.target);
  }

  /** 开启标注时，若理论区处于折叠态就**展开一次**——否则"模式开了却选不了字"。
   *  ⚠ 折叠状态归 `framework.js` 的 `#theory-toggle` 管，这里**只做单向展开**、不参与折叠决策
   *    （不做"关模式就折回去"这种对称动作——那会变成第二个状态源）。 */
  function revealTheory() {
    const body = el('theory-body');
    if (body && body.classList.contains('hidden')) {
      body.classList.remove('hidden');
      const arrow = el('theory-arrow');
      if (arrow) arrow.textContent = '▼';
    }
  }

  /** 一键开关：按钮与 A 键**共用这一个入口** ⟹ 两条路径的行为不可能漂移 */
  function toggle() {
    setOn(!on);
    if (on) revealTheory();
  }

  function onKeyDown(e) {
    if (!isToggleKey(e)) return;
    if (e.preventDefault) e.preventDefault();   // A 无默认动作；这里只防"插入符浏览"这类边角行为
    toggle();
  }

  const api = {
    KEY: KEY, CLASS: CLASS,
    /* 纯函数（Node 冒烟直接用） */
    normalize: normalize, union: union, subtract: subtract, isCovered: isCovered, plan: plan,
    /* 存储 */
    loadAll: loadAll, saveAll: saveAll, getRanges: getRanges, setRanges: setRanges,
    /* DOM */
    blocks: blocks, textNodes: textNodes, textLen: textLen, offsetOfPoint: offsetOfPoint,
    measure: measure, apply: apply, unwrap: unwrap, wrapRange: wrapRange,
    mathEls: mathEls, wrapMath: wrapMath,
    /* 交互 */
    init: init, setOn: setOn, isOn: function () { return on; }, toggle: toggle,
    isToggleKey: isToggleKey, isEditable: isEditable, onKeyDown: onKeyDown,
    seedFromUrl: seedFromUrl,
    current: function () { return curId(); },
    syncClear: syncClear,
  };

  /* 浏览器里自启（框架的 hook 只负责"每次渲染后重画"，按钮绑定在这里做一次） */
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return api;
})();
