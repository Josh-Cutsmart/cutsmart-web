from __future__ import annotations

import json
import mimetypes
import os
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Callable
from urllib.parse import quote, unquote, urlparse

import requests
import firebase_admin
from firebase_admin import credentials, firestore, storage
from google.cloud.firestore_v1 import FieldFilter
from google.cloud.firestore_v1.watch import Watch


DEFAULT_FIREBASE_CONFIG = {
    "apiKey": "AIzaSyCF8bpTLxxlqC2qE5sfsX6c0GamcsFmIaE",
    "authDomain": "cutsmart-2eedb.firebaseapp.com",
    "projectId": "cutsmart-2eedb",
    "storageBucket": "cutsmart-2eedb.firebasestorage.app",
    "messagingSenderId": "940799823259",
    "appId": "1:940799823259:web:17e0a8ace15a593546e53e",
}


DEFAULT_PROJECT_STATUSES = [
    {"name": "New", "color": "#3060D0"},
    {"name": "Quoting", "color": "#B06000"},
    {"name": "Drafting", "color": "#5B3CC4"},
    {"name": "Ready for CNC", "color": "#3060D0"},
    {"name": "Running", "color": "#2A7A3B"},
    {"name": "In Production", "color": "#2A7A3B"},
    {"name": "Paused", "color": "#B06000"},
    {"name": "Completed", "color": "#2A7A3B"},
]

DEFAULT_ROLE_PERMISSIONS = {
    "company.dashboard.view": False,
    "projects.create": True,
    "projects.view": True,
    "projects.view.others": False,
    "projects.status": False,
    "projects.create.others": False,
    "sales.view": False,
    "sales.edit": False,
    "production.view": False,
    "production.edit": False,
    "production.key": False,
    "staff.add": False,
    "staff.remove": False,
    "staff.change.role": False,
    "staff.change.display_name": False,
    "company.settings": False,
    "company.updates": True,
}

ALL_PERMISSIONS = list(DEFAULT_ROLE_PERMISSIONS.keys())

DEFAULT_CUTLIST_COLUMNS = [
    "Part Type",
    "Board",
    "Name",
    "Height",
    "Width",
    "Depth",
    "Quantity",
    "Clashing",
    "Information",
    "Grain",
]
class FirebaseConfigError(RuntimeError):
    pass


# Firestore has a 1MiB document limit. Keep large lists/strings under control.
MAX_INLINE_CUTLIST_ROWS = 2000
_AUTH_TIMEOUT = 20


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now_utc().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso_utc(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _slug(value: str) -> str:
    text = ''.join(ch.lower() if ch.isalnum() else '-' for ch in value).strip('-')
    while '--' in text:
        text = text.replace('--', '-')
    return text or 'item'


def _to_dict(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if isinstance(value, list):
        return [_to_dict(item) for item in value]
    if isinstance(value, dict):
        return {key: _to_dict(val) for key, val in value.items()}
    return value


def _user_display_name(email: str) -> str:
    local = (email or '').split('@')[0]
    return local or 'user'


class FirebaseClient:
    def __init__(self, project_root: Path, progress_cb: Callable[[int, str], None] | None = None):
        self.project_root = Path(project_root)
        self._lock = RLock()
        self._progress_cb = progress_cb
        self._emit_progress(8, "Loading Firebase config...")
        self.firebase_config = self._load_firebase_config()
        self._emit_progress(20, "Validating Firebase keys...")
        self.api_key = self.firebase_config.get('apiKey')
        if not self.api_key:
            raise FirebaseConfigError('Firebase Web API key was not found.')
        self.project_id = self.firebase_config.get('projectId')
        if not self.project_id:
            raise FirebaseConfigError('Firebase projectId was not found.')
        self._emit_progress(34, "Resolving service account...")
        self.cred_path = self._resolve_service_account_path()
        self._emit_progress(52, "Initializing Firebase app...")
        self.app = self._init_admin_app()
        self._emit_progress(74, "Creating Firestore client...")
        self.db = firestore.client(self.app)
        self._emit_progress(88, "Preparing storage bucket...")
        self.bucket = storage.bucket(app=self.app)
        self._emit_progress(100, "Firebase ready")

    def _emit_progress(self, percent: int, status: str) -> None:
        if callable(self._progress_cb):
            try:
                self._progress_cb(int(percent), str(status or ""))
            except Exception:
                pass

    def _load_firebase_config(self) -> dict:
        env_json = os.environ.get('CUTSMART_FIREBASE_CONFIG_JSON')
        if env_json:
            try:
                return json.loads(env_json)
            except Exception as exc:
                raise FirebaseConfigError(f'Invalid CUTSMART_FIREBASE_CONFIG_JSON: {exc}') from exc

        local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
        appdata_secret = (Path(local_appdata) / "CutSmart" / "secret") if local_appdata else None
        cfg_paths = [
            self.project_root / 'secret' / 'firebase_web_config.json',
            self.project_root / '_internal' / 'secret' / 'firebase_web_config.json',
            self.project_root / 'firebase_web_config.json',
        ]
        if appdata_secret is not None:
            cfg_paths.append(appdata_secret / "firebase_web_config.json")
        for path in cfg_paths:
            if path.exists():
                data = json.loads(path.read_text(encoding='utf-8'))
                if isinstance(data, dict):
                    return data
        return dict(DEFAULT_FIREBASE_CONFIG)

    def _resolve_service_account_path(self) -> Path:
        env_path = os.environ.get('CUTSMART_FIREBASE_SERVICE_ACCOUNT')
        if env_path:
            path = Path(env_path)
            if path.exists():
                return path

        secret_dir = self.project_root / 'secret'
        secret_dir_internal = self.project_root / '_internal' / 'secret'
        local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
        appdata_secret = (Path(local_appdata) / "CutSmart" / "secret") if local_appdata else None
        candidates = [
            secret_dir / 'firebase_service_account.json',
            secret_dir / 'cutsmart-2eedb-firebase-adminsdk-fbsvc-a2351d57fd.json',
            secret_dir_internal / 'firebase_service_account.json',
            secret_dir_internal / 'cutsmart-2eedb-firebase-adminsdk-fbsvc-a2351d57fd.json',
        ]
        candidates.extend(secret_dir.glob('*firebase-adminsdk*.json'))
        candidates.extend(secret_dir_internal.glob('*firebase-adminsdk*.json'))
        if appdata_secret is not None:
            candidates.append(appdata_secret / "firebase_service_account.json")
            candidates.extend(appdata_secret.glob("*firebase-adminsdk*.json"))
        for path in candidates:
            if path.exists():
                return path
        raise FirebaseConfigError('Firebase service account JSON was not found.')

    def _init_admin_app(self):
        cred_key = str(self.cred_path.resolve())
        app_name = f'cutsmart:{self.project_id}:{cred_key}'
        with self._lock:
            for existing in firebase_admin._apps.values():
                opts = existing.options or {}
                if opts.get('projectId') == self.project_id and opts.get('storageBucket') == self.firebase_config.get('storageBucket'):
                    return existing
            cred = credentials.Certificate(str(self.cred_path))
            options = {
                'projectId': self.project_id,
                'storageBucket': self.firebase_config.get('storageBucket'),
            }
            return firebase_admin.initialize_app(cred, options=options, name=app_name)

    def auth_post(self, action: str, payload: dict) -> dict:
        url = f'https://identitytoolkit.googleapis.com/v1/accounts:{action}?key={self.api_key}'
        response = requests.post(url, json=payload, timeout=_AUTH_TIMEOUT)
        try:
            data = response.json()
        except Exception:
            response.raise_for_status()
            raise
        if response.status_code >= 400:
            message = data.get('error', {}).get('message', 'Authentication failed.')
            raise ValueError(_auth_error_message(message))
        return data


class FirebaseSessionService:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / 'session.json'

    def load_session(self):
        if not self.path.exists():
            return None
        try:
            return json.loads(self.path.read_text(encoding='utf-8'))
        except Exception:
            return None

    def save_session(self, uid: str, email: str, remember_me: bool, company_id: str | None = None, id_token: str | None = None, refresh_token: str | None = None):
        payload = {
            'uid': uid,
            'email': email,
            'remember_me': bool(remember_me),
            'company_id': company_id,
            'id_token': id_token,
            'refresh_token': refresh_token,
        }
        self.path.write_text(json.dumps(payload, indent=2), encoding='utf-8')

    def clear_session(self):
        if self.path.exists():
            self.path.unlink()


class FirebaseOfflinePatchQueueService:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "offline_project_patch_queue.json"
        self._lock = RLock()

    def _load(self) -> list[dict]:
        with self._lock:
            if not self.path.exists():
                return []
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                return []
            items = raw.get("items") if isinstance(raw, dict) else []
            out: list[dict] = []
            for item in (items or []):
                if not isinstance(item, dict):
                    continue
                company_id = str(item.get("companyId") or "").strip()
                job_id = str(item.get("jobId") or "").strip()
                patch = item.get("patch")
                if not company_id or not job_id or not isinstance(patch, dict):
                    continue
                out.append(
                    {
                        "companyId": company_id,
                        "jobId": job_id,
                        "scope": str(item.get("scope") or "").strip() or "production",
                        "queuedAt": str(item.get("queuedAt") or "").strip() or _now_iso(),
                        "patch": dict(patch),
                    }
                )
            return out

    def _save(self, items: list[dict]) -> None:
        with self._lock:
            payload = {"items": list(items or [])}
            self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def enqueue(self, company_id: str, job_id: str, patch: dict, scope: str = "production") -> bool:
        cid = str(company_id or "").strip()
        jid = str(job_id or "").strip()
        if not cid or not jid or not isinstance(patch, dict):
            return False
        scoped = str(scope or "").strip() or "production"
        items = self._load()
        merged_existing = False
        for item in items:
            if (
                str(item.get("companyId") or "").strip() == cid
                and str(item.get("jobId") or "").strip() == jid
                and str(item.get("scope") or "").strip() == scoped
            ):
                existing_patch = item.get("patch") if isinstance(item.get("patch"), dict) else {}
                combined = dict(existing_patch)
                combined.update(dict(patch))
                item["patch"] = combined
                item["queuedAt"] = _now_iso()
                merged_existing = True
                break
        if not merged_existing:
            items.append({"companyId": cid, "jobId": jid, "scope": scoped, "queuedAt": _now_iso(), "patch": dict(patch)})
        self._save(items)
        return True

    def flush(self, company_service: Any, company_id: str | None = None, scope: str = "production") -> int:
        if not hasattr(company_service, "update_job"):
            return 0
        scoped = str(scope or "").strip() or "production"
        target_company = str(company_id or "").strip()
        items = self._load()
        if not items:
            return 0
        kept: list[dict] = []
        flushed = 0
        for idx, item in enumerate(items):
            item_scope = str(item.get("scope") or "").strip() or "production"
            cid = str(item.get("companyId") or "").strip()
            jid = str(item.get("jobId") or "").strip()
            patch = item.get("patch") if isinstance(item.get("patch"), dict) else {}
            if not cid or not jid or not isinstance(patch, dict):
                continue
            if item_scope != scoped or (target_company and cid != target_company):
                kept.append(item)
                continue
            try:
                company_service.update_job(cid, jid, dict(patch))
                flushed += 1
            except Exception:
                # Keep this and the remaining scope-matching items for later retry.
                kept.append(item)
                keep_rest = items[idx + 1 :]
                kept.extend([r for r in keep_rest if isinstance(r, dict)])
                break
        self._save(kept)
        return int(flushed)

    def pending_count(self, company_id: str | None = None, scope: str = "production") -> int:
        scoped = str(scope or "").strip() or "production"
        target_company = str(company_id or "").strip()
        items = self._load()
        count = 0
        for item in items:
            if not isinstance(item, dict):
                continue
            item_scope = str(item.get("scope") or "").strip() or "production"
            if item_scope != scoped:
                continue
            if target_company and str(item.get("companyId") or "").strip() != target_company:
                continue
            count += 1
        return int(count)


class FirebaseCompanyService:
    def __init__(self, client: FirebaseClient):
        self.client = client
        self.db = client.db

    def _role_permissions(self, role_id: str) -> dict:
        role_id = (role_id or '').strip().lower()
        base = dict(DEFAULT_ROLE_PERMISSIONS)
        if role_id in ('owner', 'admin'):
            return {name: True for name in ALL_PERMISSIONS}
        return base

    def _default_roles(self) -> list[dict]:
        return [
            {
                'id': 'owner',
                'name': 'Owner',
                'color': '#1F2937',
                'permissions': {name: True for name in ALL_PERMISSIONS},
            },
            {
                'id': 'admin',
                'name': 'Admin',
                'color': '#2F6BFF',
                'permissions': {name: True for name in ALL_PERMISSIONS},
            },
            {
                'id': 'staff',
                'name': 'Staff',
                'color': '#5B6472',
                'permissions': self._role_permissions('staff'),
            },
        ]

    def _normalize_role(self, role: dict) -> dict:
        raw = dict(role or {})
        role_id = _slug(raw.get('id') or raw.get('name') or 'staff').replace('-', '_')
        name = (raw.get('name') or role_id.replace('_', ' ').title()).strip() or 'Role'
        color = (raw.get('color') or '#5B6472').strip() or '#5B6472'
        perms = dict(DEFAULT_ROLE_PERMISSIONS)
        incoming = raw.get('permissions') or {}
        # Backward-compat alias: migrate old singular key to plural key.
        if isinstance(incoming, dict) and "projects.create.other" in incoming and "projects.create.others" not in incoming:
            incoming = dict(incoming)
            incoming["projects.create.others"] = bool(incoming.get("projects.create.other"))
        if isinstance(incoming, dict):
            for key in ALL_PERMISSIONS:
                if key in incoming:
                    perms[key] = bool(incoming.get(key))
        if role_id in ('owner', 'admin'):
            perms = {name: True for name in ALL_PERMISSIONS}
        return {'id': role_id, 'name': name, 'color': color, 'permissions': perms}

    def _company_roles(self, company_data: dict) -> list[dict]:
        raw_roles = company_data.get('roles') or []
        if not isinstance(raw_roles, list) or not raw_roles:
            raw_roles = self._default_roles()
        normalized = [self._normalize_role(item) for item in raw_roles]
        ids = {item.get('id') for item in normalized}
        for fallback in self._default_roles():
            if fallback['id'] not in ids:
                normalized.append(fallback)
        return normalized

    def get_member_role(self, company_id: str, uid: str) -> str:
        membership = self._membership_data(company_id, uid) or {}
        return (membership.get('roleId') or 'staff').strip().lower()

    def list_role_definitions(self, company_id: str) -> list[dict]:
        company = self._company_data(company_id)
        return self._company_roles(company)

    def get_role_permissions(self, company_id: str, role_id: str) -> dict:
        roles = self.list_role_definitions(company_id)
        wanted = (role_id or '').strip().lower()
        for role in roles:
            if role.get('id') == wanted:
                return dict(role.get('permissions') or DEFAULT_ROLE_PERMISSIONS)
        return dict(DEFAULT_ROLE_PERMISSIONS)

    def user_has_permission(self, company_id: str, uid: str, permission: str) -> bool:
        role_id = self.get_member_role(company_id, uid)
        perms = self.get_role_permissions(company_id, role_id)
        return bool(perms.get(permission, False))

    # collection helpers
    def users_col(self):
        return self.db.collection('users')

    def companies_col(self):
        return self.db.collection('companies')

    def company_ref(self, company_id: str):
        return self.companies_col().document(company_id)

    def memberships_col(self, company_id: str):
        return self.company_ref(company_id).collection('memberships')

    def jobs_col(self, company_id: str):
        return self.company_ref(company_id).collection('jobs')

    def notifications_col(self, uid: str):
        return self.users_col().document(uid).collection('notifications')

    def pending_invites_col(self):
        return self.db.collection('pendingInvites')

    @staticmethod
    def _is_remote_path(value: str) -> bool:
        txt = str(value or "").strip().lower()
        return txt.startswith("http://") or txt.startswith("https://") or txt.startswith("gs://")

    @staticmethod
    def _bucket_blob_from_storage_path(value: str) -> tuple[str, str] | None:
        txt = str(value or "").strip()
        if not txt:
            return None
        low = txt.lower()
        if low.startswith("gs://"):
            payload = txt[5:]
            if "/" not in payload:
                return None
            bucket, blob = payload.split("/", 1)
            bucket = str(bucket or "").strip()
            blob = str(blob or "").strip()
            if bucket and blob:
                return bucket, blob
            return None
        if low.startswith("http://") or low.startswith("https://"):
            try:
                parsed = urlparse(txt)
                parts = [p for p in str(parsed.path or "").split("/") if p]
                if len(parts) >= 5 and parts[0] == "v0" and parts[1] == "b" and parts[3] == "o":
                    bucket = str(parts[2] or "").strip()
                    blob = unquote("/".join(parts[4:]).strip())
                    if bucket and blob:
                        return bucket, blob
            except Exception:
                return None
        return None

    def _firebase_download_url(self, blob_name: str, token: str, bucket_name: str | None = None) -> str:
        bucket_name = str(bucket_name or getattr(self.client.bucket, "name", "") or "")
        return f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}/o/{quote(blob_name, safe='')}?alt=media&token={token}"

    def _prepare_project_images(self, company_id: str, job_id: str, image_paths: list[str] | None) -> list[str]:
        out: list[str] = []
        for idx, raw in enumerate([str(x).strip() for x in (image_paths or []) if str(x).strip()][:5], start=1):
            if self._is_remote_path(raw):
                out.append(raw)
                continue
            src = Path(raw)
            if not src.exists() or not src.is_file():
                continue
            ext = src.suffix or ".jpg"
            blob_name = f"companies/{company_id}/projects/{job_id}/images/{idx}_{uuid.uuid4().hex}{ext}"
            token = uuid.uuid4().hex
            content_type = mimetypes.guess_type(str(src))[0] or "application/octet-stream"
            try:
                blob = self.client.bucket.blob(blob_name)
                metadata = dict(blob.metadata or {})
                metadata["firebaseStorageDownloadTokens"] = token
                blob.metadata = metadata
                blob.upload_from_filename(str(src), content_type=content_type)
                blob.patch()
                out.append(self._firebase_download_url(blob_name, token))
            except Exception:
                # Keep original path as a fallback to avoid losing user input completely.
                out.append(raw)
        return out

    def _prepare_user_avatar(self, uid: str, avatar_path: str) -> str:
        raw = str(avatar_path or "").strip()
        if not raw:
            return ""
        if self._is_remote_path(raw):
            return raw
        src = Path(raw)
        if not src.exists() or not src.is_file():
            raise ValueError("Selected avatar file could not be found for Firebase upload.")
        ext = src.suffix or ".png"
        blob_name = f"users/{uid}/avatar/{uuid.uuid4().hex}{ext}"
        token = uuid.uuid4().hex
        content_type = mimetypes.guess_type(str(src))[0] or "application/octet-stream"
        configured_bucket = str(self.client.firebase_config.get("storageBucket") or "").strip()
        fallback_bucket = ""
        if configured_bucket.endswith(".firebasestorage.app"):
            fallback_bucket = configured_bucket.replace(".firebasestorage.app", ".appspot.com")
        elif configured_bucket.endswith(".appspot.com"):
            fallback_bucket = configured_bucket.replace(".appspot.com", ".firebasestorage.app")
        project_id = str(getattr(self.client, "project_id", "") or "").strip()
        project_bucket_appspot = f"{project_id}.appspot.com" if project_id else ""
        project_bucket_firebase = f"{project_id}.firebasestorage.app" if project_id else ""
        bucket_names = [
            str(getattr(self.client.bucket, "name", "") or "").strip(),
            configured_bucket,
            fallback_bucket,
            project_bucket_appspot,
            project_bucket_firebase,
        ]
        bucket_names = [b for i, b in enumerate(bucket_names) if b and b not in bucket_names[:i]]
        last_exc: Exception | None = None
        for bucket_name in bucket_names:
            try:
                bucket = storage.bucket(name=bucket_name, app=self.client.app)
                blob = bucket.blob(blob_name)
                metadata = dict(blob.metadata or {})
                metadata["firebaseStorageDownloadTokens"] = token
                blob.metadata = metadata
                blob.upload_from_filename(str(src), content_type=content_type)
                blob.patch()
                saved = self._firebase_download_url(blob_name, token, bucket_name=bucket_name)
                if self._is_remote_path(saved):
                    return saved
                raise ValueError("Firebase upload did not return a remote avatar URL.")
            except Exception as exc:
                last_exc = exc
        detail = str(last_exc or "").strip()
        if detail:
            raise ValueError(f"Could not upload profile photo to Firebase Storage. {detail}") from last_exc
        raise ValueError("Could not upload profile photo to Firebase Storage.")

    def fetch_remote_image_bytes(self, source: str) -> bytes:
        mapping = self._bucket_blob_from_storage_path(source)
        if not mapping:
            raise ValueError("Unsupported storage path.")
        bucket_name, blob_name = mapping
        bucket = storage.bucket(name=str(bucket_name), app=self.client.app)
        blob = bucket.blob(str(blob_name))
        return blob.download_as_bytes()

    def _prepare_company_logo(self, company_id: str, logo_path: str) -> str:
        raw = str(logo_path or "").strip()
        if not raw:
            return ""
        if self._is_remote_path(raw):
            return raw
        src = Path(raw)
        if not src.exists() or not src.is_file():
            return raw
        ext = src.suffix or ".png"
        blob_name = f"companies/{company_id}/branding/logo/{uuid.uuid4().hex}{ext}"
        token = uuid.uuid4().hex
        content_type = mimetypes.guess_type(str(src))[0] or "application/octet-stream"
        try:
            blob = self.client.bucket.blob(blob_name)
            metadata = dict(blob.metadata or {})
            metadata["firebaseStorageDownloadTokens"] = token
            blob.metadata = metadata
            blob.upload_from_filename(str(src), content_type=content_type)
            blob.patch()
            return self._firebase_download_url(blob_name, token)
        except Exception:
            return raw

    # user helpers
    def ensure_user_profile(self, uid: str, email: str, display_name: str | None = None, mobile: str | None = None):
        email = (email or '').strip().lower()
        ref = self.users_col().document(uid)
        snapshot = ref.get()
        existing = _to_dict(snapshot.to_dict() or {}) if snapshot.exists else {}
        payload = {
            'uid': uid,
            'email': email,
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'updatedAtIso': _now_iso(),
        }
        # Preserve user-entered casing for existing profiles.
        if display_name is not None:
            payload['displayName'] = str(display_name).strip() or _user_display_name(email)
        elif not str(existing.get('displayName') or '').strip():
            payload['displayName'] = _user_display_name(email)
        if mobile is not None:
            payload['mobile'] = str(mobile or '').strip()
        if not snapshot.exists:
            payload['createdAt'] = firestore.SERVER_TIMESTAMP
            payload['createdAtIso'] = _now_iso()
        ref.set(payload, merge=True)
        self._accept_pending_invites(uid, email)

    def get_user_profile(self, uid: str) -> dict:
        user = self._user_snapshot(uid)
        email = str(user.get('email') or '').strip().lower()
        return {
            'uid': uid,
            'email': email,
            'displayName': user.get('displayName') or _user_display_name(email),
            'mobile': str(user.get('mobile') or user.get('phone') or '').strip(),
            'avatarPath': str(user.get('avatarPath') or '').strip(),
            'badgeColor': str(user.get('badgeColor') or '#7D99B3').strip(),
            'uiTheme': str(user.get('uiTheme') or 'light').strip().lower(),
        }

    def update_user_profile(
        self,
        uid: str,
        display_name: str | None = None,
        mobile: str | None = None,
        avatar_path: str | None = None,
        badge_color: str | None = None,
        ui_theme: str | None = None,
    ) -> None:
        ref = self.users_col().document(uid)
        snap = ref.get()
        if not snap.exists:
            raise ValueError('User not found.')
        payload = {
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'updatedAtIso': _now_iso(),
        }
        if display_name is not None:
            name = str(display_name).strip()
            if not name:
                raise ValueError('Display name is required.')
            payload['displayName'] = name
        if mobile is not None:
            payload['mobile'] = str(mobile or '').strip()
        if avatar_path is not None:
            saved_avatar = self._prepare_user_avatar(uid, str(avatar_path or '').strip())
            if not saved_avatar or not self._is_remote_path(saved_avatar):
                raise ValueError("Avatar was not saved to Firebase Storage.")
            payload['avatarPath'] = saved_avatar
        if badge_color is not None:
            payload['badgeColor'] = str(badge_color or '').strip()
        if ui_theme is not None:
            payload['uiTheme'] = str(ui_theme or 'light').strip().lower()
        ref.set(payload, merge=True)
        if mobile is not None:
            self._sync_membership_mobile(uid, str(mobile or '').strip())
        if avatar_path is not None:
            self._sync_membership_avatar(uid, str(payload.get('avatarPath') or '').strip())

    def _sync_membership_mobile(self, uid: str, mobile: str) -> None:
        value = str(mobile or '').strip()
        docs = list(self.db.collection_group('memberships').where(filter=FieldFilter('uid', '==', uid)).stream())
        for doc in docs:
            try:
                doc.reference.set(
                    {
                        'mobile': value,
                        'updatedAt': firestore.SERVER_TIMESTAMP,
                        'updatedAtIso': _now_iso(),
                    },
                    merge=True,
                )
            except Exception:
                continue

    def _sync_membership_avatar(self, uid: str, avatar_path: str) -> None:
        value = str(avatar_path or '').strip()
        docs = list(self.db.collection_group('memberships').where(filter=FieldFilter('uid', '==', uid)).stream())
        for doc in docs:
            try:
                doc.reference.set(
                    {
                        'avatarPath': value,
                        'updatedAt': firestore.SERVER_TIMESTAMP,
                        'updatedAtIso': _now_iso(),
                    },
                    merge=True,
                )
            except Exception:
                continue

    def update_company_logo(self, company_id: str, logo_path: str) -> str:
        saved_path = self._prepare_company_logo(company_id, str(logo_path or "").strip())
        self.update_company(company_id, {"logoPath": saved_path})
        return saved_path

    def _accept_pending_invites(self, uid: str, email: str):
        # Backward-compatible hook: keep invites pending but stamp target UID once the user exists.
        email = (email or '').strip().lower()
        docs = list(self.pending_invites_col().where(filter=FieldFilter('email', '==', email)).stream())
        for doc in docs:
            doc.reference.set({'targetUid': uid, 'updatedAtIso': _now_iso()}, merge=True)

    def _user_snapshot(self, uid: str) -> dict:
        snap = self.users_col().document(uid).get()
        if not snap.exists:
            raise ValueError('User not found.')
        return _to_dict(snap.to_dict() or {})

    def _company_snapshot(self, company_id: str):
        snap = self.company_ref(company_id).get()
        if not snap.exists:
            raise ValueError('Company not found.')
        return snap

    def _company_data(self, company_id: str) -> dict:
        snap = self._company_snapshot(company_id)
        data = _to_dict(snap.to_dict() or {})
        data['id'] = company_id
        return data

    def _membership_data(self, company_id: str, uid: str):
        snap = self.memberships_col(company_id).document(uid).get()
        return _to_dict(snap.to_dict() or {}) if snap.exists else None

    def _add_notification(self, uid: str, title: str, message: str, type_: str = 'info', read: bool = False):
        ref = self.notifications_col(uid).document()
        ref.set({
            'id': ref.id,
            'title': title,
            'message': message,
            'type': type_,
            'read': bool(read),
            'createdAt': firestore.SERVER_TIMESTAMP,
            'createdAtIso': _now_iso(),
        })

    def _member_summary(self, company_id: str, uid: str) -> dict:
        user = self._user_snapshot(uid)
        membership = self._membership_data(company_id, uid) or {}
        return {
            'uid': uid,
            'email': user.get('email', ''),
            'displayName': user.get('displayName') or _user_display_name(user.get('email', '')),
            'mobile': str(user.get('mobile') or user.get('phone') or membership.get('mobile') or '').strip(),
            'avatarPath': str(user.get('avatarPath') or '').strip(),
            'badgeColor': str(user.get('badgeColor') or '#7D99B3').strip(),
            'roleId': membership.get('roleId') or 'staff',
        }

    def create_company(self, uid: str, name: str, join_code: str) -> str:
        name = (name or '').strip()
        join_code = (join_code or '').strip()
        if not name:
            raise ValueError('Company name is required.')
        if not join_code:
            raise ValueError('Company code / password is required.')
        company_id = f"cmp_{_slug(name)}_{uuid.uuid4().hex[:6]}"
        user = self._user_snapshot(uid)
        self.company_ref(company_id).set({
            'id': company_id,
            'name': name,
            'joinCode': join_code,
            'planTier': 'free',
            'themeColor': '#2F6BFF',
            'timeZone': 'Pacific/Auckland',
            'deletedRetentionDays': 90,
            'ownerUid': uid,
            'logoPath': '',
            'partTypes': [],
            'boardThicknesses': [16, 18],
            'roles': self._default_roles(),
            'projectStatuses': list(DEFAULT_PROJECT_STATUSES),
            'cutlistColumns': list(DEFAULT_CUTLIST_COLUMNS),
            'cutlistAutomation': {
                'frontsAutoFill2L2SH': True,
            },
            'nestingSettings': {
                'sheetWidth': 1220,
                'sheetHeight': 2440,
                'kerf': 5,
                'margin': 10,
            },
            'createdAt': firestore.SERVER_TIMESTAMP,
            'createdAtIso': _now_iso(),
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'updatedAtIso': _now_iso(),
        })
        self.memberships_col(company_id).document(uid).set({
            'uid': uid,
            'email': user.get('email', ''),
            'mobile': str(user.get('mobile') or user.get('phone') or '').strip(),
            'avatarPath': str(user.get('avatarPath') or '').strip(),
            'roleId': 'owner',
            'joinedAt': firestore.SERVER_TIMESTAMP,
            'joinedAtIso': _now_iso(),
            'active': True,
        })
        self._add_notification(uid, 'Company created', f'{name} was created successfully.', 'success', read=True)
        return company_id

    def join_company(self, uid: str, join_code: str) -> str:
        join_code = (join_code or '').strip()
        if not join_code:
            raise ValueError('Company code / password is required.')
        matches = list(self.companies_col().where(filter=FieldFilter('joinCode', '==', join_code)).limit(1).stream())
        if not matches:
            raise ValueError('Company code not found.')
        company_snap = matches[0]
        company_id = company_snap.id
        company = company_snap.to_dict() or {}
        user = self._user_snapshot(uid)
        existing = self._membership_data(company_id, uid) or {}
        self.memberships_col(company_id).document(uid).set({
            'uid': uid,
            'email': user.get('email', ''),
            'mobile': str(user.get('mobile') or user.get('phone') or '').strip(),
            'avatarPath': str(user.get('avatarPath') or '').strip(),
            'roleId': existing.get('roleId') or 'staff',
            'joinedAt': firestore.SERVER_TIMESTAMP,
            'joinedAtIso': _now_iso(),
            'active': True,
        }, merge=True)
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        self._add_notification(uid, 'Joined company', f"You joined {company.get('name', 'the company') }.", 'success', read=True)
        return company_id

    def get_user_company_id(self, uid: str):
        companies = self.list_user_companies(uid)
        if not companies:
            return None
        return companies[0].get('id')

    def list_user_companies(self, uid: str) -> list[dict]:
        docs = list(self.db.collection_group('memberships').where(filter=FieldFilter('uid', '==', uid)).stream())
        companies = []
        for doc in docs:
            parent = doc.reference.parent.parent
            if not parent:
                continue
            snap = parent.get()
            if not snap.exists:
                continue
            company = _to_dict(snap.to_dict() or {})
            company['id'] = snap.id
            companies.append(company)
        companies.sort(key=lambda item: item.get('name', '').lower())
        return companies

    def list_pending_invites(self, uid: str | None = None, email: str | None = None) -> list[dict]:
        normalized_email = (email or '').strip().lower()
        items = []
        if uid:
            docs = list(self.pending_invites_col().where(filter=FieldFilter('targetUid', '==', uid)).stream())
            items.extend(docs)
        if normalized_email:
            docs = list(self.pending_invites_col().where(filter=FieldFilter('email', '==', normalized_email)).stream())
            items.extend(docs)
        unique = {}
        for doc in items:
            unique[doc.id] = doc
        rows = []
        for doc in unique.values():
            data = _to_dict(doc.to_dict() or {})
            data['id'] = doc.id
            rows.append(data)
        rows.sort(key=lambda item: item.get('createdAtIso') or '', reverse=True)
        return rows

    def accept_company_invite(self, uid: str, invite_id: str) -> str:
        invite_ref = self.pending_invites_col().document(invite_id)
        snap = invite_ref.get()
        if not snap.exists:
            raise ValueError('Invite not found.')
        data = _to_dict(snap.to_dict() or {})
        email = (data.get('email') or '').strip().lower()
        user = self._user_snapshot(uid)
        user_email = (user.get('email') or '').strip().lower()
        target_uid = (data.get('targetUid') or '').strip()
        if target_uid and target_uid != uid:
            raise ValueError('This invite is for a different user.')
        if email and user_email and email != user_email:
            raise ValueError('This invite email does not match your account.')
        company_id = data.get('companyId')
        if not company_id:
            raise ValueError('Invite is invalid.')
        role_id = (data.get('roleId') or 'staff').strip().lower()
        valid_roles = self.list_roles(company_id)
        if role_id not in valid_roles:
            role_id = 'staff' if 'staff' in valid_roles else (valid_roles[0] if valid_roles else 'staff')
        self.memberships_col(company_id).document(uid).set({
            'uid': uid,
            'email': user_email,
            'mobile': str(user.get('mobile') or user.get('phone') or '').strip(),
            'roleId': role_id,
            'joinedAt': firestore.SERVER_TIMESTAMP,
            'joinedAtIso': _now_iso(),
            'active': True,
        }, merge=True)
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        invite_ref.delete()
        company = self._company_data(company_id)
        self._add_notification(uid, 'Company invite accepted', f"You joined {company.get('name', 'the company')}.", 'success', read=True)
        inviter_uid = data.get('invitedByUid')
        if inviter_uid:
            self._add_notification(inviter_uid, 'Staff added', f"{user.get('displayName') or user_email} accepted your invite.", 'info', read=False)
        return company_id

    def decline_company_invite(self, uid: str, invite_id: str):
        invite_ref = self.pending_invites_col().document(invite_id)
        snap = invite_ref.get()
        if not snap.exists:
            return
        data = _to_dict(snap.to_dict() or {})
        target_uid = (data.get('targetUid') or '').strip()
        if target_uid and target_uid != uid:
            raise ValueError('This invite is for a different user.')
        invite_ref.delete()
    def get_company(self, company_id: str):
        data = self._company_data(company_id)
        return data

    def update_company(self, company_id: str, patch: dict):
        payload = deepcopy(patch or {})
        payload['updatedAt'] = firestore.SERVER_TIMESTAMP
        payload['updatedAtIso'] = _now_iso()
        self.company_ref(company_id).set(payload, merge=True)

    def update_company_settings(self, company_id: str, patch: dict):
        self.update_company(company_id, patch)

    def set_company_settings(self, company_id: str, patch: dict):
        self.update_company(company_id, patch)

    def list_staff(self, company_id: str):
        docs = list(self.memberships_col(company_id).stream())
        staff = []
        for doc in docs:
            data = doc.to_dict() or {}
            if data.get('active') is False:
                continue
            staff.append(self._member_summary(company_id, doc.id))
        staff.sort(key=lambda item: item.get('displayName', '').lower())
        return staff

    def list_roles(self, company_id: str):
        return [row.get('id') for row in self.list_role_definitions(company_id) if row.get('id')]

    def update_member_role(self, company_id: str, uid: str, role_id: str):
        role_id = (role_id or '').strip().lower()
        if role_id not in self.list_roles(company_id):
            raise ValueError('Invalid role.')
        membership_ref = self.memberships_col(company_id).document(uid)
        if not membership_ref.get().exists:
            raise ValueError('Member not found.')
        membership_ref.set({'roleId': role_id, 'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        company = self._company_data(company_id)
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        role_name = str(role_id or 'staff').replace('_', ' ').title()
        self._add_notification(uid, 'Role Changed', f'Your role in {company.get("name", "the company")} was changed to {role_name}.', 'role_changed')

    def update_member_display_name(self, company_id: str, uid: str, display_name: str) -> None:
        name = str(display_name or '').strip()
        if not name:
            raise ValueError('Display name is required.')
        company = self._company_data(company_id)
        membership_ref = self.memberships_col(company_id).document(uid)
        if not membership_ref.get().exists:
            raise ValueError('Member not found.')
        user_ref = self.users_col().document(uid)
        if not user_ref.get().exists:
            raise ValueError('User not found.')
        user_ref.set(
            {
                'displayName': name,
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'updatedAtIso': _now_iso(),
            },
            merge=True,
        )
        job_docs = list(self.jobs_col(company_id).where(filter=FieldFilter('createdByUid', '==', uid)).stream())
        now_iso = _now_iso()
        for doc in job_docs:
            doc.reference.set(
                {
                    'createdByName': name,
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                    'updatedAtIso': now_iso,
                },
                merge=True,
            )
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        self._add_notification(uid, 'Profile Updated', f'Your display name in {company.get("name", "the company")} was updated.', 'info')

    def update_member_mobile(self, company_id: str, uid: str, mobile: str) -> None:
        company = self._company_data(company_id)
        membership_ref = self.memberships_col(company_id).document(uid)
        if not membership_ref.get().exists:
            raise ValueError('Member not found.')
        user_ref = self.users_col().document(uid)
        if not user_ref.get().exists:
            raise ValueError('User not found.')
        user_ref.set(
            {
                'mobile': str(mobile or '').strip(),
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'updatedAtIso': _now_iso(),
            },
            merge=True,
        )
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        self._add_notification(uid, 'Profile Updated', f'Your mobile number in {company.get("name", "the company")} was updated.', 'info')

    def remove_member(self, company_id: str, uid: str, removed_by_uid: str | None = None):
        now_iso = _now_iso()
        new_owner_uid = str(removed_by_uid or '').strip()
        if not new_owner_uid:
            try:
                company = self._company_data(company_id)
                new_owner_uid = str(company.get('ownerUid') or '').strip()
            except Exception:
                new_owner_uid = ''
        new_owner_name = ''
        if new_owner_uid:
            try:
                new_owner_name = str(self._member_summary(company_id, new_owner_uid).get('displayName') or '').strip()
            except Exception:
                new_owner_name = ''
        if new_owner_uid and new_owner_uid != str(uid or '').strip():
            job_docs = list(self.jobs_col(company_id).where(filter=FieldFilter('createdByUid', '==', str(uid or '').strip())).stream())
            for doc in job_docs:
                try:
                    row = _to_dict(doc.to_dict() or {})
                    if bool(row.get('isDeleted', False)):
                        continue
                    patch = {
                        'createdByUid': new_owner_uid,
                        'updatedAt': firestore.SERVER_TIMESTAMP,
                        'updatedAtIso': now_iso,
                    }
                    if new_owner_name:
                        patch['createdByName'] = new_owner_name
                    doc.reference.set(patch, merge=True)
                except Exception:
                    continue
        membership_ref = self.memberships_col(company_id).document(uid)
        membership_ref.delete()
        company = self._company_data(company_id)
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': now_iso}, merge=True)
        self._add_notification(uid, 'Removed from company', f'You were removed from {company.get("name", "the company")}.', 'warning')

    def invite_staff(self, company_id: str, inviter_uid: str, email: str, role_id: str):
        email = (email or '').strip().lower()
        if not email:
            raise ValueError('Staff email is required.')
        role_id = (role_id or '').strip().lower()
        if role_id not in self.list_roles(company_id):
            raise ValueError('Invalid role.')
        company = self._company_data(company_id)
        inviter = self._user_snapshot(inviter_uid)

        invite_doc_id = f'{company_id}__{email}'
        payload = {
            'companyId': company_id,
            'companyName': company.get('name'),
            'email': email,
            'roleId': role_id,
            'invitedByUid': inviter_uid,
            'createdAt': firestore.SERVER_TIMESTAMP,
            'createdAtIso': _now_iso(),
            'updatedAtIso': _now_iso(),
        }

        user_docs = list(self.users_col().where(filter=FieldFilter('email', '==', email)).limit(1).stream())
        if user_docs:
            user_doc = user_docs[0]
            payload['targetUid'] = user_doc.id
            self._add_notification(user_doc.id, 'Company invite', f"{inviter.get('email')} invited you to {company.get('name')} as {role_id}.", 'invite', read=False)

        self.pending_invites_col().document(invite_doc_id).set(payload, merge=True)
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        self._add_notification(inviter_uid, 'Staff invited', f"Invite sent to {email}.", 'info', read=True)

    def add_job(self, company_id: str, name: str, client: str = "", notes: str = "", created_by_uid: str | None = None, created_by_name: str | None = None, client_phone: str = "", client_email: str = "", project_address: str = "", region: str = "", staff_member_uid: str | None = None, image_paths: list[str] | None = None):
        name = (name or '').strip()
        if not name:
            raise ValueError('Project name is required.')
        now_iso = _now_iso()
        company = self._company_data(company_id)
        creator_uid = (staff_member_uid or created_by_uid or '').strip() or company.get('ownerUid') or ''
        creator_name = (created_by_name or '').strip()
        if creator_uid and not creator_name:
            try:
                creator_name = self._member_summary(company_id, creator_uid).get('displayName') or ''
            except Exception:
                creator_name = ''
        status_rows = company.get('projectStatuses') or DEFAULT_PROJECT_STATUSES
        default_status = (status_rows[0].get('name') if isinstance(status_rows, list) and status_rows else 'New') or 'New'
        image_paths = [str(x).strip() for x in (image_paths or []) if str(x).strip()][:5]

        job_ref = self.jobs_col(company_id).document()
        job_id = f'job_{job_ref.id}'
        prepared_images = self._prepare_project_images(company_id, job_id, image_paths)
        job_ref.set({
            'id': job_id,
            'name': name,
            'client': client or '',
            'clientName': client or '',
            'clientNumber': client_phone or '',
            'clientPhone': client_phone or '',
            'clientEmail': client_email or '',
            'clientAddress': project_address or '',
            'region': region or '',
            'notes': notes or '',
            'status': default_status,
            'createdByUid': creator_uid,
            'createdByName': creator_name,
            'projectEditors': [],
            'projectImages': prepared_images,
            'isDeleted': False,
            'deletedAtIso': '',
            'deletedByUid': '',
            'deletedByName': '',
            'createdAt': firestore.SERVER_TIMESTAMP,
            'createdAtIso': now_iso,
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'updatedAtIso': now_iso,
            'cutlist': {'rows': []},
            'projectSettings': {
                'boardTypes': [],
                'projectPermissions': {},
            },
        })
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': now_iso}, merge=True)
        memberships = list(self.memberships_col(company_id).stream())
        for member in memberships:
            self._add_notification(
                member.id,
                'Project created',
                f"{name} was created by {creator_name or 'a staff member'}.",
                'project',
                read=(member.id == company.get('ownerUid')),
            )
        return job_id

    def upload_project_images(self, company_id: str, job_id: str, image_paths: list[str] | None = None) -> list[str]:
        docs = list(self.jobs_col(company_id).where(filter=FieldFilter('id', '==', job_id)).limit(1).stream())
        if not docs:
            raise ValueError('Project not found.')
        return self._prepare_project_images(company_id, job_id, image_paths)

    def list_jobs(self, company_id: str):
        docs = list(self.jobs_col(company_id).order_by('createdAt', direction=firestore.Query.DESCENDING).stream())
        rows = []
        for doc in docs:
            item = _to_dict(doc.to_dict() or {})
            if bool(item.get('isDeleted', False)):
                continue
            if not item.get('id'):
                item['id'] = f'job_{doc.id}'
            rows.append(item)
        return rows

    def list_deleted_jobs(self, company_id: str):
        docs = list(self.jobs_col(company_id).order_by('updatedAt', direction=firestore.Query.DESCENDING).stream())
        rows = []
        for doc in docs:
            item = _to_dict(doc.to_dict() or {})
            if not bool(item.get('isDeleted', False)):
                continue
            if not item.get('id'):
                item['id'] = f'job_{doc.id}'
            rows.append(item)
        return rows

    def update_job(self, company_id: str, job_id: str, patch: dict):
        docs = list(self.jobs_col(company_id).where(filter=FieldFilter('id', '==', job_id)).limit(1).stream())
        if not docs:
            raise ValueError('Project not found.')
        doc_ref = docs[0].reference
        payload = deepcopy(patch or {})
        # Keep Firestore documents bounded.
        cutlist = payload.get('cutlist')
        if isinstance(cutlist, dict):
            rows = cutlist.get('rows') or []
            if len(rows) > MAX_INLINE_CUTLIST_ROWS:
                raise ValueError('Cutlist is too large to save in a single Firestore document.')
        payload['updatedAt'] = firestore.SERVER_TIMESTAMP
        payload['updatedAtIso'] = _now_iso()
        doc_ref.set(payload, merge=True)
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)

    def update_job_status(self, company_id: str, job_id: str, new_status: str):
        self.update_job(company_id, job_id, {'status': new_status})

    def delete_job(self, company_id: str, job_id: str, deleted_by_uid: str = "", deleted_by_name: str = ""):
        docs = list(self.jobs_col(company_id).where(filter=FieldFilter('id', '==', job_id)).limit(1).stream())
        if not docs:
            raise ValueError('Project not found.')
        uid = str(deleted_by_uid or "").strip()
        name = str(deleted_by_name or "").strip()
        if uid and not name:
            try:
                name = str((self.get_user_profile(uid) or {}).get("displayName") or "").strip()
            except Exception:
                name = ""
        docs[0].reference.set(
            {
                'isDeleted': True,
                'deletedAtIso': _now_iso(),
                'deletedByUid': uid,
                'deletedByName': name,
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'updatedAtIso': _now_iso(),
            },
            merge=True,
        )
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)

    def restore_job(self, company_id: str, job_id: str):
        docs = list(self.jobs_col(company_id).where(filter=FieldFilter('id', '==', job_id)).limit(1).stream())
        if not docs:
            raise ValueError('Project not found.')
        docs[0].reference.set(
            {
                'isDeleted': False,
                'deletedAtIso': '',
                'deletedByUid': '',
                'deletedByName': '',
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'updatedAtIso': _now_iso(),
            },
            merge=True,
        )
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)

    def delete_job_permanently(self, company_id: str, job_id: str):
        docs = list(self.jobs_col(company_id).where(filter=FieldFilter('id', '==', job_id)).limit(1).stream())
        if not docs:
            raise ValueError('Project not found.')
        docs[0].reference.delete()
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)

    def purge_deleted_jobs(self, company_id: str, retention_days: int):
        try:
            keep_days = max(1, int(retention_days))
        except Exception:
            keep_days = 90
        cutoff = _now_utc() - timedelta(days=keep_days)
        docs = list(self.jobs_col(company_id).where(filter=FieldFilter('isDeleted', '==', True)).stream())
        purged = 0
        for doc in docs:
            data = _to_dict(doc.to_dict() or {})
            deleted_iso = str(data.get('deletedAtIso') or data.get('updatedAtIso') or '').strip()
            deleted_dt = _parse_iso_utc(deleted_iso)
            if deleted_dt is None:
                continue
            if deleted_dt <= cutoff:
                try:
                    doc.reference.delete()
                    purged += 1
                except Exception:
                    continue
        if purged > 0:
            self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)

    def update_company_theme(self, company_id: str, hex_color: str):
        self.update_company(company_id, {'themeColor': hex_color})

    def add_company_announcement(self, company_id: str, title: str, message: str):
        title = (title or '').strip()
        message = (message or '').strip()
        if not title or not message:
            raise ValueError('Title and message are required.')
        company = self._company_data(company_id)
        self.company_ref(company_id).collection('announcements').document().set({
            'title': title,
            'message': message,
            'createdAt': firestore.SERVER_TIMESTAMP,
            'createdAtIso': _now_iso(),
        })
        self.company_ref(company_id).set({'updatedAt': firestore.SERVER_TIMESTAMP, 'updatedAtIso': _now_iso()}, merge=True)
        for member in self.memberships_col(company_id).stream():
            self._add_notification(member.id, title, message, 'announcement', read=False)
    def get_user_notifications(self, uid: str):
        docs = list(self.notifications_col(uid).order_by('createdAt', direction=firestore.Query.DESCENDING).stream())
        return [_to_dict(doc.to_dict() or {}) for doc in docs]
    def replace_user_notifications(self, uid: str, notifications: list[dict]):
        try:
            docs = list(self.notifications_col(uid).stream())
            for doc in docs:
                doc.reference.delete()
        except Exception:
            pass
        for item in (notifications or []):
            title = str((item or {}).get("title") or "Notification")
            message = str((item or {}).get("message") or "")
            type_ = str((item or {}).get("type") or "info")
            read = bool((item or {}).get("read", False))
            self._add_notification(uid, title, message, type_, read=read)


class FirebaseAuthService:
    def __init__(self, client: FirebaseClient, company_service: FirebaseCompanyService):
        self.client = client
        self.company_service = company_service
        self.current_uid = None
        self.current_tokens: dict[str, str | None] = {'idToken': None, 'refreshToken': None}

    def register(self, email: str, password: str, mobile: str | None = None) -> str:
        email = (email or '').strip().lower()
        password = password or ''
        mobile = str(mobile or '').strip()
        if not email:
            raise ValueError('Email is required.')
        if not password:
            raise ValueError('Password is required.')
        if mobile:
            mobile_docs = list(self.company_service.users_col().where(filter=FieldFilter('mobile', '==', mobile)).limit(1).stream())
            if not mobile_docs:
                mobile_docs = list(self.company_service.users_col().where(filter=FieldFilter('phone', '==', mobile)).limit(1).stream())
            if mobile_docs:
                raise ValueError('This mobile number is already in use.')
        data = self.client.auth_post('signUp', {
            'email': email,
            'password': password,
            'returnSecureToken': True,
        })
        uid = data['localId']
        self.current_uid = uid
        self.current_tokens = {'idToken': data.get('idToken'), 'refreshToken': data.get('refreshToken')}
        self.company_service.ensure_user_profile(uid, email, mobile=mobile)
        return uid

    def login(self, email: str, password: str) -> str:
        email = (email or '').strip().lower()
        password = password or ''
        if not email:
            raise ValueError('Email is required.')
        if not password:
            raise ValueError('Password is required.')
        data = self.client.auth_post('signInWithPassword', {
            'email': email,
            'password': password,
            'returnSecureToken': True,
        })
        uid = data['localId']
        self.current_uid = uid
        self.current_tokens = {'idToken': data.get('idToken'), 'refreshToken': data.get('refreshToken')}
        self.company_service.ensure_user_profile(uid, email)
        return uid

    def logout(self):
        self.current_uid = None
        self.current_tokens = {'idToken': None, 'refreshToken': None}


class FirebaseRealtimeService:
    def __init__(self, company_service: FirebaseCompanyService):
        self.company_service = company_service
        self.listeners: dict[str, Watch] = {}

    def listen_company(self, company_id: str, callback: Callable):
        doc_ref = self.company_service.company_ref(company_id)

        def _on_snapshot(doc_snapshot, changes, read_time):
            if not doc_snapshot:
                callback({})
                return
            data = _to_dict(doc_snapshot[0].to_dict() or {})
            data['id'] = company_id
            # keep joinCode available for owner/admin settings display
            callback(data)

        watch = doc_ref.on_snapshot(_on_snapshot)
        token = uuid.uuid4().hex
        self.listeners[token] = watch
        return token

    def listen_jobs(self, company_id: str, callback: Callable):
        query = self.company_service.jobs_col(company_id).order_by('createdAt', direction=firestore.Query.DESCENDING)

        def _on_snapshot(col_snapshot, changes, read_time):
            items = []
            for doc in col_snapshot:
                item = _to_dict(doc.to_dict() or {})
                if not item.get('id'):
                    item['id'] = f'job_{doc.id}'
                items.append(item)
            callback(items)

        watch = query.on_snapshot(_on_snapshot)
        token = uuid.uuid4().hex
        self.listeners[token] = watch
        return token

    def listen_user_notifications(self, uid: str, callback: Callable):
        query = self.company_service.notifications_col(uid).order_by('createdAt', direction=firestore.Query.DESCENDING)

        def _on_snapshot(col_snapshot, changes, read_time):
            callback([_to_dict(doc.to_dict() or {}) for doc in col_snapshot])

        watch = query.on_snapshot(_on_snapshot)
        token = uuid.uuid4().hex
        self.listeners[token] = watch
        return token

    def unlisten(self, token: str):
        watch = self.listeners.pop(token, None)
        if watch:
            watch.unsubscribe()


def _auth_error_message(code: str) -> str:
    mapping = {
        'EMAIL_EXISTS': 'This email is already in use.',
        'OPERATION_NOT_ALLOWED': 'Email/password sign-in is not enabled in Firebase Auth.',
        'TOO_MANY_ATTEMPTS_TRY_LATER': 'Too many attempts. Please try again later.',
        'EMAIL_NOT_FOUND': 'Invalid Email or Password',
        'INVALID_PASSWORD': 'Invalid Email or Password',
        'USER_DISABLED': 'This account has been disabled.',
        'INVALID_LOGIN_CREDENTIALS': 'Invalid Email or Password',
        'WEAK_PASSWORD : Password should be at least 6 characters': 'Password should be at least 6 characters.',
    }
    return mapping.get(code, code.replace('_', ' ').capitalize())















