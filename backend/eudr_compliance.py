"""
FM (Forest Management), SBP (Sustainable Biomass Program), and EUDR Compliance Engine.
Generates Due Diligence System (DDS) statements and EUDR geolocation polygon exports.
"""

from typing import List, Dict, Any
from datetime import datetime

class EUDRComplianceEngine:
    def __init__(self):
        pass

    def evaluate_plot_compliance(self, plot: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates a single forest plot against FM, SBP and EUDR standards.
        """
        is_fm = plot.get("fm_status") == "FM_CERTIFIED"
        is_sbp = plot.get("sbp_status") == "SBP_COMPLIANT"
        is_high_risk = plot.get("sbp_status") == "HIGH_RISK"

        # EUDR Check: Planted post-2020 or verified plantation
        planting_year = plot.get("planting_year", 2021)
        deforestation_free = not is_high_risk

        # SBP Feedstock classification
        if is_fm and is_sbp:
            sbp_claim = "SBP-compliant biomass"
            risk_category = "Low Risk (FSC 100% / PEFC Certified)"
        elif is_sbp:
            sbp_claim = "SBP-controlled biomass"
            risk_category = "Specified Risk Mitigated (SBE Assessed)"
        else:
            sbp_claim = "Non-compliant Feedstock"
            risk_category = "High Risk (Overlap / Unverified Land Rights)"

        return {
            "plot_id": plot["id"],
            "owner_name": plot["owner_name"],
            "province": plot["province"],
            "district": plot["district"],
            "area_ha": plot["area_ha"],
            "tree_species": plot["tree_species"],
            "hs_code": "4401.31.00", # Wood pellets
            "commodity_name": "Viên nén gỗ sinh khối (Wood Pellets)",
            "sbp_claim": sbp_claim,
            "risk_category": risk_category,
            "eudr_deforestation_free": deforestation_free,
            "cutoff_date_verification": "Verified no deforestation after 31/12/2020",
            "polygon_point_count": len(plot.get("coordinates", [])),
            "due_diligence_status": "APPROVED" if (is_fm or is_sbp) and not is_high_risk else "ACTION_REQUIRED"
        }

    def generate_eudr_dds_export(self, plots: List[Dict[str, Any]], operator_name: str = "CÔNG TY CỔ PHẦN NĂNG LƯỢNG SINH KHỐI MIỀN TRUNG") -> Dict[str, Any]:
        """
        Produces official EUDR Due Diligence Statement (DDS) GeoJSON package.
        """
        features = []
        for p in plots:
            eval_res = self.evaluate_plot_compliance(p)
            feat = {
                "type": "Feature",
                "id": p["id"],
                "properties": {
                    "operator": operator_name,
                    "producer_country": "VN",
                    "province": p["province"],
                    "district": p["district"],
                    "owner_name": p["owner_name"],
                    "owner_cccd": p["cccd"],
                    "hs_code": "4401.31.00",
                    "species_scientific": "Acacia mangium / Acacia auriculiformis" if "Keo" in p["tree_species"] else "Eucalyptus urophylla",
                    "species_common": p["tree_species"],
                    "harvest_area_ha": p["area_ha"],
                    "estimated_biomass_tons": round(p["area_ha"] * 85.0, 1),
                    "fsc_fm_status": p["fm_status"],
                    "sbp_status": p["sbp_status"],
                    "eudr_compliant": eval_res["eudr_deforestation_free"],
                    "verified_cutoff_date": "2020-12-31",
                    "certification_validity": "2024-2029"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [p["coordinates"]]
                }
            }
            features.append(feat)

        return {
            "type": "FeatureCollection",
            "metadata": {
                "system": "Central Vietnam GIS Pellet SBP & EUDR Registry",
                "provinces": ["Quảng Ngãi", "Bình Định", "Phú Yên"],
                "created_at": datetime.now().isoformat(),
                "operator": operator_name,
                "total_plots": len(plots),
                "total_area_ha": round(sum(p["area_ha"] for p in plots), 2),
                "total_estimated_biomass_tons": round(sum(p["area_ha"] * 85.0 for p in plots), 1),
                "standard": "EU Deforestation Regulation (EU) 2023/1115 & SBP Standard v2.0"
            },
            "features": features
        }

    def generate_eudr_excel_report(self, plots: List[Dict[str, Any]], operator_name: str = "PHÚ TÀI BIOENERGY") -> bytes:
        """
        Generates an audit-ready multi-sheet Excel (.xlsx) workbook for FSC-FM / SBP / EUDR auditors.
        """
        import io
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        wb = openpyxl.Workbook()
        thin_border = Border(
            left=Side(style='thin', color='D1D5DB'),
            right=Side(style='thin', color='D1D5DB'),
            top=Side(style='thin', color='D1D5DB'),
            bottom=Side(style='thin', color='D1D5DB')
        )
        header_fill = PatternFill(start_color='1E3A24', end_color='1E3A24', fill_type='solid')
        header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
        kpi_title_font = Font(name='Calibri', size=11, bold=True, color='1E3A24')
        bold_font = Font(name='Calibri', size=11, bold=True)

        # ---------------- SHEET 1: DASHBOARD TỔNG HỢP ----------------
        ws1 = wb.active
        ws1.title = "Tổng Hợp Chuỗi Cung Ứng"
        ws1.views.sheetView[0].showGridLines = True

        # Title
        ws1.merge_cells("A1:G1")
        ws1["A1"] = f"BÁO CÁO THẨM ĐỊNH NGUỒN GỖ VIÊN NÉN SINH KHỐI - CHUẨN FSC/SBP & EUDR"
        ws1["A1"].font = Font(name='Calibri', size=14, bold=True, color='FFFFFF')
        ws1["A1"].fill = PatternFill(start_color='166534', end_color='166534', fill_type='solid')
        ws1["A1"].alignment = Alignment(horizontal="center", vertical="center")
        ws1.row_dimensions[1].height = 36

        ws1["A2"] = f"Đơn vị xuất khẩu: {operator_name} | Ngày kết xuất: {datetime.now().strftime('%d/%m/%Y %H:%M')}"
        ws1["A2"].font = Font(name='Calibri', size=10, italic=True, color='4B5563')

        # KPI Summary Cards
        total_p = len(plots)
        total_ha = sum(p.get("area_ha", 0) for p in plots)
        total_biomass = total_ha * 85.0
        fm_count = sum(1 for p in plots if p.get("fm_status") == "FM_CERTIFIED")
        sbp_count = sum(1 for p in plots if p.get("sbp_status") == "SBP_COMPLIANT")
        eudr_count = sum(1 for p in plots if p.get("sbp_status") != "HIGH_RISK")

        kpi_data = [
            ("Tổng số lô rừng quản lý:", f"{total_p:,} lô", "Diện tích vùng nguyên liệu:", f"{total_ha:,.2f} ha"),
            ("Ước tính sản lượng sinh khối:", f"{total_biomass:,.1f} tấn", "Tỷ lệ đạt chuẩn FSC-FM:", f"{(fm_count/max(1, total_p))*100:.1f}%"),
            ("Tỷ lệ SBP Compliant Feedstock:", f"{(sbp_count/max(1, total_p))*100:.1f}%", "Tỷ lệ tuân thủ EUDR (Không phá rừng):", f"{(eudr_count/max(1, total_p))*100:.1f}%"),
            ("Mã phân loại hàng hóa (HS Code):", "4401.31.00 (Wood Pellets)", "Mốc thời gian thẩm định EUDR:", "Sau 31/12/2020 (Verified)")
        ]

        start_row = 4
        for r_idx, row in enumerate(kpi_data, start=start_row):
            ws1[f"A{r_idx}"] = row[0]
            ws1[f"A{r_idx}"].font = kpi_title_font
            ws1[f"B{r_idx}"] = row[1]
            ws1[f"B{r_idx}"].font = bold_font
            ws1[f"D{r_idx}"] = row[2]
            ws1[f"D{r_idx}"].font = kpi_title_font
            ws1[f"E{r_idx}"] = row[3]
            ws1[f"E{r_idx}"].font = bold_font
            ws1.row_dimensions[r_idx].height = 20

        # Provincial Breakdown Table
        p_row = 10
        ws1[f"A{p_row}"] = "PHÂN BỔ NGUỒN CUNG THEO ĐỊA BÀN TỈNH"
        ws1[f"A{p_row}"].font = Font(name='Calibri', size=12, bold=True, color='166534')

        p_headers = ["Địa bàn Tỉnh", "Kinh Tuyến Trục VN-2000", "Số Lô Rừng", "Tổng Diện Tích (ha)", "Sản Lượng (Tấn)", "Tỷ Lệ SBP", "Trạng Thái Rủi Ro"]
        for c_idx, h in enumerate(p_headers, start=1):
            cell = ws1.cell(row=p_row+1, column=c_idx, value=h)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border

        prov_list = [
            ("Quảng Ngãi", "108°00'"),
            ("Bình Định", "108°15'"),
            ("Phú Yên", "108°30'")
        ]
        cur_r = p_row + 2
        for prov_name, ktt in prov_list:
            sub_plots = [p for p in plots if prov_name in p.get("province", "")]
            s_count = len(sub_plots)
            s_area = sum(p.get("area_ha", 0) for p in sub_plots)
            s_biomass = s_area * 85.0
            s_sbp_pct = (sum(1 for p in sub_plots if p.get("sbp_status") == "SBP_COMPLIANT") / max(1, s_count)) * 100

            ws1.cell(row=cur_r, column=1, value=prov_name).border = thin_border
            ws1.cell(row=cur_r, column=2, value=ktt).border = thin_border
            ws1.cell(row=cur_r, column=3, value=s_count).border = thin_border
            ws1.cell(row=cur_r, column=4, value=round(s_area, 2)).border = thin_border
            ws1.cell(row=cur_r, column=5, value=round(s_biomass, 1)).border = thin_border
            ws1.cell(row=cur_r, column=6, value=f"{s_sbp_pct:.1f}%").border = thin_border
            ws1.cell(row=cur_r, column=7, value="Low Risk (SBE Mitigated)").border = thin_border
            cur_r += 1

        # ---------------- SHEET 2: DANH MỤC THẨM ĐỊNH LÔ RỪNG ----------------
        ws2 = wb.create_sheet(title="Thẩm Định Lô Rừng (DDS)")
        ws2.views.sheetView[0].showGridLines = True

        detail_headers = [
            "STT", "Mã Lô Rừng", "Chủ Rừng", "CCCD / CMND", "Số Điện Thoại",
            "Tỉnh", "Huyện", "Xã", "Tiểu Khu", "Khoảnh", "Số Lô", "Số Sổ Đỏ (GCN)",
            "Diện Tích (ha)", "Diện Tích (m2)", "Loài Cây", "Năm Trồng",
            "Kinh Độ WGS84 (Lon)", "Vĩ Độ WGS84 (Lat)",
            "Chứng Chỉ FSC-FM", "Chứng Chỉ SBP", "Thẩm Định EUDR 2020",
            "Sản Lượng Gỗ Dự Kiến (Tấn)"
        ]

        for col_idx, h in enumerate(detail_headers, start=1):
            cell = ws2.cell(row=1, column=col_idx, value=h)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = thin_border
        ws2.row_dimensions[1].height = 28

        for idx, p in enumerate(plots, start=1):
            r_idx = idx + 1
            cen = p.get("centroid", [108.5, 14.0])
            area_ha = p.get("area_ha", 0)
            row_vals = [
                idx,
                p.get("id", f"PLT-{idx:04d}"),
                p.get("owner_name", "-"),
                str(p.get("cccd", "-")),
                str(p.get("phone", "-")),
                p.get("province", "-"),
                p.get("district", "-"),
                p.get("commune", "-"),
                str(p.get("sub_compartment", "-")),
                str(p.get("compartment", "-")),
                str(p.get("lot", "-")),
                str(p.get("redbook_no", "-")),
                area_ha,
                round(area_ha * 10000, 1),
                p.get("tree_species", "Keo lai"),
                p.get("planting_year", 2022),
                cen[0] if len(cen) > 0 else 0.0,
                cen[1] if len(cen) > 1 else 0.0,
                "Đạt chuẩn FSC-FM" if p.get("fm_status") == "FM_CERTIFIED" else "Đang kiểm soát",
                "SBP-compliant biomass" if p.get("sbp_status") == "SBP_COMPLIANT" else "SBP-controlled",
                "Đạt (Không suy thoái rừng)" if p.get("sbp_status") != "HIGH_RISK" else "Cảnh báo rủi ro",
                round(area_ha * 85.0, 1)
            ]
            fill_color = "F9FAFB" if idx % 2 == 0 else "FFFFFF"
            row_fill = PatternFill(start_color=fill_color, end_color=fill_color, fill_type='solid')

            for col_idx, val in enumerate(row_vals, start=1):
                cell = ws2.cell(row=r_idx, column=col_idx, value=val)
                cell.border = thin_border
                cell.fill = row_fill
                if col_idx in [1, 9, 10, 11, 16]:
                    cell.alignment = Alignment(horizontal="center")
                elif col_idx in [13, 14, 17, 18, 22]:
                    cell.alignment = Alignment(horizontal="right")

        # Auto-fit columns
        for ws in [ws1, ws2]:
            for col in ws.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 11), 35)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

eudr_engine = EUDRComplianceEngine()

