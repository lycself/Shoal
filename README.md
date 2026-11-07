# E2E Studio · 海洋端到端生态模拟

面向陆架海的端到端（end-to-end）生态模拟工作台：一维水柱与陆架水柱集合，耦合低营养级模型（ERSEM / ECOSMO / ERGOM）与高营养级模块（E2E 功能群 / MIZER 粒径谱），附带入门教程与运行可视化。方法主要依据 Powley et al. (2026) 与 Vijayakumaran et al. (2026)。

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

如果 Python 不在默认位置，设置 `E2E_PYTHON=/path/to/python` 后再 `pnpm dev`。

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
backend/e2estudio/        FastAPI 后端
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
  e2e/                    按论文方程实现的 E2E 鱼类与大型底栖 FABM 模块（Fortran）
  src/                    GOTM、FABM、ERSEM、fabm-mizer、GOTM 算例、ERSEM 设置（build.sh 克隆）
  install/                编译结果（bin/gotm、kernel.json）
workspace/                项目、数据缓存、设置（运行时生成）
```

## 关于 ECOSMO E2E 官方代码（Zenodo）

论文二的官方代码与测试算例在 Zenodo（doi:10.5281/zenodo.20413770），开发环境无法访问 Zenodo，所以 `kernel/e2e/` 是**按论文方程（式 1–19、表 1–3）重写的版本**。实现说明（单位解释、θ 默认值、质量守恒、数值保护）见入门教程第 7、12 章。

手动替换为官方代码：

1. 在能访问 Zenodo 的网络下打开 <https://doi.org/10.5281/zenodo.20413770>，下载源码压缩包（以及测试算例压缩包）。
2. 把 E2E 源码解压到 `kernel/src/ecosmo-e2e/`，确保该目录下有 `CMakeLists.txt`（FABM 外部模块的根目录）。
3. 重新编译：`bash kernel/build.sh`。脚本检测到 `kernel/src/ecosmo-e2e` 后会编译官方代码，首页“计算内核”卡片会显示“官方 ECOSMO E2E”。
4. 测试算例（GOTM 设置目录，含 `gotm.yaml`）可在“站点与物理 → 更换站点 → 导入目录”中直接导入。

注意：官方模块的参数名可能与本软件生成的 fabm.yaml 不同，替换后需要在“食物网配置 → fabm.yaml / 高级参数覆盖”中核对。

## 全球使用

站点和陆架研究都可以放在全球任意陆架海：ERA5（Open-Meteo）、WOA23、ETOPO 都是全球数据。需要注意：

- 低营养级宿主（ERSEM / ECOSMO / ERGOM）是通用模型；高营养级（E2E、MIZER）的参数来自北海，在其他海区应与当地观测对照，并用参数扫描检验敏感度。软件会在站点页给出提示。
- 一维模型没有真实潮汐，潮流混合默认按北海中部设置；强潮或弱潮海区请在“站点与物理”中调整。
- 南半球的季节在读图说明中自动翻转；热带和高纬度（无海冰）有相应提示。
- 本软件面向陆架海（一般 < 200 m）；开阔大洋可以运行，但缺少水平输运的影响更大。

## 已知局限

- 三维采用水柱集合（每个格点独立一维水柱，无水平输运和鱼类洄游）；NEMO-AMM7 完整三维需要超算。
- WOA23 气候态同时被用作松弛目标，因此“验证与稳态”里的 WOA 比较只是一致性检查，不是独立验证；独立验证需要现场观测。
- E2E 模块非官方代码；MIZER 初始鱼类为小量种子，需要足够预热年数；参数未在本站点重新标定。
- 教程内容由 AI 撰写，每章标注“待审核”，使用前请对照原文核对公式与数值。
