from __future__ import annotations

import re

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from cutsmart.ui.style import TEXT_MAIN, TEXT_MUTED


class DashboardStatsMixin:

    def _short_iso(self, value: str) -> str:
        text = (value or "").strip()
        if not text:
            return "-"
        return text.replace("T", " ").replace("Z", "")[:16]

    def _stat_card(self, label: str, value: str, on_view=None) -> QWidget:
        card = QFrame()
        card.setObjectName("DashboardStatCard")
        card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #ECECF0;"
            "border-radius: 14px;"
            "}"
        )
        layout = QVBoxLayout(card)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(4)

        head = QHBoxLayout()
        head.setContentsMargins(0, 0, 0, 0)
        head.setSpacing(6)
        text = QLabel(label)
        text.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: 12px; background: transparent; border: none; padding: 0px;"
        )
        head.addWidget(text)
        head.addStretch(1)

        if callable(on_view):
            view_btn = QPushButton("View")
            view_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            view_btn.setFixedHeight(22)
            view_btn.setStyleSheet(
                "QPushButton { background: #F3F5F8; color: #6B7686; border: 1px solid #E2E7EF; border-radius: 8px; padding: 0 8px; font-size: 11px; font-weight: 700; }"
                "QPushButton:hover { background: #EAEFF6; }"
            )
            view_btn.clicked.connect(on_view)
            head.addWidget(view_btn)
        layout.addLayout(head)

        num = QLabel(value)
        num.setStyleSheet(
            f"color: {TEXT_MAIN}; font-size: 30px; font-weight: 700; background: transparent; border: none; padding: 0px;"
        )
        layout.addWidget(num)
        self._stat_labels[label] = num

        return card

    def _view_staff_members(self) -> None:
        self._set_section("company")
        opener = getattr(self, "_open_company_settings_subsection", None)
        if callable(opener):
            opener("staff_permissions", "general")

    def _view_completed_projects(self) -> None:
        completed_rows: list[dict] = []
        for row in (self._projects_all or []):
            if not isinstance(row, dict):
                continue
            status_key = str((row or {}).get("status") or "")
            if not self._is_completed_status(status_key):
                continue
            completed_rows.append(row)

        dialog = QDialog(self)
        dialog.setWindowTitle("Completed Projects")
        dialog.setModal(False)
        dialog.resize(760, 560)
        dialog.setStyleSheet("QDialog { background: #F5F6F8; }")

        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        title = QLabel("Completed Projects")
        title.setStyleSheet("color: #1A1D23; font-size: 18px; font-weight: 800;")
        layout.addWidget(title)

        if not completed_rows:
            empty = QLabel("No completed projects yet.")
            empty.setStyleSheet("color: #6B7280; font-size: 13px;")
            layout.addWidget(empty)
        else:
            def _completed_iso(raw_row: dict) -> str:
                return (
                    str((raw_row or {}).get("completedAtIso") or "").strip()
                    or str((raw_row or {}).get("updatedAtIso") or "").strip()
                    or str((raw_row or {}).get("createdAtIso") or "").strip()
                )

            def _parts(iso: str) -> tuple[int, int, int, int, int]:
                text = str(iso or "").strip()
                m = re.search(r"(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})", text)
                if not m:
                    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
                    if not m:
                        return (0, 0, 0, 0, 0)
                    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), 0, 0)
                return (int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)))

            month_names = [
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
            ]
            grouped: dict[tuple[int, int], list[dict]] = {}
            for row in completed_rows:
                iso = _completed_iso(row)
                yy, mm, dd, hh, mi = _parts(iso)
                key = (yy, mm)
                entry = dict(row)
                entry["_completedIso"] = iso
                entry["_completedParts"] = (yy, mm, dd, hh, mi)
                grouped.setdefault(key, []).append(entry)

            host = QWidget()
            host_layout = QVBoxLayout(host)
            host_layout.setContentsMargins(0, 0, 0, 0)
            host_layout.setSpacing(8)

            for (yy, mm) in sorted(grouped.keys(), reverse=True):
                if yy <= 0 or not (1 <= mm <= 12):
                    header_txt = "Unknown Month"
                else:
                    header_txt = f"{month_names[mm - 1]} {yy}"
                header = QLabel(header_txt)
                header.setStyleSheet("color: #374151; font-size: 14px; font-weight: 800; padding: 4px 2px;")
                host_layout.addWidget(header)
                rows = sorted(grouped[(yy, mm)], key=lambda r: tuple(r.get("_completedParts") or (0, 0, 0, 0, 0)), reverse=True)
                for raw_row in rows:
                    name = str((raw_row or {}).get("name") or "Untitled").strip() or "Untitled"
                    completed_txt = self._short_date_with_time(str(raw_row.get("_completedIso") or ""))
                    row_card = QFrame()
                    row_card.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 10px; }")
                    row_lay = QHBoxLayout(row_card)
                    row_lay.setContentsMargins(10, 8, 10, 8)
                    row_lay.setSpacing(8)
                    left = QLabel(name)
                    left.setStyleSheet("color: #111827; font-size: 13px; font-weight: 700;")
                    right = QLabel(completed_txt)
                    right.setStyleSheet("color: #6B7280; font-size: 12px; font-weight: 700;")
                    row_lay.addWidget(left, 1)
                    row_lay.addWidget(right, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                    host_layout.addWidget(row_card)

            host_layout.addStretch(1)
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(QFrame.Shape.NoFrame)
            scroll.setWidget(host)
            layout.addWidget(scroll, 1)

        self._open_completed_projects_dialogs.append(dialog)
        dialog.finished.connect(
            lambda _=0, d=dialog: setattr(
                self,
                "_open_completed_projects_dialogs",
                [x for x in self._open_completed_projects_dialogs if x is not d],
            )
        )
        dialog.show()

    def _view_recently_deleted_projects(self) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        rows: list[dict] = []
        if company_id and hasattr(self.app.company, "list_deleted_jobs"):
            try:
                rows = list(self.app.company.list_deleted_jobs(company_id) or [])
                self._projects_deleted = list(rows)
            except Exception:
                rows = list(getattr(self, "_projects_deleted", []) or [])
        else:
            rows = list(getattr(self, "_projects_deleted", []) or [])

        dialog = QDialog(self)
        dialog.setWindowTitle("Recently Deleted")
        dialog.setModal(False)
        dialog.resize(760, 560)
        dialog.setStyleSheet("QDialog { background: #F5F6F8; }")

        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        title = QLabel("Recently Deleted")
        title.setStyleSheet("color: #1A1D23; font-size: 18px; font-weight: 800;")
        layout.addWidget(title)

        if not rows:
            empty = QLabel("No deleted projects.")
            empty.setStyleSheet("color: #6B7280; font-size: 13px;")
            layout.addWidget(empty)
        else:
            host = QWidget()
            host_layout = QVBoxLayout(host)
            host_layout.setContentsMargins(0, 0, 0, 0)
            host_layout.setSpacing(8)

            for raw in rows:
                if not isinstance(raw, dict):
                    continue
                name = str((raw or {}).get("name") or "Untitled").strip() or "Untitled"
                deleted_at = str((raw or {}).get("deletedAtIso") or (raw or {}).get("updatedAtIso") or "").strip()
                job_id = str((raw or {}).get("id") or "").strip()

                row_card = QFrame()
                row_card.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 10px; }")
                row_lay = QHBoxLayout(row_card)
                row_lay.setContentsMargins(10, 8, 10, 8)
                row_lay.setSpacing(8)

                left_col = QVBoxLayout()
                left_col.setContentsMargins(0, 0, 0, 0)
                left_col.setSpacing(2)
                name_lbl = QLabel(name)
                name_lbl.setStyleSheet("color: #111827; font-size: 13px; font-weight: 700;")
                when_lbl = QLabel(f"Deleted: {self._short_date_with_time(deleted_at)}")
                when_lbl.setStyleSheet("color: #6B7280; font-size: 12px; font-weight: 600;")
                left_col.addWidget(name_lbl)
                left_col.addWidget(when_lbl)
                row_lay.addLayout(left_col, 1)

                restore_btn = QPushButton("Restore")
                restore_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                restore_btn.setFixedHeight(28)
                restore_btn.setStyleSheet(
                    "QPushButton { background: #E3F5E1; color: #186A3B; border: 1px solid #C8EBCD; border-radius: 8px; padding: 0 12px; font-size: 12px; font-weight: 700; }"
                    "QPushButton:hover { background: #D4EFD8; }"
                )

                def _restore_clicked(_=False, pid=job_id, d=dialog):
                    if not pid:
                        return
                    if self._restore_project_by_id(pid):
                        QMessageBox.information(self, "Restored", "Project restored.")
                        try:
                            d.close()
                        except Exception:
                            pass
                        self._show_dashboard_projects_list()

                restore_btn.clicked.connect(_restore_clicked)
                row_lay.addWidget(restore_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                host_layout.addWidget(row_card)

            host_layout.addStretch(1)
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(QFrame.Shape.NoFrame)
            scroll.setWidget(host)
            layout.addWidget(scroll, 1)

        dialog.show()


