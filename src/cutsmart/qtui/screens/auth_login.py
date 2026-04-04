from __future__ import annotations

from pathlib import Path
import random

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPainter, QPixmap
from PySide6.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from cutsmart.ui.style import ACCENT, ACCENT_HOVER, APP_BG, TEXT_MAIN, TEXT_MUTED


class LoginScreen(QWidget):
    def __init__(self, app, router, on_login, on_register):
        super().__init__()
        self.app = app
        self.router = router
        self._on_login = on_login
        self._on_register = on_register
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

        form = QVBoxLayout(card)
        form.setContentsMargins(52, 40, 52, 40)
        form.setSpacing(10)
        form.setAlignment(Qt.AlignmentFlag.AlignTop)

        title = QLabel("Welcome back")
        title.setStyleSheet(
            f"color: {TEXT_MAIN}; font-size: 34px; font-weight: 700;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        title.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        form.addWidget(title)

        subtitle = QLabel("Sign in to your company workspace.")
        subtitle.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: 14px;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        subtitle.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        form.addWidget(subtitle)
        form.addSpacing(16)

        self.email = QLineEdit()
        self.email.setPlaceholderText("Email")
        self.email.setMinimumHeight(46)
        self.email.setStyleSheet(self._entry_css())
        self.email.textChanged.connect(self._clear_inline_error)
        form.addWidget(self.email)

        self.password = QLineEdit()
        self.password.setPlaceholderText("Password")
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.password.setMinimumHeight(46)
        self.password.setStyleSheet(self._entry_css())
        self.password.returnPressed.connect(self._login)
        self.password.textChanged.connect(self._clear_inline_error)
        form.addWidget(self.password)
        self.inline_error = QLabel("")
        self.inline_error.setStyleSheet(
            "color: #D32F2F; font-size: 12px; background: transparent; border: none; padding: 0; margin: 0;"
        )
        self.inline_error.setWordWrap(True)
        self.inline_error.hide()
        form.addWidget(self.inline_error)

        self.remember_me = QCheckBox("Keep me logged in on this device")
        self.remember_me.setChecked(True)
        self.remember_me.setStyleSheet(
            "QCheckBox { font-size: 13px; color: #3C3C43; background: transparent; border: none; }"
            "QCheckBox::indicator { width: 16px; height: 16px; background: #FFFFFF; border: 1px solid #C9CED8; border-radius: 3px; }"
            "QCheckBox::indicator:checked { background: #5A8FD8; border: 1px solid #5A8FD8; }"
        )
        form.addWidget(self.remember_me)
        form.addSpacing(8)

        self.login_btn = QPushButton("Log in")
        self.login_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.login_btn.setMinimumHeight(48)
        self.login_btn.clicked.connect(self._login)
        self.login_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 14px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover {"
            f"background: {ACCENT_HOVER};"
            "}"
            "QPushButton:disabled { background: #9EC2FF; color: #F5F8FF; }"
        )
        form.addWidget(self.login_btn)

        register_btn = QPushButton("Create account")
        register_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        register_btn.setMinimumHeight(46)
        register_btn.clicked.connect(self._on_register)
        register_btn.setStyleSheet(
            "QPushButton {"
            f"background: #F2F2F7; color: {TEXT_MAIN}; border: none; border-radius: 14px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        form.addWidget(register_btn)
        prefill = str(getattr(self.router, "prefill_login_email", "") or "").strip()
        if prefill:
            self.email.setText(prefill)
            try:
                setattr(self.router, "prefill_login_email", "")
            except Exception:
                pass
        self._layout_background_icons()
        self._bg_overlay.lower()
        self._card.raise_()

    def _entry_css(self) -> str:
        return (
            "QLineEdit {"
            "background: white;"
            "border: 1px solid #E5E5EA;"
            "border-radius: 14px;"
            "padding: 0 14px;"
            "font-size: 14px;"
            "}"
            "QLineEdit:focus { border: 1px solid #7EB0FF; }"
        )

    def _login(self) -> None:
        self._clear_inline_error()
        self.login_btn.setEnabled(False)
        try:
            email = self.email.text().strip().lower()
            password = self.password.text()
            if not email:
                raise ValueError("The username or password is incorrect.")
            if not password:
                raise ValueError("The username or password is incorrect.")

            uid = self.app.auth.login(email, password)
            self.router.session.uid = uid
            self.router.session.email = email

            tokens = getattr(self.app.auth, "current_tokens", {}) or {}
            companies = self.app.company.list_user_companies(uid) if hasattr(self.app.company, "list_user_companies") else []
            saved = self.app.session.load_session() or {}
            last_company_id = saved.get("company_id")
            company_ids = [c.get("id") for c in companies if c.get("id")]
            company_id = last_company_id if last_company_id in company_ids else (company_ids[0] if company_ids else self.app.company.get_user_company_id(uid))
            self.router.session.company_id = company_id

            if self.remember_me.isChecked():
                self.app.session.save_session(
                    uid=uid,
                    email=email,
                    remember_me=True,
                    company_id=company_id,
                    id_token=tokens.get("idToken"),
                    refresh_token=tokens.get("refreshToken"),
                )
            else:
                self.app.session.clear_session()

            self._on_login()
        except Exception as exc:
            msg = self._normalize_login_error(str(exc))
            self._set_inline_error(msg)
        finally:
            self.login_btn.setEnabled(True)

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
            key = ("bg", w, h)
            cached = self._bg_render_cache.get(key)  # type: ignore[arg-type]
            if cached is None:
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
                self._bg_render_cache.clear()
                self._bg_render_cache[key] = canvas  # type: ignore[index]
                cached = canvas
            self._bg_overlay.setPixmap(cached)
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

    def _set_inline_error(self, text: str) -> None:
        self.inline_error.setText(str(text or "").strip())
        self.inline_error.setVisible(bool(self.inline_error.text()))

    def _clear_inline_error(self, *_args) -> None:
        self.inline_error.hide()
        self.inline_error.clear()

    def _normalize_login_error(self, raw: str) -> str:
        txt = (raw or "").strip()
        up = txt.upper()
        if "EMAIL_NOT_FOUND" in up or "NOT REGISTERED" in up:
            return "Invalid Email or Password"
        if "INVALID_PASSWORD" in up or "INVALID_LOGIN_CREDENTIALS" in up:
            return "Invalid Email or Password"
        if "INVALID EMAIL OR PASSWORD" in up or "INCORRECT" in up:
            return "Invalid Email or Password"
        if not txt:
            return "Invalid Email or Password"
        return txt
