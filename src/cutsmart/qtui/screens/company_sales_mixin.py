from __future__ import annotations

import base64
import html
import json
import mimetypes
import re
from pathlib import Path
import uuid
from urllib.parse import quote
from urllib.request import Request, urlopen

from PySide6.QtCore import QEvent, QObject, QPoint, Qt, QUrl, QTimer, QMimeData, QSize
from PySide6.QtGui import QBrush, QDoubleValidator, QColor, QFont, QFontMetrics, QTextCharFormat, QDrag
from PySide6.QtWidgets import QApplication, QAbstractItemView, QCheckBox, QColorDialog, QComboBox, QDialog, QFontComboBox, QFrame, QGridLayout, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QPushButton, QScrollArea, QSizePolicy, QSlider, QSpinBox, QTabWidget, QTableWidget, QTableWidgetItem, QTextEdit, QVBoxLayout, QWidget, QInputDialog, QToolButton, QStyle
from cutsmart.qtui.screens.dashboard_widgets import ReorderableTableWidget


class CompanySalesMixin:

    def _default_quote_base_layout_html(self) -> str:
        return (
            "<table style='width:100%; border-collapse:collapse; table-layout:fixed; margin:0;'>"
            "<tr>"
            "<td style='width:65%; vertical-align:top; padding:0 8px 0 0;'>"
            "<p style='margin:0;'><strong>Project:</strong> {{project_name}}</p>"
            "<p style='margin:4px 0 0 0;'><strong>Client:</strong> {{client_name}}</p>"
            "<p style='margin:4px 0 0 0;'><strong>Address:</strong> {{client_address}}</p>"
            "<p style='margin:4px 0 0 0;'><strong>Quote Date:</strong> {{quote_generated_date}}</p>"
            "</td>"
            "<td style='width:35%; vertical-align:top; text-align:right; padding:0;'>"
            "{{company_logo}}"
            "</td>"
            "</tr>"
            "</table>"
            "<div style='border:1px solid #D1D5DB; padding:8px; margin-top:8px;'>"
            "<p style='margin:0;'><strong>Dear {{client_name}},</strong></p>"
            "<p style='margin:6px 0 0 0;'>Thank you for the opportunity to quote this project.</p>"
            "</div>"
            "<table style='width:100%; border-collapse:collapse; table-layout:fixed; margin-top:8px;'>"
            "<tr>"
            "<td style='width:50%; border:1px solid #D1D5DB; padding:8px; vertical-align:top;'><strong>Total:</strong></td>"
            "<td style='width:50%; border:1px solid #D1D5DB; padding:8px; vertical-align:top; text-align:right;'><strong>{{total_price}}</strong></td>"
            "</tr>"
            "</table>"
            "<div style='border:1px solid #D1D5DB; padding:8px; margin-top:8px;'>"
            "<p style='margin:0; color:#B91C1C;'><strong>Promotional Discount:</strong></p>"
            "<p style='margin:4px 0 0 0; color:#B91C1C;'>Includes new accessories up to {{promotional_discount_amount}} (including GST).</p>"
            "</div>"
            "<div style='border:1px solid #D1D5DB; padding:8px; margin-top:8px;'>"
            "<p style='margin:0;'><strong>Notes:</strong></p>"
            "<p style='margin:4px 0 0 0;'>This quotation excludes appliances and external trades unless specified.</p>"
            "</div>"
            "<div style='border:1px solid #D1D5DB; padding:8px; margin-top:8px;'>"
            "<p style='margin:0;'><strong>Kind Regards,</strong></p>"
            "<p style='margin:8px 0 0 0;'>{{project_creator}}</p>"
            "</div>"
        )

    def _load_company_quote_template(self) -> None:
        base_html = str((self._company or {}).get("quoteBaseLayoutHtml") or "").strip()
        if not base_html:
            base_html = self._default_quote_base_layout_html()
        try:
            ver = int((self._company or {}).get("quoteBaseLayoutVersion") or 1)
        except Exception:
            ver = 1
        ver = max(1, ver)
        plain = re.sub(r"<[^>]+>", "", base_html).strip()
        if len(plain) > 120:
            plain = plain[:117].rstrip() + "..."
        lbl = getattr(self, "_company_quote_preset_status_label", None)
        if not isinstance(lbl, QLabel):
            lbl = getattr(self, "_company_quote_template_status_label", None)
        if isinstance(lbl, QLabel):
            lbl.setText(f"Preset v{ver}: {plain}")
            lbl.setStyleSheet("QLabel { color: #44556D; font-size: 12px; }")

    def _open_quote_base_layout_editor(self) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        dlg = QDialog(self)
        dlg.setWindowTitle("Edit Quote Base Layout")
        dlg.resize(1180, 820)
        lay = QVBoxLayout(dlg)
        lay.setContentsMargins(10, 10, 10, 10)
        lay.setSpacing(8)
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or "#2F6BFF"), "#2F6BFF")
        note = QLabel("A4 visual preset editor. Add header/footer containers (1-6 columns), then set each column to Text / Company Logo / Empty.")
        note.setWordWrap(True)
        note.setStyleSheet("QLabel { color:#6B7280; font-size:12px; }")
        lay.addWidget(note)

        raw_model = str((self._company or {}).get("quoteBaseLayoutModelJson") or "").strip()
        model = {"header": [], "footer": []}
        if raw_model:
            try:
                parsed = json.loads(raw_model)
                if isinstance(parsed, dict):
                    hdr = parsed.get("header")
                    ftr = parsed.get("footer")
                    model = {
                        "header": [x for x in hdr if isinstance(x, dict)] if isinstance(hdr, list) else [],
                        "footer": [x for x in ftr if isinstance(x, dict)] if isinstance(ftr, list) else [],
                    }
            except Exception:
                model = {"header": [], "footer": []}

        root_row = QHBoxLayout()
        root_row.setContentsMargins(0, 0, 0, 0)
        root_row.setSpacing(10)
        lay.addLayout(root_row, 1)

        inspector = QFrame()
        inspector.setFixedWidth(310)
        inspector.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:12px; }")
        ins_lay = QVBoxLayout(inspector)
        ins_lay.setContentsMargins(10, 10, 10, 10)
        ins_lay.setSpacing(8)
        ins_title = QLabel("Section Editor")
        ins_title.setStyleSheet("QLabel { color:#111827; font-size:13px; font-weight:800; }")
        ins_lay.addWidget(ins_title)
        sel_label = QLabel("No section selected")
        sel_label.setStyleSheet("QLabel { color:#4B5563; font-size:11px; font-weight:700; }")
        ins_lay.addWidget(sel_label)
        type_combo = QComboBox()
        type_combo.addItems(["Text", "Company Logo", "Empty"])
        type_combo.setFixedHeight(26)
        ins_lay.addWidget(type_combo)
        content_edit = QTextEdit()
        content_edit.setAcceptRichText(True)
        content_edit.setFixedHeight(180)
        content_edit.setStyleSheet("QTextEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:9px; }")
        ins_lay.addWidget(content_edit)
        bold_btn = QToolButton()
        bold_btn.setText("B")
        italic_btn = QToolButton()
        italic_btn.setText("I")
        under_btn = QToolButton()
        under_btn.setText("U")
        align_left_btn = QToolButton()
        align_left_btn.setText("L")
        align_center_btn = QToolButton()
        align_center_btn.setText("C")
        align_right_btn = QToolButton()
        align_right_btn.setText("R")
        text_color_btn = QToolButton()
        text_color_btn.setText("Color")
        font_family_combo = QFontComboBox()
        font_family_combo.setFixedHeight(24)
        font_family_combo.setMinimumWidth(130)
        font_family_combo.setStyleSheet("QFontComboBox { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:7px; font-weight:700; }")
        text_size_spin = QSpinBox()
        text_size_spin.setRange(6, 96)
        text_size_spin.setValue(11)
        text_size_spin.setFixedHeight(24)
        text_size_spin.setFixedWidth(58)
        text_size_spin.setStyleSheet("QSpinBox { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:7px; font-weight:700; }")
        for tb in (bold_btn, italic_btn, under_btn, align_left_btn, align_center_btn, align_right_btn, text_color_btn):
            tb.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:7px; font-weight:800; }")
        fmt_row = QHBoxLayout()
        fmt_row.setSpacing(6)
        fmt_row.addWidget(bold_btn)
        fmt_row.addWidget(italic_btn)
        fmt_row.addWidget(under_btn)
        fmt_row.addWidget(align_left_btn)
        fmt_row.addWidget(align_center_btn)
        fmt_row.addWidget(align_right_btn)
        fmt_row.addWidget(text_color_btn)
        fmt_row.addStretch(1)
        ins_lay.addLayout(fmt_row)

        fmt_font_row = QHBoxLayout()
        fmt_font_row.setSpacing(6)
        fmt_font_row.addWidget(font_family_combo, 1)
        fmt_font_row.addWidget(text_size_spin, 0)
        fmt_font_row.addStretch(1)
        ins_lay.addLayout(fmt_font_row)

        ins_lay.addStretch(1)
        root_row.addWidget(inspector, 0)

        stage_scroll = QScrollArea()
        stage_scroll.setWidgetResizable(True)
        stage_scroll.setFrameShape(QFrame.Shape.NoFrame)
        stage_scroll.setStyleSheet("QScrollArea { background:transparent; border:none; }")
        stage_host = QWidget()
        stage_lay = QVBoxLayout(stage_host)
        stage_lay.setContentsMargins(16, 16, 16, 16)
        stage_lay.setSpacing(0)
        stage_lay.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignHCenter)
        paper = QFrame()
        paper.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #D1D5DB; border-radius:10px; }")
        paper.setFixedWidth(794)
        paper.setMinimumHeight(1123)
        page_lay = QVBoxLayout(paper)
        page_lay.setContentsMargins(18, 18, 18, 18)
        page_lay.setSpacing(8)

        selected = {"zone": "", "cidx": -1, "ridx": -1, "k": -1}
        select_sync = {"active": False}
        body_selected = {"on": False}
        body_font_family_pref = {"value": str((self._company or {}).get("quoteTemplateBodyFontFamily") or "Segoe UI").strip() or "Segoe UI"}
        try:
            _body_sz_seed = int((self._company or {}).get("quoteTemplateBodyFontSizePt") or 11)
        except Exception:
            _body_sz_seed = 11
        body_font_size_pref = {"value": max(6, min(72, int(_body_sz_seed)))}
        body_color_pref = {"value": self._normalize_hex(str((self._company or {}).get("quoteTemplateBodyTextColor") or "#111827"), "#111827")}
        body_bold_pref = {"value": bool((self._company or {}).get("quoteTemplateBodyBold") is True)}
        body_italic_pref = {"value": bool((self._company or {}).get("quoteTemplateBodyItalic") is True)}
        body_underline_pref = {"value": bool((self._company or {}).get("quoteTemplateBodyUnderline") is True)}
        body_align_pref = {"value": str((self._company or {}).get("quoteTemplateBodyAlign") or "left").strip().lower() or "left"}
        body_default_html_pref = {"value": str((self._company or {}).get("quoteTemplateBodyDefaultHtml") or "").strip()}
        render_state = {"active": False, "pending": False}

        def _new_row(weights: list[int]) -> dict:
            ws = [max(1, int(w)) for w in (weights or [1])]
            if len(ws) > 6:
                ws = ws[:6]
            return {
                "weights": ws,
                "columns": [{"type": "text", "content": ""} for _ in range(len(ws))],
            }

        def _new_container(weights: list[int], zone: str) -> dict:
            next_idx = len(model.get(zone) if isinstance(model.get(zone), list) else []) + 1
            return {
                "name": f"Container {next_idx}",
                "bgColor": "#FFFFFF",
                "collapsed": False,
                "rows": [_new_row(weights)],
            }

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
            # Backward compatibility: old model had columns directly on container.
            old_cols = container.get("columns")
            if isinstance(old_cols, list):
                return [{"weights": [1 for _ in old_cols] if old_cols else [1], "columns": old_cols}]
            return []

        def _container_name(container: dict, cidx: int) -> str:
            raw = str((container or {}).get("name") or "").strip()
            return raw or f"Container {cidx + 1}"

        def _container_bg(container: dict) -> str:
            return self._normalize_hex(str((container or {}).get("bgColor") or "#FFFFFF"), "#FFFFFF")

        preset_layouts: list[list[int]] = [
            [1],
            [1, 1],
            [1, 1, 1],
            [1, 1, 1, 1],
            [2, 1],
            [1, 2],
            [3, 1],
            [1, 3],
            [1, 1, 2],
            [2, 1, 1],
            [1, 2, 1],
            [4, 1],
            [1, 4],
            [3, 2],
            [2, 3],
            [1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1],
        ]

        def _layout_label(weights: list[int]) -> str:
            total = max(1, sum(max(1, int(v)) for v in weights))
            return " | ".join(f"{max(1, int(v))}/{total}" for v in weights)

        def _pick_layout(title: str = "Insert Container") -> list[int] | None:
            chooser = QDialog(dlg)
            chooser.setWindowTitle(title)
            chooser.resize(980, 620)
            c_lay = QVBoxLayout(chooser)
            c_lay.setContentsMargins(10, 10, 10, 10)
            c_lay.setSpacing(8)
            top = QLabel("Choose a column layout")
            top.setStyleSheet("QLabel { color:#1F2937; font-size:14px; font-weight:800; }")
            c_lay.addWidget(top)
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(QFrame.Shape.NoFrame)
            host = QWidget()
            grid = QGridLayout(host)
            grid.setContentsMargins(0, 0, 0, 0)
            grid.setHorizontalSpacing(10)
            grid.setVerticalSpacing(10)
            picked: dict[str, list[int] | None] = {"v": None}
            for idx, weights in enumerate(preset_layouts):
                btn = QPushButton()
                btn.setCursor(Qt.CursorShape.PointingHandCursor)
                btn.setFixedSize(220, 94)
                mini = "<table style='width:100%;border-collapse:collapse;table-layout:fixed;'><tr>"
                tot = max(1, sum(weights))
                for w in weights:
                    pct = (float(max(1, int(w))) / float(tot)) * 100.0
                    mini += (
                        f"<td style='width:{pct:.4f}%;padding:4px;'>"
                        "<div style='height:46px;background:#A3A3A3;color:#F8FAFC;font-size:12px;font-weight:700;"
                        "display:flex;align-items:center;justify-content:center;'>"
                        f"{max(1, int(w))}/{tot}</div></td>"
                    )
                mini += "</tr></table>"
                btn.setText("")
                btn.setStyleSheet("QPushButton { background:#FFFFFF; border:1px dashed #C7CDD8; border-radius:4px; padding:6px; } QPushButton:hover { border:1px solid #3C8DBC; }")
                inner = QLabel(btn)
                inner.setTextFormat(Qt.TextFormat.RichText)
                inner.setText(mini)
                inner.setGeometry(8, 10, 204, 74)
                inner.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
                btn.clicked.connect(lambda _=False, ws=list(weights): (picked.__setitem__("v", ws), chooser.accept()))
                grid.addWidget(btn, idx // 4, idx % 4)
            scroll.setWidget(host)
            c_lay.addWidget(scroll, 1)
            if chooser.exec() == QDialog.DialogCode.Accepted:
                return picked.get("v")
            return None

        def _add_container(zone: str) -> None:
            weights = _pick_layout("Insert Container")
            if not weights:
                return
            model[zone].append(_new_container(weights, zone))
            _render_layout()

        def _add_row_to_container(zone: str, cidx: int) -> None:
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if cidx < 0 or cidx >= len(rows):
                return
            weights = _pick_layout("Insert Row Layout")
            if not weights:
                return
            container = rows[cidx] if isinstance(rows[cidx], dict) else {}
            rlist = _container_rows(container)
            rlist.append(_new_row(weights))
            container["rows"] = rlist
            rows[cidx] = container
            model[zone] = rows
            _render_layout()

        def _delete_container(zone: str, cidx: int) -> None:
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if cidx < 0 or cidx >= len(rows):
                return
            rows.pop(cidx)
            model[zone] = rows
            if str(selected.get("zone") or "") == zone and int(selected.get("cidx", -1)) == cidx:
                selected["zone"] = ""
                selected["cidx"] = -1
                selected["ridx"] = -1
                selected["k"] = -1
                sel_label.setText("No section selected")
            _render_layout()

        def _delete_column(zone: str, cidx: int, ridx: int, k: int) -> None:
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if cidx < 0 or cidx >= len(rows):
                return
            container = rows[cidx] if isinstance(rows[cidx], dict) else {}
            crow_list = _container_rows(container)
            if ridx < 0 or ridx >= len(crow_list):
                return
            crow = crow_list[ridx] if isinstance(crow_list[ridx], dict) else {}
            cols = crow.get("columns") if isinstance(crow.get("columns"), list) else []
            ws = crow.get("weights") if isinstance(crow.get("weights"), list) else [1 for _ in cols]
            if k < 0 or k >= len(cols):
                return
            cols.pop(k)
            if k < len(ws):
                ws.pop(k)
            if cols:
                if not ws:
                    ws = [1 for _ in cols]
                crow["columns"] = cols
                crow["weights"] = ws
                crow_list[ridx] = crow
            else:
                crow_list.pop(ridx)
            if crow_list:
                container["rows"] = crow_list
                rows[cidx] = container
            else:
                rows.pop(cidx)
            model[zone] = rows
            if str(selected.get("zone") or "") == zone:
                if int(selected.get("cidx", -1)) == cidx and int(selected.get("ridx", -1)) == ridx:
                    if cols:
                        cur = int(selected.get("k", -1))
                        if cur == k:
                            selected["k"] = max(0, min(k, len(cols) - 1))
                        elif cur > k:
                            selected["k"] = cur - 1
                    else:
                        selected["zone"] = ""
                        selected["cidx"] = -1
                        selected["ridx"] = -1
                        selected["k"] = -1
                        sel_label.setText("No section selected")
            _render_layout()

        def _delete_selected_column() -> None:
            zone = str(selected.get("zone") or "")
            cidx = int(selected.get("cidx", -1))
            ridx = int(selected.get("ridx", -1))
            k = int(selected.get("k", -1))
            if not zone:
                return
            _delete_column(zone, cidx, ridx, k)

        def _delete_column_from_button(btn: QPushButton) -> None:
            if not isinstance(btn, QPushButton):
                return
            zone = str(btn.property("cs_zone") or "")
            try:
                cidx = int(btn.property("cs_cidx"))
                ridx = int(btn.property("cs_ridx"))
                k = int(btn.property("cs_k"))
            except Exception:
                return
            if not zone:
                return
            _delete_column(zone, cidx, ridx, k)

        def _set_container_height(zone: str, cidx: int, value: int, slider: QSlider | None = None, spin: QSpinBox | None = None) -> None:
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if cidx < 0 or cidx >= len(rows):
                return
            container = rows[cidx] if isinstance(rows[cidx], dict) else {}
            try:
                iv = int(value)
            except Exception:
                iv = 0
            container["heightPx"] = iv
            rows[cidx] = container
            model[zone] = rows
            if isinstance(slider, QSlider):
                slider.blockSignals(True)
                slider.setValue(iv)
                slider.blockSignals(False)
            if isinstance(spin, QSpinBox):
                spin.blockSignals(True)
                spin.setValue(iv)
                spin.blockSignals(False)
            _render_layout()

        class _EditorKeyFilter(QObject):
            def __init__(self, owner):
                super().__init__(owner)
            def eventFilter(self, obj, event):
                try:
                    if event is not None and event.type() == QEvent.Type.KeyPress:
                        key = int(event.key()) if hasattr(event, "key") else 0
                        if key in (int(Qt.Key.Key_X), int(Qt.Key.Key_Delete), int(Qt.Key.Key_Backspace)):
                            fw = QApplication.focusWidget()
                            if isinstance(fw, (QTextEdit, QLineEdit, QSpinBox, QComboBox, QFontComboBox)):
                                return False
                            _delete_selected_column()
                            return True
                except Exception:
                    return False
                return False

        _editor_key_filter = _EditorKeyFilter(dlg)
        dlg.installEventFilter(_editor_key_filter)

        class _AddZone(QFrame):
            def __init__(self, owner, on_click):
                super().__init__(owner)
                self._theme = theme
                self._btn = QPushButton("+", self)
                self._btn.setCursor(Qt.CursorShape.PointingHandCursor)
                self._btn.setFixedSize(30, 30)
                self._btn.setStyleSheet(
                    f"QPushButton {{ background:#FFFFFF; color:{theme}; border:1px dashed {theme}; border-radius:15px; font-size:16px; font-weight:900; }}"
                    f"QPushButton:hover {{ background:{theme}16; }}"
                )
                self._btn.clicked.connect(on_click)
                self._btn.hide()
                self.setFixedHeight(34)
                self.setStyleSheet("QFrame { background:transparent; border:1px solid transparent; border-radius:8px; }")

            def resizeEvent(self, event):
                super().resizeEvent(event)
                bx = max(0, (self.width() - self._btn.width()) // 2)
                by = max(0, (self.height() - self._btn.height()) // 2)
                self._btn.move(bx, by)

            def enterEvent(self, event):
                super().enterEvent(event)
                self.setStyleSheet(
                    f"QFrame {{ background:{self._theme}08; border:1px dashed {self._theme}; border-radius:8px; }}"
                )
                self._btn.show()

            def leaveEvent(self, event):
                super().leaveEvent(event)
                self.setStyleSheet("QFrame { background:transparent; border:1px solid transparent; border-radius:8px; }")
                self._btn.hide()

        top_add = _AddZone(paper, lambda: _add_container("header"))
        top_add.hide()
        page_lay.addWidget(top_add, 0, Qt.AlignmentFlag.AlignTop)

        header_wrap = QWidget()
        header_lay = QVBoxLayout(header_wrap)
        header_lay.setContentsMargins(0, 0, 0, 0)
        header_lay.setSpacing(0)
        page_lay.addWidget(header_wrap, 0, Qt.AlignmentFlag.AlignTop)

        body_box = QPushButton("{{body}}")
        body_box.setCheckable(True)
        body_box.setFlat(True)
        def _set_body_box_selected(on: bool) -> None:
            body_selected["on"] = bool(on)
            body_box.blockSignals(True)
            body_box.setChecked(bool(on))
            body_box.blockSignals(False)
            if bool(on):
                body_box.setStyleSheet(
                    f"QPushButton {{ background:#FFFFFF; color:{theme}; border:2px dashed {theme}; border-radius:9px; padding:16px; font-size:12px; font-weight:900; text-align:center; }}"
                )
            else:
                body_box.setStyleSheet(
                    f"QPushButton {{ background:transparent; color:{theme}; border:2px dashed {theme}; border-radius:9px; padding:16px; font-size:12px; font-weight:800; text-align:center; }}"
                )
        _set_body_box_selected(False)
        page_lay.addWidget(body_box, 0, Qt.AlignmentFlag.AlignTop)

        footer_wrap = QWidget()
        footer_lay = QVBoxLayout(footer_wrap)
        footer_lay.setContentsMargins(0, 0, 0, 0)
        footer_lay.setSpacing(0)
        page_lay.addWidget(footer_wrap, 0, Qt.AlignmentFlag.AlignTop)

        page_lay.addStretch(1)
        bot_add = _AddZone(paper, lambda: _add_container("footer"))
        bot_add.hide()
        page_lay.addWidget(bot_add, 0, Qt.AlignmentFlag.AlignBottom)

        stage_lay.addWidget(paper, 0, Qt.AlignmentFlag.AlignHCenter)
        stage_scroll.setWidget(stage_host)
        root_row.addWidget(stage_scroll, 1)

        def _clear_layout(qv: QVBoxLayout) -> None:
            while qv.count():
                it = qv.takeAt(0)
                w = it.widget()
                if isinstance(w, QWidget):
                    w.deleteLater()

        def _move_container(zone: str, src_idx: int, dst_idx: int) -> None:
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if not (0 <= src_idx < len(rows) and 0 <= dst_idx < len(rows)):
                return
            if src_idx == dst_idx:
                return
            item = rows.pop(src_idx)
            rows.insert(dst_idx, item)
            model[zone] = rows
            if str(selected.get("zone") or "") == zone:
                if int(selected.get("cidx", -1)) == src_idx:
                    selected["cidx"] = dst_idx
                elif src_idx < int(selected.get("cidx", -1)) <= dst_idx:
                    selected["cidx"] = int(selected.get("cidx", -1)) - 1
                elif dst_idx <= int(selected.get("cidx", -1)) < src_idx:
                    selected["cidx"] = int(selected.get("cidx", -1)) + 1
            _render_layout()

        class _DraggableContainerRow(QFrame):
            def __init__(self, owner, zone_name: str, row_index: int):
                super().__init__(owner)
                self._zone = str(zone_name or "")
                self._row_index = int(row_index)
                self._press_pos = QPoint()
                self.setAcceptDrops(True)

            def mousePressEvent(self, event):
                if event is not None and event.button() == Qt.MouseButton.LeftButton:
                    self._press_pos = event.position().toPoint() if hasattr(event, "position") else QPoint()
                super().mousePressEvent(event)

            def mouseMoveEvent(self, event):
                if event is None or not (event.buttons() & Qt.MouseButton.LeftButton):
                    return super().mouseMoveEvent(event)
                pos = event.position().toPoint() if hasattr(event, "position") else QPoint()
                if (pos - self._press_pos).manhattanLength() < 6:
                    return super().mouseMoveEvent(event)
                drag = QDrag(self)
                mime = QMimeData()
                mime.setData("application/x-cs-layout-row", f"{self._zone}:{self._row_index}".encode("utf-8"))
                drag.setMimeData(mime)
                drag.exec(Qt.DropAction.MoveAction)
                super().mouseMoveEvent(event)

            def dragEnterEvent(self, event):
                md = event.mimeData() if event is not None else None
                if md is not None and md.hasFormat("application/x-cs-layout-row"):
                    payload = bytes(md.data("application/x-cs-layout-row")).decode("utf-8", errors="ignore")
                    if payload.startswith(f"{self._zone}:"):
                        event.acceptProposedAction()
                        return
                if event is not None:
                    event.ignore()

            def dropEvent(self, event):
                md = event.mimeData() if event is not None else None
                if md is None or not md.hasFormat("application/x-cs-layout-row"):
                    if event is not None:
                        event.ignore()
                    return
                payload = bytes(md.data("application/x-cs-layout-row")).decode("utf-8", errors="ignore")
                try:
                    z, src_txt = payload.split(":", 1)
                    src_idx = int(src_txt)
                except Exception:
                    if event is not None:
                        event.ignore()
                    return
                if z != self._zone:
                    if event is not None:
                        event.ignore()
                    return
                _move_container(self._zone, src_idx, self._row_index)
                if event is not None:
                    event.acceptProposedAction()

        def _move_column(zone: str, cidx: int, ridx: int, src_k: int, dst_k: int) -> bool:
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if cidx < 0 or cidx >= len(rows):
                return False
            container = rows[cidx] if isinstance(rows[cidx], dict) else {}
            crow_list = _container_rows(container)
            if ridx < 0 or ridx >= len(crow_list):
                return False
            crow = crow_list[ridx] if isinstance(crow_list[ridx], dict) else {}
            cols = crow.get("columns") if isinstance(crow.get("columns"), list) else []
            ws = crow.get("weights") if isinstance(crow.get("weights"), list) else [1 for _ in cols]
            if not (0 <= src_k < len(cols) and 0 <= dst_k < len(cols)):
                return False
            if src_k == dst_k:
                return True
            col_item = cols.pop(src_k)
            cols.insert(dst_k, col_item)
            w_item = ws.pop(src_k) if src_k < len(ws) else 1
            if dst_k <= len(ws):
                ws.insert(dst_k, w_item)
            else:
                ws.append(w_item)
            crow["columns"] = cols
            crow["weights"] = ws
            crow_list[ridx] = crow
            container["rows"] = crow_list
            rows[cidx] = container
            model[zone] = rows

            if (
                str(selected.get("zone") or "") == zone
                and int(selected.get("cidx", -1)) == cidx
                and int(selected.get("ridx", -1)) == ridx
            ):
                cur = int(selected.get("k", -1))
                if cur == src_k:
                    selected["k"] = dst_k
                elif src_k < cur <= dst_k:
                    selected["k"] = cur - 1
                elif dst_k <= cur < src_k:
                    selected["k"] = cur + 1
            return True

        class _DraggableColumnCell(QFrame):
            def __init__(self, owner, zone_name: str, container_idx: int, row_idx: int, col_idx: int):
                super().__init__(owner)
                self._zone = str(zone_name or "")
                self._cidx = int(container_idx)
                self._ridx = int(row_idx)
                self._k = int(col_idx)
                self._press_pos = QPoint()
                self.setAcceptDrops(True)

            def mousePressEvent(self, event):
                if event is not None and event.button() == Qt.MouseButton.LeftButton:
                    self._press_pos = event.position().toPoint() if hasattr(event, "position") else QPoint()
                super().mousePressEvent(event)

            def mouseMoveEvent(self, event):
                if event is None or not (event.buttons() & Qt.MouseButton.LeftButton):
                    return super().mouseMoveEvent(event)
                pos = event.position().toPoint() if hasattr(event, "position") else QPoint()
                if (pos - self._press_pos).manhattanLength() < 6:
                    return super().mouseMoveEvent(event)
                drag = QDrag(self)
                mime = QMimeData()
                mime.setData(
                    "application/x-cs-layout-col",
                    f"{self._zone}:{self._cidx}:{self._ridx}:{self._k}".encode("utf-8"),
                )
                drag.setMimeData(mime)
                drag.setPixmap(self.grab())
                drag.setHotSpot(pos)
                drag.exec(Qt.DropAction.MoveAction)
                super().mouseMoveEvent(event)

            def dragEnterEvent(self, event):
                md = event.mimeData() if event is not None else None
                if md is None or not md.hasFormat("application/x-cs-layout-col"):
                    if event is not None:
                        event.ignore()
                    return
                payload = bytes(md.data("application/x-cs-layout-col")).decode("utf-8", errors="ignore")
                try:
                    z, c_txt, r_txt, _ = payload.split(":", 3)
                except Exception:
                    if event is not None:
                        event.ignore()
                    return
                if z == self._zone and int(c_txt) == self._cidx and int(r_txt) == self._ridx:
                    event.acceptProposedAction()
                    return
                if event is not None:
                    event.ignore()

            def dropEvent(self, event):
                md = event.mimeData() if event is not None else None
                if md is None or not md.hasFormat("application/x-cs-layout-col"):
                    if event is not None:
                        event.ignore()
                    return
                payload = bytes(md.data("application/x-cs-layout-col")).decode("utf-8", errors="ignore")
                try:
                    z, c_txt, r_txt, k_txt = payload.split(":", 3)
                    src_c = int(c_txt)
                    src_r = int(r_txt)
                    src_k = int(k_txt)
                except Exception:
                    if event is not None:
                        event.ignore()
                    return
                if z != self._zone or src_c != self._cidx or src_r != self._ridx:
                    if event is not None:
                        event.ignore()
                    return
                if _move_column(self._zone, self._cidx, self._ridx, src_k, self._k):
                    _render_layout()
                    if event is not None:
                        event.acceptProposedAction()
                    return
                if event is not None:
                    event.ignore()

        def _render_zone(zone: str, qv: QVBoxLayout) -> None:
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if not rows:
                starter = QFrame()
                starter.setStyleSheet("QFrame { background:#F8FAFC; border:1px dashed #C7CDD8; border-radius:0; }")
                st_l = QVBoxLayout(starter)
                st_l.setContentsMargins(14, 14, 14, 14)
                st_l.setSpacing(8)
                txt = QLabel("To get started, add a Container, then choose Columns, then add Elements.")
                txt.setAlignment(Qt.AlignmentFlag.AlignCenter)
                txt.setWordWrap(True)
                txt.setStyleSheet("QLabel { color:#1F2937; font-size:12px; font-weight:700; }")
                st_l.addWidget(txt)
                btn_row = QHBoxLayout()
                btn_row.addStretch(1)
                add_btn = QPushButton("+ Container")
                add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_btn.setStyleSheet(
                    f"QPushButton {{ background:{theme}; color:#FFFFFF; border:1px solid {theme}; border-radius:0; padding:7px 14px; font-size:12px; font-weight:800; }}"
                    f"QPushButton:hover {{ background:{theme}CC; }}"
                )
                add_btn.clicked.connect(lambda _=False, zz=zone: _add_container(zz))
                btn_row.addWidget(add_btn)
                prebuilt_btn = QPushButton("Prebuilt")
                prebuilt_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                prebuilt_btn.setStyleSheet(
                    "QPushButton { background:#7DBB80; color:#FFFFFF; border:1px solid #63A86A; border-radius:0; padding:7px 14px; font-size:12px; font-weight:800; }"
                    "QPushButton:hover { background:#6AAF72; }"
                )
                prebuilt_btn.clicked.connect(lambda _=False, zz=zone: _add_container(zz))
                btn_row.addWidget(prebuilt_btn)
                btn_row.addStretch(1)
                st_l.addLayout(btn_row)
                qv.addWidget(starter)
                return
            for cidx, container in enumerate(rows):
                if not isinstance(container, dict):
                    container = {}
                    rows[cidx] = container
                if not str(container.get("name") or "").strip():
                    container["name"] = f"Container {cidx + 1}"
                if not str(container.get("bgColor") or "").strip():
                    container["bgColor"] = "#FFFFFF"
                is_collapsed = bool(container.get("collapsed", False))
                container["collapsed"] = is_collapsed
                try:
                    h_adj = int(container.get("heightPx") or 0)
                except Exception:
                    h_adj = 0
                cont_frame = _DraggableContainerRow(qv.parentWidget() or dlg, zone, cidx)
                bg_col = _container_bg(container)
                cont_frame.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #D9DEE7; border-radius:0; }")
                cont_frame.setMinimumHeight(max(0, 0 + h_adj) if h_adj > 0 else 0)
                cont_l = QVBoxLayout(cont_frame)
                cont_l.setContentsMargins(0, 0, 0, 0)
                cont_l.setSpacing(0)
                top_row = QHBoxLayout()
                top_row.setContentsMargins(0, 0, 0, 0)
                top_row.setSpacing(0)
                top_bar = QFrame()
                top_bar.setStyleSheet(f"QFrame {{ background:{theme}; border:none; border-radius:0; }}")
                top_bar_l = QHBoxLayout(top_bar)
                top_bar_l.setContentsMargins(8, 6, 8, 6)
                top_bar_l.setSpacing(8)
                handle = QLabel("::")
                handle.setAlignment(Qt.AlignmentFlag.AlignCenter)
                handle.setFixedWidth(16)
                handle.setStyleSheet("QLabel { color:#DBEAFE; font-size:11px; font-weight:700; }")
                top_bar_l.addWidget(handle, 0)
                title = QLineEdit(_container_name(container, cidx))
                title.setPlaceholderText(f"Container {cidx + 1}")
                title.setFixedHeight(24)
                title.setStyleSheet(
                    "QLineEdit { background:transparent; border:none; color:#FFFFFF; font-size:12px; font-weight:800; padding:0 2px; }"
                    "QLineEdit:focus { border:1px solid #DBEAFE; border-radius:2px; }"
                )
                def _save_title(zz=zone, cc=cidx, w=title):
                    all_rows = model.get(zz) if isinstance(model.get(zz), list) else []
                    if cc < 0 or cc >= len(all_rows) or not isinstance(all_rows[cc], dict):
                        return
                    v = str(w.text() or "").strip() or f"Container {cc + 1}"
                    all_rows[cc]["name"] = v
                    model[zz] = all_rows
                    w.setText(v)
                    _refresh_preview()
                title.editingFinished.connect(_save_title)
                top_bar_l.addWidget(title, 0)
                collapse_btn = QToolButton()
                try:
                    collapse_btn.setIcon(
                        self.style().standardIcon(
                            QStyle.StandardPixmap.SP_ArrowRight if is_collapsed else QStyle.StandardPixmap.SP_ArrowDown
                        )
                    )
                except Exception:
                    collapse_btn.setText(">" if is_collapsed else "v")
                collapse_btn.setToolTip("Expand container" if is_collapsed else "Collapse container")
                collapse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                collapse_btn.setFixedSize(18, 18)
                collapse_btn.setStyleSheet(
                    "QToolButton { background:#FFFFFF; border:1px solid #CBD5E1; border-radius:0; padding:0; }"
                    "QToolButton:hover { background:#F8FAFC; border:1px solid #94A3B8; }"
                )
                def _toggle_collapsed(zz=zone, cc=cidx):
                    all_rows = model.get(zz) if isinstance(model.get(zz), list) else []
                    if cc < 0 or cc >= len(all_rows) or not isinstance(all_rows[cc], dict):
                        return
                    all_rows[cc]["collapsed"] = not bool(all_rows[cc].get("collapsed", False))
                    model[zz] = all_rows
                    _render_layout()
                collapse_btn.clicked.connect(_toggle_collapsed)
                top_bar_l.addWidget(collapse_btn, 0)
                top_bar_l.addStretch(1)
                color_btn = QPushButton("Color")
                color_btn.setToolTip("Container Background")
                color_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                color_btn.setFixedSize(52, 22)
                color_btn.setStyleSheet(
                    f"QPushButton {{ background:{bg_col}; color:#1F2937; border:1px solid #CBD5E1; border-radius:2px; font-size:10px; font-weight:700; }}"
                    "QPushButton:hover { border:1px solid #94A3B8; }"
                )
                def _pick_container_bg(zz=zone, cc=cidx):
                    all_rows = model.get(zz) if isinstance(model.get(zz), list) else []
                    if cc < 0 or cc >= len(all_rows) or not isinstance(all_rows[cc], dict):
                        return
                    start = _container_bg(all_rows[cc])
                    picker = QColorDialog(dlg)
                    picker.setWindowTitle("Choose Container Background")
                    picker.setCurrentColor(QColor(start))
                    try:
                        picker.setOption(QColorDialog.ColorDialogOption.DontUseNativeDialog, True)
                    except Exception:
                        pass
                    if picker.exec() != QDialog.DialogCode.Accepted:
                        return
                    picked = picker.selectedColor()
                    if not picked.isValid():
                        return
                    all_rows[cc]["bgColor"] = picked.name()
                    model[zz] = all_rows
                    _render_layout()
                color_btn.pressed.connect(lambda zz=zone, cc=cidx: QTimer.singleShot(0, lambda: _pick_container_bg(zz, cc)))
                top_bar_l.addWidget(color_btn, 0)
                height_slider = QSlider(Qt.Orientation.Horizontal)
                height_slider.setRange(-300, 800)
                height_slider.setFixedWidth(90)
                height_slider.setValue(int(h_adj))
                height_slider.setStyleSheet(
                    "QSlider::groove:horizontal { border:1px solid #D9E0EA; height:5px; background:#EEF2F7; border-radius:3px; }"
                    f"QSlider::sub-page:horizontal {{ background:{theme}66; border-radius:3px; }}"
                    f"QSlider::handle:horizontal {{ background:{theme}; border:1px solid #1F4FBF; width:9px; margin:-4px 0; border-radius:5px; }}"
                )
                height_spin = QSpinBox()
                height_spin.setRange(-300, 800)
                height_spin.setValue(int(h_adj))
                height_spin.setFixedWidth(58)
                height_spin.setFixedHeight(22)
                height_spin.setStyleSheet("QSpinBox { background:#FFFFFF; border:1px solid #CBD5E1; border-radius:0; font-size:10px; font-weight:700; }")
                height_slider.valueChanged.connect(lambda v, zz=zone, cc=cidx, hs=height_slider, hp=height_spin: _set_container_height(zz, cc, v, hs, hp))
                height_spin.valueChanged.connect(lambda v, zz=zone, cc=cidx, hs=height_slider, hp=height_spin: _set_container_height(zz, cc, v, hs, hp))
                top_bar_l.addWidget(height_slider, 0)
                top_bar_l.addWidget(height_spin, 0)
                add_row_btn = QPushButton("+ Row")
                add_row_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_row_btn.setStyleSheet(
                    "QPushButton { background:#FFFFFF; color:#1F2937; border:1px solid #CBD5E1; border-radius:0; padding:2px 8px; font-size:10px; font-weight:800; }"
                    "QPushButton:hover { background:#F8FAFC; }"
                )
                add_row_btn.clicked.connect(lambda _=False, zz=zone, cc=cidx: _add_row_to_container(zz, cc))
                top_bar_l.addWidget(add_row_btn, 0)
                del_btn = QPushButton("Delete")
                del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                del_btn.setStyleSheet(
                    "QPushButton { background:#FFF1F2; color:#B42318; border:1px solid #FECACA; border-radius:0; padding:2px 8px; font-size:10px; font-weight:800; }"
                    "QPushButton:hover { background:#FFE4E6; }"
                )
                del_btn.clicked.connect(lambda _=False, zz=zone, cc=cidx: _delete_container(zz, cc))
                top_bar_l.addWidget(del_btn, 0)
                top_row.addWidget(top_bar, 1)
                cont_l.addLayout(top_row)

                crow_list = _container_rows(container)
                render_rows = [] if is_collapsed else crow_list
                for ridx, crow in enumerate(render_rows):
                    cols = crow.get("columns") if isinstance(crow, dict) else []
                    cols = cols if isinstance(cols, list) else []
                    weights = crow.get("weights") if isinstance(crow.get("weights"), list) else [1 for _ in cols]
                    weights = [max(1, int(v)) for v in weights][:max(1, len(cols))]
                    if len(weights) < len(cols):
                        weights += [1 for _ in range(len(cols) - len(weights))]
                    row_frame = QFrame()
                    row_frame.setStyleSheet("QFrame { background:transparent; border:none; }")
                    row_l = QHBoxLayout(row_frame)
                    row_l.setContentsMargins(8, 8, 8, 8)
                    row_l.setSpacing(8)
                    for k, col in enumerate(cols):
                        if not isinstance(col, dict):
                            col = {"type": "text", "content": ""}
                            cols[k] = col
                        ctype = str(col.get("type") or "text").strip().lower()
                        cell = _DraggableColumnCell(row_frame, zone, cidx, ridx, k)
                        cell.setCursor(Qt.CursorShape.PointingHandCursor)
                        is_sel = (
                            selected.get("zone") == zone
                            and int(selected.get("cidx", -1)) == cidx
                            and int(selected.get("ridx", -1)) == ridx
                            and int(selected.get("k", -1)) == k
                        )
                        bcol = theme if is_sel else "#D1D5DB"
                        left = "none" if k > 0 else f"1px solid {bcol}"
                        cell.setStyleSheet(
                            f"QFrame {{ background:transparent; border-top:1px solid {bcol}; border-right:1px solid {bcol}; border-bottom:1px solid {bcol}; border-left:{left}; border-radius:0; }}"
                        )
                        cl = QVBoxLayout(cell)
                        cl.setContentsMargins(6, 4, 6, 6)
                        cl.setSpacing(4)
                        total_w = max(1, sum(weights))
                        ratio = QLabel(f"{weights[k]}/{total_w}" if k < len(weights) else "1/1")
                        ratio.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
                        ratio.setStyleSheet("QLabel { color:#64748B; font-size:10px; font-weight:700; }")
                        hdr = QHBoxLayout()
                        hdr.setContentsMargins(0, 0, 0, 0)
                        hdr.setSpacing(4)
                        hdr.addWidget(ratio, 0, Qt.AlignmentFlag.AlignLeft)
                        hdr.addStretch(1)
                        del_col_btn = QPushButton("x")
                        del_col_btn.setFixedSize(16, 16)
                        del_col_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                        del_col_btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
                        del_col_btn.setStyleSheet(
                            "QPushButton { background:#FFF1F2; color:#B42318; border:1px solid #FECACA; border-radius:8px; font-size:10px; font-weight:800; padding:0; }"
                            "QPushButton:hover { background:#FFE4E6; }"
                        )
                        del_col_btn.setProperty("cs_zone", zone)
                        del_col_btn.setProperty("cs_cidx", int(cidx))
                        del_col_btn.setProperty("cs_ridx", int(ridx))
                        del_col_btn.setProperty("cs_k", int(k))
                        del_col_btn.pressed.connect(lambda b=del_col_btn: _delete_column_from_button(b))
                        del_col_btn.clicked.connect(lambda _=False, b=del_col_btn: _delete_column_from_button(b))
                        hdr.addWidget(del_col_btn, 0, Qt.AlignmentFlag.AlignRight)
                        cl.addLayout(hdr)
                        txt = QLabel()
                        txt.setWordWrap(True)
                        txt.setTextFormat(Qt.TextFormat.RichText)
                        txt.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
                        txt.setStyleSheet("QLabel { color:#334155; background:transparent; border:1px dashed #CBD5E1; margin:0; padding:12px 6px; }")
                        if ctype == "logo":
                            txt.setText("<span style='color:#64748B;font-weight:700;'>{{company_logo}}</span>")
                        elif ctype == "empty":
                            txt.setText("<span style='color:#94A3B8;font-weight:700;'>+ Element</span>")
                        else:
                            raw = str(col.get("content") or "")
                            txt.setText(raw if raw.strip() else "<span style='color:#94A3B8;font-weight:700;'>+ Element</span>")
                        cl.addWidget(txt)
                        row_l.addWidget(cell, max(1, int(weights[k]) if k < len(weights) else 1))

                        class _SelFilter(QObject):
                            def __init__(self, owner, cb):
                                super().__init__(owner)
                                self._cb = cb
                            def eventFilter(self, obj, event):
                                if event is not None and event.type() == QEvent.Type.MouseButtonRelease:
                                    try:
                                        pos = event.position().toPoint() if hasattr(event, "position") else QPoint()
                                        child = obj.childAt(pos) if hasattr(obj, "childAt") else None
                                        while child is not None:
                                            if isinstance(child, QPushButton):
                                                return False
                                            child = child.parentWidget() if hasattr(child, "parentWidget") else None
                                        gp = event.globalPosition().toPoint() if hasattr(event, "globalPosition") else None
                                        if gp is not None:
                                            gw = QApplication.widgetAt(gp)
                                            while gw is not None:
                                                if isinstance(gw, QPushButton):
                                                    return False
                                                gw = gw.parentWidget() if hasattr(gw, "parentWidget") else None
                                    except Exception:
                                        pass
                                    self._cb()
                                    return False
                                return False
                        flt = _SelFilter(dlg, lambda zz=zone, cc=cidx, rr=ridx, kk=k: (_set_selected(zz, cc, rr, kk)))
                        cell.installEventFilter(flt)
                        txt.installEventFilter(flt)
                    crow["weights"] = weights
                    crow["columns"] = cols
                    render_rows[ridx] = crow
                    cont_l.addWidget(row_frame)
                if isinstance(container, dict):
                    container["rows"] = crow_list
                    rows[cidx] = container
                    model[zone] = rows
                qv.addWidget(cont_frame)
            add_more = QFrame()
            add_more.setStyleSheet("QFrame { background:transparent; border:none; }")
            add_more_l = QHBoxLayout(add_more)
            add_more_l.setContentsMargins(0, 8, 0, 0)
            add_more_l.setSpacing(0)
            add_more_l.addStretch(1)
            add_more_btn = QPushButton("+ Container")
            add_more_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            add_more_btn.setStyleSheet(
                f"QPushButton {{ background:{theme}; color:#FFFFFF; border:1px solid {theme}; border-radius:0; padding:6px 12px; font-size:11px; font-weight:800; }}"
                f"QPushButton:hover {{ background:{theme}CC; }}"
            )
            add_more_btn.clicked.connect(lambda _=False, zz=zone: _add_container(zz))
            add_more_l.addWidget(add_more_btn)
            add_more_l.addStretch(1)
            qv.addWidget(add_more)

        def _schedule_render() -> None:
            if bool(render_state.get("active")):
                render_state["pending"] = True
                return
            QTimer.singleShot(0, _render_layout)

        def _render_layout() -> None:
            if bool(render_state.get("active")):
                render_state["pending"] = True
                return
            render_state["active"] = True
            try:
                _clear_layout(header_lay)
                _clear_layout(footer_lay)
                _render_zone("header", header_lay)
                _render_zone("footer", footer_lay)
                _refresh_preview()
            finally:
                render_state["active"] = False
            if bool(render_state.get("pending")):
                render_state["pending"] = False
                QTimer.singleShot(0, _render_layout)

        def _set_selected(zone: str, cidx: int, ridx: int, k: int) -> None:
            _set_body_box_selected(False)
            selected["zone"] = zone
            selected["cidx"] = int(cidx)
            selected["ridx"] = int(ridx)
            selected["k"] = int(k)
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if cidx < 0 or cidx >= len(rows):
                return
            container = rows[cidx]
            crow_list = _container_rows(container)
            if ridx < 0 or ridx >= len(crow_list):
                return
            crow = crow_list[ridx]
            cols = crow.get("columns") if isinstance(crow, dict) else []
            cols = cols if isinstance(cols, list) else []
            if k < 0 or k >= len(cols):
                return
            col = cols[k] if isinstance(cols[k], dict) else {"type": "text", "content": ""}
            sel_label.setText(f"{zone.title()} Container {cidx + 1} - Row {ridx + 1} - Column {k + 1}")
            map_ui = {"text": "Text", "logo": "Company Logo", "empty": "Empty"}
            select_sync["active"] = True
            try:
                type_combo.setCurrentText(map_ui.get(str(col.get("type") or "text").lower(), "Text"))
                content_edit.blockSignals(True)
                try:
                    content_edit.setHtml(str(col.get("content") or ""))
                finally:
                    content_edit.blockSignals(False)
                content_edit.setVisible(type_combo.currentText() == "Text")
            finally:
                select_sync["active"] = False
            _schedule_render()

        def _apply_current_column() -> None:
            if bool(select_sync.get("active")):
                return
            if bool(body_selected.get("on")):
                try:
                    # Keep body typing path lightweight/stable; style is controlled by toolbar actions.
                    body_default_html_pref["value"] = str(content_edit.toHtml() or "").strip()
                    _refresh_preview()
                except Exception:
                    # Keep editor responsive even if one style probe fails.
                    pass
                return
            zone = str(selected.get("zone") or "")
            cidx = int(selected.get("cidx", -1))
            ridx = int(selected.get("ridx", -1))
            k = int(selected.get("k", -1))
            rows = model.get(zone) if isinstance(model.get(zone), list) else []
            if cidx < 0 or cidx >= len(rows):
                return
            container = rows[cidx]
            crow_list = _container_rows(container)
            if ridx < 0 or ridx >= len(crow_list):
                return
            crow = crow_list[ridx]
            cols = crow.get("columns") if isinstance(crow, dict) else []
            cols = cols if isinstance(cols, list) else []
            if k < 0 or k >= len(cols):
                return
            col = cols[k] if isinstance(cols[k], dict) else {}
            typ = str(type_combo.currentText() or "Text").strip().lower()
            map_back = {"text": "text", "company logo": "logo", "empty": "empty"}
            col["type"] = map_back.get(typ, "text")
            if col["type"] == "text":
                col["content"] = str(content_edit.toHtml() or "")
            else:
                col["content"] = ""
            cols[k] = col
            crow["columns"] = cols
            crow_list[ridx] = crow
            container["rows"] = crow_list
            rows[cidx] = container
            model[zone] = rows
            _render_layout()

        def _merge_fmt(setter):
            cur = content_edit.textCursor()
            fmt = QTextCharFormat()
            setter(fmt)
            cur.mergeCharFormat(fmt)
            content_edit.mergeCurrentCharFormat(fmt)
            _apply_current_column()

        def _toggle_bold() -> None:
            cur = content_edit.currentCharFormat()
            try:
                cur_w = int(cur.fontWeight())
            except Exception:
                cur_w = int(getattr(cur.fontWeight(), "value", 400))
            try:
                bold_w = int(QFont.Weight.Bold)
            except Exception:
                bold_w = int(getattr(QFont.Weight.Bold, "value", 700))
            is_bold = cur_w >= bold_w
            _merge_fmt(lambda f: f.setFontWeight(QFont.Weight.Normal if is_bold else QFont.Weight.Bold))

        def _toggle_italic() -> None:
            cur = content_edit.currentCharFormat()
            _merge_fmt(lambda f: f.setFontItalic(not bool(cur.fontItalic())))

        def _toggle_underline() -> None:
            cur = content_edit.currentCharFormat()
            _merge_fmt(lambda f: f.setFontUnderline(not bool(cur.fontUnderline())))

        def _apply_alignment(al: Qt.AlignmentFlag) -> None:
            content_edit.setAlignment(al)
            _apply_current_column()

        def _pick_text_color() -> None:
            picked = QColorDialog.getColor(QColor("#111827"), dlg, "Choose Text Color")
            if not picked.isValid():
                return
            _merge_fmt(lambda f: f.setForeground(picked))

        def _apply_text_size(pt: int) -> None:
            if bool(select_sync.get("active")):
                return
            try:
                val = max(6, min(96, int(pt)))
            except Exception:
                return
            if bool(body_selected.get("on")):
                body_font_size_pref["value"] = max(6, min(72, int(val)))
                _refresh_preview()
                return
            _merge_fmt(lambda f, _v=val: f.setFontPointSize(float(_v)))

        def _apply_font_family(qf: QFont) -> None:
            if bool(select_sync.get("active")):
                return
            fam = str(qf.family() or "").strip()
            if not fam:
                return
            if bool(body_selected.get("on")):
                body_font_family_pref["value"] = fam
                _refresh_preview()
                return
            _merge_fmt(lambda f, _fam=fam: f.setFontFamily(_fam))

        def _select_body_target() -> None:
            _set_body_box_selected(True)
            selected["zone"] = ""
            selected["cidx"] = -1
            selected["ridx"] = -1
            selected["k"] = -1
            sel_label.setText("Body text defaults")
            select_sync["active"] = True
            try:
                type_combo.setCurrentText("Text")
                content_edit.setVisible(True)
                content_edit.blockSignals(True)
                try:
                    seed_html = str(body_default_html_pref.get("value") or "").strip()
                    if not seed_html:
                        seed_html = "<p>{{body}}</p>"
                    content_edit.setHtml(seed_html)
                finally:
                    content_edit.blockSignals(False)
                font_family_combo.setCurrentFont(QFont(str(body_font_family_pref.get("value") or "Segoe UI")))
                text_size_spin.setValue(int(body_font_size_pref.get("value") or 11))
            finally:
                select_sync["active"] = False

        body_box.clicked.connect(lambda _=False: _select_body_target())

        type_combo.currentIndexChanged.connect(lambda _=0: (content_edit.setVisible(type_combo.currentText() == "Text"), _apply_current_column()))
        content_edit.textChanged.connect(_apply_current_column)
        bold_btn.clicked.connect(_toggle_bold)
        italic_btn.clicked.connect(_toggle_italic)
        under_btn.clicked.connect(_toggle_underline)
        align_left_btn.clicked.connect(lambda: _apply_alignment(Qt.AlignmentFlag.AlignLeft))
        align_center_btn.clicked.connect(lambda: _apply_alignment(Qt.AlignmentFlag.AlignHCenter))
        align_right_btn.clicked.connect(lambda: _apply_alignment(Qt.AlignmentFlag.AlignRight))
        text_color_btn.clicked.connect(_pick_text_color)
        font_family_combo.currentFontChanged.connect(_apply_font_family)
        text_size_spin.valueChanged.connect(_apply_text_size)
        row = QHBoxLayout()
        show_preview_btn = QPushButton("Show Preview")
        show_preview_btn.clicked.connect(lambda: _open_preview())
        row.addWidget(show_preview_btn)
        row.addStretch(1)
        cancel_btn = QPushButton("Cancel")
        cancel_btn.clicked.connect(dlg.reject)
        save_btn = QPushButton("Save Preset")
        save_btn.setStyleSheet(
            "QPushButton { background:#DDF2E7; color:#1F6A3B; border:1px solid #BFE8CF; border-radius:9px; padding:7px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#BEE6D0; }"
        )
        row.addWidget(cancel_btn)
        row.addWidget(save_btn)
        lay.addLayout(row)

        def _render_model_to_html() -> str:
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
                    crow_list = _container_rows(container if isinstance(container, dict) else {})
                    for crow in crow_list:
                        cols = crow.get("columns") if isinstance(crow, dict) else []
                        cols = cols if isinstance(cols, list) else []
                        if not cols:
                            continue
                        weights = crow.get("weights") if isinstance(crow.get("weights"), list) else [1 for _ in cols]
                        weights = [max(1, int(v)) for v in weights][:max(1, len(cols))]
                        if len(weights) < len(cols):
                            weights += [1 for _ in range(len(cols) - len(weights))]
                        total_w = float(max(1, sum(weights)))
                        cells: list[str] = []
                        for idx, col in enumerate(cols):
                            if not isinstance(col, dict):
                                col = {"type": "text", "content": ""}
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
                            width = (float(weights[idx]) / total_w) * 100.0 if idx < len(weights) else (100.0 / float(max(1, len(cols))))
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
                        extra = ""
                        if h_adj > 0:
                            extra += f" min-height:{h_adj}px;"
                        elif h_adj < 0:
                            extra += f" margin-bottom:{h_adj}px;"
                        out.append(
                            f"<div style='background:{bg_col}; padding:6px; margin:0 0 6px 0;{extra}'>"
                            + "".join(section_rows)
                            + "</div>"
                        )
                return "".join(out)
            header_html = _zone_html(model.get("header") if isinstance(model.get("header"), list) else [])
            footer_html = _zone_html(model.get("footer") if isinstance(model.get("footer"), list) else [])
            body_slot = (
                f"<div style='border:2px dashed {theme}; border-radius:9px; padding:16px; text-align:center; "
                f"color:{theme}; font-weight:800; margin-top:8px; margin-bottom:8px;'>{{{{body}}}}</div>"
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

        preview_state: dict[str, object | None] = {"dlg": None, "web": None, "text": None}

        def _preview_html() -> str:
            layout_html = _render_model_to_html().strip() or "<div>{{body}}</div>"
            # Preview should show raw placeholders ({{project_name}}, etc) exactly as authored.
            # Keep {{body}} visibly blank/in-place inside the sheet preview.
            body_family_css = html.escape(str(body_font_family_pref.get("value") or "Segoe UI"))
            body_size_css = int(body_font_size_pref.get("value") or 11)
            body_color_css = self._normalize_hex(str(body_color_pref.get("value") or "#111827"), "#111827")
            body_weight_css = "700" if bool(body_bold_pref.get("value")) else "400"
            body_style_css = "italic" if bool(body_italic_pref.get("value")) else "normal"
            body_dec_css = "underline" if bool(body_underline_pref.get("value")) else "none"
            body_align_css = str(body_align_pref.get("value") or "left")
            return (
                "<!doctype html><html><head><meta charset='utf-8'>"
                "<style>"
                "@page { size: A4; margin: 10mm; }"
                "html,body{margin:0;padding:0;background:#E5E7EB;}"
                ".quote-page{margin:0; padding:0;}"
                ".quote-sheet{width:210mm; min-height:297mm; margin:0 auto; background:#FFF; border:1px solid #D1D5DB; "
                f"border-radius:10px; box-sizing:border-box; padding:10mm; overflow:hidden; font-family:'{body_family_css}','Segoe UI',Arial,sans-serif; font-size:{body_size_css}pt; line-height:1.25;"
                "}"
                ".quote-sheet p{margin:0 0 6px 0;}"
                f".body-gap{{font-family:'{body_family_css}','Segoe UI',Arial,sans-serif; font-size:{body_size_css}pt; color:{body_color_css}; font-weight:{body_weight_css}; font-style:{body_style_css}; text-decoration:{body_dec_css}; text-align:{body_align_css};}}"
                "</style></head><body><div class='quote-page'><div class='quote-sheet'>"
                + layout_html.replace("__CS_PAGE_HEIGHT_MM__", "277").replace("{{body}}", (str(body_default_html_pref.get("value") or "").strip() or "<p class='body-gap'>{{body}}</p>"))
                + "</div></div></body></html>"
            )

        def _refresh_preview() -> None:
            pd = preview_state.get("dlg")
            if not isinstance(pd, QDialog) or not pd.isVisible():
                return
            html_out = _preview_html()
            web = preview_state.get("web")
            txt = preview_state.get("text")
            if web is not None:
                try:
                    web.setHtml(html_out, QUrl())
                except Exception:
                    pass
            elif isinstance(txt, QTextEdit):
                txt.setHtml(html_out)

        def _open_preview() -> None:
            pd = preview_state.get("dlg")
            if isinstance(pd, QDialog) and pd.isVisible():
                pd.raise_()
                pd.activateWindow()
                _refresh_preview()
                return
            pd = QDialog(self)
            pd.setWindowTitle("Quote Preset Preview")
            pd.resize(980, 760)
            pd.setModal(False)
            pl = QVBoxLayout(pd)
            pl.setContentsMargins(8, 8, 8, 8)
            pl.setSpacing(6)
            try:
                from PySide6.QtWebEngineWidgets import QWebEngineView  # type: ignore
                web = QWebEngineView()
                web.setStyleSheet("QWidget { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:10px; }")
                pl.addWidget(web, 1)
                preview_state["web"] = web
                preview_state["text"] = None
            except Exception:
                fallback = QTextEdit()
                fallback.setReadOnly(True)
                fallback.setStyleSheet("QTextEdit { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:10px; }")
                pl.addWidget(fallback, 1)
                preview_state["web"] = None
                preview_state["text"] = fallback
            def _on_close(*_):
                preview_state["dlg"] = None
                preview_state["web"] = None
                preview_state["text"] = None
            pd.finished.connect(_on_close)
            preview_state["dlg"] = pd
            pd.show()
            _refresh_preview()

        _render_layout()

        def _save() -> None:
            html_out = _render_model_to_html().strip()
            if not html_out:
                QMessageBox.warning(dlg, "Quote Preset", "Preset cannot be empty.")
                return
            try:
                next_ver = int((self._company or {}).get("quoteBaseLayoutVersion") or 1) + 1
            except Exception:
                next_ver = 1
            next_ver = max(1, next_ver)
            try:
                self.app.company.update_company(
                    company_id,
                    {
                        "quoteBaseLayoutHtml": html_out,
                        "quoteBaseLayoutModelJson": json.dumps(model),
                        "quoteBaseLayoutVersion": next_ver,
                        "quoteTemplateBodyFontFamily": str(body_font_family_pref.get("value") or "Segoe UI"),
                        "quoteTemplateBodyFontSizePt": int(body_font_size_pref.get("value") or 11),
                        "quoteTemplateBodyTextColor": self._normalize_hex(str(body_color_pref.get("value") or "#111827"), "#111827"),
                        "quoteTemplateBodyBold": bool(body_bold_pref.get("value")),
                        "quoteTemplateBodyItalic": bool(body_italic_pref.get("value")),
                        "quoteTemplateBodyUnderline": bool(body_underline_pref.get("value")),
                        "quoteTemplateBodyAlign": str(body_align_pref.get("value") or "left"),
                        "quoteTemplateBodyDefaultHtml": str(body_default_html_pref.get("value") or "").strip(),
                    },
                )
                self._company["quoteBaseLayoutHtml"] = html_out
                self._company["quoteBaseLayoutModelJson"] = json.dumps(model)
                self._company["quoteBaseLayoutVersion"] = next_ver
                self._company["quoteTemplateBodyFontFamily"] = str(body_font_family_pref.get("value") or "Segoe UI")
                self._company["quoteTemplateBodyFontSizePt"] = int(body_font_size_pref.get("value") or 11)
                self._company["quoteTemplateBodyTextColor"] = self._normalize_hex(str(body_color_pref.get("value") or "#111827"), "#111827")
                self._company["quoteTemplateBodyBold"] = bool(body_bold_pref.get("value"))
                self._company["quoteTemplateBodyItalic"] = bool(body_italic_pref.get("value"))
                self._company["quoteTemplateBodyUnderline"] = bool(body_underline_pref.get("value"))
                self._company["quoteTemplateBodyAlign"] = str(body_align_pref.get("value") or "left")
                self._company["quoteTemplateBodyDefaultHtml"] = str(body_default_html_pref.get("value") or "").strip()
                self._load_company_quote_template()
                QMessageBox.information(dlg, "Quote Preset", "Quote preset saved.")
                dlg.accept()
            except Exception as exc:
                QMessageBox.warning(dlg, "Quote Preset", f"Could not save preset:\n{exc}")

        save_btn.clicked.connect(_save)
        dlg.show()

    def _reset_quote_base_layout_default(self) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return
        html_out = self._default_quote_base_layout_html()
        try:
            next_ver = int((self._company or {}).get("quoteBaseLayoutVersion") or 1) + 1
        except Exception:
            next_ver = 1
        next_ver = max(1, next_ver)
        try:
            self.app.company.update_company(
                company_id,
                {
                    "quoteBaseLayoutHtml": html_out,
                    "quoteBaseLayoutVersion": next_ver,
                },
            )
            self._company["quoteBaseLayoutHtml"] = html_out
            self._company["quoteBaseLayoutVersion"] = next_ver
            self._load_company_quote_template()
            QMessageBox.information(self, "Quote Preset", "Quote preset reset to default.")
        except Exception as exc:
            QMessageBox.warning(self, "Quote Preset", f"Could not reset preset:\n{exc}")

    def _open_quote_template_builder(self) -> None:
        if not hasattr(self, "_open_quote_template_builders"):
            self._open_quote_template_builders = []
        dlg = QDialog(self)
        dlg.setWindowTitle("Quote Template Builder")
        dlg.resize(1320, 920)
        dlg.setModal(False)
        dlg.setWindowModality(Qt.WindowModality.NonModal)
        dlg.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        theme = self._normalize_hex(str((self._company or {}).get("themeColor") or "#2F6BFF"), "#2F6BFF")
        dlg.setStyleSheet(
            "QDialog { background:#F3F4F6; }"
            "QLineEdit, QComboBox, QSpinBox, QFontComboBox { background:#F7F8FA; border:1px solid #E5E7EC; border-radius:8px; padding:0 8px; }"
            "QTextEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:10px; }"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(10)

        info = QLabel("Header starts blank. Add Container, then choose 1-6 Columns, then set each column widget (Textbox/Logo/Empty).")
        info.setWordWrap(True)
        info.setStyleSheet("QLabel { color:#556274; background:#FFFFFF; border:1px solid #E4E6EC; border-radius:12px; padding:8px 10px; font-size:12px; font-weight:600; }")
        root.addWidget(info)

        current_editor: dict[str, QTextEdit | None] = {"w": None}
        _editor_filters: list[QObject] = []
        _click_filters: list[QObject] = []
        header_title_inputs: dict[str, QLineEdit] = {}
        footer_title_inputs: dict[str, QLineEdit] = {}

        fmt_row = QHBoxLayout()
        fmt_row.setSpacing(6)
        fmt_lbl = QLabel("Text Format")
        fmt_lbl.setStyleSheet("QLabel { color:#20304A; font-size:12px; font-weight:800; }")
        fmt_row.addWidget(fmt_lbl)

        font_family = QFontComboBox()
        font_family.setFixedHeight(26)
        font_family.setMinimumWidth(150)
        font_family.setStyleSheet("QFontComboBox { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:0 8px; }")
        fmt_row.addWidget(font_family)

        font_size = QSpinBox()
        font_size.setRange(6, 120)
        font_size.setValue(11)
        font_size.setFixedHeight(26)
        font_size.setFixedWidth(62)
        font_size.setStyleSheet("QSpinBox { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:0 6px; }")
        fmt_row.addWidget(font_size)

        bold_btn = QToolButton()
        bold_btn.setText("B")
        bold_btn.setCheckable(True)
        bold_btn.setFixedSize(28, 26)
        bold_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:8px; font-weight:900; } QToolButton:checked { background:#DCE7FF; border-color:#BFD3FF; color:#1F4FBF; }")
        fmt_row.addWidget(bold_btn)

        italic_btn = QToolButton()
        italic_btn.setText("I")
        italic_btn.setCheckable(True)
        italic_btn.setFixedSize(28, 26)
        italic_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:8px; font-style:italic; font-weight:700; } QToolButton:checked { background:#DCE7FF; border-color:#BFD3FF; color:#1F4FBF; }")
        fmt_row.addWidget(italic_btn)

        underline_btn = QToolButton()
        underline_btn.setText("U")
        underline_btn.setCheckable(True)
        underline_btn.setFixedSize(28, 26)
        underline_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:8px; text-decoration:underline; font-weight:700; } QToolButton:checked { background:#DCE7FF; border-color:#BFD3FF; color:#1F4FBF; }")
        fmt_row.addWidget(underline_btn)

        color_btn = QPushButton("Color")
        color_btn.setFixedHeight(26)
        color_btn.setStyleSheet(
            "QPushButton { background:#EEF1F6; color:#374151; border:1px solid #D9E0EA; border-radius:8px; padding:0 10px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#E3E8F0; }"
        )
        fmt_row.addWidget(color_btn)

        align_left_btn = QToolButton()
        align_left_btn.setText("L")
        align_left_btn.setFixedSize(26, 26)
        align_left_btn.setCheckable(True)
        align_left_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:8px; font-weight:700; } QToolButton:checked { background:#DCE7FF; border-color:#BFD3FF; color:#1F4FBF; }")
        fmt_row.addWidget(align_left_btn)

        align_center_btn = QToolButton()
        align_center_btn.setText("C")
        align_center_btn.setFixedSize(26, 26)
        align_center_btn.setCheckable(True)
        align_center_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:8px; font-weight:700; } QToolButton:checked { background:#DCE7FF; border-color:#BFD3FF; color:#1F4FBF; }")
        fmt_row.addWidget(align_center_btn)

        align_right_btn = QToolButton()
        align_right_btn.setText("R")
        align_right_btn.setFixedSize(26, 26)
        align_right_btn.setCheckable(True)
        align_right_btn.setStyleSheet("QToolButton { background:#F3F4F6; border:1px solid #E5E7EC; border-radius:8px; font-weight:700; } QToolButton:checked { background:#DCE7FF; border-color:#BFD3FF; color:#1F4FBF; }")
        fmt_row.addWidget(align_right_btn)

        fmt_row.addStretch(1)

        raw_layout = (self._company or {}).get("quoteTemplateHeaderLayout")
        raw_layout_json = str((self._company or {}).get("quoteTemplateHeaderLayoutJson") or "").strip()
        header_layout_data: list[dict] = []
        if raw_layout_json:
            try:
                parsed = json.loads(raw_layout_json)
                if isinstance(parsed, list):
                    header_layout_data = [x for x in parsed if isinstance(x, dict)]
            except Exception:
                header_layout_data = []
        if not header_layout_data and isinstance(raw_layout, list):
            header_layout_data = [x for x in raw_layout if isinstance(x, dict)]
        elif not header_layout_data and isinstance(raw_layout, str) and raw_layout.strip():
            try:
                parsed = json.loads(raw_layout)
                if isinstance(parsed, list):
                    header_layout_data = [x for x in parsed if isinstance(x, dict)]
            except Exception:
                header_layout_data = []
        for row in header_layout_data:
            if isinstance(row, dict) and not str(row.get("__id") or "").strip():
                row["__id"] = uuid.uuid4().hex

        raw_footer_layout = (self._company or {}).get("quoteTemplateFooterLayout")
        raw_footer_layout_json = str((self._company or {}).get("quoteTemplateFooterLayoutJson") or "").strip()
        footer_layout_data: list[dict] = []
        if raw_footer_layout_json:
            try:
                parsed = json.loads(raw_footer_layout_json)
                if isinstance(parsed, list):
                    footer_layout_data = [x for x in parsed if isinstance(x, dict)]
            except Exception:
                footer_layout_data = []
        if not footer_layout_data and isinstance(raw_footer_layout, list):
            footer_layout_data = [x for x in raw_footer_layout if isinstance(x, dict)]
        elif not footer_layout_data and isinstance(raw_footer_layout, str) and raw_footer_layout.strip():
            try:
                parsed = json.loads(raw_footer_layout)
                if isinstance(parsed, list):
                    footer_layout_data = [x for x in parsed if isinstance(x, dict)]
            except Exception:
                footer_layout_data = []
        for row in footer_layout_data:
            if isinstance(row, dict) and not str(row.get("__id") or "").strip():
                row["__id"] = uuid.uuid4().hex
        raw_container_name_map = (self._company or {}).get("quoteTemplateContainerNames")
        container_name_map = dict(raw_container_name_map) if isinstance(raw_container_name_map, dict) else {}
        for row in header_layout_data:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("__id") or "").strip()
            if cid and not str(row.get("name") or "").strip() and str(container_name_map.get(cid) or "").strip():
                row["name"] = str(container_name_map.get(cid) or "").strip()
        for row in footer_layout_data:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("__id") or "").strip()
            if cid and not str(row.get("name") or "").strip() and str(container_name_map.get(cid) or "").strip():
                row["name"] = str(container_name_map.get(cid) or "").strip()

        footer_seed = str((self._company or {}).get("quoteTemplateFooterHtml") or "").strip()
        footer_pin_bottom_seed = bool((self._company or {}).get("quoteTemplateFooterPinBottom") is True)
        body_default_html_seed = str((self._company or {}).get("quoteTemplateBodyDefaultHtml") or "").strip()
        body_font_family_seed = str((self._company or {}).get("quoteTemplateBodyFontFamily") or "Segoe UI").strip() or "Segoe UI"
        try:
            body_font_size_seed = int((self._company or {}).get("quoteTemplateBodyFontSizePt") or 11)
        except Exception:
            body_font_size_seed = 11
        body_font_size_seed = max(6, min(72, body_font_size_seed))

        page_sizes = {"A1": (594, 841), "A2": (420, 594), "A3": (297, 420), "A4": (210, 297)}
        seed_size = str((self._company or {}).get("quoteTemplatePageSize") or "A4").strip().upper()
        if seed_size not in page_sizes:
            seed_size = "A4"
        selected_size = {"name": seed_size}
        try:
            seed_margin = int((self._company or {}).get("quoteTemplateMarginMm") or 10)
        except Exception:
            seed_margin = 10
        seed_margin = max(0, min(80, seed_margin))

        size_row = QHBoxLayout()
        size_row.setSpacing(6)
        size_lbl = QLabel("Sheet Preview")
        size_lbl.setStyleSheet("QLabel { color:#20304A; font-size:12px; font-weight:800; }")
        size_row.addWidget(size_lbl)
        size_btns: dict[str, QPushButton] = {}
        for key in ["A1", "A2", "A3", "A4"]:
            b = QPushButton(key)
            b.setCheckable(True)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setFixedHeight(26)
            b.setStyleSheet(
                "QPushButton { background:#EEF1F6; color:#355172; border:1px solid #DCE3EE; border-radius:8px; padding:0 10px; font-size:12px; font-weight:700; }"
                "QPushButton:hover { background:#E3E8F0; }"
                f"QPushButton:checked {{ background:{theme}20; color:#20304A; border:1px solid {theme}66; }}"
            )
            size_btns[key] = b
            size_row.addWidget(b)
        size_row.addSpacing(10)
        unit_suffix = self._measurement_unit_suffix() if hasattr(self, "_measurement_unit_suffix") else "mm"
        margin_lbl = QLabel(f"Margin ({unit_suffix})")
        margin_lbl.setStyleSheet("QLabel { color:#20304A; font-size:12px; font-weight:800; }")
        size_row.addWidget(margin_lbl)
        margin_spin = QSpinBox()
        margin_spin.setRange(0, 80)
        margin_spin.setValue(seed_margin)
        margin_spin.setFixedHeight(26)
        margin_spin.setFixedWidth(72)
        margin_spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        margin_spin.setAlignment(Qt.AlignmentFlag.AlignCenter)
        margin_spin.setStyleSheet(
            "QSpinBox { background:#F3F4F6; color:#374151; border:1px solid #E5E7EC; border-radius:8px; font-size:12px; font-weight:700; }"
        )
        size_row.addWidget(margin_spin)
        size_row.addStretch(1)

        zoom_state = {"factor": 1.0}
        detail_mode = {"show": False}
        zoom_commit_timer = QTimer(dlg)
        zoom_commit_timer.setSingleShot(True)

        content_row = QHBoxLayout()
        content_row.setSpacing(10)
        content_row.setContentsMargins(0, 0, 0, 0)

        tools_panel = QFrame()
        tools_panel.setFixedWidth(286)
        tools_panel.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:12px; }")
        tools_lay = QVBoxLayout(tools_panel)
        tools_lay.setContentsMargins(10, 10, 10, 10)
        tools_lay.setSpacing(10)

        fmt_panel = QFrame()
        fmt_panel.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #E5E7EC; border-radius:10px; }")
        fmt_panel_lay = QVBoxLayout(fmt_panel)
        fmt_panel_lay.setContentsMargins(8, 8, 8, 8)
        fmt_panel_lay.setSpacing(6)
        fmt_title = QLabel("Text Format")
        fmt_title.setStyleSheet("QLabel { color:#20304A; font-size:12px; font-weight:800; }")
        fmt_panel_lay.addWidget(fmt_title)
        fmt_style_row = QHBoxLayout()
        fmt_style_row.setSpacing(6)
        fmt_style_row.addWidget(bold_btn, 0)
        fmt_style_row.addWidget(italic_btn, 0)
        fmt_style_row.addWidget(underline_btn, 0)
        fmt_style_row.addWidget(color_btn, 1)
        fmt_panel_lay.addLayout(fmt_style_row)
        fmt_align_row = QHBoxLayout()
        fmt_align_row.setSpacing(6)
        fmt_align_row.addWidget(align_left_btn, 1)
        fmt_align_row.addWidget(align_center_btn, 1)
        fmt_align_row.addWidget(align_right_btn, 1)
        fmt_panel_lay.addLayout(fmt_align_row)
        fmt_font_row = QHBoxLayout()
        fmt_font_row.setSpacing(6)
        fmt_font_row.addWidget(font_family, 1)
        fmt_font_row.addWidget(font_size, 0)
        fmt_panel_lay.addLayout(fmt_font_row)
        tools_lay.addWidget(fmt_panel)

        size_panel = QFrame()
        size_panel.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #E5E7EC; border-radius:10px; }")
        size_panel_lay = QVBoxLayout(size_panel)
        size_panel_lay.setContentsMargins(8, 8, 8, 8)
        size_panel_lay.setSpacing(6)
        size_title = QLabel("Sheet Preview")
        size_title.setStyleSheet("QLabel { color:#20304A; font-size:12px; font-weight:800; }")
        size_panel_lay.addWidget(size_title)
        size_btn_row = QHBoxLayout()
        size_btn_row.setSpacing(6)
        for key in ["A1", "A2", "A3", "A4"]:
            b = size_btns.get(key)
            if isinstance(b, QPushButton):
                size_btn_row.addWidget(b, 1)
        size_panel_lay.addLayout(size_btn_row)
        margin_row = QHBoxLayout()
        margin_row.setSpacing(6)
        margin_row.addWidget(margin_lbl, 0)
        margin_row.addWidget(margin_spin, 1)
        size_panel_lay.addLayout(margin_row)
        tools_lay.addWidget(size_panel)

        zoom_panel = QFrame()
        zoom_panel.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #E5E7EC; border-radius:10px; }")
        zoom_lay = QVBoxLayout(zoom_panel)
        zoom_lay.setContentsMargins(8, 8, 8, 8)
        zoom_lay.setSpacing(6)
        zoom_title = QLabel("Page Zoom")
        zoom_title.setStyleSheet("QLabel { color:#20304A; font-size:12px; font-weight:800; }")
        zoom_lay.addWidget(zoom_title)
        zoom_row = QHBoxLayout()
        zoom_out_btn = QPushButton("-")
        zoom_out_btn.setFixedSize(26, 24)
        zoom_out_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        zoom_out_btn.setStyleSheet(
            "QPushButton { background:#EEF1F6; color:#374151; border:1px solid #D9E0EA; border-radius:7px; font-size:13px; font-weight:800; }"
            "QPushButton:hover { background:#E3E8F0; }"
        )
        zoom_row.addWidget(zoom_out_btn)
        zoom_slider = QSlider(Qt.Orientation.Horizontal)
        zoom_slider.setRange(50, 200)
        zoom_slider.setValue(200)
        zoom_slider.setStyleSheet(
            "QSlider::groove:horizontal { border:1px solid #D9E0EA; height:6px; background:#F3F4F6; border-radius:3px; }"
            f"QSlider::sub-page:horizontal {{ background:{theme}55; border-radius:3px; }}"
            f"QSlider::handle:horizontal {{ background:{theme}; border:1px solid #1F4FBF; width:10px; margin:-4px 0; border-radius:5px; }}"
        )
        zoom_row.addWidget(zoom_slider, 1)
        zoom_in_btn = QPushButton("+")
        zoom_in_btn.setFixedSize(26, 24)
        zoom_in_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        zoom_in_btn.setStyleSheet(
            "QPushButton { background:#EEF1F6; color:#374151; border:1px solid #D9E0EA; border-radius:7px; font-size:13px; font-weight:800; }"
            "QPushButton:hover { background:#E3E8F0; }"
        )
        zoom_row.addWidget(zoom_in_btn)
        zoom_lay.addLayout(zoom_row)
        zoom_pct = QLabel("100%")
        zoom_pct.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        zoom_pct.setStyleSheet("QLabel { color:#475569; font-size:11px; font-weight:700; }")
        zoom_lay.addWidget(zoom_pct)
        tools_lay.addWidget(zoom_panel)
        tools_lay.addStretch(1)
        content_row.addWidget(tools_panel, 0)

        stage_frame = QFrame()
        stage_frame.setStyleSheet("QFrame { background:transparent; border:none; }")
        stage_lay = QVBoxLayout(stage_frame)
        stage_lay.setContentsMargins(0, 0, 0, 0)
        stage_lay.setSpacing(0)
        stage_lay.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignHCenter)

        sheet_canvas = QFrame()
        sheet_canvas.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #D1D5DB; border-radius:10px; }")
        left_col = QVBoxLayout(sheet_canvas)
        left_col.setContentsMargins(0, 0, 0, 0)
        left_col.setSpacing(8)
        left_col.setAlignment(Qt.AlignmentFlag.AlignTop)

        header_frame = QFrame()
        header_frame.setStyleSheet("QFrame { background:transparent; border:none; }")
        header_frame.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        header_lay = QVBoxLayout(header_frame)
        header_lay.setContentsMargins(0, 0, 0, 0)
        header_lay.setSpacing(0)
        header_controls = QHBoxLayout()
        add_container_btn = QPushButton("Add Container")
        add_container_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_container_btn.setStyleSheet(
            f"QPushButton {{ background:{theme}; color:#FFFFFF; border:none; border-radius:9px; padding:6px 10px; font-size:12px; font-weight:800; }}"
            "QPushButton:hover { background:#1F4FBF; }"
        )
        header_controls.addWidget(add_container_btn)
        header_controls.addStretch(1)
        header_lay.addLayout(header_controls)

        header_list = QListWidget()
        header_list.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        header_list.setDefaultDropAction(Qt.DropAction.MoveAction)
        header_list.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        header_list.setAlternatingRowColors(False)
        header_list.setSpacing(0)
        header_list.setFrameShape(QFrame.Shape.NoFrame)
        header_list.setStyleSheet(
            "QListWidget { background: transparent; border: none; outline: none; }"
            "QListWidget::item { border: none; }"
        )
        header_list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        header_list.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        header_lay.addWidget(header_list, 1)
        left_col.addWidget(header_frame)

        body_gap = QPushButton("Body (entered per quote) appears between Header and Footer:\n{{body}}")
        body_gap.setCheckable(True)
        body_gap.setFlat(True)
        body_gap.setMinimumHeight(72)
        body_gap.setCursor(Qt.CursorShape.PointingHandCursor)
        body_gap_selected = {"on": False}
        def _set_body_gap_selected(on: bool) -> None:
            body_gap_selected["on"] = bool(on)
            body_gap.blockSignals(True)
            body_gap.setChecked(bool(on))
            body_gap.blockSignals(False)
            if bool(on):
                body_gap.setStyleSheet(
                    f"QPushButton {{ background:#FFFFFF; color:#1F4FBF; border:2px dashed {theme}; border-radius:12px; padding:10px; font-size:12px; font-weight:800; text-align:center; }}"
                )
            else:
                body_gap.setStyleSheet(
                    "QPushButton { background:#FFFFFF; color:#556274; border:1px dashed #CBD5E1; border-radius:12px; padding:10px; font-size:12px; font-weight:700; text-align:center; }"
                )
        _set_body_gap_selected(False)
        body_gap.clicked.connect(lambda _=False: (_set_active_editor(None), _set_body_gap_selected(True), _sync_format_toolbar()))
        left_col.addWidget(body_gap, 0, Qt.AlignmentFlag.AlignHCenter)
        footer_spacer = QWidget()
        footer_spacer.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        left_col.addWidget(footer_spacer, 1)
        body_style_row = QHBoxLayout()
        body_style_row.setSpacing(6)
        body_style_lbl = QLabel("Body Font")
        body_style_lbl.setStyleSheet("QLabel { color:#111827; font-size:12px; font-weight:700; }")
        body_style_row.addWidget(body_style_lbl)
        body_font_family = QFontComboBox()
        body_font_family.setFixedHeight(24)
        body_font_family.setMinimumWidth(140)
        body_font_family.setStyleSheet("QFontComboBox { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:0 8px; }")
        body_font_family.setCurrentFont(QFont(body_font_family_seed))
        body_style_row.addWidget(body_font_family)
        body_font_size = QSpinBox()
        body_font_size.setRange(6, 72)
        body_font_size.setValue(body_font_size_seed)
        body_font_size.setFixedHeight(24)
        body_font_size.setFixedWidth(58)
        body_font_size.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        body_font_size.setAlignment(Qt.AlignmentFlag.AlignCenter)
        body_font_size.setStyleSheet("QSpinBox { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; }")
        body_style_row.addWidget(body_font_size)
        body_style_row.addStretch(1)
        body_style_wrap = QWidget()
        body_style_wrap.setLayout(body_style_row)
        tools_lay.insertWidget(2, body_style_wrap)

        body_preview = QTextEdit()
        body_preview.setPlaceholderText("Type sample body text for layout preview...")
        body_preview.setFixedHeight(92)
        body_preview.setStyleSheet("QTextEdit { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; padding:8px; font-size:12px; }")
        if body_default_html_seed:
            try:
                if "<" in body_default_html_seed and ">" in body_default_html_seed:
                    body_preview.setHtml(body_default_html_seed)
                else:
                    body_preview.setPlainText(body_default_html_seed)
            except Exception:
                body_preview.setPlainText(body_default_html_seed)
        tools_lay.insertWidget(3, body_preview)

        def _body_default_html_from_editor() -> str:
            txt = str(body_preview.toPlainText() or "").strip()
            if not txt:
                return ""
            return "<p>" + html.escape(txt).replace("\n", "<br>") + "</p>"

        footer_frame = QFrame()
        footer_frame.setStyleSheet("QFrame { background:transparent; border:none; }")
        footer_frame.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        footer_lay = QVBoxLayout(footer_frame)
        footer_lay.setContentsMargins(0, 0, 0, 0)
        footer_lay.setSpacing(0)
        footer_controls = QHBoxLayout()
        footer_add_container_btn = QPushButton("Add Container")
        footer_add_container_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        footer_add_container_btn.setStyleSheet(
            f"QPushButton {{ background:{theme}; color:#FFFFFF; border:none; border-radius:9px; padding:6px 10px; font-size:12px; font-weight:800; }}"
            "QPushButton:hover { background:#1F4FBF; }"
        )
        footer_controls.addWidget(footer_add_container_btn)
        footer_pin_btn = QPushButton("Always at bottom of last page")
        footer_pin_btn.setCheckable(True)
        footer_pin_btn.setChecked(footer_pin_bottom_seed)
        footer_pin_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        footer_pin_btn.setStyleSheet(
            "QPushButton { background:#EEF1F6; color:#355172; border:1px solid #DCE3EE; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#E3E8F0; }"
            f"QPushButton:checked {{ background:{theme}20; color:#20304A; border:1px solid {theme}66; }}"
        )
        footer_controls.addWidget(footer_pin_btn)
        footer_controls.addStretch(1)
        footer_lay.addLayout(footer_controls)
        footer_list = QListWidget()
        footer_list.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        footer_list.setDefaultDropAction(Qt.DropAction.MoveAction)
        footer_list.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        footer_list.setAlternatingRowColors(False)
        footer_list.setSpacing(0)
        footer_list.setFrameShape(QFrame.Shape.NoFrame)
        footer_list.setStyleSheet(
            "QListWidget { background: transparent; border: none; outline: none; }"
            "QListWidget::item { border: none; }"
        )
        footer_list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        footer_list.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        footer_lay.addWidget(footer_list, 1)
        left_col.addWidget(footer_frame)
        stage_lay.addWidget(sheet_canvas, 0, Qt.AlignmentFlag.AlignHCenter)

        stage_host = QWidget()
        stage_host_lay = QVBoxLayout(stage_host)
        stage_host_lay.setContentsMargins(0, 0, 0, 0)
        stage_host_lay.setSpacing(0)
        stage_host_lay.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignHCenter)
        stage_host_lay.addWidget(stage_frame, 0, Qt.AlignmentFlag.AlignHCenter)
        stage_scroll = QScrollArea()
        stage_scroll.setWidgetResizable(True)
        stage_scroll.setFrameShape(QFrame.Shape.NoFrame)
        stage_scroll.setStyleSheet("QScrollArea { background: transparent; border: none; }")
        stage_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        stage_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        stage_scroll.setWidget(stage_host)
        content_row.addWidget(stage_scroll, 1)

        inspector_panel = QFrame()
        inspector_panel.setFixedWidth(320)
        inspector_panel.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:12px; }")
        inspector_lay = QVBoxLayout(inspector_panel)
        inspector_lay.setContentsMargins(10, 10, 10, 10)
        inspector_lay.setSpacing(8)
        inspector_title = QLabel("Selection Inspector")
        inspector_title.setStyleSheet("QLabel { color:#20304A; font-size:13px; font-weight:800; }")
        inspector_lay.addWidget(inspector_title)
        add_btn_row = QHBoxLayout()
        add_btn_row.setSpacing(6)
        add_header_btn_right = QPushButton("Add Header Container")
        add_header_btn_right.setCursor(Qt.CursorShape.PointingHandCursor)
        add_header_btn_right.setStyleSheet(
            f"QPushButton {{ background:{theme}; color:#FFFFFF; border:none; border-radius:8px; padding:6px 8px; font-size:11px; font-weight:700; }}"
            "QPushButton:hover { background:#1F4FBF; }"
        )
        add_btn_row.addWidget(add_header_btn_right, 1)
        add_footer_btn_right = QPushButton("Add Footer Container")
        add_footer_btn_right.setCursor(Qt.CursorShape.PointingHandCursor)
        add_footer_btn_right.setStyleSheet(
            f"QPushButton {{ background:{theme}; color:#FFFFFF; border:none; border-radius:8px; padding:6px 8px; font-size:11px; font-weight:700; }}"
            "QPushButton:hover { background:#1F4FBF; }"
        )
        add_btn_row.addWidget(add_footer_btn_right, 1)
        inspector_lay.addLayout(add_btn_row)

        selected_scope_lbl = QLabel("Selected: None")
        selected_scope_lbl.setStyleSheet("QLabel { color:#4B5563; font-size:11px; font-weight:700; }")
        inspector_lay.addWidget(selected_scope_lbl)

        selected_name_edit = QLineEdit()
        selected_name_edit.setPlaceholderText("Container name")
        selected_name_edit.setFixedHeight(26)
        inspector_lay.addWidget(selected_name_edit)

        selected_columns_spin = QSpinBox()
        selected_columns_spin.setRange(1, 6)
        selected_columns_spin.setFixedHeight(26)
        selected_columns_spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        selected_columns_spin.setStyleSheet("QSpinBox { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; }")
        inspector_lay.addWidget(selected_columns_spin)

        selected_bg_edit = QLineEdit()
        selected_bg_edit.setPlaceholderText("Container color (optional, e.g. #FFFFFF)")
        selected_bg_edit.setFixedHeight(26)
        inspector_lay.addWidget(selected_bg_edit)

        selected_height_slider = QSlider(Qt.Orientation.Horizontal)
        selected_height_slider.setRange(-2000, 2000)
        selected_height_slider.setEnabled(False)
        inspector_lay.addWidget(selected_height_slider)
        selected_pad_spin = QSpinBox()
        selected_pad_spin.setRange(-80, 80)
        selected_pad_spin.setFixedHeight(26)
        selected_pad_spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        selected_pad_spin.setStyleSheet("QSpinBox { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; }")
        selected_pad_spin.setPrefix("Pad Y: ")
        selected_pad_spin.setSuffix(" px")
        inspector_lay.addWidget(selected_pad_spin)
        selected_rowgap_slider = QSlider(Qt.Orientation.Horizontal)
        selected_rowgap_slider.setRange(60, 220)
        inspector_lay.addWidget(selected_rowgap_slider)

        selected_col_type = QComboBox()
        selected_col_type.addItems(["Textbox", "Logo", "Empty"])
        selected_col_type.setFixedHeight(26)
        inspector_lay.addWidget(selected_col_type)
        selected_col_text = QTextEdit()
        selected_col_text.setPlaceholderText("Column text content...")
        selected_col_text.setFixedHeight(140)
        inspector_lay.addWidget(selected_col_text)

        selected_remove_btn = QPushButton("Remove Selected Container")
        selected_remove_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        selected_remove_btn.setStyleSheet(
            "QPushButton { background:#FDECEC; color:#C62828; border:1px solid #F2B8B5; border-radius:8px; padding:6px 10px; font-size:11px; font-weight:700; }"
            "QPushButton:hover { background:#FAD8D6; }"
        )
        inspector_lay.addWidget(selected_remove_btn)
        inspector_lay.addWidget(footer_pin_btn)
        inspector_lay.addStretch(1)
        content_row.addWidget(inspector_panel, 0)

        selected_target = {"section": "header", "container_id": "", "column_idx": None}
        inspector_sync = {"on": False}
        add_container_btn.setVisible(False)
        footer_add_container_btn.setVisible(False)

        preview_frame = QFrame()
        preview_frame.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:14px; }")
        preview_lay = QVBoxLayout(preview_frame)
        preview_lay.setContentsMargins(8, 8, 8, 8)
        preview_lay.setSpacing(6)
        preview_title = QLabel("Live Layout Preview")
        preview_title.setStyleSheet("QLabel { color:#20304A; font-size:12px; font-weight:800; }")
        preview_lay.addWidget(preview_title)
        preview_web = None
        preview_state = {"web_ok": False}
        preview_text = QTextEdit()
        preview_text.setReadOnly(True)
        preview_text.setStyleSheet("QTextEdit { background:#F8FAFD; border:1px solid #E4E6EC; border-radius:10px; }")
        try:
            from PySide6.QtWebEngineWidgets import QWebEngineView  # type: ignore
            preview_web = QWebEngineView()
            preview_web.setStyleSheet("QWidget { background:#E5E7EB; border:none; border-radius:8px; }")
            preview_lay.addWidget(preview_web, 1)
            preview_lay.addWidget(preview_text, 1)
            preview_web.show()
            preview_text.show()

            def _on_preview_load(ok: bool):
                preview_state["web_ok"] = bool(ok)
                if ok:
                    preview_web.show()
                    preview_text.hide()
                else:
                    preview_web.hide()
                    preview_text.show()

            preview_web.loadFinished.connect(_on_preview_load)
        except Exception:
            preview_lay.addWidget(preview_text, 1)
            preview_text.show()
        preview_frame.hide()
        root.addLayout(content_row, 1)

        def _active_editor() -> QTextEdit | None:
            w = current_editor.get("w")
            return w if isinstance(w, QTextEdit) else None

        def _set_active_editor(w: QTextEdit | None) -> None:
            if isinstance(w, QTextEdit):
                current_editor["w"] = w
                _set_body_gap_selected(False)
            else:
                current_editor["w"] = None
            _sync_format_toolbar()

        def _merge_char_format(fmt: QTextCharFormat) -> None:
            ed = _active_editor()
            if ed is None:
                return
            cursor = ed.textCursor()
            cursor.mergeCharFormat(fmt)
            ed.mergeCurrentCharFormat(fmt)
            ed.setFocus()

        def _sync_format_toolbar() -> None:
            ed = _active_editor()
            font_family.blockSignals(True)
            font_size.blockSignals(True)
            bold_btn.blockSignals(True)
            italic_btn.blockSignals(True)
            underline_btn.blockSignals(True)
            align_left_btn.blockSignals(True)
            align_center_btn.blockSignals(True)
            align_right_btn.blockSignals(True)
            try:
                if ed is not None:
                    f = ed.currentFont()
                    fw = ed.fontWeight()
                    fs = ed.fontPointSize()
                    font_family.setCurrentFont(QFont(f.family()))
                    if fs <= 0:
                        fs = ed.font().pointSizeF() or 11.0
                    font_size.setValue(max(6, min(120, int(round(fs)))))
                    try:
                        fw_int = int(fw)
                    except Exception:
                        fw_int = int(getattr(fw, "value", 400))
                    try:
                        bold_int = int(QFont.Weight.Bold)
                    except Exception:
                        bold_int = int(getattr(QFont.Weight.Bold, "value", 700))
                    bold_btn.setChecked(fw_int >= bold_int)
                    italic_btn.setChecked(bool(ed.fontItalic()))
                    underline_btn.setChecked(bool(ed.fontUnderline()))
                    alg = ed.alignment()
                    align_left_btn.setChecked(bool(alg & Qt.AlignmentFlag.AlignLeft))
                    align_center_btn.setChecked(bool(alg & Qt.AlignmentFlag.AlignHCenter))
                    align_right_btn.setChecked(bool(alg & Qt.AlignmentFlag.AlignRight))
                elif bool(body_gap_selected.get("on")):
                    font_family.setCurrentFont(QFont(body_font_family.currentFont().family()))
                    font_size.setValue(max(6, min(120, int(body_font_size.value()))))
                    bold_btn.setChecked(False)
                    italic_btn.setChecked(False)
                    underline_btn.setChecked(False)
                    align_left_btn.setChecked(False)
                    align_center_btn.setChecked(False)
                    align_right_btn.setChecked(False)
            finally:
                font_family.blockSignals(False)
                font_size.blockSignals(False)
                bold_btn.blockSignals(False)
                italic_btn.blockSignals(False)
                underline_btn.blockSignals(False)
                align_left_btn.blockSignals(False)
                align_center_btn.blockSignals(False)
                align_right_btn.blockSignals(False)

        class _EditorFocusFilter(QObject):
            def __init__(self, owner: "CompanySalesMixin", setter):
                super().__init__(owner if isinstance(owner, QObject) else None)
                self._setter = setter

            def eventFilter(self, obj, event):
                if isinstance(obj, QTextEdit) and event is not None and event.type() == QEvent.Type.FocusIn:
                    self._setter(obj)
                return False

        def _register_editor(ed: QTextEdit) -> None:
            flt = _EditorFocusFilter(dlg, _set_active_editor)
            _editor_filters.append(flt)
            ed.installEventFilter(flt)
            ed.cursorPositionChanged.connect(_sync_format_toolbar)
            ed.selectionChanged.connect(_sync_format_toolbar)

        def _apply_font_family(f: QFont) -> None:
            if bool(body_gap_selected.get("on")) and _active_editor() is None:
                body_font_family.blockSignals(True)
                try:
                    body_font_family.setCurrentFont(QFont(str(f.family() or "Segoe UI")))
                finally:
                    body_font_family.blockSignals(False)
                _render_builder_preview()
                return
            fmt = QTextCharFormat()
            fmt.setFontFamily(str(f.family() or ""))
            _merge_char_format(fmt)

        def _apply_font_size(sz: int) -> None:
            if bool(body_gap_selected.get("on")) and _active_editor() is None:
                body_font_size.blockSignals(True)
                try:
                    body_font_size.setValue(max(6, min(72, int(sz))))
                finally:
                    body_font_size.blockSignals(False)
                _render_builder_preview()
                return
            fmt = QTextCharFormat()
            fmt.setFontPointSize(float(max(6, min(120, int(sz)))))
            _merge_char_format(fmt)

        def _toggle_bold(on: bool) -> None:
            fmt = QTextCharFormat()
            fmt.setFontWeight(QFont.Weight.Bold if on else QFont.Weight.Normal)
            _merge_char_format(fmt)

        def _toggle_italic(on: bool) -> None:
            fmt = QTextCharFormat()
            fmt.setFontItalic(bool(on))
            _merge_char_format(fmt)

        def _toggle_underline(on: bool) -> None:
            fmt = QTextCharFormat()
            fmt.setFontUnderline(bool(on))
            _merge_char_format(fmt)

        def _pick_color() -> None:
            ed = _active_editor()
            if ed is None:
                return
            c = QColorDialog.getColor(ed.textColor(), dlg, "Pick Text Color")
            if not c.isValid():
                return
            fmt = QTextCharFormat()
            fmt.setForeground(c)
            _merge_char_format(fmt)

        def _set_alignment(mode: str) -> None:
            ed = _active_editor()
            if ed is None:
                return
            if mode == "left":
                ed.setAlignment(Qt.AlignmentFlag.AlignLeft)
            elif mode == "center":
                ed.setAlignment(Qt.AlignmentFlag.AlignHCenter)
            elif mode == "right":
                ed.setAlignment(Qt.AlignmentFlag.AlignRight)
            _sync_format_toolbar()

        font_family.currentFontChanged.connect(_apply_font_family)
        font_size.valueChanged.connect(_apply_font_size)
        bold_btn.toggled.connect(_toggle_bold)
        italic_btn.toggled.connect(_toggle_italic)
        underline_btn.toggled.connect(_toggle_underline)
        color_btn.clicked.connect(_pick_color)
        align_left_btn.clicked.connect(lambda: _set_alignment("left"))
        align_center_btn.clicked.connect(lambda: _set_alignment("center"))
        align_right_btn.clicked.connect(lambda: _set_alignment("right"))

        def _header_layout_to_html(layout_data: list[dict], for_preview: bool = False) -> str:
            out: list[str] = []
            logo_path = str((self._company or {}).get("logoPath") or "").strip()
            logo_src = ""
            def _normalize_container_hex(value: str) -> str:
                txt = str(value or "").strip()
                if not txt:
                    return ""
                if not txt.startswith("#"):
                    txt = f"#{txt}"
                if len(txt) == 4:
                    try:
                        int(txt[1:], 16)
                        return "#" + "".join(ch * 2 for ch in txt[1:]).upper()
                    except Exception:
                        return ""
                if len(txt) == 7:
                    try:
                        int(txt[1:], 16)
                        return txt.upper()
                    except Exception:
                        return ""
                return ""
            def _rich_inner(maybe_html: str) -> str:
                src = str(maybe_html or "")
                lower = src.lower()
                b0 = lower.find("<body")
                if b0 >= 0:
                    bs = lower.find(">", b0)
                    be = lower.rfind("</body>")
                    if bs >= 0 and be > bs:
                        return src[bs + 1:be]
                # legacy/plain text fallback
                return html.escape(src).replace("\n", "<br>")
            def _tighten_html_block(block_html: str, row_gap: int) -> str:
                src = str(block_html or "")
                if not src.strip():
                    return src
                # Trim empty leading/trailing blocks so borders hug content.
                src = re.sub(
                    r"^\s*(?:<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*/?>)*</(?:p|div)>\s*)+",
                    "",
                    src,
                    flags=re.IGNORECASE,
                )
                src = re.sub(
                    r"(?:\s*<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*/?>)*</(?:p|div)>)+\s*$",
                    "",
                    src,
                    flags=re.IGNORECASE,
                )
                rg = max(60, min(220, int(row_gap)))
                def _inject(tag_name: str, match: re.Match) -> str:
                    attrs = str(match.group(1) or "")
                    m_style = re.search(r"style\s*=\s*\"([^\"]*)\"", attrs, flags=re.IGNORECASE)
                    if m_style:
                        style_txt = m_style.group(1).strip()
                        if style_txt and not style_txt.endswith(";"):
                            style_txt += ";"
                        style_txt += f"margin:0; line-height:{rg}%;"
                        attrs2 = attrs[:m_style.start()] + f' style="{style_txt}"' + attrs[m_style.end():]
                        return f"<{tag_name}{attrs2}>"
                    return f'<{tag_name}{attrs} style="margin:0; line-height:{rg}%;">'
                out_html = re.sub(r"<p([^>]*)>", lambda m: _inject("p", m), src, flags=re.IGNORECASE)
                out_html = re.sub(r"<div([^>]*)>", lambda m: _inject("div", m), out_html, flags=re.IGNORECASE)
                # Force common block-level tags to have no extra margins.
                out_html = (
                    "<div style='margin:0;padding:0;'>"
                    "<style>"
                    "p,div,h1,h2,h3,h4,h5,h6,ul,ol,li{margin:0;padding:0;}"
                    "</style>"
                    + out_html
                    + "</div>"
                )
                return out_html
            def _to_data_uri_from_remote(url: str) -> str:
                try:
                    req = Request(url, headers={"User-Agent": "Cutsmart/1.0"})
                    with urlopen(req, timeout=4) as resp:
                        raw = resp.read()
                        ctype = str(resp.headers.get("Content-Type") or "image/png").split(";")[0].strip() or "image/png"
                        if raw:
                            return f"data:{ctype};base64,{base64.b64encode(raw).decode('ascii')}"
                except Exception:
                    return ""
                return ""
            if logo_path:
                txt = str(logo_path).strip()
                if txt.lower().startswith("http://") or txt.lower().startswith("https://"):
                    logo_src = _to_data_uri_from_remote(txt) if for_preview else txt
                elif txt.lower().startswith("gs://"):
                    # Convert gs://bucket/path to Firebase media endpoint shape for preview fetch.
                    gs = txt[5:]
                    if "/" in gs:
                        bucket, blob = gs.split("/", 1)
                        media_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{quote(blob, safe='')}?alt=media"
                        logo_src = _to_data_uri_from_remote(media_url) if for_preview else media_url
                else:
                    p = Path(txt)
                    if p.exists() and p.is_file():
                        if for_preview:
                            try:
                                mime = mimetypes.guess_type(str(p))[0] or "image/png"
                                b64 = base64.b64encode(p.read_bytes()).decode("ascii")
                                logo_src = f"data:{mime};base64,{b64}"
                            except Exception:
                                logo_src = QUrl.fromLocalFile(str(p)).toString()
                        else:
                            logo_src = QUrl.fromLocalFile(str(p)).toString()
            logo_html = (
                f"<img src=\"{html.escape(logo_src, quote=True)}\" alt=\"Company Logo\" "
                "style=\"max-width:100%; max-height:96px; object-fit:contain;\">"
                if logo_src
                else "{{company_logo}}"
            )
            for container in layout_data:
                cols = container.get("columns") if isinstance(container, dict) else []
                if not isinstance(cols, list) or not cols:
                    continue
                container_id = str((container or {}).get("__id") or "").strip()
                container_bg = _normalize_container_hex(str((container or {}).get("bgColor") or ""))
                # Container height is dynamic by content (no fixed-height rows).
                container_height_px = 0
                invert_center = False
                try:
                    row_gap_pct = int((container or {}).get("rowGapPct") or 100)
                except Exception:
                    row_gap_pct = 100
                row_gap_pct = max(60, min(220, row_gap_pct))
                try:
                    cell_padding_y_px = int((container or {}).get("padY") or 2)
                except Exception:
                    cell_padding_y_px = 2
                cell_padding_y_px = max(-80, min(80, cell_padding_y_px))
                cell_padding_x_px = 2
                width = 100.0 / max(1, len(cols))
                cells: list[str] = []
                for col in cols:
                    if not isinstance(col, dict):
                        col = {}
                    w_type = str(col.get("type") or "text").strip().lower()
                    text_val = str(col.get("content") or "")
                    col_row_gap_pct = row_gap_pct
                    if w_type == "logo":
                        raw_logo = logo_html if for_preview else "{{company_logo}}"
                        inner = (
                            "<div style='width:100%; max-width:100%; overflow:hidden; display:flex; justify-content:flex-end; align-items:flex-start;'>"
                            f"{raw_logo}"
                            "</div>"
                        )
                        align_style = "text-align:right;"
                    elif w_type == "text":
                        tight_text = _tighten_html_block(_rich_inner(text_val), col_row_gap_pct)
                        inner = (
                            f"<div style='line-height:{col_row_gap_pct}%;"
                            + (
                                " height:100%; display:flex; flex-direction:column; justify-content:center;"
                                + (" transform:scaleY(-1);" if invert_center else "")
                                if container_height_px > 0
                                else ""
                            )
                            + f"'>{tight_text}</div>"
                        )
                        if invert_center and container_height_px > 0:
                            inner = f"<div style='transform:scaleY(-1); height:100%;'>{inner}</div>"
                        align_style = "text-align:left;"
                    else:
                        inner = ""
                        align_style = "text-align:left;"
                    cells.append(
                        f"<td style='width:{width:.4f}% !important; max-width:{width:.4f}% !important; "
                        f"min-width:{width:.4f}% !important; vertical-align:{'middle' if container_height_px > 0 else 'top'}; padding:{cell_padding_y_px}px {cell_padding_x_px}px; overflow:hidden; {align_style}"
                        + (" height:100%;" if container_height_px > 0 else "")
                        + f"'>{inner}</td>"
                    )
                container_open = (
                    "<div style='width:100%; margin:0;"
                    + (f" background:{container_bg}; border-radius:8px; padding:6px;" if container_bg else "")
                    + (f" height:{container_height_px}px; overflow:hidden;" if container_height_px > 0 else "")
                    + "'>"
                )
                out.append(
                    (f"<!--CS_CONTAINER_START:{html.escape(container_id)}-->" if container_id else "")
                    + (
                        f"<div data-cs-container-id=\"{html.escape(container_id, quote=True)}\">"
                        if container_id
                        else ""
                    )
                    + container_open
                    + (
                        "<table style='width:100% !important; border-collapse:collapse; table-layout:fixed !important;"
                        + (" height:100%;" if container_height_px > 0 else "")
                        + "'>"
                    )
                    + f"<tr>{''.join(cells)}</tr>"
                    + "</table></div>"
                    + ("</div>" if container_id else "")
                    + (f"<!--CS_CONTAINER_END:{html.escape(container_id)}-->" if container_id else "")
                )
            return "".join(out)

        def _save_template_quiet() -> None:
            try:
                _sync_container_names_from_inputs()
                quiet_header_html = _header_layout_to_html(header_layout_data)
                quiet_footer_html = _header_layout_to_html(footer_layout_data)
                if not str(quiet_header_html or "").strip():
                    quiet_header_html = str((self._company or {}).get("quoteTemplateHeaderHtml") or "").strip()
                if not str(quiet_footer_html or "").strip():
                    quiet_footer_html = str((self._company or {}).get("quoteTemplateFooterHtml") or "").strip()
                if not str(quiet_header_html or "").strip() or not str(quiet_footer_html or "").strip():
                    # Builder validation requires both header/footer HTML.
                    # If they do not exist yet, skip quiet save.
                    return
                self._save_company_quote_template(
                    notify=False,
                    silent_invalid=True,
                    header_html=quiet_header_html,
                    footer_html=quiet_footer_html,
                    header_layout=header_layout_data,
                    footer_layout=footer_layout_data,
                    page_size=str(selected_size.get("name") or "A4"),
                    page_margin_mm=int(margin_spin.value()),
                    footer_pin_bottom=bool(footer_pin_btn.isChecked()),
                    body_font_family=str(body_font_family.currentFont().family() or "Segoe UI"),
                    body_font_size_pt=int(body_font_size.value()),
                    body_default_html=_body_default_html_from_editor(),
                )
            except Exception:
                pass

        def _sync_container_names_from_inputs() -> None:
            for cid, edit in list(header_title_inputs.items()):
                try:
                    idx = _container_index_by_id(cid)
                    if idx >= 0:
                        nm = str(edit.text() or "").strip()
                        header_layout_data[idx]["name"] = nm
                        if cid:
                            container_name_map[cid] = nm
                except Exception:
                    continue
            for cid, edit in list(footer_title_inputs.items()):
                try:
                    idx = _container_index_by_id_f(cid)
                    if idx >= 0:
                        nm = str(edit.text() or "").strip()
                        footer_layout_data[idx]["name"] = nm
                        if cid:
                            container_name_map[cid] = nm
                except Exception:
                    continue

        def _apply_sheet_editor_size() -> None:
            size_name = selected_size.get("name", "A4")
            w_mm, h_mm = page_sizes.get(size_name, (210, 297))
            min_mm = 210.0
            max_mm = 594.0
            mm_ratio = (float(w_mm) - min_mm) / (max_mm - min_mm)
            mm_ratio = max(0.0, min(1.0, mm_ratio))
            max_available = max(540, int(stage_scroll.viewport().width() - 18))
            base_min = 540
            target = int(base_min + (max_available - base_min) * mm_ratio)
            zoom_factor = float(zoom_state.get("factor") or 1.0)
            zoom_factor = max(0.50, min(2.00, zoom_factor))
            # Keep the zoomed sheet inside the visible viewport so no page scrolling is needed.
            max_unzoomed = int(max_available / zoom_factor)
            max_unzoomed = max(260, max_unzoomed)
            target = max(260, min(target, max_unzoomed))
            target_zoom = int(target * zoom_factor)
            if isinstance(sheet_canvas, QWidget):
                sheet_canvas.setFixedWidth(target_zoom)
                ratio_h = float(h_mm) / max(1.0, float(w_mm))
                target_h = int(target_zoom * ratio_h)
                # Keep true paper aspect ratio so page can extend beyond viewport height.
                sheet_canvas.setFixedHeight(max(260, target_h))

        def _render_builder_preview() -> None:
            _apply_sheet_editor_size()
            size_name = selected_size.get("name", "A4")
            w_mm, h_mm = page_sizes.get(size_name, (210, 297))
            margin_mm = int(margin_spin.value())
            body_html = html.escape(str(body_preview.toPlainText() or "")).replace("\n", "<br>")
            header_html = _header_layout_to_html(header_layout_data, for_preview=True)
            footer_html = _header_layout_to_html(footer_layout_data, for_preview=True)
            pin_footer_bottom = bool(footer_pin_btn.isChecked())
            body_font_family_name = str(body_font_family.currentFont().family() or "Segoe UI")
            body_font_size_pt = int(body_font_size.value())
            mm_to_px = 3.7795275591
            base_w = max(200.0, float(w_mm) * mm_to_px)
            base_h = max(260.0, float(h_mm) * mm_to_px)
            frame_w = float(max(320, preview_frame.width() - 22))
            frame_h = float(max(420, preview_frame.height() - 42))
            target_w = frame_w
            target_h = frame_h
            if preview_web is not None and preview_web.width() > 240 and preview_web.height() > 260:
                target_w = float(max(260, preview_web.width() - 20))
                target_h = float(max(320, preview_web.height() - 20))
            elif preview_text is not None and preview_text.viewport().width() > 240 and preview_text.viewport().height() > 260:
                target_w = float(max(260, preview_text.viewport().width() - 20))
                target_h = float(max(320, preview_text.viewport().height() - 20))
            scale = min(target_w / base_w, target_h / base_h)
            scale = max(0.10, min(3.0, scale))
            stage_h = int(max(120.0, target_h))
            page_html = (
                "<html><head><meta charset='utf-8'>"
                "<style>"
                f"@page {{ size: {size_name}; margin: {margin_mm}mm; }}"
                "body{margin:0;padding:12px;background:#E5E7EB;font-family:Segoe UI,Arial,sans-serif;}"
                f".stage{{position:relative; width:100%; height:{stage_h}px; overflow:hidden; display:flex; justify-content:center; align-items:flex-start;}}"
                f".sheet-wrap{{transform:scale({scale:.6f}); transform-origin:top center;}}"
                f".sheet{{background:#FFF;margin:0 auto;border:1px solid #D1D5DB;box-shadow:0 2px 8px rgba(15,23,42,0.08);padding:{margin_mm}mm;box-sizing:border-box;overflow:hidden;}}"
                + (".sheet{display:flex; flex-direction:column;} .main-block{flex:1 0 auto;} .footer-block{margin-top:auto; break-inside:avoid; page-break-inside:avoid;}" if pin_footer_bottom else "")
                + f".body-gap{{font-family:'{html.escape(body_font_family_name)}','Segoe UI',Arial,sans-serif; font-size:{body_font_size_pt}pt;}}"
                + ".body-gap{border:1px dashed #CBD5E1;border-radius:8px;padding:10px;margin:10px 0;color:#374151;min-height:50px;}</style>"
                "</head><body>"
                "<div class='stage'><div class='sheet-wrap'>"
                f"<div class='sheet' style='width:{base_w:.2f}px; min-height:{base_h:.2f}px;'>"
                f"<div class='main-block'>{header_html}<div class='body-gap'>{body_html or '<em style=\"color:#6B7280;\">Body preview...</em>'}</div></div>"
                f"<div class='footer-block'>{footer_html}</div>"
                "</div></div></div></body></html>"
            )
            preview_text.setHtml(page_html)
            if preview_web is not None:
                preview_web.setHtml(page_html, QUrl("about:blank"))
                if not bool(preview_state.get("web_ok")):
                    preview_text.show()

        class _BuilderResizeFilter(QObject):
            def eventFilter(self, obj, event):
                if event is not None and event.type() == QEvent.Type.Resize:
                    QTimer.singleShot(0, _apply_sheet_editor_size)
                    QTimer.singleShot(0, lambda: _fit_list_height(header_list))
                    QTimer.singleShot(0, lambda: _fit_list_height(footer_list))
                return False

        _resize_filter = _BuilderResizeFilter(dlg)
        dlg.installEventFilter(_resize_filter)

        class _NoWheelFilter(QObject):
            def eventFilter(self, obj, event):
                if event is not None and event.type() == QEvent.Type.Wheel:
                    return True
                return False

        _header_no_wheel_filter = _NoWheelFilter(dlg)
        header_list.installEventFilter(_header_no_wheel_filter)
        if header_list.viewport() is not None:
            header_list.viewport().installEventFilter(_header_no_wheel_filter)

        class _ZoomWheelFilter(QObject):
            def eventFilter(self, obj, event):
                if event is None or event.type() != QEvent.Type.Wheel:
                    return False
                mods = getattr(event, "modifiers", lambda: Qt.KeyboardModifier.NoModifier)()
                if mods == Qt.KeyboardModifier.ControlModifier or bool(mods & Qt.KeyboardModifier.ControlModifier):
                    delta = int(getattr(event, "angleDelta", lambda: QPoint(0, 0))().y())
                    step = 5 if delta > 0 else -5
                    zoom_slider.setValue(max(50, min(200, int(zoom_slider.value()) + step)))
                    return True
                return False

        _zoom_wheel_filter = _ZoomWheelFilter(dlg)
        stage_scroll.viewport().installEventFilter(_zoom_wheel_filter)

        def _container_index_by_id(container_id: str) -> int:
            cid = str(container_id or "").strip()
            if not cid:
                return -1
            for i, row in enumerate(header_layout_data):
                if str((row or {}).get("__id") or "").strip() == cid:
                    return i
            return -1

        def _sync_layout_from_list_order() -> None:
            ids: list[str] = []
            for i in range(header_list.count()):
                it = header_list.item(i)
                ids.append(str(it.data(Qt.ItemDataRole.UserRole) or ""))
            if not ids:
                return
            by_id = {
                str((row or {}).get("__id") or ""): row
                for row in header_layout_data
                if isinstance(row, dict) and str((row or {}).get("__id") or "")
            }
            reordered: list[dict] = [by_id[cid] for cid in ids if cid in by_id]
            if len(reordered) == len(header_layout_data):
                header_layout_data[:] = reordered

        def _remove_container(container_id: str):
            idx = _container_index_by_id(container_id)
            if idx >= 0:
                header_layout_data.pop(idx)
                _render_container_cards()
                _render_builder_preview()

        def _fit_list_height(lst: QListWidget) -> None:
            try:
                lst.doItemsLayout()
                lst.updateGeometries()
                total = 0
                for i in range(lst.count()):
                    total += max(0, lst.sizeHintForRow(i))
                if lst.count() > 1:
                    total += int(lst.spacing()) * (lst.count() - 1)
                frame = int(lst.frameWidth()) * 2
                lst.setFixedHeight(max(1, total + frame))
            except Exception:
                pass

        class _ColumnClickFilter(QObject):
            def __init__(self, owner: QObject, on_click):
                super().__init__(owner)
                self._on_click = on_click

            def eventFilter(self, obj, event):
                if event is not None and event.type() == QEvent.Type.MouseButtonPress:
                    try:
                        self._on_click()
                    except Exception:
                        pass
                    return True
                return False

        def _column_preview_text(col: dict, j: int) -> str:
            def _scale_html_for_zoom(src_html: str, factor: float) -> str:
                txt = str(src_html or "")
                f = max(0.25, min(4.0, float(factor)))
                if abs(f - 1.0) < 0.001:
                    return txt
                def _scale_match(m: re.Match) -> str:
                    num = m.group(1)
                    unit = m.group(2)
                    try:
                        scaled = float(num) * f
                    except Exception:
                        return m.group(0)
                    return f"font-size:{scaled:.2f}{unit}"
                out = re.sub(r"font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|px)", _scale_match, txt, flags=re.IGNORECASE)
                return out

            if not isinstance(col, dict):
                return ""
            ctype = str(col.get("type") or "text").strip().lower()
            if ctype == "logo":
                z = max(0.5, min(2.5, float(zoom_state.get("factor") or 1.0)))
                return f"<span style='color:#64748B;font-weight:700;font-size:{11.0 * z:.2f}px;'>[Company Logo]</span>"
            if ctype == "empty":
                return ""
            raw = str(col.get("content") or "")
            if not raw.strip():
                return ""
            lower = raw.lower()
            b0 = lower.find("<body")
            if b0 >= 0:
                bs = lower.find(">", b0)
                be = lower.rfind("</body>")
                if bs >= 0 and be > bs:
                    raw = raw[bs + 1:be]
            if "<" not in raw or ">" not in raw:
                raw = html.escape(raw).replace("\n", "<br>")
            raw = re.sub(
                r"^\s*(?:<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*/?>)*</(?:p|div)>\s*)+",
                "",
                raw,
                flags=re.IGNORECASE,
            )
            raw = re.sub(
                r"(?:\s*<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*/?>)*</(?:p|div)>)+\s*$",
                "",
                raw,
                flags=re.IGNORECASE,
            )
            zf = float(zoom_state.get("factor") or 1.0)
            scaled_raw = _scale_html_for_zoom(raw, zf)
            return (
                "<div style='margin:0;padding:0;line-height:1.1;'>"
                "<style>p,div,h1,h2,h3,h4,h5,h6,ul,ol,li{margin:0;padding:0;}</style>"
                + scaled_raw
                + "</div>"
            )

        def _set_column_count(container_id: str):
            idx = _container_index_by_id(container_id)
            if idx < 0:
                return
            current = header_layout_data[idx]
            old_cols = current.get("columns") if isinstance(current, dict) else []
            old_cols = old_cols if isinstance(old_cols, list) else []
            default_count = len(old_cols) if old_cols else 2
            count, ok = QInputDialog.getInt(dlg, "Add Columns", "Number of columns (1-6):", default_count, 1, 6, 1)
            if not ok:
                return
            new_cols: list[dict] = []
            for i in range(count):
                if i < len(old_cols) and isinstance(old_cols[i], dict):
                    new_cols.append(
                        {
                            "type": str(old_cols[i].get("type") or "text"),
                            "content": str(old_cols[i].get("content") or ""),
                            "rowGapPct": int(old_cols[i].get("rowGapPct") or 0),
                        }
                    )
                else:
                    new_cols.append({"type": "text", "content": "", "rowGapPct": 0})
            current["columns"] = new_cols
            _render_container_cards()
            _render_builder_preview()

        def _add_container():
            new_id = uuid.uuid4().hex
            header_layout_data.append({"__id": new_id, "name": "", "columns": [], "collapsed": False})
            _render_container_cards()
            _select_target("header", new_id, None)
            _render_builder_preview()

        def _render_container_cards():
            header_list.clear()
            header_title_inputs.clear()
            sel_section = str(selected_target.get("section") or "header")
            sel_cid = str(selected_target.get("container_id") or "")
            sel_col = selected_target.get("column_idx")
            for cidx, container in enumerate(header_layout_data):
                if not isinstance(container, dict):
                    continue
                container_id = str(container.get("__id") or "").strip() or uuid.uuid4().hex
                container["__id"] = container_id
                container_name = str(container.get("name") or "").strip() or f"Container {cidx + 1}"
                is_collapsed = bool(container.get("collapsed", False))
                container["collapsed"] = is_collapsed
                card = QFrame()
                card.setStyleSheet("QFrame { background: transparent; border: none; }")
                cl = QVBoxLayout(card)
                cl.setContentsMargins(0, 0, 0, 0)
                cl.setSpacing(2)
                is_container_selected = (sel_section == "header" and sel_cid == container_id and sel_col is None)
                head_border = theme if is_container_selected else "#D1D5DB"
                head = QFrame()
                head.setStyleSheet(
                    f"QFrame {{ background:#FFFFFF; border:1px solid {head_border}; border-radius:0; }}"
                )
                head_l = QHBoxLayout(head)
                head_l.setContentsMargins(8, 4, 8, 4)
                head_l.setSpacing(6)
                title_btn = QPushButton(container_name)
                title_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                title_btn.setStyleSheet(
                    "QPushButton { background:transparent; border:none; color:#1F2937; font-size:11px; font-weight:800; text-align:left; }"
                    "QPushButton:hover { color:#0F2A4A; }"
                )
                title_btn.clicked.connect(lambda _=False, cid=container_id: _select_target("header", cid, None))
                head_l.addWidget(title_btn, 1)
                toggle_btn = QToolButton()
                try:
                    icon = self.style().standardIcon(
                        QStyle.StandardPixmap.SP_ArrowRight if is_collapsed else QStyle.StandardPixmap.SP_ArrowDown
                    )
                    toggle_btn.setIcon(icon)
                except Exception:
                    toggle_btn.setText(">" if is_collapsed else "v")
                toggle_btn.setToolTip("Expand container" if is_collapsed else "Collapse container")
                toggle_btn.setFixedSize(22, 22)
                toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                toggle_btn.setStyleSheet(
                    "QToolButton { background:#F3F4F6; border:1px solid #94A3B8; border-radius:0; color:#0F172A; font-size:10px; font-weight:800; padding:0; }"
                    "QToolButton:hover { background:#E8EDF5; }"
                )
                def _toggle_container_collapsed(_=False, cid=container_id):
                    i = _container_index_by_id(cid)
                    if i < 0:
                        return
                    cur = bool(header_layout_data[i].get("collapsed", False))
                    header_layout_data[i]["collapsed"] = not cur
                    _render_container_cards()
                    _render_builder_preview()
                toggle_btn.clicked.connect(_toggle_container_collapsed)
                head_l.addWidget(toggle_btn, 0)
                cl.addWidget(head)
                cols = container.get("columns") if isinstance(container, dict) else []
                cols = cols if isinstance(cols, list) else []
                try:
                    pad_y_preview = int(container.get("padY") or 1)
                except Exception:
                    pad_y_preview = 1
                pad_y_preview = max(-40, min(40, pad_y_preview))
                row_wrap = QWidget()
                row = QHBoxLayout(row_wrap)
                row.setContentsMargins(0, 0, 0, 0)
                row.setSpacing(0)
                if cols:
                    for j, col in enumerate(cols):
                        col_name = _column_preview_text(col if isinstance(col, dict) else {}, j)
                        is_selected = (sel_section == "header" and sel_cid == container_id and sel_col == j)
                        border_color = theme if is_selected else "#D1D5DB"
                        left_border = "none" if j > 0 else f"1px solid {border_color}"
                        col_box = QFrame()
                        col_box.setCursor(Qt.CursorShape.PointingHandCursor)
                        col_box.setStyleSheet(
                            f"QFrame {{ background:#FFFFFF; border-top:1px solid {border_color}; border-right:1px solid {border_color}; border-bottom:1px solid {border_color}; border-left:{left_border}; border-radius:0; }}"
                        )
                        col_lay = QVBoxLayout(col_box)
                        col_lay.setContentsMargins(3, 0, 3, 0)
                        col_lay.setSpacing(0)
                        col_label = QLabel()
                        col_label.setTextFormat(Qt.TextFormat.RichText)
                        col_label.setWordWrap(True)
                        col_label.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)
                        col_label.setContentsMargins(0, 0, 0, 0)
                        col_label.setTextInteractionFlags(Qt.TextInteractionFlag.NoTextInteraction)
                        col_label.setStyleSheet(
                            "QLabel { color:#334155; background:transparent; border:none; margin:0; padding:0;"
                            f" margin-top:{pad_y_preview}px; margin-bottom:{pad_y_preview}px; }}"
                        )
                        col_label.setText(col_name)
                        col_lay.addWidget(col_label)
                        click_filter = _ColumnClickFilter(dlg, lambda cid=container_id, k=j: _select_target("header", cid, k))
                        _click_filters.append(click_filter)
                        col_box.installEventFilter(click_filter)
                        col_label.installEventFilter(click_filter)
                        row.addWidget(col_box, 1)
                else:
                    empty = QLabel("No columns")
                    empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
                    empty.setStyleSheet("QLabel { border:1px solid #D1D5DB; color:#6B7280; padding:8px; font-size:11px; }")
                    row.addWidget(empty, 1)
                row_wrap.setVisible(not is_collapsed)
                cl.addWidget(row_wrap)
                item = QListWidgetItem()
                item.setData(Qt.ItemDataRole.UserRole, container_id)
                item.setFlags(
                    Qt.ItemFlag.ItemIsEnabled
                    | Qt.ItemFlag.ItemIsSelectable
                    | Qt.ItemFlag.ItemIsDragEnabled
                )
                card.layout().activate()
                card.adjustSize()
                item.setSizeHint(card.sizeHint())
                header_list.addItem(item)
                header_list.setItemWidget(item, card)
                row_wrap.updateGeometry()
            _fit_list_height(header_list)
            header_list.doItemsLayout()
            header_list.updateGeometries()
            return
            show_detail = bool(detail_mode.get("show"))
            for cidx, container in enumerate(header_layout_data):
                if not isinstance(container, dict):
                    continue
                container_id = str(container.get("__id") or "").strip() or uuid.uuid4().hex
                container["__id"] = container_id
                card = QFrame()
                card.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:12px; }")
                cl = QVBoxLayout(card)
                cl.setContentsMargins(8, 8, 8, 8)
                cl.setSpacing(8)
                top = QHBoxLayout()
                container_name = str(container.get("name") or "").strip()
                fallback_name = f"Container {cidx + 1}"
                title_edit = QLineEdit(container_name or fallback_name)
                title_edit.setFixedHeight(24)
                title_edit.setFixedWidth(180)
                title_edit.setStyleSheet(
                    "QLineEdit { background:#F7F8FA; border:1px solid #E5E7EC; color:#20304A; font-size:12px; font-weight:800; padding:0 8px; border-radius:7px; }"
                    "QLineEdit:focus { background:#FFFFFF; border:1px solid #CBD5E1; }"
                )
                title_edit.setReadOnly(not show_detail)
                top.addWidget(title_edit)
                header_title_inputs[container_id] = title_edit
                add_cols = QPushButton("Add Columns")
                add_cols.setCursor(Qt.CursorShape.PointingHandCursor)
                add_cols.setFixedHeight(24)
                add_cols.setStyleSheet(
                    f"QPushButton {{ background:{theme}; color:#FFFFFF; border:none; border-radius:7px; padding:0 8px; font-size:11px; font-weight:700; }}"
                    "QPushButton:hover { background:#1F4FBF; }"
                )
                add_cols.clicked.connect(lambda _=False, cid=container_id: _set_column_count(cid))
                top.addWidget(add_cols)
                color_lbl = QLabel("Color")
                color_lbl.setStyleSheet("QLabel { color:#475569; font-size:11px; font-weight:700; }")
                top.addWidget(color_lbl)
                color_edit = QLineEdit()
                color_edit.setPlaceholderText("#FFFFFF")
                color_edit.setFixedHeight(24)
                color_edit.setFixedWidth(90)
                color_edit.setText(str(container.get("bgColor") or ""))
                color_edit.setStyleSheet(
                    "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; padding:0 8px; font-size:11px; color:#111827; }"
                )
                top.addWidget(color_edit)
                h_lbl = QLabel("Height")
                h_lbl.setStyleSheet("QLabel { color:#475569; font-size:11px; font-weight:700; }")
                top.addWidget(h_lbl)
                height_slider = QSlider(Qt.Orientation.Horizontal)
                height_slider.setRange(-2000, 2000)
                height_slider.setValue(int(container.get("heightPx") or 0))
                height_slider.setFixedWidth(82)
                height_slider.setStyleSheet(
                    "QSlider::groove:horizontal { border:1px solid #D9E0EA; height:6px; background:#F3F4F6; border-radius:3px; }"
                    "QSlider::sub-page:horizontal { background:#BFD3FF; border-radius:3px; }"
                    "QSlider::handle:horizontal { background:#2F6BFF; border:1px solid #1F4FBF; width:10px; margin:-4px 0; border-radius:5px; }"
                )
                top.addWidget(height_slider)
                height_val = QLabel("0")
                height_val.setFixedWidth(34)
                height_val.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                height_val.setStyleSheet("QLabel { color:#475569; font-size:10px; font-weight:700; }")
                top.addWidget(height_val)
                rg_lbl = QLabel("Row Gap")
                rg_lbl.setStyleSheet("QLabel { color:#475569; font-size:11px; font-weight:700; }")
                top.addWidget(rg_lbl)
                row_gap_slider = QSlider(Qt.Orientation.Horizontal)
                row_gap_slider.setRange(60, 220)
                row_gap_slider.setValue(int(container.get("rowGapPct") or 100))
                row_gap_slider.setFixedWidth(82)
                row_gap_slider.setStyleSheet(
                    "QSlider::groove:horizontal { border:1px solid #D9E0EA; height:6px; background:#F3F4F6; border-radius:3px; }"
                    "QSlider::sub-page:horizontal { background:#BFD3FF; border-radius:3px; }"
                    "QSlider::handle:horizontal { background:#2F6BFF; border:1px solid #1F4FBF; width:10px; margin:-4px 0; border-radius:5px; }"
                )
                top.addWidget(row_gap_slider)
                row_gap_val = QLabel("100%")
                row_gap_val.setFixedWidth(40)
                row_gap_val.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                row_gap_val.setStyleSheet("QLabel { color:#475569; font-size:10px; font-weight:700; }")
                top.addWidget(row_gap_val)
                rem = QPushButton("Remove")
                rem.setCursor(Qt.CursorShape.PointingHandCursor)
                rem.setFixedHeight(24)
                rem.setStyleSheet(
                    "QPushButton { background:#FDECEC; color:#C62828; border:1px solid #F2B8B5; border-radius:7px; padding:0 8px; font-size:11px; font-weight:700; }"
                    "QPushButton:hover { background:#FAD8D6; }"
                )
                rem.clicked.connect(lambda _=False, cid=container_id: _remove_container(cid))
                top.addWidget(rem)
                color_preview = QFrame()
                color_preview.setFixedSize(16, 16)
                color_preview.setStyleSheet("QFrame { background: transparent; border:1px solid #CBD5E1; border-radius:4px; }")
                top.addWidget(color_preview)
                top.addStretch(1)
                for w in (add_cols, color_lbl, color_edit, h_lbl, height_slider, height_val, rg_lbl, row_gap_slider, row_gap_val, rem, color_preview):
                    w.setVisible(show_detail)
                cl.addLayout(top)
                def _on_name_edit(cid=container_id, te: QLineEdit = title_edit):
                    i = _container_index_by_id(cid)
                    if i < 0:
                        return
                    nm = str(te.text() or "").strip()
                    header_layout_data[i]["name"] = nm
                    if cid:
                        container_name_map[cid] = nm

                title_edit.textChanged.connect(_on_name_edit)
                title_edit.editingFinished.connect(_save_template_quiet)

                def _on_container_color_edit(
                    cid=container_id,
                    ce: QLineEdit = color_edit,
                    cp: QFrame = color_preview,
                ):
                    i = _container_index_by_id(cid)
                    if i < 0:
                        return
                    raw = str(ce.text() or "").strip()
                    if raw and not raw.startswith("#"):
                        raw = f"#{raw}"
                    norm = ""
                    if raw:
                        if len(raw) == 4:
                            try:
                                int(raw[1:], 16)
                                norm = "#" + "".join(ch * 2 for ch in raw[1:]).upper()
                            except Exception:
                                norm = ""
                        elif len(raw) == 7:
                            try:
                                int(raw[1:], 16)
                                norm = raw.upper()
                            except Exception:
                                norm = ""
                    if norm:
                        header_layout_data[i]["bgColor"] = norm
                        ce.setText(norm)
                        cp.setStyleSheet(f"QFrame {{ background:{norm}; border:1px solid #94A3B8; border-radius:4px; }}")
                        ce.setStyleSheet(
                            "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; padding:0 8px; font-size:11px; color:#111827; }"
                        )
                    else:
                        header_layout_data[i]["bgColor"] = ""
                        cp.setStyleSheet("QFrame { background: transparent; border:1px solid #CBD5E1; border-radius:4px; }")
                        if raw:
                            ce.setStyleSheet(
                                "QLineEdit { background:#FFF1F2; border:1px solid #FCA5A5; border-radius:7px; padding:0 8px; font-size:11px; color:#991B1B; }"
                            )
                        else:
                            ce.setStyleSheet(
                                "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; padding:0 8px; font-size:11px; color:#111827; }"
                            )
                    _render_builder_preview()

                color_edit.editingFinished.connect(_on_container_color_edit)
                QTimer.singleShot(0, _on_container_color_edit)
                def _on_height_slider(v=0, cid=container_id, lbl: QLabel = height_val):
                    idx = _container_index_by_id(cid)
                    if idx < 0:
                        return
                    header_layout_data[idx]["heightPx"] = int(v)
                    lbl.setText(str(int(v)))
                    _render_builder_preview()
                def _on_row_gap_slider(v=100, cid=container_id, lbl: QLabel = row_gap_val):
                    idx = _container_index_by_id(cid)
                    if idx < 0:
                        return
                    header_layout_data[idx]["rowGapPct"] = int(v)
                    lbl.setText(f"{int(v)}%")
                    _render_builder_preview()
                height_slider.valueChanged.connect(_on_height_slider)
                row_gap_slider.valueChanged.connect(_on_row_gap_slider)
                QTimer.singleShot(0, lambda s=height_slider: s.valueChanged.emit(s.value()))
                QTimer.singleShot(0, lambda s=row_gap_slider: s.valueChanged.emit(s.value()))

                cols = container.get("columns") if isinstance(container, dict) else []
                cols = cols if isinstance(cols, list) else []
                if not cols:
                    empty = QLabel("No columns yet. Press Add Columns.")
                    empty.setStyleSheet("QLabel { color:#6B7280; font-size:11px; }")
                    cl.addWidget(empty)
                else:
                    row = QHBoxLayout()
                    row.setSpacing(8)
                    for j, col in enumerate(cols):
                        if not isinstance(col, dict):
                            col = {"type": "text", "content": ""}
                            cols[j] = col
                        box = QFrame()
                        box.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #E4E6EC; border-radius:10px; }")
                        bl = QVBoxLayout(box)
                        bl.setContentsMargins(6, 6, 6, 6)
                        bl.setSpacing(6)
                        col_title = QLabel(f"Column {j + 1}")
                        bl.addWidget(col_title)
                        typ = QComboBox()
                        typ.addItems(["Textbox", "Logo", "Empty"])
                        map_ui = {"text": "Textbox", "logo": "Logo", "empty": "Empty"}
                        typ.setCurrentText(map_ui.get(str(col.get("type") or "text").lower(), "Textbox"))
                        bl.addWidget(typ)
                        txt = QTextEdit()
                        txt.setPlaceholderText("Type text...")
                        txt.setFixedHeight(88)
                        txt.setAcceptRichText(True)
                        txt.setStyleSheet("QTextEdit { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:8px; padding:4px; }")
                        seed_content = str(col.get("content") or "")
                        if "<html" in seed_content.lower() or "<body" in seed_content.lower():
                            txt.setHtml(seed_content)
                        else:
                            txt.setPlainText(seed_content)
                        _register_editor(txt)
                        bl.addWidget(txt)
                        hint = QLabel("Logo widget")
                        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
                        hint.setFixedHeight(88)
                        hint.setStyleSheet("QLabel { background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:7px; color:#64748B; font-size:11px; font-weight:700; }")
                        bl.addWidget(hint)
                        summary_lbl = QLabel(f"{fallback_name} - Column {j + 1}")
                        summary_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                        summary_lbl.setFixedHeight(58)
                        summary_lbl.setStyleSheet("QLabel { background:#FFFFFF; border:1px dashed #CBD5E1; border-radius:8px; color:#334155; font-size:11px; font-weight:700; }")
                        bl.addWidget(summary_lbl)

                        def _apply_vis(tw: QComboBox = typ, text_w: QTextEdit = txt, hint_w: QLabel = hint):
                            if not show_detail:
                                tw.setVisible(False)
                                text_w.setVisible(False)
                                hint_w.setVisible(False)
                                summary_lbl.setVisible(True)
                                return
                            key = tw.currentText().strip().lower()
                            tw.setVisible(True)
                            summary_lbl.setVisible(False)
                            text_w.setVisible(key == "textbox")
                            hint_w.setVisible(key == "logo")
                        _apply_vis()

                        def _on_type(
                            _=0,
                            cid=container_id,
                            k=j,
                            tw: QComboBox = typ,
                            text_w: QTextEdit = txt,
                            hint_w: QLabel = hint,
                        ):
                            mapping = {"textbox": "text", "logo": "logo", "empty": "empty"}
                            i = _container_index_by_id(cid)
                            if i < 0:
                                return
                            header_layout_data[i]["columns"][k]["type"] = mapping.get(tw.currentText().strip().lower(), "text")
                            _apply_vis(tw, text_w, hint_w)
                            _render_builder_preview()

                        def _on_txt(cid=container_id, k=j, text_w: QTextEdit = txt):
                            i = _container_index_by_id(cid)
                            if i < 0:
                                return
                            header_layout_data[i]["columns"][k]["content"] = str(text_w.toHtml() or "")
                            _render_builder_preview()
                        typ.currentIndexChanged.connect(_on_type)
                        txt.textChanged.connect(_on_txt)
                        row.addWidget(box, 1)
                    cl.addLayout(row)
                item = QListWidgetItem()
                item.setData(Qt.ItemDataRole.UserRole, container_id)
                item.setFlags(
                    Qt.ItemFlag.ItemIsEnabled
                    | Qt.ItemFlag.ItemIsSelectable
                    | Qt.ItemFlag.ItemIsDragEnabled
                )
                item.setSizeHint(card.sizeHint())
                header_list.addItem(item)
                header_list.setItemWidget(item, card)

        def _container_index_by_id_f(container_id: str) -> int:
            cid = str(container_id or "").strip()
            if not cid:
                return -1
            for i, row in enumerate(footer_layout_data):
                if str((row or {}).get("__id") or "").strip() == cid:
                    return i
            return -1

        def _find_container(section: str, container_id: str):
            cid = str(container_id or "").strip()
            if not cid:
                return None, -1
            if section == "footer":
                idx = _container_index_by_id_f(cid)
                if idx >= 0:
                    return footer_layout_data[idx], idx
                return None, -1
            idx = _container_index_by_id(cid)
            if idx >= 0:
                return header_layout_data[idx], idx
            return None, -1

        def _ensure_selection() -> None:
            section = str(selected_target.get("section") or "header")
            cid = str(selected_target.get("container_id") or "").strip()
            col_idx = selected_target.get("column_idx")
            container, _idx = _find_container(section, cid)
            if container is None:
                if header_layout_data:
                    selected_target["section"] = "header"
                    selected_target["container_id"] = str((header_layout_data[0] or {}).get("__id") or "")
                    selected_target["column_idx"] = 0 if isinstance((header_layout_data[0] or {}).get("columns"), list) and (header_layout_data[0] or {}).get("columns") else None
                    return
                if footer_layout_data:
                    selected_target["section"] = "footer"
                    selected_target["container_id"] = str((footer_layout_data[0] or {}).get("__id") or "")
                    selected_target["column_idx"] = 0 if isinstance((footer_layout_data[0] or {}).get("columns"), list) and (footer_layout_data[0] or {}).get("columns") else None
                    return
                selected_target["container_id"] = ""
                selected_target["column_idx"] = None
                return
            cols = container.get("columns") if isinstance(container, dict) else []
            cols = cols if isinstance(cols, list) else []
            if col_idx is None:
                return
            try:
                k = int(col_idx)
            except Exception:
                selected_target["column_idx"] = None
                return
            if k < 0 or k >= len(cols):
                selected_target["column_idx"] = (0 if cols else None)

        def _select_target(section: str, container_id: str, column_idx):
            selected_target["section"] = "footer" if str(section or "").strip().lower() == "footer" else "header"
            selected_target["container_id"] = str(container_id or "").strip()
            selected_target["column_idx"] = None if column_idx is None else int(column_idx)
            _ensure_selection()
            _render_container_cards()
            _render_container_cards_f()
            _refresh_inspector()

        def _refresh_inspector() -> None:
            inspector_sync["on"] = True
            _ensure_selection()
            section = str(selected_target.get("section") or "header")
            cid = str(selected_target.get("container_id") or "").strip()
            col_idx = selected_target.get("column_idx")
            container, _idx = _find_container(section, cid)
            enabled = isinstance(container, dict)
            selected_scope_lbl.setText(
                f"Selected: {section.title()} / {('Container' if col_idx is None else f'Column {int(col_idx) + 1}')}"
                if enabled
                else "Selected: None"
            )
            for w in (selected_name_edit, selected_columns_spin, selected_bg_edit, selected_height_slider, selected_pad_spin, selected_rowgap_slider, selected_col_type, selected_col_text, selected_remove_btn):
                w.setEnabled(enabled)
            if not enabled:
                inspector_sync["on"] = False
                return
            container_name = str(container.get("name") or "").strip()
            selected_name_edit.setText(container_name)
            cols = container.get("columns") if isinstance(container, dict) else []
            cols = cols if isinstance(cols, list) else []
            selected_columns_spin.setValue(max(1, len(cols) or 1))
            selected_bg_edit.setText(str(container.get("bgColor") or ""))
            selected_height_slider.setValue(int(container.get("heightPx") or 0))
            selected_pad_spin.setValue(int(container.get("padY") or 2))
            selected_rowgap_slider.setValue(int(container.get("rowGapPct") or 100))
            has_col = (col_idx is not None and isinstance(cols, list) and 0 <= int(col_idx) < len(cols))
            selected_col_type.setEnabled(enabled and has_col)
            selected_col_text.setEnabled(enabled and has_col)
            if has_col:
                col = cols[int(col_idx)] if isinstance(cols[int(col_idx)], dict) else {"type": "text", "content": ""}
                map_ui = {"text": "Textbox", "logo": "Logo", "empty": "Empty"}
                selected_col_type.setCurrentText(map_ui.get(str(col.get("type") or "text").lower(), "Textbox"))
                seed_content = str(col.get("content") or "")
                if "<html" in seed_content.lower() or "<body" in seed_content.lower():
                    selected_col_text.setHtml(seed_content)
                else:
                    selected_col_text.setPlainText(seed_content)
            else:
                selected_col_type.setCurrentText("Textbox")
                selected_col_text.setPlainText("")
            inspector_sync["on"] = False

        def _sync_layout_from_list_order_f() -> None:
            ids: list[str] = []
            for i in range(footer_list.count()):
                it = footer_list.item(i)
                ids.append(str(it.data(Qt.ItemDataRole.UserRole) or ""))
            if not ids:
                return
            by_id = {
                str((row or {}).get("__id") or ""): row
                for row in footer_layout_data
                if isinstance(row, dict) and str((row or {}).get("__id") or "")
            }
            reordered: list[dict] = [by_id[cid] for cid in ids if cid in by_id]
            if len(reordered) == len(footer_layout_data):
                footer_layout_data[:] = reordered

        def _remove_container_f(container_id: str):
            idx = _container_index_by_id_f(container_id)
            if idx >= 0:
                footer_layout_data.pop(idx)
                _render_container_cards_f()
                _render_builder_preview()

        def _set_column_count_f(container_id: str):
            idx = _container_index_by_id_f(container_id)
            if idx < 0:
                return
            current = footer_layout_data[idx]
            old_cols = current.get("columns") if isinstance(current, dict) else []
            old_cols = old_cols if isinstance(old_cols, list) else []
            default_count = len(old_cols) if old_cols else 2
            count, ok = QInputDialog.getInt(dlg, "Add Columns", "Number of columns (1-6):", default_count, 1, 6, 1)
            if not ok:
                return
            new_cols: list[dict] = []
            for i in range(count):
                if i < len(old_cols) and isinstance(old_cols[i], dict):
                    new_cols.append(
                        {
                            "type": str(old_cols[i].get("type") or "text"),
                            "content": str(old_cols[i].get("content") or ""),
                            "rowGapPct": int(old_cols[i].get("rowGapPct") or 0),
                        }
                    )
                else:
                    new_cols.append({"type": "text", "content": "", "rowGapPct": 0})
            current["columns"] = new_cols
            _render_container_cards_f()
            _render_builder_preview()

        def _add_container_f():
            new_id = uuid.uuid4().hex
            footer_layout_data.append({"__id": new_id, "name": "", "columns": [], "collapsed": False})
            _render_container_cards_f()
            _select_target("footer", new_id, None)
            _render_builder_preview()

        def _render_container_cards_f():
            footer_list.clear()
            footer_title_inputs.clear()
            sel_section = str(selected_target.get("section") or "header")
            sel_cid = str(selected_target.get("container_id") or "")
            sel_col = selected_target.get("column_idx")
            for cidx, container in enumerate(footer_layout_data):
                if not isinstance(container, dict):
                    continue
                container_id = str(container.get("__id") or "").strip() or uuid.uuid4().hex
                container["__id"] = container_id
                container_name = str(container.get("name") or "").strip() or f"Container {cidx + 1}"
                is_collapsed = bool(container.get("collapsed", False))
                container["collapsed"] = is_collapsed
                card = QFrame()
                card.setStyleSheet("QFrame { background: transparent; border: none; }")
                cl = QVBoxLayout(card)
                cl.setContentsMargins(0, 0, 0, 0)
                cl.setSpacing(2)
                is_container_selected = (sel_section == "footer" and sel_cid == container_id and sel_col is None)
                head_border = theme if is_container_selected else "#D1D5DB"
                head = QFrame()
                head.setStyleSheet(
                    f"QFrame {{ background:#FFFFFF; border:1px solid {head_border}; border-radius:0; }}"
                )
                head_l = QHBoxLayout(head)
                head_l.setContentsMargins(8, 4, 8, 4)
                head_l.setSpacing(6)
                title_btn = QPushButton(container_name)
                title_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                title_btn.setStyleSheet(
                    "QPushButton { background:transparent; border:none; color:#1F2937; font-size:11px; font-weight:800; text-align:left; }"
                    "QPushButton:hover { color:#0F2A4A; }"
                )
                title_btn.clicked.connect(lambda _=False, cid=container_id: _select_target("footer", cid, None))
                head_l.addWidget(title_btn, 1)
                toggle_btn = QToolButton()
                try:
                    icon = self.style().standardIcon(
                        QStyle.StandardPixmap.SP_ArrowRight if is_collapsed else QStyle.StandardPixmap.SP_ArrowDown
                    )
                    toggle_btn.setIcon(icon)
                except Exception:
                    toggle_btn.setText(">" if is_collapsed else "v")
                toggle_btn.setToolTip("Expand container" if is_collapsed else "Collapse container")
                toggle_btn.setFixedSize(22, 22)
                toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                toggle_btn.setStyleSheet(
                    "QToolButton { background:#F3F4F6; border:1px solid #94A3B8; border-radius:0; color:#0F172A; font-size:10px; font-weight:800; padding:0; }"
                    "QToolButton:hover { background:#E8EDF5; }"
                )
                def _toggle_container_collapsed_f(_=False, cid=container_id):
                    i = _container_index_by_id_f(cid)
                    if i < 0:
                        return
                    cur = bool(footer_layout_data[i].get("collapsed", False))
                    footer_layout_data[i]["collapsed"] = not cur
                    _render_container_cards_f()
                    _render_builder_preview()
                toggle_btn.clicked.connect(_toggle_container_collapsed_f)
                head_l.addWidget(toggle_btn, 0)
                cl.addWidget(head)
                cols = container.get("columns") if isinstance(container, dict) else []
                cols = cols if isinstance(cols, list) else []
                try:
                    pad_y_preview = int(container.get("padY") or 1)
                except Exception:
                    pad_y_preview = 1
                pad_y_preview = max(-40, min(40, pad_y_preview))
                row_wrap = QWidget()
                row = QHBoxLayout(row_wrap)
                row.setContentsMargins(0, 0, 0, 0)
                row.setSpacing(0)
                if cols:
                    for j, col in enumerate(cols):
                        col_name = _column_preview_text(col if isinstance(col, dict) else {}, j)
                        is_selected = (sel_section == "footer" and sel_cid == container_id and sel_col == j)
                        border_color = theme if is_selected else "#D1D5DB"
                        left_border = "none" if j > 0 else f"1px solid {border_color}"
                        col_box = QFrame()
                        col_box.setCursor(Qt.CursorShape.PointingHandCursor)
                        col_box.setStyleSheet(
                            f"QFrame {{ background:#FFFFFF; border-top:1px solid {border_color}; border-right:1px solid {border_color}; border-bottom:1px solid {border_color}; border-left:{left_border}; border-radius:0; }}"
                        )
                        col_lay = QVBoxLayout(col_box)
                        col_lay.setContentsMargins(3, 0, 3, 0)
                        col_lay.setSpacing(0)
                        col_label = QLabel()
                        col_label.setTextFormat(Qt.TextFormat.RichText)
                        col_label.setWordWrap(True)
                        col_label.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)
                        col_label.setContentsMargins(0, 0, 0, 0)
                        col_label.setTextInteractionFlags(Qt.TextInteractionFlag.NoTextInteraction)
                        col_label.setStyleSheet(
                            "QLabel { color:#334155; background:transparent; border:none; margin:0; padding:0;"
                            f" margin-top:{pad_y_preview}px; margin-bottom:{pad_y_preview}px; }}"
                        )
                        col_label.setText(col_name)
                        col_lay.addWidget(col_label)
                        click_filter = _ColumnClickFilter(dlg, lambda cid=container_id, k=j: _select_target("footer", cid, k))
                        _click_filters.append(click_filter)
                        col_box.installEventFilter(click_filter)
                        col_label.installEventFilter(click_filter)
                        row.addWidget(col_box, 1)
                else:
                    empty = QLabel("No columns")
                    empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
                    empty.setStyleSheet("QLabel { border:1px solid #D1D5DB; color:#6B7280; padding:8px; font-size:11px; }")
                    row.addWidget(empty, 1)
                row_wrap.setVisible(not is_collapsed)
                cl.addWidget(row_wrap)
                item = QListWidgetItem()
                item.setData(Qt.ItemDataRole.UserRole, container_id)
                item.setFlags(
                    Qt.ItemFlag.ItemIsEnabled
                    | Qt.ItemFlag.ItemIsSelectable
                    | Qt.ItemFlag.ItemIsDragEnabled
                )
                card.layout().activate()
                card.adjustSize()
                item.setSizeHint(card.sizeHint())
                footer_list.addItem(item)
                footer_list.setItemWidget(item, card)
                row_wrap.updateGeometry()
            _fit_list_height(footer_list)
            footer_list.doItemsLayout()
            footer_list.updateGeometries()
            return
            show_detail = bool(detail_mode.get("show"))
            for cidx, container in enumerate(footer_layout_data):
                if not isinstance(container, dict):
                    continue
                container_id = str(container.get("__id") or "").strip() or uuid.uuid4().hex
                container["__id"] = container_id
                card = QFrame()
                card.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:12px; }")
                cl = QVBoxLayout(card)
                cl.setContentsMargins(8, 8, 8, 8)
                cl.setSpacing(8)
                top = QHBoxLayout()
                container_name = str(container.get("name") or "").strip()
                fallback_name = f"Container {cidx + 1}"
                title_edit = QLineEdit(container_name or fallback_name)
                title_edit.setFixedHeight(24)
                title_edit.setFixedWidth(180)
                title_edit.setStyleSheet(
                    "QLineEdit { background:#F7F8FA; border:1px solid #E5E7EC; color:#20304A; font-size:12px; font-weight:800; padding:0 8px; border-radius:7px; }"
                    "QLineEdit:focus { background:#FFFFFF; border:1px solid #CBD5E1; }"
                )
                title_edit.setReadOnly(not show_detail)
                top.addWidget(title_edit)
                footer_title_inputs[container_id] = title_edit
                add_cols = QPushButton("Add Columns")
                add_cols.setCursor(Qt.CursorShape.PointingHandCursor)
                add_cols.setFixedHeight(24)
                add_cols.setStyleSheet(
                    f"QPushButton {{ background:{theme}; color:#FFFFFF; border:none; border-radius:7px; padding:0 8px; font-size:11px; font-weight:700; }}"
                    "QPushButton:hover { background:#1F4FBF; }"
                )
                add_cols.clicked.connect(lambda _=False, cid=container_id: _set_column_count_f(cid))
                top.addWidget(add_cols)
                color_edit = QLineEdit()
                color_edit.setPlaceholderText("#FFFFFF")
                color_edit.setFixedHeight(24)
                color_edit.setFixedWidth(90)
                color_edit.setText(str(container.get("bgColor") or ""))
                color_edit.setStyleSheet(
                    "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; padding:0 8px; font-size:11px; color:#111827; }"
                )
                height_spin = QSpinBox()
                height_spin.setRange(0, 2000)
                height_spin.setValue(int(container.get("heightPx") or 0))
                height_spin.setFixedHeight(24)
                height_spin.setFixedWidth(66)
                height_spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
                height_spin.setAlignment(Qt.AlignmentFlag.AlignCenter)
                height_spin.setStyleSheet("QSpinBox { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; font-size:11px; color:#111827; }")
                row_gap_spin = QSpinBox()
                row_gap_spin.setRange(60, 220)
                row_gap_spin.setValue(int(container.get("rowGapPct") or 100))
                row_gap_spin.setSuffix("%")
                row_gap_spin.setFixedHeight(24)
                row_gap_spin.setFixedWidth(74)
                row_gap_spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
                row_gap_spin.setAlignment(Qt.AlignmentFlag.AlignCenter)
                row_gap_spin.setStyleSheet("QSpinBox { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; font-size:11px; color:#111827; }")
                rem = QPushButton("Remove")
                rem.setCursor(Qt.CursorShape.PointingHandCursor)
                rem.setFixedHeight(24)
                rem.setStyleSheet(
                    "QPushButton { background:#FDECEC; color:#C62828; border:1px solid #F2B8B5; border-radius:7px; padding:0 8px; font-size:11px; font-weight:700; }"
                    "QPushButton:hover { background:#FAD8D6; }"
                )
                rem.clicked.connect(lambda _=False, cid=container_id: _remove_container_f(cid))
                top.addWidget(rem)
                color_preview = QFrame()
                color_preview.setFixedSize(16, 16)
                color_preview.setStyleSheet("QFrame { background: transparent; border:1px solid #CBD5E1; border-radius:4px; }")
                top.addWidget(color_preview)
                top.addStretch(1)
                for w in (add_cols, rem, color_preview):
                    w.setVisible(show_detail)
                cl.addLayout(top)
                def _on_name_edit_f(cid=container_id, te: QLineEdit = title_edit):
                    i = _container_index_by_id_f(cid)
                    if i < 0:
                        return
                    nm = str(te.text() or "").strip()
                    footer_layout_data[i]["name"] = nm
                    if cid:
                        container_name_map[cid] = nm

                title_edit.textChanged.connect(_on_name_edit_f)
                title_edit.editingFinished.connect(_save_template_quiet)
                opts = QHBoxLayout()
                opts.setSpacing(6)
                color_lbl = QLabel("Color")
                color_lbl.setStyleSheet("QLabel { color:#475569; font-size:11px; font-weight:700; }")
                opts.addWidget(color_lbl)
                opts.addWidget(color_edit)
                h_lbl = QLabel("Height")
                h_lbl.setStyleSheet("QLabel { color:#475569; font-size:11px; font-weight:700; }")
                opts.addWidget(h_lbl)
                height_slider = QSlider(Qt.Orientation.Horizontal)
                height_slider.setRange(-2000, 2000)
                height_slider.setValue(int(container.get("heightPx") or 0))
                height_slider.setFixedWidth(82)
                height_slider.setStyleSheet(
                    "QSlider::groove:horizontal { border:1px solid #D9E0EA; height:6px; background:#F3F4F6; border-radius:3px; }"
                    "QSlider::sub-page:horizontal { background:#BFD3FF; border-radius:3px; }"
                    "QSlider::handle:horizontal { background:#2F6BFF; border:1px solid #1F4FBF; width:10px; margin:-4px 0; border-radius:5px; }"
                )
                opts.addWidget(height_slider)
                height_val = QLabel("0")
                height_val.setFixedWidth(34)
                height_val.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                height_val.setStyleSheet("QLabel { color:#475569; font-size:10px; font-weight:700; }")
                opts.addWidget(height_val)
                rg_lbl = QLabel("Row Gap")
                rg_lbl.setStyleSheet("QLabel { color:#475569; font-size:11px; font-weight:700; }")
                opts.addWidget(rg_lbl)
                row_gap_slider = QSlider(Qt.Orientation.Horizontal)
                row_gap_slider.setRange(60, 220)
                row_gap_slider.setValue(int(container.get("rowGapPct") or 100))
                row_gap_slider.setFixedWidth(82)
                row_gap_slider.setStyleSheet(
                    "QSlider::groove:horizontal { border:1px solid #D9E0EA; height:6px; background:#F3F4F6; border-radius:3px; }"
                    "QSlider::sub-page:horizontal { background:#BFD3FF; border-radius:3px; }"
                    "QSlider::handle:horizontal { background:#2F6BFF; border:1px solid #1F4FBF; width:10px; margin:-4px 0; border-radius:5px; }"
                )
                opts.addWidget(row_gap_slider)
                row_gap_val = QLabel("100%")
                row_gap_val.setFixedWidth(40)
                row_gap_val.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
                row_gap_val.setStyleSheet("QLabel { color:#475569; font-size:10px; font-weight:700; }")
                opts.addWidget(row_gap_val)
                opts.addStretch(1)
                for w in (color_lbl, color_edit, h_lbl, height_slider, height_val, rg_lbl, row_gap_slider, row_gap_val):
                    w.setVisible(show_detail)
                cl.addLayout(opts)

                def _on_container_color_edit_f(
                    cid=container_id,
                    ce: QLineEdit = color_edit,
                    cp: QFrame = color_preview,
                ):
                    i = _container_index_by_id_f(cid)
                    if i < 0:
                        return
                    raw = str(ce.text() or "").strip()
                    if raw and not raw.startswith("#"):
                        raw = f"#{raw}"
                    norm = ""
                    if raw:
                        if len(raw) == 4:
                            try:
                                int(raw[1:], 16)
                                norm = "#" + "".join(ch * 2 for ch in raw[1:]).upper()
                            except Exception:
                                norm = ""
                        elif len(raw) == 7:
                            try:
                                int(raw[1:], 16)
                                norm = raw.upper()
                            except Exception:
                                norm = ""
                    if norm:
                        footer_layout_data[i]["bgColor"] = norm
                        ce.setText(norm)
                        cp.setStyleSheet(f"QFrame {{ background:{norm}; border:1px solid #94A3B8; border-radius:4px; }}")
                        ce.setStyleSheet(
                            "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; padding:0 8px; font-size:11px; color:#111827; }"
                        )
                    else:
                        footer_layout_data[i]["bgColor"] = ""
                        cp.setStyleSheet("QFrame { background: transparent; border:1px solid #CBD5E1; border-radius:4px; }")
                        if raw:
                            ce.setStyleSheet(
                                "QLineEdit { background:#FFF1F2; border:1px solid #FCA5A5; border-radius:7px; padding:0 8px; font-size:11px; color:#991B1B; }"
                            )
                        else:
                            ce.setStyleSheet(
                                "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:7px; padding:0 8px; font-size:11px; color:#111827; }"
                            )
                    _render_builder_preview()

                color_edit.editingFinished.connect(_on_container_color_edit_f)
                QTimer.singleShot(0, _on_container_color_edit_f)
                def _on_height_slider_f(v=0, cid=container_id, lbl: QLabel = height_val):
                    idx = _container_index_by_id_f(cid)
                    if idx < 0:
                        return
                    footer_layout_data[idx]["heightPx"] = int(v)
                    lbl.setText(str(int(v)))
                    _render_builder_preview()
                def _on_row_gap_slider_f(v=100, cid=container_id, lbl: QLabel = row_gap_val):
                    idx = _container_index_by_id_f(cid)
                    if idx < 0:
                        return
                    footer_layout_data[idx]["rowGapPct"] = int(v)
                    lbl.setText(f"{int(v)}%")
                    _render_builder_preview()
                height_slider.valueChanged.connect(_on_height_slider_f)
                row_gap_slider.valueChanged.connect(_on_row_gap_slider_f)
                QTimer.singleShot(0, lambda s=height_slider: s.valueChanged.emit(s.value()))
                QTimer.singleShot(0, lambda s=row_gap_slider: s.valueChanged.emit(s.value()))

                cols = container.get("columns") if isinstance(container, dict) else []
                cols = cols if isinstance(cols, list) else []
                if not cols:
                    empty = QLabel("No columns yet. Press Add Columns.")
                    empty.setStyleSheet("QLabel { color:#6B7280; font-size:11px; }")
                    cl.addWidget(empty)
                else:
                    row = QHBoxLayout()
                    row.setSpacing(8)
                    for j, col in enumerate(cols):
                        if not isinstance(col, dict):
                            col = {"type": "text", "content": ""}
                            cols[j] = col
                        box = QFrame()
                        box.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #E4E6EC; border-radius:10px; }")
                        bl = QVBoxLayout(box)
                        bl.setContentsMargins(6, 6, 6, 6)
                        bl.setSpacing(6)
                        col_title = QLabel(f"Column {j + 1}")
                        bl.addWidget(col_title)
                        typ = QComboBox()
                        typ.addItems(["Textbox", "Logo", "Empty"])
                        map_ui = {"text": "Textbox", "logo": "Logo", "empty": "Empty"}
                        typ.setCurrentText(map_ui.get(str(col.get("type") or "text").lower(), "Textbox"))
                        bl.addWidget(typ)
                        txt = QTextEdit()
                        txt.setPlaceholderText("Type text...")
                        txt.setFixedHeight(88)
                        txt.setAcceptRichText(True)
                        txt.setStyleSheet("QTextEdit { background:#FFFFFF; border:1px solid #E4E6EC; border-radius:8px; padding:4px; }")
                        seed_content = str(col.get("content") or "")
                        if "<html" in seed_content.lower() or "<body" in seed_content.lower():
                            txt.setHtml(seed_content)
                        else:
                            txt.setPlainText(seed_content)
                        _register_editor(txt)
                        bl.addWidget(txt)
                        hint = QLabel("Logo widget")
                        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
                        hint.setFixedHeight(88)
                        hint.setStyleSheet("QLabel { background:#F8FAFC; border:1px dashed #CBD5E1; border-radius:7px; color:#64748B; font-size:11px; font-weight:700; }")
                        bl.addWidget(hint)
                        summary_lbl = QLabel(f"{fallback_name} - Column {j + 1}")
                        summary_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                        summary_lbl.setFixedHeight(58)
                        summary_lbl.setStyleSheet("QLabel { background:#FFFFFF; border:1px dashed #CBD5E1; border-radius:8px; color:#334155; font-size:11px; font-weight:700; }")
                        bl.addWidget(summary_lbl)

                        def _apply_vis_f(tw: QComboBox = typ, text_w: QTextEdit = txt, hint_w: QLabel = hint):
                            if not show_detail:
                                tw.setVisible(False)
                                text_w.setVisible(False)
                                hint_w.setVisible(False)
                                summary_lbl.setVisible(True)
                                return
                            key = tw.currentText().strip().lower()
                            tw.setVisible(True)
                            summary_lbl.setVisible(False)
                            text_w.setVisible(key == "textbox")
                            hint_w.setVisible(key == "logo")
                        _apply_vis_f()

                        def _on_type_f(
                            _=0,
                            cid=container_id,
                            k=j,
                            tw: QComboBox = typ,
                            text_w: QTextEdit = txt,
                            hint_w: QLabel = hint,
                        ):
                            mapping = {"textbox": "text", "logo": "logo", "empty": "empty"}
                            i = _container_index_by_id_f(cid)
                            if i < 0:
                                return
                            footer_layout_data[i]["columns"][k]["type"] = mapping.get(tw.currentText().strip().lower(), "text")
                            _apply_vis_f(tw, text_w, hint_w)
                            _render_builder_preview()

                        def _on_txt_f(cid=container_id, k=j, text_w: QTextEdit = txt):
                            i = _container_index_by_id_f(cid)
                            if i < 0:
                                return
                            footer_layout_data[i]["columns"][k]["content"] = str(text_w.toHtml() or "")
                            _render_builder_preview()
                        typ.currentIndexChanged.connect(_on_type_f)
                        txt.textChanged.connect(_on_txt_f)
                        row.addWidget(box, 1)
                    cl.addLayout(row)
                item = QListWidgetItem()
                item.setData(Qt.ItemDataRole.UserRole, container_id)
                item.setFlags(
                    Qt.ItemFlag.ItemIsEnabled
                    | Qt.ItemFlag.ItemIsSelectable
                    | Qt.ItemFlag.ItemIsDragEnabled
                )
                item.setSizeHint(card.sizeHint())
                footer_list.addItem(item)
                footer_list.setItemWidget(item, card)

        add_container_btn.clicked.connect(_add_container)
        if header_list.model() is not None:
            header_list.model().rowsMoved.connect(lambda *_: (_sync_layout_from_list_order(), _render_container_cards(), _render_builder_preview()))
        footer_add_container_btn.clicked.connect(_add_container_f)
        if footer_list.model() is not None:
            footer_list.model().rowsMoved.connect(lambda *_: (_sync_layout_from_list_order_f(), _render_container_cards_f(), _render_builder_preview()))
        add_header_btn_right.clicked.connect(_add_container)
        add_footer_btn_right.clicked.connect(_add_container_f)

        def _normalize_color_text(raw_text: str) -> str:
            raw = str(raw_text or "").strip()
            if not raw:
                return ""
            if not raw.startswith("#"):
                raw = f"#{raw}"
            if len(raw) == 4:
                try:
                    int(raw[1:], 16)
                    return "#" + "".join(ch * 2 for ch in raw[1:]).upper()
                except Exception:
                    return ""
            if len(raw) == 7:
                try:
                    int(raw[1:], 16)
                    return raw.upper()
                except Exception:
                    return ""
            return ""

        def _apply_inspector_to_model() -> None:
            if inspector_sync.get("on"):
                return
            section = str(selected_target.get("section") or "header")
            cid = str(selected_target.get("container_id") or "").strip()
            col_idx = selected_target.get("column_idx")
            container, _idx = _find_container(section, cid)
            if not isinstance(container, dict):
                return
            container["name"] = str(selected_name_edit.text() or "").strip()
            desired_cols = int(selected_columns_spin.value())
            cols = container.get("columns") if isinstance(container, dict) else []
            cols = list(cols) if isinstance(cols, list) else []
            while len(cols) < desired_cols:
                cols.append({"type": "text", "content": "", "rowGapPct": 0})
            if len(cols) > desired_cols:
                cols = cols[:desired_cols]
            container["columns"] = cols
            container["bgColor"] = _normalize_color_text(selected_bg_edit.text())
            container["heightPx"] = 0
            container["padY"] = int(selected_pad_spin.value())
            container["rowGapPct"] = int(selected_rowgap_slider.value())
            if col_idx is not None and 0 <= int(col_idx) < len(cols):
                c = cols[int(col_idx)]
                if not isinstance(c, dict):
                    c = {"type": "text", "content": ""}
                    cols[int(col_idx)] = c
                mapping = {"textbox": "text", "logo": "logo", "empty": "empty"}
                c["type"] = mapping.get(str(selected_col_type.currentText() or "").strip().lower(), "text")
                c["content"] = str(selected_col_text.toHtml() or "")
            _render_container_cards()
            _render_container_cards_f()
            _refresh_inspector()
            _render_builder_preview()

        selected_name_edit.editingFinished.connect(_apply_inspector_to_model)
        selected_columns_spin.valueChanged.connect(lambda _=0: _apply_inspector_to_model())
        selected_bg_edit.editingFinished.connect(_apply_inspector_to_model)
        selected_height_slider.valueChanged.connect(lambda _=0: _apply_inspector_to_model())
        selected_pad_spin.valueChanged.connect(lambda _=0: _apply_inspector_to_model())
        selected_rowgap_slider.valueChanged.connect(lambda _=0: _apply_inspector_to_model())
        selected_col_type.currentIndexChanged.connect(lambda _=0: _apply_inspector_to_model())
        selected_col_text.textChanged.connect(_apply_inspector_to_model)

        def _remove_selected_container() -> None:
            section = str(selected_target.get("section") or "header")
            cid = str(selected_target.get("container_id") or "").strip()
            if not cid:
                return
            if section == "footer":
                _remove_container_f(cid)
            else:
                _remove_container(cid)
            _ensure_selection()
            _refresh_inspector()

        selected_remove_btn.clicked.connect(_remove_selected_container)
        for key, btn in size_btns.items():
            btn.setChecked(key == seed_size)
            btn.clicked.connect(lambda _=False, k=key: (selected_size.__setitem__("name", k), _render_builder_preview()))
        def _set_zoom_value(value: int) -> None:
            zoom_state["factor"] = max(0.50, min(2.00, float(value) / 100.0))
            zoom_pct.setText(f"{int(value)}%")
            new_detail = bool(float(zoom_state.get("factor") or 1.0) >= 1.25)
            mode_changed = new_detail != bool(detail_mode.get("show"))
            detail_mode["show"] = new_detail
            _apply_sheet_editor_size()
            if mode_changed:
                _render_container_cards()
                _render_container_cards_f()
            _render_builder_preview()
            # Defer expensive inner reflow until zoom interaction pauses/releases.
            zoom_commit_timer.start(140)

        def _commit_zoom_layout() -> None:
            _render_container_cards()
            _render_container_cards_f()
            _refresh_inspector()
            _render_builder_preview()

        def _sync_footer_pin_layout() -> None:
            pin = bool(footer_pin_btn.isChecked())
            if pin:
                footer_spacer.setMinimumHeight(1)
                footer_spacer.setMaximumHeight(16777215)
                left_col.setStretchFactor(footer_spacer, 1)
            else:
                footer_spacer.setMinimumHeight(0)
                footer_spacer.setMaximumHeight(0)
                left_col.setStretchFactor(footer_spacer, 0)
        zoom_slider.valueChanged.connect(_set_zoom_value)
        zoom_slider.sliderReleased.connect(_commit_zoom_layout)
        zoom_commit_timer.timeout.connect(_commit_zoom_layout)
        zoom_out_btn.clicked.connect(lambda: zoom_slider.setValue(max(50, int(zoom_slider.value()) - 10)))
        zoom_in_btn.clicked.connect(lambda: zoom_slider.setValue(min(200, int(zoom_slider.value()) + 10)))
        margin_spin.valueChanged.connect(lambda _=0: _render_builder_preview())
        footer_pin_btn.toggled.connect(lambda _=False: (_sync_footer_pin_layout(), _render_builder_preview()))
        body_font_family.currentFontChanged.connect(lambda _=None: _render_builder_preview())
        body_font_size.valueChanged.connect(lambda _=0: _render_builder_preview())
        body_preview.textChanged.connect(_render_builder_preview)
        _render_container_cards()
        _render_container_cards_f()
        _refresh_inspector()
        _sync_footer_pin_layout()
        _set_zoom_value(zoom_slider.value())
        _render_builder_preview()
        QTimer.singleShot(0, _render_builder_preview)
        QTimer.singleShot(160, _render_builder_preview)

        actions = QHBoxLayout()
        actions.addStretch(1)
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setStyleSheet(
            "QPushButton { background:#EEF1F6; color:#44556D; border:none; border-radius:9px; padding:8px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#E3E8F0; }"
        )
        save_btn = QPushButton("Save Template")
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.setStyleSheet(
            "QPushButton { background:#DDF2E7; color:#1F6A3B; border:1px solid #BFE8CF; border-radius:9px; padding:8px 12px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#BEE6D0; border:1px solid #9ED6B8; color:#17552F; }"
        )
        actions.addWidget(cancel_btn)
        actions.addWidget(save_btn)
        root.addLayout(actions)

        cancel_btn.clicked.connect(dlg.reject)

        def _save():
            _sync_container_names_from_inputs()
            if self._save_company_quote_template(
                notify=True,
                header_html=_header_layout_to_html(header_layout_data),
                footer_html=_header_layout_to_html(footer_layout_data),
                header_layout=header_layout_data,
                footer_layout=footer_layout_data,
                page_size=str(selected_size.get("name") or "A4"),
                page_margin_mm=int(margin_spin.value()),
                footer_pin_bottom=bool(footer_pin_btn.isChecked()),
                body_font_family=str(body_font_family.currentFont().family() or "Segoe UI"),
                body_font_size_pt=int(body_font_size.value()),
                body_default_html=_body_default_html_from_editor(),
            ):
                dlg.accept()

        save_btn.clicked.connect(_save)

        self._open_quote_template_builders.append(dlg)

        def _cleanup_builder_dialog(*_):
            _save_template_quiet()
            try:
                self._open_quote_template_builders = [d for d in self._open_quote_template_builders if d is not dlg]
            except Exception:
                self._open_quote_template_builders = []

        dlg.finished.connect(_cleanup_builder_dialog)
        dlg.destroyed.connect(_cleanup_builder_dialog)
        dlg.show()
        dlg.raise_()
        dlg.activateWindow()

    def _save_company_quote_template(
        self,
        notify: bool = True,
        silent_invalid: bool = False,
        header_html: str | None = None,
        footer_html: str | None = None,
        header_layout: list[dict] | None = None,
        footer_layout: list[dict] | None = None,
        page_size: str | None = None,
        page_margin_mm: int | None = None,
        footer_pin_bottom: bool | None = None,
        body_font_family: str | None = None,
        body_font_size_pt: int | None = None,
        body_default_html: str | None = None,
    ) -> bool:
        company_id = getattr(self.router.session, "company_id", None)
        if not company_id:
            return False
        _ = silent_invalid
        h = str(header_html or "").strip()
        f = str(footer_html or "").strip()
        safe_layout = json.loads(json.dumps(header_layout or []))
        safe_footer_layout = json.loads(json.dumps(footer_layout or []))
        existing_name_map = (self._company or {}).get("quoteTemplateContainerNames")
        container_names = dict(existing_name_map) if isinstance(existing_name_map, dict) else {}
        for row in [*safe_layout, *safe_footer_layout]:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("__id") or "").strip()
            if not cid:
                continue
            nm = str(row.get("name") or "").strip()
            if nm:
                container_names[cid] = nm
        size = str(page_size or "A4").strip().upper()
        try:
            margin_mm = int(page_margin_mm if page_margin_mm is not None else (self._company or {}).get("quoteTemplateMarginMm") or 10)
        except Exception:
            margin_mm = 10
        margin_mm = max(0, min(80, margin_mm))
        pin_bottom = bool(footer_pin_bottom is True)
        bf = str(body_font_family or "Segoe UI").strip() or "Segoe UI"
        try:
            bsz = int(body_font_size_pt if body_font_size_pt is not None else (self._company or {}).get("quoteTemplateBodyFontSizePt") or 11)
        except Exception:
            bsz = 11
        bsz = max(6, min(72, bsz))
        bhtml = str(body_default_html if body_default_html is not None else (self._company or {}).get("quoteTemplateBodyDefaultHtml") or "").strip()
        if size not in {"A1", "A2", "A3", "A4"}:
            size = "A4"
        if not h or not f:
            if notify:
                QMessageBox.warning(self, "Quote Template", "Header and Footer are both required.")
            return False
        payload = {
            "quoteTemplatePath": "",
            "quoteTemplateHeaderPath": "",
            "quoteTemplateFooterPath": "",
            "quoteTemplateHeaderHtml": h,
            "quoteTemplateFooterHtml": f,
            "quoteTemplateHeaderLayout": safe_layout,
            "quoteTemplateHeaderLayoutJson": json.dumps(safe_layout),
            "quoteTemplateFooterLayout": safe_footer_layout,
            "quoteTemplateFooterLayoutJson": json.dumps(safe_footer_layout),
            "quoteTemplateContainerNames": container_names,
            "quoteTemplatePageSize": size,
            "quoteTemplateMarginMm": margin_mm,
            "quoteTemplateFooterPinBottom": pin_bottom,
            "quoteTemplateBodyFontFamily": bf,
            "quoteTemplateBodyFontSizePt": bsz,
            "quoteTemplateBodyDefaultHtml": bhtml,
        }
        try:
            self.app.company.update_company(company_id, payload)
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return False
        self._company.update(payload)
        self._load_company_quote_template()
        if hasattr(self, "_load_company_quote_extras_rows"):
            try:
                self._load_company_quote_extras_rows()
            except Exception:
                pass
        if notify:
            QMessageBox.information(self, "Saved", "Quote template updated.")
        return True

    def _company_sales_job_type_rows(self) -> list[dict]:
        raw = (self._company or {}).get("salesJobTypes")
        if not isinstance(raw, list):
            raw = []
        out: list[dict] = []
        seen: set[str] = set()
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            key = " ".join(name.lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            price = str(row.get("pricePerSheet") or row.get("price") or "").strip()
            out.append({"name": name, "pricePerSheet": price})
        return out

    def _company_sales_job_type_names(self) -> list[str]:
        rows = self._company_sales_job_type_rows()
        if rows:
            return [str(r.get("name") or "").strip() for r in rows if str(r.get("name") or "").strip()]
        return ["Melteca", "Woodgrain", "Lacquer (1 sided)", "Lacquer (2 sided)"]

    def _inventory_category_rows(self) -> list[dict]:
        raw = self._company.get("itemCategories")
        if not isinstance(raw, list):
            raw = self._company.get("salesItemCategories")
        if not isinstance(raw, list):
            raw = []
        out: list[dict] = []
        seen: set[str] = set()
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            color = self._normalize_hex(str(row.get("color") or "#7D99B3"), "#7D99B3")
            raw_subcategories = row.get("subcategories")
            subcategories: list[dict] = []
            seen_subs: set[str] = set()
            if isinstance(raw_subcategories, list):
                for sub in raw_subcategories:
                    if isinstance(sub, dict):
                        txt = str(sub.get("name") or "").strip()
                        sub_color = color
                    else:
                        txt = str(sub or "").strip()
                        sub_color = color
                    if not txt:
                        continue
                    k = txt.lower()
                    if k in seen_subs:
                        continue
                    seen_subs.add(k)
                    subcategories.append({"name": txt, "color": sub_color})
            elif isinstance(raw_subcategories, str):
                for part in str(raw_subcategories).split(","):
                    txt = str(part or "").strip()
                    if not txt:
                        continue
                    k = txt.lower()
                    if k in seen_subs:
                        continue
                    seen_subs.add(k)
                    subcategories.append({"name": txt, "color": color})
            out.append({"name": name, "color": color, "subcategories": subcategories})
        return out

    def _category_subcategories_value(self, row: int) -> list[dict]:
        table = self._company_item_categories_table
        if table is None:
            return []
        row_color = self._read_color_hex(table, row, 3, "#7D99B3")
        item = table.item(row, 2)
        data = item.data(Qt.ItemDataRole.UserRole) if isinstance(item, QTableWidgetItem) else None
        if not isinstance(data, list):
            return []
        out: list[dict] = []
        seen: set[str] = set()
        for entry in data:
            if isinstance(entry, dict):
                name = str(entry.get("name") or "").strip()
                color = row_color
            else:
                name = str(entry or "").strip()
                color = row_color
            if not name:
                continue
            k = name.lower()
            if k in seen:
                continue
            seen.add(k)
            out.append({"name": name, "color": color})
        return out

    def _set_category_subcategories_value(self, row: int, values: list[dict]) -> None:
        table = self._company_item_categories_table
        if table is None or row < 0 or row >= table.rowCount():
            return
        item = table.item(row, 2)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 2, item)
        item.setData(Qt.ItemDataRole.UserRole, values)
        # Keep backing text empty because this column is rendered with pill widgets.
        item.setText("")
        self._set_item_category_subcategories_button(row, values)

    def _set_item_category_subcategories_button(self, row: int, values: list[dict]) -> None:
        table = self._company_item_categories_table
        if table is None or row < 0 or row >= table.rowCount():
            return
        cat_color = self._read_color_hex(table, row, 3, "#7D99B3")
        base = QColor(cat_color if QColor(cat_color).isValid() else "#7D99B3")
        bg = base.lighter(175).name()
        border = base.lighter(130).name()
        fg = base.darker(170).name() if base.lightness() > 120 else "#FFFFFF"

        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)

        seen: set[str] = set()
        for entry in values:
            name = str((entry or {}).get("name") if isinstance(entry, dict) else entry or "").strip()
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            pill = QPushButton(name)
            pill.setCursor(Qt.CursorShape.PointingHandCursor)
            pill.setFixedHeight(22)
            pill.setStyleSheet(
                "QPushButton { "
                + f"background:{bg}; color:{fg}; border:1px solid {border}; border-radius:10px; padding:0 8px; font-size:11px; font-weight:700; "
                + "}"
                + "QPushButton:hover { background:#EEF2F7; }"
            )
            pill.setToolTip("Click to manage sub-categories")
            pill.clicked.connect(lambda _=False, rr=row, b=pill: self._open_item_category_subcategories_dropdown(rr, b))
            lay.addWidget(pill, 0)

        add_pill = QPushButton("+ Add")
        add_pill.setCursor(Qt.CursorShape.PointingHandCursor)
        add_pill.setFixedHeight(22)
        add_pill.setStyleSheet(
            "QPushButton { background:#DDF2E7; color:#1F6A3B; border:1px solid #BFE8CF; border-radius:10px; padding:0 8px; font-size:11px; font-weight:700; }"
            "QPushButton:hover { background:#BEE6D0; border-color:#9ED6B8; color:#17552F; }"
        )
        add_pill.clicked.connect(lambda _=False, rr=row: self._add_item_category_subcategory(rr))
        lay.addWidget(add_pill, 0)
        lay.addStretch(1)
        table.setCellWidget(row, 2, self._wrap_table_control(host))

    def _add_item_category_subcategory(self, row: int) -> None:
        table = self._company_item_categories_table
        if table is None or row < 0 or row >= table.rowCount():
            return
        name, ok = QInputDialog.getText(self, "Add Sub-category", "Sub-category name:")
        if not ok:
            return
        txt = str(name or "").strip()
        if not txt:
            return
        current = self._category_subcategories_value(row)
        if any(str((x or {}).get("name") or "").strip().lower() == txt.lower() for x in current if isinstance(x, dict)):
            return
        cat_color = self._read_color_hex(table, row, 3, "#7D99B3")
        current.append({"name": txt, "color": cat_color})
        self._set_category_subcategories_value(row, current)
        self._queue_company_autosave("item_categories", self._autosave_company_item_categories)

    def _remove_item_category_subcategory(self, row: int, name: str) -> None:
        table = self._company_item_categories_table
        if table is None or row < 0 or row >= table.rowCount():
            return
        target = str(name or "").strip().lower()
        if not target:
            return
        cat_color = self._read_color_hex(table, row, 3, "#7D99B3")
        current = self._category_subcategories_value(row)
        new_values: list[dict] = []
        for entry in current:
            if not isinstance(entry, dict):
                continue
            nm = str(entry.get("name") or "").strip()
            if not nm or nm.lower() == target:
                continue
            new_values.append({"name": nm, "color": cat_color})
        self._set_category_subcategories_value(row, new_values)
        self._queue_company_autosave("item_categories", self._autosave_company_item_categories)
    def _open_item_category_subcategories_dropdown(self, row: int, anchor: QPushButton) -> None:
        table = self._company_item_categories_table
        if table is None:
            return
        category_color = self._read_color_hex(table, row, 3, "#7D99B3")
        values = self._category_subcategories_value(row)
        dlg = QDialog(self, Qt.WindowType.Popup | Qt.WindowType.FramelessWindowHint)
        dlg.setObjectName("SubcategoryPopup")
        dlg.setStyleSheet("QDialog#SubcategoryPopup { background:#FFFFFF; border:1px solid #CBD5E1; border-radius:10px; }")
        lay = QVBoxLayout(dlg)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        listw = QListWidget()
        listw.setStyleSheet(
            "QListWidget { background:#FFFFFF; border:1px solid #E5E7EC; border-radius:8px; }"
            "QListWidget::item { padding:6px 8px; }"
        )
        for entry in values:
            item = QListWidgetItem(str(entry.get("name") or ""))
            item.setData(Qt.ItemDataRole.UserRole, {"name": str(entry.get("name") or ""), "color": category_color})
            item.setForeground(QBrush(QColor(category_color)))
            listw.addItem(item)
        lay.addWidget(listw, 1)

        add_row = QHBoxLayout()
        add_row.setSpacing(6)
        add_input = QLineEdit()
        add_input.setPlaceholderText("Add sub-category")
        add_input.setFixedHeight(26)
        add_input.setStyleSheet("QLineEdit { background:#F8FAFC; border:1px solid #E5E7EC; border-radius:8px; padding:0 8px; font-size:12px; }")
        add_btn = QPushButton("Add")
        add_btn.setFixedHeight(26)
        add_btn.setStyleSheet(
            "QPushButton { background:#E8F0FF; color:#2F6BFF; border:none; border-radius:8px; padding:0 10px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#DCE7FF; }"
        )
        add_row.addWidget(add_input, 1)
        add_row.addWidget(add_btn, 0)
        lay.addLayout(add_row)

        remove_btn = QPushButton("Remove Selected")
        remove_btn.setFixedHeight(26)
        remove_btn.setStyleSheet(
            "QPushButton { background:#FFF1F2; color:#B42318; border:1px solid #FECACA; border-radius:8px; padding:0 10px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#FFE4E6; }"
        )
        actions_row = QHBoxLayout()
        actions_row.setSpacing(6)
        actions_row.addWidget(remove_btn, 1)
        lay.addLayout(actions_row)

        def _apply_list_item_color(it: QListWidgetItem) -> None:
            if not isinstance(it, QListWidgetItem):
                return
            it.setData(Qt.ItemDataRole.UserRole, {"name": str(it.text() or "").strip(), "color": category_color})
            it.setForeground(QBrush(QColor(category_color)))

        def _sync_values() -> None:
            new_values: list[dict] = []
            seen_vals: set[str] = set()
            for i in range(listw.count()):
                it = listw.item(i)
                if not isinstance(it, QListWidgetItem):
                    continue
                name = str(it.text() or "").strip()
                if not name:
                    continue
                key = name.lower()
                if key in seen_vals:
                    continue
                seen_vals.add(key)
                new_values.append({"name": name, "color": category_color})
            self._set_category_subcategories_value(row, new_values)
            self._queue_company_autosave("item_categories", self._autosave_company_item_categories)

        def _add_subcategory() -> None:
            name = str(add_input.text() or "").strip()
            if not name:
                return
            if any(str(listw.item(i).text() or "").strip().lower() == name.lower() for i in range(listw.count())):
                add_input.clear()
                return
            it = QListWidgetItem(name)
            it.setData(Qt.ItemDataRole.UserRole, {"name": name, "color": category_color})
            _apply_list_item_color(it)
            listw.addItem(it)
            listw.setCurrentItem(it)
            add_input.clear()

        def _remove_selected() -> None:
            row_idx = listw.currentRow()
            if row_idx >= 0:
                listw.takeItem(row_idx)

        def _on_selected_item_changed(current: QListWidgetItem | None, _previous: QListWidgetItem | None) -> None:
            if not isinstance(current, QListWidgetItem):
                return
            _apply_list_item_color(current)

        for i in range(listw.count()):
            it = listw.item(i)
            if isinstance(it, QListWidgetItem):
                _apply_list_item_color(it)

        add_btn.clicked.connect(_add_subcategory)
        add_input.returnPressed.connect(_add_subcategory)
        remove_btn.clicked.connect(_remove_selected)
        listw.currentItemChanged.connect(_on_selected_item_changed)
        listw.itemDoubleClicked.connect(lambda _it: None)
        dlg.finished.connect(lambda _=0: _sync_values())

        origin = anchor.mapToGlobal(QPoint(0, anchor.height() + 2))
        dlg.resize(max(260, anchor.width() + 120), 250)
        dlg.move(origin)
        dlg.show()

    def _category_subcategory_list(self, category_name: str) -> list[str]:
        return [str(x.get("name") or "").strip() for x in self._category_subcategory_rows(category_name)]

    def _category_subcategory_rows(self, category_name: str) -> list[dict]:
        key = str(category_name or "").strip().lower()
        if not key:
            return []
        for row in self._inventory_category_rows():
            name = str((row or {}).get("name") or "").strip()
            if name.lower() != key:
                continue
            values = (row or {}).get("subcategories")
            if not isinstance(values, list):
                return []
            out: list[dict] = []
            seen: set[str] = set()
            for value in values:
                if isinstance(value, dict):
                    txt = str(value.get("name") or "").strip()
                    col = self._normalize_hex(str(value.get("color") or row.get("color") or "#7D99B3"), "#7D99B3")
                else:
                    txt = str(value or "").strip()
                    col = self._normalize_hex(str(row.get("color") or "#7D99B3"), "#7D99B3")
                if not txt:
                    continue
                k = txt.lower()
                if k in seen:
                    continue
                seen.add(k)
                out.append({"name": txt, "color": col})
            return out
        return []

    def _set_inventory_category_editor(self, row: int, text: str) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        combo = QComboBox()
        combo.setFixedHeight(24)
        combo.setStyleSheet(
            "QComboBox {"
            "background:#F7F8FA; border:1px solid #E5E7EC; border-radius: 8px;"
            "padding: 0 24px 0 8px; font-size: 12px; min-height: 24px; max-height: 24px;"
            "}"
            "QComboBox::drop-down {"
            "subcontrol-origin: padding; subcontrol-position: top right;"
            "width: 20px; border-left: 1px solid #E8EBF1;"
            "background: #F1F3F6; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
            "}"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
        )
        combo.addItem("")
        combo.setItemData(0, "", Qt.ItemDataRole.UserRole)
        for cat in self._inventory_category_rows():
            name = str(cat.get("name") or "").strip()
            color = str(cat.get("color") or "").strip()
            combo.addItem(name)
            idx = combo.count() - 1
            combo.setItemData(idx, color, Qt.ItemDataRole.UserRole)
        idx = combo.findText(str(text or "").strip(), Qt.MatchFlag.MatchFixedString)
        combo.setCurrentIndex(idx if idx >= 0 else 0)
        combo.currentIndexChanged.connect(lambda _=None, rr=row: self._inventory_category_changed(rr))
        table.setCellWidget(row, 2, self._wrap_table_control(combo))

    def _set_inventory_subcategory_editor(self, row: int, category_text: str, text: str) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        combo = QComboBox()
        combo.setFixedHeight(24)
        combo.setStyleSheet(
            "QComboBox {"
            "background:#F7F8FA; border:1px solid #E5E7EC; border-radius: 8px;"
            "padding: 0 24px 0 8px; font-size: 12px; min-height: 24px; max-height: 24px;"
            "}"
            "QComboBox::drop-down {"
            "subcontrol-origin: padding; subcontrol-position: top right;"
            "width: 20px; border-left: 1px solid #E8EBF1;"
            "background: #F1F3F6; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
            "}"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
        )
        combo.addItem("")
        values = self._category_subcategory_rows(category_text)
        for value in values:
            nm = str(value.get("name") or "").strip()
            col = self._normalize_hex(str(value.get("color") or "#7D99B3"), "#7D99B3")
            combo.addItem(nm)
            idx = combo.count() - 1
            combo.setItemData(idx, col, Qt.ItemDataRole.UserRole)
            combo.setItemData(idx, QBrush(QColor(col)), Qt.ItemDataRole.ForegroundRole)
        target = str(text or "").strip()
        if target and combo.findText(target, Qt.MatchFlag.MatchFixedString) < 0:
            combo.addItem(target)
            idx = combo.count() - 1
            cat_color = "#7D99B3"
            _cat_name, cat_color = self._inventory_category_value(row)
            combo.setItemData(idx, cat_color, Qt.ItemDataRole.UserRole)
            combo.setItemData(idx, QBrush(QColor(cat_color)), Qt.ItemDataRole.ForegroundRole)
        idx = combo.findText(target, Qt.MatchFlag.MatchFixedString)
        combo.setCurrentIndex(idx if idx >= 0 else 0)
        combo.currentIndexChanged.connect(lambda _=None: self._queue_company_autosave("inventory", self._autosave_company_inventory))
        table.setCellWidget(row, 3, self._wrap_table_control(combo))

    def _inventory_category_value(self, row: int) -> tuple[str, str]:
        table = self._company_inventory_table
        if table is None:
            return "", ""
        w = table.cellWidget(row, 2)
        if isinstance(w, QWidget):
            combo = w.findChild(QComboBox)
            if isinstance(combo, QComboBox):
                name = str(combo.currentText() or "").strip()
                color = str(combo.currentData(Qt.ItemDataRole.UserRole) or "").strip()
                return name, color
        return "", ""

    def _inventory_subcategory_value(self, row: int) -> str:
        table = self._company_inventory_table
        if table is None:
            return ""
        w = table.cellWidget(row, 3)
        if isinstance(w, QWidget):
            combo = w.findChild(QComboBox)
            if isinstance(combo, QComboBox):
                return str(combo.currentText() or "").strip()
        return ""

    def _inventory_apply_row_tint(self, row: int, color_hex: str) -> None:
        table = self._company_inventory_table
        if table is None or row < 0 or row >= table.rowCount():
            return
        base = QColor("#FFFFFF")
        input_bg = QColor("#F7F8FA")
        input_drop_bg = QColor("#F1F3F6")
        input_border = QColor("#E5E7EC")
        text_fg = QColor("#111827")
        if str(color_hex or "").strip():
            base = QColor(self._normalize_hex(color_hex, "#7D99B3"))
            input_bg = base.lighter(140)
            input_drop_bg = base.lighter(128)
            input_border = base.darker(112)
            text_fg = QColor("#FFFFFF" if base.lightness() < 145 else "#111827")
        for col in range(table.columnCount()):
            item = table.item(row, col)
            if item is None:
                item = QTableWidgetItem("")
                table.setItem(row, col, item)
            item.setBackground(base)
            item.setForeground(text_fg)
            host = table.cellWidget(row, col)
            if isinstance(host, QWidget):
                host.setStyleSheet(f"QWidget {{ background: {base.name()}; border: none; }}")
                for edit in host.findChildren(QLineEdit):
                    edit.setStyleSheet(
                        "QLineEdit { "
                        f"background: {input_bg.name()}; border: 1px solid {input_border.name()}; border-radius: 8px; "
                        f"padding: 3px 8px; font-size: 12px; color: {text_fg.name()};"
                        " }"
                    )
                for combo in host.findChildren(QComboBox):
                    combo.setStyleSheet(
                        "QComboBox { "
                        f"background:{input_bg.name()}; border:1px solid {input_border.name()}; border-radius: 8px; "
                        f"padding: 0 24px 0 8px; font-size: 12px; min-height: 24px; max-height: 24px; color: {text_fg.name()};"
                        "} "
                        "QComboBox::drop-down { "
                        "subcontrol-origin: padding; subcontrol-position: top right; width: 20px; "
                        f"border-left: 1px solid {input_border.name()}; background: {input_drop_bg.name()}; "
                        "border-top-right-radius: 8px; border-bottom-right-radius: 8px; } "
                        "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
                    )
                for lbl in host.findChildren(QLabel):
                    lbl.setStyleSheet(f"QLabel {{ color: {text_fg.name()}; font-size: 12px; font-weight: 700; }}")

    def _inventory_category_changed(self, row: int) -> None:
        name, color = self._inventory_category_value(row)
        subcategory = self._inventory_subcategory_value(row)
        self._set_inventory_subcategory_editor(row, name, subcategory)
        self._inventory_apply_row_tint(row, color)
        self._queue_company_autosave("inventory", self._autosave_company_inventory)

    def _company_inventory_open_category(self) -> str:
        return str(getattr(self, "_company_inventory_open_category_name", "") or "").strip()

    def _set_company_inventory_open_category(self, category_name: str) -> None:
        target = str(category_name or "").strip()
        current = self._company_inventory_open_category()
        if target and current.lower() == target.lower():
            target = ""
        self._company_inventory_open_category_name = target
        base_table = getattr(self, "_company_inventory_table_base", None)
        if isinstance(base_table, QTableWidget):
            self._company_inventory_table = base_table
        self._load_company_item_categories_rows()
        self._sync_company_quote_settings_row_height()

    def _is_item_category_detail_row(self, table: QTableWidget, row: int) -> bool:
        if table is None or row < 0 or row >= table.rowCount():
            return False
        item = table.item(row, 0)
        marker = item.data(Qt.ItemDataRole.UserRole) if isinstance(item, QTableWidgetItem) else None
        return str(marker or "") == "__inventory_detail__"

    def _build_item_category_inline_inventory_panel(self, category_name: str) -> QWidget:
        host = QFrame()
        host.setStyleSheet("QFrame { background:#F8FAFD; border:1px solid #D9E2EE; border-radius:10px; }")
        lay = QVBoxLayout(host)
        lay.setContentsMargins(10, 8, 10, 8)
        lay.setSpacing(6)

        title = QLabel(f"Inventory - {category_name}")
        title.setStyleSheet("QLabel { color:#334155; font-size:12px; font-weight:700; background:transparent; border:none; }")
        lay.addWidget(title)

        inv_table = ReorderableTableWidget()
        inv_table.setProperty("inlineCategoryInventoryPanel", True)
        inv_table.setColumnCount(7)
        inv_table.setHorizontalHeaderLabels(["", "Item", "Category", "Sub-category", "Price", "Markup %", "Output Price"])
        inv_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        inv_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        inv_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        inv_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        inv_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        inv_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        inv_table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)
        inv_table.verticalHeader().setVisible(False)
        inv_table.horizontalHeader().setVisible(True)
        inv_table.setFrameShape(QFrame.Shape.NoFrame)
        inv_table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        inv_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        inv_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        inv_table.setDragEnabled(True)
        inv_table.setAcceptDrops(True)
        inv_table.viewport().setAcceptDrops(True)
        inv_table.setDropIndicatorShown(False)
        inv_table.setDragDropOverwriteMode(False)
        inv_table.setDefaultDropAction(Qt.DropAction.MoveAction)
        inv_table.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        inv_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        inv_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        inv_table.setStyleSheet(
            "QTableWidget { background: transparent; border: none; outline: none; }"
            "QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        inv_table.setProperty("compactRows", True)
        inv_table.setShowGrid(False)
        inv_table.itemChanged.connect(lambda _item=None: self._queue_company_autosave("inventory", self._autosave_company_inventory))
        inv_table.rows_reordered.connect(self._on_inventory_rows_reordered)

        self._company_inventory_table = inv_table
        self._load_company_inventory_rows()
        lay.addWidget(inv_table)

        actions = QHBoxLayout()
        actions.setContentsMargins(0, 0, 0, 0)
        actions.setSpacing(6)
        add_btn = QPushButton("Add Item")
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.setStyleSheet(
            "QPushButton { background:#FFFFFF; color:#2D8F8B; border:1px solid #CDE4E0; border-radius:8px; padding:4px 10px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F4FBFA; color:#247A76; border:1px solid #B8DBD5; }"
        )
        add_btn.clicked.connect(self._add_company_inventory_row)
        actions.addWidget(add_btn, 0, Qt.AlignmentFlag.AlignLeft)
        actions.addStretch(1)
        lay.addLayout(actions)
        return host

    def _inventory_table_min_rows(self, table: QTableWidget | None) -> int:
        if isinstance(table, QTableWidget) and bool(table.property("inlineCategoryInventoryPanel")):
            return 1
        return 3

    def _set_item_category_open_button(self, row: int, category_name: str) -> None:
        table = self._company_item_categories_table
        if table is None or row < 0 or row >= table.rowCount():
            return
        cat = str(category_name or "").strip()
        current = self._company_inventory_open_category()
        is_open = bool(cat) and bool(current) and current.lower() == cat.lower()
        btn = QPushButton("Close" if is_open else "Open")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setFixedHeight(24)
        btn.setStyleSheet(
            "QPushButton { background:#FFFFFF; color:#2D8F8B; border:1px solid #CDE4E0; border-radius:8px; padding:0 8px; font-size:12px; font-weight:700; }"
            "QPushButton:hover { background:#F4FBFA; color:#247A76; border:1px solid #B8DBD5; }"
        )
        btn.clicked.connect(lambda _=False, name=cat: self._set_company_inventory_open_category(name))
        table.setCellWidget(row, 4, self._wrap_table_control(btn))

    def _load_company_item_categories_rows(self) -> None:
        table = self._company_item_categories_table
        if table is None:
            return
        base_table = getattr(self, "_company_inventory_table_base", None)
        if isinstance(base_table, QTableWidget):
            self._company_inventory_table = base_table
        raw = self._company.get("itemCategories")
        if not isinstance(raw, list):
            raw = self._company.get("salesItemCategories")
        if not isinstance(raw, list):
            raw = []
        rows: list[dict] = []
        seen: set[str] = set()
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            color = self._normalize_hex(str(row.get("color") or "#7D99B3"), "#7D99B3")
            subcategories = row.get("subcategories")
            sub_rows: list[dict] = []
            seen_subs: set[str] = set()
            if isinstance(subcategories, list):
                for entry in subcategories:
                    if isinstance(entry, dict):
                        sub_name = str(entry.get("name") or "").strip()
                        sub_color = self._normalize_hex(str(entry.get("color") or color), color)
                    else:
                        sub_name = str(entry or "").strip()
                        sub_color = color
                    if not sub_name:
                        continue
                    k2 = sub_name.lower()
                    if k2 in seen_subs:
                        continue
                    seen_subs.add(k2)
                    sub_rows.append({"name": sub_name, "color": sub_color})
            elif isinstance(subcategories, str):
                for part in str(subcategories).split(","):
                    sub_name = str(part or "").strip()
                    if not sub_name:
                        continue
                    k2 = sub_name.lower()
                    if k2 in seen_subs:
                        continue
                    seen_subs.add(k2)
                    sub_rows.append({"name": sub_name, "color": color})
            rows.append({"name": name, "subcategories": sub_rows, "color": color})

        open_category = self._company_inventory_open_category()
        table.setRowCount(0)
        row_cursor = 0
        self._apply_compact_row_height(table, row_height=29)
        for row in rows:
            table.insertRow(row_cursor)
            table.setItem(row_cursor, 1, QTableWidgetItem(str(row.get("name") or "")))
            table.setItem(row_cursor, 2, QTableWidgetItem(""))
            table.setItem(row_cursor, 3, QTableWidgetItem(""))
            table.setItem(row_cursor, 4, QTableWidgetItem(""))
            self._set_name_editor(table, row_cursor, 1, str(row.get("name") or ""), lambda _=None: self._queue_company_autosave("item_categories", self._autosave_company_item_categories))
            self._set_color_button(table, row_cursor, 3, str(row.get("color") or "#7D99B3"), self._item_category_color_button_clicked)
            self._set_category_subcategories_value(row_cursor, [dict(x) for x in row.get("subcategories", []) if isinstance(x, dict)])
            self._set_item_category_open_button(row_cursor, str(row.get("name") or ""))
            self._set_delete_button(table, row_cursor, 0, self._item_category_delete_button_clicked)
            row_cursor += 1
            name = str(row.get("name") or "").strip()
            if open_category and name and open_category.lower() == name.lower():
                table.insertRow(row_cursor)
                marker = QTableWidgetItem("")
                marker.setData(Qt.ItemDataRole.UserRole, "__inventory_detail__")
                table.setItem(row_cursor, 0, marker)
                for c in range(1, table.columnCount()):
                    table.setItem(row_cursor, c, QTableWidgetItem(""))
                table.setSpan(row_cursor, 0, 1, table.columnCount())
                detail = self._build_item_category_inline_inventory_panel(name)
                table.setCellWidget(row_cursor, 0, detail)
                try:
                    detail.adjustSize()
                except Exception:
                    pass
                detail_h = max(
                    int(detail.minimumSizeHint().height() or 0),
                    int(detail.sizeHint().height() or 0),
                )
                table.setRowHeight(row_cursor, max(44, detail_h + 4))
                row_cursor += 1
        self._fit_table_to_contents(table, min_rows=self._inventory_table_min_rows(table))

    def _add_company_item_category_row(self) -> None:
        table = self._company_item_categories_table
        if table is None:
            return
        default_color = self._normalize_hex(
            str(self._company.get("themeColor") or self._company_theme_hex or "#2F6BFF"),
            "#2F6BFF",
        )
        row = table.rowCount()
        if row > 0 and self._is_item_category_detail_row(table, row - 1):
            row -= 1
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        table.setItem(row, 2, QTableWidgetItem(""))
        table.setItem(row, 3, QTableWidgetItem(""))
        table.setItem(row, 4, QTableWidgetItem(""))
        self._set_name_editor(table, row, 1, "", lambda _=None: self._queue_company_autosave("item_categories", self._autosave_company_item_categories))
        self._set_color_button(table, row, 3, default_color, self._item_category_color_button_clicked)
        self._set_category_subcategories_value(row, [])
        self._set_item_category_open_button(row, "")
        self._set_delete_button(table, row, 0, self._item_category_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=self._inventory_table_min_rows(table))
        self._queue_company_autosave("item_categories", self._autosave_company_item_categories)

    def _item_category_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_item_categories_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_item_category_row(row=row)

    def _item_category_color_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_item_categories_table
        if table is None:
            return
        row = self._row_from_table_button(table, sender, preferred_col=3)
        if row < 0 or row >= table.rowCount():
            return
        start_color = self._read_color_hex(table, row, 3, "#7D99B3")
        from PySide6.QtGui import QColor
        from PySide6.QtWidgets import QColorDialog
        picked = QColorDialog.getColor(QColor(start_color), self, "Choose Category Color")
        if not picked.isValid():
            return
        new_hex = self._normalize_hex(str(picked.name() or start_color), start_color)
        item = table.item(row, 3)
        if item is None:
            item = QTableWidgetItem("")
            table.setItem(row, 3, item)
        item.setData(Qt.ItemDataRole.UserRole, new_hex)
        self._set_color_button(table, row, 3, new_hex, self._item_category_color_button_clicked)
        sub_rows = self._category_subcategories_value(row)
        recolored: list[dict] = []
        for sub in sub_rows:
            nm = str((sub or {}).get("name") or "").strip()
            if not nm:
                continue
            recolored.append({"name": nm, "color": new_hex})
        self._set_category_subcategories_value(row, recolored)
        self._queue_company_autosave("item_categories", self._autosave_company_item_categories)

    def _remove_company_item_category_row(self, row: int | None = None) -> None:
        table = self._company_item_categories_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if self._is_item_category_detail_row(table, row):
            return
        if row < 0:
            return
        table.removeRow(row)
        self._refresh_item_category_row_widgets()
        self._fit_table_to_contents(table, min_rows=self._inventory_table_min_rows(table))
        open_category = self._company_inventory_open_category()
        if open_category:
            names = {self._editor_text(table, r, 1).strip().lower() for r in range(table.rowCount()) if not self._is_item_category_detail_row(table, r)}
            if open_category.lower() not in names:
                self._company_inventory_open_category_name = ""
        self._queue_company_autosave("item_categories", self._autosave_company_item_categories)

    def _refresh_item_category_row_widgets(self) -> None:
        table = self._company_item_categories_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            if self._is_item_category_detail_row(table, row):
                continue
            name = self._editor_text(table, row, 1)
            subcategories = self._category_subcategories_value(row)
            color = self._read_color_hex(table, row, 3, "#7D99B3")
            self._set_name_editor(table, row, 1, name, lambda _=None: self._queue_company_autosave("item_categories", self._autosave_company_item_categories))
            self._set_color_button(table, row, 3, color, self._item_category_color_button_clicked)
            self._set_category_subcategories_value(row, subcategories)
            self._set_item_category_open_button(row, name)
            self._set_delete_button(table, row, 0, self._item_category_delete_button_clicked)

    def _save_company_item_categories(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_item_categories_table
        if not company_id or table is None:
            return
        rows: list[dict] = []
        seen: set[str] = set()
        for r in range(table.rowCount()):
            if self._is_item_category_detail_row(table, r):
                continue
            name = self._editor_text(table, r, 1)
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            color = self._read_color_hex(table, r, 3, "#7D99B3")
            subcategories = self._category_subcategories_value(r)
            rows.append({"name": name, "color": color, "subcategories": subcategories})
        if not rows and not silent_invalid and table.rowCount() > 0:
            QMessageBox.warning(self, "Item Categories", "Add at least one category name or clear blank rows.")
            return
        try:
            self.app.company.update_company(company_id, {"itemCategories": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["itemCategories"] = rows
        if notify:
            QMessageBox.information(self, "Saved", "Item categories updated.")

    def _inventory_parse_number(self, value: str) -> float | None:
        text = str(value or "").strip().replace(",", "")
        if not text:
            return None
        try:
            num = float(text)
        except Exception:
            return None
        if num < 0:
            return None
        return num

    def _format_discount_value(self, value) -> str:
        text = str(value or "").strip()
        if text == "":
            return ""
        parsed = self._inventory_parse_number(text)
        if parsed is None:
            return ""
        return f"{parsed:.3f}".rstrip("0").rstrip(".")

    def _sync_company_quote_settings_row_height(self) -> None:
        row = getattr(self, "_company_quote_settings_row", None)
        extras = getattr(self, "_company_quote_extras_card", None)
        discounts = getattr(self, "_company_sales_discounts_card", None)
        if row is None and extras is None and discounts is None:
            return
        max_h = 0
        for widget in (extras, discounts):
            if not isinstance(widget, QWidget):
                continue
            try:
                widget.adjustSize()
            except Exception:
                pass
            lay = widget.layout()
            if lay is not None:
                try:
                    lay.activate()
                except Exception:
                    pass
            lay_h = int(lay.sizeHint().height()) if lay is not None else 0
            hint_h = max(
                int(widget.minimumSizeHint().height()),
                int(widget.sizeHint().height()),
                lay_h,
            )
            if hint_h > 0:
                widget.setMinimumHeight(hint_h + 40)
            widget.setMaximumHeight(16777215)
            max_h = max(max_h, int(widget.minimumHeight()), hint_h + 40)
        if isinstance(row, QWidget):
            row_hint_h = max(int(row.minimumSizeHint().height()), int(row.sizeHint().height()))
            max_h = max(max_h, row_hint_h)
            if max_h > 0:
                row.setMinimumHeight(max_h)
            row.setMaximumHeight(16777215)
            row.updateGeometry()
            parent = row.parentWidget()
            while parent is not None:
                lay = parent.layout()
                if lay is not None:
                    lay.activate()
                parent.updateGeometry()
                parent = parent.parentWidget()

    def _clear_company_rows_layout(self, layout) -> None:
        if not isinstance(layout, QVBoxLayout):
            return
        while layout.count():
            it = layout.takeAt(0)
            w = it.widget()
            if isinstance(w, QWidget):
                w.setParent(None)
                w.deleteLater()

    def _clear_company_rows_list(self, lst) -> None:
        if not isinstance(lst, QListWidget):
            return
        lst.clear()

    def _fit_company_rows_list_to_contents(self, lst, min_rows: int = 1) -> None:
        if not isinstance(lst, QListWidget):
            return
        count = lst.count()
        row_total = 0
        for i in range(count):
            h = int(lst.sizeHintForRow(i) or 0)
            if h <= 0:
                item = lst.item(i)
                h = int(item.sizeHint().height()) if isinstance(item, QListWidgetItem) else 30
            row_total += max(24, h)
        default_h = 34
        visible = max(int(min_rows), count)
        if count < visible:
            row_total += (visible - count) * default_h
        frame = lst.frameWidth() * 2 + 2
        total_h = row_total + frame
        lst.setMinimumHeight(total_h)
        lst.setMaximumHeight(total_h)
        lst.updateGeometry()

    def _iter_company_rows_list_widgets(self, lst) -> list[QWidget]:
        out: list[QWidget] = []
        if not isinstance(lst, QListWidget):
            return out
        for i in range(lst.count()):
            item = lst.item(i)
            if not isinstance(item, QListWidgetItem):
                continue
            w = lst.itemWidget(item)
            if isinstance(w, QWidget):
                out.append(w)
        return out

    def _add_company_rows_list_widget(self, lst, w: QWidget) -> None:
        if not isinstance(lst, QListWidget) or not isinstance(w, QWidget):
            return
        item = QListWidgetItem()
        item.setFlags(item.flags() | Qt.ItemFlag.ItemIsDragEnabled | Qt.ItemFlag.ItemIsDropEnabled | Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable)
        item.setSizeHint(w.sizeHint())
        lst.addItem(item)
        lst.setItemWidget(item, w)

    def _iter_company_rows_layout(self, layout) -> list[QWidget]:
        out: list[QWidget] = []
        if not isinstance(layout, QVBoxLayout):
            return out
        for i in range(layout.count()):
            it = layout.itemAt(i)
            w = it.widget() if it is not None else None
            if isinstance(w, QWidget):
                out.append(w)
        return out

    def _build_quote_discount_tier_row_widget(self, low: str = "", high: str = "", discount: str = "") -> QWidget:
        row = QWidget()
        row.setObjectName("companyQuoteTierRow")
        row.setStyleSheet("QWidget#companyQuoteTierRow { border-bottom:1px solid #E8EDF4; }")
        lay = QHBoxLayout(row)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)

        del_btn = QPushButton("x")
        del_btn.setObjectName("companyQuoteTierDelete")
        del_btn.setFixedSize(24, 24)
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setStyleSheet(
            "QPushButton { background:#FCEAEA; color:#C62828; border:1px solid #F4B5B5; border-radius:7px; font-size:11px; font-weight:800; }"
            "QPushButton:hover { background:#F9D7D7; }"
        )
        del_btn.clicked.connect(self._quote_discount_tier_delete_button_clicked)
        lay.addWidget(del_btn, 0, Qt.AlignmentFlag.AlignVCenter)

        def _num_edit(seed: str) -> QLineEdit:
            edit = QLineEdit(str(seed or ""))
            edit.setFixedHeight(24)
            edit.setAlignment(Qt.AlignmentFlag.AlignCenter)
            edit.setStyleSheet(
                "QLineEdit { background:#F7F8FA; border:1px solid #E5E7EC; border-radius:8px; padding:3px 8px; font-size:12px; }"
            )
            validator = QDoubleValidator(0.0, 999999999.0, 3, edit)
            validator.setNotation(QDoubleValidator.Notation.StandardNotation)
            edit.setValidator(validator)
            edit.textChanged.connect(lambda _=None: self._queue_company_autosave("sales_discounts", self._autosave_company_sales_discounts))
            return edit

        low_edit = _num_edit(low)
        low_edit.setObjectName("tierLow")
        high_edit = _num_edit(high)
        high_edit.setObjectName("tierHigh")
        disc_edit = _num_edit(discount)
        disc_edit.setObjectName("tierDiscount")
        lay.addWidget(low_edit, 1)
        lay.addWidget(high_edit, 1)
        lay.addWidget(disc_edit, 1)
        return row

    def _build_quote_extra_row_widget(
        self,
        name: str = "",
        price: str = "",
        default_included: bool = False,
        container_id: str = "",
        placeholder_key: str = "",
    ) -> QWidget:
        row = QWidget()
        row.setObjectName("companyQuoteExtraRow")
        row.setStyleSheet("QWidget#companyQuoteExtraRow { border-bottom:1px solid #E8EDF4; }")
        lay = QHBoxLayout(row)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(6)

        del_btn = QPushButton("x")
        del_btn.setObjectName("quoteExtraDelete")
        del_btn.setFixedSize(24, 24)
        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        del_btn.setStyleSheet(
            "QPushButton { background:#FCEAEA; color:#C62828; border:1px solid #F4B5B5; border-radius:7px; font-size:11px; font-weight:800; }"
            "QPushButton:hover { background:#F9D7D7; }"
        )
        del_btn.clicked.connect(self._quote_extra_delete_button_clicked)
        lay.addWidget(del_btn, 0, Qt.AlignmentFlag.AlignVCenter)

        name_edit = QLineEdit(str(name or ""))
        name_edit.setObjectName("quoteExtraName")
        name_edit.setFixedHeight(24)
        name_edit.setStyleSheet("QLineEdit { background:#F7F8FA; border:1px solid #E5E7EC; border-radius:8px; padding:3px 8px; font-size:12px; }")
        name_edit.textChanged.connect(lambda _=None: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        lay.addWidget(name_edit, 3)

        price_edit = QLineEdit(str(price or ""))
        price_edit.setObjectName("quoteExtraPrice")
        price_edit.setFixedHeight(24)
        price_edit.setAlignment(Qt.AlignmentFlag.AlignCenter)
        price_edit.setStyleSheet("QLineEdit { background:#F7F8FA; border:1px solid #E5E7EC; border-radius:8px; padding:3px 8px; font-size:12px; }")
        price_validator = QDoubleValidator(0.0, 999999999.0, 3, price_edit)
        price_validator.setNotation(QDoubleValidator.Notation.StandardNotation)
        price_edit.setValidator(price_validator)
        price_edit.textChanged.connect(lambda _=None: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        lay.addWidget(price_edit, 1)

        default_cb = QCheckBox()
        default_cb.setObjectName("quoteExtraDefault")
        default_cb.setChecked(bool(default_included))
        default_cb.setCursor(Qt.CursorShape.PointingHandCursor)
        default_cb.setStyleSheet(
            "QCheckBox::indicator { width:11px; height:11px; }"
        )
        default_cb.toggled.connect(lambda _=False: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        default_host = QWidget()
        default_lay = QHBoxLayout(default_host)
        default_lay.setContentsMargins(0, 0, 0, 0)
        default_lay.setSpacing(0)
        default_lay.addStretch(1)
        default_lay.addWidget(default_cb, 0, Qt.AlignmentFlag.AlignCenter)
        default_lay.addStretch(1)
        lay.addWidget(default_host, 1)

        container_combo = QComboBox()
        container_combo.setObjectName("quoteExtraContainer")
        container_combo.setFixedHeight(24)
        container_combo.setStyleSheet(
            "QComboBox { background:#F7F8FA; border:1px solid #E5E7EC; border-radius:8px; padding:2px 8px; font-size:12px; }"
            "QComboBox::drop-down { border:none; width:18px; }"
        )
        for value, label in self._quote_template_container_options():
            container_combo.addItem(label, value)
        idx = container_combo.findData(str(container_id or "").strip())
        container_combo.setCurrentIndex(idx if idx >= 0 else 0)
        container_combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        lay.addWidget(container_combo, 2)

        placeholder_combo = QComboBox()
        placeholder_combo.setObjectName("quoteExtraPlaceholder")
        placeholder_combo.setFixedHeight(24)
        placeholder_combo.setStyleSheet(
            "QComboBox { background:#F7F8FA; border:1px solid #E5E7EC; border-radius:8px; padding:2px 8px; font-size:12px; }"
            "QComboBox::drop-down { border:none; width:18px; }"
        )
        target_placeholder = str(placeholder_key or "").strip().strip("{} ")
        for value, label in self._quote_template_placeholder_options():
            placeholder_combo.addItem(label, value)
        pidx = placeholder_combo.findData(target_placeholder)
        placeholder_combo.setCurrentIndex(pidx if pidx >= 0 else 0)
        placeholder_combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        lay.addWidget(placeholder_combo, 2)
        return row

    def _load_company_sales_discounts(self) -> None:
        minus_check = getattr(self, "_company_sales_minus_off_quote_total_check", None)
        if isinstance(minus_check, QCheckBox):
            minus_check.blockSignals(True)
            minus_check.setChecked(bool((self._company or {}).get("salesMinusOffQuoteTotal") is True))
            minus_check.blockSignals(False)
        self._load_company_quote_discount_tiers_rows()
        self._sync_company_quote_settings_row_height()

    def _set_quote_discount_tier_number_editor_for_table(self, table, row: int, col: int, text: str) -> None:
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        edit.setAlignment(Qt.AlignmentFlag.AlignCenter)
        edit.setStyleSheet(
            "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; padding:3px 8px; font-size:12px; color:#1F2937; }"
            "QLineEdit:focus { border:1px solid #AFC2DA; background:#FFFFFF; }"
        )
        validator = QDoubleValidator(0.0, 999999999.0, 3, edit)
        validator.setNotation(QDoubleValidator.Notation.StandardNotation)
        edit.setValidator(validator)
        edit.textChanged.connect(lambda _=None: self._queue_company_autosave("sales_discounts", self._autosave_company_sales_discounts))
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(edit)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _load_company_quote_discount_tiers_rows(self) -> None:
        rows_list = getattr(self, "_company_quote_discount_tiers_rows_list", None)
        if isinstance(rows_list, QListWidget):
            raw = (self._company or {}).get("salesQuoteDiscountTiers")
            if not isinstance(raw, list):
                raw = []
            self._clear_company_rows_list(rows_list)
            for row in raw:
                if not isinstance(row, dict):
                    continue
                low = str(row.get("low") or "").strip()
                high = str(row.get("high") or "").strip()
                discount = str(row.get("discount") or "").strip()
                if not low and not high and not discount:
                    continue
                self._add_company_rows_list_widget(rows_list, self._build_quote_discount_tier_row_widget(low, high, discount))
            self._fit_company_rows_list_to_contents(rows_list, min_rows=1)
            self._sync_company_quote_settings_row_height()
            return
        table = getattr(self, "_company_quote_discount_tiers_table", None)
        if table is None:
            return
        raw = (self._company or {}).get("salesQuoteDiscountTiers")
        if not isinstance(raw, list):
            raw = []
        rows: list[dict] = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            low = str(row.get("low") or "").strip()
            high = str(row.get("high") or "").strip()
            discount = str(row.get("discount") or "").strip()
            if low or high or discount:
                rows.append({"low": low, "high": high, "discount": discount})
        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=29)
        for i2, row in enumerate(rows):
            table.setItem(i2, 1, QTableWidgetItem(str(row.get("low") or "")))
            table.setItem(i2, 2, QTableWidgetItem(str(row.get("high") or "")))
            table.setItem(i2, 3, QTableWidgetItem(str(row.get("discount") or "")))
            self._set_quote_discount_tier_number_editor_for_table(table, i2, 1, str(row.get("low") or ""))
            self._set_quote_discount_tier_number_editor_for_table(table, i2, 2, str(row.get("high") or ""))
            self._set_quote_discount_tier_number_editor_for_table(table, i2, 3, str(row.get("discount") or ""))
            self._set_delete_button(table, i2, 0, self._quote_discount_tier_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=1)
        self._sync_company_quote_settings_row_height()

    def _add_company_quote_discount_tier_row(self) -> None:
        rows_list = getattr(self, "_company_quote_discount_tiers_rows_list", None)
        if isinstance(rows_list, QListWidget):
            self._add_company_rows_list_widget(rows_list, self._build_quote_discount_tier_row_widget("", "", ""))
            self._fit_company_rows_list_to_contents(rows_list, min_rows=1)
            self._queue_company_autosave("sales_discounts", self._autosave_company_sales_discounts)
            self._sync_company_quote_settings_row_height()
            return
        table = getattr(self, "_company_quote_discount_tiers_table", None)
        if table is None:
            return
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        table.setItem(row, 2, QTableWidgetItem(""))
        table.setItem(row, 3, QTableWidgetItem(""))
        self._set_quote_discount_tier_number_editor_for_table(table, row, 1, "")
        self._set_quote_discount_tier_number_editor_for_table(table, row, 2, "")
        self._set_quote_discount_tier_number_editor_for_table(table, row, 3, "")
        self._set_delete_button(table, row, 0, self._quote_discount_tier_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=1)
        self._sync_company_quote_settings_row_height()

    def _quote_discount_tier_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        rows_list = getattr(self, "_company_quote_discount_tiers_rows_list", None)
        if isinstance(rows_list, QListWidget):
            for i, w in enumerate(self._iter_company_rows_list_widgets(rows_list)):
                if sender is w.findChild(QPushButton, "companyQuoteTierDelete"):
                    self._remove_company_quote_discount_tier_row(row=i)
                    return
        table = getattr(self, "_company_quote_discount_tiers_table", None)
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_quote_discount_tier_row(row=row)

    def _remove_company_quote_discount_tier_row(self, row: int | None = None) -> None:
        rows_list = getattr(self, "_company_quote_discount_tiers_rows_list", None)
        if isinstance(rows_list, QListWidget):
            ridx = int(row if row is not None else -1)
            if ridx < 0 or ridx >= rows_list.count():
                return
            it = rows_list.takeItem(ridx)
            if isinstance(it, QListWidgetItem):
                w = rows_list.itemWidget(it)
                if isinstance(w, QWidget):
                    w.setParent(None)
                    w.deleteLater()
            self._fit_company_rows_list_to_contents(rows_list, min_rows=1)
            self._queue_company_autosave("sales_discounts", self._autosave_company_sales_discounts)
            self._sync_company_quote_settings_row_height()
            return
        table = getattr(self, "_company_quote_discount_tiers_table", None)
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row < 0:
            return
        table.removeRow(row)
        self._refresh_quote_discount_tier_row_widgets()
        self._fit_table_to_contents(table, min_rows=1)
        self._queue_company_autosave("sales_discounts", self._autosave_company_sales_discounts)
        self._sync_company_quote_settings_row_height()

    def _refresh_quote_discount_tier_row_widgets(self) -> None:
        table = getattr(self, "_company_quote_discount_tiers_table", None)
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            low = self._editor_text(table, row, 1)
            high = self._editor_text(table, row, 2)
            discount = self._editor_text(table, row, 3)
            self._set_quote_discount_tier_number_editor_for_table(table, row, 1, low)
            self._set_quote_discount_tier_number_editor_for_table(table, row, 2, high)
            self._set_quote_discount_tier_number_editor_for_table(table, row, 3, discount)
            self._set_delete_button(table, row, 0, self._quote_discount_tier_delete_button_clicked)

    def _save_company_sales_discounts(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        minus_check = getattr(self, "_company_sales_minus_off_quote_total_check", None)
        rows_list = getattr(self, "_company_quote_discount_tiers_rows_list", None)
        tiers_table = getattr(self, "_company_quote_discount_tiers_table", None)
        if not company_id:
            return
        minus_mode = bool(minus_check.isChecked()) if isinstance(minus_check, QCheckBox) else False

        tiers: list[dict] = []
        if isinstance(rows_list, QListWidget):
            for w in self._iter_company_rows_list_widgets(rows_list):
                low_w = w.findChild(QLineEdit, "tierLow")
                high_w = w.findChild(QLineEdit, "tierHigh")
                disc_w = w.findChild(QLineEdit, "tierDiscount")
                low_raw = str(low_w.text() if isinstance(low_w, QLineEdit) else "").strip()
                high_raw = str(high_w.text() if isinstance(high_w, QLineEdit) else "").strip()
                discount_raw = str(disc_w.text() if isinstance(disc_w, QLineEdit) else "").strip()
                if not low_raw and not high_raw and not discount_raw:
                    continue
                low_val = self._inventory_parse_number(low_raw) if low_raw else None
                high_val = self._inventory_parse_number(high_raw) if high_raw else None
                discount_val = self._inventory_parse_number(discount_raw) if discount_raw else None
                if low_val is None or high_val is None or discount_val is None:
                    if not silent_invalid:
                        QMessageBox.warning(self, "Quote Discount", "Each tier row must have valid numbers in Low, High, and Discount.")
                    return
                if low_val > high_val:
                    if not silent_invalid:
                        QMessageBox.warning(self, "Quote Discount", "Tier Low $ cannot be greater than High $.")
                    return
                tiers.append(
                    {
                        "low": f"{float(low_val):.3f}".rstrip("0").rstrip("."),
                        "high": f"{float(high_val):.3f}".rstrip("0").rstrip("."),
                        "discount": f"{float(discount_val):.3f}".rstrip("0").rstrip("."),
                    }
                )
        elif isinstance(tiers_table, QTableWidget):
            for r in range(tiers_table.rowCount()):
                low_raw = self._editor_text(tiers_table, r, 1)
                high_raw = self._editor_text(tiers_table, r, 2)
                discount_raw = self._editor_text(tiers_table, r, 3)
                if not low_raw and not high_raw and not discount_raw:
                    continue
                low_val = self._inventory_parse_number(low_raw) if low_raw else None
                high_val = self._inventory_parse_number(high_raw) if high_raw else None
                discount_val = self._inventory_parse_number(discount_raw) if discount_raw else None
                if low_val is None or high_val is None or discount_val is None:
                    if not silent_invalid:
                        QMessageBox.warning(self, "Quote Discount", "Each tier row must have valid numbers in Low, High, and Discount.")
                    return
                if low_val > high_val:
                    if not silent_invalid:
                        QMessageBox.warning(self, "Quote Discount", "Tier Low $ cannot be greater than High $.")
                    return
                tiers.append(
                    {
                        "low": f"{float(low_val):.3f}".rstrip("0").rstrip("."),
                        "high": f"{float(high_val):.3f}".rstrip("0").rstrip("."),
                        "discount": f"{float(discount_val):.3f}".rstrip("0").rstrip("."),
                    }
                )

        payload = {
            "salesMinusOffQuoteTotal": minus_mode,
            "salesQuoteDiscountTiers": tiers,
        }
        try:
            self.app.company.update_company(company_id, payload)
        except Exception as exc:
            if not silent_invalid:
                QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company.update(payload)
        self._load_company_sales_discounts()
        if notify:
            QMessageBox.information(self, "Saved", "Quote discount settings updated.")

    def _load_company_quote_extras_rows(self) -> None:
        rows_list = getattr(self, "_company_quote_extras_rows_list", None)
        if isinstance(rows_list, QListWidget):
            raw = self._company.get("quoteExtras")
            if not isinstance(raw, list):
                raw = []
            rows: list[dict] = []
            seen: set[str] = set()
            for row in raw:
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or "").strip()
                price = str(row.get("price") or "").strip()
                default_included = bool(row.get("defaultIncluded") or row.get("default"))
                container_id = str(row.get("templateContainerId") or "").strip()
                placeholder_key = str(row.get("templatePlaceholderKey") or "").strip()
                if not name and not price:
                    continue
                key = name.lower()
                if name and key in seen:
                    continue
                if name:
                    seen.add(key)
                rows.append(
                    {
                        "name": name,
                        "price": price,
                        "defaultIncluded": default_included,
                        "templateContainerId": container_id,
                        "templatePlaceholderKey": placeholder_key,
                    }
                )
            self._clear_company_rows_list(rows_list)
            for row in rows:
                self._add_company_rows_list_widget(
                    rows_list,
                    self._build_quote_extra_row_widget(
                        str(row.get("name") or ""),
                        str(row.get("price") or ""),
                        bool(row.get("defaultIncluded")),
                        str(row.get("templateContainerId") or ""),
                        str(row.get("templatePlaceholderKey") or ""),
                    ),
                )
            self._fit_company_rows_list_to_contents(rows_list, min_rows=2)
            self._sync_company_quote_settings_row_height()
            return
        table = self._company_quote_extras_table
        if table is None:
            return
        raw = self._company.get("quoteExtras")
        if not isinstance(raw, list):
            raw = []
        rows: list[dict] = []
        seen: set[str] = set()
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            price = str(row.get("price") or "").strip()
            default_included = bool(row.get("defaultIncluded") or row.get("default"))
            container_id = str(row.get("templateContainerId") or "").strip()
            placeholder_key = str(row.get("templatePlaceholderKey") or "").strip()
            if not name and not price:
                continue
            key = name.lower()
            if name and key in seen:
                continue
            if name:
                seen.add(key)
            rows.append(
                {
                    "name": name,
                    "price": price,
                    "defaultIncluded": default_included,
                    "templateContainerId": container_id,
                    "templatePlaceholderKey": placeholder_key,
                }
            )

        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=29)
        for i2, row in enumerate(rows):
            table.setItem(i2, 1, QTableWidgetItem(str(row.get("name") or "")))
            table.setItem(i2, 2, QTableWidgetItem(str(row.get("price") or "")))
            self._set_quote_extra_name_editor_for_table(table, i2, 1, str(row.get("name") or ""))
            self._set_inventory_number_editor_for_table(table, i2, 2, str(row.get("price") or ""))
            self._set_quote_extra_default_editor_for_table(table, i2, 3, bool(row.get("defaultIncluded")))
            self._set_quote_extra_container_editor_for_table(table, i2, 4, str(row.get("templateContainerId") or ""))
            self._set_quote_extra_placeholder_editor_for_table(table, i2, 5, str(row.get("templatePlaceholderKey") or ""))
            self._set_delete_button(table, i2, 0, self._quote_extra_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=2)
        self._sync_company_quote_settings_row_height()

    def _quote_template_container_options(self) -> list[tuple[str, str]]:
        options: list[tuple[str, str]] = [("", "Not linked")]
        seen: set[str] = set()
        raw_name_map = (self._company or {}).get("quoteTemplateContainerNames")
        name_map = dict(raw_name_map) if isinstance(raw_name_map, dict) else {}
        def _norm(value: str) -> str:
            return " ".join(str(value or "").strip().lower().split())
        def _row_name(row: dict) -> str:
            for key in ("name", "title", "containerName", "label"):
                txt = str((row or {}).get(key) or "").strip()
                if txt:
                    return txt
            return ""

        # Prefer active quote base layout model IDs (used by actual quote render).
        base_model_json = str((self._company or {}).get("quoteBaseLayoutModelJson") or "").strip()
        if base_model_json:
            try:
                parsed = json.loads(base_model_json)
                if isinstance(parsed, dict):
                    for area_name in ("Header", "Footer"):
                        rows = parsed.get(area_name.lower()) if isinstance(parsed.get(area_name.lower()), list) else []
                        for idx, row in enumerate(rows):
                            if not isinstance(row, dict):
                                continue
                            cid = str(row.get("__id") or "").strip()
                            name = str(_row_name(row) or name_map.get(cid) or "").strip()
                            if not cid and name:
                                cid = "name::" + _norm(name)
                            if not cid or cid in seen:
                                continue
                            seen.add(cid)
                            label = name if name else f"{area_name} Container {idx + 1}"
                            options.append((cid, label))
            except Exception:
                pass

        def _layout_rows(prefix: str) -> list[dict]:
            raw_layout = (self._company or {}).get(f"quoteTemplate{prefix}Layout")
            if isinstance(raw_layout, list):
                return [row for row in raw_layout if isinstance(row, dict)]
            raw_json = str((self._company or {}).get(f"quoteTemplate{prefix}LayoutJson") or "").strip()
            if raw_json:
                try:
                    parsed = json.loads(raw_json)
                    if isinstance(parsed, list):
                        return [row for row in parsed if isinstance(row, dict)]
                except Exception:
                    return []
            return []

        areas = (
            ("Header", _layout_rows("Header")),
            ("Footer", _layout_rows("Footer")),
        )
        for area_name, layout_rows in areas:
            for idx, row in enumerate(layout_rows):
                if not isinstance(row, dict):
                    continue
                cid = str(row.get("__id") or "").strip()
                name = str(_row_name(row) or name_map.get(cid) or "").strip()
                if not cid and name:
                    cid = "name::" + _norm(name)
                if not cid or cid in seen:
                    continue
                seen.add(cid)
                label = name if name else f"{area_name} Container {idx + 1}"
                options.append((cid, label))
        return options

    def _set_quote_extra_container_editor_for_table(self, table, row: int, col: int, selected_id: str) -> None:
        combo = QComboBox()
        combo.setFixedHeight(24)
        combo.setStyleSheet(
            "QComboBox { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; padding: 2px 8px; font-size: 12px; color:#1F2937; }"
            "QComboBox:focus { border:1px solid #AFC2DA; }"
            "QComboBox::drop-down { border:none; width:18px; }"
        )
        options = self._quote_template_container_options()
        sel = str(selected_id or "").strip()
        for value, label in options:
            combo.addItem(label, value)
        idx = combo.findData(sel)
        if idx >= 0:
            combo.setCurrentIndex(idx)
        else:
            combo.setCurrentIndex(0)
        combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(combo)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _quote_template_placeholder_options(self) -> list[tuple[str, str]]:
        found: set[str] = set()

        def _scan_text(text: str) -> None:
            txt = str(text or "")
            if not txt:
                return
            for source in (txt, html.unescape(txt)):
                for m in re.finditer(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", source):
                    token = str(m.group(1) or "").strip()
                    if token:
                        found.add(token)

        # Prefer active base layout model/json and fallback html.
        _scan_text(str((self._company or {}).get("quoteBaseLayoutHtml") or ""))
        _scan_text(str((self._company or {}).get("quoteTemplateHeaderHtml") or ""))
        _scan_text(str((self._company or {}).get("quoteTemplateFooterHtml") or ""))
        model_json = str((self._company or {}).get("quoteBaseLayoutModelJson") or "").strip()
        if model_json:
            try:
                parsed = json.loads(model_json)
                def _walk(node):
                    if isinstance(node, dict):
                        for v in node.values():
                            _walk(v)
                    elif isinstance(node, list):
                        for v in node:
                            _walk(v)
                    elif isinstance(node, str):
                        _scan_text(node)
                _walk(parsed)
            except Exception:
                _scan_text(model_json)

        # Reserved tokens should not be bound to quote-extra toggles.
        blocked = {"body"}
        tokens = sorted(t for t in found if t and t.lower() not in blocked)
        return [("", "Not linked")] + [(t, "{{" + t + "}}") for t in tokens]

    def _set_quote_extra_placeholder_editor_for_table(self, table, row: int, col: int, selected_key: str) -> None:
        combo = QComboBox()
        combo.setFixedHeight(24)
        combo.setStyleSheet(
            "QComboBox { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; padding: 2px 8px; font-size: 12px; color:#1F2937; }"
            "QComboBox:focus { border:1px solid #AFC2DA; }"
            "QComboBox::drop-down { border:none; width:18px; }"
        )
        options = self._quote_template_placeholder_options()
        sel = str(selected_key or "").strip().strip("{} ")
        for value, label in options:
            combo.addItem(label, value)
        idx = combo.findData(sel)
        if idx >= 0:
            combo.setCurrentIndex(idx)
        else:
            combo.setCurrentIndex(0)
        combo.currentIndexChanged.connect(lambda _=0: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(combo)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _set_quote_extra_default_editor_for_table(self, table, row: int, col: int, checked: bool) -> None:
        cb = QCheckBox()
        cb.setChecked(bool(checked))
        cb.setCursor(Qt.CursorShape.PointingHandCursor)
        cb.setStyleSheet(
            "QCheckBox::indicator { width:11px; height:11px; }"
        )
        cb.toggled.connect(lambda _=False: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addStretch(1)
        lay.addWidget(cb, 0, Qt.AlignmentFlag.AlignCenter)
        lay.addStretch(1)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _quote_extra_container_value(self, table, row: int, col: int) -> str:
        w = table.cellWidget(row, col)
        if isinstance(w, QWidget):
            combo = w.findChild(QComboBox)
            if isinstance(combo, QComboBox):
                return str(combo.currentData() or "").strip()
        item = table.item(row, col)
        return str(item.text() if item else "").strip()

    def _quote_extra_placeholder_value(self, table, row: int, col: int) -> str:
        w = table.cellWidget(row, col)
        if isinstance(w, QWidget):
            combo = w.findChild(QComboBox)
            if isinstance(combo, QComboBox):
                return str(combo.currentData() or "").strip()
        item = table.item(row, col)
        return str(item.text() if item else "").strip().strip("{} ")

    def _quote_extra_default_value(self, table, row: int, col: int) -> bool:
        w = table.cellWidget(row, col)
        if isinstance(w, QWidget):
            cb = w.findChild(QCheckBox)
            if isinstance(cb, QCheckBox):
                return bool(cb.isChecked())
        item = table.item(row, col)
        return str(item.text() if item else "").strip().lower() in {"1", "true", "yes", "y"}

    def _set_inventory_number_editor_for_table(self, table, row: int, col: int, text: str) -> None:
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        edit.setAlignment(Qt.AlignmentFlag.AlignCenter)
        edit.setStyleSheet(
            "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; padding:3px 8px; font-size:12px; color:#1F2937; }"
            "QLineEdit:focus { border:1px solid #AFC2DA; background:#FFFFFF; }"
        )
        validator = QDoubleValidator(0.0, 999999999.0, 3, edit)
        validator.setNotation(QDoubleValidator.Notation.StandardNotation)
        edit.setValidator(validator)
        edit.textChanged.connect(lambda _=None: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(edit)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _set_quote_extra_name_editor_for_table(self, table, row: int, col: int, text: str) -> None:
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        edit.setStyleSheet(
            "QLineEdit { background:#FFFFFF; border:1px solid #D9E0EA; border-radius:8px; padding:3px 8px; font-size:12px; color:#1F2937; }"
            "QLineEdit:focus { border:1px solid #AFC2DA; background:#FFFFFF; }"
        )
        edit.textChanged.connect(lambda _=None: self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras))
        edit.textChanged.connect(lambda _=None, t=table: self._auto_grow_quote_extra_name_column(t))
        table.setCellWidget(row, col, self._wrap_table_control(edit))
        self._auto_grow_quote_extra_name_column(table)

    def _auto_grow_quote_extra_name_column(self, table) -> None:
        if not isinstance(table, QTableWidget):
            return
        col = 1
        if table.columnCount() <= col:
            return
        header = table.horizontalHeader()
        if header is None:
            return
        min_w = 150
        current_w = int(header.sectionSize(col))
        max_w = min_w
        for r in range(table.rowCount()):
            txt = self._editor_text(table, r, col)
            if not txt:
                continue
            fm = QFontMetrics(table.font())
            host = table.cellWidget(r, col)
            if isinstance(host, QWidget):
                ed = host.findChild(QLineEdit)
                if isinstance(ed, QLineEdit):
                    fm = QFontMetrics(ed.font())
            max_w = max(max_w, int(fm.horizontalAdvance(txt)) + 28)
        # Do not exceed available viewport width.
        other_w = 0
        for c in range(table.columnCount()):
            if c == col:
                continue
            other_w += int(header.sectionSize(c))
        avail_w = int(table.viewport().width()) - other_w - 8
        if avail_w > min_w:
            max_w = min(max_w, avail_w)
        if max_w > current_w:
            header.resizeSection(col, max_w)
        if table is getattr(self, "_company_quote_extras_table", None):
            self._fit_table_to_contents(table, min_rows=2)
            self._sync_company_quote_settings_row_height()

    def _add_company_quote_extra_row(self) -> None:
        rows_list = getattr(self, "_company_quote_extras_rows_list", None)
        if isinstance(rows_list, QListWidget):
            self._add_company_rows_list_widget(rows_list, self._build_quote_extra_row_widget())
            self._fit_company_rows_list_to_contents(rows_list, min_rows=2)
            self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras)
            self._sync_company_quote_settings_row_height()
            return
        table = self._company_quote_extras_table
        if table is None:
            return
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        table.setItem(row, 2, QTableWidgetItem(""))
        table.setItem(row, 3, QTableWidgetItem(""))
        table.setItem(row, 4, QTableWidgetItem(""))
        table.setItem(row, 5, QTableWidgetItem(""))
        self._set_quote_extra_name_editor_for_table(table, row, 1, "")
        self._set_inventory_number_editor_for_table(table, row, 2, "")
        self._set_quote_extra_default_editor_for_table(table, row, 3, False)
        self._set_quote_extra_container_editor_for_table(table, row, 4, "")
        self._set_quote_extra_placeholder_editor_for_table(table, row, 5, "")
        self._set_delete_button(table, row, 0, self._quote_extra_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=2)
        self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras)
        self._sync_company_quote_settings_row_height()

    def _quote_extra_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        rows_list = getattr(self, "_company_quote_extras_rows_list", None)
        if isinstance(rows_list, QListWidget):
            for i, w in enumerate(self._iter_company_rows_list_widgets(rows_list)):
                if sender is w.findChild(QPushButton, "quoteExtraDelete"):
                    self._remove_company_quote_extra_row(row=i)
                    return
        table = self._company_quote_extras_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_quote_extra_row(row=row)

    def _remove_company_quote_extra_row(self, row: int | None = None) -> None:
        rows_list = getattr(self, "_company_quote_extras_rows_list", None)
        if isinstance(rows_list, QListWidget):
            ridx = int(row if row is not None else -1)
            if ridx < 0 or ridx >= rows_list.count():
                return
            it = rows_list.takeItem(ridx)
            if isinstance(it, QListWidgetItem):
                w = rows_list.itemWidget(it)
                if isinstance(w, QWidget):
                    w.setParent(None)
                    w.deleteLater()
            self._fit_company_rows_list_to_contents(rows_list, min_rows=2)
            self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras)
            self._sync_company_quote_settings_row_height()
            return
        table = self._company_quote_extras_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row < 0:
            return
        table.removeRow(row)
        self._refresh_quote_extra_row_widgets()
        self._fit_table_to_contents(table, min_rows=2)
        self._queue_company_autosave("quote_extras", self._autosave_company_quote_extras)
        self._sync_company_quote_settings_row_height()

    def _refresh_quote_extra_row_widgets(self) -> None:
        table = self._company_quote_extras_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            name = self._editor_text(table, row, 1)
            price = self._editor_text(table, row, 2)
            default_included = self._quote_extra_default_value(table, row, 3)
            container_id = self._quote_extra_container_value(table, row, 4)
            placeholder_key = self._quote_extra_placeholder_value(table, row, 5)
            self._set_quote_extra_name_editor_for_table(table, row, 1, name)
            self._set_inventory_number_editor_for_table(table, row, 2, price)
            self._set_quote_extra_default_editor_for_table(table, row, 3, default_included)
            self._set_quote_extra_container_editor_for_table(table, row, 4, container_id)
            self._set_quote_extra_placeholder_editor_for_table(table, row, 5, placeholder_key)
            self._set_delete_button(table, row, 0, self._quote_extra_delete_button_clicked)

    def _save_company_quote_extras(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        rows_list = getattr(self, "_company_quote_extras_rows_list", None)
        table = self._company_quote_extras_table
        if not company_id or (table is None and not isinstance(rows_list, QListWidget)):
            return
        rows: list[dict] = []
        seen: set[str] = set()
        if isinstance(rows_list, QListWidget):
            for w in self._iter_company_rows_list_widgets(rows_list):
                name_w = w.findChild(QLineEdit, "quoteExtraName")
                price_w = w.findChild(QLineEdit, "quoteExtraPrice")
                default_w = w.findChild(QCheckBox, "quoteExtraDefault")
                container_w = w.findChild(QComboBox, "quoteExtraContainer")
                placeholder_w = w.findChild(QComboBox, "quoteExtraPlaceholder")
                name = str(name_w.text() if isinstance(name_w, QLineEdit) else "").strip()
                price = str(price_w.text() if isinstance(price_w, QLineEdit) else "").strip()
                if not name and not price:
                    continue
                if not name:
                    continue
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                parsed = self._inventory_parse_number(price)
                rows.append(
                    {
                        "name": name,
                        "price": "" if parsed is None else f"{parsed:.3f}".rstrip("0").rstrip("."),
                        "defaultIncluded": bool(default_w.isChecked()) if isinstance(default_w, QCheckBox) else False,
                        "templateContainerId": str(container_w.currentData() or "").strip() if isinstance(container_w, QComboBox) else "",
                        "templatePlaceholderKey": str(placeholder_w.currentData() or "").strip().strip("{} ") if isinstance(placeholder_w, QComboBox) else "",
                    }
                )
        else:
            for r in range(table.rowCount()):
                name = self._editor_text(table, r, 1)
                price = self._editor_text(table, r, 2)
                if not name and not price:
                    continue
                if not name:
                    continue
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                parsed = self._inventory_parse_number(price)
                default_included = self._quote_extra_default_value(table, r, 3)
                container_id = self._quote_extra_container_value(table, r, 4)
                placeholder_key = self._quote_extra_placeholder_value(table, r, 5)
                rows.append(
                    {
                        "name": name,
                        "price": "" if parsed is None else f"{parsed:.3f}".rstrip("0").rstrip("."),
                        "defaultIncluded": bool(default_included),
                        "templateContainerId": str(container_id or "").strip(),
                        "templatePlaceholderKey": str(placeholder_key or "").strip().strip("{} "),
                    }
                )
        row_count = rows_list.count() if isinstance(rows_list, QListWidget) else table.rowCount()
        if not rows and not silent_invalid and row_count > 0:
            QMessageBox.warning(self, "Quote Extras", "Add at least one quote extra or clear blank rows.")
            return
        try:
            self.app.company.update_company(company_id, {"quoteExtras": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["quoteExtras"] = rows
        if notify:
            QMessageBox.information(self, "Saved", "Quote extras updated.")

    def _inventory_format_money(self, value: float | None) -> str:
        if value is None:
            return "-"
        return f"${value:.2f}"

    def _set_inventory_number_editor(self, row: int, col: int, text: str, *, is_percent: bool = False) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        edit.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        edit.setStyleSheet(
            "QLineEdit { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }"
        )
        validator = QDoubleValidator(0.0, 999999999.0, 3, edit)
        validator.setNotation(QDoubleValidator.Notation.StandardNotation)
        edit.setValidator(validator)
        edit.textChanged.connect(lambda _=None: self._inventory_editor_changed())
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(5)
        lay.addWidget(edit)
        if is_percent:
            unit = QLabel("%")
            unit.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; }")
            lay.addWidget(unit)
        lay.addStretch(1)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _set_inventory_output_cell(self, row: int, text: str) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        lbl = QLabel(str(text or "-"))
        lbl.setStyleSheet("QLabel { color: #111827; font-size: 12px; font-weight: 700; }")
        lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(lbl)
        table.setCellWidget(row, 6, self._wrap_table_control(host))

    def _inventory_row_values(self, row: int) -> tuple[str, str, str, float | None, float | None]:
        table = self._company_inventory_table
        if table is None:
            return "", "", "", None, None
        name = self._editor_text(table, row, 1)
        category, _category_color = self._inventory_category_value(row)
        subcategory = self._inventory_subcategory_value(row)
        price = self._inventory_parse_number(self._editor_text(table, row, 4))
        markup = self._inventory_parse_number(self._editor_text(table, row, 5))
        return name, category, subcategory, price, markup

    def _refresh_inventory_output_labels(self) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        for r in range(table.rowCount()):
            _name, _category, _subcategory, price, markup = self._inventory_row_values(r)
            if price is None:
                output = None
            else:
                output = float(price) * (1.0 + (float(markup or 0.0) / 100.0))
            self._set_inventory_output_cell(r, self._inventory_format_money(output))

    def _inventory_editor_changed(self) -> None:
        self._refresh_inventory_output_labels()
        self._queue_company_autosave("inventory", self._autosave_company_inventory)

    def _load_company_inventory_rows(self) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        open_category = self._company_inventory_open_category()
        raw = self._company.get("salesInventory")
        if not isinstance(raw, list):
            raw = self._company.get("inventory")
        if not isinstance(raw, list):
            raw = []
        rows: list[dict] = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            category = str(row.get("category") or "").strip()
            subcategory = str(row.get("subcategory") or "").strip()
            price = str(row.get("price") or "").strip()
            markup = str(row.get("markup") or "").strip()
            if name or category or subcategory or price or markup:
                if open_category and category.lower() != open_category.lower():
                    continue
                rows.append({"name": name, "category": category, "subcategory": subcategory, "price": price, "markup": markup})

        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=29)
        for i2, row in enumerate(rows):
            table.setItem(i2, 1, QTableWidgetItem(str(row.get("name") or "")))
            table.setItem(i2, 2, QTableWidgetItem(str(row.get("category") or "")))
            table.setItem(i2, 3, QTableWidgetItem(str(row.get("subcategory") or "")))
            table.setItem(i2, 4, QTableWidgetItem(str(row.get("price") or "")))
            table.setItem(i2, 5, QTableWidgetItem(str(row.get("markup") or "")))
            table.setItem(i2, 6, QTableWidgetItem(""))
            self._set_inventory_category_editor(i2, str(row.get("category") or ""))
            self._set_inventory_subcategory_editor(i2, str(row.get("category") or ""), str(row.get("subcategory") or ""))
            self._set_name_editor(table, i2, 1, str(row.get("name") or ""), lambda _=None: self._inventory_editor_changed())
            self._set_inventory_number_editor(i2, 4, str(row.get("price") or ""), is_percent=False)
            self._set_inventory_number_editor(i2, 5, str(row.get("markup") or ""), is_percent=True)
            self._set_delete_button(table, i2, 0, self._inventory_delete_button_clicked)
            _cat, cat_color = self._inventory_category_value(i2)
            self._inventory_apply_row_tint(i2, cat_color)
        self._refresh_inventory_output_labels()
        table.setColumnHidden(2, bool(open_category))
        self._fit_table_to_contents(table, min_rows=self._inventory_table_min_rows(table))

    def _add_company_inventory_row(self) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        open_category = self._company_inventory_open_category()
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        table.setItem(row, 2, QTableWidgetItem(str(open_category or "")))
        table.setItem(row, 3, QTableWidgetItem(""))
        table.setItem(row, 4, QTableWidgetItem(""))
        table.setItem(row, 5, QTableWidgetItem(""))
        table.setItem(row, 6, QTableWidgetItem(""))
        self._set_name_editor(table, row, 1, "", lambda _=None: self._inventory_editor_changed())
        self._set_inventory_category_editor(row, str(open_category or ""))
        self._set_inventory_subcategory_editor(row, str(open_category or ""), "")
        self._set_inventory_number_editor(row, 4, "", is_percent=False)
        self._set_inventory_number_editor(row, 5, "", is_percent=True)
        self._set_inventory_output_cell(row, "-")
        self._set_delete_button(table, row, 0, self._inventory_delete_button_clicked)
        self._inventory_apply_row_tint(row, "")
        self._fit_table_to_contents(table, min_rows=self._inventory_table_min_rows(table))
        self._queue_company_autosave("inventory", self._autosave_company_inventory)

    def _inventory_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_inventory_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_inventory_row(row=row)

    def _remove_company_inventory_row(self, row: int | None = None) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row < 0:
            return
        table.removeRow(row)
        self._refresh_inventory_row_widgets()
        self._fit_table_to_contents(table, min_rows=self._inventory_table_min_rows(table))
        self._queue_company_autosave("inventory", self._autosave_company_inventory)

    def _refresh_inventory_row_widgets(self) -> None:
        table = self._company_inventory_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            name = self._editor_text(table, row, 1)
            category, _cat_color_before = self._inventory_category_value(row)
            subcategory = self._inventory_subcategory_value(row)
            price = self._editor_text(table, row, 4)
            markup = self._editor_text(table, row, 5)
            self._set_name_editor(table, row, 1, name, lambda _=None: self._inventory_editor_changed())
            self._set_inventory_category_editor(row, category)
            self._set_inventory_subcategory_editor(row, category, subcategory)
            self._set_inventory_number_editor(row, 4, price, is_percent=False)
            self._set_inventory_number_editor(row, 5, markup, is_percent=True)
            self._set_delete_button(table, row, 0, self._inventory_delete_button_clicked)
            if table.item(row, 6) is None:
                table.setItem(row, 6, QTableWidgetItem(""))
            _cat, cat_color = self._inventory_category_value(row)
            self._inventory_apply_row_tint(row, cat_color)
            if table.item(row, 5) is None:
                table.setItem(row, 5, QTableWidgetItem(""))
        self._refresh_inventory_output_labels()

    def _save_company_inventory(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_inventory_table
        if not company_id or table is None:
            return
        open_category = self._company_inventory_open_category()
        rows: list[dict] = []
        for r in range(table.rowCount()):
            name, category, subcategory, price, markup = self._inventory_row_values(r)
            if not name and not category and not subcategory and price is None and markup is None:
                continue
            if not name:
                continue
            rows.append(
                {
                    "name": name,
                    "category": category,
                    "subcategory": subcategory,
                    "price": "" if price is None else f"{price:.3f}".rstrip("0").rstrip("."),
                    "markup": "" if markup is None else f"{markup:.3f}".rstrip("0").rstrip("."),
                }
            )
        if open_category:
            existing_raw = self._company.get("salesInventory")
            if not isinstance(existing_raw, list):
                existing_raw = self._company.get("inventory")
            if not isinstance(existing_raw, list):
                existing_raw = []
            merged: list[dict] = []
            for row in existing_raw:
                if not isinstance(row, dict):
                    continue
                cat = str(row.get("category") or "").strip()
                if cat.lower() == open_category.lower():
                    continue
                merged.append(dict(row))
            merged.extend(rows)
            rows = merged
        if not rows and not silent_invalid and table.rowCount() > 0:
            QMessageBox.warning(self, "Inventory", "Add at least one item name or clear blank rows.")
            return
        try:
            self.app.company.update_company(company_id, {"salesInventory": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["salesInventory"] = rows
        if notify:
            QMessageBox.information(self, "Saved", "Inventory updated.")

    def _set_job_type_price_editor_for_table(self, table, row: int, col: int, text: str) -> None:
        edit = QLineEdit(str(text or ""))
        edit.setFixedHeight(24)
        edit.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        edit.setStyleSheet(
            "QLineEdit { background: #F7F8FA; border: 1px solid #E5E7EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }"
        )
        validator = QDoubleValidator(0.0, 999999999.0, 3, edit)
        validator.setNotation(QDoubleValidator.Notation.StandardNotation)
        edit.setValidator(validator)
        edit.textChanged.connect(lambda _=None: self._queue_company_autosave("job_types", self._autosave_company_job_types))
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(5)
        lay.addWidget(edit)
        unit = QLabel("/sheet")
        unit.setStyleSheet("QLabel { color: #6B7280; font-size: 12px; font-weight: 700; }")
        lay.addWidget(unit)
        lay.addStretch(1)
        table.setCellWidget(row, col, self._wrap_table_control(host))

    def _load_company_job_types_rows(self) -> None:
        table = self._company_job_types_table
        if table is None:
            return
        rows = self._company_sales_job_type_rows()
        table.setRowCount(len(rows))
        self._apply_compact_row_height(table, row_height=29)
        for i2, row in enumerate(rows):
            table.setItem(i2, 1, QTableWidgetItem(str(row.get("name") or "")))
            table.setItem(i2, 2, QTableWidgetItem(str(row.get("pricePerSheet") or "")))
            self._set_name_editor(
                table,
                i2,
                1,
                str(row.get("name") or ""),
                lambda _=None: self._queue_company_autosave("job_types", self._autosave_company_job_types),
            )
            self._set_job_type_price_editor_for_table(table, i2, 2, str(row.get("pricePerSheet") or ""))
            self._set_delete_button(table, i2, 0, self._job_type_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=2)

    def _add_company_job_type_row(self) -> None:
        table = self._company_job_types_table
        if table is None:
            return
        row = table.rowCount()
        table.insertRow(row)
        self._apply_compact_row_height(table, row_height=29)
        table.setItem(row, 1, QTableWidgetItem(""))
        table.setItem(row, 2, QTableWidgetItem(""))
        self._set_name_editor(
            table,
            row,
            1,
            "",
            lambda _=None: self._queue_company_autosave("job_types", self._autosave_company_job_types),
        )
        self._set_job_type_price_editor_for_table(table, row, 2, "")
        self._set_delete_button(table, row, 0, self._job_type_delete_button_clicked)
        self._fit_table_to_contents(table, min_rows=2)
        self._queue_company_autosave("job_types", self._autosave_company_job_types)

    def _job_type_delete_button_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        table = self._company_job_types_table
        row = self._row_from_table_button(table, sender, preferred_col=0) if table else -1
        self._remove_company_job_type_row(row=row)

    def _remove_company_job_type_row(self, row: int | None = None) -> None:
        table = self._company_job_types_table
        if table is None:
            return
        row = table.currentRow() if row is None else int(row)
        if row < 0:
            return
        table.removeRow(row)
        self._refresh_job_type_row_widgets()
        self._fit_table_to_contents(table, min_rows=2)
        self._queue_company_autosave("job_types", self._autosave_company_job_types)

    def _refresh_job_type_row_widgets(self) -> None:
        table = self._company_job_types_table
        if table is None:
            return
        self._apply_compact_row_height(table, row_height=29)
        for row in range(table.rowCount()):
            name = self._editor_text(table, row, 1)
            price = self._editor_text(table, row, 2)
            self._set_name_editor(
                table,
                row,
                1,
                name,
                lambda _=None: self._queue_company_autosave("job_types", self._autosave_company_job_types),
            )
            self._set_job_type_price_editor_for_table(table, row, 2, price)
            self._set_delete_button(table, row, 0, self._job_type_delete_button_clicked)

    def _save_company_job_types(self, notify: bool = True, silent_invalid: bool = False) -> None:
        company_id = getattr(self.router.session, "company_id", None)
        table = self._company_job_types_table
        if not company_id or table is None:
            return
        rows: list[dict] = []
        seen: set[str] = set()
        for r in range(table.rowCount()):
            name = self._editor_text(table, r, 1)
            price_raw = self._editor_text(table, r, 2)
            if not name and not price_raw:
                continue
            if not name:
                continue
            key = " ".join(name.lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            price = self._inventory_parse_number(price_raw)
            rows.append(
                {
                    "name": name,
                    "pricePerSheet": "" if price is None else f"{price:.3f}".rstrip("0").rstrip("."),
                }
            )
        if not rows and not silent_invalid and table.rowCount() > 0:
            QMessageBox.warning(self, "Job Types", "Add at least one job type or clear blank rows.")
            return
        try:
            self.app.company.update_company(company_id, {"salesJobTypes": rows})
        except Exception as exc:
            QMessageBox.critical(self, "Save failed", str(exc))
            return
        self._company["salesJobTypes"] = rows
        try:
            self._refresh_sales_job_type_panel(True, self._selected_project())
            self._refresh_sales_job_type_panel(False, self._selected_project())
            self._refresh_sales_rooms_panel(True, self._selected_project())
            self._refresh_sales_rooms_panel(False, self._selected_project())
        except Exception:
            pass
        if notify:
            QMessageBox.information(self, "Saved", "Job types updated.")
