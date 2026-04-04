from __future__ import annotations

import json

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLayout,
    QLineEdit,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from cutsmart.ui.style import ACCENT
from cutsmart.qtui.screens.dashboard_controls import VComboBox
from cutsmart.qtui.screens.project_settings_dialog import ProjectSettingsDialog


class ProductionSettingsMixin:
    def _project_used_cutlist_board_keys(self, raw: dict | None) -> set[str]:
        out: set[str] = set()
        if not isinstance(raw, dict):
            return out
        rows = []
        try:
            if hasattr(self, "_load_project_cutlist_rows"):
                loaded = self._load_project_cutlist_rows(raw)
                if isinstance(loaded, tuple) and len(loaded) >= 1 and isinstance(loaded[0], list):
                    rows = list(loaded[0])
                    if len(loaded) >= 2 and isinstance(loaded[1], list):
                        rows.extend([dict(r) for r in loaded[1] if isinstance(r, dict)])
        except Exception:
            rows = []
        # Include live rows from currently open cutlist dialogs so lock checks
        # update immediately, even before the debounced autosave round-trip finishes.
        try:
            project_id = str((raw or {}).get("id") or "").strip()
            for dlg in list(getattr(self, "_open_cutlist_dialogs", []) or []):
                if dlg is None:
                    continue
                try:
                    if not bool(dlg.isVisible()):
                        continue
                except Exception:
                    continue
                dlg_project_id = str(dlg.property("projectId") or "").strip()
                if project_id and dlg_project_id and dlg_project_id != project_id:
                    continue
                payload_fn = getattr(dlg, "cutlist_payload", None)
                if not callable(payload_fn):
                    continue
                payload = payload_fn()
                if not isinstance(payload, dict):
                    continue
                live_rows = payload.get("rows")
                if isinstance(live_rows, list):
                    rows.extend([dict(r) for r in live_rows if isinstance(r, dict)])
                live_drafts = payload.get("entryDraftRows")
                if isinstance(live_drafts, list):
                    rows.extend([dict(r) for r in live_drafts if isinstance(r, dict)])
        except Exception:
            pass
        alias_map = {}
        try:
            if hasattr(self, "_project_board_alias_to_key_map"):
                alias_map = self._project_board_alias_to_key_map(raw) or {}
        except Exception:
            alias_map = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            board_raw = str(row.get("board") or row.get("boardType") or row.get("material") or "").strip()
            if not board_raw:
                continue
            key = board_raw
            if not key.startswith("board::"):
                norm = " ".join(board_raw.lower().split())
                mapped = alias_map.get(board_raw) or alias_map.get(norm)
                key = str(mapped or board_raw).strip()
            if key.startswith("board::"):
                out.add(key)
        return out

    def _refresh_visible_board_lock_state(self) -> None:
        panels = []
        for panel in (
            getattr(self, "_detail_embedded_board_settings", None),
            getattr(self, "_dashboard_embedded_board_settings", None),
        ):
            if isinstance(panel, ProjectSettingsDialog) and panel.isVisible():
                panels.append(panel)
        for panel in (getattr(self, "_open_project_settings_dialogs", None) or []):
            if isinstance(panel, ProjectSettingsDialog) and panel.isVisible():
                panels.append(panel)
        for panel in panels:
            try:
                refresh_fn = getattr(panel, "_refresh_board_lock_state", None)
                if callable(refresh_fn):
                    refresh_fn()
            except Exception:
                pass

    @staticmethod
    def _usage_key(value: str) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _normalize_board_material_usage_snapshot(self, rows: list[dict] | None) -> dict[str, dict[str, dict]]:
        out: dict[str, dict[str, dict]] = {
            "colours": {},
        }

        def _bump(group: str, key: str, payload: dict) -> None:
            if not key:
                return
            bucket = out.setdefault(group, {})
            existing = bucket.get(key)
            if existing is None:
                item = dict(payload)
                item["count"] = int(item.get("count") or 0) + 1
                bucket[key] = item
            else:
                existing["count"] = int(existing.get("count") or 0) + 1

        for row in (rows or []):
            if not isinstance(row, dict):
                continue
            colour = str(row.get("colour") or row.get("color") or "").strip()
            ck = self._usage_key(colour)

            if ck:
                _bump("colours", ck, {"value": colour})
        return out

    def _usage_delta(
        self,
        previous: dict[str, dict[str, dict]],
        current: dict[str, dict[str, dict]],
    ) -> dict[str, dict[str, dict]]:
        delta: dict[str, dict[str, dict]] = {}
        groups = ("colours",)
        for group in groups:
            before_group = previous.get(group) or {}
            current_group = current.get(group) or {}
            out_group: dict[str, dict] = {}
            for key in (set(before_group.keys()) | set(current_group.keys())):
                before_count = int((before_group.get(key) or {}).get("count") or 0)
                current_count = int((current_group.get(key) or {}).get("count") or 0)
                diff = current_count - before_count
                if diff == 0:
                    continue
                source = current_group.get(key) if diff > 0 else before_group.get(key)
                payload = dict(source or {})
                payload["count"] = int(diff)
                out_group[key] = payload
            if out_group:
                delta[group] = out_group
        return delta

    def _existing_usage_as_maps(self, usage_raw) -> dict[str, dict[str, dict]]:
        out: dict[str, dict[str, dict]] = {
            "colours": {},
        }
        if isinstance(usage_raw, list):
            # Legacy shape: row-combo list.
            legacy_rows = self._normalize_board_material_usage_snapshot(usage_raw)
            for group, rows in legacy_rows.items():
                for key, item in rows.items():
                    out[group][key] = dict(item)
            return out
        if not isinstance(usage_raw, dict):
            return out

        def _ingest_list(group: str, rows: list, fields: tuple[str, ...]) -> None:
            for row in rows:
                if not isinstance(row, dict):
                    continue
                try:
                    count = int(row.get("count") or 0)
                except Exception:
                    count = 0
                if count < 0:
                    continue
                if group in ("colours", "thicknesses", "finishes"):
                    value = str(row.get("value") or "").strip()
                    key = self._usage_key(value)
                    if not key:
                        continue
                    out[group][key] = {"value": value, "count": count}
                    continue
                values = [str(row.get(name) or "").strip() for name in fields]
                keys = [self._usage_key(v) for v in values]
                if not all(keys):
                    continue
                joined = "|".join(keys)
                payload = {name: values[idx] for idx, name in enumerate(fields)}
                payload["count"] = count
                out[group][joined] = payload

        _ingest_list("colours", usage_raw.get("colours") if isinstance(usage_raw.get("colours"), list) else [], ("value",))
        return out

    def _merge_company_board_material_usage(self, existing_usage, delta_usage: dict[str, dict[str, dict]]) -> dict:
        merged = self._existing_usage_as_maps(existing_usage)
        for group, rows in (delta_usage or {}).items():
            bucket = merged.setdefault(group, {})
            for key, delta in (rows or {}).items():
                try:
                    change = int((delta or {}).get("count") or 0)
                except Exception:
                    change = 0
                if change == 0:
                    continue
                # Keep historical memory monotonic: deleting/removing rows from
                # project board settings should not decrement remembered usage.
                if change < 0:
                    continue
                current = bucket.get(key)
                if current is None:
                    payload = dict(delta or {})
                    payload["count"] = int(change)
                    bucket[key] = payload
                else:
                    current["count"] = int(current.get("count") or 0) + change
                    if group in ("colours", "thicknesses", "finishes"):
                        if not str(current.get("value") or "").strip() and str((delta or {}).get("value") or "").strip():
                            current["value"] = str((delta or {}).get("value") or "").strip()
                    else:
                        for field in ("colour", "thickness", "finish"):
                            if field in current:
                                if not str(current.get(field) or "").strip() and str((delta or {}).get(field) or "").strip():
                                    current[field] = str((delta or {}).get(field) or "").strip()
        for group in list(merged.keys()):
            merged[group] = {k: v for k, v in (merged.get(group) or {}).items() if int((v or {}).get("count") or 0) >= 0}

        def _sorted_values(group: str, fields: tuple[str, ...]) -> list[dict]:
            rows = [dict(v) for v in (merged.get(group) or {}).values()]
            rows.sort(
                key=lambda row: tuple(
                    [-int(row.get("count") or 0)]
                    + [str(row.get(field) or "").lower() for field in fields]
                )
            )
            return rows

        return {
            "colours": _sorted_values("colours", ("value",)),
        }

    def _collect_board_type_colours(self, rows: list[dict] | None) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for row in (rows or []):
            if not isinstance(row, dict):
                continue
            value = str(row.get("colour") or row.get("color") or "").strip()
            key = self._usage_key(value)
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(value)
        return out

    def _ensure_company_board_material_usage_colours(self, usage_payload, colours: list[str] | None) -> dict:
        merged = self._existing_usage_as_maps(usage_payload)
        bucket = merged.setdefault("colours", {})
        for colour in (colours or []):
            value = str(colour or "").strip()
            key = self._usage_key(value)
            if not key:
                continue
            existing = bucket.get(key)
            if existing is None:
                bucket[key] = {"value": value, "count": 0}
                continue
            if not str(existing.get("value") or "").strip():
                existing["value"] = value
            existing["count"] = int(existing.get("count") or 0)
        rows = [dict(v) for v in (merged.get("colours") or {}).values()]
        rows.sort(key=lambda row: (-int(row.get("count") or 0), str(row.get("value") or "").lower()))
        return {"colours": rows}

    def _save_project_settings_payload_for_project(self, project_id: str, payload: dict) -> bool:
        company_id = getattr(self.router.session, "company_id", None)
        target_id = str(project_id or "").strip()
        if not company_id or not target_id:
            return False
        target = None
        for row in (getattr(self, "_projects_all", None) or []):
            if isinstance(row, dict) and str(row.get("id") or "").strip() == target_id:
                target = row
                break
        if not isinstance(target, dict):
            selected = self._selected_project() if hasattr(self, "_selected_project") else None
            if isinstance(selected, dict) and str(selected.get("id") or "").strip() == target_id:
                target = selected
        if not isinstance(target, dict):
            return False

        next_payload = dict(payload or {})
        current_payload = dict(self._load_project_settings_payload(target) or {})
        merged_payload = dict(current_payload)
        merged_payload.update(next_payload)
        if json.dumps(current_payload, sort_keys=True, separators=(",", ":")) == json.dumps(merged_payload, sort_keys=True, separators=(",", ":")):
            return True
        patch = {"projectSettings": merged_payload, "projectSettingsJson": json.dumps(merged_payload)}
        try:
            self.app.company.update_job(company_id, target_id, patch)
        except Exception:
            return False
        target.update(patch)
        try:
            previous_snapshot = self._normalize_board_material_usage_snapshot(current_payload.get("boardTypes") or [])
            current_snapshot = self._normalize_board_material_usage_snapshot(merged_payload.get("boardTypes") or [])
            usage_delta = self._usage_delta(previous_snapshot, current_snapshot)
            historical_colours = self._collect_board_type_colours(current_payload.get("boardTypes") or [])
            for colour in self._collect_board_type_colours(merged_payload.get("boardTypes") or []):
                ckey = self._usage_key(colour)
                if ckey and all(self._usage_key(existing) != ckey for existing in historical_colours):
                    historical_colours.append(colour)
            if usage_delta or historical_colours:
                fresh_company = None
                try:
                    fresh_company = self.app.company.get_company(company_id) or {}
                except Exception:
                    fresh_company = None
                merged_usage = self._merge_company_board_material_usage(
                    ((fresh_company or {}).get("boardMaterialUsage") or (self._company or {}).get("boardMaterialUsage") or []),
                    usage_delta,
                )
                merged_usage = self._ensure_company_board_material_usage_colours(merged_usage, historical_colours)
                self.app.company.update_company(company_id, {"boardMaterialUsage": merged_usage})
                if isinstance(self._company, dict):
                    if isinstance(fresh_company, dict):
                        self._company.update(dict(fresh_company))
                    self._company["boardMaterialUsage"] = merged_usage
                try:
                    self._load_company_board_material_usage_rows()
                except Exception:
                    pass
                try:
                    self._refresh_project_board_colour_suggestions()
                except Exception:
                    pass
        except Exception:
            pass
        try:
            raw_sel = self._selected_project() if hasattr(self, "_selected_project") else None
            if isinstance(raw_sel, dict) and str(raw_sel.get("id") or "").strip() == target_id:
                raw_sel.update(patch)
        except Exception:
            pass
        try:
            if isinstance(getattr(self, "_dashboard_detail_raw", None), dict) and str((self._dashboard_detail_raw or {}).get("id") or "").strip() == target_id:
                self._dashboard_detail_raw.update(patch)
        except Exception:
            pass
        try:
            self._refresh_open_cutlist_board_sources(target)
        except Exception:
            pass
        return True

    def _save_project_settings_payload(self, payload: dict) -> bool:
        raw = self._selected_project() if hasattr(self, "_selected_project") else None
        project_id = str((raw or {}).get("id") or "").strip() if isinstance(raw, dict) else ""
        return bool(self._save_project_settings_payload_for_project(project_id, payload))

    def _mount_production_config_panel(self, use_dashboard: bool, raw: dict | None) -> None:
        host = self._dashboard_production_config_host if use_dashboard else self._detail_production_config_host
        if not isinstance(host, QWidget):
            return
        lay = host.layout()
        if not isinstance(lay, QVBoxLayout):
            lay = QVBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(0)
            lay.setSizeConstraint(QLayout.SizeConstraint.SetMinAndMaxSize)
        self._clear_layout_widgets(lay)

        if not isinstance(raw, dict):
            return
        bound_project_id = str((raw or {}).get("id") or "").strip()

        payload = self._load_project_settings_payload(raw)
        card = QFrame()
        card.setObjectName("CabinetSpecsCard")
        card.setStyleSheet("QFrame#CabinetSpecsCard { background: transparent; border: none; }")
        card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        card_lay = QVBoxLayout(card)
        card_lay.setContentsMargins(4, 0, 0, 0)
        card_lay.setSpacing(8)

        FIELD_LABEL_W = 108
        FIELD_SPAN_W = 110
        HOB_SIDE_W = 62
        unit_text = "in" if str((self._company or {}).get("measurementUnit") or "mm").strip().lower() in ("in", "inch", "inches") else "mm"

        def _strip_mm(value: str) -> str:
            return (
                str(value or "")
                .replace("mm", "")
                .replace("MM", "")
                .replace("in", "")
                .replace("IN", "")
                .strip()
            )

        def _combo(options: list[str], selected: str, width: int | None = None) -> QComboBox:
            c = VComboBox()
            c.setFixedHeight(28)
            c.setMinimumWidth(0)
            target_w = int(width) if isinstance(width, int) and width > 0 else FIELD_SPAN_W
            c.setFixedWidth(target_w)
            c.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            c.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToContents)
            c.setStyleSheet(
                "QComboBox { background:#FFFFFF; border:1px solid #E4E6EC; border-radius: 8px; padding: 0 10px 0 8px; font-size: 12px; min-height: 28px; max-height: 28px; }"
                "QComboBox::drop-down { subcontrol-origin: padding; subcontrol-position: top right; width: 22px; border-left: 1px solid #E8EBF1; background: #F7F8FA; border-top-right-radius: 8px; border-bottom-right-radius: 8px; }"
                "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
            )
            c.addItem("")
            seen = {""}
            for opt in options:
                txt = str(opt or "").strip()
                if txt and txt not in seen:
                    c.addItem(txt)
                    seen.add(txt)
            sel = str(selected or "").strip()
            if sel and sel not in seen:
                c.addItem(sel)
            c.setCurrentText(sel)
            return c

        def _combo_content_width(combo: QComboBox, min_w: int = 84, extra: int = 42) -> int:
            if not isinstance(combo, QComboBox):
                return int(min_w)
            try:
                fm = combo.fontMetrics()
                texts = [str(combo.itemText(i) or "") for i in range(combo.count())]
                texts.append(str(combo.currentText() or ""))
                longest = max([fm.horizontalAdvance(t) for t in texts] + [0])
                return int(max(min_w, longest + extra))
            except Exception:
                return int(min_w)

        def _mm_combo_field(combo: QComboBox) -> QWidget:
            host_w = QWidget()
            row = QHBoxLayout(host_w)
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(5)
            mm_lbl = QLabel(unit_text)
            mm_lbl.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; }")
            row.addWidget(combo, 0)
            row.addWidget(mm_lbl, 0)
            row.addStretch(1)
            return host_w

        def _mm_input(value: str) -> tuple[QWidget, QLineEdit]:
            host_w = QWidget()
            host_w.setFixedWidth(FIELD_SPAN_W)
            row = QHBoxLayout(host_w)
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(5)
            edit = QLineEdit(str(value or ""))
            edit.setFixedHeight(30)
            edit.setFixedWidth(76)
            edit.setStyleSheet("QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
            mm_lbl = QLabel(unit_text)
            mm_lbl.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; }")
            row.addWidget(edit)
            row.addWidget(mm_lbl)
            row.addStretch(1)
            return host_w, edit

        thickness_opts = [_strip_mm(str(v).strip()) for v in self._company_board_thickness_options() if str(v).strip()]
        hardware_rows = self._company_hardware_settings()
        hardware_categories = [str(r.get("name") or "").strip() for r in hardware_rows if str(r.get("name") or "").strip()]
        default_category = str(payload.get("hardwareCategory") or self._hardware_default_hinge_type_option() or "").strip()
        if default_category and default_category not in hardware_categories:
            default_category = ""
        if not default_category and hardware_categories:
            default_category = hardware_categories[0]
        hardware_state = {"category": default_category}

        def _section_title(text: str) -> QLabel:
            lbl = QLabel(text)
            lbl.setStyleSheet("color: #1A1D23; font-size: 13px; font-weight: 800;")
            return lbl

        def _field_label(text: str) -> QLabel:
            lbl = QLabel(text)
            lbl.setStyleSheet("color: #374151; font-size: 12px; font-weight: 700;")
            lbl.setFixedWidth(FIELD_LABEL_W)
            lbl.setFixedHeight(30)
            return lbl

        sections_host = QWidget()
        sections_row = QHBoxLayout(sections_host)
        sections_row.setContentsMargins(0, 0, 0, 0)
        sections_row.setSpacing(10)

        section_card_style = (
            "QFrame#ProdSectionCard { background:#FFFFFF; border:1px solid #D7DCE3; border-radius:14px; }"
            "QFrame#ProdSectionHead { background:#FFFFFF; border:none; border-bottom:1px solid #D7DEE8; border-top-left-radius:14px; border-top-right-radius:14px; }"
            "QFrame#ProdSectionBody { background:#F8FAFD; border:none; border-bottom-left-radius:14px; border-bottom-right-radius:14px; }"
        )

        def _build_section_shell(title_text: str) -> tuple[QFrame, QHBoxLayout, QVBoxLayout]:
            card = QFrame()
            card.setObjectName("ProdSectionCard")
            card.setStyleSheet(section_card_style)
            card_l = QVBoxLayout(card)
            card_l.setContentsMargins(0, 0, 0, 0)
            card_l.setSpacing(0)

            head = QFrame()
            head.setObjectName("ProdSectionHead")
            head.setFixedHeight(51)
            head_l = QHBoxLayout(head)
            head_l.setContentsMargins(14, 16, 14, 10)
            head_l.setSpacing(6)
            title = QLabel(str(title_text or "").upper())
            title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
            head_l.addWidget(title, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            head_l.addStretch(1)
            card_l.addWidget(head, 0)

            body = QFrame()
            body.setObjectName("ProdSectionBody")
            body_l = QVBoxLayout(body)
            body_l.setContentsMargins(14, 10, 14, 12)
            body_l.setSpacing(8)
            card_l.addWidget(body, 1)
            return card, head_l, body_l

        existing_col, _existing_head_l, existing_col_lay = _build_section_shell("Existing")
        top_form = QFormLayout()
        top_form.setContentsMargins(0, 0, 0, 0)
        top_form.setHorizontalSpacing(10)
        top_form.setVerticalSpacing(8)
        top_form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow)
        fields = [
            ("Carcass Thickness", "carcassThickness"),
            ("Panel Thickness", "panelThickness"),
            ("Fronts Thickness", "frontsThickness"),
        ]
        combo_map: dict[str, QComboBox] = {}
        for label_txt, key in fields:
            combo = _combo(thickness_opts, _strip_mm(str(payload.get(key) or "")), width=FIELD_SPAN_W)
            combo.setFixedWidth(_combo_content_width(combo, min_w=78, extra=34))
            top_form.addRow(_field_label(label_txt), _mm_combo_field(combo))
            combo_map[key] = combo
        existing_col_lay.addLayout(top_form)
        existing_col_lay.addStretch(1)
        existing_col.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)
        sections_row.addWidget(existing_col, 0)

        cab_col, _cab_head_l, cab_col_lay = _build_section_shell("Cabinetry")
        cab_form = QFormLayout()
        cab_form.setContentsMargins(0, 0, 0, 0)
        cab_form.setHorizontalSpacing(10)
        cab_form.setVerticalSpacing(8)
        cab_form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow)
        mm_fields = [
            ("Base Cab Height", "baseCabHeight"),
            ("Foot Distance Back", "footDistanceBack"),
            ("Tall Cab Height", "tallCabHeight"),
            ("Foot Height", "footHeight"),
            ("Hob Centre", "hobCentre"),
        ]
        edit_map: dict[str, QLineEdit] = {}
        for label_txt, key in mm_fields:
            wrap, edit = _mm_input(str(payload.get(key) or ""))
            if key == "hobCentre":
                side_combo = _combo(["RH", "LH"], str(payload.get("hobSide") or ""), width=HOB_SIDE_W)
                hob_wrap = QWidget()
                hob_wrap.setFixedWidth(FIELD_SPAN_W + HOB_SIDE_W + 24)
                hob_l = QHBoxLayout(hob_wrap)
                hob_l.setContentsMargins(0, 0, 0, 0)
                hob_l.setSpacing(10)
                hob_l.addWidget(wrap, 0)
                hob_l.addStretch(1)
                hob_l.addWidget(side_combo, 0)
                cab_form.addRow(_field_label(label_txt), hob_wrap)
                combo_map["hobSide"] = side_combo
            else:
                cab_form.addRow(_field_label(label_txt), wrap)
            edit_map[key] = edit
        cab_col_lay.addLayout(cab_form)
        cab_col_lay.addStretch(1)
        cab_col.setMinimumWidth(FIELD_LABEL_W + FIELD_SPAN_W + HOB_SIDE_W + 56)
        cab_col.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)
        sections_row.addWidget(cab_col, 0)

        hw_col, _hw_head_shell_l, hw_col_lay = _build_section_shell("Hardware")
        hw_head = QWidget()
        hw_head_l = QHBoxLayout(hw_head)
        hw_head_l.setContentsMargins(0, 0, 0, 0)
        hw_head_l.setSpacing(10)
        hw_checkboxes: list[QCheckBox] = []
        for cat_name in hardware_categories:
            cb = QCheckBox(cat_name)
            cb.setCursor(Qt.CursorShape.PointingHandCursor)
            cb.setStyleSheet("QCheckBox { color: #4B5563; font-size: 11px; font-weight: 700; }")
            cb.setChecked(cat_name == hardware_state["category"])
            hw_head_l.addWidget(cb, 0)
            hw_checkboxes.append(cb)
        hw_head_l.addStretch(1)
        hw_col_lay.addWidget(hw_head)
        hw_form = QFormLayout()
        hw_form.setContentsMargins(0, 0, 0, 0)
        hw_form.setHorizontalSpacing(10)
        hw_form.setVerticalSpacing(8)
        hw_form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow)
        drawer_combo = _combo([], "", width=FIELD_SPAN_W)
        hinge_combo = _combo([], "", width=FIELD_SPAN_W)
        hw_form.addRow(_field_label("New Drawer Type"), drawer_combo)
        hw_form.addRow(_field_label("Hinge Type"), hinge_combo)
        hw_col_lay.addLayout(hw_form)
        hw_col_lay.addStretch(1)
        hw_col.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)
        sections_row.addWidget(hw_col, 0)
        sections_row.addStretch(1)
        section_cards = [existing_col, cab_col, hw_col]
        for section_card in section_cards:
            try:
                section_card.adjustSize()
            except Exception:
                pass
        section_target_h = max([int(w.sizeHint().height()) for w in section_cards] + [0])
        section_target_w = (
            sum(max(int(w.width()), int(w.sizeHint().width())) for w in section_cards)
            + (max(0, len(section_cards) - 1) * int(sections_row.spacing()))
        )
        if section_target_h > 0:
            for section_card in section_cards:
                section_card.setFixedHeight(section_target_h)
        if section_target_w > 0:
            sections_host.setFixedWidth(int(section_target_w))
            if use_dashboard:
                self._dashboard_production_section_row_width = int(section_target_w)
            else:
                self._detail_production_section_row_width = int(section_target_w)
        card_lay.addWidget(sections_host, 0)
        combo_map["newDrawerType"] = drawer_combo
        combo_map["hingeType"] = hinge_combo

        def _set_combo_options(combo: QComboBox, options: list[str], selected: str) -> None:
            if not isinstance(combo, QComboBox):
                return
            combo.blockSignals(True)
            combo.clear()
            combo.addItem("")
            seen = {""}
            for opt in options:
                txt = str(opt or "").strip()
                if txt and txt not in seen:
                    combo.addItem(txt)
                    seen.add(txt)
            sel = str(selected or "").strip()
            if sel and sel not in seen:
                combo.addItem(sel)
            combo.setCurrentText(sel)
            combo.blockSignals(False)

        def _refresh_hw_combos(use_existing_values: bool = True) -> None:
            cat = str(hardware_state.get("category") or "").strip()
            drawer_options = self._hardware_drawer_type_options(cat)
            hinge_options = self._hardware_hinge_type_options(cat)
            current_drawer = str(drawer_combo.currentText() or "").strip() if use_existing_values else ""
            current_hinge = str(hinge_combo.currentText() or "").strip() if use_existing_values else ""
            payload_drawer = str(payload.get("newDrawerType") or "").strip()
            payload_hinge = str(payload.get("hingeType") or "").strip()
            default_drawer = self._hardware_default_drawer_type_option(cat)
            default_hinge = self._hardware_default_hinge_type_option() if not cat else cat
            target_drawer = current_drawer or payload_drawer
            target_hinge = current_hinge or payload_hinge
            if target_drawer and target_drawer not in drawer_options:
                target_drawer = ""
            if target_hinge and target_hinge not in hinge_options:
                target_hinge = ""
            if not target_drawer:
                target_drawer = default_drawer
            if not target_hinge:
                target_hinge = default_hinge
            _set_combo_options(drawer_combo, drawer_options, target_drawer)
            _set_combo_options(hinge_combo, hinge_options, target_hinge)
            same_w = max(
                _combo_content_width(drawer_combo, min_w=118, extra=42),
                _combo_content_width(hinge_combo, min_w=118, extra=42),
            )
            drawer_combo.setFixedWidth(int(same_w))
            hinge_combo.setFixedWidth(int(same_w))

        def _set_hardware_category(cat_name: str) -> None:
            name = str(cat_name or "").strip()
            hardware_state["category"] = name
            for cb in hw_checkboxes:
                if not isinstance(cb, QCheckBox):
                    continue
                blocked = cb.blockSignals(True)
                cb.setChecked(str(cb.text() or "").strip() == name)
                cb.blockSignals(blocked)
            _refresh_hw_combos(use_existing_values=False)
            _on_save()

        for cb in hw_checkboxes:
            if not isinstance(cb, QCheckBox):
                continue
            cb_name = str(cb.text() or "").strip()
            def _on_cat_toggled(checked: bool, name=cb_name, this_cb=cb) -> None:
                if checked:
                    _set_hardware_category(name)
                    return
                if not any(isinstance(x, QCheckBox) and x.isChecked() for x in hw_checkboxes):
                    blocked = this_cb.blockSignals(True)
                    this_cb.setChecked(True)
                    this_cb.blockSignals(blocked)
            cb.toggled.connect(_on_cat_toggled)
        _refresh_hw_combos(use_existing_values=False)

        def _on_save() -> None:
            if not bound_project_id:
                return
            patch_payload: dict[str, str] = {}
            patch_payload["hardwareCategory"] = str(hardware_state.get("category") or "").strip()
            for k, c in combo_map.items():
                if isinstance(c, QComboBox):
                    patch_payload[k] = str(c.currentText() or "").strip()
            for k, e in edit_map.items():
                if isinstance(e, QLineEdit):
                    patch_payload[k] = str(e.text() or "").strip()
            self._save_project_settings_payload_for_project(bound_project_id, patch_payload)

        for c in combo_map.values():
            if isinstance(c, QComboBox):
                c.currentIndexChanged.connect(lambda _=0: _on_save())
        for e in edit_map.values():
            if isinstance(e, QLineEdit):
                e.editingFinished.connect(_on_save)

        card.adjustSize()
        # Allow natural content height and rely on the Production scroll area
        # when the viewport is smaller than the stacked settings.
        natural_h = max(220, int(card.sizeHint().height()))
        card.setMinimumHeight(natural_h)
        card.setMaximumHeight(16777215)
        card.setMaximumWidth(16777215)
        host.setMinimumHeight(natural_h)
        host.setMaximumHeight(16777215)
        lay.addWidget(card, 0, Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)

    def _mount_embedded_board_settings(self, use_dashboard: bool, raw: dict | None) -> None:
        self._mount_production_config_panel(use_dashboard, raw)
        host = self._dashboard_production_board_host if use_dashboard else self._detail_production_board_host
        if not isinstance(host, QWidget):
            return
        lay = host.layout()
        if not isinstance(lay, QVBoxLayout):
            lay = QVBoxLayout(host)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(0)
        self._clear_layout_widgets(lay)

        if not isinstance(raw, dict):
            placeholder = QLabel("Select a project to edit board settings.")
            placeholder.setStyleSheet("color: #6B7280; font-size: 13px;")
            lay.addWidget(placeholder, 0, Qt.AlignmentFlag.AlignTop)
            if use_dashboard:
                self._dashboard_embedded_board_settings = None
            else:
                self._detail_embedded_board_settings = None
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
            boards = (new_payload or {}).get("boardTypes")
            if not isinstance(boards, list):
                boards = []
            clean_rows = [dict(r) for r in boards if isinstance(r, dict)]
            return bool(self._save_project_settings_payload_for_project(bound_project_id, {"boardTypes": clean_rows}))

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

        panel = ProjectSettingsDialog(
            project_name=str(raw.get("name") or "Project"),
            payload=payload,
            staff=staff_rows,
            board_thicknesses=self._company_board_thickness_options(),
            board_finishes=self._company_board_finish_options(),
            board_colour_suggestions=self._company_board_colour_suggestions(),
            board_material_usage=self._company_board_material_usage_stats(),
            board_locked_keys=self._project_used_cutlist_board_keys(raw),
            board_locked_labels=self._project_board_display_map(raw),
            board_lock_state_provider=_live_board_lock_state,
            sheet_sizes=self._company_sheet_size_options(),
            default_sheet_size=self._company_default_sheet_size_option(),
            staff_role_view_permissions=self._staff_projects_view_permission_map(staff_rows),
            staff_access_lock_permissions=self._staff_projects_access_lock_permission_map(staff_rows),
            initial_section="boards",
            theme_color=str((self._company or {}).get("themeColor") or self._company_theme_hex or ACCENT),
            measurement_unit=str((self._company or {}).get("measurementUnit") or "mm"),
            embedded=True,
            on_change=_autosave_project_settings,
            parent=host,
        )
        def _sync_board_width() -> None:
            target_row_w = int(
                getattr(
                    self,
                    "_dashboard_production_section_row_width" if use_dashboard else "_detail_production_section_row_width",
                    0,
                )
                or 0
            )
            left_inset = 0
            try:
                config_host = self._dashboard_production_config_host if use_dashboard else self._detail_production_config_host
                if isinstance(config_host, QWidget):
                    cfg_card = config_host.findChild(QFrame, "CabinetSpecsCard")
                    if isinstance(cfg_card, QFrame):
                        try:
                            cfg_lay = cfg_card.layout()
                            if isinstance(cfg_lay, QVBoxLayout):
                                left_inset = max(0, int(cfg_lay.contentsMargins().left()))
                        except Exception:
                            left_inset = 0
                        if target_row_w <= 0:
                            section_cards = cfg_card.findChildren(QFrame, "ProdSectionCard")
                            if section_cards:
                                cards = section_cards[:3]
                                section_widths: list[int] = []
                                for section_card in cards:
                                    w = max(int(section_card.width()), int(section_card.sizeHint().width()))
                                    if w > 0:
                                        section_widths.append(w)
                                if section_widths:
                                    target_row_w = int(sum(section_widths) + (max(0, len(section_widths) - 1) * int(10)))
            except Exception:
                target_row_w = 0
                left_inset = 0

            left_inset = max(4, int(left_inset))
            lay.setContentsMargins(left_inset, 0, 0, 0)
            width_basis = int(target_row_w or 0)
            if width_basis > 0:
                content_w = max(0, width_basis)
                panel.setMinimumWidth(content_w)
                panel.setMaximumWidth(content_w)
                panel.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Preferred)
            else:
                panel.setMinimumWidth(0)
                panel.setMaximumWidth(16777215)
                panel.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)

        lay.addWidget(panel, 0, Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
        _sync_board_width()
        QTimer.singleShot(0, _sync_board_width)
        lay.addStretch(1)
        if use_dashboard:
            self._dashboard_embedded_board_settings = panel
        else:
            self._detail_embedded_board_settings = panel


