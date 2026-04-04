from __future__ import annotations

import json
import time

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QInputDialog, QMessageBox, QPushButton, QTableWidgetItem

from cutsmart.ui.style import ACCENT
from cutsmart.qtui.screens.cnc_cutlist_dialog import CNCCutlistDialog
from cutsmart.qtui.screens.nesting_dialog import NestingLayoutDialog
from cutsmart.qtui.screens.production_order_dialog import ProductionOrderDialog
from cutsmart.qtui.screens.project_settings_dialog import ProjectSettingsDialog


class ProjectActionsMixin:
    def _project_order_payload(self, raw: dict | None) -> dict:
        payload = (raw or {}).get("orderSheet")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = None
        if not isinstance(payload, dict):
            payload = {}
        legacy = (raw or {}).get("orderSheetJson")
        if isinstance(legacy, str) and legacy.strip():
            try:
                legacy_payload = json.loads(legacy)
            except Exception:
                legacy_payload = None
            if isinstance(legacy_payload, dict):
                merged = dict(legacy_payload)
                merged.update(payload)
                payload = merged
        out = dict(payload or {})
        out["drawers"] = [dict(r) for r in (out.get("drawers") or []) if isinstance(r, dict)]
        out["hinges"] = [dict(r) for r in (out.get("hinges") or []) if isinstance(r, dict)]
        out["misc"] = [dict(r) for r in (out.get("misc") or []) if isinstance(r, dict)]
        return out

    def _save_project_order_payload(self, raw: dict | None, payload: dict) -> bool:
        clean = dict(payload or {})
        clean["drawers"] = [dict(r) for r in (clean.get("drawers") or []) if isinstance(r, dict)]
        clean["hinges"] = [dict(r) for r in (clean.get("hinges") or []) if isinstance(r, dict)]
        clean["misc"] = [dict(r) for r in (clean.get("misc") or []) if isinstance(r, dict)]
        patch = {"orderSheet": clean, "orderSheetJson": json.dumps(clean)}

        target_id = str((raw or {}).get("id") or "").strip()
        selected = self._selected_project()
        selected_id = str((selected or {}).get("id") or "").strip() if isinstance(selected, dict) else ""
        if not target_id or target_id == selected_id:
            return bool(self._save_project_patch(patch))

        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return False
        try:
            self.app.company.update_job(company_id, target_id, patch)
        except Exception:
            return False
        for row in (self._projects_all or []):
            if isinstance(row, dict) and str(row.get("id") or "").strip() == target_id:
                row.update(patch)
                break
        return True

    def _order_hinge_options(self, raw: dict | None) -> list[str]:
        payload = self._load_project_settings_payload(raw)
        selected_cat = self._part_key(str(payload.get("hardwareCategory") or payload.get("hingeType") or "").strip())
        out: list[str] = []
        for cat in (self._company_hardware_settings() or []):
            if not isinstance(cat, dict):
                continue
            cat_name = str(cat.get("name") or "").strip()
            if selected_cat and self._part_key(cat_name) != selected_cat:
                continue
            for row in (cat.get("hinges") or []):
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or "").strip()
                if name and name not in out:
                    out.append(name)
        if out:
            return out
        for cat in (self._company_hardware_settings() or []):
            if not isinstance(cat, dict):
                continue
            for row in (cat.get("hinges") or []):
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or "").strip()
                if name and name not in out:
                    out.append(name)
        return out

    def _build_drawer_order_rows(self, raw: dict | None, existing_rows: list[dict] | None = None) -> list[dict]:
        rows, _entry_drafts, _collapsed = self._load_project_cutlist_rows(raw)
        drawer_map = self._company_part_type_drawer_map()
        spec = dict(self._project_drawer_breakdown_spec(raw) or {})
        settings_payload = self._load_project_settings_payload(raw)
        selected_hardware_name = str(settings_payload.get("hardwareCategory") or "").strip()
        if not selected_hardware_name:
            selected_hardware_name = str(self._hardware_default_hinge_type_option() or "").strip()
        drawer_type = str(spec.get("drawerName") or "Drawer").strip() or "Drawer"
        parse_mm = getattr(self, "_parse_mm_number", None)
        parse_qty = getattr(self, "_parse_positive_number", None)
        parse_tokens = getattr(self, "_parse_drawer_height_tokens", None)
        format_mm = getattr(self, "_format_mm_value", None)
        if not callable(parse_mm) or not callable(parse_qty) or not callable(parse_tokens) or not callable(format_mm):
            return []

        lengths: list[float] = []
        for item in (spec.get("hardwareLengths") or []):
            v = parse_mm(item)
            if v is not None:
                lengths.append(float(v))
        lengths.sort()

        manual_by_key: dict[str, dict] = {}
        for row in (existing_rows or []):
            if not isinstance(row, dict):
                continue
            row_drawer = str(row.get("sourceDrawerType") or "").strip()
            row_height = str(row.get("drawerHeight") or "").strip()
            row_len = str(row.get("requiredLength") or "").strip()
            key = f"{self._part_key(row_drawer)}|{self._part_key(row_height)}|{self._part_key(row_len)}"
            if key:
                manual_by_key[key] = {
                    "supplier": str(row.get("supplier") or "").strip(),
                    "sku": str(row.get("sku") or "").strip(),
                    "notes": str(row.get("notes") or "").strip(),
                }

        grouped: dict[str, dict] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            part_type = str(row.get("partType") or row.get("part_type") or "").strip()
            if not bool(drawer_map.get(self._part_key(part_type), False)):
                continue
            depth = parse_mm(row.get("depth"))
            if depth is None:
                continue
            qty_base = parse_qty(row.get("quantity"))
            if qty_base is None:
                qty_base = parse_qty(row.get("qty"))
            qty = max(1, int(round(float(qty_base or 1.0))))
            height_tokens = parse_tokens(row.get("height"))
            norm_height_tokens = [str(tok or "").strip() for tok in (height_tokens or []) if str(tok or "").strip()]
            if not norm_height_tokens:
                norm_height_tokens = [""]
            token_counts: dict[str, int] = {}
            for tok in norm_height_tokens:
                key_tok = str(tok or "").strip()
                token_counts[key_tok] = int(token_counts.get(key_tok) or 0) + 1
            has_multi_height_tokens = len(norm_height_tokens) > 1
            # Order rows should use the selected hardware depth first.
            # (Any part-size depth deductions happen later in the cutlist expansion flow.)
            depth_for_hardware = float(depth)
            required_length = depth_for_hardware
            if lengths:
                candidates = [v for v in lengths if v <= float(depth_for_hardware)]
                if candidates:
                    required_length = max(candidates)
            required_text = str(format_mm(required_length) or "").strip()
            for drawer_height, token_count in token_counts.items():
                row_key = f"{self._part_key(drawer_type)}|{self._part_key(drawer_height)}|{self._part_key(required_text)}"
                if row_key not in grouped:
                    grouped[row_key] = {
                        "sourceDrawerType": drawer_type,
                        "drawerHeight": str(drawer_height or "").strip(),
                        "requiredLength": required_text,
                        "qty": 0,
                    }
                increment = int(token_count) if has_multi_height_tokens else int(qty)
                grouped[row_key]["qty"] = int(grouped[row_key].get("qty") or 0) + max(1, int(increment))

        out = []
        for key, base_row in grouped.items():
            manual = manual_by_key.get(key) or {}
            out.append(
                {
                    "sourceDrawerType": str(base_row.get("sourceDrawerType") or "").strip(),
                    "drawerHeight": str(base_row.get("drawerHeight") or "").strip(),
                    "requiredLength": str(base_row.get("requiredLength") or "").strip(),
                    "qty": int(base_row.get("qty") or 0),
                    "supplier": str(manual.get("supplier") or selected_hardware_name or "").strip(),
                    "sku": str(manual.get("sku") or "").strip(),
                    "notes": str(manual.get("notes") or "").strip(),
                    "auto": True,
                }
            )
        letter_value_map: dict[str, float] = {}
        for letter, val in dict(spec.get("backLetterValues") or {}).items():
            mm = parse_mm(val)
            if mm is None:
                continue
            letter_value_map[self._part_key(str(letter or "").strip())] = float(mm)

        def _height_sort_value(row_obj: dict) -> float:
            raw_h = str((row_obj or {}).get("drawerHeight") or "").strip()
            mm = parse_mm(raw_h)
            if mm is not None:
                return float(mm)
            return float(letter_value_map.get(self._part_key(raw_h), 0.0))

        out.sort(
            key=lambda r: (
                -float(parse_mm(r.get("requiredLength")) or 0.0),
                -_height_sort_value(r),
                self._part_key(str(r.get("drawerHeight") or "")),
                self._part_key(str(r.get("sourceDrawerType") or "")),
            )
        )
        return out


    def _flush_visible_embedded_board_settings(self) -> None:
        panels = []
        for panel in (
            getattr(self, "_detail_embedded_board_settings", None),
            getattr(self, "_dashboard_embedded_board_settings", None),
        ):
            if isinstance(panel, ProjectSettingsDialog) and panel.isVisible():
                panels.append(panel)
        for panel in panels:
            try:
                payload = panel.payload()
                if isinstance(payload, dict):
                    if hasattr(self, "_save_project_settings_payload"):
                        self._save_project_settings_payload(payload)
                    else:
                        patch = {"projectSettings": dict(payload), "projectSettingsJson": json.dumps(dict(payload))}
                        self._save_project_patch(patch)
            except Exception:
                pass

    def _open_project_settings(self, initial_section: str | None = None) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "Settings", "Select a project first.")
            return
        payload = self._load_project_settings_payload(raw)
        bound_project_id = str((raw or {}).get("id") or "").strip()
        staff_rows = list(self._staff_all or [])
        if not staff_rows:
            company_id = getattr(self.router.session, "company_id", None)
            if company_id:
                try:
                    staff_rows = list(self.app.company.list_staff(company_id) or [])
                except Exception:
                    staff_rows = []
        def _autosave_project_settings(new_payload: dict) -> None:
            if hasattr(self, "_save_project_settings_payload_for_project"):
                return bool(self._save_project_settings_payload_for_project(bound_project_id, dict(new_payload or {})))
            patch = {"projectSettings": dict(new_payload or {}), "projectSettingsJson": json.dumps(dict(new_payload or {}))}
            return bool(self._save_project_patch(patch))

        def _live_board_lock_state() -> tuple[set[str], dict[str, str]]:
            target_raw = None
            for row in (getattr(self, "_projects_all", None) or []):
                if isinstance(row, dict) and str(row.get("id") or "").strip() == bound_project_id:
                    target_raw = row
                    break
            if not isinstance(target_raw, dict):
                target_raw = raw if isinstance(raw, dict) else {}
            keys = self._project_used_cutlist_board_keys(target_raw) if hasattr(self, "_project_used_cutlist_board_keys") else set()
            labels = self._project_board_display_map(target_raw) if hasattr(self, "_project_board_display_map") else {}
            return keys if isinstance(keys, set) else set(), labels if isinstance(labels, dict) else {}

        dialog = ProjectSettingsDialog(
            project_name=str(raw.get("name") or "Project"),
            payload=payload,
            staff=staff_rows,
            board_thicknesses=self._company_board_thickness_options(),
            board_finishes=self._company_board_finish_options(),
            board_colour_suggestions=self._company_board_colour_suggestions(),
            board_material_usage=self._company_board_material_usage_stats(),
            board_locked_keys=self._project_used_cutlist_board_keys(raw) if hasattr(self, "_project_used_cutlist_board_keys") else set(),
            board_locked_labels=self._project_board_display_map(raw) if hasattr(self, "_project_board_display_map") else {},
            board_lock_state_provider=_live_board_lock_state,
            sheet_sizes=self._company_sheet_size_options(),
            default_sheet_size=self._company_default_sheet_size_option(),
            staff_role_view_permissions=self._staff_projects_view_permission_map(staff_rows),
            staff_access_lock_permissions=self._staff_projects_access_lock_permission_map(staff_rows),
            initial_section=initial_section,
            theme_color=str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT),
            measurement_unit=str((self._company or {}).get("measurementUnit") or "mm"),
            on_change=_autosave_project_settings,
            parent=None,
        )
        dialog.setModal(False)
        dialog.setWindowModality(Qt.WindowModality.NonModal)
        self._open_project_settings_dialogs.append(dialog)

        def _on_close(_result: int = 0, dlg=dialog) -> None:
            try:
                final_payload = dlg.payload()
                if hasattr(self, "_save_project_settings_payload_for_project"):
                    self._save_project_settings_payload_for_project(bound_project_id, final_payload)
                else:
                    final_patch = {"projectSettings": final_payload, "projectSettingsJson": json.dumps(final_payload)}
                    self._save_project_patch(final_patch)
            except Exception:
                pass
            self._open_project_settings_dialogs = [d for d in self._open_project_settings_dialogs if d is not dlg]

        dialog.finished.connect(_on_close)
        dialog.show()

    def _open_project_images(self) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "Images", "Select a project first.")
            return
        dialog = ProjectImagesDialog(
            project_name=str(raw.get("name") or "Project"),
            paths=self._job_image_paths(raw),
            parent=self,
        )
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        paths = dialog.paths_payload()
        patch = {"projectImages": paths, "imagePaths": paths, "images": paths}
        if self._save_project_patch(patch):
            QMessageBox.information(self, "Images", f"Saved {len(paths)} image path(s).")

    def _open_cnc_cutlist_placeholder(self) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "CNC Cutlist", "Select a project first.")
            return
        can_prod_view = True
        if hasattr(self, "_project_tab_access"):
            try:
                can_prod_view, _can_prod_edit = self._project_tab_access(raw, "production")
            except Exception:
                can_prod_view = True
        if not can_prod_view:
            QMessageBox.warning(self, "CNC Cutlist", "You do not have permission to view the Production tab.")
            return
        cut_payload = self._project_cutlist_payload(raw)
        project_id = str((raw or {}).get("id") or "").strip()
        company_id = getattr(self.router.session, "company_id", None)
        rows, _entry_drafts, _collapsed = self._load_project_cutlist_rows(raw)
        rows, rows_migrated = self._migrate_cutlist_board_values(raw, rows)
        if rows_migrated:
            try:
                migrated_payload = {
                    "rows": rows,
                    "entryDraftRows": _entry_drafts,
                    "collapsedPartTypes": _collapsed,
                    "rooms": self._project_cutlist_rooms(raw),
                    "roomsWithPieces": self._project_cutlist_seen_piece_rooms(raw),
                    "activeRoom": str(cut_payload.get("activeRoom") or "All"),
                    "activePartType": str(cut_payload.get("activePartType") or ""),
                    "cncCollapsedPartTypes": [str(v).strip() for v in (cut_payload.get("cncCollapsedPartTypes") or []) if str(v).strip()],
                }
                self._save_project_patch({"cutlist": migrated_payload, "cutlistJson": json.dumps(migrated_payload)})
            except Exception:
                pass

        indexed_rows: list[dict] = []
        visibility_map: dict[str, bool] = {}
        collapsed_part_types = [str(v).strip() for v in (cut_payload.get("cncCollapsedPartTypes") or []) if str(v).strip()]
        include_in_cutlists_map = self._company_part_type_include_in_cutlists_map()
        for idx, row in enumerate(rows):
            entry = dict(row)
            part_type = str(entry.get("partType") or entry.get("part_type") or "").strip()
            part_key = self._part_key(part_type)
            if part_key and not bool(include_in_cutlists_map.get(part_key, True)):
                continue
            raw_key = entry.get("__id")
            cutlist_key = str(raw_key).strip() if raw_key is not None and str(raw_key).strip() else str(idx)
            entry["__cutlist_key"] = cutlist_key
            if "includeInNesting" not in entry:
                entry["includeInNesting"] = True
            visibility_map[cutlist_key] = bool(entry.get("includeInNesting", True))
            indexed_rows.append(entry)

        # Build CNC output from the full cutlist set so rows can always re-appear
        # when toggled back on in the visibility panel.
        indexed_rows_all_visible: list[dict] = []
        for row in indexed_rows:
            item = dict(row)
            item["includeInNesting"] = True
            indexed_rows_all_visible.append(item)
        # CNC should use manufacturing-expanded rows (drawer bottoms/backs, cabinet
        # pieces, etc.) rather than only the top-level cutlist parent rows.
        rows_for_output = self._expand_cutlist_rows_for_manufacturing(raw, indexed_rows_all_visible)
        designer_name = str((raw or {}).get("createdByName") or (self._user_profile or {}).get("displayName") or "").strip()

        def _on_visibility_changed(new_map: dict[str, bool]) -> None:
            try:
                source_project = None
                for row_obj in (self._projects_all or []):
                    rid = str((row_obj or {}).get("id") or "").strip()
                    if rid == project_id:
                        source_project = row_obj
                        break
                source_project = source_project or raw
                latest_rows, latest_drafts, latest_collapsed = self._load_project_cutlist_rows(source_project)
                source_cut_payload = self._project_cutlist_payload(source_project)
                for i, item in enumerate(latest_rows):
                    if not isinstance(item, dict):
                        continue
                    raw_key = item.get("__id")
                    key = str(raw_key).strip() if raw_key is not None and str(raw_key).strip() else str(i)
                    item["includeInNesting"] = bool(new_map.get(key, True))
                latest_payload = {
                    "rows": latest_rows,
                    "entryDraftRows": latest_drafts,
                    "collapsedPartTypes": latest_collapsed,
                    "rooms": self._project_cutlist_rooms(raw),
                    "roomsWithPieces": self._project_cutlist_seen_piece_rooms(raw),
                    "activeRoom": str(cut_payload.get("activeRoom") or "All"),
                    "activePartType": str(cut_payload.get("activePartType") or ""),
                    "cncCollapsedPartTypes": [str(v).strip() for v in (source_cut_payload.get("cncCollapsedPartTypes") or []) if str(v).strip()],
                }
                patch = {"cutlist": latest_payload, "cutlistJson": json.dumps(latest_payload)}
                saved = False
                if project_id and company_id and hasattr(self.app.company, "update_job"):
                    try:
                        self.app.company.update_job(company_id, project_id, patch)
                        saved = True
                    except Exception:
                        saved = False
                if not saved:
                    saved = self._save_project_patch(patch)
                if saved and isinstance(source_project, dict):
                    source_project.update(patch)
            except Exception:
                pass

        def _on_collapsed_changed(collapsed_keys: list[str]) -> None:
            try:
                source_project = None
                for row_obj in (self._projects_all or []):
                    rid = str((row_obj or {}).get("id") or "").strip()
                    if rid == project_id:
                        source_project = row_obj
                        break
                source_project = source_project or raw
                latest_rows, latest_drafts, latest_collapsed = self._load_project_cutlist_rows(source_project)
                latest_payload = {
                    "rows": latest_rows,
                    "entryDraftRows": latest_drafts,
                    "collapsedPartTypes": latest_collapsed,
                    "rooms": self._project_cutlist_rooms(raw),
                    "roomsWithPieces": self._project_cutlist_seen_piece_rooms(raw),
                    "activeRoom": str(cut_payload.get("activeRoom") or "All"),
                    "activePartType": str(cut_payload.get("activePartType") or ""),
                    "cncCollapsedPartTypes": [str(v).strip() for v in (collapsed_keys or []) if str(v).strip()],
                }
                patch = {"cutlist": latest_payload, "cutlistJson": json.dumps(latest_payload)}
                saved = False
                if project_id and company_id and hasattr(self.app.company, "update_job"):
                    try:
                        self.app.company.update_job(company_id, project_id, patch)
                        saved = True
                    except Exception:
                        saved = False
                if not saved:
                    saved = self._save_project_patch(patch)
                if saved and isinstance(source_project, dict):
                    source_project.update(patch)
            except Exception:
                pass

        dialog = CNCCutlistDialog(
            project_name=str(raw.get("name") or "Project"),
            designer_name=designer_name,
            rows=rows_for_output,
            source_rows=indexed_rows,
            visibility_map=visibility_map,
            on_visibility_changed=_on_visibility_changed,
            collapsed_part_types=collapsed_part_types,
            on_collapsed_changed=_on_collapsed_changed,
            show_grain_column=self._project_has_grain_board(raw),
            board_display_map=self._project_board_display_map(raw),
            board_sheet_size_map=self._project_board_sheet_size_map(raw),
            board_edging_map=self._project_board_edging_map(raw),
            part_type_colors=self._company_part_type_color_map(),
            cabinetry_part_types=self._company_part_type_cabinetry_map(),
            theme_color=str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT),
            parent=None,
        )
        dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        if not hasattr(self, "_open_cnc_dialogs"):
            self._open_cnc_dialogs = []
        self._open_cnc_dialogs.append(dialog)

        def _on_close(_result: int = 0, dlg=dialog) -> None:
            self._open_cnc_dialogs = [d for d in self._open_cnc_dialogs if d is not dlg]

        dialog.finished.connect(_on_close)
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def _open_order_placeholder(self) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "Order", "Select a project first.")
            return
        can_prod_view = True
        can_prod_edit = True
        if hasattr(self, "_project_tab_access"):
            try:
                can_prod_view, can_prod_edit = self._project_tab_access(raw, "production")
            except Exception:
                can_prod_view, can_prod_edit = True, True
        if not can_prod_view:
            QMessageBox.warning(self, "Order", "You do not have permission to view the Production tab.")
            return
        if not can_prod_edit:
            QMessageBox.warning(self, "Order", "You do not have permission to edit the Production tab.")
            return

        payload = self._project_order_payload(raw)
        payload["drawers"] = self._build_drawer_order_rows(raw, payload.get("drawers") if isinstance(payload.get("drawers"), list) else [])
        hinge_options = self._order_hinge_options(raw)
        theme_hex = str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT)

        def _on_change(next_payload: dict) -> None:
            self._save_project_order_payload(raw, dict(next_payload or {}))

        def _refresh_drawers(existing_drawers: list[dict]) -> list[dict]:
            live = self._selected_project() if isinstance(self._selected_project(), dict) else raw
            return self._build_drawer_order_rows(live, existing_drawers)

        dialog = ProductionOrderDialog(
            project_name=str(raw.get("name") or "Project"),
            payload=payload,
            hinge_options=hinge_options,
            on_change=_on_change,
            on_refresh_drawers=_refresh_drawers,
            theme_color=theme_hex,
            parent=None,
        )
        dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        if not hasattr(self, "_open_order_dialogs"):
            self._open_order_dialogs = []
        self._open_order_dialogs.append(dialog)

        def _on_close(_result: int = 0, dlg=dialog) -> None:
            try:
                self._save_project_order_payload(raw, dlg.payload())
            except Exception:
                pass
            self._open_order_dialogs = [d for d in self._open_order_dialogs if d is not dlg]

        dialog.finished.connect(_on_close)
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def _open_nesting_layout(self) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "Nesting Layout", "Select a project first.")
            return
        can_prod_view = True
        if hasattr(self, "_project_tab_access"):
            try:
                can_prod_view, _can_prod_edit = self._project_tab_access(raw, "production")
            except Exception:
                can_prod_view = True
        if not can_prod_view:
            QMessageBox.warning(self, "Nesting Layout", "You do not have permission to view the Production tab.")
            return
        rows, _entry_drafts, collapsed_part_types = self._load_project_cutlist_rows(raw)
        cut_payload = self._project_cutlist_payload(raw)
        rows, rows_migrated = self._migrate_cutlist_board_values(raw, rows)
        if rows_migrated:
            try:
                migrated_payload = {
                    "rows": rows,
                    "entryDraftRows": _entry_drafts,
                    "collapsedPartTypes": collapsed_part_types,
                    "rooms": self._project_cutlist_rooms(raw),
                    "roomsWithPieces": self._project_cutlist_seen_piece_rooms(raw),
                    "activeRoom": str(cut_payload.get("activeRoom") or "All"),
                    "activePartType": str(cut_payload.get("activePartType") or ""),
                    "cncCollapsedPartTypes": [str(v).strip() for v in (cut_payload.get("cncCollapsedPartTypes") or []) if str(v).strip()],
                    "nestingCollapsedPartTypes": [str(v).strip() for v in (cut_payload.get("nestingCollapsedPartTypes") or []) if str(v).strip()],
                }
                self._save_project_patch({"cutlist": migrated_payload, "cutlistJson": json.dumps(migrated_payload)})
            except Exception:
                pass
        project_id = str((raw or {}).get("id") or "").strip()
        company_id = getattr(self.router.session, "company_id", None)
        nesting_collapsed_part_types = [str(v).strip() for v in (cut_payload.get("nestingCollapsedPartTypes") or []) if str(v).strip()]
        indexed_rows: list[dict] = []
        visibility_map: dict[str, bool] = {}
        include_in_nesting_map = self._company_part_type_include_in_nesting_map()
        for idx, row in enumerate(rows):
            entry = dict(row)
            part_type = str(entry.get("partType") or entry.get("part_type") or "").strip()
            part_key = self._part_key(part_type)
            if part_key and not bool(include_in_nesting_map.get(part_key, True)):
                continue
            raw_key = entry.get("__id")
            cutlist_key = str(raw_key).strip() if raw_key is not None and str(raw_key).strip() else str(idx)
            entry["__cutlist_key"] = cutlist_key
            if "includeInNesting" not in entry:
                entry["includeInNesting"] = True
            visibility_map[cutlist_key] = bool(entry.get("includeInNesting", True))
            indexed_rows.append(entry)
        indexed_rows_all_visible: list[dict] = []
        for row in indexed_rows:
            item = dict(row)
            item["includeInNesting"] = True
            indexed_rows_all_visible.append(item)
        rows_for_output = self._expand_cutlist_rows_for_manufacturing(raw, indexed_rows_all_visible)

        def _on_visibility_changed(new_map: dict[str, bool]) -> None:
            try:
                source_project = None
                for row_obj in (self._projects_all or []):
                    rid = str((row_obj or {}).get("id") or "").strip()
                    if rid == project_id:
                        source_project = row_obj
                        break
                source_project = source_project or raw
                latest_rows, latest_drafts, latest_collapsed = self._load_project_cutlist_rows(source_project)
                for i, item in enumerate(latest_rows):
                    if not isinstance(item, dict):
                        continue
                    raw_key = item.get("__id")
                    key = str(raw_key).strip() if raw_key is not None and str(raw_key).strip() else str(i)
                    item["includeInNesting"] = bool(new_map.get(key, True))
                source_cut_payload = self._project_cutlist_payload(source_project)
                latest_payload = {
                    "rows": latest_rows,
                    "entryDraftRows": latest_drafts,
                    "collapsedPartTypes": latest_collapsed,
                    "rooms": self._project_cutlist_rooms(raw),
                    "roomsWithPieces": self._project_cutlist_seen_piece_rooms(raw),
                    "activeRoom": str(cut_payload.get("activeRoom") or "All"),
                    "activePartType": str(cut_payload.get("activePartType") or ""),
                    "cncCollapsedPartTypes": [str(v).strip() for v in (source_cut_payload.get("cncCollapsedPartTypes") or []) if str(v).strip()],
                    "nestingCollapsedPartTypes": [str(v).strip() for v in (source_cut_payload.get("nestingCollapsedPartTypes") or []) if str(v).strip()],
                }
                patch = {"cutlist": latest_payload, "cutlistJson": json.dumps(latest_payload)}
                saved = False
                if project_id and company_id and hasattr(self.app.company, "update_job"):
                    try:
                        self.app.company.update_job(company_id, project_id, patch)
                        saved = True
                    except Exception:
                        saved = False
                if not saved:
                    saved = self._save_project_patch(patch)
                if saved and isinstance(source_project, dict):
                    source_project.update(patch)
            except Exception:
                pass

        def _on_collapsed_changed(collapsed_keys: list[str]) -> None:
            try:
                source_project = None
                for row_obj in (self._projects_all or []):
                    rid = str((row_obj or {}).get("id") or "").strip()
                    if rid == project_id:
                        source_project = row_obj
                        break
                source_project = source_project or raw
                latest_rows, latest_drafts, latest_collapsed = self._load_project_cutlist_rows(source_project)
                source_cut_payload = self._project_cutlist_payload(source_project)
                latest_payload = {
                    "rows": latest_rows,
                    "entryDraftRows": latest_drafts,
                    "collapsedPartTypes": latest_collapsed,
                    "rooms": self._project_cutlist_rooms(raw),
                    "roomsWithPieces": self._project_cutlist_seen_piece_rooms(raw),
                    "activeRoom": str(cut_payload.get("activeRoom") or "All"),
                    "activePartType": str(cut_payload.get("activePartType") or ""),
                    "cncCollapsedPartTypes": [str(v).strip() for v in (source_cut_payload.get("cncCollapsedPartTypes") or []) if str(v).strip()],
                    "nestingCollapsedPartTypes": [str(v).strip() for v in (collapsed_keys or []) if str(v).strip()],
                }
                patch = {"cutlist": latest_payload, "cutlistJson": json.dumps(latest_payload)}
                saved = False
                if project_id and company_id and hasattr(self.app.company, "update_job"):
                    try:
                        self.app.company.update_job(company_id, project_id, patch)
                        saved = True
                    except Exception:
                        saved = False
                if not saved:
                    saved = self._save_project_patch(patch)
                if saved and isinstance(source_project, dict):
                    source_project.update(patch)
            except Exception:
                pass

        dialog = NestingLayoutDialog(
            project_name=str(raw.get("name") or "Project"),
            rows=rows_for_output,
            source_rows=indexed_rows,
            visibility_map=visibility_map,
            on_visibility_changed=_on_visibility_changed,
            collapsed_part_types=nesting_collapsed_part_types,
            on_collapsed_changed=_on_collapsed_changed,
            settings=self._project_nesting_settings(raw),
            board_sheet_sizes=self._project_board_sheet_size_map(raw),
            board_display_map=self._project_board_display_map(raw),
            board_grain_map=self._project_board_grain_map(raw),
            part_type_colors=self._company_part_type_color_map(),
            cabinetry_part_types=self._company_part_type_cabinetry_map(),
            on_edit_part=lambda row_id: self._open_cutlist_editor(focus_row_id=int(row_id)),
            parent=self,
        )
        dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self._open_nesting_dialogs.append(dialog)

        def _on_close(_result: int = 0, dlg=dialog) -> None:
            self._open_nesting_dialogs = [d for d in self._open_nesting_dialogs if d is not dlg]

        dialog.finished.connect(_on_close)
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()

    def _edit_selected_project_status(self) -> None:
        raw = self._selected_project()
        if not raw:
            return
        self._suspend_project_settings_autosave_until = time.monotonic() + 0.8
        anchor = self._project_status_btn if isinstance(self._project_status_btn, QPushButton) else None
        if hasattr(self, "_open_dashboard_status_picker"):
            self._open_dashboard_status_picker(raw, anchor)
            return
        options = self._project_status_options()
        current_status = str(raw.get("status") or "New")
        current_index = options.index(current_status) if current_status in options else 0
        chosen, ok = QInputDialog.getItem(self, "Set Status", "Project Status", options, current_index, False)
        if ok and chosen and chosen != current_status:
            self._change_project_status(raw, str(chosen))
    def _status_colors(self, status: str) -> tuple[str, str]:
        defaults = {
            "new": "#E8F0FF",
            "running": "#E3F5E1",
            "in production": "#E3F5E1",
            "drafting": "#EDE9FF",
            "quoting": "#FFF3E0",
            "ready for cnc": "#E8F0FF",
            "completed": "#E3F5E1",
            "paused": "#FFF3E0",
        }
        key = str(status or "").strip().lower()
        color_map = dict(defaults)
        for row in (self._company.get("projectStatuses") or []):
            if isinstance(row, dict):
                name = str(row.get("name") or "").strip().lower()
                if not name:
                    continue
                color_map[name] = self._normalize_hex(str(row.get("color") or "#3060D0"), "#E8F0FF")

        bg = color_map.get(key, "#E8EAF0")
        hex_color = self._normalize_hex(bg, "#E8EAF0")
        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)
        luminance = (0.299 * r + 0.587 * g + 0.114 * b)
        fg = "#1F2937" if luminance >= 170 else "#FFFFFF"
        return hex_color, fg

    def _lighten_hex(self, hex_color: str, amount: float) -> str:
        base = self._normalize_hex(hex_color, "#E8EAF0")
        ratio = max(0.0, min(1.0, float(amount)))
        r = int(base[1:3], 16)
        g = int(base[3:5], 16)
        b = int(base[5:7], 16)
        rr = int(r + (255 - r) * ratio)
        gg = int(g + (255 - g) * ratio)
        bb = int(b + (255 - b) * ratio)
        return f"#{rr:02X}{gg:02X}{bb:02X}"

    def _status_pill_colors(self, status: str) -> tuple[str, str, str]:
        border, _ = self._status_colors(status)
        bg = self._lighten_hex(border, 0.78)
        fg = border
        return bg, fg, border

    def _apply_status_button_style(self, button: QPushButton, status: str) -> None:
        bg, fg, _border = self._status_pill_colors(status)
        button.setStyleSheet(
            "QPushButton {"
            f"background: {bg}; color: {fg}; border: none; border-radius: 10px;"
            "padding: 6px 10px; font-size: 12px; font-weight: 700;"
            "}"
        )
    def _project_status_options(self) -> list[str]:
        options = []
        for row in (self._company.get("projectStatuses") or []):
            if isinstance(row, dict):
                name = str(row.get("name") or "").strip()
                if name:
                    options.append(name)
        if not options:
            options = sorted({str((row or {}).get("status") or "New").strip() for row in self._projects_all if row})
        if "New" not in options:
            options.insert(0, "New")
        return [x for x in options if x]

    def _change_project_status(self, raw: dict, new_status: str) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        job_id = str((raw or {}).get("id") or "").strip()
        if not company_id or not job_id:
            QMessageBox.critical(self, "Status update failed", "Project id is missing.")
            return

        self._flush_visible_embedded_board_settings()

        is_completed = self._is_completed_status(new_status)
        patch = {"status": new_status}
        patch["completedAtIso"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) if is_completed else ""

        try:
            if hasattr(self.app.company, "update_job"):
                self.app.company.update_job(company_id, job_id, patch)
            elif hasattr(self.app.company, "update_job_status"):
                self.app.company.update_job_status(company_id, job_id, new_status)
            else:
                raise RuntimeError("Status update method not available")
        except Exception as exc:
            QMessageBox.critical(self, "Status update failed", str(exc))
            return

        for row in self._projects_all:
            rid = str((row or {}).get("id") or "").strip()
            if rid == job_id:
                row["status"] = new_status
                row["completedAtIso"] = str(patch.get("completedAtIso") or "")
                break

        self._refresh_projects_status_options()
        self._apply_projects_filters(refresh_details=False)
        try:
            if isinstance(raw, dict):
                self._selected_project_id = str(raw.get("id") or "").strip() or self._selected_project_id
                if hasattr(self, "_project_status_btn") and isinstance(self._project_status_btn, QPushButton):
                    self._project_status_btn.setText(new_status)
                    self._apply_status_button_style(self._project_status_btn, new_status)
                if hasattr(self, "_dashboard_detail_status_btn") and isinstance(self._dashboard_detail_status_btn, QPushButton):
                    self._dashboard_detail_status_btn.setText(new_status)
                    self._apply_status_button_style(self._dashboard_detail_status_btn, new_status)
        except Exception:
            pass
        self._sync_dashboard_stats()

    def _open_project_details(self, item: QTableWidgetItem) -> None:
        raw = item.data(Qt.ItemDataRole.UserRole)
        if raw is None and self._projects_table:
            raw = self._projects_table.item(item.row(), 0).data(Qt.ItemDataRole.UserRole)
        if not isinstance(raw, dict):
            return

        if item.column() == 2:
            options = self._project_status_options()
            current_status = str(raw.get("status") or "New")
            current_index = options.index(current_status) if current_status in options else 0
            chosen, ok = QInputDialog.getItem(self, "Set Status", "Project Status", options, current_index, False)
            if ok and chosen and chosen != current_status:
                self._change_project_status(raw, str(chosen))
            return

        name = str(raw.get("name") or "Untitled")
        status = str(raw.get("status") or "New")
        client = str(raw.get("client") or raw.get("clientName") or "-")
        notes = str(raw.get("notes") or "")
        created = self._short_iso(str(raw.get("createdAtIso") or ""))

        QMessageBox.information(
            self,
            "Project details",
            f"Name: {name}\nClient: {client}\nStatus: {status}\nCreated: {created}\n\nNotes:\n{notes or '-'}",
        )


