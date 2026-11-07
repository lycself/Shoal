"""netCDF4/HDF5 is not thread-safe: every NetCDF access goes through this lock."""
import functools
import threading

NC_LOCK = threading.RLock()


def locked(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        with NC_LOCK:
            return fn(*a, **kw)
    return wrapper
