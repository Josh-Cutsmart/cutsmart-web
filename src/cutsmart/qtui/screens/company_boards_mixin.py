from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QInputDialog, QMessageBox, QPushButton, QTableWidgetItem


class CompanyBoardsMixin:

    def _refresh_project_board_colour_suggestions(self) -> None:
        getter = getattr(self, "_company_board_colour_suggestions", None)
        if not callable(getter):
            return
        suggestions = getter()
        panels = []
        for panel in (
            getattr(self, "_detail_embedded_board_settings", None),
            getattr(self, "_dashboard_embedded_board_settings", None),
        ):
            if panel is not None:
                panels.append(panel)
        for dlg in (getattr(self, "_open_project_settings_dialogs", None) or []):
            if dlg is not None:
                panels.append(dlg)
        seen = set()
        for panel in panels:
            pid = id(panel)
            if pid in seen:
                continue
            seen.add(pid)
            updater = getattr(panel, "set_board_colour_suggestions", None)
            if callable(updater):
                try:
                    updater(list(suggestions))
                except Exception:
                    pass

    def _add_company_board_material_usage_row(self) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        value, ok = QInputDialog.getText(self, "Add Colour Memory", "Colour:")
        if not ok:
            return
        colour = str(value or "").strip()
        if not colour:
            return

        raw = (self._company or {}).get("boardMaterialUsage") or {}
        if isinstance(raw, dict):
            colours = raw.get("colours") if isinstance(raw.get("colours"), list) else []
            rows: list[dict] = []
            exists = False
            for entry in colours:
                if not isinstance(entry, dict):
                    continue
                row_value = str(entry.get("value") or "").strip()
                if not row_value:
                    continue
                if self._part_key(row_value) == self._part_key(colour):
                    exists = True
                rows.append(dict(entry))
            if exists:
                return
            rows.append({"value": colour, "count": 0})
            rows.sort(key=lambda item: (-int(item.get("count") or 0), str(item.get("value") or "").lower()))
            next_usage = dict(raw)
            next_usage["colours"] = rows
        else:
            # Legacy fallback structure.
            rows = [dict(entry) for entry in (raw or []) if isinstance(entry, dict)]
            if any(self._part_key(str(r.get("colour") or r.get("color") or "")) == self._part_key(colour) for r in rows):
                return
            rows.append({"colour": colour, "count": 0})
            next_usage = rows

        try:
            self.app.company.update_company(company_id, {"boardMaterialUsage": next_usage})
        except Exception:
            return
        if isinstance(self._company, dict):
            self._company["boardMaterialUsage"] = next_usage
        self._load_company_board_material_usage_rows()
        self._refresh_project_board_colour_suggestions()

    def _load_company_board_material_usage_rows(self) -> None:
        table = getattr(self, "_company_board_material_usage_table", None)
        if table is None:
            return
        raw = (self._company or {}).get("boardMaterialUsage") or {}

        def _rows(group: str) -> list[dict]:
            src = raw.get(group) if isinstance(raw, dict) else None
            if not isinstance(src, list):
                return []
            out: list[dict] = []
            for row in src:
                if not isinstance(row, dict):
                    continue
                value = str(row.get("value") or "").strip()
                try:
                    count = int(row.get("count") or 0)
                except Exception:
                    count = 0
                if not value or count < 0:
                    continue
                out.append({"value": value, "count": count})
            out.sort(key=lambda item: (-int(item.get("count") or 0), str(item.get("value") or "").lower()))
            return out

        if not isinstance(raw, dict):
            # Legacy fallback.
            legacy_colours: dict[str, int] = {}
            for row in (raw or []):
                if not isinstance(row, dict):
                    continue
                try:
                    count = int(row.get("count") or 0)
                except Exception:
                    count = 0
                if count < 0:
                    continue
                c = str(row.get("colour") or row.get("color") or "").strip()
                if c:
                    legacy_colours[c] = int(legacy_colours.get(c, 0)) + count
            colours = [{"value": k, "count": v} for k, v in legacy_colours.items()]
            colours.sort(key=lambda item: (-int(item.get("count") or 0), str(item.get("value") or "").lower()))
        else:
            colours = _rows("colours")
        row_count = len(colours)
        table.setRowCount(row_count)
        self._apply_compact_row_height(table, row_height=29)
        for i2 in range(row_count):
            colour = colours[i2] if i2 < len(colours) else {}
            value = str(colour.get("value") or "")
            table.setItem(i2, 1, QTableWidgetItem(value))
            colour_count = QTableWidgetItem(str(colour.get("count") or ""))
            colour_count.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            table.setItem(i2, 2, colour_count)
            self._set_delete_button(table, i2, 0, self._board_material_usage_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=3)

    def _board_material_usage_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = getattr(self, "_company_board_material_usage_table", None)
        if table is None:
            return
        row = self._row_from_table_button(table, sender, preferred_col=0)
        if row < 0:
            return
        colour_item = table.item(row, 1)
        colour_value = str(colour_item.text() if colour_item is not None else "").strip()
        if not colour_value:
            return
        confirm = QMessageBox.question(
            self,
            "Delete Colour Memory",
            f"Remove '{colour_value}' from material usage memory?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if confirm != QMessageBox.StandardButton.Yes:
            return
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return

        raw = (self._company or {}).get("boardMaterialUsage") or {}
        if isinstance(raw, dict):
            colours = raw.get("colours") if isinstance(raw.get("colours"), list) else []
            filtered = []
            for entry in colours:
                if not isinstance(entry, dict):
                    continue
                value = str(entry.get("value") or "").strip()
                if not value:
                    continue
                if self._part_key(value) == self._part_key(colour_value):
                    continue
                filtered.append(dict(entry))
            next_usage = dict(raw)
            next_usage["colours"] = filtered
        else:
            # Legacy fallback
            filtered_rows = []
            for entry in (raw or []):
                if not isinstance(entry, dict):
                    continue
                value = str(entry.get("colour") or entry.get("color") or "").strip()
                if value and self._part_key(value) == self._part_key(colour_value):
                    continue
                filtered_rows.append(dict(entry))
            next_usage = filtered_rows

        try:
            self.app.company.update_company(company_id, {"boardMaterialUsage": next_usage})
        except Exception:
            return
        if isinstance(self._company, dict):
            self._company["boardMaterialUsage"] = next_usage
        self._load_company_board_material_usage_rows()
        self._refresh_project_board_colour_suggestions()

    def _load_company_board_thickness_rows(self) -> None:
        table = self._company_board_table
        if table is None:
            return
        raw = self._company.get("boardThicknesses") or []
        vals = []
        for item in raw:
            text = str(item).strip()
            if text:
                vals.append(text)
        if not vals:
            vals = ["16", "18", "25"]
        table.setRowCount(len(vals))
        self._apply_compact_row_height(table, row_height=29)
        for i2, val in enumerate(vals):
            table.setItem(i2, 1, QTableWidgetItem(str(val)))
            self._set_thickness_editor(table, i2, 1, str(val), lambda _=None: self._queue_company_autosave("board_thickness", self._autosave_company_board_thicknesses))
            self._set_delete_button(table, i2, 0, self._board_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=3)

    def _add_company_board_thickness_row(self) -> None:
        table = self._company_board_table
        if table is None:
            return
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        self._set_thickness_editor(table, row, 1, "", lambda _=None: self._queue_company_autosave("board_thickness", self._autosave_company_board_thicknesses))
        self._set_delete_button(table, row, 0, self._board_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=3)
        self._queue_company_autosave("board_thickness", self._autosave_company_board_thicknesses)

    def _board_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_board_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_board_thickness_row(row=row)

    def _refresh_board_row_widgets(self) -> None:
        table = self._company_board_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            text = self._editor_text(table, row, 1)
            self._set_thickness_editor(table, row, 1, text, lambda _=None: self._queue_company_autosave("board_thickness", self._autosave_company_board_thicknesses))
            self._set_delete_button(table, row, 0, self._board_delete_button_clicked)

    def _remove_company_board_thickness_row(self, row: int | None = None) -> None:
        table = self._company_board_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row >= 0:
            table.removeRow(row)
            self._refresh_board_row_widgets()
            self._fit_table_to_contents(table, min_rows=3)
            self._queue_company_autosave("board_thickness", self._autosave_company_board_thicknesses)

    def _save_company_board_thicknesses(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_board_table
        if not company_id or table is None:
            return
        vals = []
        seen = set()
        for r in range(table.rowCount()):
            text = self._editor_text(table, r, 1)
            if not text:
                continue
            try:
                iv = int(float(text))
            except Exception:
                continue
            if iv <= 0 or iv in seen:
                continue
            seen.add(iv)
            vals.append(iv)
        if not vals:
            if not silent_invalid:
                QMessageBox.warning(self, "Board Thicknesses", "Add at least one valid thickness.")
            return
        try:
            self.app.company.update_company(company_id, {"boardThicknesses": vals})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["boardThicknesses"] = vals
        if notify:
            QMessageBox.information(self, "Saved", "Board thicknesses updated.")

    def _load_company_board_finishes_rows(self) -> None:
        table = self._company_board_finishes_table
        if table is None:
            return
        raw = self._company.get("boardFinishes") or []
        vals = []
        for item in raw:
            text = str(item).strip()
            if text:
                vals.append(text)
        if not vals:
            vals = ["Satin"]
        table.setRowCount(len(vals))
        self._apply_compact_row_height(table, row_height=29)
        for i2, val in enumerate(vals):
            table.setItem(i2, 1, QTableWidgetItem(str(val)))
            self._set_name_editor(table, i2, 1, str(val), lambda _=None: self._queue_company_autosave("board_finishes", self._autosave_company_board_finishes))
            self._set_delete_button(table, i2, 0, self._board_finish_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=3)

    def _add_company_board_finish_row(self) -> None:
        table = self._company_board_finishes_table
        if table is None:
            return
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        self._set_name_editor(table, row, 1, "", lambda _=None: self._queue_company_autosave("board_finishes", self._autosave_company_board_finishes))
        self._set_delete_button(table, row, 0, self._board_finish_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=3)
        self._queue_company_autosave("board_finishes", self._autosave_company_board_finishes)

    def _board_finish_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_board_finishes_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_board_finish_row(row=row)

    def _refresh_board_finishes_row_widgets(self) -> None:
        table = self._company_board_finishes_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            text = self._editor_text(table, row, 1)
            self._set_name_editor(table, row, 1, text, lambda _=None: self._queue_company_autosave("board_finishes", self._autosave_company_board_finishes))
            self._set_delete_button(table, row, 0, self._board_finish_delete_button_clicked)

    def _remove_company_board_finish_row(self, row: int | None = None) -> None:
        table = self._company_board_finishes_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row >= 0:
            table.removeRow(row)
            self._refresh_board_finishes_row_widgets()
            self._fit_table_to_contents(table, min_rows=3)
            self._queue_company_autosave("board_finishes", self._autosave_company_board_finishes)

    def _save_company_board_finishes(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_board_finishes_table
        if not company_id or table is None:
            return
        vals = []
        seen = set()
        for r in range(table.rowCount()):
            text = self._editor_text(table, r, 1)
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            vals.append(text)
        if not vals:
            if not silent_invalid:
                QMessageBox.warning(self, "Board Finishes", "Add at least one board finish.")
            return
        try:
            self.app.company.update_company(company_id, {"boardFinishes": vals})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["boardFinishes"] = vals
        if notify:
            QMessageBox.information(self, "Saved", "Board finishes updated.")


