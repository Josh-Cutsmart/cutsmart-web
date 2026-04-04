from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QFrame,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from cutsmart.ui.style import TEXT_MAIN
from cutsmart.qtui.screens.sales_rooms_mixin import AnimatedOutlineButton


class StaffManagementMixin:
    _STAFF_ROW_BG = "#F8FAFD"
    _STAFF_ROW_TEXT = "#1F2937"

    @staticmethod
    def _staff_input_style() -> str:
        return (
            "QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; "
            "padding: 3px 8px; font-size: 12px; color: #334155; }"
        )

    @staticmethod
    def _staff_cell_pad(control: QWidget, left_right: int = 6) -> QWidget:
        host = QWidget()
        host.setStyleSheet("QWidget { background: transparent; border: none; }")
        lay = QHBoxLayout(host)
        lay.setContentsMargins(left_right, 0, left_right, 0)
        lay.setSpacing(0)
        lay.addWidget(control)
        return host

    def _staff_role_color_map(self) -> dict[str, str]:
        defaults = {
            "owner": "#3C5A95",
            "admin": "#4774A9",
            "staff": "#7D99B3",
        }
        out = dict(defaults)
        company = getattr(self, "_company", {}) or {}
        raw = company.get("roles") or []
        if isinstance(raw, list):
            for entry in raw:
                if not isinstance(entry, dict):
                    continue
                rid = str(entry.get("id") or entry.get("name") or "").strip().lower()
                if not rid:
                    continue
                col = QColor(str(entry.get("color") or "").strip())
                if col.isValid():
                    out[rid] = col.name()
        return out

    def _apply_staff_role_combo_theme(self, combo: QComboBox, role_id: str, role_colors: dict[str, str]) -> None:
        rid = str(role_id or "").strip().lower()
        bg = str(role_colors.get(rid) or "#7D99B3")
        q_bg = QColor(bg)
        if not q_bg.isValid():
            q_bg = QColor("#7D99B3")
            bg = q_bg.name()
        fg = "#FFFFFF" if q_bg.lightness() < 150 else "#0F172A"
        bd = q_bg.darker(112).name()
        combo.setStyleSheet(
            "QComboBox { "
            f"background: {bg}; color: {fg}; border: 1px solid {bd}; border-radius: 8px; padding: 3px 8px; font-size: 12px;"
            " }"
            "QComboBox::drop-down { width: 0px; border: none; subcontrol-origin: padding; subcontrol-position: top right; }"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
            "QAbstractItemView { background: #FFFFFF; color: #1F2937; border: 1px solid #D7DEE8; outline: none; }"
            "QAbstractItemView::item { min-height: 24px; }"
            "QAbstractItemView::item:selected { background: #EAF2FF; color: #1F2937; }"
        )

    def _build_staff_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        card = QFrame()
        card.setObjectName("CompanyStaffCard")
        card.setFrameShape(QFrame.Shape.NoFrame)
        card.setStyleSheet(
            "QFrame#CompanyStaffCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
            "QFrame#CompanyStaffTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
            "QWidget#CompanyStaffBody { background:transparent; border:none; border-radius:0px; }"
        )
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(0, 0, 0, 0)
        card_layout.setSpacing(0)

        top = QFrame()
        top.setObjectName("CompanyStaffTop")
        top.setFrameShape(QFrame.Shape.NoFrame)
        top.setFixedHeight(50)
        top_l = QHBoxLayout(top)
        top_l.setContentsMargins(14, 10, 14, 10)
        top_l.setSpacing(6)
        title = QLabel("STAFF")
        title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        top_l.addWidget(title, 0)

        theme = "#2F6BFF"
        try:
            theme_raw = getattr(self, "_sales_theme_hex", None)
            if callable(theme_raw):
                theme = str(theme_raw() or theme).strip() or theme
        except Exception:
            pass
        theme_soft = QColor(theme).lighter(190).name()

        invite_btn = AnimatedOutlineButton("+ Add")
        invite_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        invite_btn.setFixedSize(74, 30)
        invite_btn.clicked.connect(self._open_invite_staff_dialog)
        invite_btn.setStyleSheet(
            "QPushButton {"
            f"background: {theme_soft}; color: {theme}; border: none; border-radius: 8px;"
            "font-size: 13px; font-weight: 800; padding: 0 12px;"
            "}"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        invite_btn.set_outline_color(QColor(theme))
        invite_btn.set_outline_duration_ms(150)
        top_l.addWidget(invite_btn, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        top_l.addStretch(1)
        card_layout.addWidget(top)

        div = QFrame()
        div.setFrameShape(QFrame.Shape.NoFrame)
        div.setFixedHeight(1)
        div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        card_layout.addWidget(div)

        body = QWidget()
        body.setObjectName("CompanyStaffBody")
        body_l = QVBoxLayout(body)
        body_l.setContentsMargins(6, 0, 6, 0)
        body_l.setSpacing(0)

        table = QTableWidget()
        table.setObjectName("CompanyStaffTable")
        table.setFrameStyle(QFrame.Shape.NoFrame)
        table.setLineWidth(0)
        table.setMidLineWidth(0)
        table.setColumnCount(5)
        table.setHorizontalHeaderLabels(["", "Staff Name", "Staff Email", "Staff Mobile", "Staff Role"])
        table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.setAlternatingRowColors(False)
        table.setFrameShape(QFrame.Shape.NoFrame)
        table.verticalHeader().setVisible(False)
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        table.setColumnWidth(3, 140)
        table.setColumnWidth(4, 260)
        table.setStyleSheet(
            "QTableWidget#CompanyStaffTable {"
            "background: transparent; border: none; outline: none;"
            "}"
            "QTableWidget#CompanyStaffTable::pane { border: 0px; }"
            "QTableWidget#CompanyStaffTable QWidget { background: transparent; border: none; }"
            "QTableWidget#CompanyStaffTable QTableCornerButton::section { background: transparent; border: none; }"
            f"QTableWidget#CompanyStaffTable::item {{ background: transparent; color: {self._STAFF_ROW_TEXT}; border: none; padding: 0px; }}"
            f"QTableWidget#CompanyStaffTable::item:selected {{ background: transparent; color: {self._STAFF_ROW_TEXT}; }}"
            "QTableWidget#CompanyStaffTable::item:focus { outline: none; }"
            "QTableWidget#CompanyStaffTable QScrollBar { border: none; }"
            "QTableWidget#CompanyStaffTable QHeaderView { background: transparent; border: none; }"
            "QTableWidget#CompanyStaffTable QHeaderView::section {"
            "background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700;"
            "padding: 4px 2px 4px 2px;"
            "}"
        )
        table.horizontalHeader().setStyleSheet(
            "QHeaderView { background: transparent; border: none; }"
            "QHeaderView::section { background: transparent; border: none; }"
        )
        table.verticalHeader().setStyleSheet(
            "QHeaderView { background: transparent; border: none; }"
            "QHeaderView::section { background: transparent; border: none; }"
        )
        table.viewport().setStyleSheet("background:transparent; border:none;")
        table.setShowGrid(False)
        self._staff_table = table
        body_l.addWidget(table, stretch=1)
        card_layout.addWidget(body, 1)
        layout.addWidget(card, stretch=1)

        self._refresh_staff()
        return page

    def _staff_role_options(self) -> list[str]:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return ["staff"]
        try:
            roles = list(self.app.company.list_roles(company_id) or [])
            roles = [str(r).strip().lower() for r in roles if str(r).strip()]
            return roles or ["staff"]
        except Exception:
            return ["staff"]

    def _refresh_staff(self, silent: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id or not self._staff_table:
            return

        try:
            self._staff_all = list(self.app.company.list_staff(company_id) or [])
            self._stats["staff"] = len(self._staff_all)
        except Exception as exc:
            if not silent:
                QMessageBox.critical(self, "Staff refresh failed", str(exc))
            return

        table = self._staff_table
        role_options = self._staff_role_options()
        role_colors = self._staff_role_color_map()
        current_uid = str(getattr(self.router.session, "uid", "") or "").strip()
        can_rename = self._can_edit_staff_display_names()

        table.setRowCount(len(self._staff_all))
        for row_idx, person in enumerate(self._staff_all):
            table.setRowHeight(row_idx, 32)
            uid = str((person or {}).get("uid") or "").strip()
            name = str((person or {}).get("displayName") or uid or "User")
            email = str((person or {}).get("email") or "")
            mobile = str((person or {}).get("mobile") or (person or {}).get("phone") or "").strip()
            role_id = str((person or {}).get("roleId") or "staff").strip().lower()

            if can_rename:
                name_edit = QLineEdit(name)
                name_edit.setPlaceholderText("Display Name")
                name_edit.setFixedHeight(24)
                name_edit.setStyleSheet(self._staff_input_style())
                name_edit.editingFinished.connect(lambda member_uid=uid, edit=name_edit: self._change_staff_display_name(member_uid, edit.text()))
                table.setCellWidget(row_idx, 1, self._staff_cell_pad(name_edit))
            else:
                name_view = QLineEdit(name)
                name_view.setReadOnly(True)
                name_view.setFixedHeight(24)
                name_view.setStyleSheet(self._staff_input_style())
                table.setCellWidget(row_idx, 1, self._staff_cell_pad(name_view))

            email_view = QLineEdit(email)
            email_view.setReadOnly(True)
            email_view.setFixedHeight(24)
            email_view.setStyleSheet(self._staff_input_style())
            table.setCellWidget(row_idx, 2, self._staff_cell_pad(email_view))

            if can_rename:
                mobile_edit = QLineEdit(mobile)
                mobile_edit.setPlaceholderText("Mobile")
                mobile_edit.setFixedHeight(24)
                mobile_edit.setFixedWidth(130)
                mobile_edit.setStyleSheet(self._staff_input_style())
                mobile_edit.editingFinished.connect(lambda member_uid=uid, edit=mobile_edit: self._change_staff_mobile(member_uid, edit.text()))
                table.setCellWidget(row_idx, 3, self._staff_cell_pad(mobile_edit))
            else:
                mobile_view = QLineEdit(mobile)
                mobile_view.setReadOnly(True)
                mobile_view.setFixedHeight(24)
                mobile_view.setFixedWidth(130)
                mobile_view.setStyleSheet(self._staff_input_style())
                table.setCellWidget(row_idx, 3, self._staff_cell_pad(mobile_view))

            role_combo = QComboBox()
            for role in role_options:
                role_combo.addItem(role)
            if role_id in role_options:
                role_combo.setCurrentText(role_id)
            role_combo.setFixedHeight(24)
            role_combo.setMinimumWidth(210)
            self._apply_staff_role_combo_theme(role_combo, role_combo.currentText(), role_colors)
            role_combo.currentTextChanged.connect(
                lambda r, c=role_combo, m=uid, rc=role_colors: (
                    self._apply_staff_role_combo_theme(c, r, rc),
                    self._change_staff_role(m, r),
                )
            )
            table.setCellWidget(row_idx, 4, self._staff_cell_pad(role_combo))

            actions = QWidget()
            actions_row = QHBoxLayout(actions)
            actions_row.setContentsMargins(0, 0, 0, 0)
            actions_row.setSpacing(6)
            remove_btn = QPushButton("Remove")
            remove_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            remove_btn.setFixedHeight(24)
            remove_btn.setStyleSheet(
                "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
                "QPushButton:hover { background: #FFE2E2; }"
            )
            remove_btn.clicked.connect(lambda _=False, member_uid=uid: self._remove_staff_member(member_uid))
            if uid == current_uid:
                remove_btn.setEnabled(False)
            actions_row.addWidget(remove_btn, 0, Qt.AlignmentFlag.AlignVCenter)
            actions_row.addStretch(1)
            table.setCellWidget(row_idx, 0, self._staff_cell_pad(actions))

        if not self._staff_all:
            self._set_table_empty_state(table, 5, "No staff found")

        self._sync_sidebar_user_identity()
        self._sync_dashboard_stats()

    def _can_edit_staff_display_names(self) -> bool:
        company_id = getattr(self.router.session, "company_id", None)
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not company_id or not uid:
            return False
        try:
            if hasattr(self.app.company, "user_has_permission"):
                if bool(self.app.company.user_has_permission(company_id, uid, "staff.change.display_name")):
                    return True
                if bool(self.app.company.user_has_permission(company_id, uid, "staff.change.role")):
                    return True
        except Exception:
            pass
        for row in (self._staff_all or []):
            if str((row or {}).get("uid") or "").strip() == uid:
                role_id = str((row or {}).get("roleId") or "").strip().lower()
                return role_id in ("owner", "admin")
        return False

    def _change_staff_display_name(self, member_uid: str, new_name: str) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id or not member_uid:
            return
        if not self._can_edit_staff_display_names():
            QMessageBox.warning(self, "Permission denied", "Your role cannot change staff display names.")
            return
        value = str(new_name or "").strip()
        if not value:
            QMessageBox.warning(self, "Display Name", "Display name cannot be empty.")
            return
        try:
            if hasattr(self.app.company, "update_member_display_name"):
                self.app.company.update_member_display_name(company_id, member_uid, value)
            else:
                raise ValueError("This backend does not support staff display name updates.")
        except Exception as exc:
            QMessageBox.critical(self, "Display name update failed", str(exc))
            return
        self._refresh_staff(silent=True)
        self._refresh_projects(silent=True)
        self._apply_dashboard_projects_view()

    def _change_staff_mobile(self, member_uid: str, mobile: str) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id or not member_uid:
            return
        if not self._can_edit_staff_display_names():
            QMessageBox.warning(self, "Permission denied", "Your role cannot change staff mobile.")
            return
        value = str(mobile or "").strip()
        try:
            if hasattr(self.app.company, "update_member_mobile"):
                self.app.company.update_member_mobile(company_id, member_uid, value)
            else:
                raise ValueError("This backend does not support staff mobile updates.")
        except Exception as exc:
            QMessageBox.critical(self, "Mobile update failed", str(exc))
            return
        self._refresh_staff(silent=True)

    def _set_table_item_row(self, table: QTableWidget, row: int, col: int, text: str) -> None:
        item = QTableWidgetItem(text)
        item.setFlags(Qt.ItemFlag.ItemIsEnabled)
        item.setBackground(QColor(Qt.GlobalColor.transparent))
        item.setForeground(QColor(self._STAFF_ROW_TEXT))
        table.setItem(row, col, item)

    def _role_permission_count(self, role_id: str) -> int:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return 0
        try:
            perms = self.app.company.get_role_permissions(company_id, str(role_id or "").strip().lower())
            if isinstance(perms, dict):
                return sum(1 for value in perms.values() if bool(value))
        except Exception:
            pass
        return 0

    def _open_invite_staff_dialog(self) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        uid = getattr(self.router.session, "uid", None)
        if not company_id or not uid:
            QMessageBox.critical(self, "Invite failed", "Missing session context.")
            return

        dialog = QDialog(self)
        dialog.setWindowTitle("Add Staff")
        dialog.setModal(True)
        dialog.resize(420, 210)

        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(14, 14, 14, 12)
        layout.setSpacing(8)

        email_entry = QLineEdit()
        email_entry.setPlaceholderText("staff@company.com")
        email_entry.setStyleSheet("QLineEdit { background: white; border: 1px solid #E5E5EA; border-radius: 9px; padding: 8px 10px; font-size: 13px; }")

        role_combo = QComboBox()
        for role in self._staff_role_options():
            role_combo.addItem(role)
        role_combo.setStyleSheet("QComboBox { background: white; border: 1px solid #E5E5EA; border-radius: 9px; padding: 7px 10px; font-size: 13px; }")

        layout.addWidget(QLabel("Staff Email"))
        layout.addWidget(email_entry)
        layout.addWidget(QLabel("Role"))
        layout.addWidget(role_combo)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Send Invite")
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)

        def _submit_invite():
            email = email_entry.text().strip().lower()
            role = role_combo.currentText().strip().lower()
            if not email:
                QMessageBox.warning(dialog, "Missing email", "Please enter a staff email.")
                return
            try:
                self.app.company.invite_staff(company_id, uid, email, role)
            except Exception as exc:
                QMessageBox.critical(dialog, "Invite failed", str(exc))
                return
            dialog.accept()
            QMessageBox.information(self, "Invite sent", f"Invite sent to {email}.")
            self._refresh_staff()

        buttons.accepted.connect(_submit_invite)
        dialog.exec()

    def _change_staff_role(self, member_uid: str, new_role: str) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id or not member_uid:
            return
        target_role = str(new_role or "").strip().lower()
        current_role = ""
        for row in (self._staff_all or []):
            if str((row or {}).get("uid") or "").strip() == str(member_uid).strip():
                current_role = str((row or {}).get("roleId") or "").strip().lower()
                break

        # Only force handover if this change would leave the company with no owners.
        other_owner_exists = any(
            str((row or {}).get("uid") or "").strip() != str(member_uid).strip()
            and str((row or {}).get("roleId") or "").strip().lower() == "owner"
            for row in (self._staff_all or [])
        )
        if current_role == "owner" and target_role != "owner" and not other_owner_exists:
            candidates = []
            for row in (self._staff_all or []):
                uid = str((row or {}).get("uid") or "").strip()
                if not uid or uid == str(member_uid).strip():
                    continue
                display = str((row or {}).get("displayName") or "").strip()
                email = str((row or {}).get("email") or "").strip()
                label = display or email or uid
                if email and email.lower() not in label.lower():
                    label = f"{label} ({email})"
                candidates.append((uid, label))

            if not candidates:
                QMessageBox.warning(
                    self,
                    "Owner handover required",
                    "You must have another staff member to transfer Owner role to before changing this role.",
                )
                self._refresh_staff(silent=True)
                return

            dlg = QDialog(self)
            dlg.setWindowTitle("Transfer Owner Role")
            dlg.setModal(True)
            dlg.resize(430, 180)
            lay = QVBoxLayout(dlg)
            lay.setContentsMargins(14, 14, 14, 12)
            lay.setSpacing(8)

            msg = QLabel("Choose a staff member to receive the Owner role.")
            msg.setWordWrap(True)
            msg.setStyleSheet("QLabel { color: #334155; font-size: 12px; }")
            lay.addWidget(msg)

            combo = QComboBox()
            combo.setStyleSheet("QComboBox { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 6px 8px; font-size: 12px; color: #334155; }")
            for uid, label in candidates:
                combo.addItem(label, uid)
            lay.addWidget(combo)

            buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
            buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Transfer & Save")
            buttons.accepted.connect(dlg.accept)
            buttons.rejected.connect(dlg.reject)
            lay.addWidget(buttons)

            if dlg.exec() != QDialog.DialogCode.Accepted:
                self._refresh_staff(silent=True)
                return

            handover_uid = str(combo.currentData() or "").strip()
            if not handover_uid:
                self._refresh_staff(silent=True)
                return

            try:
                # Ensure owner is reassigned first, then apply requested role.
                self.app.company.update_member_role(company_id, handover_uid, "owner")
                self.app.company.update_member_role(company_id, member_uid, target_role)
            except Exception as exc:
                QMessageBox.critical(self, "Role update failed", str(exc))
                self._refresh_staff()
                return
            self._refresh_staff()
            return

        try:
            self.app.company.update_member_role(company_id, member_uid, target_role)
        except Exception as exc:
            QMessageBox.critical(self, "Role update failed", str(exc))
            self._refresh_staff()
            return
        self._refresh_staff()

    def _remove_staff_member(self, member_uid: str) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        current_uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not company_id or not member_uid or member_uid == current_uid:
            return

        confirm = QMessageBox.question(
            self,
            "Remove staff",
            "Remove this staff member from the company?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if confirm != QMessageBox.StandardButton.Yes:
            return

        try:
            self.app.company.remove_member(company_id, member_uid, removed_by_uid=current_uid)
        except Exception as exc:
            QMessageBox.critical(self, "Remove failed", str(exc))
            return
        self._refresh_staff()
