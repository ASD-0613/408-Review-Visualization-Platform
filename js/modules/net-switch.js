'use strict';
/* ============================================================================
 * net-switch.js —— 【计算机网络】以太网交换机自学习（转发表 / 泛洪 / 过滤 / 广播域）
 * ----------------------------------------------------------------------------
 * 数据模型（先钉口径，再写实现 —— 见 handover §3.9 P2）：
 *   · 拓扑：交换机 **3 个端口**，端口 1 上挂一段**共享介质（Hub）**，连着主机 A、B；
 *     端口 2 接主机 C、端口 3 接主机 D。共 4 台主机。
 *     这条拓扑是"过滤（丢弃）"能出现的前提：A 与 B 在**同一个端口**下。
 *   · 生命线顺序固定 A · B · SW · C · D（SW 居中），x 坐标只由序号决定，不随帧变。
 *   · 事件 events = { src, dst, ingress, action, target, forwardedPorts, arrows, tableAfter }：
 *     一个事件 = 一"帧事件" = **1 条入向箭头（主机 → 交换机）+ N 条出向箭头（交换机 → 各主机）**，
 *     同一事件的多条箭头在**同一行内纵向错开**（§3.8-14：先定每行上限、再反算行高）。
 *     快照**全量携带全部事件**（含尚未发生的），每个事件带 done / cur 标记 —— 版面高度恒定。
 *   · **两条量纲，必须各自自洽**（§3.8-12）：
 *       ① target.length          = 本帧要转发到的**主机**数（同一端口下的主机都算！）
 *       ② forwardedPorts.length  = 本帧要转发到的**端口**数
 *       关系式：target.length === Σ_{p ∈ forwardedPorts} (端口 p 上的主机数)
 *       画图量纲：arrows.length === 1 + target.length
 *     这条关系正是"交换机按端口转发、端口 1 是共享段"的量化表达——
 *     端口 1 有 A、B 两台主机，所以单播给 A 时 **B 也会收到**（B 在表里是端口 1）。
 *   · 四种处理方式（本考点的全部答案，算法里只有这四支）：
 *       源 MAC 不在表 → **学习**（记 源 MAC → 入端口）
 *       目的 MAC 不在表 / 是广播地址 → **泛洪**（除入端口外全部端口）
 *       目的 MAC 在表且端口 ≠ 入端口 → **单播转发**（只从该端口发出）
 *       目的 MAC 在表且端口 = 入端口 → **过滤**（直接丢弃，不必发回原端口）
 *   · 无过渡帧，稳定帧 = init / 每个事件后 / done。
 * ========================================================================== */

/* MAC 地址（示例一律用本地管理地址，不用真实厂商 OUI 段） */
const _SWC_MAC_PREFIX = '00-1A-2B-00-00-';
const _SWC_BCAST = 'FF-FF-FF-FF-FF-FF';

/* 主机与端口：端口 1 是共享段（Hub），A、B 都在它下面 */
const _SWC_HOSTS = [
  { id: 'A', port: 1, mac: _SWC_MAC_PREFIX + '01' },
  { id: 'B', port: 1, mac: _SWC_MAC_PREFIX + '02' },
  { id: 'C', port: 2, mac: _SWC_MAC_PREFIX + '03' },
  { id: 'D', port: 3, mac: _SWC_MAC_PREFIX + '04' },
];
const _SWC_BY_ID = {};
_SWC_HOSTS.forEach(h => { _SWC_BY_ID[h.id] = h; });
const _SWC_PORTS = [1, 2, 3];

const _SWC_LINE_ORDER = ['A', 'B', 'SW', 'C', 'D'];
const _SWC_LINES = {
  A: { name: '主机 A · 端口 1', accent: '#4f46e5', bg: '#eef2ff', bd: '#a5b4fc' },
  B: { name: '主机 B · 端口 1', accent: '#4f46e5', bg: '#eef2ff', bd: '#a5b4fc' },
  SW: { name: '以太网交换机', accent: '#0f766e', bg: '#f0fdfa', bd: '#5eead4' },
  C: { name: '主机 C · 端口 2', accent: '#b45309', bg: '#fffbeb', bd: '#fcd34d' },
  D: { name: '主机 D · 端口 3', accent: '#059669', bg: '#ecfdf5', bd: '#6ee7b7' },
};

/* 动作 → 颜色（四支算法各一色） */
const _SWC_ACTION = {
  '学习': { c: '#4f46e5', t: '学习（记 源 MAC → 入端口）' },
  '泛洪': { c: '#d97706', t: '泛洪（除入端口外全部端口）' },
  '单播转发': { c: '#059669', t: '单播转发（只从表项指出的端口发出）' },
  '过滤丢弃': { c: '#e11d48', t: '过滤（目的端口 = 入端口，直接丢弃）' },
};

/* 场景：初始转发表（主机 → 端口）+ 帧序列 */
const _SWC_SCENES = {
  learn: {
    name: '首次通信：先学习 + 泛洪，再单播',
    short: '首次通信',
    init: {},
    frames: [{ src: 'A', dst: 'C' }, { src: 'C', dst: 'A' }, { src: 'A', dst: 'C' }],
  },
  hit: {
    name: '表已建立：同端口过滤 + 跨端口单播',
    short: '过滤 / 单播',
    init: { A: 1, B: 1, C: 2 },
    frames: [{ src: 'A', dst: 'B' }, { src: 'A', dst: 'C' }],
  },
  flood: {
    name: '目的未知：泛洪（回帧时才学到新表项）',
    short: '目的未知',
    init: { A: 1, C: 2 },
    frames: [{ src: 'A', dst: 'D' }, { src: 'D', dst: 'A' }],
  },
  bcast: {
    name: '广播帧（目的 MAC 全 F）：永远泛洪',
    short: '广播帧',
    init: { A: 1, B: 1, C: 2, D: 3 },
    frames: [{ src: 'A', dst: 'BC' }, { src: 'D', dst: 'BC' }],
  },
};

/* ---------------- 小工具 ---------------- */
/** 一个端口下挂的主机数（端口 1 有 A、B 两台 —— 共享段） */
function _swcPortHosts(p) { return _SWC_HOSTS.filter(h => h.port === p); }
/** 转发表对象 → 面板用的有序数组（按端口、再按主机名） */
function _swcEntries(table, origin) {
  return Object.keys(table).map(id => ({
    host: id,
    mac: _SWC_BY_ID[id].mac,
    port: table[id],
    from: origin[id] || 0,
  })).sort((x, y) => (x.port - y.port) || (x.host < y.host ? -1 : 1));
}
/** 一帧帧跑算法：返回事件数组（纯函数，零 DOM） */
function _swcRun(scene) {
  const sc = _SWC_SCENES[scene];
  const table = {};
  Object.keys(sc.init).forEach(h => { table[h] = sc.init[h]; });
  const origin = {};
  Object.keys(sc.init).forEach(h => { origin[h] = 0; });      /* 0 = 初始表项 */
  const events = [];

  sc.frames.forEach((f, i) => {
    const ingress = _SWC_BY_ID[f.src].port;
    const known = Object.prototype.hasOwnProperty.call(table, f.src);
    table[f.src] = ingress;                                     /* 学习 / 刷新老化 */
    if (!known) origin[f.src] = i + 1;

    const bcast = f.dst === 'BC';
    const dstPort = bcast ? undefined : table[f.dst];
    let action;
    if (bcast || dstPort === undefined) action = '泛洪';
    else if (dstPort === ingress) action = '过滤丢弃';
    else action = '单播转发';

    let target = [];
    if (action === '泛洪') target = _SWC_HOSTS.filter(h => h.port !== ingress);
    else if (action === '单播转发') target = _SWC_HOSTS.filter(h => h.port === dstPort);
    /* 过滤丢弃：target 为空 */

    const forwardedPorts = [];
    target.forEach(h => { if (forwardedPorts.indexOf(h.port) < 0) forwardedPorts.push(h.port); });
    forwardedPorts.sort((a, b) => a - b);

    events.push({
      i, src: f.src, dst: f.dst, bcast, dstMac: bcast ? _SWC_BCAST : _SWC_BY_ID[f.dst].mac,
      srcMac: _SWC_BY_ID[f.src].mac,
      ingress, knownBefore: known, learnedNew: !known, action, dstPort,
      target: target.map(h => h.id),
      targetHosts: target.length,
      forwardedPorts,
      arrows: [{ dir: 'in', host: f.src }].concat(target.map(h => ({ dir: 'out', host: h.id }))),
      tableAfter: Object.assign({}, table),
      originAfter: Object.assign({}, origin),
    });
  });
  return events;
}

RC408.registerModule({
  id: 'net-switch',
  mode: 'stepper',
  title: '以太网交换机自学习（转发表 · 泛洪 / 单播转发 / 过滤丢弃 · 广播域）',

  theory: `
> **为什么要有它**：集线器把收到的帧广播给所有端口，效率低、冲突域大——**交换机靠"自学习"记住每台主机在哪个端口，从而实现精准单播**。
> **怎么实现**：收到帧先**学**（源 MAC → 入端口），再查目的 MAC：不在表里或是广播地址就**泛洪**（除入端口外全部端口），在表里且端口 ≠ 入端口就**单播**，在表里且端口 = 入端口就**过滤丢弃**。
> **记住什么**：四条规则 + **按端口转发**（端口下挂共享段时该段上所有主机都能收到）+ **冲突域 = 端口数、广播域 = 1**（靠 VLAN 或路由器才能隔离广播域）。

## 一、一张表 + 四条规则
交换机是**多端口网桥**，工作在**数据链路层**，靠 **MAC 地址（物理地址）**转发，维护一张 **MAC 地址 → 端口** 的转发表。

| 情况 | 动作 | 一句话 |
| --- | --- | --- |
| 源 MAC 不在表里 | **学习**：记 源 MAC → 入端口 | 看谁发来的，就知道它在哪个端口 |
| 目的 MAC 不在表里（或是广播地址） | **泛洪**：除入端口外全部端口 | 不知道在哪，只好都问一遍 |
| 目的 MAC 在表里且端口 ≠ 入端口 | **单播转发**：只从该端口发出 | 知道在哪，精准投递 |
| 目的 MAC 在表里且端口 = 入端口 | **过滤（丢弃）** | 从哪进来又发回哪去，没有意义 |

- 表项有**老化时间**：太久没出现就删掉，之后又要重新学习；
- **关键提醒**：交换机按**端口**转发，一个端口下面可能挂着**一段共享介质**（Hub + 多台主机）。
  此时从该端口转发出去的帧，**这一段上的所有主机都能收到**——哪怕目的 MAC 只是其中一台（2021-47 就考这个）。

## 二、冲突域与广播域（真题最爱考的两个"域"）
| 设备 | 工作层 | 隔离冲突域 | 隔离广播域 |
| --- | --- | --- | --- |
| 集线器 / 中继器 | 物理层 | ✗ 不能 | ✗ 不能 |
| 网桥 / **交换机** | 数据链路层 | **✓ 能** | ✗ 不能（除非划 VLAN） |
| 路由器 | 网络层 | ✓ 能 | ✓ 能 |

- 交换机**每个端口是一个独立的冲突域**（全双工下甚至不存在冲突），所以它能隔离冲突域；
- 但**默认所有端口属于同一个广播域**——广播帧（目的 MAC 全 F）会被泛洪到所有端口；
- 要隔离广播域得用 **VLAN（按端口划分）** 或路由器（2024-35、2026-36）。

## 考点提醒（易错点）
1. 看到"转发表里没有该目的 MAC"→ **泛洪**（除入接口外全部接口，2014-34）；"目的在同一端口"→ **丢弃**；
2. 数域题：**冲突域 = 端口数**（端口下挂集线器时那一段算一个）、**广播域默认 1 个**（集线器两个域都不隔离，2010-38、2020-35）；
3. 设备选型大题（2019-47、2022-47）：**同网段用交换机 / 集线器，跨网段或要隔离广播域必须路由器**；
   问"哪些主机会收到帧"时，**先按端口找，再展开该端口下共享段上的全部主机**（2016-35、2021-47(3)）。

> **真题考情**：**11/18 年（选 9 + 大题 3）**：选 2009-36、2010-38、2014-34、2015-37、2016-33·35、2020-35、
> 2024-35、2026-36；大 2019-47、2021-47、2022-47（交换表内容 / 泛洪范围 / 设备选型）。
`,

  /* ---------------- 输入表单（每项都必须显式给 default，见 §3.8-11） ---------------- */
  inputs: [
    {
      key: 'scene', label: '演示场景', type: 'select', default: 'learn',
      options: [
        { v: 'learn', t: '① 首次通信：学习 + 泛洪 → 学习 + 单播' },
        { v: 'hit', t: '② 表已建立：同端口过滤丢弃 + 跨端口单播' },
        { v: 'flood', t: '③ 目的未知：泛洪（回帧时才学到新表项）' },
        { v: 'bcast', t: '④ 广播帧（目的 MAC 全 F）：永远泛洪' },
      ],
      help: '四个场景合起来覆盖交换机的全部四种动作；拓扑固定为 端口1（Hub：A、B）· 端口2（C）· 端口3（D）',
    },
  ],

  /* ---------------- 真题 / 场景预设 ---------------- */
  quickActions: [
    { label: '📘 首次通信：学习 + 泛洪', run(rt) { rt.setInput('scene', 'learn'); rt.load(); } },
    { label: '📘 同端口过滤丢弃（A→B）', run(rt) { rt.setInput('scene', 'hit'); rt.load(); } },
    { label: '📘 目的未知 → 泛洪（A→D）', run(rt) { rt.setInput('scene', 'flood'); rt.load(); } },
    { label: '📘 广播帧：永远泛洪', run(rt) { rt.setInput('scene', 'bcast'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const scene = String(vals.scene == null ? '' : vals.scene);
    if (!_SWC_SCENES[scene]) {
      throw { message: `场景「${scene}」不存在：可选 ① 首次通信 ② 过滤/单播 ③ 目的未知 ④ 广播帧。` };
    }
    return {
      scene,
      portCount: _SWC_PORTS.length,
      hostCount: _SWC_HOSTS.length,
      collisionDomains: _SWC_PORTS.length,   /* 端口 1 的那段共享介质算一个冲突域 */
      broadcastDomains: 1,                   /* 未划 VLAN */
      hostList: _SWC_HOSTS.map(h => ({ id: h.id, port: h.port, mac: h.mac })),
    };
  },

  /* ---------------- ② 纯算法：帧序列 → 快照 ---------------- */
  buildSnapshots(model) {
    const sc = _SWC_SCENES[model.scene];
    const events = _swcRun(model.scene);
    const n = events.length;
    const initEntries = _swcEntries(sc.init, {});

    /** 造一帧：upto = 已完成的事件数（0 = 一个事件都还没发生） */
    const frame = (step, upto, o) => {
      const evs = events.map(e => ({
        ...e,
        done: step === 'done' ? e.i < upto : e.i < upto - 1,
        cur: step !== 'done' && e.i === upto - 1,
      }));
      const curIdx = (step === 'done' ? Math.min(upto, n) : upto) - 1;
      const curEv = curIdx >= 0 && curIdx < n ? evs[curIdx] : null;
      const entries = curEv ? _swcEntries(curEv.tableAfter, curEv.originAfter) : initEntries;
      return {
        step, events: evs, upto, scene: model.scene,
        sceneShort: sc.short, sceneName: sc.name,
        totalEvents: n,
        curEvent: curEv,
        curAction: curEv ? curEv.action : '—',
        curActionColor: curEv ? _SWC_ACTION[curEv.action].c : '#94a3b8',
        curForwarded: curEv ? curEv.forwardedPorts : [],
        curTarget: curEv ? curEv.target : [],
        curTargetHosts: curEv ? curEv.targetHosts : 0,
        curArrows: curEv ? curEv.arrows.length : 0,
        entries,
        entryCount: entries.length,
        dropped: !!curEv && curEv.action === '过滤丢弃',
        portCount: model.portCount, hostCount: model.hostCount,
        collisionDomains: model.collisionDomains, broadcastDomains: model.broadcastDomains,
        hostList: model.hostList,
        bcastMac: _SWC_BCAST,
        model: { ...model },
        ...o,
      };
    };

    const snaps = [];
    snaps.push(frame('init', 0, {
      log: `[${sc.short}] 准备演示：转发表初始有 ${Object.keys(sc.init).length} 条表项`,
      logType: 'info',
      desc: `初始状态：转发表里已有 ${Object.keys(sc.init).length} 条表项${Object.keys(sc.init).length ? '（' + _swcEntries(sc.init, {}).map(e => e.host + '→端口' + e.port).join('、') + '）' : '（空表，谁在哪都不知道）'}。接下来每一帧都先看"源 MAC 学不学"、再看"目的 MAC 往哪发"。`,
    }));

    events.forEach(e => {
      const dstName = e.bcast ? '广播帧（FF-FF-FF-FF-FF-FF）' : `主机 ${e.dst}`;
      snaps.push(frame('evt', e.i + 1, {
        log: `[${sc.short}] 事件 ${e.i + 1}/${n}：${e.src}→${e.bcast ? '广播' : e.dst}｜${e.learnedNew ? `学习 ${e.src}→端口 ${e.ingress}` : `刷新 ${e.src}→端口 ${e.ingress}`}｜${e.action}${e.target.length ? '：' + e.target.join('、') : ''}`,
        logType: e.action === '过滤丢弃' ? 'warn' : (e.action === '泛洪' ? 'info' : 'success'),
        desc: `事件 ${e.i + 1}/${n}：主机 ${e.src}（端口 ${e.ingress}）发出以 ${dstName} 为目的的帧。`
          + `源 MAC ${e.srcMac} ${e.learnedNew ? '不在表里 → 学习 源 MAC → 端口 ' + e.ingress : '已在表里 → 刷新端口 ' + e.ingress + ' 的老化计时'}。`
          + `目的 MAC ${e.dstMac} ${e.bcast ? '是广播地址 → ' : (e.dstPort === undefined ? '不在表里 → ' : '命中 端口 ' + e.dstPort + ' → ')}`
          + `${e.action === '泛洪' ? '泛洪（除入端口 ' + e.ingress + ' 外全部端口：' + e.forwardedPorts.join('、') + '）'
            : e.action === '单播转发' ? '单播转发（只从端口 ' + e.dstPort + ' 发出）'
              : '目的端口 = 入端口 ' + e.ingress + ' → 过滤丢弃，不转发'}。`,
      }));
    });

    snaps.push(frame('done', n, {
      log: `[${sc.short}] 演示完成：共 ${n} 个帧事件｜最终转发表 ${_swcEntries(events[n - 1].tableAfter, events[n - 1].originAfter).length} 条`,
      logType: 'success',
      desc: `完成：共 ${n} 个帧事件。演示后转发表有 ${_swcEntries(events[n - 1].tableAfter, events[n - 1].originAfter).length} 条表项；`
        + `交换机默认 ${model.collisionDomains} 个冲突域（每端口一个）、${model.broadcastDomains} 个广播域（未划 VLAN）。`,
    }));
    return snaps;
  },

  /* ---------------- ③ 纯渲染：只读快照 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const ids = _SWC_LINE_ORDER;
    const nl = ids.length;

    /* 版面常量：W=980，左侧 150px 给"本帧动作"标签（横排，不竖排 —— §3.3-21③） */
    const W = 980, GUT = 150, BOXW = 168, RIGHT = 40, TOP = 64, BOXH = 50, ROWH = 84;
    const BASE = TOP + BOXH + 30;                           /* 第一行 rowTop */
    const SPAN = W - GUT - RIGHT - BOXW;
    const xOf = id => (GUT + BOXW / 2) + ids.indexOf(id) * (SPAN / (nl - 1));
    const rowTop = i => BASE + i * ROWH;
    const rows = Math.max(s.events.length, 1);
    const H = rowTop(rows - 1) + ROWH + 20;

    /* 端口 1 的共享段（Hub）：把 A、B 两条生命线框在一起 */
    const hubBox = `
      <rect x="${xOf('A') - BOXW / 2 - 8}" y="${TOP - 22}" width="${xOf('B') - xOf('A') + BOXW + 16}"
        height="${BOXH + 16}" rx="12" fill="none" stroke="#c7d2fe" stroke-width="1.4" stroke-dasharray="6 5"/>
      <text class="swc-grp-text" x="${(xOf('A') + xOf('B')) / 2}" y="${TOP - 8}" text-anchor="middle"
        style="font:800 10px sans-serif" fill="#4338ca">端口 1 共享段（Hub）：A、B 都能收到这一段上的帧</text>`;

    /* 生命线：顶部卡片 + 竖虚线 */
    const lines = ids.map(id => {
      const L = _SWC_LINES[id];
      const cx = xOf(id);
      const sub = id === 'SW' ? '端口 1 · 2 · 3' : _SWC_BY_ID[id].mac;
      const active = s.events.some(e => (e.done || e.cur) && e.arrows.some(a => a.host === id));
      return `
        <rect x="${cx - BOXW / 2}" y="${TOP}" width="${BOXW}" height="${BOXH}" rx="10"
          fill="${L.bg}" stroke="${active ? L.accent : L.bd}" stroke-width="${active ? 2.4 : 1.4}"/>
        <text x="${cx}" y="${TOP + 20}" text-anchor="middle" class="swc-line-name" style="font:800 12.5px sans-serif" fill="${L.accent}">${L.name}</text>
        <text x="${cx}" y="${TOP + 36}" text-anchor="middle" class="swc-line-sub" style="font:700 9.5px Consolas,monospace" fill="#64748b">${sub}</text>
        <line class="swc-life" x1="${cx}" y1="${TOP + BOXH + 4}" x2="${cx}" y2="${H - 16}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>`;
    }).join('');

    /* 每个事件一行：行内多条箭头纵向错开（§3.8-14） */
    const rowTags = [];
    const arrows = s.events.map(e => {
      const k = e.arrows.length;
      const y0 = rowTop(e.i);
      const state = e.cur ? 'cur' : e.done ? 'done' : 'future';
      const col = state === 'future' ? '#e2e8f0' : _SWC_ACTION[e.action].c;
      const tagText = `${e.learnedNew ? '学 ' + e.src + '→' + e.ingress : '刷新 ' + e.src + '→' + e.ingress} · ${e.action === '单播转发' ? '单播' : e.action}`;
      rowTags.push(`<text class="swc-row-tag" x="16" y="${y0 + 18}" style="font:800 10px sans-serif" fill="${state === 'future' ? '#e2e8f0' : _SWC_ACTION[e.action].c}">${e.i + 1}. ${tagText}</text>`);

      const parts = e.arrows.map((a, j) => {
        const y = y0 + ROWH * (j + 1) / (k + 1);
        const x1 = xOf(a.dir === 'in' ? a.host : 'SW');
        const x2 = xOf(a.dir === 'in' ? 'SW' : a.host);
        const dir = x2 > x1 ? 1 : -1;
        const ax1 = x1 + dir * 12, ax2 = x2 - dir * 16;
        const midx = (ax1 + ax2) / 2;
        const label = a.dir === 'in'
          ? `帧 ${e.src}→${e.bcast ? '广播' : e.dst}（入端口 ${e.ingress}）`
          : `${e.action === '泛洪' ? '泛洪' : '单播'} → 主机 ${a.host}`;
        const cls = state === 'cur' ? ' class="kedge-checking swc-arrow-cur"' : ' class="swc-arrow"';
        const marker = state === 'future' ? '' : ' marker-end="url(#swc-arr)"';
        const txtFill = state === 'future' ? '#cbd5e1' : (a.dir === 'in' ? '#475569' : (state === 'cur' ? '#b45309' : '#475569'));
        return `
          <line x1="${ax1}" y1="${y}" x2="${ax2}" y2="${y}" stroke="${col}"
            stroke-width="${state === 'cur' ? 4 : state === 'done' ? 2.6 : 2}"${marker}${cls}/>
          <text x="${midx}" y="${y - 7}" text-anchor="middle" class="swc-msg-label"
            style="font:${state === 'cur' ? 800 : 600} 10.5px Consolas,sans-serif" fill="${txtFill}">${label}</text>`;
      }).join('');

      /* 过滤丢弃：没有出向箭头，用一行红字说清"往哪去" */
      const drop = e.action === '过滤丢弃' ? `
        <text class="swc-drop" x="${W - 20}" y="${y0 + ROWH / 2 + 4}" text-anchor="end"
          style="font:800 11px sans-serif" fill="${state === 'future' ? '#e2e8f0' : '#e11d48'}">✗ 过滤丢弃：目的端口 = 入端口 ${e.ingress}，不转发</text>` : '';
      return parts + drop;
    }).join('');

    /* ------- 统计卡 ------- */
    const card2 = `${s.entryCount} 条`;
    const card3 = s.curEvent
      ? `<span style="color:${s.curActionColor}">${s.curAction}</span>`
      : '<span class="text-slate-400">等待开始</span>';

    /* ------- 转发表 ------- */
    const rowsTd = s.entries.length ? s.entries.map(e => {
      const isNew = s.curEvent && s.curEvent.learnedNew && s.curEvent.src === e.host;
      return `<tr class="${isNew ? 'bg-indigo-50' : ''}">
        <td class="py-1.5 pr-2 text-[11px] font-mono ${isNew ? 'text-indigo-700 font-extrabold' : 'text-slate-600'}">${e.mac}</td>
        <td class="py-1.5 px-2 text-center font-extrabold ${isNew ? 'text-indigo-700' : 'text-slate-700'}">${e.port}</td>
        <td class="py-1.5 px-2 text-center text-[11px] text-slate-500">主机 ${e.host}</td>
        <td class="py-1.5 pl-2 text-[11px] ${isNew ? 'text-indigo-700 font-bold' : 'text-slate-400'}">${e.from === 0 ? '初始表项' : '事件 ' + e.from + (isNew ? ' ← 本帧新学' : '')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" class="py-3 text-center text-[11px] text-slate-400">转发表为空 —— 交换机还不知道任何主机在哪个端口</td></tr>`;

    /* ------- 四条规则表 ------- */
    const ruleRows = [
      { k: '源 MAC 不在表里', a: '学习：记 源 MAC → 入端口', c: '#4f46e5' },
      { k: '目的 MAC 不在表里 / 广播地址', a: '泛洪：除入端口外，向所有其他端口转发', c: '#d97706' },
      { k: '目的 MAC 在表里，端口 ≠ 入端口', a: '单播转发：只从表项指出的那个端口发出', c: '#059669' },
      { k: '目的 MAC 在表里，端口 = 入端口', a: '过滤：直接丢弃，不转发', c: '#e11d48' },
    ].map(r => {
      const on = s.curEvent && _SWC_ACTION[s.curEvent.action].c === r.c;
      return `<tr class="${on ? 'bg-amber-50' : ''}">
        <td class="py-1.5 pr-2 text-[11px] ${on ? 'font-extrabold text-amber-700' : 'text-slate-600'}">${on ? '▶ ' : ''}${r.k}</td>
        <td class="py-1.5 pl-2 text-[11px] font-bold" style="color:${on ? '#b45309' : r.c}">${r.a}</td>
      </tr>`;
    }).join('');

    /* ------- 域表 ------- */
    const domainRows = [
      { d: '集线器 / 中继器', l: '物理层', c: '✗ 不能', b: '✗ 不能' },
      { d: '网桥 / 交换机', l: '数据链路层', c: '✓ 能', b: '✗ 不能（除非划 VLAN）' },
      { d: '路由器', l: '网络层', c: '✓ 能', b: '✓ 能' },
    ].map(r => `<tr>
      <td class="py-1.5 pr-2 text-[11px] text-slate-600">${r.d}</td>
      <td class="py-1.5 px-1 text-[11px] text-slate-500">${r.l}</td>
      <td class="py-1.5 px-1 text-center text-[11px] font-bold ${r.c[0] === '✓' ? 'text-emerald-600' : 'text-slate-400'}">${r.c}</td>
      <td class="py-1.5 pl-1 text-center text-[11px] font-bold ${r.b[0] === '✓' ? 'text-emerald-600' : 'text-slate-400'}">${r.b}</td>
    </tr>`).join('');

    /* ------- 本帧说明 ------- */
    const curText = s.curEvent
      ? `本帧：主机 ${s.curEvent.src}（端口 ${s.curEvent.ingress}）→ ${s.curEvent.bcast ? '广播帧' : '主机 ' + s.curEvent.dst}。
         ${s.curEvent.learnedNew ? '源 MAC 不在表里，学习 ' + s.curEvent.src + ' → 端口 ' + s.curEvent.ingress + '。' : '源 MAC 已在表里，刷新端口 ' + s.curEvent.ingress + ' 的老化计时。'}
         ${s.curEvent.action === '泛洪' ? '目的未知（或为广播），泛洪到端口 ' + s.curEvent.forwardedPorts.join('、') + '。'
        : s.curEvent.action === '单播转发' ? '目的命中端口 ' + s.curEvent.dstPort + '，只从该端口发出。'
          : '目的命中端口 ' + s.curEvent.ingress + '，与入端口相同 → 过滤丢弃。'}`
      : '还没有开始，先点「单步 ▶」看第一帧。';

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
            <defs>
              <marker id="swc-arr" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#64748b"/></marker>
            </defs>
            ${hubBox}${lines}${arrows}${rowTags.join('')}
          </svg>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          ${RC408.ui.statCard('当前场景', `<span class="text-base">${s.sceneShort}</span>`, s.sceneName, 'text-indigo-700')}
          ${RC408.ui.statCard('转发表项数', card2, 'MAC 地址 → 端口', s.entryCount ? 'text-slate-800' : 'text-slate-400')}
          ${RC408.ui.statCard('本帧动作', card3, s.curEvent ? '四支算法之一' : '—', 'text-slate-800')}
          ${RC408.ui.statCard('本帧转发', s.curEvent ? `${s.curTargetHosts} 台主机 · ${s.curForwarded.length} 个端口` : '—', s.dropped ? '过滤丢弃：一个端口都不发' : (s.curEvent ? '端口 ' + (s.curForwarded.join('、') || '—') : '—'), s.dropped ? 'text-rose-600' : 'text-slate-800')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
            ${RC408.ui.sectionTitle('转发表（MAC 地址表）—— 交换机就靠它决定往哪发')}
            <table class="w-full text-sm">
              <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100">
                <th class="text-left py-1 pr-2 font-bold">MAC 地址</th>
                <th class="py-1 px-2 font-bold">端口</th>
                <th class="py-1 px-2 font-bold">主机</th>
                <th class="text-left py-1 pl-2 font-bold">何时学到</th>
              </tr></thead>
              <tbody>${rowsTd}</tbody>
            </table>
            <p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
              表项带<b>老化时间</b>：太久没出现的会被删掉，之后又要重新学习。交换机是<b>多端口网桥</b>，
              工作在<b>数据链路层</b>、按 <b>MAC（物理）地址</b>转发。
            </p>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            ${RC408.ui.sectionTitle('本帧发生了什么')}
            <p class="text-[11px] text-slate-600 leading-relaxed">${curText}</p>
            <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
              <b>拓扑</b>：端口 1 = 一段共享介质（Hub），挂着主机 A、B；端口 2 = 主机 C；端口 3 = 主机 D。
              所以从端口 1 转发出去的帧，<b>A、B 都能收到</b>——交换机按<b>端口</b>转发，不认"这一台"。
            </div>
            <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
              本帧箭头 = <b>${s.curArrows}</b> 条 = 1 条入向 + <b>${s.curTargetHosts}</b> 条出向（转发到的主机数）。
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            ${RC408.ui.sectionTitle('交换机的四条规则（算法只有这四支）')}
            <table class="w-full text-sm"><tbody>${ruleRows}</tbody></table>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            ${RC408.ui.sectionTitle('冲突域 / 广播域（真题最爱考的两个"域"）')}
            <table class="w-full text-sm">
              <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100">
                <th class="text-left py-1 pr-2 font-bold">设备</th>
                <th class="text-left py-1 px-1 font-bold">工作层</th>
                <th class="py-1 px-1 font-bold">隔离冲突域</th>
                <th class="py-1 pl-1 font-bold">隔离广播域</th>
              </tr></thead>
              <tbody>${domainRows}</tbody>
            </table>
            <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 mt-2 pt-2">
              本例拓扑：<b>${s.collisionDomains} 个冲突域</b>（每端口一个，端口 1 的那段共享介质算一个）、
              <b>${s.broadcastDomains} 个广播域</b>（未划 VLAN，所有端口同属一个广播域）。
              广播帧的目的 MAC 是 <span class="font-mono">${s.bcastMac}</span>，交换机只能泛洪——这就是广播域的边界。
            </div>
          </div>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>记忆口诀：</b>没学过就<b>学</b>（源 MAC → 入端口）、不知道就<b>泛洪</b>（除入口外全部）、
          知道就<b>单播</b>（只发那个端口）、目的就在入口那一段就<b>丢弃</b>。
          交换机隔离<b>冲突域</b>、不隔离<b>广播域</b>；要隔离广播域得上 <b>VLAN</b> 或路由器。
        </div>
      </div>`;
  },
});
