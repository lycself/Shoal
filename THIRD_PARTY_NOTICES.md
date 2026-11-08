# Third-party components

Shoal itself is licensed under the GNU General Public License, version 3 or (at your option) any later
version (`LICENSE`). The installers and a source build also contain the components below, each under its own
license. Sources of the kernel components are fetched at the pinned commits listed in `kernel/build.py`.

## Computational kernel (compiled into `gotm` and `pyfabm`)

| Component | Source | License |
| --- | --- | --- |
| GOTM | https://github.com/gotm-model/code | GNU GPL (COPYING: version 2) |
| FABM, pyfabm | https://github.com/fabm-model/fabm | GNU GPL (COPYING: version 2) |
| ERSEM | https://github.com/PlymouthMarineLaboratory/ersem | GNU GPL version 3 |
| FABM-MIZER | https://github.com/PlymouthMarineLaboratory/fabm-mizer | no license is stated in the upstream repository (checked 2026-11-08) |
| ECOSMO E2E v2.0 | https://doi.org/10.5281/zenodo.20413770, vendored in `kernel/vendor/ecosmo-e2e` | CC BY 4.0 (see its `NOTICE.md`) |
| E2E re-implementation | `kernel/e2e` (part of Shoal) | GNU GPL version 3 or later |

## Native libraries bundled with the installers

| Library | License |
| --- | --- |
| NetCDF-C, NetCDF-Fortran (Unidata/UCAR) | BSD-3-Clause-style (NetCDF license) |
| HDF5 (The HDF Group) | BSD-3-Clause-style (HDF5 license) |
| libaec / libsz, zstd, zlib | BSD-2-Clause, BSD-3-Clause, zlib |
| GCC runtime (libgfortran, libquadmath, libgcc) | GNU GPL version 3 with the GCC Runtime Library Exception |

## Python runtime and packages bundled with the installers

| Package | License |
| --- | --- |
| CPython 3.11 | PSF License |
| NumPy, pandas, uvicorn, starlette, httpx, psutil, websockets | BSD-3-Clause |
| xarray, openai | Apache-2.0 |
| netCDF4, cftime, FastAPI, pydantic, ruamel.yaml, PyYAML | MIT |
| Pillow | MIT-CMU (HPND) |
| pystray | GNU LGPL version 3 |
| PyInstaller bootloader | GNU GPL version 2 with the PyInstaller bootloader exception |

Exact versions are listed in `backend/requirements.txt` and `packaging/requirements.txt`.

## Data used at run time (downloaded by the app, not bundled)

ERA5 (Copernicus Climate Change Service, via Open-Meteo), World Ocean Atlas 2023 (NOAA NCEI), ETOPO 2022 (NOAA).
The offline demo uses the GOTM `nns_annual` test case from https://github.com/gotm-model/cases (GNU GPL).
