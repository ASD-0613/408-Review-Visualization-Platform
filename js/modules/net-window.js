'use strict';
/* ============================================================================
 * net-window.js —— 【计算机网络】滑动窗口可靠传输：停等 / GBN / SR（前缀 _sw）
 * 考情：17 年中 11 年（2017-47 大题双向 GBN+捎带确认、2013-35 三协议利用率、
 * 2015-35/2019-35/2023-35 窗口与序号计算、2011-35 SR 重传帧数、2024-37 SR 确认丢失）。
 * 快照：每个事件（发送/收确认/超时重传）一帧，发送/接收窗口滑动可视化。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-window',
  mode: 'stepper',
  title: '滑动窗口可靠传输（停等 · GBN · SR）',

  theory: `
> **真题考情**：17 年中 11 年考（2017-47 大题、2013-35 三协议利用率排序、
> 2015-35 帧序号比特数、2019-35 接收窗口最大值、2021-35 独立确认、2023-35 利用率大小关系、
> 2024-37 SR 确认丢失判断、2011-35 SR 重传）。

## 三种协议的窗口（发送 W_T / 接收 W_R）
| 协议 | 发送窗口 | 接收窗口 | 失一帧的处理 |
| --- | --- | --- | --- |
| 停止-等待 | 1 | 1 | 重传上帧 |
| **GBN 后退N帧** | ≤ 2ⁿ − 1 | **1** | 该帧及**之后全部重传**（累积确认） |
| **SR 选择重传** | ≤ 2ⁿ⁻¹（= 接收窗） | > 1 | **只重传失帧**（独立确认） |

## 必背公式
- **信道利用率 U = W_T × L / (R × (L/C + RTT))**（帧长 L、速率 R、单向传播 C）；
- 序号 n bit 时窗口受限：W_T + W_R ≤ 2ⁿ（GBN 取 2ⁿ−1、SR 取 2ⁿ⁻¹ 才无歧义）；
- 利用率不足 80% 需要"加长帧 / 加大窗口 / 增序号位"是经典推导（2015 真题）。

## 考点提示
- GBN 收到失序帧一律丢弃（接收窗 = 1）；SR 可缓存失序帧、等到缺帧补齐再上交；
- 确认号含义不同：GBN 是"累积确认（到 n 号为止全收到）"，SR 是"逐帧确认"；
- 2024 真题：SR 中 ACK 丢失不重传——因接收方能通过后续 ACK 判断。
`,

  inputs: [
    {
      key: 'proto', label: '协议', type: 'select', default: 'GBN', wide: true,
      options: [{ v: 'stop', t: '停止-等待（W=1）' }, { v: 'GBN', t: 'GBN 后退 N 帧' }, { v: 'SR', t: 'SR 选择重传' }],
    },
    { key: 'n', label: '帧序号位数 n（序号 0 ~ 2ⁿ−1）', type: 'select', default: 3, options: [2, 3, 4].map(v => ({ v, t: `${v} bit（${Math.pow(2, v)} 个序号）` })) },
    { key: 'wt', label: '发送窗口大小 W_T', type: 'text', default: '5' },
    { key: 'loss', label: '丢失/出错事件（帧号:第几次传输，可选）', type: 'text', default: '2:1', ph: '如 2:1 表示 2 号帧首次传输丢失', wide: true },
    { key: 'total', label: '要发送的数据帧总数', type: 'text', default: '8' },
  ],

  quickActions: [
    { label: 'SR 确认丢失示例', run(rt) { rt.setInput('proto', 'SR'); rt.setInput('loss', '1:1'); rt.setInput('total', '6'); rt.load(); } },
  ],

  parse(vals) {
    const proto = ['stop', 'GBN', 'SR'].includes(vals.proto) ? vals.proto : 'GBN';
    const n2 = parseInt(vals.n, 10);
    const wt = parseInt(vals.wt, 10);
    const total = parseInt(vals.total, 10);
    const maxW = proto === 'stop' ? 1 : proto === 'GBN' ? Math.pow(2, n2) - 1 : Math.pow(2, n2 - 1);
    if (!(wt >= 1 && wt <= maxW)) throw { message: `该协议下发送窗口须为 1 ~ ${maxW}（序号 ${n2} bit：GBN 上限 2ⁿ−1=${Math.pow(2, n2) - 1}，SR 上限 2ⁿ⁻¹=${Math.pow(2, n2 - 1)}）` };
    if (!(total >= 4 && total <= Math.pow(2, n2) * 2)) throw { message: `数据帧总数须在 4 ~ ${Math.pow(2, n2) * 2}` };
    const loss = {};
    (vals.loss || '').split(/[,，;；]+/).map(x => x.trim()).filter(Boolean).forEach(tok => {
      const m2 = tok.match(/^(\d+)\s*[:：]\s*(\d+)$/);
      if (!m2) throw { message: `丢失事件「${tok}」格式错误，应为 帧号:第几次传输（如 2:1）` };
      loss[+m2[1] * 100 + (+m2[2] - 1)] = true;   // key = frame*100 + attempt
    });
    return { proto, n: n2, wt, total, loss };
  },

  buildSnapshots(model) {
    const { proto, n, wt, total, loss } = model;
    const seqMax = Math.pow(2, n);           // 序号 0..seqMax-1
    const W = proto === 'stop' ? 1 : wt;
    let base = 0;                            // 发送窗口基序号（最小未确认）
    let next = 0;                            // 下一个待发送帧号
    const acked = new Set();                 // SR：已确认集合（按序号，含重复帧的多次传输）
    let rcvrExpect = 0;                      // 接收方期望帧号（GBN/停等）
    const rcvrBuffered = new Set();          // SR 接收缓存
    let sentTimes = {};                      // "frame#attempt" → 是否已尝试
    let timeoutAt = {};                      // 帧号 → 需要超时重传标记
    const ackList = [];                      // 已收到的 ACK 序列
    const snaps = [];
    let steps = 0;
    const push = (step, o) => snaps.push({
      step, proto, n, W, base, next: next % seqMax, acked: [...acked], rcvrExpect,
      rcvrBuffered: [...rcvrBuffered], ackList: [...ackList],
      inflight: [], cur: null, note: '', log: '', logType: 'info', desc: '',
      loss, total, seqMax, ...o,
    });

    const inflightNow = () => {
      const arr = [];
      for (let f = base; f < base + W && f < total + 0; f++) {
        if (proto === 'SR' ? (acked.has(f % seqMax) ? false : true) : f >= base && f < Math.min(next, base + W)) arr.push(f);
      }
      return arr.slice(0, W);
    };

    push('init', {
      log: `就绪：${{ stop: '停止-等待', GBN: 'GBN 后退 N 帧', SR: 'SR 选择重传' }[proto]}，序号 ${n} bit（0~${seqMax - 1}），发送窗口 W_T = ${W}，共 ${total} 帧待发。`,
      desc: '点击「单步执行」：每帧依次为 发送 →（丢失/到达）→ 确认 → 滑动',
    });

    let guard = 0;
    while (base < total && guard++ < 200) {
      /* ① 发送：窗口内还有可发的帧 */
      let sent = 0;
      while (next < base + W && next < total && sent < W) {
        const f = next % seqMax;
        const attempt = (sentTimes[f] || 0) + 1;
        sentTimes[f] = attempt;
        const lost = loss[next * 100 + (attempt - 1)] !== undefined;   // 注意：loss 用真实帧号
        const realLost = loss[(base + sent) * 100 + (attempt - 1)] !== undefined;
        next++;
        sent++;
        if (realLost) {
          if (proto === 'SR') timeoutAt[next - 1] = true;
          else timeoutAt[next - 1] = true;
          push('send-lost', {
            cur: next - 1, inflight: inflightNow(),
            log: `发送帧 ${next - 1}（第 ${attempt} 次传输）→ **丢失/出错**！${proto === 'GBN' ? '发送方将在超时后重传该帧及其后所有已发帧' : proto === 'SR' ? '发送方超时后**只重传这一帧**' : '超时后重传该帧'}`,
            logType: 'error', desc: `帧 ${next - 1} 丢失（第 ${attempt} 次）`,
          });
        } else {
          push('send', {
            cur: next - 1, inflight: inflightNow(),
            log: `发送帧 ${next - 1}（第 ${attempt} 次传输）→ 到达接收方`,
            logType: 'info', desc: `发送帧 ${next - 1}`,
          });
          /* 接收方行为 */
          if (proto === 'SR') {
            if (!rcvrBuffered.has(f) && !acked.has(f)) rcvrBuffered.add(f);
          } else if (f === rcvrExpect) {
            rcvrExpect = (rcvrExpect + 1) % seqMax;
          }
        }
        /* 收到 ACK（无丢失的帧会立即回 ACK） */
        const frameNum = next - 1;
        if (!realLost) {
          if (proto === 'SR') {
            if (!acked.has(frameNum)) {
              acked.add(frameNum);
              ackList.push(frameNum);
              /* SR：滑动 base 越过连续已确认的帧 */
              while (acked.has(base % seqMax)) { base++; }
              push('ack', {
                cur: frameNum, inflight: inflightNow(),
                log: `收到帧 ${frameNum} 的独立确认 ✓${base > 0 ? ` → 发送窗口滑动至 [${base}, ${base + W - 1}]` : ''}`,
                logType: 'success', desc: `ACK ${frameNum}，窗口滑动`,
              });
            }
          } else {
            /* 停等 / GBN：累积确认（这里按帧号=期望值时确认） */
            if (frameNum === ((rcvrExpect + seqMax - 1) % seqMax) || ackList.length === 0) {
              ackList.push(frameNum);
              if (frameNum === rcvrExpect) rcvrExpect = (rcvrExpect + 1) % seqMax;
              /* GBN/停等：确认帧 f → base = f+1 */
              base = frameNum + 1;
              push('ack', {
                cur: frameNum, inflight: inflightNow(),
                log: `收到帧 ${frameNum} 的确认（累积确认，到该帧为止全部收到 ✓）→ 发送窗口滑动至 [${base}, ${base + W - 1}]`,
                logType: 'success', desc: `确认 ${frameNum}，窗口滑动`,
              });
            }
          }
        }
      }
      /* ② 超时：窗口内最老的未确认帧重传 */
      if (base < total) {
        /* 找最老的未确认帧 */
        let t = base;
        if (proto === 'SR') { while (acked.has(t % seqMax) && t < total) t++; }
        if (t >= total) break;
        const f = t % seqMax;
        const attempt = (sentTimes[f] || 0) + 1;
        sentTimes[f] = attempt;
        const realLost = loss[t * 100 + (attempt - 1)] !== undefined;
        push('timeout', {
          cur: t, inflight: inflightNow(),
          log: realLost
            ? `超时重传帧 ${t}（第 ${attempt} 次）→ 又丢失！`
            : `**超时**：重传${proto === 'GBN' ? '帧 ' + t + ' 及其之后所有已发送的帧（后退 N 帧）' : '帧 ' + t + '（选择重传）'}`,
          logType: 'error', desc: `超时重传 ${t}`,
        });
        if (!realLost) {
          if (proto === 'SR') {
            acked.add(t % seqMax); ackList.push(t);
            while (acked.has(base % seqMax)) base++;
            push('ack', { cur: t, log: `收到重传帧 ${t} 的确认 ✓ → 窗口滑动`, logType: 'success', desc: `ACK ${t}` });
          } else {
            ackList.push(t);
            base = t + 1;
            push('ack', { cur: t, log: `收到重传帧 ${t} 的确认（累积）→ 窗口滑动至 [${base}, ${base + W - 1}]`, logType: 'success', desc: `确认 ${t}` });
          }
        }
      }
    }

    push('done', {
      log: `传输完成：${total} 帧全部确认。协议特点回顾——${proto === 'GBN' ? 'GBN 失一帧后退 N 帧（重传多但接收简单）' : proto === 'SR' ? 'SR 只重传失帧（重传少但需接收缓存）' : '停等 = 窗口为 1 的特例'}。`,
      logType: 'success', desc: `完成！${total} 帧全部确认`,
    });
    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const W = 900, H = 170, padL = 40;
    const cw = Math.min(64, (W - padL - 30) / Math.max(s.seqMax, 1));
    const px = f => padL + f * cw;

    /* 序号轴：发送窗口框 + 帧状态色 */
    const cells = [];
    for (let f = 0; f < s.seqMax; f++) {
      const acked = s.acked.includes(f);
      const inWin = f >= s.base % s.seqMax && f < (s.base % s.seqMax) + s.W;
      const isCur = s.cur === f && (s.step === 'send' || s.step === 'send-lost');
      const color = acked ? '#10b981' : isCur && s.step === 'send-lost' ? '#f43f5e' : isCur ? '#f59e0b' : inWin ? '#6366f1' : '#e2e8f0';
      const txt = acked || isCur || inWin ? '#fff' : '#94a3b8';
      cells.push(`<rect x="${px(f)}" y="60" width="${cw - 6}" height="40" rx="6" fill="${color}"/>
        <text x="${px(f) + (cw - 6) / 2}" y="85" text-anchor="middle" style="font:800 13px Consolas" fill="${txt}">${f}</text>`);
    }
    /* 发送窗口框 */
    const winX = px(s.base % s.seqMax) - 3;
    const winW = s.W * cw;
    const winBox = `<rect x="${winX}" y="52" width="${Math.min(winW, s.seqMax * cw)}" height="56" rx="9" fill="none" stroke="#4f46e5" stroke-width="2.5"/>
      <text x="${winX}" y="46" style="font:700 10px sans-serif" fill="#4f46e5">发送窗口 W_T=${s.W}：[${s.base % s.seqMax}, ${(s.base % s.seqMax) + s.W - 1}]（模 ${s.seqMax}）</text>`;

    const stats =
      RC408.ui.statCard('协议', { stop: '停止-等待', GBN: 'GBN 后退 N 帧', SR: 'SR 选择重传' }[s.proto], `序号 ${s.n} bit（模 ${s.seqMax}）`, 'text-indigo-600') +
      RC408.ui.statCard('发送窗口', `W_T = ${s.W}`, `基序号 ${s.base % s.seqMax}`, 'text-indigo-600') +
      RC408.ui.statCard('已确认', `${s.acked.length} 个序号`, '绿色帧', 'text-emerald-600') +
      RC408.ui.statCard('本帧事件', { send: '发送', 'send-lost': '发送后丢失', ack: '收到确认', timeout: '超时重传', init: '—', done: '完成' }[s.step] || '—', s.cur !== null && s.cur !== undefined ? `帧 ${s.cur}` : '', 'text-amber-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 overflow-x-auto">
          ${RC408.ui.sectionTitle(`发送窗口与序号环（共 ${s.seqMax} 个序号；紫框 = 发送窗口；绿 = 已确认，琥珀/红 = 窗口内未确认）`)}
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">
            ${cells.join('')}${winBox}
            <text x="${padL}" y="130" style="font:600 10.5px sans-serif" fill="#64748b">已收确认序列：${s.ackList.join(' → ') || '（无）'}</text>
            <text x="${padL}" y="150" style="font:600 10.5px sans-serif" fill="#64748b">接收方期望帧号：${s.rcvrExpect}${s.rcvrBuffered.length && s.proto === 'SR' ? '（SR 缓存的失序帧：' + s.rcvrBuffered.join(',') + '）' : ''}</text>
          </svg>
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>${s.proto === 'GBN'
          ? 'GBN 接收窗口 = 1：失序帧丢弃；确认是累积式——收到 ACK n 表示 n 及之前全部收到。'
          : s.proto === 'SR'
            ? 'SR 接收窗口 > 1：失序帧缓存、逐帧确认；ACK 丢失不一定要重传（后续 ACK 可证明收到）。'
            : '停等协议 = 发送/接收窗口均为 1 的特例，每发一帧等一个确认。'}
          考试常考：给定信道参数求"利用率 ≥ 80% 需要的窗口/序号位数"。
        </div>
      </div>`;
  },
});
