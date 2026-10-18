'use strict';
/* ============================================================================
 * coa-io-port.js —— 【计算机组成原理】I/O 接口与端口（即时计算器）
 * 模式：instant（改输入即出结果、无快照）；整篇包在 IIFE 里，不污染全局
 *
 * 考情（**窗44 从零核定**，逐题回 考情缓存/；结论与依据）：
 *   3/18 年，**全为选择题、无大题** ——
 *   · **2012-21**：I/O 总线的**数据线上传的是 命令字 / 状态字 / 中断类型号**
 *     证据：考情缓存/2012_真题.txt:126-135（题干 I、II、III 三项）
 *          考情缓存/2012_解析.txt:431-434（"控制线和地址线都是单向传输的，从 CPU 传送给 I/O 接口，
 *          而 I/O 接口中的命令字、状态字以及中断类型号均是由 I/O 接口发往 CPU 的，故只能通过
 *          I/O 总线的数据线传输"）⟹ 答案 I、II、III 全选。
 *   · **2017-21**：I/O 指令实现的数据传送通常发生在 **通用寄存器与 I/O 端口之间**
 *     证据：考情缓存/2017_真题.txt:440-446（四选项）
 *          考情缓存/2017_解析.txt:174-177（"I/O 端口又称 I/O 接口，是 CPU 与设备之间的交接面……
 *          CPU 使用地址总线选择所请求的 I/O 端口，使用数据总线在 CPU 寄存器和端口之间传输数据"）
 *          ⟹ 答案 D。
 *   · **2021-20**：**不属于** I/O 接口的是 **磁盘驱动器**（另外三项都是 I/O 控制器）
 *     证据：考情缓存/2021_真题.txt:150-157（题干与 A/B/C/D 四选项）
 *          考情缓存/扫描页/2021_解析_p05.png 顶部（"磁盘驱动器是由磁头、磁盘和读写电路等组成的，
 *          也就是我们平常所说的磁盘本身，A 错误。B、C 和 D 均为 I/O 控制器"）——
 *          ⚠ 2021 解析**全 11 页无文本层**（`--paper 2021` 报"可切块 0 题"），故按闸门 1
 *          用 `--render 2021 4/5 --kind 解析` 渲染扫描页目视取证，PNG 已留档可复核。
 *   ⟹ 年数 3 < 8 且大题 0 ⟹ **不满足火苗口径、不标 hot**（现算见 handover §6.2.44）。
 *
 * 归属备注（**本窗只记录、一个字节都没动数据**，留给「考情归属专项」一并裁，见 handover §6.3-3）：
 *   · `2014-21`（题干"下列有关 I/O 接口的叙述中，错误的是"，四个选项全落在"状态口/控制口合用、
 *     I/O 端口定义、独立编址、统一编址"上 —— 考情缓存/2014_真题.txt:182-187；解析
 *     考情缓存/2014_解析.txt:282-284 正是"采用统一编址时……D 选项错误"）与
 *   · `2015-21`（题干"在采用中断 I/O 方式控制打印输出的情况下，CPU 和打印控制接口中的 I/O 端口
 *     之间交换的信息不可能是"，判据落在端口三件套与"不涉及主存地址"—— 2015 真题文本层乱码，
 *     需渲染 扫描页/2015_真题_p03.png 目视；解析 考情缓存/2015_解析.txt:252-254）
 *   **两道现都登记在 `coa-io`**（js/exam-history.js:1973-1974），但判据都落在"端口 / 编址"上 ⟹
 *   候选改挂本条目。单方面改挂会同时动 `coa-io` 的年数与火苗，按 §6.3-3 的纪律必须与其余线索
 *   一起裁，故**本窗只记录、不改数据**。
 *
 * 数据模型与不变量（先看这里再看实现）
 *   · **三个模式的量**：① 三条线与三个端口的"方向"（枚举，见 HOST_LINES / DEV_LINES / PORT_TABLE）；
 *     ② 端口数 ports = 接口数 devs × 每个接口的端口数 portsPer（默认 3 = 数据 / 状态 / 控制）、
 *        寻址 ports 个端口至少要 bitsFor(ports) 位地址（**不用 Math.log2**：2 的幂上浮点边界会差 1）；
 *     ③ 接口的六项功能与"谁不是接口"的判定（枚举）。
 *   · **量纲**：`ports` / `memUnits` 都是**编址单元个数**（按字节编址时即字节数）；`ioBits` / `memBits`
 *     / `addrBits` 都是**地址线位数**；`baseVal` / `lastVal` 是**地址值**。三类量不许串（§3.8-12）。
 *   · **方向是不变量，且画面里的箭头由它推导**（不是两处各写一遍，§3.8-15）：
 *     主机侧 —— 数据线 `both`（双向）、控制线 `toIface`（单向 CPU→接口）、地址线 `toIface`；
 *     设备侧 —— 数据线 `both`、控制线 `toDev`（单向 接口→设备）、状态线 `fromDev`（单向 设备→接口）；
 *     端口   —— 数据端口 `both`、状态端口 `read`（CPU 只读）、控制端口 `write`（CPU 只写）。
 *     渲染时 `dirArrow()` 按同一个枚举给出箭头的两端，`checkDirInvariants()` 再回头断言一遍
 *     ⟹ 谁改坏了枚举，图与断言会同时发现（冒烟里 `dirBad` 必须为 0）。
 *   · **独立编址**：I/O 与内存**各有一个地址空间**，端口不占内存 ⟹ 可用内存 = 全量；
 *     访问要**专门的 I/O 指令**（IN / OUT）；I/O 地址线可以另设（本题口径 8 位）。
 *   · **统一编址**（存储器映射）：端口占用内存地址空间里**连续 ports 个单元**（从 base 起），
 *     访问用**普通访存指令**（2014-21 的解析："CPU 访存和访问 I/O 端口用的是一样的指令"）。
 *
 * 守卫上限 vs 合法输入上界（§3.8-17⑦：守卫必须 ≥ 合法输入上界，否则静默截断）
 *   devs ≤ 4096、portsPer ≤ 64 ⟹ ports ≤ 262144；地址空间上限 2^40（≪ 2^53，双精度整数精确）；
 *   I/O 地址线位数 ≤ 32；地址轴上的"端口格"只逐项画前 32 个（多出来的在画面上写明"未逐项绘出"，
 *   模型里仍是全量）。
 * ========================================================================== */

(function () {
  const ADDR_MAX = Math.pow(2, 40);   // 编址单元数上限
  const DEV_MAX = 4096;               // 接口（设备）数上限
  const PORTS_PER_MAX = 64;           // 每个接口的端口数上限
  const IO_BITS_MAX = 32;             // I/O 地址线位数上限
  const DRAW_MAX = 32;                // 地址轴上逐项画出的端口格上限

  /* 配色一处定义：渲染与几何判据都读它（避免"两处各写一个颜色"） */
  const C = {
    data: '#2563eb', ctrl: '#d97706', addr: '#059669', stat: '#7c3aed',
    off: '#cbd5e1', ink: '#334155', faint: '#94a3b8', line: '#e2e8f0',
    cpuFill: '#eef2ff', cpuStroke: '#6366f1',
    ifFill: '#f8fafc', ifStroke: '#334155',
    devFill: '#ecfdf5', dev: '#0d9488',
    hitFill: '#fef3c7', hitStroke: '#d97706',
    cardBorder: '#e2e8f0', thFill: '#f1f5f9',
  };

  /* ---------------------------------------------------------------- 小工具 */
  /** 表示 0 .. n−1 至少需要多少位。（不用 Math.log2：n 恰为 2 的幂时浮点边界会差 1） */
  function bitsFor(n) {
    let b = 0, p = 1;
    while (p < n) { p *= 2; b++; }
    return b;
  }

  function hexOf(v, pad) {
    return '0x' + v.toString(16).toUpperCase().padStart(pad, '0');
  }

  /** 十六进制位数（按地址空间大小定，至少 2 位） */
  function hexPad(total) { return Math.max(2, Math.ceil(bitsFor(Math.max(2, total)) / 4)); }

  function p2(n) { return '2^' + Math.round(Math.log2(n)); }

  function fmtBytes(b) {
    if (b >= 1024 * 1024 * 1024 && b % (1024 * 1024 * 1024) === 0) return (b / (1024 * 1024 * 1024)) + ' GB';
    if (b >= 1024 * 1024 && b % (1024 * 1024) === 0) return (b / (1024 * 1024)) + ' MB';
    if (b >= 1024 && b % 1024 === 0) return (b / 1024) + ' KB';
    return b + ' B';
  }

  function fmtPct(x) {
    if (!(x > 0)) return '0%';
    return x >= 0.01 ? (x * 100).toPrecision(3) + '%' : (x * 100).toExponential(2) + '%';
  }

  /** 非负整数（带上下限；mustPositive 时下界即最小合法值） */
  function intOf(raw, name, lo, hi) {
    const t = String(raw == null ? '' : raw).trim();
    if (!/^\d+$/.test(t)) throw { message: name + '要填非负整数（现在填的是「' + (t || '空') + '」）' };
    const x = Number(t);
    if (x < lo) throw { message: name + '至少 ' + lo + '（现在填的是 ' + x + '）' };
    if (x > hi) throw { message: name + '最多 ' + hi + '（现在填的是 ' + x + '）' };
    return x;
  }

  /** 正实数（内存容量这类允许小数） */
  function numOf(raw, name, lo, hi) {
    const t = String(raw == null ? '' : raw).trim();
    if (!/^\d+(?:\.\d+)?$/.test(t)) throw { message: name + '要填正数（现在填的是「' + (t || '空') + '」）' };
    const x = Number(t);
    if (!(x >= lo) || x > hi) throw { message: name + '要在 ' + lo + ' ~ ' + hi + ' 之间（现在填的是 ' + x + '）' };
    return x;
  }

  /** 十六进制地址：收 `F00000` / `0xF00000` / `F00000H` 三种写法，必须落在 limit 之内 */
  function hexValOf(raw, name, limit) {
    const t = String(raw == null ? '' : raw).trim().replace(/[\s,_]/g, '');
    if (!t) throw { message: '请填写' + name };
    let s = t;
    if (/^0[xX]/.test(s)) s = s.slice(2);
    else if (/[hH]$/.test(s)) s = s.slice(0, -1);
    if (!/^[0-9a-fA-F]+$/.test(s)) throw { message: name + '要填十六进制（如 F00000；现在填的是「' + t + '」）' };
    const v = parseInt(s, 16);
    if (!(v >= 0) || v >= limit) throw { message: name + '要小于内存地址上限 ' + hexOf(limit - 1, hexPad(limit)) + '（现在填的是 ' + t + '）' };
    return v;
  }

  /* ------------------------------------------- 方向枚举（唯一真源 + 不变量） */
  const DIR_TEXT = {
    both: '双向',
    toIface: '单向：CPU → 接口',
    toDev: '单向：接口 → 设备',
    fromDev: '单向：设备 → 接口',
  };

  /** 主机侧的 I/O 总线（三条线） */
  const HOST_LINES = [
    {
      id: 'data', name: '数据线', dir: 'both', color: C.data,
      carries: '数据、命令字、状态字、中断类型号',
      anchor: '2012-21：命令字 / 状态字 / 中断类型号都只能在这条线上走',
    },
    {
      id: 'ctrl', name: '控制线', dir: 'toIface', color: C.ctrl,
      carries: '读 / 写命令、中断响应、总线请求与响应、时序',
      anchor: '方向固定：接口不会用控制线反过来命令 CPU',
    },
    {
      id: 'addr', name: '地址线', dir: 'toIface', color: C.addr,
      carries: '端口地址（选中接口里的哪一个端口）',
      anchor: '2017-21：CPU 用地址总线选择所请求的 I/O 端口',
    },
  ];

  /** 设备侧（接口与设备之间）的三条线 */
  const DEV_LINES = [
    { id: 'ddata', name: '数据线', dir: 'both', color: C.data, carries: '真正要在 CPU 与设备之间搬的数据' },
    { id: 'dctrl', name: '控制线', dir: 'toDev', color: C.ctrl, carries: '启动 / 停止 / 读 / 写等设备动作' },
    { id: 'dstat', name: '状态线', dir: 'fromDev', color: C.stat, carries: '忙 / 就绪 / 完成 / 出错（送进状态端口）' },
  ];

  /** 接口内部的三个端口（方向是硬约束：数据双向、状态只读、控制只写） */
  const PORT_TABLE = [
    {
      id: 'pdata', name: '数据端口', dir: 'both', color: C.data,
      who: 'CPU 与设备都能读写', body: '存放要传送的数据，起缓冲作用（匹配主机与设备的速度差）',
    },
    {
      id: 'pstat', name: '状态端口', dir: 'read', color: C.stat,
      who: '设备 / 接口写、CPU 只读', body: '存放状态字：忙 / 就绪 / 完成 / 出错；CPU 写不进去',
    },
    {
      id: 'pcmd', name: '控制端口', dir: 'write', color: C.ctrl,
      who: 'CPU 只写、接口 / 设备读', body: '存放命令字：启动 / 读 / 写 / 停止；CPU 读不出来',
    },
  ];

  /** 端口方向枚举 → 端口盒上画几条箭头（both 两端都有、read 只在读侧、write 只在写侧） */
  const PORT_DIR_TEXT = { both: '双向', read: 'CPU 只读', write: 'CPU 只写' };

  /**
   * 不变量：三条线 / 三个端口的方向必须与上面的定义一致。
   * 渲染的箭头由 `dir` 推导 ⟹ 这个函数同时是"画面语义"的机器判据（§3.8-1）。
   */
  function checkDirInvariants() {
    const bad = [];
    const wantLine = { data: 'both', ctrl: 'toIface', addr: 'toIface', ddata: 'both', dctrl: 'toDev', dstat: 'fromDev' };
    HOST_LINES.concat(DEV_LINES).forEach(l => {
      if (wantLine[l.id] !== l.dir) bad.push('line:' + l.id + '=' + l.dir);
      if (!DIR_TEXT[l.dir]) bad.push('line:' + l.id + ':未知方向');
    });
    const wantPort = { pdata: 'both', pstat: 'read', pcmd: 'write' };
    PORT_TABLE.forEach(p => {
      if (wantPort[p.id] !== p.dir) bad.push('port:' + p.id + '=' + p.dir);
      if (!PORT_DIR_TEXT[p.dir]) bad.push('port:' + p.id + ':未知方向');
    });
    if (HOST_LINES.length !== 3) bad.push('hostLines=' + HOST_LINES.length);
    if (DEV_LINES.length !== 3) bad.push('devLines=' + DEV_LINES.length);
    if (PORT_TABLE.length !== 3) bad.push('ports=' + PORT_TABLE.length);
    return bad;
  }

  /* ------------------------------------------------------------ 模型构造 */
  function buildBus(vals) {
    const pick = String(vals.pick || 'all');
    const ok = ['all', 'data', 'ctrl', 'addr'];
    if (ok.indexOf(pick) < 0) throw { message: '高亮项只支持 all / data / ctrl / addr（现在填的是「' + pick + '」）' };
    return {
      mode: 'bus', pick,
      hostLines: HOST_LINES, devLines: DEV_LINES, ports: PORT_TABLE,
      /* 2012-21 的答案要点：三项都在数据线上 */
      dataCarries: HOST_LINES[0].carries,
      portCount: PORT_TABLE.length,
      dirBad: checkDirInvariants(),
      portDirBad: PORT_TABLE.filter(p => p.dir === 'both' && p.id !== 'pdata').length,
    };
  }

  function buildAddr(vals) {
    const scheme = String(vals.scheme || 'sep');
    if (scheme !== 'sep' && scheme !== 'unified') throw { message: '编址方式只支持 sep / unified' };
    const devs = intOf(vals.devs, '接口（设备）数', 1, DEV_MAX);
    const portsPer = intOf(vals.portsPer, '每个接口的端口数', 1, PORTS_PER_MAX);
    const ports = devs * portsPer;
    if (ports > ADDR_MAX) throw { message: '端口总数 ' + ports + ' 超过演示上限 2^40' };
    const addrBits = bitsFor(ports);              // 寻址 ports 个端口至少需要几位
    const addrCount = Math.pow(2, addrBits);      // 这些地址位能覆盖多少个端口号
    const memMB = numOf(vals.memMB, '内存容量（MB）', 1, 1048576);
    const memUnits = Math.round(memMB * 1024 * 1024);
    const memBits = bitsFor(memUnits);
    const memPad = hexPad(memUnits);
    const memText = fmtBytes(memUnits);
    if (memUnits > ADDR_MAX) throw { message: '内存容量 ' + memText + ' 超过演示上限 2^40 个单元' };

    const base = {
      mode: 'addr', scheme, devs, portsPer, ports, addrBits, addrCount,
      memUnits, memBits, memPad, memText,
      drawMax: DRAW_MAX,
      dirBad: checkDirInvariants(),
    };

    if (scheme === 'sep') {
      const ioBits = intOf(vals.ioBits, 'I/O 地址线位数', 1, IO_BITS_MAX);
      const ioCount = Math.pow(2, ioBits);
      if (ports > ioCount) {
        throw {
          message: '端口数超出 I/O 空间：' + ioBits + ' 位 I/O 地址线只有 ' + ioCount +
            ' 个端口地址，现在要 ' + ports + ' 个 ⟹ 把 I/O 地址线加宽，或减少接口数 / 每个接口的端口数',
        };
      }
      return Object.assign(base, {
        ioBits, ioCount,
        span: ioCount,                     // 独立编址时画的是 I/O 空间这条轴
        axisName: 'I/O 端口地址空间',
        baseVal: 0, lastVal: ports - 1,
        baseText: hexOf(0, hexPad(ioCount)), lastText: hexOf(ports - 1, hexPad(ioCount)),
        usedPct: ports / ioCount,
        usableMem: memUnits,               // 独立编址：内存一点不被占用
        memLoss: 0,
        instr: '专门的 I/O 指令（IN / OUT）',
        memNote: '端口自成一个地址空间，内存空间一点不被占用',
      });
    }

    const baseVal = hexValOf(vals.base, '端口区基址', memUnits);
    const lastVal = baseVal + ports - 1;
    if (lastVal > memUnits - 1) {
      throw {
        message: '端口区越界：基址 ' + hexOf(baseVal, memPad) + ' 起连续 ' + ports +
          ' 个端口，末地址 ' + hexOf(lastVal, memPad) + ' 超出内存地址上限 ' + hexOf(memUnits - 1, memPad) +
          ' ⟹ 把基址改小或减少接口数',
      };
    }
    return Object.assign(base, {
      ioBits: 0, ioCount: 0,
      span: memUnits,                      // 统一编址时画的是内存这条轴
      axisName: '内存（统一）地址空间',
      baseVal, lastVal,
      baseText: hexOf(baseVal, memPad), lastText: hexOf(lastVal, memPad),
      usedPct: ports / memUnits,
      usableMem: memUnits - ports,
      memLoss: ports,
      instr: '普通访存指令（访存指令可以访问 I/O 端口）',
      memNote: '端口占用内存地址空间里连续 ' + ports + ' 个单元，这段地址不能再给内存用',
    });
  }

  function buildInside() {
    const funcs = [
      { name: '交接面（界面）', body: '把主机的系统总线一侧与设备一侧隔开，让双方各按自己的时序工作（2017-21 的原话就是"交接面"）' },
      { name: '数据缓冲与速度匹配', body: '用端口寄存器 / 缓冲区把高速主机与低速设备解耦，设备慢也不拖住 CPU 总线' },
      { name: '数据格式转换', body: '串行 ↔ 并行、位宽与编码的换算（键盘、串口这类设备侧是逐位来的）' },
      { name: '电平与信号转换', body: '设备侧的电平、驱动能力与主机总线不一致，要由接口完成转换' },
      { name: '传送控制命令与状态', body: '控制端口收下 CPU 的命令字，状态端口把设备的状态字供 CPU 读' },
      { name: '地址译码与中断请求', body: '按地址线选中本接口的某个端口；需要 CPU 处理时向 CPU 发中断请求' },
    ];
    const judge = [
      { name: '磁盘驱动器', isIface: false, key: 'A',
        why: '由磁头、磁盘和读写电路等组成，也就是磁盘本身（设备 / 存储介质一侧）；接口是它外面的"磁盘控制器"' },
      { name: '打印机适配器', isIface: true, key: 'B', why: '适配器（接口卡）把打印机接到主机上，属 I/O 接口 / I/O 控制器' },
      { name: '网络控制器', isIface: true, key: 'C', why: '网络控制器（网卡）是标准的 I/O 控制器 / 接口' },
      { name: '可编程中断控制器', isIface: true, key: 'D', why: '中断控制器管理外部中断请求，同样是 I/O 控制器' },
    ];
    const deviceCount = judge.filter(j => !j.isIface).length;
    return {
      mode: 'inside', funcs, judge, deviceCount,
      /* 接口内部的三个端口（与模式① 同一张表，方向不变量共用） */
      ports: PORT_TABLE,
      /* 不变量：2021-20 是单选题 ⟹ 四个候选里**恰好一个**是设备本体 */
      judgeBad: judge.length !== 4 || deviceCount !== 1 ? 1 : 0,
      notIfaceName: (judge.filter(j => !j.isIface)[0] || {}).name || '',
      dirBad: checkDirInvariants(),
    };
  }

  /* ---------------------------------------------------------------- 渲染件 */
  function card(title, body) {
    return '<div style="border:1px solid ' + C.cardBorder + ';border-radius:12px;background:#fff;padding:12px 14px;margin-top:12px">' +
      RC408.ui.sectionTitle(title) + body + '</div>';
  }

  function table(headers, rows, attr) {
    const th = headers.map(h =>
      '<th style="text-align:left;padding:5px 8px;background:' + C.thFill + ';border:1px solid ' + C.line +
      ';font-weight:800;color:#475569;font-size:11px;white-space:nowrap">' + h + '</th>').join('');
    const tr = rows.map(r => '<tr>' + r.map(c =>
      '<td style="padding:5px 8px;border:1px solid ' + C.line + ';vertical-align:top;font-size:12px;line-height:1.55">' +
      c + '</td>').join('') + '</tr>').join('');
    return '<table data-iop-table="' + attr + '" style="width:100%;border-collapse:collapse;table-layout:fixed">' +
      '<thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>';
  }

  function statRow(cards) {
    return '<div data-iop-cards="1" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:2px">' +
      cards.map(c => '<div style="flex:1 1 158px;min-width:158px">' + c + '</div>').join('') + '</div>';
  }

  function note(html, tone) {
    const map = {
      info: ['#eff6ff', '#bfdbfe', '#1e3a8a'],
      warn: ['#fffbeb', '#fde68a', '#92400e'],
      good: ['#ecfdf5', '#a7f3d0', '#065f46'],
    };
    const t = map[tone || 'info'];
    return '<div style="background:' + t[0] + ';border:1px solid ' + t[1] + ';color:' + t[2] +
      ';border-radius:10px;padding:8px 12px;font-size:12px;line-height:1.6;margin-top:10px">' + html + '</div>';
  }

  /* ------------------------------------------------------------- SVG 部件 */
  function svgMarkerDefs() {
    const cols = { data: C.data, ctrl: C.ctrl, addr: C.addr, stat: C.stat, off: C.off, dev: C.dev };
    const one = k => '<marker id="iop-a-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" ' +
      'orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="' + cols[k] + '"/></marker>';
    return '<defs>' + Object.keys(cols).map(one).join('') + '</defs>';
  }

  /** 一条带方向的线：箭头两端由 dirCode 决定（both 两端、toIface/toDev 末端、fromDev 首端） */
  function dirLine(x1, y1, x2, y2, dirCode, colorKey, w) {
    const hasStart = dirCode === 'both' || dirCode === 'fromDev';
    const hasEnd = dirCode === 'both' || dirCode === 'toIface' || dirCode === 'toDev';
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + C[colorKey] +
      '" stroke-width="' + w + '" stroke-linecap="round"' +
      (hasStart ? ' marker-start="url(#iop-a-' + colorKey + ')"' : '') +
      (hasEnd ? ' marker-end="url(#iop-a-' + colorKey + ')"' : '') + '/>';
  }

  function txt(x, y, s, opt) {
    const o = opt || {};
    return '<text x="' + x + '" y="' + y + '"' + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') +
      ' style="font:' + (o.weight || 400) + ' ' + (o.size || 10) + 'px ui-sans-serif,system-ui;fill:' +
      (o.fill || C.ink) + '">' + s + '</text>';
  }

  function svgBox(x, y, w, h, fill, stroke, rx, attr) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx == null ? 8 : rx) +
      '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"' + (attr || '') + '/>';
  }

  /* 模式①：CPU ↔ I/O 接口 ↔ 设备 的三条线 + 接口内部三个端口 */
  function svgBus(m) {
    const W = 780, H = 490;
    const pick = m.pick;
    const on = id => (pick === 'all' || pick === id);
    let s = '<svg data-iop-svg="bus" viewBox="0 0 ' + W + ' ' + H + '" width="100%" ' +
      'style="max-width:' + W + 'px;display:block;height:auto">' + svgMarkerDefs();

    s += txt(16, 26, 'I/O 接口 = CPU 与设备之间的交接面', { size: 12.5, weight: 800, fill: '#0f172a' });

    /* ⚠ 三条总线一律画在**接口内部所有方块的下面**（y = 380/400/420）。
       理由（窗44 目视抓到）：三条水平线与接口内部的三个端口盒如果齐平，
       读者会把它读成"数据线接数据端口、控制线接控制端口"的**一对一**关系——
       而实际上**三个端口都挂在数据线上**（地址线选端口、控制线发读写命令）。
       把总线整体下移到空白带，再写明这句话，才不会教错。 */
    const busY = { data: 380, ctrl: 400, addr: 420 };

    /* CPU */
    s += svgBox(16, 170, 100, 260, C.cpuFill, C.cpuStroke, 10, ' data-iop-node="cpu"');
    s += txt(66, 290, 'CPU', { size: 16, weight: 800, fill: '#3730a3', anchor: 'middle' });
    s += txt(66, 314, '通用寄存器', { size: 10, weight: 700, fill: '#4338ca', anchor: 'middle' });

    /* 接口 */
    s += svgBox(300, 56, 208, 384, C.ifFill, C.ifStroke, 10, ' data-iop-node="iface"');
    s += txt(404, 78, 'I/O 接口', { size: 13, weight: 800, fill: '#0f172a', anchor: 'middle' });
    s += txt(404, 94, '（I/O 端口组）', { size: 9.5, fill: C.faint, anchor: 'middle' });

    const regY = { pdata: 104, pstat: 148, pcmd: 192 };
    const regSub = { pdata: '双向 · 数据缓冲', pstat: 'CPU 只读 · 状态字', pcmd: 'CPU 只写 · 命令字' };
    m.ports.forEach(p => {
      const y = regY[p.id];
      const hit = (pick === 'data' && p.id === 'pdata');
      /* 盒 + 两行文字包成一组：几何断言与裁剪截图都以"组"为单位，
         别只截一个裸 rect（那样 textLen 与 children 都为 0，判据会误报"空图"） */
      s += '<g data-iop-portgroup="' + p.id + '">';
      s += svgBox(316, y, 176, 36, hit ? C.hitFill : '#ffffff', hit ? C.hitStroke : p.color, 8,
        ' data-iop-port="' + p.id + '" data-iop-on="' + (hit ? 1 : 0) + '"');
      s += txt(404, y + 16, p.name, { size: 11.5, weight: 800, fill: hit ? '#92400e' : p.color, anchor: 'middle' });
      s += txt(404, y + 29, regSub[p.id], { size: 9, fill: C.faint, anchor: 'middle' });
      s += '</g>';
    });
    s += txt(404, 248, '三个端口都经数据线读写：地址线选哪个端口、控制线给读写命令',
      { size: 9, fill: C.faint, anchor: 'middle' });
    s += svgBox(316, 264, 84, 34, '#ffffff', C.ifStroke, 8);
    s += txt(358, 286, '地址译码', { size: 10.5, weight: 700, anchor: 'middle' });
    s += svgBox(408, 264, 84, 34, '#ffffff', C.ifStroke, 8);
    s += txt(450, 286, '中断控制', { size: 10.5, weight: 700, anchor: 'middle' });
    s += svgBox(316, 308, 176, 34, '#ffffff', C.ifStroke, 8);
    s += txt(404, 330, '设备驱动 / 格式转换', { size: 10.5, weight: 700, anchor: 'middle' });
    s += txt(404, 364, '三条总线从这里接入接口', { size: 9, fill: C.faint, anchor: 'middle' });

    /* 设备 */
    s += svgBox(624, 170, 140, 260, C.devFill, C.dev, 10, ' data-iop-node="device"');
    s += txt(694, 290, '外设（设备）', { size: 12.5, weight: 800, fill: '#0f766e', anchor: 'middle' });
    s += txt(694, 314, '驱动器 + 介质', { size: 10, fill: '#0d9488', anchor: 'middle' });

    /* 主机侧三条线（CPU 右缘 116 → 接口左缘 300） */
    m.hostLines.forEach(l => {
      const hit = on(l.id);
      const key = hit ? l.id : 'off';
      s += dirLine(118, busY[l.id], 298, busY[l.id], l.dir, key, hit ? 4 : 1.6);
      s += txt(208, busY[l.id] - 7, l.name, { size: 9.5, weight: hit ? 800 : 400, fill: hit ? C[l.id] : C.faint, anchor: 'middle' });
    });
    /* 设备侧三条线（接口右缘 508 → 设备左缘 624）
       —— 只有**数据线**与主机侧同高（数据通路本来就贯通），控制 / 状态线各错开 4px，
          免得被读成"主机侧控制线一直连到设备侧状态线"（窗44 目视复核过）。 */
    const devY = { ddata: busY.data, dctrl: busY.addr - 16, dstat: busY.addr + 8 };
    m.devLines.forEach(l => {
      const hit = (pick === 'all') || (pick === 'data' && l.id === 'ddata');
      const key = hit ? (l.id === 'ddata' ? 'data' : l.id === 'dctrl' ? 'ctrl' : 'stat') : 'off';
      const y = devY[l.id];
      s += dirLine(510, y, 622, y, l.dir, key, hit ? 3.2 : 1.6);
      s += txt(566, y - 7, l.name, { size: 9, weight: hit ? 800 : 400, fill: hit ? C[key === 'off' ? 'faint' : key] : C.faint, anchor: 'middle' });
    });

    s += txt(390, 456, '主机侧 = I/O 总线（数据线 / 控制线 / 地址线）　设备侧 = 数据线 / 状态线 / 控制线',
      { size: 10, fill: C.faint, anchor: 'middle' });
    s += txt(390, 472, '箭头方向由每条线的方向枚举推导（数据双向、控制与地址单向）',
      { size: 9, fill: C.faint, anchor: 'middle' });
    return s + '</svg>';
  }

  /* 模式②：地址空间轴（独立编址两条轴 / 统一编址一条轴） */
  function svgAddr(m) {
    const W = 780;
    const x0 = 46, x1 = 742, aw = x1 - x0, bh = 30;
    const sep = m.scheme === 'sep';
    const H = sep ? 300 : 240;
    let s = '<svg data-iop-svg="addr" viewBox="0 0 ' + W + ' ' + H + '" width="100%" ' +
      'style="max-width:' + W + 'px;display:block;height:auto">';

    const axis = (y, label, stroke) =>
      svgBox(x0, y - bh / 2, aw, bh, '#f8fafc', stroke, 6, ' data-iop-axis="' + label + '"') +
      txt(x0, y - bh / 2 - 8, label, { size: 11, weight: 800, fill: stroke });

    /** 在轴上画"端口区"：按比例定位，太窄时抬到 10px 便于观看（并如实写明） */
    function slice(y, from, span, color) {
      const left = x0 + aw * (from / span);
      let w = aw * (m.ports / span);
      let clamped = false;
      if (w < 10) { w = 10; clamped = true; }
      if (left + w > x1) w = x1 - left;
      return {
        svg: svgBox(left, y - bh / 2, w, bh, color, C.hitStroke, 5, ' data-iop-slice="1" data-iop-clamped="' + (clamped ? 1 : 0) + '"'),
        clamped,
      };
    }

    if (sep) {
      s += axis(80, '内存地址空间　0 ~ ' + hexOf(m.memUnits - 1, m.memPad) + '（' + m.memText + '）', '#64748b');
      s += txt(x1, 80 + bh / 2 + 18, '独立编址：端口一点内存都不占', { size: 10, fill: '#64748b', anchor: 'end' });

      s += axis(200, 'I/O 端口地址空间　0 ~ ' + hexOf(m.ioCount - 1, hexPad(m.ioCount)) + '（' + m.ioBits + ' 位地址线 = ' + m.ioCount + ' 个端口）', C.addr);
      const sl = slice(200, 0, m.span, C.hitFill);
      s += sl.svg;
      s += txt(x0, 200 + bh / 2 + 18, '端口区 ' + m.baseText + ' ~ ' + m.lastText + '（' + m.ports + ' 个端口，占 ' +
        fmtPct(m.usedPct) + '）' + (sl.clamped ? '　※ 按比例不足 10px，已按最小可见宽度绘制' : ''),
        { size: 10, fill: '#92400e' });
    } else {
      s += axis(96, '内存（统一）地址空间　0 ~ ' + hexOf(m.memUnits - 1, m.memPad) + '（' + m.memText + '）', '#64748b');
      const sl = slice(96, m.baseVal, m.span, C.hitFill);
      s += sl.svg;
      s += txt(x0, 96 + bh / 2 + 22, '端口区 ' + m.baseText + ' ~ ' + m.lastText + '（' + m.ports +
        ' 个端口 = ' + m.ports + ' 个地址单元，占 ' + fmtPct(m.usedPct) + '）' +
        (sl.clamped ? '　※ 按比例不足 10px，已按最小可见宽度绘制' : ''), { size: 10, fill: '#92400e' });
      s += txt(x0, 96 + bh / 2 + 40, '这段地址就不能再给内存用了；访问它用的是普通访存指令', { size: 10, fill: '#64748b' });
    }
    return s + '</svg>';
  }

  /* 模式③：接口内部的组成（六项功能 + 三个端口 + 控制/译码 → 设备） */
  function svgInside(m) {
    const W = 780, H = 250;
    let s = '<svg data-iop-svg="inside" viewBox="0 0 ' + W + ' ' + H + '" width="100%" ' +
      'style="max-width:' + W + 'px;display:block;height:auto">' + svgMarkerDefs();
    s += txt(16, 24, '接口内部：三个端口 + 控制逻辑（主机侧接总线、设备侧接设备）', { size: 12, weight: 800, fill: '#0f172a' });
    s += svgBox(300, 44, 208, 176, C.ifFill, C.ifStroke, 10, ' data-iop-node="iface"');
    s += txt(404, 64, 'I/O 接口', { size: 12, weight: 800, anchor: 'middle' });
    const ys = { pdata: 74, pstat: 116, pcmd: 158 };
    m.ports.forEach(p => {
      s += svgBox(316, ys[p.id], 176, 34, '#ffffff', p.color, 8, ' data-iop-port="' + p.id + '"');
      s += txt(404, ys[p.id] + 15, p.name, { size: 11, weight: 800, fill: p.color, anchor: 'middle' });
      s += txt(404, ys[p.id] + 27, PORT_DIR_TEXT[p.dir], { size: 9, fill: C.faint, anchor: 'middle' });
    });
    s += svgBox(316, 196, 176, 20, '#ffffff', C.ifStroke, 6);
    s += txt(404, 210, '地址译码 · 中断控制 · 设备驱动', { size: 9, weight: 700, anchor: 'middle' });
    s += dirLine(120, 130, 296, 130, 'both', 'data', 3);
    s += txt(208, 122, '主机侧：系统总线 / I/O 总线', { size: 9.5, fill: C.data, anchor: 'middle' });
    s += dirLine(510, 130, 660, 130, 'both', 'dev', 3);
    s += txt(585, 122, '设备侧信号', { size: 9.5, fill: C.dev, anchor: 'middle' });
    s += svgBox(660, 96, 104, 68, C.devFill, C.dev, 10, ' data-iop-node="device"');
    s += txt(712, 126, '外设', { size: 12, weight: 800, fill: '#0f766e', anchor: 'middle' });
    s += txt(712, 144, '（驱动器 + 介质）', { size: 9, fill: '#0d9488', anchor: 'middle' });
    return s + '</svg>';
  }

  /* ---------------------------------------------------------------- 模块 */
  RC408.registerModule({
    id: 'coa-io-port',
    mode: 'instant',
    title: 'I/O 接口与端口',

    theory: `
> **为什么要有它**：CPU 和外设的工作方式、速度、数据格式都不一样，硬接在一起谁也干不好 —— **I/O 接口（也就是 I/O 端口）就是 CPU 与设备之间的"交接面"**：主机侧接 I/O 总线，设备侧接外设，中间替双方做缓冲、转换、译码和中断。
> **怎么实现**：主机侧能用的只有三条线 —— **数据线（双向）、控制线（单向 CPU 到接口）、地址线（单向 CPU 到接口）**；接口把这三条线落到**三个寄存器（端口）**上：数据端口双向、状态端口只读、控制端口只写。CPU 用**地址线选中**端口、用**数据线搬运**内容、用**控制线**发命令收应答；端口编址再决定这些端口地址落在哪儿 —— 独立编址自成一个空间，统一编址则切走内存地址空间的一小段。
> **记住什么**：三条线的方向（**数据双向、控制与地址单向**）；**命令字 / 状态字 / 中断类型号都靠数据线**（2012-21）；**I/O 指令的数据传送发生在通用寄存器与 I/O 端口之间**（2017-21）；**驱动器是设备本体、不是接口**（2021-20）。

## 接口 = CPU 与设备之间的交接面（模式①）

- 主机侧接的是 **I/O 总线**，只有三条线：
  - **数据线**：双向。传数据，**也传命令字 / 状态字 / 中断类型号** —— 2012-21 的 I、II、III 三项全在这条线上；
  - **控制线**：**单向 CPU 到接口**。传读 / 写命令、中断响应、总线请求与响应、时序；
  - **地址线**：**单向 CPU 到接口**。传端口地址，决定选中接口里的哪一个端口（2017-21："CPU 使用地址总线选择所请求的 I/O 端口"）；
- 设备侧是另一组线：**数据线（双向）+ 控制线（接口到设备）+ 状态线（设备到接口）** —— 两侧的线不是同一条，接口就是它们之间的转换站；
- 接口内部把主机侧的线落到**三个端口**上：**数据端口**双向（缓冲）、**状态端口** CPU 只读（状态字）、**控制端口** CPU 只写（命令字）；
- 2017-21 的结论：**I/O 指令实现的数据传送通常发生在通用寄存器与 I/O 端口之间**（CPU 先把命令写到控制端口、再从数据端口搬数据、从状态端口读状态）。

## 端口编址：独立编址 与 统一编址（模式②）

- **端口数** = 接口数 × 每个接口的端口数（每个接口至少 3 个：数据 / 状态 / 控制）；寻址 N 个端口至少要 \\(\\lceil\\log_2 N\\rceil\\) 位地址；
- **独立编址（I/O 映射）**：内存与 I/O **各有一个地址空间**，端口地址不占内存；访问要**专门的 I/O 指令**（IN / OUT）；I/O 地址线可以单独设（少而简单）；
- **统一编址（存储器映射）**：端口与内存单元**共用一个地址空间**，端口占用连续的一段地址；访问用**普通访存指令**（教材口径：统一编址下 CPU 访存与访问 I/O 端口用的是**同一条指令**，所以访存指令也能访问端口）；不需要专门的 I/O 指令、编程灵活，但**切走一段内存地址**、而且译码要译全部地址位。

## 接口里有什么 · 谁不是接口（模式③）

- 接口替主机干六件事：**交接面 / 数据缓冲与速度匹配 / 数据格式转换 / 电平与信号转换 / 传送控制命令与状态 / 地址译码与中断请求**；
- **适配器、控制器都是接口**（打印机适配器、网络控制器、可编程中断控制器、DMA 控制器……）；
- **驱动器不是接口，是设备本体**：磁盘驱动器由磁头、磁盘和读写电路组成，就是磁盘本身；它外面的"磁盘控制器"才是接口（2021-20 的答案）。

## 考点提醒（易错点）

1. **方向别记反**：数据线双向，控制线与地址线**只从 CPU 指向接口**；设备侧才另有一条"设备到接口"的状态线；
2. **2012-21 考的是"走哪条线"，不是"往哪个方向"**：它的解析把命令字 / 状态字 / 中断类型号一并说成"由 I/O 接口发往 CPU"，结论是这三者都只能经**数据线**传输；而端口的分工仍然是"控制端口 CPU 只写、状态端口 CPU 只读、数据端口双向"，两句话不矛盾 —— 别把"命令字由 CPU 写进控制端口"当成与真题冲突；
3. **状态端口只读、控制端口只写**：CPU 读控制端口、写状态端口都是错的（端口方向是硬件定的，不是"想读就能读"）；
4. **驱动器 ≠ 控制器**：问"不属于 I/O 接口的是"时要选设备本体的那一个（磁盘驱动器），适配器 / 控制器都是接口；
5. **独立编址省的是内存空间、费的是指令**：端口不占内存，但只能用 IN / OUT 这类专门指令访问；统一编址反过来 —— 省掉专门指令、却占了内存地址；
6. 别与相邻考点混淆：**I/O 方式与 CPU 时间占比（程序查询 / 中断 / DMA）**属 coa-io 模块，本条目只管"接口与端口的组成、方向、编址"。

> **真题考情**：**3/18 年（全为选择题，无大题）**——
> 选 2012-21（I/O 总线数据线上传的是命令字 / 状态字 / 中断类型号）、2017-21（I/O 指令的数据传送发生在通用寄存器与 I/O 端口之间）、2021-20（不属于 I/O 接口的是磁盘驱动器 —— 它是设备本体）。
`,

    /* ---------------- 输入表单（每个 input 都必须显式给 default，见 §3.1-6 / §3.8-11） ---------------- */
    inputs: [
      {
        key: 'mode', label: '要算什么', type: 'select', default: 'bus', wide: true,
        options: [
          { v: 'bus', t: '① 接口与三条线：数据线 / 控制线 / 地址线的方向与内容（2012-21 · 2017-21）' },
          { v: 'addr', t: '② 端口编址：独立编址 与 统一编址（地址空间 / 指令 / 地址线）' },
          { v: 'inside', t: '③ 接口里有什么 · 谁不是接口（2021-20）' },
        ],
      },
      {
        key: 'pick', label: '高亮哪条线【模式①】', type: 'select', default: 'all', wide: true,
        options: [
          { v: 'all', t: '全部（三条线都点亮）' },
          { v: 'data', t: '数据线（命令字 / 状态字 / 中断类型号走这里）' },
          { v: 'ctrl', t: '控制线（单向 CPU → 接口）' },
          { v: 'addr', t: '地址线（单向 CPU → 接口）' },
        ],
      },
      {
        key: 'scheme', label: '编址方式【模式②】', type: 'select', default: 'sep', wide: true,
        options: [
          { v: 'sep', t: '独立编址（I/O 映射：端口自成一个地址空间，用 IN / OUT）' },
          { v: 'unified', t: '统一编址（存储器映射：端口占用内存地址空间，用访存指令）' },
        ],
      },
      { key: 'devs', label: '接口（设备）数【模式②】', default: '8', help: '每个接口都要占端口地址；8 个接口 × 3 个端口 = 24 个端口地址' },
      { key: 'portsPer', label: '每个接口的端口数【模式②】', default: '3', help: '数据端口 / 状态端口 / 控制端口 = 3（教材默认口径）' },
      { key: 'ioBits', label: 'I/O 地址线位数【模式② · 独立编址】', default: '8', help: '8 位 = 256 个端口地址；端口数不能超过它' },
      { key: 'memMB', label: '内存容量（MB）【模式②】', default: '64', help: '统一编址时用来算端口落在内存地址空间的哪一段' },
      { key: 'base', label: '端口区基址（十六进制）【模式② · 统一编址】', default: 'F00000', wide: true, help: '端口从它开始连续占 N 个地址；可写 F00000 / 0xF00000 / F00000H' },
    ],

    /* ---------------- 预设（冒烟用假 rt 逐个跑通并核对标签承诺，§3.5-15） ---------------- */
    quickActions: [
      {
        label: '🎯 2012-21：I/O 总线数据线上传什么 → 命令字 / 状态字 / 中断类型号（三项全在数据线上）',
        run(rt) { rt.setInput('mode', 'bus'); rt.setInput('pick', 'data'); rt.load(); },
      },
      {
        label: '🎯 2017-21：I/O 指令的数据传送发生在通用寄存器与 I/O 端口之间（CPU 用地址线选端口）',
        run(rt) { rt.setInput('mode', 'bus'); rt.setInput('pick', 'addr'); rt.load(); },
      },
      {
        label: '🎯 2021-20：不属于 I/O 接口的是磁盘驱动器（它是设备本体，另三项都是 I/O 控制器）',
        run(rt) { rt.setInput('mode', 'inside'); rt.load(); },
      },
      {
        label: '📗 独立编址：8 个接口 × 3 个端口 = 24 个端口 → 只要 5 位端口地址，内存一点不占',
        run(rt) { rt.setInput('mode', 'addr'); rt.setInput('scheme', 'sep'); rt.setInput('devs', '8'); rt.setInput('portsPer', '3'); rt.setInput('ioBits', '8'); rt.load(); },
      },
      {
        label: '📗 统一编址：同样 24 个端口落进 64 MB 内存地址空间（F00000 起连续 24 个单元）',
        run(rt) { rt.setInput('mode', 'addr'); rt.setInput('scheme', 'unified'); rt.setInput('devs', '8'); rt.setInput('portsPer', '3'); rt.setInput('memMB', '64'); rt.setInput('base', 'F00000'); rt.load(); },
      },
      {
        label: '📘 接口的功能清单：交接面 / 缓冲 / 格式转换 / 电平转换 / 命令与状态 / 译码与中断',
        run(rt) { rt.setInput('mode', 'inside'); rt.load(); },
      },
    ],

    parse(vals) {
      const mode = String(vals.mode || 'bus');
      if (mode === 'addr') return buildAddr(vals);
      if (mode === 'inside') return buildInside();
      if (mode === 'bus') return buildBus(vals);
      throw { message: '要算什么只支持 bus / addr / inside（现在填的是「' + mode + '」）' };
    },

    /* ======================== 渲染（纯渲染，只读 model） ======================== */
    render(ctx) {
      const m = ctx.model, stage = ctx.stage;

      /* ---------------- 模式① 接口与三条线 ---------------- */
      if (m.mode === 'bus') {
        const hot = m.pick;
        const cards = statRow([
          RC408.ui.statCard('主机侧总线', '3 条', '数据线 / 控制线 / 地址线', 'text-indigo-600'),
          RC408.ui.statCard('接口内部端口', m.portCount + ' 个', '数据 / 状态 / 控制', 'text-sky-600'),
          RC408.ui.statCard('数据线方向', '双向', 'CPU 与接口之间来回', 'text-blue-600'),
          RC408.ui.statCard('控制线 / 地址线', '单向', '只能 CPU 到接口', 'text-amber-600'),
        ]);

        const lineRows = m.hostLines.map(l =>
          ['主机侧 · ' + l.name, DIR_TEXT[l.dir], l.carries, l.anchor]);
        const devRows = m.devLines.map(l =>
          ['设备侧 · ' + l.name, DIR_TEXT[l.dir], l.carries, '与主机侧不是同一条线']);
        const portRows = m.ports.map(p =>
          [p.name, PORT_DIR_TEXT[p.dir], p.who, p.body]);

        stage.innerHTML =
          '<div data-iop-mode="bus" style="display:block">' +
          cards +
          '<div style="border:1px solid ' + C.cardBorder + ';border-radius:12px;background:#fff;padding:10px 12px;margin-top:12px">' +
          svgBus(m) + '</div>' +
          card('主机侧的 I/O 总线（三条线各传什么）',
            table(['线', '方向', '传什么', '真题锚点 / 判据'], lineRows, 'lines')) +
          card('设备侧的三条线（接口与设备之间）',
            table(['线', '方向', '传什么', '备注'], devRows, 'devlines')) +
          card('接口内部的三个端口（方向是硬约束）',
            table(['端口', '方向', '谁写谁读', '内容'], portRows, 'ports')) +
          note('<b>2017-21 的结论</b>：I/O 指令实现的数据传送通常发生在 <b>通用寄存器与 I/O 端口之间</b> —— ' +
            'CPU 用地址线选中端口、用数据线搬内容。' +
            (hot === 'data'
              ? '<br><b>当前高亮：数据线</b> —— 2012-21 的三项（命令字 / 状态字 / 中断类型号）都在这一条线上。'
              : hot === 'ctrl'
                ? '<br><b>当前高亮：控制线</b> —— 单向，只从 CPU 指向接口。'
                : hot === 'addr'
                  ? '<br><b>当前高亮：地址线</b> —— 单向，只从 CPU 指向接口，用来选中端口。'
                  : '<br>当前高亮：全部三条线。用左边的"高亮哪条线"可单独点亮一条，看清它的方向与内容。'), 'info') +
          '</div>';
        return;
      }

      /* ---------------- 模式② 端口编址 ---------------- */
      if (m.mode === 'addr') {
        const sep = m.scheme === 'sep';
        const cards = statRow([
          RC408.ui.statCard('端口总数', String(m.ports) + ' 个', m.devs + ' 个接口 × ' + m.portsPer + ' 个端口', 'text-indigo-600'),
          RC408.ui.statCard('寻址要几位', m.addrBits + ' 位', '⌈log₂' + m.ports + '⌉ ⟹ 可编 ' + m.addrCount + ' 个端口号', 'text-sky-600'),
          sep
            ? RC408.ui.statCard('I/O 地址空间', m.ioCount + ' 个端口', m.ioBits + ' 位 I/O 地址线（用了 ' + fmtPct(m.usedPct) + '）', 'text-emerald-600')
            : RC408.ui.statCard('内存地址位数', m.memBits + ' 位', m.memText + ' 的统一地址空间', 'text-emerald-600'),
          sep
            ? RC408.ui.statCard('可用内存', m.memText, '端口不占内存空间', 'text-amber-600')
            : RC408.ui.statCard('端口区地址', m.baseText + ' ~ ' + m.lastText, '占用内存地址空间 ' + m.ports + ' 个单元', 'text-amber-600'),
        ]);

        const cmp = [
          ['地址空间', '内存与 I/O <b>各有一个</b>地址空间', '只有<b>一个</b>空间，端口占用内存地址'],
          ['访问指令', '专门的 I/O 指令（IN / OUT）', '普通访存指令即可访问端口'],
          ['地址线', '另设 I/O 地址线（本算例 ' + (sep ? m.ioBits + ' 位' : '8 位') + '）', '用主存地址线（本算例 ' + m.memBits + ' 位）'],
          ['地址译码', '只译 I/O 地址，简单', '要译全部地址位，较复杂'],
          ['是否占内存', '不占（可用内存 ' + m.memText + '）', '占 ' + m.ports + ' 个单元（这段地址不能再给内存）'],
          ['灵活性', '指令少、编程不便', '可用全部访存指令，编程灵活'],
        ].map(r => [
          r[0],
          sep ? '<b style="color:#059669">' + r[1] + '</b>' : r[1],
          sep ? r[2] : '<b style="color:#059669">' + r[2] + '</b>',
        ]);

        stage.innerHTML =
          '<div data-iop-mode="addr" style="display:block">' +
          cards +
          '<div style="border:1px solid ' + C.cardBorder + ';border-radius:12px;background:#fff;padding:10px 12px;margin-top:12px">' +
          svgAddr(m) +
          '<div style="font-size:11px;color:' + C.faint + ';margin-top:4px">' +
          (sep ? '两条轴互不相干：内存轴一点没被占；I/O 轴上的黄色段就是这 ' + m.ports + ' 个端口。'
            : '只有一条轴：黄色段是端口区，它切走的那 ' + m.ports + ' 个地址不再属于内存。') +
          '</div></div>' +
          card('独立编址 与 统一编址 逐项对照（高亮的一列是当前编址方式）',
            table(['项目', '独立编址（I/O 映射）', '统一编址（存储器映射）'], cmp, 'addr')) +
          card('本算例的推导',
            '<div style="font-size:12px;line-height:1.9">' +
            '① 端口总数 = ' + m.devs + ' 个接口 × ' + m.portsPer + ' 个端口 = <b>' + m.ports + ' 个</b>；<br>' +
            '② 寻址要 ⌈log₂' + m.ports + '⌉ = <b>' + m.addrBits + ' 位</b>（' + m.addrBits + ' 位能编 ' + m.addrCount + ' 个端口号，够用）；<br>' +
            (sep
              ? '③ 独立编址：I/O 空间由 ' + m.ioBits + ' 位地址线给出 ' + m.ioCount + ' 个端口，本算例用了 ' + m.ports +
                ' 个（' + fmtPct(m.usedPct) + '），端口地址 ' + m.baseText + ' ~ ' + m.lastText + '；<br>' +
                '④ 访问方式：' + m.instr + '；' + m.memNote + '。'
              : '③ 统一编址：端口地址 ' + m.baseText + ' ~ ' + m.lastText + '（' + m.ports + ' 个单元）落在 ' +
                m.memText + ' 的内存地址空间里，地址位数是 ' + m.memBits + ' 位；<br>' +
                '④ 访问方式：' + m.instr + '；' + m.memNote + '（可用内存 ' + fmtBytes(m.usableMem) + '）。') +
            '</div>',
            'derive') +
          note(sep
            ? '<b>独立编址的取舍</b>：省下内存地址空间、地址线少、译码简单，代价是只能用 IN / OUT 这类专门指令，指令种类少、编程不灵活。'
            : '<b>统一编址的取舍</b>：不需要专门 I/O 指令、可用全部访存指令（灵活），代价是切走一段内存地址，而且译码要看全部地址位。', 'warn') +
          '</div>';
        return;
      }

      /* ---------------- 模式③ 接口里有什么 · 谁不是接口 ---------------- */
      const funcRows = m.funcs.map((f, i) => ['功能 ' + (i + 1), f.name, f.body]);
      const judgeRows = m.judge.map(j => [
        j.key + ' · ' + j.name,
        j.isIface
          ? '<b style="color:#059669">是 I/O 接口</b>'
          : '<b style="color:#dc2626">不是 I/O 接口（它是设备本体）</b>',
        j.why,
      ]);

      stage.innerHTML =
        '<div data-iop-mode="inside" style="display:block">' +
        statRow([
          RC408.ui.statCard('接口的功能', m.funcs.length + ' 项', '交接面 / 缓冲 / 转换 / 命令状态 / 译码中断', 'text-indigo-600'),
          RC408.ui.statCard('接口内的端口', '3 个', '数据（双向）/ 状态（只读）/ 控制（只写）', 'text-sky-600'),
          RC408.ui.statCard('2021-20 的答案', 'A · 磁盘驱动器', '它是设备本体，不是接口', 'text-rose-600'),
          RC408.ui.statCard('接口的别称', '适配器 / 控制器', '打印机适配器、网络控制器、中断控制器', 'text-amber-600'),
        ]) +
        '<div style="border:1px solid ' + C.cardBorder + ';border-radius:12px;background:#fff;padding:10px 12px;margin-top:12px">' +
        svgInside(m) + '</div>' +
        card('接口替主机干的六件事',
          table(['#', '功能', '做什么'], funcRows, 'funcs')) +
        card('2021-20：四个候选里谁不是 I/O 接口',
          table(['候选', '判定', '依据'], judgeRows, 'judge')) +
        note('<b>判据一句话</b>：<b>驱动器是设备本体</b>（磁盘驱动器由磁头、磁盘和读写电路组成，就是磁盘本身），' +
          '它外面的<b>控制器 / 适配器才是接口</b>。2021-20 的四项里，磁盘驱动器是唯一不属于 I/O 接口的。', 'good') +
        '</div>';
    },

    /* 即时模块的日志（走 esc()，所以这里不许写 Markdown 的星号，见 §3.8-6） */
    logs(m) {
      if (m.mode === 'bus') {
        return [
          { text: '主机侧 I/O 总线：数据线（双向）+ 控制线（单向 CPU 到接口）+ 地址线（单向 CPU 到接口）' },
          { text: '数据线上传：' + m.dataCarries },
          { text: '接口内三个端口方向：数据端口双向 / 状态端口 CPU 只读 / 控制端口 CPU 只写' },
          { text: '2017-21：I/O 指令的数据传送发生在通用寄存器与 I/O 端口之间' },
        ];
      }
      if (m.mode === 'addr') {
        return [
          { text: '端口总数 = ' + m.devs + ' × ' + m.portsPer + ' = ' + m.ports + ' 个，寻址要 ' + m.addrBits + ' 位地址' },
          { text: '编址方式：' + (m.scheme === 'sep' ? '独立编址（I/O 映射）' : '统一编址（存储器映射）') },
          { text: '端口地址：' + m.baseText + ' ~ ' + m.lastText + '（' + m.ports + ' 个）' },
          { text: '访问方式：' + m.instr },
          { text: '可用内存：' + fmtBytes(m.usableMem) + (m.memLoss ? '（被端口占走 ' + m.memLoss + ' 个单元）' : '（端口一点不占）') },
        ];
      }
      return [
        { text: '接口的六项功能：交接面 / 缓冲匹配 / 格式转换 / 电平转换 / 命令与状态 / 译码与中断' },
        { text: '接口内的三个端口：数据端口双向、状态端口 CPU 只读、控制端口 CPU 只写' },
        { text: '2021-20 的答案：磁盘驱动器不属于 I/O 接口 —— 它是设备本体' },
        { text: '适配器与控制器（打印机适配器 / 网络控制器 / 中断控制器）都是 I/O 接口' },
      ];
    },
  });
})();
