/**
 * Shape Matcher UI Module
 * Interacts with Backend OpenCV Shape Similarity API and Coordinate Table Parser.
 * Fully supports:
 * - Multi-criteria search (Owner, District, Commune, Parcel No, Sheet No, Area)
 * - Single or Multiple image uploads (Dropzone / File Selector)
 * - 1-Click Demo Redbook Sketches (Ba Tơ, Hoài Nhơn, Sông Hinh)
 * - OpenCV 7 Hu Moments shape contour extraction & OCR text recognition
 * - Candidate list with similarity score progress bar & 1-click map zoom
 * - VN-2000 Cadastral coordinate table parsing to WGS-84
 */

class ShapeMatcherUI {
    constructor() {
        this.currentMode = 'sketch';
        this.demoSketches = [];
        this.selectedFiles = [];
        this.roiBox = null;
    }

    init() {
        this._bindEvents();
        this._loadDemoSketches();
    }

    _bindEvents() {
        // Upload Dropzone
        const dropzone = document.getElementById('redbook-dropzone');
        const fileInput = document.getElementById('redbook-file-input');

        if (dropzone && fileInput) {
            dropzone.addEventListener('click', (e) => {
                if (e.target !== fileInput) fileInput.click();
            });

            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = '#10b981';
                dropzone.style.background = 'rgba(16, 185, 129, 0.15)';
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                dropzone.style.background = 'rgba(16, 185, 129, 0.04)';
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                dropzone.style.background = 'rgba(16, 185, 129, 0.04)';
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this._addFiles(Array.from(e.dataTransfer.files));
                }
            });

            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this._addFiles(Array.from(e.target.files));
                }
            });
        }

        // Action Trigger Button: "TÌM KIẾM & SO KHỚP LÔ RỪNG"
        const triggerBtn = document.getElementById('btn-trigger-match');
        if (triggerBtn) {
            triggerBtn.addEventListener('click', () => this.runShapeAndCadastralMatch());
        }

        // Action Reset Button: "Xóa Lọc"
        const resetBtn = document.getElementById('btn-reset-match');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetFilters());
        }

        // Coordinate parse button
        const parseBtn = document.getElementById('btn-parse-coords');
        if (parseBtn) {
            parseBtn.addEventListener('click', () => this.parseCoordinateTable());
        }

        // Listen for Enter key on search inputs
        ['shape-filter-owner', 'shape-filter-commune', 'shape-filter-parcel', 'shape-filter-sheet', 'shape-filter-area'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.runShapeAndCadastralMatch();
                    }
                });
            }
        });
    }

    _addFiles(newFiles) {
        for (const file of newFiles) {
            // Avoid duplicate filenames
            if (!this.selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
                this.selectedFiles.push(file);
            }
        }
        this._renderSelectedFiles();

        // If files are added, show ROI crop button if 1 image
        const roiBtn = document.getElementById('btn-open-roi-crop');
        if (roiBtn) {
            roiBtn.style.display = this.selectedFiles.length > 0 ? 'inline-block' : 'none';
        }
    }

    _removeFile(idx) {
        this.selectedFiles.splice(idx, 1);
        this._renderSelectedFiles();
        const roiBtn = document.getElementById('btn-open-roi-crop');
        if (roiBtn) {
            roiBtn.style.display = this.selectedFiles.length > 0 ? 'inline-block' : 'none';
        }
    }

    _renderSelectedFiles() {
        const container = document.getElementById('redbook-selected-files-list');
        if (!container) return;

        if (this.selectedFiles.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div style="font-size: 11px; font-weight: 700; color: #38bdf8; margin-bottom: 4px;">
                📎 Đã chọn ${this.selectedFiles.length} tệp ảnh sổ đỏ:
            </div>
            ${this.selectedFiles.map((f, idx) => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 8px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; font-size: 11px;">
                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span>🖼️</span>
                        <span style="color: #f8fafc; font-weight: 600;">${f.name}</span>
                        <span style="color: #94a3b8; font-size: 10px;">(${(f.size / 1024).toFixed(1)} KB)</span>
                    </div>
                    <button type="button" onclick="window.shapeMatcherUI._removeFile(${idx})" style="background: none; border: none; color: #ef4444; font-size: 13px; cursor: pointer; padding: 2px 6px;" title="Bỏ ảnh này">✕</button>
                </div>
            `).join('')}
        `;
    }

    resetFilters() {
        ['shape-filter-owner', 'shape-filter-commune', 'shape-filter-parcel', 'shape-filter-sheet', 'shape-filter-area'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const distEl = document.getElementById('shape-filter-district');
        if (distEl) distEl.value = '';

        this.selectedFiles = [];
        this.roiBox = null;
        this._renderSelectedFiles();

        const statusEl = document.getElementById('shape-match-status');
        if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }

        const resultsEl = document.getElementById('shape-match-results');
        if (resultsEl) resultsEl.innerHTML = '';

        const previewContainer = document.getElementById('contour-preview-container');
        if (previewContainer) previewContainer.innerHTML = '';

        const fileInput = document.getElementById('redbook-file-input');
        if (fileInput) fileInput.value = '';
    }

    async _loadDemoSketches() {
        try {
            const res = await fetch('/api/shape-match/demo-sketches');
            if (res.ok) {
                this.demoSketches = await res.json();
                this._renderDemoSketches();
            }
        } catch (err) {
            console.error('Error loading demo sketches:', err);
        }
    }

    _renderDemoSketches() {
        const container = document.getElementById('demo-sketches-container');
        if (!container) return;

        if (!this.demoSketches || this.demoSketches.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div style="font-size: 11px; font-weight: 700; color: #fbbf24; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                <span>⚡</span> <span>Thử nhanh sơ đồ mẫu có sẵn (1-Click Demo):</span>
            </div>
            <div class="demo-sketches-row" style="display: flex; flex-direction: column; gap: 6px;">
                ${this.demoSketches.map((s, idx) => `
                    <button type="button" class="demo-sketch-btn" onclick="window.shapeMatcherUI.testDemoSketch(${idx})" style="display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 6px 10px; color: #fff; cursor: pointer; text-align: left; transition: all 0.2s;">
                        <img src="${s.preview}" class="sketch-thumb" alt="${s.title}" style="width: 44px; height: 34px; object-fit: contain; background: #0f172a; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);" />
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 700; font-size: 11px; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.title}</div>
                            <div style="font-size: 10px; color: #94a3b8;">${s.province} | Diện tích: <b>${s.area_ha} ha</b></div>
                        </div>
                        <span style="font-size: 10px; color: #34d399; font-weight: 700; white-space: nowrap;">Thử ngay ➜</span>
                    </button>
                `).join('')}
            </div>
        `;
    }

    async testDemoSketch(idx) {
        const s = this.demoSketches[idx];
        if (!s) return;

        // Convert base64 data URL to Blob
        const fetchRes = await fetch(s.preview);
        const blob = await fetchRes.blob();
        const file = new File([blob], `${s.id}.png`, { type: 'image/png' });

        this.selectedFiles = [file];
        this._renderSelectedFiles();

        // Pre-fill fields
        const distEl = document.getElementById('shape-filter-district');
        if (distEl && s.district) distEl.value = s.district;

        const areaEl = document.getElementById('shape-filter-area');
        if (areaEl) areaEl.value = s.area_ha;

        await this.runShapeAndCadastralMatch();
    }

    async uploadAndMatchFile(file) {
        this.selectedFiles = [file];
        this._renderSelectedFiles();
        await this.runShapeAndCadastralMatch();
    }

    async runShapeAndCadastralMatch() {
        const statusEl = document.getElementById('shape-match-status');
        const resultsEl = document.getElementById('shape-match-results');
        const previewContainer = document.getElementById('contour-preview-container');

        const owner = document.getElementById('shape-filter-owner')?.value.trim() || '';
        const district = document.getElementById('shape-filter-district')?.value || '';
        const commune = document.getElementById('shape-filter-commune')?.value.trim() || '';
        const parcel = document.getElementById('shape-filter-parcel')?.value.trim() || '';
        const sheet = document.getElementById('shape-filter-sheet')?.value.trim() || '';
        const area = document.getElementById('shape-filter-area')?.value || '';

        // Validation: must have either files or at least one attribute
        if (this.selectedFiles.length === 0 && !owner && !parcel && !district && !commune && !sheet && !area) {
            alert('Vui lòng chọn ảnh Sổ đỏ hoặc nhập thông tin (Chủ rừng, Số thửa, Huyện...) để tra cứu!');
            return;
        }

        if (statusEl) {
            statusEl.innerHTML = `
                <div style="padding: 12px; background: rgba(14, 165, 233, 0.15); border-radius: 8px; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 12px; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 16px;">⏳</span>
                    <div>
                        <b>Đang xử lý đối chiếu & so khớp hình thể...</b><br/>
                        <span style="font-size: 11px; color: #94a3b8;">Trích xuất đường bao OpenCV, phân tích Moment Hu & truy vấn CSDL rừng.</span>
                    </div>
                </div>
            `;
            statusEl.style.display = 'block';
        }
        if (resultsEl) resultsEl.innerHTML = '';

        const formData = new FormData();

        // Append files
        if (this.selectedFiles.length > 0) {
            formData.append('file', this.selectedFiles[0]);
            for (const f of this.selectedFiles) {
                formData.append('files', f);
            }
        }

        // Append criteria
        if (owner) formData.append('owner_name', owner);
        if (district) formData.append('district', district);
        if (commune) formData.append('commune', commune);
        if (parcel) formData.append('parcel_no', parcel);
        if (sheet) formData.append('sheet_no', sheet);
        if (area) formData.append('area_ha', area);
        if (this.roiBox) formData.append('roi_box', JSON.stringify(this.roiBox));

        // Get province from active button or filter
        const activeProv = document.querySelector('.prov-btn.active')?.dataset?.province || 'Quảng Ngãi';
        formData.append('province', activeProv === 'BDH' ? 'Bình Định' : (activeProv === 'PYE' ? 'Phú Yên' : 'Quảng Ngãi'));

        try {
            const res = await fetch('/api/shape-match/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (!res.ok) {
                if (statusEl) {
                    statusEl.innerHTML = `<div style="color: #ef4444; font-size: 12px; padding: 10px; background: rgba(239,68,68,0.1); border-radius: 6px;">❌ ${data.detail || 'Lỗi xử lý hình ảnh hoặc không tìm thấy dữ liệu'}</div>`;
                }
                return;
            }

            if (statusEl) statusEl.style.display = 'none';

            // Show contour extraction preview if image was provided
            if (previewContainer && data.contour_meta && data.contour_meta.preview_base64) {
                const meta = data.contour_meta;
                const hasOcr = meta.ocr_engine || meta.detected_parcel !== '-' || meta.detected_area_ha > 0;
                previewContainer.innerHTML = `
                    <div class="contour-preview-card" style="margin-bottom: 12px; padding: 12px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 12px; font-weight: 700; color: #34d399;">✓ Trích xuất đường bao (OpenCV Contour)</span>
                            <span style="font-size: 11px; color: #94a3b8;">Số đỉnh: <b>${meta.vertex_count || 0} góc</b></span>
                        </div>
                        <img src="${meta.preview_base64}" class="contour-img" alt="Contour Preview" style="max-height: 140px; width: 100%; object-fit: contain; background: #000; border-radius: 6px;" />

                        ${hasOcr ? `
                        <div style="margin-top: 10px; padding: 10px; background: rgba(30, 41, 59, 0.7); border-radius: 6px; font-size: 11px; color: #cbd5e1; display: flex; flex-direction: column; gap: 5px; border: 1px solid rgba(56, 189, 248, 0.2);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #38bdf8; font-weight: 700;">🤖 ${meta.ocr_engine || 'AI OCR Nhận Diện Sổ Đỏ'}:</span>
                                <span style="color: #34d399; font-weight: 600;">✓ Thành công</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px;">
                                <span>Thửa số: <b style="color: #fff;">${meta.detected_parcel || '-'}</b></span>
                                <span>Tờ BĐ: <b style="color: #fff;">${meta.detected_sheet || '-'}</b></span>
                                <span>Diện tích: <b style="color: #fff;">${meta.detected_area_ha ? meta.detected_area_ha + ' ha' : (meta.detected_area_m2 ? meta.detected_area_m2 + ' m²' : '-')}</b></span>
                                <span>Tọa độ: <b style="color: #fff;">${(meta.detected_coordinates_points || []).length > 0 ? (meta.detected_coordinates_points || []).length + ' điểm VN2000' : 'Không có'}</b></span>
                            </div>
                            ${(meta.detected_coordinates_points || []).length > 0 ? `
                                <div style="margin-top: 6px;">
                                    <button type="button" class="btn-primary" style="padding: 5px 8px; font-size: 11px; width: 100%; background: #0284c7; border-color: #38bdf8;" onclick="window.shapeMatcherUI.applyOcrCoordinates('${encodeURIComponent(meta.detected_coordinates_text)}')">
                                        📍 Nạp ${(meta.detected_coordinates_points || []).length} Điểm Tọa Độ VN-2000 Lên Bản Đồ
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                        ` : ''}
                    </div>
                `;
            } else if (previewContainer) {
                previewContainer.innerHTML = '';
            }

            // Render matched candidates
            if (resultsEl) {
                const matches = data.matches || [];
                if (matches.length === 0) {
                    resultsEl.innerHTML = `
                        <div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 25px 15px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                            ❌ Không tìm thấy lô rừng nào tương đồng với tiêu chí hoặc ảnh đã cung cấp.<br/>
                            <span style="font-size: 11px; color: #64748b; margin-top: 4px; display: block;">Hãy thử mở rộng bộ lọc hoặc kiểm tra lại ảnh chụp sơ đồ thửa đất.</span>
                        </div>
                    `;
                    return;
                }

                resultsEl.innerHTML = `
                    <div style="font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <span>🎯 Kết Quả Đối Chiếu (${matches.length} Lô Rừng Tương Đồng):</span>
                    </div>
                    ${matches.map((m, i) => `
                        <div class="match-item" onclick="window.shapeMatcherUI.onSelectMatchedPlot('${m.plot_id}', [${m.centroid}])" style="cursor: pointer; margin-bottom: 8px; padding: 10px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; transition: all 0.2s;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div>
                                    <div style="font-weight: 700; color: #ffffff; font-size: 13px;">${i + 1}. ${m.owner_name}</div>
                                    <div style="font-size: 11px; color: #38bdf8; font-family: monospace;">Mã lô: ${m.plot_id}</div>
                                    <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                                        ${m.commune || ''}, ${m.district || ''}, ${m.province || ''} | <b>${m.area_ha} ha</b> (${m.tree_species || 'Keo'})
                                    </div>
                                </div>
                                <div style="text-align: right;">
                                    <span style="font-size: 14px; font-weight: 800; color: #34d399; font-family: monospace;">
                                        ${m.similarity_percent || m.similarity_score || 0}%
                                    </span>
                                </div>
                            </div>
                            <div class="match-score-bar-wrapper" style="margin-top: 6px; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                                <div class="match-score-progress" style="width: 100%; height: 100%;">
                                    <div class="match-score-fill" style="width: ${m.similarity_percent || m.similarity_score || 0}%; height: 100%; background: linear-gradient(90deg, #10b981, #34d399);"></div>
                                </div>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 11px;">
                                <span class="badge ${m.sbp_status === 'SBP_COMPLIANT' ? 'badge-fm' : (m.sbp_status === 'HIGH_RISK' ? 'badge-risk' : 'badge-sbp')}">
                                    ${m.sbp_status === 'SBP_COMPLIANT' ? 'FSC/SBP Đạt' : 'Lô rừng SHP'}
                                </span>
                                <span style="color: #38bdf8; font-weight: 600;">🔍 Định vị trên bản đồ ➜</span>
                            </div>
                        </div>
                    `).join('')}
                `;

                // Automatically highlight the top 1 match on map
                if (matches.length > 0) {
                    this.onSelectMatchedPlot(matches[0].plot_id, matches[0].centroid);
                }

                // Refresh Red Book log in sidebar
                if (window.app && typeof window.app.loadRedBookLogs === 'function') {
                    window.app.loadRedBookLogs();
                }
            }

        } catch (err) {
            console.error('Error in runShapeAndCadastralMatch:', err);
            if (statusEl) {
                statusEl.innerHTML = `<div style="color: #ef4444; font-size: 12px; padding: 10px; background: rgba(239,68,68,0.1); border-radius: 6px;">❌ Lỗi kết nối máy chủ hoặc gián đoạn mạng</div>`;
            }
        }
    }

    onSelectMatchedPlot(plotId, centroid) {
        if (window.mapController) {
            window.mapController.selectPlot(plotId);
            if (centroid && Array.isArray(centroid) && centroid.length === 2) {
                window.mapController.flyToPlot(centroid, 16);
            }
        }
    }

    async parseCoordinateTable() {
        const textEl = document.getElementById('coord-table-input');
        const provEl = document.getElementById('coord-province-select');
        const resultEl = document.getElementById('coord-parse-result');

        if (!textEl || !textEl.value.trim()) {
            alert('Vui lòng nhập hoặc dán bảng tọa độ VN-2000!');
            return;
        }

        try {
            const res = await fetch('/api/redbook/parse-coordinates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    coordinate_text: textEl.value.trim(),
                    province: provEl ? provEl.value : 'Quảng Ngãi'
                })
            });

            const data = await res.json();
            if (!res.ok) {
                if (resultEl) resultEl.innerHTML = `<div style="color: #ef4444; font-size: 12px; margin-top: 8px;">❌ ${data.detail || 'Lỗi bóc tách tọa độ'}</div>`;
                return;
            }

            if (resultEl) {
                const p = data.matched_plot;
                resultEl.innerHTML = `
                    <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 8px; padding: 12px; margin-top: 10px; font-size: 12px;">
                        <div style="font-weight: 700; color: #34d399; margin-bottom: 4px;">✓ Đã chuyển đổi ${data.points.length} góc ranh sang WGS-84</div>
                        <div><b>Tọa độ tâm WGS84:</b> ${data.centroid[1].toFixed(5)}°, ${data.centroid[0].toFixed(5)}°</div>
                        ${p ? `
                            <div style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
                                <b>Trùng khớp Lô rừng:</b> ${p.owner_name} (${p.id})<br/>
                                <b>Địa danh:</b> ${p.commune}, ${p.district}, ${p.province}<br/>
                                <button type="button" class="btn-primary" style="margin-top: 6px; width: 100%; font-size: 11px; padding: 6px;" 
                                        onclick="window.shapeMatcherUI.onSelectMatchedPlot('${p.id}', [${p.centroid}])">
                                    Định vị lô rừng này trên bản đồ
                                </button>
                            </div>
                        ` : ''}
                    </div>
                `;

                if (p) {
                    this.onSelectMatchedPlot(p.id, p.centroid);
                }
            }
        } catch (err) {
            console.error('Error parsing coordinates:', err);
        }
    }

    applyOcrCoordinates(encodedText) {
        const text = decodeURIComponent(encodedText);
        const inputEl = document.getElementById('coord-table-input');
        if (inputEl) {
            inputEl.value = text;
            inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.parseCoordinateTable();
        }
    }
}

window.shapeMatcherUI = new ShapeMatcherUI();
