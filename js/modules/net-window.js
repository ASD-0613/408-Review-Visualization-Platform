'use strict';
/* ============================================================================
 * net-window.js —— 【计算机网络】滑动窗口可靠传输：停止-等待 / GBN / SR（前缀 _sw）
 *
 * 考情（窗3 逐条回 考情缓存/ 复核）：18 年中 10 年（9 选择 + 1 大题）——
 *   2009-35、2011-35、2012-36、2014-36、2015-35、2017-47(大)、2018-36、2019-35、2020-36、2024-37。
 *   逐年依据见 js/exam-history.js 该条目注释与 docs/handover.md §2.4。
 *
 * 快照模型（"轮"驱动，刻意还原教科书时序，而不是"一帧一确认"的伪流水线）：
 *   每轮 = ①填满发送窗口（连发多帧，逐帧一个快照）
 *          ②这些帧的确认依次回到发送方（逐条一个快照，窗口在此滑动）
 *          ③仍无确认可收 → 最老的未确认帧超时，触发重传
 *   GBN 超时重传 [base, next−1] 整段（后退 N 帧，且每帧都可能再次丢失）；
 *   SR 超时只重传计时器最先到期的那一帧；停等 = 窗口 1 的特例。
 *   接收方：GBN/停等 接收窗口 = 1，失序帧丢弃 + 重复 ACK 上一帧；
 *           SR 接收窗口 = 发送窗口，失序帧缓存 + 逐帧独立确认。
 *   丢失事件支持两类：`2:1` = 2 号数据帧第 1 次传输丢失；`A2:1` = 2 号帧的确认丢失
 *   （2009-35 正是"ACK1 丢了但累积确认 ACK3 覆盖了它"，见 theory 真题锚点表）。
 *   序号空间按 mod 2ⁿ 计算，窗口跨环时画成两段（旧版的越界 bug 就出在这里）。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-window',
  mode: 'stepper',
  title: '滑动窗口可靠传输（停等 · GBN · SR）',

  theory: `
> **为什么要有它**：停等协议一帧一确认，带宽大部分时间在空转——**滑动窗口让发送方连续发出多帧而不必逐帧等待**，用"窗口"限制在途未确认帧数，把信道填满。
> **怎么实现**：发送方维护发送窗口（可连续发送的帧区间）、接收方维护接收窗口；确认到达就滑动窗口，超时就重传（GBN 整段重传、SR 只重传出错那一帧）。
> **记住什么**：**GBN 与 SR 的窗口上限**（2^n − 1 与 2^(n−1)）+ **信道利用率公式** + 两者的代价（重传 vs 缓存）。

## 一、三种协议对照（W_T 发送窗口 / W_R 接收窗口）
| 协议 | W_T | W_R | 收到失序帧怎么办 | 确认方式 |
| --- | --- | --- | --- | --- |
| 停止-等待 | 1 | 1 | — | 每帧一个确认 |
| **GBN 后退 N 帧** | ≤ 2^n − 1 | **1** | **丢弃** + 重复 ACK 最后一个按序帧 | **累积确认**（ACK n = n 及之前全部收到） |
| **SR 选择重传** | ≤ 2^(n−1) | = W_T | **缓存**，缺口补齐后一并上交 | 逐帧独立确认 |

## 二、序号位数 n 与窗口上限（必考）
- **GBN**：W_T ≤ 2^n − 1（等价于 序号个数 ≥ 发送窗口 + 1）；若 W_T = 2^n，接收方分不清收到的是新帧还是重传帧；
- **SR**：W_T + W_R ≤ 2^n；反推"至少几位序号"用 2^n ≥ W+1（GBN）或 2^(n−1) ≥ W（SR）。

## 三、信道利用率
$$T_d=\\frac{L}{R},\\qquad RTT=2D,\\qquad U=\\min\\left(1,\\ \\frac{W_T\\cdot T_d}{T_d+RTT+T_a}\\right)$$
- 停止-等待即上式取 W_T = 1；忽略确认开销时 T_a = 0；**捎带确认**（2017-47）时 T_a = T_d；
- 经典反推：要求 U ≥ 80% ⇒ W_T ≥ ⌈0.8 × (T_d + RTT + T_a) / T_d⌉，再按第二节定序号位数。

## 四、真题锚点表（10 年的考法都在这里）
| 年份-题号 | 考什么 | 结论 |
| --- | --- | --- |
| 2009-35 | GBN 累积确认 | 收到 ACK3 就表示 0~3 全部收到；**ACK1 丢失不影响**，要重传的是 4~7 |
| 2011-35 | SR 超时重传帧数 | 只收到 1 号确认、0 与 2 号超时 ⇒ 重传 **2 帧**；3 号计时器未超时 |
| 2012-36 | 利用率最高 ⇒ 序号位数 | T_d = 64ms、RTT = 540ms ⇒ 一周期能发 ≈10.4 帧 ⇒ 2^n ≥ 11.4 ⇒ **n = 4** |
| 2014-36 | GBN 最大平均速率 | W = 1000 帧 × 1000B = 1MB，一个 RTT（100ms）发完 ⇒ 80Mbps（再与带宽取小） |
| 2015-35 | 利用率 ≥ 80% ⇒ 序号位数 | n×62.5 / (62.5 + 500) ≥ 80% ⇒ n ≥ 7.2 取 8 ⇒ 2^K ≥ 9 ⇒ **K = 4** |
| 2017-47 | 双向 GBN + 捎带确认（大） | 3 bit 序号 ⇒ 窗口 ≤ 7；U = 7×0.08 / (0.08+0.96+0.08) = **50%** |
| 2018-36 | 停等利用率反求帧长 | 周期 = x/3kbps + 200ms×2 ⇒ 解出 **x = 800 bit** |
| 2019-35 | 窗口与序号空间 | 3 bit 序号（8 个）、W_T = 5 ⇒ W_T + W_R ≤ 8 ⇒ **W_R ≤ 3** |
| 2020-36 | 停等最大利用率 | T_d = T_a = 800ms、RTT = 400ms ⇒ U = 800 / 2000 = **40%** |
| 2024-37 | SR 窗口滑动条件 | 3 bit ⇒ W = 4；缺 ACK1 时窗口不滑动，F1 超时后重传 F1（答案：F4、F1） |

## 五、考点提醒（易错点）
- **GBN 的代价在重传、SR 的代价在缓存**：GBN 失一帧就要把窗口内其后所有帧全部重发；SR 只重发那一帧；
- **ACK 丢失不一定有害**：GBN 靠累积确认，后面任何一个 ACK 都能覆盖它（2009-35）；SR 的独立确认则必须等该帧自己的 ACK，否则只能等超时（2024-37）；
- **GBN 的重复 ACK 不做快速重传**：接收窗口 = 1，重复 ACK 只表示"我还在等某一帧"，重传只能等超时；
- 帧序号是 **mod 2^n 循环使用**的，本模块的"序号空间"一行会显示窗口跨过序号末尾时的回绕。

> **真题考情**：**10/18 年（选 9 + 大题 1）**：选 2009-35、2011-35、2012-36、2014-36、2015-35、2018-36、
> 2019-35、2020-36、2024-37；大 2017-47（双向 GBN + 捎带确认，求最大信道利用率）。
`,

  inputs: [
    {
      key: 'proto', label: '协议', type: 'select', default: 'GBN', wide: true,
      options: [
        { v: 'stop', t: '停止-等待协议（W_T = 1）' },
        { v: 'GBN', t: 'GBN 后退 N 帧（接收窗口 = 1，累积确认）' },
        { v: 'SR', t: 'SR 选择重传（失序缓存，逐帧独立确认）' },
      ],
    },
    {
      key: 'n', label: '帧序号位数 n', type: 'select', default: 3,
      options: [2, 3, 4].map(v => ({ v, t: `${v} bit（序号 0 ~ ${Math.pow(2, v) - 1}）` })),
    },
    { key: 'wt', label: '发送窗口 W_T', type: 'text', default: '4', help: '上限：GBN 2ⁿ−1、SR 2ⁿ⁻¹；停止-等待恒为 1（该框会自动禁用）' },
    { key: 'total', label: '待发送数据帧总数', type: 'text', default: '8', help: '2 ~ 32 帧；超过序号空间时会看到序号回绕复用' },
    {
      key: 'loss', label: '丢失事件（帧号:第几次，A 前缀表示确认丢失）', type: 'text', default: '2:1', wide: true,
      ph: '如 2:1、A1:1；多个用逗号分隔；留空 = 理想信道',
      help: '2:1 = 2 号数据帧第 1 次传输丢失；A1:1 = 1 号帧的确认丢失（ACK 丢失与数据帧丢失后果完全不同）',
    },
    { key: 'L', label: '数据帧长 L（bit）', type: 'text', default: '8000' },
    { key: 'Rt', label: '数据速率（kb/s）', type: 'text', default: '128' },
    { key: 'D', label: '单向传播时延 D（ms）', type: 'text', default: '250' },
    { key: 'Ta', label: '确认帧发送时延 T_a（ms）', type: 'text', default: '0', wide: true, help: '0 = 忽略确认帧开销；捎带确认时填成与 T_d 相同（2017-47）；确认帧等长同速率时也等于 T_d（2020-36）' },
  ],

  quickActions: [
    {
      label: '2009-35 ACK 丢失（累积确认救场）',
      run(rt) { _swSetAll(rt, 'GBN', 3, '4', '8', 'A1:1', '8000', '128', '250', '0'); },
    },
    {
      label: '2011-35 SR 只重传超时的帧',
      run(rt) { _swSetAll(rt, 'SR', 3, '4', '7', '0:1,2:1', '8000', '128', '250', '0'); },
    },
    {
      label: '2015-35 反推最少序号位数',
      run(rt) { _swSetAll(rt, 'GBN', 4, '8', '12', '', '8000', '128', '250', '0'); },
    },
    {
      label: '2017-47 捎带确认 U = 50%',
      run(rt) { _swSetAll(rt, 'GBN', 3, '7', '8', '', '8000', '100000', '0.48', '0.08'); },
    },
    {
      label: '2020-36 停等协议 U = 40%',
      run(rt) { _swSetAll(rt, 'stop', 3, '1', '6', '', '8000', '10', '200', '800'); },
    },
    {
      label: '2024-37 SR 缺 ACK1 ⇒ 重传 F1',
      run(rt) { _swSetAll(rt, 'SR', 3, '4', '8', '1:1', '8000', '128', '250', '0'); },
    },
    {
      label: 'GBN vs SR 同场景对照（丢 2 号帧）',
      run(rt) { _swSetAll(rt, 'GBN', 3, '4', '10', '2:1', '8000', '128', '250', '0'); },
    },
    {
      label: '窗口跨过序号末尾（W = 2ⁿ−1）',
      run(rt) { _swSetAll(rt, 'GBN', 3, '7', '14', '', '8000', '128', '250', '0'); },
    },
    {
      label: '随机场景 🎲',
      run(rt) {
        const proto = ['stop', 'GBN', 'SR'][RC408.util.rnd(0, 2)];
        const n = RC408.util.rnd(2, 4);
        const seqMax = Math.pow(2, n);
        const maxW = proto === 'stop' ? 1 : proto === 'GBN' ? seqMax - 1 : seqMax / 2;
        const W = RC408.util.rnd(1, Math.min(maxW, 6));
        const extra = Math.max(0, Math.min(6, 20 - W - 2));
        const total = W + 2 + RC408.util.rnd(0, extra);
        const f = RC408.util.rnd(0, total - 1);
        const isAck = RC408.util.rnd(0, 2) === 0;
        _swSetAll(rt, proto, n, String(W), String(total), `${isAck ? 'A' : ''}${f}:1`,
          String(RC408.util.rnd(4, 16) * 500), String([64, 128, 256, 512][RC408.util.rnd(0, 3)]),
          String([50, 100, 250, 300][RC408.util.rnd(0, 3)]), '0');
      },
    },
  ],

  /* 停止-等待时把 W_T 输入框禁用并置 1（实际口径仍以 parse 为准） */
  bindInputs(els) {
    const sync = () => {
      const isStop = els.proto.value === 'stop';
      if (els.wt) { els.wt.disabled = isStop; if (isStop) els.wt.value = '1'; }
    };
    if (els.proto) els.proto.addEventListener('change', sync);
    sync();
  },

  parse(vals) {
    const proto = ['stop', 'GBN', 'SR'].includes(vals.proto) ? vals.proto : 'GBN';
    const n = parseInt(vals.n, 10);
    if (!(n >= 2 && n <= 4)) throw { message: `帧序号位数 n 只能取 2 / 3 / 4（当前「${vals.n}」）` };
    const seqMax = Math.pow(2, n);
    const maxW = proto === 'stop' ? 1 : proto === 'GBN' ? seqMax - 1 : seqMax / 2;

    const num = (raw, name, o) => {
      const s = String(raw == null ? '' : raw).trim();
      if (!/^\d+(\.\d+)?$/.test(s)) throw { message: `${name} 必须是非负数字（当前「${raw}」）` };
      const v = parseFloat(s);
      if (!(v > o.min - 1e-9) || (o.max !== undefined && v > o.max)) {
        throw { message: `${name} 须在 ${o.desc} 范围内（当前 ${v}）` };
      }
      return v;
    };

    let wt;
    if (proto === 'stop') {
      wt = 1;                                   // 停等恒为 1，不因输入框内容报错
    } else {
      const raw = String(vals.wt == null ? '' : vals.wt).trim();
      if (!/^\d+$/.test(raw)) throw { message: `发送窗口 W_T 必须是正整数（当前「${vals.wt}」）` };
      wt = parseInt(raw, 10);
      if (wt < 1 || wt > maxW) {
        throw {
          message: `${proto === 'GBN' ? 'GBN' : 'SR'} 在 ${n} bit 序号下 W_T 须为 1 ~ ${maxW}`
            + `（${proto === 'GBN' ? 'GBN 上限 2ⁿ−1' : 'SR 上限 2ⁿ⁻¹'} = ${maxW}，当前 ${wt}）`,
        };
      }
    }

    const totalRaw = String(vals.total == null ? '' : vals.total).trim();
    const total = parseInt(totalRaw, 10);
    if (!/^\d+$/.test(totalRaw) || !(total >= 2 && total <= 32)) {
      throw { message: `待发送数据帧总数须为 2 ~ 32 的整数（当前「${vals.total}」）` };
    }

    /* 丢失事件：`帧号:第几次`（数据帧）或 `A帧号:第几次`（确认帧） */
    const lossRaw = String(vals.loss == null ? '' : vals.loss).trim();
    const lossKeys = new Set();
    const lossList = [];
    if (lossRaw) {
      lossRaw.split(/[,，;；、\s]+/).filter(Boolean).forEach(tok => {
        const mt = tok.match(/^([AaAa])?(\d+)\s*[:：]\s*(\d+)$/) || tok.match(/^([Aa])(\d+)[:：](\d+)$/);
        if (!mt) throw { message: `丢失事件「${tok}」格式错误，应写成 帧号:第几次（例 2:1）或 A帧号:第几次（例 A2:1，表示确认丢失）` };
        const isAck = !!mt[1];
        const fr = parseInt(mt[2], 10), at = parseInt(mt[3], 10);
        if (!(fr >= 0 && fr < total)) throw { message: `丢失事件的帧号 ${fr} 超出待发范围 0 ~ ${total - 1}` };
        if (at < 1) throw { message: `丢失事件的「第几次」须 ≥ 1（当前 ${at}）` };
        lossKeys.add((isAck ? 'A' : 'F') + fr + '#' + at);
        lossList.push({ f: fr, at, ack: isAck });
      });
    }

    /* 信道参数与利用率（即时算出，与播放进度无关） */
    const L = num(vals.L, '数据帧长 L', { min: 1, desc: '> 0 bit' });
    const Rt = num(vals.Rt, '数据速率', { min: 1e-9, desc: '> 0 kb/s' });
    const D = num(vals.D, '单向传播时延 D', { min: 0, desc: '≥ 0 ms' });
    const Ta = num(vals.Ta, '确认帧发送时延 T_a', { min: 0, desc: '≥ 0 ms' });
    const Td = L / Rt;                          // ms（L bit ÷ Rt kb/s = L/Rt ms）
    const RTT = 2 * D;
    const cycle = Td + RTT + Ta;
    const U = w => Math.min(1, (w * Td) / cycle);
    const target = 0.8;
    const wMin = Math.max(1, Math.ceil((target * cycle) / Td));
    const kGBN = Math.max(1, Math.ceil(Math.log2(wMin + 1)));
    const kSR = Math.max(1, Math.ceil(Math.log2(Math.max(1, wMin))) + 1);

    return {
      proto, n, W: wt, seqMax, total, lossKeys, lossRaw, lossList,
      ch: { L, Rt, D, Ta, Td, RTT, cycle, U, target, wMin, kGBN, kSR, Ustop: U(1), Ucur: U(wt) },
    };
  },

  buildSnapshots(model) {
    const { proto, n, W, seqMax, total, lossKeys } = model;
    const WR = proto === 'SR' ? W : 1;
    const PNAME = { stop: '停止-等待协议', GBN: 'GBN 后退 N 帧', SR: 'SR 选择重传' };

    /* ---------------- 发送方状态 ---------------- */
    let base = 0;                                // 发送窗口基序号（最老的未确认帧）
    let next = 0;                                // 下一个待发送帧
    const acked = new Array(total).fill(false);
    const sentEver = new Array(total).fill(false);
    const inFlight = new Array(total).fill(false);
    const lostLast = new Array(total).fill(false);
    const attempts = new Array(total).fill(0);
    const lastSend = new Array(total).fill(-1);  // 逻辑时钟：最后一次发送的时刻
    let clock = 0;

    /* ---------------- 接收方状态 ---------------- */
    let rcvBase = 0;                             // 期望帧 / 接收窗口基序号
    const rcvGot = new Array(total).fill(false);
    const delivered = new Array(total).fill(false);
    const buffered = new Array(total).fill(false);
    const discards = new Array(total).fill(0);
    const ackAttempts = new Array(total).fill(0);
    const ackLostMark = new Array(total).fill(false);   // 该帧最近一次确认是否丢失

    const st = { tx: 0, retx: 0, lost: 0, ack: 0, dup: 0, ackLost: 0 };
    const snaps = [];
    const push = (step, o) => snaps.push({
      step, proto, n, W, WR, seqMax, total,
      base, next, rcvBase,
      acked: [...acked], sentEver: [...sentEver], inFlight: [...inFlight],
      lostLast: [...lostLast], attempts: [...attempts],
      rcvGot: [...rcvGot], delivered: [...delivered], buffered: [...buffered],
      discards: [...discards], ackLostMark: [...ackLostMark],
      stats: { ...st },
      cur: null, curKind: null, ackNum: null, batch: [],
      log: '', logType: 'info', desc: '', ...o,
    });

    push('init', {
      log: `就绪：${PNAME[proto]}｜序号 ${n} bit（0 ~ ${seqMax - 1}）｜发送窗口 W_T = ${W}，接收窗口 W_R = ${WR}`
        + `｜共 ${total} 帧待发｜`
        + (model.lossList.length
          ? '丢失事件：' + model.lossList.map(x => `${x.ack ? 'ACK' : '帧'}${x.f} 第 ${x.at} 次`).join('、')
          : '理想信道（无丢失）'),
      desc: '单步执行：发送方连发一窗帧 → 确认陆续返回、窗口滑动 → 无确认可收则超时重传',
    });

    /* 接收方动作：就地把接收方状态改掉，并返回该回的确认（含确认本身是否丢失） */
    const receiverAct = (f) => {
      if (proto === 'SR') {
        if (f < rcvBase) {                                  // 已交付过的重复帧
          discards[f]++;
          return { k: f, dup: true, kind: 'dup-delivered' };
        }
        if (f >= rcvBase + WR) {                            // 落在接收窗口之外
          discards[f]++;
          return { k: -1, dup: true, kind: 'out-window' };
        }
        if (rcvGot[f]) {                                    // 收过但尚未交付（重复到达）
          discards[f]++;
          return { k: f, dup: true, kind: 'dup-repeat' };
        }
        rcvGot[f] = true;
        buffered[f] = true;
        const del = [];
        while (rcvBase < total && rcvGot[rcvBase]) {
          buffered[rcvBase] = false; delivered[rcvBase] = true; del.push(rcvBase); rcvBase++;
        }
        return { k: f, dup: false, delivered: del, kind: del.indexOf(f) >= 0 ? 'ok' : 'buf' };
      }
      /* 停止-等待 / GBN：接收窗口 = 1，只收期望帧 */
      if (f === rcvBase) {
        rcvGot[f] = true; delivered[f] = true; rcvBase++;
        return { k: f, dup: false, delivered: [f], kind: 'ok' };
      }
      discards[f]++;
      return { k: rcvBase > 0 ? rcvBase - 1 : -1, dup: true, kind: f > rcvBase ? 'out-of-order' : 'dup-old' };
    };

    /* 接收方为序号 k 生成一次确认：登记这是第几次发送该确认、以及它是否丢失 */
    const mkAck = (k) => {
      if (k < 0 || k >= total) return null;
      ackAttempts[k]++;
      const lost = lossKeys.has('A' + k + '#' + ackAttempts[k]);
      ackLostMark[k] = lost;
      return { k, att: ackAttempts[k], lost };
    };

    /* 发送一帧（新建 or 重传），并让接收方就地处理 */
    const transmit = (f, kind) => {
      attempts[f]++;
      const att = attempts[f];
      clock++;
      sentEver[f] = true;
      lastSend[f] = clock;                                  // 计时器从本次发送起算
      const lost = lossKeys.has('F' + f + '#' + att);
      lostLast[f] = lost;
      if (kind === 'send') st.tx++; else st.retx++;
      if (lost) {
        st.lost++;
        inFlight[f] = false;
        push('tx-lost', {
          cur: f, curKind: kind,
          log: `${kind === 'retx' ? '**重传**' : '发送'}帧 ${f}（第 ${att} 次传输）→ **数据帧在信道中丢失 / 出错**！`
            + `发送方并不知情，计时器到期前不会重传`
            + (proto === 'GBN' ? `；GBN 超时后要从帧 ${base} 起整段重发` : proto === 'SR' ? `；SR 只重传超时的那一帧` : ''),
          logType: 'error', desc: `帧 ${f} 第 ${att} 次传输丢失`,
        });
        return null;
      }
      inFlight[f] = true;
      const res = receiverAct(f);
      res.ack = mkAck(res.k);
      let rxMsg;
      if (res.kind === 'ok') {
        const more = res.delivered.filter(v => v !== f);
        rxMsg = proto === 'SR'
          ? `接收方收到帧 ${f}（正是期望帧${more.length ? `，并连同已缓存的 ${more.join('、')} 号帧一起按序上交上层` : '，按序上交上层'}）→ 回**独立确认** ACK ${f}（只代表 ${f} 收到了）`
          : `接收方收到帧 ${f}（正是期望帧）→ 上交上层，回**累积确认** ACK ${f}（含义：${f} 及之前的帧全部正确收到）`;
      } else if (res.kind === 'buf') {
        rxMsg = `接收方收到帧 ${f}（落在接收窗口内，但期望的是 ${rcvBase}）→ **先缓存**（SR 失序不移交），回独立确认 ACK ${f}`;
      } else if (res.kind === 'out-of-order' || res.kind === 'dup-old') {
        rxMsg = `接收方收到${res.kind === 'out-of-order' ? '失序' : '重复'}帧 ${f}（期望 ${rcvBase}）→ `
          + `**丢弃**（${proto === 'GBN' ? 'GBN' : '停等'}接收窗口 = 1），`
          + (res.k < 0
            ? `此时接收方一个按序帧都还没收到，**没有确认可回**，发送方只能等超时`
            : `并重复发送 ACK ${res.k} 催发送方`);
      } else if (res.kind === 'dup-repeat') {
        rxMsg = `接收方收到已经收过的帧 ${f} → 丢弃，重新回独立确认 ACK ${f}`;
      } else {
        rxMsg = `接收方收到落在接收窗口之外的帧 ${f} → 直接丢弃`;
      }
      push('tx', {
        cur: f, curKind: kind,
        log: `${kind === 'retx' ? '**重传**' : '发送'}帧 ${f}（第 ${att} 次传输）→ 沿信道到达接收方。${rxMsg}`,
        logType: kind === 'retx' ? 'warn' : 'info',
        desc: `${kind === 'retx' ? '重传' : '发送'}帧 ${f}（第 ${att} 次）`,
      });
      return res;
    };

    /* 确认到达发送方：滑动窗口（GBN 累积 / SR 独立） */
    const applyAck = (res) => {
      if (!res || !res.ack) return;
      const k = res.ack.k;
      if (res.ack.lost) {
        st.ackLost++;
        push('ack-lost', {
          cur: k, curKind: 'ack', ackNum: k,
          log: `ACK ${k} 在**返回途中丢失**！接收方以为已经确认过了，发送方却什么也没收到 —— 只能等超时重传。`
            + (proto === 'SR'
              ? `SR 是独立确认，这条信息无法由别的 ACK 补上（2024-37 的考点）`
              : `好在 GBN 是累积确认，后面任何一个更大的 ACK 都能覆盖它（2009-35 的考点）`),
          logType: 'error', desc: `ACK ${k} 丢失（发送方收不到）`,
        });
        return;
      }
      /* 关键：不管这条 ACK 是不是"重复确认"，它携带的确认信息都要照常生效。
         只有"窗口没动 + 该帧本来就已确认"才算真正的冗余确认（接收方在催更老的帧）。 */
      const oldBase = base;
      const wasAcked = !!acked[k];
      if (proto === 'SR') {
        acked[k] = true;
      } else {
        for (let i = base; i <= k && i < total; i++) acked[i] = true;
      }
      while (base < total && acked[base]) base++;
      if (base === oldBase && wasAcked) {
        st.dup++;
        push('ack-dup', {
          cur: k, curKind: 'ack', ackNum: k,
          log: `ACK ${k} 回到发送方：这是**重复确认**（接收方仍在等 ${rcvBase} 号帧）`
            + `，发送方窗口不动，仍为 [${base}, ${base + W - 1}]`,
          logType: 'warn', desc: `重复确认 ACK ${k}（窗口不动）`,
        });
        return;
      }
      st.ack++;
      const msg = proto === 'SR'
        ? `收到**独立确认** ACK ${k} → 只把 ${k} 号帧标记为已确认`
        : `收到**累积确认** ACK ${k} → ${oldBase} ~ ${k} 号帧全部确认`;
      push('ack', {
        cur: k, curKind: 'ack', ackNum: k,
        log: `${msg}；发送窗口滑动为 [${base}, ${base + W - 1}]`
          + (base - oldBase > 1 ? `（一次滑过 ${base - oldBase} 帧）` : '')
          + `；当前在途未确认 ${Math.max(0, next - base)} 帧`,
        logType: 'success',
        desc: proto === 'SR' ? `ACK ${k} 到达（独立确认）` : `ACK ${k} 到达（累积确认，窗口 → ${base}）`,
      });
    };

    /* 选出计时器最先到期的未确认帧 */
    const pickTimeout = () => {
      let t = -1, best = Infinity;
      for (let f = 0; f < total; f++) {
        if (sentEver[f] && !acked[f] && lastSend[f] >= 0 && lastSend[f] < best) { best = lastSend[f]; t = f; }
      }
      return t;
    };

    const ackQueue = [];
    let guard = 0;
    while (base < total && guard++ < 600) {
      /* ① 填满发送窗口：连发多帧（这一刻能看到"窗口内多个帧同时在途"） */
      while (next < base + W && next < total) {
        const f = next++;
        const res = transmit(f, 'send');
        if (res) ackQueue.push(res);
      }
      /* ② 确认陆续回到发送方（累积 / 独立），窗口在此滑动 */
      while (ackQueue.length) applyAck(ackQueue.shift());
      if (base >= total) break;
      /* ③ 没有新帧可发、也没有确认可收 → 最老的未确认帧超时 */
      if (next > base) {
        const t = proto === 'GBN' ? base : pickTimeout();
        if (t < 0) break;
        const batch = proto === 'GBN'
          ? Array.from({ length: next - t }, (_, i) => t + i)
          : [t];
        push('timeout', {
          cur: t, curKind: 'timeout', batch: [...batch],
          log: `**超时**：帧 ${t} 的计时器到期（发出后一直没收到确认）→ `
            + (proto === 'GBN'
              ? `GBN **后退 N 帧**：把窗口内已发未确认的 ${batch.length} 帧（${batch.join('、')}）全部重发`
              : proto === 'SR'
                ? `SR **只重传帧 ${t}**（其余帧各自独立确认，不连坐重传）`
                : `停止-等待：重传帧 ${t}`),
          logType: 'error',
          desc: proto === 'GBN' ? `超时 → 后退 N 帧重发 ${batch.join('、')}` : `超时 → 只重传帧 ${t}`,
        });
        for (const f of batch) {
          const res = transmit(f, 'retx');
          if (res) ackQueue.push(res);
        }
        while (ackQueue.length) applyAck(ackQueue.shift());
      } else {
        continue;                               // 窗口内全部已确认：回到 ① 继续发新帧，绝不产生伪超时
      }
    }

    if (base < total) {
      push('guard', {
        log: `演示中止：步数超过安全上限（base = ${base} / ${total}）。请检查丢失事件是否过于极端。`,
        logType: 'error', desc: '演示中止（步数超限）',
      });
      return snaps;
    }

    push('done', {
      log: `传输完成：${total} 帧全部正确交付上层。统计——共发送 ${st.tx + st.retx} 次`
        + `（新帧 ${st.tx} 次、重传 ${st.retx} 次）、数据帧丢失 ${st.lost} 次、确认丢失 ${st.ackLost} 次，`
        + `收到有效确认 ${st.ack} 个 + 重复确认 ${st.dup} 个。`
        + (proto === 'GBN'
          ? '回顾：GBN 失一帧要连坐重发其后所有帧，重传代价大，但接收方只需 1 个帧的缓冲。'
          : proto === 'SR'
            ? '回顾：SR 只重传真正丢失的那一帧，重传代价小，但接收方要缓存一个窗口的失序帧。'
            : '回顾：停止-等待 = 发送 / 接收窗口均为 1 的特例，一发一等，信道利用率最低。'),
      logType: 'success', desc: `完成：${total} 帧全部确认（重传 ${st.retx} 次）`,
    });
    return snaps;
  },

  render(ctx) {
    const { snap: s, model: m, stage } = ctx;
    const PNAME = { stop: '停止-等待', GBN: 'GBN 后退 N 帧', SR: 'SR 选择重传' };
    const W2 = 920, padL = 46, padR = 30, inner = W2 - padL - padR;
    const seqMax = s.seqMax, total = s.total, W = s.W, base = s.base;

    /* ---------------- ① 序号空间 ---------------- */
    const cw = Math.min(74, inner / seqMax);
    const sy = 26, sh = 40;
    const occupant = new Array(seqMax).fill(null);
    for (let o = 0; o < W && base + o < total; o++) occupant[(base + o) % seqMax] = base + o;
    const rcvWin = new Set();
    for (let o = 0; o < s.WR && s.rcvBase + o < total; o++) rcvWin.add((s.rcvBase + o) % seqMax);

    const seqCells = [];
    for (let i = 0; i < seqMax; i++) {
      const rf = occupant[i];
      let fill = '#f1f5f9', txt = '#94a3b8';
      if (rf !== null) {
        if (s.acked[rf]) { fill = '#10b981'; txt = '#fff'; }
        else if (s.sentEver[rf] && s.lostLast[rf]) { fill = '#f43f5e'; txt = '#fff'; }
        else if (s.sentEver[rf]) { fill = '#f59e0b'; txt = '#fff'; }
        else { fill = '#e0e7ff'; txt = '#4338ca'; }
      } else if (rcvWin.has(i)) { fill = '#e0f2fe'; txt = '#0369a1'; }
      const isCur = s.cur !== null && rf !== null && rf === s.cur
        && (s.step === 'tx' || s.step === 'tx-lost' || s.step === 'timeout');
      const x = padL + i * cw;
      seqCells.push(
        `<rect x="${x.toFixed(1)}" y="${sy}" width="${(cw - 5).toFixed(1)}" height="${sh}" rx="8" fill="${fill}"`
        + `${isCur ? ' stroke="#4f46e5" stroke-width="3"' : ''}/>
         <text x="${(x + (cw - 5) / 2).toFixed(1)}" y="${sy + 18}" text-anchor="middle" style="font:800 13px Consolas,monospace" fill="${txt}">${i}</text>
         <text x="${(x + (cw - 5) / 2).toFixed(1)}" y="${sy + 33}" text-anchor="middle" style="font:600 9.5px Consolas,monospace" fill="${txt}" opacity="0.85">${rf === null ? '—' : 'F' + rf}</text>`);
    }

    /* 窗口范围 → 若干段（回绕时是 2 段）——旧版在这里越界 */
    const spanParts = (from, count, cap) => {
      const parts = [];
      let sIdx = ((from % seqMax) + seqMax) % seqMax;
      let left = Math.min(count, cap, seqMax);
      let g = 0;
      while (left > 0 && g++ < 4) {
        const take = Math.min(left, seqMax - sIdx);
        parts.push([sIdx, take]);
        left -= take; sIdx = (sIdx + take) % seqMax;
      }
      return parts;
    };
    let sendRects = '';
    spanParts(base, W, total - base).forEach(([st0, cnt]) => {
      sendRects += `<rect x="${(padL + st0 * cw - 3).toFixed(1)}" y="${sy - 6}" width="${(cnt * cw + 1).toFixed(1)}" height="${sh + 12}" rx="11" fill="none" stroke="#4f46e5" stroke-width="2.5"/>`;
    });
    let recvBrackets = '';
    const brY = sy + sh + 4;
    spanParts(s.rcvBase, s.WR, total - s.rcvBase).forEach(([st0, cnt]) => {
      const x0 = padL + st0 * cw - 1, x1 = padL + st0 * cw + cnt * cw - 6;
      recvBrackets += `<path d="M${x0.toFixed(1)},${brY - 4} L${x0.toFixed(1)},${brY + 4} L${x1.toFixed(1)},${brY + 4} L${x1.toFixed(1)},${brY - 4}"`
        + ` fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-dasharray="5 3"/>`;
    });

    const leg1Y = brY + 20;
    const seqLegend =
      `<rect x="${padL}" y="${leg1Y - 8}" width="14" height="4" rx="2" fill="#4f46e5"/>
       <text x="${padL + 20}" y="${leg1Y - 3}" style="font:700 11px sans-serif" fill="#4338ca">发送窗口 W_T = ${W}（实线框，起始序号 ${base % seqMax}）</text>
       <rect x="${padL + 330}" y="${leg1Y - 6}" width="14" height="2.5" fill="#0ea5e9"/>
       <text x="${padL + 350}" y="${leg1Y - 3}" style="font:700 11px sans-serif" fill="#0369a1">接收窗口 W_R = ${s.WR}（虚线括号，期望序号 ${s.rcvBase % seqMax}）</text>
       <text x="${padL}" y="${leg1Y + 14}" style="font:600 10.5px sans-serif" fill="#64748b">序号循环使用：一格 = 一个序号，格内小字 = 当前占用该序号的真实帧号；窗口跨过末尾时框会拆成两段</text>`;

    /* ---------------- ② 信道 ---------------- */
    const t2 = leg1Y + 30;
    const boxW = 86, boxH = 34, chH = 62;
    const chL = padL + boxW + 8, chR = W2 - padR - boxW - 8;
    const cy = t2 + chH / 2;
    const flyW = 42, tx = chR - chL - flyW;
    const ackW = 54, txAck = chR - chL - ackW;   // ACK 片更宽，单独算行程，保证终点停在 chR（否则会压住接收方面板）

    let flying = '';
    if (s.step === 'tx' || s.step === 'tx-lost') {
      const lost = s.step === 'tx-lost';
      const isRetx = s.curKind === 'retx';
      const fill = lost ? '#f43f5e' : isRetx ? '#d97706' : '#4f46e5';
      flying += `<g class="sw-frame-g ${lost ? 'sw-lost' : ''}" style="--tx:${tx.toFixed(1)}px">
          <rect x="${chL}" y="${(cy - 14).toFixed(1)}" width="${flyW}" height="28" rx="7" fill="${fill}"/>
          <text x="${(chL + flyW / 2).toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" style="font:800 12px Consolas,monospace" fill="#fff">${isRetx ? 'F' + s.cur + '↻' : 'F' + s.cur}</text>
        </g>`;
    } else if (s.step === 'ack' || s.step === 'ack-dup' || s.step === 'ack-lost') {
      const cls = s.step === 'ack-lost' ? '#f43f5e' : s.step === 'ack-dup' ? '#f59e0b' : '#059669';
      const tail = s.step === 'ack-lost' ? '✗' : s.step === 'ack-dup' ? '↺' : '';
      flying += `<g class="sw-frame-g ${s.step === 'ack-lost' ? 'sw-lost' : 'sw-ack'}" style="--tx:${txAck.toFixed(1)}px">
          <rect x="${(chL + txAck).toFixed(1)}" y="${(cy - 14).toFixed(1)}" width="${ackW}" height="28" rx="7" fill="${cls}"/>
          <text x="${(chL + txAck + ackW / 2).toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" style="font:800 12px Consolas,monospace" fill="#fff">ACK${s.ackNum}${tail}</text>
        </g>`;
    }

    const panel = (x, title, sub, cls) =>
      `<rect x="${x}" y="${t2}" width="${boxW}" height="${boxH}" rx="10" fill="${cls[0]}" stroke="${cls[1]}"/>
       <text x="${x + boxW / 2}" y="${t2 + 15}" text-anchor="middle" style="font:800 11.5px sans-serif" fill="${cls[2]}">${title}</text>
       <text x="${x + boxW / 2}" y="${t2 + 28}" text-anchor="middle" style="font:600 10px Consolas,monospace" fill="${cls[2]}">${sub}</text>`;

    const chanSvg = `
      <line x1="${chL}" y1="${cy}" x2="${chR}" y2="${cy}" class="sw-channel"/>
      <text x="${((chL + chR) / 2).toFixed(1)}" y="${(cy - 22).toFixed(1)}" text-anchor="middle" style="font:700 10px sans-serif" fill="#94a3b8">单程信道（去程数据帧 / 回程确认帧）</text>
      ${panel(padL, '发送方', `窗 [${base},${base + W - 1}]`, ['#eef2ff', '#a5b4fc', '#4338ca'])}
      ${panel(W2 - padR - boxW, '接收方', `期望 ${s.rcvBase}`, ['#f0fdfa', '#5eead4', '#0f766e'])}
      ${flying}`;

    /* ---------------- ③ 逐帧状态 ---------------- */
    const t3 = t2 + chH + 26;
    const fw = Math.min(70, inner / total);
    const cellW = Math.max(6, fw - 3);
    const row1Y = t3 + 14, rowH = 30;
    const br1Y = row1Y + rowH + 6;
    const row2Y = br1Y + 16;
    const br2Y = row2Y + rowH + 6;

    const sendRow = [];
    for (let f = 0; f < total; f++) {
      let fill = '#f1f5f9', txt = '#94a3b8';
      if (s.acked[f]) { fill = '#10b981'; txt = '#fff'; }
      else if (s.sentEver[f] && s.lostLast[f]) { fill = '#f43f5e'; txt = '#fff'; }
      else if (s.sentEver[f]) { fill = '#f59e0b'; txt = '#fff'; }
      const isCur = f === s.cur && (s.step === 'tx' || s.step === 'tx-lost' || s.step === 'timeout');
      const x = padL + f * fw;
      sendRow.push(`<rect x="${x.toFixed(1)}" y="${row1Y}" width="${cellW.toFixed(1)}" height="${rowH}" rx="6" fill="${fill}"${isCur ? ' stroke="#4f46e5" stroke-width="2.5"' : ''}/>
        <text x="${(x + cellW / 2).toFixed(1)}" y="${row1Y + 19}" text-anchor="middle" style="font:700 10px Consolas,monospace" fill="${txt}">F${f}</text>`);
    }
    const recvRow = [];
    for (let f = 0; f < total; f++) {
      let fill = '#f8fafc', txt = '#cbd5e1';
      if (s.delivered[f]) { fill = '#10b981'; txt = '#fff'; }
      else if (s.buffered[f]) { fill = '#a78bfa'; txt = '#fff'; }
      const x = padL + f * fw;
      const marks = (s.discards[f] ? `✗${s.discards[f]}` : '') + (s.ackLostMark[f] ? ' ACK✗' : '');
      recvRow.push(`<rect x="${x.toFixed(1)}" y="${row2Y}" width="${cellW.toFixed(1)}" height="${rowH}" rx="6" fill="${fill}"/>
        <text x="${(x + cellW / 2).toFixed(1)}" y="${row2Y + 19}" text-anchor="middle" style="font:700 10px Consolas,monospace" fill="${txt}">F${f}</text>
        ${marks ? `<text x="${(x + cellW / 2).toFixed(1)}" y="${row2Y - 5}" text-anchor="middle" style="font:800 9px sans-serif" fill="#e11d48">${marks}</text>` : ''}`);
    }
    const winRect = (y, h, from, cnt) => {
      const a = Math.max(0, from), b = Math.min(total - 1, from + cnt - 1);
      if (b < a) return '';
      const x0 = padL + a * fw - 3, x1 = padL + b * fw + cellW + 3;
      return `<rect x="${x0.toFixed(1)}" y="${y}" width="${(x1 - x0).toFixed(1)}" height="${h}" rx="9" fill="none" stroke="#4f46e5" stroke-width="2.5"/>`;
    };
    const rowLabels =
      `<text x="${padL - 8}" y="${row1Y + 20}" text-anchor="end" style="font:800 10.5px sans-serif" fill="#4338ca">发送方</text>
       <text x="${padL - 8}" y="${row2Y + 20}" text-anchor="end" style="font:800 10.5px sans-serif" fill="#0f766e">接收方</text>`;

    const leg2Y = br2Y + 20;
    const leg2 =
      `<text x="${padL}" y="${leg2Y}" style="font:700 10px sans-serif" fill="#64748b">
         <tspan fill="#10b981">■</tspan> 已确认 / 已交付上层
         <tspan fill="#f59e0b">■</tspan> 已发待确认
         <tspan fill="#f43f5e">■</tspan> 该次传输丢失
         <tspan fill="#a78bfa">■</tspan> SR 缓存（失序）
         <tspan fill="#e2e8f0">■</tspan> 未发送 / 未收到
         <tspan fill="#e11d48">✗n</tspan> 接收方丢弃 n 次
         <tspan fill="#e11d48">ACK✗</tspan> 该帧的确认丢失
       </text>`;

    const svgH = leg2Y + 12;

    /* ---------------- 统计卡 ---------------- */
    const evName = {
      init: '就绪', tx: s.curKind === 'retx' ? '重传到达' : '发送新帧',
      'tx-lost': s.curKind === 'retx' ? '重传又丢失' : '数据帧丢失',
      ack: '确认到达（滑窗）', 'ack-dup': '重复确认到达', 'ack-lost': '确认丢失',
      timeout: '超时', done: '完成', guard: '中止',
    }[s.step] || '—';
    const statsHtml =
      RC408.ui.statCard('协议 / 窗口', PNAME[s.proto], `W_T = ${W}｜W_R = ${s.WR}｜序号 ${s.n} bit`, 'text-indigo-600')
      + RC408.ui.statCard('发送方', `[${base}, ${base + W - 1}]`, `next = ${s.next}｜在途 ${Math.max(0, s.next - base)} 帧｜已确认 ${s.acked.filter(Boolean).length}/${total}`, 'text-violet-600')
      + RC408.ui.statCard('接收方', `期望 ${s.rcvBase}`, `已交付 ${s.delivered.filter(Boolean).length}｜缓存 ${s.buffered.filter(Boolean).length}｜丢弃 ${s.discards.reduce((a, b) => a + b, 0)} 次`, 'text-sky-600')
      + RC408.ui.statCard('本帧事件', evName, s.cur === null ? `已发送 ${s.stats.tx + s.stats.retx} 次` : `涉及帧 ${s.cur}`, 'text-amber-600');

    /* ---------------- 信道利用率卡 ---------------- */
    const ch = m.ch;
    const fmt = x => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
    const uRow = (name, w, u, cur) =>
      `<tr class="${cur ? 'row-cur' : ''}"><td>${name}</td><td>${w}</td>`
      + `<td>${RC408.util.pct(u)}</td><td>${u >= ch.target ? '✅ 达标' : '—'}</td></tr>`;
    const utilHtml = `
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        ${RC408.ui.sectionTitle('信道利用率（按左侧 L / 速率 / 时延参数即时算出，与播放进度无关）')}
        <div class="text-xs text-slate-600 leading-relaxed mb-2">
          T_d = L / R = ${ch.L} bit ÷ ${ch.Rt} kb/s = <b>${fmt(ch.Td)} ms</b>　｜　
          RTT = 2D = <b>${fmt(ch.RTT)} ms</b>　｜　
          T_a = <b>${fmt(ch.Ta)} ms</b>　｜　
          周期 = T_d + RTT + T_a = <b>${fmt(ch.cycle)} ms</b>
        </div>
        <table class="tbl w-full">
          <thead><tr><th>发送方式</th><th>W_T</th><th>利用率 U = W·T_d / 周期</th><th>U ≥ ${Math.round(ch.target * 100)}%</th></tr></thead>
          <tbody>
            ${uRow('停止-等待', 1, ch.Ustop, s.proto === 'stop')}
            ${uRow(PNAME[s.proto], W, ch.Ucur, s.proto !== 'stop')}
          </tbody>
        </table>
        <div class="text-xs text-slate-600 leading-relaxed mt-2">
          要让 U ≥ ${Math.round(ch.target * 100)}%：W_T ≥ ⌈${ch.target} × ${fmt(ch.cycle)} ÷ ${fmt(ch.Td)}⌉ = <b>${ch.wMin}</b> 帧　→　
          GBN 需 2ⁿ ≥ W_T+1 = ${ch.wMin + 1}，即 <b>n ≥ ${ch.kGBN} bit</b>；
          SR 需 2ⁿ⁻¹ ≥ W_T = ${ch.wMin}，即 <b>n ≥ ${ch.kSR} bit</b>。
        </div>
        <div class="text-[11px] text-slate-400 mt-1.5">
          ${ch.Ucur >= 1 ? '当前窗口已能把"发送 + 往返 + 确认"周期填满（U 上限 100%），再加大窗口不会提高利用率。<br>' : ''}
          T_a = 0 表示忽略确认帧开销；捎带确认时 T_a = T_d（2017-47），确认帧等长同速率时 T_a 也等于 T_d（2020-36）。
        </div>
      </div>`;

    const ackTrace = s.acked.map((a, i) => a ? i : null).filter(v => v !== null);
    const trace = ackTrace.length > 18 ? ackTrace.slice(0, 18).join('·') + '…' : (ackTrace.join('·') || '（无）');

    const tip = s.proto === 'GBN'
      ? `GBN 接收窗口 = 1：失序帧当场丢弃（接收方一行会记 ✗ 次数），确认是累积式的；超时后要把窗口内其后所有帧一起重发。`
      : s.proto === 'SR'
        ? `SR 接收窗口 = 发送窗口（这里 ${s.WR}）：失序帧先缓存（紫色），缺口补齐后连同后续帧一并上交；每帧独立确认，超时只重发那一帧。`
        : `停止-等待 = 发送 / 接收窗口均为 1 的特例：发一帧等一个确认，信道利用率最低。`;

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${statsHtml}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 overflow-x-auto">
          ${RC408.ui.sectionTitle(`① 序号空间（mod 2^${s.n} = ${seqMax}，共 ${total} 个数据帧）　② 信道　③ 逐帧状态`)}
          <svg viewBox="0 0 ${W2} ${svgH}" class="w-full h-auto mx-auto" style="max-width:${W2}px">
            ${seqCells.join('')}${sendRects}${recvBrackets}${seqLegend}
            ${chanSvg}
            ${rowLabels}${sendRow.join('')}${recvRow.join('')}
            ${winRect(row1Y - 5, rowH + 10, base, W)}
            ${winRect(row2Y - 5, rowH + 10, s.rcvBase, s.WR)}
            ${leg2}
          </svg>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${utilHtml}
          <div class="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-xs text-indigo-900 leading-relaxed">
            ${RC408.ui.sectionTitle('考点提醒')}
            💡 ${tip}
            <div class="mt-2">已确认帧（累计）：<span class="font-mono font-bold">${trace}</span></div>
            <div class="mt-2">序号不歧义条件：W_T + W_R = ${W} + ${s.WR} = <b>${W + s.WR}</b> ≤ 2^${s.n} = <b>${seqMax}</b>
              ${W + s.WR <= seqMax ? '✅ 当前取值合法' : '❌ 会产生序号歧义'}</div>
            <div class="mt-2">统计：新帧 ${s.stats.tx} 次｜重传 ${s.stats.retx} 次｜数据帧丢失 ${s.stats.lost} 次｜确认丢失 ${s.stats.ackLost} 次｜有效确认 ${s.stats.ack} 个｜重复确认 ${s.stats.dup} 个</div>
          </div>
        </div>
      </div>`;
  },
});

/* 预设按钮共用的批量赋值（模块内工具，加 _sw 前缀避免污染全局，§3.1-3） */
function _swSetAll(rt, proto, n, wt, total, loss, L, Rt, D, Ta) {
  rt.setInput('proto', proto);
  rt.setInput('n', n);
  rt.setInput('total', total);
  rt.setInput('loss', loss);
  rt.setInput('L', L);
  rt.setInput('Rt', Rt);
  rt.setInput('D', D);
  rt.setInput('Ta', Ta);
  rt.setInput('wt', wt);          // 放在 proto 之后：停等时 bindInputs 会把它置 1，这里再显式写一次
  if (rt.def && rt.def.syncInputs) rt.def.syncInputs(rt.inputEls);
  rt.load();
}
