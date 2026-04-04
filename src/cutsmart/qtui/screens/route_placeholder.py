from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QPushButton, QVBoxLayout, QWidget

from cutsmart.ui.style import ACCENT, ACCENT_HOVER, APP_BG, TEXT_MAIN, TEXT_MUTED


class RoutePlaceholderScreen(QWidget):
    def __init__(self, title: str, subtitle: str, primary_label: str, on_primary):
        super().__init__()
        self._build_ui(title, subtitle, primary_label, on_primary)

    def _build_ui(self, title: str, subtitle: str, primary_label: str, on_primary) -> None:
        self.setStyleSheet(f"background: {APP_BG};")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setSpacing(14)

        title_label = QLabel(title)
        title_label.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 28px; font-weight: 700;")
        layout.addWidget(title_label, alignment=Qt.AlignmentFlag.AlignHCenter)

        subtitle_label = QLabel(subtitle)
        subtitle_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 14px;")
        subtitle_label.setWordWrap(True)
        subtitle_label.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        layout.addWidget(subtitle_label, alignment=Qt.AlignmentFlag.AlignHCenter)

        btn = QPushButton(primary_label)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedSize(220, 44)
        btn.clicked.connect(on_primary)
        btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 12px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover {"
            f"background: {ACCENT_HOVER};"
            "}"
        )
        layout.addWidget(btn, alignment=Qt.AlignmentFlag.AlignHCenter)
