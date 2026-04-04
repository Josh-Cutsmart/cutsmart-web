from __future__ import annotations

from pathlib import Path
import random

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPainter, QPixmap
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from cutsmart.ui.style import ACCENT, ACCENT_HOVER, APP_BG, TEXT_MAIN, TEXT_MUTED


class SplashScreen(QWidget):
    def __init__(self, on_continue):
        super().__init__()
        self._on_continue = on_continue
        self._build_ui()

    def _build_ui(self) -> None:
        self.setStyleSheet(f"background: {APP_BG};")
        self._bg_icon_rng = random.Random(2612)
        self._bg_icons: list[QPixmap] = []
        self._bg_image: QPixmap | None = None
        self._bg_scaled_cache: dict[tuple[int, int], QPixmap] = {}
        self._bg_slots: list[tuple[int, float, float, int]] = []
        self._bg_render_cache: dict[tuple[int, int], QPixmap] = {}
        self._bg_overlay = QLabel(self)
        self._bg_overlay.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self._bg_overlay.lower()
        self._init_background_icons()

        root = QVBoxLayout(self)
        root.setContentsMargins(32, 32, 32, 32)

        shell = QHBoxLayout()
        shell.setAlignment(Qt.AlignmentFlag.AlignCenter)
        root.addLayout(shell)

        card = QFrame()
        card.setFixedSize(620, 520)
        card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #ECECF0;"
            "border-radius: 28px;"
            "}"
        )
        shell.addWidget(card)
        self._card = card

        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(44, 44, 44, 44)
        card_layout.setSpacing(14)
        card_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        title = QLabel("Cutsmart")
        title.setStyleSheet(
            f"color: {TEXT_MAIN}; font-size: 44px; font-weight: 700;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        card_layout.addWidget(title, alignment=Qt.AlignmentFlag.AlignHCenter)

        subtitle = QLabel("Simple, fast, live collaboration for your company.")
        subtitle.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: 14px;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        card_layout.addWidget(subtitle, alignment=Qt.AlignmentFlag.AlignHCenter)

        card_layout.addSpacing(8)

        continue_button = QPushButton("Continue")
        continue_button.setCursor(Qt.CursorShape.PointingHandCursor)
        continue_button.setFixedSize(230, 48)
        continue_button.clicked.connect(self._on_continue)
        continue_button.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 14px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover {"
            f"background: {ACCENT_HOVER};"
            "}"
        )
        card_layout.addWidget(continue_button, alignment=Qt.AlignmentFlag.AlignHCenter)

        card_layout.addSpacing(12)

        footer = QLabel("Realtime jobs, staff, notifications, and company settings.")
        footer.setStyleSheet(
            "color: #8E8E93; font-size: 12px;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        card_layout.addWidget(footer, alignment=Qt.AlignmentFlag.AlignHCenter)
        self._layout_background_icons()
        self._bg_overlay.lower()
        self._card.raise_()

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._layout_background_icons()
        self._bg_overlay.lower()
        if hasattr(self, "_card"):
            self._card.raise_()

    def _init_background_icons(self) -> None:
        base = Path(__file__).resolve()
        roots = [
            base.parents[1] / "assets" / "login",
            base.parents[2] / "assets" / "login",
            base.parents[4] / "assets" / "login",
        ]
        login_dir = next((p for p in roots if p.exists() and p.is_dir()), None)
        if not login_dir:
            return
        bg_path = login_dir / "bg.png"
        if bg_path.exists():
            bg = QPixmap(str(bg_path))
            if not bg.isNull():
                self._bg_image = bg
                return
        files = [p for p in login_dir.iterdir() if p.suffix.lower() in {".png", ".svg", ".jpg", ".jpeg", ".webp"}]
        if not files:
            return
        for path in files:
            pm = QPixmap(str(path))
            if pm.isNull():
                continue
            self._bg_icons.append(self._tint_pixmap(pm, QColor("#B3BAC7")))
        if not self._bg_icons:
            return
        self._bg_slots = []
        for _ in range(120):
            idx = self._bg_icon_rng.randint(0, len(self._bg_icons) - 1)
            nx = self._bg_icon_rng.uniform(0.03, 0.97)
            ny = self._bg_icon_rng.uniform(0.03, 0.97)
            size = self._bg_icon_rng.randint(16, 34)
            self._bg_slots.append((idx, nx, ny, size))

    def _layout_background_icons(self) -> None:
        w = max(1, self.width())
        h = max(1, self.height())
        self._bg_overlay.setGeometry(0, 0, w, h)
        if isinstance(self._bg_image, QPixmap) and not self._bg_image.isNull():
            scaled = self._bg_image.scaled(
                w,
                h,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            sx = (w - scaled.width()) // 2
            sy = (h - scaled.height()) // 2
            canvas = QPixmap(w, h)
            canvas.fill(Qt.GlobalColor.transparent)
            painter = QPainter(canvas)
            painter.drawPixmap(sx, sy, scaled)
            painter.end()
            self._bg_overlay.setPixmap(canvas)
            return
        if not getattr(self, "_bg_icons", None):
            self._bg_overlay.clear()
            return
        key = (w, h)
        cached = self._bg_render_cache.get(key)
        if cached is None:
            canvas = QPixmap(w, h)
            canvas.fill(Qt.GlobalColor.transparent)
            painter = QPainter(canvas)
            painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
            painter.setOpacity(0.50)
            margin = 12
            clear_radius_px = 20
            placed: list[tuple[float, float, float]] = []
            rng = random.Random(2612 + w * 17 + h * 31)
            for idx, nx, ny, size in self._bg_slots:
                icon = self._scaled_icon(idx, size)
                min_x = margin
                max_x = max(margin, w - margin - size)
                min_y = margin
                max_y = max(margin, h - margin - size)
                found = None
                for _ in range(320):
                    if _ < 120:
                        px = nx + rng.uniform(-0.12, 0.12)
                        py = ny + rng.uniform(-0.12, 0.12)
                    else:
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
            painter.end()
            self._bg_render_cache[key] = canvas
            if len(self._bg_render_cache) > 6:
                self._bg_render_cache.clear()
                self._bg_render_cache[key] = canvas
            cached = canvas
        self._bg_overlay.setPixmap(cached)

    def _scaled_icon(self, idx: int, size: int) -> QPixmap:
        key = (idx, size)
        pm = self._bg_scaled_cache.get(key)
        if pm is not None:
            return pm
        base = self._bg_icons[idx]
        pm = base.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
        self._bg_scaled_cache[key] = pm
        return pm

    def _tint_pixmap(self, pixmap: QPixmap, color: QColor) -> QPixmap:
        out = QPixmap(pixmap.size())
        out.fill(Qt.GlobalColor.transparent)
        p = QPainter(out)
        p.drawPixmap(0, 0, pixmap)
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
        p.fillRect(out.rect(), color)
        p.end()
        return out
