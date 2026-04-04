from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QPushButton, QVBoxLayout, QWidget

from cutsmart.ui.style import ACCENT, ACCENT_HOVER, APP_BG, TEXT_MAIN, TEXT_MUTED


class LoginPlaceholderScreen(QWidget):
    def __init__(self, on_back):
        super().__init__()
        self._on_back = on_back
        self._build_ui()

    def _build_ui(self) -> None:
        self.setStyleSheet(f"background: {APP_BG};")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(40, 40, 40, 40)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setSpacing(14)

        title = QLabel("Login screen is next")
        title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 28px; font-weight: 700;")
        layout.addWidget(title, alignment=Qt.AlignmentFlag.AlignHCenter)

        desc = QLabel("Part 1 complete: Splash is now running in PySide6.")
        desc.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 14px;")
        layout.addWidget(desc, alignment=Qt.AlignmentFlag.AlignHCenter)

        back = QPushButton("Back")
        back.setCursor(Qt.CursorShape.PointingHandCursor)
        back.setFixedSize(180, 44)
        back.clicked.connect(self._on_back)
        back.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 12px;"
            "font-size: 14px; font-weight: 700;"
            "}"
            "QPushButton:hover {"
            f"background: {ACCENT_HOVER};"
            "}"
        )
        layout.addWidget(back, alignment=Qt.AlignmentFlag.AlignHCenter)
