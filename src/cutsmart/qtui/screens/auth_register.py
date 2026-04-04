from __future__ import annotations

from pathlib import Path
import random

from PySide6.QtCore import Qt, QRectF, QSize
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPixmap
from PySide6.QtWidgets import (
    QDialog,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from cutsmart.qtui.screens.dashboard_widgets import AvatarCropDialog
from cutsmart.ui.style import ACCENT, ACCENT_HOVER, APP_BG, TEXT_MAIN, TEXT_MUTED


class RegisterScreen(QWidget):
    def __init__(self, app, router, on_register_done, on_back):
        super().__init__()
        self.app = app
        self.router = router
        self._on_register_done = on_register_done
        self._on_back = on_back
        self._photo_pending_path = ""
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

        title = QLabel("Create Account")
        title.setStyleSheet(
            f"color: {TEXT_MAIN}; font-size: 34px; font-weight: 700;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        title.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        form.addWidget(title)

        subtitle = QLabel("Set up your login details.")
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

        self.mobile = QLineEdit()
        self.mobile.setPlaceholderText("Mobile")
        self.mobile.setMinimumHeight(46)
        self.mobile.setStyleSheet(self._entry_css())
        self.mobile.textChanged.connect(self._clear_inline_error)
        self.mobile.textChanged.connect(self._on_mobile_changed)
        form.addWidget(self.mobile)

        photo_row = QHBoxLayout()
        photo_row.setSpacing(8)
        self.photo_preview = QLabel()
        self.photo_preview.setFixedSize(40, 40)
        self.photo_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.photo_preview.setStyleSheet(
            "QLabel { background: #E5E7EB; color: #6B7280; border: 1px solid #D1D5DB; border-radius: 20px; font-size: 11px; font-weight: 700; }"
        )
        self.photo_preview.setText("Photo")
        photo_row.addWidget(self.photo_preview)
        self.photo_input = QLineEdit()
        self.photo_input.setReadOnly(True)
        self.photo_input.setPlaceholderText("Add profile photo (optional)")
        self.photo_input.setMinimumHeight(46)
        self.photo_input.setStyleSheet(self._entry_css())
        photo_row.addWidget(self.photo_input, stretch=1)
        self.photo_browse_btn = QPushButton("Browse")
        self.photo_browse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.photo_browse_btn.setMinimumHeight(46)
        self.photo_browse_btn.clicked.connect(self._pick_profile_photo)
        self.photo_browse_btn.setStyleSheet(
            "QPushButton {"
            "background: #F2F2F7; color: #2D3748; border: none; border-radius: 14px;"
            "font-size: 13px; font-weight: 700; padding: 0 14px;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        photo_row.addWidget(self.photo_browse_btn)
        form.addLayout(photo_row)

        self.password = QLineEdit()
        self.password.setPlaceholderText("Password")
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.password.setMinimumHeight(46)
        self.password.setStyleSheet(self._entry_css())
        self.password.textChanged.connect(self._clear_inline_error)
        form.addWidget(self.password)

        self.confirm_password = QLineEdit()
        self.confirm_password.setPlaceholderText("Confirm password")
        self.confirm_password.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password.setMinimumHeight(46)
        self.confirm_password.setStyleSheet(self._entry_css())
        self.confirm_password.returnPressed.connect(self._register)
        self.confirm_password.textChanged.connect(self._clear_inline_error)
        form.addWidget(self.confirm_password)
        self.inline_error = QLabel("")
        self.inline_error.setStyleSheet(
            "color: #D32F2F; font-size: 12px; background: transparent; border: none; padding: 0; margin: 0;"
        )
        self.inline_error.setWordWrap(True)
        self.inline_error.hide()
        form.addWidget(self.inline_error)
        self.login_existing_btn = QPushButton("Go to Log In")
        self.login_existing_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.login_existing_btn.setMinimumHeight(34)
        self.login_existing_btn.setStyleSheet(
            "QPushButton {"
            f"background: transparent; color: {TEXT_MAIN}; border: none; border-radius: 0px;"
            "font-size: 12px; font-weight: 700; padding: 4px 10px;"
            "}"
            "QPushButton:hover { background: transparent; text-decoration: underline; }"
        )
        self.login_existing_btn.clicked.connect(self._go_to_login_with_email)
        self.login_existing_btn.hide()
        form.addWidget(self.login_existing_btn, alignment=Qt.AlignmentFlag.AlignLeft)

        form.addSpacing(8)

        self.register_btn = QPushButton("Create account")
        self.register_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.register_btn.setMinimumHeight(48)
        self.register_btn.clicked.connect(self._register)
        self.register_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 14px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover {"
            f"background: {ACCENT_HOVER};"
            "}"
            "QPushButton:disabled { background: #9EC2FF; color: #F5F8FF; }"
        )
        form.addWidget(self.register_btn)

        back_btn = QPushButton("Back to login")
        back_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        back_btn.setMinimumHeight(46)
        back_btn.clicked.connect(self._on_back)
        back_btn.setStyleSheet(
            "QPushButton {"
            f"background: #F2F2F7; color: {TEXT_MAIN}; border: none; border-radius: 14px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        form.addWidget(back_btn)
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

    def _register(self) -> None:
        self._clear_inline_error()
        self.register_btn.setEnabled(False)
        try:
            email = self.email.text().strip().lower()
            mobile = self.mobile.text().strip()
            password = self.password.text()
            confirm = self.confirm_password.text()
            if not email:
                raise ValueError("Email is required.")
            if not mobile:
                raise ValueError("Mobile is required.")
            if not password:
                raise ValueError("Password is required.")
            if not confirm:
                raise ValueError("Confirm password is required.")
            if (len(password) < 6) or (not any(ch.isdigit() for ch in password)):
                raise ValueError("Password must contain 6 Characters and at least 1 number.")
            if password != confirm:
                raise ValueError("Passwords do not match.")

            uid = self.app.auth.register(email, password, mobile=mobile)
            self.router.session.uid = uid
            self.router.session.email = email
            self.router.session.company_id = None
            self._upload_pending_avatar(uid)

            tokens = getattr(self.app.auth, "current_tokens", {}) or {}
            self.app.session.save_session(
                uid=uid,
                email=email,
                remember_me=True,
                company_id=None,
                id_token=tokens.get("idToken"),
                refresh_token=tokens.get("refreshToken"),
            )
            self._on_register_done()
        except TypeError:
            try:
                uid = self.app.auth.register(email, password)
                if hasattr(self.app.company, "update_user_profile"):
                    self.app.company.update_user_profile(uid, mobile=mobile)
                self._upload_pending_avatar(uid)
                self.router.session.uid = uid
                self.router.session.email = email
                self.router.session.company_id = None
                self._on_register_done()
            except Exception as exc:
                self._set_inline_error(self._normalize_register_error(str(exc)))
        except Exception as exc:
            self._set_inline_error(self._normalize_register_error(str(exc)))
        finally:
            self._cleanup_pending_avatar_file()
            self.register_btn.setEnabled(True)

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

    def _set_inline_error(self, text: str) -> None:
        msg = str(text or "").strip()
        self.inline_error.setText(msg)
        self.inline_error.setVisible(bool(msg))
        self.login_existing_btn.setVisible(msg == "This email is already in use.")

    def _clear_inline_error(self, *_args) -> None:
        self.inline_error.hide()
        self.inline_error.clear()
        self.login_existing_btn.hide()

    def _go_to_login_with_email(self) -> None:
        try:
            setattr(self.router, "prefill_login_email", self.email.text().strip())
        except Exception:
            pass
        self._on_back()

    def _normalize_register_error(self, raw: str) -> str:
        txt = (raw or "").strip()
        up = txt.upper()
        if "EMAIL_EXISTS" in up or "ALREADY EXISTS" in up or "EMAIL ALREADY" in up:
            return "This email is already in use."
        if "MOBILE NUMBER IS ALREADY IN USE" in up:
            return "This mobile number is already in use."
        if "WEAK_PASSWORD" in up or "AT LEAST 6 CHARACTERS" in up:
            return "Password must contain 6 Characters and at least 1 number."
        if "PASSWORD" in up and ("6" in up or "NUMBER" in up):
            return "Password must contain 6 Characters and at least 1 number."
        return txt or "Unable to create account right now."

    def _format_mobile_text(self, text: str) -> str:
        digits = "".join(ch for ch in str(text or "") if ch.isdigit())
        if not digits:
            return ""
        if len(digits) <= 3:
            return digits
        if len(digits) <= 6:
            return f"{digits[:3]} {digits[3:]}"
        return f"{digits[:3]} {digits[3:6]} {digits[6:]}"

    def _on_mobile_changed(self, *_args) -> None:
        if not self.mobile:
            return
        current = str(self.mobile.text() or "")
        formatted = self._format_mobile_text(current)
        if current == formatted:
            return
        self.mobile.blockSignals(True)
        self.mobile.setText(formatted)
        self.mobile.blockSignals(False)
        self.mobile.setCursorPosition(len(formatted))

    def _pick_profile_photo(self) -> None:
        self._clear_inline_error()
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Select profile photo",
            "",
            "Images (*.png *.jpg *.jpeg *.bmp *.webp)",
        )
        if not path:
            return
        try:
            crop = AvatarCropDialog(str(path), self)
        except Exception:
            self._set_inline_error("Could not open selected image.")
            return
        if crop.exec() != QDialog.DialogCode.Accepted:
            return
        saved = self._save_cropped_avatar_temp(crop.result_pixmap)
        if not saved:
            self._set_inline_error("Could not prepare profile photo.")
            return
        self._photo_pending_path = saved
        if self.photo_input:
            self.photo_input.setText(Path(saved).name)
        self._set_photo_preview(saved)

    def _set_photo_preview(self, path: str) -> None:
        pix = QPixmap(str(path or ""))
        if pix.isNull():
            self.photo_preview.setPixmap(QPixmap())
            self.photo_preview.setText("Photo")
            return
        self.photo_preview.setPixmap(self._circle_avatar_pixmap(pix, self.photo_preview.size()))
        self.photo_preview.setText("")
        self.photo_preview.setStyleSheet(
            "QLabel { background: #DDE5F0; border: 1px solid #C9D3E6; border-radius: 20px; }"
        )

    def _save_cropped_avatar_temp(self, pixmap: QPixmap) -> str:
        if pixmap.isNull():
            return ""
        base_dir = Path(getattr(getattr(self.app, "config", None), "data_dir", Path.cwd()))
        out_dir = base_dir / "register_avatars"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"register_avatar_{random.randint(100000, 999999)}.png"
        if pixmap.save(str(out_path), "PNG"):
            return str(out_path)
        return ""

    def _upload_pending_avatar(self, uid: str) -> None:
        path = str(self._photo_pending_path or "").strip()
        if not uid or not path:
            return
        if not hasattr(self.app.company, "update_user_profile"):
            return
        # Ensure the user profile doc exists before avatar write, then verify.
        ensure_profile = getattr(self.app.company, "ensure_user_profile", None)
        if callable(ensure_profile):
            try:
                ensure_profile(uid, str(self.email.text() or "").strip().lower())
            except Exception:
                pass
        self.app.company.update_user_profile(uid, avatar_path=path)
        get_profile = getattr(self.app.company, "get_user_profile", None)
        if callable(get_profile):
            profile = dict(get_profile(uid) or {})
            avatar_saved = str(profile.get("avatarPath") or "").strip()
            if not avatar_saved:
                # Retry one more time to avoid intermittent timing/write issues.
                self.app.company.update_user_profile(uid, avatar_path=path)
                profile2 = dict(get_profile(uid) or {})
                avatar_saved2 = str(profile2.get("avatarPath") or "").strip()
                if not avatar_saved2:
                    raise ValueError("Avatar upload succeeded but avatarPath was not saved to user profile.")

    def _cleanup_pending_avatar_file(self) -> None:
        path = str(self._photo_pending_path or "").strip()
        if not path:
            return
        try:
            p = Path(path)
            if p.exists() and p.is_file():
                p.unlink()
        except Exception:
            pass
        self._photo_pending_path = ""

    def _circle_avatar_pixmap(self, source: QPixmap, size: QSize) -> QPixmap:
        w = max(1, int(size.width()))
        h = max(1, int(size.height()))
        out = QPixmap(w, h)
        out.fill(Qt.GlobalColor.transparent)
        if source.isNull():
            return out
        p = QPainter(out)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        clip = QPainterPath()
        clip.addEllipse(QRectF(0, 0, float(w), float(h)))
        p.setClipPath(clip)
        src_ratio = source.width() / max(1.0, float(source.height()))
        dst_ratio = w / max(1.0, float(h))
        if src_ratio > dst_ratio:
            target_h = float(source.height())
            target_w = target_h * dst_ratio
            sx = (float(source.width()) - target_w) / 2.0
            src_rect = QRectF(sx, 0.0, target_w, target_h)
        else:
            target_w = float(source.width())
            target_h = target_w / max(0.0001, dst_ratio)
            sy = (float(source.height()) - target_h) / 2.0
            src_rect = QRectF(0.0, sy, target_w, target_h)
        p.drawPixmap(QRectF(0, 0, float(w), float(h)), source, src_rect)
        p.end()
        return out
