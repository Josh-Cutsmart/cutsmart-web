
from __future__ import annotations

import hashlib
import json
import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Callable


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _parse_iso_utc(value: str) -> datetime | None:
    text = str(value or '').strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
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


class LocalStore:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / 'data.json'
        self.lock = RLock()
        if not self.path.exists():
            self._write(self._empty())

    def _empty(self) -> dict:
        return {
            'users': {},
            'companies': {},
            'memberships': {},
            'notifications': {},
        }

    def _read(self) -> dict:
        if not self.path.exists():
            return self._empty()
        return json.loads(self.path.read_text(encoding='utf-8'))

    def _write(self, data: dict) -> None:
        self.path.write_text(json.dumps(data, indent=2), encoding='utf-8')

    def read(self) -> dict:
        with self.lock:
            return self._read()

    def update(self, fn: Callable[[dict], None | dict]):
        with self.lock:
            data = self._read()
            result = fn(data)
            if isinstance(result, dict):
                data = result
            self._write(data)
            return data


class LocalSessionService:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / 'session.json'

    def load_session(self):
        if not self.path.exists():
            return None
        try:
            return json.loads(self.path.read_text(encoding='utf-8'))
        except Exception:
            return None

    def save_session(self, uid: str, email: str, remember_me: bool, company_id: str | None = None):
        payload = {
            'uid': uid,
            'email': email,
            'remember_me': bool(remember_me),
            'company_id': company_id,
        }
        self.path.write_text(json.dumps(payload, indent=2), encoding='utf-8')

    def clear_session(self):
        if self.path.exists():
            self.path.unlink()


class LocalCompanyService:
    def __init__(self, data_dir: Path):
        self.store = LocalStore(data_dir)
        self.roles = ['owner', 'admin', 'staff']

    def _normalize_role_id(self, role_id: str | None) -> str:
        role = (role_id or 'staff').strip().lower()
        if role == 'manager':
            role = 'admin'
        if role not in self.roles:
            role = 'staff'
        return role

    # helpers
    def _hash(self, password: str) -> str:
        return hashlib.sha256(password.encode('utf-8')).hexdigest()

    def _company(self, data: dict, company_id: str) -> dict:
        company = data['companies'].get(company_id)
        if not company:
            raise ValueError('Company not found.')
        return company

    def _user(self, data: dict, uid: str) -> dict:
        user = data['users'].get(uid)
        if not user:
            raise ValueError('User not found.')
        return user

    def _add_notification(self, data: dict, uid: str, title: str, message: str, type_: str = 'info', read: bool = False):
        data['notifications'].setdefault(uid, [])
        data['notifications'][uid].insert(0, {
            'id': uuid.uuid4().hex,
            'title': title,
            'message': message,
            'type': type_,
            'read': read,
            'createdAt': _now_iso(),
        })

    def _member_summary(self, data: dict, uid: str, company_id: str):
        user = self._user(data, uid)
        role = self._normalize_role_id(data['memberships'].get(company_id, {}).get(uid, 'staff'))
        return {
            'uid': uid,
            'email': user['email'],
            'displayName': user.get('displayName') or user['email'].split('@')[0],
            'mobile': str(user.get('mobile') or user.get('phone') or '').strip(),
            'avatarPath': str(user.get('avatarPath') or '').strip(),
            'badgeColor': str(user.get('badgeColor') or '#7D99B3').strip(),
            'roleId': role,
        }

    def register_user(self, email: str, password: str, mobile: str | None = None) -> str:
        email = email.strip().lower()
        if not email:
            raise ValueError('Email is required.')
        if not password:
            raise ValueError('Password is required.')
        mobile_value = str(mobile or '').strip()

        def action(data: dict):
            if any(u['email'] == email for u in data['users'].values()):
                raise ValueError('An account with that email already exists.')
            if mobile_value and any(str(u.get('mobile') or u.get('phone') or '').strip() == mobile_value for u in data['users'].values()):
                raise ValueError('This mobile number is already in use.')
            uid = uuid.uuid4().hex[:12]
            data['users'][uid] = {
                'uid': uid,
                'email': email,
                'passwordHash': self._hash(password),
                'displayName': email.split('@')[0],
                'mobile': mobile_value,
                'createdAt': _now_iso(),
            }
            return uid

        result = {'uid': None}
        def wrapper(data):
            result['uid'] = action(data)
        self.store.update(wrapper)
        return result['uid']

    def login_user(self, email: str, password: str) -> str:
        data = self.store.read()
        email_norm = email.strip().lower()
        pw = self._hash(password)
        user_by_email = None
        for uid, user in data['users'].items():
            if user['email'] == email_norm:
                user_by_email = (uid, user)
                break
        if not user_by_email:
            raise ValueError('Invalid Email or Password')
        uid, user = user_by_email
        if user.get('passwordHash') != pw:
            raise ValueError('Invalid Email or Password')
        return uid

    def get_user_profile(self, uid: str) -> dict:
        data = self.store.read()
        user = self._user(data, uid)
        email = str(user.get('email') or '').strip().lower()
        return {
            'uid': uid,
            'email': email,
            'displayName': str(user.get('displayName') or email.split('@')[0]).strip(),
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
        if display_name is not None and not str(display_name).strip():
            raise ValueError('Display name is required.')

        def action(data: dict):
            user = self._user(data, uid)
            if display_name is not None:
                user['displayName'] = str(display_name).strip()
            if mobile is not None:
                user['mobile'] = str(mobile or '').strip()
            if avatar_path is not None:
                user['avatarPath'] = str(avatar_path or '').strip()
            if badge_color is not None:
                user['badgeColor'] = str(badge_color or '').strip()
            if ui_theme is not None:
                user['uiTheme'] = str(ui_theme or 'light').strip().lower()
            user['updatedAt'] = _now_iso()

        self.store.update(action)

    def create_company(self, uid: str, name: str, join_code: str) -> str:
        name = (name or '').strip()
        join_code = (join_code or '').strip()
        if not name:
            raise ValueError('Company name is required.')
        if not join_code:
            raise ValueError('Company code / password is required.')
        company_id = f"cmp_{_slug(name)}_{uuid.uuid4().hex[:6]}"

        def action(data: dict):
            self._user(data, uid)
            data['companies'][company_id] = {
                'id': company_id,
                'name': name,
                'joinCode': join_code,
                'planTier': 'free',
                'themeColor': '#2F6BFF',
                'timeZone': 'Pacific/Auckland',
                'deletedRetentionDays': 90,
                'ownerUid': uid,
                'jobs': [],
                'announcements': [],
                'createdAt': _now_iso(),
                'updatedAt': _now_iso(),
            }
            data['memberships'].setdefault(company_id, {})[uid] = 'owner'
            self._add_notification(data, uid, 'Company created', f'{name} was created successfully.', 'success', read=True)
        self.store.update(action)
        return company_id

    def join_company(self, uid: str, join_code: str) -> str:
        join_code = (join_code or '').strip()
        if not join_code:
            raise ValueError('Company code / password is required.')
        result = {'company_id': None}
        def action(data: dict):
            self._user(data, uid)
            for company_id, company in data['companies'].items():
                if company.get('joinCode') == join_code:
                    data['memberships'].setdefault(company_id, {})[uid] = data['memberships'].get(company_id, {}).get(uid, 'staff')
                    data['memberships'][company_id][uid] = self._normalize_role_id(data['memberships'][company_id][uid])
                    result['company_id'] = company_id
                    self._add_notification(data, uid, 'Joined company', f"You joined {company['name']}.", 'success', read=True)
                    return
            raise ValueError('Company code not found.')
        self.store.update(action)
        return result['company_id']

    def get_user_company_id(self, uid: str):
        data = self.store.read()
        for company_id, members in data['memberships'].items():
            if uid in members:
                return company_id
        return None

    def get_company(self, company_id: str):
        data = self.store.read()
        company = self._company(data, company_id)
        return deepcopy(company)

    def list_staff(self, company_id: str):
        data = self.store.read()
        members = data['memberships'].get(company_id, {})
        return [self._member_summary(data, uid, company_id) for uid in members]

    def list_roles(self, company_id: str):
        return list(self.roles)

    def update_member_role(self, company_id: str, uid: str, role_id: str):
        role_id = self._normalize_role_id(role_id)
        if role_id not in self.roles:
            raise ValueError('Invalid role.')
        def action(data: dict):
            company = self._company(data, company_id)
            if uid not in data['memberships'].get(company_id, {}):
                raise ValueError('Member not found.')
            data['memberships'][company_id][uid] = role_id
            company['updatedAt'] = _now_iso()
            role_name = str(role_id or 'staff').replace('_', ' ').title()
            self._add_notification(data, uid, 'Role Changed', f'Your role in {company["name"]} was changed to {role_name}.', 'role_changed')
        self.store.update(action)

    def update_member_display_name(self, company_id: str, uid: str, display_name: str):
        name = str(display_name or '').strip()
        if not name:
            raise ValueError('Display name is required.')

        def action(data: dict):
            company = self._company(data, company_id)
            if uid not in data['memberships'].get(company_id, {}):
                raise ValueError('Member not found.')
            user = self._user(data, uid)
            old_name = str(user.get('displayName') or '').strip()
            user['displayName'] = name
            user['updatedAt'] = _now_iso()
            for job in company.get('jobs', []):
                creator_uid = str(job.get('createdByUid') or '').strip()
                creator_name = str(job.get('createdByName') or '').strip()
                if creator_uid and creator_uid == uid:
                    job['createdByName'] = name
                elif not creator_uid and old_name and creator_name == old_name:
                    job['createdByName'] = name
                if ('createdByName' in job) and (job.get('createdByName') == name):
                    job['updatedAt'] = _now_iso()
            company['updatedAt'] = _now_iso()
            self._add_notification(data, uid, 'Profile Updated', f'Your display name in {company["name"]} was updated.', 'info')

        self.store.update(action)

    def update_member_mobile(self, company_id: str, uid: str, mobile: str):
        value = str(mobile or '').strip()

        def action(data: dict):
            company = self._company(data, company_id)
            if uid not in data['memberships'].get(company_id, {}):
                raise ValueError('Member not found.')
            user = self._user(data, uid)
            user['mobile'] = value
            user['updatedAt'] = _now_iso()
            company['updatedAt'] = _now_iso()
            self._add_notification(data, uid, 'Profile Updated', f"Your mobile number in {company['name']} was updated.", 'info')

        self.store.update(action)

    def remove_member(self, company_id: str, uid: str, removed_by_uid: str | None = None):
        def action(data: dict):
            company = self._company(data, company_id)
            remove_uid = str(uid or '').strip()
            new_owner_uid = str(removed_by_uid or '').strip()
            if not new_owner_uid:
                new_owner_uid = str(company.get('ownerUid') or '').strip()
            new_owner_name = ""
            if new_owner_uid:
                try:
                    owner_user = self._user(data, new_owner_uid)
                    new_owner_name = str(owner_user.get('displayName') or owner_user.get('email') or '').strip()
                except Exception:
                    new_owner_name = ""
            if new_owner_uid and new_owner_uid != remove_uid:
                for job in (company.get('jobs', []) or []):
                    if not isinstance(job, dict):
                        continue
                    if bool(job.get('isDeleted', False)):
                        continue
                    creator_uid = str(job.get('createdByUid') or '').strip()
                    if creator_uid != remove_uid:
                        continue
                    job['createdByUid'] = new_owner_uid
                    if new_owner_name:
                        job['createdByName'] = new_owner_name
                    job['updatedAt'] = _now_iso()
            data['memberships'].setdefault(company_id, {}).pop(uid, None)
            company['updatedAt'] = _now_iso()
            self._add_notification(data, uid, 'Removed from company', f'You were removed from {company["name"]}.', 'warning')
        self.store.update(action)

    def invite_staff(self, company_id: str, inviter_uid: str, email: str, role_id: str):
        email = email.strip().lower()
        if not email:
            raise ValueError('Staff email is required.')
        role_id = self._normalize_role_id(role_id)
        if role_id not in self.roles:
            raise ValueError('Invalid role.')
        invited_uid = {'uid': None}
        def action(data: dict):
            company = self._company(data, company_id)
            inviter = self._user(data, inviter_uid)
            for uid, user in data['users'].items():
                if user['email'] == email:
                    invited_uid['uid'] = uid
                    break
            if invited_uid['uid'] is None:
                uid = uuid.uuid4().hex[:12]
                data['users'][uid] = {
                    'uid': uid,
                    'email': email,
                    'passwordHash': self._hash('password'),
                    'displayName': email.split('@')[0],
                    'createdAt': _now_iso(),
                }
                invited_uid['uid'] = uid
            data['memberships'].setdefault(company_id, {})[invited_uid['uid']] = role_id
            company['updatedAt'] = _now_iso()
            self._add_notification(data, invited_uid['uid'], 'Company invite', f"{inviter['email']} added you to {company['name']} as {role_id}.", 'invite')
        self.store.update(action)

    def add_job(self, company_id: str, name: str, client: str = "", notes: str = "", image_paths: list[str] | None = None):
        name = (name or '').strip()
        if not name:
            raise ValueError('Project name is required.')
        image_paths = [str(x).strip() for x in (image_paths or []) if str(x).strip()][:5]
        result = {'job_id': None}
        def action(data: dict):
            company = self._company(data, company_id)
            now = _now_iso()
            job_id = f'job_{uuid.uuid4().hex[:10]}'
            result['job_id'] = job_id
            company['jobs'].insert(0, {
                'id': job_id,
                'name': name,
                'client': client or '',
                'clientName': client or '',
                'clientNumber': '',
                'clientAddress': '',
                'notes': notes or '',
                'status': 'New',
                'projectImages': image_paths,
                'isDeleted': False,
                'deletedAt': '',
                'deletedAtIso': '',
                'createdAt': now,
                'updatedAt': now,
            })
            company['updatedAt'] = now
            for uid in data['memberships'].get(company_id, {}):
                self._add_notification(data, uid, 'Project created', f'{name} was added to the project list.', 'project', read=(uid==company.get('ownerUid')))
        self.store.update(action)
        return result['job_id']

    def upload_project_images(self, company_id: str, job_id: str, image_paths: list[str] | None = None) -> list[str]:
        # Local backend keeps file paths as-is.
        return [str(x).strip() for x in (image_paths or []) if str(x).strip()][:5]

    def list_jobs(self, company_id: str):
        data = self.store.read()
        company = self._company(data, company_id)
        rows = []
        for job in (company.get('jobs', []) or []):
            if bool((job or {}).get('isDeleted', False)):
                continue
            rows.append(deepcopy(job))
        return rows

    def list_deleted_jobs(self, company_id: str):
        data = self.store.read()
        company = self._company(data, company_id)
        rows = []
        for job in (company.get('jobs', []) or []):
            if not bool((job or {}).get('isDeleted', False)):
                continue
            rows.append(deepcopy(job))
        rows.sort(key=lambda r: str((r or {}).get('deletedAtIso') or (r or {}).get('updatedAt') or ''), reverse=True)
        return rows

    def update_job(self, company_id: str, job_id: str, patch: dict):
        def action(data: dict):
            company = self._company(data, company_id)
            now = _now_iso()
            for job in company.get('jobs', []):
                if (job.get('id') or job.get('jobId') or job.get('uid')) == job_id:
                    job.update(deepcopy(patch))
                    job['updatedAt'] = now
                    company['updatedAt'] = now
                    return
            raise ValueError('Project not found.')
        self.store.update(action)

    def update_job_status(self, company_id: str, job_id: str, new_status: str):
        self.update_job(company_id, job_id, {'status': new_status})

    def delete_job(self, company_id: str, job_id: str, deleted_by_uid: str = "", deleted_by_name: str = ""):
        def action(data: dict):
            company = self._company(data, company_id)
            jobs = company.get('jobs', [])
            for idx, job in enumerate(jobs):
                if (job.get('id') or job.get('jobId') or job.get('uid')) == job_id:
                    now = _now_iso()
                    job['isDeleted'] = True
                    job['deletedAt'] = now
                    job['deletedAtIso'] = now
                    job['deletedByUid'] = str(deleted_by_uid or '').strip()
                    job['deletedByName'] = str(deleted_by_name or '').strip()
                    job['updatedAt'] = now
                    company['updatedAt'] = now
                    return
            raise ValueError('Project not found.')
        self.store.update(action)

    def restore_job(self, company_id: str, job_id: str):
        def action(data: dict):
            company = self._company(data, company_id)
            now = _now_iso()
            for job in company.get('jobs', []):
                if (job.get('id') or job.get('jobId') or job.get('uid')) == job_id:
                    if not bool((job or {}).get('isDeleted', False)):
                        return
                    job['isDeleted'] = False
                    job['deletedAt'] = ''
                    job['deletedAtIso'] = ''
                    job['updatedAt'] = now
                    company['updatedAt'] = now
                    return
            raise ValueError('Project not found.')
        self.store.update(action)

    def delete_job_permanently(self, company_id: str, job_id: str):
        def action(data: dict):
            company = self._company(data, company_id)
            jobs = company.get('jobs', [])
            for idx, job in enumerate(jobs):
                if (job.get('id') or job.get('jobId') or job.get('uid')) == job_id:
                    del jobs[idx]
                    company['updatedAt'] = _now_iso()
                    return
            raise ValueError('Project not found.')
        self.store.update(action)

    def purge_deleted_jobs(self, company_id: str, retention_days: int):
        try:
            keep_days = max(1, int(retention_days))
        except Exception:
            keep_days = 90
        cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)

        def action(data: dict):
            company = self._company(data, company_id)
            jobs = company.get('jobs', []) or []
            keep_rows = []
            changed = False
            for job in jobs:
                if not bool((job or {}).get('isDeleted', False)):
                    keep_rows.append(job)
                    continue
                deleted_iso = str((job or {}).get('deletedAtIso') or (job or {}).get('updatedAt') or '')
                deleted_dt = _parse_iso_utc(deleted_iso)
                if deleted_dt is None:
                    keep_rows.append(job)
                    continue
                if deleted_dt <= cutoff:
                    changed = True
                    continue
                keep_rows.append(job)
            if changed:
                company['jobs'] = keep_rows
                company['updatedAt'] = _now_iso()

        self.store.update(action)

    def update_company_theme(self, company_id: str, hex_color: str):
        def action(data: dict):
            company = self._company(data, company_id)
            company['themeColor'] = hex_color
            company['updatedAt'] = _now_iso()
        self.store.update(action)

    def update_company_logo(self, company_id: str, logo_path: str) -> str:
        path = str(logo_path or '').strip()
        self.update_company(company_id, {'logoPath': path})
        return path

    def add_company_announcement(self, company_id: str, title: str, message: str):
        title = title.strip()
        message = message.strip()
        if not title or not message:
            raise ValueError('Title and message are required.')
        def action(data: dict):
            company = self._company(data, company_id)
            company.setdefault('announcements', []).insert(0, {
                'id': uuid.uuid4().hex,
                'title': title,
                'message': message,
                'createdAt': _now_iso(),
            })
            company['updatedAt'] = _now_iso()
            for uid in data['memberships'].get(company_id, {}):
                self._add_notification(data, uid, title, message, 'announcement', read=False)
        self.store.update(action)
    def get_user_notifications(self, uid: str):
        data = self.store.read()
        return deepcopy(data.get('notifications', {}).get(uid, []))
    def replace_user_notifications(self, uid: str, notifications: list[dict]):
        def action(data: dict):
            data.setdefault("notifications", {})[uid] = [dict(item or {}) for item in (notifications or [])]
        self.store.update(action)


class LocalAuthService:
    def __init__(self, company_service: LocalCompanyService):
        self.company_service = company_service
        self.current_uid = None

    def register(self, email: str, password: str, mobile: str | None = None) -> str:
        uid = self.company_service.register_user(email, password, mobile=mobile)
        self.current_uid = uid
        return uid

    def login(self, email: str, password: str) -> str:
        uid = self.company_service.login_user(email, password)
        self.current_uid = uid
        return uid

    def logout(self):
        self.current_uid = None


class LocalRealtimeService:
    def __init__(self, company_service: LocalCompanyService):
        self.company_service = company_service
        self.listeners: dict[str, tuple[str, str, Callable]] = {}

    def _register(self, kind: str, key: str, callback: Callable):
        token = uuid.uuid4().hex
        self.listeners[token] = (kind, key, callback)
        self._emit_token(token)
        return token

    def _emit_token(self, token: str):
        kind, key, callback = self.listeners[token]
        if kind == 'company':
            callback(self.company_service.get_company(key))
        elif kind == 'jobs':
            callback(self.company_service.list_jobs(key))
        elif kind == 'notifications':
            callback(self.company_service.get_user_notifications(key))

    def _emit(self, kind: str, key: str):
        for token, listener in list(self.listeners.items()):
            lk, lkey, _ = listener
            if lk == kind and lkey == key:
                self._emit_token(token)

    def listen_company(self, company_id: str, callback: Callable):
        return self._register('company', company_id, callback)

    def listen_jobs(self, company_id: str, callback: Callable):
        return self._register('jobs', company_id, callback)

    def listen_user_notifications(self, uid: str, callback: Callable):
        return self._register('notifications', uid, callback)

    def unlisten(self, token: str):
        self.listeners.pop(token, None)


# Wire automatic realtime refreshes into company mutations
_original_init = LocalRealtimeService.__init__

def _patched_company_service_methods():
    mutating = {
        'create_company': lambda self, args, result: [('company', result), ('jobs', result)],
        'join_company': lambda self, args, result: [('company', result), ('jobs', result), ('notifications', args[0])],
        'update_member_role': lambda self, args, result: [('company', args[0]), ('notifications', args[1])],
        'remove_member': lambda self, args, result: [('company', args[0]), ('notifications', args[1])],
        'invite_staff': lambda self, args, result: [('company', args[0])],
        'add_job': lambda self, args, result: [('company', args[0]), ('jobs', args[0])],
        'update_job': lambda self, args, result: [('company', args[0]), ('jobs', args[0])],
        'update_job_status': lambda self, args, result: [('company', args[0]), ('jobs', args[0])],
        'delete_job': lambda self, args, result: [('company', args[0]), ('jobs', args[0])],
        'delete_job_permanently': lambda self, args, result: [('company', args[0]), ('jobs', args[0])],
        'restore_job': lambda self, args, result: [('company', args[0]), ('jobs', args[0])],
        'purge_deleted_jobs': lambda self, args, result: [('company', args[0]), ('jobs', args[0])],
        'update_company_theme': lambda self, args, result: [('company', args[0])],
        'add_company_announcement': lambda self, args, result: [('company', args[0])],
    }
    for name, notifier in mutating.items():
        original = getattr(LocalCompanyService, name)
        def make_wrapper(method_name, method, notifier):
            def wrapper(self, *args, **kwargs):
                result = method(self, *args, **kwargs)
                realtime = getattr(self, '_realtime', None)
                if realtime:
                    touched = notifier(self, args, result)
                    for kind, key in touched:
                        if key:
                            realtime._emit(kind, key)
                    data = self.store.read()
                    company_id = None
                    if args:
                        company_id = args[0] if isinstance(args[0], str) and args[0].startswith('cmp_') else None
                    if company_id:
                        for uid in data.get('memberships', {}).get(company_id, {}):
                            realtime._emit('notifications', uid)
                return result
            return wrapper
        setattr(LocalCompanyService, name, make_wrapper(name, original, notifier))

_patched_company_service_methods()

_orig_rt_init = LocalRealtimeService.__init__
def _rt_init(self, company_service):
    _orig_rt_init(self, company_service)
    company_service._realtime = self
LocalRealtimeService.__init__ = _rt_init





