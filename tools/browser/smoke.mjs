import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { chromium } from 'playwright';

// Run against a local diagnostic instance or a dedicated test deployment. This
// script sends GET requests only, never signs in, and never changes saved data.
const baseURL = process.env.WEBGIS_URL || 'http://127.0.0.1:8000';
const target = new URL(baseURL);
const screenshotDirectory = process.env.WEBGIS_SCREENSHOT_DIR || '/tmp';
const errors = [];
const externalFailures = new Set();
const apiPaths = new Set();
const internalFailures = new Set();
const knownMissingLayer = 'layer_f3f5750f';
const missingLayers = new Set();

function expectedMissingSource(pathname) {
  return pathname === `/api/layers/${knownMissingLayer}/features`
    || pathname === `/data/layers/${knownMissingLayer}_overview.geojson`;
}

let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  try {
    await access('/usr/bin/chromium');
    executablePath = '/usr/bin/chromium';
  } catch { /* Use Playwright's installed Chromium when system Chromium is absent. */ }
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

function observe(page) {
  page.on('pageerror', () => errors.push('Uncaught application JavaScript error'));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const source = message.location().url;
    const text = message.text();
    if (source.startsWith(target.origin + '/js/')
      && !text.includes(`Error loading vector layer ${knownMissingLayer}:`)) {
      errors.push('Application script logged an unexpected caught error');
    }
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.origin !== target.origin) externalFailures.add(url.hostname);
    else if (request.failure()?.errorText !== 'net::ERR_ABORTED' && !expectedMissingSource(url.pathname)) internalFailures.add(url.pathname);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== target.origin) {
      if (response.status() >= 400) externalFailures.add(url.hostname);
    } else {
      if (url.pathname.startsWith('/api/')) apiPaths.add(url.pathname);
      if (response.status() >= 400 && url.pathname !== '/favicon.ico' && !expectedMissingSource(url.pathname)) internalFailures.add(url.pathname);
    }
  });
}

async function readOnly(context) {
  await context.route('**/*', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      errors.push('Blocked an attempted write during the read-only browser check');
      await route.abort('blockedbyclient');
    } else {
      await route.continue();
    }
  });
}

async function jsonGet(context, pathname) {
  const response = await context.request.get(new URL(pathname, baseURL).href);
  assert.equal(response.status(), 200, `GET ${pathname} must succeed`);
  return response.json();
}

async function assertMap(page) {
  // MapLibre's "idle" event waits for external raster tiles, so readiness uses
  // the loaded style and our local sources. Failed remote tiles stay observable.
  await page.waitForFunction(() => window.mapController?.mapLoaded === true, null, { timeout: 45000 });
  assert.equal(await page.locator('#map canvas.maplibregl-canvas').count(), 1, 'MapLibre canvas exists');
  assert.equal(await page.evaluate(() => {
    const map = window.mapController.map;
    return Boolean(map.painter?.context?.gl && !map.painter.context.gl.isContextLost());
  }), true, 'MapLibre has a live WebGL context');
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await readOnly(context);
  const page = await context.newPage();
  observe(page);
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  assert.match(await page.title(), /Phú Tài Bioenergy/);
  await page.getByRole('heading', { name: 'PHÚ TÀI BIOENERGY' }).waitFor();
  const config = await jsonGet(context, '/api/config');
  assert.equal(config.requires_auth, false, 'Use a local diagnostic instance with WEBGIS_REQUIRE_AUTH=0; never disable authentication on a public host');
  await assertMap(page);

  const provinces = await jsonGet(context, '/api/provinces');
  assert.ok(Array.isArray(provinces) && provinces.length === 3, 'Three real province summaries exist');
  const plots = await jsonGet(context, '/api/plots?limit=1');
  assert.equal(plots.type, 'FeatureCollection');
  assert.ok(Array.isArray(plots.features) && plots.features.length > 0, 'Actual forest dataset returns features');
  assert.ok(plots.features[0].geometry, 'Actual forest feature includes geometry');
  const boundaries = await jsonGet(context, '/api/provinces/boundaries');
  assert.equal(boundaries.type, 'FeatureCollection');
  assert.ok(boundaries.features.length >= 3, 'Local administrative boundaries exist');
  const layers = await jsonGet(context, '/api/layers');
  assert.ok(Array.isArray(layers) && layers.length > 0, 'Actual layer catalog exists');
  let validatedLayers = 0;
  for (const layer of layers.filter(layer => layer.format !== 'mbtiles')) {
    const path = `/api/layers/${encodeURIComponent(layer.id)}/features`;
    const response = await context.request.get(new URL(path, baseURL).href);
    if (layer.id === knownMissingLayer && response.status() === 404) {
      // The archive contains only an attribute sample/index for this layer.
      // Preserve this limitation explicitly instead of manufacturing geometry.
      missingLayers.add(layer.id);
      continue;
    }
    assert.equal(response.status(), 200, `GET ${path} must succeed`);
    const collection = await response.json();
    assert.equal(collection.type, 'FeatureCollection');
    assert.ok(collection.features.length > 0, 'Layer overview returns actual features');
    assert.ok(collection.features.every(feature => feature.geometry), 'Layer features include geometries');
    validatedLayers++;
  }
  await page.waitForFunction(() => window.app?.allCatalogLayers?.length > 0);
  assert.ok(validatedLayers > 0, 'At least one supplied source layer was validated');
  await page.waitForFunction(missing => {
    const layers = window.app.allCatalogLayers.filter(layer => layer.format !== 'mbtiles' && !missing.includes(layer.id));
    return layers.every(layer => window.mapController.map.getSource(`vector-src-${layer.id}`));
  }, [...missingLayers], { timeout: 45000 });

  const provinceResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/plots' && url.searchParams.get('province') === 'Quảng Ngãi';
  });
  await page.locator('.province-pills [data-province="QNG"]').click();
  assert.equal((await provinceResponse).status(), 200);
  assert.equal(await page.evaluate(() => window.app.currentProvince), 'QNG');
  assert.equal(await page.locator('#filter-province').inputValue(), 'Quảng Ngãi');
  await page.locator('.province-pills [data-province="ALL"]').click();

  const searchResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/plots' && url.searchParams.get('query') === '__browser_smoke_no_match__';
  });
  await page.locator('#forest-search-input').fill('__browser_smoke_no_match__');
  const searchResult = await (await searchResponse).json();
  assert.equal(searchResult.type, 'FeatureCollection');
  assert.equal(searchResult.features.length, 0, 'Search returns no fabricated matches');
  const resetSearchResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/plots' && !url.searchParams.has('query');
  });
  await page.locator('#forest-search-input').fill('');
  assert.equal((await resetSearchResponse).status(), 200);

  await page.locator('[data-tab="tab-layers"]').click();
  await page.locator('#tab-layers.active').waitFor();
  await page.locator('[data-tab="tab-owners"]').click();
  await page.locator('#tab-owners.active').waitFor();
  await page.locator('#btn-dd-tools').click();
  await page.locator('#btn-open-coord-search-modal').click();
  await page.locator('#coord-search-modal-overlay.open').waitFor();
  await page.locator('#coord-search-modal-close-btn').click();
  await page.locator('#coord-search-modal-overlay.open').waitFor({ state: 'hidden' });
  await page.locator('#btn-toggle-sidebar').click();
  await page.locator('#app-sidebar.collapsed').waitFor();
  await page.locator('#btn-toggle-sidebar').click();
  await page.locator('#app-sidebar.collapsed').waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${screenshotDirectory}/phutai-desktop.png` });

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  await readOnly(mobileContext);
  const mobile = await mobileContext.newPage();
  observe(mobile);
  await mobile.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await assertMap(mobile);
  const mobileLayout = await mobile.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    canvasWidth: document.querySelector('#map canvas').getBoundingClientRect().width,
  }));
  assert.ok(mobileLayout.canvasWidth >= 300, 'Mobile map canvas remains at least 300px wide');
  assert.ok(mobileLayout.document <= mobileLayout.viewport + 1, 'No horizontal page overflow on mobile');
  assert.equal(await mobile.locator('.header-actions button:visible').evaluateAll(buttons => buttons.every(button => {
    const rect = button.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth;
  })), true, 'All mobile header actions fit the viewport');
  await mobile.locator('#btn-toggle-sidebar').click();
  await mobile.locator('#app-sidebar.collapsed').waitFor();
  await mobile.locator('#btn-dd-tools').click();
  await mobile.locator('#btn-open-coord-search-modal').click();
  await mobile.locator('#coord-search-modal-overlay.open').waitFor();
  const mobileModal = await mobile.locator('#coord-search-modal-overlay .modal-content').boundingBox();
  assert.ok(mobileModal.x >= 0 && mobileModal.x + mobileModal.width <= mobileLayout.viewport, 'Mobile coordinate modal fits the viewport');
  await mobile.locator('#coord-search-modal-close-btn').click();
  await mobile.locator('#coord-search-modal-overlay.open').waitFor({ state: 'hidden' });
  await mobile.locator('#btn-toggle-sidebar').click();
  await mobile.locator('#app-sidebar.collapsed').waitFor({ state: 'hidden' });
  await mobile.locator('#btn-toggle-sidebar').click();
  await mobile.locator('#app-sidebar.collapsed').waitFor();
  assert.equal(await mobile.locator('.map-floating-controls button:visible').evaluateAll(buttons => buttons.every(button => {
    const rect = button.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth;
  })), true, 'Mobile map controls fit the viewport');
  await mobile.screenshot({ path: `${screenshotDirectory}/phutai-mobile.png` });

  assert.equal(errors.length, 0, 'No uncaught application JavaScript errors');
  assert.equal(internalFailures.size, 0, `No failed local application/API requests: ${JSON.stringify([...internalFailures])}`);
  for (const route of ['/api/config', '/api/provinces', '/api/plots']) {
    assert.ok(apiPaths.has(route), `Browser fetched ${route}`);
  }
  assert.ok(apiPaths.has('/api/layers') || [...apiPaths].some(path => /^\/api\/user\/maps\/[^/]+\/layers$/.test(path)),
    'Browser fetched a layer catalog through its workspace or the shared layer API');
  console.log(JSON.stringify({
    status: missingLayers.size || externalFailures.size ? 'passed_with_limitations' : 'passed',
    checks: ['original branding', 'live MapLibre WebGL', 'real data APIs', 'layer rendering', 'province switch', 'search', 'sidebar', 'coordinate modal', 'mobile layout'],
    validatedLayerOverviews: validatedLayers,
    externalRasterFailures: [...externalFailures].sort(),
    missingLayerSourceCount: missingLayers.size,
    applicationJavaScriptErrors: errors.length,
    failedLocalRequestCount: internalFailures.size,
    mobileLayout,
    limitations: ['Full-resolution and overview geometry for layer_f3f5750f are missing from the supplied archive; only an attribute sample/index exists.', 'External raster availability and cloud OCR credentials are separate checks.'],
    screenshots: [`${screenshotDirectory}/phutai-desktop.png`, `${screenshotDirectory}/phutai-mobile.png`],
  }, null, 2));
} finally {
  await browser.close();
}
