'use strict';
/* ============================================================================
 * coa-bus-signal.js —— 【计算机组成原理】总线信号线分类与传输内容（前缀 _bs）
 * 模式：stepper（一个总线周期一拍 = 一帧；首帧 init、末帧 done）
 *
 * 考情（**窗47 从零核定**：`tools/exam_index.py --ask` 扫 考情缓存/ + 主线程逐条回原文复核）：
 *   · 18 年中 **1 年**考过本考点（**选择题**，无大题）：
 *     2011-20（"在系统总线的数据线上，**不可能**传输的是" —— 答案 C 握手（应答）信号，
 *     它是通信联络控制信号、走**控制总线**；指令 / 操作数 / **中断类型号** 都走**数据总线**。
 *     题干 `考情缓存/2011_真题.txt:166-173`、权威解析 `2011_解析.txt:210-214`）。
 *   · 该题此前**全站零登记**（窗47 用 `tmp_t47_probe.js` 逐题位扫过 `RC408.examHistory` 确认），
 *     本条目一建就直接收下，**不改挂任何已有条目**。
 *   · **不登记（看着像总线、按 §2.0② 归更"专"的模块）**：2012-21（I/O 接口三线 + 命令字/状态字/中断类型号
 *     走数据线 → `coa-io-port`，那一条的判据原文正是"数据线上传什么"）、2017-21（问数据在哪儿传送，
 *     解析提地址/数据总线只是解释 → `coa-io-port`）、2012-19 / 2014-19 / 2018-21 / 2020-19 / 2024-20 / 2025-20
 *     （地址/数据线复用与**总线带宽** → `coa-bus`）、2021-15 / 2021-43 / 2026-15（地址线/数据线**位数**
 *     → 容量与交叉编址 → `coa-mainmem` / `coa-mainmem-pins`）。
 *   · **无法核对（不猜，留白）**：2023 整年真题与解析均无文本层（`考情缓存/扫描件清单.md:30-48`）；
 *     2019 / 2021 解析无文本层、2025 真题无文本层 ⟹ 这些年的本考点不可判，**不声称"未考"**。
 *
 * 数据模型（口径写死在代码里，避免后来者改错）：
 *   · 三条总线：**地址总线 AB**（单向：CPU → 主存 / I/O）、**数据总线 DB**（**双向**）、
 *     **控制总线 CB**（**每根线单向、整体双向**：命令类 CPU→部件，请求/应答类部件→CPU）。
 *   · 地址线与数据线都是 **16 位**，一律用 4 位十六进制书写；中断类型号是 **8 位**（2 位十六进制）。
 *   · 一个**读总线周期**固定 4 拍：**T1 送地址 → T2 发读命令 → T3 数据上数据线 → T4 撤除**；
 *     **写总线周期**也是 4 拍，但顺序是 **T1 送地址 → T2 送数据 → T3 发写命令 → T4 撤除**
 *     （"先数据后命令"是与读周期最大的差别）；**中断响应周期**只有 2 拍（INTA → 类型号）。
 *   · **等待周期 TW**：被访问的部件来不及响应时，由它拉低 **READY** 线，CPU 在 T3 与 T4 之间**插入 TW** 拍。
 *   · 中断响应周期**不送地址**（它不是"按地址存取"，而是"取中断源的身份"）——这是最容易记错的一处。
 *
 * 不变量（冒烟断言的对象，§3.8-1 "只写不变量"）：
 *   ① 首帧 init / 末帧 done；其余每帧恰好一拍；帧数 = 周期拍数 + 插入的 TW 数；
 *   ② **数据总线在同一拍至多一个驱动者**（CPU / 主存 / 中断控制器三选一，或"无人驱动"）——总线冲突的判据；
 *   ③ **握手（应答）信号只出现在控制总线上**，任何一拍都不许出现在数据线上（2011-20 的答案）；
 *   ④ **中断类型号只出现在数据总线上**，且中断响应周期**地址线不送地址**；
 *   ⑤ 读周期"命令先于数据"、写周期"数据先于命令"；
 *   ⑥ 每帧三条线的内容都是**新对象**（改第 k 帧不许污染第 k+1 帧，§1.3）；
 *   ⑦ 末帧结果必须等于**独立参考实现**（按周期类型重放一遍"谁把什么送上哪条线"）的结果。
 * ========================================================================== */

/* 三条总线（静态口径；渲染与冒烟共用） */
const BS_LINES = [
  { id: 'ab', name: '地址总线 AB', dir: 'one', dirText: '单向：CPU → 主存 / I/O', color: '#059669' },
  { id: 'db', name: '数据总线 DB', dir: 'both', dirText: '双向：CPU ⇄ 主存 / I/O', color: '#2563eb' },
  { id: 'cb', name: '控制总线 CB', dir: 'each', dirText: '每根单向、整体双向：命令 CPU→部件；请求/应答 部件→CPU', color: '#b45309' },
];
/* 控制线清单（2011-20 的判据就落在"握手/应答类只可能在 CB 上"） */
const BS_CTRL = [
  { n: 'MEMR', t: '读命令', kind: 'cmd', d: 'CPU → 主存：我要读' },
  { n: 'MEMW', t: '写命令', kind: 'cmd', d: 'CPU → 主存：我要写' },
  { n: 'IOR / IOW', t: 'I/O 读 / 写命令', kind: 'cmd', d: 'CPU → I/O 接口' },
  { n: 'MREQ', t: '访存请求', kind: 'cmd', d: 'CPU → 主存：本次访问是访存' },
  { n: 'INTR', t: '中断请求', kind: 'req', d: '部件 → CPU：我申请中断' },
  { n: 'INTA', t: '中断响应（应答）', kind: 'ack', d: 'CPU → 部件：我响应了，把类型号给我' },
  { n: 'HRQ / HLDA', t: '总线请求 / 总线允许', kind: 'req', d: 'DMA 控制器 ⇄ CPU：我要用总线 / 准你用' },
  { n: 'READY', t: '就绪（等待）', kind: 'ack', d: '慢速部件 → CPU：我还没好，插个等待周期' },
  { n: 'CLK', t: '时钟', kind: 'clk', d: 'CPU → 全系统：节拍基准' },
  { n: 'RST', t: '复位', kind: 'cmd', d: 'CPU → 全系统' },
];

RC408.registerModule({
  id: 'coa-bus-signal',
  mode: 'stepper',
  title: '总线信号线分类与传输内容',

  theory: `
> **为什么要有它**：真题问总线，问得最刁的一句是"**某一根线上不可能传什么**"。要答对，必须把三条线的分工背成条件反射——**地址线只传地址（单向）**、**数据线传数据（双向，指令 / 操作数 / 中断类型号都算"数据"）**、**控制线传命令与请求/应答（握手信号在这里，不在数据线）**。
> **怎么实现**：把**取指 / 取数 / 存数 / 中断响应**四种总线周期逐拍摆开，每一拍点名"**地址线传什么、数据线传什么、控制线有哪几根有效**"，并标出这一拍**谁在驱动总线**。
> **记住什么**：**读周期"先命令后数据"、写周期"先数据后命令"** + **中断响应周期不送地址、类型号走数据线** + **握手（应答）信号只走控制线** + **一拍只能有一个部件驱动数据总线**。

## 三条总线各传什么（2011-20 的判据就在这里）

| 总线 | 方向 | 传什么 | 典型内容 |
| --- | --- | --- | --- |
| **地址总线 AB** | **单向**（CPU → 主存 / I/O） | **地址**（存储单元号 / I/O 端口号） | PC 给出的指令地址、有效地址、DMA 送出的内存地址 |
| **数据总线 DB** | **双向** | **数据**（广义） | **指令字**、操作数、**中断类型号**、状态字、命令字 |
| **控制总线 CB** | 每根**单向**、整体**双向** | **命令**与**请求 / 应答（握手）** | MEMR / MEMW、MREQ、INTR、**INTA**、HRQ / HLDA、READY、CLK、RST |

**★ 一句话判据**：凡是"**地址**"就只可能在 AB；凡是"**数据**"（含指令、操作数、中断类型号、状态字、命令字）就只可能在 DB；
凡是"**指挥 / 联络**"的话（读命令、写命令、请求、**应答（握手）**、就绪）就只可能在 CB。

## 读总线周期：4 拍（取指令、取操作数都是它）

| 拍 | 地址线 AB | 数据线 DB | 控制线 CB（有效） | 谁驱动数据线 |
| --- | --- | --- | --- | --- |
| T1 | **送出地址** | 高阻（无人驱动） | MREQ（本次是访存） | 无 |
| T2 | 保持地址 | 高阻 | **MEMR（读命令有效）** | 无 |
| T3 | 保持地址 | **数据送上数据线** | MEMR 仍有效 | **主存 / 接口** |
| T4 | 撤除 | 撤除 | 全部撤除，周期结束 | 无 |
**顺序记法：读 = "先给命令、再等数据"**（T2 命令 → T3 数据）。

## 写总线周期：4 拍

| 拍 | 地址线 AB | 数据线 DB | 控制线 CB（有效） | 谁驱动数据线 |
| --- | --- | --- | --- | --- |
| T1 | **送出地址** | 高阻 | MREQ | 无 |
| T2 | 保持地址 | **CPU 把要写的数据送上去** | 仍无写命令 | **CPU** |
| T3 | 保持地址 | 保持数据 | **MEMW（写命令有效）** | **CPU** |
| T4 | 撤除 | 撤除 | 全部撤除 | 无 |
**顺序记法：写 = "先摆数据、再下命令"**（T2 数据 → T3 命令）——**与读周期正好相反**，这是最容易记混的一处。

## 中断响应周期：2 拍，**不送地址**

| 拍 | 地址线 AB | 数据线 DB | 控制线 CB（有效） | 谁驱动数据线 |
| --- | --- | --- | --- | --- |
| T1 | **不送地址**（不是按地址存取） | 高阻 | **INTA（中断响应 / 应答）** | 无 |
| T2 | 不送地址 | **中断类型号送上数据线** | INTA 仍有效 | **中断控制器** |
CPU 从数据线读入**类型号** → 查**中断向量表** → 得到中断服务程序入口地址。
**★ 中断类型号走的是数据总线**（它本质上就是"数据"），**而 INTA 这种应答（握手）信号走控制总线**——2011-20 全题就考这一点。

## 等待周期 TW 与 READY

慢速部件来不及在 T3 交出数据时，由它**拉低 READY 线**（控制线，**部件 → CPU** 方向）；
CPU 在 **T3 与 T4 之间插入一个 TW 拍**，地址与命令都保持不变，直到 READY 变高才进 T4。
⟹ **READY 也是"请求 / 应答"类，只在控制总线上**。

## 最容易错的四处

1. **"数据线上不可能传地址"**对，但**别把指令、中断类型号当成"非数据"**——它们都走数据线（取指时指令就在数据线上传）。
2. **握手（应答）信号不在数据线上**：它是控制总线的联络信号（2011-20 的答案）。
3. **中断响应周期不送地址**：它不是"按地址读写"，而是"向中断控制器要中断源的身份（类型号）"。
4. **一拍只能有一个部件驱动数据总线**（否则就是总线冲突）——这是判断"某一拍的数据线内容是否可能"的通用判据。

> **真题考情**：**1/18 年（选 1、无大题）**：选 2011-20（系统总线的数据线上**不可能**传输的是 —— 答案"握手（应答）信号"，它属于控制总线；指令 / 操作数 / 中断类型号都在数据线上）。
`,

  inputs: [
    {
      key: 'mode', label: '总线周期', type: 'select', default: 'fetch', wide: true,
      options: [
        { v: 'fetch', t: '取指总线周期（读指令）—— 4 拍（插 TW 再加拍）' },
        { v: 'read', t: '取数总线周期（读操作数）—— 4 拍（插 TW 再加拍）' },
        { v: 'write', t: '存数总线周期（写数据）—— 4 拍，数据在命令之前' },
        { v: 'intack', t: '中断响应总线周期 —— 2 拍，不送地址、类型号走数据线' },
      ],
    },
    {
      key: 'addr', label: '地址总线上的地址（4 位十六进制）', type: 'text', default: '0010',
      help: '取指周期里它是 PC 的值；取数 / 存数周期里它是有效地址。中断响应周期不送地址，这一项被忽略',
    },
    {
      key: 'data', label: '数据总线上的内容（4 位十六进制）', type: 'text', default: '3A5C',
      help: '取指周期里它是指令字；取数周期里它是读到的操作数；存数周期里它是 CPU 要写出的数据',
    },
    {
      key: 'intno', label: '中断类型号（2 位十六进制，只对中断响应周期有意义）', type: 'text', default: '20',
      help: '8 位类型号。CPU 读入它之后查中断向量表；中断响应周期分给它的帧里会把它摆上数据总线',
    },
    {
      key: 'tw', label: '插入的等待周期 TW 个数', type: 'select', default: '0',
      options: [{ v: '0', t: '不插（部件够快，READY 一直有效）' }, { v: '1', t: '插 1 个 TW（T3 与 T4 之间）' }, { v: '2', t: '插 2 个 TW' }],
    },
  ],

  quickActions: [
    { label: '🎯 2011-20 同款：中断响应周期 —— 类型号走数据线、INTA 走控制线', run(rt) { rt.setInput('mode', 'intack'); rt.setInput('intno', '20'); rt.load(); } },
    { label: '📘 取指总线周期：PC → 地址线，指令字 → 数据线', run(rt) { rt.setInput('mode', 'fetch'); rt.setInput('addr', '0010'); rt.setInput('data', '3A5C'); rt.setInput('tw', '0'); rt.load(); } },
    { label: '📘 取数总线周期：先读命令、后数据（读的顺序）', run(rt) { rt.setInput('mode', 'read'); rt.setInput('addr', '0014'); rt.setInput('data', '0006'); rt.setInput('tw', '0'); rt.load(); } },
    { label: '📘 存数总线周期：先送数据、后发写命令（写的顺序，与读相反）', run(rt) { rt.setInput('mode', 'write'); rt.setInput('addr', '0014'); rt.setInput('data', '00FF'); rt.setInput('tw', '0'); rt.load(); } },
    { label: '📘 慢速部件：插入 2 个等待周期 TW（READY 拉低）', run(rt) { rt.setInput('mode', 'read'); rt.setInput('addr', '0014'); rt.setInput('data', '0006'); rt.setInput('tw', '2'); rt.load(); } },
    { label: '📘 取指 + 插 1 个 TW：地址与命令在 TW 期间保持不变', run(rt) { rt.setInput('mode', 'fetch'); rt.setInput('addr', '0020'); rt.setInput('data', '1234'); rt.setInput('tw', '1'); rt.load(); } },
    { label: '📘 中断响应：类型号 08H（时钟中断）', run(rt) { rt.setInput('mode', 'intack'); rt.setInput('intno', '08'); rt.load(); } },
  ],

  parse(vals) {
    const mode = ['fetch', 'read', 'write', 'intack'].indexOf(String(vals.mode)) >= 0 ? String(vals.mode) : 'fetch';
    const h4 = v => v.toString(16).toUpperCase().padStart(4, '0');
    const h2 = v => v.toString(16).toUpperCase().padStart(2, '0');
    const hx = (s, name, digits) => {
      const t = String(s == null ? '' : s).trim().replace(/^0[xX]/, '');
      const re = new RegExp('^[0-9a-fA-F]{1,' + digits + '}$');
      if (!re.test(t)) throw { message: `${name}「${s}」要写成 1~${digits} 位十六进制` };
      return parseInt(t, 16);
    };
    const intack = mode === 'intack';
    const addr = intack ? null : hx(vals.addr, '地址', 4);
    const data = intack ? null : hx(vals.data, '数据总线内容', 4);
    const intno = intack ? hx(vals.intno, '中断类型号', 2) : null;
    const tw = Math.max(0, Math.min(2, parseInt(String(vals.tw), 10) || 0));

    /* ---- 逐拍表：每拍给出三条线的内容 + 谁驱动数据线 + 有效控制信号 ---- */
    const B = [];
    const push = o => B.push(Object.assign({ sigs: [] }, o));
    if (intack) {
      push({
        t: 'T1', kind: 'ack', ab: null, db: null, dbBy: null,
        sigs: [{ n: 'INTA', val: '有效（低电平）', cls: 'ack', d: 'CPU → 中断控制器：我响应你的中断请求' }],
        note: '地址线<b>不送地址</b>（中断响应不是按地址存取）；数据线还没有人驱动',
        desc: `中断响应第 1 拍：CPU 在**控制总线**上发出 **INTA（中断响应 / 应答）**信号。**地址总线不送地址**、数据总线暂时无人驱动——因为这一拍要的不是"某个单元的内容"，而是"是哪个设备在请求"。`,
      });
      push({
        t: 'T2', kind: 'data', ab: null, db: intno, dbBy: '中断控制器',
        sigs: [{ n: 'INTA', val: '仍有效', cls: 'ack', d: 'CPU 等着收类型号' }],
        note: '<b>中断类型号走数据总线</b>（它本质上是"数据"）',
        desc: `中断响应第 2 拍：中断控制器把**中断类型号 ${h2(intno)}H** 送上**数据总线**，CPU 读入后据此查**中断向量表**拿到服务程序入口地址。**注意**：类型号走的是**数据总线**，而 INTA 这类**应答（握手）信号**只可能在**控制总线**上——2011-20 问的就是这个。`,
      });
    } else if (mode === 'write') {
      push({
        t: 'T1', kind: 'addr', ab: addr, db: null, dbBy: null,
        sigs: [{ n: 'MREQ', val: '有效', cls: 'cmd', d: 'CPU → 主存：本次是访存' }],
        note: '先把地址摆上地址总线',
        desc: `写周期第 1 拍：CPU 把**有效地址 ${h4(addr)}H** 送上**地址总线**（单向：CPU → 主存）。此时数据线还没人驱动，控制线上只有 MREQ 表明"这次是访存"。`,
      });
      push({
        t: 'T2', kind: 'data', ab: addr, db: data, dbBy: 'CPU',
        sigs: [{ n: 'MREQ', val: '有效', cls: 'cmd', d: '仍然有效' }],
        note: '<b>先摆数据</b>（写命令还没发）',
        desc: `写周期第 2 拍：CPU 把**要写出的数据 ${h4(data)}H** 送上**数据总线**（本拍 CPU 是数据线的驱动者）。**注意此时还没有写命令**——写周期的顺序是"**先数据、后命令**"，这一点与读周期正好相反。`,
      });
      push({
        t: 'T3', kind: 'cmd', ab: addr, db: data, dbBy: 'CPU',
        sigs: [{ n: 'MEMW', val: '有效', cls: 'cmd', d: 'CPU → 主存：按上面的地址把这批数据写进去' }],
        note: '<b>后发写命令</b>，主存在本拍真正落盘',
        desc: `写周期第 3 拍：CPU 在**控制总线**上发出 **MEMW（写命令）**，主存按地址线给出的地址、把数据线上的 ${h4(data)}H 写进对应单元。数据仍由 CPU 驱动。`,
      });
      push({
        t: 'T4', kind: 'idle', ab: null, db: null, dbBy: null, sigs: [],
        note: '命令与地址一起撤除，总线周期结束',
        desc: `写周期第 4 拍：地址、数据、命令**一起撤除**，一个总线周期结束。总线回到空闲状态，可以被下一个周期（或 DMA 控制器）接管。`,
      });
    } else {
      const isFetch = mode === 'fetch';
      const what = isFetch ? '指令字' : '操作数';
      push({
        t: 'T1', kind: 'addr', ab: addr, db: null, dbBy: null,
        sigs: [{ n: 'MREQ', val: '有效', cls: 'cmd', d: 'CPU → 主存：本次是访存' }],
        note: isFetch ? '地址 = <b>PC 的值</b>（要取哪条指令）' : '地址 = <b>有效地址</b>（要取哪个操作数）',
        desc: `${isFetch ? '取指' : '取数'}周期第 1 拍：CPU 把 **${isFetch ? 'PC 的值' : '有效地址'} ${h4(addr)}H** 送上**地址总线**（单向，只能 CPU → 主存 / I/O）。数据线无人驱动，控制线上只有 MREQ。`,
      });
      push({
        t: 'T2', kind: 'cmd', ab: addr, db: null, dbBy: null,
        sigs: [{ n: 'MEMR', val: '有效', cls: 'cmd', d: 'CPU → 主存：把这批数据给我' }],
        note: '<b>先发读命令</b>，数据还没上来',
        desc: `${isFetch ? '取指' : '取数'}周期第 2 拍：CPU 在**控制总线**上发出 **MEMR（读命令）**，主存按地址线开始读出。**读周期的顺序是"先命令、后数据"**——T2 只有命令、数据线仍是高阻。`,
      });
      push({
        t: 'T3', kind: 'data', ab: addr, db: data, dbBy: '主存',
        sigs: [{ n: 'MEMR', val: '仍有效', cls: 'cmd', d: '命令保持到数据取走' }],
        note: `<b>${what}走数据总线</b>（本拍由主存驱动）`,
        desc: `${isFetch ? '取指' : '取数'}周期第 3 拍：主存把 **${what} ${h4(data)}H** 送上**数据总线**，CPU 从数据线上读入 ${isFetch ? 'MDR' : '通用寄存器'}。**本拍数据线的驱动者是主存**——一拍只能有一个驱动者，否则就是总线冲突。${isFetch ? ' 注意：**指令也是在数据线上传的**。' : ''}`,
      });
      push({
        t: 'T4', kind: 'idle', ab: null, db: null, dbBy: null, sigs: [],
        note: '地址、命令、数据一起撤除，周期结束',
        desc: `${isFetch ? '取指' : '取数'}周期第 4 拍：地址与命令撤除，总线周期结束。${isFetch ? 'CPU 随后把 MDR 的内容送进 IR，并让 PC + 1。' : 'CPU 随后把这批数据写进目的寄存器。'}`,
      });
      for (let i = 1; i <= tw; i++) {
        push({
          t: 'TW' + (tw > 1 ? i : ''), kind: 'wait', ab: addr, db: null, dbBy: null,
          sigs: [
            { n: 'READY', val: '无效（被部件拉低）', cls: 'ack', d: '慢速部件 → CPU：我还没准备好' },
            { n: 'MEMR', val: '仍有效', cls: 'cmd', d: 'CPU 保持命令等待' },
          ],
          note: '地址与命令<b>保持不变</b>，只是等',
          desc: `等待周期第 ${i} 拍：被访问的部件拉低 **READY**（控制总线，方向是**部件 → CPU**），CPU 在 T3 与 T4 之间**插入 TW**。**地址线与控制线全部保持不变**，只是多花一个节拍等部件就绪。READY 同样是"请求 / 应答"类信号 ⟹ 只在**控制总线**上。`,
        });
      }
    }

    const total = B.length;
    const order = mode === 'read' || mode === 'fetch' ? '先命令（T2）后数据（T3）'
      : mode === 'write' ? '先数据（T2）后命令（T3）'
        : '先应答（T1）后类型号（T2）';

    /* 2011-20 判定表：四个候选各走哪条线（这题问"数据线上不可能传的是"） */
    const judge = [
      { name: '指令', bus: 'db', ok: true, why: '取指时指令就是在数据线上传进 CPU 的' },
      { name: '操作数', bus: 'db', ok: true, why: '数据总线本职就是传数据' },
      { name: '握手（应答）信号', bus: 'cb', ok: false, why: '它是通信联络（控制）信号，只在控制总线上（如 INTA / READY）' },
      { name: '中断类型号', bus: 'db', ok: true, why: '中断响应周期里它由中断控制器送上数据总线，CPU 读入后查中断向量表' },
    ];

    return {
      mode, intack, addr, data, intno, tw, beats: B, total, order,
      addrText: addr == null ? '—' : h4(addr) + 'H',
      dataText: data == null ? '—' : h4(data) + 'H',
      intnoText: intno == null ? '—' : h2(intno) + 'H',
      h4, h2, judge, lines: BS_LINES.map(l => Object.assign({}, l)),
      MODE_NAME: { fetch: '取指总线周期', read: '取数总线周期', write: '存数总线周期', intack: '中断响应总线周期' }[mode],
    };
  },

  buildSnapshots(model) {
    const m = model;
    const snaps = [];
    const base = {
      mode: m.mode, intack: m.intack, total: m.total, order: m.order,
      modeName: m.MODE_NAME, addrText: m.addrText, dataText: m.dataText, intnoText: m.intnoText,
      tw: m.tw, judge: m.judge.map(j => Object.assign({}, j)),
      lines: m.lines.map(l => Object.assign({}, l)),
      beats: m.beats.map(b => ({
        t: b.t, kind: b.kind, ab: b.ab, db: b.db, dbBy: b.dbBy, note: b.note,
        sigs: b.sigs.map(s => Object.assign({}, s)),
      })),
      addrHex: m.addr, dataHex: m.data, intnoHex: m.intno,
    };
    const mk = o => Object.assign({}, base, o);

    snaps.push(mk({
      kind: 'init', idx: 0, beat: null,
      desc: `就绪：${m.MODE_NAME}，共 ${m.total} 拍（${m.order}）。地址线 ${m.addrText}、数据线 ${m.dataText}` +
        (m.intack ? `、中断类型号 ${m.intnoText}` : '') + (m.tw ? `，其中插入 ${m.tw} 个等待周期 TW` : '') +
        `。点"单步"逐拍看三条线上各传什么、这一拍谁在驱动数据总线。`,
      log: `就绪：${m.MODE_NAME}｜${m.total} 拍｜${m.order}`,
      logType: 'info',
    }));

    let dbByLast = null;
    m.beats.forEach((b, i) => {
      /* 不变量②：数据总线一拍至多一个驱动者（"无人驱动"与"唯一驱动者"都合法） */
      const drivers = [];
      if (b.dbBy) drivers.push(b.dbBy);
      const dbLine = b.db == null ? '高阻（无人驱动）' : m.h4(b.db) + 'H（驱动者：' + b.dbBy + '）';
      const abLine = b.ab == null ? (m.intack ? '**不送地址**（中断响应周期）' : '撤除 / 高阻') : m.h4(b.ab) + 'H';
      const sigText = b.sigs.length ? b.sigs.map(s => s.n + '=' + s.val).join('，') : '无有效信号（总线空闲）';
      snaps.push(mk({
        kind: 'beat', idx: i + 1, beat: Object.assign({}, b, { sigs: b.sigs.map(s => Object.assign({}, s)) }),
        abLine, dbLine, sigText, drivers,
        desc: b.desc,
        log: `#${i + 1} ${b.t}｜地址线 ${b.ab == null ? '—' : m.h4(b.ab)}｜数据线 ${b.db == null ? '高阻' : m.h4(b.db) + '(' + b.dbBy + ')'}｜控制线 ${b.sigs.map(s => s.n).join('/') || '—'}`,
        logType: b.kind === 'idle' ? 'info' : (i === m.total - 1 ? 'success' : 'info'),
      }));
      dbByLast = b.dbBy;
    });

    const last = m.beats[m.beats.length - 1];
    const carried = m.beats.filter(b => b.db != null && b.dbBy);
    const summary = carried.length
      ? carried.map(b => `${b.dbBy}把 ${m.h4(b.db)}H 送上数据总线（${b.t}）`).join('；')
      : '整个周期数据线上没有出现过数据';
    snaps.push(mk({
      kind: 'done', idx: m.total + 1, beat: null,
      abLine: last.ab == null ? (m.intack ? '**不送地址**' : '撤除') : m.h4(last.ab) + 'H',
      dbLine: last.db == null ? '撤除 / 高阻' : m.h4(last.db) + 'H',
      sigText: '周期结束，全部信号撤除',
      desc: `完成：${m.MODE_NAME}共 ${m.total} 拍（${m.order}）。数据线上出现过 ${carried.length} 次内容：${summary}。` +
        (m.intack ? ' 记住：**中断类型号走数据总线**，而 **INTA 这类应答（握手）信号只可能在控制总线**上。'
          : ' 记住：**地址线只传地址、数据线只传数据、命令与握手只在控制线上**。'),
      log: `完成：${m.MODE_NAME}｜${m.total} 拍｜${summary}`,
      logType: 'success',
    }));
    return snaps;
  },

  render(ctx) {
    const { snap: s, model: m, stage } = ctx;
    const isBeat = s.kind === 'beat';
    const b = s.beat;

    /* -------- 三条线：本拍被驱动的那条加粗高亮 -------- */
    const lineRow = (L) => {
      const hot = isBeat && ((L.id === 'ab' && b.ab != null) || (L.id === 'db' && b.db != null) ||
        (L.id === 'cb' && b.sigs.length > 0));
      const val = !isBeat ? '（未开始 / 已结束）'
        : L.id === 'ab' ? (b.ab == null ? (m.intack ? '不送地址' : '高阻 / 撤除') : m.h4(b.ab) + 'H')
          : L.id === 'db' ? (b.db == null ? '高阻（无人驱动）' : m.h4(b.db) + 'H')
            : (b.sigs.length ? b.sigs.map(x => x.n).join(' / ') : '无有效信号');
      return `<div data-bus="${L.id}" data-hot="${hot ? 1 : 0}" style="border:1.5px solid ${hot ? L.color : '#e2e8f0'};
        background:${hot ? '#ffffff' : '#f8fafc'};border-radius:9px;padding:6px 10px;display:flex;align-items:center;gap:10px;box-sizing:border-box">
        <span style="min-width:104px;font:700 12px system-ui;color:${hot ? L.color : '#64748b'}">${L.name}</span>
        <span style="font:600 11px system-ui;color:#94a3b8;min-width:150px">${L.dirText}</span>
        <span data-busval="${L.id}" style="font:700 14px Consolas,monospace;color:${hot ? '#0f172a' : '#94a3b8'}">${val}</span>
        ${hot ? '<span style="font:700 10px system-ui;color:#b45309">◀ 本拍被驱动</span>' : ''}
      </div>`;
    };

    /* -------- 控制线上的信号小卡 -------- */
    const sigCards = isBeat && b.sigs.length
      ? b.sigs.map(x => `<div data-sig="${x.n}" style="border:1.5px solid #fcd34d;background:#fffbeb;border-radius:9px;padding:5px 10px;box-sizing:border-box">
          <div style="font:700 12px Consolas,monospace;color:#b45309">${x.n} <span style="font:600 10px system-ui;color:#92400e">${x.val}</span></div>
          <div style="font:600 11px system-ui;color:#92400e">${x.d}</div></div>`).join('')
      : `<div style="font:600 12px system-ui;color:#94a3b8">${isBeat ? '本拍控制总线上没有有效信号（总线空闲）' : '（尚未开始 / 周期已结束）'}</div>`;

    /* -------- 逐拍表 -------- */
    const rows = s.beats.map((x, i) => {
      const cur = i + 1 === s.idx;
      return `<tr data-beat="${i + 1}" style="${cur ? 'background:#eef2ff;font-weight:700' : ''}">
        <td style="padding:2px 8px;white-space:nowrap">${x.t}</td>
        <td style="padding:2px 8px;font-family:Consolas,monospace">${x.ab == null ? (m.intack ? '不送地址' : '—') : m.h4(x.ab) + 'H'}</td>
        <td style="padding:2px 8px;font-family:Consolas,monospace">${x.db == null ? '高阻' : m.h4(x.db) + 'H'}</td>
        <td style="padding:2px 8px;font-family:Consolas,monospace;color:#b45309">${x.sigs.map(g => g.n).join(', ') || '—'}</td>
        <td style="padding:2px 8px;color:#475569">${x.dbBy || '—'}</td>
        <td style="padding:2px 8px;color:#64748b">${x.note || ''}</td>
      </tr>`;
    }).join('');

    /* -------- 三条总线分类表 -------- */
    const lineRows = s.lines.map(L => `<tr data-line="${L.id}">
      <td style="padding:2px 8px;white-space:nowrap;color:${L.color};font-weight:700">${L.name}</td>
      <td style="padding:2px 8px">${L.dirText}</td>
      <td style="padding:2px 8px">${L.id === 'ab' ? '地址（存储单元号 / I/O 端口号）'
        : L.id === 'db' ? '数据：指令字、操作数、中断类型号、状态字、命令字'
          : '命令与请求 / 应答（握手）：MEMR、MEMW、INTR、INTA、HRQ/HLDA、READY…'}</td>
    </tr>`).join('');

    /* -------- 2011-20 判定表 -------- */
    const jRows = s.judge.map(j => `<tr data-judge="${j.name}">
      <td style="padding:2px 8px;white-space:nowrap">${j.name}</td>
      <td style="padding:2px 8px;color:${j.bus === 'db' ? '#2563eb' : '#b45309'};font-weight:700">${j.bus === 'db' ? '数据总线 DB' : '控制总线 CB'}</td>
      <td style="padding:2px 8px;color:${j.ok ? '#047857' : '#b91c1c'};font-weight:700">${j.ok ? '能' : '不能'}</td>
      <td style="padding:2px 8px;color:#475569">${j.why}</td>
    </tr>`).join('');

    /* -------- 控制线清单表 -------- */
    const ctrlRows = s.lines && BS_CTRL.map(c => `<tr data-ctrl="${c.n}">
      <td style="padding:2px 8px;font-family:Consolas,monospace;white-space:nowrap">${c.n}</td>
      <td style="padding:2px 8px;white-space:nowrap">${c.t}</td>
      <td style="padding:2px 8px;color:${c.kind === 'cmd' ? '#b45309' : (c.kind === 'ack' ? '#be185d' : '#475569')}">${c.kind === 'cmd' ? '命令' : c.kind === 'ack' ? '应答 / 握手' : (c.kind === 'req' ? '请求' : '其他')}</td>
      <td style="padding:2px 8px;color:#64748b">${c.d}</td>
    </tr>`).join('');

    const dbByTxt = isBeat ? (b.db == null ? '本拍无人驱动' : b.dbBy) : '—';
    const cards =
      RC408.ui.statCard('总线周期', isBeat ? b.t + ' / ' + m.total : (s.kind === 'init' ? '0 / ' + m.total : '完成（共 ' + m.total + ' 拍）'), m.MODE_NAME, 'text-indigo-600') +
      RC408.ui.statCard('数据总线驱动者', dbByTxt, '一拍至多一个驱动者（否则总线冲突）', isBeat && b.db != null ? 'text-amber-600' : 'text-slate-400') +
      RC408.ui.statCard('顺序', m.order, m.mode === 'write' ? '写：先数据后命令' : (m.intack ? '中断响应：先应答后类型号' : '读：先命令后数据'), 'text-slate-800') +
      RC408.ui.statCard('等待周期 TW', m.tw ? m.tw + ' 个' : '无', m.tw ? 'READY 被部件拉低' : '部件够快，READY 一直有效', m.tw ? 'text-rose-600' : 'text-slate-800');

    stage.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>

        <div class="rounded-2xl border border-slate-200 bg-white p-3">
          ${RC408.ui.sectionTitle('三条总线（本拍被驱动的那条加粗高亮）')}
          <div data-busgrid="1" style="display:flex;flex-direction:column;gap:6px">${s.lines.map(lineRow).join('')}</div>
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">${sigCards}</div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('逐拍表（当前拍高亮）：每一拍地址线 / 数据线 / 控制线各传什么、谁驱动数据线')}
          <table class="text-sm" data-bs-table="beats" style="width:100%;border-collapse:collapse">
            <thead><tr style="color:#94a3b8;font-size:11px">
              <th style="text-align:left;padding:2px 8px">拍</th><th style="text-align:left;padding:2px 8px">地址线 AB</th>
              <th style="text-align:left;padding:2px 8px">数据线 DB</th><th style="text-align:left;padding:2px 8px">控制线 CB</th>
              <th style="text-align:left;padding:2px 8px">数据线驱动者</th><th style="text-align:left;padding:2px 8px">说明</th>
            </tr></thead><tbody>${rows}</tbody>
          </table>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start">
          <div class="rounded-xl border border-slate-200 bg-white px-4 py-3" style="flex:1 1 420px;min-width:360px;overflow-x:auto">
            ${RC408.ui.sectionTitle('三条总线各传什么')}
            <table class="text-sm" data-bs-table="lines" style="width:100%;border-collapse:collapse">
              <thead><tr style="color:#94a3b8;font-size:11px">
                <th style="text-align:left;padding:2px 8px">总线</th><th style="text-align:left;padding:2px 8px">方向</th>
                <th style="text-align:left;padding:2px 8px">典型内容</th>
              </tr></thead><tbody>${lineRows}</tbody>
            </table>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white px-4 py-3" style="flex:1 1 420px;min-width:360px;overflow-x:auto">
            ${RC408.ui.sectionTitle('2011-20 判定：四个候选里哪一个不可能出现在数据总线上')}
            <table class="text-sm" data-bs-table="judge" style="width:100%;border-collapse:collapse">
              <thead><tr style="color:#94a3b8;font-size:11px">
                <th style="text-align:left;padding:2px 8px">候选</th><th style="text-align:left;padding:2px 8px">实际走哪条线</th>
                <th style="text-align:left;padding:2px 8px">能在数据线上吗</th><th style="text-align:left;padding:2px 8px">依据</th>
              </tr></thead><tbody>${jRows}</tbody>
            </table>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 overflow-x-auto">
          ${RC408.ui.sectionTitle('控制总线上的信号线（命令类只朝一个方向、请求 / 应答类朝相反方向）')}
          <table class="text-sm" data-bs-table="ctrl" style="width:100%;border-collapse:collapse">
            <thead><tr style="color:#94a3b8;font-size:11px">
              <th style="text-align:left;padding:2px 8px">信号</th><th style="text-align:left;padding:2px 8px">名称</th>
              <th style="text-align:left;padding:2px 8px">类别</th><th style="text-align:left;padding:2px 8px">方向与作用</th>
            </tr></thead><tbody>${ctrlRows}</tbody>
          </table>
        </div>

        <div class="rounded-xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-900 leading-relaxed">
          💡 <b>考点提醒：</b>① <b>地址总线单向</b>（CPU → 主存 / I/O），只传地址；
          ② <b>数据总线双向</b>，"数据"是广义的——<b>指令字、操作数、中断类型号、状态字、命令字都走数据线</b>；
          ③ <b>握手（应答）信号是控制总线的联络信号</b>，不可能出现在数据线上（2011-20）；
          ④ <b>读周期"先命令后数据"、写周期"先数据后命令"</b>；
          ⑤ <b>中断响应周期不送地址</b>，类型号走数据线、INTA 走控制线；
          ⑥ <b>一拍只能有一个部件驱动数据总线</b>——这是判断"某拍数据线内容是否可能"的通用判据。
        </div>
      </div>`;
  },
});
