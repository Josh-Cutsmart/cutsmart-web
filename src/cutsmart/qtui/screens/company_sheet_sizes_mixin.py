from __future__ import annotations

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import QCheckBox, QHBoxLayout, QMessageBox, QPushButton, QTableWidgetItem, QWidget


class CompanySheetSizesMixin:

    def _load_company_sheet_sizes_rows(self) -> None:
        table = self._company_sheet_sizes_table
        if table is None:
            return
        raw = self._company.get("sheetSizes") or []
        rows = []
        for item in raw:
            h = ""
            w = ""
            is_default = False
            if isinstance(item, dict):
                h = str(item.get("h") or item.get("height") or "").strip()
                w = str(item.get("w") or item.get("width") or "").strip()
                is_default = bool(item.get("default"))
            else:
                text = str(item).strip()
                if "x" in text.lower():
                    parts = text.lower().replace(" ", "").split("x", 1)
                    if len(parts) == 2:
                        h = parts[0].strip()
                        w = parts[1].strip()
            if h and w:
                rows.append({"h": h, "w": w, "default": is_default})
        if not rows:
            rows = [{"h": "2440", "w": "1220", "default": False}]
        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=29)
        default_row = -1
        for i2, row in enumerate(rows):
            table.setItem(i2, 1, QTableWidgetItem(str(row["h"])))
            table.setItem(i2, 2, QTableWidgetItem(str(row["w"])))
            default_item = QTableWidgetItem("")
            default_item.setData(Qt.ItemDataRole.UserRole, bool(row.get("default")))
            table.setItem(i2, 3, default_item)
            if bool(row.get("default")) and default_row < 0:
                default_row = i2
            self._set_thickness_editor(table, i2, 1, str(row["h"]), lambda _=None: self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes))
            self._set_thickness_editor(table, i2, 2, str(row["w"]), lambda _=None: self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes))
            self._set_delete_button(table, i2, 0, self._sheet_size_delete_button_clicked)
        self._set_sheet_sizes_default_row(default_row, queue_save=False)
        self._fit_sheet_sizes_table_to_contents()

    def _add_company_sheet_size_row(self) -> None:
        table = self._company_sheet_sizes_table
        if table is None:
            return
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        table.setItem(row, 2, QTableWidgetItem(""))
        default_item = QTableWidgetItem("")
        default_item.setData(Qt.ItemDataRole.UserRole, False)
        table.setItem(row, 3, default_item)
        self._set_thickness_editor(table, row, 1, "", lambda _=None: self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes))
        self._set_thickness_editor(table, row, 2, "", lambda _=None: self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes))
        self._set_delete_button(table, row, 0, self._sheet_size_delete_button_clicked)
        self._refresh_sheet_sizes_default_widgets()
        self._fit_sheet_sizes_table_to_contents()
        self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes)

    def _sheet_size_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_sheet_sizes_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_sheet_size_row(row=row)

    def _refresh_sheet_sizes_row_widgets(self) -> None:
        table = self._company_sheet_sizes_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            h = self._editor_text(table, row, 1)
            w = self._editor_text(table, row, 2)
            self._set_thickness_editor(table, row, 1, h, lambda _=None: self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes))
            self._set_thickness_editor(table, row, 2, w, lambda _=None: self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes))
            self._set_delete_button(table, row, 0, self._sheet_size_delete_button_clicked)
            if table.item(row, 3) is None:
                item = QTableWidgetItem("")
                item.setData(Qt.ItemDataRole.UserRole, False)
                table.setItem(row, 3, item)
        self._refresh_sheet_sizes_default_widgets()

    def _remove_company_sheet_size_row(self, row: int | None = None) -> None:
        table = self._company_sheet_sizes_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row >= 0:
            table.removeRow(row)
            self._refresh_sheet_sizes_row_widgets()
            self._fit_sheet_sizes_table_to_contents()
            self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes)

    def _sheet_size_default_toggled(self, row: int, checked: bool) -> None:
        if checked:
            self._set_sheet_sizes_default_row(row, queue_save=True)
            return
        table = self._company_sheet_sizes_table
        if table is None:
            return
        item = table.item(row, 3)
        if item is not None and bool(item.data(Qt.ItemDataRole.UserRole)):
            self._set_sheet_sizes_default_row(-1, queue_save=True)
        else:
            self._refresh_sheet_sizes_default_widgets()

    def _set_sheet_sizes_default_row(self, row: int, queue_save: bool = False) -> None:
        table = self._company_sheet_sizes_table
        if table is None:
            return
        selected_row = int(row)
        if selected_row < 0 or selected_row >= table.rowCount():
            selected_row = -1
        for r in range(table.rowCount()):
            item = table.item(r, 3)
            if item is None:
                item = QTableWidgetItem("")
                table.setItem(r, 3, item)
            item.setData(Qt.ItemDataRole.UserRole, r == selected_row)
        self._refresh_sheet_sizes_default_widgets()
        if queue_save:
            self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes)

    def _refresh_sheet_sizes_default_widgets(self) -> None:
        table = self._company_sheet_sizes_table
        if table is None:
            return
        default_row = -1
        for r in range(table.rowCount()):
            item = table.item(r, 3)
            if item is not None and bool(item.data(Qt.ItemDataRole.UserRole)):
                default_row = r
                break
        for r in range(table.rowCount()):
            show_checkbox = (default_row < 0) or (r == default_row)
            host = QWidget()
            lay = QHBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(0)
            if show_checkbox:
                cb = QCheckBox()
                cb.setChecked(r == default_row)
                cb.setCursor(Qt.CursorShape.PointingHandCursor)
                cb.toggled.connect(lambda checked, rr=r: self._sheet_size_default_toggled(rr, checked))
                lay.addWidget(cb, alignment=Qt.AlignmentFlag.AlignCenter)
            table.setCellWidget(r, 3, host)
        self._fit_sheet_sizes_table_to_contents()

    def _fit_sheet_sizes_table_to_contents(self) -> None:
        table = self._company_sheet_sizes_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        header_h = 0
        if table.horizontalHeader().isVisible():
            header = table.horizontalHeader()
            header_h = max(header.height(), header.sizeHint().height(), 26)
        rows = table.rowCount()
        visible_rows = max(3, rows + 1)
        row_total = 0
        for r in range(rows):
            h = table.rowHeight(r)
            row_total += h if h > 0 else table.verticalHeader().defaultSectionSize()
        if rows < visible_rows:
            row_total += (visible_rows - rows) * table.verticalHeader().defaultSectionSize()
        frame = table.frameWidth() * 2 + 8
        total_h = header_h + row_total + frame
        table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        table.setMinimumHeight(total_h)
        table.setMaximumHeight(total_h)

        def _apply_late() -> None:
            if table is None:
                return
            late_header_h = 0
            if table.horizontalHeader().isVisible():
                hdr = table.horizontalHeader()
                late_header_h = max(hdr.height(), hdr.sizeHint().height(), 26)
            late_rows_h = 0
            for rr in range(table.rowCount()):
                rh = table.rowHeight(rr)
                late_rows_h += rh if rh > 0 else table.verticalHeader().defaultSectionSize()
            late_rows = table.rowCount()
            late_visible_rows = max(3, late_rows + 1)
            if late_rows < late_visible_rows:
                late_rows_h += (late_visible_rows - late_rows) * table.verticalHeader().defaultSectionSize()
            late_total = late_header_h + late_rows_h + frame
            table.setMinimumHeight(late_total)
            table.setMaximumHeight(late_total)

        QTimer.singleShot(0, _apply_late)

    def _save_company_sheet_sizes(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_sheet_sizes_table
        if not company_id or table is None:
            return
        rows = []
        seen = set()
        default_row = -1
        for r in range(table.rowCount()):
            item = table.item(r, 3)
            if item is not None and bool(item.data(Qt.ItemDataRole.UserRole)):
                default_row = r
                break
        for r in range(table.rowCount()):
            h_text = self._editor_text(table, r, 1)
            w_text = self._editor_text(table, r, 2)
            if not h_text or not w_text:
                continue
            try:
                h = int(float(h_text))
                w = int(float(w_text))
            except Exception:
                continue
            if h <= 0 or w <= 0:
                continue
            key = f"{h}x{w}"
            if key in seen:
                continue
            seen.add(key)
            rows.append({"h": h, "w": w, "default": (r == default_row)})
        if not rows:
            if not silent_invalid:
                QMessageBox.warning(self, "Sheet Sizes", "Add at least one valid sheet size.")
            return
        try:
            self.app.company.update_company(company_id, {"sheetSizes": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["sheetSizes"] = rows
        if notify:
            QMessageBox.information(self, "Saved", "Sheet sizes updated.")
