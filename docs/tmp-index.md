# tmp 归档脚本索引（**不是给最终用户看的**，给下一窗的窗口看）

> 读者：窗口｜必读：否｜相关：§3.5-18（留档清单）/ §3.9（流水线）
> 本文件由 `node tmp_make_index.js --write` **生成**（改类别就改脚本里的 `CATS`，别手改本文件）。

## 为什么根目录有一堆 `tmp_*`
- **留档，不是没收拾**：它们是"下一窗同类活直接照抄"的模板（§3.5-18 写明"都别删"），
  `.gitignore` 里 `tmp_*` 整条忽略，**不进仓库**。
- **开工的三条硬门不在根目录**（窗17 起）：`.dsh/skills/408-handover/scripts/gate.js`
  （一条命令跑完 `doc_check.py` + `tmp_readme_audit.js check` + `tmp_t14_probe.js`，任一红 exit 1）；
  逐条勾的清单在 `.dsh/skills/408-handover/references/`。
- **为什么不放进子目录**：`tmp_path_scan.js` 实测**过半脚本用 `__dirname` 定位**
  （其余用 `./js`、`docs/` 这类相对路径，从仓库根跑才行）。搬进子目录就得逐个改路径解析，
  **收益（顺眼）远小于风险（下一窗照抄时全部失效）**——所以根目录只放 `.js`，
  **大体积产物（txt）已挪到 `docs/archive/`**。当前文件数 / `__dirname` 占比**跑 `node tmp_path_scan.js` 现算**。
- **怎么保持不膨胀**：每窗收尾 `node tmp_tmp_audit.js`，把"引用 0 次"的按显式清单删掉（§3.5-18）。

## 冒烟模板（Node，离线跑 parse/buildSnapshots/render）
| 文件 | 用途 |
| --- | --- |
| `tmp_net_smoke.js` | net 模块（dns/http/mail/switch/routing/csma 家族）多模块共用框架，失败按类别聚合 |
| `tmp_nr_smoke.js` | **窗15 新增**：图 + 路由表类（net-routing）；含"边两两不相交"几何断言与量纲断言 |
| `tmp_mainmem_smoke.js` | 主存芯片扩展类（coa-mainmem） |
| `tmp_bc_md_smoke.js` | instant 计算器类（coa-baseconv / coa-muldiv） |
| `tmp_heap_smoke.js` | 树/堆类（ds-heap） |
| `tmp_sw_smoke.js` | 时序箭头类（net-switch / net-mail 前身） |
| `tmp_dp_smoke.js` | **窗20 新增**：**同族对照对**（ds-prim + ds-kruskal）——含跨割最小权独立重算、Kruskal 并查集、**暴力枚举**、**两模块互证**（边集/次序/总权值）、11 类非法输入 |

## 浏览器 harness（headless Chrome + CDP，**必须提权**）
| 文件 | 用途 |
| --- | --- |
| `tmp_t6_harness.js + tmp_t6_check.js` | 精简版：全站 96 条遍历 + CDP 异常 + 截图（纯文档窗首选）；`tmp_t6_check.js` 是它**生成的页面脚本**（每次 --run 重写） |
| `tmp_net_harness.js` | net 模块逐帧几何/压盖断言 + 多张原分辨率截图 |
| `tmp_nr_harness.js` | **窗15 新增**：用 #ctl-seek 直接 seek 的逐帧几何断言（截图走 UI） |
| `tmp_dp_harness.js + tmp_dp_check.js` | **窗20 新增**：**一个 harness 跑两个模块**（ds-prim + ds-kruskal）——SVG 越界 / 顶点圆压盖 / **权值标签两两压盖** / 表格与 chip 数 ↔ 快照 / 高亮行 = 快照 `cur` / 颜色与"根 X" = 快照；⚠ 每模块开跑前必须切 `Runner.def`（§6.2.18③） |
| `tmp_mainmem_harness.js` | 主存芯片扩展逐帧几何 |
| `tmp_heap_harness.js` | 堆逐帧几何 |
| `tmp_sw_harness.js` | 交换机时序箭头逐帧几何 |
| `tmp_t10_harness.js` | **理论区**：KaTeX 定界符桩 + 数学节点数（改了 framework/md/renderMath 必跑） |
| `tmp_t11_theory_harness.js` | **理论区**：三问开篇 / 考情块行数 / 考情条一致性 + 理论区截图 |

## 对账与体检（收尾必跑；都不是"硬门"，除注明外）
| 文件 | 用途 |
| --- | --- |
| `tmp_readme_audit.js` | README/注释 ↔ exam-history 四模式对账（`check` 必须 0 不一致） |
| `tmp_dup_audit.js` | 重复登记 + 火苗口径排查（`check` 必须 0 违规） |
| `tmp_orphan_audit.js` | **窗15 新增**：反向索引（数据 → 登记），模式 orphan/cover/year |
| `tmp_t14_probe.js` | handover 完整性探针（五个标题行首计数必须各 1） |
| `tmp_t16_probe.js` | **窗16 新增**：新模块 theory 结构 + 逐帧文案探针（改 MOD 即换模块） |
| `tmp_tmp_audit.js` | **窗16 扩源**：tmp 文件引用普查（在 handover/history/tmp-index 三处都没提到 = 可删） |
| `tmp_path_scan.js` | **窗15 新增**：tmp 脚本 __dirname 依赖普查（搬目录前先跑） |
| `tmp_t12_comment_scan.js` | exam-history 注释"N 年中 M 年"独立普查（交叉验证 readme_audit） |
| `tmp_t12_math_scan.js` | 模块 theory 数学定界符普查 |
| `tmp_t12_head_scan.js` | 模块头注释里的考情叙述逐条列出（治"theory 改了、头注释没改"） |
| `tmp_t12_heading_diff.js` | 与 handover 损坏留档做章节比对 |
| `tmp_t13_doc_metrics.js` | handover 上手成本度量（行数/字符/token 估算、交叉引用密度） |
| `tmp_t16_score.js` | **窗16 新增**：handover **分节体检/打分**（每节行数·字符·被引次数·溯源密度·判据密度·表格占比） |
| `tmp_t13_doccheck_selftest.js` | doc_check 第 12/13 项的注入自测（注错必须红 → 自动还原） |
| `tmp_t17_skill_selftest.js` | **窗17 新增**：doc_check **第 15 项**（skill ↔ handover 一致性）的注入自测 + `scripts/gate.js` 红路径 |
| `tmp_t17_cost.js` | **窗17 新增**：handover **必读链成本计量 + 棘轮**（`--check` 只许变小）——支线 §6.7 的口径 |

## 批量改写工具（改 theory / 文档的"数据 + 写入器"一对）
| 文件 | 用途 |
| --- | --- |
| `tmp_t14_theory.js + tmp_t14_apply.js` | **最新一对**：写盘前检查含"裸尖括号"；`--verify` 逐字复核 |
| `tmp_t13_theory.js + tmp_t13_apply.js` | 窗13 那一对（新增"三问齐 / 考情块 ≤2 行"前置检查） |
| `tmp_t12_theory.js + tmp_t12_apply.js` | 最早那一对（统一转义，消掉裸反引号/单反斜杠） |
| `tmp_t13_judge_test.js` | 判据自测（把 t10 的 outsideMath 原文抠出来 eval，5 个用例） |
| `tmp_t13_dump.js + tmp_t14_dump.js` | 一键导出"头注释 + 现 theory + 实算考情"到 txt |
| `tmp_t14_exam.js` | 现算考情摘要（每模块一行：年数 / 选 / 大 / 逐个年份-题号） |
| `tmp_t14_qprobe.js` | 批量核对"年份-题号 → 考点"（只读 考情缓存/） |
| `tmp_t13_retypeset.js` | 批量插节头 + 修标题粘连（锚点命中数 ≠ 1 就整体不写） |
| `tmp_t13_split_history.js` | 把 §6.6.1 巨型明细搬到 handover-history.md |
| `tmp_t16_trim.js` | **窗16 新增**：handover 减重器——按锚点区间搬 / 压 / 插（move·moveto·replace·insert，写盘前五条断言）；配套数据文件 tmp_t16_skill_section7.md |
| `tmp_t20_trim.js + tmp_t20_new361.md` | **窗20 新增**：把 §3.6.1 压成"倾向 → 对策"两列、**原文逐字搬进 `docs/handover-history.md`**（幂等，重复 --apply 不会追加两次）；配套数据文件是新正文 |
| `tmp_t13_wording_probe.js + tmp_t13_wording_fix.js` | 度量衡普查（先量）+ 归一化（再改） |
| `tmp_t10_check_static.js + tmp_t11_check_static.js` | t10/t11 harness 的**页面脚本**（由 harness 生成/引用） |

## 历史证据（只读留档，别再改；大体积 txt 见文末"归档区"）
| 文件 | 用途 |
| --- | --- |
| `tmp_dfs_bfs_audit.md` | 窗0 图遍历考情核对报告（.gitignore 注释里已注明留档） |

## 归档区 `docs/archive/`（大体积产物）
| 文件 | 用途 |
| --- | --- |
| `tmp_t13_old_theory.txt` | 窗13 体检前导出的旧 theory（改判依据） |
| `tmp_t14_old_theory.txt` | 窗14 体检前导出的旧 theory（改判依据） |
