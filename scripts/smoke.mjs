import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
let browser;
let passed = 0;
function pass(name) { passed++; console.log(`PASS ${name}`); }

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Vite stopped: ${output}`);
    try {
      const response = await fetch(origin);
      ready = response.ok && (await response.text()).includes('GIS · Không gian bản đồ');
    } catch { /* Wait for this server to listen. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(ready, `Vite did not become ready: ${output}`);
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelectorAll('.feature-card').length === 5);
  assert.equal(await page.locator('.leaflet-overlay-pane path').count(), 5);
  pass('sample GeoJSON renders five interactive map features');

  await page.locator('.feature-card').first().click();
  await page.locator('.leaflet-popup-content h3').waitFor();
  assert.equal(await page.locator('.leaflet-popup-content h3').textContent(), 'Bưu điện Trung tâm');
  pass('selecting a location opens its map popup');

  await page.locator('#search').fill('ben thanh');
  assert.equal(await page.locator('.feature-card').count(), 1);
  assert.match(await page.locator('.feature-card').textContent(), /Chợ Bến Thành/);
  await page.locator('#search').fill('');
  await page.locator('[data-filter="Polygon"]').click();
  assert.equal(await page.locator('.feature-card').count(), 1);
  assert.equal(await page.locator('.leaflet-overlay-pane path').count(), 1);
  pass('Vietnamese search and geometry filters update map and list');

  await page.locator('#add-point-button').click();
  await page.locator('#map').click({ position: { x: 180, y: 260 } });
  await page.waitForFunction(() => document.querySelectorAll('.feature-card').length === 6);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.feature-card').length === 6);
  pass('adding a point persists across a page reload');

  const hostileName = '<img src=x onerror=alert(1)>';
  const imported = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: hostileName, description: 'Dữ liệu kiểm tra' }, geometry: { type: 'Point', coordinates: [106.7, 10.77] } }] };
  await page.locator('#import-input').setInputFiles({ name: 'test.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(imported)) });
  await page.waitForFunction(() => document.querySelectorAll('.feature-card').length === 1);
  assert.equal(await page.locator('.feature-card strong').textContent(), hostileName);
  await page.locator('.feature-card').click();
  await page.locator('.leaflet-popup-content h3').waitFor();
  assert.equal(await page.locator('.leaflet-popup-content h3 img').count(), 0);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), imported);
  pass('GeoJSON import/export preserves data and treats names as plain text');

  const invalid = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [999, 20] } };
  await page.locator('#import-input').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await page.waitForFunction(() => document.querySelector('#status').dataset.type === 'error');
  assert.equal(await page.locator('.feature-card strong').textContent(), hostileName);
  pass('invalid imports show an error and preserve the current dataset');

  await page.locator('#basemap-toggle').uncheck();
  assert.equal(await page.locator('.leaflet-tile-pane img').count(), 0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#reset-button').click();
  await page.waitForFunction(() => document.querySelectorAll('.feature-card').length === 5);
  pass('basemap toggle and explicit sample-data reset work');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const mapBox = await page.locator('#map').boundingBox();
  assert.ok(mapBox.width > 300 && mapBox.height >= 400);
  assert.deepEqual(pageErrors, []);
  pass('mobile layout fits the viewport with no uncaught browser errors');
  console.log(`${passed} browser checks passed.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
