from __future__ import annotations

import json
import time
import html
import re
import zipfile
import xml.etree.ElementTree as ET
import base64
import mimetypes
import os
import tempfile
from datetime import datetime, timedelta, timezone

from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from PySide6.QtCore import Qt, QTimer, QEvent, QRectF, QSize, QUrl, QMimeData, QPoint
from PySide6.QtGui import QAction, QColor, QBrush, QPixmap, QPainter, QPainterPath, QFont, QFontMetrics, QTextCharFormat, QDesktopServices, QTextDocument, QDrag, QIcon
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QGraphicsBlurEffect,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QMessageBox,
    QMenu,
    QPushButton,
    QScrollArea,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QToolButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
    QWidgetAction,
)

from cutsmart.ui.style import ACCENT, APP_BG, TEXT_MAIN, TEXT_MUTED
from cutsmart.ui.router import Route
from cutsmart.qtui.screens.cutlist_dialog import CutlistDialog
from cutsmart.qtui.screens.project_dialogs import NewProjectDialog, SalesItemsDialog
from cutsmart.qtui.screens.project_general_media_mixin import ProjectGeneralMediaMixin
from cutsmart.qtui.screens.dashboard_filters_mixin import DashboardFiltersMixin
from cutsmart.qtui.screens.dashboard_meta_mixin import DashboardMetaMixin
from cutsmart.qtui.screens.project_config_mixin import ProjectConfigMixin
from cutsmart.qtui.screens.project_permissions_mixin import ProjectPermissionsMixin
from cutsmart.qtui.screens.sales_rooms_mixin import SalesRoomsMixin, AnimatedOutlineButton
from cutsmart.qtui.screens.production_nav_mixin import ProductionNavMixin
from cutsmart.qtui.screens.production_settings_mixin import ProductionSettingsMixin
from cutsmart.qtui.screens.project_data_mixin import ProjectDataMixin
from cutsmart.qtui.screens.project_actions_mixin import ProjectActionsMixin
from cutsmart.qtui.screens.staff_management_mixin import StaffManagementMixin
from cutsmart.qtui.screens.dashboard_stats_mixin import DashboardStatsMixin
from cutsmart.qtui.screens.dashboard_updates_mixin import DashboardUpdatesMixin
from cutsmart.qtui.screens.dashboard_user_settings_mixin import DashboardUserSettingsMixin
from cutsmart.qtui.screens.project_workflow_mixin import ProjectWorkflowMixin
from cutsmart.qtui.screens.company_settings_helpers_mixin import CompanySettingsHelpersMixin
from cutsmart.qtui.screens.company_settings_table_utils_mixin import CompanySettingsTableUtilsMixin
from cutsmart.qtui.screens.company_settings_role_actions_mixin import CompanySettingsRoleActionsMixin
from cutsmart.qtui.screens.company_core_mixin import CompanyCoreMixin
from cutsmart.qtui.screens.company_statuses_mixin import CompanyStatusesMixin
from cutsmart.qtui.screens.company_boards_mixin import CompanyBoardsMixin
from cutsmart.qtui.screens.company_sheet_sizes_mixin import CompanySheetSizesMixin
from cutsmart.qtui.screens.company_hardware_mixin import CompanyHardwareMixin
from cutsmart.qtui.screens.company_nesting_cutlist_mixin import CompanyNestingCutlistMixin
from cutsmart.qtui.screens.company_part_types_mixin import CompanyPartTypesMixin
from cutsmart.qtui.screens.company_sales_mixin import CompanySalesMixin
from cutsmart.qtui.screens.company_page_builder_mixin import CompanyPageBuilderMixin
from cutsmart.qtui.screens.dashboard_controls import PartTypeOptionDelegate, SimpleOptionDelegate, VComboBox
from cutsmart.qtui.screens.dashboard_widgets import (
    HoverProjectRowCard,
)


class DashboardShellScreen(ProjectGeneralMediaMixin, DashboardFiltersMixin, DashboardMetaMixin, ProjectConfigMixin, ProjectPermissionsMixin, SalesRoomsMixin, ProductionNavMixin, ProductionSettingsMixin, ProjectDataMixin, ProjectActionsMixin, StaffManagementMixin, DashboardStatsMixin, DashboardUpdatesMixin, DashboardUserSettingsMixin, ProjectWorkflowMixin, CompanySettingsHelpersMixin, CompanySettingsTableUtilsMixin, CompanySettingsRoleActionsMixin, CompanyCoreMixin, CompanyStatusesMixin, CompanyBoardsMixin, CompanySheetSizesMixin, CompanyHardwareMixin, CompanyNestingCutlistMixin, CompanyPartTypesMixin, CompanySalesMixin, CompanyPageBuilderMixin, QWidget):
    def __init__(self, app, router, on_logout, on_switch_company=None, on_create_company=None):
        super().__init__()
        self.app = app
        self.router = router
        self._on_logout = on_logout
        self._on_switch_company = on_switch_company
        self._on_create_company = on_create_company
        self._nav_buttons = {}
        self._company = {}
        self._stats = {"jobs": 0, "staff": 0, "invites": 0}
        self._projects_all = []
        self._projects_deleted = []
        self._deleted_page_rows_layout = None
        self._deleted_page_empty_label = None
        self._deleted_search_input = None
        self._projects_table = None
        self._projects_search = None
        self._projects_status_filter = None
        self._dashboard_search_wrap = None
        self._selected_project_id = None
        self._project_title_label = None
        self._project_meta_label = None
        self._project_status_btn = None
        self._project_delete_btn = None
        self._project_detail_tab_buttons = {}
        self._project_detail_stack = None
        self._project_detail_tab_key = "general"
        self._project_detail_tab_order = ["general", "sales", "production", "settings"]
        self._dashboard_detail_tab_buttons = {}
        self._dashboard_detail_stack = None
        self._dashboard_detail_tab_key = "general"
        self._dashboard_detail_tab_order = ["general", "sales", "production", "settings"]
        self._dashboard_recent_card = None
        self._dashboard_recent_layout = None
        self._dashboard_detail_top_divider = None
        self._dashboard_detail_title_card = None
        self._detail_permissions_list_layout = None
        self._dashboard_permissions_list_layout = None
        self._detail_permission_combos = {}
        self._dashboard_permission_combos = {}
        self._detail_permission_locked = {}
        self._dashboard_permission_locked = {}
        self._suspend_permission_sync = False
        self._detail_client_name = None
        self._detail_client_phone = None
        self._detail_client_email = None
        self._detail_client_region = None
        self._detail_client_address = None
        self._detail_notes = None
        self._detail_general_side_title = None
        self._detail_general_side_stack = None
        self._detail_images_list = None
        self._detail_images_preview = None
        self._detail_images_upload_btn = None
        self._detail_images_delete_btn = None
        self._detail_save_client_btn = None
        self._detail_save_notes_btn = None
        self._detail_open_cutlist_btn = None
        self._detail_open_notes_btn = None
        self._detail_open_settings_btn = None
        self._detail_open_permissions_btn = None
        self._detail_open_board_settings_btn = None
        self._detail_open_cabinet_specs_btn = None
        self._detail_sales_rooms_list_layout = None
        self._detail_sales_rooms_add_btn = None
        self._detail_sales_rooms_add_top_btn = None
        self._detail_sales_rooms_total_label = None
        self._detail_production_panel_mode = "cabinet_specs"
        self._detail_production_config_host = None
        self._detail_production_board_host = None
        self._detail_embedded_board_settings = None
        self._detail_open_nesting_btn = None
        self._detail_open_order_btn = None
        self._detail_open_unlock_production_btn = None
        self._detail_open_unlock_pill_btn = None
        self._detail_open_images_btn = None
        self._detail_open_cnc_btn = None
        self._detail_open_initial_measure_btn = None
        self._detail_open_items_btn = None
        self._detail_open_quote_btn = None
        self._detail_open_specs_btn = None
        self._dashboard_detail_open_images_btn = None
        self._dashboard_detail_open_notes_btn = None
        self._dashboard_detail_delete_btn = None
        self._dashboard_general_side_title = None
        self._dashboard_general_side_stack = None
        self._dashboard_images_list = None
        self._dashboard_images_preview = None
        self._dashboard_images_upload_btn = None
        self._dashboard_images_delete_btn = None
        self._dashboard_detail_open_cutlist_btn = None
        self._dashboard_detail_open_cnc_btn = None
        self._dashboard_detail_open_nesting_btn = None
        self._dashboard_detail_open_order_btn = None
        self._dashboard_detail_open_unlock_production_btn = None
        self._dashboard_detail_open_unlock_pill_btn = None
        self._dashboard_detail_open_settings_btn = None
        self._dashboard_detail_open_permissions_btn = None
        self._dashboard_detail_open_board_settings_btn = None
        self._dashboard_detail_open_cabinet_specs_btn = None
        self._dashboard_sales_rooms_list_layout = None
        self._dashboard_sales_rooms_add_btn = None
        self._dashboard_sales_rooms_add_top_btn = None
        self._dashboard_sales_rooms_total_label = None
        self._dashboard_production_panel_mode = "cabinet_specs"
        self._dashboard_production_config_host = None
        self._dashboard_production_board_host = None
        self._dashboard_embedded_board_settings = None
        self._dashboard_detail_open_initial_measure_btn = None
        self._dashboard_detail_open_items_btn = None
        self._dashboard_detail_open_quote_btn = None
        self._dashboard_detail_open_specs_btn = None
        self._staff_all = []
        self._staff_table = None
        self._company_theme_input = None
        self._company_theme_preview = None
        self._company_theme_hex = "#2F6BFF"
        self._company_logo_input = None
        self._company_logo_pending_path = ""
        self._company_info_name_value = None
        self._company_info_plan_value = None
        self._company_info_id_value = None
        self._company_info_join_key_value = None
        self._company_info_join_key_btn = None
        self._company_join_key_timer = None
        self._company_settings_stack = None
        self._company_tab_buttons = {}
        self._company_autosave_timers = {}
        self._suspend_company_autosave = False
        self._user_settings_name_input = None
        self._user_settings_mobile_input = None
        self._user_settings_email_input = None
        self._user_settings_uid_input = None
        self._company_status_table = None
        self._company_board_table = None
        self._company_board_finishes_table = None
        self._company_board_material_usage_table = None
        self._company_sheet_sizes_table = None
        self._company_hardware_table = None
        self._company_item_categories_table = None
        self._company_inventory_table = None
        self._company_job_types_table = None
        self._company_quote_extras_table = None
        self._company_quote_template_input = None
        self._company_quote_template_status_label = None
        self._company_sales_min_discount_input = None
        self._company_sales_max_discount_input = None
        self._company_sales_minus_off_quote_total_check = None
        self._company_quote_discount_tiers_table = None
        self._company_nesting_sheet_h = None
        self._company_nesting_sheet_w = None
        self._company_nesting_kerf = None
        self._company_nesting_margin = None
        self._company_cutlist_columns_table = None
        self._company_cutlist_columns_prod_table = None
        self._company_cutlist_columns_sales_table = None
        self._company_cutlist_unlock_suffix_input = None
        self._company_cutlist_unlock_duration_combo = None
        self._company_part_types_table = None
        self._company_roles_table = None
        self._updates_all = []
        self._updates_table = None
        self._stat_labels = {}
        self._user_profile = {}
        self._sidebar_logo_label = None
        self._sidebar_company_label = None
        self._sidebar_frame = None
        self._main_host = None
        self._screen_bg_overlay = None
        self._main_bg_overlay = None
        self._main_bg_image = QPixmap()
        self._main_bg_cache = {}
        self._sidebar_ws_label = None
        self._sidebar_ws2_label = None
        self._sidebar_act_label = None
        self._sidebar_user_badge = None
        self._dashboard_connection_pill = None
        self._dashboard_connection_dot = None
        self._dashboard_connection_text = None
        self._sidebar_user_btn = None
        self._sidebar_logout_btn = None
        self._label_base_styles = {}
        self._input_base_styles = {}
        self._user_photo_input = None
        self._user_photo_pending_path = ""
        self._user_photo_preview = None
        self._user_badge_color_input = None
        self._user_theme_combo = None
        self._refresh_timer = None
        self._production_unlock_refresh_timer = None
        self._realtime_jobs_token = None
        self._realtime_jobs_company_id = ""
        self._production_sticky_unlock_projects = set()
        self._open_project_settings_dialogs = []
        self._open_cutlist_dialogs = []
        self._open_nesting_dialogs = []
        self._open_cnc_dialogs = []
        self._open_initial_measure_dialogs = []
        self._open_sales_items_dialogs = []
        self._open_quote_dialogs = []
        self._open_image_viewers = []
        self._open_completed_projects_dialogs = []
        self._permission_cache = {}
        self._user_role_cache = {}
        self._post_auth_refresh_done = False
        self._sidebar_new_project_btn = None
        self._projects_page_new_btn = None
        self._dashboard_company_stats_cards = None
        self._detail_change_ownership_btn = None
        self._dashboard_change_ownership_btn = None
        self._dashboard_sales_job_type_checks = {}
        self._dashboard_sales_job_type_layout = None
        self._detail_sales_job_type_checks = {}
        self._detail_sales_job_type_layout = None
        self._dashboard_sales_quote_extras_list_layout = None
        self._detail_sales_quote_extras_list_layout = None
        self._load_data()
        self._load_main_background_image()
        self._build_ui()
        QTimer.singleShot(300, self._refresh_connection_mode_pill)
        self._set_section("dashboard")
        self._ensure_realtime_jobs_listener()
        QTimer.singleShot(600, self._post_auth_visual_refresh_once)

    def _post_auth_visual_refresh_once(self) -> None:
        if bool(getattr(self, "_post_auth_refresh_done", False)):
            return
        self._post_auth_refresh_done = True
        try:
            self._load_user_profile(silent=True)
            self._refresh_staff(silent=True)
            self._refresh_projects(silent=True)
            self._refresh_user_settings(silent=True)
            self._sync_sidebar_user_identity()
            self._apply_dashboard_projects_view()
            self._populate_dashboard_project_details(self._selected_project())
        except Exception:
            # Best-effort post-auth visual sync only.
            pass

    def _load_data(self) -> None:
        self._invalidate_access_caches()
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            self._load_user_profile()
            return
        try:
            self._company = dict(self.app.company.get_company(company_id) or {})
        except Exception:
            self._company = {}
        try:
            all_rows = list(self.app.company.list_jobs(company_id) or [])
        except Exception:
            all_rows = []
        try:
            if hasattr(self.app.company, "list_deleted_jobs"):
                self._projects_deleted = list(self.app.company.list_deleted_jobs(company_id) or [])
            else:
                self._projects_deleted = []
        except Exception:
            self._projects_deleted = []
        try:
            self._staff_all = list(self.app.company.list_staff(company_id) or [])
        except Exception:
            self._staff_all = []
        self._projects_all = self._apply_project_visibility_filter(all_rows)
        self._stats["jobs"] = len(self._projects_all)
        self._stats["staff"] = len(self._staff_all)
        self._load_user_profile()

    def _invalidate_access_caches(self) -> None:
        try:
            self._permission_cache.clear()
        except Exception:
            self._permission_cache = {}
        try:
            self._user_role_cache.clear()
        except Exception:
            self._user_role_cache = {}

    def _load_user_profile(self, silent: bool = True) -> None:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        email = str(getattr(self.router.session, "email", "") or "").strip()
        if not uid:
            self._user_profile = {}
            return
        profile = {
            "uid": uid,
            "email": email,
            "displayName": self._default_user_display_name(email),
            "avatarPath": "",
            "badgeColor": "#7D99B3",
            "uiTheme": "light",
        }
        try:
            if hasattr(self.app.company, "get_user_profile"):
                raw = self.app.company.get_user_profile(uid) or {}
                if isinstance(raw, dict):
                    profile.update(raw)
        except Exception as exc:
            if not silent:
                QMessageBox.critical(self, "User settings refresh failed", str(exc))
            return
        if not str(profile.get("displayName") or "").strip():
            profile["displayName"] = self._default_user_display_name(email)
        self._user_profile = profile

    def _build_ui(self) -> None:
        self._screen_bg_overlay = QLabel(self)
        self._screen_bg_overlay.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self._screen_bg_overlay.lower()
        root = QHBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._build_sidebar())
        root.addWidget(self._build_main(), stretch=1)
        self._layout_dashboard_background_image()
        if isinstance(self._screen_bg_overlay, QLabel):
            self._screen_bg_overlay.lower()
        self._apply_user_theme()
        self._sync_permission_scoped_ui()

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._layout_dashboard_background_image()
        if isinstance(self._screen_bg_overlay, QLabel):
            self._screen_bg_overlay.lower()
    def _build_sidebar(self) -> QWidget:
        side = QFrame()
        side.setObjectName("DashboardSidebar")
        side.setFixedWidth(198)
        self._sidebar_frame = side
        layout = QVBoxLayout(side)
        layout.setContentsMargins(14, 12, 0, 12)
        layout.setSpacing(10)



        self._sidebar_logo_label = QLabel()
        self._sidebar_logo_label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self._sidebar_logo_label.setCursor(Qt.CursorShape.PointingHandCursor)
        self._sidebar_logo_label.installEventFilter(self)
        self._sidebar_logo_label.hide()
        layout.addWidget(self._sidebar_logo_label)

        self._sidebar_company_label = QLabel(str(self._company.get("name") or "MYKM"))
        self._sidebar_company_label.setStyleSheet("color: #101827; font-size: 30px; font-weight: 700;")
        self._sidebar_company_label.setCursor(Qt.CursorShape.PointingHandCursor)
        self._sidebar_company_label.installEventFilter(self)
        layout.addWidget(self._sidebar_company_label)

        ws = QLabel("Workspace")
        ws.setStyleSheet("color: #9AA7B8; font-size: 12px;")
        self._sidebar_ws_label = ws
        layout.addWidget(ws)

        self._add_nav_button(layout, "dashboard", "Dashboard")

        new_btn = QPushButton("New Project")
        new_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        new_btn.setMinimumHeight(36)
        new_btn.clicked.connect(self._open_new_project_dialog)
        new_btn.setStyleSheet(
            "QPushButton { background: #7D99B3; color: white; border: none; border-top-left-radius: 12px; border-bottom-left-radius: 12px; border-top-right-radius: 0px; border-bottom-right-radius: 0px; font-size: 13px; font-weight: 700; text-align: left; padding-left: 18px; }"
            "QPushButton:hover { background: #6F8CA8; }"
        )
        self._sidebar_new_project_btn = new_btn
        layout.addWidget(new_btn)

        ws2 = QLabel("WORKSPACE")
        ws2.setStyleSheet("color: #B0BAC8; font-size: 11px; font-weight: 700;")
        self._sidebar_ws2_label = ws2
        layout.addWidget(ws2)
        self._add_nav_button(layout, "recently_deleted", "Recently Deleted")
        self._add_nav_button(layout, "company", "Company Settings")

        act = QLabel("ACTIVITY")
        act.setStyleSheet("color: #B0BAC8; font-size: 11px; font-weight: 700;")
        self._sidebar_act_label = act
        layout.addWidget(act)
        self._add_nav_button(layout, "updates", "Company Updates")
        layout.addStretch(1)
        self._add_nav_button(layout, "user_settings", "User Settings")

        logout_btn = QPushButton("Log out")
        logout_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        logout_btn.setMinimumHeight(36)
        logout_btn.clicked.connect(self._logout_from_menu)
        logout_btn.setStyleSheet(
            "QPushButton {"
            "background: transparent; color: #5B6472; border: none; border-top-left-radius: 12px; border-bottom-left-radius: 12px; border-top-right-radius: 0px; border-bottom-right-radius: 0px;"
            "font-size: 13px; font-weight: 600; text-align: left; padding-left: 18px;"
            "}"
            "QPushButton:hover { background: #F4F6FB; }"
        )
        self._sidebar_logout_btn = logout_btn
        layout.addWidget(logout_btn)

        footer = QWidget()
        footer_row = QHBoxLayout(footer)
        footer_row.setContentsMargins(0, 6, 8, 2)
        footer_row.setSpacing(8)

        self._sidebar_user_badge = QLabel(self._sidebar_user_initials())
        self._sidebar_user_badge.setFixedSize(32, 32)
        self._sidebar_user_badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._sidebar_user_badge.setStyleSheet(
            "QLabel { background: #E6ECF5; color: #5B7392; border: none; border-radius: 16px; font-size: 12px; font-weight: 700; }"
        )
        footer_row.addWidget(self._sidebar_user_badge)

        self._sidebar_user_btn = QToolButton()
        self._sidebar_user_btn.setText(self._sidebar_user_label())
        self._sidebar_user_btn.setCursor(Qt.CursorShape.ArrowCursor)
        self._sidebar_user_btn.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self._sidebar_user_btn.setStyleSheet(
            "QToolButton { background: transparent; border: none; color: #374151; font-size: 12px; font-weight: 600; text-align: left; padding: 0; }"
        )
        footer_row.addWidget(self._sidebar_user_btn, stretch=1)
        self._sync_sidebar_user_identity()

        layout.addWidget(footer)
        self._apply_sidebar_branding()
        self._apply_user_theme()
        return side
    def _add_nav_button(self, layout: QVBoxLayout, key: str, text: str) -> None:
        btn = QPushButton(text)
        btn.setMinimumHeight(36)
        btn.clicked.connect(lambda: self._set_section(key))
        self._nav_buttons[key] = btn
        layout.addWidget(btn)

    def _apply_sidebar_branding(self) -> None:
        logo_lbl = getattr(self, "_sidebar_logo_label", None)
        company_lbl = getattr(self, "_sidebar_company_label", None)
        if company_lbl:
            company_lbl.setText(str((self._company or {}).get("name") or "MYKM"))

        logo_path = str((self._company or {}).get("logoPath") or "").strip()
        if not logo_lbl:
            return
        if logo_path:
            pix = self._image_preview_pixmap(logo_path)
            if not pix.isNull():
                target_w = 170
                scaled = pix.scaledToWidth(target_w, Qt.TransformationMode.SmoothTransformation)
                logo_lbl.setPixmap(scaled)
                logo_lbl.setContentsMargins(0, 0, 0, 10)
                logo_lbl.show()
                if company_lbl:
                    company_lbl.hide()
                return

        logo_lbl.clear()
        logo_lbl.setContentsMargins(0, 0, 0, 0)
        logo_lbl.hide()
        if company_lbl:
            company_lbl.show()

    def eventFilter(self, obj, event):
        if obj is self._main_host and event.type() == QEvent.Type.Resize:
            QTimer.singleShot(0, self._layout_main_background_image)
            return False
        if obj in (self._sidebar_logo_label, self._sidebar_company_label):
            if event.type() == QEvent.Type.MouseButtonRelease and event.button() == Qt.MouseButton.LeftButton:
                self._set_section("dashboard")
                return True
        if event.type() == QEvent.Type.Wheel:
            if obj in (self._detail_images_list, self._dashboard_images_list):
                return True
        if event.type() == QEvent.Type.MouseButtonRelease and event.button() == Qt.MouseButton.LeftButton:
            if obj is self._detail_images_preview:
                self._open_general_image_fullscreen(use_dashboard=False)
                return True
            if obj is self._dashboard_images_preview:
                self._open_general_image_fullscreen(use_dashboard=True)
                return True
            if obj in self._dashboard_client_fields():
                if isinstance(obj, QLineEdit) and obj.isReadOnly():
                    self._begin_dashboard_client_edit(obj)
                    return True
        if event.type() == QEvent.Type.FocusOut:
            if obj is self._detail_notes:
                QTimer.singleShot(0, lambda: self._autosave_notes_from_editor("detail"))
            elif obj is self._dashboard_detail_notes:
                QTimer.singleShot(0, lambda: self._autosave_notes_from_editor("dashboard"))
            elif obj in self._dashboard_client_fields():
                QTimer.singleShot(0, self._autosave_dashboard_client_if_focus_left)
        return super().eventFilter(obj, event)

    def _load_main_background_image(self) -> None:
        self._main_bg_image = QPixmap()
        self._main_bg_cache = {}
        # Dashboard stays on the default app grey background.
        # (Login/auth screens still support bg.png separately.)
        return

    def _layout_main_background_image(self) -> None:
        host = self._main_host
        overlay = self._main_bg_overlay
        if not isinstance(host, QWidget) or not isinstance(overlay, QLabel):
            return
        w = max(1, host.width())
        h = max(1, host.height())
        overlay.setGeometry(0, 0, w, h)
        if self._main_bg_image.isNull():
            overlay.clear()
            return
        key = (w, h)
        cached = self._main_bg_cache.get(key)
        if cached is None:
            scaled = self._main_bg_image.scaled(
                w,
                h,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            sx = (w - scaled.width()) // 2
            sy = (h - scaled.height()) // 2
            canvas = QPixmap(w, h)
            canvas.fill(Qt.GlobalColor.transparent)
            painter = QPainter(canvas)
            painter.drawPixmap(sx, sy, scaled)
            painter.end()
            self._main_bg_cache = {key: canvas}
            cached = canvas
        overlay.setPixmap(cached)
        overlay.lower()

    def _layout_dashboard_background_image(self) -> None:
        overlay = self._screen_bg_overlay
        if not isinstance(overlay, QLabel):
            return
        w = max(1, self.width())
        h = max(1, self.height())
        overlay.setGeometry(0, 0, w, h)
        if self._main_bg_image.isNull():
            overlay.clear()
            return
        key = ("screen", w, h)
        cached = self._main_bg_cache.get(key)
        if cached is None:
            scaled = self._main_bg_image.scaled(
                w,
                h,
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation,
            )
            sx = max(0, (scaled.width() - w) // 2)
            sy = max(0, (scaled.height() - h) // 2)
            canvas = QPixmap(w, h)
            canvas.fill(Qt.GlobalColor.transparent)
            painter = QPainter(canvas)
            painter.drawPixmap(0, 0, scaled, sx, sy, w, h)
            painter.end()
            self._main_bg_cache = {key: canvas}
            cached = canvas
        overlay.setPixmap(cached)

    def _dashboard_client_fields(self) -> tuple[QLineEdit, ...]:
        out: list[QLineEdit] = []
        for w in (
            self._dashboard_detail_client,
            self._dashboard_detail_phone,
            self._dashboard_detail_email,
            self._dashboard_detail_address,
        ):
            if isinstance(w, QLineEdit):
                out.append(w)
        return tuple(out)

    def _begin_dashboard_client_edit(self, focus_widget: QLineEdit | None = None) -> None:
        if str(self._project_user_access_level(self._selected_project())) != "edit":
            return
        fields = self._dashboard_client_fields()
        if not fields:
            return
        for f in fields:
            f.setReadOnly(False)
            f.setCursor(Qt.CursorShape.IBeamCursor)
        if isinstance(focus_widget, QLineEdit):
            focus_widget.setFocus()
            focus_widget.selectAll()

    def _autosave_dashboard_client_from_fields(self, notify: bool = False) -> bool:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            return False
        if str(self._project_user_access_level(raw)) != "edit":
            return False
        fields = self._dashboard_client_fields()
        if not fields:
            return False
        if not any(not f.isReadOnly() for f in fields):
            return False

        name = str(self._dashboard_detail_client.text() or "").strip() if isinstance(self._dashboard_detail_client, QLineEdit) else ""
        phone = str(self._dashboard_detail_phone.text() or "").strip() if isinstance(self._dashboard_detail_phone, QLineEdit) else ""
        email = str(self._dashboard_detail_email.text() or "").strip() if isinstance(self._dashboard_detail_email, QLineEdit) else ""
        address_input = str(self._dashboard_detail_address.text() or "").strip() if isinstance(self._dashboard_detail_address, QLineEdit) else ""
        addr_only, region_only = self._split_address_region(address_input)
        patch = {
            "client": name,
            "clientName": name,
            "clientPhone": phone,
            "clientNumber": phone,
            "clientEmail": email,
            "region": region_only,
            "clientAddress": addr_only,
        }
        if not self._save_project_patch(patch):
            return False

        self._apply_projects_filters()
        updated = self._selected_project()
        if isinstance(updated, dict):
            self._populate_dashboard_project_details(updated)
            self._populate_project_details(updated)
        for f in fields:
            f.setReadOnly(True)
            f.setCursor(Qt.CursorShape.PointingHandCursor)
        if notify:
            QMessageBox.information(self, "Saved", "Client details updated.")
        return True

    def _autosave_dashboard_client_if_focus_left(self) -> None:
        fw = self.focusWidget()
        if isinstance(fw, QLineEdit) and fw in self._dashboard_client_fields():
            return
        self._autosave_dashboard_client_from_fields()

    def _sidebar_user_label(self) -> str:
        profile_name = str((self._user_profile or {}).get("displayName") or "").strip()
        if profile_name:
            return profile_name
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        email = str(getattr(self.router.session, "email", "") or "").strip()
        if uid:
            for row in (self._staff_all or []):
                if str((row or {}).get("uid") or "").strip() == uid:
                    name = str((row or {}).get("displayName") or "").strip()
                    if name:
                        return name
        if email:
            return email.split("@")[0] or email
        return "User"

    def _sidebar_user_initials(self) -> str:
        label = self._sidebar_user_label().strip()
        if not label:
            return "U"
        words = [w for w in label.replace("_", " ").replace("-", " ").split() if w]
        if len(words) >= 2:
            return (words[0][0] + words[1][0]).upper()
        if len(words) == 1 and len(words[0]) >= 2:
            return words[0][:2].upper()
        return label[:1].upper()

    def _circle_avatar_pixmap(self, source: QPixmap, size: QSize) -> QPixmap:
        w = max(1, int(size.width()))
        h = max(1, int(size.height()))
        out = QPixmap(w, h)
        out.fill(Qt.GlobalColor.transparent)
        if source.isNull():
            return out
        p = QPainter(out)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        clip = QPainterPath()
        clip.addEllipse(QRectF(0, 0, float(w), float(h)))
        p.setClipPath(clip)
        src_ratio = source.width() / max(1.0, float(source.height()))
        dst_ratio = w / max(1.0, float(h))
        if src_ratio > dst_ratio:
            target_h = float(source.height())
            target_w = target_h * dst_ratio
            sx = (float(source.width()) - target_w) / 2.0
            src_rect = QRectF(sx, 0.0, target_w, target_h)
        else:
            target_w = float(source.width())
            target_h = target_w / max(0.0001, dst_ratio)
            sy = (float(source.height()) - target_h) / 2.0
            src_rect = QRectF(0.0, sy, target_w, target_h)
        p.drawPixmap(QRectF(0, 0, float(w), float(h)), source, src_rect)
        p.end()
        return out

    def _save_cropped_avatar(self, pixmap: QPixmap) -> str:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid or pixmap.isNull():
            return ""
        base_dir = Path(getattr(getattr(self.app, "config", None), "data_dir", Path.cwd()))
        out_dir = base_dir / "user_avatars"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{uid}_avatar.png"
        if pixmap.save(str(out_path), "PNG"):
            return str(out_path)
        return ""

    def _sync_sidebar_user_identity(self) -> None:
        if self._sidebar_user_badge:
            avatar_path = str((self._user_profile or {}).get("avatarPath") or "").strip()
            pix = self._image_preview_pixmap(avatar_path) if avatar_path else QPixmap()
            if not pix.isNull():
                self._sidebar_user_badge.setPixmap(self._circle_avatar_pixmap(pix, self._sidebar_user_badge.size()))
                self._sidebar_user_badge.setText("")
                self._sidebar_user_badge.setStyleSheet(
                    "QLabel { border: none; border-radius: 16px; background: #DDE5F0; }"
                )
            else:
                self._sidebar_user_badge.setPixmap(QPixmap())
                self._sidebar_user_badge.setText(self._sidebar_user_initials())
                badge_color = self._normalize_hex(str((self._user_profile or {}).get("badgeColor") or "#7D99B3"), "#7D99B3")
                self._sidebar_user_badge.setStyleSheet(
                    f"QLabel {{ background: {badge_color}; color: #FFFFFF; border: none; border-radius: 16px; font-size: 12px; font-weight: 700; }}"
                )
        if self._sidebar_user_btn:
            self._sidebar_user_btn.setText(self._sidebar_user_label())

    def _apply_user_theme(self) -> None:
        mode = str((self._user_profile or {}).get("uiTheme") or "light").strip().lower()
        if mode not in ("light", "dark"):
            mode = "light"

        if mode == "dark":
            if self._sidebar_frame:
                self._sidebar_frame.setStyleSheet("QFrame#DashboardSidebar { background: #2E3440; border-right: 1px solid #454E5C; }")
            if self._main_host:
                self._main_host.setStyleSheet("QWidget#DashboardMainHost { background: #262B33; }")
            if self._sidebar_company_label:
                self._sidebar_company_label.setStyleSheet("color: #E8EDF7; font-size: 30px; font-weight: 700;")
            if self._sidebar_ws_label:
                self._sidebar_ws_label.setStyleSheet("color: #AEB8C9; font-size: 12px;")
            if self._sidebar_ws2_label:
                self._sidebar_ws2_label.setStyleSheet("color: #9FAABF; font-size: 11px; font-weight: 700;")
            if self._sidebar_act_label:
                self._sidebar_act_label.setStyleSheet("color: #9FAABF; font-size: 11px; font-weight: 700;")
            host = self.window()
            if host is not None and hasattr(host, "_set_bg"):
                host._set_bg("#1D2128")
            for frame in self.findChildren(QFrame):
                name = frame.objectName()
                if name in {
                    "DashboardStatCard",
                    "DashboardRecentCard",
                    "DashboardDetailCard",
                    "ProjectsLeftCard",
                    "ProjectsDetailCard",
                    "UserSettingsCard",
                    "CompanyTabsCard",
                    "CompanyInfoCard",
                    "CompanyThemeCard",
                    "CompanyStatusCard",
                    "CompanyRolesCard",
                    "CompanyBoardCard",
                    "CompanyNestingCard",
                    "CompanyColumnsCard",
                    "CompanyPartTypesCard",
                }:
                    frame.setStyleSheet(
                        f"QFrame#{name} {{ background: #171B21; border: 1px solid #2D3440; border-radius: 14px; }}"
                    )
            for table_name in ("ProjectsTable", "StaffTable", "UpdatesTable"):
                table = self.findChild(QTableWidget, table_name)
                if table:
                    table.setStyleSheet(
                        "QTableWidget { background: #11151B; border: 1px solid #2D3440; border-radius: 12px; gridline-color: #252C37; color: #D9E1EC; selection-background-color: #2B3442; selection-color: #FFFFFF; }"
                        "QHeaderView::section { background: #1B2129; color: #AEB9C8; font-size: 12px; font-weight: 700; padding: 8px; border: none; }"
                    )
            self._apply_input_controls_theme(True)
            self._apply_dark_label_colors(True)
        else:
            if self._sidebar_frame:
                self._sidebar_frame.setStyleSheet("QFrame#DashboardSidebar { background: #FFFFFF; border-right: 1px solid #E8EBF1; }")
            if self._main_host:
                self._main_host.setStyleSheet("QWidget#DashboardMainHost { background: transparent; }")
            if self._sidebar_company_label:
                self._sidebar_company_label.setStyleSheet("color: #101827; font-size: 30px; font-weight: 700;")
            if self._sidebar_ws_label:
                self._sidebar_ws_label.setStyleSheet("color: #9AA7B8; font-size: 12px;")
            if self._sidebar_ws2_label:
                self._sidebar_ws2_label.setStyleSheet("color: #B0BAC8; font-size: 11px; font-weight: 700;")
            if self._sidebar_act_label:
                self._sidebar_act_label.setStyleSheet("color: #B0BAC8; font-size: 11px; font-weight: 700;")
            host = self.window()
            if host is not None and hasattr(host, "_set_bg"):
                host._set_bg(APP_BG)
            for frame in self.findChildren(QFrame):
                name = frame.objectName()
                if name in {
                    "DashboardStatCard",
                    "DashboardRecentCard",
                    "DashboardDetailCard",
                    "ProjectsLeftCard",
                    "ProjectsDetailCard",
                    "UserSettingsCard",
                    "CompanyTabsCard",
                    "CompanyInfoCard",
                    "CompanyThemeCard",
                    "CompanyStatusCard",
                    "CompanyRolesCard",
                    "CompanyBoardCard",
                    "CompanyNestingCard",
                    "CompanyColumnsCard",
                    "CompanyPartTypesCard",
                }:
                    frame.setStyleSheet(
                        f"QFrame#{name} {{ background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 14px; }}"
                    )
            projects_table = self.findChild(QTableWidget, "ProjectsTable")
            if projects_table:
                projects_table.setStyleSheet(
                    "QTableWidget { background: white; border: 1px solid #E4E6EC; border-radius: 12px; gridline-color: #F0F2F7; }"
                    "QHeaderView::section { background: #F7F8FA; color: #5B6472; font-size: 12px; font-weight: 700; padding: 8px; border: none; }"
                )
            staff_table = self.findChild(QTableWidget, "StaffTable")
            if staff_table:
                staff_table.setStyleSheet(
                    "QTableWidget { background: white; border: 1px solid #E4E6EC; border-radius: 12px; gridline-color: #F0F2F7; }"
                    "QHeaderView::section { background: #F7F8FA; color: #5B6472; font-size: 12px; font-weight: 700; padding: 8px; border: none; }"
                )
            updates_table = self.findChild(QTableWidget, "UpdatesTable")
            if updates_table:
                updates_table.setStyleSheet(
                    "QTableWidget { background: white; border: 1px solid #E4E6EC; border-radius: 12px; gridline-color: #F0F2F7; }"
                    "QHeaderView::section { background: #F7F8FA; color: #5B6472; font-size: 12px; font-weight: 700; padding: 8px; border: none; }"
                )
            self._apply_input_controls_theme(False)
            self._apply_dark_label_colors(False)
        self._apply_dashboard_projects_view()

    def _apply_dark_label_colors(self, dark: bool) -> None:
        for lbl in self.findChildren(QLabel):
            if lbl is self._sidebar_user_badge:
                continue
            key = id(lbl)
            if key not in self._label_base_styles:
                self._label_base_styles[key] = lbl.styleSheet() or ""
            base = self._label_base_styles.get(key, "")
            if not dark:
                lbl.setStyleSheet(base)
                continue

            # Keep strongly custom badge/tag labels untouched (colored backgrounds, chips, etc.).
            lower = base.lower()
            if "background:" in lower and "transparent" not in lower:
                continue

            if "color:" in base:
                # Replace the existing color declaration with a dark-mode readable tone.
                parts = base.split(";")
                new_parts = []
                replaced = False
                for part in parts:
                    p = part.strip()
                    if p.lower().startswith("color:"):
                        replaced = True
                        tone = "#F1F5FB" if ("font-weight: 700" in base or "font-size: 24px" in base or "font-size: 28px" in base) else "#C8D1DE"
                        new_parts.append(f"color: {tone}")
                    elif p:
                        new_parts.append(p)
                lbl.setStyleSheet("; ".join(new_parts) + (";" if new_parts else ""))
            else:
                # If no explicit color exists, append a readable default.
                lbl.setStyleSheet((base + " " if base else "") + "color: #C8D1DE;")

    def _apply_input_controls_theme(self, dark: bool) -> None:
        line_edit_dark = (
            "QLineEdit { background: #11161D; border: 1px solid #2A3240; border-radius: 10px; padding: 8px 10px; color: #E6EDF8; }"
            "QLineEdit:focus { border: 1px solid #4A5A74; }"
            "QLineEdit[readOnly=\"true\"] { color: #B6C0CF; }"
        )
        combo_dark = (
            "QComboBox { background: #11161D; border: 1px solid #2A3240; border-radius: 10px; padding: 7px 10px; color: #E6EDF8; }"
            "QComboBox:focus { border: 1px solid #4A5A74; }"
            "QComboBox QAbstractItemView { background: #11161D; color: #E6EDF8; border: 1px solid #2A3240; selection-background-color: #2A3444; selection-color: #FFFFFF; }"
        )
        text_edit_dark = (
            "QTextEdit { background: #11161D; border: 1px solid #2A3240; border-radius: 10px; padding: 8px 10px; color: #E6EDF8; }"
            "QTextEdit:focus { border: 1px solid #4A5A74; }"
        )

        for w in self.findChildren(QLineEdit):
            k = id(w)
            if k not in self._input_base_styles:
                self._input_base_styles[k] = w.styleSheet() or ""
            w.setStyleSheet(line_edit_dark if dark else self._input_base_styles.get(k, ""))

        for w in self.findChildren(QComboBox):
            k = id(w)
            if k not in self._input_base_styles:
                self._input_base_styles[k] = w.styleSheet() or ""
            w.setStyleSheet(combo_dark if dark else self._input_base_styles.get(k, ""))

        for w in self.findChildren(QTextEdit):
            k = id(w)
            if k not in self._input_base_styles:
                self._input_base_styles[k] = w.styleSheet() or ""
            w.setStyleSheet(text_edit_dark if dark else self._input_base_styles.get(k, ""))

    def _logout_from_menu(self) -> None:
        if not self._confirm_logout():
            return
        if callable(self._on_logout):
            self._on_logout()

    def _confirm_logout(self) -> bool:
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
                overlay.setObjectName("logoutConfirmOverlay")
                overlay.setStyleSheet("QWidget#logoutConfirmOverlay { background: rgba(15, 23, 42, 92); }")
                overlay.setGeometry(host.rect())
                overlay.show()
                overlay.raise_()
        except Exception:
            overlay = None

        dlg = QDialog(host if isinstance(host, QWidget) else None)
        dlg.setModal(True)
        dlg.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        dlg.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        dlg.setFixedWidth(520)
        dlg.setStyleSheet(
            "QDialog { background: transparent; border: none; }"
            "QFrame#logoutConfirmCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            "QPushButton#confirmBtn { background:#FDECEC; color:#B42318; border:1px solid #F5C2C7; }"
            "QPushButton#confirmBtn:hover { background:#FBD5DA; }"
            "QPushButton#cancelBtn { background:#FFFFFF; color:#334155; border:1px solid #D4DAE6; }"
            "QPushButton#cancelBtn:hover { background:#F8FAFC; }"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("logoutConfirmCard")
        root.addWidget(card, 0)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 14, 16, 12)
        card_l.setSpacing(10)

        title = QLabel("Are you sure you want to log out?")
        title.setWordWrap(True)
        title.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        card_l.addWidget(title, 0)

        btns = QDialogButtonBox()
        confirm_btn = btns.addButton("Log out", QDialogButtonBox.ButtonRole.AcceptRole)
        cancel_btn = btns.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        confirm_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        confirm_btn.setObjectName("confirmBtn")
        cancel_btn.setObjectName("cancelBtn")
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        card_l.addWidget(btns, 0)

        accepted = int(dlg.exec()) == int(QDialog.DialogCode.Accepted)
        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass
        return accepted

    def _switch_company_from_menu(self) -> None:
        if callable(self._on_switch_company):
            self._on_switch_company()
            return
        self.router.session.company_id = None
        self.router.go(Route.COMPANY_SELECT)
        host = self.window()
        if host is not None and hasattr(host, "_render"):
            host._render()

    def _create_company_from_menu(self) -> None:
        if callable(self._on_create_company):
            self._on_create_company()
            return
        self.router.go(Route.COMPANY_CREATE)
        host = self.window()
        if host is not None and hasattr(host, "_render"):
            host._render()

    def _build_main(self) -> QWidget:
        host = QWidget()
        host.setObjectName("DashboardMainHost")
        self._main_host = host
        self._main_bg_overlay = QLabel(host)
        self._main_bg_overlay.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self._main_bg_overlay.lower()
        host.installEventFilter(self)
        layout = QVBoxLayout(host)
        layout.setContentsMargins(22, 16, 14, 14)
        self.stack = QStackedWidget()
        self.stack.addWidget(self._build_dashboard_page())
        self.stack.addWidget(self._build_company_page())
        self.stack.addWidget(self._build_user_settings_page())
        self.stack.addWidget(self._build_updates_page())
        self.stack.addWidget(self._build_recently_deleted_page())
        layout.addWidget(self.stack, stretch=1)
        QTimer.singleShot(0, self._layout_main_background_image)
        return host

    def _build_dashboard_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(12)
        dashboard_title_card = QFrame()
        dashboard_title_card.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 12px; }")
        dashboard_title_layout = QVBoxLayout(dashboard_title_card)
        dashboard_title_layout.setContentsMargins(12, 8, 12, 10)
        dashboard_title_layout.setSpacing(10)
        dashboard_title_row = QHBoxLayout()
        dashboard_title_row.setContentsMargins(0, 0, 0, 0)
        dashboard_title_row.setSpacing(8)
        dashboard_icon_lbl = QLabel()
        dashboard_icon_lbl.setFixedSize(28, 28)
        dashboard_icon_lbl.setStyleSheet("QLabel { background: transparent; border: none; }")
        dashboard_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "dashboard.png"
        dashboard_icon_pix = QPixmap(str(dashboard_icon_path)) if dashboard_icon_path.exists() else QPixmap()
        if not dashboard_icon_pix.isNull():
            dashboard_icon_lbl.setPixmap(dashboard_icon_pix.scaled(24, 24, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        dashboard_title_row.addWidget(dashboard_icon_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
        welcome = QLabel("Dashboard")
        welcome.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 24px; font-weight: 700; background: transparent; border: none;")
        dashboard_title_row.addWidget(welcome, 0, Qt.AlignmentFlag.AlignVCenter)
        dashboard_title_row.addStretch(1)
        mode_pill = QFrame()
        mode_pill.setObjectName("DashboardConnectionPill")
        mode_pill.setStyleSheet("QFrame#DashboardConnectionPill { background:#EAF8F0; border:1px solid #BFE8CF; border-radius:10px; }")
        mode_pill_l = QHBoxLayout(mode_pill)
        mode_pill_l.setContentsMargins(8, 4, 8, 4)
        mode_pill_l.setSpacing(6)
        mode_dot = QLabel("●")
        mode_dot.setStyleSheet("QLabel { color:#1F8A4C; font-size:11px; font-weight:900; background:transparent; border:none; }")
        mode_text = QLabel("ONLINE")
        mode_text.setStyleSheet("QLabel { color:#1F8A4C; font-size:11px; font-weight:800; letter-spacing:0.4px; background:transparent; border:none; }")
        mode_pill_l.addWidget(mode_dot, 0, Qt.AlignmentFlag.AlignVCenter)
        mode_pill_l.addWidget(mode_text, 0, Qt.AlignmentFlag.AlignVCenter)
        self._dashboard_connection_pill = mode_pill
        self._dashboard_connection_dot = mode_dot
        self._dashboard_connection_text = mode_text
        dashboard_title_row.addWidget(mode_pill, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        dashboard_title_layout.addLayout(dashboard_title_row)
        cards = QWidget()
        grid = QGridLayout(cards)
        grid.setContentsMargins(0, 0, 0, 0)
        grid.setHorizontalSpacing(14)
        grid.setVerticalSpacing(12)
        for col in range(4):
            grid.setColumnStretch(col, 1)
        grid.addWidget(self._stat_card("Total Projects", str(self._stats.get("jobs", 0)), on_view=self._show_dashboard_projects_list), 0, 0)
        active_count, completed_count = self._dashboard_status_counts()
        grid.addWidget(self._stat_card("Active", str(active_count), on_view=self._show_dashboard_projects_list), 0, 1)
        grid.addWidget(self._stat_card("Completed", str(completed_count), on_view=self._view_completed_projects), 0, 2)
        grid.addWidget(self._stat_card("Staff Members", str(self._stats.get("staff", 0)), on_view=self._view_staff_members), 0, 3)
        self._dashboard_company_stats_cards = cards
        dashboard_title_layout.addWidget(cards)
        layout.addWidget(dashboard_title_card)
        split = QHBoxLayout(); split.setSpacing(12)
        recent_card = QFrame(); recent_card.setObjectName("DashboardRecentCard")
        recent_card.setStyleSheet("QFrame#DashboardRecentCard { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 16px; }")
        recent_layout = QVBoxLayout(recent_card); recent_layout.setContentsMargins(14, 12, 14, 12); recent_layout.setSpacing(10)
        self._dashboard_recent_card = recent_card
        self._dashboard_recent_layout = recent_layout
        title_card = QFrame()
        title_card.setObjectName("DashboardDetailTopCard")
        title_card.setStyleSheet("QFrame#DashboardDetailTopCard { background: #FFFFFF; border: 1px solid #D9DEE7; border-radius: 12px; }")
        self._dashboard_detail_title_card = title_card
        row = QHBoxLayout(title_card); row.setContentsMargins(10, 8, 10, 8); row.setSpacing(8)
        self._dashboard_projects_back_btn = QPushButton("Back")
        self._dashboard_projects_back_btn.setMinimumSize(72, 30)
        self._dashboard_projects_back_btn.setStyleSheet("QPushButton { background: #F1F3F8; color: #6B7B8F; border: none; border-radius: 14px; padding: 0 12px; font-size: 12px; font-weight: 700; } QPushButton:hover { background: #E8EDF5; }")
        self._dashboard_projects_back_btn.clicked.connect(self._show_dashboard_projects_list)
        self._dashboard_projects_back_btn.hide()
        row.addWidget(self._dashboard_projects_back_btn)
        t = QLabel("Projects")
        t.setStyleSheet("color: #1A1D23; font-size: 18px; font-weight: 700; background: transparent; border: none;")
        row.addWidget(t)
        self._dashboard_projects_title_label = t
        recent_layout.addWidget(title_card)
        self._dashboard_detail_top_divider = None
        self._dashboard_search = QLineEdit(); self._dashboard_search.setPlaceholderText("Search projects...")
        self._dashboard_search.textChanged.connect(self._apply_dashboard_projects_view)
        self._dashboard_search.setStyleSheet("QLineEdit { background: #F3F5F8; border: 1px solid #E4E7ED; border-radius: 12px; padding: 8px 12px; font-size: 13px; color: #6B7280; }")
        self._dashboard_search.setMinimumWidth(280)
        self._dashboard_search.setMaximumWidth(360)
        chips = QHBoxLayout(); chips.setSpacing(8)
        self._dashboard_sort_mode = "latest"
        self._dashboard_filter_buttons = {}
        for key, label in [("latest", "Latest"), ("oldest", "Oldest"), ("az", "A Z"), ("za", "Z A")]:
            btn = QPushButton(label); btn.setMinimumHeight(30); btn.clicked.connect(lambda _=False, mode=key: self._set_dashboard_sort(mode)); self._dashboard_filter_buttons[key]=btn; chips.addWidget(btn)
        chips.addSpacing(6)
        self._dashboard_staff_options = [("__all__", "All")]
        seen_staff_keys: set[str] = set()
        for person in (self._staff_all or []):
            uid = str((person or {}).get("uid") or "").strip()
            display = str((person or {}).get("displayName") or (person or {}).get("email") or uid).strip()
            if not display:
                continue
            key = f"uid:{uid}" if uid else f"name:{display.lower()}"
            if key in seen_staff_keys:
                continue
            seen_staff_keys.add(key)
            self._dashboard_staff_options.append((key, display))
        for raw in (self._projects_all or []):
            creator_name = str((raw or {}).get("createdByName") or "").strip()
            creator_uid = str((raw or {}).get("createdByUid") or "").strip()
            display = creator_name or creator_uid
            if not display:
                continue
            key = f"uid:{creator_uid}" if creator_uid else f"name:{display.lower()}"
            if key in seen_staff_keys:
                continue
            seen_staff_keys.add(key)
            self._dashboard_staff_options.append((key, display))
        self._dashboard_selected_staff_key = "__all__"
        self._dashboard_staff_btn = QToolButton()
        self._dashboard_staff_btn.setText("User")
        self._dashboard_staff_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._dashboard_staff_btn.setMinimumHeight(30)
        self._dashboard_staff_btn.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self._dashboard_staff_btn.setStyleSheet(
            "QToolButton { background: #F1F3F8; color: #6B7B8F; border: none; border-radius: 14px; padding: 0 12px; font-size: 12px; font-weight: 700; text-align: left; }"
            "QToolButton:hover { background: #E8EDF5; }"
            "QToolButton::menu-indicator { image: none; width: 0; }"
        )
        self._dashboard_staff_btn.clicked.connect(self._open_dashboard_staff_menu)
        self._sync_dashboard_staff_filter_label()
        chips.addWidget(self._dashboard_staff_btn)
        self._dashboard_selected_status_filter = "__all__"
        self._dashboard_status_btn = QToolButton()
        self._dashboard_status_btn.setText("Status")
        self._dashboard_status_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._dashboard_status_btn.setMinimumHeight(30)
        self._dashboard_status_btn.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self._dashboard_status_btn.setStyleSheet(
            "QToolButton { background: #F1F3F8; color: #6B7B8F; border: none; border-radius: 14px; padding: 0 12px; font-size: 12px; font-weight: 700; text-align: left; }"
            "QToolButton:hover { background: #E8EDF5; }"
            "QToolButton::menu-indicator { image: none; width: 0; }"
        )
        self._dashboard_status_btn.clicked.connect(self._open_dashboard_status_filter_menu)
        self._sync_dashboard_status_filter_label()
        chips.addWidget(self._dashboard_status_btn)
        self._dashboard_projects_chips_wrap = QWidget(); self._dashboard_projects_chips_wrap.setLayout(chips)
        self._dashboard_projects_chips_wrap.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Fixed)
        row.addStretch(1)
        row.addWidget(self._dashboard_projects_chips_wrap, 0, Qt.AlignmentFlag.AlignCenter | Qt.AlignmentFlag.AlignVCenter)
        row.addStretch(1)
        search_wrap = QWidget()
        search_wrap_row = QHBoxLayout(search_wrap)
        search_wrap_row.setContentsMargins(0, 0, 0, 0)
        search_wrap_row.setSpacing(6)
        search_icon_lbl = QLabel()
        search_icon_lbl.setFixedSize(18, 18)
        search_icon_lbl.setStyleSheet("QLabel { background: transparent; border: none; }")
        search_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "search.png"
        search_icon_pix = QPixmap(str(search_icon_path)) if search_icon_path.exists() else QPixmap()
        if not search_icon_pix.isNull():
            search_icon_lbl.setPixmap(search_icon_pix.scaled(16, 16, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        search_wrap_row.addWidget(search_icon_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
        search_wrap_row.addWidget(self._dashboard_search, 0, Qt.AlignmentFlag.AlignVCenter)
        self._dashboard_search_wrap = search_wrap
        row.addWidget(search_wrap, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        header = QFrame(); header_row = QHBoxLayout(header); header_row.setContentsMargins(8,0,8,0); header_row.setSpacing(14)
        for text, stretch in [("Project Name",33),("Creator",22),("Created",22),("Modified",22)]:
            lbl = QLabel(text); lbl.setStyleSheet("color: #8A97A8; font-size: 12px; font-weight: 700;")
            if text in {"Created", "Modified"}:
                lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            header_row.addWidget(lbl, stretch=stretch)
        hs = QLabel("Status"); hs.setAlignment(Qt.AlignmentFlag.AlignCenter); hs.setFixedWidth(120); hs.setStyleSheet("color: #8A97A8; font-size: 12px; font-weight: 700;"); header_row.addWidget(hs)
        self._dashboard_projects_header_wrap = header; recent_layout.addWidget(header)
        rows_scroll = QScrollArea(); rows_scroll.setWidgetResizable(True); rows_scroll.setFrameShape(QFrame.Shape.NoFrame)
        rows_scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        self._dashboard_rows_host = QWidget(); self._dashboard_rows_host.setStyleSheet("QWidget { background: transparent; }"); self._dashboard_rows_layout = QVBoxLayout(self._dashboard_rows_host); self._dashboard_rows_layout.setContentsMargins(0,0,0,0); self._dashboard_rows_layout.setSpacing(2)
        rows_scroll.viewport().setStyleSheet("background: transparent;")
        rows_scroll.setWidget(self._dashboard_rows_host)
        self._dashboard_projects_rows_scroll = rows_scroll; recent_layout.addWidget(rows_scroll, stretch=1)
        self._dashboard_project_detail_card = self._build_dashboard_project_detail_card(); self._dashboard_project_detail_card.hide(); recent_layout.addWidget(self._dashboard_project_detail_card, stretch=1)
        split.addWidget(recent_card, stretch=1); layout.addLayout(split, stretch=1)
        self._set_dashboard_sort("latest")
        self._apply_dashboard_projects_view()
        return page

    def _refresh_connection_mode_pill(self) -> None:
        pill = self._dashboard_connection_pill
        dot = self._dashboard_connection_dot
        text = self._dashboard_connection_text
        if not isinstance(pill, QFrame) or not isinstance(dot, QLabel) or not isinstance(text, QLabel):
            return
        is_online = bool(getattr(self.router.session, "online_state", True))
        if not is_online:
            text.setText("OFFLINE")
            dot.setStyleSheet("QLabel { color:#D14343; font-size:11px; font-weight:900; background:transparent; border:none; }")
            text.setStyleSheet("QLabel { color:#B42318; font-size:11px; font-weight:800; letter-spacing:0.4px; background:transparent; border:none; }")
            pill.setStyleSheet("QFrame#DashboardConnectionPill { background:#FFECEC; border:1px solid #F7B8B8; border-radius:10px; }")
        else:
            text.setText("ONLINE")
            dot.setStyleSheet("QLabel { color:#1F8A4C; font-size:11px; font-weight:900; background:transparent; border:none; }")
            text.setStyleSheet("QLabel { color:#1F8A4C; font-size:11px; font-weight:800; letter-spacing:0.4px; background:transparent; border:none; }")
            pill.setStyleSheet("QFrame#DashboardConnectionPill { background:#EAF8F0; border:1px solid #BFE8CF; border-radius:10px; }")

    def _build_dashboard_project_detail_card(self) -> QWidget:
        card = QWidget()
        layout = QVBoxLayout(card)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        header_card = QFrame()
        header_card.setObjectName("DashboardDetailHeaderCard")
        header_card.setStyleSheet("QFrame#DashboardDetailHeaderCard { background: #FFFFFF; border: 1px solid #D9DEE7; border-radius: 14px; }")
        header_layout = QVBoxLayout(header_card)
        header_layout.setContentsMargins(14, 12, 14, 12)
        header_layout.setSpacing(6)
        layout.addWidget(header_card)

        body_card = QFrame()
        body_card.setObjectName("DashboardDetailBodyCard")
        body_card.setStyleSheet("QFrame#DashboardDetailBodyCard { background: #FFFFFF; border: none; border-radius: 14px; }")
        body_layout = QVBoxLayout(body_card)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(0)
        layout.addWidget(body_card, 1)

        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(8)
        self._dashboard_detail_name = QLabel("Select a project")
        self._dashboard_detail_name.setStyleSheet("color: #1A1D23; font-size: 24px; font-weight: 700;")
        title_row.addWidget(self._dashboard_detail_name, 1)
        self._dashboard_detail_status_btn = QPushButton("-")
        self._dashboard_detail_status_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._dashboard_detail_status_btn.setMinimumHeight(30)
        self._dashboard_detail_status_btn.setMinimumWidth(120)
        self._dashboard_detail_status_btn.setStyleSheet("QPushButton { background: #E8F0FF; color: #3060D0; border: none; border-radius: 10px; padding: 4px 12px; font-size: 12px; font-weight: 700; }")
        self._dashboard_detail_status_btn.clicked.connect(self._edit_dashboard_detail_status)
        self._dashboard_detail_delete_btn = QPushButton("Delete")
        self._dashboard_detail_delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._dashboard_detail_delete_btn.setMinimumHeight(30)
        self._dashboard_detail_delete_btn.setStyleSheet(
            "QPushButton { background: #FDECEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 10px; padding: 4px 12px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #FADCE0; }"
        )
        self._dashboard_detail_delete_btn.clicked.connect(lambda _=False: self._delete_selected_project(confirm=True, from_dashboard=True))
        title_row.addWidget(self._dashboard_detail_delete_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        title_row.addWidget(self._dashboard_detail_status_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        header_layout.addLayout(title_row)

        self._dashboard_detail_meta = QLabel("Click a project row to view details.")
        self._dashboard_detail_meta.setStyleSheet("color: #7B8798; font-size: 12px;")
        self._dashboard_detail_meta.setWordWrap(True)
        header_layout.addWidget(self._dashboard_detail_meta)

        def _detail_btn(text: str, slot, primary: bool = False) -> QPushButton:
            btn = QPushButton(text)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setMinimumHeight(36)
            if primary:
                btn.setStyleSheet(
                    "QPushButton { background: #7D99B3; color: white; border: none; border-radius: 10px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
                    "QPushButton:hover { background: #6F8CA8; }"
                )
            else:
                btn.setStyleSheet(
                    "QPushButton { background: #F7F8FC; color: #374151; border: 1px solid #E4E6EC; border-radius: 10px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
                    "QPushButton:hover { background: #EEF0F8; }"
                )
            btn.clicked.connect(slot)
            return btn

        tabs_host = QWidget()
        tabs_lay = QHBoxLayout(tabs_host)
        tabs_lay.setContentsMargins(0, 0, 0, 0)
        tabs_lay.setSpacing(0)
        self._dashboard_detail_tab_buttons = {}
        for key, label_text in [
            ("general", "General"),
            ("sales", "Sales"),
            ("production", "Production"),
            ("settings", "Settings"),
        ]:
            tbtn = QPushButton(label_text)
            tbtn.setCursor(Qt.CursorShape.PointingHandCursor)
            tbtn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            tbtn.setMinimumHeight(40)
            tbtn.setProperty("baseTabLabel", label_text)
            tbtn.clicked.connect(lambda _=False, k=key: self._set_dashboard_detail_tab(k))
            tabs_lay.addWidget(tbtn, 1)
            self._dashboard_detail_tab_buttons[key] = tbtn
        body_layout.addWidget(tabs_host, 0)

        self._dashboard_detail_stack = QStackedWidget()
        self._dashboard_detail_stack.setStyleSheet("QStackedWidget { background: transparent; border: none; }")
        content_host = QFrame()
        content_host.setObjectName("DashboardDetailContentHost")
        content_host.setStyleSheet(
            "QFrame#DashboardDetailContentHost {"
            "background: transparent;"
            "border-left: 1px solid #D9DEE7;"
            "border-right: 1px solid #D9DEE7;"
            "border-bottom: 1px solid #D9DEE7;"
            "border-top: none;"
            "border-bottom-left-radius: 14px;"
            "border-bottom-right-radius: 14px;"
            "}"
        )
        content_layout = QVBoxLayout(content_host)
        content_layout.setContentsMargins(14, 12, 14, 12)
        content_layout.setSpacing(8)
        content_layout.addWidget(self._dashboard_detail_stack, 1)
        body_layout.addWidget(content_host, 1)

        general_page = QWidget()
        general_lay = QGridLayout(general_page)
        general_lay.setContentsMargins(0, 0, 0, 0)
        general_lay.setHorizontalSpacing(8)
        general_lay.setVerticalSpacing(8)
        self._dashboard_detail_open_images_btn = _detail_btn("Images", lambda: self._show_general_images_panel(True))
        self._dashboard_detail_open_notes_btn = _detail_btn("Notes", self._open_selected_project_notes)
        general_lay.setColumnStretch(0, 1)
        general_lay.setColumnStretch(1, 1)
        general_details_host = QWidget()
        general_details_layout = QVBoxLayout(general_details_host)
        general_details_layout.setContentsMargins(0, 0, 0, 0)
        general_details_layout.setSpacing(8)
        general_lay.addWidget(general_details_host, 0, 0, 1, 2)
        self._dashboard_detail_stack.addWidget(general_page)

        sales_page = QWidget()
        sales_lay = QHBoxLayout(sales_page)
        sales_lay.setContentsMargins(0, 0, 0, 0)
        sales_lay.setSpacing(12)
        sales_theme = self._normalize_hex(str((self._company or {}).get("themeColor") or ACCENT), ACCENT)
        sales_theme_soft = QColor(sales_theme).lighter(186).name()
        sales_theme_soft_border = QColor(sales_theme).lighter(168).name()
        self._dashboard_detail_open_initial_measure_btn = _detail_btn("Initial Measure", lambda: self._open_initial_measure_cutlist())
        self._dashboard_detail_open_items_btn = _detail_btn("Items", lambda: self._open_sales_items_window())
        self._dashboard_detail_open_quote_btn = _detail_btn("Quote", lambda: self._open_sales_placeholder("Quote"))
        self._dashboard_detail_open_specs_btn = _detail_btn("Specifications", lambda: self._open_sales_placeholder("Specifications"))
        sales_nav_host = QWidget()
        sales_nav_host.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        sales_nav_host.setStyleSheet("QWidget { border-right: 1px solid #E3E8F0; }")
        sales_left = QVBoxLayout(sales_nav_host)
        sales_left.setContentsMargins(0, 0, 12, 0)
        sales_left.setSpacing(10)
        sales_left.addWidget(self._dashboard_detail_open_initial_measure_btn)
        sales_left.addWidget(self._dashboard_detail_open_items_btn)
        sales_left.addWidget(self._dashboard_detail_open_quote_btn)
        sales_left.addWidget(self._dashboard_detail_open_specs_btn)
        sales_left.addStretch(1)
        sales_lay.addWidget(sales_nav_host, 0)
        sales_right = QHBoxLayout()
        sales_right.setContentsMargins(0, 6, 0, 0)
        sales_right.setSpacing(12)

        sales_rooms_card = QFrame()
        sales_rooms_card.setObjectName("salesRoomsCardDash")
        sales_rooms_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        sales_rooms_card.setMinimumWidth(460)
        sales_rooms_card.setMaximumWidth(460)
        sales_rooms_card.setStyleSheet("QFrame#salesRoomsCardDash { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        sales_rooms_lay = QVBoxLayout(sales_rooms_card)
        sales_rooms_lay.setContentsMargins(0, 0, 0, 0)
        sales_rooms_lay.setSpacing(0)
        sales_rooms_top_bar = QFrame()
        sales_rooms_top_bar.setObjectName("salesRoomsTopBarDash")
        sales_rooms_top_bar.setFixedHeight(50)
        sales_rooms_top_bar.setStyleSheet(
            "QFrame#salesRoomsTopBarDash { "
            "background:#FFFFFF; "
            "border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        sales_rooms_top = QHBoxLayout(sales_rooms_top_bar)
        sales_rooms_top.setContentsMargins(14, 15, 14, 11)
        sales_rooms_top.setSpacing(6)
        sales_rooms_title = QLabel("ROOMS")
        sales_rooms_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        sales_rooms_top.addWidget(sales_rooms_title, 1)
        top_add_room_btn = AnimatedOutlineButton("+ Add Room")
        top_add_room_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        top_add_room_btn.setMaximumHeight(24)
        top_add_room_btn.setStyleSheet(
            "QPushButton { "
            "background: #FFFFFF; color: #2D8F8B; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #FFFFFF; color:#247A76; }"
        )
        top_add_room_btn.clicked.connect(lambda _=False: self._add_sales_room_row(True))
        self._dashboard_sales_rooms_add_top_btn = top_add_room_btn
        sales_rooms_top.addWidget(top_add_room_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        sales_rooms_lay.addWidget(sales_rooms_top_bar)
        sales_rooms_top_divider = QFrame()
        sales_rooms_top_divider.setObjectName("salesRoomsTopDividerDash")
        sales_rooms_top_divider.setFixedHeight(1)
        sales_rooms_top_divider.setStyleSheet("QFrame#salesRoomsTopDividerDash { background:#D7DEE8; border:none; }")
        sales_rooms_lay.addWidget(sales_rooms_top_divider)
        sales_rooms_content = QWidget()
        sales_rooms_content_lay = QVBoxLayout(sales_rooms_content)
        sales_rooms_content_lay.setContentsMargins(14, 10, 14, 12)
        sales_rooms_content_lay.setSpacing(8)
        sales_rooms_head = QHBoxLayout()
        sales_rooms_head.setContentsMargins(0, 0, 0, 0)
        sales_rooms_head.setSpacing(6)
        head_action = QLabel("")
        head_action.setFixedWidth(24)
        head_action.setStyleSheet("QLabel { background: transparent; border: none; }")
        head_name = QLabel("Room")
        head_name.setStyleSheet("QLabel { color:#8A97A8; font-size:12px; font-weight:800; letter-spacing:0.5px; background:transparent; border:none; }")
        head_total = QLabel("Price")
        head_total.setStyleSheet("QLabel { color:#8A97A8; font-size:12px; font-weight:800; letter-spacing:0.5px; background:transparent; border:none; }")
        head_total.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        head_inc = QLabel("Included")
        head_inc.setStyleSheet("QLabel { color:#8A97A8; font-size:12px; font-weight:800; letter-spacing:0.5px; background:transparent; border:none; }")
        head_inc.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sales_rooms_head.addWidget(head_action, 0)
        sales_rooms_head.addWidget(head_name, 2)
        sales_rooms_head.addWidget(head_total, 1)
        sales_rooms_head.addWidget(head_inc, 1, Qt.AlignmentFlag.AlignCenter)
        sales_rooms_content_lay.addLayout(sales_rooms_head)
        sales_rooms_head_divider = QFrame()
        sales_rooms_head_divider.setObjectName("salesRoomsHeadDividerDash")
        sales_rooms_head_divider.setFixedHeight(1)
        sales_rooms_head_divider.setStyleSheet("QFrame#salesRoomsHeadDividerDash { background:#D7DEE8; border:none; }")
        sales_rooms_content_lay.addWidget(sales_rooms_head_divider)
        rooms_list_host = QWidget()
        rooms_list_lay = QVBoxLayout(rooms_list_host)
        rooms_list_lay.setContentsMargins(0, 0, 0, 0)
        rooms_list_lay.setSpacing(0)
        self._dashboard_sales_rooms_list_layout = rooms_list_lay
        sales_rooms_content_lay.addWidget(rooms_list_host, 1)
        sales_rooms_footer = QHBoxLayout()
        sales_rooms_footer.setContentsMargins(0, 4, 0, 0)
        sales_rooms_footer.setSpacing(8)
        total_lbl = QLabel("Total")
        total_lbl.setStyleSheet("QLabel { color:#0F2A4A; font-size:30px; font-weight:700; background:transparent; border:none; }")
        self._dashboard_sales_rooms_total_label = total_lbl
        add_room_btn = AnimatedOutlineButton("+ Add Room")
        add_room_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_room_btn.setStyleSheet(
            "QPushButton { "
            "background: #FFFFFF; color: #2D8F8B; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #FFFFFF; color:#247A76; }"
        )
        add_room_btn.clicked.connect(lambda _=False: self._add_sales_room_row(True))
        self._dashboard_sales_rooms_add_btn = add_room_btn
        sales_rooms_footer.addWidget(add_room_btn, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        sales_rooms_footer.addWidget(total_lbl, 1, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        sales_rooms_content_lay.addLayout(sales_rooms_footer)
        sales_rooms_lay.addWidget(sales_rooms_content, 1)
        sales_right.addWidget(sales_rooms_card, 0)

        product_type_card = QFrame()
        product_type_card.setObjectName("salesProductTypeCardDash")
        product_type_card.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Maximum)
        product_type_card.setStyleSheet("QFrame#salesProductTypeCardDash { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        product_type_lay = QVBoxLayout(product_type_card)
        product_type_lay.setContentsMargins(0, 0, 0, 0)
        product_type_lay.setSpacing(0)
        product_type_top_bar = QFrame()
        product_type_top_bar.setObjectName("salesProductTypeTopBarDash")
        product_type_top_bar.setFixedHeight(50)
        product_type_top_bar.setStyleSheet(
            "QFrame#salesProductTypeTopBarDash { "
            "background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        product_type_top_lay = QHBoxLayout(product_type_top_bar)
        product_type_top_lay.setContentsMargins(14, 15, 14, 11)
        product_type_top_lay.setSpacing(6)
        product_type_title = QLabel("PRODUCT TYPE")
        product_type_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        product_type_top_lay.addWidget(product_type_title, 1)
        product_type_lay.addWidget(product_type_top_bar)
        product_type_top_divider = QFrame()
        product_type_top_divider.setObjectName("salesProductTypeTopDividerDash")
        product_type_top_divider.setFixedHeight(1)
        product_type_top_divider.setStyleSheet("QFrame#salesProductTypeTopDividerDash { background:#D7DEE8; border:none; }")
        product_type_lay.addWidget(product_type_top_divider)
        product_type_content = QWidget()
        product_type_content_lay = QVBoxLayout(product_type_content)
        product_type_content_lay.setContentsMargins(14, 10, 14, 12)
        product_type_content_lay.setSpacing(6)
        self._dashboard_sales_job_type_layout = product_type_content_lay
        self._dashboard_sales_job_type_checks = {}
        product_type_content_lay.addStretch(1)
        product_type_lay.addWidget(product_type_content, 1)

        quote_extras_card = QFrame()
        quote_extras_card.setObjectName("salesQuoteExtrasCardDash")
        quote_extras_card.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Maximum)
        quote_extras_card.setStyleSheet("QFrame#salesQuoteExtrasCardDash { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        quote_extras_card_lay = QVBoxLayout(quote_extras_card)
        quote_extras_card_lay.setContentsMargins(0, 0, 0, 0)
        quote_extras_card_lay.setSpacing(0)
        quote_extras_top_bar = QFrame()
        quote_extras_top_bar.setObjectName("salesQuoteExtrasTopBarDash")
        quote_extras_top_bar.setFixedHeight(50)
        quote_extras_top_bar.setStyleSheet(
            "QFrame#salesQuoteExtrasTopBarDash { "
            "background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        quote_extras_top_lay = QHBoxLayout(quote_extras_top_bar)
        quote_extras_top_lay.setContentsMargins(14, 15, 14, 11)
        quote_extras_top_lay.setSpacing(6)
        quote_extras_title = QLabel("QUOTE EXTRAS")
        quote_extras_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        quote_extras_top_lay.addWidget(quote_extras_title, 1)
        quote_extras_card_lay.addWidget(quote_extras_top_bar)
        quote_extras_top_divider = QFrame()
        quote_extras_top_divider.setObjectName("salesQuoteExtrasTopDividerDash")
        quote_extras_top_divider.setFixedHeight(1)
        quote_extras_top_divider.setStyleSheet("QFrame#salesQuoteExtrasTopDividerDash { background:#D7DEE8; border:none; }")
        quote_extras_card_lay.addWidget(quote_extras_top_divider)
        quote_extras_content = QWidget()
        quote_extras_content_lay = QVBoxLayout(quote_extras_content)
        quote_extras_content_lay.setContentsMargins(14, 10, 14, 12)
        quote_extras_content_lay.setSpacing(6)
        quote_extras_list_host = QWidget()
        quote_extras_list_lay = QVBoxLayout(quote_extras_list_host)
        quote_extras_list_lay.setContentsMargins(0, 0, 0, 0)
        quote_extras_list_lay.setSpacing(5)
        self._dashboard_sales_quote_extras_list_layout = quote_extras_list_lay
        quote_extras_content_lay.addWidget(quote_extras_list_host, 0)
        quote_extras_content_lay.addStretch(1)
        quote_extras_card_lay.addWidget(quote_extras_content, 1)

        sales_right.addWidget(product_type_card, 0)
        sales_right.addWidget(quote_extras_card, 0)
        sales_right.addStretch(1)
        sales_right.setAlignment(sales_rooms_card, Qt.AlignmentFlag.AlignTop)
        sales_right.setAlignment(product_type_card, Qt.AlignmentFlag.AlignTop)
        sales_right.setAlignment(quote_extras_card, Qt.AlignmentFlag.AlignTop)
        sales_lay.addLayout(sales_right, 1)
        sales_lay.setAlignment(sales_right, Qt.AlignmentFlag.AlignTop)
        self._refresh_sales_nav_buttons()
        self._dashboard_detail_stack.addWidget(sales_page)

        production_page = QWidget()
        production_page_lay = QVBoxLayout(production_page)
        production_page_lay.setContentsMargins(0, 0, 0, 0)
        production_page_lay.setSpacing(0)
        production_outer_scroll = QScrollArea()
        production_outer_scroll.setWidgetResizable(True)
        production_outer_scroll.setFrameShape(QFrame.Shape.NoFrame)
        production_outer_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        production_outer_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        production_outer_scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        production_content = QWidget()
        production_content.setStyleSheet("QWidget { background: transparent; border: none; }")
        production_lay = QHBoxLayout(production_content)
        production_lay.setContentsMargins(0, 0, 0, 0)
        production_lay.setSpacing(8)
        self._dashboard_detail_open_cutlist_btn = _detail_btn("Cutlist", self._open_cutlist_editor, primary=True)
        self._dashboard_detail_open_nesting_btn = _detail_btn("Nesting", self._open_nesting_layout)
        self._dashboard_detail_open_cnc_btn = _detail_btn("CNC Cutlist", self._open_cnc_cutlist_placeholder)
        self._dashboard_detail_open_order_btn = _detail_btn("Order", self._open_order_placeholder)
        self._dashboard_detail_open_unlock_pill_btn = _detail_btn("Unlock", self._open_production_unlock_prompt_for_selected_project)
        self._dashboard_detail_open_unlock_pill_btn.setStyleSheet(
            "QPushButton { background:#EEF6FF; color:#1E4E8C; border:1px solid #D7E6FA; border-radius:999px; padding:6px 12px; font-size:12px; font-weight:800; }"
            "QPushButton:hover { background:#E3F0FF; border-color:#C9DDF8; }"
        )
        self._dashboard_detail_open_unlock_production_btn = _detail_btn("Unlock Production", self._open_unlock_production_dialog)
        self._dashboard_detail_open_cabinet_specs_btn = None
        self._dashboard_detail_open_board_settings_btn = None
        production_nav_host = QWidget()
        production_nav_host.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        production_nav_host.setStyleSheet("QWidget { border-right: 1px solid #E3E8F0; }")
        production_left_lay = QVBoxLayout(production_nav_host)
        production_left_lay.setContentsMargins(0, 0, 12, 0)
        production_left_lay.setSpacing(10)
        production_left_lay.addWidget(self._dashboard_detail_open_cutlist_btn)
        production_left_lay.addWidget(self._dashboard_detail_open_nesting_btn)
        production_left_lay.addWidget(self._dashboard_detail_open_cnc_btn)
        production_left_lay.addWidget(self._dashboard_detail_open_order_btn)
        production_left_lay.addWidget(self._dashboard_detail_open_unlock_pill_btn)
        production_left_lay.addWidget(self._dashboard_detail_open_unlock_production_btn)
        production_left_lay.addStretch(1)
        production_lay.addWidget(production_nav_host, 0)
        production_right_scroll = QScrollArea()
        production_right_scroll.setWidgetResizable(True)
        production_right_scroll.setFrameShape(QFrame.Shape.NoFrame)
        production_right_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        production_right_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        production_right_scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        production_right_host = QFrame()
        production_right_host.setStyleSheet("QFrame { background:transparent; border:none; }")
        production_right_lay = QVBoxLayout(production_right_host)
        production_right_lay.setContentsMargins(0, 6, 0, 0)
        production_right_lay.setSpacing(8)
        self._dashboard_production_config_host = QWidget()
        self._dashboard_production_config_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        self._dashboard_production_board_host = QWidget()
        self._dashboard_production_board_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        production_right_lay.addWidget(self._dashboard_production_config_host, 0)
        production_right_lay.addWidget(self._dashboard_production_board_host, 0)
        production_right_lay.addStretch(1)
        production_right_scroll.setWidget(production_right_host)
        production_lay.addWidget(production_right_scroll, 1)
        production_outer_scroll.setWidget(production_content)
        production_page_lay.addWidget(production_outer_scroll, 1)
        self._set_production_panel_mode(True, "cabinet_specs")
        self._dashboard_detail_stack.addWidget(production_page)

        settings_page = QWidget()
        settings_lay = QVBoxLayout(settings_page)
        settings_lay.setContentsMargins(0, 0, 0, 0)
        settings_lay.setSpacing(8)
        permissions_card = QFrame()
        permissions_card.setStyleSheet("QFrame { background: #FBFCFE; border: 1px solid #E4E6EC; border-radius: 12px; }")
        permissions_card_lay = QVBoxLayout(permissions_card)
        permissions_card_lay.setContentsMargins(10, 10, 10, 10)
        permissions_card_lay.setSpacing(8)
        permissions_title_row = QHBoxLayout()
        permissions_title_row.setContentsMargins(0, 0, 0, 0)
        permissions_title_row.setSpacing(8)
        permissions_title = QLabel("Project Permissions")
        permissions_title.setStyleSheet("color: #1A1D23; font-size: 13px; font-weight: 700;")
        permissions_title_row.addWidget(permissions_title)
        permissions_title_row.addStretch(1)
        change_owner_btn = QPushButton("Change Ownership")
        change_owner_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        change_owner_btn.setFixedHeight(28)
        change_owner_btn.setStyleSheet(
            "QPushButton { background:#EEF6FF; color:#1E4E8C; border:1px solid #D7E6FA; border-radius:8px; padding: 0 10px; font-size: 11px; font-weight: 700; }"
            "QPushButton:hover { background:#E6F1FF; }"
        )
        change_owner_btn.clicked.connect(self._open_change_project_ownership_dialog)
        self._dashboard_change_ownership_btn = change_owner_btn
        permissions_title_row.addWidget(change_owner_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        permissions_card_lay.addLayout(permissions_title_row)
        self._dashboard_permissions_list_layout = QVBoxLayout()
        self._dashboard_permissions_list_layout.setContentsMargins(0, 0, 0, 0)
        self._dashboard_permissions_list_layout.setSpacing(6)
        permissions_card_lay.addLayout(self._dashboard_permissions_list_layout)
        self._dashboard_detail_open_permissions_btn = None
        settings_lay.addWidget(permissions_card)
        settings_lay.addStretch(1)

        details_cols = QHBoxLayout()
        details_cols.setContentsMargins(0, 0, 0, 0)
        details_cols.setSpacing(12)
        general_details_layout.addLayout(details_cols)
        details_cols.setStretch(0, 0)
        details_cols.setStretch(1, 1)
        details_cols.setStretch(2, 3)

        details_actions = QWidget()
        details_actions.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)
        _nav_w = int(self._stacked_nav_shared_width() + 12) if hasattr(self, "_stacked_nav_shared_width") else 260
        details_actions.setFixedWidth(_nav_w)
        details_actions.setStyleSheet("QWidget { border-right: 1px solid #E3E8F0; }")
        details_actions_layout = QVBoxLayout(details_actions)
        details_actions_layout.setContentsMargins(0, 0, 12, 0)
        details_actions_layout.setSpacing(10)
        details_actions_layout.addWidget(self._dashboard_detail_open_images_btn)
        details_actions_layout.addWidget(self._dashboard_detail_open_notes_btn)
        details_actions_layout.addStretch(1)
        details_cols.addWidget(details_actions, 0)

        details_left = QFrame()
        details_left.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        details_left.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        details_left.setMinimumWidth(340)
        details_left_wrap = QVBoxLayout(details_left)
        details_left_wrap.setContentsMargins(0, 0, 0, 0)
        details_left_wrap.setSpacing(0)
        details_left_head = QFrame()
        details_left_head.setFixedHeight(50)
        details_left_head.setStyleSheet(
            "QFrame { background:#FFFFFF; border:none; border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        details_left_head_l = QHBoxLayout(details_left_head)
        details_left_head_l.setContentsMargins(14, 15, 14, 11)
        details_left_head_l.setSpacing(6)
        client_title = QLabel("CLIENT DETAILS")
        client_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        details_left_head_l.addWidget(client_title, 1, Qt.AlignmentFlag.AlignVCenter)
        details_left_wrap.addWidget(details_left_head)
        details_left_div = QFrame()
        details_left_div.setFixedHeight(1)
        details_left_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        details_left_wrap.addWidget(details_left_div)
        details_left_body = QWidget()
        details_left_layout = QVBoxLayout(details_left_body)
        details_left_layout.setContentsMargins(12, 10, 12, 12)
        details_left_layout.setSpacing(8)
        details_left_wrap.addWidget(details_left_body, 1)
        details_left_slot = QWidget()
        details_left_slot.setStyleSheet("QWidget { background: transparent; border: none; }")
        details_left_slot_l = QVBoxLayout(details_left_slot)
        details_left_slot_l.setContentsMargins(0, 6, 0, 0)
        details_left_slot_l.setSpacing(0)
        details_left_slot_l.addWidget(details_left, 1)
        details_cols.addWidget(details_left_slot, 1)

        details_right = QFrame()
        details_right.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        details_right.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        details_right.setMinimumWidth(0)
        details_right_wrap = QVBoxLayout(details_right)
        details_right_wrap.setContentsMargins(0, 0, 0, 0)
        details_right_wrap.setSpacing(0)
        details_right_head = QFrame()
        details_right_head.setFixedHeight(50)
        details_right_head.setStyleSheet(
            "QFrame { background:#FFFFFF; border:none; border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        details_right_head_l = QHBoxLayout(details_right_head)
        details_right_head_l.setContentsMargins(14, 15, 14, 11)
        details_right_head_l.setSpacing(6)
        notes_title = QLabel("NOTES")
        notes_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        self._dashboard_general_side_title = notes_title
        details_right_head_l.addWidget(notes_title, 0, Qt.AlignmentFlag.AlignVCenter)
        details_right_head_l.addStretch(1)
        upload_btn = QPushButton("Upload")
        upload_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        upload_btn.setMinimumHeight(30)
        upload_btn.setFixedWidth(112)
        upload_btn.setStyleSheet(
            "QPushButton { background: #7D99B3; color: white; border: none; border-radius: 9px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #6F8CA8; }"
            "QPushButton:disabled { background: #D5DAE3; color: #94A0B2; }"
        )
        upload_btn.clicked.connect(lambda _=False: self._upload_project_images_for_general(True))
        upload_btn.setVisible(False)
        self._dashboard_images_upload_btn = upload_btn
        delete_btn = QPushButton("Delete")
        delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        delete_btn.setMinimumHeight(26)
        delete_btn.setFixedWidth(84)
        delete_btn.setStyleSheet(
            "QPushButton { background: #FCEBEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 8px; padding: 0 8px; font-size: 11px; font-weight: 700; }"
            "QPushButton:hover { background: #FADCE0; }"
            "QPushButton:disabled { background: #F5F5F6; color: #A5A8B0; border-color: #E6E8EE; }"
        )
        delete_btn.clicked.connect(lambda _=False: self._delete_current_project_image_for_general(True))
        delete_btn.setVisible(False)
        self._dashboard_images_delete_btn = delete_btn
        details_right_head_l.addWidget(upload_btn, 0, Qt.AlignmentFlag.AlignVCenter)
        details_right_head_l.addWidget(delete_btn, 0, Qt.AlignmentFlag.AlignVCenter)
        details_right_wrap.addWidget(details_right_head)
        details_right_div = QFrame()
        details_right_div.setFixedHeight(1)
        details_right_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        details_right_wrap.addWidget(details_right_div)
        details_right_body = QWidget()
        details_right_layout = QVBoxLayout(details_right_body)
        details_right_layout.setContentsMargins(12, 10, 12, 12)
        details_right_layout.setSpacing(8)
        details_right_wrap.addWidget(details_right_body, 1)
        details_right_slot = QWidget()
        details_right_slot.setStyleSheet("QWidget { background: transparent; border: none; }")
        details_right_slot_l = QVBoxLayout(details_right_slot)
        details_right_slot_l.setContentsMargins(0, 6, 0, 0)
        details_right_slot_l.setSpacing(0)
        details_right_slot_l.addWidget(details_right, 1)
        details_cols.addWidget(details_right_slot, 1)
        details_cols.setStretchFactor(details_left_slot, 1)
        details_cols.setStretchFactor(details_right_slot, 3)
        self._refresh_general_nav_buttons()

        def _info_field(title: str, host_layout: QVBoxLayout) -> QLineEdit:
            row = QHBoxLayout()
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(8)
            title_lbl = QLabel(title)
            title_lbl.setStyleSheet("QLabel { color: #374151; font-size: 12px; font-weight: 700; background: transparent; border: none; }")
            title_lbl.setFixedWidth(64)
            field = QLineEdit("-")
            field.setReadOnly(True)
            field.setFrame(False)
            field.setCursor(Qt.CursorShape.PointingHandCursor)
            field.setMinimumWidth(0)
            field.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            field.setStyleSheet(
                "QLineEdit { color: #1F2937; font-size: 12px; background: transparent; border: none; padding: 2px 0px; }"
            )
            field.installEventFilter(self)
            row.addWidget(title_lbl)
            row.addWidget(field)
            host_layout.addLayout(row)
            return field

        def _add_client_row_divider(host_layout: QVBoxLayout) -> None:
            div = QFrame()
            div.setFixedHeight(1)
            div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
            host_layout.addWidget(div, 0)

        self._dashboard_detail_client = _info_field("Name", details_left_layout)
        _add_client_row_divider(details_left_layout)
        self._dashboard_detail_phone = _info_field("Phone", details_left_layout)
        _add_client_row_divider(details_left_layout)
        self._dashboard_detail_email = _info_field("Email", details_left_layout)
        _add_client_row_divider(details_left_layout)
        self._dashboard_detail_region = None
        self._dashboard_detail_address = _info_field("Address", details_left_layout)
        details_left_layout.addStretch(1)

        side_stack = QStackedWidget()
        side_stack.setStyleSheet("QStackedWidget { background: transparent; border: none; }")
        self._dashboard_general_side_stack = side_stack
        notes_box = QTextEdit()
        notes_box.setReadOnly(False)
        notes_box.setMinimumHeight(132)
        notes_box.setStyleSheet(
            "QTextEdit { color: #1F2937; font-size: 12px; background: transparent; border: none; padding: 2px 0px; }"
        )
        notes_box.installEventFilter(self)
        side_stack.addWidget(notes_box)
        self._dashboard_detail_notes = notes_box
        images_page = QWidget()
        images_page_layout = QVBoxLayout(images_page)
        images_page_layout.setContentsMargins(0, 0, 0, 0)
        images_page_layout.setSpacing(0)
        gallery_layout = QHBoxLayout()
        gallery_layout.setContentsMargins(0, 0, 0, 0)
        gallery_layout.setSpacing(8)
        thumb_col = QVBoxLayout()
        thumb_col.setContentsMargins(0, 0, 0, 0)
        thumb_col.setSpacing(6)
        images_list = QListWidget()
        images_list.setViewMode(QListWidget.ViewMode.IconMode)
        images_list.setFlow(QListWidget.Flow.TopToBottom)
        images_list.setMovement(QListWidget.Movement.Static)
        images_list.setWrapping(False)
        images_list.setResizeMode(QListWidget.ResizeMode.Adjust)
        images_list.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        images_list.setIconSize(QSize(84, 84))
        images_list.setFixedWidth(112)
        images_list.setSpacing(6)
        images_list.setCursor(Qt.CursorShape.PointingHandCursor)
        images_list.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        images_list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        images_list.setStyleSheet(
            "QListWidget { background: transparent; border: none; padding: 0px; }"
            "QListWidget::item { border-radius: 6px; margin: 2px; outline: none; }"
            "QListWidget::item:selected { background: transparent; }"
            "QListWidget::item:selected:active { background: transparent; color: #1F2937; }"
            "QListWidget::item:selected:!active { background: transparent; color: #1F2937; }"
        )
        images_list.viewport().setCursor(Qt.CursorShape.PointingHandCursor)
        images_list.installEventFilter(self)
        images_preview = QLabel("No images uploaded.")
        images_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        images_preview.setMinimumHeight(132)
        images_preview.setMinimumWidth(0)
        images_preview.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Expanding)
        images_preview.setStyleSheet("QLabel { background: transparent; border: none; color: #6B7280; font-size: 12px; padding: 8px; }")
        images_preview.setScaledContents(False)
        images_preview.setCursor(Qt.CursorShape.PointingHandCursor)
        images_preview.installEventFilter(self)
        preview_col = QVBoxLayout()
        preview_col.setContentsMargins(0, 0, 0, 0)
        preview_col.setSpacing(6)
        preview_col.addWidget(images_preview, 1)
        preview_host = QWidget()
        preview_host.setLayout(preview_col)
        thumb_col.addWidget(images_list, 1)
        gallery_layout.addLayout(thumb_col, 0)
        gallery_layout.addWidget(preview_host, 1)
        images_page_layout.addLayout(gallery_layout, 1)
        images_list.currentRowChanged.connect(lambda _row: self._update_general_image_preview(True))
        side_stack.addWidget(images_page)
        self._dashboard_images_list = images_list
        self._dashboard_images_preview = images_preview
        details_right_layout.addWidget(side_stack, 1)
        self._dashboard_detail_stack.addWidget(settings_page)
        self._set_dashboard_detail_tab("general")
        return card

    def _open_dashboard_project_details(self, raw: dict) -> None:
        if not isinstance(raw, dict):
            return
        incoming = dict(raw or {})
        self._selected_project_id = str((incoming or {}).get("id") or "").strip() or None
        fresh = self._reload_project_row_by_id(self._selected_project_id)
        active = dict(fresh or incoming)
        self._dashboard_detail_raw = dict(active)
        self._populate_project_details(active)
        self._populate_dashboard_project_details(active)
        if self._dashboard_projects_title_label:
            self._dashboard_projects_title_label.setText("Project Details")
        if self._dashboard_projects_back_btn:
            self._dashboard_projects_back_btn.show()
        if isinstance(self._dashboard_recent_card, QFrame):
            self._dashboard_recent_card.setStyleSheet("QFrame#DashboardRecentCard { background: #F5F6F8; border: none; border-radius: 0px; }")
        if isinstance(self._dashboard_recent_layout, QVBoxLayout):
            self._dashboard_recent_layout.setContentsMargins(0, 0, 0, 0)
            self._dashboard_recent_layout.setSpacing(10)
        if isinstance(self._dashboard_detail_title_card, QFrame):
            self._dashboard_detail_title_card.show()
        for widget in [self._dashboard_search_wrap, self._dashboard_projects_chips_wrap, self._dashboard_projects_header_wrap, self._dashboard_projects_rows_scroll]:
            if widget:
                widget.hide()
        if self._dashboard_project_detail_card:
            self._dashboard_project_detail_card.show()

    def _show_dashboard_projects_list(self) -> None:
        if self._dashboard_projects_title_label:
            self._dashboard_projects_title_label.setText("Projects")
        if self._dashboard_projects_back_btn:
            self._dashboard_projects_back_btn.hide()
        if isinstance(self._dashboard_recent_card, QFrame):
            self._dashboard_recent_card.setStyleSheet("QFrame#DashboardRecentCard { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 16px; }")
        if isinstance(self._dashboard_recent_layout, QVBoxLayout):
            self._dashboard_recent_layout.setContentsMargins(14, 12, 14, 12)
            self._dashboard_recent_layout.setSpacing(10)
        if isinstance(self._dashboard_detail_title_card, QFrame):
            self._dashboard_detail_title_card.show()
        if self._dashboard_project_detail_card:
            self._dashboard_project_detail_card.hide()
        for widget in [self._dashboard_search_wrap, self._dashboard_projects_chips_wrap, self._dashboard_projects_header_wrap, self._dashboard_projects_rows_scroll]:
            if widget:
                widget.show()

    def _populate_dashboard_project_details(self, raw: dict | None) -> None:
        if not raw:
            if self._dashboard_detail_status_btn:
                self._dashboard_detail_status_btn.setEnabled(False)
            if self._dashboard_detail_delete_btn:
                self._dashboard_detail_delete_btn.setEnabled(False)
            self._sync_project_image_upload_buttons(None)
            self._refresh_inline_permissions(None)
            self._refresh_sales_rooms_panel(True, None)
            self._refresh_sales_job_type_panel(True, None)
            self._refresh_sales_quote_extras_panel(True, None)
            self._mount_embedded_board_settings(True, None)
            return
        name = str((raw or {}).get("name") or "Untitled")
        status = str((raw or {}).get("status") or "New")
        creator = self._project_creator_display_name(raw)
        created = self._short_date_with_time(str((raw or {}).get("createdAtIso") or ""))
        updated = self._short_date_with_time(str((raw or {}).get("updatedAtIso") or ""))

        if self._dashboard_detail_name:
            self._dashboard_detail_name.setText(name)
        client_name = str((raw or {}).get("client") or (raw or {}).get("clientName") or "-").strip() or "-"
        if self._dashboard_detail_meta:
            self._dashboard_detail_meta.setText(
                self._project_meta_two_col_html(
                    f"Client Name: {client_name}",
                    f"Date Created: {created}",
                    f"Project Creator: {creator}",
                    f"Date Modified: {updated}",
                )
            )
        if self._dashboard_detail_status_btn:
            self._dashboard_detail_status_btn.setEnabled(True)
            self._dashboard_detail_status_btn.setText(status)
            self._apply_status_button_style(self._dashboard_detail_status_btn, status)
        if self._dashboard_detail_delete_btn:
            self._dashboard_detail_delete_btn.setEnabled(True)
        if self._dashboard_detail_client:
            self._dashboard_detail_client.setText(str((raw or {}).get("client") or (raw or {}).get("clientName") or "-"))
        if self._dashboard_detail_phone:
            self._dashboard_detail_phone.setText(str((raw or {}).get("clientPhone") or (raw or {}).get("clientNumber") or "-"))
        if self._dashboard_detail_email:
            self._dashboard_detail_email.setText(str((raw or {}).get("clientEmail") or "-"))
        address_combined = self._compose_address_region(
            str((raw or {}).get("clientAddress") or ""),
            str((raw or {}).get("region") or ""),
        )
        if self._dashboard_detail_address:
            self._dashboard_detail_address.setText(address_combined or "-")
        for f in self._dashboard_client_fields():
            f.setReadOnly(True)
            f.setCursor(Qt.CursorShape.PointingHandCursor)
        if self._dashboard_detail_notes:
            if isinstance(self._dashboard_detail_notes, QTextEdit):
                self._dashboard_detail_notes.setPlainText(str((raw or {}).get("notes") or ""))
            else:
                self._dashboard_detail_notes.setText(str((raw or {}).get("notes") or "-"))
        self._refresh_general_images_lists(raw)
        self._sync_project_image_upload_buttons(raw)
        self._refresh_inline_permissions(raw)
        self._refresh_sales_rooms_panel(True, raw)
        self._refresh_sales_job_type_panel(True, raw)
        self._refresh_sales_quote_extras_panel(True, raw)
        self._mount_embedded_board_settings(True, raw)
        self._apply_project_tab_permissions(raw)

    def _edit_dashboard_detail_status(self) -> None:
        raw = self._selected_project()
        if isinstance(raw, dict) and self._dashboard_detail_status_btn:
            self._open_dashboard_status_picker(raw, self._dashboard_detail_status_btn)

    def _set_dashboard_detail_tab(self, key: str) -> None:
        prev_tab_key = str(self._dashboard_detail_tab_key or "general").strip().lower()
        tab_key = str(key or "general").strip().lower()
        if tab_key not in ("general", "sales", "production", "settings"):
            tab_key = "general"
        if tab_key in ("sales", "production"):
            can_view, _can_edit = self._project_tab_access(self._selected_project(), tab_key)
            if not can_view and tab_key == "production":
                if self._open_production_unlock_prompt_for_selected_project():
                    can_view, _can_edit = self._project_tab_access(self._selected_project(), tab_key)
            if not can_view:
                if tab_key == "production":
                    self._refresh_dashboard_detail_tab_styles()
                    return
                tab_key = "general"
        self._dashboard_detail_tab_key = tab_key
        if prev_tab_key == "production" and tab_key != "production":
            self._clear_sticky_production_unlock_if_expired(self._selected_project())
        if isinstance(self._dashboard_detail_stack, QStackedWidget):
            idx_map = {"general": 0, "sales": 1, "production": 2, "settings": 3}
            self._dashboard_detail_stack.setCurrentIndex(int(idx_map.get(tab_key, 0)))
        self._refresh_dashboard_detail_tab_styles()

    def _set_project_tab_text_underline(self, btn: QPushButton, active: bool) -> None:
        if not isinstance(btn, QPushButton):
            return
        bar = btn.findChild(QFrame, "projectTabTextUnderline")
        if not isinstance(bar, QFrame):
            bar = QFrame(btn)
            bar.setObjectName("projectTabTextUnderline")
        if not bool(active):
            bar.hide()
            return
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or ACCENT), ACCENT)
        label = str(btn.text() or "").replace("&", "").strip()
        fm = QFontMetrics(btn.font())
        width = max(12, int(fm.horizontalAdvance(label or "Tab")))
        width = min(max(12, btn.width() - 10), width)
        bar.setFixedSize(width, 3)
        bar.setStyleSheet(f"QFrame#projectTabTextUnderline {{ background: {theme}; border: none; border-radius: 2px; }}")
        bar.move(max(5, (btn.width() - width) // 2), max(0, btn.height() - 5))
        bar.raise_()
        bar.show()

    def _set_project_tab_timer_pill(self, btn: QPushButton, timer_text: str | None) -> None:
        if not isinstance(btn, QPushButton):
            return
        old_pill = btn.findChild(QLabel, "projectTabTimerPill")
        if isinstance(old_pill, QLabel):
            old_pill.hide()
        pill = btn.findChild(QWidget, "projectTabTimerPillHost")
        txt = str(timer_text or "").strip()
        if not txt:
            if isinstance(pill, QWidget):
                pill.hide()
            return
        icon_lbl = None
        text_lbl = None
        if not isinstance(pill, QWidget):
            pill = QWidget(btn)
            pill.setObjectName("projectTabTimerPillHost")
            pill_lay = QHBoxLayout(pill)
            pill_lay.setContentsMargins(6, 1, 6, 1)
            pill_lay.setSpacing(4)
            icon_lbl = QLabel(pill)
            icon_lbl.setObjectName("projectTabTimerIcon")
            icon_lbl.setFixedSize(10, 10)
            icon_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            text_lbl = QLabel(pill)
            text_lbl.setObjectName("projectTabTimerText")
            text_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            pill_lay.addWidget(icon_lbl, 0)
            pill_lay.addWidget(text_lbl, 0)
        else:
            icon_lbl = pill.findChild(QLabel, "projectTabTimerIcon")
            text_lbl = pill.findChild(QLabel, "projectTabTimerText")
        if isinstance(text_lbl, QLabel):
            text_lbl.setText(txt)
            text_lbl.setStyleSheet("QLabel#projectTabTimerText { color:#475569; font-size:10px; font-weight:700; background: transparent; border: none; }")
        if isinstance(icon_lbl, QLabel):
            lock_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "unlock.png"
            icon = self._build_tinted_icon(lock_icon_path, QColor("#475569")) if hasattr(self, "_build_tinted_icon") else QIcon()
            pix = icon.pixmap(QSize(10, 10))
            icon_lbl.setPixmap(pix)
            icon_lbl.setStyleSheet("QLabel#projectTabTimerIcon { background: transparent; border: none; }")
        pill.setStyleSheet(
            "QWidget#projectTabTimerPillHost { "
            "background:#EEF2F7; border:1px solid #D6DEE9; border-radius:8px; }"
        )
        # Size to content.
        base_font = text_lbl.font() if isinstance(text_lbl, QLabel) else btn.font()
        fm = QFontMetrics(base_font)
        text_w = int(fm.horizontalAdvance(txt))
        w = max(56, text_w + 6 + 10 + 4 + 6)
        h = 18
        pill.resize(w, h)
        def _place_pill() -> None:
            if not isinstance(btn, QPushButton) or not isinstance(pill, QWidget):
                return
            # Keep the title centered; place pill immediately to the title's right.
            base_label = str(btn.property("baseTabLabel") or btn.text() or "").strip() or "Production"
            title_w = int(QFontMetrics(btn.font()).horizontalAdvance(base_label))
            title_x = max(6, (btn.width() - title_w) // 2)
            desired_x = title_x + title_w + 8
            x = min(max(6, desired_x), max(6, btn.width() - w - 8))
            pill.move(x, max(0, (btn.height() - h) // 2))
            pill.raise_()
            pill.show()

        _place_pill()
        # Re-apply once event loop settles so first-paint/layout state matches clicked state.
        QTimer.singleShot(0, _place_pill)

    def _refresh_dashboard_detail_tab_styles(self) -> None:
        if not isinstance(self._dashboard_detail_tab_buttons, dict):
            return
        inactive_bg = "#F1F5F9"
        inactive_hover = "#E8EEF5"
        disabled_bg = "#EEF1F5"
        disabled_text = "#9AA7B8"
        raw = self._selected_project()
        ordered_keys = [k for k in (self._dashboard_detail_tab_order or []) if k in self._dashboard_detail_tab_buttons]
        if not ordered_keys:
            ordered_keys = list(self._dashboard_detail_tab_buttons.keys())
        total = len(ordered_keys)
        project_access = str(self._project_user_access_level(raw))
        for idx, key in enumerate(ordered_keys):
            btn = self._dashboard_detail_tab_buttons.get(key)
            if not isinstance(btn, QPushButton):
                continue
            tab_can_view, _tab_can_edit = self._project_tab_access(raw, str(key))
            if str(key) not in ("sales", "production"):
                tab_can_view = True
            btn_clickable = bool(tab_can_view)
            if str(key) == "production" and not tab_can_view:
                btn_clickable = bool(project_access in ("view", "edit"))
            btn.setEnabled(btn_clickable)
            base_label = str(btn.property("baseTabLabel") or btn.text() or "").strip() or str(key).title()
            btn.setText(base_label)
            timer_txt = None
            if str(key) == "production":
                rem_secs = self._current_user_temp_production_remaining_seconds(raw)
                if isinstance(rem_secs, int) and rem_secs > 0:
                    timer_txt = self._format_temp_unlock_timer(rem_secs)
            self._set_project_tab_timer_pill(btn, timer_txt)
            locked_tab = str(key) in ("sales", "production") and not bool(tab_can_view)
            if locked_tab:
                lock_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "lock.png"
                lock_icon = self._build_tinted_icon(lock_icon_path, QColor(disabled_text)) if hasattr(self, "_build_tinted_icon") else QIcon()
                btn.setIcon(lock_icon)
                btn.setIconSize(QSize(12, 12))
            else:
                btn.setIcon(QIcon())
            active = str(key) == str(self._dashboard_detail_tab_key)
            is_first = idx == 0
            is_last = idx == (total - 1)
            tl = "10px" if is_first else "0px"
            tr = "10px" if is_last else "0px"
            common_shape = (
                f"border-top-left-radius: {tl}; border-top-right-radius: {tr}; "
                "border-bottom-left-radius: 0px; border-bottom-right-radius: 0px;"
            )
            corner_outline = ""
            if is_first:
                corner_outline += " border-left: 1px solid #E4E6EC;"
            if is_last:
                corner_outline += " border-right: 1px solid #E4E6EC;"
            if not tab_can_view:
                divider = "border-right: 1px solid #E4E9F2;" if not is_last else ""
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background: {disabled_bg}; color: {disabled_text}; border: none; border-top: 1px solid #DCE3EE; border-bottom: 1px solid #DCE3EE; {divider} {corner_outline} {common_shape}"
                    "font-size: 16px; font-weight: 700; padding: 10px 10px; margin: 0px; }"
                    f"QPushButton:hover {{ background: {disabled_bg}; color: {disabled_text}; }}"
                )
                self._set_project_tab_timer_pill(btn, None)
                self._set_project_tab_text_underline(btn, False)
                continue
            if active:
                divider = "border-right: 1px solid #E4E9F2;" if not is_last else ""
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background: #FFFFFF; color: #20304A; border: none; border-top: 1px solid #DCE3EE; border-bottom: none; {divider} {corner_outline} {common_shape}"
                    "font-size: 16px; font-weight: 700; padding: 11px 10px; margin: 0px; }"
                    "QPushButton:hover { background: #FFFFFF; color: #20304A; }"
                )
            else:
                divider = "border-right: 1px solid #E4E9F2;" if not is_last else ""
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background: {inactive_bg}; color: #355172; border: none; border-top: 1px solid #DCE3EE; border-bottom: 1px solid #DCE3EE; {divider} {corner_outline} {common_shape}"
                    "font-size: 16px; font-weight: 700; padding: 10px 10px; margin: 0px; }"
                    f"QPushButton:hover {{ background: {inactive_hover}; color: #2E4867; }}"
                )
            self._set_project_tab_text_underline(btn, active)
        self._schedule_production_unlock_timer_refresh()

    def _apply_dashboard_projects_view(self) -> None:
        rows_layout = getattr(self, "_dashboard_rows_layout", None)
        if rows_layout is None:
            return

        term = (self._dashboard_search.text().strip().lower() if getattr(self, "_dashboard_search", None) else "")
        selected_staff_key = str(getattr(self, "_dashboard_selected_staff_key", "__all__") or "__all__")
        selected_status_filter = str(getattr(self, "_dashboard_selected_status_filter", "__all__") or "__all__").strip().lower()
        theme_color = self._normalize_hex(str((self._company or {}).get("themeColor") or ACCENT), ACCENT)
        dark_mode = str((self._user_profile or {}).get("uiTheme") or "light").strip().lower() == "dark"
        row_text_color = "#E3EAF4" if dark_mode else "#1F2937"
        row_name_color = "#F5F8FD" if dark_mode else "#111827"
        staff_by_uid: dict[str, dict] = {}
        for person in (self._staff_all or []):
            if isinstance(person, dict):
                puid = str((person or {}).get("uid") or "").strip()
                if puid:
                    staff_by_uid[puid] = person
        rows = []
        for raw in (self._projects_all or []):
            name = str((raw or {}).get("name") or "")
            creator = str((raw or {}).get("createdByName") or (raw or {}).get("createdByUid") or "Unknown")
            creator_name_l = str((raw or {}).get("createdByName") or "").strip().lower()
            creator_uid = str((raw or {}).get("createdByUid") or "").strip()
            creator_person = staff_by_uid.get(creator_uid, {})
            creator_display = self._project_creator_display_name(raw)
            creator_avatar = str((creator_person or {}).get("avatarPath") or "").strip()
            creator_badge = self._normalize_hex(str((creator_person or {}).get("badgeColor") or "#7D99B3"), "#7D99B3")
            created = str((raw or {}).get("createdAtIso") or "")
            updated = str((raw or {}).get("updatedAtIso") or "")
            status = str((raw or {}).get("status") or "New")
            status_l = status.strip().lower()
            if selected_staff_key != "__all__":
                if selected_staff_key.startswith("uid:"):
                    if creator_uid != selected_staff_key[4:]:
                        continue
                elif selected_staff_key.startswith("name:"):
                    if creator_name_l != selected_staff_key[5:]:
                        continue
            if selected_status_filter != "__all__" and status_l != selected_status_filter:
                continue
            if term and term not in f"{name} {creator} {status}".lower():
                continue
            rows.append(
                {
                    "name": name,
                    "creator": creator_display,
                    "creatorAvatar": creator_avatar,
                    "creatorBadgeColor": creator_badge,
                    "created": created,
                    "updated": updated,
                    "status": status,
                    "raw": raw,
                }
            )

        mode = str(getattr(self, "_dashboard_sort_mode", "latest"))
        if mode == "oldest":
            rows.sort(key=lambda x: x.get("created") or "")
        elif mode == "az":
            rows.sort(key=lambda x: (x.get("name") or "").lower())
        elif mode == "za":
            rows.sort(key=lambda x: (x.get("name") or "").lower(), reverse=True)
        else:
            rows.sort(key=lambda x: x.get("created") or "", reverse=True)

        def _is_completed_status(status_text: str) -> bool:
            return str(status_text or "").strip().lower().startswith("complete")

        open_rows = [r for r in rows if not _is_completed_status(str(r.get("status") or ""))]
        completed_rows = [r for r in rows if _is_completed_status(str(r.get("status") or ""))]
        rows = open_rows + completed_rows

        while rows_layout.count():
            child = rows_layout.takeAt(0)
            widget = child.widget()
            if widget is not None:
                widget.deleteLater()

        if not rows:
            empty = QLabel("No projects yet.")
            empty.setStyleSheet("color: #8A97A8; font-size: 12px;")
            rows_layout.addWidget(empty)
            rows_layout.addStretch(1)
            return

        for row in rows:
            row_wrap = QWidget()
            wrap_layout = QVBoxLayout(row_wrap)
            wrap_layout.setContentsMargins(0, 1, 0, 0)
            wrap_layout.setSpacing(0)

            def _lift(on: bool, wl=wrap_layout) -> None:
                if on:
                    wl.setContentsMargins(0, 0, 0, 1)
                else:
                    wl.setContentsMargins(0, 1, 0, 0)

            raw_row = row.get("raw") if isinstance(row.get("raw"), dict) else None
            row_box = HoverProjectRowCard(
                theme_color=theme_color,
                dark_mode=dark_mode,
                on_hover_change=_lift,
                on_click=(lambda rr=raw_row: self._open_dashboard_project_details(rr)) if raw_row else None,
            )
            wrap_layout.addWidget(row_box)
            row_line = QHBoxLayout(row_box)
            row_line.setContentsMargins(10, 6, 10, 6)
            row_line.setSpacing(14)

            name_lbl = QLabel(str(row.get("name") or "-"))
            name_lbl.setStyleSheet(f"color: {row_name_color}; font-size: 12px; font-weight: 700;")
            row_line.addWidget(name_lbl, stretch=33)

            creator_wrap = QWidget()
            creator_layout = QHBoxLayout(creator_wrap)
            creator_layout.setContentsMargins(0, 0, 0, 0)
            creator_layout.setSpacing(6)
            creator_avatar_lbl = QLabel()
            creator_avatar_lbl.setFixedSize(20, 20)
            creator_avatar_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            c_avatar_path = str(row.get("creatorAvatar") or "").strip()
            c_pix = QPixmap(c_avatar_path) if c_avatar_path and Path(c_avatar_path).exists() else QPixmap()
            if not c_pix.isNull():
                creator_avatar_lbl.setPixmap(self._circle_avatar_pixmap(c_pix, creator_avatar_lbl.size()))
                creator_avatar_lbl.setText("")
                creator_avatar_lbl.setStyleSheet("QLabel { border: none; border-radius: 10px; background: #DDE5F0; }")
            else:
                c_badge = self._normalize_hex(str(row.get("creatorBadgeColor") or "#7D99B3"), "#7D99B3")
                creator_avatar_lbl.setPixmap(QPixmap())
                creator_avatar_lbl.setText(self._initials_from_text(str(row.get("creator") or "")))
                creator_avatar_lbl.setStyleSheet(
                    f"QLabel {{ background: {c_badge}; color: #FFFFFF; border: none; border-radius: 10px; font-size: 10px; font-weight: 700; }}"
                )
            creator_layout.addWidget(creator_avatar_lbl)
            creator_lbl = QLabel(str(row.get("creator") or "-"))
            creator_lbl.setStyleSheet(f"color: {row_text_color}; font-size: 12px;")
            creator_layout.addWidget(creator_lbl, stretch=1)
            row_line.addWidget(creator_wrap, stretch=22)

            created_lbl = QLabel(self._short_date_with_time_rich(str(row.get("created") or "")))
            created_lbl.setTextFormat(Qt.TextFormat.RichText)
            created_lbl.setStyleSheet(f"color: {row_text_color}; font-size: 12px;")
            created_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            row_line.addWidget(created_lbl, stretch=22)

            modified_lbl = QLabel(self._short_date_with_time_rich(str(row.get("updated") or "")))
            modified_lbl.setTextFormat(Qt.TextFormat.RichText)
            modified_lbl.setStyleSheet(f"color: {row_text_color}; font-size: 12px;")
            modified_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            row_line.addWidget(modified_lbl, stretch=22)

            status = str(row.get("status") or "New")
            btn = QPushButton(status)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setMinimumHeight(26)
            btn.setMinimumWidth(120)
            bg, fg, _border = self._status_pill_colors(status)
            btn.setStyleSheet(
                "QPushButton {"
                f"background: {bg}; color: {fg}; border: none; border-radius: 10px;"
                "padding: 3px 12px; font-size: 12px; font-weight: 700;"
                "}"
            )
            if raw_row:
                btn.clicked.connect(lambda _=False, rr=raw_row, bb=btn: self._open_dashboard_status_picker(rr, bb))
            row_line.addWidget(btn)

            rows_layout.addWidget(row_wrap)

        rows_layout.addStretch(1)
    def _open_dashboard_status_picker(self, raw: dict, anchor: QWidget | None = None) -> None:
        if not isinstance(raw, dict):
            return
        options = self._project_status_options()
        current_status = str(raw.get("status") or "New")

        if isinstance(anchor, QWidget):
            block_until = float(anchor.property("_statusMenuBlockUntil") or 0.0)
            if block_until > 0.0 and time.monotonic() < block_until:
                anchor.setProperty("_statusMenuBlockUntil", 0.0)
                return
            menu = QMenu(self)
            menu.setStyleSheet(
                "QMenu { background: #FFFFFF; border: 1px solid #D9DEE8; border-radius: 8px; padding: 4px; }"
                "QMenu::item { padding: 6px 12px; border-radius: 6px; color: #111827; }"
                "QMenu::item:selected { background: #E9F0F8; color: #2F5E8A; }"
            )
            menu.setMinimumWidth(max(170, anchor.width() + 26))

            selected: dict[str, str | None] = {"value": None}

            def _choose(status_value: str) -> None:
                selected["value"] = status_value
                menu.close()

            for idx, status_name in enumerate(options):
                status_text = str(status_name or "").strip()
                if not status_text:
                    continue
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
                if status_text == current_status:
                    f = option_btn.font()
                    f.setBold(True)
                    option_btn.setFont(f)
                option_btn.clicked.connect(lambda _=False, st=status_text: _choose(st))

                option_wrap = QWidget()
                option_wrap.setStyleSheet("background: transparent;")
                option_wrap_layout = QVBoxLayout(option_wrap)
                option_wrap_layout.setContentsMargins(0, 0, 0, 4 if idx < (len(options) - 1) else 0)
                option_wrap_layout.setSpacing(0)
                option_wrap_layout.addWidget(option_btn)

                action = QWidgetAction(menu)
                action.setDefaultWidget(option_wrap)
                menu.addAction(action)

            freeze_targets = [
                getattr(self, "_detail_production_config_host", None),
                getattr(self, "_detail_production_board_host", None),
                getattr(self, "_dashboard_production_config_host", None),
                getattr(self, "_dashboard_production_board_host", None),
            ]
            frozen_widgets: list[QWidget] = []
            for w in freeze_targets:
                if isinstance(w, QWidget) and w.isVisible():
                    try:
                        w.setUpdatesEnabled(False)
                        frozen_widgets.append(w)
                    except Exception:
                        pass

            self._status_picker_open = True
            try:
                menu.exec(anchor.mapToGlobal(anchor.rect().bottomLeft()))
            finally:
                self._status_picker_open = False
                for w in frozen_widgets:
                    try:
                        w.setUpdatesEnabled(True)
                        w.update()
                    except Exception:
                        pass
            chosen = str(selected.get("value") or "")
            if chosen and chosen != current_status:
                self._change_project_status(raw, chosen)
                self._apply_dashboard_projects_view()
            else:
                anchor.setProperty("_statusMenuBlockUntil", time.monotonic() + 0.22)
            self._suspend_project_settings_autosave_until = time.monotonic() + 0.5
            return

        current_index = options.index(current_status) if current_status in options else 0
        chosen, ok = QInputDialog.getItem(self, "Set Status", "Project Status", options, current_index, False)
        if ok and chosen and chosen != current_status:
            self._change_project_status(raw, str(chosen))
            self._apply_dashboard_projects_view()

    def _build_projects_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        head_row = QHBoxLayout()

        title = QLabel("Projects")
        title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 28px; font-weight: 700;")
        head_row.addWidget(title)

        head_row.addStretch(1)

        new_btn = QPushButton("New Project")
        new_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        new_btn.setFixedHeight(40)
        new_btn.clicked.connect(self._open_new_project_dialog)
        new_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 12px;"
            "font-size: 13px; font-weight: 700; padding: 0 14px;"
            "}"
            "QPushButton:hover { background: #2458D3; }"
        )
        self._projects_page_new_btn = new_btn
        head_row.addWidget(new_btn)

        refresh_btn = QPushButton("Refresh")
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.setFixedHeight(40)
        refresh_btn.clicked.connect(self._refresh_projects)
        refresh_btn.setStyleSheet(
            "QPushButton {"
            "background: #F2F2F7; color: #2C2C2E; border: none; border-radius: 12px;"
            "font-size: 13px; font-weight: 700; padding: 0 14px;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        head_row.addWidget(refresh_btn)

        layout.addLayout(head_row)

        body = QHBoxLayout()
        body.setSpacing(12)

        left_card = QFrame()
        left_card.setObjectName("ProjectsLeftCard")
        left_card.setStyleSheet(
            "QFrame {"
            "background: #FFFFFF;"
            "border: 1px solid #E4E6EC;"
            "border-radius: 16px;"
            "}"
        )
        left_layout = QVBoxLayout(left_card)
        left_layout.setContentsMargins(14, 12, 14, 12)
        left_layout.setSpacing(8)

        left_title = QLabel("All Projects")
        left_title.setStyleSheet("color: #1A1D23; font-size: 15px; font-weight: 700;")
        left_layout.addWidget(left_title)

        filters = QHBoxLayout()
        filters.setSpacing(8)

        self._projects_search = QLineEdit()
        self._projects_search.setPlaceholderText("Search by project, client, or status")
        self._projects_search.textChanged.connect(self._apply_projects_filters)
        self._projects_search.setStyleSheet(
            "QLineEdit {"
            "background: #F7F8FA; border: 1px solid #E8EAF0; border-radius: 10px; padding: 8px 10px;"
            "font-size: 13px;"
            "}"
        )
        filters.addWidget(self._projects_search, stretch=1)

        self._projects_status_filter = QComboBox()
        self._projects_status_filter.addItem("All statuses")
        self._projects_status_filter.currentTextChanged.connect(self._apply_projects_filters)
        self._projects_status_filter.setStyleSheet(
            "QComboBox {"
            "background: #F7F8FA; border: 1px solid #E8EAF0; border-radius: 10px; padding: 7px 10px;"
            "font-size: 13px; min-width: 140px;"
            "}"
        )
        filters.addWidget(self._projects_status_filter)

        left_layout.addLayout(filters)

        table = QTableWidget()
        table.setObjectName("ProjectsTable")
        table.setColumnCount(5)
        table.setHorizontalHeaderLabels(["Project", "Client", "Status", "Created", "Updated"])
        table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.verticalHeader().setVisible(False)
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
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
        table.itemDoubleClicked.connect(self._open_project_details)
        table.itemSelectionChanged.connect(self._on_project_selection_changed)

        self._projects_table = table
        left_layout.addWidget(table, stretch=1)

        body.addWidget(left_card, stretch=2)
        body.addWidget(self._build_project_detail_card(), stretch=3)

        layout.addLayout(body, stretch=1)

        self._refresh_projects_status_options()
        self._apply_projects_filters()

        return page
    def _open_new_project_dialog(self) -> None:
        if not bool(self._has_company_permission("projects.create")):
            QMessageBox.warning(self, "New Project", "Your role does not have permission to create projects.")
            return
        company_id = getattr(self.router.session, "company_id", None)
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        can_create_for_others = bool(self._has_company_permission("projects.create.others"))

        dialog = NewProjectDialog(
            self,
            show_create_under=can_create_for_others,
            current_user_uid=uid,
        )
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return

        company_id = getattr(self.router.session, "company_id", None)
        uid = getattr(self.router.session, "uid", None)
        email = str(getattr(self.router.session, "email", "") or "")
        if not company_id or not uid:
            QMessageBox.critical(self, "Create failed", "Missing session context.")
            return

        name = dialog.name.text().strip()
        client = dialog.client.text().strip()
        notes = dialog.notes.toPlainText().strip()
        client_phone = dialog.client_phone.text().strip()
        client_email = dialog.client_email.text().strip()
        project_address = dialog.project_address.text().strip()
        region_reader = getattr(dialog, "selected_region", None)
        if callable(region_reader):
            region = str(region_reader() or "").strip()
        else:
            region_widget = getattr(dialog, "region", None)
            if isinstance(region_widget, QComboBox):
                region = str(region_widget.currentText() or "").strip()
            else:
                region = str(region_widget.text() or "").strip() if region_widget is not None else ""
        staff_uid_reader = getattr(dialog, "selected_staff_member_uid", None)
        selected_staff_uid = str(staff_uid_reader() or "").strip() if callable(staff_uid_reader) else ""
        if not selected_staff_uid:
            selected_staff_uid = uid
        selected_creator_name = email.split("@")[0] if email else str(uid or "")
        for row in (self._staff_all or []):
            if str((row or {}).get("uid") or "").strip() == selected_staff_uid:
                selected_creator_name = str((row or {}).get("displayName") or (row or {}).get("name") or (row or {}).get("email") or selected_staff_uid).strip()
                break
        image_paths = dialog.image_paths()

        created_job_id = ""
        try:
            created_job_id = str(
                self.app.company.add_job(
                company_id,
                name,
                client,
                notes,
                created_by_uid=selected_staff_uid,
                created_by_name=selected_creator_name,
                client_phone=client_phone,
                client_email=client_email,
                project_address=project_address,
                region=region,
                staff_member_uid=selected_staff_uid,
                image_paths=image_paths,
                )
                or ""
            ).strip()
        except TypeError:
            created_job_id = str(self.app.company.add_job(company_id, name, client, notes, image_paths=image_paths) or "").strip()
        except Exception as exc:
            QMessageBox.critical(self, "Create failed", str(exc))
            return

        self._refresh_projects()
        try:
            created_raw = None
            for row in (self._projects_all or []):
                if isinstance(row, dict) and str(row.get("id") or "").strip() == created_job_id:
                    created_raw = row
                    break

            project_settings_payload = self._load_project_settings_payload(created_raw)
            perms_raw = project_settings_payload.get("projectPermissions")
            perms = dict(perms_raw) if isinstance(perms_raw, dict) else {}
            staff_access = self._project_permissions_staff_access(project_settings_payload)
            if selected_staff_uid:
                staff_access[str(selected_staff_uid)] = "edit"
            if str(uid or "").strip():
                staff_access[str(uid).strip()] = "edit"
            perms["staffAccess"] = staff_access
            project_settings_payload["projectPermissions"] = perms

            default_quote_extras = []
            seen_extra_keys: set[str] = set()
            for extra in (self._company_quote_extras_rows() if hasattr(self, "_company_quote_extras_rows") else []):
                if not isinstance(extra, dict):
                    continue
                if not bool(extra.get("defaultIncluded")):
                    continue
                nm = str(extra.get("name") or "").strip()
                nm_key = " ".join(nm.lower().split())
                if nm and nm_key and nm_key not in seen_extra_keys:
                    seen_extra_keys.add(nm_key)
                    default_quote_extras.append(nm)
            if created_job_id:
                patch_payload = {
                    "projectSettings": project_settings_payload,
                    "projectSettingsJson": json.dumps(project_settings_payload),
                }
                if default_quote_extras:
                    sales_payload = {"quoteExtrasIncluded": list(default_quote_extras)}
                    patch_payload["sales"] = sales_payload
                    patch_payload["salesJson"] = json.dumps(sales_payload)
                self.app.company.update_job(company_id, created_job_id, patch_payload)
                for row in (self._projects_all or []):
                    if not isinstance(row, dict) or str(row.get("id") or "").strip() != created_job_id:
                        continue
                    row["projectSettings"] = dict(project_settings_payload)
                    row["projectSettingsJson"] = json.dumps(project_settings_payload)
                    if default_quote_extras:
                        row["sales"] = dict(sales_payload)
                        row["salesJson"] = json.dumps(sales_payload)
                    break
        except Exception:
            pass
        QMessageBox.information(self, "Project created", "Project added successfully.")

    def _build_project_detail_card(self) -> QWidget:
        card = QWidget()
        layout = QVBoxLayout(card)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(14)

        header_card = QFrame()
        header_card.setObjectName("ProjectsDetailHeaderCard")
        header_card.setStyleSheet("QFrame#ProjectsDetailHeaderCard { background: #FFFFFF; border: 1px solid #D9DEE7; border-radius: 14px; }")
        header_layout = QVBoxLayout(header_card)
        header_layout.setContentsMargins(14, 14, 14, 14)
        header_layout.setSpacing(6)
        layout.addWidget(header_card)

        body_card = QFrame()
        body_card.setObjectName("ProjectsDetailBodyCard")
        body_card.setStyleSheet("QFrame#ProjectsDetailBodyCard { background: #FFFFFF; border: none; border-radius: 14px; }")
        body_layout = QVBoxLayout(body_card)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(0)
        layout.addWidget(body_card, 1)

        self._project_title_label = QLabel("Select a project")
        self._project_title_label.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 20px; font-weight: 700;")
        header_layout.addWidget(self._project_title_label)

        self._project_meta_label = QLabel("Choose a row on the left to view details.")
        self._project_meta_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 12px;")
        self._project_meta_label.setWordWrap(True)
        header_layout.addWidget(self._project_meta_label)

        status_row = QHBoxLayout()
        status_row.addWidget(QLabel("Status"))
        status_row.addStretch(1)
        self._project_delete_btn = QPushButton("Delete")
        self._project_delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._project_delete_btn.clicked.connect(lambda _=False: self._delete_selected_project(confirm=True, from_dashboard=False))
        self._project_delete_btn.setStyleSheet(
            "QPushButton {"
            "background: #FDECEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 10px;"
            "padding: 4px 12px; font-size: 12px; font-weight: 700;"
            "}"
            "QPushButton:hover { background: #FADCE0; }"
        )
        status_row.addWidget(self._project_delete_btn)
        self._project_status_btn = QPushButton("-")
        self._project_status_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._project_status_btn.clicked.connect(self._edit_selected_project_status)
        self._project_status_btn.setStyleSheet(
            "QPushButton {"
            "background: #E8F0FF; color: #3060D0; border: none; border-radius: 10px;"
            "padding: 6px 10px; font-size: 12px; font-weight: 700;"
            "}"
        )
        status_row.addWidget(self._project_status_btn)
        header_layout.addLayout(status_row)

        def _action_btn(text: str, primary: bool = False) -> QPushButton:
            btn = QPushButton(text)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setMinimumHeight(40)
            if primary:
                btn.setStyleSheet(
                    "QPushButton {"
                    f"background: {ACCENT}; color: white; border: none; border-radius: 12px;"
                    "padding: 8px 10px; font-size: 12px; font-weight: 700;"
                    "}"
                    "QPushButton:hover { background: #2458D3; }"
                )
            else:
                btn.setStyleSheet(
                    "QPushButton {"
                    "background: #F7F8FC; color: #374151; border: 1px solid #E4E6EC; border-radius: 12px;"
                    "padding: 8px 10px; font-size: 12px; font-weight: 700;"
                    "}"
                    "QPushButton:hover { background: #EEF0F8; }"
                )
            return btn

        tabs_host = QWidget()
        tabs_lay = QHBoxLayout(tabs_host)
        tabs_lay.setContentsMargins(0, 0, 0, 0)
        tabs_lay.setSpacing(0)
        self._project_detail_tab_buttons = {}
        for key, label_text in [
            ("general", "General"),
            ("sales", "Sales"),
            ("production", "Production"),
            ("settings", "Settings"),
        ]:
            tbtn = QPushButton(label_text)
            tbtn.setCursor(Qt.CursorShape.PointingHandCursor)
            tbtn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            tbtn.setMinimumHeight(40)
            tbtn.setProperty("baseTabLabel", label_text)
            tbtn.clicked.connect(lambda _=False, k=key: self._set_project_detail_tab(k))
            tabs_lay.addWidget(tbtn, 1)
            self._project_detail_tab_buttons[key] = tbtn
        body_layout.addWidget(tabs_host, 0)

        self._project_detail_stack = QStackedWidget()
        self._project_detail_stack.setStyleSheet("QStackedWidget { background: transparent; border: none; }")
        content_host = QFrame()
        content_host.setObjectName("ProjectsDetailContentHost")
        content_host.setStyleSheet(
            "QFrame#ProjectsDetailContentHost {"
            "background: transparent;"
            "border-left: 1px solid #D9DEE7;"
            "border-right: 1px solid #D9DEE7;"
            "border-bottom: 1px solid #D9DEE7;"
            "border-top: none;"
            "border-bottom-left-radius: 14px;"
            "border-bottom-right-radius: 14px;"
            "}"
        )
        content_layout = QVBoxLayout(content_host)
        content_layout.setContentsMargins(14, 12, 14, 12)
        content_layout.setSpacing(8)
        content_layout.addWidget(self._project_detail_stack, 1)
        body_layout.addWidget(content_host, 1)

        general_page = QWidget()
        general_lay = QGridLayout(general_page)
        general_lay.setContentsMargins(0, 0, 0, 0)
        general_lay.setHorizontalSpacing(10)
        general_lay.setVerticalSpacing(8)
        self._detail_open_images_btn = _action_btn("Images")
        self._detail_open_images_btn.clicked.connect(lambda _=False: self._show_general_images_panel(False))
        self._detail_open_notes_btn = _action_btn("Notes")
        self._detail_open_notes_btn.clicked.connect(self._open_selected_project_notes)
        general_lay.setColumnStretch(0, 1)
        general_lay.setColumnStretch(1, 1)
        general_details_host = QWidget()
        general_details_layout = QVBoxLayout(general_details_host)
        general_details_layout.setContentsMargins(0, 0, 0, 0)
        general_details_layout.setSpacing(8)
        general_lay.addWidget(general_details_host, 0, 0, 1, 2)
        self._project_detail_stack.addWidget(general_page)

        sales_page = QWidget()
        sales_lay = QHBoxLayout(sales_page)
        sales_lay.setContentsMargins(0, 0, 0, 0)
        sales_lay.setSpacing(12)
        sales_theme = self._normalize_hex(str((self._company or {}).get("themeColor") or ACCENT), ACCENT)
        sales_theme_soft = QColor(sales_theme).lighter(186).name()
        sales_theme_soft_border = QColor(sales_theme).lighter(168).name()
        self._detail_open_initial_measure_btn = _action_btn("Initial Measure")
        self._detail_open_initial_measure_btn.clicked.connect(lambda _=False: self._open_initial_measure_cutlist())
        self._detail_open_items_btn = _action_btn("Items")
        self._detail_open_items_btn.clicked.connect(lambda _=False: self._open_sales_items_window())
        self._detail_open_quote_btn = _action_btn("Quote")
        self._detail_open_quote_btn.clicked.connect(lambda _=False: self._open_sales_placeholder("Quote"))
        self._detail_open_specs_btn = _action_btn("Specifications")
        self._detail_open_specs_btn.clicked.connect(lambda _=False: self._open_sales_placeholder("Specifications"))
        sales_nav_host = QWidget()
        sales_nav_host.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        sales_nav_host.setStyleSheet("QWidget { border-right: 1px solid #E3E8F0; }")
        sales_left = QVBoxLayout(sales_nav_host)
        sales_left.setContentsMargins(0, 0, 12, 0)
        sales_left.setSpacing(10)
        sales_left.addWidget(self._detail_open_initial_measure_btn)
        sales_left.addWidget(self._detail_open_items_btn)
        sales_left.addWidget(self._detail_open_quote_btn)
        sales_left.addWidget(self._detail_open_specs_btn)
        sales_left.addStretch(1)
        sales_lay.addWidget(sales_nav_host, 0)
        sales_right = QHBoxLayout()
        sales_right.setContentsMargins(0, 6, 0, 0)
        sales_right.setSpacing(12)

        sales_rooms_card = QFrame()
        sales_rooms_card.setObjectName("salesRoomsCardDetail")
        sales_rooms_card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        sales_rooms_card.setMinimumWidth(460)
        sales_rooms_card.setMaximumWidth(460)
        sales_rooms_card.setStyleSheet("QFrame#salesRoomsCardDetail { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        sales_rooms_lay = QVBoxLayout(sales_rooms_card)
        sales_rooms_lay.setContentsMargins(0, 0, 0, 0)
        sales_rooms_lay.setSpacing(0)
        sales_rooms_top_bar = QFrame()
        sales_rooms_top_bar.setObjectName("salesRoomsTopBarDetail")
        sales_rooms_top_bar.setFixedHeight(50)
        sales_rooms_top_bar.setStyleSheet(
            "QFrame#salesRoomsTopBarDetail { "
            "background:#FFFFFF; "
            "border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        sales_rooms_top = QHBoxLayout(sales_rooms_top_bar)
        sales_rooms_top.setContentsMargins(14, 15, 14, 11)
        sales_rooms_top.setSpacing(6)
        sales_rooms_title = QLabel("ROOMS")
        sales_rooms_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        sales_rooms_top.addWidget(sales_rooms_title, 1)
        top_add_room_btn = AnimatedOutlineButton("+ Add Room")
        top_add_room_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        top_add_room_btn.setMaximumHeight(24)
        top_add_room_btn.setStyleSheet(
            "QPushButton { "
            "background: #FFFFFF; color: #2D8F8B; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #FFFFFF; color:#247A76; }"
        )
        top_add_room_btn.clicked.connect(lambda _=False: self._add_sales_room_row(False))
        self._detail_sales_rooms_add_top_btn = top_add_room_btn
        sales_rooms_top.addWidget(top_add_room_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        sales_rooms_lay.addWidget(sales_rooms_top_bar)
        sales_rooms_top_divider = QFrame()
        sales_rooms_top_divider.setObjectName("salesRoomsTopDividerDetail")
        sales_rooms_top_divider.setFixedHeight(1)
        sales_rooms_top_divider.setStyleSheet("QFrame#salesRoomsTopDividerDetail { background:#D7DEE8; border:none; }")
        sales_rooms_lay.addWidget(sales_rooms_top_divider)
        sales_rooms_content = QWidget()
        sales_rooms_content_lay = QVBoxLayout(sales_rooms_content)
        sales_rooms_content_lay.setContentsMargins(14, 10, 14, 12)
        sales_rooms_content_lay.setSpacing(8)
        sales_rooms_head = QHBoxLayout()
        sales_rooms_head.setContentsMargins(0, 0, 0, 0)
        sales_rooms_head.setSpacing(6)
        head_action = QLabel("")
        head_action.setFixedWidth(24)
        head_action.setStyleSheet("QLabel { background: transparent; border: none; }")
        head_name = QLabel("Room")
        head_name.setStyleSheet("QLabel { color:#8A97A8; font-size:12px; font-weight:800; letter-spacing:0.5px; background:transparent; border:none; }")
        head_total = QLabel("Price")
        head_total.setStyleSheet("QLabel { color:#8A97A8; font-size:12px; font-weight:800; letter-spacing:0.5px; background:transparent; border:none; }")
        head_total.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        head_inc = QLabel("Included")
        head_inc.setStyleSheet("QLabel { color:#8A97A8; font-size:12px; font-weight:800; letter-spacing:0.5px; background:transparent; border:none; }")
        head_inc.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sales_rooms_head.addWidget(head_action, 0)
        sales_rooms_head.addWidget(head_name, 2)
        sales_rooms_head.addWidget(head_total, 1)
        sales_rooms_head.addWidget(head_inc, 1, Qt.AlignmentFlag.AlignCenter)
        sales_rooms_content_lay.addLayout(sales_rooms_head)
        sales_rooms_head_divider = QFrame()
        sales_rooms_head_divider.setObjectName("salesRoomsHeadDividerDetail")
        sales_rooms_head_divider.setFixedHeight(1)
        sales_rooms_head_divider.setStyleSheet("QFrame#salesRoomsHeadDividerDetail { background:#D7DEE8; border:none; }")
        sales_rooms_content_lay.addWidget(sales_rooms_head_divider)
        rooms_list_host = QWidget()
        rooms_list_lay = QVBoxLayout(rooms_list_host)
        rooms_list_lay.setContentsMargins(0, 0, 0, 0)
        rooms_list_lay.setSpacing(0)
        self._detail_sales_rooms_list_layout = rooms_list_lay
        sales_rooms_content_lay.addWidget(rooms_list_host, 1)
        sales_rooms_footer = QHBoxLayout()
        sales_rooms_footer.setContentsMargins(0, 4, 0, 0)
        sales_rooms_footer.setSpacing(8)
        total_lbl = QLabel("Total")
        total_lbl.setStyleSheet("QLabel { color:#0F2A4A; font-size:30px; font-weight:700; background:transparent; border:none; }")
        self._detail_sales_rooms_total_label = total_lbl
        add_room_btn = AnimatedOutlineButton("+ Add Room")
        add_room_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_room_btn.setStyleSheet(
            "QPushButton { "
            "background: #FFFFFF; color: #2D8F8B; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            "QPushButton:hover { background: #FFFFFF; color:#247A76; }"
        )
        add_room_btn.clicked.connect(lambda _=False: self._add_sales_room_row(False))
        self._detail_sales_rooms_add_btn = add_room_btn
        sales_rooms_footer.addWidget(add_room_btn, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        sales_rooms_footer.addWidget(total_lbl, 1, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        sales_rooms_content_lay.addLayout(sales_rooms_footer)
        sales_rooms_lay.addWidget(sales_rooms_content, 1)
        sales_right.addWidget(sales_rooms_card, 0)

        product_type_card = QFrame()
        product_type_card.setObjectName("salesProductTypeCardDetail")
        product_type_card.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Maximum)
        product_type_card.setStyleSheet("QFrame#salesProductTypeCardDetail { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        product_type_lay = QVBoxLayout(product_type_card)
        product_type_lay.setContentsMargins(0, 0, 0, 0)
        product_type_lay.setSpacing(0)
        product_type_top_bar = QFrame()
        product_type_top_bar.setObjectName("salesProductTypeTopBarDetail")
        product_type_top_bar.setFixedHeight(50)
        product_type_top_bar.setStyleSheet(
            "QFrame#salesProductTypeTopBarDetail { "
            "background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        product_type_top_lay = QHBoxLayout(product_type_top_bar)
        product_type_top_lay.setContentsMargins(14, 15, 14, 11)
        product_type_top_lay.setSpacing(6)
        product_type_title = QLabel("PRODUCT TYPE")
        product_type_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        product_type_top_lay.addWidget(product_type_title, 1)
        product_type_lay.addWidget(product_type_top_bar)
        product_type_top_divider = QFrame()
        product_type_top_divider.setObjectName("salesProductTypeTopDividerDetail")
        product_type_top_divider.setFixedHeight(1)
        product_type_top_divider.setStyleSheet("QFrame#salesProductTypeTopDividerDetail { background:#D7DEE8; border:none; }")
        product_type_lay.addWidget(product_type_top_divider)
        product_type_content = QWidget()
        product_type_content_lay = QVBoxLayout(product_type_content)
        product_type_content_lay.setContentsMargins(14, 10, 14, 12)
        product_type_content_lay.setSpacing(6)
        self._detail_sales_job_type_layout = product_type_content_lay
        self._detail_sales_job_type_checks = {}
        product_type_content_lay.addStretch(1)
        product_type_lay.addWidget(product_type_content, 1)

        quote_extras_card = QFrame()
        quote_extras_card.setObjectName("salesQuoteExtrasCardDetail")
        quote_extras_card.setSizePolicy(QSizePolicy.Policy.Maximum, QSizePolicy.Policy.Maximum)
        quote_extras_card.setStyleSheet("QFrame#salesQuoteExtrasCardDetail { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        quote_extras_card_lay = QVBoxLayout(quote_extras_card)
        quote_extras_card_lay.setContentsMargins(0, 0, 0, 0)
        quote_extras_card_lay.setSpacing(0)
        quote_extras_top_bar = QFrame()
        quote_extras_top_bar.setObjectName("salesQuoteExtrasTopBarDetail")
        quote_extras_top_bar.setFixedHeight(50)
        quote_extras_top_bar.setStyleSheet(
            "QFrame#salesQuoteExtrasTopBarDetail { "
            "background:#FFFFFF; border:none; "
            "border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        quote_extras_top_lay = QHBoxLayout(quote_extras_top_bar)
        quote_extras_top_lay.setContentsMargins(14, 15, 14, 11)
        quote_extras_top_lay.setSpacing(6)
        quote_extras_title = QLabel("QUOTE EXTRAS")
        quote_extras_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        quote_extras_top_lay.addWidget(quote_extras_title, 1)
        quote_extras_card_lay.addWidget(quote_extras_top_bar)
        quote_extras_top_divider = QFrame()
        quote_extras_top_divider.setObjectName("salesQuoteExtrasTopDividerDetail")
        quote_extras_top_divider.setFixedHeight(1)
        quote_extras_top_divider.setStyleSheet("QFrame#salesQuoteExtrasTopDividerDetail { background:#D7DEE8; border:none; }")
        quote_extras_card_lay.addWidget(quote_extras_top_divider)
        quote_extras_content = QWidget()
        quote_extras_content_lay = QVBoxLayout(quote_extras_content)
        quote_extras_content_lay.setContentsMargins(14, 10, 14, 12)
        quote_extras_content_lay.setSpacing(6)
        quote_extras_list_host = QWidget()
        quote_extras_list_lay = QVBoxLayout(quote_extras_list_host)
        quote_extras_list_lay.setContentsMargins(0, 0, 0, 0)
        quote_extras_list_lay.setSpacing(5)
        self._detail_sales_quote_extras_list_layout = quote_extras_list_lay
        quote_extras_content_lay.addWidget(quote_extras_list_host, 0)
        quote_extras_content_lay.addStretch(1)
        quote_extras_card_lay.addWidget(quote_extras_content, 1)

        sales_right.addWidget(product_type_card, 0)
        sales_right.addWidget(quote_extras_card, 0)
        sales_right.addStretch(1)
        sales_right.setAlignment(sales_rooms_card, Qt.AlignmentFlag.AlignTop)
        sales_right.setAlignment(product_type_card, Qt.AlignmentFlag.AlignTop)
        sales_right.setAlignment(quote_extras_card, Qt.AlignmentFlag.AlignTop)
        sales_lay.addLayout(sales_right, 1)
        sales_lay.setAlignment(sales_right, Qt.AlignmentFlag.AlignTop)
        self._refresh_sales_nav_buttons()
        self._project_detail_stack.addWidget(sales_page)

        production_page = QWidget()
        production_page_lay = QVBoxLayout(production_page)
        production_page_lay.setContentsMargins(0, 0, 0, 0)
        production_page_lay.setSpacing(0)
        production_outer_scroll = QScrollArea()
        production_outer_scroll.setWidgetResizable(True)
        production_outer_scroll.setFrameShape(QFrame.Shape.NoFrame)
        production_outer_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        production_outer_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        production_outer_scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        production_content = QWidget()
        production_content.setStyleSheet("QWidget { background: transparent; border: none; }")
        production_lay = QHBoxLayout(production_content)
        production_lay.setContentsMargins(0, 0, 0, 0)
        production_lay.setSpacing(10)
        self._detail_open_cutlist_btn = _action_btn("Cutlist", primary=True)
        self._detail_open_cutlist_btn.clicked.connect(self._open_cutlist_editor)
        self._detail_open_nesting_btn = _action_btn("Nesting")
        self._detail_open_nesting_btn.clicked.connect(self._open_nesting_layout)
        self._detail_open_cnc_btn = _action_btn("CNC Cutlist")
        self._detail_open_cnc_btn.clicked.connect(self._open_cnc_cutlist_placeholder)
        self._detail_open_order_btn = _action_btn("Order")
        self._detail_open_order_btn.clicked.connect(self._open_order_placeholder)
        self._detail_open_unlock_pill_btn = _action_btn("Unlock")
        self._detail_open_unlock_pill_btn.clicked.connect(self._open_production_unlock_prompt_for_selected_project)
        self._detail_open_unlock_pill_btn.setStyleSheet(
            "QPushButton { background:#EEF6FF; color:#1E4E8C; border:1px solid #D7E6FA; border-radius:999px; padding:6px 12px; font-size:12px; font-weight:800; }"
            "QPushButton:hover { background:#E3F0FF; border-color:#C9DDF8; }"
        )
        self._detail_open_unlock_production_btn = _action_btn("Unlock Production")
        self._detail_open_unlock_production_btn.clicked.connect(self._open_unlock_production_dialog)
        self._detail_open_cabinet_specs_btn = None
        self._detail_open_board_settings_btn = None
        production_nav_host = QWidget()
        production_nav_host.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Expanding)
        production_nav_host.setStyleSheet("QWidget { border-right: 1px solid #E3E8F0; }")
        production_left_lay = QVBoxLayout(production_nav_host)
        production_left_lay.setContentsMargins(0, 0, 12, 0)
        production_left_lay.setSpacing(10)
        production_left_lay.addWidget(self._detail_open_cutlist_btn)
        production_left_lay.addWidget(self._detail_open_nesting_btn)
        production_left_lay.addWidget(self._detail_open_cnc_btn)
        production_left_lay.addWidget(self._detail_open_order_btn)
        production_left_lay.addWidget(self._detail_open_unlock_pill_btn)
        production_left_lay.addWidget(self._detail_open_unlock_production_btn)
        production_left_lay.addStretch(1)
        production_lay.addWidget(production_nav_host, 0)
        production_right_scroll = QScrollArea()
        production_right_scroll.setWidgetResizable(True)
        production_right_scroll.setFrameShape(QFrame.Shape.NoFrame)
        production_right_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        production_right_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        production_right_scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        production_right_host = QFrame()
        production_right_host.setStyleSheet("QFrame { background:transparent; border:none; }")
        production_right_lay = QVBoxLayout(production_right_host)
        production_right_lay.setContentsMargins(0, 6, 0, 0)
        production_right_lay.setSpacing(8)
        self._detail_production_config_host = QWidget()
        self._detail_production_config_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        self._detail_production_board_host = QWidget()
        self._detail_production_board_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        production_right_lay.addWidget(self._detail_production_config_host, 0)
        production_right_lay.addWidget(self._detail_production_board_host, 0)
        production_right_lay.addStretch(1)
        production_right_scroll.setWidget(production_right_host)
        production_lay.addWidget(production_right_scroll, 1)
        production_outer_scroll.setWidget(production_content)
        production_page_lay.addWidget(production_outer_scroll, 1)
        self._set_production_panel_mode(False, "cabinet_specs")
        self._project_detail_stack.addWidget(production_page)

        settings_page = QWidget()
        settings_layout = QVBoxLayout(settings_page)
        settings_layout.setContentsMargins(0, 0, 0, 0)
        settings_layout.setSpacing(8)
        permissions_card = QFrame()
        permissions_card.setStyleSheet("QFrame { background: #FBFCFE; border: 1px solid #E4E6EC; border-radius: 12px; }")
        permissions_card_lay = QVBoxLayout(permissions_card)
        permissions_card_lay.setContentsMargins(10, 10, 10, 10)
        permissions_card_lay.setSpacing(8)
        permissions_title_row = QHBoxLayout()
        permissions_title_row.setContentsMargins(0, 0, 0, 0)
        permissions_title_row.setSpacing(8)
        permissions_title = QLabel("Project Permissions")
        permissions_title.setStyleSheet("color: #1A1D23; font-size: 13px; font-weight: 700;")
        permissions_title_row.addWidget(permissions_title)
        permissions_title_row.addStretch(1)
        change_owner_btn = QPushButton("Change Ownership")
        change_owner_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        change_owner_btn.setFixedHeight(28)
        change_owner_btn.setStyleSheet(
            "QPushButton { background:#EEF6FF; color:#1E4E8C; border:1px solid #D7E6FA; border-radius:8px; padding: 0 10px; font-size: 11px; font-weight: 700; }"
            "QPushButton:hover { background:#E6F1FF; }"
        )
        change_owner_btn.clicked.connect(self._open_change_project_ownership_dialog)
        self._detail_change_ownership_btn = change_owner_btn
        permissions_title_row.addWidget(change_owner_btn, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        permissions_card_lay.addLayout(permissions_title_row)
        self._detail_permissions_list_layout = QVBoxLayout()
        self._detail_permissions_list_layout.setContentsMargins(0, 0, 0, 0)
        self._detail_permissions_list_layout.setSpacing(6)
        permissions_card_lay.addLayout(self._detail_permissions_list_layout)
        self._detail_open_permissions_btn = None
        settings_layout.addWidget(permissions_card)
        settings_layout.addStretch(1)

        details_cols = QHBoxLayout()
        details_cols.setContentsMargins(0, 0, 0, 0)
        details_cols.setSpacing(12)
        general_details_layout.addLayout(details_cols)
        details_cols.setStretch(0, 0)
        details_cols.setStretch(1, 1)
        details_cols.setStretch(2, 3)

        details_actions = QWidget()
        details_actions.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)
        _nav_w = int(self._stacked_nav_shared_width() + 12) if hasattr(self, "_stacked_nav_shared_width") else 260
        details_actions.setFixedWidth(_nav_w)
        details_actions.setStyleSheet("QWidget { border-right: 1px solid #E3E8F0; }")
        details_actions_layout = QVBoxLayout(details_actions)
        details_actions_layout.setContentsMargins(0, 0, 12, 0)
        details_actions_layout.setSpacing(10)
        details_actions_layout.addWidget(self._detail_open_images_btn)
        details_actions_layout.addWidget(self._detail_open_notes_btn)
        details_actions_layout.addStretch(1)
        details_cols.addWidget(details_actions, 0)

        left_details = QFrame()
        left_details.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        left_details.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        left_details.setMinimumWidth(340)
        left_details_wrap = QVBoxLayout(left_details)
        left_details_wrap.setContentsMargins(0, 0, 0, 0)
        left_details_wrap.setSpacing(0)
        left_details_head = QFrame()
        left_details_head.setFixedHeight(50)
        left_details_head.setStyleSheet(
            "QFrame { background:#FFFFFF; border:none; border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        left_details_head_l = QHBoxLayout(left_details_head)
        left_details_head_l.setContentsMargins(14, 15, 14, 11)
        left_details_head_l.setSpacing(6)
        left_client_title = QLabel("CLIENT DETAILS")
        left_client_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        left_details_head_l.addWidget(left_client_title, 1, Qt.AlignmentFlag.AlignVCenter)
        left_details_wrap.addWidget(left_details_head)
        left_details_div = QFrame()
        left_details_div.setFixedHeight(1)
        left_details_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        left_details_wrap.addWidget(left_details_div)
        left_details_body = QWidget()
        left_details_layout = QVBoxLayout(left_details_body)
        left_details_layout.setContentsMargins(12, 10, 12, 12)
        left_details_layout.setSpacing(8)
        left_details_wrap.addWidget(left_details_body, 1)
        left_details_slot = QWidget()
        left_details_slot.setStyleSheet("QWidget { background: transparent; border: none; }")
        left_details_slot_l = QVBoxLayout(left_details_slot)
        left_details_slot_l.setContentsMargins(0, 6, 0, 0)
        left_details_slot_l.setSpacing(0)
        left_details_slot_l.addWidget(left_details, 1)
        details_cols.addWidget(left_details_slot, 1)

        right_notes = QFrame()
        right_notes.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #D7DEE8; border-radius:14px; }")
        right_notes.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        right_notes.setMinimumWidth(0)
        right_notes_wrap = QVBoxLayout(right_notes)
        right_notes_wrap.setContentsMargins(0, 0, 0, 0)
        right_notes_wrap.setSpacing(0)
        right_notes_head = QFrame()
        right_notes_head.setFixedHeight(50)
        right_notes_head.setStyleSheet(
            "QFrame { background:#FFFFFF; border:none; border-top-left-radius:14px; border-top-right-radius:14px; border-bottom-left-radius:0px; border-bottom-right-radius:0px; }"
        )
        right_notes_head_l = QHBoxLayout(right_notes_head)
        right_notes_head_l.setContentsMargins(14, 15, 14, 11)
        right_notes_head_l.setSpacing(6)
        notes_title = QLabel("NOTES")
        notes_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        self._detail_general_side_title = notes_title
        right_notes_head_l.addWidget(notes_title, 0, Qt.AlignmentFlag.AlignVCenter)
        right_notes_head_l.addStretch(1)
        upload_btn = QPushButton("Upload")
        upload_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        upload_btn.setMinimumHeight(30)
        upload_btn.setFixedWidth(112)
        upload_btn.setStyleSheet(
            "QPushButton { background: #2F6BFF; color: white; border: none; border-radius: 9px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { background: #2458D3; }"
            "QPushButton:disabled { background: #D5DAE3; color: #94A0B2; }"
        )
        upload_btn.clicked.connect(lambda _=False: self._upload_project_images_for_general(False))
        upload_btn.setVisible(False)
        self._detail_images_upload_btn = upload_btn
        delete_btn = QPushButton("Delete")
        delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        delete_btn.setMinimumHeight(26)
        delete_btn.setFixedWidth(84)
        delete_btn.setStyleSheet(
            "QPushButton { background: #FCEBEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 8px; padding: 0 8px; font-size: 11px; font-weight: 700; }"
            "QPushButton:hover { background: #FADCE0; }"
            "QPushButton:disabled { background: #F5F5F6; color: #A5A8B0; border-color: #E6E8EE; }"
        )
        delete_btn.clicked.connect(lambda _=False: self._delete_current_project_image_for_general(False))
        delete_btn.setVisible(False)
        self._detail_images_delete_btn = delete_btn
        right_notes_head_l.addWidget(upload_btn, 0, Qt.AlignmentFlag.AlignVCenter)
        right_notes_head_l.addWidget(delete_btn, 0, Qt.AlignmentFlag.AlignVCenter)
        right_notes_wrap.addWidget(right_notes_head)
        right_notes_div = QFrame()
        right_notes_div.setFixedHeight(1)
        right_notes_div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
        right_notes_wrap.addWidget(right_notes_div)
        right_notes_body = QWidget()
        right_notes_layout = QVBoxLayout(right_notes_body)
        right_notes_layout.setContentsMargins(12, 10, 12, 12)
        right_notes_layout.setSpacing(8)
        right_notes_wrap.addWidget(right_notes_body, 1)
        right_notes_slot = QWidget()
        right_notes_slot.setStyleSheet("QWidget { background: transparent; border: none; }")
        right_notes_slot_l = QVBoxLayout(right_notes_slot)
        right_notes_slot_l.setContentsMargins(0, 6, 0, 0)
        right_notes_slot_l.setSpacing(0)
        right_notes_slot_l.addWidget(right_notes, 1)
        details_cols.addWidget(right_notes_slot, 1)
        details_cols.setStretchFactor(left_details_slot, 1)
        details_cols.setStretchFactor(right_notes_slot, 3)
        self._refresh_general_nav_buttons()

        self._detail_client_name = QLineEdit()
        self._detail_client_phone = QLineEdit()
        self._detail_client_email = QLineEdit()
        self._detail_client_region = None
        self._detail_client_address = QLineEdit()
        for entry, placeholder in [
            (self._detail_client_name, "Client name"),
            (self._detail_client_phone, "Client phone"),
            (self._detail_client_email, "Client email"),
            (self._detail_client_address, "Client address, Region"),
        ]:
            entry.setPlaceholderText(placeholder)
            entry.setFrame(False)
            entry.setMinimumWidth(0)
            entry.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            entry.setStyleSheet(
                "QLineEdit {"
                "background: transparent; border: none; padding: 2px 0px;"
                "font-size: 12px;"
                "}"
            )

        details_grid = QVBoxLayout()
        details_grid.setContentsMargins(0, 0, 0, 0)
        details_grid.setSpacing(4)
        details_rows = [
            ("Name", self._detail_client_name),
            ("Phone", self._detail_client_phone),
            ("Email", self._detail_client_email),
            ("Address", self._detail_client_address),
        ]
        for row_idx, (label_text, widget) in enumerate(details_rows):
            row = QHBoxLayout()
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(10)
            lbl = QLabel(label_text)
            lbl.setStyleSheet("color: #374151; font-size: 12px; font-weight: 700;")
            lbl.setFixedWidth(64)
            row.addWidget(lbl, 0)
            row.addWidget(widget, 1)
            details_grid.addLayout(row)
            if row_idx < len(details_rows) - 1:
                div = QFrame()
                div.setFixedHeight(1)
                div.setStyleSheet("QFrame { background:#D7DEE8; border:none; }")
                details_grid.addWidget(div, 0)
        left_details_layout.addLayout(details_grid)

        self._detail_save_client_btn = QPushButton("Save Client Details")
        self._detail_save_client_btn.clicked.connect(self._save_selected_project_client)
        self._detail_save_client_btn.setStyleSheet(
            "QPushButton {"
            f"background: {ACCENT}; color: white; border: none; border-radius: 10px;"
            "padding: 8px 10px; font-size: 12px; font-weight: 700;"
            "}"
            "QPushButton:hover { background: #2458D3; }"
        )
        left_details_layout.addWidget(self._detail_save_client_btn, 0, Qt.AlignmentFlag.AlignLeft)
        left_details_layout.addStretch(1)

        side_stack = QStackedWidget()
        side_stack.setStyleSheet("QStackedWidget { background: transparent; border: none; }")
        self._detail_general_side_stack = side_stack
        self._detail_notes = QTextEdit()
        self._detail_notes.setMinimumHeight(110)
        self._detail_notes.setStyleSheet(
            "QTextEdit {"
            "background: transparent; border: none; padding: 2px 0px; font-size: 12px;"
            "}"
        )
        self._detail_notes.installEventFilter(self)
        side_stack.addWidget(self._detail_notes)
        images_page = QWidget()
        images_page_layout = QVBoxLayout(images_page)
        images_page_layout.setContentsMargins(0, 0, 0, 0)
        images_page_layout.setSpacing(0)
        gallery_layout = QHBoxLayout()
        gallery_layout.setContentsMargins(0, 0, 0, 0)
        gallery_layout.setSpacing(8)
        thumb_col = QVBoxLayout()
        thumb_col.setContentsMargins(0, 0, 0, 0)
        thumb_col.setSpacing(6)
        images_list = QListWidget()
        images_list.setViewMode(QListWidget.ViewMode.IconMode)
        images_list.setFlow(QListWidget.Flow.TopToBottom)
        images_list.setMovement(QListWidget.Movement.Static)
        images_list.setWrapping(False)
        images_list.setResizeMode(QListWidget.ResizeMode.Adjust)
        images_list.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        images_list.setIconSize(QSize(84, 84))
        images_list.setFixedWidth(112)
        images_list.setSpacing(6)
        images_list.setCursor(Qt.CursorShape.PointingHandCursor)
        images_list.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        images_list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        images_list.setStyleSheet(
            "QListWidget { background: transparent; border: none; padding: 0px; }"
            "QListWidget::item { border-radius: 6px; margin: 2px; outline: none; }"
            "QListWidget::item:selected { background: transparent; }"
            "QListWidget::item:selected:active { background: transparent; color: #1F2937; }"
            "QListWidget::item:selected:!active { background: transparent; color: #1F2937; }"
        )
        images_list.viewport().setCursor(Qt.CursorShape.PointingHandCursor)
        images_list.installEventFilter(self)
        images_preview = QLabel("No images uploaded.")
        images_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        images_preview.setMinimumHeight(132)
        images_preview.setMinimumWidth(0)
        images_preview.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Expanding)
        images_preview.setStyleSheet("QLabel { background: transparent; border: none; color: #6B7280; font-size: 12px; padding: 8px; }")
        images_preview.setScaledContents(False)
        images_preview.setCursor(Qt.CursorShape.PointingHandCursor)
        images_preview.installEventFilter(self)
        preview_col = QVBoxLayout()
        preview_col.setContentsMargins(0, 0, 0, 0)
        preview_col.setSpacing(6)
        preview_col.addWidget(images_preview, 1)
        preview_host = QWidget()
        preview_host.setLayout(preview_col)
        thumb_col.addWidget(images_list, 1)
        gallery_layout.addLayout(thumb_col, 0)
        gallery_layout.addWidget(preview_host, 1)
        images_page_layout.addLayout(gallery_layout, 1)
        images_list.currentRowChanged.connect(lambda _row: self._update_general_image_preview(False))
        side_stack.addWidget(images_page)
        self._detail_images_list = images_list
        self._detail_images_preview = images_preview
        right_notes_layout.addWidget(side_stack, 1)

        self._detail_save_notes_btn = QPushButton("Save Notes")
        self._detail_save_notes_btn.clicked.connect(self._save_selected_project_notes)
        self._detail_save_notes_btn.setStyleSheet(
            "QPushButton {"
            "background: #F2F2F7; color: #2C2C2E; border: none; border-radius: 10px;"
            "padding: 8px 10px; font-size: 12px; font-weight: 700;"
            "}"
            "QPushButton:hover { background: #E8E8ED; }"
        )
        right_notes_layout.addWidget(self._detail_save_notes_btn, 0, Qt.AlignmentFlag.AlignLeft)
        self._project_detail_stack.addWidget(settings_page)
        self._set_project_detail_tab("general")

        self._set_detail_enabled(False)
        return card

    def _set_project_detail_tab(self, key: str) -> None:
        prev_tab_key = str(self._project_detail_tab_key or "general").strip().lower()
        tab_key = str(key or "general").strip().lower()
        if tab_key not in ("general", "sales", "production", "settings"):
            tab_key = "general"
        if tab_key in ("sales", "production"):
            can_view, _can_edit = self._project_tab_access(self._selected_project(), tab_key)
            if not can_view and tab_key == "production":
                if self._open_production_unlock_prompt_for_selected_project():
                    can_view, _can_edit = self._project_tab_access(self._selected_project(), tab_key)
            if not can_view:
                if tab_key == "production":
                    self._refresh_project_detail_tab_styles()
                    return
                tab_key = "general"
        self._project_detail_tab_key = tab_key
        if prev_tab_key == "production" and tab_key != "production":
            self._clear_sticky_production_unlock_if_expired(self._selected_project())
        if isinstance(self._project_detail_stack, QStackedWidget):
            idx_map = {"general": 0, "sales": 1, "production": 2, "settings": 3}
            self._project_detail_stack.setCurrentIndex(int(idx_map.get(tab_key, 0)))
        self._refresh_project_detail_tab_styles()

    def _refresh_project_detail_tab_styles(self) -> None:
        if not isinstance(self._project_detail_tab_buttons, dict):
            return
        inactive_bg = "#F1F5F9"
        inactive_hover = "#E8EEF5"
        disabled_bg = "#EEF1F5"
        disabled_text = "#9AA7B8"
        raw = self._selected_project()
        ordered_keys = [k for k in (self._project_detail_tab_order or []) if k in self._project_detail_tab_buttons]
        if not ordered_keys:
            ordered_keys = list(self._project_detail_tab_buttons.keys())
        total = len(ordered_keys)
        project_access = str(self._project_user_access_level(raw))
        for idx, key in enumerate(ordered_keys):
            btn = self._project_detail_tab_buttons.get(key)
            if not isinstance(btn, QPushButton):
                continue
            tab_can_view, _tab_can_edit = self._project_tab_access(raw, str(key))
            if str(key) not in ("sales", "production"):
                tab_can_view = True
            btn_clickable = bool(tab_can_view)
            if str(key) == "production" and not tab_can_view:
                btn_clickable = bool(project_access in ("view", "edit"))
            btn.setEnabled(btn_clickable)
            base_label = str(btn.property("baseTabLabel") or btn.text() or "").strip() or str(key).title()
            btn.setText(base_label)
            timer_txt = None
            if str(key) == "production":
                rem_secs = self._current_user_temp_production_remaining_seconds(raw)
                if isinstance(rem_secs, int) and rem_secs > 0:
                    timer_txt = self._format_temp_unlock_timer(rem_secs)
            self._set_project_tab_timer_pill(btn, timer_txt)
            locked_tab = str(key) in ("sales", "production") and not bool(tab_can_view)
            if locked_tab:
                lock_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "lock.png"
                lock_icon = self._build_tinted_icon(lock_icon_path, QColor(disabled_text)) if hasattr(self, "_build_tinted_icon") else QIcon()
                btn.setIcon(lock_icon)
                btn.setIconSize(QSize(12, 12))
            else:
                btn.setIcon(QIcon())
            active = str(key) == str(self._project_detail_tab_key)
            is_first = idx == 0
            is_last = idx == (total - 1)
            tl = "10px" if is_first else "0px"
            tr = "10px" if is_last else "0px"
            common_shape = (
                f"border-top-left-radius: {tl}; border-top-right-radius: {tr}; "
                "border-bottom-left-radius: 0px; border-bottom-right-radius: 0px;"
            )
            corner_outline = ""
            if is_first:
                corner_outline += " border-left: 1px solid #E4E6EC;"
            if is_last:
                corner_outline += " border-right: 1px solid #E4E6EC;"
            if not tab_can_view:
                divider = "border-right: 1px solid #E4E9F2;" if not is_last else ""
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background: {disabled_bg}; color: {disabled_text}; border: none; border-top: 1px solid #DCE3EE; border-bottom: 1px solid #DCE3EE; {divider} {corner_outline} {common_shape}"
                    "font-size: 16px; font-weight: 700; padding: 10px 10px; margin: 0px; }"
                    f"QPushButton:hover {{ background: {disabled_bg}; color: {disabled_text}; }}"
                )
                self._set_project_tab_timer_pill(btn, None)
                self._set_project_tab_text_underline(btn, False)
                continue
            if active:
                divider = "border-right: 1px solid #E4E9F2;" if not is_last else ""
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background: #FFFFFF; color: #20304A; border: none; border-top: 1px solid #DCE3EE; border-bottom: none; {divider} {corner_outline} {common_shape}"
                    "font-size: 16px; font-weight: 700; padding: 11px 10px; margin: 0px; }"
                    "QPushButton:hover { background: #FFFFFF; color: #20304A; }"
                )
            else:
                divider = "border-right: 1px solid #E4E9F2;" if not is_last else ""
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background: {inactive_bg}; color: #355172; border: none; border-top: 1px solid #DCE3EE; border-bottom: 1px solid #DCE3EE; {divider} {corner_outline} {common_shape}"
                    "font-size: 16px; font-weight: 700; padding: 10px 10px; margin: 0px; }"
                    f"QPushButton:hover {{ background: {inactive_hover}; color: #2E4867; }}"
                )
            self._set_project_tab_text_underline(btn, active)
        self._schedule_production_unlock_timer_refresh()

    def _project_sales_payload(self, raw: dict | None) -> dict:
        payload = (raw or {}).get("sales")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = None
        if not isinstance(payload, dict):
            payload = {}
        legacy = (raw or {}).get("salesJson")
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

    def _save_project_sales_payload(self, raw: dict | None, payload: dict) -> bool:
        merged = self._project_sales_payload(raw)
        merged.update(dict(payload or {}))
        ok = self._save_project_patch({"sales": merged, "salesJson": json.dumps(merged)})
        if not ok:
            return False
        try:
            # Keep Sales -> Rooms totals live while Initial Measure is being edited.
            # This covers board/job-type changes and any other cutlist edits.
            if isinstance(payload, dict) and ("initialMeasureCutlist" in payload or "jobTypes" in payload or "rooms" in payload):
                updated = self._selected_project()
                self._refresh_sales_rooms_panel(True, updated)
                self._refresh_sales_rooms_panel(False, updated)
        except Exception:
            pass
        return True

    def _open_initial_measure_cutlist(self) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "Initial Measure", "Select a project first.")
            return
        _can_sales_view, can_sales_edit = self._project_tab_access(raw, "sales")
        if not can_sales_edit:
            QMessageBox.warning(self, "Initial Measure", "You do not have permission to edit the Sales tab.")
            return
        sales_payload = self._project_sales_payload(raw)
        def _norm_key(value: str) -> str:
            return " ".join(str(value or "").strip().lower().split())
        cut_payload = sales_payload.get("initialMeasureCutlist")
        if not isinstance(cut_payload, dict):
            cut_payload = {}
        rows = cut_payload.get("rows") if isinstance(cut_payload.get("rows"), list) else []
        entry_draft_rows = cut_payload.get("entryDraftRows") if isinstance(cut_payload.get("entryDraftRows"), list) else []
        collapsed_part_types = cut_payload.get("collapsedPartTypes") if isinstance(cut_payload.get("collapsedPartTypes"), list) else []
        room_seed = cut_payload.get("rooms") if isinstance(cut_payload.get("rooms"), list) else []
        seen_piece_rooms = cut_payload.get("roomsWithPieces") if isinstance(cut_payload.get("roomsWithPieces"), list) else []
        active_room = str(cut_payload.get("activeRoom") or "All").strip() or "All"
        active_part_type = str(cut_payload.get("activePartType") or "").strip()
        project_room_seed: list[str] = []
        _seen_room_keys: set[str] = set()

        def _add_project_room(value: str) -> None:
            text = str(value or "").strip()
            if not text:
                return
            key = " ".join(text.lower().split())
            if not key or key == "all" or key in _seen_room_keys:
                return
            _seen_room_keys.add(key)
            project_room_seed.append(text)

        for token in self._project_cutlist_rooms(raw):
            _add_project_room(token)
        sales_rooms_seed = sales_payload.get("rooms")
        if isinstance(sales_rooms_seed, list):
            for token in sales_rooms_seed:
                if isinstance(token, dict):
                    _add_project_room(str(token.get("name") or ""))
                else:
                    _add_project_room(str(token or ""))
        for token in room_seed:
            _add_project_room(str(token or ""))
        initial_measure_map = self._company_part_type_initial_measure_map()
        part_type_options = [
            name
            for name in self._company_part_type_names()
            if bool(initial_measure_map.get(self._part_key(name), False))
        ]
        selected_job_types_raw = sales_payload.get("jobTypes")
        selected_job_type_keys = (
            {" ".join(str(v or "").strip().lower().split()) for v in selected_job_types_raw}
            if isinstance(selected_job_types_raw, list)
            else set()
        )
        initial_measure_board_options = [
            name
            for name in self._company_sales_job_type_names()
            if " ".join(str(name or "").strip().lower().split()) in selected_job_type_keys
        ]
        if not initial_measure_board_options:
            initial_measure_board_options = self._project_board_options(raw)
        initial_measure_board_display_map = {str(v): str(v) for v in initial_measure_board_options}
        initial_measure_board_lacquer_map = {
            str(v): ("lacquer" in str(v or "").lower())
            for v in initial_measure_board_options
        }

        dialog = CutlistDialog(
            rows=[dict(r) for r in rows if isinstance(r, dict)],
            entry_draft_rows=[dict(r) for r in entry_draft_rows if isinstance(r, dict)],
            collapsed_part_types=[str(v or "") for v in collapsed_part_types],
            project_name=str(raw.get("name") or "Project"),
            company_name=str((self._company or {}).get("name") or ""),
            print_meta=self._project_cutlist_print_meta(raw),
            part_type_options=part_type_options,
            part_type_colors=self._company_part_type_color_map(),
            part_type_autoclash=self._company_part_type_autoclash_map(),
            part_type_cabinetry=self._company_part_type_cabinetry_map(),
            part_type_drawer=self._company_part_type_drawer_map(),
            part_type_include_in_cutlists=self._company_part_type_include_in_cutlists_map(),
            drawer_back_height_letters=self._project_drawer_back_height_letters(raw),
            drawer_breakdown_spec=self._project_drawer_breakdown_spec(raw),
            measurement_unit=str((self._company or {}).get("measurementUnit") or "mm"),
            board_options=initial_measure_board_options,
            board_sheet_sizes=self._project_board_sheet_size_map(raw),
            board_thickness_map=self._project_board_thickness_map(raw),
            board_display_map=initial_measure_board_display_map,
            board_lacquer_map=initial_measure_board_lacquer_map,
            nesting_settings=self._project_nesting_settings(raw),
            include_grain=self._project_has_grain_board(raw),
            enabled_columns=self._company_cutlist_columns_for_mode("initial_measure"),
            show_project_counts=False,
            top_bar_title="Initial Measure",
            project_rooms=[str(v or "") for v in project_room_seed],
            seen_piece_rooms=[str(v or "") for v in seen_piece_rooms],
            active_room=active_room,
            active_part_type=active_part_type,
            on_change=lambda payload: self._save_project_sales_payload(raw, {"initialMeasureCutlist": dict(payload or {})}),
            parent=None,
        )
        dialog.setProperty("projectId", str(raw.get("id") or "").strip())
        dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self._open_initial_measure_dialogs.append(dialog)

        def _on_close(_result: int = 0, dlg=dialog, project=raw) -> None:
            try:
                payload = dlg.cutlist_payload()
                self._save_project_sales_payload(project, {"initialMeasureCutlist": payload})
            except Exception:
                pass
            self._open_initial_measure_dialogs = [d for d in self._open_initial_measure_dialogs if d is not dlg]

        dialog.finished.connect(_on_close)
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def _open_sales_items_window(self) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "Items", "Select a project first.")
            return
        _can_sales_view, can_sales_edit = self._project_tab_access(raw, "sales")
        if not can_sales_edit:
            QMessageBox.warning(self, "Items", "You do not have permission to edit the Sales tab.")
            return
        payload = self._project_sales_payload(raw)
        items = payload.get("items") if isinstance(payload.get("items"), list) else []
        room_rows = payload.get("rooms") if isinstance(payload.get("rooms"), list) else []
        rooms: list[str] = []
        seen_rooms: set[str] = set()
        for row in room_rows:
            if isinstance(row, dict):
                room_name = str(row.get("name") or "").strip()
            else:
                room_name = str(row or "").strip()
            if not room_name:
                continue
            key = " ".join(room_name.lower().split())
            if not key or key in seen_rooms:
                continue
            seen_rooms.add(key)
            rooms.append(room_name)
        inventory_rows = (self._company or {}).get("salesInventory")
        if not isinstance(inventory_rows, list):
            inventory_rows = []
        item_categories = (self._company or {}).get("itemCategories")
        if not isinstance(item_categories, list):
            item_categories = (self._company or {}).get("salesItemCategories")
        if not isinstance(item_categories, list):
            item_categories = []
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or ACCENT), ACCENT)
        dialog = SalesItemsDialog(
            items=[dict(r) for r in items if isinstance(r, dict)],
            inventory_rows=[dict(r) for r in inventory_rows if isinstance(r, dict)],
            item_categories=[dict(r) for r in item_categories if isinstance(r, dict)],
            rooms=rooms,
            project_name=str(raw.get("name") or "Project"),
            theme_hex=theme,
            parent=self,
        )
        dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self._open_sales_items_dialogs.append(dialog)

        def _on_close(_result: int = 0, dlg=dialog, project=raw) -> None:
            try:
                self._save_project_sales_payload(project, {"items": dlg.payload_items()})
                updated = self._selected_project()
                self._refresh_sales_rooms_panel(True, updated)
                self._refresh_sales_rooms_panel(False, updated)
            except Exception:
                pass
            self._open_sales_items_dialogs = [d for d in self._open_sales_items_dialogs if d is not dlg]

        dialog.finished.connect(_on_close)
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def _open_sales_placeholder(self, title: str) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, title, "Select a project first.")
            return
        can_sales_view, _can_sales_edit = self._project_tab_access(raw, "sales")
        if not can_sales_view:
            QMessageBox.warning(self, title, "You do not have permission to view the Sales tab.")
            return
        if str(title or "").strip().lower() == "quote":
            self._open_quote_preview_window(raw)
            return
        QMessageBox.information(self, title, f"{title} will be added in the next step.")

    def _render_quote_template_html(self, template_html: str, raw: dict, body_text: str = "", body_is_html: bool = False) -> str:
        project_id = str((raw or {}).get("id") or "").strip()
        latest_raw = None
        if project_id:
            sel = self._selected_project() if hasattr(self, "_selected_project") else None
            if isinstance(sel, dict) and str(sel.get("id") or "").strip() == project_id:
                latest_raw = sel
            else:
                for row in (self._projects_all or []):
                    if isinstance(row, dict) and str(row.get("id") or "").strip() == project_id:
                        latest_raw = row
                        break
        if isinstance(latest_raw, dict):
            # Prefer the freshest project snapshot (by updatedAtIso), but merge so
            # new in-memory fields from either side are preserved.
            r1 = dict(raw or {})
            r2 = dict(latest_raw or {})
            t1 = str(r1.get("updatedAtIso") or r1.get("createdAtIso") or "")
            t2 = str(r2.get("updatedAtIso") or r2.get("createdAtIso") or "")
            raw = ({**r1, **r2} if t2 >= t1 else {**r2, **r1})
        sales_payload = self._project_sales_payload(raw)
        quote_extras_rows = self._company_quote_extras_rows() if hasattr(self, "_company_quote_extras_rows") else []
        linked_placeholder_keys = {
            str((qr or {}).get("templatePlaceholderKey") or "").strip().strip("{} ").lower()
            for qr in quote_extras_rows
            if isinstance(qr, dict) and str((qr or {}).get("templatePlaceholderKey") or "").strip()
        }
        def _parse_num(value) -> float:
            txt = str(value or "").strip().replace(",", "")
            if txt.startswith("$"):
                txt = txt[1:].strip()
            try:
                return float(txt) if txt else 0.0
            except Exception:
                return 0.0

        def _currency_symbol() -> str:
            raw_currency = str((self._company or {}).get("defaultCurrency") or "NZD - New Zealand Dollar").strip()
            code = raw_currency.split(" - ", 1)[0].strip().upper() if raw_currency else "NZD"
            symbols = {
                "USD": "$",
                "EUR": "ï¿½",
                "GBP": "ï¿½",
                "AUD": "$",
                "NZD": "$",
                "CAD": "$",
                "JPY": "ï¿½",
                "CNY": "ï¿½",
                "SGD": "$",
                "AED": "?.?",
            }
            return symbols.get(code, "$")

        def _fmt_money(value: float) -> str:
            return f"{_currency_symbol()}{float(value):,.2f}"

        def _room_key(value: str) -> str:
            return " ".join(str(value or "").strip().lower().split())

        def _norm_key(value: str) -> str:
            return " ".join(str(value or "").strip().lower().split())

        payload_rooms = sales_payload.get("rooms") if isinstance(sales_payload.get("rooms"), list) else []
        included_by_key: dict[str, bool] = {}
        display_name_by_key: dict[str, str] = {}
        fallback_total_by_key: dict[str, float] = {}
        for row in payload_rooms:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            key = _room_key(name)
            if not key:
                continue
            display_name_by_key[key] = name
            included_by_key[key] = bool(row.get("included", True))
            fallback_total_by_key[key] = _parse_num(row.get("totalPrice"))
        computed_totals: dict[str, float] = {}
        comp_fn = getattr(self, "_sales_room_total_prices_from_initial_measure", None)
        if callable(comp_fn):
            try:
                computed = comp_fn(raw)
                if isinstance(computed, dict):
                    for k, v in computed.items():
                        ck = _room_key(str(k or ""))
                        if ck:
                            computed_totals[ck] = _parse_num(v)
            except Exception:
                computed_totals = {}
        all_keys = list(dict.fromkeys([*display_name_by_key.keys(), *computed_totals.keys()]))
        rooms: list[dict] = []
        for key in all_keys:
            rooms.append(
                {
                    "name": display_name_by_key.get(key) or key.title(),
                    "included": bool(included_by_key.get(key, True)),
                    "totalPrice": computed_totals.get(key, fallback_total_by_key.get(key, 0.0)),
                }
            )
        rows = []
        total = 0.0
        for row in rooms:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            included = bool(row.get("included", True))
            price_val = _parse_num(row.get("totalPrice"))
            if included:
                total += price_val
            rows.append(
                f"<tr>"
                f"<td style='padding:6px 8px;border:1px solid #E5E7EB'>{html.escape(name)}</td>"
                f"<td style='padding:6px 8px;border:1px solid #E5E7EB;text-align:right'>{price_val:.2f}</td>"
                f"<td style='padding:6px 8px;border:1px solid #E5E7EB;text-align:center'>{'Yes' if included else 'No'}</td>"
                f"</tr>"
            )
        rooms_table = (
            "<table style='border-collapse:collapse;width:100%'>"
            "<thead><tr>"
            "<th style='padding:6px 8px;border:1px solid #E5E7EB;text-align:left'>Room</th>"
            "<th style='padding:6px 8px;border:1px solid #E5E7EB;text-align:right'>Total</th>"
            "<th style='padding:6px 8px;border:1px solid #E5E7EB;text-align:center'>Included</th>"
            "</tr></thead><tbody>"
            + ("".join(rows) if rows else "<tr><td colspan='3' style='padding:8px;border:1px solid #E5E7EB;color:#6B7280'>No rooms</td></tr>")
            + "</tbody></table>"
        )
        client_name = str(raw.get("clientName") or raw.get("client") or "").strip()
        client_phone = str(raw.get("clientPhone") or raw.get("clientNumber") or "").strip()
        client_email = str(raw.get("clientEmail") or "").strip()
        client_address = str(raw.get("clientAddress") or "").strip()
        creator_uid = str(raw.get("createdByUid") or "").strip()
        creator_email = ""
        creator_mobile = ""
        if creator_uid:
            for person in (self._staff_all or []):
                if str((person or {}).get("uid") or "").strip() != creator_uid:
                    continue
                creator_email = str((person or {}).get("email") or "").strip()
                creator_mobile = str((person or {}).get("mobile") or (person or {}).get("phone") or "").strip()
                break
            if (not creator_email or not creator_mobile) and hasattr(self.app.company, "get_user_profile"):
                try:
                    prof = self.app.company.get_user_profile(creator_uid) or {}
                    if not creator_email:
                        creator_email = str((prof or {}).get("email") or "").strip()
                    if not creator_mobile:
                        creator_mobile = str((prof or {}).get("mobile") or (prof or {}).get("phone") or "").strip()
                except Exception:
                    pass
        region = str(raw.get("region") or "").strip()
        if region:
            client_address = f"{client_address}, {region}" if client_address else region
        logo_src = self._resolve_company_logo_src()
        logo_img = (
            f"<img src=\"{html.escape(logo_src, quote=True)}\" alt=\"Company Logo\" "
            "style=\"max-height:96px;max-width:100%;object-fit:contain;\">"
            if logo_src
            else ""
        )
        body_token = str(body_text or "")
        if body_is_html:
            lower = body_token.lower()
            b0 = lower.find("<body")
            if b0 >= 0:
                bs = lower.find(">", b0)
                be = lower.rfind("</body>")
                if bs >= 0 and be > bs:
                    body_token = body_token[bs + 1:be]
        else:
            body_token = html.escape(body_token).replace("\n", "<br>")
        promo_discount_amount = ""
        tiers_raw = (self._company or {}).get("salesQuoteDiscountTiers")
        if isinstance(tiers_raw, list):
            matched: list[tuple[float, float, float]] = []
            for tier in tiers_raw:
                if not isinstance(tier, dict):
                    continue
                low_val = _parse_num(tier.get("low"))
                high_val = _parse_num(tier.get("high"))
                disc_val = _parse_num(tier.get("discount"))
                if high_val < low_val:
                    low_val, high_val = high_val, low_val
                if low_val <= total <= high_val:
                    matched.append((low_val, high_val, disc_val))
            if matched:
                # If ranges overlap, prefer the most specific/highest-floor tier.
                matched.sort(key=lambda t: (t[0], -(t[1] - t[0])))
                _low, _high, disc_val = matched[-1]
                promo_discount_amount = _fmt_money(disc_val)
        body_slot_token = "__CS_BODY_HTML_SLOT_9F3A71__"
        token_values = {
            "company_name": html.escape(str((self._company or {}).get("name") or "")),
            "project_name": html.escape(str(raw.get("name") or "")),
            "project_status": html.escape(str(raw.get("status") or "")),
            "quote_generated_date": html.escape(self._short_date(str(raw.get("updatedAtIso") or raw.get("createdAtIso") or ""))),
            "client_name": html.escape(client_name),
            "client_phone": html.escape(client_phone),
            "client_email": html.escape(client_email),
            "client_address": html.escape(client_address),
            "date_created": html.escape(self._short_date_with_time(str(raw.get("createdAtIso") or ""))),
            "date_modified": html.escape(self._short_date_with_time(str(raw.get("updatedAtIso") or ""))),
            "project_creator": html.escape(self._project_creator_display_name(raw)),
            "creator_email": html.escape(creator_email),
            "creator_mobile": html.escape(creator_mobile),
            "project_creator_email": html.escape(creator_email),
            "project_creator_mobile": html.escape(creator_mobile),
            "promotional_discount": "",
            "promotional_discount_amount": promo_discount_amount,
            "incl_gst": "(incl G.S.T)",
            "rooms_table": rooms_table,
            "total_price": _fmt_money(total),
            "body": body_slot_token,
            "company_logo_src": html.escape(logo_src, quote=True),
        }
        out = str(template_html or "")
        for key, val in token_values.items():
            if str(key or "").strip().lower() in linked_placeholder_keys:
                continue
            txt = str(val)
            # Support {{token}} / {{ token }} and mixed case token names.
            out = re.sub(
                r"\{\{\s*" + re.escape(key) + r"\s*\}\}",
                lambda _m, _txt=txt: _txt,
                out,
                flags=re.IGNORECASE,
            )
            # Also support HTML-escaped braces from rich-text editors.
            out = re.sub(
                r"(?:&#123;|&#x7b;|&lcub;){2}\s*" + re.escape(key) + r"\s*(?:&#125;|&#x7d;|&rcub;){2}",
                lambda _m, _txt=txt: _txt,
                out,
                flags=re.IGNORECASE,
            )
            # Handle doubly-escaped entity braces (&amp;#123; ...).
            out = re.sub(
                r"(?:&amp;#123;|&amp;#x7b;|&amp;lcub;){2}\s*" + re.escape(key) + r"\s*(?:&amp;#125;|&amp;#x7d;|&amp;rcub;){2}",
                lambda _m, _txt=txt: _txt,
                out,
                flags=re.IGNORECASE,
            )
            # Keep single-brace support for backwards compatibility.
            out = re.sub(
                r"\{\s*" + re.escape(key) + r"\s*\}",
                lambda _m, _txt=txt: _txt,
                out,
                flags=re.IGNORECASE,
            )
        # Final targeted fallback for discount amount token in tricky rich-text encodings.
        if "promotional_discount_amount" not in linked_placeholder_keys:
            promo_txt = str(token_values.get("promotional_discount_amount") or "")
            out = re.sub(
                r"(?:\{\{|\&#123;\&#123;|\&#x7b;\&#x7b;|\&lcub;\&lcub;|\&amp;\#123;\&amp;\#123;|\&amp;\#x7b;\&amp;\#x7b;)\s*promotional_discount_amount\s*(?:\}\}|\&#125;\&#125;|\&#x7d;\&#x7d;|\&rcub;\&rcub;|\&amp;\#125;\&amp;\#125;|\&amp;\#x7d;\&amp;\#x7d;)",
                lambda _m, _txt=promo_txt: _txt,
                out,
                flags=re.IGNORECASE,
            )
        raw_tokens = {
            "company_logo": logo_img,
            "logo": logo_img,
            "logo_src": logo_src,
        }
        for key, val in raw_tokens.items():
            txt = str(val)
            out = re.sub(
                r"\{\{\s*" + re.escape(key) + r"\s*\}\}",
                lambda _m, _txt=txt: _txt,
                out,
                flags=re.IGNORECASE,
            )
            out = re.sub(
                r"\{\s*" + re.escape(key) + r"\s*\}",
                lambda _m, _txt=txt: _txt,
                out,
                flags=re.IGNORECASE,
            )

        # Conditionally hide linked template containers when the matching
        # quote extra is unticked in the project Sales panel.
        selected_quote_extras_raw = sales_payload.get("quoteExtrasIncluded")
        if isinstance(selected_quote_extras_raw, list):
            selected_quote_extras = {_norm_key(str(v or "")) for v in selected_quote_extras_raw}
        else:
            selected_quote_extras = set()
        linked_container_ids: set[str] = set()
        active_container_ids: set[str] = set()
        raw_name_map = (self._company or {}).get("quoteTemplateContainerNames")
        container_name_map = dict(raw_name_map) if isinstance(raw_name_map, dict) else {}
        linked_container_names: set[str] = set()
        active_container_names: set[str] = set()
        for qr in quote_extras_rows:
            if not isinstance(qr, dict):
                continue
            nm_key = _norm_key(str(qr.get("name") or ""))
            cid = str(qr.get("templateContainerId") or "").strip()
            if not nm_key or not cid:
                continue
            if cid.lower().startswith("name::"):
                cname_key = _norm_key(cid.split("::", 1)[1])
                if not cname_key:
                    continue
                linked_container_names.add(cname_key)
                if nm_key in selected_quote_extras:
                    active_container_names.add(cname_key)
                continue
            linked_container_ids.add(cid)
            cname_key = _norm_key(str(container_name_map.get(cid) or ""))
            if cname_key:
                linked_container_names.add(cname_key)
            if nm_key in selected_quote_extras:
                active_container_ids.add(cid)
                if cname_key:
                    active_container_names.add(cname_key)
        hidden_container_ids = linked_container_ids - active_container_ids
        hidden_container_names = linked_container_names - active_container_names
        for cid in hidden_container_ids:
            # Preferred path: explicit container markers.
            out = re.sub(
                r"<!--\s*CS_CONTAINER_START:" + re.escape(cid) + r"\s*-->.*?<!--\s*CS_CONTAINER_END:" + re.escape(cid) + r"\s*-->",
                "",
                out,
                flags=re.IGNORECASE | re.DOTALL,
            )
        if hidden_container_ids or hidden_container_names:
            hide_css = "".join(
                f"[data-cs-container-id=\"{html.escape(cid, quote=True)}\"]{{display:none !important;}}"
                for cid in sorted(hidden_container_ids)
            )
            hide_css += "".join(
                f"[data-cs-container-name=\"{html.escape(cn, quote=True)}\"]{{display:none !important;}}"
                for cn in sorted(hidden_container_names)
            )
            if hide_css:
                style_tag = f"<style>{hide_css}</style>"
                lower = out.lower()
                head_end = lower.find("</head>")
                if head_end >= 0:
                    out = out[:head_end] + style_tag + out[head_end:]
                else:
                    out = style_tag + out

        def _replace_placeholder_token(blob: str, ph_key: str, fill_text: str) -> str:
            out_blob = str(blob or "")
            out_blob = re.sub(
                r"\{\{\s*" + re.escape(ph_key) + r"\s*\}\}",
                lambda _m, _txt=fill_text: _txt,
                out_blob,
                flags=re.IGNORECASE,
            )
            out_blob = re.sub(
                r"(?:&#123;|&#x7b;|&lcub;){2}\s*" + re.escape(ph_key) + r"\s*(?:&#125;|&#x7d;|&rcub;){2}",
                lambda _m, _txt=fill_text: _txt,
                out_blob,
                flags=re.IGNORECASE,
            )
            out_blob = re.sub(
                r"(?:&amp;#123;|&amp;#x7b;|&amp;lcub;){2}\s*" + re.escape(ph_key) + r"\s*(?:&amp;#125;|&amp;#x7d;|&amp;rcub;){2}",
                lambda _m, _txt=fill_text: _txt,
                out_blob,
                flags=re.IGNORECASE,
            )
            out_blob = re.sub(
                r"\{\s*" + re.escape(ph_key) + r"\s*\}",
                lambda _m, _txt=fill_text: _txt,
                out_blob,
                flags=re.IGNORECASE,
            )
            return out_blob

        # Placeholder links: if the quote extra is unticked, blank the placeholder.
        # If ticked, fill with the quote-extra row name by default.
        for qr in quote_extras_rows:
            if not isinstance(qr, dict):
                continue
            nm_key = _norm_key(str(qr.get("name") or ""))
            ph_key = str(qr.get("templatePlaceholderKey") or "").strip().strip("{} ")
            if not nm_key or not ph_key:
                continue
            ph_lookup = str(ph_key or "").strip().lower()
            default_fill = str(token_values.get(ph_lookup) or "")
            if not default_fill:
                default_fill = html.escape(str(qr.get("name") or ""))
            fill = default_fill if nm_key in selected_quote_extras else ""
            out = _replace_placeholder_token(out, ph_key, fill)
            # Defensive: if old body HTML already contains this linked placeholder,
            # remove it when unticked so stale tokens cannot persist.
            if nm_key not in selected_quote_extras:
                body_token = _replace_placeholder_token(body_token, ph_key, "")
        out = out.replace(body_slot_token, body_token)
        return out

    def _resolve_company_logo_url(self) -> str:
        logo_path = str((self._company or {}).get("logoPath") or "").strip()
        if not logo_path:
            return ""
        low = logo_path.lower()
        if low.startswith("http://") or low.startswith("https://"):
            return logo_path
        if low.startswith("gs://"):
            gs = logo_path[5:]
            if "/" not in gs:
                return ""
            bucket, blob = gs.split("/", 1)
            # Prefer signed URL for protected Firebase objects.
            try:
                svc = getattr(self.app, "company", None)
                client = getattr(svc, "client", None)
                if client is not None and hasattr(client, "bucket"):
                    bkt = client.bucket(bucket)
                    blob_ref = bkt.blob(blob)
                    return str(
                        blob_ref.generate_signed_url(
                            version="v4",
                            expiration=timedelta(hours=6),
                            method="GET",
                        )
                    )
            except Exception:
                pass
            return f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{quote(blob, safe='')}?alt=media"
        if Path(logo_path).exists():
            return QUrl.fromLocalFile(logo_path).toString()
        return ""

    def _resolve_company_logo_src(self) -> str:
        """
        Return an <img src> value that is resilient in the embedded quote window.
        Prefer data URIs so WebEngine doesn't need to refetch protected remote files.
        """
        logo_path = str((self._company or {}).get("logoPath") or "").strip()
        if not logo_path:
            return ""
        low = logo_path.lower()

        def _data_uri(raw: bytes, content_type: str = "image/png") -> str:
            if not raw:
                return ""
            ctype = str(content_type or "image/png").split(";")[0].strip() or "image/png"
            return f"data:{ctype};base64,{base64.b64encode(raw).decode('ascii')}"

        if low.startswith("http://") or low.startswith("https://"):
            try:
                req = Request(logo_path, headers={"User-Agent": "Cutsmart/1.0"})
                with urlopen(req, timeout=8) as resp:
                    raw = resp.read()
                    ctype = str(resp.headers.get("Content-Type") or "image/png")
                    uri = _data_uri(raw, ctype)
                    if uri:
                        return uri
            except Exception:
                return logo_path
            return logo_path

        if low.startswith("gs://"):
            gs = logo_path[5:]
            if "/" not in gs:
                return ""
            bucket, blob = gs.split("/", 1)
            # 1) Best: direct blob bytes through Firebase admin client.
            try:
                svc = getattr(self.app, "company", None)
                client = getattr(svc, "client", None)
                if client is not None and hasattr(client, "bucket"):
                    bkt = client.bucket(bucket)
                    blob_ref = bkt.blob(blob)
                    try:
                        blob_ref.reload()
                    except Exception:
                        pass
                    raw = blob_ref.download_as_bytes()
                    ctype = str(getattr(blob_ref, "content_type", "") or "image/png")
                    uri = _data_uri(raw, ctype)
                    if uri:
                        return uri
            except Exception:
                pass
            # 2) Fallback: signed URL -> fetch -> data URI.
            try:
                svc = getattr(self.app, "company", None)
                client = getattr(svc, "client", None)
                if client is not None and hasattr(client, "bucket"):
                    bkt = client.bucket(bucket)
                    blob_ref = bkt.blob(blob)
                    signed = str(
                        blob_ref.generate_signed_url(
                            version="v4",
                            expiration=timedelta(hours=6),
                            method="GET",
                        )
                    )
                    req = Request(signed, headers={"User-Agent": "Cutsmart/1.0"})
                    with urlopen(req, timeout=8) as resp:
                        raw = resp.read()
                        ctype = str(resp.headers.get("Content-Type") or "image/png")
                        uri = _data_uri(raw, ctype)
                        if uri:
                            return uri
                    return signed
            except Exception:
                pass
            # 3) Final fallback: public media endpoint.
            return f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{quote(blob, safe='')}?alt=media"

        if Path(logo_path).exists():
            try:
                raw = Path(logo_path).read_bytes()
                ctype = mimetypes.guess_type(logo_path)[0] or "image/png"
                uri = _data_uri(raw, ctype)
                if uri:
                    return uri
            except Exception:
                return QUrl.fromLocalFile(logo_path).toString()
            return QUrl.fromLocalFile(logo_path).toString()

        return ""

    def _quote_template_source(self, p: Path) -> tuple[str, str]:
        suffix = str(p.suffix or "").strip().lower()
        if suffix == ".docx":
            return self._quote_template_from_docx(p), "docx"
        try:
            return p.read_text(encoding="utf-8"), "html"
        except Exception:
            return p.read_text(encoding="utf-16"), "html"

    def _quote_template_from_docx(self, p: Path) -> str:
        def _local(tag: str) -> str:
            return str(tag or "").rsplit("}", 1)[-1]

        def _txt(node: ET.Element | None) -> str:
            if node is None:
                return ""
            parts: list[str] = []
            for child in node.iter():
                tag = _local(str(child.tag or ""))
                if tag == "t":
                    parts.append(str(child.text or ""))
                elif tag == "tab":
                    parts.append("\t")
                elif tag in {"br", "cr"}:
                    parts.append("\n")
            return "".join(parts)

        def _parse_part(xml_bytes: bytes) -> list[str]:
            out_blocks: list[str] = []
            try:
                root = ET.fromstring(xml_bytes)
            except Exception:
                return out_blocks
            body = None
            for n in root.iter():
                if _local(str(getattr(n, "tag", "") or "")) == "body":
                    body = n
                    break
            if body is None:
                return out_blocks
            for child in list(body):
                tag = _local(str(getattr(child, "tag", "") or ""))
                if tag == "p":
                    paragraph = _txt(child).strip()
                    out_blocks.append(f"<p>{html.escape(paragraph)}</p>" if paragraph else "<p>&nbsp;</p>")
                elif tag == "tbl":
                    rows_html: list[str] = []
                    for tr in [n for n in list(child) if _local(str(getattr(n, "tag", "") or "")) == "tr"]:
                        cells_html: list[str] = []
                        for tc in [n for n in list(tr) if _local(str(getattr(n, "tag", "") or "")) == "tc"]:
                            cell_lines: list[str] = []
                            for pnode in [n for n in list(tc) if _local(str(getattr(n, "tag", "") or "")) == "p"]:
                                line = _txt(pnode).strip()
                                cell_lines.append(html.escape(line) if line else "&nbsp;")
                            cells_html.append(f"<td>{'<br>'.join(cell_lines) if cell_lines else '&nbsp;'}</td>")
                        rows_html.append(f"<tr>{''.join(cells_html)}</tr>")
                    out_blocks.append(
                        "<table border='1' cellspacing='0' cellpadding='6' "
                        "style='border-collapse:collapse; width:100%;'>"
                        f"{''.join(rows_html)}</table>"
                    )
            return out_blocks

        blocks: list[str] = []
        try:
            with zipfile.ZipFile(str(p), "r") as zf:
                if "word/document.xml" in zf.namelist():
                    blocks.extend(_parse_part(zf.read("word/document.xml")))
                for name in sorted(zf.namelist()):
                    if name.startswith("word/header") and name.endswith(".xml"):
                        blocks.extend(_parse_part(zf.read(name)))
                    if name.startswith("word/footer") and name.endswith(".xml"):
                        blocks.extend(_parse_part(zf.read(name)))
        except Exception as exc:
            raise RuntimeError(f"Could not read DOCX template: {exc}") from exc

        content = "\n".join(blocks).strip()
        if not content:
            return "<html><body><p>{{body}}</p></body></html>"
        return (
            "<html><head><meta charset='utf-8'>"
            "<style>body{font-family:Segoe UI,Arial,sans-serif;font-size:12pt;color:#111827;}"
            "p{margin:0 0 10px 0;}table{margin:10px 0;}td,th{vertical-align:top;}</style>"
            "</head><body>"
            f"{content}"
            "</body></html>"
        )

    def _open_quote_preview_window(self, raw: dict) -> None:
        _can_sales_view, can_sales_edit = self._project_tab_access(raw, "sales")
        default_base_layout_html = (
            self._default_quote_base_layout_html()
            if hasattr(self, "_default_quote_base_layout_html")
            else (
                "<table style='width:100%; border-collapse:collapse; table-layout:fixed; margin:0;'>"
                "<tr><td style='width:65%; vertical-align:top; padding:0 8px 0 0;'><p style='margin:0;'><strong>Project:</strong> {{project_name}}</p>"
                "<p style='margin:4px 0 0 0;'><strong>Client:</strong> {{client_name}}</p>"
                "<p style='margin:4px 0 0 0;'><strong>Address:</strong> {{client_address}}</p></td>"
                "<td style='width:35%; vertical-align:top; text-align:right; padding:0;'>{{company_logo}}</td></tr></table>"
            )
        )
        quote_theme = self._normalize_hex(str((self._company or {}).get("themeColor") or ACCENT), ACCENT)

        def _layout_html_from_model(raw_model_json: str) -> str:
            txt = str(raw_model_json or "").strip()
            if not txt:
                return ""
            try:
                parsed = json.loads(txt)
            except Exception:
                return ""
            if not isinstance(parsed, dict):
                return ""
            header_rows = parsed.get("header") if isinstance(parsed.get("header"), list) else []
            footer_rows = parsed.get("footer") if isinstance(parsed.get("footer"), list) else []
            def _norm_html_fragment(raw_html: str) -> str:
                frag = str(raw_html or "")
                low = frag.lower()
                b0 = low.find("<body")
                if b0 >= 0:
                    bs = low.find(">", b0)
                    be = low.rfind("</body>")
                    if bs >= 0 and be > bs:
                        frag = frag[bs + 1:be]
                return frag
            def _container_bg(container: dict) -> str:
                raw = str((container or {}).get("bgColor") or "#FFFFFF").strip()
                if not re.fullmatch(r"#[0-9A-Fa-f]{6}", raw):
                    return "#FFFFFF"
                return raw

            def _container_rows(container: dict) -> list[dict]:
                if not isinstance(container, dict):
                    return []
                rows = container.get("rows")
                if isinstance(rows, list) and rows:
                    out: list[dict] = []
                    for r in rows:
                        if not isinstance(r, dict):
                            continue
                        cols = r.get("columns")
                        cols = cols if isinstance(cols, list) else []
                        ws = r.get("weights")
                        if not isinstance(ws, list) or not ws:
                            ws = [1 for _ in cols] if cols else [1]
                        ws = [max(1, int(w)) for w in ws][:6]
                        if len(cols) < len(ws):
                            cols = cols + [{"type": "text", "content": ""} for _ in range(len(ws) - len(cols))]
                        elif len(cols) > len(ws):
                            cols = cols[:len(ws)]
                        out.append({"weights": ws, "columns": cols})
                    if out:
                        return out
                old_cols = container.get("columns")
                if isinstance(old_cols, list):
                    return [{"weights": [1 for _ in old_cols] if old_cols else [1], "columns": old_cols}]
                return []

            def _zone_html(rows: list[dict]) -> str:
                out: list[str] = []
                for container in rows:
                    if not isinstance(container, dict):
                        continue
                    bg_col = _container_bg(container)
                    try:
                        h_adj = int(container.get("heightPx") or 0)
                    except Exception:
                        h_adj = 0
                    section_rows: list[str] = []
                    for crow in _container_rows(container if isinstance(container, dict) else {}):
                        cols = crow.get("columns")
                        if not isinstance(cols, list) or not cols:
                            continue
                        ws = crow.get("weights")
                        if not isinstance(ws, list) or not ws:
                            ws = [1 for _ in cols]
                        ws = [max(1, int(w)) for w in ws][:max(1, len(cols))]
                        if len(ws) < len(cols):
                            ws = ws + [1 for _ in range(len(cols) - len(ws))]
                        total_w = float(max(1, sum(ws)))
                        cells: list[str] = []
                        for idx, col in enumerate(cols):
                            if not isinstance(col, dict):
                                continue
                            ctype = str(col.get("type") or "text").strip().lower()
                            if ctype == "logo":
                                inner = "{{company_logo}}"
                                align = "right"
                            elif ctype == "empty":
                                inner = ""
                                align = "left"
                            else:
                                inner = _norm_html_fragment(str(col.get("content") or ""))
                                align = "left"
                            width = (float(ws[idx]) / total_w) * 100.0 if idx < len(ws) else (100.0 / float(max(1, len(cols))))
                            cells.append(
                                f"<div style='flex:0 0 {width:.4f}%; max-width:{width:.4f}%; min-width:0; box-sizing:border-box; text-align:{align}; padding:2px;'>"
                                + inner
                                + "</div>"
                            )
                        section_rows.append(
                            "<div style='display:flex; width:100%; margin:0;'>"
                            + "".join(cells)
                            + "</div>"
                        )
                    if section_rows:
                        cid = str(container.get("__id") or "").strip()
                        cname = " ".join(str(container.get("name") or "").strip().lower().split())
                        extra = ""
                        if h_adj > 0:
                            extra += f" min-height:{h_adj}px;"
                        elif h_adj < 0:
                            extra += f" margin-bottom:{h_adj}px;"
                        open_tag = (
                            f"<div data-cs-container-id=\"{html.escape(cid, quote=True)}\" data-cs-container-name=\"{html.escape(cname, quote=True)}\" style='background:{bg_col}; padding:6px; margin:0 0 6px 0;{extra}'>"
                            if cid
                            else f"<div data-cs-container-name=\"{html.escape(cname, quote=True)}\" style='background:{bg_col}; padding:6px; margin:0 0 6px 0;{extra}'>"
                        )
                        seg = open_tag + "".join(section_rows) + "</div>"
                        if cid:
                            seg = f"<!--CS_CONTAINER_START:{html.escape(cid)}-->" + seg + f"<!--CS_CONTAINER_END:{html.escape(cid)}-->"
                        out.append(seg)
                return "".join(out)

            header_html = _zone_html(header_rows)
            footer_html = _zone_html(footer_rows)
            body_slot = (
                f"<div style='border:2px dashed {quote_theme}; border-radius:9px; padding:16px; text-align:center; "
                f"color:{quote_theme}; font-weight:800; margin-top:8px; margin-bottom:8px;'>{{{{body}}}}</div>"
            )
            return (
                "<div style='display:flex; flex-direction:column; width:100%; "
                "height:__CS_PAGE_HEIGHT_MM__mm; min-height:__CS_PAGE_HEIGHT_MM__mm;'>"
                + header_html
                + body_slot
                + "<div style='flex:1 1 auto; min-height:0;'></div>"
                + footer_html
                + "</div>"
            )

        model_layout_html = _layout_html_from_model(str((self._company or {}).get("quoteBaseLayoutModelJson") or ""))
        base_layout_html = model_layout_html or str((self._company or {}).get("quoteBaseLayoutHtml") or "").strip()
        if not base_layout_html:
            base_layout_html = default_base_layout_html
        try:
            base_layout_version_seed = int((self._company or {}).get("quoteBaseLayoutVersion") or 1)
        except Exception:
            base_layout_version_seed = 1
        base_layout_version_seed = max(1, base_layout_version_seed)
        active_layout_version = {"v": base_layout_version_seed}
        page_size = "A4"
        margin_mm = 10
        footer_pin_bottom = False
        body_font_family = str((self._company or {}).get("quoteTemplateBodyFontFamily") or "Segoe UI").strip() or "Segoe UI"
        try:
            body_font_size_pt = int((self._company or {}).get("quoteTemplateBodyFontSizePt") or 11)
        except Exception:
            body_font_size_pt = 11
        body_font_size_pt = max(6, min(72, body_font_size_pt))
        body_text_color = self._normalize_hex(str((self._company or {}).get("quoteTemplateBodyTextColor") or "#111827"), "#111827")
        body_text_weight = "700" if bool((self._company or {}).get("quoteTemplateBodyBold") is True) else "400"
        body_text_style = "italic" if bool((self._company or {}).get("quoteTemplateBodyItalic") is True) else "normal"
        body_text_deco = "underline" if bool((self._company or {}).get("quoteTemplateBodyUnderline") is True) else "none"
        _body_align_raw = str((self._company or {}).get("quoteTemplateBodyAlign") or "left").strip().lower()
        body_text_align = _body_align_raw if _body_align_raw in {"left", "center", "right"} else "left"
        page_sizes = {"A1": (594, 841), "A2": (420, 594), "A3": (297, 420), "A4": (210, 297)}
        if page_size not in page_sizes:
            page_size = "A4"
        w_mm, h_mm = page_sizes[page_size]
        usable_h_mm = max(10.0, float(h_mm - (2 * margin_mm)))
        base_layout_html = str(base_layout_html or "").replace("__CS_PAGE_HEIGHT_MM__", f"{usable_h_mm:.3f}")
        template_parts: list[str] = ["", "<div>{{body}}</div>", ""]
        template_heads: list[str] = []

        preview_guard_css = (
            "<style>"
            f"@page {{ size: {page_size}; margin: {margin_mm}mm; }}"
            "html,body{margin:0;padding:0;background:#E5E7EB;}"
            ".quote-pages{margin:0 auto; padding:12px 0;}"
            ".quote-page{margin:0 0 12px 0; padding:0;}"
            f".quote-sheet{{width:{w_mm}mm; height:{h_mm}mm; margin:0 auto; background:#FFF; border:1px solid #D1D5DB; border-radius:10px; box-shadow:none; box-sizing:border-box; padding:{margin_mm}mm; overflow:hidden; font-family:'{html.escape(body_font_family)}','Segoe UI',Arial,sans-serif; font-size:{body_font_size_pt}pt; line-height:1.25;}}"
            + ".quote-sheet p{margin:0 0 6px 0;}"
            + f"#quoteBodyEditor{{font-family:'{html.escape(body_font_family)}','Segoe UI',Arial,sans-serif; font-size:{body_font_size_pt}pt; color:{body_text_color}; font-weight:{body_text_weight}; font-style:{body_text_style}; text-decoration:{body_text_deco}; text-align:{body_text_align};}}"
            + f"#quoteBodyEditor p, #quoteBodyEditor div, #quoteBodyEditor span{{color:{body_text_color};}}"
            + ".quote-sheet:focus{outline:none; box-shadow:none;}"
            + ".quote-page.quote-page-clone .quote-sheet{pointer-events:none; user-select:none;}"
            + "@media print{"
            + "html,body{background:#FFFFFF !important;}"
            + ".quote-pages{padding:0 !important; margin:0 !important;}"
            + ".quote-page{margin:0 !important; padding:0 !important; break-after:page; page-break-after:always;}"
            + ".quote-page:last-child{break-after:auto; page-break-after:auto;}"
            + ".quote-sheet{border:none !important; border-radius:0 !important; box-shadow:none !important; margin:0 auto !important;}"
            + ".cs-hide-print-body-outline{border:none !important; outline:none !important; box-shadow:none !important; background:transparent !important;}"
            + "#quoteBodyEditor{border:none !important; outline:none !important; box-shadow:none !important; background:transparent !important; min-height:0 !important; padding:0 !important; margin:0 !important;}"
            + "}"
            + "</style>"
        )
        body_editor_html = (
            "<div id='quoteBodyEditor' contenteditable='true' spellcheck='true'>{{body}}</div>"
            if can_sales_edit
            else "<div id='quoteBodyEditor' contenteditable='false' spellcheck='false'>{{body}}</div>"
        )
        layout_shell_html = str(base_layout_html or "").strip()
        if "{{body}}" in layout_shell_html.lower():
            layout_shell_html = re.sub(r"\{\{\s*body\s*\}\}", body_editor_html, layout_shell_html, flags=re.IGNORECASE)
        else:
            layout_shell_html = layout_shell_html + body_editor_html
        source = (
            "<!doctype html><html><head><meta charset='utf-8'>"
            + preview_guard_css
            + ("\n".join(template_heads) if template_heads else "")
            + "</head><body><div class='quote-pages'><div class='quote-page'><div class='quote-sheet'>"
            + layout_shell_html
            + "</div></div></div>"
            + "<script>"
            + "(()=>{"
            + "let _pgTimer=null;"
            + "function repaginate(){"
            + "const pagesRoot=document.querySelector('.quote-pages');"
            + "if(!pagesRoot){return;}"
            + "const firstPage=pagesRoot.querySelector('.quote-page:not(.quote-page-clone)');"
            + "if(!firstPage){return;}"
            + "const firstSheet=firstPage.querySelector('.quote-sheet');"
            + "if(!firstSheet){return;}"
            + "pagesRoot.querySelectorAll('.quote-page.quote-page-clone').forEach(n=>n.remove());"
            + "const h=Math.max(1, Math.round(firstSheet.clientHeight||firstSheet.offsetHeight||0));"
            + "const sh=Math.max(h, Math.round(firstSheet.scrollHeight||0));"
            + "const overflow=Math.max(0, sh - h);"
            + "const fs=parseFloat((window.getComputedStyle(firstSheet).fontSize||'16').replace('px',''))||16;"
            + "const threshold=Math.max(16, Math.round(fs*1.2));"
            + "const count=(overflow<=threshold)?1:(1+Math.ceil((overflow-threshold)/h));"
            + "for(let i=1;i<count;i++){"
            + "const page=document.createElement('div');"
            + "page.className='quote-page quote-page-clone';"
            + "const sheet=firstSheet.cloneNode(true);"
            + "sheet.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));"
            + "sheet.querySelectorAll('[contenteditable=\"true\"]').forEach(el=>{el.setAttribute('contenteditable','false');});"
            + "sheet.querySelectorAll('input,textarea,select,button').forEach(el=>{el.setAttribute('disabled','disabled');});"
            + "const shift=document.createElement('div');"
            + "shift.style.position='relative';"
            + "shift.style.transform='translateY(-'+String(i*h)+'px)';"
            + "shift.style.pointerEvents='none';"
            + "while(sheet.firstChild){shift.appendChild(sheet.firstChild);}"
            + "sheet.appendChild(shift);"
            + "page.appendChild(sheet);"
            + "pagesRoot.appendChild(page);"
            + "}"
            + "}"
            + "function queueRepaginate(){"
            + "if(_pgTimer){clearTimeout(_pgTimer);} _pgTimer=setTimeout(repaginate, 35);"
            + "}"
            + "function ins(html){"
            + "const el=document.getElementById('quoteBodyEditor');"
            + "if(!el){return false;}"
            + "el.focus();"
            + "try{document.execCommand('insertHTML', false, String(html||'')); queueRepaginate(); return true;}catch(_e){}"
            + "return false;"
            + "}"
            + "window.csInsertHtmlAtCursor = ins;"
            + "window.csRepaginateQuote = queueRepaginate;"
            + "window.csPreparePrintBody = function(){"
            + "const ed=document.getElementById('quoteBodyEditor');"
            + "if(!ed){return;}"
            + "let p=ed.parentElement;"
            + "while(p && p!==document.body){"
            + "try{const st=window.getComputedStyle(p);"
            + "const b=(st&&st.borderStyle)?String(st.borderStyle):'';"
            + "if(b.toLowerCase().indexOf('dashed')>=0){p.classList.add('cs-hide-print-body-outline');}"
            + "}catch(_e){}"
            + "p=p.parentElement;"
            + "}"
            + "};"
            + "const ed=document.getElementById('quoteBodyEditor');"
            + "if(ed){"
            + "ed.addEventListener('dragover', function(ev){ev.preventDefault();});"
            + "ed.addEventListener('drop', function(ev){"
            + "ev.preventDefault();"
            + "const dt=ev.dataTransfer;"
            + "const h=(dt&&dt.getData)?(dt.getData('text/html')||dt.getData('text/plain')||''):'';"
            + "if(h){ins(h);}"
            + "});"
            + "ed.addEventListener('input', queueRepaginate);"
            + "ed.addEventListener('keyup', queueRepaginate);"
            + "}"
            + "window.addEventListener('resize', queueRepaginate);"
            + "queueRepaginate();"
            + "})();"
            + "</script>"
            + "</body></html>"
        )
        sales_payload = self._project_sales_payload(raw)
        body_seed = str(sales_payload.get("quoteBody") or "").strip()
        body_seed_html = str(sales_payload.get("quoteBodyHtml") or "").strip()
        company_body_default_html = str((self._company or {}).get("quoteTemplateBodyDefaultHtml") or "").strip()
        def _looks_like_full_layout_payload(txt: str) -> bool:
            s = str(txt or "").strip().lower()
            if not s:
                return False
            markers = (
                "{{body}}",
                "&#123;&#123;body&#125;&#125;",
                "&lcub;&lcub;body&rcub;&rcub;",
                "data-cs-container-id",
                "cs_container_start",
                "quote-sheet",
                "<!doctype html",
                "<html",
            )
            return any(m in s for m in markers)
        if _looks_like_full_layout_payload(body_seed_html):
            body_seed_html = ""
            body_seed = ""
        if _looks_like_full_layout_payload(company_body_default_html):
            company_body_default_html = ""
        quote_extras_rows = self._company_quote_extras_rows() if hasattr(self, "_company_quote_extras_rows") else []
        selected_quote_extras_raw = sales_payload.get("quoteExtrasIncluded")
        if isinstance(selected_quote_extras_raw, list):
            selected_quote_extras = {" ".join(str(v or "").strip().lower().split()) for v in selected_quote_extras_raw}
        else:
            selected_quote_extras = set()
        if not body_seed_html:
            body_seed_html = html.escape(body_seed).replace("\n", "<br>")
        if not body_seed_html:
            body_seed_html = company_body_default_html
        if not body_seed_html:
            # Keep Body editor empty by default if no company body template exists.
            body_seed_html = "<p><br></p>"
        rendered = self._render_quote_template_html(source, raw, body_seed_html, body_is_html=True)
        dlg = QDialog(self)
        dlg.setWindowTitle(f"Quote - {str(raw.get('name') or 'Project')}")
        dlg.resize(1100, 760)
        lay = QVBoxLayout(dlg)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(8)
        body_state = {"html": body_seed_html}

        top_row = QHBoxLayout()
        top_row.setSpacing(8)
        top_row.addStretch(1)
        b_btn = QToolButton()
        b_btn.setText("B")
        b_btn.setFixedSize(28, 24)
        b_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:7px; font-weight:900; } QToolButton:hover { background:#E8EBF1; }")
        i_btn = QToolButton()
        i_btn.setText("I")
        i_btn.setFixedSize(28, 24)
        i_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:7px; font-style:italic; font-weight:700; } QToolButton:hover { background:#E8EBF1; }")
        u_btn = QToolButton()
        u_btn.setText("U")
        u_btn.setFixedSize(28, 24)
        u_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:7px; text-decoration:underline; font-weight:700; } QToolButton:hover { background:#E8EBF1; }")
        top_row.addWidget(b_btn)
        top_row.addWidget(i_btn)
        top_row.addWidget(u_btn)
        b_btn.setEnabled(bool(can_sales_edit))
        i_btn.setEnabled(bool(can_sales_edit))
        u_btn.setEnabled(bool(can_sales_edit))
        print_btn = QPushButton("Print")
        print_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        print_btn.setStyleSheet(
            "QPushButton { background:#E8F0FF; color:#1F4FBF; border:1px solid #BFD3FF; border-radius:9px; padding:7px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#DCE7FF; }"
        )
        export_pdf_btn = QPushButton("Export PDF")
        export_pdf_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        export_pdf_btn.setStyleSheet(
            "QPushButton { background:#EEF1F6; color:#44556D; border:1px solid #DCE3EE; border-radius:9px; padding:7px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#E3E8F0; }"
        )
        top_row.addWidget(export_pdf_btn, 0, Qt.AlignmentFlag.AlignRight)
        top_row.addWidget(print_btn, 0, Qt.AlignmentFlag.AlignRight)
        lay.addLayout(top_row)
        content_row = QHBoxLayout()
        content_row.setContentsMargins(0, 0, 0, 0)
        content_row.setSpacing(10)

        preview_host = QWidget()
        preview_host_lay = QVBoxLayout(preview_host)
        preview_host_lay.setContentsMargins(0, 0, 0, 0)
        preview_host_lay.setSpacing(0)

        extras_card = QFrame()
        extras_card.setFixedWidth(340)
        extras_card.setStyleSheet(
            "QFrame { background:#F3F4F6; border:1px solid #E5E7EB; border-radius:10px; }"
        )
        extras_lay = QVBoxLayout(extras_card)
        extras_lay.setContentsMargins(12, 12, 12, 12)
        extras_lay.setSpacing(8)
        extras_title = QLabel("Quote Extras")
        extras_title.setStyleSheet("QLabel { color:#374151; font-size:12px; font-weight:800; }")
        extras_lay.addWidget(extras_title)
        extras_help = QLabel("Tick extras to include them in this quote.")
        extras_help.setWordWrap(True)
        extras_help.setStyleSheet("QLabel { color:#6B7280; font-size:11px; }")
        extras_lay.addWidget(extras_help)
        extras_scroll = QScrollArea()
        extras_scroll.setWidgetResizable(True)
        extras_scroll.setFrameShape(QFrame.Shape.NoFrame)
        extras_scroll.setStyleSheet("QScrollArea { background: transparent; border:none; }")
        extras_list_host = QWidget()
        extras_list_lay = QVBoxLayout(extras_list_host)
        extras_list_lay.setContentsMargins(0, 0, 0, 0)
        extras_list_lay.setSpacing(8)
        extras_scroll.setWidget(extras_list_host)
        extras_lay.addWidget(extras_scroll, 1)

        quote_extra_checks: list[QCheckBox] = []
        shown_count = 0
        for row in quote_extras_rows:
            if not isinstance(row, dict):
                continue
            extra_name = str(row.get("name") or "").strip()
            if not extra_name:
                continue
            nk = " ".join(extra_name.lower().split())
            cb = QCheckBox(extra_name)
            cb.setProperty("extraName", extra_name)
            cb.setProperty("extraKey", nk)
            cb.setChecked(nk in selected_quote_extras)
            cb.setCursor(Qt.CursorShape.PointingHandCursor)
            cb.setEnabled(bool(can_sales_edit))
            cb.setStyleSheet(
                "QCheckBox { color:#1F2937; font-size:12px; font-weight:600; spacing:7px; }"
                f"QCheckBox::indicator:checked {{ background:{quote_theme}; border:1px solid {quote_theme}; border-radius:3px; }}"
                "QCheckBox::indicator:unchecked { background:#FFFFFF; border:1px solid #A8B4C7; border-radius:3px; }"
            )
            extras_list_lay.addWidget(cb)
            quote_extra_checks.append(cb)
            shown_count += 1

        if shown_count == 0:
            empty = QLabel("No quote extras configured in Company Settings.")
            empty.setWordWrap(True)
            empty.setStyleSheet("QLabel { color:#6B7280; font-size:12px; }")
            extras_list_lay.addWidget(empty)
        extras_list_lay.addStretch(1)

        web_view = None
        try:
            from PySide6.QtWebEngineWidgets import QWebEngineView  # type: ignore
            web_view = QWebEngineView()
            web_view.setStyleSheet("QWidget { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:10px; }")
            web_view.setHtml(rendered, QUrl())
            preview_host_lay.addWidget(web_view, 1)
        except Exception:
            web_view = None

        if web_view is None:
            view = QTextEdit()
            view.setReadOnly(True)
            view.setStyleSheet("QTextEdit { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:10px; }")
            view.setHtml(rendered)
            preview_host_lay.addWidget(view, 1)
        else:
            view = None
        content_row.addWidget(preview_host, 1)
        content_row.addWidget(extras_card, 0, Qt.AlignmentFlag.AlignTop)
        lay.addLayout(content_row, 1)

        def _set_body_html_in_web(html_fragment: str) -> None:
            if web_view is None:
                return
            js = (
                "(()=>{const el=document.getElementById('quoteBodyEditor');"
                "if(!el){return;} el.innerHTML = %s;"
                "if(window.csRepaginateQuote){window.csRepaginateQuote();}"
                "})();"
            ) % json.dumps(str(html_fragment or ""))
            web_view.page().runJavaScript(js)

        def _get_body_html_from_web(done):
            if web_view is None:
                done(str(body_state.get("html") or ""))
                return
            js = "(()=>{const el=document.getElementById('quoteBodyEditor'); return el ? el.innerHTML : '';})()"
            web_view.page().runJavaScript(js, lambda v: done(str(v or "")))

        def _set_editor_body_html(html_fragment: str) -> None:
            body_state["html"] = str(html_fragment or "")
            if web_view is not None:
                _set_body_html_in_web(body_state["html"])
            else:
                _update_text_fallback()

        def _selected_quote_extras_from_checks() -> list[str]:
            out: list[str] = []
            for cb in quote_extra_checks:
                if not isinstance(cb, QCheckBox):
                    continue
                if not cb.isChecked():
                    continue
                nm = str(cb.property("extraName") or cb.text() or "").strip()
                if nm:
                    out.append(nm)
            return out

        def _refresh_quote_for_target(target_raw: dict, body_html_now: str) -> None:
            body_state["html"] = str(body_html_now or "")
            html_out = self._render_quote_template_html(source, target_raw, str(body_state.get("html") or ""), body_is_html=True)
            if web_view is not None:
                web_view.setHtml(html_out, QUrl())
            elif view is not None:
                view.setHtml(html_out)

        def _save_quote_extras_from_checks() -> None:
            if not can_sales_edit:
                return
            pid = str(getattr(dlg, "_cs_project_id", "") or "").strip()
            target = None
            for row2 in (self._projects_all or []):
                if isinstance(row2, dict) and str(row2.get("id") or "").strip() == pid:
                    target = row2
                    break
            if not isinstance(target, dict):
                target = raw
            extras_now = _selected_quote_extras_from_checks()
            if not self._save_project_sales_payload(target, {"quoteExtrasIncluded": extras_now}):
                return
            updated = None
            for row2 in (self._projects_all or []):
                if isinstance(row2, dict) and str(row2.get("id") or "").strip() == pid:
                    updated = row2
                    break
            if not isinstance(updated, dict):
                updated = target
            _get_body_html_from_web(lambda body_now: _refresh_quote_for_target(updated, body_now))
            try:
                self._refresh_sales_quote_extras_panel(True, updated)
                self._refresh_sales_quote_extras_panel(False, updated)
            except Exception:
                pass

        for cb in quote_extra_checks:
            cb.toggled.connect(lambda _=False: _save_quote_extras_from_checks())

        def _update_text_fallback():
            if view is None:
                return
            html_out = self._render_quote_template_html(source, raw, str(body_state.get("html") or ""), body_is_html=True)
            view.setHtml(html_out)

        def _apply_exec_command(cmd: str) -> None:
            if web_view is not None:
                web_view.page().runJavaScript(f"document.execCommand('{cmd}', false, null);")

        b_btn.clicked.connect(lambda: _apply_exec_command("bold"))
        i_btn.clicked.connect(lambda: _apply_exec_command("italic"))
        u_btn.clicked.connect(lambda: _apply_exec_command("underline"))

        def _print_quote() -> None:
            def _with_body_and_print(body_html_now: str):
                body_state["html"] = str(body_html_now or "")
                try:
                    if web_view is not None:
                        _set_body_html_in_web(body_state["html"])
                        try:
                            from PySide6.QtPrintSupport import QPrinter, QPrintDialog  # type: ignore
                            from PySide6.QtGui import QPageSize  # type: ignore
                            printer = QPrinter(QPrinter.PrinterMode.HighResolution)
                            page_key = str(page_size or "A4").upper().strip()
                            size_map = {
                                "A1": QPageSize.PageSizeId.A1,
                                "A2": QPageSize.PageSizeId.A2,
                                "A3": QPageSize.PageSizeId.A3,
                                "A4": QPageSize.PageSizeId.A4,
                            }
                            printer.setPageSize(QPageSize(size_map.get(page_key, QPageSize.PageSizeId.A4)))
                            printer.setFullPage(False)
                            dlg_print = QPrintDialog(printer, dlg)
                            dlg_print.setWindowTitle("Print Quote")
                            if dlg_print.exec() != QDialog.DialogCode.Accepted:
                                return

                            def _print_pdf_pages_to_printer(pdf_path: str) -> None:
                                from PySide6.QtPdf import QPdfDocument  # type: ignore
                                pdf = QPdfDocument(dlg)
                                err = pdf.load(str(pdf_path or ""))
                                if err != QPdfDocument.Error.None_:
                                    raise RuntimeError(f"PDF load failed: {err}")
                                page_count = int(pdf.pageCount() or 0)
                                if page_count <= 0:
                                    raise RuntimeError("PDF has no pages")
                                painter = QPainter(printer)
                                try:
                                    page_rect = printer.pageRect(QPrinter.Unit.DevicePixel)
                                    pw = max(1, int(page_rect.width()))
                                    ph = max(1, int(page_rect.height()))
                                    for pi in range(page_count):
                                        img = pdf.render(pi, QSize(pw, ph))
                                        if img.isNull():
                                            continue
                                        iw = max(1, int(img.width()))
                                        ih = max(1, int(img.height()))
                                        scale = min(float(pw) / float(iw), float(ph) / float(ih))
                                        dw = float(iw) * scale
                                        dh = float(ih) * scale
                                        x = float(page_rect.x()) + (float(pw) - dw) / 2.0
                                        y = float(page_rect.y()) + (float(ph) - dh) / 2.0
                                        painter.drawImage(QRectF(x, y, dw, dh), img)
                                        if pi < page_count - 1:
                                            printer.newPage()
                                finally:
                                    painter.end()

                            temp_pdf = os.path.join(
                                tempfile.gettempdir(),
                                f"cutsmart_quote_print_{int(time.time() * 1000)}.pdf",
                            )
                            done_state = {"done": False}

                            def _fallback_print_html() -> None:
                                html_out = self._render_quote_template_html(
                                    source,
                                    raw,
                                    str(body_state.get("html") or ""),
                                    body_is_html=True,
                                )
                                doc = QTextDocument()
                                doc.setHtml(html_out)
                                doc.print_(printer)

                            def _on_pdf_finished(path_done: str = "", ok: bool = True):
                                if done_state.get("done"):
                                    return
                                done_state["done"] = True
                                try:
                                    if hasattr(web_view.page(), "pdfPrintingFinished"):
                                        try:
                                            web_view.page().pdfPrintingFinished.disconnect(_on_pdf_finished)
                                        except Exception:
                                            pass
                                except Exception:
                                    pass
                                try:
                                    use_path = str(path_done or temp_pdf)
                                    if (not ok) or (not Path(use_path).exists()):
                                        raise RuntimeError("PDF generation failed")
                                    _print_pdf_pages_to_printer(use_path)
                                except Exception:
                                    _fallback_print_html()
                                finally:
                                    try:
                                        if Path(temp_pdf).exists():
                                            Path(temp_pdf).unlink()
                                    except Exception:
                                        pass

                            try:
                                web_view.page().runJavaScript(
                                    "if(window.csPreparePrintBody){window.csPreparePrintBody();}"
                                    "if(window.csRepaginateQuote){window.csRepaginateQuote();}"
                                )
                            except Exception:
                                pass
                            try:
                                if hasattr(web_view.page(), "pdfPrintingFinished"):
                                    web_view.page().pdfPrintingFinished.connect(_on_pdf_finished)
                            except Exception:
                                pass

                            QTimer.singleShot(180, lambda: web_view.page().printToPdf(temp_pdf))
                            QTimer.singleShot(2800, lambda: _on_pdf_finished(temp_pdf, Path(temp_pdf).exists()))
                            return
                        except Exception:
                            pass

                    html_out = self._render_quote_template_html(
                        source,
                        raw,
                        str(body_state.get("html") or ""),
                        body_is_html=True,
                    )
                    print_override_css = "<style>.quote-sheet:focus{outline:none;box-shadow:none;}</style>"
                    lower = html_out.lower()
                    head_end = lower.find("</head>")
                    if head_end >= 0:
                        html_out = html_out[:head_end] + print_override_css + html_out[head_end:]
                    else:
                        html_out = "<html><head>" + print_override_css + "</head><body>" + html_out + "</body></html>"

                    from PySide6.QtPrintSupport import QPrinter, QPrintDialog  # type: ignore
                    from PySide6.QtGui import QPageSize  # type: ignore
                    printer = QPrinter(QPrinter.PrinterMode.HighResolution)
                    page_key = str(page_size or "A4").upper().strip()
                    size_map = {
                        "A1": QPageSize.PageSizeId.A1,
                        "A2": QPageSize.PageSizeId.A2,
                        "A3": QPageSize.PageSizeId.A3,
                        "A4": QPageSize.PageSizeId.A4,
                    }
                    printer.setPageSize(QPageSize(size_map.get(page_key, QPageSize.PageSizeId.A4)))
                    printer.setFullPage(False)
                    dlg_print = QPrintDialog(printer, dlg)
                    dlg_print.setWindowTitle("Print Quote")
                    if dlg_print.exec() != QDialog.DialogCode.Accepted:
                        return
                    doc = QTextDocument()
                    doc.setHtml(html_out)
                    doc.print_(printer)
                except Exception as exc:
                    QMessageBox.warning(dlg, "Print", f"Could not open print dialog:\n{exc}")

            _get_body_html_from_web(_with_body_and_print)

        def _export_quote_pdf() -> None:
            def _with_body_and_export(body_html_now: str):
                body_state["html"] = str(body_html_now or "")
                project_name = str(raw.get("name") or "Quote").strip() or "Quote"
                suggested = re.sub(r"[\\\\/:*?\"<>|]+", "_", project_name) + ".pdf"
                out_path, _ = QFileDialog.getSaveFileName(
                    dlg,
                    "Export Quote PDF",
                    suggested,
                    "PDF Files (*.pdf)",
                )
                out_path = str(out_path or "").strip()
                if not out_path:
                    return
                if not out_path.lower().endswith(".pdf"):
                    out_path = out_path + ".pdf"
                try:
                    if web_view is not None:
                        page = web_view.page()
                        done_state = {"done": False}

                        def _finish(path_done: str = "", ok: bool = True):
                            if done_state["done"]:
                                return
                            done_state["done"] = True
                            try:
                                if hasattr(page, "pdfPrintingFinished"):
                                    try:
                                        page.pdfPrintingFinished.disconnect(_finish)
                                    except Exception:
                                        pass
                            except Exception:
                                pass
                            if ok:
                                QMessageBox.information(dlg, "Export PDF", f"Quote exported to:\n{out_path}")
                            else:
                                QMessageBox.warning(dlg, "Export PDF", "Could not export PDF.")

                        try:
                            if hasattr(page, "pdfPrintingFinished"):
                                page.pdfPrintingFinished.connect(_finish)
                        except Exception:
                            pass

                        try:
                            page.runJavaScript(
                                "if(window.csPreparePrintBody){window.csPreparePrintBody();}"
                                "if(window.csRepaginateQuote){window.csRepaginateQuote();}"
                            )
                        except Exception:
                            pass

                        def _do_web_export():
                            try:
                                page.printToPdf(out_path)
                            except Exception:
                                _finish(out_path, False)

                        QTimer.singleShot(140, _do_web_export)
                        QTimer.singleShot(2200, lambda: _finish(out_path, Path(out_path).exists()))
                        return

                    html_out = self._render_quote_template_html(
                        source,
                        raw,
                        str(body_state.get("html") or ""),
                        body_is_html=True,
                    )
                    from PySide6.QtPrintSupport import QPrinter  # type: ignore
                    from PySide6.QtGui import QPageSize  # type: ignore
                    printer = QPrinter(QPrinter.PrinterMode.HighResolution)
                    printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
                    printer.setOutputFileName(out_path)
                    printer.setPageSize(QPageSize(QPageSize.PageSizeId.A4))
                    printer.setFullPage(False)
                    doc = QTextDocument()
                    doc.setHtml(html_out)
                    doc.print_(printer)
                    QMessageBox.information(dlg, "Export PDF", f"Quote exported to:\n{out_path}")
                except Exception as exc:
                    QMessageBox.warning(dlg, "Export PDF", f"Could not export PDF:\n{exc}")

            _get_body_html_from_web(_with_body_and_export)

        print_btn.clicked.connect(_print_quote)
        export_pdf_btn.clicked.connect(_export_quote_pdf)
        close_btn = QPushButton("Close")
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.clicked.connect(dlg.close)
        close_btn.setStyleSheet(
            "QPushButton { background:#EEF1F6; color:#44556D; border:none; border-radius:9px; padding:8px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#E3E8F0; }"
        )
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(close_btn)
        lay.addLayout(row)
        dlg._cs_project_id = str(raw.get("id") or "").strip()
        def _refresh_open_quote_dialog():
            pid = str(getattr(dlg, "_cs_project_id", "") or "").strip()
            target = None
            for row2 in (self._projects_all or []):
                if isinstance(row2, dict) and str(row2.get("id") or "").strip() == pid:
                    target = row2
                    break
            if not isinstance(target, dict):
                target = raw
            def _rerender_with_body(body_html_now: str):
                _refresh_quote_for_target(target, body_html_now)
            _get_body_html_from_web(_rerender_with_body)
        dlg._cs_refresh_quote = _refresh_open_quote_dialog
        def _refresh_open_quote_dialog_with_raw(target_raw: dict | None = None):
            target = target_raw if isinstance(target_raw, dict) else None
            if not isinstance(target, dict):
                pid = str(getattr(dlg, "_cs_project_id", "") or "").strip()
                for row2 in (self._projects_all or []):
                    if isinstance(row2, dict) and str(row2.get("id") or "").strip() == pid:
                        target = row2
                        break
            if not isinstance(target, dict):
                target = raw
            def _rerender_with_body(body_html_now: str):
                _refresh_quote_for_target(target, body_html_now)
            _get_body_html_from_web(_rerender_with_body)
        dlg._cs_refresh_quote_with_raw = _refresh_open_quote_dialog_with_raw
        self._open_quote_dialogs.append(dlg)
        project_id = str(raw.get("id") or "").strip()

        def _on_close(_=0, d=dlg, pid=project_id, seed_raw=raw):
            def _save_body(body_html_now: str):
                if not can_sales_edit:
                    self._open_quote_dialogs = [x for x in self._open_quote_dialogs if x is not d]
                    return
                try:
                    body_state["html"] = str(body_html_now or "")
                    doc = QTextDocument()
                    doc.setHtml(str(body_state.get("html") or ""))
                    body_plain = doc.toPlainText()
                    target = self._selected_project()
                    if not isinstance(target, dict) or str(target.get("id") or "").strip() != pid:
                        target = seed_raw
                    self._save_project_sales_payload(
                        target,
                        {
                            "quoteBody": body_plain,
                            "quoteBodyHtml": str(body_state.get("html") or ""),
                            "quoteLayoutVersionUsed": int(active_layout_version.get("v") or 1),
                        },
                    )
                except Exception:
                    pass
                self._open_quote_dialogs = [x for x in self._open_quote_dialogs if x is not d]

            _get_body_html_from_web(_save_body)

        dlg.finished.connect(_on_close)
        dlg.showMaximized()
        dlg.raise_()
        dlg.activateWindow()

    def _refresh_projects(self, silent: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        self._ensure_realtime_jobs_listener()
        self._invalidate_access_caches()
        try:
            if hasattr(self.app.company, "purge_deleted_jobs"):
                try:
                    self.app.company.purge_deleted_jobs(company_id, self._deleted_retention_days())
                except Exception:
                    pass
            all_rows = list(self.app.company.list_jobs(company_id) or [])
            self._projects_all = self._apply_project_visibility_filter(all_rows)
            if hasattr(self.app.company, "list_deleted_jobs"):
                self._projects_deleted = list(self.app.company.list_deleted_jobs(company_id) or [])
            else:
                self._projects_deleted = []
            self._stats["jobs"] = len(self._projects_all)
            self._refresh_projects_status_options()
            self._apply_projects_filters()
            self._sync_dashboard_stats()
            self._refresh_recently_deleted_page()
        except Exception as exc:
            if not silent:
                QMessageBox.critical(self, "Projects refresh failed", str(exc))

    def _stop_realtime_jobs_listener(self) -> None:
        token = str(getattr(self, "_realtime_jobs_token", "") or "").strip()
        if not token:
            self._realtime_jobs_company_id = ""
            return
        try:
            realtime = getattr(self.app, "realtime", None)
            if realtime and hasattr(realtime, "unlisten"):
                realtime.unlisten(token)
        except Exception:
            pass
        self._realtime_jobs_token = None
        self._realtime_jobs_company_id = ""

    def _ensure_realtime_jobs_listener(self) -> None:
        company_id = str(getattr(self.router.session, "company_id", "") or "").strip()
        if not company_id:
            self._stop_realtime_jobs_listener()
            return
        current_company = str(getattr(self, "_realtime_jobs_company_id", "") or "").strip()
        token = str(getattr(self, "_realtime_jobs_token", "") or "").strip()
        if token and current_company == company_id:
            return
        self._stop_realtime_jobs_listener()
        realtime = getattr(self.app, "realtime", None)
        if not realtime or not hasattr(realtime, "listen_jobs"):
            return

        def _on_jobs_snapshot(items):
            rows = list(items or [])

            def _apply_rows() -> None:
                try:
                    self._apply_realtime_jobs_snapshot(rows)
                except Exception:
                    pass

            # Firestore watch callbacks can run off the Qt GUI thread.
            QTimer.singleShot(0, _apply_rows)

        try:
            token = realtime.listen_jobs(company_id, _on_jobs_snapshot)
        except Exception:
            return
        self._realtime_jobs_token = str(token or "").strip() or None
        self._realtime_jobs_company_id = company_id

    def _apply_realtime_jobs_snapshot(self, rows: list[dict]) -> None:
        all_rows = [dict(r) for r in (rows or []) if isinstance(r, dict)]
        visible_rows = [r for r in all_rows if not bool(r.get("isDeleted", False))]
        deleted_rows = [r for r in all_rows if bool(r.get("isDeleted", False))]
        self._projects_all = self._apply_project_visibility_filter(visible_rows)
        self._projects_deleted = deleted_rows
        self._stats["jobs"] = len(self._projects_all)
        self._refresh_projects_status_options()
        self._apply_projects_filters()
        self._sync_dashboard_stats()
        self._refresh_recently_deleted_page()
        self._sync_open_cutlist_dialogs_from_projects(self._projects_all)

    def _sync_open_cutlist_dialogs_from_projects(self, rows: list[dict]) -> None:
        by_id: dict[str, dict] = {}
        for row in (rows or []):
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id") or "").strip()
            if rid:
                by_id[rid] = row

        for dlg in list(self._open_cutlist_dialogs or []):
            if not isinstance(dlg, CutlistDialog):
                continue
            rid = str(dlg.property("projectId") or "").strip()
            raw = by_id.get(rid)
            if not raw:
                continue
            try:
                payload = self._project_cutlist_payload(raw)
                dlg.apply_external_payload(payload)
            except Exception:
                pass

        for dlg in list(self._open_initial_measure_dialogs or []):
            if not isinstance(dlg, CutlistDialog):
                continue
            rid = str(dlg.property("projectId") or "").strip()
            raw = by_id.get(rid)
            if not raw:
                continue
            try:
                sales = self._project_sales_payload(raw)
                payload = sales.get("initialMeasureCutlist") if isinstance(sales, dict) else {}
                dlg.apply_external_payload(payload if isinstance(payload, dict) else {})
            except Exception:
                pass

    def _refresh_projects_status_options(self) -> None:
        if self._projects_status_filter is None:
            return
        current = self._projects_status_filter.currentText()
        statuses = sorted({str((row or {}).get("status") or "New").strip() for row in self._projects_all if row})

        self._projects_status_filter.blockSignals(True)
        self._projects_status_filter.clear()
        self._projects_status_filter.addItem("All statuses")
        for status in statuses:
            if status:
                self._projects_status_filter.addItem(status)
        wanted = current if current and self._projects_status_filter.findText(current) >= 0 else "All statuses"
        self._projects_status_filter.setCurrentText(wanted)
        self._projects_status_filter.blockSignals(False)

    def _apply_projects_filters(self, refresh_details: bool = True) -> None:
        if self._projects_table is None:
            return

        term = (self._projects_search.text().strip().lower() if self._projects_search else "")
        selected_status = (self._projects_status_filter.currentText().strip().lower() if self._projects_status_filter else "all statuses")

        rows = []
        for row in self._projects_all:
            name = str((row or {}).get("name") or "")
            client = str((row or {}).get("client") or (row or {}).get("clientName") or "")
            status = str((row or {}).get("status") or "New")
            created = str((row or {}).get("createdAtIso") or "")
            updated = str((row or {}).get("updatedAtIso") or "")

            if selected_status != "all statuses" and status.strip().lower() != selected_status:
                continue

            haystack = f"{name} {client} {status}".lower()
            if term and term not in haystack:
                continue

            rows.append(
                {
                    "name": name,
                    "client": client,
                    "status": status,
                    "created": created,
                    "updated": updated,
                    "raw": row,
                }
            )

        self._projects_table.blockSignals(True)
        self._projects_table.setRowCount(len(rows))
        for idx, row in enumerate(rows):
            self._set_table_item(idx, 0, row["name"] or "Untitled")
            self._set_table_item(idx, 1, row["client"] or "-")
            self._set_table_item(idx, 2, row["status"])
            status_item = self._projects_table.item(idx, 2)
            if status_item is not None:
                bg, fg = self._status_colors(row["status"])
                status_item.setBackground(QColor(bg))
                status_item.setForeground(QBrush(QColor(fg)))
            self._set_table_item(idx, 3, self._short_date_with_time(row["created"]))
            self._set_table_item(idx, 4, self._short_date_with_time(row["updated"]))
            for col in range(5):
                self._projects_table.item(idx, col).setData(Qt.ItemDataRole.UserRole, row["raw"])

        if not rows:
            self._set_table_empty_state(self._projects_table, 5, "No projects found")
            self._projects_table.blockSignals(False)
            self._selected_project_id = None
            self._populate_project_details(None)
            return

        selected_row = None
        if self._selected_project_id:
            for idx in range(len(rows)):
                raw = self._projects_table.item(idx, 0).data(Qt.ItemDataRole.UserRole)
                rid = str((raw or {}).get("id") or "").strip()
                if rid == self._selected_project_id:
                    selected_row = idx
                    break
        if selected_row is None:
            selected_row = 0

        self._projects_table.selectRow(selected_row)
        self._projects_table.blockSignals(False)
        if refresh_details:
            self._on_project_selection_changed()
    def _set_table_item(self, row: int, col: int, text: str) -> None:
        item = QTableWidgetItem(text)
        item.setFlags(Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable)
        self._projects_table.setItem(row, col, item)

    def _on_project_selection_changed(self) -> None:
        if not self._projects_table:
            return
        row = self._projects_table.currentRow()
        if row < 0:
            self._populate_project_details(None)
            return
        raw = self._projects_table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        if not isinstance(raw, dict):
            self._populate_project_details(None)
            return
        self._selected_project_id = str(raw.get("id") or "").strip() or None
        fresh = self._reload_project_row_by_id(self._selected_project_id)
        active = dict(fresh or raw)
        self._populate_project_details(active)

    def _reload_project_row_by_id(self, project_id: str | None) -> dict | None:
        pid = str(project_id or "").strip()
        company_id = getattr(self.router.session, "company_id", None)
        if not pid or not company_id:
            return None
        try:
            latest_rows = list(self.app.company.list_jobs(company_id) or [])
        except Exception:
            return None
        if not latest_rows:
            return None
        latest_rows = self._apply_project_visibility_filter(latest_rows)
        if not latest_rows:
            self._projects_all = []
            self._stats["jobs"] = 0
            return None
        self._projects_all = list(latest_rows)
        self._stats["jobs"] = len(self._projects_all)
        for row in latest_rows:
            if not isinstance(row, dict):
                continue
            rid = str((row or {}).get("id") or "").strip()
            if rid == pid:
                if isinstance(getattr(self, "_dashboard_detail_raw", None), dict):
                    current_id = str((self._dashboard_detail_raw or {}).get("id") or "").strip()
                    if current_id and current_id == pid:
                        self._dashboard_detail_raw = dict(row)
                return row
        return None

    def _populate_project_details(self, raw: dict | None) -> None:
        if not raw:
            if self._project_title_label:
                self._project_title_label.setText("Select a project")
            if self._project_meta_label:
                self._project_meta_label.setText("Choose a row on the left to view details.")
            if self._project_status_btn:
                self._project_status_btn.setText("-")
            for widget in [
                self._detail_client_name,
                self._detail_client_phone,
                self._detail_client_email,
                self._detail_client_region,
                self._detail_client_address,
            ]:
                if widget:
                    widget.setText("")
            if self._detail_notes:
                self._detail_notes.setPlainText("")
            self._sync_project_image_upload_buttons(None)
            self._refresh_inline_permissions(None)
            self._refresh_sales_rooms_panel(False, None)
            self._refresh_sales_job_type_panel(False, None)
            self._refresh_sales_quote_extras_panel(False, None)
            self._mount_embedded_board_settings(False, None)
            self._set_detail_enabled(False)
            return

        self._set_detail_enabled(True)
        name = str(raw.get("name") or "Untitled")
        status = str(raw.get("status") or "New")
        created = self._short_date_with_time(str(raw.get("createdAtIso") or ""))
        updated = self._short_date_with_time(str(raw.get("updatedAtIso") or ""))

        if self._project_title_label:
            self._project_title_label.setText(name)
        client_name = str(raw.get("client") or raw.get("clientName") or "-").strip() or "-"
        creator_name = self._project_creator_display_name(raw)
        if self._project_meta_label:
            self._project_meta_label.setText(
                self._project_meta_two_col_html(
                    f"Client Name: {client_name}",
                    f"Date Created: {created}",
                    f"Project Creator: {creator_name}",
                    f"Date Modified: {updated}",
                )
            )
        if self._project_status_btn:
            self._project_status_btn.setText(status)
            self._apply_status_button_style(self._project_status_btn, status)

        client = str(raw.get("client") or raw.get("clientName") or "")
        phone = str(raw.get("clientPhone") or raw.get("clientNumber") or "")
        email = str(raw.get("clientEmail") or "")
        region = str(raw.get("region") or "")
        address = str(raw.get("clientAddress") or "")
        address_combined = self._compose_address_region(address, region)
        notes = str(raw.get("notes") or "")

        if self._detail_client_name:
            self._detail_client_name.setText(client)
        if self._detail_client_phone:
            self._detail_client_phone.setText(phone)
        if self._detail_client_email:
            self._detail_client_email.setText(email)
        if self._detail_client_address:
            self._detail_client_address.setText(address_combined)
        if self._detail_notes:
            self._detail_notes.setPlainText(notes)
        self._refresh_general_images_lists(raw)
        self._sync_project_image_upload_buttons(raw)
        self._refresh_inline_permissions(raw)
        self._refresh_sales_rooms_panel(False, raw)
        self._refresh_sales_job_type_panel(False, raw)
        self._refresh_sales_quote_extras_panel(False, raw)
        self._mount_embedded_board_settings(False, raw)
        self._apply_project_tab_permissions(raw)

    def _set_detail_enabled(self, enabled: bool) -> None:
        for widget in [
            self._project_status_btn,
            self._project_delete_btn,
            *([v for v in self._project_detail_tab_buttons.values()] if isinstance(self._project_detail_tab_buttons, dict) else []),
            self._detail_client_name,
            self._detail_client_phone,
            self._detail_client_email,
            self._detail_client_region,
            self._detail_client_address,
            self._detail_notes,
            self._detail_save_client_btn,
            self._detail_save_notes_btn,
            self._detail_open_cutlist_btn,
            self._detail_open_notes_btn,
            self._detail_open_settings_btn,
            self._detail_open_permissions_btn,
            self._detail_open_board_settings_btn,
            self._detail_open_cabinet_specs_btn,
            self._detail_open_nesting_btn,
            self._detail_open_order_btn,
            self._detail_open_unlock_production_btn,
            self._detail_open_images_btn,
            self._detail_images_upload_btn,
            self._detail_images_delete_btn,
            self._detail_open_cnc_btn,
            self._detail_open_initial_measure_btn,
            self._detail_open_items_btn,
            self._detail_open_quote_btn,
            self._detail_open_specs_btn,
            self._detail_sales_rooms_add_btn,
            self._detail_change_ownership_btn,
            self._dashboard_change_ownership_btn,
            *([v for v in (self._detail_permission_combos or {}).values()] if isinstance(self._detail_permission_combos, dict) else []),
        ]:
            if widget:
                widget.setEnabled(enabled)

    def _count_unread_updates(self) -> int:
        return sum(1 for item in (self._updates_all or []) if not bool((item or {}).get("read", False)))

    def _sync_dashboard_stats(self) -> None:
        self._stats["jobs"] = len(self._projects_all or [])
        self._stats["staff"] = len(self._staff_all or [])

        try:
            uid = getattr(self.router.session, "uid", None)
            email = (getattr(self.router.session, "email", "") or "").strip().lower()
            if hasattr(self.app.company, "list_pending_invites"):
                self._stats["invites"] = len(self.app.company.list_pending_invites(uid=uid, email=email) or [])
        except Exception:
            pass

        active_count, completed_count = self._dashboard_status_counts()

        mapping = {
            "Total Projects": str(self._stats.get("jobs", 0)),
            "Active": str(active_count),
            "Completed": str(completed_count),
            "Staff Members": str(self._stats.get("staff", 0)),
        }
        for key, value in mapping.items():
            lbl = self._stat_labels.get(key)
            if lbl:
                lbl.setText(value)

        unread = self._count_unread_updates()
        updates_btn = self._nav_buttons.get("updates")
        if updates_btn:
            updates_btn.setText(f"Company Updates ({unread})" if unread > 0 else "Company Updates")

        self._sync_permission_scoped_ui()
        self._apply_dashboard_projects_view()
    def _set_table_empty_state(self, table: QTableWidget, columns: int, message: str) -> None:
        table.setRowCount(1)
        first = QTableWidgetItem(message)
        first.setFlags(Qt.ItemFlag.ItemIsEnabled)
        table.setItem(0, 0, first)
        for col in range(1, columns):
            blank = QTableWidgetItem("")
            blank.setFlags(Qt.ItemFlag.ItemIsEnabled)
            table.setItem(0, col, blank)

    def _auto_refresh_tick(self) -> None:
        current = None
        try:
            current = self.stack.currentIndex()
        except Exception:
            current = None

        self._refresh_projects(silent=True)
        if current == 1:
            self._refresh_company(silent=True)
            self._refresh_staff(silent=True)
        if current == 2:
            self._refresh_user_settings(silent=True)
        self._refresh_updates(silent=True)
        if current == 4:
            self._refresh_recently_deleted_page()
        try:
            self._refresh_project_detail_tab_styles()
            self._refresh_dashboard_detail_tab_styles()
        except Exception:
            pass

    def closeEvent(self, event) -> None:
        try:
            if self._refresh_timer:
                self._refresh_timer.stop()
        except Exception:
            pass
        try:
            self._stop_realtime_jobs_listener()
        except Exception:
            pass
        try:
            if self._production_unlock_refresh_timer:
                self._production_unlock_refresh_timer.stop()
        except Exception:
            pass
        super().closeEvent(event)

    def _schedule_production_unlock_timer_refresh(self) -> None:
        raw = self._selected_project()
        remaining = self._current_user_temp_production_remaining_seconds(raw)
        if not isinstance(remaining, int) or remaining <= 0:
            try:
                if isinstance(self._production_unlock_refresh_timer, QTimer):
                    self._production_unlock_refresh_timer.stop()
            except Exception:
                pass
            return
        # Keep timer pills live-updating without requiring tab clicks.
        interval_ms = 1000
        if not isinstance(self._production_unlock_refresh_timer, QTimer):
            self._production_unlock_refresh_timer = QTimer(self)
            self._production_unlock_refresh_timer.setSingleShot(True)
            self._production_unlock_refresh_timer.timeout.connect(self._on_production_unlock_timer_tick)
        timer = self._production_unlock_refresh_timer
        if isinstance(timer, QTimer):
            if timer.isActive():
                timer.stop()
            timer.start(int(interval_ms))

    def _is_production_tab_active(self) -> bool:
        return bool(
            str(self._project_detail_tab_key or "").strip().lower() == "production"
            or str(self._dashboard_detail_tab_key or "").strip().lower() == "production"
        )

    def _on_production_unlock_timer_tick(self) -> None:
        try:
            raw = self._selected_project()
            remaining = self._current_user_temp_production_remaining_seconds(raw)
            if not isinstance(remaining, int) or remaining <= 0:
                if self._is_production_tab_active():
                    self._mark_sticky_production_unlock(raw)
                else:
                    self._clear_sticky_production_unlock_if_expired(raw)
            self._apply_project_tab_permissions(raw)
            self._refresh_project_detail_tab_styles()
            self._refresh_dashboard_detail_tab_styles()
        except Exception:
            pass
        self._schedule_production_unlock_timer_refresh()
    def _build_placeholder_page(self, title: str, subtitle: str) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 6, 0, 0)
        layout.setSpacing(8)

        title_label = QLabel(title)
        title_label.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 24px; font-weight: 700;")
        layout.addWidget(title_label)

        subtitle_label = QLabel(subtitle)
        subtitle_label.setStyleSheet(f"color: {TEXT_MUTED}; font-size: 13px;")
        subtitle_label.setWordWrap(True)
        layout.addWidget(subtitle_label)

        layout.addStretch(1)
        return page

    def _can_view_all_deleted_projects(self) -> bool:
        return bool(self._has_company_permission("projects.view.others"))

    def _can_view_other_projects(self) -> bool:
        # Route through the unified permission resolver so Owner/full-access
        # role logic is respected here too.
        try:
            if bool(self._has_company_permission("projects.view.others")):
                return True
            # Backward-compat alias support.
            if bool(self._has_company_permission("projects.view.other")):
                return True
        except Exception:
            pass
        return False

    def _project_user_access_level(self, raw: dict | None) -> str:
        if not isinstance(raw, dict):
            return "no_access"
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid:
            return "no_access"
        if self._can_view_other_projects():
            # Admin-like users who can create under others can edit all projects.
            if bool(self._has_company_permission("projects.create.others")):
                return "edit"
            return "view"
        for key in ("createdByUid", "staffMemberUid", "creatorUid", "projectCreatorUid"):
            if str((raw or {}).get(key) or "").strip() == uid:
                return "edit"
        try:
            payload = self._load_project_settings_payload(raw)
            staff_access = self._project_permissions_staff_access(payload)
            access = str(staff_access.get(uid) or "").strip().lower()
            if access in ("view", "edit"):
                return access
        except Exception:
            pass
        return "view" if bool(self._has_company_permission("projects.view")) else "no_access"

    def _is_project_visible_to_current_user(self, raw: dict | None) -> bool:
        return str(self._project_user_access_level(raw)) in ("view", "edit")

    def _apply_project_visibility_filter(self, rows: list[dict] | None) -> list[dict]:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid:
            return []
        can_view_others = bool(self._can_view_other_projects())
        if can_view_others:
            return [dict(r) for r in (rows or []) if isinstance(r, dict)]
        can_base_view = bool(self._has_company_permission("projects.view"))
        out: list[dict] = []
        for row in (rows or []):
            if not isinstance(row, dict):
                continue
            row_uid_match = False
            for key in ("createdByUid", "staffMemberUid", "creatorUid", "projectCreatorUid"):
                if str((row or {}).get(key) or "").strip() == uid:
                    row_uid_match = True
                    break
            if row_uid_match:
                out.append(row)
                continue
            try:
                payload = self._load_project_settings_payload(row)
                staff_access = self._project_permissions_staff_access(payload)
                if str(staff_access.get(uid) or "").strip().lower() in ("view", "edit"):
                    out.append(row)
                    continue
            except Exception:
                pass
            if can_base_view:
                out.append(row)
        return out

    def _sync_permission_scoped_ui(self) -> None:
        can_create = bool(self._has_company_permission("projects.create"))
        can_company = bool(self._has_company_permission("company.settings"))
        can_updates = bool(self._has_company_permission("company.updates"))
        can_dash_cards = bool(self._has_company_permission("company.dashboard.view"))

        for btn in (self._sidebar_new_project_btn, self._projects_page_new_btn):
            if isinstance(btn, QPushButton):
                btn.setVisible(can_create)
                btn.setEnabled(can_create)

        company_btn = self._nav_buttons.get("company")
        if isinstance(company_btn, QPushButton):
            company_btn.setVisible(can_company)
        updates_btn = self._nav_buttons.get("updates")
        if isinstance(updates_btn, QPushButton):
            updates_btn.setVisible(can_updates)

        cards = getattr(self, "_dashboard_company_stats_cards", None)
        if isinstance(cards, QWidget):
            cards.setVisible(can_dash_cards)

    def _resolve_current_user_role(self, company_id: str, uid: str) -> dict:
        key = (str(company_id or "").strip(), str(uid or "").strip())
        cached = self._user_role_cache.get(key)
        if isinstance(cached, dict):
            return dict(cached)

        role_id = ""
        role_name = ""
        try:
            staff_rows = list(self._staff_all or [])
            if not staff_rows and hasattr(self.app.company, "list_staff"):
                staff_rows = list(self.app.company.list_staff(company_id) or [])
                self._staff_all = list(staff_rows)
            for row in staff_rows:
                if not isinstance(row, dict):
                    continue
                if str(row.get("uid") or "").strip() != uid:
                    continue
                role_id = str(row.get("roleId") or row.get("role") or "").strip().lower()
                role_name = str(row.get("roleName") or "").strip().lower()
                break
        except Exception:
            role_id = ""
            role_name = ""

        perms: dict = {}
        try:
            for role in (self._company.get("roles") or []):
                if not isinstance(role, dict):
                    continue
                rid = str(role.get("id") or "").strip().lower()
                rname = str(role.get("name") or "").strip().lower()
                if role_id and rid != role_id and (not role_name or rname != role_name):
                    continue
                raw_perms = role.get("permissions") or {}
                perms = raw_perms if isinstance(raw_perms, dict) else {}
                break
        except Exception:
            perms = {}

        resolved = {
            "role_id": role_id,
            "role_name": role_name,
            "is_owner": bool(role_id == "owner" or role_name == "owner"),
            "permissions": dict(perms or {}),
        }
        self._user_role_cache[key] = dict(resolved)
        return resolved

    def _has_company_permission(self, key: str) -> bool:
        company_id = getattr(self.router.session, "company_id", None)
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        perm_key = str(key or "").strip()
        if not company_id or not uid or not perm_key:
            return False
        cache_key = (str(company_id), uid, perm_key)
        if cache_key in self._permission_cache:
            return bool(self._permission_cache.get(cache_key))
        role_info = self._resolve_current_user_role(str(company_id), uid)
        if bool(role_info.get("is_owner")):
            self._permission_cache[cache_key] = True
            return True
        perms = role_info.get("permissions")
        if isinstance(perms, dict) and perm_key in perms:
            allowed = bool(perms.get(perm_key))
            self._permission_cache[cache_key] = allowed
            return allowed
        try:
            if hasattr(self.app.company, "user_has_permission"):
                allowed = bool(self.app.company.user_has_permission(company_id, uid, perm_key))
                self._permission_cache[cache_key] = allowed
                return allowed
        except Exception:
            self._permission_cache[cache_key] = False
            return False
        self._permission_cache[cache_key] = False
        return False

    def _production_temp_edit_map(self, raw: dict | None) -> dict[str, str]:
        payload = self._load_project_settings_payload(raw)
        perms_raw = payload.get("projectPermissions") or {}
        if not isinstance(perms_raw, dict):
            return {}
        source = perms_raw.get("productionTempEditors")
        if not isinstance(source, dict):
            return {}
        out: dict[str, str] = {}
        for k, v in source.items():
            uid = str(k or "").strip()
            expiry = str(v or "").strip()
            if uid and expiry:
                out[uid] = expiry
        return out

    def _has_temp_production_edit_access(self, raw: dict | None, uid: str | None = None) -> bool:
        who = str(uid or getattr(self.router.session, "uid", "") or "").strip()
        if not who:
            return False
        expiry_iso = str(self._production_temp_edit_map(raw).get(who) or "").strip()
        if not expiry_iso:
            return False
        expiry_dt = self._parse_iso_utc(expiry_iso)
        if expiry_dt is None:
            return False
        return expiry_dt > datetime.now(timezone.utc)

    def _project_tab_access(self, raw: dict | None, tab_key: str) -> tuple[bool, bool]:
        key = str(tab_key or "").strip().lower()
        access = str(self._project_user_access_level(raw))
        project_can_view = access in ("view", "edit")
        project_can_edit = access == "edit"
        if key == "sales":
            role_can_edit = bool(self._has_company_permission("sales.edit"))
            role_can_view = role_can_edit or bool(self._has_company_permission("sales.view"))
            can_view = bool(project_can_view and role_can_view)
            can_edit = bool(project_can_edit and role_can_edit)
            return can_view, can_edit
        if key == "production":
            # Two-stage model:
            # 1) Password/key unlock controls whether the Production tab is accessible.
            # 2) Project access level controls whether user is edit or view-only inside it.
            unlocked = bool(
                self._has_company_permission("production.key")
                or bool(self._has_temp_production_edit_access(raw))
                or bool(self._has_sticky_production_unlock(raw))
            )
            can_view = bool(project_can_view and unlocked)
            can_edit = bool(project_can_edit and unlocked)
            return can_view, can_edit
        return True, True

    def _project_id_value(self, raw: dict | None) -> str:
        return str((raw or {}).get("id") or "").strip() if isinstance(raw, dict) else ""

    def _has_sticky_production_unlock(self, raw: dict | None) -> bool:
        pid = self._project_id_value(raw)
        return bool(pid and pid in (self._production_sticky_unlock_projects or set()))

    def _mark_sticky_production_unlock(self, raw: dict | None) -> None:
        pid = self._project_id_value(raw)
        if not pid:
            return
        if not isinstance(self._production_sticky_unlock_projects, set):
            self._production_sticky_unlock_projects = set()
        self._production_sticky_unlock_projects.add(pid)

    def _clear_sticky_production_unlock_if_expired(self, raw: dict | None) -> None:
        pid = self._project_id_value(raw)
        if not pid or not isinstance(self._production_sticky_unlock_projects, set):
            return
        if pid not in self._production_sticky_unlock_projects:
            return
        still_temp = bool(self._has_temp_production_edit_access(raw))
        if not still_temp and (not self._has_company_permission("production.key")):
            self._production_sticky_unlock_projects.discard(pid)

    def _production_unlock_password_suffix(self) -> str:
        raw = str((self._company or {}).get("productionUnlockPasswordSuffix") or "").strip()
        return "".join(ch for ch in raw if ch.isdigit())

    def _production_unlock_duration_hours(self) -> int:
        options = self._production_unlock_duration_options() if hasattr(self, "_production_unlock_duration_options") else [("6 hours", 6)]
        valid = {int(v) for _lbl, v in options}
        try:
            hours = int((self._company or {}).get("productionUnlockDurationHours") or 6)
        except Exception:
            hours = 6
        return hours if hours in valid else 6

    def _expected_production_unlock_password(self, raw: dict | None) -> str:
        project_name = "".join(str((raw or {}).get("name") or "").strip().split())
        return f"{project_name}{self._production_unlock_password_suffix()}"

    def _open_production_unlock_prompt_for_selected_project(self) -> bool:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            QMessageBox.warning(self, "Unlock Production", "Select a project first.")
            return False
        return bool(self._open_production_unlock_password_prompt(raw))

    def _open_production_unlock_password_prompt(self, raw: dict | None) -> bool:
        if not isinstance(raw, dict):
            return False
        access = str(self._project_user_access_level(raw))
        if access not in ("view", "edit"):
            QMessageBox.warning(self, "Unlock Production", "You do not have access to this project.")
            return False
        expected = self._expected_production_unlock_password(raw)
        if not expected:
            QMessageBox.warning(self, "Unlock Production", "Production unlock password is not configured in Company Settings.")
            return False
        host = self.window() if isinstance(self.window(), QWidget) else self
        overlay = None
        prev_effect = None
        try:
            if isinstance(host, QWidget):
                prev_effect = host.graphicsEffect()
                blur_fx = QGraphicsBlurEffect(host)
                blur_fx.setBlurRadius(5.0)
                host.setGraphicsEffect(blur_fx)
                overlay = QWidget(host)
                overlay.setObjectName("unlockProductionOverlay")
                overlay.setStyleSheet("QWidget#unlockProductionOverlay { background: rgba(15, 23, 42, 92); }")
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
        theme = self._sales_theme_hex() if hasattr(self, "_sales_theme_hex") else "#2F6BFF"
        theme_hover = QColor(theme).darker(112).name()
        dlg.setStyleSheet(
            "QDialog { background: transparent; border: none; }"
            "QFrame#unlockProductionCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QLineEdit { background:#F8FAFC; border:1px solid #D7DEE8; border-radius:9px; padding:7px 10px; font-size:12px; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            f"QPushButton#unlockBtn {{ background:{theme}; color:#FFFFFF; border:1px solid {theme}; }}"
            f"QPushButton#unlockBtn:hover {{ background:{theme_hover}; border:1px solid {theme_hover}; }}"
            "QPushButton#cancelBtn { background:#FFFFFF; color:#334155; border:1px solid #D4DAE6; }"
            "QPushButton#cancelBtn:hover { background:#F8FAFC; }"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("unlockProductionCard")
        root.addWidget(card, 0)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 14, 16, 12)
        card_l.setSpacing(8)
        project_name = str((raw or {}).get("name") or "Project").strip() or "Project"
        title = QLabel(f"Are you sure you want to unlock Production for {project_name}?")
        title.setWordWrap(True)
        title.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        card_l.addWidget(title, 0)
        detail = QLabel("Enter Production Key Password")
        detail.setStyleSheet("QLabel { color:#334155; font-size:12px; font-weight:600; }")
        card_l.addWidget(detail, 0)
        password = QLineEdit()
        password.setPlaceholderText("")
        password.setEchoMode(QLineEdit.EchoMode.Password)
        card_l.addWidget(password, 0)
        error_lbl = QLabel("")
        error_lbl.setStyleSheet("QLabel { color:#B42318; font-size:11px; font-weight:700; }")
        error_lbl.setVisible(False)
        card_l.addWidget(error_lbl, 0)
        btns = QDialogButtonBox()
        unlock_btn = btns.addButton("Unlock", QDialogButtonBox.ButtonRole.AcceptRole)
        cancel_btn = btns.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        btns.setCenterButtons(False)
        cancel_btn.setObjectName("cancelBtn")
        unlock_btn.setObjectName("unlockBtn")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        unlock_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btns.rejected.connect(dlg.reject)
        card_l.addWidget(btns, 0)
        result = {"ok": False}

        def _do_unlock() -> None:
            entered = "".join(str(password.text() or "").strip().split())
            if entered.casefold() != expected.casefold():
                error_lbl.setText("Incorrect password.")
                error_lbl.setVisible(True)
                return
            uid = str(getattr(self.router.session, "uid", "") or "").strip()
            if not uid:
                return
            hours = self._production_unlock_duration_hours()
            ok = self._grant_temp_production_edit_access(uid, hours=hours, bypass_permission=True)
            if not ok:
                error_lbl.setText("Could not unlock production.")
                error_lbl.setVisible(True)
                return
            result["ok"] = True
            dlg.accept()

        unlock_btn.clicked.connect(_do_unlock)
        password.returnPressed.connect(_do_unlock)
        password.setFocus()
        dlg.exec()
        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass
        if result["ok"]:
            updated = self._selected_project()
            self._apply_project_tab_permissions(updated)
            self._refresh_project_detail_tab_styles()
            self._refresh_dashboard_detail_tab_styles()
            self._schedule_production_unlock_timer_refresh()
            return True
        return False

    def _can_grant_temp_production_access(self) -> bool:
        return bool(self._has_company_permission("production.key"))

    def _can_change_project_ownership(self) -> bool:
        return bool(self._has_company_permission("projects.create.others"))

    def _open_change_project_ownership_dialog(self) -> None:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            QMessageBox.warning(self, "Change Ownership", "Select a project first.")
            return
        if not self._can_change_project_ownership():
            QMessageBox.warning(self, "Change Ownership", "You do not have permission to change project ownership.")
            return
        staff_rows = self._staff_rows_for_permissions() if hasattr(self, "_staff_rows_for_permissions") else list(self._staff_all or [])
        if not staff_rows:
            QMessageBox.information(self, "Change Ownership", "No staff found in this company.")
            return

        current_uid = str((raw or {}).get("createdByUid") or "").strip()
        options: list[tuple[str, str, str]] = []
        for row in staff_rows:
            if not isinstance(row, dict):
                continue
            uid = str((row or {}).get("uid") or "").strip()
            if not uid:
                continue
            name = str((row or {}).get("displayName") or (row or {}).get("name") or (row or {}).get("email") or uid).strip() or uid
            label = name
            options.append((label, uid, name))
        if not options:
            QMessageBox.information(self, "Change Ownership", "No valid staff users available.")
            return
        options.sort(key=lambda t: t[0].lower())
        items = [x[0] for x in options]
        current_index = 0
        for i, (_label, uid, _name) in enumerate(options):
            if uid == current_uid:
                current_index = i
                break
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
                overlay.setObjectName("changeOwnerOverlay")
                overlay.setStyleSheet("QWidget#changeOwnerOverlay { background: rgba(15, 23, 42, 92); }")
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
            "QFrame#changeOwnerCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            "QPushButton#confirmBtn { background:#FDECEC; color:#B42318; border:1px solid #F5C2C7; }"
            "QPushButton#confirmBtn:hover { background:#FBD5DA; }"
            "QPushButton#cancelBtn { background:#FFFFFF; color:#334155; border:1px solid #D4DAE6; }"
            "QPushButton#cancelBtn:hover { background:#F8FAFC; }"
            "QComboBox { background:#FFFFFF; color:#0F172A; border:1px solid #D4DAE6; border-radius:9px; padding:7px 10px; font-size:12px; font-weight:600; }"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("changeOwnerCard")
        root.addWidget(card, 0)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 14, 16, 12)
        card_l.setSpacing(8)

        title = QLabel("Change project ownership")
        title.setWordWrap(True)
        title.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        card_l.addWidget(title, 0)

        detail = QLabel("Select the new project owner.")
        detail.setWordWrap(True)
        detail.setStyleSheet("QLabel { color:#334155; font-size:12px; font-weight:600; }")
        card_l.addWidget(detail, 0)

        owner_combo = QComboBox()
        owner_combo.addItems(items)
        owner_combo.setCurrentIndex(max(0, min(current_index, len(items) - 1)))
        owner_combo.setCursor(Qt.CursorShape.PointingHandCursor)
        card_l.addWidget(owner_combo, 0)

        btns = QDialogButtonBox()
        confirm_btn = btns.addButton("Confirm", QDialogButtonBox.ButtonRole.AcceptRole)
        cancel_btn = btns.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        confirm_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        confirm_btn.setObjectName("confirmBtn")
        cancel_btn.setObjectName("cancelBtn")
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        card_l.addWidget(btns, 0)

        result_code = int(dlg.exec())
        selected = str(owner_combo.currentText() or "").strip()
        ok = result_code == int(QDialog.DialogCode.Accepted)
        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass

        if not ok or not selected:
            return
        picked = next((x for x in options if x[0] == selected), None)
        if not picked:
            return
        new_uid = str(picked[1] or "").strip()
        new_name = str(picked[2] or "").strip() or new_uid
        if not new_uid or new_uid == current_uid:
            return

        payload = self._load_project_settings_payload(raw)
        perms_raw = payload.get("projectPermissions")
        perms = dict(perms_raw) if isinstance(perms_raw, dict) else {}
        staff_access = self._project_permissions_staff_access(payload)
        if current_uid:
            staff_access[current_uid] = "edit"
        staff_access[new_uid] = "edit"
        perms["staffAccess"] = staff_access
        payload["projectPermissions"] = perms
        patch = {
            "createdByUid": new_uid,
            "createdByName": new_name,
            "staffMemberUid": new_uid,
            "projectSettings": payload,
            "projectSettingsJson": json.dumps(payload),
        }
        if not self._save_project_patch(patch):
            return
        self._refresh_projects(silent=True)
        selected_raw = self._selected_project()
        self._refresh_inline_permissions(selected_raw)
        self._populate_dashboard_project_details(selected_raw)

    def _grant_temp_production_edit_access(self, target_uid: str, hours: int = 8, bypass_permission: bool = False) -> bool:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            return False
        if (not bypass_permission) and (not self._can_grant_temp_production_access()):
            return False
        uid = str(target_uid or "").strip()
        if not uid:
            return False
        expiry = (datetime.now(timezone.utc) + timedelta(hours=max(1, int(hours or 8)))).isoformat().replace("+00:00", "Z")
        payload = self._load_project_settings_payload(raw)
        perms = dict(payload.get("projectPermissions") or {}) if isinstance(payload.get("projectPermissions"), dict) else {}
        temp_map = self._production_temp_edit_map(raw)
        temp_map[uid] = expiry
        perms["productionTempEditors"] = temp_map
        payload["projectPermissions"] = perms
        patch = {"projectSettings": payload, "projectSettingsJson": json.dumps(payload)}
        # Use direct backend write so password-unlock can work for project view-only users
        # without being blocked by the general project edit guard.
        company_id = getattr(self.router.session, "company_id", None)
        project_id = str((raw or {}).get("id") or "").strip()
        if company_id and project_id and hasattr(self.app.company, "update_job"):
            try:
                self.app.company.update_job(company_id, project_id, patch)
                raw.update(patch)
                if isinstance(getattr(self, "_dashboard_detail_raw", None), dict):
                    dashboard_id = str((self._dashboard_detail_raw or {}).get("id") or "").strip()
                    if dashboard_id and dashboard_id == project_id:
                        self._dashboard_detail_raw.update(patch)
                return True
            except Exception:
                pass
        return bool(self._save_project_patch(patch))

    def _current_user_temp_production_remaining_seconds(self, raw: dict | None) -> int | None:
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid:
            return None
        expiry_iso = str(self._production_temp_edit_map(raw).get(uid) or "").strip()
        if not expiry_iso:
            return None
        expiry_dt = self._parse_iso_utc(expiry_iso)
        if expiry_dt is None:
            return None
        remaining = int((expiry_dt - datetime.now(timezone.utc)).total_seconds())
        return remaining if remaining > 0 else None

    def _format_temp_unlock_timer(self, seconds: int) -> str:
        secs = max(0, int(seconds))
        if secs < 60:
            return f"{secs}s"
        hours = secs // 3600
        mins = (secs % 3600) // 60
        if hours > 0:
            return f"{hours}h {mins:02d}m"
        return f"{max(1, mins)}m"

    def _project_accessible_staff_for_unlock(self, raw: dict | None) -> list[dict]:
        if not isinstance(raw, dict):
            return []
        staff_rows = self._staff_rows_for_permissions() if hasattr(self, "_staff_rows_for_permissions") else list(self._staff_all or [])
        payload = self._load_project_settings_payload(raw)
        staff_access = self._project_permissions_staff_access(payload)
        role_view_others_map: dict[str, bool] = {}
        for role in (self._company.get("roles") or []):
            if not isinstance(role, dict):
                continue
            perms = role.get("permissions") or {}
            if not isinstance(perms, dict):
                continue
            can_view_others = bool(perms.get("projects.view.others"))
            rid = str(role.get("id") or "").strip().lower()
            rname = str(role.get("name") or "").strip().lower()
            if rid:
                role_view_others_map[rid] = can_view_others
            if rname and rname not in role_view_others_map:
                role_view_others_map[rname] = can_view_others
        creator_uid = str((raw or {}).get("createdByUid") or "").strip()
        out: list[dict] = []
        seen: set[str] = set()
        for row in staff_rows:
            if not isinstance(row, dict):
                continue
            uid = str((row or {}).get("uid") or "").strip()
            if not uid or uid in seen:
                continue
            access = str(staff_access.get(uid) or "").strip().lower()
            role_key = str((row.get("roleId") or row.get("role") or "staff")).strip().lower()
            can_view = (
                bool(access in ("view", "edit"))
                or bool(role_view_others_map.get(role_key, False))
                or (uid == creator_uid)
            )
            if not can_view:
                continue
            seen.add(uid)
            out.append(dict(row))
        return out

    def _open_unlock_production_dialog(self) -> None:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            QMessageBox.warning(self, "Unlock Production", "Select a project first.")
            return
        if not self._can_grant_temp_production_access():
            QMessageBox.warning(self, "Unlock Production", "You do not have permission to grant temporary production access.")
            return
        candidates = self._project_accessible_staff_for_unlock(raw)
        temp_map = self._production_temp_edit_map(raw)
        me = str(getattr(self.router.session, "uid", "") or "").strip()
        candidates = [r for r in candidates if str((r or {}).get("uid") or "").strip() and str((r or {}).get("uid") or "").strip() != me]
        if not candidates:
            QMessageBox.information(self, "Unlock Production", "No accessible users found for this project.")
            return

        def _remaining_for(uid: str) -> int:
            expiry_iso = str(temp_map.get(str(uid or "").strip()) or "").strip()
            if not expiry_iso:
                return 0
            dt = self._parse_iso_utc(expiry_iso)
            if dt is None:
                return 0
            return max(0, int((dt - datetime.now(timezone.utc)).total_seconds()))

        candidates.sort(key=lambda r: (0 if _remaining_for(str((r or {}).get("uid") or "").strip()) > 0 else 1, str((r or {}).get("displayName") or (r or {}).get("email") or "").lower()))

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
                overlay.setObjectName("unlockProductionGrantOverlay")
                overlay.setStyleSheet("QWidget#unlockProductionGrantOverlay { background: rgba(15, 23, 42, 92); }")
                overlay.setGeometry(host.rect())
                overlay.show()
                overlay.raise_()
        except Exception:
            overlay = None

        theme = self._sales_theme_hex() if hasattr(self, "_sales_theme_hex") else "#2F6BFF"
        theme_hover = QColor(theme).darker(112).name()
        dlg = QDialog(host if isinstance(host, QWidget) else None)
        dlg.setModal(True)
        dlg.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        dlg.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        dlg.setFixedWidth(560)
        dlg.setStyleSheet(
            "QDialog { background: transparent; border: none; }"
            "QFrame#unlockProductionGrantCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QScrollArea { background:#F8FAFC; border:1px solid #D7DEE8; border-radius:10px; }"
            "QScrollArea > QWidget > QWidget#unlockProductionListWrap { background:#F8FAFC; border-radius:10px; }"
            "QWidget#unlockProductionUserRow { background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; }"
            "QCheckBox { color:#0F172A; font-size:12px; }"
            "QComboBox { background:#F8FAFC; border:1px solid #D7DEE8; border-radius:9px; padding:6px 10px; font-size:12px; }"
            "QComboBox::drop-down { subcontrol-origin: padding; subcontrol-position: top right; width: 22px; border-left: 1px solid #E8EBF1; background: #F7F8FA; border-top-right-radius: 8px; border-bottom-right-radius: 8px; }"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            f"QPushButton#grantBtn {{ background:{theme}; color:#FFFFFF; border:1px solid {theme}; }}"
            f"QPushButton#grantBtn:hover {{ background:{theme_hover}; border:1px solid {theme_hover}; }}"
            "QPushButton#cancelBtn { background:#FFFFFF; color:#334155; border:1px solid #D4DAE6; }"
            "QPushButton#cancelBtn:hover { background:#F8FAFC; }"
        )

        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("unlockProductionGrantCard")
        root.addWidget(card, 0)
        lay = QVBoxLayout(card)
        lay.setContentsMargins(16, 14, 16, 12)
        lay.setSpacing(8)

        title = QLabel("Grant Temporary Production Edit Access")
        title.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        lay.addWidget(title, 0)
        desc = QLabel("Select users and how long to unlock Cutlist editing for.")
        desc.setStyleSheet("QLabel { color:#475569; font-size:12px; font-weight:600; }")
        lay.addWidget(desc, 0)
        unlocked_now = sum(1 for row in candidates if _remaining_for(str((row or {}).get("uid") or "").strip()) > 0)
        if unlocked_now > 0:
            info = QLabel(f"Currently unlocked: {unlocked_now}")
            info.setStyleSheet("QLabel { color:#1E4E8C; font-size:12px; font-weight:700; }")
            lay.addWidget(info, 0)

        duration_row = QHBoxLayout()
        duration_row.setContentsMargins(0, 0, 0, 0)
        duration_row.setSpacing(8)
        duration_lbl = QLabel("Duration")
        duration_lbl.setStyleSheet("QLabel { color:#334155; font-size:12px; font-weight:700; }")
        duration_combo = VComboBox()
        duration_combo.setCursor(Qt.CursorShape.PointingHandCursor)
        for lbl, hrs in (self._production_unlock_duration_options() if hasattr(self, "_production_unlock_duration_options") else [("6 hours", 6)]):
            duration_combo.addItem(str(lbl), userData=int(hrs))
        duration_combo.setCurrentIndex(max(0, duration_combo.findData(self._production_unlock_duration_hours())))
        duration_combo.setFixedWidth(150)
        duration_row.addWidget(duration_lbl, 0)
        duration_row.addWidget(duration_combo, 0)
        duration_row.addStretch(1)
        lay.addLayout(duration_row)

        list_host = QScrollArea()
        list_host.setWidgetResizable(True)
        list_host.setFrameShape(QFrame.Shape.NoFrame)
        list_wrap = QWidget()
        list_wrap.setObjectName("unlockProductionListWrap")
        list_lay = QVBoxLayout(list_wrap)
        list_lay.setContentsMargins(8, 8, 8, 8)
        list_lay.setSpacing(6)
        checks: list[tuple[str, QCheckBox]] = []
        for row in candidates:
            uid = str((row or {}).get("uid") or "").strip()
            name = str((row or {}).get("displayName") or "").strip() or str((row or {}).get("email") or uid)
            row_host = QWidget()
            row_host.setObjectName("unlockProductionUserRow")
            row_lay = QHBoxLayout(row_host)
            row_lay.setContentsMargins(10, 6, 10, 6)
            row_lay.setSpacing(8)
            chk = QCheckBox(name)
            chk.setCursor(Qt.CursorShape.PointingHandCursor)
            chk.setStyleSheet("QCheckBox { color:#0F172A; font-size:12px; }")
            row_lay.addWidget(chk, 1)
            remaining = _remaining_for(uid)
            if remaining > 0:
                timer_lbl = QLabel(self._format_temp_unlock_timer(remaining))
                timer_lbl.setStyleSheet(
                    "QLabel { "
                    "background:#EEF2F7; color:#475569; border:1px solid #D6DEE9; border-radius:8px; "
                    "padding: 1px 6px; font-size:10px; font-weight:700; }"
                )
                row_lay.addWidget(timer_lbl, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            list_lay.addWidget(row_host, 0)
            checks.append((uid, chk))
        list_lay.addStretch(1)
        list_host.setWidget(list_wrap)
        lay.addWidget(list_host, 1)

        btns = QDialogButtonBox()
        grant_btn = btns.addButton("Unlock", QDialogButtonBox.ButtonRole.AcceptRole)
        cancel_btn = btns.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        grant_btn.setObjectName("grantBtn")
        cancel_btn.setObjectName("cancelBtn")
        grant_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btns.rejected.connect(dlg.reject)
        lay.addWidget(btns, 0)

        def _grant() -> None:
            selected = [uid for uid, chk in checks if isinstance(chk, QCheckBox) and chk.isChecked()]
            if not selected:
                QMessageBox.warning(dlg, "Unlock Production", "Select at least one user.")
                return
            hours = int(duration_combo.currentData() or 6)
            changed = 0
            for uid in selected:
                if self._grant_temp_production_edit_access(uid, hours):
                    changed += 1
            if changed > 0:
                updated = self._selected_project()
                self._apply_project_tab_permissions(updated)
                self._refresh_project_detail_tab_styles()
                self._refresh_dashboard_detail_tab_styles()
                dlg.accept()
                return
            QMessageBox.warning(dlg, "Unlock Production", "Could not apply temporary access.")

        grant_btn.clicked.connect(_grant)
        dlg.exec()
        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass

    def _apply_project_tab_permissions(self, raw: dict | None) -> None:
        project_access = str(self._project_user_access_level(raw))
        can_edit_project = project_access == "edit"
        sales_view, sales_edit = self._project_tab_access(raw, "sales")
        production_view, production_edit = self._project_tab_access(raw, "production")
        for field in (
            self._detail_client_name,
            self._detail_client_phone,
            self._detail_client_email,
            self._detail_client_address,
            self._dashboard_detail_client,
            self._dashboard_detail_phone,
            self._dashboard_detail_email,
            self._dashboard_detail_address,
        ):
            if isinstance(field, QLineEdit):
                field.setReadOnly(not can_edit_project)
                field.setCursor(Qt.CursorShape.IBeamCursor if can_edit_project else Qt.CursorShape.PointingHandCursor)
        for notes in (self._detail_notes, self._dashboard_detail_notes):
            if isinstance(notes, QTextEdit):
                notes.setReadOnly(not can_edit_project)
        for btn in (
            self._detail_save_client_btn,
            self._detail_save_notes_btn,
            self._dashboard_detail_delete_btn,
            self._project_delete_btn,
            self._dashboard_sales_rooms_add_btn,
            self._dashboard_sales_rooms_add_top_btn,
            self._detail_sales_rooms_add_btn,
            self._detail_sales_rooms_add_top_btn,
        ):
            if isinstance(btn, QPushButton):
                btn.setEnabled(bool(can_edit_project))
        for btn in (self._project_status_btn, self._dashboard_detail_status_btn):
            if isinstance(btn, QPushButton):
                btn.setEnabled(bool(can_edit_project or self._has_company_permission("projects.status")))
        for btn in (
            self._dashboard_detail_open_initial_measure_btn,
            self._dashboard_detail_open_items_btn,
            self._dashboard_detail_open_quote_btn,
            self._dashboard_detail_open_specs_btn,
            self._detail_open_initial_measure_btn,
            self._detail_open_items_btn,
            self._detail_open_quote_btn,
            self._detail_open_specs_btn,
        ):
            if isinstance(btn, QPushButton):
                btn.setEnabled(bool(sales_edit if btn in (
                    self._dashboard_detail_open_initial_measure_btn,
                    self._dashboard_detail_open_items_btn,
                    self._dashboard_detail_open_specs_btn,
                    self._detail_open_initial_measure_btn,
                    self._detail_open_items_btn,
                    self._detail_open_specs_btn,
                ) else sales_view))
        for btn in (
            self._dashboard_detail_open_cutlist_btn,
            self._detail_open_cutlist_btn,
        ):
            if isinstance(btn, QPushButton):
                btn.setEnabled(bool(production_edit))
        for btn in (
            self._dashboard_detail_open_nesting_btn,
            self._dashboard_detail_open_cnc_btn,
            self._dashboard_detail_open_order_btn,
            self._dashboard_detail_open_unlock_pill_btn,
            self._dashboard_detail_open_unlock_production_btn,
            self._detail_open_nesting_btn,
            self._detail_open_cnc_btn,
            self._detail_open_order_btn,
            self._detail_open_unlock_pill_btn,
            self._detail_open_unlock_production_btn,
        ):
            if isinstance(btn, QPushButton):
                btn.setEnabled(bool(production_view))
        for btn in (
            self._dashboard_detail_open_unlock_pill_btn,
            self._detail_open_unlock_pill_btn,
        ):
            if isinstance(btn, QPushButton):
                show_unlock = bool(project_access in ("view", "edit") and not production_view)
                btn.setVisible(show_unlock)
                btn.setEnabled(show_unlock)
        for btn in (
            self._dashboard_detail_open_unlock_production_btn,
            self._detail_open_unlock_production_btn,
        ):
            if isinstance(btn, QPushButton):
                btn.setVisible(bool(self._can_grant_temp_production_access()))
                btn.setEnabled(bool(self._can_grant_temp_production_access() and production_view))
        for btn in (
            self._dashboard_change_ownership_btn,
            self._detail_change_ownership_btn,
        ):
            if isinstance(btn, QPushButton):
                btn.setVisible(bool(self._can_change_project_ownership()))
                btn.setEnabled(bool(self._can_change_project_ownership() and isinstance(raw, dict)))
        for host in (
            self._dashboard_production_config_host,
            self._dashboard_production_board_host,
            self._detail_production_config_host,
            self._detail_production_board_host,
        ):
            if isinstance(host, QWidget):
                host.setEnabled(bool(production_edit))
        # Keep tab lock/timer visuals in sync immediately on selection/grant changes.
        try:
            self._refresh_project_detail_tab_styles()
            self._refresh_dashboard_detail_tab_styles()
        except Exception:
            pass

    def _deleted_retention_days(self) -> int:
        try:
            days = int((self._company or {}).get("deletedRetentionDays") or 90)
        except Exception:
            days = 90
        return max(1, days)

    def _parse_iso_utc(self, value: str) -> datetime | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    def _deleted_project_remaining_seconds(self, raw: dict) -> int | None:
        deleted_iso = str((raw or {}).get("deletedAtIso") or (raw or {}).get("updatedAtIso") or "").strip()
        deleted_dt = self._parse_iso_utc(deleted_iso)
        if deleted_dt is None:
            return None
        expire_dt = deleted_dt + timedelta(days=self._deleted_retention_days())
        remaining = int((expire_dt - datetime.now(timezone.utc)).total_seconds())
        return remaining

    def _format_remaining_timer(self, seconds: int) -> str:
        secs = max(0, int(seconds))
        if secs >= 86400:
            days = secs // 86400
            if days >= 7:
                weeks = days // 7
                rem_days = days % 7
                return f"{weeks}w {rem_days}d"
            return f"{days}d"
        # Under 1 day: show hours only (rounded up to reflect time remaining).
        hours_left = max(1, (secs + 3599) // 3600)
        return f"{hours_left}h"

    def _deleted_projects_visible_rows(self) -> list[dict]:
        rows = [r for r in (self._projects_deleted or []) if isinstance(r, dict)]
        can_view_all = self._can_view_all_deleted_projects()
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not can_view_all and uid:
            own_rows = []
            for row in rows:
                deleted_by_uid = str((row or {}).get("deletedByUid") or "").strip()
                created_by_uid = str((row or {}).get("createdByUid") or "").strip()
                if deleted_by_uid == uid or (not deleted_by_uid and created_by_uid == uid):
                    own_rows.append(row)
            rows = own_rows
        # Hide expired rows in UI defensively; backend purge is primary.
        active_rows = []
        for row in rows:
            remaining = self._deleted_project_remaining_seconds(row)
            if remaining is not None and remaining <= 0:
                continue
            active_rows.append(row)
        rows = active_rows
        term = str((self._deleted_search_input.text() if self._deleted_search_input else "") or "").strip().lower()
        if term:
            filtered = []
            for row in rows:
                name = str((row or {}).get("name") or "").strip().lower()
                deleted_by = str((row or {}).get("deletedByName") or (row or {}).get("deletedByUid") or "").strip().lower()
                if term in name or term in deleted_by:
                    filtered.append(row)
            rows = filtered
        rows.sort(key=lambda r: str((r or {}).get("deletedAtIso") or (r or {}).get("updatedAtIso") or ""), reverse=True)
        return rows

    def _build_recently_deleted_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        title_card = QFrame()
        title_card.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 12px; }")
        title_row = QHBoxLayout(title_card)
        title_row.setContentsMargins(12, 8, 12, 8)
        title_row.setSpacing(8)
        title_icon_lbl = QLabel()
        title_icon_lbl.setFixedSize(28, 28)
        title_icon_lbl.setStyleSheet("QLabel { background: transparent; border: none; }")
        title_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "trash.png"
        title_icon_pix = QPixmap(str(title_icon_path)) if title_icon_path.exists() else QPixmap()
        if not title_icon_pix.isNull():
            title_icon_lbl.setPixmap(title_icon_pix.scaled(24, 24, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        title_row.addWidget(title_icon_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
        title = QLabel("Recently Deleted")
        title.setStyleSheet(f"color: {TEXT_MAIN}; font-size: 24px; font-weight: 700; background: transparent; border: none;")
        title_row.addWidget(title, 0, Qt.AlignmentFlag.AlignVCenter)
        title_row.addStretch(1)
        deleted_search = QLineEdit()
        deleted_search.setPlaceholderText("Search deleted projects...")
        deleted_search.setMinimumHeight(32)
        deleted_search.setMinimumWidth(300)
        deleted_search.setStyleSheet(
            "QLineEdit { background: #F3F5F8; border: 1px solid #E4E7ED; border-radius: 10px; padding: 6px 10px; font-size: 12px; color: #5B6472; }"
        )
        deleted_search.textChanged.connect(lambda _=None: self._refresh_recently_deleted_page())
        self._deleted_search_input = deleted_search
        search_icon_lbl = QLabel()
        search_icon_lbl.setFixedSize(18, 18)
        search_icon_lbl.setStyleSheet("QLabel { background: transparent; border: none; }")
        search_icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "search.png"
        search_icon_pix = QPixmap(str(search_icon_path)) if search_icon_path.exists() else QPixmap()
        if not search_icon_pix.isNull():
            search_icon_lbl.setPixmap(search_icon_pix.scaled(16, 16, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        title_row.addWidget(search_icon_lbl, 0, Qt.AlignmentFlag.AlignVCenter)
        title_row.addWidget(deleted_search, 0, Qt.AlignmentFlag.AlignVCenter)
        layout.addWidget(title_card)

        host = QFrame()
        host.setObjectName("DeletedProjectsHostCard")
        host.setStyleSheet("QFrame#DeletedProjectsHostCard { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 14px; }")
        host_layout = QVBoxLayout(host)
        host_layout.setContentsMargins(12, 10, 12, 10)
        host_layout.setSpacing(8)

        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(8)
        row.addStretch(1)
        host_layout.addLayout(row)

        header = QFrame()
        header_row = QHBoxLayout(header)
        header_row.setContentsMargins(8, 0, 8, 0)
        header_row.setSpacing(14)
        for text, stretch in [
            ("Project Name", 34),
            ("Deleted", 24),
            ("Deleted By", 22),
            ("Permanent Deletion", 20),
        ]:
            lbl = QLabel(text)
            lbl.setStyleSheet("color: #8A97A8; font-size: 12px; font-weight: 700; background: transparent; border: none;")
            if text in {"Deleted", "Permanent Deletion"}:
                lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            header_row.addWidget(lbl, stretch=stretch)
        action_head = QLabel("")
        action_head.setFixedWidth(230)
        header_row.addWidget(action_head)
        host_layout.addWidget(header)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        scroll.viewport().setStyleSheet("background: transparent;")
        rows_host = QWidget()
        rows_host.setStyleSheet("QWidget { background: transparent; border: none; }")
        rows_layout = QVBoxLayout(rows_host)
        rows_layout.setContentsMargins(0, 0, 0, 0)
        rows_layout.setSpacing(2)
        self._deleted_page_rows_layout = rows_layout
        self._deleted_page_empty_label = QLabel("No deleted projects.")
        self._deleted_page_empty_label.setStyleSheet("color:#6B7280; font-size: 13px;")
        rows_layout.addWidget(self._deleted_page_empty_label)
        rows_layout.addStretch(1)
        scroll.setWidget(rows_host)
        host_layout.addWidget(scroll, 1)
        layout.addWidget(host, 1)

        self._refresh_recently_deleted_page()
        return page

    def _refresh_recently_deleted_page(self) -> None:
        rows_layout = getattr(self, "_deleted_page_rows_layout", None)
        if not isinstance(rows_layout, QVBoxLayout):
            return
        dark_mode = str((self._user_profile or {}).get("uiTheme") or "light").strip().lower() == "dark"
        theme_color = self._normalize_hex(
            str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT),
            ACCENT,
        )
        row_name_color = "#F5F8FD" if dark_mode else "#111827"
        row_text_color = row_name_color
        while rows_layout.count():
            item = rows_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()
        rows = self._deleted_projects_visible_rows()
        if not rows:
            empty = QLabel("No deleted projects.")
            empty.setStyleSheet("color:#6B7280; font-size: 13px;")
            rows_layout.addWidget(empty)
            rows_layout.addStretch(1)
            return
        for raw in rows:
            name = str((raw or {}).get("name") or "Untitled").strip() or "Untitled"
            deleted_at = self._short_date_with_time(str((raw or {}).get("deletedAtIso") or (raw or {}).get("updatedAtIso") or ""))
            deleted_by = str((raw or {}).get("deletedByName") or (raw or {}).get("deletedByUid") or "").strip()
            job_id = str((raw or {}).get("id") or "").strip()
            if not deleted_by:
                deleted_by = "-"

            remaining = self._deleted_project_remaining_seconds(raw)
            timer_txt = self._format_remaining_timer(remaining) if isinstance(remaining, int) and remaining > 0 else "-"

            row_wrap = QWidget()
            wrap_layout = QVBoxLayout(row_wrap)
            wrap_layout.setContentsMargins(0, 1, 0, 0)
            wrap_layout.setSpacing(0)

            def _lift(on: bool, wl=wrap_layout) -> None:
                if on:
                    wl.setContentsMargins(0, 0, 0, 1)
                else:
                    wl.setContentsMargins(0, 1, 0, 0)

            row_box = HoverProjectRowCard(
                theme_color=theme_color,
                dark_mode=dark_mode,
                on_hover_change=_lift,
                on_click=None,
            )
            wrap_layout.addWidget(row_box)
            row_line = QHBoxLayout(row_box)
            row_line.setContentsMargins(10, 6, 10, 6)
            row_line.setSpacing(14)

            name_lbl = QLabel(name)
            name_lbl.setStyleSheet(f"color: {row_name_color}; font-size: 12px; font-weight: 700; background: transparent; border: none;")
            row_line.addWidget(name_lbl, stretch=34)

            deleted_lbl = QLabel(self._short_date_with_time_rich(str((raw or {}).get("deletedAtIso") or (raw or {}).get("updatedAtIso") or "")))
            deleted_lbl.setTextFormat(Qt.TextFormat.RichText)
            deleted_lbl.setStyleSheet(f"color: {row_text_color}; font-size: 12px; background: transparent; border: none;")
            deleted_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            row_line.addWidget(deleted_lbl, stretch=24)

            deleted_by_wrap = QWidget()
            deleted_by_layout = QHBoxLayout(deleted_by_wrap)
            deleted_by_layout.setContentsMargins(0, 0, 0, 0)
            deleted_by_layout.setSpacing(6)
            deleted_by_avatar_lbl = QLabel()
            deleted_by_avatar_lbl.setFixedSize(20, 20)
            deleted_by_avatar_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            deleted_uid = str((raw or {}).get("deletedByUid") or "").strip()
            deleter_row = None
            if deleted_uid:
                for person in (self._staff_all or []):
                    if not isinstance(person, dict):
                        continue
                    if str((person or {}).get("uid") or "").strip() == deleted_uid:
                        deleter_row = person
                        break
            deleted_avatar_path = str(((deleter_row or {}).get("avatarPath") if isinstance(deleter_row, dict) else "") or "").strip()
            deleted_badge_color = self._normalize_hex(
                str(((deleter_row or {}).get("badgeColor") if isinstance(deleter_row, dict) else "#7D99B3") or "#7D99B3"),
                "#7D99B3",
            )
            deleted_pix = QPixmap(deleted_avatar_path) if deleted_avatar_path and Path(deleted_avatar_path).exists() else QPixmap()
            if not deleted_pix.isNull():
                deleted_by_avatar_lbl.setPixmap(self._circle_avatar_pixmap(deleted_pix, deleted_by_avatar_lbl.size()))
                deleted_by_avatar_lbl.setText("")
                deleted_by_avatar_lbl.setStyleSheet("QLabel { border: none; border-radius: 10px; background: #DDE5F0; }")
            else:
                deleted_by_avatar_lbl.setPixmap(QPixmap())
                deleted_by_avatar_lbl.setText(self._initials_from_text(deleted_by))
                deleted_by_avatar_lbl.setStyleSheet(
                    f"QLabel {{ background: {deleted_badge_color}; color: #FFFFFF; border: none; border-radius: 10px; font-size: 10px; font-weight: 700; }}"
                )
            deleted_by_layout.addWidget(deleted_by_avatar_lbl)
            deleted_by_lbl = QLabel(deleted_by)
            deleted_by_lbl.setStyleSheet(f"color: {row_text_color}; font-size: 12px; background: transparent; border: none;")
            deleted_by_layout.addWidget(deleted_by_lbl, stretch=1)
            row_line.addWidget(deleted_by_wrap, stretch=22)

            timer_lbl = QLabel(timer_txt)
            timer_lbl.setStyleSheet(
                "QLabel { background: #FDECEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 10px; padding: 3px 10px; font-size: 12px; font-weight: 700; }"
            )
            timer_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            timer_wrap = QWidget()
            timer_wrap_lay = QHBoxLayout(timer_wrap)
            timer_wrap_lay.setContentsMargins(0, 0, 0, 0)
            timer_wrap_lay.setSpacing(0)
            timer_wrap_lay.addWidget(timer_lbl, 0, Qt.AlignmentFlag.AlignCenter)
            row_line.addWidget(timer_wrap, stretch=20)

            restore_btn = QPushButton("Restore")
            restore_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            restore_btn.setMinimumHeight(26)
            restore_btn.setFixedWidth(84)
            restore_btn.setStyleSheet(
                "QPushButton { background: #E3F5E1; color: #186A3B; border: 1px solid #C8EBCD; border-radius: 8px; padding: 0 12px; font-size: 12px; font-weight: 700; }"
                "QPushButton:hover { background: #D4EFD8; }"
            )
            restore_btn.setProperty("armed", False)

            def _restore_clicked(_=False, pid=job_id, b=restore_btn):
                armed = bool(b.property("armed"))
                if not armed:
                    b.setProperty("armed", True)
                    b.setText("Confirm")
                    b.setStyleSheet(
                        "QPushButton { background: #16A34A; color: #FFFFFF; border: 1px solid #12843D; border-radius: 8px; padding: 0 12px; font-size: 12px; font-weight: 800; }"
                        "QPushButton:hover { background: #138A3E; }"
                    )
                    QTimer.singleShot(5000, lambda btn=b: (
                        btn.setProperty("armed", False),
                        btn.setText("Restore"),
                        btn.setStyleSheet(
                            "QPushButton { background: #E3F5E1; color: #186A3B; border: 1px solid #C8EBCD; border-radius: 8px; padding: 0 12px; font-size: 12px; font-weight: 700; }"
                            "QPushButton:hover { background: #D4EFD8; }"
                        )
                    ) if bool(btn.property("armed")) else None)
                    return
                if self._restore_project_by_id(pid):
                    self._refresh_recently_deleted_page()

            restore_btn.clicked.connect(_restore_clicked)
            row_line.addWidget(restore_btn)

            delete_btn = QPushButton("Permanently Delete")
            delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            delete_btn.setMinimumHeight(26)
            delete_btn.setFixedWidth(138)
            delete_btn.setStyleSheet(
                "QPushButton { background: #FDECEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 8px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
                "QPushButton:hover { background: #FADCE0; }"
            )
            delete_btn.setProperty("armed", False)

            def _delete_clicked(_=False, pid=job_id, b=delete_btn):
                armed = bool(b.property("armed"))
                if not armed:
                    b.setProperty("armed", True)
                    b.setText("Confirm")
                    b.setStyleSheet(
                        "QPushButton { background: #DC2626; color: #FFFFFF; border: 1px solid #B91C1C; border-radius: 8px; padding: 0 10px; font-size: 12px; font-weight: 800; }"
                        "QPushButton:hover { background: #B91C1C; }"
                    )
                    QTimer.singleShot(5000, lambda btn=b: (
                        btn.setProperty("armed", False),
                        btn.setText("Permanently Delete"),
                        btn.setStyleSheet(
                            "QPushButton { background: #FDECEC; color: #B42318; border: 1px solid #F7C9CC; border-radius: 8px; padding: 0 10px; font-size: 12px; font-weight: 700; }"
                            "QPushButton:hover { background: #FADCE0; }"
                        )
                    ) if bool(btn.property("armed")) else None)
                    return
                if self._delete_project_permanently_by_id(pid):
                    self._refresh_recently_deleted_page()

            delete_btn.clicked.connect(_delete_clicked)
            row_line.addWidget(delete_btn)
            rows_layout.addWidget(row_wrap)
        rows_layout.addStretch(1)

    def _set_section(self, section: str) -> None:
        if section == "company" and not bool(self._has_company_permission("company.settings")):
            section = "dashboard"
        if section == "updates" and not bool(self._has_company_permission("company.updates")):
            section = "dashboard"
        mapping = {
            "dashboard": 0,
            "company": 1,
            "user_settings": 2,
            "updates": 3,
            "recently_deleted": 4,
        }
        index = mapping.get(section, 0)
        self.stack.setCurrentIndex(index)

        if section == "company":
            # Let the tab render immediately, then do the heavier company refresh.
            QTimer.singleShot(0, lambda: self._refresh_company(silent=True))
        elif section == "user_settings":
            self._refresh_user_settings(silent=True)
        elif section == "updates":
            self._refresh_updates(silent=True)
        elif section == "recently_deleted":
            self._refresh_projects(silent=True)
            self._refresh_recently_deleted_page()

        for key, button in self._nav_buttons.items():
            active = key == section
            if active:
                button.setStyleSheet(
                    "QPushButton {"
                    "background: #EEF1FF; color: #6E88A5; border: none; border-top-left-radius: 12px; border-bottom-left-radius: 12px; border-top-right-radius: 0px; border-bottom-right-radius: 0px;"
                    "font-size: 13px; font-weight: 700; text-align: left; padding-left: 18px;"
                    "}"
                )
            else:
                button.setStyleSheet(
                    "QPushButton {"
                    "background: transparent; color: #5B6472; border: none; border-top-left-radius: 12px; border-bottom-left-radius: 12px; border-top-right-radius: 0px; border-bottom-right-radius: 0px;"
                    "font-size: 13px; font-weight: 600; text-align: left; padding-left: 18px;"
                    "}"
                    "QPushButton:hover { background: #F4F6FB; }"
                )
        self._sync_permission_scoped_ui()


































