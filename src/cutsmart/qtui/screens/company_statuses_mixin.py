from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QMessageBox, QTableWidget, QTableWidgetItem


class CompanyStatusesMixin:

    def _fit_table_to_contents(self, table: QTableWidget, min_rows: int = 1) -> None:
        if table is None:
            return
        compact = bool(table.property("compactRows"))
        if compact:
            min_compact_h = 29
            base_h = max(min_compact_h, int(table.verticalHeader().defaultSectionSize() or min_compact_h))
            for r in range(table.rowCount()):
                hint_h = int(table.sizeHintForRow(r) or 0)
                row_h = max(base_h, hint_h + 2)
                table.setRowHeight(r, row_h)
            table.verticalHeader().setDefaultSectionSize(base_h)
        else:
            table.resizeRowsToContents()
        header_h = table.horizontalHeader().height() if table.horizontalHeader().isVisible() else 0
        rows = table.rowCount()
        visible_rows = max(int(min_rows), rows)
        row_total = 0
        for r in range(rows):
            h = int(table.rowHeight(r) or 0)
            hint_h = int(table.sizeHintForRow(r) or 0)
            eff_h = max(h, hint_h + 2, int(table.verticalHeader().defaultSectionSize() or 0))
            row_total += eff_h
        if rows < visible_rows:
            row_total += (visible_rows - rows) * table.verticalHeader().defaultSectionSize()
        frame = table.frameWidth() * 2 + 4
        # Keep a small safety buffer so the last row never clips in styled cards.
        slack = 28 if compact else 6
        total_h = header_h + row_total + frame + slack
        table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        table.setMinimumHeight(total_h)
        table.setMaximumHeight(total_h)
        table.updateGeometry()
        parent = table.parentWidget()
        while parent is not None:
            lay = parent.layout()
            if lay is not None:
                lay.activate()
            parent.updateGeometry()
            parent = parent.parentWidget()

    def _load_company_status_rows(self) -> None:
        if not self._company_status_table:
            return

        rows = self._company.get("projectStatuses") or []
        cleaned = []
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            color = self._normalize_hex(str(row.get("color") or "#3060D0"), "#3060D0")
            cleaned.append({"name": name, "color": color})

        if not cleaned:
            cleaned = [
                {"name": "New", "color": "#3060D0"},
                {"name": "Running", "color": "#2A7A3B"},
                {"name": "Completed", "color": "#2A7A3B"},
            ]

        table = self._company_status_table
        table.setRowCount(len(cleaned))
        self._apply_compact_row_height(table, row_height=30)
        for idx, row in enumerate(cleaned):
            name_item = QTableWidgetItem(row["name"])
            color_item = QTableWidgetItem(row["color"])
            table.setItem(idx, 1, name_item)
            table.setItem(idx, 2, color_item)
            self._set_name_editor(table, idx, 1, row["name"], lambda _=None: self._queue_company_autosave("statuses", self._autosave_company_statuses))
            self._set_color_button(table, idx, 2, row["color"], self._status_color_button_clicked)
            self._set_delete_button(table, idx, 0, self._status_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=3)

    def _add_company_status_row(self) -> None:
        if not self._company_status_table:
            return
        default_color = self._normalize_hex(
            str(self._company.get("themeColor") or self._company_theme_hex or "#2F6BFF"),
            "#2F6BFF",
        )
        row = self._company_status_table.rowCount()
        self._company_status_table.insertRow(row)
        self._apply_compact_row_height(self._company_status_table, row_height=29)
        self._company_status_table.setItem(row, 1, QTableWidgetItem(""))
        self._company_status_table.setItem(row, 2, QTableWidgetItem(""))
        self._set_name_editor(self._company_status_table, row, 1, "", lambda _=None: self._queue_company_autosave("statuses", self._autosave_company_statuses))
        self._set_color_button(self._company_status_table, row, 2, default_color, self._status_color_button_clicked)
        self._set_delete_button(self._company_status_table, row, 0, self._status_delete_button_clicked)
        self._fit_table_to_contents(self._company_status_table, min_rows=3)
        self._queue_company_autosave("statuses", self._autosave_company_statuses)

    def _remove_company_status_row(self, row: int | None = None) -> None:
        if not self._company_status_table:
            return
        row = self._company_status_table.currentRow() if row is None else int(row)
        if row >= 0:
            name = self._editor_text(self._company_status_table, row, 1).lower()
            if name in {"complete", "completed"}:
                QMessageBox.warning(self, "Project Statuses", "Complete status cannot be deleted.")
                return
            self._company_status_table.removeRow(row)
            self._apply_compact_row_height(self._company_status_table, row_height=29)
            self._refresh_status_row_widgets()
            self._fit_table_to_contents(self._company_status_table, min_rows=3)
            self._queue_company_autosave("statuses", self._autosave_company_statuses)

    def _save_company_statuses(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_status_table
        if not company_id or not table:
            return

        rows = []
        seen = set()
        for idx in range(table.rowCount()):
            color_item = table.item(idx, 2)
            name = self._editor_text(table, idx, 1)
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            color = self._read_color_hex(table, idx, 2, "#3060D0")
            rows.append({"name": name, "color": color})

        if not rows:
            if not silent_invalid:
                QMessageBox.warning(self, "Missing statuses", "Add at least one status before saving.")
            return

        try:
            self.app.company.update_company(company_id, {"projectStatuses": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return

        self._company["projectStatuses"] = rows
        self._refresh_projects_status_options()
        if notify:
            QMessageBox.information(self, "Saved", "Project statuses updated.")

    def _refresh_status_row_widgets(self) -> None:
        table = self._company_status_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            name = self._editor_text(table, row, 1)
            self._set_name_editor(table, row, 1, name, lambda _=None: self._queue_company_autosave("statuses", self._autosave_company_statuses))
            color_hex = self._read_color_hex(table, row, 2, "#3060D0")
            self._set_color_button(table, row, 2, color_hex, self._status_color_button_clicked)
            self._set_delete_button(table, row, 0, self._status_delete_button_clicked)

