"""Shoal backend package."""
import os as _os

if _os.name == "nt":  # pragma: no cover - Windows only
    # pyfabm is a MinGW-built DLL; Python does not search PATH for the DLLs it depends on (libgfortran, ...).
    from .config import runtime_dll_dirs as _dll_dirs

    for _d in _dll_dirs():
        _os.add_dll_directory(_d)
