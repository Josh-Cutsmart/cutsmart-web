from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QSize, Qt
from PySide6.QtGui import QColor, QIcon, QIntValidator, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from cutsmart.qtui.screens.dashboard_widgets import ReorderableTableWidget
from cutsmart.qtui.screens.sales_rooms_mixin import AnimatedOutlineButton
from cutsmart.ui.style import TEXT_MAIN


class CompanyPageBuilderMixin:

    def _build_company_page(self) -> QWidget:
        page = QWidget()
        page.setObjectName("CompanySettingsPage")
        page.setStyleSheet("QWidget#CompanySettingsPage { background: #F5F6F8; color: #1F2937; }")
        layout = QVBoxLayout(page)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(14)

        head_row = QHBoxLayout()
        dashboard_title_card = QFrame()
        dashboard_title_card.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 12px; }")
        dashboard_title_row = QHBoxLayout(dashboard_title_card)
        dashboard_title_row.setContentsMargins(12, 8, 12, 8)
        dashboard_title_row.setSpacing(8)
        dashboard_icon_lbl = QLabel()
        dashboard_icon_lbl.setFixedSize(28, 28)
        dashboard_icon_lbl.setStyleSheet("QLabel { background: transparent; border: none; }")
        dashboard_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "settings.png"
        dashboard_icon_pix = QPixmap(str(dashboard_icon_path)) if dashboard_icon_path.exists() else QPixmap()
        if not dashboard_icon_pix.isNull():
            dashboard_icon_lbl.setPixmap(dashboard_icon_pix.scaled(24, 24, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        dashboard_title_row.addWidget(dashboard_icon_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
        title = QLabel("Settings")
        title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 24px; font-weight: 700; background: transparent; border: none;")
        dashboard_title_row.addWidget(title, 0, Qt.AlignmentFlag.AlignVCenter)

        def _save_all_company_settings() -> None:
            calls = [
                "_autosave_company_general_preferences",
                "_autosave_company_statuses",
                "_autosave_company_roles",
                "_autosave_company_board_thicknesses",
                "_autosave_company_board_finishes",
                "_autosave_company_sheet_sizes",
                "_autosave_company_nesting",
                "_autosave_company_part_types",
                "_autosave_company_hardware",
                "_autosave_company_item_categories",
                "_autosave_company_inventory",
                "_autosave_company_job_types",
                "_autosave_company_quote_extras",
                "_autosave_company_sales_discounts",
                "_autosave_company_cutlist_columns",
            ]
            for name in calls:
                fn = getattr(self, name, None)
                if callable(fn):
                    try:
                        fn()
                    except Exception:
                        pass
            self._refresh_company()

        def _make_save_button() -> QPushButton:
            b = QPushButton("Save Changes")
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setFixedHeight(36)
            b.clicked.connect(_save_all_company_settings)
            b.setStyleSheet(
                "QPushButton { background:#16A34A; color:#FFFFFF; border:1px solid #12843D; border-radius:10px; padding:0 14px; font-size:13px; font-weight:800; }"
                "QPushButton:hover { background:#138A3E; }"
            )
            return b

        save_btn = _make_save_button()
        last_saved = QLabel("Last saved just now")
        last_saved.setAlignment(Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight)
        last_saved.setStyleSheet("color:#64748B; font-size:12px; font-weight:600;")
        dashboard_title_row.addStretch(1)
        dashboard_title_row.addWidget(last_saved, 0, Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight)
        dashboard_title_row.addWidget(save_btn, 0, Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight)
        head_row.addWidget(dashboard_title_card, 1)
        layout.addLayout(head_row)

        body = QHBoxLayout()
        body.setSpacing(14)

        tabs_card = QFrame()
        tabs_card.setObjectName("CompanyTabsCard")
        tabs_card.setFixedWidth(260)
        tabs_card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #E4E6EC;"
            "border-radius: 14px;"
            "}"
        )
        tabs_layout = QVBoxLayout(tabs_card)
        tabs_layout.setContentsMargins(12, 12, 12, 12)
        tabs_layout.setSpacing(8)

        search = QLineEdit()
        search.setPlaceholderText("Search settings...")
        search.setFixedHeight(36)
        search.setStyleSheet(
            "QLineEdit { background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:0 10px; font-size:13px; color:#334155; }"
        )
        tabs_layout.addWidget(search)

        active_section = {"key": ""}
        menu_links: list[tuple[QPushButton, str, str]] = []
        search_targets: dict[int, list[tuple[QWidget, str, str]]] = {0: [], 1: [], 2: [], 3: []}

        def _apply_settings_filters() -> None:
            query = str(search.text() or "").strip().lower()
            idx = int(self._company_settings_stack.currentIndex() if self._company_settings_stack else 0)
            section_key = str(active_section.get("key") or "")
            for tab_idx, rows in search_targets.items():
                for widget, tokens, key in rows:
                    if tab_idx != idx:
                        widget.setVisible(True)
                        continue
                    # Keep Access & Workflow exclusive to Staff & Permissions.
                    if key == "staff_permissions" and section_key != "staff_permissions":
                        widget.setVisible(False)
                        continue
                    section_match = (not section_key) or (section_key == key)
                    search_match = (not query) or (query in tokens)
                    widget.setVisible(section_match and search_match)

        def _open_top_tab(tab_key: str) -> None:
            active_section["key"] = ""
            self._set_company_settings_tab(tab_key)
            _apply_settings_filters()
            _sync_submenu_active_styles()

        def _open_sub_section(section_key: str, tab_key: str) -> None:
            active_section["key"] = section_key
            self._set_company_settings_tab(tab_key)
            _apply_settings_filters()
            try:
                self._clear_company_hardware_inline_editor()
            except Exception:
                pass
            _sync_submenu_active_styles()

        self._open_company_settings_subsection = _open_sub_section


        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet("QFrame { color: #E2E8F0; background:#E2E8F0; min-height:1px; max-height:1px; border:none; }")
        tabs_layout.addWidget(sep)

        icon_dir = Path(__file__).resolve().parent.parent / "assets" / "icons"

        def _menu_btn(text: str, tab_key: str, section_key: str, icon_name: str = "") -> QPushButton:
            b = QPushButton(text)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setMinimumHeight(36)
            if icon_name:
                icon_path = icon_dir / icon_name
                if icon_path.exists():
                    b.setIcon(QIcon(str(icon_path)))
                    b.setIconSize(QSize(18, 18))
            b.setStyleSheet(
                "QPushButton { background: transparent; color:#5B6472; border:none; border-radius:9px; text-align:left; padding:0 10px; font-size:12px; font-weight:600; }"
                "QPushButton:hover { background:#F1F5F9; color:#334155; }"
            )
            b.clicked.connect(lambda: _open_sub_section(section_key, tab_key))
            menu_links.append((b, tab_key, section_key))
            return b

        tabs_layout.addWidget(_menu_btn("Company", "general", "company_profile", "company.png"))
        tabs_layout.addWidget(_menu_btn("Sales", "sales", "sales_pricing", "dollar-circle.png"))
        tabs_layout.addWidget(_menu_btn("Cutlist Defaults", "production", "cutlist_defaults", "saw.png"))
        tabs_layout.addWidget(_menu_btn("Nesting Settings", "production", "nesting", "layers.png"))
        tabs_layout.addWidget(_menu_btn("Materials && Board Types", "production", "materials", "building-materials.png"))
        tabs_layout.addWidget(_menu_btn("Hardware", "hardware", "hardware", "hardware.png"))
        tabs_layout.addWidget(_menu_btn("Staff && Permissions", "general", "staff_permissions", "users.png"))
        tabs_layout.addWidget(_menu_btn("Notifications", "sales", "notifications", "bell.png"))
        tabs_layout.addWidget(_menu_btn("Integrations", "sales", "integrations", "plan-integrate.png"))
        tabs_layout.addWidget(_menu_btn("Backup Data", "sales", "backup_data", "secure-backup.png"))
        tabs_layout.addStretch(1)
        info_sep = QFrame()
        info_sep.setFrameShape(QFrame.Shape.HLine)
        info_sep.setStyleSheet("QFrame { color:#E2E8F0; background:#E2E8F0; min-height:1px; max-height:1px; border:none; }")
        tabs_layout.addWidget(info_sep)

        info_layout = QVBoxLayout()
        info_layout.setContentsMargins(0, 10, 0, 0)
        info_layout.setSpacing(8)

        def _make_label(text: str, muted: bool = False) -> QLabel:
            lbl = QLabel(text)
            if muted:
                lbl.setStyleSheet("color: #5B6472; font-size: 12px; font-weight: 700;")
            else:
                lbl.setStyleSheet("color: #101827; font-size: 13px; font-weight: 600;")
                lbl.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            return lbl

        rows_wrap = QWidget()
        rows_wrap.setStyleSheet("QWidget { background: transparent; border: none; }")
        rows_layout = QVBoxLayout(rows_wrap)
        rows_layout.setContentsMargins(10, 0, 10, 0)
        rows_layout.setSpacing(6)

        def _add_info_row(caption: str) -> QLabel:
            row = QHBoxLayout()
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(8)
            row.addWidget(_make_label(caption, muted=True))
            value = _make_label("-")
            row.addWidget(value, 1)
            rows_layout.addLayout(row)
            return value

        self._company_info_name_value = _add_info_row("Company Name")
        self._company_info_id_value = _add_info_row("Company ID")
        self._company_info_plan_value = _add_info_row("Plan")
        self._company_info_join_key_value = _add_info_row("Join Key")
        info_layout.addWidget(rows_wrap)

        join_btn = QPushButton("Show key")
        join_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        join_btn.setFixedHeight(36)
        join_btn.setStyleSheet(
            "QPushButton { background: #EEF1F6; color: #44556D; border: none; border-radius: 9px; padding: 0 9px; font-size: 12px; font-weight: 700; text-align:center; }"
            "QPushButton:hover { background: #E3E8F0; }"
        )
        join_btn.setProperty("revealed", False)
        join_btn.clicked.connect(self._show_company_join_key_temporarily)
        self._company_info_join_key_btn = join_btn
        info_layout.addWidget(join_btn)
        tabs_layout.addLayout(info_layout)
        body.addWidget(tabs_card)

        right_col = QVBoxLayout()
        right_col.setContentsMargins(0, 0, 0, 0)
        right_col.setSpacing(10)
        self._company_settings_stack = QStackedWidget()
        self._company_settings_stack.setObjectName("CompanySettingsStack")
        self._company_settings_stack.setStyleSheet(
            "QStackedWidget#CompanySettingsStack { background:#F5F6F8; border:none; }"
            "QStackedWidget#CompanySettingsStack > QWidget { background:#F5F6F8; border:none; }"
        )

        def _section_header(text: str, subtitle: str = "") -> QLabel:
            if subtitle:
                lbl = QLabel(f"<div style='font-size:15px; font-weight:800; color:#1F2937;'>{text}</div>"
                             f"<div style='font-size:12px; font-weight:600; color:#64748B; margin-top:2px;'>{subtitle}</div>")
            else:
                lbl = QLabel(f"<div style='font-size:15px; font-weight:800; color:#1F2937;'>{text}</div>")
            lbl.setTextFormat(Qt.TextFormat.RichText)
            lbl.setWordWrap(True)
            lbl.setStyleSheet(
                "QLabel { padding: 2px 2px 4px 2px; }"
            )
            return lbl

        def _wrap_scroll_page(content: QWidget) -> QScrollArea:
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(QFrame.Shape.NoFrame)
            scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
            scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
            scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
            scroll.viewport().setStyleSheet("background:#F5F6F8; border:none;")
            content.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
            scroll.setWidget(content)
            return scroll

        general_page = QWidget()
        general_layout = QGridLayout(general_page)
        general_layout.setContentsMargins(0, 0, 0, 0)
        general_layout.setHorizontalSpacing(10)
        general_layout.setVerticalSpacing(10)
        for col in range(3):
            general_layout.setColumnStretch(col, 1)

        company_shell_style = "background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px;"
        company_top_style = (
            "background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; "
            "border-bottom-left-radius:0px; border-bottom-right-radius:0px;"
        )
        company_title_style = "QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }"

        def _build_company_sales_style_card(title_text: str, object_name: str, title_object_name: str) -> tuple[QFrame, QVBoxLayout]:
            card = QFrame()
            card.setObjectName(object_name)
            card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
            card.setStyleSheet(f"QFrame#{object_name} {{ {company_shell_style} }}")
            card_layout = QVBoxLayout(card)
            card_layout.setContentsMargins(0, 0, 0, 0)
            card_layout.setSpacing(0)

            top = QFrame()
            top.setObjectName(title_object_name)
            top.setFixedHeight(50)
            top.setStyleSheet(f"QFrame#{title_object_name} {{ {company_top_style} }}")
            top_layout = QHBoxLayout(top)
            top_layout.setContentsMargins(14, 16, 14, 10)
            top_layout.setSpacing(8)
            title = QLabel(title_text)
            title.setStyleSheet(company_title_style)
            top_layout.addWidget(title, 0)
            top_layout.addStretch(1)
            card_layout.addWidget(top)

            div = QFrame()
            div.setFixedHeight(1)
            div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
            card_layout.addWidget(div)

            content = QWidget()
            content.setObjectName(f"{object_name}Body")
            content.setStyleSheet(
                f"QWidget#{object_name}Body {{ "
                "background:#F8FAFD; border:none; "
                "border-bottom-left-radius:14px; border-bottom-right-radius:14px; "
                "}"
            )
            content_layout = QVBoxLayout(content)
            content_layout.setContentsMargins(14, 10, 14, 8)
            content_layout.setSpacing(8)
            card_layout.addWidget(content, 1)
            return card, content_layout

        theme_card, theme_layout = _build_company_sales_style_card("THEME", "CompanyThemeCard", "CompanyThemeTop")

        theme_row = QHBoxLayout()
        theme_title = QLabel("Theme Color")
        theme_title.setStyleSheet("color:#334155; font-size:12px; font-weight:700;")
        theme_row.addWidget(theme_title)
        theme_row.addSpacing(8)

        theme_swatch = QPushButton("")
        theme_swatch.setCursor(Qt.CursorShape.PointingHandCursor)
        theme_swatch.setFixedSize(44, 24)
        theme_swatch.clicked.connect(self._pick_company_theme_color)
        theme_swatch.setStyleSheet("QPushButton { background: #2F6BFF; border-radius: 8px; border: 1px solid #D7DCE5; }")
        self._company_theme_preview = theme_swatch
        theme_row.addWidget(theme_swatch)
        theme_row.addStretch(1)

        theme_layout.addLayout(theme_row)

        logo_row = QHBoxLayout()
        logo_row.setSpacing(8)
        logo_lbl = QLabel("Company Logo")
        logo_lbl.setStyleSheet("color:#334155; font-size:12px; font-weight:700;")
        logo_row.addWidget(logo_lbl)
        self._company_logo_input = QLineEdit()
        self._company_logo_input.setReadOnly(True)
        self._company_logo_input.setPlaceholderText("No logo selected")
        self._company_logo_input.setFixedHeight(24)
        self._company_logo_input.setStyleSheet(
            "QLineEdit {"
            "background: #FFFFFF; border: 1px solid #E5E5EA; border-radius: 8px; padding: 3px 8px;"
            "font-size: 12px;"
            "}"
        )
        logo_row.addWidget(self._company_logo_input, stretch=1)

        browse_logo_btn = QPushButton("Browse")
        browse_logo_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        browse_logo_btn.clicked.connect(self._pick_company_logo)
        browse_logo_btn.setStyleSheet(
            "QPushButton { background: #E8F0FF; color: #2F6BFF; border: none; border-radius: 9px; padding: 8px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #DCE7FF; }"
        )
        logo_row.addWidget(browse_logo_btn)

        theme_layout.addLayout(logo_row)

        app_prefs_card, app_prefs_lay = _build_company_sales_style_card(
            "APPLICATION PREFERENCES", "CompanyAppPrefsCard", "CompanyAppPrefsTop"
        )
        app_grid = QGridLayout()
        app_grid.setHorizontalSpacing(10)
        app_grid.setVerticalSpacing(8)
        lbl_style = "QLabel { color:#334155; font-size:12px; font-weight:700; }"
        line_edit_style = "QLineEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:3px 8px; font-size:12px; min-height:24px; }"
        combo_style = (
            "QComboBox {"
            "background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px;"
            "padding: 2px 8px; font-size: 12px; color:#1F2937;"
            "}"
            "QComboBox:focus { border:1px solid #AFC2DA; }"
            "QComboBox::drop-down { border:none; width:18px; }"
        )

        app_grid.addWidget(QLabel("Company Name"), 0, 0)
        self._company_general_name_input = QLineEdit()
        self._company_general_name_input.setStyleSheet(line_edit_style)
        app_grid.addWidget(self._company_general_name_input, 0, 1)

        app_grid.addWidget(QLabel("Default Currency"), 1, 0)
        self._company_general_currency_combo = QComboBox()
        self._company_general_currency_combo.setStyleSheet(combo_style)
        for c in ["USD - US Dollar", "EUR - Euro", "GBP - British Pound", "AUD - Australian Dollar", "NZD - New Zealand Dollar", "CAD - Canadian Dollar", "JPY - Japanese Yen", "CNY - Chinese Yuan", "SGD - Singapore Dollar", "AED - UAE Dirham"]:
            self._company_general_currency_combo.addItem(c)
        app_grid.addWidget(self._company_general_currency_combo, 1, 1)

        app_grid.addWidget(QLabel("Measurement Unit"), 2, 0)
        unit_wrap = QWidget()
        unit_row = QHBoxLayout(unit_wrap)
        unit_row.setContentsMargins(0, 0, 0, 0)
        unit_row.setSpacing(12)
        self._company_general_unit_mm = QCheckBox("mm")
        self._company_general_unit_in = QCheckBox("inches")
        unit_row.addWidget(self._company_general_unit_mm)
        unit_row.addWidget(self._company_general_unit_in)
        unit_row.addStretch(1)
        app_grid.addWidget(unit_wrap, 2, 1)

        app_grid.addWidget(QLabel("Date Format"), 3, 0)
        self._company_general_date_format_combo = QComboBox()
        self._company_general_date_format_combo.setStyleSheet(combo_style)
        for fmt in ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD MMM YYYY"]:
            self._company_general_date_format_combo.addItem(fmt)
        app_grid.addWidget(self._company_general_date_format_combo, 3, 1)

        app_grid.addWidget(QLabel("Time Zone"), 4, 0)
        self._company_general_timezone_combo = QComboBox()
        self._company_general_timezone_combo.setStyleSheet(combo_style)
        for tz in [
            "NZT (Pacific/Auckland)",
            "Pacific/Auckland",
            "Australia/Sydney",
            "Australia/Perth",
            "UTC",
            "Europe/London",
            "America/New_York",
            "America/Los_Angeles",
            "Asia/Singapore",
        ]:
            self._company_general_timezone_combo.addItem(tz)
        for hr in range(-12, 15):
            sign = "+" if hr >= 0 else "-"
            self._company_general_timezone_combo.addItem(f"UTC{sign}{abs(hr):02d}")
        app_grid.addWidget(self._company_general_timezone_combo, 4, 1)
        app_grid.addWidget(QLabel("Recently Deleted Time"), 5, 0)
        self._company_general_deleted_retention_combo = QComboBox()
        self._company_general_deleted_retention_combo.setStyleSheet(combo_style)
        for opt in ["1 day", "1 week", "2 weeks", "1 month", "2 months", "3 months", "4 months", "6 months", "1 year"]:
            self._company_general_deleted_retention_combo.addItem(opt)
        app_grid.addWidget(self._company_general_deleted_retention_combo, 5, 1)
        app_prefs_lay.addLayout(app_grid)
        for r in range(6):
            w0 = app_grid.itemAtPosition(r, 0).widget()
            if isinstance(w0, QLabel):
                w0.setStyleSheet(lbl_style)

        status_card, status_layout = _build_company_sales_style_card(
            "PROJECT STATUSES", "CompanyStatusCard", "CompanyStatusTop"
        )

        status_table = ReorderableTableWidget()
        status_table.setColumnCount(3)
        status_table.setHorizontalHeaderLabels(["", "Name", "Color"])
        status_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        status_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        status_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        status_table.verticalHeader().setVisible(False)
        status_table.horizontalHeader().setVisible(False)
        status_table.setFrameShape(QFrame.Shape.NoFrame)
        status_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        status_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        status_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        status_table.setDragEnabled(True)
        status_table.setAcceptDrops(True)
        status_table.viewport().setAcceptDrops(True)
        status_table.setDropIndicatorShown(False)
        status_table.setDragDropOverwriteMode(False)
        status_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        status_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        status_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        status_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        status_table.setStyleSheet(
            "QTableWidget {"
            "background: transparent; border: none; outline: none;"
            "}"
        )
        self._company_status_table = status_table
        status_table.setProperty("compactRows", True)
        status_table.setShowGrid(False)
        status_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("statuses", self._autosave_company_statuses))
        status_table.rows_reordered.connect(self._on_status_rows_reordered)
        status_layout.addWidget(status_table)

        actions = QHBoxLayout()
        add_row_btn = QPushButton("Add")
        add_row_btn.clicked.connect(self._add_company_status_row)
        add_row_btn.setStyleSheet(
            "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 1px solid #BFE8CF; border-radius: 9px; padding: 7px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #BEE6D0; border: 1px solid #9ED6B8; color: #17552F; }"
        )
        actions.addWidget(add_row_btn)

        actions.addStretch(1)
        status_layout.addLayout(actions)

        roles_card, roles_layout = _build_company_sales_style_card(
            "ROLES", "CompanyRolesCard", "CompanyRolesTop"
        )
        roles_theme = self._sales_theme_hex()
        roles_theme_soft = QColor(roles_theme).lighter(190).name()
        add_role_btn = AnimatedOutlineButton("+ Add")
        add_role_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_role_btn.setFixedSize(74, 30)
        add_role_btn.clicked.connect(self._add_company_role_row)
        add_role_btn.setStyleSheet(
            "QPushButton { "
            f"background: {roles_theme_soft}; color: {roles_theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_role_btn.set_outline_color(QColor(roles_theme))
        add_role_btn.set_outline_duration_ms(150)
        roles_top = roles_card.findChild(QFrame, "CompanyRolesTop")
        if isinstance(roles_top, QFrame):
            roles_top_lay = roles_top.layout()
            if isinstance(roles_top_lay, QHBoxLayout):
                roles_top_lay.setContentsMargins(14, 10, 14, 10)
                roles_top_lay.insertWidget(1, add_role_btn, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

        roles_table = ReorderableTableWidget()
        roles_table.setColumnCount(4)
        roles_table.setHorizontalHeaderLabels(["", "Role Name", "Color", "Permissions"])
        roles_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        roles_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        roles_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        roles_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        roles_table.verticalHeader().setVisible(False)
        roles_table.horizontalHeader().setVisible(False)
        roles_table.setFrameShape(QFrame.Shape.NoFrame)
        roles_table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        roles_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        roles_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        roles_table.setDragEnabled(True)
        roles_table.setAcceptDrops(True)
        roles_table.viewport().setAcceptDrops(True)
        roles_table.setDropIndicatorShown(False)
        roles_table.setDragDropOverwriteMode(False)
        roles_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        roles_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        roles_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        roles_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        roles_table.setStyleSheet(
            "QTableWidget {"
            "background: transparent; border: none; outline: none;"
            "}"
            "QTableWidget::item:selected { background: transparent; color: #334155; }"
            "QTableWidget::item:focus { outline: none; }"
        )
        self._company_roles_table = roles_table
        roles_table.setProperty("compactRows", True)
        roles_table.setShowGrid(False)
        roles_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("roles", self._autosave_company_roles))
        roles_table.rows_reordered.connect(self._on_role_rows_reordered)
        roles_layout.addWidget(roles_table)
        general_identity_wrap = QWidget()
        general_identity_wrap.setStyleSheet("QWidget { background: transparent; border: none; }")
        general_identity_lay = QVBoxLayout(general_identity_wrap)
        general_identity_lay.setContentsMargins(0, 0, 0, 0)
        general_identity_lay.setSpacing(8)
        general_identity_row = QHBoxLayout()
        general_identity_row.setSpacing(10)
        general_identity_row.addWidget(app_prefs_card, 1, Qt.AlignmentFlag.AlignTop)
        general_identity_row.addWidget(theme_card, 1, Qt.AlignmentFlag.AlignTop)
        general_identity_lay.addLayout(general_identity_row)
        general_layout.addWidget(general_identity_wrap, 0, 0, 1, 3)

        general_workflow_wrap = QWidget()
        general_workflow_wrap.setStyleSheet("QWidget { background: transparent; border: none; }")
        general_workflow_lay = QVBoxLayout(general_workflow_wrap)
        general_workflow_lay.setContentsMargins(0, 0, 0, 0)
        general_workflow_lay.setSpacing(8)
        staff_panel = self._build_staff_page()
        general_workflow_row = QHBoxLayout()
        general_workflow_row.setSpacing(10)
        general_workflow_row.addWidget(staff_panel, 3)
        general_workflow_row.addWidget(roles_card, 1, Qt.AlignmentFlag.AlignTop)
        general_workflow_lay.addLayout(general_workflow_row)
        general_layout.addWidget(general_workflow_wrap, 1, 0, 1, 3)

        production_page = QWidget()
        production_layout = QGridLayout(production_page)
        production_layout.setContentsMargins(0, 0, 0, 0)
        production_layout.setHorizontalSpacing(10)
        production_layout.setVerticalSpacing(10)
        for col in range(3):
            production_layout.setColumnStretch(col, 1)
        materials_theme = self._sales_theme_hex()
        materials_theme_soft = QColor(materials_theme).lighter(190).name()

        board_card = QFrame()
        board_card.setObjectName("CompanyBoardCard")
        board_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        board_card.setStyleSheet(
            "QFrame#CompanyBoardCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        board_card_layout = QVBoxLayout(board_card)
        board_card_layout.setContentsMargins(0, 0, 0, 0)
        board_card_layout.setSpacing(0)
        board_top = QFrame()
        board_top.setObjectName("CompanyBoardTop")
        board_top.setFixedHeight(50)
        board_top.setStyleSheet(
            "QFrame#CompanyBoardTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        board_top_lay = QHBoxLayout(board_top)
        board_top_lay.setContentsMargins(14, 16, 14, 10)
        board_top_lay.setSpacing(6)
        board_title = QLabel("SHEET THICKNESSES")
        board_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        board_top_lay.addWidget(board_title, 0)
        add_thick = AnimatedOutlineButton("+ Add")
        add_thick.setCursor(Qt.CursorShape.PointingHandCursor)
        add_thick.clicked.connect(self._add_company_board_thickness_row)
        add_thick.setStyleSheet(
            "QPushButton { "
            f"background: {materials_theme_soft}; color: {materials_theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_thick.set_outline_color(QColor(materials_theme))
        add_thick.set_outline_duration_ms(150)
        board_top_lay.addWidget(add_thick, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        board_top_lay.addStretch(1)
        board_card_layout.addWidget(board_top)
        board_div = QFrame()
        board_div.setFixedHeight(1)
        board_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        board_card_layout.addWidget(board_div)
        board_content = QWidget()
        board_content.setObjectName("CompanyBoardBody")
        board_content.setStyleSheet(
            "QWidget#CompanyBoardBody { background:#F8FAFD; border:none; border-bottom-left-radius:14px; border-bottom-right-radius:14px; }"
        )
        board_layout = QVBoxLayout(board_content)
        board_layout.setContentsMargins(14, 10, 14, 8)
        board_layout.setSpacing(8)
        board_table = ReorderableTableWidget()
        board_table.setColumnCount(2)
        board_table.setHorizontalHeaderLabels(["", "Thickness (mm)"])
        board_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        board_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        board_table.verticalHeader().setVisible(False)
        board_table.horizontalHeader().setVisible(False)
        board_table.setFrameShape(QFrame.Shape.NoFrame)
        board_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        board_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        board_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        board_table.setDragEnabled(True)
        board_table.setAcceptDrops(True)
        board_table.viewport().setAcceptDrops(True)
        board_table.setDropIndicatorShown(False)
        board_table.setDragDropOverwriteMode(False)
        board_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        board_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        board_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        board_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        board_table.setStyleSheet(
            "QTableWidget { background: #F8FAFD; border: none; outline: none; }"
            "QTableWidget::item { background: #F8FAFD; }"
            "QTableWidget QWidget { background: transparent; }"
        )
        self._company_board_table = board_table
        board_table.setProperty("compactRows", True)
        board_table.setShowGrid(False)
        board_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("board_thickness", self._autosave_company_board_thicknesses))
        board_table.rows_reordered.connect(self._on_board_rows_reordered)
        board_layout.addWidget(board_table)
        board_card_layout.addWidget(board_content, 1)

        finish_card = QFrame()
        finish_card.setObjectName("CompanyBoardFinishesCard")
        finish_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        finish_card.setStyleSheet(
            "QFrame#CompanyBoardFinishesCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        finish_card_layout = QVBoxLayout(finish_card)
        finish_card_layout.setContentsMargins(0, 0, 0, 0)
        finish_card_layout.setSpacing(0)
        finish_top = QFrame()
        finish_top.setObjectName("CompanyBoardFinishesTop")
        finish_top.setFixedHeight(50)
        finish_top.setStyleSheet(
            "QFrame#CompanyBoardFinishesTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        finish_top_lay = QHBoxLayout(finish_top)
        finish_top_lay.setContentsMargins(14, 16, 14, 10)
        finish_top_lay.setSpacing(6)
        finish_title = QLabel("BOARD FINISHES")
        finish_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        finish_top_lay.addWidget(finish_title, 0)
        add_finish = AnimatedOutlineButton("+ Add")
        add_finish.setCursor(Qt.CursorShape.PointingHandCursor)
        add_finish.clicked.connect(self._add_company_board_finish_row)
        add_finish.setStyleSheet(
            "QPushButton { "
            f"background: {materials_theme_soft}; color: {materials_theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_finish.set_outline_color(QColor(materials_theme))
        add_finish.set_outline_duration_ms(150)
        finish_top_lay.addWidget(add_finish, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        finish_top_lay.addStretch(1)
        finish_card_layout.addWidget(finish_top)
        finish_div = QFrame()
        finish_div.setFixedHeight(1)
        finish_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        finish_card_layout.addWidget(finish_div)
        finish_content = QWidget()
        finish_content.setObjectName("CompanyBoardFinishesBody")
        finish_content.setStyleSheet(
            "QWidget#CompanyBoardFinishesBody { background:#F8FAFD; border:none; border-bottom-left-radius:14px; border-bottom-right-radius:14px; }"
        )
        finish_layout = QVBoxLayout(finish_content)
        finish_layout.setContentsMargins(14, 10, 14, 8)
        finish_layout.setSpacing(8)
        finish_table = ReorderableTableWidget()
        finish_table.setColumnCount(2)
        finish_table.setHorizontalHeaderLabels(["", "Finish"])
        finish_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        finish_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        finish_table.verticalHeader().setVisible(False)
        finish_table.horizontalHeader().setVisible(False)
        finish_table.setFrameShape(QFrame.Shape.NoFrame)
        finish_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        finish_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        finish_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        finish_table.setDragEnabled(True)
        finish_table.setAcceptDrops(True)
        finish_table.viewport().setAcceptDrops(True)
        finish_table.setDropIndicatorShown(False)
        finish_table.setDragDropOverwriteMode(False)
        finish_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        finish_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        finish_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        finish_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        finish_table.setStyleSheet(
            "QTableWidget { background: #F8FAFD; border: none; outline: none; }"
            "QTableWidget::item { background: #F8FAFD; }"
            "QTableWidget QWidget { background: transparent; }"
        )
        self._company_board_finishes_table = finish_table
        finish_table.setProperty("compactRows", True)
        finish_table.setShowGrid(False)
        finish_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("board_finishes", self._autosave_company_board_finishes))
        finish_table.rows_reordered.connect(self._on_board_finishes_rows_reordered)
        finish_layout.addWidget(finish_table)
        finish_card_layout.addWidget(finish_content, 1)

        sheet_card = QFrame()
        sheet_card.setObjectName("CompanySheetSizesCard")
        sheet_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        sheet_card.setStyleSheet(
            "QFrame#CompanySheetSizesCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        sheet_card_layout = QVBoxLayout(sheet_card)
        sheet_card_layout.setContentsMargins(0, 0, 0, 0)
        sheet_card_layout.setSpacing(0)
        sheet_top = QFrame()
        sheet_top.setObjectName("CompanySheetSizesTop")
        sheet_top.setFixedHeight(50)
        sheet_top.setStyleSheet(
            "QFrame#CompanySheetSizesTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        sheet_top_lay = QHBoxLayout(sheet_top)
        sheet_top_lay.setContentsMargins(14, 16, 14, 10)
        sheet_top_lay.setSpacing(6)
        sheet_title = QLabel("SHEET SIZES")
        sheet_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        sheet_top_lay.addWidget(sheet_title, 0)
        add_sheet = AnimatedOutlineButton("+ Add")
        add_sheet.setCursor(Qt.CursorShape.PointingHandCursor)
        add_sheet.clicked.connect(self._add_company_sheet_size_row)
        add_sheet.setStyleSheet(
            "QPushButton { "
            f"background: {materials_theme_soft}; color: {materials_theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_sheet.set_outline_color(QColor(materials_theme))
        add_sheet.set_outline_duration_ms(150)
        sheet_top_lay.addWidget(add_sheet, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        sheet_top_lay.addStretch(1)
        sheet_card_layout.addWidget(sheet_top)
        sheet_div = QFrame()
        sheet_div.setFixedHeight(1)
        sheet_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        sheet_card_layout.addWidget(sheet_div)
        sheet_content = QWidget()
        sheet_content.setObjectName("CompanySheetSizesBody")
        sheet_content.setStyleSheet(
            "QWidget#CompanySheetSizesBody { background:#F8FAFD; border:none; border-bottom-left-radius:14px; border-bottom-right-radius:14px; }"
        )
        sheet_layout = QVBoxLayout(sheet_content)
        sheet_layout.setContentsMargins(14, 10, 14, 8)
        sheet_layout.setSpacing(8)
        sheet_table = ReorderableTableWidget()
        sheet_table.setColumnCount(4)
        sheet_table.setHorizontalHeaderLabels(["", "Height", "Width", "Default"])
        sheet_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        sheet_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        sheet_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        sheet_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        sheet_table.verticalHeader().setVisible(False)
        sheet_table.horizontalHeader().setVisible(True)
        sheet_table.setFrameShape(QFrame.Shape.NoFrame)
        sheet_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        sheet_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        sheet_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        sheet_table.setDragEnabled(True)
        sheet_table.setAcceptDrops(True)
        sheet_table.viewport().setAcceptDrops(True)
        sheet_table.setDropIndicatorShown(False)
        sheet_table.setDragDropOverwriteMode(False)
        sheet_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        sheet_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        sheet_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        sheet_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        sheet_table.setStyleSheet(
            "QTableWidget { background: #F8FAFD; border: none; outline: none; }"
            "QTableWidget::item { background: #F8FAFD; }"
            "QTableWidget QWidget { background: transparent; }"
            "QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        self._company_sheet_sizes_table = sheet_table
        sheet_table.setProperty("compactRows", True)
        sheet_table.setShowGrid(False)
        sheet_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes))
        sheet_table.rows_reordered.connect(self._on_sheet_sizes_rows_reordered)
        sheet_layout.addWidget(sheet_table)
        sheet_card_layout.addWidget(sheet_content, 1)

        usage_card = QFrame()
        usage_card.setObjectName("CompanyBoardUsageCard")
        usage_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        usage_card.setStyleSheet(
            "QFrame#CompanyBoardUsageCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        usage_card_layout = QVBoxLayout(usage_card)
        usage_card_layout.setContentsMargins(0, 0, 0, 0)
        usage_card_layout.setSpacing(0)
        usage_top = QFrame()
        usage_top.setObjectName("CompanyBoardUsageTop")
        usage_top.setFixedHeight(50)
        usage_top.setStyleSheet(
            "QFrame#CompanyBoardUsageTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        usage_top_lay = QHBoxLayout(usage_top)
        usage_top_lay.setContentsMargins(14, 16, 14, 10)
        usage_top_lay.setSpacing(6)
        usage_title = QLabel("MATERIAL USAGE MEMORY")
        usage_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        usage_top_lay.addWidget(usage_title, 0)
        add_usage = AnimatedOutlineButton("+ Add")
        add_usage.setCursor(Qt.CursorShape.PointingHandCursor)
        add_usage.clicked.connect(self._add_company_board_material_usage_row)
        add_usage.setStyleSheet(
            "QPushButton { "
            f"background: {materials_theme_soft}; color: {materials_theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_usage.set_outline_color(QColor(materials_theme))
        add_usage.set_outline_duration_ms(150)
        usage_top_lay.addWidget(add_usage, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        usage_top_lay.addStretch(1)
        usage_card_layout.addWidget(usage_top)
        usage_div = QFrame()
        usage_div.setFixedHeight(1)
        usage_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        usage_card_layout.addWidget(usage_div)
        usage_content = QWidget()
        usage_content.setObjectName("CompanyBoardUsageBody")
        usage_content.setStyleSheet(
            "QWidget#CompanyBoardUsageBody { background:#F8FAFD; border:none; border-bottom-left-radius:14px; border-bottom-right-radius:14px; }"
        )
        usage_layout = QVBoxLayout(usage_content)
        usage_layout.setContentsMargins(14, 10, 14, 8)
        usage_layout.setSpacing(8)
        usage_table = QTableWidget()
        usage_table.setColumnCount(3)
        usage_table.setHorizontalHeaderLabels(["", "Colour", "Used"])
        try:
            usage_table.horizontalHeaderItem(1).setTextAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        except Exception:
            pass
        usage_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        usage_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        usage_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        usage_table.verticalHeader().setVisible(False)
        usage_table.horizontalHeader().setVisible(True)
        usage_table.setFrameShape(QFrame.Shape.NoFrame)
        usage_table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        usage_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        usage_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        usage_table.setDragEnabled(False)
        usage_table.setAcceptDrops(False)
        usage_table.viewport().setAcceptDrops(False)
        usage_table.setDropIndicatorShown(False)
        usage_table.setDragDropMode(QAbstractItemView.DragDropMode.NoDragDrop)
        usage_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        usage_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        usage_table.setStyleSheet(
            "QTableWidget { background: #F8FAFD; border: none; outline: none; }"
            "QTableWidget::item { background: #F8FAFD; }"
            "QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        usage_table.setProperty("compactRows", True)
        usage_table.setShowGrid(False)
        self._company_board_material_usage_table = usage_table
        usage_layout.addWidget(usage_table)
        usage_card_layout.addWidget(usage_content, 1)

        nest_card = QFrame()
        nest_card.setObjectName("CompanyNestingCard")
        nest_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        nest_card.setStyleSheet(
            "QFrame#CompanyNestingCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        nest_card_layout = QVBoxLayout(nest_card)
        nest_card_layout.setContentsMargins(0, 0, 0, 0)
        nest_card_layout.setSpacing(0)
        nest_top = QFrame()
        nest_top.setObjectName("CompanyNestingTop")
        nest_top.setFixedHeight(50)
        nest_top.setStyleSheet(
            "QFrame#CompanyNestingTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        nest_top_lay = QHBoxLayout(nest_top)
        nest_top_lay.setContentsMargins(14, 16, 14, 10)
        nest_top_lay.setSpacing(6)
        nest_title = QLabel("NESTING SETTINGS")
        nest_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        nest_top_lay.addWidget(nest_title, 0)
        nest_top_lay.addStretch(1)
        nest_card_layout.addWidget(nest_top)
        nest_div = QFrame()
        nest_div.setFixedHeight(1)
        nest_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        nest_card_layout.addWidget(nest_div)
        nest_content = QWidget()
        nest_content.setObjectName("CompanyNestingBody")
        nest_content.setStyleSheet(
            "QWidget#CompanyNestingBody { "
            "background:#F8FAFD; border:none; "
            "border-bottom-left-radius:14px; border-bottom-right-radius:14px; "
            "}"
        )
        nest_layout = QVBoxLayout(nest_content)
        nest_layout.setContentsMargins(14, 10, 14, 8)
        nest_layout.setSpacing(8)
        grid = QGridLayout()
        grid.setHorizontalSpacing(10)
        grid.setVerticalSpacing(8)
        labels = [("Sheet Height", "_company_nesting_sheet_h"), ("Sheet Width", "_company_nesting_sheet_w"), ("Kerf", "_company_nesting_kerf"), ("Margin", "_company_nesting_margin")]
        for i2, (lab, attr) in enumerate(labels):
            lbl = QLabel(lab)
            lbl.setStyleSheet("QLabel { color: #374151; font-size: 12px; font-weight: 700; background: transparent; border: none; }")
            edit = QLineEdit()
            edit.textChanged.connect(lambda _=None: self._queue_company_autosave("nesting", self._autosave_company_nesting, delay_ms=700))
            edit.setFixedHeight(24)
            edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
            setattr(self, attr, edit)
            r = i2 // 2
            c = (i2 % 2) * 2
            grid.addWidget(lbl, r, c)
            wrap = QWidget()
            wrap.setStyleSheet("QWidget { background: transparent; border: none; }")
            wrap_row = QHBoxLayout(wrap)
            wrap_row.setContentsMargins(0, 0, 0, 0)
            wrap_row.setSpacing(5)
            edit.setFixedWidth(78)
            unit_suffix = self._measurement_unit_suffix() if hasattr(self, "_measurement_unit_suffix") else "mm"
            mm_lbl = QLabel(unit_suffix)
            mm_lbl.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; background: transparent; border: none; }")
            wrap_row.addWidget(edit)
            wrap_row.addWidget(mm_lbl)
            wrap_row.addStretch(1)
            grid.addWidget(wrap, r, c + 1)
        nest_layout.addLayout(grid)
        nest_card_layout.addWidget(nest_content, 1)

        parts_card = QFrame()
        parts_card.setObjectName("CompanyPartTypesCard")
        parts_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        parts_card.setStyleSheet("QFrame#CompanyPartTypesCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        parts_card_layout = QVBoxLayout(parts_card)
        parts_card_layout.setContentsMargins(0, 0, 0, 0)
        parts_card_layout.setSpacing(0)
        parts_top = QFrame()
        parts_top.setObjectName("CompanyPartTypesTop")
        parts_top.setFixedHeight(50)
        parts_top.setStyleSheet(
            "QFrame#CompanyPartTypesTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        parts_top_lay = QHBoxLayout(parts_top)
        parts_top_lay.setContentsMargins(14, 16, 14, 10)
        parts_top_lay.setSpacing(6)
        parts_title = QLabel("PART TYPES")
        parts_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        parts_top_lay.addWidget(parts_title, 0)
        parts_theme = self._sales_theme_hex()
        parts_theme_soft = QColor(parts_theme).lighter(190).name()
        add_part = AnimatedOutlineButton("+ Add")
        add_part.setCursor(Qt.CursorShape.PointingHandCursor)
        add_part.clicked.connect(self._add_company_part_type_row)
        add_part.setStyleSheet(
            "QPushButton { "
            f"background: {parts_theme_soft}; color: {parts_theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_part.set_outline_color(QColor(parts_theme))
        add_part.set_outline_duration_ms(150)
        parts_top_lay.addWidget(add_part, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        parts_top_lay.addStretch(1)
        parts_card_layout.addWidget(parts_top)
        parts_div = QFrame()
        parts_div.setFixedHeight(1)
        parts_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        parts_card_layout.addWidget(parts_div)
        parts_content = QWidget()
        parts_content.setObjectName("CompanyPartTypesCardBody")
        parts_content.setStyleSheet(
            "QWidget#CompanyPartTypesCardBody { "
            "background:#F8FAFD; border:none; "
            "border-bottom-left-radius:14px; border-bottom-right-radius:14px; "
            "}"
        )
        parts_layout = QVBoxLayout(parts_content)
        parts_layout.setContentsMargins(14, 10, 14, 8)
        parts_layout.setSpacing(8)
        parts_table = ReorderableTableWidget()
        parts_table.setObjectName("CompanyPartTypesTable")
        parts_table.setColumnCount(9)
        parts_table.setHorizontalHeaderLabels(["", "Name", "Color", "Clash", "Cabinetry", "Drawer", "Initial Measure", "Incl in Cutlists", "Incl in Nesting"])

        parts_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        parts_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.horizontalHeader().setSectionResizeMode(7, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.horizontalHeader().setSectionResizeMode(8, QHeaderView.ResizeMode.ResizeToContents)
        parts_table.verticalHeader().setVisible(False)
        parts_table.horizontalHeader().setVisible(True)
        parts_table.setFrameShape(QFrame.Shape.NoFrame)
        parts_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        parts_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        parts_table.setAlternatingRowColors(False)
        parts_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        parts_table.setDragEnabled(True)
        parts_table.setAcceptDrops(True)
        parts_table.viewport().setAcceptDrops(True)
        parts_table.setDropIndicatorShown(False)
        parts_table.setDragDropOverwriteMode(False)
        parts_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        parts_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        parts_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        parts_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        parts_table.setStyleSheet(
            "QTableWidget#CompanyPartTypesTable { background: #F8FAFD; border: none; outline: none; }"
            "QTableWidget#CompanyPartTypesTable::item { background: #F8FAFD; }"
            "QTableWidget#CompanyPartTypesTable QWidget { background: transparent; }"
            "QTableWidget#CompanyPartTypesTable QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
            "QTableWidget#CompanyPartTypesTable QTableCornerButton::section { background: #F8FAFD; border: none; }"
        )
        parts_table.horizontalHeader().setStyleSheet(
            "QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        self._company_part_types_table = parts_table
        parts_table.setProperty("compactRows", True)
        parts_table.setShowGrid(False)
        parts_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("part_types", self._autosave_company_part_types))
        parts_table.rows_reordered.connect(self._on_part_type_rows_reordered)
        parts_layout.addWidget(parts_table)
        parts_card_layout.addWidget(parts_content, 1)

        hardware_card = QFrame()
        hardware_card.setObjectName("CompanyHardwareCard")
        hardware_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        hardware_card.setStyleSheet(
            "QFrame#CompanyHardwareCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
            "QFrame#CompanyHardwareTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
            "QWidget#CompanyHardwareBody { background:#F8FAFD; border:none; border-bottom-left-radius:14px; border-bottom-right-radius:14px; }"
        )
        hardware_layout = QVBoxLayout(hardware_card)
        hardware_layout.setContentsMargins(0, 0, 0, 0)
        hardware_layout.setSpacing(0)
        hardware_top = QFrame()
        hardware_top.setObjectName("CompanyHardwareTop")
        hardware_top.setFixedHeight(50)
        hardware_top_lay = QHBoxLayout(hardware_top)
        hardware_top_lay.setContentsMargins(14, 10, 14, 10)
        hardware_top_lay.setSpacing(6)
        hardware_title = QLabel("HARDWARE SETTINGS")
        hardware_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        hardware_top_lay.addWidget(hardware_title, 0)
        hardware_theme = self._sales_theme_hex()
        hardware_theme_soft = QColor(hardware_theme).lighter(190).name()
        add_hw = AnimatedOutlineButton("+ Add")
        add_hw.setCursor(Qt.CursorShape.PointingHandCursor)
        add_hw.setFixedSize(74, 30)
        add_hw.clicked.connect(self._add_company_hardware_row)
        add_hw.setStyleSheet(
            "QPushButton { "
            f"background: {hardware_theme_soft}; color: {hardware_theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_hw.set_outline_color(QColor(hardware_theme))
        add_hw.set_outline_duration_ms(150)
        hardware_top_lay.addWidget(add_hw, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        hardware_top_lay.addStretch(1)
        hardware_layout.addWidget(hardware_top)
        hardware_div = QFrame()
        hardware_div.setFixedHeight(1)
        hardware_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        hardware_layout.addWidget(hardware_div)
        hardware_content = QWidget()
        hardware_content.setObjectName("CompanyHardwareBody")
        hardware_content_lay = QVBoxLayout(hardware_content)
        hardware_content_lay.setContentsMargins(14, 10, 14, 8)
        hardware_content_lay.setSpacing(8)
        hardware_table = ReorderableTableWidget()
        hardware_table.setColumnCount(4)
        hardware_table.setHorizontalHeaderLabels(["", "", "Colour", "Default"])
        hardware_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        hardware_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        hardware_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        hardware_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        hardware_table.verticalHeader().setVisible(False)
        hardware_table.horizontalHeader().setVisible(True)
        hardware_table.setFrameShape(QFrame.Shape.NoFrame)
        hardware_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        hardware_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        hardware_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        hardware_table.setDragEnabled(True)
        hardware_table.setAcceptDrops(True)
        hardware_table.viewport().setAcceptDrops(True)
        hardware_table.setDropIndicatorShown(False)
        hardware_table.setDragDropOverwriteMode(False)
        hardware_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        hardware_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        hardware_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        hardware_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        hardware_table.setStyleSheet(
            "QTableWidget { background: transparent; border: none; outline: none; }"
            "QTableWidget::item { border-bottom: 7px solid #F8FAFD; padding: 0px; }"
            "QHeaderView::section { background: transparent; border: none; color: #6B7280; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        self._company_hardware_table = hardware_table
        hardware_table.setProperty("compactRows", True)
        hardware_table.setShowGrid(False)
        hardware_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("hardware", self._autosave_company_hardware))
        hardware_table.rows_reordered.connect(self._on_hardware_rows_reordered)
        hardware_content_lay.addWidget(hardware_table)
        hardware_layout.addWidget(hardware_content, 1)
        self._company_hardware_editor_host = None
        self._company_hardware_editor_layout = None
        self._company_hardware_editor_row = -1

        production_access_card = QFrame()
        production_access_card.setObjectName("CompanyProductionAccessCard")
        production_access_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        production_access_card.setStyleSheet(
            "QFrame#CompanyProductionAccessCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        production_access_card_layout = QVBoxLayout(production_access_card)
        production_access_card_layout.setContentsMargins(0, 0, 0, 0)
        production_access_card_layout.setSpacing(0)
        production_access_top = QFrame()
        production_access_top.setObjectName("CompanyProductionAccessTop")
        production_access_top.setFixedHeight(50)
        production_access_top.setStyleSheet(
            "QFrame#CompanyProductionAccessTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        production_access_top_lay = QHBoxLayout(production_access_top)
        production_access_top_lay.setContentsMargins(14, 16, 14, 10)
        production_access_top_lay.setSpacing(6)
        production_access_title = QLabel("PRODUCTION ACCESS")
        production_access_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        production_access_top_lay.addWidget(production_access_title, 0)
        production_access_top_lay.addStretch(1)
        production_access_card_layout.addWidget(production_access_top)
        production_access_div = QFrame()
        production_access_div.setFixedHeight(1)
        production_access_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        production_access_card_layout.addWidget(production_access_div)
        production_access_content = QWidget()
        production_access_content.setObjectName("CompanyProductionAccessBody")
        production_access_content.setStyleSheet(
            "QWidget#CompanyProductionAccessBody { "
            "background:#F8FAFD; border:none; "
            "border-bottom-left-radius:14px; border-bottom-right-radius:14px; "
            "}"
        )
        production_access_layout = QVBoxLayout(production_access_content)
        production_access_layout.setContentsMargins(14, 10, 14, 8)
        production_access_layout.setSpacing(8)

        unlock_row = QHBoxLayout()
        unlock_row.setContentsMargins(0, 0, 0, 0)
        unlock_row.setSpacing(8)
        unlock_code_lbl = QLabel("Production Key Numbers")
        unlock_code_lbl.setStyleSheet("QLabel { color:#64748B; font-size:12px; font-weight:700; background:transparent; border:none; }")
        unlock_code_edit = QLineEdit()
        unlock_code_edit.setPlaceholderText("")
        unlock_code_edit.setMaxLength(12)
        unlock_code_edit.setValidator(QIntValidator(0, 999999999, unlock_code_edit))
        unlock_code_edit.setFixedWidth(130)
        unlock_code_edit.setStyleSheet(
            "QLineEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:3px 8px; font-size:12px; }"
        )
        unlock_time_lbl = QLabel("Unlock Time")
        unlock_time_lbl.setStyleSheet("QLabel { color:#64748B; font-size:12px; font-weight:700; background:transparent; border:none; }")
        unlock_time_combo = QComboBox()
        unlock_time_combo.setFixedWidth(150)
        unlock_time_combo.setStyleSheet(
            "QComboBox { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; padding: 2px 8px; font-size: 12px; color:#1F2937; }"
            "QComboBox:focus { border:1px solid #AFC2DA; }"
            "QComboBox::drop-down { border:none; width:18px; }"
        )
        for lbl, hrs in (self._production_unlock_duration_options() if hasattr(self, "_production_unlock_duration_options") else []):
            unlock_time_combo.addItem(str(lbl), userData=int(hrs))
        unlock_row.addWidget(unlock_code_lbl, 0)
        unlock_row.addWidget(unlock_code_edit, 0)
        unlock_row.addSpacing(10)
        unlock_row.addWidget(unlock_time_lbl, 0)
        unlock_row.addWidget(unlock_time_combo, 0)
        unlock_row.addStretch(1)
        production_access_layout.addLayout(unlock_row)
        production_access_card_layout.addWidget(production_access_content, 1)
        self._company_cutlist_unlock_suffix_input = unlock_code_edit
        self._company_cutlist_unlock_duration_combo = unlock_time_combo

        cutlist_prod_card = QFrame()
        cutlist_prod_card.setObjectName("CompanyCutlistColumnsProductionCard")
        cutlist_prod_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        cutlist_prod_card.setStyleSheet(
            "QFrame#CompanyCutlistColumnsProductionCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        cutlist_prod_card_layout = QVBoxLayout(cutlist_prod_card)
        cutlist_prod_card_layout.setContentsMargins(0, 0, 0, 0)
        cutlist_prod_card_layout.setSpacing(0)
        cutlist_prod_top = QFrame()
        cutlist_prod_top.setObjectName("CompanyCutlistColumnsProductionTop")
        cutlist_prod_top.setFixedHeight(50)
        cutlist_prod_top.setStyleSheet(
            "QFrame#CompanyCutlistColumnsProductionTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        cutlist_prod_top_lay = QHBoxLayout(cutlist_prod_top)
        cutlist_prod_top_lay.setContentsMargins(14, 16, 14, 10)
        cutlist_prod_top_lay.setSpacing(6)
        cutlist_prod_title = QLabel("CUTLIST COLUMNS")
        cutlist_prod_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        cutlist_prod_top_lay.addWidget(cutlist_prod_title, 0)
        cutlist_prod_top_lay.addStretch(1)
        cutlist_prod_card_layout.addWidget(cutlist_prod_top)
        cutlist_prod_div = QFrame()
        cutlist_prod_div.setFixedHeight(1)
        cutlist_prod_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        cutlist_prod_card_layout.addWidget(cutlist_prod_div)
        cutlist_prod_content = QWidget()
        cutlist_prod_content.setObjectName("CompanyCutlistColumnsProductionBody")
        cutlist_prod_content.setStyleSheet(
            "QWidget#CompanyCutlistColumnsProductionBody { "
            "background:#F8FAFD; border:none; "
            "border-bottom-left-radius:14px; border-bottom-right-radius:14px; "
            "}"
        )
        cutlist_prod_layout = QVBoxLayout(cutlist_prod_content)
        cutlist_prod_layout.setContentsMargins(14, 10, 14, 8)
        cutlist_prod_layout.setSpacing(8)

        cutlist_prod_table = QTableWidget()
        cutlist_prod_table.setColumnCount(3)
        cutlist_prod_table.setHorizontalHeaderLabels(["Column", "Production", "Initial Measure"])
        cutlist_prod_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        cutlist_prod_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        cutlist_prod_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        cutlist_prod_table.verticalHeader().setVisible(False)
        cutlist_prod_table.horizontalHeader().setVisible(True)
        cutlist_prod_table.setFrameShape(QFrame.Shape.NoFrame)
        cutlist_prod_table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        cutlist_prod_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        cutlist_prod_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        cutlist_prod_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        cutlist_prod_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        cutlist_prod_table.setStyleSheet(
            "QTableWidget { background: #F8FAFD; border: none; outline: none; }"
            "QTableWidget::item { background: #F8FAFD; }"
            "QHeaderView::section { background: #F8FAFD; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        cutlist_prod_table.setShowGrid(False)
        cutlist_prod_table.setProperty("compactRows", True)
        self._company_cutlist_columns_prod_table = cutlist_prod_table
        self._company_cutlist_columns_table = cutlist_prod_table
        try:
            self._set_cutlist_columns_table_rows(cutlist_prod_table, self._default_cutlist_columns(), "cutlist_columns_production")
        except Exception:
            pass
        cutlist_prod_layout.addWidget(cutlist_prod_table)
        cutlist_prod_card_layout.addWidget(cutlist_prod_content, 1)
        prod_materials_wrap = QFrame()
        prod_materials_wrap.setStyleSheet(
            "QFrame { background: transparent; border: none; }"
        )
        prod_materials_lay = QVBoxLayout(prod_materials_wrap)
        prod_materials_lay.setContentsMargins(0, 0, 0, 0)
        prod_materials_lay.setSpacing(8)
        prod_materials_row = QHBoxLayout()
        prod_materials_row.setSpacing(10)
        prod_materials_row.addWidget(board_card, 1, Qt.AlignmentFlag.AlignTop)
        prod_materials_row.addWidget(finish_card, 1, Qt.AlignmentFlag.AlignTop)
        prod_materials_row.addWidget(sheet_card, 1, Qt.AlignmentFlag.AlignTop)
        prod_materials_lay.addLayout(prod_materials_row)
        usage_row = QHBoxLayout()
        usage_row.setContentsMargins(0, 0, 0, 0)
        usage_row.setSpacing(10)
        usage_row.addWidget(usage_card, 1, Qt.AlignmentFlag.AlignTop)
        usage_row.addStretch(5)
        prod_materials_lay.addLayout(usage_row)
        production_layout.addWidget(prod_materials_wrap, 0, 0, 1, 3)

        prod_nesting_wrap = QFrame()
        prod_nesting_wrap.setStyleSheet(
            "QFrame { background: transparent; border: none; }"
        )
        prod_nesting_lay = QVBoxLayout(prod_nesting_wrap)
        prod_nesting_lay.setContentsMargins(0, 0, 0, 0)
        prod_nesting_lay.setSpacing(8)
        prod_nesting_lay.addWidget(nest_card, 0, Qt.AlignmentFlag.AlignTop)
        production_layout.addWidget(prod_nesting_wrap, 1, 0, 1, 3)

        prod_cutlist_wrap = QFrame()
        prod_cutlist_wrap.setObjectName("ProdCutlistWrap")
        prod_cutlist_wrap.setStyleSheet(
            "QFrame#ProdCutlistWrap { background: transparent; border: none; }"
        )
        prod_cutlist_lay = QVBoxLayout(prod_cutlist_wrap)
        prod_cutlist_lay.setContentsMargins(0, 0, 0, 0)
        prod_cutlist_lay.setSpacing(8)
        prod_cutlist_row = QHBoxLayout()
        prod_cutlist_row.setContentsMargins(0, 0, 0, 0)
        prod_cutlist_row.setSpacing(10)
        prod_cutlist_row.addWidget(cutlist_prod_card, 1, Qt.AlignmentFlag.AlignTop)
        prod_cutlist_row.addWidget(parts_card, 3, Qt.AlignmentFlag.AlignTop)
        prod_cutlist_lay.addLayout(prod_cutlist_row)
        prod_cutlist_lay.addWidget(production_access_card, 0, Qt.AlignmentFlag.AlignTop)
        production_layout.addWidget(prod_cutlist_wrap, 2, 0, 1, 3)

        hardware_page = QWidget()
        hardware_page_layout = QGridLayout(hardware_page)
        hardware_page_layout.setContentsMargins(0, 0, 0, 0)
        hardware_page_layout.setHorizontalSpacing(10)
        hardware_page_layout.setVerticalSpacing(10)
        hardware_wrap = QFrame()
        hardware_wrap.setStyleSheet(
            "QFrame { background: transparent; border: none; }"
        )
        hardware_wrap_lay = QVBoxLayout(hardware_wrap)
        hardware_wrap_lay.setContentsMargins(0, 0, 0, 0)
        hardware_wrap_lay.setSpacing(0)
        hardware_wrap_lay.addWidget(hardware_card, 0, Qt.AlignmentFlag.AlignTop)
        hardware_page_layout.addWidget(hardware_wrap, 0, 0, 1, 1, Qt.AlignmentFlag.AlignTop)

        sales_page = QWidget()
        sales_page.setStyleSheet("QWidget { background: transparent; border: none; }")
        sales_layout = QGridLayout(sales_page)
        sales_layout.setContentsMargins(0, 0, 0, 0)
        sales_layout.setHorizontalSpacing(10)
        sales_layout.setVerticalSpacing(10)
        sales_layout.setColumnStretch(0, 1)
        sales_layout.setColumnStretch(1, 1)

        theme = self._sales_theme_hex()
        theme_soft = QColor(theme).lighter(190).name()

        categories_card = QFrame()
        categories_card.setObjectName("CompanyItemCategoriesCard")
        categories_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        categories_card.setMaximumHeight(16777215)
        categories_card.setStyleSheet(
            "QFrame#CompanyItemCategoriesCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        categories_layout = QVBoxLayout(categories_card)
        categories_layout.setContentsMargins(0, 0, 0, 0)
        categories_layout.setSpacing(0)
        categories_top = QFrame()
        categories_top.setObjectName("CompanyItemCategoriesTop")
        categories_top.setFixedHeight(50)
        categories_top.setStyleSheet(
            "QFrame#CompanyItemCategoriesTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        categories_top_lay = QHBoxLayout(categories_top)
        categories_top_lay.setContentsMargins(14, 16, 14, 10)
        categories_top_lay.setSpacing(6)
        categories_title = QLabel("ITEM CATEGORIES")
        categories_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        categories_top_lay.addWidget(categories_title, 0)
        add_category = AnimatedOutlineButton("+ Add")
        add_category.setCursor(Qt.CursorShape.PointingHandCursor)
        add_category.setStyleSheet(
            "QPushButton { "
            f"background: {theme_soft}; color: {theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_category.set_outline_color(QColor(theme))
        add_category.set_outline_duration_ms(150)
        add_category.clicked.connect(self._add_company_item_category_row)
        categories_top_lay.addWidget(add_category, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        categories_top_lay.addStretch(1)
        categories_layout.addWidget(categories_top)
        categories_div = QFrame()
        categories_div.setFixedHeight(1)
        categories_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        categories_layout.addWidget(categories_div)
        categories_content = QWidget()
        categories_content_lay = QVBoxLayout(categories_content)
        categories_content_lay.setContentsMargins(14, 10, 14, 8)
        categories_content_lay.setSpacing(8)

        categories_table = ReorderableTableWidget()
        categories_table.setColumnCount(5)
        categories_table.setHorizontalHeaderLabels(["", "Name", "Sub-categories", "Colour", "Open"])
        categories_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        categories_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        categories_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        categories_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        categories_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        categories_table.verticalHeader().setVisible(False)
        categories_table.horizontalHeader().setVisible(True)
        categories_table.setFrameShape(QFrame.Shape.NoFrame)
        categories_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        categories_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        categories_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        categories_table.setDragEnabled(True)
        categories_table.setAcceptDrops(True)
        categories_table.viewport().setAcceptDrops(True)
        categories_table.setDropIndicatorShown(False)
        categories_table.setDragDropOverwriteMode(False)
        categories_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        categories_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        categories_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        categories_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        categories_table.setStyleSheet(
            "QTableWidget { background: transparent; border: none; outline: none; selection-background-color: #EAF2FF; selection-color:#20304A; }"
            "QTableWidget::item { border: none; background: transparent; }"
            "QTableWidget::item:selected { background:#EAF2FF; border-radius: 6px; }"
            "QHeaderView::section { background: transparent; color:#8A97A8; border:none; font-size:12px; font-weight:800; padding: 0 2px 4px 2px; }"
        )
        self._company_item_categories_table = categories_table
        categories_table.setProperty("compactRows", True)
        categories_table.setShowGrid(False)
        categories_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("item_categories", self._autosave_company_item_categories))
        categories_table.rows_reordered.connect(self._on_item_categories_rows_reordered)
        categories_content_lay.addWidget(categories_table)

        inventory_card = QFrame()
        inventory_card.setObjectName("CompanyInventoryCard")
        inventory_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        inventory_card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #E4E6EC;"
            "border-radius: 14px;"
            "}"
        )
        inventory_layout = QVBoxLayout(inventory_card)
        inventory_layout.setContentsMargins(14, 14, 14, 14)
        inventory_layout.setSpacing(8)
        inventory_title = QLabel("Inventory")
        inventory_title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 16px; font-weight: 700;")
        inventory_layout.addWidget(inventory_title)
        self._company_inventory_panel_title = inventory_title

        inventory_table = ReorderableTableWidget()
        inventory_table.setColumnCount(7)
        inventory_table.setHorizontalHeaderLabels(["", "Item", "Category", "Sub-category", "Price", "Markup %", "Output Price"])
        inventory_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        inventory_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        inventory_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        inventory_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        inventory_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        inventory_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        inventory_table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)
        inventory_table.verticalHeader().setVisible(False)
        inventory_table.horizontalHeader().setVisible(True)
        inventory_table.setFrameShape(QFrame.Shape.NoFrame)
        inventory_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        inventory_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        inventory_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        inventory_table.setDragEnabled(True)
        inventory_table.setAcceptDrops(True)
        inventory_table.viewport().setAcceptDrops(True)
        inventory_table.setDropIndicatorShown(False)
        inventory_table.setDragDropOverwriteMode(False)
        inventory_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        inventory_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        inventory_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        inventory_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        inventory_table.setStyleSheet(
            "QTableWidget { background: transparent; border: none; outline: none; }"
            "QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        self._company_inventory_table = inventory_table
        self._company_inventory_table_base = inventory_table
        inventory_table.setProperty("compactRows", True)
        inventory_table.setShowGrid(False)
        inventory_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("inventory", self._autosave_company_inventory))
        inventory_table.rows_reordered.connect(self._on_inventory_rows_reordered)
        inventory_layout.addWidget(inventory_table)

        inventory_actions = QHBoxLayout()
        add_inventory = QPushButton("Add")
        add_inventory.clicked.connect(self._add_company_inventory_row)
        add_inventory.setStyleSheet(
            "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 1px solid #BFE8CF; border-radius: 9px; padding: 7px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #BEE6D0; border: 1px solid #9ED6B8; color: #17552F; }"
        )
        inventory_actions.addWidget(add_inventory)
        inventory_actions.addStretch(1)
        inventory_layout.addLayout(inventory_actions)
        inventory_card.setVisible(False)
        self._company_inventory_card = inventory_card
        categories_content_lay.addWidget(inventory_card)
        categories_layout.addWidget(categories_content, 1)

        job_types_card = QFrame()
        job_types_card.setObjectName("CompanyJobTypesCard")
        job_types_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        job_types_card.setMaximumHeight(16777215)
        job_types_card.setStyleSheet(
            "QFrame#CompanyJobTypesCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }"
        )
        job_types_layout = QVBoxLayout(job_types_card)
        job_types_layout.setContentsMargins(0, 0, 0, 0)
        job_types_layout.setSpacing(0)
        job_types_top = QFrame()
        job_types_top.setObjectName("CompanyJobTypesTop")
        job_types_top.setFixedHeight(50)
        job_types_top.setStyleSheet(
            "QFrame#CompanyJobTypesTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        job_types_top_lay = QHBoxLayout(job_types_top)
        job_types_top_lay.setContentsMargins(14, 16, 14, 10)
        job_types_top_lay.setSpacing(6)
        job_types_title = QLabel("JOB TYPES")
        job_types_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        job_types_top_lay.addWidget(job_types_title, 0)
        add_job_type = AnimatedOutlineButton("+ Add")
        add_job_type.setCursor(Qt.CursorShape.PointingHandCursor)
        add_job_type.setStyleSheet(
            "QPushButton { "
            f"background: {theme_soft}; color: {theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_job_type.set_outline_color(QColor(theme))
        add_job_type.set_outline_duration_ms(150)
        add_job_type.clicked.connect(self._add_company_job_type_row)
        job_types_top_lay.addWidget(add_job_type, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        job_types_top_lay.addStretch(1)
        job_types_layout.addWidget(job_types_top)
        job_types_div = QFrame()
        job_types_div.setFixedHeight(1)
        job_types_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        job_types_layout.addWidget(job_types_div)
        job_types_content = QWidget()
        job_types_content_lay = QVBoxLayout(job_types_content)
        job_types_content_lay.setContentsMargins(14, 10, 14, 8)
        job_types_content_lay.setSpacing(8)

        job_types_table = ReorderableTableWidget()
        job_types_table.setColumnCount(3)
        job_types_table.setHorizontalHeaderLabels(["", "Name", "Price / sheet"])
        job_types_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        job_types_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        job_types_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        job_types_table.verticalHeader().setVisible(False)
        job_types_table.horizontalHeader().setVisible(True)
        job_types_table.setFrameShape(QFrame.Shape.NoFrame)
        job_types_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        job_types_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        job_types_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        job_types_table.setDragEnabled(True)
        job_types_table.setAcceptDrops(True)
        job_types_table.viewport().setAcceptDrops(True)
        job_types_table.setDropIndicatorShown(False)
        job_types_table.setDragDropOverwriteMode(False)
        job_types_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        job_types_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        job_types_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        job_types_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        job_types_table.setStyleSheet(
            "QTableWidget { background: transparent; border: none; outline: none; selection-background-color: #EAF2FF; selection-color:#20304A; }"
            "QTableWidget::item { border: none; background: transparent; }"
            "QTableWidget::item:selected { background:#EAF2FF; border-radius: 6px; }"
            "QHeaderView::section { background: transparent; color:#8A97A8; border:none; font-size:12px; font-weight:800; padding: 0 2px 4px 2px; }"
        )
        self._company_job_types_table = job_types_table
        job_types_table.setProperty("compactRows", True)
        job_types_table.setShowGrid(False)
        job_types_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("job_types", self._autosave_company_job_types))
        job_types_table.rows_reordered.connect(self._on_job_types_rows_reordered)
        job_types_content_lay.addWidget(job_types_table)
        job_types_layout.addWidget(job_types_content, 1)

        quote_extras_card = QFrame()
        self._company_quote_extras_card = quote_extras_card
        quote_extras_card.setObjectName("CompanyQuoteExtrasCard")
        quote_extras_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        quote_extras_card.setMaximumHeight(16777215)
        quote_extras_card.setStyleSheet("QFrame#CompanyQuoteExtrasCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        quote_extras_layout = QVBoxLayout(quote_extras_card)
        quote_extras_layout.setContentsMargins(0, 0, 0, 0)
        quote_extras_layout.setSpacing(0)
        quote_extras_top = QFrame()
        quote_extras_top.setObjectName("CompanyQuoteExtrasTop")
        quote_extras_top.setFixedHeight(50)
        quote_extras_top.setStyleSheet(
            "QFrame#CompanyQuoteExtrasTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        quote_extras_top_lay = QHBoxLayout(quote_extras_top)
        quote_extras_top_lay.setContentsMargins(14, 16, 14, 10)
        quote_extras_top_lay.setSpacing(6)
        quote_extras_title = QLabel("QUOTE EXTRAS")
        quote_extras_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        quote_extras_top_lay.addWidget(quote_extras_title, 0)
        theme = self._sales_theme_hex()
        theme_soft = QColor(theme).lighter(190).name()
        add_quote_extra = AnimatedOutlineButton("+ Add")
        add_quote_extra.setCursor(Qt.CursorShape.PointingHandCursor)
        add_quote_extra.setStyleSheet(
            "QPushButton { "
            f"background: {theme_soft}; color: {theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_quote_extra.set_outline_color(QColor(theme))
        add_quote_extra.set_outline_duration_ms(150)
        add_quote_extra.clicked.connect(self._add_company_quote_extra_row)
        quote_extras_top_lay.addWidget(add_quote_extra, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        quote_extras_top_lay.addStretch(1)
        quote_extras_layout.addWidget(quote_extras_top)
        quote_extras_div = QFrame()
        quote_extras_div.setFixedHeight(1)
        quote_extras_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        quote_extras_layout.addWidget(quote_extras_div)
        quote_extras_content = QWidget()
        quote_extras_content_lay = QVBoxLayout(quote_extras_content)
        quote_extras_content_lay.setContentsMargins(14, 10, 14, 8)
        quote_extras_content_lay.setSpacing(8)

        quote_extras_table = ReorderableTableWidget()
        quote_extras_table.setObjectName("CompanyQuoteExtrasTable")
        quote_extras_table.setColumnCount(6)
        quote_extras_table.setHorizontalHeaderLabels(["", "Name", "Price", "Default", "Container", "Placeholder"])
        quote_extras_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        quote_extras_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)
        quote_extras_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)
        quote_extras_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        quote_extras_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)
        quote_extras_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.Fixed)
        quote_extras_table.horizontalHeader().setStretchLastSection(False)
        quote_extras_table.horizontalHeader().setMinimumSectionSize(54)
        quote_extras_table.horizontalHeader().resizeSection(1, 150)
        quote_extras_table.horizontalHeader().resizeSection(2, 62)
        quote_extras_table.horizontalHeader().resizeSection(4, 130)
        quote_extras_table.horizontalHeader().resizeSection(5, 130)
        quote_extras_table.verticalHeader().setVisible(False)
        quote_extras_table.horizontalHeader().setVisible(True)
        quote_extras_table.setFrameShape(QFrame.Shape.NoFrame)
        quote_extras_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        quote_extras_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        quote_extras_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        quote_extras_table.setDragEnabled(True)
        quote_extras_table.setAcceptDrops(True)
        quote_extras_table.viewport().setAcceptDrops(True)
        quote_extras_table.setDropIndicatorShown(False)
        quote_extras_table.setDragDropOverwriteMode(False)
        quote_extras_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        quote_extras_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        quote_extras_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        quote_extras_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        quote_extras_table.setStyleSheet(
            "QTableWidget#CompanyQuoteExtrasTable { background: transparent; border: none; outline: none; selection-background-color: #EAF2FF; selection-color:#20304A; }"
            "QTableWidget#CompanyQuoteExtrasTable::item { border: none; background: transparent; }"
            "QTableWidget#CompanyQuoteExtrasTable::item:selected { background:#EAF2FF; border-radius: 6px; }"
            "QHeaderView::section { background: transparent; color:#8A97A8; border:none; font-size:12px; font-weight:800; padding: 0 2px 4px 2px; }"
        )
        self._company_quote_extras_rows_list = None
        self._company_quote_extras_rows_layout = None
        self._company_quote_extras_table = quote_extras_table
        quote_extras_table.setProperty("compactRows", True)
        quote_extras_table.setShowGrid(False)
        if isinstance(quote_extras_table.horizontalHeaderItem(2), QTableWidgetItem):
            quote_extras_table.horizontalHeaderItem(2).setTextAlignment(int(Qt.AlignmentFlag.AlignCenter))
        if isinstance(quote_extras_table.horizontalHeaderItem(3), QTableWidgetItem):
            quote_extras_table.horizontalHeaderItem(3).setTextAlignment(int(Qt.AlignmentFlag.AlignCenter))
        quote_extras_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        quote_extras_table.rows_reordered.connect(self._on_quote_extras_rows_reordered)
        quote_extras_content_lay.addWidget(quote_extras_table)

        quote_extras_layout.addWidget(quote_extras_content, 1)

        sales_discounts_card = QFrame()
        self._company_sales_discounts_card = sales_discounts_card
        sales_discounts_card.setObjectName("CompanySalesDiscountsCard")
        sales_discounts_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        sales_discounts_card.setMaximumHeight(16777215)
        sales_discounts_card.setStyleSheet("QFrame#CompanySalesDiscountsCard { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        sales_discounts_layout = QVBoxLayout(sales_discounts_card)
        sales_discounts_layout.setContentsMargins(0, 0, 0, 0)
        sales_discounts_layout.setSpacing(0)
        sales_discounts_top = QFrame()
        sales_discounts_top.setObjectName("CompanySalesDiscountsTop")
        sales_discounts_top.setFixedHeight(50)
        sales_discounts_top.setStyleSheet(
            "QFrame#CompanySalesDiscountsTop { background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        sales_discounts_top_lay = QHBoxLayout(sales_discounts_top)
        sales_discounts_top_lay.setContentsMargins(14, 16, 14, 10)
        sales_discounts_top_lay.setSpacing(10)
        sales_discounts_head = QHBoxLayout()
        sales_discounts_head.setContentsMargins(0, 0, 0, 0)
        sales_discounts_head.setSpacing(10)
        sales_discounts_title = QLabel("QUOTE DISCOUNT")
        sales_discounts_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        sales_discounts_head.addWidget(sales_discounts_title, 0)
        add_tier_btn = AnimatedOutlineButton("+ Add")
        add_tier_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_tier_btn.setStyleSheet(
            "QPushButton { "
            f"background: {theme_soft}; color: {theme}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #E3ECFA; }"
        )
        add_tier_btn.set_outline_color(QColor(theme))
        add_tier_btn.set_outline_duration_ms(150)
        add_tier_btn.clicked.connect(self._add_company_quote_discount_tier_row)
        sales_discounts_head.addWidget(add_tier_btn, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        sales_discounts_head.addStretch(1)
        sales_minus_check = QCheckBox("minus off quote total")
        sales_minus_check.setCursor(Qt.CursorShape.PointingHandCursor)
        sales_minus_check.setStyleSheet("QCheckBox { color:#334155; font-size:12px; font-weight:700; spacing:6px; }")
        self._company_sales_minus_off_quote_total_check = sales_minus_check
        sales_discounts_head.addWidget(sales_minus_check, 0)
        sales_discounts_top_lay.addLayout(sales_discounts_head, 1)
        sales_discounts_layout.addWidget(sales_discounts_top)
        sales_discounts_div = QFrame()
        sales_discounts_div.setFixedHeight(1)
        sales_discounts_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        sales_discounts_layout.addWidget(sales_discounts_div)
        sales_discounts_content = QWidget()
        sales_discounts_content_lay = QVBoxLayout(sales_discounts_content)
        sales_discounts_content_lay.setContentsMargins(14, 10, 14, 8)
        sales_discounts_content_lay.setSpacing(8)

        tiers_title = QLabel("Quote Discount Tiers")
        tiers_title.setStyleSheet("QLabel { color:#334155; font-size:12px; font-weight:700; }")
        sales_discounts_content_lay.addWidget(tiers_title)

        tiers_table = ReorderableTableWidget()
        tiers_table.setObjectName("CompanyQuoteDiscountTiersTable")
        tiers_table.setColumnCount(4)
        tiers_table.setHorizontalHeaderLabels(["", "Low $", "High $", "Discount $"])
        tiers_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        tiers_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        tiers_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        tiers_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        tiers_table.verticalHeader().setVisible(False)
        tiers_table.horizontalHeader().setVisible(True)
        tiers_table.setFrameShape(QFrame.Shape.NoFrame)
        tiers_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        tiers_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        tiers_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        tiers_table.setDragEnabled(True)
        tiers_table.setAcceptDrops(True)
        tiers_table.viewport().setAcceptDrops(True)
        tiers_table.setDropIndicatorShown(False)
        tiers_table.setDragDropOverwriteMode(False)
        tiers_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        tiers_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        tiers_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        tiers_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        tiers_table.setStyleSheet(
            "QTableWidget#CompanyQuoteDiscountTiersTable { background: transparent; border: none; outline: none; selection-background-color: #EAF2FF; selection-color:#20304A; }"
            "QTableWidget#CompanyQuoteDiscountTiersTable::item { border: none; background: transparent; }"
            "QTableWidget#CompanyQuoteDiscountTiersTable::item:selected { background:#EAF2FF; border-radius: 6px; }"
            "QHeaderView::section { background: transparent; color:#8A97A8; border:none; font-size:12px; font-weight:800; padding: 0 2px 4px 2px; }"
        )
        self._company_quote_discount_tiers_rows_list = None
        self._company_quote_discount_tiers_rows_layout = None
        self._company_quote_discount_tiers_table = tiers_table
        tiers_table.setShowGrid(False)
        tiers_table.setProperty("compactRows", True)
        if isinstance(tiers_table.horizontalHeaderItem(1), QTableWidgetItem):
            tiers_table.horizontalHeaderItem(1).setTextAlignment(int(Qt.AlignmentFlag.AlignCenter))
        if isinstance(tiers_table.horizontalHeaderItem(2), QTableWidgetItem):
            tiers_table.horizontalHeaderItem(2).setTextAlignment(int(Qt.AlignmentFlag.AlignCenter))
        if isinstance(tiers_table.horizontalHeaderItem(3), QTableWidgetItem):
            tiers_table.horizontalHeaderItem(3).setTextAlignment(int(Qt.AlignmentFlag.AlignCenter))
        tiers_table.rows_reordered.connect(lambda *_: (self._refresh_quote_discount_tier_row_widgets(), self._queue_company_autosave("sales_discounts", self._autosave_company_sales_discounts)))
        sales_discounts_content_lay.addWidget(tiers_table)

        sales_discounts_layout.addWidget(sales_discounts_content, 1)

        cutlist_sales_card = QFrame()
        cutlist_sales_card.setObjectName("CompanyCutlistColumnsInitialMeasureCard")
        cutlist_sales_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        cutlist_sales_card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #E4E6EC;"
            "border-radius: 14px;"
            "}"
        )
        cutlist_sales_layout = QVBoxLayout(cutlist_sales_card)
        cutlist_sales_layout.setContentsMargins(14, 14, 14, 14)
        cutlist_sales_layout.setSpacing(8)
        cutlist_sales_title = QLabel("Cutlist Columns (Initial Measure)")
        cutlist_sales_title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 16px; font-weight: 700;")
        cutlist_sales_layout.addWidget(cutlist_sales_title)

        cutlist_sales_table = QTableWidget()
        cutlist_sales_table.setColumnCount(2)
        cutlist_sales_table.setHorizontalHeaderLabels(["Column", "Included"])
        cutlist_sales_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        cutlist_sales_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        cutlist_sales_table.verticalHeader().setVisible(False)
        cutlist_sales_table.horizontalHeader().setVisible(True)
        cutlist_sales_table.setFrameShape(QFrame.Shape.NoFrame)
        cutlist_sales_table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        cutlist_sales_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        cutlist_sales_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        cutlist_sales_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        cutlist_sales_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        cutlist_sales_table.setStyleSheet(
            "QTableWidget { background: transparent; border: none; outline: none; }"
            "QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        cutlist_sales_table.setShowGrid(False)
        cutlist_sales_table.setProperty("compactRows", True)
        self._company_cutlist_columns_sales_table = cutlist_sales_table
        try:
            self._set_cutlist_columns_table_rows(cutlist_sales_table, self._default_cutlist_columns(), "cutlist_columns_sales")
        except Exception:
            pass
        cutlist_sales_layout.addWidget(cutlist_sales_table)

        quote_preset_card = QFrame()
        quote_preset_card.setObjectName("CompanyQuotePresetCard")
        quote_preset_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        quote_preset_card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #E4E6EC;"
            "border-radius: 14px;"
            "}"
        )
        quote_preset_layout = QVBoxLayout(quote_preset_card)
        quote_preset_layout.setContentsMargins(14, 14, 14, 14)
        quote_preset_layout.setSpacing(8)
        quote_preset_title = QLabel("Quote Preset")
        quote_preset_title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 16px; font-weight: 700;")
        quote_preset_layout.addWidget(quote_preset_title)

        quote_preset_note = QLabel("Default layout used when opening a new quote.")
        quote_preset_note.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; }")
        quote_preset_layout.addWidget(quote_preset_note)

        preset_actions = QHBoxLayout()
        preset_actions.setContentsMargins(0, 0, 0, 0)
        preset_actions.setSpacing(8)
        open_preset_btn = QPushButton("Open Preset Editor")
        open_preset_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        open_preset_btn.setStyleSheet(
            "QPushButton { background: #E8F0FF; color: #2F6BFF; border: none; border-radius: 9px; padding: 8px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #DCE7FF; }"
        )
        open_preset_btn.clicked.connect(self._open_quote_base_layout_editor)
        preset_actions.addWidget(open_preset_btn, 0, Qt.AlignmentFlag.AlignLeft)
        reset_preset_btn = QPushButton("Reset To Default")
        reset_preset_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        reset_preset_btn.setStyleSheet(
            "QPushButton { background: #FDECEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 9px; padding: 8px 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #FADCE0; }"
        )
        reset_preset_btn.clicked.connect(self._reset_quote_base_layout_default)
        preset_actions.addWidget(reset_preset_btn, 0, Qt.AlignmentFlag.AlignLeft)
        preset_actions.addStretch(1)
        quote_preset_layout.addLayout(preset_actions)

        status_lbl = QLabel("Preset not configured")
        status_lbl.setWordWrap(True)
        status_lbl.setStyleSheet("QLabel { color: #44556D; font-size: 12px; }")
        self._company_quote_preset_status_label = status_lbl
        self._company_quote_template_status_label = status_lbl
        quote_preset_layout.addWidget(status_lbl)

        tokens_note = QLabel("Placeholders: {{client_name}}, {{client_address}}, {{total_price}}, {{quote_generated_date}}, {{promotional_discount_amount}}, {{project_creator}}")
        tokens_note.setWordWrap(True)
        tokens_note.setStyleSheet("QLabel { color: #6B7280; font-size: 11px; }")
        quote_preset_layout.addWidget(tokens_note)
        sales_pricing_wrap = QWidget()
        sales_pricing_lay = QVBoxLayout(sales_pricing_wrap)
        sales_pricing_lay.setContentsMargins(0, 0, 0, 0)
        sales_pricing_lay.setSpacing(8)
        sales_pricing_grid = QGridLayout()
        sales_pricing_grid.setHorizontalSpacing(10)
        sales_pricing_grid.setVerticalSpacing(10)
        quote_settings_row = QWidget()
        self._company_quote_settings_row = quote_settings_row
        quote_settings_row.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        quote_settings_row.setMaximumHeight(16777215)
        quote_settings_row_lay = QHBoxLayout(quote_settings_row)
        quote_settings_row_lay.setContentsMargins(0, 0, 0, 0)
        quote_settings_row_lay.setSpacing(10)
        quote_settings_row_lay.addWidget(quote_extras_card, 3)
        quote_settings_row_lay.addWidget(sales_discounts_card, 1)
        sales_pricing_grid.addWidget(categories_card, 0, 0, 1, 2, Qt.AlignmentFlag.AlignTop)
        sales_pricing_grid.addWidget(job_types_card, 1, 0, 1, 2, Qt.AlignmentFlag.AlignTop)
        sales_pricing_grid.addWidget(quote_settings_row, 2, 0, 1, 2)
        sales_pricing_lay.addLayout(sales_pricing_grid)
        sales_layout.addWidget(sales_pricing_wrap, 0, 0, 1, 2)

        sales_integrations_wrap = QWidget()
        sales_integrations_lay = QVBoxLayout(sales_integrations_wrap)
        sales_integrations_lay.setContentsMargins(0, 0, 0, 0)
        sales_integrations_lay.setSpacing(8)
        sales_integrations_lay.addWidget(quote_preset_card, 0, Qt.AlignmentFlag.AlignTop)
        sales_integrations_lay.addWidget(status_card, 0, Qt.AlignmentFlag.AlignTop)
        sales_layout.addWidget(sales_integrations_wrap, 1, 0, 1, 2)

        sales_quote_wrap = QWidget()
        sales_quote_lay = QVBoxLayout(sales_quote_wrap)
        sales_quote_lay.setContentsMargins(0, 0, 0, 0)
        sales_quote_lay.setSpacing(8)
        sales_layout.addWidget(sales_quote_wrap, 2, 0, 1, 2)

        search_targets[0] = [
            (general_identity_wrap, "general company application preferences company info theme logo name currency measurement date format timezone branding recently deleted retention", "company_profile"),
            (general_workflow_wrap, "general staff permissions roles workflow", "staff_permissions"),
        ]
        search_targets[1] = [
            (prod_materials_wrap, "production materials board types sheet thicknesses board finishes sheet size thickness", "materials"),
            (prod_nesting_wrap, "production nesting settings", "nesting"),
            (prod_cutlist_wrap, "production cutlist defaults cutlist columns part types", "cutlist_defaults"),
        ]
        search_targets[2] = [
            (hardware_wrap, "hardware settings categories defaults hinge drawer", "hardware"),
        ]
        search_targets[3] = [
            (sales_pricing_wrap, "sales inventory item categories categories job types quote extras pricing discount tiers", "sales_pricing"),
            (sales_integrations_wrap, "sales integrations project statuses quote preset output", "integrations"),
            (sales_quote_wrap, "sales backup data quote output templates initial measure", "backup_data"),
        ]

        def _sync_submenu_active_styles() -> None:
            idx_to_key = {0: "general", 1: "production", 2: "hardware", 3: "sales"}
            active_tab = idx_to_key.get(int(self._company_settings_stack.currentIndex() if self._company_settings_stack else 0), "general")
            section_key = str(active_section.get("key") or "")
            for btn, tab_key, sec_key in menu_links:
                is_active = (tab_key == active_tab and section_key == sec_key)
                if is_active:
                    btn.setStyleSheet(
                        "QPushButton { background:#E8EEF9; color:#1E3A8A; border:1px solid #CBD9F0; border-radius:9px; text-align:left; padding:0 10px; font-size:12px; font-weight:800; }"
                    )
                else:
                    btn.setStyleSheet(
                        "QPushButton { background: transparent; color:#5B6472; border:none; border-radius:9px; text-align:left; padding:0 10px; font-size:12px; font-weight:600; }"
                        "QPushButton:hover { background:#F1F5F9; color:#334155; }"
                    )

        def _on_unit_mm_changed(checked: bool) -> None:
            if checked and self._company_general_unit_in.isChecked():
                self._company_general_unit_in.blockSignals(True)
                self._company_general_unit_in.setChecked(False)
                self._company_general_unit_in.blockSignals(False)
            self._queue_company_autosave("general_preferences", self._autosave_company_general_preferences, delay_ms=300)

        def _on_unit_in_changed(checked: bool) -> None:
            if checked and self._company_general_unit_mm.isChecked():
                self._company_general_unit_mm.blockSignals(True)
                self._company_general_unit_mm.setChecked(False)
                self._company_general_unit_mm.blockSignals(False)
            self._queue_company_autosave("general_preferences", self._autosave_company_general_preferences, delay_ms=300)

        self._company_general_name_input.editingFinished.connect(lambda: self._queue_company_autosave("general_preferences", self._autosave_company_general_preferences, delay_ms=300))
        self._company_general_currency_combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("general_preferences", self._autosave_company_general_preferences, delay_ms=300))
        self._company_general_date_format_combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("general_preferences", self._autosave_company_general_preferences, delay_ms=300))
        self._company_general_timezone_combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("general_preferences", self._autosave_company_general_preferences, delay_ms=300))
        self._company_general_deleted_retention_combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("general_preferences", self._autosave_company_general_preferences, delay_ms=300))
        self._company_general_unit_mm.toggled.connect(_on_unit_mm_changed)
        self._company_general_unit_in.toggled.connect(_on_unit_in_changed)
        sales_minus_check.toggled.connect(lambda _=False: self._queue_company_autosave("sales_discounts", self._autosave_company_sales_discounts, delay_ms=300))
        if isinstance(self._company_cutlist_unlock_suffix_input, QLineEdit):
            self._company_cutlist_unlock_suffix_input.textChanged.connect(
                lambda _=None: self._queue_company_autosave("cutlist_unlock", self._autosave_company_cutlist_columns, delay_ms=300)
            )
            self._company_cutlist_unlock_suffix_input.editingFinished.connect(
                lambda: self._queue_company_autosave("cutlist_unlock", self._autosave_company_cutlist_columns, delay_ms=120)
            )
        if isinstance(self._company_cutlist_unlock_duration_combo, QComboBox):
            self._company_cutlist_unlock_duration_combo.currentIndexChanged.connect(
                lambda _=0: self._queue_company_autosave("cutlist_unlock", self._autosave_company_cutlist_columns, delay_ms=300)
            )

        self._company_settings_stack.addWidget(_wrap_scroll_page(general_page))
        self._company_settings_stack.addWidget(_wrap_scroll_page(production_page))
        self._company_settings_stack.addWidget(_wrap_scroll_page(hardware_page))
        self._company_settings_stack.addWidget(_wrap_scroll_page(sales_page))
        right_col.addWidget(self._company_settings_stack, stretch=1)

        search.textChanged.connect(lambda _=None: (_apply_settings_filters(), _sync_submenu_active_styles()))
        self._company_settings_stack.currentChanged.connect(lambda _=0: (_apply_settings_filters(), _sync_submenu_active_styles()))

        body.addLayout(right_col, stretch=1)
        layout.addLayout(body, stretch=1)

        self._set_company_settings_tab("general")
        _apply_settings_filters()
        _sync_submenu_active_styles()
        self._refresh_company()
        return page



