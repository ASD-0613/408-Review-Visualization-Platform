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
| `tmp_t24_anno_smoke.js` | **窗24 新增**：**纯函数区间核冒烟**（`js/annotate.js` 的 normalize/union/subtract/isCovered/plan + 存储四种坏数据 + `blocks()` 跳分布条 + `textLen` 公式子树算 0）；**不依赖 DOM**，74 条断言 |
| `tmp_t24_preset_smoke.js` | **窗24 新增**：**全库"快捷预设"体检（Node）**——用桩 rt 跑每个 `def.quickActions`，校验"设的键存在 / **select 值真在 options 里** / 用浏览器真实会给的值跑 parse+buildSnapshots（stepper ≥3 帧）"；现算 **153/153 合格**。⚠ 桩里的 `rnd` 必须会变（恒返回同值会让 ds-btree 的随机预设死循环）、`inputEls`/`RC408.Runner` 都要给（否则误报合法预设） |
| `tmp_es_smoke.js` | **窗25 新增（窗26 补登记）**：外部排序（ds-extsort）三模式冒烟——置换-选择段长、k 路败者树、最佳归并树虚段 |
| `tmp_t26_radix_smoke.js` | **窗26 新增**：**基数排序**（ds-radix）——终局与**独立参考实现"稳定插入排序"**对齐、每趟"按该位有序 + 同桶保序"、**快照深拷贝**（相邻帧不许共享 arr 引用）、2021 真题锚点三条路径互证、2026 双关键字、400 组随机、theory 写盘前四条；**480 条断言** |
| `tmp_t26_blocksearch_smoke.js` | **窗26 新增**：**分块查找**（ds-blocksearch）——索引表三条不变量、与"全表线性扫描"独立路径对成败、两种失败的比较次数、**精确 ASL vs 独立累加参考实现 vs 教材闭式**、n=400 最小 ASL = 21 且 argmin 含 20、300 组随机（⚠ 生成器必须按"**固定块长 s**"造表，否则块间有序偶发不成立、一次假红 124 组）；**289 条断言** |
| `tmp_t26_anno_key_smoke.js` | **窗26 新增**：**标注模式快捷键 `A` 的纯判据真值表**（`isToggleKey` / `isEditable`）+ `toggle()` 的状态翻转与"折叠态自动展开"（最小 DOM 桩，不依赖真浏览器）；**56 条断言** |
| `tmp_t29_as_smoke.js` | **窗29 新增**：**高级语言 ↔ 机器级代码**（coa-assembly）——① **独立参考实现**：按 ISA 规格**另写一份 32 位编解码器**（自己的助记符表 / 字段位宽 / 文本拼装，**不共用模块内部函数**），本窗靠它抓到两个真 bug（`st` 的 EA 基址字段用错）；② 帧结构不变量（首/末帧、eip 必在指令边界、全量深拷贝）；③ **显示层判据**：独立按大端切 4 字节，逐行与 `.as-word` 文本比对（原先"字段 ↔ 机器码"自洽但**屏幕上那串字节没判据**）；④ 末态 = 独立 C 语义参考实现；⑤ 循环片段指令数闭式 6N + 5；⑥ desc/log 无 Markdown `**` 与类型串味；⑦ theory 写盘前四条 + 8 类非法输入 throw；⑧ **8 条注入自测**（干净数据必须绿、注入"帧间共用数组 / eip 不对齐 / imm16 改坏"必须红）；**6512 条断言 / 52 组场景** |
| `tmp_t29_as_probe.js` | **窗29 新增**：**中间量探针**（只 print、不断言）——四个片段逐条打印"地址 / 机器码 / 五段二进制字段 / 掩码后的各字段值 / 汇编 / 对应 C 行"，外加帧数闭式预测与末态寄存器内存，供**先跟手算对齐再写断言**（§3.5.0 闸门 2 的落地工具） |
| `tmp_t32_cr_smoke.js` | **窗32 新增**：**"整段程序双栏对照"类**（coa-cisc-risc）——① **手写真值表当独立参考实现**（每条指令几字节 / 几次数据访存，不读模块内部数据），抄错一个字节或把两侧指令调换就红；② I1~I7 一帧一条不变量（帧数 = max(两侧条数) + 2、累计 = 前缀和且单调不减、字长 = 字段和、定长/变长、**逐帧深拷贝不许共用对象**）；③ **空帧语义判据**（0 条已取时不许断言"变长 0 ~ 0 B"）；④ select 契约（选项必须是 `{v,t}`、`default` 落在 `v` 里、每个片段都有预设直达）；⑤ **2 条注入自测**（干净帧必须绿、篡改累计量必须红）；⑥ theory 写盘前四条 + 考情数字与 `examHistory` 现算对齐；**1054 条断言** |
| `tmp_t32_cr_probe.js` | **窗32 新增**：**中间量探针**（只 print、不断言）——四个程序片段逐条打印"两侧每条指令的字节数 / 数据访存次数 / 帧数闭式预测 / 末帧 desc"，**先跟手算表对齐再写断言**（§3.5.0 闸门 2 的落地工具） |

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
| `tmp_t24_anno_harness.js` | **窗24 新增**：**理论区手动标注**专用——CDP **真鼠标拖拽**（`Input.dispatchMouseEvent`）验证"拖选变红 / 粗细不变 / 再选恢复 / 刷新保留 / 公式不动 / 跨块"；**浏览器自动探测 Chrome→Edge**（`DSH_BROWSER` 可指定）；**收尾只发 CDP `Browser.close`、绝不按进程名杀**（§3.5-10「窗24 改写」）；已内置"滚动后坐标失效 / 先点按钮再 reveal"两个坑的规避 |
| `tmp_t24_ui_harness.js` | **窗24 新增**：**全库快捷预设的浏览器实测**——CDP **真点按钮**逐个点 153 个预设，断言"不出现『输入有误』、进度不是 `0 / 0`、stepper 帧数 ≥3"，另含 5 个模块的语义断言（net-tcp-cc 曲线起点=(0,1) 与丢包峰值=16、coa-fixadd 的 CF/OF 两档、ds-stack-queue 的 2026-42 两序列、ds-topo 回路、net-dns 缓存命中）；Edge/Chrome 各 32 条全绿 |
| `tmp_es_harness.js` | **窗25 新增（窗26 补登记）**：外部排序三模式**走 UI** 逐帧跑到末尾 + 6 张原分辨率截图 |
| `tmp_t26_harness.js` | **窗26 新增**：**一个 harness 跑两个模块**（ds-radix + ds-blocksearch）——走 UI（点预设按钮 / 派发 input / 点「单步执行」）：全站 `traverse=97 bad=0`、r=10 时 10 个桶必须**同一行**（`tops` 去重 = 1）且**不压盖**、逐帧无串味、**2021 真题锚点走 UI 复核**（第 1 趟收集后 372 前后紧邻 = 301/892）、ASL 曲线最小柱 `data-asl=21.000` 且 `data-s` 含 20；**36 条断言 + 8 张截图**（含 **2 张只截 stage**——全页图会把 stage 压得看不清桶里装了什么） |
| `tmp_t26_anno_key_harness.js` | **窗26 新增**：标注模式快捷键的 **CDP 真按键**实测（`Input.dispatchKeyEvent`）——A 开/关往返、与框架 → / R 并存、**4 种输入控件里按 A 不切换且字符真打进去**、Ctrl+A 不抢全选、`autoRepeat` 不翻转、`isComposing` 不切换、折叠态自动展开、刷新后绑定重建；**70 条断言**。⚠ 隐藏容器（`display:none`）里元素**无法 `focus()`**，要先用 `display:block !important` 显示出来 |
| `tmp_t32_cr_harness.js` | **窗32 新增**：**"双栏 + 编码字节尺"类**（coa-cisc-risc）——★ 两条**只在原分辨率目视下才看得见**的几何判据已补成机器判据：① **每行行宽必须 = 字节数 × 26**（边框/间距不许参与，"定长 vs 变长"才量得出来）；② **字节数标签与同行方块垂直居中**（≤4px）。另有逐帧同 `top` 分组压盖、页面不许横向溢出、末帧 6 条判据裁决表只在末帧出现、四个预设走 UI、**改 `<select>` 必须 input + change 双派发再点 `#ctl-load`**（§6.2.30③）并配"真的生效了"判据；**40 条断言 + 7 张截图**（`--noshots` 供注入自测，别覆盖证据） |
| `tmp_t29_harness.js` | **窗29 新增**：**高级语言 ↔ 机器级代码**（coa-assembly）走 UI 实测——全站 `traverse=97 bad=0`；**改循环次数 n=4 → n=2，`cmp` 那行的机器码 `21 01 00 04 → 21 01 00 02`**（imm16 正是 N）+ **反面对照：改 x/y（住内存）机器码一个字节都不变**；四个预设各走一遍；栈帧速览 5 行且标出 `[ebp+4]` 是返回地址、`ebp` 还是调用者初值时**不谎报栈帧**；几何判据照 §3.8-18 窗26 四条 + **元素少的标签集合用 O(n²) 两两比**（窗28 的教训）+ C 栏与汇编栏不重叠 + 横向不溢出 + 按钮在视口内；**52 条断言**。⚠ 本窗踩到的两个脚本坑已写在注释里：走到底后按钮 `disabled`、for 循环空转重复读同一帧；裁剪必须用**页坐标 + `captureBeyondViewport:true`**（视口坐标 + `false` 会截出全白，§3.5-10「窗29 补」） |

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
| `tmp_t38_theory_audit.js` | **窗38 新增**：**35 张纯理论卡的「真题考情」块 ↔ `exam-history` 逐张现算**——查 N/18 与"选 a 大 b"、**行内可见 `>`**、表格列数、裸尖括号、定界符配对、控制字符；带"抽到的卡数 = `status:'theory'` 出现次数"的**前置自检**。⚠ 抽卡必须**按 `{ id: 'x',` 逐个切开**（用"跨对象"的正则会把书对象 `coa`/`os`/`net` 也当成 theory 卡，一次报 51 处假红） |
| `tmp_t38_module_gap.js` | **窗38 新增**：**"还有没有潜在遗漏的新模块"探针**——① README §二 逐行的"平台状态"列（既无 ✅ 也无 📖 / 只有 📖 / 标建设中）② app.js 的 status 分布 + `ready 条目 ↔ js/modules/*.js`**双向查断链** + README 引用了但 app.js 没有的 id ③ `tmp_t37_cls_merged.md` 里"新条目候选"的剩余清单。⚠ **它扫不到"考纲有、真题零考"的缺口**（README §二 是按真题建的表）——那一类要拿考纲目录逐条比，见 §6.2.38⑩ |
| `tmp_t38_favicon.py` | **窗38 新增**：把用户素材 `OIP-C.webp`（269×241）**正方形裁切**（从 (14,0) 取 241×241）并缩到 256×256 存为 `favicon.webp`；打印源/出件的尺寸、字节数与 SHA256，**断言输出必须是 256×256 的 WEBP**。⚠ 脚本里别用 ✔ 这类非 GBK 字符（本机控制台是 GBK，会 UnicodeEncodeError；已显式 `stdout.reconfigure(utf-8)`） |
| `tmp_t38_icon_probe.js` | **窗38 新增**：**网站图标 + 左上角 logo 的浏览器实测**（走**真实 index.html**，不是离线 harness 页）——图标链接恰好 1 条、`#brand-logo` 是 `<img>` 且同源、**图被浏览器解码**（`naturalWidth=256`，只看 src 不算）、logo 40×40 且在标题左侧、CDP 零异常 + 截 header 图。★ 关键判据：**`file://` 下带 `?v=` 的 favicon 也能解码**（本地路径 + 查询串是本窗最大的未知）；收尾只对**自己那一个实例**发 CDP `Browser.close`（§3.5-10「窗24 改写」） |

## 批量改写工具（改 theory / 文档的"数据 + 写入器"一对）
| 文件 | 用途 |
| --- | --- |
| `tmp_t14_theory.js + tmp_t14_apply.js` | **最新一对**：写盘前检查含"裸尖括号"；`--verify` 逐字复核 |
| `tmp_t38_apply.js` | **窗38 新增（纯理论卡"数据 + 写入器"一对）**：4 段卡片正文放 `tmp_t38_note_ds-graph-basic.txt` / `tmp_t38_note_ds-array-algo.txt` / `tmp_t38_note_ds-tree-basic.txt` / `tmp_t38_note_os-thread.txt`，4 段考情数据放 `tmp_t38_eh_ds.txt` / `tmp_t38_eh_os.txt`——**逐字插入、不做任何转义**（数学定界符在源码里本就该是双反斜杠加圆括号）；写盘前跑七条结构检查（三问 / 考情块 ≤2 源行且行宽 ≤100 / **每张表**列数与表头一致 / 锚点命中恰好 1 次 / 新 id 不重复 / 无控制字符 / 考情数字与**将要写入的**数据现算一致），**一个字节不合格就不写**；同一次 `--write` 还顺手补 9 条火苗 + `?v=` 提一档 |
| `tmp_t38_readme_fix.js` | **窗38 新增**：修"用**行前缀**当锚点往表格插行 ⟹ 原行被切成两条记录"（症状：单元格数变多、考频格变空；`tmp_readme_audit.js` 报"⚠ 行里没有 N/18"）。**兼作回归判据**：README §二 四张表**逐行必须恰好 4 个单元格**（排除转义竖线 `\|`，并按"连续表格块"分组） |
| `tmp_t38_move65.js` | **窗38 新增**：按 §3.7-6 把 §6.5 的【窗N】建议块**整块搬进** `docs/handover-history.md` 并用新块覆盖。⚠ 块里**自己有一对代码围栏** ⟹ 收尾围栏要取**第二个**（第一版取第一个，块被截成 5 行）；**判据：先打印"待搬移共几行"与源块对一遍** |
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
| `tmp_t32_wire.js` | **窗32 新增**：`js/app.js` + `index.html` + `README.md` **三处锚点接线**（纯理论卡 → ready 且**整块 `note` 一起删** / 插 script 标签 / 全部 `?v=` 提一档 / README 重建被写坏的表行）——**两个模式 `--keep-v`（P4 之前先不递增 v）与 `--fix`**；三段各自先在内存里算出新内容，**零问题才一起落盘**（比"边查边写"更安全，可当批量改文档的模板） |
| `tmp_t32_judge_test.js` | **窗32 新增**：**判据本身的注入自测**——针对 `tmp_readme_audit.js` 新增的"`OV.length` = README 表行数 = `js/modules/*.js` 数 且行号连续"：3 个注错（`OV` 少一项 / README 少一行 / 行号跳号）**必须各红**、原样对照**必须仍绿**、README **逐字节还原**；**9/9**。★ 这条判据在窗31 是"被违反却没报"的（`⚠` 型输出不进 `bad` 计数 ⟹ 四模式与三条硬门全绿），**"脚本打了警告"≠"脚本判红"** |
| `tmp_t29_wire.js` | **窗29 新增**：`index.html` **一次性接线**（插新模块的 script 标签 + 全部 `?v=` 提一档）——**锚点判据是"`?v=72` 恰好命中 61 处"**，并分两步校验（插入后必须 62 处）才落盘，**任一条不成立就一个字节都不写**（§3.5-7 的做法，可当"批量改文档"的模板） |
| `tmp_t13_wording_probe.js + tmp_t13_wording_fix.js` | 度量衡普查（先量）+ 归一化（再改） |
| `tmp_t10_check_static.js + tmp_t11_check_static.js` | t10/t11 harness 的**页面脚本**（由 harness 生成/引用） |

## 取证 / 目视工具（文本度量与截图度量；判据要"从真源取数或从像素取数"时用）
| 文件 | 用途 |
| --- | --- |
| `tmp_t24_sections.js` | **窗24 新增**：把 50 个模块 `theory` + 33 张卡 `note` 一起盘点（板块数 / 字符数 / 内联"年份-题号"引用数）；**两个反例写在头注释里**——`indexOf` 第二参传字符串会被当 0、卡片 id 正则窗口开太大会把上一条的 id 记错 |
| `tmp_t24_redbox.js` | **窗24 新增**：截图里"红字"的**包围盒与逐带像素数**（判定某张图到底有没有红字、差了多少）；跨图逐带相减即可证明"只有标注处变了" |
| `tmp_t24_crop.js` | **窗24 新增**：PNG 放大裁图（支持 `x0 x1 z out [y0 y1]`）——**原分辨率目视**用；判据仍以断言为准，裁图只作二档 |
| `tmp_t24_glyph.js` | **窗24 新增**：逐字给出"最暗 15% 像素的平均色 + 红度"（判断样图里是不是真有红字；子像素渲染的边缘噪声红度通常 <40，真红字 100+） |
| `tmp_t29_zoom.js` | **窗29 新增**：**裁剪到元素、`scale:2` 的原分辨率目视工具**（§3.8-3② 二档）——自动重生成 harness 页面，按 `#stage > div` 的**第 k 张卡片**逐个裁（先给目标挂临时 `id`）；本窗靠它确认四张卡片版面 + 抓到 1 处语义缺陷与 1 处版面缺陷。⚠ **两个坑写在头注释**：① clip 必须用**页坐标**（`getBoundingClientRect()` + `scrollX/scrollY`）配 `captureBeyondViewport:true`，用视口坐标 + `false` 会截出**全白**；② 每次挂 `id` 前**先清掉上一次的**，否则 `#id` 一直命中第一张卡、四张图截成同一张 |

## 窗33 / 窗34 补登记的脚本（原先进了台账却没进本索引 ⟹ `tmp_tmp_audit.js` 把它们报成"引用 0 次"）
| 文件 | 用途 |
| --- | --- |
| `tmp_t28_ll_smoke.js` | **窗28 建、窗34 扩**：`ds-linkedlist` 冒烟（含 `checkInvariants` / `checkMultiInvariants` 两套不变量、独立数组参考实现、注入自测、`statCards()` 逐帧核统计卡数字）；**窗34 后 9648 条断言** |
| `tmp_t28_harness.js` | **窗28 建、窗34 扩**：`ds-linkedlist` 浏览器实测（单链四模式 + 窗34 的 ⑪a–⑪f 多行布局段：行数 1/2/3、两行同列、`p=∧`、陷阱预设几何）；**窗34 后 112 条断言**，全站条数**现算**不写死 |
| `tmp_t33_wire.js` | **窗33 新增**：`js/app.js` + `index.html` + `README.md` 三处接线（幂等锚点写入器，锚点不成立就一个字节都不写） |
| `tmp_t33_doc.js` | **窗33 新增**：改 README 总览表行与 §二 行（同样是幂等锚点写入器） |
| `tmp_t33_g65.js` | **窗33 新增**：按锚点替换 §6.5 窗口建议块（幂等） |
| `tmp_t33_g6233.js` | **窗33 新增**：按锚点追加 §6.2.33 台账段（幂等） |
| `tmp_t33_dl_probe.js` | **窗33 新增**：`ds-dlink` 中间量探针（只 print、不断言；§3.5.0 闸门 2 的落地工具） |
| `tmp_t34_ll_probe.js` | **窗34 新增**：`ds-linkedlist` 新模式（⑤⑥⑦）**中间量探针**——10 组用例打印模型/帧序/末态/`num`，外加 **theory 渲染体检**（表数/残行）与"`comments` 判据现在还命中吗"的**判据自测** |
| `tmp_t34_cdn_probe.js` | **窗34 新增**：**"样式为什么没生效"专用探针**——真实浏览器打开 `index.html`（或命令行指定的任意页面）后打印：`window.tailwind` / `#cdn-warn` 是否在显示 / **`Network.loadingFailed` 逐条原因**（`ERR_CERT_*` 这类一眼定性）/ KaTeX 与本地 CSS 是否加载 / 计算样式抽查（背景色、侧栏宽度、字体栈），并**顺手截图**；`--offline` 可模拟断网对照。窗34 靠它把"裸 HTML"定成**证书被中间层替换**（而非"没网"） |

## 历史证据（只读留档，别再改；大体积 txt 见文末"归档区"）
| 文件 | 用途 |
| --- | --- |
| `tmp_dfs_bfs_audit.md` | 窗0 图遍历考情核对报告（.gitignore 注释里已注明留档） |

## 归档区 `docs/archive/`（大体积产物）
| 文件 | 用途 |
| --- | --- |
| `tmp_t13_old_theory.txt` | 窗13 体检前导出的旧 theory（改判依据） |
| `tmp_t14_old_theory.txt` | 窗14 体检前导出的旧 theory（改判依据） |
