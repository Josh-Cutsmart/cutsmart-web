from __future__ import annotations

import html
from urllib.request import Request, urlopen

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QIcon, QPixmap
from PySide6.QtWidgets import (
    QFileDialog,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QStackedWidget,
    QTextEdit,
)

from cutsmart.qtui.screens.project_dialogs import FullscreenImageDialog


class ProjectGeneralMediaMixin:
    def _show_general_images_panel(self, use_dashboard: bool) -> None:
            if not self._selected_project():
                QMessageBox.warning(self, "Images", "Select a project first.")
                return
            if bool(use_dashboard):
                self._set_dashboard_detail_tab("general")
                self._set_general_side_panel("images", use_dashboard=True)
            else:
                self._set_project_detail_tab("general")
                self._set_general_side_panel("images", use_dashboard=False)
    
    def _can_upload_project_images(self, raw: dict | None) -> bool:
            if not isinstance(raw, dict):
                return False
            level_fn = getattr(self, "_project_user_access_level", None)
            if callable(level_fn):
                return str(level_fn(raw)) == "edit"
            uid = str(getattr(self.router.session, "uid", "") or "").strip()
            if not uid:
                return False
            payload = self._load_project_settings_payload(raw)
            access_map = self._project_permissions_staff_access(payload)
            return str(access_map.get(uid) or "").strip().lower() == "edit"
    
    def _sync_project_image_upload_buttons(self, raw: dict | None) -> None:
            can_upload = self._can_upload_project_images(raw)
            has_images = bool(self._job_image_paths(raw))
            for btn in (self._dashboard_images_upload_btn, self._detail_images_upload_btn):
                if isinstance(btn, QPushButton):
                    btn.setEnabled(can_upload)
            for btn in (self._dashboard_images_delete_btn, self._detail_images_delete_btn):
                if isinstance(btn, QPushButton):
                    btn.setEnabled(bool(can_upload and has_images))
    
    def _upload_project_images_for_general(self, use_dashboard: bool) -> None:
            raw = self._selected_project()
            if not isinstance(raw, dict):
                QMessageBox.warning(self, "Images", "Select a project first.")
                return
            if not self._can_upload_project_images(raw):
                QMessageBox.warning(self, "Images", "You need Edit permission on this project to upload images.")
                return
            current_paths = self._job_image_paths(raw)
            remaining = max(0, 5 - len(current_paths))
            if remaining <= 0:
                QMessageBox.information(self, "Images", "This project already has 5 images.")
                return
            picked, _ = QFileDialog.getOpenFileNames(
                self,
                "Upload project images",
                "",
                "Image Files (*.png *.jpg *.jpeg *.bmp *.webp)",
            )
            if not picked:
                return
            picked = [str(p).strip() for p in picked if str(p).strip()][:remaining]
            if not picked:
                return
            company_id = getattr(self.router.session, "company_id", None)
            job_id = str((raw or {}).get("id") or "").strip()
            uploaded: list[str] = []
            if company_id and job_id and hasattr(self.app.company, "upload_project_images"):
                try:
                    uploaded = list(self.app.company.upload_project_images(company_id, job_id, picked) or [])
                except Exception as exc:
                    QMessageBox.critical(self, "Image upload failed", str(exc))
                    return
            else:
                uploaded = picked
            merged: list[str] = []
            for p in (current_paths + uploaded):
                txt = str(p or "").strip()
                if txt and txt not in merged:
                    merged.append(txt)
                if len(merged) >= 5:
                    break
            patch = {"projectImages": merged, "imagePaths": merged, "images": merged}
            if self._save_project_patch(patch):
                self._refresh_general_images_lists(self._selected_project())
                self._set_general_side_panel("images", use_dashboard=use_dashboard)
                self._sync_project_image_upload_buttons(self._selected_project())
                self._show_general_images_upload_tick(use_dashboard)
    
    def _show_general_images_upload_tick(self, use_dashboard: bool) -> None:
            btn = self._dashboard_images_upload_btn if use_dashboard else self._detail_images_upload_btn
            self._flash_action_button_tick(btn, "Upload")
    
    def _flash_action_button_tick(self, btn: QPushButton | None, label: str) -> None:
            if not isinstance(btn, QPushButton):
                return
            label_txt = str(label or "").strip() or "Done"
            base_text = str(btn.property("_baseText") or "").strip() or str(btn.text() or label_txt)
            btn.setProperty("_baseText", base_text)
            token = int(btn.property("_tickToken") or 0) + 1
            btn.setProperty("_tickToken", token)
            btn.setText(f"✓ {label_txt}")
    
            def _restore(b=btn, t=token):
                if not isinstance(b, QPushButton):
                    return
                if int(b.property("_tickToken") or 0) != int(t):
                    return
                b.setText(str(b.property("_baseText") or label_txt))
    
            QTimer.singleShot(1200, _restore)
    
    def _delete_current_project_image_for_general(self, use_dashboard: bool) -> None:
            raw = self._selected_project()
            if not isinstance(raw, dict):
                QMessageBox.warning(self, "Images", "Select a project first.")
                return
            if not self._can_upload_project_images(raw):
                QMessageBox.warning(self, "Images", "You need Edit permission on this project to delete images.")
                return
            lst = self._dashboard_images_list if use_dashboard else self._detail_images_list
            if not isinstance(lst, QListWidget) or lst.count() <= 0:
                return
            item = lst.currentItem() or lst.item(0)
            path_txt = str(item.data(Qt.ItemDataRole.UserRole) or "").strip() if isinstance(item, QListWidgetItem) else ""
            if not path_txt:
                return
            paths = self._job_image_paths(raw)
            removed = False
            kept: list[str] = []
            for p in paths:
                txt = str(p or "").strip()
                if not removed and txt == path_txt:
                    removed = True
                    continue
                if txt:
                    kept.append(txt)
            if not removed:
                return
            patch = {"projectImages": kept, "imagePaths": kept, "images": kept}
            if self._save_project_patch(patch):
                self._refresh_general_images_lists(self._selected_project())
                self._set_general_side_panel("images", use_dashboard=use_dashboard)
                self._sync_project_image_upload_buttons(self._selected_project())
                btn = self._dashboard_images_delete_btn if use_dashboard else self._detail_images_delete_btn
                self._flash_action_button_tick(btn, "Delete")
    
    def _set_general_side_panel(self, mode: str, use_dashboard: bool) -> None:
            target = str(mode or "notes").strip().lower()
            if target not in ("notes", "images"):
                target = "notes"
            stack = self._dashboard_general_side_stack if use_dashboard else self._detail_general_side_stack
            title = self._dashboard_general_side_title if use_dashboard else self._detail_general_side_title
            if isinstance(stack, QStackedWidget):
                stack.setCurrentIndex(1 if target == "images" else 0)
            if isinstance(title, QLabel):
                title.setText("IMAGES" if target == "images" else "NOTES")
            upload_btn = self._dashboard_images_upload_btn if use_dashboard else self._detail_images_upload_btn
            delete_btn = self._dashboard_images_delete_btn if use_dashboard else self._detail_images_delete_btn
            show_media_actions = target == "images"
            if isinstance(upload_btn, QPushButton):
                upload_btn.setVisible(show_media_actions)
            if isinstance(delete_btn, QPushButton):
                delete_btn.setVisible(show_media_actions)
            if target == "images":
                self._update_general_image_preview(use_dashboard)
    
    def _refresh_general_images_lists(self, raw: dict | None) -> None:
            paths = self._job_image_paths(raw)
            for is_dashboard, widget in ((True, self._dashboard_images_list), (False, self._detail_images_list)):
                if not isinstance(widget, QListWidget):
                    continue
                widget.clear()
                if not paths:
                    self._update_general_image_preview(is_dashboard)
                    continue
                for p in paths:
                    path_txt = str(p or "").strip()
                    item = QListWidgetItem("")
                    item.setToolTip(path_txt)
                    item.setData(Qt.ItemDataRole.UserRole, path_txt)
                    item.setSizeHint(QSize(90, 90))
                    pix = self._image_preview_pixmap(path_txt)
                    if not pix.isNull():
                        thumb = pix.scaled(
                            QSize(84, 84),
                            Qt.AspectRatioMode.KeepAspectRatio,
                            Qt.TransformationMode.SmoothTransformation,
                        )
                        item.setIcon(QIcon(thumb))
                    widget.addItem(item)
                if widget.count() > 0:
                    widget.setCurrentRow(0)
                self._update_general_image_preview(is_dashboard)
    
    def _update_general_image_preview(self, use_dashboard: bool) -> None:
            lst = self._dashboard_images_list if use_dashboard else self._detail_images_list
            lbl = self._dashboard_images_preview if use_dashboard else self._detail_images_preview
            if not isinstance(lbl, QLabel):
                return
            if not isinstance(lst, QListWidget) or lst.count() <= 0:
                lbl.setPixmap(QPixmap())
                lbl.setText("No images uploaded.")
                lbl.setProperty("imagePath", "")
                return
            item = lst.currentItem() or lst.item(0)
            path_txt = str(item.data(Qt.ItemDataRole.UserRole) or "").strip() if isinstance(item, QListWidgetItem) else ""
            if not path_txt:
                lbl.setPixmap(QPixmap())
                lbl.setText("No preview available.")
                lbl.setProperty("imagePath", "")
                return
            pix = self._image_preview_pixmap(path_txt)
            if pix.isNull():
                lbl.setPixmap(QPixmap())
                lbl.setText("Image not found.")
                lbl.setProperty("imagePath", "")
                return
            target = lbl.size()
            if target.width() < 10 or target.height() < 10:
                target = QSize(420, 260)
            scaled = pix.scaled(target, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            lbl.setText("")
            lbl.setPixmap(scaled)
            lbl.setProperty("imagePath", path_txt)
    
    def _open_general_image_fullscreen(self, use_dashboard: bool) -> None:
            lbl = self._dashboard_images_preview if use_dashboard else self._detail_images_preview
            lst = self._dashboard_images_list if use_dashboard else self._detail_images_list
            if not isinstance(lbl, QLabel) or not isinstance(lst, QListWidget):
                return
            sources: list[str] = []
            for i in range(lst.count()):
                it = lst.item(i)
                if not isinstance(it, QListWidgetItem):
                    continue
                txt = str(it.data(Qt.ItemDataRole.UserRole) or "").strip()
                if txt:
                    sources.append(txt)
            if not sources:
                return
            current = max(0, lst.currentRow())
            dlg = FullscreenImageDialog(
                image_sources=sources,
                start_index=current,
                image_loader=self._image_preview_pixmap,
                parent=self,
            )
            dlg.setModal(False)
            self._open_image_viewers.append(dlg)
            dlg.finished.connect(lambda _=0, d=dlg: setattr(self, "_open_image_viewers", [x for x in self._open_image_viewers if x is not d]))
            dlg.show()
    
    def _image_preview_pixmap(self, source: str) -> QPixmap:
            txt = str(source or "").strip()
            if not txt:
                return QPixmap()
            if txt.lower().startswith("http://") or txt.lower().startswith("https://"):
                try:
                    req = Request(txt, headers={"User-Agent": "CutSmart/1.0"})
                    with urlopen(req, timeout=8) as resp:
                        data = resp.read()
                    pix = QPixmap()
                    if pix.loadFromData(data):
                        return pix
                except Exception:
                    pass
                # Fallback: read via Firebase admin storage API when available.
                try:
                    service = getattr(self.app, "company", None)
                    fetcher = getattr(service, "fetch_remote_image_bytes", None)
                    if callable(fetcher):
                        data = fetcher(txt)
                        pix = QPixmap()
                        if pix.loadFromData(data):
                            return pix
                except Exception:
                    return QPixmap()
                return QPixmap()
            if txt.lower().startswith("gs://"):
                try:
                    service = getattr(self.app, "company", None)
                    fetcher = getattr(service, "fetch_remote_image_bytes", None)
                    if callable(fetcher):
                        data = fetcher(txt)
                        pix = QPixmap()
                        if pix.loadFromData(data):
                            return pix
                except Exception:
                    return QPixmap()
                return QPixmap()
            return QPixmap(txt)
    
    def _autosave_notes_from_editor(self, source: str, notify: bool = False) -> bool:
            raw = self._selected_project()
            if not isinstance(raw, dict):
                return False
            level_fn = getattr(self, "_project_user_access_level", None)
            if callable(level_fn) and str(level_fn(raw)) != "edit":
                return False
            src = str(source or "detail").strip().lower()
            editor = self._dashboard_detail_notes if src == "dashboard" else self._detail_notes
            if not isinstance(editor, QTextEdit):
                return False
            notes = editor.toPlainText().strip()
            current = str((raw or {}).get("notes") or "").strip()
            if notes == current:
                return False
            if not self._save_project_patch({"notes": notes}):
                return False
            self._apply_projects_filters()
            other = self._detail_notes if src == "dashboard" else self._dashboard_detail_notes
            if isinstance(other, QTextEdit) and other.toPlainText().strip() != notes:
                was_blocked = other.blockSignals(True)
                try:
                    other.setPlainText(notes)
                finally:
                    other.blockSignals(was_blocked)
            if notify:
                QMessageBox.information(self, "Saved", "Project notes updated.")
            return True
    
    def _compose_address_region(self, address: str, region: str) -> str:
            addr = str(address or "").strip()
            reg = str(region or "").strip()
            if addr and reg:
                return f"{addr}, {reg}"
            return addr or reg
    
    def _split_address_region(self, combined: str) -> tuple[str, str]:
            text = str(combined or "").strip()
            if not text:
                return "", ""
            if "," not in text:
                return text, ""
            left, right = text.rsplit(",", 1)
            return left.strip(), right.strip()
    
    def _project_meta_two_col_html(self, left_top: str, right_top: str, left_bottom: str, right_bottom: str) -> str:
            lt = html.escape(str(left_top or ""))
            rt = html.escape(str(right_top or ""))
            lb = html.escape(str(left_bottom or ""))
            rb = html.escape(str(right_bottom or ""))
            return (
                "<table width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse;'>"
                "<tr>"
                f"<td width='68%' style='padding:0 10px 2px 0; color:#7B8798; font-size:12px; text-align:left;'>{lt}</td>"
                f"<td width='32%' align='right' style='padding:0 0 2px 10px; color:#7B8798; font-size:12px; white-space:nowrap;'>{rt}</td>"
                "</tr>"
                "<tr>"
                f"<td width='68%' style='padding:2px 10px 0 0; color:#7B8798; font-size:12px; text-align:left;'>{lb}</td>"
                f"<td width='32%' align='right' style='padding:2px 0 0 10px; color:#7B8798; font-size:12px; white-space:nowrap;'>{rb}</td>"
                "</tr>"
                "</table>"
            )
    

