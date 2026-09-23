'use strict';
/* ============================================================================
 * coa-floatadd.js —— 【计算机组成原理】浮点数的加 / 减运算（对阶 → 尾数加减 → 规格化 → 舍入 → 溢出判断）
 * ----------------------------------------------------------------------------
 * 真题考情：2009-2026 中 3 年考浮点加减（选 2 + 大题 1）——选 2009-13（完整五步流程）、
 * 2015-14（对阶方向 / 右规可能上溢 / 尾数溢出≠真溢出）；大 2017-43（浮点累加的舍入与阶码上溢）。
 * （**窗18** 从 `考情缓存/` 逐条核定；2010-14 / 2014-14 / 2026-14 看着像但主体是 IEEE 754 表示，归 coa-float754。）
 *
 * ★ 本模块在窗18 的"验证顺序"上付出了很贵的学费，写下来给后来者：
 *   1. **先把"真值"用整数/有理数算出来，再写任何位移公式**。本窗在这条式子上连错四版
 *      （用已对齐的截断值当精确值 / 分母错位 / 忘了 kExp / 忘了 2^m 的位置），
 *      **每一版都能让"冒烟全绿"**（因为断言和实现同错），最后是靠"print 中间量 + 手算真值"逐个纠正的。
 *   2. **JS 的 BigInt 左移对负数位移返回 0n**（`1n << BigInt(-3) === 0n`），
 *      写 `bInt0 << B.exp` 在 B.exp < 0 时会**静默丢掉整个第二操作数**——算精确值前必须先把两阶减到非负。
 *   3. **舍入只能对"精确值规格化后真正丢弃的低位"做**；拿"预先规格化时移掉的位"当保护位，
 *      会把本来精确可表示的 1 − 0.0625 = 0.9375 算成 1.0。
 *   4. **冒烟必须有一条"独立第二实现"**，且它要写成本身就难以写错的形式（本窗最后改成
 *      "枚举所有可表示数、取最接近者"的穷举路径），否则参考实现会和被测实现一起错。
 *
 * ★ 数据模型与不变量（先写这里，再写实现 —— §3.9 P2）
 *
 * 一、数值口径（**全整数运算，零浮点误差**）
 *   · 尾数用 m 位原码小数：`mantInt` 是 m 位整数，**真值 = mantInt / 2^m × 2^(exp)**。
 *     例：m=5、mantInt=26（11010₂）→ 真值 = 26/32 × 2^(exp) = 0.11010₂ × 2^(exp)。
 *     规格化形态固定为 **0.1xxx** ⟹ `mantInt` 的最高位必须落在第 m−1 位（值 ∈ [2^(m−1), 2^m−1]）。
 *   · 阶码用**移码**存放：`ebits` 位无符号字段，偏置 `bias = 2^(ebits−1) − 1`，
 *     字段值 `E = exp + bias`，规格化范围 `1 ≤ E ≤ 2^ebits − 2`。
 *     ⚠ 这里的 `E` 只用于**溢出判定与显示**；`exp` 是十进制真指数，不要与字段值混用（§3.8-12 量纲）。
 *   · `exp` 允许取负（如 −1），各帧**全程保留原始值**（可逆演示见 §3.1-1 快照铁律）。
 *
 * 二、稳定帧 / 过渡帧（§3.8-2）
 *   step 取值：`init` → `align` → `add` → `norm`（可 0 ~ 多帧）→ `round` → `overflow` → `result`。
 *   · **过渡帧**：`align`（尾数被截去尾部、已不是合法规格化数）、`add`（尾数可能落到 [2^m, 2^(m+1))）。
 *   · **稳定帧**：`init`、`norm` 最后一帧、`round`、`overflow`、`result` —— 这些帧必须满足
 *     "`mantInt` 的最高位 = 第 m−1 位"（零除外）。冒烟只对稳定帧套规格化公式。
 *
 * 三、不变量（冒烟逐帧断言，§3.8-1）
 *   ① `alignedInt == (mantInt >> d)`（d = 阶差），`lostBits` 恰为被移出的低 d 位，且 `|Δ| < 1 ulp`；
 *   ② 尾数加减的算术结果 `|差值| == |a' − b'|`，符号取绝对值大的一方（**零再用两符号位判定**）；
 *   ③ 每帧恒有 `价值 == mantInt/2^m × 2^exp`（`valCoef = mantInt/2^m`，两条式子都要能对上）；
 *   ④ **对阶 + 规格化的移位不丢数值**：`mantInt_final == |exactValInt >> (m − 1 − exp_final_used)|`
 *      ——右侧是"从精确整数一次性量化"的独立第二条路径，与逐帧结果必须相等；
 *   ⑤ 舍入后 `mantInt` 仍属 [2^(m−1), 2^m−1]（若 `+1` 顶到 2^m 则右规一次、阶 +1）；
 *   ⑥ 上溢判据只看阶码：`E > E_max = 2^ebits − 2` ⟹ 机器溢出为 ±∞（尾数溢出可右规挽救）；
 *   ⑦ 精确结果 `exactVal` 与机器结果 `machineVal` 的误差 ≤ 1 ulp（舍入模式为 `trunc` 时方向一致）。
 *
 * 四、派生量 → 全部进快照（§3.8-13「不许以为它在里面」）
 *   渲染与解说文案要用到的每个量（`x`/`y` 的原始位串、解析值、阶差、丢失位、两级结果、误差、
 *   IEEE 754 对照）**都写进每个快照**，渲染端只读快照、不重算"当前是谁"（§3.8-15）。
 * ========================================================================== */

const _FA_ROUND = { near: '就近舍入（IEEE 754 默认，1.2 这类十进制小数就靠它）', zero: '0 舍 1 入（截断式：丢弃部分 ≥ 半个 ulp 就进 1）', chop: '恒舍（直接截断 / 恒置 0）' };

/* ---------------- 纯整数工具（阶、尾数一律走整数，避免浮点误差） ---------------- */

/** 最高置位下标；全 0 返回 −1 */
function _faMsb(n) { let i = -1; while (n > 0) { n = Math.floor(n / 2); i++; } return i; }

/** |x| 的二进制位串（含 "0." 前缀），位数恰好 m */
function _faBits(mantInt, m) {
  const s = Math.abs(mantInt).toString(2).padStart(m, '0');
  return '0.' + s;
}

/** 把整数 k 写成 [n]移位保留 的说明（右移截尾、左移补 0），n 可负 */
function _faShiftText(n) {
  if (n === 0) return '不移位';
  return n > 0 ? '尾数右移 ' + n + ' 位（低位丢弃）' : '尾数左移 ' + (-n) + ' 位（低位补 0）';
}

/** 从十进制串解析出 {sign, exp, mantInt}；不使用浮点，逐字符累加 */
function _faParseOperand(raw, m, name) {
  const str = String(raw).trim();
  if (!str) throw { message: name + '不能为空，请按「符号 0.xxxx × 2^阶码」的格式填写' };
  /* ① 符号 */
  let s = str.replace(/[×xX*·∗]/g, '×').replace(/\s+/g, '');
  let sign = 0;
  if (/^[+−-]/.test(s)) { sign = /^[−-]/.test(s) ? 1 : 0; s = s.slice(1); }
  /* ② 拆 "尾数 × 2^阶码"（也接受 "尾数 × 2 的 阶码 次"） */
  let mantPart = s, expPart = '0';
  const idx = s.indexOf('×');
  if (idx >= 0) {
    mantPart = s.slice(0, idx);
    let e = s.slice(idx + 1);
    e = e.replace(/^2/, '').replace(/[^0-9+−-]/g, '');
    if (e === '' || e === '+' || e === '−' || e === '-') throw { message: name + '的阶码写得不完整（应为 × 2^3 或 × 2^-2）' };
    expPart = e.replace(/−/g, '-');
  }
  /* ③ 尾数：接受 0.xxxx / .xxxx / xxxxx（当作纯小数位） */
  const mm = /^(?:0?\.)?([01]+)$/.exec(mantPart);
  if (!mm) throw { message: name + '的尾数「' + mantPart + '」不是二进制小数（应形如 0.1101）' };
  const frac = mm[1];
  const exp = parseInt(expPart, 10);
  if (!Number.isInteger(exp)) throw { message: name + '的阶码「' + expPart + '」不是整数' };
  if (Math.abs(exp) > 4096) throw { message: name + '的阶码 ' + exp + ' 过大（限 ±4096）' };
  if (frac.length > m) throw { message: name + '的尾数有 ' + frac.length + ' 位小数，超过本模块的 ' + m + ' 位（请加长"尾数位数"或缩短输入）' };
  /* ⚠ 超出写出的位数一律**右补 0**（0.1101 = 0.11010₂，都是 13/32）；
     曾经误当成"在整数部分左边补位"（把 0.1101 读成 26/32），整条链路静默偏移一倍
     —— 窗18 冒烟锚点用例抓到的第 6 个真 bug。 */
  const fracBits = frac.padEnd(m, '0');
  const mantInt = parseInt(fracBits, 2);
  if (mantInt === 0) throw { message: name + '的尾数为全 0（真值为 0 的参与数不演示）' };
  if (frac[0] !== '1') throw { message: name + '的尾数不是规格化形式（最高位必须为 1，即 0.1xxx；请先自行规格化）' };
  return { sign, exp, mantInt, fracBits };
}

RC408.registerModule({
  id: 'coa-floatadd',
  mode: 'stepper',
  title: '浮点数的加/减运算（对阶 · 尾数运算 · 规格化 · 舍入）',

  theory: `
> **为什么要有它**：两个浮点数相加，**小数点不在同一个位置**——必须先"对齐小数点"才能做加减，而对齐的过程会丢掉低位、进而需要规格化与舍入。这一串动作就是浮点加减法的全部。
> **怎么实现**：**小阶向大阶看齐**：阶小的那个数尾数右移 |ΔE| 位（每右移一位阶码 +1），移出的低位不丢、记作**保护位**备用；然后尾数按定点加减；结果若不是 0.1xxx 就规格化；最后按规则舍入，并**只看阶码**判溢出。
> **记住什么**：**五步口诀**"对阶 → 尾数加减 → 规格化 → 舍入 → 溢出判断"，以及三条铁律：**对阶只能小阶向大阶**、**尾数溢出可右规挽救、阶码上溢才是真溢出**、**舍入误差永远来自被右移掉的那些低位**。

## 五步（背下来就能手算）
| 步 | 动作 | 判据 / 细节 |
| --- | --- | --- |
| ① 对阶 | 求阶差 \\(\\Delta E = E_x - E_y\\)，**小阶向大阶看齐** | 阶小者尾数**右移** \\(\\lvert \\Delta E \\rvert\\) 位、阶码加 \\(\\lvert \\Delta E \\rvert\\)；移出的低位保留作保护位 |
| ② 尾数加减 | 阶码已相同，对尾数做定点加 / 减 | 用**双符号位**（变形补码）可当场看出尾数是否溢出：01 / 10 即溢出 |
| ③ 规格化 | 结果须为 **0.1xxx** 形态 | 出现 **01.xxx / 10.xxx** → **右规**（右移 1 位、阶 +1，最多一次）；出现 **00.0xxx** → **左规**（左移、阶 −1，可多次） |
| ④ 舍入 | 处理右移 / 右规丢掉的那几位 | 就近舍入（取偶）/ 0 舍 1 入 / 恒舍；**舍入可能让尾数再次进位**，要再看一次是否需右规 |
| ⑤ 溢出判断 | **只看阶码** | 阶码上溢 → 溢出（按 ±∞ 处理）；阶码下溢 → 按机器零处理；**尾数溢出不是真溢出** |

## 三条最容易错的地方
1. **对阶方向**：一定是**小阶向大阶**（大阶的尾数左移会凭空造出有效位，是不允许的）；阶差越大，小阶那个数的有效位被移掉得越多——**两个数量级差太大时，小数会被"吃掉"**（经典题：\\(d + f\\) 仍等于 \\(d\\)）。
2. **右规 vs 左规**：**左规可多次、右规最多一次**；左规**不丢位**（补 0），所以舍入误差只可能来自右移。
3. **溢出看阶码不看尾数**：尾数相加进位到 \\(2.0\\) 只是"尾数溢出"，右规一次就救回来；只有阶码超出可表示范围才是真溢出。

> **真题考情**：**3/18 年（选 2 + 大题 1）**：**选** 2009-13（完整五步流程）、2015-14（对阶方向 / 右规可能上溢 / 尾数溢出≠真溢出）；
> **大** 2017-43（浮点累加的舍入与阶码上溢）。2010-14 / 2014-14 / 2026-14 看着像，主体是 IEEE 754 表示与精度，归 coa-float754。
`,
  /* 考情块由 exam-history 现算后回填（保持"考情块在最后且 ≤2 行"，§3.8-16） */

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'm', label: '尾数位数（小数位）', type: 'select', default: 5, options: [{ v: 4, t: '4 位' }, { v: 5, t: '5 位' }, { v: 8, t: '8 位' }, { v: 10, t: '10 位' }] },
    { key: 'ebits', label: '阶码位数', type: 'select', default: 4, options: [{ v: 3, t: '3 位' }, { v: 4, t: '4 位' }, { v: 5, t: '5 位' }] },
    { key: 'x', label: 'X（格式：符号 0.xxxx × 2^阶码）', default: '0.1101 × 2^3', wide: true, ph: '如 0.1101 × 2^3 / -0.1011 × 2^2', help: '尾数最高位必须是 1（规格化形式）；阶码可写负数，如 2^-2' },
    { key: 'y', label: 'Y（同格式）', default: '0.1011 × 2^5', wide: true, ph: '如 0.1011 × 2^5' },
    { key: 'op', label: '运算', type: 'select', default: 'add', options: [{ v: 'add', t: 'X + Y' }, { v: 'sub', t: 'X − Y' }] },
    { key: 'roundMode', label: '舍入方式', type: 'select', default: 'near', options: [{ v: 'near', t: '就近舍入（取偶，IEEE 754 默认）' }, { v: 'zero', t: '0 舍 1 入' }, { v: 'chop', t: '恒舍（直接截断）' }] },
  ],

  quickActions: [
    { label: '2009真题：X+Y（尾数需右规）', run(rt) { rt.setInput('m', 5); rt.setInput('ebits', 4); rt.setInput('x', '0.1101 × 2^3'); rt.setInput('y', '0.1011 × 2^5'); rt.setInput('op', 'add'); rt.setInput('roundMode', 'near'); rt.load(); } },
    { label: '2017真题：大数吃小数（舍入）', run(rt) { rt.setInput('m', 5); rt.setInput('ebits', 4); rt.setInput('x', '0.1000 × 2^5'); rt.setInput('y', '0.1000 × 2^0'); rt.setInput('op', 'add'); rt.setInput('roundMode', 'near'); rt.load(); } },
    { label: '左规：1 − 0.0625', run(rt) { rt.setInput('m', 5); rt.setInput('ebits', 4); rt.setInput('x', '0.1000 × 2^1'); rt.setInput('y', '0.1000 × 2^-3'); rt.setInput('op', 'sub'); rt.setInput('roundMode', 'near'); rt.load(); } },
    { label: '对阶后被吃光（差 5 个阶）', run(rt) { rt.setInput('m', 5); rt.setInput('ebits', 4); rt.setInput('x', '0.1000 × 2^5'); rt.setInput('y', '0.1100 × 2^0'); rt.setInput('op', 'add'); rt.setInput('roundMode', 'near'); rt.load(); } },
    { label: '阶码上溢（真溢出）', run(rt) { rt.setInput('m', 5); rt.setInput('ebits', 4); rt.setInput('x', '0.1000 × 2^7'); rt.setInput('y', '0.1000 × 2^7'); rt.setInput('op', 'add'); rt.setInput('roundMode', 'near'); rt.load(); } },
    { label: '结果为零（机器零）', run(rt) { rt.setInput('m', 5); rt.setInput('ebits', 4); rt.setInput('x', '0.1000 × 2^-3'); rt.setInput('y', '0.1000 × 2^-4'); rt.setInput('op', 'sub'); rt.setInput('roundMode', 'near'); rt.load(); } },
  ],

  /* ---------------- ① 解析输入 ---------------- */
  parse(vals) {
    const m = parseInt(vals.m, 10);
    const ebits = parseInt(vals.ebits, 10);
    if (!(m >= 2 && m <= 12)) throw { message: '尾数位数须为 2 ~ 12 位' };
    if (!(ebits >= 3 && ebits <= 6)) throw { message: '阶码位数须为 3 ~ 6 位' };
    const op = vals.op === 'sub' ? 'sub' : 'add';
    const roundMode = _FA_ROUND[vals.roundMode] ? vals.roundMode : 'near';
    const A = _faParseOperand(vals.x, m, 'X');
    const B = _faParseOperand(vals.y, m, 'Y');
    const bias = Math.pow(2, ebits - 1) - 1;
    const eMax = Math.pow(2, ebits) - 2, eMin = 1;          // 阶码字段的规格化范围
    for (const [nm, o] of [['X', A], ['Y', B]]) {
      const E = o.exp + bias;
      if (E < eMin || E > eMax) {
        throw { message: `${nm} 的阶码 ${o.exp} 加上偏置 ${bias} 得 E = ${E}，超出 ${ebits} 位阶码能表示的规格化范围 1 ~ ${eMax}（请调大"阶码位数"或改阶码）` };
      }
    }
    return { m, ebits, op, roundMode, A, B, bias, eMax, eMin };
  },

  /* ---------------- ② 纯算法：出快照 ---------------- */
  buildSnapshots(model) {
    const { m, ebits, op, roundMode, bias, eMax } = model;
    const P = Math.pow(2, m);
    const A = model.A, B = model.B;

    /* ---- 数值预处理：X − Y ≡ X + (−Y)，只翻 Y 的符号位 ---- */
    const Bsign = op === 'sub' ? (B.sign ^ 1) : B.sign;
    const aInt0 = A.mantInt, bInt0 = B.mantInt;

    /* ---- ① 对阶 ---- */
    const d = A.exp - B.exp;                       // ΔE > 0 表示 X 的阶大
    const alignExp = Math.max(A.exp, B.exp);
    /* 统一约定（窗18 修正：原来这里的三个表达式对"谁被移位"的约定互相矛盾，导致丢位与解说都指错数）：
         d > 0  ⟹ Y 的阶小 ⟹ **Y 右移 d 位**向 X 看齐；d < 0 ⟹ **X 右移 |d| 位**向 Y 看齐。
         alignA 沿用"Y 向 X 看齐"的语义（= d ≥ 0），仅表示方向；被右移的数：alignA 时是 Y，否则是 X。 */
    const alignA = d >= 0;                         // true = Y 向 X 看齐（Y 右移）
    const lostA = alignA ? 0 : (Math.pow(2, -d) > aInt0 ? aInt0 : aInt0 % Math.pow(2, -d));   // d<0 时 X 被右移
    const lostB = alignA ? (Math.pow(2, d) > bInt0 ? bInt0 : bInt0 % Math.pow(2, d)) : 0;     // d>0 时 Y 被右移
    const aAl = alignA ? aInt0 : Math.floor(aInt0 / Math.pow(2, -d));
    const bAl = alignA ? Math.floor(bInt0 / Math.pow(2, d)) : bInt0;
    const aZero = aAl === 0, bZero = bAl === 0;    // 对阶后被完全移空

    /* 对阶丢位的位串（宽度 = **实际被移出的位数**，被移空时只到有效位为止，不补前导 0） */
    const alWidth = alignA ? Math.min(Math.max(d, 0), m) : Math.min(Math.max(-d, 0), m);
    const alLost = alignA ? lostB : lostA;         // alignA=true ⟹ 被右移的是 Y ⟹ 取 lostB
    const alLostBits = alWidth > 0 ? alLost.toString(2).padStart(alWidth, '0') : '';

    /* ---- ② 尾数加减 ---- */
    const sgn = v => (v < 0 ? '−' : '+');
    const cmp = aAl - bAl;
    let magDiff = 0, resSign = A.sign, sumInt = 0, kind = 'add';
    if (A.sign === Bsign) {
      sumInt = aAl + bAl;                          // 同号：绝对值相加
      kind = 'add';
    } else {
      magDiff = Math.abs(cmp);                     // 异号：绝对值相减
      kind = 'sub';
      resSign = cmp > 0 ? A.sign : (cmp < 0 ? Bsign : 0);
    }
    const rawInt = kind === 'add' ? sumInt : magDiff;

    /* ---- ③ 精确值：**不丢位**的整数分子（后续规格化与舍入都以它为准）---- */
    /* 关键：对阶后的 aAl / bAl 是**截断**过的（低位进了 lostA / lostB），所以 rawInt 不是精确值。
       精确值 S = (aInt0/2^m × 2^A.exp) ± (bInt0/2^m × 2^B.exp)
                = exactSumInt / 2^m × 2^kExp          （kExp = min(两阶)）
         exactSumInt = ±aInt0·2^(A.exp−kExp) ± bInt0·2^(B.exp−kExp)     （共同阶上的整数）
       ⚠⚠ **必须先把两阶减到非负**：JS 的 BigInt 左移对负数位移返回 0n（`1n << BigInt(-3)` === 0n），
       直接写 `bInt0 << B.exp` 在 B.exp < 0 时会**静默把整个第二操作数丢掉**（窗18 实测踩到）。
       ⚠ 窗18 在这条式子上连错三版，全部记在这里，免得后来者再踩：
         ① 把已对齐的 X′、Y′（截断值）当精确值 ⟹ 对阶丢掉的有效位凭空消失；
         ② 分母写成 2^(alignExp+m) / 2^(kExp+m) / 2^m 的各种错位 ⟹ 整体偏移一个 2 的幂；
         ③ 用 `exactBig >> s2` 取规格化尾数时忘了 kExp 的偏移（e' 不是 s2 而是 s2 + kExp）。 */
    const kExp = Math.min(A.exp, B.exp);
    const exactSumInt = BigInt(aInt0) * (1n << BigInt(A.exp - kExp))
      + (Bsign === 1 ? -1n : 1n) * BigInt(bInt0) * (1n << BigInt(B.exp - kExp));
    const exactSign = exactSumInt < 0n ? 1 : 0;
    const exactBig = exactSumInt < 0n ? -exactSumInt : exactSumInt;
    const exactMsb = exactBig === 0n ? -1 : exactBig.toString(2).length - 1;
    const zeroResult = exactBig === 0n;
    /* ---- 规范形式（窗18 逐例由"真值反解"核对，别再改成猜出来的公式）----
       精确值 S = exactBig × 2^(kExp − m)（exactBig = 共同阶 kExp 上的整数分子）。
       要写成 S = normInt/2^m × 2^normExp（normInt 为 m 位规格化整数）：
         · 右移量 s2 = exactMsb − (m−1)：把 exactBig 的最高有效位挪到第 m−1 位即得 m 位尾数，
           移出的低位就是真正的保护位（s2 ≤ 0 时左移、无保护位）。
           校验：2009（exactMsb=6, m=5）⟹ s2 = 2、normInt = 114>>2 = 28、prot = "10" ✓
                1−0.0625（exactMsb=7, m=5）⟹ s2 = 3、normInt = 240>>3 = 30 ✓（30/32 = 0.9375）
         · 阶由恒等式 normInt·2^(normExp−m) = exactBig·2^(kExp−m) 反解：
             normExp − m = kExp − m + msb(exactBig) − msb(normInt)
           （两条都是"整数的二进制位数差"；规格化后 msb(normInt) = m−1）。
           校验：2009 ⟹ normExp = 3 + 6 − 4 = 5 ✓（28/32 × 2^5 = 28）
                1−0.0625 ⟹ normExp = −3 + 7 − 4 = 0 ✓（30/32 × 2^0 = 0.9375）
                16.5 ⟹ kExp=0、exactMsb=9、msb(normInt)=4 ⟹ normExp = 5 ✓（16/32 × 2^5 = 16） */
    const s2 = zeroResult ? 0 : (exactMsb - (m - 1));
    let normInt = Number(exactBig), protBits = '';
    if (!zeroResult) {
      if (s2 > 0) {
        normInt = Number(exactBig >> BigInt(s2));
        protBits = (exactBig & ((1n << BigInt(s2)) - 1n)).toString(2).padStart(s2, '0');
      } else {
        normInt = Number(exactBig << BigInt(-s2));
      }
    }
    const eIdeal = zeroResult ? alignExp : (kExp + exactMsb - _faMsb(normInt));
    const exactValInt = normInt;               // 规范尾数
    const exactMag = Number(exactBig);         // 共同阶整数分子（≤ 2^(m+2)·2^12）
    /* 规范形式的阶已在上面定为 eIdeal；被右移掉的那些低位就是保护位。 */
    const normExp = eIdeal;
    const msbRaw = _faMsb(rawInt);
    const shift = zeroResult ? 0 : (m - 1 - msbRaw);   // >0 右规、<0 左规（解说用）
    const G = { pos: -1, val: 0 }, R = { pos: -1, val: 0 }, St = { n: 0, val: 0 };
    if (protBits.length > 0) {
      G.pos = 0; G.val = Number(protBits[0]);
      if (protBits.length > 1) { R.pos = 1; R.val = Number(protBits[1]); }
      St.val = protBits.length > 2 ? (protBits.slice(2).indexOf('1') >= 0 ? 1 : 0) : 0;
      St.n = Math.max(0, protBits.length - 2);
    }
    const hasProt = protBits.length > 0;
    const halfUlp = hasProt ? '1' + '0'.repeat(protBits.length - 1) : '';   // 1 ulp 的一半
    const isTie = hasProt && protBits === halfUlp;                          // 恰好半个 ulp
    let roundUp = false, roundWhy = '精确结果需要 ' + (zeroResult ? 0 : exactMsb + 1) +
      ' 位有效位，不超过尾数的 ' + m + ' 位 ⟹ 没有丢弃任何位，**不需舍入**';
    if (hasProt) {
      if (roundMode === 'chop') { roundUp = false; roundWhy = '恒舍：丢弃的 ' + protBits + '₂ 一律丢弃'; }
      else if (roundMode === 'zero') {
        roundUp = protBits >= halfUlp;               // 串比较：位宽相同，字典序即数值序
        roundWhy = roundUp ? '0 舍 1 入：丢弃部分 ' + protBits + '₂ ≥ 半个 ulp ' + halfUlp + '₂ ⟹ 进 1'
          : '0 舍 1 入：丢弃部分 ' + protBits + '₂ < 半个 ulp ' + halfUlp + '₂ ⟹ 舍去';
      } else if (isTie) {
        roundUp = (normInt % 2) === 1;               // 就近取偶：恰好一半时取偶数
        roundWhy = '就近取偶：丢弃部分恰为半个 ulp ' + halfUlp + '₂（平局）→ 看保留末位 ' + (normInt % 2) + '，' + (roundUp ? '末位为 1，进 1 变偶' : '末位已是 0，舍去');
      } else {
        roundUp = protBits > halfUlp;
        roundWhy = roundUp ? '就近舍入：丢弃部分 ' + protBits + '₂ > 半个 ulp ' + halfUlp + '₂ ⟹ 进 1'
          : '就近舍入：丢弃部分 ' + protBits + '₂ < 半个 ulp ' + halfUlp + '₂ ⟹ 舍去';
      }
    }
    let rInt = normInt, rExp = normExp, carryOut = false;
    if (roundUp) {
      rInt = normInt + 1;
      if (rInt >= P) { rInt = Math.floor(rInt / 2); rExp += 1; carryOut = true; }
    }
    const normLost = shift > 0 ? (rawInt % Math.pow(2, shift)) : 0;   // 仅用于解说"右规移掉的精确位"

    /* ---- ⑥ 溢出判断（只看阶码）---- */
    const E = zeroResult ? 0 : rExp + bias;
    const overflow = !zeroResult && E > eMax;
    const underflow = zeroResult;
    const resultE = overflow ? null : (zeroResult ? 0 : E);

    /* ---- 精确值 / 机器值 / 误差（全整数）---- */
    const eFinal = zeroResult ? alignExp : rExp;
    /* 精确值 S = exactSumInt / 2^m × 2^kExp */
    const exactVal = (exactSign ? -1 : 1) * exactMag / Math.pow(2, m) * Math.pow(2, kExp);
    const machineVal = zeroResult ? 0 : (exactSign ? -1 : 1) * rInt / P * Math.pow(2, rExp);
    const ulp = zeroResult ? 0 : Math.pow(2, eFinal - m);

    /* ---- IEEE 754 单精度对照（双精度同法，指数位 11 / 偏置 1023）---- */
    const f754 = v => {
      if (v === 0) return '0x00000000（±0）';
      if (!isFinite(v)) return v > 0 ? '0x7F800000（+∞）' : '0xFF800000（−∞）';
      const sgnB = v < 0 ? 1 : 0, av = Math.abs(v);
      let e = Math.floor(Math.log2(av)), mm = av / Math.pow(2, e);
      while (mm >= 2) { mm /= 2; e++; }
      while (mm < 1) { mm *= 2; e--; }
      let fr = Math.round((mm - 1) * Math.pow(2, 23));
      let ee = e;
      if (fr >= Math.pow(2, 23)) { fr = 0; ee += 1; }
      const Ef = ee + 127;
      if (Ef < 1) return '下溢为 0 或非规格化数';
      if (Ef > 254) return (sgnB ? '0xFF800000（−∞，上溢）' : '0x7F800000（+∞，上溢）');
      const big = (BigInt(sgnB) << 31n) | (BigInt(Ef) << 23n) | BigInt(fr);
      return '0x' + big.toString(16).toUpperCase().padStart(8, '0');
    };
    /* 误差（仅用于显示；不写进不变量断言——最右边的用例里"1 个 ulp"会大于同一个数百分比的量级） */
    const absErr = Math.abs(machineVal - exactVal);
    const relErr = exactVal === 0 ? 0 : absErr / Math.abs(exactVal);
    const exactMatch = absErr <= Math.max(1e-12, Math.abs(exactVal) * 1e-15);

    /* ---- 逐帧出快照（每帧都带全部派生量，渲染端不重算）---- */
    const base = {
      m, ebits, bias, eMax, op, roundMode, P,
      xRaw: model.A, yRaw: model.B, Bsign,
      aInt0, bInt0, d, alignExp, alignA, alignY: !alignA,
      aAl, bAl, lostA, lostB, bLost: Math.min(Math.max(-d, 0), m), aZero, bZero,
      alWidth, alLost, alLostBits,
      kind, sumInt, magDiff, resSign, rawInt,
      msbRaw, shift, normInt, normExp, normLost, zeroResult,
      protBits, hasProt, halfUlp, isTie, G, R, St, roundUp, roundWhy, carryOut,
      rInt, rExp, E, overflow, underflow, resultE,
      exactVal, exactValInt, exactSign, exactMag, exactMsb, kExp, eIdeal, machineVal, ulp, eFinal, absErr, relErr, exactMatch,
      xVal: A.mantInt / P * Math.pow(2, A.exp),
      yVal: B.mantInt / P * Math.pow(2, B.exp),
      xSignShow: A.sign, ySignShow: B.sign,
      f754,
    };
    const snaps = [];
    const push = (step, log, desc, logType, extra) => {
      snaps.push(Object.assign({}, base, { step, log, desc, logType: logType || 'info' }, extra || {}));
    };

    const fx = A.mantInt / P, fy = B.mantInt / P;
    const opWord = op === 'add' ? 'X + Y' : 'X − Y';

    push('init',
      `就绪：${m} 位尾数（原码，规格化 0.1xxx）+ ${ebits} 位阶码（移码，偏置 ${bias}），计算 ${opWord}。` +
      ` X = ${A.sign ? '−' : ''}${fx} × 2^${A.exp}，Y = ${B.sign ? '−' : ''}${fy} × 2^${B.exp}。`,
      `单步执行：对阶 → 尾数加减 → 规格化 → 舍入 → 溢出判断`);

    push('align',
      `① 对阶：ΔE = ${A.exp} − ${B.exp} = ${d}，小阶向大阶看齐 → ${alignA ? 'Y' : 'X'} 的${_faShiftText(Math.abs(d))}。` +
      (d === 0 ? '两数阶码相同，无需移位。' :
        ` 移出的低位 = ${alLostBits}₂（共 ${alWidth} 位，保留作保护位，不丢）。`) +
      ` 对齐后 X′ = ${_faBits(aAl, m)}₂ × 2^${alignExp}，Y′ = ${_faBits(bAl, m)}₂ × 2^${alignExp}。` +
      ((aZero || bZero) ? ` ⚠ ${aZero ? 'X' : 'Y'} 的尾数已被全部移出（有效位被"吃掉"）——这正是"大数吃小数"的由来。` : ''),
      `对阶完成：阶码统一为 ${alignExp}，${alignA ? 'Y' : 'X'} 尾数右移 ${Math.abs(d)} 位`, (aZero || bZero) ? 'warn' : 'info');

    push('add',
      `② 尾数加减：阶码已同为 ${alignExp}，尾数按定点运算。${kind === 'add'
        ? `两数同号 → 绝对值相加：${_faBits(aAl, m)}₂ + ${_faBits(bAl, m)}₂ = ${_faBits(sumInt, m)}₂（十进制 ${aAl} + ${bAl} = ${sumInt}）。`
        : `两数异号 → 绝对值相减、取绝对值大的一方的符号：|X′| = ${aAl}、|Y′| = ${bAl} ⟹ 差 = ${magDiff}，` +
        `符号取 ${(cmp === 0 ? '正（差为 0）' : (cmp > 0 ? 'X 的符号' : 'Y 的符号'))}。`}` +
      ` 尾数 ${sumInt >= P || magDiff >= P ? '**溢出**（≥ 2.0）' : '未溢出'}（尾数溢出不是真溢出，右规一次即可挽救）。`,
      `尾数运算结果 = ${_faBits(rawInt, m)}₂ × 2^${alignExp}`, 'info');

    if (!zeroResult) {
      push('norm',
        `③ 规格化：当前尾数 ${_faBits(rawInt, m)}₂ 的最高有效位在第 ${msbRaw + 1} 位，` +
        (shift === 0 ? '已在 0.1xxx 形态，**无需规格化**。'
          : shift > 0 ? `需 **右规 ${shift} 位**（阶码 + ${shift}）；右规移出的低位 ${normLost.toString(2).padStart(shift, '0')}₂ 也进保护位。`
            : `需 **左规 ${-shift} 位**（阶码 − ${-shift}）；左规补 0、**不丢位**，不会带来舍入误差。`) +
        ` 规格化后：尾数 = ${_faBits(normInt, m)}₂，阶码 = ${normExp}。`,
        `规格化${shift === 0 ? '：本就合规' : (shift > 0 ? `：右规 ${shift} 位` : `：左规 ${-shift} 位`)} → ${_faBits(normInt, m)}₂ × 2^${normExp}`);
    }

    push('round',
      `④ 舍入（${_FA_ROUND[roundMode].split('（')[0]}）：` +
      (hasProt ? `被丢弃的低位串（保护位）= ${protBits}₂，半个 ulp = ${halfUlp}₂。${roundWhy}。` : `${roundWhy}。`) +
      (roundUp ? (carryOut
        ? ` 尾数 +1 后顶到 2^m，**再右规一次**：尾数 = ${_faBits(rInt, m)}₂，阶码 +1 → ${rExp}。`
        : ` 尾数 +1：${_faBits(normInt, m)}₂ → ${_faBits(rInt, m)}₂。`)
        : ` 舍入后尾数仍为 ${_faBits(rInt, m)}₂。`),
      `舍入后：${_faBits(rInt, m)}₂ × 2^${rExp}`, hasProt ? 'info' : 'info');

    push(overflow ? 'overflow' : 'result',
      overflow
        ? `⑤ 溢出判断：**只看阶码**。阶码字段 E = ${rExp} + ${bias} = ${E} > E_max = ${eMax} ⟹ **阶码上溢**，机器按 ±∞ 处理（尾数部分再多也救不回来）。`
        : (underflow
          ? `⑤ 溢出判断：尾数相减结果恰为 0（两数已对齐后相等）⟹ 结果为 0。`
          : `⑤ 溢出判断：阶码字段 E = ${rExp} + ${bias} = ${E}，落在规格化范围 1 ~ ${eMax} 内 ⟹ **无溢出**。结果为 ${_faBits(rInt, m)}₂ × 2^${rExp}。`) +
      ` 精确值 = ${exactVal}，机器结果 = ${machineVal}${exactMatch ? '，**完全精确**' : `，绝对误差 ${absErr}（相对误差 ≈ ${(relErr * 100).toExponential(2)}%）`}。`,
      overflow ? `阶码上溢：结果按 ±∞ 处理` : (underflow ? `结果为 0` : `结果 = ${_faBits(rInt, m)}₂ × 2^${rExp} = ${machineVal}`),
      overflow ? 'error' : 'success');

    return snaps;
  },

  /* ---------------- ③ 纯渲染（只读快照，不重算任何"当前是谁"） ---------------- */
  render(ctx) {
    const { snap: s, stage } = ctx;
    const OP = { add: '+', sub: '−' };
    const cellW = s.m > 8 ? 20 : 27, cellH = 30;

    /* 一行位格子（自左向右 = 高位到低位） */
    const row = (label, intVal, opts) => {
      const o = opts || {};
      const bits = Math.abs(intVal).toString(2).padStart(s.m, '0');
      const cells = Array.from({ length: s.m }, (_, k) => {
        const hi = s.m - 1 - k;
        const cls = o.hot && o.hot.indexOf(hi) >= 0 ? 'bit-tag' : (o.dim ? 'bit-idx' : '');
        return `<div class="bit-cell ${cls}" style="width:${cellW}px;height:${cellH}px;font-size:12px" title="第 ${hi + 1} 位（权 2^${hi - s.m}）">${bits[k]}</div>`;
      }).join('');
      return `<div class="flex items-center gap-2">
        <span class="w-24 shrink-0 text-right text-[11px] font-bold text-slate-500">${label}</span>
        <span class="text-[11px] font-mono text-slate-400 shrink-0">0.</span>
        <div class="flex gap-0.5">${cells}</div>
        <span class="text-[11px] font-mono font-bold text-slate-500 shrink-0">${o.tail || ''}</span>
      </div>`;
    };

    /* 主表体：按当前帧决定展示到哪一步 */
    const beforeAlign = s.step === 'init';
    const afterAlign = !beforeAlign;
    const afterAdd = s.step === 'add' || s.step === 'norm' || s.step === 'round' || s.step === 'overflow' || s.step === 'result';
    const afterNorm = s.step === 'norm' || s.step === 'round' || s.step === 'overflow' || s.step === 'result';
    const afterRound = s.step === 'round' || s.step === 'overflow' || s.step === 'result';

    let table;
    if (beforeAlign) {
      table = `<p class="text-sm text-slate-400 py-6 text-center">单步执行后，这里展示对阶 → 尾数加减 → 规格化 → 舍入的逐拍竖式</p>`;
    } else {
      const mul = `<span class="w-24 shrink-0"></span><span class="w-[1.6em] shrink-0"></span>`;
      table = `
        <div class="space-y-1.5 overflow-x-auto">
          ${row(`X = ${_faBits(s.aInt0, s.m)}₂`, s.aInt0, { tail: `× 2^${s.xRaw.exp}`, dim: afterAlign })}
          ${row(`Y = ${_faBits(s.bInt0, s.m)}₂`, s.bInt0, { tail: `× 2^${s.yRaw.exp}`, dim: afterAlign })}
          <div class="flex items-center gap-2">
            ${mul}<div class="border-t-2 border-slate-300" style="width:${s.m * (cellW + 2) + 14}px"></div>
          </div>
          ${row(`X′（对齐后×2^${s.alignExp}）`, s.aAl, { hot: s.step === 'align' && s.alignY ? [] : [s.m - 1] })}
          ${row(`Y′（对齐后×2^${s.alignExp}）`, s.bAl, { hot: s.step === 'align' && s.alignA ? [] : [s.m - 1] })}
          ${afterAdd ? `<div class="flex items-center gap-2">
            ${mul}<div class="border-t-2 border-slate-300" style="width:${s.m * (cellW + 2) + 14}px"></div>
          </div>
          ${row(`尾数${OP[s.op]} 结果`, s.rawInt, { hot: s.step === 'add' ? [s.msbRaw] : [], tail: `× 2^${s.alignExp}`, dim: !s.step.startsWith('add') })}
          ` : ''}
          ${afterNorm && !s.zeroResult ? `${row(`规格化后（阶 ${s.normExp}）`, s.normInt, { hot: s.step === 'norm' ? [s.m - 1] : [], tail: `× 2^${s.normExp}`, dim: s.step !== 'norm' })}
          ` : ''}
          ${afterRound ? `${row(`舍入后（阶 ${s.rExp}）`, s.rInt, { hot: (s.step === 'round' || s.step === 'result' || s.step === 'overflow') ? [s.m - 1] : [], tail: `× 2^${s.rExp}` })}
          ` : ''}
        </div>`;
    }

    /* 保护位卡（对阶丢位 + 右规丢位） */
    const protCard = (afterAlign) ? (() => {
      if (!s.hasProt) return `<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
        <b>保护位：</b>本帧的对阶与规格化**没有右移**（阶差为 0，或只做了左规）⟹ 没有被丢弃的低位，结果**精确**。</div>`;
      const pos = (t, name, desc) => t.pos < 0 ? '' : `<div class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center">
          <div class="text-[11px] font-bold text-slate-400">${name}</div>
          <div class="text-lg font-extrabold font-mono ${t.val ? 'text-rose-600' : 'text-slate-500'}">${t.val}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">${desc}</div>
        </div>`;
      return `<div class="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
        <div class="text-sm text-amber-900 mb-2"><b>保护位（被右移丢弃的低位，共 ${s.protBits.length} 位）：</b>
          <span class="font-mono font-bold">${s.protBits}₂</span>
          ${s.protBits.length > 1 ? `　→ 取其中前 3 位作 G / R / S 供舍入判定` : '　→ 只有 1 位，直接作 G'}</div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          ${pos(s.G, 'G 保护位', s.protBits.length > 1 ? '右移后的第 1 位' : '唯一的丢弃位')}
          ${pos(s.R, 'R 舍入位', '第 2 位')}
          <div class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center">
            <div class="text-[11px] font-bold text-slate-400">S 粘着位</div>
            <div class="text-lg font-extrabold font-mono ${s.St.val ? 'text-rose-600' : 'text-slate-500'}">${s.protBits.length > 2 ? s.St.val : '—'}</div>
            <div class="text-[10px] text-slate-400 mt-0.5">${s.protBits.length > 2 ? `后 ${s.St.n} 位中是否有 1` : '无后续位'}</div>
          </div>
          <div class="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-center">
            <div class="text-[11px] font-bold text-indigo-400">半个 ulp</div>
            <div class="text-lg font-extrabold font-mono text-indigo-700">${s.halfUlp}₂</div>
            <div class="text-[10px] text-indigo-400 mt-0.5">${s.isTie ? '恰好平局 → 取偶' : '用来比较大小'}</div>
          </div>
        </div>
      </div>`;
    })() : '';

    /* 阶码的二进制字段显示 */
    const eBitsStr = (E) => E === null || E === undefined ? '—' : E.toString(2).padStart(s.ebits, '0');

    /* 结果卡 */
    const resCard = (s.step === 'result' || s.step === 'overflow') ? (() => {
      if (s.overflow) {
        return `<div class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-800">
          <b>阶码上溢：结果为 ±∞。</b>阶码字段 E = ${s.E} 超出上限 ${s.eMax}（${eBitsStr(s.eMax)}₂）。
          注意 <b>真溢出只看阶码</b>——本帧尾数本身完全正常（${_faBits(s.rInt, s.m)}₂），是"结果太大装不下"。</div>`;
      }
      const rel = s.relErr;
      return `<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800 space-y-1">
        <div><b>结果：</b><span class="font-mono font-bold">${_faBits(s.rInt, s.m)}₂ × 2^${s.rExp}</span>
          = <b>${s.machineVal}</b>（符号 ${s.resSign ? '−' : '+'}，阶码字段 E = ${s.E} = ${eBitsStr(s.E)}₂）</div>
        <div><b>精确值：</b>${s.exactVal}　⟹　${s.exactMatch ? '<b>无舍入误差</b>' : `绝对误差 ${s.absErr}（相对误差 ≈ ${(rel * 100).toExponential(2)}%）`}</div>
        <div><b>IEEE 754 单精度对照：</b>精确值编码为 <span class="font-mono">${s.f754(s.exactVal)}</span>，机器结果编码为 <span class="font-mono">${s.f754(s.resSign ? -s.machineVal : s.machineVal)}</span></div>
      </div>`;
    })() : '';

    /* 五步进度条 */
    const STEPS = [['align', '① 对阶'], ['add', '② 尾数加减'], ['norm', '③ 规格化'], ['round', '④ 舍入'], ['result', '⑤ 溢出判断']];
    const order = { init: 0, align: 1, add: 2, norm: 3, round: 4, overflow: 5, result: 5 };
    const cur = order[s.step];
    const stepBar = `<div class="flex flex-wrap items-center gap-1.5">${STEPS.map(([k, t]) => {
      const i = order[k];
      const done = cur >= i && !(k === 'result' && s.step !== 'result' && s.step !== 'overflow');
      const on = (k === 'align' && s.step === 'align') || (k === 'add' && s.step === 'add') || (k === 'norm' && s.step === 'norm') || (k === 'round' && s.step === 'round') || (k === 'result' && (s.step === 'result' || s.step === 'overflow'));
      const cls = on ? 'bg-indigo-600 text-white border-indigo-600' : done ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-400 border-slate-200';
      return `<span class="px-2.5 py-1 rounded-lg border text-[11px] font-bold ${cls}">${t}${done && !on ? ' ✓' : ''}</span>`;
    }).join('<span class="text-slate-300 text-[11px]">→</span>')}</div>`;

    const stats =
      RC408.ui.statCard('算式', `${s.xRaw.sign ? '−' : ''}${s.xRaw.mantInt / s.P} × 2^${s.xRaw.exp} ${OP[s.op]} ${s.yRaw.sign ? '−' : ''}${s.yRaw.mantInt / s.P} × 2^${s.yRaw.exp}`, `${s.m} 位尾数 · ${s.ebits} 位阶码（偏置 ${s.bias}）`, 'text-indigo-600') +
      RC408.ui.statCard('当前阶码', s.step === 'init' ? `${s.xRaw.exp} / ${s.yRaw.exp}` : s.alignExp, `对齐后阶码 = max(Ex, Ey) = ${s.alignExp}`, 'text-amber-600') +
      RC408.ui.statCard('阶差 ΔE', s.d, s.d === 0 ? '两阶相同，无需对阶' : `${s.alignA ? 'Y' : 'X'} 尾数右移 ${Math.abs(s.d)} 位`, 'text-rose-600') +
      RC408.ui.statCard(s.step === 'result' || s.step === 'overflow' ? '机器结果' : '结果', (s.step === 'result' || s.step === 'overflow') ? (s.overflow ? '±∞' : s.machineVal) : '…', (s.step === 'result' || s.step === 'overflow') ? `保护位 ${s.protBits || '无'}` : '逐拍计算中', 'font-mono text-emerald-600');

    stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        ${stepBar}
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          ${RC408.ui.sectionTitle(`浮点加减逐拍竖式（原码尾数 · 移码阶码；琥珀 = 本帧关注位）`)}
          ${table}
        </div>
        ${protCard}
        ${resCard}
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#d97706', '本帧关注位（最高位 / 保护位）')}
          ${RC408.ui.legend('#059669', '已完成步骤')}
          ${RC408.ui.legend('#e11d48', '被丢弃 / 参与舍入判定的位')}
        </div>
      </div>`;
  },
});
