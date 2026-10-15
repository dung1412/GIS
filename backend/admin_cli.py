"""Create a real administrator without putting a password in command history.

Run on the application host: python -m backend.admin_cli
"""

import getpass
import os
import sys


def main() -> int:
    # Provisioning must never seed the optional local demonstration accounts.
    os.environ["WEBGIS_ENABLE_DEMO_ACCOUNTS"] = "0"
    from .auth_manager import auth_manager

    username = input("Tên đăng nhập quản trị: ").strip()
    email = input("Email quản trị: ").strip()
    full_name = input("Họ tên quản trị: ").strip()
    password = getpass.getpass("Mật khẩu (ít nhất 12 ký tự): ")
    confirmation = getpass.getpass("Nhập lại mật khẩu: ")
    if len(password) < 12:
        print("Mật khẩu phải có ít nhất 12 ký tự.", file=sys.stderr)
        return 1
    if password != confirmation:
        print("Hai mật khẩu không khớp.", file=sys.stderr)
        return 1
    if not username or not email or not full_name:
        print("Cần nhập đầy đủ tên đăng nhập, email và họ tên.", file=sys.stderr)
        return 1
    if auth_manager.get_user_by_username(username):
        print("Tên đăng nhập đã tồn tại; không thay đổi tài khoản hiện có.", file=sys.stderr)
        return 1
    user, message = auth_manager.register_user(
        username=username, email=email, password=password,
        full_name=full_name, role="admin",
    )
    if not user:
        print(message, file=sys.stderr)
        return 1
    print("Đã tạo tài khoản quản trị. Đăng nhập bằng thông tin vừa nhập.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
