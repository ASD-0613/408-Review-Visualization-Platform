'use strict';
/* ============================================================================
 * coa-pipeline.js —— 【计算机组成原理】五段指令流水线与冒险处理（前缀 _pl）
 * 考情：18 年中 **11 年**考（选 11 + 大题 1）：大 2012-44（画流水线图）；选 2009-18、2010-19、2013-18、
 * 2016-19、2017-17、2018-20、2019-18·19、2023-19、2024-19、2025-19。
 * 固定考点：数据冒险判定（RAW）、转发 / 气泡、周期数计算。
 * （**窗12/窗42** 勘误：旧行写"17 年中 8 年"、"选 8"，年份表漏 2009·2013·2017，且把 2014-44 当成流水线题；本行已按现算重写。）
 *
 * 指令模型（简化到课程粒度，五段 IF/ID/EX/MEM/WB）：
 *   每条指令 { op, rs, rt, rd, imm } 按操作数依赖自动判定 RAW 冒险：
 *   - 前一条的目的寄存器 = 本条的源寄存器 → 数据冒险
 *   - 处理方式可切换：插入气泡（stall，本条推迟到冒险消除）或 转发（forwarding，
 *     EX→EX / MEM→EX 前递，仅 load-use 需 1 拍 stall）
 * 快照：每个时钟周期一帧，含五段占用、冒险标注、气泡、累计周期数。
 * ========================================================================== */

RC408.registerModule({
  id: 'coa-pipeline',
  mode: 'stepper',
  title: '五段指令流水线与冒险处理',

  theory: `
> **为什么要有它**：把一条指令拆成 5 段、让不同指令的 5 段重叠执行，理想情况**每拍完成一条**、加速比接近 5；代价是重叠带来的三类**冒险**，以及必须会算的**吞吐率 / 加速比 / 效率**。
> **怎么实现**：段间用**流水段寄存器**锁存，每段一拍，**时钟周期按最长段 + 段寄存器延迟**取；冒险用**转发**、**阻塞插气泡**、**分支预测**三类手段处理。
> **记住什么**：**k 段流水执行 n 条指令共 k + (n − 1) 拍**；**吞吐率 = 条数 ÷ 总时间**、**加速比 = nk ÷ (k + n − 1)**、**效率 = 加速比 ÷ k**；**load-use 即使有转发也必停 1 拍**。

## 五段流水线与时空图

- 五段：**IF 取指 → ID 译码 / 取数 → EX 执行 → MEM 访存 → WB 写回**，每段一拍；
- 段间各有一个**流水段寄存器**（IF/ID、ID/EX、EX/MEM、MEM/WB）：它在每拍末锁存上一段的输出、下一拍交给下一段，"段与段并行"才成立；
- **时空图**的画法：横轴 = 时钟周期，纵轴 = 指令；同一条指令的 5 段画成一条**斜线**，同一列上是不同指令的不同段；
- **时钟周期怎么取**：按**最慢的那一段**取（2009-18：以最长的执行时间为准，否则用时长的段完不成），并把**流水段寄存器延迟**加进去（2018-20：各部件最长 80ps + 寄存器 20ps ⟹ 时钟周期 100ps）；
- 理想（无冒险）时：**n 条指令、k 段 ⟹ 共 k + (n − 1) 拍**，最前 k − 1 拍在"填"、最后 k − 1 拍在"排空"；
- 题目默认**按序发射、按序完成**（前一条不进入下一段、后一条不能进入该段），画图与数拍都按这个前提。

## 性能三量：吞吐率 / 加速比 / 效率

| 量 | 式子（k 段、n 条、每拍 Δt） | 极限（n 趋于无穷） |
| --- | --- | --- |
| 总时间 T | (k + n − 1) × Δt | — |
| 吞吐率 TP | n ÷ T = n ÷ ((k + n − 1)Δt) | 1 ÷ Δt（每拍一条） |
| 加速比 S | 顺序 nkΔt ÷ 流水 T = nk ÷ (k + n − 1) | k |
| 效率 E | S ÷ k = n ÷ (k + n − 1) | 1 |

- 2013-18 的算法：4 段、100 条 ⟹ 总周期 4 + 99 = 103；**吞吐率 = 主频 × 条数 ÷ 周期数** = 1.03G × 100 ÷ 103 ≈ **1.0 × 10^9 条/s**（别直接把"每拍一条"当实际吞吐率）；
- 三式里的 n 是**指令条数**、k 是**段数**；无冒险时每条指令仍占 k 拍，别把"k + (n − 1)"误当成"每条指令 k 拍"。

## 数据冒险（RAW）——408 考得最多的一种

- 判定：**第 i 条写 R、第 i + k 条（k ≥ 1）读 R** ⟹ 写后读冒险；两条都读、或先读后写都不算（2019-18 问"哪一对不存在数据冒险"，就是逐对查"有没有同一寄存器被先写后读"）；
- **转发（旁路）**：把 EX/MEM、MEM/WB 段的结果直接送到**后面需要它的那条指令**（不限于紧邻的那一条）的 EX 输入，多数 RAW 因此**不必停顿**（2010-19 的数据旁路技术）；
- **load-use 是例外**：load 的数据要到 **MEM 段末**才拿到，紧随其后使用它的指令**即使有转发也必须阻塞 1 拍**（2024-19）；
- **无转发时**：要等到前一条 **WB 写回后**才能读，中间插入若干气泡（段划分不同、气泡数不同，按时空图数，别套死数字）；
- 气泡的代价：总周期 = k + (n − 1) + **气泡数**；2012-44 就是先画时空图、再数"因数据相关被阻塞"的拍（第 3 条指令的 ID 段被推迟到前两条写回之后）。

## 结构冒险与控制冒险

- **结构冒险**（资源相关）：同一拍两条指令抢同一个部件——典型是"取指与访存共用一个存储器"，解法是**分离 I-Cache / D-Cache** 或让存储器多端口；
- **控制冒险**：转移指令改变 PC，后面已取入的指令可能作废——解法是**分支预测**（静态 / 动态）、**延迟槽**、尽早算出转移地址；
- 三类相关的名字要能对上：**结构相关 = 资源相关；数据相关；控制相关（由转移指令引起）**（2010-19）。

## 流水线分类与"以空间 / 时间换"

- **超标量**：一个 CPU 里有多条流水线、**每拍可完成多条**指令，实质是**以空间换时间**（2017-17：它不改变单条流水线功能段的处理时间）；
- **超流水线**：把段再细分、提高时钟频率，**以时间换空间**（部件更少但拍数更多）；
- **动态调度**：乱序执行 + 寄存器重命名 + 保留站，让有冒险的指令先等、后面的先做；
- **单周期 / 多周期 / 流水线**对比：单周期 CPI = 1 但时钟周期最长；多周期把一条指令拆成多拍、部件复用；流水线让多条指令重叠，**理想 CPI = 1**、靠重叠提高吞吐率（2025-19 还考了"PC 不属于通用寄存器组""控制器内含指令译码电路"这类边角）。

## 考点提醒（易错点）

1. **无冒险时 n 条指令 = k + (n − 1) 拍**，不是 n × k——重叠已经发生了；
2. **load-use 是唯一"转发也救不了"的 RAW**（必须停 1 拍）；
3. **吞吐率要看总周期数**：每拍一条只是 n 趋于无穷的极限；
4. **时钟周期按最长段算、再加段寄存器延迟**：2009-18 与 2018-20 考的都是这一条；
5. 判定 RAW 只看"**同一寄存器 + 先写后读**"；读写不同寄存器就没有冒险；
6. **超标量 ≠ 超流水线**：前者叠多条流水线（空间换时间），后者细分段（时间换空间）。

> **真题考情**：**11/18 年（选 11 + 大题 1）**：选 2009-18（时钟周期取最长段）、2010-19（三类相关与数据旁路）、2013-18（吞吐率）、
> 2016-19（写后读时空图）、2017-17（超标量）、2018-20（时钟周期含寄存器延迟）、2019-18·19、2023-19、2024-19（load-use）、2025-19；大 2012-44（时空图与阻塞拍数）。
`,

  inputs: [
    {
      key: 'program', label: '指令序列（每行一条：op 目的, 源1, 源2/imm）', type: 'textarea', rows: 6, wide: true,
      default: 'add R1, R2, R3\nsub R4, R1, R5\nand R6, R1, R7\nor R8, R4, R9\nlw R2, 0(R10)\nadd R11, R2, R12',
      help: '支持：add/sub/and/or（R 型）、lw R, off(Rbase)（load）、sw、beq；寄存器 R0~R15',
    },
    {
      key: 'mode', label: '冒险处理方式', type: 'select', default: 'forward', wide: true,
      options: [
        { v: 'forward', t: '转发 Forwarding（EX→EX / MEM→EX 前递；load-use 停 1 拍）' },
        { v: 'stall', t: '无转发：RAW 冒险插入气泡（2012 真题口径）' },
      ],
    },
  ],

  quickActions: [
    { label: '无冒险示例', run(rt) { rt.setInput('program', 'add R1, R2, R3\nsub R4, R5, R6\nand R7, R8, R9\nor R10, R11, R12'); rt.load(); } },
    { label: '2012 真题风格（连续相关）', run(rt) { rt.setInput('program', 'add R1, R2, R3\nsub R4, R1, R5\nand R6, R4, R7'); rt.load(); } },
  ],

  parse(vals) {
    const lines = vals.program.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3 || lines.length > 10) throw { message: '指令条数 3 ~ 10' };
    const isReg = r => /^R([0-9]|1[0-5])$/.test(r);
    const prog = lines.map((l, i) => {
      const m = l.match(/^(\w+)\s+(.+)$/);
      if (!m) throw { message: `第 ${i + 1} 行「${l}」格式错误` };
      const op = m[1].toLowerCase();
      const parts = m[2].split(',').map(x => x.trim());
      let ins;
      if (op === 'lw' || op === 'sw') {
        const mm = (parts[1] || '').match(/^(.+)\((.+)\)$/);
        if (!mm) throw { message: `第 ${i + 1} 行访存指令格式应为 lw R1, 0(R2)` };
        ins = { op, dest: parts[0], off: mm[1].trim(), base: mm[2].trim(), srcs: [parts[0], mm[2].trim()], dest2: parts[0] };
        if (!isReg(parts[0]) || !isReg(mm[2])) throw { message: `第 ${i + 1} 行寄存器名无效（R0~R15）` };
      } else if (op === 'beq') {
        if (parts.length !== 3) throw { message: `beq 需 3 个操作数` };
        ins = { op, srcs: [parts[0], parts[1]], dest: null, label: parts[2] };
      } else if (['add', 'sub', 'and', 'or'].includes(op)) {
        if (parts.length !== 3) throw { message: `${op} 需 3 个操作数` };
        ins = { op, dest: parts[0], srcs: [parts[1], parts[2]] };
        if (!isReg(parts[0])) throw { message: `第 ${i + 1} 行目的寄存器「${parts[0]}」无效` };
      } else {
        throw { message: `不支持的指令 ${op}（可用 add/sub/and/or/lw/sw/beq）` };
      }
      ins.text = l; ins.idx = i;
      return ins;
    });
    return { prog, mode: vals.mode === 'stall' ? 'stall' : 'forward' };
  },

  buildSnapshots(model) {
    const { prog, mode } = model;
    const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];
    /* 逐拍模拟：每条指令记录各段起始周期；无转发时 RAW 需等 2 拍，转发时 load-use 等 1 拍 */
    const start = prog.map(() => ({}));       // start[i][stage] = 周期
    const lastWrite = {};                     // reg → { idx: 写指令号, wbCycle: 写回完成周期, isLoad }
    let cycle = 0;
    const events = [];                        // 冒险事件日志
    let lastLoadIdx = -1, lastLoadMemEnd = -1;

    prog.forEach((ins, i) => {
      // IF：顺序发射（简化：无控制冒险；每拍可发射新指令，除非被 stall 推迟）
      let ifCycle = i === 0 ? 1 : Math.max(start[i - 1].IF + 1, 1);
      // 计算数据冒险需要的额外等待（从 IF 推迟实现）
      let stalls = 0, hazardWith = -1;
      if (ins.srcs) {
        ins.srcs.forEach(sr => {
          const w = lastWrite[sr];
          if (!w) return;
          const idCycle = ifCycle + 1;                      // 本条 ID 段（读寄存器）周期
          let readyCycle, needStall;
          if (mode === 'stall') {
            readyCycle = w.wbCycle + 1;                     // 无转发：写回后下一拍才能读到新值
            needStall = idCycle < readyCycle;
          } else {
            // 转发：EX/MEM、MEM/WB 前递 → EX 段最早可用周期
            readyCycle = w.isLoad ? w.memCycle + 2 : Math.max(w.exCycle, w.memCycle) + 1;
            needStall = idCycle + 1 < readyCycle;           // 本条 EX 段 = idCycle+1
          }
          if (needStall && idCycle - ifCycle + stalls >= 0) {
            const extra = mode === 'stall'
              ? Math.max(0, readyCycle - (ifCycle + 1 + 1) + 0)
              : Math.max(0, readyCycle - (ifCycle + 1 + 1));
            if (extra > stalls) { stalls = extra; hazardWith = w.idx; }
          }
        });
      }
      ifCycle += stalls;
      if (stalls > 0) {
        events.push({ at: i, stalls, hazardWith, mode });
      }
      // 段周期
      const ifc = ifCycle;
      const idc = ifc + 1;
      const exc = idc + 1;
      const memc = exc + 1;
      const wbc = memc + 1;
      start[i] = { IF: ifc, ID: idc, EX: exc, MEM: memc, WB: wbc };
      // 记录写寄存器信息
      const wReg = ins.op === 'sw' || ins.op === 'beq' ? null : (ins.op === 'lw' ? ins.dest : ins.dest);
      if (wReg) lastWrite[wReg] = { idx: i, wbCycle: wbc, exCycle: exc, memCycle: memc, isLoad: ins.op === 'lw' };
      if (ins.op === 'lw') { lastLoadIdx = i; lastLoadMemEnd = memc; }
      cycle = Math.max(cycle, wbc);
    });
    const totalCycles = cycle;

    /* 快照：每个周期一帧 */
    const snaps = [];
    const push = (c2, note, logType) => snaps.push({
      cycle: c2, totalCycles, prog: prog.map(p => ({ ...p })), start: start.map(x => ({ ...x })),
      mode, events: [...events], note, logType: logType || 'info', desc: note,
    });
    push(0, `就绪：${prog.length} 条指令，${mode === 'stall' ? '无转发（RAW 插气泡）' : '转发（load-use 停 1 拍）'}模式。总周期数 = ${totalCycles}。`,
      'info');
    push(1, `周期 1：第 1 条指令进入 IF。`, 'info');
    for (let c2 = 2; c2 <= totalCycles; c2++) {
      const inStage = prog.map((ins, i) => {
        const st = STAGES.find(sg => start[i][sg] === c2);
        return st ? { i, st } : null;
      }).filter(Boolean);
      const ev = events.find(e => start[e.at].IF === c2);
      let note;
      if (ev) {
        note = `周期 ${c2}：插入 ${ev.stalls} 个气泡——指令 ${ev.at + 1}（${prog[ev.at].op}）与指令 ${ev.hazardWith + 1} 存在 RAW 数据冒险${mode === 'stall' ? '（无转发，等待写回）' : '（load-use，转发也需停 1 拍）'}`;
        push(c2, note, 'error');
      } else if (inStage.length) {
        note = `周期 ${c2}：${inStage.map(x => `指令 ${x.i + 1} 在 ${x.st} 段`).join('；')}`;
        push(c2, note, 'info');
      } else {
        push(c2, `周期 ${c2}：（流水线排空中）`, 'info');
      }
    }
    push(totalCycles + 1, `完成：${prog.length} 条指令共 ${totalCycles} 个周期（无冒险理想值 = ${5 + prog.length - 1}）。加速比 = ${(prog.length * 5 / totalCycles).toFixed(2)}。`,
      'success', `完成！总周期 = ${totalCycles}（理想 ${5 + prog.length - 1}）`);
    return snaps;
  },

  render(ctx) {
    const { snap: s, model, stage } = ctx;
    const n = s.prog.length;
    const cellW = 54, cellH = 40, padL = 150, padT = 30;
    const W = padL + (s.totalCycles + 1) * cellW + 20, H = padT + n * (cellH + 14) + 50;
    const px = c2 => padL + c2 * cellW;
    const py = i => padT + i * (cellH + 14);
    const stageColor = { IF: '#818cf8', ID: '#38bdf8', EX: '#f59e0b', MEM: '#fb923c', WB: '#10b981' };

    /* 时空图：指令行 × 周期列 */
    let grid = '';
    for (let c2 = 0; c2 <= s.totalCycles; c2++) {
      grid += `<line x1="${px(c2)}" y1="${padT - 8}" x2="${px(c2)}" y2="${H - 34}" stroke="#f1f5f9"/>
        <text x="${px(c2) + cellW / 2}" y="${padT - 14}" text-anchor="middle" style="font:600 9.5px Consolas" fill="#94a3b8">${c2}</text>`;
    }
    const rowsSvg = s.prog.map((ins, i) => {
      const y = py(i);
      let row = `<text x="${padL - 8}" y="${y + cellH / 2 + 4}" text-anchor="end" style="font:700 11px Consolas" fill="#475569">${i + 1}. ${ins.text.slice(0, 14)}</text>`;
      const st = s.start[i];
      let prevEnd = null;
      ['IF', 'ID', 'EX', 'MEM', 'WB'].forEach(sg => {
        const c0 = st[sg];
        // 冒险气泡 = 本段与上一段之间有空洞
        if (prevEnd !== null && c0 > prevEnd + 1) {
          row += `<rect x="${px(prevEnd + 1)}" y="${y}" width="${(c0 - prevEnd - 1) * cellW}" height="${cellH}" rx="5" fill="#fee2e2" stroke="#f87171" stroke-dasharray="4 3"/>
            <text x="${px(prevEnd + 1) + (c0 - prevEnd - 1) * cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" style="font:700 10px sans-serif" fill="#e11d48">气泡</text>`;
        }
        row += `<rect x="${px(c0)}" y="${y}" width="${cellW}" height="${cellH}" rx="5" fill="${stageColor[sg]}"/>
          <text x="${px(c0) + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" style="font:800 12px sans-serif" fill="#fff">${sg}</text>`;
        prevEnd = c0;
      });
      return row;
    }).join('');

    const stats =
      RC408.ui.statCard('指令条数', n, `${model.mode === 'stall' ? '无转发（气泡）' : '转发 Forwarding'}`) +
      RC408.ui.statCard('总周期数', s.totalCycles, `理想值 ${5 + n - 1}（无冒险）`, 'text-indigo-600') +
      RC408.ui.statCard('冒险次数', (s.events || []).length, 'RAW 数据冒险', (s.events || []).length ? 'text-rose-600' : 'text-emerald-600') +
      RC408.ui.statCard('加速比', (n * 5 / s.totalCycles).toFixed(2), '理想加速 ≈ 5', 'text-amber-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('流水线时空图（横轴 = 时钟周期；红色虚线框 = 气泡/等待）')}
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" style="min-width:${Math.min(W, 900)}px">${grid}${rowsSvg}</svg>
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#818cf8', 'IF 取指')}${RC408.ui.legend('#38bdf8', 'ID 译码')}
          ${RC408.ui.legend('#f59e0b', 'EX 执行')}${RC408.ui.legend('#fb923c', 'MEM 访存')}
          ${RC408.ui.legend('#10b981', 'WB 写回')}${RC408.ui.legend('#f87171', '气泡（等待）')}
        </div>
        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>转发能消除绝大多数 RAW 停顿，但 <b>load-use 冒险必须停 1 拍</b>（数据在 MEM 段末才可用）；
          无转发时每个 RAW 需等待写回完成（保守 2 拍）。切换上方"冒险处理方式"可对比两种口径的总周期数。
        </div>
      </div>`;
  },
});
