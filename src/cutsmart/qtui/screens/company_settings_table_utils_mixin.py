from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QHBoxLayout, QLabel, QLineEdit, QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget


class CompanySettingsTableUtilsMixin:

    def _measurement_unit_key(self) -> str:
        unit = str((getattr(self, "_company", {}) or {}).get("measurementUnit") or "mm").strip().lower()
        return "inches" if unit in ("in", "inch", "inches") else "mm"

    def _measurement_unit_suffix(self) -> str:
        return "in" if self._measurement_unit_key() == "inches" else "mm"

    def _role_slug(self, value: str) -> str:
        text = "".join(ch.lower() if ch.isalnum() else "_" for ch in str(value or "").strip()).strip("_")
        while "__" in text:
            text = text.replace("__", "_")
        return text or "role"

    def _available_role_permission_keys(self) -> list[str]:
        known = [
            "company.dashboard.view",
            "projects.create",
            "projects.view",
            "projects.view.others",
            "projects.access.lock",
            "projects.status",
            "projects.create.others",
            "sales.view",
            "sales.edit",
            "production.view",
            "production.edit",
            "production.key",
            "staff.add",
            "staff.remove",
            "staff.change.role",
            "staff.change.display_name",
            "company.settings",
            "company.updates",
        ]
        deprecated = {"projects.edit", "projects.create.other"}
        keys = list(known)
        seen = set(keys)

        for role in (self._company.get("roles") or []):
            if not isinstance(role, dict):
                continue
            perms = role.get("permissions") or {}
            if not isinstance(perms, dict):
                continue
            for key in perms.keys():
                k = str(key).strip()
                if k and k not in seen and k not in deprecated:
                    seen.add(k)
                    keys.append(k)

        company_id = str(getattr(self.router.session, "company_id", "") or "").strip()
        if company_id and hasattr(self.app.company, "get_role_permissions"):
            for probe in ("staff", "admin", "owner"):
                try:
                    perms = self.app.company.get_role_permissions(company_id, probe) or {}
                except Exception:
                    perms = {}
                if isinstance(perms, dict):
                    for key in perms.keys():
                        k = str(key).strip()
                        if k and k not in seen and k not in deprecated:
                            seen.add(k)
                            keys.append(k)
        return keys

    def _permission_label_map(self) -> dict[str, str]:
        return {
            "company.dashboard.view": "View Dashboard",
            "projects.create": "Create Projects",
            "projects.view": "View Projects",
            "projects.view.others": "View Other Users' Projects",
            "projects.access.lock": "Lock Project Access Changes",
            "projects.status": "Edit Any Project Status",
            "projects.create.others": "Create Projects Under Another User",
            "sales.view": "View Sales Tab",
            "sales.edit": "Edit Sales Tab",
            "production.view": "View Production Tab",
            "production.edit": "Edit Production Tab",
            "production.key": "Grant Temporary Production Edit Access",
            "staff.add": "Add Staff To Company",
            "staff.remove": "Remove Staff From Company",
            "staff.change.role": "Change Staff Member Role",
            "staff.change.display_name": "Change Staff Display Name",
            "company.settings": "View/Change Company Settings",
            "company.updates": "Access Company Update Feed",
        }

    def _default_role_permissions(self, role_id: str | None = None, role_name: str | None = None) -> dict[str, bool]:
        defaults = {key: False for key in self._available_role_permission_keys()}
        rid = str(role_id or "").strip().lower()
        rname = str(role_name or "").strip().lower()
        if rid == "owner" or rname == "owner":
            for key in list(defaults.keys()):
                defaults[key] = True
        if "projects.create" in defaults:
            defaults["projects.create"] = True
        return defaults

    def _permission_button_text(self, perms: dict[str, bool] | None) -> str:
        enabled = 0
        if isinstance(perms, dict):
            enabled = sum(1 for v in perms.values() if bool(v))
        return f"Permissions ({enabled})"

    def _set_color_button(self, table: QTableWidget, row: int, col: int, color_hex: str, on_click) -> None:
        btn = QPushButton("")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setProperty("row", row)
        btn.setProperty("col", col)
        btn.setProperty("hex", color_hex)
        btn.setFixedSize(28, 24)
        btn.setStyleSheet(
            "QPushButton {"
            f"background: {color_hex}; color: transparent; border: 1px solid #D7DCE5; border-radius: 8px; padding: 0;"
            "}"
        )
        btn.clicked.connect(on_click)
        item = table.item(row, col)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, col, item)
        item.setText("")
        item.setData(Qt.ItemDataRole.UserRole, color_hex)
        table.setCellWidget(row, col, self._wrap_table_control(btn))

    def _set_name_editor(self, table: QTableWidget, row: int, col: int, text: str, on_change) -> None:
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        job_types_table = getattr(self, "_company_job_types_table", None)
        item_categories_table = getattr(self, "_company_item_categories_table", None)
        part_types_table = getattr(self, "_company_part_types_table", None)
        hardware_table = getattr(self, "_company_hardware_table", None)
        roles_table = getattr(self, "_company_roles_table", None)
        board_table = getattr(self, "_company_board_table", None)
        board_finishes_table = getattr(self, "_company_board_finishes_table", None)
        sheet_sizes_table = getattr(self, "_company_sheet_sizes_table", None)
        if table in (job_types_table, item_categories_table, part_types_table, hardware_table, roles_table, board_table, board_finishes_table, sheet_sizes_table):
            edit.setStyleSheet(
                "QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }"
            )
        else:
            edit.setStyleSheet(
                "QLineEdit { background: #F7F8FA; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }"
            )
        edit.textChanged.connect(on_change)
        table.setCellWidget(row, col, self._wrap_table_control(edit))

    def _set_thickness_editor(self, table: QTableWidget, row: int, col: int, text: str, on_change) -> None:
        host = QWidget()
        host.setStyleSheet("QWidget { background: transparent; border: none; }")
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(5)
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        edit.setFixedWidth(64)
        edit.setStyleSheet(
            "QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }"
        )
        edit.textChanged.connect(on_change)
        unit_lbl = QLabel(self._measurement_unit_suffix())
        unit_lbl.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; background: transparent; border: none; }")
        lay.addWidget(edit)
        lay.addWidget(unit_lbl)
        lay.addStretch(1)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _wrap_table_control(self, control: QWidget, vpad: int = 3) -> QWidget:
        host = QWidget()
        host.setStyleSheet("QWidget { background: transparent; border: none; }")
        lay = QVBoxLayout(host)
        lay.setContentsMargins(1, 0, 1, 0)
        lay.setSpacing(0)
        lay.addWidget(control, alignment=Qt.AlignmentFlag.AlignVCenter)
        return host

    def _apply_compact_row_height(self, table: QTableWidget, row_height: int = 24) -> None:
        if table is None:
            return
        table.verticalHeader().setDefaultSectionSize(row_height)
        for r in range(table.rowCount()):
            table.setRowHeight(r, row_height)

    def _read_color_hex(self, table: QTableWidget, row: int, col: int, default: str) -> str:
        w = table.cellWidget(row, col)
        if isinstance(w, QWidget):
            btn = w.findChild(QPushButton)
            if isinstance(btn, QPushButton):
                raw = str(btn.property("hex") or "").strip()
                if raw:
                    return self._normalize_hex(raw, default)
        item = table.item(row, col)
        if item is not None:
            raw_data = str(item.data(Qt.ItemDataRole.UserRole) or "").strip()
            if raw_data:
                return self._normalize_hex(raw_data, default)
            raw_text = str(item.text() or "").strip()
            if raw_text:
                return self._normalize_hex(raw_text, default)
        return self._normalize_hex(default, default)

    def _editor_text(self, table: QTableWidget, row: int, col: int) -> str:
        w = table.cellWidget(row, col)
        if isinstance(w, QLineEdit):
            return str(w.text() or "").strip()
        if isinstance(w, QWidget):
            e = w.findChild(QLineEdit)
            if isinstance(e, QLineEdit):
                return str(e.text() or "").strip()
        item = table.item(row, col)
        return str(item.text() if item else "").strip()


