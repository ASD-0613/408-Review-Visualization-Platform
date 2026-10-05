'use strict';
/* ============================================================================
 * coa-inst-format.js —— 【计算机组成原理】指令格式与扩展操作码（即时计算器）（前缀 _if）
 * 模式：instant（改输入即出结果，无快照）
 * 考点：
 *   ① 指令格式 = 操作码字段 + 地址码字段的**位数划分**（指令字长 / 各字段容量 / 寻址范围 / 寄存器个数）；
 *   ② 扩展操作码的**逐级扣除法**（短操作码用掉的编码必须从池子里扣掉，否则成为长操作码的前缀）。
 *
 * 数据模型与不变量（先看这里再看实现；§3.8-13：数组字段别当标量用）
 *   · **量的单位一律是"位（bit）"** —— "n 位"指位数，不是字节数（§3.8-12 的量纲教训）。
 *
 *   · 模式 ① layout：输入是**整条指令的全部字段位数**，从左到右写（第 1 个就是操作码字段）。
 *       k        = fields[0]                      操作码字段位数
 *       sum      = Σ fields                      全条指令实际用掉的位数
 *       free     = w − sum                       空闲位数
 *       不变量：free ≥ 0 才是能实现的指令格式。**free < 0 只报警示、不抛错**（见 parse 注释）。
 *       派生量（与"用户填了几条"无关，只由字段位数决定 ⟹ 是很好的断言对象）：
 *         指令条数上限 = 2^k；某字段容量 = 2^b（无符号 0 ~ 2^b−1；补码 −2^(b−1) ~ 2^(b−1)−1）
 *       反算：已知要 N 条指令 ⟹ 操作码至少 ⌈log₂N⌉ 位（用 bitsForCount 循环求，不用 log2）
 *
 *   · 模式 ② expand：
 *       M = 需要条数 > 0 的最高级（3=三地址 / 2=二地址 / 1=一地址 / 0=零地址），找不到就是"没给条件"
 *       a = 相邻两级之间"让给操作码"的地址字段位数。
 *           **a = 0 是有意义的一档**：表示各级共用同一个操作码字段 —— 用来算 R/I/J 型那种
 *           "格式标识占用一个编码、剩下的给别的格式"（2021-43 / 2026-43 的考法）。
 *       L = k + M·a  （指令字长；a = 0 时各级操作码位数相同 ⟹ 不产生新的指令字长，不报 L）
 *       第 m 级（m = M, M−1, …, 0）：
 *         o_m    = k + (M−m)·a                    本级操作码位数
 *         pool_M = 2^k；pool_m = remain_{m+1} · 2^a   （本级**编码池**＝本级最多能编出多少条）
 *         q_m    = 本级"需要"条数（0 表示只问上限）
 *         used_m = min(q_m, pool_m)；remain_m = pool_m − used_m
 *       不变量：q_m > pool_m ⟹ 该级"放不下"（报红，不抛错）；remain_m 恒为非负整数。
 *
 * 守卫上限 vs 合法输入上界（§3.8-17⑦：守卫必须 ≥ 合法输入上界，否则静默截断）
 *   a ≤ 12、k ≤ 12 ⟹ 最深一层编码池 = 2^12 · (2^12)³ = 2^48 < 2^53，**双精度整数精确、不会丢位**。
 *   下面的 CAP = 1e15 比 2^48 ≈ 2.8e14 大一个量级，纯属兜底（触发只可能是 bug，不是合法输入）。
 * ========================================================================== */

(function () {
  const FIELD_MAX = 6;     // 字段个数上限（再多"位域条"也画不下）
  const BITS_MAX = 32;     // 单个字段位数上限（2^32 仍在双精度整数精确范围内）
  const A_MAX = 12;        // 地址字段位数上限（见文件头"守卫上限"一节）
  const K_MAX = 12;        // 操作码位数上限（同上）
  const NINS_MAX = 1e9;    // 指令条数上限（只要 bitsForCount 循环 ≤ 30 次）
  const CAP = 1e15;        // 编码池兜底上限（> 2^48，只为兜底）
  const SEG_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];
  const PREFIX_NAME = ['零地址', '一地址', '二地址', '三地址'];

  /** 表示 0..n−1 至少需要多少位。（不用 Math.log2：n 恰为 2 的幂时浮点边界会差 1） */
  function bitsForCount(n) {
    let b = 0;
    while (Math.pow(2, b) < n) b++;
    return b;
  }

  RC408.registerModule({
    id: 'coa-inst-format',
    mode: 'instant',
    title: '指令格式与扩展操作码',

    theory: `
> **为什么要有它**：机器只认二进制，必须把"做什么 + 对谁做"编码成固定格式；而指令少了不够用、操作码太长又白占字长，于是有了**可变长操作码**——用短操作码挤进更多指令，靠增加译码复杂度换编码空间。
> **怎么实现**：指令 = **操作码字段 + 地址码字段**；扩展操作码从短到长逐级扩展，**每扩展一级就把一个地址字段让给操作码**，并把上一级**用掉的编码从编码池里扣除**（短操作码绝不能成为长操作码的前缀，否则译码歧义）。
> **记住什么**：指令条数上限 = \\(2^{k}\\)（k = 操作码位数）；扩展操作码的**逐级扣除法**；指令字长要取**字节的整数倍**（2017-16 就栽在 23 位 → 24 位这一步上）。

## 一、指令格式：字段怎么分（模式①）
- 指令 = **操作码** ‖ **地址码**，按地址码个数分三地址 / 二地址 / 一地址 / 零地址指令。
- **指令字长 = 操作码字段位数 + 各地址字段位数之和**；三个"字长"别混：**指令字长 ≠ 机器字长 ≠ 存储字长**。
- 由位数推容量（模式①逐字段算给你看）：
  - 操作码 \\(k\\) 位 ⟹ 最多 \\(2^k\\) 条指令；反过来"要 \\(N\\) 条指令"⟹ 操作码至少 \\(\\lceil\\log_2 N\\rceil\\) 位；
  - 地址字段 \\(b\\) 位 ⟹ 直接寻址范围 \\(2^b\\)（按字节编址时就是 \\(2^b\\) 字节）；若该字段是寄存器号 ⟹ 最多 \\(2^b\\) 个寄存器；
  - 字段按**补码**解释（偏移量、相对位移）时范围是 \\(-2^{b-1}\\) ~ \\(2^{b-1}-1\\)。
- **算完要取字节的整数倍**：23 位必须进到 24 位 —— 这一步常是把正确答案和干扰项分开的关键。

## 二、扩展操作码：逐级扣除法（模式②）
设地址字段最多那一级的操作码为 \\(k\\) 位、每个地址字段 \\(a\\) 位、该级有 \\(M\\) 个地址字段：
1. 最高一级最多 \\(2^k\\) 条，用掉 \\(q_M\\) 条后**剩 \\(2^k-q_M\\) 个编码**；
2. 下一级的操作码位数 = \\(k+a\\)（让出来的那个地址字段并入操作码），最多 \\((2^k-q_M)\\times 2^a\\) 条；
3. 再下一级再乘 \\(2^a\\)，依此类推 —— **每一级都要先扣掉上一级的余额，再算自己的上限**。
- 指令字长 \\(L = k + M\\times a\\)；**每一级的指令字长都等于 L**（操作码多几位、地址码就少几位，总长不变）。

## 三、考点提醒（易错点）
- **前缀冲突**：短操作码用掉的编码必须从池子里扣掉；不扣，同一条二进制就既是短指令、又是长指令的前缀。
- **字段位置决定编码能否复用**：两个格式的操作码**在同一字段** ⟹ 取值集合不能相交（2026-43：op2 与 op3 都在高位字段，不能相同）；**在不同字段** ⟹ 可以相同（op1 在 R 型低 4 位、op2 在高位，可以相同）。
- **ISA 与微架构的分界**（2025-16 / 2026-16 的考法，详见 <code>coa-hierarchy</code> 卡）：指令格式、操作码、寻址方式、通用寄存器、I/O 指令、向量中断由 **ISA 规定**；虚拟存储管理方式、是否用超级流水线、单总线数据通路、微程序控制器、阵列乘法器都属**实现细节**。

> **真题考情**：**9/18 年，选择题 4 + 大题 5** —— 选 2014-17（操作码字段含寻址方式位 ⟹ 24 位地址码怎么分）、
> 2017-16（扩展操作码 ⟹ 指令字长 23 → 24 位）、2020-16（**与 coa-addressing 双登记，改挂待专项**）、
> 2022-19（逐级扣除 ⟹ 零地址最多 128 条）；大 2010-43（操作码 4 位 ⟹ 最多 16 条指令）、2015-44、2021-43、2024-43、2026-43。
`,

    inputs: [
      { key: 'mode', label: '要算什么', type: 'select', default: 'expand', wide: true,
        options: [
          { v: 'expand', t: '② 扩展操作码：逐级扣除（三地址 / 二地址 / 一地址 / 零地址）' },
          { v: 'layout', t: '① 指令格式：字段拆位与位数核算' },
        ] },
      { key: 'k', label: '操作码位数 k【模式②】', default: '5',
        help: '地址字段最多那一级的操作码位数。例：2017-16 三地址指令有 29 条 ⟹ 操作码至少 5 位（2⁴<29≤2⁵）' },
      { key: 'a', label: '地址字段位数 a【模式②】', default: '6',
        help: '相邻两级之间"让给操作码"的地址字段位数。填 0 = 各级共用同一操作码字段（R/I/J 型那种格式标识占编码的算法）' },
      { key: 'q3', label: '三地址指令需要条数【模式②，0 = 只问上限】', default: '29' },
      { key: 'q2', label: '二地址指令需要条数【模式②，0 = 只问上限】', default: '107' },
      { key: 'q1', label: '一地址指令需要条数【模式②，0 = 只问上限】', default: '0' },
      { key: 'q0', label: '零地址指令需要条数【模式②，0 = 只问上限】', default: '0' },
      { key: 'w', label: '指令字长（位）【模式①】', default: '16',
        help: '整条指令占多少位。模式② 不用它（由 k + 最高级地址字段个数 × a 反算）' },
      { key: 'fields', label: '全部字段位数【模式①】', default: '4,4,4,4', wide: true,
        help: '按位域从左到右用逗号分隔，第 1 个就是操作码字段。例：16 位三地址指令写 4,4,4,4；2014-17 写 8,4,4,16；2020-16 写 6,2,8。最多 6 个' },
      { key: 'nins', label: '已知指令条数【模式①，0 = 不反算】', default: '0',
        help: '填了它就算出"至少要几位操作码"，并和你写的操作码字段位数对比' },
    ],

    quickActions: [
      { label: '🎯 2017-16：三地址 29 条 + 二地址 107 条 → 指令字长 23 位（取 8 的倍数 = 24 位）',
        run(rt) { rt.setInput('mode', 'expand'); rt.setInput('k', '5'); rt.setInput('a', '6'); rt.setInput('q3', '29'); rt.setInput('q2', '107'); rt.setInput('q1', '0'); rt.setInput('q0', '0'); rt.load(); } },
      { label: '🎯 2022-19：字长 16 位 + 地址码 6 位 + 二地址 12 条 + 一地址 254 条 → 零地址最多 128 条',
        run(rt) { rt.setInput('mode', 'expand'); rt.setInput('k', '4'); rt.setInput('a', '6'); rt.setInput('q3', '0'); rt.setInput('q2', '12'); rt.setInput('q1', '254'); rt.setInput('q0', '0'); rt.load(); } },
      { label: '🎯 2021-43：高 6 位里 1 个编码给 R 型标识 → I 型和 J 型共 63 种操作',
        run(rt) { rt.setInput('mode', 'expand'); rt.setInput('k', '6'); rt.setInput('a', '0'); rt.setInput('q3', '0'); rt.setInput('q2', '0'); rt.setInput('q1', '1'); rt.setInput('q0', '0'); rt.load(); } },
      { label: '🎯 2026-43：高 4 位是格式/操作码字段，R 型标识占 1 个编码 → 剩 15 个给 I 型',
        run(rt) { rt.setInput('mode', 'expand'); rt.setInput('k', '4'); rt.setInput('a', '0'); rt.setInput('q3', '0'); rt.setInput('q2', '0'); rt.setInput('q1', '1'); rt.setInput('q0', '0'); rt.load(); } },
      { label: '🎯 2010-43：操作码 4 位 + 操作数 6 位（寻址方式 3 + 寄存器号 3）× 2 → 16 条指令 / 8 个寄存器',
        run(rt) { rt.setInput('mode', 'layout'); rt.setInput('w', '16'); rt.setInput('fields', '4,3,3,3,3'); rt.setInput('nins', '0'); rt.load(); } },
      { label: '🎯 2014-17：32 位定长 + 操作码 8 位（含寻址方式位）→ 24 位地址码分给 源寄存器号4 / 基址寄存器号4 / 偏移量16',
        run(rt) { rt.setInput('mode', 'layout'); rt.setInput('w', '32'); rt.setInput('fields', '8,4,4,16'); rt.setInput('nins', '0'); rt.load(); } },
      { label: '🎯 2020-16：字长 16 位 + 要 48 条指令 → 操作码 6 位；4 种寻址方式 2 位 → 地址码 8 位（直接寻址 0~255）',
        run(rt) { rt.setInput('mode', 'layout'); rt.setInput('w', '16'); rt.setInput('fields', '6,2,8'); rt.setInput('nins', '48'); rt.load(); } },
      { label: '📘 教材原型：16 位三地址指令（操作码 4 位 + 三个地址字段各 4 位）',
        run(rt) { rt.setInput('mode', 'layout'); rt.setInput('w', '16'); rt.setInput('fields', '4,4,4,4'); rt.setInput('nins', '0'); rt.load(); } },
    ],

    parse(vals) {
      const mode = vals.mode === 'layout' ? 'layout' : 'expand';
      const num = (s, name, hi, mustPositive) => {
        const t = String(s == null ? '' : s).trim();
        if (!/^\d+$/.test(t)) throw { message: name + '要填非负整数（现在填的是「' + (t || '空') + '」）' };
        const x = Number(t);
        if (x > hi) throw { message: name + '最多 ' + hi + '（现在填的是 ' + x + '）' };
        if (mustPositive && x < 1) throw { message: name + '至少 1（现在填的是 ' + x + '）' };
        return x;
      };

      /* ---------------- 模式① 指令格式：字段拆位 ---------------- */
      if (mode === 'layout') {
        const w = num(vals.w, '指令字长', 64, true);
        const nins = num(vals.nins, '已知指令条数', NINS_MAX, false);

        const raw = String(vals.fields == null ? '' : vals.fields).trim();
        if (!raw) throw { message: '请填「全部字段位数」——按位域从左到右用逗号分隔，如 4,4,4,4' };
        const parts = raw.split(/[,，、;；\s]+/).filter(s => s !== '');
        if (!parts.length) throw { message: '「全部字段位数」没解析出任何数字，例：4,4,4,4' };
        if (parts.length > FIELD_MAX) throw { message: '字段最多 ' + FIELD_MAX + ' 个（现在填了 ' + parts.length + ' 个）' };
        const fields = parts.map((s, i) => {
          if (!/^\d+$/.test(s)) throw { message: '第 ' + (i + 1) + ' 个字段的位数「' + s + '」不是非负整数（只支持一个一个的数字，别写区间或算式）' };
          const b = Number(s);
          if (b > BITS_MAX) throw { message: '第 ' + (i + 1) + ' 个字段填了 ' + b + ' 位，最多 ' + BITS_MAX + ' 位' };
          return b;
        });

        const k = fields[0];
        if (k < 1) throw { message: '第 1 个字段是操作码字段，至少要有 1 位' };
        const sum = fields.reduce((s, b) => s + b, 0);
        /* ⚠ free < 0 时**不抛错**：模式和字段是两组独立输入，切模式时难免一时不自洽；
           抛错会让用户看到"输入有误"卡片而看不到任何诊断。这里改成在画面上报红并给出差额。 */
        const free = w - sum;

        const rest = fields.slice(1);
        const rows = rest.map((b, i) => ({
          name: '字段 ' + (i + 2), bits: b,
          umax: Math.pow(2, b) - 1,
          smin: b >= 1 ? -Math.pow(2, b - 1) : 0,
          smax: b >= 1 ? Math.pow(2, b - 1) - 1 : 0,
        }));

        return {
          mode: 'layout', w, k, fields, sum, free, rows, nins,
          opSpace: Math.pow(2, k),                       // 指令条数上限（只由 k 决定）
          kNeed: nins > 0 ? bitsForCount(nins) : null,   // 要 nins 条指令至少需要几位操作码
          byteAligned: w % 8 === 0,
          warn: free < 0 ? ('各字段加起来 ' + sum + ' 位，比指令字长 ' + w + ' 位多了 ' + (-free) + ' 位 —— 这个格式放不下。') : '',
        };
      }

      /* ---------------- 模式② 扩展操作码：逐级扣除 ---------------- */
      const k = num(vals.k, '操作码位数 k', K_MAX, true);
      const a = num(vals.a, '地址字段位数 a', A_MAX, false);
      const qs = [
        num(vals.q0, '零地址指令需要条数', NINS_MAX, false),
        num(vals.q1, '一地址指令需要条数', NINS_MAX, false),
        num(vals.q2, '二地址指令需要条数', NINS_MAX, false),
        num(vals.q3, '三地址指令需要条数', NINS_MAX, false),
      ];

      let M = -1;
      for (let i = 3; i >= 0; i--) if (qs[i] > 0) { M = i; break; }
      if (M < 0) {
        return { mode: 'expand', k, a, qs, M: -1, levels: [], L: null, L8: null,
          hint: '四级「需要条数」全是 0 —— 请至少给一级填一个大于 0 的条数（那一级就是"最高级"，它的操作码位数就是你填的 k）。' };
      }

      const levels = [];
      let prevRemain = null;
      let capped = false;
      for (let m = M; m >= 0; m--) {
        const rawPool = m === M ? Math.pow(2, k) : prevRemain * Math.pow(2, a);
        let pool = rawPool;
        if (rawPool > CAP) { pool = CAP; capped = true; }        // 兜底：合法输入永远到不了这里
        const need = qs[m];
        const over = need > pool;
        const used = over ? pool : need;                          // need = 0 时 used = 0（"只问上限"）
        const remain = pool - used;
        levels.push({
          m, name: PREFIX_NAME[m], addrCount: m,
          opBits: k + (M - m) * a,
          pool, need, used, remain, over,
        });
        prevRemain = remain;
      }

      const L = k + M * a;
      return {
        mode: 'expand', k, a, qs, M, levels,
        /* a = 0 时各级操作码位数相同，L 不是"指令字长"（真字长由别的字段决定）⟹ 置 null，
           让画面、日志与 data-* 属性三处口径一致（都显示"不适用"）。 */
        L: a === 0 ? null : L,
        L8: a === 0 ? null : Math.ceil(L / 8) * 8,
        hint: '', capped,
        badLevel: levels.find(l => l.over) ? levels.find(l => l.over).name : '',
      };
    },

    /* ======================== 渲染（纯渲染，只读 model） ======================== */
    render(ctx) {
      const { model: m, stage } = ctx;
      const esc = RC408.util.esc;
      const card = (title, body) =>
        '<div class="rounded-xl bg-white border border-slate-200 px-4 py-3">' +
        RC408.ui.sectionTitle(title) + body + '</div>';

      /* ---------------- 模式① ---------------- */
      if (m.mode === 'layout') {
        /* 位域条：**只有一个 flex 行、段间不留 gap、段用 border-box** ⟹ 各段宽度严格正比于位数之和为容器宽，
           离线（无 Tailwind）也是这个几何（§3.8-18 / §6.2.34⑨ 的教训）。 */
        const segs = m.fields.map((b, i) => ({
          name: i === 0 ? '操作码' : ('字段' + (i + 1)),
          bits: b, color: SEG_COLORS[i % SEG_COLORS.length],
        }));
        if (m.free > 0) segs.push({ name: '空闲', bits: m.free, color: '#cbd5e1' });
        const bar = segs.map(s =>
          '<div data-if-seg="' + esc(s.name) + '" data-if-bits="' + s.bits + '"' +
          ' style="flex:' + s.bits + ' 1 0;box-sizing:border-box;margin:0;border-right:1px solid #fff;' +
          'background:' + s.color + ';border-radius:4px;padding:6px 2px;overflow:hidden;text-align:center;color:#fff">' +
          '<div style="font-weight:800;font-size:11px;line-height:1.25;white-space:nowrap">' + esc(s.name) + '</div>' +
          '<div style="font-family:Consolas,monospace;font-size:10px;line-height:1.25;white-space:nowrap">' + s.bits + ' 位</div>' +
          '</div>').join('');

        const cards =
          RC408.ui.statCard('指令字长', m.w + ' 位',
            m.byteAligned ? '是 8 的整数倍 ✓' : '不是 8 的整数倍（按字节编址要进位）',
            m.byteAligned ? 'text-emerald-600' : 'text-amber-600') +
          RC408.ui.statCard('操作码 ' + m.k + ' 位', '最多 ' + m.opSpace + ' 条指令',
            '指令条数上限 = 2^' + m.k, 'text-indigo-600') +
          RC408.ui.statCard('字段合计', m.sum + ' 位',
            m.free >= 0 ? ('空闲 ' + m.free + ' 位') : ('超出 ' + (-m.free) + ' 位'),
            m.free >= 0 ? 'text-slate-800' : 'text-rose-600') +
          RC408.ui.statCard('反算操作码位数', m.kNeed === null ? '—' : (m.kNeed + ' 位'),
            m.kNeed === null ? '把「已知指令条数」填上就会算' : ('要 ' + m.nins + ' 条指令，2^' + m.kNeed + ' ≥ ' + m.nins),
            m.kNeed === null ? 'text-slate-400' : (m.kNeed <= m.k ? 'text-emerald-600' : 'text-rose-600'));

        const fieldRows = m.rows.map(r =>
          '<tr class="border-b border-slate-100">' +
          '<td class="px-2 py-1">' + esc(r.name) + '</td>' +
          /* "位数"与"容量"合成一列：5 列并排时补码范围那列会被挤成一条缝（窗35 目视截图发现）。 */
          '<td class="px-2 py-1 text-right font-mono">' + r.bits +
          (r.bits >= 1 ? '<span class="text-slate-400">（2^' + r.bits + ' = ' + (r.umax + 1) + '）</span>' : '') + '</td>' +
          '<td class="px-2 py-1 text-right font-mono">0 ~ ' + r.umax + '</td>' +
          '<td class="px-2 py-1 text-right font-mono">' + r.smin + ' ~ ' + r.smax + '</td>' +
          '</tr>').join('');

        const table =
          '<table class="w-full text-sm"><thead><tr class="text-[11px] text-slate-400">' +
          '<th class="px-2 py-1 text-left">字段</th><th class="px-2 py-1 text-right">位数（容量）</th>' +
          '<th class="px-2 py-1 text-right">无符号范围</th><th class="px-2 py-1 text-right">补码范围</th>' +
          '</tr></thead><tbody>' +
          (fieldRows || '<tr><td class="px-2 py-1 text-slate-400" colspan="4">整条指令只有操作码一个字段。</td></tr>') +
          '</tbody></table>';

        const warn = m.warn
          ? '<div data-if-warn="1" class="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs text-rose-700 leading-relaxed">⚠ ' + esc(m.warn) + '</div>'
          : '';

        const ninsNote = m.kNeed === null ? '' :
          '<div class="mt-2 text-xs text-slate-600">要编出 <b>' + m.nins + '</b> 条指令，操作码至少 <b>' + m.kNeed + '</b> 位（2^' +
          m.kNeed + ' = ' + Math.pow(2, m.kNeed) + ' ≥ ' + m.nins + (m.kNeed > 0 ? '，而 2^' + (m.kNeed - 1) + ' = ' + Math.pow(2, m.kNeed - 1) + ' < ' + m.nins : '') + '）；你写的操作码字段是 <b>' + m.k + '</b> 位 ⟹ ' +
          (m.kNeed <= m.k ? '<b class="text-emerald-600">够用</b>' : '<b class="text-rose-600">不够用</b>') + '。</div>';

        stage.innerHTML =
          '<div class="space-y-4">' +
          '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + cards + '</div>' +
          warn +
          card('① 位域条（宽度严格正比于位数）',
            '<div data-if-bar="1" data-if-w="' + m.w + '" style="display:flex;width:100%;align-items:stretch">' + bar + '</div>' +
            '<div class="mt-2 text-xs text-slate-500">共 ' + segs.length + ' 段（' + m.fields.length + ' 个字段' +
            (m.free > 0 ? ' + 1 段空闲' : '') + '），各段位数合计 ' + m.sum + ' 位。</div>') +
          card('② 逐字段容量（与"填了多少条指令"无关，只由位数决定）', table + ninsNote) +
          '<div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">' +
          '💡 <b>考点提醒：</b>① <b>指令字长 ≠ 机器字长 ≠ 存储字长</b>；② 操作码位数只由"要多少条指令"决定（2^k ≥ N）；' +
          '③ 地址字段位数决定<b>寻址范围 / 寄存器个数</b>，按补码解释时范围减半、可表示负数；' +
          '④ 算出的字长若不是 8 的整数倍，按字节编址时要进位（2017-16：23 → 24）。</div>' +
          '</div>';
        return;
      }

      /* ---------------- 模式② ---------------- */
      if (m.M < 0) {
        stage.innerHTML =
          '<div class="space-y-4">' +
          '<div data-if-hint="1" class="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 leading-relaxed">' +
          esc(m.hint) + '</div></div>';
        return;
      }

      const lvHtml = lv =>
        '<tr data-if-m="' + lv.m + '" data-if-pool="' + lv.pool + '" data-if-need="' + lv.need + '" data-if-remain="' + lv.remain + '"' +
        ' class="border-b border-slate-100' + (lv.over ? ' bg-rose-50' : '') + '">' +
        '<td class="px-2 py-1">' + esc(lv.name) + '</td>' +
        '<td class="px-2 py-1 text-right font-mono">' + lv.addrCount + '</td>' +
        '<td class="px-2 py-1 text-right font-mono">' + lv.opBits + '</td>' +
        '<td class="px-2 py-1 text-right font-mono">' + lv.pool + '</td>' +
        '<td class="px-2 py-1 text-right font-mono">' + lv.need + '</td>' +
        '<td class="px-2 py-1 text-right font-mono ' + (lv.over ? 'text-rose-600 font-bold' : 'text-emerald-600') + '">' + lv.remain + '</td>' +
        '<td class="px-2 py-1 text-xs ' + (lv.over ? 'text-rose-600' : 'text-slate-500') + '">' +
        (lv.need === 0 ? '只问上限：本级最多 ' + lv.pool + ' 条' : (lv.over ? '放不下（缺 ' + (lv.need - lv.pool) + ' 条）' : '够用，剩 ' + lv.remain + ' 个编码')) +
        '</td></tr>';

      /* ⚠ "编码池"与"本级最多条数"是**同一个量**（池子多大就最多编出多少条）⟹ 只留一列，
         免得两列永远相等、看着像两个独立指标（窗35 目视截图时发现的第一版缺陷）。 */
      const table =
        '<table class="w-full text-sm"><thead><tr class="text-[11px] text-slate-400">' +
        '<th class="px-2 py-1 text-left">级别</th><th class="px-2 py-1 text-right">地址字段数</th>' +
        '<th class="px-2 py-1 text-right">本级操作码位数</th><th class="px-2 py-1 text-right">本级最多条数（＝编码池）</th>' +
        '<th class="px-2 py-1 text-right">需要条数</th>' +
        '<th class="px-2 py-1 text-right">剩余前缀</th><th class="px-2 py-1 text-left">结论</th></tr></thead><tbody>' +
        m.levels.map(lvHtml).join('') + '</tbody></table>';

      /* 编码池的两种画法：池 ≤ 32 画方块（一眼数得清"用掉几个"），更大就画比例条。
         两种都用内联样式，离线无 Tailwind 也不塌（§6.2.34⑨）。 */
      const poolHtml = lv => {
        if (lv.pool >= 1 && lv.pool <= 32) {
          const cells = [];
          for (let i = 0; i < lv.pool; i++) {
            const used = i < lv.used;
            cells.push('<div data-if-cell="' + i + '" data-if-used="' + (used ? 1 : 0) + '"' +
              ' style="width:15px;height:15px;border-radius:3px;box-sizing:border-box;margin:0;background:' +
              (used ? '#f43f5e' : '#10b981') + '"></div>');
          }
          return '<div data-if-pool-blocks="' + lv.m + '" data-if-total="' + lv.pool + '"' +
            ' style="display:flex;flex-wrap:wrap;gap:2px">' + cells.join('') + '</div>';
        }
        const pct = lv.pool > 0 ? (lv.used / lv.pool) * 100 : 0;
        return '<div data-if-pool-bar="' + lv.m + '" data-if-used-pct="' + pct.toFixed(4) + '"' +
          ' style="display:flex;width:100%;height:16px;border-radius:4px;overflow:hidden;box-sizing:border-box;margin:0">' +
          '<div style="width:' + pct.toFixed(4) + '%;background:#f43f5e"></div>' +
          '<div style="width:' + (100 - pct).toFixed(4) + '%;background:#10b981"></div></div>';
      };

      const poolBlocks = m.levels.map(lv =>
        '<div style="margin-bottom:8px">' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:3px">' + esc(lv.name) +
        '（操作码 ' + lv.opBits + ' 位，编码池 ' + lv.pool + ' 个：用掉 ' + lv.used + ' / 剩 ' + lv.remain + '）</div>' +
        poolHtml(lv) + '</div>').join('');

      const bad = m.badLevel;
      const lCard = m.a === 0
        ? RC408.ui.statCard('指令字长', '不适用',
          'a = 0：各级共用同一个操作码字段（没有地址字段让位）', 'text-slate-400')
        : RC408.ui.statCard('最短指令字长', m.L + ' 位',
          m.L === m.L8 ? '正好是 8 的整数倍 ✓' : ('按字节编址要进位到 ' + m.L8 + ' 位'),
          m.L === m.L8 ? 'text-emerald-600' : 'text-amber-600');

      const cards =
        RC408.ui.statCard('最高级', PREFIX_NAME[m.M] + '指令',
          '它有 ' + m.M + ' 个地址字段，操作码 ' + m.k + ' 位', 'text-indigo-600') +
        RC408.ui.statCard('地址字段位数 a', m.a + ' 位',
          m.a === 0 ? '各级共用同一操作码字段' : '每让出一级，操作码多 ' + m.a + ' 位', 'text-slate-800') +
        lCard +
        RC408.ui.statCard('判定', bad ? (bad + '放不下') : '各级都够用',
          bad ? ('编码池差 ' + (m.levels.find(l => l.over).need - m.levels.find(l => l.over).pool) + ' 条') : '每级的需要条数都没超过本级上限',
          bad ? 'text-rose-600' : 'text-emerald-600');

      const formula = m.a === 0
        ? '本级操作码 <b>' + m.k + '</b> 位 ⟹ 编码池 <b>' + Math.pow(2, m.k) + '</b> 个；被格式标识占用 <b>' + m.qs[m.M] +
          '</b> 个后剩 <b>' + m.levels[0].remain + '</b> 个给别的格式（同字段上的格式必须互斥划分编码）。'
        : '指令字长 L = k + M×a = ' + m.k + ' + ' + m.M + '×' + m.a + ' = <b>' + m.L + '</b> 位' +
          (m.L === m.L8 ? '（正好 8 的倍数）' : '；按字节编址取 8 的倍数 ⟹ <b>' + m.L8 + '</b> 位');

      stage.innerHTML =
        '<div class="space-y-4">' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + cards + '</div>' +
        card('① 编码池（红 = 本级用掉的编码，绿 = 剩余可作下一级前缀）', poolBlocks + (m.capped ? '<div class="text-xs text-rose-600">⚠ 编码池超过兜底上限，已截断显示（合法输入不会到这）。</div>' : '')) +
        card('② 逐级扣除表', table) +
        card('③ 结论', '<div data-if-l="' + (m.L === null ? '' : m.L) + '" data-if-l8="' + (m.L8 === null ? '' : m.L8) + '"' +
          ' class="text-sm text-slate-700 leading-relaxed">' + formula +
          '<div class="mt-1.5 text-xs text-slate-500">每一级的指令字长都等于 L（操作码多几位、地址码就少几位），所以 <b>逐级扩展不改变指令字长</b>。</div></div>') +
        '<div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">' +
        '💡 <b>考点提醒：</b>① 每级都要<b>先扣掉上一级的余额</b>再算上限（这就是"扣除法"）；' +
        '② 算出的字长要取 <b>8 的整数倍</b>；③ 同一字段上的两个格式，操作码<b>取值集合不能相交</b>——' +
        '2026-43 的 op2 与 op3 都在高位字段所以不能相同，op1 在低位字段所以可以和 op2 相同。</div>' +
        '</div>';
    },

    logs(m) {
      if (m.mode === 'layout') {
        if (m.free < 0) {
          return [{ type: 'error', text: m.warn }];
        }
        const out = [
          { type: 'info', text: '指令字长 ' + m.w + ' 位 = 操作码 ' + m.k + ' 位 + 其余字段 ' + m.rows.map(r => r.bits).join(' / ') + ' 位' + (m.free > 0 ? '（空闲 ' + m.free + ' 位）' : '') },
          { type: 'success', text: '操作码 ' + m.k + ' 位 ⟹ 最多 ' + m.opSpace + ' 条指令；' + (m.rows.length ? ('各字段容量：' + m.rows.map(r => '2^' + r.bits + '=' + (r.umax + 1)).join('、')) : '无其他字段') },
        ];
        if (m.kNeed !== null) out.push({ type: m.kNeed <= m.k ? 'info' : 'error', text: '要 ' + m.nins + ' 条指令 ⟹ 操作码至少 ' + m.kNeed + ' 位，你写的 ' + m.k + ' 位' + (m.kNeed <= m.k ? '够用' : '不够用') });
        if (!m.byteAligned) out.push({ type: 'warn', text: '指令字长 ' + m.w + ' 位不是 8 的整数倍 —— 按字节编址时要进位' });
        return out;
      }
      if (m.M < 0) return [{ type: 'warn', text: m.hint }];
      const out = [];
      if (m.a > 0) {
        out.push({ type: 'info', text: '指令字长 L = k + M×a = ' + m.k + ' + ' + m.M + '×' + m.a + ' = ' + m.L + ' 位' + (m.L === m.L8 ? '' : ('，按字节编址取 ' + m.L8 + ' 位')) });
      } else {
        out.push({ type: 'info', text: 'a = 0：各级共用同一个操作码字段，编码池 = 2^' + m.k + ' = ' + Math.pow(2, m.k) + ' 个' });
      }
      m.levels.forEach(lv => {
        out.push({
          type: lv.over ? 'error' : 'info',
          text: lv.name + '：操作码 ' + lv.opBits + ' 位，本级最多 ' + lv.pool + ' 条' +
            (lv.need === 0 ? '（未指定需要量）' : ('，需要 ' + lv.need + ' 条 ⟹ ' + (lv.over ? ('放不下，缺 ' + (lv.need - lv.pool) + ' 条') : ('剩 ' + lv.remain + ' 个编码作下一级前缀')))),
        });
      });
      const zero = m.levels.find(l => l.m === 0);
      if (zero && zero.need === 0) out.push({ type: 'success', text: '零地址指令最多 ' + zero.pool + ' 条' });
      return out;
    },
  });
})();
