from __future__ import annotations

import json

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QCompleter,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QGraphicsBlurEffect,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPushButton,
    QSizePolicy,
    QTableWidget,
    QVBoxLayout,
    QWidget,
)

from cutsmart.ui.style import ACCENT
from cutsmart.qtui.screens.sales_rooms_mixin import AnimatedOutlineButton
class VComboBox(QComboBox):
    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
        arrow_color = str(self.property("arrowColor") or "#7B8493")
        painter.setPen(QColor(arrow_color))
        f = painter.font()
        f.setPointSize(max(6, int(f.pointSize() or 8) - 2))
        painter.setFont(f)
        try:
            shift_x = int(self.property("arrowShiftX") or 0)
        except Exception:
            shift_x = 0
        arrow_rect = self.rect().adjusted(self.width() - 19 + shift_x, 0, -1 + shift_x, 0)
        painter.drawText(arrow_rect, Qt.AlignmentFlag.AlignCenter, "▼")

    def mousePressEvent(self, event) -> None:
        try:
            if bool(self.property("openOnAnyClick")) and event.button() == Qt.MouseButton.LeftButton:
                self.showPopup()
                event.accept()
                return
        except Exception:
            pass
        super().mousePressEvent(event)

    def wheelEvent(self, event) -> None:
        # Prevent accidental value changes while scrolling the page.
        # Allow wheel only when the dropdown popup is open.
        try:
            view = self.view()
            if view is not None and bool(view.isVisible()):
                super().wheelEvent(event)
                return
        except Exception:
            pass
        event.ignore()



class ProjectSettingsDialog(QDialog):
    BOARD_COLUMNS = ["", "Colour", "Thickness", "Finish", "Edging", "Grain", "Lacquer", "Sheet Size"]

    def __init__(
        self,
        project_name: str,
        payload: dict | None = None,
        staff: list[dict] | None = None,
        board_thicknesses: list[str] | None = None,
        board_finishes: list[str] | None = None,
        board_colour_suggestions: list[str] | None = None,
        board_material_usage: dict | None = None,
        board_locked_keys: set[str] | None = None,
        board_locked_labels: dict | None = None,
        board_lock_state_provider=None,
        sheet_sizes: list[str] | None = None,
        default_sheet_size: str | None = None,
        staff_role_view_permissions: dict | None = None,
        staff_access_lock_permissions: dict | None = None,
        initial_section: str | None = None,
        theme_color: str | None = None,
        measurement_unit: str | None = None,
        embedded: bool = False,
        on_change=None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self.project_name = str(project_name or "Project")
        self._payload = dict(payload or {})
        self._staff = list(staff or [])
        self._board_thicknesses = [str(v).strip() for v in (board_thicknesses or []) if str(v).strip()]
        self._board_finishes = [str(v).strip() for v in (board_finishes or []) if str(v).strip()]
        self._board_colour_suggestions = [str(v).strip() for v in (board_colour_suggestions or []) if str(v).strip()]
        self._board_material_usage = dict(board_material_usage or {})
        self._board_locked_keys = {str(v).strip() for v in (board_locked_keys or set()) if str(v).strip()}
        self._board_locked_labels = {str(k).strip(): str(v or "").strip() for k, v in (board_locked_labels or {}).items() if str(k).strip()}
        self._board_lock_state_provider = board_lock_state_provider
        self._sheet_sizes = [str(v).strip() for v in (sheet_sizes or []) if str(v).strip()]
        self._default_sheet_size = str(default_sheet_size or "").strip()
        self._staff_role_view_permissions = dict(staff_role_view_permissions or {})
        self._staff_access_lock_permissions = dict(staff_access_lock_permissions or {})
        self._initial_section = str(initial_section or "both").strip().lower()
        self._theme_color = str(theme_color or ACCENT).strip() or ACCENT
        unit_raw = str(measurement_unit or "mm").strip().lower()
        self._measurement_unit_suffix = "in" if unit_raw in ("in", "inch", "inches") else "mm"
        theme_hex = self._theme_color if QColor(self._theme_color).isValid() else ACCENT
        theme_hover_hex = QColor(theme_hex).darker(115).name()
        self._embedded = bool(embedded)
        self._staff_access_controls: dict[str, QComboBox] = {}
        self._staff_access_locked: dict[str, bool] = {}
        self._staff_access_owner_locked: dict[str, bool] = {}
        self._staff_access_perm_locked: dict[str, bool] = {}
        self._board_table = None
        self._on_change = on_change
        self._autosave_timer = QTimer(self)
        self._autosave_timer.setSingleShot(True)
        self._autosave_timer.timeout.connect(self._emit_autosave)
        self._suspend_autosave = False
        self._last_autosave_signature = ""

        if self._initial_section == "boards":
            self.setWindowTitle("Project Board Settings")
        elif self._initial_section == "permissions":
            self.setWindowTitle("Project Permissions")
        else:
            self.setWindowTitle("Project Settings")
        if self._embedded:
            self.setWindowFlags(Qt.WindowType.Widget)
            self.setStyleSheet(
                "QDialog { background: transparent; border: none; }"
                "QLabel { background: transparent; border: none; }"
            )
        else:
            self.setModal(False)
            self.setWindowModality(Qt.WindowModality.NonModal)
            self.setWindowState(Qt.WindowState.WindowNoState)
            self.setWindowFlag(Qt.WindowType.WindowMaximizeButtonHint, False)
            self.setWindowFlag(Qt.WindowType.MSWindowsFixedSizeDialogHint, True)
            self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, False)
            self.resize(1320, 560)
            self.setStyleSheet(
                "QDialog { background: #F5F6F8; }"
                "QLabel { background: transparent; border: none; }"
            )

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0) if self._embedded else root.setContentsMargins(14, 12, 14, 12)
        root.setSpacing(6)

        if not self._embedded:
            top_host = QWidget()
            top_host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            top = QHBoxLayout(top_host)
            top.setContentsMargins(0, 0, 0, 0)
            top.setSpacing(8)
            crumb = QLabel("Project Settings")
            crumb.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            crumb.setStyleSheet("color: #6C7A90; background: #E9ECF1; border-radius: 8px; padding: 5px 10px; font-size: 12px; font-weight: 700;")
            top.addWidget(crumb)
            title = QLabel(self.project_name)
            title.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
            title.setStyleSheet("color: #111827; font-size: 28px; font-weight: 700; background: transparent; border: none;")
            top.addWidget(title)
            top.addStretch(1)
            top_host.setFixedHeight(56)
            root.addWidget(top_host, alignment=Qt.AlignmentFlag.AlignTop)

        body_host = QWidget()
        if self._embedded:
            body_host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        else:
            body_host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        body = QHBoxLayout(body_host)
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(10)

        left = QFrame()
        left.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        if self._embedded:
            left.setMinimumWidth(0)
        board_content_layout: QVBoxLayout
        if self._embedded and self._initial_section == "boards":
            left.setObjectName("EmbeddedBoardCard")
            left.setStyleSheet(
                "QFrame#EmbeddedBoardCard { background:#FFFFFF; border:1px solid #D7DCE3; border-radius:14px; }"
                "QFrame#EmbeddedBoardHead { background:#FFFFFF; border:none; border-bottom:1px solid #D7DEE8; border-top-left-radius:14px; border-top-right-radius:14px; }"
                "QFrame#EmbeddedBoardBody { background:#F8FAFD; border:none; border-bottom-left-radius:14px; border-bottom-right-radius:14px; }"
            )
            left_layout = QVBoxLayout(left)
            left_layout.setContentsMargins(0, 0, 0, 0)
            left_layout.setSpacing(0)

            board_head = QFrame()
            board_head.setObjectName("EmbeddedBoardHead")
            board_head.setFixedHeight(51)
            board_head_l = QHBoxLayout(board_head)
            board_head_l.setContentsMargins(14, 16, 14, 10)
            board_head_l.setSpacing(6)
            boards_title = QLabel("BOARD SETTINGS")
            boards_title.setStyleSheet("color:#0F2A4A; font-size:13px; font-weight:800; letter-spacing:1px; background:transparent; border:none;")
            board_head_l.addWidget(boards_title, 1)
            top_add_board = AnimatedOutlineButton("+ Add Board")
            top_add_board.setCursor(Qt.CursorShape.PointingHandCursor)
            top_add_board.setFixedHeight(24)
            top_add_board.set_outline_color(QColor(theme_hex))
            top_add_board.set_outline_duration_ms(150)
            top_add_board.setStyleSheet(
                "QPushButton { "
                f"background: #FFFFFF; color: {theme_hex}; border: none; "
                "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
                f"QPushButton:hover {{ background: #E3ECFA; color:{theme_hover_hex}; }}"
            )
            top_add_board.clicked.connect(lambda _=False: self._add_board_row())
            board_head_l.addWidget(top_add_board, 0, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            left_layout.addWidget(board_head, 0)

            board_body = QFrame()
            board_body.setObjectName("EmbeddedBoardBody")
            board_content_layout = QVBoxLayout(board_body)
            board_content_layout.setContentsMargins(14, 10, 14, 12)
            board_content_layout.setSpacing(8)
            left_layout.addWidget(board_body, 1)
        else:
            left.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 14px; }")
            left_layout = QVBoxLayout(left)
            left_layout.setContentsMargins(10, 10, 10, 10)
            left_layout.setSpacing(8)
            boards_title = QLabel("Board Settings")
            boards_title.setStyleSheet("color: #1A1D23; font-size: 15px; font-weight: 700; background: transparent; border: none;")
            left_layout.addWidget(boards_title)
            board_content_layout = left_layout

        self._board_table = QTableWidget()
        self._board_table.setColumnCount(len(self.BOARD_COLUMNS))
        self._board_table.setHorizontalHeaderLabels(self.BOARD_COLUMNS)
        self._board_table.verticalHeader().setVisible(False)
        self._board_table.horizontalHeader().setVisible(True)
        self._board_table.setAlternatingRowColors(False)
        self._board_table.setShowGrid(False)
        self._board_table.setFrameShape(QFrame.Shape.NoFrame)
        self._board_table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
        self._board_table.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self._board_table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._board_table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._board_table.verticalHeader().setDefaultSectionSize(34)
        self._board_table.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self._board_table.setStyleSheet(
            "QTableWidget { background: transparent; border: none; }"
            "QTableWidget::item { border: none; }"
            "QHeaderView::section { background: transparent; color: #6B7280; border: none; font-size: 12px; font-weight: 700; padding: 0 2px 4px 2px; }"
        )
        self._apply_board_column_sizing()
        board_content_layout.addWidget(self._board_table)

        board_actions = QHBoxLayout()
        add_board = AnimatedOutlineButton("+ Add Board")
        add_board.setCursor(Qt.CursorShape.PointingHandCursor)
        add_board.setFixedHeight(32)
        add_board.set_outline_color(QColor(theme_hex))
        add_board.set_outline_duration_ms(150)
        add_board.setStyleSheet(
            "QPushButton { "
            f"background: #FFFFFF; color: {theme_hex}; border: none; "
            "border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 800; text-align: center; }"
            f"QPushButton:hover {{ background: #E3ECFA; color:{theme_hover_hex}; }}"
        )
        add_board.clicked.connect(self._add_board_row)
        board_actions.addWidget(add_board)
        board_actions.addStretch(1)
        board_content_layout.addLayout(board_actions)

        right = QFrame()
        right.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
        right.setStyleSheet("QFrame { background: #FFFFFF; border: 1px solid #E4E6EC; border-radius: 14px; }")
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(12, 12, 12, 12)
        right_layout.setSpacing(8)

        perm_title = QLabel("Project Permissions")
        perm_title.setStyleSheet("color: #1A1D23; font-size: 15px; font-weight: 700; background: transparent; border: none;")
        right_layout.addWidget(perm_title)

        staff_list_host = QFrame()
        staff_list_host.setStyleSheet("QFrame { background: #FBFCFE; border: 1px solid #E9EDF3; border-radius: 10px; }")
        staff_list_layout = QVBoxLayout(staff_list_host)
        staff_list_layout.setContentsMargins(10, 10, 10, 10)
        staff_list_layout.setSpacing(6)
        staff_lbl = QLabel("Allowed staff")
        staff_lbl.setStyleSheet("color: #1A1D23; font-size: 12px; font-weight: 600; background: transparent; border: none;")
        staff_list_layout.addWidget(staff_lbl)
        for member in self._staff:
            uid = str((member or {}).get("uid") or "").strip()
            if not uid:
                continue
            name = str((member or {}).get("displayName") or "").strip() or str((member or {}).get("email") or uid)
            role_name = str(
                (member or {}).get("roleName")
                or (member or {}).get("role")
                or (member or {}).get("roleLabel")
                or ""
            ).strip().lower()
            owner_locked = bool((member or {}).get("isOwner")) or role_name == "owner"
            row = QHBoxLayout()
            row.setSpacing(8)
            name_lbl = QLabel(name)
            name_lbl.setStyleSheet("color: #374151; font-size: 12px;")
            row.addWidget(name_lbl, stretch=1)

            access_combo = VComboBox()
            access_combo.setFixedHeight(24)
            access_combo.setMinimumWidth(120)
            access_combo.setStyleSheet(
                "QComboBox {"
                "background:#FFFFFF; border:1px solid #E4E6EC; border-radius: 8px;"
                "padding: 0 24px 0 8px; font-size: 12px; min-height: 24px; max-height: 24px;"
                "}"
                "QComboBox::drop-down {"
                "subcontrol-origin: padding; subcontrol-position: top right;"
                "width: 20px; border-left: 1px solid #E8EBF1;"
                "background: #F7F8FA; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
                "}"
                "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
                "QComboBox QAbstractItemView { background: #FFFFFF; border: 1px solid #E4E6EC; selection-background-color: #EEF2F7; }"
            )
            locked = bool(self._staff_role_view_permissions.get(uid, False))
            perm_locked = bool(self._staff_access_lock_permissions.get(uid, False))
            if owner_locked:
                access_combo.addItem("Edit", userData="edit")
                access_combo.setCurrentIndex(max(0, access_combo.findData("edit")))
                access_combo.setEnabled(False)
            elif locked:
                access_combo.addItem("Edit", userData="edit")
                access_combo.setEnabled(False)
            else:
                access_combo.addItem("No Access", userData="no_access")
                access_combo.addItem("View", userData="view")
                access_combo.addItem("Edit", userData="edit")
                access_combo.currentIndexChanged.connect(self._queue_autosave)
                if perm_locked:
                    access_combo.setEnabled(False)
            self._staff_access_controls[uid] = access_combo
            self._staff_access_locked[uid] = bool(locked or owner_locked or perm_locked)
            self._staff_access_owner_locked[uid] = bool(owner_locked)
            self._staff_access_perm_locked[uid] = bool(perm_locked)
            row.addWidget(access_combo, stretch=0)
            staff_list_layout.addLayout(row)
        right_layout.addWidget(staff_list_host)

        if self._initial_section == "boards":
            body.setSpacing(0)
            body.addWidget(left, 1, Qt.AlignmentFlag.AlignTop)
            right.hide()
        elif self._initial_section == "permissions":
            body.setSpacing(0)
            body.addWidget(right, 1)
            left.hide()
        else:
            body.addWidget(left, stretch=2, alignment=Qt.AlignmentFlag.AlignTop)
            body.addWidget(right, stretch=1, alignment=Qt.AlignmentFlag.AlignTop)
        if self._embedded:
            root.addWidget(body_host, 0, Qt.AlignmentFlag.AlignTop)
            root.addStretch(1)
        else:
            root.addWidget(body_host, alignment=Qt.AlignmentFlag.AlignTop)
        if not self._embedded:
            root.addStretch(1)

        if not self._embedded:
            buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
            buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Save")
            buttons.accepted.connect(self.accept)
            buttons.rejected.connect(self.reject)
            root.addWidget(buttons)

        self._suspend_autosave = True
        self._load_payload_into_form()
        self._suspend_autosave = False
        self._sync_board_table_height()
        self._lock_dialog_size()
        self._last_autosave_signature = self._payload_signature()

    def _load_payload_into_form(self) -> None:
        boards = self._payload.get("boardTypes") or []
        if not isinstance(boards, list):
            boards = []
        self._board_table.setRowCount(0)
        for row in boards:
            if not isinstance(row, dict):
                continue
            self._add_board_row(
                {
                    "colour": str(row.get("colour") or row.get("color") or ""),
                    "thickness": str(row.get("thickness") or ""),
                    "finish": str(row.get("finish") or ""),
                    "edging": str(row.get("edging") or ""),
                    "grain": row.get("grain"),
                    "lacquer": row.get("lacquer"),
                    "sheetSize": str(row.get("sheetSize") or row.get("sheetSizeHw") or ""),
                }
            )
        if self._board_table.rowCount() == 0:
            self._add_board_row({})
        self._sync_board_table_height()

        perms_raw = self._payload.get("projectPermissions") or {}
        staff_access: dict[str, str] = {}
        if isinstance(perms_raw, dict):
            raw_access = perms_raw.get("staffAccess")
            if isinstance(raw_access, dict):
                for k, v in raw_access.items():
                    vv = str(v or "").strip().lower()
                    staff_access[str(k)] = vv if vv in ("no_access", "view", "edit", "") else "no_access"
            else:
                # Backward compatibility with old bool map format.
                maybe_staff = perms_raw.get("staff")
                if isinstance(maybe_staff, dict):
                    for k, v in maybe_staff.items():
                        staff_access[str(k)] = "view" if bool(v) else "no_access"
        for uid, combo in self._staff_access_controls.items():
            locked = bool(self._staff_access_locked.get(uid, False))
            if locked:
                if bool(self._staff_access_owner_locked.get(uid, False)):
                    idx_owner = combo.findData("edit")
                    combo.setCurrentIndex(max(0, idx_owner))
                else:
                    desired_locked = staff_access.get(uid, "edit")
                    idx_locked = combo.findData(desired_locked)
                    if idx_locked < 0:
                        idx_locked = combo.findData("edit")
                    combo.setCurrentIndex(max(0, idx_locked))
                continue
            desired = staff_access.get(uid, "no_access")
            idx = combo.findData(desired)
            if idx < 0:
                idx = combo.findData("no_access")
            combo.setCurrentIndex(max(0, idx))

    def _add_board_row(self, values: dict | None = None) -> None:
        values = dict(values or {})
        row = self._board_table.rowCount()
        self._board_table.insertRow(row)
        self._board_table.setRowHeight(row, 34)

        delete_btn = QPushButton("X")
        delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        delete_btn.setFixedSize(24, 22)
        delete_btn.setStyleSheet(
            "QPushButton { background: #FFF0F0; color: #D14343; border: 1px solid #F7B8B8; border-radius: 8px; font-size: 11px; font-weight: 700; }"
            "QPushButton:hover { background: #FFE7E7; }"
        )
        delete_btn.clicked.connect(self._remove_board_row_clicked)
        self._board_table.setCellWidget(row, 0, self._board_cell_wrap(delete_btn, left_pad=0, center=True))

        color_input = QLineEdit(str(values.get("colour") or values.get("color") or ""))
        color_input.setPlaceholderText("e.g. White")
        color_input.setFixedHeight(30)
        color_input.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        color_input.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E4E6EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        color_input.editingFinished.connect(self._queue_autosave)
        self._apply_colour_completer(color_input)
        self._board_table.setCellWidget(row, 1, self._board_cell_wrap(color_input, fill=True))

        selected_colour = str(values.get("colour") or values.get("color") or "")
        selected_thickness = str(values.get("thickness") or "")
        selected_finish = str(values.get("finish") or "")
        thickness_options = self._ranked_thickness_options(selected_colour, selected_finish)
        finish_options = self._ranked_finish_options(selected_colour, selected_thickness)

        thickness_combo = self._new_dropdown(thickness_options, selected_thickness, suffix_mm=True)
        thickness_combo.currentIndexChanged.connect(self._queue_autosave)
        self._board_table.setCellWidget(row, 2, self._board_cell_wrap(thickness_combo, fill=True))

        finish_combo = self._new_dropdown(finish_options, selected_finish)
        finish_combo.currentIndexChanged.connect(self._queue_autosave)
        self._board_table.setCellWidget(row, 3, self._board_cell_wrap(finish_combo, fill=True))

        def _refresh_material_recommendations() -> None:
            colour_txt = str(color_input.text() or "").strip()
            thickness_txt = str(self._combo_value(thickness_combo) or "").strip()
            finish_txt = str(self._combo_value(finish_combo) or "").strip()
            self._reset_dropdown_options(
                thickness_combo,
                self._ranked_thickness_options(colour_txt, finish_txt),
                thickness_txt,
                suffix_mm=True,
            )
            self._reset_dropdown_options(
                finish_combo,
                self._ranked_finish_options(colour_txt, thickness_txt),
                finish_txt,
                suffix_mm=False,
            )
        color_input.textChanged.connect(lambda _=None: _refresh_material_recommendations())
        color_input.editingFinished.connect(_refresh_material_recommendations)
        thickness_combo.currentIndexChanged.connect(lambda _=0: _refresh_material_recommendations())
        finish_combo.currentIndexChanged.connect(lambda _=0: _refresh_material_recommendations())

        edging_input = QLineEdit(str(values.get("edging") or "Matching"))
        edging_input.setFixedHeight(30)
        edging_input.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        edging_input.setStyleSheet("QLineEdit { background:#FFFFFF; border:1px solid #E4E6EC; border-radius: 8px; padding: 3px 8px; font-size: 12px; }")
        edging_input.editingFinished.connect(self._queue_autosave)
        self._board_table.setCellWidget(row, 4, self._board_cell_wrap(edging_input, fill=True))

        grain_box = QCheckBox()
        grain_box.setChecked(self._as_bool(values.get("grain")))
        grain_box.setCursor(Qt.CursorShape.PointingHandCursor)
        grain_box.toggled.connect(self._queue_autosave)
        self._board_table.setCellWidget(row, 5, self._board_cell_wrap(grain_box, center=True))

        lacquer_box = QCheckBox()
        lacquer_box.setChecked(self._as_bool(values.get("lacquer")))
        lacquer_box.setCursor(Qt.CursorShape.PointingHandCursor)
        lacquer_box.toggled.connect(self._queue_autosave)
        self._board_table.setCellWidget(row, 6, self._board_cell_wrap(lacquer_box, center=True))

        sheet_value = str(values.get("sheetSize") or values.get("sheetSizeHw") or "").strip()
        if not sheet_value:
            sheet_value = self._default_sheet_size
        sheet_combo = self._new_dropdown(self._sheet_sizes, sheet_value)
        sheet_combo.currentIndexChanged.connect(self._queue_autosave)
        self._board_table.setCellWidget(row, 7, self._board_cell_wrap(sheet_combo, fill=True))
        self._sync_board_table_height()
        self._queue_autosave()

    def _board_cell_wrap(self, control: QWidget, left_pad: int = 2, center: bool = False, fill: bool = False) -> QWidget:
        host = QWidget()
        lay = QHBoxLayout(host)
        lay.setContentsMargins(left_pad, 0, 2, 0)
        lay.setSpacing(0)
        if center:
            lay.addStretch(1)
            lay.addWidget(control, alignment=Qt.AlignmentFlag.AlignCenter)
            lay.addStretch(1)
        elif fill:
            lay.addWidget(control)
        else:
            lay.addWidget(control, alignment=Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft)
            lay.addStretch(1)
        return host

    def _apply_colour_completer(self, line_edit: QLineEdit) -> None:
        if not isinstance(line_edit, QLineEdit):
            return
        options: list[str] = []
        seen: set[str] = set()
        for value in self._board_colour_suggestions:
            text = str(value or "").strip()
            key = " ".join(text.lower().split())
            if not text or key in seen:
                continue
            seen.add(key)
            options.append(text)
        if not options:
            return
        completer = QCompleter(options, line_edit)
        completer.setCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        completer.setCompletionMode(QCompleter.CompletionMode.PopupCompletion)
        completer.setFilterMode(Qt.MatchFlag.MatchContains)
        line_edit.setCompleter(completer)

    def set_board_colour_suggestions(self, suggestions: list[str] | None) -> None:
        self._board_colour_suggestions = [str(v).strip() for v in (suggestions or []) if str(v).strip()]
        if not isinstance(self._board_table, QTableWidget):
            return
        for row in range(self._board_table.rowCount()):
            host = self._board_table.cellWidget(row, 1)
            edit = host.findChild(QLineEdit) if isinstance(host, QWidget) else None
            if isinstance(edit, QLineEdit):
                self._apply_colour_completer(edit)

    @staticmethod
    def _usage_key(value: str) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _usage_rows(self, group: str) -> list[dict]:
        rows = self._board_material_usage.get(group) if isinstance(self._board_material_usage, dict) else None
        return rows if isinstance(rows, list) else []

    def _ranked_thickness_options(self, colour: str, finish: str = "") -> list[str]:
        if not self._usage_rows("thicknesses") and not self._usage_rows("colourThickness") and not self._usage_rows("thicknessFinish"):
            return [str(v) for v in self._board_thicknesses]
        scores: dict[str, int] = {}
        values: dict[str, str] = {}
        colour_key = self._usage_key(colour)
        finish_key = self._usage_key(finish)

        for row in self._usage_rows("thicknesses"):
            value = str(row.get("value") or "").strip()
            key = self._usage_key(value)
            if not key:
                continue
            values[key] = value
            scores[key] = int(scores.get(key, 0)) + int(row.get("count") or 0)
        if colour_key:
            for row in self._usage_rows("colourThickness"):
                row_colour = self._usage_key(str(row.get("colour") or ""))
                value = str(row.get("thickness") or "").strip()
                key = self._usage_key(value)
                if row_colour != colour_key or not key:
                    continue
                values[key] = value
                scores[key] = int(scores.get(key, 0)) + (int(row.get("count") or 0) * 1000)
        if finish_key:
            for row in self._usage_rows("thicknessFinish"):
                row_finish = self._usage_key(str(row.get("finish") or ""))
                value = str(row.get("thickness") or "").strip()
                key = self._usage_key(value)
                if row_finish != finish_key or not key:
                    continue
                values[key] = value
                scores[key] = int(scores.get(key, 0)) + (int(row.get("count") or 0) * 100)

        # Ensure explicit company options still appear.
        for text in self._board_thicknesses:
            key = self._usage_key(text)
            if key and key not in values:
                values[key] = text
                scores[key] = int(scores.get(key, 0))
        ordered = sorted(values.keys(), key=lambda k: (-int(scores.get(k, 0)), str(values.get(k) or "").lower()))
        return [str(values.get(k) or "") for k in ordered if str(values.get(k) or "").strip()]

    def _ranked_finish_options(self, colour: str, thickness: str = "") -> list[str]:
        if not self._usage_rows("finishes") and not self._usage_rows("colourFinish") and not self._usage_rows("thicknessFinish"):
            return [str(v) for v in self._board_finishes]
        scores: dict[str, int] = {}
        values: dict[str, str] = {}
        colour_key = self._usage_key(colour)
        thickness_key = self._usage_key(thickness)

        for row in self._usage_rows("finishes"):
            value = str(row.get("value") or "").strip()
            key = self._usage_key(value)
            if not key:
                continue
            values[key] = value
            scores[key] = int(scores.get(key, 0)) + int(row.get("count") or 0)
        if colour_key:
            for row in self._usage_rows("colourFinish"):
                row_colour = self._usage_key(str(row.get("colour") or ""))
                value = str(row.get("finish") or "").strip()
                key = self._usage_key(value)
                if row_colour != colour_key or not key:
                    continue
                values[key] = value
                scores[key] = int(scores.get(key, 0)) + (int(row.get("count") or 0) * 1000)
        if thickness_key:
            for row in self._usage_rows("thicknessFinish"):
                row_thickness = self._usage_key(str(row.get("thickness") or ""))
                value = str(row.get("finish") or "").strip()
                key = self._usage_key(value)
                if row_thickness != thickness_key or not key:
                    continue
                values[key] = value
                scores[key] = int(scores.get(key, 0)) + (int(row.get("count") or 0) * 100)

        for text in self._board_finishes:
            key = self._usage_key(text)
            if key and key not in values:
                values[key] = text
                scores[key] = int(scores.get(key, 0))
        ordered = sorted(values.keys(), key=lambda k: (-int(scores.get(k, 0)), str(values.get(k) or "").lower()))
        return [str(values.get(k) or "") for k in ordered if str(values.get(k) or "").strip()]

    def _reset_dropdown_options(self, combo: QComboBox, options: list[str], selected: str, suffix_mm: bool = False) -> None:
        if not isinstance(combo, QComboBox):
            return
        current = str(selected or "").strip()
        if suffix_mm:
            lower = current.lower()
            if lower.endswith("mm") or lower.endswith("in"):
                current = current[:-2].strip()
        combo.blockSignals(True)
        combo.clear()
        combo.addItem("", userData="")
        seen = {""}
        for value in (options or []):
            text = str(value or "").strip()
            if not text or text in seen:
                continue
            label = f"{text} {self._measurement_unit_suffix}" if suffix_mm else text
            combo.addItem(label, userData=text)
            seen.add(text)
        if current and current not in seen:
            label = f"{current} {self._measurement_unit_suffix}" if suffix_mm else current
            combo.addItem(label, userData=current)
        idx = combo.findData(current)
        if idx < 0:
            find_label = f"{current} {self._measurement_unit_suffix}" if suffix_mm and current else current
            idx = combo.findText(find_label)
        combo.setCurrentIndex(max(0, idx))
        combo.blockSignals(False)

    def _remove_board_row(self) -> None:
        row = self._board_table.currentRow()
        if row >= 0 and self._is_board_row_locked(row):
            self._show_board_delete_blocked_dialog(self._board_delete_label(row))
            return
        if row >= 0:
            self._board_table.removeRow(row)
        if self._board_table.rowCount() == 0:
            self._add_board_row({})
        self._sync_board_table_height()
        self._queue_autosave()

    def _remove_board_row_clicked(self) -> None:
        sender = self.sender()
        if not isinstance(sender, QPushButton):
            return
        row_to_remove = -1
        for row in range(self._board_table.rowCount()):
            host = self._board_table.cellWidget(row, 0)
            if isinstance(host, QWidget) and host.findChild(QPushButton) is sender:
                row_to_remove = row
                break
        if row_to_remove >= 0 and self._is_board_row_locked(row_to_remove):
            self._show_board_delete_blocked_dialog(self._board_delete_label(row_to_remove))
            return
        if row_to_remove >= 0:
            self._board_table.removeRow(row_to_remove)
        if self._board_table.rowCount() == 0:
            self._add_board_row({})
        self._sync_board_table_height()
        self._queue_autosave()

    def _board_key_for_row(self, row: int) -> str:
        return f"board::{int(row) + 1}"

    def _refresh_board_lock_state(self) -> None:
        provider = getattr(self, "_board_lock_state_provider", None)
        if callable(provider):
            try:
                state = provider()
                if isinstance(state, tuple) and len(state) >= 1:
                    keys = state[0]
                    labels = state[1] if len(state) > 1 else {}
                elif isinstance(state, dict):
                    keys = state.get("keys")
                    labels = state.get("labels")
                else:
                    keys = None
                    labels = None
                if isinstance(keys, set):
                    self._board_locked_keys = {str(v).strip() for v in keys if str(v).strip()}
                if isinstance(labels, dict):
                    self._board_locked_labels = {
                        str(k).strip(): str(v or "").strip()
                        for k, v in labels.items()
                        if str(k).strip()
                    }
                return
            except Exception:
                pass
        owner = self.window()
        if owner is None:
            return
        try:
            selected_fn = getattr(owner, "_selected_project", None)
            raw = selected_fn() if callable(selected_fn) else None
            if not isinstance(raw, dict):
                return
            keys_fn = getattr(owner, "_project_used_cutlist_board_keys", None)
            if callable(keys_fn):
                keys = keys_fn(raw)
                if isinstance(keys, set):
                    self._board_locked_keys = {str(v).strip() for v in keys if str(v).strip()}
            labels_fn = getattr(owner, "_project_board_display_map", None)
            if callable(labels_fn):
                labels = labels_fn(raw)
                if isinstance(labels, dict):
                    self._board_locked_labels = {
                        str(k).strip(): str(v or "").strip()
                        for k, v in labels.items()
                        if str(k).strip()
                    }
        except Exception:
            pass

    def _is_board_row_locked(self, row: int) -> bool:
        self._refresh_board_lock_state()
        key = self._board_key_for_row(row)
        return key in self._board_locked_keys

    def _board_delete_label(self, row: int) -> str:
        key = self._board_key_for_row(row)
        preferred = str(self._board_locked_labels.get(key) or "").strip()
        if preferred:
            return preferred
        colour = self._line_value(self._board_table.cellWidget(row, 1))
        thickness = self._combo_value(self._board_table.cellWidget(row, 2))
        finish = self._combo_value(self._board_table.cellWidget(row, 3))
        parts = [p for p in [colour, thickness, finish] if str(p or "").strip()]
        return " ".join(parts).strip() or f"Board {int(row) + 1}"

    def _show_board_delete_blocked_dialog(self, board_text: str) -> None:
        host = self.window() if isinstance(self.window(), QWidget) else self
        overlay = None
        prev_effect = None
        blur_fx = None
        try:
            if isinstance(host, QWidget):
                prev_effect = host.graphicsEffect()
                blur_fx = QGraphicsBlurEffect(host)
                blur_fx.setBlurRadius(5.0)
                host.setGraphicsEffect(blur_fx)
                overlay = QWidget(host)
                overlay.setObjectName("boardDeleteBlockedOverlay")
                overlay.setStyleSheet("QWidget#boardDeleteBlockedOverlay { background: rgba(15, 23, 42, 92); }")
                overlay.setGeometry(host.rect())
                overlay.show()
                overlay.raise_()
        except Exception:
            overlay = None

        theme = self._theme_color if QColor(self._theme_color).isValid() else ACCENT
        dlg = QDialog(host if isinstance(host, QWidget) else None)
        dlg.setModal(True)
        dlg.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        dlg.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        dlg.setFixedWidth(560)
        dlg.setStyleSheet(
            "QDialog { background: transparent; border: none; }"
            "QFrame#boardDeleteBlockedCard { background:#FFFFFF; border:1px solid #D7DEE8; border-radius:12px; }"
            "QLabel { background:transparent; color:#0F172A; }"
            "QPushButton { border-radius:9px; font-size:12px; font-weight:700; padding:7px 14px; }"
            f"QPushButton#okBtn {{ background:{theme}; color:#FFFFFF; border:1px solid {theme}; }}"
            f"QPushButton#okBtn:hover {{ background:{QColor(theme).darker(112).name()}; border:1px solid {QColor(theme).darker(112).name()}; }}"
        )
        root = QVBoxLayout(dlg)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        card = QFrame()
        card.setObjectName("boardDeleteBlockedCard")
        root.addWidget(card, 0)
        card_l = QVBoxLayout(card)
        card_l.setContentsMargins(16, 14, 16, 12)
        card_l.setSpacing(10)

        msg = QLabel(f"{board_text} is being used and cannot be deleted.")
        msg.setWordWrap(True)
        msg.setStyleSheet("QLabel { color:#0F172A; font-size:14px; font-weight:800; }")
        card_l.addWidget(msg, 0)

        btn_row = QHBoxLayout()
        btn_row.setContentsMargins(0, 0, 0, 0)
        btn_row.addStretch(1)
        ok_btn = QPushButton("OK")
        ok_btn.setObjectName("okBtn")
        ok_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        ok_btn.clicked.connect(dlg.accept)
        btn_row.addWidget(ok_btn, 0)
        card_l.addLayout(btn_row)

        dlg.exec()
        try:
            if overlay is not None:
                overlay.deleteLater()
            if isinstance(host, QWidget):
                host.setGraphicsEffect(prev_effect)
        except Exception:
            pass

    def _sync_board_table_height(self) -> None:
        if not isinstance(self._board_table, QTableWidget):
            return
        row_count = self._board_table.rowCount()
        visible_rows = max(1, row_count)
        header_h = 0
        if self._board_table.horizontalHeader().isVisible():
            hdr = self._board_table.horizontalHeader()
            header_h = max(hdr.height(), hdr.sizeHint().height(), 24)
        # Deterministic sizing: always reserve enough vertical space per row.
        per_row_h = 40
        for r in range(row_count):
            self._board_table.setRowHeight(r, per_row_h)
        rows_h = visible_rows * per_row_h
        frame_h = (self._board_table.frameWidth() * 2) + 16
        target = header_h + rows_h + frame_h
        self._board_table.setFixedHeight(max(78, target))
        self._lock_dialog_size()

    def _lock_dialog_size(self) -> None:
        if self._embedded:
            self.setMinimumHeight(360)
            self.setMaximumHeight(16777215)
            return
        hint = self.sizeHint()
        width = max(1280, min(1400, hint.width()))
        screen_h = 980
        try:
            screen = self.screen()
            if screen is not None:
                screen_h = max(720, int(screen.availableGeometry().height()))
        except Exception:
            pass
        # Grow to fit content (including loaded rows on reopen), but keep dialog manageable.
        max_h = int(screen_h * 0.88)
        height = max(520, min(max_h, hint.height() + 12))
        self.setFixedSize(width, height)

    def _payload_signature(self) -> str:
        try:
            return json.dumps(self.payload(), sort_keys=True)
        except Exception:
            return ""

    def _board_types_payload(self) -> dict:
        boards: list[dict] = []
        if isinstance(self._board_table, QTableWidget):
            for r in range(self._board_table.rowCount()):
                row = {
                    "colour": self._line_value(self._board_table.cellWidget(r, 1)),
                    "thickness": self._combo_value(self._board_table.cellWidget(r, 2)),
                    "finish": self._combo_value(self._board_table.cellWidget(r, 3)),
                    "edging": self._line_value(self._board_table.cellWidget(r, 4)),
                    "grain": self._checkbox_value(self._board_table.cellWidget(r, 5)),
                    "lacquer": self._checkbox_value(self._board_table.cellWidget(r, 6)),
                    "sheetSize": self._combo_value(self._board_table.cellWidget(r, 7)),
                }
                boards.append(row)
        return {"boardTypes": boards}

    def _queue_autosave(self) -> None:
        if self._suspend_autosave:
            return
        if self._embedded:
            # Embedded Board Settings should behave like Production Existing/Cabinetry/Hardware:
            # save on every edit event without signature-based suppression.
            self._emit_autosave(force=True)
            return
        self._autosave_timer.start(280)

    def _queue_autosave_text(self) -> None:
        if self._suspend_autosave:
            return
        # Debounce keystroke saves to keep typing smooth.
        self._autosave_timer.start(260 if self._embedded else 280)

    def _emit_autosave(self, force: bool = False) -> None:
        if self._suspend_autosave:
            return
        payload = None
        try:
            if self._embedded and self._initial_section == "boards":
                payload = self._board_types_payload()
            else:
                payload = self.payload()
        except Exception:
            return
        try:
            sig = json.dumps(payload, sort_keys=True)
        except Exception:
            sig = ""
        if not sig:
            return
        if (not force) and sig == self._last_autosave_signature:
            return
        if callable(self._on_change):
            try:
                result = self._on_change(dict(payload or {}))
                if result is False:
                    return
            except Exception:
                pass
        self._last_autosave_signature = sig

    def closeEvent(self, event) -> None:
        self._emit_autosave()
        super().closeEvent(event)

    def showEvent(self, event) -> None:
        super().showEvent(event)
        # Re-run sizing once widget geometry/header metrics are finalized.
        QTimer.singleShot(0, self._sync_board_table_height)
        QTimer.singleShot(30, self._sync_board_table_height)

    def _apply_board_column_sizing(self) -> None:
        if not isinstance(self._board_table, QTableWidget):
            return
        fm = self._board_table.fontMetrics()
        # Extra space for right-side dropdown segment + "v" indicator.
        pad = 58

        def _max_text_width(values: list[str], fallback: str) -> int:
            pool = [fallback] + [str(v or "").strip() for v in values if str(v or "").strip()]
            return max(fm.horizontalAdvance(text) for text in pool)

        thickness_display = [f"{str(v).strip()} {self._measurement_unit_suffix}" for v in self._board_thicknesses if str(v).strip()]
        thickness_w = _max_text_width(thickness_display, "Thickness") + pad
        finish_w = _max_text_width(self._board_finishes, "Finish") + pad
        sheet_w = _max_text_width(self._sheet_sizes, "Sheet Size") + pad

        hh = self._board_table.horizontalHeader()
        hh.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        hh.setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)    # Colour compact
        hh.setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)    # Thickness from options
        hh.setSectionResizeMode(3, QHeaderView.ResizeMode.Fixed)    # Finish from options
        hh.setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)    # Edging fixed
        hh.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        hh.setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)
        hh.setSectionResizeMode(7, QHeaderView.ResizeMode.Fixed)    # Sheet size from options

        self._board_table.setColumnWidth(1, 156)
        self._board_table.setColumnWidth(2, 92)
        self._board_table.setColumnWidth(3, max(96, finish_w))
        self._board_table.setColumnWidth(4, 105)
        self._board_table.setColumnWidth(7, max(150, sheet_w))

    def _new_dropdown(self, options: list[str], selected: str = "", suffix_mm: bool = False) -> QComboBox:
        combo = VComboBox()
        combo.setProperty("arrowShiftX", -2)
        combo.addItem("", userData="")
        selected_clean = str(selected or "").strip()
        if suffix_mm:
            lower_selected = selected_clean.lower()
            if lower_selected.endswith("mm"):
                selected_clean = selected_clean[:-2].strip()
            elif lower_selected.endswith("in"):
                selected_clean = selected_clean[:-2].strip()
        seen = {""}
        for value in options:
            text = str(value or "").strip()
            if not text or text in seen:
                continue
            label = f"{text} {self._measurement_unit_suffix}" if suffix_mm else text
            combo.addItem(label, userData=text)
            seen.add(text)
        if selected_clean and selected_clean not in seen:
            label = f"{selected_clean} {self._measurement_unit_suffix}" if suffix_mm else selected_clean
            combo.addItem(label, userData=selected_clean)
        idx = combo.findData(selected_clean)
        if idx < 0:
            find_label = f"{selected_clean} {self._measurement_unit_suffix}" if suffix_mm and selected_clean else selected_clean
            idx = combo.findText(find_label)
        combo.setCurrentIndex(max(0, idx))
        combo.setFixedHeight(30)
        combo.setStyleSheet(
            "QComboBox {"
            "background:#FFFFFF; border:1px solid #E4E6EC; border-radius: 8px;"
            "padding: 0 4px 0 8px; font-size: 12px; min-height: 30px; max-height: 30px;"
            "}"
            "QComboBox::drop-down {"
            "subcontrol-origin: border; subcontrol-position: top right;"
            "width: 20px; border-top: 1px solid #E4E6EC; border-right: 1px solid #E4E6EC; border-bottom: 1px solid #E4E6EC; border-left: 1px solid #E8EBF1;"
            "background: #F7F8FA; border-top-right-radius: 8px; border-bottom-right-radius: 8px;"
            "}"
            "QComboBox::down-arrow { image: none; width: 0px; height: 0px; border: none; }"
            "QComboBox QAbstractItemView { background: #FFFFFF; border: 1px solid #E4E6EC; selection-background-color: #EEF2F7; }"
        )
        return combo

    def _line_value(self, widget: QWidget | None) -> str:
        if isinstance(widget, QLineEdit):
            return str(widget.text() or "").strip()
        if isinstance(widget, QWidget):
            edit = widget.findChild(QLineEdit)
            if isinstance(edit, QLineEdit):
                return str(edit.text() or "").strip()
        return ""

    def _combo_value(self, widget: QWidget | None) -> str:
        if isinstance(widget, QComboBox):
            data = widget.currentData()
            if data is not None:
                text = str(data).strip()
                if text:
                    return text
            return str(widget.currentText() or "").strip()
        if isinstance(widget, QWidget):
            combo = widget.findChild(QComboBox)
            if isinstance(combo, QComboBox):
                data = combo.currentData()
                if data is not None:
                    text = str(data).strip()
                    if text:
                        return text
                return str(combo.currentText() or "").strip()
        return ""

    def _checkbox_value(self, widget: QWidget | None) -> bool:
        if isinstance(widget, QCheckBox):
            return bool(widget.isChecked())
        if isinstance(widget, QWidget):
            box = widget.findChild(QCheckBox)
            if isinstance(box, QCheckBox):
                return bool(box.isChecked())
        return False

    def _as_bool(self, value) -> bool:
        if isinstance(value, bool):
            return value
        text = str(value or "").strip().lower()
        return text in ("1", "true", "yes", "y", "on", "long")

    def payload(self) -> dict:
        out = dict(self._payload)

        boards: list[dict] = []
        for r in range(self._board_table.rowCount()):
            row = {
                "colour": self._line_value(self._board_table.cellWidget(r, 1)),
                "thickness": self._combo_value(self._board_table.cellWidget(r, 2)),
                "finish": self._combo_value(self._board_table.cellWidget(r, 3)),
                "edging": self._line_value(self._board_table.cellWidget(r, 4)),
                "grain": self._checkbox_value(self._board_table.cellWidget(r, 5)),
                "lacquer": self._checkbox_value(self._board_table.cellWidget(r, 6)),
                "sheetSize": self._combo_value(self._board_table.cellWidget(r, 7)),
            }
            boards.append(row)
        out["boardTypes"] = boards

        staff_access: dict[str, str] = {}
        legacy_staff: dict[str, bool] = {}
        existing_access: dict[str, str] = {}
        perms_raw = out.get("projectPermissions") or {}
        if isinstance(perms_raw, dict):
            raw_access = perms_raw.get("staffAccess")
            if isinstance(raw_access, dict):
                for k, v in raw_access.items():
                    vv = str(v or "").strip().lower()
                    existing_access[str(k)] = vv if vv in ("no_access", "view", "edit") else "no_access"
            else:
                maybe_staff = perms_raw.get("staff")
                if isinstance(maybe_staff, dict):
                    for k, v in maybe_staff.items():
                        existing_access[str(k)] = "view" if bool(v) else "no_access"
        for uid, combo in self._staff_access_controls.items():
            locked = bool(self._staff_access_locked.get(uid, False))
            if locked:
                if bool(self._staff_access_owner_locked.get(uid, False)) or bool(self._staff_access_perm_locked.get(uid, False)):
                    val = str(existing_access.get(uid) or "edit").strip().lower()
                    if val not in ("no_access", "view", "edit"):
                        val = "edit"
                    staff_access[uid] = val
                    legacy_staff[uid] = val in ("view", "edit")
                else:
                    staff_access[uid] = "edit"
                    legacy_staff[uid] = True
                continue
            val = str(combo.currentData() or "no_access").strip().lower()
            if val not in ("no_access", "view", "edit"):
                val = "no_access"
            staff_access[uid] = val
            legacy_staff[uid] = val in ("view", "edit")
        # Owner role should always retain project Edit access.
        for member in self._staff:
            if not isinstance(member, dict):
                continue
            owner_uid = str((member or {}).get("uid") or "").strip()
            if not owner_uid:
                continue
            role_name = str((member or {}).get("roleName") or "").strip().lower()
            role_id = str((member or {}).get("roleId") or (member or {}).get("role") or "").strip().lower()
            if role_id == "owner" or role_name == "owner" or bool((member or {}).get("isOwner")) or bool((member or {}).get("is_owner")):
                staff_access[owner_uid] = "edit"
                legacy_staff[owner_uid] = True
        out["projectPermissions"] = {
            "staffAccess": staff_access,
            # Keep for backward compatibility with any older consumers.
            "staff": legacy_staff,
        }
        return out



