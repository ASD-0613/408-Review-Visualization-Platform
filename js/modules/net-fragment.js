'use strict';
/* ============================================================================
 * net-fragment.js —— 【计算机网络】IP 分片与重组（即时反馈型模块 mode:'instant'）
 * ----------------------------------------------------------------------------
 * 单位与约定（**全模块统一"字节"**；唯一的例外是"片偏移字段"，它以 8 字节为单位）：
 *   L    总长度      IP 数据报总长度（含首部），即首部里那个"总长度"字段
 *   H    首部长度    固定 20；带选项时 20~60 且必为 4 的倍数（408 口径）
 *   P    载荷长度    P = L − H —— 分片切的就是这一段
 *   MTU              链路层最大传送单元，**含 IP 首部**（故可载数据 = MTU − H）
 *   A    每片可载数据  A = ⌊(MTU − H) ÷ 8⌋ × 8（向下取整到 8 的倍数）
 *   N    片数         N = ⌈P ÷ A⌉
 *   第 i 片（i 从 1 起）：数据长度 d、起始字节 off、总长度 d + H、
 *                        MF = (i < N ? 1 : 0)、**片偏移字段值 = off ÷ 8**
 *
 * 不变量（冒烟逐条断言；全部字节数，只有片偏移字段是 8 字节单位）：
 *   ① Σd = P                      ② d = A（i < N），0 < d ≤ A
 *   ③ d % 8 = 0（i < N）—— **只有末片可以不整除 8**
 *   ④ d + H ≤ MTU                 ⑤ off = Σ(前面各片 d)，且 off % 8 = 0
 *   ⑥ MF 形如 1…1 0               ⑦ Σ(d + H) = L + (N − 1)·H（每片各带一份首部）
 *   ⑧ N = 1 ⟺ P ≤ A
 *
 * 稳定态：instant 模式没有"过程帧"，每次输入都是一次性算完的**终态**——
 * 本模块不产生快照，全部派生量都在 parse() 里一次算完（§1.3 快照铁律不适用于 instant）。
 *
 * 版式决策（窗19）：**只有"分片总览带 + 片段表"两块，不做动画、不做逐帧**。
 * 依据用户 2026-09-21 口径："可视化不要用力过猛，本就直观好理解的模块可以从简"——
 * 分片是纯算术（给 MTU 就能把表算出来），考生真正需要的是那张逐片字段表，
 * 而不是 6 帧动画。区间带用 **inline 样式**而非 Tailwind 类，这样离线 harness
 * （无 Tailwind CDN）下宽度与比例仍然正确。
 *
 * 考情（窗19 从 `考情缓存/` 逐题核定，见 handover §6.2.17）：**2/18 年（选 1 + 大 1）**——
 *   2021-36（选，`考情缓存/2021_真题.txt:291-298`：1580 B 数据报经 MTU 800 链路、首部 20 B，
 *     问第 2 片的总长度与 MF = **796、1**）—— **本模块的默认输入就是这道题**；
 *   2018-47（大，`考情缓存/2018_解析.txt:507-511`：1500 B 经 MTU 800 链路，
 *     最大片数据 = ⌊(800−20)/8⌋×8 = 776、片数 = ⌈(1500−20)/776⌉ = 2、第 2 片偏移 = 776 ÷ 8 = 97）。
 *   **不标 hot**（2 < 8 年且大题 1 < 2 道）。旧 `js/app.js` 那条 note 写的 2010-47 / 2016-37 都不是本考点
 *   （经复核分别是 CSMA/CD 冲突检测时间与 RIP「坏消息传得慢」），已随接线一并删除。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-fragment',
  mode: 'instant',
  title: 'IP 分片与重组',

  theory: `
> **为什么要有它**：链路层的 MTU 限制了单个帧能承载的数据量，比 MTU 还大的 IP 数据报**必须切成若干片**分别封装、到目的主机再重组——否则大报文根本过不了任何一段链路。
> **怎么实现**：分片主机按 MTU 算出"每片最多能载多少数据"（**向下取整到 8 的倍数**），逐片复制首部并改**总长度 / MF / 片偏移**三个字段；目的主机按**片偏移**升序拼接各片数据，以 **MF = 0** 判断末片。
> **记住什么**：**片偏移的单位是 8 字节**（偏移字段 = 片数据起始字节 ÷ 8）；**除末片外每片数据长度必须是 8 的倍数**；所有分片的**标识字段相同**。

## 四个字段怎么改
| 字段 | 分片后怎么填 |
| --- | --- |
| 标识（16 位） | **所有分片都相同**（接收方据此判断"这几片属于同一个数据报"） |
| 标志 MF（1 位） | 后面还有片 = 1；**最后一片 = 0**（同一字节里的 DF = 1 表示"禁止分片"） |
| 片偏移（13 位） | **本片数据起始字节 ÷ 8**，单位为 8 字节 —— 首片恒为 0 |
| 总长度（16 位） | 改成**本片**的"首部 + 数据"长度（每片都要带一份完整首部） |

## 计算模板（考场三步）
1. **每片可载数据** = ⌊(MTU − 首部长度) ÷ 8⌋ × 8；
2. **片数** = ⌈(总长度 − 首部长度) ÷ 每片可载数据⌉；
3. 逐片填表：数据长度（前面各片取满、末片取余）→ 总长度（再加一份首部）→ MF / 片偏移（把前面各片的数据长度累加，再 ÷ 8）。

**重组**：按片偏移升序拼接数据，遇到 MF = 0 的片即结束；各片首部只保留一份，总长度回到原值。

## 考点提醒（易错点）
1. **片偏移的单位是 8 字节**：偏移字段写的是"÷ 8 之后"的数，直接填字节数就错了；
2. **只有末片可以不整除 8**："除末片外每片数据长度必须是 8 的倍数"，这是各片能对齐到 8 字节边界的前提；
3. **每片都要带首部**：分片后链路上传输的总字节数 = 原总长度 + (片数 − 1) × 首部长度，别漏算多出来的首部；
4. **MTU 是"含首部"的上限**：可载数据 = MTU − 首部长度，别把 MTU 直接当成数据上限（MTU − 首部不是 8 的倍数时还要往下取整）；
5. **DF = 1 时不允许分片**：路由器只能丢弃该数据报，并用 ICMP 差错报文通知源主机。

> **真题考情**：**2/18 年（选 1 年 + 大题 1 道）**：选 2021-36（求第 2 片的总长度与 MF）；
> 大 2018-47（求最大片数据长度、片数、片偏移）——两题都是「给 MTU 求分片字段」的标准三步。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'total', label: 'IP 数据报总长度（字节，含首部）', default: '1580', help: '首部"总长度"字段的值；要分片的是它的数据部分' },
    { key: 'mtu', label: 'MTU（字节，含首部）', default: '800', help: '链路层最大传送单元；以太网常见 1500' },
    { key: 'hdr', label: 'IP 首部长度（字节）', default: '20', help: '无选项固定 20；带选项时 20~60，且必须是 4 的倍数' },
    { key: 'ident', label: '标识（16 位，十进制）', default: '12345', help: '同一数据报的各分片此字段相同' },
  ],

  /* 预设示例 / 随机数据报 */
  quickActions: [
    {
      label: '🎲 随机数据报', run(rt) {
        rt.setInput('total', String(RC408.util.rnd(200, 6000)));
        rt.setInput('mtu', String(RC408.util.rnd(200, 1500)));
        rt.setInput('hdr', String([20, 20, 20, 24, 28][RC408.util.rnd(0, 4)]));
        rt.setInput('ident', String(RC408.util.rnd(0, 65535)));
        rt.load();
      },
    },
    { label: '1580 B · MTU 800（2021-36 原题）', run(rt) { rt.setInput('total', '1580'); rt.setInput('mtu', '800'); rt.setInput('hdr', '20'); rt.load(); } },
    { label: '1500 B · MTU 800（2018-47 原题）', run(rt) { rt.setInput('total', '1500'); rt.setInput('mtu', '800'); rt.setInput('hdr', '20'); rt.load(); } },
    { label: '4000 B · MTU 1500（三片）', run(rt) { rt.setInput('total', '4000'); rt.setInput('mtu', '1500'); rt.setInput('hdr', '20'); rt.load(); } },
    { label: '1200 B · MTU 1500（无需分片）', run(rt) { rt.setInput('total', '1200'); rt.setInput('mtu', '1500'); rt.setInput('hdr', '20'); rt.load(); } },
    { label: '首部带选项 24 B · 2000 B', run(rt) { rt.setInput('total', '2000'); rt.setInput('mtu', '620'); rt.setInput('hdr', '24'); rt.load(); } },
  ],

  /* ---------------- ① 解析与计算（instant：一次算完终态） ---------------- */
  parse(vals) {
    const L = _frInt(vals.total, '总长度');
    const H = _frInt(vals.hdr, '首部长度');
    const MTU = _frInt(vals.mtu, 'MTU');
    const ident = _frInt(vals.ident, '标识');

    /* ---- 先校验三个字段的合法范围（判据全部来自 IP 首部字段宽度与 408 口径） ---- */
    if (H < 20 || H > 60) throw { message: `首部长度须在 20 ~ 60 字节之间（当前 ${H}）` };
    if (H % 4 !== 0) throw { message: `首部长度必须是 4 的倍数（当前 ${H}）` };
    if (L > 65535) throw { message: `"总长度"是 16 位字段，不得超过 65535（当前 ${L}）` };
    if (L <= H) throw { message: `总长度（${L}）必须大于首部长度（${H}）：数据报至少要有 1 字节数据才谈得上分片` };
    if (ident > 65535) throw { message: `"标识"是 16 位字段，须在 0 ~ 65535 之间（当前 ${ident}）` };
    if (MTU <= H) throw { message: `MTU（${MTU}）必须大于 IP 首部长度（${H}），否则连首部都装不下` };
    const cap = MTU - H;                               // 每片最多能装的"数据"字节数（未取整）
    if (cap < 8) throw { message: `MTU − 首部 = ${cap} < 8 字节：连一个 8 字节单位都装不下，无法分片` };

    /* ---- 三步计算 ---- */
    const P = L - H;                                   // 载荷（要分片的字节数）
    const A = Math.floor(cap / 8) * 8;                 // 每片可载数据：向下取整到 8 的倍数
    const N = Math.ceil(P / A);                        // 片数

    /* ---- 逐片建表（off 即"起始字节"，累加前面各片的数据长度） ---- */
    const frags = [];
    let off = 0;
    for (let i = 0; i < N; i++) {
      const d = Math.min(A, P - off);                  // 末片取余
      frags.push({
        no: i + 1, data: d, total: d + H,
        mf: i < N - 1 ? 1 : 0,
        off, offField: off / 8,                        // off 必为 8 的倍数（A 是 8 的倍数）
        from: off, to: off + d - 1,
      });
      off += d;
    }

    return {
      L, H, MTU, ident, cap, P, A, N, frags,
      noFragment: N === 1,                             // 无需分片（P ≤ A）
      capRest: cap % 8,                                // MTU − 首部 被 8 整除后的余数（每片浪费的字节数）
      sumTotal: L + (N - 1) * H,                       // 分片后链路上传输的总字节数
    };
  },

  /* 即时模式日志 */
  logs(model) {
    const m = model, L = [];
    L.push({ type: 'info', text: `载荷 = 总长度 ${m.L} − 首部 ${m.H} = ${m.P} B` });
    L.push({ type: 'info', text: `每片可载数据 = ⌊(MTU ${m.MTU} − 首部 ${m.H}) ÷ 8⌋ × 8 = ${m.A} B` });
    if (m.noFragment) {
      L.push({ type: 'success', text: `载荷 ${m.P} B ≤ ${m.A} B → 无需分片：MF = 0、片偏移 = 0，原样发送（总长度 ${m.L} B）` });
      return L;
    }
    L.push({ type: 'success', text: `片数 = ⌈${m.P} ÷ ${m.A}⌉ = ${m.N} 片；Σ 数据长度 = ${m.P} B ✓` });
    /* 片数多时只列前 3 片与末片，明细交给表格（输出节流，§3.5-23） */
    const show = m.N > 5 ? m.frags.slice(0, 3).concat([m.frags[m.N - 1]]) : m.frags;
    show.forEach((f, k) => {
      if (m.N > 5 && k === 3) L.push({ type: 'info', text: `…… 中间 ${m.N - 4} 片同理（每片数据 ${m.A} B），明细见下方分片表` });
      L.push({
        type: 'info',
        text: `第 ${f.no} 片：数据 ${f.data} B（字节 ${f.from} ~ ${f.to}）、总长度 ${f.total} B、MF = ${f.mf}、片偏移 = ${f.offField}（对应字节 ${f.off}）`,
      });
    });
    L.push({ type: 'info', text: `分片后链路上传输的总字节数 = ${m.L} + ${m.N - 1} × ${m.H} = ${m.sumTotal} B（每片各带一份首部）` });
    L.push({ type: 'warn', text: `接收方按片偏移升序拼接各片数据，遇到 MF = 0 的片（第 ${m.N} 片）结束；标识 ${m.ident} 相同即认定为同一数据报` });
    return L;
  },

  /* ---------------- ② 渲染：分片总览带 + 片段表（无动画） ---------------- */
  render(ctx) {
    const { model: m, stage } = ctx;
    const U = RC408.util;
    const fr = m.frags;
    const col = k => _FR_PALETTE[k % _FR_PALETTE.length];

    /* ---- 分片总览带：块宽按数据长度等比缩放（inline 样式，离线无 Tailwind 也正确） ---- */
    /* 片数很多时（极端输入）只给首片与末片打文字标签——几十个标签会退化成一团噪音，明细交给表格 */
    const withLabel = f => (m.N <= 12 || f.no === 1 || f.no === m.N);
    const blocks = fr.map(f => {
      const c = col(f.no - 1);
      const inner = withLabel(f)
        ? `<span style="font-size:10px;font-weight:700;color:${c[2]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 3px">#${f.no} ${f.data}B</span>`
        : '';
      return `<div class="fr-block" data-fr="${f.no}" title="第 ${f.no} 片：数据 ${f.data} B（字节 ${f.from} ~ ${f.to}）｜总长度 ${f.total} B｜MF = ${f.mf}｜片偏移字段 = ${f.offField}"
        style="flex:${f.data} 1 0;box-sizing:border-box;min-width:0;background:${c[0]};${f.no < m.N ? `border-right:1px dashed ${c[1]};` : ''}display:flex;align-items:center;justify-content:center;overflow:hidden">${inner}
      </div>`;
    }).join('');

    /* ---- 字节轴：与色块**同一套 flex 权重、同样 N 格**，刻度才天然对齐色块左缘。
       ⚠ 窗19 实测两处（都是浏览器几何断言抓到的真 bug）：
       ① 末尾不要另加一格"总字节"——它不参加等比分配，会把前面每一格整体左移
          （默认三片时轴#2 与色块左缘差 12px）；
       ② 色块的边框必须用 `box-shadow: inset` 而不是 `border`——`border` 会缩小色块所在
          容器的内容盒（2px），而轴容器没有边框，于是刻度与色块左缘系统性地差 ±1px
          （35 片时第 21 格实测 -1.5px）。视觉影响极小，但既然断言能量出来就顺手消掉。
       总量已写在本节标题、推导①与表尾，不必在轴上重复。 ---- */
    const axis = fr.map(f => `<div style="flex:${f.data} 1 0;min-width:0;overflow:hidden"><span style="padding-left:2px">${f.off}</span></div>`).join('');

    /* ---- 片段表：考场要填的就是这张表 ---- */
    const rows = fr.map(f => {
      const c = col(f.no - 1);
      return `<tr style="border-top:1px solid #f1f5f9">
        <td class="py-1.5 pr-2 whitespace-nowrap"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c[0]};border:1px solid ${c[1]};vertical-align:middle"></span> 第 ${f.no} 片</td>
        <td class="text-right font-mono font-bold py-1.5 pr-2">${f.data}</td>
        <td class="text-right font-mono py-1.5 pr-2">${f.total}</td>
        <td class="text-center font-mono font-bold py-1.5 pr-2 ${f.mf ? 'text-rose-600' : 'text-emerald-600'}">${f.mf}</td>
        <td class="text-right font-mono font-bold text-indigo-600 py-1.5 pr-2">${f.offField}</td>
        <td class="text-right font-mono text-slate-500 py-1.5 pr-2">${f.off}</td>
        <td class="text-center font-mono text-slate-500 py-1.5">${f.from} ~ ${f.to}</td>
      </tr>`;
    }).join('');

    /* ---- 推导过程（把"表是怎么来的"摆在明面上） ---- */
    const sumExpr = m.N > 6
      ? `${fr.slice(0, 3).map(f => f.data).join(' + ')} + … + ${fr[m.N - 1].data}`
      : fr.map(f => f.data).join(' + ');
    const derive = [
      `① 载荷 = 总长度 − 首部 = ${m.L} − ${m.H} = <b>${m.P} B</b>（要分片的就是这一段）`,
      `② 每片可载数据 = ⌊(MTU − 首部) ÷ 8⌋ × 8 = ⌊(${m.MTU} − ${m.H}) ÷ 8⌋ × 8 = ${Math.floor(m.cap / 8)} × 8 = <b>${m.A} B</b>`,
      `③ 片数 = ⌈载荷 ÷ 每片可载⌉ = ⌈${m.P} ÷ ${m.A}⌉ = <b>${m.N} 片</b>`,
      `④ 校验：Σ 数据长度 = ${sumExpr} = ${m.P} B ✓；各片总长度 ≤ MTU(${m.MTU}) ✓；片偏移字段 = 起始字节 ÷ 8，故依次为 ${fr.map(f => f.offField).join('、')}`,
    ];

    /* ---- 分片总览卡 ---- */
    const last = fr[m.N - 1];
    const cards =
      RC408.ui.statCard('分片数', `${m.N} 片`, m.noFragment ? '未超过 MTU 可载上限' : `⌈${m.P} ÷ ${m.A}⌉`, 'text-indigo-600') +
      RC408.ui.statCard('每片可载数据', `${m.A} B`, `⌊(${m.MTU} − ${m.H}) ÷ 8⌋ × 8`, 'text-slate-700') +
      RC408.ui.statCard('末片数据长度', `${last.data} B`, m.N > 1 && last.data % 8 !== 0 ? '不是 8 的倍数（允许）' : '是 8 的倍数', 'text-emerald-600') +
      RC408.ui.statCard('分片后链路上总字节', `${m.sumTotal} B`, `原 ${m.L} + ${m.N - 1} 份新首部 × ${m.H}`, 'text-amber-600');

    /* ---- 易错点提示（此处插值的字符串不做 Markdown 渲染，故不用星号/尖括号） ---- */
    const notes = [];
    if (m.noFragment) {
      notes.push(`载荷 ${m.P} B 没有超过每片可载上限 ${m.A} B，不需要分片：MF = 0、片偏移字段 = 0，原样发出`);
    } else {
      notes.push(`重组：按片偏移升序拼接各片数据，遇到 MF = 0 的片（第 ${m.N} 片）结束 —— 拼回 ${m.P} B 载荷，只保留 1 份 ${m.H} B 首部，即原数据报（总长度 ${m.L} B）`);
    }
    if (m.capRest !== 0) {
      notes.push(`MTU − 首部 = ${m.cap} 不是 8 的倍数 → 每片只能装 ${m.A} B（向下取整到 8 的倍数），每片白白浪费 ${m.capRest} B`);
    }
    if (m.N > 1 && last.data % 8 !== 0) {
      notes.push(`末片数据 ${last.data} B 不是 8 的倍数 —— 这是允许的，只有"除末片外"各片的数据长度必须是 8 的倍数`);
    }
    if (m.N > 1 && m.P % m.A === 0) {
      notes.push(`载荷 ${m.P} B 恰好是每片可载 ${m.A} B 的整数倍 → 每片装得一样多，片数 = ${m.P} ÷ ${m.A} = ${m.N}`);
    }
    if (m.H > 20) {
      notes.push(`首部含 ${m.H - 20} B 选项：每个分片都复制一份完整首部，所以每片都要扣掉 ${m.H} B（全部分片共多出 ${(m.N - 1) * m.H} B）`);
    }
    notes.push(`标识 = ${m.ident}：所有分片该字段相同，接收方据此把 ${m.N} 片认作同一个数据报`);

    stage.innerHTML = `
      <div class="space-y-4">

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            ${RC408.ui.sectionTitle(`原数据报的数据部分（${m.P} B）被切成 ${m.N} 片`)}
            <span class="text-[11px] text-slate-400">色块宽度按各片数据长度等比缩放；每片都自带一份 ${m.H} B 首部</span>
          </div>
          <div class="fr-band" style="display:flex;width:100%;height:38px;box-shadow:inset 0 0 0 1px #cbd5e1;border-radius:8px;overflow:hidden;background:#f1f5f9">${blocks}</div>
          <div class="fr-axis" style="display:flex;width:100%;margin-top:4px;font-size:10px;line-height:1.3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#94a3b8">${axis}</div>
          <p class="text-[11px] text-slate-400 mt-1">横轴 = 该片数据在原数据报数据部分中的起始字节（片偏移字段 = 这个数 ÷ 8）</p>
        </div>

        <div class="fr-cards grid grid-cols-2 md:grid-cols-4 gap-3">${cards}</div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4">
          ${RC408.ui.sectionTitle('分片表（考场要填的就是这张表）')}
          <div class="fr-table-wrap" style="overflow-x:auto">
            <table class="w-full text-xs min-w-[640px]">
              <thead>
                <tr class="text-slate-400 text-[11px]">
                  <th class="text-left font-bold pb-1 pr-2">分片</th>
                  <th class="text-right font-bold pb-1 pr-2">数据长度</th>
                  <th class="text-right font-bold pb-1 pr-2">总长度</th>
                  <th class="text-center font-bold pb-1 pr-2">MF</th>
                  <th class="text-right font-bold pb-1 pr-2">片偏移字段</th>
                  <th class="text-right font-bold pb-1 pr-2">起始字节</th>
                  <th class="text-center font-bold pb-1">数据字节范围</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
              <tfoot>
                <tr style="border-top:2px solid #e2e8f0" class="text-[11px] font-bold">
                  <td class="pt-1.5 pr-2">合计</td>
                  <td class="pt-1.5 pr-2 text-right font-mono">${m.P}</td>
                  <td class="pt-1.5 pr-2 text-right font-mono">${m.sumTotal}</td>
                  <td class="pt-1.5 pr-2 text-center text-slate-400">—</td>
                  <td class="pt-1.5 pr-2 text-right text-slate-400">—</td>
                  <td class="pt-1.5 pr-2 text-right text-slate-400">—</td>
                  <td class="pt-1.5 text-center font-mono text-slate-500">0 ~ ${m.P - 1}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p class="text-[11px] text-slate-400 mt-1.5">"片偏移字段"的单位是 <b>8 字节</b>：它是"起始字节 ÷ 8"（首片恒为 0）；"总长度"列各片之和 = 分片后链路上实际传输的字节数 ${m.sumTotal} B。</p>
        </div>

        <div class="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          ${RC408.ui.sectionTitle('推导过程')}
          <div class="text-xs text-slate-700 leading-6 font-mono">${derive.join('<br>')}</div>
        </div>

        <div class="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800 leading-relaxed">
          💡 ${notes.map(U.esc).join('；')}
        </div>
      </div>`;
  },
});

/* ---------------- 模块内部工具（前缀 fr 防止全局冲突） ---------------- */

/** 分片配色：与平台其他模块同色系（浅底 / 边框 / 深字），6 色循环 */
const _FR_PALETTE = [
  ['#e0e7ff', '#a5b4fc', '#3730a3'],
  ['#d1fae5', '#6ee7b7', '#065f46'],
  ['#fef3c7', '#fcd34d', '#92400e'],
  ['#dbeafe', '#93c5fd', '#1e40af'],
  ['#fce7f3', '#f9a8d4', '#9d174d'],
  ['#ede9fe', '#c4b5fd', '#5b21b6'],
];

/** 十进制非负整数字符串 → number；非法就抛"输入有误"卡 */
function _frInt(v, name) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!/^\d+$/.test(s)) throw { message: `${name}「${s}」不是非负整数，请填十进制数字（如 1580）` };
  return parseInt(s, 10);
}
