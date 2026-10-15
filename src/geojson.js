const MAX_FEATURES = 10000;

function invalid(message) {
  throw new Error(`GeoJSON không hợp lệ: ${message}`);
}

function position(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3 || !value.every(Number.isFinite)) {
    invalid('tọa độ phải gồm kinh độ, vĩ độ và độ cao tùy chọn.');
  }
  if (Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) {
    invalid('tọa độ cần dùng WGS84: kinh độ ±180, vĩ độ ±90.');
  }
}

function positions(value, minimum) {
  if (!Array.isArray(value) || value.length < minimum) invalid(`cần ít nhất ${minimum} tọa độ.`);
  value.forEach(position);
}

function polygon(value) {
  if (!Array.isArray(value) || !value.length) invalid('vùng cần có ít nhất một vòng khép kín.');
  value.forEach((ring) => {
    positions(ring, 4);
    const first = ring[0];
    const last = ring.at(-1);
    if (first.length !== last.length || first.some((n, i) => n !== last[i])) invalid('vòng của vùng phải khép kín.');
  });
}

function multiple(value, check) {
  if (!Array.isArray(value) || !value.length) invalid('đối tượng nhiều phần cần ít nhất một phần.');
  value.forEach(check);
}

function geometry(value) {
  if (!value || typeof value !== 'object') invalid('đối tượng cần có hình học.');
  const c = value.coordinates;
  switch (value.type) {
    case 'Point': position(c); break;
    case 'MultiPoint': positions(c, 1); break;
    case 'LineString': positions(c, 2); break;
    case 'MultiLineString': multiple(c, (line) => positions(line, 2)); break;
    case 'Polygon': polygon(c); break;
    case 'MultiPolygon': multiple(c, polygon); break;
    default: invalid('chỉ hỗ trợ Point, LineString, Polygon và các dạng Multi tương ứng.');
  }
}

export function normalizeGeoJSON(input) {
  if (!input || typeof input !== 'object') invalid('tệp cần chứa một Feature hoặc FeatureCollection.');
  const features = input.type === 'Feature' ? [input] : input.type === 'FeatureCollection' ? input.features : null;
  if (!Array.isArray(features)) invalid('tệp cần chứa một Feature hoặc FeatureCollection.');
  if (features.length > MAX_FEATURES) invalid(`chỉ hỗ trợ tối đa ${MAX_FEATURES} đối tượng.`);
  return {
    type: 'FeatureCollection',
    features: features.map((feature) => {
      if (!feature || feature.type !== 'Feature') invalid('mọi phần tử cần có type là Feature.');
      geometry(feature.geometry);
      if (feature.properties != null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties))) {
        invalid('properties cần là một đối tượng hoặc null.');
      }
      return {
        type: 'Feature',
        ...(typeof feature.id === 'string' || (typeof feature.id === 'number' && Number.isFinite(feature.id)) ? { id: feature.id } : {}),
        properties: structuredClone(feature.properties ?? {}),
        geometry: { type: feature.geometry.type, coordinates: structuredClone(feature.geometry.coordinates) },
      };
    }),
  };
}

export function geometryKind(feature) {
  return feature.geometry.type.replace(/^Multi/, '');
}

export function featureName(feature, index = 0) {
  const name = feature.properties?.name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 160) : `Đối tượng ${index + 1}`;
}

export function searchText(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
