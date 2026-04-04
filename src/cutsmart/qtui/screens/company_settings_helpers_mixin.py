from __future__ import annotations

from PySide6.QtCore import QTimer
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QColorDialog, QMessageBox, QPushButton

from cutsmart.qtui.screens.dashboard_widgets import ReorderableTableWidget


class CompanySettingsHelpersMixin:

    def _queue_company_autosave(self, key: str, callback, delay_ms: int = 500) -> None:
        if self._suspend_company_autosave:
            return
        timer = self._company_autosave_timers.get(key)
        if timer is None:
            timer = QTimer(self)
            timer.setSingleShot(True)
            timer.timeout.connect(callback)
            self._company_autosave_timers[key] = timer
        timer.start(max(120, int(delay_ms)))

    def _autosave_company_theme(self) -> None:
        self._save_company_theme(notify=False, silent_invalid=True)

    def _autosave_company_general_preferences(self) -> None:
        self._save_company_general_preferences(notify=False, silent_invalid=True)

    def _pick_company_theme_color(self) -> None:
        start = self._normalize_hex(str(self._company_theme_hex or "#2F6BFF"), "#2F6BFF")
        picked = QColorDialog.getColor(QColor(start), self, "Choose Theme Color")
        if not picked.isValid():
            return
        self._company_theme_hex = self._normalize_hex(str(picked.name() or start), start)
        if self._company_theme_preview:
            self._company_theme_preview.setStyleSheet(
                f"QPushButton {{ background: {self._company_theme_hex}; border-radius: 8px; border: 1px solid #D7DCE5; }}"
            )
        self._queue_company_autosave("theme", self._autosave_company_theme, delay_ms=120)

    def _autosave_company_statuses(self) -> None:
        self._save_company_statuses(notify=False, silent_invalid=True)

    def _autosave_company_roles(self) -> None:
        self._save_company_roles(notify=False, silent_invalid=True)

    def _autosave_company_board_thicknesses(self) -> None:
        self._save_company_board_thicknesses(notify=False, silent_invalid=True)

    def _autosave_company_board_finishes(self) -> None:
        self._save_company_board_finishes(notify=False, silent_invalid=True)

    def _autosave_company_sheet_sizes(self) -> None:
        self._save_company_sheet_sizes(notify=False, silent_invalid=True)

    def _autosave_company_nesting(self) -> None:
        self._save_company_nesting_settings(notify=False, silent_invalid=True)

    def _autosave_company_part_types(self) -> None:
        self._save_company_part_types(notify=False, silent_invalid=True)

    def _autosave_company_hardware(self) -> None:
        self._save_company_hardware_settings(notify=False, silent_invalid=True)

    def _autosave_company_inventory(self) -> None:
        self._save_company_inventory(notify=False, silent_invalid=True)

    def _autosave_company_item_categories(self) -> None:
        self._save_company_item_categories(notify=False, silent_invalid=True)

    def _autosave_company_quote_extras(self) -> None:
        self._save_company_quote_extras(notify=False, silent_invalid=True)

    def _autosave_company_quote_template(self) -> None:
        self._save_company_quote_template(notify=False, silent_invalid=True)

    def _autosave_company_job_types(self) -> None:
        self._save_company_job_types(notify=False, silent_invalid=True)

    def _autosave_company_sales_discounts(self) -> None:
        self._save_company_sales_discounts(notify=False, silent_invalid=True)

    def _autosave_company_cutlist_columns(self) -> None:
        self._save_company_cutlist_columns(notify=False, silent_invalid=True)

    def _apply_company_drop_indicator_color(self, color_hex: str) -> None:
        table_attrs = (
            "_company_status_table",
            "_company_roles_table",
            "_company_board_table",
            "_company_board_finishes_table",
            "_company_sheet_sizes_table",
            "_company_part_types_table",
            "_company_hardware_table",
            "_company_inventory_table",
            "_company_item_categories_table",
            "_company_job_types_table",
            "_company_quote_extras_table",
        )
        for attr in table_attrs:
            table = getattr(self, attr, None)
            if not isinstance(table, ReorderableTableWidget):
                continue
            try:
                table.set_drop_indicator_color(color_hex)
            except RuntimeError:
                # Widget was deleted during page rebuild; drop stale reference.
                setattr(self, attr, None)

    def _on_status_rows_reordered(self) -> None:
        self._refresh_status_row_widgets()
        if self._company_status_table:
            self._fit_table_to_contents(self._company_status_table, min_rows=3)
        self._queue_company_autosave("statuses", self._autosave_company_statuses, delay_ms=120)

    def _on_role_rows_reordered(self) -> None:
        self._refresh_role_permissions_buttons()
        if self._company_roles_table:
            self._fit_table_to_contents(self._company_roles_table, min_rows=3)
        self._queue_company_autosave("roles", self._autosave_company_roles, delay_ms=120)

    def _on_board_rows_reordered(self) -> None:
        self._refresh_board_row_widgets()
        if self._company_board_table:
            self._fit_table_to_contents(self._company_board_table, min_rows=3)
        self._queue_company_autosave("board_thickness", self._autosave_company_board_thicknesses, delay_ms=120)

    def _on_board_finishes_rows_reordered(self) -> None:
        self._refresh_board_finishes_row_widgets()
        if self._company_board_finishes_table:
            self._fit_table_to_contents(self._company_board_finishes_table, min_rows=3)
        self._queue_company_autosave("board_finishes", self._autosave_company_board_finishes, delay_ms=120)

    def _on_sheet_sizes_rows_reordered(self) -> None:
        self._refresh_sheet_sizes_row_widgets()
        if self._company_sheet_sizes_table:
            self._fit_sheet_sizes_table_to_contents()
        self._queue_company_autosave("sheet_sizes", self._autosave_company_sheet_sizes, delay_ms=120)

    def _on_part_type_rows_reordered(self) -> None:
        self._refresh_part_type_row_widgets()
        if self._company_part_types_table:
            fitter = getattr(self, "_fit_part_types_table", None)
            if callable(fitter):
                fitter()
            else:
                self._fit_table_to_contents(self._company_part_types_table, min_rows=2)
        self._queue_company_autosave("part_types", self._autosave_company_part_types, delay_ms=120)

    def _on_hardware_rows_reordered(self) -> None:
        self._refresh_hardware_row_widgets()
        if self._company_hardware_table:
            self._fit_table_to_contents(self._company_hardware_table, min_rows=2)
        self._queue_company_autosave("hardware", self._autosave_company_hardware, delay_ms=120)

    def _on_inventory_rows_reordered(self) -> None:
        self._refresh_inventory_row_widgets()
        if self._company_inventory_table:
            self._fit_table_to_contents(self._company_inventory_table, min_rows=3)
        self._queue_company_autosave("inventory", self._autosave_company_inventory, delay_ms=120)

    def _on_item_categories_rows_reordered(self) -> None:
        self._refresh_item_category_row_widgets()
        if self._company_item_categories_table:
            self._fit_table_to_contents(self._company_item_categories_table, min_rows=3)
        self._queue_company_autosave("item_categories", self._autosave_company_item_categories, delay_ms=120)

    def _on_quote_extras_rows_reordered(self) -> None:
        self._refresh_quote_extra_row_widgets()
        if self._company_quote_extras_table:
            self._fit_table_to_contents(self._company_quote_extras_table, min_rows=2)
        self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras, delay_ms=120)

    def _on_job_types_rows_reordered(self) -> None:
        self._refresh_job_type_row_widgets()
        if self._company_job_types_table:
            self._fit_table_to_contents(self._company_job_types_table, min_rows=2)
        self._queue_company_autosave("job_types", self._autosave_company_job_types, delay_ms=120)

    def _set_company_settings_tab(self, tab_key: str) -> None:
        stack = self._company_settings_stack
        if stack is None:
            return
        index_map = {"general": 0, "production": 1, "hardware": 2, "sales": 3}
        stack.setCurrentIndex(index_map.get(tab_key, 0))
        self._apply_company_settings_tab_styles(tab_key)

    def _apply_company_settings_tab_styles(self, active_key: str) -> None:
        for key, btn in self._company_tab_buttons.items():
            if key == active_key:
                btn.setStyleSheet(
                    "QPushButton {"
                    "background: #2F6BFF; color: #FFFFFF; border: none; border-radius: 10px;"
                    "font-size: 13px; font-weight: 800; text-align: left; padding-left: 12px;"
                    "}"
                )
            else:
                btn.setStyleSheet(
                    "QPushButton {"
                    "background: transparent; color: #5B6472; border: none; border-radius: 10px;"
                    "font-size: 13px; font-weight: 700; text-align: left; padding-left: 12px;"
                    "}"
                    "QPushButton:hover { background: #F1F5F9; color:#334155; }"
                )

    def _hide_company_join_key(self) -> None:
        if self._company_info_join_key_btn:
            self._company_info_join_key_btn.setText("Show key")
            self._company_info_join_key_btn.setProperty("revealed", False)
        if self._company_info_join_key_value:
            self._company_info_join_key_value.setText("••••••")

    def _show_company_join_key_temporarily(self) -> None:
        btn = self._company_info_join_key_btn
        if btn and bool(btn.property("revealed")):
            if self._company_join_key_timer and self._company_join_key_timer.isActive():
                self._company_join_key_timer.stop()
            self._hide_company_join_key()
            return
        join_key = str((self._company or {}).get("joinCode") or "").strip()
        if not join_key:
            QMessageBox.warning(self, "Join Key", "No join key is set for this company.")
            return
        if self._company_info_join_key_value:
            self._company_info_join_key_value.setText(join_key)
        if btn:
            btn.setText("Hide key")
            btn.setProperty("revealed", True)
        if self._company_join_key_timer is None:
            self._company_join_key_timer = QTimer(self)
            self._company_join_key_timer.setSingleShot(True)
            self._company_join_key_timer.timeout.connect(self._hide_company_join_key)
        self._company_join_key_timer.start(10000)

    def _load_company_info_fields(self) -> None:
        company_id = str(getattr(self.router.session, "company_id", "") or "").strip()
        company_name = str((self._company or {}).get("name") or "").strip() or "-"
        plan = str((self._company or {}).get("planTier") or "free").strip() or "free"
        if self._company_info_name_value:
            self._company_info_name_value.setText(company_name)
        if self._company_info_plan_value:
            self._company_info_plan_value.setText(plan.title())
        if self._company_info_id_value:
            self._company_info_id_value.setText(company_id or "-")
        if self._company_join_key_timer and self._company_join_key_timer.isActive():
            self._company_join_key_timer.stop()
        self._hide_company_join_key()


