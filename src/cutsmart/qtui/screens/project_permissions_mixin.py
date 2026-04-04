from __future__ import annotations

import json

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QComboBox, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

from cutsmart.qtui.screens.dashboard_controls import VComboBox


class ProjectPermissionsMixin:

    def _can_manage_project_permissions(self, raw: dict | None) -> bool:
        if not isinstance(raw, dict):
            return False
        level_fn = getattr(self, "_project_user_access_level", None)
        if callable(level_fn):
            return str(level_fn(raw)) == "edit"
        uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not uid:
            return False
        payload = self._load_project_settings_payload(raw)
        staff_access = self._project_permissions_staff_access(payload)
        return str(staff_access.get(uid) or "").strip().lower() == "edit"

    def _staff_projects_view_permission_map(self, staff_rows: list[dict] | None = None) -> dict[str, bool]:
        staff_rows = list(staff_rows or [])
        role_view_map: dict[str, bool] = {}
        for role in (self._company.get("roles") or []):
            if not isinstance(role, dict):
                continue
            role_id = str(role.get("id") or "").strip().lower()
            role_name = str(role.get("name") or "").strip().lower()
            perms = role.get("permissions") or {}
            can_view = bool(perms.get("projects.view")) if isinstance(perms, dict) else False
            if role_id:
                role_view_map[role_id] = can_view
            if role_name and role_name not in role_view_map:
                role_view_map[role_name] = can_view

        out: dict[str, bool] = {}
        for row in staff_rows:
            uid = str((row or {}).get("uid") or "").strip()
            if not uid:
                continue
            role_key = str((row or {}).get("roleId") or (row or {}).get("role") or "staff").strip().lower()
            can_view = bool(role_view_map.get(role_key, False))
            out[uid] = can_view
        return out

    def _staff_projects_access_lock_permission_map(self, staff_rows: list[dict] | None = None) -> dict[str, bool]:
        staff_rows = list(staff_rows or [])
        role_lock_map: dict[str, bool] = {}
        for role in (self._company.get("roles") or []):
            if not isinstance(role, dict):
                continue
            role_id = str(role.get("id") or "").strip().lower()
            role_name = str(role.get("name") or "").strip().lower()
            perms = role.get("permissions") or {}
            can_lock = bool(perms.get("projects.access.lock")) if isinstance(perms, dict) else False
            if role_id:
                role_lock_map[role_id] = can_lock
            if role_name and role_name not in role_lock_map:
                role_lock_map[role_name] = can_lock

        out: dict[str, bool] = {}
        for row in staff_rows:
            uid = str((row or {}).get("uid") or "").strip()
            if not uid:
                continue
            role_id = str((row or {}).get("roleId") or (row or {}).get("role") or "").strip().lower()
            role_name = str((row or {}).get("roleName") or "").strip().lower()
            out[uid] = bool(role_lock_map.get(role_id, False) or role_lock_map.get(role_name, False))
        return out

    def _project_permissions_staff_access(self, payload: dict | None) -> dict[str, str]:
        payload = dict(payload or {})
        perms_raw = payload.get("projectPermissions") or {}
        staff_access: dict[str, str] = {}
        if isinstance(perms_raw, dict):
            raw_access = perms_raw.get("staffAccess")
            if isinstance(raw_access, dict):
                for k, v in raw_access.items():
                    vv = str(v or "").strip().lower()
                    staff_access[str(k)] = vv if vv in ("no_access", "view", "edit", "") else "no_access"
            else:
                maybe_staff = perms_raw.get("staff")
                if isinstance(maybe_staff, dict):
                    for k, v in maybe_staff.items():
                        staff_access[str(k)] = "view" if bool(v) else "no_access"
        return staff_access

    def _staff_rows_for_permissions(self) -> list[dict]:
        staff_rows = list(self._staff_all or [])
        if staff_rows:
            return staff_rows
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return []
        try:
            staff_rows = list(self.app.company.list_staff(company_id) or [])
        except Exception:
            staff_rows = []
        if staff_rows:
            self._staff_all = list(staff_rows)
        return staff_rows

    def _rebuild_permissions_list(self, variant: str, raw: dict | None) -> None:
        layout = self._detail_permissions_list_layout if variant == "detail" else self._dashboard_permissions_list_layout
        if not isinstance(layout, QVBoxLayout):
            return

        while layout.count():
            item = layout.takeAt(0)
            child = item.widget()
            if child is not None:
                child.deleteLater()

        if variant == "detail":
            self._detail_permission_combos = {}
            self._detail_permission_locked = {}
        else:
            self._dashboard_permission_combos = {}
            self._dashboard_permission_locked = {}

        if not isinstance(raw, dict):
            empty_lbl = QLabel("Select a project to edit permissions.")
            empty_lbl.setStyleSheet("color: #6B7280; font-size: 12px;")
            layout.addWidget(empty_lbl)
            return

        payload = self._load_project_settings_payload(raw)
        can_manage = self._can_manage_project_permissions(raw)
        staff_access = self._project_permissions_staff_access(payload)
        staff_rows = self._staff_rows_for_permissions()
        access_lock_map = self._staff_projects_access_lock_permission_map(staff_rows)
        current_uid = str(getattr(self.router.session, "uid", "") or "").strip()
        if not staff_rows:
            empty_lbl = QLabel("No staff found.")
            empty_lbl.setStyleSheet("color: #6B7280; font-size: 12px;")
            layout.addWidget(empty_lbl)
            return
        if not can_manage:
            info_lbl = QLabel("You need project Edit access to change user access.")
            info_lbl.setStyleSheet("color: #6B7280; font-size: 12px;")
            layout.addWidget(info_lbl)

        for member in staff_rows:
            uid = str((member or {}).get("uid") or "").strip()
            if not uid:
                continue
            name = str((member or {}).get("displayName") or "").strip() or str((member or {}).get("email") or uid)
            role_name = str((member or {}).get("roleName") or "").strip().lower()
            role_id = str((member or {}).get("roleId") or (member or {}).get("role") or "").strip().lower()
            is_owner_row = bool(role_id == "owner" or role_name == "owner" or bool((member or {}).get("isOwner")) or bool((member or {}).get("is_owner")))

            row_host = QWidget()
            row_lay = QHBoxLayout(row_host)
            row_lay.setContentsMargins(0, 0, 0, 0)
            row_lay.setSpacing(8)

            name_lbl = QLabel(name)
            name_lbl.setStyleSheet("color: #374151; font-size: 12px;")
            row_lay.addWidget(name_lbl, 1)

            combo = VComboBox()
            combo.setFixedHeight(26)
            combo.setMinimumWidth(126)
            combo.setCursor(Qt.CursorShape.PointingHandCursor)
            combo.setStyleSheet(
                "QComboBox {"
                "background:#FFFFFF; border:1px solid #E4E6EC; border-radius: 8px;"
                "padding: 0 24px 0 8px; font-size: 12px; min-height: 26px; max-height: 26px;"
                "}"
                "QComboBox::drop-down {"
                "subcontrol-origin: padding; subcontrol-position: top right;"
                "width: 20px; border-left: 1px solid #E8EBF1;"
                "background: #F7F8FA; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
                "}"
                "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
                "QComboBox QAbstractItemView { background: #FFFFFF; border: 1px solid #E4E6EC; selection-background-color: #EEF2F7; }"
            )
            combo.addItem("No Access", userData="no_access")
            combo.addItem("View", userData="view")
            combo.addItem("Edit", userData="edit")
            desired = "edit" if is_owner_row else staff_access.get(uid, "no_access")
            if desired not in ("no_access", "view", "edit"):
                desired = "no_access"

            idx = combo.findData(desired)
            combo.setCurrentIndex(max(0, idx))
            access_locked = bool(access_lock_map.get(uid, False))
            locked = bool(uid == current_uid or access_locked or is_owner_row)
            combo.setEnabled(bool(can_manage and not locked))
            combo.currentIndexChanged.connect(lambda _=0, key=uid, v=variant: self._on_inline_permission_changed(v, key))
            row_lay.addWidget(combo, 0)
            can_grant_temp = bool(getattr(self, "_can_grant_temp_production_access", lambda: False)())
            if can_manage and can_grant_temp and uid and uid != current_uid:
                temp_btn = QPushButton("Temp Prod Edit")
                temp_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                temp_btn.setFixedHeight(26)
                temp_btn.setStyleSheet(
                    "QPushButton { "
                    "background:#EEF6FF; color:#1E4E8C; border:1px solid #D7E6FA; border-radius:8px; "
                    "padding: 0 8px; font-size: 11px; font-weight: 700; }"
                    "QPushButton:hover { background:#E6F1FF; }"
                )
                temp_btn.clicked.connect(lambda _=False, target_uid=uid: self._grant_temp_production_edit_from_ui(target_uid))
                row_lay.addWidget(temp_btn, 0)
            layout.addWidget(row_host)

            if variant == "detail":
                self._detail_permission_combos[uid] = combo
                self._detail_permission_locked[uid] = locked
            else:
                self._dashboard_permission_combos[uid] = combo
                self._dashboard_permission_locked[uid] = locked

        layout.addStretch(1)

    def _grant_temp_production_edit_from_ui(self, uid: str) -> None:
        if not bool(getattr(self, "_can_grant_temp_production_access", lambda: False)()):
            return
        ok = bool(getattr(self, "_grant_temp_production_edit_access", lambda *_a, **_k: False)(uid, 8))
        if ok:
            self._refresh_inline_permissions(self._selected_project())

    def _refresh_inline_permissions(self, raw: dict | None = None) -> None:
        selected = raw if isinstance(raw, dict) else self._selected_project()
        self._suspend_permission_sync = True
        try:
            self._rebuild_permissions_list("detail", selected)
            self._rebuild_permissions_list("dashboard", selected)
        finally:
            self._suspend_permission_sync = False

    def _on_inline_permission_changed(self, variant: str, uid: str) -> None:
        if self._suspend_permission_sync:
            return
        raw = self._selected_project()
        if not isinstance(raw, dict):
            return
        if not self._can_manage_project_permissions(raw):
            self._refresh_inline_permissions(raw)
            return

        combos = self._detail_permission_combos if variant == "detail" else self._dashboard_permission_combos
        locked_map = self._detail_permission_locked if variant == "detail" else self._dashboard_permission_locked
        combo = combos.get(uid)
        if not isinstance(combo, QComboBox):
            return

        value = str(combo.currentData() or "").strip().lower()
        if bool(locked_map.get(uid, False)):
            # Keep owner/current-user/access-locked rows pinned.
            value = "edit"
        if value not in ("no_access", "view", "edit"):
            value = "no_access"

        payload = self._load_project_settings_payload(raw)
        perms_raw = payload.get("projectPermissions")
        perms = dict(perms_raw) if isinstance(perms_raw, dict) else {}
        staff_access = self._project_permissions_staff_access(payload)
        # Ensure owners always remain Edit.
        owner_uids: set[str] = set()
        for row in (self._staff_rows_for_permissions() or []):
            if not isinstance(row, dict):
                continue
            row_uid = str((row or {}).get("uid") or "").strip()
            if not row_uid:
                continue
            row_role_name = str((row or {}).get("roleName") or "").strip().lower()
            row_role_id = str((row or {}).get("roleId") or (row or {}).get("role") or "").strip().lower()
            if row_role_id == "owner" or row_role_name == "owner" or bool((row or {}).get("isOwner")) or bool((row or {}).get("is_owner")):
                owner_uids.add(row_uid)
        if uid in owner_uids:
            value = "edit"
        staff_access[uid] = value
        for owner_uid in owner_uids:
            staff_access[owner_uid] = "edit"
        perms["staffAccess"] = staff_access
        payload["projectPermissions"] = perms
        patch = {"projectSettings": payload, "projectSettingsJson": json.dumps(payload)}
        if not self._save_project_patch(patch):
            self._refresh_inline_permissions(raw)
            return

        other = self._dashboard_permission_combos if variant == "detail" else self._detail_permission_combos
        other_combo = other.get(uid)
        if isinstance(other_combo, QComboBox):
            idx = other_combo.findData(value)
            if idx >= 0 and other_combo.currentIndex() != idx:
                self._suspend_permission_sync = True
                try:
                    other_combo.setCurrentIndex(idx)
                finally:
                    self._suspend_permission_sync = False

