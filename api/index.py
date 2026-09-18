import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from vercel_python.asgi import ASGI  # noqa: E402

from main import app  # noqa: E402

handler = ASGI(app)