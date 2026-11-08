#!/bin/sh
# Add Shoal to the application menu of this Linux desktop (current user only). Run it from the Shoal folder:
#   ./install-desktop-entry.sh
# Keep the folder where it is afterwards: the menu entry points here, and updates replace this folder in place.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"
cat > "$APPS/shoal.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Shoal
Comment=浅海生态模拟工作台
Exec="$DIR/Shoal"
Icon=$DIR/Shoal.png
Terminal=false
Categories=Science;Education;
DESKTOP
echo "已添加到应用菜单：$APPS/shoal.desktop"
