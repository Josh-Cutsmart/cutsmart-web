import os
from pathlib import Path
import sys
import traceback
import faulthandler
import random
import json
import tempfile
import subprocess
from time import monotonic
from urllib.parse import urlparse
from urllib.error import URLError
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor, QFont, QPainter, QPainterPath, QPixmap
from PySide6.QtWidgets import QApplication, QMessageBox, QSplashScreen
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def _resource_roots() -> list[Path]:
    roots: list[Path] = [ROOT]
    if bool(getattr(sys, "frozen", False)):
        meipass = str(getattr(sys, "_MEIPASS", "") or "").strip()
        if meipass:
            roots.append(Path(meipass))
        try:
            exe_dir = Path(sys.executable).resolve().parent
            roots.append(exe_dir)
            roots.append(exe_dir / "_internal")
        except Exception:
            pass
    seen: set[str] = set()
    out: list[Path] = []
    for item in roots:
        key = str(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _find_resource_path(*relative_candidates: str) -> Path:
    for base in _resource_roots():
        for rel in relative_candidates:
            cand = base / rel
            if cand.exists():
                return cand
    return _resource_roots()[0] / relative_candidates[0]

# Windows/WebEngine compatibility: avoid DirectComposition warnings/crashes
# on older GPU drivers by disabling Chromium direct composition.
flags = str(os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS") or "").strip()
if "--disable-direct-composition" not in flags:
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (flags + " --disable-direct-composition").strip()

from cutsmart.app.bootstrap import AppContainer
from cutsmart.qtui.app_window import run_qt


def _install_crash_logging() -> None:
    log_path = ROOT / "cutsmart_crash.log"
    try:
        fh = log_path.open("a", encoding="utf-8")
        faulthandler.enable(fh, all_threads=True)
    except Exception:
        pass

    def _log_exception(exc_type, exc_value, exc_tb):
        try:
            with log_path.open("a", encoding="utf-8") as f:
                f.write("\n" + "=" * 80 + "\n")
                f.write("Unhandled exception\n")
                f.write("".join(traceback.format_exception(exc_type, exc_value, exc_tb)))
        except Exception:
            pass
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    sys.excepthook = _log_exception


def _tint_pixmap(pixmap: QPixmap, color: QColor) -> QPixmap:
    out = QPixmap(pixmap.size())
    out.fill(Qt.GlobalColor.transparent)
    p = QPainter(out)
    p.drawPixmap(0, 0, pixmap)
    p.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
    p.fillRect(out.rect(), color)
    p.end()
    return out


def _draw_login_icon_effect(painter: QPainter, w: int, h: int) -> None:
    login_dir = _find_resource_path(
        "src/cutsmart/qtui/assets/login",
        "cutsmart/qtui/assets/login",
    )
    if not login_dir.exists():
        return
    files = [p for p in login_dir.iterdir() if p.suffix.lower() in {".png", ".svg", ".jpg", ".jpeg", ".webp"}]
    if not files:
        return
    icons: list[QPixmap] = []
    for path in files:
        pm = QPixmap(str(path))
        if pm.isNull():
            continue
        icons.append(_tint_pixmap(pm, QColor("#B3BAC7")))
    if not icons:
        return
    rng = random.Random(2612 + w * 17 + h * 31)
    painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
    painter.setOpacity(0.45)
    margin = 14
    clear_radius_px = 18
    placed: list[tuple[float, float, float]] = []
    for _ in range(90):
        idx = rng.randint(0, len(icons) - 1)
        size = rng.randint(14, 30)
        icon = icons[idx].scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        min_x = margin
        max_x = max(margin, w - margin - size)
        min_y = margin
        max_y = max(margin, h - margin - size)
        found = None
        for _try in range(220):
            px = rng.uniform(0.03, 0.97)
            py = rng.uniform(0.03, 0.97)
            x = int(px * w - size / 2)
            y = int(py * h - size / 2)
            x = max(min_x, min(x, max_x))
            y = max(min_y, min(y, max_y))
            cx = x + size / 2.0
            cy = y + size / 2.0
            r = size / 2.0
            ok = True
            for ox, oy, orad in placed:
                min_dist = r + orad + (clear_radius_px * 2.0)
                dx = cx - ox
                dy = cy - oy
                if (dx * dx + dy * dy) < (min_dist * min_dist):
                    ok = False
                    break
            if ok:
                found = (x, y, cx, cy, r)
                break
        if found is None:
            continue
        x, y, cx, cy, r = found
        placed.append((cx, cy, r))
        painter.drawPixmap(x, y, icon)
    painter.setOpacity(1.0)


def _human_bytes(num: float | int) -> str:
    try:
        n = float(num)
    except Exception:
        n = 0.0
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while n >= 1024.0 and idx < len(units) - 1:
        n /= 1024.0
        idx += 1
    if idx == 0:
        return f"{int(n)} {units[idx]}"
    return f"{n:.1f} {units[idx]}"


def _version_tuple(value: str) -> tuple[int, ...]:
    parts = []
    for token in str(value or "").strip().split("."):
        tok = token.strip()
        if not tok:
            continue
        num_txt = ""
        for ch in tok:
            if ch.isdigit():
                num_txt += ch
            else:
                break
        if num_txt:
            parts.append(int(num_txt))
        else:
            parts.append(0)
    return tuple(parts or [0])


def _is_newer_version(candidate: str, current: str) -> bool:
    c = list(_version_tuple(candidate))
    cur = list(_version_tuple(current))
    while len(c) < len(cur):
        c.append(0)
    while len(cur) < len(c):
        cur.append(0)
    return tuple(c) > tuple(cur)


def _current_app_version() -> str:
    env_ver = str(os.environ.get("CUTSMART_APP_VERSION") or "").strip()
    if env_ver:
        return env_ver
    return "0.0.0"


def _fetch_update_manifest(url: str, timeout_s: float = 3.0) -> dict | None:
    link = str(url or "").strip()
    if not link:
        return None
    try:
        req = Request(link, headers={"User-Agent": "Cutsmart-Updater/1.0"})
        with urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read()
        data = json.loads(raw.decode("utf-8", errors="ignore"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


class StartupSplash(QSplashScreen):
    def __init__(self, pixmap: QPixmap):
        super().__init__(pixmap)
        self._progress = 0
        self._progress_display = 0.0
        self._progress_target = 0.0
        self._status = "Loading workspace..."
        self._detail = ""
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
        self.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self._progress_timer = QTimer(self)
        self._progress_timer.setInterval(16)
        self._progress_timer.timeout.connect(self._step_progress_animation)

    def set_progress(self, percent: int, status: str = "", detail: str = "", hold_ms: int = 160) -> None:
        next_target = float(max(0, min(100, int(percent))))
        if next_target < self._progress_target:
            next_target = self._progress_target
        self._progress_target = next_target
        if status:
            self._status = str(status)
        self._detail = str(detail or "")
        if not self._progress_timer.isActive():
            self._progress_timer.start()
        self.show()
        self.repaint()
        app = QApplication.instance()
        if app is not None:
            app.processEvents()
        # Startup work can block the normal event loop; force a short in-place
        # animation pass so progress still advances smoothly per update.
        self.wait_for_progress_complete(max(0, int(hold_ms)))

    def _step_progress_animation(self) -> None:
        delta = self._progress_target - self._progress_display
        if abs(delta) <= 0.15:
            self._progress_display = self._progress_target
            self._progress = int(round(self._progress_display))
            self.update()
            self._progress_timer.stop()
            return
        step = max(0.45, abs(delta) * 0.18)
        if delta > 0:
            self._progress_display = min(self._progress_target, self._progress_display + step)
        else:
            self._progress_display = max(self._progress_target, self._progress_display - step)
        self._progress = int(round(self._progress_display))
        self.update()

    def wait_for_progress_complete(self, timeout_ms: int = 700) -> None:
        app = QApplication.instance()
        if app is None:
            return
        end_ts = monotonic() + (max(0, int(timeout_ms)) / 1000.0)
        while self._progress_display + 0.1 < self._progress_target and monotonic() < end_ts:
            app.processEvents()

    def set_update_progress(self, downloaded_bytes: int, total_bytes: int, status: str = "Downloading update...") -> None:
        total = max(0, int(total_bytes or 0))
        done = max(0, int(downloaded_bytes or 0))
        pct = int(round((done / total) * 100.0)) if total > 0 else 0
        detail = f"{_human_bytes(done)}/{_human_bytes(total)}" if total > 0 else _human_bytes(done)
        self.set_progress(pct, status=status, detail=detail, hold_ms=28)

    def drawContents(self, painter: QPainter) -> None:
        r = self.rect()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        title_font = QFont("Segoe UI", 28, QFont.Weight.Bold)
        body_font = QFont("Segoe UI", 11, QFont.Weight.Medium)
        small_font = QFont("Segoe UI", 10, QFont.Weight.Medium)

        painter.setPen(QColor("#0F2A4A"))
        painter.setFont(title_font)
        painter.drawText(32, 102, "CutSmart")

        painter.setPen(QColor("#5B6472"))
        painter.setFont(body_font)
        painter.drawText(34, 142, str(self._status or "Loading workspace..."))

        bar_x = 34
        bar_y = 154
        bar_w = r.width() - 68
        bar_h = 10

        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor("#DFE5EE"))
        painter.drawRoundedRect(bar_x, bar_y, bar_w, bar_h, 5, 5)

        fill_w = int(round((self._progress / 100.0) * bar_w))
        painter.setBrush(QColor("#5A8FD8"))
        painter.drawRoundedRect(bar_x, bar_y, fill_w, bar_h, 5, 5)

        painter.setPen(QColor("#44556D"))
        painter.setFont(small_font)
        painter.drawText(bar_x, bar_y + 24, f"{self._progress}%")
        if self._detail:
            painter.setPen(QColor("#6B778A"))
            fm = QFontMetrics(small_font)
            detail_w = fm.horizontalAdvance(self._detail)
            detail_x = max(bar_x + 60, bar_x + bar_w - detail_w)
            painter.drawText(detail_x, bar_y + 24, self._detail)


def _show_startup_splash(app: QApplication) -> StartupSplash:
    splash_scale = 0.80
    splash_bg = _find_resource_path(
        "src/cutsmart/qtui/assets/splash/loading_bg.png",
        "cutsmart/qtui/assets/splash/loading_bg.png",
    )
    bg = QPixmap(str(splash_bg))
    bg_draw = QPixmap()
    if not bg.isNull():
        bg_draw = bg
        try:
            screen = app.primaryScreen()
            if screen is not None:
                avail = screen.availableGeometry()
                max_w = max(420, int(avail.width() * 0.70))
                max_h = max(260, int(avail.height() * 0.70))
                if bg_draw.width() > max_w or bg_draw.height() > max_h:
                    bg_draw = bg_draw.scaled(
                        max_w,
                        max_h,
                        Qt.AspectRatioMode.KeepAspectRatio,
                        Qt.TransformationMode.SmoothTransformation,
                    )
        except Exception:
            pass
        if not bg_draw.isNull():
            scaled_w = max(320, int(round(bg_draw.width() * splash_scale)))
            scaled_h = max(180, int(round(bg_draw.height() * splash_scale)))
            bg_draw = bg_draw.scaled(
                scaled_w,
                scaled_h,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )

    if not bg_draw.isNull():
        pix = QPixmap(bg_draw.size())
    else:
        pix = QPixmap(max(320, int(round(520 * splash_scale))), max(180, int(round(270 * splash_scale))))
    pix.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pix)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    radius = 18
    painter.setPen(Qt.PenStyle.NoPen)
    painter.setBrush(QColor("#F5F6F8"))
    rounded = QPainterPath()
    rounded.addRoundedRect(float(pix.rect().x()), float(pix.rect().y()), float(pix.width()), float(pix.height()), float(radius), float(radius))
    painter.drawPath(rounded)
    painter.save()
    painter.setClipPath(rounded)
    if not bg_draw.isNull():
        painter.drawPixmap(0, 0, bg_draw)
    else:
        _draw_login_icon_effect(painter, pix.width(), pix.height())
    painter.restore()
    painter.end()
    splash = StartupSplash(pix)
    splash.set_progress(0, "Loading workspace...")
    splash.show()
    app.processEvents()
    return splash


def _show_update_prompt(splash: StartupSplash, version: str) -> bool:
    msg = QMessageBox(splash)
    msg.setWindowTitle("Update Available")
    msg.setIcon(QMessageBox.Icon.Information)
    msg.setText(f"Update Available ({version})")
    msg.setInformativeText("Would you like to update now?")
    now_btn = msg.addButton("Update Now", QMessageBox.ButtonRole.AcceptRole)
    later_btn = msg.addButton("Update Later", QMessageBox.ButtonRole.RejectRole)
    msg.setDefaultButton(now_btn)
    msg.exec()
    return msg.clickedButton() is now_btn and msg.clickedButton() is not later_btn


def _download_and_launch_update(splash: StartupSplash, manifest: dict) -> bool:
    download_url = str(manifest.get("installerUrl") or manifest.get("url") or "").strip()
    if not download_url:
        return False
    total_hint = int(manifest.get("sizeBytes") or 0)
    parsed = urlparse(download_url)
    suffix = Path(parsed.path).suffix or ".exe"
    fd, tmp_path = tempfile.mkstemp(prefix="cutsmart_update_", suffix=suffix)
    os.close(fd)
    downloaded = 0
    try:
        req = Request(download_url, headers={"User-Agent": "Cutsmart-Updater/1.0"})
        with urlopen(req, timeout=25) as resp, open(tmp_path, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            if total <= 0:
                total = total_hint
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                splash.set_update_progress(downloaded, total, status="Updating: downloading...")
        splash.set_progress(100, "Updating: installing...", detail=f"Downloaded {_human_bytes(downloaded)}")
        if os.name == "nt":
            os.startfile(tmp_path)  # type: ignore[attr-defined]
        else:
            subprocess.Popen([tmp_path])
        return True
    except (OSError, URLError, TimeoutError):
        return False
    except Exception:
        return False


if __name__ == "__main__":
    _install_crash_logging()
    qt_app = QApplication.instance() or QApplication(sys.argv)
    splash = _show_startup_splash(qt_app)
    update_manifest_url = str(os.environ.get("CUTSMART_UPDATE_MANIFEST_URL") or "").strip()
    if update_manifest_url:
        splash.set_progress(4, "Checking for updates...")
        manifest = _fetch_update_manifest(update_manifest_url, timeout_s=3.5)
        if isinstance(manifest, dict):
            next_version = str(manifest.get("version") or "").strip()
            if next_version and _is_newer_version(next_version, _current_app_version()):
                if _show_update_prompt(splash, next_version):
                    ok = _download_and_launch_update(splash, manifest)
                    if ok:
                        raise SystemExit(0)
                    QMessageBox.warning(splash, "Update failed", "Could not download/install update. Opening current version.")
    splash.set_progress(8, "Preparing services...")
    app = AppContainer(progress_cb=lambda p, s: splash.set_progress(p, s))
    try:
        splash.set_progress(96, "Launching...")
        raise SystemExit(run_qt(app, splash=splash))
    except Exception:
        try:
            splash.close()
        except Exception:
            pass
        try:
            with (ROOT / "cutsmart_crash.log").open("a", encoding="utf-8") as f:
                f.write("\n" + "=" * 80 + "\n")
                f.write("Fatal startup exception\n")
                f.write(traceback.format_exc())
        except Exception:
            pass
        raise
