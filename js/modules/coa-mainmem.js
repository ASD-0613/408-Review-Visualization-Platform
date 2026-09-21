'use strict';
/* ============================================================================
 * coa-mainmem.js —— 【计算机组成原理】主存与 CPU 连接（存储器芯片扩展）
 * ----------------------------------------------------------------------------
 * 前缀：_mm（所有顶层函数/常量都带前缀，避免经典 script 全局污染，见 handover §3.1-3）
 *
 * 快照设计（§1.3 铁律：每帧全量携带，回退/跳帧才不出错）：
 *   step: init | place | data | addr | decode | cs | probe | check | done
 *   chips   每个芯片一行的**全量副本**：{ id, kind, ri, ci, placed, sel }
 *   newIds  本帧"新摆放"的芯片（渲染端只给它们挂淡入关键帧，其余帧不动画）
 *   bits    数据线分组（第 c 列覆盖哪几位，D 编号从高到低）
 *   rows    芯片行 → 地址区间 { ri, from, to, kind }
 *   probe   { addr, val, ri, kind, sel, offset }（地址访问演示帧；其余帧 null）
 *   selBits / innerBits  片选位数 / 片内地址位数（行数为 1 时前者为 0）
 *
 * 三条硬公式（本模块的全部考点）：
 *   ① 位扩展倍数 = 存储字长 ÷ 单片字长        （= 芯片矩阵的**列数**）
 *   ② 字扩展倍数 = 存储单元数 ÷ 单片单元数    （= 芯片矩阵的**行数**）
 *   ③ 芯片总数 ① × ②
 * ⚠ 两条前提（不满足则本题无解，parse 直接报错）：
 *   · 单片单元数必须能整除存储单元数；单片字长必须能整除存储字长。
 *
 * 与相邻考点的边界（子代理 2026-09-20 核查结论，见 handover）：
 *   本模块覆盖"芯片扩展 4 道 + MAR/MDR 位数 3 道 + 地址范围分配 1 道"；
 *   DRAM 行列地址复用 / 芯片地址引脚数（2014-15、2018-17）、交叉编址低位选片
 *   （2017-13、2022-17、2026-15）属相邻考点，本模块只在 theory 里作对比讲一句，不登记考情。
 * ========================================================================== */

/* ------------------------------ 布局常量（_mm） ------------------------------ */
const _mmBusX = 34;      // 地址总线 x
const _mmMatX = 152;     // 芯片矩阵左上角 x（左侧要留出：地址总线 34 + 位标注 + 片选干线 matX−22 + CS 标注）
const _mmMatY = 74;      // 芯片矩阵左上角 y
const _mmChipW = 86;     // 单片宽
const _mmChipH = 54;     // 单片高
const _mmChipGX = 214;   // 列间距（列右侧要放"CS0 / 地址范围"两行文字）
const _mmChipGY = 66;    // 行间距
const _mmTblH = 19;      // 地址空间表每行高度
const _mmDur = '0.55s';
const _mmEase = 'cubic-bezier(.4,0,.2,1)';

/* ------------------------------ 纯工具（_mm） ------------------------------ */
const _mmIsPow2 = n => Number.isFinite(n) && n > 0 && (n & (n - 1)) === 0;

/**
 * 地址线位数：单元数是 2 的幂时 = log₂N；**不是** 2 的幂时向上取整。
 * 总容量允许非 2 的幂（2016-16：64KB 地址空间、ROM 占 8KB、RAM 56KB，56KB 不是 2 的幂），
 * 此时地址线位数仍按"地址空间大小"取 ⌈log₂N⌉，顶部留未用地址区。
 */
function _mmAddrBits(n) { return Math.ceil(Math.log2(n) - 1e-9); }

/**
 * 片选（高位地址）位数 = ⌈log₂行数⌉。
 * 行数通常是 2 的幂（每个译码输出接一行），但**行数不一定是 2 的幂**：
 * 如"64KB 空间里 ROM 占 8KB、其余 56KB 用 4K×4 片"就是 1+14 = 15 行。
 * 这时高位取 ⌈log₂15⌉ = 4 位，译码器有 16 个输出、只用 15 个（本模块按此口径讲解）。
 */
function _mmBind(rows) { return Math.max(0, Math.ceil(Math.log2(Math.max(1, rows)) - 1e-9)); }

/** 存储芯片规格的教材写法：片容量 4096 个单元 → "4K×8" */
function _mmSpec(cap, w) { return (cap / 1024) + 'K×' + w; }

/**
 * 芯片的"字节容量"：芯片规格里的 K 是**单元数**，位宽是**每单元位数**，
 * 所以单片容量 = K × 1024 × (位宽 ÷ 8) 字节（如 4K×4 = 4K 单元 × 4 位 = 2KB）。
 * ⚠ 这条换算最容易写错——窗5 第一版把"片容量"当成"单元数 × 位宽"从而整体差一个位宽倍数。
 */
function _mmChipBytes(cap, w) { return cap * w / 8; }

/** 2 的幂 → 教材写法（地址线位数展示用）：1024 → 2^10 */
function _mmP2(n) { return '2^' + Math.round(Math.log2(n)); }

/** 容量（字节）→ 人类可读 */
function _mmBytes(b) {
  if (b >= 1024 * 1024 && b % (1024 * 1024) === 0) return (b / 1024 / 1024) + 'MB';
  if (b >= 1024 && b % 1024 === 0) return (b / 1024) + 'KB';
  return b + 'B';
}

function _mmHex(v, bits) { return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0'); }

/** 地址区间 → "0x0000 ~ 0x0FFF" */
function _mmRange(from, to, bits) { return _mmHex(from, bits) + ' ~ ' + _mmHex(to, bits); }

/**
 * 关键帧：淡入 + 相对位移（§3.1-5：每帧重建 DOM，只有 @keyframes 会重放）。
 * ⚠ 这里给的是**相对位移**（起点 = 终点 − dx,dy），不是绝对槽位坐标——
 *   窗5 第一版直接把槽位坐标当 from 写进去，动画变成"从另一个芯片的位置滑过来"（冒烟的反算断言抓到）。
 * 写法照 §3.1-5③：`to` 恒为 `translate(0px,0px)`，这样 t=1 精确落位、动画被禁用时也停在正确位置。
 */
function _mmKF(name, dx, dy, fromOpacity) {
  return '@keyframes ' + name + '{from{transform:translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px);opacity:'
    + (fromOpacity === undefined ? 0 : fromOpacity) + '}to{transform:translate(0px,0px);opacity:1}}';
}

/** 几何：画布尺寸与分区位置（快照与渲染共用同一份，保证关键帧反算能对上） */
function _mmGeo(model) {
  const cols = model.cols, rows = model.rows;
  const rowH = Math.max(96, rows * 21 + 20);              // 表区高度随行数增长（每行一块地址区间）
  const matW = _mmMatX + (cols - 1) * _mmChipGX + _mmChipW + 40;
  const matH = _mmMatY + (rows - 1) * _mmChipGY + _mmChipH + 20;
  const decY = matH + 30;
  const tblTop = decY + 54;
  /* 画布右边界必须装得下"最右一列芯片 + 数据线干线 + 竖直标注"，见 _mmRender 的 dbx 与 mm-bus-label */
  const W = Math.max(matW, _mmMatX + cols * _mmChipGX + _mmChipW + 260);
  const H = tblTop + rowH + 20;
  return { cols: cols, rows: rows, matX: _mmMatX, matY: _mmMatY, chipW: _mmChipW, chipH: _mmChipH,
    gx: _mmChipGX, gy: _mmChipGY, decY: decY, tblTop: tblTop, rowH: rowH, W: W, H: H };
}

/** 槽位坐标（列 ci、行 ri）——纯函数，只由布局常量与下标决定 */
function _mmSlot(geo, ci, ri) {
  return { x: geo.matX + ci * geo.gx, y: geo.matY + ri * geo.gy };
}

/** 一片芯片覆盖的地址单元数 = 规格里的 K 值（如 4K×4 → 4096 个单元的 4 位数据） */
function _mmUnits(cap) { return cap; }

/** 数据线分组：位扩展倍数 = 列数，第 0 列管最低的"单片字长"位 */
function _mmBits(model) {
  const out = [];
  const chipW = model.cols > 0 ? model.word / model.cols : model.word;   // 单片字长 = 存储字长 ÷ 列数
  for (let c = 0; c < model.cols; c++) {
    const hi = model.word - 1 - c * chipW;
    const lo = hi - chipW + 1;
    out.push({ c: c, hi: hi, lo: lo, text: lo === hi ? ('D' + hi) : ('D' + hi + '~D' + lo) });
  }
  return out;
}

/**
 * 行 → 地址区间（ROM 先占低位，RAM 紧随其后）。
 * ⚠ 行跨度必须按**存储单元数**算：一行 = 列数 片芯片，每片 单片单元数 个单元，
 *   但一块芯片的"容量"是按**位**算的，所以要乘"位宽比"、再除"每单元字节数"：
 *       行跨度 = 列数 × 单片单元数 × 单片字长 ÷ 存储字长  = 列数 × 单片单元数 ÷ 每单元字节数
 *   窗5 在这里错了两次：先漏乘、后又多乘，冒烟"usedSpan = 各行之和"与"芯片数×单片容量 = 总容量"两条断言把它钉死。
 */
function _mmRows(model) {
  const out = [];
  /* 行跨度（存储单元数）= 单片单元数 × 列数 × (单片字长 ÷ 存储字长)
     —— 最后这个比值不能省：字长 8 位、芯片 4 位时，4K 单元的芯片只覆盖 2048 个 8 位单元。
     （窗5 在这一处反复错了三次：漏乘、多乘、又漏乘；最终由"usedSpan + padUnits = 总容量"与
       "芯片数 × 单片容量 = 总容量"两条独立断言钉死。） */
  const rowUnitsOf = function (ri) {
    const cap = ri < model.romRows ? model.romChipCap : model.ramChipCap;
    const w = ri < model.romRows ? model.romChipW : model.ramChipW;
    return cap * model.cols * (w / model.word);
  };
  let acc = 0;
  for (let ri = 0; ri < model.rows; ri++) {
    const kind = ri < model.romRows ? 'ROM' : 'RAM';
    const span = rowUnitsOf(ri);
    out.push({ ri: ri, from: acc, to: acc + span - 1, kind: kind, span: span });
    acc += span;
  }
  return out;
}

/** 自底向上搭建芯片矩阵（第 0 行 = 最低地址的 ROM 行） */
function _mmChips(model) {
  const list = [];
  for (let ri = 0; ri < model.rows; ri++) {
    const kind = ri < model.romRows ? 'ROM' : 'RAM';
    for (let ci = 0; ci < model.cols; ci++) {
      list.push({
        id: list.length, kind: kind, ri: ri, ci: ci, placed: false, sel: false,
        cap: kind === 'ROM' ? model.romChipCap : model.ramChipCap,
        w: kind === 'ROM' ? model.romChipW : model.ramChipW,
      });
    }
  }
  return list;
}

/* ============================================================================
 * 模块定义
 * ========================================================================== */
RC408.registerModule({
  id: 'coa-mainmem',
  mode: 'stepper',
  title: '主存与 CPU 连接（存储器芯片扩展）',

  theory: `
> **为什么要有它**：单片存储芯片的**单元数**与**字长**都是固定的，而题目要的主存往往两个都不够——所以必须会"拿现成芯片拼出指定容量"。
> **怎么实现**：**位扩展补字长**（数据线分段接、地址线与片选共用）、**字扩展补单元数**（数据线并联、高位地址译码选片），两者可以同时用。
> **记住什么**：三条硬公式（位扩展倍数 / 字扩展倍数 / 芯片总数）+ **MAR 位数只由地址空间大小决定，与实装多少芯片无关**。

## 三条硬公式（考场直接套）
令 **存储单元数 = 总容量 ÷ 存储字长**（按字节编址时字长为 8 位，即单元数 = 字节数）：
- **① 位扩展倍数 = 存储字长 ÷ 单片字长** = 芯片矩阵的**列数**；
- **② 字扩展倍数 = 存储单元数 ÷ 单片单元数** = 芯片矩阵的**行数**；
- **③ 芯片总数 = ① × ②**。
两个前提（不满足则题目无解）：单片单元数必须**整除**存储单元数、单片字长必须**整除**存储字长。

## 地址怎么分（片选译码）
- 存储单元数 N ⟹ 地址线 n = log₂N 位，**MAR 位数 = n**、**MDR 位数 = 存储字长**；
- 字扩展倍数 r ⟹ 高 **k = log₂r** 位经**译码器**产生 r 个片选信号，一次选中一行；
- 剩下 n − k 位是**片内地址**，并联送给所有芯片；行内各列各出一段数据位 → 一个存储字被"横向拼"出来；
- 若题给"ROM 占低地址、其余为 RAM"：行从 0 号开始分配，**第 i 行的地址范围 = [ i·C , (i+1)·C − 1 ]**（C = 行容量 = 单片单元数 × 列数）。

## 考点提醒（易错点）
1. **位扩展与字扩展正好相反**：位扩展是"地址线与片选共用、只有数据线分段"，字扩展是"数据线并联、靠片选区分"——最容易记反；
2. **按字编址 ≠ 按字节编址**：按字编址要先除以字长（2021-15 的 4M **字**不是 4MB）；
3. **MAR 位数只由地址空间大小决定**：2011-15 专考这一点——地址空间 64MB 而只实装 32MB，MAR 仍要 **26 位**；
4. **片内地址位数 = log₂(单片单元数)**，与数据线宽度无关；
5. 容量铺不满时顶部留空洞（本模块用灰色"未用地址区"标出）；
6. 别与相邻考点混淆：DRAM **行 / 列地址复用**（引脚数取半）、**多体交叉编址**（低位选芯片）都不是"芯片扩展"；
7. 真题常以"**逆推**"形式出现：2010-15 问 0B1FH 落在哪一组、2016-16 由 ROM 区 8KB 反推 RAM 要几片、
   2023-15 由 RAM∶ROM = 3∶1 求 ROM 的地址范围。

> **真题考情**：**6/18 年（8 题 = 选 6 + 大题 2）**：选 2009-15、2010-15、2011-15、2016-16、2021-15、2023-15；
> 大 2010-43、2021-43（两题都问 MAR / MDR 位数）。
`,

  /* ---------------- 输入表单（每个 input 都必须显式给 default，见 §3.1-6 / §3.8-11） ---------------- */
  inputs: [
    { key: 'totalK', label: '总容量 / 地址单元数（可写 2^15、32K、32768）', default: '2^15', wide: true,
      help: '按字节编址时 = 地址空间字节数（每个地址 1 个单元），如 2016-16 的 64KB 写 2^16；默认 2^15 = 32K 个单元' },
    { key: 'word', label: '存储器字长（位）', default: '16',
      help: '每个单元的数据位数；MDR 位数 = 本值，MAR 位数只与上方单元数有关' },
    { key: 'romK', label: '其中 ROM 占（单元数，0 表示全为 RAM）', default: '8192',
      help: 'ROM 从**最低地址**开始连续占；剩余全部为 RAM（须能被 RAM 单片容量整除）' },
    { key: 'romChip', label: 'ROM 芯片规格（片容量 × 字长）', default: '2Kx4', wide: true,
      help: '写法 2Kx4 / 8K×8；片容量与字长都必须是 2 的幂，且两种芯片的"位扩展倍数"必须相同' },
    { key: 'ramChip', label: 'RAM 芯片规格（片容量 × 字长）', default: '2Kx4', wide: true,
      help: '写法 4Kx8（= 4K 个单元、每单元 8 位）；没有 RAM 时随便填' },
    { key: 'lookup', label: '地址访问演示（十进制或 0x 十六进制，留空跳过）', default: '0x2000',
      help: '演示"这个地址落在哪一行、片内地址是多少"' },
  ],

  /* ---------------- 预设（冒烟用假 rt 逐个跑通并核对标签承诺，§3.5-15） ---------------- */
  quickActions: [
    {
      label: '🎲 随机规模', run(rt) {
        /* 先定"列（位扩展）× 行（字扩展）"，再反推芯片规格与总容量 —— 保证一定能整除 */
        const chipW = [4, 8, 16][RC408.util.rnd(0, 2)];
        const cols = [1, 2, 4][RC408.util.rnd(0, 2)];
        const rows = [1, 2, 4, 8][RC408.util.rnd(0, 3)];
        const word = chipW * cols;
        const chipUnits = [1024, 2048, 4096][RC408.util.rnd(0, 2)];
        const totalUnits = chipUnits * cols * rows;
        const spec = chipUnits + 'x' + chipW;
        rt.setInput('totalK', String(totalUnits));
        rt.setInput('word', String(word));
        rt.setInput('romK', '0');
        rt.setInput('romChip', spec);
        rt.setInput('ramChip', spec);
        rt.setInput('lookup', String(totalUnits - 1));
        rt.load();
      },
    },
    { label: '📚 字位同时扩展 32K×16 ← 2K×4（默认）', run(rt) {
      rt.setInput('totalK', '2^15'); rt.setInput('word', '16'); rt.setInput('romK', '8192');
      rt.setInput('romChip', '2Kx4'); rt.setInput('ramChip', '2Kx4'); rt.setInput('lookup', '0x2000'); rt.load(); } },
    { label: '📗 2009-15 同款：ROM 8KB 与 RAM 都用 4K×4（4+28 片）', run(rt) {
      rt.setInput('totalK', '2^16'); rt.setInput('word', '8'); rt.setInput('romK', '8192');
      rt.setInput('romChip', '4Kx4'); rt.setInput('ramChip', '4Kx4'); rt.setInput('lookup', '0x0FFF'); rt.load(); } },
    { label: '📘 2010-15：2K×4 → 8K×8，看 0B1FH 落在哪一组', run(rt) {
      rt.setInput('totalK', '8192'); rt.setInput('word', '8'); rt.setInput('romK', '4096');
      rt.setInput('romChip', '2Kx4'); rt.setInput('ramChip', '2Kx4'); rt.setInput('lookup', '0x0B1F'); rt.load(); } },
    { label: '📙 2016-16 同款：ROM 8KB + RAM 56KB，都用 8K×4（8+28 片）', run(rt) {
      rt.setInput('totalK', '2^16'); rt.setInput('word', '8'); rt.setInput('romK', '8192');
      rt.setInput('romChip', '8Kx4'); rt.setInput('ramChip', '8Kx4'); rt.setInput('lookup', '0x5FFF'); rt.load(); } },
    { label: '📕 2021-15：按字编址 4M 字 × 32 位，2M×8 需 8 片', run(rt) {
      rt.setInput('totalK', '2^22'); rt.setInput('word', '32'); rt.setInput('romK', '0');
      rt.setInput('romChip', '2Mx8'); rt.setInput('ramChip', '2Mx8'); rt.setInput('lookup', '0x3FFFFF'); rt.load(); } },
    { label: '🅱 纯位扩展：1K×8 ← 1K×4（数据线分段）', run(rt) {
      rt.setInput('totalK', '1024'); rt.setInput('word', '8'); rt.setInput('romK', '0');
      rt.setInput('romChip', '1Kx4'); rt.setInput('ramChip', '1Kx4'); rt.setInput('lookup', '0x100'); rt.load(); } },
    { label: '🅲 纯字扩展：8K×8 ← 2K×8（高位译码选片）', run(rt) {
      rt.setInput('totalK', '8192'); rt.setInput('word', '8'); rt.setInput('romK', '0');
      rt.setInput('romChip', '2Kx8'); rt.setInput('ramChip', '2Kx8'); rt.setInput('lookup', '0x0800'); rt.load(); } },
    { label: '⚠ 容量铺不满（顶部出现未用地址区）', run(rt) {
      rt.setInput('totalK', '2^14'); rt.setInput('word', '8'); rt.setInput('romK', '0');
      rt.setInput('romChip', '8Kx8'); rt.setInput('ramChip', '8Kx8'); rt.setInput('lookup', '0x2000'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入（纯函数；非法输入一律 throw {message}） ---------------- */
  parse(vals) {
    const S = function (k) { return String(vals[k] === undefined || vals[k] === null ? '' : vals[k]).trim(); };

    /** "2^15" / "32768" / "32K" / "1M"（按字节编址 ⇒ 1K = 1024 个地址单元）→ 数字 */
    const rdUnits = function (raw, what) {
      const t = String(raw).trim();
      if (!t) throw { message: '请填写' + what };
      let m = t.match(/^2\s*\^\s*(\d+)$/);
      if (m) return Math.pow(2, +m[1]);
      m = t.match(/^(\d+(?:\.\d+)?)\s*([KkMm])$/);
      if (m) return Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === 'k' ? 1024 : 1024 * 1024));
      if (!/^\d+$/.test(t)) throw { message: '「' + t + '」不是合法数量：请写十进制整数，或用 2^15 / 32K 这种写法（' + what + '）' };
      return parseInt(t, 10);
    };

    /** "4Kx8" / "4K×8" / "0.5Kx16" / "512x16" / "2^10x8" → { cap, w } */
    const rdChip = function (raw, what) {
      const t = String(raw).replace(/[＊*×xX]/g, 'x').replace(/\s+/g, '');
      const m = t.match(/^(\d+|\d+\.\d+[KkMm]|\d+[KkMm]|2\^\d+)x(\d+)$/);
      if (!m) throw { message: '芯片规格「' + String(raw).trim() + '」格式错误：应写成 片容量×字长，如 4Kx8、2K×4（' + what + '）' };
      const cap = rdUnits(m[1], what + '的片容量');
      const w = parseInt(m[2], 10);
      if (!(w > 0)) throw { message: what + '的字长必须是正整数' };
      if (w > 1024) throw { message: what + '的字长 ' + w + ' 太大（演示上限 1024 位）' };
      if (!_mmIsPow2(cap)) throw { message: what + '的片容量 ' + m[1] + ' 不是 2 的幂（本模块与考题都按 2 的幂核算地址线）' };
      if (!_mmIsPow2(w)) throw { message: what + '的字长 ' + w + ' 不是 2 的幂（数据线要按位分段，必须是 2 的幂）' };
      return { cap: cap, w: w };
    };

    const total = rdUnits(S('totalK'), '总容量（地址单元数）');
    if (total < 8) throw { message: '总容量太小（至少 8 个地址单元，当前 ' + total + '）' };
    if (total > 4194304) {
      throw { message: '总容量 ' + total + ' 超过演示上限 2^22（4M）个单元——再大芯片行数会摆不下；'
        + '这类大题（如 2011-15 的 64MB）请用"MAR 位数 = log₂地址空间"直接口算' };
    }

    const word = parseInt(S('word'), 10);
    if (!/^\d+$/.test(S('word')) || !_mmIsPow2(word)) throw { message: '存储器字长必须是 2 的幂（当前「' + S('word') + '」，如 8 / 16 / 32）' };
    if (word < 2 || word > 256) throw { message: '存储器字长需在 2 ~ 256 位之间（当前 ' + word + '）' };
    const wordBytes = word / 8;                             // 每个地址单元占几个字节

    const rom = rdUnits(S('romK'), 'ROM 容量');
    if (rom < 0) throw { message: 'ROM 容量不能为负数' };
    if (rom > total) throw { message: 'ROM 容量（' + rom + '）不能超过总容量（' + total + '）' };
    if (rom > 0 && !_mmIsPow2(rom)) throw { message: 'ROM 容量必须是 2 的幂（当前 ' + rom + '）——ROM 区总是从 0 号单元起的一段连续区间' };
    const ram = total - rom;

    const rc = rdChip(S('romChip'), 'ROM 芯片');
    const ac = rdChip(S('ramChip'), 'RAM 芯片');

    /* 数据线：列数由芯片字长决定；ROM/RAM 两种芯片必须得到同一个列数 */
    if (word % rc.w !== 0) throw { message: '数据线接不通：存储字长 ' + word + ' 不是 ROM 单片字长 ' + rc.w + ' 的整数倍' };
    if (word % ac.w !== 0) throw { message: '数据线接不通：存储字长 ' + word + ' 不是 RAM 单片字长 ' + ac.w + ' 的整数倍' };
    const cols = word / ac.w;
    if (rom > 0 && word / rc.w !== cols) {
      throw { message: 'ROM 与 RAM 的位扩展倍数不同（ROM ' + (word / rc.w) + ' 列 vs RAM ' + cols + ' 列）：两者拼不成同一条数据线' };
    }

    /*
     * 行数核算**全部按存储单元（地址）算**，不要绕字节：
     *   一行 = 列数 片芯片 → 覆盖 单片单元数 × 列数 × (单片字长 ÷ 存储字长) 个存储单元。
     * 窗5 第一版用"字节容量相除"来算行数，位宽比没约干净，导致 2009-15 这类题行数算错。
     * 记 ratio = 单片字长 ÷ 存储字长（≤ 1），则 行单元容量 = 单片单元数 × cols × ratio。
     */
    const ratioOf = function (w) { return w / word; };
    const rowsOf = function (unitCount, cap, w) {
      const perRow = cap * cols * ratioOf(w);            // 一行的"存储单元"容量
      const need = unitCount / perRow;                   // 需要几行
      if (!Number.isInteger(need)) return null;
      return need;
    };
    let romRows = 0, ramRows = 0;
    if (rom > 0) {
      romRows = rowsOf(rom, rc.cap, rc.w);
      if (romRows === null) {
        throw { message: 'ROM 区 ' + rom + ' 个存储单元，用 ' + _mmSpec(rc.cap, rc.w) + ' 的芯片、按 ' + cols
          + ' 片一行摆，每行只能覆盖 ' + (rc.cap * cols * ratioOf(rc.w)) + ' 个单元，除不尽——请换芯片规格或改 ROM 容量' };
      }
    }
    if (ram > 0) {
      ramRows = rowsOf(ram, ac.cap, ac.w);
      if (ramRows === null) {
        throw { message: 'RAM 区 ' + ram + ' 个存储单元，用 ' + _mmSpec(ac.cap, ac.w) + ' 的芯片、按 ' + cols
          + ' 片一行摆，每行只能覆盖 ' + (ac.cap * cols * ratioOf(ac.w)) + ' 个单元，除不尽——请换芯片规格或改容量' };
      }
    }
    const rows = romRows + ramRows;
    if (rows < 1) throw { message: '至少要放得下一行芯片' };
    if (rows > 32) throw { message: '芯片行数 ' + rows + ' 超过演示上限 32 行（请换更大的单片容量）' };
    if (cols > 16) throw { message: '位扩展倍数 ' + cols + ' 超过演示上限 16 列（请换字长更大的单片）' };

    /* 地址访问演示（可选） */
    let lookup = null;
    const lk = S('lookup');
    const addrBits = _mmAddrBits(total);
    if (lk) {
      let v = null;
      if (/^0x[0-9a-fA-F]+$/.test(lk)) v = parseInt(lk.slice(2), 16);
      else if (/^\d+$/.test(lk)) v = parseInt(lk, 10);
      if (v === null) throw { message: '要演示的地址「' + lk + '」不是合法数值：写十进制或 0x 十六进制' };
      if (v >= total) throw { message: '要演示的地址 ' + lk + ' 超出了地址空间（0x0 ~ ' + _mmHex(total - 1, addrBits) + '）' };
      lookup = v;
    }

    return {
      total: total, word: word, wordBytes: wordBytes, rom: rom, ram: ram, addrBits: addrBits,
      romChipCap: rc.cap, romChipW: rc.w, ramChipCap: ac.cap, ramChipW: ac.w,
      cols: cols, romRows: romRows, ramRows: ramRows, rows: rows,
      chips: rows * cols, lookup: lookup,
    };
  },

  /* ---------------- ② 纯算法：逐动作产出快照（零 DOM） ---------------- */
  buildSnapshots(model) {
    const geo = _mmGeo(model);
    const bits = _mmBits(model);
    const rowsDef = _mmRows(model);
    const chips = _mmChips(model);
    const usedSpan = rowsDef.reduce(function (a, r) { return a + r.span; }, 0);
    const padUnits = model.total - usedSpan;                       // 顶部没有芯片覆盖的单元数
    const selBits = model.rows > 1 ? _mmBind(model.rows) : 0;      // 片选位数（行数为 1 时不需要译码）
    const innerBits = model.addrBits - selBits;                    // 片内地址位数
    const rowUnitsOf = function (ri) {
      const cap = ri < model.romRows ? model.romChipCap : model.ramChipCap;
      const w = ri < model.romRows ? model.romChipW : model.ramChipW;
      return cap * model.cols * (w / model.word);
    };

    /* 地址 → 命中哪一行 + 片内地址（纯函数，自检与 probe 都用它） */
    const hit = function (addr) {
      for (let i = 0; i < rowsDef.length; i++) {
        const r = rowsDef[i];
        if (addr >= r.from && addr <= r.to) {
          return { ri: r.ri, kind: r.kind, offset: addr - r.from, rowOff: addr - r.from };
        }
      }
      return null;
    };

    const placed = [];
    let curChip = null, newIds = [];
    const snaps = [];
    const mk = function (step, o) {
      o = o || {};
      snaps.push({
        step: step, geo: geo, model: model,
        chips: chips.map(function (c) { return { id: c.id, kind: c.kind, ri: c.ri, ci: c.ci, placed: c.placed, sel: c.sel, cap: c.cap, w: c.w }; }),
        placed: placed.slice(), newIds: newIds.slice(), curChip: curChip,
        bits: bits, rows: rowsDef,
        selBits: selBits, innerBits: innerBits, padUnits: padUnits, usedSpan: usedSpan,
        probe: o.probe || null,
        matched: o.matched === undefined ? 0 : o.matched,
        expChips: chips.length,
        W: geo.W, H: geo.H,
        desc: o.desc || '', log: o.log || '', logType: o.logType || 'info',
      });
    };

    /* ---------- 第 0 帧：就绪 ---------- */
    const chipDesc = [];
    if (model.romRows) chipDesc.push(_mmSpec(model.romChipCap, model.romChipW) + ' 的 ROM');
    if (model.ramRows) chipDesc.push(_mmSpec(model.ramChipCap, model.ramChipW) + ' 的 RAM');
    mk('init', {
      desc: '就绪：存储单元数 ' + model.total + ' 个 × 字长 ' + model.word + ' 位（总容量 ' + _mmBytes(model.total * model.wordBytes)
        + '），地址线 ' + model.addrBits + ' 位，地址范围 ' + _mmRange(0, model.total - 1, model.addrBits) + '。'
        + '要用 ' + chipDesc.join(' 与 ') + ' 拼出全部单元。先看数据线要分几段（位扩展）、地址要分几行（字扩展）。',
      log: '就绪：' + model.total + ' 单元 × ' + model.word + ' 位，地址线 ' + model.addrBits + ' 位', logType: 'info',
    });

    /* ---------- 逐片摆放：行优先（每行自左向右），行 = 字扩展、列 = 位扩展 ---------- */
    chips.forEach(function (c) {
      curChip = c.id;
      c.placed = true;
      placed.push(c.id);
      newIds = [c.id];
      const r = rowsDef[c.ri];
      const u = rowUnitsOf(c.ri);
      mk('place', {
        desc: '摆第 ' + (c.ri + 1) + ' 行第 ' + (c.ci + 1) + ' 列：' + c.kind + ' 芯片 ' + _mmSpec(c.cap, c.w) + '。'
          + '它负责**数据线的 ' + bits[c.ci].text + '**（位扩展第 ' + (c.ci + 1) + '/' + model.cols + ' 列），'
          + '片内地址 ' + _mmHex(c.ci * u, innerBits) + ' ~ ' + _mmHex(c.ci * u + u - 1, innerBits)
          + '；所属行的地址区间是 ' + _mmRange(r.from, r.to, model.addrBits) + '。',
        log: '摆放 ' + c.kind + ' 芯片 #' + (c.id + 1) + '（第 ' + (c.ri + 1) + ' 行第 ' + (c.ci + 1) + ' 列）',
        logType: 'info',
      });
    });
    curChip = null;
    newIds = [];

    /* ---------- 数据线（位扩展） ---------- */
    const chipW = model.ramRows ? model.ramChipW : model.romChipW;
    mk('data', {
      desc: '数据线连接（位扩展）：存储字长 ' + model.word + ' 位 ÷ 单片字长 ' + chipW + ' 位 = **' + model.cols
        + ' 列**，所以每行摆 ' + model.cols + ' 片，每片只接一段数据线：'
        + bits.map(function (b) { return '第 ' + (b.c + 1) + ' 列 → ' + b.text; }).join('；')
        + '。注意**所有列共用同一组地址线**——这正是位扩展与字扩展最大的区别。',
      log: '数据线：' + model.word + ' ÷ ' + chipW + ' = ' + model.cols + ' 段', logType: 'success',
    });

    /* ---------- 地址线 + 片内地址 ---------- */
    mk('addr', {
      desc: '地址线连接：地址线共 ' + model.addrBits + ' 位。'
        + (model.rows > 1
          ? '芯片矩阵有 ' + model.rows + ' 行（字扩展倍数 = 存储单元数 ' + model.total + ' ÷ 单片单元数 × 列数），'
            + '需要 **' + selBits + ' 位高位地址**（A' + (model.addrBits - 1) + '~A' + innerBits + '）去译码产生片选；'
            + '剩下 **' + innerBits + ' 位是片内地址**（A' + (innerBits - 1) + '~A0），并联送给所有芯片——'
            + '同一行里的芯片是"同时被选中"的。'
          : '只有 1 行芯片（片选恒有效），全部 ' + model.addrBits + ' 位都是片内地址。'),
      log: '地址线：' + (model.rows > 1 ? selBits + ' 位片选 + ' : '') + innerBits + ' 位片内地址', logType: 'success',
    });

    /* ---------- 译码器 ---------- */
    mk('decode', {
      desc: model.rows > 1
        ? '译码器：把 **A' + (model.addrBits - 1) + '~A' + innerBits + '（' + selBits + ' 位）**送进 ' + selBits + ' 线—'
          + model.rows + ' 线译码器，输出 ' + model.rows + ' 个**片选信号** CS0 ~ CS' + (model.rows - 1) + '。'
          + '任一时刻只有一行为有效电平 ⟹ 任一时刻只有一行的芯片被选中。'
          + '于是"选芯片"与"选片内单元"彻底分开：**高位选片、低位选单元**。'
        : '只有一行芯片，不需要译码器（片选直接接有效电平）。',
      log: model.rows > 1 ? '译码器：' + selBits + ' 线—' + model.rows + ' 线' : '单行芯片：无需译码', logType: 'info',
    });

    /* ---------- 逐行点亮片选 ---------- */
    rowsDef.forEach(function (r) {
      chips.forEach(function (c) { c.sel = (c.ri === r.ri); });
      const u = rowUnitsOf(r.ri);
      mk('cs', {
        desc: '片选 CS' + r.ri + ' 有效 → 选中第 ' + (r.ri + 1) + ' 行：这一行的 ' + model.cols + ' 片芯片**同时工作**，'
          + '各自贡献 ' + (r.kind === 'ROM' ? model.romChipW : model.ramChipW) + ' 位，拼成一个 ' + model.word + ' 位的存储字。'
          + '该行负责的地址区间 = **' + _mmRange(r.from, r.to, model.addrBits) + '**（' + r.span + ' 个单元，每片 '
          + u + ' 个单元）。'
          + (model.romRows && model.ramRows
            ? (r.ri === model.romRows - 1 ? '这是 ROM 的最后一行，往上就进入 RAM 区。'
              : (r.ri === model.romRows ? '从这一行起是 RAM 区（ROM 共占 ' + model.rom + ' 个单元）。' : ''))
            : ''),
        log: '片选 CS' + r.ri + '（第 ' + (r.ri + 1) + ' 行，' + r.kind + '）→ ' + _mmRange(r.from, r.to, model.addrBits),
        logType: 'info',
      });
    });
    chips.forEach(function (c) { c.sel = false; });

    /* ---------- 自检：逐地址验证"唯一命中" ---------- */
    let matched = 0;
    for (let a = 0; a < model.total; a++) { if (hit(a) !== null) matched++; }
    mk('check', {
      matched: matched,
      desc: '自检：把**每一个地址**都代进"高位选片 + 低位选单元"的规则：'
        + (padUnits > 0
          ? '有 ' + matched + ' 个地址能唯一命中芯片，顶上还有 **' + padUnits + ' 个单元**（'
            + _mmRange(usedSpan, model.total - 1, model.addrBits) + '）**没有芯片覆盖**——芯片按行整块铺开，铺不满就会出现空洞。'
            + '常见于"只给容量不给芯片"的题：**MAR 位数由地址空间大小决定，与实际装了多少芯片无关**（2011-15）。'
          : '全部 ' + model.total + ' 个地址都**唯一命中**某一片芯片，无重叠、无空洞 ✓')
        + ' 芯片总数 = 字扩展行数 ' + model.rows + ' × 位扩展列数 ' + model.cols + ' = **' + chips.length + ' 片**（与公式③一致）。',
      log: '自检：命中 ' + matched + '/' + model.total + ' 个地址' + (padUnits > 0 ? '，未覆盖 ' + padUnits + ' 个' : '（无空洞 ✓）'),
      logType: padUnits > 0 ? 'warn' : 'success',
    });

    /* ---------- 地址访问演示（可选） ---------- */
    if (model.lookup !== null) {
      const h = hit(model.lookup);
      mk('probe', {
        probe: h ? { addr: model.lookup, ri: h.ri, kind: h.kind, sel: h.ri, offset: h.offset } : null,
        desc: h
          ? '地址访问演示：地址 ' + _mmHex(model.lookup, model.addrBits) + '（= ' + model.lookup + '）。高位 A'
            + (model.addrBits - 1) + '~A' + innerBits + ' 译码后选中**第 ' + (h.ri + 1) + ' 行（CS' + h.ri + '，' + h.kind + '）**；'
            + '片内地址 = ' + _mmHex(h.offset, innerBits) + '（该行第 ' + h.offset + ' 个单元）。'
            + '该行的 ' + model.cols + ' 片芯片同时响应，合计送出 ' + model.word + ' 位数据。'
          : '地址访问演示：地址 ' + _mmHex(model.lookup, model.addrBits) + ' **落在未用地址区**（顶部没有芯片覆盖）。'
            + '实际机器不允许出现这种地址——地址空间的上限由 MAR 位数决定，而 MAR 位数只看**地址空间大小**。',
        log: '地址 ' + _mmHex(model.lookup, model.addrBits)
          + (h ? ' → 第 ' + (h.ri + 1) + ' 行（' + h.kind + '），片内 ' + _mmHex(h.offset, innerBits) : ' → 未用地址区'),
        logType: h ? 'success' : 'warn',
      });
    }

    /* ---------- 收尾 ---------- */
    mk('done', {
      matched: matched,
      desc: '完成：共 ' + chips.length + ' 片芯片（' + (model.romRows ? 'ROM ' + (model.romRows * model.cols) + ' 片 + ' : '')
        + 'RAM ' + (model.ramRows * model.cols) + ' 片）；地址线 ' + model.addrBits + ' 位（MAR ' + model.addrBits
        + ' 位）、数据线 ' + model.word + ' 位（MDR ' + model.word + ' 位）。'
        + '结论：**位扩展看数据线（列）、字扩展看地址高位（行）**；位扩展时地址线与片选共用、字扩展时数据线并联。'
        + (padUnits > 0 ? '本配置顶部有 ' + padUnits + ' 个单元无芯片覆盖（题目只给容量时属正常情形）。' : ''),
      log: '完成：' + chips.length + ' 片芯片，MAR ' + model.addrBits + ' 位 / MDR ' + model.word + ' 位', logType: 'success',
    });

    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照） ---------------- */
  render(ctx) {
    const s = ctx.snap, model = ctx.model, stage = ctx.stage;
    const geo = s.geo, bits = s.bits, rowsDef = s.rows, chips = s.chips;
    const rowCount = model.rows;      // ⚠ 不能写 s.rows —— 那是"行区间数组"（窗5 踩过：渲染成 [object Object]）
    const addrBits = model.addrBits;
    const selBits = s.selBits, innerBits = s.innerBits;
    const css = [];

    const rowOf = function (ri) {
      for (let i = 0; i < rowsDef.length; i++) { if (rowsDef[i].ri === ri) return rowsDef[i]; }
      return null;
    };
    const rowUnitsOf = function (ri) {
      const cap = ri < model.romRows ? model.romChipCap : model.ramChipCap;
      const w = ri < model.romRows ? model.romChipW : model.ramChipW;
      return cap * model.cols * (w / model.word);
    };

    /* ---------- 地址总线（竖直，画在芯片矩阵左侧） ---------- */
    const busTop = geo.matY - 18;
    const busBot = geo.matY + (geo.rows - 1) * geo.gy + geo.chipH + 16;
    const addrOn = s.step !== 'init';
    let busSvg = '<path class="mm-bus" d="M ' + _mmBusX + ' ' + busTop + ' L ' + _mmBusX + ' ' + busBot
      + '" fill="none" stroke="#cbd5e1" stroke-width="6" stroke-linecap="round"/>';
    for (let ri = 0; ri < geo.rows; ri++) {
      const y = geo.matY + ri * geo.gy + geo.chipH / 2;
      const selRow = chips[ri * model.cols] && chips[ri * model.cols].sel;
      const col = !addrOn ? '#e2e8f0' : (selRow ? '#6366f1' : '#a5b4fc');
      busSvg += '<path class="mm-addrline" d="M ' + _mmBusX + ' ' + y + ' L ' + (geo.matX - 10) + ' ' + y
        + '" fill="none" stroke="' + col + '" stroke-width="' + (addrOn ? 2.2 : 2) + '"'
        + (addrOn ? '' : ' stroke-dasharray="4 4"') + '/>';
    }
    busSvg += '<text x="' + (_mmBusX - 10) + '" y="' + (busTop - 4) + '" text-anchor="end" style="font:800 11px Consolas,ui-monospace,monospace;fill:#6366f1">A' + (addrBits - 1) + '</text>';
    busSvg += '<text x="' + (_mmBusX - 10) + '" y="' + (busBot + 12) + '" text-anchor="end" style="font:800 11px Consolas,ui-monospace,monospace;fill:#6366f1">A0</text>';
    busSvg += '<text class="mm-bus-label" x="' + _mmBusX + '" y="' + (busTop - 12) + '" text-anchor="middle" style="font:800 11px ui-sans-serif,system-ui;fill:#4338ca">地址线 ' + addrBits + ' 位</text>';
    if (selBits > 0 && addrOn) {
      const selHiY = busTop - 2, selLoY = busTop + Math.min(46, Math.max(24, 140 / Math.max(1, geo.rows)));
      busSvg += '<path d="M ' + _mmBusX + ' ' + selHiY + ' L ' + (geo.matX - 52) + ' ' + selHiY + '" fill="none" stroke="#6366f1" stroke-width="2.6"/>';
      busSvg += '<path d="M ' + _mmBusX + ' ' + selLoY + ' L ' + (geo.matX - 52) + ' ' + selLoY + '" fill="none" stroke="#6366f1" stroke-width="2.6"/>';
      busSvg += '<text x="' + (geo.matX - 56) + '" y="' + ((selHiY + selLoY) / 2 + 4) + '" text-anchor="end" style="font:800 11px Consolas,ui-monospace,monospace;fill:#4338ca">A' + (addrBits - 1) + '~A' + innerBits + '</text>';
    }

    /* ---------- 各行右侧的地址范围（拆两行，避免文字横向压到下一列的芯片） ---------- */
    let rowSvg = '';
    for (let ri = 0; ri < geo.rows; ri++) {
      const r = rowOf(ri);
      if (!r) continue;
      const slot = _mmSlot(geo, 0, ri);
      const selRow = chips[ri * model.cols] && chips[ri * model.cols].sel;
      const lx = slot.x + geo.chipW + 8;
      const ly = slot.y + geo.chipH / 2 - 2;
      rowSvg += '<text class="mm-rowlabel" x="' + lx + '" y="' + ly
        + '" style="font:800 11px ui-sans-serif,system-ui;fill:' + (selRow ? '#b45309' : '#334155') + '">CS'
        + ri + '</text>';
      rowSvg += '<text class="mm-rowlabel" x="' + lx + '" y="' + (ly + 14)
        + '" style="font:700 11px Consolas,ui-monospace,monospace;fill:' + (selRow ? '#b45309' : '#64748b') + '">'
        + _mmRange(r.from, r.to, addrBits) + '</text>';
    }

    /* ---------- 芯片矩阵 + 每片的数据线段 ---------- */
    let chipSvg = '';
    chips.forEach(function (c) {
      const slot = _mmSlot(geo, c.ci, c.ri);
      let anim = '';
      if (c.placed && s.newIds.indexOf(c.id) >= 0) {
        css.push(_mmKF('_mmC' + c.id, 0, 26));
        anim = ' style="animation:_mmC' + c.id + ' ' + _mmDur + ' ' + _mmEase + ' both"';
      }
      const on = c.placed, sel = c.sel;
      const fill = !on ? '#f8fafc' : sel ? '#fef3c7' : (c.kind === 'ROM' ? '#dbeafe' : '#dcfce7');
      const stroke = !on ? '#cbd5e1' : sel ? '#f59e0b' : (c.kind === 'ROM' ? '#3b82f6' : '#22c55e');
      const tcol = !on ? '#94a3b8' : '#1e293b';
      chipSvg += '<g transform="translate(' + slot.x + ',' + slot.y + ')"' + anim + '>'
        + '<rect class="mm-chip" x="0" y="0" width="' + geo.chipW + '" height="' + geo.chipH + '" rx="9" fill="' + fill
        + '" stroke="' + stroke + '" stroke-width="' + (on ? 2.6 : 1.6) + '"' + (on ? '' : ' stroke-dasharray="5 4"') + '/>'
        + '<text class="mm-chip-spec" x="' + (geo.chipW / 2) + '" y="20" text-anchor="middle" style="font:800 11px Consolas,ui-monospace,monospace;fill:' + tcol + '">' + _mmSpec(c.cap, c.w) + '</text>'
        + '<text class="mm-chip-bits" x="' + (geo.chipW / 2) + '" y="33" text-anchor="middle" style="font:700 9.5px Consolas,ui-monospace,monospace;fill:' + (on ? '#475569' : '#cbd5e1') + '">' + bits[c.ci].text + '</text>'
        + '<text x="' + (geo.chipW / 2) + '" y="47" text-anchor="middle" style="font:700 9px ui-sans-serif,system-ui;fill:' + (on ? '#64748b' : '#cbd5e1') + '">' + c.kind + ' #' + (c.id + 1) + '</text>'
        + '</g>';
      if (on) {
        const dx = geo.matX + geo.cols * geo.gx + 8;
        chipSvg += '<path class="mm-dataline" d="M ' + (slot.x + geo.chipW) + ' ' + (slot.y + geo.chipH / 2) + ' L ' + dx + ' '
          + (slot.y + geo.chipH / 2) + '" fill="none" stroke="#f472b6" stroke-width="1.8" stroke-dasharray="5 4"/>';
      }
    });

    /* ---------- 数据总线（竖直汇总） ---------- */
    const dbx = geo.matX + geo.cols * geo.gx + 8;
    const dby0 = geo.matY + geo.chipH / 2, dby1 = geo.matY + (geo.rows - 1) * geo.gy + geo.chipH / 2;
    const dOn = s.step !== 'init' && s.step !== 'place';
    chipSvg += '<path class="mm-bus-data" d="M ' + dbx + ' ' + (dby0 - 14) + ' L ' + dbx + ' ' + (dby1 + 14)
      + '" fill="none" stroke="' + (dOn ? '#ec4899' : '#fbcfe8') + '" stroke-width="5" stroke-linecap="round"/>';
    if (dby1 > dby0) {
      chipSvg += '<text class="mm-bus-label" x="' + (dbx + 8) + '" y="' + (dby0 - 20) + '" style="font:800 11px ui-sans-serif,system-ui;fill:#be185d">数据线 ' + model.word + ' 位</text>';
    } else {
      chipSvg += '<text class="mm-bus-label" x="' + (dbx + 8) + '" y="' + (dby0 - 8) + '" style="font:800 11px ui-sans-serif,system-ui;fill:#be185d">数据线 ' + model.word + ' 位</text>';
    }

    /* ---------- 译码器 + 片选线 ---------- */
    const decY = geo.decY;
    const decX = _mmMatX + 40;
    /* 译码器宽度不要越过芯片矩阵最后一列（否则会伸到数据线标注下面） */
    const decW = Math.max(320, Math.min(geo.W - decX - 40, geo.cols * geo.gx + geo.chipW - 20));
    const decOn = s.step === 'decode' || s.step === 'cs' || s.step === 'probe' || s.step === 'check' || s.step === 'done';
    let decSvg = '';
    /* 片选线从译码器输出走到每行左端；竖直干线走在总线与芯片之间（x = matX−22），别压芯片框 */
    const selSpineX = _mmMatX - 22;
    for (let ri = 0; ri < rowCount; ri++) {
      const slot = _mmSlot(geo, 0, ri);
      const on = decOn && chips[ri * model.cols] && chips[ri * model.cols].sel;
      const py = slot.y + geo.chipH / 2;
      decSvg += '<path class="mm-selline" d="M ' + (decX + 20) + ' ' + (decY + 16) + ' L ' + (decX + 20) + ' ' + (decY + 28)
        + ' L ' + selSpineX + ' ' + (decY + 28) + ' L ' + selSpineX + ' ' + py + ' L ' + (slot.x - 8) + ' ' + py
        + '" fill="none" stroke="' + (on ? '#f59e0b' : '#e2e8f0') + '" stroke-width="' + (on ? 3 : 1.6) + '"'
        + (on ? '' : ' stroke-dasharray="4 4"') + '/>';
    }
    if (selBits > 0) {
      decSvg += '<rect class="mm-dec" x="' + decX + '" y="' + (decY - 16) + '" width="' + decW + '" height="32" rx="8" fill="#eef2ff" stroke="#6366f1" stroke-width="2"/>';
      decSvg += '<text class="mm-dec-label" x="' + (decX + decW / 2) + '" y="' + (decY + 4) + '" text-anchor="middle" style="font:800 12px ui-sans-serif,system-ui;fill:#4338ca">'
        + selBits + ' 线 — ' + rowCount + ' 线译码器（输入 A' + (addrBits - 1) + '~A' + innerBits + '）</text>';
      for (let ri = 0; ri < rowCount; ri++) {
        const px = decX + 22 + (decW - 44) * (rowCount === 1 ? 0.5 : ri / (rowCount - 1));
        decSvg += '<circle class="mm-dec-pin" cx="' + px + '" cy="' + (decY + 22) + '" r="3.2" fill="'
          + (decOn && chips[ri * model.cols] && chips[ri * model.cols].sel ? '#f59e0b' : '#c7d2fe') + '"/>';
      }
    } else {
      decSvg += '<text class="mm-dec-label" x="' + decX + '" y="' + (decY + 4) + '" style="font:800 11px ui-sans-serif,system-ui;fill:#64748b">只有 1 行芯片 → 不需要译码器（片选恒有效）</text>';
    }

    /* ---------- 地址空间表：一"块"代表一组连续地址 ---------- */
    const tblTop = geo.tblTop, rowH = geo.rowH;
    const colX = [geo.matX - 60, geo.matX + 120, geo.matX + 246, geo.matX + 344];
    const rowW = Math.min(geo.W - colX[0] - 16, 700);
    let tblSvg = '';
    tblSvg += '<text class="mm-tbl-head" x="' + colX[0] + '" y="' + (tblTop - 8) + '" style="font:800 11.5px ui-sans-serif,system-ui;fill:#475569">设备类型</text>';
    tblSvg += '<text class="mm-tbl-head" x="' + colX[1] + '" y="' + (tblTop - 8) + '" style="font:800 11.5px ui-sans-serif,system-ui;fill:#475569">地址范围（片内地址全 0 ~ 全 1）</text>';
    tblSvg += '<text class="mm-tbl-head" x="' + colX[2] + '" y="' + (tblTop - 8) + '" style="font:800 11.5px ui-sans-serif,system-ui;fill:#475569">容量</text>';
    tblSvg += '<text class="mm-tbl-head" x="' + colX[3] + '" y="' + (tblTop - 8) + '" style="font:800 11.5px ui-sans-serif,system-ui;fill:#475569">片选 / 芯片构成</text>';

    let ty = tblTop, acc = 0;
    const nRows = rowsDef.length;
    const blockH = 19;
    const drawBlock = function (kindText, rangeText, capText, compText, fill, stroke, hi) {
      tblSvg += '<rect class="mm-tbl-row" x="' + colX[0] + '" y="' + ty + '" width="' + rowW + '" height="' + blockH
        + '" rx="5" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (hi ? 2.2 : 1.2) + '"/>'
        + '<text x="' + (colX[0] + 8) + '" y="' + (ty + 13.5) + '" style="font:800 10.5px ui-sans-serif,system-ui;fill:#334155">' + kindText + '</text>'
        + '<text x="' + colX[1] + '" y="' + (ty + 13.5) + '" style="font:800 10.5px Consolas,ui-monospace,monospace;fill:#334155">' + rangeText + '</text>'
        + '<text x="' + colX[2] + '" y="' + (ty + 13.5) + '" style="font:800 10.5px Consolas,ui-monospace,monospace;fill:#334155">' + capText + '</text>'
        + '<text x="' + colX[3] + '" y="' + (ty + 13.5) + '" style="font:800 10.5px Consolas,ui-monospace,monospace;fill:' + (hi ? '#b45309' : '#475569') + '">' + compText + '</text>';
      ty += blockH + 2;
    };
    /* 顶部未用地址区（画满剩余高度） */
    if (s.padUnits > 0) {
      const restH = Math.max(30, rowH - (nRows * (blockH + 2)) - 8);
      const hi = s.probe === null && s.step !== 'init';
      tblSvg += '<rect class="mm-tbl-pad" x="' + colX[0] + '" y="' + ty + '" width="' + rowW + '" height="' + restH
        + '" rx="6" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.4" stroke-dasharray="6 4"/>'
        + '<text x="' + (colX[0] + 8) + '" y="' + (ty + 16) + '" style="font:800 11px ui-sans-serif,system-ui;fill:#64748b">未用地址区（无芯片覆盖）</text>'
        + '<text x="' + colX[1] + '" y="' + (ty + 16) + '" style="font:800 10.5px Consolas,ui-monospace,monospace;fill:#64748b">' + _mmRange(s.usedSpan, model.total - 1, addrBits) + '</text>'
        + '<text x="' + colX[2] + '" y="' + (ty + 16) + '" style="font:800 10.5px Consolas,ui-monospace,monospace;fill:#64748b">' + s.padUnits + ' 单元</text>'
        + '<text x="' + colX[3] + '" y="' + (ty + 16) + '" style="font:800 10.5px ui-sans-serif,system-ui;fill:#64748b">MAR ' + addrBits + ' 位（看地址空间，不看实装）</text>';
    }
    const restAfterPad = 0;   // 画布高度按内容算（_mmGeo 的 rowH），不再留空白填充
    rowsDef.forEach(function (r) {
      const hi = !!(s.probe && s.probe.ri === r.ri) || (chips[r.ri * model.cols] && chips[r.ri * model.cols].sel);
      const kw = r.kind === 'ROM' ? model.romChipCap : model.ramChipCap;
      const ww = r.kind === 'ROM' ? model.romChipW : model.ramChipW;
      drawBlock(r.kind === 'ROM' ? 'ROM（只读）' : 'RAM（读写）',
        _mmRange(r.from, r.to, addrBits), r.span + ' 单元',
        'CS' + r.ri + (model.cols > 1 ? '｜' + model.cols + ' 片并联' : '｜单片')
          + (s.probe && s.probe.ri === r.ri ? '｜← 命中' : ''),
        hi ? '#fef3c7' : (r.kind === 'ROM' ? '#dbeafe' : '#dcfce7'),
        hi ? '#f59e0b' : (r.kind === 'ROM' ? '#3b82f6' : '#22c55e'), hi);
      acc += r.span;
    });
    /* 底部填白（表区高度固定，避免下方留白过乱） */
    if (restAfterPad > 0) {
      tblSvg += '<rect x="' + colX[0] + '" y="' + ty + '" width="' + rowW + '" height="' + restAfterPad + '" rx="6" fill="#fbfdff" stroke="#e2e8f0" stroke-width="1"/>';
    }

    /* ---------- 统计卡 ---------- */
    const stats =
      RC408.ui.statCard('存储单元数 / 字长', model.total + ' 个 × ' + model.word + ' 位',
        '总容量 ' + _mmBytes(model.total * model.wordBytes) + ' = ' + model.total + ' 单元 × ' + model.word + ' 位；按字节编址时单元数 = 字节数')
      + RC408.ui.statCard('地址线 / MAR', addrBits + ' 位 = log₂' + model.total,
        _mmRange(0, model.total - 1, addrBits) + '；MDR = ' + model.word + ' 位', 'text-indigo-600')
      + RC408.ui.statCard('芯片总数', String(model.chips),
        '字扩展 ' + rowCount + ' 行 × 位扩展 ' + model.cols + ' 列（' + _mmSpec(model.ramChipCap, model.ramChipW) + '）', 'text-emerald-600')
      + RC408.ui.statCard('片选 / 片内地址', selBits + ' 位 / ' + innerBits + ' 位',
        selBits > 0 ? 'A' + (addrBits - 1) + '~A' + innerBits + ' 译码选片；A' + (innerBits - 1) + '~A0 选片内单元'
          : '单行芯片，全部地址都是片内地址', 'text-amber-600');

    /* ---------- 公式推导 ---------- */
    const chipW = model.ramRows ? model.ramChipW : model.romChipW;
    const chipU = model.ramRows ? model.ramChipCap : model.romChipCap;
    const formulas = [
      '① 位扩展倍数 = 存储字长 ÷ 单片字长 = ' + model.word + ' ÷ ' + chipW + ' = **' + model.cols + ' 列**',
      '② 字扩展倍数 = 芯片总数 ÷ 列数 = ' + model.chips + ' ÷ ' + model.cols + ' = **' + rowCount + ' 行**',
      '   （芯片总数 = 总容量 ÷ 单片容量 = ' + _mmBytes(model.total * model.wordBytes) + ' ÷ ' + _mmBytes(chipU * chipW / 8)
        + ' = ' + (model.total * model.wordBytes / (chipU * chipW / 8)) + ' 片）',
      '③ 芯片总数 = ① × ② = ' + model.cols + ' × ' + rowCount + ' = **' + model.chips + ' 片**',
      '④ 地址线 = log₂' + model.total + ' = **' + addrBits + ' 位**（MAR）'
        + (rowCount > 1 ? '；其中高位 ' + selBits + ' 位选片、低位 ' + innerBits + ' 位选片内单元' : ''),
    ];

    /* ---------- 芯片一览 ---------- */
    const chipChips = chips.map(function (c) {
      const on = c.placed, sel = c.sel;
      const r = rowOf(c.ri);
      return RC408.ui.chip('#' + (c.id + 1) + ' ' + _mmSpec(c.cap, c.w) + ' ' + c.kind,
        !on ? 'chip-future' : sel ? 'chip-check' : (c.kind === 'ROM' ? 'chip-cur' : 'chip-mst'),
        on ? ('第 ' + (c.ri + 1) + ' 行 / 第 ' + (c.ci + 1) + ' 列 ｜ 数据线 ' + bits[c.ci].text + ' ｜ 该行地址 ' + _mmRange(r.from, r.to, addrBits))
          : '尚未摆放');
    });

    /* ---------- 提示条 ---------- */
    let tip;
    if (s.step === 'init') {
      tip = '<div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">'
        + '预计需要 <b>' + model.cols + ' 列</b>（数据线分段：' + model.word + ' ÷ ' + chipW + '）与 <b>' + rowCount
        + ' 行</b>（地址分块：' + model.total + ' ÷ (' + chipU + ' × ' + model.cols + ')）芯片。'
        + '点「单步」逐片摆放，然后接数据线、地址线与译码器。<b>位扩展看数据线（列），字扩展看地址高位（行）</b>。</div>';
    } else if (s.step === 'probe' && s.probe) {
      tip = '<div class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">'
        + '地址 <b>' + _mmHex(s.probe.addr, addrBits) + '</b> 的访问路径：高位译码 → <b>CS' + s.probe.sel + '（第 '
        + (s.probe.ri + 1) + ' 行，' + s.probe.kind + '）</b> → 片内地址 <b>' + _mmHex(s.probe.offset, innerBits)
        + '</b> → 该行 ' + model.cols + ' 片同时读出 ' + model.word + ' 位。</div>';
    } else if (s.padUnits > 0) {
      tip = '<div class="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">'
        + '⚠ 有 <b>' + s.padUnits + ' 个单元</b>（' + _mmRange(s.usedSpan, model.total - 1, addrBits)
        + '）<b>没有芯片覆盖</b>：芯片按"行"整块铺开，铺不满时顶部出现空洞。'
        + '这类题（如 2011-15：地址空间 64MB、实装 32MB）问的是 <b>MAR 位数</b>——它由<b>地址空间大小</b>决定，与实装多少芯片无关。</div>';
    } else {
      tip = '<div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">'
        + '✓ 全部 ' + model.total + ' 个地址都被芯片覆盖，且每个地址<b>唯一命中</b>一行（无重叠、无空洞）。'
        + '选中一行时该行 ' + model.cols + ' 片芯片<b>同时</b>工作，各送出一段数据位，拼成一个 ' + model.word + ' 位的存储字。</div>';
    }

    /* ---------- 图例 ---------- */
    const legend = RC408.ui.legend('#3b82f6', 'ROM 芯片（只读）')
      + RC408.ui.legend('#22c55e', 'RAM 芯片（读写）')
      + RC408.ui.legend('#f59e0b', '本帧被选中的整行（片选有效）')
      + RC408.ui.legend('#6366f1', '地址线 A' + (addrBits - 1) + '~A0（位扩展时各列共用）')
      + RC408.ui.legend('#ec4899', '数据线分段（第 c 列芯片各接一段）')
      + RC408.ui.legend('#94a3b8', '虚线 = 未摆放的芯片位置 / 未用地址区');

    const svg = '<svg viewBox="0 0 ' + geo.W + ' ' + geo.H + '" class="w-full h-auto mx-auto" style="max-width:'
      + Math.max(geo.W, 620) + 'px">' + busSvg + rowSvg + decSvg + chipSvg + tblSvg + '</svg>';

    stage.innerHTML =
      '<div class="space-y-4">'
      + '<style>' + css.join('') + '</style>'
      + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' + stats + '</div>'
      + tip
      + '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">'
      + svg
      + '<div class="text-[11px] text-slate-400 text-center mt-1">左：地址总线 → 芯片矩阵（行 = 字扩展，列 = 位扩展）；'
      + (selBits > 0 ? '中下：' + selBits + ' 线—' + rowCount + ' 线译码器；' : '') + '底部：地址空间分区表</div>'
      + '</div>'
      + '<div>' + RC408.ui.sectionTitle('三条硬公式（本配置的代入过程）') + '</div>'
      + '<div class="rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-mono text-slate-700 leading-relaxed">'
      + formulas.join('<br>') + '</div>'
      + '<div>' + RC408.ui.sectionTitle('芯片一览（共 ' + model.chips + ' 片：'
        + (model.romRows ? 'ROM ' + (model.romRows * model.cols) + ' 片' : '无 ROM')
        + '，RAM ' + (model.ramRows * model.cols) + ' 片）') + '</div>'
      + '<div class="flex flex-wrap gap-1.5">' + chipChips.join('') + '</div>'
      + '<div class="text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-3">'
      + '<b>易错点</b>：① 位扩展时<b>地址线与片选共用</b>、只有数据线分段；字扩展时<b>数据线并联</b>、靠片选区分（两者正好相反）；'
      + '② "按字节编址"时每个地址对应 1 字节，单元数 = 字节数；"按字编址"要先除以字长；'
      + '③ <b>MAR 位数只由地址空间大小决定</b>，与实装多少芯片无关；'
      + '④ 片内地址位数 = log₂(单片单元数)，与数据线宽度无关；'
      + '⑤ DRAM 行/列地址引脚复用（2014-15）与多体交叉编址（2017-13/2022-17/2026-15）是<b>相邻考点</b>，别与位/字扩展混淆。'
      + '</div>'
      + '<div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">' + legend + '</div>'
      + '</div>';
  },
});
