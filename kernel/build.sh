#!/usr/bin/env bash
# Build the Shoal computational kernel:
#   * gotm      — GOTM 1D water column with FABM and the institutes below
#   * pyfabm    — FABM Python interface (0D runs, labs, offline MIZER) with the same institutes
#
# Institutes compiled on top of FABM's defaults:
#   ersem  (pmlmodelling/ersem)          LTL host used by both papers
#   mizer  (pmlmodelling/fabm-mizer)     size-spectrum HTL (Powley et al. 2026)
#   e2e    (kernel/e2e or official code) functional-group fish/macrobenthos (Vijayakumaran et al. 2026)
# ECOSMO (nersc) and ERGOM (msi, iow) ship with FABM itself.
#
# Usage:  kernel/build.sh [--env <conda prefix>] [--clean] [--only gotm|pyfabm]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/src"
BUILD="$HERE/build"
PREFIX="$HERE/install"
ENV_PREFIX="${COASTAL_ENV:-$HOME/opt/anaconda3/envs/coastal}"
ONLY=""
CLEAN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_PREFIX="$2"; shift 2;;
    --clean) CLEAN=1; shift;;
    --only) ONLY="$2"; shift 2;;
    *) echo "unknown option $1"; exit 2;;
  esac
done

export PATH="$ENV_PREFIX/bin:$PATH"
PY="$ENV_PREFIX/bin/python"
FC="$ENV_PREFIX/bin/gfortran"
[[ -x "$FC" ]] || { echo "gfortran not found in $ENV_PREFIX (create the env first, see README)"; exit 1; }

# Third-party sources are pinned to the commits Shoal was developed and tested against, so a fresh
# build reproduces the same model. To upgrade one, change its hash here and rebuild with --clean.
fetch() { # name url commit
  local name=$1 url=$2 rev=$3
  if [[ ! -d "$SRC/$name" ]]; then
    echo ">> fetching $name @ ${rev:0:7}"
    git init -q "$SRC/$name"
    git -C "$SRC/$name" remote add origin "$url"
    git -C "$SRC/$name" fetch -q --depth 1 origin "$rev"
    git -C "$SRC/$name" checkout -q FETCH_HEAD
    git -C "$SRC/$name" submodule update -q --init --recursive --depth 1
  else
    local have; have=$(git -C "$SRC/$name" rev-parse HEAD 2>/dev/null || echo "?")
    [[ "$have" == "$rev" ]] || echo "!! $name is at ${have:0:7}, Shoal is tested with ${rev:0:7} (delete $SRC/$name to refetch)"
  fi
}
mkdir -p "$SRC" "$BUILD" "$PREFIX/bin"
fetch gotm         https://github.com/gotm-model/code.git            771b3b5a36c10cbcf4fc3a5d5225d0f64a9c8159  # 2026-08-27
fetch fabm         https://github.com/fabm-model/fabm.git            4585bcf510ef862308147fa873beb4cf42f43341  # 2026-10-30
fetch ersem        https://github.com/pmlmodelling/ersem.git         ca71e5aae98477232c3510f3a4ffee496e83d62f  # 2026-10-29
fetch fabm-mizer   https://github.com/pmlmodelling/fabm-mizer.git    ed8b78a4ba6f4d6ca07a4028cee392bc8335fa93  # 2025-11-03
fetch gotm-cases   https://github.com/gotm-model/cases.git           caa8a1d67da4d0bfa7ad7e50b5a1b409c935b0aa  # 2026-03-18
fetch ersem-setups https://github.com/pmlmodelling/ersem-setups.git  545b4dadb6bdd2387374adcf995c8e0289948faa  # 2026-08-25

# E2E: prefer the official ECOSMO E2E v2.0 source if the user unpacked it into src/ecosmo-e2e
# (Zenodo 10.5281/zenodo.20413770); otherwise use the paper-equation implementation in kernel/e2e.
E2E_BASE="$HERE/e2e"
if [[ -f "$SRC/ecosmo-e2e/CMakeLists.txt" ]]; then
  E2E_BASE="$SRC/ecosmo-e2e"
  echo ">> using official ECOSMO E2E source at $E2E_BASE"
fi

EXTRA="ersem;mizer;e2e"
CMAKE_COMMON=(
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_Fortran_COMPILER="$FC"
  -DFABM_EXTRA_INSTITUTES="$EXTRA"
  -DFABM_ERSEM_BASE="$SRC/ersem"
  -DFABM_MIZER_BASE="$SRC/fabm-mizer"
  -DFABM_E2E_BASE="$E2E_BASE"
)

if [[ $CLEAN == 1 ]]; then rm -rf "$BUILD"; fi

if [[ -z "$ONLY" || "$ONLY" == gotm ]]; then
  echo ">> building GOTM"
  cmake -S "$SRC/gotm" -B "$BUILD/gotm" \
    -DFABM_BASE="$SRC/fabm" -DGOTM_USE_STIM=ON -DGOTM_USE_SEAGRASS=ON -DGOTM_USE_CVMIX=ON \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DNetCDF_CONFIG_EXECUTABLE="$ENV_PREFIX/bin/nf-config" \
    "${CMAKE_COMMON[@]}"
  cmake --build "$BUILD/gotm" --parallel
  cp "$BUILD/gotm/gotm" "$PREFIX/bin/gotm"
  echo ">> gotm installed at $PREFIX/bin/gotm"
fi

if [[ -z "$ONLY" || "$ONLY" == pyfabm ]]; then
  echo ">> building pyfabm"
  # pyfabm's setup.py forwards cmake options from setup.cfg [build_ext] cmake_opts
  CMAKE_OPTS="${CMAKE_COMMON[*]}"
  cat > "$SRC/fabm/setup.cfg" <<EOF
[build_ext]
cmake_opts=$CMAKE_OPTS
EOF
  "$PY" -m pip install --no-build-isolation --no-deps --force-reinstall "$SRC/fabm" -v > "$HERE/logs/pyfabm_build.log" 2>&1 \
    || { tail -40 "$HERE/logs/pyfabm_build.log"; exit 1; }
  rm -f "$SRC/fabm/setup.cfg"
  "$PY" -c "import pyfabm; print('pyfabm', pyfabm.__version__ if hasattr(pyfabm,'__version__') else '', pyfabm.__file__)"
fi

# Record what was built (the backend reads this to report kernel capabilities)
"$PY" - "$HERE" "$E2E_BASE" <<'PYEOF'
import json, subprocess, sys, pathlib, datetime
here = pathlib.Path(sys.argv[1]); e2e = sys.argv[2]
def rev(p):
    try:
        return subprocess.check_output(["git", "-C", str(p), "log", "-1", "--format=%h %cs"], text=True).strip()
    except Exception:
        return None
src = here / "src"
info = {
    "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "gotm": rev(src / "gotm"), "fabm": rev(src / "fabm"), "ersem": rev(src / "ersem"),
    "mizer": rev(src / "fabm-mizer"),
    "e2e": {"source": "official" if "ecosmo-e2e" in e2e else "paper-equations", "path": e2e},
    "institutes_extra": ["ersem", "mizer", "e2e"],
}
(here / "install" / "kernel.json").write_text(json.dumps(info, indent=2))
print(json.dumps(info, indent=2))
PYEOF
