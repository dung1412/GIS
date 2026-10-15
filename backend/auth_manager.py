"""
Authentication & User Management Module for Multi-User Web GIS.
Uses SQLite database (data/webgis.db) with PBKDF2-HMAC-SHA256 password hashing.
"""

import os
import sqlite3
import hashlib
import secrets
import datetime
from typing import Optional, Dict, Any, List

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DATA_DIR, "webgis.db")
os.makedirs(DATA_DIR, exist_ok=True)

class AuthManager:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _hash_password(self, password: str, salt: Optional[str] = None) -> tuple[str, str]:
        if not salt:
            salt = secrets.token_hex(16)
        key = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            100000
        )
        return key.hex(), salt

    def _verify_password(self, password: str, salt: str, password_hash: str) -> bool:
        key_hex, _ = self._hash_password(password, salt)
        return secrets.compare_digest(key_hex, password_hash)

    def _init_db(self):
        with self._get_connection() as conn:
            cur = conn.cursor()
            
            # 1. Users table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT DEFAULT 'member',
                    department TEXT DEFAULT 'Phòng Bền Vững',
                    avatar_color TEXT DEFAULT '#10b981',
                    created_at TEXT NOT NULL
                )
            """)

            # 2. User sessions table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)

            # 3. User maps (workspaces) table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_maps (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    province TEXT DEFAULT 'Quảng Ngãi',
                    center_lon REAL DEFAULT 108.68,
                    center_lat REAL DEFAULT 15.02,
                    zoom_level REAL DEFAULT 11.0,
                    basemap TEXT DEFAULT 'google-hybrid',
                    is_public INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)

            # 4. User private layers table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_layers (
                    id TEXT PRIMARY KEY,
                    map_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    source_type TEXT DEFAULT 'Bản đồ cá nhân',
                    province TEXT DEFAULT 'Quảng Ngãi',
                    geojson_path TEXT NOT NULL,
                    feature_count INTEGER DEFAULT 0,
                    total_area_ha REAL DEFAULT 0.0,
                    opacity REAL DEFAULT 0.8,
                    visible INTEGER DEFAULT 1,
                    label_config TEXT DEFAULT '{}',
                    palette_color TEXT DEFAULT '#10b981',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(map_id) REFERENCES user_maps(id) ON DELETE CASCADE,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)

            conn.commit()

        # Demo users are a deliberate local-only development option.
        if (
            os.getenv("WEBGIS_ENABLE_DEMO_ACCOUNTS", "0") == "1"
            and os.getenv("WEBGIS_REQUIRE_AUTH", "0") != "1"
            and os.getenv("ENVIRONMENT", "local").lower() not in {"production", "prod"}
        ):
            self._ensure_demo_accounts()

    def _ensure_demo_accounts(self):
        demo_users = [
            {
                "username": "admin",
                "email": "admin@phutaibioenergy.vn",
                "password": "admin123",
                "full_name": "Quản Trị Viên Phú Tài",
                "role": "admin",
                "department": "Ban Giám Đốc / PT Bền Vững",
                "avatar_color": "#0ea5e9"
            },
            {
                "username": "canbokhaosat",
                "email": "khaosat@phutaibioenergy.vn",
                "password": "123456",
                "full_name": "Nguyễn Văn Hùng (Cán bộ thực địa)",
                "role": "member",
                "department": "Đội Khảo Sát Rừng Ba Tơ",
                "avatar_color": "#10b981"
            }
        ]

        for u in demo_users:
            if not self.get_user_by_username(u["username"]):
                self.register_user(
                    username=u["username"],
                    email=u["email"],
                    password=u["password"],
                    full_name=u["full_name"],
                    role=u["role"],
                    department=u["department"],
                    avatar_color=u["avatar_color"]
                )

    def register_user(self, username: str, email: str, password: str, full_name: str,
                      role: str = "member", department: str = "Phòng Bền Vững",
                      avatar_color: Optional[str] = None) -> tuple[Optional[Dict[str, Any]], str]:
        username = username.strip().lower()
        email = email.strip().lower()

        if len(username) < 3:
            return None, "Tên đăng nhập phải có ít nhất 3 ký tự"
        if len(password) < 4:
            return None, "Mật khẩu phải có ít nhất 4 ký tự"

        colors = ["#10b981", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"]
        chosen_color = avatar_color or secrets.choice(colors)

        pwd_hash, salt = self._hash_password(password)
        user_id = f"usr_{secrets.token_hex(6)}"
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        with self._get_connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute("""
                    INSERT INTO users (id, username, email, password_hash, salt, full_name, role, department, avatar_color, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (user_id, username, email, pwd_hash, salt, full_name, role, department, chosen_color, now_str))

                # Automatically create a default personal map workspace for this user
                default_map_id = f"map_{secrets.token_hex(6)}"
                cur.execute("""
                    INSERT INTO user_maps (id, user_id, name, description, province, center_lon, center_lat, zoom_level, basemap, is_public, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (default_map_id, user_id, f"Bản đồ làm việc của {full_name}", "Không gian bản đồ cá nhân mặc định", "Quảng Ngãi", 108.68, 15.02, 11.0, "google-hybrid", 0, now_str, now_str))

                conn.commit()
            except sqlite3.IntegrityError as e:
                if "username" in str(e).lower():
                    return None, "Tên đăng nhập đã được sử dụng"
                if "email" in str(e).lower():
                    return None, "Địa chỉ email đã được đăng ký"
                return None, f"Lỗi tạo tài khoản: {str(e)}"

        return self.get_user_by_id(user_id), "Đăng ký thành công"

    def login_user(self, username_or_email: str, password: str) -> tuple[Optional[Dict[str, Any]], Optional[str], str]:
        user_key = username_or_email.strip().lower()
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?
            """, (user_key, user_key))
            row = cur.fetchone()

        if not row:
            return None, None, "Tài khoản hoặc email không tồn tại"

        if not self._verify_password(password, row["salt"], row["password_hash"]):
            return None, None, "Mật khẩu không chính xác"

        # Generate session token valid for 30 days
        token = secrets.token_urlsafe(32)
        now = datetime.datetime.now()
        expires = now + datetime.timedelta(days=30)

        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO sessions (token, user_id, created_at, expires_at)
                VALUES (?, ?, ?, ?)
            """, (token, row["id"], now.strftime("%Y-%m-%d %H:%M:%S"), expires.strftime("%Y-%m-%d %H:%M:%S")))
            conn.commit()

        user_dict = {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "full_name": row["full_name"],
            "role": row["role"],
            "department": row["department"],
            "avatar_color": row["avatar_color"],
            "created_at": row["created_at"]
        }
        return user_dict, token, "Đăng nhập thành công"

    def get_user_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        if not token:
            return None
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT u.* FROM users u
                JOIN sessions s ON u.id = s.user_id
                WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
            """, (token,))
            row = cur.fetchone()

        if not row:
            return None

        return {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "full_name": row["full_name"],
            "role": row["role"],
            "department": row["department"],
            "avatar_color": row["avatar_color"],
            "created_at": row["created_at"]
        }

    def logout_token(self, token: str) -> bool:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
            return cur.rowcount > 0

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "full_name": row["full_name"],
            "role": row["role"],
            "department": row["department"],
            "avatar_color": row["avatar_color"],
            "created_at": row["created_at"]
        }

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM users WHERE lower(username) = ?", (username.strip().lower(),))
            row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "full_name": row["full_name"],
            "role": row["role"],
            "department": row["department"],
            "avatar_color": row["avatar_color"],
            "created_at": row["created_at"]
        }

auth_manager = AuthManager()
