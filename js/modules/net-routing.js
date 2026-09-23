'use strict';
/* ============================================================================
 * net-routing.js —— 【计算机网络】路由算法与协议（RIP 距离向量 / OSPF 链路状态） 前缀 _nr
 *
 * 考情（窗15 逐题回 考情缓存/ 现算）：**10/18 年（选 5 + 大 4）**
 *   选：2010-35、2012-37、2016-37、2017-37、2021-37、2026-37·38  ← 共 6 道，落在 5 个年份
 *   大：2009-47（路由表 + 默认路由 + 聚合小问）、2013-47、2014-42·43、2024-47
 *   （口径：只收"路由器交换路由信息 / 跑路由协议 / 算路由"的题；**本质是"地址与掩码计算 / 路由表查询"
 *    的选择题归 net-subnet**——2011-37 与 2015-38 因此**不在数据层重复登记**，见 exam-history 的注释；
 *    纯子网划分、ARP 换 MAC、IP 分片分别归 net-subnet / net-arp / net-fragment。）
 *
 * 数据模型与不变量（先钉死，再写实现 —— §3.9 P2）
 *   · 拓扑：无向图。顶点分两类——**路由器**（R 开头，至少 2 个、最多 6 个）与
 *     **目的网络**（其余名字，最多 4 个，可与路由器同名映射）；边可带权重 `R1-R2:2`。
 *   · **量纲（只有一套，不交叉）**：边权 = 该链路的代价（RIP 里就是跳数，恒为整数 ≥1）；
 *     路由器到某网络的"距离" = 路径上各边权之和。**没有单位换算**，故 §3.8-12 的两条量纲
 *     断言退化为一条：`Σ(某路径各边权) == 该路径的总距离`（冒烟里对每条最短路逐条验算）。
 *   · RIP（距离向量）：距离 = 跳数，**16 = 不可达**（RIP 的 ∞）；每轮各路由器拿邻居上一轮
 *     的通告重算；**水平分割**（默认开）：不把"下一跳就是它"的路由回送给它。
 *   · OSPF（链路状态）：先洪泛 LSA 直到所有路由器拿到**同一份链路状态数据库（LSDB）**，
 *     再各自跑 Dijkstra；**路由聚合**：同一路由器直连的多个网络若前缀可合并成更短前缀，
 *     合成 1 条（2026-37 与 2014-43 都靠这一步把路由项数压下来）。
 *   · 稳定帧 = `init` / `done`；过渡帧（update / flood / settle）里的中间状态不套"已收敛"公式。
 *
 * 快照步骤：init → round×N（每轮一帧，含逐路由器变更）→ linkdown → round×N → done
 *           或（OSPF）init → lsa×N → flood×N → lsdb → dijkstra×N → aggregate → done
 * 渲染：上=拓扑 SVG（路由器节点 + 目的网络节点 + 边权；当前帧动过的元素高亮），
 *       下=各路由器路由表并排（距离 / 下一跳，本帧变化绿底、∞ 红字）。
 * ========================================================================== */

RC408.registerModule({
  id: 'net-routing',
  mode: 'stepper',
  title: '路由算法与协议（RIP 距离向量 / OSPF 链路状态）',

  theory: `
> **为什么要有它**：路由表不是天生就有的——路由器靠**互相交换信息**把"到某个网络怎么走"算出来。两种思路就是两种协议：**RIP 只跟邻居换"我到各处的距离"**（距离向量），**OSPF 把"我连了谁"洪泛给全网**（链路状态）。
> **怎么实现**：距离向量每轮做一次 \\(d(x) = \\min_v \\{c(x,v) + d_v(y)\\}\\) 的松弛，所以**坏消息要一跳一跳地传**；链路状态先让全网拿到同一份拓扑，再各自跑 Dijkstra，收敛快、还能按区域分层。
> **记住什么**：**RIP 的 16 = 不可达**（跳数上限 15）+ **水平分割**抑制环路 + **OSPF 支持划分区域**、封装是 IP 协议号 89，而 RIP 走 **UDP 520**、BGP 走 **TCP 179**。

## 两种路由协议的内核

| 协议 | 类型 | 算法 | 交换什么 | 交换方式 | 封装 | 距离/开销 |
| --- | --- | --- | --- | --- | --- | --- |
| RIP | IGP | **距离向量** | 到各目的网络的**距离** | 30s 广播**整张表**给邻居 | **UDP 520** | 跳数，**16 = 不可达** |
| OSPF | IGP | **链路状态** + Dijkstra | **我连了谁、代价多少** | 洪泛 LSA 给**全网** | **IP**（协议号 89） | 可配权值（带宽等） |
| BGP | **EGP** | 路径向量（策略） | 到各 AS 的**完整路径** | 增量更新 | **TCP 179** | 策略优先，非最短 |

- **距离向量更新式**：\\(d_x(y) = \\min_v \\{ c(x,v) + d_v(y) \\}\\)——本路由器到 y 的距离 = 邻居 v 的距离 + 到 v 的链路代价，取最小。
- **链路状态三步**：① 发现邻居、测代价 ② 把"我连了谁"洪泛给全网（每台都拿到**同一份拓扑**）③ 各自跑 Dijkstra 得到以自己为根的最短路径树。
- **水平分割**（split horizon）：从某个接口学到的路由，**不再从这个接口通告回去**——这是 RIP 抑制环路最基本的一招。

## 考点提醒（易错点）
1. **RIP 的距离是跳数、16 表示不可达**：真题里凡是问"经某邻居到达某网络的跳数"，先看它是否 \\(\\ge 16\\)——是则**该邻居这条路根本不能用**（2010-35 就是这个陷阱）。
2. **坏消息传得慢**：链路断开后，邻居之间会**互相引用对方的旧路由**，距离一轮一轮往上涨（计数到无穷），要靠 16 这个上限才停下来——所以 RIP 只适合小网络（2016-37）。
3. **划分区域的是 OSPF**：RIP 是扁平的距离向量、不支持区域；BGP 是**外部**网关协议、用于 AS 之间（2026-38）。
4. **封装别记混**：RIP→UDP 520、BGP→TCP 179、OSPF→**直接装在 IP 里**（协议号 89），**没有传输层**（2017-37）。
5. **路由聚合能减少路由表项**：把前缀相同的连续网络合并成一条更短前缀的路由；题目问"路由项尽可能少"时，先做聚合再数条数（2014-43、2026-37）。
6. **最长前缀匹配 + 默认路由**：多条路由都匹配时选**掩码最长**的那条；默认路由 \\(0.0.0.0/0\\) 只在其它都不匹配时兜底（2015-38）。
7. **管理距离/选型**：自治系统内任意两点经过路由器数量不超过 15 可选 RIP；规模大或需要分区则用 OSPF（2024-47）。

> **真题考情**：**10/18 年（选 5 题 + 大 4 道）**：选 2010-35（RIP 跳数 17 不可达）、2012-37（IP 路由器功能）、2016-37（坏消息传得慢）、2017-37（RIP/OSPF/BGP 的封装）、2021-37（距离向量更新）、2026-37·38（链路状态重算 + 聚合后路由项数 / 能分区的 IGP）；大 2009-47、2013-47（聚合 + 最长匹配 + BGP）、2014-42·43（OSPF + 路由表 + 聚合）、2024-47（RIP/OSPF 选型 + 收敛时间 + BGP）。
`,

  inputs: [
    { key: 'edges', label: '拓扑边（路由器-路由器或路由器-网络:代价，每行一条）', type: 'textarea', rows: 7, wide: true,
      default: 'R1-R2:2\nR2-R3:2\nR3-R4:1\nR4-T:1' },
    { key: 'mode', label: '演示模式', type: 'select', default: 'rip',
      options: [{ v: 'rip', t: 'RIP · 距离向量（逐轮交换路由表）' }, { v: 'ospf', t: 'OSPF · 链路状态（洪泛 LSA + Dijkstra）' }] },
    { key: 'access', label: '运行 RIP（仅距离向量模式）', type: 'select', default: 'converge',
      options: [{ v: 'converge', t: '从零开始收敛（各路由器只知道直连网络）' },
        { v: 'badnews', t: '链路断开 · 坏消息逐跳往外传（无水平分割：可能计数到无穷）' },
        { v: 'split', t: '链路断开 · 水平分割抑制环路' }] },
    { key: 'cut', label: '断开的链路（仅"链路断开"两种运行）', type: 'text', default: 'R3-R4' },
    { key: 'split', label: '启用水平分割（split horizon）', type: 'select', default: 'on',
      options: [{ v: 'on', t: '启用（RIP 的实装做法）' }, { v: 'off', t: '关闭（看环路怎么形成）' }] },
    { key: 'agg', label: 'OSPF 模式做路由聚合', type: 'select', default: 'on',
      options: [{ v: 'on', t: '聚合相同前缀的连续网络（路由项更少）' }, { v: 'off', t: '不聚合（逐网络一条）' }] },
  ],

  quickActions: [
    { label: '🎲 RIP 从零收敛（4 台路由器 · 链式）', run(rt) {
      rt.setInput('edges', 'R1-R2:2\nR2-R3:2\nR3-R4:1\nR4-T:1');
      rt.setInput('mode', 'rip'); rt.setInput('access', 'converge'); rt.setInput('split', 'on'); rt.load();
    } },
    { label: '💥 坏消息逐跳传（R3-R4 断开 · 无水平分割）', run(rt) {
      rt.setInput('edges', 'R1-R2:2\nR2-R3:2\nR3-R4:1\nR4-T:1');
      rt.setInput('mode', 'rip'); rt.setInput('access', 'badnews'); rt.setInput('cut', 'R3-R4');
      rt.setInput('split', 'off'); rt.load();
    } },
    { label: '🛡 水平分割对照（同一断链 · 抑制环路）', run(rt) {
      rt.setInput('edges', 'R1-R2:2\nR2-R3:2\nR3-R4:1\nR4-T:1');
      rt.setInput('mode', 'rip'); rt.setInput('access', 'split'); rt.setInput('cut', 'R3-R4');
      rt.setInput('split', 'on'); rt.load();
    } },
    { label: '🗺 OSPF 洪泛 + Dijkstra + 路由聚合（2026-37 原型）', run(rt) {
      rt.setInput('edges', 'R1-R2:1\nR2-R3:1\nR3-R4:1\nR1-S1:2@192.168.2.0/24\nR1-S2:2@192.168.3.0/24\nR2-S3:1@192.168.4.0/24\nR2-S4:1@192.168.5.0/24\nR4-S5:3@192.168.6.0/24\nR4-S6:3@192.168.7.0/24');
      rt.setInput('mode', 'ospf'); rt.setInput('agg', 'on'); rt.load();
    } },
    { label: '🔀 OSPF 不聚合（对照：路由项变多）', run(rt) {
      rt.setInput('edges', 'R1-R2:1\nR2-R3:1\nR3-R4:1\nR1-S1:2@192.168.2.0/24\nR1-S2:2@192.168.3.0/24\nR2-S3:1@192.168.4.0/24\nR2-S4:1@192.168.5.0/24\nR4-S5:3@192.168.6.0/24\nR4-S6:3@192.168.7.0/24');
      rt.setInput('mode', 'ospf'); rt.setInput('agg', 'off'); rt.load();
    } },
  ],

  /* ------------------------------ 解析与校验 ------------------------------ */
  parse(vals) {
    const lines = String(vals.edges || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw { message: '拓扑不能为空：每行形如 R1-R2:2' };
    const edges = [], linkNets = {};
    const routerSet = new Set(), netSet = new Set();
    const edgeKey = (a, b) => [a, b].sort().join('|');
    const seen = new Set();

    lines.forEach((line, i) => {
      const m = line.match(/^([^-@:\s]+)-([^-@:\s]+)\s*:\s*([^@\s]+)\s*(?:@\s*(\S+))?$/);
      if (!m) throw { message: `第 ${i + 1} 行「${line}」格式错误，应为 R1-R2:2 或 R1-S1:2@192.168.2.0/24` };
      const a = m[1].trim(), b = m[2].trim();
      const w = Number(m[3]);
      if (!Number.isFinite(w) || w <= 0 || !Number.isInteger(w)) throw { message: `第 ${i + 1} 行代价「${m[3]}」须为正整数` };
      if (a === b) throw { message: `第 ${i + 1} 行两端相同（${a}），不能自环` };
      if (seen.has(edgeKey(a, b))) throw { message: `重复的边「${a}-${b}」` };
      seen.add(edgeKey(a, b));
      const isR = s => /^R\d+$/.test(s);
      const aR = isR(a), bR = isR(b);
      if (!aR && !bR) throw { message: `第 ${i + 1} 行「${a}-${b}」两端都是网络：网络必须经路由器相连` };
      const r = aR ? a : b, other = aR ? b : a;
      let netAddr = null;
      if (bR && aR) {
        /* 路由器 ↔ 路由器：都算路由器，代价即这条链路的开销 */
        routerSet.add(a); routerSet.add(b);
      } else {
        routerSet.add(r); netSet.add(other);
        if (m[4]) {
          if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(m[4])) throw { message: `第 ${i + 1} 行网络地址「${m[4]}」应形如 192.168.2.0/24` };
          if (!linkNets[other]) linkNets[other] = m[4];
          else if (linkNets[other] !== m[4]) throw { message: `网络 ${other} 同时标了两个地址（${linkNets[other]} / ${m[4]}）` };
          netAddr = m[4];
        }
      }
      edges.push({ a, b, w, r, net: other, netAddr, rr: aR && bR });
    });

    const routers = [...routerSet].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
    const nets = [...netSet].sort();
    if (routers.length < 2) throw { message: '至少需要 2 台路由器' };
    if (routers.length > 6) throw { message: `路由器最多 6 台（当前 ${routers.length}）` };
    if (nets.length > 6) throw { message: `目的网络最多 6 个（当前 ${nets.length}）` };
    routers.forEach(r => { if (Number(r.slice(1)) > 6) throw { message: `路由器编号须 R1~R6（收到 ${r}）` }; });

    /* 连通性：不能有孤立路由器（演示里它永远拿不到任何路由） */
    const adjR = {}, viaNet = {};
    routers.forEach(r => adjR[r] = []);
    nets.forEach(n => viaNet[n] = []);
    edges.forEach(e => {
      if (e.rr) { adjR[e.a].push(e.b); adjR[e.b].push(e.a); }
      else { adjR[e.r].push(e.net); viaNet[e.net].push(e.r); }
    });
    const seenR = new Set([routers[0]]), q = [routers[0]];
    while (q.length) {
      const r = q.shift();
      adjR[r].forEach(x => {
        if (viaNet[x]) viaNet[x].forEach(r2 => { if (!seenR.has(r2)) { seenR.add(r2); q.push(r2); } });
        else if (!seenR.has(x)) { seenR.add(x); q.push(x); }
      });
    }
    if (seenR.size !== routers.length) {
      throw { message: `路由器不连通：${routers.filter(r => !seenR.has(r)).join('、')} 与其余部分没有通路` };
    }

    const cut = String(vals.cut || '').trim();
    const mode = vals.mode === 'ospf' ? 'ospf' : 'rip';
    const access = ['converge', 'badnews', 'split'].includes(vals.access) ? vals.access : 'converge';
    if (mode === 'rip' && access !== 'converge') {
      if (!cut || cut.split('-').length !== 2) throw { message: '选择"链路断开"运行时必须填断开的链路，如 R3-R4' };
      const [c1, c2] = cut.split('-').map(s => s.trim());
      const hit = edges.find(e => (e.a === c1 && e.b === c2) || (e.a === c2 && e.b === c1));
      if (!hit) throw { message: `断开的链路「${cut}」不在拓扑里（应形如 R3-R4）` };
    }
    const cutEdge = (mode === 'rip' && access !== 'converge')
      ? (() => { const [c1, c2] = cut.split('-').map(s => s.trim()); return edges.find(e => (e.a === c1 && e.b === c2) || (e.a === c2 && e.b === c1)); })()
      : null;
    /* 断开的链路必须落在"网络侧"才有教学意义：断路由器-路由器会把网络那一侧孤立 */
    if (cutEdge && cutEdge.net) {
      /* 断的是 路由器-网络 边：其余路由器仍可从别的方向到达，合法 */
    }

    return { edges, routers, nets, linkNets, mode, access, cutEdge, split: vals.split !== 'off', agg: vals.agg !== 'off' };
  },

  /* ------------------------------ 快照 ------------------------------ */
  buildSnapshots(model) {
    const { edges, routers, nets } = model;
    const snaps = [];
    const INF = 16;

    const liveEdges = (cut) => edges.filter(e => !cut || !(cut.a === e.a && cut.b === e.b));
    /* 路由器的邻居分两类：别的路由器（rnbr）与直连网络（nets） */
    const nbrsOf = (r, cut) => {
      const rnbr = [], dn = [];
      liveEdges(cut).forEach(e => {
        if (e.rr) { if (e.a === r) rnbr.push(e.b); else if (e.b === r) rnbr.push(e.a); }
        else if (e.r === r) dn.push(e.net);
      });
      return { rnbr, dn };
    };

    /* ---------- RIP：距离向量 ---------- */
    if (model.mode === 'rip') {
      const dests = nets;
      const emptyTable = () => {
        const t = {};
        routers.forEach(r => { t[r] = {}; dests.forEach(d => t[r][d] = { d: INF, nh: '—' }); });
        return t;
      };
      const copyTable = t => { const o = {}; routers.forEach(r => { o[r] = {}; dests.forEach(d => o[r][d] = { ...t[r][d] }); }); return o; };
      /* 初始化只看"我直连了哪个网络"（路由器之间的链路只提供代价，不提供目的地） */
      const seedDirect = (t, cut) => {
        liveEdges(cut).forEach(e => { if (!e.rr) t[e.r][e.net] = { d: e.w, nh: e.net }; });
      };
      /* 从 u 经邻居 v 到达 d 的代价：v 是路由器 → v 的入接口 + 链路代价；v 是直连网络 → 只有链路代价 */
      const costVia = (u, v, d, w, t) => t[v] && d !== v ? t[v][d].d + w : (d === v ? w : INF);

      /* 一轮同步更新：各路由器用「邻居上一轮通告」重算（RFC1058 的分布式 Bellman-Ford）
         ① 经当前下一跳的路径若变差**必须跟着改**（坏消息传出去的起点）
         ② 其它邻居只有"更短"才会改（好消息收敛）
         ③ 若通告里的下一跳把自己当下一跳（互相引用）→ 距离置 16，环路就此断开 */
      const ripRound = (t, cut, split) => {
        const adv = {};
        routers.forEach(r => { adv[r] = {}; dests.forEach(d => adv[r][d] = t[r][d].d); });
        const nt = copyTable(t), chg = [];
        const set = (u, d, val, nh, from) => {
          if (nt[u][d].d === val && nt[u][d].nh === nh) return;
          chg.push({ r: u, d, from, to: val, nh });
          nt[u][d] = { d: val, nh };
        };
        routers.forEach(u => {
          const { rnbr, dn } = nbrsOf(u, cut);
          dests.forEach(d => {
            /* 先看直连网络（代价最直接） */
            if (dn.includes(d)) { set(u, d, Math.min(edgeW(u, d), INF), d, t[u][d].d); }
            /* 再看其它路由器通告过来的路由 */
            rnbr.forEach(v => {
              const w = edgeW(u, v);
              const viaThis = t[u][d].nh === v;
              if (split && t[v] && t[v][d].nh === u) return;             // 水平分割：不回送给下一跳
              if (!split && t[v] && t[v][d].nh === u) {
                /* 没有水平分割时：邻居的下一跳还是我，但它通告的已是"绕我走"的旧值
                   → 双方同时改指对方，距离一轮一轮往上涨（**计数到无穷**），涨到 16 才停 */
                if (viaThis) set(u, d, Math.min(adv[v][d] + w, INF), v, t[u][d].d);
                return;
              }
              if (t[v] && t[v][d].d >= INF) { if (viaThis) set(u, d, INF, '—', t[u][d].d); return; }
              const cand = Math.min(adv[v][d] + w, INF);
              if (viaThis) set(u, d, cand, cand >= INF ? '—' : v, t[u][d].d);
              else if (cand < nt[u][d].d) set(u, d, cand, v, t[u][d].d);
            });
          });
        });
        return { t: nt, chg };
      };
      const edgeW = (x, y) => {
        const e = edges.find(z => (z.a === x && z.b === y) || (z.a === y && z.b === x));
        return e ? e.w : INF;
      };

      const net2 = () => dests.map(d => `${d}(直连 ${edges.filter(e => e.net === d).map(e => e.r).join('/')})`).join('；');
      let table = emptyTable(), cut = null, round = 0;

      if (model.access === 'converge') {
        seedDirect(table, null);
        snaps.push({ step: 'init', mode: 'rip', table: copyTable(table), routers, nets, edges, cut: null, round: 0, chg: [],
          log: `RIP 就绪：每台路由器**只知道直连网络**——${net2()}。其余目的网络距离记为 16（不可达）。`,
          logType: 'info', desc: '单步执行：看路由器如何一跳一跳地把"远处网络"的距离学过来' });
        let guard = 0;
        while (guard++ < 40) {
          round++;
          const { t, chg } = ripRound(table, null, model.split);
          table = t;
          /* 轮数可能很多（无水平分割时距离会一轮轮往上涨），从第 16 轮起每 3 轮只留一帧，
             避免快照数爆炸——但每一轮都真的算过，只是不逐轮展示 */
          const keep = round <= 15 || round % 3 === 0 || !chg.length;
          if (keep) snaps.push({
            step: 'round', mode: 'rip', table: copyTable(table), routers, nets, edges, cut: null, round, chg,
            log: chg.length
              ? `第 ${round} 轮：${chg.map(c => `${c.r} 到 ${c.d} 距离 ${c.from >= INF ? '∞' : c.from} → ${c.to >= INF ? '∞' : c.to}（下一跳 ${c.nh}）`).join('；')}`
              : `第 ${round} 轮：各路由器通告与上一轮相同，**路由表已收敛**（距离不再变化）。`,
            logType: chg.length ? 'info' : 'success',
            desc: chg.length ? `第 ${round} 轮：${chg.length} 处距离更新（绿色格子 = 本帧变化）` : `第 ${round} 轮：收敛，全表稳定`,
          });
          if (!chg.length) break;
        }
        snaps.push({
          step: 'done', mode: 'rip', table: copyTable(table), routers, nets, edges, cut: null, round, chg: [],
          log: `完成：${round} 轮后全表稳定——${dests.map(d => `${d} 的距离为 ${routers.map(r => `${r}=${table[r][d].d >= INF ? '∞' : table[r][d].d}`).join('/')}`).join('；')}。距离向量就是靠这种"邻居之间互相通告"逐跳把远处网络学过来的。`,
          logType: 'success', desc: `收敛完成（共 ${round} 轮）`,
        });
      } else {
        /* 先按"已收敛"初始化，再断链 —— 这正是真题里"网络运行一段时间后某链路断开"的场景 */
        seedDirect(table, null);
        for (let i = 0; i < 12; i++) {
          const { t, chg } = ripRound(table, null, true);
          table = t; if (!chg.length) break;
        }
        const converged = copyTable(table);
        snaps.push({ step: 'init', mode: 'rip', table: copyTable(table), routers, nets, edges, cut: null, round: 0, chg: [],
          log: `RIP 先正常收敛（${net2()}），随后断开链路 **${model.cutEdge.a}-${model.cutEdge.b}**。`,
          logType: 'info', desc: '单步执行：看断链后距离如何一轮一轮地"坏消息慢慢传"' });

        cut = { a: model.cutEdge.a, b: model.cutEdge.b };
        /* 断链瞬间：这条链路的**两个端点路由器**立刻把它学到的、下一跳指向对方的那些路由置为 16
           （接口 down → 不等 30s 周期，直接发触发更新）——这是"坏消息"的起点 */
        const trig = [];
        const ends = routers.filter(r => r === model.cutEdge.a || r === model.cutEdge.b);
        ends.forEach(u => {
          const other = u === model.cutEdge.a ? model.cutEdge.b : model.cutEdge.a;
          dests.forEach(d => {
            if (table[u][d] && table[u][d].nh === other) {
              trig.push({ r: u, d, from: table[u][d].d, to: INF, nh: '—' });
              table[u][d] = { d: INF, nh: '—' };
            }
          });
        });
        snaps.push({ step: 'linkdown', mode: 'rip', table: copyTable(table), routers, nets, edges, cut, round: 0, chg: trig,
          log: `⚠ 链路 ${cut.a}-${cut.b} 断开：直连它的路由器立即把该路由置为 16（不可达）并发出**触发更新**。`,
          logType: 'warn', desc: `断链：${cut.a}-${cut.b}（虚线红边）——注意"坏消息"是从这里开始往外传的` });

        let guard = 0;
        while (guard++ < 40) {
          round++;
          const { t, chg } = ripRound(table, cut, model.split);
          table = t;
          const keep = round <= 15 || round % 3 === 0 || !chg.length;
          if (keep) snaps.push({ step: 'round', mode: 'rip', table: copyTable(table), routers, nets, edges, cut, round, chg,
            log: chg.length
              ? `第 ${round} 轮：${chg.map(c => `${c.r} 到 ${c.d} 距离 ${c.from >= INF ? '∞' : c.from} → ${c.to >= INF ? '∞' : c.to}（下一跳 ${c.nh}）`).join('；')}`
              : `第 ${round} 轮：无变化 → 收敛。`,
            logType: chg.length ? 'info' : 'success',
            desc: chg.length ? `第 ${round} 轮：${chg.length} 处变化` : `第 ${round} 轮：收敛` });
          if (!chg.length) break;
        }
        const finalBad = dests.some(d => routers.every(r => table[r][d].d >= INF));
        const stable = snaps[snaps.length - 1].step === 'round' && snaps[snaps.length - 1].chg.length === 0;
        snaps.push({ step: 'done', mode: 'rip', table: copyTable(table), routers, nets, edges, cut, round, chg: [],
          log: model.split
            ? `完成：**水平分割**让邻居不再把"下一跳就是它"的路由回送回去，环路从源头被抑制；坏消息顺着链路 ${round} 轮传到最上游${stable ? '' : '（本拓扑在 40 轮内仍未完全稳定，属"计数到无穷"的典型表现）'}。`
            : `完成：无水平分割时邻居会互相引用旧路由，距离一轮一轮往上涨（**计数到无穷**），涨到 **16（不可达）**才停${finalBad ? '' : '（本拓扑里仍有别的通路，所以没涨到 16）'}——这就是"坏消息传得慢"，也是 RIP 只适合小网络的原因。`,
          logType: 'success',
          desc: model.split ? `收敛（${round} 轮）：水平分割抑制了环路` : `收敛（${round} 轮）：坏消息一跳一跳往外传` });
      }
      return snaps;
    }

    /* ---------- OSPF：链路状态 ---------- */
    const lsaOf = r => liveEdges(null).filter(e => e.r === r).map(e => ({ to: e.net, w: e.w, addr: e.netAddr || null }));
    const lsas = {};
    routers.forEach(r => lsas[r] = lsaOf(r));

    snaps.push({ step: 'init', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: {}, lsdb: {}, tree: null, rt: null, agg: null, cut: null,
      log: `OSPF 就绪：每台路由器先探测直连链路，各自生成一份链路状态通告（LSA）——LSA(R1) 含 ${lsas[routers[0]].map(x => `${x.to}(${x.w})`).join('、')} 等。`,
      logType: 'info', desc: '单步执行：先把"我连了谁"洪泛到全网，再各自跑 Dijkstra' });

    const flooded = {};
    routers.forEach(r => {
      flooded[r] = { [r]: true };
      const newly = [];
      routers.forEach(o => { if (o !== r) { flooded[r][o] = true; newly.push(o); } });
      snaps.push({ step: 'flood', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: JSON.parse(JSON.stringify(flooded)), lsdb: null, tree: null, rt: null, agg: null, cut: null, src: r, newly,
        log: `洪泛 LSA(${r})：${r} 把它那份"我连了谁"发给**所有邻居**，邻居再转发给它们的邻居，直到全网每台路由器都收到（第 ${routers.indexOf(r) + 1}/${routers.length} 份）。`,
        logType: 'info', desc: `洪泛第 ${routers.indexOf(r) + 1} 份 LSA（来自 ${r}）` });
    });
    const allFlooded = {};
    routers.forEach(r => { allFlooded[r] = {}; routers.forEach(o => allFlooded[r][o] = true); });
    snaps.push({ step: 'lsdb', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: allFlooded, lsdb: lsas, tree: null, rt: null, agg: null, cut: null,
      log: `洪泛完成：**每台路由器的链路状态数据库（LSDB）完全一致**——都等于整张拓扑（共 ${edges.length} 条链路、${routers.length} 台路由器）。这是链路状态与距离向量最本质的区别。`,
      logType: 'success', desc: 'LSDB 同步完成：全网拓扑一致' });

    /* Dijkstra：以 R1 为根，逐轮确定 */
    const root = routers[0];
    const dist = {}, prev = {}, settled = [];
    const netNames = nets.concat(routers);
    netNames.forEach(n => { dist[n] = n === root ? 0 : Infinity; prev[n] = null; });
    const dCopy = () => { const o = {}; netNames.forEach(n => o[n] = dist[n] === Infinity ? '∞' : dist[n]); return o; };
    const edgeBetween = (u, v) => edges.find(e => (e.r === u && e.net === v) || (e.r === v && e.net === u));
    snaps.push({ step: 'dijkstra', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: allFlooded, lsdb: lsas, root, dist: dCopy(), settled: [], cur: null, relaxed: [], tree: null, rt: null, agg: null, cut: null,
      log: `以 ${root} 为根跑 Dijkstra：dist[${root}] = 0，其余为 ∞；每轮取未确定者中 dist 最小的一台。`,
      logType: 'info', desc: `Dijkstra 起点：根 = ${root}` });
    for (let i = 0; i < netNames.length; i++) {
      let u = null;
      netNames.forEach(n => { if (!settled.includes(n) && dist[n] !== Infinity && (u === null || dist[n] < dist[u])) u = n; });
      if (u === null) break;
      settled.push(u);
      const relaxed = [];
      edges.filter(e => e.r === u || e.net === u).forEach(e => {
        const v = e.r === u ? e.net : e.r;
        if (settled.includes(v)) return;
        const nd = dist[u] + e.w;
        relaxed.push({ v, via: u, old: dist[v] === Infinity ? '∞' : dist[v], nw: nd, ok: nd < dist[v] });
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
      });
      snaps.push({ step: 'dijkstra', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: allFlooded, lsdb: lsas, root, dist: dCopy(), settled: [...settled], cur: u, relaxed, tree: null, rt: null, agg: null, cut: null,
        log: `确定 ${u}（dist = ${dist[u]}）${relaxed.length ? '，松弛其邻接：' + relaxed.map(r => `${r.v} ${r.old}→${r.nw}${r.ok ? ' ✓' : '（未更优）'}`).join('；') : ''}`,
        logType: 'info', desc: `Dijkstra：确定 ${u}（当前最短距离 ${dist[u]}）` });
    }
    const treeEdges = Object.keys(prev).filter(v => prev[v]).map(v => ({ v, u: prev[v] }));
    snaps.push({ step: 'tree', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: allFlooded, lsdb: lsas, root, dist: dCopy(), settled: [...settled], cur: null, relaxed: [], tree: treeEdges, rt: null, agg: null, cut: null,
      log: `最短路径树就绪：${root} 到各目的网络的距离 ${nets.map(n => `${n} = ${dist[n] === Infinity ? '∞' : dist[n]}`).join('，')}（绿色加粗 = 树边）。`,
      logType: 'success', desc: `以 ${root} 为根的最短路径树（绿边）` });

    const rtRows = nets.map(n => ({ d: model.linkNets[n] || n, name: n, dist: dist[n], nh: prev[n] === undefined ? '—' : (prev[n] || '直连') }));
    snaps.push({ step: 'rt', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: allFlooded, lsdb: lsas, root, dist: dCopy(), prev: { ...prev }, settled: [...settled], cur: null, relaxed: [], tree: treeEdges, rt: rtRows, agg: null, cut: null,
      log: `逐网络的路由表：${rtRows.map(r => `${r.d} → ${r.dist === Infinity ? '∞' : r.dist}（下一跳 ${r.nh}）`).join('；')}。`,
      logType: 'info', desc: '按"一个网络一条路由"列出的路由表（聚合前）' });

    const aggGroups = aggregate(rtRows);
    const aggRows = aggGroups.map(g => ({ d: g.prefix, names: g.names, dist: g.dist, nh: g.nh }));
    snaps.push({ step: 'aggregate', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: allFlooded, lsdb: lsas, root, dist: dCopy(), settled: [...settled], cur: null, relaxed: [], tree: treeEdges, rt: rtRows, agg: model.agg ? aggRows : null, cut: null,
      log: model.agg
        ? `路由聚合：${aggGroups.filter(g => g.names.length > 1).map(g => `${g.names.map(n => model.linkNets[n] || n).join(' + ')} ⟹ ${g.prefix}`).join('；') || '（无需合并）'} ⟹ 路由项 **${nets.length} → ${aggRows.length}**（2026-37 与 2014-43 就是这个考点）。`
        : `关闭聚合：保持"一个网络一条路由"，共 ${rtRows.length} 项（打开聚合可压到 ${aggregate(rtRows).length} 项）。`,
      logType: 'success',
      desc: model.agg ? `聚合后路由项 ${nets.length} → ${aggRows.length}` : '未聚合：逐网络列出' });
    snaps.push({ step: 'done', mode: 'ospf', chg: [], routers, nets, edges, lsas, flooded: allFlooded, lsdb: lsas, root, dist: dCopy(), settled: [...settled], cur: null, relaxed: [], tree: treeEdges, rt: rtRows, agg: model.agg ? aggRows : null, cut: null,
      log: `完成：链路状态协议先"全网同步拓扑"再"各自算最短路"，收敛快且没有环路；封装是 IP（协议号 89），支持划分区域——2026-38 考的就是这一条。`,
      logType: 'success', desc: '完成：LSDB 一致 + Dijkstra + 路由聚合' });
    return snaps;

    /* 路由聚合：先按 /24 分组，再把"连续且合并后前缀更短"的两条合成一条（贪心，反复直到不能再合） */
    function aggregate(rows) {
      let groups = rows.filter(r => /\/\d+$/.test(r.d)).map(r => {
        const [ip, len] = r.d.split('/');
        return { prefix: r.d, ip, len: Number(len), names: [r.name], dist: r.dist, nh: r.nh, members: [ipToInt(ip)] };
      });
      /* 没带网络地址的（拓扑里写的是 N1 这种符号名）原样保留，但**字段形状必须和分组一致**
         （都带 names 数组）——否则后面 `g.names.length` 会 TypeError（窗15 冒烟实测抓到） */
      const rest = rows.filter(r => !/\/\d+$/.test(r.d))
        .map(r => ({ prefix: r.d, ip: null, len: null, names: [r.name], dist: r.dist, nh: r.nh, members: [] }));
      let merged = true;
      while (merged) {
        merged = false;
        /* 在所有可合并的两两组合里挑"公共前缀最长"的那对合并（贪心 + 最近邻配对）：
           先并 S1+S2、S3+S4，再由 /23 并成 /22，避免先并成不相邻的一对被卡在局部最优 */
        let best = null;
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            const a = groups[i], b = groups[j];
            if (a.len !== b.len || a.nh !== b.nh || a.dist !== b.dist) continue;
            const m = commonPrefixLen(a, b);
            if (m < a.len - 1) continue;
            const len = a.len - 1;
            const all = a.members.concat(b.members).sort((x, y) => x - y);
            const base = ((all[0] >>> (32 - len)) << (32 - len)) >>> 0;   // ⚠ 必须 >>>0：<< 的结果是有符号 32 位，会出现负数
            const span = Math.pow(2, 32 - len) / 256;          // 该前缀能覆盖多少个 /24
            /* 只有当两块刚好拼成一个完整的更短前缀（连续地址块）时才合并，
               否则 192.168.2.0/24 + 192.168.4.0/24 会被"合并"成 /30——那并不代表它们 */
            const last = (base + (span - 1) * 256) >>> 0;
            if (all.length !== span || all[0] !== base || all[all.length - 1] !== last) continue;
            const score = m * 100 + 10;
            if (!best || score > best.score) best = { i, j, a, b, len, score, base, all };
          }
        }
        if (best) {
          const { i, j, a, b, len, base, all } = best;
          const g = {
            prefix: intToIp(base) + '/' + len, ip: intToIp(base), len,
            names: a.names.concat(b.names), dist: a.dist, nh: a.nh, members: all,
          };
          groups = groups.filter((_, k) => k !== i && k !== j).concat([g]);
          merged = true;
        }
      }
      return rest.concat(groups.sort((x, y) => x.prefix < y.prefix ? -1 : 1));
    }
    function ipToInt(ip) {
      return ip.split('.').reduce((s, x) => ((s << 8) >>> 0) + Number(x), 0) >>> 0;
    }
    function intToIp(n) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
    function commonPrefixLen(a, b) {
      let best = 0;
      a.members.forEach(x => b.members.forEach(y => {
        let z = (x ^ y) >>> 0, bits = 0;
        for (let k = 31; k >= 0; k--) { if ((z >>> k) & 1) break; bits++; }
        if (bits > best) best = bits;
      }));
      return best;
    }
  },

  /* ------------------------------ 渲染 ------------------------------ */
  render(ctx) {
    const { snap: s, model } = ctx;
    const edges = s.edges || model.edges;
    const routers = s.routers || model.routers;
    const nets = orderNets(s.nets || model.nets, routers, edges);
    const W = 1020, H = 300;
    const pos = topologyLayout(routers, nets, edges);
    const cut = s.cut;

    /* ----- 拓扑 ----- */
    const edgeSvg = edges.map(e => {
      const p = pos[e.rr ? e.a : e.r], q = pos[e.rr ? e.b : e.net];
      const isCut = cut && ((cut.a === e.a && cut.b === e.b) || (cut.a === e.b && cut.b === e.a));
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      const lab = e.rr ? { x: mx, y: my - 8 } : { x: mx + 6, y: my - 5 };
      return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="nr-edge" stroke="${isCut ? '#f43f5e' : '#cbd5e1'}" stroke-width="${isCut ? 3 : 2.5}" ${isCut ? 'stroke-dasharray="7 5"' : ''}/>
        ${isCut ? `<text x="${mx}" y="${my - 20}" text-anchor="middle" class="nr-cut" style="font:700 11px sans-serif" fill="#e11d48">✕ 断开</text>` : ''}
        <text x="${lab.x}" y="${lab.y}" text-anchor="${e.rr ? 'middle' : 'start'}" class="nr-w" style="font:700 11px Consolas" fill="${isCut ? '#fb7185' : '#64748b'}" stroke="#fff" stroke-width="3" paint-order="stroke">${e.w}</text>`;
    }).join('');

    const nodeSvg = routers.map(r => {
      const p = pos[r];
      const items = s.rt && s.root === r ? s.rt.length : (s.table && s.table[r] ? Object.values(s.table[r]).filter(x => x.d < 16).length : null);
      const txt = items === null ? r : `${r} · ${items} 项`;
      const w = 96, h = 34;
      return `<g class="nr-router">
        <rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="9" fill="#eef2ff" stroke="${r === s.root ? '#4f46e5' : '#c7d2fe'}" stroke-width="${r === s.root ? 3 : 2}"/>
        <text x="${p.x}" y="${p.y + 4}" text-anchor="middle" class="nr-router-text" style="font:700 12px Consolas" fill="#3730a3">${txt}</text></g>`;
    }).join('');

    const netSvg = nets.map(n => {
      const p = pos[n];
      const addr = (model.linkNets && model.linkNets[n]) || n;
      /* 框宽按最长那行文字估（地址 10px 等宽 ≈6.6px/字符；名字行 10px 无衬线 ≈6.0px/字符），
         再给 16px 内边距——不按最长文字算的话 6 个网络并排必然横向压盖（§3.3-21） */
      const w = Math.max(92, addr.length * 6.6 + 16, n.length * 6.0 + 16), h = 34;
      const same = addr === n;                       // 拓扑没写网络地址时两行会一样，只显示一行
      return `<g class="nr-net">
        <rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="8" fill="#f0fdfa" stroke="#5eead4" stroke-width="2"/>
        <text x="${p.x}" y="${p.y + (same ? 4 : -2)}" text-anchor="middle" class="nr-net-addr" style="font:700 10px Consolas" fill="#0f766e">${RC408.util.esc(addr)}</text>
        ${same ? '' : `<text x="${p.x}" y="${p.y + 11}" text-anchor="middle" class="nr-net-name" style="font:600 10px sans-serif" fill="#14b8a6">${RC408.util.esc(n)}</text>`}</g>`;
    }).join('');

    const treeSvg = (s.tree || []).map(t => {
      const p = pos[t.u], q = pos[t.v];
      if (!p || !q) return '';
      return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="nr-tree-edge" stroke="#10b981" stroke-width="5" opacity="0.55"/>`;
    }).join('');

    /* ----- 路由表（并排） ----- */
    const tableCards = routers.map(r => {
      const rows = s.table
        ? Object.keys(s.table[r]).map(d => {
          const e2 = s.table[r][d];
          const ch = (s.chg || []).find(c => c.r === r && c.d === d);
          return `<tr class="${ch ? 'bg-emerald-50' : ''}">
            <td class="font-mono">${RC408.util.esc(d)}</td>
            <td class="font-mono ${e2.d >= 16 ? 'text-rose-600 font-bold' : ''}">${e2.d >= 16 ? '∞' : e2.d}</td>
            <td class="font-mono text-slate-500">${RC408.util.esc(e2.nh)}</td>
            <td class="text-[10px] ${ch ? 'text-emerald-600 font-bold' : 'text-slate-300'}">${ch ? `${ch.from >= 16 ? '∞' : ch.from}→${ch.to >= 16 ? '∞' : ch.to}` : '—'}</td></tr>`;
        }).join('')
        : '';
      return `<div class="rounded-xl border border-slate-200 bg-white p-2">
        <div class="text-[11px] font-bold text-indigo-700 mb-1">${r} 的路由表</div>
        <table class="tbl w-full text-[11px]"><thead><tr><th>目的</th><th>距离</th><th>下一跳</th><th>本帧</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');

    /* OSPF 侧：LSDB / 路由表 / 聚合 */
    const lsdbSvg = s.mode === 'ospf' && s.lsas ? (() => {
      const holder = s.src && s.flooded ? s.src : null;
      const have = holder ? s.flooded[holder] : allTrue(routers);
      const rows = routers.map(r => {
        const got = have[r];
        return `<tr class="${got ? '' : 'opacity-30'}"><td class="font-mono">${r}</td>
          <td class="font-mono text-[10px]">${s.lsas[r].map(x => `${x.to}(${x.w})`).join('、')}</td>
          <td class="text-center">${got ? '✓' : '—'}</td></tr>`;
      }).join('');
      return `<div>${RC408.ui.sectionTitle(holder ? `LSA 洪泛（高亮 = 刚收到的第 ${routers.indexOf(holder) + 1} 份，来自 ${holder}）` : '链路状态数据库 LSDB（全网一致）')}
        <table class="tbl w-full text-[11px]"><thead><tr><th>路由器</th><th>LSA 内容（我连了谁 · 代价）</th><th>已收到</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    })() : '';

    const rtSvg = s.mode === 'ospf' && s.rt ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>${RC408.ui.sectionTitle('以 ' + s.root + ' 为根的路由表（逐网络 · 聚合前）')}
        <table class="tbl w-full text-[11px]"><thead><tr><th>目的网络</th><th>距离</th><th>下一跳</th></tr></thead><tbody>
        ${s.rt.map(r => `<tr><td class="font-mono">${r.d}</td><td class="font-mono">${r.dist === Infinity ? '∞' : r.dist}</td><td class="font-mono text-slate-500">${r.nh}</td></tr>`).join('')}
        </tbody></table></div>
      <div>${RC408.ui.sectionTitle('路由聚合后的路由表')}
        ${s.agg ? `<table class="tbl w-full text-[11px]"><thead><tr><th>聚合前缀</th><th>合并了</th><th>下一跳</th></tr></thead><tbody>
          ${s.agg.map(g => `<tr><td class="font-mono font-bold text-emerald-700">${g.d}</td><td class="text-[10px] text-slate-500">${g.names.length > 1 ? g.names.join(' + ') : g.names[0]}</td><td class="font-mono">${g.nh}</td></tr>`).join('')}
          </tbody></table><div class="text-[11px] text-emerald-700 mt-1 font-bold">路由项 ${s.rt.length} → ${s.agg.length}（2026-37 / 2014-43 就是这个考点）</div>`
        : '<div class="text-xs text-slate-400">（本帧未打开聚合：逐网络一条）</div>'}</div>
      </div>` : '';

    const distSvg = s.mode === 'ospf' && s.dist ? (() => {
      const names = routers.concat(nets);
      return `<div>${RC408.ui.sectionTitle('Dijkstra 距离表（根 = ' + s.root + '）')}
        <div class="flex flex-wrap gap-1.5">${names.map(n => {
        const isCur = s.cur === n, done = (s.settled || []).includes(n);
        const v = s.dist[n];
        return RC408.ui.chip(`${n}:${v}`, isCur ? 'chip-warn' : done ? 'chip-hit' : '', isCur ? '本帧确定' : '');
      }).join('')}</div></div>`;
    })() : '';

    const stats =
      RC408.ui.statCard('协议', s.mode === 'ospf' ? 'OSPF' : 'RIP', s.mode === 'ospf' ? '链路状态 · IP(89)' : '距离向量 · UDP 520', 'text-indigo-600') +
      RC408.ui.statCard('路由器 / 网络', `${routers.length} / ${nets.length}`, `链路 ${edges.length} 条`, 'text-slate-600') +
      RC408.ui.statCard('水平分割', model.split ? '启用' : '关闭', 'RIP 抑制环路用', model.split ? 'text-emerald-600' : 'text-rose-600') +
      (s.mode === 'rip'
        ? RC408.ui.statCard('轮次', String(s.round || 0), s.round ? '每轮 = 一次整表通告' : '尚未开始交换', 'text-amber-600')
        : RC408.ui.statCard('路由项', s.agg ? `${s.rt.length} → ${s.agg.length}` : String(s.rt ? s.rt.length : '—'), '聚合前 → 聚合后', 'text-emerald-600'));

    ctx.stage.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${stats}</div>
        <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 overflow-x-auto">
          <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto mx-auto" style="max-width:${W}px">${treeSvg}${edgeSvg}${nodeSvg}${netSvg}</svg>
        </div>
        ${lsdbSvg}
        ${distSvg}
        ${s.mode === 'rip' ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">${tableCards}</div>` : ''}
        ${rtSvg}
        <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
          ${RC408.ui.legend('#eef2ff', '路由器（框内 = 已学到几条路由）')}
          ${RC408.ui.legend('#f0fdfa', '目的网络（小字 = 网络地址）')}
          ${RC408.ui.legend('#f43f5e', '断开的链路（虚线）')}
          ${s.mode === 'ospf' ? RC408.ui.legend('#10b981', '最短路径树（Dijkstra 结果）') : RC408.ui.legend('#10b981', '本帧刚变化的距离（绿底行）')}
        </div>
      </div>`;
  },
});

/* 拓扑布局：路由器一排在上、网络一排在下（冒烟里断言"任意两条边不相交"）
   —— 坐标固定，便于几何断言：边只在"上带 / 中带 / 下带"里，两条边相交只可能发生在中带。 */
function topologyLayout(routers, nets, edges) {
  const W = 1020, H = 300, pos = {};
  const rN = routers.length, nN = nets.length;
  const rx0 = 80, rx1 = W - 130;
  routers.forEach((r, i) => { pos[r] = { x: rN === 1 ? W / 2 : rx0 + (rx1 - rx0) * i / (rN - 1), y: 66 }; });
  /* 每个网络一个槽位：即使只有 4 个网络也按 6 个槽位的宽度铺，最多 6 个时正好铺满 */
  const step = Math.min(150, nN > 1 ? (W - 260) / (nN - 1) : 0);
  const x0 = W / 2 - step * (nN - 1) / 2;
  nets.forEach((n, i) => { pos[n] = { x: nN === 1 ? W / 2 : x0 + step * i, y: 232 }; });
  return pos;
}
RC408._nrLayout = topologyLayout;
/* 网络节点的左右顺序：按"它连到哪些路由器"的平均位置排，避免两条边在中带相交（冒烟里有断言） */
function orderNets(nets, routers, edges) {
  const idx = {};
  routers.forEach((r, i) => idx[r] = i);
  return [...nets].sort((a, b) => {
    const ma = edges.filter(e => !e.rr && e.net === a).map(e => idx[e.r]);
    const mb = edges.filter(e => !e.rr && e.net === b).map(e => idx[e.r]);
    const av = ma.length ? ma.reduce((s, x) => s + x, 0) / ma.length : 0;
    const bv = mb.length ? mb.reduce((s, x) => s + x, 0) / mb.length : 0;
    return av - bv || (a < b ? -1 : 1);
  });
}
function allTrue(routers) {
  const o = {};
  routers.forEach(r => { o[r] = true; });
  return o;
}
