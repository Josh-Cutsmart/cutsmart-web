from __future__ import annotations

import sys
from pathlib import Path
from urllib.request import Request, urlopen

from PySide6.QtCore import QEvent, QObject, Qt, QTimer
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication, QComboBox, QMainWindow, QPushButton, QSplashScreen, QToolButton, QWidget

from cutsmart.app.bootstrap import AppContainer
from cutsmart.ui.router import Route, Router
from cutsmart.ui.style import APP_BG, WINDOW_H, WINDOW_W
from cutsmart.qtui.screens.auth_login import LoginScreen
from cutsmart.qtui.screens.auth_register import RegisterScreen
from cutsmart.qtui.screens.company_create import CompanyCreateScreen
from cutsmart.qtui.screens.company_join import CompanyJoinScreen
from cutsmart.qtui.screens.company_select import CompanySelectScreen
from cutsmart.qtui.screens.dashboard_shell import DashboardShellScreen
from cutsmart.qtui.screens.splash_screen import SplashScreen


class CutsmartQtWindow(QMainWindow):
    def __init__(self, app: AppContainer):
        super().__init__()
        self.app = app
        self.router = Router()
        self.router.session.online_state = self._probe_online_state()
        self._network_manager = None

        saved = self.app.session.load_session()
        if saved and saved.get("uid") and saved.get("remember_me"):
            uid = saved["uid"]
            self.router.session.uid = uid
            self.router.session.email = saved.get("email")
            saved_company = saved.get("company_id")
            # Startup must stay cloud-free so offline launch is always possible.
            company_id = str(saved_company or "").strip() or None
            if company_id:
                self.router.session.company_id = company_id
                self.router.go(Route.DASHBOARD)
            else:
                self.router.go(Route.COMPANY_SELECT)

        self.setWindowTitle(app.config.app_name + " (PySide Pilot)")
        self._apply_custom_app_icon()
        self.resize(WINDOW_W, WINDOW_H)
        self.setMinimumSize(1180, 760)
        self._set_bg(APP_BG)

        self._render()
        self._offline_sync_timer = QTimer(self)
        self._offline_sync_timer.setInterval(8000)
        self._offline_sync_timer.timeout.connect(self._sync_offline_project_patches)
        self._offline_sync_timer.start()
        QTimer.singleShot(1200, self._sync_offline_project_patches)
        self._init_network_monitor()
        self._update_window_title_status()

    def _set_bg(self, color_hex: str) -> None:
        self.setStyleSheet(f"QMainWindow {{ background: {color_hex}; }}")

    def _load_custom_app_icon(self) -> QIcon | None:
        data_dir = Path(getattr(self.app.config, "data_dir", "") or "")
        if not data_dir:
            return None
        icon_dir = data_dir / "app_icon"
        candidates = [
            icon_dir / "app.ico",
            icon_dir / "icon.ico",
            icon_dir / "app.png",
            icon_dir / "icon.png",
        ]
        if icon_dir.exists():
            for ext in (".ico", ".png", ".svg"):
                candidates.extend([p for p in sorted(icon_dir.glob(f"*{ext}")) if p not in candidates])
        for path in candidates:
            try:
                if not path.exists():
                    continue
                icon = QIcon(str(path))
                if not icon.isNull():
                    return icon
            except Exception:
                continue
        return None

    def _apply_custom_app_icon(self) -> None:
        icon = self._load_custom_app_icon()
        if not isinstance(icon, QIcon) or icon.isNull():
            return
        try:
            self.setWindowIcon(icon)
        except Exception:
            pass
        app = QApplication.instance()
        if app is not None:
            try:
                app.setWindowIcon(icon)
            except Exception:
                pass

    def _probe_online_state(self) -> bool:
        try:
            req = Request("https://www.google.com/generate_204", headers={"User-Agent": "Cutsmart/1.0"})
            with urlopen(req, timeout=3) as resp:
                return int(getattr(resp, "status", 0) or 0) in (200, 204)
        except Exception:
            return False

    def _init_network_monitor(self) -> None:
        try:
            from PySide6.QtNetwork import QNetworkConfigurationManager  # type: ignore
            mgr = QNetworkConfigurationManager(self)
            self._network_manager = mgr
            self.router.session.online_state = bool(self._probe_online_state())
            mgr.onlineStateChanged.connect(self._on_online_state_changed)
        except Exception:
            self._network_manager = None

    def _on_online_state_changed(self, is_online: bool) -> None:
        if bool(is_online):
            # Qt can report "online" while internet is unreachable; verify with a real probe.
            self.router.session.online_state = bool(self._probe_online_state())
        else:
            self.router.session.online_state = False
        if bool(is_online):
            self._sync_offline_project_patches()
        self._update_window_title_status()
        self._refresh_connectivity_widgets()

    def _refresh_connectivity_widgets(self) -> None:
        current = self.centralWidget()
        if current is not None and hasattr(current, "_refresh_connection_mode_pill"):
            try:
                current._refresh_connection_mode_pill()
            except Exception:
                pass

    def _update_window_title_status(self) -> None:
        app_name = str(getattr(self.app.config, "app_name", "Cutsmart") or "Cutsmart").strip() or "Cutsmart"
        base = f"{app_name} (PySide Pilot)"
        queue_service = getattr(self.app, "offline_patch_queue", None)
        company_id = str(getattr(self.router.session, "company_id", "") or "").strip()
        pending = 0
        if queue_service is not None and company_id:
            try:
                pending = int(queue_service.pending_count(company_id=company_id, scope="production"))
            except Exception:
                pending = 0
        is_online = bool(getattr(self.router.session, "online_state", True))
        if not is_online:
            self.setWindowTitle(f"{base} - OFFLINE MODE")
        elif pending > 0:
            self.setWindowTitle(f"{base} - ONLINE MODE ({pending} pending sync)")
        else:
            self.setWindowTitle(f"{base} - ONLINE MODE")

    def _sync_offline_project_patches(self) -> None:
        queue_service = getattr(self.app, "offline_patch_queue", None)
        company_id = str(getattr(self.router.session, "company_id", "") or "").strip()
        if queue_service is None or not company_id:
            self._update_window_title_status()
            self._refresh_connectivity_widgets()
            return
        if not bool(getattr(self.router.session, "online_state", True)):
            self._update_window_title_status()
            self._refresh_connectivity_widgets()
            return
        try:
            queue_service.flush(self.app.company, company_id=company_id, scope="production")
        except Exception:
            pass
        self._update_window_title_status()
        self._refresh_connectivity_widgets()

    def _safe_list_user_companies(self, uid: str) -> list[dict]:
        if not uid or not hasattr(self.app.company, "list_user_companies"):
            return []
        if not bool(getattr(self.router.session, "online_state", True)):
            return []
        try:
            out = self.app.company.list_user_companies(uid)
            return list(out or [])
        except Exception as exc:
            print(f"[startup] list_user_companies failed: {exc}", file=sys.stderr)
            return []

    def _safe_get_user_company_id(self, uid: str) -> str | None:
        if not uid:
            return None
        if not bool(getattr(self.router.session, "online_state", True)):
            return None
        try:
            return self.app.company.get_user_company_id(uid)
        except Exception as exc:
            print(f"[startup] get_user_company_id failed: {exc}", file=sys.stderr)
            return None

    def _set_view(self, widget: QWidget) -> None:
        widget.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setCentralWidget(widget)
        self._apply_click_cursor_policy(widget)
        self._refresh_connectivity_widgets()

    def _apply_click_cursor_policy(self, root: QWidget) -> None:
        clickable_types = (QPushButton, QToolButton, QComboBox)
        if isinstance(root, clickable_types):
            root.setCursor(Qt.CursorShape.PointingHandCursor)
        for w in root.findChildren(QWidget):
            if isinstance(w, clickable_types):
                w.setCursor(Qt.CursorShape.PointingHandCursor)

    def _nav(self, route: Route) -> None:
        self.router.go(route)
        self._render()

    def _post_auth_route(self) -> Route:
        uid = self.router.session.uid
        if not uid:
            return Route.LOGIN
        companies = self._safe_list_user_companies(uid)
        company_ids = [c.get("id") for c in companies if c.get("id")]
        current = self.router.session.company_id
        if current not in company_ids:
            current = company_ids[0] if company_ids else self._safe_get_user_company_id(uid)
        self.router.session.company_id = current
        return Route.DASHBOARD if current else Route.COMPANY_SELECT

    def _logout(self) -> None:
        self.app.auth.logout()
        self.app.session.clear_session()
        self.router.session.uid = None
        self.router.session.email = None
        self.router.session.company_id = None
        self._nav(Route.LOGIN)

    def _render(self) -> None:
        route = self.router.route

        if route == Route.SPLASH:
            self._set_view(SplashScreen(on_continue=lambda: self._nav(Route.LOGIN)))
        elif route == Route.LOGIN:
            self._set_view(
                LoginScreen(
                    app=self.app,
                    router=self.router,
                    on_login=lambda: self._nav(self._post_auth_route()),
                    on_register=lambda: self._nav(Route.REGISTER),
                )
            )
        elif route == Route.REGISTER:
            self._set_view(
                RegisterScreen(
                    app=self.app,
                    router=self.router,
                    on_register_done=lambda: self._nav(Route.COMPANY_SELECT),
                    on_back=lambda: self._nav(Route.LOGIN),
                )
            )
        elif route == Route.COMPANY_SELECT:
            self._set_view(
                CompanySelectScreen(
                    app=self.app,
                    router=self.router,
                    on_create=lambda: self._nav(Route.COMPANY_CREATE),
                    on_join=lambda: self._nav(Route.COMPANY_JOIN),
                    on_done=lambda: self._nav(Route.DASHBOARD),
                    on_logout=self._logout,
                )
            )
        elif route == Route.COMPANY_CREATE:
            self._set_view(
                CompanyCreateScreen(
                    app=self.app,
                    router=self.router,
                    on_done=lambda: self._nav(Route.DASHBOARD),
                    on_back=lambda: self._nav(Route.COMPANY_SELECT),
                )
            )
        elif route == Route.COMPANY_JOIN:
            self._set_view(
                CompanyJoinScreen(
                    app=self.app,
                    router=self.router,
                    on_done=lambda: self._nav(Route.DASHBOARD),
                    on_back=lambda: self._nav(Route.COMPANY_SELECT),
                )
            )
        elif route == Route.DASHBOARD:
            self._set_view(
                DashboardShellScreen(
                    app=self.app,
                    router=self.router,
                    on_logout=self._logout,
                    on_switch_company=lambda: self._nav(Route.COMPANY_SELECT),
                    on_create_company=lambda: self._nav(Route.COMPANY_CREATE),
                )
            )
        else:
            self._nav(Route.SPLASH)


class _NoWheelComboFilter(QObject):
    def eventFilter(self, obj: QObject, event: QEvent) -> bool:
        if isinstance(obj, QComboBox) and event.type() == QEvent.Type.Wheel:
            event.ignore()
            return True
        return False


def run_qt(app_container: AppContainer, splash: QSplashScreen | None = None) -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    # App-wide: prevent mouse wheel from accidentally changing combo selections.
    combo_wheel_filter = _NoWheelComboFilter(app)
    app.installEventFilter(combo_wheel_filter)
    app._combo_wheel_filter = combo_wheel_filter  # keep a strong reference
    window = CutsmartQtWindow(app_container)
    if isinstance(splash, QSplashScreen):
        try:
            if hasattr(splash, "set_progress"):
                splash.set_progress(100, "Ready")
            if hasattr(splash, "wait_for_progress_complete"):
                splash.wait_for_progress_complete(900)
            app.processEvents()
        except Exception:
            pass
    window.showMaximized()
    app.processEvents()
    if isinstance(splash, QSplashScreen):
        splash.finish(window)
        try:
            splash.hide()
            splash.close()
            splash.deleteLater()
        except Exception:
            pass
    return app.exec()
