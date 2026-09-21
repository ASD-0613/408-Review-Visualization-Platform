'use strict';
/* ============================================================================
 * net-http.js —— 【计算机网络】HTTP 请求与持久连接（三种连接的 RTT 计数）
 * ----------------------------------------------------------------------------
 * 数据模型（先钉口径，再写实现 —— 见 handover §3.9 P2）：
 *   · **三个量名字很像，必须分清**（本模块最容易串味的地方）：
 *       ① obj   = 内嵌对象（图像）个数 N —— 用户输入，不是时间；
 *       ② rows  = **RTT 行数** = 总耗时（单位 RTT），本模块的"时间量纲"；
 *       ③ msgs  = 报文条数（每行 1～2 条箭头），**只用于画图，不参与 RTT 计算**。
 *   · **"计时起点"是本题型的隐藏陷阱**，故单列一个输入 clock：
 *       include = 从 TCP 建连开始计时（2024-40 / 2020-40 的问法）
 *       after   = 连接已建立，从"发出第一个请求"开始计时（2011-47(3) 的问法）
 *   · 六条恒等式（冒烟逐帧断言，见 §3.8-12；页面首条 HTML 也算 1 个对象）：
 *       np + include : rows = 2 × (N+1)      每个对象 2 RTT（新建连接 1 + 请求响应 1）
 *       np + after   : rows = 1 + 2 × N      首个 HTML 复用已建连接，之后每个对象仍要 2 RTT
 *       pp + include : rows = 2 + N          建连 1 + 首页 1 + 每个对象 1（连接复用）
 *       pp + after   : rows = 1 + N          首页 1 + 每个对象 1
 *       pl + include : rows = 3              建连 1 + 首页 1 + 全部对象 1（与 N 无关）
 *       pl + after   : rows = 2              首页 1 + 全部对象 1
 *     真题锚点（全部回 考情缓存/ 核定过，见 theory）：2024-40 非持久 1 页 + 7 图 = 16 RTT；
 *     2011-47(3) 持久非流水线 5 图 = 6 RTT（不含建连）；2020-40 HTTP 部分 2 RTT（建连 1 + 请求响应 1）；
 *     2022-40 流水线因**慢开始**窗口增长，官方答案 4 RTT（多出的 1 RTT 来自拥塞窗口，不是 HTTP 开销）。
 *   · 快照**全量携带全部 RTT 行**（含尚未走到的），每行带 done / cur 标记：
 *     版面高度恒定、未发生的行画成浅灰虚线，"全流程一眼看全"，回退/跳帧不会错。
 *   · 无过渡帧（每个 RTT 整行走完），稳定帧 = init / 每个 RTT 后 / done。
 * ========================================================================== */

/* 三种连接方式的静态元信息（RTT 数由算法算，不在这里写死） */
const _HTTP_MODES = [
  { k: 'np', short: '非持久（HTTP/1.0）', t: '非持久连接（HTTP/1.0）', color: '#e11d48',
    rule: '每个对象都要新建一条 TCP 连接：建连 1 RTT + 请求/响应 1 RTT = 2 RTT / 对象',
    why: '服务器要为每个对象新建并关闭连接，负担重、时延大' },
  { k: 'pp', short: '持久·非流水线', t: '持久连接 · 非流水线（HTTP/1.1 默认）', color: '#d97706',
    rule: '连接复用：首页建连 1 RTT + 每个对象 1 RTT（但必须等上一个响应回来才发下一个请求）',
    why: '省掉每个对象的握手，但请求是一个一个串行发的' },
  { k: 'pl', short: '持久·流水线', t: '持久连接 · 流水线', color: '#059669',
    rule: '所有请求一次性连续发出、响应依次回来：总时间与对象个数无关',
    why: '最快：不必等前一个响应就能接着发下一个请求' },
];

/* 六条恒等式（唯一真值来源：buildSnapshots 按它算总 RTT，冒烟也按它断言） */
const _HTTP_RULES = {
  np: { include: N => 2 * (N + 1), after: N => 1 + 2 * N,
    fInclude: N => `2 × (N+1) = 2 × (${N}+1)`, fAfter: N => `1 + 2N = 1 + 2×${N}`, anchor: '2024-40' },
  pp: { include: N => 2 + N, after: N => 1 + N,
    fInclude: N => `2 + N = 2 + ${N}`, fAfter: N => `1 + N = 1 + ${N}`, anchor: '2011-47(3)' },
  pl: { include: () => 3, after: () => 2,
    fInclude: () => `3（与 N 无关）`, fAfter: () => `2（与 N 无关）`, anchor: '2022-40' },
};

RC408.registerModule({
  id: 'net-http',
  mode: 'stepper',
  title: 'HTTP 请求与持久连接（非持久 · 持久 · 流水线的 RTT 计数）',

  theory: `
> **为什么要有它**：HTTP 是 Web 的"请求—响应"协议，它自己不管可靠传输（交给 TCP）——但**"一个页面有 N 个对象时会不会为每个对象都建连接"，直接决定总时延**，这就是持久连接与非持久连接。
> **怎么实现**：非持久（HTTP/1.0）每个对象都新建一条 TCP 连接；持久（1.1 默认）复用连接，其中非流水线要等上一个响应回来才发下一个请求，流水线可以连续发。
> **记住什么**：三种方式的 **RTT 计数**（非持久每对象 2 RTT、持久每对象 1 RTT、流水线全部对象共 1 RTT）+ **计时起点**（含不含建连）。

## 三种连接方式的 RTT 计数（1 个 HTML 首页 + N 个内嵌对象）
| 方式 | 从 TCP 建连开始计时 | 连接已建立、从发请求开始计时 |
| --- | --- | --- |
| **非持久**（HTTP/1.0） | **2(N+1)** | **1 + 2N** |
| **持久·非流水线**（1.1 默认） | **2 + N** | **1 + N** |
| **持久·流水线** | **3** | **2** |

- **"每对象 2 RTT"的来源**：握手占 1 RTT（第三次握手的 ACK 可与请求捎带）+ 请求 / 响应占 1 RTT；
- **持久**省掉的是"每个对象的握手"；**流水线**再省掉"等上一个响应"，于是总时间与对象数无关；
- ⚠ **先看题目"从哪一刻开始计时"**：2024-40 含建连（1 页 + 7 图 = **16 RTT**）；
  2011-47(3) 从"发出请求"起算（5 图 = **6 RTT**）——同一过程、口径不同，差 1 个 RTT；
- ⚠ **2022-40 流水线的官方答案是 4 RTT 而不是 3**：该题额外给了 **TCP 慢开始**条件，
  多出的 1 个 RTT 来自拥塞窗口，不是 HTTP 本身的开销。

## 报文格式与状态码
| 请求行 | 首部行 | 空行 + 实体 |
| --- | --- | --- |
| GET /index.html HTTP/1.1 | Host: www.example.com | GET 一般无实体 |
| （方法 URL 版本） | Connection: keep-alive（1.0 要显式声明） | POST 有实体 |

响应行形如 HTTP/1.1 200 OK；状态码 **2xx 成功 / 3xx 重定向 / 4xx 客户端错 / 5xx 服务器错**；默认端口 **80**、HTTPS **443**。

## 考点提醒（易错点）
1. **计时起点**（含不含建连）是本题型最大陷阱，先圈出题目从哪一刻开始算；
2. **Cookie 的用途辨析**：识别用户、保持会话、购物车、行为跟踪是用途，**"缩短响应时间"不是**（2026-40）；
   Cookie 由**服务器**用 Set-Cookie 下发，浏览器之后在**同域请求**里用 Cookie 首部回送；
3. 数首部行、判请求方法与状态码含义，是选择题的固定小问（2015-40）。

> **真题考情**：**5/18 年（选 4 + 大题 1 小问）**：选 2015-40（报文首部辨析）、2022-40（流水线最少时间）、
> 2024-40（非持久 1 页 + 7 图 = 16 RTT）、2026-40（Cookie 用途）；大 2011-47(3)（持久非流水线 5 图 = 6 RTT）。
`,

  /* ---------------- 输入表单（每项都必须显式给 default，见 §3.8-11） ---------------- */
  inputs: [
    {
      key: 'mode', label: '连接方式', type: 'select', default: 'np',
      options: [
        { v: 'np', t: '① 非持久连接（HTTP/1.0：每对象 2 RTT）' },
        { v: 'pp', t: '② 持久连接 · 非流水线（HTTP/1.1 默认：每对象 1 RTT）' },
        { v: 'pl', t: '③ 持久连接 · 流水线（全部对象共 1 RTT）' },
      ],
      help: '三种方式的 RTT 计数口径不同，切换后对比条会同步高亮',
    },
    {
      key: 'obj', label: '内嵌对象个数 N（图像等，不含 HTML 首页）', type: 'text', default: '7',
      help: '1～20 的整数；HTML 首页本身永远也算 1 个对象',
    },
    {
      key: 'clock', label: '计时起点（真题的隐藏陷阱）', type: 'select', default: 'include',
      options: [
        { v: 'include', t: '从 TCP 建连开始计时（2024-40 / 2020-40 的问法）' },
        { v: 'after', t: '连接已建立，从发出第一个请求开始（2011-47(3) 的问法）' },
      ],
      help: '同一过程换个起点就差 1 个 RTT：建连那次握手算不算进去',
    },
  ],

  /* ---------------- 真题 / 场景预设 ---------------- */
  quickActions: [
    { label: '📄 2024-40：非持久 7 图 → 16 RTT', run(rt) { rt.setInput('mode', 'np'); rt.setInput('obj', '7'); rt.setInput('clock', 'include'); rt.load(); } },
    { label: '📄 2011-47(3)：持久非流水线 5 图 → 6 RTT', run(rt) { rt.setInput('mode', 'pp'); rt.setInput('obj', '5'); rt.setInput('clock', 'after'); rt.load(); } },
    { label: '⚡ 持久流水线：与对象数无关（3 RTT）', run(rt) { rt.setInput('mode', 'pl'); rt.setInput('obj', '7'); rt.setInput('clock', 'include'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const raw = String(vals.obj == null ? '' : vals.obj).trim();
    if (!raw) throw { message: '内嵌对象个数不能为空：请输入 1～20 的整数。' };
    if (!/^[0-9]+$/.test(raw)) throw { message: `内嵌对象个数「${raw}」不合法：只能是整数（不含符号、小数点或空格）。` };
    const obj = parseInt(raw, 10);
    if (obj < 1 || obj > 20) throw { message: `内嵌对象个数 ${obj} 超出范围：本演示限 1～20 个（真题一般 3～10 个）。` };
    const mode = ['np', 'pp', 'pl'].indexOf(vals.mode) >= 0 ? vals.mode : 'np';
    const clock = vals.clock === 'after' ? 'after' : 'include';
    return { mode, obj, clock };
  },

  /* ---------------- ② 纯算法：RTT 行序列 → 快照 ---------------- */
  buildSnapshots(model) {
    const { mode, obj, clock } = model;
    const rule = _HTTP_RULES[mode];
    const total = rule[clock](obj);
    const allR = {
      np: _HTTP_RULES.np[clock](obj),
      pp: _HTTP_RULES.pp[clock](obj),
      pl: _HTTP_RULES.pl[clock](obj),
    };

    const ROWS_ = [];
    const push = (kind, msgs, note) => ROWS_.push({ n: ROWS_.length + 1, kind, msgs, note });

    /* 建连这一 RTT（只有 include 口径才计入；after 口径假定连接已建立）
       注：第三次握手的 ACK 与"下一个 RTT 的请求"捎带发出，故本行只画 SYN 与 SYN+ACK 两条箭头
       —— 每行最多 2 条箭头是**版面硬约束**（窗7 实测：3 条会挤到标签互相压盖）。 */
    if (clock === 'include') {
      push('connect', [
        { dir: 'C2S', label: 'SYN（请求建立 TCP 连接）' },
        { dir: 'S2C', label: 'SYN+ACK（同意）' },
      ], 'TCP 三次握手占 1 个 RTT（第三次握手的 ACK 与下面的请求捎带发出）；这一拍就是"含不含建连"差出来的那个 RTT');
    }

    /* 取回 HTML 首页：include 口径下首页请求另占 1 RTT；after 口径下首页请求就是第 1 拍 */
    push('html', [
      { dir: 'C2S', label: 'ACK + GET index.html（第三次握手捎带请求）' },
      { dir: 'S2C', label: '200 OK：HTML 首页（内含 N 个对象 URL）' },
    ], `取回 HTML 首页占 1 个 RTT；解析首页后才知道还有 ${obj} 个内嵌对象要取`);

    if (mode === 'np') {
      for (let k = 1; k <= obj; k++) {
        push('conn-k', [
          { dir: 'C2S', label: `对象 ${k}：SYN（新建第 ${k + 1} 条连接）` },
          { dir: 'S2C', label: 'SYN+ACK（同意）' },
        ], `对象 ${k}：非持久连接必须重新握手——这是"每对象 2 RTT"里的第 1 个 RTT`);
        push('obj-k', [
          { dir: 'C2S', label: `ACK + GET obj${k}（握手捎带请求）` },
          { dir: 'S2C', label: `200 OK：对象 ${k}（传完即关闭连接）` },
        ], `对象 ${k}：请求/响应占第 2 个 RTT；传完服务器就关闭这条连接`);
      }
    } else if (mode === 'pp') {
      for (let k = 1; k <= obj; k++) {
        push('obj-k', [
          { dir: 'C2S', label: `GET obj${k}（复用同一条连接，须等上一个响应回来）` },
          { dir: 'S2C', label: `200 OK：对象 ${k}` },
        ], `对象 ${k}：连接复用、省掉握手 → 只花 1 个 RTT；但必须等上一个响应到了才发下一个请求`);
      }
    } else {
      push('pl-all', [
        { dir: 'C2S', label: `一次性连发 GET obj1 … obj${obj}（${obj} 个请求不等响应）` },
        { dir: 'S2C', label: `200 OK × ${obj}（依次回来）` },
      ], `流水线：${obj} 个请求在同一 RTT 内连续发出、响应依次回来——总时间与对象数无关`);
    }

    if (ROWS_.length !== total) {
      /* 自检：算法与 RTT 公式必须自洽（口径错了要当场炸，而不是画错图） */
      throw { message: `内部错误：${mode}/${clock} 生成了 ${ROWS_.length} 个 RTT 行，与公式算出的 ${total} 不符` };
    }

    const msgsFull = ROWS_.map(r => ({ ...r, msgs: r.msgs.map(m => ({ ...m })) }));
    const mono = _HTTP_MODES.find(m => m.k === mode);
    const clockText = clock === 'include' ? '从 TCP 建连开始' : '连接已建立（从发第一个请求开始）';
    const formula = clock === 'include' ? rule.fInclude(obj) : rule.fAfter(obj);

    const frame = (step, upto, o) => ({
      step,
      /* done = 已走完的 RTT 行（**不含**当前这一行）；cur = 本帧正在走的那一行（渲染时优先画成流动虚线） */
      rows: msgsFull.map((r, ri) => ({
        ...r, msgs: r.msgs.map(m => ({ ...m })),
        done: step === 'done' ? ri < upto : ri < upto - 1,
        cur: step !== 'done' && ri === upto - 1,
      })),
      upto, totalRTT: total, elapsed: Math.min(upto, total), left: Math.max(0, total - Math.min(upto, total)),
      mode, obj, clock, clockText, modeText: mono.t, modeShort: mono.short, formula, allR,
      model: { mode, obj, clock },
      ...o,
    });

    const snaps = [];
    snaps.push(frame('init', 0, {
      log: `[${mono.short} · ${clockText}] 准备：1 个 HTML 首页 + ${obj} 个内嵌对象，预计 ${total} RTT`,
      logType: 'info',
      desc: `初始：客户端要打开一个含 ${obj} 个内嵌对象的页面。方式「${mono.t}」，计时起点：${clockText}——共计 ${total} 个 RTT（公式 ${formula}）。`,
    }));
    msgsFull.forEach(r => {
      snaps.push(frame('rtt', r.n, {
        log: `[${mono.short}] 第 ${r.n}/${total} 个 RTT：${r.note}`,
        logType: r.n === total ? 'success' : (r.kind === 'connect' ? 'warn' : 'info'),
        desc: `第 ${r.n}/${total} 个 RTT：${r.note}。`,
      }));
    });
    snaps.push(frame('done', total, {
      log: `[${mono.short}] 完成：共 ${total} RTT（公式 ${formula}）`,
      logType: 'success',
      desc: `完成：1 + ${obj} 个对象共 ${total} 个 RTT（公式 ${formula}）。${
        (mode === 'pp' || mode === 'np') && clock === 'after' ? '注意：这里没有把 TCP 建连的那 1 个 RTT 算进来。' : ''}`,
    }));
    return snaps;
  },

  /* ---------------- ③ 纯渲染：只读快照 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const { mode, obj, clock } = s.model;
    const mono = _HTTP_MODES.find(m => m.k === mode);

    /* 版面常量（客户端/服务器两条生命线 + 左侧 RTT 标尺 + 右侧累计柱）
       每行最多 2 条箭头：行高 58 → 两条标签基线间距 ≈ 15px，不会互相压盖（窗7 harness 实测） */
    const W = 900, TOP = 70, ROWH = 58, XC = 250, XS = 700, RULER = 96, BARX = W - 26;
    const H = TOP + 34 + s.rows.length * ROWH + 30;

    /* RTT 行：行带 + 标尺号 + 行内报文箭头（最多 2 条，纵向铺开且互不压盖） */
    const rowHtml = s.rows.map(r => {
      const y0 = TOP + 34 + (r.n - 1) * ROWH;
      const cy = y0 + ROWH / 2;
      const state = r.cur ? 'cur' : r.done ? 'done' : 'future';
      const bg = state === 'cur' ? '#fffbeb' : state === 'done' ? (r.n % 2 ? '#f8fafc' : '#ffffff') : '#fdfdfe';
      const band = `<rect class="http-band" x="${RULER}" y="${y0 + 3}" width="${W - RULER - 44}" height="${ROWH - 6}" rx="7"
        fill="${bg}" stroke="${state === 'cur' ? '#f59e0b' : '#eef2f7'}" stroke-width="${state === 'cur' ? 1.8 : 1}"/>`;
      const num = `<text class="http-ruler" x="${RULER - 10}" y="${cy + 4}" text-anchor="end"
        style="font:800 11px Consolas,monospace" fill="${state === 'future' ? '#cbd5e1' : state === 'cur' ? '#b45309' : '#64748b'}">RTT ${r.n}</text>`;
      const k = r.msgs.length;
      const seg = r.msgs.map((m, i) => {
        const y = y0 + 6 + (ROWH - 12) * (i + 1) / (k + 1) + 4;
        const c2s = m.dir === 'C2S';
        const x1 = c2s ? XC + 26 : XS - 26, x2 = c2s ? XS - 26 : XC + 26;
        const stroke = state === 'future' ? '#e2e8f0' : state === 'cur' ? '#f59e0b' : (c2s ? '#4f46e5' : '#059669');
        const marker = state === 'future' ? '' : ` marker-end="url(#http-arr-${c2s ? 'q' : 'a'})"`;
        const cls = state === 'cur' ? ' class="kedge-checking http-arrow-cur"' : ' class="http-arrow"';
        const fill = state === 'future' ? '#cbd5e1' : state === 'cur' ? '#b45309' : '#475569';
        return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}"
            stroke-width="${state === 'cur' ? 3.6 : state === 'done' ? 2.4 : 2}" ${marker}${cls}/>
          <text class="http-msg-label" x="${(x1 + x2) / 2}" y="${y - 5}" text-anchor="middle"
            style="font:${state === 'cur' ? 800 : 600} 10.5px Consolas,sans-serif" fill="${fill}">${m.label}</text>`;
      }).join('');
      return band + num + seg;
    }).join('');

    /* 右侧"累计 RTT"进度柱 */
    const barTop = TOP + 40, barBot = TOP + 34 + s.rows.length * ROWH, barH = (barBot - barTop) * (s.totalRTT ? s.elapsed / s.totalRTT : 0);
    const cumBar = `
      <rect class="http-cumbar" x="${BARX}" y="${barTop}" width="12" height="${barBot - barTop}" rx="6" fill="#f1f5f9" stroke="#e2e8f0"/>
      <rect class="http-cumfill" x="${BARX}" y="${barBot - barH}" width="12" height="${barH}" rx="6" fill="${mono.color}"/>
      <text class="http-cumtext" x="${BARX + 6}" y="${barBot + 16}" text-anchor="middle" style="font:800 10px Consolas,monospace" fill="#64748b">${s.elapsed}/${s.totalRTT}</text>`;

    /* 三种模式对比条（同一个计时起点下比较，当前模式高亮） */
    const maxR = Math.max(s.allR.np, s.allR.pp, s.allR.pl, 1);
    const cmpRows = _HTTP_MODES.map(m => {
      const rtt = s.allR[m.k];
      const on = m.k === mode;
      const w = Math.max(4, Math.round(rtt / maxR * 100));
      return `<div class="space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="font-bold ${on ? 'text-amber-700' : 'text-slate-500'}">${on ? '▶ ' : ''}${m.short}</span>
          <span class="font-mono font-extrabold ${on ? 'text-amber-700' : 'text-slate-600'}">${rtt} RTT</span>
        </div>
        <div class="h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div class="h-full rounded-full" style="width:${w}%;background:${m.color};opacity:${on ? 1 : 0.45}"></div>
        </div>
      </div>`;
    }).join('');

    /* 真题锚点（数字全部回 考情缓存/ 核定过） */
    const anchors = [
      { t: '2024-40', d: '非持久 1 页 + 7 图 = 16 RTT（2×8）', on: mode === 'np' && clock === 'include' },
      { t: '2011-47(3)', d: '持久非流水线 5 图 = 6 RTT（1+5，不含建连）', on: mode === 'pp' && clock === 'after' },
      { t: '2020-40', d: 'DNS 之后 HTTP 部分 = 2 RTT（建连 1 + 请求响应 1）', on: clock === 'include' && mode === 'pp' && obj === 1 },
      { t: '2022-40', d: '流水线因慢开始窗口增长，官方答案 4 RTT（非 3）', on: mode === 'pl' },
    ];
    const anchorHtml = anchors.map(a => `<div class="flex items-start gap-2 text-[11px] leading-relaxed">
      <span class="chip ${a.on ? 'chip-check' : ''} shrink-0">${a.t}</span>
      <span class="${a.on ? 'text-amber-700 font-semibold' : 'text-slate-500'}">${a.d}</span>
    </div>`).join('');

    const htmlMsgs = s.rows.filter(r => r.done).reduce((a, r) => a + r.msgs.length, 0);
    const totalMsgs = s.rows.reduce((a, r) => a + r.msgs.length, 0);

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
            <defs>
              <marker id="http-arr-q" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#4f46e5"/></marker>
              <marker id="http-arr-a" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#059669"/></marker>
            </defs>
            <rect x="${XC - 92}" y="14" width="184" height="40" rx="10" fill="#eef2ff" stroke="#a5b4fc"/>
            <text x="${XC}" y="40" text-anchor="middle" class="http-host" style="font:800 13px sans-serif" fill="#4338ca">💻 客户端（浏览器）</text>
            <rect x="${XS - 92}" y="14" width="184" height="40" rx="10" fill="#f0fdfa" stroke="#5eead4"/>
            <text x="${XS}" y="40" text-anchor="middle" class="http-host" style="font:800 13px sans-serif" fill="#0f766e">🖥️ Web 服务器</text>
            <line class="http-life" x1="${XC}" y1="${TOP}" x2="${XC}" y2="${H - 14}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>
            <line class="http-life" x1="${XS}" y1="${TOP}" x2="${XS}" y2="${H - 14}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>
            <text class="http-axis" x="8" y="${TOP + 26}" style="font:800 11px sans-serif" fill="#94a3b8">时间轴</text>
            <text class="http-axis" x="8" y="${TOP + 42}" style="font:600 10px sans-serif" fill="#cbd5e1">每格 = 1 RTT</text>
            <text class="http-axis" x="8" y="${TOP + 58}" style="font:600 10px sans-serif" fill="#cbd5e1">≈ 1 个往返</text>
            ${rowHtml}
            ${cumBar}
          </svg>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          ${RC408.ui.statCard('连接方式', `<span class="text-base">${mono.short}</span>`, s.clockText, 'text-indigo-700')}
          ${RC408.ui.statCard('内嵌对象 N', `${obj}`, '不含 HTML 首页', 'text-slate-800')}
          ${RC408.ui.statCard('已用 RTT', `${s.elapsed} / ${s.totalRTT}`, `公式 ${s.formula}`, 'text-amber-700')}
          ${RC408.ui.statCard('已发出报文', `${htmlMsgs} / ${totalMsgs}`, '每格 1～2 条箭头', 'text-slate-600')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5 md:col-span-1">
            ${RC408.ui.sectionTitle('同一计时起点下的三方式对比')}
            ${cmpRows}
            <p class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
              当前起点「${s.clockText}」下 N = ${obj}：非持久 <b>${s.allR.np}</b>、持久非流水线 <b>${s.allR.pp}</b>、流水线 <b>${s.allR.pl}</b> RTT。
            </p>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            ${RC408.ui.sectionTitle(`当前方式：${mono.t}`)}
            <div class="text-xs text-slate-600 leading-relaxed space-y-1.5">
              <div>· <b>计数规则</b>：${mono.rule}</div>
              <div>· <b>特点</b>：${mono.why}</div>
              <div>· <b>套路</b>：先数"1 个 HTML + N 个对象"共 ${obj + 1} 个资源，再按模式套公式——<b>别漏掉首页</b>。</div>
            </div>
            <div class="text-[11px] text-slate-500 border-t border-slate-100 pt-2 leading-relaxed">
              <b>Cookie 辨析</b>：用途是保持会话状态 / 购物车 / 个性化 / 用户跟踪；
              <b>"缩短响应时间"不属于</b>。HTTP 默认端口 80，HTTPS 443。
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            ${RC408.ui.sectionTitle('真题锚点（回缓存核定过）')}
            <div class="space-y-1.5">${anchorHtml}</div>
            <p class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
              ⚠ 2022-40 的 4 RTT 是「慢开始」（cwnd 1→2→4 MSS）叠加的结果，不是"流水线本该 3 RTT"的反例：
              把拥塞窗口去掉，理想流水线就是 3 RTT（含建连）。
            </p>
          </div>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>记忆口诀：</b>非持久"<b>每个对象都重新握手</b>"→ 2(N+1)；持久"<b>复用连接但串行</b>"→ 2+N；
          流水线"<b>连发不等</b>"→ 3 RTT（与对象数无关）。再做两步检查：<b>①首页算进去了吗？
          ②题目从"建连"还是"发请求"开始计时？</b>
        </div>
      </div>`;
  },
});
