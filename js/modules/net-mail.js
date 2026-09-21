'use strict';
/* ============================================================================
 * net-mail.js —— 【计算机网络】电子邮件与 FTP（SMTP 推 / POP3·IMAP 拉 / FTP 双连接）
 * ----------------------------------------------------------------------------
 * 数据模型（先钉口径，再写实现 —— 见 handover §3.9 P2）：
 *   · 两族场景，**生命线条数由场景决定**（不是写死的 5 条）：
 *       mail                4 条：发件人 UA · 发送方邮件服务器 · 接收方邮件服务器 · 收件人 UA
 *       ftp-act / ftp-pasv  2 条：FTP 客户端 · FTP 服务器
 *     x 坐标只由"生命线序号 + 本场景条数"决定，不随帧变。
 *   · 报文 msgs = { from, to, kind, label, tag, why }，kind ∈ push | pull | resp | ctrl | data。
 *     快照**全量携带全部报文**（含尚未发出的），每条带 done / cur 标记 —— 版面高度恒定，
 *     未发生的报文画成浅灰虚线，回退/跳帧也不会错。
 *   · **两条量纲，必须各自自洽**（§3.8-12，本模块最容易串味的地方）：
 *       ① TCP 连接条数 conns —— mail = 3（提交段 / 转发段 / 取信段）；ftp = 2（控制 + 数据）
 *          关系式：smtpConns + recvConns + ctrlConns + dataConns === conns
 *       ② 报文条数 msgs.length
 *          关系式：push + pull + resp + ctrl + data === msgs.length
 *     另有一条**静态**量：端口号（25 / 110 / 143 / 21 / 20 / 协商端口 P），逐个断言取值范围。
 *   · 三个场景与真题一一对应（年份-题号见 theory 与 js/exam-history.js）：
 *       mail     SMTP 采用"推"（用户代理→发送方服务器、以及**两台服务器之间**都是 SMTP）；
 *                POP3 / IMAP 采用"拉"，由**收件人**主动去取
 *       ftp-act  **主动模式**：客户端用 PORT 告知端口，由**服务器**从 20 端口主动发起数据连接
 *       ftp-pasv **被动模式**：客户端用 PASV 请服务器开端口，由**客户端**主动发起数据连接
 *   · 无过渡帧（每条报文整条发出），稳定帧 = init / 每次发出后 / done。
 * ========================================================================== */

/* ---------------- 生命线静态元信息（name 是角色，不是地址；地址由输入派生） ---------------- */
const _ML_LINES = {
  U1: { name: '发件人用户代理', accent: '#4f46e5', bg: '#eef2ff', bd: '#a5b4fc' },
  S1: { name: '发送方邮件服务器', accent: '#0f766e', bg: '#f0fdfa', bd: '#5eead4' },
  S2: { name: '接收方邮件服务器', accent: '#b45309', bg: '#fffbeb', bd: '#fcd34d' },
  U2: { name: '收件人用户代理', accent: '#059669', bg: '#ecfdf5', bd: '#6ee7b7' },
  C: { name: 'FTP 客户端', accent: '#4f46e5', bg: '#eef2ff', bd: '#a5b4fc' },
  S: { name: 'FTP 服务器', accent: '#0f766e', bg: '#f0fdfa', bd: '#5eead4' },
};

/* 报文类别 → 颜色 / 图例名（**推 / 拉 / 控制 / 数据** 就是这个考点的题眼） */
const _ML_KIND = {
  push: { c: '#4f46e5', t: 'SMTP：推' },
  pull: { c: '#059669', t: 'POP3 / IMAP：拉' },
  resp: { c: '#94a3b8', t: '协议应答' },
  ctrl: { c: '#0f766e', t: 'FTP 控制连接（21）' },
  data: { c: '#b45309', t: 'FTP 数据连接（按需建立）' },
};

/* 端口常量（写一次，冒烟逐个断言范围） */
const _ML_PORT = { smtp: 25, pop3: 110, imap: 143, ftpCtrl: 21, ftpDataActive: 20, dynMin: 49152, dynMax: 65535 };

/* 场景元信息：生命线、连接数、端口文案、区间带（数字只在这里写一次） */
const _ML_SCENES = {
  mail: {
    name: '电子邮件（SMTP 推 + POP3/IMAP 拉）',
    short: '电子邮件',
    lines: ['U1', 'S1', 'S2', 'U2'],
    conns: { total: 3, smtp: 2, recv: 1, ctrl: 0, data: 0 },
    portsText: 'SMTP 25（两段）· 收信 110 / 143',
    bands: [
      { from: 0, to: 3, text: 'SMTP 全程 · 推', fill: '#eef2ff', bd: '#c7d2fe', tc: '#4338ca' },
      { from: 4, to: 5, text: '收信 · 拉', fill: '#ecfdf5', bd: '#a7f3d0', tc: '#047857' },
    ],
  },
  'ftp-act': {
    name: 'FTP 主动模式（服务器主动发起数据连接）',
    short: 'FTP 主动模式',
    lines: ['C', 'S'],
    conns: { total: 2, smtp: 0, recv: 0, ctrl: 1, data: 1 },
    portsText: '控制 21（全程）· 数据 20（主动模式）',
    bands: [
      { from: 0, to: 3, text: '控制连接 21 · 全程保持', fill: '#f0fdfa', bd: '#99f6e4', tc: '#0f766e' },
      { from: 4, to: 6, text: '数据连接 20 · 传完即关', fill: '#fffbeb', bd: '#fde68a', tc: '#b45309' },
    ],
  },
  'ftp-pasv': {
    name: 'FTP 被动模式（客户端主动发起数据连接）',
    short: 'FTP 被动模式',
    lines: ['C', 'S'],
    conns: { total: 2, smtp: 0, recv: 0, ctrl: 1, data: 1 },
    portsText: '控制 21（全程）· 数据 协商端口 P',
    bands: [
      { from: 0, to: 4, text: '控制连接 21 · 全程保持', fill: '#f0fdfa', bd: '#99f6e4', tc: '#0f766e' },
      { from: 5, to: 7, text: '数据连接 · 传完即关', fill: '#fffbeb', bd: '#fde68a', tc: '#b45309' },
    ],
  },
};

/* 收信协议元信息（POP3 / IMAP 只差端口与"邮件留在哪"） */
const _ML_RETRIEVE = {
  pop3: { name: 'POP3', port: _ML_PORT.pop3, note: '默认把邮件下载到本机（可设置保留副本）；一条 TCP 连接可收取多封' },
  imap: { name: 'IMAP', port: _ML_PORT.imap, note: '邮件留在服务器上管理，多设备看到的邮箱状态一致' },
};

/* ---------------- 小工具 ---------------- */
function _mlHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
/** 长地址在生命线卡片里显示不下 —— 截断加省略号（卡片宽 164，10.5px 等宽字约 6.3px/字符） */
function _mlClip(s, max) {
  s = String(s == null ? '' : s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
/** 取邮箱的域名部分（parse 已保证格式合法） */
function _mlDomain(addr) {
  const i = addr.lastIndexOf('@');
  return i < 0 ? addr : addr.slice(i + 1);
}
/** 合法的邮箱地址（示例一律用 RFC 2606 保留域 example.com / example.net） */
const _ML_MAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/* ---------------- 报文序列（纯函数：场景 + 模型 → 报文数组） ---------------- */
function _mlMessages(scene, m) {
  const M = (from, to, kind, label, tag, why) => ({ from, to, kind, label, tag, why });
  const rn = m.retrieveName, rp = m.retrievePort, P = m.pasvPort;

  if (scene === 'mail') {
    return [
      M('U1', 'S1', 'push', 'SMTP：投递到我的邮件服务器', 'TCP 25',
        `发件人用户代理把邮件"推"给发送方邮件服务器 ${m.senderServer}——SMTP 是推协议，由发信方主动发起`),
      M('S1', 'U1', 'resp', '250 OK：已接收', 'TCP 25',
        '服务器收下邮件并回 250 码；这一来一回仍属于同一次 SMTP 会话（所以 SMTP 是"推 + 应答"）'),
      M('S1', 'S2', 'push', 'SMTP：服务器之间转发', 'TCP 25',
        `两台邮件服务器之间也用 SMTP，还是"推"——所以"发送路径全程 SMTP"包括这一段（2013-40 的原话）`),
      M('S2', 'S1', 'resp', '250 OK：已投递到收件人邮箱', 'TCP 25',
        '接收方邮件服务器把邮件放进收件人的邮箱；此后邮件就静静躺着，等收件人来取'),
      M('U2', 'S2', 'pull', `${rn}：取信`, `TCP ${rp}`,
        `收件人用户代理主动去"拉"——收信用 ${rn}，不是 SMTP。这就是"推 / 拉"的分界：${m.retrieveNote}`),
      M('S2', 'U2', 'resp', '返回邮件内容', `TCP ${rp}`,
        '服务器把邮箱里的邮件交给收件人用户代理，取信过程结束'),
    ];
  }
  if (scene === 'ftp-act') {
    return [
      M('C', 'S', 'ctrl', '控制连接：建立', 'TCP 21',
        `FTP 客户端主动连服务器的 ${_ML_PORT.ftpCtrl} 端口，建立控制连接——它要在整个会话期间一直保持`),
      M('S', 'C', 'ctrl', '220：服务就绪', 'TCP 21',
        '服务器在控制连接上应答；此后所有命令与应答都走这一条连接'),
      M('C', 'S', 'ctrl', 'USER / PASS：登录', 'TCP 21',
        '用户名与口令也在控制连接上传送（FTP 默认明文）'),
      M('C', 'S', 'ctrl', 'PORT：告知我的数据端口', 'TCP 21',
        '客户端用 PORT 命令告诉服务器"我用哪个端口收数据"——这是主动模式的关键一步'),
      M('S', 'C', 'data', '数据连接：服务器主动发起', `TCP ${_ML_PORT.ftpDataActive}`,
        `收到 PORT 后，由服务器从自己的 ${_ML_PORT.ftpDataActive} 端口主动连客户端的那个端口——主动模式里"主动"的是服务器`),
      M('S', 'C', 'data', '传输文件内容', `TCP ${_ML_PORT.ftpDataActive}`,
        '文件数据走这条新建的数据连接；控制命令仍在 21 端口那条连接上并行传递（控制信息带外传送）'),
      M('S', 'C', 'data', '数据连接：关闭', `TCP ${_ML_PORT.ftpDataActive}`,
        '数据连接按需建立、传完就关；控制连接不受影响，可以接着传下一个文件'),
    ];
  }
  return [
    M('C', 'S', 'ctrl', '控制连接：建立', 'TCP 21',
      `FTP 客户端主动连服务器的 ${_ML_PORT.ftpCtrl} 端口，建立控制连接——整个会话期间一直保持`),
    M('S', 'C', 'ctrl', '220：服务就绪', 'TCP 21',
      '服务器在控制连接上应答；此后所有命令与应答都走这一条连接'),
    M('C', 'S', 'ctrl', 'USER / PASS：登录', 'TCP 21',
      '用户名与口令也在控制连接上传送（FTP 默认明文）'),
    M('C', 'S', 'ctrl', 'PASV：请开一个数据端口', 'TCP 21',
      '客户端用 PASV 命令请服务器"开一个端口等我连"——被动模式的关键一步'),
    M('S', 'C', 'ctrl', `227：数据端口 = ${P}`, 'TCP 21',
      `服务器在控制连接上回一个临时协商出来的端口号（本例 ${P}，落在 49152–65535 动态端口范围内）`),
    M('C', 'S', 'data', '数据连接：客户端主动发起', `TCP ${P}`,
      `客户端主动去连服务器的 ${P} 端口——被动模式里"主动"的是客户端，服务器只是被动等连接`),
    M('S', 'C', 'data', '传输文件内容', `TCP ${P}`,
      '文件数据走这条数据连接；控制命令仍在 21 端口那条连接上并行传递（控制信息带外传送）'),
    M('S', 'C', 'data', '数据连接：关闭', `TCP ${P}`,
      '传完即关；控制连接全程保持，可以接着传下一个文件'),
  ];
}

RC408.registerModule({
  id: 'net-mail',
  mode: 'stepper',
  title: '电子邮件与 FTP（SMTP 推 · POP3/IMAP 拉 · FTP 控制连接与数据连接）',

  theory: `
> **为什么要有它**：电子邮件与文件传输是最早也最常见的应用层服务——它们的**方向（推还是拉）**与**连接结构（一条还是两条）**，是应用层协议辨析题的固定考点。
> **怎么实现**：发信全程 **SMTP 推**（用户代理→发送方服务器、**两台服务器之间也是 SMTP**）；收信由收件人主动 **POP3 / IMAP 拉**；FTP 用**两条 TCP 连接**——控制连接 21 全程保持、数据连接按需建立。
> **记住什么**：**谁主动、走哪条连接、支不支持二进制**；SMTP 只传 7 位 ASCII（二进制附件要先 MIME 编码）。

## 一、"推"和"拉"（本考点唯一的题眼）
| 协议 | 方向 | 谁主动 | 端口 | 说明 |
| --- | --- | --- | --- | --- |
| **SMTP** | **推** | 发信方（用户代理 / 发送方服务器） | **TCP 25** | 只用于发：用户代理→发送方服务器，**两台服务器之间也是它** |
| **POP3** | **拉** | 收件人用户代理 | **TCP 110** | 主动去服务器取信；**一条 TCP 连接可收多封** |
| **IMAP** | **拉** | 收件人用户代理 | **TCP 143** | 邮件留在服务器上管理，多设备状态一致 |

- **"发送路径全程 SMTP"**：三段路径里有**两段**是 SMTP，且**都是推**；**收信一定是拉**——接收方服务器不会主动把邮件推给收件人；
- **SMTP 只支持 7 位 ASCII**：要发二进制附件必须先用 **MIME** 编码（2013-40、2018-40）。

## 二、FTP 的两条连接（与其他应用层协议最大的不同）
| 模式 | 谁主动发起数据连接 | 数据连接端口 |
| --- | --- | --- |
| **主动模式（PORT）** | **服务器**（从自己的 20 端口连回客户端） | 20 |
| **被动模式（PASV）** | **客户端**（连服务器协商出的临时端口） | 协商端口（49152~65535） |

- **控制连接（TCP 21）存在于整个会话期间**（登录、命令、应答都走它）；**数据连接每次传文件才建立、传完立即关闭**；
- **控制信息带外传送**：命令与数据分走两条连接，所以 FTP 的控制不受数据量影响（对比 HTTP 把控制放在首部、与数据同连接传）。

## 考点提醒（易错点）
1. 判断题先问自己两句：**"这一步是发还是收？"**（发 = SMTP 推，收 = POP3 / IMAP 拉）、**"走的是控制连接还是数据连接？"**（只有 FTP 分两条）；
2. 常见错项：把"收件人服务器推给收件人"当 SMTP（2012-40）；把 FTP 数据连接说成"全程保持"（2017-40）；
   说 SMTP 能直接传二进制（2013-40、2018-40）；把"访问 Web 页面"说成会用到 SMTP（2014-40）；
3. 端口别记反：**21 控制、20 数据（主动模式）**；POP3 110、IMAP 143、SMTP 25。

> **真题考情**：**9/18 年（选 8 + 大题 1 小问）**：选 2009-40、2012-40、2013-40、2014-40、2015-33、2017-40、
> 2018-40、2025-40；大 2023-47(1)（FTP 控制连接持久、数据连接非持久；登录 FTP 建的是控制连接）。
`,

  /* ---------------- 输入表单（每项都必须显式给 default，见 §3.8-11） ---------------- */
  inputs: [
    {
      key: 'scene', label: '演示场景', type: 'select', default: 'mail',
      options: [
        { v: 'mail', t: '① 电子邮件：SMTP 推送 + POP3/IMAP 拉取' },
        { v: 'ftp-act', t: '② FTP 主动模式：服务器主动发起数据连接' },
        { v: 'ftp-pasv', t: '③ FTP 被动模式：客户端主动发起数据连接' },
      ],
      help: '场景不同，生命线条数也不同（邮件 4 条 / FTP 2 条）——三种场景恰好覆盖三类真题问法',
    },
    {
      key: 'mailfrom', label: '发件人地址', type: 'text', default: 'alice@example.com',
      help: '形如 alice@example.com；发送方邮件服务器名由它的域名派生（示例用 RFC 2606 保留域）',
    },
    {
      key: 'mailto', label: '收件人地址', type: 'text', default: 'bob@example.net',
      help: '形如 bob@example.net；接收方邮件服务器名由它的域名派生（FTP 场景下也用它派生示例服务器名）',
    },
    {
      key: 'retrieve', label: '收信协议（只影响邮件场景）', type: 'select', default: 'pop3',
      options: [
        { v: 'pop3', t: 'POP3（TCP 110：下载到本机，一条连接可收多封）' },
        { v: 'imap', t: 'IMAP（TCP 143：邮件留在服务器上管理）' },
      ],
      help: '两者都是"拉"，区别在端口与"邮件留在哪"',
    },
  ],

  /* ---------------- 真题 / 场景预设 ---------------- */
  quickActions: [
    { label: '📘 邮件：发送全程 SMTP（推）', run(rt) { rt.setInput('scene', 'mail'); rt.setInput('retrieve', 'pop3'); rt.setInput('mailfrom', 'alice@example.com'); rt.setInput('mailto', 'bob@example.net'); rt.load(); } },
    { label: '📘 邮件：改用 IMAP 收信（拉）', run(rt) { rt.setInput('scene', 'mail'); rt.setInput('retrieve', 'imap'); rt.setInput('mailfrom', 'alice@example.com'); rt.setInput('mailto', 'bob@example.net'); rt.load(); } },
    { label: '📘 FTP 主动模式：21 控制 + 20 数据', run(rt) { rt.setInput('scene', 'ftp-act'); rt.setInput('mailto', 'bob@example.net'); rt.load(); } },
    { label: '📘 FTP 被动模式：数据端口由服务器协商', run(rt) { rt.setInput('scene', 'ftp-pasv'); rt.setInput('mailto', 'bob@example.net'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const scene = String(vals.scene == null ? '' : vals.scene);
    if (!_ML_SCENES[scene]) {
      throw { message: `场景「${scene}」不存在：可选 ① 电子邮件 ② FTP 主动模式 ③ FTP 被动模式。` };
    }
    const raw1 = String(vals.mailfrom == null ? '' : vals.mailfrom).trim().toLowerCase();
    const raw2 = String(vals.mailto == null ? '' : vals.mailto).trim().toLowerCase();
    if (!raw1) throw { message: '发件人地址不能为空：请输入形如 alice@example.com 的地址。' };
    if (!raw2) throw { message: '收件人地址不能为空：请输入形如 bob@example.net 的地址。' };
    if (raw1.length > 64) throw { message: `发件人地址过长（${raw1.length} 字符）：本演示限 64 字符以内。` };
    if (raw2.length > 64) throw { message: `收件人地址过长（${raw2.length} 字符）：本演示限 64 字符以内。` };
    if (!_ML_MAIL_RE.test(raw1)) {
      throw { message: `发件人地址「${raw1}」格式不合法：需要"用户名@域名.顶级域"，且只能用字母、数字、点、下划线、百分号、加号、连字符。` };
    }
    if (!_ML_MAIL_RE.test(raw2)) {
      throw { message: `收件人地址「${raw2}」格式不合法：需要"用户名@域名.顶级域"，且只能用字母、数字、点、下划线、百分号、加号、连字符。` };
    }
    const rk = _ML_RETRIEVE[vals.retrieve] ? vals.retrieve : 'pop3';
    const R = _ML_RETRIEVE[rk];
    const senderDomain = _mlDomain(raw1);
    const receiverDomain = _mlDomain(raw2);
    /* 派生量一律现算，别写死（handover §6.5 提醒⑤）；示例服务器名与示例端口都只用于演示 */
    const pasvPort = _ML_PORT.dynMin + (_mlHash(raw2) % (_ML_PORT.dynMax - _ML_PORT.dynMin + 1));
    return {
      scene,
      mailfrom: raw1,
      mailto: raw2,
      retrieve: rk,
      retrieveName: R.name,
      retrievePort: R.port,
      retrieveNote: R.note,
      senderDomain,
      receiverDomain,
      senderServer: 'smtp.' + senderDomain,
      receiverServer: 'smtp.' + receiverDomain,
      retrieveServer: R.name.toLowerCase() + '.' + receiverDomain,
      ftpServer: 'ftp.' + receiverDomain,
      pasvPort,
    };
  },

  /* ---------------- ② 纯算法：报文序列 → 快照 ---------------- */
  buildSnapshots(model) {
    const { scene } = model;
    const meta = _ML_SCENES[scene];
    const C = meta.conns;
    const seq = _mlMessages(scene, model);
    const n = seq.length;
    const msgsFull = seq.map((m, i) => ({ ...m, i }));

    /* 报文类别计数（量纲②）：各栏之和必须等于报文总数 */
    const cnt = { push: 0, pull: 0, resp: 0, ctrl: 0, data: 0 };
    seq.forEach(m => { cnt[m.kind] = (cnt[m.kind] || 0) + 1; });

    /* 生命线卡片上的副标题（地址派生值，超长截断） */
    const subs = {
      U1: _mlClip(model.mailfrom, 22),
      S1: _mlClip(model.senderServer, 22),
      S2: _mlClip(model.receiverServer, 22),
      U2: _mlClip(model.mailto, 22),
      C: '用户端',
      S: _mlClip(model.ftpServer, 22),
    };

    /** 造一帧：upto = 已发出的报文条数（0 = 一条都还没发） */
    const frame = (step, upto, o) => {
      const msgs = msgsFull.map(m => ({
        ...m,
        done: step === 'done' ? m.i < upto : m.i < upto - 1,
        cur: step !== 'done' && m.i === upto - 1,
      }));
      return {
        step, msgs, upto, scene, sceneShort: meta.short, sceneName: meta.name,
        subs, portsText: meta.portsText,
        sentMsgs: msgs.filter(m => m.done || m.cur).length,
        totalMsgs: n,
        cnt: { ...cnt },
        pushMsgs: cnt.push, pullMsgs: cnt.pull, respMsgs: cnt.resp, ctrlMsgs: cnt.ctrl, dataMsgs: cnt.data,
        conns: C.total, smtpConns: C.smtp, recvConns: C.recv, ctrlConns: C.ctrl, dataConns: C.data,
        retrieveName: model.retrieveName, retrievePort: model.retrievePort, retrieveNote: model.retrieveNote,
        pasvPort: model.pasvPort, ftpServer: model.ftpServer, senderServer: model.senderServer,
        receiverServer: model.receiverServer, mailfrom: model.mailfrom, mailto: model.mailto,
        model: { ...model },
        ...o,
      };
    };

    const snaps = [];
    snaps.push(frame('init', 0, {
      log: `[${meta.short}] 准备演示：${scene === 'mail' ? `${model.mailfrom} → ${model.mailto}` : `${model.ftpServer} 的文件传输`}`,
      logType: 'info',
      desc: scene === 'mail'
        ? `初始状态：${model.mailfrom} 要给 ${model.mailto} 发一封邮件。先想清楚每一步是"发（推）"还是"收（拉）"。`
        : `初始状态：FTP 客户端要访问 ${model.ftpServer}。注意 FTP 要用两条 TCP 连接，先看它们各自什么时候建立。`,
    }));

    seq.forEach((m, i) => {
      snaps.push(frame('msg', i + 1, {
        log: `[${meta.short}] 第 ${i + 1}/${n} 条：${m.from}→${m.to} ${m.tag}｜${m.label}`,
        logType: m.kind === 'pull' ? 'success' : (m.kind === 'data' ? 'warn' : 'info'),
        desc: `第 ${i + 1}/${n} 条（${m.from}→${m.to}，${m.tag}）：${m.why}`,
      }));
    });

    const keyLine = scene === 'mail'
      ? `SMTP 走了 ${C.smtp} 段（都是推）、收信走 ${C.recv} 段（${model.retrieveName}，拉）`
      : `控制连接 ${C.ctrl} 条（21，全程保持）、数据连接 ${C.data} 条（${scene === 'ftp-act' ? '20，服务器主动发起' : '协商端口，客户端主动发起'}）`;
    snaps.push(frame('done', n, {
      log: `[${meta.short}] 演示完成：TCP 连接 ${C.total} 条｜${keyLine}`,
      logType: 'success',
      desc: scene === 'mail'
        ? `完成：共 ${n} 条报文。发送路径全程 SMTP（用户代理→发送方服务器→接收方服务器，两段都是"推"）；收信用 ${model.retrieveName}（TCP ${model.retrievePort}），由收件人用户代理主动"拉"。整个邮件过程涉及 ${C.total} 条 TCP 连接。`
        : `完成：共 ${n} 条报文。FTP 用 ${C.total} 条 TCP 连接——控制连接（TCP 21）全程保持，数据连接（${scene === 'ftp-act' ? 'TCP 20，由服务器主动发起' : `协商端口 ${model.pasvPort}，由客户端主动发起`}）按需建立、传完即关。`,
    }));
    return snaps;
  },

  /* ---------------- ③ 纯渲染：只读快照 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const meta = _ML_SCENES[s.scene];
    const ids = meta.lines;
    const nl = ids.length;

    /* 版面常量：W=980，左侧 150px 留给"区间带"标签（横排，不竖排 —— §3.3-21③） */
    const W = 980, GUT = 150, BOXW = 164, RIGHT = 40, TOP = 64, BOXH = 50, GAP = 58;
    const BASE = TOP + BOXH + 24 + 30;                       /* 第一行箭头的 y */
    const SPAN = W - GUT - RIGHT - BOXW;                     /* 首尾生命线圆心的跨距 */
    const xOf = id => nl === 1 ? W / 2 : (GUT + BOXW / 2) + ids.indexOf(id) * (SPAN / (nl - 1));
    const rowY = i => BASE + i * GAP;
    const rows = Math.max(s.msgs.length, 1);
    const H = rowY(rows - 1) + 50;

    /* 区间带（背景）+ 横排标签：把"全程 SMTP（推）""控制连接全程保持"这类区间一眼画出来 */
    const bands = meta.bands.filter(b => b.from < s.msgs.length).map(b => {
      const y0 = rowY(b.from) - 20;
      const y1 = rowY(Math.min(b.to, s.msgs.length - 1)) + 20;
      return `
        <rect x="8" y="${y0}" width="${W - 16}" height="${y1 - y0}" rx="10" fill="${b.fill}" stroke="${b.bd}" stroke-width="1.2"/>
        <text class="ml-band-text" x="16" y="${rowY(b.from) - 6}" style="font:800 10px sans-serif" fill="${b.tc}">${b.text}</text>`;
    }).join('');

    /* 生命线：顶部卡片 + 竖虚线 */
    const lines = ids.map(id => {
      const L = _ML_LINES[id];
      const cx = xOf(id);
      const active = s.msgs.some(m => (m.done || m.cur) && (m.from === id || m.to === id));
      return `
        <rect x="${cx - BOXW / 2}" y="${TOP}" width="${BOXW}" height="${BOXH}" rx="10"
          fill="${L.bg}" stroke="${active ? L.accent : L.bd}" stroke-width="${active ? 2.4 : 1.4}"/>
        <text x="${cx}" y="${TOP + 20}" text-anchor="middle" class="ml-line-name" style="font:800 12.5px sans-serif" fill="${L.accent}">${L.name}</text>
        <text x="${cx}" y="${TOP + 36}" text-anchor="middle" class="ml-line-sub" style="font:700 10.5px Consolas,monospace" fill="#64748b">${s.subs[id]}</text>
        <line class="ml-life" x1="${cx}" y1="${TOP + BOXH + 4}" x2="${cx}" y2="${H - 18}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>`;
    }).join('');

    /* 报文箭头：done 实线 / cur 虚线流动 / 未来浅灰虚线；y 只由报文下标决定（版面恒定） */
    const arrows = s.msgs.map(m => {
      const y = rowY(m.i) + 0;
      const x1 = xOf(m.from), x2 = xOf(m.to);
      const dir = x2 > x1 ? 1 : -1;
      const ax1 = x1 + dir * 12, ax2 = x2 - dir * 16;
      const midx = (ax1 + ax2) / 2;
      const k = _ML_KIND[m.kind] || _ML_KIND.push;
      const state = m.cur ? 'cur' : m.done ? 'done' : 'future';
      const stroke = state === 'future' ? '#e2e8f0' : k.c;
      const marker = state === 'future' ? '' : ` marker-end="url(#ml-arr-${m.kind})"`;
      const cls = state === 'cur' ? ' class="kedge-checking ml-arrow-cur"' : ' class="ml-arrow"';
      const txtFill = state === 'future' ? '#cbd5e1' : (state === 'cur' ? '#b45309' : '#475569');
      return `
        <line x1="${ax1}" y1="${y}" x2="${ax2}" y2="${y}" stroke="${stroke}"
          stroke-width="${state === 'cur' ? 4 : state === 'done' ? 2.6 : 2}" ${marker}${cls}/>
        <text x="${midx}" y="${y - 7}" text-anchor="middle" class="ml-msg-label"
          style="font:${state === 'cur' ? 800 : 600} 10.5px Consolas,sans-serif" fill="${txtFill}">${m.label}</text>
        <text x="${ax1 + 6}" y="${y + 14}" class="ml-msg-tag"
          style="font:700 9px sans-serif" fill="${state === 'future' ? '#e2e8f0' : (m.kind === 'resp' ? '#94a3b8' : k.c)}">${m.tag}</text>`;
    }).join('');

    /* ------- 统计卡 ------- */
    const card3 = s.scene === 'mail'
      ? RC408.ui.statCard('发送 / 接收', `推 ${s.smtpConns} 段 · 拉 ${s.recvConns} 段`, '发送路径全程 SMTP', 'text-indigo-700')
      : RC408.ui.statCard('连接条数', `控制 ${s.ctrlConns} · 数据 ${s.dataConns}`, 'FTP 天生两条 TCP 连接', 'text-teal-700');

    /* ------- 协议一览表（题眼表）：当前场景相关行高亮 ------- */
    const Hi = s.scene === 'mail' ? ['SMTP', 'POP3', 'IMAP'] : ['FTP 控制', 'FTP 数据'];
    const tableRows = [
      { k: 'SMTP', port: 'TCP 25', who: '发信方（用户代理 / 发送方服务器）', way: '推', note: '只用于发信：用户代理→我的服务器，以及服务器之间' },
      { k: 'POP3', port: 'TCP 110', who: '收件人用户代理', way: '拉', note: '下载到本机；一条 TCP 连接可收取多封' },
      { k: 'IMAP', port: 'TCP 143', who: '收件人用户代理', way: '拉', note: '邮件留在服务器上管理，多设备状态一致' },
      { k: 'FTP 控制', port: 'TCP 21', who: '客户端', way: '—', note: '整个会话期间一直保持' },
      { k: 'FTP 数据', port: 'TCP 20 / 协商端口', who: '服务器（主动）/ 客户端（被动）', way: '—', note: '每次传文件才建立、传完立即关闭' },
    ].map(r => {
      const on = Hi.indexOf(r.k) >= 0;
      return `<tr class="${on ? 'bg-amber-50' : ''}">
        <td class="py-1.5 pr-2 font-bold ${on ? 'text-amber-700' : 'text-slate-600'}">${on ? '▶ ' : ''}${r.k}</td>
        <td class="py-1.5 px-1 font-mono text-[11px] ${on ? 'text-amber-700' : 'text-slate-600'}">${r.port}</td>
        <td class="py-1.5 px-1 text-[11px] text-slate-600">${r.who}</td>
        <td class="py-1.5 px-1 text-center font-extrabold ${r.way === '推' ? 'text-indigo-600' : r.way === '拉' ? 'text-emerald-600' : 'text-slate-400'}">${r.way}</td>
        <td class="py-1.5 pl-1 text-[11px] text-slate-500">${r.note}</td>
      </tr>`;
    }).join('');

    /* ------- 本场景要点 ------- */
    const mailPts = [
      `发送路径全程 SMTP：用户代理 → 发送方服务器（第 1 段）→ 接收方服务器（第 2 段，也是 SMTP），两段都是"推"。`,
      `收信是"拉"：接收方服务器不会主动推给收件人，必须由收件人用户代理主动去取。`,
      `本例收信用 ${s.retrieveName}（TCP ${s.retrievePort}）：${s.retrieveNote}。`,
      `SMTP 只支持 7 位 ASCII，二进制附件要靠 MIME 编码。`,
    ];
    const ftpPts = [
      `FTP 用两条 TCP 连接：控制连接（TCP 21，整个会话期间保持）+ 数据连接（按需建立、传完即关）。`,
      `控制信息带外传送：命令走 21，文件数据走另一条连接——这是 FTP 与 HTTP 最本质的区别。`,
      s.scene === 'ftp-act'
        ? `主动模式（PORT）：客户端用 PORT 告诉服务器自己的数据端口，于是服务器从 20 端口主动连回来。`
        : `被动模式（PASV）：客户端请服务器开一个临时端口（本例 ${s.pasvPort}），由客户端主动连过去——适合客户端在 NAT / 防火墙后的场景。`,
      `易错：数据连接不是全程保持；21 是控制连接、20（或协商端口）才是数据连接。`,
    ];
    const pts = (s.scene === 'mail' ? mailPts : ftpPts)
      .map(t => `<li class="leading-relaxed">${t}</li>`).join('');

    const chipRow = Object.keys(_ML_KIND).map(k => {
      const used = s.msgs.some(m => m.kind === k);
      return `<span class="chip ${used ? 'chip-hit' : 'chip-future'}">${_ML_KIND[k].t}</span>`;
    }).join('');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
            <defs>
              <marker id="ml-arr-push" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_ML_KIND.push.c}"/></marker>
              <marker id="ml-arr-pull" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_ML_KIND.pull.c}"/></marker>
              <marker id="ml-arr-resp" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_ML_KIND.resp.c}"/></marker>
              <marker id="ml-arr-ctrl" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_ML_KIND.ctrl.c}"/></marker>
              <marker id="ml-arr-data" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${_ML_KIND.data.c}"/></marker>
            </defs>
            ${bands}${lines}${arrows}
          </svg>
        </div>

        <div class="flex flex-wrap gap-1.5">${chipRow}</div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          ${RC408.ui.statCard('当前场景', `<span class="text-base">${meta.short}</span>`, s.scene === 'mail' ? `${s.mailfrom} → ${s.mailto}` : s.ftpServer, 'text-indigo-700')}
          ${RC408.ui.statCard('报文进度', `${s.sentMsgs} / ${s.totalMsgs} 条`, '已发出 / 本场景报文总数', s.sentMsgs === s.totalMsgs ? 'text-emerald-600' : 'text-slate-800')}
          ${card3}
          ${RC408.ui.statCard('关键端口', `<span class="text-sm">${s.portsText}</span>`, s.scene === 'mail' ? '发 25 · 收 110/143' : '控制 21 · 数据 20/协商', 'text-slate-700')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
            ${RC408.ui.sectionTitle('协议一览 —— 谁的端口、谁主动、推还是拉')}
            <table class="w-full text-sm">
              <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100">
                <th class="text-left py-1 pr-2 font-bold">协议</th>
                <th class="text-left py-1 px-1 font-bold">端口</th>
                <th class="text-left py-1 px-1 font-bold">谁主动</th>
                <th class="py-1 px-1 font-bold">推/拉</th>
                <th class="text-left py-1 pl-1 font-bold">要点</th>
              </tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            ${RC408.ui.sectionTitle(s.scene === 'mail' ? '邮件：推 / 拉的分界' : 'FTP：两条连接各管什么')}
            <ul class="text-xs text-slate-600 space-y-1.5 list-disc pl-4">${pts}</ul>
            <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
              <b>连接数口径</b>：本场景共 <b>${s.conns}</b> 条 TCP 连接
              ${s.scene === 'mail'
        ? `—— 提交段 1 条（SMTP）+ 转发段 1 条（SMTP）+ 取信段 1 条（${s.retrieveName}）。`
        : '—— 控制连接 1 条 + 数据连接 1 条（数据连接每次传文件重建，但同一时刻只有 1 条）。'}
              报文共 <b>${s.totalMsgs}</b> 条（${s.scene === 'mail' ? `推 ${s.pushMsgs} · 拉 ${s.pullMsgs} · 应答 ${s.respMsgs}` : `控制 ${s.ctrlMsgs} · 数据 ${s.dataMsgs}`}）。
            </div>
          </div>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>记忆口诀：</b>${s.scene === 'mail'
        ? '发信全程 SMTP（<b>推</b>）：用户代理 → 我的服务器 → 对方服务器；收信才用 POP3/IMAP（<b>拉</b>），一定是收件人主动去取。'
        : 'FTP 两条连接：<b>21 管命令</b>（全程保持）、<b>20 或协商端口管数据</b>（传完就关）；主动模式服务器发起、被动模式客户端发起。'}
        </div>
      </div>`;
  },
});
