import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeoJSON, geometryKind, featureName, searchText } from '../src/geojson.js';
import { sampleData } from '../src/sample-data.js';

const point = [106.7, 10.78];
const line = [point, [106.71, 10.79]];
const ring = [point, [106.71, 10.78], [106.71, 10.79], point];
const feature = (type = 'Point', coordinates = point, properties = { name: 'Địa điểm' }) => ({
  type: 'Feature', properties, geometry: { type, coordinates },
});
const collection = (features) => ({ type: 'FeatureCollection', features });

test('sample data is valid and survives a GeoJSON export/import round trip', () => {
  const normalized = normalizeGeoJSON(sampleData);
  assert.equal(normalized.features.length, 5);
  assert.deepEqual(normalizeGeoJSON(JSON.parse(JSON.stringify(normalized))), normalized);
  assert.deepEqual(new Set(normalized.features.map(geometryKind)), new Set(['Point', 'LineString', 'Polygon']));
});

test('all six supported geometries retain coordinates and map to display categories', () => {
  const cases = [
    ['Point', point, 'Point'],
    ['MultiPoint', line, 'Point'],
    ['LineString', line, 'LineString'],
    ['MultiLineString', [line, line], 'LineString'],
    ['Polygon', [ring], 'Polygon'],
    ['MultiPolygon', [[ring], [ring]], 'Polygon'],
  ];
  for (const [type, coordinates, kind] of cases) {
    const result = normalizeGeoJSON(feature(type, coordinates)).features[0];
    assert.equal(result.geometry.type, type);
    assert.deepEqual(result.geometry.coordinates, coordinates);
    assert.equal(geometryKind(result), kind);
  }
});

test('boundary WGS84 coordinates and optional finite altitude are accepted', () => {
  const input = collection([
    feature('Point', [-180, -90]),
    feature('Point', [180, 90, -15.5]),
    feature('Polygon', [ring, [[106.702, 10.782], [106.704, 10.782], [106.704, 10.784], [106.702, 10.782]]]),
  ]);
  assert.deepEqual(normalizeGeoJSON(input), input);
});

test('invalid positions fail instead of silently moving or truncating data', () => {
  const invalidPositions = [
    null, [], [106], ['106.7', 10.78], [NaN, 0], [Infinity, 0], [0, -Infinity],
    [180.001, 0], [-180.001, 0], [0, 90.001], [0, -90.001],
    [0, 0, NaN], [0, 0, 1, 2], { lng: 106.7, lat: 10.78 },
  ];
  for (const coordinates of invalidPositions) {
    assert.throws(() => normalizeGeoJSON(feature('Point', coordinates)), /GeoJSON không hợp lệ/);
  }
  assert.throws(() => normalizeGeoJSON(feature('LineString', [[0, 0], [181, 0]])), /WGS84/);
  assert.throws(() => normalizeGeoJSON(feature('MultiPolygon', [[[...ring.slice(0, 3), [Infinity, 0]]]])), /tọa độ/);
});

test('lines and polygon rings require enough positions and exact closure', () => {
  const invalidGeometries = [
    ['LineString', [point]],
    ['MultiPoint', []],
    ['MultiLineString', []],
    ['MultiLineString', [[point]]],
    ['Polygon', []],
    ['Polygon', [[point, [106.71, 10.78], point]]],
    ['Polygon', [[point, [106.71, 10.78], [106.71, 10.79], [106.7, 10.79]]]],
    ['Polygon', [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 2]]]],
    ['Polygon', [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0]]]],
    ['MultiPolygon', []],
    ['MultiPolygon', [[]]],
  ];
  for (const [type, coordinates] of invalidGeometries) {
    assert.throws(() => normalizeGeoJSON(feature(type, coordinates)), /GeoJSON không hợp lệ/);
  }
});

test('malformed documents, features and properties are rejected', () => {
  for (const input of [null, [], 'text', {}, { type: 'FeatureCollection' }, collection(null), collection([null]), collection([{ type: 'Point', coordinates: point }])]) {
    assert.throws(() => normalizeGeoJSON(input), /GeoJSON không hợp lệ/);
  }
  for (const geometry of [null, { type: 'GeometryCollection', geometries: [] }, { type: 'Unknown', coordinates: point }]) {
    assert.throws(() => normalizeGeoJSON({ ...feature(), geometry }), /GeoJSON không hợp lệ/);
  }
  for (const properties of [[], 'name', 7, false]) {
    assert.throws(() => normalizeGeoJSON(feature('Point', point, properties)), /properties/);
  }
  const withoutProperties = feature();
  delete withoutProperties.properties;
  assert.deepEqual(normalizeGeoJSON(withoutProperties).features[0].properties, {});
  assert.deepEqual(normalizeGeoJSON(feature('Point', point, null)).features[0].properties, {});
});

test('empty collections are valid and feature count limits are enforced', () => {
  assert.deepEqual(normalizeGeoJSON(collection([])), collection([]));
  assert.equal(normalizeGeoJSON(collection(Array.from({ length: 10000 }, () => feature()))).features.length, 10000);
  assert.throws(() => normalizeGeoJSON(collection(Array.from({ length: 10001 }, () => feature()))), /10000/);
});

test('normalization owns independent coordinates and nested properties', () => {
  const input = feature('Polygon', structuredClone([ring]), { name: 'Vùng gốc', metadata: { labels: ['gốc'] } });
  const normalized = normalizeGeoJSON(input);
  normalized.features[0].geometry.coordinates[0][0][0] = 105;
  normalized.features[0].properties.metadata.labels.push('mới');
  assert.equal(input.geometry.coordinates[0][0][0], 106.7);
  assert.deepEqual(input.properties.metadata.labels, ['gốc']);
  input.properties.name = 'Đã đổi';
  assert.equal(normalized.features[0].properties.name, 'Vùng gốc');
});

test('valid feature IDs survive serialization and unsupported IDs are discarded', () => {
  for (const id of ['diem-1', '', 0, 42, -0.5]) {
    const normalized = normalizeGeoJSON({ ...feature(), id });
    assert.equal(normalized.features[0].id, id);
    assert.deepEqual(normalizeGeoJSON(JSON.parse(JSON.stringify(normalized))), normalized);
  }
  for (const id of [null, true, {}, [], NaN, Infinity]) {
    assert.equal(Object.hasOwn(normalizeGeoJSON({ ...feature(), id }).features[0], 'id'), false);
  }
});

test('names are readable, bounded, and kept as literal text', () => {
  assert.equal(featureName(feature('Point', point, { name: '  Bến Bạch Đằng  ' })), 'Bến Bạch Đằng');
  assert.equal(featureName(feature('Point', point, { name: '<img src=x onerror=alert(1)>' })), '<img src=x onerror=alert(1)>');
  assert.equal(featureName(feature('Point', point, { name: 'a'.repeat(200) })).length, 160);
  for (const name of ['', '   ', 1, null, {}, ['Tên']]) {
    assert.equal(featureName(feature('Point', point, { name }), 4), 'Đối tượng 5');
  }
  assert.equal(featureName(feature('Point', point, null)), 'Đối tượng 1');
});

test('Vietnamese search matches case, composed accents and the letter đ', () => {
  assert.equal(searchText('BẾN BẠCH ĐẰNG'), 'ben bach dang');
  assert.equal(searchText('Địa điểm Hồ Chí Minh'), 'dia diem ho chi minh');
  assert.equal(searchText('Bến Thành'), searchText('Bến Thành'.normalize('NFD')));
  assert.ok(searchText('Bưu điện Trung tâm').includes(searchText('BUU DIEN')));
  assert.equal(searchText(123), '123');
});
