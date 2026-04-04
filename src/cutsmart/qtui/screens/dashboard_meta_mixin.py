from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, available_timezones
from PySide6.QtCore import QDateTime, Qt, QTimeZone


class DashboardMetaMixin:

    def _default_user_display_name(self, email: str) -> str:
        base = str(email or "").strip()
        if "@" in base:
            base = base.split("@", 1)[0]
        base = base.strip() or "User"
        return base[:1].upper() + base[1:]

    def _initials_from_text(self, text: str) -> str:
        label = str(text or "").strip()
        if not label:
            return "U"
        words = [w for w in label.replace("_", " ").replace("-", " ").split() if w]
        if len(words) >= 2:
            return (words[0][0] + words[1][0]).upper()
        if len(words) == 1 and len(words[0]) >= 2:
            return words[0][:2].upper()
        return label[:1].upper()

    def _company_timezone_name(self) -> str:
        try:
            tz = str((getattr(self, "_company", {}) or {}).get("timeZone") or "").strip()
        except Exception:
            tz = ""
        up = tz.upper().replace(" ", "")
        if up in {"NZT", "NZST", "NZDT", "AUCKLAND", "PACIFIC/AUCKLAND"} or up.startswith("NZT("):
            return "Pacific/Auckland"
        return tz or "Pacific/Auckland"

    def _parse_utc_offset_minutes(self, value: str) -> int | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        txt = raw.upper().replace(" ", "")
        # Accept: UTC+13, UTC-05, UTC+09:30, +13, -05:00
        m = re.match(r"^(?:UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$", txt)
        if not m:
            return None
        sign = -1 if m.group(1) == "-" else 1
        try:
            hours = int(m.group(2))
            mins = int(m.group(3) or "0")
        except Exception:
            return None
        if hours < 0 or hours > 23 or mins < 0 or mins > 59:
            return None
        return sign * (hours * 60 + mins)

    def _resolve_tzinfo(self):
        raw = self._company_timezone_name()
        offset_mins = self._parse_utc_offset_minutes(raw)
        if offset_mins is not None:
            return timezone(timedelta(minutes=offset_mins))
        # Fast path for valid canonical zone ids.
        try:
            return ZoneInfo(raw)
        except Exception:
            pass
        # Handle case-only mismatches, e.g. "pacific/auckland".
        try:
            lower = raw.lower()
            for name in available_timezones():
                if name.lower() == lower:
                    return ZoneInfo(name)
        except Exception:
            pass
        # Safe fallback that still renders consistently.
        return timezone.utc

    def _parse_iso_datetime(self, value: str) -> datetime | None:
        text = str(value or "").strip()
        if not text:
            return None
        cleaned = text.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(cleaned)
        except Exception:
            return None
        if dt.tzinfo is None:
            # Backend timestamps are UTC; treat naive values as UTC.
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    def _display_datetime(self, value: str) -> datetime | None:
        dt = self._parse_iso_datetime(value)
        if dt is None:
            return None
        dt_utc = dt.astimezone(timezone.utc)
        tz_name = self._company_timezone_name()
        try:
            converted = dt_utc.astimezone(self._resolve_tzinfo())
            up = tz_name.upper().replace(" ", "")
            is_named_zone = ("/" in tz_name) or (up in {"NZT", "NZST", "NZDT"})
            if not is_named_zone:
                return converted
            offset = converted.utcoffset()
            if isinstance(offset, timedelta) and int(offset.total_seconds()) != 0:
                return converted
            if up in {"UTC", "GMT"} or up.startswith("UTC+") or up.startswith("UTC-"):
                return converted
        except Exception:
            pass
        # Fallback for Windows hosts without zoneinfo database: use Qt timezone conversion.
        try:
            qtz = QTimeZone(bytes(tz_name, "utf-8"))
            if qtz.isValid():
                ms = int(dt_utc.timestamp() * 1000)
                qdt_utc = QDateTime.fromMSecsSinceEpoch(ms, Qt.TimeSpec.UTC)
                qdt_local = qdt_utc.toTimeZone(qtz)
                d = qdt_local.date()
                t = qdt_local.time()
                offset_seconds = int(qtz.offsetFromUtc(qdt_utc))
                return datetime(
                    d.year(),
                    d.month(),
                    d.day(),
                    t.hour(),
                    t.minute(),
                    t.second(),
                    int(t.msec()) * 1000,
                    tzinfo=timezone(timedelta(seconds=offset_seconds)),
                )
        except Exception:
            pass
        return dt_utc

    def _short_date(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return "-"
        dt = self._display_datetime(text)
        if dt is not None:
            month_names = [
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
            ]
            return f"{dt.day:02d} {month_names[dt.month - 1]} {dt.year}"
        ymd = text[:10]
        parts = ymd.split("-")
        if len(parts) == 3 and len(parts[0]) == 4:
            try:
                year = int(parts[0])
                month = int(parts[1])
                day = int(parts[2])
                month_names = [
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December",
                ]
                if 1 <= month <= 12:
                    return f"{day:02d} {month_names[month - 1]} {year}"
            except Exception:
                pass
        return ymd

    def _short_date_with_time(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return "-"
        date_txt = self._short_date(text)
        dt = self._display_datetime(text)
        if dt is not None:
            hh = int(dt.hour)
            mm = int(dt.minute)
            ampm = "am" if hh < 12 else "pm"
            hh12 = hh % 12
            if hh12 == 0:
                hh12 = 12
            return f"{date_txt}  |  {hh12}:{mm:02d}{ampm}"
        m = re.search(r"[T\s](\d{1,2}):(\d{2})", text)
        if not m:
            return date_txt
        try:
            hh = int(m.group(1))
            mm = int(m.group(2))
            ampm = "am" if hh < 12 else "pm"
            hh12 = hh % 12
            if hh12 == 0:
                hh12 = 12
            return f"{date_txt}  |  {hh12}:{mm:02d}{ampm}"
        except Exception:
            return date_txt

    def _short_date_with_time_rich(self, value: str, divider_color: str = "#D7DEE8") -> str:
        plain = self._short_date_with_time(value)
        marker = "  |  "
        if marker not in plain:
            return plain
        left, right = plain.split(marker, 1)
        return (
            f"{left}&nbsp;&nbsp;<span style='color:{divider_color}; font-weight:700;'>&#124;</span>&nbsp;&nbsp;{right}"
        )

    def _project_creator_display_name(self, raw: dict | None) -> str:
        if not isinstance(raw, dict):
            return "Unknown"
        creator_uid = str((raw or {}).get("createdByUid") or "").strip()
        fallback = str((raw or {}).get("createdByName") or creator_uid or "Unknown").strip() or "Unknown"
        if creator_uid:
            for person in (self._staff_all or []):
                if not isinstance(person, dict):
                    continue
                puid = str((person or {}).get("uid") or "").strip()
                if puid != creator_uid:
                    continue
                display = str((person or {}).get("displayName") or "").strip()
                if display:
                    return display
                email_name = str((person or {}).get("email") or "").strip()
                if email_name:
                    return email_name
                break
        return fallback
