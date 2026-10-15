import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { normalizeGeoJSON, featureName, geometryKind, searchText } from './geojson.js';
import { sampleData } from './sample-data.js';

const $ = (selector) => document.querySelector(selector);
const storageKey = 'gis.workspace.features.v1';
const kinds = { Point: { label: 'Điểm', className: 'point' }, LineString: { label: 'Đường', className: 'line' }, Polygon: { label: 'Vùng', className: 'polygon' } };
let collection = normalizeGeoJSON(sampleData);
let activeFilter = 'all';
let addingPoint = false;
let statusTimer;

function notify(message, type = 'success') {
  clearTimeout(statusTimer);
  $('#status').textContent = message;
  $('#status').dataset.type = type;
  $('#status').hidden = false;
  statusTimer = setTimeout(() => { $('#status').hidden = true; }, 6500);
}

try {
  const stored = localStorage.getItem(storageKey);
  if (stored) collection = normalizeGeoJSON(JSON.parse(stored));
} catch {
  notify('Không đọc được dữ liệu đã lưu. Đang hiển thị dữ liệu mẫu.', 'error');
}

const map = L.map('map', { zoomControl: false }).setView([10.777, 106.7], 15);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
const basemap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
let tileErrorShown = false;
basemap.on('tileerror', () => {
  if (!tileErrorShown) {
    tileErrorShown = true;
    notify('Chưa tải được bản đồ nền. Bạn vẫn có thể xem và chỉnh sửa dữ liệu GeoJSON.', 'error');
  }
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function popup(feature, index) {
  const root = element('div', 'map-popup');
  root.append(element('span', 'popup-kind', kinds[geometryKind(feature)].label));
  root.append(element('h3', '', featureName(feature, index)));
  if (typeof feature.properties.description === 'string') root.append(element('p', 'popup-description', feature.properties.description.slice(0, 2000)));
  if (feature.geometry.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates;
    root.append(element('p', 'popup-coordinates', `Vĩ độ ${lat.toFixed(5)} · Kinh độ ${lng.toFixed(5)}`));
  }
  return root;
}

const geoLayer = L.geoJSON(null, {
  style: (feature) => geometryKind(feature) === 'Point'
    ? { color: '#fff', weight: 3, fillColor: '#0f766e', fillOpacity: 1 }
    : { color: geometryKind(feature) === 'Polygon' ? '#d68a32' : '#0e8982', weight: 4, fillOpacity: 0.16 },
  pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#0f766e', fillOpacity: 1 }),
  onEachFeature: (feature, layer) => {
    const index = collection.features.indexOf(feature);
    layer.bindPopup(popup(feature, index));
    layer.on('click', () => {
      const item = document.querySelector(`[data-feature-index="${index}"]`);
      document.querySelectorAll('.feature-card').forEach((button) => button.classList.remove('selected'));
      item?.classList.add('selected');
    });
  },
}).addTo(map);

function fitVisible() {
  const bounds = geoLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 64], maxZoom: 16 });
  else notify('Không có đối tượng phù hợp để hiển thị.', 'error');
}

function render({ fit = false } = {}) {
  const query = searchText($('#search').value.trim());
  const visible = collection.features.map((feature, index) => ({ feature, index })).filter(({ feature, index }) => {
    const description = typeof feature.properties.description === 'string' ? feature.properties.description : '';
    return (activeFilter === 'all' || geometryKind(feature) === activeFilter) && searchText(`${featureName(feature, index)} ${description}`).includes(query);
  });
  geoLayer.clearLayers();
  $('#feature-list').replaceChildren();
  $('#feature-count').textContent = String(visible.length);
  for (const { feature, index } of visible) {
    const kind = kinds[geometryKind(feature)];
    const li = element('li');
    const button = element('button', 'feature-card');
    button.type = 'button';
    button.dataset.featureIndex = String(index);
    const icon = element('span', `feature-icon ${kind.className}`);
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    const info = element('span', 'feature-info');
    info.append(element('strong', '', featureName(feature, index)));
    info.append(element('small', '', typeof feature.properties.category === 'string' ? feature.properties.category : kind.label));
    button.append(info, element('span', 'feature-arrow', '›'));
    li.append(button);
    $('#feature-list').append(li);
    geoLayer.addData(feature);
    const layer = geoLayer.getLayers().at(-1);
    button.addEventListener('click', () => {
      document.querySelectorAll('.feature-card').forEach((item) => item.classList.remove('selected'));
      button.classList.add('selected');
      const bounds = layer.getBounds?.() ?? L.latLngBounds([layer.getLatLng()]);
      map.fitBounds(bounds, { padding: [60, 80], maxZoom: 17 });
      layer.openPopup();
    });
  }
  if (!visible.length) {
    const empty = element('li', 'empty-state', 'Chưa có đối tượng phù hợp. Thử từ khóa khác hoặc nhập một tệp GeoJSON.');
    $('#feature-list').append(empty);
  }
  if (fit && visible.length) fitVisible();
}

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(collection));
    return true;
  } catch {
    notify('Chưa lưu được trên thiết bị. Hãy xuất GeoJSON để giữ lại các thay đổi.', 'error');
    return false;
  }
}

function clearFilters() {
  $('#search').value = '';
  activeFilter = 'all';
  document.querySelectorAll('.filter').forEach((button) => {
    const active = button.dataset.filter === 'all';
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

$('#search').addEventListener('input', () => render());
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  render({ fit: true });
}));
$('#fit-button').addEventListener('click', fitVisible);
$('#basemap-toggle').addEventListener('change', (event) => {
  if (event.target.checked) basemap.addTo(map);
  else map.removeLayer(basemap);
});

function setAdding(value) {
  addingPoint = value;
  $('#add-point-button').setAttribute('aria-pressed', String(value));
  $('#add-point-button').textContent = value ? '× Hủy thêm điểm' : '＋ Thêm điểm';
  $('#map').style.cursor = value ? 'crosshair' : '';
}
$('#add-point-button').addEventListener('click', () => {
  setAdding(!addingPoint);
  if (addingPoint) notify('Nhấp vào bản đồ để tạo một điểm mới. Nhấn Escape để hủy.');
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setAdding(false); });
map.on('mousemove', ({ latlng }) => {
  $('#coordinates').textContent = `${latlng.lat.toFixed(5)}, ${latlng.wrap().lng.toFixed(5)} · WGS84`;
});
map.on('click', ({ latlng }) => {
  if (!addingPoint) return;
  if (collection.features.length >= 10000) {
    notify('Đã đạt giới hạn 10.000 đối tượng. Hãy xuất và tạo bộ dữ liệu mới.', 'error');
    return;
  }
  if (Math.abs(latlng.lat) > 90) return;
  collection.features.push({ type: 'Feature', properties: { name: `Điểm mới ${collection.features.length + 1}`, category: 'Điểm của bạn', description: 'Được thêm trực tiếp trên bản đồ.' }, geometry: { type: 'Point', coordinates: [Number(latlng.wrap().lng.toFixed(6)), Number(latlng.lat.toFixed(6))] } });
  setAdding(false);
  clearFilters();
  render();
  if (persist()) notify('Đã thêm điểm và lưu trên thiết bị.');
});

$('#import-button').addEventListener('click', () => $('#import-input').click());
$('#import-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Tệp quá lớn. Vui lòng chọn GeoJSON nhỏ hơn hoặc bằng 5 MB.');
    const next = normalizeGeoJSON(JSON.parse(await file.text()));
    collection = next;
    setAdding(false);
    clearFilters();
    render({ fit: true });
    if (persist()) notify(`Đã nhập ${collection.features.length} đối tượng từ ${file.name}.`);
  } catch (error) {
    notify(error instanceof SyntaxError ? 'Không đọc được JSON. Vui lòng kiểm tra nội dung tệp.' : error.message, 'error');
  } finally {
    event.target.value = '';
  }
});
$('#export-button').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(collection, null, 2)], { type: 'application/geo+json' }));
  const link = element('a');
  link.href = url;
  link.download = 'gis-data.geojson';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`Đã xuất ${collection.features.length} đối tượng.`);
});
$('#reset-button').addEventListener('click', () => {
  if (!window.confirm('Thay thế dữ liệu hiện tại bằng dữ liệu mẫu? Hãy xuất GeoJSON trước nếu bạn muốn giữ lại thay đổi.')) return;
  collection = normalizeGeoJSON(sampleData);
  setAdding(false);
  clearFilters();
  render({ fit: true });
  if (persist()) notify('Đã khôi phục dữ liệu mẫu.');
});
render({ fit: true });
