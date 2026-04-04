from __future__ import annotations

from pathlib import Path
import re
from zoneinfo import available_timezones

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFileDialog, QMessageBox, QTableWidget, QTableWidgetItem


class CompanyCoreMixin:

    def _canonical_timezone_name(self, value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return "Pacific/Auckland"
        up = raw.upper().replace(" ", "")
        if up in {"NZT", "NZST", "NZDT", "AUCKLAND", "PACIFIC/AUCKLAND"}:
            return "Pacific/Auckland"
        if up.startswith("NZT(") or up.startswith("NZST(") or up.startswith("NZDT("):
            return "Pacific/Auckland"
        m = re.match(r"^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$", up)
        if m:
            sign = m.group(1)
            hh = int(m.group(2))
            mm = int(m.group(3) or "0")
            if 0 <= hh <= 23 and 0 <= mm <= 59:
                if mm == 0:
                    return f"UTC{sign}{hh:02d}"
                return f"UTC{sign}{hh:02d}:{mm:02d}"
        try:
            names = available_timezones()
            if raw in names:
                return raw
            lower = raw.lower()
            for name in names:
                if name.lower() == lower:
                    return name
        except Exception:
            pass
        return raw

    def _deleted_retention_options(self) -> list[tuple[str, int]]:
        return [
            ("1 day", 1),
            ("1 week", 7),
            ("2 weeks", 14),
            ("1 month", 30),
            ("2 months", 60),
            ("3 months", 90),
            ("4 months", 120),
            ("6 months", 180),
            ("1 year", 365),
        ]

    def _deleted_retention_days_from_label(self, label: str) -> int:
        text = str(label or "").strip().lower()
        for lbl, days in self._deleted_retention_options():
            if lbl.lower() == text:
                return int(days)
        return 90

    def _deleted_retention_label_from_days(self, days_value) -> str:
        try:
            days = int(days_value)
        except Exception:
            days = 90
        options = self._deleted_retention_options()
        for lbl, val in options:
            if int(val) == days:
                return lbl
        # Nearest fallback so legacy custom values still map to a visible option.
        closest = min(options, key=lambda pair: abs(int(pair[1]) - days))
        return str(closest[0])

    def _load_company_roles_rows(self) -> None:
        table = self._company_roles_table
        if table is None:
            return
        raw = self._company.get("roles") or []
        rows = []
        used = set()
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            role_name = str(entry.get("name") or "").strip()
            role_id = str(entry.get("id") or self._role_slug(role_name)).strip().lower()
            if not role_name or not role_id:
                continue
            if role_id in used:
                continue
            used.add(role_id)
            color = self._normalize_hex(str(entry.get("color") or "#7D99B3"), "#7D99B3")
            permissions = dict(entry.get("permissions") or {})
            rows.append({"id": role_id, "name": role_name, "color": color, "permissions": permissions})
        if not rows:
            rows = [
                {"id": "owner", "name": "Owner", "color": "#3C5A95", "permissions": {}},
                {"id": "admin", "name": "Admin", "color": "#4774A9", "permissions": {}},
                {"id": "staff", "name": "Staff", "color": "#7D99B3", "permissions": {}},
            ]

        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=29)
        for idx, row in enumerate(rows):
            perms = self._default_role_permissions(row.get("id"), row.get("name"))
            incoming = dict(row.get("permissions") or {})
            for key, value in incoming.items():
                perms[str(key)] = bool(value)
            name_item = QTableWidgetItem(row["name"])
            name_item.setData(Qt.ItemDataRole.UserRole, {"id": row["id"], "permissions": perms})
            table.setItem(idx, 1, name_item)
            table.setItem(idx, 2, QTableWidgetItem(row["color"]))
            self._set_name_editor(table, idx, 1, row["name"], lambda _=None: self._queue_company_autosave("roles", self._autosave_company_roles))
            self._set_color_button(table, idx, 2, row["color"], self._role_color_button_clicked)
            self._set_delete_button(table, idx, 0, self._role_delete_button_clicked)
            self._set_role_permissions_button(idx, perms)
        self._fit_table_to_contents(table, min_rows=3)

    def _add_company_role_row(self) -> None:
        table = self._company_roles_table
        if table is None:
            return
        default_color = self._normalize_hex(
            str(self._company.get("themeColor") or self._company_theme_hex or "#2F6BFF"),
            "#2F6BFF",
        )
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        name_item = QTableWidgetItem("")
        name_item.setData(Qt.ItemDataRole.UserRole, {"id": "", "permissions": self._default_role_permissions("", "")})
        table.setItem(row, 1, name_item)
        table.setItem(row, 2, QTableWidgetItem(""))
        self._set_name_editor(table, row, 1, "", lambda _=None: self._queue_company_autosave("roles", self._autosave_company_roles))
        self._set_color_button(table, row, 2, default_color, self._role_color_button_clicked)
        self._set_delete_button(table, row, 0, self._role_delete_button_clicked)
        self._set_role_permissions_button(row, self._default_role_permissions("", ""))
        self._fit_table_to_contents(table, min_rows=3)
        self._queue_company_autosave("roles", self._autosave_company_roles)

    def _remove_company_role_row(self, row: int | None = None) -> None:
        table = self._company_roles_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row < 0:
            return
        name_item = table.item(row, 1)
        role_meta = dict(name_item.data(Qt.ItemDataRole.UserRole) or {}) if name_item else {}
        role_id = str(role_meta.get("id") or "").strip().lower()
        if role_id in {"owner", "admin", "staff"}:
            QMessageBox.warning(self, "Roles", "Default roles cannot be removed.")
            return
        table.removeRow(row)
        self._apply_compact_row_height(table, row_height=30)
        self._fit_table_to_contents(table, min_rows=3)
        self._refresh_role_permissions_buttons()
        self._queue_company_autosave("roles", self._autosave_company_roles)

    def _save_company_roles(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_roles_table
        if not company_id or table is None:
            return
        rows = []
        used_ids = set()
        for idx in range(table.rowCount()):
            name_item = table.item(idx, 1)
            color_item = table.item(idx, 2)
            name = self._editor_text(table, idx, 1)
            if not name:
                continue
            meta = dict(name_item.data(Qt.ItemDataRole.UserRole) or {}) if name_item else {}
            role_id = str(meta.get("id") or "").strip().lower()
            if not role_id:
                role_id = self._role_slug(name)
            if role_id in used_ids:
                base = role_id
                suffix = 2
                while f"{base}_{suffix}" in used_ids:
                    suffix += 1
                role_id = f"{base}_{suffix}"
            used_ids.add(role_id)
            color = self._read_color_hex(table, idx, 2, "#7D99B3")
            permissions = dict(meta.get("permissions") or {})
            rows.append({"id": role_id, "name": name, "color": color, "permissions": permissions})
        if not rows:
            if not silent_invalid:
                QMessageBox.warning(self, "Roles", "Add at least one role before saving.")
            return
        try:
            self.app.company.update_company(company_id, {"roles": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["roles"] = rows
        if notify:
            QMessageBox.information(self, "Saved", "Roles updated.")
        self._refresh_staff(silent=True)

    def _refresh_company(self, silent: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        try:
            self._company = self.app.company.get_company(company_id) or {}
        except Exception as exc:
            if not silent:
                QMessageBox.critical(self, "Company refresh failed", str(exc))
            return
        self._suspend_company_autosave = True
        try:
            theme = str(self._company.get("themeColor") or "#2F6BFF")
            theme = self._normalize_hex(theme, "#2F6BFF")
            self._company_theme_hex = theme
            self._apply_company_drop_indicator_color(theme)
            if self._company_theme_preview:
                self._company_theme_preview.setStyleSheet(
                    f"QPushButton {{ background: {theme}; border-radius: 8px; border: 1px solid #D7DCE5; }}"
                )
            logo_path = str(self._company.get("logoPath") or "").strip()
            self._company_logo_pending_path = logo_path
            if self._company_logo_input:
                self._company_logo_input.setText(logo_path)
            self._apply_sidebar_branding()
            self._sync_sidebar_user_identity()

            self._load_company_info_fields()
            self._load_company_general_preferences()
            self._load_company_status_rows()
            self._load_company_roles_rows()
            self._load_company_board_thickness_rows()
            self._load_company_board_finishes_rows()
            self._load_company_board_material_usage_rows()
            self._load_company_sheet_sizes_rows()
            self._load_company_part_types_rows()
            self._load_company_hardware_rows()
            self._load_company_item_categories_rows()
            self._load_company_inventory_rows()
            self._load_company_job_types_rows()
            self._load_company_quote_extras_rows()
            self._load_company_sales_discounts()
            self._load_company_quote_template()
            self._load_company_nesting_settings()
            self._load_company_cutlist_columns_rows()
            self._sync_dashboard_stats()
        finally:
            self._suspend_company_autosave = False

    def _load_company_general_preferences(self) -> None:
        name_input = getattr(self, "_company_general_name_input", None)
        currency_combo = getattr(self, "_company_general_currency_combo", None)
        unit_mm = getattr(self, "_company_general_unit_mm", None)
        unit_in = getattr(self, "_company_general_unit_in", None)
        date_combo = getattr(self, "_company_general_date_format_combo", None)
        tz_combo = getattr(self, "_company_general_timezone_combo", None)
        retention_combo = getattr(self, "_company_general_deleted_retention_combo", None)
        if not all([name_input, currency_combo, unit_mm, unit_in, date_combo, tz_combo, retention_combo]):
            return

        name_input.setText(str(self._company.get("name") or ""))

        currency = str(self._company.get("defaultCurrency") or "NZD - New Zealand Dollar").strip()
        idx = currency_combo.findText(currency)
        if idx < 0:
            currency_combo.addItem(currency)
            idx = currency_combo.findText(currency)
        currency_combo.setCurrentIndex(max(0, idx))

        unit = str(self._company.get("measurementUnit") or "mm").strip().lower()
        unit_mm.blockSignals(True)
        unit_in.blockSignals(True)
        unit_mm.setChecked(unit != "inches")
        unit_in.setChecked(unit == "inches")
        unit_mm.blockSignals(False)
        unit_in.blockSignals(False)

        date_fmt = str(self._company.get("dateFormat") or "DD/MM/YYYY").strip()
        idx_df = date_combo.findText(date_fmt)
        if idx_df < 0:
            date_combo.addItem(date_fmt)
            idx_df = date_combo.findText(date_fmt)
        date_combo.setCurrentIndex(max(0, idx_df))

        tz = str(self._company.get("timeZone") or "Pacific/Auckland").strip()
        idx_tz = tz_combo.findText(tz)
        if idx_tz < 0:
            tz_combo.addItem(tz)
            idx_tz = tz_combo.findText(tz)
        tz_combo.setCurrentIndex(max(0, idx_tz))

        retention_days = int(self._company.get("deletedRetentionDays") or 90)
        retention_label = self._deleted_retention_label_from_days(retention_days)
        idx_ret = retention_combo.findText(retention_label)
        if idx_ret < 0:
            retention_combo.addItem(retention_label)
            idx_ret = retention_combo.findText(retention_label)
        retention_combo.setCurrentIndex(max(0, idx_ret))

    def _save_company_general_preferences(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        name_input = getattr(self, "_company_general_name_input", None)
        currency_combo = getattr(self, "_company_general_currency_combo", None)
        unit_mm = getattr(self, "_company_general_unit_mm", None)
        date_combo = getattr(self, "_company_general_date_format_combo", None)
        tz_combo = getattr(self, "_company_general_timezone_combo", None)
        retention_combo = getattr(self, "_company_general_deleted_retention_combo", None)
        if not all([name_input, currency_combo, unit_mm, date_combo, tz_combo, retention_combo]):
            return

        name = str(name_input.text() or "").strip()
        if not name and not silent_invalid:
            QMessageBox.warning(self, "General Settings", "Company name is required.")
            return
        if not name:
            return
        payload = {
            "name": name,
            "defaultCurrency": str(currency_combo.currentText() or "NZD - New Zealand Dollar").strip(),
            "measurementUnit": "mm" if bool(unit_mm.isChecked()) else "inches",
            "dateFormat": str(date_combo.currentText() or "DD/MM/YYYY").strip(),
            "timeZone": self._canonical_timezone_name(str(tz_combo.currentText() or "Pacific/Auckland").strip()),
            "deletedRetentionDays": int(self._deleted_retention_days_from_label(str(retention_combo.currentText() or "3 months"))),
        }
        try:
            self.app.company.update_company(company_id, payload)
        except Exception as exc:
            if not silent_invalid:
                QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company.update(payload)
        self._load_company_info_fields()
        self._apply_sidebar_branding()
        if notify:
            QMessageBox.information(self, "Saved", "General settings updated.")

    def _normalize_hex(self, value: str, default: str = "#2F6BFF") -> str:
        text = str(value or "").strip().upper()
        if not text:
            return default
        if not text.startswith("#"):
            text = "#" + text
        if len(text) != 7:
            return default
        try:
            int(text[1:], 16)
            return text
        except Exception:
            return default

    def _save_company_theme(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        raw = str(self._company_theme_hex or "").strip()
        theme = self._normalize_hex(raw, "")
        if not theme:
            if not silent_invalid:
                QMessageBox.warning(self, "Invalid color", "Use a hex color like #2F6BFF.")
            return

        try:
            if hasattr(self.app.company, "update_company_theme"):
                self.app.company.update_company_theme(company_id, theme)
            else:
                self.app.company.update_company(company_id, {"themeColor": theme})
        except Exception as exc:
            QMessageBox.critical(self, "Theme save failed", str(exc))
            return

        self._company["themeColor"] = theme
        self._company_theme_hex = theme
        self._apply_company_drop_indicator_color(theme)
        self._refresh_production_nav_buttons(True)
        self._refresh_production_nav_buttons(False)
        self._refresh_sales_nav_buttons()
        if self._company_theme_preview:
            self._company_theme_preview.setStyleSheet(
                f"QPushButton {{ background: {theme}; border-radius: 8px; border: 1px solid #D7DCE5; }}"
            )
        if notify:
            QMessageBox.information(self, "Saved", "Theme color updated.")

    def _pick_company_logo(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Choose Company Logo",
            "",
            "Images (*.png *.jpg *.jpeg *.bmp *.webp)",
        )
        path = str(file_path or "").strip()
        if not path:
            return
        self._company_logo_pending_path = path
        if self._company_logo_input:
            self._company_logo_input.setText(path)
        self._save_company_logo(notify=False)

    def _save_company_logo(self, notify: bool = True) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return

        path = str(self._company_logo_pending_path or "").strip()
        if not path and self._company_logo_input:
            path = str(self._company_logo_input.text() or "").strip()
        if not path:
            QMessageBox.warning(self, "No logo selected", "Choose a logo file first.")
            return
        if not Path(path).exists():
            QMessageBox.warning(self, "File not found", "Selected logo file does not exist.")
            return

        saved_logo_path = path
        try:
            if hasattr(self.app.company, "update_company_logo"):
                result = self.app.company.update_company_logo(company_id, path)
                if isinstance(result, str) and result.strip():
                    saved_logo_path = result.strip()
            else:
                self.app.company.update_company(company_id, {"logoPath": path})
        except Exception as exc:
            QMessageBox.critical(self, "Logo upload failed", str(exc))
            return

        self._company["logoPath"] = saved_logo_path
        self._company_logo_pending_path = saved_logo_path
        if self._company_logo_input:
            self._company_logo_input.setText(saved_logo_path)
        self._apply_sidebar_branding()
        if notify:
            QMessageBox.information(self, "Saved", "Company logo updated.")




