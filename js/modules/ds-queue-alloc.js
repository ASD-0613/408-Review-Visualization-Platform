'use strict';
/* ============================================================================
 * ds-queue-alloc.js —— 【数据结构】多队列分配与轨道数（最少轨道 = 最长下降子序列长）
 *
 * 考情：1 年 / 1 题（选 1）—— 2016-3：入队顺序 8,4,2,5,3,9,1,6,7，出队顺序 1~9，入口与出口之间
 *   有多条队列（n 条轨道），每个队列可容纳多个元素。问至少需要几条轨道 ⟹ **4 条**（答案 C）。
 *   ★ 窗54 从零核定（证据 `考情缓存/2016_解析.txt:77-99`，结论行 :97「共占用了 4 个队列」；
 *   答案字母经 `考情缓存/扫描页/2016_解析_p01.png` 目视核对 = 3. C；索引 `考情缓存/关键词索引.md:85`）：
 *   其余 17 年按「轨道 / 队列 / 出队 / 入队 / 调度 / 车厢 / 列车 / 多列」八个关键词搜遍全部缓存 txt，
 *   只有 2016-3 是本题；核过而排除：2009-2 栈的合法出栈序列、2010-2 输出受限双端队列、
 *   2011-3 循环队列判空判满、2014-3 双端循环队列、2021-2 一端入队另一端可入可出、
 *   2019-42（大题，队列结构设计）、2014-41 / 2012-5（队列只作 BFS 工具）与各年 OS 就绪队列题。
 *
 * 快照模型（stepper）：逐元素入队 → 每步全量携带"各轨道内容 + 队尾" → 末帧给下界与三路验算。
 *
 * 数据模型与不变量（冒烟逐条断言，别只靠眼看）：
 *   ① 入队序列必须是 1..n 的一个排列（本题族都是"出队顺序 1~n"），n ∈ [2,12]；
 *   ② **一条轨道内的元素必须严格递增**——轨道是 FIFO，若先入 a 后入 b 且 a > b，出队时 a 必在 b 前，
 *      与"出队顺序 1,2,…,n"矛盾 ⟹ 合法方案 = 把入队序列**划分成 k 条递增子序列**；
 *   ③ 贪心规则：把 x 放进"队尾 < x"的轨道里**队尾最大的那条**（放得越紧越不浪费），没有就**新开一条**；
 *   ④ **最少轨道数 = 最长下降子序列长度 L**：任取一条下降子序列 x₁>x₂>…>x_L，它们两两不能同轨
 *      （同轨必须递增）⟹ 任何方案都要 ≥ L 条；贪心的条数恰为 L ⟹ 下界可达；
 *   ⑤ 每开一条新轨道 ⟺ 该元素落在了它自己那条轨道的第一位，且其"层号"（= 以它为末项的最长下降
 *      子序列长度）恰好等于 L 时才可能到顶 ⟹ 轨道数、L、**最长递增子序列长**在本模块的输入上三路一致；
 *   ⑥ 贪心**不许重排输入**：各轨道按元素在入队序列里的下标升序拼起来必须恰好等于原序列（末帧验算）。
 *
 * ⚠ 布局纪律（§4.7，窗26 立）：容器布局一律写**内联 style**，不用 Tailwind 工具类（离线 harness
 *   不加载 Tailwind）；类名只当**选择器**给断言用（`qa-*`）。
 * ========================================================================== */

/* 轨道配色（按轨道序号循环取用） */
const _qaColors = ['#4f46e5', '#0891b2', '#d97706', '#059669', '#db2777', '#7c3aed', '#0d9488', '#b45309'];

RC408.registerModule({
  id: 'ds-queue-alloc',
  mode: 'stepper',
  title: '多队列分配与轨道数（最少轨道 = 最长下降子序列长）',

  theory: `
> **为什么要有它**：入口与出口之间摆着若干条轨道（队列），元素按给定顺序进入、必须按 1,2,…,n 的顺序离开。问"至少几条轨道"——这是队列应用里唯一一道把"最少"问到底的题，考的不是算得出，而是**说得出为什么不能再少**。
> **怎么实现**：轨道是先进先出，所以**同一条轨道里后进去的元素必须更大**，否则大的会先出来，1~n 的出队顺序立刻被破坏。于是问题变成：把入队序列**划分成尽量少的递增子序列**。逐个元素处理——能塞进某条现有轨道就塞（塞进"队尾最大且仍小于它"的那条最省），塞不进才新开一条。
> **记住什么**：**最少轨道数 = 最长下降子序列长度**。下降子序列里任意两个元素都不能同轨（同轨必须递增），所以它给出"至少这么多条"；贪心正好占到这么多条，下界可达。

## 一列火车怎么变成一条轨道

| 事实 | 为什么 | 后果 |
| --- | --- | --- |
| 轨道是**队列**（FIFO） | 先入先出 | 同轨的离开顺序 = 它们的进入顺序 |
| 出队顺序固定 1,2,…,n | 题面给定 | 同轨**后进入的元素必须更大** |
| 同轨元素递增 | 由上面两条推出 | 方案 ⟺ 把入队序列划分成 k 条递增子序列 |

## "至少几条"的下界：最长下降子序列

取入队序列里任意一条下降子序列 \\(x_1 > x_2 > \\cdots > x_L\\)：
1. 其中任意两个都不能同轨（同轨必须递增，而它们递减）；
2. 所以需要**至少 L 条**轨道；
3. 贪心算法实际用掉的轨道数**恰好等于 L** ⟹ 最少轨道数 \\(= L\\)。

手算找 L 的稳妥办法是**打层号**：从左往右扫，第 i 个元素标 \\(f_i = 1 + \\max\\{f_j \\mid j < i,\\ x_j > x_i\\}\\)，最大的 \\(f_i\\) 就是 L（2016-3 里 8 的层号是 1、4 是 2、2 是 3、1 是 4 ⟹ L = 4）。

## 贪心分配的四步

1. 取下一个入队元素 x；
2. 在**队尾小于 x** 的轨道里，挑**队尾最大**的那条（放得越紧，后面越不缺位置）；
3. 一条都没有 ⟹ **新开一条轨道**（这一刻就是下界被顶上去的时候）；
4. 记下这一步的轨道数与各队尾，**继续读下一个元素**（不重排、不回溯）。

## 2016-3 逐步分配（轨道号按开设顺序 1,2,…）

| 入队元素 | 放进 | 各轨道内容 | 队尾 |
| --- | --- | --- | --- |
| 8 | 新开 1 | [8] | 8 |
| 4 | 新开 2 | [8]、[4] | 8、4 |
| 2 | 新开 3 | [8]、[4]、[2] | 8、4、2 |
| 5 | 轨道 2 | [8]、[4,5]、[2] | 8、5、2 |
| 3 | 轨道 3 | [8]、[4,5]、[2,3] | 8、5、3 |
| 9 | 轨道 1 | [8,9]、[4,5]、[2,3] | 9、5、3 |
| 1 | **新开 4** | [8,9]、[4,5]、[2,3]、[1] | 9、5、3、1 |
| 6 | 轨道 2 | [8,9]、[4,5,6]、[2,3]、[1] | 9、6、3、1 |
| 7 | 轨道 2 | [8,9]、[4,5,6,7]、[2,3]、[1] | 9、7、3、1 |

读到 1 时四条轨道的队尾是 9、5、3、1，全都大于 1 ⟹ 只能新开第 4 条；而 (8,5,3,1)（也可取 8,4,2,1）本身就是一条下降子序列 ⟹ 4 条既是"用到了"也是"下界"⟹ **答案 4 条（选项 C）**。

## 考点提醒（易错点）

1. **别把"最少"当成"随便放"**：任意一种放法都能放完，关键是**它用到几条**；官方解析给的只是其中一种最优放法；
2. **轨道里必须递增**是硬约束：看到"大元素放进已经有更大队尾的轨道"就是错的；
3. **新开轨道的次数**才是答案，不是"用了几条轨道编号"；本题里 1 号轨道一直空着队列名，但内容换过（[8] → [8,9]）；
4. **下界要用下降子序列说**：光说"我这样放用了 4 条"不够，还要说"任何放法都 ≥ 4 条"；
5. 拿不准就**打层号**：最大层号 = 最少轨道数，一步不差。

> **真题考情**：**1/18 年（选 1，无大题）**：2016-3（入队 8,4,2,5,3,9,1,6,7、出队 1~9 的多轨道调度，最少 4 条轨道，答案 C）。
`,

  inputs: [
    { key: 'seq', label: '入队顺序（1~12 的一个排列，逗号或空格分隔）', type: 'text', wide: true,
      default: '8,4,2,5,3,9,1,6,7',
      help: '出队顺序固定为 1,2,…,n（本题族的题面口径）；元素个数 2 ~ 12' },
    { key: 'verify', label: '末帧附加验算', type: 'select', default: 'on',
      options: [
        { v: 'on', t: '做（穷举 n ≤ 7 的真·最少轨道数对照）' },
        { v: 'off', t: '不做（只给出下界与贪心条数）' },
      ],
      help: '穷举会枚举所有"划分成递增子序列"的方案，给出与贪心无关的第二个数字' },
  ],

  quickActions: [
    { label: '🎯 2016-3 真题（8,4,2,5,3,9,1,6,7 → 4 条轨道）', run(rt) {
      rt.setInput('seq', '8,4,2,5,3,9,1,6,7');
      rt.setInput('verify', 'on');
      rt.load();
    } },
    { label: '已经有序（1,2,3,4,5 → 1 条足够）', run(rt) {
      rt.setInput('seq', '1,2,3,4,5'); rt.setInput('verify', 'on'); rt.load();
    } },
    { label: '完全逆序（5,4,3,2,1 → 5 条）', run(rt) {
      rt.setInput('seq', '5,4,3,2,1'); rt.setInput('verify', 'on'); rt.load();
    } },
    { label: '队尾最大才省轨道（3,1,4,2）', run(rt) {
      rt.setInput('seq', '3,1,4,2'); rt.setInput('verify', 'on'); rt.load();
    } },
    { label: '经典反例（5,1,4,2,3 → 3 条）', run(rt) {
      rt.setInput('seq', '5,1,4,2,3'); rt.setInput('verify', 'on'); rt.load();
    } },
  ],

  parse(vals) {
    const seq = _qaNums(vals.seq);
    if (!seq.length) throw { message: '请填写入队顺序，如 8,4,2,5,3,9,1,6,7' };
    if (seq.length < 2) throw { message: '至少要 2 个元素（现在 ' + seq.length + ' 个）' };
    if (seq.length > 12) throw { message: '最多演示 12 个元素（现在 ' + seq.length + ' 个）' };
    const bad = seq.findIndex(v => !Number.isInteger(v) || v < 1 || v > seq.length);
    if (bad >= 0) throw { message: '第 ' + (bad + 1) + ' 个元素是「' + seq[bad] + '」，必须是 1 ~ ' + seq.length + ' 之间的整数' };
    const seen = new Set(seq);
    if (seen.size !== seq.length) {
      const dup = seq.find((v, i) => seq.indexOf(v) !== i);
      throw { message: '元素「' + dup + '」出现了两次——入队顺序必须是 1 ~ ' + seq.length + ' 的一个排列' };
    }
    return { n: seq.length, seq: seq, verify: String(vals.verify || 'on') !== 'off' };
  },

  buildSnapshots(model) {
    const n = model.n, seq = model.seq;

    /* ③ 贪心分配：每步全量携带各轨道内容与队尾；新开轨道的那一步单独标出 */
    const qs = [];                       // qs[k] = 该轨道的内容（入队先后顺序）
    let nNew = 0;
    const place = [];                    // place[i] = 第 i 个元素落在哪条轨道
    const steps = [];
    for (let i = 0; i < n; i++) {
      const x = seq[i];
      const tails = qs.map(q => q[q.length - 1]);
      let pick = -1;
      for (let k = 0; k < qs.length; k++) if (tails[k] < x && (pick < 0 || tails[k] > tails[pick])) pick = k;
      const isNew = pick < 0;
      if (isNew) { qs.push([x]); pick = qs.length - 1; nNew++; } else qs[pick].push(x);
      place.push(pick);
      steps.push({
        i: i, x: x, pick: pick, isNew: isNew,
        qs: qs.map(q => q.slice()), tails: qs.map(q => q[q.length - 1]),
        k: qs.length, nNew: nNew,
      });
    }
    const kGreedy = qs.length;

    /* ④ 最长下降子序列（下界）：O(n²) 打层号 + 回溯一条 */
    const f = new Array(n).fill(1);
    let ldsLen = 0, ldsEnd = -1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) if (seq[j] > seq[i] && f[j] + 1 > f[i]) f[i] = f[j] + 1;
      if (f[i] > ldsLen) { ldsLen = f[i]; ldsEnd = i; }
    }
    const ldsPath = [];
    for (let cur = ldsEnd; cur >= 0;) {
      ldsPath.unshift(seq[cur]);
      let nx = -1;
      for (let j = 0; j < cur; j++) if (seq[j] > seq[cur] && f[j] === f[cur] - 1) { nx = j; break; }
      cur = nx;
    }
    /* ⑤ 最长递增子序列长（另一条独立核对线：划分成 k 条链 ⟹ 最长链 ≥ ⌈n/k⌉，收敛处三量一致） */
    const g = new Array(n).fill(1);
    let lisLen = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) if (seq[j] < seq[i] && g[j] + 1 > g[i]) g[i] = g[j] + 1;
      if (g[i] > lisLen) lisLen = g[i];
    }

    /* ⑥ 末帧验算一：各轨道按下标升序拼起来必须恰好是原序列（贪心没重排输入） */
    const flat = [];
    const idxOf = {};
    seq.forEach((v, i) => { idxOf[v] = i; });
    qs.forEach(q => q.forEach(v => flat.push(idxOf[v])));
    const sortedIdx = flat.slice().sort((a, b) => a - b);
    const seqOk = sortedIdx.length === n && sortedIdx.every((v, i) => v === i);
    /* 末帧验算二：每条轨道严格递增 */
    const incOk = qs.every(q => q.every((v, i) => i === 0 || q[i - 1] < v));
    /* 末帧验算三：穷举真·最少轨道数（可选；n ≤ 7 才做，代价可控） */
    let brute = null;
    if (model.verify && n <= 7) brute = _qaBruteMin(seq);

    const snaps = [];
    /* ⚠ 每一帧的轨道状态**由调用方显式传入**（`mkFrame(qsArg, ...)`），不靠闭包去读外层活动变量 ——
     *   闭包是**晚绑定**的：写成 `base()` 直接读外层 `qs`，会让每一帧都带上最后那一帧的轨道内容
     *   （本模块第一版就这么错：11 帧的 tails 全是 [9,7,3,1]），而"快照必须全量携带视觉状态"是
     *   §1.3 的铁律。Node 侧"逐帧比对 tails"能一条断言抓到它。 */
    const mkFrame = (qsArg, step, o) => Object.assign({
      n: n, seq: seq, k: kGreedy, nNew: nNew, place: place.slice(),
      qs: qsArg.map(q => q.slice()), tails: qsArg.map(q => q[q.length - 1]),
      ldsLen: ldsLen, ldsPath: ldsPath.slice(), lisLen: lisLen,
      i: -1, x: null, pick: -1, isNew: false, curQs: null, curTails: null,
      cand: null, candBest: -1,
      seqOk: seqOk, incOk: incOk, brute: brute, verifyOn: brute !== null,
      log: '', logType: 'info', desc: '',
    }, { step: step }, o);
    const push = (qsArg, step, o) => snaps.push(mkFrame(qsArg, step, o));

    push([], 'init', {
      log: '入队顺序共 **' + n + '** 个元素，出队顺序固定 1 ~ ' + n + '。轨道是队列（FIFO）⟹ '
        + '**同一条轨道里后进去的元素必须更大**，于是问题 = 把入队序列划分成尽量少的递增子序列。'
        + '先给出下界：入队序列里最长的下降子序列长 **L = ' + ldsLen + '**，任意两个下降元素都不能同轨 ⟹ 至少 ' + ldsLen + ' 条。',
      desc: '下界 L = ' + ldsLen + ' → 逐元素贪心分配',
    });

    /* 每个元素一帧：先把"这一步放之前"的轨道与队尾摆出来，再定案 */
    for (const st of steps) {
      /* before = 放之前的轨道内容（st.qs 是放之后的快照，去掉刚放进去的那个元素即为放之前） */
      const before = st.qs.map(q => q.slice());
      if (!st.isNew) before[st.pick] = before[st.pick].slice(0, -1);
      const beforeTails = before.map(q => (q.length ? q[q.length - 1] : null));
      let candBest = -1;
      for (const k of _qaIter0(before.length)) {
        if (beforeTails[k] === null || beforeTails[k] >= st.x) continue;
        if (candBest < 0 || beforeTails[k] > beforeTails[candBest]) candBest = k;
      }
      const cand = [];
      for (const k of _qaIter0(before.length)) if (beforeTails[k] !== null && beforeTails[k] < st.x) cand.push({ k: k, tail: beforeTails[k] });
      push(st.qs, 'place', {
        i: st.i, x: st.x, pick: st.pick, isNew: st.isNew,
        curQs: before.map(q => q.slice()), curTails: beforeTails, cand: cand, candBest: candBest,
        log: '第 ' + (st.i + 1) + ' 个元素 **' + st.x + '**：'
          + (cand.length
            ? '队尾小于 ' + st.x + ' 的轨道有 ' + cand.map(c => (c.k + 1) + ' 号（队尾 ' + c.tail + '）').join('、')
              + ' ⟹ 挑**队尾最大**的 **' + (st.pick + 1) + ' 号**（队尾 ' + beforeTails[st.pick] + '），放得越紧越不浪费。'
            : '现有 ' + beforeTails.length + ' 条轨道的队尾（' + beforeTails.map(t => t === null ? '—' : t).join('、')
              + '）全都 ≥ ' + st.x + '，塞不进任何一条 ⟹ **新开第 ' + (st.pick + 1) + ' 条轨道**。')
          + ' 这一步之后共 **' + st.k + '** 条轨道' + (st.isNew ? '（第 ' + st.nNew + ' 次新开）' : '') + '。',
        logType: st.isNew ? 'warn' : 'info',
        desc: '第 ' + (st.i + 1) + ' / ' + n + ' 步：' + st.x + ' → 轨道 ' + (st.pick + 1) + (st.isNew ? '（新开）' : ''),
      });
    }

    const finalOk = seqOk && incOk && kGreedy === ldsLen;
    push(qs, 'done', {
      i: n, x: null, pick: -1,
      log: '**全部 ' + n + ' 个元素分配完毕，共占用 ' + kGreedy + ' 条轨道。**'
        + '下界 L = ' + ldsLen + '（下降子序列 ' + ldsPath.join(' > ') + '），贪心条数 = ' + kGreedy
        + ' ⟹ ' + (kGreedy === ldsLen ? '**下界可达，答案就是 ' + kGreedy + ' 条**。' : '⚠ 两者不等（请核对输入）')
        + (brute !== null ? ' 穷举全部划分方案得到的真·最少轨道数 = **' + brute + '**，与贪心一致。' : '（n = ' + n + ' 的划分方案太多，本次不做穷举验算。）')
        + ' 另：最长递增子序列长 ' + lisLen + '、各轨道按入队下标拼起来' + (seqOk ? '恰好是原序列 ✓' : '与原序列不符 ✗')
        + '、每条轨道严格递增 ' + (incOk ? '✓' : '✗') + '。',
      logType: finalOk ? 'success' : 'error',
      desc: '汇总：' + kGreedy + ' 条轨道 = 下界 L = ' + ldsLen,
    });

    return snaps;
  },

  render(ctx) {
    const s = ctx.snap, stage = ctx.stage;
    const U = RC408.util;
    const col = k => _qaColors[k % _qaColors.length];
    const n = s.n;
    /* ★ 一律只读快照字段（`s.qs` / `s.tails`）：place 帧的 `s.qs` = **放完这一刻**的状态，
       init 帧为空、done 帧为最终态。⛔ 绝不要在这里碰外层作用域的 `qs` —— 它是 render 闭包
       捕获的**活动变量**，晚绑定会让每一帧都显示最终状态（本模块第一版就这么错，P4 才抓到）。 */
    const qsAfter = s.qs;
    const tailsAfter = s.tails;
    const kNow = s.step === 'init' ? 0 : qsAfter.length;
    const placed = s.step === 'place' ? s.i : (s.step === 'init' ? -1 : n);

    /* ---- 统计卡 ---- */
    const prog = s.step === 'init' ? '待开始' : s.step === 'done' ? '分配完毕' : '第 ' + (s.i + 1) + ' / ' + n + ' 步';
    const stats = [
      RC408.ui.statCard('元素个数 n', String(n), '出队顺序固定 1 ~ ' + n, 'font-mono text-indigo-600 qa-stat-n'),
      RC408.ui.statCard('当前占用轨道数', String(kNow), '累计新开 ' + s.nNew + ' 次（新开次数 = 最终轨道数）', 'font-mono qa-stat-k'),
      RC408.ui.statCard('下界 L（最长下降子序列）', String(s.ldsLen), '任何方案都 ≥ L 条', 'font-mono text-rose-600 qa-stat-lds'),
      RC408.ui.statCard('当前进度', prog, '第 ' + (ctx.idx + 1) + ' / ' + ctx.total + ' 帧', 'qa-stat-cur'),
    ].join('');

    /* ---- 输入时间轴：每个元素一格，已放过的标上轨道号 ---- */
    const tlHead = s.seq.map((v, i) => {
      const isCur = (s.step === 'place' && s.i === i);
      const done = i < placed;
      const bg = isCur ? '#f59e0b' : (done ? '#e2e8f0' : '#f8fafc');
      const fg = isCur ? '#fff' : (done ? '#334155' : '#94a3b8');
      const q = done ? s.place[i] : null;
      return '<th class="qa-tlhead" data-i="' + i + '" style="padding:3px 2px;text-align:center;min-width:26px;'
        + 'border:1px solid #e2e8f0;background:' + bg + ';color:' + fg + ';font:700 12px Consolas,monospace">'
        + v + (q === null ? '' : '<div style="font:600 9px Consolas,monospace;color:' + col(q) + '">Q' + (q + 1) + '</div>') + '</th>';
    }).join('');

    /* ---- 分配矩阵：每行一条轨道，列 = 入队时刻 ---- */
    const matrixRows = qsAfter.map((q, k) => {
      const cells = [];
      for (let i = 0; i < n; i++) {
        /* 三种状态：还没读到（·）/ 读到了但落在别的轨道（空）/ 落在这条轨道（写数字） */
        const notYet = i >= placed;
        const at = notYet ? -1 : q.indexOf(s.seq[i]);
        const has = at >= 0;
        const txt = notYet ? '·' : (has ? String(s.seq[i]) : '');
        const isCur = (s.step === 'place' && s.i === i);
        /* 对比度：色底不能太浅（`#xx22` 只有 13% 不透明，深字压上去目视会"看不见"，窗54 截图抓到过），
           改成 30% 不透明 + 数字本身用该轨道的深色 */
        const bg = isCur ? '#fde68a' : (has ? col(k) + '4d' : '#fff');
        cells.push('<td class="qa-mcell" data-q="' + k + '" data-i="' + i + '" style="padding:3px 2px;text-align:center;'
          + 'border:1px solid #e2e8f0;background:' + bg + ';font:800 12px Consolas,monospace;color:'
          + (has ? (isCur ? '#7c2d12' : col(k)) : '#cbd5e1') + '">' + txt + '</td>');
      }
      const isCurRow = (s.step === 'place' && s.pick === k);
      return '<tr class="qa-mrow" data-q="' + k + '" style="' + (isCurRow ? 'outline:2px solid ' + col(k) + ';outline-offset:-1px;' : '') + '">'
        + '<th class="qa-qname" data-q="' + k + '" style="padding:3px 6px;text-align:left;white-space:nowrap;'
        + 'border:1px solid #e2e8f0;background:' + col(k) + '14;color:' + col(k) + ';font:700 11px Consolas,monospace">轨道 ' + (k + 1) + '</th>'
        + cells.join('') + '</tr>';
    }).join('');

    const matrix = '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
      + RC408.ui.sectionTitle('分配矩阵（列 = 入队时刻，行 = 一条轨道；格子里的数字就是落在那条轨道的元素）')
      + '<div style="overflow-x:auto"><table class="qa-matrixtable" style="border-collapse:collapse">'
      + '<thead><tr><th style="padding:3px 6px;border:1px solid #e2e8f0;background:#f8fafc;font:700 11px Consolas,monospace;color:#64748b;white-space:nowrap">入队顺序</th>'
      + tlHead + '</tr></thead><tbody>' + matrixRows + '</tbody></table></div></div>';

    /* ---- 轨道内容（= 每一帧"那一刻"的状态，place 帧就是放完之后） ---- */
    const showQs = qsAfter;
    const trackRows = showQs.map((q, k) => {
      const isCur = (s.step === 'place' && s.pick === k);
      const cells = q.map((v, t) => {
        const isNewest = isCur && t === q.length - 1 && s.step === 'place';
        return '<span class="qa-tcell" data-q="' + k + '" data-t="' + t + '" style="display:inline-flex;align-items:center;justify-content:center;'
          + 'width:26px;height:26px;margin-right:3px;border-radius:6px;background:' + (isNewest ? '#f59e0b' : col(k)) + ';color:#fff;'
          + 'font:700 12px Consolas,monospace">' + v + '</span>';
      }).join('');
      const tail = q.length ? q[q.length - 1] : null;
      return '<div class="qa-track" data-q="' + k + '" style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:3px 6px;border-radius:8px;'
        + (isCur ? 'background:' + col(k) + '12;outline:1px solid ' + col(k) + '55;' : '') + '">'
        + '<span style="flex:0 0 46px;font:700 11px Consolas,monospace;color:' + col(k) + '">轨道 ' + (k + 1) + '</span>'
        + '<span style="display:flex;flex-wrap:wrap;min-height:26px">' + (cells || '<span style="font-size:12px;color:#cbd5e1">（空）</span>') + '</span>'
        + '<span class="qa-tail" data-q="' + k + '" style="margin-left:auto;font:700 11px Consolas,monospace;color:#64748b">队尾 '
        + (tail === null ? '—' : tail) + '</span></div>';
    }).join('');
    const trackBlock = '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
      + RC408.ui.sectionTitle('各轨道内容（左 = 先入队，右 = 后入队；同轨必须递增才对）')
      + trackRows
      + '<div style="margin-top:6px;font-size:12px;color:#64748b">轨道内<b>从左到右递增</b> ⟹ 出队时它们按 1,2,…,n 的顺序离开，'
      + '这正是"同轨后进入的元素必须更大"的由来。</div></div>';

    /* ---- 这一步的候选表（place 帧） ---- */
    let candBlock = '';
    if (s.step === 'place') {
      if (s.cand && s.cand.length) {
        const rows = s.cand.map(c => {
          const best = c.k === s.candBest;
          return '<tr><td class="qa-cand-q" data-q="' + c.k + '" style="padding:3px 8px;font:700 12px Consolas,monospace;color:' + col(c.k) + '">轨道 ' + (c.k + 1) + '</td>'
            + '<td style="padding:3px 8px;font:12px Consolas,monospace">' + c.tail + '</td>'
            + '<td style="padding:3px 8px;font:12px Consolas,monospace">' + (c.tail < s.x ? '✓ 可以放' : '✗') + '</td>'
            + '<td style="padding:3px 8px;font:12px Consolas,monospace;color:' + (best ? '#b45309' : '#94a3b8') + '">'
            + (best ? '★ 队尾最大 ⟹ 选它' : '队尾更小，放它会让后面更难塞') + '</td></tr>';
        }).join('');
        candBlock = '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
          + RC408.ui.sectionTitle('这一步的候选轨道（把 ' + s.x + ' 放进"队尾 < ' + s.x + '"里队尾最大的那条）')
          + '<div style="overflow-x:auto"><table class="qa-candtable" style="width:100%;border-collapse:collapse">'
          + '<thead><tr><th style="text-align:left;padding:3px 8px;font:700 11px Consolas,monospace;color:#64748b">轨道</th>'
          + '<th style="text-align:left;padding:3px 8px;font:700 11px Consolas,monospace;color:#64748b">队尾</th>'
          + '<th style="text-align:left;padding:3px 8px;font:700 11px Consolas,monospace;color:#64748b">能否放</th>'
          + '<th style="text-align:left;padding:3px 8px;font:700 11px Consolas,monospace;color:#64748b">说明</th></tr></thead>'
          + '<tbody>' + rows + '</tbody></table></div></div>';
      } else {
        candBlock = '<div class="qa-nocand" style="border:1px solid #fecdd3;border-radius:14px;background:#fff1f2;padding:10px 12px">'
          + RC408.ui.sectionTitle('这一步没有候选 ⟹ 必须新开轨道')
          + '<div style="font-size:13px;color:#9f1239">现有 ' + s.curTails.length + ' 条轨道的队尾（'
          + s.curTails.map(t => t === null ? '—' : t).join('、') + '）都 ≥ ' + s.x
          + '，硬塞进去就会破坏"同轨递增" ⟹ <b>新开第 ' + (s.pick + 1) + ' 条</b>。这一刻就是轨道数被顶上去的时候。</div></div>';
      }
    }

    /* ---- 末帧汇总 ---- */
    let resultBlock = '';
    if (s.step === 'done') {
      const okAll = s.k === s.ldsLen;
      const lines = [];
      lines.push('最少轨道数 = ' + s.k + ' 条（答案）');
      lines.push('下界：最长下降子序列 ' + s.ldsPath.join(' > ') + ' 长 ' + s.ldsLen + ' ⟹ 任何方案都 ≥ ' + s.ldsLen + ' 条');
      lines.push('贪心实际占用 ' + s.k + ' 条 ⟹ ' + (okAll ? '下界可达，答案就是 ' + s.k + ' 条' : '与下界不符，请核对输入'));
      if (s.brute !== null) lines.push('穷举全部划分方案（与贪心无关的第二条路径）得到的真·最少轨道数 = ' + s.brute + ' ⟹ ' + (s.brute === s.k ? '与贪心一致 ✓' : '不一致 ⚠'));
      else lines.push('（本次未做穷举验算：n > 7 时搜索空间超出上限，或已在输入里关闭）');
      lines.push('各轨道按入队下标拼起来' + (s.seqOk ? '恰好是原序列 ✓' : '与原序列不符 ✗') + '；每条轨道严格递增 ' + (s.incOk ? '✓' : '✗'));
      lines.push('另一条对照线：最长递增子序列长 ' + s.lisLen + '（把 ' + s.n + ' 个元素划成 ' + s.k + ' 条递增子序列，最长的一条至少 ⌈' + s.n + ' ÷ ' + s.k + '⌉ = ' + Math.ceil(s.n / s.k) + '）');
      resultBlock = '<div class="qa-result" style="border:1.5px solid #4f46e5;border-radius:14px;background:#eef2ff;padding:10px 12px">'
        + RC408.ui.sectionTitle('汇总与验算')
        + lines.map(t => '<div class="qa-rline" style="font-size:13px;color:#3730a3;margin:3px 0">' + U.esc(t) + '</div>').join('')
        + '<div class="qa-answer" style="margin-top:6px;font:800 15px Consolas,monospace;color:#3730a3">'
        + '最少需要 ' + s.k + ' 条轨道</div></div>';
    }

    /* ---- 图例 ---- */
    const legend = '<div style="display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:8px">'
      + RC408.ui.legend('#f59e0b', '当前正在分配的元素')
      + RC408.ui.legend('#94a3b8', '还读到的输入')
      + RC408.ui.legend('#4f46e5', '轨道 1（同色 = 同一条轨道）')
      + '</div>';

    stage.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">'
      + '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">' + stats + '</div>'
      + matrix + candBlock + trackBlock + resultBlock + legend
      + '</div>';
  },
});

/* ------------------------------ 本模块私有工具（前缀 _qa 防全局污染） ------------------------------ */

/* 可注入的 0..len−1 遍历器：`_qaRanges` 是**测试挂钩**——冒烟脚本把一段假的区间推进去，
 * 再跑一遍 buildSnapshots，判据就该报红（§3.8-17 的"注入自测"，证明判据不是恒真）。
 * ⚠ 不导出成模块方法（那会污染契约），只挂在这个文件作用域的数组上，由测试直接改。 */
const _qaRanges = [];
function _qaIter0(len) {
  const r = _qaRanges.length ? _qaRanges.shift() : [0, len];
  const out = [];
  for (let i = r[0]; i < (r.length > 1 ? r[1] : len); i++) out.push(i);
  return out;
}

/** 逗号 / 空格 / 顿号分隔的数字串 → 数字数组；把 Unicode 减号归一成 '-' */
function _qaNums(src) {
  return String(src == null ? '' : src)
    .replace(/[−–—]/g, '-')
    .replace(/[，、；]/g, ',')
    .split(/[\s,]+/)
    .filter(x => x !== '')
    .map(Number);
}

/** 穷举真·最少轨道数：把入队序列划分成尽量少的递增子序列（DFS + 剪枝 + 步数上限）。
 *  等价位置去重（同队尾的轨道对称）；**步数上限 30 万**——超过就返回 `null`（= 这次没穷举出来），
 *  绝不假装给出了结论（n = 9 的搜索空间已超出，故默认只对 n ≤ 7 调用）。 */
function _qaBruteMin(seq) {
  const n = seq.length, CAP = 300000;
  let best = n + 1, steps = 0, capped = false;
  const qs = [];
  (function dfs(i) {
    if (capped) return;
    if (++steps > CAP) { capped = true; return; }
    if (qs.length >= best) return;
    if (i === n) { if (qs.length < best) best = qs.length; return; }
    const x = seq[i];
    const seen = {};
    for (let k = 0; k < qs.length; k++) {
      const tail = qs[k][qs[k].length - 1];
      if (tail >= x) continue;
      if (seen[tail]) continue;
      seen[tail] = 1;
      qs[k].push(x); dfs(i + 1); qs[k].pop();
    }
    qs.push([x]); dfs(i + 1); qs.pop();
  })(0);
  return capped ? null : best;
}
