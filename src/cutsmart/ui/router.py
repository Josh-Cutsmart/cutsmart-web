from __future__ import annotations
from dataclasses import dataclass
from enum import Enum

class Route(str, Enum):
    SPLASH = "splash"
    LOGIN = "login"
    REGISTER = "register"
    COMPANY_SELECT = "company_select"
    COMPANY_CREATE = "company_create"
    COMPANY_JOIN = "company_join"
    DASHBOARD = "dashboard"

@dataclass
class SessionState:
    uid: str | None = None
    email: str | None = None
    company_id: str | None = None
    online_state: bool | None = None

class Router:
    def __init__(self) -> None:
        self.route = Route.SPLASH
        self.session = SessionState()

    def go(self, route: Route) -> None:
        self.route = route
