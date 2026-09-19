'use strict';
/* ============================================================================
 * subnet.js —— 【计算机网络】IPv4 地址与子网划分（即时反馈型模块 mode:'instant'）
 * ----------------------------------------------------------------------------
 * 与步进型模块不同：本模块没有"过程"，用户拖动滑块 / 修改 IP 的瞬间即完成
 * 全部计算并重绘（Runner.runInstant 直接调 render）。
 *
 * 32 位格子配色（408 教材口径：子网划分 = 从主机号借位）：
 *   🟢 网络号（该类地址的默认掩码位数）
 *   🔴 子网号（前缀长度超出默认掩码的"借位"部分）
 *   🔵 主机号（剩余部分）
 * ========================================================================== */

RC408.registerModule({
  id: 'net-subnet',
  mode: 'instant',
  title: 'IPv4 地址与子网划分',

  theory: `
> **真题考情**：18 年中 **14 年**考 IPv4 地址/子网划分/路由聚合（09/18/22/25 大题，10/11/12/15/16/17/18/19/21/22/23 选择），是计网分值最高的考点——本模块覆盖其全部计算类型：求网络/广播地址、可用范围、等长与 VLSM 划分、判断同网段。

## IP 地址的层级结构
IPv4 地址共 **32 位**，采用"点分十进制"书写。划分子网后，32 位被解释为三段：
**网络号 + 子网号 + 主机号**。其中前两者合起来对应子网掩码中**全 1** 的部分。

## 五类地址及默认掩码
| 类别 | 第一字节范围 | 默认掩码 | 网络号位数 |
| --- | --- | --- | --- |
| A 类 | 1 ~ 126 | 255.0.0.0 | /8 |
| B 类 | 128 ~ 191 | 255.255.0.0 | /16 |
| C 类 | 192 ~ 223 | 255.255.255.0 | /24 |
| D 类 | 224 ~ 239 | 组播地址 | — |
| E 类 | 240 ~ 255 | 保留 | — |
（127.x.x.x 为环回地址；主机号全 0 = 网络地址，全 1 = 广播地址，均不可分配给主机）

## 子网划分的核心公式
1. **子网掩码**：前缀长度 /n ⇒ 前 n 位为 1；
2. **网络地址** = IP 地址 **∧** 子网掩码（按位与）；
3. **广播地址** = 网络地址 **∨** 掩码反码（主机位全置 1）；
4. **可用主机数** = 2^主机号位数 − **2**（去掉网络地址与广播地址）；
5. 借 s 位主机号作子网号 ⇒ 可划分 **2^s** 个等长子网。

## 前缀可以比默认掩码更短吗？——超网与路由聚合
- **分类编址（有类）**：前缀由类别固定（A/8、B/16、C/24），一个 C 类网络**不可能**是 /20——
  这时"网络"的最小粒度就是"一个 C 类"；
- **无类编址 CIDR（1993 起，现代互联网与 408 考纲采用）**：类别概念取消，前缀任意。
  前缀**短于**默认掩码 = **超网**：如 192.168.16.0/20 相当于把 **16 个连续 C 类网络**
  合并成一个地址块，对外只通告一条路由——即**路由聚合**（路由聚集）；
- 合并的网络数 = **2^(默认前缀 − 超网前缀)**；掩码变短、块变大，与子网划分正好互为逆操作。

> 本模块默认工作在无类 CIDR 模式（前缀 0~32 自由拖动，短前缀会给出聚合说明）；
> 切换到"有类模式"后，滑块会自动限制在不短于该类默认掩码，体会两种编址的差别。

## 考点提示
- 给定 IP 与掩码，**快速判断两个地址是否在同一子网**：分别求网络地址比较即可；
- 掩码必须是**连续的 1 后跟连续的 0**，如 255.255.192.0 合法、255.255.193.0 非法；
- 已知块大小（block size = 256 − 掩码末段非零值），可快速枚举各子网的起始地址。
`,

  /* ---------------- 输入表单 ---------------- */
  inputs: [
    { key: 'ip', label: 'IP 地址（/前缀 后缀与滑块联动）', default: '192.168.10.66/26', ph: '例：192.168.10.66/26', help: '拖动滑块时此处后缀与掩码自动同步；在此输入 /前缀 也会反向同步到滑块' },
    {
      key: 'addrMode', label: '编址模式', type: 'select', default: 'cidr', wide: true,
      options: [
        { v: 'cidr', t: '无类 CIDR（现代互联网）：前缀 0~32 任意，短于默认掩码 = 超网/路由聚合' },
        { v: 'classful', t: '有类模式：前缀不得短于该类默认掩码（A/8 · B/16 · C/24）' },
      ],
    },
    { key: 'prefix', label: '前缀长度（拖动滑块，与掩码联动）', type: 'range', min: 0, max: 32, default: 26 },
    { key: 'mask', label: '子网掩码（点分十进制）', default: '255.255.255.192', ph: '255.255.255.0' },
    {
      key: 'view', label: '32 位格子当前显示', type: 'select', default: 'ip',
      options: [
        { v: 'ip', t: 'IP 地址' }, { v: 'mask', t: '子网掩码' },
        { v: 'net', t: '网络地址' }, { v: 'bcast', t: '广播地址' },
      ],
    },
  ],

  /* 预设示例 / 随机地址 */
  quickActions: [
    {
      label: '🎲 随机地址', run(rt) {
        const ip = `${['10.1', '172.16', '192.168'][RC408.util.rnd(0, 2)]}.${RC408.util.rnd(0, 254)}.${RC408.util.rnd(1, 254)}`;
        rt.setInput('ip', ip);
        rt.setInput('prefix', RC408.util.rnd(8, 30));
        rt.load();
      },
    },
    { label: 'C类 /26 示例', run(rt) { rt.setInput('ip', '192.168.10.66'); rt.setInput('prefix', 26); rt.load(); } },
    { label: 'B类 /20 示例', run(rt) { rt.setInput('ip', '172.16.100.77'); rt.setInput('prefix', 20); rt.load(); } },
    { label: 'A类 /12 示例', run(rt) { rt.setInput('ip', '10.33.7.219'); rt.setInput('prefix', 12); rt.load(); } },
  ],

  /* ---------------- 表单联动：IP 字段 ⇄ 前缀滑块 ⇄ 掩码（三向同步） ---------------- */
  bindInputs(els, rt) {
    /* 依据编址模式与 IP 类别，动态限制滑块下限：
       有类模式下前缀不得短于该类默认掩码（A/8 · B/16 · C/24；D/E 不限制） */
    const applyConstraints = () => {
      const cls = _snClassOf(els.ip.value.split('/')[0].trim());
      const classful = els.addrMode.value === 'classful';
      els.prefix.min = classful && cls.defaultBits ? cls.defaultBits : 0;
      if (classful && cls.defaultBits && parseInt(els.prefix.value, 10) < cls.defaultBits) {
        els.prefix.value = cls.defaultBits;
      }
      _snSyncDisplays(els);
    };

    // 切换编址模式 → 应用约束（解析器中还会兜底钳位并在日志说明）
    els.addrMode.addEventListener('input', () => { applyConstraints(); rt.load(); });
    // 拖动前缀滑块 → 掩码文本与 IP 字段的 /前缀 后缀随之更新
    els.prefix.addEventListener('input', () => _snSyncDisplays(els));
    // 用户直接改掩码 → 换算成前缀长度并同步滑块
    els.mask.addEventListener('input', () => {
      const m = _snParseMask(els.mask.value.trim());
      if (m === null) return;                       // 非法/未输完：暂不处理
      els.prefix.value = m;
      applyConstraints();
      rt.load();
    });
    // 用户修改 IP 且携带 "/前缀" → 同步滑块与掩码（IP 首字节变了，类别约束也要刷新）
    els.ip.addEventListener('input', () => {
      const mm = els.ip.value.match(/\/(\d{1,2})\s*$/);
      if (mm) {
        const p = +mm[1];
        if (p >= 0 && p <= 32) els.prefix.value = p;
      }
      applyConstraints();
    });
    applyConstraints();   // 首次挂载
  },
  /** setInput 程序化改滑块后，保持掩码 / IP 后缀显示一致 */
  syncInputs(els) { _snSyncDisplays(els); },

  /* ---------------- ① 解析与计算 ---------------- */
  parse(vals) {
    /* 前缀滑块是唯一权威：IP 字段里的 "/x" 后缀仅作显示/反向输入，
       由 bindInputs 的监听负责把它同步到滑块，这里只剥离不采纳，
       避免拖动滑块时字段同步与重绘产生竞态 */
    let ipStr = vals.ip.trim();
    if (ipStr.includes('/')) ipStr = ipStr.split('/')[0].trim();
    let prefix = parseInt(vals.prefix, 10);
    const addrMode = vals.addrMode === 'classful' ? 'classful' : 'cidr';
    const ipInt = _snParseIp(ipStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw { message: '前缀长度须在 0 ~ 32 之间' };

    /* 地址类别（先于掩码计算：有类模式需要按类别钳位前缀） */
    const o1 = (ipInt >>> 24) & 255;
    let cls, defaultBits, clsNote = '';
    if (o1 === 0) { cls = '0'; defaultBits = null; clsNote = '保留地址（网络号为 0）'; }
    else if (o1 === 127) { cls = 'A'; defaultBits = 8; clsNote = '环回地址，仅用于本机测试'; }
    else if (o1 < 128) { cls = 'A'; defaultBits = 8; }
    else if (o1 < 192) { cls = 'B'; defaultBits = 16; }
    else if (o1 < 224) { cls = 'C'; defaultBits = 24; }
    else if (o1 < 240) { cls = 'D'; defaultBits = null; clsNote = 'D 类组播地址，不用于子网划分'; }
    else { cls = 'E'; defaultBits = null; clsNote = 'E 类保留地址'; }

    /* 有类模式兜底钳位：前缀不得短于该类默认掩码（UI 滑块 min 已限制，此处兜底程序化输入） */
    let clamped = false;
    if (addrMode === 'classful' && defaultBits !== null && prefix < defaultBits) {
      prefix = defaultBits;
      clamped = true;
    }

    /* 核心位运算 */
    const maskInt = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const netInt = (ipInt & maskInt) >>> 0;
    const bcastInt = (netInt | (~maskInt >>> 0)) >>> 0;
    const hostBits = 32 - prefix;

    /* 三段位数：绿(网络号) / 红(子网号·借位) / 蓝(主机号) */
    let greenBits, subBits;
    if (defaultBits === null) { greenBits = prefix; subBits = 0; }
    else if (prefix >= defaultBits) { greenBits = defaultBits; subBits = prefix - defaultBits; }
    else { greenBits = prefix; subBits = 0; }   // 前缀短于默认掩码 → 超网/路由聚合

    const usableHosts = hostBits >= 2 ? Math.pow(2, hostBits) - 2 : 0;
    return {
      ipInt, ipStr, prefix, addrMode, clamped, maskInt, netInt, bcastInt, hostBits,
      cls, defaultBits, clsNote, greenBits, subBits, usableHosts,
    };
  },

  /* 即时模式日志 */
  logs(model) {
    const m = model, U = RC408.util;
    const range = m.hostBits >= 2
      ? `${_snDotted(m.netInt + 1)} ~ ${_snDotted(m.bcastInt - 1)}`
      : '—（主机号位数不足）';
    const L = [
      { type: 'info', text: `解析成功：${_snDotted(m.ipInt)}/${m.prefix}，判定为 ${m.cls} 类地址${m.clsNote ? '（' + m.clsNote + '）' : ''}` },
    ];
    if (m.addrMode === 'classful') {
      L.push({ type: m.clamped ? 'warn' : 'info', text: `有类编址模式：${m.cls} 类默认掩码 /${m.defaultBits}${m.clamped ? ` —— 前缀已从更短的值自动调整为 /${m.prefix}（分类编址下网络前缀由类别固定，不能更短；要合并多个网络请改用无类 CIDR 的超网）` : '，前缀不短于默认掩码 ✓'}` });
    }
    L.push(
      { type: 'info', text: `子网掩码 ${_snDotted(m.maskInt)} = /${m.prefix}（二进制中 1 的个数为 ${m.prefix}）` },
      { type: 'success', text: `网络地址 = IP ∧ 掩码 = ${_snDotted(m.netInt)}  →  ${U.bin(m.netInt, 32)}` },
      { type: 'success', text: `广播地址 = 网络位后主机位全 1 = ${_snDotted(m.bcastInt)}  →  ${U.bin(m.bcastInt, 32)}` },
      { type: 'info', text: `可用主机范围：${range}，共 ${m.hostBits >= 2 ? m.usableHosts + ' = 2^' + m.hostBits + ' − 2' : 0} 个` },
    );
    if (m.subBits > 0) {
      L.push({ type: 'warn', text: `从主机号借 ${m.subBits} 位作子网号 → 可划分 2^${m.subBits} = ${Math.pow(2, m.subBits)} 个子网，每个子网可用主机 ${m.usableHosts} 个` });
    } else if (m.defaultBits !== null && m.prefix === m.defaultBits) {
      L.push({ type: 'info', text: '前缀与该类地址默认掩码一致：未划分子网（可尝试拖大前缀长度观察"借位"）' });
    } else if (m.defaultBits !== null && m.prefix < m.defaultBits) {
      L.push({ type: 'warn', text: `无类 CIDR：前缀短于默认掩码 = 超网（路由聚合）——相当于把 2^${m.defaultBits - m.prefix} = ${Math.pow(2, m.defaultBits - m.prefix)} 个连续 ${m.cls} 类网络合并成一个地址块对外通告` });
    }
    return L;
  },

  /* ---------------- ② 渲染 ---------------- */
  render(ctx) {
    const { model: m, inputs, stage } = ctx;
    const U = RC408.util;

    /* 当前 32 位格子显示哪个值 */
    const viewMap = { ip: ['IP 地址', m.ipInt], mask: ['子网掩码', m.maskInt], net: ['网络地址', m.netInt], bcast: ['广播地址', m.bcastInt] };
    const [viewName, dispInt] = viewMap[inputs.view] || viewMap.ip;

    /* ---- 32 位格子：4 行 × 8 位，按"网络号/子网号/主机号"着色 ---- */
    const rows = [0, 1, 2, 3].map(r => {
      const cells = [];
      for (let c = 0; c < 8; c++) {
        const p = r * 8 + c;                                  // 全局位序号（0 = 最高位）
        const v = (dispInt >>> (31 - p)) & 1;
        const color = p < m.greenBits ? 'bit-net' : p < m.greenBits + m.subBits ? 'bit-sub' : 'bit-host';
        cells.push(`<div class="bit-cell ${color}" title="第 ${p + 1} 位（从最高位起）">${v}</div>`);
      }
      const byteVal = (dispInt >>> (24 - r * 8)) & 255;
      return `<div class="flex items-center gap-1.5 justify-center">
        <span class="w-12 text-[11px] text-slate-400 font-mono text-right shrink-0">字节${r + 1}</span>
        ${cells.join('')}
        <span class="ml-1 text-sm font-mono font-extrabold text-slate-600 w-10 shrink-0">=${byteVal}</span>
      </div>`;
    }).join('<div class="h-1.5"></div>');

    /* ---- 信息卡片 ---- */
    const range = m.hostBits >= 2 ? `${_snDotted(m.netInt + 1)} ~ ${_snDotted(m.bcastInt - 1)}` : '—';
    const maskNote = m.defaultBits !== null && m.prefix < m.defaultBits
      ? '短于默认掩码 → 超网' : `1 的个数 = ${m.prefix}`;
    const cards =
      RC408.ui.statCard('网络地址', _snDotted(m.netInt), `IP ∧ 掩码（主机位全 0）`, 'text-emerald-600') +
      RC408.ui.statCard('广播地址', _snDotted(m.bcastInt), '主机位全 1', 'text-rose-600') +
      RC408.ui.statCard('可用主机范围', range, m.hostBits >= 2 ? '首尾各去掉一个地址' : '主机号位数不足', 'text-blue-600') +
      RC408.ui.statCard('可用主机数', m.hostBits >= 2 ? `${m.usableHosts}` : '0', m.hostBits >= 2 ? `2^${m.hostBits} − 2` : '2^h − 2 ≤ 0', 'text-blue-600') +
      RC408.ui.statCard('子网掩码', _snDotted(m.maskInt), maskNote, 'text-slate-700') +
      RC408.ui.statCard('地址类别', `${m.cls} 类`, m.defaultBits ? `默认掩码 /${m.defaultBits}${m.clsNote ? ' · ' + m.clsNote : ''}` : (m.clsNote || '—'), 'text-indigo-600');

    /* ---- 位数统计条 ---- */
    const subChips = [
      `<span class="chip" style="background:#d1fae5;border-color:#6ee7b7;color:#065f46">🟢 网络号 ${m.greenBits} 位</span>`,
      `<span class="chip" style="background:#ffe4e6;border-color:#fda4af;color:#9f1239">🔴 子网号 ${m.subBits} 位（借自主机号）</span>`,
      `<span class="chip" style="background:#dbeafe;border-color:#93c5fd;color:#1e40af">🔵 主机号 ${m.hostBits} 位</span>`,
    ];
    if (m.subBits > 0) {
      subChips.push(`<span class="chip">子网数 2^${m.subBits} = ${Math.pow(2, m.subBits)}</span>`);
      subChips.push(`<span class="chip">每子网可用主机 ${m.usableHosts}</span>`);
    }

    /* ---- 特殊情形提示 ---- */
    const notes = [];
    if (m.clsNote) notes.push(m.clsNote);
    if (m.defaultBits !== null && m.prefix < m.defaultBits) {
      notes.push(`无类 CIDR 下前缀短于默认掩码是合法的——这叫超网 / 路由聚合：把 2^${m.defaultBits - m.prefix} = ${Math.pow(2, m.defaultBits - m.prefix)} 个连续 ${m.cls} 类网络合并成一个地址块对外只通告一条路由（2011/2018 选择、2024 大题考点）`);
    }
    if (m.addrMode === 'classful') {
      notes.push(`有类编址模式：${m.cls} 类前缀固定为 /${m.defaultBits}，滑块已限制下限${m.clamped ? '（刚才的短前缀已自动调整）' : ''}；如需体会"超网"，请切回无类 CIDR 模式`);
    }
    if (m.prefix === 31) notes.push('/31：按 RFC 3021 可用于点对点链路（教材公式 2¹−2 = 0）');
    if (m.prefix === 32) notes.push('/32：全 32 位为网络位，表示单个主机地址');
    if (m.hostBits === 1) notes.push('主机号仅 1 位：2¹ − 2 = 0，没有可用主机地址');

    stage.innerHTML = `
      <div class="space-y-4">

        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            ${RC408.ui.sectionTitle(`32 位二进制 —— 当前显示：${viewName}（颜色只与"网络号/子网号/主机号"的分界有关）`)}
            <div class="flex gap-1.5 flex-wrap">
              <span class="chip" style="background:#d1fae5;border-color:#6ee7b7;color:#065f46">绿 = 网络号</span>
              <span class="chip" style="background:#ffe4e6;border-color:#fda4af;color:#9f1239">红 = 子网号</span>
              <span class="chip" style="background:#dbeafe;border-color:#93c5fd;color:#1e40af">蓝 = 主机号</span>
            </div>
          </div>
          <div class="overflow-x-auto py-1">${rows}</div>
          <p class="text-[11px] text-slate-400 mt-2 text-center font-mono">${viewName} = ${_snDotted(dispInt)} → ${U.bin(dispInt, 32)}</p>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">${cards}</div>

        <div class="flex flex-wrap gap-1.5">${subChips.join('')}</div>

        ${notes.length ? `<div class="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800 leading-relaxed">
          💡 ${notes.map(U.esc).join('；')}
        </div>` : ''}
      </div>`;
  },
});

/* ---------------- 模块内部工具（前缀 sn 防止全局冲突） ---------------- */

/** 按 IP 第一字节判定类别与默认掩码位数（有类模式的滑块约束用） */
function _snClassOf(ipStr) {
  const o1 = parseInt((ipStr || '').split('.')[0], 10);
  if (!Number.isInteger(o1) || o1 < 0 || o1 > 255) return { defaultBits: null, cls: null };
  if (o1 < 128) return { defaultBits: 8, cls: 'A' };
  if (o1 < 192) return { defaultBits: 16, cls: 'B' };
  if (o1 < 224) return { defaultBits: 24, cls: 'C' };
  return { defaultBits: null, cls: o1 < 240 ? 'D' : 'E' };
}

/**
 * 三向同步的公共函数：以滑块当前值为准，刷新
 *   ① 掩码文本框（点分十进制）
 *   ② IP 输入框的 "/前缀" 后缀（无后缀则自动补上，直观呈现当前完整地址）
 *   ③ 滑块旁的 /N 徽标
 */
function _snSyncDisplays(els) {
  const p = parseInt(els.prefix.value, 10) || 0;
  els.mask.value = _snPrefixToMask(p);
  const ip = els.ip.value.trim();
  const bare = ip.includes('/') ? ip.replace(/\/\s*\d{1,2}\s*$/, '') : ip;
  els.ip.value = `${bare}/${p}`;
  const valEl = document.getElementById('in-prefix-val');
  if (valEl) valEl.textContent = '/' + p;
}

/** 点分十进制 → 32 位整数，非法则抛错 */
function _snParseIp(s) {
  const parts = s.split('.');
  if (parts.length !== 4) throw { message: `IP 地址「${s}」格式错误，应为 a.b.c.d` };
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || !Number.isInteger(v) || v < 0 || v > 255) {
      throw { message: `IP 地址中的「${p}」不是合法的 0~255 数字` };
    }
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** 点分十进制掩码 → 前缀长度；非法（1 不连续）返回 null */
function _snParseMask(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  n >>>= 0;
  // 数前导 1 的个数并验证掩码合法性（连续 1 后跟连续 0）
  let prefix = 0;
  for (let i = 31; i >= 0; i--) { if ((n >>> i) & 1) prefix++; else break; }
  const expect = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return n === expect ? prefix : null;
}

/** 前缀长度 → 点分十进制掩码 */
function _snPrefixToMask(p) {
  const n = p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0;
  return _snDotted(n);
}

/** 32 位整数 → 点分十进制 */
function _snDotted(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
