'use strict';
/* ============================================================================
 * app.js —— 四本书的目录树 + 主导航 + 启动
 * ----------------------------------------------------------------------------
 * 章节结构对照《25 考研 408 大纲》考查范围组织（见 考纲/25考研408大纲.pdf），
 * 各条目考频依据 2009-2025 共 17 年真题统计（详见 README「真题考情分析」）。
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
          { id: 'ds-seqlist', label: '顺序表 vs 链表', status: 'wip', plan: '插入/删除的元素移动次数对比、双栏联动' },
        ],
      },
      {
        name: '第3章 栈、队列和数组',
        topics: [
          { id: 'ds-stack-queue', hot: true, label: '栈与队列出入演示', status: 'wip', plan: '出入栈序列合法性、循环队列队空队满条件、共享栈（几乎每年选择题）' },
          { id: 'ds-expression', label: '中缀 → 后缀表达式求值', status: 'wip', plan: '运算符栈/操作数栈逐步弹压、后缀式逐项生成' },
          { id: 'ds-matrix', label: '特殊矩阵压缩存储', status: 'wip', plan: '对称/三对角矩阵元素↔一维下标映射、多维数组地址计算（2025 真题）' },
        ],
      },
      {
        name: '第4章 树与二叉树',
        topics: [
          { id: 'ds-bintree-traversal', hot: true, label: '二叉树的遍历（前/中/后/层序）', status: 'ready' },
          { id: 'ds-huffman', hot: true, label: '哈夫曼树与哈夫曼编码', status: 'ready' },
          { id: 'ds-bst-avl', label: '二叉排序树与 AVL 旋转', status: 'wip', plan: 'BST 插入路径、LL/RR/LR/RL 旋转节点滑动' },
          { id: 'ds-clue', label: '线索二叉树', status: 'wip', plan: '空指针改造为前驱/后继线索的动画' },
          { id: 'ds-heap', label: '堆与优先队列', status: 'wip', plan: '完全二叉树+数组双视角的建堆/筛选动画（ds-sort 已含堆排序）' },
          { id: 'ds-unionfind', label: '并查集', status: 'wip', plan: 'union/find 路径压缩动画（Kruskal 模块内已有演示）' },
        ],
      },
      {
        name: '第5章 图',
        topics: [
          { id: 'ds-graph-storage', label: '图的存储（邻接矩阵/表）', status: 'wip', plan: '两种存储互转、边表挂接、度数计算' },
          { id: 'ds-dfs-bfs', label: '图的遍历 DFS / BFS', status: 'wip', plan: '访问序列、递归栈/队列可视化' },
          { id: 'ds-kruskal', label: 'Kruskal 最小生成树', status: 'ready' },
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
          { id: 'ds-rbtree', label: '红黑树基本概念', status: 'wip', plan: '插入重染色与旋转动画（考纲树型查找新增）' },
          { id: 'ds-btree', hot: true, label: 'B 树与 B+ 树', status: 'wip', plan: '插入分裂/删除合并动画、高度与关键字数计算' },
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
          { id: 'coa-baseconv', label: '进位计数制与转换', status: 'wip', plan: '二↔八↔十↔十六进制逐位换算动画（2024/2025 连续考）' },
          { id: 'coa-float754', hot: true, label: 'IEEE 754 浮点数表示', status: 'ready' },
          { id: 'coa-floatadd', label: '浮点数的加/减运算', status: 'wip', plan: '对阶→尾数求和→规格化→溢出判断的分步动画（2009 真题）' },
          { id: 'coa-muldiv', label: '乘除运算电路', status: 'wip', plan: '移位+加减的乘法逐步演示、原码/补码除法（2025 大题）' },
          { id: 'coa-hamming', label: '海明码与校验', status: 'wip', legacy: '现行考纲"数据的表示和运算"章已不含校验码（CRC 校验仍属于计算机网络链路层的差错控制）；2013 年真题曾考"纠 1 位错最少校验位数"。' },
        ],
      },
      {
        name: '第3章 存储器层次结构',
        topics: [
          { id: 'coa-cache-direct', hot: true, label: 'Cache 直接映射', status: 'ready' },
          { id: 'coa-cache-assoc', hot: true, label: '组相联与全相联映射', status: 'ready' },
          { id: 'coa-mainmem', label: '主存与 CPU 连接（芯片扩展）', status: 'wip', plan: '字扩展/位扩展芯片拼装、地址范围分配' },
          { id: 'coa-sram-dram', label: 'SRAM / DRAM / Flash 特点对比', status: 'wip', plan: '刷新/触发方式/易失性对比表（2010/2011/2012 真题）' },
          { id: 'coa-disk', label: '磁盘存储器', status: 'wip', plan: '寻道+旋转延迟分解、扇区地址三字段、平均存取时间计算（RAID 已移出现行考纲，2013 年真题曾考）' },
          { id: 'coa-optical', label: '光盘存储器 / CD-ROM', status: 'wip', legacy: '现行考纲外部存储器仅含磁盘与 SSD，光盘相关内容已删；2011 年真题（不采用随机存取方式的存储器）、2013 年真题（CD-ROM 视频随机播放的文件物理结构）曾考。' },
          { id: 'coa-vm', label: '页式虚拟存储器', status: 'wip', plan: '硬件视角虚实地址转换（与操作系统篇联动）' },
        ],
      },
      {
        name: '第4章 指令系统',
        topics: [
          { id: 'coa-addressing', hot: true, label: '指令寻址方式（EA 的形成）', status: 'ready' },
          { id: 'coa-inst-format', label: '指令格式与扩展操作码', status: 'wip', plan: '定长/变长操作码位分配、零地址指令条数推算' },
          { id: 'coa-endian', label: '数据的对齐与大小端存放', status: 'wip', plan: '结构体成员地址逐年推演（2015/2016/2019/2020/2025 连续考）' },
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
          { id: 'coa-microprog', label: '微程序控制器', status: 'wip', plan: '微指令序列执行、下地址字段断定方式' },
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
          { id: 'coa-bus', label: '总线事务与定时', status: 'wip', plan: '同步/异步握手时序、突发传输与带宽计算（总线仲裁已移出现行考纲）' },
          { id: 'coa-bus-standard', label: '总线标准（PCI/ISA/USB…）', status: 'wip', legacy: '现行考纲总线部分仅含基本概念、组成及性能指标、总线事务和定时，具体总线标准条目已删；2010 年（PCI/ISA/EISA）、2012 年（USB）、2013 年（PCI/USB/AGP/PCI-E）真题曾考。' },
          { id: 'coa-io', hot: true, label: 'I/O 方式（查询/中断/DMA）', status: 'wip', plan: '三种方式 CPU 时间占比对比、DMA 周期挪用动画' },
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
          { id: 'os-intro', label: '运行环境：中断/异常/系统调用', status: 'wip', plan: '用户态↔核心态切换、系统调用全流程（含键盘输入例题动画）' },
          { id: 'os-structure', label: '操作系统结构（宏内核/微内核）', status: 'theory', note: `> **真题考情**：2023-23 考微内核特征（较高可靠性/安全性/可扩展性，性能较差）

## OS 结构分类（2023 真题考微内核特征）
- **宏内核（单体）**：全部系统服务都在内核态——性能好、耦合高（Linux 典型）；
- **微内核**：内核只保留最基本功能（中断/调度/基本 IPC），其余服务放用户态进程——**可靠性、安全性、可扩展性更好**，但消息传递带来性能开销（2023 真题答案）；
- **外核**：资源分配与使用分离，库操作系统复用内核缓冲；
- **层次结构**：逐层搭建、单向调用，结构清晰但效率低。` },
          { id: 'os-boot', label: '操作系统引导与虚拟机', status: 'wip', plan: 'ROM→MBR→分区引导扇区逐级加载动画' },
        ],
      },
      {
        name: '第2章 进程与线程',
        topics: [
          { id: 'os-procstate', hot: true, label: '进程状态转换（五态模型）', status: 'ready' },
          { id: 'os-ipc', label: '进程间通信（共享内存/消息/管道/信号）', status: 'wip', plan: '管道读写阻塞、消息队列传递动画（2014 真题）' },
          { id: 'os-pv', hot: true, label: '同步与互斥 · PV 操作（生产者-消费者）', status: 'ready' },
          { id: 'os-classic', hot: true, label: '经典同步问题（读者写者/哲学家）', status: 'wip', plan: '读者计数器、哲学家拿叉死锁避免的信号量设计' },
          { id: 'os-monitor', label: '管程', status: 'wip', legacy: '现行考纲同步互斥部分以锁、信号量、条件变量表述，管程条目已不再出现；2016 年真题（管程叙述）、2018 年真题（条件变量 x.wait() 的行为）曾考。' },
          { id: 'os-sched', hot: true, label: '处理机调度（FCFS/SJF/HRRN/RR）', status: 'ready' },
          { id: 'os-deadlock', label: '死锁与银行家算法', status: 'ready' },
        ],
      },
      {
        name: '第3章 内存管理',
        topics: [
          { id: 'os-mem-alloc', label: '连续分配与动态分区', status: 'wip', plan: '首次/最佳/最坏适应切割合并、空闲链变化' },
          { id: 'os-vm-paging', hot: true, label: '页式虚拟内存 · 地址转换（TLB+缺页）', status: 'ready' },
          { id: 'os-lru', hot: true, label: '页面置换 · LRU（含推导表）', status: 'ready' },
          { id: 'os-page-replace', label: 'FIFO / OPT / CLOCK 置换对比', status: 'wip', plan: '三算法并行推演、Belady 异常、改进型 CLOCK 的 (A,M) 位' },
        ],
      },
      {
        name: '第4章 文件管理',
        topics: [
          { id: 'os-file-alloc', hot: true, label: '文件物理结构与混合索引计算', status: 'ready' },
          { id: 'os-bitmap', label: '外存空闲空间管理（位图/FAT）', status: 'wip', plan: '位图坐标↔块号换算、成组链接法' },
        ],
      },
      {
        name: '第5章 输入/输出管理',
        topics: [
          { id: 'os-disk-sched', label: '磁盘调度 SSTF / SCAN / C-SCAN', status: 'ready', hot: true },
          { id: 'os-buffer', label: '缓冲区管理（单/双缓冲）', status: 'wip', plan: '读入/传送/分析三阶段流水时间图' },
          { id: 'os-ioctl', label: 'I/O 控制方式与软件层次', status: 'wip', plan: '轮询/中断/DMA 的 CPU 占用对比、四层软件排序（2012/2022 真题）' },
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
          { id: 'net-layers', label: '分层模型（OSI vs TCP/IP）', status: 'wip', plan: '数据包逐层封装/拆封动画、协议归属归类' },
          { id: 'net-model', label: '网络应用模型（C/S 与 P2P）', status: 'theory', note: `> **真题考情**：2019-40 考网络应用模型辨析（P2P 对等、客户间不直接通信等）

## 网络应用模型（2019 真题辨析）
| 模型 | 特点 |
| --- | --- | --- |
| **C/S 客户/服务器** | 服务集中于服务器；客户之间**不直接通信**；服务器可能成为瓶颈 |
| **P2P 对等** | 每个结点既是客户又是**服务器**；自扩展性强；管理难 |

**要点**：客户程序按用户需要临时通信，服务器程序常驻被动等待；同一主机可同时运行多个服务器/客户进程（端口号区分）；BT 下载、文件分发 → P2P。` },
          { id: 'net-perf', label: '性能指标与时延计算', status: 'wip', plan: '发送/传播/排队时延分解、时延带宽积演示' },
        ],
      },
      {
        name: '第2章 物理层',
        topics: [
          { id: 'net-shannon', hot: true, label: '奈奎斯特定理与香农定理', status: 'ready' },
          { id: 'net-encode', label: '编码与调制', status: 'wip', plan: 'NRZ/曼彻斯特/差分曼彻斯特波形逐位绘制' },
          { id: 'net-swap', label: '电路/报文/分组交换对比', status: 'wip', plan: '三种交换方式的传输时间线对比动画' },
        ],
      },
      {
        name: '第3章 数据链路层',
        topics: [
          { id: 'net-crc', label: 'CRC 循环冗余校验', status: 'ready' },
          { id: 'net-hdlc', label: 'HDLC 组帧（广域网）', status: 'wip', legacy: '现行考纲广域网部分仅含 PPP，HDLC 已删；2013 年真题曾考零比特填充组帧。' },
          { id: 'net-window', hot: true, label: '滑动窗口可靠传输（停等/GBN/SR）', status: 'ready' },
          { id: 'net-csma', hot: true, label: 'CSMA/CD 与最小帧长', status: 'wip', plan: '冲突传播动画、争用期与二进制指数退避' },
          { id: 'net-switch', label: '以太网交换机自学习', status: 'wip', plan: '转发表逐步建立、帧过滤/转发/泛洪判定' },
        ],
      },
      {
        name: '第4章 网络层',
        topics: [
          { id: 'net-subnet', hot: true, label: 'IPv4 地址与子网划分', status: 'ready' },
          { id: 'net-fragment', label: 'IP 分片与重组', status: 'wip', plan: '总长度/片偏移/MF 标志拆分演示' },
          { id: 'net-routing', hot: true, label: '路由算法与协议（RIP/OSPF/BGP）', status: 'wip', plan: '距离向量逐轮更新、坏消息传播慢、最短路径树' },
          { id: 'net-ipv6', label: 'IPv6（地址与特点）', status: 'wip', plan: 'IPv4/IPv6 首部对比、双协议栈与隧道（2023 真题）' },
          { id: 'net-arp', label: 'ARP / DHCP / ICMP / NAT', status: 'wip', plan: 'ARP 广播→应答、DHCP 四步报文、NAT 地址转换表' },
        ],
      },
      {
        name: '第5章 传输层',
        topics: [
          { id: 'net-tcp-conn', hot: true, label: 'TCP 连接建立与释放（三次握手/四次挥手）', status: 'ready' },
          { id: 'net-tcp-cc', hot: true, label: 'TCP 拥塞控制（慢启动/拥塞避免/快重传）', status: 'ready' },
          { id: 'net-tcp-reliable', label: 'TCP 可靠传输与流量控制', status: 'wip', plan: '序号/确认号推算、发送窗口=min(rwnd,cwnd)' },
        ],
      },
      {
        name: '第6章 应用层',
        topics: [
          { id: 'net-dns', label: 'DNS 域名解析过程', status: 'wip', plan: '迭代/递归查询报文往返、缓存命中判定' },
          { id: 'net-http', label: 'HTTP 请求与持久连接', status: 'wip', plan: '非流水线/流水线 RTT 计算对比动画' },
          { id: 'net-mail', label: '电子邮件与 FTP（SMTP/POP3）', status: 'wip', plan: '收发全程协议切换动画、控制/数据连接' },
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
              : t.hot ? '<span class="wip-badge" style="background:#fff1f2;color:#be123c" title="真题高频考点">🔥</span>' : '<span class="wip-badge">敬请期待</span>'}
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
