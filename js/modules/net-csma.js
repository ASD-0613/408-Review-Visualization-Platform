'use strict';
/* ============================================================================
 * net-csma.js —— 【计算机网络】CSMA/CD 与最小帧长（争用期 / 冲突检测 / 二进制指数退避 / CSMA/CA）
 * ----------------------------------------------------------------------------
 * 数据模型与单位口径（先钉口径、再写实现 —— handover §3.9 P2 与 §3.8-12）：
 *   · 数据率 rate：Mb/s。**关键恒等式：1 Mb/s = 1 bit/μs**（10 Mb/s = 10 bit/μs）——
 *     它是把"微秒"和"比特"接起来的唯一桥梁，全模块的换算都靠它（§3.8-12 的量纲纪律）。
 *   · 信号传播速率 v = 200 m/μs（= 2×10^8 m/s，教材默认，写死不让用户改）。
 *   · 距离 dist：m（**真实介质**单程长度）。信号在介质上的传播时延 tProp = dist / v   (μs)
 *   · 设备延时 hubDelay：μs（Hub / 中继器转发带来的额外延时）。
 *     **单程总传播时延** tau = tProp + hubDelay  ← 2016-36 与 2022-47 两道真题都必须算进它。
 *   · 等效总线长度 distEff = v × tau  (m)  ← 时空图的纵轴用它，这样"斜线走完 distEff 正好花 tau"，
 *     Hub 的那段延时折算成长度（谢希仁"51.2 μs 相当于 5120 m 总线长度"就是同一个折算）。
 *   · 争用期（碰撞窗口）win = 2 × tau  (μs)；**退避时隙 slot = win**（一个时隙就是一个争用期）。
 *   · 最小帧长 minBits = win × rate  (bit) —— 量纲：μs × (bit/μs) = bit；minBytes = minBits / 8 (B)。
 *   · 帧发送时延 T = frameBits / rate (μs)；**帧够不够长 = (T ≥ win)**；
 *     T == win 时对应的距离就是"能检测到冲突的最远距离"（2022-47 解 D = 210 m 用的就是它）。
 *   · 两条**同名的量**（帧长的 bit / 字节）各自自洽 + 一条关系式（§3.8-12）：
 *       minBytes × 8 === minBits 且 minBits / win === rate（把"两个量纲一起错"的路堵死）。
 *   · 三个场景各覆盖一条分支（§3.8-15 分支可达性）：
 *       detect（默认）：冲突检测全过程时空图；帧够长 → 检测成功；帧太短 → 检测失败并给出填充量；
 *       backoff      ：二进制指数退避，第 i 次冲突取 k = min(i,10)，给出最长 / 平均等待；
 *       ca           ：CSMA/CA 时间组成（DIFS / SIFS / RTS / CTS / ACK 与 NAV 计算）。
 *   · 无过渡帧；稳定帧 = 每个时间轴事件一帧，快照全量携带状态（§1.3），版面高度恒定。
 *
 * 全局前缀 `_cs`（§3.1-3）、SVG 类名前缀 `cs-`。
 * ========================================================================== */

/* 信号传播速率（教材默认 2×10^8 m/s） */
const _CS_V = 200;                       /* m/μs */
/* 802.3 规定最多重传 16 次后丢弃该帧 */
const _CS_MAX_I = 16;
/* 乙的抢发提前量 δ：取 **0**，即"乙恰在甲的信号到达前那一刻抢发"这个**极限情形**
   —— 2010-47 大题的标准解法用的就是它（"当数据即将到达乙时乙也开始发送…甲要检测到冲突还需等待
   冲突信号从乙传播到甲"⟹ 甲最迟 **2τ** 才听到）。取 δ = 0 的好处是**画面与判据完全一致**：
   检测时刻 tDetect 恰好 = 2τ = 争用期，于是"帧太短 ⟺ T < 2τ ⟺ 甲发完了冲突信号还没回来"。
   （若取 δ > 0，检测时刻会是 1.9τ 左右，就会出现"按教材算太短、按本演示却赶上了"的自相矛盾。） */
const _CS_DELTA_RATIO = 0;
/* CSMA/CA 的固定时长（μs）—— 取自 2024-36 题干（2026-35 给出的 DIFS / SIFS 与之一致） */
const _CS_CA = { DIFS: 128, SIFS: 28, RTS: 3, CTS: 2, ACK: 2 };

const _CS_SCENES = {
  detect: { name: '冲突检测全过程（时空图）', short: '冲突检测' },
  backoff: { name: '二进制指数退避（第 i 次冲突后等多久）', short: '指数退避' },
  ca: { name: 'CSMA/CA 时间组成（DIFS / SIFS / NAV）', short: 'CSMA/CA' },
};

/* 颜色：一根主线的四个角色 */
const _CS_COLOR = {
  a: '#4f46e5',      /* 甲（A 端）发送 */
  b: '#b45309',      /* 乙（B 端）抢发 */
  jam: '#e11d48',    /* 冲突信号（强化干扰） */
  win: '#f59e0b',    /* 争用期 */
  future: '#e2e8f0', /* 尚未发生 */
  head: '#94a3b8',
};

/* ---------------- 小工具 ---------------- */
/** 数字格式化（去掉浮点尾巴；渲染文案里绝不允许出现 NaN/undefined） */
function _csNum(x, dg) {
  const p = Math.pow(10, dg == null ? 3 : dg);
  return String(Math.round(x * p) / p);
}

/** 估算一段文字的像素宽（浏览器外的排版预算；CJK 按 1.0 em、ASCII 按 0.58 em）
 *  —— CSMA/CA 的区间带按**真实比例**画，RTS/CTS/ACK 只有 3~4 px 宽，
 *  标签必须放到带子外面并按"贪心左到右"排，才能保证两两不压盖（§3.8-14 同源）。 */
function _csTextW(str, fs) {
  let w = 0;
  for (const ch of String(str)) w += /[\u4e00-\u9fa5（），、：]/.test(ch) ? fs : fs * 0.58;
  return w;
}

/** 生成一个"绝不越出绘图区"的 SVG 文字：放不下就改成右对齐锚在右边界（§3.3-12 越界 / §3.3-21） */
function _csLabel(x, y, txt, fill, px1, fs, weight) {
  const fsz = fs || 10.5;
  const w = _csTextW(txt, fsz);
  const over = x + w > px1;
  const ax = over ? Math.min(px1 - 2, x + w) : x;
  return `<text class="cs-msg-label" x="${ax}" y="${y}" text-anchor="${over ? 'end' : 'start'}" `
    + `style="font:${weight || 800} ${fsz}px sans-serif" fill="${fill}">${txt}</text>`;
}

/* ---------------- ① 派生量（纯函数，零 DOM） ---------------- */
function _csDerive(m) {
  const tProp = m.dist / _CS_V;                 /* 信号在介质上的单程传播时延 μs */
  const tau = tProp + m.hubDelay;               /* 单程总传播时延 μs（含设备延时） */
  const distEff = _CS_V * tau;                  /* 等效总线长度 m（时空图纵轴） */
  const win = 2 * tau;                          /* 争用期（碰撞窗口）μs */
  const minBits = win * m.rate;                 /* bit（1 Mb/s = 1 bit/μs） */
  const minBytes = minBits / 8;                 /* B */
  const frameBits = m.frameLenB * 8;            /* bit */
  const T = frameBits / m.rate;                 /* 帧发送时延 μs */
  const frameBytes = m.frameLenB;
  const okDetect = T >= win - 1e-9;             /* 帧够长 → 能在发完前听到冲突 */
  const padBytes = Math.max(0, minBytes - frameBytes);
  const padBits = padBytes * 8;
  const maxRTT = 2 * tProp;                     /* 只用介质、不含设备延时的双程时延 μs */
  return {
    /* 原样带上输入量，便于文案函数直接用（少了它们会在渲染文案里打出 NaN） */
    rate: m.rate, dist: m.dist, hubDelay: m.hubDelay,
    tProp, tau, distEff, win, minBits, minBytes, frameBits, frameBytes, T,
    okDetect, padBytes, padBits, slack: T - win, maxRTT,
  };
}

/* ---------------- ② 退避表（纯函数） ---------------- */
/** 第 i 次冲突：k = min(i,10)，取 k 个以内的时隙数（0 ~ 2^k − 1） */
function _csBackoffRow(i, win) {
  const k = Math.min(i, 10);
  const kMax = Math.pow(2, k) - 1;
  return { i, k, kMax, slots: kMax + 1, maxWait: kMax * win, avgWait: (kMax / 2) * win };
}

/* ---------------- ③ 冲突时间轴（纯函数） ---------------- */
/** 时空图的几何：前沿相遇点 = 冲突点；冲突信号再走一个单程回到甲 = 检测时刻 */
function _csDetectPlan(d) {
  const delta = _CS_DELTA_RATIO * d.tau;        /* 乙的抢发提前量 μs */
  const tB = d.tau - delta;                     /* 乙开始发送的时刻 */
  const xC = (d.distEff + _CS_V * tB) / 2;      /* 两条前沿相遇的位置 m */
  const tC = xC / _CS_V;                        /* 冲突发生的时刻 μs */
  const tDetect = 2 * tC;                       /* 冲突信号回到甲（甲检测到）的时刻 μs */
  const tJamB = tC + (d.distEff - xC) / _CS_V;  /* 冲突信号到达乙的时刻 μs */
  return { delta, tB, xC, tC, tDetect, tJamB };
}

/* ---------------- ④ 快照：detect 场景 ---------------- */
function _csDetectSnaps(model) {
  const d = _csDerive(model);
  const p = _csDetectPlan(d);
  const tEnd = Math.max(d.win, d.T, p.tDetect) * 1.12 + 4;
  const tStop = Math.max(d.T, p.tDetect) + 0.12 * d.tau;

  const events = [
    { key: 'init', t: 0, ev: '准备', tone: 'info', note: '参数已就绪，还没开始发。' },
    { key: 'a-send', t: 0.03 * d.tau, ev: '甲开始发送', tone: 'info', note: '甲先听后发：监听到信道空闲，开始发送第 1 个比特。' },
    { key: 'a-prop1', t: 0.45 * d.tau, ev: '信号向乙传播', tone: 'info', note: '甲的信号前沿在总线上走，走完一个单程要 τ。' },
    { key: 'a-prop2', t: 0.8 * d.tau, ev: '信号接近乙', tone: 'info', note: '信号快到乙了，但此刻乙监听信道仍然是"空闲"的。' },
    { key: 'collide', t: p.tC, ev: '乙抢发 → 立刻冲突', tone: 'warn', note: '信号到达乙的那一刻，乙也开始发送（它监听时信道还空着）→ 两端信号在乙端相撞，乙立刻检测到冲突。' },
    { key: 'jam', t: p.tC + 0.5 * (p.tDetect - p.tC), ev: '冲突信号回传', tone: 'warn', note: '双方停发数据、改发强化干扰信号，让冲突信号沿总线传遍全网。' },
    { key: 'detect', t: p.tDetect, ev: '甲检测到冲突（= 2τ）', tone: 'warn', note: '冲突信号回到甲，甲检测到冲突——从甲开始发送算起正好 2τ，这就是"最迟 2τ"。' },
    { key: 'stop', t: tStop, ev: '停发 → 二进制指数退避', tone: 'info', note: '停发之后不马上重发，而是按二进制指数退避随机等 k 个争用期。' },
    { key: 'done', t: tEnd, ev: '结论', tone: 'success', note: '结论：本帧的发送时延 T 与争用期 2τ 的大小关系，决定这次冲突能不能被检测到。' },
  ];

  const snap = (idx, extra) => {
    const e = events[idx];
    const tNow = e.t;
    const aSendEnd = Math.min(d.T, tNow);                       /* 甲已发送到哪个时刻 */
    const bSendEnd = p.tB >= 0 ? Math.min(p.tB + d.T, tNow) : 0;
    const aFrontT = Math.max(0, Math.min(d.tau, tNow));         /* 甲的前沿轨迹画到哪 */
    const bFrontT = Math.max(0, Math.min(p.tC, tNow));
    const jamDownT = Math.max(0, Math.min(p.tDetect, tNow));
    const jamUpT = Math.max(0, Math.min(p.tJamB, tNow));
    /* 短帧：甲在检测时刻之前就发完了 → 检测不到 */
    const missed = !d.okDetect && tNow >= p.tDetect;
    const detState = tNow >= p.tDetect ? (d.okDetect ? 'ok' : 'miss') : (tNow >= p.tC ? 'colliding' : 'sending');
    return {
      step: e.key === 'done' ? 'done' : (e.key === 'init' ? 'init' : 'evt'),
      kind: 'detect',
      /* —— 参数与派生量（全量携带，渲染端只读快照）—— */
      scene: model.scene, sceneShort: _CS_SCENES.detect.short, sceneName: _CS_SCENES.detect.name,
      rate: model.rate, dist: model.dist, hubDelay: model.hubDelay, frameLenB: d.frameBytes,
      v: _CS_V,
      tProp: d.tProp, tau: d.tau, distEff: d.distEff, win: d.win,
      minBits: d.minBits, minBytes: d.minBytes, frameBits: d.frameBits, T: d.T,
      okDetect: d.okDetect, padBytes: d.padBytes, padBits: d.padBits,
      maxRTT: d.maxRTT,
      /* —— 时间轴几何 —— */
      tB: p.tB, tC: p.tC, xC: p.xC, tDetect: p.tDetect, tJamB: p.tJamB, delta: p.delta,
      tEnd, tNow, aSendEnd, bSendEnd, aFrontT, bFrontT, jamDownT, jamUpT,
      showCollide: tNow >= p.tC, showDetect: tNow >= p.tDetect, showJam: tNow >= p.tC,
      stopped: tNow >= tStop, missed, detState,
      events: events.map((x, i) => ({ i, ev: x.ev, t: x.t, tone: x.tone, note: x.note, done: i < idx, cur: i === idx })),
      curEvent: e.ev, curIdx: idx,
      tNow_: tNow,
      log: `[${_CS_SCENES.detect.short}] ${e.ev}（t = ${_csNum(tNow)} μs）`,
      logType: e.tone,
      desc: _csDetectDesc(d, p, e, tNow, missed),
      model: { ...model },
      ...extra,
    };
  };

  const snaps = events.map((e, i) => snap(i));
  return snaps;
}

/** detect 场景每帧的解说（纯函数，便于冒烟直接验文案里的数字） */
function _csDetectDesc(d, p, e, tNow, missed) {
  const head = `第 ${e.key === 'init' ? 0 : 1} 步：${e.ev}（t = ${_csNum(tNow)} μs）。`;
  if (e.key === 'init') {
    return `${head} 单程传播时延 τ = 距离/速率 + 设备延时 = ${_csNum(d.tProp)} + ${_csNum(d.hubDelay)}`
      + ` = ${_csNum(d.tau)} μs，争用期 2τ = ${_csNum(d.win)} μs；最小帧长 = 2τ × 数据率 = ${_csNum(d.win)} × ${_csNum(d.rate)}`
      + ` = ${_csNum(d.minBits)} bit = ${_csNum(d.minBytes)} B。本帧 ${_csNum(d.frameBytes)} B，发送时延 T = ${_csNum(d.T)} μs。`;
  }
  if (!d.okDetect) {
    return `${head} T = ${_csNum(d.T)} μs 比争用期 2τ = ${_csNum(d.win)} μs 短，甲会在 ${_csNum(d.T)} μs 就把帧发完，`
      + `而冲突信号要到 ${_csNum(p.tDetect)} μs 才回到甲${missed ? '——已经晚了，这次冲突检测不到' : ''}。`
      + `要把帧补到 ${_csNum(d.minBytes)} B（再填 ${_csNum(d.padBytes)} B）。`;
  }
  return `${head} 甲最迟在 ${_csNum(p.tDetect)} μs 检测到冲突，而帧要到 T = ${_csNum(d.T)} μs 才发完，`
    + `因为 T ≥ 2τ = ${_csNum(d.win)} μs，甲还在发送，所以能听到这次冲突。`;
}

/* ---------------- ⑤ 快照：backoff 场景 ---------------- */
function _csBackoffSnaps(model) {
  const d = _csDerive(model);
  const n = Math.max(1, Math.min(_CS_MAX_I, model.collisions));
  const rows = [];
  for (let i = 1; i <= _CS_MAX_I; i++) rows.push(_csBackoffRow(i, d.win));
  const last = _csBackoffRow(n, d.win);

  const frames = [{ key: 'init', i: 0 }];
  for (let i = 1; i <= n; i++) frames.push({ key: 'i', i });
  frames.push({ key: 'done', i: n });

  return frames.map((f, idx) => {
    const cur = f.i >= 1 ? _csBackoffRow(f.i, d.win) : null;
    const capped = f.i > 10;
    const done = f.key === 'done';
    const rowState = i => {
      if (!f.i) return 'future';
      if (done) return i <= f.i ? 'done' : 'future';
      return i < f.i ? 'done' : (i === f.i ? 'cur' : 'future');
    };
    const logText = f.key === 'init'
      ? `[指数退避] 准备：争用期（= 时隙）= ${_csNum(d.win)} μs，共演示到第 ${n} 次冲突`
      : `[指数退避] 第 ${f.i} 次冲突：k = min(${f.i},10) = ${cur.k}，可等 ${cur.slots} 种时隙（0 ~ ${cur.kMax}），最长 ${_csNum(cur.maxWait)} μs`;
    return {
      step: done ? 'done' : (f.key === 'init' ? 'init' : 'evt'),
      kind: 'backoff',
      scene: model.scene, sceneShort: _CS_SCENES.backoff.short, sceneName: _CS_SCENES.backoff.name,
      rate: model.rate, dist: model.dist, hubDelay: model.hubDelay, frameLenB: d.frameBytes,
      v: _CS_V, tProp: d.tProp, tau: d.tau, distEff: d.distEff, win: d.win,
      minBits: d.minBits, minBytes: d.minBytes, frameBits: d.frameBits, T: d.T,
      okDetect: d.okDetect, padBytes: d.padBytes, padBits: d.padBits, maxRTT: d.maxRTT,
      totalI: n, curI: f.i, cur, capped,
      rowState, rows: rows.map(r => ({ ...r, state: rowState(r.i) })),
      log: logText,
      logType: done ? 'success' : (capped ? 'warn' : 'info'),
      desc: _csBackoffDesc(d, f, cur, n, capped),
      model: { ...model },
    };
  });
}

function _csBackoffDesc(d, f, cur, n, capped) {
  if (f.key === 'init') {
    return `冲突之后不能马上重发（否则又会撞）。二进制指数退避：第 i 次冲突后从整数集合 {0, 1, …, 2^k − 1} 里随机取一个数 K，`
      + `等待 K 个时隙再重发，其中 k = min(i,10)。本模块的时隙 = 争用期 2τ = ${_csNum(d.win)} μs。`
      + `下面逐次演示到第 ${n} 次冲突。`;
  }
  if (f.key === 'done') {
    return `结论：第 ${n} 次冲突时 k = min(${n},10) = ${cur.k}，时隙取值 0 ~ ${cur.kMax}（共 ${cur.slots} 种），`
      + `最长等待 = ${cur.kMax} × ${_csNum(d.win)} = ${_csNum(cur.maxWait)} μs，平均等待 = ${_csNum(cur.avgWait)} μs。`
      + `冲突次数越多，可选的等待区间按 2 的幂翻倍${n > 10 ? '；超过 10 次后 k 封顶在 10，不再翻倍' : ''}。`;
  }
  return `第 ${f.i} 次冲突：k = min(${f.i},10) = ${cur.k} ⟹ 从 {0, 1, …, ${cur.kMax}} 这 ${cur.slots} 个数里随机取 K，`
    + `等待 K × ${_csNum(d.win)} μs。最长等待 = ${cur.kMax} × ${_csNum(d.win)} = ${_csNum(cur.maxWait)} μs`
    + `（平均 ${_csNum(cur.avgWait)} μs）。`
    + (capped ? `注意：k 已经封顶在 10，再多的冲突也不会让等待区间继续翻倍（802.3 最多重传 ${_CS_MAX_I} 次后丢弃）。` : '');
}

/* ---------------- ⑥ 快照：ca 场景 ---------------- */
function _csCaSnaps(model) {
  const d = _csDerive(model);
  const ca = _CS_CA;
  const tData = d.T;
  /* 段顺序：DIFS → RTS → SIFS → CTS → SIFS → 数据 → SIFS → ACK */
  const raw = [
    { key: 'DIFS', t: ca.DIFS, c: '#cbd5e1', who: '信道', note: '最长的帧间间隔：要发就先听满 DIFS' },
    { key: 'RTS', t: ca.RTS, c: '#818cf8', who: '甲', note: '请求发送（预约信道）' },
    { key: 'SIFS', t: ca.SIFS, c: '#fcd34d', who: 'AP', note: '最短的帧间间隔：应答优先' },
    { key: 'CTS', t: ca.CTS, c: '#34d399', who: 'AP', note: '允许发送；其中的 NAV 让隐藏站静默' },
    { key: 'SIFS', t: ca.SIFS, c: '#fcd34d', who: '甲', note: '等 SIFS 后开始发数据帧' },
    { key: '数据', t: tData, c: '#6366f1', who: '甲', note: '数据帧发送时延 = 帧长 ÷ 数据率' },
    { key: 'SIFS', t: ca.SIFS, c: '#fcd34d', who: 'AP', note: '等 SIFS 后回 ACK' },
    { key: 'ACK', t: ca.ACK, c: '#f472b6', who: 'AP', note: '确认；收到它一次传输才结束' },
  ];
  const total = raw.reduce((a, x) => a + x.t, 0);
  /* NAV（隐藏站视角）= CTS 之后的 SIFS + 数据 + SIFS + ACK */
  const nav = ca.SIFS + tData + ca.SIFS + ca.ACK;
  /* 发送方"从开始（听 DIFS）到被确认" = DIFS + 数据 + SIFS（2026-35 的口径） */
  const sendTotal = ca.DIFS + tData + ca.SIFS;
  let acc = 0;
  const segs = raw.map((x, i) => { const s = { ...x, i, t0: acc, t1: acc + x.t }; acc += x.t; return s; });
  /* NAV 覆盖的段：索引 4..7（SIFS / 数据 / SIFS / ACK） */
  const navT0 = segs[2].t1 + segs[3].t;      /* CTS 结束 */
  const navT1 = total;

  const frames = [{ key: 'init' }].concat(segs.map(s => ({ key: 'seg', i: s.i }))).concat([{ key: 'done' }]);
  return frames.map((f, idx) => {
    const upto = f.key === 'init' ? 0 : (f.key === 'done' ? segs.length + 1 : f.i + 1);
    const cur = f.key === 'seg' ? segs[f.i] : null;
    const logText = f.key === 'init'
      ? `[CSMA/CA] 准备：数据帧 ${_csNum(d.frameBytes)} B ÷ ${_csNum(d.rate)} Mb/s = ${_csNum(tData)} μs`
      : f.key === 'done'
        ? `[CSMA/CA] 完成：NAV = ${_csNum(nav)} μs，整次传输 ${_csNum(total)} μs`
        : `[CSMA/CA] 第 ${f.i + 1} 段 ${cur.key}：${_csNum(cur.t)} μs（累计 ${_csNum(cur.t1)} μs）`;
    return {
      step: f.key === 'done' ? 'done' : (f.key === 'init' ? 'init' : 'evt'),
      kind: 'ca',
      scene: model.scene, sceneShort: _CS_SCENES.ca.short, sceneName: _CS_SCENES.ca.name,
      rate: model.rate, dist: model.dist, hubDelay: model.hubDelay, frameLenB: d.frameBytes,
      v: _CS_V, tProp: d.tProp, tau: d.tau, distEff: d.distEff, win: d.win,
      minBits: d.minBits, minBytes: d.minBytes, frameBits: d.frameBits, T: d.T,
      okDetect: d.okDetect, padBytes: d.padBytes, padBits: d.padBits, maxRTT: d.maxRTT,
      ca: { ...ca }, tData, total, nav, sendTotal, navT0, navT1,
      segs: segs.map(s => ({ ...s, state: s.i < upto - 1 ? 'done' : (s.i === upto - 1 ? 'cur' : 'future'), upto })),
      upto, total1: total,
      log: logText,
      logType: f.key === 'done' ? 'success' : 'info',
      desc: _csCaDesc(d, f, cur, tData, nav, total, sendTotal),
      model: { ...model },
    };
  });
}

function _csCaDesc(d, f, cur, tData, nav, total, sendTotal) {
  if (f.key === 'init') {
    return `CSMA/CA 不能"边发边检"（发的时候听不到别人），所以改成避免冲突：先听满 DIFS，再退避，然后 RTS/CTS 预约。`
      + `本帧 ${_csNum(d.frameBytes)} B ÷ ${_csNum(d.rate)} Mb/s = 数据帧发送时延 ${_csNum(tData)} μs。`
      + `一次完整传输 = DIFS + RTS + SIFS + CTS + SIFS + 数据 + SIFS + ACK = ${_csNum(total)} μs（下图按真实比例画）。`;
  }
  if (f.key === 'done') {
    return `结论：NAV = SIFS + 数据帧发送时延 + SIFS + ACK = ${_csNum(nav)} μs（隐藏站收到 CTS 后按它静默）；`
      + `发送方"从听 DIFS 到被确认" = DIFS + 数据 + SIFS = ${_csNum(sendTotal)} μs。`
      + `整次传输 ${_csNum(total)} μs = DIFS + RTS + SIFS + CTS + NAV。`;
  }
  return `第 ${f.i + 1} 段：${cur.key} = ${_csNum(cur.t)} μs（${cur.who}）：${cur.note}。`
    + `累计到 ${_csNum(cur.t1)} μs；NAV 从 CTS 结束算起，共 ${_csNum(nav)} μs。`;
}

RC408.registerModule({
  id: 'net-csma',
  mode: 'stepper',
  title: 'CSMA/CD 与最小帧长（争用期 · 冲突检测 · 二进制指数退避 · CSMA/CA）',

  theory: `
> **为什么要有它**：以太网是**共享总线**，多个站点可能同时发送，**冲突无法避免**；CSMA/CD 用"先听后发、边发边听、冲突停发、随机重发"把冲突的代价压到最小，而"至少要发多久才听得见冲突"就决定了**最小帧长**。
> **怎么实现**：要"边发边听"，帧的**发送时延就不能短于争用期**——令 帧长 ÷ 数据率 ≥ 2τ，就得到 **最小帧长 = 2τ × 数据率**；冲突后按**二进制指数退避**随机等 K 个争用期再重发。
> **记住什么**：主线公式（知三求一）+ **争用期 = 2 × 单程传播时延**（Hub / 中继器的额外延时也要算进 τ）+ 第 i 次冲突取 \\(k = \\min(i,10)\\) + CSMA/CA 的 DIFS / SIFS 与 NAV。

## 一、一条主线：为什么"发够久"才听得见冲突
站点一边发一边听，而信号在最远端走一个单程要 τ：
- 甲在 t = 0 开始发送；乙**在甲的信号到达之前**抢发（它监听时信道还是空的）→ 冲突；
- 冲突信号还要再花一个单程才能回到甲 ⟹ 甲**最迟 2τ** 才听到冲突——这就是**争用期（碰撞窗口）**（2010-47 大题问的"最短 t、最长 2τ"）；
- 若甲在 2τ 之前就把帧发完了（发送时延 T < 2τ），它就**永远听不到**这次冲突 ⟹ 所以必须 **T ≥ 2τ**。

## 二、主线公式（知三求一）
| 量 | 式子 | 单位提示 |
| --- | --- | --- |
| 单程传播时延 τ | τ = 距离 ÷ 传播速率 + 设备（Hub / 中继器）延时 | 传播速率取 200 m/μs，τ 得 μs |
| 争用期（碰撞窗口） | 2τ | **退避时隙 = 争用期** |
| **最小帧长** | 2τ × 数据率 | 数据率按 Mb/s 取值时结果直接是 **bit**（1 Mb/s = 1 bit/μs） |
| 帧发送时延 T | 帧长 ÷ 数据率 | 与 2τ 比大小就是"够不够长" |

- 10 Mb/s 以太网取 **争用期 51.2 μs**（相当于 5120 m 的总线长度）⟹ 最小帧长 **512 bit = 64 B**；
- **64 B 里含 18 B 帧头帧尾**（目的 MAC 6 + 源 MAC 6 + 类型 2 + FCS 4）⟹ **数据字段最少 46 B**（2012-47 就是按"分组总长 40 B 小于 46 B，所以要填充"判的）；
- 数据率提高 10 倍而最小帧长不变 ⟹ 争用期必须缩到 1/10：把网段缩到 1/10，或改**全双工**（全双工下不存在冲突）。

## 三、二进制指数退避（冲突之后等多久）
第 i 次冲突后，从整数集合 \\(\\{0,1,\\dots,2^{k}-1\\}\\) 里随机取一个数 K，就等待 K 个时隙再重发，其中 \\(k = \\min(i,10)\\)：
| 第几次冲突 | k 上限 | 时隙取值 | 最长等待（时隙 × 51.2 μs） |
| --- | --- | --- | --- |
| 1 | 1 | 0 ~ 1 | 51.2 μs |
| 4 | 4 | 0 ~ 15 | **768 μs**（2023-36 的答案） |
| 10 | 10 | 0 ~ 1023 | 52.3776 ms |
| 11 及以上 | 10（封顶） | 0 ~ 1023 | 52.3776 ms（不再翻倍） |

## 四、CSMA/CA：无线为什么不能"边发边检"
无线站点**发送时听不到别人**（自己的信号太强），所以改成**避免冲突**：
- 先听满 **DIFS**（最长的帧间间隔）→ 信道空闲再退避 → 发 **RTS**，AP 回 **CTS**；听到 CTS 的隐藏站按 **NAV** 静默；
- **NAV = SIFS + 数据帧发送时延 + SIFS + ACK**（2024-36：28 + 296 + 28 + 2 = 354 μs）；
- 发送方"从开始到被确认" = **DIFS + 数据帧 + SIFS**（2026-35：128 + 40 + 28 = 196 μs ≈ 200 μs）。

## 考点提醒（易错点）
1. **单程 τ 与双程 2τ**：判断"能不能检测到冲突"一律用 **2τ**；题里给"单向传播时延"时先 ×2；
2. **Hub / 中继器的延时必须算进 τ**（2016-36、2022-47）：τ = 介质传播时延 + 设备延时，漏掉它算出来的距离会偏大；
3. **退避时隙 = 争用期 = 2τ**，不是 τ——差 2 倍（2023-36：15 个时隙 × 51.2 μs = 768 μs）；
4. **64 B 是帧长、46 B 是数据**：题干说"帧长 / 总长度"按 64 B 判，说"数据 / 有效载荷"按 46 B 判；
5. **CSMA/CD 与 CSMA/CA 的分工**：有线可以边发边检 ⟹ 冲突**检测**；无线听不到 ⟹ 用 IFS + RTS/CTS 预约 + NAV 冲突**避免**（2011-36、2018-35、2020-37）。

> **真题考情**：**15/18 年（选 12 + 大题 3）**——选 2009-37、2011-36、2013-36、2015-36、2016-36、2018-35、
> 2019-36、2020-37、2023-36、2024-36、2025-35、2026-35；大 2010-47、2012-47、2022-47（最小帧长 / 退避 / NAV 计算）。
`,

  /* ---------------- 输入表单（每项都必须显式给 default，见 §3.8-11） ---------------- */
  inputs: [
    {
      key: 'scene', label: '演示场景', type: 'select', default: 'detect',
      options: [
        { v: 'detect', t: '① 冲突检测全过程（时空图：帧够长 / 帧太短）' },
        { v: 'backoff', t: '② 二进制指数退避（第 i 次冲突等多久）' },
        { v: 'ca', t: '③ CSMA/CA 时间组成（DIFS / SIFS / NAV）' },
      ],
      help: '① 用数据率 / 距离 / 设备延时 / 帧长；② 只用冲突次数（时隙由争用期定）；③ 只用数据率与数据帧长',
    },
    {
      key: 'rate', label: '数据率（Mb/s）', type: 'select', default: '10',
      options: [
        { v: '10', t: '10 Mb/s（标准以太网，争用期 51.2 μs）' },
        { v: '54', t: '54 Mb/s（802.11g，2024-36 用）' },
        { v: '100', t: '100 Mb/s（快速以太网，2016-36 / 2022-47 用）' },
        { v: '300', t: '300 Mb/s（802.11n，2026-35 用）' },
        { v: '1000', t: '1000 Mb/s（千兆，2009-37 用）' },
      ],
      help: '换算靠这条恒等式：1 Mb/s = 1 bit/μs',
    },
    {
      key: 'dist', label: '两站间介质距离（m，单程）', type: 'text', default: '5120',
      help: '信号传播速率取 200 m/μs；5120 m ⟹ τ = 25.6 μs ⟹ 争用期 51.2 μs（教材标准情形）',
    },
    {
      key: 'hubDelay', label: 'Hub / 中继器额外延时（μs，可填 0）', type: 'text', default: '0',
      help: '2016-36 填 1.535、2022-47 填 1.51：设备延时也要算进 τ',
    },
    {
      key: 'frameLen', label: '帧长（字节 B）', type: 'text', default: '64',
      help: '① 场景里就是"数据帧总长度"；③ 场景里是 CSMA/CA 的数据帧长',
    },
    {
      key: 'collisions', label: '②场景：连续冲突次数 i（1~16）', type: 'text', default: '4',
      help: '第 i 次冲突取 k = min(i,10)；默认 4 次 ⟹ 最长等待 15 × 51.2 = 768 μs（2023-36）',
    },
  ],

  /* ---------------- 真题 / 教材预设 ---------------- */
  quickActions: [
    { label: '📘 教材标准 10 Mb/s（最小帧长 64 B）', run(rt) { rt.setInput('scene', 'detect'); rt.setInput('rate', '10'); rt.setInput('dist', '5120'); rt.setInput('hubDelay', '0'); rt.setInput('frameLen', '64'); rt.load(); } },
    { label: '📘 帧太短 32 B（检测不到冲突 → 要填充）', run(rt) { rt.setInput('scene', 'detect'); rt.setInput('rate', '10'); rt.setInput('dist', '5120'); rt.setInput('hubDelay', '0'); rt.setInput('frameLen', '32'); rt.load(); } },
    { label: '📘 2022-47 大题：100BaseT + Hub 1.51 μs ⟹ 最远 210 m', run(rt) { rt.setInput('scene', 'detect'); rt.setInput('rate', '100'); rt.setInput('dist', '210'); rt.setInput('hubDelay', '1.51'); rt.setInput('frameLen', '64'); rt.load(); } },
    { label: '📘 2016-36：100BaseT + Hub 1.535 μs ⟹ 205 m', run(rt) { rt.setInput('scene', 'detect'); rt.setInput('rate', '100'); rt.setInput('dist', '205'); rt.setInput('hubDelay', '1.535'); rt.setInput('frameLen', '64'); rt.load(); } },
    { label: '📘 2023-36：连续 4 次冲突 ⟹ 最长 768 μs', run(rt) { rt.setInput('scene', 'backoff'); rt.setInput('rate', '10'); rt.setInput('dist', '5120'); rt.setInput('hubDelay', '0'); rt.setInput('collisions', '4'); rt.load(); } },
    { label: '📘 2024-36：NAV = SIFS + 数据 + SIFS + ACK = 354 μs', run(rt) { rt.setInput('scene', 'ca'); rt.setInput('rate', '54'); rt.setInput('frameLen', '1998'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const scene = String(vals.scene == null ? '' : vals.scene);
    if (!_CS_SCENES[scene]) {
      throw { message: `场景「${scene}」不存在：可选 ① 冲突检测 ② 二进制指数退避 ③ CSMA/CA。` };
    }
    const rate = Number(vals.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw { message: `数据率「${vals.rate}」无效：请填正数（Mb/s）。` };
    const dist = Number(vals.dist);
    if (!Number.isFinite(dist) || dist < 0) throw { message: `距离「${vals.dist}」无效：请填不小于 0 的数（m）。` };
    const hubDelay = Number(vals.hubDelay);
    if (!Number.isFinite(hubDelay) || hubDelay < 0) throw { message: `设备延时「${vals.hubDelay}」无效：请填不小于 0 的数（μs）。` };
    const frameLenB = Number(vals.frameLen);
    if (!Number.isFinite(frameLenB) || frameLenB <= 0) throw { message: `帧长「${vals.frameLen}」无效：请填正数（字节）。` };
    const collisions = Math.round(Number(vals.collisions));
    if (!Number.isFinite(collisions) || collisions < 1 || collisions > _CS_MAX_I) {
      throw { message: `冲突次数「${vals.collisions}」无效：请填 1 ~ ${_CS_MAX_I} 之间的整数。` };
    }
    if (dist <= 0 && hubDelay <= 0) {
      throw { message: '距离与设备延时不能同时为 0：这样单程传播时延 τ = 0，争用期为 0，题目没有意义。' };
    }
    if (dist > 200000) throw { message: `距离「${vals.dist}」太大：请填不超过 200000 m 的值。` };
    if (frameLenB > 65535) throw { message: `帧长「${vals.frameLen}」太大：请填不超过 65535 B 的值。` };
    return {
      scene, rate, dist, hubDelay, frameLenB, collisions,
      v: _CS_V,
      rateText: _csNum(rate), distText: _csNum(dist), hubText: _csNum(hubDelay),
      frameText: _csNum(frameLenB), collText: String(collisions),
    };
  },

  /* ---------------- ② 纯算法：模型 → 快照 ---------------- */
  buildSnapshots(model) {
    if (model.scene === 'backoff') return _csBackoffSnaps(model);
    if (model.scene === 'ca') return _csCaSnaps(model);
    return _csDetectSnaps(model);
  },

  /* ---------------- ③ 纯渲染：只读快照 ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    if (s.kind === 'backoff') return _csRenderBackoff(s, stage);
    if (s.kind === 'ca') return _csRenderCa(s, stage);
    return _csRenderDetect(s, stage);
  },
});

/* ============================================================================
 * 渲染：detect（时空图：横轴时间、纵轴位置，A 端在下、B 端在上）
 * ========================================================================== */
function _csRenderDetect(s, stage) {
  const W = 1000, PX0 = 152, PX1 = 972, PY0 = 46, PY1 = 300;
  const H = PY1 + 96;
  const xOf = t => PX0 + (t / s.tEnd) * (PX1 - PX0);
  const yOf = x => PY1 - (x / s.distEff) * (PY1 - PY0);
  const PV = x => yOf(Math.max(0, Math.min(s.distEff, x)));

  /* ---- 争用期带（横跨整个绘图区高度） ---- */
  const winBand = `
    <rect x="${xOf(0)}" y="${PY0}" width="${Math.max(0, xOf(s.win) - xOf(0))}" height="${PY1 - PY0}"
      fill="#fef3c7" opacity="0.55"/>
    <text class="cs-band-text" x="${xOf(0) + 6}" y="${PY0 + 14}" style="font:800 10.5px sans-serif" fill="#b45309">争用期 2τ = ${_csNum(s.win)} μs（甲必须还在发）</text>`;

  /* ---- 等效长度 vs 真实介质长度（只有设备延时 > 0 才画） ---- */
  let hubZone = '';
  if (s.hubDelay > 0) {
    const yTop = yOf(s.distEff), yBot = yOf(s.dist);
    hubZone = `
      <rect x="${PX0}" y="${yTop}" width="${PX1 - PX0}" height="${Math.max(2, yBot - yTop)}"
        fill="#e0e7ff" opacity="0.7" stroke="#a5b4fc" stroke-width="1" stroke-dasharray="5 4"/>
      <text class="cs-band-text" x="${PX0 + 6}" y="${(yTop + yBot) / 2 + 4}" style="font:700 10px sans-serif" fill="#4338ca">Hub / 中继器延时 ${_csNum(s.hubDelay)} μs 折算成长度 ${_csNum(s.distEff - s.dist)} m</text>
      <line x1="${PX0}" y1="${yBot}" x2="${PX1}" y2="${yBot}" stroke="#6366f1" stroke-width="1" stroke-dasharray="3 3"/>
      <text class="cs-band-text" x="${PX1 - 6}" y="${yBot + 13}" text-anchor="end" style="font:700 10px sans-serif" fill="#4338ca">真实介质距离 = ${_csNum(s.dist)} m（实际要配的就是它）</text>`;
  }

  /* ---- 时间刻度：0 / τ / 2τ（+ T 若与 2τ 明显不同）；标签太挤就只保留线不保留字 ---- */
  const ticks = [{ t: 0, l: '0' }, { t: s.tau, l: `τ=${_csNum(s.tau)}` }, { t: s.win, l: `2τ=${_csNum(s.win)}` }];
  if (Math.abs(s.T - s.win) > 0.05 * s.win) ticks.push({ t: s.T, l: `T=${_csNum(s.T)}` });
  let lastLx = -1e9;
  const tickEls = ticks.map(k => {
    const x = xOf(k.t);
    const keep = x - lastLx >= 46;                 /* 距上一个保留的标签不足 46px 就不写字（避免互压） */
    if (keep) lastLx = x;
    return `<line class="cs-tick" x1="${x}" y1="${PY0}" x2="${x}" y2="${PY1}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 4"/>`
      + (keep ? `<text class="cs-tick-text" x="${x}" y="${PY1 + 16}" text-anchor="middle" style="font:700 10px Consolas,monospace" fill="#64748b">${k.l}</text>` : '');
  }).join('');

  /* ---- 轴 ---- */
  const axis = `
    <text class="cs-head" x="14" y="${PY0 + 4}" style="font:800 11px sans-serif" fill="${_CS_COLOR.b}">乙（B 端）</text>
    <text class="cs-head" x="14" y="${PY1 + 4}" style="font:800 11px sans-serif" fill="${_CS_COLOR.a}">甲（A 端）</text>
    <text class="cs-band-text" x="14" y="${(PY0 + PY1) / 2 + 4}" style="font:700 9.5px sans-serif" fill="#94a3b8">等效长度</text>
    <text class="cs-band-text" x="14" y="${PY1 + 32}" style="font:700 9.5px sans-serif" fill="#94a3b8">时间 μs</text>
    <line x1="${PX0}" y1="${PY0}" x2="${PX1}" y2="${PY0}" stroke="#cbd5e1" stroke-width="1.6"/>
    <line x1="${PX0}" y1="${PY1}" x2="${PX1}" y2="${PY1}" stroke="#cbd5e1" stroke-width="1.6"/>
    <line x1="${PX0}" y1="${PY0}" x2="${PX0}" y2="${PY1}" stroke="${s.showCollide ? _CS_COLOR.a : '#e2e8f0'}" stroke-width="3.4" stroke-linecap="round"/>`;

  /* ---- 甲 / 乙 的发送区间（横线：位置不变、时间在走） ---- */
  const aBar = s.aSendEnd > 0
    ? `<line class="cs-send" x1="${xOf(0)}" y1="${PY1}" x2="${xOf(s.aSendEnd)}" y2="${PY1}" stroke="${_CS_COLOR.a}" stroke-width="3.4" stroke-linecap="round"/>`
    : '';
  const bBar = s.tNow >= s.tB
    ? `<line class="cs-send" x1="${xOf(s.tB)}" y1="${PY0}" x2="${xOf(Math.max(s.bSendEnd, s.tB))}" y2="${PY0}" stroke="${_CS_COLOR.b}" stroke-width="3.4" stroke-linecap="round"/>`
    : '';

  /* ---- 前沿轨迹（斜线） ---- */
  const aFront = s.aFrontT > 0 ? `
    <line class="cs-arrow" x1="${xOf(0)}" y1="${PY1}" x2="${xOf(s.aFrontT)}" y2="${PV(_CS_V * s.aFrontT)}"
      stroke="${_CS_COLOR.a}" stroke-width="2.4"/>` : '';
  const bFront = s.bFrontT > 0 ? `
    <line class="cs-arrow" x1="${xOf(s.tB)}" y1="${PY0}" x2="${xOf(s.bFrontT)}" y2="${PV(s.distEff - _CS_V * (s.bFrontT - s.tB))}"
      stroke="${_CS_COLOR.b}" stroke-width="2.4"/>` : '';

  /* ---- 冲突信号：从冲突点向两端回传 ---- */
  let jam = '';
  if (s.showJam) {
    const xd = s.xC - _CS_V * (s.jamDownT - s.tC);
    const xu = s.xC + _CS_V * (s.jamUpT - s.tC);
    jam = `
      <line class="cs-arrow cs-jam" x1="${xOf(s.tC)}" y1="${PV(s.xC)}" x2="${xOf(s.jamDownT)}" y2="${PV(Math.max(0, xd))}"
        stroke="${_CS_COLOR.jam}" stroke-width="2.6" stroke-dasharray="7 4"/>
      <line class="cs-arrow cs-jam" x1="${xOf(s.tC)}" y1="${PV(s.xC)}" x2="${xOf(s.jamUpT)}" y2="${PV(Math.min(s.distEff, xu))}"
        stroke="${_CS_COLOR.jam}" stroke-width="2.6" stroke-dasharray="7 4"/>`;
  }

  /* ---- 关键点标记（标签会自动避让右边界） ---- */
  const markCollide = s.showCollide
    ? `<circle class="cs-mark" cx="${xOf(s.tC)}" cy="${PV(s.xC)}" r="4.5" fill="${_CS_COLOR.jam}" stroke="#fff" stroke-width="1.6"/>`
      + _csLabel(xOf(s.tC) + 8, PV(s.xC) - 6, `冲突点 t = ${_csNum(s.tC)} μs`, _CS_COLOR.jam, PX1)
    : '';
  const markDetect = s.showDetect
    ? `<circle class="cs-mark" cx="${xOf(s.tDetect)}" cy="${PY1}" r="4.5" fill="${s.okDetect ? _CS_COLOR.jam : '#64748b'}" stroke="#fff" stroke-width="1.6"/>`
      + _csLabel(xOf(s.tDetect) + 8, PY1 - 8, `检测到冲突 t = ${_csNum(s.tDetect)} μs`, s.okDetect ? _CS_COLOR.jam : '#475569', PX1)
    : '';
  const missNote = s.missed
    ? _csLabel(xOf(s.T) + 8, PY1 - 26, `✗ 甲 ${_csNum(s.T)} μs 就发完了，冲突信号还没回来`, '#e11d48', PX1)
    : '';

  /* ---- 统计卡 ---- */
  const verdict = s.okDetect
    ? `<span class="text-emerald-600">够长 ✓</span>`
    : `<span class="text-rose-600">太短 ✗</span>`;
  const card2 = `${_csNum(s.minBytes)} B`;
  const card3 = `${_csNum(s.T)} μs`;

  /* ---- 事件表 ---- */
  const evRows = s.events.map(e => {
    const cls = e.cur ? 'bg-amber-50' : (e.done ? 'bg-white' : 'bg-slate-50');
    const tc = e.cur ? 'text-amber-700 font-extrabold' : (e.done ? 'text-slate-700' : 'text-slate-300');
    return `<tr class="${cls}">
      <td class="py-1 pr-2 font-mono text-[11px] ${e.done || e.cur ? 'text-slate-600' : 'text-slate-300'}">${_csNum(e.t)}</td>
      <td class="py-1 px-1 text-[11px] ${tc}">${e.cur ? '▶ ' : ''}${e.ev}</td>
      <td class="py-1 pl-2 text-[11px] ${e.done || e.cur ? 'text-slate-500' : 'text-slate-300'}">${e.note}</td>
    </tr>`;
  }).join('');

  /* ---- 公式链卡 ---- */
  const formulaRows = [
    { k: '单程传播时延 τ', v: `距离 ${_csNum(s.dist)} m ÷ 200 m/μs${s.hubDelay > 0 ? ` + Hub ${_csNum(s.hubDelay)} μs` : ''} = ${_csNum(s.tau)} μs` },
    { k: '等效总线长度 v × τ', v: `200 × ${_csNum(s.tau)} = ${_csNum(s.distEff)} m` },
    { k: '争用期（碰撞窗口）2τ', v: `2 × ${_csNum(s.tau)} = ${_csNum(s.win)} μs` },
    { k: '最小帧长 2τ × 数据率', v: `${_csNum(s.win)} × ${_csNum(s.rate)} = ${_csNum(s.minBits)} bit = ${_csNum(s.minBytes)} B` },
    { k: '本帧发送时延 T', v: `${_csNum(s.frameLenB)} B × 8 ÷ ${_csNum(s.rate)} = ${_csNum(s.T)} μs` },
    { k: '能不能检测到冲突', v: `T ${s.okDetect ? '≥' : '<'} 2τ（${_csNum(s.T)} ${s.okDetect ? '≥' : '<'} ${_csNum(s.win)}）⟹ ${s.okDetect ? '能' : `不能，须填充 ${_csNum(s.padBytes)} B 到 ${_csNum(s.minBytes)} B`}` },
  ].map(r => `<tr>
      <td class="py-1 pr-2 text-[11px] text-slate-500 whitespace-nowrap">${r.k}</td>
      <td class="py-1 pl-2 text-[11px] font-bold font-mono text-slate-700">${r.v}</td>
    </tr>`).join('');

  stage.innerHTML = `
    <div class="space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
          ${winBand}${hubZone}${tickEls}${axis}${aFront}${bFront}${jam}${aBar}${bBar}${markCollide}${markDetect}${missNote}
        </svg>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        ${RC408.ui.statCard('争用期 2τ', `${_csNum(s.win)} μs`, `单程 τ = ${_csNum(s.tau)} μs（含设备延时）`, 'text-amber-700')}
        ${RC408.ui.statCard('最小帧长', card2, `${_csNum(s.minBits)} bit = 2τ × 数据率`, 'text-indigo-700')}
        ${RC408.ui.statCard('本帧发送时延 T', card3, `帧长 ${_csNum(s.frameLenB)} B ÷ ${_csNum(s.rate)} Mb/s`, 'text-slate-800')}
        ${RC408.ui.statCard('T 与 2τ 之比', verdict, s.okDetect ? '帧够长：听得见冲突' : `帧太短：要填充 ${_csNum(s.padBytes)} B`, s.okDetect ? 'text-emerald-600' : 'text-rose-600')}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('时间轴事件表（横轴 = 时间，纵轴 = 位置；斜线 = 信号前沿）')}
          <table class="w-full text-sm">
            <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100">
              <th class="text-left py-1 pr-2 font-bold">t (μs)</th>
              <th class="text-left py-1 px-1 font-bold">事件</th>
              <th class="text-left py-1 pl-2 font-bold">说明</th>
            </tr></thead>
            <tbody>${evRows}</tbody>
          </table>
          <p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
            两张图的关系：<b>竖着看</b>是"某一时刻信号走到哪"（同一时刻两条前沿的位置），
            <b>横着看</b>是"某个站点在发送"（甲 / 乙 在 y 轴两端的那条粗线）。
            冲突信号从相遇点向两端回传，回到甲所用的时间与去程相同 ⟹ 甲最迟 <b>2τ</b> 听到冲突。
          </p>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          ${RC408.ui.sectionTitle('本帧算什么（知三求一）')}
          <table class="w-full text-sm"><tbody>${formulaRows}</tbody></table>
          <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
            <b>本帧发生了什么</b>：${s.desc}
          </div>
        </div>
      </div>

      <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
        💡 <b>一句话记住：</b>争用期 <b>2τ</b> 是"最坏情况下来回一趟"的时间，
        帧的发送时延 <b>T = 帧长 ÷ 数据率</b> 必须不小于它 —— 这就是<b>最小帧长 = 2τ × 数据率</b>。
        64 B = 512 bit 里含 18 B 帧头帧尾，所以<b>数据字段最少 46 B</b>。
      </div>
    </div>`;
}

/* ============================================================================
 * 渲染：backoff（时隙带 + 退避表）
 * ========================================================================== */
function _csRenderBackoff(s, stage) {
  const W = 1000, PX0 = 40, PX1 = 960, PY = 96;
  const H = PY + 96;
  const cur = s.cur;
  const show = cur || { k: 0, kMax: 0, slots: 1, maxWait: 0, avgWait: 0, i: 0 };
  /* 时隙带：最多画 32 格，超出则合并（每格 = ceil(slots/32) 个时隙） */
  const NB = Math.min(32, Math.max(1, show.slots));
  const per = Math.ceil(show.slots / NB);
  const cellW = (PX1 - PX0) / NB;
  const xOf = t => PX0 + (t / Math.max(1e-9, show.slots)) * (PX1 - PX0);

  let cells = '';
  for (let c = 0; c < NB; c++) {
    const x = PX0 + c * cellW;
    const last = c === NB - 1;
    const isTop = last && show.slots > 0;
    cells += `<rect class="cs-slot" x="${x}" y="${PY}" width="${cellW - 1.5}" height="30" rx="3"
        fill="${isTop ? '#fee2e2' : (s.curI ? '#eef2ff' : '#f1f5f9')}" stroke="#c7d2fe" stroke-width="0.8"/>`;
    if (NB <= 16) {
      cells += `<text class="cs-cell-label" x="${x + cellW / 2}" y="${PY + 19}" text-anchor="middle"
        style="font:700 9.5px Consolas,monospace" fill="#64748b">${c * per}</text>`;
    } else if (last || c === 0) {
      cells += `<text class="cs-cell-label" x="${x + cellW / 2}" y="${PY + 19}" text-anchor="middle"
        style="font:700 9.5px Consolas,monospace" fill="#64748b">${c * per}</text>`;
    }
  }
  const bands = `
    <text class="cs-head" x="${PX0}" y="${PY - 14}" style="font:800 11px sans-serif" fill="#b45309">可选等待区间：0 ~ ${_csNum(show.kMax)} 个时隙（共 ${show.slots} 种，每个时隙 = 争用期 ${_csNum(s.win)} μs）</text>
    <text class="cs-band-text" x="${PX0}" y="${PY + 50}" style="font:700 10px sans-serif" fill="#64748b">0 μs</text>
    <text class="cs-band-text" x="${PX1}" y="${PY + 50}" text-anchor="end" style="font:700 10px sans-serif" fill="#e11d48">最长 ${_csNum(show.kMax * s.win)} μs</text>
    <text class="cs-band-text" x="${(PX0 + PX1) / 2}" y="${PY + 74}" text-anchor="middle" style="font:700 10px sans-serif" fill="#64748b">每一格 = ${per > 1 ? per + ' 个' : '1 个'}时隙；随机取 K 后等待 K 个时隙，所以平均等 ${_csNum(show.avgWait)} μs、最长等 ${_csNum(show.maxWait)} μs</text>
    <line x1="${PX0}" y1="${PY + 30}" x2="${PX1}" y2="${PY + 30}" stroke="#cbd5e1" stroke-width="1.4"/>`;

  const rowCells = s.rows.map(r => {
    /* 高亮一律以"快照给的状态"为准（done 帧不该再高亮任何一行） */
    const on = r.state === 'cur';
    const cls = on ? 'bg-amber-50' : (r.state === 'done' ? 'bg-white' : 'bg-slate-50');
    const tc = on ? 'text-amber-700' : (r.state === 'done' ? 'text-slate-600' : 'text-slate-300');
    return `<tr class="${cls}">
      <td class="py-1 pr-2 text-[11px] font-bold ${tc}">${on ? '▶ ' : ''}${r.i}${r.i === _CS_MAX_I ? '（上限）' : ''}</td>
      <td class="py-1 px-1 text-center text-[11px] font-mono ${tc}">${r.k}${r.i > 10 ? '（封顶）' : ''}</td>
      <td class="py-1 px-1 text-center text-[11px] font-mono ${tc}">0 ~ ${r.kMax}</td>
      <td class="py-1 px-1 text-center text-[11px] font-mono ${on ? 'text-rose-600 font-extrabold' : tc}">${_csNum(r.maxWait)}</td>
      <td class="py-1 pl-1 text-center text-[11px] font-mono ${tc}">${_csNum(r.avgWait)}</td>
    </tr>`;
  }).join('');

  const box = `
    <div class="rounded-2xl border border-slate-200 bg-white p-3">
      ${RC408.ui.sectionTitle('退避时隙带（一格 = 一个争用期 2τ）')}
      <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">${cells}${bands}</svg>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
      ${RC408.ui.statCard('本次冲突次数 i', String(s.curI || 0), `共演示到第 ${s.totalI} 次`, 'text-slate-800')}
      ${RC408.ui.statCard('k = min(i,10)', String(show.k), `时隙取值 0 ~ ${show.kMax}`, 'text-indigo-700')}
      ${RC408.ui.statCard('最长等待', `${_csNum(show.maxWait)} μs`, `${show.kMax} × ${_csNum(s.win)} μs`, 'text-rose-600')}
      ${RC408.ui.statCard('平均等待', `${_csNum(show.avgWait)} μs`, '均匀取值时取一半', 'text-slate-700')}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
        ${RC408.ui.sectionTitle('二进制指数退避全表（第 i 次冲突 → k = min(i,10)）')}
        <table class="w-full text-sm">
          <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100">
            <th class="text-left py-1 pr-2 font-bold">第 i 次冲突</th>
            <th class="py-1 px-1 font-bold">k</th>
            <th class="py-1 px-1 font-bold">时隙取值</th>
            <th class="py-1 px-1 font-bold">最长等待 (μs)</th>
            <th class="py-1 pl-1 font-bold">平均 (μs)</th>
          </tr></thead>
          <tbody>${rowCells}</tbody>
        </table>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        ${RC408.ui.sectionTitle('本帧算什么')}
        <p class="text-[11px] text-slate-600 leading-relaxed">${s.desc}</p>
        <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
          <b>2023-36 真题锚点</b>：10BaseT 争用时间片 51.2 μs，连续 <b>4</b> 次冲突 ⟹ k = min(4,10) = 4，
          时隙 0 ~ 15 ⟹ 最长等待 <b>15 × 51.2 = 768 μs</b>。
        </div>
        <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
          <b>时隙为什么是 2τ</b>：一次冲突的"往返回合"就是一个争用期；退避必须按整回合等，才不会刚发又撞。
        </div>
      </div>
    </div>`;

  stage.innerHTML = `<div class="space-y-4">${box}
    <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
      💡 <b>一句话记住：</b>第 i 次冲突后从 <b>{0, 1, …, 2^k − 1}</b> 里随机取 K（<b>k = min(i,10)</b>），
      等 K 个<b>争用期</b>再重发；冲突越多区间越大（最多 1023 个时隙），10 次以后封顶。
    </div>
  </div>`;
}

/* ============================================================================
 * 渲染：ca（真实比例区间带）
 * ========================================================================== */
function _csRenderCa(s, stage) {
  const W = 1000, PX0 = 40, PX1 = 960, PY = 92, BH = 46;
  const H = PY + 132;
  const xOf = t => PX0 + (t / s.total) * (PX1 - PX0);
  const segRects = s.segs.map(g => {
    const x1 = xOf(g.t0), x2 = xOf(g.t1);
    const w = Math.max(1, x2 - x1);
    const on = g.state === 'cur';
    const seen = g.state !== 'future';
    /* 只有够宽的段才把名字写在色块里；窄段（RTS/CTS/ACK）的名字走下面那排外置标签 */
    const inner = w >= 44
      ? `<text class="cs-seg-label" x="${x1 + w / 2}" y="${PY + BH / 2 + 4}" text-anchor="middle"
           style="font:800 10.5px sans-serif" fill="#ffffff">${g.key}</text>`
      : '';
    return `<rect class="cs-seg" x="${x1}" y="${PY}" width="${w}" height="${BH}"
        fill="${seen ? g.c : '#f1f5f9'}" opacity="${seen ? (on ? 1 : 0.75) : 1}"
        stroke="${on ? '#b45309' : '#ffffff'}" stroke-width="${on ? 2.4 : 1}"/>${inner}`;
  }).join('');

  /* 外置标签排：按时间顺序**贪心左到右**摆放（保证两两不压盖），颜色与色块一致；
     真实比例下 SIFS 只占 5%、RTS/CTS/ACK 不到 1%，所以它们只能外置。 */
  let cursor = PX0;
  const outer = s.segs.map(g => {
    const txt = `${g.key} ${_csNum(g.t)}μs`;
    const w = _csTextW(txt, 9.5);
    const mid = (xOf(g.t0) + xOf(g.t1)) / 2;
    const cx = Math.max(cursor + w / 2, mid);
    cursor = cx + w / 2 + 7;
    const seen = g.state !== 'future';
    return `<text class="cs-band-text" x="${cx}" y="${PY + BH + 15}" text-anchor="middle"
      style="font:700 9.5px Consolas,sans-serif" fill="${seen ? g.c : '#cbd5e1'}">${txt}</text>`;
  }).join('');

  const navBracket = `
    <line x1="${xOf(s.navT0)}" y1="${PY - 12}" x2="${xOf(s.navT1)}" y2="${PY - 12}" stroke="#e11d48" stroke-width="1.6"/>
    <line x1="${xOf(s.navT0)}" y1="${PY - 16}" x2="${xOf(s.navT0)}" y2="${PY - 6}" stroke="#e11d48" stroke-width="1.6"/>
    <line x1="${xOf(s.navT1)}" y1="${PY - 16}" x2="${xOf(s.navT1)}" y2="${PY - 6}" stroke="#e11d48" stroke-width="1.6"/>
    <text class="cs-band-text" x="${(xOf(s.navT0) + xOf(s.navT1)) / 2}" y="${PY - 18}" text-anchor="middle"
      style="font:800 10.5px sans-serif" fill="#e11d48">NAV = SIFS + 数据 + SIFS + ACK = ${_csNum(s.nav)} μs</text>`;

  const axis = `
    <line x1="${PX0}" y1="${PY + BH + 24}" x2="${PX1}" y2="${PY + BH + 24}" stroke="#cbd5e1" stroke-width="1.4"/>
    <text class="cs-head" x="${PX0}" y="${PY + BH + 38}" style="font:800 10.5px sans-serif" fill="#64748b">t = 0（甲听完 DIFS）</text>
    <text class="cs-band-text" x="${PX1}" y="${PY + BH + 38}" text-anchor="end" style="font:800 10.5px sans-serif" fill="#64748b">一次完整传输 ${_csNum(s.total)} μs</text>`;

  const segRows = s.segs.map(g => {
    const on = g.state === 'cur';
    const seen = g.state !== 'future';
    const tc = on ? 'text-amber-700 font-extrabold' : (seen ? 'text-slate-600' : 'text-slate-300');
    return `<tr class="${on ? 'bg-amber-50' : ''}">
      <td class="py-1 pr-2 text-[11px] ${tc}">${on ? '▶ ' : ''}${g.i + 1}. ${g.key}</td>
      <td class="py-1 px-1 text-center text-[11px] font-mono ${tc}">${g.who}</td>
      <td class="py-1 px-1 text-center text-[11px] font-mono ${tc}">${_csNum(g.t)}</td>
      <td class="py-1 pl-2 text-[11px] ${seen ? 'text-slate-500' : 'text-slate-300'}">${g.note}</td>
    </tr>`;
  }).join('');

  stage.innerHTML = `
    <div class="space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
          ${navBracket}${segRects}${outer}${axis}
        </svg>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        ${RC408.ui.statCard('数据帧发送时延', `${_csNum(s.tData)} μs`, `${_csNum(s.frameLenB)} B ÷ ${_csNum(s.rate)} Mb/s`, 'text-indigo-700')}
        ${RC408.ui.statCard('NAV（隐藏站静默）', `${_csNum(s.nav)} μs`, 'SIFS + 数据 + SIFS + ACK', 'text-rose-600')}
        ${RC408.ui.statCard('发送方到被确认', `${_csNum(s.sendTotal)} μs`, 'DIFS + 数据 + SIFS', 'text-slate-800')}
        ${RC408.ui.statCard('一次完整传输', `${_csNum(s.total)} μs`, 'DIFS + RTS + SIFS + CTS + NAV', 'text-slate-800')}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="md:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('CSMA/CA 一次传输的八段（按真实比例画）')}
          <table class="w-full text-sm">
            <thead><tr class="text-[11px] text-slate-400 border-b border-slate-100">
              <th class="text-left py-1 pr-2 font-bold">段</th>
              <th class="py-1 px-1 font-bold">谁</th>
              <th class="py-1 px-1 font-bold">μs</th>
              <th class="text-left py-1 pl-2 font-bold">作用</th>
            </tr></thead>
            <tbody>${segRows}</tbody>
          </table>
          <p class="text-[11px] text-slate-500 mt-2 leading-relaxed">
            <b>DIFS 128 μs / SIFS 28 μs / RTS 3 μs / CTS 2 μs / ACK 2 μs</b> 取自 2024-36 题干
            （2026-35 给出的 DIFS / SIFS 与之一致）。连续空格子（SIFS）比 DIFS 短，所以应答总是抢在别人前面。
          </p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          ${RC408.ui.sectionTitle('本帧算什么')}
          <p class="text-[11px] text-slate-600 leading-relaxed">${s.desc}</p>
          <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
            <b>2024-36</b>：数据帧 1998 B ÷ 54 Mb/s = 296 μs ⟹ NAV = 28 + 296 + 28 + 2 = <b>354 μs</b>。
          </div>
          <div class="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
            <b>2026-35</b>：1500 B ÷ 300 Mb/s = 40 μs ⟹ DIFS + 数据 + SIFS = 128 + 40 + 28 = <b>196 μs</b>（≈ 200 μs）。
          </div>
        </div>
      </div>

      <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
        💡 <b>一句话记住：</b>CSMA/CD 靠<b>检测</b>（有线，边发边听）；CSMA/CA 靠<b>避免</b>（无线，听不到自己发的时候）——
        先听 <b>DIFS</b>、再退避、然后 <b>RTS/CTS</b> 预约，听到 CTS 的隐藏站按 <b>NAV</b> 静默。
      </div>
    </div>`;
}
