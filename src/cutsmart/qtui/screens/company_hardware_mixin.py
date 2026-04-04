from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QCheckBox, QColorDialog, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPushButton, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget

from cutsmart.qtui.screens.hardware_dialogs import HardwareCategoryDialog


class CompanyHardwareMixin:
    _HARDWARE_ROW_HEIGHT = 44

    @staticmethod
    def _hardware_text_color_for_bg(bg_hex: str) -> str:
        c = QColor(str(bg_hex or "").strip())
        if not c.isValid():
            c = QColor("#7D99B3")
        return "#FFFFFF" if c.lightness() < 150 else "#111827"

    def _set_hardware_left_controls(self, table: QTableWidget, row: int, color_hex: str | None = None) -> None:
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(10, 4, 6, 4)
        lay.setSpacing(6)
        base = QColor(self._normalize_hex(str(color_hex or "#7D99B3"), "#7D99B3"))
        text_fg = self._hardware_text_color_for_bg(base.name())
        del_btn = QPushButton("X")
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setFixedSize(24, 24)
        del_btn.setProperty("row", row)
        del_btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        del_btn.clicked.connect(self._hardware_delete_button_clicked)

        expanded = self._hardware_row_is_expanded(row)
        exp_btn = QPushButton("-" if expanded else "+")
        exp_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        exp_btn.setProperty("row", row)
        exp_btn.setFixedSize(26, 26)
        btn_bg = base.lighter(138).name()
        btn_bd = base.darker(112).name()
        btn_fg = self._hardware_text_color_for_bg(base.name())
        btn_hover = QColor(btn_bg).darker(106).name()
        exp_btn.setStyleSheet(
            "QPushButton {"
            f"color: {btn_fg}; background: {btn_bg}; border: 1px solid {btn_bd}; border-radius: 8px;"
            "font-size: 18px; font-weight: 800; padding: 0 0 7px 2px; text-align: center;"
            "}"
            f"QPushButton:hover {{ background: {btn_hover}; border: 1px solid {QColor(btn_bd).darker(104).name()}; }}"
        )
        exp_btn.clicked.connect(self._hardware_expand_button_clicked)

        drag_lbl = QLabel("|||")
        drag_lbl.setStyleSheet(
            f"QLabel {{ color:{text_fg}; background: transparent; border: none; font-size: 12px; font-weight: 800; }}"
        )

        lay.addWidget(del_btn, 0, Qt.AlignmentFlag.AlignVCenter)
        lay.addWidget(exp_btn, 0, Qt.AlignmentFlag.AlignVCenter)
        lay.addWidget(drag_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
        lay.addStretch(1)
        table.setCellWidget(row, 0, host)

    def _hardware_row_is_expanded(self, row: int) -> bool:
        detail_row = self._hardware_detail_row_index()
        return detail_row >= 0 and int(detail_row - 1) == int(row)

    def _set_hardware_expand_button(self, table: QTableWidget, row: int, color_hex: str | None = None) -> None:
        expanded = self._hardware_row_is_expanded(row)
        btn = QPushButton("-" if expanded else "+")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setProperty("row", row)
        btn.setFixedSize(26, 26)
        base = QColor(self._normalize_hex(str(color_hex or "#7D99B3"), "#7D99B3"))
        btn_bg = base.lighter(138).name()
        btn_bd = base.darker(112).name()
        btn_fg = self._hardware_text_color_for_bg(base.name())
        btn_hover = QColor(btn_bg).darker(106).name()
        btn.setStyleSheet(
            "QPushButton {"
            f"color: {btn_fg}; background: {btn_bg}; border: 1px solid {btn_bd}; border-radius: 8px;"
            "font-size: 18px; font-weight: 800; padding: 0 0 7px 2px; text-align: center;"
            "}"
            f"QPushButton:hover {{ background: {btn_hover}; border: 1px solid {QColor(btn_bd).darker(104).name()}; }}"
        )
        btn.clicked.connect(self._hardware_expand_button_clicked)
        # Legacy path; expand/collapse now lives in the left controls area.
        table.setCellWidget(row, 0, self._wrap_table_control(btn))

    def _apply_hardware_row_theme(self, table: QTableWidget, row: int, color_hex: str) -> None:
        bg = self._normalize_hex(color_hex, "#7D99B3")
        fg = self._hardware_text_color_for_bg(bg)
        row_border = QColor(bg).darker(112).name()
        for col in range(table.columnCount()):
            item = table.item(row, col)
            if item is None:
                item = QTableWidgetItem("")
                table.setItem(row, col, item)
            item.setBackground(QColor(bg))
            item.setForeground(QColor(fg))
            cell_w = table.cellWidget(row, col)
            if isinstance(cell_w, QWidget):
                cell_w.setObjectName("HardwareRowCellHost")
                radius = ""
                borders = f"border-top: 1px solid {row_border}; border-bottom: 1px solid {row_border};"
                if col == 0:
                    radius = "border-top-left-radius: 10px; border-bottom-left-radius: 10px;"
                    borders += f" border-left: 1px solid {row_border};"
                elif col == (table.columnCount() - 1):
                    radius = "border-top-right-radius: 10px; border-bottom-right-radius: 10px;"
                    borders += f" border-right: 1px solid {row_border};"
                cell_w.setStyleSheet(
                    f"QWidget#HardwareRowCellHost {{ background: {bg}; {borders} {radius} }}"
                )
                lay = cell_w.layout()
                if lay is not None:
                    if col == 1:
                        lay.setContentsMargins(8, 4, 8, 4)
                    elif col == 0:
                        lay.setContentsMargins(12, 4, 6, 4)
                    elif col == 2:
                        lay.setContentsMargins(0, 4, 0, 4)
                        lay.setAlignment(Qt.AlignmentFlag.AlignCenter)
                    else:
                        lay.setContentsMargins(6, 4, 6, 4)
        # Keep the name text rendered only by the inline editor (avoid double text).
        name_item = table.item(row, 1)
        if isinstance(name_item, QTableWidgetItem):
            name_item.setText("")
        name_host = table.cellWidget(row, 1)
        if isinstance(name_host, QWidget):
            name_input = name_host.findChild(QLineEdit)
            if isinstance(name_input, QLineEdit):
                name_input.setStyleSheet(
                    f"QLineEdit {{ background: transparent; border: none; color: {fg}; padding: 0 2px; font-size: 12px; font-weight: 800; }}"
                )
        default_host = table.cellWidget(row, 3)
        if isinstance(default_host, QWidget):
            default_host.setObjectName("HardwareDefaultHost")
            right_radius = "border-top-right-radius: 10px; border-bottom-right-radius: 10px;"
            default_host.setStyleSheet(
                f"QWidget#HardwareDefaultHost {{ background: {bg}; color: {fg}; "
                f"border-top: 1px solid {row_border}; border-bottom: 1px solid {row_border}; border-right: 1px solid {row_border}; "
                f"{right_radius} }}"
            )
            cb = default_host.findChild(QCheckBox)
            if isinstance(cb, QCheckBox):
                cb.setStyleSheet(f"QCheckBox {{ color: {fg}; background: transparent; }}")

    def _is_hardware_detail_row(self, table: QTableWidget, row: int) -> bool:
        if table is None or row < 0 or row >= table.rowCount():
            return False
        item = table.item(row, 0)
        marker = item.data(Qt.ItemDataRole.UserRole) if isinstance(item, QTableWidgetItem) else None
        return str(marker or "") == "__hardware_detail__"

    def _hardware_detail_row_index(self) -> int:
        return int(getattr(self, "_company_hardware_detail_row", -1))

    def _clear_company_hardware_inline_editor(self, persist_payload: bool = False, queue_save: bool = False) -> None:
        table = self._company_hardware_table
        detail_row = self._hardware_detail_row_index()
        if not isinstance(table, QTableWidget):
            self._company_hardware_detail_row = -1
            return
        if 0 <= detail_row < table.rowCount() and self._is_hardware_detail_row(table, detail_row):
            w = table.cellWidget(detail_row, 0)
            if persist_payload and isinstance(w, QWidget) and hasattr(w, "payload"):
                base_row = detail_row - 1
                if 0 <= base_row < table.rowCount():
                    name_item = table.item(base_row, 1)
                    if isinstance(name_item, QTableWidgetItem):
                        try:
                            payload = dict(getattr(w, "payload")() or {})
                        except Exception:
                            payload = {}
                        name_item.setData(Qt.ItemDataRole.UserRole, payload)
                        if queue_save:
                            self._queue_company_autosave("hardware", self._autosave_company_hardware)
            if isinstance(w, QWidget):
                w.deleteLater()
            table.removeRow(detail_row)
        self._company_hardware_detail_row = -1

    def _hardware_visual_to_base_row(self, visual_row: int) -> int:
        row = int(visual_row)
        detail_row = self._hardware_detail_row_index()
        if detail_row >= 0 and row > detail_row:
            row -= 1
        return row

    def _insert_hardware_detail_row(self, base_row: int, name: str, details: dict, name_item: QTableWidgetItem | None) -> None:
        table = self._company_hardware_table
        if not isinstance(table, QTableWidget):
            return
        base = int(base_row)
        if base < 0:
            return
        visual_insert_row = base + 1
        table.insertRow(visual_insert_row)
        marker = QTableWidgetItem("")
        marker.setData(Qt.ItemDataRole.UserRole, "__hardware_detail__")
        table.setItem(visual_insert_row, 0, marker)
        for c in range(1, table.columnCount()):
            table.setItem(visual_insert_row, c, QTableWidgetItem(""))
        table.setSpan(visual_insert_row, 0, 1, table.columnCount())

        unit_raw = str((getattr(self, "_company", {}) or {}).get("measurementUnit") or "mm")
        editor = HardwareCategoryDialog(name or "Category", payload=details, parent=table, measurement_unit=unit_raw)
        editor.setModal(False)
        # Force inline rendering inside the table row (not a separate popup window).
        editor.setWindowFlags(Qt.WindowType.Widget)
        editor.setParent(table)
        table.setCellWidget(visual_insert_row, 0, editor)
        def _sync_inline_editor_row_height() -> None:
            if visual_insert_row < 0 or visual_insert_row >= table.rowCount():
                return
            # Follow real content height so the first added item expands immediately.
            table.setRowHeight(visual_insert_row, max(320, int(editor.sizeHint().height()) + 12))
            self._fit_table_to_contents(table, min_rows=2)

        _sync_inline_editor_row_height()
        if hasattr(editor, "layoutChanged"):
            try:
                editor.layoutChanged.connect(_sync_inline_editor_row_height)
            except Exception:
                pass
        def _on_payload_changed() -> None:
            if isinstance(name_item, QTableWidgetItem):
                try:
                    name_item.setData(Qt.ItemDataRole.UserRole, dict(editor.payload() or {}))
                except Exception:
                    name_item.setData(Qt.ItemDataRole.UserRole, {})
            self._queue_company_autosave("hardware", self._autosave_company_hardware)

        if hasattr(editor, "payloadChanged"):
            try:
                editor.payloadChanged.connect(_on_payload_changed)
            except Exception:
                pass
        self._company_hardware_detail_row = visual_insert_row

        def _on_accept() -> None:
            if isinstance(name_item, QTableWidgetItem):
                name_item.setData(Qt.ItemDataRole.UserRole, editor.payload())
            self._queue_company_autosave("hardware", self._autosave_company_hardware)
            self._clear_company_hardware_inline_editor(persist_payload=False)
            self._fit_table_to_contents(table, min_rows=2)

        def _on_reject() -> None:
            self._clear_company_hardware_inline_editor(persist_payload=False)
            self._fit_table_to_contents(table, min_rows=2)

        editor.accepted.connect(_on_accept)
        editor.rejected.connect(_on_reject)

    def _set_hardware_manage_button(self, table: QTableWidget, row: int) -> None:
        # Manage column was removed.
        _ = (table, row)

    def _hardware_expand_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_hardware_table
        if table is None:
            return
        row = self._hardware_visual_to_base_row(self._row_from_table_button(table, sender, preferred_col=0))
        if row < 0:
            return
        detail_row = self._hardware_detail_row_index()
        if detail_row >= 0 and (detail_row - 1) == row:
            self._clear_company_hardware_inline_editor(persist_payload=True, queue_save=True)
            for r in range(table.rowCount()):
                if self._is_hardware_detail_row(table, r):
                    continue
                row_color = self._read_color_hex(table, r, 2, "#7D99B3")
                self._set_hardware_left_controls(table, r, row_color)
                self._set_hardware_manage_button(table, r)
                self._apply_hardware_row_theme(table, r, row_color)
            self._fit_table_to_contents(table, min_rows=2)
            return
        self._hardware_open_row_editor(row)

    def _hardware_open_row_editor(self, base_row: int) -> None:
        table = self._company_hardware_table
        if table is None or base_row < 0 or base_row >= table.rowCount():
            return
        detail_row = self._hardware_detail_row_index()
        if detail_row >= 0:
            self._clear_company_hardware_inline_editor(persist_payload=True, queue_save=True)
        name = self._editor_text(table, base_row, 1)
        name_item = table.item(base_row, 1)
        details = dict(name_item.data(Qt.ItemDataRole.UserRole) or {}) if isinstance(name_item, QTableWidgetItem) else {}
        details["__headerColor"] = self._read_color_hex(table, base_row, 2, "#7D99B3")
        self._insert_hardware_detail_row(base_row, name, details, name_item if isinstance(name_item, QTableWidgetItem) else None)
        for row in range(table.rowCount()):
            if self._is_hardware_detail_row(table, row):
                continue
            row_color = self._read_color_hex(table, row, 2, "#7D99B3")
            self._set_hardware_left_controls(table, row, row_color)
            self._set_hardware_manage_button(table, row)
            self._apply_hardware_row_theme(table, row, row_color)
        self._fit_table_to_contents(table, min_rows=2)

    def _load_company_hardware_rows(self) -> None:
        table = self._company_hardware_table
        if table is None:
            return
        self._clear_company_hardware_inline_editor()
        rows = self._company_hardware_settings()
        if not rows:
            rows = [{"name": "Default", "color": "#7D99B3", "drawers": [], "hinges": [], "other": [], "default": False}]
        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=self._HARDWARE_ROW_HEIGHT)
        default_row = -1
        for i2, row in enumerate(rows):
            table.setItem(i2, 1, QTableWidgetItem(""))
            color_hex = self._normalize_hex(str(row.get("color") or "#7D99B3"), "#7D99B3")
            color_item = QTableWidgetItem("")
            color_item.setData(Qt.ItemDataRole.UserRole, color_hex)
            table.setItem(i2, 2, color_item)
            default_item = QTableWidgetItem("")
            default_item.setData(Qt.ItemDataRole.UserRole, bool(row.get("default")))
            table.setItem(i2, 3, default_item)
            if bool(row.get("default")) and default_row < 0:
                default_row = i2
            details = {
                "drawers": list(row.get("drawers") or []),
                "hinges": list(row.get("hinges") or []),
                "other": list(row.get("other") or []),
            }
            name_item = table.item(i2, 1)
            if isinstance(name_item, QTableWidgetItem):
                name_item.setData(Qt.ItemDataRole.UserRole, details)
            self._set_name_editor(table, i2, 1, str(row.get("name") or ""), lambda _=None: self._queue_company_autosave("hardware", self._autosave_company_hardware))
            self._set_color_button(table, i2, 2, color_hex, self._hardware_color_button_clicked)
            self._set_hardware_left_controls(table, i2, color_hex)
            self._set_hardware_manage_button(table, i2)
            self._apply_hardware_row_theme(table, i2, color_hex)
        self._set_hardware_default_row(default_row, queue_save=False)
        self._fit_table_to_contents(table, min_rows=2)

    def _add_company_hardware_row(self) -> None:
        table = self._company_hardware_table
        if table is None:
            return
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=self._HARDWARE_ROW_HEIGHT)
        table.setItem(row, 1, QTableWidgetItem(""))
        item = table.item(row, 1)
        if isinstance(item, QTableWidgetItem):
            item.setData(Qt.ItemDataRole.UserRole, {"drawers": [], "hinges": [], "other": []})
        color_hex = self._normalize_hex(str(self._company.get("themeColor") or "#7D99B3"), "#7D99B3")
        c_item = QTableWidgetItem("")
        c_item.setData(Qt.ItemDataRole.UserRole, color_hex)
        table.setItem(row, 2, c_item)
        default_item = QTableWidgetItem("")
        default_item.setData(Qt.ItemDataRole.UserRole, False)
        table.setItem(row, 3, default_item)
        self._set_name_editor(table, row, 1, "", lambda _=None: self._queue_company_autosave("hardware", self._autosave_company_hardware))
        self._set_color_button(table, row, 2, color_hex, self._hardware_color_button_clicked)
        self._set_hardware_left_controls(table, row, color_hex)
        self._set_hardware_manage_button(table, row)
        self._apply_hardware_row_theme(table, row, color_hex)
        self._refresh_hardware_default_widgets()
        self._fit_table_to_contents(table, min_rows=2)
        self._queue_company_autosave("hardware", self._autosave_company_hardware)

    def _hardware_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_hardware_table
        row = self._hardware_visual_to_base_row(self._row_from_table_button(table, sender, preferred_col=0)) if table else -1
        self._remove_company_hardware_row(row=row)

    def _remove_company_hardware_row(self, row: int | None = None) -> None:
        table = self._company_hardware_table
        if table is None:
            return
        self._clear_company_hardware_inline_editor()
        row = table.currentRow() if row is None else int(row)
        if row >= 0:
            name = self._editor_text(table, row, 1)
            label = str(name or "this hardware type").strip()
            confirm = QMessageBox.question(
                self,
                "Delete Hardware",
                f"Are you sure you want to delete {label}?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if confirm != QMessageBox.StandardButton.Yes:
                return
            table.removeRow(row)
            self._refresh_hardware_row_widgets()
            self._fit_table_to_contents(table, min_rows=2)
            self._queue_company_autosave("hardware", self._autosave_company_hardware)

    def _hardware_color_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_hardware_table
        if table is None:
            return
        row = self._hardware_visual_to_base_row(self._row_from_table_button(table, sender, preferred_col=2))
        if row < 0 or row >= table.rowCount():
            return
        start_color = self._read_color_hex(table, row, 2, "#7D99B3")
        picked = QColorDialog.getColor(QColor(start_color), self, "Choose Hardware Color")
        if not picked.isValid():
            return
        new_hex = self._normalize_hex(str(picked.name() or start_color), start_color)
        item = table.item(row, 2) or QTableWidgetItem("")
        item.setText("")
        item.setData(Qt.ItemDataRole.UserRole, new_hex)
        table.setItem(row, 2, item)
        self._set_color_button(table, row, 2, new_hex, self._hardware_color_button_clicked)
        self._set_hardware_left_controls(table, row, new_hex)
        self._set_hardware_manage_button(table, row)
        self._apply_hardware_row_theme(table, row, new_hex)
        self._queue_company_autosave("hardware", self._autosave_company_hardware)

    def _hardware_manage_button_clicked(self) -> None:
        # Replaced by direct +/- row toggle.
        return

    def _refresh_hardware_row_widgets(self) -> None:
        table = self._company_hardware_table
        if table is None:
            return
        self._clear_company_hardware_inline_editor()
        self._apply_compact_row_height(table, row_height=self._HARDWARE_ROW_HEIGHT)
        for row in range(table.rowCount()):
            if self._is_hardware_detail_row(table, row):
                continue
            name = self._editor_text(table, row, 1)
            self._set_name_editor(table, row, 1, name, lambda _=None: self._queue_company_autosave("hardware", self._autosave_company_hardware))
            color_hex = self._read_color_hex(table, row, 2, "#7D99B3")
            self._set_color_button(table, row, 2, color_hex, self._hardware_color_button_clicked)
            self._set_hardware_left_controls(table, row, color_hex)
            self._set_hardware_manage_button(table, row)
            self._apply_hardware_row_theme(table, row, color_hex)
            if table.item(row, 3) is None:
                item = QTableWidgetItem("")
                item.setData(Qt.ItemDataRole.UserRole, False)
                table.setItem(row, 3, item)
        self._refresh_hardware_default_widgets()

    def _hardware_default_toggled(self, row: int, checked: bool) -> None:
        if checked:
            self._set_hardware_default_row(row, queue_save=True)
            return
        table = self._company_hardware_table
        if table is None:
            return
        item = table.item(row, 3)
        if item is not None and bool(item.data(Qt.ItemDataRole.UserRole)):
            self._set_hardware_default_row(-1, queue_save=True)
        else:
            self._refresh_hardware_default_widgets()

    def _set_hardware_default_row(self, row: int, queue_save: bool = False) -> None:
        table = self._company_hardware_table
        if table is None:
            return
        selected_row = int(row)
        if selected_row < 0 or selected_row >= table.rowCount():
            selected_row = -1
        for r in range(table.rowCount()):
            if self._is_hardware_detail_row(table, r):
                continue
            item = table.item(r, 3)
            if item is None:
                item = QTableWidgetItem("")
                table.setItem(r, 3, item)
            item.setData(Qt.ItemDataRole.UserRole, r == selected_row)
        self._refresh_hardware_default_widgets()
        if queue_save:
            self._queue_company_autosave("hardware", self._autosave_company_hardware)

    def _refresh_hardware_default_widgets(self) -> None:
        table = self._company_hardware_table
        if table is None:
            return
        default_row = -1
        for r in range(table.rowCount()):
            if self._is_hardware_detail_row(table, r):
                continue
            item = table.item(r, 3)
            if item is not None and bool(item.data(Qt.ItemDataRole.UserRole)):
                default_row = r
                break
        for r in range(table.rowCount()):
            if self._is_hardware_detail_row(table, r):
                continue
            show_checkbox = (default_row < 0) or (r == default_row)
            host = QWidget()
            lay = QHBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(0)
            if show_checkbox:
                cb = QCheckBox()
                cb.setChecked(r == default_row)
                cb.setCursor(Qt.CursorShape.PointingHandCursor)
                cb.toggled.connect(lambda checked, rr=r: self._hardware_default_toggled(rr, checked))
                lay.addWidget(cb, alignment=Qt.AlignmentFlag.AlignCenter)
            table.setCellWidget(r, 3, host)
            try:
                self._apply_hardware_row_theme(table, r, self._read_color_hex(table, r, 2, "#7D99B3"))
            except Exception:
                pass

    def _save_company_hardware_settings(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_hardware_table
        if not company_id or table is None:
            return
        rows: list[dict] = []
        seen = set()
        default_row = -1
        for r in range(table.rowCount()):
            if self._is_hardware_detail_row(table, r):
                continue
            d_item = table.item(r, 3)
            if d_item is not None and bool(d_item.data(Qt.ItemDataRole.UserRole)):
                default_row = r
                break
        for r in range(table.rowCount()):
            if self._is_hardware_detail_row(table, r):
                continue
            name = self._editor_text(table, r, 1)
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            color_hex = self._read_color_hex(table, r, 2, "#7D99B3")
            name_item = table.item(r, 1)
            details = dict(name_item.data(Qt.ItemDataRole.UserRole) or {}) if isinstance(name_item, QTableWidgetItem) else {}
            rows.append(
                {
                    "name": name,
                    "color": color_hex,
                    "drawers": list(details.get("drawers") or []),
                    "hinges": list(details.get("hinges") or []),
                    "other": list(details.get("other") or []),
                    "default": (r == default_row),
                }
            )
        if not rows:
            if not silent_invalid:
                QMessageBox.warning(self, "Hardware", "Add at least one hardware category.")
            return
        try:
            self.app.company.update_company(company_id, {"hardwareSettings": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["hardwareSettings"] = rows
        if notify:
            QMessageBox.information(self, "Saved", "Hardware settings updated.")
