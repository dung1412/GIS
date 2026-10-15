/**
 * Multi-User Authentication & Personal Map Workspace Manager
 * Phú Tài Bioenergy Web GIS Platform
 * 
 * Supports:
 * - Member Login / Register / Logout (server-verified sessions)
 * - Personal Workspaces & Map Management (Create, switch, edit, delete private maps)
 * - Private Layers per User Map + Shared System Layers
 */

(function(window) {
    'use strict';

    // Shared API clients use the current verified session; never send tokens to
    // third-party basemap or satellite hosts.
    const originalFetch = window.fetch.bind(window);
    window.fetch = function(input, init = {}) {
        const requestUrl = new URL(input instanceof Request ? input.url : input, window.location.href);
        if (requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith('/api/')) {
            const headers = new Headers(input instanceof Request ? input.headers : undefined);
            new Headers(init.headers).forEach((value, key) => headers.set(key, value));
            const token = localStorage.getItem('phutai_auth_token');
            if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
            init = { ...init, headers };
        }
        return originalFetch(input, init);
    };

    class UserWorkspaceManager {
        constructor() {
            this.token = localStorage.getItem('phutai_auth_token') || null;
            this.currentUser = null;
            this.userMaps = [];
            this.currentMap = null;
            this.privateLayers = [];
            this.activeLayerTab = 'all'; // 'all', 'private', 'system'
            this.requiresAuth = false;
            this.registrationEnabled = true;
        }

        async init() {
            this._setupUIElements();
            this._bindAuthEvents();
            try {
                const response = await fetch('/api/config');
                if (response.ok) {
                    const config = await response.json();
                    this.requiresAuth = config.requires_auth === true;
                    this.registrationEnabled = config.registration_enabled !== false;
                }
            } catch (error) {
                console.warn('Không thể đọc cấu hình đăng nhập từ máy chủ.');
            }
            const registerTab = document.getElementById('tab-btn-register');
            if (registerTab && !this.registrationEnabled) registerTab.style.display = 'none';
            const map = window.mapController && window.mapController.map;
            if (map && typeof map.setTransformRequest === 'function') {
                map.setTransformRequest(url => {
                    const target = new URL(url, window.location.href);
                    const token = localStorage.getItem('phutai_auth_token');
                    if (token && target.origin === window.location.origin && target.pathname.startsWith('/api/')) {
                        return { url, headers: { 'Authorization': `Bearer ${token}` } };
                    }
                    return { url };
                });
            }
            await this.restoreSession();
            await this.loadUserMaps();
            if (this.requiresAuth && !this.currentUser) this.openAuthModal('login');
        }

        async restoreSession() {
            if (!this.token) {
                localStorage.removeItem('phutai_cached_user');
                this.updateHeaderUI();
                return;
            }

            try {
                const res = await fetch('/api/auth/me', {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    this.currentUser = data.user;
                    localStorage.setItem('phutai_cached_user', JSON.stringify(this.currentUser));
                } else {
                    // Token expired or invalid
                    this.token = null;
                    this.currentUser = null;
                    localStorage.removeItem('phutai_auth_token');
                    localStorage.removeItem('phutai_cached_user');
                }
            } catch (err) {
                // A cached profile is not proof of an authenticated session.
                this.currentUser = null;
            }
            this.updateHeaderUI();
        }

        _setupUIElements() {
            // Ensure auth modal exists in DOM
            if (!document.getElementById('auth-modal-overlay')) {
                const modalHtml = `
                <div class="modal-overlay" id="auth-modal-overlay">
                    <div class="modal-content auth-modal-content" style="max-width: 440px;">
                        <div class="modal-header">
                            <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 20px;">🔐</span>
                                <div>
                                    <div id="auth-modal-heading" style="font-size: 15px; font-weight: 800; color: #f8fafc;">Đăng Nhập Thành Viên</div>
                                    <div style="font-size: 11px; color: #94a3b8; font-weight: normal;">Hệ Thống Web GIS Quản Lý Rừng Phú Tài</div>
                                </div>
                            </div>
                            <button type="button" class="modal-close-btn" id="auth-modal-close-btn">✕</button>
                        </div>
                        
                        <div class="modal-body" style="padding: 18px 20px;">
                            <!-- Tabs: Đăng Nhập / Đăng Ký -->
                            <div class="auth-tabs" style="display: flex; gap: 6px; margin-bottom: 16px; background: rgba(15, 23, 42, 0.6); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
                                <button type="button" class="auth-tab-btn active" id="tab-btn-login" style="flex: 1; padding: 7px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; cursor: pointer; background: #0284c7; color: #fff;">
                                    Đăng Nhập
                                </button>
                                <button type="button" class="auth-tab-btn" id="tab-btn-register" style="flex: 1; padding: 7px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; cursor: pointer; background: transparent; color: #94a3b8;">
                                    Đăng Ký Thành Viên
                                </button>
                            </div>

                            <!-- LOGIN FORM -->
                            <form id="form-login">
                                <div class="form-group" style="margin-bottom: 12px;">
                                    <label class="form-label" style="font-size: 11px; color: #cbd5e1;">Tên đăng nhập hoặc Email:</label>
                                    <input type="text" id="login-username" class="search-input" placeholder="Tên đăng nhập hoặc email của bạn" required style="width: 100%;">
                                </div>
                                <div class="form-group" style="margin-bottom: 14px;">
                                    <label class="form-label" style="font-size: 11px; color: #cbd5e1;">Mật khẩu:</label>
                                    <input type="password" id="login-password" class="search-input" placeholder="••••••••" required style="width: 100%;">
                                </div>
                                <button type="submit" class="btn-primary" id="btn-submit-login" style="width: 100%; padding: 10px; font-weight: 700; font-size: 13px; background: linear-gradient(135deg, #0284c7, #0369a1); border: 1px solid #38bdf8;">
                                    🚀 ĐĂNG NHẬP NGAY
                                </button>
                                
                            </form>

                            <!-- REGISTER FORM -->
                            <form id="form-register" style="display: none;">
                                <div class="form-group" style="margin-bottom: 10px;">
                                    <label class="form-label" style="font-size: 11px; color: #cbd5e1;">Họ và tên của bạn:</label>
                                    <input type="text" id="reg-fullname" class="search-input" placeholder="Nguyễn Văn A" required style="width: 100%;">
                                </div>
                                <div class="form-group" style="margin-bottom: 10px;">
                                    <label class="form-label" style="font-size: 11px; color: #cbd5e1;">Tên đăng nhập:</label>
                                    <input type="text" id="reg-username" class="search-input" placeholder="nguyenvana (viết liền không dấu)" required style="width: 100%;">
                                </div>
                                <div class="form-group" style="margin-bottom: 10px;">
                                    <label class="form-label" style="font-size: 11px; color: #cbd5e1;">Địa chỉ Email:</label>
                                    <input type="email" id="reg-email" class="search-input" placeholder="nguyenvana@phutaibioenergy.vn" required style="width: 100%;">
                                </div>
                                <div class="form-group" style="margin-bottom: 10px;">
                                    <label class="form-label" style="font-size: 11px; color: #cbd5e1;">Mật khẩu:</label>
                                    <input type="password" id="reg-password" class="search-input" placeholder="Tối thiểu 4 ký tự" required style="width: 100%;">
                                </div>
                                <div class="form-group" style="margin-bottom: 14px;">
                                    <label class="form-label" style="font-size: 11px; color: #cbd5e1;">Bộ phận / Đội công tác:</label>
                                    <input type="text" id="reg-department" class="search-input" placeholder="Đội Quản Lý Rừng / Hạt Kiểm Lâm..." style="width: 100%;">
                                </div>
                                <button type="submit" class="btn-primary" id="btn-submit-register" style="width: 100%; padding: 10px; font-weight: 700; font-size: 13px; background: linear-gradient(135deg, #10b981, #059669); border: 1px solid #34d399;">
                                    ✨ TẠO TÀI KHOẢN MỚI
                                </button>
                            </form>

                            <div id="auth-status-msg" style="display: none; margin-top: 12px; font-size: 12px; text-align: center; padding: 8px; border-radius: 6px;"></div>
                        </div>
                    </div>
                </div>
                `;
                document.body.insertAdjacentHTML('beforeend', modalHtml);
            }

            // Ensure My Maps modal exists in DOM
            if (!document.getElementById('user-maps-modal-overlay')) {
                const mapsModalHtml = `
                <div class="modal-overlay" id="user-maps-modal-overlay">
                    <div class="modal-content" style="max-width: 620px; max-height: 85vh; display: flex; flex-direction: column;">
                        <div class="modal-header">
                            <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 22px;">🗺️</span>
                                <div>
                                    <div style="font-size: 16px; font-weight: 800; color: #f8fafc;">Không Gian Bản Đồ Của Tôi</div>
                                    <div style="font-size: 11px; color: #94a3b8; font-weight: normal;">Quản lý các dự án bản đồ và dữ liệu lớp riêng biệt</div>
                                </div>
                            </div>
                            <button type="button" class="modal-close-btn" id="user-maps-modal-close-btn">✕</button>
                        </div>
                        
                        <div class="modal-body" style="padding: 16px 20px; overflow-y: auto; flex: 1;">
                            <!-- Top Action Bar -->
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 10px;">
                                <div style="font-size: 12px; color: #cbd5e1;">
                                    Đang làm việc: <b id="current-active-map-name" style="color: #38bdf8;">Mặc định</b>
                                </div>
                                <button type="button" class="btn-primary" id="btn-show-create-map" style="padding: 7px 14px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #10b981, #059669); border: 1px solid #34d399;">
                                    ➕ Tạo Bản Đồ Mới
                                </button>
                            </div>

                            <!-- Form Tạo Bản Đồ Mới (Collapsible) -->
                            <div id="create-map-form-container" style="display: none; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 14px; margin-bottom: 16px;">
                                <div style="font-size: 13px; font-weight: 700; color: #34d399; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                                    <span>🌱</span> <span>Thiết Lập Bản Đồ Mới Của Bạn:</span>
                                </div>
                                <div class="form-group" style="margin-bottom: 10px;">
                                    <label class="form-label" style="font-size: 11px;">Tên bản đồ / Dự án:</label>
                                    <input type="text" id="new-map-name" class="search-input" placeholder="Ví dụ: Khảo sát Lô Rừng Xã Ba Cung 2026..." style="width: 100%;">
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                                    <div>
                                        <label class="form-label" style="font-size: 11px;">Tỉnh thành:</label>
                                        <select id="new-map-province" class="filter-select" style="width: 100%;">
                                            <option value="Quảng Ngãi" selected>Quảng Ngãi</option>
                                            <option value="Bình Định">Bình Định</option>
                                            <option value="Phú Yên">Phú Yên</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="form-label" style="font-size: 11px;">Quyền riêng tư:</label>
                                        <select id="new-map-public" class="filter-select" style="width: 100%;">
                                            <option value="0" selected>🔒 Riêng tư (Chỉ mình tôi)</option>
                                            <option value="1">🌐 Chia sẻ (Toàn công ty)</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="form-group" style="margin-bottom: 12px;">
                                    <label class="form-label" style="font-size: 11px;">Mô tả / Ghi chú mục đích:</label>
                                    <input type="text" id="new-map-desc" class="search-input" placeholder="Ghi chú về đợt khảo sát hoặc phạm vi làm việc..." style="width: 100%;">
                                </div>
                                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                                    <button type="button" class="btn-header" id="btn-cancel-create-map" style="padding: 6px 12px; font-size: 12px;">Hủy Bỏ</button>
                                    <button type="button" class="btn-primary" id="btn-submit-create-map" style="padding: 6px 14px; font-size: 12px; font-weight: 700; background: #10b981;">Lưu & Bắt Đầu Làm Việc</button>
                                </div>
                            </div>

                            <!-- List of Maps -->
                            <div id="user-maps-list-container" style="display: flex; flex-direction: column; gap: 8px;">
                                <!-- Populated dynamically -->
                            </div>
                        </div>
                    </div>
                </div>
                `;
                document.body.insertAdjacentHTML('beforeend', mapsModalHtml);
            }
        }

        _bindAuthEvents() {
            // Close buttons
            const authClose = document.getElementById('auth-modal-close-btn');
            const authOverlay = document.getElementById('auth-modal-overlay');
            if (authClose && authOverlay) {
                authClose.addEventListener('click', () => authOverlay.classList.remove('open'));
            }

            const mapsClose = document.getElementById('user-maps-modal-close-btn');
            const mapsOverlay = document.getElementById('user-maps-modal-overlay');
            if (mapsClose && mapsOverlay) {
                mapsClose.addEventListener('click', () => mapsOverlay.classList.remove('open'));
            }

            // Tab switching in Auth Modal
            const tabLogin = document.getElementById('tab-btn-login');
            const tabReg = document.getElementById('tab-btn-register');
            const formLogin = document.getElementById('form-login');
            const formReg = document.getElementById('form-register');
            const heading = document.getElementById('auth-modal-heading');

            if (tabLogin && tabReg && formLogin && formReg) {
                tabLogin.addEventListener('click', () => {
                    tabLogin.style.background = '#0284c7';
                    tabLogin.style.color = '#fff';
                    tabReg.style.background = 'transparent';
                    tabReg.style.color = '#94a3b8';
                    formLogin.style.display = 'block';
                    formReg.style.display = 'none';
                    if (heading) heading.textContent = 'Đăng Nhập Thành Viên';
                });
                tabReg.addEventListener('click', () => {
                    tabReg.style.background = '#10b981';
                    tabReg.style.color = '#fff';
                    tabLogin.style.background = 'transparent';
                    tabLogin.style.color = '#94a3b8';
                    formReg.style.display = 'block';
                    formLogin.style.display = 'none';
                    if (heading) heading.textContent = 'Đăng Ký Thành Viên Mới';
                });
            }

            // Form Submit Login
            if (formLogin) {
                formLogin.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const u = document.getElementById('login-username').value.trim();
                    const p = document.getElementById('login-password').value;
                    await this.login(u, p);
                });
            }

            // Form Submit Register
            if (formReg) {
                formReg.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const fullname = document.getElementById('reg-fullname').value.trim();
                    const u = document.getElementById('reg-username').value.trim();
                    const email = document.getElementById('reg-email').value.trim();
                    const p = document.getElementById('reg-password').value;
                    const dept = document.getElementById('reg-department').value.trim();
                    await this.register(u, email, p, fullname, dept);
                });
            }

            // Create Map toggle
            const btnShowCreate = document.getElementById('btn-show-create-map');
            const createFormContainer = document.getElementById('create-map-form-container');
            const btnCancelCreate = document.getElementById('btn-cancel-create-map');
            const btnSubmitCreate = document.getElementById('btn-submit-create-map');

            if (btnShowCreate && createFormContainer) {
                btnShowCreate.addEventListener('click', () => {
                    createFormContainer.style.display = (createFormContainer.style.display === 'none') ? 'block' : 'none';
                });
            }
            if (btnCancelCreate && createFormContainer) {
                btnCancelCreate.addEventListener('click', () => createFormContainer.style.display = 'none');
            }
            if (btnSubmitCreate) {
                btnSubmitCreate.addEventListener('click', async () => {
                    const name = document.getElementById('new-map-name').value.trim();
                    if (!name) { alert('Vui lòng nhập tên bản đồ!'); return; }
                    const province = document.getElementById('new-map-province').value;
                    const isPub = document.getElementById('new-map-public').value === '1';
                    const desc = document.getElementById('new-map-desc').value.trim();
                    await this.createNewMap(name, desc, province, isPub);
                    if (createFormContainer) createFormContainer.style.display = 'none';
                });
            }
        }

        updateHeaderUI() {
            // Find or inject user auth section in header
            const headerActions = document.querySelector('.header-actions');
            if (!headerActions) return;

            let authContainer = document.getElementById('header-user-auth-widget');
            if (!authContainer) {
                authContainer = document.createElement('div');
                authContainer.id = 'header-user-auth-widget';
                authContainer.className = 'header-user-auth-widget';
                headerActions.appendChild(authContainer);
            }

            if (!this.currentUser) {
                authContainer.innerHTML = `
                    <button class="btn-header" onclick="window.userWorkspace.openAuthModal('login')" style="background: rgba(14, 165, 233, 0.25); border-color: #0284c7; color: #38bdf8; font-weight: 700;" title="Đăng nhập tài khoản cá nhân">
                        🔑 Đăng Nhập
                    </button>
                    <button class="btn-header" onclick="window.userWorkspace.openAuthModal('register')" style="${this.registrationEnabled ? '' : 'display: none;'} background: rgba(16, 185, 129, 0.2); border-color: #10b981; color: #34d399;" title="Đăng ký tài khoản thành viên mới">
                        ✨ Đăng Ký
                    </button>
                `;
            } else {
                const u = this.currentUser;
                const avatarChar = (u.full_name || u.username || 'U').charAt(0).toUpperCase();
                const mapName = this.currentMap ? this.currentMap.name : 'Bản đồ cá nhân';

                authContainer.innerHTML = `
                    <!-- Map Switcher Pill Button -->
                    <button class="btn-header" onclick="window.userWorkspace.openMyMapsModal()" style="background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.4); color: #7dd3fc; display: flex; align-items: center; gap: 6px;" title="Chuyển đổi hoặc quản lý bản đồ của tôi">
                        <span>🗺️</span>
                        <span style="max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700;">${mapName}</span>
                        <span style="font-size: 10px; opacity: 0.7;">▼</span>
                    </button>

                    <!-- User Account Pill Button -->
                    <div style="position: relative;" id="user-menu-dropdown-wrapper">
                        <button class="btn-header" id="btn-toggle-user-menu" onclick="window.userWorkspace.toggleUserMenu()" style="background: rgba(15, 23, 42, 0.8); border-color: ${u.avatar_color || '#10b981'}; color: #f8fafc; display: flex; align-items: center; gap: 6px; padding: 4px 8px;" title="Tài khoản cá nhân">
                            <span style="width: 22px; height: 22px; border-radius: 50%; background: ${u.avatar_color || '#10b981'}; color: #fff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center;">
                                ${avatarChar}
                            </span>
                            <span style="font-size: 12px; font-weight: 700; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${u.full_name || u.username}
                            </span>
                            <span style="font-size: 10px; opacity: 0.7;">▼</span>
                        </button>

                        <!-- Dropdown Menu -->
                        <div id="user-profile-dropdown" style="display: none; position: absolute; right: 0; top: 110%; width: 220px; background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 10000; padding: 6px;">
                            <div style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 4px;">
                                <div style="font-size: 12px; font-weight: 800; color: #f8fafc;">${u.full_name}</div>
                                <div style="font-size: 10px; color: #94a3b8;">${u.email}</div>
                                <div style="font-size: 10px; color: #38bdf8; margin-top: 2px;">🏢 ${u.department || 'Phòng Bền Vững'}</div>
                            </div>
                            <button onclick="window.userWorkspace.openMyMapsModal()" class="btn-header" style="width: 100%; text-align: left; margin-bottom: 4px; justify-content: flex-start; padding: 6px 10px; font-size: 11px;">
                                🗺️ Bản Đồ Của Tôi (${this.userMaps.length})
                            </button>
                            <button onclick="window.userWorkspace.openCreateMapModal()" class="btn-header" style="width: 100%; text-align: left; margin-bottom: 4px; justify-content: flex-start; padding: 6px 10px; font-size: 11px; color: #34d399;">
                                ➕ Tạo Bản Đồ Mới
                            </button>
                            <button onclick="window.userWorkspace.logout()" class="btn-header" style="width: 100%; text-align: left; justify-content: flex-start; padding: 6px 10px; font-size: 11px; color: #f87171; border-color: rgba(239, 68, 68, 0.3);">
                                🚪 Đăng Xuất
                            </button>
                        </div>
                    </div>
                `;
            }
        }

        toggleUserMenu() {
            const menu = document.getElementById('user-profile-dropdown');
            if (menu) {
                menu.style.display = (menu.style.display === 'none') ? 'block' : 'none';
            }
        }

        openAuthModal(tab = 'login') {
            const overlay = document.getElementById('auth-modal-overlay');
            if (!overlay) return;
            overlay.classList.add('open');

            const tabLogin = document.getElementById('tab-btn-login');
            const tabReg = document.getElementById('tab-btn-register');
            if (tab === 'login' && tabLogin) tabLogin.click();
            if (tab === 'register' && tabReg) tabReg.click();
        }

        openMyMapsModal() {
            const menu = document.getElementById('user-profile-dropdown');
            if (menu) menu.style.display = 'none';

            const overlay = document.getElementById('user-maps-modal-overlay');
            if (!overlay) return;
            overlay.classList.add('open');
            this.renderMyMapsList();
        }

        openCreateMapModal() {
            this.openMyMapsModal();
            const createFormContainer = document.getElementById('create-map-form-container');
            if (createFormContainer) createFormContainer.style.display = 'block';
        }

        async login(username, password) {
            const statusEl = document.getElementById('auth-status-msg');
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(14, 165, 233, 0.2)';
                statusEl.style.color = '#38bdf8';
                statusEl.textContent = 'Đang xác thực thông tin...';
            }

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();

                if (res.ok && data.status === 'success') {
                    this.token = data.token;
                    this.currentUser = data.user;
                    localStorage.setItem('phutai_auth_token', this.token);
                    localStorage.setItem('phutai_cached_user', JSON.stringify(this.currentUser));

                    if (statusEl) {
                        statusEl.style.background = 'rgba(16, 185, 129, 0.2)';
                        statusEl.style.color = '#34d399';
                        statusEl.textContent = '✅ Đăng nhập thành công! Đang tải bản đồ...';
                    }

                    setTimeout(async () => {
                        if (this.requiresAuth) { window.location.reload(); return; }
                        const overlay = document.getElementById('auth-modal-overlay');
                        if (overlay) overlay.classList.remove('open');
                        this.updateHeaderUI();
                        await this.loadUserMaps();
                    }, 500);
                } else {
                    if (statusEl) {
                        statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
                        statusEl.style.color = '#f87171';
                        statusEl.textContent = `❌ ${data.detail || data.message || 'Sai thông tin đăng nhập'}`;
                    }
                }
            } catch (err) {
                if (statusEl) {
                    statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
                    statusEl.style.color = '#f87171';
                    statusEl.textContent = '❌ Không thể kết nối máy chủ xác thực';
                }
            }
        }

        async register(username, email, password, full_name, department) {
            const statusEl = document.getElementById('auth-status-msg');
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(14, 165, 233, 0.2)';
                statusEl.style.color = '#38bdf8';
                statusEl.textContent = 'Đang khởi tạo tài khoản...';
            }

            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password, full_name, department })
                });
                const data = await res.json();

                if (res.ok && data.status === 'success') {
                    this.token = data.token;
                    this.currentUser = data.user;
                    localStorage.setItem('phutai_auth_token', this.token);
                    localStorage.setItem('phutai_cached_user', JSON.stringify(this.currentUser));

                    if (statusEl) {
                        statusEl.style.background = 'rgba(16, 185, 129, 0.2)';
                        statusEl.style.color = '#34d399';
                        statusEl.textContent = '🎉 Đăng ký thành công! Không gian làm việc đã sẵn sàng.';
                    }

                    setTimeout(async () => {
                        if (this.requiresAuth) { window.location.reload(); return; }
                        const overlay = document.getElementById('auth-modal-overlay');
                        if (overlay) overlay.classList.remove('open');
                        this.updateHeaderUI();
                        await this.loadUserMaps();
                    }, 600);
                } else {
                    if (statusEl) {
                        statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
                        statusEl.style.color = '#f87171';
                        statusEl.textContent = `❌ ${data.detail || data.message || 'Lỗi đăng ký'}`;
                    }
                }
            } catch (err) {
                if (statusEl) {
                    statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
                    statusEl.style.color = '#f87171';
                    statusEl.textContent = '❌ Không thể kết nối máy chủ';
                }
            }
        }

        async logout() {
            if (this.token) {
                try {
                    await fetch('/api/auth/logout', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                } catch(e){}
            }
            this.token = null;
            this.currentUser = null;
            localStorage.removeItem('phutai_auth_token');
            localStorage.removeItem('phutai_cached_user');
            this.currentMap = null;
            if (this.requiresAuth) { window.location.reload(); return; }
            this.updateHeaderUI();
            await this.loadUserMaps();
        }

        // --- MAP WORKSPACE ACTIONS ---

        async loadUserMaps() {
            try {
                const headers = this.token ? { 'Authorization': `Bearer ${this.token}` } : {};
                const res = await fetch('/api/user/maps', { headers });
                if (res.ok) {
                    const data = await res.json();
                    this.userMaps = data.maps || [];
                }
            } catch (err) {
                // Static / Offline local maps storage
                const localMaps = localStorage.getItem('phutai_local_maps');
                if (localMaps) {
                    try { this.userMaps = JSON.parse(localMaps); } catch(e){}
                }
            }

            // If user has no maps, create a default one
            if (this.userMaps.length === 0) {
                const defMap = {
                    id: 'map_default',
                    name: this.currentUser ? `Bản đồ của ${this.currentUser.full_name}` : 'Bản Đồ Làm Việc Chung',
                    description: 'Không gian làm việc chính',
                    province: 'Quảng Ngãi',
                    is_owner: true,
                    layer_count: 0
                };
                this.userMaps = [defMap];
            }

            // Set current map to active or first map
            const lastMapId = localStorage.getItem('phutai_active_map_id');
            const found = this.userMaps.find(m => m.id === lastMapId);
            this.currentMap = found || this.userMaps[0];
            localStorage.setItem('phutai_active_map_id', this.currentMap.id);

            this.updateHeaderUI();
            this.renderMyMapsList();
        }

        renderMyMapsList() {
            const container = document.getElementById('user-maps-list-container');
            const activeNameEl = document.getElementById('current-active-map-name');
            if (activeNameEl && this.currentMap) activeNameEl.textContent = this.currentMap.name;

            if (!container) return;

            container.innerHTML = this.userMaps.map(m => {
                const isActive = (this.currentMap && this.currentMap.id === m.id);
                return `
                    <div class="user-map-card" style="padding: 12px 14px; background: ${isActive ? 'rgba(2, 132, 199, 0.15)' : 'rgba(15, 23, 42, 0.6)'}; border: 1px solid ${isActive ? '#0284c7' : 'rgba(255,255,255,0.08)'}; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                        <div>
                            <div style="font-size: 13px; font-weight: 800; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
                                <span>🗺️</span>
                                <span>${m.name}</span>
                                ${isActive ? '<span style="font-size: 10px; background: #0284c7; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: 700;">ĐANG CHỌN</span>' : ''}
                                ${m.is_public ? '<span style="font-size: 10px; background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 6px; border-radius: 4px;">Công khai</span>' : '<span style="font-size: 10px; background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 2px 6px; border-radius: 4px;">Riêng tư</span>'}
                            </div>
                            <div style="font-size: 11px; color: #94a3b8; margin-top: 3px;">
                                Tỉnh: <b>${m.province || 'Quảng Ngãi'}</b> &nbsp;|&nbsp; Lớp riêng: <b>${m.layer_count || 0}</b> ${m.description ? `&nbsp;|&nbsp; <i>${m.description}</i>` : ''}
                            </div>
                        </div>

                        <div style="display: flex; gap: 6px;">
                            ${!isActive ? `
                                <button class="btn-primary" onclick="window.userWorkspace.selectMap('${m.id}')" style="padding: 6px 12px; font-size: 11px; font-weight: 700; background: #0284c7;">
                                    ▶️ Mở Bản Đồ
                                </button>
                            ` : `
                                <span style="font-size: 11px; color: #38bdf8; font-weight: 700; padding: 6px;">Đang Mở</span>
                            `}
                            ${m.is_owner ? `
                                <button class="btn-header" onclick="window.userWorkspace.deleteMap('${m.id}')" style="padding: 6px 8px; font-size: 11px; color: #f87171; border-color: rgba(239,68,68,0.3);" title="Xóa bản đồ này">
                                    🗑️
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        async selectMap(mapId) {
            const found = this.userMaps.find(m => m.id === mapId);
            if (!found) return;

            this.currentMap = found;
            localStorage.setItem('phutai_active_map_id', mapId);

            // Fly map to coordinates of this map
            if (window.mapController && window.mapController.map) {
                const lon = found.center_lon || 108.68;
                const lat = found.center_lat || 15.02;
                const zoom = found.zoom_level || 11.0;
                window.mapController.map.flyTo({ center: [lon, lat], zoom: zoom, essential: true });
            }

            this.updateHeaderUI();
            this.renderMyMapsList();

            // Close modal
            const overlay = document.getElementById('user-maps-modal-overlay');
            if (overlay) overlay.classList.remove('open');

            // Refresh layers catalog
            if (window.app && window.app.loadLayersCatalog) {
                await window.app.loadLayersCatalog();
            }
        }

        async createNewMap(name, description, province, is_public) {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

                const res = await fetch('/api/user/maps', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ name, description, province, is_public })
                });

                if (res.ok) {
                    const data = await res.json();
                    await this.loadUserMaps();
                    if (data.map) {
                        await this.selectMap(data.map.id);
                    }
                    return;
                }
            } catch(e){}

            // Offline fallback map creation
            const newMap = {
                id: `map_${Date.now()}`,
                name: name,
                description: description,
                province: province,
                is_owner: true,
                is_public: is_public,
                layer_count: 0
            };
            this.userMaps.unshift(newMap);
            localStorage.setItem('phutai_local_maps', JSON.stringify(this.userMaps));
            await this.selectMap(newMap.id);
        }

        async deleteMap(mapId) {
            if (!confirm('Bạn có chắc chắn muốn xóa bản đồ này không? Toàn bộ lớp bản đồ riêng sẽ bị xóa.')) return;

            try {
                const headers = this.token ? { 'Authorization': `Bearer ${this.token}` } : {};
                await fetch(`/api/user/maps/${mapId}`, { method: 'DELETE', headers });
            } catch(e){}

            this.userMaps = this.userMaps.filter(m => m.id !== mapId);
            localStorage.setItem('phutai_local_maps', JSON.stringify(this.userMaps));

            if (this.currentMap && this.currentMap.id === mapId) {
                this.currentMap = this.userMaps[0] || null;
            }
            await this.loadUserMaps();
        }
    }

    window.userWorkspace = new UserWorkspaceManager();

})(window);
