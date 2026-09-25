'use strict';
/* ============================================================================
 * net-dns.js —— 【计算机网络】DNS 域名解析过程（递归查询 / 迭代查询 / 缓存）
 * ----------------------------------------------------------------------------
 * 数据模型（先钉口径，再写实现 —— 见 handover §3.9 P2）：
 *   · 生命线固定 5 条：H 主机 · L 本地域名服务器 · R 根域名服务器 ·
 *     T 顶级域名服务器 · A 权限域名服务器；x 坐标只由生命线序号决定，不随帧变。
 *   · 报文 msgs = { from, to, kind, label, rec, why }，kind ∈ query | referral | answer；
 *     快照**全量携带全部报文**（含尚未发出的），每条带 done / cur 标记 —— 版面高度恒定，
 *     未发生的报文画成浅灰虚线，"全流程一眼看全"，回退/跳帧也不会错。
 *   · **量纲只有一种：报文（查询）条数**（不是 RTT、不是字节、不是帧数）。两个统计量口径不同，
 *     必须分清（本模块最容易串味的地方，真题也正是这么问的）：
 *       ① hostQueries = 由**主机 H 发出**的查询条数；
 *       ② localQueries = 由**本地域名服务器 L 发出**的查询条数（教材说的"外查次数"）；
 *       ③ sentMsgs = 截至当前帧已发出的报文条数。
 *   · 四个场景与真题一一对应（年份-题号见 theory 与 js/exam-history.js）：
 *       ① iter    递归 + 迭代：host 1 条 / local 3 条 —— 2020-40 的"最长"情形
 *       ② alliter 全部迭代：    host 4 条 / local 0 条 —— 2016-40 的"最多 4 次"
 *       ③ rec     全部递归：    host 1 条 / local 1 条 —— 2010-40"均为 1 条"
 *       ④ cache   本机缓存命中：host 0 条 / local 0 条 —— 2016-40"最少 0 次"、2020-40"最短"
 *   · 无过渡帧（每条报文整条发出），稳定帧 = init / 每次发出后 / done。
 * ========================================================================== */

/* 生命线：id 供报文引用；x 由 render 按序算 */
const _DNS_LINES = [
  { id: 'H', name: '主机', sub: '用户程序', accent: '#4f46e5', bg: '#eef2ff', bd: '#a5b4fc' },
  { id: 'L', name: '本地域名服务器', sub: '默认 DNS 服务器', accent: '#0f766e', bg: '#f0fdfa', bd: '#5eead4' },
  { id: 'R', name: '根域名服务器', sub: '.', accent: '#b45309', bg: '#fffbeb', bd: '#fcd34d' },
  { id: 'T', name: '顶级域名服务器', sub: '.com', accent: '#9d174d', bg: '#fdf2f8', bd: '#f9a8d4' },
  { id: 'A', name: '权限域名服务器', sub: 'example.com', accent: '#065f46', bg: '#ecfdf5', bd: '#6ee7b7' },
];

/* 报文类别 → 颜色 / 图例名 */
const _DNS_KIND = {
  query: { c: '#4f46e5', t: '查询请求' },
  referral: { c: '#d97706', t: '推荐（只告诉你去问谁）' },
  answer: { c: '#059669', t: '应答（给出 IP）' },
};

/* 由域名推"顶级 / 权限"域名与一个示例 IP（RFC 5737 文档专用网段 192.0.2.0/24，不是真实地址） */
function _dnsDerive(domain) {
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  const auth = labels.slice(-2).join('.');
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  const ip = `192.0.2.${(h % 253) + 1}`;
  return { labels, tld, auth, ip };
}

RC408.registerModule({
  id: 'net-dns',
  mode: 'stepper',
  title: 'DNS 域名解析过程（递归查询 · 迭代查询 · 缓存）',

  theory: `
> **为什么要有它**：人记域名、机器用 IP——**把域名翻译成 IP 的分布式数据库**就是 DNS；为了全球可扩展，它把域名空间分层，查询逐级推进。
> **怎么实现**：主机 → 本地域名服务器走**递归**（你替我跑腿）；本地 → 根 / 顶级 / 权限走**迭代**（你只告诉我下一步问谁），逐级拿到最终 IP。
> **记住什么**：递归与迭代的差别 + **"哪一级、发几条查询"**（本考点唯一的题眼）+ UDP 53（查询）/ TCP 53（区域传送）。

## 域名服务器分级（本模块的五条生命线）
| 级别 | 它知道什么 | 被问到时的回答 |
| --- | --- | --- |
| 根域名服务器 | 所有**顶级**域名服务器的地址 | "去问 .com" |
| 顶级域名服务器 | 该顶级域下**权限**域名服务器的地址 | "去问 example.com" |
| 权限域名服务器 | 本域内**每台主机**的 主机名→IP | "www.example.com = x.x.x.x" |
| 本地域名服务器 | 缓存 + 替主机跑腿 | 有缓存直接答，否则替你问 |

## 递归 vs 迭代（唯一题眼）
- **递归查询**：被问者**替你去问**、最后把结果还给你；**迭代查询**：只回"下一步去问谁"，不替你跑腿；
- **教材主线**：主机 → 本地 是**递归**，本地 → 根 / 顶级 / 权限 是**迭代**；
- 四种口径要分清（真题正是这么问的）：**全递归 ⇒ 主机与本地各 1 条**（2010-40）；
  **全迭代 ⇒ 主机自己依次问本地、根、顶级、权限，最多 4 条，缓存命中 0 条**（2016-40）；
  **教材主线 ⇒ 本地外查 3 条**；**主机 / 本地有缓存 ⇒ 0 条**（解析时间最短）。

## 考点提醒（易错点）
1. 问"发了几条"先看清**问的是哪一级**（主机发的 ≠ 本地发的），这是最容易错的地方；
2. 时间叠加题：DNS 查询时延（0～3 或 0～4 个 RTT）**加上** TCP 建连与请求 / 响应的 2 个 RTT（2020-40）；
3. UDP 53 与 TCP 53 的分工：查询用 UDP（报文小、要快），**区域传送用 TCP**（要可靠、数据多）；
4. 拿到 IP 后跨网段访问还要先 **ARP** 求默认网关的 MAC（与 HTTP 合考时别漏这一步）。

> **真题考情**：**3/18 年（全为选择题）**：2010-40（递归时主机与本地**各 1 条**）、2016-40（全迭代时主机
> **最少 0 条 / 最多 4 条**）、2020-40（递归 + 迭代下取回页面的**最短 / 最长时间**）。
`,

  /* ---------------- 输入表单（每项都必须显式给 default，见 §3.8-11） ---------------- */
  inputs: [
    {
      key: 'scene', label: '解析场景', type: 'select', default: 'iter',
      options: [
        { v: 'iter', t: '① 递归 + 迭代（教材主线：主机递归、本地迭代）' },
        { v: 'alliter', t: '② 全部迭代（主机自己一级级问：最多 4 条）' },
        { v: 'rec', t: '③ 全部递归（每级都替下一级跑腿：各 1 条）' },
        { v: 'cache', t: '④ 本机缓存命中（0 条查询，时间最短）' },
      ],
      help: '场景决定"谁替谁跑腿"、也决定"谁发了几条查询"——四道真题分别对应这四个场景',
    },
    {
      key: 'domain', label: '要解析的域名', type: 'text', default: 'www.example.com',
      help: '至少两级标签，如 www.example.com / mail.tsinghua.edu.cn（示例 IP 用 RFC 5737 文档网段）',
    },
  ],

  /* ---------------- 真题 / 场景预设 ---------------- */
  quickActions: [
    { label: '📘 递归 + 迭代（教材主线）', run(rt) { rt.setInput('scene', 'iter'); rt.setInput('domain', 'www.example.com'); rt.load(); } },
    { label: '📄 全部迭代：主机最多问 4 次', run(rt) { rt.setInput('scene', 'alliter'); rt.setInput('domain', 'www.example.com'); rt.load(); } },
    { label: '📄 全部递归：主机与本地各 1 条', run(rt) { rt.setInput('scene', 'rec'); rt.setInput('domain', 'mail.tsinghua.edu.cn'); rt.load(); } },
    { label: '⚡ 本机缓存命中：0 条查询', run(rt) { rt.setInput('scene', 'cache'); rt.setInput('domain', 'mail.tsinghua.edu.cn'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const raw = String(vals.domain == null ? '' : vals.domain).trim().toLowerCase();
    if (!raw) throw { message: '域名不能为空：请输入类似 www.example.com 的域名。' };
    if (raw.length > 64) throw { message: `域名过长（${raw.length} 字符）：本演示限 64 字符以内。` };
    if (raw.indexOf('..') >= 0 || raw[0] === '.' || raw[raw.length - 1] === '.') {
      throw { message: `域名格式不合法：「${raw}」出现了空标签（开头、结尾或连续的点）。` };
    }
    const labels = raw.split('.');
    if (labels.length < 2) {
      throw { message: `域名「${raw}」只有一级：至少要有"主机名 + 顶级域"两级（如 www.example.com）。` };
    }
    for (const lb of labels) {
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(lb)) {
        throw { message: `标签「${lb}」不合法：只能用字母、数字、连字符，且不能以连字符开头或结尾。` };
      }
    }
    const d = _dnsDerive(raw);
    const scene = ['iter', 'alliter', 'rec', 'cache'].indexOf(vals.scene) >= 0 ? vals.scene : 'iter';
    return { domain: raw, scene, labels: d.labels, tld: d.tld, auth: d.auth, ip: d.ip };
  },

  /* ---------------- ② 纯算法：报文序列 → 快照 ---------------- */
  buildSnapshots(model) {
    const { domain, scene, tld, auth, ip } = model;
    const M = (from, to, kind, label, rec, why) => ({ from, to, kind, label, rec, why });

    /* 四个场景的报文序列（每条 = 谁→谁、类别、展示文字、是否递归、这条在说什么） */
    const seq = scene === 'iter' ? [
      M('H', 'L', 'query', `递归查询 ${domain}`, true, '主机只发这一条：请本地服务器替它把结果查回来（递归 = 你负责到底）'),
      M('L', 'R', 'query', `迭代查询 ${domain}`, false, '本地服务器先问根：根只知道顶级域名服务器的地址'),
      M('R', 'L', 'referral', `去问 .${tld} 顶级服务器`, false, '根不替它跑腿，只回"下一步问谁"（这正是迭代的特征）'),
      M('L', 'T', 'query', `迭代查询 ${domain}`, false, '本地服务器再问顶级：顶级只知道权限域名服务器的地址'),
      M('T', 'L', 'referral', `去问 ${auth} 权限服务器`, false, '顶级同样只回"下一步问谁"'),
      M('L', 'A', 'query', `迭代查询 ${domain}`, false, '最后问到权限服务器——它保管本域的主机名→IP 映射'),
      M('A', 'L', 'answer', `${domain} = ${ip}`, false, '权限服务器给出权威答案'),
      M('L', 'H', 'answer', `${domain} = ${ip}`, false, '本地服务器把结果还给主机，并按 TTL 写入缓存'),
    ] : scene === 'alliter' ? [
      M('H', 'L', 'query', `迭代查询 ${domain}`, false, '主机自己问本地域名服务器——本地没有缓存，只回"去问谁"'),
      M('L', 'H', 'referral', '去问根域名服务器', false, '本地服务器只指路（迭代），主机得自己去问根'),
      M('H', 'R', 'query', `迭代查询 ${domain}`, false, '主机问根域名服务器（第 2 条查询）'),
      M('R', 'H', 'referral', `去问 .${tld} 顶级服务器`, false, '根也只回"下一步问谁"'),
      M('H', 'T', 'query', `迭代查询 ${domain}`, false, '主机问顶级域名服务器（第 3 条查询）'),
      M('T', 'H', 'referral', `去问 ${auth} 权限服务器`, false, '顶级还是只回"下一步问谁"'),
      M('H', 'A', 'query', `迭代查询 ${domain}`, false, '主机问权限域名服务器（第 4 条查询——这就是"最多 4 次"）'),
      M('A', 'H', 'answer', `${domain} = ${ip}`, false, '权限服务器把 IP 直接还给主机'),
    ] : scene === 'rec' ? [
      M('H', 'L', 'query', `递归查询 ${domain}`, true, '主机 → 本地：递归，本地必须给最终结果'),
      M('L', 'R', 'query', `递归查询 ${domain}`, true, '本地 → 根：也是递归——根替它去问顶级'),
      M('R', 'T', 'query', `递归查询 ${domain}`, true, '根 → 顶级：继续递归往下问'),
      M('T', 'A', 'query', `递归查询 ${domain}`, true, '顶级 → 权限：一路递归到权限服务器'),
      M('A', 'T', 'answer', `${domain} = ${ip}`, true, '权限服务器把答案还给顶级'),
      M('T', 'R', 'answer', `${domain} = ${ip}`, true, '顶级把答案还给根'),
      M('R', 'L', 'answer', `${domain} = ${ip}`, true, '根把答案还给本地服务器'),
      M('L', 'H', 'answer', `${domain} = ${ip}`, true, '本地服务器把答案还给主机（沿途各级都可缓存）'),
    ] : [];

    const n = seq.length;
    const msgsFull = seq.map((m, i) => ({ ...m, i }));

    /* 三条统计量：口径见文件头注释，**别混用** */
    const hostQueries = seq.filter(m => m.from === 'H' && m.kind === 'query').length;
    const localQueries = seq.filter(m => m.from === 'L' && m.kind === 'query').length;
    const hostMsgs = seq.filter(m => m.from === 'H' || m.to === 'H').length;

    /** 造一帧：upto = 已发出的报文条数（0 = 一条都还没发）
     *  done = 本帧之前就已发出（**不含**当前这条）；cur = 本帧刚发出的那条（渲染成流动虚线） */
    const frame = (step, upto, o) => {
      const msgs = msgsFull.map(m => ({
        ...m,
        done: step === 'done' ? m.i < upto : m.i < upto - 1,
        cur: step !== 'done' && m.i === upto - 1,
      }));
      return {
        step, msgs, upto,
        sentMsgs: msgs.filter(m => m.done || m.cur).length,
        hostQueries, localQueries, hostMsgs, totalMsgs: n,
        cached: scene === 'cache',
        answer: (scene === 'cache') ? ip : (upto >= n && n > 0 ? ip : ''),
        model: { domain, scene, tld, auth, ip, labels: model.labels },
        ...o,
      };
    };

    const sceneName = _dnsSceneName(scene);
    const snaps = [];
    snaps.push(frame('init', 0, {
      log: `[${sceneName}] 准备解析 ${domain}`,
      logType: 'info',
      desc: `初始状态：主机要把 ${domain} 解析成 IP。当前场景「${sceneName}」——先想清楚这一场里"谁"要向"谁"发查询。`,
    }));

    /* ★ 窗24 补：缓存命中场景原来只有 init + done 两帧（界面显示"步骤 0 / 1"，看着像坏了）。
       这里插一帧"先查本机缓存"——报文数仍是 **0 条**（这正是该场景要讲的点），只是把过程讲清楚。 */
    if (scene === 'cache') {
      snaps.push(frame('cache', 0, {
        log: `[${sceneName}] 主机先查**本机缓存**：命中 ${domain} → ${ip}（TTL 未过期）`,
        logType: 'success',
        desc: '本机缓存命中：一条 DNS 查询都不用发——比问本地域名服务器还快。',
      }));
    }

    seq.forEach((m, i) => {
      snaps.push(frame('msg', i + 1, {
        log: `[${sceneName}] 第 ${i + 1}/${n} 条报文 ${m.from}→${m.to}：${m.label}`,
        logType: m.kind === 'answer' ? (i === n - 1 ? 'success' : 'info') : (m.kind === 'referral' ? 'warn' : 'info'),
        desc: `第 ${i + 1}/${n} 条报文（${m.from}→${m.to}）：${m.why}。`,
      }));
    });

    snaps.push(frame('done', n, {
      log: `[${sceneName}] 解析完成：${domain} = ${ip}（主机发出查询 ${hostQueries} 条，本地服务器外查 ${localQueries} 条）`,
      logType: 'success',
      desc: scene === 'cache'
        ? `完成：本机缓存里已有 ${domain} → ${ip} 的记录（未过 TTL），一条 DNS 查询都不用发，这才是"最短时间"。`
        : `完成：${domain} → ${ip}。共 ${n} 条报文，其中主机发出 ${hostQueries} 条查询、本地服务器发出 ${localQueries} 条查询（外查）。`,
    }));
    return snaps;
  },

  /* ---------------- ③ 纯渲染：只读快照 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const { domain, scene, tld, auth } = s.model;

    /* 版面常量（生命线 5 列，间距 180，恒定不变） */
    const W = 900, LX0 = 90, DX = 180, TOP = 64, BOXH = 50, GAP = 58;
    const xOf = id => LX0 + _DNS_LINES.findIndex(l => l.id === id) * DX;
    const H = TOP + BOXH + 26 + Math.max(s.msgs.length, 1) * GAP + 30;

    /* 生命线（顶部卡片 + 竖虚线） */
    const lines = _DNS_LINES.map(l => {
      const cx = xOf(l.id);
      const sub = l.id === 'T' ? '.' + tld : l.id === 'A' ? auth : l.sub;
      const active = s.msgs.some(m => (m.done || m.cur) && (m.from === l.id || m.to === l.id));
      return `
        <rect x="${cx - 82}" y="${TOP}" width="164" height="${BOXH}" rx="10"
          fill="${l.bg}" stroke="${active ? l.accent : l.bd}" stroke-width="${active ? 2.4 : 1.4}"/>
        <text x="${cx}" y="${TOP + 20}" text-anchor="middle" class="dns-line-name" style="font:800 12.5px sans-serif" fill="${l.accent}">${l.name}</text>
        <text x="${cx}" y="${TOP + 36}" text-anchor="middle" class="dns-line-sub" style="font:700 10.5px Consolas,monospace" fill="#64748b">${sub}</text>
        <line class="dns-life" x1="${cx}" y1="${TOP + BOXH + 4}" x2="${cx}" y2="${H - 18}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>`;
    }).join('');

    /* 报文箭头：done 实线 / cur 虚线流动 / 未来浅灰虚线；y 只由报文下标决定（版面恒定） */
    const arrows = s.msgs.map(m => {
      const y = TOP + BOXH + 24 + m.i * GAP + 30;
      const x1 = xOf(m.from), x2 = xOf(m.to);
      const dir = x2 > x1 ? 1 : -1;
      const ax1 = x1 + dir * 12, ax2 = x2 - dir * 16;
      const midx = (ax1 + ax2) / 2;
      const k = _DNS_KIND[m.kind] || _DNS_KIND.query;
      const state = m.cur ? 'cur' : m.done ? 'done' : 'future';
      const stroke = state === 'future' ? '#e2e8f0' : k.c;
      const marker = state === 'future' ? '' : ` marker-end="url(#dns-arr-${m.kind})"`;
      const cls = state === 'cur' ? ' class="kedge-checking dns-arrow-cur"' : ' class="dns-arrow"';
      const txtFill = state === 'future' ? '#cbd5e1' : (state === 'cur' ? '#b45309' : '#475569');
      return `
        <line x1="${ax1}" y1="${y}" x2="${ax2}" y2="${y}" stroke="${stroke}"
          stroke-width="${state === 'cur' ? 4 : state === 'done' ? 2.6 : 2}" ${marker}${cls}/>
        <text x="${midx}" y="${y - 8}" text-anchor="middle" class="dns-msg-label"
          style="font:${state === 'cur' ? 800 : 600} 10.5px Consolas,sans-serif" fill="${txtFill}">${m.label}</text>
        <text x="${x1}" y="${y + 15}" text-anchor="middle" class="dns-msg-tag"
          style="font:700 9px sans-serif" fill="${state === 'future' ? '#e2e8f0' : (m.kind === 'referral' ? '#b45309' : m.rec ? '#4338ca' : '#0f766e')}">${m.kind === 'answer' ? '应答' : m.kind === 'referral' ? '推荐·迭代' : (m.rec ? '查询·递归' : '查询·迭代')}</text>`;
    }).join('');

    /* 本机缓存徽标 + 空场景提示 */
    const cacheY = H - 20;
    const cacheBadge = `
      <rect x="${xOf('H') - 84}" y="${cacheY - 16}" width="168" height="24" rx="12"
        fill="${s.cached ? '#d1fae5' : '#f1f5f9'}" stroke="${s.cached ? '#6ee7b7' : '#e2e8f0'}"/>
      <text x="${xOf('H')}" y="${cacheY}" text-anchor="middle" class="dns-cache"
        style="font:800 10.5px sans-serif" fill="${s.cached ? '#065f46' : '#94a3b8'}">本机缓存：${s.cached ? '✓ 命中（0 条查询）' : '未命中'}</text>`;
    const emptyHint = s.msgs.length === 0 ? `
      <text x="${W / 2}" y="${TOP + BOXH + 60}" text-anchor="middle" class="dns-empty"
        style="font:800 14px sans-serif" fill="#059669">✓ 本机缓存命中：一条 DNS 查询报文都不需要发送</text>
      <text x="${W / 2}" y="${TOP + BOXH + 84}" text-anchor="middle" class="dns-empty"
        style="font:600 11.5px sans-serif" fill="#64748b">域名→IP 的映射就在本机缓存里（未过 TTL）→ 这是"解析时间最短"的情形</text>` : '';

    /* 四个场景对照表：当前场景高亮（数字全部来自真题口径，见 theory 与 exam-history 注释） */
    const cmp = [
      { k: 'iter', t: '递归 + 迭代（教材主线）', host: 1, local: 3, real: '2020-40 最长' },
      { k: 'alliter', t: '全部迭代（主机自己问）', host: 4, local: 0, real: '2016-40 最多' },
      { k: 'rec', t: '全部递归（每级都替跑腿）', host: 1, local: 1, real: '2010-40' },
      { k: 'cache', t: '本机缓存命中', host: 0, local: 0, real: '2016-40 最少' },
    ];
    const cmpRows = cmp.map(r => {
      const on = r.k === scene;
      return `<tr class="${on ? 'bg-amber-50' : ''}">
        <td class="py-1.5 pr-2 font-semibold ${on ? 'text-amber-700' : 'text-slate-600'}">${on ? '▶ ' : ''}${r.t}</td>
        <td class="py-1.5 px-2 text-center font-mono font-extrabold ${on ? 'text-amber-700' : 'text-slate-600'}">${r.host} 条</td>
        <td class="py-1.5 px-2 text-center font-mono font-extrabold ${on ? 'text-amber-700' : 'text-slate-600'}">${r.local} 条</td>
        <td class="py-1.5 pl-2 text-[11px] text-slate-500">${r.real}</td>
      </tr>`;
    }).join('');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
            <defs>
              <marker id="dns-arr-query" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_DNS_KIND.query.c}"/></marker>
              <marker id="dns-arr-referral" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_DNS_KIND.referral.c}"/></marker>
              <marker id="dns-arr-answer" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_DNS_KIND.answer.c}"/></marker>
            </defs>
            ${lines}${arrows}${cacheBadge}${emptyHint}
          </svg>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          ${RC408.ui.statCard('当前场景', `<span class="text-base">${_dnsSceneName(scene)}</span>`, `要解析 ${domain}`, 'text-indigo-700')}
          ${RC408.ui.statCard('主机发出查询', `${s.hostQueries} 条`, '本题最爱问"谁发了几条"', s.hostQueries === 0 ? 'text-emerald-600' : 'text-slate-800')}
          ${RC408.ui.statCard('本地外查（迭代）', `${s.localQueries} 条`, '本地服务器发出的查询', s.localQueries === 3 ? 'text-amber-700' : 'text-slate-800')}
          ${RC408.ui.statCard('解析结果', s.answer ? `<span class="font-mono text-base">${s.answer}</span>` : '解析中…', s.answer ? '（RFC 5737 文档示例地址）' : `目标 ${domain}`, s.answer ? 'text-emerald-700' : 'text-slate-400')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
            ${RC408.ui.sectionTitle('四个场景的"查询条数"对照 —— 问法不同，答案就不同')}
            <table class="w-full text-sm">
              <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100">
                <th class="text-left py-1 pr-2 font-bold">场景</th>
                <th class="py-1 px-2 font-bold">主机发出</th>
                <th class="py-1 px-2 font-bold">本地外查</th>
                <th class="text-left py-1 pl-2 font-bold">对应真题问法</th>
              </tr></thead>
              <tbody>${cmpRows}</tbody>
            </table>
            <p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
              ⚠ <b>别背单一数字</b>：题目问的是"<b>哪一级</b>发出多少条查询"。递归时主机与本地各 1 条；
              全迭代时主机最多 4 条（本地/根/顶级/权限）、缓存命中 0 条；教材主线（主机递归 + 本地迭代）下本地外查 3 条。
            </p>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            ${RC408.ui.sectionTitle('各级"只知道下一级"')}
            <div class="text-xs text-slate-600 space-y-1.5">
              <div class="flex items-center gap-2"><span class="chip chip-hit">根 .</span><span>只知道 <b>.${tld}</b> 顶级服务器的地址</span></div>
              <div class="flex items-center gap-2"><span class="chip chip-hit">顶级 .${tld}</span><span>只知道 <b>${auth}</b> 权限服务器的地址</span></div>
              <div class="flex items-center gap-2"><span class="chip chip-hit">权限 ${auth}</span><span>保管 <b>${domain}</b> 的 主机名→IP</span></div>
            </div>
            <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
              <b>端口</b>：DNS 查询走 <b>UDP 53</b>（报文小、要求快）；区域传送（主辅同步）走 <b>TCP 53</b>。
              各级都有缓存、靠 TTL 过期——<b>命中缓存 = 0 条查询</b>，这就是"最短时间"。
            </div>
          </div>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>记忆口诀：</b>主机递归、本地迭代是主线；<b>递归 = 你负责到底</b>（各 1 条），
          <b>迭代 = 我只指路</b>（主机最多 4 条、本地最多 3 条）；<b>缓存命中 = 0 条</b>。
          算时间题时，DNS 那几拍要再<b>叠加</b> TCP 建连 1 RTT + 请求/响应 1 RTT。
        </div>
      </div>`;
  },
});

/* 场景 id → 中文名（构建与渲染共用，避免两处写死不一致） */
function _dnsSceneName(k) {
  return {
    iter: '递归 + 迭代',
    alliter: '全部迭代',
    rec: '全部递归',
    cache: '本机缓存命中',
  }[k] || k;
}
