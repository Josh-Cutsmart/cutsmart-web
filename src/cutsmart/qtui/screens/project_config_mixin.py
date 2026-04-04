from __future__ import annotations

import math
import re


class ProjectConfigMixin:

    def _company_part_type_names(self) -> list[str]:
        out: list[str] = []
        for row in (self._company.get("partTypes") or []):
            if isinstance(row, dict):
                name = str(row.get("name") or "").strip()
            else:
                name = str(row or "").strip()
            if name and name not in out:
                out.append(name)
        return out

    def _company_part_type_color_map(self) -> dict[str, str]:
        out: dict[str, str] = {}
        default_fallback = "#E7EAF0"
        for row in (self._company.get("partTypes") or []):
            if not isinstance(row, dict):
                continue
            name = self._part_key(str(row.get("name") or ""))
            if not name:
                continue
            raw_color = (
                str(row.get("color") or "").strip()
                or str(row.get("colour") or "").strip()
                or str(row.get("hex") or "").strip()
            )
            color = self._normalize_hex(raw_color, default_fallback)
            # If duplicates exist, don't let an empty/default color override a real one.
            existing = str(out.get(name) or "").strip()
            if existing and color == default_fallback:
                continue
            out[name] = color
        return out

    def _company_part_type_autoclash_map(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for row in (self._company.get("partTypes") or []):
            if not isinstance(row, dict):
                continue
            name = self._part_key(str(row.get("name") or ""))
            if not name:
                continue
            clash_l = str(row.get("clashL") or "").strip().upper()
            clash_s = str(row.get("clashS") or "").strip().upper()
            if (not clash_l or not clash_s) and str(row.get("clashing") or "").strip():
                parsed_l, parsed_s = self._parse_clashing_pair(str(row.get("clashing") or ""))
                clash_l = clash_l or parsed_l
                clash_s = clash_s or parsed_s
            if bool(row.get("autoClash") or row.get("autoclash")) and not clash_l and not clash_s:
                clash_l = "1L"
                clash_s = "1S"
            auto_clash = bool(clash_l or clash_s)
            out[name] = {"autoClash": auto_clash, "clashL": clash_l, "clashS": clash_s}
        return out

    def _company_part_type_cabinetry_map(self) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for row in (self._company.get("partTypes") or []):
            if not isinstance(row, dict):
                continue
            name = self._part_key(str(row.get("name") or ""))
            if not name:
                continue
            out[name] = bool(row.get("cabinetry"))
        return out

    def _company_part_type_drawer_map(self) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for row in (self._company.get("partTypes") or []):
            if not isinstance(row, dict):
                continue
            name = self._part_key(str(row.get("name") or ""))
            if not name:
                continue
            out[name] = bool(row.get("drawer"))
        return out

    def _company_part_type_include_in_cutlists_map(self) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for row in (self._company.get("partTypes") or []):
            if not isinstance(row, dict):
                continue
            name = self._part_key(str(row.get("name") or ""))
            if not name:
                continue
            if "includeInCutlists" in row:
                out[name] = bool(row.get("includeInCutlists"))
            elif "inclInCutlists" in row:
                out[name] = bool(row.get("inclInCutlists"))
            else:
                out[name] = True
        return out

    def _company_part_type_include_in_nesting_map(self) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for row in (self._company.get("partTypes") or []):
            if not isinstance(row, dict):
                continue
            name = self._part_key(str(row.get("name") or ""))
            if not name:
                continue
            if "includeInNesting" in row:
                out[name] = bool(row.get("includeInNesting"))
            elif "inclInNesting" in row:
                out[name] = bool(row.get("inclInNesting"))
            else:
                out[name] = True
        return out

    def _company_part_type_initial_measure_map(self) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for row in (self._company.get("partTypes") or []):
            if not isinstance(row, dict):
                continue
            name = self._part_key(str(row.get("name") or ""))
            if not name:
                continue
            out[name] = bool(row.get("initialMeasure"))
        return out

    def _company_hardware_settings(self) -> list[dict]:
        rows = self._company.get("hardwareSettings") or []
        if not isinstance(rows, list):
            rows = []
        cleaned: list[dict] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            color = self._normalize_hex(str(row.get("color") or "#7D99B3"), "#7D99B3")
            drawers = row.get("drawers") if isinstance(row.get("drawers"), list) else []
            hinges = row.get("hinges") if isinstance(row.get("hinges"), list) else []
            other = row.get("other") if isinstance(row.get("other"), list) else []
            is_default = bool(row.get("default"))
            cleaned.append({"name": name, "color": color, "drawers": drawers, "hinges": hinges, "other": other, "default": is_default})
        return cleaned

    def _hardware_drawer_type_options(self, category_name: str | None = None) -> list[str]:
        out: list[str] = []
        selected = str(category_name or "").strip().lower()
        for cat in self._company_hardware_settings():
            cat_name = str(cat.get("name") or "").strip()
            if selected and cat_name.lower() != selected:
                continue
            for row in (cat.get("drawers") or []):
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or "").strip()
                if name and name not in out:
                    out.append(name)
        return out

    def _hardware_hinge_type_options(self, category_name: str | None = None) -> list[str]:
        out: list[str] = []
        selected = str(category_name or "").strip().lower()
        for cat in self._company_hardware_settings():
            name = str(cat.get("name") or "").strip()
            if selected and name.lower() != selected:
                continue
            if name and name not in out:
                out.append(name)
        return out

    def _hardware_default_hinge_type_option(self) -> str:
        first = ""
        for cat in self._company_hardware_settings():
            name = str(cat.get("name") or "").strip()
            if not name:
                continue
            if not first:
                first = name
            if bool(cat.get("default")):
                return name
        return first

    def _hardware_default_drawer_type_option(self, category_name: str | None = None) -> str:
        fallback = ""
        rows = self._company_hardware_settings()
        selected = str(category_name or "").strip().lower()
        if selected:
            rows = [r for r in rows if str(r.get("name") or "").strip().lower() == selected]
        default_rows = [r for r in rows if bool(r.get("default"))] or rows
        for cat in default_rows:
            drawers = cat.get("drawers") if isinstance(cat.get("drawers"), list) else []
            for row in drawers:
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or "").strip()
                if not name:
                    continue
                if not fallback:
                    fallback = name
                if bool(row.get("default")):
                    return name
        return fallback

    def _project_drawer_back_height_letters(self, raw: dict | None) -> list[str]:
        payload = self._load_project_settings_payload(raw)
        selected_cat = str(payload.get("hardwareCategory") or "").strip()
        selected_drawer = str(payload.get("newDrawerType") or "").strip()
        if not selected_cat:
            selected_cat = str(self._hardware_default_hinge_type_option() or "").strip()
        if not selected_drawer:
            selected_drawer = str(self._hardware_default_drawer_type_option(selected_cat) or "").strip()
        letters: list[str] = []
        seen: set[str] = set()
        categories = self._company_hardware_settings()
        selected_rows = [c for c in categories if self._part_key(str(c.get("name") or "")) == self._part_key(selected_cat)] if selected_cat else list(categories)
        if not selected_rows:
            selected_rows = list(categories)
        for cat in selected_rows:
            drawers = cat.get("drawers") if isinstance(cat.get("drawers"), list) else []
            for row in drawers:
                if not isinstance(row, dict):
                    continue
                drawer_name = str(row.get("name") or "").strip()
                if selected_drawer and self._part_key(drawer_name) != self._part_key(selected_drawer):
                    continue
                backs = row.get("backs") if isinstance(row.get("backs"), dict) else {}
                back_letters = backs.get("letters") if isinstance(backs.get("letters"), list) else []
                for item in back_letters:
                    if isinstance(item, dict):
                        letter = str(item.get("letter") or "").strip()
                    else:
                        letter = str(item or "").strip()
                    key = self._part_key(letter)
                    if not letter or key in seen:
                        continue
                    seen.add(key)
                    letters.append(letter)
                if selected_drawer:
                    return letters
        return letters

    def _project_drawer_breakdown_spec(self, raw: dict | None) -> dict:
        payload = self._load_project_settings_payload(raw)
        selected_cat = str(payload.get("hardwareCategory") or "").strip()
        selected_drawer = str(payload.get("newDrawerType") or "").strip()
        if not selected_cat:
            selected_cat = str(self._hardware_default_hinge_type_option() or "").strip()
        if not selected_drawer:
            selected_drawer = str(self._hardware_default_drawer_type_option(selected_cat) or "").strip()

        out = {
            "drawerName": selected_drawer,
            "bottomsWidthMinus": "",
            "bottomsDepthMinus": "",
            "backsWidthMinus": "",
            "backLetterValues": {},
            "hardwareLengths": [],
            "spaceRequirement": "",
        }

        categories = self._company_hardware_settings()
        selected_rows = [c for c in categories if self._part_key(str(c.get("name") or "")) == self._part_key(selected_cat)] if selected_cat else list(categories)
        if not selected_rows:
            selected_rows = list(categories)

        for cat in selected_rows:
            drawers = cat.get("drawers") if isinstance(cat.get("drawers"), list) else []
            target_row = None
            if selected_drawer:
                for row in drawers:
                    if not isinstance(row, dict):
                        continue
                    drawer_name = str(row.get("name") or "").strip()
                    if self._part_key(drawer_name) == self._part_key(selected_drawer):
                        target_row = row
                        break
            if target_row is None:
                default_rows = [r for r in drawers if isinstance(r, dict) and bool(r.get("default"))]
                if default_rows:
                    target_row = default_rows[0]
                elif drawers:
                    target_row = drawers[0] if isinstance(drawers[0], dict) else None
            if not isinstance(target_row, dict):
                continue

            out["drawerName"] = str(target_row.get("name") or out["drawerName"] or "").strip()
            bottoms = target_row.get("bottoms") if isinstance(target_row.get("bottoms"), dict) else {}
            backs = target_row.get("backs") if isinstance(target_row.get("backs"), dict) else {}
            out["bottomsWidthMinus"] = str(bottoms.get("widthMinus") or target_row.get("widthMinus") or "").strip()
            out["bottomsDepthMinus"] = str(bottoms.get("depthMinus") or target_row.get("depthMinus") or "").strip()
            out["backsWidthMinus"] = str(backs.get("widthMinus") or "").strip()
            out["spaceRequirement"] = str(target_row.get("spaceRequirement") or target_row.get("clearance") or "").strip()
            letters_map: dict[str, str] = {}
            for item in (backs.get("letters") or []):
                if not isinstance(item, dict):
                    continue
                letter = str(item.get("letter") or "").strip()
                val = str(item.get("minus") or "").strip()
                if not letter:
                    continue
                letters_map[self._part_key(letter)] = val
            out["backLetterValues"] = letters_map
            lengths_raw = target_row.get("hardwareLengths") if isinstance(target_row.get("hardwareLengths"), list) else []
            out["hardwareLengths"] = [str(v or "").strip() for v in lengths_raw if str(v or "").strip()]
            return out

        return out

    @staticmethod
    def _part_key(value: str) -> str:
        return " ".join(str(value or "").strip().lower().split())

    @staticmethod
    def _compact_project_sheet_size(value: str) -> str:
        text = str(value or "").strip().lower().replace("mm", "").replace("in", "")
        if not text:
            return ""
        for sep in ("x", "*", "by", "/", "\\"):
            text = text.replace(sep, " ")
        bits = [b for b in text.split() if b]
        if len(bits) < 2:
            return ""
        try:
            a = float(bits[0])
            b = float(bits[1])
            long_edge = max(a, b)
            meters = long_edge / 1000.0
            return f"{(math.floor(meters * 10.0) / 10.0):.1f}"
        except Exception:
            return ""

    def _project_board_definitions(self, raw: dict | None) -> list[dict]:
        payload = self._load_project_settings_payload(raw)
        unit_suffix = "in" if str((self._company or {}).get("measurementUnit") or "mm").strip().lower() in ("in", "inch", "inches") else "mm"
        rows = payload.get("boardTypes") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            rows = []
        defs: list[dict] = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            explicit = str(row.get("name") or row.get("label") or row.get("board") or "").strip()
            colour = str(row.get("colour") or row.get("color") or "").strip()
            thickness = str(row.get("thickness") or "").strip()
            finish = str(row.get("finish") or "").strip()
            if explicit:
                base_label = explicit
            else:
                parts = [p for p in [colour, (f"{thickness} {unit_suffix}" if thickness else ""), finish] if p]
                base_label = " ".join(parts).strip()
            if not base_label:
                continue
            sheet = str(row.get("sheetSize") or row.get("sheetSizeHw") or "").strip()
            compact = self._compact_project_sheet_size(sheet)
            size_label = compact or str(sheet or "").strip()
            display = f"[{size_label}] {base_label}" if size_label else base_label
            key = f"board::{idx + 1}"
            aliases = {base_label, display}
            if colour or thickness or finish:
                th_raw = thickness
                lower_th = thickness.lower()
                if lower_th.endswith("mm") or lower_th.endswith("in"):
                    th_unit = thickness
                else:
                    th_unit = (f"{thickness}{unit_suffix}" if thickness else "")
                dot_parts_raw = [p for p in [colour, th_raw, finish] if p]
                dot_parts_mm = [p for p in [colour, th_unit, finish] if p]
                if dot_parts_raw:
                    aliases.add(" · ".join(dot_parts_raw))
                if dot_parts_mm:
                    aliases.add(" · ".join(dot_parts_mm))
                    aliases.add(" ".join(dot_parts_mm))
            defs.append(
                {
                    "key": key,
                    "base": base_label,
                    "display": display,
                    "sheet": sheet,
                    "grain": bool(row.get("grain")) or str(row.get("grain") or "").strip().lower() in ("1", "true", "yes", "y", "on", "long"),
                    "lacquer": bool(row.get("lacquer")) or str(row.get("lacquer") or "").strip().lower() in ("1", "true", "yes", "y", "on"),
                    "aliases": [a for a in aliases if str(a).strip()],
                }
            )
        return defs

    def _project_board_options(self, raw: dict | None) -> list[str]:
        return [str(d.get("key") or "") for d in self._project_board_definitions(raw) if str(d.get("key") or "").strip()]

    def _project_board_sheet_size_map(self, raw: dict | None) -> dict[str, str]:
        out: dict[str, str] = {}
        for d in self._project_board_definitions(raw):
            key = str(d.get("key") or "").strip()
            sheet = str(d.get("sheet") or "").strip()
            if not key:
                continue
            if not sheet:
                continue
            out[key] = sheet
        return out

    def _project_board_edging_map(self, raw: dict | None) -> dict[str, str]:
        out: dict[str, str] = {}
        payload = self._load_project_settings_payload(raw)
        rows = payload.get("boardTypes") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            rows = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            key = f"board::{idx + 1}"
            edging = str(row.get("edging") or row.get("edge") or row.get("edgeTape") or "").strip()
            if edging:
                out[key] = edging
        return out

    def _project_board_display_map(self, raw: dict | None) -> dict[str, str]:
        out: dict[str, str] = {}
        for d in self._project_board_definitions(raw):
            key = str(d.get("key") or "").strip()
            display = str(d.get("display") or d.get("base") or "").strip()
            if key and display:
                out[key] = display
        return out

    def _project_board_grain_map(self, raw: dict | None) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for d in self._project_board_definitions(raw):
            key = str(d.get("key") or "").strip()
            if not key:
                continue
            out[key] = bool(d.get("grain"))
        return out

    def _project_board_lacquer_map(self, raw: dict | None) -> dict[str, bool]:
        out: dict[str, bool] = {}
        for d in self._project_board_definitions(raw):
            key = str(d.get("key") or "").strip()
            if not key:
                continue
            out[key] = bool(d.get("lacquer"))
        return out

    def _project_board_alias_to_key_map(self, raw: dict | None) -> dict[str, str]:
        out: dict[str, str] = {}
        for d in self._project_board_definitions(raw):
            key = str(d.get("key") or "").strip()
            if not key:
                continue
            for alias in (d.get("aliases") or []):
                txt = str(alias or "").strip()
                if not txt:
                    continue
                if txt not in out:
                    out[txt] = key
                norm = self._part_key(txt)
                if norm and norm not in out:
                    out[norm] = key
        return out

    def _migrate_cutlist_board_values(self, raw: dict | None, rows: list[dict]) -> tuple[list[dict], bool]:
        alias_map = self._project_board_alias_to_key_map(raw)
        if not alias_map:
            return [dict(r) for r in rows if isinstance(r, dict)], False
        changed = False
        migrated: list[dict] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            item = dict(row)
            board = str(item.get("board") or "").strip()
            if board:
                mapped = alias_map.get(board) or alias_map.get(self._part_key(board)) or board
                if mapped != board:
                    item["board"] = mapped
                    changed = True
            migrated.append(item)
        return migrated, changed

    def _project_has_grain_board(self, raw: dict | None) -> bool:
        payload = self._load_project_settings_payload(raw)
        rows = payload.get("boardTypes") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return False
        for row in rows:
            if not isinstance(row, dict):
                continue
            grain = row.get("grain")
            if isinstance(grain, bool) and grain:
                return True
            if str(grain or "").strip().lower() in ("1", "true", "yes", "y", "on", "long"):
                return True
        return False

    @staticmethod
    def _parse_positive_number(value: object) -> float | None:
        txt = str(value or "").strip()
        if not txt:
            return None
        try:
            num = float(txt)
        except Exception:
            return None
        if num <= 0:
            return None
        return num

    @staticmethod
    def _parse_mm_number(value: object) -> float | None:
        txt = str(value or "").strip().lower()
        if not txt:
            return None
        txt = txt.replace("mm", "").replace(",", "")
        m = re.search(r"[-+]?\d*\.?\d+", txt)
        if not m:
            return None
        try:
            num = float(m.group(0))
        except Exception:
            return None
        if not math.isfinite(num) or num <= 0:
            return None
        return num

    @staticmethod
    def _format_mm_value(value: float | None) -> str:
        if value is None:
            return ""
        try:
            num = float(value)
        except Exception:
            return ""
        if not math.isfinite(num) or num <= 0:
            return ""
        if abs(num - round(num)) < 1e-6:
            return str(int(round(num)))
        return f"{num:.3f}".rstrip("0").rstrip(".")

    @staticmethod
    def _parse_drawer_height_tokens(value: object) -> list[str]:
        txt = str(value or "").strip()
        if not txt:
            return []
        return [t.strip() for t in re.split(r"[,+/\\\s]+", txt) if t.strip()]

    def _project_board_thickness_map(self, raw: dict | None) -> dict[str, float]:
        out: dict[str, float] = {}
        payload = self._load_project_settings_payload(raw)
        rows = payload.get("boardTypes") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return out
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            key = f"board::{idx + 1}"
            thickness = self._parse_mm_number(row.get("thickness"))
            if thickness is not None and thickness > 0:
                out[key] = float(thickness)
        return out

    @staticmethod
    def _parse_cabinet_shelves_summary(value: object) -> dict[str, str]:
        out = {
            "fixed_qty": "",
            "fixed_drilling": "",
            "adjustable_qty": "",
            "adjustable_drilling": "",
        }
        txt = str(value or "").strip()
        if not txt:
            return out
        for line in re.split(r"[\r\n]+", txt):
            token = str(line or "").strip()
            if not token:
                continue
            m = re.match(r"(?i)^\s*(fixed|adjustable)(?:\s*shelf)?\s*:\s*(.+?)\s*$", token)
            if not m:
                continue
            kind = str(m.group(1) or "").strip().lower()
            rest = str(m.group(2) or "").strip()
            qty = ""
            drill = ""
            if "|" in rest:
                left, right = rest.split("|", 1)
                qty = str(left or "").strip()
                drill = str(right or "").strip()
            else:
                qty = rest
            drill = re.sub(r"(?i)^\s*drilling\s*:\s*", "", drill).strip()
            if kind == "fixed":
                out["fixed_qty"] = qty
                out["fixed_drilling"] = drill
            elif kind == "adjustable":
                out["adjustable_qty"] = qty
                out["adjustable_drilling"] = drill
        return out

    def _expand_cutlist_rows_for_manufacturing(self, raw: dict | None, rows: list[dict] | None) -> list[dict]:
        src_rows = [dict(r) for r in (rows or []) if isinstance(r, dict)]
        drawer_map = self._company_part_type_drawer_map()
        cabinetry_map = self._company_part_type_cabinetry_map()
        include_map = self._company_part_type_include_in_cutlists_map()
        board_thickness_map = self._project_board_thickness_map(raw)
        spec = dict(self._project_drawer_breakdown_spec(raw) or {})
        bottoms_w_minus = self._parse_mm_number(spec.get("bottomsWidthMinus"))
        bottoms_d_minus = self._parse_mm_number(spec.get("bottomsDepthMinus"))
        backs_w_minus = self._parse_mm_number(spec.get("backsWidthMinus"))
        letter_map_raw = spec.get("backLetterValues") if isinstance(spec.get("backLetterValues"), dict) else {}
        letter_map = {self._part_key(str(k or "")): str(v or "").strip() for k, v in letter_map_raw.items() if str(k or "").strip()}
        space_requirement = self._parse_mm_number(spec.get("spaceRequirement"))
        hardware_lengths: list[float] = []
        if isinstance(spec.get("hardwareLengths"), list):
            for item in (spec.get("hardwareLengths") or []):
                v = self._parse_mm_number(item)
                if v is not None:
                    hardware_lengths.append(float(v))
        hardware_lengths.sort()

        out: list[dict] = []
        for row in src_rows:
            include_in_nesting = row.get("includeInNesting", True)
            if isinstance(include_in_nesting, str):
                include_in_nesting = include_in_nesting.strip().lower() not in ("0", "false", "no", "off", "n")
            if include_in_nesting is False:
                continue
            part_type = str(row.get("partType") or row.get("part_type") or "").strip()
            part_key = self._part_key(part_type)
            if part_key and not bool(include_map.get(part_key, True)):
                continue
            if bool(cabinetry_map.get(part_key, False)):
                base_name = str(row.get("name") or row.get("partName") or "Cabinet").strip() or "Cabinet"
                width_val = self._parse_mm_number(row.get("width"))
                height_val = self._parse_mm_number(row.get("height"))
                depth_val = self._parse_mm_number(row.get("depth"))
                row_qty = self._parse_positive_number(row.get("quantity"))
                if row_qty is None:
                    row_qty = self._parse_positive_number(row.get("qty"))
                qty_count = max(1, int(round(float(row_qty or 1.0))))

                board_key = str(row.get("board") or row.get("boardType") or "").strip()
                thickness = float(board_thickness_map.get(board_key) or 0.0)

                w_inner = (float(width_val) - (2.0 * thickness)) if width_val is not None else None
                d_inner = (float(depth_val) - thickness) if depth_val is not None else None
                back_w = w_inner
                side_h = float(height_val) if height_val is not None else None
                side_d = float(depth_val) if depth_val is not None else None
                back_h = float(height_val) if height_val is not None else None

                shelf_summary = self._parse_cabinet_shelves_summary(
                    row.get("clashing") or row.get("shelves") or ""
                )
                adjustable_qty = self._parse_positive_number(
                    row.get("adjustableShelf")
                    or row.get("adjustableShelves")
                    or row.get("adjustable_shelves")
                    or shelf_summary.get("adjustable_qty")
                )
                fixed_qty = self._parse_positive_number(
                    row.get("fixedShelf")
                    or row.get("fixedShelves")
                    or row.get("fixed_shelves")
                    or shelf_summary.get("fixed_qty")
                )

                def _append_piece(piece_name: str, a_dim: float | None, b_dim: float | None, piece_qty: int) -> None:
                    if a_dim is None or b_dim is None:
                        return
                    if a_dim <= 0 or b_dim <= 0 or piece_qty <= 0:
                        return
                    piece_row = dict(row)
                    piece_row["name"] = f"{base_name} {piece_name}"
                    piece_row["partName"] = piece_row["name"]
                    piece_row["height"] = self._format_mm_value(a_dim)
                    piece_row["width"] = self._format_mm_value(b_dim)
                    piece_row["depth"] = ""
                    piece_row["quantity"] = str(max(1, int(piece_qty)))
                    piece_row["qty"] = piece_row["quantity"]
                    piece_row["__expandedCabinetPart"] = True
                    out.append(piece_row)

                _append_piece("Top", w_inner, d_inner, qty_count)
                _append_piece("Bottom", w_inner, d_inner, qty_count)
                _append_piece("Left Side", side_h, side_d, qty_count)
                _append_piece("Right Side", side_h, side_d, qty_count)
                _append_piece("Back", back_w, back_h, qty_count)

                if adjustable_qty is not None and adjustable_qty > 0:
                    shelf_d = (float(depth_val) - thickness - 10.0) if depth_val is not None else None
                    _append_piece("Adjustable Shelf", w_inner, shelf_d, qty_count * int(round(adjustable_qty)))
                if fixed_qty is not None and fixed_qty > 0:
                    shelf_d = (float(depth_val) - thickness) if depth_val is not None else None
                    _append_piece("Fixed Shelf", w_inner, shelf_d, qty_count * int(round(fixed_qty)))
                continue

            if not bool(drawer_map.get(part_key, False)):
                out.append(dict(row))
                continue

            base_name = str(row.get("name") or row.get("partName") or "Drawer").strip() or "Drawer"
            width_val = self._parse_mm_number(row.get("width"))
            depth_val = self._parse_mm_number(row.get("depth"))
            height_raw = str(row.get("height") or "").strip()
            tokens = self._parse_drawer_height_tokens(height_raw)
            if not tokens and height_raw:
                tokens = [height_raw]
            if not tokens:
                tokens = [""]
            bottom_qty = max(1, len(tokens))

            # Drawer depth workflow:
            # 1) entered depth
            # 2) minus space requirement
            # 3) round down to nearest configured hardware length
            # 4) minus drawer-bottom depth offset
            depth_base = depth_val
            if depth_val is not None:
                depth_for_hardware = float(depth_val)
                if space_requirement is not None:
                    depth_for_hardware = max(0.0, depth_for_hardware - float(space_requirement))
                rounded_hardware_depth = depth_for_hardware
                if hardware_lengths:
                    candidates = [v for v in hardware_lengths if v <= float(depth_for_hardware)]
                    if candidates:
                        rounded_hardware_depth = max(candidates)
                depth_base = rounded_hardware_depth

            bottom_w = (float(width_val) - float(bottoms_w_minus)) if width_val is not None and bottoms_w_minus is not None else width_val
            bottom_d = (float(depth_base) - float(bottoms_d_minus)) if depth_base is not None and bottoms_d_minus is not None else depth_base
            back_w = (float(width_val) - float(backs_w_minus)) if width_val is not None and backs_w_minus is not None else width_val

            bottom_row = dict(row)
            bottom_row["name"] = f"{base_name} Bottom"
            bottom_row["partName"] = bottom_row["name"]
            bottom_row["height"] = self._format_mm_value(bottom_d)
            bottom_row["width"] = self._format_mm_value(bottom_w)
            bottom_row["depth"] = ""
            bottom_row["quantity"] = str(bottom_qty)
            bottom_row["clashing"] = ""
            out.append(bottom_row)

            grouped: dict[str, int] = {}
            for tok in tokens:
                key = str(tok or "").strip()
                grouped[key] = int(grouped.get(key, 0)) + 1
            for letter, count in grouped.items():
                back_h = str(letter_map.get(self._part_key(letter)) or "").strip() if letter else ""
                if not back_h:
                    back_h = letter
                back_h_num = self._parse_positive_number(back_h)
                clash = ""
                if back_w is not None and back_h_num is not None and back_h_num > 0:
                    clash = "1S" if float(back_w) < float(back_h_num) else "1L"
                back_row = dict(row)
                back_row["name"] = f"{base_name} Back" + (f" ({letter})" if letter else "")
                back_row["partName"] = back_row["name"]
                back_row["height"] = str(back_h or "")
                back_row["width"] = self._format_mm_value(back_w)
                back_row["depth"] = ""
                back_row["quantity"] = str(max(1, int(count)))
                back_row["clashing"] = clash
                out.append(back_row)
        return out

    def _company_board_thickness_options(self) -> list[str]:
        out: list[str] = []
        for row in (self._company.get("boardThicknesses") or []):
            text = str(row).strip()
            if text and text not in out:
                out.append(text)
        return out

    def _company_board_finish_options(self) -> list[str]:
        out: list[str] = []
        for row in (self._company.get("boardFinishes") or []):
            text = str(row).strip()
            if text and text not in out:
                out.append(text)
        return out

    def _company_board_colour_suggestions(self) -> list[str]:
        stats = self._company_board_material_usage_stats()
        return [str(row.get("value") or "").strip() for row in (stats.get("colours") or []) if str(row.get("value") or "").strip()]

    def _company_board_material_usage_stats(self) -> dict:
        raw = (self._company or {}).get("boardMaterialUsage") or {}
        if isinstance(raw, dict):
            def _clean(rows, fields: tuple[str, ...]) -> list[dict]:
                out: list[dict] = []
                for row in (rows or []):
                    if not isinstance(row, dict):
                        continue
                    try:
                        count = int(row.get("count") or 0)
                    except Exception:
                        count = 0
                    if count < 0:
                        continue
                    item = {"count": count}
                    valid = True
                    for field in fields:
                        text = str(row.get(field) or "").strip()
                        if not text:
                            valid = False
                            break
                        item[field] = text
                    if valid:
                        out.append(item)
                out.sort(key=lambda item: tuple([-int(item.get("count") or 0)] + [str(item.get(f) or "").lower() for f in fields]))
                return out

            return {
                "colours": _clean(raw.get("colours"), ("value",)),
                "thicknesses": [],
                "finishes": [],
                "colourThickness": [],
                "colourFinish": [],
                "thicknessFinish": [],
            }
        # Legacy fallback: row-combo list.
        colours: dict[str, dict] = {}
        for row in (raw or []):
            if not isinstance(row, dict):
                continue
            colour = str(row.get("colour") or row.get("color") or "").strip()
            try:
                count = int(row.get("count") or 0)
            except Exception:
                count = 0
            if count <= 0:
                continue
            ck = self._part_key(colour)
            if ck:
                item = colours.setdefault(ck, {"value": colour, "count": 0})
                item["count"] = int(item.get("count") or 0) + count

        def _sorted(rows: dict[str, dict], fields: tuple[str, ...]) -> list[dict]:
            out = [dict(v) for v in rows.values()]
            out.sort(key=lambda item: tuple([-int(item.get("count") or 0)] + [str(item.get(f) or "").lower() for f in fields]))
            return out

        return {
            "colours": _sorted(colours, ("value",)),
            "thicknesses": [],
            "finishes": [],
            "colourThickness": [],
            "colourFinish": [],
            "thicknessFinish": [],
        }

    def _company_sheet_size_options(self) -> list[str]:
        out: list[str] = []
        for row in (self._company.get("sheetSizes") or []):
            h = ""
            w = ""
            if isinstance(row, dict):
                h = str(row.get("h") or row.get("height") or "").strip()
                w = str(row.get("w") or row.get("width") or "").strip()
            elif isinstance(row, str):
                text = row.strip()
                if "x" in text.lower():
                    parts = text.lower().replace(" ", "").split("x", 1)
                    if len(parts) == 2:
                        h = parts[0].strip()
                        w = parts[1].strip()
            if h and w:
                item = f"{h} x {w}"
                if item not in out:
                    out.append(item)
        return out

    def _company_default_sheet_size_option(self) -> str:
        for row in (self._company.get("sheetSizes") or []):
            if not isinstance(row, dict):
                continue
            if not bool(row.get("default")):
                continue
            h = str(row.get("h") or row.get("height") or "").strip()
            w = str(row.get("w") or row.get("width") or "").strip()
            if h and w:
                return f"{h} x {w}"
        options = self._company_sheet_size_options()
        return str(options[0]) if options else ""


