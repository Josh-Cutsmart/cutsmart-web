from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QTimer, Qt, Signal
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap, QTransform
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QListWidget,
    QListWidgetItem,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QToolButton,
    QVBoxLayout,
    QWidget,
)
from cutsmart.qtui.screens.sales_rooms_mixin import AnimatedOutlineButton


class DrawerBackLettersDialog(QDialog):
    def __init__(self, payload: list[dict] | None = None, parent: QWidget | None = None, measurement_unit: str = "mm"):
        super().__init__(parent)
        self._payload = list(payload or [])
        self._unit_suffix = "in" if str(measurement_unit or "mm").strip().lower() in ("in", "inch", "inches") else "mm"
        self.setWindowTitle("Back Heights")
        self.resize(420, 420)
        self.setModal(True)
        self.setStyleSheet("QDialog { background: #F5F6F8; }")

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)

        table = QTableWidget()
        table.setColumnCount(3)
        table.setHorizontalHeaderLabels(["", "Letter", "Height"])
        table.verticalHeader().setVisible(False)
        table.horizontalHeader().setVisible(True)
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        table.setFrameShape(QFrame.Shape.NoFrame)
        table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        table.setShowGrid(False)
        table.setStyleSheet(
            "QTableWidget { background: #FFFFFF; border: none; }"
            "QTableWidget::item { background: #F8FAFD; border: none; }"
            "QHeaderView::section { background: #FFFFFF; color: #6B7280; border: none; border-bottom: 1px solid #E5EAF2; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        self._table = table
        root.addWidget(table)

        actions = QHBoxLayout()
        add_btn = QPushButton("Add")
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.setStyleSheet(
            "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 1px solid #BFE8CF; border-radius: 9px; padding: 6px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #BEE6D0; border: 1px solid #9ED6B8; color: #17552F; }"
        )
        add_btn.clicked.connect(lambda _=False: self._add_row({}))
        actions.addWidget(add_btn)
        actions.addStretch(1)
        root.addLayout(actions)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Save")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        root.addWidget(buttons)

        for row in self._payload:
            if isinstance(row, dict):
                self._add_row(row)

    def _add_row(self, row_data: dict) -> None:
        row = self._table.rowCount()
        self._table.insertRow(row)
        self._table.setRowHeight(row, 30)
        del_btn = QPushButton("X")
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setFixedSize(22, 22)
        del_btn.setProperty("row", row)
        del_btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        del_btn.clicked.connect(self._delete_clicked)
        del_host = QWidget()
        del_l = QHBoxLayout(del_host)
        del_l.setContentsMargins(1, 0, 1, 0)
        del_l.addWidget(del_btn)
        del_l.addStretch(1)
        self._table.setCellWidget(row, 0, del_host)

        letter_edit = QLineEdit(str(row_data.get("letter") or ""))
        letter_edit.setFixedHeight(24)
        letter_edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        self._table.setCellWidget(row, 1, letter_edit)

        mm_host = QWidget()
        mm_l = QHBoxLayout(mm_host)
        mm_l.setContentsMargins(0, 0, 0, 0)
        mm_l.setSpacing(5)
        minus_edit = QLineEdit(str(row_data.get("minus") or ""))
        minus_edit.setFixedWidth(80)
        minus_edit.setFixedHeight(24)
        minus_edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        mm_lbl = QLabel(self._unit_suffix)
        mm_lbl.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; }")
        mm_l.addWidget(minus_edit)
        mm_l.addWidget(mm_lbl)
        mm_l.addStretch(1)
        self._table.setCellWidget(row, 2, mm_host)

    def _delete_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        row = int(sender.property("row") or -1)
        if row < 0:
            return
        self._table.removeRow(row)
        for r in range(self._table.rowCount()):
            host = self._table.cellWidget(r, 0)
            if isinstance(host, QWidget):
                btn = host.findChild(QPushButton)
                if isinstance(btn, QPushButton):
                    btn.setProperty("row", r)

    def payload(self) -> list[dict]:
        out: list[dict] = []
        for r in range(self._table.rowCount()):
            letter = ""
            minus = ""
            w1 = self._table.cellWidget(r, 1)
            if isinstance(w1, QLineEdit):
                letter = str(w1.text() or "").strip()
            w2 = self._table.cellWidget(r, 2)
            if isinstance(w2, QWidget):
                e = w2.findChild(QLineEdit)
                if isinstance(e, QLineEdit):
                    minus = str(e.text() or "").strip()
            if not letter:
                continue
            out.append({"letter": letter, "minus": minus})
        return out


class DrawerHardwareLengthsDialog(QDialog):
    def __init__(self, payload: list[str] | None = None, parent: QWidget | None = None, measurement_unit: str = "mm"):
        super().__init__(parent)
        self._payload = [str(v or "").strip() for v in (payload or []) if str(v or "").strip()]
        self._unit_suffix = "in" if str(measurement_unit or "mm").strip().lower() in ("in", "inch", "inches") else "mm"
        self.setWindowTitle("Hardware Lengths")
        self.resize(360, 420)
        self.setModal(True)
        self.setStyleSheet("QDialog { background: #F5F6F8; }")

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)

        table = QTableWidget()
        table.setColumnCount(2)
        table.setHorizontalHeaderLabels(["", "Length"])
        table.verticalHeader().setVisible(False)
        table.horizontalHeader().setVisible(True)
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        table.setFrameShape(QFrame.Shape.NoFrame)
        table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        table.setShowGrid(False)
        table.setStyleSheet(
            "QTableWidget { background: #FFFFFF; border: none; }"
            "QTableWidget::item { background: #F8FAFD; border: none; }"
            "QHeaderView::section { background: #FFFFFF; color: #6B7280; border: none; border-bottom: 1px solid #E5EAF2; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        self._table = table
        root.addWidget(table)

        actions = QHBoxLayout()
        add_btn = QPushButton("Add")
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.setStyleSheet(
            "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 1px solid #BFE8CF; border-radius: 9px; padding: 6px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #BEE6D0; border: 1px solid #9ED6B8; color: #17552F; }"
        )
        add_btn.clicked.connect(lambda _=False: self._add_row(""))
        actions.addWidget(add_btn)
        actions.addStretch(1)
        root.addLayout(actions)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Save")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        root.addWidget(buttons)

        for val in self._payload:
            self._add_row(val)

    def _add_row(self, value: str) -> None:
        row = self._table.rowCount()
        self._table.insertRow(row)
        self._table.setRowHeight(row, 30)
        del_btn = QPushButton("X")
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setFixedSize(22, 22)
        del_btn.setProperty("row", row)
        del_btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        del_btn.clicked.connect(self._delete_clicked)
        del_host = QWidget()
        del_l = QHBoxLayout(del_host)
        del_l.setContentsMargins(1, 0, 1, 0)
        del_l.addWidget(del_btn)
        del_l.addStretch(1)
        self._table.setCellWidget(row, 0, del_host)

        mm_host = QWidget()
        mm_l = QHBoxLayout(mm_host)
        mm_l.setContentsMargins(0, 0, 0, 0)
        mm_l.setSpacing(5)
        edit = QLineEdit(str(value or ""))
        edit.setFixedWidth(90)
        edit.setFixedHeight(24)
        edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        lbl = QLabel(self._unit_suffix)
        lbl.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; }")
        mm_l.addWidget(edit)
        mm_l.addWidget(lbl)
        mm_l.addStretch(1)
        self._table.setCellWidget(row, 1, mm_host)

    def _delete_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        row = int(sender.property("row") or -1)
        if row < 0:
            return
        self._table.removeRow(row)
        for r in range(self._table.rowCount()):
            host = self._table.cellWidget(r, 0)
            if isinstance(host, QWidget):
                btn = host.findChild(QPushButton)
                if isinstance(btn, QPushButton):
                    btn.setProperty("row", r)

    def payload(self) -> list[str]:
        out: list[str] = []
        for r in range(self._table.rowCount()):
            w = self._table.cellWidget(r, 1)
            val = ""
            if isinstance(w, QWidget):
                e = w.findChild(QLineEdit)
                if isinstance(e, QLineEdit):
                    val = str(e.text() or "").strip()
            if val:
                out.append(val)
        return out


class DrawerRowsListWidget(QListWidget):
    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._drop_insert_row = -1

    def _set_drop_target_from_pos(self, pos) -> None:
        if self.count() <= 0:
            self._drop_insert_row = -1
            self.viewport().update()
            return
        idx = self.indexAt(pos)
        if idx.isValid():
            rect = self.visualRect(idx)
            row = int(idx.row()) + (1 if pos.y() > rect.center().y() else 0)
        else:
            row = self.count()
        self._drop_insert_row = max(0, min(int(row), self.count()))
        self.viewport().update()

    def dragMoveEvent(self, event) -> None:
        self._set_drop_target_from_pos(event.position().toPoint())
        super().dragMoveEvent(event)

    def dragLeaveEvent(self, event) -> None:
        self._drop_insert_row = -1
        self.viewport().update()
        super().dragLeaveEvent(event)

    def dropEvent(self, event) -> None:
        super().dropEvent(event)
        self._drop_insert_row = -1
        self.viewport().update()

    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        row = int(self._drop_insert_row)
        if row < 0:
            return
        if self.count() <= 0:
            return
        if row <= 0:
            first_idx = self.model().index(0, 0)
            if not first_idx.isValid():
                return
            y = self.visualRect(first_idx).top()
        elif row >= self.count():
            last_idx = self.model().index(self.count() - 1, 0)
            if not last_idx.isValid():
                return
            y = self.visualRect(last_idx).bottom()
        else:
            idx = self.model().index(row, 0)
            if not idx.isValid():
                return
            y = self.visualRect(idx).top()
        p = QPainter(self.viewport())
        edge = QColor("#4A84BC")
        edge.setAlpha(230)
        p.setPen(edge)
        p.drawLine(8, int(y), max(8, self.viewport().width() - 8), int(y))
        p.end()


class HardwareCategoryDialog(QDialog):
    layoutChanged = Signal()
    payloadChanged = Signal()

    @staticmethod
    def _arrow_icon(rotation_degrees: float = 90.0, mirror_vertical: bool = False) -> QIcon:
        icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "arrow.png"
        pix = QPixmap(str(icon_path)) if icon_path.exists() else QPixmap()
        if pix.isNull():
            return QIcon()
        transform = QTransform().rotate(float(rotation_degrees))
        if bool(mirror_vertical):
            transform = transform.scale(1.0, -1.0)
        src = pix.transformed(transform, Qt.TransformationMode.SmoothTransformation)
        tinted = QPixmap(src.size())
        tinted.fill(Qt.GlobalColor.transparent)
        painter = QPainter(tinted)
        painter.drawPixmap(0, 0, src)
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
        painter.fillRect(tinted.rect(), QColor("#FFFFFF"))
        painter.end()
        return QIcon(tinted)

    def __init__(self, category_name: str, payload: dict | None = None, parent: QWidget | None = None, measurement_unit: str = "mm"):
        super().__init__(parent)
        self._payload = dict(payload or {})
        self._unit_suffix = "in" if str(measurement_unit or "mm").strip().lower() in ("in", "inch", "inches") else "mm"
        self.setWindowTitle(f"Hardware: {str(category_name or 'Category')}")
        self.resize(860, 560)
        self.setModal(True)

        header_color = str(self._payload.get("__headerColor") or self._payload.get("color") or "#7D99B3").strip()
        q_header = QColor(header_color)
        if not q_header.isValid():
            q_header = QColor("#7D99B3")
        header_hex = q_header.name()
        border_hex = q_header.darker(112).name()
        text_main = "#FFFFFF" if q_header.lightness() < 150 else "#0F172A"
        text_sub = "#EAF2FF" if q_header.lightness() < 150 else "#334155"
        add_btn_bg = q_header.lighter(190).name()
        add_btn_hover = q_header.lighter(175).name()
        hue = int(q_header.hue())
        sat = int(q_header.saturation())
        is_red_tint = sat >= 40 and (hue < 20 or hue > 340)
        if is_red_tint:
            content_bg = q_header.lighter(185).name()
            tabs_unselected_bg = q_header.lighter(210).name()
        else:
            content_bg = q_header.lighter(160).name()
            tabs_unselected_bg = q_header.lighter(185).name()
        q_content_bg = QColor(content_bg)
        q_tabs_unselected_bg = QColor(tabs_unselected_bg)
        content_text = "#111827" if q_content_bg.lightness() >= 170 else "#FFFFFF"
        content_text_muted = "#111827" if q_tabs_unselected_bg.lightness() >= 170 else "#EAF2FF"
        q_add_bg = QColor(add_btn_bg)
        # Match theme text where possible, but keep readability on very light fills.
        add_btn_text = "#111827" if q_add_bg.lightness() >= 190 else content_text
        outer_bg = "#F8FAFD"
        row_bg = content_bg
        self._hardware_content_bg = content_bg
        self._hardware_row_bg = row_bg
        self._hardware_border_color = border_hex
        self._hardware_content_text = content_text
        self._hardware_content_text_muted = content_text_muted
        self.setStyleSheet(f"QDialog {{ background: {outer_bg}; }}")

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)

        # Keep the original header widget structure for stable layout behavior,
        # but hide it because the header is no longer needed visually.
        head = QFrame()
        head.setStyleSheet(
            "QFrame { "
            f"background: {header_hex}; border: 1px solid {border_hex}; border-radius: 10px; "
            "}"
        )
        head_l = QHBoxLayout(head)
        head_l.setContentsMargins(10, 8, 10, 8)
        head_l.setSpacing(8)
        lvl1 = QLabel("Hardware Type")
        lvl1.setStyleSheet(f"QLabel {{ background: transparent; border: none; color: {text_sub}; font-size: 11px; font-weight: 700; }}")
        head_l.addWidget(lvl1)
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.VLine)
        sep.setStyleSheet(f"QFrame {{ background: {text_sub}; border: none; min-width: 1px; max-width: 1px; }}")
        sep.setFixedHeight(18)
        head_l.addWidget(sep, 0, Qt.AlignmentFlag.AlignVCenter)
        type_lbl = QLabel(str(category_name or "Category"))
        type_lbl.setStyleSheet(f"QLabel {{ background: transparent; border: none; color: {text_main}; font-size: 14px; font-weight: 800; }}")
        head_l.addWidget(type_lbl)
        head_l.addStretch(1)
        head.setVisible(False)
        head.setFixedHeight(0)
        root.addWidget(head)

        tabs = QTabWidget()
        tabs.setStyleSheet(
            f"QTabWidget::pane {{ border: 1px solid #E4E6EC; border-top-left-radius: 0px; border-top-right-radius: 10px; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; background: {content_bg}; top: -1px; }}"
            f"QTabBar {{ background: {outer_bg}; }}"
            f"QTabBar::tab {{ background: {tabs_unselected_bg}; color: {content_text_muted}; border: 1px solid #E4E6EC; border-bottom: none; border-top-left-radius: 8px; border-top-right-radius: 8px; padding: 7px 12px; margin-right: 4px; font-size: 12px; font-weight: 700; }}"
            f"QTabBar::tab:selected {{ background: {content_bg}; color: {content_text}; }}"
        )
        root.addWidget(tabs, 1)

        self._sections: dict[str, QTableWidget] = {}
        self._drawer_items: list[dict] = []
        self._drawers_list: QListWidget | None = None
        self._hinge_items: list[dict] = []
        self._hinge_column_layouts: list[QVBoxLayout] = []
        self._other_items: list[dict] = []
        self._other_column_layouts: list[QVBoxLayout] = []
        for key, title, cols in (
            ("drawers", "Drawers", ["", "Drawer Name", "Bottoms Width", "Bottoms Depth", "Backs Width", "Backs Letters"]),
            ("hinges", "Hinges", ["", "", "", "", ""]),
            ("other", "Other", ["", "Name"]),
        ):
            page = QWidget()
            page.setStyleSheet(
                f"QWidget {{ background: {content_bg}; border: none; "
                "border-top-left-radius: 0px; border-top-right-radius: 10px; "
                "border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; }}"
            )
            lay = QVBoxLayout(page)
            lay.setContentsMargins(10, 10, 10, 10)
            lay.setSpacing(8)
            if key == "drawers":
                drawers_list = DrawerRowsListWidget()
                drawers_list.setFrameShape(QFrame.Shape.NoFrame)
                drawers_list.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
                drawers_list.setFocusPolicy(Qt.FocusPolicy.NoFocus)
                drawers_list.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
                drawers_list.setDropIndicatorShown(True)
                drawers_list.setDragEnabled(True)
                drawers_list.setAcceptDrops(True)
                drawers_list.setDefaultDropAction(Qt.DropAction.MoveAction)
                drawers_list.setSpacing(3)
                drawers_list.setStyleSheet(
                    f"QListWidget {{ background: {content_bg}; border: none; outline: none; }}"
                    "QListWidget::item { border: none; padding: 0; margin: 0; }"
                    "QListWidget::item:selected { background: transparent; }"
                )
                model = drawers_list.model()
                if model is not None:
                    model.rowsMoved.connect(self._on_drawers_reordered)
                self._drawers_list = drawers_list
                lay.addWidget(drawers_list, 1)
                add_btn = AnimatedOutlineButton("Add Drawer")
                add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_btn.set_outline_color(QColor(header_hex))
                add_btn.set_outline_duration_ms(150)
                add_btn.setStyleSheet(
                    "QPushButton { "
                    f"background: {add_btn_bg}; color: {add_btn_text}; border: none; "
                    "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
                    f"QPushButton:hover {{ background: {add_btn_hover}; }}"
                )
                add_btn.clicked.connect(lambda _=False: (self._add_drawer_item({}), self._notify_payload_changed()))
                row = QHBoxLayout()
                row.addWidget(add_btn)
                row.addStretch(1)
                lay.addLayout(row)
                tabs.addTab(page, title)
                continue
            if key == "hinges":
                hinges_host = QWidget()
                hinges_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                hinges_row = QHBoxLayout(hinges_host)
                hinges_row.setContentsMargins(2, 0, 2, 0)
                hinges_row.setSpacing(0)
                self._hinge_column_layouts = []
                for idx in range(5):
                    col_host = QWidget()
                    col_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                    col_l = QVBoxLayout(col_host)
                    col_l.setContentsMargins(6, 0, 6, 0)
                    col_l.setSpacing(6)
                    self._hinge_column_layouts.append(col_l)
                    hinges_row.addWidget(col_host, 1)
                    if idx < 4:
                        div_wrap = QWidget()
                        div_wrap_l = QHBoxLayout(div_wrap)
                        div_wrap_l.setContentsMargins(8, 0, 8, 0)
                        div_wrap_l.setSpacing(0)
                        div = QFrame()
                        div.setFrameShape(QFrame.Shape.VLine)
                        div.setStyleSheet(f"QFrame {{ background: {border_hex}; border: none; min-width: 1px; max-width: 1px; }}")
                        div_wrap_l.addWidget(div, 0)
                        hinges_row.addWidget(div_wrap, 0)
                lay.addWidget(hinges_host, 1)
                add_btn = AnimatedOutlineButton("Add")
                add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_btn.set_outline_color(QColor(header_hex))
                add_btn.set_outline_duration_ms(150)
                add_btn.setStyleSheet(
                    "QPushButton { "
                    f"background: {add_btn_bg}; color: {add_btn_text}; border: none; "
                    "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
                    f"QPushButton:hover {{ background: {add_btn_hover}; }}"
                )
                add_btn.clicked.connect(lambda _=False: (self._add_hinge_item({}), self._notify_payload_changed()))
                row = QHBoxLayout()
                row.addWidget(add_btn)
                row.addStretch(1)
                lay.addLayout(row)
                tabs.addTab(page, title)
                continue
            if key == "other":
                other_host = QWidget()
                other_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                other_row = QHBoxLayout(other_host)
                other_row.setContentsMargins(2, 0, 2, 0)
                other_row.setSpacing(0)
                self._other_column_layouts = []
                for idx in range(5):
                    col_host = QWidget()
                    col_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                    col_l = QVBoxLayout(col_host)
                    col_l.setContentsMargins(6, 0, 6, 0)
                    col_l.setSpacing(6)
                    self._other_column_layouts.append(col_l)
                    other_row.addWidget(col_host, 1)
                    if idx < 4:
                        div_wrap = QWidget()
                        div_wrap_l = QHBoxLayout(div_wrap)
                        div_wrap_l.setContentsMargins(8, 0, 8, 0)
                        div_wrap_l.setSpacing(0)
                        div = QFrame()
                        div.setFrameShape(QFrame.Shape.VLine)
                        div.setStyleSheet(f"QFrame {{ background: {border_hex}; border: none; min-width: 1px; max-width: 1px; }}")
                        div_wrap_l.addWidget(div, 0)
                        other_row.addWidget(div_wrap, 0)
                lay.addWidget(other_host, 1)
                add_btn = AnimatedOutlineButton("Add")
                add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_btn.set_outline_color(QColor(header_hex))
                add_btn.set_outline_duration_ms(150)
                add_btn.setStyleSheet(
                    "QPushButton { "
                    f"background: {add_btn_bg}; color: {add_btn_text}; border: none; "
                    "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
                    f"QPushButton:hover {{ background: {add_btn_hover}; }}"
                )
                add_btn.clicked.connect(lambda _=False: (self._add_other_item({}), self._notify_payload_changed()))
                row = QHBoxLayout()
                row.addWidget(add_btn)
                row.addStretch(1)
                lay.addLayout(row)
                tabs.addTab(page, title)
                continue
            table = QTableWidget()
            table.setColumnCount(len(cols))
            table.setHorizontalHeaderLabels(cols)
            table.verticalHeader().setVisible(False)
            table.horizontalHeader().setVisible(key != "hinges")
            table.setFrameShape(QFrame.Shape.NoFrame)
            table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
            table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            if key == "hinges":
                table.setShowGrid(True)
                table.setStyleSheet(
                    f"QTableWidget {{ background: {content_bg}; border: none; gridline-color: {border_hex}; }}"
                    f"QTableWidget::item {{ background: {row_bg}; border: none; }}"
                    "QHeaderView::section { background: transparent; color: transparent; border: none; padding: 0; margin: 0; }"
                )
            else:
                table.setShowGrid(False)
                table.setStyleSheet(
                    f"QTableWidget {{ background: {content_bg}; border: none; }}"
                    f"QTableWidget::item {{ background: {row_bg}; border: none; }}"
                    "QHeaderView::section { background: #FFFFFF; color: #6B7280; border: none; border-bottom: 1px solid #E5EAF2; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
                )
            if len(cols) > 1:
                table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
                if key == "hinges":
                    for c in range(1, len(cols)):
                        table.horizontalHeader().setSectionResizeMode(c, QHeaderView.ResizeMode.Stretch)
                else:
                    table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
                    for c in range(2, len(cols)):
                        table.horizontalHeader().setSectionResizeMode(c, QHeaderView.ResizeMode.ResizeToContents)
            lay.addWidget(table)
            add_btn = QPushButton("Add")
            add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            add_btn.setStyleSheet(
                "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 1px solid #BFE8CF; border-radius: 9px; padding: 6px 10px; font-size: 12px; font-weight: 700; }"
                "QPushButton:hover { background: #BEE6D0; border: 1px solid #9ED6B8; color: #17552F; }"
            )
            add_btn.clicked.connect(lambda _=False, s=key: (self._add_row(s, {}), self._notify_payload_changed()))
            row = QHBoxLayout()
            row.addWidget(add_btn)
            row.addStretch(1)
            lay.addLayout(row)
            tabs.addTab(page, title)
            self._sections[key] = table

        self._load_payload()

    def _notify_layout_changed(self) -> None:
        self._sync_drawer_item_sizes()
        self.updateGeometry()
        self.adjustSize()
        parent = self.parentWidget()
        while parent is not None:
            lay = parent.layout()
            if lay is not None:
                lay.activate()
            parent.updateGeometry()
            parent = parent.parentWidget()
        self.layoutChanged.emit()
        # One queued pass catches late geometry updates from newly inserted widgets.
        QTimer.singleShot(0, self.layoutChanged.emit)

    def _notify_payload_changed(self) -> None:
        self.payloadChanged.emit()

    def _new_mm_editor(self, value: str) -> QLineEdit:
        edit = QLineEdit(str(value or ""))
        edit.setFixedHeight(24)
        edit.setFixedWidth(80)
        edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        return edit

    def _sync_drawer_item_sizes(self) -> None:
        drawers_list = self._drawers_list
        if not isinstance(drawers_list, QListWidget):
            return
        for item in self._drawer_items:
            card = item.get("card")
            list_item = item.get("list_item")
            if isinstance(card, QWidget) and isinstance(list_item, QListWidgetItem):
                list_item.setSizeHint(card.sizeHint())

    def _on_drawers_reordered(self, *_args) -> None:
        drawers_list = self._drawers_list
        if not isinstance(drawers_list, QListWidget):
            return
        index_map: dict[int, dict] = {}
        for item in self._drawer_items:
            list_item = item.get("list_item")
            if isinstance(list_item, QListWidgetItem):
                row = drawers_list.row(list_item)
                if row >= 0:
                    index_map[row] = item
        self._drawer_items = [index_map[idx] for idx in sorted(index_map.keys())]
        self._notify_payload_changed()

    def _add_drawer_item(self, row_data: dict) -> None:
        if not isinstance(self._drawers_list, QListWidget):
            return
        bottoms = row_data.get("bottoms") if isinstance(row_data.get("bottoms"), dict) else {}
        backs = row_data.get("backs") if isinstance(row_data.get("backs"), dict) else {}
        bw = str(bottoms.get("widthMinus") or row_data.get("widthMinus") or "")
        bd = str(bottoms.get("depthMinus") or row_data.get("depthMinus") or "")
        back_w = str(backs.get("widthMinus") or "")
        letters = backs.get("letters") if isinstance(backs.get("letters"), list) else []
        hardware_lengths = row_data.get("hardwareLengths") if isinstance(row_data.get("hardwareLengths"), list) else []
        space_requirement = str(row_data.get("spaceRequirement") or row_data.get("clearance") or "").strip()
        is_default = bool(row_data.get("default"))

        card = QFrame()
        row_bg = str(getattr(self, "_hardware_row_bg", "") or "#F1F5F9")
        border_color = str(getattr(self, "_hardware_border_color", "") or "#E4E6EC")
        card.setStyleSheet(f"QFrame {{ background: {row_bg}; border: none; border-radius: 10px; }}")
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(8, 8, 8, 8)
        card_l.setSpacing(6)

        head = QWidget()
        head.setStyleSheet(f"QWidget {{ background: {row_bg}; border: none; }}")
        head_l = QHBoxLayout(head)
        head_l.setContentsMargins(0, 0, 0, 0)
        head_l.setSpacing(6)
        toggle = QToolButton()
        toggle.setCheckable(True)
        toggle.setChecked(False)
        toggle.setFixedSize(22, 22)
        toggle.setText("")
        toggle.setIcon(self._arrow_icon(90.0, mirror_vertical=True))
        toggle.setIconSize(toggle.size())
        toggle.setStyleSheet(
            "QToolButton { background: #20B15A; color: #FFFFFF; border: 1px solid #18934A; border-radius: 7px; font-size: 12px; font-weight: 800; }"
            "QToolButton:hover { background: #1CA652; border: 1px solid #178C45; }"
            "QToolButton:checked { background: #1CA652; color: #FFFFFF; border: 1px solid #178C45; }"
        )
        drag_handle = QLabel("|||")
        drag_handle.setFixedHeight(22)
        drag_handle.setStyleSheet(
            f"QLabel {{ color:{str(getattr(self, '_hardware_content_text', '#374151'))}; "
            "background: transparent; border: none; font-size: 12px; font-weight: 800; }}"
        )
        drag_handle.setCursor(Qt.CursorShape.OpenHandCursor)
        name_edit = QLineEdit(str(row_data.get("name") or ""))
        name_edit.setPlaceholderText("Drawer name")
        name_edit.setFixedHeight(26)
        name_edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        default_cb = QCheckBox("Default")
        default_cb.setChecked(is_default)
        default_cb.setCursor(Qt.CursorShape.PointingHandCursor)
        default_cb.setStyleSheet(
            f"QCheckBox {{ color: {str(getattr(self, '_hardware_content_text', '#4B5563'))}; font-size: 11px; font-weight: 700; }}"
        )
        del_btn = QPushButton("X")
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setFixedSize(22, 22)
        del_btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        head_l.addWidget(del_btn, 0)
        head_l.addWidget(toggle, 0)
        head_l.addWidget(drag_handle, 0)
        head_l.addWidget(name_edit, 1)
        head_l.addWidget(default_cb, 0)
        card_l.addWidget(head)

        details = QWidget()
        details_text = str(getattr(self, "_hardware_content_text", "#374151"))
        details.setStyleSheet(
            f"QWidget {{ background: {row_bg}; border: none; }}"
            f"QLabel {{ color: {details_text}; font-size: 12px; font-weight: 700; background: transparent; border: none; }}"
        )
        details_l = QVBoxLayout(details)
        details_l.setContentsMargins(2, 0, 2, 0)
        details_l.setSpacing(6)
        details.setVisible(False)

        bottoms_row = QHBoxLayout()
        bottoms_row.setContentsMargins(0, 0, 0, 0)
        bottoms_row.setSpacing(8)
        b_lbl = QLabel("Bottoms:")
        bottoms_row.addWidget(b_lbl, 0)
        bottoms_row.addWidget(QLabel("Width: -"), 0)
        b_width = self._new_mm_editor(bw)
        bottoms_row.addWidget(b_width, 0)
        bottoms_row.addWidget(QLabel(self._unit_suffix), 0)
        bottoms_row.addSpacing(14)
        bottoms_row.addWidget(QLabel("Depth: -"), 0)
        b_depth = self._new_mm_editor(bd)
        bottoms_row.addWidget(b_depth, 0)
        bottoms_row.addWidget(QLabel(self._unit_suffix), 0)
        bottoms_row.addStretch(1)
        details_l.addLayout(bottoms_row)

        backs_row = QHBoxLayout()
        backs_row.setContentsMargins(0, 0, 0, 0)
        backs_row.setSpacing(8)
        back_lbl = QLabel("Backs:")
        backs_row.addWidget(back_lbl, 0)
        backs_row.addWidget(QLabel("Width: -"), 0)
        back_width = self._new_mm_editor(back_w)
        backs_row.addWidget(back_width, 0)
        backs_row.addWidget(QLabel(self._unit_suffix), 0)
        backs_row.addSpacing(14)
        backs_row.addWidget(QLabel("Height:"), 0)
        letters_btn = QPushButton("+")
        letters_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        letters_btn.setFixedSize(24, 24)
        letters_btn.setStyleSheet(
            "QPushButton { background: #20B15A; color: #FFFFFF; border: 1px solid #18934A; border-radius: 12px; padding: 0; font-size: 16px; font-weight: 800; }"
            "QPushButton:hover { background: #1CA652; }"
        )
        pills_host = QWidget()
        pills_l = QHBoxLayout(pills_host)
        pills_l.setContentsMargins(0, 0, 0, 0)
        pills_l.setSpacing(5)
        backs_row.addWidget(pills_host, 0)
        backs_row.addWidget(letters_btn, 0)
        backs_row.addStretch(1)
        details_l.addLayout(backs_row)

        lengths_row = QHBoxLayout()
        lengths_row.setContentsMargins(0, 0, 0, 0)
        lengths_row.setSpacing(8)
        lengths_lbl = QLabel("Hardware Lengths:")
        lengths_row.addWidget(lengths_lbl, 0)
        lengths_pills_host = QWidget()
        lengths_pills_l = QHBoxLayout(lengths_pills_host)
        lengths_pills_l.setContentsMargins(0, 0, 0, 0)
        lengths_pills_l.setSpacing(5)
        lengths_row.addWidget(lengths_pills_host, 0)
        lengths_btn = QPushButton("+")
        lengths_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        lengths_btn.setFixedSize(24, 24)
        lengths_btn.setStyleSheet(
            "QPushButton { background: #20B15A; color: #FFFFFF; border: 1px solid #18934A; border-radius: 12px; padding: 0; font-size: 16px; font-weight: 800; }"
            "QPushButton:hover { background: #1CA652; }"
        )
        lengths_row.addWidget(lengths_btn, 0)
        lengths_row.addStretch(1)
        details_l.addLayout(lengths_row)

        clearance_row = QHBoxLayout()
        clearance_row.setContentsMargins(0, 0, 0, 0)
        clearance_row.setSpacing(8)
        clearance_lbl = QLabel("Space Requirement:")
        clearance_row.addWidget(clearance_lbl, 0)
        clearance_row.addWidget(QLabel("-"), 0)
        space_req_edit = self._new_mm_editor(space_requirement)
        clearance_row.addWidget(space_req_edit, 0)
        clearance_row.addWidget(QLabel(self._unit_suffix), 0)
        clearance_row.addStretch(1)
        details_l.addLayout(clearance_row)

        card_l.addWidget(details)

        state = {"letters": list(letters)}
        lengths_state = {"values": [str(v or "").strip() for v in hardware_lengths if str(v or "").strip()]}

        def _refresh_letter_pills() -> None:
            while pills_l.count():
                item = pills_l.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.setParent(None)
                    w.deleteLater()
            rows = state.get("letters") if isinstance(state.get("letters"), list) else []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                letter = str(row.get("letter") or "").strip()
                if not letter:
                    continue
                text = letter
                pill = QLabel(text)
                pill.setStyleSheet(
                    "QLabel { background: #EEF2F7; color: #44556D; border: 1px solid #DDE3EC; border-radius: 10px; padding: 2px 8px; font-size: 11px; font-weight: 700; }"
                )
                pills_l.addWidget(pill, 0)

        def _toggle(opened: bool) -> None:
            details.setVisible(bool(opened))
            # Collapsed: 90 deg; Expanded: -90 deg.
            toggle.setIcon(self._arrow_icon(-90.0 if bool(opened) else 90.0, mirror_vertical=True))
            if bool(opened):
                card.setStyleSheet(f"QFrame {{ background: {row_bg}; border: 1px solid {border_color}; border-radius: 10px; }}")
            else:
                card.setStyleSheet(f"QFrame {{ background: {row_bg}; border: none; border-radius: 10px; }}")
            self._notify_layout_changed()

        toggle.toggled.connect(_toggle)

        def _edit_letters() -> None:
            dlg = DrawerBackLettersDialog(payload=list(state.get("letters") or []), parent=self, measurement_unit=self._unit_suffix)
            if dlg.exec() == QDialog.DialogCode.Accepted:
                state["letters"] = dlg.payload()
                _refresh_letter_pills()
                self._notify_payload_changed()

        def _refresh_length_pills() -> None:
            while lengths_pills_l.count():
                item = lengths_pills_l.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.setParent(None)
                    w.deleteLater()
            values = lengths_state.get("values") if isinstance(lengths_state.get("values"), list) else []
            for val in values:
                txt = str(val or "").strip()
                if not txt:
                    continue
                pill = QLabel(f"{txt}")
                pill.setStyleSheet(
                    "QLabel { background: #EEF2F7; color: #44556D; border: 1px solid #DDE3EC; border-radius: 10px; padding: 2px 8px; font-size: 11px; font-weight: 700; }"
                )
                lengths_pills_l.addWidget(pill, 0)

        def _edit_lengths() -> None:
            dlg = DrawerHardwareLengthsDialog(payload=list(lengths_state.get("values") or []), parent=self, measurement_unit=self._unit_suffix)
            if dlg.exec() == QDialog.DialogCode.Accepted:
                lengths_state["values"] = dlg.payload()
                _refresh_length_pills()
                self._notify_payload_changed()

        letters_btn.clicked.connect(_edit_letters)
        lengths_btn.clicked.connect(_edit_lengths)
        _refresh_letter_pills()
        _refresh_length_pills()

        item = {
            "card": card,
            "list_item": None,
            "name": name_edit,
            "bottomsWidth": b_width,
            "bottomsDepth": b_depth,
            "backsWidth": back_width,
            "spaceRequirement": space_req_edit,
            "letters_state": state,
            "lengths_state": lengths_state,
            "default_cb": default_cb,
        }

        def _on_default_toggled(checked: bool) -> None:
            if checked:
                for other in self._drawer_items:
                    if other is item:
                        continue
                    cb = other.get("default_cb")
                    if isinstance(cb, QCheckBox):
                        blocked = cb.blockSignals(True)
                        cb.setChecked(False)
                        cb.blockSignals(blocked)
            self._refresh_drawer_default_checkboxes()

        default_cb.toggled.connect(_on_default_toggled)
        name_edit.editingFinished.connect(self._notify_payload_changed)
        b_width.editingFinished.connect(self._notify_payload_changed)
        b_depth.editingFinished.connect(self._notify_payload_changed)
        back_width.editingFinished.connect(self._notify_payload_changed)
        space_req_edit.editingFinished.connect(self._notify_payload_changed)
        default_cb.toggled.connect(lambda _=False: self._notify_payload_changed())

        def _delete_item() -> None:
            drawer_name = str(name_edit.text() or "").strip()
            label = drawer_name or "this drawer"
            confirm = QMessageBox.question(
                self,
                "Delete Drawer",
                f"Are you sure you want to delete {label}?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if confirm != QMessageBox.StandardButton.Yes:
                return
            self._drawer_items = [x for x in self._drawer_items if x is not item]
            list_item = item.get("list_item")
            if isinstance(list_item, QListWidgetItem):
                row = self._drawers_list.row(list_item)
                if row >= 0:
                    self._drawers_list.takeItem(row)
            card.setParent(None)
            card.deleteLater()
            self._refresh_drawer_default_checkboxes()
            self._notify_layout_changed()
            self._notify_payload_changed()

        del_btn.clicked.connect(_delete_item)
        list_item = QListWidgetItem()
        list_item.setSizeHint(card.sizeHint())
        self._drawers_list.addItem(list_item)
        self._drawers_list.setItemWidget(list_item, card)
        item["list_item"] = list_item
        self._drawer_items.append(item)
        self._refresh_drawer_default_checkboxes()
        self._notify_layout_changed()

    def _refresh_drawer_default_checkboxes(self) -> None:
        default_item = None
        for item in self._drawer_items:
            cb = item.get("default_cb")
            if isinstance(cb, QCheckBox) and cb.isChecked():
                default_item = item
                break
        for item in self._drawer_items:
            cb = item.get("default_cb")
            if not isinstance(cb, QCheckBox):
                continue
            cb.setVisible(default_item is None or item is default_item)

    def _set_delete_btn(self, table: QTableWidget, row: int, on_click) -> None:
        btn = QPushButton("X")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedSize(22, 22)
        btn.setProperty("row", row)
        btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        btn.clicked.connect(on_click)
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(1, 0, 1, 0)
        lay.addWidget(btn)
        lay.addStretch(1)
        table.setCellWidget(row, 0, host)

    def _add_hinge_item(self, row_data: dict) -> None:
        name = str((row_data or {}).get("name") or "").strip()
        host = QWidget()
        host.setStyleSheet("QWidget { background: transparent; border: none; }")
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)
        del_btn = QPushButton("X")
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setFixedSize(22, 22)
        del_btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        edit = QLineEdit(name)
        edit.setFixedHeight(24)
        edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        lay.addWidget(del_btn, 0)
        lay.addWidget(edit, 1)
        item = {"host": host, "edit": edit}

        def _delete_item() -> None:
            self._hinge_items = [x for x in self._hinge_items if x is not item]
            host.setParent(None)
            host.deleteLater()
            self._rebuild_hinge_columns()
            self._notify_layout_changed()
            self._notify_payload_changed()

        del_btn.clicked.connect(_delete_item)
        edit.editingFinished.connect(self._notify_payload_changed)
        self._hinge_items.append(item)
        self._rebuild_hinge_columns()
        self._notify_layout_changed()

    def _rebuild_hinge_columns(self) -> None:
        cols = list(self._hinge_column_layouts or [])
        if not cols:
            return
        for col_l in cols:
            while col_l.count():
                item = col_l.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.setParent(None)
        for idx, item in enumerate(self._hinge_items):
            host = item.get("host")
            if not isinstance(host, QWidget):
                continue
            col_idx = int(idx % len(cols))
            cols[col_idx].addWidget(host, 0)
        for col_l in cols:
            col_l.addStretch(1)

    def _add_other_item(self, row_data: dict) -> None:
        name = str((row_data or {}).get("name") or "").strip()
        host = QWidget()
        host.setStyleSheet("QWidget { background: transparent; border: none; }")
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)
        del_btn = QPushButton("X")
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setFixedSize(22, 22)
        del_btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #C62828; border: 1px solid #F1C9C9; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFE2E2; }"
        )
        edit = QLineEdit(name)
        edit.setFixedHeight(24)
        edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        lay.addWidget(del_btn, 0)
        lay.addWidget(edit, 1)
        item = {"host": host, "edit": edit}

        def _delete_item() -> None:
            self._other_items = [x for x in self._other_items if x is not item]
            host.setParent(None)
            host.deleteLater()
            self._rebuild_other_columns()
            self._notify_layout_changed()
            self._notify_payload_changed()

        del_btn.clicked.connect(_delete_item)
        edit.editingFinished.connect(self._notify_payload_changed)
        self._other_items.append(item)
        self._rebuild_other_columns()
        self._notify_layout_changed()

    def _rebuild_other_columns(self) -> None:
        cols = list(self._other_column_layouts or [])
        if not cols:
            return
        for col_l in cols:
            while col_l.count():
                item = col_l.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.setParent(None)
        for idx, item in enumerate(self._other_items):
            host = item.get("host")
            if not isinstance(host, QWidget):
                continue
            col_idx = int(idx % len(cols))
            cols[col_idx].addWidget(host, 0)
        for col_l in cols:
            col_l.addStretch(1)

    def _add_text_cell(self, table: QTableWidget, row: int, col: int, text: str, mm: bool = False) -> QLineEdit:
        if mm:
            host = QWidget()
            lay = QHBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(5)
            edit = QLineEdit(str(text or ""))
            edit.setFixedWidth(80)
            edit.setFixedHeight(24)
            edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
            lbl = QLabel(self._unit_suffix)
            lbl.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; }")
            lay.addWidget(edit)
            lay.addWidget(lbl)
            lay.addStretch(1)
            table.setCellWidget(row, col, host)
            return edit
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        table.setCellWidget(row, col, edit)
        return edit

    def _add_row(self, section: str, row_data: dict) -> None:
        table = self._sections.get(section)
        if not isinstance(table, QTableWidget):
            return
        row = table.rowCount()
        table.insertRow(row)
        table.setRowHeight(row, 30)
        self._set_delete_btn(table, row, lambda _=False, s=section: self._delete_clicked(s))
        if section == "drawers":
            name_edit = self._add_text_cell(table, row, 1, str(row_data.get("name") or ""))
            name_edit.editingFinished.connect(self._notify_payload_changed)
            bottoms = row_data.get("bottoms") if isinstance(row_data.get("bottoms"), dict) else {}
            backs = row_data.get("backs") if isinstance(row_data.get("backs"), dict) else {}
            bw = str(bottoms.get("widthMinus") or row_data.get("widthMinus") or "")
            bd = str(bottoms.get("depthMinus") or row_data.get("depthMinus") or "")
            back_w = str(backs.get("widthMinus") or "")
            letters = backs.get("letters") if isinstance(backs.get("letters"), list) else []
            self._add_text_cell(table, row, 2, bw, mm=True)
            self._add_text_cell(table, row, 3, bd, mm=True)
            self._add_text_cell(table, row, 4, back_w, mm=True)
            name_item = table.item(row, 1)
            if name_item is None:
                name_item = QTableWidgetItem("")
                table.setItem(row, 1, name_item)
            name_item.setData(Qt.ItemDataRole.UserRole, {"backLetters": list(letters)})
            self._set_drawer_letters_btn(table, row)
        else:
            self._add_text_cell(table, row, 1, str(row_data.get("name") or ""))

    def _set_drawer_letters_btn(self, table: QTableWidget, row: int) -> None:
        btn = QPushButton("Letters")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedHeight(24)
        btn.setStyleSheet(
            "QPushButton { background: #EEF2F7; color: #44556D; border: 1px solid #DDE3EC; border-radius: 8px; padding: 0 10px; font-size: 11px; font-weight: 700; }"
            "QPushButton:hover { background: #E6ECF4; }"
        )
        btn.clicked.connect(lambda _=False, t=table, r=row: self._open_drawer_letters_for_row(t, r))
        table.setCellWidget(row, 5, btn)

    def _open_drawer_letters_for_row(self, table: QTableWidget, row: int) -> None:
        if not isinstance(table, QTableWidget):
            return
        if row < 0 or row >= table.rowCount():
            return
        name_item = table.item(row, 1)
        meta = dict(name_item.data(Qt.ItemDataRole.UserRole) or {}) if isinstance(name_item, QTableWidgetItem) else {}
        letters = meta.get("backLetters") if isinstance(meta.get("backLetters"), list) else []
        dlg = DrawerBackLettersDialog(payload=letters, parent=self)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        meta["backLetters"] = dlg.payload()
        if isinstance(name_item, QTableWidgetItem):
            name_item.setData(Qt.ItemDataRole.UserRole, meta)
        self._notify_payload_changed()

    def _delete_clicked(self, section: str) -> None:
        table = self._sections.get(section)
        sender = self.sender()
        if not isinstance(table, QTableWidget) or not isinstance(sender, QPushButton):
            return
        row = int(sender.property("row") or -1)
        if row < 0:
            return
        table.removeRow(row)
        self._notify_payload_changed()
        for r in range(table.rowCount()):
            w = table.cellWidget(r, 0)
            if isinstance(w, QWidget):
                btn = w.findChild(QPushButton)
                if isinstance(btn, QPushButton):
                    btn.setProperty("row", r)
            if section == "drawers":
                self._set_drawer_letters_btn(table, r)

    def _read_cell_text(self, table: QTableWidget, row: int, col: int) -> str:
        w = table.cellWidget(row, col)
        if isinstance(w, QLineEdit):
            return str(w.text() or "").strip()
        if isinstance(w, QWidget):
            edit = w.findChild(QLineEdit)
            if isinstance(edit, QLineEdit):
                return str(edit.text() or "").strip()
        return ""

    def _load_payload(self) -> None:
        drawers = self._payload.get("drawers") or []
        if isinstance(drawers, list):
            for row in drawers:
                if isinstance(row, dict):
                    self._add_drawer_item(row)
        default_seen = False
        for item in self._drawer_items:
            cb = item.get("default_cb")
            if not isinstance(cb, QCheckBox) or not cb.isChecked():
                continue
            if not default_seen:
                default_seen = True
                continue
            cb.setChecked(False)
        self._refresh_drawer_default_checkboxes()
        hinge_data = self._payload.get("hinges") or []
        if isinstance(hinge_data, list):
            for row in hinge_data:
                if isinstance(row, dict):
                    self._add_hinge_item(row)
        other_data = self._payload.get("other") or []
        if isinstance(other_data, list):
            for row in other_data:
                if isinstance(row, dict):
                    self._add_other_item(row)

    def payload(self) -> dict:
        out = {"drawers": [], "hinges": [], "other": []}
        for item in self._drawer_items:
            name_w = item.get("name")
            if not isinstance(name_w, QLineEdit):
                continue
            name = str(name_w.text() or "").strip()
            if not name:
                continue
            bw_w = item.get("bottomsWidth")
            bd_w = item.get("bottomsDepth")
            back_w = item.get("backsWidth")
            clearance_w = item.get("spaceRequirement")
            letters_state = item.get("letters_state") if isinstance(item.get("letters_state"), dict) else {}
            lengths_state = item.get("lengths_state") if isinstance(item.get("lengths_state"), dict) else {}
            bw = str(bw_w.text() or "").strip() if isinstance(bw_w, QLineEdit) else ""
            bd = str(bd_w.text() or "").strip() if isinstance(bd_w, QLineEdit) else ""
            bkw = str(back_w.text() or "").strip() if isinstance(back_w, QLineEdit) else ""
            clearance = str(clearance_w.text() or "").strip() if isinstance(clearance_w, QLineEdit) else ""
            letters = letters_state.get("letters") if isinstance(letters_state.get("letters"), list) else []
            hardware_lengths = lengths_state.get("values") if isinstance(lengths_state.get("values"), list) else []
            out["drawers"].append(
                {
                    "name": name,
                    "default": bool(item.get("default_cb").isChecked()) if isinstance(item.get("default_cb"), QCheckBox) else False,
                    "widthMinus": bw,
                    "depthMinus": bd,
                    "bottoms": {"widthMinus": bw, "depthMinus": bd},
                    "backs": {"widthMinus": bkw, "letters": list(letters)},
                    "hardwareLengths": [str(v or "").strip() for v in hardware_lengths if str(v or "").strip()],
                    "spaceRequirement": clearance,
                }
            )
        for section, table in self._sections.items():
            if not isinstance(table, QTableWidget):
                continue
            for r in range(table.rowCount()):
                name = self._read_cell_text(table, r, 1)
                if not name:
                    continue
                out["other"].append({"name": name})
        for item in self._hinge_items:
            edit = item.get("edit")
            if not isinstance(edit, QLineEdit):
                continue
            name = str(edit.text() or "").strip()
            if name:
                out["hinges"].append({"name": name})
        for item in self._other_items:
            edit = item.get("edit")
            if not isinstance(edit, QLineEdit):
                continue
            name = str(edit.text() or "").strip()
            if name:
                out["other"].append({"name": name})
        return out
