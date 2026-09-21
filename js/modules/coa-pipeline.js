'use strict';
/* ============================================================================
 * coa-pipeline.js —— 【计算机组成原理】五段指令流水线与冒险处理（前缀 _pl）
 * 考情：18 年中 8 年考（选 8 + 大题 1；大 2012-44 画流水线图；选 2010-19、2016-19、2018-20、
 * 2019-18/19、2023-19、2024-19、2025-19），固定考点：数据冒险判定（RAW）、转发/气泡、周期数计算。
 * （**窗12** 勘误：原写"17 年中 8 年"；原列的"2014-44"在 exam-history 里不是本考点。）
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
> **为什么要有它**：把一条指令拆成 5 段、让不同指令的 5 段重叠执行，理想情况**每拍完成一条**、加速比 ≈ 5——但重叠会带来三类**冒险**。
> **怎么实现**：判定冒险就三问——**哪些指令对存在数据冒险 / 需要插入几个气泡 / 总共多少时钟周期**；用转发消掉大部分 RAW，load-use 除外。
> **记住什么**：**n 条无冒险指令 = 5 + (n − 1) 个周期**、**load-use 即使有转发也必须停 1 拍**、RAW 的判定范围。

## 五段流水线
IF 取指 → ID 译码 / 取数 → EX 执行 → MEM 访存 → WB 写回。
理想情况每条指令 5 段各占 1 拍，满流后每拍完成 1 条：**n 条无冒险指令总周期 = 5 + (n − 1)**，加速比 ≈ 5。

## 数据冒险（RAW：写后读）——408 只考这一种判定
- 第 i 条**写** R、第 i+k 条（k ≥ 1）**读** R → 冒险；
- **转发（Forwarding）**：把 EX/MEM 或 MEM/WB 段的结果直接前递到下一条的 EX 输入，**大多数 RAW 无需停顿**；
- **load-use 冒险**：load 的数据到 MEM 段末才有，紧随其后的使用指令**即使转发也必须停 1 拍**；
- 无转发时：每个 RAW 都要插气泡直到写回完成（保守算法是 2 个气泡）。

## 结构冒险 / 控制冒险（概念辨析）
- 结构冒险：硬件资源冲突（如指令与数据存储器合一）→ 分离 I-Cache / D-Cache；
- 控制冒险：转移指令改变 PC → 分支预测 / 延迟槽。

## 考点提醒（易错点）
1. **气泡数怎么算**：先按"无冒险"排好，再逐对检查 RAW，需要停几拍就插几个气泡；
2. **load-use 是唯一"转发也救不了"的 RAW**（要停 1 拍）——最高频的陷阱；
3. 总周期 = 5 + (n − 1) + 气泡数，**别忘最后一条指令的 5 段也要走完**；
4. 冒险判定只看**寄存器编号是否相同**且**先写后读**。

> **真题考情**：**8/18 年（选 8 + 大题 1）**：大 2012-44（画流水线图）；选 2010-19、2016-19、2018-20、
> 2019-18·19、2023-19（哪些指令阻塞）、2024-19、2025-19（数据冒险叙述）。
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
