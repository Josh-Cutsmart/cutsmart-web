from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QBrush, QColor, QFont
from PySide6.QtWidgets import QHeaderView, QHBoxLayout, QLabel, QMessageBox, QPushButton, QTableWidget, QVBoxLayout, QWidget

from cutsmart.ui.style import ACCENT, TEXT_MAIN


class DashboardUpdatesMixin:

    def _build_updates_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        head_row = QHBoxLayout()
        title = QLabel("Updates")
        title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 24px; font-weight: 700;")
        head_row.addWidget(title)
        head_row.addStretch(1)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.setFixedHeight(38)
        refresh_btn.clicked.connect(self._refresh_updates)
        refresh_btn.setStyleSheet(
            "QPushButton {"
            "background: #F2F2F7; color: #2C2C2E; border: none; border-radius: 10px;"
            "font-size: 13px; font-weight: 700; padding: 0 12px;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        head_row.addWidget(refresh_btn)

        mark_btn = QPushButton("Mark All Read")
        mark_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        mark_btn.setFixedHeight(38)
        mark_btn.clicked.connect(self._mark_all_updates_read)
        mark_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 10px;"
            "font-size: 13px; font-weight: 700; padding: 0 12px;"
            "}"
            "QPushButton:hover { background: #2458D3; }"
        )
        head_row.addWidget(mark_btn)

        layout.addLayout(head_row)

        table = QTableWidget()
        table.setObjectName("UpdatesTable")
        table.setColumnCount(5)
        table.setHorizontalHeaderLabels(["Title", "Message", "Type", "Read", "Created"])
        table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.verticalHeader().setVisible(False)
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        table.setStyleSheet(
            "QTableWidget {"
            "background: white; border: 1px solid #E4E6EC; border-radius: 12px;"
            "gridline-color: #F0F2F7;"
            "}"
            "QHeaderView::section {"
            "background: #F7F8FA; color: #5B6472; font-size: 12px; font-weight: 700;"
            "padding: 8px; border: none;"
            "}"
        )
        self._updates_table = table
        layout.addWidget(table, stretch=1)

        self._refresh_updates()
        return page

    def _refresh_updates(self, silent: bool = False) -> None:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid or not self._updates_table:
            return

        try:
            self._updates_all = list(self.app.company.get_user_notifications(uid) or [])
        except Exception as exc:
            if not silent:
                QMessageBox.critical(self, "Updates refresh failed", str(exc))
            return

        table = self._updates_table
        table.setRowCount(len(self._updates_all))
        for idx, item in enumerate(self._updates_all):
            title = str((item or {}).get("title") or "Notification")
            message = str((item or {}).get("message") or "")
            type_ = str((item or {}).get("type") or "info")
            read = bool((item or {}).get("read", False))
            created = self._short_iso(str((item or {}).get("createdAtIso") or ""))

            self._set_table_item_row(table, idx, 0, title)
            self._set_table_item_row(table, idx, 1, message)
            self._set_table_item_row(table, idx, 2, type_)
            self._set_table_item_row(table, idx, 3, "Read" if read else "Unread")
            self._set_table_item_row(table, idx, 4, created)

            title_item = table.item(idx, 0)
            read_item = table.item(idx, 3)
            if title_item is not None:
                f = QFont(title_item.font())
                f.setBold(not read)
                title_item.setFont(f)
            if read_item is not None:
                read_item.setForeground(QBrush(QColor("#2E7D32" if read else "#C62828")))

        if not self._updates_all:
            self._set_table_empty_state(table, 5, "No updates available")

        self._sync_dashboard_stats()

    def _mark_all_updates_read(self) -> None:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid:
            return
        if not self._updates_all:
            self._refresh_updates()
        if not self._updates_all:
            return

        payload = []
        for item in self._updates_all:
            row = dict(item or {})
            row["read"] = True
            payload.append(row)

        try:
            self.app.company.replace_user_notifications(uid, payload)
        except Exception as exc:
            QMessageBox.critical(self, "Mark read failed", str(exc))
            return

        self._updates_all = payload
        self._refresh_updates()
        QMessageBox.information(self, "Updates", "All notifications marked as read.")
