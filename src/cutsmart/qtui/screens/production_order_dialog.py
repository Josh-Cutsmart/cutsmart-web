from __future__ import annotations

from pathlib import Path
from typing import Callable

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from cutsmart.qtui.screens.sales_rooms_mixin import AnimatedOutlineButton


def _int_text(value: object) -> str:
    try:
        num = int(float(str(value or "0").strip() or 0))
    except Exception:
        num = 0
    return str(max(0, num))


class ProductionOrderDialog(QDialog):
    def __init__(
        self,
        project_name: str,
        payload: dict | None,
        hinge_options: list[str] | None,
        on_change: Callable[[dict], None] | None = None,
        on_refresh_drawers: Callable[[list[dict]], list[dict]] | None = None,
        theme_color: str = "#2F6BFF",
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle(f"Order: {str(project_name or 'Project')}")
        self.resize(1460, 760)
        self.setModal(False)
        self.setStyleSheet("QDialog { background:#F5F6F8; }")

        self._payload = dict(payload or {})
        self._hinge_options = [str(v or "").strip() for v in (hinge_options or []) if str(v or "").strip()]
        self._on_change = on_change
        self._on_refresh_drawers = on_refresh_drawers
        self._theme = str(theme_color or "#2F6BFF").strip() or "#2F6BFF"

        self._emit_timer = QTimer(self)
        self._emit_timer.setSingleShot(True)
        self._emit_timer.setInterval(250)
        self._emit_timer.timeout.connect(self._emit_change)

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(10)

        top = QFrame()
        top.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:14px; }")
        top_l = QHBoxLayout(top)
        top_l.setContentsMargins(14, 10, 14, 10)
        top_l.setSpacing(8)
        icon_path = Path(__file__).resolve().parents[1] / "assets" / "icons" / "order.png"
        if icon_path.exists():
            icon = QLabel()
            pix = QPixmap(str(icon_path))
            if not pix.isNull():
                icon.setPixmap(pix.scaled(16, 16, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
                icon.setStyleSheet("QLabel { background:transparent; border:none; }")
                top_l.addWidget(icon, 0, Qt.AlignmentFlag.AlignVCenter)
        title = QLabel("ORDER")
        title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        title_div = QLabel("|")
        title_div.setStyleSheet("QLabel { color:#64748B; font-size:13px; font-weight:700; background:transparent; border:none; }")
        job_name = QLabel(str(project_name or "Project"))
        job_name.setStyleSheet("QLabel { color:#334155; font-size:13px; font-weight:700; background:transparent; border:none; }")
        top_l.addWidget(title, 0)
        top_l.addWidget(title_div, 0)
        top_l.addWidget(job_name, 0)
        top_l.addStretch(1)

        refresh_btn = QPushButton("Refresh Drawers")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.setStyleSheet(
            "QPushButton { background:#FFFFFF; color:#0F172A; border:1px solid #D4DAE6; border-radius:10px; padding:6px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F8FAFC; border-color:#B9C4D8; }"
        )
        refresh_btn.clicked.connect(self._refresh_drawers)
        top_l.addWidget(refresh_btn, 0)

        save_btn = QPushButton("Save")
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.setStyleSheet(
            "QPushButton { background:#DDF2E7; color:#1F6A3B; border:1px solid #BFE8CF; border-radius:10px; padding:6px 12px; font-size:12px; font-weight:800; }"
            "QPushButton:hover { background:#BEE6D0; border-color:#9ED6B8; color:#17552F; }"
        )
        save_btn.clicked.connect(self._emit_change)
        top_l.addWidget(save_btn, 0)
        root.addWidget(top, 0)

        sections_host = QWidget()
        sections_l = QHBoxLayout(sections_host)
        sections_l.setContentsMargins(0, 0, 0, 0)
        sections_l.setSpacing(10)

        self._drawers_table = self._make_table(["Type", "Height", "Length", "Qty", "Supplier"])
        drawers_card = self._build_section_card("DRAWERS", self._drawers_table, add_handler=None)
        sections_l.addWidget(drawers_card, 1)

        self._hinges_table = self._make_table(["", "Hinge Type", "Qty", "Supplier"], boxed_items=False)
        hinges_card = self._build_section_card("HINGES", self._hinges_table, add_handler=self._add_hinge_row)
        sections_l.addWidget(hinges_card, 1)

        self._misc_table = self._make_table(["", "Item", "Qty", "Notes"], boxed_items=False)
        misc_card = self._build_section_card("MISC", self._misc_table, add_handler=self._add_misc_row)
        sections_l.addWidget(misc_card, 1)

        root.addWidget(sections_host, 1)

        self._load_payload_into_ui(self._payload)
        QTimer.singleShot(0, self._sync_quantity_column_widths)

    def _build_section_card(self, title_text: str, table: QTableWidget, add_handler: Callable[[], None] | None) -> QFrame:
        card = QFrame()
        card.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(0, 0, 0, 0)
        card_l.setSpacing(0)

        top = QFrame()
        top.setFixedHeight(50)
        top.setStyleSheet(
            "QFrame { background:#FFFFFF; border:none; border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        top_l = QHBoxLayout(top)
        top_l.setContentsMargins(14, 10, 14, 10)
        top_l.setSpacing(6)
        top_l.setAlignment(Qt.AlignmentFlag.AlignVCenter)
        title = QLabel(str(title_text or "").upper())
        title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        top_l.addWidget(title, 0)
        if callable(add_handler):
            add_btn = AnimatedOutlineButton("+ Add")
            add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            add_btn.setFixedSize(74, 30)
            soft = QColor(self._theme).lighter(190).name()
            add_btn.setStyleSheet(
                "QPushButton { "
                f"background: {soft}; color: {self._theme}; border: none; "
                "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
                "QPushButton:hover { background: #E3ECFA; }"
            )
            add_btn.set_outline_color(QColor(self._theme))
            add_btn.set_outline_duration_ms(150)
            add_btn.clicked.connect(add_handler)
            top_l.addWidget(add_btn, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        top_l.addStretch(1)
        card_l.addWidget(top, 0)

        div = QFrame()
        div.setFixedHeight(1)
        div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        card_l.addWidget(div, 0)

        body = QWidget()
        body_l = QVBoxLayout(body)
        body_l.setContentsMargins(14, 10, 14, 10)
        body_l.setSpacing(8)
        body_l.addWidget(table, 1)
        card_l.addWidget(body, 1)
        return card

    def _make_table(self, headers: list[str], boxed_items: bool = True) -> QTableWidget:
        table = QTableWidget()
        table.setColumnCount(len(headers))
        table.setHorizontalHeaderLabels(headers)
        table.verticalHeader().setVisible(False)
        table.horizontalHeader().setVisible(True)
        table.horizontalHeader().setHighlightSections(False)
        table.setFrameShape(QFrame.Shape.NoFrame)
        table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        table.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        table.setShowGrid(False)
        item_rule = (
            "QTableWidget::item { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding: 2px 8px; }"
            if boxed_items
            else "QTableWidget::item { background:transparent; border:none; padding:0; }"
        )
        table.setStyleSheet(
            "QTableWidget { background:#F8FAFD; border:none; outline:none; }"
            f"{item_rule}"
            "QHeaderView { background:transparent; border:none; }"
            "QHeaderView::section { background:transparent; color:#6B7280; border:none; font-size:12px; font-weight:700; padding: 0 2px 4px 2px; margin:0; }"
            "QTableCornerButton::section { background:transparent; border:none; }"
        )
        table.horizontalHeader().setStyleSheet(
            "QHeaderView { background:transparent; border:none; }"
            "QHeaderView::section { background:transparent; border:none; padding: 0 2px 4px 2px; margin:0; }"
        )
        table.horizontalHeader().setSectionResizeMode(0, table.horizontalHeader().ResizeMode.ResizeToContents)
        for c in range(1, len(headers)):
            mode = table.horizontalHeader().ResizeMode.Stretch if c in (1, len(headers) - 1) else table.horizontalHeader().ResizeMode.ResizeToContents
            table.horizontalHeader().setSectionResizeMode(c, mode)
        return table

    def _schedule_emit_change(self) -> None:
        self._emit_timer.start()

    def _sync_quantity_column_widths(self) -> None:
        drawers_header = self._drawers_table.horizontalHeader()
        drawer_type_w = int(self._drawers_table.columnWidth(0))
        try:
            hint_w = int(drawers_header.sectionSizeHint(0))
            drawer_type_w = max(drawer_type_w, hint_w)
        except Exception:
            pass
        target_w = max(80, drawer_type_w)
        for table, qty_col in (
            (self._drawers_table, 3),
            (self._hinges_table, 2),
            (self._misc_table, 2),
        ):
            header = table.horizontalHeader()
            header.setSectionResizeMode(qty_col, header.ResizeMode.Fixed)
            table.setColumnWidth(qty_col, target_w)

    def _emit_change(self) -> None:
        if callable(self._on_change):
            self._on_change(self.payload())

    def _set_item(self, table: QTableWidget, row: int, col: int, value: str, editable: bool = True) -> QTableWidgetItem:
        item = QTableWidgetItem(str(value or ""))
        flags = Qt.ItemFlag.ItemIsSelectable | Qt.ItemFlag.ItemIsEnabled
        if editable:
            flags |= Qt.ItemFlag.ItemIsEditable
        item.setFlags(flags)
        table.setItem(row, col, item)
        return item

    def _row_remove_button(self, table: QTableWidget, row: int, standalone: bool = False) -> None:
        btn = QPushButton("X")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedSize(22, 22)
        btn.setProperty("row", row)
        btn.setStyleSheet(
            "QPushButton { background:#FFF0F0; color:#C62828; border:1px solid #F1C9C9; border-radius:8px; font-size:12px; font-weight:700; padding:0; }"
            "QPushButton:hover { background:#FFE2E2; }"
        )
        btn.clicked.connect(lambda _=False, t=table, b=btn: self._remove_table_row(t, b))
        if standalone:
            btn.setFixedSize(24, 24)
            btn.setStyleSheet(
                "QPushButton { background:#FFF0F0; color:#C62828; border:1px solid #F1C9C9; border-radius:8px; font-size:12px; font-weight:700; padding:0; }"
                "QPushButton:hover { background:#FFE2E2; }"
            )
            table.setCellWidget(row, 0, btn)
            return
        host = QWidget()
        host_l = QHBoxLayout(host)
        host_l.setContentsMargins(1, 0, 1, 0)
        host_l.addWidget(btn)
        host_l.addStretch(1)
        table.setCellWidget(row, 0, host)

    def _remove_table_row(self, table: QTableWidget, btn: QPushButton) -> None:
        row_prop = btn.property("row")
        try:
            row = int(row_prop) if row_prop is not None else -1
        except Exception:
            row = -1
        if row < 0 or row >= table.rowCount():
            return
        table.removeRow(row)
        for r in range(table.rowCount()):
            host = table.cellWidget(r, 0)
            if isinstance(host, QPushButton):
                host.setProperty("row", r)
            elif isinstance(host, QWidget):
                x_btn = host.findChild(QPushButton)
                if isinstance(x_btn, QPushButton):
                    x_btn.setProperty("row", r)
        self._schedule_emit_change()

    def _add_hinge_row(self, row_data: dict | None = None) -> None:
        data = dict(row_data or {})
        table = self._hinges_table
        row = table.rowCount()
        table.insertRow(row)
        table.setRowHeight(row, 30)
        self._row_remove_button(table, row, standalone=True)

        combo = QComboBox()
        combo.setEditable(False)
        combo.setFixedHeight(24)
        combo.setStyleSheet(
            "QComboBox { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding: 2px 8px; font-size:12px; }"
            "QComboBox::drop-down { border:none; width:0px; }"
            "QComboBox::down-arrow { image:none; width:0px; height:0px; }"
        )
        combo.addItem("")
        for opt in self._hinge_options:
            combo.addItem(opt)
        val = str(data.get("hingeType") or "").strip()
        if val and combo.findText(val) < 0:
            combo.addItem(val)
        combo.setCurrentText(val)
        combo.currentTextChanged.connect(lambda _=None: self._schedule_emit_change())
        table.setCellWidget(row, 1, combo)

        qty_default = _int_text(data.get("qty")) if ("qty" in data and str(data.get("qty") or "").strip() != "") else ""
        qty_edit = QLineEdit(qty_default)
        qty_edit.setFixedHeight(24)
        qty_edit.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter)
        qty_edit.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:2px 8px; font-size:12px; }")
        qty_edit.editingFinished.connect(self._schedule_emit_change)
        table.setCellWidget(row, 2, qty_edit)

        supplier_edit = QLineEdit(str(data.get("supplier") or ""))
        supplier_edit.setFixedHeight(24)
        supplier_edit.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:2px 8px; font-size:12px; }")
        supplier_edit.editingFinished.connect(self._schedule_emit_change)
        table.setCellWidget(row, 3, supplier_edit)
        self._sync_quantity_column_widths()
        self._schedule_emit_change()

    def _add_misc_row(self, row_data: dict | None = None) -> None:
        data = dict(row_data or {})
        table = self._misc_table
        row = table.rowCount()
        table.insertRow(row)
        table.setRowHeight(row, 30)
        self._row_remove_button(table, row, standalone=True)

        item_edit = QLineEdit(str(data.get("item") or ""))
        item_edit.setFixedHeight(24)
        item_edit.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:2px 8px; font-size:12px; }")
        item_edit.editingFinished.connect(self._schedule_emit_change)
        table.setCellWidget(row, 1, item_edit)

        qty_default = _int_text(data.get("qty")) if ("qty" in data and str(data.get("qty") or "").strip() != "") else ""
        qty_edit = QLineEdit(qty_default)
        qty_edit.setFixedHeight(24)
        qty_edit.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter)
        qty_edit.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:2px 8px; font-size:12px; }")
        qty_edit.editingFinished.connect(self._schedule_emit_change)
        table.setCellWidget(row, 2, qty_edit)

        notes_edit = QLineEdit(str(data.get("notes") or ""))
        notes_edit.setFixedHeight(24)
        notes_edit.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:2px 8px; font-size:12px; }")
        notes_edit.editingFinished.connect(self._schedule_emit_change)
        table.setCellWidget(row, 3, notes_edit)
        self._sync_quantity_column_widths()
        self._schedule_emit_change()

    def _set_drawer_rows(self, rows: list[dict] | None) -> None:
        table = self._drawers_table
        table.setRowCount(0)
        for row_data in (rows or []):
            if not isinstance(row_data, dict):
                continue
            row = table.rowCount()
            table.insertRow(row)
            table.setRowHeight(row, 30)
            self._set_item(table, row, 0, str(row_data.get("sourceDrawerType") or ""), editable=False)
            self._set_item(table, row, 1, str(row_data.get("drawerHeight") or ""), editable=False)
            req_raw = str(row_data.get("requiredLength") or "").strip()
            req_mm = str(req_raw)
            if req_mm and not req_mm.lower().endswith("mm"):
                req_mm = f"{req_mm} mm"
            self._set_item(table, row, 2, req_mm, editable=False)
            qty_item = self._set_item(table, row, 3, _int_text(row_data.get("qty") or "0"), editable=False)
            qty_item.setTextAlignment(int(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter))
            self._set_item(table, row, 4, str(row_data.get("supplier") or ""), editable=True)
        self._sync_quantity_column_widths()

    def _refresh_drawers(self) -> None:
        if not callable(self._on_refresh_drawers):
            return
        current_rows = self.payload().get("drawers")
        new_rows = self._on_refresh_drawers(list(current_rows or []))
        self._set_drawer_rows(new_rows if isinstance(new_rows, list) else [])
        self._schedule_emit_change()

    def _load_payload_into_ui(self, payload: dict) -> None:
        self._drawers_table.itemChanged.connect(lambda _item=None: self._schedule_emit_change())
        self._hinges_table.itemChanged.connect(lambda _item=None: self._schedule_emit_change())
        self._misc_table.itemChanged.connect(lambda _item=None: self._schedule_emit_change())
        self._set_drawer_rows(payload.get("drawers") if isinstance(payload.get("drawers"), list) else [])
        for row in (payload.get("hinges") or []):
            if isinstance(row, dict):
                self._add_hinge_row(row)
        for row in (payload.get("misc") or []):
            if isinstance(row, dict):
                self._add_misc_row(row)

    @staticmethod
    def _cell_text(table: QTableWidget, row: int, col: int) -> str:
        item = table.item(row, col)
        if isinstance(item, QTableWidgetItem):
            return str(item.text() or "").strip()
        return ""

    def payload(self) -> dict:
        out = {"drawers": [], "hinges": [], "misc": []}
        for r in range(self._drawers_table.rowCount()):
            source = self._cell_text(self._drawers_table, r, 0)
            drawer_height = self._cell_text(self._drawers_table, r, 1)
            length = self._cell_text(self._drawers_table, r, 2).replace("MM", "mm").replace("mm", "").strip()
            qty_txt = self._cell_text(self._drawers_table, r, 3)
            supplier = self._cell_text(self._drawers_table, r, 4)
            try:
                qty = max(0, int(float(qty_txt or "0")))
            except Exception:
                qty = 0
            if not source and not length:
                continue
            out["drawers"].append(
                {
                    "sourceDrawerType": source,
                    "drawerHeight": drawer_height,
                    "requiredLength": length,
                    "qty": qty,
                    "supplier": supplier,
                    "auto": True,
                }
            )
        for r in range(self._hinges_table.rowCount()):
            combo = self._hinges_table.cellWidget(r, 1)
            hinge_type = str(combo.currentText() or "").strip() if isinstance(combo, QComboBox) else ""
            qty_w = self._hinges_table.cellWidget(r, 2)
            supplier_w = self._hinges_table.cellWidget(r, 3)
            qty_txt = str(qty_w.text() or "").strip() if isinstance(qty_w, QLineEdit) else self._cell_text(self._hinges_table, r, 2)
            supplier = str(supplier_w.text() or "").strip() if isinstance(supplier_w, QLineEdit) else self._cell_text(self._hinges_table, r, 3)
            try:
                qty = max(0, int(float(qty_txt or "0")))
            except Exception:
                qty = 0
            if not hinge_type and qty <= 0 and not supplier:
                continue
            out["hinges"].append(
                {
                    "hingeType": hinge_type,
                    "qty": qty,
                    "supplier": supplier,
                    "auto": False,
                }
            )
        for r in range(self._misc_table.rowCount()):
            item_w = self._misc_table.cellWidget(r, 1)
            qty_w = self._misc_table.cellWidget(r, 2)
            notes_w = self._misc_table.cellWidget(r, 3)
            item = str(item_w.text() or "").strip() if isinstance(item_w, QLineEdit) else self._cell_text(self._misc_table, r, 1)
            qty_txt = str(qty_w.text() or "").strip() if isinstance(qty_w, QLineEdit) else self._cell_text(self._misc_table, r, 2)
            notes = str(notes_w.text() or "").strip() if isinstance(notes_w, QLineEdit) else self._cell_text(self._misc_table, r, 3)
            try:
                qty = max(0, int(float(qty_txt or "0")))
            except Exception:
                qty = 0
            if not item and qty <= 0 and not notes:
                continue
            out["misc"].append(
                {
                    "item": item,
                    "qty": qty,
                    "unit": "",
                    "notes": notes,
                    "auto": False,
                }
            )
        return out
