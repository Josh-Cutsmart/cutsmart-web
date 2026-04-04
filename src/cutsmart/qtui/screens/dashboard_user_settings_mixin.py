from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import QColorDialog, QComboBox, QDialog, QFileDialog, QFrame, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPushButton, QVBoxLayout, QWidget

from cutsmart.qtui.screens.dashboard_widgets import AvatarCropDialog
from cutsmart.ui.style import ACCENT, TEXT_MAIN, TEXT_MUTED


class DashboardUserSettingsMixin:

    def _build_user_settings_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        title = QLabel("User Settings")
        title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 24px; font-weight: 700;")
        layout.addWidget(title)

        subtitle = QLabel("Photo, badge color, and app mode for your account.")
        subtitle.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 13px;")
        layout.addWidget(subtitle)

        card = QFrame()
        card.setObjectName("UserSettingsCard")
        card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #E4E6EC;"
            "border-radius: 14px;"
            "}"
        )
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(14, 14, 14, 14)
        card_layout.setSpacing(10)

        name_lbl = QLabel("Display Name")
        name_lbl.setStyleSheet("color: #5B6472; font-size: 12px; font-weight: 700;")
        card_layout.addWidget(name_lbl)
        self._user_settings_name_input = QLineEdit()
        self._user_settings_name_input.setPlaceholderText("Your display name")
        self._user_settings_name_input.setStyleSheet(
            "QLineEdit { background: #F7F8FA; border: 1px solid #E5E7EC; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #1F2937; }"
        )
        card_layout.addWidget(self._user_settings_name_input)

        mobile_lbl = QLabel("Mobile")
        mobile_lbl.setStyleSheet("color: #5B6472; font-size: 12px; font-weight: 700;")
        card_layout.addWidget(mobile_lbl)
        self._user_settings_mobile_input = QLineEdit()
        self._user_settings_mobile_input.setPlaceholderText("Your mobile number")
        self._user_settings_mobile_input.setStyleSheet(
            "QLineEdit { background: #F7F8FA; border: 1px solid #E5E7EC; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #1F2937; }"
        )
        card_layout.addWidget(self._user_settings_mobile_input)

        photo_lbl = QLabel("Photo Upload")
        photo_lbl.setStyleSheet("color: #5B6472; font-size: 12px; font-weight: 700;")
        card_layout.addWidget(photo_lbl)
        photo_row = QHBoxLayout()
        photo_row.setSpacing(8)
        self._user_photo_preview = QLabel()
        self._user_photo_preview.setFixedSize(40, 40)
        self._user_photo_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._user_photo_preview.setStyleSheet(
            "QLabel { background: #7D99B3; color: #FFFFFF; border: none; border-radius: 20px; font-size: 12px; font-weight: 700; }"
        )
        photo_row.addWidget(self._user_photo_preview)
        self._user_photo_input = QLineEdit()
        self._user_photo_input.setReadOnly(True)
        self._user_photo_input.setPlaceholderText("No photo selected")
        self._user_photo_input.setStyleSheet(
            "QLineEdit { background: #F7F8FA; border: 1px solid #E5E7EC; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #1F2937; }"
        )
        photo_row.addWidget(self._user_photo_input, stretch=1)
        browse_btn = QPushButton("Browse")
        browse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        browse_btn.setFixedHeight(34)
        browse_btn.setStyleSheet("QPushButton { background: #E8F0FF; color: #2F6BFF; border: none; border-radius: 9px; padding: 0 12px; font-size: 12px; font-weight: 700; }")
        browse_btn.clicked.connect(self._pick_user_photo)
        photo_row.addWidget(browse_btn)
        upload_btn = QPushButton("Upload")
        upload_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        upload_btn.setFixedHeight(34)
        upload_btn.setStyleSheet("QPushButton { background: #7D99B3; color: #FFFFFF; border: none; border-radius: 9px; padding: 0 12px; font-size: 12px; font-weight: 700; }")
        upload_btn.clicked.connect(self._upload_user_photo)
        photo_row.addWidget(upload_btn)
        card_layout.addLayout(photo_row)

        color_lbl = QLabel("Badge Color")
        color_lbl.setStyleSheet("color: #5B6472; font-size: 12px; font-weight: 700;")
        card_layout.addWidget(color_lbl)
        color_row = QHBoxLayout()
        color_row.setSpacing(8)
        self._user_badge_color_input = QLineEdit()
        self._user_badge_color_input.setPlaceholderText("#7D99B3")
        self._user_badge_color_input.setStyleSheet(
            "QLineEdit { background: #F7F8FA; border: 1px solid #E5E7EC; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #1F2937; }"
        )
        color_row.addWidget(self._user_badge_color_input, stretch=1)
        color_pick_btn = QPushButton("Pick")
        color_pick_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        color_pick_btn.setFixedHeight(34)
        color_pick_btn.setStyleSheet("QPushButton { background: #E8F0FF; color: #2F6BFF; border: none; border-radius: 9px; padding: 0 12px; font-size: 12px; font-weight: 700; }")
        color_pick_btn.clicked.connect(self._pick_badge_color)
        color_row.addWidget(color_pick_btn)
        card_layout.addLayout(color_row)

        mode_lbl = QLabel("Application Mode")
        mode_lbl.setStyleSheet("color: #5B6472; font-size: 12px; font-weight: 700;")
        card_layout.addWidget(mode_lbl)
        self._user_theme_combo = QComboBox()
        self._user_theme_combo.addItems(["Light", "Dark"])
        self._user_theme_combo.setStyleSheet(
            "QComboBox { background: #F7F8FA; border: 1px solid #E5E7EC; border-radius: 9px; padding: 8px 10px; font-size: 12px; color: #1F2937; }"
        )
        card_layout.addWidget(self._user_theme_combo)

        actions = QHBoxLayout()
        actions.addStretch(1)
        save_btn = QPushButton("Save Preferences")
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.setFixedHeight(36)
        save_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 10px;"
            "font-size: 13px; font-weight: 700; padding: 0 14px;"
            "}"
            "QPushButton:hover { background: #2458D3; }"
        )
        save_btn.clicked.connect(self._save_user_settings)
        actions.addWidget(save_btn)
        card_layout.addLayout(actions)
        layout.addWidget(card)
        layout.addStretch(1)

        self._refresh_user_settings(silent=True)
        return page

    def _refresh_user_settings(self, silent: bool = False) -> None:
        self._load_user_profile(silent=silent)
        display_name = str((self._user_profile or {}).get("displayName") or self._default_user_display_name(str((self._user_profile or {}).get("email") or ""))).strip()
        avatar_path = str((self._user_profile or {}).get("avatarPath") or "").strip()
        mobile = str((self._user_profile or {}).get("mobile") or (self._user_profile or {}).get("phone") or "").strip()
        badge_color = self._normalize_hex(str((self._user_profile or {}).get("badgeColor") or "#7D99B3"), "#7D99B3")
        ui_mode = str((self._user_profile or {}).get("uiTheme") or "light").strip().lower()

        if self._user_settings_name_input:
            self._user_settings_name_input.setText(display_name)
        if self._user_settings_mobile_input:
            self._user_settings_mobile_input.setText(mobile)
        self._user_photo_pending_path = avatar_path
        if self._user_photo_input:
            self._user_photo_input.setText(avatar_path)
        if self._user_badge_color_input:
            self._user_badge_color_input.setText(badge_color)
        if self._user_theme_combo:
            self._user_theme_combo.setCurrentText("Dark" if ui_mode == "dark" else "Light")
        if self._user_photo_preview:
            loader = getattr(self, "_image_preview_pixmap", None)
            if callable(loader):
                pix = loader(avatar_path) if avatar_path else QPixmap()
            else:
                pix = QPixmap(avatar_path) if avatar_path and Path(avatar_path).exists() else QPixmap()
            if not pix.isNull():
                self._user_photo_preview.setPixmap(self._circle_avatar_pixmap(pix, self._user_photo_preview.size()))
                self._user_photo_preview.setText("")
                self._user_photo_preview.setStyleSheet("QLabel { border: none; border-radius: 20px; background: #DDE5F0; }")
            else:
                self._user_photo_preview.setPixmap(QPixmap())
                self._user_photo_preview.setText(self._sidebar_user_initials())
                self._user_photo_preview.setStyleSheet(
                    f"QLabel {{ background: {badge_color}; color: #FFFFFF; border: none; border-radius: 20px; font-size: 12px; font-weight: 700; }}"
                )
        self._apply_user_theme()
        self._sync_sidebar_user_identity()

    def _save_user_settings(self) -> None:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid:
            QMessageBox.warning(self, "User Settings", "Missing user session.")
            return
        display_name = str(self._user_settings_name_input.text() if self._user_settings_name_input else "").strip()
        if not display_name:
            QMessageBox.warning(self, "User Settings", "Display name cannot be empty.")
            return
        mobile = str(self._user_settings_mobile_input.text() if self._user_settings_mobile_input else "").strip()
        badge_color_raw = str(self._user_badge_color_input.text() if self._user_badge_color_input else "").strip()
        badge_color = self._normalize_hex(badge_color_raw, "#7D99B3")
        ui_theme = "dark" if str(self._user_theme_combo.currentText() if self._user_theme_combo else "Light").strip().lower() == "dark" else "light"

        try:
            if hasattr(self.app.company, "update_user_profile"):
                self.app.company.update_user_profile(uid, display_name=display_name, mobile=mobile, badge_color=badge_color, ui_theme=ui_theme)
            else:
                raise ValueError("Profile updates are not supported by this backend.")
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return

        self._user_profile["displayName"] = display_name
        self._user_profile["mobile"] = mobile
        self._user_profile["badgeColor"] = badge_color
        self._user_profile["uiTheme"] = ui_theme
        QMessageBox.information(self, "Saved", "User settings updated.")
        self._refresh_user_settings(silent=True)

    def _pick_user_photo(self) -> None:
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
        except Exception as exc:
            QMessageBox.critical(self, "Photo", str(exc))
            return
        if crop.exec() != QDialog.DialogCode.Accepted:
            return
        saved_path = self._save_cropped_avatar(crop.result_pixmap)
        if not saved_path:
            QMessageBox.warning(self, "Photo", "Could not save cropped image.")
            return
        self._user_photo_pending_path = saved_path
        if self._user_photo_input:
            self._user_photo_input.setText(self._user_photo_pending_path)
        if self._user_photo_preview:
            pix = QPixmap(saved_path)
            if not pix.isNull():
                self._user_photo_preview.setPixmap(self._circle_avatar_pixmap(pix, self._user_photo_preview.size()))
                self._user_photo_preview.setText("")

    def _upload_user_photo(self) -> None:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        photo_path = str(self._user_photo_pending_path or "").strip()
        if not uid:
            QMessageBox.warning(self, "User Settings", "Missing user session.")
            return
        if not photo_path:
            QMessageBox.warning(self, "User Settings", "Please choose a photo first.")
            return
        try:
            if hasattr(self.app.company, "update_user_profile"):
                self.app.company.update_user_profile(uid, avatar_path=photo_path)
            else:
                raise ValueError("Profile updates are not supported by this backend.")
        except Exception as exc:
            QMessageBox.critical(self, "Upload failed", str(exc))
            return
        self._load_user_profile(silent=True)
        self._refresh_user_settings(silent=True)
        QMessageBox.information(self, "Uploaded", "Profile photo updated.")

    def _pick_badge_color(self) -> None:
        current = self._normalize_hex(str(self._user_badge_color_input.text() if self._user_badge_color_input else "#7D99B3"), "#7D99B3")
        color = QColorDialog.getColor(QColor(current), self, "Select badge color")
        if not color.isValid():
            return
        if self._user_badge_color_input:
            self._user_badge_color_input.setText(color.name().upper())
