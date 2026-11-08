"""Entry point of the packaged Shoal app (PyInstaller). See backend/shoal/desktop/app.py."""
import multiprocessing
import sys

from shoal.desktop.app import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(main())
