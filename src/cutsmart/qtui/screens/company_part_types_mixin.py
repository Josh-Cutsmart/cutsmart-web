from __future__ import annotations

from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QCheckBox, QColorDialog, QComboBox, QHBoxLayout, QMessageBox, QPushButton, QTableWidget, QTableWidgetItem, QWidget

from cutsmart.qtui.screens.dashboard_controls import VComboBox


class CompanyPartTypesMixin:

    def _fit_part_types_table(self) -> None:
        table = self._company_part_types_table
        if table is None:
            return
        self._fit_table_to_contents(table, min_rows=2)

    def _load_company_part_types_rows(self) -> None:
        table = self._company_part_types_table
        if table is None:
            return
        raw = self._company.get("partTypes") or []
        rows = []
        for row in raw:
            if isinstance(row, dict):
                name = str(row.get("name") or "").strip()
                color = self._normalize_hex(
                    str(row.get("color") or row.get("colour") or row.get("hex") or "#3060D0"),
                    "#3060D0",
                )
                cabinetry = bool(row.get("cabinetry"))
                drawer = bool(row.get("drawer"))
                initial_measure = bool(row.get("initialMeasure"))
                include_in_cutlists = bool(row.get("includeInCutlists", row.get("inclInCutlists", True)))
                include_in_nesting = bool(row.get("includeInNesting", row.get("inclInNesting", True)))
                clash_l = str(row.get("clashL") or "").strip()
                clash_s = str(row.get("clashS") or "").strip()
                if (not clash_l or not clash_s) and str(row.get("clashing") or "").strip():
                    parsed_l, parsed_s = self._parse_clashing_pair(str(row.get("clashing") or ""))
                    clash_l = clash_l or parsed_l
                    clash_s = clash_s or parsed_s
                if bool(row.get("autoClash") or row.get("autoclash")) and not clash_l and not clash_s:
                    clash_l = "1L"
                    clash_s = "1S"
            else:
                name = str(row).strip()
                color = "#3060D0"
                cabinetry = False
                drawer = False
                initial_measure = False
                include_in_cutlists = True
                include_in_nesting = True
                clash_l = ""
                clash_s = ""
            if name:
                rows.append({"name": name, "color": color, "cabinetry": cabinetry, "drawer": drawer, "initialMeasure": initial_measure, "includeInCutlists": include_in_cutlists, "includeInNesting": include_in_nesting, "clashL": clash_l, "clashS": clash_s})
        if not rows:
            rows = [
                {"name": "Front", "color": "#D8B96A", "cabinetry": False, "drawer": False, "initialMeasure": True, "includeInCutlists": True, "includeInNesting": True, "clashL": "", "clashS": ""},
                {"name": "Drawer", "color": "#88B8D9", "cabinetry": False, "drawer": True, "initialMeasure": False, "includeInCutlists": True, "includeInNesting": True, "clashL": "", "clashS": ""},
            ]
        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=29)
        for i2, row in enumerate(rows):
            table.setItem(i2, 1, QTableWidgetItem(row["name"]))
            table.setItem(i2, 2, QTableWidgetItem(""))
            table.setItem(i2, 3, QTableWidgetItem(""))
            table.setItem(i2, 4, QTableWidgetItem(""))
            table.setItem(i2, 5, QTableWidgetItem(""))
            table.setItem(i2, 6, QTableWidgetItem(""))
            table.setItem(i2, 7, QTableWidgetItem(""))
            table.setItem(i2, 8, QTableWidgetItem(""))
            self._set_name_editor(table, i2, 1, row["name"], lambda _=None: self._queue_company_autosave("part_types", self._autosave_company_part_types))
            self._set_color_button(table, i2, 2, row["color"], self._part_type_color_button_clicked)
            self._set_part_type_clash_cell(table, i2, 3, str(row.get("clashL") or ""), str(row.get("clashS") or ""))
            self._set_part_type_checkbox(table, i2, 4, bool(row.get("cabinetry")), self._part_type_cabinetry_toggled)
            self._set_part_type_checkbox(table, i2, 5, bool(row.get("drawer")), self._part_type_drawer_toggled)
            self._set_part_type_checkbox(table, i2, 6, bool(row.get("initialMeasure")), self._part_type_initial_measure_toggled)
            self._set_part_type_checkbox(table, i2, 7, bool(row.get("includeInCutlists", True)), self._part_type_include_in_cutlists_toggled)
            self._set_part_type_checkbox(table, i2, 8, bool(row.get("includeInNesting", True)), self._part_type_include_in_nesting_toggled)
            self._set_delete_button(table, i2, 0, self._part_type_delete_button_clicked)
        self._fit_part_types_table()
        # Ensure the final height is recalculated after first paint/layout pass.
        QTimer.singleShot(0, self._fit_part_types_table)

    def _add_company_part_type_row(self) -> None:
        table = self._company_part_types_table
        if table is None:
            return
        default_color = self._normalize_hex(
            str(self._company.get("themeColor") or self._company_theme_hex or "#2F6BFF"),
            "#2F6BFF",
        )
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        table.setItem(row, 2, QTableWidgetItem(""))
        table.setItem(row, 3, QTableWidgetItem(""))
        table.setItem(row, 4, QTableWidgetItem(""))
        table.setItem(row, 5, QTableWidgetItem(""))
        table.setItem(row, 6, QTableWidgetItem(""))
        table.setItem(row, 7, QTableWidgetItem(""))
        table.setItem(row, 8, QTableWidgetItem(""))
        self._set_name_editor(table, row, 1, "", lambda _=None: self._queue_company_autosave("part_types", self._autosave_company_part_types))
        self._set_color_button(table, row, 2, default_color, self._part_type_color_button_clicked)
        self._set_part_type_clash_cell(table, row, 3, "", "")
        self._set_part_type_checkbox(table, row, 4, False, self._part_type_cabinetry_toggled)
        self._set_part_type_checkbox(table, row, 5, False, self._part_type_drawer_toggled)
        self._set_part_type_checkbox(table, row, 6, False, self._part_type_initial_measure_toggled)
        self._set_part_type_checkbox(table, row, 7, True, self._part_type_include_in_cutlists_toggled)
        self._set_part_type_checkbox(table, row, 8, True, self._part_type_include_in_nesting_toggled)
        self._set_delete_button(table, row, 0, self._part_type_delete_button_clicked)
        self._fit_part_types_table()
        self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _part_type_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_part_types_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_part_type_row(row=row)

    def _part_type_color_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_part_types_table
        if table is None:
            return
        row = self._row_from_table_button(table, sender, preferred_col=2)
        if row < 0 or row >= table.rowCount():
            return
        start_color = self._read_color_hex(table, row, 2, "#3060D0")
        picked = QColorDialog.getColor(QColor(start_color), self, "Choose Part Type Color")
        if not picked.isValid():
            return
        new_hex = self._normalize_hex(str(picked.name() or start_color), start_color)
        item = table.item(row, 2)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 2, item)
        item.setData(Qt.ItemDataRole.UserRole, new_hex)
        self._set_color_button(table, row, 2, new_hex, self._part_type_color_button_clicked)
        self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _refresh_part_type_row_widgets(self) -> None:
        table = self._company_part_types_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            name = self._editor_text(table, row, 1)
            self._set_name_editor(table, row, 1, name, lambda _=None: self._queue_company_autosave("part_types", self._autosave_company_part_types))
            color = self._read_color_hex(table, row, 2, "#3060D0")
            self._set_color_button(table, row, 2, color, self._part_type_color_button_clicked)
            cabinetry = self._part_type_checkbox_value(table, row, 4)
            drawer = self._part_type_checkbox_value(table, row, 5)
            initial_measure = self._part_type_checkbox_value(table, row, 6)
            include_in_cutlists = self._part_type_checkbox_value(table, row, 7)
            include_in_nesting = self._part_type_checkbox_value(table, row, 8)
            clash_l, clash_s = self._part_type_clash_values(table, row, 3)
            self._set_part_type_clash_cell(table, row, 3, clash_l, clash_s)
            self._set_part_type_checkbox(table, row, 4, cabinetry, self._part_type_cabinetry_toggled)
            self._set_part_type_checkbox(table, row, 5, drawer, self._part_type_drawer_toggled)
            self._set_part_type_checkbox(table, row, 6, initial_measure, self._part_type_initial_measure_toggled)
            self._set_part_type_checkbox(table, row, 7, include_in_cutlists, self._part_type_include_in_cutlists_toggled)
            self._set_part_type_checkbox(table, row, 8, include_in_nesting, self._part_type_include_in_nesting_toggled)
            self._set_delete_button(table, row, 0, self._part_type_delete_button_clicked)

    def _remove_company_part_type_row(self, row: int | None = None) -> None:
        table = self._company_part_types_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row >= 0:
            table.removeRow(row)
            self._refresh_part_type_row_widgets()
            self._fit_part_types_table()
            self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _save_company_part_types(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_part_types_table
        if not company_id or table is None:
            return
        rows = []
        seen = set()
        for r in range(table.rowCount()):
            name = self._editor_text(table, r, 1)
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            color = self._read_color_hex(table, r, 2, "#3060D0")
            cabinetry = self._part_type_checkbox_value(table, r, 4)
            drawer = self._part_type_checkbox_value(table, r, 5)
            initial_measure = self._part_type_checkbox_value(table, r, 6)
            include_in_cutlists = self._part_type_checkbox_value(table, r, 7)
            include_in_nesting = self._part_type_checkbox_value(table, r, 8)
            clash_l, clash_s = self._part_type_clash_values(table, r, 3)
            auto_clash = bool(str(clash_l or "").strip() or str(clash_s or "").strip())
            rows.append(
                {
                    "name": name,
                    "color": color,
                    "autoClash": auto_clash,
                    "cabinetry": cabinetry,
                    "drawer": drawer,
                    "initialMeasure": initial_measure,
                    "includeInCutlists": include_in_cutlists,
                    "includeInNesting": include_in_nesting,
                    "clashL": str(clash_l or "").strip().upper(),
                    "clashS": str(clash_s or "").strip().upper(),
                }
            )
        if not rows:
            if not silent_invalid:
                QMessageBox.warning(self, "Part Types", "Add at least one part type before saving.")
            return
        try:
            self.app.company.update_company(company_id, {"partTypes": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["partTypes"] = rows
        if notify:
            QMessageBox.information(self, "Saved", "Part types updated.")

    def _set_part_type_checkbox(self, table: QTableWidget, row: int, col: int, checked: bool, on_toggle) -> None:
        cb = QCheckBox()
        cb.setChecked(bool(checked))
        cb.setCursor(Qt.CursorShape.PointingHandCursor)
        cb.toggled.connect(on_toggle)
        item = table.item(row, col)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, col, item)
        item.setData(Qt.ItemDataRole.UserRole, bool(checked))
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(cb, alignment=Qt.AlignmentFlag.AlignCenter)
        table.setCellWidget(row, col, host)

    def _set_part_type_clash_cell(self, table: QTableWidget, row: int, col: int, clash_l: str, clash_s: str) -> None:
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)

        left = VComboBox()
        left.setObjectName("partTypeClashL")
        left.setProperty("hideArrow", True)
        left.setCursor(Qt.CursorShape.PointingHandCursor)
        left.addItem("")
        left.addItem("1L")
        left.addItem("2L")
        right = VComboBox()
        right.setObjectName("partTypeClashS")
        right.setProperty("hideArrow", True)
        right.setCursor(Qt.CursorShape.PointingHandCursor)
        right.addItem("")
        right.addItem("1S")
        right.addItem("2S")
        left.setFixedHeight(24)
        right.setFixedHeight(24)
        left.setFixedWidth(42)
        right.setFixedWidth(42)
        combo_style = (
            "QComboBox {"
            "background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; padding: 2px 8px; font-size: 12px; color:#1F2937;"
            "}"
            "QComboBox:focus { border:1px solid #AFC2DA; }"
            "QComboBox::drop-down { border:none; width:0px; }"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
        )
        left.setStyleSheet(combo_style)
        right.setStyleSheet(combo_style)

        idx_l = left.findText(str(clash_l or "").strip().upper())
        left.setCurrentIndex(idx_l if idx_l >= 0 else 0)
        idx_s = right.findText(str(clash_s or "").strip().upper())
        right.setCurrentIndex(idx_s if idx_s >= 0 else 0)

        left.currentIndexChanged.connect(lambda _=None: self._queue_company_autosave("part_types", self._autosave_company_part_types))
        right.currentIndexChanged.connect(lambda _=None: self._queue_company_autosave("part_types", self._autosave_company_part_types))

        lay.addWidget(left)
        lay.addWidget(right)
        lay.addStretch(1)

        item = table.item(row, col)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, col, item)
        item.setData(Qt.ItemDataRole.UserRole, {"l": str(left.currentText() or ""), "s": str(right.currentText() or "")})
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _part_type_checkbox_value(self, table: QTableWidget, row: int, col: int) -> bool:
        w = table.cellWidget(row, col)
        if isinstance(w, QWidget):
            cb = w.findChild(QCheckBox)
            if isinstance(cb, QCheckBox):
                return bool(cb.isChecked())
        item = table.item(row, col)
        if item is not None:
            return bool(item.data(Qt.ItemDataRole.UserRole))
        return False

    def _part_type_clash_values(self, table: QTableWidget, row: int, col: int) -> tuple[str, str]:
        w = table.cellWidget(row, col)
        if isinstance(w, QWidget):
            l_combo = w.findChild(QComboBox, "partTypeClashL")
            s_combo = w.findChild(QComboBox, "partTypeClashS")
            l_val = str(l_combo.currentText()).strip() if isinstance(l_combo, QComboBox) else ""
            s_val = str(s_combo.currentText()).strip() if isinstance(s_combo, QComboBox) else ""
            return l_val, s_val
        item = table.item(row, col)
        if item is not None:
            raw = item.data(Qt.ItemDataRole.UserRole)
            if isinstance(raw, dict):
                return str(raw.get("l") or "").strip(), str(raw.get("s") or "").strip()
        return "", ""

    def _row_from_table_checkbox(self, table: QTableWidget | None, checkbox: QCheckBox, preferred_col: int | None = None) -> int:
        if table is None:
            return -1
        cols = [preferred_col] if isinstance(preferred_col, int) and preferred_col >= 0 else list(range(table.columnCount()))
        if preferred_col is not None:
            cols.extend(c for c in range(table.columnCount()) if c not in cols)
        for row in range(table.rowCount()):
            for col in cols:
                host = table.cellWidget(row, col)
                if not isinstance(host, QWidget):
                    continue
                if host is checkbox:
                    return row
                if checkbox in host.findChildren(QCheckBox):
                    return row
        return -1

    def _part_type_cabinetry_toggled(self, checked: bool) -> None:
        sender = self.sender()
        if not isinstance(sender, QCheckBox):
            return
        table = self._company_part_types_table
        row = self._row_from_table_checkbox(table, sender, preferred_col=4)
        if row < 0 or table is None:
            return
        item = table.item(row, 4)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 4, item)
        item.setData(Qt.ItemDataRole.UserRole, bool(checked))
        self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _part_type_drawer_toggled(self, checked: bool) -> None:
        sender = self.sender()
        if not isinstance(sender, QCheckBox):
            return
        table = self._company_part_types_table
        row = self._row_from_table_checkbox(table, sender, preferred_col=5)
        if row < 0 or table is None:
            return
        item = table.item(row, 5)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 5, item)
        item.setData(Qt.ItemDataRole.UserRole, bool(checked))
        self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _part_type_include_in_cutlists_toggled(self, checked: bool) -> None:
        sender = self.sender()
        if not isinstance(sender, QCheckBox):
            return
        table = self._company_part_types_table
        row = self._row_from_table_checkbox(table, sender, preferred_col=7)
        if row < 0 or table is None:
            return
        item = table.item(row, 7)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 7, item)
        item.setData(Qt.ItemDataRole.UserRole, bool(checked))
        self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _part_type_include_in_nesting_toggled(self, checked: bool) -> None:
        sender = self.sender()
        if not isinstance(sender, QCheckBox):
            return
        table = self._company_part_types_table
        row = self._row_from_table_checkbox(table, sender, preferred_col=8)
        if row < 0 or table is None:
            return
        item = table.item(row, 8)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 8, item)
        item.setData(Qt.ItemDataRole.UserRole, bool(checked))
        self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _part_type_initial_measure_toggled(self, checked: bool) -> None:
        sender = self.sender()
        if not isinstance(sender, QCheckBox):
            return
        table = self._company_part_types_table
        row = self._row_from_table_checkbox(table, sender, preferred_col=6)
        if row < 0 or table is None:
            return
        item = table.item(row, 6)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 6, item)
        item.setData(Qt.ItemDataRole.UserRole, bool(checked))
        self._queue_company_autosave("part_types", self._autosave_company_part_types)

    def _parse_clashing_pair(self, value: str) -> tuple[str, str]:
        text = str(value or "").strip().upper()
        l_val = ""
        s_val = ""
        for token in text.replace(",", " ").split():
            tok = token.strip()
            if tok in ("1L", "2L"):
                l_val = tok
            elif tok in ("1S", "2S"):
                s_val = tok
            elif tok in ("1SH", "2SH"):
                s_val = tok.replace("SH", "S")
        return l_val, s_val
