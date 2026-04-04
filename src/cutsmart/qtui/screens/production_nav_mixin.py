from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QSize
from PySide6.QtGui import QColor, QFont, QFontMetrics, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import QPushButton, QWidget

from cutsmart.ui.style import ACCENT


class ProductionNavMixin:

    @staticmethod
    def _stacked_nav_shared_width() -> int:
        # Keep General/Sales/Production left nav buttons exactly the same width.
        labels = (
            "Images",
            "Notes",
            "Initial Measure",
            "Items",
            "Quote",
            "Specifications",
            "Cutlist",
            "Nesting",
            "CNC Cutlist",
            "Order",
            "Unlock",
            "Unlock Production",
        )
        # Match the button text style used below.
        font = QFont("Segoe UI", 13)
        font.setWeight(QFont.Weight.ExtraBold)
        fm = QFontMetrics(font)
        max_label_px = max(int(fm.horizontalAdvance(text)) for text in labels)
        # icon + spacing + horizontal padding
        return int(max_label_px + 14 + 12 + 34)

    @staticmethod
    def _build_tinted_icon(path: Path, color: QColor) -> QIcon:
        if not isinstance(path, Path) or not path.exists():
            return QIcon()
        src = QPixmap(str(path))
        if src.isNull():
            return QIcon()
        out = QPixmap(src.size())
        out.fill(QColor(0, 0, 0, 0))
        painter = QPainter(out)
        painter.drawPixmap(0, 0, src)
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
        painter.fillRect(out.rect(), color)
        painter.end()
        return QIcon(out)

    def _clear_layout_widgets(self, layout) -> None:
        if layout is None:
            return
        while layout.count():
            item = layout.takeAt(0)
            if item is None:
                continue
            widget = item.widget()
            child_layout = item.layout()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()
            elif child_layout is not None:
                self._clear_layout_widgets(child_layout)

    def _production_nav_button_style(self, active: bool = False) -> str:
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT), ACCENT)
        hover = QColor(theme).darker(112).name()
        if bool(active):
            return (
                "QPushButton { "
                f"background: {theme}; color: white; border: none; border-radius: 10px; "
                "padding: 0 10px; font-size: 12px; font-weight: 700; }"
                f"QPushButton:hover {{ background: {hover}; }}"
            )
        return (
            "QPushButton { "
            f"background: {theme}; color: white; border: none; border-radius: 10px; "
            "padding: 0 10px; font-size: 12px; font-weight: 700; }"
            f"QPushButton:hover {{ background: {hover}; }}"
        )

    def _refresh_sales_nav_buttons(self) -> None:
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT), ACCENT)
        hover_bg = QColor(theme).lighter(178).name()
        press_bg = QColor(theme).lighter(164).name()
        text_color = QColor("#0F172A")
        icon_dir = Path(__file__).resolve().parent.parent / "assets" / "icons"
        self._apply_stacked_nav_button_theme(
            buttons=(
                self._dashboard_detail_open_initial_measure_btn,
                self._dashboard_detail_open_items_btn,
                self._dashboard_detail_open_quote_btn,
                self._dashboard_detail_open_specs_btn,
                self._detail_open_initial_measure_btn,
                self._detail_open_items_btn,
                self._detail_open_quote_btn,
                self._detail_open_specs_btn,
            ),
            icon_by_label={
                "initial measure": "measuring-tape.png",
                "items": "sort-amount-down-alt.png",
                "quote": "file-invoice-dollar.png",
                "specifications": "task-checklist.png",
            },
            icon_dir=icon_dir,
            text_color=text_color,
            hover_bg=hover_bg,
            press_bg=press_bg,
        )

    def _apply_stacked_nav_button_theme(
        self,
        buttons: tuple[QPushButton | None, ...],
        icon_by_label: dict[str, str],
        icon_dir: Path,
        text_color: QColor,
        hover_bg: str,
        press_bg: str,
    ) -> None:
        clean_buttons: list[QPushButton] = []
        shared_width = self._stacked_nav_shared_width()
        for btn in buttons:
            if not isinstance(btn, QPushButton):
                continue
            clean_buttons.append(btn)
        for btn in clean_buttons:
            base_text = str(btn.text() or "").strip()
            label_key = base_text.lower()
            icon_name = str(icon_by_label.get(label_key) or "").strip()
            btn.setIcon(self._build_tinted_icon(icon_dir / icon_name, text_color) if icon_name else QIcon())
            btn.setIconSize(QSize(14, 14))
            btn.setText(f"  {base_text}")
            btn.setFixedWidth(shared_width)
            btn.setStyleSheet(
                "QPushButton { "
                "background: #FFFFFF; color: #0F172A; border: none; border-radius: 12px; "
                "padding: 10px 14px; font-size: 13px; font-weight: 800; text-align: left; }"
                f"QPushButton:hover {{ background: {hover_bg}; color: #0F172A; }}"
                f"QPushButton:pressed {{ background: {press_bg}; color: #0F172A; }}"
            )

    def _refresh_general_nav_buttons(self) -> None:
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT), ACCENT)
        hover_bg = QColor(theme).lighter(178).name()
        press_bg = QColor(theme).lighter(164).name()
        text_color = QColor("#0F172A")
        icon_dir = Path(__file__).resolve().parent.parent / "assets" / "icons"
        self._apply_stacked_nav_button_theme(
            buttons=(
                self._dashboard_detail_open_images_btn,
                self._dashboard_detail_open_notes_btn,
                self._detail_open_images_btn,
                self._detail_open_notes_btn,
            ),
            icon_by_label={
                "images": "picture.png",
                "notes": "notes.png",
            },
            icon_dir=icon_dir,
            text_color=text_color,
            hover_bg=hover_bg,
            press_bg=press_bg,
        )

    def _refresh_production_nav_buttons(self, use_dashboard: bool) -> None:
        _ = str(self._dashboard_production_panel_mode if use_dashboard else self._detail_production_panel_mode)
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT), ACCENT)
        hover_bg = QColor(theme).lighter(178).name()
        press_bg = QColor(theme).lighter(164).name()
        text_color = QColor("#0F172A")
        icon_dir = Path(__file__).resolve().parent.parent / "assets" / "icons"
        if use_dashboard:
            buttons = (
                self._dashboard_detail_open_cutlist_btn,
                self._dashboard_detail_open_nesting_btn,
                self._dashboard_detail_open_cnc_btn,
                self._dashboard_detail_open_order_btn,
                self._dashboard_detail_open_unlock_production_btn,
            )
        else:
            buttons = (
                self._detail_open_cutlist_btn,
                self._detail_open_nesting_btn,
                self._detail_open_cnc_btn,
                self._detail_open_order_btn,
                self._detail_open_unlock_production_btn,
            )
        self._apply_stacked_nav_button_theme(
            buttons=buttons,
            icon_by_label={
                "cutlist": "tape-measure.png",
                "nesting": "nest.png",
                "cnc cutlist": "shapes.png",
                "order": "order.png",
                "unlock": "unlock.png",
                "unlock production": "unlock.png",
            },
            icon_dir=icon_dir,
            text_color=text_color,
            hover_bg=hover_bg,
            press_bg=press_bg,
        )

    def _set_production_panel_mode(self, use_dashboard: bool, mode: str) -> None:
        mode_key = str(mode or "cabinet_specs").strip().lower()
        if mode_key not in ("cabinet_specs",):
            mode_key = "cabinet_specs"
        if use_dashboard:
            self._dashboard_production_panel_mode = mode_key
            config_host = self._dashboard_production_config_host
            board_host = self._dashboard_production_board_host
        else:
            self._detail_production_panel_mode = mode_key
            config_host = self._detail_production_config_host
            board_host = self._detail_production_board_host
        if isinstance(config_host, QWidget):
            config_host.setVisible(mode_key == "cabinet_specs")
        if isinstance(board_host, QWidget):
            board_host.setVisible(mode_key == "cabinet_specs")
        self._refresh_production_nav_buttons(use_dashboard)


