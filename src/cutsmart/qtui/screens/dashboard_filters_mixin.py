from __future__ import annotations

import re

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QMenu, QPushButton, QToolButton, QVBoxLayout, QWidget, QWidgetAction


class DashboardFiltersMixin:

    def _dashboard_status_counts(self) -> tuple[int, int]:
        active = 0
        completed = 0
        for row in (self._projects_all or []):
            status = str((row or {}).get("status") or "")
            if self._is_completed_status(status):
                completed += 1
            else:
                active += 1
        return active, completed

    def _is_completed_status(self, status: str) -> bool:
        token = re.sub(r"[^a-z]", "", str(status or "").strip().lower())
        return token == "done" or token.startswith("complete")

    def _set_dashboard_sort(self, mode: str) -> None:
        self._dashboard_sort_mode = str(mode or "latest")
        for key, btn in (getattr(self, "_dashboard_filter_buttons", {}) or {}).items():
            if key == self._dashboard_sort_mode:
                btn.setStyleSheet("QPushButton { background: #7D99B3; color: white; border: none; border-radius: 14px; padding: 0 12px; font-size: 12px; font-weight: 700; }")
            else:
                btn.setStyleSheet("QPushButton { background: #F1F3F8; color: #6B7B8F; border: none; border-radius: 14px; padding: 0 12px; font-size: 12px; font-weight: 700; }")
        self._apply_dashboard_projects_view()
    def _sync_dashboard_staff_filter_label(self) -> None:
        btn = getattr(self, "_dashboard_staff_btn", None)
        if not isinstance(btn, QToolButton):
            return
        selected_key = str(getattr(self, "_dashboard_selected_staff_key", "__all__") or "__all__")
        selected_name = ""
        for key, label in (getattr(self, "_dashboard_staff_options", []) or []):
            if str(key) == selected_key:
                selected_name = str(label or "").strip()
                break
        text = "User" if selected_key == "__all__" else f"User: {selected_name or 'Unknown'}"
        btn.setText(text)
        width = btn.fontMetrics().horizontalAdvance(text) + 36
        btn.setFixedWidth(max(84, width))

    def _open_dashboard_staff_menu(self) -> None:
        btn = getattr(self, "_dashboard_staff_btn", None)
        if not isinstance(btn, QToolButton):
            return
        menu = QMenu(self)
        menu.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
        menu.setWindowFlag(Qt.WindowType.NoDropShadowWindowHint, True)
        menu.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        menu.setStyleSheet("QMenu { background: #FFFFFF; border: none; border-radius: 10px; padding: 6px; }")
        menu.setMinimumWidth(max(190, btn.width() + 34))

        current_key = str(getattr(self, "_dashboard_selected_staff_key", "__all__") or "__all__")
        options = list(getattr(self, "_dashboard_staff_options", []) or [])
        for idx, item in enumerate(options):
            key = str(item[0]) if isinstance(item, tuple) and len(item) > 0 else "__all__"
            label = str(item[1]) if isinstance(item, tuple) and len(item) > 1 else "All"
            is_selected = key == current_key
            bg = "#E8EDF5" if is_selected else "#F1F3F8"
            fg = "#44546A"

            option_btn = QPushButton(label)
            option_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            option_btn.setMinimumHeight(28)
            option_btn.setStyleSheet(
                "QPushButton {"
                f"background: {bg}; color: {fg}; border: none; border-radius: 8px;"
                "padding: 4px 10px; text-align: left; font-size: 12px; font-weight: 700;"
                "}"
                "QPushButton:hover { padding: 3px 9px; }"
            )
            option_btn.clicked.connect(lambda _=False, k=key: self._set_dashboard_staff_filter(k))

            option_wrap = QWidget()
            option_wrap.setStyleSheet("background: transparent;")
            option_wrap_layout = QVBoxLayout(option_wrap)
            option_wrap_layout.setContentsMargins(0, 0, 0, 4 if idx < (len(options) - 1) else 0)
            option_wrap_layout.setSpacing(0)
            option_wrap_layout.addWidget(option_btn)

            action = QWidgetAction(menu)
            action.setDefaultWidget(option_wrap)
            menu.addAction(action)

        self._dashboard_staff_menu = menu
        menu.exec(btn.mapToGlobal(btn.rect().bottomLeft()))


    def _set_dashboard_staff_filter(self, key: str) -> None:
        self._dashboard_selected_staff_key = str(key or "__all__")
        self._sync_dashboard_staff_filter_label()
        self._apply_dashboard_projects_view()
        menu = getattr(self, "_dashboard_staff_menu", None)
        if isinstance(menu, QMenu):
            menu.close()

    def _sync_dashboard_status_filter_label(self) -> None:
        btn = getattr(self, "_dashboard_status_btn", None)
        if not isinstance(btn, QToolButton):
            return
        selected_status = str(getattr(self, "_dashboard_selected_status_filter", "__all__") or "__all__").strip()
        text = "Status" if selected_status == "__all__" else selected_status
        btn.setText(text)
        width = btn.fontMetrics().horizontalAdvance(text) + 36
        btn.setFixedWidth(max(84, width))

    def _open_dashboard_status_filter_menu(self) -> None:
        btn = getattr(self, "_dashboard_status_btn", None)
        if not isinstance(btn, QToolButton):
            return
        menu = QMenu(self)
        menu.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
        menu.setWindowFlag(Qt.WindowType.NoDropShadowWindowHint, True)
        menu.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        menu.setStyleSheet("QMenu { background: #FFFFFF; border: none; border-radius: 10px; padding: 6px; }")
        menu.setMinimumWidth(max(170, btn.width() + 26))

        selected_status = str(getattr(self, "_dashboard_selected_status_filter", "__all__") or "__all__").strip().lower()
        options = ["All"] + [str(v) for v in self._project_status_options()]
        for idx, status_name in enumerate(options):
            status_text = str(status_name).strip() or "New"
            is_all = status_text.lower() == "all"
            if is_all:
                bg, fg = ("#F1F3F8", "#6B7B8F")
            else:
                bg, fg, _border = self._status_pill_colors(status_text)
            option_btn = QPushButton(status_text)
            option_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            option_btn.setMinimumHeight(28)
            option_btn.setStyleSheet(
                "QPushButton {"
                f"background: {bg}; color: {fg}; border: none; border-radius: 8px;"
                "padding: 4px 10px; text-align: left; font-size: 12px; font-weight: 700;"
                "}"
                "QPushButton:hover { padding: 3px 9px; }"
            )
            if (is_all and selected_status == "__all__") or ((not is_all) and status_text.lower() == selected_status):
                option_btn.setStyleSheet(
                    "QPushButton {"
                    f"background: {bg}; color: {fg}; border: none; border-radius: 8px;"
                    "padding: 4px 10px; text-align: left; font-size: 12px; font-weight: 700;"
                    "}"
                )
            option_btn.clicked.connect(lambda _=False, v=status_text: self._set_dashboard_status_filter(v))

            option_wrap = QWidget()
            option_wrap.setStyleSheet("background: transparent;")
            option_wrap_layout = QVBoxLayout(option_wrap)
            option_wrap_layout.setContentsMargins(0, 0, 0, 4 if idx < (len(options) - 1) else 0)
            option_wrap_layout.setSpacing(0)
            option_wrap_layout.addWidget(option_btn)

            action = QWidgetAction(menu)
            action.setDefaultWidget(option_wrap)
            menu.addAction(action)

        self._dashboard_status_menu = menu
        menu.exec(btn.mapToGlobal(btn.rect().bottomLeft()))

    def _set_dashboard_status_filter(self, value: str) -> None:
        picked = str(value or "").strip()
        self._dashboard_selected_status_filter = "__all__" if (not picked or picked.lower() == "all") else picked
        self._sync_dashboard_status_filter_label()
        self._apply_dashboard_projects_view()
        menu = getattr(self, "_dashboard_status_menu", None)
        if isinstance(menu, QMenu):
            menu.close()



