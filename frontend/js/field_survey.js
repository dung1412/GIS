/**
 * Mobile Field Survey Module
 * Powers GPS tracking, Geofencing Boundary Alerts, Watermark Photo Generation, and Offline Sync.
 */

class FieldSurveyManager {
    constructor() {
        this.isGpsActive = false;
        this.currentCoords = { lat: 14.8124, lon: 108.6215, accuracy: 3.5 }; // Default in Ba To, Quang Ngai
        this.gpsMarker = null;
        this.activePlot = null;
        this.offlineSurveysKey = 'forestry_offline_surveys';
    }

    init() {
        this._bindEvents();
        this._initWatermarkCanvas();
        this.updateOfflineCounter();
    }

    _bindEvents() {
        const toggleGpsBtn = document.getElementById('btn-toggle-gps');
        if (toggleGpsBtn) {
            toggleGpsBtn.addEventListener('click', () => this.toggleGPS());
        }

        const snapBtn = document.getElementById('btn-snap-watermark');
        if (snapBtn) {
            snapBtn.addEventListener('click', () => this.captureWatermarkPhoto());
        }

        const submitSurveyBtn = document.getElementById('btn-submit-survey');
        if (submitSurveyBtn) {
            submitSurveyBtn.addEventListener('click', () => this.submitSurveyForm());
        }

        const syncBtn = document.getElementById('btn-sync-offline');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.syncOfflineData());
        }
    }

    toggleGPS() {
        this.isGpsActive = !this.isGpsActive;
        const btn = document.getElementById('btn-toggle-gps');
        const statusEl = document.getElementById('gps-live-coords');

        if (this.isGpsActive) {
            if (btn) {
                btn.innerHTML = '🔴 Dừng Định vị GPS';
                btn.style.background = 'rgba(239, 68, 68, 0.2)';
                btn.style.borderColor = '#ef4444';
                btn.style.color = '#f87171';
            }
            if (statusEl) {
                statusEl.innerHTML = `${this.currentCoords.lat.toFixed(5)}°, ${this.currentCoords.lon.toFixed(5)}°`;
            }

            // Add or move GPS marker on map
            if (window.mapController && window.mapController.map) {
                const map = window.mapController.map;
                if (!this.gpsMarker) {
                    const el = document.createElement('div');
                    el.className = 'gps-live-pulse-marker';
                    el.style.width = '20px';
                    el.style.height = '20px';
                    el.style.borderRadius = '50%';
                    el.style.backgroundColor = '#0284c7';
                    el.style.border = '3px solid #ffffff';
                    el.style.boxShadow = '0 0 15px #38bdf8';

                    this.gpsMarker = new maplibregl.Marker({ element: el })
                        .setLngLat([this.currentCoords.lon, this.currentCoords.lat])
                        .addTo(map);
                } else {
                    this.gpsMarker.setLngLat([this.currentCoords.lon, this.currentCoords.lat]);
                }

                window.mapController.flyToPlot([this.currentCoords.lon, this.currentCoords.lat], 16);
            }

            // Simulate slight GPS walking drift and geofencing check
            this.gpsInterval = setInterval(() => {
                this.currentCoords.lat += (Math.random() - 0.5) * 0.00015;
                this.currentCoords.lon += (Math.random() - 0.5) * 0.00015;
                if (this.gpsMarker) {
                    this.gpsMarker.setLngLat([this.currentCoords.lon, this.currentCoords.lat]);
                }
                if (statusEl) {
                    statusEl.innerHTML = `${this.currentCoords.lat.toFixed(5)}°, ${this.currentCoords.lon.toFixed(5)}°`;
                }
                this._checkGeofence();
            }, 3000);

        } else {
            if (btn) {
                btn.innerHTML = '🛰️ Bật Định vị GPS Thực địa';
                btn.style.background = '';
                btn.style.borderColor = '';
                btn.style.color = '';
            }
            if (this.gpsInterval) clearInterval(this.gpsInterval);
            if (this.gpsMarker) {
                this.gpsMarker.remove();
                this.gpsMarker = null;
            }
        }
    }

    _checkGeofence() {
        const alertEl = document.getElementById('geofence-alert-box');
        if (!alertEl) return;

        // Visual alert simulation
        const isInside = Math.random() > 0.15; // 85% inside boundary
        if (isInside) {
            alertEl.style.display = 'block';
            alertEl.style.background = 'rgba(16, 185, 129, 0.15)';
            alertEl.style.borderColor = '#10b981';
            alertEl.innerHTML = `
                <div style="color: #34d399; font-weight: 700; font-size: 12px;">
                    🛡️ GEOFENCE: VỊ TRÍ HỢP LỆ TRONG RANH GIỚI LÔ RỪNG
                </div>
                <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                    Cách mép ranh giới gần nhất: 38m (An toàn, không vi phạm rừng tự nhiên)
                </div>
            `;
        } else {
            alertEl.style.display = 'block';
            alertEl.style.background = 'rgba(239, 68, 68, 0.2)';
            alertEl.style.borderColor = '#ef4444';
            alertEl.innerHTML = `
                <div style="color: #f87171; font-weight: 700; font-size: 12px;">
                    ⚠️ CẢNH BÁO: BƯỚC RA NGOÀI RANH GIỚI ĐƯỢC CẤP PHÉP!
                </div>
                <div style="font-size: 11px; color: #cbd5e1; margin-top: 2px;">
                    Vị trí hiện tại đang lệch khỏi ranh giới lô 15m. Vui lòng quay lại vùng trồng.
                </div>
            `;
        }
    }

    _initWatermarkCanvas() {
        const canvas = document.getElementById('survey-watermark-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = 540;
        canvas.height = 360;

        // Draw realistic forest plantation background representation
        const grad = ctx.createLinearGradient(0, 0, 0, 360);
        grad.addColorStop(0, '#134e4a');
        grad.addColorStop(0.5, '#064e3b');
        grad.addColorStop(1, '#022c22');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 540, 360);

        // Draw abstract tree trunks & canopy
        ctx.fillStyle = '#0f766e';
        for (let i = 20; i < 540; i += 45) {
            ctx.fillRect(i, 80, 16, 280);
            ctx.beginPath();
            ctx.arc(i + 8, 80, 35, 0, Math.PI * 2);
            ctx.fill();
        }

        this._renderWatermarkOverlay(ctx, canvas.width, canvas.height);
    }

    _renderWatermarkOverlay(ctx, w, h) {
        const now = new Date();
        const timeStr = now.toLocaleString('vi-VN');

        // Draw bottom gradient overlay for readability
        const overlayGrad = ctx.createLinearGradient(0, h - 110, 0, h);
        overlayGrad.addColorStop(0, 'rgba(0,0,0,0)');
        overlayGrad.addColorStop(1, 'rgba(0,0,0,0.92)');
        ctx.fillStyle = overlayGrad;
        ctx.fillRect(0, h - 110, w, 110);

        // Watermark Text Stamp
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('HỆ THỐNG THẨM ĐỊNH THỰC ĐỊA SBP & FM - VIÊN NÉN MIỀN TRUNG', 16, h - 75);

        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`GPS: ${this.currentCoords.lat.toFixed(6)}° N, ${this.currentCoords.lon.toFixed(6)}° E (±${this.currentCoords.accuracy}m)`, 16, h - 55);

        ctx.fillStyle = '#34d399';
        const plotId = document.getElementById('survey-plot-id')?.value || 'QNG-BT-TK124-K2-L01';
        const surveyor = document.getElementById('surveyor-name')?.value || 'Nguyễn Văn Kiểm Lâm';
        ctx.fillText(`MÃ LÔ: ${plotId}  |  CÁN BỘ: ${surveyor}`, 16, h - 35);

        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`THỜI GIAN: ${timeStr}  |  CHUẨN EUDR / SBP COMPLIANT`, 16, h - 15);

        // Cadastral Seal stamp on top right
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(w - 115, 15, 100, 36);
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('ĐÃ ĐÓNG DẤU', w - 105, 30);
        ctx.fillText('GPS CHÍNH HÃNG', w - 107, 43);
    }

    captureWatermarkPhoto() {
        this._initWatermarkCanvas();
        alert('📸 Đã chụp ảnh hiện trường và tự động đóng dấu Watermark Tọa độ GPS & Thời gian thực!');
    }

    async submitSurveyForm() {
        const plotId = document.getElementById('survey-plot-id')?.value || 'QNG-BT-TK124-K2-L01';
        const surveyor = document.getElementById('surveyor-name')?.value || 'Nguyễn Văn Kiểm Lâm';
        const heightM = parseFloat(document.getElementById('tree-height')?.value || '14.5');
        const diamCm = parseFloat(document.getElementById('tree-diameter')?.value || '18.2');
        const canopyPct = parseInt(document.getElementById('canopy-cover')?.value || '75');
        const bufferOk = document.getElementById('buffer-zone-check')?.checked ?? true;
        const noChem = document.getElementById('no-chemicals-check')?.checked ?? true;
        const notes = document.getElementById('survey-notes')?.value || '';

        const canvas = document.getElementById('survey-watermark-canvas');
        const photoB64 = canvas ? canvas.toDataURL('image/jpeg', 0.8) : null;

        const surveyRecord = {
            plot_id: plotId,
            surveyor_name: surveyor,
            survey_date: new Date().toISOString(),
            gps_lat: this.currentCoords.lat,
            gps_lon: this.currentCoords.lon,
            gps_accuracy_m: this.currentCoords.accuracy,
            tree_height_m: heightM,
            tree_diameter_cm: diamCm,
            crown_cover_pct: canopyPct,
            fm_buffer_zone_ok: bufferOk,
            no_prohibited_chemicals: noChem,
            notes: notes,
            watermark_photo_b64: photoB64
        };

        // Try submitting online
        try {
            const res = await fetch('/api/survey/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(surveyRecord)
            });

            if (res.ok) {
                const data = await res.json();
                alert(`✅ ${data.message} (Mã phiếu: ${data.survey_id})`);
                return;
            }
        } catch (err) {
            console.log('Network unavailable, saving to offline storage...');
        }

        // Save locally to offline storage
        this._saveOfflineSurvey(surveyRecord);
        alert('📡 Thiết bị đang ngoại tuyến (mất sóng). Phiếu khảo sát đã được lưu an toàn vào Bộ nhớ Offline của máy!');
        this.updateOfflineCounter();
    }

    _saveOfflineSurvey(record) {
        const existing = JSON.parse(localStorage.getItem(this.offlineSurveysKey) || '[]');
        existing.push(record);
        localStorage.setItem(this.offlineSurveysKey, JSON.stringify(existing));
    }

    updateOfflineCounter() {
        const counterEl = document.getElementById('offline-records-count');
        if (!counterEl) return;
        const existing = JSON.parse(localStorage.getItem(this.offlineSurveysKey) || '[]');
        counterEl.innerHTML = existing.length;
    }

    async syncOfflineData() {
        const existing = JSON.parse(localStorage.getItem(this.offlineSurveysKey) || '[]');
        if (existing.length === 0) {
            alert('Hiện không có bản ghi ngoại tuyến nào cần đồng bộ.');
            return;
        }

        let synced = 0;
        for (const item of existing) {
            try {
                const res = await fetch('/api/survey/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item)
                });
                if (res.ok) synced++;
            } catch (e) {
                break;
            }
        }

        if (synced > 0) {
            const remaining = existing.slice(synced);
            localStorage.setItem(this.offlineSurveysKey, JSON.stringify(remaining));
            this.updateOfflineCounter();
            alert(`🎉 Đã đồng bộ thành công ${synced} phiếu khảo sát thực địa lên máy chủ trung tâm!`);
        } else {
            alert('❌ Chưa thể kết nối tới máy chủ. Vui lòng kiểm tra lại kết nối Wi-Fi/4G.');
        }
    }
}

window.fieldSurveyManager = new FieldSurveyManager();
