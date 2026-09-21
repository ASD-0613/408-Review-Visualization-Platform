'use strict';
/* ============================================================================
 * app.js —— 四本书的目录树 + 主导航 + 启动
 * ----------------------------------------------------------------------------
 * 章节结构对照《25 考研 408 大纲》考查范围组织（见 考纲/25考研408大纲.pdf），
 * 各条目考频依据 2009-2026 共 18 年真题统计（详见 README「真题考情分析」）。
 *
 * 后续扩充新知识点只需两步：
 *   ① 在 js/modules/ 下新建模块文件（参照现有模块契约）并在 index.html 引入；
 *   ② 在下方对应章节添加 { id, label, status:'ready' } 条目。
 * status:'wip' 自动显示占位页；hot:true → 🔥 高频考点（真题统计支撑）；
 * plan 字段描述规划中的交互形式（显示在占位页）。
 * ========================================================================== */

RC408.books = [
  {
    id: 'ds', name: '数据结构', icon: '🧩', accent: '#6366f1',
    chapters: [
      {
        name: '第1章 基本概念',
        topics: [
          { id: 'ds-complexity', hot: true, label: '算法时间复杂度分析', status: 'wip', plan: '代码逐行高亮 + 执行次数 f(n) 实时累计、常见量级 O(·) 的判定过程（每年第1题）' },
        ],
      },
      {
        name: '第2章 线性表',
        topics: [
          { id: 'ds-linkedlist', hot: true, label: '单链表的插入与删除', status: 'wip', plan: '指针 p/q 逐步移动、断链接链高亮、头插/尾插对比（链表是算法大题常客）' },
          { id: 'ds-seqlist', label: '顺序表 vs 链表', status: 'theory', note: `> **真题考情**：线性表对比几乎每年嵌入选择题（2013-1、2026-1 考操作代价）。

## 顺序表 vs 链表对照
| 比较项 | 顺序表 | 链表 |
| --- | --- | --- |
| 存取 | 随机存取 O(1) | 顺序存取 O(n) |
| 插入/删除 | 移动元素 O(n) | 改指针 O(1)（已定位时） |
| 空间 | 连续、需预估；密度高 | 按需申请；多指针开销 |
| 适用 | 查多改少、长度稳定 | 频繁插删、长度未知 |

**高频**：按位序取元素仅顺序表 O(1)（2023 真题）；表尾插入 O(1)、表头插入 O(n)（2026-1）；"链表插入快"仅指已定位后的指针修改，定位仍 O(n)。` },
        ],
      },
      {
        name: '第3章 栈、队列和数组',
        topics: [
          { id: 'ds-stack-queue', hot: true, label: '栈与队列出入演示（序列判定）', status: 'ready' },
          { id: 'ds-expression', label: '中缀 → 后缀表达式求值', status: 'ready' },
          { id: 'ds-matrix', label: '特殊矩阵压缩存储', status: 'theory', note: `> **真题考情**：2016-16（三对角）、2018-3（对称矩阵）、2025 真题（二维数组地址）。

## 对称矩阵（存下三角，1 基）
a[i][j]（i ≥ j）前有 i(i−1)/2 + j − 1 个元素 → 一维下标 k = i(i−1)/2 + j − 1（0 基）；上三角元素用对称性 a[i][j] = a[j][i]。
## 三对角矩阵
第 1/末行各 2 个非零、其余行 3 个；按行优先推"该元素之前的元素个数"再 + 起始下标（2016 真题 m30,30）。

**通用模板**：数清目标元素**之前**的元素个数（按行求和）→ + 数组起始下标。多维数组行优先时后面维的尺寸出现在乘积里（2025 真题地址计算）。` },
        ],
      },
      {
        name: '第4章 树与二叉树',
        topics: [
          { id: 'ds-bintree-traversal', hot: true, label: '二叉树的遍历（前/中/后/层序）', status: 'ready' },
          { id: 'ds-huffman', hot: true, label: '哈夫曼树与哈夫曼编码', status: 'ready' },
          { id: 'ds-bst-avl', hot: true, label: '二叉排序树与 AVL 旋转', status: 'ready' },
          { id: 'ds-clue', label: '线索二叉树', status: 'theory', note: `> **真题考情**：2013-5、2014-4、2022-3、2024-3 均考线索指向判定。

## 规则
- n 个结点二叉链表有 **n+1 个空指针**，利用其存前驱/后继（线索）;
- 无左孩子 → lchild 指**前驱**；无右孩子 → rchild 指**后继**；标志 ltag/rtag：0 孩子 1 线索；
- 优点：免栈遍历、快速找前驱后继；缺点：插入删除更繁琐。

**高频判定**：中序线索树中 x 的后继 = 右子树最左结点（有右子树时）；叶结点左右线索各指前驱后继（2013）；后序线索树找后继仍需父指针。` },
          { id: 'ds-heap', hot: true, label: '堆与优先队列（建堆 / 插入 / 删除堆顶）', status: 'ready' },
          { id: 'ds-unionfind', label: '并查集', status: 'theory', note: `> **真题考情**：2025 考纲明确"并查集及其应用"；Kruskal 模块中已演示合并动画。

## 结构与操作
- **双亲表示法**（parent[] 森林）；Find(x)：沿 parent 找根；Union(a,b)：一根挂另一根；同集合 ⇔ 根相同。

## 优化
- **按秩/大小合并**：矮挂高 → 树高 O(log n)；
- **路径压缩**：Find 时沿途结点直接挂根 → 近 O(1)；两者结合近乎线性。

**应用**：Kruskal 判环、等价类、连通分量计数。` },
        ],
      },
      {
        name: '第5章 图',
        topics: [
          { id: 'ds-graph-storage', label: '图的存储（邻接矩阵/表）', status: 'wip', plan: '两种存储互转、边表挂接、度数计算' },
          { id: 'ds-dfs-bfs', label: '图的遍历 DFS / BFS', status: 'ready' },
          { id: 'ds-kruskal', hot: true, label: 'Kruskal 最小生成树', status: 'ready' },
          { id: 'ds-prim', label: 'Prim 最小生成树（对比 Kruskal）', status: 'wip', plan: '顶点扩张视角、候选边集更新、双栏对照' },
          { id: 'ds-dijkstra', label: 'Dijkstra 最短路径', status: 'ready' },
          { id: 'ds-topo', hot: true, label: '拓扑排序与关键路径', status: 'ready' },
        ],
      },
      {
        name: '第6章 查找',
        topics: [
          { id: 'ds-binsearch', label: '二分查找（折半查找）与判定树', status: 'ready' },
          { id: 'ds-hash', hot: true, label: '散列表与冲突处理（ASL）', status: 'ready' },
          { id: 'ds-blocksearch', label: '分块查找（索引顺序查找）', status: 'wip', plan: '块间有序+块内查找两级动画、每块最优元素数 √n（2025 真题）' },
          { id: 'ds-rbtree', label: '红黑树基本概念', status: 'theory', note: `> **真题考情**：2024/2025 考纲新增"红黑树"；真题暂未考构造，备考以性质辨析为主。

## 五条性质
1. 结点红或黑；2. 根黑；3. 叶（NULL）黑；4. 红结点孩子必黑（无连续红）；5. 任意结点到各叶路径黑高相同。

## 与 AVL 对比
- AVL 严格平衡（高度差 ≤1）查找略快；红黑树**近似平衡**（最长 ≤ 2×最短），插删旋转少，综合更好（C++ map、Linux CFS）；
- n 个内部结点高度 ≤ 2log₂(n+1)。` },
          { id: 'ds-btree', hot: true, label: 'B 树与 B+ 树', status: 'ready' },
          { id: 'ds-kmp', label: 'KMP 与 next/nextval 数组', status: 'ready' },
        ],
      },
      {
        name: '第7章 排序',
        topics: [
          { id: 'ds-sort', hot: true, label: '排序算法全家桶（含每趟结果）', status: 'ready' },
          { id: 'ds-extsort', label: '外部排序（置换选择/败者树/最佳归并树）', status: 'wip', plan: '初始归并段生成、败者树多路归并、虚段补充计算' },
          { id: 'ds-radix', label: '基数排序', status: 'wip', plan: '按位分配/收集的队列动画、稳定性验证' },
        ],
      },
    ],
  },
  {
    id: 'coa', name: '计算机组成原理', icon: '⚙️', accent: '#0ea5e9',
    chapters: [
      {
        name: '第1章 计算机系统概述',
        topics: [
          { id: 'coa-hierarchy', label: '层次结构与冯·诺依曼机', status: 'theory', note: `> **真题考情**：18 年中 3 年考冯·诺依曼/层次结构概念（2009-11、2018-12、2019-12，均为选择题）

## 冯·诺依曼机的核心要点
- 计算机由**运算器、存储器、控制器、输入设备、输出设备**五大部分组成；
- **\"存储程序\"**：指令和数据同等地以二进制形式存于存储器，机器按地址自动逐条取指执行；
- **区分指令与数据的依据**：CPU 取指/执行周期阶段不同（2009 真题）；
- 指令和数据都按地址访问；早期以运算器为中心，现代机器已演化为以存储器为中心。

## 计算机系统的多层次结构
- 五层：微程序机器级(M0) → 传统机器语言(M1) → 操作系统级(M2) → 汇编语言级(M3) → 高级语言级(M4/C++)；
- 软硬件在**逻辑功能上等价**：某功能既可硬件实现也可软件实现；
- 翻译（编译/汇编，一次性生成）与解释（逐条，边解释边执行）：高级语言→汇编→机器语言。` },
          { id: 'coa-perf', label: '性能指标（CPI/MIPS/FLOPS）', status: 'ready' },
        ],
      },
      {
        name: '第2章 数据的表示和运算',
        topics: [
          { id: 'coa-fixadd', hot: true, label: '补码加减运算与溢出判断', status: 'ready' },
          { id: 'coa-baseconv', hot: true, label: '进位计数制与转换（R 进制互转 · 除基取余 / 乘基取整）', status: 'ready' },
          { id: 'coa-float754', hot: true, label: 'IEEE 754 浮点数表示', status: 'ready' },
          { id: 'coa-floatadd', label: '浮点数的加/减运算', status: 'theory', note: `> **真题考情**：2009-13 考流程；与 IEEE 754 模块配套记忆。

## 浮点加减五步
1. **对阶**：小阶向大阶（阶小尾数右移，损失精度）；
2. **尾数加减**；
3. **规格化**：0.0xx → **左规**（左移、阶减，可多次）；1.xxx → **右规**（右移 1 位、阶加，仅一次）；
4. **舍入**：0 舍 1 入 / 恒置 1 / 就近取偶（2026-14）；
5. **溢出判断**：看**阶码**——上溢中断、下溢按机器零。

**提示**：尾数溢出可右规挽救，**阶码上溢才是真溢出**。` },
          { id: 'coa-muldiv', hot: true, label: '乘除运算电路（原码一位乘 / 加减交替除法）', status: 'ready' },
          { id: 'coa-hamming', label: '海明码与校验', status: 'wip', legacy: '现行考纲"数据的表示和运算"章已不含校验码（CRC 校验仍属于计算机网络链路层的差错控制）；2013 年真题曾考"纠 1 位错最少校验位数"。' },
        ],
      },
      {
        name: '第3章 存储器层次结构',
        topics: [
          { id: 'coa-cache-direct', hot: true, label: 'Cache 直接映射', status: 'ready' },
          { id: 'coa-cache-assoc', hot: true, label: '组相联与全相联映射', status: 'ready' },
          { id: 'coa-mainmem', label: '主存与 CPU 连接（芯片扩展）', status: 'ready', hot: true },
          { id: 'coa-sram-dram', label: 'SRAM / DRAM / Flash 特点对比', status: 'theory', note: `> **真题考情**：2010-16、2011-14、2012-16、2016-17、2025-12 选择，几乎每年辨析一次。

| 特性 | SRAM | DRAM | Flash |
| --- | --- | --- | --- |
| 原理 | 触发器 | 电容电荷 | 浮栅晶体管 |
| 速度 | 快 | 较慢 | 慢（读快写慢） |
| 刷新 | 不需要 | 需要定时刷新 | 不需要 |
| 易失 | 易失 | 易失 | 非易失 |
| 用途 | Cache | 主存 | SSD/U盘 |

**高频**：DRAM 行列地址复用（引脚少，2025-17）；刷新对 CPU 透明；CD-ROM 非随机存取（2011-14，已考纲外）。` },
          { id: 'coa-disk', label: '磁盘存储器性能计算器', status: 'ready', hot: true },
          { id: 'coa-optical', label: '光盘存储器 / CD-ROM', status: 'wip', legacy: '现行考纲外部存储器仅含磁盘与 SSD，光盘相关内容已删；2011 年真题（不采用随机存取方式的存储器）、2013 年真题（CD-ROM 视频随机播放的文件物理结构）曾考。' },
          { id: 'coa-vm', label: '页式虚拟存储器', status: 'theory', note: `> **真题考情**：计组与 OS 综合大题的固定主题（2011-44、2016-45、2018-44、2023-43 等），硬件视角与 OS 视角互补。

## 计组视角要点（配合 os-vm-paging 模块食用）
- 虚拟地址 → MMU 查页表 → 物理地址；**TLB 在 CPU 内（SRAM）、页表在主存**；
- TLB 表项 = 有效位 + Tag + 页框号；组相联 TLB 的 Tag/组号划分（2021-44、2024-17）；
- MMU 检测：TLB 缺失、页面缺失、越权——**Cache 缺失不由 MMU 检测**（2024-18）；
- 地址划分真题模板：虚地址位数 = 页号位数 + 页内偏移；页内偏移 = log₂(页大小)。

**联动学习**：缺页中断处理流程见【页式虚拟内存·地址转换】模块。` },
        ],
      },
      {
        name: '第4章 指令系统',
        topics: [
          { id: 'coa-addressing', hot: true, label: '指令寻址方式（EA 的形成）', status: 'ready' },
          { id: 'coa-inst-format', label: '指令格式与扩展操作码', status: 'theory', note: `> **真题考情**：2016-17、2018-19、2021-43、2024-43；扩展操作码计算高频。

## 扩展操作码
- 变长操作码：**短操作码不能与长操作码前缀冲突**；
- 逐层扣除：定长 16 位，二地址 12 条（占 12×2¹² 个编码）→ 一地址 254 条 → 零地址 = 剩余编码 ÷ 地址字段大小（2022-19）；
- 三地址 29 条 + 二地址 107 条 → 指令字长（2017-16）。

**提示**：直接寻址范围 = 2^地址位数（2020-16）；操作码位数 = ⌈log₂指令数⌉。` },
          { id: 'coa-endian', label: '数据的对齐与大小端存放', status: 'theory', note: `> **真题考情**：2015-15、2016-14、2019-14、2020-14、2025-15 连续考结构体地址推演。

## 大端 vs 小端
- **大端**：高位字节存低地址；**小端**：低位字节存低地址（x86）。
- 例：0x12345678 存于 0x100 → 小端 0x100 存 78H、大端 0x100 存 12H。

## 边界对齐
- 成员地址 = 自身大小（或对齐模数）的倍数，不足则填充；struct 总大小 = 最大对齐的倍数；
- **解题模板**：画地址格 → 按声明顺序放 → 不对齐就补 → 求目标字节（2025：employee 数组 name[10] 后填充）。` },
          { id: 'coa-assembly', hot: true, label: '高级语言 ↔ 机器级代码', status: 'wip', plan: '循环/分支/函数调用的汇编对应、机器码逐句分析（近年大题热点）' },
          { id: 'coa-cisc-risc', label: 'CISC 与 RISC 对比', status: 'theory', note: `> **真题考情**：2009-17、2025-17 两次考 RISC 特征辨析——"Load/Store 专用访存、定长指令、硬布线控制、适合流水线"是标准答案要点

## CISC vs RISC 对照表（高频辨析）
| 比较项 | CISC | RISC |
| --- | --- | --- |
| 指令系统 | 复杂庞大，指令数目多 | 简单精简，指令数目少 |
| 指令长度 | 不固定（变长） | **定长** |
| 寻址方式 | 丰富（十几种） | 较少（少量几种） |
| 访存指令 | 大多可访存 | **只有 Load/Store 可访存** |
| CPU 内通用寄存器 | 较少 | **大量** |
| 控制器 | 多用**微程序**控制 | 多用**组合逻辑（硬布线）** |
| 流水线 | 难以优化 | **适合流水线** |
| 目标代码 | 程序代码短 | 程序代码较长 |

**真题口径**：RISC 采用 Load/Store 风格、便于流水线、控制多用硬布线（2018/2025 判断题）；x86 是 CISC 代表，MIPS/ARM(经典) 是 RISC 代表。` },
        ],
      },
      {
        name: '第5章 中央处理器',
        topics: [
          { id: 'coa-datapath', hot: true, label: '数据通路与指令执行', status: 'wip', plan: '取指/译码/执行阶段数据流、控制信号逐个点亮' },
          { id: 'coa-pipeline', hot: true, label: '五段流水线与冒险处理', status: 'ready' },
          { id: 'coa-interrupt', hot: true, label: '异常与中断机制', status: 'wip', plan: '中断隐指令、多重中断嵌套、fault/trap 辨析' },
          { id: 'coa-microprog', label: '微程序控制器', status: 'theory', note: `> **真题考情**：2012-18（字段编码位数）、2014-18（下地址字段）、2017-18（控存比较）。

## 微程序控制器
- 机器指令 → 一段**微程序**（存于**控制存储器 CS**，ROM）；微指令 = 操作控制字段 + 下地址字段；
- 编码：**直接编码**（一位一信号，字长长）；**字段直接编码**——互斥类分组，每组留一个"无操作"状态：位数 = Σ⌈log₂(类内数+1)⌉（2012：33 微命令 5 类 → 15 位）；字段间接编码。
- CS 按地址访问（2017-18 纠错：不是按内容）。

**对比**：微程序规整易扩展、慢；硬布线快、RISC 常用。` },
          { id: 'coa-multi', label: '多处理器基本概念', status: 'theory', note: `> **真题考情**：2022-22 考 Flynn 分类与多核/SMP 辨析（考纲 2022 年新增本章）

## Flynn 分类法与多核（2022 真题辨析）
- **SISD**：单指令流单数据流——传统单处理器（顺序执行）；
- **SIMD**：单指令流多数据流——向量/阵列处理器，一条指令对一组数据同时运算；
- **MIMD**：多指令流多数据流——多核处理器、多处理器系统；
- **硬件多线程**：一个核心交错执行多个线程，掩盖访存延迟；
- **SMP**：多个对等核共享单一物理地址空间与主存。

**辨析**：多核 = 一芯片多个独立 CPU 核（MIMD）；GPU 侧重吞吐（SIMD/SIMT）；SMP 所有核对等、共享主存。` },
        ],
      },
      {
        name: '第6章 总线和输入/输出系统',
        topics: [
          { id: 'coa-bus', label: '总线事务与定时', status: 'theory', note: `> **真题考情**：总线带宽计算年年变式（2009-20、2014-19、2017-19、2020-19、2025-20）。

## 带宽 = 工作频率 × 每周期传输次数 × 宽度(B)
- 66MHz×32 位×双沿 → 66M×2×4B = 528 MB/s（2014）；
- QPI 2.4GHz 串行 ×2 方向（2017）；quad pumped ×4（2025-20：1333MT/s×8B = 10.66GB/s）；
- **突发传输**：一次地址连传多个数据（2024-20）。

## 定时方式
同步（统一时钟，快）、异步（握手应答，慢但灵活）、半同步。
**纠错**：并行不一定快（2016-21）；PCIe 串行但频率高（2017-20）。` },
          { id: 'coa-bus-standard', label: '总线标准（PCI/ISA/USB…）', status: 'wip', legacy: '现行考纲总线部分仅含基本概念、组成及性能指标、总线事务和定时，具体总线标准条目已删；2010 年（PCI/ISA/EISA）、2012 年（USB）、2013 年（PCI/USB/AGP/PCI-E）真题曾考。' },
          { id: 'coa-io', label: 'I/O 方式与 CPU 时间占比计算器', status: 'ready', hot: true },
        ],
      },
    ],
  },
  {
    id: 'os', name: '操作系统', icon: '🖥️', accent: '#10b981',
    chapters: [
      {
        name: '第1章 操作系统概述',
        topics: [
          { id: 'os-intro', label: '运行环境：中断/异常/系统调用', status: 'theory', note: `> **真题考情**：用户态/核心态切换每年一个选项（2010-23、2013-28、2014-25、2018-27、2022-27、2023-26、2025-23…）。

## 特权指令
- **仅内核态**：I/O 指令、关中断、置时钟、清内存等；**trap（系统调用/自陷）本身不是特权指令**（2026-21、2014-25、2023-23）；
- 用户态 → 内核态：中断/异常/系统调用（硬件切换）；内核态 → 用户态：**中断返回指令**（由 OS 执行）。

## 系统调用流程
传参 → trap 进入内核 → 执行服务例程 → 返回。**凡涉及资源/设备的操作必走系统调用**。

**辨析**：编译、链接、命令解释程序运行在用户态；缺页处理、时钟中断、进程切换在内核态（2018/2023）。` },
          { id: 'os-structure', label: '操作系统结构（宏内核/微内核）', status: 'theory', note: `> **真题考情**：2023-23 考微内核特征（较高可靠性/安全性/可扩展性，性能较差）

## OS 结构分类（2023 真题考微内核特征）
- **宏内核（单体）**：全部系统服务都在内核态——性能好、耦合高（Linux 典型）；
- **微内核**：内核只保留最基本功能（中断/调度/基本 IPC），其余服务放用户态进程——**可靠性、安全性、可扩展性更好**，但消息传递带来性能开销（2023 真题答案）；
- **外核**：资源分配与使用分离，库操作系统复用内核缓冲；
- **层次结构**：逐层搭建、单向调用，结构清晰但效率低。` },
          { id: 'os-boot', label: '操作系统引导与虚拟机', status: 'theory', note: `> **真题考情**：2021-46 大题考多阶段引导与格式化顺序。

## 引导流程
CPU 从 ROM 的 BIOS/POST 开始 → 读 **MBR**（0 号扇区：磁盘引导程序 + 分区表）→ 分区引导扇区（PBR）→ 启动管理器/根目录 → 装载 OS 内核 → 初始化。

## 安装 OS 三步（2021 真题）
**物理格式化**（划分扇区/校验）→ **分区** → **逻辑格式化**（建根目录、空闲管理结构如 FAT/位图）。

**提示**：MBR 固定在 0 号扇区；逻辑格式化不做物理划分。` },
        ],
      },
      {
        name: '第2章 进程与线程',
        topics: [
          { id: 'os-procstate', hot: true, label: '进程状态转换（五态模型）', status: 'ready' },
          { id: 'os-ipc', label: '进程间通信（共享内存/消息/管道/信号）', status: 'theory', note: `> **真题考情**：2014-31 管道、2022/2025 考条目辨析、2025-30 共享内存页框。

| 方式 | 特点 |
| --- | --- |
| 共享内存 | 最快；两个进程页表映射同一物理页（虚地址可不同，2025-30）；**必须配同步互斥** |
| 消息传递 | 内核中转（直接/信箱间接） |
| 管道 | 半双工字节流；**读写都可能阻塞**（2014-31）；匿名管道用于父子进程 |
| 信号 | 异步事件通知（kill、Ctrl+C） |

**提示**：管道写满 → 写者阻塞；读空 → 读者阻塞。共享内存的同步用 PV 操作。` },
          { id: 'os-pv', hot: true, label: '同步与互斥 · PV 操作（生产者-消费者）', status: 'ready' },
          { id: 'os-classic', label: '经典同步问题（读者写者/哲学家）', status: 'theory', note: `> **真题考情**：大题变体：2014-47（连续取 10 件）、2019-43（哲学家 + m 个碗）、2025-45（三人植树）；选择 2016-27、2022-46。

## 三大经典问题设计要点
1. **生产者-消费者**：empty/full（同步）+ mutex（互斥）；**先同步 P 后互斥 P**，顺序颠倒死锁（本平台 PV 模块可演示）；
2. **读者-写者**：读者计数器 cnt + rmutex 保护 cnt + wmutex 写互斥；首个读者锁写、末个解锁；
3. **哲学家**：5 筷子全拿会死锁 → **最多 4 人同时拿** / 奇偶号取筷顺序相反 / 一次拿齐。

**大题套路**：列互斥资源 → 每资源一个 mutex（初值 1）、每个前后件一个同步信号量（初值 = 可用数）→ 写清每个信号量的物理意义。` },
          { id: 'os-monitor', label: '管程', status: 'wip', legacy: '现行考纲同步互斥部分以锁、信号量、条件变量表述，管程条目已不再出现；2016 年真题（管程叙述）、2018 年真题（条件变量 x.wait() 的行为）曾考。' },
          { id: 'os-sched', hot: true, label: '处理机调度（FCFS/SJF/HRRN/RR）', status: 'ready' },
          { id: 'os-deadlock', label: '死锁与银行家算法', status: 'ready' },
        ],
      },
      {
        name: '第3章 内存管理',
        topics: [
          { id: 'os-mem-alloc', label: '连续分配与动态分区', status: 'theory', note: `> **真题考情**：2010-28、2015-25、2017-25、2019-32、2021-32 连续考分区算法辨析。

| 算法 | 规则 | 特点 |
| --- | --- | --- |
| 首次适应 | 空闲链按地址有序，取第一个够大 | 开销小；高地址大分区得以保留（2017） |
| 邻近适应 | 从上次位置继续找 | 检索短；大分区易耗尽 |
| 最佳适应 | 取最小够大分区 | **外部碎片最多**（2019-32） |
| 最坏适应 | 取最大分区 | 中小作业友好 |

**回收**：相邻空闲区合并。内部碎片 = 固定分区/分页；外部碎片 = 动态分区/分段（可紧凑解决）。` },
          { id: 'os-vm-paging', hot: true, label: '页式虚拟内存 · 地址转换（TLB+缺页）', status: 'ready' },
          { id: 'os-lru', hot: true, label: '页面置换 · LRU（含推导表）', status: 'ready' },
          { id: 'os-page-replace', label: 'FIFO / OPT / CLOCK 置换对比', status: 'theory', note: `> **真题考情**：2010-46（CLOCK）、2016-26（改进型）、2018-45、2021-28、2022-29/30。

- **FIFO**：淘汰最早进入 → 可能 **Belady 异常**（框数增缺页反增，2014-30）；
- **OPT**：淘汰未来最久不用（理论下界，不可实现）；
- **CLOCK**：循环扫描访问位 A；**改进型**按 (A,M)：(0,0)→(0,1)→(1,0)→(1,1) 优先淘汰，扫描中把 A 清 0（2016-26）。

**辨析**：降缺页率——增大页框/工作集、页面缓冲；多级页表**省空间但增加访存**（2026-29）；影响 EAT：缺页率、磁盘读写、访存、缺页处理 CPU 时间（2020-28）。` },
        ],
      },
      {
        name: '第4章 文件管理',
        topics: [
          { id: 'os-file-alloc', hot: true, label: '文件物理结构与混合索引计算', status: 'ready' },
          { id: 'os-bitmap', label: '外存空闲空间管理（位图/FAT）', status: 'theory', note: `> **真题考情**：2010-45（2KB 位图/16384 块）、2015-31（释放盘块定位）、2024-26。

## 位示图换算
- 每字 n 位：盘块 b（0 基）→ 字号 = ⌊b ÷ n⌋，位号 = b mod n；
- **1 基口径**（教材常用）：字号 i = ⌊(b−1) ÷ n⌋ + 1，位号 j = (b−1) mod n + 1（2015-31：释放 409612 号块）；
- 位图总大小 = 总块数 ÷ 8 字节 —— **与当前空闲数无关**（2024-26）；位图自身也占盘块（2015：存于 32~127 号块）。

**提示**：先确认题目 0 基还是 1 基！` },
        ],
      },
      {
        name: '第5章 输入/输出管理',
        topics: [
          { id: 'os-disk-sched', label: '磁盘调度 SSTF / SCAN / C-SCAN', status: 'ready', hot: true },
          { id: 'os-buffer', label: '缓冲区管理（单/双缓冲）', status: 'theory', note: `> **真题考情**：2011-31（双缓冲 1100μs）、2013-27（单缓冲 2 块）。

## 缓冲时间公式（T 读入、M 传送、C 分析）
- **单缓冲**：每块 = max(T, C) + M；n 块 = n×max(T,C) + T + M（首块额外读入一次）——套 2013 真题（100/5/90）：2 块 = 2×max(90,5) + 100 + 5 = 295μs；
- **双缓冲**：读入与传送并行 → n 块 = n×max(T, C+M) + T（2011 真题：单 1550 → 双 1100μs）。

**提示**：缓冲属于设备独立软件层；目的 = 缓和速度差 + 减少 I/O 次数；循环缓冲/缓冲池。` },
          { id: 'os-ioctl', label: 'I/O 控制方式与软件层次', status: 'theory', note: `> **真题考情**：2012-26（四层排序）、2019-24（磁盘 I/O 流程）、2022-32（驱动）、2025-32（中断职责）。

## I/O 软件四层（2012 排序）
用户层 I/O 软件 → **设备独立性软件** → **设备驱动程序** → **中断处理程序**（+硬件）。
- 驱动程序：硬件↔OS 接口、按硬件定制、**计算 CHS**（2013-25）、设寄存器启动设备；
- 中断处理程序：数据寄存器 → **内核缓冲区**（2024-31、2025-32）；解析含义/同步用户缓冲在中断返回后；
- 独立软件：命名、保护、缓冲、分配、SPOOLing。

**提示**：用户态 → 内核态靠中断/系统调用；设备分配考虑类型/状态/权限/映射（2023-32）。` },
        ],
      },
    ],
  },
  {
    id: 'net', name: '计算机网络', icon: '🌐', accent: '#f59e0b',
    chapters: [
      {
        name: '第1章 计算机网络概述',
        topics: [
          { id: 'net-layers', label: '分层模型（OSI vs TCP/IP）', status: 'theory', note: `> **真题考情**：OSI/TCP-IP 每年 1 题（09-33、13-33、16-33、19-33、21-33、26-33 全在 33 题附近）。

| OSI | TCP/IP | 功能要点 |
| --- | --- | --- |
| 应用/表示/会话 | 应用 | HTTP/DNS/FTP/邮件 |
| 传输 | 传输 | 端到端、端口；TCP/UDP |
| 网络 | 网络 | 路由转发、IP |
| 数据链路/物理 | 网络接口 | 帧、MAC、比特传输 |

**高频辨析**：第一个提供端到端服务 = 传输层（2009-33）；直接为 ICMP 服务 = IP（2012-33）；R1/Switch/Hub 最高层 = 3/2/1（2016-33）；"层次越多效率越高"错误（2026-33）；TCP/IP 网络层只提供无连接（2011-33）。` },
          { id: 'net-model', label: '网络应用模型（C/S 与 P2P）', status: 'theory', note: `> **真题考情**：2019-40 考网络应用模型辨析（P2P 对等、客户间不直接通信等）

## 网络应用模型（2019 真题辨析）
| 模型 | 特点 |
| --- | --- | --- |
| **C/S 客户/服务器** | 服务集中于服务器；客户之间**不直接通信**；服务器可能成为瓶颈 |
| **P2P 对等** | 每个结点既是客户又是**服务器**；自扩展性强；管理难 |

**要点**：客户程序按用户需要临时通信，服务器程序常驻被动等待；同一主机可同时运行多个服务器/客户进程（端口号区分）；BT 下载、文件分发 → P2P。` },
          { id: 'net-perf', label: '性能指标与时延计算', status: 'theory', note: `> **真题考情**：时延计算融入大题（2010-34、2013-33/35、2022-33、2026-34）。

## 时延
- 发送时延 = 分组长度 ÷ 带宽；传播时延 = 距离 ÷ 速率（铜/光纤 2×10⁸、卫星 3×10⁸ m/s）；
- **时延带宽积** = 传播时延 × 带宽（"以比特为单位的链路长度"，2013 真题 1000bit）；
- 分组交换：k 段链路、每段 R、分组 P：总发送 = L/R + (k−1)P/R + Σ传播（流水）；
- 吞吐量 = **瓶颈链路带宽**（2024-33）。

**辨析**：报文交换整包存储转发慢于分组流水（2013-35）；2026-34：1500B@2Mbps → 发送 6ms。` },
        ],
      },
      {
        name: '第2章 物理层',
        topics: [
          { id: 'net-shannon', hot: true, label: '奈奎斯特定理与香农定理', status: 'ready' },
          { id: 'net-encode', label: '编码与调制', status: 'theory', note: `> **真题考情**：2013-34（曼彻斯特读比特串）、2014-34（判编码）、2021-34（差分还原）、2025-34（汉明距离）。

| 编码 | 规则 | 特点 |
| --- | --- | --- |
| NRZ | 1 高 0 低 | 简单、无自同步 |
| NRZI | 电平翻转 = 0（USB） | 差分思想 |
| 曼彻斯特 | 每比特**中间必跳变**（以太网） | 自同步；波特率 = 2×比特率 |
| 差分曼彻斯特 | 开头有跳变 = 0、无 = 1 | 自同步、抗极性反接 |

**模板**：先找比特边界（中间跳变），再看起始跳变定 0/1。
**2025-34**：编码集最小汉明距离 d → 检错 d−1 位、纠错 ⌊(d−1)/2⌋ 位。` },
          { id: 'net-swap', label: '电路/报文/分组交换对比', status: 'theory', note: `> **真题考情**：2010-34、2013-35、2022-33、2025-33 时间比较；2024-33 吞吐量。

- **电路交换**：先建独占通路 → 传输阶段时延小、实时；总 = 建立 + 2×传播 + L/R；
- **报文交换**：整报文存储转发（中间结点收完整包再转）；
- **分组交换**：划小包流水转发 → 总时延最小（2025-33：Tps < Tms）；
- 数据报（无连接，按目的转发）vs 虚电路（先建虚连接、按 VCID 转发、**不预分配带宽**——2019/2020 真题）。

**公式**：k 段链路、报文划 p 份：分组交换发送总时延 = (k−1)×P/R + L/R + k×传播。` },
        ],
      },
      {
        name: '第3章 数据链路层',
        topics: [
          { id: 'net-crc', label: 'CRC 循环冗余校验', status: 'ready' },
          { id: 'net-hdlc', label: 'HDLC 组帧（广域网）', status: 'wip', legacy: '现行考纲广域网部分仅含 PPP，HDLC 已删；2013 年真题曾考零比特填充组帧。' },
          { id: 'net-window', hot: true, label: '滑动窗口可靠传输（停等/GBN/SR）', status: 'ready' },
          { id: 'net-csma', label: 'CSMA/CD 与最小帧长', status: 'theory', note: `> **真题考情**：2010-47 大题、2013-36、2016-36、2023-36（退避）、2022-47、**2026-35**（CSMA/CA 时间计算，**窗3** 核定：原误登记在 net-window 名下，已移回本考点）。

## CSMA/CD
- **最小帧长 = 2τ × 数据率**（争用期 2τ）：10Mb/s 以太网 51.2μs → 64B；
- 冲突处理：停发 + 强化干扰 + **二进制指数退避**：第 i 次冲突后从 {0 … 2^min(i,10)−1} 随机选 k 个时隙（2023-36：4 次 → 最长 768μs；2025-35：k = min(11,10)）；
- 无线用 **CSMA/CA**（不能边发边检）：IFS、RTS/CTS 预约（2024-36 NAV 计算）。

**公式链**：距离 ↔ 传播时延 ↔ 争用期 ↔ 最小帧长，知三求一（2010 大题）。` },
          { id: 'net-switch', hot: true, label: '以太网交换机自学习', status: 'ready' },
        ],
      },
      {
        name: '第4章 网络层',
        topics: [
          { id: 'net-subnet', hot: true, label: 'IPv4 地址与子网划分', status: 'ready' },
          { id: 'net-fragment', label: 'IP 分片与重组', status: 'theory', note: `> **真题考情**：2010-47、2016-37、2018-47、2021-36——分片计算是大题小问常客。

## 三字段
- **总长度**（各片头+数据）；**标识**（同一数据报相同）；**MF**：1 = 还有片，末片 0；
- **片偏移 = 片数据起始 ÷ 8**（单位 8 字节！）；除末片外数据长度必须是 **8 的倍数**；
- 可载数据 = MTU − 20（IP 头），再向下取 8 的倍数。

**模板**（2018：1580B、MTU=800）：可载 776B（780 取 8 倍数）→ 分 3 片；第 2 片总长 = 数据+20、MF=1、偏移 = 首片数据 ÷ 8。` },
          { id: 'net-routing', label: '路由算法与协议（RIP/OSPF/BGP）', status: 'theory', note: `> **真题考情**：2013-47（BGP/聚合）、2014-42 大题（OSPF+Dijkstra）、2016-37（RIP 坏消息）、2024-47、2026-37。

| 协议 | 类型 | 算法 | 交换 | 封装 |
| --- | --- | --- | --- | --- |
| RIP | IGP | 距离向量，跳数 ≤15 | 30s 广播整表 | **UDP 520** |
| OSPF | IGP | 链路状态 + Dijkstra，支持分区 | 洪泛 LSA | **IP**(89) |
| BGP | **EGP** | 路径向量（策略） | TCP 179 | **TCP** |

**考点**：RIP"坏消息传播慢"——距离 16 = 不可达（2016-37）；OSPF 划区域（2024-47：RIP 跳数超限选 OSPF）；直接封装 = UDP/IP/TCP（2017-37）；聚合减少路由表项（2026-37）。` },
          { id: 'net-ipv6', label: 'IPv6（地址与特点）', status: 'theory', note: `> **真题考情**：2023-40（IPv4/IPv6 对比）。

- 地址 **128 位**（空间约 2⁹⁶ 倍 IPv4）；基本首部**固定 40B**、8 字段；取消首部校验和；
- **HopLimit ≈ TTL**；流标号可预分配资源；
- 表示：8 组 16 位十六进制，**前导 0 可省、:: 只能出现一次**；
- 过渡：**双协议栈、隧道**（IPv6 封装进 IPv4）。

**2023-40 全对选项**：空间 2⁹⁶ 倍 ✓、首部定长 ✓、双栈与隧道过渡 ✓、HopLimit 等价 TTL ✓。` },
          { id: 'net-arp', label: 'ARP / DHCP / ICMP / NAT', status: 'theory', note: `> **真题考情**：2011-47、2015-47、2021-47、2022-47（DHCP）、2016-38（NAT）。

- **ARP**：同网段广播请求（目的 MAC = FF…FF）→ 目的主机单播应答；跨网段对**默认网关**的 IP 发 ARP（2021-47）；
- **DHCP 四步**：Discover（0.0.0.0 → 255.255.255.255）→ Offer → Request（仍广播）→ ACK；应用层、基于 UDP（2022-47：REQUEST 封装的源/目的 = 0.0.0.0/255.255.255.255，2025-36 同）；
- **ICMP**：差错报告（超时/不可达/源点抑制）+ 询问（ping）；封装于 IP（2012-33）；
- **NAT**：出网替换源 IP（+端口）并记表（2016-38、2020-47）；2025-37：UDP 首部被改 = 源端口 + 校验和。` },
        ],
      },
      {
        name: '第5章 传输层',
        topics: [
          { id: 'net-tcp-conn', hot: true, label: 'TCP 连接建立与释放（三次握手/四次挥手）', status: 'ready' },
          { id: 'net-tcp-cc', hot: true, label: 'TCP 拥塞控制（慢启动/拥塞避免/快重传）', status: 'ready' },
          { id: 'net-tcp-reliable', label: 'TCP 可靠传输与流量控制', status: 'theory', note: `> **真题考情**：序号/确认号推算（2009-38、2011-40、2013-39、2019-39、2021-40、2022-39）+ 流量控制。

## 序号与确认号
- seq = 本段**第一个数据字节**编号；SYN/FIN **各占 1 个序号**；
- **ack = 期望对方下一个字节** = 最后连续收到字节 + 1（累积确认）；
- 模板：SYN seq=1000 → 对方 ack=1001（2026-47）；连续收 300+500B → ack 1000（2009-38）。

## 流量控制
- **发送窗口 = min(rwnd, cwnd)**；rwnd = 接收缓存 − 未取走数据（2021-40：ack=501、rwnd=500 → 可发 [501,1000]）；
- rwnd = 0 → 停发 + **持续计时器**零窗口探测。` },
        ],
      },
      {
        name: '第6章 应用层',
        topics: [
          { id: 'net-dns', label: 'DNS 域名解析过程（递归 / 迭代 / 缓存）', status: 'ready' },
          { id: 'net-http', label: 'HTTP 请求与持久连接（三种连接的 RTT 计数）', status: 'ready' },
          { id: 'net-mail', hot: true, label: '电子邮件与 FTP（SMTP/POP3）', status: 'ready' },
        ],
      },
    ],
  },
];

/* ============================================================================
 * 导航渲染与启动
 * ========================================================================== */
(function boot() {
  let curBook = 'ds';
  let curTopic = null;
  let curFilter = 'all';   // 侧栏筛选：all | ready | other

  const tabsEl = document.getElementById('main-tabs');
  const sidebarEl = document.getElementById('sidebar');
  const mobileEl = document.getElementById('mobile-nav');

  /** 顶部四大主 Tab */
  function renderTabs() {
    tabsEl.innerHTML = RC408.books.map(b => {
      const ready = b.chapters.flatMap(c => c.topics).filter(t => t.status === 'ready').length;
      const total = b.chapters.reduce((n, c) => n + c.topics.length, 0);
      return `<button data-book="${b.id}" class="tab-btn ${b.id === curBook ? 'tab-active' : ''}">
        <span>${b.icon}</span><span>${b.name}</span>
        <span class="tab-badge" title="已实现 / 总数">${ready}/${total}</span>
      </button>`;
    }).join('');
    tabsEl.querySelectorAll('[data-book]').forEach(btn => {
      btn.addEventListener('click', () => selectBook(btn.dataset.book));
    });
  }

  /** 左侧子导航树（章节分组 → 知识点条目；支持 可交互/未上线 筛选） */
  function renderSidebar() {
    const book = RC408.books.find(b => b.id === curBook);
    const matchFilter = t => curFilter === 'all'
      || (curFilter === 'ready' && t.status === 'ready')
      || (curFilter === 'theory' && t.status === 'theory')
      || (curFilter === 'wip' && t.status !== 'ready' && t.status !== 'theory');
    const filterBar = `
      <div class="sticky top-0 z-10 bg-white/95 backdrop-blur px-3 pt-3 pb-2 border-b border-slate-100">
        <div class="flex gap-1">
          ${[['all', '全部'], ['ready', '✓ 可交互'], ['theory', '纯理论'], ['wip', '建设中']].map(([v, t2]) =>
            `<button data-filter="${v}" class="flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-colors ${curFilter === v ? 'bg-indigo-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">${t2}</button>`).join('')}
        </div>
      </div>`;
    sidebarEl.innerHTML = filterBar + book.chapters.map(ch => {
      const topics = ch.topics.filter(matchFilter);
      if (!topics.length) return '';
      return `
      <div class="px-4 pt-4 pb-1 text-[11px] font-bold text-slate-400 tracking-wider">${ch.name}</div>
      ${topics.map(t => t.status === 'ready'
        ? `<button data-topic="${t.id}" class="topic ${t.id === curTopic ? 'topic-active' : ''}">
             <span class="dot"></span><span>${t.label}</span>${t.hot ? '<span class="wip-badge" style="background:#fff1f2;color:#be123c" title="真题高频考点">🔥</span>' : ''}
           </button>`
        : `<button data-topic="${t.id}" class="topic topic-wip" title="${t.legacy ? '该考点已从现行考纲删除，点击查看说明' : '点击查看规划中的内容'}">
             <span class="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></span>
             <span>${t.label}</span>${t.legacy
              ? '<span class="wip-badge" style="background:#fff1f2;color:#9f1239" title="真题曾考，现行考纲已删">考纲外</span>'
              : t.status === 'theory' ? '<span class="wip-badge" style="background:#e0f2fe;color:#0369a1" title="纯理论速记卡（已完成）">📖 纯理论</span>' : t.hot ? '<span class="wip-badge" style="background:#fff1f2;color:#be123c" title="真题高频考点">🔥</span>' : '<span class="wip-badge">敬请期待</span>'}
           </button>`).join('')}`;
    }).join('');
    sidebarEl.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => openTopic(btn.dataset.topic));
    });
    sidebarEl.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => { curFilter = btn.dataset.filter; renderSidebar(); });
    });

    // 移动端横向导航
    mobileEl.innerHTML = book.chapters.flatMap(c => c.topics).map(t =>
      `<button data-topic="${t.id}" class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold ${t.id === curTopic ? 'bg-indigo-500 text-white' : t.status === 'ready' ? 'bg-slate-800 text-indigo-200' : 'bg-slate-800/60 text-slate-500'}">${t.label}${t.status === 'ready' ? '' : ' 🚧'}</button>`
    ).join('');
    mobileEl.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => openTopic(btn.dataset.topic));
    });
  }

  /** 切换主 Tab（书籍），自动打开该书第一个可用知识点 */
  function selectBook(bookId) {
    curBook = bookId;
    const book = RC408.books.find(b => b.id === bookId);
    const all = book.chapters.flatMap(c => c.topics);
    const first = all.find(t => t.status === 'ready') || all[0];
    renderTabs();
    openTopic(first.id);
  }

  /** 打开某个知识点（更新侧栏高亮 → 交给 Runner 渲染工作区） */
  function openTopic(topicId) {
    curTopic = topicId;
    renderSidebar();
    Runner.open(topicId);
  }
  // 供专注模式下拉选择器调用（同步侧栏高亮）
  RC408.openTopicFromUI = openTopic;

  /* ---- 启动 ---- */
  document.addEventListener('DOMContentLoaded', () => {
    Runner.mount();
    renderTabs();
    selectBook('ds');          // 默认打开【数据结构】的第一个可视化
  });
})();
