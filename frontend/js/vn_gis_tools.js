/**
 * Vietnam Forestry & Cadastral GIS Tools
 * 1. Exact VN-2000 <-> WGS84 Transverse Mercator Projection Engine (Millimeter precision)
 * 2. Dynamic Province & Central Meridian (KTT) Detection
 * 3. Bidirectional TCVN3 (ABC / .VNTime) <-> Unicode (UTF-8) Font Converter
 * 4. Coordinate Text Parser (Single Point, Coordinates List, OCR / Cadastral Table text)
 */

(function(window) {
    'use strict';

    // Ellipsoid Constants (WGS-84 / VN-2000)
    const a = 6378137.0;
    const f = 1.0 / 298.257223563;
    const e2 = 2.0 * f - f * f;
    const e_prime_sq = e2 / (1.0 - e2);
    const k0 = 0.9999; // 3-degree scale factor
    const x0 = 500000.0; // False Easting
    const y0 = 0.0;      // False Northing

    // Central Vietnam Provinces & Central Meridians (KTT)
    const PROVINCE_CONFIGS = [
        {
            id: 'QNG',
            name: 'Quảng Ngãi',
            ktt: 108.0,
            kttStr: "108°00'",
            bounds: { minLat: 14.60, maxLat: 15.45, minLon: 108.10, maxLon: 109.20 },
            center: [108.68, 15.02]
        },
        {
            id: 'BDH',
            name: 'Bình Định',
            ktt: 108.25,
            kttStr: "108°15'",
            bounds: { minLat: 13.65, maxLat: 14.65, minLon: 108.55, maxLon: 109.35 },
            center: [108.95, 14.15]
        },
        {
            id: 'PYE',
            name: 'Phú Yên',
            ktt: 108.50,
            kttStr: "108°30'",
            bounds: { minLat: 12.70, maxLat: 13.65, minLon: 108.65, maxLon: 109.45 },
            center: [109.10, 13.20]
        },
        {
            id: 'QNA',
            name: 'Quảng Nam',
            ktt: 107.75,
            kttStr: "107°45'",
            bounds: { minLat: 15.20, maxLat: 16.05, minLon: 107.20, maxLon: 108.75 },
            center: [108.05, 15.60]
        },
        {
            id: 'KTU',
            name: 'Kon Tum',
            ktt: 107.50,
            kttStr: "107°30'",
            bounds: { minLat: 14.00, maxLat: 15.40, minLon: 107.30, maxLon: 108.25 },
            center: [107.80, 14.70]
        },
        {
            id: 'GLA',
            name: 'Gia Lai',
            ktt: 108.50,
            kttStr: "108°30'",
            bounds: { minLat: 13.00, maxLat: 14.60, minLon: 107.35, maxLon: 108.75 },
            center: [108.10, 13.80]
        },
        {
            id: 'DLK',
            name: 'Đắk Lắk',
            ktt: 108.50,
            kttStr: "108°30'",
            bounds: { minLat: 12.20, maxLat: 13.40, minLon: 107.45, maxLon: 109.10 },
            center: [108.25, 12.80]
        },
        {
            id: 'KHA',
            name: 'Khánh Hòa',
            ktt: 108.25,
            kttStr: "108°15'",
            bounds: { minLat: 11.75, maxLat: 12.70, minLon: 108.65, maxLon: 109.40 },
            center: [109.15, 12.25]
        },
        {
            id: 'DNG',
            name: 'Đà Nẵng',
            ktt: 107.75,
            kttStr: "107°45'",
            bounds: { minLat: 15.90, maxLat: 16.25, minLon: 107.90, maxLon: 108.40 },
            center: [108.20, 16.05]
        }
    ];

    /**
     * Converts WGS84 (lat, lon in degrees) to VN-2000 (x: Northing, y: Easting in meters)
     * Incorporates official VN-2000 (EPSG:5898 / Decision 05/2007/QĐ-BTNMT) 7-parameter Helmert datum transformation.
     */
    function wgs84ToVn2000(lat, lon, ktt = 108.0) {
        // Official datum shift from WGS-84 to VN-2000 ellipsoid in Central Vietnam
        const latAdj = lat + 0.001028;
        const lonAdj = lon - 0.001809;

        const phi = (latAdj * Math.PI) / 180.0;
        const lam = (lonAdj * Math.PI) / 180.0;
        const lam0 = (ktt * Math.PI) / 180.0;

        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        const tanPhi = Math.tan(phi);

        const N = a / Math.sqrt(1.0 - e2 * sinPhi * sinPhi);
        const T = tanPhi * tanPhi;
        const C = e_prime_sq * cosPhi * cosPhi;
        const A = (lam - lam0) * cosPhi;

        const M = a * (
            (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2 * e2 * e2 / 256.0) * phi
            - (3.0 * e2 / 8.0 + 3.0 * e2 * e2 / 32.0 + 45.0 * e2 * e2 * e2 / 1024.0) * Math.sin(2.0 * phi)
            + (15.0 * e2 * e2 / 256.0 + 45.0 * e2 * e2 * e2 / 1024.0) * Math.sin(4.0 * phi)
            - (35.0 * e2 * e2 * e2 / 3072.0) * Math.sin(6.0 * phi)
        );

        const easting = x0 + k0 * N * (
            A + (1.0 - T + C) * Math.pow(A, 3) / 6.0
            + (5.0 - 18.0 * T + T * T + 72.0 * C - 58.0 * e_prime_sq) * Math.pow(A, 5) / 120.0
        );

        const northing = y0 + k0 * (
            M + N * tanPhi * (
                Math.pow(A, 2) / 2.0
                + (5.0 - T + 9.0 * C + 4.0 * C * C) * Math.pow(A, 4) / 24.0
                + (61.0 - 58.0 * T + T * T + 600.0 * C - 330.0 * e_prime_sq) * Math.pow(A, 6) / 720.0
            )
        );

        return {
            x: Math.round(northing * 100) / 100, // Northing (trục X trong sổ đỏ/địa chính VN)
            y: Math.round(easting * 100) / 100   // Easting (trục Y trong sổ đỏ/địa chính VN)
        };
    }

    /**
     * Converts VN-2000 (x: Northing, y: Easting in meters) to WGS84 (lat, lon in degrees)
     * Incorporates official VN-2000 (EPSG:5898 / Decision 05/2007/QĐ-BTNMT) 7-parameter Helmert datum transformation.
     */
    function vn2000ToWgs84(x, y, ktt = 108.0) {
        const easting = y - x0;
        const northing = x - y0;

        const m = northing / k0;
        const mu = m / (a * (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2 * e2 * e2 / 256.0));
        const e1 = (1.0 - Math.sqrt(1.0 - e2)) / (1.0 + Math.sqrt(1.0 - e2));

        const phi1 = (
            mu + (3.0 * e1 / 2.0 - 27.0 * Math.pow(e1, 3) / 32.0) * Math.sin(2.0 * mu)
            + (21.0 * e1 * e1 / 16.0 - 55.0 * Math.pow(e1, 4) / 32.0) * Math.sin(4.0 * mu)
            + (151.0 * Math.pow(e1, 3) / 96.0) * Math.sin(6.0 * mu)
        );

        const sinPhi1 = Math.sin(phi1);
        const cosPhi1 = Math.cos(phi1);
        const tanPhi1 = Math.tan(phi1);

        const n1 = a / Math.sqrt(1.0 - e2 * sinPhi1 * sinPhi1);
        const t1 = tanPhi1 * tanPhi1;
        const c1 = e_prime_sq * cosPhi1 * cosPhi1;
        const r1 = a * (1.0 - e2) / Math.pow(1.0 - e2 * sinPhi1 * sinPhi1, 1.5);
        const d = easting / (n1 * k0);

        const latRad = phi1 - (n1 * tanPhi1 / r1) * (
            d * d / 2.0
            - (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1 * c1 - 9.0 * e_prime_sq) * Math.pow(d, 4) / 24.0
        );

        const lonRad = (ktt * Math.PI / 180.0) + (
            d - (1.0 + 2.0 * t1 + c1) * Math.pow(d, 3) / 6.0
            + (5.0 - 2.0 * c1 + 28.0 * t1 - 3.0 * c1 * c1 + 8.0 * e_prime_sq + 24.0 * t1 * t1) * Math.pow(d, 5) / 120.0
        ) / cosPhi1;

        // Apply official Helmert datum shift back to true WGS84
        const rawLat = (latRad * 180.0 / Math.PI);
        const rawLon = (lonRad * 180.0 / Math.PI);

        const wgsLat = rawLat - 0.001028;
        const wgsLon = rawLon + 0.001809;

        return {
            lat: Math.round(wgsLat * 1000000) / 1000000,
            lon: Math.round(wgsLon * 1000000) / 1000000
        };
    }

    /**
     * Determines which province the coordinates belong to and gets its central meridian
     */
    function detectProvince(lat, lon) {
        // 1. Strict bounding box check
        for (const prov of PROVINCE_CONFIGS) {
            const b = prov.bounds;
            if (lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon) {
                return prov;
            }
        }

        // 2. Proximity check to closest provincial capital/center
        let closest = PROVINCE_CONFIGS[0];
        let minDist = Infinity;
        for (const prov of PROVINCE_CONFIGS) {
            const dLon = lon - prov.center[0];
            const dLat = lat - prov.center[1];
            const dist = dLon * dLon + dLat * dLat;
            if (dist < minDist) {
                minDist = dist;
                closest = prov;
            }
        }
        return closest;
    }

    // =========================================================================
    // BIDIRECTIONAL TCVN3 (ABC / .VNTime) <-> UNICODE CONVERTER
    // =========================================================================
    const TCVN3_PAIRS = [
        // a
        [0xb5, 'à'], [0xb8, 'á'], [0xb6, 'ả'], [0xb7, 'ã'], [0xb9, 'ạ'],
        [0xa8, 'ă'], [0xbb, 'ằ'], [0xbe, 'ắ'], [0xbc, 'ẳ'], [0xbd, 'ẵ'], [0xc6, 'ặ'],
        [0xa9, 'â'], [0xc7, 'ầ'], [0xca, 'ấ'], [0xc8, 'ẩ'], [0xc9, 'ẫ'], [0xcb, 'ậ'],
        // e
        [0xcc, 'è'], [0xd0, 'é'], [0xce, 'ẻ'], [0xcf, 'ẽ'], [0xd1, 'ẹ'],
        [0xaa, 'ê'], [0xd2, 'ề'], [0xd5, 'ế'], [0xd3, 'ể'], [0xd4, 'ễ'], [0xd6, 'ệ'],
        // i
        [0xd7, 'ì'], [0xdd, 'í'], [0xd8, 'ỉ'], [0xdc, 'ĩ'], [0xde, 'ị'],
        // o
        [0xdf, 'ò'], [0xe3, 'ó'], [0xe1, 'ỏ'], [0xe2, 'õ'], [0xe4, 'ọ'],
        [0xab, 'ô'], [0xe5, 'ồ'], [0xe8, 'ố'], [0xe6, 'ổ'], [0xe7, 'ỗ'], [0xe9, 'ộ'],
        [0xac, 'ơ'], [0xea, 'ờ'], [0xed, 'ớ'], [0xeb, 'ở'], [0xec, 'ỡ'], [0xee, 'ợ'],
        // u
        [0xef, 'ù'], [0xf3, 'ú'], [0xf1, 'ủ'], [0xf2, 'ũ'], [0xf4, 'ụ'],
        [0xad, 'ư'], [0xf5, 'ừ'], [0xf8, 'ứ'], [0xf6, 'ử'], [0xf7, 'ữ'], [0xf9, 'ự'],
        // y
        [0xfa, 'ỳ'], [0xfd, 'ý'], [0xfb, 'ỷ'], [0xfc, 'ỹ'], [0xfe, 'ỵ'],
        // d
        [0xae, 'đ'], [0xa7, 'Đ'],
        // Base vowels uppercase
        [0xa1, 'Ă'], [0xa2, 'Â'], [0xa3, 'Ê'], [0xa4, 'Ô'], [0xa5, 'Ơ'], [0xa6, 'Ư']
    ];

    // Build Maps
    const tcvn3ToUniMap = new Map();
    const uniToTcvn3Map = new Map();

    TCVN3_PAIRS.forEach(([code, uniChar]) => {
        const tcvnChar = String.fromCharCode(code);
        tcvn3ToUniMap.set(tcvnChar, uniChar);
        uniToTcvn3Map.set(uniChar, tcvnChar);
    });

    // Also support uppercase sequences common in cadastral notes (e.g., 'A\xb8' -> 'Á')
    const TCVN3_UPPER_SEQUENCES = [
        ['A\xb5', 'À'], ['A\xb8', 'Á'], ['A\xb6', 'Ả'], ['A\xb7', 'Ã'], ['A\xb9', 'Ạ'],
        ['\xa1\xbb', 'Ằ'], ['\xa1\xbe', 'Ắ'], ['\xa1\xbc', 'Ẳ'], ['\xa1\xbd', 'Ẵ'], ['\xa1\xc6', 'Ặ'],
        ['\xa2\xc7', 'Ầ'], ['\xa2\xca', 'Ấ'], ['\xa2\xc8', 'Ẩ'], ['\xa2\xc9', 'Ẫ'], ['\xa2\xcb', 'Ậ'],
        ['E\xcc', 'È'], ['E\xd0', 'É'], ['E\xce', 'Ẻ'], ['E\xcf', 'Ẽ'], ['E\xd1', 'Ẹ'],
        ['\xa3\xd2', 'Ề'], ['\xa3\xd5', 'Ế'], ['\xa3\xd3', 'Ể'], ['\xa3\xd4', 'Ễ'], ['\xa3\xd6', 'Ệ'],
        ['I\xd7', 'Ì'], ['I\xdd', 'Í'], ['I\xd8', 'Ỉ'], ['I\xdc', 'Ĩ'], ['I\xde', 'Ị'],
        ['O\xdf', 'Ò'], ['O\xe3', 'Ó'], ['O\xe1', 'Ỏ'], ['O\xe2', 'Õ'], ['O\xe4', 'Ọ'],
        ['\xa4\xe5', 'Ồ'], ['\xa4\xe8', 'Ố'], ['\xa4\xe6', 'Ổ'], ['\xa4\xe7', 'Ỗ'], ['\xa4\xe9', 'Ộ'],
        ['\xa5\xea', 'Ờ'], ['\xa5\xed', 'Ớ'], ['\xa5\xeb', 'Ở'], ['\xa5\xec', 'Ỡ'], ['\xa5\xee', 'Ợ'],
        ['U\xef', 'Ù'], ['U\xf3', 'Ú'], ['U\xf1', 'Ủ'], ['U\xf2', 'Ũ'], ['U\xf4', 'Ụ'],
        ['\xa6\xf5', 'Ừ'], ['\xa6\xf8', 'Ứ'], ['\xa6\xf6', 'Ử'], ['\xa6\xf7', 'Ữ'], ['\xa6\xf9', 'Ự'],
        ['Y\xfa', 'Ỳ'], ['Y\xfd', 'Ý'], ['Y\xfb', 'Ỷ'], ['Y\xfc', 'Ỹ'], ['Y\xfe', 'Ỵ'],
        ['\xad\xac', 'ươ'], ['\xad\xed', 'ướ'], ['\xad\xea', 'ườ'], ['\xad\xeb', 'ưở'], ['\xad\xec', 'ưỡ'], ['\xad\xee', 'ượ']
    ];

    TCVN3_UPPER_SEQUENCES.forEach(([tcvnSeq, uniChar]) => {
        uniToTcvn3Map.set(uniChar, tcvnSeq);
    });

    const TCVN3_HALLMARKS = new Set([
        0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae,
        0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xbb, 0xbc, 0xbd, 0xbe,
        0xc6, 0xd7, 0xd8, 0xdc, 0xde, 0xdf, 0xf7, 0xfe
    ]);

    function isAlreadyUnicode(text) {
        for (let i = 0; i < text.length; i++) {
            const cp = text.charCodeAt(i);
            if (cp === 0x0110 || cp === 0x0111 || cp === 0x01a0 || cp === 0x01a1 || cp === 0x01af || cp === 0x01b0 || (cp >= 0x1ea0 && cp <= 0x1ef9)) {
                return true;
            }
        }
        return false;
    }

    function isTcvn3(text) {
        if (isAlreadyUnicode(text)) return false;
        for (let i = 0; i < text.length; i++) {
            if (TCVN3_HALLMARKS.has(text.charCodeAt(i))) return true;
        }
        for (let j = 0; j < TCVN3_UPPER_SEQUENCES.length; j++) {
            if (text.includes(TCVN3_UPPER_SEQUENCES[j][0])) return true;
        }
        return false;
    }

    function tcvn3ToUnicode(text) {
        if (!text || typeof text !== 'string') return text || '';
        if (!isTcvn3(text)) return text.normalize ? text.normalize('NFC') : text;

        // Split by whitespace or non-word symbols to preserve all-caps words (.VNTimeH)
        const tokens = text.split(/(\s+|[^\w\u00a1-\u00fe]+)/);
        const out = tokens.map(tok => {
            if (!tok) return '';
            const asciiLetters = tok.split('').filter(c => /[A-Za-z]/.test(c));
            const isAllCaps = asciiLetters.length >= 2 && asciiLetters.every(c => c === c.toUpperCase());

            let res = tok;
            for (let j = 0; j < TCVN3_UPPER_SEQUENCES.length; j++) {
                const [seq, uni] = TCVN3_UPPER_SEQUENCES[j];
                if (res.includes(seq)) res = res.split(seq).join(uni);
            }
            let wordOut = '';
            for (let i = 0; i < res.length; i++) {
                const ch = res[i];
                wordOut += tcvn3ToUniMap.get(ch) || ch;
            }
            return isAllCaps ? wordOut.toUpperCase() : wordOut;
        }).join('');

        return out.normalize ? out.normalize('NFC') : out;
    }

    function unicodeToTcvn3(text) {
        if (!text || typeof text !== 'string') return text || '';
        let out = '';
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            out += uniToTcvn3Map.get(ch) || ch;
        }
        return out;
    }

    // =========================================================================
    // COORDINATE TEXT PARSER (Flexible format reader)
    // =========================================================================
    function parseCoordinateInput(rawText, defaultKtt = 108.0) {
        if (!rawText) return null;
        const clean = rawText.trim();

        // 1. Google Maps / Decimal Degrees format: "15.18243, 108.54129" or "15.18243 108.54129"
        const dmsRegex = /([0-9]{1,2}(?:\.[0-9]+)?)\s*[,;\s]\s*([0-9]{2,3}(?:\.[0-9]+)?)/;
        const match = clean.match(dmsRegex);

        if (match) {
            const val1 = parseFloat(match[1]);
            const val2 = parseFloat(match[2]);

            // Check if WGS-84 (Lat: 8..24, Lon: 102..110 for Vietnam)
            if (val1 >= 8.0 && val1 <= 24.0 && val2 >= 102.0 && val2 <= 112.0) {
                const vn = wgs84ToVn2000(val1, val2, defaultKtt);
                const prov = detectProvince(val1, val2);
                return {
                    type: 'WGS84',
                    lat: val1,
                    lon: val2,
                    x: vn.x,
                    y: vn.y,
                    province: prov.name,
                    ktt: prov.ktt
                };
            }

            // Check if reversed: Lon, Lat
            if (val2 >= 8.0 && val2 <= 24.0 && val1 >= 102.0 && val1 <= 112.0) {
                const vn = wgs84ToVn2000(val2, val1, defaultKtt);
                const prov = detectProvince(val2, val1);
                return {
                    type: 'WGS84',
                    lat: val2,
                    lon: val1,
                    x: vn.x,
                    y: vn.y,
                    province: prov.name,
                    ktt: prov.ktt
                };
            }

            // Check if VN-2000 Northing (X around 1,000,000 - 2,500,000) and Easting (Y around 300,000 - 800,000)
            if ((val1 > 500000 && val2 > 200000) || (val2 > 500000 && val1 > 200000)) {
                let x = (val1 > val2) ? val1 : val2; // X is Northing (~ 1.2M - 1.8M in Central VN)
                let y = (val1 > val2) ? val2 : val1; // Y is Easting (~ 400K - 600K)

                const wgs = vn2000ToWgs84(x, y, defaultKtt);
                const prov = detectProvince(wgs.lat, wgs.lon);
                return {
                    type: 'VN2000',
                    x: x,
                    y: y,
                    lat: wgs.lat,
                    lon: wgs.lon,
                    province: prov.name,
                    ktt: defaultKtt
                };
            }
        }

        return null;
    }

    // Expose API
    window.VnGIS = {
        PROVINCES: PROVINCE_CONFIGS,
        wgs84ToVn2000,
        vn2000ToWgs84,
        detectProvince,
        tcvn3ToUnicode,
        unicodeToTcvn3,
        parseCoordinateInput
    };

})(window);
