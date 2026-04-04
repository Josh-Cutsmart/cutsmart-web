from __future__ import annotations

from pathlib import Path
from typing import Callable

from PySide6.QtCore import QEvent, QPoint, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QBrush, QColor, QIcon, QPainter, QPainterPath, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHeaderView,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)
class _PhotoSlotButton(QPushButton):
    hover_changed = Signal(bool)

    def enterEvent(self, event) -> None:
        self.hover_changed.emit(True)
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        self.hover_changed.emit(False)
        super().leaveEvent(event)


class _StaffSearchCombo(QComboBox):
    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self._popup: QDialog | None = None
        self._search: QLineEdit | None = None
        self._list: QListWidget | None = None

    def showPopup(self) -> None:
        items = [(str(self.itemText(i) or ""), str(self.itemData(i) or "")) for i in range(self.count())]
        if not items:
            return

        popup = QDialog(self, Qt.WindowType.Popup | Qt.WindowType.FramelessWindowHint)
        popup.setObjectName("StaffSearchPopup")
        popup.setStyleSheet(
            "QDialog#StaffSearchPopup { background:#FFFFFF; border:1px solid #C9CFDA; border-radius:10px; }"
            "QLineEdit { background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:0 8px; min-height:28px; font-size:12px; color:#334155; }"
            "QListWidget { background:#FFFFFF; border:none; outline:0; }"
            "QListWidget::item { padding:6px 8px; border-radius:6px; color:#1F2937; }"
            "QListWidget::item:selected { background:#EEF2F7; color:#111827; }"
            "QListWidget::item:hover { background:#F3F6FA; }"
        )
        lay = QVBoxLayout(popup)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        search = QLineEdit()
        search.setPlaceholderText("Search staff...")
        lay.addWidget(search)

        lst = QListWidget()
        lst.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        lay.addWidget(lst, 1)

        def _fill(filter_text: str = "") -> None:
            term = str(filter_text or "").strip().lower()
            lst.clear()
            for label, uid in items:
                if term and term not in label.lower():
                    continue
                item = QListWidgetItem(label)
                item.setData(Qt.ItemDataRole.UserRole, uid)
                lst.addItem(item)
                if uid == str(self.currentData() or ""):
                    lst.setCurrentItem(item)

        def _choose(item: QListWidgetItem | None) -> None:
            if not isinstance(item, QListWidgetItem):
                return
            uid = str(item.data(Qt.ItemDataRole.UserRole) or "")
            idx = self.findData(uid)
            if idx >= 0:
                self.setCurrentIndex(idx)
            popup.close()

        search.textChanged.connect(_fill)
        lst.itemClicked.connect(_choose)
        lst.itemActivated.connect(_choose)

        _fill("")
        self._popup = popup
        self._search = search
        self._list = lst
        popup.setMinimumWidth(max(self.width(), 260))
        popup.resize(max(self.width(), 260), 240)
        popup.move(self.mapToGlobal(QPoint(0, self.height())))
        popup.show()
        search.setFocus()


class NewProjectDialog(QDialog):
    def __init__(
        self,
        parent: QWidget | None = None,
        show_create_under: bool = True,
        current_user_uid: str = "",
    ):
        super().__init__(parent)
        self.setWindowTitle("Create Project")
        self.setModal(True)
        self.resize(760, 780)
        self._image_paths: list[str] = []
        self._staff_uid_by_index: list[str] = []
        self._photo_slot_buttons: list[_PhotoSlotButton] = []
        self._show_create_under = bool(show_create_under)
        self._current_user_uid = str(current_user_uid or "").strip()
        assets_icons = Path(__file__).resolve().parent.parent / "assets" / "icons"
        self._picture_icon_path = assets_icons / "picture.png"
        self._plus_icon_path = assets_icons / "plus.png"
        self._trash_icon_path = assets_icons / "trash.png"
        self._trash_icon_light = self._build_tinted_icon(self._trash_icon_path, QColor("#FFFFFF"))
        self._trash_icon_raw = QIcon(str(self._trash_icon_path)) if self._trash_icon_path.exists() else QIcon()
        self._empty_slot_icon = self._build_empty_slot_icon()

        self.setStyleSheet("QDialog { background: #F2F4F8; }")

        root = QVBoxLayout(self)
        root.setContentsMargins(14, 12, 14, 12)
        root.setSpacing(8)

        title = QLabel("Create Project")
        title.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        title.setStyleSheet("color:#374151; font-size:24px; font-weight:800;")
        root.addWidget(title)

        main_line = QFrame()
        main_line.setFrameShape(QFrame.Shape.HLine)
        main_line.setStyleSheet("color:#D6DBE4; background:#D6DBE4; min-height:1px; max-height:1px; border:none;")
        root.addWidget(main_line)

        form = QGridLayout()
        form.setHorizontalSpacing(10)
        form.setVerticalSpacing(8)
        form.setColumnStretch(0, 0)
        form.setColumnStretch(1, 1)
        root.addLayout(form, 1)

        self.name = QLineEdit()
        self.name.setPlaceholderText("")
        self.client = QLineEdit()
        self.client.setPlaceholderText("")
        self.client_phone = QLineEdit()
        self.client_phone.setPlaceholderText("(123) 456-7890")
        self.client_email = QLineEdit()
        self.client_email.setPlaceholderText("email@example.com")
        self.project_address = QLineEdit()
        self.project_address.setPlaceholderText("")

        self.region = QLineEdit()
        self.region.setPlaceholderText("Region")

        self.notes = QTextEdit()
        self.notes.setPlaceholderText("")
        self.notes.setFixedHeight(110)

        field_style = (
            "QLineEdit { background:#FFFFFF; border:1px solid #C9CFDA; border-radius:9px; "
            "padding: 0 10px; min-height:34px; font-size:13px; color:#374151; }"
        )
        self._new_project_field_style = field_style
        self._new_project_field_error_style = (
            "QLineEdit { background:#FFF5F5; border:1px solid #EF4444; border-radius:9px; "
            "padding: 0 10px; min-height:34px; font-size:13px; color:#7F1D1D; }"
        )
        for entry in [self.name, self.client, self.client_phone, self.client_email, self.project_address, self.region]:
            entry.setStyleSheet(field_style)

        combo_style = (
            "QComboBox { background:#FFFFFF; border:1px solid #C9CFDA; border-radius:9px; "
            "padding: 0 26px 0 10px; font-size:13px; color:#374151; }"
            "QComboBox::drop-down { border:none; width:22px; }"
            "QComboBox QAbstractItemView { background:#FFFFFF; border:1px solid #C9CFDA; selection-background-color:#EEF2F7; }"
        )
        self.notes.setStyleSheet(
            "QTextEdit { background:#FFFFFF; border:1px solid #C9CFDA; border-radius:9px; "
            "padding: 8px 10px; font-size:13px; color:#374151; }"
        )

        row_defs: list[tuple[str, QWidget]] = [
            ("Project Name:", self.name),
            ("Client Name:", self.client),
            ("Client Phone:", self.client_phone),
            ("Client Email:", self.client_email),
            ("Project Address:", self.project_address),
            ("Region:", self.region),
            ("Notes (optional):", self.notes),
        ]

        r = 0
        for label_text, field in row_defs:
            label = QLabel(label_text)
            label.setStyleSheet("color:#374151; font-size:13px; font-weight:700;")
            form.addWidget(label, r, 0, 1, 1, Qt.AlignmentFlag.AlignVCenter)
            form.addWidget(field, r, 1, 1, 1)
            r += 1
            sep = QFrame()
            sep.setFrameShape(QFrame.Shape.HLine)
            sep.setStyleSheet("color:#D6DBE4; background:#D6DBE4; min-height:1px; max-height:1px; border:none;")
            form.addWidget(sep, r, 0, 1, 2)
            r += 1

        photos_label = QLabel("Photos (up to 5):")
        photos_label.setStyleSheet("color:#374151; font-size:13px; font-weight:700;")
        photos_row = QHBoxLayout()
        photos_row.setSpacing(8)
        for idx in range(5):
            slot_btn = _PhotoSlotButton()
            slot_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            slot_btn.setFixedSize(108, 84)
            slot_btn.setProperty("slotIndex", idx)
            slot_btn.clicked.connect(self._photo_slot_clicked)
            slot_btn.hover_changed.connect(lambda hovered, i=idx: self._on_photo_slot_hover(i, hovered))
            self._photo_slot_buttons.append(slot_btn)
            photos_row.addWidget(slot_btn)
        photos_row.addStretch(1)
        form.addWidget(photos_label, r, 0, 1, 1, Qt.AlignmentFlag.AlignVCenter)
        form.addLayout(photos_row, r, 1, 1, 1)
        r += 1

        sep_after_photos = QFrame()
        sep_after_photos.setFrameShape(QFrame.Shape.HLine)
        sep_after_photos.setStyleSheet("color:#D6DBE4; background:#D6DBE4; min-height:1px; max-height:1px; border:none;")
        form.addWidget(sep_after_photos, r, 0, 1, 2)
        r += 1

        self.create_under = _StaffSearchCombo()
        self.create_under.setFixedHeight(34)
        self.create_under.setStyleSheet(combo_style)
        self._populate_create_under_options()

        if self._show_create_under:
            create_under_lbl = QLabel("Create Project Under:")
            create_under_lbl.setStyleSheet("color:#374151; font-size:13px; font-weight:700;")
            form.addWidget(create_under_lbl, r, 0, 1, 1, Qt.AlignmentFlag.AlignVCenter)
            form.addWidget(self.create_under, r, 1, 1, 1)
            r += 1

            sep_after_create_under = QFrame()
            sep_after_create_under.setFrameShape(QFrame.Shape.HLine)
            sep_after_create_under.setStyleSheet("color:#D6DBE4; background:#D6DBE4; min-height:1px; max-height:1px; border:none;")
            form.addWidget(sep_after_create_under, r, 0, 1, 2)

        action_row = QHBoxLayout()
        action_row.addStretch(1)
        self.create_btn = QPushButton("Create Project")
        self.create_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.create_btn.setFixedSize(220, 40)
        self.create_btn.setStyleSheet(
            "QPushButton { background:#1F66CC; color:#FFFFFF; border:none; border-radius:8px; "
            "font-size:14px; font-weight:800; }"
            "QPushButton:hover { background:#1A57AF; }"
        )
        self.create_btn.clicked.connect(self._validate_then_accept)
        action_row.addWidget(self.create_btn)
        action_row.addStretch(1)
        root.addLayout(action_row)

        self._refresh_photo_slots()

    def _validate_then_accept(self) -> None:
        required_fields: list[tuple[QLineEdit, str]] = [
            (self.name, "Project Name"),
            (self.client, "Client Name"),
            (self.project_address, "Project Address"),
            (self.region, "Region"),
        ]
        missing: list[QLineEdit] = []
        for widget, _label in required_fields:
            if not str(widget.text() or "").strip():
                missing.append(widget)
                self._flash_required_field(widget)
        if missing:
            try:
                missing[0].setFocus()
            except Exception:
                pass
            return
        self.accept()

    def _flash_required_field(self, widget: QLineEdit) -> None:
        if not isinstance(widget, QLineEdit):
            return
        base_style = widget.property("_flashBaseStyle")
        if not isinstance(base_style, str):
            base_style = widget.styleSheet() or ""
            widget.setProperty("_flashBaseStyle", base_style)

        flash_style = (
            base_style
            + "QLineEdit { background:#FFDCDC; border:1px solid #F2A7A7; border-radius:8px; }"
        )

        def _restore() -> None:
            if isinstance(widget, QLineEdit):
                widget.setStyleSheet(base_style)

        def _flash_on() -> None:
            if isinstance(widget, QLineEdit):
                widget.setStyleSheet(flash_style)

        # Match cutlist error pulse pattern.
        _flash_on()
        QTimer.singleShot(180, _restore)
        QTimer.singleShot(280, _flash_on)
        QTimer.singleShot(500, _restore)

    def _populate_create_under_options(self) -> None:
        self.create_under.clear()
        self._staff_uid_by_index = []

        self.create_under.addItem("Myself", self._current_user_uid)
        self._staff_uid_by_index.append(self._current_user_uid)

        staff_rows = []
        parent = self.parent()
        if self._show_create_under and parent is not None:
            maybe_staff = getattr(parent, "_staff_all", None)
            if isinstance(maybe_staff, list):
                staff_rows = [row for row in maybe_staff if isinstance(row, dict)]

        seen = {self._current_user_uid} if self._current_user_uid else set()
        for row in staff_rows:
            uid = str((row or {}).get("uid") or "").strip()
            name = str((row or {}).get("displayName") or (row or {}).get("name") or (row or {}).get("email") or uid).strip()
            if not uid or uid in seen:
                continue
            seen.add(uid)
            self.create_under.addItem(name or uid, uid)
            self._staff_uid_by_index.append(uid)

        if self.create_under.count() == 1 and not self._current_user_uid:
            session = getattr(getattr(parent, "router", None), "session", None) if parent else None
            session_uid = str(getattr(session, "uid", "") or "")
            if session_uid:
                self.create_under.setItemData(0, session_uid)
                self._staff_uid_by_index.append(session_uid)
                self._current_user_uid = session_uid

    def selected_staff_member_uid(self) -> str:
        if not self._show_create_under:
            return str(self._current_user_uid or "").strip()
        return str(self.create_under.currentData() or self._current_user_uid or "").strip()

    def selected_region(self) -> str:
        return str(self.region.text() or "").strip()

    def _photo_slot_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            self._pick_project_photos()
            return
        idx_raw = sender.property("slotIndex")
        try:
            idx = int(idx_raw)
        except Exception:
            idx = -1
        if idx < 0 or idx >= len(self._photo_slot_buttons):
            try:
                idx = self._photo_slot_buttons.index(sender)
            except ValueError:
                idx = -1
        if 0 <= idx < len(self._image_paths):
            self._image_paths.pop(idx)
            self._refresh_photo_slots()
            return
        self._pick_project_photos()

    def _pick_project_photos(self) -> None:
        remaining = 5 - len(self._image_paths)
        if remaining <= 0:
            QMessageBox.information(self, "Photo limit", "You can upload up to 5 photos.")
            return
        picked, _ = QFileDialog.getOpenFileNames(
            self,
            "Select project photos",
            "",
            "Image Files (*.png *.jpg *.jpeg *.bmp *.webp)",
        )
        if not picked:
            return
        for path in picked:
            txt = str(path or "").strip()
            if not txt or txt in self._image_paths:
                continue
            if len(self._image_paths) >= 5:
                break
            self._image_paths.append(txt)
        self._refresh_photo_slots()
        if len(picked) > remaining:
            QMessageBox.information(self, "Photo limit", "Only the first 5 photos were kept.")

    def _refresh_photo_slots(self) -> None:
        for idx, btn in enumerate(self._photo_slot_buttons):
            if idx < len(self._image_paths):
                self._set_photo_slot_thumbnail(idx, hovered=False)
            else:
                btn.setIcon(self._empty_slot_icon if not self._empty_slot_icon.isNull() else QIcon())
                btn.setIconSize(QSize(36, 36))
                btn.setText("")
                btn.setToolTip("Add Photo")
                btn.setStyleSheet(
                    "QPushButton { background:#FFFFFF; color:#2563C9; border:1px solid #C9CFDA; border-radius:8px; "
                    "font-size:11px; font-weight:700; text-align:center; padding:6px; }"
                    "QPushButton:hover { background:#F3F7FF; border-color:#AFC5E8; }"
                )

    def _on_photo_slot_hover(self, idx: int, hovered: bool) -> None:
        if 0 <= idx < len(self._image_paths):
            self._set_photo_slot_thumbnail(idx, hovered=bool(hovered))

    def _set_photo_slot_thumbnail(self, idx: int, hovered: bool) -> None:
        if idx < 0 or idx >= len(self._photo_slot_buttons):
            return
        btn = self._photo_slot_buttons[idx]
        pix = QPixmap(str(self._image_paths[idx] if idx < len(self._image_paths) else ""))
        if pix.isNull():
            btn.setIcon(QIcon())
            btn.setText("Image unavailable")
            return

        tile_w = max(1, btn.width() - 2)
        tile_h = max(1, btn.height() - 2)
        thumb = pix.scaled(tile_w, tile_h, Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation)
        rounded = QPixmap(tile_w, tile_h)
        rounded.fill(Qt.GlobalColor.transparent)
        painter = QPainter(rounded)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        clip = QPainterPath()
        clip.addRoundedRect(0, 0, float(tile_w), float(tile_h), 8.0, 8.0)
        painter.setClipPath(clip)
        painter.drawPixmap(0, 0, thumb)
        if hovered:
            painter.fillRect(rounded.rect(), QColor(220, 38, 38, 145))
            if not self._trash_icon_light.isNull():
                trash_pix = self._trash_icon_light.pixmap(QSize(30, 30))
            elif not self._trash_icon_raw.isNull():
                trash_pix = self._trash_icon_raw.pixmap(QSize(30, 30))
            else:
                trash_pix = QPixmap()
            if not trash_pix.isNull():
                x = (rounded.width() - trash_pix.width()) // 2
                y = (rounded.height() - trash_pix.height()) // 2
                painter.drawPixmap(x, y, trash_pix)
        painter.end()
        btn.setIcon(QIcon(rounded))
        if hovered:
            btn.setStyleSheet(
                "QPushButton { background:#FEE2E2; border:1px solid #EF4444; border-radius:8px; padding:0; }"
            )
        else:
            btn.setStyleSheet(
                "QPushButton { background:#FFFFFF; border:1px solid #C9CFDA; border-radius:8px; padding:0; }"
            )
        btn.setIconSize(QSize(tile_w, tile_h))
        btn.setText("")
        btn.setToolTip("Click to remove photo")

    def _build_empty_slot_icon(self) -> QIcon:
        theme = self._company_theme_qcolor()
        picture_icon = self._build_tinted_icon(self._picture_icon_path, theme)
        plus_icon = self._build_tinted_icon(self._plus_icon_path, theme)
        if picture_icon.isNull() and plus_icon.isNull():
            return QIcon()

        canvas = QPixmap(44, 44)
        canvas.fill(Qt.GlobalColor.transparent)
        painter = QPainter(canvas)
        if not picture_icon.isNull():
            pic = picture_icon.pixmap(QSize(20, 20))
            painter.drawPixmap((canvas.width() - pic.width()) // 2, 4, pic)
        if not plus_icon.isNull():
            plus = plus_icon.pixmap(QSize(12, 12))
            painter.drawPixmap((canvas.width() - plus.width()) // 2, 28, plus)
        painter.end()
        return QIcon(canvas)

    def _company_theme_qcolor(self) -> QColor:
        parent = self.parent()
        company = getattr(parent, "_company", {}) if parent is not None else {}
        raw = str((company or {}).get("themeColor") or "#2F6BFF").strip()
        color = QColor(raw)
        return color if color.isValid() else QColor("#2F6BFF")

    @staticmethod
    def _build_tinted_icon(path: Path, color: QColor) -> QIcon:
        if not path.exists():
            return QIcon()
        src = QPixmap(str(path))
        if src.isNull():
            return QIcon()
        out = QPixmap(src.size())
        out.fill(Qt.GlobalColor.transparent)
        painter = QPainter(out)
        painter.drawPixmap(0, 0, src)
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_SourceIn)
        painter.fillRect(out.rect(), color)
        painter.end()
        return QIcon(out)

    def image_paths(self) -> list[str]:
        return list(self._image_paths)


class SalesItemsDialog(QDialog):
    _ALL_CATEGORY_KEY = "__all__"

    def __init__(
        self,
        items: list[dict] | None = None,
        inventory_rows: list[dict] | None = None,
        item_categories: list[dict] | None = None,
        rooms: list[str] | None = None,
        project_name: str = "",
        theme_hex: str = "#2F6BFF",
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle("Items")
        self.setModal(False)
        self.resize(760, 540)
        self.setMinimumSize(760, 540)
        self.setMaximumSize(16777215, 16777215)
        self.setSizeGripEnabled(True)
        self.setWindowFlag(Qt.WindowType.WindowMaximizeButtonHint, True)
        self.setWindowFlag(Qt.WindowType.WindowMinimizeButtonHint, True)
        QTimer.singleShot(0, self.showMaximized)
        self._rows: list[dict] = [dict(r) for r in (items or []) if isinstance(r, dict)]
        self._inventory_rows: list[dict] = [dict(r) for r in (inventory_rows or []) if isinstance(r, dict)]
        self._item_categories: list[dict] = [dict(r) for r in (item_categories or []) if isinstance(r, dict)]
        self._room_layouts: dict[str, QVBoxLayout] = {}
        self._room_item_combos: dict[str, QComboBox] = {}
        self._room_selected_category: dict[str, str] = {}
        self._room_selected_subcategory: dict[str, str] = {}
        self._room_category_buttons: dict[str, dict[str, QPushButton]] = {}
        self._room_subcategory_layouts: dict[str, QHBoxLayout] = {}
        self._room_category_collapsed: dict[str, dict[str, bool]] = {}
        self._categories: list[str] = self._resolve_categories()
        self._rooms: list[str] = self._resolve_rooms(rooms or [])
        theme = QColor(str(theme_hex or "#2F6BFF"))
        if not theme.isValid():
            theme = QColor("#2F6BFF")
        self._theme_hex = theme.name()
        self._theme_soft = theme.lighter(190).name()
        self._theme_soft_hover = theme.lighter(176).name()

        root = QVBoxLayout(self)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(10)

        top_bar = QFrame()
        top_bar.setObjectName("itemsTopBar")
        top_bar.setStyleSheet("QFrame#itemsTopBar { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:14px; }")
        top_bar.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        top_lay = QHBoxLayout(top_bar)
        top_lay.setContentsMargins(14, 12, 14, 10)
        top_lay.setSpacing(6)
        items_icon = QLabel()
        items_icon.setStyleSheet("QLabel { background:transparent; border:none; }")
        icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "sort-amount-down-alt.png"
        icon_pix = QPixmap(str(icon_path)) if icon_path.exists() else QPixmap()
        if not icon_pix.isNull():
            items_icon.setPixmap(icon_pix.scaled(14, 14, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        items_icon.setFixedSize(16, 16)
        top_lay.addWidget(items_icon, 0, Qt.AlignmentFlag.AlignVCenter)
        top_title = QLabel("ITEMS")
        top_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none; }")
        top_lay.addWidget(top_title, 0, Qt.AlignmentFlag.AlignVCenter)
        title_div = QLabel("  |  ")
        title_div.setStyleSheet("QLabel { color:#64748B; font-size:13px; font-weight:700; background:transparent; border:none; }")
        top_lay.addWidget(title_div, 0, Qt.AlignmentFlag.AlignVCenter)
        job_name = QLabel(str(project_name or "-"))
        job_name.setStyleSheet("QLabel { color:#334155; font-size:13px; font-weight:700; background:transparent; border:none; }")
        top_lay.addWidget(job_name, 0, Qt.AlignmentFlag.AlignVCenter)
        top_lay.addStretch(1)
        root.addWidget(top_bar, 0)
        top_bar.setFixedHeight(max(40, top_bar.sizeHint().height()))

        content = QWidget()
        content_lay = QHBoxLayout(content)
        content_lay.setContentsMargins(0, 0, 0, 0)
        content_lay.setSpacing(10)

        if not self._rooms:
            no_rooms_host = QWidget()
            no_rooms_host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
            no_rooms_lay = QVBoxLayout(no_rooms_host)
            no_rooms_lay.setContentsMargins(0, 0, 0, 0)
            no_rooms_lay.setSpacing(0)
            no_rooms = QLabel("Add rooms first in the Rooms section.")
            no_rooms.setStyleSheet("QLabel { color:#94A3B8; font-size:12px; font-weight:700; }")
            no_rooms_lay.addWidget(no_rooms, 0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
            no_rooms_lay.addStretch(1)
            root.addWidget(no_rooms_host, 1)
        else:
            for room_name in self._rooms:
                room_stack = QWidget()
                room_stack_lay = QVBoxLayout(room_stack)
                room_stack_lay.setContentsMargins(0, 0, 0, 0)
                room_stack_lay.setSpacing(8)

                controls_card = QFrame()
                controls_card.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }")
                col_lay = QVBoxLayout(controls_card)
                col_lay.setContentsMargins(0, 0, 0, 0)
                col_lay.setSpacing(0)

                room_content = QWidget()
                room_content_lay = QVBoxLayout(room_content)
                room_content_lay.setContentsMargins(10, 10, 10, 8)
                room_content_lay.setSpacing(8)

                title = QLabel(room_name)
                title.setStyleSheet("QLabel { color:#0F2A4A; font-size:12px; font-weight:800; border:none; background:transparent; }")
                room_content_lay.addWidget(title, 0, Qt.AlignmentFlag.AlignLeft)

                cats_host = QWidget()
                cats_lay = QHBoxLayout(cats_host)
                cats_lay.setContentsMargins(0, 0, 0, 0)
                cats_lay.setSpacing(6)
                self._room_category_buttons[room_name] = {}
                selected_cat = self._ALL_CATEGORY_KEY
                self._room_selected_category[room_name] = selected_cat
                self._room_selected_subcategory[room_name] = ""
                all_btn = QPushButton("All")
                all_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                all_btn.clicked.connect(lambda _=False, rn=room_name: self._set_room_selected_category(rn, self._ALL_CATEGORY_KEY))
                self._room_category_buttons[room_name][self._ALL_CATEGORY_KEY] = all_btn
                cats_lay.addWidget(all_btn, 0)
                for cidx, cat in enumerate(self._categories):
                    cbtn = QPushButton(cat)
                    cbtn.setCursor(Qt.CursorShape.PointingHandCursor)
                    cbtn.clicked.connect(lambda _=False, rn=room_name, cc=cat: self._set_room_selected_category(rn, cc))
                    self._room_category_buttons[room_name][cat] = cbtn
                    cats_lay.addWidget(cbtn, 0)
                cats_lay.addStretch(1)
                room_content_lay.addWidget(cats_host, 0)

                subcats_host = QWidget()
                subcats_lay = QHBoxLayout(subcats_host)
                subcats_lay.setContentsMargins(0, 0, 0, 0)
                subcats_lay.setSpacing(6)
                subcats_host.setFixedHeight(24)
                self._room_subcategory_layouts[room_name] = subcats_lay
                room_content_lay.addWidget(subcats_host, 0)

                combo = QComboBox()
                combo.setFixedHeight(30)
                combo.setStyleSheet(
                    "QComboBox { background:#F7F8FA; border:1px solid #E4E6EC; border-radius:8px; padding:0 22px 0 8px; font-size:12px; }"
                    "QComboBox::drop-down { border:none; width:20px; }"
                    "QComboBox::down-arrow { image: none; }"
                )
                combo.addItem("Select item...", {"name": ""})
                self._room_item_combos[room_name] = combo
                combo_host = QWidget()
                combo_host_lay = QHBoxLayout(combo_host)
                combo_host_lay.setContentsMargins(0, 4, 0, 4)
                combo_host_lay.setSpacing(0)
                combo_host_lay.addWidget(combo, 1)
                room_content_lay.addWidget(combo_host, 0)
                self._refresh_room_subcategory_buttons(room_name)
                self._refresh_room_item_combo(room_name)
                self._apply_room_category_button_styles(room_name)
                col_lay.addWidget(room_content, 0)

                add_btn = QPushButton("Add to Job")
                add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                add_btn.setMinimumHeight(42)
                add_btn.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                add_btn.setStyleSheet(
                    "QPushButton { background: #DDF2E7; color: #1F6A3B; border: 0px; border-left: 0px; border-right: 0px; border-bottom: 0px; border-top: 1px solid #BFE8CF; border-top-left-radius: 0px; border-top-right-radius: 0px; border-bottom-left-radius: 11px; border-bottom-right-radius: 11px; padding: 8px 12px; font-size: 14px; font-weight: 800; text-align: center; }"
                    "QPushButton:hover { background: #BEE6D0; color: #17552F; border: 0px; border-left: 0px; border-right: 0px; border-bottom: 0px; border-top: 1px solid #BFE8CF; }"
                )
                add_btn.clicked.connect(lambda _=False, rn=room_name: self._add_item_row(rn))
                col_lay.addWidget(add_btn, 0)

                items_card = QFrame()
                items_card.setStyleSheet("QFrame { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }")
                items_lay = QVBoxLayout(items_card)
                items_lay.setContentsMargins(10, 10, 10, 10)
                items_lay.setSpacing(6)

                items_title = QLabel("ADDED ITEMS")
                items_title.setStyleSheet("QLabel { color:#0F2A4A; font-size:11px; font-weight:800; letter-spacing:0.5px; border:none; background:transparent; }")
                items_lay.addWidget(items_title, 0, Qt.AlignmentFlag.AlignLeft)

                items_div = QFrame()
                items_div.setFixedHeight(1)
                items_div.setStyleSheet("QFrame { background:#E5EAF2; border:none; }")
                items_lay.addWidget(items_div, 0)

                list_host = QWidget()
                list_lay = QVBoxLayout(list_host)
                list_lay.setContentsMargins(0, 0, 0, 0)
                list_lay.setSpacing(6)
                self._room_layouts[room_name] = list_lay
                items_lay.addWidget(list_host, 1)

                room_stack_lay.addWidget(controls_card, 0)
                room_stack_lay.addWidget(items_card, 1)
                content_lay.addWidget(room_stack, 1)

            root.addWidget(content, 1)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(self.reject)
        buttons.button(QDialogButtonBox.StandardButton.Close).clicked.connect(self.accept)
        root.addWidget(buttons, 0)

        self._reload_columns()

    def _resolve_categories(self) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()

        def _add(value: str) -> None:
            txt = str(value or "").strip()
            if not txt:
                return
            key = txt.lower()
            if key in seen:
                return
            seen.add(key)
            out.append(txt)

        for row in self._item_categories:
            _add(str((row or {}).get("name") or ""))
        for row in self._inventory_rows:
            _add(str((row or {}).get("category") or ""))
        for row in self._rows:
            _add(str((row or {}).get("category") or ""))
        if not out:
            out = ["Items"]
        return out

    def _category_color_map(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for row in self._item_categories:
            if not isinstance(row, dict):
                continue
            name = str((row or {}).get("name") or "").strip()
            color = str((row or {}).get("color") or "").strip()
            if not name:
                continue
            q = QColor(color)
            out[name.lower()] = q.name() if q.isValid() else "#7D99B3"
        return out

    def _subcategory_rows_for_category(self, category: str) -> list[dict]:
        cat_key = str(category or "").strip().lower()
        if not cat_key:
            return []
        for row in self._item_categories:
            if not isinstance(row, dict):
                continue
            name = str((row or {}).get("name") or "").strip()
            if name.lower() != cat_key:
                continue
            values = (row or {}).get("subcategories")
            out: list[dict] = []
            seen: set[str] = set()
            if isinstance(values, list):
                for value in values:
                    if isinstance(value, dict):
                        sub_name = str(value.get("name") or "").strip()
                        sub_col = str(value.get("color") or "").strip()
                    else:
                        sub_name = str(value or "").strip()
                        sub_col = ""
                    if not sub_name:
                        continue
                    key = sub_name.lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    qc = QColor(sub_col)
                    out.append({"name": sub_name, "color": qc.name() if qc.isValid() else ""})
            return out
        return []

    def _subcategory_color_for(self, category: str, subcategory: str) -> str:
        cat_map = self._category_color_map()
        key = str(category or "").strip().lower()
        fallback = str(cat_map.get(key, "") or "").strip()
        if not fallback and key:
            for k, v in cat_map.items():
                if str(k or "").strip().lower() == key:
                    fallback = str(v or "").strip()
                    break
        q2 = QColor(fallback)
        return q2.name() if q2.isValid() else "#7D99B3"

    def _resolve_rooms(self, rooms: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for room in rooms:
            txt = str(room or "").strip()
            if not txt:
                continue
            key = " ".join(txt.lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(txt)
        for row in self._rows:
            txt = str((row or {}).get("room") or "").strip()
            if not txt:
                continue
            key = " ".join(txt.lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(txt)
        return out

    def _inventory_options_for_category(self, category: str) -> list[dict]:
        out: list[dict] = []
        seen: set[str] = set()
        cat_key = str(category or "").strip().lower()
        all_mode = cat_key in {"", self._ALL_CATEGORY_KEY}
        for row in self._inventory_rows:
            if not isinstance(row, dict):
                continue
            nm = str(row.get("name") or "").strip()
            cat = str(row.get("category") or "").strip()
            if not nm:
                continue
            if (not all_mode) and cat_key and cat.lower() != cat_key:
                continue
            sub = str(row.get("subcategory") or "").strip()
            key = f"{cat.lower()}|{nm.lower()}|{sub.lower()}"
            if key in seen:
                continue
            seen.add(key)
            out.append({"name": nm, "category": cat, "subcategory": sub})
        out.sort(key=lambda r: f"{str(r.get('category') or '').lower()}|{str(r.get('subcategory') or '').lower()}|{str(r.get('name') or '').lower()}")
        return out

    def _normalize_category(self, value: str) -> str:
        txt = str(value or "").strip().lower()
        for name in self._categories:
            if txt == name.lower():
                return name
        if self._categories:
            return self._categories[0]
        return "Items"

    def _set_room_selected_category(self, room_name: str, category: str) -> None:
        if room_name not in self._room_selected_category:
            return
        selected = self._ALL_CATEGORY_KEY if str(category or "").strip().lower() == self._ALL_CATEGORY_KEY else self._normalize_category(category)
        self._room_selected_category[room_name] = selected
        self._room_selected_subcategory[room_name] = ""
        self._refresh_room_subcategory_buttons(room_name)
        self._refresh_room_item_combo(room_name)
        self._apply_room_category_button_styles(room_name)

    def _set_room_selected_subcategory(self, room_name: str, subcategory: str) -> None:
        if room_name not in self._room_selected_subcategory:
            return
        self._room_selected_subcategory[room_name] = str(subcategory or "").strip()
        self._refresh_room_item_combo(room_name)
        self._refresh_room_subcategory_buttons(room_name)

    def _refresh_room_subcategory_buttons(self, room_name: str) -> None:
        lay = self._room_subcategory_layouts.get(room_name)
        if not isinstance(lay, QHBoxLayout):
            return
        while lay.count():
            it = lay.takeAt(0)
            w = it.widget()
            if isinstance(w, QWidget):
                w.deleteLater()
        category = self._room_selected_category.get(room_name, self._ALL_CATEGORY_KEY)
        if str(category).strip().lower() == self._ALL_CATEGORY_KEY:
            return
        sub_rows = self._subcategory_rows_for_category(category)
        if not sub_rows:
            return
        selected_sub = str(self._room_selected_subcategory.get(room_name, "") or "").strip().lower()
        all_btn = QPushButton("All sub")
        all_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        all_btn.clicked.connect(lambda _=False, rn=room_name: self._set_room_selected_subcategory(rn, ""))
        all_sel = selected_sub == ""
        all_btn.setStyleSheet(
            "QPushButton { background:#EEF2F7; color:#334155; border:none; border-radius:8px; padding:3px 8px; font-size:10px; font-weight:700; }"
            "QPushButton:hover { background:#E2E8F0; }"
            if not all_sel else
            "QPushButton { background:#334155; color:#FFFFFF; border:none; border-radius:8px; padding:3px 8px; font-size:10px; font-weight:800; }"
        )
        lay.addWidget(all_btn, 0)
        for row in sub_rows:
            nm = str((row or {}).get("name") or "").strip()
            col = str(self._subcategory_color_for(category, nm) or "").strip()
            if not nm:
                continue
            qc = QColor(col if QColor(col).isValid() else "#7D99B3")
            soft = qc.lighter(165).name()
            hover = qc.lighter(150).name()
            strong = qc.name()
            soft_text = "#0F2A4A" if QColor(soft).lightness() > 140 else "#FFFFFF"
            strong_text = "#FFFFFF" if qc.lightness() < 150 else "#0F2A4A"
            is_sel = nm.lower() == selected_sub
            btn = QPushButton(nm)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _=False, rn=room_name, sn=nm: self._set_room_selected_subcategory(rn, sn))
            btn.setStyleSheet(
                "QPushButton { "
                f"background:{strong}; color:{strong_text}; border:none; border-radius:8px; padding:3px 8px; font-size:10px; font-weight:800; }}"
                if is_sel else
                "QPushButton { "
                f"background:{soft}; color:{soft_text}; border:none; border-radius:8px; padding:3px 8px; font-size:10px; font-weight:700; }}"
                f"QPushButton:hover {{ background:{hover}; }}"
            )
            lay.addWidget(btn, 0)
        lay.addStretch(1)

    def _refresh_room_item_combo(self, room_name: str) -> None:
        combo = self._room_item_combos.get(room_name)
        if not isinstance(combo, QComboBox):
            return
        category = self._room_selected_category.get(room_name, "")
        selected_sub = str(self._room_selected_subcategory.get(room_name, "") or "").strip().lower()
        combo.blockSignals(True)
        combo.clear()
        combo.addItem("Select item...", {"name": ""})
        for row in self._inventory_options_for_category(category):
            nm = str(row.get("name") or "").strip()
            cat = str(row.get("category") or "").strip()
            sub = str(row.get("subcategory") or "").strip()
            if not nm:
                continue
            if selected_sub and sub.lower() != selected_sub:
                continue
            display = f"[{cat}] {sub} - {nm}" if (str(category).strip().lower() == self._ALL_CATEGORY_KEY and sub) else (f"{sub} - {nm}" if sub else nm)
            combo.addItem(display, {"name": nm, "category": cat, "subcategory": sub})
            idx = combo.count() - 1
            sub_col = self._subcategory_color_for(cat, sub)
            if sub_col:
                combo.setItemData(idx, QBrush(QColor(sub_col)), Qt.ItemDataRole.ForegroundRole)
        combo.setCurrentIndex(0)
        combo.blockSignals(False)

    def _apply_room_category_button_styles(self, room_name: str) -> None:
        buttons = self._room_category_buttons.get(room_name) or {}
        selected = self._room_selected_category.get(room_name, "")
        color_map = self._category_color_map()
        for cat, btn in buttons.items():
            if not isinstance(btn, QPushButton):
                continue
            if str(cat).strip().lower() == self._ALL_CATEGORY_KEY:
                is_sel = str(selected).strip().lower() == self._ALL_CATEGORY_KEY
                if is_sel:
                    btn.setStyleSheet(
                        "QPushButton { background:#334155; color:#FFFFFF; border:none; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:800; }"
                    )
                else:
                    btn.setStyleSheet(
                        "QPushButton { background:#EEF2F7; color:#334155; border:none; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:700; }"
                        "QPushButton:hover { background:#E2E8F0; }"
                    )
                continue
            base = QColor(color_map.get(str(cat).strip().lower(), "#7D99B3"))
            if not base.isValid():
                base = QColor("#7D99B3")
            soft = base.lighter(165).name()
            soft_hover = base.lighter(150).name()
            strong = base.name()
            soft_text = "#0F2A4A" if QColor(soft).lightness() > 140 else "#FFFFFF"
            strong_text = "#FFFFFF" if base.lightness() < 150 else "#0F2A4A"
            is_sel = str(cat).strip().lower() == str(selected).strip().lower()
            if is_sel:
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background:{strong}; color:{strong_text}; border:none; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:800; }}"
                )
            else:
                btn.setStyleSheet(
                    "QPushButton { "
                    f"background:{soft}; color:{soft_text}; border:none; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:700; }}"
                    f"QPushButton:hover {{ background:{soft_hover}; }}"
                )

    def _reload_columns(self) -> None:
        for layout in self._room_layouts.values():
            while layout.count():
                item = layout.takeAt(0)
                w = item.widget()
                if w is not None:
                    w.deleteLater()
        color_map = self._category_color_map()
        room_rows: dict[str, list[tuple[int, str, str, str]]] = {}
        for idx, row in enumerate(self._rows):
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            room_name = str(row.get("room") or "").strip()
            if not room_name:
                continue
            category = self._normalize_category(str(row.get("category") or ""))
            subcategory = str(row.get("subcategory") or "").strip()
            room_rows.setdefault(room_name, []).append((idx, category, subcategory, name))

        for room_name, layout in self._room_layouts.items():
            grouped: dict[str, list[tuple[int, str, str]]] = {}
            category_order: list[str] = []
            for idx, category, subcategory, name in room_rows.get(room_name, []):
                key = str(category or "").strip()
                if key not in grouped:
                    grouped[key] = []
                    category_order.append(key)
                grouped[key].append((idx, subcategory, name))

            for group_idx, category in enumerate(category_order):
                if group_idx > 0:
                    layout.addSpacing(4)
                cat_label = str(category or "").strip() or "Uncategorized"
                cat_col = QColor(str(color_map.get(cat_label.lower(), "#7D99B3") or "#7D99B3"))
                if not cat_col.isValid():
                    cat_col = QColor("#7D99B3")
                cat_bg = cat_col.lighter(175).name()
                cat_text = cat_col.darker(160).name() if cat_col.lightness() > 120 else "#FFFFFF"
                is_collapsed = bool((self._room_category_collapsed.get(room_name) or {}).get(cat_label.lower(), False))

                cat_header = QWidget()
                cat_header.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                cat_header_lay = QHBoxLayout(cat_header)
                cat_header_lay.setContentsMargins(8, 0, 6, 0)
                cat_header_lay.setSpacing(6)
                cat_header.setFixedHeight(22)
                cat_header.setStyleSheet(
                    "QWidget { "
                    f"background:{cat_bg}; border:1px solid {cat_col.lighter(125).name()}; border-radius:7px; "
                    "}"
                )

                cat_title = QLabel(cat_label)
                cat_title.setStyleSheet(
                    "QLabel { "
                    f"background:transparent; color:{cat_text}; border:none; font-size:11px; font-weight:800; "
                    "}"
                )
                cat_header_lay.addWidget(cat_title, 1)

                toggle_btn = QPushButton("+" if is_collapsed else "-")
                toggle_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                toggle_btn.setFixedSize(18, 18)
                toggle_btn.setStyleSheet(
                    "QPushButton { background:#FFFFFF; color:#334155; border:1px solid #BFC7D4; border-radius:4px; font-size:12px; font-weight:900; padding:0; }"
                    "QPushButton:hover { background:#F4F6FA; color:#0F172A; border-color:#AEB7C7; }"
                )
                toggle_btn.clicked.connect(lambda _=False, rn=room_name, cc=cat_label: self._toggle_room_category_collapsed(rn, cc))
                cat_header_lay.addWidget(toggle_btn, 0)
                layout.addWidget(cat_header, 0)

                if not is_collapsed:
                    for idx, subcategory, name in grouped.get(category, []):
                        row_host = QWidget()
                        row_host.setFixedHeight(24)
                        row_host.setSizePolicy(row_host.sizePolicy().horizontalPolicy(), QSizePolicy.Policy.Fixed)
                        row_lay = QHBoxLayout(row_host)
                        row_lay.setContentsMargins(0, 0, 0, 0)
                        row_lay.setSpacing(6)
                        if subcategory:
                            sub_color = QColor(self._subcategory_color_for(category, subcategory) or "#7D99B3")
                            if not sub_color.isValid():
                                sub_color = QColor("#7D99B3")
                            pill_bg = sub_color.lighter(175).name()
                            pill_border = sub_color.lighter(130).name()
                            pill_text = sub_color.darker(170).name() if sub_color.lightness() > 120 else "#FFFFFF"
                            pill = QLabel(subcategory)
                            pill.setFixedHeight(18)
                            pill.setStyleSheet(
                                "QLabel { "
                                f"background:{pill_bg}; color:{pill_text}; border:1px solid {pill_border}; border-radius:8px; "
                                "padding:0 7px; font-size:10px; font-weight:800; }"
                            )
                            row_lay.addWidget(pill, 0)

                        txt = QLabel(name)
                        txt.setStyleSheet("QLabel { color:#111827; font-size:12px; font-weight:600; }")
                        del_btn = QPushButton("X")
                        del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                        del_btn.setFixedSize(20, 20)
                        del_btn.setStyleSheet(
                            "QPushButton { background:#FFF0F0; color:#C62828; border:1px solid #F1C9C9; border-radius:7px; font-size:11px; font-weight:700; padding:0; }"
                            "QPushButton:hover { background:#FFE2E2; }"
                        )
                        del_btn.clicked.connect(lambda _=False, rr=idx: self._delete_row(rr))
                        row_lay.addWidget(txt, 1)
                        row_lay.addWidget(del_btn, 0)
                        layout.addWidget(row_host)
        for layout in self._room_layouts.values():
            layout.addStretch(1)

    def _toggle_room_category_collapsed(self, room_name: str, category: str) -> None:
        rn = str(room_name or "").strip()
        ck = str(category or "").strip().lower()
        if not rn or not ck:
            return
        room_map = self._room_category_collapsed.setdefault(rn, {})
        room_map[ck] = not bool(room_map.get(ck, False))
        self._reload_columns()

    def _add_item_row(self, room_name: str) -> None:
        combo = self._room_item_combos.get(room_name)
        if not isinstance(combo, QComboBox):
            return
        row_data = combo.currentData()
        name = str((row_data or {}).get("name") or "").strip() if isinstance(row_data, dict) else ""
        if not name:
            QMessageBox.warning(self, "Items", "Select an item from Company Settings inventory first.")
            return
        if not room_name:
            QMessageBox.warning(self, "Items", "Select a room before adding the item.")
            return
        category = self._normalize_category(str((row_data or {}).get("category") or self._room_selected_category.get(room_name, "")))
        subcategory = str((row_data or {}).get("subcategory") or "").strip() if isinstance(row_data, dict) else ""
        key = f"{' '.join(room_name.lower().split())}|{category.lower()}|{subcategory.lower()}|{' '.join(name.lower().split())}"
        seen = {
            f"{' '.join(str((r or {}).get('room') or '').strip().lower().split())}|{self._normalize_category(str((r or {}).get('category') or '')).lower()}|{str((r or {}).get('subcategory') or '').strip().lower()}|{' '.join(str((r or {}).get('name') or '').strip().lower().split())}"
            for r in self._rows
            if isinstance(r, dict)
        }
        if key and key in seen:
            return
        self._rows.append({"name": name, "category": category, "subcategory": subcategory, "room": room_name})
        combo.setCurrentIndex(0)
        self._reload_columns()

    def _delete_row(self, row: int) -> None:
        if row < 0 or row >= len(self._rows):
            return
        self._rows.pop(row)
        self._reload_columns()

    def payload_items(self) -> list[dict]:
        return [dict(r) for r in self._rows if str((r or {}).get("name") or "").strip()]


class FullscreenImageDialog(QDialog):
    def __init__(
        self,
        image_sources: list[str],
        start_index: int = 0,
        image_loader: Callable[[str], QPixmap] | None = None,
        title: str = "Image Preview",
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setModal(False)
        self._sources = [str(x).strip() for x in (image_sources or []) if str(x).strip()]
        self._image_loader = image_loader
        self._source_pixmap = QPixmap()
        self._current_row = -1
        self._zoom = 1.0
        self._fit_zoom = 1.0
        self._drag_active = False
        self._drag_start = QPoint()
        self._drag_h_start = 0
        self._drag_v_start = 0
        self._did_initial_fit = False
        self.setStyleSheet("QDialog { background: #F5F6F8; }")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        self._image = QLabel()
        self._image.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._image.setStyleSheet("QLabel { background: transparent; color: #6B7280; }")

        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(False)
        self._scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._scroll.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._scroll.setWidget(self._image)
        self._scroll.viewport().setStyleSheet("background: transparent;")
        layout.addWidget(self._scroll, 1)

        self._carousel = QListWidget()
        self._carousel.setViewMode(QListWidget.ViewMode.IconMode)
        self._carousel.setFlow(QListWidget.Flow.LeftToRight)
        self._carousel.setMovement(QListWidget.Movement.Static)
        self._carousel.setWrapping(False)
        self._carousel.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        self._carousel.setIconSize(QSize(88, 64))
        self._carousel.setFixedHeight(96)
        self._carousel.setCursor(Qt.CursorShape.PointingHandCursor)
        self._carousel.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self._carousel.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._carousel.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._carousel.setStyleSheet(
            "QListWidget { background: #FFFFFF; border: 1px solid #E5E7EC; border-radius: 10px; padding: 6px; outline: 0; show-decoration-selected: 0; }"
            "QListWidget::item { margin: 2px; border-radius: 6px; outline: none; border: none; background: transparent; }"
            "QListWidget::item:selected { background: transparent; }"
            "QListWidget::item:selected:active { background: transparent; color: #1F2937; }"
            "QListWidget::item:selected:!active { background: transparent; color: #1F2937; }"
            "QListWidget::item:hover { background: transparent; }"
        )
        self._carousel.viewport().setCursor(Qt.CursorShape.PointingHandCursor)
        self._carousel.itemClicked.connect(self._on_carousel_item_clicked)
        carousel_row = QHBoxLayout()
        carousel_row.setContentsMargins(0, 0, 0, 0)
        carousel_row.setSpacing(0)
        carousel_row.addStretch(1)
        carousel_row.addWidget(self._carousel, 0)
        carousel_row.addStretch(1)
        layout.addLayout(carousel_row, 0)

        hint = QLabel("Scroll on image to zoom. Click thumbnail to switch.")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hint.setStyleSheet("color: #6B7280; font-size: 12px;")
        layout.addWidget(hint, 0)

        self._populate_carousel()
        self._update_carousel_width()
        self._open_fit_to_screen()
        self._scroll.viewport().installEventFilter(self)
        self._image.installEventFilter(self)
        self._carousel.installEventFilter(self)
        self._carousel.viewport().installEventFilter(self)
        if self._sources:
            self._set_current_row(max(0, min(int(start_index), len(self._sources) - 1)))
        else:
            self._sync_pixmap()

    def _load_pixmap(self, source: str) -> QPixmap:
        txt = str(source or "").strip()
        if not txt:
            return QPixmap()
        if callable(self._image_loader):
            try:
                pix = self._image_loader(txt)
                if isinstance(pix, QPixmap):
                    return pix
            except Exception:
                pass
        return QPixmap(txt)

    def _populate_carousel(self) -> None:
        self._carousel.clear()
        for src in self._sources:
            item = QListWidgetItem("")
            item.setData(Qt.ItemDataRole.UserRole, src)
            item.setData(Qt.ItemDataRole.DisplayRole, None)
            item.setSizeHint(QSize(92, 68))
            pix = self._load_pixmap(src)
            if not pix.isNull():
                thumb = pix.scaled(QSize(88, 64), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
                item.setIcon(QIcon(thumb))
            else:
                item.setText("X")
            self._carousel.addItem(item)
        self._update_carousel_width()

    def _update_carousel_width(self) -> None:
        count = max(1, self._carousel.count())
        per_item = max(96, int(self._carousel.iconSize().width()) + 18)
        content_w = 20 + (count * per_item)
        max_w = max(180, self.width() - 40)
        self._carousel.setFixedWidth(min(content_w, max_w))

    def _open_fit_to_screen(self) -> None:
        geo = self.parent().screen().availableGeometry() if isinstance(self.parent(), QWidget) and self.parent().screen() else self.screen().availableGeometry() if self.screen() else None
        if geo is None:
            self.resize(1080, 720)
            return
        w = max(760, int(geo.width() * 0.96))
        h = max(520, int(geo.height() * 0.96))
        self.resize(w, h)
        frame = self.frameGeometry()
        frame.moveCenter(geo.center())
        self.move(frame.topLeft())

    def showEvent(self, event) -> None:
        super().showEvent(event)
        if self._did_initial_fit:
            return
        self._did_initial_fit = True
        if self._current_row >= 0:
            QTimer.singleShot(0, lambda: self._set_current_row(self._current_row))

    def _set_current_row(self, row: int) -> None:
        if row < 0 or row >= len(self._sources):
            self._current_row = -1
            self._source_pixmap = QPixmap()
            self._sync_pixmap()
            return
        self._current_row = int(row)
        self._source_pixmap = self._load_pixmap(self._sources[row])
        self._fit_zoom = self._compute_fit_zoom()
        self._zoom = self._fit_zoom
        self._sync_pixmap()

    def _on_carousel_item_clicked(self, item: QListWidgetItem) -> None:
        row = self._carousel.row(item)
        self._set_current_row(row)

    def _compute_fit_zoom(self) -> float:
        if self._source_pixmap.isNull():
            return 1.0
        vp = self._scroll.viewport().size()
        if vp.width() < 10 or vp.height() < 10:
            return 1.0
        sx = float(vp.width()) / float(max(1, self._source_pixmap.width()))
        sy = float(vp.height()) / float(max(1, self._source_pixmap.height()))
        return max(0.05, min(sx, sy))

    def _sync_pixmap(self) -> None:
        if self._source_pixmap.isNull():
            self._image.setText("Image not available")
            self._image.setPixmap(QPixmap())
            return
        target = self._source_pixmap.size() * self._zoom
        if target.width() < 20 or target.height() < 20:
            target = QSize(20, 20)
        pix = self._source_pixmap.scaled(
            target,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self._image.setText("")
        self._image.setPixmap(pix)
        self._image.resize(pix.size())
        self._image.setCursor(Qt.CursorShape.OpenHandCursor)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._update_carousel_width()
        if not self._source_pixmap.isNull() and abs(self._zoom - self._fit_zoom) < 1e-6:
            self._fit_zoom = self._compute_fit_zoom()
            self._zoom = self._fit_zoom
        self._sync_pixmap()

    def _zoom_by_wheel(self, delta_y: int) -> None:
        if delta_y == 0:
            return
        if delta_y > 0:
            self._zoom = min(8.0, self._zoom * 1.12)
        else:
            self._zoom = max(0.05, self._zoom / 1.12)
        self._sync_pixmap()

    def eventFilter(self, obj, event):
        if obj in (self._scroll.viewport(), self._image):
            if event.type() == QEvent.Type.MouseButtonPress and event.button() == Qt.MouseButton.LeftButton:
                self._drag_active = True
                self._drag_start = event.globalPosition().toPoint()
                self._drag_h_start = self._scroll.horizontalScrollBar().value()
                self._drag_v_start = self._scroll.verticalScrollBar().value()
                self._image.setCursor(Qt.CursorShape.ClosedHandCursor)
                return True
            if event.type() == QEvent.Type.MouseMove and self._drag_active:
                delta = event.globalPosition().toPoint() - self._drag_start
                self._scroll.horizontalScrollBar().setValue(self._drag_h_start - delta.x())
                self._scroll.verticalScrollBar().setValue(self._drag_v_start - delta.y())
                return True
            if event.type() == QEvent.Type.MouseButtonRelease and event.button() == Qt.MouseButton.LeftButton:
                self._drag_active = False
                self._image.setCursor(Qt.CursorShape.ArrowCursor)
                return True
            if event.type() == QEvent.Type.Leave and self._drag_active:
                self._drag_active = False
                self._image.setCursor(Qt.CursorShape.ArrowCursor)
                return True
        if event.type() == QEvent.Type.Wheel:
            delta = int(event.angleDelta().y())
            if obj in (self._carousel, self._carousel.viewport()):
                if self._carousel.count() > 0 and delta != 0:
                    step = -1 if delta > 0 else 1
                    base_row = self._current_row if self._current_row >= 0 else 0
                    new_row = (base_row + step) % self._carousel.count()
                    self._set_current_row(new_row)
                return True
            if obj in (self._scroll.viewport(), self._image):
                self._zoom_by_wheel(delta)
                return True
        return super().eventFilter(obj, event)







