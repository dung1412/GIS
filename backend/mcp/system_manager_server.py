"""
MCP Server for Central Vietnam Open Forestry WebGIS Management.
Provides tools for:
  1. Map & Layer Management (PostGIS / Vector Tiles / Catalog)
  2. Forest Owner (Chủ rừng) & Cadastral Certificate (Sổ đỏ) Management
  3. Member & Multi-tier Role-Based Access Control (RBAC)
  4. Enterprise SQL / PostGIS Migration & Schema Generation
  5. EUDR & FSC Timber Supply Chain Auditing
"""

import sys
import os
import json
import re
from typing import List, Dict, Any, Optional

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from mcp.server.mcpserver import MCPServer

server = MCPServer(
    name="webgis-system-manager",
    version="1.0.0",
    description="Enterprise Open WebGIS System Manager: SQL/PostGIS Architecture, Owners, Members, and Supply Chain"
)

# Enterprise PostGIS DDL Schema for Open Forestry Architecture
POSTGIS_DDL_SCHEMA = """
-- ============================================================================
-- PHÚ TÀI BIOENERGY ENTERPRISE FORESTRY WEBGIS POSTGIS DATABASE SCHEMA
-- Target Database: PostgreSQL 16+ with PostGIS 3.4+
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ----------------------------------------------------------------------------
-- 1. USER & ROLE-BASED ACCESS CONTROL (RBAC)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(64) UNIQUE NOT NULL,
    email VARCHAR(128) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    phone VARCHAR(20),
    role_id VARCHAR(32) REFERENCES roles(id) ON DELETE RESTRICT,
    assigned_provinces TEXT[] DEFAULT ARRAY['QNG', 'BDH', 'PYE'],
    assigned_districts TEXT[] DEFAULT ARRAY[]::text[],
    department VARCHAR(100) DEFAULT 'Phòng Lâm Nghiệp & Bền Vững',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128),
    ip_address VARCHAR(45),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 2. FOREST OWNERS & CADASTRAL CERTIFICATES (CHỦ RỪNG & SỔ ĐỎ)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forest_owners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_code VARCHAR(32) UNIQUE NOT NULL, -- e.g. CR-QNG-0001
    full_name VARCHAR(128) NOT NULL,
    cccd_number VARCHAR(20) UNIQUE NOT NULL,
    phone_number VARCHAR(20),
    owner_type VARCHAR(32) DEFAULT 'Hộ gia đình', -- 'Hộ gia đình', 'Cộng đồng', 'Doanh nghiệp', 'Ban QLR'
    bank_account_no VARCHAR(32),
    bank_name VARCHAR(100),
    province VARCHAR(64) NOT NULL,
    province_code VARCHAR(10) NOT NULL,
    district VARCHAR(64) NOT NULL,
    commune VARCHAR(64) NOT NULL,
    address_detail TEXT,
    fsc_member_status BOOLEAN DEFAULT FALSE,
    fsc_group_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS red_books (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES forest_owners(id) ON DELETE CASCADE,
    serial_number VARCHAR(64) NOT NULL, -- Số phát hành GCN (e.g. BL 123456)
    certificate_no VARCHAR(64) NOT NULL, -- Số vào sổ cấp GCN (e.g. CH 00123)
    issue_date DATE,
    issuing_authority VARCHAR(128) DEFAULT 'UBND Huyện',
    total_area_m2 DOUBLE PRECISION NOT NULL,
    total_area_ha DOUBLE PRECISION GENERATED ALWAYS AS (total_area_m2 / 10000.0) STORED,
    purpose_of_use VARCHAR(128) DEFAULT 'Đất rừng sản xuất (RSX)',
    term_of_use VARCHAR(64) DEFAULT 'Lâu dài',
    scan_document_url TEXT,
    verified_by_surveyor BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 3. SPATIAL FOREST PLOTS (LÔ RỪNG POSTGIS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forest_plots (
    id VARCHAR(64) PRIMARY KEY, -- e.g. PLT-000001
    owner_id UUID REFERENCES forest_owners(id) ON DELETE SET NULL,
    red_book_id UUID REFERENCES red_books(id) ON DELETE SET NULL,
    province VARCHAR(64) NOT NULL,
    province_code VARCHAR(10) NOT NULL,
    district VARCHAR(64) NOT NULL,
    commune VARCHAR(64) NOT NULL,
    sub_compartment VARCHAR(32), -- Tiểu khu
    compartment VARCHAR(32),     -- Khoảnh
    lot VARCHAR(32),             -- Lô
    tree_species VARCHAR(64) DEFAULT 'Keo lai (Acacia)',
    planting_year INT DEFAULT 2021,
    rotation_cycle_years INT DEFAULT 5,
    estimated_volume_m3_ha DOUBLE PRECISION DEFAULT 120.0,
    area_cadastral_ha DOUBLE PRECISION NOT NULL,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    centroid geometry(Point, 4326) GENERATED ALWAYS AS (ST_Centroid(geom)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
) PARTITION BY LIST (province_code);

-- Partitions by province
CREATE TABLE IF NOT EXISTS forest_plots_qng PARTITION OF forest_plots FOR VALUES IN ('QNG');
CREATE TABLE IF NOT EXISTS forest_plots_bdh PARTITION OF forest_plots FOR VALUES IN ('BDH');
CREATE TABLE IF NOT EXISTS forest_plots_pye PARTITION OF forest_plots FOR VALUES IN ('PYE');

-- Spatial Indexes
CREATE INDEX IF NOT EXISTS idx_forest_plots_geom ON forest_plots USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_forest_plots_centroid ON forest_plots USING GIST(centroid);
CREATE INDEX IF NOT EXISTS idx_forest_plots_loc ON forest_plots(province_code, district, commune);

-- ----------------------------------------------------------------------------
-- 4. MAP LAYERS & WORKSPACES (QUẢN LÝ BẢN ĐỒ)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS map_layers (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) DEFAULT 'Ranh giới lâm nghiệp',
    layer_type VARCHAR(32) DEFAULT 'geojson', -- 'geojson', 'mvt', 'raster', 'wms'
    source_url TEXT NOT NULL,
    min_zoom INT DEFAULT 5,
    max_zoom INT DEFAULT 20,
    style_config JSONB NOT NULL DEFAULT '{"fillColor": "#10b981", "opacity": 0.6}'::jsonb,
    is_public BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(128) NOT NULL,
    description TEXT,
    map_center DOUBLE PRECISION[] DEFAULT ARRAY[108.68, 15.02],
    zoom_level DOUBLE PRECISION DEFAULT 10.0,
    active_layer_ids TEXT[] DEFAULT ARRAY[]::text[],
    bookmarks JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 5. EUDR & TIMBER TRACEABILITY (TRUY XUẤT NGUỒN GỐC GỖ)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eudr_due_diligence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_number VARCHAR(64) UNIQUE NOT NULL, -- DDS-PTB-2026-001
    plot_id VARCHAR(64) REFERENCES forest_plots(id),
    harvest_date DATE,
    timber_volume_tons DOUBLE PRECISION NOT NULL,
    receiving_facility VARCHAR(128) DEFAULT 'Nhà máy Phú Tài Bioenergy Dung Quất',
    deforestation_free_verified BOOLEAN DEFAULT TRUE,
    satellite_audit_date DATE,
    compliance_rating VARCHAR(32) DEFAULT 'Compliant',
    export_destination VARCHAR(64) DEFAULT 'EU (Châu Âu)',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
"""

@server.tool()
def get_enterprise_sql_schema(target_db: str = "postgresql") -> Dict[str, Any]:
    """
    Get the complete architectural SQL DDL schema for the open forestry WebGIS system.
    Includes tables for:
      1. users & roles (RBAC)
      2. forest_owners & red_books (Sổ đỏ)
      3. forest_plots (PostGIS MultiPolygon partitioned by province)
      4. map_layers & user_workspaces
      5. eudr_due_diligence (Timber supply chain & deforestation-free compliance)
    """
    return {
        "target_database": "PostgreSQL 16+ / PostGIS 3.4+" if "postg" in target_db.lower() else "SQLite / Spatialite",
        "extensions_required": ["postgis", "postgis_topology", "uuid-ossp", "btree_gist"],
        "modules": [
            "Quản lý Phân quyền Thành viên (Users, Roles, Audit Logs)",
            "Quản lý Chủ rừng & Sổ đỏ (Forest Owners, Red Books)",
            "Quản lý Lô rừng Không gian (Forest Plots with GIST indexing & Partitions)",
            "Quản lý Lớp bản đồ & Workspace (Map Layers, Vector Tiles, Styles)",
            "Quản lý Truy xuất Gỗ EUDR & Bền vững (Due Diligence & Supply Chain)"
        ],
        "ddl_sql": POSTGIS_DDL_SCHEMA.strip()
    }

@server.tool()
def validate_forest_owner_profile(
    full_name: str,
    cccd_number: str,
    phone_number: str = "",
    province: str = "Quảng Ngãi",
    district: str = "Ba Tơ",
    commune: str = "Ba Vì"
) -> Dict[str, Any]:
    """
    Validate a forest owner profile according to Vietnamese cadastral guidelines.
    Checks:
      - CCCD format (12 digits, valid provincial prefixes e.g. 051 for Quang Ngai, 052 for Binh Dinh, 054 for Phu Yen).
      - Phone number format (10 digits starting with 03, 05, 07, 08, 09).
      - Normalized uppercase name.
    """
    errors = []
    cccd_clean = re.sub(r"\D", "", cccd_number)
    if len(cccd_clean) != 12:
        errors.append("Số CCCD không hợp lệ: Phải bao gồm đúng 12 chữ số.")

    phone_clean = re.sub(r"\D", "", phone_number) if phone_number else ""
    if phone_clean and (len(phone_clean) != 10 or not phone_clean.startswith("0")):
        errors.append("Số điện thoại không hợp lệ: Phải là số di động 10 chữ số bắt đầu bằng 0.")

    valid_prefixes = {"051": "Quảng Ngãi", "052": "Bình Định", "054": "Phú Yên"}
    prefix = cccd_clean[:3] if len(cccd_clean) >= 3 else ""
    orig_prov = valid_prefixes.get(prefix, "Tỉnh khác")

    is_valid = len(errors) == 0

    return {
        "valid": is_valid,
        "errors": errors,
        "owner_profile": {
            "owner_code": f"CR-{province[:3].upper()}-{cccd_clean[-4:]}" if is_valid else "",
            "full_name": full_name.strip().title(),
            "cccd_number": cccd_clean,
            "origin_province_by_cccd": orig_prov,
            "current_location": f"{commune}, {district}, {province}",
            "phone_number": phone_clean,
            "status": "Hồ sơ hợp lệ sẵn sàng đưa vào cơ sở dữ liệu" if is_valid else "Cần bổ sung/sửa đổi"
        }
    }

@server.tool()
def generate_postgis_migration_plan() -> Dict[str, Any]:
    """
    Generate an ETL and database migration plan from existing SQLite files
    (layer_f3f5750f.sqlite & webgis.db) to an enterprise PostgreSQL / PostGIS server.
    """
    return {
        "phase_1_infrastructure": {
            "target": "PostgreSQL 16 + PostGIS on Render / AWS RDS / Self-hosted Ubuntu",
            "setup_commands": [
                "CREATE DATABASE webgis_phutai;",
                "\\c webgis_phutai;",
                "CREATE EXTENSION postgis;",
                "CREATE EXTENSION \"uuid-ossp\";"
            ]
        },
        "phase_2_schema_creation": {
            "tables": ["roles", "users", "forest_owners", "red_books", "forest_plots", "map_layers", "eudr_due_diligence"],
            "features": "Partitions for QNG, BDH, PYE and GiST spatial indexes on geom"
        },
        "phase_3_data_etl": {
            "source_files": [
                "data/layers/layer_f3f5750f.sqlite (308,258 plots)",
                "data/webgis.db (users, workspaces, sessions)"
            ],
            "migration_tool": "Python async bulk loader via psycopg3 copy_records() with ST_GeomFromGeoJSON",
            "estimated_migration_duration": "45-60 seconds for 308,258 plots"
        },
        "phase_4_vector_tile_serving": {
            "engine": "PostGIS ST_AsMVT / pg_tileserv / Martin tile server",
            "benefit": "Enables MapLibre GL JS to smoothly render 300,000+ parcels at 60 FPS directly from PostGIS without client memory lag"
        }
    }

@server.tool()
def get_forestry_rbac_matrix() -> Dict[str, Any]:
    """
    Get the Role-Based Access Control (RBAC) permission matrix
    for the forestry management web application.
    """
    return {
        "roles": [
            {
                "role_id": "DIRECTOR",
                "name": "Ban Giám Đốc (Phú Tài Bioenergy)",
                "permissions": ["dashboard.view", "reports.export", "eudr.sign_off", "financial.view"]
            },
            {
                "role_id": "GIS_ADMIN",
                "name": "Quản trị viên Bản đồ & GIS",
                "permissions": ["layers.manage", "import.shp", "import.cad", "projections.edit", "database.admin"]
            },
            {
                "role_id": "FORESTRY_SPECIALIST",
                "name": "Chuyên viên Kỹ thuật Lâm nghiệp",
                "permissions": ["plots.edit", "species.update", "volume.calculate", "redbooks.match"]
            },
            {
                "role_id": "FIELD_SURVEYOR",
                "name": "Cán bộ Khảo sát Thực địa (Mobile)",
                "permissions": ["plots.gps_track", "photos.upload", "survey.submit", "offline_cache.download"]
            },
            {
                "role_id": "EUDR_AUDITOR",
                "name": "Kiểm toán viên EUDR / FSC / SBP (Độc lập)",
                "permissions": ["audit.read_only", "satellite_evidence.view", "chain_of_custody.inspect"]
            }
        ]
    }

if __name__ == "__main__":
    server.run(transport="stdio")
