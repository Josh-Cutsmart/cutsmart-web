from __future__ import annotations

import json

from PySide6.QtWidgets import QMessageBox, QTextEdit


class ProjectDataMixin:

    def _project_cutlist_print_meta(self, raw: dict | None) -> dict:
        payload = self._load_project_settings_payload(raw)
        src = dict(payload or {})
        src.update(dict(raw or {}))
        designer_name = ""
        creator_name_fn = getattr(self, "_project_creator_display_name", None)
        if callable(creator_name_fn):
            try:
                designer_name = str(creator_name_fn(raw) or "").strip()
            except Exception:
                designer_name = ""
        if not designer_name:
            designer_name = str(
                src.get("createdByDisplayName")
                or src.get("projectCreatorDisplayName")
                or src.get("creatorDisplayName")
                or src.get("createdByName")
                or src.get("designer")
                or ""
            ).strip()
        return {
            "carcassThickness": str(src.get("carcassThickness") or ""),
            "baseCabHeight": str(src.get("baseCabHeight") or ""),
            "tallCabHeight": str(src.get("tallCabHeight") or ""),
            "hingeType": str(src.get("hingeType") or ""),
            "designer": designer_name,
            "themeColor": str(
                src.get("themeColor")
                or (getattr(self, "_company", {}) or {}).get("themeColor")
                or getattr(self, "_company_theme_hex", "")
                or ""
            ).strip(),
            "companyName": str(
                src.get("companyName")
                or (getattr(self, "_company", {}) or {}).get("name")
                or ""
            ).strip(),
        }


    def _open_selected_project_notes(self) -> None:
        if not self._selected_project():
            QMessageBox.warning(self, "Notes", "Select a project first.")
            return
        raw = self._selected_project()
        can_edit = False
        level_fn = getattr(self, "_project_user_access_level", None)
        if callable(level_fn):
            can_edit = str(level_fn(raw)) == "edit"
        use_dashboard = bool(self._dashboard_project_detail_card and self._dashboard_project_detail_card.isVisible())
        if use_dashboard:
            self._set_dashboard_detail_tab("general")
            self._set_general_side_panel("notes", use_dashboard=True)
        else:
            self._set_project_detail_tab("general")
            self._set_general_side_panel("notes", use_dashboard=False)
        editor = self._dashboard_detail_notes if use_dashboard else self._detail_notes
        if isinstance(editor, QTextEdit):
            editor.setReadOnly(not can_edit)
            editor.setFocus()
            cursor = editor.textCursor()
            cursor.movePosition(cursor.MoveOperation.End)
            editor.setTextCursor(cursor)


    def _load_project_settings_payload(self, raw: dict | None) -> dict:
        payload_obj = (raw or {}).get("projectSettings")
        if isinstance(payload_obj, str):
            try:
                payload_obj = json.loads(payload_obj)
            except Exception:
                payload_obj = None
        payload_obj = dict(payload_obj or {}) if isinstance(payload_obj, dict) else {}

        payload_json = {}
        legacy = (raw or {}).get("projectSettingsJson")
        if isinstance(legacy, str) and legacy.strip():
            try:
                parsed = json.loads(legacy)
                if isinstance(parsed, dict):
                    payload_json = dict(parsed)
            except Exception:
                payload_json = {}

        # Merge both to avoid stale state when one field lags behind the other.
        # Prefer JSON overlay because many save paths serialize through projectSettingsJson.
        merged = dict(payload_obj)
        merged.update(payload_json)
        return merged


    def _load_project_cutlist_rows(self, raw: dict | None) -> tuple[list[dict], list[dict], list[str]]:
        payload = (raw or {}).get("cutlist")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = None
        if not isinstance(payload, dict):
            payload = {}

        rows = payload.get("rows")
        if not isinstance(rows, list):
            rows = []
        entry_drafts = payload.get("entryDraftRows")
        if not isinstance(entry_drafts, list):
            entry_drafts = []
        collapsed = payload.get("collapsedPartTypes")
        if not isinstance(collapsed, list):
            collapsed = []

        legacy = (raw or {}).get("cutlistJson")
        if isinstance(legacy, str) and legacy.strip():
            try:
                legacy_payload = json.loads(legacy)
            except Exception:
                legacy_payload = None
            if isinstance(legacy_payload, dict):
                if not rows:
                    legacy_rows = legacy_payload.get("rows")
                    if isinstance(legacy_rows, list):
                        rows = legacy_rows
                if not entry_drafts:
                    legacy_drafts = legacy_payload.get("entryDraftRows")
                    if isinstance(legacy_drafts, list):
                        entry_drafts = legacy_drafts
                if not collapsed:
                    legacy_collapsed = legacy_payload.get("collapsedPartTypes")
                    if isinstance(legacy_collapsed, list):
                        collapsed = legacy_collapsed

        clean_rows = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            row = dict(r)
            row["room"] = str(row.get("room") or "").strip()
            clean_rows.append(row)
        clean_drafts = []
        for r in entry_drafts:
            if not isinstance(r, dict):
                continue
            row = dict(r)
            row["room"] = str(row.get("room") or "").strip()
            clean_drafts.append(row)
        clean_collapsed = [str(v).strip() for v in collapsed if str(v).strip()]
        return clean_rows, clean_drafts, clean_collapsed


    def _project_nesting_settings(self, raw: dict | None) -> dict:
        company_nesting = (self._company.get("nestingSettings") or {}) if isinstance(self._company, dict) else {}
        payload = self._load_project_settings_payload(raw)
        out = {
            "sheetWidth": str(payload.get("sheetWidth") or company_nesting.get("sheetWidth") or "1220"),
            "sheetHeight": str(payload.get("sheetHeight") or company_nesting.get("sheetHeight") or "2440"),
            "kerf": str(payload.get("kerf") or company_nesting.get("kerf") or "5"),
            "margin": str(payload.get("margin") or company_nesting.get("margin") or "10"),
        }
        return out


    def _job_image_paths(self, raw: dict | None) -> list[str]:
        data = (raw or {}).get("projectImages")
        if data in (None, ""):
            data = (raw or {}).get("imagePaths") or (raw or {}).get("images")
        if isinstance(data, str):
            txt = data.strip()
            if not txt:
                data = []
            else:
                try:
                    parsed = json.loads(txt)
                    data = parsed if isinstance(parsed, list) else [txt]
                except Exception:
                    data = [x.strip() for x in txt.split(",") if x.strip()]
        paths = [str(x).strip() for x in (data or []) if str(x).strip()]
        return paths[:25]


