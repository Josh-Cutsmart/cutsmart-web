from __future__ import annotations

import math
import re
from pathlib import Path
import html

from PySide6.QtCore import Qt, QTimer, QPointF, QRectF, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen, QPixmap
from PySide6.QtPrintSupport import QPrinter, QPrintPreviewDialog
from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)
class _NestingCanvas(QWidget):
    def __init__(self, owner: "NestingLayoutDialog", parent: QWidget | None = None):
        super().__init__(parent)
        self._owner = owner
        self.setMouseTracking(True)
        self.setStyleSheet("background: #FFFFFF;")

    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        self._owner._paint_layout(painter, self.width(), self.height())

    def mouseMoveEvent(self, event) -> None:
        super().mouseMoveEvent(event)
        self._owner._on_canvas_hover(event.position().x(), event.position().y())

    def leaveEvent(self, event) -> None:
        super().leaveEvent(event)
        self._owner._clear_canvas_hover()

    def mousePressEvent(self, event) -> None:
        super().mousePressEvent(event)
        if event.button() == Qt.MouseButton.LeftButton:
            self._owner._on_canvas_click(event.position().x(), event.position().y())


class _NestingSheetPreviewWidget(QWidget):
    editRequested = Signal(int)

    def __init__(
        self,
        sheet: dict,
        sheet_w: float,
        sheet_h: float,
        color_lookup: callable,
        label_formatter: callable | None = None,
        has_grain: bool = False,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._sheet = dict(sheet or {})
        self._sheet_w = max(100.0, float(sheet_w or 1220.0))
        self._sheet_h = max(100.0, float(sheet_h or 2440.0))
        self._color_lookup = color_lookup
        self._label_formatter = label_formatter
        self._has_grain = bool(has_grain)
        self._edit_targets: list[dict[str, object]] = []
        self.setMinimumSize(560, 360)
        self.setStyleSheet("background: #F3F4F6;")
        self.setMouseTracking(True)

    def _draw_grain_arrows(self, painter: QPainter, rect: QRectF, horizontal: bool) -> None:
        painter.save()
        painter.setPen(QPen(QColor(90, 100, 115, 115), 1))
        f = painter.font()
        f.setPointSize(max(11, int(f.pointSize() or 10) + 1))
        f.setBold(True)
        painter.setFont(f)
        x_gap = 82.0
        y_gap = 34.0
        if horizontal:
            row = 0
            y = rect.top() + 14.0
            while y <= rect.bottom() - 8.0:
                offset = 0.0 if row % 2 == 0 else x_gap * 0.5
                x = rect.left() + 8.0 + offset
                while x <= rect.right() - 8.0:
                    painter.drawText(QPointF(x, y), ">")
                    x += x_gap
                y += y_gap
                row += 1
        else:
            col = 0
            x = rect.left() + 12.0
            while x <= rect.right() - 8.0:
                offset = 0.0 if col % 2 == 0 else y_gap * 0.5
                y = rect.top() + 12.0 + offset
                while y <= rect.bottom() - 8.0:
                    painter.drawText(QPointF(x, y), ">")
                    y += y_gap
                x += x_gap
                col += 1
        painter.restore()

    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.fillRect(self.rect(), QColor("#F3F4F6"))
        self._edit_targets = []

        pad = 24.0
        usable_w = max(100.0, float(self.width()) - pad * 2.0)
        usable_h = max(100.0, float(self.height()) - pad * 2.0)
        visual_w = self._sheet_h
        visual_h = self._sheet_w
        scale = max(0.08, min(usable_w / max(1.0, visual_w), usable_h / max(1.0, visual_h)))
        draw_w = visual_w * scale
        draw_h = visual_h * scale
        ox = (float(self.width()) - draw_w) / 2.0
        oy = (float(self.height()) - draw_h) / 2.0

        painter.setPen(QPen(QColor("#CCD3E0"), 2))
        painter.setBrush(QColor("#FFFFFF"))
        painter.drawRect(QRectF(ox, oy, draw_w, draw_h))

        for part in (self._sheet.get("parts") or []):
            x = float(part.get("x") or 0.0)
            y = float(part.get("y") or 0.0)
            dw = float(part.get("drawWidth") or 0.0)
            dh = float(part.get("drawHeight") or 0.0)
            if dw <= 0 or dh <= 0:
                continue
            vx = y
            vy = self._sheet_w - (x + dw)
            vw = dh
            vh = dw
            px = ox + vx * scale
            py = oy + vy * scale
            pw = vw * scale
            ph = vh * scale
            fill, txt = self._color_lookup(str(part.get("partType") or ""))
            border = QColor(fill).darker(118)
            painter.setPen(QPen(border, 1))
            painter.setBrush(QColor(fill))
            painter.drawRect(QRectF(px, py, pw, ph))
            if pw > 70 and ph > 24:
                painter.setPen(QPen(QColor(txt), 1))
                part_name = str(part.get("partName") or "Part")
                if callable(self._label_formatter):
                    try:
                        part_name = str(self._label_formatter(part_name, str(part.get("partType") or "")) or part_name)
                    except Exception:
                        part_name = str(part.get("partName") or "Part")
                h_val = int(round(float(part.get("height") or 0.0)))
                w_val = int(round(float(part.get("width") or 0.0)))
                label = f"{part_name}\n{h_val} x {w_val}" if h_val > 0 and w_val > 0 else part_name
                painter.drawText(QRectF(px + 3, py + 3, pw - 6, ph - 6), int(Qt.AlignmentFlag.AlignCenter | Qt.TextFlag.TextWordWrap), label)
            source_row_id = int(part.get("sourceRowId") or -1)
            if source_row_id > 0 and pw > 62 and ph > 22:
                pill_w = 44.0
                pill_h = 18.0
                pill_rect = QRectF(px + pw - pill_w - 4.0, py + 4.0, pill_w, pill_h)
                painter.setPen(QPen(QColor("#D8DEE8"), 1))
                painter.setBrush(QColor("#EEF1F5"))
                painter.drawRoundedRect(pill_rect, 9, 9)
                painter.setPen(QPen(QColor("#5B6472"), 1))
                painter.drawText(pill_rect, int(Qt.AlignmentFlag.AlignCenter), "Edit")
                self._edit_targets.append({"rect": QRectF(pill_rect), "row_id": source_row_id})
        if self._has_grain:
            grain_horizontal = self._sheet_h >= self._sheet_w
            self._draw_grain_arrows(painter, QRectF(ox + 3, oy + 3, draw_w - 6, draw_h - 6), grain_horizontal)

    def mouseMoveEvent(self, event) -> None:
        pos = QPointF(float(event.position().x()), float(event.position().y()))
        hover_edit = any(isinstance(t.get("rect"), QRectF) and t["rect"].contains(pos) for t in self._edit_targets)
        self.setCursor(Qt.CursorShape.PointingHandCursor if hover_edit else Qt.CursorShape.ArrowCursor)
        super().mouseMoveEvent(event)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            pos = QPointF(float(event.position().x()), float(event.position().y()))
            for target in reversed(self._edit_targets):
                rect = target.get("rect")
                row_id = int(target.get("row_id") or -1)
                if isinstance(rect, QRectF) and row_id > 0 and rect.contains(pos):
                    self.editRequested.emit(row_id)
                    event.accept()
                    return
        super().mousePressEvent(event)


class NestingLayoutDialog(QDialog):
    def __init__(
        self,
        project_name: str,
        rows: list[dict] | None = None,
        source_rows: list[dict] | None = None,
        visibility_map: dict[str, bool] | None = None,
        on_visibility_changed=None,
        collapsed_part_types: list[str] | None = None,
        on_collapsed_changed=None,
        settings: dict | None = None,
        board_sheet_sizes: dict[str, str] | None = None,
        board_display_map: dict[str, str] | None = None,
        board_grain_map: dict[str, bool] | None = None,
        part_type_colors: dict[str, str] | None = None,
        cabinetry_part_types: dict[str, bool] | None = None,
        on_edit_part=None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle("Nesting Layout")
        self.setModal(False)
        self.setWindowModality(Qt.WindowModality.NonModal)
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, False)
        self.setWindowFlag(Qt.WindowType.WindowMaximizeButtonHint, True)
        self.setWindowFlag(Qt.WindowType.WindowMinimizeButtonHint, True)
        self.resize(1240, 860)
        self.setMinimumSize(980, 680)
        self.setWindowState(self.windowState() | Qt.WindowState.WindowMaximized)
        QTimer.singleShot(0, self.showMaximized)

        self._project_name = str(project_name or "Project")
        self._rows = list(rows or [])
        self._source_rows = list(source_rows or [])
        self._visibility_map = {str(k or "").strip(): bool(v) for k, v in (visibility_map or {}).items()}
        self._on_visibility_changed = on_visibility_changed
        self._on_collapsed_changed = on_collapsed_changed
        self._collapsed_part_types: set[str] = set(
            self._part_key(v) for v in (collapsed_part_types or []) if str(v or "").strip()
        )
        self._settings = dict(settings or {})
        self._board_sheet_sizes = dict(board_sheet_sizes or {})
        self._board_display_map = {str(k).strip(): str(v).strip() for k, v in (board_display_map or {}).items() if str(k).strip()}
        self._board_grain_map = {str(k).strip(): bool(v) for k, v in (board_grain_map or {}).items() if str(k).strip()}
        self._on_edit_part = on_edit_part
        self._part_type_colors = {}
        for k, v in (part_type_colors or {}).items():
            key = str(k or "").strip()
            if not key:
                continue
            color = self._normalize_hex(str(v or "").strip(), "#E7EAF0")
            self._part_type_colors[key] = color
            self._part_type_colors[key.lower()] = color
        self._cabinetry_part_types = {
            self._part_key(str(k)): bool(v)
            for k, v in (cabinetry_part_types or {}).items()
            if str(k or "").strip()
        }

        self._section_draw_data: list[dict] = []
        self._sheet_click_targets: list[dict] = []
        self._part_hover_targets: list[dict] = []
        self._hover_text = ""
        self._hover_pos = QPointF(0.0, 0.0)
        self._hover_sheet_index = -1
        self._content_h = 520
        self._skipped_parts_count = 0
        self._invalid_parts_count = 0
        self._skipped_counter: dict[str, int] = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(14, 12, 14, 12)
        root.setSpacing(10)

        header = QFrame()
        header.setObjectName("nestingTopBar")
        header.setStyleSheet("QFrame#nestingTopBar { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:14px; }")
        header.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        header.setMinimumHeight(50)
        header.setMaximumHeight(54)
        hbox = QHBoxLayout(header)
        hbox.setContentsMargins(14, 8, 14, 8)
        hbox.setSpacing(6)
        nesting_icon = QLabel()
        nesting_icon.setStyleSheet("QLabel { background:transparent; border:none; }")
        icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "nest.png"
        icon_pix = QPixmap(str(icon_path)) if icon_path.exists() else QPixmap()
        if not icon_pix.isNull():
            nesting_icon.setPixmap(icon_pix.scaled(18, 18, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        nesting_icon.setFixedSize(20, 20)
        hbox.addWidget(nesting_icon, 0, Qt.AlignmentFlag.AlignVCenter)
        title = QLabel("NESTING")
        title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        hbox.addWidget(title, 0, Qt.AlignmentFlag.AlignVCenter)
        title_div = QLabel("  |  ")
        title_div.setStyleSheet("QLabel { color:#64748B; font-size:13px; font-weight:700; background:transparent; border:none; }")
        hbox.addWidget(title_div, 0, Qt.AlignmentFlag.AlignVCenter)
        job_name = QLabel(str(self._project_name or "-"))
        job_name.setStyleSheet("QLabel { color:#334155; font-size:13px; font-weight:700; background:transparent; border:none; }")
        hbox.addWidget(job_name, 1, Qt.AlignmentFlag.AlignVCenter)
        self._summary = QLabel("Sheets: -")
        self._summary.setTextFormat(Qt.TextFormat.RichText)
        self._summary.setStyleSheet("QLabel { color:#334155; font-size:12px; font-weight:700; background:transparent; border:none; }")
        self._summary.hide()
        self._show_skipped_btn = QPushButton("Skipped (0)")
        self._show_skipped_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._show_skipped_btn.setStyleSheet(
            "QPushButton { background: #FFF7ED; color: #9A3412; border: 1px solid #FED7AA; border-radius: 10px; padding: 8px 16px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #FFEDD5; }"
        )
        self._show_skipped_btn.clicked.connect(self._show_skipped_details)
        self._show_skipped_btn.setVisible(False)
        self._print_btn = QPushButton("Print")
        self._print_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._print_btn.setStyleSheet(
            "QPushButton { background:#FFFFFF; color:#0F172A; border:1px solid #D4DAE6; border-radius:10px; padding:7px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F8FAFC; border-color:#B9C4D8; }"
            "QPushButton:pressed { background:#EEF2F7; }"
        )
        self._print_btn.clicked.connect(self._open_print_preview)
        hbox.addWidget(self._print_btn, 0, Qt.AlignmentFlag.AlignVCenter)
        hbox.addWidget(self._show_skipped_btn, 0)
        root.addWidget(header, 0)

        card = QFrame()
        card.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 12px; }")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(10, 10, 10, 10)
        card_layout.setSpacing(8)
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(False)
        self._scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        self._canvas = _NestingCanvas(self)
        self._canvas.resize(1040, 620)
        self._scroll.setWidget(self._canvas)
        card_layout.addWidget(self._scroll)

        vis_card = QFrame()
        vis_card.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:10px; }")
        vis_l = QVBoxLayout(vis_card)
        vis_l.setContentsMargins(10, 10, 10, 10)
        vis_l.setSpacing(8)
        vis_head = QWidget()
        vis_head_l = QHBoxLayout(vis_head)
        vis_head_l.setContentsMargins(0, 0, 0, 0)
        vis_head_l.setSpacing(8)
        vis_title = QLabel("Edit Visibility")
        vis_title.setStyleSheet("QLabel { color:#111827; font-size:13px; font-weight:800; background:transparent; border:none; }")
        vis_head_l.addWidget(vis_title, 1, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self._show_all_btn = QPushButton("Show All")
        self._show_all_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._show_all_btn.setStyleSheet(
            "QPushButton { background:#FFFFFF; color:#0F172A; border:1px solid #D4DAE6; border-radius:8px; padding:4px 10px; font-size:11px; font-weight:700; }"
            "QPushButton:hover { background:#F8FAFC; border-color:#B9C4D8; }"
            "QPushButton:pressed { background:#EEF2F7; }"
        )
        self._show_all_btn.clicked.connect(self._show_all_visibility_rows)
        vis_head_l.addWidget(self._show_all_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        vis_l.addWidget(vis_head)
        self._visibility_search = QLineEdit()
        self._visibility_search.setPlaceholderText("Search pieces...")
        self._visibility_search.setStyleSheet(
            "QLineEdit { background:#FFFFFF; border:1px solid #D4DAE6; border-radius:8px; padding:6px 8px; font-size:12px; color:#111827; }"
            "QLineEdit:focus { border:1px solid #9FB6DA; }"
        )
        self._visibility_search.textChanged.connect(self._apply_visibility_search)
        vis_l.addWidget(self._visibility_search)
        self._visibility_scroll = QScrollArea()
        self._visibility_scroll.setWidgetResizable(True)
        self._visibility_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._visibility_scroll.setStyleSheet("QScrollArea { background: #FFFFFF; border: none; }")
        self._visibility_host = QWidget()
        self._visibility_host.setStyleSheet("QWidget { background:#FFFFFF; border:none; }")
        self._visibility_host_l = QVBoxLayout(self._visibility_host)
        self._visibility_host_l.setContentsMargins(0, 0, 0, 0)
        self._visibility_host_l.setSpacing(6)
        self._visibility_scroll.setWidget(self._visibility_host)
        vis_l.addWidget(self._visibility_scroll, 1)
        vis_card.setFixedWidth(340)

        body_row = QHBoxLayout()
        body_row.setContentsMargins(0, 0, 0, 0)
        body_row.setSpacing(10)
        body_row.addWidget(card, 1)
        body_row.addWidget(vis_card, 0)
        root.addLayout(body_row, 1)

        self._build_visibility_panel()
        self._render_layout()

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        QTimer.singleShot(0, self._render_layout)

    def _safe_float(self, value: object, default: float = 0.0) -> float:
        txt = str(value or "").strip().lower().replace("mm", "").replace(",", ".")
        if not txt:
            return float(default)
        m = re.search(r"-?\d+(?:\.\d+)?", txt)
        if not m:
            return float(default)
        try:
            return float(m.group(0))
        except Exception:
            return float(default)

    def _safe_int(self, value: object, default: int = 0) -> int:
        try:
            return int(round(self._safe_float(value, float(default))))
        except Exception:
            return int(default)

    def _row_get(self, row: dict, *keys: str) -> object:
        for key in keys:
            if key in row:
                return row.get(key)
        lower_map = {str(k).strip().lower(): v for k, v in row.items()}
        for key in keys:
            lk = str(key).strip().lower()
            if lk in lower_map:
                return lower_map.get(lk)
        return None

    @staticmethod
    def _part_key(value: object) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _lighten_color(self, hex_color: str, ratio: float = 0.78) -> str:
        base = QColor(str(hex_color or "#E8EEF7"))
        if not base.isValid():
            base = QColor("#E8EEF7")
        r = max(0.0, min(1.0, float(ratio)))
        rr = int(base.red() + (255 - base.red()) * r)
        gg = int(base.green() + (255 - base.green()) * r)
        bb = int(base.blue() + (255 - base.blue()) * r)
        return f"#{rr:02X}{gg:02X}{bb:02X}"

    def _row_visibility_key(self, row: dict, fallback_idx: int = -1) -> str:
        raw = self._row_get(row, "__cutlist_key")
        txt = str(raw or "").strip()
        if txt:
            return txt
        rid = self._safe_int(self._row_get(row, "__id"), -1)
        if rid > 0:
            return str(rid)
        return str(max(0, int(fallback_idx)))

    def _is_row_visible(self, row: dict, fallback_idx: int = -1) -> bool:
        key = self._row_visibility_key(row, fallback_idx)
        if key:
            return bool(self._visibility_map.get(key, True))
        return True

    def _set_row_visibility(self, key: str, checked: bool) -> None:
        k = str(key or "").strip()
        if not k:
            return
        self._visibility_map[k] = bool(checked)
        if callable(self._on_visibility_changed):
            try:
                self._on_visibility_changed(dict(self._visibility_map))
            except Exception:
                pass
        self._render_layout()
        self._refresh_group_header_checks()

    def _show_all_visibility_rows(self) -> None:
        changed = False
        for idx, row in enumerate(self._source_rows):
            if not isinstance(row, dict):
                continue
            key = self._row_visibility_key(row, idx)
            if not key:
                continue
            if not bool(self._visibility_map.get(key, True)):
                self._visibility_map[key] = True
                changed = True
        if changed and callable(self._on_visibility_changed):
            try:
                self._on_visibility_changed(dict(self._visibility_map))
            except Exception:
                pass
        self._render_layout()
        self._build_visibility_panel()

    def _set_part_type_visibility(self, part_type_key: str, checked: bool) -> None:
        group_key = self._part_key(part_type_key)
        changed = False
        for idx, row in enumerate(self._source_rows):
            if not isinstance(row, dict):
                continue
            row_group = self._part_key(self._row_get(row, "partType", "part_type", "type") or "Unassigned")
            if row_group != group_key:
                continue
            key = self._row_visibility_key(row, idx)
            if key and bool(self._visibility_map.get(key, True)) != bool(checked):
                self._visibility_map[key] = bool(checked)
                changed = True
        for _w, _blob, gk, row_cb in (getattr(self, "_visibility_row_widgets", None) or []):
            if self._part_key(gk) != group_key:
                continue
            row_cb.blockSignals(True)
            row_cb.setChecked(bool(checked))
            row_cb.blockSignals(False)
        if changed and callable(self._on_visibility_changed):
            try:
                self._on_visibility_changed(dict(self._visibility_map))
            except Exception:
                pass
        self._render_layout()
        self._refresh_group_header_checks()

    def _toggle_part_type_collapsed(self, group_key: str, button: QPushButton) -> None:
        key = self._part_key(group_key)
        if not key:
            return
        if key in self._collapsed_part_types:
            self._collapsed_part_types.discard(key)
        else:
            self._collapsed_part_types.add(key)
        if isinstance(button, QPushButton):
            button.setText("+" if key in self._collapsed_part_types else "-")
        if callable(self._on_collapsed_changed):
            try:
                self._on_collapsed_changed(sorted(self._collapsed_part_types))
            except Exception:
                pass
        self._apply_visibility_search()

    def _refresh_group_header_checks(self) -> None:
        for _group_widget, group_name, cb, _collapse_btn, _group_key in (getattr(self, "_visibility_group_widgets", None) or []):
            gk = self._part_key(group_name)
            states: list[bool] = []
            for idx, row in enumerate(self._source_rows):
                if not isinstance(row, dict):
                    continue
                row_group = self._part_key(self._row_get(row, "partType", "part_type", "type") or "Unassigned")
                if row_group != gk:
                    continue
                key = self._row_visibility_key(row, idx)
                if key:
                    states.append(bool(self._visibility_map.get(key, True)))
            cb.blockSignals(True)
            cb.setChecked(bool(states) and all(states))
            cb.blockSignals(False)

    def _clear_layout(self, layout: QVBoxLayout) -> None:
        while layout.count():
            item = layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()

    def _build_visibility_panel(self) -> None:
        if not isinstance(getattr(self, "_visibility_host_l", None), QVBoxLayout):
            return
        self._clear_layout(self._visibility_host_l)
        self._visibility_group_widgets: list[tuple[QWidget, str, QCheckBox, QPushButton, str]] = []
        self._visibility_row_widgets: list[tuple[QWidget, str, str, QCheckBox]] = []
        grouped: dict[str, list[dict]] = {}
        for idx, row in enumerate(self._source_rows):
            if not isinstance(row, dict):
                continue
            ptype = str(self._row_get(row, "partType", "part_type", "type") or "Unassigned").strip() or "Unassigned"
            item = dict(row)
            item["__vis_key"] = self._row_visibility_key(item, idx)
            grouped.setdefault(ptype, []).append(item)
        for ptype in sorted(grouped.keys(), key=lambda x: x.lower()):
            pkey = self._part_key(ptype)
            raw_color = (
                self._part_type_colors.get(ptype)
                or self._part_type_colors.get(ptype.lower())
                or self._part_type_colors.get(pkey)
                or "#7D99B3"
            )
            header_bg = QColor(self._normalize_hex(str(raw_color or ""), "#7D99B3"))
            header_fg = "#FFFFFF" if self._contrast_text(header_bg.name()) == "#FFFFFF" else "#0F172A"
            row_bg_hex = self._lighten_color(header_bg.name(), 0.68)
            row_border_hex = self._lighten_color(header_bg.name(), 0.52)

            head_row = QWidget()
            head_l = QHBoxLayout(head_row)
            head_l.setContentsMargins(8, 4, 8, 4)
            head_l.setSpacing(8)
            head_cb = QCheckBox()
            head_cb.setChecked(all(bool(self._visibility_map.get(str(r.get("__vis_key") or "").strip(), True)) for r in grouped.get(ptype, [])))
            head_cb.toggled.connect(lambda checked, key=pkey: self._set_part_type_visibility(key, checked))
            head_txt = QLabel(ptype)
            head_txt.setStyleSheet(f"QLabel {{ color:{header_fg}; font-size:11px; font-weight:800; background:transparent; border:none; }}")
            head_l.addWidget(head_cb, 0, Qt.AlignmentFlag.AlignVCenter)
            head_l.addWidget(head_txt, 1, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            collapse_btn = QPushButton("+" if pkey in self._collapsed_part_types else "-")
            collapse_btn.setFixedSize(20, 20)
            collapse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            collapse_btn.setStyleSheet(
                "QPushButton { background:#FFFFFF; color:#334155; border:1px solid #C8D2E0; border-radius:6px; font-size:12px; font-weight:800; padding:0; }"
                "QPushButton:hover { background:#F8FAFC; border-color:#B8C3D4; }"
            )
            collapse_btn.clicked.connect(lambda _=False, key=pkey, btn=collapse_btn: self._toggle_part_type_collapsed(key, btn))
            head_l.addWidget(collapse_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            head_row.setStyleSheet(f"QWidget {{ background:{header_bg.name()}; border:1px solid {header_bg.name()}; border-radius:8px; }}")
            self._visibility_host_l.addWidget(head_row)
            self._visibility_group_widgets.append((head_row, ptype, head_cb, collapse_btn, pkey))
            for row in grouped.get(ptype, []):
                key = str(row.get("__vis_key") or "").strip()
                line = QWidget()
                line_l = QHBoxLayout(line)
                line_l.setContentsMargins(6, 4, 6, 4)
                line_l.setSpacing(8)
                cb = QCheckBox()
                cb.setChecked(bool(self._visibility_map.get(key, True)))
                cb.toggled.connect(lambda checked, kk=key: self._set_row_visibility(kk, checked))
                name = str(self._row_get(row, "name", "partName") or "Piece").strip() or "Piece"
                room = str(self._row_get(row, "room", "section", "jobSection") or "-").strip() or "-"
                lbl = QLabel(f"{name}\n{room}")
                lbl.setStyleSheet("QLabel { color:#111827; font-size:11px; background:transparent; border:none; }")
                qty = str(self._row_get(row, "quantity", "qty") or "0").strip() or "0"
                qty_lbl = QLabel(qty)
                qty_lbl.setStyleSheet("QLabel { color:#111827; font-size:11px; font-weight:700; background:transparent; border:none; min-width:26px; }")
                qty_lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                line_l.addWidget(cb, 0, Qt.AlignmentFlag.AlignTop)
                line_l.addWidget(lbl, 1)
                line_l.addWidget(qty_lbl, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                line.setStyleSheet(f"QWidget {{ background:{row_bg_hex}; border:1px solid {row_border_hex}; border-radius:8px; }}")
                self._visibility_host_l.addWidget(line)
                self._visibility_row_widgets.append((line, f"{ptype} {name} {room}".lower(), ptype.lower(), cb))
        self._visibility_host_l.addStretch(1)
        self._apply_visibility_search()
        self._refresh_group_header_checks()

    def _apply_visibility_search(self) -> None:
        query = str(getattr(self, "_visibility_search", None).text() if isinstance(getattr(self, "_visibility_search", None), QLineEdit) else "").strip().lower()
        visible_groups: set[str] = set()
        for row_widget, blob, group_key, _row_cb in (getattr(self, "_visibility_row_widgets", None) or []):
            collapsed = self._part_key(group_key) in self._collapsed_part_types
            match = ((not query) or (query in blob)) and (not collapsed)
            row_widget.setVisible(match)
            if match:
                visible_groups.add(group_key)
        for group_widget, group_name, _group_cb, collapse_btn, group_key in (getattr(self, "_visibility_group_widgets", None) or []):
            if isinstance(collapse_btn, QPushButton):
                collapse_btn.setText("+" if self._part_key(group_key) in self._collapsed_part_types else "-")
            if not query:
                group_widget.setVisible(True)
            else:
                group_widget.setVisible(group_name.lower() in query or group_name.lower() in visible_groups)

    def _add_skipped(self, reason: str, count: int = 1) -> None:
        text = str(reason or "").strip()
        if not text:
            return
        qty = max(1, int(count or 1))
        self._skipped_counter[text] = int(self._skipped_counter.get(text, 0)) + qty

    def _normalize_hex(self, value: str, fallback: str = "#E7EAF0") -> str:
        txt = str(value or "").strip()
        if not txt.startswith("#"):
            txt = f"#{txt}"
        if re.fullmatch(r"#[0-9a-fA-F]{6}", txt):
            return txt.upper()
        return str(fallback or "#E7EAF0").upper()

    def _contrast_text(self, hex_color: str) -> str:
        c = QColor(self._normalize_hex(hex_color, "#E7EAF0"))
        lum = 0.299 * c.red() + 0.587 * c.green() + 0.114 * c.blue()
        return "#111827" if lum >= 170 else "#FFFFFF"

    def _part_type_style(self, part_type_name: str) -> tuple[str, str]:
        key = str(part_type_name or "").strip()
        color = self._part_type_colors.get(key) or self._part_type_colors.get(key.lower()) or "#E7EAF0"
        color = self._normalize_hex(color, "#E7EAF0")
        return color, self._contrast_text(color)

    @staticmethod
    def _cabinet_piece_suffixes() -> list[str]:
        return [
            "Adjustable Shelf",
            "Fixed Shelf",
            "Right Side",
            "Left Side",
            "Bottom",
            "Top",
            "Back",
        ]

    def _format_nesting_part_name(self, part_name: str, part_type_name: str) -> str:
        raw_name = str(part_name or "").strip() or "Part"
        pkey = self._part_key(part_type_name)
        if not bool(self._cabinetry_part_types.get(pkey, False)):
            return raw_name
        lower = raw_name.lower()
        for suffix in self._cabinet_piece_suffixes():
            s = str(suffix)
            sl = s.lower()
            if lower == sl:
                return raw_name
            if lower.endswith(" " + sl):
                cabinet_name = raw_name[: len(raw_name) - len(s)].strip()
                if cabinet_name:
                    return f"{cabinet_name}\n{s}"
                return s
        return raw_name

    def _board_label(self, board_value: str) -> str:
        key = str(board_value or "").strip()
        return str(self._board_display_map.get(key) or key or "No board")

    def _board_has_grain(self, board_value: str) -> bool:
        key = str(board_value or "").strip()
        return bool(self._board_grain_map.get(key))

    def _draw_grain_arrows(self, painter: QPainter, rect: QRectF, horizontal: bool) -> None:
        painter.save()
        painter.setPen(QPen(QColor(90, 100, 115, 105), 1))
        f = painter.font()
        f.setPointSize(max(10, int(f.pointSize() or 9) + 1))
        f.setBold(True)
        painter.setFont(f)
        x_gap = 72.0
        y_gap = 30.0
        if horizontal:
            row = 0
            y = rect.top() + 10.0
            while y <= rect.bottom() - 6.0:
                offset = 0.0 if row % 2 == 0 else x_gap * 0.5
                x = rect.left() + 6.0 + offset
                while x <= rect.right() - 6.0:
                    painter.drawText(QPointF(x, y), ">")
                    x += x_gap
                y += y_gap
                row += 1
        else:
            col = 0
            x = rect.left() + 8.0
            while x <= rect.right() - 6.0:
                offset = 0.0 if col % 2 == 0 else y_gap * 0.5
                y = rect.top() + 8.0 + offset
                while y <= rect.bottom() - 6.0:
                    painter.drawText(QPointF(x, y), ">")
                    y += y_gap
                x += x_gap
                col += 1
        painter.restore()

    def _parse_sheet_size(self, value: object, fallback_w: float, fallback_h: float) -> tuple[float, float]:
        text = str(value or "").strip().lower().replace("mm", "")
        if not text:
            return fallback_w, fallback_h
        for sep in ("x", "*", "by", "/", "\\"):
            text = text.replace(sep, " ")
        bits = [b for b in text.split() if b]
        if len(bits) >= 2:
            h = max(100.0, self._safe_float(bits[0], fallback_h))
            w = max(100.0, self._safe_float(bits[1], fallback_w))
            return w, h
        return fallback_w, fallback_h

    def _board_sheet_dimensions(self) -> dict[str, dict[str, float]]:
        default_w = max(100.0, self._safe_float(self._settings.get("sheetWidth"), 1220.0))
        default_h = max(100.0, self._safe_float(self._settings.get("sheetHeight"), 2440.0))
        out: dict[str, dict[str, float]] = {}
        for board_name, raw in self._board_sheet_sizes.items():
            label = str(board_name or "").strip()
            if not label:
                continue
            w, h = self._parse_sheet_size(raw, default_w, default_h)
            out[label] = {"sheetWidth": w, "sheetHeight": h}
        return out

    def _expanded_rows(self) -> list[dict]:
        out: list[dict] = []
        invalid_count = 0
        cnc_id_by_row_index: dict[int, int] = {}
        cnc_seed: list[tuple[int, str, str, str]] = []
        for row_idx, row in enumerate(self._rows):
            if not isinstance(row, dict):
                continue
            if not self._is_row_visible(row, row_idx):
                continue
            part_name_seed = str(self._row_get(row, "name", "partName", "part_name", "part") or "").strip()
            part_type_seed = str(self._row_get(row, "partType", "part_type", "type") or "").strip()
            board_seed = str(self._row_get(row, "board", "boardType", "board_type") or "").strip()
            qty_seed = str(self._row_get(row, "qty", "quantity", "count", "q") or "").strip()
            if not part_name_seed or not part_type_seed or not board_seed or not qty_seed:
                continue
            board_label_seed = str(self._board_label(board_seed) or board_seed or "").strip().lower()
            cnc_seed.append((int(row_idx), board_label_seed, self._part_key(part_type_seed), part_name_seed.lower()))
        cnc_seed.sort(key=lambda x: (x[1], x[2], x[3], x[0]))
        for i, item in enumerate(cnc_seed):
            cnc_id_by_row_index[int(item[0])] = int(i) + 1

        for row_idx, row in enumerate(self._rows):
            if not isinstance(row, dict):
                continue
            if not self._is_row_visible(row, row_idx):
                continue
            part_name = str(self._row_get(row, "name", "partName", "part_name", "part") or "").strip() or "Part"
            part_type = str(self._row_get(row, "partType", "part_type", "type") or "").strip()
            board_name = str(self._row_get(row, "board", "boardType", "board_type") or "").strip() or "No board"
            grain = str(self._row_get(row, "grain", "Grain") or "").strip().lower()
            lock_long = grain == "long" or bool(self._row_get(row, "lockLong", "lock_long"))
            lock_short = grain == "short" or bool(self._row_get(row, "lockShort", "lock_short"))
            raw_h_obj = self._row_get(row, "partHeight", "height", "h", "part_height", "length")
            raw_w_obj = self._row_get(row, "partWidth", "width", "w", "part_width")
            raw_d_obj = self._row_get(row, "depth", "d", "partDepth", "part_depth")
            h_val = self._safe_float(raw_h_obj, 0.0)
            w_val = self._safe_float(raw_w_obj, 0.0)
            d_val = self._safe_float(raw_d_obj, 0.0)
            qty = max(1, self._safe_int(self._row_get(row, "qty", "quantity", "count", "q"), 1))
            source_row_id = self._safe_int(self._row_get(row, "__id"), -1)
            if source_row_id <= 0:
                # Fallback to deterministic row order so sheet-piece edit links
                # still work for older cutlists that don't persist __id.
                source_row_id = int(row_idx) + 1

            # Match legacy behavior: use H/W first, otherwise derive from top 2 non-zero dims.
            if h_val > 0 and w_val > 0:
                width = w_val
                height = h_val
            else:
                dims = [x for x in [h_val, w_val, d_val] if x > 0]
                dims.sort(reverse=True)
                width = dims[1] if len(dims) > 1 else (dims[0] if dims else 0.0)
                height = dims[0] if len(dims) > 0 else 0.0

            if height <= 0 or width <= 0:
                invalid_count += qty
                raw_h = str(raw_h_obj or "").strip()
                raw_w = str(raw_w_obj or "").strip()
                raw_d = str(raw_d_obj or "").strip()
                self._add_skipped(
                    f"{part_name}: invalid size (H='{raw_h}' W='{raw_w}' D='{raw_d}')",
                    qty,
                )
                continue
            for _ in range(qty):
                out.append(
                    {
                        "board": board_name,
                        "partName": part_name,
                        "partType": part_type,
                        "height": float(height),
                        "width": float(width),
                        "lockLong": lock_long,
                        "lockShort": lock_short,
                        "sourceRowId": int(source_row_id),
                        "cncId": int(cnc_id_by_row_index.get(int(row_idx), 0)),
                    }
                )
        self._invalid_parts_count = invalid_count
        return out

    def _build_layout_data(self) -> list[dict]:
        settings = {
            "sheetWidth": max(100.0, self._safe_float(self._settings.get("sheetWidth"), 1220.0)),
            "sheetHeight": max(100.0, self._safe_float(self._settings.get("sheetHeight"), 2440.0)),
            "kerf": max(0.0, self._safe_float(self._settings.get("kerf"), 5.0)),
            "margin": max(0.0, self._safe_float(self._settings.get("margin"), 10.0)),
        }
        board_sheet_map = self._board_sheet_dimensions()
        grouped: dict[str, list[dict]] = {}
        ordered_boards: list[str] = []
        for part in self._expanded_rows():
            board_name = str(part.get("board") or "No board")
            if board_name not in grouped:
                grouped[board_name] = []
                ordered_boards.append(board_name)
            grouped[board_name].append(part)

        board_groups: list[dict] = []
        skipped_parts_count = 0
        self._skipped_counter = {}
        for board_name in ordered_boards:
            parts = list(grouped.get(board_name) or [])
            parts.sort(key=lambda p: max(float(p["width"]), float(p["height"])) * min(float(p["width"]), float(p["height"])), reverse=True)
            board_sheet = board_sheet_map.get(board_name) or {"sheetWidth": settings["sheetWidth"], "sheetHeight": settings["sheetHeight"]}
            sheet_w = max(100.0, self._safe_float(board_sheet.get("sheetWidth"), settings["sheetWidth"]))
            sheet_h = max(100.0, self._safe_float(board_sheet.get("sheetHeight"), settings["sheetHeight"]))
            kerf = settings["kerf"]
            margin = settings["margin"]
            usable_w = max(1.0, sheet_w - margin * 2.0)
            usable_h = max(1.0, sheet_h - margin * 2.0)
            x_axis_is_long = usable_w >= usable_h

            sheets: list[dict] = []

            def _try_place_in_existing_columns(sheet_obj: dict, ow: float, oh: float) -> bool:
                cols = sheet_obj.setdefault("columns", [])
                for col in cols:
                    add_kerf = kerf if float(col.get("usedHeight") or 0.0) > 0 else 0.0
                    if ow <= float(col.get("width") or 0.0) and (float(col.get("usedHeight") or 0.0) + add_kerf + oh) <= usable_h:
                        x0 = float(col.get("x") or 0.0)
                        y0 = float(col.get("usedHeight") or 0.0) + add_kerf
                        col["usedHeight"] = y0 + oh
                        return x0, y0
                return False

            def _try_create_column_and_place(sheet_obj: dict, ow: float, oh: float) -> bool:
                cols = sheet_obj.setdefault("columns", [])
                next_x = float(sum(float(c.get("width") or 0.0) for c in cols)) + (kerf * len(cols) if len(cols) > 0 else 0.0)
                if next_x + ow > usable_w:
                    return False
                cols.append({"x": next_x, "width": ow, "usedHeight": oh})
                return next_x, 0.0

            for part in parts:
                pw_raw = float(part["width"])
                ph_raw = float(part["height"])
                lock_long = bool(part.get("lockLong"))
                lock_short = bool(part.get("lockShort"))

                orientations = [
                    {"w": pw_raw, "h": ph_raw},
                    {"w": ph_raw, "h": pw_raw},
                ]
                dedup: list[dict] = []
                seen_orients: set[tuple[int, int]] = set()
                for o in orientations:
                    sig = (int(round(o["w"] * 1000)), int(round(o["h"] * 1000)))
                    if sig in seen_orients:
                        continue
                    seen_orients.add(sig)
                    dedup.append(o)
                orientations = dedup

                if lock_long:
                    long_edge = max(pw_raw, ph_raw)
                    if x_axis_is_long:
                        orientations = [o for o in orientations if abs(float(o["w"]) - long_edge) < 1e-6]
                    else:
                        orientations = [o for o in orientations if abs(float(o["h"]) - long_edge) < 1e-6]
                elif lock_short:
                    short_edge = min(pw_raw, ph_raw)
                    if x_axis_is_long:
                        orientations = [o for o in orientations if abs(float(o["w"]) - short_edge) < 1e-6]
                    else:
                        orientations = [o for o in orientations if abs(float(o["h"]) - short_edge) < 1e-6]

                orientations = [o for o in orientations if float(o["w"]) <= usable_w and float(o["h"]) <= usable_h]

                placed = False
                for sheet_obj in sheets:
                    for o in orientations:
                        pos = _try_place_in_existing_columns(sheet_obj, float(o["w"]), float(o["h"]))
                        if not pos:
                            continue
                        x0, y0 = pos
                        sheet_obj.setdefault("parts", []).append(
                            {
                                **part,
                                "x": margin + x0,
                                "y": margin + y0,
                                "drawWidth": float(o["w"]),
                                "drawHeight": float(o["h"]),
                                "rotated": abs(float(o["w"]) - pw_raw) > 1e-6 or abs(float(o["h"]) - ph_raw) > 1e-6,
                            }
                        )
                        placed = True
                        break
                    if placed:
                        break
                if placed:
                    continue

                for sheet_obj in sheets:
                    for o in orientations:
                        pos = _try_create_column_and_place(sheet_obj, float(o["w"]), float(o["h"]))
                        if not pos:
                            continue
                        x0, y0 = pos
                        sheet_obj.setdefault("parts", []).append(
                            {
                                **part,
                                "x": margin + x0,
                                "y": margin + y0,
                                "drawWidth": float(o["w"]),
                                "drawHeight": float(o["h"]),
                                "rotated": abs(float(o["w"]) - pw_raw) > 1e-6 or abs(float(o["h"]) - ph_raw) > 1e-6,
                            }
                        )
                        placed = True
                        break
                    if placed:
                        break
                if placed:
                    continue

                new_sheet = {"parts": [], "sheetWidth": sheet_w, "sheetHeight": sheet_h, "columns": []}
                if orientations:
                    o = orientations[0]
                    _try_create_column_and_place(new_sheet, float(o["w"]), float(o["h"]))
                    new_sheet["parts"].append(
                        {
                            **part,
                            "x": margin,
                            "y": margin,
                            "drawWidth": float(o["w"]),
                            "drawHeight": float(o["h"]),
                            "rotated": abs(float(o["w"]) - pw_raw) > 1e-6 or abs(float(o["h"]) - ph_raw) > 1e-6,
                        }
                    )
                else:
                    # Match the old sheet-count behavior: oversized parts still consume a sheet.
                    skipped_parts_count += 1
                    self._add_skipped(
                        f"{str(part.get('partName') or 'Part')}: too large for sheet {int(round(sheet_h))}x{int(round(sheet_w))}; counted as own sheet",
                        1,
                    )
                sheets.append(new_sheet)
            if sheets:
                board_groups.append(
                    {
                        "board": board_name,
                        "boardLabel": self._board_label(board_name),
                        "boardHasGrain": self._board_has_grain(board_name),
                        "sheetCount": len(sheets),
                        "sheets": sheets,
                        "sheetWidth": sheet_w,
                        "sheetHeight": sheet_h,
                    }
                )
        self._skipped_parts_count = skipped_parts_count
        return board_groups

    def _render_layout(self) -> None:
        board_groups = self._build_layout_data()
        total_sheets = sum(int(g.get("sheetCount") or 0) for g in board_groups)
        total_parts = sum(len(sheet.get("parts") or []) for g in board_groups for sheet in (g.get("sheets") or []))
        summary_parts: list[str] = []
        for g in board_groups:
            label_raw = str(g.get("boardLabel") or g.get("board") or "Sheet")
            label = re.sub(r"^\[[^\]]+\]\s*", "", label_raw).strip() or label_raw
            count = int(g.get("sheetCount") or 0)
            sheet_w = float(g.get("sheetWidth") or 0.0)
            sheet_h = float(g.get("sheetHeight") or 0.0)
            chip = ""
            if sheet_w > 0 and sheet_h > 0:
                major = int(round(max(sheet_w, sheet_h)))
                minor = int(round(min(sheet_w, sheet_h)))
                chip = f"{major}x{minor}"
            size_chip_html = (
                f"<span style='background:#EEF1F5; color:#5B6472; border:1px solid #D8DEE8; border-radius:999px; padding:2px 10px; font-weight:700;'>{html.escape(chip)}</span>"
                if chip else ""
            )
            name_html = f"<span style='color:#1A1D23; font-weight:700;'>{html.escape(label)}</span>"
            count_txt = f"{count} sheet{'s' if count != 1 else ''}"
            count_chip_html = (
                f"<span style='background:#EEF1F5; color:#5B6472; border:1px solid #D8DEE8; border-radius:999px; padding:2px 10px; font-weight:700;'>{html.escape(count_txt)}</span>"
            )
            segment = " ".join([p for p in [size_chip_html, name_html, count_chip_html] if p]).strip()
            summary_parts.append(segment)
        if summary_parts:
            self._summary.setText("  |  ".join(summary_parts))
        else:
            self._summary.setText("Sheets: -")
        total_skipped = int(sum(self._skipped_counter.values()))
        if hasattr(self, "_show_skipped_btn") and isinstance(self._show_skipped_btn, QPushButton):
            self._show_skipped_btn.setText(f"Skipped ({total_skipped})")
            self._show_skipped_btn.setVisible(total_skipped > 0)

        viewport_w = max(680, self._scroll.viewport().width())
        canvas_w = max(680, viewport_w - 4)

        self._section_draw_data = []
        self._sheet_click_targets = []
        self._part_hover_targets = []
        self._hover_text = ""

        if not board_groups:
            self._content_h = 520
            self._canvas.resize(canvas_w, self._content_h)
            self._canvas.update()
            return

        outer_pad = 12.0
        section_gap_x = 12.0
        sheet_gap_x = 12.0
        sheet_gap_y = 28.0
        section_header_h = 52.0
        section_inner_pad = 8.0
        min_sheet_draw_w = 190.0
        min_section_w = 320.0

        # Keep a single top row with dynamic columns:
        # - 1..4 board types: spacing behaves as if there are always 4 columns.
        # - 5+ board types: columns shrink dynamically as more are added.
        section_cols = max(1, len(board_groups))
        base_cols = 4
        if section_cols <= base_cols:
            target_cols = base_cols
            gap_w = section_gap_x * max(0, target_cols - 1)
            section_w = max(1.0, (canvas_w - outer_pad * 2.0 - gap_w) / float(target_cols))
        else:
            target_cols = section_cols
            gap_w = section_gap_x * max(0, target_cols - 1)
            section_w = max(140.0, (canvas_w - outer_pad * 2.0 - gap_w) / float(target_cols))
        required_canvas_w = outer_pad * 2.0 + (section_w * section_cols) + (section_gap_x * max(0, section_cols - 1))
        canvas_w = max(canvas_w, int(math.ceil(required_canvas_w)))

        section_layouts: list[dict] = []
        row_heights: dict[int, float] = {}
        for idx, group in enumerate(board_groups):
            sheets = list(group.get("sheets") or [])
            content_w = max(80.0, section_w - section_inner_pad * 2.0)
            # Stack sheets vertically for each board type.
            inside_cols = 1
            visual_sheet_w = max(100.0, self._safe_float(group.get("sheetHeight"), 2440.0))
            visual_sheet_h = max(100.0, self._safe_float(group.get("sheetWidth"), 1220.0))
            # Allow stronger down-scaling on narrow windows so larger sheet sizes
            # always stay inside their board-type container width.
            scale = max(0.01, (content_w - sheet_gap_x * max(0, inside_cols - 1)) / max(1.0, inside_cols * visual_sheet_w))
            sheet_draw_w = visual_sheet_w * scale
            sheet_draw_h = visual_sheet_h * scale
            inside_rows = max(1, (len(sheets) + inside_cols - 1) // inside_cols)
            content_draw_w = inside_cols * sheet_draw_w + max(0, inside_cols - 1) * sheet_gap_x
            content_draw_h = inside_rows * sheet_draw_h + max(0, inside_rows - 1) * sheet_gap_y
            section_h = section_header_h + section_inner_pad * 2.0 + content_draw_h
            row_index = 0
            row_heights[row_index] = max(row_heights.get(row_index, 0.0), section_h)
            section_layouts.append(
                {
                    "group": group,
                    "inside_cols": inside_cols,
                    "scale": scale,
                    "sheet_draw_w": sheet_draw_w,
                    "sheet_draw_h": sheet_draw_h,
                    "content_draw_w": content_draw_w,
                    "section_h": section_h,
                }
            )

        row_offsets: dict[int, float] = {}
        run_y = outer_pad
        for row_index in range((max(row_heights.keys()) + 1) if row_heights else 0):
            row_offsets[row_index] = run_y
            run_y += row_heights[row_index] + sheet_gap_y

        for idx, item in enumerate(section_layouts):
            group = item["group"]
            sheets = list(group.get("sheets") or [])
            row_index = 0
            col_in_row = idx
            ox = outer_pad + col_in_row * (section_w + section_gap_x)
            oy = row_offsets.get(row_index, outer_pad)
            section_rect = QRectF(ox, oy, section_w, item["section_h"])
            section_entry = {
                "rect": section_rect,
                "board": str(group.get("board") or "Board"),
                "boardLabel": str(group.get("boardLabel") or self._board_label(str(group.get("board") or "Board"))),
                "boardHasGrain": bool(group.get("boardHasGrain")),
                "sheetCount": int(group.get("sheetCount") or 0),
                "sheetWidth": float(group.get("sheetWidth") or 1220.0),
                "sheetHeight": float(group.get("sheetHeight") or 2440.0),
                "sheets": [],
            }

            inside_cols = int(item["inside_cols"])
            content_w = max(80.0, section_w - section_inner_pad * 2.0)
            content_x = ox + section_inner_pad + max(0.0, (content_w - item["content_draw_w"]) / 2.0)
            content_y = oy + section_header_h + section_inner_pad
            scale = float(item["scale"])

            for sidx, sheet in enumerate(sheets):
                inner_col = sidx % inside_cols
                inner_row = sidx // inside_cols
                sw = float(item["sheet_draw_w"])
                sh = float(item["sheet_draw_h"])
                px = content_x + inner_col * (sw + sheet_gap_x)
                py = content_y + inner_row * (sh + sheet_gap_y)
                sheet_rect = QRectF(px, py, sw, sh)
                hover_id = len(self._sheet_click_targets)
                sheet_entry = {"sheetRect": sheet_rect, "label": f"Sheet {sidx + 1}", "hoverId": hover_id, "parts": []}
                self._sheet_click_targets.append(
                    {
                        "hoverId": hover_id,
                        "rect": sheet_rect,
                        "board": str(group.get("board") or "Board"),
                        "board_has_grain": bool(group.get("boardHasGrain")),
                        "sheet_number": sidx + 1,
                        "sheet": sheet,
                        "sheet_width": float(group.get("sheetWidth") or 1220.0),
                        "sheet_height": float(group.get("sheetHeight") or 2440.0),
                    }
                )
                for part in (sheet.get("parts") or []):
                    vx = float(part.get("y") or 0.0)
                    vy = float(group.get("sheetWidth") or 1220.0) - (float(part.get("x") or 0.0) + float(part.get("drawWidth") or 0.0))
                    vw = float(part.get("drawHeight") or 0.0)
                    vh = float(part.get("drawWidth") or 0.0)
                    x1 = px + vx * scale
                    y1 = py + vy * scale
                    pw = vw * scale
                    ph = vh * scale
                    if pw <= 0 or ph <= 0:
                        continue
                    part_rect = QRectF(x1, y1, pw, ph)
                    fill, txt = self._part_type_style(str(part.get("partType") or ""))
                    pname = self._format_nesting_part_name(
                        str(part.get("partName") or "Part"),
                        str(part.get("partType") or ""),
                    )
                    sheet_entry["parts"].append({"rect": part_rect, "name": pname, "fill": fill, "txt": txt})
                    tooltip = f"{pname}\n{int(round(float(part.get('height') or 0.0)))} x {int(round(float(part.get('width') or 0.0)))}"
                    if bool(part.get("rotated")):
                        tooltip += "\nRotated"
                    self._part_hover_targets.append({"rect": part_rect, "text": tooltip})
                section_entry["sheets"].append(sheet_entry)
            self._section_draw_data.append(section_entry)

        content_h = (run_y - sheet_gap_y + outer_pad) if row_heights else (outer_pad * 2.0)
        self._content_h = int(max(520.0, content_h))
        self._canvas.resize(canvas_w, self._content_h)
        self._canvas.update()

    def _paint_layout(self, painter: QPainter, canvas_w: int, canvas_h: int) -> None:
        painter.fillRect(QRectF(0, 0, float(canvas_w), float(canvas_h)), QColor("#FFFFFF"))
        if not self._section_draw_data:
            painter.setPen(QPen(QColor("#8B93A1"), 1))
            painter.drawText(QRectF(0, 0, float(canvas_w), float(canvas_h)), int(Qt.AlignmentFlag.AlignCenter), "No sheets to display yet.")
            return
        for section in self._section_draw_data:
            rect = QRectF(section["rect"])
            painter.setPen(QPen(QColor("#E4E6EC"), 1))
            painter.setBrush(QColor("#F3F4F6"))
            painter.drawRoundedRect(rect, 18, 18)
            board_title = str(section.get("boardLabel") or section["board"])
            title_x = rect.left() + 14
            title_y = rect.top() + 10
            title_h = 24
            base_font = painter.font()
            header_font = QFont(base_font)
            header_font.setPointSize(max(11, int((base_font.pointSize() if base_font.pointSize() > 0 else 10) + 2)))
            painter.setFont(header_font)
            m = re.match(r"^\[\s*([^\]]+)\s*\]\s*(.+)$", board_title)
            draw_x = title_x
            sheet_count = int(section.get("sheetCount") or 0)
            count_text = f"{sheet_count} sheet{'s' if sheet_count != 1 else ''}"
            count_chip_h = 22.0
            count_chip_w = max(52.0, float(painter.fontMetrics().horizontalAdvance(count_text) + 20))
            count_chip_y = title_y + (title_h - count_chip_h) * 0.5
            count_chip_rect = QRectF(rect.right() - count_chip_w - 10.0, count_chip_y, count_chip_w, count_chip_h)
            sheet_w = float(section.get("sheetWidth") or 0.0)
            sheet_h = float(section.get("sheetHeight") or 0.0)
            chip = ""
            if sheet_w > 0 and sheet_h > 0:
                major = int(round(max(sheet_w, sheet_h)))
                minor = int(round(min(sheet_w, sheet_h)))
                chip = f"{major}x{minor}"
            rest = str(m.group(2) if m else board_title).strip()
            if chip:
                chip_h = 22.0
                chip_w = max(36.0, float(painter.fontMetrics().horizontalAdvance(chip) + 20))
                chip_y = title_y + (title_h - chip_h) * 0.5
                chip_rect = QRectF(draw_x, chip_y, chip_w, chip_h)
                painter.setPen(QPen(QColor("#D8DEE8"), 1))
                painter.setBrush(QColor("#EEF1F5"))
                painter.drawRoundedRect(chip_rect, 10, 10)
                painter.setPen(QPen(QColor("#5B6472"), 1))
                painter.drawText(chip_rect, int(Qt.AlignmentFlag.AlignCenter), chip)
                draw_x += chip_w + 8.0
                painter.setPen(QPen(QColor("#1A1D23"), 1))
                painter.drawText(QRectF(draw_x, title_y, max(20.0, count_chip_rect.left() - 8.0 - draw_x), title_h), int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter), rest)
            else:
                painter.setPen(QPen(QColor("#1A1D23"), 1))
                painter.drawText(QRectF(title_x, title_y, max(20.0, count_chip_rect.left() - 8.0 - title_x), title_h), int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter), board_title)
            painter.setPen(QPen(QColor("#D8DEE8"), 1))
            painter.setBrush(QColor("#EEF1F5"))
            painter.drawRoundedRect(count_chip_rect, 10, 10)
            painter.setPen(QPen(QColor("#5B6472"), 1))
            painter.drawText(count_chip_rect, int(Qt.AlignmentFlag.AlignCenter), count_text)
            painter.setFont(base_font)
            for sheet in (section.get("sheets") or []):
                srect = QRectF(sheet["sheetRect"])
                painter.setPen(QPen(QColor("#CCD3E0"), 2))
                painter.setBrush(QColor("#FFFFFF"))
                painter.drawRect(srect)
                painter.setPen(QPen(QColor("#5B6472"), 1))
                painter.drawText(QRectF(srect.left() + 6, srect.top() - 14, srect.width() - 12, 12), int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter), str(sheet.get("label") or "Sheet"))
                for part in (sheet.get("parts") or []):
                    prect = QRectF(part["rect"])
                    fill = str(part.get("fill") or "#E7EAF0")
                    txt = str(part.get("txt") or "#111827")
                    painter.setPen(QPen(QColor(fill).darker(118), 1))
                    painter.setBrush(QColor(fill))
                    painter.drawRect(prect)
                    if prect.width() > 58 and prect.height() > 22:
                        painter.setPen(QPen(QColor(txt), 1))
                        painter.drawText(QRectF(prect.left() + 3, prect.top() + 3, prect.width() - 6, prect.height() - 6), int(Qt.AlignmentFlag.AlignCenter | Qt.TextFlag.TextWordWrap), str(part.get("name") or ""))
                if bool(section.get("boardHasGrain")):
                    grain_horizontal = float(section.get("sheetHeight") or 0.0) >= float(section.get("sheetWidth") or 0.0)
                    self._draw_grain_arrows(painter, QRectF(srect.left() + 3, srect.top() + 3, srect.width() - 6, srect.height() - 6), grain_horizontal)
        if self._hover_text:
            self._paint_hover_tooltip(painter, float(canvas_w), float(canvas_h))

    def _paint_hover_tooltip(self, painter: QPainter, canvas_w: float, canvas_h: float) -> None:
        lines = [ln for ln in str(self._hover_text or "").splitlines() if ln]
        if not lines:
            return
        font = painter.font()
        line_h = 14
        w = min(320, max(120, max(len(ln) for ln in lines) * 7 + 16))
        h = 12 + line_h * len(lines)
        x = min(max(8.0, float(self._hover_pos.x()) + 14.0), max(8.0, canvas_w - w - 8.0))
        y = min(max(8.0, float(self._hover_pos.y()) + 14.0), max(8.0, canvas_h - h - 8.0))
        tip_rect = QRectF(x, y, float(w), float(h))
        painter.setPen(QPen(QColor("#D0D5DD"), 1))
        painter.setBrush(QColor("#FFFFFF"))
        painter.drawRoundedRect(tip_rect, 8, 8)
        painter.setPen(QPen(QColor("#111827"), 1))
        for idx, ln in enumerate(lines):
            painter.drawText(QRectF(x + 8, y + 8 + idx * line_h, w - 16, line_h), int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter), ln)
        painter.setFont(font)

    def _clear_canvas_hover(self) -> None:
        changed = False
        if self._hover_text:
            self._hover_text = ""
            changed = True
        if self._hover_sheet_index != -1:
            self._hover_sheet_index = -1
            changed = True
        self._canvas.setCursor(Qt.CursorShape.ArrowCursor)
        if changed:
            self._canvas.update()

    def _on_canvas_hover(self, x: float, y: float) -> None:
        pos = QPointF(float(x), float(y))
        hover_sheet_index = -1
        for idx, target in enumerate(self._sheet_click_targets):
            rect = target.get("rect")
            if isinstance(rect, QRectF) and rect.contains(pos):
                hover_sheet_index = idx
                break
        text = ""
        for target in self._part_hover_targets:
            rect = target.get("rect")
            if isinstance(rect, QRectF) and rect.contains(pos):
                text = str(target.get("text") or "")
                break
        if hover_sheet_index >= 0:
            self._canvas.setCursor(Qt.CursorShape.PointingHandCursor)
        else:
            self._canvas.setCursor(Qt.CursorShape.ArrowCursor)
        if (
            text != self._hover_text
            or hover_sheet_index != self._hover_sheet_index
            or abs(pos.x() - self._hover_pos.x()) > 1
            or abs(pos.y() - self._hover_pos.y()) > 1
        ):
            self._hover_text = text
            self._hover_sheet_index = hover_sheet_index
            self._hover_pos = pos
            self._canvas.update()

    def _on_canvas_click(self, x: float, y: float) -> None:
        pos = QPointF(float(x), float(y))
        for target in self._sheet_click_targets:
            rect = target.get("rect")
            if isinstance(rect, QRectF) and rect.contains(pos):
                self._open_sheet_preview(
                    self._board_label(str(target.get("board") or "Board")),
                    int(target.get("sheet_number") or 1),
                    dict(target.get("sheet") or {}),
                    float(target.get("sheet_width") or 1220.0),
                    float(target.get("sheet_height") or 2440.0),
                    bool(target.get("board_has_grain")),
                )
                return

    def _open_sheet_preview(self, board_name: str, sheet_number: int, sheet: dict, sheet_w: float, sheet_h: float, has_grain: bool = False) -> None:
        dialog = QDialog(self)
        dialog.setWindowTitle(f"{board_name} - Sheet {sheet_number}")
        dialog.resize(1040, 760)
        dialog.setMinimumSize(760, 520)
        root = QVBoxLayout(dialog)
        root.setContentsMargins(12, 10, 12, 10)
        root.setSpacing(8)
        title = QLabel(f"{board_name} - Sheet {sheet_number}")
        title.setStyleSheet("color: #111827; font-size: 18px; font-weight: 700;")
        root.addWidget(title)
        meta = QLabel(f"{int(round(sheet_h))} x {int(round(sheet_w))}")
        meta.setStyleSheet("color: #6B7280; font-size: 12px;")
        root.addWidget(meta)
        preview = _NestingSheetPreviewWidget(
            sheet,
            sheet_w,
            sheet_h,
            self._part_type_style,
            label_formatter=self._format_nesting_part_name,
            has_grain=has_grain,
        )
        if callable(self._on_edit_part):
            preview.editRequested.connect(lambda rid: (dialog.accept(), self._on_edit_part(int(rid))))
        root.addWidget(preview, 1)

        # Single-sheet stats panel (only shown in this preview dialog).
        parts = [p for p in (sheet.get("parts") or []) if isinstance(p, dict)]
        sheet_area = max(1.0, float(sheet_w or 0.0) * float(sheet_h or 0.0))
        used_area = 0.0
        largest_area = 0.0
        largest_part_name = ""
        for p in parts:
            pw = max(0.0, float(p.get("drawWidth") or 0.0))
            ph = max(0.0, float(p.get("drawHeight") or 0.0))
            area = pw * ph
            used_area += area
            if area > largest_area:
                largest_area = area
                largest_part_name = str(p.get("partName") or "Part")
        used_pct = max(0.0, min(100.0, (used_area / sheet_area) * 100.0))
        waste_pct = max(0.0, 100.0 - used_pct)
        waste_area = max(0.0, sheet_area - used_area)

        def _fmt_area_mm2_to_m2(value_mm2: float) -> str:
            return f"{(max(0.0, value_mm2) / 1_000_000.0):.3f} m²"

        stats_card = QFrame()
        stats_card.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:10px; }")
        stats_l = QVBoxLayout(stats_card)
        stats_l.setContentsMargins(10, 10, 10, 10)
        stats_l.setSpacing(6)
        stats_title = QLabel("Sheet Stats")
        stats_title.setStyleSheet("QLabel { color:#111827; font-size:13px; font-weight:800; background:transparent; border:none; }")
        stats_l.addWidget(stats_title)
        stats_grid = QGridLayout()
        stats_grid.setContentsMargins(0, 0, 0, 0)
        stats_grid.setHorizontalSpacing(14)
        stats_grid.setVerticalSpacing(6)

        entries = [
            ("Used", f"{used_pct:.1f}% ({_fmt_area_mm2_to_m2(used_area)})"),
            ("Wastage", f"{waste_pct:.1f}% ({_fmt_area_mm2_to_m2(waste_area)})"),
            ("Parts on Sheet", str(len(parts))),
            ("Sheet Area", _fmt_area_mm2_to_m2(sheet_area)),
            ("Largest Part", f"{largest_part_name or '-'} ({_fmt_area_mm2_to_m2(largest_area)})"),
            ("Board Size", f"{int(round(sheet_h))} x {int(round(sheet_w))}"),
        ]
        for i, (k, v) in enumerate(entries):
            r = i // 2
            c = (i % 2) * 2
            k_lbl = QLabel(str(k))
            k_lbl.setStyleSheet("QLabel { color:#64748B; font-size:11px; font-weight:700; background:transparent; border:none; }")
            v_lbl = QLabel(str(v))
            v_lbl.setStyleSheet("QLabel { color:#111827; font-size:12px; font-weight:700; background:transparent; border:none; }")
            stats_grid.addWidget(k_lbl, r, c, 1, 1)
            stats_grid.addWidget(v_lbl, r, c + 1, 1, 1)
        stats_l.addLayout(stats_grid)
        root.addWidget(stats_card, 0)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(dialog.reject)
        buttons.accepted.connect(dialog.accept)
        close_btn = buttons.button(QDialogButtonBox.StandardButton.Close)
        if close_btn is not None:
            close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            close_btn.setText("Close")
        root.addWidget(buttons)
        dialog.exec()

    def _collect_print_sheets(self) -> list[dict]:
        out: list[dict] = []
        board_groups = self._build_layout_data()
        for group in board_groups:
            board_label = str(group.get("boardLabel") or group.get("board") or "Board")
            has_grain = bool(group.get("boardHasGrain"))
            sheet_w = float(group.get("sheetWidth") or 1220.0)
            sheet_h = float(group.get("sheetHeight") or 2440.0)
            for idx, sheet in enumerate(group.get("sheets") or []):
                if not isinstance(sheet, dict):
                    continue
                out.append(
                    {
                        "boardLabel": board_label,
                        "sheetNumber": int(idx) + 1,
                        "sheet": dict(sheet),
                        "sheetWidth": sheet_w,
                        "sheetHeight": sheet_h,
                        "boardHasGrain": has_grain,
                    }
                )
        return out

    def _open_print_preview(self) -> None:
        sheets = self._collect_print_sheets()
        if not sheets:
            QMessageBox.information(self, "Print", "No nesting sheets to print.")
            return
        printer = QPrinter(QPrinter.PrinterMode.HighResolution)
        try:
            from PySide6.QtGui import QPageLayout

            printer.setPageOrientation(QPageLayout.Orientation.Landscape)
        except Exception:
            try:
                printer.setOrientation(QPrinter.Orientation.Landscape)
            except Exception:
                pass
        preview = QPrintPreviewDialog(printer, self)
        preview.setWindowTitle("Print Preview - Nesting")
        preview.paintRequested.connect(self._render_nesting_print_document)
        preview.exec()

    def _render_nesting_print_document(self, printer: QPrinter) -> None:
        sheets = self._collect_print_sheets()
        if not sheets:
            return

        painter = QPainter(printer)
        if not painter.isActive():
            return
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        try:
            page_rect = printer.pageRect(QPrinter.Unit.DevicePixel)
        except Exception:
            page_rect = printer.pageRect(QPrinter.Unit.Point)
        page = QRectF(float(page_rect.left()), float(page_rect.top()), float(page_rect.width()), float(page_rect.height()))

        ui_scale = max(0.85, float(page.width()) / 3508.0)
        # Keep an explicit safety inset so page-edge clipping never happens on
        # printers/previews with tighter printable bounds.
        outer = max(24.0 * ui_scale, page.width() * 0.02)
        gap_x = 14.0 * ui_scale
        gap_y = 14.0 * ui_scale
        slots_per_page = 4
        cols = 2
        rows = 2
        content = QRectF(
            page.left() + outer,
            page.top() + outer,
            max(10.0, page.width() - (outer * 2.0)),
            max(10.0, page.height() - (outer * 2.0)),
        )
        cell_w = (content.width() - gap_x) / float(cols)
        cell_h = (content.height() - gap_y) / float(rows)
        used_w = (cell_w * cols) + (gap_x * (cols - 1))
        used_h = (cell_h * rows) + (gap_y * (rows - 1))
        grid_left = content.left() + ((content.width() - used_w) * 0.5)
        grid_top = content.top() + ((content.height() - used_h) * 0.5)

        def _draw_grain_arrows_print(rect: QRectF, horizontal: bool) -> None:
            painter.save()
            painter.setPen(QPen(QColor("#4B5563"), max(0.8, 0.9 * ui_scale)))
            f = painter.font()
            f.setPointSize(max(11, int(f.pointSize() or 10) + 1))
            f.setBold(False)
            painter.setFont(f)
            # Keep the same staggered pattern as normal nesting, but target
            # ~23 arrows per full printed sheet for readability.
            usable_w = max(1.0, rect.width() - 16.0)
            usable_h = max(1.0, rect.height() - 16.0)
            target_arrows = 23.0
            ratio = 82.0 / 34.0  # keep normal nesting x/y spacing ratio
            x_gap = ((usable_w * usable_h * ratio) / target_arrows) ** 0.5
            x_gap = max(82.0, x_gap)
            y_gap = max(34.0, x_gap / ratio)
            glyph = ">"
            fm = painter.fontMetrics()
            glyph_w = max(4.0, float(fm.horizontalAdvance(glyph)))
            glyph_h = max(4.0, float(fm.height()))
            pad_x = max(4.0, 3.0 * ui_scale)
            pad_y = max(4.0, 3.0 * ui_scale)
            if horizontal:
                row = 0
                y = rect.top() + pad_y
                while y <= rect.bottom() - glyph_h - pad_y:
                    offset = 0.0 if row % 2 == 0 else x_gap * 0.5
                    x = rect.left() + pad_x + offset
                    while x <= rect.right() - glyph_w - pad_x:
                        painter.drawText(
                            QRectF(x, y, glyph_w, glyph_h),
                            int(Qt.AlignmentFlag.AlignCenter),
                            glyph,
                        )
                        x += x_gap
                    y += y_gap
                    row += 1
            else:
                col = 0
                x = rect.left() + pad_x
                while x <= rect.right() - glyph_w - pad_x:
                    offset = 0.0 if col % 2 == 0 else y_gap * 0.5
                    y = rect.top() + pad_y + offset
                    while y <= rect.bottom() - glyph_h - pad_y:
                        painter.drawText(
                            QRectF(x, y, glyph_w, glyph_h),
                            int(Qt.AlignmentFlag.AlignCenter),
                            glyph,
                        )
                        y += y_gap
                    x += x_gap
                    col += 1
            painter.restore()

        def _draw_card(cell_rect: QRectF, sheet_blob: dict) -> None:
            card = QRectF(cell_rect)
            painter.setPen(QPen(QColor("#000000"), max(1.0, 1.0 * ui_scale)))
            painter.setBrush(QColor("#EEF2F7"))
            painter.drawRoundedRect(card, 8.0 * ui_scale, 8.0 * ui_scale)

            pad = 8.0 * ui_scale
            board_label_raw = str(sheet_blob.get("boardLabel") or "Board")
            board_label = re.sub(r"^\s*\[[^\]]+\]\s*", "", board_label_raw).strip() or board_label_raw
            sheet_no = int(sheet_blob.get("sheetNumber") or 1)
            sw = int(round(float(sheet_blob.get("sheetHeight") or 2440.0)))
            sh = int(round(float(sheet_blob.get("sheetWidth") or 1220.0)))
            head_txt = f"{board_label} - Sheet {sheet_no} ({sw} x {sh})"
            title_font = QFont(painter.font())
            title_font.setPointSizeF(max(5.2, 5.2 * ui_scale))
            title_font.setBold(True)
            painter.setFont(title_font)
            title_fm = painter.fontMetrics()
            title_h = max(18.0 * ui_scale, float(title_fm.height()) + (6.0 * ui_scale))
            head_rect = QRectF(card.left() + pad, card.top() + (pad * 1.15), card.width() - (pad * 2.0), title_h)
            painter.setPen(QPen(QColor("#0F172A"), 1))
            painter.drawText(
                head_rect,
                int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter),
                title_fm.elidedText(head_txt, Qt.TextElideMode.ElideRight, int(head_rect.width())),
            )

            visual_w = max(100.0, float(sheet_blob.get("sheetHeight") or 2440.0))
            visual_h = max(100.0, float(sheet_blob.get("sheetWidth") or 1220.0))
            sheet_box_y = head_rect.bottom() + (16.0 * ui_scale)
            sheet_box_w = card.width() - (pad * 2.0)
            inner_w_for_calc = max(10.0, sheet_box_w - (12.0 * ui_scale))
            aspect = float(visual_h) / float(visual_w) if visual_w > 0 else 0.5
            desired_sheet_box_h = (inner_w_for_calc * aspect) + (12.0 * ui_scale)
            legend_min_h = 90.0 * ui_scale
            available_for_sheet = max(80.0 * ui_scale, card.bottom() - pad - legend_min_h - sheet_box_y - (6.0 * ui_scale))
            sheet_box_h = min(max(120.0 * ui_scale, desired_sheet_box_h), available_for_sheet)
            legend_top = sheet_box_y + sheet_box_h + (10.0 * ui_scale)
            sheet_box = QRectF(card.left() + pad, sheet_box_y, sheet_box_w, sheet_box_h)

            raw_sheet = dict(sheet_blob.get("sheet") or {})
            sheet_w = max(100.0, float(sheet_blob.get("sheetWidth") or 1220.0))
            inner = QRectF(sheet_box)
            scale_by_width = max(0.01, inner.width() / max(1.0, visual_w))
            draw_w = inner.width()
            draw_h = visual_h * scale_by_width
            if draw_h > inner.height():
                # Fallback only when absolutely required by cell height constraints.
                scale_fit = max(0.01, min(inner.width() / max(1.0, visual_w), inner.height() / max(1.0, visual_h)))
                draw_w = visual_w * scale_fit
                draw_h = visual_h * scale_fit
                scale_by_width = scale_fit
            ox = inner.left() + (inner.width() - draw_w) * 0.5
            oy = inner.top() + (inner.height() - draw_h) * 0.5
            layout_rect = QRectF(ox, oy, draw_w, draw_h)
            painter.setPen(QPen(QColor("#000000"), max(1.0, 1.0 * ui_scale)))
            painter.setBrush(QColor("#FFFFFF"))
            painter.drawRect(layout_rect)

            draw_parts: list[dict] = []
            for part in (raw_sheet.get("parts") or []):
                if not isinstance(part, dict):
                    continue
                x = float(part.get("x") or 0.0)
                y = float(part.get("y") or 0.0)
                dw = float(part.get("drawWidth") or 0.0)
                dh = float(part.get("drawHeight") or 0.0)
                if dw <= 0 or dh <= 0:
                    continue
                vx = y
                vy = sheet_w - (x + dw)
                vw = dh
                vh = dw
                px = ox + vx * scale_by_width
                py = oy + vy * scale_by_width
                pw = vw * scale_by_width
                ph = vh * scale_by_width
                draw_parts.append(
                    {
                        "rect": QRectF(px, py, pw, ph),
                        "partName": str(part.get("partName") or "Part"),
                        "partType": str(part.get("partType") or ""),
                        "cncId": int(part.get("cncId") or 0),
                        "height": int(round(float(part.get("height") or 0.0))),
                        "width": int(round(float(part.get("width") or 0.0))),
                    }
                )
            draw_parts.sort(key=lambda p: (float(p["rect"].top()), float(p["rect"].left()), -float(p["rect"].height()), -float(p["rect"].width())))
            for idx, part in enumerate(draw_parts):
                part["id"] = idx + 1

            for part in draw_parts:
                prect = QRectF(part["rect"])
                fill, txt = self._part_type_style(str(part.get("partType") or ""))
                painter.setPen(QPen(QColor("#000000"), max(1.0, 1.0 * ui_scale)))
                painter.setBrush(QColor(fill))
                painter.drawRect(prect)
                pid_val = int(part.get("cncId") or 0)
                pid = str(pid_val or "")
                if not pid:
                    continue
                painter.setPen(QPen(QColor(txt), 1))
                id_font = QFont(painter.font())
                id_font.setPointSizeF(max(3.3, 3.3 * ui_scale))
                id_font.setBold(True)
                painter.setFont(id_font)
                id_fm = painter.fontMetrics()
                text_w = float(id_fm.horizontalAdvance(pid))
                text_h = float(id_fm.height())
                if prect.width() > 18 and prect.height() > 12:
                    fits_horizontal = text_w <= max(2.0, prect.width() - (2.0 * ui_scale))
                    fits_vertical = text_w <= max(2.0, prect.height() - (2.0 * ui_scale))
                    if (not fits_horizontal) and fits_vertical:
                        painter.save()
                        cx = float(prect.center().x())
                        cy = float(prect.center().y())
                        painter.translate(cx, cy)
                        painter.rotate(-90.0)
                        rotated_rect = QRectF(-prect.height() * 0.5, -prect.width() * 0.5, prect.height(), prect.width())
                        painter.drawText(rotated_rect, int(Qt.AlignmentFlag.AlignCenter), pid)
                        painter.restore()
                    else:
                        painter.drawText(prect, int(Qt.AlignmentFlag.AlignCenter), pid)
                else:
                    painter.drawText(
                        QRectF(prect.left() + (1.0 * ui_scale), prect.top() + (1.0 * ui_scale), max(6.0 * ui_scale, prect.width() - (2.0 * ui_scale)), 9.0 * ui_scale),
                        int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop),
                        pid,
                    )

            if bool(sheet_blob.get("boardHasGrain")):
                grain_horizontal = float(sheet_blob.get("sheetHeight") or 0.0) >= float(sheet_blob.get("sheetWidth") or 0.0)
                _draw_grain_arrows_print(QRectF(layout_rect.left() + 2.0, layout_rect.top() + 2.0, max(1.0, layout_rect.width() - 4.0), max(1.0, layout_rect.height() - 4.0)), grain_horizontal)

            legend_area = QRectF(card.left() + pad, legend_top, card.width() - (pad * 2.0), card.bottom() - pad - legend_top)
            grouped_entries: dict[int, dict] = {}
            for part in draw_parts:
                pid = int(part.get("cncId") or 0)
                if pid <= 0:
                    continue
                name = str(part.get("partName") or "Part")
                h = int(part.get("height") or 0)
                w = int(part.get("width") or 0)
                size_txt = f"{h} x {w}" if h > 0 and w > 0 else "-"
                row = grouped_entries.get(pid)
                if not isinstance(row, dict):
                    grouped_entries[pid] = {"name": name, "size": size_txt, "count": 1}
                else:
                    row["count"] = int(row.get("count") or 0) + 1
            entries: list[str] = []
            for pid in sorted(grouped_entries.keys()):
                row = grouped_entries.get(pid) or {}
                name = str(row.get("name") or "Part")
                size_txt = str(row.get("size") or "-")
                count = int(row.get("count") or 0)
                count_txt = f" x{count}" if count > 1 else ""
                entries.append(f"{pid}. {name} ({size_txt}){count_txt}")

            legend_font = QFont(painter.font())
            legend_font.setPointSizeF(max(4.0, 4.0 * ui_scale))
            legend_font.setBold(False)
            painter.setFont(legend_font)
            legend_fm = painter.fontMetrics()
            list_top = legend_area.top() + (8.0 * ui_scale)
            avail_h = max(14.0 * ui_scale, legend_area.bottom() - list_top)
            line_h = max(7.6 * ui_scale, float(legend_fm.height()) + (0.6 * ui_scale))
            rows_per_col = max(1, int(avail_h // line_h))
            col_count = 2 if len(entries) > rows_per_col else 1
            col_gap = 10.0 * ui_scale
            col_w = (legend_area.width() - (col_gap * (col_count - 1))) / float(col_count)
            max_entries = rows_per_col * col_count
            overflow = max(0, len(entries) - max_entries)
            if overflow > 0 and max_entries > 0:
                entries = entries[: max_entries - 1] + [f"... +{overflow} more"]
            painter.setPen(QPen(QColor("#0F172A"), 1))
            for idx, text in enumerate(entries):
                c = idx // rows_per_col
                r = idx % rows_per_col
                tx = legend_area.left() + c * (col_w + col_gap)
                ty = list_top + r * line_h
                txt = legend_fm.elidedText(str(text), Qt.TextElideMode.ElideRight, int(max(10.0 * ui_scale, col_w - (2.0 * ui_scale))))
                painter.drawText(QRectF(tx, ty, col_w, line_h), int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter), txt)

        for i, sheet_blob in enumerate(sheets):
            if i > 0 and (i % slots_per_page) == 0:
                printer.newPage()
            slot = i % slots_per_page
            rr = slot // cols
            cc = slot % cols
            x = grid_left + (cc * (cell_w + gap_x))
            y = grid_top + (rr * (cell_h + gap_y))
            _draw_card(QRectF(x, y, cell_w, cell_h), sheet_blob)
        painter.end()

    def _show_skipped_details(self) -> None:
        if not self._skipped_counter:
            QMessageBox.information(self, "Skipped Parts", "No skipped parts.")
            return
        lines: list[str] = []
        for reason, count in sorted(self._skipped_counter.items(), key=lambda kv: (-int(kv[1]), str(kv[0]).lower())):
            lines.append(f"{count}x  {reason}")
        text = "\n".join(lines)
        QMessageBox.information(self, "Skipped Parts", text)



