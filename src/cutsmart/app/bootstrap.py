from __future__ import annotations
from dataclasses import dataclass
import os
from pathlib import Path
import sys
from typing import Callable

from cutsmart.app.firebase_backend import (
    FirebaseAuthService,
    FirebaseClient,
    FirebaseCompanyService,
    FirebaseOfflinePatchQueueService,
    FirebaseRealtimeService,
    FirebaseSessionService,
)


@dataclass
class AppConfig:
    app_name: str = "Cutsmart"
    data_dir: Path | None = None


class AppContainer:
    def __init__(self, config: AppConfig | None = None, progress_cb: Callable[[int, str], None] | None = None):
        self.config = config or AppConfig()
        def _emit(percent: int, status: str) -> None:
            if callable(progress_cb):
                try:
                    progress_cb(int(percent), str(status or ""))
                except Exception:
                    pass
        if bool(getattr(sys, "frozen", False)):
            project_root = Path(sys.executable).resolve().parent
        else:
            project_root = Path(__file__).resolve().parents[3]
        _emit(2, "Preparing local data...")
        if self.config.data_dir is None:
            # Installed/frozen builds must write to a user-writable folder,
            # not Program Files/_internal.
            if bool(getattr(sys, "frozen", False)):
                local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
                base_dir = Path(local_appdata) if local_appdata else (Path.home() / "AppData" / "Local")
                self.config.data_dir = base_dir / "CutSmart" / "local_data"
            else:
                self.config.data_dir = Path(__file__).resolve().parents[1] / "local_data"
        self.config.data_dir.mkdir(parents=True, exist_ok=True)
        _emit(8, "Loading session...")
        self.session = FirebaseSessionService(self.config.data_dir)
        self.offline_patch_queue = FirebaseOfflinePatchQueueService(self.config.data_dir)
        _emit(14, "Starting Firebase...")
        def _firebase_progress(relative_percent: int, status: str) -> None:
            clamped = max(0, min(100, int(relative_percent)))
            mapped = 14 + int(clamped * 0.56)
            _emit(mapped, status)
        self.firebase = FirebaseClient(project_root, progress_cb=_firebase_progress)
        _emit(72, "Loading company services...")
        self.company = FirebaseCompanyService(self.firebase)
        _emit(80, "Loading authentication...")
        self.auth = FirebaseAuthService(self.firebase, self.company)
        _emit(86, "Starting live sync...")
        self.realtime = FirebaseRealtimeService(self.company)
        _emit(90, "Finalizing startup...")
