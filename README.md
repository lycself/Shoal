# Shoal · 浅海生态模拟工作台

shoal 在英语里既是“浅海、浅滩”，也是“鱼群”：这正是本软件模拟的地方和对象。

面向陆架海的端到端（end-to-end）生态模拟工作台：一维水柱与陆架水柱集合，耦合低营养级模型（ERSEM / ECOSMO / ERGOM）与高营养级模块（E2E 功能群 / MIZER 粒径谱），附带入门教程与运行可视化。方法主要依据 Powley et al. (2026) 与 Vijayakumaran et al. (2026)，两篇论文全文（CC BY 4.0 开放获取）放在 `reference/`。

- **Powley et al. (2026)**, *Progress in Oceanography* 243, 103701 — ERSEM 与 FABM-MIZER 粒径谱鱼类的单向/双向耦合（西北欧陆架）。
- **Vijayakumaran et al. (2026)**, *EGUsphere* egusphere-2026-3078 — ECOSMO E2E v2.0：鱼类与大型底栖功能群模块，通过 FABM 接入 ECOSMO / ERSEM / ERGOM（北海中部一维水柱）。

前后端分离：React + TypeScript + Vite 前端，FastAPI 后端，计算内核是开源的 **GOTM + FABM + ERSEM + FABM-MIZER + E2E**（自己编译的 Fortran 程序）。

## 快速开始

```bash
# 1. 创建 conda 环境（编译器、NetCDF、Python 依赖），默认位置 ~/opt/anaconda3/envs/coastal
pnpm setup:env          # 或 bash scripts/setup-env.sh；可用 COASTAL_ENV=/path 指定位置

# 2. 编译计算内核（GOTM + pyfabm，含 ERSEM、MIZER、E2E；首次约 5–10 分钟）
pnpm kernel             # 或 bash kernel/build.sh

# 3. 安装前端依赖并启动（同时启动后端 :8765 和前端 :5173）
pnpm install
pnpm dev
```

浏览器打开 <http://localhost:5173>。首次启动会自动创建一个**离线演示项目**（GOTM 官方北海北部算例，不需要联网）。

如果 Python 不在默认位置，设置 `SHOAL_PYTHON=/path/to/python` 后再 `pnpm dev`。

## 功能

| 页面 | 内容 |
| --- | --- |
| 项目 | 新建时先在世界地图上选研究海区（全球陆架海预设或任意经纬度，实时显示水深、陆地检查与适用性提示），再勾选要研究的问题：低营养级基线、高营养级的下行控制、宿主模型对比、单向 vs 双向耦合、功能群 vs 粒径谱；选择宿主（ERSEM / ECOSMO / ERGOM）后自动生成配置与对照实验。无网络时可用离线算例。首页按步骤引导，第一次可一键运行全部实验 |
| 站点与物理 | 自动下载 ERA5 小时气象（Open-Meteo）、WOA23 月气候态 T/S/营养盐/氧（NOAA OPeNDAP）、ETOPO 水深（NOAA ERDDAP），生成 GOTM 一维水柱（全球任意位置，层数按水深自动约 1 m）；强迫与剖面图表；模拟时间、层数、步长、松弛、潮流混合强度设置；导入任意 GOTM 设置目录 |
| 食物网配置 | 宿主（ERSEM / ECOSMO / ERGOM）+ 高营养级（E2E 功能群 / MIZER 粒径谱，单向或双向）；功能群与粒径谱参数可编辑（默认值来自文献表格）；食物网图；生成的 fabm.yaml；任意参数覆盖 |
| 实验与运行 | 实验组一键运行，多个 GOTM 进程并行，实时进度，日志与配置文件查看，NetCDF 下载；参数扫描（任一 E2E / MIZER / FABM 参数，自动生成一组运行） |
| 结果分析 | 指标对比表与百分比变化、时间–深度图（含差值）、水柱动画、时间序列与年循环、垂向剖面、MIZER 粒径谱、食物网状态；**图版**（变量×运行时间–深度矩阵、高营养级年循环、分组差值柱状图、逐年变化、库与通量差、参数扫描响应与敏感度；点击时间–深度图可弹出该时刻剖面与该深度时间序列）；**验证与稳态**（预热是否足够、与 WOA23 的偏差/RMSE/相关、Taylor 图、季节对比） |
| 三维陆架 | 陆架尺度“水柱集合”（悬停高亮格点、点击格点弹出该水柱的详情与季节循环，可一键以该格点新建一维项目）：选区域与分辨率 → 检测本机算力并估算耗时/磁盘 → 运行 → 地图（数值 / 差值 / 百分比、逐月）、两配置 + 差值与多指标百分比图版、分区统计（西北欧陆架用 Powley et al. 2026 的区域，其他海区按水深分区）、三维地形视图；全球 12 个陆架海预设 |
| 入门教程 | 13 章（软件使用、为什么需要端到端模型、GOTM、FABM、NPZD、三个宿主、粒径谱、功能群、耦合、两篇论文精读、三维、局限），8 个交互实验 |
| AI 助手 | OpenAI 兼容接口（含本地模型）；可读取项目与结果、检索教程、启动模拟、提出配置修改（需批准） |

## 目录

```
backend/shoal/        FastAPI 后端
  server.py               HTTP / WebSocket 接口
  projects.py             项目、配置、实验、运行的存储与论文模板
  runner.py               后台任务（站点构建、GOTM 运行）与进度
  runs.py                 生成运行目录（gotm.yaml + fabm.yaml），选择输出变量
  results.py              读取 NetCDF：时间–深度、年循环、剖面、对比、粒径谱
  sites/builder.py        站点：开放数据 → GOTM 强迫文件；GOTM 配置
  data/sources.py         ERA5 / WOA23 / ETOPO 下载与缓存
  ecosystem/              宿主定义（hosts.py）、fabm.yaml 生成（builder.py）、食物网图（foodweb.py）
  threed/                 陆架水柱集合（shelf.py）与算力评估（resources.py）
  assistant/agent.py      AI 助手（工具调用）
frontend/src/             React 前端（pages/、components/、primer/ 教程内容与交互实验）
kernel/                   计算内核
  build.sh                获取源码并编译 GOTM 与 pyfabm
  e2e/                    按论文方程重写的 E2E 鱼类与大型底栖 FABM 模块（对照用；官方代码放在 src/ecosmo-e2e）
  src/                    GOTM、FABM、ERSEM、fabm-mizer、GOTM 算例、ERSEM 设置（build.sh 按锁定的版本下载，不进仓库）
  install/                编译结果（bin/gotm、kernel.json）
workspace/                项目、数据缓存、设置（运行时生成）
```

## ECOSMO E2E 官方代码

鱼类与大型底栖功能群默认用 ECOSMO E2E v2.0 的官方 Fortran 代码（Vijayakumaran et al. 2026，Zenodo doi:10.5281/zenodo.20413770，GPL）。它不进本仓库，放在 `kernel/src/ecosmo-e2e/`：

1. 从 Zenodo 下载 `ecosmoe2e_gmd.tar.gz`，把解压出的 `README.md`、`src/`、`testcases/`、`forcing/`、`ibt_survey/` 复制到 `kernel/src/ecosmo-e2e/`（`model_output/` 有 5.9 GB 参考结果，不必复制）。
2. 重新编译：`bash kernel/build.sh`。脚本检测到 `kernel/src/ecosmo-e2e/src/CMakeLists.txt` 后，把官方代码（FABM 模型名 `ecosmoe2e_fish`、`ecosmoe2e_mb`）和本软件按论文方程重写的版本（`e2e/fish`、`e2e/macrobenthos`，在 `kernel/e2e/`）一起编进内核。
3. 在“食物网配置”的“计算代码”里选择用哪一份；默认是官方代码，参数取自官方的 ERSEM / ECOSMO / ERGOM 算例。
4. 官方代码里有 5 处物质不守恒或符号错误（鱼的 DOM 部分丢失、鱼呼吸产生氧气、硅按 Redfield 比例被扣掉、呼吸的碳丢失、底栖动物温度项常数）。`kernel/build.sh` 在官方源码的副本上打 `kernel/patches/ecosmo-e2e-corrections.patch`，把修正做成默认关闭的 FABM 参数；“食物网 → 物质收支”选“修正版”（新建配置的默认）时打开。关闭时与原代码逐位相同。说明与验证见 [kernel/patches/README.md](kernel/patches/README.md)。

验证（ERSEM 宿主，北海中部 56°N 3°E，2020–2039 年，官方驱动与配置，“原样”设置）：第一年与官方参考结果相差 1–4%；官方算例里鱼 2 的两个摄食率写作 0.004，而参考结果用的是 0.0045，改成 0.0045 后高营养级第一年在 1% 以内。20 年后的剩余偏差来自 ERSEM 版本（官方未记录），验证时用的是 ERSEM 8510fbf（2024-11-12）。本软件自动生成的鱼类配置与官方配置在同一内核上相差不到 1%。官方算例里的 ECOSMO、ERGOM 是 NECCTON 项目版本（未公开），本软件用 FABM 自带的 nersc/ecosmo 与 msi/ergom1。详见入门教程第 7、12 章。

## 全球使用

站点和陆架研究都可以放在全球任意陆架海：ERA5（Open-Meteo）、WOA23、ETOPO 都是全球数据。需要注意：

- 低营养级宿主（ERSEM / ECOSMO / ERGOM）是通用模型；高营养级（E2E、MIZER）的参数来自北海，在其他海区应与当地观测对照，并用参数扫描检验敏感度。软件会在站点页给出提示。
- 一维模型没有真实潮汐，潮流混合默认按北海中部设置；强潮或弱潮海区请在“站点与物理”中调整。
- 南半球的季节在读图说明中自动翻转；热带和高纬度（无海冰）有相应提示。
- 本软件面向陆架海（一般 < 200 m）；开阔大洋可以运行，但缺少水平输运的影响更大。

## 已知局限

- 三维采用水柱集合（每个格点独立一维水柱，无水平输运和鱼类洄游）；NEMO-AMM7 完整三维需要超算。
- WOA23 气候态同时被用作松弛目标，因此“验证与稳态”里的 WOA 比较只是一致性检查，不是独立验证；独立验证需要现场观测。
- E2E 默认用官方代码加修正补丁，论文的图对应“原样”设置；MIZER 初始鱼类为小量种子，需要足够预热年数；参数未在本站点重新标定。
- 教程内容由 AI 撰写，每章标注“待审核”，使用前请对照原文核对公式与数值。
