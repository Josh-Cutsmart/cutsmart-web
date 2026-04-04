from __future__ import annotations

from PySide6.QtCore import QModelIndex, Qt
from PySide6.QtGui import QBrush, QColor, QPainter
from PySide6.QtWidgets import QComboBox, QStyle, QStyledItemDelegate
class VComboBox(QComboBox):
    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        if bool(self.property("hideArrow")):
            return
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


class PartTypeOptionDelegate(QStyledItemDelegate):
    def paint(self, painter: QPainter, option, index: QModelIndex) -> None:
        painter.save()
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



