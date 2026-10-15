/**
 * Map Controller for Central Vietnam Forestry GIS
 * Uses MapLibre GL JS with Google Maps Satellite, Esri Imagery, OSM, and Opacity Controls.
 */

class MapController {
    constructor() {
        this.map = null;
        this.currentBasemap = 'google-sat';
        this.selectedPlotId = null;
        this.opacity = 0.75;
        this.plotsGeoJSON = null;

        this.googleApiKey = window.WEBGIS_CONFIG?.googleMapsApiKey || "";
        this.planetApiKey = ""; // Provider credentials stay on the server.

        this.provinceBoundariesVisible = true;
        this.highContrastBorders = true;

        this.mbtilesLayers = {};
        this.pendingMBTiles = [];
        this.vectorLayers = {};
        this.pendingVectors = [];
        this.catalogLayers = [];
        this.layerPalette = [
            { fill: '#10b981', border: '#059669', name: 'Xanh Rừng (Emerald)' },
            { fill: '#f59e0b', border: '#d97706', name: 'Hổ Phách (Amber)' },
            { fill: '#0ea5e9', border: '#0284c7', name: 'Xanh Lam (Cyan)' },
            { fill: '#8b5cf6', border: '#7c3aed', name: 'Tím Hoa Cà (Violet)' },
            { fill: '#f43f5e', border: '#e11d48', name: 'Đỏ Hồng (Rose)' },
            { fill: '#84cc16', border: '#65a30d', name: 'Xanh Chuối (Lime)' },
            { fill: '#eab308', border: '#ca8a04', name: 'Vàng Sáng (Yellow)' },
            { fill: '#06b6d4', border: '#0891b2', name: 'Xanh Ngọc (Teal)' }
        ];

        this.basemaps = {
            'nasa-daily': {
                name: 'NASA GIBS Chụp Hàng Ngày (Mới Hôm Qua/Nay)',
                tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${new Date(Date.now() - 86400000).toISOString().split('T')[0]}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`],
                tileSize: 256,
                maxzoom: 9,
                attribution: '© NASA GIBS EOSDIS (Ảnh vệ tinh Suomi NPP VIIRS 375m)'
            },
            'jrc-eudr-2020': {
                name: 'JRC Rừng EUDR 2020 (Ủy Ban Châu Âu)',
                tiles: ['/api/tiles/jrc-eudr/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© European Commission Joint Research Centre (JRC GFC 2020)'
            },
            'planet-latest': {
                name: 'Planet Vệ tinh Rừng Mới nhất (08/2026)',
                tiles: [`https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2026_08_mosaic/gmap/{z}/{x}/{y}.png?api_key=${this.planetApiKey}`],
                tileSize: 256,
                attribution: '© Planet Labs NICFI Forest Monitoring (Độ phân giải 3m)'
            },
            'planet-eudr-2020': {
                name: 'Planet Mốc EUDR (31/12/2020)',
                tiles: [`https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2020_12_mosaic/gmap/{z}/{x}/{y}.png?api_key=${this.planetApiKey}`],
                tileSize: 256,
                attribution: '© Planet Labs EUDR Baseline (Mốc chống phá rừng 31/12/2020)'
            },
            'sentinel2-daily': {
                name: 'Copernicus Sentinel-2 (Chụp theo ngày 30m) 🇪🇺',
                tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/2026-09-10/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png'],
                tileSize: 256,
                maxzoom: 12,
                attribution: '© ESA Copernicus Sentinel-2 MSI (NASA HLS 30m)'
            },
            'sentinel2-eudr-2020': {
                name: 'Sentinel-2 Không Mây (Mốc EUDR 2020)',
                tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
                tileSize: 256,
                attribution: '© Copernicus Sentinel-2 Cloudless by EOX (EUDR Baseline 2020)'
            },
            'sentinel2-latest': {
                name: 'Sentinel-2 Không Mây (Copernicus 2025)',
                tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'],
                tileSize: 256,
                attribution: '© Copernicus Sentinel-2 Cloudless by EOX (ESA 2025)'
            },
            'esri-wayback': {
                name: 'Esri Wayback Lịch Sử (2014 - 2026)',
                tiles: ['https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/49059/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: '© Esri Wayback World Imagery (Maxar)'
            },
            'google-sat': {
                name: 'Google Maps Vệ Tinh (Rõ nhất - Zoom 22 soi nhà, mộ)',
                tiles: [`https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=${this.googleApiKey}`],
                tileSize: 256,
                maxzoom: 22,
                attribution: '© Google Satellite'
            },
            'google-hybrid': {
                name: 'Google Hybrid (Vệ tinh + Tên đường, địa danh)',
                tiles: [`https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&key=${this.googleApiKey}`],
                tileSize: 256,
                maxzoom: 22,
                attribution: '© Google Maps'
            },
            'esri-sat': {
                name: 'Esri World Imagery (Độ nét cao 30cm)',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                maxzoom: 22,
                attribution: '© Esri, Maxar, Earthstar Geographics'
            },
            'osm': {
                name: 'OpenStreetMap (Giao thông)',
                tiles: [
                    'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
                    'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors, © CARTO'
            },
            'topo': {
                name: 'Địa hình (Đường bình độ)',
                tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenTopoMap'
            }
        };
    }

    init(containerId = 'map') {
        if (typeof maplibregl === 'undefined') {
            console.error('MapLibre GL JS library is not available.');
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#f87171; text-align:center; padding:20px;">
                        <div style="font-size:36px; margin-bottom:10px;">⚠️</div>
                        <b>Đang tải thư viện bản đồ MapLibre...</b>
                        <p style="font-size:12px; color:#94a3b8; margin-top:4px;">Vui lòng chờ giây lát hoặc nhấn F5 để tải lại.</p>
                    </div>
                `;
            }
            return;
        }
        // Initial center covers Quang Ngai, Binh Dinh, Phu Yen
        this.map = new maplibregl.Map({
            container: containerId,
            style: {
                version: 8,
                glyphs: 'data/fonts/{fontstack}/{range}.pbf',
                sources: {
                    'basemap-source': {
                        type: 'raster',
                        tiles: this.basemaps[this.currentBasemap].tiles,
                        tileSize: 256,
                        maxzoom: 22,
                        attribution: this.basemaps[this.currentBasemap].attribution
                    }
                },
                layers: [
                    {
                        id: 'basemap-layer',
                        type: 'raster',
                        source: 'basemap-source',
                        minzoom: 0,
                        maxzoom: 22
                    }
                ]
            },
            center: [108.68, 15.02],
            zoom: 10.5,
            maxZoom: 22,
            pitch: 0
        });

        // Add standard navigation controls
        this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

        this.mapLoaded = false;
        this.map.on('load', () => {
            this.mapLoaded = true;
            this._setupProvinceBoundariesLayer();
            this._setupPlotLayers();
            this._setupMapInteractions();
            this._setupViewportBboxStreaming();
            if (this.pendingMBTiles.length > 0) {
                this.pendingMBTiles.forEach(l => this.addMBTilesLayer(l));
                this.pendingMBTiles = [];
            }
            if (this.pendingVectors.length > 0) {
                this.pendingVectors.forEach(item => this.addVectorLayer(item.layer, item.color));
                this.pendingVectors = [];
            }
            if (window.gisEditor) window.gisEditor.init(this.map);
        });

        const updateCoordDisplay = (lng, lat) => {
            const coordEl = document.getElementById('cursor-coords');
            if (!coordEl) return;
            const prov = (window.VnGIS && window.VnGIS.detectProvince)
                ? window.VnGIS.detectProvince(lat, lng)
                : { name: 'Quảng Ngãi', kttStr: "108°00'", ktt: 108.0 };
            const vn = (window.VnGIS && window.VnGIS.wgs84ToVn2000)
                ? window.VnGIS.wgs84ToVn2000(lat, lng, prov.ktt)
                : { x: Math.round(lat * 110574), y: Math.round(500000 + (lng - 108.25) * 111320) };
            const currentZoom = this.map ? this.map.getZoom().toFixed(1) : '10.0';
            const isHighZoom = parseFloat(currentZoom) >= 18;

            coordEl.innerHTML = `
                <span class="coord-tag">📍 ${prov.name} (KTT ${prov.kttStr})</span>
                <span><b>X:</b> ${vn.x.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})} m</span>
                <span style="opacity: 0.35;">|</span>
                <span><b>Y:</b> ${vn.y.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})} m</span>
                <span style="opacity: 0.35;">—</span>
                <span>WGS84: ${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E</span>
                <span style="opacity: 0.35;">—</span>
                <span style="color: ${isHighZoom ? '#4ade80' : '#94a3b8'}; font-weight: ${isHighZoom ? '700' : '400'};">Zoom: ${currentZoom} ${isHighZoom ? '🔍 (Soi Mộ / Nhà)' : ''}</span>
            `;
        };

        this.map.on('mousemove', (e) => {
            updateCoordDisplay(e.lngLat.lng, e.lngLat.lat);
        });

        this.map.on('moveend', () => {
            const center = this.map.getCenter();
            updateCoordDisplay(center.lng, center.lat);
        });
    }

    setBasemap(key) {
        if (!this.basemaps[key] || !this.map) return;
        this.currentBasemap = key;
        const conf = this.basemaps[key];

        // Ensure underlying fallback satellite layer exists so transparent swath edges never show black
        if (!this.map.getSource('base-fallback-source')) {
            this.map.addSource('base-fallback-source', {
                type: 'raster',
                tiles: [`https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&key=${this.googleApiKey}`],
                tileSize: 256,
                maxzoom: 22
            });
            const firstLayer = (this.map.getStyle() && this.map.getStyle().layers && this.map.getStyle().layers[0]?.id);
            this.map.addLayer({
                id: 'base-fallback-layer',
                type: 'raster',
                source: 'base-fallback-source',
                minzoom: 0,
                maxzoom: 22
            }, firstLayer);
        }

        // Safely remove existing basemap layer and source
        if (this.map.getLayer('basemap-layer')) {
            this.map.removeLayer('basemap-layer');
        }
        if (this.map.getSource('basemap-source')) {
            this.map.removeSource('basemap-source');
        }

        // Add new raster source
        const sourceDef = {
            type: 'raster',
            tiles: conf.tiles,
            tileSize: conf.tileSize || 256,
            attribution: conf.attribution
        };
        if (conf.maxzoom !== undefined) {
            sourceDef.maxzoom = conf.maxzoom;
        }

        this.map.addSource('basemap-source', sourceDef);

        // Insert new basemap layer above fallback layer, but beneath all vector/plot layers
        const layers = (this.map.getStyle() && this.map.getStyle().layers) || [];
        const firstOtherLayer = layers.find(l => l.id !== 'basemap-layer' && l.id !== 'base-fallback-layer')?.id;
        this.map.addLayer({
            id: 'basemap-layer',
            type: 'raster',
            source: 'basemap-source',
            minzoom: 0,
            maxzoom: 22
        }, firstOtherLayer);
    }

    _setupPlotLayers() {
        if (!this.map.getSource('forestry-plots')) {
            this.map.addSource('forestry-plots', {
                type: 'geojson',
                data: this.plotsGeoJSON || { type: 'FeatureCollection', features: [] }
            });
        }

        // Highlight/Selection Outline Layer (Only active when a specific plot is selected)
        if (!this.map.getLayer('plots-highlight')) {
            this.map.addLayer({
                id: 'plots-highlight',
                type: 'line',
                source: 'forestry-plots',
                filter: ['==', 'id', ''],
                paint: {
                    'line-color': '#38bdf8',
                    'line-width': 4,
                    'line-blur': 1.5
                }
            });
        }
    }

    async _setupViewportBboxStreaming() {
        if (!this.map) return;

        let bboxDebounce = null;
        let isFetchingBbox = false;
        let districtBBoxes = null;

        // Load district bounding boxes
        try {
            const bRes = await fetch('data/quangngai_districts_bbox.json');
            if (bRes.ok) districtBBoxes = await bRes.json();
        } catch (e) {}

        this.quangNgaiDistrictBBoxes = districtBBoxes || {};

        const updateViewportPlots = async () => {
            if (!this.map || isFetchingBbox) return;
            const z = this.map.getZoom();

            // Check if layer_f3f5750f is active and visible
            const f3Layer = this.vectorLayers['layer_f3f5750f'];
            const isF3Visible = f3Layer ? f3Layer.visible !== false : true;

            const detailSourceId = 'vector-src-layer_f3f5750f-detail';
            const detailFillId = 'vector-fill-layer_f3f5750f-detail';
            const detailLineId = 'vector-line-layer_f3f5750f-detail';
            const detailSymId = 'vector-sym-layer_f3f5750f-detail';

            if (!isF3Visible || z < 9.0) {
                // When zoomed out, clear detail source so overview layer is clean
                if (this.map.getSource(detailSourceId)) {
                    this.map.getSource(detailSourceId).setData({ type: 'FeatureCollection', features: [] });
                }
                return;
            }

            const bounds = this.map.getBounds();
            const minx = bounds.getWest();
            const miny = bounds.getSouth();
            const maxx = bounds.getEast();
            const maxy = bounds.getNorth();

            // Check if bounds overlap Quang Ngai (108.2 to 109.2 lon, 14.5 to 15.5 lat)
            if (maxx < 108.2 || minx > 109.2 || maxy < 14.5 || miny > 15.5) {
                return;
            }

            isFetchingBbox = true;
            try {
                const url = `/api/layers/layer_f3f5750f/bbox?min_lon=${minx.toFixed(6)}&min_lat=${miny.toFixed(6)}&max_lon=${maxx.toFixed(6)}&max_lat=${maxy.toFixed(6)}&minx=${minx.toFixed(6)}&miny=${miny.toFixed(6)}&maxx=${maxx.toFixed(6)}&maxy=${maxy.toFixed(6)}&limit=15000`;
                const res = await fetch(url);
                if (!res.ok) return;
                const fc = await res.json();
                if (!fc || !fc.features) return;

                if (!this.map.getSource(detailSourceId)) {
                    this.map.addSource(detailSourceId, {
                        type: 'geojson',
                        data: fc
                    });

                    // Detail fill layer (Thematic forestry colors matching MapInfo)
                    this.map.addLayer({
                        id: detailFillId,
                        type: 'fill',
                        source: detailSourceId,
                        paint: {
                            'fill-color': ['coalesce', ['get', 'color'], '#15803d'],
                            'fill-opacity': 0.82
                        }
                    });

                    // Detail cadastral line layer (Crisp black boundaries matching MapInfo)
                    this.map.addLayer({
                        id: detailLineId,
                        type: 'line',
                        source: detailSourceId,
                        paint: {
                            'line-color': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                9, '#000000',
                                11, '#000000',
                                13.5, '#ffffff'
                            ],
                            'line-width': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                9, 0.5,
                                11, 0.9,
                                13, 1.8,
                                16, 2.5
                            ],
                            'line-opacity': 0.95
                        }
                    });

                    // Detail label layer (Open Sans Bold, Fractional Label)
                    this.map.addLayer({
                        id: detailSymId,
                        type: 'symbol',
                        source: detailSourceId,
                        minzoom: 13,
                        layout: {
                            'text-field': [
                                'case',
                                ['all', ['!=', ['get', 'owner_name'], ''], ['!=', ['get', 'lot'], '']],
                                ['concat', ['to-string', ['get', 'owner_name']], '\n-------------\n', ['to-string', ['get', 'lot']], ' (', ['to-string', ['get', 'area_ha']], ' ha)'],
                                ['!=', ['get', 'owner_name'], ''],
                                ['to-string', ['get', 'owner_name']],
                                ['to-string', ['get', 'id']]
                            ],
                            'text-font': ['Open Sans Bold'],
                            'text-size': 11,
                            'text-offset': [0, 0],
                            'text-anchor': 'center',
                            'text-justify': 'center',
                            'text-allow-overlap': true,
                            'text-ignore-placement': true,
                            'text-max-width': 25
                        },
                        paint: {
                            'text-color': '#fde047',
                            'text-halo-color': '#000000',
                            'text-halo-width': 2.0
                        }
                    });

                    this._setupVectorInteractions({ id: 'layer_f3f5750f', name: 'Bản đồ Quy hoạch LN tỉnh Quảng Ngãi' }, detailFillId);
                    this.bringBoundariesToFront();
                } else {
                    this.map.getSource(detailSourceId).setData(fc);
                    this.bringBoundariesToFront();
                }

                // If app sidebar is waiting for plots, update list count
                if (window.app && fc.features.length > 0) {
                    window.app._updateViewportPlotsSummary(fc.features);
                }
            } catch (err) {
                console.error('Error streaming viewport plots:', err);
            } finally {
                isFetchingBbox = false;
            }
        };

        this.updateViewportPlots = updateViewportPlots;

        this.map.on('moveend', () => {
            clearTimeout(bboxDebounce);
            bboxDebounce = setTimeout(updateViewportPlots, 300);
        });

        // Trigger on initial load
        setTimeout(updateViewportPlots, 1200);
    }

    zoomToDistrict(districtName) {
        if (!this.map) return;
        if (!districtName) {
            // Zoom back to full Quang Ngai
            this.fitBounds([108.2349, 14.5323, 109.1462, 15.4333], { padding: 40 });
            if (this.updateViewportPlots) setTimeout(this.updateViewportPlots, 600);
            return;
        }

        const bboxes = this.quangNgaiDistrictBBoxes || {};
        const bbox = bboxes[districtName];
        if (bbox && bbox.length >= 4) {
            this.fitBounds(bbox, { padding: 45 });
            if (this.updateViewportPlots) setTimeout(this.updateViewportPlots, 600);
        }
    }

    _setupMapInteractions() {
        // Map-wide click or selection interactions
    }

    updatePlotsData(geojsonData) {
        this.plotsGeoJSON = geojsonData;
        if (this.map && this.map.getSource('forestry-plots')) {
            this.map.getSource('forestry-plots').setData(geojsonData);
        }
    }

    setLayerOpacity(val) {
        this.opacity = parseFloat(val);
        if (this.map && this.map.getLayer('plots-fill')) {
            this.map.setPaintProperty('plots-fill', 'fill-opacity', this.opacity);
        }
        Object.keys(this.vectorLayers).forEach(lid => {
            const fid = `vector-fill-${lid}`;
            if (this.map && this.map.getLayer(fid)) {
                this.map.setPaintProperty(fid, 'fill-opacity', this.opacity);
            }
        });
        Object.keys(this.mbtilesLayers).forEach(lid => {
            this.setMBTilesOpacity(lid, this.opacity);
        });
    }

    setSingleLayerOpacity(layerId, opacity) {
        if (!this.map) return;
        const val = parseFloat(opacity);
        const fillId = `vector-fill-${layerId}`;
        if (this.map.getLayer(fillId)) {
            this.map.setPaintProperty(fillId, 'fill-opacity', val);
        }
        if (this.vectorLayers[layerId]) {
            this.vectorLayers[layerId].opacity = val;
        }
        if (this.mbtilesLayers[layerId]) {
            this.setMBTilesOpacity(layerId, val);
        }
    }

    selectPlot(plotId) {
        this.selectedPlotId = plotId;
        if (this.map && this.map.getLayer('plots-highlight')) {
            this.map.setFilter('plots-highlight', ['==', 'id', plotId]);
        }
    }

    flyToPlot(coords, zoom = 14.5) {
        if (!this.map) return;
        this.map.flyTo({
            center: coords,
            zoom: zoom,
            speed: 1.4,
            curve: 1.2,
            essential: true
        });
    }

    async _setupProvinceBoundariesLayer() {
        if (!this.map) return;
        const polySourceId = 'province-boundaries-src';
        const linesSourceId = 'province-boundaries-lines-src';

        try {
            // Pre-fetch GeoJSON to ensure instant availability or fallback to URL
            let polyData = 'data/provinces_boundaries.geojson';
            let lineData = 'data/provinces_boundaries_lines.geojson';

            try {
                const resP = await fetch('data/provinces_boundaries.geojson');
                if (resP.ok) polyData = await resP.json();
            } catch (e) {
                console.warn('Fallback to URL for province polygons:', e);
            }

            try {
                const resL = await fetch('data/provinces_boundaries_lines.geojson');
                if (resL.ok) lineData = await resL.json();
            } catch (e) {
                console.warn('Fallback to URL for province lines:', e);
            }

            // 1. Add Polygon Source for Fill & Labels
            if (!this.map.getSource(polySourceId)) {
                this.map.addSource(polySourceId, {
                    type: 'geojson',
                    data: polyData
                });
            } else if (typeof polyData === 'object') {
                this.map.getSource(polySourceId).setData(polyData);
            }

            // 2. Add Dedicated Lines Source for High-Contrast Boundaries
            if (!this.map.getSource(linesSourceId)) {
                this.map.addSource(linesSourceId, {
                    type: 'geojson',
                    data: lineData
                });
            } else if (typeof lineData === 'object') {
                this.map.getSource(linesSourceId).setData(lineData);
            }

            // 1. Province Fill Layer (subtle tint with province color)
            try {
                if (!this.map.getLayer('province-boundaries-fill')) {
                    this.map.addLayer({
                        id: 'province-boundaries-fill',
                        type: 'fill',
                        source: polySourceId,
                        paint: {
                            'fill-color': [
                                'match',
                                ['get', 'code'],
                                'QNG', '#10b981',
                                'BDH', '#f59e0b',
                                'PYE', '#0ea5e9',
                                '#38bdf8'
                            ],
                            'fill-opacity': 0.10
                        }
                    });
                }
            } catch (err) { console.error('Error adding province fill:', err); }

            // 2. Black Outer Casing (Subtle dark outline for high contrast on any basemap)
            try {
                if (!this.map.getLayer('province-boundaries-casing')) {
                    this.map.addLayer({
                        id: 'province-boundaries-casing',
                        type: 'line',
                        source: linesSourceId,
                        paint: {
                            'line-color': '#000000',
                            'line-width': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                6, 4.0,
                                9, 6.5,
                                12, 9.0,
                                15, 12.0
                            ],
                            'line-opacity': 0.95
                        }
                    });
                }
            } catch (err) { console.error('Error adding province casing:', err); }

            // 3. Outer Glow Line Layer (Vivid glow matching province color)
            try {
                if (!this.map.getLayer('province-boundaries-glow')) {
                    this.map.addLayer({
                        id: 'province-boundaries-glow',
                        type: 'line',
                        source: linesSourceId,
                        paint: {
                            'line-color': [
                                'match',
                                ['get', 'code'],
                                'QNG', '#fbbf24',
                                'BDH', '#38bdf8',
                                'PYE', '#f43f5e',
                                '#ffffff'
                            ],
                            'line-width': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                6, 6.0,
                                9, 10.0,
                                12, 14.0,
                                15, 20.0
                            ],
                            'line-opacity': 0.50,
                            'line-blur': 3.5
                        }
                    });
                }
            } catch (err) { console.error('Error adding province glow:', err); }

            // 4. Crisp High-Contrast Inner Cadastral Boundary Line
            try {
                if (!this.map.getLayer('province-boundaries-line')) {
                    this.map.addLayer({
                        id: 'province-boundaries-line',
                        type: 'line',
                        source: linesSourceId,
                        paint: {
                            'line-color': [
                                'match',
                                ['get', 'code'],
                                'QNG', '#fef08a', // Vivid bright yellow
                                'BDH', '#bae6fd', // Vivid bright cyan/white
                                'PYE', '#fecdd3', // Vivid bright rose/white
                                '#ffffff'
                            ],
                            'line-width': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                6, 2.2,
                                9, 3.5,
                                12, 5.0,
                                15, 6.5
                            ],
                            'line-opacity': 1.0,
                            'line-dasharray': [8, 4]
                        }
                    });
                }
            } catch (err) { console.error('Error adding province line:', err); }

            // 5. Province Name Label
            try {
                if (!this.map.getLayer('province-boundaries-label')) {
                    this.map.addLayer({
                        id: 'province-boundaries-label',
                        type: 'symbol',
                        source: polySourceId,
                        layout: {
                            'text-field': ['concat', 'TỈNH ', ['upcase', ['coalesce', ['get', 'name'], '']]],
                            'text-font': ['Open Sans Bold'],
                            'text-size': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                6, 12,
                                9, 15,
                                12, 18,
                                15, 22
                            ],
                            'text-letter-spacing': 0.08,
                            'text-anchor': 'center',
                            'text-allow-overlap': true,
                            'text-ignore-placement': true
                        },
                        paint: {
                            'text-color': '#ffffff',
                            'text-halo-color': '#090d16',
                            'text-halo-width': 4.0
                        }
                    });
                }
            } catch (err) { console.error('Error adding province label:', err); }

            this.bringBoundariesToFront();

            if (this.pendingProvinceFilter) {
                this.highlightProvince(this.pendingProvinceFilter);
                this.pendingProvinceFilter = null;
            } else {
                this.highlightProvince(this.currentProvinceFilter || 'ALL');
            }
        } catch (e) {
            console.error('Error loading province boundaries:', e);
        }
    }

    highlightProvince(provCode) {
        const targetCode = (provCode || 'ALL').toUpperCase();
        this.currentProvinceFilter = targetCode;

        if (!this.map || !this.mapLoaded || (!this.map.getSource('province-boundaries-lines-src') && !this.map.getSource('province-boundaries-src'))) {
            this.pendingProvinceFilter = targetCode;
            this.focusProvinceCenter(targetCode);
            return;
        }

        const bboxes = {
            'ALL': [108.15, 12.65, 109.50, 15.50],
            'QNG': [108.2336, 14.5341, 109.1416, 15.4338],
            'BDH': [108.6001, 13.5177, 109.3706, 14.6991],
            'PYE': [108.6723, 12.7070, 109.4578, 13.6953]
        };

        if (targetCode === 'ALL') {
            // Show all 3 provinces
            if (this.map.getLayer('province-boundaries-fill')) {
                this.map.setFilter('province-boundaries-fill', null);
                this.map.setPaintProperty('province-boundaries-fill', 'fill-opacity', 0.08);
                this.map.setLayoutProperty('province-boundaries-fill', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-casing')) {
                this.map.setFilter('province-boundaries-casing', null);
                this.map.setLayoutProperty('province-boundaries-casing', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-line')) {
                this.map.setFilter('province-boundaries-line', null);
                this.map.setLayoutProperty('province-boundaries-line', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-glow')) {
                this.map.setFilter('province-boundaries-glow', null);
                this.map.setLayoutProperty('province-boundaries-glow', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-label')) {
                this.map.setFilter('province-boundaries-label', null);
                this.map.setLayoutProperty('province-boundaries-label', 'visibility', 'visible');
            }
            this.bringBoundariesToFront();
            this.fitBounds(bboxes['ALL'], { padding: 40 });
        } else {
            // Highlight specific province
            const filter = ['==', 'code', targetCode];
            if (this.map.getLayer('province-boundaries-fill')) {
                this.map.setFilter('province-boundaries-fill', filter);
                this.map.setPaintProperty('province-boundaries-fill', 'fill-opacity', 0.16);
                this.map.setLayoutProperty('province-boundaries-fill', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-casing')) {
                this.map.setFilter('province-boundaries-casing', filter);
                this.map.setLayoutProperty('province-boundaries-casing', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-line')) {
                this.map.setFilter('province-boundaries-line', filter);
                this.map.setLayoutProperty('province-boundaries-line', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-glow')) {
                this.map.setFilter('province-boundaries-glow', filter);
                this.map.setLayoutProperty('province-boundaries-glow', 'visibility', 'visible');
            }
            if (this.map.getLayer('province-boundaries-label')) {
                this.map.setFilter('province-boundaries-label', filter);
                this.map.setLayoutProperty('province-boundaries-label', 'visibility', 'visible');
            }
            this.bringBoundariesToFront();

            const targetBBox = bboxes[targetCode];
            if (targetBBox) {
                this.fitBounds(targetBBox, { padding: 45 });
            }
        }
    }

    focusProvince(provCode) {
        this.highlightProvince(provCode);
    }

    bringBoundariesToFront() {
        if (!this.map) return;
        const bLayers = [
            'province-boundaries-casing',
            'province-boundaries-glow',
            'province-boundaries-line',
            'province-boundaries-label'
        ];
        bLayers.forEach(id => {
            if (this.map.getLayer(id)) {
                try { this.map.moveLayer(id); } catch (e) {}
            }
        });
    }

    toggleProvinceBoundaries(visible) {
        if (visible === undefined) {
            this.provinceBoundariesVisible = !this.provinceBoundariesVisible;
        } else {
            this.provinceBoundariesVisible = !!visible;
        }
        const val = this.provinceBoundariesVisible ? 'visible' : 'none';
        ['province-boundaries-fill', 'province-boundaries-casing', 'province-boundaries-glow', 'province-boundaries-line', 'province-boundaries-label'].forEach(id => {
            if (this.map && this.map.getLayer(id)) {
                this.map.setLayoutProperty(id, 'visibility', val);
            }
        });
        if (this.provinceBoundariesVisible) {
            this.bringBoundariesToFront();
        }
        return this.provinceBoundariesVisible;
    }

    togglePlotContrastBorders(highContrast) {
        if (highContrast === undefined) {
            this.highContrastBorders = (this.highContrastBorders === undefined) ? false : !this.highContrastBorders;
        } else {
            this.highContrastBorders = !!highContrast;
        }
        Object.keys(this.vectorLayers).forEach(layerId => {
            const lineId = `vector-line-${layerId}`;
            if (this.map && this.map.getLayer(lineId)) {
                const palette = this.vectorLayers[layerId]?.palette;
                const color = this.highContrastBorders ? '#ffffff' : (palette ? palette.border : '#ffffff');
                const width = this.highContrastBorders ? 2.5 : 1.8;
                this.map.setPaintProperty(lineId, 'line-color', color);
                this.map.setPaintProperty(lineId, 'line-width', width);
            }
        });
        this.bringBoundariesToFront();
        return this.highContrastBorders;
    }

    focusProvince(provCode) {
        this.highlightProvince(provCode);
    }

    focusProvinceCenter(provCode) {
        const centers = {
            'QNG': { center: [108.62, 14.88], zoom: 9.6 },
            'BDH': { center: [108.98, 14.15], zoom: 9.6 },
            'PYE': { center: [108.96, 13.15], zoom: 9.6 },
            'ALL': { center: [108.85, 14.1], zoom: 8.2 }
        };
        const target = centers[provCode] || centers['ALL'];
        this.map.flyTo({
            center: target.center,
            zoom: target.zoom,
            speed: 1.2,
            essential: true
        });
    }

    fitBounds(bbox, options = {}) {
        if (!this.map || !bbox || bbox.length < 4) return;
        this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
            padding: options.padding || 50,
            duration: 1500,
            maxZoom: options.maxZoom || 16,
            essential: true
        });
    }

    toggle3D() {
        if (!this.map) return;
        const btn = document.getElementById('btn-toggle-3d');

        if (!this.is3DActive) {
            // Enable 3D Terrain
            if (!this.map.getSource('terrain-dem')) {
                this.map.addSource('terrain-dem', {
                    type: 'raster-dem',
                    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    encoding: 'terrarium',
                    maxzoom: 15
                });
            }
            this.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.6 });
            this.map.easeTo({ pitch: 62, bearing: 25, duration: 1500 });
            this.is3DActive = true;
            if (btn) {
                btn.classList.add('active');
                btn.innerHTML = '⛰️ Đang 3D (Bấm về 2D)';
            }
        } else {
            // Disable 3D Terrain
            this.map.setTerrain(null);
            this.map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
            this.is3DActive = false;
            if (btn) {
                btn.classList.remove('active');
                btn.innerHTML = '🏔️ Bản Đồ 3D Núi Đồi';
            }
        }
    }

    toggleContours() {
        if (!this.map) return;
        const btn = document.getElementById('btn-toggle-contours');

        if (!this.contoursActive) {
            if (!this.map.getSource('contours-source')) {
                this.map.addSource('contours-source', {
                    type: 'raster',
                    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
                    tileSize: 256
                });
            }
            if (!this.map.getLayer('contours-layer')) {
                const beforeLayer = this.map.getLayer('plots-fill') ? 'plots-fill' : undefined;
                this.map.addLayer({
                    id: 'contours-layer',
                    type: 'raster',
                    source: 'contours-source',
                    paint: {
                        'raster-opacity': 0.45
                    }
                }, beforeLayer);
            } else {
                this.map.setLayoutProperty('contours-layer', 'visibility', 'visible');
            }
            this.contoursActive = true;
            if (btn) {
                btn.classList.add('active');
                btn.innerHTML = '📈 Đường Bình Độ: BẬT';
            }
        } else {
            if (this.map.getLayer('contours-layer')) {
                this.map.setLayoutProperty('contours-layer', 'visibility', 'none');
            }
            this.contoursActive = false;
            if (btn) {
                btn.classList.remove('active');
                btn.innerHTML = '📉 Đường Bình Độ (10m)';
            }
        }
    }

    setTimelinePlanet(year, month) {
        const mStr = String(month).padStart(2, '0');
        const mosaicName = `global_monthly_${year}_${mStr}_mosaic`;
        const tileUrl = `https://tiles.planet.com/basemaps/v1/planet-tiles/${mosaicName}/gmap/{z}/{x}/{y}.png?api_key=${this.planetApiKey}`;

        this.basemaps['planet-timeline'] = {
            name: `Planet Vệ Tinh (Tháng ${mStr}/${year})`,
            tiles: [tileUrl],
            tileSize: 256,
            attribution: `© Planet Labs NICFI Monitoring (${mStr}/${year})`
        };

        this.setBasemap('planet-timeline');
    }

    setTimelineSentinel(year) {
        const tileUrl = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg`;

        this.basemaps['sentinel-timeline'] = {
            name: `Sentinel-2 Không Mây (Năm ${year})`,
            tiles: [tileUrl],
            tileSize: 256,
            attribution: `© Copernicus Sentinel-2 Cloudless by EOX (ESA ${year})`
        };

        this.setBasemap('sentinel-timeline');
    }

    setTimelineSentinelDaily(dateStr) {
        const tileUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/${dateStr}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`;

        this.basemaps['sentinel2-daily-timeline'] = {
            name: `Copernicus Sentinel-2 (Ngày ${dateStr})`,
            tiles: [tileUrl],
            tileSize: 256,
            maxzoom: 12,
            attribution: `© ESA Copernicus Sentinel-2 MSI (${dateStr})`
        };

        this.setBasemap('sentinel2-daily-timeline');
    }

    setTimelineNasa(dateStr) {
        // Fallback safety: NASA GIBS global daily composite takes ~12-24h to compile.
        // Today's orbital pass is not yet compiled and NASA returns black (0,0,0) placeholder tiles.
        // Automatically clamp to yesterday's date if today or future date is requested.
        const todayStr = new Date().toISOString().split('T')[0];
        const safeDate = (dateStr >= todayStr) 
            ? new Date(Date.now() - 86400000).toISOString().split('T')[0] 
            : dateStr;

        const tileUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${safeDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;

        this.basemaps['nasa-timeline'] = {
            name: `NASA GIBS (Ngày ${safeDate})`,
            tiles: [tileUrl],
            tileSize: 256,
            maxzoom: 9,
            attribution: `© NASA EOSDIS GIBS VIIRS (${safeDate})`
        };

        this.setBasemap('nasa-timeline');
    }

    setTimelineWayback(releaseM, label) {
        const tileUrl = `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${releaseM}/{z}/{y}/{x}`;

        this.basemaps['wayback-timeline'] = {
            name: `Esri Wayback (${label})`,
            tiles: [tileUrl],
            tileSize: 256,
            attribution: `© Esri Wayback World Imagery (${label})`
        };

        this.setBasemap('wayback-timeline');
    }

    // ==========================================
    // VECTOR & RASTER LAYER CATALOG MANAGEMENT
    // ==========================================
    async syncCatalogLayers(catalogLayers) {
        if (!Array.isArray(catalogLayers)) return;
        this.catalogLayers = catalogLayers;

        // 1. Sync MBTiles raster layers
        this.syncMBTilesLayers(catalogLayers);

        // 2. Sync Vector layers (Shapefile, MapInfo, KML, GeoJSON)
        const vectorCatalog = catalogLayers.filter(l => l.format !== 'mbtiles');
        const activeIds = new Set(vectorCatalog.map(l => l.id));

        // Remove layers no longer in catalog
        Object.keys(this.vectorLayers).forEach(lid => {
            if (!activeIds.has(lid)) {
                this.removeVectorLayer(lid);
            }
        });

        // Add or update each vector layer with distinctive palette color
        for (let i = 0; i < vectorCatalog.length; i++) {
            const layer = vectorCatalog[i];
            const color = this.layerPalette[i % this.layerPalette.length];
            await this.addVectorLayer(layer, color);
        }

        // Auto-center and fit to the user's uploaded layers
        if (vectorCatalog.length > 0) {
            this.fitAllLayers();
        }
    }

    async addVectorLayer(layer, color = null) {
        const palette = color || this.layerPalette[0];

        if (!this.map || !this.mapLoaded) {
            this.pendingVectors.push({ layer, color: palette });
            return;
        }

        const sourceId = `vector-src-${layer.id}`;
        const fillId = `vector-fill-${layer.id}`;
        const lineId = `vector-line-${layer.id}`;
        const symId = `vector-sym-${layer.id}`;

        try {
            if (!this.map.getSource(sourceId)) {
                let geojson = null;
                if (layer.is_private) {
                    try {
                        const token = (window.userWorkspace && window.userWorkspace.token) ? window.userWorkspace.token : '';
                        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                        const privRes = await fetch(`/api/user/layers/${layer.id}/features`, { headers });
                        if (privRes.ok) geojson = await privRes.json();
                    } catch (e) {}
                    if (!geojson && layer.geojson_data) {
                        geojson = layer.geojson_data;
                    }
                }
                if (!geojson) {
                    try {
                        const res = await fetch(`/api/layers/${layer.id}/features`);
                        if (res.ok) geojson = await res.json();
                    } catch (e) {}
                }
                if (!geojson) {
                    const targetFile = layer.overview_file || layer.geojson_file || `${layer.id}.geojson`;
                    try {
                        const res2 = await fetch(`data/layers/${targetFile}`);
                        if (res2.ok) geojson = await res2.json();
                    } catch (e) {}
                }
                if (!geojson) throw new Error(`Could not load features for layer ${layer.id}`);

                if (!window.layerDataCache) window.layerDataCache = {};
                window.layerDataCache[layer.id] = geojson;

                this.map.addSource(sourceId, {
                    type: 'geojson',
                    data: geojson
                });
            }

            // Fill Layer
            if (!this.map.getLayer(fillId)) {
                let lyrOpacity = (layer.opacity !== undefined) ? layer.opacity : this.opacity;
                if (window.app && window.app.layerOpacities && window.app.layerOpacities[layer.id] !== undefined) {
                    lyrOpacity = window.app.layerOpacities[layer.id];
                } else {
                    try {
                        const saved = localStorage.getItem('layer_opacity_' + layer.id);
                        if (saved !== null) lyrOpacity = parseFloat(saved);
                    } catch (e) {}
                }

                let fillColor = palette.fill;
                if (layer.id === 'layer_f3f5750f') {
                    fillColor = ['coalesce', ['get', 'color'], '#15803d'];
                }

                this.map.addLayer({
                    id: fillId,
                    type: 'fill',
                    source: sourceId,
                    paint: {
                        'fill-color': fillColor,
                        'fill-opacity': lyrOpacity
                    }
                });
            }

            // High-contrast Border Line Layer
            if (!this.map.getLayer(lineId)) {
                let lineColor = [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    8, palette.border,
                    11.5, palette.border,
                    12.5, '#ffffff'
                ];
                let lineWidth = [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    8, 0.7,
                    11, 1.2,
                    13, 2.2,
                    16, 3.0
                ];

                if (layer.id === 'layer_f3f5750f') {
                    lineColor = [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        8, '#000000',
                        11, '#000000',
                        13.5, '#ffffff'
                    ];
                    lineWidth = [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        8, 0.4,
                        10, 0.7,
                        12, 1.3,
                        14, 1.9,
                        16, 2.6
                    ];
                }

                this.map.addLayer({
                    id: lineId,
                    type: 'line',
                    source: sourceId,
                    paint: {
                        'line-color': lineColor,
                        'line-width': lineWidth,
                        'line-opacity': 0.95
                    }
                });
            }

            // Symbol Label Layer
            if (!this.map.getLayer(symId)) {
                const labelConf = this.getFractionalLabelConfig(layer.id);
                let initialTextField = [
                    'coalesce',
                    ['get', 'owner_name'],
                    ['get', 'chu_rung'],
                    ['get', 'id'],
                    ['get', 'ma_lo'],
                    ['get', 'Name'],
                    'Lô rừng'
                ];
                let initialMinZoom = 11;
                let initialTextSize = 11;
                let initialTextColor = '#ffffff';
                let initialHaloColor = '#000000';
                let initialHaloWidth = 2.0;
                let initialVisibility = 'visible';

                if (labelConf) {
                    if (labelConf.enabled === false) {
                        initialVisibility = 'none';
                    } else {
                        const customExpr = this.buildFractionalLabelExpression(labelConf);
                        if (customExpr) initialTextField = customExpr;
                        if (labelConf.fontSize) initialTextSize = parseInt(labelConf.fontSize, 10);
                        if (labelConf.textColor) initialTextColor = labelConf.textColor;
                        if (labelConf.minZoom) initialMinZoom = parseInt(labelConf.minZoom, 10);
                        if (labelConf.haloStyle === 'black-thick') {
                            initialHaloColor = '#000000';
                            initialHaloWidth = 2.0;
                        } else if (labelConf.haloStyle === 'black-medium') {
                            initialHaloColor = '#000000';
                            initialHaloWidth = 1.5;
                        } else if (labelConf.haloStyle === 'white-thick') {
                            initialHaloColor = '#ffffff';
                            initialHaloWidth = 2.0;
                        } else if (labelConf.haloStyle === 'none') {
                            initialHaloColor = 'transparent';
                            initialHaloWidth = 0;
                        }
                    }
                }

                this.map.addLayer({
                    id: symId,
                    type: 'symbol',
                    source: sourceId,
                    minzoom: initialMinZoom,
                    layout: {
                        'text-field': initialTextField,
                        'text-font': ['Open Sans Bold'],
                        'text-size': initialTextSize,
                        'text-offset': [0, 0],
                        'text-anchor': 'center',
                        'text-justify': 'center',
                        'text-allow-overlap': true,
                        'text-ignore-placement': true,
                        'text-max-width': 30,
                        'visibility': initialVisibility
                    },
                    paint: {
                        'text-color': initialTextColor,
                        'text-halo-color': initialHaloColor,
                        'text-halo-width': initialHaloWidth
                    }
                });
            }

            this._setupVectorInteractions(layer, fillId);

            this.vectorLayers[layer.id] = {
                meta: layer,
                color: palette,
                palette: palette,
                visible: true
            };
            this.bringBoundariesToFront();
        } catch (err) {
            console.error(`Error loading vector layer ${layer.id}:`, err);
        }
    }

    _setupVectorInteractions(layer, fillId) {
        if (!this.vectorPopups) {
            this.vectorPopups = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                offset: 12
            });
        }

        this.map.on('mouseenter', fillId, (e) => {
            if (window.gisEditor && window.gisEditor.activeMode) {
                this.map.getCanvas().style.cursor = (window.gisEditor.activeMode === 'reshape' || window.gisEditor.activeMode === 'addnode') ? 'pointer' : 'crosshair';
                if (this.vectorPopups) this.vectorPopups.remove();
                return;
            }
            this.map.getCanvas().style.cursor = 'pointer';
            if (e.features && e.features.length > 0) {
                const f = e.features[0];
                const props = f.properties || {};
                const toUni = (v) => (window.VnGIS && typeof v === 'string') ? window.VnGIS.tcvn3ToUnicode(v) : (v || '');
                const rawName = props.owner_name || props.chu_rung || props.Name || props.id || 'Thửa đất';
                const name = toUni(rawName);
                const area = props.area_ha || props.dien_tich || props.dtich_km2 ? `${(props.area_ha || props.dien_tich || (props.dtich_km2 * 100)).toFixed(2)} ha` : '-';
                const lot = toUni(props.lot || props.so_thua || props.lo || '-');
                const commune = toUni(props.commune || props.xa || '');
                const district = toUni(props.district || props.huyen || '');
                const layerTitle = toUni(layer.name);

                this.vectorPopups.setLngLat(e.lngLat)
                    .setHTML(`
                        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:12px;color:#1e293b;padding:6px;max-width:250px;">
                            <div style="font-weight:800;font-size:13px;color:#0f172a;margin-bottom:4px;border-bottom:1px solid #e2e8f0;padding-bottom:3px;">
                                📁 ${layerTitle}
                            </div>
                            <div style="font-weight:700;color:#0284c7;margin-bottom:3px;">${name}</div>
                            <div><b>Số thửa / Lô:</b> ${lot}</div>
                            <div><b>Diện tích:</b> ${area}</div>
                            ${commune || district ? `<div><b>Vị trí:</b> ${commune}, ${district}</div>` : ''}
                            <div style="margin-top:4px;font-size:10px;color:#64748b;">Nguồn: ${layer.source_type}</div>
                        </div>
                    `)
                    .addTo(this.map);
            }
        });

        this.map.on('mouseleave', fillId, () => {
            if (window.gisEditor && window.gisEditor.activeMode) {
                this.map.getCanvas().style.cursor = (window.gisEditor.activeMode === 'reshape' || window.gisEditor.activeMode === 'addnode') ? 'pointer' : 'crosshair';
                if (this.vectorPopups) this.vectorPopups.remove();
                return;
            }
            this.map.getCanvas().style.cursor = '';
            if (this.vectorPopups) this.vectorPopups.remove();
        });

        this.map.on('click', fillId, (e) => {
            if (window.gisEditor && window.gisEditor.activeMode) {
                // In GIS Editor drawing/editing mode: do not trigger plot sidebar
                return;
            }
            if (e.features && e.features.length > 0) {
                const f = e.features[0];
                const props = f.properties || {};
                const plotId = props.id || props.ID || props.so_thua || props.thuad;
                if (plotId && window.app && window.app.onPlotClicked) {
                    window.app.onPlotClicked(plotId);
                }
            }
        });
    }

    removeVectorLayer(layerId) {
        if (!this.map) return;
        const fillId = `vector-fill-${layerId}`;
        const lineId = `vector-line-${layerId}`;
        const symId = `vector-sym-${layerId}`;
        const sourceId = `vector-src-${layerId}`;

        if (this.map.getLayer(symId)) this.map.removeLayer(symId);
        if (this.map.getLayer(lineId)) this.map.removeLayer(lineId);
        if (this.map.getLayer(fillId)) this.map.removeLayer(fillId);
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);

        delete this.vectorLayers[layerId];
    }

    toggleLayerVisibility(layerId) {
        if (!this.map) return false;

        // 1. Check if MBTiles
        if (this.mbtilesLayers[layerId]) {
            return this.toggleMBTilesLayer(layerId);
        }

        // 2. Check if Vector
        const fillId = `vector-fill-${layerId}`;
        const lineId = `vector-line-${layerId}`;
        const symId = `vector-sym-${layerId}`;

        if (!this.map.getLayer(fillId)) return false;

        const currentVis = this.map.getLayoutProperty(fillId, 'visibility') || 'visible';
        const newVis = (currentVis === 'visible') ? 'none' : 'visible';

        this.map.setLayoutProperty(fillId, 'visibility', newVis);
        if (this.map.getLayer(lineId)) this.map.setLayoutProperty(lineId, 'visibility', newVis);
        if (this.map.getLayer(symId)) this.map.setLayoutProperty(symId, 'visibility', newVis);

        if (this.vectorLayers[layerId]) {
            this.vectorLayers[layerId].visible = (newVis === 'visible');
        }

        if (layerId === 'layer_f3f5750f') {
            const detailFill = 'vector-fill-layer_f3f5750f-detail';
            const detailLine = 'vector-line-layer_f3f5750f-detail';
            const detailSym = 'vector-sym-layer_f3f5750f-detail';
            if (this.map.getLayer(detailFill)) this.map.setLayoutProperty(detailFill, 'visibility', newVis);
            if (this.map.getLayer(detailLine)) this.map.setLayoutProperty(detailLine, 'visibility', newVis);
            if (this.map.getLayer(detailSym)) this.map.setLayoutProperty(detailSym, 'visibility', newVis);
        }
        return newVis === 'visible';
    }

    zoomToLayer(layerId) {
        const lyr = (this.catalogLayers || []).find(l => l.id === layerId) ||
                    (this.vectorLayers[layerId]?.meta) ||
                    (this.mbtilesLayers[layerId]?.meta);
        if (!lyr) return;

        const bbox = lyr.bbox || lyr.bounds;
        if (bbox && bbox.length >= 4) {
            this.fitBounds(bbox);
        }
    }

    fitAllLayers() {
        if (!this.catalogLayers || this.catalogLayers.length === 0) return;

        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        let count = 0;

        for (const l of this.catalogLayers) {
            const b = l.bbox || l.bounds;
            if (b && b.length >= 4 && isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3])) {
                minX = Math.min(minX, b[0]);
                minY = Math.min(minY, b[1]);
                maxX = Math.max(maxX, b[2]);
                maxY = Math.max(maxY, b[3]);
                count++;
            }
        }

        if (count > 0 && minX < maxX && minY < maxY) {
            this.fitBounds([minX, minY, maxX, maxY]);
        }
    }

    // ==========================================
    // MBTILES OFFLINE TILE LAYERS
    // ==========================================
    syncMBTilesLayers(catalogLayers) {
        if (!Array.isArray(catalogLayers)) return;
        const mbtilesCatalog = catalogLayers.filter(l => l.format === 'mbtiles');
        const activeIds = new Set(mbtilesCatalog.map(l => l.id));

        // Remove any layers no longer in catalog
        Object.keys(this.mbtilesLayers).forEach(lid => {
            if (!activeIds.has(lid)) {
                this.removeMBTilesLayer(lid);
            }
        });

        // Add or sync each MBTiles layer
        mbtilesCatalog.forEach(layer => {
            if (!this.mbtilesLayers[layer.id]) {
                this.addMBTilesLayer(layer);
            }
        });
    }

    addMBTilesLayer(layer) {
        if (!this.map || !this.mapLoaded) {
            this.pendingMBTiles.push(layer);
            return;
        }

        const sourceId = `mbtiles-src-${layer.id}`;
        const layerId = `mbtiles-lyr-${layer.id}`;

        if (!this.map.getSource(sourceId)) {
            const tileEndpoint = window.location.origin + layer.tile_url;
            this.map.addSource(sourceId, {
                type: 'raster',
                tiles: [tileEndpoint],
                tileSize: 256,
                minzoom: layer.minzoom || 0,
                maxzoom: layer.maxzoom || 18,
                bounds: layer.bounds || [108.0, 14.0, 109.5, 15.5]
            });
        }

        if (!this.map.getLayer(layerId)) {
            // Insert under cadastral plot polygons so plots remain visible on top
            let lyrOpacity = (layer.opacity !== undefined) ? layer.opacity : 0.85;
            if (window.app && window.app.layerOpacities && window.app.layerOpacities[layer.id] !== undefined) {
                lyrOpacity = window.app.layerOpacities[layer.id];
            } else {
                try {
                    const saved = localStorage.getItem('layer_opacity_' + layer.id);
                    if (saved !== null) lyrOpacity = parseFloat(saved);
                } catch (e) {}
            }

            this.map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: {
                    'raster-opacity': lyrOpacity
                }
            }, beforeLayer);
        }

        this.mbtilesLayers[layer.id] = {
            meta: layer,
            visible: true
        };
    }

    removeMBTilesLayer(layerId) {
        if (!this.map) return;
        const lyr = `mbtiles-lyr-${layerId}`;
        const src = `mbtiles-src-${layerId}`;

        if (this.map.getLayer(lyr)) this.map.removeLayer(lyr);
        if (this.map.getSource(src)) this.map.removeSource(src);
        delete this.mbtilesLayers[layerId];
    }

    toggleMBTilesLayer(layerId) {
        if (!this.map) return false;
        const lyr = `mbtiles-lyr-${layerId}`;
        if (!this.map.getLayer(lyr)) return false;

        const currentVis = this.map.getLayoutProperty(lyr, 'visibility') || 'visible';
        const newVis = (currentVis === 'visible') ? 'none' : 'visible';
        this.map.setLayoutProperty(lyr, 'visibility', newVis);
        if (this.mbtilesLayers[layerId]) {
            this.mbtilesLayers[layerId].visible = (newVis === 'visible');
        }
        return newVis === 'visible';
    }

    setMBTilesOpacity(layerId, opacity) {
        if (!this.map) return;
        const lyr = `mbtiles-lyr-${layerId}`;
        if (this.map.getLayer(lyr)) {
            this.map.setPaintProperty(lyr, 'raster-opacity', parseFloat(opacity));
        }
    }

    goToCoordinate(lat, lon, zoom = 19, label = '') {
        if (!this.map) return;
        this.map.flyTo({
            center: [lon, lat],
            zoom: zoom,
            pitch: 25,
            essential: true
        });

        if (this.searchMarker) {
            this.searchMarker.remove();
        }

        const prov = (window.VnGIS && window.VnGIS.detectProvince)
            ? window.VnGIS.detectProvince(lat, lon)
            : { name: 'Quảng Ngãi', kttStr: "108°00'", ktt: 108.0 };
        const vn = (window.VnGIS && window.VnGIS.wgs84ToVn2000)
            ? window.VnGIS.wgs84ToVn2000(lat, lon, prov.ktt)
            : { x: 0, y: 0 };

        const el = document.createElement('div');
        el.className = 'custom-coord-pin';
        el.innerHTML = `
            <div class="pin-ring"></div>
            <div class="pin-icon">📍</div>
        `;

        const popupHtml = `
            <div style="font-family: var(--font-sans); font-size: 12px; line-height: 1.5; min-width: 220px; color: #f1f5f9;">
                <div style="font-weight: 700; color: #38bdf8; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <span>📍</span>
                    <span>${label || 'Tọa Độ Tìm Kiếm'}</span>
                </div>
                <div style="background: rgba(15, 23, 42, 0.7); padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; font-family: monospace; font-size: 11px; border: 1px solid rgba(56, 189, 248, 0.25);">
                    <div style="color: #38bdf8; font-weight: 700; margin-bottom: 4px;">Khu vực: ${prov.name} (KTT ${prov.kttStr})</div>
                    <div><b>VN-2000 X:</b> ${vn.x.toLocaleString('en-US', {minimumFractionDigits: 1})} m</div>
                    <div><b>VN-2000 Y:</b> ${vn.y.toLocaleString('en-US', {minimumFractionDigits: 1})} m</div>
                    <div style="margin-top: 4px; color: #94a3b8;"><b>WGS84:</b> ${lat.toFixed(6)}°, ${lon.toFixed(6)}°</div>
                </div>
                <button onclick="window.mapController.removeSearchMarker()" style="background: #ef4444; color: white; border: none; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; width: 100%; font-weight: 600;">
                    ✕ Xóa Điểm Đánh Dấu
                </button>
            </div>
        `;

        this.searchMarker = new maplibregl.Marker({ element: el })
            .setLngLat([lon, lat])
            .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(popupHtml))
            .addTo(this.map);

        this.searchMarker.togglePopup();
    }

    removeSearchMarker() {
        if (this.searchMarker) {
            this.searchMarker.remove();
            this.searchMarker = null;
        }
    }

    // ==========================================
    // FRACTIONAL PLOT LABEL SYSTEM (TỬ / MẪU)
    // ==========================================
    buildFractionalLabelExpression(cfg) {
        if (!cfg) return '';
        
        const getFieldExpr = (fieldName) => {
            if (!fieldName) return '';
            return ['to-string', ['coalesce', ['get', fieldName], '']];
        };

        const buildLineExpr = (f1, sep, f2) => {
            const has1 = !!f1;
            const has2 = !!f2;
            if (has1 && has2) {
                const e1 = getFieldExpr(f1);
                const e2 = getFieldExpr(f2);
                return [
                    'case',
                    ['all', ['!=', e1, ''], ['!=', e2, '']],
                    ['concat', e1, sep || ' - ', e2],
                    ['!=', e1, ''],
                    e1,
                    ['!=', e2, ''],
                    e2,
                    ''
                ];
            } else if (has1) {
                return getFieldExpr(f1);
            } else if (has2) {
                return getFieldExpr(f2);
            }
            return '';
        };

        const numExpr = buildLineExpr(cfg.numField1, cfg.numSep, cfg.numField2);
        const denExpr = buildLineExpr(cfg.denField1, cfg.denSep, cfg.denField2);
        let bar = (cfg.barStyle !== undefined) ? cfg.barStyle : '-------------';
        if (bar.includes('─') || bar.includes('―') || bar.includes('—')) {
            bar = '-------------';
        } else if (bar.includes('┈')) {
            bar = '- - - - - - -';
        } else if (bar.includes('═')) {
            bar = '=============';
        }

        if (numExpr && denExpr) {
            const sepStr = bar ? `\n${bar}\n` : '\n';
            return [
                'case',
                ['all', ['!=', numExpr, ''], ['!=', denExpr, '']],
                ['concat', numExpr, sepStr, denExpr],
                ['!=', numExpr, ''],
                numExpr,
                ['!=', denExpr, ''],
                denExpr,
                ''
            ];
        } else if (numExpr) {
            return numExpr;
        } else if (denExpr) {
            return denExpr;
        }
        return '';
    }

    getFractionalLabelConfig(layerId) {
        try {
            const saved = localStorage.getItem('layer_fraction_label_' + layerId);
            if (saved) return JSON.parse(saved);
        } catch (e) {}

        if (layerId !== 'all') {
            try {
                const globalSaved = localStorage.getItem('layer_fraction_label_all');
                if (globalSaved) return JSON.parse(globalSaved);
            } catch (e) {}
        }

        if (this.catalogLayers) {
            const lyr = this.catalogLayers.find(l => l.id === layerId);
            if (lyr && lyr.label_config) return lyr.label_config;
        }
        return null;
    }

    updateLayerFractionalLabel(layerId, config) {
        if (!this.map) return;
        
        try {
            localStorage.setItem('layer_fraction_label_' + layerId, JSON.stringify(config));
        } catch (e) {}

        const targetIds = (layerId === 'all') 
            ? Object.keys(this.vectorLayers) 
            : [layerId];

        targetIds.forEach(lid => {
            const symId = `vector-sym-${lid}`;
            const sourceId = `vector-src-${lid}`;

            if (config.enabled === false) {
                if (this.map.getLayer(symId)) {
                    this.map.setLayoutProperty(symId, 'visibility', 'none');
                }
                return;
            }

            const expr = this.buildFractionalLabelExpression(config);
            const fontSize = parseInt(config.fontSize || 11, 10);
            const textColor = config.textColor || '#fde047';
            const minZoom = parseInt(config.minZoom || 11, 10);

            let haloColor = '#000000';
            let haloWidth = 2.0;
            if (config.haloStyle === 'black-thick') {
                haloColor = '#000000';
                haloWidth = 2.0;
            } else if (config.haloStyle === 'black-medium') {
                haloColor = '#000000';
                haloWidth = 1.5;
            } else if (config.haloStyle === 'white-thick') {
                haloColor = '#ffffff';
                haloWidth = 2.0;
            } else if (config.haloStyle === 'none') {
                haloColor = 'transparent';
                haloWidth = 0;
            }

            if (!this.map.getLayer(symId)) {
                if (this.map.getSource(sourceId)) {
                    this.map.addLayer({
                        id: symId,
                        type: 'symbol',
                        source: sourceId,
                        minzoom: minZoom,
                        layout: {
                            'text-field': expr || '',
                            'text-font': ['Open Sans Bold'],
                            'text-size': fontSize,
                            'text-offset': [0, 0],
                            'text-anchor': 'center',
                            'text-justify': 'center',
                            'text-allow-overlap': true,
                            'text-ignore-placement': true,
                            'text-max-width': 30,
                            'visibility': 'visible'
                        },
                        paint: {
                            'text-color': textColor,
                            'text-halo-color': haloColor,
                            'text-halo-width': haloWidth
                        }
                    });
                }
                return;
            }

            this.map.setLayoutProperty(symId, 'visibility', 'visible');
            if (expr) {
                this.map.setLayoutProperty(symId, 'text-field', expr);
            }
            this.map.setLayoutProperty(symId, 'text-font', ['Open Sans Bold']);
            this.map.setLayoutProperty(symId, 'text-size', fontSize);
            this.map.setLayoutProperty(symId, 'text-justify', 'center');
            this.map.setLayoutProperty(symId, 'text-anchor', 'center');
            this.map.setLayoutProperty(symId, 'text-allow-overlap', true);
            this.map.setLayoutProperty(symId, 'text-ignore-placement', true);
            this.map.setLayoutProperty(symId, 'text-max-width', 30);

            this.map.setPaintProperty(symId, 'text-color', textColor);
            this.map.setPaintProperty(symId, 'text-halo-color', haloColor);
            this.map.setPaintProperty(symId, 'text-halo-width', haloWidth);

            if (typeof this.map.setLayerZoomRange === 'function') {
                this.map.setLayerZoomRange(symId, minZoom, 24);
            }
        });
    }

    disableLayerFractionalLabel(layerId) {
        if (!this.map) return;
        try {
            const saved = this.getFractionalLabelConfig(layerId) || {};
            saved.enabled = false;
            localStorage.setItem('layer_fraction_label_' + layerId, JSON.stringify(saved));
        } catch (e) {}

        const targetIds = (layerId === 'all') 
            ? Object.keys(this.vectorLayers) 
            : [layerId];

        targetIds.forEach(lid => {
            const symId = `vector-sym-${lid}`;
            if (this.map.getLayer(symId)) {
                this.map.setLayoutProperty(symId, 'visibility', 'none');
            }
        });
    }
}

window.mapController = new MapController();

