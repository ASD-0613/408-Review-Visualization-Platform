'use strict';
/* ============================================================================
 * tcp.js —— 【计算机网络】TCP 连接管理：三次握手 / 四次挥手 / 分支场景
 * ----------------------------------------------------------------------------
 * 数据模型（快照必须自包含：render 只读快照，绝不回读 DOM、也不读全局 Runner）：
 *   model = {
 *     scene:     'open' | 'close' | 'reject'  建立 / 释放 / 端口未监听被 RST 拒绝
 *     initiator: 'client' | 'server' | 'both' 释放时谁先发 FIN（both = 同时关闭）
 *     peerData:  'no' | 'yes'                 被动方是否还有数据要发（决定 ACK 与 FIN 能否紧跟着发）
 *     lost:      'no' | 'lastAck'             主动方最后一个 ACK 是否丢失（⟹ 被动方超时重传 FIN）
 *     isnC, isnS: 客户端 / 服务器初始序号（教材标准图：建连与释放阶段不携带数据）
 *   }
 * 时间口径（只在这里定义，render 一律读算好的 clock；闸门 2：先对齐中间量再写断言）：
 *   clock 的单位是 **RTT**：**一个报文段单向传播 = 0.5 RTT**（忽略处理时延与发送时延，
 *   2024-38 与 2026-47 的题干都写明"忽略 TCP 段的传输时延"）。
 *   ⟹ 客户端收到 SYN+ACK 时 clock = 1（= 2024-38 解析"连接建立阶段耗费 1 个 RTT"）
 *      服务器收到第三次握手的 ACK 时 clock = 1.5（= 2022-39 解析"3 次报文段传输，即 1.5RTT"）
 *      主动方收到被动方的 FIN 时 clock = 1（= 2024-38 解析"连接结束阶段 1 个 RTT"）
 *   **2MSL / 超时重传的 RTO / 被动方发数据的用时都不按 RTT 计** ⟹ 在快照里记成 zone（时间轴断裂），
 *   断裂之后走过的跳数在刻度上带 "＋" 前缀（表示"这段等待之后又走了几跳"），
 *   否则会把"等 2MSL"画得像个零头，或者把没建模的数据用时算进 RTT 账里。
 * 帧序不变量：**每一帧要么是"发"、要么是"收"，收帧只认上一条还没落地的、终点是本端的报文段**
 *   （严格因果序 ⟹ 到达用时不会倒挂；冒烟脚本对每条报文段断言 arriveT 单调不减）。
 * 不变量（冒烟脚本逐条断言）：
 *   ① 每帧 msgs 是"截至该帧的完整报文段列表"（深拷贝，回退/跳帧都不出错）；
 *   ② clock = 所有 recv 帧 0.5 的前缀和（发/丢失/超时/等待/收尾帧都不推进 clock）；
 *   ③ 每帧 stateC / stateS 必属于 _TCP_ALL_STATES，且由 trans 顺序推出（同一状态不两处各判一次）；
 *   ④ 序号只由 isnC / isnS 推：确认号恒等于"对方最后一个 seq + 1"（SYN 与 FIN 各占一个序号）。
 * ========================================================================== */

/* TCP 全状态机 11 态：用于"本场景没走到的状态"现算（不写死结论），也用于状态合法性断言 */
const _TCP_ALL_STATES = ['CLOSED', 'LISTEN', 'SYN-SENT', 'SYN-RCVD', 'ESTABLISHED',
  'FIN-WAIT-1', 'FIN-WAIT-2', 'CLOSE-WAIT', 'CLOSING', 'LAST-ACK', 'TIME-WAIT'];

/* 状态名 → 展示色 [底色, 字色]。
   ⚠ 一律用**内联样式**、不用 Tailwind 类：离线（Tailwind 兜底也失效）时类名不生效，
   徽标会退化成没有底色的一串文字、删除线还会连成一条（窗56 经验 1 的同一类用户可见缺陷）。 */
const _TCP_STATE_COLOR = {
  CLOSED: ['#e2e8f0', '#64748b'], LISTEN: ['#e2e8f0', '#64748b'],
  'SYN-SENT': ['#fef3c7', '#b45309'], 'SYN-RCVD': ['#fef3c7', '#b45309'],
  'FIN-WAIT-1': ['#ffedd5', '#c2410c'], 'FIN-WAIT-2': ['#ffedd5', '#c2410c'],
  'CLOSE-WAIT': ['#fef9c3', '#a16207'], 'CLOSING': ['#fae8ff', '#a21caf'],
  'LAST-ACK': ['#ffe4e6', '#be123c'],
  'TIME-WAIT': ['#e0f2fe', '#0369a1'], ESTABLISHED: ['#d1fae5', '#047857'],
};
const _TCP_NEUTRAL = ['#f1f5f9', '#94a3b8'];

/* 状态徽标：底/字色 + 尺寸都由这里给（唯一口径，状态卡与轨迹链共用） */
function _tcpBadgeStyle(state, size) {
  const c = _TCP_STATE_COLOR[state] || _TCP_NEUTRAL;
  const pad = size === 'lg' ? '4px 12px' : '2px 7px';
  const fnt = size === 'lg' ? '800 12px system-ui,sans-serif' : '800 10px system-ui,sans-serif';
  return 'display:inline-block;padding:' + pad + ';border-radius:999px;background:' + c[0] + ';color:' + c[1] + ';font:' + fnt;
}

/* 帧类型 → 中文名（唯一口径：统计卡与图例都用它） */
const _TCP_STEP_NAME = {
  init: '初始状态', send: '发送报文段', recv: '报文段到达', lost: '报文段丢失',
  rto: '超时计时（RTO）', retrans: '超时重传', data: '被动方继续发数据',
  wait: '等待 2MSL', done: '收尾小结',
};

/* 断裂区（长度不按 RTT 计）的样式与文案 */
const _TCP_ZONE_STYLE = {
  wait: { fill: '#e0f2fe', stroke: '#7dd3fc', ink: '#0369a1' },
  rto: { fill: '#fef3c7', stroke: '#fcd34d', ink: '#b45309' },
  data: { fill: '#ecfeff', stroke: '#67e8f9', ink: '#0e7490' },
};

/* 报文段标志位 → 展示文案（seq / ack 在总账里另立成列，别拼进标签） */
function _tcpSegLabel(seg) {
  let s = seg.flags.join(', ');
  if (seg.seq !== null && seg.seq !== undefined) s += ', seq=' + seg.seq;
  if (seg.ack !== null && seg.ack !== undefined) s += ', ack=' + seg.ack;
  return s;
}

/* RTT 数 → 文案 */
function _tcpFmtT(t) {
  if (!t) return '0';
  return (Number.isInteger(t) ? String(t) : t.toFixed(1)) + ' RTT';
}

/* 报文段 kind → 箭头颜色 */
const _TCP_KIND_COLOR = { syn: '#6366f1', ack: '#059669', fin: '#e11d48', rst: '#dc2626' };

/* ---------------------------------------------------------------------------
 * 时间账（每个数字都回 考情缓存/ 核过；改数字前必须重核，依据见下）
 *   · 2022-39（考情缓存/2022_真题.txt:385-392 题干 + 2022_解析.txt:301-307 解析）：
 *     RTT=50ms、MSL=800ms，答案 D = 1650ms / 75ms ⟹ C 进 CLOSED = 1 RTT + 2MSL、S 进 CLOSED = 1.5 RTT。
 *   · 2024-38（考情缓存/2024_真题.txt:511-523 题干 + 2024_解析.txt:345-357 解析）：
 *     RTT=10ms、MSL=30s，"连接建立阶段 1 个 RTT""数据传输阶段 2 个 RTT""连接结束阶段 1 个 RTT"
 *     ⟹ 4*RTT + 2*MSL = 60.04s。
 *   · 2026-47(4)（考情缓存/2026_解析.txt:886-895）：RTT=5ms、"忽略报文段传输时延" ⟹ 15ms = 3 个 RTT。
 *   · 2020-39（考情缓存/2020_解析.txt:381-384）：SYN 序号 1000、FIN 序号 5001 ⟹ 已发应用层数据 4000 字节。
 * ------------------------------------------------------------------------- */
const _TCP_TIME_LEDGER = [
  ['建立连接（客户端视角）', '1 RTT', '收到 SYN+ACK 即认为已建立，第三次握手的 ACK 可捎带数据——2024-38 判"建立阶段 1 个 RTT"'],
  ['建立连接（服务器视角）', '1.5 RTT', '服务器要等到第三次握手的 ACK——2022-39 判"服务器要 3 次报文段传输，即 1.5RTT"'],
  ['释放连接（主动方发 FIN → 进 TIME-WAIT）', '1 RTT', '被动方收到 FIN 后立刻发 FIN——2024-38 判"连接结束阶段 1 个 RTT"'],
  ['释放连接（主动方一路到 CLOSED）', '1 RTT + 2MSL', '2022-39 答案 D：1 RTT + 2MSL = 50 + 800×2 = 1650ms'],
  ['全过程（建连 + 传数据 + 释放）', '2 RTT + 数据用时 + 2MSL', '2024-38：1 + 2 + 1 = 4 RTT，再加 2MSL = 60.04s（RTT=10ms、MSL=30s）'],
];

RC408.registerModule({
  id: 'net-tcp-conn',
  mode: 'stepper',
  title: 'TCP 连接建立与释放（三次握手 · 四次挥手 · 分支场景）',

  theory: `
> **为什么要有它**：TCP 要提供**全双工的可靠传输**，就得先让双方都确认"我发的你能收到、你发的我也能收到"——连接管理（三次握手 / 四次挥手）就是这份双向确认的建立与拆除；而状态机负责兜住"连接迟迟不释放""半开连接白占资源"这类情况。
> **怎么实现**：三次握手 = SYN（seq=x）→ SYN+ACK（seq=y、ack=x+1）→ ACK（ack=y+1）；四次挥手 = 双方**各发一个 FIN、各回一个 ACK**；主动关闭方最后在 **TIME-WAIT 等 2MSL** 才真正关闭。
> **记住什么**：**SYN 与 FIN 各占 1 个序号**，所以确认号总是"对方的序号 + 1"；掐表题**先把时间折成 RTT**——一个报文段单向传播算 0.5 RTT。

## 为什么"三次"够、"四次"不能省

- **两次不行**：若第二次握手后连接就算建立，一个**滞留在网络里的旧 SYN** 到达服务器，服务器会单方面建立连接、白等资源；第三次握手让客户端有机会拒绝它（回 RST）——所以第三次是用来确认**客户端的接收能力**的。
- **四次挥手不能合并**：关闭是**两个方向各自独立**的：一方的 FIN 只表示"我不再发了"，另一方可能还有数据要发，于是它的 ACK 与自己的 FIN 分开发；但**被动方没有数据要发时，也可以把 ACK 与 FIN 紧跟着一起发出**——这正是释放连接**最少只用 1 RTT** 的原因。

## 时间账（掐表题先查这张表）

教材口径：**忽略处理时延与发送时延，一个报文段的单向传播算 0.5 RTT**。

| 阶段 | 最少用时 | 口径与真题依据 |
| --- | --- | --- |
| 建立连接（客户端视角） | 1 RTT | 收到 SYN+ACK 即认为已建立——2024-38 判"建立阶段 1 个 RTT" |
| 建立连接（服务器视角） | 1.5 RTT | 服务器要等到第三次握手的 ACK 才算 ESTABLISHED；⚠ 2022-39 里的 1.5 RTT 是**释放**阶段，别张冠李戴 |
| 释放连接（被动方到 CLOSED） | 1.5 RTT | 2022-39：被动方收 FIN 后立刻回 FIN+ACK，再等对方最后一个 ACK，共 3 次报文段传输 = 1.5 RTT = 75 ms |
| 释放连接（主动方发 FIN 到进 TIME-WAIT） | 1 RTT | 被动方收到 FIN 后立刻发 FIN——2024-38 判"连接结束阶段 1 个 RTT" |
| 释放连接（主动方一路到 CLOSED） | **1 RTT + 2MSL** | 2022-39 答案：1 RTT + 2MSL = 50 + 800×2 = **1650ms** |
| 全过程（建连 + 传数据 + 释放） | 2 RTT + 数据用时 + 2MSL | 2024-38：1 + 2 + 1 = 4 RTT，再加 2MSL = **60.04s** |

⚠ **两个最贵的错法**：① 把释放记成 **2 RTT + 2MSL**（多算一个 RTT，2022-39 会直接错选）；② 漏掉 2MSL 的**系数 2**（算成 1 RTT + MSL = 850ms，那道题的干扰项正是它）。被动方若还有数据要发，多出来的只是**它把数据发完的用时**（题里会另给），并不是补一次握手。

## 序号账：SYN 与 FIN 各占 1 个序号

教材标准图里建连与释放阶段不携带数据，于是序号可以逐条推出来。

| 报文段 | seq | ack |
| --- | --- | --- |
| ① 客户端 SYN | ISN_C | — |
| ② 服务器 SYN+ACK | ISN_S | ISN_C + 1 |
| ③ 客户端 ACK | ISN_C + 1 | ISN_S + 1 |
| ④ 主动关闭方 FIN | ISN_C + 1 | ISN_S + 1 |
| ⑤ 被动关闭方 ACK | ISN_S + 1 | ISN_C + 2 |
| ⑥ 被动关闭方 FIN | ISN_S + 1 | ISN_C + 2 |
| ⑦ 主动关闭方 ACK | ISN_C + 2 | ISN_S + 2 |

**连接上传过的每个数据字节也各占一个序号**，所以给两个序号就能反推数据量：2020-39 给"SYN 的序号 1000、FIN 的序号 5001"，则已发送的应用层数据 = 5001 −（1000 + 1）= **4000 字节**。

## 带数据的序号账（2026-47）

上表是"建连与释放都不携带数据"的特例。一旦在握手里捎带数据，**每个数据字节也各占一个序号**，确认号就要逐段累加：

1. 初始序号 1000，SYN 占 1 个 ⟹ 数据从 **1001** 开始；
2. 上传 2000 B ⟹ 占用 1001 ~ 3000；
3. 服务器 Si 的 **FIN 占 1 个**（3001）⟹ 它的 FIN+ACK 段里 ack_seq = **3002** = 1000 + 1（SYN）+ 2000（数据）+ 1（FIN）；
4. 判据：**ack = 对方 ISN + 对方已发出的 SYN / FIN / 数据字节数**；表里那些 +1、+2 只是"不带数据"时的退化写法；
5. 换个数再练一遍（2023-47）：ISN = 100、上传 18000 B ⟹ 第一个数据字节是 **101**（序号 100 被 SYN 占掉）、最后一个字节 18100；H 的 FIN seq = 18101，**服务器回的 ACK 确认号 = 18102**。

## 窗口与轮次（数据阶段怎么折 RTT）

数据阶段花几个 RTT，取决于**一轮最多能发多少**：

- 发送窗口 **W = min(rwnd, cwnd)**：题里给了接收窗口（2026-47 的 rwnd = 1000 B）就必须取小；
- **慢开始**每 RTT 把 cwnd 翻倍（1 → 2 → 4 MSS），所以每轮能发的字节数逐轮变大——2024-38 的 1000 B 与 2000 B 正好分 **2 轮 = 2 RTT**；
- 轮次 = 数据量 ÷ 每轮窗口；2026-47 的 2000 B 在 1000 B 窗口下是 2 轮，加上 1 RTT 建连 = **3 RTT = 15 ms**；
- ⚠ **先看清题目问到哪一刻**：问到"进入 CLOSED"要加释放的 1 RTT 与 **2MSL**（2024-38 = 4 RTT + 2MSL = 60.04 s）；只问"确定对方已收到文件"就**止于最后一个数据 ACK**，不含挥手、也不含 2MSL（2026-47 = 3 RTT = 15 ms）。

## 总时间与平均发送速率（2023-47）

- 总时间 = **建连 1 RTT + 数据轮次**；轮次按"每轮能发几个 MSS"数：2023-47 的 18 个报文段在 cwnd 1 → 2 → 4 → 5 → 6 的膨胀下分成 **5 轮**，加上建连共 **6 RTT = 60 ms**；
- **平均发送速率 = 应用层数据量 ÷ 总时间**，注意把字节换成比特：18000 B × 8 ÷ 0.06 s = **2.4 Mbps**；
- ⚠ 速率只算**应用层数据**（不含 TCP / IP / 以太网首部），题里给的"文件大小"就是应用层数据量。

## 状态迁移（考状态题先画这条链）

| 角色 | 迁移链 |
| --- | --- |
| 主动打开 | CLOSED → SYN-SENT → ESTABLISHED |
| 被动打开 | CLOSED → LISTEN → SYN-RCVD → ESTABLISHED |
| 主动关闭 | ESTABLISHED → FIN-WAIT-1 → FIN-WAIT-2 → TIME-WAIT →（2MSL）→ CLOSED |
| 被动关闭 | ESTABLISHED → CLOSE-WAIT → LAST-ACK → CLOSED |
| 同时关闭 | ESTABLISHED → FIN-WAIT-1 → CLOSING → TIME-WAIT →（2MSL）→ CLOSED |

## 考点提醒（易错点）

1. **谁先关闭看题目给的时序**，不要默认客户端——本模块的"服务器主动关闭"就是这条的对照；
2. 收到 **RST 会立即回到 CLOSED**：不走四次挥手、不进 TIME-WAIT、也不等 2MSL（例如去连一个没有监听的端口）；RST 属于"连接管理"的收尾分支，历年真题尚未考过；
3. **同时关闭**（双方同时发 FIN）会经过独有的 **CLOSING** 状态，它同样是教材状态机的完整性内容，历年真题尚未考过；
4. 真题里**主动方**发出的那个叫 **FIN 段**（2022-39 的"从 C 主动向 S 发出 FIN 段时刻算起"），**被动方**发出的那个叫 **FIN+ACK 段**（2026-47 的"C 收到的最后一个 TCP 报文段"）——后者同时确认了对方的 FIN，两个段的 seq 都各消耗一个序号。

## TIME-WAIT 等 2MSL 的两个理由

1. 最后一个 ACK 若丢失，对方会**超时重传 FIN**，主动方还在 TIME-WAIT 才能再确认一次，并**重置 2MSL 计时器**；
2. 让本连接的旧报文段在网络中消逝，避免污染下一个使用相同四元组的新连接。

> **真题考情**：**9/18 年（选 6 + 大题 3）**：选 2011-39、2019-39、2020-39、2021-38、2022-39、2024-38；
> 大 2012-47、2023-47、2026-47（2026-47 把建连 + 拥塞 + 挥手 + 总时间一次考完）。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    {
      key: 'scene', label: '演示场景', type: 'select', default: 'open',
      options: [
        { v: 'open', t: '建立连接 —— 三次握手' },
        { v: 'close', t: '释放连接 —— 四次挥手' },
        { v: 'reject', t: '建立失败 —— 端口未监听，回 RST' },
      ],
    },
    {
      key: 'initiator', label: '谁先关闭（仅"释放连接"生效）', type: 'select', default: 'client',
      options: [
        { v: 'client', t: '客户端主动关闭' },
        { v: 'server', t: '服务器主动关闭' },
        { v: 'both', t: '同时关闭 —— 双方同时发 FIN（会经过 CLOSING）' },
      ],
    },
    {
      key: 'peerData', label: '被动方还有数据要发吗（仅"释放连接"）', type: 'select', default: 'no',
      options: [
        { v: 'no', t: '没有 —— ACK 与 FIN 紧跟着发（释放阶段最少 1 RTT）' },
        { v: 'yes', t: '有 —— 先发完数据才发 FIN（多出的是数据用时）' },
      ],
    },
    {
      key: 'lost', label: '主动方的最后一个 ACK 丢失吗（仅"释放连接"、非同时关闭）', type: 'select', default: 'no',
      options: [
        { v: 'no', t: '不丢失' },
        { v: 'lastAck', t: '丢失 —— 看被动方在 LAST-ACK 超时重传 FIN' },
      ],
    },
    { key: 'isnC', label: '客户端初始序号 ISN_C', type: 'text', default: '1000', help: '非负整数；2026-47 用的就是 1000' },
    { key: 'isnS', label: '服务器初始序号 ISN_S', type: 'text', default: '2000', help: '非负整数；2026-47 用的就是 2000' },
  ],

  /* ---------------- 预设场景（每个都能被实测校验：冒烟脚本按场景断言逐条用时） ---------------- */
  quickActions: [
    { label: '🤝 三次握手（正常建立连接）', run(rt) { rt.setInput('scene', 'open'); rt.load(); } },
    { label: '👋 四次挥手（客户端主动关闭，服务器无数据 · 最少 1 RTT + 2MSL）', run(rt) { rt.setInput('scene', 'close'); rt.setInput('initiator', 'client'); rt.setInput('peerData', 'no'); rt.setInput('lost', 'no'); rt.load(); } },
    { label: '⏳ 服务器还要发数据（ACK 与 FIN 分开发 · 多出数据用时）', run(rt) { rt.setInput('scene', 'close'); rt.setInput('initiator', 'client'); rt.setInput('peerData', 'yes'); rt.setInput('lost', 'no'); rt.load(); } },
    { label: '🔄 服务器主动关闭（谁先关闭看题目给的时序）', run(rt) { rt.setInput('scene', 'close'); rt.setInput('initiator', 'server'); rt.setInput('peerData', 'no'); rt.setInput('lost', 'no'); rt.load(); } },
    { label: '🔀 同时关闭（双方同时发 FIN · 经过 CLOSING）', run(rt) { rt.setInput('scene', 'close'); rt.setInput('initiator', 'both'); rt.setInput('lost', 'no'); rt.load(); } },
    { label: '🔁 最后一个 ACK 丢失（服务器 LAST-ACK 超时重传 FIN）', run(rt) { rt.setInput('scene', 'close'); rt.setInput('initiator', 'client'); rt.setInput('peerData', 'no'); rt.setInput('lost', 'lastAck'); rt.load(); } },
    { label: '⛔ 端口未监听（RST 拒绝 · 1 RTT 后回到 CLOSED，不等 2MSL）', run(rt) { rt.setInput('scene', 'reject'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const oneOf = (v, ok, dft) => (ok.indexOf(v) >= 0 ? v : dft);
    const isn = (raw, name, dft) => {
      const s = String(raw === undefined || raw === null ? '' : raw).trim();
      if (s === '') return dft;
      if (!/^[0-9]+$/.test(s)) throw { message: name + ' 只能填非负整数（例如 1000）' };
      const n = Number(s);
      if (!Number.isSafeInteger(n) || n > 4294967290) throw { message: name + ' 超出范围（0 ~ 4294967290）' };
      return n;
    };
    const scene = oneOf(vals.scene, ['open', 'close', 'reject'], 'open');
    const initiator = oneOf(vals.initiator, ['client', 'server', 'both'], 'client');
    /* 归一化：只有"释放连接、且不是同时关闭"才谈得上最后一个 ACK 丢不丢 */
    const lost = (scene === 'close' && initiator !== 'both') ? oneOf(vals.lost, ['no', 'lastAck'], 'no') : 'no';
    return {
      scene,
      initiator,
      peerData: oneOf(vals.peerData, ['no', 'yes'], 'no'),
      lost,
      isnC: isn(vals.isnC, '客户端初始序号', 1000),
      isnS: isn(vals.isnS, '服务器初始序号', 2000),
    };
  },

  /* ---------------- ② 纯算法：事件序列 → 逐报文帧快照 ---------------- */
  buildSnapshots(model) {
    const C = model.isnC, S = model.isnS;
    const cNext = C + 1, sNext = S + 1;          /* SYN 各占一个序号 */
    const ev = [];                               /* 事件序列：每项 = 1 帧，严格"发 → 收"因果序 */

    /* 报文段工厂：seq / ack 一律由 isn 推出，不写死数字 */
    const seg = (from, to, flags, seq, ack, kind, note) => ({
      from, to, flags: flags.slice(), seq: (seq === undefined ? null : seq),
      ack: (ack === undefined ? null : ack), kind, note: note || null,
    });

    if (model.scene === 'open') {
      ev.push({ step: 'init', who: null,
        log: '初始：客户端 CLOSED，服务器创建监听套接字进入 LISTEN，等待连接请求。',
        desc: '服务器监听中，客户端准备发起连接', startC: 'CLOSED', startS: 'LISTEN' });
      ev.push({ step: 'send', who: 'C', newSegs: [seg('C', 'S', ['SYN'], C, null, 'syn')],
        trans: [{ who: 'C', to: 'SYN-SENT', cause: '主动打开：发 SYN' }],
        log: '第一次握手：客户端发送 SYN（seq=' + C + '，SYN 消耗一个序号），进入 SYN-SENT。',
        desc: '① 客户端 → 服务器：请求建立连接' });
      ev.push({ step: 'recv', who: 'S',
        log: 'SYN 到达服务器。服务器这时仍停在 LISTEN —— 要等它把 SYN+ACK 发出去才进 SYN-RCVD。',
        desc: '服务器收到 SYN，准备回送 SYN+ACK' });
      ev.push({ step: 'send', who: 'S', newSegs: [seg('S', 'C', ['SYN', 'ACK'], S, cNext, 'syn')],
        trans: [{ who: 'S', to: 'SYN-RCVD', cause: '发 SYN+ACK' }],
        log: '第二次握手：服务器回送 SYN+ACK（seq=' + S + '、ack=' + cNext + ' —— 确认号 = 客户端 SYN 的序号 + 1），进入 SYN-RCVD。',
        desc: '② 服务器 → 客户端：同意连接并确认' });
      ev.push({ step: 'recv', who: 'C', trans: [{ who: 'C', to: 'ESTABLISHED', cause: '收到 SYN+ACK' }],
        log: 'SYN+ACK 到达客户端，客户端进入 ESTABLISHED：它已确认自己的收发能力都正常。★ 客户端视角 —— 建立连接只用 1 RTT。',
        desc: '☆ 客户端视角：收到 SYN+ACK 即认为连接已建立（1 RTT）' });
      ev.push({ step: 'send', who: 'C', newSegs: [seg('C', 'S', ['ACK'], cNext, sNext, 'ack')],
        log: '第三次握手：客户端发送 ACK（seq=' + cNext + '、ack=' + sNext + '）；这一步可以捎带数据。',
        desc: '③ 客户端 → 服务器：确认（此步可携带数据）' });
      ev.push({ step: 'recv', who: 'S', trans: [{ who: 'S', to: 'ESTABLISHED', cause: '收到第三次握手的 ACK' }],
        log: 'ACK 到达服务器，服务器也进入 ESTABLISHED。★ 服务器视角 —— 它要 1.5 RTT（3 次报文段传输）才认为连接建立。',
        desc: '☆ 服务器视角：1.5 RTT 后才进入 ESTABLISHED' });
      ev.push({ step: 'done', who: 'CS',
        log: '三次握手完成，双方全双工通信。为什么不能两次？防止"已失效的连接请求"突然到达服务器造成资源浪费。',
        desc: '连接建立完成，可以传输数据了' });

    } else if (model.scene === 'reject') {
      ev.push({ step: 'init', who: null,
        log: '初始：客户端 CLOSED，准备去连服务器的某个端口；而该端口**没有监听套接字**。',
        desc: '客户端要连的端口没有人监听', startC: 'CLOSED', startS: 'CLOSED' });
      ev.push({ step: 'send', who: 'C', newSegs: [seg('C', 'S', ['SYN'], C, null, 'syn')],
        trans: [{ who: 'C', to: 'SYN-SENT', cause: '主动打开：发 SYN' }],
        log: '客户端照常发出 SYN（seq=' + C + '）并进入 SYN-SENT —— 它并不知道对方端口没开。',
        desc: '客户端 → 服务器：请求建立连接' });
      ev.push({ step: 'recv', who: 'S',
        log: 'SYN 到达服务器：没有对应的监听套接字，服务器不会为它建连接（所以服务器始终没有离开 CLOSED）。',
        desc: '服务器发现端口未监听，决定回 RST' });
      ev.push({ step: 'send', who: 'S', newSegs: [seg('S', 'C', ['RST', 'ACK'], 0, cNext, 'rst')],
        log: '服务器回 RST 拒绝（RST=1, ACK=1, seq=0、ack=' + cNext + '）：复位报文段用来"立即拆除"，不需要双方协商。',
        desc: '服务器 → 客户端：回 RST，拒绝这次连接' });
      ev.push({ step: 'recv', who: 'C', trans: [{ who: 'C', to: 'CLOSED', cause: '收到 RST' }],
        log: 'RST 到达客户端，客户端立刻回到 CLOSED：不走四次挥手、不进 TIME-WAIT、也不等 2MSL。★ 整个失败过程只用 1 RTT。',
        desc: '☆ 客户端收到 RST 直接回到 CLOSED（1 RTT，不等 2MSL）' });
      ev.push({ step: 'done', who: 'CS',
        log: '连接从未建立成功：服务器一直 CLOSED，客户端因 RST 也回到 CLOSED。RST 是"异常终止"的通用手段。',
        desc: '连接被拒绝，双方都停在 CLOSED' });

    } else {
      /* ---------- 释放连接：A = 主动关闭方，B = 被动关闭方 ---------- */
      const both = model.initiator === 'both';
      const A = both ? null : (model.initiator === 'server' ? 'S' : 'C');
      const B = both ? null : (A === 'C' ? 'S' : 'C');
      const name = (w) => (w === 'C' ? '客户端' : '服务器');
      /* 双方各自的"下一个序号"（假设数据传输阶段已经结束） */
      const aSeq = A === 'C' ? cNext : sNext, bSeq = B === 'C' ? cNext : sNext;

      ev.push({ step: 'init', who: null,
        log: both
          ? '初始：数据传输结束，双方均处于 ESTABLISHED，并且**同时**决定关闭连接。'
          : '初始：数据传输结束，双方均处于 ESTABLISHED。' + name(A) + '决定主动关闭。',
        desc: '双方通信完毕，准备释放连接', startC: 'ESTABLISHED', startS: 'ESTABLISHED' });

      if (both) {
        ev.push({ step: 'send', who: 'CS', newSegs: [
          seg('C', 'S', ['FIN', 'ACK'], cNext, sNext, 'fin'),
          seg('S', 'C', ['FIN', 'ACK'], sNext, cNext, 'fin')],
          trans: [{ who: 'C', to: 'FIN-WAIT-1', cause: '主动关闭：发 FIN' },
            { who: 'S', to: 'FIN-WAIT-1', cause: '主动关闭：发 FIN' }],
          log: '双方同时发出 FIN（各占一个序号）：两端都从 ESTABLISHED 进入 FIN-WAIT-1。',
          desc: '双方同时 → 对方：我也发完了（两个 FIN 同时在路上）' });
        ev.push({ step: 'recv', who: 'CS',
          trans: [{ who: 'C', to: 'CLOSING', cause: '收到对方 FIN，而自己的 FIN 还没被确认' },
            { who: 'S', to: 'CLOSING', cause: '收到对方 FIN，而自己的 FIN 还没被确认' }],
          log: '各自收到对方的 FIN，但**自己的 FIN 还没被确认** —— 于是进入同时关闭独有的 CLOSING 状态（不是 FIN-WAIT-2）。',
          desc: '☆ 自己 FIN 的 ACK 还没到 ⟹ 两端都进 CLOSING' });
        ev.push({ step: 'send', who: 'CS', newSegs: [
          seg('C', 'S', ['ACK'], cNext + 1, sNext + 1, 'ack'),
          seg('S', 'C', ['ACK'], sNext + 1, cNext + 1, 'ack')],
          log: '两端各回一个 ACK，确认对方的 FIN（ack = 对方 FIN 的序号 + 1）。',
          desc: '双方 → 对方：确认你的 FIN' });
        ev.push({ step: 'recv', who: 'CS',
          trans: [{ who: 'C', to: 'TIME-WAIT', cause: '自己的 FIN 被确认' },
            { who: 'S', to: 'TIME-WAIT', cause: '自己的 FIN 被确认' }],
          log: '各自收到对方对自己 FIN 的 ACK，从 CLOSING 进入 TIME-WAIT。★ 两端都要各自等 2MSL。',
          desc: '☆ 两端都进入 TIME-WAIT，各自等 2MSL' });
        ev.push({ step: 'wait', who: 'CS',
          zone: { kind: 'wait', label: '⏳ 两端各等 2MSL', sub: '2MSL 到时才进入 CLOSED' },
          log: 'TIME-WAIT 等 2MSL：① 若最后的 ACK 丢失，对方会重传 FIN，本端还能再确认一次；② 让旧报文段在网络中消逝。',
          desc: '双方各等 2MSL（长度不按 RTT 计）' });
        ev.push({ step: 'done', who: 'CS',
          trans: [{ who: 'C', to: 'CLOSED', cause: '2MSL 到时' }, { who: 'S', to: 'CLOSED', cause: '2MSL 到时' }],
          log: '2MSL 到时，两端都进入 CLOSED。同时关闭比"一方先关"多了一个 CLOSING 状态，报文段总数同样是 4 个。',
          desc: '连接完全释放' });

      } else {
        /* ① 主动方发 FIN */
        ev.push({ step: 'send', who: A, newSegs: [seg(A, B, ['FIN', 'ACK'], aSeq, bSeq, 'fin')],
          trans: [{ who: A, to: 'FIN-WAIT-1', cause: '主动关闭：发 FIN' }],
          log: '第一次挥手：' + name(A) + '发送 FIN（FIN=1, ACK=1, seq=' + aSeq + '、ack=' + bSeq + '），进入 FIN-WAIT-1 —— 停止发送数据，但仍能接收。',
          desc: '① ' + name(A) + ' → ' + name(B) + '：我的数据发完了' });
        /* ② 被动方收到 FIN：进入 CLOSE-WAIT（半关闭） */
        ev.push({ step: 'recv', who: B,
          trans: [{ who: B, to: 'CLOSE-WAIT', cause: '收到对方的 FIN' }],
          log: 'FIN 到达' + name(B) + '，它进入 CLOSE-WAIT：**半关闭** —— ' + name(B) + '仍可以继续发送数据。',
          desc: '☆ ' + name(B) + '进入 CLOSE-WAIT（半关闭：它还能发数据）' });

        if (model.peerData === 'no') {
          /* ②③ 合并：ACK 与 FIN 紧跟着一起发 */
          ev.push({ step: 'send', who: B, newSegs: [seg(B, A, ['FIN', 'ACK'], bSeq, aSeq + 1, 'fin', 'ACK 与 FIN 紧跟着一起发')],
            trans: [{ who: B, to: 'LAST-ACK', cause: '数据已发完：回 ACK 并紧跟着发 FIN' }],
            log: '第二次 + 第三次挥手合并：' + name(B) + '没有数据要发了，于是**紧跟**着回 ACK 并发出自己的 FIN（ack=' + (aSeq + 1) + ' 确认对方的 FIN），进入 LAST-ACK。',
            desc: '② ③ ' + name(B) + ' → ' + name(A) + '：知道了，我也发完了（ACK 与 FIN 紧跟着发）' });
          ev.push({ step: 'recv', who: A,
            trans: [{ who: A, to: 'TIME-WAIT', cause: '收到对方的 ACK+FIN' }],
            log: 'ACK+FIN 到达' + name(A) + '：对方既确认了它的 FIN，也发出了自己的 FIN，于是' + name(A) + '进入 TIME-WAIT。★ 从发出 FIN 到进入 TIME-WAIT 只用 1 RTT。',
            desc: '☆ ' + name(A) + '进入 TIME-WAIT（释放阶段 = 1 RTT）' });
        } else {
          /* 分开发：先 ACK（半关闭真正发生），被动方发完数据再发 FIN */
          ev.push({ step: 'send', who: B, newSegs: [seg(B, A, ['ACK'], bSeq, aSeq + 1, 'ack')],
            log: '第二次挥手：' + name(B) + '先回 ACK（ack=' + (aSeq + 1) + '）确认对方的 FIN，状态仍是 CLOSE-WAIT —— 它还有数据要发。',
            desc: '② ' + name(B) + ' → ' + name(A) + '：知道了（半关闭，' + name(B) + '继续发数据）' });
          ev.push({ step: 'recv', who: A,
            trans: [{ who: A, to: 'FIN-WAIT-2', cause: '收到对方的 ACK' }],
            log: 'ACK 到达' + name(A) + '，它进入 FIN-WAIT-2 —— 这才是真正的半关闭：' + name(A) + '不再发数据，但仍然接收。',
            desc: '☆ ' + name(A) + '进入 FIN-WAIT-2（只收不发）' });
          ev.push({ step: 'data', who: B,
            zone: { kind: 'data', label: '⟿ ' + name(B) + '把剩余数据发完', sub: '这段用时另算，不折算成 RTT 账' },
            log: name(B) + '在 CLOSE-WAIT 里继续把剩余数据发给' + name(A) + '（' + name(A) + '在 FIN-WAIT-2 里正常接收）。**这段用时由数据量决定，题里会另外给**。',
            desc: name(B) + '继续发剩余数据（用时另算）' });
          ev.push({ step: 'send', who: B, newSegs: [seg(B, A, ['FIN', 'ACK'], bSeq, aSeq + 1, 'fin', '先发完剩余数据才发 FIN')],
            trans: [{ who: B, to: 'LAST-ACK', cause: '数据发完后发 FIN' }],
            log: '第三次挥手：' + name(B) + '把剩余数据发完后才发 FIN，进入 LAST-ACK。多出来的时间就是**它发数据的用时**，不是补一次握手。',
            desc: '③ ' + name(B) + ' → ' + name(A) + '：我的数据也发完了' });
          ev.push({ step: 'recv', who: A,
            trans: [{ who: A, to: 'TIME-WAIT', cause: '收到对方的 FIN' }],
            log: 'FIN 到达' + name(A) + '，它从 FIN-WAIT-2 进入 TIME-WAIT。★ 释放阶段的**信号跳数**仍是 1 RTT，多出来的只有上面那段数据用时。',
            desc: '☆ ' + name(A) + '进入 TIME-WAIT，开始等 2MSL' });
        }

        /* ④ 主动方回 ACK（可能是丢失的那一个） */
        ev.push({ step: 'send', who: A, newSegs: [seg(A, B, ['ACK'], aSeq + 1, bSeq + 1, 'ack',
          model.lost === 'lastAck' ? '这个 ACK 会在半路丢失' : null)],
          lostSeg: model.lost === 'lastAck',
          log: '最后一次挥手：' + name(A) + '回 ACK（ack=' + (bSeq + 1) + '）确认对方的 FIN。' +
            (model.lost === 'lastAck' ? '⚠ 这个 ACK 会在半路**丢失**。' : '此时' + name(A) + '在 TIME-WAIT 里开始等 2MSL。'),
          desc: '④ ' + name(A) + ' → ' + name(B) + '：确认' + (model.lost === 'lastAck' ? '（这个 ACK 丢了）' : '') });

        if (model.lost === 'lastAck') {
          ev.push({ step: 'lost', who: null, keepCur: true,
            log: '这个 ACK 在半路丢失，' + name(B) + '压根没收到 —— 它仍停在 LAST-ACK，并不知道对方其实已经收到了自己的 FIN。',
            desc: '✗ 最后一个 ACK 丢失，' + name(B) + '还在 LAST-ACK 干等' });
          ev.push({ step: 'rto', who: null,
            zone: { kind: 'rto', label: '⏱ LAST-ACK 超时（RTO）', sub: '长度不按 RTT 计' },
            log: name(B) + '在 LAST-ACK 上为这个连接设了**超时计时器**，时间一到就重传 FIN。',
            desc: name(B) + '的超时计时器到期（RTO，不按 RTT 计）' });
          ev.push({ step: 'retrans', who: B, newSegs: [seg(B, A, ['FIN', 'ACK'], bSeq, aSeq + 1, 'fin', '超时重传的 FIN')],
            retrans: true,
            log: '超时重传：' + name(B) + '重新发送同一个 FIN（seq 与原来相同，仍是 ' + bSeq + '）。',
            desc: '↻ ' + name(B) + '超时重传 FIN' });
          ev.push({ step: 'recv', who: A,
            trans: [{ who: A, to: 'TIME-WAIT', cause: '又收到一次 FIN：重发 ACK 并重置 2MSL' }],
            log: '重传的 FIN 到达' + name(A) + '：它还在 TIME-WAIT（这正是 2MSL 的意义），于是**重发 ACK 并把 2MSL 计时器重置**。',
            desc: '☆ ' + name(A) + '重发 ACK，并把 2MSL 重新计时' });
          ev.push({ step: 'send', who: A, newSegs: [seg(A, B, ['ACK'], aSeq + 1, bSeq + 1, 'ack', '重发的 ACK')],
            log: '重发 ACK（ack=' + (bSeq + 1) + '）：' + name(A) + '仍在 TIME-WAIT，从这一刻起**重新**等 2MSL。',
            desc: name(A) + ' → ' + name(B) + '：再确认一次' });
          ev.push({ step: 'recv', who: B,
            trans: [{ who: B, to: 'CLOSED', cause: '收到重发的 ACK' }],
            log: '重发的 ACK 到达' + name(B) + '，它终于可以关闭，进入 CLOSED。',
            desc: '☆ ' + name(B) + '进入 CLOSED' });
        } else {
          ev.push({ step: 'recv', who: B,
            trans: [{ who: B, to: 'CLOSED', cause: '收到最后的 ACK' }],
            log: '最后的 ACK 到达' + name(B) + '，' + name(B) + '进入 CLOSED。★ 它只用 1.5 RTT（3 次报文段传输）。',
            desc: '☆ ' + name(B) + '进入 CLOSED（1.5 RTT）' });
        }

        ev.push({ step: 'wait', who: A,
          zone: { kind: 'wait', label: '⏳ ' + name(A) + '等 2MSL', sub: '期间收到重传的 FIN 就重发 ACK 并重新计时' },
          log: 'TIME-WAIT 等 2MSL：① 若最后的 ACK 丢失，对方会重传 FIN，本端还能再确认一次；② 让本连接的旧报文段在网络中消逝，避免污染下一个用相同四元组的新连接。',
          desc: name(A) + '在 TIME-WAIT 等 2MSL（长度不按 RTT 计）' });
        ev.push({ step: 'done', who: A,
          trans: [{ who: A, to: 'CLOSED', cause: '2MSL 到时' }],
          log: '2MSL 到时，' + name(A) + '进入 CLOSED，连接完全释放。四次挥手 = 两个方向各自独立地关闭。',
          desc: '连接完全释放' });
      }
    }

    return _tcpFrames(model, ev);
  },

  /* ---------------- ③ 纯渲染 ---------------- */
  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const W = 780, TOP = 66, GAP = 66, xC = 200, xS = 560;
    const kindColor = _TCP_KIND_COLOR;
    const yOf = (slot) => TOP + 40 + slot * GAP + 12;
    const nSlots = Math.max(1, s.nSlots);
    const H = TOP + 40 + nSlots * GAP + (s.zone ? 78 : 26);

    /* ---- 左侧时间轴：刻度 = 报文段到达时的累计用时；"＋" = 断裂之后又走的跳数 ---- */
    const ticks = (s.slotClock || []).map((sc, i) => {
      if (!sc) return '';
      const y = yOf(i);
      const broke = !!sc.mark;
      return `
        <line x1="86" y1="${y}" x2="96" y2="${y}" stroke="${broke ? '#f59e0b' : '#94a3b8'}" stroke-width="${broke ? 2.5 : 1.5}"/>
        <text x="82" y="${y + 4}" text-anchor="end" style="font:${broke ? 700 : 600} 10px Consolas,monospace" fill="${broke ? '#b45309' : '#64748b'}">${sc.label}</text>
        ${broke ? `<text x="82" y="${y + 16}" text-anchor="end" style="font:600 9px sans-serif" fill="#b45309">${sc.mark}</text>` : ''}`;
    }).join('');
    const axis = `
      <text x="82" y="${TOP - 6}" text-anchor="end" style="font:700 10px sans-serif" fill="#475569">时间(到达)</text>
      <line x1="96" y1="${TOP + 20}" x2="96" y2="${yOf(nSlots - 1) + 34}" stroke="#cbd5e1" stroke-width="1.5"/>
      ${ticks}`;
    /* "现在"这条水平虚线：标出本帧正在处理的是哪一条报文段/哪一刻 */
    const nowY = s.cur.length ? yOf(s.msgs[s.cur[0]].slot) : null;
    const nowLine = nowY === null ? '' :
      `<line x1="100" y1="${nowY}" x2="${W - 10}" y2="${nowY}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="2 6" opacity=".45"/>`;

    /* ---- 报文箭头：发送帧就画出来（虚线 = 还在路上），到达帧转实线 ---- */
    const arrows = s.msgs.map((m, i) => {
      const y = yOf(m.slot);
      const cur = s.cur.indexOf(i) >= 0;
      const flying = cur && s.step === 'send';
      const gone = !!m.lost;
      const color = gone ? '#94a3b8' : (cur ? '#f59e0b' : kindColor[m.kind] || '#94a3b8');
      const [x1, x2] = m.from === 'C' ? [xC + 56, xS - 56] : [xS - 56, xC + 56];
      const midx = (x1 + x2) / 2;
      return `
        <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="${cur ? 3.5 : 2.2}"
          ${flying ? 'stroke-dasharray="7 5" class="kedge-checking"' : ''} ${gone ? 'stroke-dasharray="3 4" opacity=".55"' : ''}
          marker-end="url(#${gone ? 'arr-gone' : (cur ? 'arr-cur' : 'arr-' + m.kind)})"/>
        <text x="${midx}" y="${y - 11}" text-anchor="middle" style="font:${cur ? 800 : 600} 11px Consolas,monospace"
          fill="${gone ? '#94a3b8' : (cur ? '#b45309' : '#64748b')}">${gone ? '✗ ' : ''}${_tcpSegLabel(m)}</text>
        ${m.note ? `<text x="${midx}" y="${y + 15}" text-anchor="middle" style="font:600 10px sans-serif" fill="#0e7490">⟿ ${RC408.util.esc(m.note)}</text>` : ''}`;
    }).join('');

    /* ---- 断裂区（2MSL / RTO / 被动方发数据：长度都不按 RTT 计） ---- */
    const zoneSvg = s.zone ? (() => {
      const st = _TCP_ZONE_STYLE[s.zone.kind] || _TCP_ZONE_STYLE.wait;
      const y = TOP + 40 + nSlots * GAP + 6;
      return `
        <rect x="${xC - 158}" y="${y}" width="316" height="46" rx="10" fill="${st.fill}" stroke="${st.stroke}" stroke-dasharray="6 4"/>
        <text x="${xC}" y="${y + 20}" text-anchor="middle" style="font:800 12px sans-serif" fill="${st.ink}">${RC408.util.esc(s.zone.label)}</text>
        <text x="${xC}" y="${y + 37}" text-anchor="middle" style="font:600 11px sans-serif" fill="${st.ink}">${RC408.util.esc(s.zone.sub)}</text>
        <text x="${xC + 140}" y="${y + 28}" text-anchor="middle" style="font:700 14px sans-serif" fill="${st.ink}">⟿</text>`;
    })() : '';

    /* ---- 状态迁移轨迹（状态机联动：链 + 触发事件，当前态高亮、经过态划掉） ---- */
    const chain = (start, edges) => {
      const node = (st, kind) => {
        const extra = kind === 'cur' ? 'outline:2px solid #f59e0b;outline-offset:1px;'
          : (kind === 'past' ? 'opacity:.5;text-decoration:line-through;' : 'opacity:.55;');
        return `<span style="${_tcpBadgeStyle(st, 'sm')};${extra}">${st}</span>`;
      };
      let html = node(start, edges.length ? 'past' : 'cur');
      edges.forEach((e, i) => {
        const last = i === edges.length - 1;
        html += `<span style="font:600 10px sans-serif;color:${last ? '#b45309' : '#94a3b8'}"> —${RC408.util.esc(e.cause)}→ </span>`;
        html += node(e.to, last ? 'cur' : 'past');
      });
      return `<div style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:2px;line-height:2">${html}</div>`;
    };

    /* ---- 两端状态卡（保留原设计：大号状态徽标 + 本步是否变化） ---- */
    const stateCard = (who, state, changed, start, edges, anchor) => `
      <div data-st="${anchor}" style="border:1px solid ${changed ? '#fcd34d' : '#e2e8f0'};border-radius:12px;background:${changed ? 'rgba(254,243,199,.6)' : '#fff'};padding:10px 12px">
        <div style="font:700 11px system-ui;color:#94a3b8">${who}${changed ? ' · 本步状态变化' : ''}</div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="${changed ? 'anim-soft-blink' : ''}" style="${_tcpBadgeStyle(state, 'lg')}">${state}</span>
          <span style="font:500 11px system-ui;color:#94a3b8">${changed ? '刚刚进入' : '停留中'}</span>
        </div>
        ${chain(start, edges)}
      </div>`;

    /* ---- 报文段 chips（保留原设计） ---- */
    const msgChips = s.msgs.map((m, i) => {
      const icon = m.kind === 'syn' ? '🔗' : (m.kind === 'fin' ? '👋' : (m.kind === 'rst' ? '⛔' : '✓'));
      const cls = m.lost ? 'chip' : (s.cur.indexOf(i) >= 0 ? 'chip-check' : 'chip-hit');
      return RC408.ui.chip(`${icon} ${m.from === 'C' ? 'C→S' : 'S→C'}`, cls, _tcpSegLabel(m));
    }).join('');

    /* ---- 末帧总账：本场景报文段账（现算）+ 时间账（口径已回考情缓存核过） ---- */
    const segRows = s.msgs.map((m, i) => {
      const arr = m.lost ? '✗ 丢失' : (m.arriveT === null ? '—' : ((m.afterBreak ? '＋ ' : '') + _tcpFmtT(m.arriveT)));
      return `<tr>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7">${i + 1}</td>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7">${m.from === 'C' ? '客户端 → 服务器' : '服务器 → 客户端'}</td>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7;font-family:Consolas,monospace">${RC408.util.esc(_tcpSegLabel(m))}</td>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7">${arr}</td>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7;color:#64748b">${m.note ? RC408.util.esc(m.note) : (m.retrans ? '超时重传' : '')}</td>
      </tr>`;
    }).join('');
    const ledgerRows = _TCP_TIME_LEDGER.map(r => `<tr>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7">${r[0]}</td>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7;font-weight:800;color:#0f766e;white-space:nowrap">${r[1]}</td>
        <td style="padding:3px 6px;border-bottom:1px solid #eef2f7;color:#64748b">${r[2]}</td>
      </tr>`).join('');
    const ledger = !s.final ? '' : `
      <div data-st="ledger" style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px;overflow-x:auto">
        <div style="font:800 12px system-ui;color:#0f172a">本场景报文段总账（序号由两个初始序号现算）</div>
        <table style="width:100%;border-collapse:collapse;margin-top:6px;font:11px system-ui">
          <thead><tr style="color:#94a3b8;text-align:left">
            <th style="padding:3px 6px">#</th><th style="padding:3px 6px">方向</th>
            <th style="padding:3px 6px">标志位 / 序号 / 确认号</th>
            <th style="padding:3px 6px">到达用时</th><th style="padding:3px 6px">备注</th>
          </tr></thead><tbody>${segRows}</tbody></table>
        <div style="margin-top:10px;font:800 12px system-ui;color:#0f172a">时间账（掐表题口径：一个报文段单向传播 = 0.5 RTT）</div>
        <table style="width:100%;border-collapse:collapse;margin-top:6px;font:11px system-ui">
          <thead><tr style="color:#94a3b8;text-align:left">
            <th style="padding:3px 6px">阶段</th><th style="padding:3px 6px">最少用时</th><th style="padding:3px 6px">口径与真题依据</th>
          </tr></thead><tbody>${ledgerRows}</tbody></table>
        <div style="margin-top:8px;font:11px/1.7 system-ui;color:#b45309">
          ⚠ 别把释放记成 2 RTT + 2MSL（多算一个 RTT），也别漏掉 2MSL 的系数 2（算成 850ms）。带"＋"的刻度表示断裂之后又走的跳数。
        </div>
      </div>`;

    const actionCard = s.trans.length
      ? RC408.ui.statCard('本帧状态迁移', s.trans.map(t => (t.who === 'C' ? '客户端' : '服务器') + ' → ' + t.to).join(' ｜ '),
        s.trans.map(t => t.cause).join(' ｜ '), 'text-amber-700')
      : RC408.ui.statCard('本帧状态迁移', '无', _TCP_STEP_NAME[s.step] || s.step, 'text-slate-500');

    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div data-st="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">
          ${RC408.ui.statCard('累计用时', (s.afterBreak ? '＋ ' : '') + _tcpFmtT(s.clock), s.tNote)}
          ${RC408.ui.statCard('本帧动作', _TCP_STEP_NAME[s.step] || s.step, s.who ? (s.who === 'CS' ? '双方' : (s.who === 'C' ? '客户端' : '服务器')) : '（无报文段）')}
          ${actionCard}
        </div>

        <div data-st="timeline" style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:8px;overflow-x:auto">
          <svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto;max-width:${W}px;margin:0 auto">
            <defs>
              <marker id="arr-syn" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#6366f1"/></marker>
              <marker id="arr-ack" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#059669"/></marker>
              <marker id="arr-fin" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#e11d48"/></marker>
              <marker id="arr-rst" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#dc2626"/></marker>
              <marker id="arr-cur" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#f59e0b"/></marker>
              <marker id="arr-gone" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#94a3b8"/></marker>
            </defs>
            ${axis}${nowLine}
            <rect x="${xC - 70}" y="12" width="140" height="38" rx="10" fill="#eef2ff" stroke="#a5b4fc"/>
            <text x="${xC}" y="36" text-anchor="middle" style="font:800 13px sans-serif" fill="#4338ca">💻 客户端</text>
            <rect x="${xS - 70}" y="12" width="140" height="38" rx="10" fill="#f0fdfa" stroke="#5eead4"/>
            <text x="${xS}" y="36" text-anchor="middle" style="font:800 13px sans-serif" fill="#0f766e">🖥️ 服务器</text>
            <line x1="${xC}" y1="${TOP}" x2="${xC}" y2="${H - 12}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>
            <line x1="${xS}" y1="${TOP}" x2="${xS}" y2="${H - 12}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>
            ${arrows}${zoneSvg}
          </svg>
        </div>

        <div data-st="chains" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px">
          ${stateCard('客户端状态', s.stateC, s.changedC, s.startC, s.trailC, 'chainC')}
          ${stateCard('服务器状态', s.stateS, s.changedS, s.startS, s.trailS, 'chainS')}
        </div>

        <div data-st="unseen" style="border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;padding:8px 12px;font:11px/1.7 system-ui;color:#475569">
          <b>本场景没走到的状态（${s.unvisited.length} 个）：</b>
          ${s.unvisited.length ? s.unvisited.map(st => `<span style="display:inline-block;padding:2px 7px;border-radius:999px;background:#f1f5f9;color:#94a3b8;font:700 10px system-ui,sans-serif;margin:1px 3px 1px 0">${st}</span>`).join('') : '（TCP 状态机 11 态全部走到）'}
          <div style="margin-top:4px;color:#94a3b8">TCP 状态机共 11 态；本场景经过的已经在上面两条迁移轨迹里点出来了。</div>
        </div>

        <div data-st="chips">
          ${RC408.ui.sectionTitle('已发送报文段（橙色 = 当前步，悬停可看完整字段）')}
          <div style="display:flex;flex-wrap:wrap;gap:6px">${msgChips || '<span style="font:12px system-ui;color:#94a3b8">（尚未发送报文段）</span>'}</div>
        </div>

        ${ledger}

        <div data-st="mnemonic" style="border-radius:12px;background:rgba(238,242,255,.7);border:1px solid #e0e7ff;padding:10px 16px;font:12px/1.7 system-ui;color:#312e81">
          💡 <b>记忆口诀：</b>${model.scene === 'open'
            ? '三次握手 = 「请求 → 同意+确认 → 再确认」；SYN 消耗一个序号，所以对方 ack = seq+1。客户端 1 RTT 就认为建成，服务器要等到 1.5 RTT。'
            : (model.scene === 'reject'
              ? '端口没人听 → 回 RST：一步复位、直接回 CLOSED，既不走四次挥手也不等 2MSL。'
              : '四次挥手 = 「我不发了 → 知道了 →（数据发完后）我也不发了 → 确认」；主动方最后要 TIME-WAIT 2MSL —— 记住是 1 RTT + 2MSL，不是 2 RTT + 2MSL。')}
        </div>
      </div>`;
  },
});

/* ---------------------------------------------------------------------------
 * 事件序列 → 逐报文帧快照（唯一的时间与状态推进入口）
 *   · clock 只在这里推进（recv 帧 +0.5），render 一律读算好的值；
 *   · 状态链只在 trans 上写一次，stateC / stateS 由链尾推出（同一状态不两处各判一次）；
 *   · 每个报文段一个 slot（同一帧发两条就共用一个 slot）⟹ 时间轴刻度不会打架；
 *   · 断裂（2MSL / RTO / 数据用时）用 zone 记，之后到达的报文段打 afterBreak ⟹ 刻度加 "＋"。
 * ------------------------------------------------------------------------- */
function _tcpFrames(model, ev) {
  const snaps = [];
  const msgs = [];
  const slotClock = [];
  let clock = 0, slot = -1, broken = 0;
  let startC = 'CLOSED', startS = 'CLOSED';
  let trailC = [], trailS = [], cur = [];
  const stateC = () => (trailC.length ? trailC[trailC.length - 1].to : startC);
  const stateS = () => (trailS.length ? trailS[trailS.length - 1].to : startS);
  const unvisitedOf = () => {
    const seen = {};
    seen[startC] = 1; seen[startS] = 1;
    trailC.forEach(e => { seen[e.to] = 1; });
    trailS.forEach(e => { seen[e.to] = 1; });
    return _TCP_ALL_STATES.filter(st => !seen[st]);
  };
  /* 一个 slot 的刻度：有到达时间就写时间（断裂之后带 ＋）；重传那条另加说明；整条丢的标 ✗ */
  const slotInfo = (sl) => {
    const inSlot = msgs.filter(m => m.slot === sl);
    const arrived = inSlot.filter(m => m.arriveT !== null && !m.lost);
    if (arrived.length) {
      const mark = arrived.some(m => m.retrans) ? 'RTO 超时后到达' : null;
      return { label: (arrived[0].afterBreak ? '＋ ' : '') + _tcpFmtT(arrived[0].arriveT), mark };
    }
    if (inSlot.some(m => m.lost)) return { label: '', mark: '✗ 丢失' };
    return { label: '', mark: null };
  };

  ev.forEach((e, i) => {
    if (e.startC) startC = e.startC;
    if (e.startS) startS = e.startS;
    const changed = { C: false, S: false };
    (e.trans || []).forEach(t => {
      if (t.who === 'C') { trailC = trailC.concat([{ to: t.to, cause: t.cause }]); changed.C = true; }
      else { trailS = trailS.concat([{ to: t.to, cause: t.cause }]); changed.S = true; }
    });
    if (e.zone) broken += 1;                        /* 断裂之后走过的跳数在刻度上加 "＋" */
    if (e.keepCur) { /* 保持上一帧的高亮（丢失帧要指着那条丢掉的 ACK） */ }
    else if (e.newSegs && e.newSegs.length) {
      slot += 1;
      cur = [];
      e.newSegs.forEach(sg => {
        msgs.push(Object.assign({}, sg, {
          slot, arriveT: null, lost: !!e.lostSeg, afterBreak: broken > 0,
          retrans: !!e.retrans || (sg.note || '').indexOf('重传') >= 0,
        }));
        cur.push(msgs.length - 1);
      });
    } else if (e.step === 'recv' && e.who) {
      cur = [];
      const pendingTo = (w) => {                    /* 严格因果序：认上一条还没落地、终点是本端的 */
        for (let k = msgs.length - 1; k >= 0; k--) {
          const m = msgs[k];
          if (m.arriveT === null && !m.lost && m.to === w) return k;
        }
        return -1;
      };
      (e.who === 'CS' ? ['C', 'S'] : [e.who]).forEach(w => {
        const k = pendingTo(w);
        if (k >= 0) { msgs[k].arriveT = clock + 0.5; cur.push(k); }
      });
    } else {
      cur = [];
    }
    if (e.step === 'recv') clock = Math.round((clock + 0.5) * 2) / 2;
    for (let sl = 0; sl <= slot; sl++) slotClock[sl] = slotInfo(sl);

    snaps.push({
      step: e.step, who: e.who || null, clock, afterBreak: broken > 0,
      msgs: msgs.map(m => Object.assign({}, m)),
      slotClock: slotClock.slice(0, slot + 1).map(x => (x ? Object.assign({}, x) : null)),
      nSlots: slot + 1, cur: cur.slice(),
      startC, startS,
      trailC: trailC.map(t => Object.assign({}, t)),
      trailS: trailS.map(t => Object.assign({}, t)),
      stateC: stateC(), stateS: stateS(),
      changedC: changed.C, changedS: changed.S,
      trans: (e.trans || []).map(t => Object.assign({}, t)),
      unvisited: unvisitedOf(),
      zone: e.zone || null,
      tNote: e.zone ? ('另有' + (e.zone.kind === 'data' ? '对方发数据的用时' : (e.zone.kind === 'rto' ? '一段超时（RTO）' : '2MSL')) + '，不折算成 RTT 账')
        : '一个报文段单向传播 = 0.5 RTT',
      final: i === ev.length - 1,
      log: ('[' + (model.scene === 'open' ? '建立连接' : (model.scene === 'reject' ? '连接被拒' : '释放连接')) + ' ' + i + '/' + (ev.length - 1) + '] ') + e.log,
      logType: e.step === 'init' ? 'info' : (e.step === 'done' ? 'success' : ((e.step === 'lost' || e.step === 'rto') ? 'error' : 'warn')),
      desc: e.desc || '',
    });
  });
  return snaps;
}
