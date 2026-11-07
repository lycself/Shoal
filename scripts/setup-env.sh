#!/usr/bin/env bash
# Create the "coastal" conda environment (compilers, NetCDF, Python packages) used by the kernel build and backend.
set -euo pipefail
PREFIX="${COASTAL_ENV:-$HOME/opt/anaconda3/envs/coastal}"
CHANNEL="${CONDA_CHANNEL:-conda-forge}"
if command -v micromamba >/dev/null; then TOOL=micromamba; elif command -v mamba >/dev/null; then TOOL=mamba; else TOOL=conda; fi
echo ">> creating $PREFIX with $TOOL (channel $CHANNEL)"
$TOOL create -y -p "$PREFIX" --override-channels -c "$CHANNEL" \
  python=3.11 cmake make fortran-compiler c-compiler cxx-compiler netcdf-fortran netcdf4 \
  numpy scipy xarray pyyaml fastapi uvicorn websockets psutil httpx pandas git pip
"$PREFIX/bin/python" -m pip install ruamel.yaml openai
echo ">> done. Next: bash kernel/build.sh   (builds GOTM + pyfabm with ERSEM, MIZER, E2E)"
