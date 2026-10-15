/**
 * MapInfo Professional Web GIS Drawing & Editing Suite.
 * Recreates authentic MapInfo Desktop Drawing Toolbar with full in-browser CAD/GIS capabilities:
 * 1. Point / Symbol (Ký hiệu điểm)
 * 2. Line (Đoạn thẳng 2 điểm)
 * 3. Polyline (Đường gấp khúc đa tuyến)
 * 4. Arc (Cung tròn uốn cong 3 điểm)
 * 5. Polygon (Vùng đa giác khép góc)
 * 6. Ellipse / Circle (Hình Elip / Đường tròn)
 * 7. Rectangle (Hình chữ nhật)
 * 8. Rounded Rectangle (Hình chữ nhật bo tròn)
 * 9. Text (Chữ / Nhãn ghi chú trực tiếp)
 * 10. Frame (Khung viền ranh giới)
 * 11. Reshape (Sửa mốc đỉnh / Node editing)
 * 12. Add Node (Thêm đỉnh mới vào cạnh)
 * 13-16. Style Pickers: Symbol Style, Line Style, Region Style, Text Style
 * 17. Fractional Label Tool (a-b / c-d)
 * Live Area & Length measurement, Undo, Clear, Save to Layer
 */

class WebGISEditor {
    constructor() {
        this.map = null;
        this.activeMode = null;
        this.sketchCoords = [];
        this.drawnFeatures = [];
        this.textMarkers = [];
        this.reshapeTarget = null;
        this.vertexMarkers = [];
        this.activeLayerId = null;
        this._uiInitialized = false;

        // MapInfo Default Styles
        this.styles = {
            symbol: { type: 'pin', color: '#06b6d4', size: 22 },
            line: { type: 'solid', color: '#0284c7', width: 2.5 },
            region: { fillColor: '#10b981', fillOpacity: 0.35, strokeColor: '#064e3b' },
            text: { font: "'Plus Jakarta Sans', sans-serif", size: 14, color: '#ffffff', bold: true, halo: true }
        };

        this._onMapClick = this._onMapClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onDblClick = this._onDblClick.bind(this);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this._setupToolbarUI());
        } else {
            setTimeout(() => this._setupToolbarUI(), 50);
        }
    }

    init(map) {
        this.map = map;
        this._setupDrawingLayers();
        this._setupToolbarUI();
    }

    _setupDrawingLayers() {
        if (!this.map) return;

        // 1. Persistent Drawn Features Source
        if (!this.map.getSource('mapinfo-drawing')) {
            this.map.addSource('mapinfo-drawing', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        // Polygon Fill Layer
        if (!this.map.getLayer('mapinfo-drawing-fill')) {
            this.map.addLayer({
                id: 'mapinfo-drawing-fill',
                type: 'fill',
                source: 'mapinfo-drawing',
                filter: ['==', '$type', 'Polygon'],
                paint: {
                    'fill-color': ['coalesce', ['get', 'fillColor'], this.styles.region.fillColor],
                    'fill-opacity': ['coalesce', ['get', 'fillOpacity'], this.styles.region.fillOpacity]
                }
            });
        }

        // Lines & Polygon Outlines Layer
        if (!this.map.getLayer('mapinfo-drawing-line')) {
            this.map.addLayer({
                id: 'mapinfo-drawing-line',
                type: 'line',
                source: 'mapinfo-drawing',
                filter: ['in', '$type', 'LineString', 'Polygon'],
                paint: {
                    'line-color': ['coalesce', ['get', 'strokeColor'], this.styles.line.color],
                    'line-width': ['coalesce', ['get', 'strokeWidth'], this.styles.line.width]
                }
            });
        }

        // Points & Symbols Layer
        if (!this.map.getLayer('mapinfo-drawing-points')) {
            this.map.addLayer({
                id: 'mapinfo-drawing-points',
                type: 'circle',
                source: 'mapinfo-drawing',
                filter: ['==', '$type', 'Point'],
                paint: {
                    'circle-radius': ['coalesce', ['get', 'pointSize'], 7],
                    'circle-color': ['coalesce', ['get', 'pointColor'], this.styles.symbol.color],
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#ffffff'
                }
            });
        }

        // 2. Active In-Progress Sketch Source
        if (!this.map.getSource('editor-sketch')) {
            this.map.addSource('editor-sketch', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        // Sketch Polygon Fill
        if (!this.map.getLayer('editor-sketch-fill')) {
            this.map.addLayer({
                id: 'editor-sketch-fill',
                type: 'fill',
                source: 'editor-sketch',
                filter: ['==', '$type', 'Polygon'],
                paint: {
                    'fill-color': '#38bdf8',
                    'fill-opacity': 0.35
                }
            });
        }

        // Sketch Line
        if (!this.map.getLayer('editor-sketch-line')) {
            this.map.addLayer({
                id: 'editor-sketch-line',
                type: 'line',
                source: 'editor-sketch',
                filter: ['in', '$type', 'LineString', 'Polygon'],
                paint: {
                    'line-color': '#0284c7',
                    'line-width': 2.5,
                    'line-dasharray': [2, 2]
                }
            });
        }

        // Sketch Vertex Handles
        if (!this.map.getLayer('editor-sketch-points')) {
            this.map.addLayer({
                id: 'editor-sketch-points',
                type: 'circle',
                source: 'editor-sketch',
                filter: ['==', '$type', 'Point'],
                paint: {
                    'circle-radius': 5.5,
                    'circle-color': '#ffffff',
                    'circle-stroke-width': 2.5,
                    'circle-stroke-color': '#0284c7'
                }
            });
        }

        this._bringLayersToTop();
    }

    _bringLayersToTop() {
        if (!this.map) return;
        const layerIds = [
            'mapinfo-drawing-fill',
            'mapinfo-drawing-line',
            'mapinfo-drawing-points',
            'editor-sketch-fill',
            'editor-sketch-line',
            'editor-sketch-points'
        ];
        layerIds.forEach(lid => {
            if (this.map.getLayer(lid)) {
                try {
                    this.map.moveLayer(lid);
                } catch (e) {}
            }
        });
    }

    _setupToolbarUI() {
        if (this._uiInitialized) return;
        this._uiInitialized = true;

        // Toggle MapInfo toolbar expand / collapse
        const grip = document.getElementById('mapinfo-grip');
        const minBtn = document.getElementById('btn-toggle-mapinfo');
        const container = document.getElementById('mapinfo-toolbar-container');

        const toggleCollapse = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            if (container) {
                container.classList.toggle('collapsed');
                if (minBtn) minBtn.innerText = container.classList.contains('collapsed') ? '➕' : '━';
            }
        };

        if (grip) grip.addEventListener('click', toggleCollapse);
        if (minBtn) minBtn.addEventListener('click', toggleCollapse);

        // Bind Drawing Tool Buttons (fallback if not using inline onclick)
        document.querySelectorAll('.mapinfo-tool-btn[data-tool]').forEach(btn => {
            if (!btn.hasAttribute('onclick')) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const tool = e.currentTarget.dataset.tool;
                    this.setMode(tool);
                });
            }
        });

        // Bind Style Pickers (fallback if not using inline onclick)
        document.querySelectorAll('.mapinfo-tool-btn[data-style]').forEach(btn => {
            if (!btn.hasAttribute('onclick')) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const styleName = e.currentTarget.dataset.style;
                    this.toggleStyleModal(styleName);
                });
            }
        });

        // Bind Fractional Label Modal button
        const fracBtn = document.getElementById('btn-mapinfo-fractional-label');
        if (fracBtn && !fracBtn.hasAttribute('onclick')) {
            fracBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openFractionalLabelModal();
            });
        }

        // Subbar action buttons
        const finishBtn = document.getElementById('btn-mapinfo-finish');
        if (finishBtn) finishBtn.addEventListener('click', () => this.finishCurrentShape());

        const saveBtn = document.getElementById('btn-mapinfo-save');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveDrawn());

        const undoBtn = document.getElementById('btn-mapinfo-undo');
        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());

        const clearBtn = document.getElementById('btn-mapinfo-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => this.clear());

        const cancelBtn = document.getElementById('btn-mapinfo-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancel());

        // Close style popups when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.mapinfo-toolbar-container')) {
                this._closeAllStyleModals();
            }
        });
    }

    openFractionalLabelModal() {
        if (window.app && typeof window.app.openFractionalLabelModal === 'function') {
            window.app.openFractionalLabelModal();
        } else {
            const modal = document.getElementById('fractional-label-modal-overlay');
            if (modal) modal.classList.add('open', 'active');
        }
    }

    setMode(mode) {
        const now = Date.now();
        if (this._lastModeClick && now - this._lastModeClick < 300 && this._lastModeName === mode) {
            return;
        }
        this._lastModeClick = now;
        this._lastModeName = mode;

        if (!this.map) {
            if (window.mapController && window.mapController.map) {
                this.init(window.mapController.map);
            } else if (window.map) {
                this.init(window.map);
            }
        }

        if (this.activeMode === mode) {
            this.cancel();
            return;
        }

        this.cancel();
        this.activeMode = mode;
        this._closeAllStyleModals();
        this._clearVertexMarkers();

        // Highlight active button
        document.querySelectorAll('.mapinfo-tool-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.mapinfo-tool-btn[data-tool="${mode}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Show sub-bar
        const subbar = document.getElementById('mapinfo-subbar');
        if (subbar) subbar.style.display = 'flex';

        const finishBtn = document.getElementById('btn-mapinfo-finish');
        if (finishBtn) finishBtn.style.display = 'none';

        const hintEl = document.getElementById('mapinfo-hint');
        const hints = {
            'point': '📍 Nhấp chuột trên bản đồ để cắm điểm mốc ranh tọa độ.',
            'line': '📏 Nhấp điểm bắt đầu, sau đó nhấp điểm kết thúc đoạn thẳng.',
            'polyline': '📐 Nhấp các mốc ranh, nhấp đúp hoặc bấm "Hoàn tất" để xong đường.',
            'arc': '🏹 Nhấp 3 điểm (điểm đầu, đỉnh uốn cong, điểm cuối) để vẽ cung tròn.',
            'polygon': '🟢 Nhấp các mốc ranh, nhấp đúp hoặc bấm "Hoàn tất" để khép góc lô rừng.',
            'ellipse': '⭕ Nhấp chọn tâm, sau đó nhấp điểm xác định bán kính elip/tròn.',
            'rectangle': '🟦 Nhấp 2 điểm góc đối diện để vẽ hình chữ nhật thửa đất.',
            'roundrect': '🟪 Nhấp 2 điểm góc đối diện để vẽ hình chữ nhật bo góc.',
            'text': '🔤 Nhấp chuột trên bản đồ để đặt nhãn / ghi chú chữ.',
            'frame': '🖼️ Nhấp 2 điểm góc đối diện để vẽ khung ranh giới.',
            'reshape': '📌 Nhấp chọn hình vừa vẽ để kéo nắn mốc ranh.',
            'addnode': '➕ Nhấp vào cạnh của hình để chèn thêm mốc ranh mới.',
            'draw': '✏️ Vẽ lô mới: Nhấp các mốc ranh, nhấp đúp để hoàn tất.'
        };

        if (hintEl) hintEl.innerHTML = hints[mode] || 'Sẵn sàng vẽ.';
        this._updateMetricsText('');

        if (this.map) {
            this._bringLayersToTop();
            if (this.map.doubleClickZoom) this.map.doubleClickZoom.disable();
            this.map.getCanvas().style.cursor = (mode === 'reshape' || mode === 'addnode') ? 'pointer' : 'crosshair';
            this.map.on('click', this._onMapClick);
            this.map.on('mousemove', this._onMouseMove);
            this.map.on('dblclick', this._onDblClick);
        }
    }

    cancel() {
        this.activeMode = null;
        this.sketchCoords = [];
        this.reshapeTarget = null;
        this._clearVertexMarkers();
        this._updateSketchSource();
        this._closeAllStyleModals();

        if (this.map) {
            if (this.map.doubleClickZoom) this.map.doubleClickZoom.enable();
            this.map.getCanvas().style.cursor = '';
            this.map.off('click', this._onMapClick);
            this.map.off('mousemove', this._onMouseMove);
            this.map.off('dblclick', this._onDblClick);
        }

        document.querySelectorAll('.mapinfo-tool-btn').forEach(b => b.classList.remove('active'));

        const finishBtn = document.getElementById('btn-mapinfo-finish');
        if (finishBtn) finishBtn.style.display = 'none';

        const subbar = document.getElementById('mapinfo-subbar');
        if (subbar && this.drawnFeatures.length === 0) {
            subbar.style.display = 'none';
        } else if (subbar) {
            const hintEl = document.getElementById('mapinfo-hint');
            if (hintEl) hintEl.innerHTML = `Đã vẽ ${this.drawnFeatures.length} đối tượng. Chọn công cụ khác hoặc bấm Lưu Lô.`;
        }
    }

    undo() {
        if (this.sketchCoords.length > 0) {
            this.sketchCoords.pop();
            this._updateSketchSource();
            this._updateMetrics();
            const finishBtn = document.getElementById('btn-mapinfo-finish');
            if (finishBtn) {
                const canFinish = (this.activeMode === 'polygon' && this.sketchCoords.length >= 3) ||
                                  (this.activeMode === 'polyline' && this.sketchCoords.length >= 2);
                finishBtn.style.display = canFinish ? 'inline-block' : 'none';
            }
        } else if (this.drawnFeatures.length > 0) {
            const popped = this.drawnFeatures.pop();
            this._refreshDrawnSource();
            this._showNotification(`Đã hoàn tác đối tượng: ${popped.properties.name || 'hình vừa vẽ'}`);
        }
    }

    clear() {
        if (this.sketchCoords.length > 0) {
            this.sketchCoords = [];
            this._updateSketchSource();
            this._updateMetricsText('');
            const finishBtn = document.getElementById('btn-mapinfo-finish');
            if (finishBtn) finishBtn.style.display = 'none';
        } else if (this.drawnFeatures.length > 0 || this.textMarkers.length > 0) {
            if (confirm('Bạn có chắc muốn xóa tất cả các hình vừa vẽ trên bản đồ?')) {
                this.drawnFeatures = [];
                this.textMarkers.forEach(m => m.remove());
                this.textMarkers = [];
                this._clearVertexMarkers();
                this._refreshDrawnSource();
                this.cancel();
            }
        }
    }

    _onMapClick(e) {
        const pt = [round6(e.lngLat.lng), round6(e.lngLat.lat)];

        switch (this.activeMode) {
            case 'point': {
                this._addPointFeature(pt);
                this._showNotification(`📍 Đã cắm mốc tọa độ tại: ${pt[0].toFixed(5)}, ${pt[1].toFixed(5)}`);
                break;
            }
            case 'text': {
                const text = prompt('Nhập chữ / nhãn ghi chú hiển thị trên bản đồ:', 'Lô rừng mới');
                if (text && text.trim()) {
                    this._addTextMarker(pt, text.trim());
                }
                break;
            }
            case 'line': {
                this.sketchCoords.push(pt);
                if (this.sketchCoords.length === 2) {
                    this._addLineFeature(this.sketchCoords, 'Đoạn thẳng');
                    this.sketchCoords = [];
                }
                this._updateSketchSource();
                break;
            }
            case 'rectangle': {
                this.sketchCoords.push(pt);
                if (this.sketchCoords.length === 2) {
                    const rect = this._buildRectangleCoords(this.sketchCoords[0], this.sketchCoords[1]);
                    this._addPolygonFeature(rect, 'Hình chữ nhật thửa đất');
                    this.sketchCoords = [];
                }
                this._updateSketchSource();
                break;
            }
            case 'roundrect': {
                this.sketchCoords.push(pt);
                if (this.sketchCoords.length === 2) {
                    const rrect = this._buildRoundedRectCoords(this.sketchCoords[0], this.sketchCoords[1]);
                    this._addPolygonFeature(rrect, 'Hình chữ nhật bo góc');
                    this.sketchCoords = [];
                }
                this._updateSketchSource();
                break;
            }
            case 'ellipse': {
                this.sketchCoords.push(pt);
                if (this.sketchCoords.length === 2) {
                    const circle = this._buildCircleCoords(this.sketchCoords[0], this.sketchCoords[1]);
                    this._addPolygonFeature(circle, 'Hình elip / tròn');
                    this.sketchCoords = [];
                }
                this._updateSketchSource();
                break;
            }
            case 'arc': {
                this.sketchCoords.push(pt);
                if (this.sketchCoords.length === 3) {
                    const arcCoords = this._buildArcCoords(this.sketchCoords[0], this.sketchCoords[1], this.sketchCoords[2]);
                    this._addLineFeature(arcCoords, 'Cung tròn');
                    this.sketchCoords = [];
                }
                this._updateSketchSource();
                break;
            }
            case 'frame': {
                this.sketchCoords.push(pt);
                if (this.sketchCoords.length === 2) {
                    const frameBox = this._buildRectangleCoords(this.sketchCoords[0], this.sketchCoords[1]);
                    this._addLineFeature(frameBox, 'Khung ranh giới');
                    this.sketchCoords = [];
                }
                this._updateSketchSource();
                break;
            }
            case 'polygon':
            case 'draw': {
                this.sketchCoords.push(pt);
                this._updateSketchSource();
                this._updateMetrics();
                const finishBtn = document.getElementById('btn-mapinfo-finish');
                if (finishBtn && this.sketchCoords.length >= 3) {
                    finishBtn.style.display = 'inline-block';
                }
                break;
            }
            case 'polyline': {
                this.sketchCoords.push(pt);
                this._updateSketchSource();
                this._updateMetrics();
                const finishBtn = document.getElementById('btn-mapinfo-finish');
                if (finishBtn && this.sketchCoords.length >= 2) {
                    finishBtn.style.display = 'inline-block';
                }
                break;
            }
            case 'reshape': {
                this._handleReshapeClick(pt);
                break;
            }
            case 'addnode': {
                this._handleAddNodeClick(pt);
                break;
            }
            default:
                break;
        }
    }

    _onMouseMove(e) {
        if (this.sketchCoords.length === 0) return;
        const currentPt = [round6(e.lngLat.lng), round6(e.lngLat.lat)];
        let previewCoords = null;

        if (this.activeMode === 'rectangle' || this.activeMode === 'frame') {
            previewCoords = this._buildRectangleCoords(this.sketchCoords[0], currentPt);
        } else if (this.activeMode === 'roundrect') {
            previewCoords = this._buildRoundedRectCoords(this.sketchCoords[0], currentPt);
        } else if (this.activeMode === 'ellipse') {
            previewCoords = this._buildCircleCoords(this.sketchCoords[0], currentPt);
        } else if (this.activeMode === 'arc' && this.sketchCoords.length === 2) {
            previewCoords = this._buildArcCoords(this.sketchCoords[0], this.sketchCoords[1], currentPt);
        } else {
            previewCoords = [...this.sketchCoords, currentPt];
        }

        this._updateSketchSource(previewCoords);
        this._updateMetrics(previewCoords);
    }

    _onDblClick(e) {
        if (e && e.preventDefault) e.preventDefault();
        this.finishCurrentShape();
    }

    finishCurrentShape() {
        if (this.activeMode === 'polygon' || this.activeMode === 'draw') {
            // Remove duplicate consecutive end point from double click
            if (this.sketchCoords.length >= 2) {
                const last = this.sketchCoords[this.sketchCoords.length - 1];
                const prev = this.sketchCoords[this.sketchCoords.length - 2];
                if (Math.abs(last[0] - prev[0]) < 1e-6 && Math.abs(last[1] - prev[1]) < 1e-6) {
                    this.sketchCoords.pop();
                }
            }

            if (this.sketchCoords.length < 3) {
                alert('Vùng đa giác cần ít nhất 3 mốc đỉnh để khép góc!');
                return;
            }
            const closed = [...this.sketchCoords, this.sketchCoords[0]];
            this._addPolygonFeature(closed, 'Lô rừng mới');
            this.sketchCoords = [];
            this._updateSketchSource();
            const finishBtn = document.getElementById('btn-mapinfo-finish');
            if (finishBtn) finishBtn.style.display = 'none';
        } else if (this.activeMode === 'polyline') {
            if (this.sketchCoords.length >= 2) {
                const last = this.sketchCoords[this.sketchCoords.length - 1];
                const prev = this.sketchCoords[this.sketchCoords.length - 2];
                if (Math.abs(last[0] - prev[0]) < 1e-6 && Math.abs(last[1] - prev[1]) < 1e-6) {
                    this.sketchCoords.pop();
                }
            }
            if (this.sketchCoords.length >= 2) {
                this._addLineFeature(this.sketchCoords, 'Đường ranh giới');
                this.sketchCoords = [];
                this._updateSketchSource();
                const finishBtn = document.getElementById('btn-mapinfo-finish');
                if (finishBtn) finishBtn.style.display = 'none';
            }
        }
    }

    // Geometry feature builders
    _addPointFeature(coord) {
        const id = `pt_${Date.now()}`;
        this.drawnFeatures.push({
            type: 'Feature',
            id: id,
            geometry: { type: 'Point', coordinates: coord },
            properties: {
                id: id,
                type: 'point',
                name: 'Mốc ranh',
                pointColor: this.styles.symbol.color,
                pointSize: parseInt(this.styles.symbol.size) / 2
            }
        });
        this._refreshDrawnSource();
    }

    _addLineFeature(coords, name = 'Đoạn thẳng') {
        const id = `line_${Date.now()}`;
        const lenM = Math.round(this._calcPathDistance(coords));
        this.drawnFeatures.push({
            type: 'Feature',
            id: id,
            geometry: { type: 'LineString', coordinates: coords },
            properties: {
                id: id,
                name: name,
                type: 'line',
                strokeColor: this.styles.line.color,
                strokeWidth: parseFloat(this.styles.line.width),
                length_m: lenM
            }
        });
        this._refreshDrawnSource();
        this._showNotification(`✅ Đã vẽ ${name} (Chiều dài: ${lenM >= 1000 ? (lenM/1000).toFixed(2) + ' km' : lenM + ' m'})`);
    }

    _addPolygonFeature(coords, name = 'Lô rừng') {
        const id = `poly_${Date.now()}`;
        const areaM2 = this._calcPolygonArea(coords);
        const areaHa = parseFloat((areaM2 / 10000).toFixed(2));
        this.drawnFeatures.push({
            type: 'Feature',
            id: id,
            geometry: { type: 'Polygon', coordinates: [coords] },
            properties: {
                id: id,
                name: name,
                type: 'polygon',
                owner_name: name,
                area_ha: areaHa,
                area_m2: Math.round(areaM2),
                fillColor: this.styles.region.fillColor,
                fillOpacity: parseFloat(this.styles.region.fillOpacity),
                strokeColor: this.styles.region.strokeColor,
                strokeWidth: 2
            }
        });
        this._refreshDrawnSource();
        this._showNotification(`✅ Đã tạo ${name}: ${areaHa} ha (${Math.round(areaM2).toLocaleString('vi-VN')} m²)`);
    }

    _addTextMarker(coord, text) {
        if (!window.maplibregl || !this.map) return;
        const el = document.createElement('div');
        el.className = 'mapinfo-text-annotation';
        el.style.fontFamily = this.styles.text.font;
        el.style.fontSize = `${this.styles.text.size}px`;
        el.style.fontWeight = this.styles.text.bold ? '800' : '500';
        el.style.color = this.styles.text.color;
        el.style.background = 'rgba(15, 23, 42, 0.85)';
        el.style.border = '1px solid rgba(255, 255, 255, 0.35)';
        el.style.borderRadius = '4px';
        el.style.padding = '3px 8px';
        el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.6)';
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'move';
        el.style.userSelect = 'none';
        el.innerText = text;

        const marker = new window.maplibregl.Marker({ element: el, draggable: true })
            .setLngLat(coord)
            .addTo(this.map);

        this.textMarkers.push(marker);
        this._showNotification(`✅ Đã tạo nhãn chữ: "${text}" (kéo rê để di chuyển)`);
    }

    // Geometry calculations
    _buildRectangleCoords(p1, p2) {
        const minX = Math.min(p1[0], p2[0]);
        const maxX = Math.max(p1[0], p2[0]);
        const minY = Math.min(p1[1], p2[1]);
        const maxY = Math.max(p1[1], p2[1]);
        return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
    }

    _buildRoundedRectCoords(p1, p2) {
        const minX = Math.min(p1[0], p2[0]);
        const maxX = Math.max(p1[0], p2[0]);
        const minY = Math.min(p1[1], p2[1]);
        const maxY = Math.max(p1[1], p2[1]);
        const dx = (maxX - minX) * 0.15;
        const dy = (maxY - minY) * 0.15;

        return [
            [minX + dx, minY], [maxX - dx, minY],
            [maxX, minY + dy], [maxX, maxY - dy],
            [maxX - dx, maxY], [minX + dx, maxY],
            [minX, maxY - dy], [minX, minY + dy],
            [minX + dx, minY]
        ];
    }

    _buildCircleCoords(center, edgePt) {
        const radius = this._calcDistance(center, edgePt);
        const coords = [];
        const steps = 64;
        const R = 6378137.0; // WGS84 earth radius
        const dLat = (radius / R) * (180 / Math.PI);
        const dLon = dLat / Math.cos(center[1] * Math.PI / 180);

        for (let i = 0; i <= steps; i++) {
            const angle = (i * 2 * Math.PI) / steps;
            const x = center[0] + dLon * Math.cos(angle);
            const y = center[1] + dLat * Math.sin(angle);
            coords.push([round6(x), round6(y)]);
        }
        return coords;
    }

    _buildArcCoords(p1, p2, p3) {
        const coords = [];
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = (1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * p2[0] + t * t * p3[0];
            const y = (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * p2[1] + t * t * p3[1];
            coords.push([round6(x), round6(y)]);
        }
        return coords;
    }

    _updateSketchSource(previewCoords = null) {
        const coords = previewCoords || this.sketchCoords;
        if (!this.map || !this.map.getSource('editor-sketch')) return;

        const features = [];
        coords.forEach((c, idx) => {
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: c },
                properties: { index: idx }
            });
        });

        if (coords.length >= 2) {
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: {}
            });
        }

        if (coords.length >= 3 && (this.activeMode === 'polygon' || this.activeMode === 'draw' || this.activeMode === 'rectangle' || this.activeMode === 'ellipse' || this.activeMode === 'roundrect')) {
            const isClosed = (coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]);
            const ring = isClosed ? coords : [...coords, coords[0]];
            features.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [ring] },
                properties: {}
            });
        }

        this.map.getSource('editor-sketch').setData({
            type: 'FeatureCollection',
            features: features
        });
        this._bringLayersToTop();
    }

    _refreshDrawnSource() {
        if (!this.map || !this.map.getSource('mapinfo-drawing')) return;
        this.map.getSource('mapinfo-drawing').setData({
            type: 'FeatureCollection',
            features: this.drawnFeatures
        });
        this._bringLayersToTop();
        const subbar = document.getElementById('mapinfo-subbar');
        if (subbar && this.drawnFeatures.length > 0) {
            subbar.style.display = 'flex';
        }
    }

    _updateMetrics(coords = null) {
        const c = coords || this.sketchCoords;
        if (c.length < 2) {
            this._updateMetricsText('');
            return;
        }

        const lenM = Math.round(this._calcPathDistance(c));
        let text = `Chiều dài: <b>${lenM >= 1000 ? (lenM/1000).toFixed(2) + ' km' : lenM + ' m'}</b>`;

        if (c.length >= 3 && (this.activeMode === 'polygon' || this.activeMode === 'draw' || this.activeMode === 'rectangle' || this.activeMode === 'ellipse' || this.activeMode === 'roundrect')) {
            const areaM2 = this._calcPolygonArea(c);
            const areaHa = (areaM2 / 10000).toFixed(2);
            text += ` &nbsp;|&nbsp; Diện tích: <b>${areaHa} ha</b> (${Math.round(areaM2).toLocaleString('vi-VN')} m²)`;
        }

        this._updateMetricsText(text);
    }

    _updateMetricsText(html) {
        const metricsEl = document.getElementById('mapinfo-metrics');
        if (metricsEl) metricsEl.innerHTML = html;
    }

    _calcDistance(c1, c2) {
        const R = 6371000;
        const dLat = (c2[1] - c1[1]) * Math.PI / 180;
        const dLon = (c2[0] - c1[0]) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(c1[1] * Math.PI / 180) * Math.cos(c2[1] * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    _calcPathDistance(coords) {
        let total = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            total += this._calcDistance(coords[i], coords[i+1]);
        }
        return total;
    }

    _calcPolygonArea(coords) {
        let total = 0;
        if (coords.length > 2) {
            for (let i = 0; i < coords.length - 1; i++) {
                const p1 = coords[i];
                const p2 = coords[i + 1];
                total += (p2[0] - p1[0]) * Math.PI / 180 * (2 + Math.sin(p1[1] * Math.PI / 180) + Math.sin(p2[1] * Math.PI / 180));
            }
            total = total * 6378137.0 * 6378137.0 / 2.0;
        }
        return Math.abs(total);
    }

    // ==========================================
    // RESHAPE (SỬA ĐỈNH) & ADD NODE (THÊM ĐỈNH)
    // ==========================================
    _clearVertexMarkers() {
        if (this.vertexMarkers && this.vertexMarkers.length > 0) {
            this.vertexMarkers.forEach(m => m.remove());
            this.vertexMarkers = [];
        }
    }

    _handleReshapeClick(pt) {
        // Find nearest drawn feature
        let target = null;
        let minDist = Infinity;

        this.drawnFeatures.forEach(feat => {
            const geom = feat.geometry;
            if (geom.type === 'Polygon') {
                const ring = geom.coordinates[0];
                ring.forEach(c => {
                    const d = this._calcDistance(pt, c);
                    if (d < minDist) {
                        minDist = d;
                        target = feat;
                    }
                });
            } else if (geom.type === 'LineString') {
                geom.coordinates.forEach(c => {
                    const d = this._calcDistance(pt, c);
                    if (d < minDist) {
                        minDist = d;
                        target = feat;
                    }
                });
            }
        });

        if (target) {
            this.reshapeTarget = target;
            this._renderReshapeHandles(target);
            this._showNotification(`📌 Đã chọn đối tượng để sửa đỉnh. Kéo các mốc tròn màu xanh để nắn ranh giới.`);
        } else {
            this._showNotification(`Chưa chọn được đối tượng. Hãy nhấp gần một hình vừa vẽ trên bản đồ.`);
        }
    }

    _renderReshapeHandles(feature) {
        this._clearVertexMarkers();
        if (!feature || !this.map) return;

        const isPolygon = (feature.geometry.type === 'Polygon');
        const coords = isPolygon ? feature.geometry.coordinates[0] : feature.geometry.coordinates;

        coords.forEach((coord, idx) => {
            // For polygon, skip the closing duplicate point handle
            if (isPolygon && idx === coords.length - 1) return;

            const el = document.createElement('div');
            el.className = 'reshape-vertex-handle';
            el.title = `Đỉnh #${idx + 1} (Kéo để sửa ranh)`;

            const marker = new window.maplibregl.Marker({ element: el, draggable: true })
                .setLngLat(coord)
                .addTo(this.map);

            marker.on('drag', () => {
                const newPos = marker.getLngLat();
                const newCoord = [round6(newPos.lng), round6(newPos.lat)];
                coords[idx] = newCoord;

                if (isPolygon) {
                    if (idx === 0) coords[coords.length - 1] = newCoord;
                    const areaM2 = this._calcPolygonArea(coords);
                    feature.properties.area_ha = parseFloat((areaM2 / 10000).toFixed(2));
                    feature.properties.area_m2 = Math.round(areaM2);
                    this._updateMetricsText(`Diện tích sau nắn: <b>${feature.properties.area_ha} ha</b>`);
                } else {
                    const lenM = Math.round(this._calcPathDistance(coords));
                    feature.properties.length_m = lenM;
                    this._updateMetricsText(`Chiều dài sau nắn: <b>${lenM} m</b>`);
                }

                this._refreshDrawnSource();
            });

            marker.on('dragend', () => {
                this._showNotification(`Đã cập nhật vị trí đỉnh #${idx + 1}!`);
            });

            this.vertexMarkers.push(marker);
        });
    }

    _handleAddNodeClick(pt) {
        if (!this.reshapeTarget) {
            // Pick nearest feature first
            this._handleReshapeClick(pt);
            if (!this.reshapeTarget) return;
        }

        const feature = this.reshapeTarget;
        const isPolygon = (feature.geometry.type === 'Polygon');
        const coords = isPolygon ? feature.geometry.coordinates[0] : feature.geometry.coordinates;

        // Find closest line segment
        let bestIdx = -1;
        let bestDist = Infinity;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const d = this._distToSegment(pt, p1, p2);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }

        if (bestIdx !== -1) {
            coords.splice(bestIdx + 1, 0, pt);
            this._renderReshapeHandles(feature);
            this._refreshDrawnSource();
            this._showNotification(`➕ Đã chèn đỉnh mới vào giữa đỉnh #${bestIdx + 1} và #${bestIdx + 2}!`);
        }
    }

    _distToSegment(p, v, w) {
        const l2 = (w[0] - v[0]) * (w[0] - v[0]) + (w[1] - v[1]) * (w[1] - v[1]);
        if (l2 === 0) return this._calcDistance(p, v);
        let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
        return this._calcDistance(p, proj);
    }

    // ==========================================
    // STYLE MODAL INTERACTIONS
    // ==========================================
    toggleStyleModal(styleName) {
        const now = Date.now();
        if (this._lastStyleClick && now - this._lastStyleClick < 300 && this._lastStyleName === styleName) {
            return;
        }
        this._lastStyleClick = now;
        this._lastStyleName = styleName;

        const modalId = `modal-${styleName}-style`;
        const modal = document.getElementById(modalId);
        if (!modal) return;

        const isCurrentlyOpen = (modal.style.display === 'flex');
        this._closeAllStyleModals();
        if (!isCurrentlyOpen) {
            modal.style.display = 'flex';
        }
    }

    _closeAllStyleModals() {
        document.querySelectorAll('.mapinfo-style-popup').forEach(m => m.style.display = 'none');
    }

    applySymbolStyle() {
        const type = document.getElementById('mi-symbol-type')?.value || 'pin';
        const color = document.getElementById('mi-symbol-color')?.value || '#06b6d4';
        const size = document.getElementById('mi-symbol-size')?.value || '22';
        this.styles.symbol = { type, color, size };
        this._closeAllStyleModals();
        this._showNotification(`✅ Đã cập nhật Symbol Style: ${type} (${color})`);
    }

    applyLineStyle() {
        const type = document.getElementById('mi-line-type')?.value || 'solid';
        const color = document.getElementById('mi-line-color')?.value || '#0284c7';
        const width = document.getElementById('mi-line-width')?.value || '2';
        this.styles.line = { type, color, width };
        this._closeAllStyleModals();
        this._showNotification(`✅ Đã cập nhật Line Style: nét ${type} (${width}px)`);
    }

    applyRegionStyle() {
        const fillColor = document.getElementById('mi-region-fill-color')?.value || '#10b981';
        const fillOpacity = document.getElementById('mi-region-opacity')?.value || '0.35';
        const strokeColor = document.getElementById('mi-region-stroke-color')?.value || '#064e3b';
        this.styles.region = { fillColor, fillOpacity, strokeColor };
        this._closeAllStyleModals();
        this._showNotification(`✅ Đã cập nhật Region Style: tô màu ${fillColor}, độ mờ ${Math.round(fillOpacity * 100)}%`);
    }

    applyTextStyle() {
        const font = document.getElementById('mi-text-font')?.value || "'Plus Jakarta Sans', sans-serif";
        const size = document.getElementById('mi-text-size')?.value || '14';
        const color = document.getElementById('mi-text-color')?.value || '#ffffff';
        const bold = document.getElementById('mi-text-bold')?.checked ?? true;
        const halo = document.getElementById('mi-text-halo')?.checked ?? true;
        this.styles.text = { font, size, color, bold, halo };
        this._closeAllStyleModals();
        this._showNotification(`✅ Đã cập nhật Text Style!`);
    }

    async saveDrawn() {
        if (this.drawnFeatures.length === 0) {
            alert('Chưa có đối tượng nào được vẽ!');
            return;
        }

        // If user workspace is active, offer to save to user's private map
        if (window.userWorkspace && window.userWorkspace.currentMap && window.userWorkspace.token) {
            const currentMap = window.userWorkspace.currentMap;
            const choice = confirm(`Bạn muốn lưu ${this.drawnFeatures.length} đối tượng vẽ này thành một lớp cá nhân mới trên bản đồ [${currentMap.name}] không?\n(Bấm OK để tạo lớp riêng mới, hoặc Cancel để chọn lưu vào lớp có sẵn)`);
            if (choice) {
                const layerName = prompt('Nhập tên lớp bản đồ cá nhân mới:', `Vẽ đo đạc ${new Date().toLocaleDateString('vi-VN')}`);
                if (!layerName) return;

                const newGeojson = {
                    type: 'FeatureCollection',
                    features: this.drawnFeatures.map((feat, idx) => {
                        const newId = `LO-MI-${Date.now().toString().slice(-4)}-${idx + 1}`;
                        return {
                            type: 'Feature',
                            id: newId,
                            geometry: feat.geometry,
                            properties: {
                                id: newId,
                                owner_name: layerName,
                                area_ha: feat.properties.area_ha || 0.1,
                                area_m2: feat.properties.area_m2 || 1000,
                                province: currentMap.province || 'Quảng Ngãi',
                                district: 'Biên tập bản đồ riêng',
                                commune: 'Thực địa',
                                fm_status: 'FM_CERTIFIED',
                                sbp_status: 'SBP_COMPLIANT',
                                tree_species: 'Keo lai',
                                planting_year: 2024
                            }
                        };
                    })
                };

                try {
                    const res = await fetch(`/api/user/maps/${currentMap.id}/layers`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${window.userWorkspace.token}`
                        },
                        body: JSON.stringify({
                            name: layerName,
                            geojson_data: newGeojson,
                            source_type: 'Bản đồ cá nhân',
                            province: currentMap.province || 'Quảng Ngãi',
                            palette_color: '#10b981'
                        })
                    });
                    if (res.ok) {
                        alert(`✅ Đã tạo lớp bản đồ cá nhân [${layerName}] với ${this.drawnFeatures.length} đối tượng thành công!`);
                        this.drawnFeatures = [];
                        this._refreshDrawnSource();
                        this.cancel();
                        if (window.app && typeof window.app.loadLayersCatalog === 'function') {
                            await window.app.loadLayersCatalog();
                        }
                        return;
                    }
                } catch (e) {
                    console.error('Error saving user layer:', e);
                }
            }
        }

        let layers = [];
        try {
            const catalogRes = await fetch('/api/layers');
            if (catalogRes.ok) {
                layers = await catalogRes.json();
            }
        } catch (e) {}

        const vectorLayers = (layers || []).filter(l => l.format !== 'mbtiles');
        let targetLayerId = this.activeLayerId || (vectorLayers[0] ? vectorLayers[0].id : null);

        if (!targetLayerId) {
            alert('Chưa có lớp bản đồ vector nào trong hệ thống để lưu. Vui lòng nhập một lớp bản đồ trước!');
            return;
        }

        const targetLayerName = vectorLayers.find(l => l.id === targetLayerId)?.name || targetLayerId;
        const plotName = prompt(`Nhập tên chủ rừng / ghi chú để lưu ${this.drawnFeatures.length} đối tượng vào lớp [${targetLayerName}]:`, 'Lô bản đồ mới MapInfo');
        if (!plotName) return;

        try {
            const featRes = await fetch(`/api/layers/${targetLayerId}/features`);
            const geojson = await featRes.json();
            if (!geojson.features) geojson.features = [];

            this.drawnFeatures.forEach((feat, idx) => {
                const newId = `LO-MI-${Date.now().toString().slice(-4)}-${idx + 1}`;
                geojson.features.push({
                    type: 'Feature',
                    id: newId,
                    geometry: feat.geometry,
                    properties: {
                        id: newId,
                        owner_name: plotName,
                        area_ha: feat.properties.area_ha || 0.1,
                        area_m2: feat.properties.area_m2 || 1000,
                        province: 'Quảng Ngãi',
                        district: 'Biên tập MapInfo',
                        commune: 'Xã thực địa',
                        fm_status: 'FM_CERTIFIED',
                        sbp_status: 'SBP_COMPLIANT',
                        tree_species: 'Keo lai',
                        planting_year: 2024
                    }
                });
            });

            const saveRes = await fetch(`/api/layers/${targetLayerId}/save-features`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ geojson_data: geojson })
            });

            if (saveRes.ok) {
                alert(`✅ Đã lưu thành công ${this.drawnFeatures.length} đối tượng vào lớp bản đồ [${targetLayerName}]!`);
                this.drawnFeatures = [];
                this._refreshDrawnSource();
                this.cancel();
                if (window.app && typeof window.app.loadLayersCatalog === 'function') {
                    window.app.loadLayersCatalog();
                }
            } else {
                alert('❌ Lỗi khi lưu đối tượng vào máy chủ!');
            }
        } catch (err) {
            console.error('Error saving drawn features:', err);
            alert(`❌ Lỗi lưu đối tượng: ${err.message}`);
        }
    }

    _showNotification(msg) {
        const hintEl = document.getElementById('mapinfo-hint');
        if (hintEl) hintEl.innerHTML = msg;
    }
}

function round6(val) {
    return Math.round(val * 1000000) / 1000000;
}

window.gisEditor = new WebGISEditor();
