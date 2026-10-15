@echo off
chcp 65001 >nul
title KHỞI ĐỘNG HỆ THỐNG WEBGIS LÂM NGHIỆP PHÚ TÀI
color 0A

echo ======================================================================
echo    🌲 HỆ THỐNG WEBGIS QUẢN LÝ RỪNG TRỒNG & NGUYÊN LIỆU PHÚ TÀI BIOENERGY
echo ======================================================================
echo.

cd /d "%~dp0"

set "PYTHON_EXE=C:\Program Files\QGIS 3.44.12\apps\Python312\python.exe"

if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=C:\Users\ESG1-PBE\AppData\Local\Programs\Python\Python310\python.exe"
)

if not exist "%PYTHON_EXE%" (
    where python.exe >nul 2>&1
    if %errorlevel% equ 0 (
        set "PYTHON_EXE=python.exe"
    ) else (
        echo [X] LỖI: Không tìm thấy Python trên máy tính!
        echo Vui lòng liên hệ quản trị viên để kiểm tra đường dẫn Python.
        pause
        exit /b 1
    )
)

echo [*] Đang sử dụng Python: "%PYTHON_EXE%"
echo [*] Khởi động máy chủ WebGIS tại: http://localhost:8000
echo.
echo ======================================================================
echo  👉 TÀI KHOẢN ĐĂNG NHẬP SẴN CÓ:
echo     - Quản trị viên: admin / admin123
echo     - Cán bộ thực địa: canbokhaosat / 123456
echo ======================================================================
echo.

echo [*] Đang khởi động máy chủ WebGIS... Vui lòng đợi trong giây lát.
echo.

REM Tự động thăm dò máy chủ đến khi sẵn sàng mới mở trình duyệt (tránh lỗi Connection Refused)
start "" /b cmd /c "for /l %%i in (1,1,25) do (curl -s http://127.0.0.1:8000/api/health >nul 2>&1 && (start http://127.0.0.1:8000 & exit) || ping 127.0.0.1 -n 2 >nul)"

REM Khởi chạy Web Server FastAPI với bản vá Windows Selector Event Loop và nạp GDAL/PROJ tự động
"%PYTHON_EXE%" run_app.py

if %ERRORLEVEL% neq 0 (
    echo [!] Thu khoi chay fallback qua backend/app.py...
    "%PYTHON_EXE%" backend/app.py
)

pause
