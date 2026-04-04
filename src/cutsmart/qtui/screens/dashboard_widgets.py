from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QDrag, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QScrollArea,
    QSlider,
    QTableWidget,
    QVBoxLayout,
    QWidget,
)
class AvatarCropperWidget(QWidget):
    def __init__(self, source: QPixmap, parent: QWidget | None = None):
        super().__init__(parent)
        self._source = source
        self._zoom = 1.0
        self._drag_mode = ""
        self._last_mouse = QPointF()
        self._circle_center = QPointF(170, 150)
        self._circle_center_initialized = False
        self._circle_radius = 88.0
        self._offset = QPointF(0, 0)
        self._base_scale = 1.0
        self.setMinimumSize(340, 300)
        self.setMouseTracking(True)
        self._recalc_scale_and_offset()

    def _recalc_scale_and_offset(self) -> None:
        if self._source.isNull():
            return
        w = max(1.0, float(self.width()))
        h = max(1.0, float(self.height()))
        sw = max(1.0, float(self._source.width()))
        sh = max(1.0, float(self._source.height()))
        self._base_scale = max((self._circle_radius * 2.0) / sw, (self._circle_radius * 2.0) / sh, min(w / sw, h / sh))
        scale = self._base_scale * self._zoom
        draw_w = sw * scale
        draw_h = sh * scale
        self._offset = QPointF((w - draw_w) / 2.0, (h - draw_h) / 2.0)
        self._clamp_image_to_circle()
        self._clamp_circle_to_view()

    def _image_scale(self) -> float:
        return self._base_scale * self._zoom

    def _circle_rect(self) -> QRectF:
        r = self._circle_radius
        return QRectF(self._circle_center.x() - r, self._circle_center.y() - r, r * 2.0, r * 2.0)

    def _clamp_circle_to_view(self) -> None:
        r = self._circle_radius
        x = min(max(self._circle_center.x(), r + 4.0), max(r + 4.0, self.width() - r - 4.0))
        y = min(max(self._circle_center.y(), r + 4.0), max(r + 4.0, self.height() - r - 4.0))
        self._circle_center = QPointF(x, y)

    def _clamp_image_to_circle(self) -> None:
        if self._source.isNull():
            return
        scale = self._image_scale()
        draw_w = float(self._source.width()) * scale
        draw_h = float(self._source.height()) * scale
        circle = self._circle_rect()
        min_x = circle.right() - draw_w
        max_x = circle.left()
        min_y = circle.bottom() - draw_h
        max_y = circle.top()
        ox = min(max(self._offset.x(), min_x), max_x)
        oy = min(max(self._offset.y(), min_y), max_y)
        self._offset = QPointF(ox, oy)

    def set_zoom(self, zoom: float) -> None:
        z = max(1.0, min(4.0, float(zoom)))
        if abs(z - self._zoom) < 0.0001:
            return
        before_scale = self._image_scale()
        c = self._circle_center
        sx = (c.x() - self._offset.x()) / max(0.0001, before_scale)
        sy = (c.y() - self._offset.y()) / max(0.0001, before_scale)
        self._zoom = z
        after_scale = self._image_scale()
        self._offset = QPointF(c.x() - sx * after_scale, c.y() - sy * after_scale)
        self._clamp_image_to_circle()
        self.update()

    def paintEvent(self, event) -> None:
        _ = event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.fillRect(self.rect(), QColor("#0F1116"))
        if not self._source.isNull():
            scale = self._image_scale()
            draw_w = int(float(self._source.width()) * scale)
            draw_h = int(float(self._source.height()) * scale)
            painter.drawPixmap(int(self._offset.x()), int(self._offset.y()), draw_w, draw_h, self._source)

        path_full = QPainterPath()
        path_full.addRect(QRectF(self.rect()))
        path_circle = QPainterPath()
        path_circle.addEllipse(self._circle_rect())
        painter.fillPath(path_full.subtracted(path_circle), QColor(0, 0, 0, 150))
        painter.setPen(QPen(QColor("#FFFFFF"), 2))
        painter.drawEllipse(self._circle_rect())

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if not self._circle_center_initialized:
            self._circle_center = QPointF(float(self.width()) / 2.0, float(self.height()) / 2.0)
            self._circle_center_initialized = True
        self._clamp_circle_to_view()
        self._clamp_image_to_circle()
        self.update()

    def wheelEvent(self, event) -> None:
        delta = event.angleDelta().y()
        if delta == 0:
            return
        step = 0.1 if delta > 0 else -0.1
        self.set_zoom(self._zoom + step)
        event.accept()

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._last_mouse = QPointF(event.position())
            # Move image by default so users can reposition photos naturally.
            # Hold Shift to move the crop circle instead.
            if bool(event.modifiers() & Qt.KeyboardModifier.ShiftModifier):
                self._drag_mode = "circle"
            else:
                self._drag_mode = "image"
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if not self._drag_mode:
            super().mouseMoveEvent(event)
            return
        pos = QPointF(event.position())
        delta = pos - self._last_mouse
        self._last_mouse = pos
        if self._drag_mode == "circle":
            self._circle_center = QPointF(self._circle_center.x() + delta.x(), self._circle_center.y() + delta.y())
            self._clamp_circle_to_view()
        else:
            self._offset = QPointF(self._offset.x() + delta.x(), self._offset.y() + delta.y())
        self._clamp_image_to_circle()
        self.update()
        event.accept()

    def mouseReleaseEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_mode = ""
            event.accept()
            return
        super().mouseReleaseEvent(event)

    def cropped_circle(self, output_size: int = 512) -> QPixmap:
        size = max(64, int(output_size))
        out = QPixmap(size, size)
        out.fill(Qt.GlobalColor.transparent)
        if self._source.isNull():
            return out
        scale = self._image_scale()
        circle = self._circle_rect()
        src_rect = QRectF(
            (circle.left() - self._offset.x()) / max(0.0001, scale),
            (circle.top() - self._offset.y()) / max(0.0001, scale),
            (circle.width()) / max(0.0001, scale),
            (circle.height()) / max(0.0001, scale),
        )
        p = QPainter(out)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        clip = QPainterPath()
        clip.addEllipse(QRectF(0, 0, size, size))
        p.setClipPath(clip)
        p.drawPixmap(QRectF(0, 0, size, size), self._source, src_rect)
        p.end()
        return out


class AvatarCropDialog(QDialog):
    def __init__(self, source_path: str, parent: QWidget | None = None):
        super().__init__(parent)
        self.setWindowTitle("Crop Profile Photo")
        self.setModal(True)
        self.resize(460, 500)
        self._result_pixmap = QPixmap()

        pix = QPixmap(str(source_path or ""))
        if pix.isNull():
            raise ValueError("Unable to load image.")

        root = QVBoxLayout(self)
        root.setContentsMargins(14, 12, 14, 12)
        root.setSpacing(10)

        helper = QLabel("Drag to reposition photo. Hold Shift and drag to move crop circle. Scroll or use zoom slider.")
        helper.setStyleSheet("color: #6B7280; font-size: 12px;")
        root.addWidget(helper)

        self._cropper = AvatarCropperWidget(pix)
        root.addWidget(self._cropper, stretch=1)

        zoom_row = QHBoxLayout()
        zoom_row.addWidget(QLabel("Zoom"))
        self._zoom_slider = QSlider(Qt.Orientation.Horizontal)
        self._zoom_slider.setRange(100, 400)
        self._zoom_slider.setValue(100)
        self._zoom_slider.valueChanged.connect(lambda v: self._cropper.set_zoom(v / 100.0))
        zoom_row.addWidget(self._zoom_slider, stretch=1)
        root.addLayout(zoom_row)

        btns = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
        btns.button(QDialogButtonBox.StandardButton.Ok).setText("Use Photo")
        btns.accepted.connect(self._accept_crop)
        btns.rejected.connect(self.reject)
        root.addWidget(btns)

    def _accept_crop(self) -> None:
        self._result_pixmap = self._cropper.cropped_circle(512)
        if self._result_pixmap.isNull():
            QMessageBox.warning(self, "Crop", "Could not crop this image.")
            return
        self.accept()

    @property
    def result_pixmap(self) -> QPixmap:
        return self._result_pixmap


class HoverProjectRowCard(QFrame):
    def __init__(self, theme_color: str, dark_mode: bool = False, on_hover_change=None, on_click=None, parent: QWidget | None = None):
        super().__init__(parent)
        self._theme_color = str(theme_color or "#2F6BFF")
        if dark_mode:
            self._normal_bg = "#11161D"
            self._normal_border = "#2A3240"
            self._hover_bg = "#171E28"
        else:
            self._normal_bg = "#F5F7FA"
            self._normal_border = "#E4E6EC"
            self._hover_bg = "#F8FBFF"
        self._on_hover_change = on_hover_change
        self._on_click = on_click
        self.setAttribute(Qt.WidgetAttribute.WA_Hover, True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setObjectName("ProjectRowCard")
        self._apply_normal_style()

    def _apply_normal_style(self) -> None:
        self.setGraphicsEffect(None)
        self.setStyleSheet(
            "QFrame#ProjectRowCard {"
            f"background: {self._normal_bg}; border: 1px solid {self._normal_border}; border-radius: 12px;"
            "}"
        )

    def _apply_hover_style(self) -> None:
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(6)
        shadow.setOffset(0, 1)
        shadow.setColor(QColor(15, 23, 42, 22))
        self.setGraphicsEffect(shadow)
        self.setStyleSheet(
            "QFrame#ProjectRowCard {"
            f"background: {self._hover_bg}; border: 1px solid {self._theme_color}; border-radius: 12px;"
            "}"
        )

    def enterEvent(self, event) -> None:
        self._apply_hover_style()
        if callable(self._on_hover_change):
            self._on_hover_change(True)
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        self._apply_normal_style()
        if callable(self._on_hover_change):
            self._on_hover_change(False)
        super().leaveEvent(event)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton and callable(self._on_click):
            self._on_click()
            event.accept()
            return
        super().mousePressEvent(event)


class RolePermissionsDialog(QDialog):
    def __init__(
        self,
        permission_keys: list[str],
        current: dict[str, bool] | None = None,
        labels: dict[str, str] | None = None,
        role_name: str = "",
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle("Role Permissions")
        self.setModal(True)
        self.resize(460, 520)
        self._checks: dict[str, QCheckBox] = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(14, 12, 14, 12)
        root.setSpacing(10)

        role_label = str(role_name or "").strip()
        title_text = f"Editing Role: {role_label}" if role_label else "Choose permissions for this role"
        title = QLabel(title_text)
        title.setStyleSheet("color: #101827; font-size: 14px; font-weight: 700;")
        root.addWidget(title)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        host = QWidget()
        host_layout = QVBoxLayout(host)
        host_layout.setContentsMargins(0, 0, 0, 0)
        host_layout.setSpacing(6)

        current_map = dict(current or {})
        label_map = dict(labels or {})
        for key in permission_keys:
            nice = str(label_map.get(key) or key).strip()
            cb = QCheckBox(nice)
            cb.setChecked(bool(current_map.get(key, False)))
            cb.setStyleSheet("QCheckBox { color: #374151; font-size: 12px; font-weight: 600; }")
            host_layout.addWidget(cb)
            self._checks[key] = cb
        host_layout.addStretch(1)
        scroll.setWidget(host)
        root.addWidget(scroll, stretch=1)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Apply")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        root.addWidget(buttons)

    def selected_permissions(self) -> dict[str, bool]:
        return {key: bool(cb.isChecked()) for key, cb in self._checks.items()}


class ReorderableTableWidget(QTableWidget):
    rows_reordered = Signal()

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._drop_line_y = -1
        self._drop_line_color = QColor("#2F6BFF")

    def set_drop_indicator_color(self, color_hex: str) -> None:
        color = QColor(str(color_hex or "").strip())
        if color.isValid():
            self._drop_line_color = color
            self.viewport().update()

    def _clear_drop_line(self) -> None:
        if self._drop_line_y != -1:
            self._drop_line_y = -1
            self.viewport().update()

    def _update_drop_line_from_pos(self, pos) -> None:
        idx = self.indexAt(pos)
        if not idx.isValid():
            self._drop_line_y = max(0, self.viewport().height() - 2)
            return
        rect = self.visualRect(idx)
        if pos.y() < rect.center().y():
            self._drop_line_y = rect.top()
        else:
            self._drop_line_y = rect.bottom() + 1

    def startDrag(self, supportedActions) -> None:
        indexes = self.selectedIndexes()
        if not indexes:
            return
        drag = QDrag(self)
        mime = self.model().mimeData(indexes)
        if mime is None:
            return
        drag.setMimeData(mime)
        ghost = QPixmap(1, 1)
        ghost.fill(Qt.GlobalColor.transparent)
        drag.setPixmap(ghost)
        drag.exec(supportedActions, Qt.DropAction.MoveAction)

    def dragEnterEvent(self, event) -> None:
        super().dragEnterEvent(event)
        self._update_drop_line_from_pos(event.position().toPoint())
        self.viewport().update()

    def dragMoveEvent(self, event) -> None:
        super().dragMoveEvent(event)
        self._update_drop_line_from_pos(event.position().toPoint())
        self.viewport().update()

    def dragLeaveEvent(self, event) -> None:
        super().dragLeaveEvent(event)
        self._clear_drop_line()

    def dropEvent(self, event) -> None:
        super().dropEvent(event)
        self._clear_drop_line()
        self.rows_reordered.emit()

    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        if self._drop_line_y < 0:
            return
        painter = QPainter(self.viewport())
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        pen = QPen(self._drop_line_color, 2)
        painter.setPen(pen)
        y = max(1, min(self.viewport().height() - 2, int(self._drop_line_y)))
        painter.drawLine(2, y, self.viewport().width() - 3, y)
        painter.end()



