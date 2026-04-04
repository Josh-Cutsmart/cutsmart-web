from __future__ import annotations

import json
import math
import re
import time
import html
from pathlib import Path

from PySide6.QtCore import Qt, QTimer, QEvent, QPoint, QPointF, QRect, QRectF, QSize, QRegularExpression, QModelIndex, QPropertyAnimation, QEasingCurve, QParallelAnimationGroup, QSequentialAnimationGroup, QPauseAnimation
from PySide6.QtGui import QAction, QColor, QBrush, QFont, QFontMetrics, QPixmap, QPainter, QPainterPath, QPen, QDrag, QRegularExpressionValidator, QTextDocument, QStandardItemModel, QStandardItem, QPalette, QPageLayout
from PySide6.QtPrintSupport import QPrinter, QPrintPreviewDialog
from PySide6.QtWidgets import (
    QCheckBox,
    QAbstractItemView,
    QComboBox,
    QCompleter,
    QDialog,
    QDialogButtonBox,
    QColorDialog,
    QFormLayout,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListView,
    QGraphicsDropShadowEffect,
    QLayout,
    QMessageBox,
    QMenu,
    QPushButton,
    QScrollArea,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QToolButton,
    QScroller,
    QSizePolicy,
    QSlider,
    QStyle,
    QVBoxLayout,
    QWidget,
    QWidgetAction,
    QStyledItemDelegate,
    QToolTip,
)

class VComboBox(QComboBox):
    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
        arrow_color = str(self.property("arrowColor") or "#7B8493")
        painter.setPen(QColor(arrow_color))
        f = painter.font()
        f.setPointSize(max(6, int(f.pointSize() or 8) - 2))
        painter.setFont(f)
        try:
            shift_x = int(self.property("arrowShiftX") or 0)
        except Exception:
            shift_x = 0
        arrow_rect = self.rect().adjusted(self.width() - 19 + shift_x, 0, -1 + shift_x, 0)
        painter.drawText(arrow_rect, Qt.AlignmentFlag.AlignCenter, "▼")

    def mousePressEvent(self, event) -> None:
        try:
            if bool(self.property("openOnAnyClick")) and event.button() == Qt.MouseButton.LeftButton:
                self.showPopup()
                event.accept()
                return
        except Exception:
            pass
        super().mousePressEvent(event)

    def wheelEvent(self, event) -> None:
        # Prevent accidental value changes while scrolling the page.
        # Allow wheel only when the dropdown popup is open.
        try:
            view = self.view()
            if view is not None and bool(view.isVisible()):
                super().wheelEvent(event)
                return
        except Exception:
            pass
        event.ignore()


class DrawerHeightPickerCombo(VComboBox):
    def __init__(self, on_open=None, parent=None) -> None:
        super().__init__(parent)
        self._on_open = on_open

    def set_on_open(self, cb) -> None:
        self._on_open = cb

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton and callable(self._on_open):
            self._on_open(self)
            event.accept()
            return
        super().mousePressEvent(event)

    def showPopup(self) -> None:
        if callable(self._on_open):
            self._on_open(self)
            return
        super().showPopup()


class DrawerHeightAddButton(QPushButton):
    def __init__(self, on_open=None, parent=None) -> None:
        super().__init__(parent)
        self._on_open = on_open

    def set_on_open(self, cb) -> None:
        self._on_open = cb

    def mouseReleaseEvent(self, event) -> None:
        super().mouseReleaseEvent(event)
        if event.button() != Qt.MouseButton.LeftButton or not callable(self._on_open):
            return
        try:
            inside = self.rect().contains(event.position().toPoint())
        except Exception:
            inside = True
        if not inside:
            return
        # Defer open until the button state is fully reset.
        QTimer.singleShot(0, lambda btn=self: self._on_open(btn))


class HoverLetterLabel(QLabel):
    def __init__(self, on_hover=None, parent=None) -> None:
        super().__init__(parent)
        self._on_hover = on_hover

    def enterEvent(self, event) -> None:
        if callable(self._on_hover):
            self._on_hover(self, True)
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        if callable(self._on_hover):
            self._on_hover(self, False)
        super().leaveEvent(event)


class HoverLetterLineEdit(QLineEdit):
    def __init__(self, on_hover=None, on_click=None, parent=None) -> None:
        super().__init__(parent)
        self._on_hover = on_hover
        self._on_click = on_click

    def enterEvent(self, event) -> None:
        if callable(self._on_hover):
            self._on_hover(self, True)
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        if callable(self._on_hover):
            self._on_hover(self, False)
        super().leaveEvent(event)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton and callable(self._on_click):
            self._on_click(self)
            event.accept()
            return
        super().mousePressEvent(event)


class HoverOverlayFrame(QFrame):
    def __init__(self, on_hover=None, on_click=None, parent=None) -> None:
        super().__init__(parent)
        self._on_hover = on_hover
        self._on_click = on_click

    def enterEvent(self, event) -> None:
        if callable(self._on_hover):
            self._on_hover(self, True)
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        if callable(self._on_hover):
            self._on_hover(self, False)
        super().leaveEvent(event)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton and callable(self._on_click):
            self._on_click(self)
            event.accept()
            return
        super().mousePressEvent(event)


class PartNameSuggestLineEdit(QLineEdit):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._suppress_inline_predict_once = False

    def keyPressEvent(self, event) -> None:
        if event.key() in (Qt.Key.Key_Backspace, Qt.Key.Key_Delete):
            self._suppress_inline_predict_once = True
        if event.key() == Qt.Key.Key_Tab:
            sel = str(self.selectedText() or "")
            if sel:
                self.setSelection(0, 0)
                self.setCursorPosition(len(self.text()))
                self.editingFinished.emit()
                event.accept()
                return
            comp = self.completer()
            if isinstance(comp, QCompleter):
                popup = comp.popup()
                if popup is not None and popup.isVisible():
                    idx = popup.currentIndex()
                    text = ""
                    if idx.isValid():
                        text = str(idx.data() or "").strip()
                    if not text:
                        text = str(comp.currentCompletion() or "").strip()
                    if text:
                        self.setText(text)
                        comp.popup().hide()
                        self.editingFinished.emit()
                        event.accept()
                        return
        super().keyPressEvent(event)

    def mousePressEvent(self, event) -> None:
        super().mousePressEvent(event)
        if event.button() != Qt.MouseButton.LeftButton:
            return
        comp = self.completer()
        if not isinstance(comp, QCompleter):
            return
        model = comp.model()
        try:
            has_rows = bool(model is not None and model.rowCount() > 0)
        except Exception:
            has_rows = False
        if not has_rows:
            return
        comp.complete()


class PartTypeOptionDelegate(QStyledItemDelegate):
    def paint(self, painter: QPainter, option, index: QModelIndex) -> None:
        painter.save()
        painter.fillRect(option.rect, QColor("#FFFFFF"))
        rect = option.rect.adjusted(2, 2, -2, -2)
        bg_data = index.data(Qt.ItemDataRole.BackgroundRole)
        fg_data = index.data(Qt.ItemDataRole.ForegroundRole)
        bg = QColor("#FFFFFF")
        fg = QColor("#1F2937")
        if isinstance(bg_data, QBrush):
            bg = bg_data.color()
        elif isinstance(bg_data, QColor):
            bg = bg_data
        if isinstance(fg_data, QBrush):
            fg = fg_data.color()
        elif isinstance(fg_data, QColor):
            fg = fg_data

        if option.state & QStyle.StateFlag.State_Selected:
            bg = bg.darker(106)
        elif option.state & QStyle.StateFlag.State_MouseOver:
            bg = bg.lighter(103)

        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(bg)
        painter.drawRoundedRect(rect, 8, 8)

        painter.setPen(fg)
        text = str(index.data(Qt.ItemDataRole.DisplayRole) or "")
        text_rect = rect.adjusted(10, 0, -10, 0)
        painter.drawText(text_rect, int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), text)
        painter.restore()

    def sizeHint(self, option, index: QModelIndex) -> QSize:
        sz = super().sizeHint(option, index)
        return QSize(sz.width(), max(28, sz.height()))


class SimpleOptionDelegate(QStyledItemDelegate):
    def paint(self, painter: QPainter, option, index: QModelIndex) -> None:
        painter.save()
        painter.fillRect(option.rect, QColor("#FFFFFF"))
        rect = option.rect.adjusted(2, 2, -2, -2)
        bg = QColor("#FFFFFF")
        fg = QColor("#1F2937")
        if option.state & QStyle.StateFlag.State_Selected:
            bg = QColor("#EEF2F7")
        elif option.state & QStyle.StateFlag.State_MouseOver:
            bg = QColor("#F3F6FA")

        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(bg)
        painter.drawRoundedRect(rect, 8, 8)
        text = str(index.data(Qt.ItemDataRole.DisplayRole) or "")
        m = re.match(r"^\[\s*([0-9]+(?:\.[0-9]+)?)\s*\]\s*(.+)$", text)
        if m:
            chip = str(m.group(1) or "").strip()
            rest = str(m.group(2) or "").strip()
            x = rect.left() + 10
            y = rect.top() + 7
            chip_h = max(14, rect.height() - 14)
            chip_w = max(24, painter.fontMetrics().horizontalAdvance(chip) + 8)
            chip_rect = QRectF(float(x), float(y), float(chip_w), float(chip_h))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor("#E9EDF3"))
            painter.drawRoundedRect(chip_rect, 6, 6)
            painter.setPen(QColor("#5B6472"))
            painter.drawText(chip_rect, int(Qt.AlignmentFlag.AlignCenter), chip)
            painter.setPen(fg)
            text_rect = QRectF(float(x + chip_w + 8), float(rect.top()), float(rect.width() - chip_w - 18), float(rect.height()))
            painter.drawText(text_rect, int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), rest)
        else:
            painter.setPen(fg)
            text_rect = rect.adjusted(10, 0, -10, 0)
            painter.drawText(text_rect, int(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft), text)
        painter.restore()

    def sizeHint(self, option, index: QModelIndex) -> QSize:
        sz = super().sizeHint(option, index)
        return QSize(sz.width(), max(28, sz.height()))



class CutlistDialog(QDialog):
    FIELDS = [
        ("Part Type", "partType"),
        ("Board", "board"),
        ("Part Name", "name"),
        ("Height", "height"),
        ("Width", "width"),
        ("Depth", "depth"),
        ("Quantity", "quantity"),
        ("Clashing", "clashing"),
        ("Information", "information"),
        ("Grain", "grain"),
    ]
    ENTRY_FIELD_WIDTHS = {
        "partType": 110,
        "board": 210,
        "name": 240,
        "height": 76,
        "width": 76,
        "depth": 76,
        "quantity": 80,
        "clashing": 150,
        "information": 220,
        "grain": 95,
    }
    FIELD_LABEL_TO_KEY = {str(label).strip().lower(): str(key) for label, key in FIELDS}
    FIELD_KEY_SET = {str(key) for _label, key in FIELDS}

    @staticmethod
    def _part_key(value: str) -> str:
        return " ".join(str(value or "").strip().lower().split())

    @classmethod
    def _field_key_from_token(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        key = cls._part_key(text)
        if key in cls.FIELD_KEY_SET:
            return key
        return str(cls.FIELD_LABEL_TO_KEY.get(key) or "")

    @staticmethod
    def _apply_numeric_validator(edit: QLineEdit) -> None:
        validator = QRegularExpressionValidator(QRegularExpression(r"^\d*([.]\d*)?$"), edit)
        edit.setValidator(validator)

    @staticmethod
    def _normalize_drilling_value(value: str) -> str:
        txt = str(value or "").strip().lower()
        if txt in ("even spacing", "even", "spacing", "equal spacing", "evenly spaced", "even-spaced"):
            return "Even Spacing"
        if txt in ("centre", "center", "centred", "centered"):
            return "Centre"
        if txt in ("no", "no drilling", "none", "off", "false", "0", ""):
            return "No"
        return "No"

    def _style_popup_view_like_status(
        self,
        view: QAbstractItemView,
        use_item_role_colors: bool = False,
        translucent_shell: bool = True,
    ) -> None:
        if view is None:
            return
        view.setCursor(Qt.CursorShape.PointingHandCursor)
        if view.viewport() is not None:
            view.viewport().setCursor(Qt.CursorShape.PointingHandCursor)
        if isinstance(view, QListWidget):
            view.setSpacing(2)
        try:
            view.setUniformItemSizes(True)
        except Exception:
            pass
        popup = view.window()
        if popup is not None:
            popup.setWindowFlag(Qt.WindowType.FramelessWindowHint, bool(translucent_shell))
            popup.setWindowFlag(Qt.WindowType.NoDropShadowWindowHint, bool(translucent_shell))
            popup.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, bool(translucent_shell))
            if not translucent_shell:
                popup.setWindowFlag(Qt.WindowType.FramelessWindowHint, False)
                popup.setWindowFlag(Qt.WindowType.NoDropShadowWindowHint, False)
                popup.setStyleSheet("")
        if use_item_role_colors:
            view.setItemDelegate(PartTypeOptionDelegate(view))
            view.setStyleSheet(
                "QListView { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 10px; outline: 0; padding: 3px; }"
                "QListView::item { border: none; padding: 0; margin: 0; min-height: 28px; }"
            )
        else:
            view.setItemDelegate(SimpleOptionDelegate(view))
            view.setStyleSheet(
                "QListView { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 10px; outline: 0; padding: 3px; }"
                "QListView::item { border: none; padding: 0; margin: 0; min-height: 28px; }"
            )

    def _style_combo_popup_like_status(self, combo: QComboBox, use_item_role_colors: bool = False) -> None:
        if not isinstance(combo, QComboBox):
            return
        combo.setCursor(Qt.CursorShape.PointingHandCursor)
        view = combo.view()
        self._style_popup_view_like_status(
            view,
            use_item_role_colors=use_item_role_colors,
            translucent_shell=True,
        )

    def _apply_part_type_option_colors(self, combo: QComboBox) -> None:
        if not isinstance(combo, QComboBox):
            return
        for i in range(combo.count()):
            text = str(combo.itemText(i) or "").strip()
            if not text:
                continue
            base = QColor(self._header_color_for_type(text))
            bg = base.lighter(118)
            fg = QColor("#FFFFFF" if base.lightness() < 130 else "#1F2937")
            combo.setItemData(i, QBrush(bg), Qt.ItemDataRole.BackgroundRole)
            combo.setItemData(i, QBrush(fg), Qt.ItemDataRole.ForegroundRole)

    def _apply_part_type_selected_chip(self, combo: QComboBox, part_text: str | None = None) -> None:
        # Keep non-editable combo to avoid row-height jitter/flicker.
        _ = (combo, part_text)

    def _apply_part_type_combo_chip(self, combo: QComboBox) -> None:
        if not isinstance(combo, QComboBox):
            return
        combo.setEditable(True)
        line = combo.lineEdit()
        if isinstance(line, QLineEdit):
            line.setReadOnly(True)
            line.setFrame(False)
            line.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self._apply_part_type_option_colors(combo)
        self._refresh_part_type_combo_chip(combo)
        combo.currentTextChanged.connect(lambda _=None, c=combo: self._refresh_part_type_combo_chip(c))

    def _refresh_part_type_combo_chip(self, combo: QComboBox) -> None:
        if not isinstance(combo, QComboBox):
            return
        text = str(combo.currentText() or "").strip()
        base = QColor(self._header_color_for_type(text))
        fg = "#FFFFFF" if base.lightness() < 130 else "#1F2937"
        chip_bg = base.name()
        combo.setStyleSheet(
            "QComboBox {"
            "background:#FFFFFF; border:1px solid #E4E6EC; border-radius: 8px;"
            "padding: 0 22px 0 4px; font-size: 12px; min-height: 22px; max-height: 22px;"
            "}"
            "QComboBox::drop-down {"
            "subcontrol-origin: padding; subcontrol-position: top right;"
            "width: 18px; border-left: 1px solid #E8EBF1;"
            "background: #F7F8FA; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
            "}"
            "QComboBox::drop-down:on { background: #E2E6ED; }"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
            "QComboBox QLineEdit {"
            f"background: {chip_bg}; color: {fg}; border: none; border-radius: 6px;"
            "padding: 1px 8px; margin: 1px 1px 1px 1px; font-size: 12px; font-weight: 600;"
            "}"
        )
        line = combo.lineEdit()
        if isinstance(line, QLineEdit):
            line.setAutoFillBackground(True)
            line.setStyleSheet(
                "QLineEdit {"
                f"background: {chip_bg}; color: {fg}; border: none; border-radius: 6px;"
                "padding: 1px 8px; margin: 1px 1px 1px 1px; font-size: 12px; font-weight: 600;"
                "}"
            )

    def __init__(
        self,
        rows: list[dict] | None = None,
        entry_draft_rows: list[dict] | None = None,
        collapsed_part_types: list[str] | None = None,
        project_name: str = "Project",
        company_name: str = "",
        print_meta: dict | None = None,
        part_type_options: list[str] | None = None,
        part_type_colors: dict[str, str] | None = None,
        part_type_autoclash: dict[str, dict] | None = None,
        part_type_cabinetry: dict[str, bool] | None = None,
        part_type_drawer: dict[str, bool] | None = None,
        part_type_include_in_cutlists: dict[str, bool] | None = None,
        drawer_back_height_letters: list[str] | None = None,
        drawer_breakdown_spec: dict | None = None,
        measurement_unit: str = "mm",
        board_options: list[str] | None = None,
        board_sheet_sizes: dict[str, str] | None = None,
        board_thickness_map: dict[str, float] | None = None,
        board_display_map: dict[str, str] | None = None,
        board_lacquer_map: dict[str, bool] | None = None,
        nesting_settings: dict | None = None,
        include_grain: bool = True,
        enabled_columns: list[str] | None = None,
        show_project_counts: bool = True,
        part_name_suggestions_by_room: dict[str, list[str]] | None = None,
        part_name_suggestion_part_types_by_room: dict[str, dict[str, str]] | None = None,
        project_rooms: list[str] | None = None,
        seen_piece_rooms: list[str] | None = None,
        active_room: str = "All",
        active_part_type: str = "",
        top_bar_title: str = "Cutlist",
        on_change=None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle("Cutlist")
        self.setModal(False)
        self.setWindowModality(Qt.WindowModality.NonModal)
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, False)
        self.setWindowFlag(Qt.WindowType.WindowMaximizeButtonHint, True)
        self.setWindowFlag(Qt.WindowType.WindowMinimizeButtonHint, True)
        self.resize(1320, 760)
        self.setWindowState(self.windowState() | Qt.WindowState.WindowMaximized)
        QTimer.singleShot(0, self.showMaximized)
        self.setStyleSheet("QDialog { background: #F5F6F8; }")
        self._project_name = str(project_name or "Project")
        self._company_name = str(company_name or "").strip()
        self._print_meta = dict(print_meta or {})
        self._measurement_unit_suffix = "in" if str(measurement_unit or "mm").strip().lower() in ("in", "inch", "inches") else "mm"

        self._quick_inputs: dict[str, QWidget] = {}
        self._entry_input_rows: list[dict[str, object]] = []
        self._entry_rows_layout: QVBoxLayout | None = None
        self._include_grain = bool(include_grain)
        self._show_project_counts = bool(show_project_counts)
        self._part_name_suggestions_by_room_norm: dict[str, list[str]] = {}
        for room_name, names in dict(part_name_suggestions_by_room or {}).items():
            room_key = self._part_key(room_name)
            if not room_key:
                continue
            seen_name_keys: set[str] = set()
            clean_names: list[str] = []
            for token in (names or []):
                txt = str(token or "").strip()
                if not txt:
                    continue
                name_key = self._part_key(txt)
                if not name_key or name_key in seen_name_keys:
                    continue
                seen_name_keys.add(name_key)
                clean_names.append(txt)
            if clean_names:
                self._part_name_suggestions_by_room_norm[room_key] = clean_names
        self._part_name_suggestion_part_types_by_room_norm: dict[str, dict[str, str]] = {}
        for room_name, mapping in dict(part_name_suggestion_part_types_by_room or {}).items():
            room_key = self._part_key(room_name)
            if not room_key or not isinstance(mapping, dict):
                continue
            out_map: dict[str, str] = {}
            for name_txt, part_txt in mapping.items():
                name_key = self._part_key(name_txt)
                part_clean = str(part_txt or "").strip()
                if not name_key or not part_clean:
                    continue
                if name_key not in out_map:
                    out_map[name_key] = part_clean
            if out_map:
                self._part_name_suggestion_part_types_by_room_norm[room_key] = out_map
        enabled_keys = {
            self._field_key_from_token(token)
            for token in (enabled_columns or [])
            if self._field_key_from_token(token)
        }
        if not enabled_keys:
            enabled_keys = set(self.FIELD_KEY_SET)
        self._fields = [
            f
            for f in self.FIELDS
            if (self._include_grain or f[1] != "grain") and (f[1] in enabled_keys)
        ]
        if not self._fields:
            self._fields = [("Part Name", "name")]
        self._entry_fields = [f for f in self._fields if f[1] != "partType"]
        self._part_types_seed = list(part_type_options or [])
        self._part_type_colors = {self._part_key(str(k)): str(v).strip() for k, v in (part_type_colors or {}).items() if str(k).strip()}
        self._part_type_autoclash = {
            self._part_key(str(k)): dict(v or {})
            for k, v in (part_type_autoclash or {}).items()
            if str(k).strip()
        }
        self._part_type_cabinetry = {
            self._part_key(str(k)): bool(v)
            for k, v in (part_type_cabinetry or {}).items()
            if str(k).strip()
        }
        self._part_type_drawer = {
            self._part_key(str(k)): bool(v)
            for k, v in (part_type_drawer or {}).items()
            if str(k).strip()
        }
        self._part_type_include_in_cutlists = {
            self._part_key(str(k)): bool(v)
            for k, v in (part_type_include_in_cutlists or {}).items()
            if str(k).strip()
        }
        self._drawer_back_height_letters: list[str] = []
        _drawer_letter_seen: set[str] = set()
        for item in (drawer_back_height_letters or []):
            txt = str(item or "").strip()
            if not txt:
                continue
            k = self._part_key(txt)
            if k in _drawer_letter_seen:
                continue
            _drawer_letter_seen.add(k)
            self._drawer_back_height_letters.append(txt)
        _drawer_spec_raw = dict(drawer_breakdown_spec or {})
        self._drawer_breakdown_spec: dict[str, object] = {
            "bottomsWidthMinus": str(_drawer_spec_raw.get("bottomsWidthMinus") or "").strip(),
            "bottomsDepthMinus": str(_drawer_spec_raw.get("bottomsDepthMinus") or "").strip(),
            "backsWidthMinus": str(_drawer_spec_raw.get("backsWidthMinus") or "").strip(),
            "backLetterValues": dict(_drawer_spec_raw.get("backLetterValues") or {}),
            "hardwareLengths": list(_drawer_spec_raw.get("hardwareLengths") or []),
            "spaceRequirement": str(_drawer_spec_raw.get("spaceRequirement") or _drawer_spec_raw.get("clearance") or "").strip(),
        }
        self._drawer_breakdown_expanded: set[int] = set()
        self._cabinet_breakdown_expanded: set[int] = set()
        self._board_options_seed = [str(v).strip() for v in (board_options or []) if str(v).strip()]
        self._board_display_map = {str(k).strip(): str(v).strip() for k, v in (board_display_map or {}).items() if str(k).strip()}
        self._board_display_key_by_label = {str(v).strip(): str(k).strip() for k, v in self._board_display_map.items() if str(v).strip()}
        self._board_lacquer_map = {str(k).strip(): bool(v) for k, v in (board_lacquer_map or {}).items() if str(k).strip()}
        self._board_thickness_map: dict[str, float] = {}
        self._board_thickness_map_norm: dict[str, float] = {}
        for k, v in (board_thickness_map or {}).items():
            key = str(k or "").strip()
            if not key:
                continue
            try:
                num = float(v)
            except Exception:
                continue
            if not math.isfinite(num) or num <= 0:
                continue
            self._board_thickness_map[key] = float(num)
            norm = self._part_key(key)
            if norm and norm not in self._board_thickness_map_norm:
                self._board_thickness_map_norm[norm] = float(num)
        self._board_sheet_sizes = {}
        self._board_sheet_sizes_norm = {}
        for k, v in (board_sheet_sizes or {}).items():
            key = str(k).strip()
            val = str(v).strip()
            if not key or not val:
                continue
            self._board_sheet_sizes[key] = val
            norm = self._part_key(key)
            if norm and norm not in self._board_sheet_sizes_norm:
                self._board_sheet_sizes_norm[norm] = val
        self._nesting_settings = dict(nesting_settings or {})
        self._project_rooms_seed = [self._normalize_room_name(v) for v in (project_rooms or []) if str(v or "").strip()]
        self._rooms_with_pieces: set[str] = {self._part_key(v) for v in (seen_piece_rooms or []) if self._part_key(v)}
        self._rows_data: list[dict] = []
        self._next_row_id = 1
        self._part_type_filter: QComboBox | None = None
        self._room_buttons_host: QWidget | None = None
        self._room_buttons_layout: QVBoxLayout | None = None
        self._room_tab_buttons: dict[str, QPushButton] = {}
        self._active_room: str = str(active_room or "All").strip() or "All"
        self._active_part_type: str = str(active_part_type or "").strip()
        self._entry_part_type_host: QWidget | None = None
        self._entry_part_type_layout: QHBoxLayout | None = None
        self._entry_part_type_buttons: dict[str, QPushButton] = {}
        self._search_input: QLineEdit | None = None
        self._summary_part_count_label: QLabel | None = None
        self._combined_parts_label: QLabel | None = None
        self._summary_card: QFrame | None = None
        self._summary_split_divider: QFrame | None = None
        self._summary_pills_wrap: QWidget | None = None
        self._summary_pills_layout: QHBoxLayout | None = None
        self._summary_header_board_label: QLabel | None = None
        self._summary_header_sheets_label: QLabel | None = None
        self._summary_header_edge_label: QLabel | None = None
        self._collapsed_part_types: set[str] = {self._part_key(v) for v in (collapsed_part_types or []) if self._part_key(v)}
        self._pending_delete_ids: set[int] = set()
        self._last_delete_arm_ts: float = 0.0
        self._delete_all_confirm_armed: bool = False
        self._delete_all_confirm_count: int = 0
        self._groups_layout: QVBoxLayout | None = None
        self._groups_scroll: QScrollArea | None = None
        self._row_locators: dict[int, dict[str, object]] = {}
        self._focus_flash_row_ids: set[int] = set()
        self._focus_flash_on: bool = False
        self._entry_row_host: QFrame | None = None
        self._entry_labels_host: QWidget | None = None
        self._entry_empty_hint: QWidget | None = None
        self._entry_card: QFrame | None = None
        self._inline_edit_row_id: int | None = None
        self._on_change = on_change
        self._suspend_autosave = False
        self._autosave_timer = QTimer(self)
        self._autosave_timer.setSingleShot(True)
        self._autosave_timer.timeout.connect(self._emit_autosave)
        self._last_autosave_signature = ""
        self._row_fly_anims: list[QParallelAnimationGroup] = []
        self._row_add_animating: bool = False
        self._part_counter_widgets: dict[str, QWidget] = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 10, 12, 10)
        root.setSpacing(10)

        top = QFrame()
        top.setObjectName("cutTopBar")
        top.setStyleSheet("QFrame#cutTopBar { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:14px; }")
        top.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        top.setFixedHeight(46)
        top_row = QHBoxLayout(top)
        top_row.setContentsMargins(14, 12, 14, 10)
        top_row.setSpacing(6)

        cut_icon = QLabel()
        cut_icon.setStyleSheet("QLabel { background:transparent; border:none; }")
        cut_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "tape-measure.png"
        cut_icon_pix = QPixmap(str(cut_icon_path)) if cut_icon_path.exists() else QPixmap()
        if not cut_icon_pix.isNull():
            cut_icon.setPixmap(cut_icon_pix.scaled(14, 14, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        cut_icon.setFixedSize(16, 16)
        top_row.addWidget(cut_icon, 0, Qt.AlignmentFlag.AlignVCenter)

        top_title = QLabel(str(top_bar_title or "Cutlist"))
        top_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        top_row.addWidget(top_title, 0, Qt.AlignmentFlag.AlignVCenter)

        title_div = QLabel("  |  ")
        title_div.setStyleSheet("QLabel { color:#64748B; font-size:13px; font-weight:700; background:transparent; border:none; }")
        top_row.addWidget(title_div, 0, Qt.AlignmentFlag.AlignVCenter)

        job_name = QLabel(str(project_name or "-"))
        job_name.setStyleSheet("QLabel { color:#334155; font-size:13px; font-weight:700; background:transparent; border:none; }")
        top_row.addWidget(job_name, 1, Qt.AlignmentFlag.AlignVCenter)

        print_btn = QPushButton("Print")
        print_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        print_btn.setFixedHeight(24)
        print_btn.clicked.connect(self._print_cutlist_by_part_type)
        print_btn.setStyleSheet(
            "QPushButton { background:#FFFFFF; color:#0F172A; border:1px solid #D4DAE6; border-radius:10px; padding:2px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F8FAFC; border-color:#B9C4D8; }"
            "QPushButton:pressed { background:#EEF2F7; }"
        )
        top_row.addWidget(print_btn)

        close_btn = QPushButton("Save && Close")
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setFixedHeight(24)
        close_btn.clicked.connect(self._save_and_close)
        close_btn.setStyleSheet(
            "QPushButton { background:#FFFFFF; color:#0F172A; border:1px solid #D4DAE6; border-radius:10px; padding:2px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F8FAFC; border-color:#B9C4D8; }"
            "QPushButton:pressed { background:#EEF2F7; }"
        )
        top_row.addWidget(close_btn)
        root.addWidget(top)

        body_row = QHBoxLayout()
        body_row.setContentsMargins(0, 0, 0, 0)
        body_row.setSpacing(10)
        root.addLayout(body_row, 1)

        rooms_card = QFrame()
        rooms_card.setFixedWidth(190)
        rooms_card.setStyleSheet(
            "QFrame { background: #FFFFFF; border: 1px solid #D7DCE3; border-radius: 16px; }"
        )
        rooms_layout = QVBoxLayout(rooms_card)
        rooms_layout.setContentsMargins(10, 10, 10, 10)
        rooms_layout.setSpacing(8)
        rooms_title = QLabel("Rooms")
        rooms_title.setStyleSheet("QLabel { color: #111827; font-size: 16px; font-weight: 800; background: transparent; border: none; }")
        rooms_layout.addWidget(rooms_title)
        rooms_btn_host = QWidget()
        rooms_btn_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        rooms_btn_layout = QVBoxLayout(rooms_btn_host)
        rooms_btn_layout.setContentsMargins(0, 0, 0, 0)
        rooms_btn_layout.setSpacing(6)
        self._room_buttons_host = rooms_btn_host
        self._room_buttons_layout = rooms_btn_layout
        rooms_layout.addWidget(rooms_btn_host, 1)
        body_row.addWidget(rooms_card, 0)

        content_host = QWidget()
        content_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        content_layout = QVBoxLayout(content_host)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(10)
        body_row.addWidget(content_host, 1)

        entry_card = QFrame()
        self._entry_card = entry_card
        entry_card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #D7DCE3;"
            "border-radius: 16px;"
            "}"
        )
        entry_layout = QVBoxLayout(entry_card)
        entry_layout.setContentsMargins(0, 0, 0, 0)
        entry_layout.setSpacing(0)

        entry_content = QWidget()
        entry_content.setStyleSheet("QWidget { background: transparent; border: none; }")
        entry_content_layout = QVBoxLayout(entry_content)
        entry_content_layout.setContentsMargins(12, 10, 12, 10)
        entry_content_layout.setSpacing(8)

        entry_title = QLabel("Cutlist Entry")
        entry_title.setStyleSheet("QLabel { color: #111827; font-size: 32px; font-weight: 700; background: transparent; border: none; padding: 0; }")
        entry_content_layout.addWidget(entry_title)

        part_type_bar_host = QWidget()
        part_type_bar_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        part_type_bar = QHBoxLayout(part_type_bar_host)
        part_type_bar.setContentsMargins(0, 0, 0, 0)
        part_type_bar.setSpacing(6)
        self._entry_part_type_host = part_type_bar_host
        self._entry_part_type_layout = part_type_bar
        entry_content_layout.addWidget(part_type_bar_host)

        labels_host = QWidget()
        self._entry_labels_host = labels_host
        labels_host_layout = QVBoxLayout(labels_host)
        labels_host_layout.setContentsMargins(3, 0, 3, 0)
        labels_host_layout.setSpacing(0)

        labels = QGridLayout()
        labels.setContentsMargins(0, 0, 0, 0)
        labels.setHorizontalSpacing(8)
        labels.setVerticalSpacing(4)
        labels.setColumnMinimumWidth(0, 28)
        labels.setColumnStretch(0, 0)
        x_placeholder = QWidget()
        x_placeholder.setFixedSize(24, 1)
        labels.addWidget(x_placeholder, 0, 0, alignment=Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        for idx, (_label, key) in enumerate(self._entry_fields, start=1):
            labels.setColumnMinimumWidth(idx, self.ENTRY_FIELD_WIDTHS.get(key, 90))
            labels.setColumnStretch(idx, 1 if key == "information" else 0)
        for idx, (label, key) in enumerate(self._entry_fields, start=1):
            lbl = QLabel(label)
            if key in ("height", "width", "depth", "quantity", "clashing"):
                lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            else:
                lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            lbl.setStyleSheet(
                "QLabel {"
                "color: #6C7A90; font-size: 11px; font-weight: 600;"
                "background: transparent; border: none; padding: 0px; margin: 0px;"
                "}"
            )
            if key in ("height", "width", "depth", "quantity", "clashing"):
                labels.addWidget(lbl, 0, idx, alignment=Qt.AlignmentFlag.AlignCenter)
            else:
                labels.addWidget(lbl, 0, idx, alignment=Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        labels_host_layout.addLayout(labels)
        entry_content_layout.addWidget(labels_host)

        empty_hint_host = QWidget()
        empty_hint_lay = QVBoxLayout(empty_hint_host)
        empty_hint_lay.setContentsMargins(6, 18, 0, 18)
        empty_hint_lay.setSpacing(2)
        empty_hint_arrow = QLabel("↑")
        empty_hint_arrow.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter)
        empty_hint_arrow.setStyleSheet(
            "QLabel { color: #B7C0CD; font-size: 30px; font-weight: 700; background: transparent; border: none; padding: 0; }"
        )
        empty_hint_text = QLabel("Add the first part")
        empty_hint_text.setAlignment(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter)
        empty_hint_text.setStyleSheet(
            "QLabel { color: #B7C0CD; font-size: 24px; font-weight: 700; background: transparent; border: none; padding: 0; }"
        )
        hint_w = max(220, int(empty_hint_text.sizeHint().width()) + 8)
        empty_hint_host.setFixedWidth(hint_w)
        empty_hint_lay.addWidget(empty_hint_arrow, 0)
        empty_hint_lay.addWidget(empty_hint_text, 0)
        self._entry_empty_hint = empty_hint_host
        entry_content_layout.addWidget(empty_hint_host, 0, Qt.AlignmentFlag.AlignLeft)

        self._entry_row_host = QFrame()
        self._entry_row_host.setStyleSheet("QFrame { background: transparent; border: none; }")
        row_host_layout = QVBoxLayout(self._entry_row_host)
        row_host_layout.setContentsMargins(0, 0, 0, 0)
        row_host_layout.setSpacing(3)
        self._entry_rows_layout = row_host_layout
        entry_content_layout.addWidget(self._entry_row_host)
        entry_layout.addWidget(entry_content, 1)

        add_btn = QPushButton("Add to Cutlist")
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.clicked.connect(self._add_row_from_inputs)
        add_btn.setMinimumHeight(42)
        add_btn.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        add_btn.setStyleSheet(
            "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 0px; border-left: 0px; border-right: 0px; border-bottom: 0px; border-top: 1px solid #BFE8CF; border-top-left-radius: 0px; border-top-right-radius: 0px; border-bottom-left-radius: 14px; border-bottom-right-radius: 14px; padding: 8px 12px; font-size: 24px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #BEE6D0; color: #17552F; border: 0px; border-left: 0px; border-right: 0px; border-bottom: 0px; border-top: 1px solid #BFE8CF; }"
        )
        entry_layout.addWidget(add_btn)

        content_layout.addWidget(entry_card)

        list_card = QFrame()
        list_card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #D7DCE3;"
            "border-radius: 16px;"
            "}"
        )
        list_layout = QVBoxLayout(list_card)
        list_layout.setContentsMargins(12, 10, 12, 10)
        list_layout.setSpacing(8)

        summary_card = QFrame()
        self._summary_card = summary_card
        summary_card.setStyleSheet(
            "QFrame { background: #F7F8FA; border: 1px solid #E1E6EE; border-radius: 12px; }"
        )
        summary_lay = QVBoxLayout(summary_card)
        summary_lay.setContentsMargins(10, 8, 10, 8)
        summary_lay.setSpacing(6)
        summary_title = QLabel("Counts")
        summary_title.setStyleSheet("QLabel { color: #5B6472; font-size: 12px; font-weight: 800; background: transparent; border: none; }")
        summary_lay.addWidget(summary_title, 0)
        summary_head = QWidget()
        summary_head_lay = QHBoxLayout(summary_head)
        summary_head_lay.setContentsMargins(0, 0, 0, 0)
        summary_head_lay.setSpacing(4)
        summary_head_board = QLabel("Board")
        summary_head_board.setStyleSheet("QLabel { color: #6B7280; font-size: 11px; font-weight: 800; background: transparent; border: none; }")
        summary_head_sheets = QLabel("Sheets")
        summary_head_sheets.setAlignment(Qt.AlignmentFlag.AlignCenter)
        summary_head_sheets.setStyleSheet("QLabel { color: #6B7280; font-size: 11px; font-weight: 800; background: transparent; border: none; }")
        summary_head_edge = QLabel("Edgetape")
        summary_head_edge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        summary_head_edge.setStyleSheet("QLabel { color: #6B7280; font-size: 11px; font-weight: 800; background: transparent; border: none; }")
        self._summary_header_board_label = summary_head_board
        self._summary_header_sheets_label = summary_head_sheets
        self._summary_header_edge_label = summary_head_edge
        summary_head_lay.addWidget(summary_head_board, 1)
        summary_head_lay.addWidget(summary_head_sheets, 0)
        summary_head_lay.addWidget(summary_head_edge, 0)
        summary_lay.addWidget(summary_head, 0, Qt.AlignmentFlag.AlignLeft)
        list_top = QHBoxLayout()
        list_title = QLabel("Cutlist List")
        list_title.setStyleSheet("QLabel { color: #111827; font-size: 32px; font-weight: 700; background: transparent; border: none; padding: 0; }")
        list_top.addWidget(list_title)

        self._summary_part_count_label = self._pill_label("")
        self._summary_part_count_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        list_top.addWidget(self._summary_part_count_label)
        self._combined_parts_label = self._pill_label("")
        self._combined_parts_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        list_top.addWidget(self._combined_parts_label)
        self._summary_split_divider = None

        summary_wrap = QWidget()
        self._summary_pills_wrap = summary_wrap
        summary_wrap.setStyleSheet("QWidget { background: transparent; border: none; }")
        self._summary_pills_layout = QVBoxLayout(summary_wrap)
        self._summary_pills_layout.setContentsMargins(0, 0, 0, 0)
        self._summary_pills_layout.setSpacing(4)
        summary_wrap.setFixedHeight(52)
        summary_lay.addWidget(summary_wrap, 0)
        list_layout.addWidget(summary_card)

        list_top.addStretch(1)

        self._search_input = QLineEdit()
        self._search_input.setPlaceholderText("Search part name or board")
        self._search_input.textChanged.connect(self._apply_table_filters)
        self._search_input.setStyleSheet(
            "QLineEdit {"
            "background: #EEF1F5;"
            "color: #334155;"
            "border: 1px solid #D8DEE8;"
            "border-radius: 10px;"
            "padding: 8px 10px;"
            "font-size: 12px;"
            "font-weight: 600;"
            "min-width: 260px;"
            "}"
            "QLineEdit:focus { border: 1px solid #BFC9D9; background: #F4F6FA; }"
        )
        list_top.addWidget(self._search_input)

        self._part_type_filter = VComboBox()
        self._part_type_filter.currentTextChanged.connect(self._apply_table_filters)
        self._part_type_filter.setMinimumWidth(180)
        self._part_type_filter.setProperty("openOnAnyClick", True)
        self._part_type_filter.setCursor(Qt.CursorShape.PointingHandCursor)
        self._apply_part_type_combo_chip(self._part_type_filter)
        if isinstance(self._part_type_filter.lineEdit(), QLineEdit):
            self._part_type_filter.lineEdit().setCursor(Qt.CursorShape.PointingHandCursor)
            self._part_type_filter.lineEdit().setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self._style_combo_popup_like_status(self._part_type_filter, use_item_role_colors=True)
        list_top.addWidget(self._part_type_filter)

        list_layout.addLayout(list_top)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        self._groups_scroll = scroll
        self._enable_kinetic_scroll(scroll.viewport())
        groups_host = QWidget()
        groups_host.setStyleSheet("QWidget { background: #FFFFFF; }")
        self._groups_layout = QVBoxLayout(groups_host)
        self._groups_layout.setContentsMargins(0, 0, 0, 0)
        self._groups_layout.setSpacing(10)
        scroll.setWidget(groups_host)
        list_layout.addWidget(scroll, stretch=1)

        content_layout.addWidget(list_card, stretch=1)

        for row in (rows or []):
            self._add_row(row, refresh=False)
        for row in self._rows_data:
            room_key = self._part_key(str((row or {}).get("room") or ""))
            if room_key and room_key != "all":
                self._rooms_with_pieces.add(room_key)
        if not self._active_part_type:
            self._active_part_type = self._part_type_options()[0] if self._part_type_options() else ""
        self._refresh_room_tabs()
        self._refresh_entry_part_type_tabs()
        self._refresh_filters_and_summary()
        seed_rows = [dict(r) for r in (entry_draft_rows or []) if isinstance(r, dict)]
        if seed_rows:
            for seed in seed_rows:
                self._add_entry_input_row(seed=seed)
        self._refresh_room_tabs()
        self._refresh_entry_part_type_tabs()
        self._refresh_entry_empty_state()
        self._refresh_filters_and_summary()
        self._last_autosave_signature = self._payload_signature()

    def _new_row_id(self) -> int:
        value = self._next_row_id
        self._next_row_id += 1
        return value

    def _part_type_options(self) -> list[str]:
        part_types = list(self._part_types_seed)
        if not part_types:
            part_types = ["Front", "Panel", "Drawer", "Cabinet", "Special Panel"]
        return part_types

    def _enable_kinetic_scroll(self, widget: QWidget | None) -> None:
        if not isinstance(widget, QWidget):
            return
        try:
            QScroller.grabGesture(widget, QScroller.ScrollerGestureType.LeftMouseButtonGesture)
        except Exception:
            pass

    def _part_type_is_drawer(self, part_name: str) -> bool:
        return bool(self._part_type_drawer.get(self._part_key(part_name), False))

    def _drawer_height_letter_options(self) -> list[str]:
        return list(self._drawer_back_height_letters)

    def _normalize_room_name(self, value: str) -> str:
        txt = str(value or "").strip()
        return txt or "Unassigned"

    def _room_options(self) -> list[str]:
        names: list[str] = []
        seen: set[str] = set()
        for room in (self._project_rooms_seed or []):
            txt = self._normalize_room_name(room)
            key = self._part_key(txt)
            if key and key not in seen:
                seen.add(key)
                names.append(txt)
        for row in self._rows_data:
            room = self._normalize_room_name(str((row or {}).get("room") or ""))
            key = self._part_key(room)
            if key and key not in seen:
                seen.add(key)
                names.append(room)
        for row_def in self._entry_input_rows:
            room = self._normalize_room_name(str((row_def or {}).get("room") or ""))
            key = self._part_key(room)
            if key and key not in seen:
                seen.add(key)
                names.append(room)
        names.sort(key=lambda x: self._part_key(x))
        return names

    def _room_button_style(self, active: bool, is_project_cutlist: bool = False) -> str:
        if is_project_cutlist:
            if active:
                return (
                    "QPushButton { background: #DCE8F5; color: #324A66; border: 1px solid #C4D4E7; border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; text-align: left; }"
                    "QPushButton:hover { background: #D1E1F1; }"
                )
            return (
                "QPushButton { background: #EEF4FA; color: #4B5F78; border: 1px solid #DEE8F3; border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; text-align: left; }"
                "QPushButton:hover { background: #E5EEF8; }"
            )
        if active:
            return (
                "QPushButton { background: #7D99B3; color: #FFFFFF; border: 1px solid #6E8AA3; border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; text-align: left; }"
                "QPushButton:hover { background: #6F8CA8; }"
            )
        return (
            "QPushButton { background: #F1F4F8; color: #43556B; border: 1px solid #E1E7EF; border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; text-align: left; }"
            "QPushButton:hover { background: #E7ECF3; }"
        )

    def _set_active_room(self, room_name: str) -> None:
        room = str(room_name or "").strip() or "All"
        self._active_room = room
        self._refresh_room_tabs()
        self._refresh_entry_availability()
        self._apply_table_filters()
        self._queue_autosave()

    def _add_room_prompt(self) -> None:
        text, ok = QInputDialog.getText(self, "Add Room", "Room name:")
        if not ok:
            return
        room = self._normalize_room_name(text)
        if not room:
            return
        room_key = self._part_key(room)
        if all(self._part_key(v) != room_key for v in (self._project_rooms_seed or [])):
            self._project_rooms_seed.append(room)
        self._active_room = room
        self._refresh_room_tabs()
        self._queue_autosave()
        self._apply_table_filters()

    def _refresh_room_tabs(self) -> None:
        if not isinstance(self._room_buttons_layout, QVBoxLayout):
            return
        if not self._active_room:
            self._active_room = "All"
        rooms = self._room_options()
        if self._active_room != "All":
            active_norm = self._part_key(self._active_room)
            if all(self._part_key(r) != active_norm for r in rooms):
                rooms.append(self._active_room)
        rooms = [r for r in rooms if self._part_key(r) != "all"]
        while self._room_buttons_layout.count():
            item = self._room_buttons_layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        self._room_tab_buttons = {}
        for room in rooms:
            btn = QPushButton(room)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setStyleSheet(self._room_button_style(self._part_key(room) == self._part_key(self._active_room)))
            btn.clicked.connect(lambda _=False, r=room: self._set_active_room(r))
            self._room_buttons_layout.addWidget(btn)
            self._room_tab_buttons[room] = btn
        divider = QFrame()
        divider.setFrameShape(QFrame.Shape.HLine)
        divider.setFrameShadow(QFrame.Shadow.Plain)
        divider.setFixedHeight(1)
        divider.setStyleSheet("QFrame { background: #E5E7EB; border: none; }")
        self._room_buttons_layout.addWidget(divider)
        project_btn = QPushButton("Project Cutlist")
        project_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        project_btn.setStyleSheet(self._room_button_style(self._part_key(self._active_room) == "all", is_project_cutlist=True))
        project_btn.clicked.connect(lambda _=False: self._set_active_room("All"))
        self._room_buttons_layout.addWidget(project_btn)
        self._room_tab_buttons["All"] = project_btn
        add_btn = QPushButton("+ Room")
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.setStyleSheet(
            "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 1px solid #BFE8CF; border-radius: 10px; padding: 8px 10px; font-size: 12px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #BEE6D0; border: 1px solid #9ED6B8; color: #17552F; }"
        )
        add_btn.clicked.connect(self._add_room_prompt)
        self._room_buttons_layout.addWidget(add_btn)
        self._room_buttons_layout.addStretch(1)

    def _refresh_entry_availability(self) -> None:
        card = self._entry_card
        if not isinstance(card, QFrame):
            return
        is_all = self._part_key(str(self._active_room or "All")) == "all"
        card.setVisible(not is_all)
        active_room_key = self._part_key(str(self._active_room or ""))
        for row_def in list(self._entry_input_rows):
            frame = row_def.get("frame")
            if not isinstance(frame, QFrame):
                continue
            row_room_key = self._part_key(str((row_def or {}).get("room") or ""))
            frame.setVisible((not is_all) and bool(active_room_key) and row_room_key == active_room_key)
        self._refresh_entry_empty_state()

    def _set_active_part_type(self, part_type: str) -> None:
        self._active_part_type = str(part_type or "").strip()
        self._refresh_entry_part_type_tabs()

    def _add_entry_row_for_part_type(self, part_type: str) -> None:
        self._set_active_part_type(part_type)
        self._add_entry_input_row_from_last()

    def _refresh_entry_part_type_tabs(self) -> None:
        if not isinstance(self._entry_part_type_layout, QHBoxLayout):
            return
        while self._entry_part_type_layout.count():
            item = self._entry_part_type_layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        self._entry_part_type_buttons = {}
        options = [str(v).strip() for v in self._part_type_options() if str(v).strip()]
        if not options:
            options = ["Part"]
        if not self._active_part_type:
            self._active_part_type = options[0]
        for opt in options:
            base = QColor(self._header_color_for_type(opt))
            if not base.isValid():
                base = QColor("#E7EAF0")
            active = self._part_key(opt) == self._part_key(self._active_part_type)
            bg = base.name() if active else base.lighter(120).name()
            fg = "#FFFFFF" if QColor(bg).lightness() < 135 else "#111827"
            btn = QPushButton(opt)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setStyleSheet(
                "QPushButton {"
                f"background: {bg}; color: {fg}; border: 1px solid {QColor(bg).darker(108).name()}; border-radius: 10px;"
                "padding: 6px 12px; font-size: 12px; font-weight: 700;"
                "}"
                f"QPushButton:hover {{ background: {QColor(bg).darker(104).name()}; }}"
            )
            btn.clicked.connect(lambda _=False, p=opt: self._add_entry_row_for_part_type(p))
            self._entry_part_type_layout.addWidget(btn, 0)
            self._entry_part_type_buttons[opt] = btn
        self._entry_part_type_layout.addStretch(1)

    def _board_options(self) -> list[str]:
        return list(self._board_options_seed)

    def _part_name_suggestions_for_room(self, room_name: str, part_type: str = "") -> list[str]:
        room_key = self._part_key(room_name)
        part_key = self._part_key(part_type)
        out: list[str] = []
        seen: set[str] = set()
        used_keys = self._used_part_name_keys_for_room(room_name)

        def _add_bucket(bucket_key: str) -> None:
            for token in (self._part_name_suggestions_by_room_norm.get(bucket_key) or []):
                txt = str(token or "").strip()
                key = self._part_key(txt)
                if not key or key in seen or key in used_keys:
                    continue
                seen.add(key)
                out.append(txt)

        if not room_key:
            return out
        if part_key:
            _add_bucket(f"{room_key}|pt:{part_key}")
        _add_bucket(room_key)
        return out

    def _used_part_name_keys_for_room(self, room_name: str) -> set[str]:
        room_key = self._part_key(room_name)
        if not room_key:
            return set()
        out: set[str] = set()
        for row in (self._rows_data or []):
            row_room = self._part_key(self._normalize_room_name(str((row or {}).get("room") or "")))
            if row_room != room_key:
                continue
            name_key = self._part_key(str((row or {}).get("name") or ""))
            if name_key:
                out.add(name_key)
        return out

    def _part_name_part_type_for_room(self, room_name: str, part_name: str) -> str:
        room_key = self._part_key(room_name)
        name_key = self._part_key(part_name)
        if not room_key or not name_key:
            return ""
        room_map = self._part_name_suggestion_part_types_by_room_norm.get(room_key) or {}
        return str(room_map.get(name_key) or "").strip()

    def _apply_part_name_completer(self, edit: QLineEdit, row_def: dict[str, object]) -> None:
        if not isinstance(edit, QLineEdit):
            return
        room_txt = self._normalize_room_name(str((row_def or {}).get("room") or self._active_room or ""))
        part_txt = str((row_def or {}).get("partType") or self._active_part_type or "").strip()
        names = self._part_name_suggestions_for_room(room_txt, part_txt)
        model = QStandardItemModel(edit)
        for name in names:
            item = QStandardItem(str(name))
            part_txt = self._part_name_part_type_for_room(room_txt, str(name))
            if part_txt:
                base = QColor(self._header_color_for_type(part_txt))
                if base.isValid():
                    bg = base.lighter(118)
                    fg = QColor("#FFFFFF" if bg.lightness() < 130 else "#1F2937")
                    item.setData(QBrush(bg), Qt.ItemDataRole.BackgroundRole)
                    item.setData(QBrush(fg), Qt.ItemDataRole.ForegroundRole)
            model.appendRow(item)
        comp = edit.property("_partNameCompleter")
        if isinstance(comp, QCompleter):
            comp.setModel(model)
            return
        completer = QCompleter(model, edit)
        completer.setCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        completer.setFilterMode(Qt.MatchFlag.MatchContains)
        completer.setCompletionMode(QCompleter.CompletionMode.PopupCompletion)
        completer.setPopup(QListView())
        popup = completer.popup()
        if popup is not None:
            self._style_popup_view_like_status(
                popup,
                use_item_role_colors=True,
                translucent_shell=False,
            )
            popup.setFrameShape(QFrame.Shape.NoFrame)
            popup.setAutoFillBackground(True)
            pal = popup.palette()
            pal.setColor(QPalette.ColorRole.Base, QColor("#FFFFFF"))
            pal.setColor(QPalette.ColorRole.Window, QColor("#FFFFFF"))
            popup.setPalette(pal)
            popup.setStyleSheet(
                "QListView { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 10px; outline: 0; padding: 3px; }"
                "QListView::viewport { background: #FFFFFF; }"
                "QListView::item { border: none; padding: 0; margin: 0; min-height: 28px; }"
            )
        edit.setCompleter(completer)
        edit.setProperty("_partNameCompleter", completer)
        edit.textEdited.connect(lambda text, e=edit, c=completer: self._refresh_part_name_completion(e, c, text))

    def _completion_candidates(self, completer: QCompleter) -> list[str]:
        out: list[str] = []
        model = completer.model() if isinstance(completer, QCompleter) else None
        if model is None:
            return out
        try:
            rc = int(model.rowCount())
        except Exception:
            rc = 0
        for i in range(rc):
            try:
                txt = str(model.index(i, 0).data() or "").strip()
            except Exception:
                txt = ""
            if txt:
                out.append(txt)
        return out

    def _best_inline_completion(self, typed: str, candidates: list[str]) -> str:
        raw = str(typed or "")
        t = raw.strip()
        if not t:
            return ""
        t_key = t.lower()
        starts = [c for c in candidates if c.lower().startswith(t_key)]
        if starts:
            return starts[0]
        contains = [c for c in candidates if t_key in c.lower()]
        return contains[0] if contains else ""

    def _refresh_part_name_completion(self, edit: QLineEdit, completer: QCompleter, text: str) -> None:
        if not isinstance(edit, QLineEdit):
            return
        if not isinstance(completer, QCompleter):
            return
        typed = str(text or "")
        completer.setCompletionPrefix(typed.strip())
        popup = completer.popup()
        if popup is None:
            return
        try:
            target_w = max(120, int(edit.width()))
            popup.setFixedWidth(target_w)
        except Exception:
            pass
        model = completer.completionModel()
        try:
            has_rows = bool(model is not None and model.rowCount() > 0)
        except Exception:
            has_rows = False
        # Inline prediction in the textbox (blue selected tail).
        suppress_inline = bool(getattr(edit, "_suppress_inline_predict_once", False))
        if suppress_inline and isinstance(edit, PartNameSuggestLineEdit):
            edit._suppress_inline_predict_once = False
        if (not suppress_inline) and edit.cursorPosition() == len(typed):
            best = self._best_inline_completion(typed, self._completion_candidates(completer))
            if best and len(best) >= len(typed):
                if best != typed:
                    edit.setText(best)
                    edit.setSelection(len(typed), len(best) - len(typed))
        if has_rows:
            completer.complete()
        elif popup.isVisible():
            popup.hide()

    def update_board_sources(
        self,
        board_options: list[str] | None = None,
        board_sheet_sizes: dict[str, str] | None = None,
        board_thickness_map: dict[str, float] | None = None,
        board_display_map: dict[str, str] | None = None,
        board_lacquer_map: dict[str, bool] | None = None,
    ) -> None:
        self._board_options_seed = [str(v).strip() for v in (board_options or []) if str(v).strip()]
        self._board_sheet_sizes = {str(k).strip(): str(v).strip() for k, v in (board_sheet_sizes or {}).items() if str(k).strip()}
        self._board_sheet_sizes_norm = {self._part_key(k): v for k, v in self._board_sheet_sizes.items()}
        self._board_thickness_map = {}
        self._board_thickness_map_norm = {}
        for k, v in (board_thickness_map or {}).items():
            key = str(k or "").strip()
            if not key:
                continue
            try:
                num = float(v)
            except Exception:
                continue
            if not math.isfinite(num) or num <= 0:
                continue
            self._board_thickness_map[key] = float(num)
            norm = self._part_key(key)
            if norm and norm not in self._board_thickness_map_norm:
                self._board_thickness_map_norm[norm] = float(num)
        self._board_display_map = {str(k).strip(): str(v).strip() for k, v in (board_display_map or {}).items() if str(k).strip()}
        self._board_display_key_by_label = {str(v).strip(): str(k).strip() for k, v in self._board_display_map.items() if str(v).strip()}
        self._board_lacquer_map = {str(k).strip(): bool(v) for k, v in (board_lacquer_map or {}).items() if str(k).strip()}

        for row_def in list(self._entry_input_rows):
            inputs = row_def.get("inputs")
            if not isinstance(inputs, dict):
                continue
            combo = inputs.get("board")
            if not isinstance(combo, QComboBox):
                continue
            current_value = self._combo_selected_value(combo)
            blocked = combo.blockSignals(True)
            combo.clear()
            self._add_board_combo_items(combo, include_empty=True)
            self._set_board_combo_value(combo, current_value)
            combo.blockSignals(blocked)

        self._render_rows()

    def _compact_sheet_size_text(self, text: str) -> str:
        raw = str(text or "").strip().lower().replace("mm", "").replace("in", "")
        if not raw:
            return ""
        for sep in ("x", "*", "by", "/", "\\"):
            raw = raw.replace(sep, " ")
        bits = [b for b in raw.split() if b]
        if len(bits) >= 2:
            try:
                a = float(bits[0])
                b = float(bits[1])
                long_edge = max(a, b)
                meters = long_edge / 1000.0
                return f"{(math.floor(meters * 10.0) / 10.0):.1f}"
            except Exception:
                return ""
        return ""

    def _compact_meter_sheet_size_text(self, width_mm: float, height_mm: float) -> str:
        try:
            a = float(width_mm)
            b = float(height_mm)
        except Exception:
            return ""
        if a <= 0 or b <= 0:
            return ""
        long_edge = max(a, b)
        meters = long_edge / 1000.0
        return f"{(math.floor(meters * 10.0) / 10.0):.1f}"

    def _board_display_text(self, board_name: str) -> str:
        name = str(board_name or "").strip()
        if not name:
            return ""
        mapped = str(self._board_display_map.get(name) or "").strip()
        if mapped:
            return mapped
        mapped_by_label = str(self._board_display_map.get(self._board_display_key_by_label.get(name, "")) or "").strip()
        if mapped_by_label:
            return mapped_by_label
        legacy = re.match(r"^(.*?)\s*\(\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*\)\s*$", name)
        if legacy:
            base = str(legacy.group(1) or "").strip() or name
            try:
                a = float(legacy.group(2))
                b = float(legacy.group(3))
                long_edge = max(a, b)
                meters = long_edge / 1000.0
                compact = f"{(math.floor(meters * 10.0) / 10.0):.1f}"
                return f"[{compact}] {base}"
            except Exception:
                return base
        sheet_txt = str(self._board_sheet_sizes.get(name) or self._board_sheet_sizes_norm.get(self._part_key(name)) or "").strip()
        compact = self._compact_sheet_size_text(sheet_txt)
        if compact:
            return f"[{compact}] {name}"
        return name

    def _board_summary_text(self, board_name: str) -> str:
        board = self._normalize_board_value(board_name)
        full = self._board_display_text(board) or board or "No board"
        base = re.sub(r"^\[\s*\d+(?:\.\d+)?\s*\]\s*", "", full).strip()
        base = re.sub(r"\s*\(\s*\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?)?\s*(?:m)?\s*\)\s*$", "", base, flags=re.IGNORECASE).strip() or full
        sheet_w, sheet_h = self._sheet_size_for_board(board)
        compact_m = self._compact_meter_sheet_size_text(sheet_w, sheet_h)
        if compact_m:
            return f"[{compact_m}] {base}"
        return base

    def _split_board_chip(self, text: str) -> tuple[str, str]:
        src = str(text or "").strip()
        m = re.match(r"^\[\s*([0-9]+(?:\.[0-9]+)?)\s*\]\s*(.+)$", src)
        if m:
            return str(m.group(1) or "").strip(), str(m.group(2) or "").strip()
        return "", src

    def _normalize_board_value(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        if text in self._board_options_seed:
            return text
        if text in self._board_display_key_by_label:
            return str(self._board_display_key_by_label[text] or "").strip()
        norm = self._part_key(text)
        for key in self._board_options_seed:
            if self._part_key(key) == norm:
                return key
        return text

    def _add_board_combo_items(self, combo: QComboBox, include_empty: bool = True) -> None:
        if include_empty:
            combo.addItem("", "")
        for opt in self._board_options():
            name = str(opt or "").strip()
            if not name:
                continue
            combo.addItem(self._board_display_text(name), name)

    def _combo_selected_value(self, combo: QComboBox) -> str:
        data = combo.currentData()
        if data is None:
            return self._normalize_board_value(str(combo.currentText()).strip())
        text = str(data).strip()
        return self._normalize_board_value(text if text else str(combo.currentText()).strip())

    def _set_board_combo_value(self, combo: QComboBox, value: str) -> None:
        board_value = self._normalize_board_value(value)
        idx = combo.findData(board_value)
        if idx < 0 and board_value:
            combo.addItem(self._board_display_text(board_value), board_value)
            idx = combo.findData(board_value)
        if idx < 0:
            idx = combo.findData("")
        if idx < 0:
            idx = 0
        combo.setCurrentIndex(idx)

    def _parse_drawer_height_tokens(self, value: str) -> list[str]:
        txt = str(value or "").strip()
        if not txt:
            return []
        raw_tokens = [t.strip() for t in re.split(r"[,+/\\\s]+", txt) if t.strip()]
        out: list[str] = []
        for tok in raw_tokens:
            out.append(tok)
        return out

    def _set_row_drawer_height_values(self, row_def: dict[str, object], values: list[str]) -> None:
        vals: list[str] = []
        for v in (values or []):
            tok = str(v or "").strip().strip(",").strip()
            if tok:
                vals.append(tok)
        row_def["height_drawer_values"] = list(vals)
        text = ", ".join(vals)
        picker = row_def.get("height_picker_btn")
        picker_lbl = row_def.get("height_picker_label")
        if isinstance(picker, QPushButton):
            picker.setText("+")
            picker.setToolTip(text)
        if isinstance(picker_lbl, (QLabel, QLineEdit)):
            picker_lbl.setText(text)
            picker_lbl.setToolTip(text)
            if isinstance(picker_lbl, QLineEdit):
                picker_lbl.setCursorPosition(0)
        picker_widget = row_def.get("height_picker_widget")
        if isinstance(picker_widget, QWidget):
            picker_widget.setToolTip(text)
        line = row_def.get("height_line_edit")
        if isinstance(line, QLineEdit):
            line.setText(text)
        self._sync_row_drawer_quantity_from_height(row_def)
        self._update_row_drawer_inline_overflow(row_def)
        overlay = row_def.get("height_hover_overlay")
        if isinstance(overlay, QFrame) and overlay.isVisible():
            self._show_row_drawer_height_overlay(row_def, picker_lbl if isinstance(picker_lbl, QWidget) else picker_widget)
        self._update_entry_row_dynamic_widths(row_def)

    def _sync_row_drawer_quantity_from_height(self, row_def: dict[str, object]) -> None:
        inputs = row_def.get("inputs")
        qty_widget = inputs.get("quantity") if isinstance(inputs, dict) else None
        if not isinstance(qty_widget, QLineEdit):
            return
        part_name = str(row_def.get("partType") or "").strip()
        if not self._part_type_is_drawer(part_name):
            return
        vals = [str(v).strip() for v in (row_def.get("height_drawer_values") or []) if str(v).strip()]
        qty = max(1, len(vals))
        next_txt = str(qty)
        if str(qty_widget.text() or "").strip() != next_txt:
            qty_widget.setText(next_txt)

    def _update_row_drawer_inline_overflow(self, row_def: dict[str, object]) -> None:
        # Disabled: inline overflow text caused stray floating text artifacts.
        overflow = row_def.get("height_inline_overflow_label")
        if isinstance(overflow, QLabel):
            overflow.hide()

    def _drawer_height_text_overflows(self, row_def: dict[str, object], text: str | None = None) -> bool:
        picker_lbl = row_def.get("height_picker_label")
        if not isinstance(picker_lbl, QLineEdit):
            return False
        txt = str(text if text is not None else picker_lbl.text() or "").strip()
        if not txt:
            return False
        fm = picker_lbl.fontMetrics()
        # Match drawer-height field horizontal padding.
        available = max(1, int(picker_lbl.width()) - 16)
        return int(fm.horizontalAdvance(txt)) > available

    def _show_row_drawer_height_overlay(self, row_def: dict[str, object], anchor: QWidget | None) -> None:
        if not isinstance(anchor, QWidget):
            return
        vals = [str(v).strip() for v in (row_def.get("height_drawer_values") or []) if str(v).strip()]
        if not vals:
            self._hide_row_drawer_height_overlay(row_def)
            return
        text = ", ".join(vals)
        if not self._drawer_height_text_overflows(row_def, text):
            self._hide_row_drawer_height_overlay(row_def)
            return

        overlay = row_def.get("height_hover_overlay")
        label = row_def.get("height_hover_overlay_label")
        if not isinstance(overlay, QFrame) or not isinstance(label, QLabel):
            overlay = HoverOverlayFrame(
                on_hover=lambda _w, entered, rd=row_def: self._on_row_drawer_height_overlay_hover(rd, entered),
                on_click=lambda w, rd=row_def: self._on_row_drawer_height_overlay_click(rd, w),
                parent=self,
            )
            overlay.setObjectName("DrawerHeightHoverOverlay")
            overlay.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
            overlay.setCursor(Qt.CursorShape.PointingHandCursor)
            overlay.setStyleSheet(
                "QFrame#DrawerHeightHoverOverlay {"
                "background: #FFFFFF;"
                "border: 1px solid #E4E6EC;"
                "border-radius: 8px;"
                "}"
            )
            lay = QHBoxLayout(overlay)
            lay.setContentsMargins(8, 2, 8, 2)
            lay.setSpacing(0)
            label = QLabel(overlay)
            label.setStyleSheet("QLabel { color: #1F2937; font-size: 12px; font-weight: 600; background: transparent; border: none; }")
            lay.addWidget(label)
            row_def["height_hover_overlay"] = overlay
            row_def["height_hover_overlay_label"] = label

        part_name = str(row_def.get("partType") or "").strip()
        base = QColor(self._header_color_for_type(part_name))
        input_bg = base.lighter(112).name()
        input_border = base.darker(115).name()
        text_color = "#FFFFFF" if base.lightness() < 130 else "#1F2937"
        overlay.setStyleSheet(
            "QFrame#DrawerHeightHoverOverlay {"
            f"background: {input_bg};"
            f"border: 1px solid {input_border};"
            "border-radius: 8px;"
            "}"
        )
        label.setStyleSheet(
            "QLabel {"
            f"color: {text_color};"
            "font-size: 12px; font-weight: 600; background: transparent; border: none;"
            "}"
        )
        label.setText(text)
        fm = label.fontMetrics()
        width = max(60, int(fm.horizontalAdvance(text)) + 18)
        height = 30
        global_pos = anchor.mapToGlobal(QPoint(0, 0))
        local_pos = self.mapFromGlobal(global_pos)
        overlay.setGeometry(local_pos.x(), local_pos.y(), width, height)
        overlay.show()
        overlay.raise_()

    def _hide_row_drawer_height_overlay(self, row_def: dict[str, object]) -> None:
        overlay = row_def.get("height_hover_overlay")
        if isinstance(overlay, QFrame):
            overlay.hide()
        row_def["_height_overlay_hover"] = False
        row_def["_height_label_hover"] = False

    def _schedule_hide_row_drawer_height_overlay(self, row_def: dict[str, object]) -> None:
        def _do_hide(rd=row_def):
            if bool(rd.get("_height_label_hover")) or bool(rd.get("_height_overlay_hover")):
                return
            self._hide_row_drawer_height_overlay(rd)

        QTimer.singleShot(120, _do_hide)

    def _on_row_drawer_height_hover(self, row_def: dict[str, object], anchor: QWidget | None, entered: bool) -> None:
        row_def["_height_label_hover"] = bool(entered)
        if entered:
            self._show_row_drawer_height_overlay(row_def, anchor)
        else:
            self._schedule_hide_row_drawer_height_overlay(row_def)

    def _on_row_drawer_height_overlay_hover(self, row_def: dict[str, object], entered: bool) -> None:
        row_def["_height_overlay_hover"] = bool(entered)
        if not entered:
            self._schedule_hide_row_drawer_height_overlay(row_def)

    def _on_row_drawer_height_overlay_click(self, row_def: dict[str, object], anchor: QWidget | None) -> None:
        target = anchor
        if not isinstance(target, QWidget):
            target = row_def.get("height_picker_label")
        if isinstance(target, QWidget):
            self._open_row_drawer_height_picker(row_def, target)

    def _clear_inline_drawer_height_overlays(self) -> None:
        store = getattr(self, "_inline_drawer_height_overlays", None)
        if not isinstance(store, dict):
            self._inline_drawer_height_overlays = {}
            return
        for state in list(store.values()):
            if not isinstance(state, dict):
                continue
            overlay = state.get("overlay")
            if isinstance(overlay, QWidget):
                overlay.hide()
                overlay.deleteLater()
        store.clear()

    def _inline_drawer_height_text_overflows(self, anchor: QWidget | None, text: str) -> bool:
        if not isinstance(anchor, (QLineEdit, QLabel)):
            return False
        txt = str(text or "").strip()
        if not txt:
            return False
        fm = anchor.fontMetrics()
        available = max(1, int(anchor.width()) - (16 if isinstance(anchor, QLineEdit) else 8))
        return int(fm.horizontalAdvance(txt)) > available

    def _show_inline_drawer_height_overlay(self, row_id: int, anchor: QWidget | None) -> None:
        if not isinstance(anchor, QWidget):
            return
        vals = self._inline_drawer_height_values(int(row_id))
        text = ", ".join(vals)
        if not text or not self._inline_drawer_height_text_overflows(anchor, text):
            self._hide_inline_drawer_height_overlay(int(row_id))
            return
        store = getattr(self, "_inline_drawer_height_overlays", None)
        if not isinstance(store, dict):
            store = {}
            self._inline_drawer_height_overlays = store
        state = store.get(int(row_id))
        if not isinstance(state, dict):
            state = {"label_hover": False, "overlay_hover": False}
            store[int(row_id)] = state

        overlay = state.get("overlay")
        label = state.get("label")
        if not isinstance(overlay, QFrame) or not isinstance(label, QLabel):
            overlay = HoverOverlayFrame(
                on_hover=lambda _w, entered, rid=int(row_id): self._on_inline_drawer_height_overlay_hover(rid, entered),
                on_click=lambda w, rid=int(row_id): self._on_inline_drawer_height_overlay_click(rid, w),
                parent=self,
            )
            overlay.setObjectName("InlineDrawerHeightHoverOverlay")
            overlay.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
            overlay.setCursor(Qt.CursorShape.PointingHandCursor)
            lay = QHBoxLayout(overlay)
            lay.setContentsMargins(8, 2, 8, 2)
            lay.setSpacing(0)
            label = QLabel(overlay)
            lay.addWidget(label)
            state["overlay"] = overlay
            state["label"] = label

        row_bg = "#FFFFFF"
        loc = self._row_locators.get(int(row_id)) if isinstance(getattr(self, "_row_locators", None), dict) else None
        if isinstance(loc, dict):
            row_bg = str(loc.get("base_row_bg") or row_bg)
        row_q = QColor(str(row_bg or "#FFFFFF"))
        if not row_q.isValid():
            row_q = QColor("#FFFFFF")
        input_bg = row_q.name()
        input_border = row_q.darker(116).name()
        text_color = "#FFFFFF" if row_q.lightness() < 140 else "#111827"
        overlay.setStyleSheet(
            "QFrame#InlineDrawerHeightHoverOverlay {"
            f"background: {input_bg};"
            f"border: 1px solid {input_border};"
            "border-radius: 8px;"
            "}"
        )
        label.setStyleSheet(
            "QLabel {"
            f"color: {text_color};"
            "font-size: 12px; font-weight: 600; background: transparent; border: none;"
            "}"
        )
        label.setText(text)
        fm = label.fontMetrics()
        width = max(60, int(fm.horizontalAdvance(text)) + 18)
        height = 26
        global_pos = anchor.mapToGlobal(QPoint(0, 0))
        local_pos = self.mapFromGlobal(global_pos)
        y_offset = int((anchor.height() - height) / 2)
        overlay.setGeometry(local_pos.x(), local_pos.y() + y_offset, width, height)
        state["anchor"] = anchor
        overlay.show()
        overlay.raise_()

    def _hide_inline_drawer_height_overlay(self, row_id: int) -> None:
        store = getattr(self, "_inline_drawer_height_overlays", None)
        if not isinstance(store, dict):
            return
        state = store.get(int(row_id))
        if not isinstance(state, dict):
            return
        overlay = state.get("overlay")
        if isinstance(overlay, QWidget):
            overlay.hide()
        state["label_hover"] = False
        state["overlay_hover"] = False

    def _schedule_hide_inline_drawer_height_overlay(self, row_id: int) -> None:
        def _do_hide(rid=int(row_id)):
            store = getattr(self, "_inline_drawer_height_overlays", None)
            if not isinstance(store, dict):
                return
            state = store.get(int(rid))
            if not isinstance(state, dict):
                return
            if bool(state.get("label_hover")) or bool(state.get("overlay_hover")):
                return
            self._hide_inline_drawer_height_overlay(int(rid))

        QTimer.singleShot(120, _do_hide)

    def _on_inline_drawer_height_hover(self, row_id: int, anchor: QWidget | None, entered: bool) -> None:
        store = getattr(self, "_inline_drawer_height_overlays", None)
        if not isinstance(store, dict):
            store = {}
            self._inline_drawer_height_overlays = store
        state = store.get(int(row_id))
        if not isinstance(state, dict):
            state = {"label_hover": False, "overlay_hover": False}
            store[int(row_id)] = state
        state["label_hover"] = bool(entered)
        state["anchor"] = anchor
        if entered:
            self._show_inline_drawer_height_overlay(int(row_id), anchor)
        else:
            self._schedule_hide_inline_drawer_height_overlay(int(row_id))

    def _on_inline_drawer_height_overlay_hover(self, row_id: int, entered: bool) -> None:
        store = getattr(self, "_inline_drawer_height_overlays", None)
        if not isinstance(store, dict):
            return
        state = store.get(int(row_id))
        if not isinstance(state, dict):
            return
        state["overlay_hover"] = bool(entered)
        if not entered:
            self._schedule_hide_inline_drawer_height_overlay(int(row_id))

    def _on_inline_drawer_height_overlay_click(self, row_id: int, anchor: QWidget | None) -> None:
        target = anchor
        if not isinstance(target, QWidget):
            store = getattr(self, "_inline_drawer_height_overlays", None)
            if isinstance(store, dict):
                state = store.get(int(row_id))
                if isinstance(state, dict) and isinstance(state.get("anchor"), QWidget):
                    target = state.get("anchor")
        if isinstance(target, QWidget):
            self._open_inline_drawer_height_picker(int(row_id), target)

    def _update_entry_row_dynamic_widths(self, row_def: dict[str, object]) -> None:
        layout = row_def.get("row_layout")
        col_map = row_def.get("entry_col_map")
        if not isinstance(layout, QGridLayout) or not isinstance(col_map, dict):
            return
        try:
            height_col = int(col_map.get("height", -1))
            info_col = int(col_map.get("information", -1))
            name_col = int(col_map.get("name", -1))
        except Exception:
            return
        if height_col <= 0 or info_col <= 0 or name_col <= 0:
            return

        base_h = int(self.ENTRY_FIELD_WIDTHS.get("height", 76))
        base_name = int(self.ENTRY_FIELD_WIDTHS.get("name", 240))
        base_info = int(self.ENTRY_FIELD_WIDTHS.get("information", 220))

        # Keep all entry columns fixed; no dynamic shifting.
        layout.setColumnMinimumWidth(height_col, base_h)
        layout.setColumnMinimumWidth(name_col, base_name)
        layout.setColumnMinimumWidth(info_col, base_info)

    def _append_row_drawer_height_value(self, row_def: dict[str, object], token: str) -> None:
        chosen = str(token or "").strip().strip(",").strip()
        if not chosen:
            return
        vals = [str(v).strip() for v in (row_def.get("height_drawer_values") or []) if str(v).strip()]
        vals.append(chosen)
        self._set_row_drawer_height_values(row_def, vals)
        self._queue_autosave()

    def _populate_row_drawer_height_combo(self, row_def: dict[str, object]) -> None:
        picker = row_def.get("height_picker_btn")
        if not isinstance(picker, QComboBox):
            return
        current_vals = [str(v).strip() for v in (row_def.get("height_drawer_values") or []) if str(v).strip()]
        current = current_vals[0] if current_vals else ""
        options = [str(v or "").strip() for v in self._drawer_height_letter_options() if str(v or "").strip()]
        picker.blockSignals(True)
        picker.clear()
        picker.addItem("")
        for tok in options:
            picker.addItem(tok)
        idx = picker.findText(current) if current else 0
        picker.setCurrentIndex(idx if idx >= 0 else 0)
        picker.blockSignals(False)

    def _drawer_height_selected_count(self, row_def: dict[str, object], token: str) -> int:
        chosen = str(token or "").strip()
        if not chosen:
            return 0
        vals = [str(v).strip() for v in (row_def.get("height_drawer_values") or []) if str(v).strip()]
        return int(sum(1 for v in vals if v == chosen))

    def _drawer_height_option_label(self, row_def: dict[str, object], token: str) -> str:
        chosen = str(token or "").strip()
        count = self._drawer_height_selected_count(row_def, chosen)
        return f"({count}) {chosen}" if count > 0 else chosen

    def _remove_row_drawer_height_value(self, row_def: dict[str, object], token: str) -> None:
        chosen = str(token or "").strip()
        if not chosen:
            return
        vals = [str(v).strip() for v in (row_def.get("height_drawer_values") or []) if str(v).strip()]
        try:
            idx = vals.index(chosen)
        except ValueError:
            return
        vals.pop(idx)
        self._set_row_drawer_height_values(row_def, vals)
        self._queue_autosave()

    def _open_row_drawer_height_picker(self, row_def: dict[str, object], anchor: QWidget | None) -> None:
        if not isinstance(anchor, QWidget):
            return
        menu = QMenu(anchor)
        menu.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        menu.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        menu.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        menu.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
        menu.setWindowFlag(Qt.WindowType.NoDropShadowWindowHint, True)
        menu.setStyleSheet(
            "QMenu { background: rgba(255,255,255,255); border: 1px solid #D9DEE8; border-radius: 8px; padding: 4px; }"
        )
        options = self._drawer_height_letter_options()
        options = [str(letter or "").strip() for letter in options if str(letter or "").strip()]

        def _refresh_menu() -> None:
            menu.clear()
            if not options:
                action = menu.addAction("No letters configured")
                action.setEnabled(False)
                return
            fm = menu.fontMetrics()
            longest = 0
            for tok in options:
                count = self._drawer_height_selected_count(row_def, tok)
                label_txt = (f"({count}) {tok}") if count > 0 else tok
                longest = max(longest, int(fm.horizontalAdvance(label_txt)))
            # text + left/right margins + spacing + add button + remove button
            row_width = max(118, longest + 8 + 6 + 6 + 18 + 6 + 18 + 8)
            for tok in options:
                count = self._drawer_height_selected_count(row_def, tok)
                row_w = QWidget(menu)
                row_w.setFixedWidth(row_width)
                row_lay = QHBoxLayout(row_w)
                row_lay.setContentsMargins(8, 2, 6, 2)
                row_lay.setSpacing(6)

                label = QLabel((f"({count}) {tok}") if count > 0 else tok, row_w)
                label.setStyleSheet("QLabel { color: #1F2937; font-size: 12px; font-weight: 600; background: transparent; border: none; }")
                label.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

                add_btn = QPushButton("+", row_w)
                add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_btn.setFixedSize(18, 18)
                add_btn.setStyleSheet(
                    "QPushButton { color: #1F8A4C; background: #EAF8F0; border: 1px solid #BFE8CF; border-radius: 6px; font-family: Consolas; font-size: 12px; font-weight: 700; padding: 0; }"
                    "QPushButton:hover { background: #DDF2E7; }"
                )
                add_btn.clicked.connect(lambda _=False, rd=row_def, t=tok: (self._append_row_drawer_height_value(rd, t), _refresh_menu()))

                remove_btn = QPushButton("X", row_w)
                remove_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                remove_btn.setFixedSize(18, 18)
                remove_btn.setEnabled(count > 0)
                remove_btn.setStyleSheet(
                    "QPushButton { color: #D14343; background: #FFECEC; border: 1px solid #F7B8B8; border-radius: 6px; font-size: 10px; font-weight: 700; padding: 0; }"
                    "QPushButton:hover { background: #FFDCDC; }"
                    "QPushButton:disabled { color: #C7CDD8; background: #F7F8FB; border: 1px solid #E4E7EE; }"
                )
                remove_btn.clicked.connect(lambda _=False, rd=row_def, t=tok: (self._remove_row_drawer_height_value(rd, t), _refresh_menu()))

                row_lay.addWidget(label, 1)
                row_lay.addWidget(add_btn, 0)
                row_lay.addWidget(remove_btn, 0)

                wa = QWidgetAction(menu)
                wa.setDefaultWidget(row_w)
                menu.addAction(wa)

        _refresh_menu()
        row_def["height_picker_menu"] = menu
        menu.aboutToHide.connect(lambda rd=row_def: rd.pop("height_picker_menu", None))
        pos = anchor.mapToGlobal(QPoint(0, max(0, anchor.height())))
        menu.popup(pos)

    def _inline_drawer_height_values(self, row_id: int) -> list[str]:
        row = self._row_by_id(int(row_id))
        if not isinstance(row, dict):
            return []
        return [str(v).strip() for v in self._parse_drawer_height_tokens(str(row.get("height") or "")) if str(v).strip()]

    def _set_inline_drawer_height_values(self, row_id: int, values: list[str], refresh_view: bool = True) -> None:
        row = self._row_by_id(int(row_id))
        if not isinstance(row, dict):
            return
        vals = [str(v or "").strip().strip(",").strip() for v in (values or [])]
        vals = [v for v in vals if v]
        row["height"] = ", ".join(vals)
        part_name = str(row.get("partType") or "").strip()
        if self._is_drawer_part_type(part_name):
            row["quantity"] = str(max(1, len(vals)))
        self._queue_autosave()
        if bool(refresh_view):
            self._refresh_filters_and_summary()

    def _open_inline_drawer_height_picker(self, row_id: int, anchor: QWidget | None) -> None:
        if not isinstance(anchor, QWidget):
            return
        row = self._row_by_id(int(row_id))
        if not isinstance(row, dict):
            return
        part_name = str(row.get("partType") or "").strip()
        if not self._is_drawer_part_type(part_name):
            return

        options = [str(letter or "").strip() for letter in self._drawer_height_letter_options() if str(letter or "").strip()]
        menu = QMenu(anchor)
        menu.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        menu.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        menu.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        menu.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
        menu.setWindowFlag(Qt.WindowType.NoDropShadowWindowHint, True)
        menu.setStyleSheet(
            "QMenu { background: rgba(255,255,255,255); border: 1px solid #D9DEE8; border-radius: 8px; padding: 4px; }"
        )
        menu.aboutToHide.connect(self._refresh_filters_and_summary)

        if not options:
            action = menu.addAction("No letters configured")
            action.setEnabled(False)
            pos = anchor.mapToGlobal(QPoint(0, max(0, anchor.height())))
            menu.popup(pos)
            return

        fm = menu.fontMetrics()
        def _refresh_menu() -> None:
            menu.clear()
            current_vals = self._inline_drawer_height_values(int(row_id))
            longest = 0
            for tok in options:
                count = int(sum(1 for v in current_vals if v == tok))
                label_txt = (f"({count}) {tok}") if count > 0 else tok
                longest = max(longest, int(fm.horizontalAdvance(label_txt)))
            row_width = max(118, longest + 8 + 6 + 6 + 18 + 6 + 18 + 8)

            for tok in options:
                count = int(sum(1 for v in current_vals if v == tok))
                row_w = QWidget(menu)
                row_w.setFixedWidth(row_width)
                row_lay = QHBoxLayout(row_w)
                row_lay.setContentsMargins(8, 2, 6, 2)
                row_lay.setSpacing(6)

                label = QLabel((f"({count}) {tok}") if count > 0 else tok, row_w)
                label.setStyleSheet("QLabel { color: #1F2937; font-size: 12px; font-weight: 600; background: transparent; border: none; }")
                label.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

                add_btn = QPushButton("+", row_w)
                add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_btn.setFixedSize(18, 18)
                add_btn.setStyleSheet(
                    "QPushButton { color: #1F8A4C; background: #EAF8F0; border: 1px solid #BFE8CF; border-radius: 6px; font-family: Consolas; font-size: 12px; font-weight: 700; padding: 0; }"
                    "QPushButton:hover { background: #DDF2E7; }"
                )

                remove_btn = QPushButton("X", row_w)
                remove_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                remove_btn.setFixedSize(18, 18)
                remove_btn.setEnabled(count > 0)
                remove_btn.setStyleSheet(
                    "QPushButton { color: #D14343; background: #FFECEC; border: 1px solid #F7B8B8; border-radius: 6px; font-size: 10px; font-weight: 700; padding: 0; }"
                    "QPushButton:hover { background: #FFDCDC; }"
                    "QPushButton:disabled { color: #C7CDD8; background: #F7F8FB; border: 1px solid #E4E7EE; }"
                )

                def _add(_=False, rid=int(row_id), token=tok):
                    vals = self._inline_drawer_height_values(rid)
                    vals.append(str(token))
                    self._set_inline_drawer_height_values(rid, vals, refresh_view=False)
                    txt = ", ".join(vals)
                    if isinstance(anchor, QLineEdit):
                        anchor.setText(txt)
                        anchor.setToolTip(txt)
                        anchor.setCursorPosition(0)
                    _refresh_menu()

                def _remove(_=False, rid=int(row_id), token=tok):
                    vals = self._inline_drawer_height_values(rid)
                    try:
                        idx = vals.index(str(token))
                    except ValueError:
                        idx = -1
                    if idx >= 0:
                        vals.pop(idx)
                    self._set_inline_drawer_height_values(rid, vals, refresh_view=False)
                    txt = ", ".join(vals)
                    if isinstance(anchor, QLineEdit):
                        anchor.setText(txt)
                        anchor.setToolTip(txt)
                        anchor.setCursorPosition(0)
                    _refresh_menu()

                add_btn.clicked.connect(_add)
                remove_btn.clicked.connect(_remove)

                row_lay.addWidget(label, 1)
                row_lay.addWidget(add_btn, 0)
                row_lay.addWidget(remove_btn, 0)

                wa = QWidgetAction(menu)
                wa.setDefaultWidget(row_w)
                menu.addAction(wa)

        _refresh_menu()

        pos = anchor.mapToGlobal(QPoint(0, max(0, anchor.height())))
        menu.popup(pos)

    def _apply_row_drawer_mode(self, row_def: dict[str, object], part_name: str) -> None:
        inputs = row_def.get("inputs")
        height_host = inputs.get("height") if isinstance(inputs, dict) else None
        if not isinstance(height_host, QWidget):
            return
        stack = row_def.get("height_stack")
        line = row_def.get("height_line_edit")
        picker = row_def.get("height_picker_btn")
        picker_widget = row_def.get("height_picker_widget")
        if not isinstance(stack, QStackedWidget) or not isinstance(line, QLineEdit) or not isinstance(picker_widget, QWidget):
            return
        is_drawer = self._part_type_is_drawer(part_name)
        clash_widget = inputs.get("clashing") if isinstance(inputs, dict) else None
        combo_l = clash_widget.findChild(QComboBox, "clashingL") if isinstance(clash_widget, QWidget) else None
        combo_s = clash_widget.findChild(QComboBox, "clashingS") if isinstance(clash_widget, QWidget) else None
        if is_drawer:
            if isinstance(combo_l, QComboBox):
                combo_l.setCurrentIndex(0)
                combo_l.setEnabled(False)
            if isinstance(combo_s, QComboBox):
                combo_s.setCurrentIndex(0)
                combo_s.setEnabled(False)
            height_host.setFixedHeight(30)
            stack.setFixedHeight(30)
            if isinstance(picker, QPushButton):
                picker.setFixedHeight(24)
            current_vals = list(row_def.get("height_drawer_values") or [])
            if not current_vals:
                current_vals = self._parse_drawer_height_tokens(str(line.text() or ""))
            self._set_row_drawer_height_values(row_def, current_vals)
            stack.setCurrentWidget(picker_widget)
            self._reevaluate_drawer_depth_error_state(row_def)
        else:
            if isinstance(combo_l, QComboBox):
                combo_l.setEnabled(True)
            if isinstance(combo_s, QComboBox):
                combo_s.setEnabled(True)
            height_host.setFixedHeight(30)
            stack.setFixedHeight(30)
            line.setFixedHeight(30)
            drawer_vals = list(row_def.get("height_drawer_values") or [])
            combo_val = ", ".join([str(v).strip() for v in drawer_vals if str(v).strip()])
            if not str(line.text() or "").strip() and combo_val:
                line.setText(combo_val)
            stack.setCurrentWidget(line)
            self._hide_row_drawer_height_overlay(row_def)
            overflow = row_def.get("height_inline_overflow_label")
            if isinstance(overflow, QLabel):
                overflow.hide()
            if isinstance(inputs, dict):
                depth_widget = inputs.get("depth")
                if isinstance(depth_widget, QWidget):
                    self._set_persistent_missing_error(depth_widget, False)
        row_def["height_is_drawer"] = bool(is_drawer)
        if is_drawer:
            self._sync_row_drawer_quantity_from_height(row_def)
        self._update_row_drawer_inline_overflow(row_def)
        self._update_entry_row_dynamic_widths(row_def)

    def _board_is_lacquer(self, board_value: str) -> bool:
        board = self._normalize_board_value(board_value)
        if bool(self._board_lacquer_map.get(board)):
            return True
        src = str(board_value or "").strip()
        if src and bool(self._board_lacquer_map.get(src)):
            return True
        return bool(self._board_lacquer_map.get(self._part_key(board))) or bool(self._board_lacquer_map.get(self._part_key(src)))

    def _board_thickness_for_row(self, row: dict) -> float:
        board_raw = str((row or {}).get("board") or "").strip()
        board = self._normalize_board_value(board_raw)
        val = (
            self._board_thickness_map.get(board)
            or self._board_thickness_map.get(board_raw)
            or self._board_thickness_map_norm.get(self._part_key(board))
            or self._board_thickness_map_norm.get(self._part_key(board_raw))
            or 0.0
        )
        try:
            num = float(val)
        except Exception:
            return 0.0
        return num if math.isfinite(num) and num > 0 else 0.0

    def _blank_entry_payload(self) -> dict[str, str]:
        payload = {key: "" for _label, key in self._fields}
        payload["partType"] = str(self._active_part_type or "").strip()
        payload["room"] = str(self._active_room or "All").strip()
        payload["fixedShelfDrilling"] = "No"
        payload["adjustableShelfDrilling"] = "No"
        return payload

    def _refresh_entry_empty_state(self) -> None:
        room_key = self._part_key(str(self._active_room or ""))
        has_rows = False
        if room_key and room_key != "all":
            for row_def in self._entry_input_rows:
                if self._part_key(str((row_def or {}).get("room") or "")) == room_key:
                    has_rows = True
                    break
        room_has_parts = False
        if room_key and room_key != "all":
            for row in self._rows_data:
                if self._part_key(str((row or {}).get("room") or "")) == room_key:
                    room_has_parts = True
                    break
        show_hint = (not has_rows) and (room_key != "all") and (not room_has_parts)
        if isinstance(self._entry_labels_host, QWidget):
            self._entry_labels_host.setVisible(has_rows)
        if isinstance(self._entry_row_host, QFrame):
            self._entry_row_host.setVisible(has_rows)
        if isinstance(self._entry_empty_hint, QWidget):
            self._entry_empty_hint.setVisible(show_hint)

    def _payload_signature(self) -> str:
        try:
            return json.dumps(self.cutlist_payload(), sort_keys=True)
        except Exception:
            return ""

    def _queue_autosave(self) -> None:
        if bool(self._suspend_autosave):
            return
        self._autosave_timer.start(220)

    def _emit_autosave(self) -> None:
        if bool(self._suspend_autosave):
            return
        sig = self._payload_signature()
        if not sig or sig == self._last_autosave_signature:
            return
        self._last_autosave_signature = sig
        if callable(self._on_change):
            try:
                self._on_change(self.cutlist_payload())
            except Exception:
                pass

    def entry_draft_rows_payload(self) -> list[dict]:
        out: list[dict] = []
        for row_def in self._entry_input_rows:
            data = self._collect_entry_row_values(row_def)
            if not isinstance(data, dict):
                continue
            data["partType"] = str((row_def or {}).get("partType") or data.get("partType") or self._active_part_type or "").strip()
            meaningful_keys = set(k for _l, k in self._fields)
            meaningful_keys.update({"fixedShelf", "adjustableShelf", "fixedShelfDrilling", "adjustableShelfDrilling"})
            has_value = any(bool(str(data.get(k, "")).strip()) for k in meaningful_keys if k != "partType")
            if not has_value:
                continue
            payload = {k: str(v or "").strip() for k, v in data.items() if isinstance(k, str)}
            payload["room"] = self._normalize_room_name(str((row_def or {}).get("room") or payload.get("room") or ""))
            out.append(payload)
        return out

    def cutlist_payload(self) -> dict:
        rooms = [r for r in self._room_options() if self._part_key(r) != "all"]
        return {
            "rows": self.rows_payload(),
            "entryDraftRows": self.entry_draft_rows_payload(),
            "collapsedPartTypes": sorted(self._collapsed_part_types),
            "rooms": rooms,
            "roomsWithPieces": sorted(self._rooms_with_pieces),
            "activeRoom": str(self._active_room or "All"),
            "activePartType": str(self._active_part_type or ""),
        }

    def _remove_entry_input_row(self, frame: QFrame) -> None:
        for idx, row_def in enumerate(list(self._entry_input_rows)):
            row_frame = row_def.get("frame")
            if row_frame is frame:
                self._entry_input_rows.pop(idx)
                frame.setParent(None)
                frame.deleteLater()
                break
        if self._entry_input_rows:
            primary_inputs = self._entry_input_rows[0].get("inputs")
            if isinstance(primary_inputs, dict):
                self._quick_inputs = primary_inputs
        self._refresh_entry_empty_state()
        self._queue_autosave()

    def _set_entry_row_values(self, row_def: dict[str, object], values: dict[str, str]) -> None:
        inputs = row_def.get("inputs")
        if not isinstance(inputs, dict):
            return
        row_def["partType"] = str(values.get("partType") or row_def.get("partType") or self._active_part_type or "").strip()
        for _label, key in self._fields:
            if key == "partType":
                row_def["partType"] = str(values.get("partType") or row_def.get("partType") or self._active_part_type or "").strip()
                continue
            widget = inputs.get(key)
            value = str(values.get(key, ""))
            if widget is None:
                continue
            if key == "height" and isinstance(widget, QWidget):
                stack = row_def.get("height_stack")
                line = row_def.get("height_line_edit")
                picker = row_def.get("height_picker_btn")
                picker_widget = row_def.get("height_picker_widget")
                if isinstance(stack, QStackedWidget) and isinstance(line, QLineEdit):
                    if bool(row_def.get("height_is_drawer")):
                        tokens = self._parse_drawer_height_tokens(value)
                        self._set_row_drawer_height_values(row_def, tokens)
                        if isinstance(picker_widget, QWidget):
                            stack.setCurrentWidget(picker_widget)
                    else:
                        line.setText(value)
                        stack.setCurrentWidget(line)
                continue
            if isinstance(widget, QComboBox):
                if key == "board":
                    self._set_board_combo_value(widget, value)
                else:
                    idx = widget.findText(value)
                    widget.setCurrentIndex(idx if idx >= 0 else 0)
            elif key == "information" and isinstance(widget, QWidget):
                lines = [x.strip() for x in value.splitlines() if x.strip()]
                if not lines:
                    lines = [""]
                self._set_information_lines(row_def, lines)
            elif key == "clashing" and isinstance(widget, QWidget):
                combo_l = widget.findChild(QComboBox, "clashingL")
                combo_s = widget.findChild(QComboBox, "clashingS")
                l_val, s_val = self._split_clashing(value)
                if isinstance(combo_l, QComboBox):
                    idx_l = combo_l.findText(l_val)
                    combo_l.setCurrentIndex(idx_l if idx_l >= 0 else 0)
                if isinstance(combo_s, QComboBox):
                    idx_s = combo_s.findText(s_val)
                    combo_s.setCurrentIndex(idx_s if idx_s >= 0 else 0)
            elif isinstance(widget, QLineEdit):
                widget.setText(value)
        fixed_edit = row_def.get("fixed_shelf_edit")
        if isinstance(fixed_edit, QLineEdit):
            fixed_edit.setText(str(values.get("fixedShelf") or "").strip())
        adjustable_edit = row_def.get("adjustable_shelf_edit")
        if isinstance(adjustable_edit, QLineEdit):
            adjustable_edit.setText(str(values.get("adjustableShelf") or "").strip())
        fixed_drill = row_def.get("fixed_shelf_drilling_combo")
        if isinstance(fixed_drill, QComboBox):
            fixed_drill_val = self._normalize_drilling_value(str(values.get("fixedShelfDrilling") or "No").strip())
            idx_fd = fixed_drill.findText(fixed_drill_val)
            fixed_drill.setCurrentIndex(idx_fd if idx_fd >= 0 else 0)
        adjustable_drill = row_def.get("adjustable_shelf_drilling_combo")
        if isinstance(adjustable_drill, QComboBox):
            adjustable_drill_val = self._normalize_drilling_value(str(values.get("adjustableShelfDrilling") or "No").strip())
            idx_ad = adjustable_drill.findText(adjustable_drill_val)
            adjustable_drill.setCurrentIndex(idx_ad if idx_ad >= 0 else 0)
        row_def["room"] = self._normalize_room_name(str(values.get("room") or row_def.get("room") or self._active_room or ""))
        self._apply_entry_row_theme(
            row_def.get("frame"),
            inputs,
            str(row_def.get("partType") or self._active_part_type or "").strip(),
        )

    def _collect_entry_row_values(self, row_def: dict[str, object]) -> dict[str, str]:
        values: dict[str, str] = {}
        inputs = row_def.get("inputs")
        if not isinstance(inputs, dict):
            return values
        values["partType"] = str(row_def.get("partType") or self._active_part_type or "").strip()
        for _label, key in self._fields:
            if key == "partType":
                values[key] = str(row_def.get("partType") or self._active_part_type or "").strip()
                continue
            widget = inputs.get(key)
            if key == "height" and isinstance(widget, QWidget):
                stack = row_def.get("height_stack")
                line = row_def.get("height_line_edit")
                picker = row_def.get("height_picker_btn")
                picker_widget = row_def.get("height_picker_widget")
                if isinstance(stack, QStackedWidget) and isinstance(line, QLineEdit):
                    if isinstance(picker_widget, QWidget) and stack.currentWidget() is picker_widget:
                        drawer_vals = [str(v).strip() for v in (row_def.get("height_drawer_values") or []) if str(v).strip()]
                        values[key] = ", ".join(drawer_vals)
                    else:
                        values[key] = str(line.text()).strip()
                else:
                    values[key] = ""
                continue
            if isinstance(widget, QComboBox):
                if key == "board":
                    values[key] = self._combo_selected_value(widget)
                else:
                    values[key] = str(widget.currentText()).strip()
            elif key == "information" and isinstance(widget, QWidget):
                lines = self._information_lines_text(row_def)
                values[key] = "\n".join(lines).strip()
            elif key == "clashing" and isinstance(widget, QWidget):
                combo_l = widget.findChild(QComboBox, "clashingL")
                combo_s = widget.findChild(QComboBox, "clashingS")
                l_val = str(combo_l.currentText()).strip() if isinstance(combo_l, QComboBox) else ""
                s_val = str(combo_s.currentText()).strip() if isinstance(combo_s, QComboBox) else ""
                values[key] = " ".join([p for p in [l_val, s_val] if p]).strip()
            elif isinstance(widget, QLineEdit):
                values[key] = str(widget.text()).strip()
            else:
                values[key] = ""
        fixed_edit = row_def.get("fixed_shelf_edit")
        adjustable_edit = row_def.get("adjustable_shelf_edit")
        values["fixedShelf"] = str(fixed_edit.text()).strip() if isinstance(fixed_edit, QLineEdit) else ""
        values["adjustableShelf"] = str(adjustable_edit.text()).strip() if isinstance(adjustable_edit, QLineEdit) else ""
        fixed_drill = row_def.get("fixed_shelf_drilling_combo")
        adjustable_drill = row_def.get("adjustable_shelf_drilling_combo")
        values["fixedShelfDrilling"] = self._normalize_drilling_value(str(fixed_drill.currentText()).strip()) if isinstance(fixed_drill, QComboBox) else "No"
        values["adjustableShelfDrilling"] = self._normalize_drilling_value(str(adjustable_drill.currentText()).strip()) if isinstance(adjustable_drill, QComboBox) else "No"
        values["room"] = self._normalize_room_name(str(row_def.get("room") or self._active_room or ""))
        return values

    def _add_entry_input_row(self, seed: dict[str, str] | None = None) -> None:
        if self._entry_rows_layout is None:
            return

        row_frame = QFrame()
        row_layout = QGridLayout(row_frame)
        row_layout.setContentsMargins(3, 3, 3, 3)
        row_layout.setHorizontalSpacing(8)
        row_layout.setVerticalSpacing(4)

        row_layout.setColumnMinimumWidth(0, 28)
        row_layout.setColumnStretch(0, 0)
        for idx, (_label, key) in enumerate(self._entry_fields, start=1):
            row_layout.setColumnMinimumWidth(idx, self.ENTRY_FIELD_WIDTHS.get(key, 90))
            row_layout.setColumnStretch(idx, 1 if key == "information" else 0)

        row_def: dict[str, object] = {
            "frame": row_frame,
            "inputs": {},
            "partType": str((seed or {}).get("partType") or self._active_part_type or ""),
            "room": self._normalize_room_name(str((seed or {}).get("room") or self._active_room or "")),
            "row_layout": row_layout,
            "entry_col_map": {k: i for i, (_l, k) in enumerate(self._entry_fields, start=1)},
        }

        clear_row_btn = QPushButton("X")
        clear_row_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        clear_row_btn.setFixedSize(24, 24)
        clear_row_btn.setStyleSheet(
            "QPushButton { color: #D14343; background: #FFECEC; border: 1px solid #F7B8B8; border-radius: 8px; font-weight: 700; padding: 0; }"
            "QPushButton:hover { background: #FFDCDC; }"
        )
        clear_row_btn.clicked.connect(lambda _=False, rf=row_frame: self._remove_entry_input_row(rf))
        row_layout.addWidget(clear_row_btn, 0, 0)

        inputs: dict[str, QWidget] = {}
        for idx, (_label, key) in enumerate(self._entry_fields, start=1):
            if key == "height":
                height_host = QWidget()
                height_lay = QHBoxLayout(height_host)
                height_lay.setContentsMargins(0, 0, 0, 0)
                height_lay.setSpacing(0)
                height_stack = QStackedWidget()
                height_edit = QLineEdit()
                height_edit.setAlignment(Qt.AlignmentFlag.AlignCenter)
                self._apply_numeric_validator(height_edit)
                height_picker_host = QWidget()
                picker_row = QHBoxLayout(height_picker_host)
                picker_row.setContentsMargins(0, 0, 0, 0)
                picker_row.setSpacing(0)
                height_picker_label = HoverLetterLineEdit(
                    on_hover=lambda anchor, entered, rd=row_def: self._on_row_drawer_height_hover(rd, anchor, entered),
                    on_click=lambda anchor, rd=row_def: self._open_row_drawer_height_picker(rd, anchor),
                )
                height_picker_label.setObjectName("drawerHeightValueLabel")
                height_picker_label.setReadOnly(True)
                height_picker_label.setCursor(Qt.CursorShape.PointingHandCursor)
                height_picker_label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                height_picker_label.setFixedWidth(int(self.ENTRY_FIELD_WIDTHS.get("width", 76)))
                height_picker_label.setFixedHeight(30)
                picker_row.addWidget(height_picker_label, 1, Qt.AlignmentFlag.AlignVCenter)
                height_stack.addWidget(height_edit)
                height_stack.addWidget(height_picker_host)
                height_stack.setCurrentWidget(height_edit)
                height_lay.addWidget(height_stack, 1)
                row_def["height_host"] = height_host
                row_def["height_stack"] = height_stack
                row_def["height_line_edit"] = height_edit
                row_def["height_picker_btn"] = None
                row_def["height_picker_widget"] = height_picker_host
                row_def["height_picker_label"] = height_picker_label
                row_def["height_drawer_values"] = []
                row_def["height_is_drawer"] = False
                w = height_host
            elif key == "board":
                w = VComboBox()
                self._add_board_combo_items(w, include_empty=True)
            elif key == "clashing":
                host = QWidget()
                root = QHBoxLayout(host)
                root.setContentsMargins(0, 0, 0, 0)
                root.setSpacing(0)

                clash_combo_host = QWidget()
                h = QHBoxLayout(clash_combo_host)
                h.setContentsMargins(0, 0, 0, 0)
                h.setSpacing(4)
                left_combo = VComboBox()
                left_combo.setObjectName("clashingL")
                left_combo.addItem("")
                left_combo.addItem("1L")
                left_combo.addItem("2L")
                right_combo = VComboBox()
                right_combo.setObjectName("clashingS")
                right_combo.addItem("")
                right_combo.addItem("1S")
                right_combo.addItem("2S")
                h.addWidget(left_combo, 1)
                h.addWidget(right_combo, 1)
                root.addWidget(clash_combo_host, 1)

                cab_host = QWidget()
                cab_host.setVisible(False)
                cab_row = QVBoxLayout(cab_host)
                cab_row.setContentsMargins(0, 0, 0, 0)
                cab_row.setSpacing(3)
                for title, label_key, edit_key in (
                    ("Fixed Shelf", "fixed_shelf_label", "fixed_shelf_edit"),
                    ("Adjustable Shelf", "adjustable_shelf_label", "adjustable_shelf_edit"),
                ):
                    line = QWidget()
                    line_lay = QVBoxLayout(line)
                    line_lay.setContentsMargins(0, 0, 0, 0)
                    line_lay.setSpacing(3)
                    top_row = QWidget()
                    top_row_lay = QHBoxLayout(top_row)
                    top_row_lay.setContentsMargins(0, 0, 0, 0)
                    top_row_lay.setSpacing(6)
                    lbl = QLabel(title)
                    lbl.setFixedWidth(92)
                    box = QLineEdit()
                    box.setObjectName("cabShelfValueInput")
                    box.setFixedHeight(20)
                    box.setFixedWidth(68)
                    top_row_lay.addWidget(lbl)
                    top_row_lay.addWidget(box)
                    top_row_lay.addStretch(1)

                    drill_row = QWidget()
                    drill_row_lay = QHBoxLayout(drill_row)
                    drill_row_lay.setContentsMargins(0, 0, 0, 0)
                    drill_row_lay.setSpacing(6)
                    drill_lbl = QLabel("Drilling")
                    drill_lbl.setFixedWidth(92)
                    drill_combo = VComboBox()
                    drill_combo.setObjectName("cabShelfDrillingCombo")
                    drill_combo.addItem("No")
                    drill_combo.addItem("Even Spacing")
                    drill_combo.addItem("Centre")
                    drill_combo.setCurrentIndex(0)
                    drill_combo.setFixedHeight(20)
                    drill_combo.setFixedWidth(68)
                    if isinstance(drill_combo.view(), QAbstractItemView):
                        drill_combo.view().setMinimumWidth(122)
                    drill_row_lay.addWidget(drill_lbl)
                    drill_row_lay.addWidget(drill_combo)
                    drill_row_lay.addStretch(1)
                    line_lay.addWidget(top_row)
                    line_lay.addWidget(drill_row)
                    cab_row.addWidget(line)
                    row_def[label_key] = lbl
                    row_def[edit_key] = box
                    if title == "Fixed Shelf":
                        row_def["fixed_shelf_drilling_label"] = drill_lbl
                        row_def["fixed_shelf_drilling_combo"] = drill_combo
                    else:
                        row_def["adjustable_shelf_drilling_label"] = drill_lbl
                        row_def["adjustable_shelf_drilling_combo"] = drill_combo
                root.addWidget(cab_host, 1)
                row_def["clashing_combo_host"] = clash_combo_host
                row_def["cabinetry_host"] = cab_host
                w = host
            elif key == "grain":
                w = VComboBox()
                opts = ["", "Long", "Short"]
                for opt in opts:
                    w.addItem(opt)
            elif key == "information":
                info_host = QWidget()
                info_layout = QVBoxLayout(info_host)
                info_layout.setContentsMargins(0, 0, 0, 0)
                info_layout.setSpacing(3)
                row_def["info_layout"] = info_layout
                row_def["info_lines"] = []
                self._append_information_line(row_def, text="", primary=True)
                w = info_host
            else:
                if key == "name":
                    w = PartNameSuggestLineEdit()
                else:
                    w = QLineEdit()
                if key in ("height", "width", "depth", "quantity"):
                    w.setAlignment(Qt.AlignmentFlag.AlignCenter)
                    self._apply_numeric_validator(w)
                if key == "name":
                    self._apply_part_name_completer(w, row_def)
                w.editingFinished.connect(self._queue_autosave)
                if key == "depth":
                    w.textChanged.connect(lambda _txt="", rd=row_def: self._reevaluate_drawer_depth_error_state(rd))
                    w.editingFinished.connect(lambda rd=row_def: self._reevaluate_drawer_depth_error_state(rd, enforce=True, pop_tip=True))
            target_w = int(self.ENTRY_FIELD_WIDTHS.get(key, 90))
            if key == "information":
                w.setMinimumWidth(target_w)
                w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
            else:
                w.setFixedWidth(target_w)
            inputs[key] = w
            row_layout.addWidget(w, 0, idx)
            if isinstance(w, QComboBox):
                self._style_combo_popup_like_status(w)
                w.currentIndexChanged.connect(self._queue_autosave)
            elif isinstance(w, QWidget):
                for combo in w.findChildren(QComboBox):
                    self._style_combo_popup_like_status(combo)
                    combo.currentIndexChanged.connect(self._queue_autosave)
                for edit in w.findChildren(QLineEdit):
                    edit.editingFinished.connect(self._queue_autosave)

        row_def["inputs"] = inputs
        self._entry_input_rows.append(row_def)
        self._entry_rows_layout.addWidget(row_frame)
        self._refresh_entry_empty_state()

        seed_values = self._blank_entry_payload()
        if seed:
            seed_values.update({k: str(v) for k, v in seed.items() if k in seed_values})
        self._set_entry_row_values(row_def, seed_values)
        self._apply_row_autoclash_defaults(inputs, str(row_def.get("partType") or "").strip())
        self._apply_row_cabinetry_mode(row_def, str(row_def.get("partType") or "").strip())
        self._apply_row_drawer_mode(row_def, str(row_def.get("partType") or "").strip())

        if len(self._entry_input_rows) == 1:
            self._quick_inputs = inputs

    def _clear_inputs(self) -> None:
        if not self._entry_input_rows:
            self._refresh_entry_empty_state()
            return
        first = self._entry_input_rows[0]
        self._set_entry_row_values(first, self._blank_entry_payload())
        for extra in list(self._entry_input_rows[1:]):
            frame = extra.get("frame")
            if isinstance(frame, QFrame):
                self._remove_entry_input_row(frame)
        self._refresh_entry_empty_state()

    def _add_entry_input_row_from_last(self) -> None:
        if not self._entry_input_rows:
            self._add_entry_input_row()
            return
        last_values = self._collect_entry_row_values(self._entry_input_rows[-1])
        seed = self._blank_entry_payload()
        seed["partType"] = str(self._active_part_type or last_values.get("partType") or "")
        seed["board"] = str(last_values.get("board") or "")
        seed["room"] = str(self._active_room or last_values.get("room") or "")
        self._add_entry_input_row(seed=seed)

    def _add_row(self, data: dict | None = None, refresh: bool = True) -> None:
        payload = {}
        source = dict(data or {})
        for _label, key in self.FIELDS:
            val = str(source.get(key) or "").strip()
            payload[key] = self._normalize_board_value(val) if key == "board" else val
        payload["partType"] = str(payload.get("partType") or self._active_part_type or "").strip()
        payload["room"] = self._normalize_room_name(str(source.get("room") or ""))
        room_key = self._part_key(str(payload.get("room") or ""))
        if room_key and room_key != "all":
            self._rooms_with_pieces.add(room_key)
        payload["fixedShelf"] = str(source.get("fixedShelf") or "").strip()
        payload["adjustableShelf"] = str(source.get("adjustableShelf") or "").strip()
        payload["fixedShelfDrilling"] = self._normalize_drilling_value(str(source.get("fixedShelfDrilling") or "No").strip())
        payload["adjustableShelfDrilling"] = self._normalize_drilling_value(str(source.get("adjustableShelfDrilling") or "No").strip())
        payload["__id"] = int(source.get("__id") or self._new_row_id())
        self._rows_data.append(payload)
        if refresh:
            self._refresh_filters_and_summary()
        self._queue_autosave()

    def _add_row_from_inputs(self) -> None:
        if self._row_add_animating:
            return
        if self._part_key(self._active_room) == "all":
            QMessageBox.warning(self, "Cutlist", "Select a room tab before adding cutlist rows.")
            return
        accepted_payloads: list[dict] = []
        rejected_messages: list[str] = []
        accepted_row_defs: list[dict[str, object]] = []
        missing_required_widgets: list[QWidget] = []
        oversize_widgets: list[QWidget] = []
        for row_def in self._entry_input_rows:
            data = self._collect_entry_row_values(row_def)
            if not data:
                continue
            data["partType"] = str(row_def.get("partType") or self._active_part_type or data.get("partType") or "").strip()
            data["room"] = self._normalize_room_name(str(self._active_room or row_def.get("room") or data.get("room") or ""))
            self._apply_autoclash_to_data(data, only_if_empty=True)
            has_value = any(
                bool(str(data.get(k, "")).strip())
                for _label, k in self._fields
                if k not in ("partType", "clashing", "grain")
            )
            if not has_value:
                continue
            inputs = row_def.get("inputs")
            row_has_error = False
            is_drawer_row = self._part_type_is_drawer(str(data.get("partType") or ""))
            board_raw = str(data.get("board") or "").strip()
            if not board_raw:
                if isinstance(inputs, dict):
                    board_widget = inputs.get("board")
                    if isinstance(board_widget, QWidget):
                        missing_required_widgets.append(board_widget)
                row_has_error = True
            part_name_raw = str(data.get("name") or "").strip()
            if not part_name_raw:
                if isinstance(inputs, dict):
                    name_widget = inputs.get("name")
                    if isinstance(name_widget, QWidget):
                        missing_required_widgets.append(name_widget)
                row_has_error = True
            qty_raw = str(data.get("quantity") or "").strip()
            qty_val = self._parse_positive_number(qty_raw)
            if (not qty_raw) or (qty_val is None):
                if isinstance(inputs, dict):
                    qty_widget = inputs.get("quantity")
                    if isinstance(qty_widget, QWidget):
                        missing_required_widgets.append(qty_widget)
                row_has_error = True
            if isinstance(inputs, dict):
                dim_keys = ("height", "width", "depth")
                filled_dim_keys = [k for k in dim_keys if bool(str(data.get(k) or "").strip())]
                if len(filled_dim_keys) < 2:
                    for key in dim_keys:
                        if key in filled_dim_keys:
                            continue
                        dim_widget = self._entry_error_widget_for_key(row_def, key, inputs)
                        if isinstance(dim_widget, QWidget):
                            missing_required_widgets.append(dim_widget)
                    # none filled -> flash all three
                    if not filled_dim_keys:
                        for key in dim_keys:
                            dim_widget = self._entry_error_widget_for_key(row_def, key, inputs)
                            if isinstance(dim_widget, QWidget):
                                missing_required_widgets.append(dim_widget)
                    row_has_error = True
            if is_drawer_row:
                width_raw = str(data.get("width") or "").strip()
                width_val = self._parse_positive_number(width_raw)
                if (not width_raw) or (width_val is None):
                    if isinstance(inputs, dict):
                        width_widget = inputs.get("width")
                        if isinstance(width_widget, QWidget):
                            missing_required_widgets.append(width_widget)
                    row_has_error = True
                depth_raw = str(data.get("depth") or "").strip()
                depth_val = self._parse_positive_number(depth_raw)
                if (not depth_raw) or (depth_val is None):
                    if isinstance(inputs, dict):
                        depth_widget = inputs.get("depth")
                        if isinstance(depth_widget, QWidget):
                            missing_required_widgets.append(depth_widget)
                            if bool(depth_widget.property("_drawerDepthErrorTip")):
                                depth_widget.setToolTip("")
                                depth_widget.setProperty("_drawerDepthErrorTip", False)
                    row_has_error = True
                else:
                    hw_lengths = self._drawer_hardware_length_options()
                    space_req = self._parse_mm_number(self._drawer_breakdown_spec.get("spaceRequirement"))
                    compare_depth = float(depth_val) if depth_val is not None else None
                    if compare_depth is not None and space_req is not None:
                        compare_depth = max(0.0, compare_depth - float(space_req))
                    has_valid_hardware_depth = bool(
                        compare_depth is not None and (not hw_lengths or any(float(opt) <= float(compare_depth) for opt in hw_lengths))
                    )
                    if not has_valid_hardware_depth:
                        if isinstance(inputs, dict):
                            depth_widget = inputs.get("depth")
                            if isinstance(depth_widget, QWidget):
                                missing_required_widgets.append(depth_widget)
                                tip_txt = ""
                                if hw_lengths:
                                    min_len = min(float(v) for v in hw_lengths)
                                    min_required = float(min_len) + float(space_req or 0.0)
                                    min_txt = self._format_mm_value(min_required)
                                    tip_txt = f"Minimum: {min_txt} {self._measurement_unit_suffix}"
                                    depth_widget.setToolTip(tip_txt)
                                    depth_widget.setProperty("_drawerDepthErrorTip", True)
                                self._set_persistent_missing_error(depth_widget, True, tip_txt)
                        row_has_error = True
                    elif isinstance(inputs, dict):
                        depth_widget = inputs.get("depth")
                        if isinstance(depth_widget, QWidget):
                            self._set_persistent_missing_error(depth_widget, False)

                height_raw = str(data.get("height") or "").strip()
                height_tokens = self._parse_drawer_height_tokens(height_raw)
                if not height_tokens:
                    height_widget = None
                    if isinstance(row_def.get("height_picker_label"), QWidget):
                        height_widget = row_def.get("height_picker_label")
                    elif isinstance(inputs, dict):
                        height_widget = inputs.get("height")
                    if isinstance(height_widget, QWidget):
                        missing_required_widgets.append(height_widget)
                    row_has_error = True
            issue, offender_keys = self._validate_dimensions_against_sheet(data)
            if issue:
                if isinstance(inputs, dict):
                    for key in offender_keys:
                        offender_widget = self._entry_error_widget_for_key(row_def, str(key), inputs)
                        if isinstance(offender_widget, QWidget):
                            oversize_widgets.append(offender_widget)
                row_has_error = True
            if row_has_error:
                continue
            accepted_payloads.append(dict(data))
            accepted_row_defs.append(row_def)

        if missing_required_widgets:
            seen_widgets: set[int] = set()
            for widget in missing_required_widgets:
                w_id = id(widget)
                if w_id in seen_widgets:
                    continue
                seen_widgets.add(w_id)
                self._flash_missing_widget(widget)
        if oversize_widgets:
            seen_widgets: set[int] = set()
            for widget in oversize_widgets:
                w_id = id(widget)
                if w_id in seen_widgets:
                    continue
                seen_widgets.add(w_id)
                self._flash_missing_widget(widget)

        if rejected_messages:
            QMessageBox.warning(self, "Cutlist", "\n".join(rejected_messages))

        has_row_errors = bool(rejected_messages or missing_required_widgets or oversize_widgets)
        if not accepted_payloads:
            if has_row_errors:
                return
            QMessageBox.warning(self, "Cutlist", "Enter row details above before adding.")
            return

        def _commit_after_animation() -> None:
            for payload in accepted_payloads:
                self._add_row(payload, refresh=False)
            self._refresh_room_tabs()
            self._refresh_filters_and_summary()
            if has_row_errors:
                # Keep invalid rows in the entry area so users can fix them,
                # while removing rows that were successfully added.
                accepted_ids = {id(r) for r in accepted_row_defs}
                for row_def in list(self._entry_input_rows):
                    if id(row_def) not in accepted_ids:
                        continue
                    frame = row_def.get("frame")
                    if isinstance(frame, QFrame):
                        self._remove_entry_input_row(frame)
                if not self._entry_input_rows:
                    self._add_entry_input_row()
            else:
                self._clear_inputs()

        # Animation removed: commit rows immediately for a snappier add flow.
        self._row_add_animating = False
        _commit_after_animation()

    def _entry_error_widget_for_key(self, row_def: dict[str, object], key: str, inputs: dict[str, QWidget]) -> QWidget | None:
        if str(key) == "height":
            picker_label = row_def.get("height_picker_label")
            if isinstance(picker_label, QLineEdit) and bool(picker_label.isVisible()):
                return picker_label
            height_line = row_def.get("height_line_edit")
            if isinstance(height_line, QLineEdit):
                return height_line
        candidate = inputs.get(str(key))
        return candidate if isinstance(candidate, QWidget) else None

    def _flash_missing_widget(self, widget: QWidget) -> None:
        if not isinstance(widget, QWidget):
            return
        # If a container is passed, flash the visible input control inside it so
        # the pulse appears over the cell instead of behind child widgets.
        if not isinstance(widget, (QLineEdit, QComboBox)):
            child_edit = widget.findChild(QLineEdit, "drawerHeightValueLabel")
            if not isinstance(child_edit, QLineEdit):
                child_edit = widget.findChild(QLineEdit)
            if isinstance(child_edit, QLineEdit):
                self._flash_missing_widget(child_edit)
                return
            child_combo = widget.findChild(QComboBox)
            if isinstance(child_combo, QComboBox):
                self._flash_missing_widget(child_combo)
                return

        base_style = widget.property("_flashBaseStyle")
        if not isinstance(base_style, str):
            base_style = widget.styleSheet() or ""
            widget.setProperty("_flashBaseStyle", base_style)

        if isinstance(widget, QLineEdit):
            flash_style = (
                base_style
                + "QLineEdit { background:#FFDCDC; border:1px solid #F2A7A7; border-radius:8px; }"
            )
        elif isinstance(widget, QComboBox):
            flash_style = (
                base_style
                + "QComboBox { background:#FFDCDC; border:1px solid #F2A7A7; border-radius:8px; }"
            )
        else:
            spacer = ";" if base_style and not base_style.strip().endswith(";") else ""
            flash_style = f"{base_style}{spacer} background:#FFDCDC; border:1px solid #F2A7A7;"

        def _restore() -> None:
            if isinstance(widget, QWidget):
                if bool(widget.property("_persistMissingError")):
                    widget.setStyleSheet(flash_style)
                else:
                    widget.setStyleSheet(base_style)

        def _flash_on() -> None:
            if isinstance(widget, QWidget):
                widget.setStyleSheet(flash_style)

        # Two quick pulses so multiple invalid cells are easy to spot.
        _flash_on()
        QTimer.singleShot(180, _restore)
        QTimer.singleShot(280, _flash_on)
        QTimer.singleShot(500, _restore)

    def _animate_entry_rows_to_list(self, row_defs: list[dict[str, object]], on_done) -> None:
        if self._row_add_animating:
            if callable(on_done):
                on_done()
            return
        if not isinstance(self._groups_scroll, QScrollArea) or not isinstance(self._groups_scroll.viewport(), QWidget):
            if callable(on_done):
                on_done()
            return

        candidates: list[tuple[QFrame, QRect]] = []
        for row_def in (row_defs or []):
            frame = row_def.get("frame")
            if not isinstance(frame, QFrame):
                continue
            top_left = frame.mapTo(self, QPoint(0, 0))
            rect = QRect(top_left, frame.size())
            if rect.width() <= 0 or rect.height() <= 0:
                continue
            candidates.append((frame, rect))
        if not candidates:
            if callable(on_done):
                on_done()
            return

        self._row_add_animating = True
        self.setUpdatesEnabled(True)
        viewport = self._groups_scroll.viewport()
        vp_top = viewport.mapTo(self, QPoint(0, 0))
        default_target_anchor = QPoint(vp_top.x() + 12, vp_top.y() + 14)
        pending = {"count": len(candidates)}

        def _finish_one(anim_obj: QParallelAnimationGroup, ghost: QLabel) -> None:
            try:
                if anim_obj in self._row_fly_anims:
                    self._row_fly_anims.remove(anim_obj)
            except Exception:
                pass
            ghost.deleteLater()
            pending["count"] = max(0, int(pending["count"]) - 1)
            if pending["count"] == 0:
                self._row_add_animating = False
                if callable(on_done):
                    on_done()

        for idx, (_frame, src_rect) in enumerate(candidates):
            part_name = ""
            for row_def in (row_defs or []):
                if row_def.get("frame") is _frame:
                    part_name = str(row_def.get("partType") or "").strip()
                    break
            part_key = self._part_key(part_name)
            target_anchor = QPoint(default_target_anchor)
            target_widget = self._part_counter_widgets.get(part_key)
            if isinstance(target_widget, QWidget) and target_widget.isVisible():
                tw_top = target_widget.mapTo(self, QPoint(0, 0))
                target_anchor = QPoint(tw_top.x() + 4, tw_top.y() + 4)

            ghost = QLabel(part_name or "Part", self)
            ghost.setAlignment(Qt.AlignmentFlag.AlignCenter)
            ghost_font = QFont(ghost.font())
            ghost_font.setBold(True)
            ghost_font.setPointSize(10)
            ghost.setFont(ghost_font)
            part_base = QColor(self._header_color_for_type(part_name))
            if not part_base.isValid():
                part_base = QColor("#7D99B3")
            ghost_fg = "#FFFFFF" if part_base.lightness() < 140 else "#1F2937"
            ghost_bg = part_base.name()
            ghost_bd = part_base.darker(112).name()
            start_rect = QRect(
                src_rect.x() + 8,
                src_rect.y() + 2,
                min(max(120, src_rect.width() - 16), 260),
                max(20, src_rect.height() - 4),
            )
            ghost.setGeometry(start_rect)
            ghost.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
            ghost.setStyleSheet(
                "QLabel { "
                f"color: {ghost_fg}; background: {ghost_bg}; border: 1px solid {ghost_bd}; "
                "border-radius: 10px; padding: 0 8px; "
                "}"
            )
            ghost.show()
            ghost.raise_()

            target_w = max(92, int(start_rect.width() * 0.68))
            target_h = max(16, int(start_rect.height() * 0.62))
            target_x = target_anchor.x() + min(84, idx * 10)
            target_y = target_anchor.y() + min(22, idx * 6)
            end_rect = QRect(target_x, target_y, target_w, target_h)

            compress_w = max(84, int(start_rect.width() * 0.72))
            compress_h = max(14, int(start_rect.height() * 0.44))
            compress_rect = QRect(
                start_rect.x() + max(4, int((start_rect.width() - compress_w) * 0.5)),
                start_rect.y() + 1,
                compress_w,
                compress_h,
            )
            throw_w = max(88, int(start_rect.width() * 0.78))
            throw_h = max(14, int(start_rect.height() * 0.52))
            throw_rect = QRect(
                target_x + max(18, int((start_rect.width() - throw_w) * 0.12)),
                vp_top.y() + max(42, int(viewport.height() * 0.86) - throw_h),
                throw_w,
                throw_h,
            )
            bounce_floor_y = vp_top.y() + max(30, viewport.height() - target_h - 10)
            bounce_rect = QRect(
                target_x + max(8, int((src_rect.width() - target_w) * 0.10)),
                bounce_floor_y,
                target_w,
                target_h,
            )
            rebound_high_rect = QRect(
                target_x - 3,
                max(vp_top.y() + 8, target_y - 10),
                target_w,
                target_h,
            )
            settle_rect = QRect(
                target_x - 1,
                target_y + 6,
                target_w,
                target_h,
            )

            geom = QPropertyAnimation(ghost, b"geometry")
            geom.setDuration(840)
            geom.setStartValue(start_rect)
            geom.setKeyValueAt(0.18, compress_rect)
            geom.setKeyValueAt(0.66, throw_rect)
            geom.setKeyValueAt(0.76, bounce_rect)
            geom.setKeyValueAt(0.88, rebound_high_rect)
            geom.setKeyValueAt(0.95, settle_rect)
            geom.setEndValue(end_rect)
            geom.setEasingCurve(QEasingCurve.Type.OutQuart)

            opacity_fx = QGraphicsOpacityEffect(ghost)
            ghost.setGraphicsEffect(opacity_fx)
            fade = QPropertyAnimation(opacity_fx, b"opacity")
            fade.setDuration(150)
            fade.setStartValue(1.0)
            fade.setEndValue(0.0)
            fade.setEasingCurve(QEasingCurve.Type.OutCubic)
            fade_seq = QSequentialAnimationGroup(self)
            fade_seq.addAnimation(QPauseAnimation(690))
            fade_seq.addAnimation(fade)

            group = QParallelAnimationGroup(self)
            group.addAnimation(geom)
            group.addAnimation(fade_seq)
            self._row_fly_anims.append(group)
            group.finished.connect(lambda g=group, w=ghost: _finish_one(g, w))
            QTimer.singleShot(idx * 90, group.start)

    def _parse_sheet_size_pair(self, text: str) -> tuple[float, float] | None:
        src = str(text or "").strip()
        if not src:
            return None
        m = re.search(r"(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)", src)
        if not m:
            return None
        try:
            a = float(m.group(1))
            b = float(m.group(2))
        except Exception:
            return None
        if a <= 0 or b <= 0:
            return None
        return a, b

    def _parse_positive_number(self, value: str) -> float | None:
        txt = str(value or "").strip()
        if not txt:
            return None
        try:
            num = float(txt)
        except Exception:
            return None
        if num <= 0:
            return None
        return num

    def _parse_mm_number(self, value: object) -> float | None:
        txt = str(value or "").strip().lower()
        if not txt:
            return None
        txt = txt.replace("mm", "").replace(",", "")
        m = re.search(r"[-+]?\d*\.?\d+", txt)
        if not m:
            return None
        try:
            num = float(m.group(0))
        except Exception:
            return None
        if num <= 0:
            return None
        return num

    def _sheet_size_for_board(self, board_value: str) -> tuple[float, float]:
        board = self._normalize_board_value(board_value)
        raw_txt = str(
            self._board_sheet_sizes.get(board)
            or self._board_sheet_sizes.get(str(board_value or "").strip())
            or self._board_sheet_sizes_norm.get(self._part_key(board))
            or self._board_sheet_sizes_norm.get(self._part_key(str(board_value or "").strip()))
            or ""
        ).strip()
        pair = self._parse_sheet_size_pair(raw_txt)
        if pair:
            sheet_h, sheet_w = pair
            return float(sheet_w), float(sheet_h)
        def_w = self._parse_positive_number(str(self._nesting_settings.get("sheetWidth") or "1220")) or 1220.0
        def_h = self._parse_positive_number(str(self._nesting_settings.get("sheetHeight") or "2440")) or 2440.0
        return float(def_w), float(def_h)

    def _estimate_sheet_count_by_board(self, rows: list[dict]) -> dict[str, int]:
        kerf = self._parse_positive_number(str(self._nesting_settings.get("kerf") or "5")) or 5.0
        margin = self._parse_positive_number(str(self._nesting_settings.get("margin") or "10")) or 10.0

        grouped: dict[str, list[dict]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            qty = max(1, int(self._parse_positive_number(str(row.get("quantity") or "")) or 1))
            h = self._parse_positive_number(str(row.get("height") or "")) or 0.0
            w = self._parse_positive_number(str(row.get("width") or "")) or 0.0
            d = self._parse_positive_number(str(row.get("depth") or "")) or 0.0
            if h > 0 and w > 0:
                pw, ph = w, h
            else:
                dims = [x for x in [h, w, d] if x > 0]
                dims.sort(reverse=True)
                pw = dims[1] if len(dims) > 1 else (dims[0] if dims else 0.0)
                ph = dims[0] if len(dims) > 0 else 0.0
            if pw <= 0 or ph <= 0:
                continue
            board = self._normalize_board_value(str(row.get("board") or "").strip()) or "No board"
            grain = str(row.get("grain") or "").strip().lower()
            lock_long = grain == "long"
            lock_short = grain == "short"
            grouped.setdefault(board, [])
            for _ in range(qty):
                grouped[board].append({"w": float(pw), "h": float(ph), "lock_long": lock_long, "lock_short": lock_short})

        counts: dict[str, int] = {}
        for board, parts in grouped.items():
            if not parts:
                continue
            sheet_w, sheet_h = self._sheet_size_for_board(board)
            usable_w = max(1.0, float(sheet_w) - margin * 2.0)
            usable_h = max(1.0, float(sheet_h) - margin * 2.0)
            x_axis_is_long = usable_w >= usable_h

            parts.sort(key=lambda p: max(float(p["w"]), float(p["h"])) * min(float(p["w"]), float(p["h"])), reverse=True)
            sheets: list[dict] = []

            def _try_place_in_existing_columns(sheet_obj: dict, ow: float, oh: float):
                cols = sheet_obj.setdefault("columns", [])
                for col in cols:
                    used_h = float(col.get("usedHeight") or 0.0)
                    add_kerf = kerf if used_h > 0 else 0.0
                    if ow <= float(col.get("width") or 0.0) and (used_h + add_kerf + oh) <= usable_h:
                        col["usedHeight"] = used_h + add_kerf + oh
                        return True
                return False

            def _try_create_column_and_place(sheet_obj: dict, ow: float, oh: float):
                cols = sheet_obj.setdefault("columns", [])
                next_x = float(sum(float(c.get("width") or 0.0) for c in cols)) + (kerf * len(cols) if len(cols) > 0 else 0.0)
                if next_x + ow > usable_w:
                    return False
                cols.append({"x": next_x, "width": ow, "usedHeight": oh})
                return True

            for part in parts:
                pw_raw = float(part["w"])
                ph_raw = float(part["h"])
                orientations = [{"w": pw_raw, "h": ph_raw}, {"w": ph_raw, "h": pw_raw}]
                dedup: list[dict] = []
                seen: set[tuple[int, int]] = set()
                for o in orientations:
                    sig = (int(round(o["w"] * 1000)), int(round(o["h"] * 1000)))
                    if sig in seen:
                        continue
                    seen.add(sig)
                    dedup.append(o)
                orientations = dedup

                if bool(part.get("lock_long")):
                    long_edge = max(pw_raw, ph_raw)
                    if x_axis_is_long:
                        orientations = [o for o in orientations if abs(float(o["w"]) - long_edge) < 1e-6]
                    else:
                        orientations = [o for o in orientations if abs(float(o["h"]) - long_edge) < 1e-6]
                elif bool(part.get("lock_short")):
                    short_edge = min(pw_raw, ph_raw)
                    if x_axis_is_long:
                        orientations = [o for o in orientations if abs(float(o["w"]) - short_edge) < 1e-6]
                    else:
                        orientations = [o for o in orientations if abs(float(o["h"]) - short_edge) < 1e-6]

                orientations = [o for o in orientations if float(o["w"]) <= usable_w and float(o["h"]) <= usable_h]

                placed = False
                for sh in sheets:
                    for o in orientations:
                        if _try_place_in_existing_columns(sh, float(o["w"]), float(o["h"])):
                            placed = True
                            break
                    if placed:
                        break
                if placed:
                    continue

                for sh in sheets:
                    for o in orientations:
                        if _try_create_column_and_place(sh, float(o["w"]), float(o["h"])):
                            placed = True
                            break
                    if placed:
                        break
                if placed:
                    continue

                new_sheet = {"columns": []}
                if orientations:
                    o = orientations[0]
                    _try_create_column_and_place(new_sheet, float(o["w"]), float(o["h"]))
                sheets.append(new_sheet)

            sheet_count = int(len(sheets))
            if sheet_count > 0:
                counts[board] = sheet_count
        return counts

    def _estimate_sheet_count(self, rows: list[dict]) -> int:
        counts = self._estimate_sheet_count_by_board(rows)
        return int(sum(int(v) for v in counts.values()))

    def _validate_dimensions_against_sheet(self, row: dict[str, str]) -> tuple[str, list[str]]:
        board_label = str(row.get("board") or "").strip()
        board_value = self._normalize_board_value(board_label)
        sheet_txt = str(
            self._board_sheet_sizes.get(board_value)
            or self._board_sheet_sizes.get(board_label)
            or self._board_sheet_sizes_norm.get(self._part_key(board_value))
            or self._board_sheet_sizes_norm.get(self._part_key(board_label))
            or ""
        ).strip()
        size_pair = self._parse_sheet_size_pair(sheet_txt)
        if not size_pair:
            return "", []
        sheet_h, sheet_w = size_pair
        max_edge = max(sheet_h, sheet_w)
        offenders: list[str] = []
        offender_keys: list[str] = []
        for dim_key, nice in (("height", "Height"), ("width", "Width"), ("depth", "Depth")):
            val = self._parse_positive_number(str(row.get(dim_key) or ""))
            if val is None:
                continue
            if val > max_edge:
                offenders.append(f"{nice} ({val:g})")
                offender_keys.append(dim_key)
        if not offenders:
            return "", []
        board_caption = self._board_display_text(board_value or board_label) or "selected board"
        return (
            f"{board_caption}: {', '.join(offenders)} exceeds sheet size "
            f"({sheet_h:g} x {sheet_w:g}).",
            offender_keys,
        )

    def _remove_row_by_id(self, row_id: int) -> None:
        self._pending_delete_ids.discard(int(row_id))
        self._rows_data = [r for r in self._rows_data if int(r.get("__id", -1)) != int(row_id)]
        self._refresh_filters_and_summary()
        self._queue_autosave()

    def _on_delete_row_clicked(self, row_id: int) -> None:
        rid = int(row_id)
        if rid in self._pending_delete_ids:
            self._pending_delete_ids.remove(rid)
        else:
            self._pending_delete_ids.add(rid)
            self._last_delete_arm_ts = time.monotonic()
        self._delete_all_confirm_armed = False
        self._delete_all_confirm_count = 0
        self._refresh_filters_and_summary()

    def _delete_all_pending_rows(self) -> None:
        if (time.monotonic() - float(self._last_delete_arm_ts or 0.0)) < 0.2:
            return
        pending = {int(v) for v in self._pending_delete_ids}
        if len(pending) < 1:
            self._delete_all_confirm_armed = False
            self._delete_all_confirm_count = 0
            return
        if (not self._delete_all_confirm_armed) or (self._delete_all_confirm_count != len(pending)):
            self._delete_all_confirm_armed = True
            self._delete_all_confirm_count = len(pending)
            self._refresh_filters_and_summary()
            return
        self._delete_all_confirm_armed = False
        self._delete_all_confirm_count = 0
        self._pending_delete_ids.clear()
        self._rows_data = [r for r in self._rows_data if int(r.get("__id", -1)) not in pending]
        self._refresh_filters_and_summary()
        self._queue_autosave()

    def _edit_row_by_id(self, row_id: int) -> None:
        rid = int(row_id)
        self._inline_edit_row_id = None if self._inline_edit_row_id == rid else rid
        self._refresh_filters_and_summary()

    def _row_by_id(self, row_id: int) -> dict | None:
        rid = int(row_id)
        for row in self._rows_data:
            if int(row.get("__id", -1)) == rid:
                return row
        return None

    def _update_inline_row_value(self, row_id: int, key: str, value: str) -> None:
        row = self._row_by_id(row_id)
        if not isinstance(row, dict):
            return
        key_txt = str(key or "").strip()
        if str(key) == "board":
            row[str(key)] = self._normalize_board_value(str(value or "").strip())
        else:
            row[str(key)] = str(value or "").strip()
        if str(key) == "partType":
            self._apply_autoclash_to_data(row, only_if_empty=True)
        self._queue_autosave()
        rid = int(row_id)
        drawer_expanded = rid in self._drawer_breakdown_expanded
        cabinet_expanded = rid in self._cabinet_breakdown_expanded
        drawer_refresh_keys = {"partType", "board", "height", "width", "depth", "quantity"}
        cabinet_refresh_keys = {
            "partType",
            "board",
            "height",
            "width",
            "depth",
            "quantity",
            "fixedShelf",
            "adjustableShelf",
            "fixedShelfDrilling",
            "adjustableShelfDrilling",
            "clashing",
        }
        needs_expanded_refresh = (
            (drawer_expanded and key_txt in drawer_refresh_keys)
            or (cabinet_expanded and key_txt in cabinet_refresh_keys)
        )
        if key_txt in ("partType", "board") or needs_expanded_refresh:
            self._refresh_filters_and_summary()

    def _open_row_part_type_picker(self, row_id: int, anchor: QWidget | None = None) -> None:
        row = self._row_by_id(row_id)
        if not isinstance(row, dict):
            return
        current = str(row.get("partType") or "").strip()
        options = [str(v).strip() for v in self._part_type_options() if str(v).strip()]
        if current and current not in options:
            options.append(current)
        if not options:
            return
        menu = QMenu(anchor if isinstance(anchor, QWidget) else self)
        menu.setStyleSheet(
            "QMenu { background: #FFFFFF; border: 1px solid #D9DEE8; border-radius: 8px; padding: 4px; }"
            "QMenu::item { padding: 6px 12px; border-radius: 6px; color: #111827; }"
            "QMenu::item:selected { background: #E9F0F8; color: #2F5E8A; }"
        )
        for opt in options:
            action = menu.addAction(opt)
            action.setCheckable(True)
            action.setChecked(opt == current)
        popup_pos = self.mapToGlobal(QPoint(0, 0))
        if isinstance(anchor, QWidget):
            popup_pos = anchor.mapToGlobal(QPoint(0, max(0, anchor.height() - 1)))
        picked = menu.exec(popup_pos)
        if picked is None:
            return
        chosen = str(picked.text() or "").strip()
        if not chosen or chosen == current:
            return
        self._update_inline_row_value(int(row_id), "partType", chosen)

    def _apply_autoclash_to_data(self, data: dict, only_if_empty: bool = True) -> None:
        if not isinstance(data, dict):
            return
        part_name = str(data.get("partType") or "").strip()
        if not part_name:
            return
        board_value = str(data.get("board") or "").strip()
        if self._board_is_lacquer(board_value):
            return
        if bool(self._part_type_cabinetry.get(self._part_key(part_name), False)):
            return
        current = str(data.get("clashing") or "").strip()
        if only_if_empty and current:
            return
        cfg = self._part_type_autoclash.get(self._part_key(part_name)) or {}
        l_val = str(cfg.get("clashL") or "").strip().upper()
        s_val = str(cfg.get("clashS") or "").strip().upper()
        joined = " ".join([p for p in [l_val, s_val] if p]).strip()
        if joined:
            data["clashing"] = joined

    def _tinted_icon_pixmap(self, icon_name: str, size: int, color_hex: str) -> QPixmap:
        try:
            icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / str(icon_name or "").strip()
            base = QPixmap(str(icon_path)) if icon_path.exists() else QPixmap()
            if base.isNull():
                return QPixmap()
            src = base.scaled(
                max(1, int(size)),
                max(1, int(size)),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            out = QPixmap(src.size())
            out.fill(Qt.GlobalColor.transparent)
            painter = QPainter(out)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
            painter.drawPixmap(0, 0, src)
            painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
            painter.fillRect(out.rect(), QColor(str(color_hex or "#111827")))
            painter.end()
            return out
        except Exception:
            return QPixmap()

    def _build_inline_edit_widget(self, row_id: int, key: str, value: str, is_cabinetry_group: bool, row_bg_color: str = "#FFFFFF") -> QWidget:
        row_q = QColor(str(row_bg_color or "#FFFFFF"))
        if not row_q.isValid():
            row_q = QColor("#FFFFFF")
        row_input_bg = row_q.name()
        row_drop_bg = row_q.darker(106).name()
        row_border = row_q.darker(116).name()
        row_text = "#FFFFFF" if row_q.lightness() < 140 else "#111827"
        row_popup_sel_bg = row_q.darker(112).name()
        combo_style = (
            "QComboBox {"
            f"background:{row_input_bg}; color:{row_text}; border:1px solid {row_border}; border-radius: 8px;"
            "padding: 0 22px 0 8px; font-size: 12px; min-height: 22px; max-height: 22px;"
            "}"
            "QComboBox::drop-down {"
            "subcontrol-origin: padding; subcontrol-position: top right;"
            f"width: 18px; border-left: 1px solid {row_border};"
            f"background: {row_drop_bg}; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
            "}"
            f"QComboBox::drop-down:on {{ background: {QColor(row_drop_bg).darker(108).name()}; }}"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
            f"QComboBox QAbstractItemView {{ background:{row_input_bg}; color:{row_text}; border:1px solid {row_border}; selection-background-color:{row_popup_sel_bg}; selection-color:{row_text}; }}"
        )
        line_style = (
            "QLineEdit { "
            f"background:{row_input_bg}; color:{row_text}; border:1px solid {row_border}; "
            "border-radius:8px; padding:1px 8px; font-size:12px; min-height:22px; max-height:22px; }"
        )

        if key == "partType":
            w = VComboBox()
            for opt in self._part_type_options():
                w.addItem(opt)
            if value and w.findText(value) < 0:
                w.addItem(value)
            idx = w.findText(value)
            w.setCurrentIndex(idx if idx >= 0 else 0)
            w.setStyleSheet(combo_style)
            w.setFixedHeight(22)
            w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            self._apply_part_type_option_colors(w)
            self._style_combo_popup_like_status(w, use_item_role_colors=True)
            w.currentTextChanged.connect(lambda text, rid=row_id: self._update_inline_row_value(rid, "partType", text))
            return w

        if key == "board":
            w = VComboBox()
            self._add_board_combo_items(w, include_empty=True)
            self._set_board_combo_value(w, value)
            w.setStyleSheet(combo_style)
            w.setFixedHeight(22)
            w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            self._style_combo_popup_like_status(w)
            w.currentIndexChanged.connect(lambda _=None, rid=row_id, ww=w: self._update_inline_row_value(rid, "board", self._combo_selected_value(ww)))
            return w

        if key == "grain":
            w = VComboBox()
            for opt in ["", "Long", "Short"]:
                w.addItem(opt)
            idx = w.findText(value)
            w.setCurrentIndex(idx if idx >= 0 else 0)
            w.setStyleSheet(combo_style)
            w.setFixedHeight(22)
            w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            self._style_combo_popup_like_status(w)
            w.currentTextChanged.connect(lambda text, rid=row_id: self._update_inline_row_value(rid, "grain", text))
            return w

        if key == "clashing" and not is_cabinetry_group:
            host = QWidget()
            host.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
            host.setStyleSheet("QWidget { background: transparent; border: none; }")
            lay = QHBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(4)
            l_val, s_val = self._split_clashing(value)
            left = VComboBox()
            left.addItems(["", "1L", "2L"])
            right = VComboBox()
            right.addItems(["", "1S", "2S"])
            left.setStyleSheet(combo_style)
            right.setStyleSheet(combo_style)
            left.setFixedHeight(22)
            right.setFixedHeight(22)
            left.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            right.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            self._style_combo_popup_like_status(left)
            self._style_combo_popup_like_status(right)
            left.setCurrentIndex(left.findText(l_val) if left.findText(l_val) >= 0 else 0)
            right.setCurrentIndex(right.findText(s_val) if right.findText(s_val) >= 0 else 0)

            def _save_clash(rid=row_id, l=left, s=right):
                joined = " ".join([p for p in [str(l.currentText()).strip(), str(s.currentText()).strip()] if p]).strip()
                self._update_inline_row_value(rid, "clashing", joined)

            left.currentIndexChanged.connect(lambda _=None: _save_clash())
            right.currentIndexChanged.connect(lambda _=None: _save_clash())
            lay.addWidget(left, 1)
            lay.addWidget(right, 1)
            host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            return host

        if key == "clashing" and is_cabinetry_group:
            host = QWidget()
            lay = QVBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(3)
            row_q = QColor(str(row_bg_color or ""))
            if not row_q.isValid():
                row_q = QColor("#FFFFFF")
            field_bg = row_q.name()
            field_border = row_q.darker(120).name()
            dark_row = row_q.lightness() < 140
            field_text = "#FFFFFF" if dark_row else "#111827"
            label_text = "#FFFFFF" if dark_row else "#64748B"
            fixed = QLineEdit(str((self._row_by_id(row_id) or {}).get("fixedShelf") or ""))
            adjustable = QLineEdit(str((self._row_by_id(row_id) or {}).get("adjustableShelf") or ""))
            fixed_drilling = VComboBox()
            fixed_drilling.addItems(["No", "Even Spacing", "Centre"])
            fixed_drilling_val = self._normalize_drilling_value(str((self._row_by_id(row_id) or {}).get("fixedShelfDrilling") or "No"))
            idx_fd = fixed_drilling.findText(fixed_drilling_val)
            fixed_drilling.setCurrentIndex(idx_fd if idx_fd >= 0 else 0)
            adjustable_drilling = VComboBox()
            adjustable_drilling.addItems(["No", "Even Spacing", "Centre"])
            adjustable_drilling_val = self._normalize_drilling_value(str((self._row_by_id(row_id) or {}).get("adjustableShelfDrilling") or "No"))
            idx_ad = adjustable_drilling.findText(adjustable_drilling_val)
            adjustable_drilling.setCurrentIndex(idx_ad if idx_ad >= 0 else 0)
            fixed.setFixedHeight(16)
            adjustable.setFixedHeight(16)
            compact_style = (
                "QLineEdit { "
                f"background:{field_bg}; color:{field_text}; border:1px solid {field_border}; "
                "border-radius:7px; padding:0 5px; font-size:10px; }"
            )
            fixed.setStyleSheet(compact_style)
            adjustable.setStyleSheet(compact_style)
            drilling_style = (
                "QComboBox { "
                f"background:{field_bg}; color:{field_text}; border:1px solid {field_border}; "
                "border-radius:7px; padding:0 18px 0 6px; font-size:10px; min-height:16px; max-height:16px; }"
                f"QComboBox::drop-down {{ width:14px; border-left:1px solid {field_border}; }}"
                "QComboBox::down-arrow { image:none; width:0px; height:0px; }"
                f"QComboBox QAbstractItemView {{ background:{field_bg}; color:{field_text}; border:1px solid {field_border}; selection-background-color:{row_q.darker(112).name()}; selection-color:{field_text}; }}"
            )
            fixed_drilling.setStyleSheet(drilling_style)
            adjustable_drilling.setStyleSheet(drilling_style)
            fixed.setFixedWidth(68)
            adjustable.setFixedWidth(68)
            fixed_drilling.setFixedWidth(68)
            adjustable_drilling.setFixedWidth(68)
            if isinstance(fixed_drilling.view(), QAbstractItemView):
                fixed_drilling.view().setMinimumWidth(122)
            if isinstance(adjustable_drilling.view(), QAbstractItemView):
                adjustable_drilling.view().setMinimumWidth(122)
            fixed.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            adjustable.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            fixed_drilling.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            adjustable_drilling.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            fixed.editingFinished.connect(lambda rid=row_id, w=fixed: self._update_inline_row_value(rid, "fixedShelf", w.text()))
            adjustable.editingFinished.connect(lambda rid=row_id, w=adjustable: self._update_inline_row_value(rid, "adjustableShelf", w.text()))
            fixed_drilling.currentTextChanged.connect(lambda text, rid=row_id: self._update_inline_row_value(rid, "fixedShelfDrilling", text))
            adjustable_drilling.currentTextChanged.connect(lambda text, rid=row_id: self._update_inline_row_value(rid, "adjustableShelfDrilling", text))
            fixed_row = QWidget()
            fixed_row_lay = QVBoxLayout(fixed_row)
            fixed_row_lay.setContentsMargins(0, 0, 0, 0)
            fixed_row_lay.setSpacing(2)
            fixed_top_row = QWidget()
            fixed_top_row_lay = QHBoxLayout(fixed_top_row)
            fixed_top_row_lay.setContentsMargins(0, 0, 0, 0)
            fixed_top_row_lay.setSpacing(4)
            fixed_lbl = QLabel("Fixed")
            fixed_lbl.setStyleSheet(f"QLabel {{ color: {label_text}; font-size: 10px; font-weight: 600; background: transparent; border: none; }}")
            fixed_lbl.setFixedWidth(66)
            fixed_top_row_lay.addWidget(fixed_lbl, 0)
            fixed_top_row_lay.addWidget(fixed, 0)
            fixed_top_row_lay.addStretch(1)

            fixed_drill_row = QWidget()
            fixed_drill_row_lay = QHBoxLayout(fixed_drill_row)
            fixed_drill_row_lay.setContentsMargins(0, 0, 0, 0)
            fixed_drill_row_lay.setSpacing(4)
            fixed_drill_left = QWidget()
            fixed_drill_left_lay = QHBoxLayout(fixed_drill_left)
            fixed_drill_left_lay.setContentsMargins(0, 0, 0, 0)
            fixed_drill_left_lay.setSpacing(2)
            fixed_drill_left.setFixedWidth(66)
            fixed_arrow = QLabel()
            fixed_arrow.setStyleSheet("QLabel { background: transparent; border: none; }")
            fixed_arrow.setFixedSize(10, 10)
            fixed_arrow_pix = self._tinted_icon_pixmap("arrow.png", 9, label_text)
            if not fixed_arrow_pix.isNull():
                fixed_arrow.setPixmap(fixed_arrow_pix)
            fixed_drill_lbl = QLabel("Drilling")
            fixed_drill_lbl.setStyleSheet(f"QLabel {{ color: {label_text}; font-size: 10px; font-weight: 600; background: transparent; border: none; }}")
            fixed_drill_left_lay.addWidget(fixed_arrow, 0, Qt.AlignmentFlag.AlignVCenter)
            fixed_drill_left_lay.addWidget(fixed_drill_lbl, 1, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            fixed_drill_row_lay.addWidget(fixed_drill_left, 0)
            fixed_drill_row_lay.addWidget(fixed_drilling, 0)
            fixed_drill_row_lay.addStretch(1)
            fixed_row_lay.addWidget(fixed_top_row)
            fixed_row_lay.addWidget(fixed_drill_row)

            adjustable_row = QWidget()
            adjustable_row_lay = QVBoxLayout(adjustable_row)
            adjustable_row_lay.setContentsMargins(0, 0, 0, 0)
            adjustable_row_lay.setSpacing(2)
            adjustable_top_row = QWidget()
            adjustable_top_row_lay = QHBoxLayout(adjustable_top_row)
            adjustable_top_row_lay.setContentsMargins(0, 0, 0, 0)
            adjustable_top_row_lay.setSpacing(4)
            adjustable_lbl = QLabel("Adjustable")
            adjustable_lbl.setStyleSheet(f"QLabel {{ color: {label_text}; font-size: 10px; font-weight: 600; background: transparent; border: none; }}")
            adjustable_lbl.setFixedWidth(66)
            adjustable_top_row_lay.addWidget(adjustable_lbl, 0)
            adjustable_top_row_lay.addWidget(adjustable, 0)
            adjustable_top_row_lay.addStretch(1)

            adjustable_drill_row = QWidget()
            adjustable_drill_row_lay = QHBoxLayout(adjustable_drill_row)
            adjustable_drill_row_lay.setContentsMargins(0, 0, 0, 0)
            adjustable_drill_row_lay.setSpacing(4)
            adjustable_drill_left = QWidget()
            adjustable_drill_left_lay = QHBoxLayout(adjustable_drill_left)
            adjustable_drill_left_lay.setContentsMargins(0, 0, 0, 0)
            adjustable_drill_left_lay.setSpacing(2)
            adjustable_drill_left.setFixedWidth(66)
            adjustable_arrow = QLabel()
            adjustable_arrow.setStyleSheet("QLabel { background: transparent; border: none; }")
            adjustable_arrow.setFixedSize(10, 10)
            adjustable_arrow_pix = self._tinted_icon_pixmap("arrow.png", 9, label_text)
            if not adjustable_arrow_pix.isNull():
                adjustable_arrow.setPixmap(adjustable_arrow_pix)
            adjustable_drill_lbl = QLabel("Drilling")
            adjustable_drill_lbl.setStyleSheet(f"QLabel {{ color: {label_text}; font-size: 10px; font-weight: 600; background: transparent; border: none; }}")
            adjustable_drill_left_lay.addWidget(adjustable_arrow, 0, Qt.AlignmentFlag.AlignVCenter)
            adjustable_drill_left_lay.addWidget(adjustable_drill_lbl, 1, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            adjustable_drill_row_lay.addWidget(adjustable_drill_left, 0)
            adjustable_drill_row_lay.addWidget(adjustable_drilling, 0)
            adjustable_drill_row_lay.addStretch(1)
            adjustable_row_lay.addWidget(adjustable_top_row)
            adjustable_row_lay.addWidget(adjustable_drill_row)

            lay.addWidget(fixed_row)
            lay.addWidget(adjustable_row)
            host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            return host

        if key == "information":
            lines = [ln.strip() for ln in str(value or "").splitlines()]
            if len(lines) > 1:
                host = QWidget()
                lay = QVBoxLayout(host)
                lay.setContentsMargins(0, 0, 0, 0)
                lay.setSpacing(2)
                line_rows: list[QWidget] = []
                line_edits: list[QLineEdit] = []

                def _save_info(rid=row_id) -> None:
                    parts = []
                    for edit in list(line_edits):
                        if not isinstance(edit, QLineEdit):
                            continue
                        txt = str(edit.text() or "").strip()
                        if txt:
                            parts.append(txt)
                    self._update_inline_row_value(rid, "information", "\n".join(parts))

                def _remove_line(row_widget: QWidget, edit_widget: QLineEdit) -> None:
                    if len(line_edits) <= 1:
                        edit_widget.clear()
                        _save_info()
                        return
                    if edit_widget in line_edits:
                        line_edits.remove(edit_widget)
                    if row_widget in line_rows:
                        line_rows.remove(row_widget)
                    row_widget.setParent(None)
                    row_widget.deleteLater()
                    _save_info()

                def _add_line(initial_text: str, primary: bool) -> None:
                    row_host = QWidget()
                    row_lay = QHBoxLayout(row_host)
                    row_lay.setContentsMargins(0, 0, 0, 0)
                    row_lay.setSpacing(4)
                    action = QPushButton("+" if primary else "X")
                    action.setCursor(Qt.CursorShape.PointingHandCursor)
                    action.setFixedSize(20, 20)
                    if primary:
                        action.setStyleSheet(
                            "QPushButton { color: #1F8A4C; background: #EAF8F0; border: 1px solid #BFE8CF; border-radius: 7px; font-size: 13px; font-weight: 700; padding: 0; }"
                            "QPushButton:hover { background: #DDF2E7; }"
                        )
                    else:
                        action.setStyleSheet(
                            "QPushButton { color: #D14343; background: #FFECEC; border: 1px solid #F7B8B8; border-radius: 7px; font-size: 11px; font-weight: 700; padding: 0; }"
                            "QPushButton:hover { background: #FFDCDC; }"
                        )
                    edit = QLineEdit(str(initial_text or ""))
                    edit.setFixedHeight(20)
                    edit.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:8px; padding:1px 6px; font-size:11px; }")
                    edit.editingFinished.connect(_save_info)
                    row_lay.addWidget(action)
                    row_lay.addWidget(edit, 1)
                    lay.addWidget(row_host)
                    line_rows.append(row_host)
                    line_edits.append(edit)
                    if primary:
                        action.clicked.connect(lambda _=False: (_add_line("", False), _save_info()))
                    else:
                        action.clicked.connect(lambda _=False, rw=row_host, ew=edit: _remove_line(rw, ew))

                _add_line(lines[0], True)
                for extra in lines[1:]:
                    _add_line(extra, False)
                host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                return host

        w = QLineEdit(value)
        if key == "height":
            row = self._row_by_id(row_id)
            part_name = str((row or {}).get("partType") or "").strip()
            if self._is_drawer_part_type(part_name):
                picker_edit = HoverLetterLineEdit(
                    on_hover=lambda anchor, entered, rid=row_id: self._on_inline_drawer_height_hover(rid, anchor, entered),
                    on_click=lambda anchor, rid=row_id: self._open_inline_drawer_height_picker(rid, anchor)
                )
                picker_edit.setObjectName("drawerHeightValueLabel")
                picker_edit.setReadOnly(True)
                picker_edit.setCursor(Qt.CursorShape.PointingHandCursor)
                picker_edit.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                picker_edit.setStyleSheet(line_style)
                picker_edit.setFixedHeight(22)
                picker_edit.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                picker_edit.setText(str(value or "").strip())
                picker_edit.setToolTip(str(value or "").strip())
                picker_edit.setCursorPosition(0)
                return picker_edit
        if key in ("height", "width", "depth", "quantity"):
            w.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self._apply_numeric_validator(w)
        w.setStyleSheet(line_style)
        w.setFixedHeight(22)
        w.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        w.editingFinished.connect(lambda rid=row_id, k=key, ww=w: self._update_inline_row_value(rid, k, ww.text()))
        return w

    def _refresh_filters_and_summary(self) -> None:
        self._refresh_room_tabs()
        self._refresh_entry_part_type_tabs()
        self._refresh_entry_availability()
        self._refresh_entry_part_name_suggestion_models()
        if self._part_type_filter is not None:
            current = self._part_type_filter.currentText()
            types = set(self._part_types_seed)
            for row in self._rows_data:
                text = str(row.get("partType") or "").strip()
                if text:
                    types.add(text)
            opts = ["All Part Types"] + sorted(types)
            self._part_type_filter.blockSignals(True)
            self._part_type_filter.clear()
            for opt in opts:
                self._part_type_filter.addItem(opt)
            idx = self._part_type_filter.findText(current)
            self._part_type_filter.setCurrentIndex(idx if idx >= 0 else 0)
            self._part_type_filter.blockSignals(False)
            self._apply_part_type_option_colors(self._part_type_filter)
            self._style_combo_popup_like_status(self._part_type_filter, use_item_role_colors=True)
            self._refresh_part_type_combo_chip(self._part_type_filter)

        self._apply_table_filters()

    def _refresh_entry_part_name_suggestion_models(self) -> None:
        for row_def in list(self._entry_input_rows):
            inputs = row_def.get("inputs")
            if not isinstance(inputs, dict):
                continue
            edit = inputs.get("name")
            if isinstance(edit, QLineEdit):
                self._apply_part_name_completer(edit, row_def)

    def _apply_table_filters(self) -> None:
        search = (self._search_input.text().strip().lower() if self._search_input else "")
        part_filter = (self._part_type_filter.currentText().strip() if self._part_type_filter else "All Part Types")
        active_room = str(self._active_room or "All").strip()
        show_project_counts = bool(self._show_project_counts) and (self._part_key(active_room) == "all")
        if isinstance(self._summary_part_count_label, QLabel):
            self._summary_part_count_label.setVisible(show_project_counts)
        if isinstance(self._combined_parts_label, QLabel):
            self._combined_parts_label.setVisible(not bool(self._show_project_counts))
            total_parts_all_rooms = self._rows_quantity_total(self._rows_data)
            self._combined_parts_label.setText(f"{total_parts_all_rooms} Parts")
        if isinstance(self._summary_card, QFrame):
            self._summary_card.setVisible(show_project_counts)
        self._pending_delete_ids.intersection_update({int(r.get("__id", -1)) for r in self._rows_data})
        if self._delete_all_confirm_count != len(self._pending_delete_ids):
            self._delete_all_confirm_armed = False
            self._delete_all_confirm_count = len(self._pending_delete_ids)

        filtered: list[dict] = []
        for row in self._rows_data:
            part_type = str(row.get("partType") or "").strip()
            board = str(row.get("board") or "").strip()
            room = self._normalize_room_name(str(row.get("room") or ""))
            board_text = self._board_display_text(board)
            part_name = str(row.get("name") or "").strip()
            hay = f"{part_name} {board} {board_text} {part_type} {room}".lower()

            if search and search not in hay:
                continue
            if active_room and self._part_key(active_room) != "all" and self._part_key(room) != self._part_key(active_room):
                continue
            if part_filter and part_filter != "All Part Types" and part_type != part_filter:
                continue
            filtered.append(row)

        non_cab_all = [
            r
            for r in filtered
            if not bool(self._part_type_cabinetry.get(self._part_key(str(r.get("partType") or "")), False))
        ]
        manufacturing_rows = self._expand_rows_for_manufacturing_counts(filtered) if show_project_counts else []
        sheet_counts = self._estimate_sheet_count_by_board(manufacturing_rows) if show_project_counts else {}
        edge_counts = self._estimate_edge_tape_by_board(manufacturing_rows) if show_project_counts else {}
        self._refresh_summary_pills(self._rows_quantity_total(non_cab_all), sheet_counts, edge_counts)

        self._render_grouped_rows(filtered)

    def _pill_label(self, text: str) -> QLabel:
        lbl = QLabel(str(text))
        lbl.setStyleSheet(
            "QLabel {"
            "color: #5B6472;"
            "font-size: 12px;"
            "font-weight: 700;"
            "background: #EEF1F5;"
            "border: 1px solid #D8DEE8;"
            "border-radius: 10px;"
            "padding: 4px 10px;"
            "}"
        )
        return lbl

    def _row_quantity_count(self, row: dict) -> int:
        if not isinstance(row, dict):
            return 0
        qty = self._parse_positive_number(str(row.get("quantity") or ""))
        if qty is None:
            return 1
        return max(1, int(round(float(qty))))

    def _rows_quantity_total(self, rows: list[dict]) -> int:
        return int(sum(self._row_quantity_count(r) for r in (rows or [])))

    def _is_drawer_part_type(self, part_name: str) -> bool:
        return bool(self._part_type_drawer.get(self._part_key(part_name), False))

    @staticmethod
    def _format_mm_value(value: float | None) -> str:
        if value is None:
            return ""
        try:
            num = float(value)
        except Exception:
            return ""
        if abs(num - round(num)) < 1e-9:
            return str(int(round(num)))
        return f"{num:g}"

    def _drawer_breakdown_values_for_row(self, row: dict) -> tuple[str, str, str]:
        width = self._parse_mm_number((row or {}).get("width"))
        depth = self._parse_mm_number((row or {}).get("depth"))
        bw_minus = self._parse_mm_number(self._drawer_breakdown_spec.get("bottomsWidthMinus"))
        bd_minus = self._parse_mm_number(self._drawer_breakdown_spec.get("bottomsDepthMinus"))
        backs_w_minus = self._parse_mm_number(self._drawer_breakdown_spec.get("backsWidthMinus"))
        space_req = self._parse_mm_number(self._drawer_breakdown_spec.get("spaceRequirement"))

        depth_base = depth
        length_opts = self._drawer_hardware_length_options()
        if depth is not None:
            depth_for_hardware = float(depth)
            if space_req is not None:
                depth_for_hardware = max(0.0, depth_for_hardware - float(space_req))
            rounded_hardware_depth = depth_for_hardware
            if length_opts:
                candidates = [v for v in length_opts if v <= float(depth_for_hardware)]
                if candidates:
                    rounded_hardware_depth = max(candidates)
            depth_base = rounded_hardware_depth

        bottom_w = self._format_mm_value((width - bw_minus) if width is not None and bw_minus is not None else width)
        bottom_d = self._format_mm_value((depth_base - bd_minus) if depth_base is not None and bd_minus is not None else depth_base)
        back_w = self._format_mm_value((width - backs_w_minus) if width is not None and backs_w_minus is not None else width)
        return bottom_w, bottom_d, back_w

    def _drawer_hardware_length_options(self) -> list[float]:
        length_opts_raw = self._drawer_breakdown_spec.get("hardwareLengths")
        out: list[float] = []
        if isinstance(length_opts_raw, list):
            for item in length_opts_raw:
                val = self._parse_mm_number(item)
                if val is not None and val > 0:
                    out.append(float(val))
        return out

    def _set_persistent_missing_error(self, widget: QWidget, enabled: bool, tooltip: str = "") -> None:
        if not isinstance(widget, QWidget):
            return
        widget.setProperty("_persistMissingError", bool(enabled))
        if enabled:
            if tooltip:
                widget.setToolTip(str(tooltip))
        else:
            if bool(widget.property("_drawerDepthErrorTip")):
                widget.setToolTip("")
                widget.setProperty("_drawerDepthErrorTip", False)

    def _reevaluate_drawer_depth_error_state(self, row_def: dict[str, object], enforce: bool = False, pop_tip: bool = False) -> None:
        if not isinstance(row_def, dict):
            return
        inputs = row_def.get("inputs")
        depth_widget = inputs.get("depth") if isinstance(inputs, dict) else None
        if not isinstance(depth_widget, QLineEdit):
            return
        part_name = str(row_def.get("partType") or "").strip()
        if not self._part_type_is_drawer(part_name):
            if bool(depth_widget.property("_persistMissingError")):
                self._set_persistent_missing_error(depth_widget, False)
                self._refresh_entry_row_theme(row_def)
            return
        depth_val = self._parse_mm_number(depth_widget.text())
        hw_lengths = self._drawer_hardware_length_options()
        space_req = self._parse_mm_number(self._drawer_breakdown_spec.get("spaceRequirement"))
        compare_depth = float(depth_val) if depth_val is not None else None
        if compare_depth is not None and space_req is not None:
            compare_depth = max(0.0, compare_depth - float(space_req))
        valid = bool(compare_depth is not None and (not hw_lengths or any(float(opt) <= float(compare_depth) for opt in hw_lengths)))
        if valid:
            if bool(depth_widget.property("_persistMissingError")):
                self._set_persistent_missing_error(depth_widget, False)
                self._refresh_entry_row_theme(row_def)
            if pop_tip:
                QToolTip.hideText()
            return

        if not enforce and not bool(depth_widget.property("_persistMissingError")):
            return

        tip = ""
        if hw_lengths:
            min_len = min(float(v) for v in hw_lengths)
            min_required = float(min_len) + float(space_req or 0.0)
            tip = f"Minimum: {self._format_mm_value(min_required)} {self._measurement_unit_suffix}"
            depth_widget.setProperty("_drawerDepthErrorTip", True)
        self._set_persistent_missing_error(depth_widget, True, tip)
        self._refresh_entry_row_theme(row_def)
        if pop_tip and tip:
            QToolTip.showText(depth_widget.mapToGlobal(depth_widget.rect().bottomLeft()), tip, depth_widget, depth_widget.rect(), 20000)

    def _drawer_back_groups_for_row(self, row: dict) -> list[tuple[str, str, int]]:
        height_raw = str((row or {}).get("height") or "").strip()
        tokens = self._parse_drawer_height_tokens(height_raw)
        if not tokens and height_raw:
            tokens = [height_raw]
        if not tokens:
            tokens = [""]
        ordered_counts: dict[str, int] = {}
        for tok in tokens:
            key = str(tok or "").strip()
            ordered_counts[key] = int(ordered_counts.get(key, 0)) + 1
        letter_map = self._drawer_breakdown_spec.get("backLetterValues") if isinstance(self._drawer_breakdown_spec.get("backLetterValues"), dict) else {}
        out: list[tuple[str, str, int]] = []
        for letter, count in ordered_counts.items():
            back_h = str(letter_map.get(self._part_key(letter)) or "").strip() if letter else ""
            if not back_h:
                back_h = letter
            out.append((letter, back_h, max(1, int(count))))
        return out

    def _drawer_bottom_quantity_for_row(self, row: dict) -> int:
        height_raw = str((row or {}).get("height") or "").strip()
        tokens = self._parse_drawer_height_tokens(height_raw)
        if not tokens and height_raw:
            tokens = [height_raw]
        token_count = max(1, len(tokens))
        return max(1, token_count)

    def _expand_rows_for_manufacturing_counts(self, rows: list[dict]) -> list[dict]:
        out: list[dict] = []
        for row in (rows or []):
            if not isinstance(row, dict):
                continue
            part_name = str(row.get("partType") or row.get("part_type") or "").strip()
            part_key = self._part_key(part_name)
            if part_key and not bool(self._part_type_include_in_cutlists.get(part_key, True)):
                continue
            if bool(self._part_type_cabinetry.get(part_key, False)):
                for piece in self._cabinet_breakdown_rows_for_row(row):
                    piece_row = dict(row)
                    piece_row["name"] = str(piece.get("name") or "")
                    piece_row["height"] = str(piece.get("height") or "")
                    piece_row["width"] = str(piece.get("width") or "")
                    piece_row["depth"] = str(piece.get("depth") or "")
                    piece_row["quantity"] = str(piece.get("quantity") or "1")
                    piece_row["clashing"] = ""
                    out.append(piece_row)
                continue
            if not self._is_drawer_part_type(part_name):
                out.append(dict(row))
                continue
            bottom_w, bottom_d, back_w = self._drawer_breakdown_values_for_row(row)
            bottom_qty = self._drawer_bottom_quantity_for_row(row)
            bottom_row = dict(row)
            bottom_row["height"] = str(bottom_d or "")
            bottom_row["width"] = str(bottom_w or "")
            bottom_row["depth"] = ""
            bottom_row["quantity"] = str(max(1, int(bottom_qty)))
            bottom_row["clashing"] = ""
            out.append(bottom_row)
            for _letter, back_h, back_qty in self._drawer_back_groups_for_row(row):
                clash_txt = ""
                w_num = self._parse_positive_number(str(back_w or ""))
                h_num = self._parse_positive_number(str(back_h or ""))
                if w_num is not None and h_num is not None and h_num > 0:
                    clash_txt = "1S" if w_num < h_num else "1L"
                back_row = dict(row)
                back_row["height"] = str(back_h or "")
                back_row["width"] = str(back_w or "")
                back_row["depth"] = ""
                back_row["quantity"] = str(max(1, int(back_qty)))
                back_row["clashing"] = clash_txt
                out.append(back_row)
        return out

    def _toggle_drawer_breakdown(self, row_id: int) -> None:
        rid = int(row_id)
        if rid in self._drawer_breakdown_expanded:
            self._drawer_breakdown_expanded.remove(rid)
        else:
            self._drawer_breakdown_expanded.add(rid)
        self._refresh_filters_and_summary()

    def _toggle_cabinet_breakdown(self, row_id: int) -> None:
        rid = int(row_id)
        if rid in self._cabinet_breakdown_expanded:
            self._cabinet_breakdown_expanded.remove(rid)
        else:
            self._cabinet_breakdown_expanded.add(rid)
        self._refresh_filters_and_summary()

    def _cabinet_breakdown_rows_for_row(self, row: dict) -> list[dict[str, str | int]]:
        width = self._parse_mm_number((row or {}).get("width"))
        height = self._parse_mm_number((row or {}).get("height"))
        depth = self._parse_mm_number((row or {}).get("depth"))
        if width is None or height is None or depth is None:
            return []
        row_qty = self._row_quantity_count(row)
        board_thickness = float(self._board_thickness_for_row(row) or 0.0)
        inner_w = float(width) - (2.0 * board_thickness)
        inner_d = float(depth) - board_thickness
        side_h = float(height)
        side_d = float(depth)
        back_h = float(height)
        back_w = inner_w
        if min(inner_w, inner_d, side_h, side_d, back_h, back_w) <= 0:
            return []

        adjustable_qty = self._parse_positive_number(str((row or {}).get("adjustableShelf") or (row or {}).get("adjustableShelves") or ""))
        fixed_qty = self._parse_positive_number(str((row or {}).get("fixedShelf") or (row or {}).get("fixedShelves") or ""))

        pieces: list[dict[str, str | int]] = []

        def _add_piece(name: str, h_val: float | None, w_val: float | None, d_val: float | None, qty_val: int) -> None:
            if h_val is not None and h_val <= 0:
                return
            if w_val is not None and w_val <= 0:
                return
            if d_val is not None and d_val <= 0:
                return
            if qty_val <= 0:
                return
            pieces.append(
                {
                    "name": str(name),
                    "height": self._format_mm_value(h_val),
                    "width": self._format_mm_value(w_val),
                    "depth": self._format_mm_value(d_val),
                    "quantity": int(qty_val),
                }
            )

        _add_piece("Top", None, inner_w, inner_d, row_qty)
        _add_piece("Bottom", None, inner_w, inner_d, row_qty)
        _add_piece("Left Side", side_h, None, side_d, row_qty)
        _add_piece("Right Side", side_h, None, side_d, row_qty)
        _add_piece("Back", back_h, back_w, None, row_qty)

        if adjustable_qty is not None and adjustable_qty > 0:
            adj_depth = float(depth) - board_thickness - 10.0
            _add_piece("Adjustable Shelf", None, inner_w, adj_depth, int(round(adjustable_qty)) * row_qty)
        if fixed_qty is not None and fixed_qty > 0:
            fixed_depth = float(depth) - board_thickness
            _add_piece("Fixed Shelf", None, inner_w, fixed_depth, int(round(fixed_qty)) * row_qty)
        return pieces

    def _parse_clashing_counts(self, value: str) -> tuple[int, int]:
        l_cnt = 0
        s_cnt = 0
        for token in str(value or "").strip().upper().replace(",", " ").split():
            tok = token.strip()
            if tok in ("1L", "2L"):
                try:
                    l_cnt = max(l_cnt, int(tok[0]))
                except Exception:
                    pass
            elif tok in ("1S", "2S", "1SH", "2SH"):
                base = tok.replace("SH", "S")
                try:
                    s_cnt = max(s_cnt, int(base[0]))
                except Exception:
                    pass
        return l_cnt, s_cnt

    def _row_long_short_dimensions(self, row: dict) -> tuple[float, float]:
        if not isinstance(row, dict):
            return 0.0, 0.0
        h = self._parse_positive_number(str(row.get("height") or "")) or 0.0
        w = self._parse_positive_number(str(row.get("width") or "")) or 0.0
        d = self._parse_positive_number(str(row.get("depth") or "")) or 0.0
        if h > 0 and w > 0:
            long_edge = max(h, w)
            short_edge = min(h, w)
            return float(long_edge), float(short_edge)
        dims = [x for x in [h, w, d] if x > 0]
        dims.sort(reverse=True)
        if not dims:
            return 0.0, 0.0
        if len(dims) == 1:
            return float(dims[0]), 0.0
        return float(dims[0]), float(dims[1])

    def _estimate_edge_tape_by_board(self, rows: list[dict]) -> dict[str, float]:
        out: dict[str, float] = {}
        for row in (rows or []):
            if not isinstance(row, dict):
                continue
            l_cnt, s_cnt = self._parse_clashing_counts(str(row.get("clashing") or ""))
            if l_cnt <= 0 and s_cnt <= 0:
                continue
            long_edge, short_edge = self._row_long_short_dimensions(row)
            if long_edge <= 0:
                continue
            if s_cnt > 0 and short_edge <= 0:
                continue
            qty = self._row_quantity_count(row)
            total_mm = (float(l_cnt) * long_edge + float(s_cnt) * short_edge) * float(qty)
            if total_mm <= 0:
                continue
            board = self._normalize_board_value(str(row.get("board") or "").strip()) or "No board"
            out[board] = float(out.get(board) or 0.0) + total_mm
        return out

    def _edge_tape_text(self, total_mm: float) -> str:
        mm = float(total_mm or 0.0)
        if mm <= 0:
            return "0m"
        return f"{(mm / 1000.0):.1f}m"

    def _refresh_summary_pills(
        self,
        part_count: int,
        board_sheet_counts: dict[str, int],
        board_edge_totals_mm: dict[str, float] | None = None,
    ) -> None:
        if self._summary_part_count_label is not None:
            self._summary_part_count_label.setText(f"{int(part_count)} parts")
            self._summary_part_count_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sample_h = int(self._pill_label("0").sizeHint().height())
        if self._summary_part_count_label is not None:
            self._summary_part_count_label.setFixedHeight(sample_h)
        if self._summary_pills_layout is None:
            return
        while self._summary_pills_layout.count():
            item = self._summary_pills_layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        edge_map = dict(board_edge_totals_mm or {})
        candidate_boards = set()
        for b, c in (board_sheet_counts or {}).items():
            if int(c) > 0:
                candidate_boards.add(str(b))
        for b, mm in edge_map.items():
            if float(mm or 0.0) > 0:
                candidate_boards.add(str(b))
        ordered_boards = sorted(candidate_boards, key=lambda b: self._part_key(self._board_summary_text(b) or b))
        show_sheet_counts = bool(ordered_boards)
        if isinstance(self._summary_pills_wrap, QWidget):
            self._summary_pills_wrap.setVisible(show_sheet_counts)
            target_h = max(sample_h, (len(ordered_boards) * (sample_h + 4))) if show_sheet_counts else sample_h
            self._summary_pills_wrap.setFixedHeight(target_h)
        board_col_w = int(self._pill_label("Board").sizeHint().width())
        for board in ordered_boards:
            board_col_w = max(board_col_w, int(self._pill_label(self._board_summary_text(board)).sizeHint().width()))
        sheet_pill_w = max(34, int(self._pill_label("000").sizeHint().width()))
        edge_pill_w = max(58, int(self._pill_label("00.0m").sizeHint().width()))
        if isinstance(self._summary_header_board_label, QLabel):
            self._summary_header_board_label.setFixedWidth(board_col_w)
        if isinstance(self._summary_header_sheets_label, QLabel):
            self._summary_header_sheets_label.setFixedWidth(sheet_pill_w)
        if isinstance(self._summary_header_edge_label, QLabel):
            self._summary_header_edge_label.setFixedWidth(edge_pill_w)
        for board in ordered_boards:
            count = int(board_sheet_counts.get(board) or 0)
            name = self._board_summary_text(board)
            row_host = QWidget()
            row_lay = QHBoxLayout(row_host)
            row_lay.setContentsMargins(0, 0, 0, 0)
            row_lay.setSpacing(4)
            name_pill = self._pill_label(name)
            name_pill.setFixedWidth(board_col_w)
            sheet_pill = self._pill_label(str(count))
            sheet_pill.setAlignment(Qt.AlignmentFlag.AlignCenter)
            sheet_pill.setFixedWidth(sheet_pill_w)
            edge_pill = self._pill_label(self._edge_tape_text(float(edge_map.get(board) or 0.0)))
            edge_pill.setAlignment(Qt.AlignmentFlag.AlignCenter)
            edge_pill.setFixedWidth(edge_pill_w)
            row_lay.addWidget(name_pill, 1)
            row_lay.addWidget(sheet_pill, 0)
            row_lay.addWidget(edge_pill, 0)
            self._summary_pills_layout.addWidget(row_host, 0, Qt.AlignmentFlag.AlignLeft)

    def _header_color_for_type(self, part_type: str) -> str:
        key = self._part_key(part_type)
        mapped = str(self._part_type_colors.get(key) or "").strip()
        if mapped:
            return mapped
        return "#E7EAF0"

    def _part_type_flash_color(self, part_type: str) -> str:
        base = QColor(self._header_color_for_type(part_type))
        if not base.isValid():
            return "#DDF2E7"
        r = int(base.red())
        g = int(base.green())
        b = int(base.blue())
        h, s, _v, _a = base.getHsv()
        looks_green = (h >= 70 and h <= 170 and s >= 35) or (g >= (r + 14) and g >= (b + 14))
        return "#FFDCDC" if looks_green else "#DDF2E7"

    def _toggle_part_type_collapsed(self, part_type: str) -> None:
        key = self._part_key(part_type)
        if not key:
            return
        if key in self._collapsed_part_types:
            self._collapsed_part_types.remove(key)
        else:
            self._collapsed_part_types.add(key)
        self._queue_autosave()
        self._apply_table_filters()

    def _split_clashing(self, value: str) -> tuple[str, str]:
        text = str(value or "").strip().upper()
        l_val = ""
        s_val = ""
        for token in text.replace(",", " ").split():
            tok = token.strip()
            if not tok:
                continue
            if tok in ("1L", "2L"):
                l_val = tok
                continue
            if tok in ("1S", "2S"):
                s_val = tok
                continue
            if tok in ("1SH", "2SH"):
                s_val = tok.replace("SH", "S")
        return l_val, s_val

    def _append_information_line(self, row_def: dict[str, object], text: str = "", primary: bool = False) -> None:
        info_layout = row_def.get("info_layout")
        info_lines = row_def.get("info_lines")
        if not isinstance(info_layout, QVBoxLayout) or not isinstance(info_lines, list):
            return
        line_host = QWidget()
        line_row = QHBoxLayout(line_host)
        line_row.setContentsMargins(0, 0, 0, 0)
        line_row.setSpacing(4)

        btn = QPushButton("+" if primary else "X")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedSize(24, 24)
        btn.setProperty("infoAction", "add" if primary else "remove")
        if primary:
            btn.setStyleSheet(
                "QPushButton { color: #1F8A4C; background: #EAF8F0; border: 1px solid #BFE8CF; border-radius: 8px; font-family: Consolas; font-size: 15px; font-weight: 700; text-align: center; padding: 0px; }"
                "QPushButton:hover { background: #DDF2E7; }"
            )
        else:
            btn.setStyleSheet(
                "QPushButton { color: #D14343; background: #FFECEC; border: 1px solid #F7B8B8; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
                "QPushButton:hover { background: #FFDCDC; }"
            )
        if primary:
            btn.clicked.connect(lambda _=False, rd=row_def: self._append_information_line(rd, text="", primary=False))
        else:
            btn.clicked.connect(lambda _=False, rd=row_def, host=line_host: self._remove_information_line(rd, host))
        line_row.addWidget(btn)

        edit = QLineEdit(str(text or ""))
        edit.setPlaceholderText("Information")
        edit.setMinimumHeight(24)
        edit.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        edit.editingFinished.connect(self._queue_autosave)
        line_row.addWidget(edit, 1)
        info_layout.addWidget(line_host)

        info_lines.append({"host": line_host, "button": btn, "edit": edit, "primary": primary})
        self._refresh_entry_row_theme(row_def)
        self._queue_autosave()

    def _remove_information_line(self, row_def: dict[str, object], host: QWidget) -> None:
        info_lines = row_def.get("info_lines")
        if not isinstance(info_lines, list):
            return
        if len(info_lines) <= 1:
            first = info_lines[0] if info_lines else None
            edit = first.get("edit") if isinstance(first, dict) else None
            if isinstance(edit, QLineEdit):
                edit.clear()
            return
        for idx, line in enumerate(list(info_lines)):
            line_host = line.get("host") if isinstance(line, dict) else None
            if line_host is host:
                info_lines.pop(idx)
                if isinstance(line_host, QWidget):
                    line_host.setParent(None)
                    line_host.deleteLater()
                break
        self._refresh_entry_row_theme(row_def)
        self._queue_autosave()

    def _set_information_lines(self, row_def: dict[str, object], lines: list[str]) -> None:
        info_lines = row_def.get("info_lines")
        if not isinstance(info_lines, list):
            return
        while len(info_lines) > 1:
            tail = info_lines[-1]
            host = tail.get("host") if isinstance(tail, dict) else None
            if isinstance(host, QWidget):
                self._remove_information_line(row_def, host)
            else:
                break
        if not info_lines:
            self._append_information_line(row_def, text="", primary=True)
            info_lines = row_def.get("info_lines") if isinstance(row_def.get("info_lines"), list) else []
        first = info_lines[0] if info_lines else None
        first_edit = first.get("edit") if isinstance(first, dict) else None
        if isinstance(first_edit, QLineEdit):
            first_edit.setText(str(lines[0] if lines else ""))
        for extra in lines[1:]:
            self._append_information_line(row_def, text=str(extra), primary=False)

    def _information_lines_text(self, row_def: dict[str, object]) -> list[str]:
        out: list[str] = []
        info_lines = row_def.get("info_lines")
        if not isinstance(info_lines, list):
            return out
        for line in info_lines:
            edit = line.get("edit") if isinstance(line, dict) else None
            if not isinstance(edit, QLineEdit):
                continue
            txt = str(edit.text() or "").strip()
            if txt:
                out.append(txt)
        return out

    def _wrap_list_cell_widget(
        self,
        control: QWidget,
        hpad: int = 4,
        vpad: int = 3,
        align: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
        fill: bool = False,
        row_divider_color: str = "",
        row_bg_color: str = "",
    ) -> QWidget:
        host = QWidget()
        if row_divider_color or row_bg_color:
            host.setObjectName("ListCellWrap")
            host.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
            bg = row_bg_color if row_bg_color else "transparent"
            border_line = f"border-bottom: 1px solid {row_divider_color};" if row_divider_color else "border-bottom: none;"
            host.setStyleSheet(
                "QWidget#ListCellWrap {"
                f"background: {bg};"
                "border: none;"
                f"{border_line}"
                "}"
            )
        lay = QHBoxLayout(host)
        lay.setContentsMargins(hpad, vpad, hpad, vpad)
        lay.setSpacing(0)
        if fill:
            lay.addWidget(control, 1, Qt.AlignmentFlag.AlignVCenter)
        else:
            lay.addWidget(control, alignment=align)
        if (not fill) and (align & Qt.AlignmentFlag.AlignLeft):
            lay.addStretch(1)
        return host

    def _refresh_entry_row_theme(self, row_def: dict[str, object]) -> None:
        frame = row_def.get("frame")
        inputs = row_def.get("inputs")
        if not isinstance(frame, QFrame) or not isinstance(inputs, dict):
            return
        part_text = str(row_def.get("partType") or self._active_part_type or "").strip()
        self._apply_entry_row_theme(frame, inputs, part_text)

    def _on_entry_part_type_changed(self, row_def: dict[str, object], part_text: str) -> None:
        frame = row_def.get("frame")
        inputs = row_def.get("inputs")
        if not isinstance(frame, QFrame) or not isinstance(inputs, dict):
            return
        part_name = str(part_text or "").strip()
        self._apply_entry_row_theme(frame, inputs, part_name)
        self._apply_row_autoclash_defaults(inputs, part_name)
        self._apply_row_cabinetry_mode(row_def, part_name)
        self._apply_row_drawer_mode(row_def, part_name)

    def _apply_row_autoclash_defaults(self, inputs: dict[str, QWidget], part_name: str) -> None:
        cfg = self._part_type_autoclash.get(self._part_key(part_name)) or {}
        board_widget = inputs.get("board")
        board_value = self._combo_selected_value(board_widget) if isinstance(board_widget, QComboBox) else ""
        if self._board_is_lacquer(board_value):
            return
        clash_widget = inputs.get("clashing")
        if not isinstance(clash_widget, QWidget):
            return
        combo_l = clash_widget.findChild(QComboBox, "clashingL")
        combo_s = clash_widget.findChild(QComboBox, "clashingS")
        target_l = str(cfg.get("clashL") or "").strip().upper()
        target_s = str(cfg.get("clashS") or "").strip().upper()
        if not target_l and not target_s:
            if isinstance(combo_l, QComboBox):
                combo_l.setCurrentIndex(0)
            if isinstance(combo_s, QComboBox):
                combo_s.setCurrentIndex(0)
            return
        if isinstance(combo_l, QComboBox):
            idx_l = combo_l.findText(target_l)
            if idx_l >= 0:
                combo_l.setCurrentIndex(idx_l)
        if isinstance(combo_s, QComboBox):
            idx_s = combo_s.findText(target_s)
            if idx_s >= 0:
                combo_s.setCurrentIndex(idx_s)

    def _apply_row_cabinetry_mode(self, row_def: dict[str, object], part_name: str) -> None:
        is_cabinetry = bool(self._part_type_cabinetry.get(self._part_key(part_name), False))
        cabinetry_host = row_def.get("cabinetry_host")
        clashing_combo_host = row_def.get("clashing_combo_host")
        if not isinstance(cabinetry_host, QWidget) or not isinstance(clashing_combo_host, QWidget):
            return
        if is_cabinetry:
            cabinetry_host.setVisible(True)
            clashing_combo_host.setVisible(False)
            inputs = row_def.get("inputs")
            clash_widget = inputs.get("clashing") if isinstance(inputs, dict) else None
            if isinstance(clash_widget, QWidget):
                combo_l = clash_widget.findChild(QComboBox, "clashingL")
                combo_s = clash_widget.findChild(QComboBox, "clashingS")
                if isinstance(combo_l, QComboBox):
                    combo_l.setCurrentIndex(0)
                if isinstance(combo_s, QComboBox):
                    combo_s.setCurrentIndex(0)
        else:
            cabinetry_host.setVisible(False)
            clashing_combo_host.setVisible(True)
            fixed_edit = row_def.get("fixed_shelf_edit")
            adjustable_edit = row_def.get("adjustable_shelf_edit")
            if isinstance(fixed_edit, QLineEdit):
                fixed_edit.clear()
            if isinstance(adjustable_edit, QLineEdit):
                adjustable_edit.clear()
            fixed_drill = row_def.get("fixed_shelf_drilling_combo")
            if isinstance(fixed_drill, QComboBox):
                idx_fd = fixed_drill.findText("No")
                fixed_drill.setCurrentIndex(idx_fd if idx_fd >= 0 else 0)
            adjustable_drill = row_def.get("adjustable_shelf_drilling_combo")
            if isinstance(adjustable_drill, QComboBox):
                idx_ad = adjustable_drill.findText("No")
                adjustable_drill.setCurrentIndex(idx_ad if idx_ad >= 0 else 0)

    def _apply_entry_row_theme(self, row_frame: QFrame, inputs: dict[str, QWidget], part_type: str) -> None:
        base = QColor(self._header_color_for_type(part_type))
        row_bg = base.name()
        row_border = base.darker(110).name()
        input_bg = base.lighter(112).name()
        input_border = base.darker(115).name()
        drop_bg = base.lighter(120).name()
        dropdown_border = base.darker(120).name()
        is_dark = base.lightness() < 130
        text_color = "#FFFFFF" if is_dark else "#1F2937"
        placeholder_color = "#E5E7EB" if is_dark else "#7B8493"
        arrow_color = "#F3F4F6" if is_dark else "#7B8493"

        row_frame.setStyleSheet(
            "QFrame {"
            f"background: {row_bg};"
            f"border: 1px solid {row_border};"
            "border-radius: 12px;"
            "}"
        )

        combo_style = (
            "QComboBox {"
            f"background:{input_bg}; border:1px solid {input_border}; border-radius: 8px;"
            f"color: {text_color};"
            "padding: 0 22px 0 8px; font-size: 12px; min-height: 30px; max-height: 30px;"
            "}"
            "QComboBox:disabled {"
            "background:#E5E7EB; color:#9CA3AF; border:1px solid #D1D5DB;"
            "}"
            "QComboBox::drop-down {"
            "subcontrol-origin: padding; subcontrol-position: top right;"
            f"width: 18px; border-left: 1px solid {dropdown_border};"
            f"background: {drop_bg}; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
            "}"
            "QComboBox::drop-down:disabled {"
            "background:#DDE1E7; border-left: 1px solid #D1D5DB;"
            "}"
            f"QComboBox::drop-down:on {{ background: {QColor(drop_bg).darker(108).name()}; }}"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
            "QComboBox QAbstractItemView { background: #FFFFFF; border: 1px solid #E4E6EC; selection-background-color: #EEF2F7; }"
        )
        line_style = (
            "QLineEdit {"
            f"background: {input_bg}; border: 1px solid {input_border}; border-radius: 8px;"
            f"color: {text_color};"
            "padding: 2px 8px; font-size: 12px; min-height: 24px;"
            "}"
            f"QLineEdit::placeholder {{ color: {placeholder_color}; }}"
        )

        for _label, key in self._fields:
            widget = inputs.get(key)
            if isinstance(widget, QComboBox):
                widget.setStyleSheet(combo_style)
                widget.setFixedHeight(30)
                if isinstance(widget, VComboBox):
                    widget.setProperty("arrowColor", arrow_color)
                    widget.update()
                if key == "partType":
                    self._apply_part_type_option_colors(widget)
                    self._style_combo_popup_like_status(widget, use_item_role_colors=True)
            elif key == "information":
                if isinstance(widget, QWidget):
                    for btn in widget.findChildren(QPushButton):
                        if str(btn.property("infoAction") or "") == "add":
                            btn.setStyleSheet(
                                "QPushButton { color: #1F8A4C; background: #EAF8F0; border: 1px solid #BFE8CF; border-radius: 8px; font-family: Consolas; font-size: 15px; font-weight: 700; text-align: center; padding: 0px; }"
                                "QPushButton:hover { background: #DDF2E7; }"
                            )
                        else:
                            btn.setStyleSheet(
                                "QPushButton { color: #D14343; background: #FFECEC; border: 1px solid #F7B8B8; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 0; }"
                                "QPushButton:hover { background: #FFDCDC; }"
                            )
                    for edit in widget.findChildren(QLineEdit):
                        edit.setStyleSheet(line_style)
            elif key == "clashing" and isinstance(widget, QWidget):
                compact_combo_style = (
                    "QComboBox {"
                    f"background:{input_bg}; border:1px solid {input_border}; border-radius: 7px;"
                    f"color: {text_color};"
                    "padding: 0 16px 0 6px; font-size: 11px; min-height: 18px; max-height: 18px;"
                    "}"
                    "QComboBox::drop-down {"
                    "subcontrol-origin: padding; subcontrol-position: top right;"
                    f"width: 14px; border-left: 1px solid {dropdown_border};"
                    f"background: {drop_bg}; border-top-right-radius: 7px; border-bottom-right-radius: 7px;"
                    "}"
                    "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
                )
                compact_line_style = (
                    "QLineEdit {"
                    f"background: {input_bg}; border: 1px solid {input_border}; border-radius: 7px;"
                    f"color: {text_color};"
                    "padding: 0px 6px; font-size: 11px; min-height: 18px; max-height: 18px;"
                    "}"
                )
                for combo in widget.findChildren(QComboBox):
                    if combo.objectName() == "cabShelfDrillingCombo":
                        combo.setStyleSheet(compact_combo_style)
                        combo.setFixedHeight(18)
                    else:
                        combo.setStyleSheet(combo_style)
                        combo.setFixedHeight(30)
                    if isinstance(combo, VComboBox):
                        combo.setProperty("arrowColor", arrow_color)
                        combo.update()
                for edit in widget.findChildren(QLineEdit):
                    if edit.objectName() == "cabShelfValueInput":
                        edit.setStyleSheet(compact_line_style)
                        edit.setFixedHeight(18)
                    else:
                        edit.setStyleSheet(line_style)
                for lbl in widget.findChildren(QLabel):
                    lbl.setStyleSheet(
                        "QLabel {"
                        f"color: {text_color}; font-size: 11px; font-weight: 600;"
                        "background: transparent; border: none;"
                        "}"
                    )
            elif key == "height" and isinstance(widget, QWidget):
                stack = widget.findChild(QStackedWidget)
                if isinstance(stack, QStackedWidget):
                    stack.setStyleSheet("QStackedWidget { background: transparent; border: none; }")
                    stack.setFixedHeight(30)
                for btn in widget.findChildren(QPushButton):
                    if bool(btn.property("drawerHeightAdd")):
                        btn.setStyleSheet(
                            "QPushButton { color: #1F8A4C; background: #EAF8F0; border: 1px solid #BFE8CF; border-radius: 8px; font-family: Consolas; font-size: 15px; font-weight: 700; text-align: center; padding: 0px; }"
                            "QPushButton:hover { background: #DDF2E7; }"
                        )
                        btn.setFixedSize(24, 24)
                for txt in widget.findChildren(QLineEdit):
                    if txt.objectName() == "drawerHeightValueLabel":
                        txt.setStyleSheet(
                            "QLineEdit {"
                            f"background: {input_bg}; border: 1px solid {input_border}; border-radius: 8px;"
                            f"color: {text_color};"
                            "padding: 0px 8px 0px 8px; font-size: 12px;"
                            "}"
                        )
                        txt.setTextMargins(0, 0, 0, 0)
                        txt.setFixedHeight(30)
                        txt.setFixedWidth(int(self.ENTRY_FIELD_WIDTHS.get("width", 76)))
                for edit in widget.findChildren(QLineEdit):
                    if edit.objectName() == "drawerHeightValueLabel":
                        continue
                    edit.setStyleSheet(line_style)
                    edit.setFixedHeight(30)
            elif isinstance(widget, QLineEdit):
                widget.setStyleSheet(line_style)
                if key == "depth" and bool(widget.property("_persistMissingError")):
                    widget.setStyleSheet(
                        line_style
                        + "QLineEdit { background:#FFDCDC; border:1px solid #F2A7A7; border-radius:8px; }"
                    )

    def _render_grouped_rows(self, rows: list[dict]) -> None:
        if self._groups_layout is None:
            return

        self._clear_inline_drawer_height_overlays()
        self._row_locators = {}
        self._part_counter_widgets = {}

        while self._groups_layout.count():
            item = self._groups_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

        grouped: dict[str, list[dict]] = {}
        for row in rows:
            part = str(row.get("partType") or "").strip() or "Other"
            grouped.setdefault(part, []).append(row)

        ordered_keys: list[str] = []
        remaining = list(grouped.keys())
        for seed in (self._part_types_seed or []):
            seed_key = self._part_key(seed)
            for key in list(remaining):
                if self._part_key(key) == seed_key:
                    ordered_keys.append(key)
                    remaining.remove(key)
        ordered_keys.extend(sorted(remaining, key=lambda x: self._part_key(x)))

        if not ordered_keys:
            self._groups_layout.addStretch(1)
            empty_label = QLabel("No parts to show")
            empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty_label.setStyleSheet(
                "QLabel { color: #9CA3AF; font-size: 24px; font-weight: 700; background: transparent; border: none; }"
            )
            self._groups_layout.addWidget(empty_label, 0, Qt.AlignmentFlag.AlignHCenter)
            self._groups_layout.addStretch(1)
            return

        for part_type in ordered_keys:
            tint = self._header_color_for_type(part_type)
            base = QColor(tint)
            part_key = self._part_key(part_type)
            is_collapsed = part_key in self._collapsed_part_types
            hue = int(base.hue())
            is_light_blue = base.isValid() and base.lightness() >= 150 and 175 <= hue <= 255
            if is_light_blue:
                # Light blues can wash out to near-white; keep stronger tint in list sections.
                card_bg = base.lighter(122).name()
                header_bg = base.lighter(106).name()
                table_row_bg = base.lighter(116).name()
                table_row_bg_alt = QColor(table_row_bg).darker(108).name()
            else:
                card_bg = base.lighter(132).name()
                header_bg = base.lighter(112).name()
                table_row_bg = base.lighter(128).name()
                table_row_bg_alt = QColor(table_row_bg).darker(104).name()
            card_border = tint
            table_border = base.lighter(120).name()
            badge_fg = "#FFFFFF" if base.lightness() < 135 else "#111827"
            section_fg = "#FFFFFF" if base.lightness() < 135 else "#111827"
            section_fg_muted = "#E5E7EB" if base.lightness() < 135 else "#374151"
            block = QFrame()
            block.setObjectName("CutlistPartTypeBlock")
            block.setStyleSheet(
                "QFrame#CutlistPartTypeBlock {"
                f"background: {card_bg};"
                f"border: 1px solid {card_border};"
                "border-radius: 12px;"
                "}"
            )
            block_layout = QVBoxLayout(block)
            block_layout.setContentsMargins(8, 8, 8, 8)
            block_layout.setSpacing(6)

            top = QHBoxLayout()
            badge = QLabel(part_type)
            badge.setStyleSheet(
                f"color: {badge_fg}; background: {tint}; border: none; border-radius: 10px; padding: 4px 12px; font-size: 22px; font-weight: 700;"
            )
            top.addWidget(badge)
            top.addSpacing(10)
            part_qty_total = self._rows_quantity_total(grouped[part_type])
            count = QLabel(f"{part_qty_total} parts")
            count.setStyleSheet(
                "QLabel {"
                f"color: {section_fg};"
                "font-size: 12px;"
                "font-weight: 700;"
                f"background: {header_bg};"
                f"border: 1px solid {QColor(header_bg).darker(106).name()};"
                "border-radius: 10px;"
                "padding: 4px 10px;"
                "}"
            )
            top.addWidget(count)
            self._part_counter_widgets[self._part_key(part_type)] = count
            chip_h = max(30, badge.sizeHint().height(), count.sizeHint().height())
            badge.setFixedHeight(chip_h)
            count.setFixedHeight(chip_h)

            toggle_btn = QPushButton("+" if is_collapsed else "−")
            toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            toggle_btn.setFixedSize(chip_h, chip_h)
            btn_font = QFont(toggle_btn.font())
            btn_font.setBold(True)
            btn_font.setPixelSize(max(18, chip_h - 6))
            toggle_btn.setFont(btn_font)
            toggle_btn.setContentsMargins(0, 0, 0, 0)
            toggle_btn.setToolTip("Expand" if is_collapsed else "Minimize")
            btn_bg = base.lighter(108).name()
            btn_bd = base.darker(112).name()
            btn_fg = "#FFFFFF" if QColor(btn_bg).lightness() < 145 else "#1F2937"
            btn_hover = QColor(btn_bg).darker(106).name()
            toggle_btn.setStyleSheet(
                "QPushButton {"
                f"color: {btn_fg}; background: {btn_bg}; border: 1px solid {btn_bd};"
                "border-radius: 9px; padding: 0 0 7px 2px; text-align: center;"
                "}"
                f"QPushButton:hover {{ background: {btn_hover}; border: 1px solid {QColor(btn_bd).darker(104).name()}; }}"
            )
            toggle_btn.clicked.connect(lambda _=False, p=part_type: self._toggle_part_type_collapsed(p))
            top.addStretch(1)
            top.addWidget(toggle_btn)
            block_layout.addLayout(top)

            if is_collapsed:
                self._groups_layout.addWidget(block)
                continue

            is_cabinetry_group = bool(self._part_type_cabinetry.get(self._part_key(part_type), False))
            table = QTableWidget()
            group_fields = [f for f in self._fields if f[1] != "partType"]
            header_labels = []
            for label, key in group_fields:
                if key == "clashing" and is_cabinetry_group:
                    header_labels.append("Shelves")
                else:
                    header_labels.append(label)
            pending_count = len(self._pending_delete_ids)
            cols = ["", "", "Part"] + header_labels
            table.setColumnCount(len(cols))
            table.setHorizontalHeaderLabels(cols)
            for c_idx, col_name in enumerate(cols):
                hdr_item = table.horizontalHeaderItem(c_idx)
                if not isinstance(hdr_item, QTableWidgetItem):
                    continue
                if str(col_name or "").strip() in {"Part", "Board", "Part Name", "Information"}:
                    hdr_item.setTextAlignment(int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter))
            render_rows: list[tuple[str, dict, dict[str, object]]] = []
            for base_visual_idx, _row in enumerate(grouped[part_type]):
                render_rows.append(("base", _row, {"parent_visual_index": int(base_visual_idx)}))
                _row_id = int((_row or {}).get("__id", -1))
                _pt = str((_row or {}).get("partType") or "").strip()
                if _row_id in self._drawer_breakdown_expanded and self._is_drawer_part_type(_pt):
                    render_rows.append(
                        (
                            "drawer_bottom",
                            _row,
                            {
                                "quantity": self._drawer_bottom_quantity_for_row(_row),
                                "parent_visual_index": int(base_visual_idx),
                            },
                        )
                    )
                    for letter, back_h, back_qty in self._drawer_back_groups_for_row(_row):
                        render_rows.append(
                            (
                                "drawer_back",
                                _row,
                                {
                                    "letter": str(letter or "").strip(),
                                    "back_height": str(back_h or "").strip(),
                                    "quantity": int(back_qty),
                                    "parent_visual_index": int(base_visual_idx),
                                },
                            )
                        )
                if _row_id in self._cabinet_breakdown_expanded and bool(self._part_type_cabinetry.get(self._part_key(_pt), False)):
                    for piece in self._cabinet_breakdown_rows_for_row(_row):
                        render_rows.append(
                            (
                                "cabinet_part",
                                _row,
                                {
                                    "name": str(piece.get("name") or ""),
                                    "height": str(piece.get("height") or ""),
                                    "width": str(piece.get("width") or ""),
                                    "depth": str(piece.get("depth") or ""),
                                    "quantity": int(piece.get("quantity") or 1),
                                    "parent_visual_index": int(base_visual_idx),
                                },
                            )
                        )
            table.setRowCount(len(render_rows))
            table.verticalHeader().setVisible(False)
            table.verticalHeader().setDefaultSectionSize(36)
            table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
            table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
            table.setShowGrid(False)
            table.setFrameShape(QFrame.Shape.NoFrame)
            table.setCornerButtonEnabled(False)
            table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            table.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            table.setAlternatingRowColors(False)
            self._enable_kinetic_scroll(table.viewport())

            table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Fixed)
            table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)
            table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)
            table.setColumnWidth(0, 64)
            table.setColumnWidth(1, 86)
            table.setColumnWidth(2, 130)
            for c, (_label, key) in enumerate(group_fields, start=3):
                if key == "information":
                    table.horizontalHeader().setSectionResizeMode(c, QHeaderView.ResizeMode.Stretch)
                    table.setColumnWidth(c, int(self.ENTRY_FIELD_WIDTHS.get(key, 220)))
                else:
                    table.horizontalHeader().setSectionResizeMode(c, QHeaderView.ResizeMode.Fixed)
                    base_w = int(self.ENTRY_FIELD_WIDTHS.get(key, 90))
                    if key == "partType":
                        base_w += 10
                    table.setColumnWidth(c, base_w)

            table.setStyleSheet(
                f"QTableWidget {{ background: {table_row_bg}; border: none; gridline-color: transparent; }}"
                f"QTableWidget::item {{ border: none; border-bottom: 1px solid {header_bg}; padding: 0px; }}"
                "QTableCornerButton::section { background: transparent; border: none; }"
                f"QHeaderView {{ background: {header_bg}; border: none; border-radius: 8px; }}"
                f"QHeaderView::section {{ background: transparent; color: {section_fg}; font-size: 12px; font-weight: 700; padding: 8px; border: none; }}"
            )
            table.viewport().setStyleSheet(f"background: {table_row_bg};")
            table.horizontalHeader().setHighlightSections(False)
            table.horizontalHeader().setSectionsClickable(False)
            if pending_count > 0:
                header = table.horizontalHeader()
                is_confirm = bool(self._delete_all_confirm_armed and self._delete_all_confirm_count == pending_count)
                btn_text = f"Confirm ({pending_count})" if is_confirm else f"Delete ({pending_count})"
                btn = QPushButton(btn_text, header)
                btn.setCursor(Qt.CursorShape.PointingHandCursor)
                if is_confirm:
                    btn.setStyleSheet(
                        "QPushButton { background: #FEE2E2; color: #991B1B; border: 1px solid #EF9A9A; border-radius: 8px; font-size: 11px; font-weight: 900; padding: 2px 6px; }"
                        "QPushButton:hover { background: #FECACA; }"
                    )
                else:
                    btn.setStyleSheet(
                        "QPushButton { background: #FFECEC; color: #C62828; border: 1px solid #F7B8B8; border-radius: 8px; font-size: 11px; font-weight: 800; padding: 2px 6px; }"
                        "QPushButton:hover { background: #FFDCDC; }"
                    )
                btn.clicked.connect(self._delete_all_pending_rows)
                x0 = header.sectionPosition(0)
                w0 = header.sectionSize(0)
                w1 = header.sectionSize(1)
                hh = max(header.height(), header.sizeHint().height(), 24)
                btn.setGeometry(int(x0 + 2), 2, int(max(24, w0 + w1 - 4)), int(max(20, hh - 4)))
                btn.show()

            key_to_col = {key: idx + 3 for idx, (_label, key) in enumerate(group_fields)}
            for r_idx, row_item in enumerate(render_rows):
                row_kind, row, row_meta = row_item
                row_id = int(row.get("__id", -1))
                pending_delete = row_id in self._pending_delete_ids
                parent_visual_idx = int((row_meta or {}).get("parent_visual_index", r_idx))
                base_row_bg = "#FFDCDC" if pending_delete else (table_row_bg_alt if (parent_visual_idx % 2 == 1) else table_row_bg)
                if pending_delete:
                    row_bg = "#FFDCDC"
                elif row_id in self._focus_flash_row_ids and self._focus_flash_on:
                    row_bg = "#DDF2E7"
                else:
                    row_bg = base_row_bg
                if row_kind != "base":
                    # Keep expanded drawer detail rows on the same background as parent row.
                    row_bg = base_row_bg
                row_q = QColor(row_bg if QColor(row_bg).isValid() else "#FFFFFF")
                row_brush = QBrush(QColor(row_bg))
                if row_kind != "base":
                    base_h = 30
                elif is_cabinetry_group:
                    # Keep cabinetry row height consistent between view/edit modes.
                    base_h = 94
                else:
                    base_h = 36
                if row_kind == "base" and self._inline_edit_row_id == row_id:
                    info_lines = [ln.strip() for ln in str(row.get("information") or "").splitlines() if ln.strip()]
                    if len(info_lines) > 1:
                        info_h = 6 + (len(info_lines) * 22)
                        base_h = max(base_h, info_h)
                table.setRowHeight(r_idx, base_h)
                for c_idx in range(table.columnCount()):
                    bg_item = table.item(r_idx, c_idx)
                    if bg_item is None:
                        bg_item = QTableWidgetItem("")
                        bg_item.setFlags(Qt.ItemFlag.ItemIsEnabled)
                        table.setItem(r_idx, c_idx, bg_item)
                    bg_item.setBackground(row_brush)
                    bg_item.setData(Qt.ItemDataRole.BackgroundRole, row_brush)

                # Ensure zebra color spans the full row width, including cells with no content.
                for c_idx in range(table.columnCount()):
                    if table.cellWidget(r_idx, c_idx) is not None:
                        continue
                    filler = QWidget()
                    filler.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                    filler.setStyleSheet("QWidget { background: transparent; border: none; }")
                    table.setCellWidget(
                        r_idx,
                        c_idx,
                        self._wrap_list_cell_widget(
                            filler,
                            hpad=0,
                            vpad=0,
                            fill=True,
                            row_bg_color=row_bg,
                        ),
                    )

                part_text = str(row.get("partType") or "").strip() or "Part"
                is_drawer_row = self._is_drawer_part_type(part_text)
                is_cabinetry_row = bool(self._part_type_cabinetry.get(self._part_key(part_text), False))

                if row_kind == "base":
                    delete_btn = QPushButton("✓" if pending_delete else "X")
                    delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                    delete_btn.setFixedSize(24, 24)
                    if pending_delete:
                        delete_btn.setStyleSheet(
                            "QPushButton { color: #1F8A4C; background: #EAF8F0; border: 1px solid #BFE8CF; border-radius: 8px; font-weight: 800; padding: 0; }"
                            "QPushButton:hover { background: #DDF2E7; }"
                        )
                    else:
                        delete_btn.setStyleSheet(
                            "QPushButton { color: #D14343; background: #FFECEC; border: 1px solid #F7B8B8; border-radius: 8px; font-weight: 700; padding: 0; }"
                            "QPushButton:hover { background: #FFDCDC; }"
                        )
                    delete_btn.clicked.connect(lambda _=False, rid=row_id: self._on_delete_row_clicked(rid))

                    drawer_toggle_btn = None
                    if is_drawer_row:
                        expanded = row_id in self._drawer_breakdown_expanded
                        drawer_toggle_btn = QPushButton("⤴" if expanded else "⤵")
                        drawer_toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                        drawer_toggle_btn.setFixedSize(20, 20)
                        drawer_toggle_btn.setStyleSheet(
                            "QPushButton { color: #2F5E8A; background: #E9F0F8; border: 1px solid #CBDDEE; border-radius: 7px; font-weight: 800; padding: 0; }"
                            "QPushButton:hover { color: #224A74; background: #DCE8F5; border: 1px solid #AFC9E2; }"
                        )
                        drawer_toggle_btn.clicked.connect(lambda _=False, rid=row_id: self._toggle_drawer_breakdown(rid))

                    cabinet_toggle_btn = None
                    if is_cabinetry_row:
                        expanded = row_id in self._cabinet_breakdown_expanded
                        cabinet_toggle_btn = QPushButton("⤴" if expanded else "⤵")
                        cabinet_toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                        cabinet_toggle_btn.setFixedSize(20, 20)
                        cabinet_toggle_btn.setStyleSheet(
                            "QPushButton { color: #2F5E8A; background: #E9F0F8; border: 1px solid #CBDDEE; border-radius: 7px; font-weight: 800; padding: 0; }"
                            "QPushButton:hover { color: #224A74; background: #DCE8F5; border: 1px solid #AFC9E2; }"
                        )
                        cabinet_toggle_btn.clicked.connect(lambda _=False, rid=row_id: self._toggle_cabinet_breakdown(rid))

                    del_host = QWidget()
                    del_host.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                    del_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                    del_l = QHBoxLayout(del_host)
                    del_l.setContentsMargins(6, 1, 2, 1)
                    del_l.setSpacing(4)
                    del_l.addStretch(1)
                    del_l.addWidget(delete_btn, 0, Qt.AlignmentFlag.AlignVCenter)
                    if drawer_toggle_btn is not None:
                        del_l.addSpacing(8)
                        del_l.addWidget(drawer_toggle_btn, 0, Qt.AlignmentFlag.AlignVCenter)
                    if cabinet_toggle_btn is not None:
                        del_l.addSpacing(8)
                        del_l.addWidget(cabinet_toggle_btn, 0, Qt.AlignmentFlag.AlignVCenter)
                    table.setCellWidget(
                        r_idx,
                        0,
                        self._wrap_list_cell_widget(del_host, hpad=0, vpad=0, fill=True, row_bg_color=row_bg),
                    )

                    edit_btn = QPushButton("Edit")
                    edit_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                    edit_btn.setMinimumWidth(52)
                    edit_btn.setFixedHeight(24)
                    if self._inline_edit_row_id == row_id:
                        edit_btn.setText("Done")
                        edit_btn.setStyleSheet(
                            "QPushButton { color: #FFFFFF; background: #2E8B57; border: 1px solid #247347; border-radius: 8px; padding: 0 10px; font-weight: 700; }"
                            "QPushButton:hover { background: #236A41; border: 1px solid #1D5A37; }"
                        )
                    else:
                        edit_btn.setStyleSheet(
                            "QPushButton { color: #4F78A3; background: #E9F0F8; border: 1px solid #CBDDEE; border-radius: 8px; padding: 0 10px; font-weight: 700; }"
                            "QPushButton:hover { color: #2F5E8A; background: #DCE8F5; border: 1px solid #AFC9E2; }"
                        )
                    edit_btn.clicked.connect(lambda _=False, rid=row_id: self._edit_row_by_id(rid))
                    table.setCellWidget(
                        r_idx,
                        1,
                        self._wrap_list_cell_widget(edit_btn, hpad=2, vpad=1, align=Qt.AlignmentFlag.AlignCenter, row_bg_color=row_bg),
                    )

                    part_color = self._header_color_for_type(part_text)
                    part_q = QColor(part_color)
                    if not part_q.isValid():
                        part_q = QColor("#E7EAF0")
                    fg = "#FFFFFF" if part_q.lightness() < 140 else "#111827"
                    part_btn = QPushButton(part_text)
                    part_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                    part_btn.setStyleSheet(
                        "QPushButton {"
                        f"color: {fg}; background: {part_q.name()}; border: 1px solid {part_q.darker(108).name()};"
                        "border-radius: 8px; padding: 1px 8px; font-size: 11px; font-weight: 700; text-align: left;"
                        "}"
                        f"QPushButton:hover {{ background: {part_q.darker(104).name()}; }}"
                    )
                    part_btn.clicked.connect(lambda _=False, rid=row_id, w=part_btn: self._open_row_part_type_picker(rid, w))
                    table.setCellWidget(
                        r_idx,
                        2,
                        self._wrap_list_cell_widget(part_btn, hpad=4, vpad=3, fill=True, row_bg_color=row_bg),
                    )

                    for col, (_label, key) in enumerate(group_fields):
                        out_col = col + 3
                        if self._inline_edit_row_id == row_id:
                            editor = self._build_inline_edit_widget(
                                row_id,
                                key,
                                str(row.get(key) or ""),
                                is_cabinetry_group,
                                row_bg_color=row_bg,
                            )
                            table.setCellWidget(r_idx, out_col, self._wrap_list_cell_widget(editor, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                        elif key == "clashing" and is_cabinetry_group:
                            fixed = str(row.get("fixedShelf") or "").strip()
                            adjustable = str(row.get("adjustableShelf") or "").strip()
                            fixed_drill = self._normalize_drilling_value(str(row.get("fixedShelfDrilling") or "No").strip())
                            adjustable_drill = self._normalize_drilling_value(str(row.get("adjustableShelfDrilling") or "No").strip())
                            shelves_host = QWidget()
                            shelves_host.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                            shelves_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                            shelves_layout = QVBoxLayout(shelves_host)
                            shelves_layout.setContentsMargins(4, 2, 4, 2)
                            shelves_layout.setSpacing(2)

                            def _shelf_block(title: str, qty: str, drill: str) -> QWidget:
                                block = QWidget()
                                block.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                                block.setStyleSheet("QWidget { background: transparent; border: none; }")
                                block_l = QVBoxLayout(block)
                                block_l.setContentsMargins(0, 0, 0, 0)
                                block_l.setSpacing(1)
                                top_lbl = QLabel(f"{title}: {qty}" if qty else f"{title}:")
                                top_lbl.setStyleSheet(f"QLabel {{ color: {section_fg_muted}; font-size: 11px; background: transparent; border: none; }}")
                                drill_row = QWidget()
                                drill_row.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                                drill_row.setStyleSheet("QWidget { background: transparent; border: none; }")
                                drill_row_l = QHBoxLayout(drill_row)
                                drill_row_l.setContentsMargins(0, 0, 0, 0)
                                drill_row_l.setSpacing(4)
                                arrow_lbl = QLabel()
                                arrow_lbl.setStyleSheet("QLabel { background: transparent; border: none; }")
                                arrow_lbl.setFixedSize(10, 10)
                                arrow_pix = self._tinted_icon_pixmap("arrow.png", 9, section_fg_muted)
                                if not arrow_pix.isNull():
                                    arrow_lbl.setPixmap(arrow_pix)
                                drill_lbl = QLabel(f"Drilling: {drill}")
                                drill_lbl.setStyleSheet(f"QLabel {{ color: {section_fg_muted}; font-size: 11px; background: transparent; border: none; }}")
                                drill_row_l.addWidget(arrow_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
                                drill_row_l.addWidget(drill_lbl, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                                drill_row_l.addStretch(1)
                                block_l.addWidget(top_lbl)
                                block_l.addWidget(drill_row)
                                return block

                            shelves_layout.addWidget(_shelf_block("Fixed", fixed, fixed_drill))
                            shelves_layout.addWidget(_shelf_block("Adjustable", adjustable, adjustable_drill))
                            table.setCellWidget(r_idx, out_col, self._wrap_list_cell_widget(shelves_host, hpad=4, vpad=2, row_bg_color=row_bg))
                        elif key == "information":
                            cell_text = str(row.get(key) or "")
                            lines = [ln.strip() for ln in cell_text.splitlines() if ln.strip()]
                            info_host = QWidget()
                            info_host.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                            info_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                            info_lay = QVBoxLayout(info_host)
                            info_lay.setContentsMargins(4, 1, 4, 1)
                            info_lay.setSpacing(1)
                            if not lines:
                                lines = [""]
                            for ln in lines:
                                lbl = QLabel(ln)
                                lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                                info_lay.addWidget(lbl)
                            table.setCellWidget(r_idx, out_col, self._wrap_list_cell_widget(info_host, hpad=0, vpad=0, fill=True, row_bg_color=row_bg))
                        else:
                            cell_text = str(row.get(key) or "")
                            if key == "board":
                                cell_text = self._board_display_text(cell_text)
                                chip, rest = self._split_board_chip(cell_text)
                                if chip:
                                    board_host = QWidget()
                                    board_host.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                                    board_host.setStyleSheet("QWidget { background: transparent; border: none; }")
                                    board_lay = QHBoxLayout(board_host)
                                    board_lay.setContentsMargins(4, 1, 4, 1)
                                    board_lay.setSpacing(6)
                                    chip_lbl = QLabel(chip)
                                    chip_bg = row_q.darker(106).name()
                                    chip_border = row_q.darker(120).name()
                                    chip_lbl.setStyleSheet(
                                        f"QLabel {{ color: {section_fg}; font-size: 11px; font-weight: 700; background: {chip_bg}; border: 1px solid {chip_border}; border-radius: 6px; padding: 0px 5px; }}"
                                    )
                                    txt_lbl = QLabel(rest)
                                    txt_lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                                    board_lay.addWidget(chip_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
                                    board_lay.addWidget(txt_lbl, 1, Qt.AlignmentFlag.AlignVCenter)
                                    table.setCellWidget(r_idx, out_col, self._wrap_list_cell_widget(board_host, hpad=0, vpad=0, fill=True, row_bg_color=row_bg))
                                    continue
                            if key == "height" and is_drawer_row:
                                hover_lbl = HoverLetterLabel(
                                    on_hover=lambda anchor, entered, rid=row_id: self._on_inline_drawer_height_hover(rid, anchor, entered)
                                )
                                hover_lbl.setText(cell_text)
                                hover_lbl.setToolTip(cell_text)
                                hover_lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                                hover_lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                                hover_lbl.setFixedHeight(22)
                                hover_lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                                table.setCellWidget(
                                    r_idx,
                                    out_col,
                                    self._wrap_list_cell_widget(hover_lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg),
                                )
                                continue
                            txt_lbl = QLabel(cell_text)
                            if key in ("height", "width", "depth", "quantity", "clashing"):
                                txt_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            else:
                                txt_lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                            txt_lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(
                                r_idx,
                                out_col,
                                self._wrap_list_cell_widget(txt_lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg),
                            )
                    self._row_locators[row_id] = {
                        "table": table,
                        "row_index": int(r_idx),
                        "part_type": part_type,
                        "base_row_bg": base_row_bg,
                    }
                else:
                    if row_kind == "cabinet_part":
                        detail_name = str((row_meta or {}).get("name") or "").strip()
                        detail_h = str((row_meta or {}).get("height") or "").strip()
                        detail_w = str((row_meta or {}).get("width") or "").strip()
                        detail_d = str((row_meta or {}).get("depth") or "").strip()
                        detail_qty = int((row_meta or {}).get("quantity") or self._row_quantity_count(row))
                    else:
                        letter = str((row_meta or {}).get("letter") or "").strip()
                        detail_name = "Bottom" if row_kind == "drawer_bottom" else ("Back" if not letter else f"Back ({letter})")
                        bottom_w, bottom_d, back_w = self._drawer_breakdown_values_for_row(row)
                        back_h = str((row_meta or {}).get("back_height") or "").strip()
                        detail_qty = int((row_meta or {}).get("quantity") or self._row_quantity_count(row))
                    detail_part = QLabel(detail_name)
                    detail_part.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                    detail_part.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; font-weight: 700; background: transparent; border: none; padding-left: 8px; }}")
                    name_col = int(key_to_col.get("name", 2))
                    table.setCellWidget(
                        r_idx,
                        name_col,
                        self._wrap_list_cell_widget(detail_part, hpad=4, vpad=1, fill=True, row_bg_color=row_bg),
                    )
                    if "quantity" in key_to_col:
                        q_lbl = QLabel(str(max(1, detail_qty)))
                        q_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                        q_lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                        table.setCellWidget(r_idx, key_to_col["quantity"], self._wrap_list_cell_widget(q_lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                    if row_kind == "cabinet_part":
                        if "height" in key_to_col:
                            lbl = QLabel(detail_h)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["height"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                        if "width" in key_to_col:
                            lbl = QLabel(detail_w)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["width"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                        if "depth" in key_to_col:
                            lbl = QLabel(detail_d)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["depth"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                    elif row_kind == "drawer_bottom":
                        if "width" in key_to_col:
                            lbl = QLabel(bottom_w)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["width"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                        if "depth" in key_to_col:
                            lbl = QLabel(bottom_d)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["depth"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                    else:
                        if "width" in key_to_col:
                            lbl = QLabel(back_w)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["width"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                        if "height" in key_to_col:
                            lbl = QLabel(back_h)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["height"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))
                        if "clashing" in key_to_col:
                            w_num = self._parse_positive_number(str(back_w or ""))
                            h_num = self._parse_positive_number(str(back_h or ""))
                            clash_txt = ""
                            if w_num is not None and h_num is not None and h_num > 0:
                                clash_txt = "1S" if w_num < h_num else "1L"
                            lbl = QLabel(clash_txt)
                            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                            lbl.setStyleSheet(f"QLabel {{ color: {section_fg}; font-size: 12px; background: transparent; border: none; }}")
                            table.setCellWidget(r_idx, key_to_col["clashing"], self._wrap_list_cell_widget(lbl, hpad=4, vpad=1, fill=True, row_bg_color=row_bg))


            header_h = 0
            try:
                hh = table.horizontalHeader()
                header_h = max(hh.height(), hh.sizeHint().height(), 24)
            except Exception:
                header_h = 24
            rows_h = 0
            for rr in range(table.rowCount()):
                rh = table.rowHeight(rr)
                rows_h += rh if rh > 0 else table.verticalHeader().defaultSectionSize()
            frame_h = (table.frameWidth() * 2) + 2
            table.setFixedHeight(header_h + rows_h + frame_h)

            block_layout.addWidget(table)
            self._groups_layout.addWidget(block)

        self._groups_layout.addStretch(1)

    def _scroll_row_into_view(self, row_id: int) -> None:
        rid = int(row_id)
        loc = self._row_locators.get(rid) if isinstance(self._row_locators, dict) else None
        if not isinstance(loc, dict):
            return
        table = loc.get("table")
        row_index = int(loc.get("row_index", -1))
        if not isinstance(table, QTableWidget) or row_index < 0:
            return
        if not isinstance(self._groups_scroll, QScrollArea):
            return
        container = self._groups_scroll.widget()
        if not isinstance(container, QWidget):
            return
        try:
            header = table.horizontalHeader()
            header_h = int(max(header.height(), header.sizeHint().height(), 24))
        except Exception:
            header_h = 24
        row_top = 0
        for i in range(max(0, row_index)):
            try:
                row_top += int(table.rowHeight(i))
            except Exception:
                continue
        mapped = table.mapTo(container, QPoint(0, 0))
        y_target = int(mapped.y()) + header_h + row_top
        vbar = self._groups_scroll.verticalScrollBar()
        view_h = max(1, int(self._groups_scroll.viewport().height()))
        try:
            self._groups_scroll.ensureVisible(8, y_target, 8, max(40, view_h // 3))
        except Exception:
            pass
        vbar.setValue(max(0, y_target - max(40, view_h // 3)))

    def _apply_focus_row_visual(self, row_id: int, enabled: bool) -> None:
        rid = int(row_id)
        loc = self._row_locators.get(rid) if isinstance(self._row_locators, dict) else None
        if not isinstance(loc, dict):
            return
        table = loc.get("table")
        row_index = int(loc.get("row_index", -1))
        if not isinstance(table, QTableWidget) or row_index < 0:
            return
        base_bg = str(loc.get("base_row_bg") or "#FFFFFF")
        flash_bg = self._part_type_flash_color(str(loc.get("part_type") or ""))
        row_bg = flash_bg if bool(enabled) else base_bg
        brush = QBrush(QColor(row_bg))
        border = QColor(row_bg).darker(112).name()
        drop_bg = QColor(row_bg).darker(104).name()

        def _apply_child_flash_styles(host_widget: QWidget) -> None:
            if not isinstance(host_widget, QWidget):
                return
            for child in host_widget.findChildren(QWidget):
                if isinstance(child, (QLineEdit, QComboBox, QTextEdit)):
                    base_style = child.property("_rowFlashBaseStyle")
                    if not isinstance(base_style, str):
                        base_style = child.styleSheet() or ""
                        child.setProperty("_rowFlashBaseStyle", base_style)
                    if not enabled:
                        child.setStyleSheet(base_style)
                        continue
                    if isinstance(child, QLineEdit):
                        child.setStyleSheet(
                            base_style
                            + f"QLineEdit {{ background:{row_bg}; border:1px solid {border}; border-radius:8px; }}"
                        )
                    elif isinstance(child, QComboBox):
                        child.setStyleSheet(
                            base_style
                            + (
                                "QComboBox {"
                                f"background:{row_bg}; border:1px solid {border}; border-radius:8px;"
                                "}"
                                "QComboBox::drop-down {"
                                f"background:{drop_bg}; border-left:1px solid {border};"
                                "}"
                                f"QComboBox::drop-down:on {{ background: {QColor(drop_bg).darker(108).name()}; }}"
                            )
                        )
                    elif isinstance(child, QTextEdit):
                        child.setStyleSheet(
                            base_style
                            + f"QTextEdit {{ background:{row_bg}; border:1px solid {border}; border-radius:8px; }}"
                        )

        for c_idx in range(table.columnCount()):
            item = table.item(row_index, c_idx)
            if item is not None:
                item.setBackground(brush)
                item.setData(Qt.ItemDataRole.BackgroundRole, brush)
            host = table.cellWidget(row_index, c_idx)
            if isinstance(host, QWidget):
                host.setObjectName("ListCellWrap")
                host.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
                host.setStyleSheet(
                    "QWidget#ListCellWrap {"
                    f"background: {row_bg};"
                    "border: none;"
                    "}"
                )
                _apply_child_flash_styles(host)
        table.viewport().update()

    def _start_focus_row_flash(self, row_id: int) -> None:
        rid = int(row_id)
        if rid <= 0:
            return

        def _on() -> None:
            self._focus_flash_row_ids = {rid}
            self._focus_flash_on = True
            self._apply_focus_row_visual(rid, True)

        def _off(final_clear: bool = False) -> None:
            self._focus_flash_on = False
            self._apply_focus_row_visual(rid, False)
            if final_clear:
                self._focus_flash_row_ids.clear()

        pulses = 5
        on_ms = 120
        off_ms = 95
        cycle_ms = on_ms + off_ms
        for i in range(pulses):
            start_ms = i * cycle_ms
            QTimer.singleShot(start_ms, _on)
            QTimer.singleShot(start_ms + on_ms, (lambda final=(i == (pulses - 1)): _off(final)))

    def focus_row_by_id(self, row_id: int) -> bool:
        rid = int(row_id)
        if rid <= 0:
            return False
        row = self._row_by_id(rid)
        # Fallback for legacy callers that may pass a 1-based positional id.
        if not isinstance(row, dict):
            pos = rid - 1
            if 0 <= pos < len(self._rows_data):
                fallback = self._rows_data[pos]
                if isinstance(fallback, dict):
                    rid = int(fallback.get("__id") or rid)
                    row = fallback
        if not isinstance(row, dict):
            return False
        target_room = self._normalize_room_name(str(row.get("room") or ""))
        if target_room and self._part_key(target_room) != "all" and self._part_key(self._active_room) != self._part_key(target_room):
            self._set_active_room(target_room)
        self._inline_edit_row_id = rid
        target_part = str(row.get("partType") or "").strip()
        target_key = self._part_key(target_part)
        if target_key in self._collapsed_part_types:
            self._collapsed_part_types.discard(target_key)
        if isinstance(self._search_input, QLineEdit) and self._search_input.text().strip():
            self._search_input.setText("")
        if isinstance(self._part_type_filter, QComboBox):
            idx = self._part_type_filter.findText("All Part Types")
            if idx >= 0:
                self._part_type_filter.setCurrentIndex(idx)
        self._refresh_filters_and_summary()
        QTimer.singleShot(0, lambda rid=rid: self._scroll_row_into_view(rid))
        QTimer.singleShot(90, lambda rid=rid: self._scroll_row_into_view(rid))
        QTimer.singleShot(190, lambda rid=rid: self._scroll_row_into_view(rid))
        QTimer.singleShot(320, lambda rid=rid: self._scroll_row_into_view(rid))
        QTimer.singleShot(460, lambda rid=rid: self._scroll_row_into_view(rid))
        self._start_focus_row_flash(rid)
        return True

    def rows_payload(self) -> list[dict]:
        rows: list[dict] = []
        for row in self._rows_data:
            payload = {}
            non_empty = False
            for _label, key in self.FIELDS:
                value = str(row.get(key) or "").strip()
                payload[key] = value
                if key != "partType" and value:
                    non_empty = True
            payload["fixedShelf"] = str(row.get("fixedShelf") or "").strip()
            payload["adjustableShelf"] = str(row.get("adjustableShelf") or "").strip()
            payload["fixedShelfDrilling"] = self._normalize_drilling_value(str(row.get("fixedShelfDrilling") or "No").strip())
            payload["adjustableShelfDrilling"] = self._normalize_drilling_value(str(row.get("adjustableShelfDrilling") or "No").strip())
            payload["room"] = self._normalize_room_name(str(row.get("room") or ""))
            if non_empty:
                rows.append(payload)
        return rows

    def closeEvent(self, event) -> None:
        self._emit_autosave()
        super().closeEvent(event)

    def _save_and_close(self) -> None:
        self._emit_autosave()
        self.accept()

    def apply_external_payload(self, payload: dict | None) -> None:
        if not isinstance(payload, dict):
            return

        rows = [dict(r) for r in (payload.get("rows") or []) if isinstance(r, dict)]
        entry_rows = [dict(r) for r in (payload.get("entryDraftRows") or []) if isinstance(r, dict)]
        collapsed = {
            self._part_key(v)
            for v in (payload.get("collapsedPartTypes") or [])
            if self._part_key(v)
        }
        rooms = [str(v or "").strip() for v in (payload.get("rooms") or []) if str(v or "").strip()]
        rooms_with_pieces = {
            self._part_key(v)
            for v in (payload.get("roomsWithPieces") or [])
            if self._part_key(v)
        }
        active_room = str(payload.get("activeRoom") or self._active_room or "All").strip() or "All"
        active_part_type = str(payload.get("activePartType") or self._active_part_type or "").strip()

        incoming_payload = {
            "rows": rows,
            "entryDraftRows": entry_rows,
            "collapsedPartTypes": sorted(collapsed),
            "rooms": rooms,
            "roomsWithPieces": sorted(rooms_with_pieces),
            "activeRoom": active_room,
            "activePartType": active_part_type,
        }
        try:
            incoming_sig = json.dumps(incoming_payload, sort_keys=True)
        except Exception:
            incoming_sig = ""
        current_sig = self._payload_signature()
        if incoming_sig and current_sig and incoming_sig == current_sig:
            return

        self._suspend_autosave = True
        try:
            self._rows_data = []
            self._row_locators = {}
            self._focus_flash_row_ids.clear()
            self._pending_delete_ids.clear()
            self._delete_all_confirm_armed = False
            self._delete_all_confirm_count = 0

            self._collapsed_part_types = set(collapsed)
            if rooms:
                self._project_rooms_seed = list(rooms)
            self._rooms_with_pieces = set(rooms_with_pieces)
            self._active_room = active_room
            self._active_part_type = active_part_type

            for row in rows:
                self._add_row(row, refresh=False)

            if not self._rooms_with_pieces:
                for row in self._rows_data:
                    room_key = self._part_key(str((row or {}).get("room") or ""))
                    if room_key and room_key != "all":
                        self._rooms_with_pieces.add(room_key)

            for row_def in list(self._entry_input_rows):
                frame = row_def.get("frame")
                if isinstance(frame, QFrame):
                    frame.setParent(None)
                    frame.deleteLater()
            self._entry_input_rows = []
            self._quick_inputs = {}

            for seed in entry_rows:
                self._add_entry_input_row(seed=seed)

            self._refresh_room_tabs()
            self._refresh_entry_part_type_tabs()
            self._refresh_entry_empty_state()
            self._refresh_filters_and_summary()
            self._last_autosave_signature = self._payload_signature()
        finally:
            self._suspend_autosave = False

    def _print_cutlist_by_part_type(self) -> None:
        rows = list(self._rows_data or [])
        if not rows:
            QMessageBox.information(self, "Print", "No cutlist rows to print.")
            return

        printer = QPrinter(QPrinter.PrinterMode.HighResolution)
        try:
            printer.setPageOrientation(QPageLayout.Orientation.Landscape)
        except Exception:
            try:
                printer.setOrientation(QPrinter.Orientation.Landscape)
            except Exception:
                pass
        preview = QPrintPreviewDialog(printer, self)
        preview.setWindowTitle("Print Preview - Cutlist")
        preview.paintRequested.connect(self._render_cutlist_document)
        preview.exec()

    def _build_cutlist_print_html(self) -> str:
        source_rows = list(self._rows_data or [])
        if not source_rows:
            return "<html><body><p>No cutlist rows to print.</p></body></html>"

        def _row_key(row: dict) -> str:
            if not isinstance(row, dict):
                return ""
            for k in ("__cutlist_key", "__id"):
                txt = str(row.get(k) or "").strip()
                if txt:
                    return txt
            return "|".join(
                [
                    str(row.get("room") or "").strip(),
                    str(row.get("partType") or "").strip(),
                    str(row.get("board") or "").strip(),
                    str(row.get("name") or "").strip(),
                    str(row.get("height") or "").strip(),
                    str(row.get("width") or "").strip(),
                    str(row.get("depth") or "").strip(),
                    str(row.get("quantity") or "").strip(),
                ]
            )

        def _board_sort_value(board_raw: str) -> str:
            display = str(self._board_display_text(board_raw) or board_raw or "").strip()
            return re.sub(r"^\s*\[[^\]]+\]\s*", "", display).strip().lower()

        def _print_information_lines(row: dict) -> list[str]:
            raw = str(row.get("information") or "")
            lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
            return lines

        def _print_information_value(row: dict) -> str:
            return "\n".join(_print_information_lines(row))

        filtered_rows: list[dict] = []
        for row in source_rows:
            if not isinstance(row, dict):
                continue
            part_txt = str(row.get("partType") or "").strip()
            board_txt = str(row.get("board") or "").strip()
            name_txt = str(row.get("name") or "").strip()
            qty_txt = str(row.get("quantity") or "").strip()
            if not part_txt or not board_txt or not name_txt or not qty_txt:
                continue
            filtered_rows.append(dict(row))
        if not filtered_rows:
            return "<html><body><p>No cutlist rows to print.</p></body></html>"

        # Build CNC-matching IDs using the same stable ordering basis used in CNC:
        # board -> part type -> part name
        cnc_sorted = sorted(
            filtered_rows,
            key=lambda r: (
                _board_sort_value(str(r.get("board") or "")),
                self._part_key(str(r.get("partType") or "")),
                str(r.get("name") or "").strip().lower(),
            ),
        )
        cnc_id_by_key: dict[str, int] = {}
        part_counter = 1
        for row in cnc_sorted:
            key = _row_key(row)
            if key:
                cnc_id_by_key[key] = part_counter
            part_counter += 1

        grouped: dict[str, list[dict]] = {}
        for row in filtered_rows:
            part = str(row.get("partType") or "").strip() or "Other"
            grouped.setdefault(part, []).append(row)

        ordered_keys: list[str] = []
        remaining = list(grouped.keys())
        for seed in (self._part_types_seed or []):
            seed_key = self._part_key(seed)
            for key in list(remaining):
                if self._part_key(key) == seed_key:
                    ordered_keys.append(key)
                    remaining.remove(key)
        ordered_keys.extend(sorted(remaining, key=lambda x: self._part_key(x)))

        project_title = html.escape(str(self._project_name or "Project"))
        sections: list[str] = []
        for part_type in ordered_keys:
            part_rows = grouped.get(part_type, [])
            if not part_rows:
                continue
            part_color = QColor(self._header_color_for_type(part_type))
            if not part_color.isValid():
                part_color = QColor("#F1DE87")
            header_bg = part_color.name()
            header_border = part_color.darker(130).name()
            header_fg = "#FFFFFF" if part_color.lightness() < 145 else "#0F172A"
            row_bg_a = part_color.lighter(188).name()
            row_bg_b = part_color.lighter(175).name()
            # Single source of truth for column sizing (percent). Sum must be 100.
            col_widths = ["3%", "6%", "16.5%", "18.5%", "4.5%", "4.5%", "4.5%", "4.5%", "4.5%", "33.5%"]
            colgroup = (
                "<colgroup>"
                + "".join(f"<col style='width:{w};'>" for w in col_widths)
                + "</colgroup>"
            )
            part_rows = sorted(part_rows, key=lambda r: cnc_id_by_key.get(_row_key(r), 10**9))
            header_labels = [
                "ID",
                "Room",
                "Board Type",
                "Part Name",
                "Height",
                "Width",
                "Depth",
                "Quantity",
                "Clashing",
                "Information",
            ]
            col_classes = [f"c{i}" for i in range(1, 11)]
            header_cells = "".join(
                (
                    f"<th "
                    f"class='{col_classes[i]}' style='background:{header_bg}; color:{header_fg};'>"
                    f"{html.escape(lbl)}</th>"
                )
                for i, lbl in enumerate(header_labels)
            )

            # Keep each part-type section fully on one printed page with current
            # font/padding so the project/section heading does not orphan.
            chunk_size = 38
            total_chunks = max(1, int(math.ceil(len(part_rows) / float(chunk_size))))
            for chunk_idx in range(total_chunks):
                start = chunk_idx * chunk_size
                end = start + chunk_size
                chunk_rows = part_rows[start:end]
                body_rows: list[str] = []
                for rr_idx, row in enumerate(chunk_rows):
                    rid = cnc_id_by_key.get(_row_key(row), "")
                    room_txt = html.escape(str(row.get("room") or ""))
                    board_txt = html.escape(str(self._board_display_text(str(row.get("board") or "")) or str(row.get("board") or "")))
                    name_txt = html.escape(str(row.get("name") or ""))
                    h_txt = html.escape(str(row.get("height") or ""))
                    w_txt = html.escape(str(row.get("width") or ""))
                    d_txt = html.escape(str(row.get("depth") or ""))
                    q_txt = html.escape(str(row.get("quantity") or ""))
                    cl_txt = html.escape(str(row.get("clashing") or ""))
                    info_txt = html.escape(_print_information_value(row)).replace("\n", "<br>")
                    row_bg = row_bg_a if (rr_idx % 2) == 0 else row_bg_b
                    body_rows.append(
                        f"<tr style='background:{row_bg};'>"
                        f"<td class='id {col_classes[0]}'>{rid}</td>"
                        f"<td class='{col_classes[1]}'>{room_txt}</td>"
                        f"<td class='{col_classes[2]}'>{board_txt}</td>"
                        f"<td class='{col_classes[3]}'>{name_txt}</td>"
                        f"<td class='num {col_classes[4]}'>{h_txt}</td>"
                        f"<td class='num {col_classes[5]}'>{w_txt}</td>"
                        f"<td class='num {col_classes[6]}'>{d_txt}</td>"
                        f"<td class='num {col_classes[7]}'>{q_txt}</td>"
                        f"<td class='num {col_classes[8]}'>{cl_txt}</td>"
                        f"<td class='{col_classes[9]}'>{info_txt}</td>"
                        "</tr>"
                    )
                page_section_title = html.escape(part_type)
                if total_chunks > 1:
                    page_section_title = f"{page_section_title} ({chunk_idx + 1}/{total_chunks})"
                sections.append(
                    "<div class='page'>"
                "<div class='topline'>"
                "<div class='lefttitle'></div>"
                "</div>"
                "<table class='cut' width='100%' style='width:100%; min-width:100%; max-width:100%;'>"
                f"{colgroup}"
                "<caption>"
                f"<div class='project'>{project_title}</div>"
                f"<div class='section'>{page_section_title}</div>"
                "</caption>"
                f"<thead><tr>{header_cells}</tr></thead>"
                f"<tbody>{''.join(body_rows)}</tbody>"
                "</table>"
                "</div>"
                )

        return (
            "<html><head><meta charset='utf-8'>"
            "<style>"
            "@page { size: A4 landscape; margin: 5mm; }"
            "html, body { width: 100%; margin: 0; padding: 0; }"
            "body { font-family: Segoe UI, Arial, sans-serif; color: #111827; font-size: 6pt; }"
            ".page { page-break-after: always; }"
            ".page:last-child { page-break-after: auto; }"
            ".page { width: 100%; box-sizing: border-box; margin: 0; }"
            ".page { page-break-inside: avoid; }"
            ".topline { display:flex; align-items:center; padding:0; margin:0; height:0; }"
            ".lefttitle { display:none; }"
            ".project { color:#111827; font-size:7pt; font-weight:700; margin:0 0 0.5mm 0; text-align:right; }"
            ".section { font-weight:800; font-size:7pt; margin:0.2mm 0 0.6mm 0; }"
            "table.cut { width:100% !important; min-width:100% !important; max-width:100% !important; border-collapse:collapse; border-spacing:0; table-layout:fixed; border:0.5px solid #000000; margin:0; }"
            "table.cut caption { caption-side: top; text-align: left; margin:0; padding:0 0 0.2mm 0; }"
            "table.cut * { box-sizing:border-box; }"
            "table.cut tr { page-break-inside: avoid; }"
            "table.cut thead th { padding:0.95mm 0.75mm; text-align:center; font-weight:800; font-size:6pt; line-height:1.25; border:none; border-top:none; border-bottom:0.5px solid #000000; }"
            "table.cut thead th + th { border-left:0.5px solid #000000; }"
            "table.cut tbody td { border:none; border-top:none; border-bottom:none; padding:0.7mm 0.75mm; vertical-align:middle; font-size:6pt; line-height:1.25; }"
            "table.cut tbody td + td { border-left:0.5px solid #000000; }"
            "table.cut th, table.cut td { overflow:hidden; text-overflow:clip; white-space:normal; overflow-wrap:anywhere; word-break:break-word; }"
            "table.cut th.c1, table.cut td.c1 { width:3%; min-width:3%; max-width:3%; }"
            "table.cut th.c2, table.cut td.c2 { width:6%; min-width:6%; max-width:6%; }"
            "table.cut th.c3, table.cut td.c3 { width:16.5%; min-width:16.5%; max-width:16.5%; }"
            "table.cut th.c4, table.cut td.c4 { width:18.5%; min-width:18.5%; max-width:18.5%; }"
            "table.cut th.c5, table.cut td.c5 { width:4.5%; min-width:4.5%; max-width:4.5%; }"
            "table.cut th.c6, table.cut td.c6 { width:4.5%; min-width:4.5%; max-width:4.5%; }"
            "table.cut th.c7, table.cut td.c7 { width:4.5%; min-width:4.5%; max-width:4.5%; }"
            "table.cut th.c8, table.cut td.c8 { width:4.5%; min-width:4.5%; max-width:4.5%; }"
            "table.cut th.c9, table.cut td.c9 { width:4.5%; min-width:4.5%; max-width:4.5%; }"
            "table.cut th.c10, table.cut td.c10 { width:33.5%; min-width:33.5%; max-width:33.5%; }"
            "table.cut td.c5, table.cut td.c6, table.cut td.c7, table.cut td.c8, table.cut td.c9 { white-space: nowrap; }"
            "table.cut tbody tr:nth-child(odd) td { background:transparent; }"
            "table.cut tbody tr:nth-child(even) td { background:transparent; }"
            "th.id, td.id { text-align:center; }"
            "table.cut th:nth-child(2), table.cut td:nth-child(2) { text-align:left; }"
            "table.cut th:nth-child(3), table.cut td:nth-child(3) { text-align:left; }"
            "table.cut th:nth-child(4), table.cut td:nth-child(4) { text-align:left; }"
            "table.cut th:nth-child(5), table.cut td:nth-child(5) { text-align:center; }"
            "table.cut th:nth-child(6), table.cut td:nth-child(6) { text-align:center; }"
            "table.cut th:nth-child(7), table.cut td:nth-child(7) { text-align:center; }"
            "table.cut th:nth-child(8), table.cut td:nth-child(8) { text-align:center; }"
            "table.cut th:nth-child(9), table.cut td:nth-child(9) { text-align:center; }"
            "table.cut th:nth-child(10), table.cut td:nth-child(10) { text-align:left; }"
            "td.num { text-align:center; }"
            "</style></head><body>"
            f"{''.join(sections)}"
            "</body></html>"
        )

    def _prepare_cutlist_print_pages(self, rows_per_page: int = 38) -> list[dict]:
        source_rows = list(self._rows_data or [])
        if not source_rows:
            return []

        def _row_key(row: dict) -> str:
            if not isinstance(row, dict):
                return ""
            for k in ("__cutlist_key", "__id"):
                txt = str(row.get(k) or "").strip()
                if txt:
                    return txt
            return "|".join(
                [
                    str(row.get("room") or "").strip(),
                    str(row.get("partType") or "").strip(),
                    str(row.get("board") or "").strip(),
                    str(row.get("name") or "").strip(),
                    str(row.get("height") or "").strip(),
                    str(row.get("width") or "").strip(),
                    str(row.get("depth") or "").strip(),
                    str(row.get("quantity") or "").strip(),
                ]
            )

        def _board_sort_value(board_raw: str) -> str:
            display = str(self._board_display_text(board_raw) or board_raw or "").strip()
            return re.sub(r"^\s*\[[^\]]+\]\s*", "", display).strip().lower()

        def _print_information_lines(row: dict) -> list[str]:
            raw = str(row.get("information") or "")
            lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
            return lines

        def _as_num(value: str) -> float | None:
            try:
                txt = str(value or "").strip()
                return float(txt) if txt else None
            except Exception:
                return None

        def _drawer_rows_for_print(row: dict) -> list[dict]:
            out: list[dict] = []
            part_txt = str(row.get("partType") or "").strip()
            if not self._is_drawer_part_type(part_txt):
                return out
            bottom_w, bottom_d, back_w = self._drawer_breakdown_values_for_row(row)
            bottom_qty = int(self._drawer_bottom_quantity_for_row(row) or 0)
            if bottom_qty > 0:
                out.append(
                    {
                        "id": "",
                        "room": "",
                        "board": "",
                        "name": "∟ Bottom",
                        "height": "",
                        "width": str(bottom_w or ""),
                        "depth": str(bottom_d or ""),
                        "quantity": str(bottom_qty),
                        "clashing": "",
                        "information": "",
                        "info_units": 1,
                        "__drawer_detail": True,
                    }
                )
            for letter, back_h, back_qty in self._drawer_back_groups_for_row(row):
                qty = int(back_qty or 0)
                if qty <= 0:
                    continue
                back_name = "Back" if not str(letter or "").strip() else f"Back ({str(letter).strip()})"
                clash_txt = ""
                w_num = _as_num(back_w)
                h_num = _as_num(back_h)
                if w_num is not None and h_num is not None and h_num > 0:
                    clash_txt = "1S" if w_num < h_num else "1L"
                out.append(
                    {
                        "id": "",
                        "room": "",
                        "board": "",
                        "name": f"∟ {back_name}",
                        "height": str(back_h or ""),
                        "width": str(back_w or ""),
                        "depth": "",
                        "quantity": str(qty),
                        "clashing": clash_txt,
                        "information": "",
                        "info_units": 1,
                        "__drawer_detail": True,
                    }
                )
            return out

        def _cabinet_shelf_rows_for_print(row: dict) -> list[dict]:
            out: list[dict] = []
            part_txt = str(row.get("partType") or "").strip()
            if not bool(self._part_type_cabinetry.get(self._part_key(part_txt), False)):
                return out
            pieces = self._cabinet_breakdown_rows_for_row(row)
            if not pieces:
                return out
            for piece in pieces:
                nm = str(piece.get("name") or "").strip()
                if nm not in {"Adjustable Shelf", "Fixed Shelf"}:
                    continue
                qty = int(piece.get("quantity") or 0)
                if qty <= 0:
                    continue
                w_txt = str(piece.get("width") or "")
                d_txt = str(piece.get("depth") or "")
                w_num = _as_num(w_txt)
                d_num = _as_num(d_txt)
                clash_txt = ""
                if w_num is not None and d_num is not None:
                    if w_num > d_num:
                        clash_txt = "1L"
                    elif w_num < d_num:
                        clash_txt = "1S"
                out.append(
                    {
                        "id": "",
                        "room": "",
                        "board": "",
                        "name": f"∟ {nm}",
                        "height": str(piece.get("height") or ""),
                        "width": w_txt,
                        "depth": d_txt,
                        "quantity": str(qty),
                        "clashing": clash_txt,
                        "information": "",
                        "info_units": 1,
                        "__cabinet_shelf_detail": True,
                    }
                )
            return out

        filtered_rows: list[dict] = []
        for row in source_rows:
            if not isinstance(row, dict):
                continue
            part_txt = str(row.get("partType") or "").strip()
            board_txt = str(row.get("board") or "").strip()
            name_txt = str(row.get("name") or "").strip()
            qty_txt = str(row.get("quantity") or "").strip()
            if not part_txt or not board_txt or not name_txt or not qty_txt:
                continue
            filtered_rows.append(dict(row))
        if not filtered_rows:
            return []

        cnc_sorted = sorted(
            filtered_rows,
            key=lambda r: (
                _board_sort_value(str(r.get("board") or "")),
                self._part_key(str(r.get("partType") or "")),
                str(r.get("name") or "").strip().lower(),
            ),
        )
        cnc_id_by_key: dict[str, int] = {}
        part_counter = 1
        for row in cnc_sorted:
            key = _row_key(row)
            if key:
                cnc_id_by_key[key] = part_counter
            part_counter += 1

        grouped: dict[str, list[dict]] = {}
        for row in filtered_rows:
            part = str(row.get("partType") or "").strip() or "Other"
            grouped.setdefault(part, []).append(row)

        ordered_keys: list[str] = []
        remaining = list(grouped.keys())
        for seed in (self._part_types_seed or []):
            seed_key = self._part_key(seed)
            for key in list(remaining):
                if self._part_key(key) == seed_key:
                    ordered_keys.append(key)
                    remaining.remove(key)
        ordered_keys.extend(sorted(remaining, key=lambda x: self._part_key(x)))

        pages: list[dict] = []
        project_title = str(self._project_name or "Project").strip() or "Project"
        for part_type in ordered_keys:
            part_rows = grouped.get(part_type, [])
            if not part_rows:
                continue
            part_color = QColor(self._header_color_for_type(part_type))
            if not part_color.isValid():
                part_color = QColor("#F1DE87")
            header_fg = "#FFFFFF" if part_color.lightness() < 145 else "#0F172A"
            # Body rows use global zebra colors (white / light grey).
            row_bg_a = "#FFFFFF"
            row_bg_b = "#D1D5DB"
            part_rows = sorted(part_rows, key=lambda r: cnc_id_by_key.get(_row_key(r), 10**9))
            max_units = max(1, int(rows_per_page))
            chunks: list[list[tuple[dict, list[str]]]] = []
            current_chunk: list[tuple[dict, list[str]]] = []
            current_units = 0
            for row in part_rows:
                info_lines = _print_information_lines(row)
                part_txt = str(row.get("partType") or "").strip()
                if self._is_drawer_part_type(part_txt):
                    detail_rows = _drawer_rows_for_print(row)
                    row_units = max(1, 1 + len(detail_rows))
                elif bool(self._part_type_cabinetry.get(self._part_key(part_txt), False)):
                    detail_rows = _cabinet_shelf_rows_for_print(row)
                    if detail_rows:
                        row_units = max(1, 1 + len(detail_rows))
                    else:
                        row_units = max(1, len(info_lines))
                else:
                    row_units = max(1, len(info_lines))
                if current_chunk and (current_units + row_units) > max_units:
                    chunks.append(current_chunk)
                    current_chunk = []
                    current_units = 0
                current_chunk.append((row, info_lines))
                current_units += row_units
            if current_chunk:
                chunks.append(current_chunk)
            total_chunks = max(1, len(chunks))
            for chunk_idx, chunk_rows in enumerate(chunks):
                rows_out: list[dict] = []
                for rr_idx, row_tuple in enumerate(chunk_rows):
                    row, info_lines = row_tuple
                    part_txt = str(row.get("partType") or "").strip()
                    drawer_detail_rows = _drawer_rows_for_print(row) if self._is_drawer_part_type(part_txt) else []
                    cabinet_shelf_rows = _cabinet_shelf_rows_for_print(row) if bool(self._part_type_cabinetry.get(self._part_key(part_txt), False)) else []
                    info_lines_local = list(info_lines or [])
                    if drawer_detail_rows or cabinet_shelf_rows:
                        # Keep main row compact; spill extra information onto sub-rows when present.
                        base_info_lines = info_lines_local[:1]
                    else:
                        base_info_lines = info_lines_local
                    base_row_out = (
                        {
                            "id": str(cnc_id_by_key.get(_row_key(row), "")),
                            "room": str(row.get("room") or ""),
                            "board": str(self._board_display_text(str(row.get("board") or "")) or str(row.get("board") or "")),
                            "name": str(row.get("name") or ""),
                            "height": str(row.get("height") or ""),
                            "width": str(row.get("width") or ""),
                            "depth": str(row.get("depth") or ""),
                            "quantity": str(row.get("quantity") or ""),
                            "clashing": str(row.get("clashing") or ""),
                            "information": "\n".join(base_info_lines),
                            "info_units": max(1, len(base_info_lines)),
                            "row_bg": row_bg_a if (rr_idx % 2) == 0 else row_bg_b,
                            "__drawer_detail": False,
                        }
                    )
                    rows_out.append(base_row_out)
                    extra_info_lines = info_lines_local[1:] if drawer_detail_rows else []
                    for d_idx, detail in enumerate(drawer_detail_rows):
                        detail_row = dict(detail)
                        # Feed extra info lines into drawer sub-rows instead of expanding the main row.
                        detail_info_line = extra_info_lines[d_idx] if d_idx < len(extra_info_lines) else ""
                        detail_row["information"] = str(detail_info_line or "")
                        detail_row["info_units"] = 1
                        detail_row["row_bg"] = str(base_row_out.get("row_bg") or row_bg_a)
                        rows_out.append(detail_row)
                    extra_info_lines_cab = info_lines_local[1:] if cabinet_shelf_rows else []
                    for c_idx, detail in enumerate(cabinet_shelf_rows):
                        detail_row = dict(detail)
                        detail_info_line = extra_info_lines_cab[c_idx] if c_idx < len(extra_info_lines_cab) else ""
                        detail_row["information"] = str(detail_info_line or "")
                        detail_row["info_units"] = 1
                        detail_row["row_bg"] = str(base_row_out.get("row_bg") or row_bg_a)
                        rows_out.append(detail_row)
                page_section_title = str(part_type or "")
                if total_chunks > 1:
                    page_section_title = f"{page_section_title} ({chunk_idx + 1}/{total_chunks})"
                pages.append(
                    {
                        "project": project_title,
                        "section": page_section_title,
                        "header_bg": part_color.name(),
                        "header_fg": header_fg,
                        "rows": rows_out,
                    }
                )
        return pages

    def _render_cutlist_document(self, printer: QPrinter) -> None:
        try:
            pages = self._prepare_cutlist_print_pages(rows_per_page=38)
            if not pages:
                return

            painter = QPainter(printer)
            if not painter.isActive():
                return
            painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)

            try:
                page_rect = printer.pageRect(QPrinter.Unit.DevicePixel)
            except Exception:
                page_rect = printer.pageRect(QPrinter.Unit.Point)
            content = QRectF(float(page_rect.left()), float(page_rect.top()), float(page_rect.width()), float(page_rect.height()))
            base_w = 1084.0
            scale = max(0.6, float(content.width()) / base_w) if base_w > 0 else 1.0

            # First 9 columns fixed; last column (Information) fills remaining width.
            fixed_col_ratios = [0.03, 0.06, 0.165, 0.185, 0.045, 0.045, 0.045, 0.045, 0.045]

            def _draw_text(rect: QRectF, txt: str, align: Qt.AlignmentFlag, bold: bool = False, color: str = "#0F172A", px: int | None = None) -> None:
                f = painter.font()
                if isinstance(px, int) and px > 0:
                    f.setPixelSize(px)
                else:
                    f.setPixelSize(max(9, int(round(10 * scale))))
                f.setBold(bool(bold))
                painter.setFont(f)
                painter.setPen(QColor(color))
                fm = painter.fontMetrics()
                elided = fm.elidedText(str(txt or ""), Qt.TextElideMode.ElideRight, max(4, int(rect.width() - 3)))
                painter.drawText(rect.adjusted(1.5, 0.0, -1.5, 0.0), int(align | Qt.AlignmentFlag.AlignVCenter), elided)

            def _draw_multiline_text(rect: QRectF, txt: str, color: str = "#0F172A", px: int | None = None, left_pad: float = 0.0) -> None:
                f = painter.font()
                if isinstance(px, int) and px > 0:
                    f.setPixelSize(px)
                else:
                    f.setPixelSize(max(9, int(round(10 * scale))))
                f.setBold(False)
                painter.setFont(f)
                painter.setPen(QColor(color))
                fm = painter.fontMetrics()
                lines = [ln.strip() for ln in str(txt or "").splitlines() if ln.strip()]
                if not lines:
                    lines = [""]
                line_h = max(1, fm.height())
                total_h = float(line_h * len(lines))
                y = float(rect.top()) + max(0.0, (float(rect.height()) - total_h) * 0.5)
                inner_w = max(4, int(rect.width() - 3.0 - left_pad))
                for ln in lines:
                    line_rect = QRectF(float(rect.left()) + 1.5 + left_pad, y, float(rect.width()) - 3.0 - left_pad, float(line_h))
                    elided = fm.elidedText(str(ln or ""), Qt.TextElideMode.ElideRight, inner_w)
                    painter.drawText(line_rect, int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter), elided)
                    y += float(line_h)

            # Title page (always first page).
            page_left = float(content.left())
            page_width = float(content.width())
            page_height = float(content.height())
            page_pad = max(14.0, page_width * 0.03)
            left = float(page_left + page_pad)
            top = float(content.top() + page_pad)
            width = max(100.0, page_width - (page_pad * 2.0))
            page_height = max(100.0, page_height - (page_pad * 2.0))
            right = left + width

            project_title_txt = str(self._project_name or "Project").strip() or "Project"
            designer_txt = str(self._print_meta.get("designer") or self._print_meta.get("createdByName") or "").strip() or "-"
            company_txt = str(
                self._company_name
                or self._print_meta.get("companyName")
                or self._print_meta.get("company")
                or ""
            ).strip() or "-"
            theme_txt = str(
                self._print_meta.get("themeColor")
                or self._print_meta.get("companyTheme")
                or self._print_meta.get("theme")
                or ""
            ).strip()
            theme_color = QColor(theme_txt) if theme_txt else QColor()
            if not theme_color.isValid():
                theme_color = QColor("#2F6BFF")
            theme_hex = theme_color.name()

            top_h = max(22.0, 22.0 * scale)
            gap_after_title = max(10.0, 10.0 * scale)
            div_h = 2.0
            gap_after_div = max(12.0, 12.0 * scale)
            row_h = max(24.0, 24.0 * scale)
            label_w = max(160.0, 180.0 * scale)
            row_gap = max(6.0, 6.0 * scale)
            block_h = top_h + gap_after_title + div_h + gap_after_div + row_h + row_gap + row_h
            y0 = top + max(0.0, page_height * 0.25)
            if (y0 + block_h) > (top + page_height):
                y0 = max(top, (top + page_height) - block_h)

            _draw_text(
                QRectF(left, y0, width, top_h),
                "PROJECT CUTLIST",
                Qt.AlignmentFlag.AlignLeft,
                bold=True,
                color=theme_hex,
                px=max(24, int(round(26 * scale))),
            )
            _draw_text(
                QRectF(left, y0, width, top_h),
                company_txt,
                Qt.AlignmentFlag.AlignRight,
                bold=True,
                color=theme_hex,
                px=max(24, int(round(26 * scale))),
            )

            div_y = y0 + top_h + gap_after_title
            title_div_y = float(int(round(div_y)))
            title_div_pen = QPen(QColor("#000000"))
            title_div_pen.setWidth(max(1, int(round(1.0 * scale))))
            title_div_pen.setCapStyle(Qt.PenCapStyle.FlatCap)
            painter.setPen(title_div_pen)
            painter.drawLine(QPointF(left, title_div_y), QPointF(max(left, right - 1.0), title_div_y))

            row1_y = div_y + div_h + gap_after_div
            row2_y = row1_y + row_h + row_gap
            _draw_text(
                QRectF(left, row1_y, label_w, row_h),
                "Project Name",
                Qt.AlignmentFlag.AlignLeft,
                bold=True,
                color="#0F172A",
                px=max(13, int(round(13 * scale))),
            )
            _draw_text(
                QRectF(left + label_w, row1_y, width - label_w, row_h),
                project_title_txt,
                Qt.AlignmentFlag.AlignLeft,
                bold=False,
                color="#0F172A",
                px=max(13, int(round(13 * scale))),
            )
            # Mid divider between project/designer rows (content width only).
            div_mid_y = row1_y + row_h + (row_gap * 0.5)
            mid_div_pen = QPen(QColor("#000000"))
            mid_div_pen.setWidth(max(1, int(round(1.0 * scale))))
            mid_div_pen.setCapStyle(Qt.PenCapStyle.FlatCap)
            painter.setPen(mid_div_pen)
            line_start_x = left
            measure_font = QFont(painter.font())
            measure_font.setBold(False)
            measure_font.setPixelSize(max(13, int(round(13 * scale))))
            fm = QFontMetrics(measure_font)
            row1_txt_w = float(fm.horizontalAdvance(str(project_title_txt or "")))
            row2_txt_w = float(fm.horizontalAdvance(str(designer_txt or "")))
            longest_value_w = max(row1_txt_w, row2_txt_w)
            # include a tiny trailing pad so the line clears the final character
            line_end_x = left + min(width, label_w + longest_value_w + max(8.0, 8.0 * scale))
            if line_end_x > line_start_x:
                painter.drawLine(QPointF(line_start_x, div_mid_y), QPointF(line_end_x, div_mid_y))
            _draw_text(
                QRectF(left, row2_y, label_w, row_h),
                "Designer Name",
                Qt.AlignmentFlag.AlignLeft,
                bold=True,
                color="#0F172A",
                px=max(13, int(round(13 * scale))),
            )
            _draw_text(
                QRectF(left + label_w, row2_y, width - label_w, row_h),
                designer_txt,
                Qt.AlignmentFlag.AlignLeft,
                bold=False,
                color="#0F172A",
                px=max(13, int(round(13 * scale))),
            )

            for page_idx, page in enumerate(pages):
                printer.newPage()

                page_left = float(content.left())
                page_width = float(content.width())
                page_pad = max(14.0, page_width * 0.03)
                left = float(page_left + page_pad)
                top = float(content.top() + page_pad)
                height = max(100.0, float(content.height()) - (page_pad * 2.0))
                width = max(100.0, page_width - (page_pad * 2.0))

                # Per-part-type page heading:
                # PROJECT CUTLIST                 <company name>
                # <divider row>
                # <Part Type>                    <project name>
                top_line_h = max(13.0, 13.0 * scale)
                divider_h = 2.0
                sub_line_h = max(13.0, 13.0 * scale)
                gap_h = max(10.0, 12.0 * scale)
                top_line_y = top
                divider_y = top_line_y + top_line_h + max(4.0, 4.0 * scale)
                sub_line_y = divider_y + divider_h + max(4.0, 4.0 * scale)
                table_top = sub_line_y + sub_line_h + gap_h

                _draw_text(
                    QRectF(left, top_line_y, width, top_line_h),
                    "PROJECT CUTLIST",
                    Qt.AlignmentFlag.AlignLeft,
                    bold=True,
                    color=theme_hex,
                    px=max(12, int(round(13 * scale))),
                )
                _draw_text(
                    QRectF(left, top_line_y, width, top_line_h),
                    company_txt,
                    Qt.AlignmentFlag.AlignRight,
                    bold=True,
                    color=theme_hex,
                    px=max(12, int(round(13 * scale))),
                )
                # Black divider under "PROJECT CUTLIST ... <company name>" (part-type pages only).
                hdr_div_y = float(int(round(divider_y)))
                hdr_div_pen = QPen(QColor("#000000"))
                hdr_div_pen.setWidth(max(1, int(round(1.0 * scale))))
                hdr_div_pen.setCapStyle(Qt.PenCapStyle.FlatCap)
                painter.setPen(hdr_div_pen)
                painter.drawLine(QPointF(left, hdr_div_y), QPointF(max(left, right - 1.0), hdr_div_y))
                _draw_text(
                    QRectF(left, sub_line_y, width, sub_line_h),
                    str(page.get("section") or ""),
                    Qt.AlignmentFlag.AlignLeft,
                    bold=True,
                    color="#0F172A",
                    px=max(11, int(round(12 * scale))),
                )
                _draw_text(
                    QRectF(left, sub_line_y, width, sub_line_h),
                    project_title_txt,
                    Qt.AlignmentFlag.AlignRight,
                    bold=True,
                    color="#0F172A",
                    px=max(11, int(round(12 * scale))),
                )

                rows = list(page.get("rows") or [])
                header_h = max(22.0, 22.0 * scale)
                base_row_h = max(16.0, 16.0 * scale)
                row_heights: list[float] = []
                for row in rows:
                    units = max(1, int(row.get("info_units") or 1))
                    row_heights.append(max(base_row_h, base_row_h * float(units)))
                table_h = header_h + float(sum(row_heights))
                max_table_h = max(40.0, height - (table_top - top) - 2.0)
                table_h = min(table_h, max_table_h)
                table_rect = QRectF(left, table_top, width, table_h)

                # Column boundaries
                col_widths: list[float] = []
                used_w = 0.0
                for r in fixed_col_ratios:
                    cw = max(1.0, width * float(r))
                    used_w += cw
                    col_widths.append(cw)
                # Information column dynamically consumes the remaining space.
                col_widths.append(max(1.0, width - used_w))
                x_positions = [left]
                for cw in col_widths:
                    x_positions.append(x_positions[-1] + cw)
                x_positions[-1] = left + width

                # Row fills first
                header_rect = QRectF(left, table_top, width, header_h)
                painter.fillRect(header_rect, QColor(str(page.get("header_bg") or "#F1DE87")))
                row_y_positions: list[float] = []
                y_cursor = table_top + header_h
                for rr, row in enumerate(rows):
                    row_h = row_heights[rr] if rr < len(row_heights) else base_row_h
                    row_y_positions.append(y_cursor)
                    row_bg = QColor(str(row.get("row_bg") or ("#FFFFFF" if (rr % 2) == 0 else "#F3F4F6")))
                    painter.fillRect(QRectF(left, y_cursor, width, row_h), row_bg)
                    y_cursor += row_h

                # Grid/borders (single stroke)
                pen = QPen(QColor("#000000"))
                pen.setWidthF(max(0.75, 0.75 * scale))
                painter.setPen(pen)
                # Draw borders slightly inset so stroke stays fully inside bounds.
                border_inset = max(0.5, pen.widthF() * 0.5)
                border_rect = table_rect.adjusted(border_inset, border_inset, -border_inset, -border_inset)
                painter.drawRect(border_rect)
                painter.drawLine(
                    QPointF(border_rect.left(), table_top + header_h),
                    QPointF(border_rect.right(), table_top + header_h),
                )
                for x in x_positions[1:-1]:
                    painter.drawLine(QPointF(x, border_rect.top()), QPointF(x, border_rect.bottom()))

                # Header text
                headers = ["ID", "Room", "Board Type", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information"]
                body_alignments = [
                    Qt.AlignmentFlag.AlignCenter,
                    Qt.AlignmentFlag.AlignLeft,
                    Qt.AlignmentFlag.AlignLeft,
                    Qt.AlignmentFlag.AlignLeft,
                    Qt.AlignmentFlag.AlignCenter,
                    Qt.AlignmentFlag.AlignCenter,
                    Qt.AlignmentFlag.AlignCenter,
                    Qt.AlignmentFlag.AlignCenter,
                    Qt.AlignmentFlag.AlignCenter,
                    Qt.AlignmentFlag.AlignLeft,
                ]
                header_alignments = [Qt.AlignmentFlag.AlignCenter] * 10
                for c in range(10):
                    rect = QRectF(x_positions[c], table_top, x_positions[c + 1] - x_positions[c], header_h)
                    _draw_text(
                        rect,
                        headers[c],
                        header_alignments[c],
                        bold=True,
                        color=str(page.get("header_fg") or "#0F172A"),
                        px=max(9, int(round(9 * scale))),
                    )

                # Body text
                row_keys = ["id", "room", "board", "name", "height", "width", "depth", "quantity", "clashing", "information"]
                for rr, row in enumerate(rows):
                    y = row_y_positions[rr] if rr < len(row_y_positions) else (table_top + header_h)
                    row_h = row_heights[rr] if rr < len(row_heights) else base_row_h
                    for c, key in enumerate(row_keys):
                        rect = QRectF(x_positions[c], y, x_positions[c + 1] - x_positions[c], row_h)
                        body_rect = rect.adjusted(3.0, 0.0, 0.0, 0.0)
                        if key in {"board", "name"}:
                            body_rect = body_rect.adjusted(10.0, 0.0, 0.0, 0.0)
                        elif key in {"room", "information"}:
                            body_rect = body_rect.adjusted(13.0, 0.0, 0.0, 0.0)
                        if key == "name" and bool(row.get("__drawer_detail") or row.get("__cabinet_shelf_detail")):
                            body_rect = body_rect.adjusted(40.0, 0.0, 0.0, 0.0)
                        if key == "information":
                            _draw_multiline_text(
                                body_rect,
                                str(row.get(key) or ""),
                                color="#0F172A",
                                px=max(9, int(round(9 * scale))),
                                left_pad=0.0,
                            )
                        else:
                            _draw_text(
                                body_rect,
                                str(row.get(key) or ""),
                                body_alignments[c],
                                bold=False,
                                color="#0F172A",
                                px=max(9, int(round(9 * scale))),
                            )

            painter.end()
        except Exception as exc:
            QMessageBox.critical(self, "Print failed", str(exc))

