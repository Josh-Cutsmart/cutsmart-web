from __future__ import annotations

import json
import re

from PySide6.QtCore import QRectF, Qt, QTimer
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QCheckBox, QDialog, QDialogButtonBox, QFrame, QGraphicsBlurEffect, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPushButton, QSizePolicy, QVBoxLayout, QWidget
from cutsmart.ui.style import ACCENT


class AnimatedOutlineButton(QPushButton):
    def __init__(self, text: str = "", parent: QWidget | None = None) -> None:
        super().__init__(text, parent)
        self._outline_progress = 0.0
        self._outline_target = 0.0
        self._outline_duration_ms = 150
        self._outline_tick_ms = 16
        self._outline_color = QColor("#2F6BFF")
        self._outline_timer = QTimer(self)
        self._outline_timer.setInterval(self._outline_tick_ms)
        self._outline_timer.timeout.connect(self._step_outline_animation)

    def set_outline_color(self, color: QColor) -> None:
        self._outline_color = QColor(color)
        self.update()

    def set_outline_duration_ms(self, ms: int) -> None:
        self._outline_duration_ms = max(80, int(ms or 150))

    def enterEvent(self, event) -> None:
        self._outline_target = 1.0
        if not self._outline_timer.isActive():
            self._outline_timer.start()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        self._outline_target = 0.0
        if not self._outline_timer.isActive():
            self._outline_timer.start()
        super().leaveEvent(event)

    def _step_outline_animation(self) -> None:
        step = max(0.001, float(self._outline_tick_ms) / float(self._outline_duration_ms))
        if self._outline_progress < self._outline_target:
            self._outline_progress = min(self._outline_target, self._outline_progress + step)
        elif self._outline_progress > self._outline_target:
            self._outline_progress = max(self._outline_target, self._outline_progress - step)
        else:
            self._outline_timer.stop()
        self.update()

    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        if self._outline_progress <= 0.0:
            return
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        pen = QPen(self._outline_color)
        pen.setWidth(1)
        painter.setPen(pen)
        rect = QRectF(self.rect()).adjusted(0.5, 0.5, -0.5, -0.5)
        if rect.width() <= 2 or rect.height() <= 2:
            return
        radius = 8.0
        border_path = QPainterPath()
        border_path.addRoundedRect(rect, radius, radius)
        # Draw two moving traces so the animation grows across top and bottom.
        self._draw_path_segment(painter, border_path, 0.00, 0.50 * self._outline_progress)
        self._draw_path_segment(painter, border_path, 0.50, 0.50 * self._outline_progress)

    def _draw_path_segment(self, painter: QPainter, path: QPainterPath, start: float, span: float) -> None:
        span = max(0.0, min(1.0, float(span)))
        if span <= 0.0:
            return
        steps = max(12, int(220 * span))

        def _draw_range(a: float, b: float, n: int) -> None:
            seg = QPainterPath()
            first = path.pointAtPercent(a)
            seg.moveTo(first)
            for i in range(1, n + 1):
                t = a + ((b - a) * (float(i) / float(n)))
                seg.lineTo(path.pointAtPercent(t))
            painter.drawPath(seg)

        end = start + span
        if end <= 1.0:
            _draw_range(start, end, steps)
        else:
            left_span = 1.0 - start
            left_steps = max(4, int(steps * (left_span / span)))
            _draw_range(start, 1.0, left_steps)
            _draw_range(0.0, end - 1.0, max(4, steps - left_steps))


class SalesRoomsMixin:
    _JOB_TYPE_OPTIONS = ["Melteca", "Woodgrain", "Lacquer (1 sided)", "Lacquer (2 sided)"]

    def _apply_sales_room_included_style(self, cb: QCheckBox, theme: str) -> None:
        if not isinstance(cb, QCheckBox):
            return
        is_on = bool(cb.isChecked())
        text_color = "#7BCB90" if is_on else "#D14343"
        cb.setText("Yes" if is_on else "No")
        cb.setStyleSheet(
            f"QCheckBox {{ color:{text_color}; font-size:12px; font-weight:700; spacing:4px; }}"
            "QCheckBox::indicator { width:14px; height:14px; }"
        )

    def _on_sales_room_included_toggled(self, use_dashboard: bool, cb: QCheckBox) -> None:
        theme = self._sales_theme_hex()
        self._apply_sales_room_included_style(cb, theme)
        self._save_sales_rooms_from_panel(use_dashboard)

    def _sales_theme_hex(self) -> str:
        return self._normalize_hex(str((self._company or {}).get("themeColor") or ACCENT), ACCENT)

    def _company_sales_job_type_names(self) -> list[str]:
        try:
            rows = self._company_sales_job_type_rows()
        except Exception:
            rows = []
        out = [str(r.get("name") or "").strip() for r in rows if isinstance(r, dict)]
        out = [v for v in out if v]
        return out or list(self._JOB_TYPE_OPTIONS)

    def _project_cutlist_payload(self, raw: dict | None) -> dict:
        payload = (raw or {}).get("cutlist")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = None
        if not isinstance(payload, dict):
            payload = {}
        legacy = (raw or {}).get("cutlistJson")
        if isinstance(legacy, str) and legacy.strip():
            try:
                legacy_payload = json.loads(legacy)
            except Exception:
                legacy_payload = None
            if isinstance(legacy_payload, dict):
                merged = dict(legacy_payload)
                merged.update(payload)
                payload = merged
        return dict(payload or {})

    def _project_cutlist_rooms(self, raw: dict | None) -> list[str]:
        payload = self._project_cutlist_payload(raw)
        out: list[str] = []
        seen: set[str] = set()

        def _add(v: str) -> None:
            txt = str(v or "").strip()
            if not txt:
                return
            key = " ".join(txt.lower().split())
            if not key or key in seen or key == "all":
                return
            seen.add(key)
            out.append(txt)

        for room in (payload.get("rooms") or []):
            _add(str(room or ""))
        for row in (payload.get("rows") or []):
            if isinstance(row, dict):
                _add(str(row.get("room") or ""))
        for row in (payload.get("entryDraftRows") or []):
            if isinstance(row, dict):
                _add(str(row.get("room") or ""))
        return sorted(out, key=lambda x: " ".join(str(x or "").lower().split()))

    def _project_cutlist_seen_piece_rooms(self, raw: dict | None) -> list[str]:
        payload = self._project_cutlist_payload(raw)
        out: list[str] = []
        seen: set[str] = set()
        for token in (payload.get("roomsWithPieces") or []):
            key = " ".join(str(token or "").strip().lower().split())
            if key and key != "all" and key not in seen:
                seen.add(key)
                out.append(key)
        for row in (payload.get("rows") or []):
            if not isinstance(row, dict):
                continue
            key = " ".join(str(row.get("room") or "").strip().lower().split())
            if key and key != "all" and key not in seen:
                seen.add(key)
                out.append(key)
        return sorted(out)

    def _save_project_cutlist_payload(self, raw: dict | None, payload: dict) -> bool:
        merged = self._project_cutlist_payload(raw)
        merged.update(dict(payload or {}))
        return self._save_project_patch({"cutlist": merged, "cutlistJson": json.dumps(merged)})

    def _sales_rooms_state(self, use_dashboard: bool) -> tuple[QVBoxLayout | None, QPushButton | None]:
        if use_dashboard:
            return self._dashboard_sales_rooms_list_layout, self._dashboard_sales_rooms_add_btn
        return self._detail_sales_rooms_list_layout, self._detail_sales_rooms_add_btn

    def _sales_job_type_state(self, use_dashboard: bool) -> dict[str, QCheckBox]:
        if use_dashboard:
            state = getattr(self, "_dashboard_sales_job_type_checks", None)
        else:
            state = getattr(self, "_detail_sales_job_type_checks", None)
        return state if isinstance(state, dict) else {}

    def _sales_job_type_layout(self, use_dashboard: bool):
        if use_dashboard:
            return getattr(self, "_dashboard_sales_job_type_layout", None)
        return getattr(self, "_detail_sales_job_type_layout", None)

    def _sales_quote_extras_state(self, use_dashboard: bool) -> QVBoxLayout | None:
        if use_dashboard:
            layout = getattr(self, "_dashboard_sales_quote_extras_list_layout", None)
        else:
            layout = getattr(self, "_detail_sales_quote_extras_list_layout", None)
        return layout if isinstance(layout, QVBoxLayout) else None

    def _can_edit_project_payload(self, raw: dict | None) -> bool:
        if not isinstance(raw, dict):
            return False
        level_fn = getattr(self, "_project_user_access_level", None)
        if callable(level_fn):
            try:
                return str(level_fn(raw)) == "edit"
            except Exception:
                return False
        return True

    def _company_quote_extras_rows(self) -> list[dict]:
        raw = (self._company or {}).get("quoteExtras")
        if not isinstance(raw, list):
            raw = []
        out: list[dict] = []
        seen: set[str] = set()
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            key = " ".join(name.lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            price = str(row.get("price") or "").strip()
            container_id = str(row.get("templateContainerId") or "").strip()
            placeholder_key = str(row.get("templatePlaceholderKey") or "").strip().strip("{} ")
            default_included = bool(row.get("defaultIncluded") or row.get("default"))
            out.append(
                {
                    "name": name,
                    "price": price,
                    "templateContainerId": container_id,
                    "templatePlaceholderKey": placeholder_key,
                    "defaultIncluded": default_included,
                }
            )
        return out

    def _project_sales_rooms(self, raw: dict | None) -> list[dict]:
        payload = self._project_sales_payload(raw) if hasattr(self, "_project_sales_payload") else {}
        rows = payload.get("rooms")
        computed_totals = self._sales_room_total_prices_from_initial_measure(raw)
        out: list[dict] = []
        seen: set[str] = set()
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    name = str(row.get("name") or "").strip()
                    included = bool(row.get("included", True))
                else:
                    name = str(row or "").strip()
                    included = True
                if not name:
                    continue
                key = " ".join(name.lower().split())
                if key in seen or key == "all":
                    continue
                seen.add(key)
                total = float(computed_totals.get(key) or 0.0)
                out.append({"name": name, "totalPrice": f"{total:.2f}", "included": included})
        if not out:
            for name in self._project_cutlist_rooms(raw):
                key = " ".join(str(name or "").strip().lower().split())
                if not key or key in seen or key == "all":
                    continue
                seen.add(key)
                total = float(computed_totals.get(key) or 0.0)
                out.append({"name": str(name or "").strip(), "totalPrice": f"{total:.2f}", "included": True})
        return out

    def _refresh_sales_rooms_panel(self, use_dashboard: bool, raw: dict | None) -> None:
        theme = self._sales_theme_hex()
        theme_soft = QColor(theme).lighter(190).name()
        theme_soft_border = QColor(theme).lighter(170).name()
        can_edit = self._can_edit_project_payload(raw)
        layout, add_btn = self._sales_rooms_state(use_dashboard)
        top_add_btn = getattr(self, "_dashboard_sales_rooms_add_top_btn", None) if use_dashboard else getattr(self, "_detail_sales_rooms_add_top_btn", None)
        total_label = getattr(self, "_dashboard_sales_rooms_total_label", None) if use_dashboard else getattr(self, "_detail_sales_rooms_total_label", None)
        if isinstance(add_btn, QPushButton):
            add_btn.setEnabled(bool(can_edit))
            add_btn.setFixedHeight(32)
            add_btn.setStyleSheet(
                "QPushButton { "
                f"background: {theme_soft}; color: {theme}; border: none; "
                "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
                "QPushButton:hover { background: #E3ECFA; }"
            )
            if isinstance(add_btn, AnimatedOutlineButton):
                add_btn.set_outline_color(QColor(theme))
                add_btn.set_outline_duration_ms(150)
        if isinstance(top_add_btn, QPushButton):
            top_add_btn.setEnabled(bool(can_edit))
            top_add_btn.setFixedHeight(24)
            top_add_btn.setStyleSheet(
                "QPushButton { "
                f"background: {theme_soft}; color: {theme}; border: none; "
                "border-radius: 8px; padding: 2px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
                "QPushButton:hover { background: #E3ECFA; }"
            )
            if isinstance(top_add_btn, AnimatedOutlineButton):
                top_add_btn.set_outline_color(QColor(theme))
                top_add_btn.set_outline_duration_ms(150)
        if not isinstance(layout, QVBoxLayout):
            return
        while layout.count():
            item = layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        rooms = self._project_sales_rooms(raw)
        included_total = 0.0
        for row_data in rooms:
            if bool(row_data.get("included", True)):
                try:
                    included_total += float(str(row_data.get("totalPrice") or "0").strip() or 0.0)
                except Exception:
                    pass
        if isinstance(total_label, QLabel):
            total_label.setText(f"Total  ${included_total:,.2f}")
            total_label.setStyleSheet(
                f"QLabel {{ color:{theme}; font-size:26px; font-weight:800; }}"
            )
        if not rooms:
            hint = QLabel("No rooms yet. Add rooms below.")
            hint.setStyleSheet("QLabel { color: #64748B; font-size: 12px; }")
            layout.addWidget(hint)
            return
        for row_data in rooms:
            room = str(row_data.get("name") or "").strip()
            total_price = str(row_data.get("totalPrice") or "").strip()
            try:
                total_price_disp = f"${float(total_price):,.2f}"
            except Exception:
                total_price_disp = f"${total_price}" if total_price else "$0.00"
            included = bool(row_data.get("included", True))
            row = QWidget()
            row.setObjectName("salesRoomRow")
            row.setStyleSheet("QWidget#salesRoomRow { border-bottom: 1px solid #DDE4EE; }")
            rl = QHBoxLayout(row)
            rl.setContentsMargins(0, 8, 0, 8)
            rl.setSpacing(6)

            edit = QLineEdit(room)
            edit.setObjectName("salesRoomName")
            edit.setFixedHeight(28)
            edit.setReadOnly(not can_edit)
            edit.setCursor(Qt.CursorShape.IBeamCursor if can_edit else Qt.CursorShape.ArrowCursor)
            edit.setStyleSheet("QLineEdit { background:transparent; border:none; color:#0F172A; padding:0; font-size:12px; font-weight:600; }")

            total_edit = QLineEdit(total_price_disp)
            total_edit.setObjectName("salesRoomTotal")
            total_edit.setPlaceholderText("0.00")
            total_edit.setFixedHeight(28)
            total_edit.setReadOnly(True)
            total_edit.setEnabled(True)
            total_edit.setFrame(False)
            total_edit.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            total_edit.setMinimumWidth(96)
            total_edit.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            total_edit.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            total_edit.setStyleSheet("QLineEdit { background:transparent; color:#0F172A; border:none; padding:0; font-size:12px; font-weight:600; font-style: italic; }")

            include_cb = QCheckBox("Yes")
            include_cb.setObjectName("salesRoomIncluded")
            include_cb.setChecked(included)
            include_cb.setFixedWidth(66)
            include_cb.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            include_cb.setCursor(Qt.CursorShape.PointingHandCursor)
            include_cb.setEnabled(bool(can_edit))
            self._apply_sales_room_included_style(include_cb, theme)

            del_btn = QPushButton("X")
            del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            del_btn.setFixedSize(24, 24)
            del_btn.setEnabled(bool(can_edit))
            del_btn.setStyleSheet(
                "QPushButton { color:#B42318; background:#FDECEC; border:1px solid #F5C2C7; border-radius:8px; font-size:11px; font-weight:700; padding:0; }"
                "QPushButton:hover { background:#FBD5DA; }"
            )
            edit.editingFinished.connect(lambda u=use_dashboard: self._save_sales_rooms_from_panel(u))
            include_cb.toggled.connect(lambda _=False, u=use_dashboard, c=include_cb: self._on_sales_room_included_toggled(u, c))
            del_btn.clicked.connect(lambda _=False, u=use_dashboard, host=row: self._delete_sales_room_row(u, host))
            rl.addWidget(del_btn, 0)
            rl.addWidget(edit, 2)
            rl.addWidget(total_edit, 1)
            rl.addWidget(include_cb, 1, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            layout.addWidget(row)

    def _collect_sales_rooms_from_panel(self, use_dashboard: bool) -> list[dict]:
        layout, _btn = self._sales_rooms_state(use_dashboard)
        if not isinstance(layout, QVBoxLayout):
            return []
        out: list[dict] = []
        seen: set[str] = set()
        for i in range(layout.count()):
            item = layout.itemAt(i)
            w = item.widget()
            if not isinstance(w, QWidget):
                continue
            edit = w.findChild(QLineEdit, "salesRoomName")
            if not isinstance(edit, QLineEdit):
                continue
            txt = str(edit.text() or "").strip()
            if not txt:
                continue
            key = " ".join(txt.lower().split())
            if key and key not in seen and key != "all":
                seen.add(key)
                include_cb = w.findChild(QCheckBox, "salesRoomIncluded")
                out.append(
                    {
                        "name": txt,
                        "included": bool(include_cb.isChecked()) if isinstance(include_cb, QCheckBox) else True,
                    }
                )
        return out

    def _save_sales_rooms_from_panel(self, use_dashboard: bool) -> None:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            return
        if not self._can_edit_project_payload(raw):
            return
        room_rows = self._collect_sales_rooms_from_panel(use_dashboard)
        totals = self._sales_room_total_prices_from_initial_measure(raw)
        merged_rows = []
        for row in room_rows:
            name = str((row or {}).get("name") or "").strip()
            key = " ".join(name.lower().split())
            total = float(totals.get(key) or 0.0)
            merged_rows.append(
                {
                    "name": name,
                    "included": bool((row or {}).get("included", True)),
                    "totalPrice": f"{total:.2f}",
                }
            )
        room_names = [str(r.get("name") or "").strip() for r in room_rows if isinstance(r, dict)]
        if not self._save_project_cutlist_payload(raw, {"rooms": room_names}):
            return
        if hasattr(self, "_save_project_sales_payload"):
            self._save_project_sales_payload(raw, {"rooms": merged_rows})
        updated = self._selected_project()
        self._refresh_sales_rooms_panel(True, updated)
        self._refresh_sales_rooms_panel(False, updated)

    def _add_sales_room_row(self, use_dashboard: bool) -> None:
        raw = self._selected_project()
        if not self._can_edit_project_payload(raw):
            return
        theme = self._sales_theme_hex()
        layout, _btn = self._sales_rooms_state(use_dashboard)
        if not isinstance(layout, QVBoxLayout):
            return
        row = QWidget()
        row.setObjectName("salesRoomRow")
        row.setStyleSheet("QWidget#salesRoomRow { border-bottom: 1px solid #DDE4EE; }")
        rl = QHBoxLayout(row)
        rl.setContentsMargins(0, 8, 0, 8)
        rl.setSpacing(6)
        edit = QLineEdit("")
        edit.setObjectName("salesRoomName")
        edit.setPlaceholderText("Room name")
        edit.setFixedHeight(28)
        edit.setStyleSheet("QLineEdit { background:transparent; border:none; color:#0F172A; padding:0; font-size:12px; font-weight:600; }")

        total_edit = QLineEdit("")
        total_edit.setObjectName("salesRoomTotal")
        total_edit.setPlaceholderText("0.00")
        total_edit.setFixedHeight(28)
        total_edit.setReadOnly(True)
        total_edit.setEnabled(True)
        total_edit.setFrame(False)
        total_edit.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        total_edit.setMinimumWidth(96)
        total_edit.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        total_edit.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        total_edit.setStyleSheet("QLineEdit { background:transparent; color:#0F172A; border:none; padding:0; font-size:12px; font-weight:600; font-style: italic; }")

        include_cb = QCheckBox("Yes")
        include_cb.setObjectName("salesRoomIncluded")
        include_cb.setChecked(True)
        include_cb.setFixedWidth(66)
        include_cb.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
        include_cb.setCursor(Qt.CursorShape.PointingHandCursor)
        self._apply_sales_room_included_style(include_cb, theme)

        del_btn = QPushButton("X")
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setFixedSize(24, 24)
        del_btn.setStyleSheet(
            "QPushButton { color:#B42318; background:#FDECEC; border:1px solid #F5C2C7; border-radius:8px; font-size:11px; font-weight:700; padding:0; }"
            "QPushButton:hover { background:#FBD5DA; }"
        )
        edit.editingFinished.connect(lambda u=use_dashboard: self._save_sales_rooms_from_panel(u))
        include_cb.toggled.connect(lambda _=False, u=use_dashboard, c=include_cb: self._on_sales_room_included_toggled(u, c))
        del_btn.clicked.connect(lambda _=False, u=use_dashboard, host=row: self._delete_sales_room_row(u, host))
        rl.addWidget(del_btn, 0)
        rl.addWidget(edit, 2)
        rl.addWidget(total_edit, 1)
        rl.addWidget(include_cb, 1, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        layout.addWidget(row)
        edit.setFocus()

    def _delete_sales_room_row(self, use_dashboard: bool, row_widget: QWidget) -> None:
        raw = self._selected_project()
        if not self._can_edit_project_payload(raw):
            return
        layout, _btn = self._sales_rooms_state(use_dashboard)
        if not isinstance(layout, QVBoxLayout) or not isinstance(row_widget, QWidget):
            return
        edit = row_widget.findChild(QLineEdit, "salesRoomName")
        room_name = str(edit.text() or "").strip() if isinstance(edit, QLineEdit) else ""
        had_name = bool(room_name)
        if had_name:
            pieces_count = self._sales_room_initial_measure_piece_count(room_name)
            items_count = self._sales_room_items_count(room_name)
            if int(max(0, pieces_count)) > 0:
                action = self._show_room_delete_blocked_dialog(room_name)
                if action == "exclude_from_quote":
                    include_cb = row_widget.findChild(QCheckBox, "salesRoomIncluded")
                    if isinstance(include_cb, QCheckBox):
                        include_cb.setChecked(False)
                    self._save_sales_rooms_from_panel(use_dashboard)
                return
            action = self._confirm_sales_room_delete(room_name, pieces_count, items_count)
            if action == "cancel":
                return
            if action == "quote_only":
                include_cb = row_widget.findChild(QCheckBox, "salesRoomIncluded")
                if isinstance(include_cb, QCheckBox):
                    include_cb.setChecked(False)
                self._save_sales_rooms_from_panel(use_dashboard)
                return
        row_widget.setParent(None)
        row_widget.deleteLater()
        if had_name:
            self._save_sales_rooms_from_panel(use_dashboard)

    def _sales_room_initial_measure_piece_count(self, room_name: str) -> int:
        raw = self._selected_project() if hasattr(self, "_selected_project") else None
        payload = self._project_sales_payload(raw) if hasattr(self, "_project_sales_payload") and isinstance(raw, dict) else {}
        cut = payload.get("initialMeasureCutlist") if isinstance(payload, dict) else {}
        rows = cut.get("rows") if isinstance(cut, dict) and isinstance(cut.get("rows"), list) else []
        room_key = " ".join(str(room_name or "").strip().lower().split())
        total = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            r_key = " ".join(str(row.get("room") or "").strip().lower().split())
            if room_key and room_key != r_key:
                continue
            qty_raw = str(row.get("quantity") or row.get("qty") or "1").strip()
            try:
                qty = int(float(qty_raw))
            except Exception:
                qty = 1
            total += max(1, qty)
        return int(total)

    def _sales_room_items_count(self, room_name: str) -> int:
        raw = self._selected_project() if hasattr(self, "_selected_project") else None
        payload = self._project_sales_payload(raw) if hasattr(self, "_project_sales_payload") and isinstance(raw, dict) else {}
        items = payload.get("items") if isinstance(payload, dict) and isinstance(payload.get("items"), list) else []
        room_key = " ".join(str(room_name or "").strip().lower().split())
        total = 0
        for row in items:
            if not isinstance(row, dict):
                continue
            r_key = " ".join(str(row.get("room") or "").strip().lower().split())
            if room_key and room_key != r_key:
                continue
            qty_raw = str(row.get("quantity") or row.get("qty") or "1").strip()
            try:
                qty = int(float(qty_raw))
            except Exception:
                qty = 1
            total += max(1, qty)
        return int(total)

    def _confirm_sales_room_delete(self, room_name: str, pieces_count: int, items_count: int) -> str:
        raw = self._selected_project() if hasattr(self, "_selected_project") else None
        job_name = str((raw or {}).get("name") or "Project").strip() if isinstance(raw, dict) else "Project"
        theme = self._sales_theme_hex() if hasattr(self, "_sales_theme_hex") else ACCENT
        host = self.window() if isinstance(self.window(), QWidget) else self
        overlay = None
        prev_effect = None
        blur_fx = None
        try:
            if isinstance(host, QWidget):
                prev_effect = host.graphicsEffect()
                blur_fx = QGraphicsBlurEffect(host)
                blur_fx.setBlurRadius(5.0)
                host.setGraphicsEffect(blur_fx)
                overlay = QWidget(host)
                overlay.setObjectName("confirmDeleteOverlay")
                overlay.setStyleSheet("QWidget#confirmDeleteOverlay { background: rgba(15, 23, 42, 92); }")
                overlay.setGeometry(host.rect())
                overlay.show()
                overlay.raise_()
        except Exception:
            overlay = None

        dlg = QDialog(host if isinstance(host, QWidget) else None)
        dlg.setModal(True)
        dlg.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        dlg.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        dlg.setFixedWidth(560)
        dlg.setStyleSheet(
            "QDialog { background: transparent; border: none; }"
            "QFrame#confirmDeleteCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            f"QPushButton#quoteOnlyBtn {{ background:{theme}; color:#FFFFFF; border:1px solid {theme}; }}"
            f"QPushButton#quoteOnlyBtn:hover {{ background:{QColor(theme).darker(112).name()}; border:1px solid {QColor(theme).darker(112).name()}; }}"
            "QPushButton#confirmBtn { background:#FDECEC; color:#B42318; border:1px solid #F5C2C7; }"
            "QPushButton#confirmBtn:hover { background:#FBD5DA; }"
            "QPushButton#cancelBtn { background:#FFFFFF; color:#334155; border:1px solid #D4DAE6; }"
            "QPushButton#cancelBtn:hover { background:#F8FAFC; }"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("confirmDeleteCard")
        root.addWidget(card, 0)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 14, 16, 12)
        card_l.setSpacing(8)

        title = QLabel(f"Are you sure you want to delete {room_name} from {job_name}?")
        title.setWordWrap(True)
        title.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        card_l.addWidget(title, 0)

        detail = QLabel(
            "This Job has:\n"
            f"- {int(max(0, pieces_count))} Pieces\n"
            f"- {int(max(0, items_count))} Items"
        )
        detail.setWordWrap(True)
        detail.setStyleSheet("QLabel { color:#334155; font-size:12px; font-weight:600; }")
        card_l.addWidget(detail, 0)

        btns = QDialogButtonBox()
        quote_only_btn = btns.addButton("Exclude from quote", QDialogButtonBox.ButtonRole.ActionRole)
        confirm_btn = btns.addButton("Confirm", QDialogButtonBox.ButtonRole.AcceptRole)
        cancel_btn = btns.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        quote_only_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        confirm_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        quote_only_btn.setObjectName("quoteOnlyBtn")
        confirm_btn.setObjectName("confirmBtn")
        cancel_btn.setObjectName("cancelBtn")
        quote_only_btn.clicked.connect(lambda: dlg.done(2))
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        card_l.addWidget(btns, 0)

        result_code = int(dlg.exec())

        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass
        if result_code == 2:
            return "quote_only"
        if result_code == int(QDialog.DialogCode.Accepted):
            return "delete"
        return "cancel"

    def _show_room_delete_blocked_dialog(self, room_name: str) -> str:
        theme = self._sales_theme_hex() if hasattr(self, "_sales_theme_hex") else ACCENT
        host = self.window() if isinstance(self.window(), QWidget) else self
        overlay = None
        prev_effect = None
        blur_fx = None
        try:
            if isinstance(host, QWidget):
                prev_effect = host.graphicsEffect()
                blur_fx = QGraphicsBlurEffect(host)
                blur_fx.setBlurRadius(5.0)
                host.setGraphicsEffect(blur_fx)
                overlay = QWidget(host)
                overlay.setObjectName("roomDeleteBlockedOverlay")
                overlay.setStyleSheet("QWidget#roomDeleteBlockedOverlay { background: rgba(15, 23, 42, 92); }")
                overlay.setGeometry(host.rect())
                overlay.show()
                overlay.raise_()
        except Exception:
            overlay = None

        dlg = QDialog(host if isinstance(host, QWidget) else None)
        dlg.setModal(True)
        dlg.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        dlg.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        dlg.setFixedWidth(560)
        dlg.setStyleSheet(
            "QDialog { background: transparent; border: none; }"
            "QFrame#roomDeleteBlockedCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            f"QPushButton#okBtn {{ background:{theme}; color:#FFFFFF; border:1px solid {theme}; }}"
            f"QPushButton#okBtn:hover {{ background:{QColor(theme).darker(112).name()}; border:1px solid {QColor(theme).darker(112).name()}; }}"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("roomDeleteBlockedCard")
        root.addWidget(card, 0)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 14, 16, 12)
        card_l.setSpacing(10)

        msg = QLabel(f"This room ({room_name}) has pieces in its cutlist, it cannot be deleted.")
        msg.setWordWrap(True)
        msg.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        card_l.addWidget(msg, 0)

        btn_row = QHBoxLayout()
        btn_row.setContentsMargins(0, 0, 0, 0)
        btn_row.addStretch(1)
        exclude_btn = QPushButton("Exclude from quote")
        exclude_btn.setObjectName("okBtn")
        exclude_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        exclude_btn.clicked.connect(lambda: dlg.done(2))
        btn_row.addWidget(exclude_btn, 0)
        ok_btn = QPushButton("OK")
        ok_btn.setObjectName("okBtn")
        ok_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        ok_btn.clicked.connect(dlg.accept)
        btn_row.addWidget(ok_btn, 0)
        card_l.addLayout(btn_row)

        result_code = int(dlg.exec())

        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass
        if result_code == 2:
            return "exclude_from_quote"
        return "ok"

    def _refresh_sales_job_type_panel(self, use_dashboard: bool, raw: dict | None) -> None:
        theme = self._sales_theme_hex()
        can_edit = self._can_edit_project_payload(raw)
        checks = self._sales_job_type_state(use_dashboard)
        layout = self._sales_job_type_layout(use_dashboard)
        options = self._company_sales_job_type_names()
        if isinstance(layout, QVBoxLayout):
            while layout.count() > 1:
                item = layout.takeAt(1)
                w = item.widget()
                if w is not None:
                    w.deleteLater()
            checks = {}
            for name in options:
                cb = QCheckBox(name)
                cb.setCursor(Qt.CursorShape.PointingHandCursor)
                cb.setStyleSheet(
                    "QCheckBox { color:#1F2937; font-size:13px; font-weight:600; spacing:7px; }"
                    "QCheckBox::indicator { width:14px; height:14px; }"
                )
                cb.toggled.connect(lambda _=False, u=use_dashboard: self._save_sales_job_types_from_panel(u))
                layout.addWidget(cb, 0, Qt.AlignmentFlag.AlignLeft)
                checks[name] = cb
            if use_dashboard:
                self._dashboard_sales_job_type_checks = checks
            else:
                self._detail_sales_job_type_checks = checks
        payload = self._project_sales_payload(raw) if hasattr(self, "_project_sales_payload") and isinstance(raw, dict) else {}
        selected_raw = payload.get("jobTypes")
        selected = {str(x or "").strip().lower() for x in selected_raw} if isinstance(selected_raw, list) else set()
        for name in options:
            cb = checks.get(name)
            if not isinstance(cb, QCheckBox):
                continue
            cb.blockSignals(True)
            cb.setChecked(name.lower() in selected)
            cb.setEnabled(bool(can_edit))
            cb.blockSignals(False)

    def _save_sales_job_types_from_panel(self, use_dashboard: bool) -> None:
        raw = self._selected_project()
        if not isinstance(raw, dict) or not hasattr(self, "_save_project_sales_payload"):
            return
        if not self._can_edit_project_payload(raw):
            return
        checks = self._sales_job_type_state(use_dashboard)
        selected: list[str] = []
        for name in self._company_sales_job_type_names():
            cb = checks.get(name)
            if isinstance(cb, QCheckBox) and cb.isChecked():
                selected.append(name)
        if not self._save_project_sales_payload(raw, {"jobTypes": selected}):
            return
        updated = self._selected_project()
        self._refresh_sales_job_type_panel(True, updated)
        self._refresh_sales_job_type_panel(False, updated)
        self._refresh_sales_rooms_panel(True, updated)
        self._refresh_sales_rooms_panel(False, updated)

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

    def _inventory_price_lookup(self) -> dict[str, float]:
        raw_rows = (self._company or {}).get("salesInventory")
        if not isinstance(raw_rows, list):
            raw_rows = (self._company or {}).get("inventory")
        if not isinstance(raw_rows, list):
            raw_rows = []
        out: dict[str, float] = {}
        for row in raw_rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            category = str(row.get("category") or "").strip()
            subcategory = str(row.get("subcategory") or "").strip()
            if not name:
                continue
            price = self._parse_positive_number(str(row.get("price") or ""))
            markup = self._parse_positive_number(str(row.get("markup") or ""))
            if price is None:
                continue
            output = float(price) * (1.0 + (float(markup or 0.0) / 100.0))
            name_key = " ".join(name.lower().split())
            cat_key = " ".join(category.lower().split())
            sub_key = " ".join(subcategory.lower().split())
            full_key = f"{cat_key}|{sub_key}|{name_key}"
            out[full_key] = output
            out.setdefault(name_key, output)
        return out

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

    def _sales_sheet_counts_by_board(self, rows: list[dict]) -> dict[str, int]:
        nest = dict((self._company or {}).get("nesting") or {})
        kerf = self._parse_positive_number(str(nest.get("kerf") or "5")) or 5.0
        margin = self._parse_positive_number(str(nest.get("margin") or "10")) or 10.0
        sheet_w = self._parse_positive_number(str(nest.get("sheetWidth") or "1220")) or 1220.0
        sheet_h = self._parse_positive_number(str(nest.get("sheetHeight") or "2440")) or 2440.0
        usable_w = max(1.0, float(sheet_w) - margin * 2.0)
        usable_h = max(1.0, float(sheet_h) - margin * 2.0)
        x_axis_is_long = usable_w >= usable_h

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
            board = str(row.get("board") or "").strip() or "No board"
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
            parts.sort(key=lambda p: max(float(p["w"]), float(p["h"])) * min(float(p["w"]), float(p["h"])), reverse=True)
            sheets: list[dict] = []

            def _try_place_in_existing_columns(sheet_obj: dict, ow: float, oh: float) -> bool:
                cols = sheet_obj.setdefault("columns", [])
                for col in cols:
                    used_h = float(col.get("usedHeight") or 0.0)
                    add_kerf = kerf if used_h > 0 else 0.0
                    if ow <= float(col.get("width") or 0.0) and (used_h + add_kerf + oh) <= usable_h:
                        col["usedHeight"] = used_h + add_kerf + oh
                        return True
                return False

            def _try_create_column_and_place(sheet_obj: dict, ow: float, oh: float) -> bool:
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
                if not orientations:
                    sheets.append({"columns": [{"x": 0.0, "width": usable_w, "usedHeight": usable_h}]})
                    continue

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

                first = orientations[0]
                sheets.append({"columns": [{"x": 0.0, "width": float(first["w"]), "usedHeight": float(first["h"])}]})
            counts[board] = len(sheets)
        return counts

    def _sales_room_total_prices_from_initial_measure(self, raw: dict | None) -> dict[str, float]:
        sales_payload = self._project_sales_payload(raw) if hasattr(self, "_project_sales_payload") and isinstance(raw, dict) else {}
        initial_payload = sales_payload.get("initialMeasureCutlist")
        if isinstance(initial_payload, str):
            try:
                initial_payload = json.loads(initial_payload)
            except Exception:
                initial_payload = None
        if not isinstance(initial_payload, dict):
            initial_payload = {}
        rows = initial_payload.get("rows")
        if not isinstance(rows, list):
            rows = []

        room_rows: dict[str, list[dict]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            room = str(row.get("room") or "").strip()
            if not room:
                continue
            room_key = " ".join(room.lower().split())
            if not room_key or room_key == "all":
                continue
            room_rows.setdefault(room_key, []).append(dict(row))

        price_rows = self._company_sales_job_type_rows() if hasattr(self, "_company_sales_job_type_rows") else []
        price_map: dict[str, float] = {}
        for row in price_rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            val = self._parse_positive_number(str(row.get("pricePerSheet") or row.get("price") or ""))
            price_map[" ".join(name.lower().split())] = float(val or 0.0)

        totals: dict[str, float] = {}
        for room_key, bucket in room_rows.items():
            sheet_counts = self._sales_sheet_counts_by_board(bucket)
            total = 0.0
            for board_name, count in sheet_counts.items():
                b_key = " ".join(str(board_name or "").strip().lower().split())
                total += float(count or 0) * float(price_map.get(b_key) or 0.0)
            totals[room_key] = total

        item_rows = sales_payload.get("items")
        item_rows = item_rows if isinstance(item_rows, list) else []
        item_price_map = self._inventory_price_lookup()
        for item in item_rows:
            if not isinstance(item, dict):
                continue
            room_txt = str(item.get("room") or "").strip()
            room_key = " ".join(room_txt.lower().split())
            if not room_key or room_key == "all":
                continue
            name_key = " ".join(str(item.get("name") or "").strip().lower().split())
            if not name_key:
                continue
            cat_key = " ".join(str(item.get("category") or "").strip().lower().split())
            sub_key = " ".join(str(item.get("subcategory") or "").strip().lower().split())
            full_key = f"{cat_key}|{sub_key}|{name_key}"
            item_price = float(item_price_map.get(full_key) or item_price_map.get(name_key) or 0.0)
            totals[room_key] = float(totals.get(room_key) or 0.0) + item_price
        return totals

    def _refresh_sales_quote_extras_panel(self, use_dashboard: bool, raw: dict | None) -> None:
        theme = self._sales_theme_hex()
        can_edit = self._can_edit_project_payload(raw)
        layout = self._sales_quote_extras_state(use_dashboard)
        if not isinstance(layout, QVBoxLayout):
            return
        while layout.count():
            item = layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        rows = self._company_quote_extras_rows()
        if not rows:
            hint = QLabel("No quote extras in Company Settings.")
            hint.setStyleSheet("QLabel { color: #64748B; font-size: 12px; }")
            layout.addWidget(hint)
            return
        payload = self._project_sales_payload(raw) if hasattr(self, "_project_sales_payload") and isinstance(raw, dict) else {}
        included_raw = payload.get("quoteExtrasIncluded")
        included = {str(v or "").strip().lower() for v in included_raw} if isinstance(included_raw, list) else set()
        for row in rows:
            name = str(row.get("name") or "").strip()
            line = QWidget()
            line_lay = QHBoxLayout(line)
            line_lay.setContentsMargins(0, 0, 0, 0)
            line_lay.setSpacing(8)
            cb = QCheckBox(name)
            cb.setObjectName("salesQuoteExtraCheck")
            cb.setProperty("extraName", name)
            cb.setCursor(Qt.CursorShape.PointingHandCursor)
            cb.setChecked(name.lower() in included)
            cb.setEnabled(bool(can_edit))
            cb.setStyleSheet(
                "QCheckBox { color:#1F2937; font-size:13px; font-weight:600; spacing:7px; }"
                "QCheckBox::indicator { width:14px; height:14px; }"
            )
            cb.toggled.connect(lambda _=False, u=use_dashboard: self._save_sales_quote_extras_from_panel(u))
            line_lay.addWidget(cb, 1)
            layout.addWidget(line)

    def _save_sales_quote_extras_from_panel(self, use_dashboard: bool) -> None:
        raw = self._selected_project()
        if not isinstance(raw, dict) or not hasattr(self, "_save_project_sales_payload"):
            return
        if not self._can_edit_project_payload(raw):
            return
        layout = self._sales_quote_extras_state(use_dashboard)
        if not isinstance(layout, QVBoxLayout):
            return
        included: list[str] = []
        for i in range(layout.count()):
            item = layout.itemAt(i)
            host = item.widget()
            if not isinstance(host, QWidget):
                continue
            cb = host.findChild(QCheckBox, "salesQuoteExtraCheck")
            if isinstance(cb, QCheckBox) and cb.isChecked():
                name = str(cb.property("extraName") or cb.text() or "").strip()
                if name:
                    included.append(name)
        if not self._save_project_sales_payload(raw, {"quoteExtrasIncluded": included}):
            return
        updated = self._selected_project()
        self._refresh_sales_quote_extras_panel(True, updated)
        self._refresh_sales_quote_extras_panel(False, updated)
        try:
            pid = str((updated or raw or {}).get("id") or "").strip()
            for dlg in (getattr(self, "_open_quote_dialogs", None) or []):
                if str(getattr(dlg, "_cs_project_id", "") or "").strip() != pid:
                    continue
                refresh_with_raw = getattr(dlg, "_cs_refresh_quote_with_raw", None)
                if callable(refresh_with_raw):
                    refresh_with_raw(updated)
                    continue
                refresh_fn = getattr(dlg, "_cs_refresh_quote", None)
                if callable(refresh_fn):
                    refresh_fn()
        except Exception:
            pass
