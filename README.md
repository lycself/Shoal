<p align="center">
  <img src="packaging/icons/Shoal.png" width="104" alt="Shoal">
</p>

<h1 align="center">Shoal</h1>

<p align="center">
  <b>浅海生态模拟工作台</b><br>
  在地图上点一个位置，算出那片陆架海一整年的水温、营养盐、浮游生物、底栖动物和鱼。
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-0a66c2">
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-desktop-2b9348">
  <img alt="license" src="https://img.shields.io/badge/license-GPL--3.0--or--later-c2255c">
  <img alt="kernel" src="https://img.shields.io/badge/kernel-GOTM%20%2B%20FABM-e07a0c">
</p>

<p align="center">
  <a href="#下载安装">下载安装</a> ·
  <a href="#五分钟上手">五分钟上手</a> ·
  <a href="#功能导览">功能导览</a> ·
  <a href="#模型与方法">模型与方法</a> ·
  <a href="#从源码运行">从源码运行</a>
</p>

<p align="center">
  <img src="docs/images/foodweb-dark.jpg" alt="Shoal 的食物网视图：能量沿连线从浮游植物流向鱼类" width="100%">
</p>

> *shoal* 在英语里既是“浅海、浅滩”，也是“鱼群”：这正是 Shoal 模拟的地方和对象。

## 为什么做 Shoal

研究“鱼吃掉多少浮游生物、反过来又改变了什么”这类问题，需要把物理海洋、生物地球化学和渔业三种模型接在一起，也就是**端到端（end-to-end）生态模型**。这类模型通常要在超算上编译、手改几十个配置文件、自己写脚本画图，学生很难入门。

Shoal 把整条流程装进一个桌面软件：

- **不用写代码**：选海区、选研究问题，配置和对照实验自动生成，一键运行。
- **全球任意陆架海**：自动下载 ERA5 气象、WOA23 气候态和 ETOPO 水深，生成一维水柱。
- **每张图都会“讲人话”**：图上直接标出水华、温跃层、峰值这些关键时刻和深度，旁边有按数据生成的读图说明。
- **从一根水柱到一片陆架**：同一套配置可以铺满整个陆架，看空间格局。

## 能回答什么问题

| 研究问题 | Shoal 自动生成的对照实验 |
| --- | --- |
| 鱼和底栖动物对浮游生物有多大影响？ | 仅低营养级 / 加大型底栖 / 加鱼类 / 完整 / 只提高浮游动物死亡率 |
| 结论是否依赖所用的低营养级模型？ | 同一套鱼类模块分别接入 ERSEM、ECOSMO、ERGOM |
| 鱼的反馈会改变浮游生物和鱼本身吗？ | 无鱼基线 / 单向耦合（鱼不影响饵料）/ 双向耦合 |
| 用功能群还是粒径谱表示鱼，结论有何不同？ | E2E 功能群与 MIZER 粒径谱接在同一个水柱上 |
| 某个参数有多敏感？ | 参数扫描：任选一个参数和取值，自动生成一组运行 |

## 五分钟上手

1. **新建项目**：在世界地图上点选研究海区（或从常用海区里选），勾选要研究的问题。
2. **等站点数据**：Shoal 在后台下载该位置的气象、气候态剖面和水深，约 1–3 分钟。没有网络时可用自带的离线算例。
3. **运行实验**：在“实验与运行”页点“全部运行”，多个模型进程并行；一次运行（预热加分析共 5 个模拟年）在普通笔记本上约 20 秒。
4. **看结果**：在“结果分析”里比较各运行，或打开“图版”得到可以直接放进报告的多面板图。
5. **铺满陆架**（可选）：在“三维陆架”里选一片海区，每个格点算一根水柱。

<p align="center"><img src="docs/images/home-light.jpg" alt="项目概览：按步骤引导的研究流程" width="100%"></p>

## 功能导览

### 能量怎么在食物网里流动

连线上的光点从被吃者流向捕食者。光点越密、走得越快，这条链上的摄食压力（偏好 × 饵料生物量）越大。节点里的条形是各类群的年均生物量，悬停一个节点只看与它相关的连线。

<p align="center"><img src="docs/images/foodweb-flow.gif" alt="食物网能量流动画" width="560"></p>

### 一根水柱里发生了什么

水柱动画逐日播放一年。左边是带刻度的深度尺，右边用引线标出当天的**混合层底**、**温跃层**和**浮游植物最多的深度**，每一项都直接从剖面算出来，并配一句解释。

<p align="center"><img src="docs/images/column-dark.jpg" alt="水柱动画：深度尺与引线标注" width="100%"></p>

### 季节里的关键时刻

年循环曲线上自动标出水华、第二次高峰、最暖最冷、营养盐耗尽等事件，并按变量命名（南半球的季节会自动翻转）。时间–深度图标出最大值所在的时刻和深度，以及平滑后的混合层深度。

<table>
  <tr>
    <td><img src="docs/images/series-light.jpg" alt="时间序列上的季节事件标注"></td>
    <td><img src="docs/images/hov-light.jpg" alt="时间–深度图与混合层"></td>
  </tr>
</table>

### 站点、强迫与气候态

ERA5 日平均气象画成细线，30 天平均画成粗线，并标出最热、最冷、风最大和日照最强的日子。WOA23 气候态剖面上画出每个月的温跃层（或营养跃层）深度。

<table>
  <tr>
    <td><img src="docs/images/meteo-light.jpg" alt="气象强迫与事件标注"></td>
    <td><img src="docs/images/woa-light.jpg" alt="WOA23 气候态与温跃层"></td>
  </tr>
</table>

### 从一根水柱到一片陆架

陆架研究把同一套配置铺到每个格点（各自独立的一维水柱）。“逐月走势”里每根水柱一条细线，在右端按水深分区汇成一束，落到该分区的全年平均值上；三维视图把水深和指标放在真实地形上。

<table>
  <tr>
    <td><img src="docs/images/ensemble-dark.jpg" alt="陆架水柱集合的逐月走势"></td>
    <td><img src="docs/images/shelf3d-dark.jpg" alt="陆架三维视图"></td>
  </tr>
</table>

### 可以直接放进报告的图版

变量 × 运行的时间–深度矩阵、高营养级年循环、相对基准的差异、逐年变化、碳库与通量差、参数扫描响应；陆架研究有两配置 + 差值地图和多指标百分比变化图。所有图都能导出 3 倍分辨率的 PNG。

<table>
  <tr>
    <td><img src="docs/images/plates-light.jpg" alt="时间–深度矩阵图版"></td>
    <td><img src="docs/images/shelfplates-light.jpg" alt="陆架两配置与差值图版"></td>
  </tr>
</table>

### 结果可信吗

“验证与稳态”检查预热年数够不够（各变量逐年漂移，对数轴上一眼看出谁还没稳定），并与 WOA23 气候态比较偏差、RMSE、相关系数和 Taylor 图。

<p align="center"><img src="docs/images/validate-light.jpg" alt="稳态检查与气候态比较" width="100%"></p>

### 边学边做

15 章入门教程从“Shoal 是什么、第一个项目怎么做”和“安装与设置”讲起，一直到三维陆架和模型局限，配 8 个可以拖动参数的交互实验。内置的 AI 助手（接 OpenAI 兼容接口或本地模型）能读取你的项目和结果、检索教程、启动模拟，并对配置提出修改建议，由你批准后才生效。

<p align="center"><img src="docs/images/primer-light.jpg" alt="入门教程" width="100%"></p>

## 下载安装

从 [Releases](https://github.com/lycself/Shoal/releases/latest) 下载对应系统的安装包，不需要装 Python 或编译器：

| 系统 | 安装包 |
| --- | --- |
| macOS（Apple 芯片 / Intel） | `Shoal-<版本>-macos-arm64.dmg` / `…-macos-x64.dmg`：打开后把 Shoal 拖进“应用程序” |
| Windows 10 / 11 | `Shoal-<版本>-windows-x64-setup.exe`：双击安装，不需要管理员权限 |
| Linux（Ubuntu 22.04 及以上） | `Shoal-<版本>-linux-x64.tar.gz`：解压后运行 `Shoal/Shoal`，`./install-desktop-entry.sh` 可加到应用菜单 |

安装包没有付费签名，第一次打开会被系统拦一下：macOS 在“系统设置 → 隐私与安全性”里点“仍要打开”（或运行 `xattr -dr com.apple.quarantine /Applications/Shoal.app`）；Windows 点“更多信息 → 仍要运行”。

**使用**：双击 Shoal，它在后台启动并打开浏览器，托盘（macOS 是顶部菜单栏）出现 Shoal 图标。关掉浏览器页面不会结束计算；点图标里的“打开 Shoal”就能回到页面，“退出 Shoal”才会真正关闭它。

**更新**：Shoal 每隔几小时检查一次新版本，有的话页面顶部会提示，在“设置 → 软件版本与更新”里一键下载、校验并重启。没联网只会在设置页显示一行提示，不影响使用。项目和数据保存在用户目录（macOS `~/Library/Application Support/Shoal`，Windows `%LOCALAPPDATA%\Shoal`，Linux `~/.local/share/shoal`），更新或卸载都不会删除。

## 模型与方法

| 组成 | 用的是什么 |
| --- | --- |
| 物理 | [GOTM](https://gotm.net) 一维水柱湍流模型（k-ε 湍流闭合），潮流混合用周期性压强梯度近似 |
| 耦合框架 | [FABM](https://fabm.net)：把生态模块接进物理模型 |
| 低营养级宿主 | [ERSEM](https://github.com/pmlmodelling/ersem)、ECOSMO、ERGOM（营养盐、浮游植物、浮游动物、细菌、碎屑、沉积物） |
| 鱼类：功能群 | ECOSMO E2E v2.0：两个鱼类功能群和大型底栖动物（默认用官方代码，可选物质收支修正版） |
| 鱼类：粒径谱 | [FABM-MIZER](https://github.com/BoldingBruggeman/fabm-mizer)：按个体大小划分的鱼类群落，单向或双向耦合 |
| 数据 | ERA5 小时气象（经 Open-Meteo）、World Ocean Atlas 2023 月气候态、ETOPO 2022 水深 |

方法参考：

- Powley et al. (2026), *Progress in Oceanography* 243, 103701：ERSEM 与 FABM-MIZER 粒径谱鱼类的单向 / 双向耦合（西北欧陆架）。
- Vijayakumaran et al. (2026), *EGUsphere* egusphere-2026-3078：ECOSMO E2E v2.0 鱼类与大型底栖功能群，通过 FABM 接入三个宿主（北海中部）。

两篇论文都是 CC BY 4.0 开放获取，全文放在 `reference/`。

## 全球使用与已知局限

- 低营养级宿主是通用模型；高营养级（E2E、MIZER）的参数来自北海，在其他海区应与当地观测对照，并用参数扫描检验敏感度。软件会在站点页给出提示。
- 一维模型没有真实潮汐，潮流混合默认按北海中部设置，强潮或弱潮海区请在“站点与物理”中调整。
- 三维采用水柱集合：每个格点是独立的一维水柱，没有水平输运和鱼类洄游。完整三维（如 NEMO-AMM7）需要超算。
- WOA23 同时用作松弛目标，所以“验证与稳态”里的 WOA 比较只是一致性检查，独立验证需要现场观测。
- 本软件面向陆架海（一般浅于 200 m）；开阔大洋可以运行，但缺少水平输运的影响更大。
- 入门教程由 AI 协助撰写，尚未经过同行审核，引用其中的公式和数值前请对照原文。

<a id="从源码运行"></a>
<details>
<summary><b>从源码运行（开发者）</b></summary>

支持 macOS、Linux（Ubuntu 等）和原生 Windows。需要：Python 3.11、Node.js + pnpm，以及编译内核用的 gfortran、NetCDF-Fortran、CMake、Git。

**1. 建 Python 环境**：在仓库根目录用 Python 3.11 运行

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
| Windows | 装 [MSYS2](https://www.msys2.org/)，在 “MSYS2 UCRT64” 终端运行 `pacman -S --needed mingw-w64-ucrt-x86_64-gcc-fortran mingw-w64-ucrt-x86_64-netcdf-fortran mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-make git`，再把 `C:\msys64\ucrt64\bin` 加进 PATH |

**3. 检查环境、编译内核、启动**：

```bash
pnpm install
pnpm check:env      # 检查 .venv、Python 版本、依赖和编译工具，缺什么就给出本系统的安装命令
pnpm kernel         # 编译 GOTM + pyfabm（含 ERSEM、MIZER、E2E），首次约 5–10 分钟
pnpm dev            # 同时启动后端 :8765 和前端 :5173
```

浏览器打开 <http://localhost:5173>。首次启动会自动创建一个离线演示项目（GOTM 官方北海北部算例，不需要联网）。`pnpm kernel` 和 `pnpm dev` 都用仓库根目录 `.venv` 里的 Python；要换别的解释器，设置 `SHOAL_PYTHON=/path/to/python`。

</details>

<details>
<summary><b>目录结构</b></summary>

```
backend/shoal/        FastAPI 后端
  server.py               HTTP / WebSocket 接口
  projects.py             项目、配置、实验、运行的存储与实验设计模板
  runner.py               后台任务（站点构建、GOTM 运行）与进度
  runs.py                 生成运行目录（gotm.yaml + fabm.yaml），选择输出变量
  results.py              读取 NetCDF：时间–深度、年循环、剖面、对比、粒径谱
  sites/builder.py        站点：开放数据 → GOTM 强迫文件
  data/sources.py         ERA5 / WOA23 / ETOPO 下载与缓存
  ecosystem/              宿主定义、fabm.yaml 生成、食物网图
  threed/                 陆架水柱集合与算力评估
  assistant/agent.py      AI 助手（工具调用）
  desktop/                安装版启动器（托盘、单实例、浏览器）与自动更新
frontend/src/             React 前端（pages/、components/、primer/ 教程与交互实验）
kernel/                   计算内核
  build.py                获取源码并编译 GOTM 与 pyfabm（pnpm kernel）
  e2e/                    按论文方程重写的 E2E 鱼类与大型底栖模块（对照用）
  vendor/ecosmo-e2e/      官方 ECOSMO E2E v2.0 源码与算例（CC BY 4.0，未改动）
  patches/                官方代码的物质收支修正补丁（默认关闭）
packaging/                PyInstaller 配置、Windows 安装器、图标、update.json 生成
docs/images/              本 README 的截图
.github/workflows/        CI（三个平台编译内核并测试）与发布
```

</details>

<details>
<summary><b>打包与发布</b></summary>

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

每次推送都会跑 CI；在 Actions 页面手动运行 CI 可以只打安装包、不发布。

</details>

<details>
<summary><b>ECOSMO E2E 官方代码与修正</b></summary>

鱼类与大型底栖功能群默认用 ECOSMO E2E v2.0 的官方 Fortran 代码（Zenodo doi:10.5281/zenodo.20413770，CC BY 4.0），源码和算例未作改动，放在 `kernel/vendor/ecosmo-e2e/`（来源、许可证和校验和见其中的 `NOTICE.md`）。

1. `pnpm kernel` 把官方代码（FABM 模型名 `ecosmoe2e_fish`、`ecosmoe2e_mb`）和按论文方程重写的版本（`kernel/e2e/`）一起编进内核，安装包里两份都有，在“食物网配置 → 计算代码”里选择。
2. 要重跑验证，需要完整的官方压缩包（`ecosmoe2e_gmd.zip`，含驱动数据和参考结果）：下载后把 `README.md`、`src/`、`testcases/`、`forcing/`、`ibt_survey/` 复制到 `kernel/src/ecosmo-e2e/`。
3. 官方代码里有 5 处物质不守恒或符号错误（鱼的 DOM 部分丢失、鱼呼吸产生氧气、硅按 Redfield 比例被扣掉、呼吸的碳丢失、底栖动物温度项常数）。`kernel/build.py` 在副本上打 `kernel/patches/ecosmo-e2e-corrections.patch`，把修正做成默认关闭的 FABM 参数；“食物网 → 物质收支”选“修正版”（新建配置的默认）时打开，关闭时与原代码逐位相同。说明与验证见 [kernel/patches/README.md](kernel/patches/README.md)。

验证（ERSEM 宿主，北海中部 56°N 3°E，官方驱动与配置，“原样”设置）：第一年与官方参考结果相差 1–4%；官方算例里鱼 2 的两个摄食率写作 0.004，而参考结果用的是 0.0045，改成 0.0045 后高营养级第一年在 1% 以内。官方算例里的 ECOSMO、ERGOM 是未公开的 NECCTON 项目版本，Shoal 用 FABM 自带的 nersc/ecosmo 与 msi/ergom1。详见入门教程的“E2E 功能群”和“模型的局限”两章。

</details>

## 许可证

Shoal 以 [GNU GPL 第 3 版或更高版本](LICENSE)（GPL-3.0-or-later）发布：可以自由使用、修改和转发，转发时须同样以 GPL 提供源码。用 Shoal 算出的结果、图和论文不受许可证约束。安装包里的第三方组件（GOTM、FABM、ERSEM、FABM-MIZER、ECOSMO E2E、NetCDF 及 Python 库等）各有自己的许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
