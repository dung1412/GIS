/**
 * Main Application Orchestrator for Central Vietnam Forestry GIS
 * Integrates Layer Manager, Attribute Table Inspector, Red Book Audit Log,
 * Satellite Timeline Slider, 3D Elevation Terrain, and In-Browser Web GIS Editor.
 */

window.toggleHeaderDropdown = function(menuId, e) {
    if (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
    }
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const isCurrentlyOpen = menu.classList.contains('open');
    document.querySelectorAll('.header-dropdown-menu').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.dropdown-trigger').forEach(t => t.classList.remove('open'));
    if (!isCurrentlyOpen) {
        menu.classList.add('open');
        menu.closest('.header-dropdown-wrapper')?.querySelector('.dropdown-trigger')?.classList.add('open');
    }
};

class ForestryApp {
    constructor() {
        this.currentProvince = 'ALL';
        this.allPlots = [];
        this.selectedPlot = null;
        this.activeTab = 'tab-owners';
        this.searchDebounceTimer = null;

        // Attribute table state
        this.currentAttrLayerId = null;
        this.currentAttrPage = 1;
        this.currentAttrData = null;

        // Timeline playback state
        this.timelineMode = 'planet';
        this.timelinePlaying = false;
        this.timelineInterval = null;

        // Individual Layer Opacities Map
        this.layerOpacities = {};
    }

    async init() {
        // 1. Bind all UI events immediately so tabs, buttons, modals are 100% interactive
        try { this._bindUIEvents(); } catch (e) { console.error('Error binding UI events:', e); }
        try { this._bindTimelineSlider(); } catch (e) { console.error('Error binding timeline:', e); }
        try { this._bindGISEditor(); } catch (e) { console.error('Error binding GIS editor:', e); }
        try { this._bindAttributeTableModal(); } catch (e) { console.error('Error binding attr table modal:', e); }
        try { this._bindRasterExportModal(); } catch (e) { console.error('Error binding raster export modal:', e); }

        // 2. Initialize controllers with try/catch isolation
        try {
            if (window.mapController) window.mapController.init('map');
        } catch (e) {
            console.error('Error initializing MapController:', e);
        }

        try {
            if (window.shapeMatcherUI) window.shapeMatcherUI.init();
        } catch (e) {
            console.error('Error initializing ShapeMatcherUI:', e);
        }

        try {
            if (window.userWorkspace) await window.userWorkspace.init();
        } catch (e) {
            console.error('Error initializing UserWorkspace:', e);
        }

        // 3. Load data with try/catch isolation
        try { await this.loadInitialData(); } catch (e) { console.error('Error loading initial data:', e); }
        try { await this.loadLayersCatalog(); } catch (e) { console.error('Error loading layers catalog:', e); }
        try { await this.loadRedBookLogs(); } catch (e) { console.error('Error loading redbook logs:', e); }

        // Focus map to all user uploaded layers if present
        if (window.mapController && typeof window.mapController.fitAllLayers === 'function') {
            try { window.mapController.fitAllLayers(); } catch (e) {}
        }

        // Activate initial province boundary view (ALL)
        if (window.mapController && typeof window.mapController.highlightProvince === 'function') {
            try { window.mapController.highlightProvince(this.currentProvince || 'ALL'); } catch (e) {}
        }
    }

    _bindUIEvents() {
        // Province Pills
        document.querySelectorAll('.prov-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.prov-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const provCode = e.currentTarget.dataset.province;
                this.onProvinceChanged(provCode);
            });
        });

        // Initialize Coordinate Search, Font Converter & Fractional Label Tools
        this.setupCoordSearchModal();
        this.setupFontConverterModal();
        this.setupFractionalLabelModal();

        // Sidebar Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                e.currentTarget.classList.add('active');
                const targetId = e.currentTarget.dataset.tab;
                const targetContent = document.getElementById(targetId);
                if (targetContent) targetContent.classList.add('active');
                this.activeTab = targetId;

                if (targetId === 'tab-layers') this.loadLayersCatalog();
                if (targetId === 'tab-redbook-log') this.loadRedBookLogs();
            });
        });

        // Sidebar Toggle Collapse / Expand
        const toggleSidebar = (collapse) => {
            const sidebar = document.getElementById('app-sidebar');
            const icon = document.getElementById('sidebar-toggle-icon');
            const btn = document.getElementById('btn-toggle-sidebar');
            if (!sidebar) return;

            const isCollapsed = (collapse !== undefined) ? collapse : !sidebar.classList.contains('collapsed');
            sidebar.classList.toggle('collapsed', isCollapsed);

            if (icon) icon.innerText = isCollapsed ? '▶' : '◀';
            if (btn) {
                btn.title = isCollapsed ? 'Mở rộng bảng điều khiển (Hiện thanh bên)' : 'Thu gọn bảng điều khiển (Ẩn thanh bên)';
                btn.setAttribute('aria-expanded', !isCollapsed);
            }

            // Smoothly resize MapLibre canvas continuously during CSS transition (350ms)
            const startTime = performance.now();
            const resizeLoop = (now) => {
                if (window.mapController && window.mapController.map) {
                    window.mapController.map.resize();
                }
                if (now - startTime < 380) {
                    requestAnimationFrame(resizeLoop);
                }
            };
            requestAnimationFrame(resizeLoop);
        };
        window.toggleSidebar = toggleSidebar;

        // Search & Stats Subpanel Collapse / Expand
        const toggleSearchStats = () => {
            const section = document.getElementById('search-stats-section');
            const icon = document.getElementById('search-stats-toggle-icon');
            const text = document.getElementById('search-stats-toggle-text');
            if (!section) return;

            const isCollapsed = section.classList.toggle('collapsed');
            if (icon) icon.innerText = isCollapsed ? '▼' : '▲';
            if (text) text.innerText = isCollapsed ? 'Hiện bộ lọc' : 'Thu gọn bộ lọc';
        };
        window.toggleSearchStats = toggleSearchStats;

        // Search Input
        const searchInput = document.getElementById('forest-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => this.filterAndRenderPlots(), 250);
            });
        }

        const provFilter = document.getElementById('filter-province');
        if (provFilter) provFilter.addEventListener('change', () => this.filterAndRenderPlots());

        const sbpFilter = document.getElementById('filter-sbp');
        if (sbpFilter) sbpFilter.addEventListener('change', () => this.filterAndRenderPlots());

        // Red Book search input & filter
        const rbSearch = document.getElementById('redbook-search-input');
        if (rbSearch) {
            rbSearch.addEventListener('input', () => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => this.loadRedBookLogs(), 250);
            });
        }

        const rbStatusFilter = document.getElementById('filter-redbook-status');
        if (rbStatusFilter) {
            rbStatusFilter.addEventListener('change', () => this.loadRedBookLogs());
        }

        // Layer Opacity Slider
        const opacitySlider = document.getElementById('layer-opacity-slider');
        const opacityVal = document.getElementById('opacity-val');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                const val = e.target.value;
                if (opacityVal) opacityVal.innerHTML = `${Math.round(val * 100)}%`;
                if (window.mapController) window.mapController.setLayerOpacity(val);
            });
        }

        // Basemap Switcher
        document.querySelectorAll('.basemap-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                document.querySelectorAll('.basemap-option').forEach(o => o.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const bmKey = e.currentTarget.dataset.basemap;

                // Expand timeline container automatically if temporal basemap clicked
                const timelineEl = document.getElementById('satellite-timeline');
                const toggleTimelineBtn = document.getElementById('btn-toggle-timeline');
                if (['planet-latest', 'planet-eudr-2020', 'sentinel2-daily', 'sentinel2-latest', 'sentinel2-eudr-2020', 'nasa-daily', 'esri-wayback'].includes(bmKey)) {
                    if (timelineEl) {
                        timelineEl.classList.remove('collapsed');
                        if (toggleTimelineBtn) toggleTimelineBtn.innerHTML = '━';
                    }
                }

                // Sync timeline scrubber automatically if clicking temporal basemap!
                if (bmKey === 'planet-latest' && this.setTimelineMode) {
                    this.setTimelineMode('planet', 68);
                } else if (bmKey === 'planet-eudr-2020' && this.setTimelineMode) {
                    this.setTimelineMode('planet', 0);
                } else if (bmKey === 'sentinel2-daily' && this.setTimelineMode) {
                    this.setTimelineMode('sentinel2-daily');
                } else if (bmKey === 'sentinel2-latest' && this.setTimelineMode) {
                    this.setTimelineMode('sentinel2', 2025);
                } else if (bmKey === 'sentinel2-eudr-2020' && this.setTimelineMode) {
                    this.setTimelineMode('sentinel2', 2020);
                } else if (bmKey === 'nasa-daily' && this.setTimelineMode) {
                    this.setTimelineMode('nasa', 60);
                } else if (bmKey === 'esri-wayback' && this.setTimelineMode) {
                    this.setTimelineMode('wayback', 8);
                } else {
                    if (window.mapController) window.mapController.setBasemap(bmKey);
                }
            });
        });

        // Panel Collapsible Toggles
        // 1. Basemap Picker Toggle
        const basemapPicker = document.getElementById('basemap-picker');
        const basemapHeader = document.getElementById('basemap-header');
        const toggleBasemapBtn = document.getElementById('btn-toggle-basemap');
        if (basemapHeader && basemapPicker) {
            basemapHeader.addEventListener('click', () => {
                const isCollapsed = basemapPicker.classList.toggle('collapsed');
                if (toggleBasemapBtn) toggleBasemapBtn.innerHTML = isCollapsed ? '▼' : '━';
            });
        }

        // 3. GIS Editor Toolbar Toggle
        const gisToolbar = document.getElementById('gis-editor-toolbar');
        const gisHeader = document.getElementById('gis-editor-header');
        const toggleGisBtn = document.getElementById('btn-toggle-gis-editor');
        if (gisHeader && gisToolbar) {
            gisHeader.addEventListener('click', () => {
                const isCollapsed = gisToolbar.classList.toggle('collapsed');
                if (toggleGisBtn) toggleGisBtn.innerHTML = isCollapsed ? '▼' : '━';
            });
        }

        // 4. Timeline Slider Toggle
        const timelineContainer = document.getElementById('satellite-timeline');
        const toggleTimelineBtn = document.getElementById('btn-toggle-timeline');
        if (toggleTimelineBtn && timelineContainer) {
            toggleTimelineBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = timelineContainer.classList.toggle('collapsed');
                toggleTimelineBtn.innerHTML = isCollapsed ? '▲' : '━';
            });
        }

        // 3D Terrain & Contours Toggle
        const btn3D = document.getElementById('btn-toggle-3d');
        if (btn3D) btn3D.addEventListener('click', () => window.mapController.toggle3D());

        const btnContours = document.getElementById('btn-toggle-contours');
        if (btnContours) btnContours.addEventListener('click', () => window.mapController.toggleContours());

        // Import Modal openers
        const openImportBtn = document.getElementById('btn-open-import-modal');
        const tabAddLayerBtn = document.getElementById('btn-tab-add-layer');
        const importModal = document.getElementById('import-modal-overlay');
        const importClose = document.getElementById('import-modal-close-btn');

        if (openImportBtn && importModal) openImportBtn.addEventListener('click', () => importModal.classList.add('open'));
        if (tabAddLayerBtn && importModal) tabAddLayerBtn.addEventListener('click', () => importModal.classList.add('open'));
        if (importClose && importModal) importClose.addEventListener('click', () => importModal.classList.remove('open'));

        // Import Dropzone
        const dropzone = document.getElementById('map-file-dropzone');
        const fileInput = document.getElementById('map-file-input');
        if (dropzone && fileInput) {
            dropzone.addEventListener('click', () => fileInput.click());
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#38bdf8'; });
            dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = '';
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this.uploadMapFile(e.dataTransfer.files[0]);
                }
            });
            fileInput.addEventListener('change', () => {
                if (fileInput.files && fileInput.files.length > 0) {
                    this.uploadMapFile(fileInput.files[0]);
                }
            });
        }

        // Plot Modal Close
        const plotModalClose = document.getElementById('modal-close-btn');
        const plotModal = document.getElementById('plot-modal-overlay');
        if (plotModalClose && plotModal) {
            plotModalClose.addEventListener('click', () => plotModal.classList.remove('open'));
        }

        // Header Dropdowns & Boundary / CAD Toggles
        this._bindHeaderDropdownsAndToggles();
    }

    _bindHeaderDropdownsAndToggles() {
        const dropdownWrappers = document.querySelectorAll('.header-dropdown-wrapper');

        window.toggleHeaderDropdown = (menuId, e) => {
            if (e) {
                try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
            }
            const menu = document.getElementById(menuId);
            if (!menu) return;
            const isCurrentlyOpen = menu.classList.contains('open');
            document.querySelectorAll('.header-dropdown-menu').forEach(m => m.classList.remove('open'));
            document.querySelectorAll('.dropdown-trigger').forEach(t => t.classList.remove('open'));
            if (!isCurrentlyOpen) {
                menu.classList.add('open');
                menu.closest('.header-dropdown-wrapper')?.querySelector('.dropdown-trigger')?.classList.add('open');
            }
        };

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.header-dropdown-wrapper')) {
                dropdownWrappers.forEach(w => {
                    w.querySelector('.dropdown-trigger')?.classList.remove('open');
                    w.querySelector('.header-dropdown-menu')?.classList.remove('open');
                });
            }
        });

        // Close dropdown when regular item is clicked
        document.querySelectorAll('.dropdown-item:not(.active-toggle)').forEach(item => {
            item.addEventListener('click', () => {
                dropdownWrappers.forEach(w => {
                    w.querySelector('.dropdown-trigger')?.classList.remove('open');
                    w.querySelector('.header-dropdown-menu')?.classList.remove('open');
                });
            });
        });

        // 2. Toggle Ranh Giới Hành Chính (Tỉnh)
        const btnToggleProv = document.getElementById('btn-toggle-province-boundaries');
        if (btnToggleProv) {
            btnToggleProv.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.mapController) {
                    const isVisible = window.mapController.toggleProvinceBoundaries();
                    const statusEl = document.getElementById('status-prov-boundary');
                    if (statusEl) {
                        statusEl.textContent = isVisible ? 'BẬT' : 'TẮT';
                        statusEl.style.color = isVisible ? '#34d399' : '#f87171';
                    }
                }
            });
        }

        // 3. Toggle Viền Lô Tương Phản (High Contrast Plot Outlines)
        const btnToggleBorders = document.getElementById('btn-toggle-plot-borders');
        if (btnToggleBorders) {
            btnToggleBorders.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.mapController) {
                    const isHigh = window.mapController.togglePlotContrastBorders();
                    const statusEl = document.getElementById('status-plot-borders');
                    if (statusEl) {
                        statusEl.textContent = isHigh ? 'BẬT' : 'TẮT';
                        statusEl.style.color = isHigh ? '#34d399' : '#f87171';
                    }
                }
            });
        }

        // 4. Toggle CAD Drawing Toolbar
        const btnToggleCAD = document.getElementById('btn-toggle-cad-toolbar');
        const cadToolbar = document.getElementById('mapinfo-toolbar-container');
        if (btnToggleCAD && cadToolbar) {
            btnToggleCAD.addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = cadToolbar.classList.toggle('collapsed');
                const statusEl = document.getElementById('status-cad-toolbar');
                if (statusEl) {
                    statusEl.textContent = isCollapsed ? 'ẨN' : 'HIỆN';
                    statusEl.style.color = isCollapsed ? '#94a3b8' : '#38bdf8';
                }
            });
        }
    }

    _bindTimelineSlider() {
        const slider = document.getElementById('timeline-slider');
        const label = document.getElementById('timeline-current-label');
        const titleText = document.getElementById('timeline-title-text');
        const minLabel = document.getElementById('timeline-min-label');
        const maxLabel = document.getElementById('timeline-max-label');
        const playBtn = document.getElementById('btn-timeline-play');
        const sourceTabs = document.querySelectorAll('.timeline-source-btn');

        const WAYBACK_RELEASES = [
            { year: 2014, date: '30/07/2014', m: '5232', label: 'Bản chụp 2014' },
            { year: 2016, date: '06/07/2016', m: '13240', label: 'Bản chụp 2016' },
            { year: 2018, date: '06/06/2018', m: '8249', label: 'Bản chụp 2018' },
            { year: 2020, date: '10/06/2020', m: '11135', label: 'Mốc EUDR 2020' },
            { year: 2021, date: '30/06/2021', m: '13534', label: 'Bản chụp 2021' },
            { year: 2022, date: '08/06/2022', m: '44710', label: 'Bản chụp 2022' },
            { year: 2023, date: '13/06/2023', m: '25982', label: 'Bản chụp 2023' },
            { year: 2024, date: '06/06/2024', m: '12428', label: 'Bản chụp 2024' },
            { year: 2026, date: '30/04/2026', m: '49059', label: 'Mới nhất 2026' }
        ];

        // Copernicus Sentinel-2 5-day cycle passes over Central Vietnam (Quang Ngai / Binh Dinh / Phu Yen)
        const SENTINEL_PASSES = [
            { dateStr: '2026-03-24', displayStr: '24/03/2026', label: '24/03/2026 (Xuân 2026)' },
            { dateStr: '2026-05-23', displayStr: '23/05/2026', label: '23/05/2026 (Đầu hè)' },
            { dateStr: '2026-06-12', displayStr: '12/06/2026', label: '12/06/2026 (Giữa hè)' },
            { dateStr: '2026-07-22', displayStr: '22/07/2026', label: '22/07/2026 (Mùa khô)' },
            { dateStr: '2026-08-01', displayStr: '01/08/2026', label: '01/08/2026 (Đầu tháng 8)' },
            { dateStr: '2026-08-06', displayStr: '06/08/2026', label: '06/08/2026 (Lượt 06/08)' },
            { dateStr: '2026-08-11', displayStr: '11/08/2026', label: '11/08/2026 (Lượt 11/08)' },
            { dateStr: '2026-08-16', displayStr: '16/08/2026', label: '16/08/2026 (Lượt 16/08)' },
            { dateStr: '2026-08-21', displayStr: '21/08/2026', label: '21/08/2026 (Ảnh sắc nét)' },
            { dateStr: '2026-08-26', displayStr: '26/08/2026', label: '26/08/2026 (Lượt 26/08)' },
            { dateStr: '2026-08-31', displayStr: '31/08/2026', label: '31/08/2026 (Cuối tháng 8)' },
            { dateStr: '2026-09-05', displayStr: '05/09/2026', label: '05/09/2026 (Đầu tháng 9)' },
            { dateStr: '2026-09-10', displayStr: '10/09/2026', label: '10/09/2026 (Mới nhất - HLS 30m)' }
        ];

        this.setTimelineMode = (mode, targetVal = null) => {
            this.timelineMode = mode;
            if (this.timelinePlaying) {
                clearInterval(this.timelineInterval);
                this.timelinePlaying = false;
                if (playBtn) playBtn.innerHTML = '▶ Tua Tự Động';
            }

            // Highlight source pill
            sourceTabs.forEach(btn => {
                if (btn.dataset.source === mode) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            if (!slider || !label || !minLabel || !maxLabel) return;

            if (mode === 'planet') {
                if (titleText) titleText.innerHTML = '🪐 VỆ TINH PLANET NICFI (2020 - 2026)';
                minLabel.innerHTML = '12/2020 (EUDR)';
                maxLabel.innerHTML = '08/2026';
                slider.min = '0';
                slider.max = '68';
                slider.step = '1';
                slider.value = (targetVal !== null) ? targetVal : '68';
            } else if (mode === 'sentinel2-daily') {
                if (titleText) titleText.innerHTML = '🇪🇺 COPENICUS SENTINEL-2 (CHỤP THEO NGÀY 30m)';
                minLabel.innerHTML = SENTINEL_PASSES[0].displayStr;
                maxLabel.innerHTML = SENTINEL_PASSES[SENTINEL_PASSES.length - 1].displayStr + ' (Mới)';
                slider.min = '0';
                slider.max = String(SENTINEL_PASSES.length - 1);
                slider.step = '1';
                slider.value = (targetVal !== null) ? targetVal : String(SENTINEL_PASSES.length - 1);
            } else if (mode === 'sentinel2') {
                if (titleText) titleText.innerHTML = '🇪🇺 COPENICUS SENTINEL-2 KHÔNG MÂY (EOX)';
                minLabel.innerHTML = '2016';
                maxLabel.innerHTML = '2025';
                slider.min = '2016';
                slider.max = '2025';
                slider.step = '1';
                slider.value = (targetVal !== null) ? targetVal : '2025';
            } else if (mode === 'nasa') {
                if (titleText) titleText.innerHTML = '🛰️ NASA GIBS CHỤP HÀNG NGÀY (CẬP NHẬT 3H)';
                minLabel.innerHTML = '60 ngày trước';
                maxLabel.innerHTML = 'Mới Nhất (Hôm qua)';
                slider.min = '0';
                slider.max = '60';
                slider.step = '1';
                slider.value = (targetVal !== null) ? targetVal : '60';
            } else if (mode === 'wayback') {
                if (titleText) titleText.innerHTML = '🌍 ESRI WAYBACK LỊCH SỬ (MAXAR)';
                minLabel.innerHTML = '2014';
                maxLabel.innerHTML = '2026';
                slider.min = '0';
                slider.max = String(WAYBACK_RELEASES.length - 1);
                slider.step = '1';
                slider.value = (targetVal !== null) ? targetVal : String(WAYBACK_RELEASES.length - 1);
            }

            // Sync basemap picker active highlight if applicable
            document.querySelectorAll('.basemap-option').forEach(o => {
                const bm = o.dataset.basemap;
                if ((mode === 'planet' && (bm === 'planet-latest' || bm === 'planet-eudr-2020')) ||
                    (mode === 'sentinel2-daily' && bm === 'sentinel2-daily') ||
                    (mode === 'sentinel2' && (bm === 'sentinel2-latest' || bm === 'sentinel2-eudr-2020')) ||
                    (mode === 'nasa' && bm === 'nasa-daily') ||
                    (mode === 'wayback' && bm === 'esri-wayback')) {
                    // keep active
                } else if (o.classList.contains('active') && !o.dataset.basemap.startsWith('google') && !o.dataset.basemap.startsWith('osm') && !o.dataset.basemap.startsWith('topo')) {
                    o.classList.remove('active');
                }
            });

            // Trigger slider event
            slider.dispatchEvent(new Event('input'));
        };

        // Source tabs clicking
        sourceTabs.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const s = e.currentTarget.dataset.source;
                this.setTimelineMode(s);
            });
        });

        // Helper calculations
        const planetIndexToDate = (idx) => {
            const baseDate = new Date(2020, 11, 1); // 12/2020
            const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + parseInt(idx), 1);
            return {
                year: d.getFullYear(),
                month: String(d.getMonth() + 1).padStart(2, '0')
            };
        };

        const nasaIndexToDateStr = (idx) => {
            // NASA GIBS daily composite has an orbital and compilation lag of ~12-24h.
            // Today's orbital pass is incomplete globally and NASA servers return black (0,0,0) tiles.
            // Therefore, index 60 (the rightmost point) maps to Yesterday (1 day ago), which is fully compiled and vibrant.
            const val = parseInt(idx);
            const daysAgo = (60 - val) + 1; // 60 -> 1 day ago (yesterday), 0 -> 61 days ago
            const d = new Date(Date.now() - daysAgo * 86400000);
            return {
                dateStr: d.toISOString().split('T')[0],
                displayStr: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
                daysAgo: daysAgo
            };
        };

        if (slider && label) {
            slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);

                if (this.timelineMode === 'planet') {
                    const dateObj = planetIndexToDate(val);
                    const isEUDR = (dateObj.year === 2020 && dateObj.month === '12');
                    const isLatest = (val === 68);
                    label.innerHTML = `Tháng ${dateObj.month}/${dateObj.year} ${isEUDR ? '(Mốc EUDR 2020)' : (isLatest ? '(Mới Nhất)' : '')}`;
                    if (window.mapController) {
                        window.mapController.setTimelinePlanet(dateObj.year, dateObj.month);
                    }
                } else if (this.timelineMode === 'sentinel2-daily') {
                    const pass = SENTINEL_PASSES[val] || SENTINEL_PASSES[SENTINEL_PASSES.length - 1];
                    label.innerHTML = `${pass.label}`;
                    if (window.mapController) {
                        window.mapController.setTimelineSentinelDaily(pass.dateStr);
                    }
                } else if (this.timelineMode === 'sentinel2') {
                    const yr = val;
                    const isEUDR = (yr === 2020);
                    const isLatest = (yr === 2025);
                    label.innerHTML = `Năm ${yr} ${isEUDR ? '(Mốc EUDR 2020)' : (isLatest ? '(Mới Nhất 2025)' : '')}`;
                    if (window.mapController) {
                        window.mapController.setTimelineSentinel(yr);
                    }
                } else if (this.timelineMode === 'nasa') {
                    const nObj = nasaIndexToDateStr(val);
                    const tag = (nObj.daysAgo === 1) 
                        ? '(Mới Nhất - Hôm qua - Ảnh sắc nét)' 
                        : (nObj.daysAgo === 2 
                            ? '(Hôm kia - Ảnh vệ tinh)' 
                            : `(-${nObj.daysAgo} ngày)`);
                    label.innerHTML = `${nObj.displayStr} ${tag}`;
                    if (window.mapController) {
                        window.mapController.setTimelineNasa(nObj.dateStr);
                    }
                } else if (this.timelineMode === 'wayback') {
                    const rel = WAYBACK_RELEASES[val] || WAYBACK_RELEASES[WAYBACK_RELEASES.length - 1];
                    label.innerHTML = `${rel.date} - ${rel.label}`;
                    if (window.mapController) {
                        window.mapController.setTimelineWayback(rel.m, rel.label);
                    }
                }
            });
        }

        // Play/Pause button
        if (playBtn && slider) {
            playBtn.addEventListener('click', () => {
                if (this.timelinePlaying) {
                    clearInterval(this.timelineInterval);
                    this.timelinePlaying = false;
                    playBtn.innerHTML = '▶ Tua Tự Động';
                } else {
                    this.timelinePlaying = true;
                    playBtn.innerHTML = '⏸ Tạm Dừng';
                    this.timelineInterval = setInterval(() => {
                        let min = parseInt(slider.min);
                        let max = parseInt(slider.max);
                        let cur = parseInt(slider.value);
                        cur = (cur >= max) ? min : cur + 1;
                        slider.value = cur;
                        slider.dispatchEvent(new Event('input'));
                    }, 850);
                }
            });
        }
    }

    _bindGISEditor() {
        document.querySelectorAll('.gis-tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tool = e.currentTarget.dataset.tool;
                if (window.gisEditor) window.gisEditor.setMode(tool);
            });
        });

        const cancelBtn = document.getElementById('btn-editor-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (window.gisEditor) window.gisEditor.cancel();
            });
        }
    }

    _bindAttributeTableModal() {
        const modal = document.getElementById('attribute-modal-overlay');
        const openBtn = document.getElementById('btn-open-attribute-table');
        const closeBtn = document.getElementById('attribute-modal-close-btn');
        const layerSelect = document.getElementById('attr-layer-select');
        const searchInput = document.getElementById('attr-search-input');
        const prevBtn = document.getElementById('btn-attr-prev');
        const nextBtn = document.getElementById('btn-attr-next');
        const exportCsvBtn = document.getElementById('btn-export-attr-csv');

        if (openBtn) openBtn.addEventListener('click', () => this.openAttributeTableModal());
        if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.remove('open'));

        if (layerSelect) {
            layerSelect.addEventListener('change', (e) => {
                this.currentAttrLayerId = e.target.value;
                this.currentAttrPage = 1;
                this.fetchAndRenderAttributeTable();
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.currentAttrPage = 1;
                    this.fetchAndRenderAttributeTable();
                }, 300);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentAttrPage > 1) {
                    this.currentAttrPage--;
                    this.fetchAndRenderAttributeTable();
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (this.currentAttrData && this.currentAttrPage < this.currentAttrData.total_pages) {
                    this.currentAttrPage++;
                    this.fetchAndRenderAttributeTable();
                }
            });
        }

        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => this.exportCurrentTableToCSV());
        }
    }

    _bindRasterExportModal() {
        const modal = document.getElementById('export-raster-modal-overlay');
        const openBtn = document.getElementById('btn-open-export-raster-modal');
        const closeBtn = document.getElementById('export-raster-modal-close-btn');
        const downloadBtn = document.getElementById('btn-trigger-raster-download');
        const statusEl = document.getElementById('export-raster-status');

        const modeViewportRadio = document.getElementById('export-mode-viewport');
        const modeRegionRadio = document.getElementById('export-mode-region');
        const modeViewportCard = document.getElementById('mode-viewport-card');
        const modeRegionCard = document.getElementById('mode-region-card');
        const regionSelectBox = document.getElementById('export-region-select-box');
        const viewportInfoBox = document.getElementById('export-viewport-info-box');
        const regionLayerSelect = document.getElementById('export-region-layer-select');
        const regionBoundsInfo = document.getElementById('export-region-bounds-info');
        const viewportCoordsEl = document.getElementById('export-current-viewport-coords');
        const refreshViewportBtn = document.getElementById('btn-refresh-export-viewport');

        const updateScopeModeUI = (mode) => {
            if (mode === 'viewport') {
                if (modeViewportRadio) modeViewportRadio.checked = true;
                if (modeViewportCard) {
                    modeViewportCard.style.border = '2px solid #0284c7';
                    modeViewportCard.style.background = 'rgba(2, 132, 199, 0.15)';
                }
                if (modeRegionCard) {
                    modeRegionCard.style.border = '1px solid rgba(255,255,255,0.15)';
                    modeRegionCard.style.background = 'rgba(255, 255, 255, 0.03)';
                }
                if (viewportInfoBox) viewportInfoBox.style.display = 'flex';
                if (regionSelectBox) regionSelectBox.style.display = 'none';
                updateViewportCoordsText();
            } else {
                if (modeRegionRadio) modeRegionRadio.checked = true;
                if (modeRegionCard) {
                    modeRegionCard.style.border = '2px solid #10b981';
                    modeRegionCard.style.background = 'rgba(16, 185, 129, 0.15)';
                }
                if (modeViewportCard) {
                    modeViewportCard.style.border = '1px solid rgba(255,255,255,0.15)';
                    modeViewportCard.style.background = 'rgba(255, 255, 255, 0.03)';
                }
                if (viewportInfoBox) viewportInfoBox.style.display = 'none';
                if (regionSelectBox) regionSelectBox.style.display = 'block';
                populateRegionLayers();
            }
        };

        const updateViewportCoordsText = () => {
            if (window.mapController && window.mapController.map && viewportCoordsEl) {
                const b = window.mapController.map.getBounds();
                const c = window.mapController.map.getCenter();
                const z = window.mapController.map.getZoom().toFixed(1);
                viewportCoordsEl.innerHTML = `📍 Tâm: [${c.lat.toFixed(4)}°, ${c.lng.toFixed(4)}°] (Zoom: ${z}) &nbsp;|&nbsp; BBox: [${b.getWest().toFixed(3)}°, ${b.getSouth().toFixed(3)}°] đến [${b.getEast().toFixed(3)}°, ${b.getNorth().toFixed(3)}°]`;
            }
        };

        const populateRegionLayers = () => {
            if (!regionLayerSelect) return;
            const layers = (this.allCatalogLayers || []).filter(l => l.bbox || l.bounds);
            if (layers.length === 0) {
                regionLayerSelect.innerHTML = '<option value="">-- Chưa có lớp bản đồ nào được nạp --</option>';
                if (regionBoundsInfo) regionBoundsInfo.innerHTML = '⚠️ Vui lòng nạp Shapefile, MapInfo hoặc KML để xuất theo vùng.';
                return;
            }

            regionLayerSelect.innerHTML = layers.map(l => `
                <option value="${l.id}">${l.name} (${l.source_type} - ${l.province})</option>
            `).join('');

            updateRegionBoundsText();
        };

        const updateRegionBoundsText = () => {
            if (!regionLayerSelect || !regionBoundsInfo) return;
            const lid = regionLayerSelect.value;
            const layer = (this.allCatalogLayers || []).find(l => l.id === lid);
            if (layer) {
                const b = layer.bbox || layer.bounds;
                if (b && b.length >= 4) {
                    regionBoundsInfo.innerHTML = `📐 Phạm vi lớp: [${b[0].toFixed(4)}°, ${b[1].toFixed(4)}°] đến [${b[2].toFixed(4)}°, ${b[3].toFixed(4)}°] (${layer.total_area_ha || 0} ha)`;
                }
                const provSelect = document.getElementById('export-raster-province');
                if (provSelect && layer.province) {
                    if (layer.province.includes('Ngãi')) provSelect.value = 'Quảng Ngãi';
                    else if (layer.province.includes('Định')) provSelect.value = 'Bình Định';
                    else if (layer.province.includes('Yên')) provSelect.value = 'Phú Yên';
                }
            }
        };

        if (modeViewportCard) modeViewportCard.addEventListener('click', () => updateScopeModeUI('viewport'));
        if (modeRegionCard) modeRegionCard.addEventListener('click', () => updateScopeModeUI('region'));
        if (regionLayerSelect) regionLayerSelect.addEventListener('change', () => updateRegionBoundsText());
        if (refreshViewportBtn) refreshViewportBtn.addEventListener('click', () => updateViewportCoordsText());

        if (openBtn && modal) {
            openBtn.addEventListener('click', () => {
                modal.classList.add('open');
                updateScopeModeUI('viewport');
            });
        }
        if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.remove('open'));

        if (downloadBtn) {
            downloadBtn.addEventListener('click', async () => {
                const scopeMode = document.querySelector('input[name="export-scope-mode"]:checked')?.value || 'viewport';
                const prov = document.getElementById('export-raster-province')?.value || 'Quảng Ngãi';
                let basemap = document.getElementById('export-raster-basemap')?.value || 'current';
                const zoom = document.getElementById('export-raster-zoom')?.value || '14';

                // Resolve 'current' basemap
                if (basemap === 'current') {
                    const cur = (window.mapController && window.mapController.currentBasemap) || 'google-sat';
                    if (cur.startsWith('google-hybrid')) basemap = 'google-hybrid';
                    else if (cur.startsWith('google')) basemap = 'google-sat';
                    else if (cur.startsWith('esri')) basemap = 'esri';
                    else if (cur.startsWith('planet')) basemap = 'planet';
                    else if (cur.startsWith('sentinel')) basemap = 'sentinel';
                    else if (cur.startsWith('nasa')) basemap = 'nasa';
                    else if (cur.startsWith('topo')) basemap = 'topo';
                    else basemap = 'google-sat';
                }

                let min_lon = 108.5, min_lat = 14.8, max_lon = 108.8, max_lat = 15.1;

                if (scopeMode === 'region') {
                    const lid = regionLayerSelect ? regionLayerSelect.value : null;
                    const layer = (this.allCatalogLayers || []).find(l => l.id === lid);
                    if (layer && (layer.bbox || layer.bounds)) {
                        const b = layer.bbox || layer.bounds;
                        min_lon = b[0];
                        min_lat = b[1];
                        max_lon = b[2];
                        max_lat = b[3];
                    } else if (window.mapController && window.mapController.map) {
                        const b = window.mapController.map.getBounds();
                        min_lon = b.getWest();
                        min_lat = b.getSouth();
                        max_lon = b.getEast();
                        max_lat = b.getNorth();
                    }
                } else {
                    if (window.mapController && window.mapController.map) {
                        const b = window.mapController.map.getBounds();
                        min_lon = b.getWest();
                        min_lat = b.getSouth();
                        max_lon = b.getEast();
                        max_lat = b.getNorth();
                    }
                }

                const params = new URLSearchParams({
                    min_lon: min_lon.toFixed(5),
                    min_lat: min_lat.toFixed(5),
                    max_lon: max_lon.toFixed(5),
                    max_lat: max_lat.toFixed(5),
                    province: prov,
                    basemap: basemap,
                    zoom: zoom
                });

                const exportUrl = `/api/export/satellite-raster?${params.toString()}`;
                const asciiProv = prov.includes('Ngãi') ? 'QuangNgai' : (prov.includes('Định') ? 'BinhDinh' : 'PhuYen');
                const defaultFilename = `VeTinh_${asciiProv}_VN2000_z${zoom}.zip`;

                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.innerHTML = `
                        <div style="padding: 12px; background: rgba(2, 132, 199, 0.15); border: 1px solid #0284c7; border-radius: 8px; color: #38bdf8; text-align: center;">
                            <div style="font-weight: 700; font-size: 13px; margin-bottom: 4px;">
                                ⏳ Đang nạp mảnh ảnh ${basemap.toUpperCase()} & nắn tọa độ VN-2000...
                            </div>
                            <div style="font-size: 11px; color: #94a3b8;">
                                Quá trình ghép ảnh và nén gói .ECW / .EWW / .PRJ mất khoảng 2 - 4 giây. Vui lòng chờ...
                            </div>
                        </div>
                    `;
                }

                downloadBtn.disabled = true;
                const originalBtnText = downloadBtn.innerHTML;
                downloadBtn.innerHTML = '⏳ Đang Xử Lý & Đóng Gói...';

                try {
                    const resp = await fetch(exportUrl);
                    if (!resp.ok) {
                        const errData = await resp.json().catch(() => null);
                        const msg = (errData && errData.detail) ? errData.detail : `Lỗi HTTP ${resp.status}`;
                        throw new Error(msg);
                    }

                    const blob = await resp.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);

                    let downloadFilename = defaultFilename;
                    const disposition = resp.headers.get('content-disposition');
                    if (disposition && disposition.includes('filename=')) {
                        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                        if (matches && matches[1]) {
                            downloadFilename = matches[1].replace(/['"]/g, '');
                        }
                    }

                    // Auto-trigger direct download
                    const dlLink = document.createElement('a');
                    dlLink.href = objectUrl;
                    dlLink.download = downloadFilename;
                    document.body.appendChild(dlLink);
                    dlLink.click();
                    document.body.removeChild(dlLink);

                    // Render prominent, clickable download card for user
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <div style="background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; border-radius: 8px; padding: 14px; margin-top: 10px; text-align: center;">
                                <div style="color: #34d399; font-weight: 800; font-size: 14px; margin-bottom: 6px;">
                                    ✅ ĐÃ XUẤT THÀNH CÔNG GÓI ẢNH VỆ TINH!
                                </div>
                                <div style="color: #cbd5e1; font-size: 12px; margin-bottom: 12px;">
                                    Tệp: <b>${downloadFilename}</b> (${sizeMb} MB) &nbsp;|&nbsp; Hệ tọa độ: <b>VN-2000 ${prov}</b>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">
                                    <a href="${objectUrl}" download="${downloadFilename}" class="btn-primary" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; padding: 12px 24px; font-weight: 800; font-size: 14px; background: linear-gradient(135deg, #059669, #10b981); color: #fff; border-radius: 6px; box-shadow: 0 4px 14px rgba(16,185,129,0.4); width: 90%;">
                                        📥 BẤM VÀO ĐÂY ĐỂ TẢI FILE VỀ MÁY (.ZIP)
                                    </a>
                                    <a href="${exportUrl}" target="_blank" style="font-size: 11px; color: #38bdf8; text-decoration: underline; margin-top: 4px;">
                                        🔗 Hoặc tải bằng liên kết trực tiếp từ máy chủ
                                    </a>
                                </div>
                                <div style="margin-top: 10px; font-size: 11px; color: #94a3b8; text-align: left; background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: 4px; line-height: 1.5;">
                                    💡 <b>Hướng dẫn sử dụng:</b> Giải nén file .ZIP, bạn sẽ có file ảnh <code>.ecw / .jpg</code> kèm file tọa độ thế giới <code>.eww / .jgw</code> và <code>.prj</code>. Kéo thả trực tiếp vào QGIS hoặc MapInfo là mở được ngay!
                                </div>
                            </div>
                        `;
                    }
                } catch (err) {
                    console.error('Export raster error:', err);
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 8px; padding: 12px; color: #f87171; font-size: 12px; margin-top: 10px; text-align: left;">
                                <b>❌ Lỗi khi xuất ảnh vệ tinh:</b> ${err.message}<br/>
                                <span style="font-size: 11px; color: #cbd5e1; margin-top: 4px; display: block;">
                                    Gợi ý: Nếu vùng xuất quá rộng, hãy chọn mức Zoom 14 hoặc thu nhỏ màn hình trước khi xuất.
                                </span>
                            </div>
                        `;
                    }
                } finally {
                    downloadBtn.disabled = false;
                    downloadBtn.innerHTML = originalBtnText;
                }
            });
        }
    }

    onProvinceChanged(provCode) {
        this.currentProvince = provCode;

        // 1. Highlight and show boundary of selected province on map
        if (window.mapController) {
            window.mapController.highlightProvince(provCode);
        }

        // 2. Filter plots list or stats if applicable
        const provFilterSelect = document.getElementById('filter-province');
        if (provFilterSelect) {
            const provMap = {
                'ALL': '',
                'QNG': 'Quảng Ngãi',
                'BDH': 'Bình Định',
                'PYE': 'Phú Yên'
            };
            provFilterSelect.value = provMap[provCode] || '';
            this.filterAndRenderPlots();
        }

        // 3. Keep raster export modal province choice in sync
        const exportProv = document.getElementById('export-raster-province');
        if (exportProv) {
            if (provCode === 'QNG') exportProv.value = 'Quảng Ngãi';
            else if (provCode === 'BDH') exportProv.value = 'Bình Định';
            else if (provCode === 'PYE') exportProv.value = 'Phú Yên';
        }
    }

    async loadInitialData() {
        try {
            let provData = null;
            try {
                const provRes = await fetch('/api/provinces');
                if (provRes.ok) provData = await provRes.json();
            } catch (e) {}
            if (!provData) {
                provData = [
                    { province: "Quảng Ngãi", total_plots: 345000, total_area_ha: 520000.0, fm_certified_count: 12000 },
                    { province: "Bình Định", total_plots: 2400, total_area_ha: 14200.0, fm_certified_count: 1800 },
                    { province: "Phú Yên", total_plots: 1850, total_area_ha: 9800.0, fm_certified_count: 1200 }
                ];
            }
            this._renderProvinceStats(provData);
            await this.filterAndRenderPlots();
        } catch (err) {
            console.error('Initial data load error:', err);
        }
    }

    _renderProvinceStats(data) {
        const totalArea = data.reduce((acc, p) => acc + p.total_area_ha, 0);
        const totalPlots = data.reduce((acc, p) => acc + p.total_plots, 0);
        const totalFm = data.reduce((acc, p) => acc + p.fm_certified_count, 0);

        const areaEl = document.getElementById('stat-total-area');
        const plotsEl = document.getElementById('stat-total-plots');
        const fmRateEl = document.getElementById('stat-fm-rate');

        if (areaEl) areaEl.innerHTML = `${totalArea.toFixed(1)} ha`;
        if (plotsEl) plotsEl.innerHTML = `${totalPlots} lô`;
        if (fmRateEl) fmRateEl.innerHTML = totalPlots > 0 ? `${Math.round((totalFm / totalPlots) * 100)}%` : '0%';
    }

    async filterAndRenderPlots() {
        const query = document.getElementById('forest-search-input')?.value || '';
        const province = document.getElementById('filter-province')?.value || '';
        const sbp = document.getElementById('filter-sbp')?.value || '';

        const params = new URLSearchParams();
        if (query) params.append('query', query);
        if (province) params.append('province', province);
        if (sbp) params.append('sbp_status', sbp);

        try {
            let geojson = null;
            try {
                const res = await fetch(`/api/plots?${params.toString()}`);
                if (res.ok) geojson = await res.json();
            } catch (e) {}

            if (geojson && geojson.features) {
                this.allPlots = geojson.features.map(f => f.properties);
                if (window.mapController) {
                    window.mapController.updatePlotsData(geojson);
                }
                this._renderPlotCards(this.allPlots);
                return;
            }

            // Client-side in-memory search fallback across all loaded layers
            const matching = [];
            if (window.layerDataCache) {
                const qLower = query.toLowerCase().trim();
                for (const lyr of Object.values(window.layerDataCache)) {
                    if (!lyr || !lyr.features) continue;
                    for (const f of lyr.features) {
                        const p = f.properties || {};
                        if (province && p.province && !p.province.includes(province)) continue;
                        if (qLower) {
                            const oName = (p.owner_name || p.chu_rung || '').toLowerCase();
                            const pId = String(p.id || p.so_thua || p.lo || '').toLowerCase();
                            const com = (p.commune || p.xa || '').toLowerCase();
                            const dist = (p.district || p.huyen || '').toLowerCase();
                            if (!oName.includes(qLower) && !pId.includes(qLower) && !com.includes(qLower) && !dist.includes(qLower)) {
                                continue;
                            }
                        }
                        matching.push(p);
                        if (matching.length >= 60) break;
                    }
                    if (matching.length >= 60) break;
                }
            }
            this.allPlots = matching;
            this._renderPlotCards(this.allPlots);
        } catch (err) {
            console.error('Error filtering plots:', err);
        }
    }

    _renderPlotCards(plots) {
        const listEl = document.getElementById('plots-list-container');
        const countEl = document.getElementById('results-count');
        if (countEl) countEl.innerHTML = `(${plots.length} kết quả)`;

        if (!listEl) return;
        if (plots.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; color: #94a3b8; padding: 40px 20px; font-size: 13px; line-height: 1.6;">
                    <div style="font-size: 32px; margin-bottom: 10px;">🗺️</div>
                    <b>Chưa có dữ liệu bản đồ cho khu vực này.</b><br/>
                    Vui lòng bấm nút <b>"+ Nhập File Bản Đồ (SHP)"</b> ở thanh tiêu đề để tải file Shapefile của tỉnh lên hệ thống.
                </div>
            `;
            return;
        }

        listEl.innerHTML = plots.map(p => `
            <div class="plot-card" onclick="window.app.onPlotClicked('${p.id}')">
                <div class="plot-card-header">
                    <div>
                        <div class="plot-card-title">${p.owner_name}</div>
                        <div class="plot-card-subtitle">${p.commune}, ${p.district} (${p.province})</div>
                    </div>
                    <span class="badge ${p.sbp_status === 'SBP_COMPLIANT' ? 'badge-fm' : (p.sbp_status === 'HIGH_RISK' ? 'badge-risk' : 'badge-sbp')}">
                        ${p.sbp_status === 'SBP_COMPLIANT' ? 'Đạt FM/SBP' : (p.sbp_status === 'HIGH_RISK' ? 'Rủi ro' : 'Có kiểm soát')}
                    </span>
                </div>
                <div class="plot-card-grid">
                    <div>Mã lô: <b>${p.id}</b></div>
                    <div>Diện tích: <b>${p.area_ha} ha</b></div>
                    <div>Loài cây: <b>${p.tree_species}</b></div>
                    <div>Nguồn: <b>${p.source_type || 'Kiểm kê'}</b></div>
                </div>
            </div>
        `).join('');
    }

    // ==========================================
    // LAYER CATALOG MANAGEMENT
    // ==========================================
    async loadLayersCatalog() {
        const container = document.getElementById('layers-list-container');
        if (!container) return;

        try {
            let layers = null;

            // 1. Try User Map Layers API if user workspace is active
            if (window.userWorkspace && window.userWorkspace.currentMap) {
                try {
                    const headers = window.userWorkspace.token ? { 'Authorization': `Bearer ${window.userWorkspace.token}` } : {};
                    const res = await fetch(`/api/user/maps/${window.userWorkspace.currentMap.id}/layers`, { headers });
                    if (res.ok) {
                        const mData = await res.json();
                        const priv = mData.private_layers || [];
                        const sys = mData.system_layers || [];
                        layers = [...priv, ...sys];
                    }
                } catch(e){}
            }

            // 2. Fallback to /api/layers
            if (!layers) {
                try {
                    const res = await fetch('/api/layers');
                    if (res.ok) layers = await res.json();
                } catch (e) {}
            }

            // 3. Fallback to data/layers_catalog.json
            if (!layers) {
                try {
                    const res2 = await fetch('data/layers_catalog.json');
                    if (res2.ok) layers = await res2.json();
                } catch (e) {}
            }
            if (!layers) layers = [];
            this.allCatalogLayers = layers;

            // Synchronize all vector & raster layers directly onto MapLibre
            if (window.mapController) {
                await window.mapController.syncCatalogLayers(layers);
            }
            
            // Update attribute table layer select dropdown (vector layers only)
            const selectEl = document.getElementById('attr-layer-select');
            if (selectEl) {
                selectEl.innerHTML = layers.filter(l => l.format !== 'mbtiles').map(l => `
                    <option value="${l.id}">${l.name} (${l.province || ''} - ${l.feature_count} thửa)</option>
                `).join('');
            }

            const curMap = (window.userWorkspace && window.userWorkspace.currentMap);
            const curMapName = curMap ? curMap.name : 'Bản Đồ Mặc Định';
            const curUser = (window.userWorkspace && window.userWorkspace.currentUser);
            const userName = curUser ? curUser.full_name : 'Chưa đăng nhập';
            const privCount = layers.filter(l => l.is_private).length;
            const sysCount = layers.filter(l => !l.is_private).length;

            const workspaceBanner = `
                <div class="user-workspace-banner" style="margin-bottom: 12px; padding: 10px 12px; background: rgba(2, 132, 199, 0.12); border: 1px solid rgba(2, 132, 199, 0.3); border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-size: 11px; color: #94a3b8;">Không gian làm việc:</span>
                        <span style="font-size: 11px; color: #38bdf8; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                            <span>👤</span> <span>${userName}</span>
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <div style="font-size: 13px; font-weight: 800; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            🗺️ ${curMapName}
                        </div>
                        <button type="button" class="btn-header" onclick="window.userWorkspace.openMyMapsModal()" style="font-size: 11px; padding: 4px 8px; background: #0284c7; color: #fff; border-color: #38bdf8; font-weight: 700; white-space: nowrap;">
                            Đổi Bản Đồ
                        </button>
                    </div>
                    <div style="margin-top: 6px; font-size: 10px; color: #94a3b8; display: flex; gap: 10px;">
                        <span>Lớp cá nhân: <b style="color: #34d399;">${privCount}</b></span>
                        <span>Lớp hệ thống: <b style="color: #fbbf24;">${sysCount}</b></span>
                    </div>
                </div>
            `;

            if (layers.length === 0) {
                container.innerHTML = workspaceBanner + `
                    <div style="text-align: center; color: #94a3b8; padding: 30px 15px; font-size: 12px; line-height: 1.6;">
                        Chưa có lớp bản đồ nào trong không gian này.<br/>
                        Bấm nút <b>"+ Nhập Bản Đồ"</b> hoặc công cụ CAD ở góc trên để thêm dữ liệu riêng của bạn.
                    </div>
                `;
                return;
            }

            container.innerHTML = workspaceBanner + layers.map((l, idx) => {
                    const isMBTiles = (l.format === 'mbtiles');
                    const palette = (window.mapController && window.mapController.layerPalette)
                        ? window.mapController.layerPalette[idx % window.mapController.layerPalette.length]
                        : { fill: '#10b981', border: '#059669' };

                    let curOpacity = (l.opacity !== undefined) ? l.opacity : (isMBTiles ? 0.85 : 0.75);
                    if (this.layerOpacities && this.layerOpacities[l.id] !== undefined) {
                        curOpacity = this.layerOpacities[l.id];
                    } else {
                        try {
                            const saved = localStorage.getItem('layer_opacity_' + l.id);
                            if (saved !== null) curOpacity = parseFloat(saved);
                        } catch (e) {}
                    }

                    const scopeBadge = l.is_private 
                        ? `<span class="layer-type-tag" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: #10b981; font-weight: 700;">🔒 Lớp Cá Nhân</span>`
                        : `<span class="layer-type-tag" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: #f59e0b; font-weight: 700;">🌐 Hệ Thống</span>`;

                    if (isMBTiles) {
                        return `
                            <div class="layer-card" style="border-left: 3px solid #0284c7;">
                                <div class="layer-card-header">
                                    <div>
                                        <div class="layer-card-title">
                                            <span class="layer-color-badge" style="background: #0284c7;"></span>
                                            <span>📦 ${l.name}</span>
                                        </div>
                                        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Tỉnh: <b>${l.province}</b> &nbsp;|&nbsp; File: <code>${l.filename}</code></div>
                                    </div>
                                    <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                                        <span class="layer-type-tag" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border-color: #0284c7;">MBTiles</span>
                                        ${scopeBadge}
                                    </div>
                                </div>
                                <div class="layer-card-stats">
                                    <span>Mảnh Tile: <b>${l.feature_count}</b></span>
                                    <span>Cấp Zoom: <b>Z${l.minzoom || 0} - Z${l.maxzoom || 18}</b></span>
                                    <span>Định dạng: <b>${(l.tile_format || 'png').toUpperCase()}</b></span>
                                </div>

                                <!-- Per-layer Opacity Slider -->
                                <div class="layer-card-opacity" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0; padding: 6px 10px; background: rgba(15, 23, 42, 0.55); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08);">
                                    <span style="font-size: 11px; color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
                                        <span>🌓 Độ trong suốt lớp:</span>
                                        <b id="layer-opacity-val-${l.id}" style="color: #38bdf8; font-weight: 700; font-family: monospace;">${Math.round(curOpacity * 100)}%</b>
                                    </span>
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <input type="range" class="layer-slider" min="0" max="1" step="0.05" value="${curOpacity}" 
                                               style="width: 105px; height: 5px; accent-color: #38bdf8; cursor: pointer;"
                                               oninput="window.app.setIndividualLayerOpacity('${l.id}', this.value)" />
                                    </div>
                                </div>

                                <div class="layer-card-actions">
                                    <button class="btn-layer-action" id="btn-toggle-layer-${l.id}" onclick="window.app.toggleLayer('${l.id}')">
                                        👁️ Đang Hiện
                                    </button>
                                    <button class="btn-layer-action" onclick="window.app.zoomToLayer('${l.id}')">
                                        🔍 Phóng Tới Lớp
                                    </button>
                                    <button class="btn-layer-action delete" onclick="window.app.deleteLayer('${l.id}')">
                                        🗑️ Xóa
                                    </button>
                                </div>
                            </div>
                        `;
                    }

                    return `
                        <div class="layer-card" style="border-left: 3px solid ${palette.fill};">
                            <div class="layer-card-header">
                                <div>
                                    <div class="layer-card-title">
                                        <span class="layer-color-badge" style="background: ${palette.fill};"></span>
                                        <span>🗺️ ${l.name}</span>
                                    </div>
                                    <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Tỉnh: <b>${l.province}</b> &nbsp;|&nbsp; File: <code>${l.filename || l.id}</code></div>
                                </div>
                                <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                                    <span class="layer-type-tag" style="border-color: ${palette.border}; color: ${palette.fill};">${l.source_type}</span>
                                    ${scopeBadge}
                                </div>
                            </div>
                            <div class="layer-card-stats">
                                <span>Thửa/Lô: <b>${l.feature_count}</b></span>
                                <span>Diện tích: <b>${l.total_area_ha} ha</b></span>
                                <span>Trường DBF: <b>${l.columns ? l.columns.length : 0}</b></span>
                            </div>

                            <!-- Per-layer Opacity Slider -->
                            <div class="layer-card-opacity" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0; padding: 6px 10px; background: rgba(15, 23, 42, 0.55); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08);">
                                <span style="font-size: 11px; color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
                                    <span>🌓 Độ trong suốt lô:</span>
                                    <b id="layer-opacity-val-${l.id}" style="color: ${palette.fill}; font-weight: 700; font-family: monospace;">${Math.round(curOpacity * 100)}%</b>
                                </span>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <input type="range" class="layer-slider" min="0" max="1" step="0.05" value="${curOpacity}" 
                                           style="width: 105px; height: 5px; accent-color: ${palette.fill}; cursor: pointer;"
                                           oninput="window.app.setIndividualLayerOpacity('${l.id}', this.value)" />
                                </div>
                            </div>

                            <div class="layer-card-actions">
                                <button class="btn-layer-action" id="btn-toggle-layer-${l.id}" onclick="window.app.toggleLayer('${l.id}')">
                                    👁️ Đang Hiện
                                </button>
                                <button class="btn-layer-action" onclick="window.app.openAttributeTableModal('${l.id}')">
                                    📋 Xem Bảng Thuộc Tính
                                </button>
                                <button class="btn-layer-action" style="color: #fde047; border-color: rgba(234, 179, 8, 0.4);" onclick="window.app.openFractionalLabelModal('${l.id}')" title="Cài đặt hiển thị nhãn phân số (Tử 2 trường / Mẫu 2 trường)">
                                    🏷️ Nhãn Phân Số
                                </button>
                                <button class="btn-layer-action" onclick="window.app.zoomToLayer('${l.id}')">
                                    🔍 Phóng Tới Lớp
                                </button>
                                <button class="btn-layer-action delete" onclick="window.app.deleteLayer('${l.id}')">
                                    🗑️ Xóa
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
        } catch (err) {
            console.error('Error loading layers catalog:', err);
        }
    }

    setIndividualLayerOpacity(layerId, val) {
        const num = parseFloat(val);
        if (!this.layerOpacities) this.layerOpacities = {};
        this.layerOpacities[layerId] = num;
        try {
            localStorage.setItem('layer_opacity_' + layerId, num.toString());
        } catch (e) {}

        const valEl = document.getElementById(`layer-opacity-val-${layerId}`);
        if (valEl) {
            valEl.textContent = `${Math.round(num * 100)}%`;
        }

        if (window.mapController) {
            window.mapController.setSingleLayerOpacity(layerId, num);
        }
    }

    toggleLayer(layerId) {
        if (!window.mapController) return;
        const isVisible = window.mapController.toggleLayerVisibility(layerId);
        const btn = document.getElementById(`btn-toggle-layer-${layerId}`);
        if (btn) {
            btn.innerHTML = isVisible ? '👁️ Đang Hiện' : '👁️ Đang Ẩn';
            btn.classList.toggle('is-hidden', !isVisible);
        }
    }

    zoomToLayer(layerId) {
        if (window.mapController) {
            window.mapController.zoomToLayer(layerId);
        }
    }

    zoomToLayerBBox(bbox) {
        if (window.mapController && bbox) {
            window.mapController.fitBounds(bbox);
        }
    }

    async deleteLayer(layerId) {
        if (!confirm('Bạn có chắc chắn muốn xóa lớp bản đồ này khỏi hệ thống vĩnh viễn?')) return;
        try {
            let deleted = false;
            // 1. Try user private layer deletion first
            if (window.userWorkspace && window.userWorkspace.token) {
                try {
                    const res = await fetch(`/api/user/layers/${layerId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${window.userWorkspace.token}` }
                    });
                    if (res.ok) deleted = true;
                } catch (e) {}
            }
            // 2. Try global layer deletion
            if (!deleted) {
                try {
                    const res2 = await fetch(`/api/layers/${layerId}`, { method: 'DELETE' });
                    if (res2.ok) deleted = true;
                } catch (e) {}
            }
            // 3. Fallback to offline localStorage
            if (!deleted && window.userWorkspace) {
                window.userWorkspace.deleteOfflineLayer(layerId);
                deleted = true;
            }

            // Clean up layer from map immediately
            if (window.mapController) {
                window.mapController.removeVectorLayer(layerId);
                if (window.mapController.removeRasterLayer) {
                    window.mapController.removeRasterLayer(layerId);
                }
                if (layerId === 'layer_f3f5750f') {
                    const m = window.mapController.map;
                    if (m) {
                        if (m.getLayer('vector-sym-layer_f3f5750f-detail')) m.removeLayer('vector-sym-layer_f3f5750f-detail');
                        if (m.getLayer('vector-line-layer_f3f5750f-detail')) m.removeLayer('vector-line-layer_f3f5750f-detail');
                        if (m.getLayer('vector-fill-layer_f3f5750f-detail')) m.removeLayer('vector-fill-layer_f3f5750f-detail');
                        if (m.getSource('vector-src-layer_f3f5750f-detail')) m.removeSource('vector-src-layer_f3f5750f-detail');
                    }
                }
            }
            if (window.layerDataCache && window.layerDataCache[layerId]) {
                delete window.layerDataCache[layerId];
            }

            alert('Đã xóa lớp bản đồ thành công!');
            // Re-render layer menu in UI
            await this.loadLayersCatalog();
        } catch (err) {
            console.error('Lỗi khi xóa lớp bản đồ:', err);
            alert('Lỗi khi xóa lớp bản đồ: ' + err);
        }
    }

    // ==========================================
    // ATTRIBUTE TABLE INSPECTOR
    // ==========================================
    async openAttributeTableModal(layerId = null) {
        const modal = document.getElementById('attribute-modal-overlay');
        if (!modal) return;

        const selectEl = document.getElementById('attr-layer-select');
        if (layerId && selectEl) {
            selectEl.value = layerId;
        }

        this.currentAttrLayerId = selectEl ? selectEl.value : layerId;
        this.currentAttrPage = 1;

        modal.classList.add('open');
        await this.fetchAndRenderAttributeTable();
    }

    async fetchAndRenderAttributeTable() {
        const container = document.getElementById('attr-table-container');
        const infoEl = document.getElementById('attr-pagination-info');
        const pageEl = document.getElementById('attr-page-number');
        const searchVal = document.getElementById('attr-search-input')?.value || '';

        if (!this.currentAttrLayerId) {
            if (container) container.innerHTML = '<div style="padding: 30px; color: #94a3b8; text-align: center;">Chưa chọn lớp bản đồ nào.</div>';
            return;
        }

        try {
            let data = null;
            try {
                const res = await fetch(`/api/layers/${this.currentAttrLayerId}/attributes?page=${this.currentAttrPage}&page_size=50&search=${encodeURIComponent(searchVal)}`);
                if (res.ok) data = await res.json();
            } catch (e) {}

            if (!data) {
                const cached = window.layerDataCache && window.layerDataCache[this.currentAttrLayerId];
                if (cached && cached.features) {
                    let rows = [];
                    const internalSkip = new Set(["color", "layer_id", "layer_name", "source_type", "area_m2", "province_code", "malr3", "sbp_status", "fm_status"]);
                    const foundCols = new Set();
                    
                    for (const f of cached.features) {
                        const p = f.properties || {};
                        const row = {};
                        for (const [k, v] of Object.entries(p)) {
                            if (!internalSkip.has(k)) {
                                row[k] = v;
                                foundCols.add(k);
                            }
                        }
                        rows.push(row);
                    }
                    
                    if (searchVal) {
                        const sLow = searchVal.toLowerCase();
                        rows = rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(sLow)));
                    }
                    
                    const preferredOrder = ["id", "owner_name", "sub_compartment", "compartment", "lot", "area_ha", "ldlr_t", "tree_species", "commune", "district", "planting_year"];
                    const allCols = [...preferredOrder.filter(c => foundCols.has(c)), ...[...foundCols].filter(c => !preferredOrder.includes(c)).sort()];
                    
                    const total = rows.length;
                    const pageSize = 50;
                    const startIdx = (this.currentAttrPage - 1) * pageSize;
                    const paginatedRows = rows.slice(startIdx, startIdx + pageSize);
                    
                    data = {
                        total: total,
                        columns: allCols,
                        rows: paginatedRows,
                        page: this.currentAttrPage,
                        page_size: pageSize,
                        total_pages: Math.max(1, Math.ceil(total / pageSize))
                    };
                }
            }

            if (data) {
                this.currentAttrData = data;

                if (infoEl) infoEl.innerHTML = `Hiển thị ${(data.page-1)*data.page_size + 1} - ${Math.min(data.page*data.page_size, data.total)} / Tổng số ${data.total} đối tượng`;
                if (pageEl) pageEl.innerHTML = `${data.page} / ${data.total_pages}`;

                if (data.rows.length === 0) {
                    if (container) container.innerHTML = '<div style="padding: 40px; color: #94a3b8; text-align: center;">Không có dữ liệu phù hợp với tìm kiếm.</div>';
                    return;
                }

                // Render HTML Table
                const cols = data.columns;
                const toUni = (v) => (window.VnGIS && typeof v === 'string') ? window.VnGIS.tcvn3ToUnicode(v) : v;
                let html = '<table class="attribute-table"><thead><tr>';
                cols.forEach(c => html += `<th>${toUni(c)}</th>`);
                html += '</tr></thead><tbody>';

                data.rows.forEach(r => {
                    html += '<tr>';
                    cols.forEach(c => {
                        const rawVal = r[c] !== undefined && r[c] !== null ? r[c] : '-';
                        const val = toUni(rawVal);
                        html += `<td>${val}</td>`;
                    });
                    html += '</tr>';
                });
                html += '</tbody></table>';

                if (container) container.innerHTML = html;
            }
        } catch (err) {
            console.error('Error fetching attribute table:', err);
        }
    }

    exportCurrentTableToCSV() {
        if (!this.currentAttrData || !this.currentAttrData.rows || this.currentAttrData.rows.length === 0) {
            alert('Không có dữ liệu để xuất CSV!');
            return;
        }

        const toUni = (v) => (window.VnGIS && typeof v === 'string') ? window.VnGIS.tcvn3ToUnicode(v) : v;
        const cols = this.currentAttrData.columns;
        const rows = this.currentAttrData.rows;

        let csvContent = '\uFEFF'; // UTF-8 BOM
        csvContent += cols.map(c => `"${String(toUni(c)).replace(/"/g, '""')}"`).join(',') + '\n';

        rows.forEach(r => {
            const rowValues = cols.map(c => {
                let v = r[c] !== undefined && r[c] !== null ? String(toUni(r[c])) : '';
                v = v.replace(/"/g, '""');
                return `"${v}"`;
            });
            csvContent += rowValues.join(',') + '\n';
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `BangThuocTinh_${this.currentAttrLayerId}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // ==========================================
    // RED BOOK AUDIT LOG (SỔ ĐỎ ĐÃ TÌM)
    // ==========================================
    async loadRedBookLogs() {
        const container = document.getElementById('redbook-logs-container');
        if (!container) return;

        const q = document.getElementById('redbook-search-input')?.value || '';
        const status = document.getElementById('filter-redbook-status')?.value || '';

        const params = new URLSearchParams();
        if (q) params.append('query', q);
        if (status) params.append('status', status);

        try {
            const res = await fetch(`/api/redbooks/list?${params.toString()}`);
            if (res.ok) {
                const logs = await res.json();

                if (logs.length === 0) {
                    container.innerHTML = `
                        <div style="text-align: center; color: #94a3b8; padding: 40px 15px; font-size: 12px; line-height: 1.6;">
                            Chưa có hồ sơ sổ đỏ nào được ghi nhận.<br/>
                            Hãy tải ảnh sơ đồ thửa đất ở tab <b>'So Khớp Sổ Đỏ'</b> để bắt đầu dò tìm trên file SHP.
                        </div>
                    `;
                    return;
                }

                container.innerHTML = logs.map(r => `
                    <div class="redbook-log-card" id="rb-card-${r.id}">
                        <div class="redbook-log-header">
                            <div>
                                <span class="redbook-log-id">📜 ${r.id}</span>
                                <span style="font-size: 11px; color: #94a3b8; margin-left: 6px;">(${r.scanned_date})</span>
                            </div>
                            <span class="redbook-badge ${r.status === 'Đã tìm thấy vị trí' ? 'found' : 'not-found'}">
                                ${r.status}
                            </span>
                        </div>
                        <div style="font-size: 12px; color: #f8fafc;">
                            Chủ đất: <b>${r.owner_name}</b> &nbsp;|&nbsp; Thửa số: <b>${r.parcel_no}</b>, Tờ số: <b>${r.sheet_no}</b><br/>
                            Địa chỉ: ${r.commune}, ${r.district} (${r.province})<br/>
                            Lô SHP tương đồng: <b style="color: #38bdf8;">${r.matched_plot_id}</b> (Khớp: <b style="color: #34d399;">${r.similarity_percent}%</b>)
                        </div>
                        <div style="margin-top: 4px;">
                            <label style="font-size: 11px; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 4px;">
                                📝 Ghi Chú Xác Minh Thực Địa:
                            </label>
                            <textarea class="redbook-notes-box" id="notes-${r.id}" placeholder="Ghi chú kết quả đối chiếu, tình trạng ranh giới...">${r.survey_notes || ''}</textarea>
                            <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px;">
                                <button class="btn-primary" style="padding: 4px 10px; font-size: 11px;" onclick="window.app.saveRedBookNotes('${r.id}')">
                                    💾 Lưu Ghi Chú
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        } catch (err) {
            console.error('Error loading redbook logs:', err);
        }
    }

    async saveRedBookNotes(recordId) {
        const notesBox = document.getElementById(`notes-${recordId}`);
        const notes = notesBox ? notesBox.value : '';

        try {
            const res = await fetch(`/api/redbooks/${recordId}/notes`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: notes })
            });

            if (res.ok) {
                alert('✅ Đã lưu thành công ghi chú thực địa cho hồ sơ sổ đỏ!');
            }
        } catch (err) {
            alert('Lỗi khi lưu ghi chú: ' + err);
        }
    }

    // ==========================================
    // MAP FILE IMPORT (.ZIP / .GEOJSON)
    // ==========================================
    async uploadMapFile(file) {
        const statusEl = document.getElementById('import-status-msg');
        const provEl = document.getElementById('import-province-select');
        const nameEl = document.getElementById('import-layer-name');
        const sourceEl = document.getElementById('import-source-type');

        const prov = provEl ? provEl.value : 'Quảng Ngãi';
        const layerName = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : file.name.replace(/\.[^/.]+$/, '');
        const sourceType = sourceEl ? sourceEl.value : 'Kiểm kê rừng';

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(14, 165, 233, 0.2)';
            statusEl.style.borderColor = '#0284c7';
            statusEl.style.color = '#38bdf8';
            statusEl.innerHTML = `⏳ Đang xử lý file bản đồ (Shapefile / MapInfo), chuyển đổi tọa độ VN-2000 và lưu vĩnh viễn vào lớp '${layerName}'...`;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('province', prov);
        formData.append('layer_name', layerName);
        formData.append('source_type', sourceType);

        const fetchHeaders = {};
        if (window.userWorkspace && window.userWorkspace.currentMap) {
            formData.append('map_id', window.userWorkspace.currentMap.id);
            if (window.userWorkspace.token) {
                fetchHeaders['Authorization'] = `Bearer ${window.userWorkspace.token}`;
            }
        }

        try {
            const res = await fetch('/api/map/import', {
                method: 'POST',
                headers: fetchHeaders,
                body: formData
            });

            const data = await res.json();
            if (!res.ok) {
                if (statusEl) {
                    statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
                    statusEl.style.borderColor = '#ef4444';
                    statusEl.style.color = '#f87171';
                    statusEl.innerHTML = `❌ ${data.detail || 'Lỗi xử lý file bản đồ'}`;
                }
                return;
            }

            if (statusEl) {
                statusEl.style.background = 'rgba(16, 185, 129, 0.2)';
                statusEl.style.borderColor = '#10b981';
                statusEl.style.color = '#34d399';
                statusEl.innerHTML = `🎉 ${data.message}`;
            }

            await this.refreshAll();

            // Zoom map to imported layer bounds or province
            if (data.layer && (data.layer.bbox || data.layer.bounds) && window.mapController) {
                window.mapController.fitBounds(data.layer.bbox || data.layer.bounds);
            } else if (data.layers && data.layers.length > 0 && window.mapController) {
                const latest = data.layers[data.layers.length - 1];
                if (latest.bbox || latest.bounds) {
                    window.mapController.fitBounds(latest.bbox || latest.bounds);
                }
            } else {
                const provCode = prov.includes('Ngãi') ? 'QNG' : (prov.includes('Định') ? 'BDH' : 'PYE');
                if (window.mapController) {
                    window.mapController.focusProvince(provCode);
                }
            }

        } catch (err) {
            console.error('Import map error:', err);
            if (statusEl) {
                statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
                statusEl.style.borderColor = '#ef4444';
                statusEl.style.color = '#f87171';
                statusEl.innerHTML = `❌ Không thể kết nối tới máy chủ để tải file`;
            }
        }
    }

    async refreshAll() {
        await this.loadInitialData();
        await this.loadLayersCatalog();
        await this.loadRedBookLogs();
    }

    async onPlotClicked(plotId) {
        try {
            const res = await fetch(`/api/plots/${plotId}`);
            if (res.ok) {
                const data = await res.json();
                const p = data.plot;
                const comp = data.compliance;

                const modalBody = document.getElementById('modal-plot-body');
                const modalOverlay = document.getElementById('plot-modal-overlay');
                if (!modalBody || !modalOverlay) return;

                modalBody.innerHTML = `
                    <div style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px; margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <h2 style="font-size: 20px; font-weight: 800; color: #fff;">${p.owner_name}</h2>
                                <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Mã Lô: <b>${p.id}</b> | Nguồn: <b>${p.layer_name || 'SHP'}</b></div>
                            </div>
                            <span class="badge ${p.sbp_status === 'SBP_COMPLIANT' ? 'badge-fm' : (p.sbp_status === 'HIGH_RISK' ? 'badge-risk' : 'badge-sbp')}">
                                ${comp.sbp_claim}
                            </span>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px;">
                        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Thông Tin Chủ Rừng & Pháp Lý</div>
                            <div style="font-size: 13px; color: #f8fafc; margin-top: 6px;">
                                👤 <b>CCCD:</b> ${p.cccd}<br/>
                                📞 <b>Điện thoại:</b> ${p.phone}<br/>
                                📍 <b>Địa chỉ:</b> ${p.commune}, ${p.district}, ${p.province}<br/>
                                📜 <b>Tiểu khu:</b> ${p.sub_compartment} | <b>Khoảnh:</b> ${p.compartment} | <b>Lô:</b> ${p.lot}
                            </div>
                        </div>

                        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Thông Số Lâm Sinh & Sinh Khối</div>
                            <div style="font-size: 13px; color: #f8fafc; margin-top: 6px;">
                                🌲 <b>Loài cây:</b> ${p.tree_species}<br/>
                                📅 <b>Năm trồng:</b> ${p.planting_year} (Tuổi: ${2026 - p.planting_year} năm)<br/>
                                📏 <b>Diện tích:</b> ${p.area_ha} ha (${(p.area_ha * 10000).toLocaleString('vi-VN')} m²)<br/>
                                ⚖️ <b>Sản lượng ước tính:</b> ${(p.area_ha * 85.0).toFixed(1)} tấn dăm/viên nén
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        <button class="btn-primary" style="flex: 1;" onclick="window.app.fillSurveyForPlot('${p.id}')">
                            📋 Lập Phiếu Khảo Sát Thực Địa
                        </button>
                        <button class="btn-primary" style="background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: #fff;" onclick="window.mapController.flyToPlot([${p.centroid}], 16); document.getElementById('plot-modal-overlay').classList.remove('open');">
                            🔍 Định Vị Bản Đồ
                        </button>
                    </div>
                `;
                modalOverlay.classList.add('open');
            }
        } catch (err) {
            console.error('Error fetching plot details:', err);
        }
    }

    fillSurveyForPlot(plotId) {
        const modalOverlay = document.getElementById('plot-modal-overlay');
        if (modalOverlay) modalOverlay.classList.remove('open');

        const fieldTab = document.querySelector('[data-tab="tab-field"]');
        if (fieldTab) fieldTab.click();

        const input = document.getElementById('survey-plot-id');
        if (input) input.value = plotId;
    }

    // ==========================================
    // TOOL 1: GO TO COORDINATES (VN-2000 & WGS84)
    // ==========================================
    setupCoordSearchModal() {
        const modal = document.getElementById('coord-search-modal-overlay');
        const openBtn = document.getElementById('btn-open-coord-search-modal');
        const closeBtn = document.getElementById('coord-search-modal-close-btn');

        if (!modal || !openBtn) return;

        openBtn.addEventListener('click', () => {
            modal.classList.add('open');
            modal.classList.add('active');
        });

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.classList.remove('open');
                modal.classList.remove('active');
            });
        }

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('open');
                modal.classList.remove('active');
            }
        });

        // Tab Switching
        const tabVn2000 = document.getElementById('tab-coord-vn2000');
        const tabWgs84 = document.getElementById('tab-coord-wgs84');
        const formVn2000 = document.getElementById('form-coord-vn2000');
        const formWgs84 = document.getElementById('form-coord-wgs84');

        let currentMode = 'vn2000';

        if (tabVn2000 && tabWgs84) {
            tabVn2000.addEventListener('click', () => {
                tabVn2000.classList.add('active');
                tabWgs84.classList.remove('active');
                formVn2000.style.display = 'block';
                formWgs84.style.display = 'none';
                currentMode = 'vn2000';
            });
            tabWgs84.addEventListener('click', () => {
                tabWgs84.classList.add('active');
                tabVn2000.classList.remove('active');
                formWgs84.style.display = 'block';
                formVn2000.style.display = 'none';
                currentMode = 'wgs84';
            });
        }

        // Quick Paste Listener
        const quickPaste = document.getElementById('coord-quick-paste');
        if (quickPaste) {
            quickPaste.addEventListener('input', () => {
                const val = quickPaste.value.trim();
                if (!val) return;
                const parsed = (window.VnGIS && window.VnGIS.parseCoordinateInput)
                    ? window.VnGIS.parseCoordinateInput(val, parseFloat(document.getElementById('coord-vn2000-province')?.value || 108.0))
                    : null;
                if (parsed) {
                    if (parsed.type === 'VN2000') {
                        document.getElementById('coord-input-x').value = parsed.x;
                        document.getElementById('coord-input-y').value = parsed.y;
                        if (tabVn2000) tabVn2000.click();
                    } else if (parsed.type === 'WGS84') {
                        document.getElementById('coord-input-lat').value = parsed.lat;
                        document.getElementById('coord-input-lon').value = parsed.lon;
                        if (tabWgs84) tabWgs84.click();
                    }
                }
            });
        }

        // Clear Inputs
        const clearBtn = document.getElementById('btn-clear-coord-inputs');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                document.getElementById('coord-input-x').value = '';
                document.getElementById('coord-input-y').value = '';
                document.getElementById('coord-input-lat').value = '';
                document.getElementById('coord-input-lon').value = '';
                if (quickPaste) quickPaste.value = '';
            });
        }

        // Execute Search
        const execBtn = document.getElementById('btn-execute-coord-search');
        if (execBtn) {
            execBtn.addEventListener('click', () => {
                const zoomChoice = parseInt(document.getElementById('coord-zoom-choice')?.value || '19', 10);
                let targetLat = null;
                let targetLon = null;
                let targetLabel = '';

                if (currentMode === 'vn2000') {
                    const x = parseFloat(document.getElementById('coord-input-x')?.value);
                    const y = parseFloat(document.getElementById('coord-input-y')?.value);
                    const provSelect = document.getElementById('coord-vn2000-province');
                    const ktt = parseFloat(provSelect?.value || '108.0');
                    const provName = provSelect?.options[provSelect.selectedIndex]?.dataset.prov || 'Tọa độ VN-2000';

                    if (isNaN(x) || isNaN(y)) {
                        alert('Vui lòng nhập đầy đủ tọa độ X (Bắc) và Y (Đông) của hệ VN-2000!');
                        return;
                    }

                    if (window.VnGIS && window.VnGIS.vn2000ToWgs84) {
                        const wgs = window.VnGIS.vn2000ToWgs84(x, y, ktt);
                        targetLat = wgs.lat;
                        targetLon = wgs.lon;
                        targetLabel = `${provName}: X=${x.toLocaleString()}, Y=${y.toLocaleString()}`;
                    }
                } else {
                    const lat = parseFloat(document.getElementById('coord-input-lat')?.value);
                    const lon = parseFloat(document.getElementById('coord-input-lon')?.value);

                    if (isNaN(lat) || isNaN(lon)) {
                        alert('Vui lòng nhập đầy đủ Vĩ độ (Lat) và Kinh độ (Lon) của hệ WGS84!');
                        return;
                    }

                    targetLat = lat;
                    targetLon = lon;
                    targetLabel = `WGS84: ${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
                }

                if (targetLat !== null && targetLon !== null && window.mapController) {
                    window.mapController.goToCoordinate(targetLat, targetLon, zoomChoice, targetLabel);
                    modal.classList.remove('open');
                    modal.classList.remove('active');
                }
            });
        }
    }

    // ==========================================
    // TOOL 2: TCVN3 <-> UNICODE FONT CONVERTER
    // ==========================================
    setupFontConverterModal() {
        const modal = document.getElementById('font-converter-modal-overlay');
        const openBtn = document.getElementById('btn-open-font-converter-modal');
        const closeBtn = document.getElementById('font-converter-modal-close-btn');

        if (!modal || !openBtn) return;

        openBtn.addEventListener('click', () => {
            modal.classList.add('open');
            modal.classList.add('active');
        });

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.classList.remove('open');
                modal.classList.remove('active');
            });
        }

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('open');
                modal.classList.remove('active');
            }
        });

        const dirLabel = document.getElementById('font-conv-direction-label');
        const toggleDirBtn = document.getElementById('btn-toggle-font-direction');
        const sourceLabel = document.getElementById('font-source-label');
        const targetLabel = document.getElementById('font-target-label');
        const sourceText = document.getElementById('font-source-text');
        const targetText = document.getElementById('font-target-text');
        const execBtn = document.getElementById('btn-execute-font-convert');
        const sampleBtn = document.getElementById('btn-sample-tcvn3');
        const clearBtn = document.getElementById('btn-clear-font-source');
        const copyBtn = document.getElementById('btn-copy-font-result');

        let isTcvnToUni = true;

        const updateLabels = () => {
            if (isTcvnToUni) {
                dirLabel.innerHTML = 'TCVN3 (.VNTime / ABC) ➔ Unicode (UTF-8)';
                dirLabel.style.color = '#c084fc';
                sourceLabel.innerHTML = 'Văn bản gốc (TCVN3 / .VNTime):';
                targetLabel.innerHTML = 'Kết quả chuyển đổi (Unicode UTF-8):';
                sourceText.placeholder = 'Nhập hoặc dán chữ lỗi font TCVN3 vào đây... (Ví dụ: S¬n Hµ, Trµ Bång, Thöa ®Êt sè...)';
            } else {
                dirLabel.innerHTML = 'Unicode (UTF-8) ➔ TCVN3 (.VNTime / ABC)';
                dirLabel.style.color = '#38bdf8';
                sourceLabel.innerHTML = 'Văn bản gốc (Unicode UTF-8):';
                targetLabel.innerHTML = 'Kết quả chuyển đổi (TCVN3 / .VNTime):';
                sourceText.placeholder = 'Nhập chữ tiếng Việt Unicode chuẩn vào đây... (Ví dụ: Sơn Hà, Trà Bồng, Thửa đất số...)';
            }
        };

        if (toggleDirBtn) {
            toggleDirBtn.addEventListener('click', () => {
                isTcvnToUni = !isTcvnToUni;
                if (targetText.value) {
                    sourceText.value = targetText.value;
                    targetText.value = '';
                }
                updateLabels();
                doConvert();
            });
        }

        const doConvert = () => {
            const raw = sourceText.value;
            if (!raw) {
                targetText.value = '';
                return;
            }
            if (window.VnGIS) {
                if (isTcvnToUni) {
                    targetText.value = window.VnGIS.tcvn3ToUnicode(raw);
                } else {
                    targetText.value = window.VnGIS.unicodeToTcvn3(raw);
                }
            }
        };

        if (sourceText) {
            sourceText.addEventListener('input', doConvert);
        }

        if (execBtn) {
            execBtn.addEventListener('click', doConvert);
        }

        if (sampleBtn) {
            sampleBtn.addEventListener('click', () => {
                if (isTcvnToUni) {
                    sourceText.value = 'UBND HuyÖn S¬n Hµ - TØnh Qu¶ng Ng·i\nChñ rõng: NguyÔn V¨n H¶i\nThöa ®Êt sè: 145, tê b¶n ®å sè 12\nKhoanh 3, tiÓu khu 128, lo¹i c©y: Keo lai';
                } else {
                    sourceText.value = 'UBND Huyện Sơn Hà - Tỉnh Quảng Ngãi\nChủ rừng: Nguyễn Văn Hải\nThửa đất số: 145, tờ bản đồ số 12\nKhoanh 3, tiểu khu 128, loại cây: Keo lai';
                }
                doConvert();
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                sourceText.value = '';
                targetText.value = '';
                sourceText.focus();
            });
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const text = targetText.value;
                if (!text) return;
                try {
                    await navigator.clipboard.writeText(text);
                    const originalText = copyBtn.innerHTML;
                    copyBtn.innerHTML = '✅ Đã Sao Chép!';
                    copyBtn.style.background = 'rgba(34, 197, 94, 0.4)';
                    setTimeout(() => {
                        copyBtn.innerHTML = originalText;
                        copyBtn.style.background = 'rgba(34, 197, 94, 0.2)';
                    }, 2000);
                } catch (err) {
                    targetText.select();
                    document.execCommand('copy');
                }
            });
        }
    }

    // =========================================================================
    // TOOL 3: FRACTIONAL PLOT LABEL CONFIGURATION (TỬ SỐ 2 TRƯỜNG / MẪU SỐ 2 TRƯỜNG)
    // =========================================================================
    setupFractionalLabelModal() {
        const modal = document.getElementById('fractional-label-modal-overlay');
        const openBtn = document.getElementById('btn-open-fractional-label-modal');
        const mapinfoBtn = document.getElementById('btn-mapinfo-fractional-label');
        const closeBtn = document.getElementById('fractional-label-modal-close-btn');

        if (!modal) return;

        this.layerColumnsCache = {};
        this.layerSampleRows = {};

        const openModalHandler = (layerId = null) => {
            this.openFractionalLabelModal(layerId);
        };

        if (openBtn) openBtn.addEventListener('click', () => openModalHandler());
        if (mapinfoBtn) mapinfoBtn.addEventListener('click', () => openModalHandler());

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.classList.remove('open');
                modal.classList.remove('active');
            });
        }

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('open');
                modal.classList.remove('active');
            }
        });

        // Layer selection change
        const layerSelect = document.getElementById('label-layer-select');
        if (layerSelect) {
            layerSelect.addEventListener('change', () => {
                this.onFractionalLabelLayerChanged();
            });
        }

        // Live preview input change listeners
        const previewWatchIds = [
            'label-num-f1', 'label-num-sep', 'label-num-f2',
            'label-bar-style',
            'label-den-f1', 'label-den-sep', 'label-den-f2',
            'label-font-size', 'label-text-color', 'label-halo-style', 'label-min-zoom'
        ];
        previewWatchIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => this.updateFractionalLabelPreview());
                el.addEventListener('input', () => this.updateFractionalLabelPreview());
            }
        });

        // Preset 1: Chuẩn Lâm Nghiệp (Lô - Khoảnh / Loài cây - Diện tích)
        const btnForester = document.getElementById('btn-preset-forester');
        if (btnForester) {
            btnForester.addEventListener('click', () => this.applyFractionalPreset('forester'));
        }

        // Preset 2: Chuẩn Địa Chính (Số thửa - Tờ BĐ / Chủ rừng - Diện tích)
        const btnCadastral = document.getElementById('btn-preset-cadastral');
        if (btnCadastral) {
            btnCadastral.addEventListener('click', () => this.applyFractionalPreset('cadastral'));
        }

        // Preset 3: Rút gọn (Mã Lô - TK / Diện tích)
        const btnSimple = document.getElementById('btn-preset-simple');
        if (btnSimple) {
            btnSimple.addEventListener('click', () => this.applyFractionalPreset('simple'));
        }

        // Action: Áp dụng cho lớp đã chọn
        const btnApply = document.getElementById('btn-apply-fractional-label');
        if (btnApply) {
            btnApply.addEventListener('click', () => this.applyFractionalLabel(false));
        }

        // Action: Áp dụng cho tất cả các lớp
        const btnApplyAll = document.getElementById('btn-apply-all-layers-label');
        if (btnApplyAll) {
            btnApplyAll.addEventListener('click', () => this.applyFractionalLabel(true));
        }

        // Action: Tắt nhãn
        const btnDisable = document.getElementById('btn-disable-fractional-label');
        if (btnDisable) {
            btnDisable.addEventListener('click', () => this.disableFractionalLabel());
        }
    }

    async openFractionalLabelModal(preferredLayerId = null) {
        const modal = document.getElementById('fractional-label-modal-overlay');
        const layerSelect = document.getElementById('label-layer-select');
        if (!modal || !layerSelect) return;

        // Populate layer select with vector layers
        const vectorLayers = (this.allCatalogLayers || []).filter(l => l.format !== 'mbtiles');
        if (vectorLayers.length === 0) {
            layerSelect.innerHTML = '<option value="">(Chưa có lớp vector nào)</option>';
        } else {
            let optionsHtml = '';
            vectorLayers.forEach(l => {
                optionsHtml += `<option value="${l.id}">${l.name} (${l.province || ''} - ${l.feature_count || 0} thửa)</option>`;
            });
            optionsHtml += '<option value="all">🌐 Áp Dụng Cho Tất Cả Các Lớp Vector</option>';
            layerSelect.innerHTML = optionsHtml;
        }

        if (preferredLayerId && vectorLayers.some(l => l.id === preferredLayerId)) {
            layerSelect.value = preferredLayerId;
        } else if (vectorLayers.length > 0) {
            layerSelect.value = vectorLayers[0].id;
        }

        modal.classList.add('open');
        modal.classList.add('active');

        await this.onFractionalLabelLayerChanged();
    }

    async onFractionalLabelLayerChanged() {
        const layerSelect = document.getElementById('label-layer-select');
        const featCountEl = document.getElementById('label-layer-feature-count');
        if (!layerSelect) return;

        const layerId = layerSelect.value;
        const vectorLayers = (this.allCatalogLayers || []).filter(l => l.format !== 'mbtiles');
        const currentLayer = vectorLayers.find(l => l.id === layerId);

        if (featCountEl) {
            if (currentLayer) {
                featCountEl.innerText = `Tổng số thửa: ${currentLayer.feature_count || 0} | Diện tích: ${currentLayer.total_area_ha || 0} ha`;
            } else if (layerId === 'all') {
                featCountEl.innerText = `Áp dụng đồng bộ cho ${vectorLayers.length} lớp bản đồ`;
            } else {
                featCountEl.innerText = '';
            }
        }

        // Get columns and sample row for this layer
        let cols = [];
        let sampleRow = {};

        if (layerId === 'all') {
            // Merge columns from all available layers
            const colSet = new Set();
            for (const lyr of vectorLayers) {
                const c = await this._getLayerColumns(lyr.id);
                c.forEach(k => colSet.add(k));
            }
            cols = Array.from(colSet);
            if (vectorLayers.length > 0) {
                sampleRow = this.layerSampleRows[vectorLayers[0].id] || {};
            }
        } else if (layerId) {
            cols = await this._getLayerColumns(layerId);
            sampleRow = this.layerSampleRows[layerId] || {};
        }

        this._populateColumnDropdowns(cols, layerId);
        this.updateFractionalLabelPreview();
    }

    async _getLayerColumns(layerId) {
        if (this.layerColumnsCache[layerId]) {
            return this.layerColumnsCache[layerId];
        }

        try {
            const res = await fetch(`/api/layers/${layerId}/attributes?page=1&page_size=2`);
            if (res.ok) {
                const data = await res.json();
                if (data.columns && data.columns.length > 0) {
                    this.layerColumnsCache[layerId] = data.columns;
                    if (data.rows && data.rows.length > 0) {
                        this.layerSampleRows[layerId] = data.rows[0];
                    }
                    return data.columns;
                }
            }
        } catch (e) {
            console.warn('Could not fetch columns via attributes API, checking local catalog:', e);
        }

        // Fallback to catalog columns
        const lyr = (this.allCatalogLayers || []).find(l => l.id === layerId);
        if (lyr && lyr.columns && lyr.columns.length > 0) {
            this.layerColumnsCache[layerId] = lyr.columns;
            return lyr.columns;
        }

        return ['lo', 'khoanh', 'sldlr', 'dtich', 'thuadat', 'tobando', 'churung', 'tk', 'id'];
    }

    _populateColumnDropdowns(columns, layerId) {
        const numF1 = document.getElementById('label-num-f1');
        const numF2 = document.getElementById('label-num-f2');
        const denF1 = document.getElementById('label-den-f1');
        const denF2 = document.getElementById('label-den-f2');

        if (!numF1 || !numF2 || !denF1 || !denF2) return;

        // Friendly label mapping for common Vietnamese forestry / cadastral attribute fields
        const fieldLabels = {
            'lo': 'Lô (lo)',
            'Lo': 'Lô (Lo)',
            'lot': 'Lô (lot)',
            'khoanh': 'Khoảnh (khoanh)',
            'kh': 'Khoảnh (kh)',
            'compartment': 'Khoảnh (compartment)',
            'tk': 'Tiểu khu (tk)',
            'Tk': 'Tiểu khu (Tk)',
            'sub_compartment': 'Tiểu khu (sub_compartment)',
            'thuadat': 'Số thửa (thuadat)',
            'Thuadat': 'Số thửa (Thuadat)',
            'so_thua': 'Số thửa (so_thua)',
            'tobando': 'Tờ bản đồ (tobando)',
            'Tbd': 'Tờ bản đồ (Tbd)',
            'sldlr': 'Loài cây (sldlr)',
            'tree_species': 'Loài cây (tree_species)',
            'ldlr': 'Loại rừng (ldlr)',
            'Loaidat': 'Loại đất/rừng (Loaidat)',
            'maldlr': 'Mã LĐLR (maldlr)',
            'dtich': 'Diện tích (dtich)',
            'dtich_km2': 'Diện tích (dtich_km2)',
            'dien_tich': 'Diện tích (dien_tich)',
            'area_ha': 'Diện tích ha (area_ha)',
            'area_m2': 'Diện tích m² (area_m2)',
            'churung': 'Chủ rừng (churung)',
            'CRUNG': 'Chủ rừng (CRUNG)',
            'owner_name': 'Chủ rừng (owner_name)',
            'namtr': 'Năm trồng (namtr)',
            'planting_year': 'Năm trồng (planting_year)',
            'xa': 'Xã (xa)',
            'Xa': 'Xã (Xa)',
            'commune': 'Xã (commune)',
            'huyen': 'Huyện (huyen)',
            'Huyen': 'Huyện (Huyen)',
            'district': 'Huyện (district)',
            'thon': 'Thôn/Bản (thon)',
            'Thon': 'Thôn/Bản (Thon)',
            'ddanh': 'Địa danh (ddanh)',
            'SODONHAP': 'Số sổ đỏ (SODONHAP)',
            'SODO': 'Số sổ đỏ (SODO)',
            'redbook_no': 'Số sổ đỏ (redbook_no)',
            'id': 'Mã ID (id)',
            'STT': 'Số thứ tự (STT)'
        };

        // Smart sorting: prioritize common fields first
        const priorityKeys = [
            'lo', 'Lo', 'lot', 'khoanh', 'kh', 'tk', 'Tk', 'thuadat', 'Thuadat', 'so_thua',
            'tobando', 'Tbd', 'sldlr', 'tree_species', 'ldlr', 'Loaidat', 'dtich', 'area_ha',
            'churung', 'CRUNG', 'owner_name', 'namtr', 'id', 'STT'
        ];

        const sortedCols = [...columns].sort((a, b) => {
            const idxA = priorityKeys.indexOf(a);
            const idxB = priorityKeys.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        const buildOptions = (allowEmpty = false) => {
            let html = allowEmpty ? '<option value="">(Không dùng / Bỏ trống)</option>' : '';
            sortedCols.forEach(col => {
                const label = fieldLabels[col] || col;
                html += `<option value="${col}">${label}</option>`;
            });
            return html;
        };

        numF1.innerHTML = buildOptions(false);
        numF2.innerHTML = buildOptions(true);
        denF1.innerHTML = buildOptions(false);
        denF2.innerHTML = buildOptions(true);

        // Check if there is already a saved config for this layer
        const savedConfig = (window.mapController && window.mapController.getFractionalLabelConfig)
            ? window.mapController.getFractionalLabelConfig(layerId)
            : null;

        if (savedConfig) {
            if (savedConfig.numField1 && sortedCols.includes(savedConfig.numField1)) numF1.value = savedConfig.numField1;
            if (savedConfig.numSep !== undefined) document.getElementById('label-num-sep').value = savedConfig.numSep;
            if (savedConfig.numField2 !== undefined) numF2.value = savedConfig.numField2;

            if (savedConfig.barStyle !== undefined) document.getElementById('label-bar-style').value = savedConfig.barStyle;

            if (savedConfig.denField1 && sortedCols.includes(savedConfig.denField1)) denF1.value = savedConfig.denField1;
            if (savedConfig.denSep !== undefined) document.getElementById('label-den-sep').value = savedConfig.denSep;
            if (savedConfig.denField2 !== undefined) denF2.value = savedConfig.denField2;

            if (savedConfig.fontSize) document.getElementById('label-font-size').value = savedConfig.fontSize;
            if (savedConfig.textColor) document.getElementById('label-text-color').value = savedConfig.textColor;
            if (savedConfig.haloStyle) document.getElementById('label-halo-style').value = savedConfig.haloStyle;
            if (savedConfig.minZoom) document.getElementById('label-min-zoom').value = savedConfig.minZoom;
        } else {
            // Apply standard forestry auto-detection defaults
            this._applyDefaultFieldsForLayer(sortedCols, numF1, numF2, denF1, denF2);
        }
    }

    _applyDefaultFieldsForLayer(cols, numF1, numF2, denF1, denF2) {
        const findCol = (candidates) => {
            for (const cand of candidates) {
                if (cols.includes(cand)) return cand;
            }
            return '';
        };

        // Numerator 1: Lô or Số thửa
        const f1 = findCol(['lo', 'Lo', 'lot', 'thuadat', 'Thuadat', 'so_thua', 'id']);
        if (f1) numF1.value = f1;

        // Numerator 2: Khoảnh or Tờ bản đồ
        const f2 = findCol(['khoanh', 'kh', 'tobando', 'Tbd', 'tk', 'Tk']);
        if (f2 && f2 !== f1) numF2.value = f2;

        // Denominator 1: Loài cây or Chủ rừng or Loại đất
        const d1 = findCol(['sldlr', 'tree_species', 'churung', 'CRUNG', 'owner_name', 'ldlr', 'Loaidat']);
        if (d1 && d1 !== f1 && d1 !== f2) denF1.value = d1;

        // Denominator 2: Diện tích
        const d2 = findCol(['dtich', 'dien_tich', 'area_ha', 'dtich_kt', 'namtr']);
        if (d2 && d2 !== f1 && d2 !== f2 && d2 !== d1) denF2.value = d2;
    }

    applyFractionalPreset(type) {
        const numF1 = document.getElementById('label-num-f1');
        const numF2 = document.getElementById('label-num-f2');
        const numSep = document.getElementById('label-num-sep');
        const barStyle = document.getElementById('label-bar-style');
        const denF1 = document.getElementById('label-den-f1');
        const denF2 = document.getElementById('label-den-f2');
        const denSep = document.getElementById('label-den-sep');
        const textColor = document.getElementById('label-text-color');

        if (!numF1 || !denF1) return;

        const cols = Array.from(numF1.options).map(o => o.value);
        const findCol = (candidates) => {
            for (const cand of candidates) {
                if (cols.includes(cand)) return cand;
            }
            return '';
        };

        if (type === 'forester') {
            // Forestry: Lô - Khoảnh / Loài cây - Diện tích
            const f1 = findCol(['lo', 'Lo', 'lot', 'id']);
            const f2 = findCol(['khoanh', 'kh', 'tk']);
            const d1 = findCol(['sldlr', 'tree_species', 'ldlr', 'Loaidat']);
            const d2 = findCol(['dtich', 'dien_tich', 'area_ha']);

            if (f1) numF1.value = f1;
            if (f2) numF2.value = f2;
            if (d1) denF1.value = d1;
            if (d2) denF2.value = d2;

            if (numSep) numSep.value = ' - ';
            if (denSep) denSep.value = ' - ';
            if (barStyle) barStyle.value = '─────────';
            if (textColor) textColor.value = '#fde047'; // Vàng chanh
        } else if (type === 'cadastral') {
            // Cadastral: Số thửa - Tờ BĐ / Chủ rừng - Diện tích
            const f1 = findCol(['thuadat', 'Thuadat', 'so_thua', 'lo', 'Lo']);
            const f2 = findCol(['tobando', 'Tbd', 'to_bd', 'khoanh']);
            const d1 = findCol(['churung', 'CRUNG', 'owner_name']);
            const d2 = findCol(['dtich', 'dien_tich', 'area_ha']);

            if (f1) numF1.value = f1;
            if (f2) numF2.value = f2;
            if (d1) denF1.value = d1;
            if (d2) denF2.value = d2;

            if (numSep) numSep.value = ' - ';
            if (denSep) denSep.value = ' - ';
            if (barStyle) barStyle.value = '─────────';
            if (textColor) textColor.value = '#ffffff'; // Trắng sáng
        } else if (type === 'simple') {
            // Simple: Lô - Tiểu khu / Diện tích
            const f1 = findCol(['lo', 'Lo', 'thuadat', 'id']);
            const f2 = findCol(['tk', 'Tk', 'khoanh', 'kh']);
            const d1 = findCol(['dtich', 'dien_tich', 'area_ha', 'sldlr']);

            if (f1) numF1.value = f1;
            if (f2) numF2.value = f2;
            if (d1) denF1.value = d1;
            numF2.value = f2;
            denF2.value = '';

            if (numSep) numSep.value = ' - ';
            if (barStyle) barStyle.value = '─────────';
            if (textColor) textColor.value = '#38bdf8'; // Xanh cyan
        }

        this.updateFractionalLabelPreview();
    }

    updateFractionalLabelPreview() {
        const numF1 = document.getElementById('label-num-f1');
        const numSep = document.getElementById('label-num-sep');
        const numF2 = document.getElementById('label-num-f2');
        const barStyle = document.getElementById('label-bar-style');
        const denF1 = document.getElementById('label-den-f1');
        const denSep = document.getElementById('label-den-sep');
        const denF2 = document.getElementById('label-den-f2');
        const fontSizeEl = document.getElementById('label-font-size');
        const textColorEl = document.getElementById('label-text-color');
        const haloStyleEl = document.getElementById('label-halo-style');
        const layerSelect = document.getElementById('label-layer-select');

        const prevNum = document.getElementById('preview-numerator');
        const prevDiv = document.getElementById('preview-divider');
        const prevDen = document.getElementById('preview-denominator');
        const prevInfo = document.getElementById('label-preview-sample-info');

        if (!prevNum || !prevDiv || !prevDen) return;

        const currentLayerId = layerSelect ? layerSelect.value : '';
        const sample = (this.layerSampleRows && this.layerSampleRows[currentLayerId]) ? this.layerSampleRows[currentLayerId] : {};

        const getVal = (field, fallback) => {
            if (!field) return '';
            if (sample[field] !== undefined && sample[field] !== null && sample[field] !== '') {
                const raw = String(sample[field]);
                return (window.VnGIS && typeof raw === 'string') ? window.VnGIS.tcvn3ToUnicode(raw) : raw;
            }
            return fallback;
        };

        const f1 = numF1 ? numF1.value : '';
        const s1 = numSep ? numSep.value : ' - ';
        const f2 = numF2 ? numF2.value : '';

        const bar = barStyle ? barStyle.value : '─────────';

        const d1 = denF1 ? denF1.value : '';
        const s2 = denSep ? denSep.value : ' - ';
        const d2 = denF2 ? denF2.value : '';

        const valF1 = getVal(f1, f1 || '81');
        const valF2 = getVal(f2, f2 ? '6' : '');
        const valD1 = getVal(d1, d1 || 'Keo');
        const valD2 = getVal(d2, d2 ? '0.22 ha' : '');

        // Numerator text
        let numText = '';
        if (valF1 && valF2) {
            numText = `${valF1}${s1}${valF2}`;
        } else if (valF1) {
            numText = valF1;
        } else if (valF2) {
            numText = valF2;
        } else {
            numText = '(Trống)';
        }

        // Denominator text
        let denText = '';
        if (valD1 && valD2) {
            denText = `${valD1}${s2}${valD2}`;
        } else if (valD1) {
            denText = valD1;
        } else if (valD2) {
            denText = valD2;
        } else {
            denText = '(Trống)';
        }

        prevNum.innerText = numText;
        prevDen.innerText = denText;

        if (bar && numText !== '(Trống)' && denText !== '(Trống)') {
            prevDiv.style.display = 'block';
            prevDiv.innerText = bar;
        } else {
            prevDiv.style.display = 'none';
        }

        // Styling
        const fSize = fontSizeEl ? fontSizeEl.value : '11';
        const color = textColorEl ? textColorEl.value : '#fde047';
        const halo = haloStyleEl ? haloStyleEl.value : 'black-thick';

        prevNum.style.fontSize = `${Math.max(12, parseInt(fSize, 10) + 1)}px`;
        prevDiv.style.fontSize = `${Math.max(12, parseInt(fSize, 10) + 1)}px`;
        prevDen.style.fontSize = `${Math.max(12, parseInt(fSize, 10) + 1)}px`;

        prevNum.style.color = color;
        prevDiv.style.color = color;
        prevDen.style.color = color;

        let shadowCss = '0 0 2px #000, 1px 1px 2px #000, -1px -1px 2px #000';
        if (halo === 'black-thick') {
            shadowCss = '0 0 3px #000, 1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000';
        } else if (halo === 'black-medium') {
            shadowCss = '0 0 2px #000, 1px 1px 1px #000';
        } else if (halo === 'white-thick') {
            shadowCss = '0 0 3px #fff, 1px 1px 2px #fff, -1px -1px 2px #fff';
        } else if (halo === 'none') {
            shadowCss = 'none';
        }

        prevNum.style.textShadow = shadowCss;
        prevDiv.style.textShadow = shadowCss;
        prevDen.style.textShadow = shadowCss;

        if (prevInfo) {
            const hasRealData = sample && Object.keys(sample).length > 0;
            prevInfo.innerText = hasRealData ? ' (Dữ liệu thực tế từ thửa đầu tiên trong CSDL)' : ' (Minh họa cấu trúc nhãn)';
            prevInfo.style.color = hasRealData ? '#38bdf8' : '#94a3b8';
        }
    }

    async applyFractionalLabel(isAll = false) {
        const layerSelect = document.getElementById('label-layer-select');
        const numF1 = document.getElementById('label-num-f1');
        const numSep = document.getElementById('label-num-sep');
        const numF2 = document.getElementById('label-num-f2');
        const barStyle = document.getElementById('label-bar-style');
        const denF1 = document.getElementById('label-den-f1');
        const denSep = document.getElementById('label-den-sep');
        const denF2 = document.getElementById('label-den-f2');
        const fontSizeEl = document.getElementById('label-font-size');
        const textColorEl = document.getElementById('label-text-color');
        const haloStyleEl = document.getElementById('label-halo-style');
        const minZoomEl = document.getElementById('label-min-zoom');
        const statusEl = document.getElementById('fractional-label-status');

        if (!layerSelect || !numF1 || !denF1) return;

        const targetLayerId = isAll ? 'all' : layerSelect.value;
        if (!targetLayerId) {
            alert('Vui lòng chọn lớp bản đồ cần cấu hình nhãn.');
            return;
        }

        const config = {
            enabled: true,
            layerId: targetLayerId,
            numField1: numF1.value,
            numSep: numSep ? numSep.value : ' - ',
            numField2: numF2 ? numF2.value : '',
            barStyle: barStyle ? barStyle.value : '─────────',
            denField1: denF1.value,
            denSep: denSep ? denSep.value : ' - ',
            denField2: denF2 ? denF2.value : '',
            fontSize: fontSizeEl ? parseInt(fontSizeEl.value, 10) : 11,
            textColor: textColorEl ? textColorEl.value : '#fde047',
            haloStyle: haloStyleEl ? haloStyleEl.value : 'black-thick',
            minZoom: minZoomEl ? parseInt(minZoomEl.value, 10) : 13,
            allowOverlap: true
        };

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#38bdf8';
            statusEl.innerHTML = '⏳ Đang kết xuất và cập nhật nhãn phân số lên bản đồ...';
        }

        // Apply immediately to MapLibre GL
        if (window.mapController) {
            window.mapController.updateLayerFractionalLabel(targetLayerId, config);
        }

        // Persist to backend server if specific layer
        try {
            if (targetLayerId !== 'all') {
                await fetch(`/api/layers/${targetLayerId}/label-config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label_config: config })
                });
            } else {
                // Save for all individual vector layers
                const vectorLayers = (this.allCatalogLayers || []).filter(l => l.format !== 'mbtiles');
                for (const lyr of vectorLayers) {
                    await fetch(`/api/layers/${lyr.id}/label-config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ label_config: { ...config, layerId: lyr.id } })
                    });
                }
            }
        } catch (err) {
            console.warn('Could not save label config to backend:', err);
        }

        if (statusEl) {
            statusEl.style.color = '#4ade80';
            statusEl.innerHTML = `✅ Đã hiển thị nhãn phân số thành công! (Dòng trên: <b>${numF1.value}${numF2.value ? ' - ' + numF2.value : ''}</b> | Dòng dưới: <b>${denF1.value}${denF2.value ? ' - ' + denF2.value : ''}</b>)`;
            setTimeout(() => {
                const modal = document.getElementById('fractional-label-modal-overlay');
                if (modal) {
                    modal.classList.remove('open');
                    modal.classList.remove('active');
                }
                statusEl.style.display = 'none';
            }, 1200);
        }
    }

    disableFractionalLabel() {
        const layerSelect = document.getElementById('label-layer-select');
        const statusEl = document.getElementById('fractional-label-status');
        if (!layerSelect) return;

        const targetLayerId = layerSelect.value;
        if (!targetLayerId) return;

        if (window.mapController) {
            window.mapController.disableLayerFractionalLabel(targetLayerId);
        }

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#f87171';
            statusEl.innerHTML = '❌ Đã tắt hiển thị nhãn phân số cho lớp này.';
            setTimeout(() => {
                const modal = document.getElementById('fractional-label-modal-overlay');
                if (modal) {
                    modal.classList.remove('open');
                    modal.classList.remove('active');
                }
                statusEl.style.display = 'none';
            }, 1000);
        }
    }

    openCopernicusBrowser() {
        if (!window.mapController || !window.mapController.map) return;
        const center = window.mapController.map.getCenter();
        const zoom = Math.round(window.mapController.map.getZoom() || 10);
        const url = `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS`;
        window.open(url, '_blank');
    }
}

window.app = new ForestryApp();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app.init();
    });
} else {
    // DOM is already ready, initialize immediately!
    window.app.init();
}
