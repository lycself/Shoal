---
id: 00-install
title: 安装与设置：软件部署、数据目录与 AI 助手
order: 1
summary: 桌面版的安装、首次启动、自动更新与卸载，项目数据存储位置与迁移备份，AI 助手接口配置，以及源码编译与打包方法。
---

# 安装与设置：软件部署、数据目录与 AI 助手

本章整理了桌面版安装、首次运行安全提示、后台服务机制、项目数据目录、AI 助手配置以及从源码编译打包的完整说明，供安装配置或排查环境问题时查阅。

## 桌面版：下载与安装

普通用户可直接从 [GitHub Releases 页面](https://github.com/lycself/Shoal/releases/latest) 下载对应操作系统的安装包。安装包已内置编译好的 GOTM–FABM 计算内核及全部运行依赖，**无需单独安装 Python、Fortran 编译器或其他科学计算软件**。

| 操作系统 | 安装包文件名 | 安装方式 |
|---|---|---|
| macOS（Apple 芯片：M1 / M2 / M3 / M4） | `Shoal-<版本>-macos-arm64.dmg` | 打开 dmg 镜像，将 Shoal 拖入“应用程序”文件夹 |
| macOS（Intel 芯片） | `Shoal-<版本>-macos-x64.dmg` | 同上 |
| Windows 10 / 11 | `Shoal-<版本>-windows-x64-setup.exe` | 双击运行安装程序，无需管理员权限 |
| Linux（Ubuntu 22.04 及以上） | `Shoal-<版本>-linux-x64.tar.gz` | 解压后运行 `Shoal/Shoal`；执行 `./install-desktop-entry.sh` 可添加至系统应用菜单 |

若不确定 Mac 的处理器架构，可点击屏幕左上角苹果图标 →“关于本机”：显示“Apple M…”即为 Apple 芯片，显示“Intel”则选择 `x64` 版本。

### 首次打开的安全提示处理

由于安装包未采用商业付费签名，首次启动时操作系统可能会弹出安全拦截提示，按以下步骤放行一次即可：

- **macOS**：首次双击被拦截后，打开“系统设置 → 隐私与安全性”，滑至页面底部找到有关 Shoal 的提示，点击“仍要打开”。也可在终端中执行以下命令移除隔离属性：

  ```bash
  xattr -dr com.apple.quarantine /Applications/Shoal.app
  ```

- **Windows**：在弹出的“Windows 已保护你的电脑”窗口中点击“更多信息”，随后点击“仍要运行”。

### 后台运行与退出机制

Shoal 由两部分组成：在后台运行的**本地计算服务**（负责下载强迫数据、调度 GOTM 模拟、读取 NetCDF 输出）以及在浏览器中呈现的**图形界面**。

- 双击启动 Shoal 后，后台计算服务随即启动，并自动调用系统默认浏览器打开工作台页面。
- 系统托盘（Windows 右下角任务栏、macOS 顶部菜单栏）会常驻 Shoal 图标。
- **直接关闭浏览器窗口或标签页不会终止后台服务**，正在运行的模拟任务会继续执行。需要回到界面时，点击托盘图标菜单中的“打开 Shoal”（或再次双击应用图标）即可。
- 若要彻底退出软件，请在托盘图标菜单中选择“退出 Shoal”，或在[设置](app:settings)页底部点击“退出 Shoal”。若当前仍有计算任务在运行，系统会先询问是否终止任务。

## 更新与卸载

- **软件更新**：桌面版每隔数小时会自动检查一次版本更新。发现新版本时，页面顶部会出现更新提示；可在“设置 → 软件版本与更新”中一键下载、校验 SHA-256 并自动重启完成替换。离线环境下仅在设置页显示无法连接提示，不影响正常建模。
- **卸载软件**：macOS 直接将“应用程序”中的 Shoal 移至废纸篓；Windows 在“设置 → 应用”中卸载；Linux 直接删除解压目录。**更新与卸载均不会改动你的项目与缓存数据**。

## 项目数据目录与备份

桌面版将所有用户数据存放在系统级应用数据目录下的 `workspace` 文件夹中：

| 操作系统 | 数据目录路径 |
|---|---|
| macOS | `~/Library/Application Support/Shoal/workspace` |
| Windows | `%LOCALAPPDATA%\Shoal\workspace` |
| Linux | `~/.local/share/shoal/workspace` |

> **提示**：macOS 的 `~/Library` 默认隐藏，可在访达（Finder）中按 `⌘⇧G` 并粘贴上述路径直接前往；Windows 可在资源管理器地址栏粘贴 `%LOCALAPPDATA%\Shoal` 回车。

`workspace` 目录结构如下：

```
workspace/
    projects/      所有项目文件夹
    cache/         已下载的 ERA5、WOA23、ETOPO 原始数据缓存（相同坐标复用时免重复下载）
    trash/         已删除项目的暂存目录，移回 projects/ 即可恢复
    settings.json  用户界面与并发设置
```

单个项目目录内部结构如下：

```
projects/<项目id>/
    project.json      项目名称、站点参数、模拟时间与实验设计元数据
    site/             站点强迫文件（气象序列、WOA 剖面、site.json）
    configs/          食物网配置 JSON（宿主模型、高营养级模块与参数覆盖）
    experiments/      对照实验定义
    runs/<运行id>/    单次运行的 gotm.yaml、fabm.yaml、result.nc 与 gotm.log
    shelf/            三维陆架水柱集合的设置与汇总结果
```

每次运行生成的 `gotm.yaml`、`fabm.yaml` 和 `result.nc` 均为通用标准格式：`result.nc` 可直接用 Python（`xarray` / `netCDF4`）、MATLAB、Panoply 或 `ncview` 读取；整套运行目录也可直接交给其他安装了命令行版 GOTM 的研究者复现计算。

**备份与跨设备迁移**：退出 Shoal 后，复制 `projects/` 目录下的项目文件夹；在另一台电脑上安装并启动一次 Shoal 以初始化目录，退出后将文件夹拷入新电脑的 `projects/` 目录即可。`cache/` 无需随迁，缺失的强迫数据会在构建站点时按需重新下载。

## 网络访问与离线模式

软件仅在**构建新站点强迫数据**和**检查版本更新**时访问以下公开服务：

| 用途 | 远程服务 |
|---|---|
| ERA5 逐小时气象再分析 | Open-Meteo 历史气象接口（`archive-api.open-meteo.com`） |
| WOA23 气候态月均剖面 | NOAA NCEI OPeNDAP 数据服务 |
| ETOPO 2022 全球水深 | NOAA CoastWatch ERDDAP 数据服务 |
| 版本检查与更新包下载 | GitHub Releases |

同一站点的强迫数据下载一次后即保存在本地 `cache/` 中。若在无网络环境（如课堂演示或出海航次）下新建项目，可在新建对话框中勾选“没有网络：使用离线算例”，直接使用内置的北海北部 PROVESS 1998 算例数据完成全流程操作。

## 配置 AI 助手

AI 助手支持接入任何**兼容 OpenAI Chat Completions 接口格式**的大模型服务（如 OpenAI、DeepSeek、通义千问、Moonshot，以及本地运行的 Ollama 或 LM Studio）。无需 AI 助手时可留空，不影响软件其余功能。

在[设置](app:settings)页“AI 助手”区域填写以下三项：

| 配置项 | 说明 | 示例 |
|---|---|---|
| 接口地址 | 服务商提供的 API 根路径（通常以 `/v1` 结尾） | `https://api.openai.com/v1`、`https://api.deepseek.com/v1` |
| 模型名称 | 所调用的模型标识符 | `gpt-4o-mini`、`deepseek-chat`、`qwen-plus` |
| API Key | 服务商签发的访问密钥 | `sk-...` |

填写后点击“测试连接”确认通信正常，再点击页面底部的“保存”。

**使用本地大模型（无需密钥，数据保留在本机）**：安装 [Ollama](https://ollama.com) 后，在终端执行 `ollama pull qwen2.5:7b` 拉取模型，随后将接口地址设为 `http://localhost:11434/v1`、模型设为 `qwen2.5:7b`，API Key 留空即可。

**权限边界**：AI 助手可通过只读工具查询当前项目配置、读取模拟汇总指标、检索教程段落或启动模拟运行；当助手建议修改模型参数时，只会生成一份待确认的“修改提案”，必须由你点击“应用”后才会真正写入配置文件。

## 常见环境问题

| 现象 | 排查方式 |
|---|---|
| 启动后浏览器显示“无法连接计算服务” | 后台服务可能仍在初始化，稍候数秒刷新页面；若仍无响应，从托盘图标退出后重新启动 |
| 设置页提示“计算内核未就绪” | 桌面版请重新安装；源码运行请先执行 `pnpm kernel` 编译内核 |
| 站点数据下载超时或报错 | 检查网络或系统代理设置；稍后在站点页点击“重新构建”，或改用内置离线算例 |
| 多任务运行缓慢 | 在设置页将“同时运行的模型数”调至不超过本机物理核心数；三维陆架研究建议先用较粗分辨率试算 |
| 磁盘空间占用过大 | 在实验页“全部运行记录”中清理不再需要的运行记录或三维陆架研究输出 |

## 从源码编译运行（面向开发者）

如需修改前后端代码、扩展生态模块或在 Linux 服务器上无头部署，可直接从源码运行（支持 macOS、Linux 与 Windows）。

### 依赖环境

- **Python 3.11**
- **Node.js** 与 **pnpm**
- Fortran 编译工具链：**gfortran**、**NetCDF-Fortran**、**CMake**、**Git**

各平台编译工具安装命令：

| 平台 | 安装命令 |
|---|---|
| macOS | `brew install gcc netcdf-fortran cmake git` |
| Ubuntu / Debian | `sudo apt install gfortran libnetcdff-dev cmake git` |
| Windows | 安装 [MSYS2](https://www.msys2.org/)，在“MSYS2 UCRT64”终端执行 `pacman -S --needed mingw-w64-ucrt-x86_64-gcc-fortran mingw-w64-ucrt-x86_64-netcdf-fortran mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-make git`，并将 `C:\msys64\ucrt64\bin` 加入系统 `PATH` |

### 构建与启动步骤

1. **创建 Python 虚拟环境**：在仓库根目录使用 Python 3.11 执行 `python -m venv .venv`。
2. **安装后端依赖**：macOS / Linux 执行 `.venv/bin/python -m pip install -r backend/requirements.txt`；Windows 执行 `.venv\Scripts\python -m pip install -r backend\requirements.txt`（国内网络可附加 `-i https://pypi.tuna.tsinghua.edu.cn/simple`）。
3. **安装前端依赖**：执行 `pnpm install`。
4. **检查编译环境**：执行 `pnpm check:env`，脚本会逐项核对 Python 依赖与编译工具链。
5. **编译计算内核**：执行 `pnpm kernel`（首次编译约需 5–10 分钟，自动拉取指定版本的 GOTM、FABM、ERSEM 与 FABM-MIZER 源码，连同官方与重写的 E2E 模块一并编译至 `kernel/install/`）。
6. **启动开发服务**：执行 `pnpm dev`，同时启动后端 API（`:8765`）与前端开发服务器（`:5173`），浏览器访问 `http://localhost:5173`。源码运行模式下，数据默认保存在仓库根目录的 `workspace/` 下。

### 环境变量与打包

| 环境变量 | 作用 |
|---|---|
| `SHOAL_PYTHON` | 指定 `pnpm kernel` 与 `pnpm dev` 使用的 Python 解释器路径（默认为 `.venv`） |
| `SHOAL_WORKSPACE` | 自定义工作区目录路径 |
| `SHOAL_KERNEL` | 指定外部已编译的内核目录（需包含 `bin/gotm` 与 `kernel.json`） |
| `SHOAL_API_PORT` | 指定后端监听端口（默认 `8765`） |

在本地构建当前平台的桌面安装包（需先完成 `pnpm kernel` 与 `pnpm build`）：

```bash
.venv/bin/python -m pip install -r packaging/requirements.txt
node scripts/venv.mjs packaging/build_app.py
```

打包产物位于 `dist/release/`。教程章节源码位于 `frontend/src/primer/content/*.md`，交互实验组件位于 `frontend/src/primer/labs.tsx`。
