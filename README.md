# Shoal · 浅海生态模拟工作台

shoal 在英语里既是“浅海、浅滩”，也是“鱼群”：这正是本软件模拟的地方和对象。

面向陆架海的端到端（end-to-end）生态模拟工作台：一维水柱与陆架水柱集合，耦合低营养级模型（ERSEM / ECOSMO / ERGOM）与高营养级模块（E2E 功能群 / MIZER 粒径谱），附带入门教程与运行可视化。方法主要依据 Powley et al. (2026) 与 Vijayakumaran et al. (2026)，两篇论文全文（CC BY 4.0 开放获取）放在 `reference/`。

- **Powley et al. (2026)**, *Progress in Oceanography* 243, 103701 — ERSEM 与 FABM-MIZER 粒径谱鱼类的单向/双向耦合（西北欧陆架）。
- **Vijayakumaran et al. (2026)**, *EGUsphere* egusphere-2026-3078 — ECOSMO E2E v2.0：鱼类与大型底栖功能群模块，通过 FABM 接入 ECOSMO / ERSEM / ERGOM（北海中部一维水柱）。

前后端分离：React + TypeScript + Vite 前端，FastAPI 后端，计算内核是开源的 **GOTM + FABM + ERSEM + FABM-MIZER + E2E**（自己编译的 Fortran 程序）。

## 下载安装

从 [Releases](https://github.com/lycself/Shoal/releases/latest) 下载对应系统的安装包，不需要装 Python 或编译器：

| 系统 | 安装包 |
| --- | --- |
| macOS（Apple 芯片 / Intel） | `Shoal-<版本>-macos-arm64.dmg` / `…-macos-x64.dmg`：打开后把 Shoal 拖进“应用程序” |
| Windows 10/11 | `Shoal-<版本>-windows-x64-setup.exe`：双击安装，不需要管理员权限 |
| Linux（Ubuntu 22.04 及以上） | `Shoal-<版本>-linux-x64.tar.gz`：解压后运行 `Shoal/Shoal`，`./install-desktop-entry.sh` 可加到应用菜单 |

安装包没有付费签名，第一次打开会被系统拦一下：macOS 在“系统设置 → 隐私与安全性”里点“仍要打开”（或运行 `xattr -dr com.apple.quarantine /Applications/Shoal.app`）；Windows 点“更多信息 → 仍要运行”。

**用法**：双击 Shoal，它在后台启动并打开浏览器；任务栏右下角（macOS 是屏幕顶部菜单栏）出现 Shoal 图标。关掉浏览器页面不会结束 Shoal，计算继续进行；点图标里的“打开 Shoal”（或再双击一次 Shoal）就能回到页面。只有图标菜单里的“退出 Shoal”（或设置页的“退出 Shoal”按钮）才会真正关闭它。

**更新**：Shoal 每隔几小时查一次有没有新版本，有的话页面顶部会提示，在“设置 → 软件版本与更新”里一键下载、校验并自动重启到新版本。查不到（比如没联网）只会在设置页显示一行提示，不影响使用。项目和数据保存在用户目录（macOS `~/Library/Application Support/Shoal`，Windows `%LOCALAPPDATA%\Shoal`，Linux `~/.local/share/shoal`），更新或卸载都不会删除。

## 从源码运行（开发）

支持 macOS、Linux（Ubuntu 等）和原生 Windows。需要：Python 3.11、Node.js + pnpm，以及编译内核用的 gfortran、NetCDF-Fortran、CMake、Git。

**1. 建 Python 环境**：在仓库根目录、用 Python 3.11（例如先激活你的 3.11 环境）运行：

```bash
python -m venv .venv
```

然后安装后端依赖（macOS / Linux）：

```bash
.venv/bin/python -m pip install -r backend/requirements.txt
```

Windows：

```bat
.venv\Scripts\python -m pip install -r backend\requirements.txt
```

国内可加 `-i https://pypi.tuna.tsinghua.edu.cn/simple` 换镜像。

**2. 装编译工具**（只需一次）：

| 系统 | 命令 |
| --- | --- |
| macOS | `brew install gcc netcdf-fortran cmake git`（gcc 里带 gfortran） |
| Ubuntu / Debian | `sudo apt install gfortran libnetcdff-dev cmake git` |
| Windows | 装 [MSYS2](https://www.msys2.org/)，在 “MSYS2 UCRT64” 终端运行 `pacman -S --needed mingw-w64-ucrt-x86_64-gcc-fortran mingw-w64-ucrt-x86_64-netcdf-fortran mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-make git`，再把 `C:\msys64\ucrt64\bin` 加进 Windows 的 PATH |

**3. 检查环境、编译内核、启动：**

```bash
pnpm install
pnpm check:env      # 检查 .venv、Python 版本、依赖和编译工具，缺什么就给出本系统的安装命令
pnpm kernel         # 编译 GOTM + pyfabm（含 ERSEM、MIZER、E2E），首次约 5–10 分钟；等于 .venv 的 python kernel/build.py
pnpm dev            # 同时启动后端 :8765 和前端 :5173
```

浏览器打开 <http://localhost:5173>。首次启动会自动创建一个**离线演示项目**（GOTM 官方北海北部算例，不需要联网）。

`pnpm kernel` 和 `pnpm dev` 都用仓库根目录 `.venv` 里的 Python；要换别的解释器，设置 `SHOAL_PYTHON=/path/to/python`。

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
  build.py                获取源码并编译 GOTM 与 pyfabm（pnpm kernel）
  e2e/                    按论文方程重写的 E2E 鱼类与大型底栖 FABM 模块（对照用）
  vendor/ecosmo-e2e/      官方 ECOSMO E2E v2.0 源码与算例（CC BY 4.0，未改动，见 NOTICE.md）
  src/                    GOTM、FABM、ERSEM、fabm-mizer、GOTM 算例、ERSEM 设置（build.py 按锁定的版本下载，不进仓库）
  install/                编译结果（bin/gotm 或 Windows 上的 bin/gotm.exe、kernel.json）
workspace/                项目、数据缓存、设置（源码运行时生成；安装版放在用户目录）
backend/shoal/desktop/    安装版的启动器（托盘图标、单实例、浏览器）与自动更新（updater.py）
packaging/                打包：PyInstaller 配置、Windows 安装器（Inno Setup）、图标、update.json 生成
.github/workflows/        CI（三个平台编译内核并测试）与发布
```

## 打包与发布

本地打当前系统的安装包（需要先 `pnpm kernel` 和 `pnpm build`）：

```bash
.venv/bin/python -m pip install -r packaging/requirements.txt
node scripts/venv.mjs packaging/build_app.py      # → dist/release/
```

发布新版本：把 `backend/shoal/version.py` 改成新版本号并提交，然后推送带说明的标签。GitHub Actions 会在 macOS（Apple 芯片、Intel）、Windows、Linux 上编译、测试、打包，并创建 Release 和 `update.json`，已安装的 Shoal 随后就会提示更新。标签说明就是软件里显示的“更新内容”。

```bash
git tag -a v1.0.1 -m "这一版的更新内容"
git push origin v1.0.1
```

每次推送都会跑 CI；在 Actions 页面手动运行 CI 可以只打安装包、不发布（下载 artifact 自测）。

## ECOSMO E2E 官方代码

鱼类与大型底栖功能群默认用 ECOSMO E2E v2.0 的官方 Fortran 代码（Vijayakumaran et al. 2026，Zenodo doi:10.5281/zenodo.20413770，CC BY 4.0）。它的源码和算例随本仓库提供，未作改动，放在 `kernel/vendor/ecosmo-e2e/`（来源、许可证和校验和见其中的 `NOTICE.md`）：

1. `pnpm kernel` 把官方代码（FABM 模型名 `ecosmoe2e_fish`、`ecosmoe2e_mb`）和本软件按论文方程重写的版本（`e2e/fish`、`e2e/macrobenthos`，在 `kernel/e2e/`）一起编进内核，安装包里也是两份都有。
2. 要重跑下面的验证，需要完整的官方压缩包（`ecosmoe2e_gmd.zip`，4.2 GB，含驱动数据和 5.9 GB 参考结果）：从 Zenodo 下载后把 `README.md`、`src/`、`testcases/`、`forcing/`、`ibt_survey/` 复制到 `kernel/src/ecosmo-e2e/`。这里有源码时编译优先用它（也可以用来换成更新的官方版本）。
3. 在“食物网配置”的“计算代码”里选择用哪一份；默认是官方代码，参数取自官方的 ERSEM / ECOSMO / ERGOM 算例。
4. 官方代码里有 5 处物质不守恒或符号错误（鱼的 DOM 部分丢失、鱼呼吸产生氧气、硅按 Redfield 比例被扣掉、呼吸的碳丢失、底栖动物温度项常数）。`kernel/build.py` 在官方源码的副本上打 `kernel/patches/ecosmo-e2e-corrections.patch`，把修正做成默认关闭的 FABM 参数；“食物网 → 物质收支”选“修正版”（新建配置的默认）时打开。关闭时与原代码逐位相同。说明与验证见 [kernel/patches/README.md](kernel/patches/README.md)。

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

## 许可证

Shoal 以 [GNU GPL 第 3 版或更高版本](LICENSE)（GPL-3.0-or-later）发布：可以自由使用、修改和转发，转发时须同样以 GPL 提供源码。用 Shoal 算出的结果、图和论文不受许可证约束。安装包里的第三方组件（GOTM、FABM、ERSEM、FABM-MIZER、ECOSMO E2E、NetCDF 及 Python 库等）各有自己的许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
