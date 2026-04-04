from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QColorDialog,
    QDialog,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
)

from cutsmart.qtui.screens.dashboard_widgets import RolePermissionsDialog


class CompanySettingsRoleActionsMixin:

    def _status_color_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_status_table
        if table is None:
            return
        row = self._row_from_table_button(table, sender, preferred_col=2)
        if row < 0 or row >= table.rowCount():
            return
        item = table.item(row, 2)
        start_color = self._read_color_hex(table, row, 2, "#3060D0")
        picked = QColorDialog.getColor(QColor(start_color), self, "Choose Status Color")
        if not picked.isValid():
            return
        new_hex = self._normalize_hex(str(picked.name() or start_color), start_color)
        if item is None:
            item = QTableWidgetItem(new_hex)
            table.setItem(row, 2, item)
        else:
            item.setText("")
        item.setData(Qt.ItemDataRole.UserRole, new_hex)
        self._set_color_button(table, row, 2, new_hex, self._status_color_button_clicked)
        self._queue_company_autosave("statuses", self._autosave_company_statuses)

    def _role_color_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_roles_table
        if table is None:
            return
        row = self._row_from_table_button(table, sender, preferred_col=2)
        if row < 0 or row >= table.rowCount():
            return
        item = table.item(row, 2)
        start_color = self._read_color_hex(table, row, 2, "#7D99B3")
        picked = QColorDialog.getColor(QColor(start_color), self, "Choose Role Color")
        if not picked.isValid():
            return
        new_hex = self._normalize_hex(str(picked.name() or start_color), start_color)
        if item is None:
            item = QTableWidgetItem(new_hex)
            table.setItem(row, 2, item)
        else:
            item.setText("")
        item.setData(Qt.ItemDataRole.UserRole, new_hex)
        self._set_color_button(table, row, 2, new_hex, self._role_color_button_clicked)
        self._queue_company_autosave("roles", self._autosave_company_roles)

    def _status_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_status_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_status_row(row=row)

    def _role_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_roles_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_role_row(row=row)

    def _set_delete_button(self, table: QTableWidget, row: int, col: int, on_click) -> None:
        host = QWidget()
        host.setStyleSheet("QWidget { background: transparent; border: none; }")
        row_layout = QHBoxLayout(host)
        row_layout.setContentsMargins(1, 0, 1, 0)
        row_layout.setSpacing(4)

        grip = QLabel("☰")
        grip.setStyleSheet("QLabel { color: #9AA6B2; font-size: 11px; font-weight: 700; padding: 0 1px; }")
        grip.setAlignment(Qt.AlignmentFlag.AlignCenter)
        grip.setToolTip("Drag to reorder")
        row_layout.addWidget(grip)

        btn = QPushButton("X")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setProperty("row", row)
        btn.setFixedSize(22, 22)
        btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        btn.clicked.connect(on_click)
        row_layout.addWidget(btn)
        row_layout.addStretch(1)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _row_from_table_button(self, table: QTableWidget | None, button: QPushButton, preferred_col: int | None = None) -> int:
        if table is None:
            return -1
        cols = [preferred_col] if isinstance(preferred_col, int) and preferred_col >= 0 else []
        cols.extend([c for c in range(table.columnCount()) if c not in cols])
        for r in range(table.rowCount()):
            for c in cols:
                w = table.cellWidget(r, c)
                if w is None:
                    continue
                if w is button:
                    return r
                if button in w.findChildren(QPushButton):
                    return r
        return int(button.property("row") or -1)

    def _role_permissions_clicked(self, row: int) -> None:
        table = self._company_roles_table
        if table is None or row < 0 or row >= table.rowCount():
            return
        name_item = table.item(row, 1)
        if not name_item:
            name_item = QTableWidgetItem(self._editor_text(table, row, 1))
            name_item.setData(Qt.ItemDataRole.UserRole, {"id": "", "permissions": self._default_role_permissions("", "")})
            table.setItem(row, 1, name_item)
        meta = dict(name_item.data(Qt.ItemDataRole.UserRole) or {})
        base_perms = self._default_role_permissions()
        current_perms = dict(meta.get("permissions") or {})
        for key, value in current_perms.items():
            base_perms[str(key)] = bool(value)
        dlg = RolePermissionsDialog(
            self._available_role_permission_keys(),
            base_perms,
            labels=self._permission_label_map(),
            role_name=self._editor_text(table, row, 1),
            parent=self,
        )
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        meta["permissions"] = dlg.selected_permissions()
        name_item.setData(Qt.ItemDataRole.UserRole, meta)
        self._set_role_permissions_button(row, meta.get("permissions") or {})
        self._queue_company_autosave("roles", self._autosave_company_roles)

    def _role_permissions_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_roles_table
        row = self._row_from_table_button(table, sender, preferred_col=3) if table is not None else -1
        if row < 0:
            row = int(sender.property("row") or -1)
        self._role_permissions_clicked(row)

    def _refresh_role_permissions_buttons(self) -> None:
        table = self._company_roles_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            name_item = table.item(row, 1)
            role_color = self._read_color_hex(table, row, 2, "#7D99B3")
            self._set_color_button(table, row, 2, role_color, self._role_color_button_clicked)
            role_name = self._editor_text(table, row, 1)
            self._set_name_editor(table, row, 1, role_name, lambda _=None: self._queue_company_autosave("roles", self._autosave_company_roles))
            self._set_delete_button(table, row, 0, self._role_delete_button_clicked)
            role_meta = dict(name_item.data(Qt.ItemDataRole.UserRole) or {}) if name_item else {}
            self._set_role_permissions_button(row, role_meta.get("permissions") or {})

    def _set_role_permissions_button(self, row: int, perms: dict[str, bool] | None) -> None:
        table = self._company_roles_table
        if table is None or row < 0:
            return
        btn = QPushButton(self._permission_button_text(perms))
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedHeight(24)
        btn.setStyleSheet(
            "QPushButton { background: #EEF1F6; color: #44556D; border: none; border-radius: 8px; padding: 2px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #E3E8F0; }"
        )
        btn.setProperty("row", row)
        btn.clicked.connect(self._role_permissions_button_clicked)
        table.setCellWidget(row, 3, self._wrap_table_control(btn))


