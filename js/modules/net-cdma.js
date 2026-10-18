'use strict';
/* ============================================================================
 * net-cdma.js —— 【计算机网络】CDMA 码分多址：码片序列内积判定（前缀 _cdma）
 *
 * 考情：1 年 / 1 题（选 1）—— 2014-37：站点 A / B / C 的码片序列分别是 (1,1,1,1)、(1,-1,1,-1)、
 *   (1,1,-1,-1)，C 从链路上收到 (2,0,2,0, 0,-2,0,-2, 0,2,0,2)（12 位 = 3 段 × 4 片）
 *   ⟹ 逐段与 A 的码片做内积再除以 4 得 +1 / -1 / +1 ⟹ A 发送的数据是 101（选项 B）。
 *   ★ 窗53 从零核定（证据 `考情缓存/2014_真题.txt:325-332`）：其余 17 年按「CDMA / 码分 / 码片 /
 *   内积 / 多址 / 扩频 / 正交」七个关键词搜遍全部缓存 txt，共 0 命中；2011-36 只在选项里出现 CDMA
 *   （考点是 CSMA/CA），不计入本条目；2023 卷面无文本层，但该年计网 8 道选择题（33~40）在窗43
 *   已全部登记到非 CDMA 条目（net-perf / net-shannon / net-window / net-csma / net-crc / net-arp /
 *   net-subnet / net-ipv6）⟹ 2023 也已排除。
 *
 * 快照模型（stepper）：逐段 → 逐片乘加（各站部分和同步推进）→ 段末内积 ÷ m 判三态 → 收尾验算。
 *
 * 数据模型与不变量（冒烟逐条断言，别只靠眼看）：
 *   ① m = 各站码片序列长度，必须**全部相等**且 ∈ [2,16]；每站码片只含 ±1（反码 = 逐位取负）；
 *   ② nBits = recv.length / m 必须**整除**（收方拿到的是「段数 × m」位叠加信号），1 ≤ nBits ≤ 8；
 *   ③ 第 g 段第 s 站内积 ip(s,g) = Σ_j recv[g·m+j] · seq_s[j]；
 *   ④ **核心不变量**：无噪声且码片正交时 ip(s,g) ∈ {+m, 0, −m} ⟹ 归一化后恰好 +1 / 0 / −1 三态；
 *      取不到这三值 ⟹ 码片不正交（或有噪声），该段标「判不出」，**不硬猜成 0/1**；
 *   ⑤ 归一化内积 ortho[i][j] = Σ_c seq_i[c]·seq_j[c] / m：i = j 必为 1；i ≠ j 全为 0 才算「正交码组」；
 *   ⑥ 「发 0」发的是反码（−C）、「没发」放的是全 0 向量 ⟹ 归一化内积分别得 −1 与 0，两件事不能混；
 *   ⑦ 末帧验算：按判定出的系数把各站向量逐位相加，必须逐位等于收到的序列（正交且判对时必然成立）。
 *
 * ⚠ 布局纪律（§4.7，窗26 立）：容器布局一律写**内联 style**，不用 Tailwind 工具类（离线 harness
 *   不加载 Tailwind）；类名只当**选择器**给断言用（`cdma-*`）。
 * ========================================================================== */

/* 各站配色（按站序循环取用） */
const _cdmaColors = ['#4f46e5', '#0891b2', '#d97706', '#059669', '#db2777'];

RC408.registerModule({
  id: 'net-cdma',
  mode: 'stepper',
  title: 'CDMA 码分多址：码片序列内积判定',

  theory: `
> **为什么要有它**：多个站点共享一条链路时，**时分（TDMA）与频分（FDMA）都要把时间或频率切成互不重叠的小块**，每站只能用其中一块。**码分多址（CDMA）反其道而行——所有站同时、同频发**，靠给每站分配一套**互相正交的码片序列**，让收方用某一站的码片序列对叠加信号做**内积**，就能单独把这一站的数据抠出来，别的站的成分积完自动归零。
> **怎么实现**：每站一套 m 位码片序列 C（元素只取 +1 / −1，且两两正交）。**发比特 1 就发 C，发比特 0 就发 C 的反码 −C，这一段不发则放全 0 向量**；链路上收到的是所有在发站向量的**逐位叠加**。收方把接收序列**每 m 位切成一段**，逐段与目标站码片做内积再**除以 m**：得 +1 ⟹ 这一站该段发的是 1，得 −1 ⟹ 发的是 0，得 0 ⟹ 该段没发。
> **记住什么**：**内积 ÷ m 的三态判据（+1 / 0 / −1）**，以及**正交性是能分开的唯一前提**——不正交就会出现 ±2 这类「判不出」的值，别硬猜。

## 正交码片：CDMA 能用的前提

| 要求 | 含义 | 判据 |
| --- | --- | --- |
| 每站一套等长 m 位码片，元素只取 +1 / −1 | 反码就是逐位取负 | 逐位检查 |
| 自内积 = m | 自己与自己完全对齐 | \\(\\sum_{j} c_j c_j = m\\) |
| 两两正交：内积 = 0 | 别站对本站的内积没有贡献 | \\(\\sum_{j} c_j d_j = 0\\) |

## 三态判据：收方怎么把某站抠出来

1. 接收序列 S 共 \\(k \\times m\\) 位 ⟹ 切成 k 段，**每段对应一个比特**；
2. 第 g 段与目标站码片 C 的内积 \\(I = \\sum_{j=0}^{m-1} S_{gm+j} C_j\\)；
3. **归一化** \\(I / m\\) 判三态：+1 ⟹ 发 1；−1 ⟹ 发 0；0 ⟹ 该段没发。
   ⚠ 只算内积不除 m，得到的是 +m / 0 / −m，选项里常拿它当错项。

## 发送侧：1 发原码、0 发反码、不发就放全 0

| 这一站这一段要发的 | 它往链路上放的向量 |
| --- | --- |
| 比特 1 | 原码 C |
| 比特 0 | 反码 −C（逐位取负） |
| 不发（空闲） | 全 0 向量 |

链路信号 = 所有在发站向量的逐位之和。

## 手算格式（2014-37 就是这一套）

1. 数接收序列有多少位、码片多长，**段数 = 位数 ÷ m**；
2. 把**每一段**与目标站码片**逐位相乘再求和**，不要整体估；
3. 除以 m 查三态表，逐段拼出该站的数据。

## 考点提醒（易错点）

1. **一定记得除以 m**：不除只能得到 ±m 或 0，看不出 +1 / 0 / −1；
2. **「内积 = 0」是这一段没发，不是「发了 0」**：发 0 会得到 −m（归一化后 −1），两者必须分清；
3. **只有正交的码片才能分开**：两站码片相同或部分不正交时，内积会出现 ±2 这类值 ⟹ **判不出**，别硬猜成 0 或 1；
4. **比特 0 发的是反码**，与「什么都不发」是两回事；
5. 接收序列里的数是**叠加值**，出现 ±2、±3 都正常（绝对值最多 = 同时在发的站数）。

> **真题考情**：**1/18 年（选 1、无大题）**：2014-37（A / B / C 三站码片序列 (1,1,1,1) / (1,−1,1,−1) / (1,1,−1,−1)，收到的 12 位序列逐段与 A 做内积再除以 4 ⟹ A 发送的数据是 101）。
`,

  inputs: [
    { key: 'stations', label: '各站码片序列（每行一站：名称: ±1,±1,…）', type: 'textarea', wide: true,
      default: 'A: 1,1,1,1\nB: 1,-1,1,-1\nC: 1,1,-1,-1',
      help: '每站一套等长码片序列，元素只取 +1 / −1，且两两正交；2 ~ 5 行、每行 2 ~ 16 片' },
    { key: 'recv', label: '收到的叠加序列（逗号或空格分隔的整数）', type: 'textarea', wide: true,
      default: '2,0,2,0,0,-2,0,-2,0,2,0,2',
      help: '长度必须是码片长度的整数倍：每 m 片是一段，一段对应一个比特' },
  ],

  quickActions: [
    { label: '🎯 2014-37 真题（C 收到 A 的数据）', run(rt) {
      rt.setInput('stations', 'A: 1,1,1,1\nB: 1,-1,1,-1\nC: 1,1,-1,-1');
      rt.setInput('recv', '2,0,2,0,0,-2,0,-2,0,2,0,2');
      rt.load();
    } },
    { label: '两站对照：A 发 101、B 发 010', run(rt) {
      rt.setInput('stations', 'A: 1,1,1,1\nB: 1,-1,1,-1');
      rt.setInput('recv', '0,2,0,2,0,-2,0,-2,0,2,0,2');
      rt.load();
    } },
    { label: '有一段「没发」（内积 = 0）', run(rt) {
      rt.setInput('stations', 'A: 1,1,1,1\nB: 1,-1,1,-1\nC: 1,1,-1,-1');
      rt.setInput('recv', '0,2,0,2,2,0,2,0,1,1,1,1');
      rt.load();
    } },
    { label: '单站无干扰（0 就是反码）', run(rt) {
      rt.setInput('stations', 'A: 1,1,1,1');
      rt.setInput('recv', '-1,-1,-1,-1,1,1,1,1,-1,-1,-1,-1');
      rt.load();
    } },
    { label: '⚠ 码片不正交（出现「判不出」）', run(rt) {
      rt.setInput('stations', 'A: 1,1,1,1\nB: 1,1,1,1');
      rt.setInput('recv', '2,2,2,2,-2,-2,-2,-2');
      rt.load();
    } },
  ],

  parse(vals) {
    const lines = String(vals.stations || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) throw { message: '至少要有一行码片序列' };
    if (lines.length > 5) throw { message: '最多演示 5 个站（现在 ' + lines.length + ' 行）' };

    const stations = lines.map((ln, i) => {
      const mm = ln.match(/^([^:：]{1,6})\s*[:：]\s*(.+)$/);
      if (!mm) throw { message: '第 ' + (i + 1) + ' 行格式应为「名称: 1,-1,1,-1」，实际是「' + ln + '」' };
      const name = mm[1].trim();
      const seq = _cdmaNums(mm[2]);
      if (seq.length < 2 || seq.length > 16) throw { message: '「' + name + '」的码片长度须为 2 ~ 16（现在 ' + seq.length + '）' };
      const bad = seq.findIndex(v => v !== 1 && v !== -1);
      if (bad >= 0) throw { message: '「' + name + '」第 ' + (bad + 1) + ' 片是 ' + seq[bad] + '，码片序列只能取 +1 / −1' };
      return { name: name, seq: seq };
    });

    const m = stations[0].seq.length;
    stations.forEach(st => {
      if (st.seq.length !== m) throw { message: '「' + st.name + '」的码片长度是 ' + st.seq.length + '，与第一站（' + m + '）不一致' };
    });

    const recv = _cdmaNums(vals.recv);
    if (!recv.length) throw { message: '请填写收到的叠加序列，如 2,0,2,0,-2,0' };
    const badR = recv.findIndex(v => !Number.isFinite(v) || !Number.isInteger(v) || Math.abs(v) > 99);
    if (badR >= 0) throw { message: '收到的序列第 ' + (badR + 1) + ' 项「' + recv[badR] + '」不是合法整数（须为 −99 ~ 99 的整数）' };
    if (recv.length < m) throw { message: '收到的序列只有 ' + recv.length + ' 位，不足一段（码片长度 ' + m + '）' };
    if (recv.length % m !== 0) throw { message: '收到的序列长 ' + recv.length + ' 位，不是码片长度 ' + m + ' 的整数倍' };
    const nBits = recv.length / m;
    if (nBits > 8) throw { message: '最多演示 8 段（现在 ' + nBits + ' 段），请缩短收到的序列' };

    return { stations: stations, m: m, recv: recv, nBits: nBits };
  },

  buildSnapshots(model) {
    const stations = model.stations, m = model.m, recv = model.recv, nBits = model.nBits;
    const nS = stations.length;

    /* ⑤ 归一化内积矩阵：i = j 必为 1；i ≠ j 全为 0 才算正交码组 */
    const ortho = stations.map(a => stations.map(b => {
      let s = 0;
      for (let c = 0; c < m; c++) s += a.seq[c] * b.seq[c];
      return s / m;
    }));
    let orthogonal = true;
    for (let i = 0; i < nS; i++) for (let j = 0; j < nS; j++) {
      if (i === j ? ortho[i][j] !== 1 : ortho[i][j] !== 0) orthogonal = false;
    }

    /* 逐段结果（每帧都全量携带，未来段为 null） */
    const segIps = new Array(nBits).fill(null);
    const segRatio = new Array(nBits).fill(null);
    const segVerdict = new Array(nBits).fill(null);
    const decoded = stations.map(() => []);
    const badSeg = [];

    const snaps = [];
    const base = () => ({
      stations: stations, m: m, recv: recv, nBits: nBits, ortho: ortho, orthogonal: orthogonal,
      segIps: segIps.map(v => (v ? v.slice() : null)),
      segRatio: segRatio.map(v => (v ? v.slice() : null)),
      segVerdict: segVerdict.map(v => (v ? v.slice() : null)),
      decoded: decoded.map(d => d.slice()),
      g: -1, j: -1, recvNow: null,
      sums: new Array(nS).fill(0), prods: new Array(nS).fill(null),
      verify: null, badSeg: badSeg.slice(),
      log: '', logType: 'info', desc: '',
    });
    const push = (step, o) => snaps.push(Object.assign(base(), { step: step }, o));

    push('init', {
      log: '各站码片序列共 ' + nS + ' 个，每段 ' + m + ' 片 ⟹ 接收序列 ' + recv.length + ' 位切成 **' + nBits + ' 段**（每段 1 比特）。'
        + (orthogonal ? '码片两两正交 ✓，逐段做内积再除以 ' + m + ' 即可判三态。' : '⚠ 码片**不正交**：内积里会混进别站的成分，可能出现「判不出」的段。'),
      desc: '正交性检查 → 逐段逐片内积 → ÷ m 判三态',
    });

    for (let g = 0; g < nBits; g++) {
      const sums = new Array(nS).fill(0);
      for (let j = 0; j < m; j++) {
        const rv = recv[g * m + j];
        const prods = stations.map(st => rv * st.seq[j]);
        for (let s = 0; s < nS; s++) sums[s] += prods[s];
        push('mul', {
          g: g, j: j, recvNow: rv, prods: prods.slice(), sums: sums.slice(),
          log: '第 ' + (g + 1) + ' 段第 ' + (j + 1) + ' 片：收到 ' + _cdmaFmt(rv) + ' ⟹ '
            + stations.map((st, s) => st.name + ' 的码片是 ' + _cdmaFmt(st.seq[j]) + '，本片乘积 ' + _cdmaFmt(prods[s]) + '，部分和 ' + _cdmaFmt(sums[s])).join('；')
            + '。逐位相乘再累加，这一段还有 ' + (m - j - 1) + ' 片要算。',
          desc: '第 ' + (g + 1) + ' 段 · 第 ' + (j + 1) + ' / ' + m + ' 片乘加',
        });
      }

      const ips = sums.slice();
      const ratio = ips.map(v => v / m);
      const verdict = ratio.map(v => (v === 1 ? '1' : v === -1 ? '0' : v === 0 ? '—' : '?'));
      segIps[g] = ips; segRatio[g] = ratio; segVerdict[g] = verdict;
      verdict.forEach((v, s) => {
        decoded[s].push(v);
        if (v === '?') badSeg.push('第 ' + (g + 1) + ' 段 · ' + stations[s].name);
      });

      const anyBad = verdict.indexOf('?') >= 0;
      push('bit', {
        g: g, j: -1,
        log: '第 ' + (g + 1) + ' 段内积算完（共 ' + m + ' 片）：'
          + stations.map((st, s) => st.name + ' 得 ' + _cdmaFmt(ips[s]) + '，÷ ' + m + ' = ' + _cdmaFmt(ratio[s]) + ' ⟹ ' + _cdmaVerdictText(verdict[s])).join('；')
          + '。' + (anyBad ? '⚠ 有站的内积既不是 ±' + m + ' 也不是 0 ⟹ 码片不正交，该段**判不出**。' : ''),
        logType: anyBad ? 'error' : 'success',
        desc: '第 ' + (g + 1) + ' 段判定' + (anyBad ? '（含判不出）' : ''),
      });
    }

    /* ⑦ 末帧验算：按判定系数把各站向量逐位相加，应与收到的序列逐位一致 */
    const verify = [];
    for (let g = 0; g < nBits; g++) {
      const coeff = segVerdict[g].map(v => (v === '1' ? 1 : v === '0' ? -1 : v === '—' ? 0 : null));
      if (coeff.indexOf(null) >= 0) { verify.push({ ok: null, recon: null }); continue; }
      const recon = [];
      for (let j = 0; j < m; j++) {
        let t = 0;
        for (let s = 0; s < nS; s++) t += coeff[s] * stations[s].seq[j];
        recon.push(t);
      }
      const got = recv.slice(g * m, (g + 1) * m);
      verify.push({ ok: recon.every((v, j) => v === got[j]), recon: recon });
    }
    const okN = verify.filter(v => v.ok === true).length;

    push('done', {
      g: nBits, j: -1, verify: verify,
      log: '**解出各站数据**：' + stations.map((st, s) => st.name + ' = ' + (decoded[s].join('') || '—')).join('，') + '。'
        + '叠加反推验算：' + okN + '/' + nBits + ' 段与收到的序列**逐位一致**'
        + (okN === nBits ? ' ✓（正交 + 判对，必然成立）' : '（不一致 ⟹ 码片不正交或分段有误）') + '。',
      logType: okN === nBits ? 'success' : 'error',
      desc: '汇总：各站数据 + 叠加反推验算',
    });

    return snaps;
  },

  render(ctx) {
    const s = ctx.snap, stage = ctx.stage;
    const U = RC408.util;
    const col = i => _cdmaColors[i % _cdmaColors.length];
    const nS = s.stations.length;

    /* ---- 统计卡 ---- */
    const prog = s.step === 'init' ? '待开始'
      : s.step === 'done' ? '全部算完'
        : '第 ' + (s.g + 1) + ' 段' + (s.j >= 0 ? ' · 第 ' + (s.j + 1) + ' 片' : ' 判定');
    const stats = [
      RC408.ui.statCard('码片长度 m', String(s.m), '每段 ' + s.m + ' 片 ⟹ 每段 1 比特', 'font-mono text-indigo-600 cdma-stat-m'),
      RC408.ui.statCard('段数（比特数）', String(s.nBits), '接收序列 ' + s.recv.length + ' 位 ÷ ' + s.m, 'font-mono cdma-stat-nbits'),
      RC408.ui.statCard('码片正交性', s.orthogonal ? '正交 ✓' : '不正交 ⚠', s.orthogonal ? '两两归一化内积 = 0' : '会出现「判不出」的段', (s.orthogonal ? 'text-emerald-600' : 'text-rose-600') + ' cdma-stat-orth'),
      RC408.ui.statCard('当前进度', prog, '第 ' + (ctx.idx + 1) + ' / ' + ctx.total + ' 帧', 'cdma-stat-cur'),
    ].join('');

    /* ---- 各站码片序列 ---- */
    const stRows = s.stations.map((st, i) => {
      const cells = st.seq.map(v =>
        '<div class="bit-cell cdma-crow" data-st="' + i + '" style="width:24px;height:30px;font-size:12px;background:' + col(i) + '">' + _cdmaFmt(v) + '</div>'
      ).join('');
      return '<div style="display:flex;align-items:center;gap:6px;margin:3px 0">'
        + '<span class="cdma-stname" data-st="' + i + '" style="flex:0 0 40px;font:700 12px Consolas,monospace;color:' + col(i) + '">' + U.esc(st.name) + '</span>'
        + '<span style="display:flex;gap:3px">' + cells + '</span></div>';
    }).join('');

    /* ---- 收到的叠加序列（一段一行，琥珀 = 当前正在算的那一片） ---- */
    const recvRows = [];
    for (let g = 0; g < s.nBits; g++) {
      const cells = [];
      for (let j = 0; j < s.m; j++) {
        const v = s.recv[g * s.m + j];
        const isCur = (s.step === 'mul' && s.g === g && s.j === j);
        const bg = isCur ? '#d97706' : (v > 0 ? '#2563eb' : (v < 0 ? '#e11d48' : '#94a3b8'));
        const dim = s.segVerdict[g] ? '' : 'opacity:.85';
        cells.push('<div class="bit-cell cdma-chip' + (isCur ? ' cdma-cur' : '') + '" data-g="' + g + '" data-j="' + j
          + '" style="width:24px;height:30px;font-size:12px;background:' + bg + ';' + dim + '">' + _cdmaFmt(v) + '</div>');
      }
      recvRows.push('<div style="display:flex;align-items:center;gap:6px;margin:3px 0">'
        + '<span class="cdma-seglab" data-g="' + g + '" style="flex:0 0 48px;font:700 11px Consolas,monospace;color:#64748b">第 ' + (g + 1) + ' 段</span>'
        + '<span style="display:flex;gap:3px">' + cells.join('') + '</span></div>');
    }

    /* ---- 逐片乘加表（mul 帧） ---- */
    let mulBlock = '';
    if (s.step === 'mul') {
      const rows = s.stations.map((st, i) =>
        '<tr>'
        + '<td class="cdma-mrow" data-st="' + i + '" style="padding:3px 8px;color:' + col(i) + ';font-weight:700">' + U.esc(st.name) + '</td>'
        + '<td class="cdma-mchip" data-st="' + i + '" style="padding:3px 8px">' + _cdmaFmt(st.seq[s.j]) + '</td>'
        + '<td class="cdma-mrecv" style="padding:3px 8px">' + _cdmaFmt(s.recvNow) + '</td>'
        + '<td class="cdma-mprod" data-st="' + i + '" style="padding:3px 8px">' + _cdmaFmt(s.prods[i]) + '</td>'
        + '<td class="cdma-msum" data-st="' + i + '" style="padding:3px 8px;font-weight:700;color:' + col(i) + '">' + _cdmaFmt(s.sums[i]) + '</td>'
        + '</tr>').join('');
      mulBlock = '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
        + RC408.ui.sectionTitle('逐片乘加（第 ' + (s.g + 1) + ' 段 · 第 ' + (s.j + 1) + ' / ' + s.m + ' 片）')
        + '<table class="cdma-multable" style="width:100%;border-collapse:collapse;font:12px Consolas,monospace">'
        + '<thead><tr><th style="text-align:left;padding:3px 8px">站</th><th style="text-align:left;padding:3px 8px">本站第 ' + (s.j + 1) + ' 片</th>'
        + '<th style="text-align:left;padding:3px 8px">收到第 ' + (s.g * s.m + s.j + 1) + ' 位</th>'
        + '<th style="text-align:left;padding:3px 8px">乘积</th><th style="text-align:left;padding:3px 8px">部分和</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>';
    }

    /* ---- 本段结算表（bit 帧） ---- */
    let bitBlock = '';
    if (s.step === 'bit') {
      const rows = s.stations.map((st, i) =>
        '<tr>'
        + '<td style="padding:3px 8px;color:' + col(i) + ';font-weight:700">' + U.esc(st.name) + '</td>'
        + '<td class="cdma-bip" data-st="' + i + '" style="padding:3px 8px">' + _cdmaFmt(s.segIps[s.g][i]) + '</td>'
        + '<td class="cdma-bratio" data-st="' + i + '" style="padding:3px 8px">' + _cdmaFmt(s.segRatio[s.g][i]) + '</td>'
        + '<td class="cdma-bverdict" data-st="' + i + '" style="padding:3px 8px;font-weight:700;color:' + (s.segVerdict[s.g][i] === '?' ? '#e11d48' : col(i)) + '">'
        + _cdmaVerdictText(s.segVerdict[s.g][i]) + '</td></tr>').join('');
      bitBlock = '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
        + RC408.ui.sectionTitle('第 ' + (s.g + 1) + ' 段结算：内积 ÷ ' + s.m + ' 判三态')
        + '<table class="cdma-bittable" style="width:100%;border-collapse:collapse;font:12px Consolas,monospace">'
        + '<thead><tr><th style="text-align:left;padding:3px 8px">站</th><th style="text-align:left;padding:3px 8px">内积 I</th>'
        + '<th style="text-align:left;padding:3px 8px">I ÷ ' + s.m + '</th><th style="text-align:left;padding:3px 8px">判定</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>';
    }

    /* ---- 各段判定总表 ---- */
    const segRows = [];
    for (let g = 0; g < s.nBits; g++) {
      const cells = s.stations.map((st, i) => {
        const sg = s.segVerdict[g];
        if (!sg) return '<td class="cdma-ipcell" data-g="' + g + '" data-st="' + i + '" style="padding:3px 8px;color:#cbd5e1">待算</td>';
        const v = sg[i];
        const txt = v === '?' ? _cdmaFmt(s.segRatio[g][i]) + ' 判不出' : (v === '—' ? '0 ⟹ 没发' : _cdmaFmt(s.segRatio[g][i]) + ' ⟹ ' + v);
        const cc = v === '?' ? '#e11d48' : (v === '—' ? '#94a3b8' : col(i));
        return '<td class="cdma-ipcell" data-g="' + g + '" data-st="' + i + '" style="padding:3px 8px;font-weight:700;color:' + cc + '">' + txt + '</td>';
      }).join('');
      segRows.push('<tr><td style="padding:3px 8px;color:#64748b">第 ' + (g + 1) + ' 段</td>'
        + '<td style="padding:3px 8px">' + s.recv.slice(g * s.m, (g + 1) * s.m).map(_cdmaFmt).join(' ') + '</td>' + cells + '</tr>');
    }
    const ipTable = '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
      + RC408.ui.sectionTitle('各段判定（内积 ÷ m 的三态表：+1 发 1、−1 发 0、0 没发）')
      + '<div style="overflow-x:auto"><table class="cdma-iptable" style="width:100%;border-collapse:collapse;font:12px Consolas,monospace">'
      + '<thead><tr><th style="text-align:left;padding:3px 8px">段</th><th style="text-align:left;padding:3px 8px">收到的片段</th>'
      + s.stations.map((st, i) => '<th style="text-align:left;padding:3px 8px;color:' + col(i) + '">' + U.esc(st.name) + '</th>').join('')
      + '</tr></thead><tbody>' + segRows.join('') + '</tbody></table></div></div>';

    /* ---- 正交性检查表 ---- */
    const orthRows = s.stations.map((a, i) =>
      '<tr><td style="padding:3px 8px;font-weight:700;color:' + col(i) + '">' + U.esc(a.name) + '</td>'
      + s.stations.map((b, j) => {
        const v = s.ortho[i][j];
        const good = (i === j ? v === 1 : v === 0);
        return '<td class="cdma-ortho" data-i="' + i + '" data-j="' + j + '" style="padding:3px 8px;font-weight:700;color:' + (good ? '#059669' : '#e11d48') + '">' + _cdmaNum(v) + '</td>';
      }).join('') + '</tr>').join('');
    const orthBlock = '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
      + RC408.ui.sectionTitle('正交性检查（归一化内积：对角必须为 1、非对角必须为 0）')
      + '<div style="overflow-x:auto"><table class="cdma-orthtable" style="width:auto;border-collapse:collapse;font:12px Consolas,monospace">'
      + '<thead><tr><th style="text-align:left;padding:3px 8px">·</th>'
      + s.stations.map((st, j) => '<th style="text-align:left;padding:3px 8px;color:' + col(j) + '">' + U.esc(st.name) + '</th>').join('')
      + '</tr></thead><tbody>' + orthRows + '</tbody></table></div>'
      + '<div style="margin-top:6px;font-size:12px;color:' + (s.orthogonal ? '#059669' : '#e11d48') + '">'
      + (s.orthogonal ? '✓ 两两正交：收方对某站做内积时，别的站的贡献恰好为 0。' : '⚠ 存在非对角元素 ≠ 0 ⟹ 码片不正交，某些段会「判不出」。') + '</div></div>';

    /* ---- 末帧汇总 ---- */
    let resultBlock = '';
    if (s.step === 'done') {
      const okN = s.verify.filter(v => v.ok === true).length;
      const badG = s.verify.map((v, g) => (v.ok === false ? g + 1 : null)).filter(x => x !== null);
      const unkG = s.verify.map((v, g) => (v.ok === null ? g + 1 : null)).filter(x => x !== null);
      resultBlock = '<div class="cdma-result" style="border:1.5px solid #4f46e5;border-radius:14px;background:#eef2ff;padding:10px 12px">'
        + RC408.ui.sectionTitle('解出的数据（收方视角）')
        + '<div style="font:700 14px Consolas,monospace;color:#3730a3">'
        + s.stations.map((st, i) => U.esc(st.name) + ' 发送的数据 = <span class="cdma-bits" data-st="' + i + '">' + (s.decoded[i].join('') || '—') + '</span>').join(' ｜ ')
        + '</div>'
        + '<div style="margin-top:6px;font-size:12px;color:' + (badG.length || unkG.length ? '#e11d48' : '#059669') + '">'
        + '叠加反推验算：按判定系数把各站向量逐位相加，<b>' + okN + ' / ' + s.nBits + '</b> 段与收到的序列逐位一致'
        + (badG.length ? '（第 ' + badG.join('、') + ' 段不一致 ⟹ 码片不正交，判定不可信）' : '')
        + (unkG.length ? '（第 ' + unkG.join('、') + ' 段含「判不出」，无法验算）' : '')
        + (badG.length || unkG.length ? '' : ' ✓') + '</div>'
        + '<div style="margin-top:6px;font-size:12px;color:#475569">「—」= 该段内积为 0 ⟹ 这一站这一段<b>没发</b>（不是发了 0；发 0 会得到 −1）；「?」= 码片不正交 ⟹ 该段<b>判不出</b>。</div>'
        + '</div>';
    }

    /* ---- 图例 ---- */
    const legend = '<div style="display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:8px">'
      + RC408.ui.legend('#d97706', '正在算的那一片')
      + RC408.ui.legend('#2563eb', '收到值为正')
      + RC408.ui.legend('#e11d48', '收到值为负')
      + RC408.ui.legend('#94a3b8', '收到值为 0')
      + '</div>';

    stage.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px">'
      + '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">' + stats + '</div>'
      + '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
      + RC408.ui.sectionTitle('各站码片序列（每段 ' + s.m + ' 片，元素只取 +1 / −1）') + stRows + '</div>'
      + '<div style="border:1px solid #e2e8f0;border-radius:14px;background:#fff;padding:10px 12px">'
      + RC408.ui.sectionTitle('收到的叠加序列（每 ' + s.m + ' 位一段，一段对应一个比特）') + recvRows.join('') + '</div>'
      + mulBlock + bitBlock + ipTable + orthBlock + resultBlock + legend
      + '</div>';
  },
});

/* ------------------------------ 本模块私有工具（前缀 _cdma 防全局污染） ------------------------------ */

/** 逗号 / 空格 / 顿号分隔的数字串 → 数字数组；顺带把 Unicode 减号归一成 '-' */
function _cdmaNums(src) {
  return String(src == null ? '' : src)
    .replace(/[−–—]/g, '-')
    .replace(/[，、；]/g, ',')
    .split(/[\s,]+/)
    .filter(x => x !== '')
    .map(Number);
}

/** 带符号显示：正数补 '+'，负数原样，0 显示 0 */
function _cdmaFmt(v) { return v > 0 ? '+' + v : String(v); }

/** 比值显示：整数原样，非整数保留两位（不正交时会出现） */
function _cdmaNum(v) { return Number.isInteger(v) ? String(v) : v.toFixed(2); }

/** 三态文案 */
function _cdmaVerdictText(v) {
  return v === '1' ? '+1 ⟹ 发 1' : v === '0' ? '−1 ⟹ 发 0' : v === '—' ? '0 ⟹ 没发' : '判不出（码片不正交）';
}
