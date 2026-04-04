from __future__ import annotations

from pathlib import Path
import random

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPainter, QPixmap
from PySide6.QtWidgets import (
    QDialog,
    QFrame,
    QGraphicsBlurEffect,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from cutsmart.ui.style import ACCENT, ACCENT_HOVER, APP_BG, TEXT_MAIN, TEXT_MUTED


class CompanySelectScreen(QWidget):
    def __init__(self, app, router, on_create, on_join, on_done=None, on_logout=None):
        super().__init__()
        self.app = app
        self.router = router
        self.on_create = on_create
        self.on_join = on_join
        self.on_done = on_done
        self.on_logout = on_logout
        self._invites_layout = None
        self._build_ui()
        self._refresh_invites()

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

        outer = QFrame()
        outer.setFixedSize(620, 520)
        outer.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #ECECF0;"
            "border-radius: 28px;"
            "}"
        )
        shell.addWidget(outer)
        self._card = outer

        layout = QVBoxLayout(outer)
        layout.setContentsMargins(30, 24, 30, 24)
        layout.setSpacing(12)

        title = QLabel("Choose Your Workspace")
        title.setStyleSheet(
            f"color: {TEXT_MAIN}; font-size: 34px; font-weight: 700;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        title.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        layout.addWidget(title)

        subtitle = QLabel("Create a new company or join an existing one.")
        subtitle.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: 14px;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        subtitle.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        layout.addWidget(subtitle)

        actions = QHBoxLayout()
        actions.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        actions.setSpacing(10)

        create_btn = QPushButton("Create Company")
        create_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        create_btn.setFixedSize(240, 56)
        create_btn.clicked.connect(self.on_create)
        create_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 16px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover {"
            f"background: {ACCENT_HOVER};"
            "}"
        )
        actions.addWidget(create_btn)

        join_btn = QPushButton("Join Company")
        join_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        join_btn.setFixedSize(240, 56)
        join_btn.clicked.connect(self.on_join)
        join_btn.setStyleSheet(
            "QPushButton {"
            f"background: #F2F2F7; color: {TEXT_MAIN}; border: none; border-radius: 16px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        actions.addWidget(join_btn)

        layout.addLayout(actions)

        invites_card = QFrame()
        invites_card.setStyleSheet(
            "QFrame {"
            "background: transparent;"
            "border: none;"
            "}"
        )
        invites_layout = QVBoxLayout(invites_card)
        invites_layout.setContentsMargins(16, 12, 16, 12)
        invites_layout.setSpacing(6)

        invites_title = QLabel("Company Invites")
        invites_title.setStyleSheet(
            f"color: {TEXT_MAIN}; font-size: 18px; font-weight: 700;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        invites_layout.addWidget(invites_title)

        invites_subtitle = QLabel("Accept an invite to join a company.")
        invites_subtitle.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: 12px;"
            "background: transparent; border: none; padding: 0; margin: 0;"
        )
        invites_layout.addWidget(invites_subtitle)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setMinimumHeight(220)
        scroll.setStyleSheet("QScrollArea { background: transparent; }")

        container = QWidget()
        self._invites_layout = QVBoxLayout(container)
        self._invites_layout.setContentsMargins(0, 4, 0, 4)
        self._invites_layout.setSpacing(8)
        self._invites_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        scroll.setWidget(container)

        invites_layout.addWidget(scroll)
        layout.addWidget(invites_card, stretch=1)

        logout_btn = QPushButton("Log out")
        logout_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        logout_btn.setMinimumHeight(46)
        logout_btn.setStyleSheet(
            "QPushButton {"
            f"background: #F2F2F7; color: {TEXT_MAIN}; border: none; border-radius: 14px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        logout_btn.clicked.connect(self._logout)
        layout.addWidget(logout_btn)
        self._layout_background_icons()
        self._bg_overlay.lower()
        self._card.raise_()

    def _clear_invites(self) -> None:
        if not self._invites_layout:
            return
        while self._invites_layout.count():
            item = self._invites_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    def _refresh_invites(self) -> None:
        self._clear_invites()

        uid = self.router.session.uid
        email = (getattr(self.router.session, "email", "") or "").strip().lower()
        invites = []
        try:
            if hasattr(self.app.company, "list_pending_invites"):
                invites = self.app.company.list_pending_invites(uid=uid, email=email)
        except Exception:
            invites = []

        if not invites:
            empty = QLabel("No pending invites.")
            empty.setStyleSheet(
                f"color: {TEXT_MUTED}; font-size: 12px;"
                "background: transparent; border: none; padding: 0; margin: 0;"
            )
            self._invites_layout.addWidget(empty)
            return

        for invite in invites:
            self._invites_layout.addWidget(self._invite_row(invite))

    def _invite_row(self, invite: dict) -> QWidget:
        row = QFrame()
        row.setStyleSheet(
            "QFrame {"
            "background: transparent;"
            "border: none;"
            "border-radius: 0px;"
            "}"
        )

        layout = QHBoxLayout(row)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(12)

        details = QVBoxLayout()
        details.setSpacing(2)

        company_name = str(invite.get("companyName") or "Company")
        role_id = str(invite.get("roleId") or "staff").title()

        company_label = QLabel(company_name)
        company_label.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 14px; font-weight: 700;")
        details.addWidget(company_label)

        role_label = QLabel(f"Role: {role_id}")
        role_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 12px;")
        details.addWidget(role_label)

        layout.addLayout(details, stretch=1)

        accept_btn = QPushButton("Accept")
        accept_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        accept_btn.setFixedSize(90, 34)
        accept_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 10px;"
            "font-size: 12px; font-weight: 700;"
            "}"
            "QPushButton:hover {"
            f"background: {ACCENT_HOVER};"
            "}"
        )
        accept_btn.clicked.connect(lambda: self._accept_invite(invite))
        layout.addWidget(accept_btn, alignment=Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        return row

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
                for i in range(320):
                    if i < 120:
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

    def _accept_invite(self, invite: dict) -> None:
        uid = self.router.session.uid
        company_name = str(invite.get("companyName") or "Company")
        try:
            invite_id = invite.get("id")
            if not invite_id:
                raise ValueError("Invite id missing.")
            company_id = self.app.company.accept_company_invite(uid=uid, invite_id=invite_id)
            self.router.session.company_id = company_id

            saved = self.app.session.load_session() or {}
            if saved.get("uid") and saved.get("email"):
                self.app.session.save_session(
                    uid=saved["uid"],
                    email=saved["email"],
                    remember_me=True,
                    company_id=company_id,
                    id_token=saved.get("id_token"),
                    refresh_token=saved.get("refresh_token"),
                )

            QMessageBox.information(self, "Invite accepted", f"Joined {company_name}.")

            if callable(self.on_done):
                self.on_done()
            else:
                self.on_join()
        except Exception as exc:
            QMessageBox.critical(self, "Could not accept invite", str(exc))

    def _logout(self) -> None:
        if not self._confirm_logout():
            return
        if callable(self.on_logout):
            self.on_logout()

    def _confirm_logout(self) -> bool:
        host = self.window() if isinstance(self.window(), QWidget) else self
        overlay = None
        prev_effect = None
        blur_fx = None
        try:
            if isinstance(host, QWidget):
                prev_effect = host.graphicsEffect()
                blur_fx = QGraphicsBlurEffect(host)
                blur_fx.setBlurRadius(5.0)
                host.setGraphicsEffect(blur_fx)
                overlay = QWidget(host)
                overlay.setObjectName("logoutConfirmOverlay")
                overlay.setStyleSheet("QWidget#logoutConfirmOverlay { background: rgba(15, 23, 42, 92); }")
                overlay.setGeometry(host.rect())
                overlay.show()
                overlay.raise_()
        except Exception:
            overlay = None

        dlg = QDialog(host if isinstance(host, QWidget) else None)
        dlg.setModal(True)
        dlg.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        dlg.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        dlg.setFixedWidth(520)
        dlg.setStyleSheet(
            "QDialog { background: transparent; border: none; }"
            "QFrame#logoutConfirmCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            "QPushButton#confirmBtn { background:#FDECEC; color:#B42318; border:1px solid #F5C2C7; }"
            "QPushButton#confirmBtn:hover { background:#FBD5DA; }"
            "QPushButton#cancelBtn { background:#FFFFFF; color:#334155; border:1px solid #D4DAE6; }"
            "QPushButton#cancelBtn:hover { background:#F8FAFC; }"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("logoutConfirmCard")
        root.addWidget(card, 0)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 14, 16, 12)
        card_l.setSpacing(10)

        title = QLabel("Are you sure you want to log out?")
        title.setWordWrap(True)
        title.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        card_l.addWidget(title, 0)

        btn_row = QHBoxLayout()
        btn_row.setContentsMargins(0, 0, 0, 0)
        btn_row.addStretch(1)
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("cancelBtn")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        confirm_btn = QPushButton("Log out")
        confirm_btn.setObjectName("confirmBtn")
        confirm_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_row.addWidget(confirm_btn, 0)
        btn_row.addWidget(cancel_btn, 0)
        card_l.addLayout(btn_row)

        confirm_btn.clicked.connect(dlg.accept)
        cancel_btn.clicked.connect(dlg.reject)
        accepted = int(dlg.exec()) == int(QDialog.DialogCode.Accepted)
        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass
        return accepted
