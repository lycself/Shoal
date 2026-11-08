# ECOSMO E2E v2.0 (vendored, unmodified)

This folder contains part of the official ECOSMO E2E v2.0 release, redistributed unmodified under its license
so that every Shoal build (including the release installers) can compile it:

- **Work**: ECOSMO E2E v2.0: Generic modules of higher-trophic-level fish and macrobenthos functional groups
  compatible for two-way coupling to lower-trophic-level model hosts through FABM coupler [Dataset and source code]
- **Authors**: Vijith Vijayakumaran, Ute Daewel and co-authors (Helmholtz-Zentrum Hereon); the modularisation was
  funded by the NECCTON project (Horizon Europe, grant 101081273). Paper: Vijayakumaran et al. (2026),
  EGUsphere egusphere-2026-3078.
- **Source**: Zenodo, <https://doi.org/10.5281/zenodo.20413770> (version v1, published 2026-05-27),
  archive `ecosmoe2e_gmd.zip`.
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/>, as stated on the Zenodo record.

## What is here

Copied byte for byte from the archive: `README.md`, `testcases/`, and from `src/` the files the build uses
(`CMakeLists.txt`, `ecosmoe2e_model_library.F90`, `ecosmofish.F90`, `ecosmomb.F90`).
Left out: `forcing/` (48 MB of driving data), `model_output/` (5.9 GB of reference results), `ibt_survey/` and the
editor backup `src/ecosmomb.F90_bkp`. Download the full archive for those (see the Shoal README, section
"ECOSMO E2E 官方代码", for re-running the validation).

SHA-256 of the files as published:

```
b03ddd24a2e784844bedc4c186a1b42ddfddc975eee1a03cad55fac24adad800  README.md
1f64bbeb4a0786ed66a8c2764a80bb053770380725bbdfbdf14fa8fc5b689dd8  src/CMakeLists.txt
f9afbeed2cdc5c82bff3f8c607fc295f69ec4e62ea8fad4606c677d54532522b  src/ecosmoe2e_model_library.F90
3701e6fd0d864a30d300d9625e6c33fcbbfd2c9f3545dd8d9cbdd5fca73d2e87  src/ecosmofish.F90
2b0315dad9ae495058b930802479f572be2334179702c21e5691d591ece1a9c8  src/ecosmomb.F90
df76fa8aa291fd57b5dbc10f7dbc7f88f974a84578126b11dfad6f8aca671447  testcases/fabm.yaml_ecosmo
2644b9621a6e71d2429451ebe57957639af93537569893ab3c423f451248fe28  testcases/fabm.yaml_ergom
51d4ecbb99003dc29e545910f385ad2e915ab1496b661786f15dea7607eb7804  testcases/fabm.yaml_ersem
8521b7d2ad8c75d8cf9b34a4d0fe10b30bce505c705fe78258f191da5d349d77  testcases/gotm.yaml_ecosmo
8fe0604bfbf8dd08bae23191d0b61189c4abdcc3bc5534fa38859597b476dd2e  testcases/gotm.yaml_ergom
5310e7cdab16a471ae46d7a3f905d7d4702be56d02d8c4af0b8596debf28ee73  testcases/gotm.yaml_ersem
```

## Changes made by Shoal

None to these files. Shoal's optional corrections (mass and sign fixes, all off by default) are a separate patch,
`kernel/patches/ecosmo-e2e-corrections.patch`, which `kernel/build.py` applies to a copy in `kernel/build/` at
compile time; see `kernel/patches/README.md`. With every correction switched off the compiled code follows the
published code path.
