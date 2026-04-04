from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QCheckBox, QHBoxLayout, QMessageBox, QTableWidget, QTableWidgetItem, QWidget


class CompanyNestingCutlistMixin:

    def _production_unlock_duration_options(self) -> list[tuple[str, int]]:
        return [
            ("1 hour", 1),
            ("2 hours", 2),
            ("4 hours", 4),
            ("6 hours", 6),
            ("8 hours", 8),
            ("12 hours", 12),
            ("24 hours", 24),
            ("48 hours", 48),
            ("72 hours", 72),
        ]

    def _company_production_unlock_suffix(self) -> str:
        raw = str((self._company or {}).get("productionUnlockPasswordSuffix") or "").strip()
        return "".join(ch for ch in raw if ch.isdigit())

    def _company_production_unlock_hours(self) -> int:
        valid = {int(v) for _lbl, v in self._production_unlock_duration_options()}
        try:
            hours = int((self._company or {}).get("productionUnlockDurationHours") or 6)
        except Exception:
            hours = 6
        return hours if hours in valid else 6

    def _load_company_nesting_settings(self) -> None:
        raw = self._company.get("nestingSettings") or {}
        if self._company_nesting_sheet_h:
            self._company_nesting_sheet_h.setText(str(raw.get("sheetHeight") or "2440"))
        if self._company_nesting_sheet_w:
            self._company_nesting_sheet_w.setText(str(raw.get("sheetWidth") or "1220"))
        if self._company_nesting_kerf:
            self._company_nesting_kerf.setText(str(raw.get("kerf") or "5"))
        if self._company_nesting_margin:
            self._company_nesting_margin.setText(str(raw.get("margin") or "10"))

    def _save_company_nesting_settings(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        try:
            payload = {
                "sheetHeight": int(float(self._company_nesting_sheet_h.text().strip() if self._company_nesting_sheet_h else "2440")),
                "sheetWidth": int(float(self._company_nesting_sheet_w.text().strip() if self._company_nesting_sheet_w else "1220")),
                "kerf": int(float(self._company_nesting_kerf.text().strip() if self._company_nesting_kerf else "5")),
                "margin": int(float(self._company_nesting_margin.text().strip() if self._company_nesting_margin else "10")),
            }
        except Exception:
            if not silent_invalid:
                QMessageBox.warning(self, "Nesting Settings", "Please enter valid numeric values.")
            return
        try:
            self.app.company.update_company(company_id, {"nestingSettings": payload})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["nestingSettings"] = payload
        if notify:
            QMessageBox.information(self, "Saved", "Global nesting settings updated.")

    def _default_cutlist_columns(self) -> list[str]:
        return ["Board", "Part Name", "Height", "Width", "Depth", "Quantity", "Clashing", "Information"]

    def _normalize_cutlist_columns_list(self, raw: object) -> list[str]:
        allowed = {str(v).strip().lower(): str(v).strip() for v in self._default_cutlist_columns()}
        vals: list[str] = []
        seen: set[str] = set()
        for token in (raw or []):
            text = str(token or "").strip()
            if not text:
                continue
            key = text.lower()
            if key not in allowed or key in seen:
                continue
            seen.add(key)
            vals.append(allowed[key])
        if not vals:
            return self._default_cutlist_columns()
        return vals

    def _cutlist_columns_payload(self) -> dict[str, list[str]]:
        raw = self._company.get("cutlistColumnsByContext")
        if isinstance(raw, str):
            try:
                import json

                raw = json.loads(raw)
            except Exception:
                raw = None
        legacy = self._normalize_cutlist_columns_list(self._company.get("cutlistColumns") or [])
        if not isinstance(raw, dict):
            return {"production": list(legacy), "initialMeasure": list(legacy)}
        production = self._normalize_cutlist_columns_list(raw.get("production"))
        initial_measure = self._normalize_cutlist_columns_list(raw.get("initialMeasure"))
        return {"production": production, "initialMeasure": initial_measure}

    def _company_cutlist_columns_for_mode(self, mode: str) -> list[str]:
        key = "initialMeasure" if str(mode or "").strip().lower() in {"initial_measure", "initialmeasure", "sales"} else "production"
        payload = self._cutlist_columns_payload()
        cols = payload.get(key)
        if isinstance(cols, list) and cols:
            return [str(v) for v in cols]
        return self._default_cutlist_columns()

    def _set_cutlist_columns_table_rows(self, table: QTableWidget | None, selected: list[str], mode_key: str) -> None:
        if table is None:
            return
        if int(table.columnCount() or 0) >= 3:
            payload = self._cutlist_columns_payload()
            self._set_cutlist_columns_combined_rows(
                table,
                payload.get("production") or [],
                payload.get("initialMeasure") or [],
            )
            return
        selected_keys = {str(v).strip().lower() for v in (selected or [])}
        columns = self._default_cutlist_columns()
        table.blockSignals(True)
        table.setRowCount(len(columns))
        self._apply_compact_row_height(table, row_height=29)
        for row, name in enumerate(columns):
            item = QTableWidgetItem(name)
            item.setFlags(Qt.ItemFlag.ItemIsEnabled)
            table.setItem(row, 0, item)

            cb = QCheckBox()
            cb.setChecked(name.lower() in selected_keys or not selected_keys)
            cb.toggled.connect(lambda _=False, key=mode_key: self._queue_company_autosave(key, self._autosave_company_cutlist_columns))
            host = QWidget()
            host.setStyleSheet("QWidget { background: transparent; border: none; }")
            lay = QHBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(0)
            lay.addWidget(cb, alignment=Qt.AlignmentFlag.AlignCenter)
            table.setCellWidget(row, 1, host)
        table.blockSignals(False)
        self._fit_table_to_contents(table, min_rows=len(columns))

    def _set_cutlist_columns_combined_rows(
        self,
        table: QTableWidget | None,
        production_selected: list[str],
        initial_selected: list[str],
    ) -> None:
        if table is None:
            return
        prod_keys = {str(v).strip().lower() for v in (production_selected or [])}
        init_keys = {str(v).strip().lower() for v in (initial_selected or [])}
        columns = self._default_cutlist_columns()
        table.blockSignals(True)
        table.setRowCount(len(columns))
        self._apply_compact_row_height(table, row_height=29)
        for row, name in enumerate(columns):
            item = QTableWidgetItem(name)
            item.setFlags(Qt.ItemFlag.ItemIsEnabled)
            table.setItem(row, 0, item)

            prod_cb = QCheckBox()
            prod_cb.setChecked(name.lower() in prod_keys or not prod_keys)
            prod_cb.toggled.connect(lambda _=False: self._queue_company_autosave("cutlist_columns_combined", self._autosave_company_cutlist_columns))
            prod_host = QWidget()
            prod_host.setStyleSheet("QWidget { background: transparent; border: none; }")
            prod_lay = QHBoxLayout(prod_host)
            prod_lay.setContentsMargins(0, 0, 0, 0)
            prod_lay.setSpacing(0)
            prod_lay.addWidget(prod_cb, alignment=Qt.AlignmentFlag.AlignCenter)
            table.setCellWidget(row, 1, prod_host)

            init_cb = QCheckBox()
            init_cb.setChecked(name.lower() in init_keys or not init_keys)
            init_cb.toggled.connect(lambda _=False: self._queue_company_autosave("cutlist_columns_combined", self._autosave_company_cutlist_columns))
            init_host = QWidget()
            init_host.setStyleSheet("QWidget { background: transparent; border: none; }")
            init_lay = QHBoxLayout(init_host)
            init_lay.setContentsMargins(0, 0, 0, 0)
            init_lay.setSpacing(0)
            init_lay.addWidget(init_cb, alignment=Qt.AlignmentFlag.AlignCenter)
            table.setCellWidget(row, 2, init_host)
        table.blockSignals(False)
        self._fit_table_to_contents(table, min_rows=len(columns))

    def _read_cutlist_columns_table(self, table: QTableWidget | None) -> list[str]:
        if table is None:
            return self._default_cutlist_columns()
        vals: list[str] = []
        for row in range(table.rowCount()):
            item = table.item(row, 0)
            text = str(item.text() if item else "").strip()
            if not text:
                continue
            host = table.cellWidget(row, 1)
            cb = host.findChild(QCheckBox) if isinstance(host, QWidget) else None
            if isinstance(cb, QCheckBox) and cb.isChecked():
                vals.append(text)
        return self._normalize_cutlist_columns_list(vals)

    def _read_cutlist_columns_combined_table(self, table: QTableWidget | None) -> tuple[list[str], list[str]]:
        if table is None:
            defaults = self._default_cutlist_columns()
            return defaults, defaults
        production: list[str] = []
        initial_measure: list[str] = []
        for row in range(table.rowCount()):
            item = table.item(row, 0)
            text = str(item.text() if item else "").strip()
            if not text:
                continue
            prod_host = table.cellWidget(row, 1)
            prod_cb = prod_host.findChild(QCheckBox) if isinstance(prod_host, QWidget) else None
            if isinstance(prod_cb, QCheckBox) and prod_cb.isChecked():
                production.append(text)
            init_host = table.cellWidget(row, 2)
            init_cb = init_host.findChild(QCheckBox) if isinstance(init_host, QWidget) else None
            if isinstance(init_cb, QCheckBox) and init_cb.isChecked():
                initial_measure.append(text)
        return self._normalize_cutlist_columns_list(production), self._normalize_cutlist_columns_list(initial_measure)

    def _load_company_cutlist_columns_rows(self) -> None:
        prod_table = self._company_cutlist_columns_prod_table or self._company_cutlist_columns_table
        sales_table = self._company_cutlist_columns_sales_table
        if prod_table is None and sales_table is None:
            return
        suffix_input = getattr(self, "_company_cutlist_unlock_suffix_input", None)
        if suffix_input is not None:
            try:
                suffix_input.blockSignals(True)
                suffix_input.setText(self._company_production_unlock_suffix())
                suffix_input.blockSignals(False)
            except Exception:
                pass
        duration_combo = getattr(self, "_company_cutlist_unlock_duration_combo", None)
        if duration_combo is not None:
            try:
                duration_combo.blockSignals(True)
                idx = duration_combo.findData(self._company_production_unlock_hours())
                duration_combo.setCurrentIndex(max(0, idx))
                duration_combo.blockSignals(False)
            except Exception:
                pass
        payload = self._cutlist_columns_payload()
        if prod_table is not None and int(prod_table.columnCount() or 0) >= 3:
            self._set_cutlist_columns_combined_rows(
                prod_table,
                payload.get("production") or [],
                payload.get("initialMeasure") or [],
            )
            return
        self._set_cutlist_columns_table_rows(prod_table, payload.get("production") or [], "cutlist_columns_production")
        self._set_cutlist_columns_table_rows(sales_table, payload.get("initialMeasure") or [], "cutlist_columns_sales")

    def _save_company_cutlist_columns(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        prod_table = self._company_cutlist_columns_prod_table or self._company_cutlist_columns_table
        sales_table = self._company_cutlist_columns_sales_table
        if not company_id or (prod_table is None and sales_table is None):
            return
        suffix_input = getattr(self, "_company_cutlist_unlock_suffix_input", None)
        duration_combo = getattr(self, "_company_cutlist_unlock_duration_combo", None)
        suffix = "".join(ch for ch in str(suffix_input.text() if suffix_input else "").strip() if ch.isdigit())
        try:
            duration_hours = int(duration_combo.currentData() if duration_combo is not None else self._company_production_unlock_hours())
        except Exception:
            duration_hours = self._company_production_unlock_hours()
        valid_durations = {int(v) for _lbl, v in self._production_unlock_duration_options()}
        if duration_hours not in valid_durations:
            duration_hours = 6
        if prod_table is not None and int(prod_table.columnCount() or 0) >= 3:
            production, initial_measure = self._read_cutlist_columns_combined_table(prod_table)
        else:
            production = self._read_cutlist_columns_table(prod_table)
            initial_measure = self._read_cutlist_columns_table(sales_table) if sales_table is not None else list(production)
        if not production or not initial_measure:
            if not silent_invalid:
                QMessageBox.warning(self, "Cutlist Columns", "At least one column must stay enabled.")
            return
        payload = {"production": production, "initialMeasure": initial_measure}
        try:
            self.app.company.update_company(
                company_id,
                {
                    "cutlistColumnsByContext": payload,
                    "cutlistColumns": production,
                    "productionUnlockPasswordSuffix": suffix,
                    "productionUnlockDurationHours": int(duration_hours),
                },
            )
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["cutlistColumnsByContext"] = payload
        self._company["cutlistColumns"] = production
        self._company["productionUnlockPasswordSuffix"] = suffix
        self._company["productionUnlockDurationHours"] = int(duration_hours)
        if notify:
            QMessageBox.information(self, "Saved", "Cutlist columns updated.")
