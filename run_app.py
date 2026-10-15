"""
Main Entrypoint to Launch the Forestry Web GIS & Red Book Matcher Application.
"""

import sys
import os

# Dynamically configure GDAL and PROJ data paths if running with QGIS / OSGeo4W or system Python
def configure_geo_environment():
    import glob
    candidates = []
    
    # 1. Check relative to sys.executable
    curr = os.path.dirname(sys.executable)
    for _ in range(4):
        p_proj = os.path.join(curr, "share", "proj")
        p_gdal = os.path.join(curr, "apps", "gdal", "share", "gdal")
        if os.path.isdir(p_proj):
            candidates.append((p_proj, p_gdal))
            break
        curr = os.path.dirname(curr)

    # 2. Check standard QGIS and OSGeo4W paths
    for p in glob.glob(r"C:\Program Files\QGIS *\share\proj"):
        qgis_root = os.path.dirname(os.path.dirname(p))
        candidates.append((p, os.path.join(qgis_root, "apps", "gdal", "share", "gdal")))

    for p in glob.glob(r"C:\OSGeo4W*\share\proj"):
        root = os.path.dirname(os.path.dirname(p))
        candidates.append((p, os.path.join(root, "apps", "gdal", "share", "gdal")))

    for proj_p, gdal_p in candidates:
        if os.path.isdir(proj_p):
            os.environ["PROJ_DATA"] = proj_p
            os.environ["PROJ_LIB"] = proj_p
            if os.path.isdir(gdal_p):
                os.environ["GDAL_DATA"] = gdal_p
            try:
                import pyproj
                pyproj.datadir.set_data_dir(proj_p)
            except Exception:
                pass
            break

configure_geo_environment()

import asyncio
import uvicorn

# Permanent fix for Windows asyncio WinError 64 (IocpProactor crash on socket reset)
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass
    try:
        import uvicorn.loops.asyncio
        uvicorn.loops.asyncio.asyncio_loop_factory = lambda *a, **kw: asyncio.SelectorEventLoop
    except Exception:
        pass
    try:
        import uvicorn.loops.auto
        uvicorn.loops.auto.auto_loop_factory = lambda *a, **kw: asyncio.SelectorEventLoop
    except Exception:
        pass

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    backend_path = os.path.join(os.path.dirname(__file__), "backend")
    sys.path.insert(0, backend_path)
    
    print("==================================================================")
    print(" [GIS] CENTRAL VIETNAM FORESTRY GIS & SBP/FM SYSTEM")
    print("       Quang Ngai - Binh Dinh - Phu Yen")
    print("==================================================================")
    print(" Server is starting at: http://127.0.0.1:8000")
    print(" Press Ctrl+C to stop.")
    print("==================================================================")

    while True:
        try:
            port = int(os.environ.get("PORT", 8000))
            host = os.environ.get("HOST", "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
            config = uvicorn.Config(
                "app:app",
                host=host,
                port=port,
                reload=False,
                loop=asyncio.SelectorEventLoop
            )
            server = uvicorn.Server(config)
            server.run()
            break
        except KeyboardInterrupt:
            print("\nServer stopped by user.")
            break
        except (ModuleNotFoundError, ImportError) as e:
            print(f"\n[LỖI THIẾU THƯ VIỆN] Không tìm thấy module: {e}")
            print("👉 Vui lòng nhấp đúp file 'Cai_Dat_Moi_Truong.bat' hoặc chạy lệnh sau để cài đặt:")
            print(f"   \"{sys.executable}\" -m pip install -r requirements.txt\n")
            break
        except OSError as e:
            if "10048" in str(e) or "address already in use" in str(e).lower():
                print(f"\n[LỖI XUNG ĐỘT CỔNG] Cổng {port} đang bị chiếm dụng bởi một tiến trình khác.")
                print(f"👉 Vui lòng đóng tiến trình đang chiếm cổng {port} hoặc đổi PORT trong biến môi trường.\n")
                break
            print(f"[RETRY] Server encountered OS error: {e}. Restarting in 2s...")
            import time
            time.sleep(2)
        except Exception as e:
            print(f"[RETRY] Server encountered error: {e}. Restarting in 2s...")
            import time
            time.sleep(2)
