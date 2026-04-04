from __future__ import annotations

import json

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import QMessageBox

from cutsmart.qtui.screens.cutlist_dialog import CutlistDialog


class ProjectWorkflowMixin:

    def _selected_project(self) -> dict | None:
        if not self._selected_project_id:
            return None
        for row in self._projects_all:
            rid = str((row or {}).get("id") or "").strip()
            if rid == self._selected_project_id:
                return row
        return None

    def _save_project_patch(self, patch: dict) -> bool:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            fallback = getattr(self, "_dashboard_detail_raw", None)
            fallback_id = str((fallback or {}).get("id") or "").strip() if isinstance(fallback, dict) else ""
            if fallback_id:
                for row in (self._projects_all or []):
                    rid = str((row or {}).get("id") or "").strip()
                    if rid == fallback_id:
                        raw = row
                        break
                if not isinstance(raw, dict):
                    raw = dict(fallback)
        company_id = getattr(self.router.session, "company_id", None)
        job_id = str((raw or {}).get("id") or "").strip()
        if not raw or not company_id or not job_id:
            QMessageBox.critical(self, "Save failed", "No project selected.")
            return False
        production_keys = {
            "cutlist",
            "cutlistJson",
            "projectSettings",
            "projectSettingsJson",
            "orderSheet",
            "orderSheetJson",
        }
        is_production_patch = bool(any(str(k) in production_keys for k in (patch or {}).keys()))
        queue_service = getattr(self.app, "offline_patch_queue", None)
        if is_production_patch and queue_service is not None:
            try:
                queue_service.flush(self.app.company, company_id=str(company_id), scope="production")
            except Exception:
                pass
        # Global write guard: view-only users must not be able to modify project data.
        level_fn = getattr(self, "_project_user_access_level", None)
        if callable(level_fn) and str(level_fn(raw)) != "edit":
            QMessageBox.warning(self, "Read-only project", "You have view-only access to this project.")
            return False
        try:
            self.app.company.update_job(company_id, job_id, patch)
        except Exception as exc:
            if is_production_patch and queue_service is not None:
                queued = False
                try:
                    queued = bool(queue_service.enqueue(str(company_id), str(job_id), dict(patch), scope="production"))
                except Exception:
                    queued = False
                if queued:
                    raw.update(patch)
                    if isinstance(getattr(self, "_dashboard_detail_raw", None), dict):
                        dashboard_id = str((self._dashboard_detail_raw or {}).get("id") or "").strip()
                        if dashboard_id and dashboard_id == job_id:
                            self._dashboard_detail_raw.update(patch)
                    return True
            QMessageBox.critical(self, "Save failed", str(exc))
            return False
        raw.update(patch)
        if isinstance(getattr(self, "_dashboard_detail_raw", None), dict):
            dashboard_id = str((self._dashboard_detail_raw or {}).get("id") or "").strip()
            if dashboard_id and dashboard_id == job_id:
                self._dashboard_detail_raw.update(patch)
        return True

    def _delete_selected_project(self, confirm: bool = True, from_dashboard: bool = False) -> None:
        raw = self._selected_project()
        if not isinstance(raw, dict):
            QMessageBox.warning(self, "Delete Project", "Select a project first.")
            return
        company_id = getattr(self.router.session, "company_id", None)
        job_id = str((raw or {}).get("id") or "").strip()
        name = str((raw or {}).get("name") or "this project").strip() or "this project"
        if not company_id or not job_id:
            QMessageBox.warning(self, "Delete Project", "Project details are incomplete.")
            return
        if confirm:
            answer = QMessageBox.question(
                self,
                "Delete Project",
                f"Are you sure you want to delete \"{name}\"?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if answer != QMessageBox.StandardButton.Yes:
                return
        try:
            if hasattr(self.app.company, "delete_job"):
                deleter_uid = str(getattr(self.router.session, "uid", "") or "").strip()
                deleter_name = str((getattr(self, "_user_profile", {}) or {}).get("displayName") or "").strip()
                self.app.company.delete_job(
                    company_id,
                    job_id,
                    deleted_by_uid=deleter_uid,
                    deleted_by_name=deleter_name,
                )
            else:
                raise ValueError("Delete project is not supported by this backend.")
        except Exception as exc:
            QMessageBox.critical(self, "Delete failed", str(exc))
            return

        self._selected_project_id = None
        self._dashboard_detail_raw = None
        if from_dashboard:
            self._show_dashboard_projects_list()
        self._refresh_projects(silent=True)
        self._populate_project_details(None)
        self._populate_dashboard_project_details(None)
        QMessageBox.information(self, "Deleted", "Project moved to Recently Deleted.")

    def _restore_project_by_id(self, job_id: str) -> bool:
        company_id = getattr(self.router.session, "company_id", None)
        project_id = str(job_id or "").strip()
        if not company_id or not project_id:
            return False
        if not hasattr(self.app.company, "restore_job"):
            QMessageBox.warning(self, "Restore Project", "Restore is not supported by this backend.")
            return False
        try:
            self.app.company.restore_job(company_id, project_id)
        except Exception as exc:
            QMessageBox.critical(self, "Restore failed", str(exc))
            return False
        self._refresh_projects(silent=True)
        return True

    def _delete_project_permanently_by_id(self, job_id: str) -> bool:
        company_id = getattr(self.router.session, "company_id", None)
        project_id = str(job_id or "").strip()
        if not company_id or not project_id:
            return False
        if not hasattr(self.app.company, "delete_job_permanently"):
            QMessageBox.warning(self, "Permanent Delete", "Permanent delete is not supported by this backend.")
            return False
        try:
            self.app.company.delete_job_permanently(company_id, project_id)
        except Exception as exc:
            QMessageBox.critical(self, "Permanent Delete failed", str(exc))
            return False
        self._refresh_projects(silent=True)
        return True

    def _save_selected_project_client(self) -> None:
        raw = self._selected_project()
        level_fn = getattr(self, "_project_user_access_level", None)
        if callable(level_fn) and str(level_fn(raw)) != "edit":
            QMessageBox.warning(self, "Client Details", "You have view-only access to this project.")
            return
        address_input = self._detail_client_address.text().strip() if self._detail_client_address else ""
        addr_only, region_only = self._split_address_region(address_input)
        patch = {
            "client": self._detail_client_name.text().strip() if self._detail_client_name else "",
            "clientName": self._detail_client_name.text().strip() if self._detail_client_name else "",
            "clientPhone": self._detail_client_phone.text().strip() if self._detail_client_phone else "",
            "clientNumber": self._detail_client_phone.text().strip() if self._detail_client_phone else "",
            "clientEmail": self._detail_client_email.text().strip() if self._detail_client_email else "",
            "region": region_only,
            "clientAddress": addr_only,
        }
        if self._save_project_patch(patch):
            self._apply_projects_filters()
            QMessageBox.information(self, "Saved", "Client details updated.")

    def _save_selected_project_notes(self) -> None:
        raw = self._selected_project()
        level_fn = getattr(self, "_project_user_access_level", None)
        if callable(level_fn) and str(level_fn(raw)) != "edit":
            QMessageBox.warning(self, "Notes", "You have view-only access to this project.")
            return
        if self._autosave_notes_from_editor("detail", notify=True):
            return

    def _refresh_open_cutlist_board_sources(self, raw: dict | None = None) -> None:
        project_raw = raw if isinstance(raw, dict) else self._selected_project()
        if not isinstance(project_raw, dict):
            return
        project_id = str((project_raw or {}).get("id") or "").strip()
        board_options = self._project_board_options(project_raw)
        board_sheet_sizes = self._project_board_sheet_size_map(project_raw)
        board_thickness_map = self._project_board_thickness_map(project_raw)
        board_display_map = self._project_board_display_map(project_raw)
        board_lacquer_map = self._project_board_lacquer_map(project_raw)
        for dlg in list(self._open_cutlist_dialogs or []):
            if not isinstance(dlg, CutlistDialog):
                continue
            if not dlg.isVisible():
                continue
            dlg_project_id = str(dlg.property("projectId") or "").strip()
            if project_id and dlg_project_id and dlg_project_id != project_id:
                continue
            try:
                dlg.update_board_sources(
                    board_options=board_options,
                    board_sheet_sizes=board_sheet_sizes,
                    board_thickness_map=board_thickness_map,
                    board_display_map=board_display_map,
                    board_lacquer_map=board_lacquer_map,
                )
            except Exception:
                pass

    def _open_cutlist_editor(self, focus_row_id: int | None = None) -> None:
        raw = self._selected_project()
        if not raw:
            QMessageBox.warning(self, "Cutlist", "Select a project first.")
            return
        can_prod_view = True
        can_prod_edit = True
        if hasattr(self, "_project_tab_access"):
            try:
                can_prod_view, can_prod_edit = self._project_tab_access(raw, "production")
            except Exception:
                can_prod_view, can_prod_edit = True, True
        if not can_prod_view:
            QMessageBox.warning(self, "Cutlist", "You do not have permission to view the Production tab.")
            return
        if not can_prod_edit:
            QMessageBox.warning(self, "Cutlist", "You do not have permission to edit the Production tab.")
            return

        focus_id = int(focus_row_id) if focus_row_id is not None else -1
        if focus_id > 0:
            for existing in reversed(self._open_cutlist_dialogs):
                if isinstance(existing, CutlistDialog) and existing.isVisible():
                    existing.raise_()
                    existing.activateWindow()
                    if existing.focus_row_by_id(focus_id):
                        return
                    # If the row cannot be focused in the existing dialog (stale/local mismatch),
                    # reopen a fresh dialog from current project payload and focus there.
                    try:
                        existing.close()
                    except Exception:
                        pass
                    break

        rows, entry_drafts, collapsed_part_types = self._load_project_cutlist_rows(raw)
        initial_measure_name_suggestions: dict[str, list[str]] = {}
        initial_measure_name_part_types: dict[str, dict[str, str]] = {}
        try:
            sales_payload = self._project_sales_payload(raw) if hasattr(self, "_project_sales_payload") else {}
            initial_payload = sales_payload.get("initialMeasureCutlist") if isinstance(sales_payload, dict) else {}
            initial_rows = initial_payload.get("rows") if isinstance(initial_payload, dict) and isinstance(initial_payload.get("rows"), list) else []
            bucket_seen: dict[str, set[str]] = {}

            def _push(bucket: str, name_txt: str, part_type_txt: str = "") -> None:
                if bucket not in initial_measure_name_suggestions:
                    initial_measure_name_suggestions[bucket] = []
                    bucket_seen[bucket] = set()
                key = " ".join(str(name_txt or "").lower().split())
                if not key or key in bucket_seen[bucket]:
                    return
                bucket_seen[bucket].add(key)
                initial_measure_name_suggestions[bucket].append(str(name_txt or "").strip())
                bucket_meta = initial_measure_name_part_types.setdefault(bucket, {})
                part_text = str(part_type_txt or "").strip()
                if part_text and key not in bucket_meta:
                    bucket_meta[key] = part_text

            for row in initial_rows:
                if not isinstance(row, dict):
                    continue
                room_txt = str(row.get("room") or "").strip()
                room_key = " ".join(room_txt.lower().split()) or "all"
                part_type_txt = str(row.get("partType") or "").strip()
                part_type_key = " ".join(part_type_txt.lower().split())
                name_txt = str(row.get("name") or "").strip()
                if not name_txt:
                    continue
                _push("all", name_txt, part_type_txt)
                _push(room_key, name_txt, part_type_txt)
                if part_type_key:
                    _push(f"pt:{part_type_key}", name_txt, part_type_txt)
                    _push(f"{room_key}|pt:{part_type_key}", name_txt, part_type_txt)
        except Exception:
            initial_measure_name_suggestions = {}
            initial_measure_name_part_types = {}
        cutlist_payload = self._project_cutlist_payload(raw)
        active_room = str(cutlist_payload.get("activeRoom") or "All").strip() or "All"
        active_part_type = str(cutlist_payload.get("activePartType") or "").strip()
        room_seed = self._project_cutlist_rooms(raw)
        seen_piece_rooms = self._project_cutlist_seen_piece_rooms(raw)
        rows, rows_migrated = self._migrate_cutlist_board_values(raw, rows)
        entry_drafts, drafts_migrated = self._migrate_cutlist_board_values(raw, entry_drafts)
        if rows_migrated or drafts_migrated:
            try:
                migrated_payload = {
                    "rows": rows,
                    "entryDraftRows": entry_drafts,
                    "collapsedPartTypes": collapsed_part_types,
                    "rooms": room_seed,
                    "roomsWithPieces": seen_piece_rooms,
                    "activeRoom": active_room,
                    "activePartType": active_part_type,
                }
                self._save_project_patch({"cutlist": migrated_payload, "cutlistJson": json.dumps(migrated_payload)})
            except Exception:
                pass

        def _on_cutlist_change(payload: dict) -> None:
            ok = self._save_project_patch({"cutlist": dict(payload or {}), "cutlistJson": json.dumps(dict(payload or {}))})
            if ok and hasattr(self, "_refresh_visible_board_lock_state"):
                try:
                    self._refresh_visible_board_lock_state()
                except Exception:
                    pass

        dialog = CutlistDialog(
            rows=rows,
            entry_draft_rows=entry_drafts,
            collapsed_part_types=collapsed_part_types,
            project_name=str(raw.get("name") or "Project"),
            company_name=str((self._company or {}).get("name") or ""),
            print_meta=self._project_cutlist_print_meta(raw),
            part_type_options=self._company_part_type_names(),
            part_type_colors=self._company_part_type_color_map(),
            part_type_autoclash=self._company_part_type_autoclash_map(),
            part_type_cabinetry=self._company_part_type_cabinetry_map(),
            part_type_drawer=self._company_part_type_drawer_map(),
            part_type_include_in_cutlists=self._company_part_type_include_in_cutlists_map(),
            drawer_back_height_letters=self._project_drawer_back_height_letters(raw),
            drawer_breakdown_spec=self._project_drawer_breakdown_spec(raw),
            measurement_unit=str((self._company or {}).get("measurementUnit") or "mm"),
            board_options=self._project_board_options(raw),
            board_sheet_sizes=self._project_board_sheet_size_map(raw),
            board_thickness_map=self._project_board_thickness_map(raw),
            board_display_map=self._project_board_display_map(raw),
            board_lacquer_map=self._project_board_lacquer_map(raw),
            nesting_settings=self._project_nesting_settings(raw),
            include_grain=self._project_has_grain_board(raw),
            enabled_columns=self._company_cutlist_columns_for_mode("production"),
            project_rooms=room_seed,
            part_name_suggestions_by_room=initial_measure_name_suggestions,
            part_name_suggestion_part_types_by_room=initial_measure_name_part_types,
            seen_piece_rooms=seen_piece_rooms,
            active_room=active_room,
            active_part_type=active_part_type,
            on_change=_on_cutlist_change,
            parent=None,
        )
        dialog.setProperty("projectId", str(raw.get("id") or "").strip())
        dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self._open_cutlist_dialogs.append(dialog)

        def _on_close(_result: int = 0, dlg=dialog) -> None:
            try:
                payload = dlg.cutlist_payload()
                ok = self._save_project_patch({"cutlist": payload, "cutlistJson": json.dumps(payload)})
                if ok and hasattr(self, "_refresh_visible_board_lock_state"):
                    try:
                        self._refresh_visible_board_lock_state()
                    except Exception:
                        pass
            except Exception:
                pass
            self._open_cutlist_dialogs = [d for d in self._open_cutlist_dialogs if d is not dlg]

        dialog.finished.connect(_on_close)
        dialog.show()
        dialog.raise_()
        dialog.activateWindow()
        if focus_id > 0:
            QTimer.singleShot(0, lambda rid=focus_id, dlg=dialog: dlg.focus_row_by_id(rid))


