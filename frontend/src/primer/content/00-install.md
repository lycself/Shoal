---
id: 00-install
title: 安装与设置：装好软件、接上 AI 助手、数据存在哪里
order: 1
summary: 桌面版怎么下载、安装、第一次打开和更新；AI 助手怎么配置；项目数据存在哪里、怎么备份；开发者怎样从源码运行和打包。
---

# 安装与设置：装好软件、接上 AI 助手、数据存在哪里

> **一句话**：大多数人只需要下载桌面版、双击安装；这一章把安装、第一次打开、更新、AI 助手、数据位置和从源码运行都讲清楚，遇到问题时回来查。

**这一章你会明白**

- 在 macOS、Windows、Linux 上怎样安装和第一次打开 Shoal；
- Shoal 运行时在电脑上做了什么，怎样真正退出；
- 怎样更新、卸载，项目数据存在哪里、怎样备份和搬到另一台电脑；
- 怎样给 AI 助手接上一个大模型，包括本机运行的模型；
- 开发者怎样从源码运行、编译计算内核和打包。

## 桌面版：下载与安装

从项目的 [GitHub Releases 页面](https://github.com/lycself/Shoal/releases/latest) 下载对应系统的安装包。安装包里已经带好了编译好的计算内核和所有依赖，**不需要装 Python、编译器或任何科学计算软件**。

| 系统 | 下载哪个文件 | 怎么安装 |
|---|---|---|
| macOS（Apple 芯片：M1、M2…） | `Shoal-<版本>-macos-arm64.dmg` | 打开 dmg，把 Shoal 拖进“应用程序” |
| macOS（Intel 芯片） | `Shoal-<版本>-macos-x64.dmg` | 同上 |
| Windows 10 / 11 | `Shoal-<版本>-windows-x64-setup.exe` | 双击安装，不需要管理员权限 |
| Linux（Ubuntu 22.04 及以上） | `Shoal-<版本>-linux-x64.tar.gz` | 解压后运行 `Shoal/Shoal`；运行 `./install-desktop-entry.sh` 可以把它加到应用菜单 |

不确定自己的 Mac 是哪种芯片：点屏幕左上角的苹果菜单 → “关于本机”，“芯片”一栏写着 Apple M… 就是 Apple 芯片，写着 Intel 就是 Intel。

### 第一次打开会被系统拦一下

安装包没有购买苹果和微软的付费签名，所以第一次打开时系统会提示“无法验证开发者”。这不是软件有问题，处理一次以后就不会再出现：

- **macOS**：先双击一次（会被拦下），然后打开“系统设置 → 隐私与安全性”，在页面下方找到 Shoal，点“仍要打开”。也可以在“终端”里运行：

  ```
  xattr -dr com.apple.quarantine /Applications/Shoal.app
  ```

- **Windows**：在蓝色的“Windows 已保护你的电脑”窗口里点“更多信息”，再点“仍要运行”。

### Shoal 运行时在做什么

Shoal 由两部分组成：一个在后台运行的**计算服务**（负责下载数据、运行模型、读取结果），和你看到的**界面**（在浏览器窗口里显示）。所以：

- 双击 Shoal 后，它先在后台启动计算服务，然后自动打开一个浏览器页面。
- 托盘区（Windows 屏幕右下角、macOS 屏幕顶部的菜单栏）会出现 Shoal 的图标。
- **关掉浏览器页面不会停止计算**，正在跑的模型会继续跑。点托盘图标里的“打开 Shoal”，或再双击一次 Shoal，就能回到页面。
- 要真正退出，点托盘图标菜单里的“退出 Shoal”，或在[设置](app:settings)页底部点“退出 Shoal”。如果还有计算在运行，会先问你是否要停止它们。

## 更新与卸载

**更新**：Shoal 每隔几个小时会检查一次有没有新版本。有的话，页面顶部会出现提示；到“设置 → 软件版本与更新”点一下，它会下载新版本、校验文件是否完整，然后自动重启到新版本。没联网时只会在设置页显示一行提示，不影响使用。

**卸载**：macOS 把“应用程序”里的 Shoal 拖到废纸篓；Windows 在“设置 → 应用”里卸载；Linux 删除解压出来的文件夹。**更新和卸载都不会删除你的项目**，项目放在下面说的数据目录里。

## 项目数据存在哪里

桌面版把所有数据放在系统的应用数据目录下的 `workspace` 文件夹：

| 系统 | 位置 |
|---|---|
| macOS | `~/Library/Application Support/Shoal/workspace` |
| Windows | `%LOCALAPPDATA%\Shoal\workspace` |
| Linux | `~/.local/share/shoal/workspace` |

macOS 的 `~/Library` 在访达里默认隐藏：在访达里按 ⌘⇧G，粘贴上面的路径即可打开。Windows 在资源管理器的地址栏粘贴 `%LOCALAPPDATA%\Shoal` 回车。

`workspace` 里面有三个文件夹和一个文件：

```
workspace/
    projects/      每个项目一个文件夹（见下）
    cache/         下载过的 ERA5、WOA23、ETOPO 数据，同一地点再用时不用重下
    trash/         删除的项目先移到这里，可以手动拖回 projects/ 恢复
    settings.json  设置页里保存的内容
```

一个项目文件夹长这样：

```
projects/<项目id>/
    project.json      名称、站点、模拟时间、实验设计
    site/             站点强迫文件：气象、WOA 剖面、site.json
    configs/          食物网配置：宿主 + 高营养级模块 + 参数修改
    experiments/      实验：一组按顺序排好的运行
    runs/<运行id>/    gotm.yaml、fabm.yaml、result.nc、gotm.log
    shelf/            三维陆架研究的设置与结果
```

每次运行文件夹里的 `gotm.yaml`（物理设置）、`fabm.yaml`（生态模块和接线）和 `result.nc`（结果，NetCDF 格式）都是标准格式，可以用 Python（xarray）、MATLAB、Panoply、ncview 等工具直接打开，也可以把这个文件夹交给熟悉 GOTM 的同事，用他们自己的 GOTM 重算。

**备份或换电脑**：退出 Shoal 后，把整个 `projects/` 文件夹（或其中某个项目）复制走；在新电脑上安装 Shoal、打开一次让它建好目录，再退出，把项目文件夹放进新电脑的 `projects/`，重新打开即可。`cache/` 可以不复制，缺什么会重新下载。

## 网络与离线使用

只有两件事需要联网：**新建站点时下载公开数据**，和**检查更新**。具体会访问：

| 用途 | 服务器 |
|---|---|
| ERA5 逐小时气象 | Open-Meteo 的历史天气接口（archive-api.open-meteo.com） |
| WOA23 气候态剖面 | 美国国家海洋和大气管理局（NOAA）的数据服务器 |
| ETOPO 2022 水深 | NOAA 的 ERDDAP 数据服务 |
| 软件更新 | GitHub |

下载过的数据会缓存，同一个站点以后不用再联网。没有网络时，新建项目对话框里勾选“没有网络：使用离线算例”，可以用自带的北海北部算例完成所有流程。运行模型、画图、读教程都不需要网络；AI 助手需要能访问你配置的那个大模型接口（本机模型除外）。

如果学校或单位的网络要通过代理才能上网，站点下载可能失败。可以先换一个网络环境把站点建好（数据会缓存下来），之后就能离线使用。

## 接上 AI 助手

AI 助手本身不带大模型，需要你提供一个**兼容 OpenAI 接口格式**的服务。很多服务都兼容这种格式，包括 OpenAI、DeepSeek、通义千问、Moonshot，以及在自己电脑上运行的 Ollama、LM Studio。

在[设置](app:settings)页的“AI 助手”一栏填写三项：

| 项 | 填什么 | 例子 |
|---|---|---|
| 接口地址 | 服务商提供的 API 地址（通常以 `/v1` 结尾） | `https://api.openai.com/v1`、`https://api.deepseek.com/v1` |
| 模型 | 服务商的模型名 | `gpt-4o-mini`、`deepseek-chat`、`qwen-plus` |
| API Key | 在服务商网站上申请的密钥 | 以 `sk-` 开头的一串字符 |

填好后点“测试连接”，看到“连接成功”就可以了，记得点页面底部的“保存”。

**用本机模型（不需要密钥，数据不出电脑）**：安装 [Ollama](https://ollama.com)，在终端运行 `ollama pull qwen2.5:7b` 下载一个模型，然后把接口地址填 `http://localhost:11434/v1`，模型填 `qwen2.5:7b`，API Key 留空。本机模型回答较慢，读取项目和调用工具的能力也比大的在线模型弱，适合简单问答。

**助手能做什么、不能做什么**：它能读取当前项目、配置和运行结果，检索入门教程，统计变量，启动模拟。它想修改配置时只会生成一份“修改提案”，显示要改哪些参数和理由，你点“应用”才会生效（设置里可以改成自动应用，不推荐）。它看到的是你发给它的问题和它调用工具读到的数据，这些内容会发送给你配置的那个大模型服务。

## 常见问题

| 现象 | 原因和办法 |
|---|---|
| 双击没有反应，或页面显示“无法连接计算服务” | 计算服务可能还在启动，等几秒后刷新页面；仍不行就从托盘菜单退出 Shoal 再重新打开 |
| 设置页显示“计算内核未就绪” | 桌面版重新安装一次；源码运行需要先编译内核（见下文） |
| 页面打不开，提示端口被占用 | 另一个 Shoal 还在运行。用托盘菜单退出它，或重启电脑 |
| 站点数据下载失败 | 检查网络和代理；稍后在站点页点“重新构建”；或改用离线算例 |
| 运行很慢 | 在设置里把“同时运行的模型数”设成不超过物理核数；关掉其他占用处理器的程序；三维陆架研究可以先用粗一些的网格 |
| 磁盘占用越来越大 | 在实验页的“全部运行记录”里删除不要的运行；三维陆架研究的结果较大，不要的可以删除 |

## 从源码运行（开发者）

想改代码、加模型或在服务器上运行时，可以从源码运行。支持 macOS、Linux（Ubuntu 等）和原生 Windows。

### 需要准备

- **Python 3.11**（必须是 3.11）
- **Node.js** 和 **pnpm**
- 编译计算内核用的 **gfortran**、**NetCDF-Fortran**、**CMake**、**Git**

各系统安装编译工具的命令：

| 系统 | 命令 |
|---|---|
| macOS | `brew install gcc netcdf-fortran cmake git`（gcc 里带 gfortran） |
| Ubuntu / Debian | `sudo apt install gfortran libnetcdff-dev cmake git` |
| Windows | 安装 [MSYS2](https://www.msys2.org/)，打开“MSYS2 UCRT64”终端运行 `pacman -S --needed mingw-w64-ucrt-x86_64-gcc-fortran mingw-w64-ucrt-x86_64-netcdf-fortran mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-make git`，再把 `C:\msys64\ucrt64\bin` 加进 Windows 的 PATH |

### 步骤

1. **建 Python 虚拟环境**：在仓库根目录，用 Python 3.11 运行 `python -m venv .venv`。
2. **安装后端依赖**：macOS / Linux 运行 `.venv/bin/python -m pip install -r backend/requirements.txt`；Windows 运行 `.venv\Scripts\python -m pip install -r backend\requirements.txt`。国内可以在末尾加 `-i https://pypi.tuna.tsinghua.edu.cn/simple` 换成清华镜像。
3. **安装前端依赖**：`pnpm install`。
4. **检查环境**：`pnpm check:env`。它会逐项检查 `.venv`、Python 版本、依赖和编译工具，缺什么就给出本系统的安装命令。
5. **编译计算内核**：`pnpm kernel`。第一次约 5–10 分钟。它会按锁定的版本下载 GOTM、FABM、ERSEM、FABM-MIZER 的源码，把 ERSEM、MIZER、E2E 鱼类模块（官方代码和按论文方程重写的对照版本）编进同一个 `gotm` 程序，结果放在 `kernel/install/`。
6. **启动**：`pnpm dev`。它同时启动计算服务（端口 8765）和界面（端口 5173），用浏览器打开 `http://localhost:5173`。第一次启动会自动建一个离线演示项目。

源码运行时，项目数据放在仓库里的 `workspace/` 文件夹（不会提交到 Git）。

### 环境变量

| 变量 | 作用 |
|---|---|
| `SHOAL_PYTHON` | 指定 `pnpm kernel` 和 `pnpm dev` 用哪个 Python（默认是仓库根目录的 `.venv`） |
| `SHOAL_WORKSPACE` | 把项目、缓存和设置放到别的文件夹 |
| `SHOAL_KERNEL` | 使用别处编译好的内核（文件夹里要有 `bin/gotm` 和 `kernel.json`） |
| `SHOAL_API_PORT` | 计算服务的端口（默认 8765） |

### 代码结构

| 文件夹 | 内容 |
|---|---|
| `backend/shoal/` | 计算服务（Python，FastAPI）：项目存储、站点数据下载、生成 GOTM 和 FABM 配置、运行队列、读取结果、AI 助手、三维陆架 |
| `frontend/src/` | 界面（React）：各个页面、图表组件，以及本教程（`primer/content/` 里的 Markdown 文件和 `primer/labs.tsx` 里的交互实验） |
| `kernel/` | 计算内核的编译脚本、按论文方程重写的鱼类模块、官方 ECOSMO E2E 源码，以及给官方代码打的物质收支修正补丁 |
| `packaging/` | 打包桌面版的脚本和图标 |

教程的每一章就是 `frontend/src/primer/content/` 里的一个 Markdown 文件，开头的 `order` 决定它在目录里的位置。发现教程有错，可以直接改这些文件。

### 打包桌面版

在当前系统上打安装包（需要先运行过 `pnpm kernel` 和 `pnpm build`）：

```
.venv/bin/python -m pip install -r packaging/requirements.txt
node scripts/venv.mjs packaging/build_app.py
```

安装包会生成在 `dist/release/`。正式发布由 GitHub Actions 在 macOS（Apple 芯片和 Intel）、Windows、Linux 上自动编译、测试、打包，详见仓库的 README。

## 容易误解的地方

- **关掉浏览器不等于退出。** 计算服务还在后台运行，这样长时间的计算不会因为误关页面而中断。真正退出要用托盘菜单。
- **卸载不会删除项目。** 项目在数据目录里，要彻底清除需要手动删除 `workspace` 文件夹。
- **AI 助手不是必需的。** 不配置它，其他所有功能都能正常使用。
- **离线算例不是“简化版”。** 它用的是同一个模型、同一套流程，只是站点数据来自 GOTM 自带的算例，适合在没有网络的课堂上演示。
