"""Write update.json (and the release page text) for a set of built installers.

    python packaging/make_manifest.py --tag v1.2.0 --assets assets/ [--notes notes.md] [--base-url URL]

The app reads https://github.com/lycself/Shoal/releases/latest/download/update.json (see
backend/shoal/desktop/updater.py). Asset names are Shoal-<version>-<platform>[-setup].<ext>, with platform
one of macos-arm64, macos-x64, windows-x64, linux-x64.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
from pathlib import Path

REPOSITORY = "lycself/Shoal"
NAME = re.compile(r"Shoal-(?P<version>\d+(?:\.\d+)*)-(?P<platform>(?:macos|windows|linux)-(?:arm64|x64))(?:-setup)?\.(?:dmg|exe|tar\.gz)\Z")

INSTALL_NOTES = """
## 安装

| 系统 | 下载 | 说明 |
| --- | --- | --- |
| macOS（Apple 芯片） | `{macos-arm64}` | 打开 .dmg，把 Shoal 拖进“应用程序” |
| macOS（Intel） | `{macos-x64}` | 同上 |
| Windows 10/11 | `{windows-x64}` | 双击安装，不需要管理员权限 |
| Linux（Ubuntu 22.04 及以上） | `{linux-x64}` | 解压后运行 `Shoal/Shoal`；`./install-desktop-entry.sh` 可加到应用菜单 |

安装包没有付费签名，第一次打开时系统会拦一下：

- **macOS**：提示“无法验证开发者”时，打开“系统设置 → 隐私与安全性”，在页面下方点“仍要打开”。也可以在终端运行 `xattr -dr com.apple.quarantine /Applications/Shoal.app`。只有第一次需要。
- **Windows**：出现“Windows 已保护你的电脑”时，点“更多信息 → 仍要运行”。

之后的版本由 Shoal 自己检查和安装（设置 → 软件版本与更新），不会再被拦。项目和数据保存在用户目录里，更新或卸载都不会删除。
"""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--assets", required=True, type=Path)
    ap.add_argument("--notes", type=Path, help="release notes (Markdown/plain text) shown in the app")
    ap.add_argument("--base-url", help="where the assets are downloaded from (default: the GitHub release)")
    ap.add_argument("--out", type=Path, help="default: <assets>/update.json")
    ap.add_argument("--body", type=Path, help="also write the release page text here")
    args = ap.parse_args()

    version = args.tag.removeprefix("v")
    base = (args.base_url or f"https://github.com/{REPOSITORY}/releases/download/{args.tag}").rstrip("/")
    assets = {}
    for f in sorted(args.assets.iterdir()):
        m = NAME.fullmatch(f.name)
        if not m:
            continue
        if m["version"] != version:
            raise SystemExit(f"!! {f.name} is not version {version}")
        assets[m["platform"]] = {"name": f.name, "url": f"{base}/{f.name}", "sha256": sha256(f), "size": f.stat().st_size}
    if not assets:
        raise SystemExit(f"!! no installers found in {args.assets}")
    notes = args.notes.read_text(encoding="utf-8").strip() if args.notes and args.notes.exists() else ""
    manifest = {"schema": 1, "app": "shoal", "version": version, "tag": args.tag,
                "published": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "notes": notes or f"Shoal {version}", "assets": assets}
    out = args.out or args.assets / "update.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f">> {out}: {', '.join(assets)}")
    if args.body:
        names = {k: v["name"] for k, v in assets.items()}
        table = INSTALL_NOTES.format(**{p: names.get(p, "（本版本未提供）") for p in
                                        ("macos-arm64", "macos-x64", "windows-x64", "linux-x64")})
        args.body.write_text((notes + "\n" if notes else "") + table, encoding="utf-8")


if __name__ == "__main__":
    main()
