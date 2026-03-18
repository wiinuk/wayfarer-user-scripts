// ==UserScript==
// @name         Wayfarer Submission Helper
// @version      0.2
// @description  Show S2 Cells on Wayfarer Map (Minimal Version)
// @match        https://wayfarer.nianticlabs.com/new/submit/new
// @run-at       document-start
// ==/UserScript==
//@ts-check
//spell-checker: ignore wayspot Lngs longtitude cosphi Quadkey faceuv pois

/**
 * @typedef {object} MapMarkers
 * @property {{ readonly markers: readonly SelectedMarker[] }} selected
 * @property {{ readonly markers: readonly NearbyMarker[] }} nearby
 */
/**
 * @typedef {object} SelectedMarker
 * @property {boolean} clickable
 * @property {MarkerIcon} icon
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} zIndex
 */
/**
 * @typedef {SelectedMarker} NearbyMarker
 * @property {string} id
 * @property {NearbyData} infoWindowComponentData
 * @property {boolean} openInfoWindow
 */
/**
 * @typedef {object} SpotData
 * @property {string} guid
 * @property {string} title
 * @property {string} description
 * @property {string} imageUrl
 * @property {number} lat
 * @property {number} lng
 */
/**
 * @typedef {object} MarkerIcon
 * @property {string} url
 * @property {boolean} centerOnLocation
 * @property {IconSize} size
 */
/**
 * @typedef {object} IconSize
 * @property {number} width
 * @property {number} height
 */

/**
 * @template T
 * @param {HTMLElement} element
 * @param {(obj: unknown) => obj is T} predicate
 */
async function findValue(element, predicate) {
    /**
     * @param {HTMLElement | null} element
     */
    function getCSSSelector(element) {
        if (
            !(element && element instanceof Node) ||
            !(
                element.nodeType === Node.ELEMENT_NODE ||
                (element = element.parentElement)
            )
        ) {
            return "unknown";
        }

        var array = [];
        for (; element; element = element.parentElement) {
            if (element.id) {
                // #id
                array.unshift("#" + element.id);
                break;
            } else {
                // tagName.className:nth-of-type(n)
                var tagName = element.tagName;
                var text = tagName.toLowerCase();

                var list = element.classList;
                var len = list.length;
                for (var i = 0; i < len; i++) {
                    text += "." + list[i];
                }

                var n = 0;
                var pre;
                for (
                    pre = element;
                    (pre = pre.previousElementSibling) &&
                    (pre.tagName != tagName || ++n);

                ) {}
                var nth = n + 1;
                var next;
                if (!n) {
                    for (
                        next = element;
                        (next = next.nextElementSibling) &&
                        (next.tagName != tagName || !++n);

                    ) {}
                }
                if (n) {
                    text += ":nth-of-type(" + nth + ")";
                }

                array.unshift(text);
            }
        }
        return array.join(" > ");
    }

    /** @type {Map<string, T>} */
    const pathToValue = new Map();
    const seenObjects = new WeakSet();

    /**
     * @param {unknown} obj
     * @param {string} currentPath
     */
    function findMapInContext(obj, currentPath) {
        if (!obj || typeof obj !== "object") return;
        if (seenObjects.has(obj)) return;
        seenObjects.add(obj);

        try {
            if (obj instanceof Node) return;

            if (predicate(obj)) {
                pathToValue.set(currentPath, obj);
                return;
            }

            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    findMapInContext(item, `${currentPath}[${index}]`);
                });
                return;
            }
            for (const key in obj) {
                const nextPath = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(key)
                    ? `${currentPath}.${key}`
                    : `${currentPath}["${key
                          .replace('"', '"')
                          .replace("\\", "\\\\")}"]`;

                findMapInContext(
                    obj[/** @type {keyof typeof obj} */ (key)],
                    nextPath
                );
            }
        } catch (e) {}
    }

    if ("__ngContext__" in element) {
        const rootPath = `document.body.querySelector("${getCSSSelector(
            element
        )}").__ngContext__`;
        findMapInContext(element.__ngContext__, rootPath);
    }

    return Array.from(pathToValue.entries()).map(([path, value]) => ({
        path,
        value,
    }));
}

/**
 * @param {TemplateStringsArray} templateStringsArray
 * @param {unknown[]} substitutions
 * @returns {never}
 */
function raise(templateStringsArray, ...substitutions) {
    throw new Error(String.raw(templateStringsArray, ...substitutions));
}

/** @returns {Promise<google.maps.Map>} */
async function getGMapObject() {
    return await awaitElement(() => {
        try {
            /** @type {any} */
            const e = document.querySelector(
                "app-submit-wayspot-map agm-map > div"
            );
            return e.__ngContext__[8]._mapsWrapper._map.__zone_symbol__value;
        } catch {}
    });
}

/** @returns {Promise<MapMarkers>} */
async function getMarkersObject() {
    return await awaitElement(() => {
        try {
            /** @type {any} */
            const e = document.body.querySelector("app-submit-wayspot-map");
            return e.__ngContext__[13][4][8].markers;
        } catch {}
    });
}

// 要素が出現するまで待機するユーティリティ
/**
 * @template T
 * @param {() => T} get
 * @returns {Promise<NonNullable<T>>}
 */
function awaitElement(get) {
    return new Promise((resolve, reject) => {
        let currentInterval = 100;
        const maxInterval = 500;
        const queryLoop = () => {
            const ref = get();
            if (ref) return resolve(ref);
            setTimeout(
                queryLoop,
                Math.min((currentInterval *= 2), maxInterval)
            );
        };
        queryLoop();
    });
}

/**
 * @typedef {google.maps.LatLngLiteral} GLatLngLiteral
 */
/**
 * @typedef {object} GridOptions
 * @property {number} level
 * @property {google.maps.PolylineOptions | null} options
 */

/**
 * @param {google.maps.Map} map
 * @param {...GridOptions} gridOptions
 */
function addS2GridOverlay(map, ...gridOptions) {
    const overlay = new S2Overlay();

    function drawGrids() {
        for (const { level, options } of gridOptions) {
            overlay.drawCellGrid(map, level, options);
        }
    }
    drawGrids();
    map.addListener("idle", () => {
        overlay.clearGrid();
        drawGrids();
    });
}

/**
 * @param {S2Cell} cell
 * @param {google.maps.LatLngBounds} bounds
 */
function cellVsBounds(cell, bounds) {
    const cellCorners = cell.getCornerLatLngs();

    // セルの角が Bounds に含まれているか
    for (const cellCorner of cellCorners) {
        if (bounds.contains(cellCorner)) return true;
    }

    return cellVsBoundsRest(cellCorners, bounds);
}
/**
 * @param {readonly GLatLngLiteral[]} cellCorners
 * @param {google.maps.LatLngBounds} bounds
 * @returns
 */
function cellVsBoundsRest(cellCorners, bounds) {
    // セルの角を含む外接矩形に含まれなければ交差しない
    const cellBounds = new google.maps.LatLngBounds();
    for (const cellCorner of cellCorners) {
        cellBounds.extend(cellCorner);
    }
    if (!bounds.intersects(cellBounds)) return false;

    // Bounds の角がセルに含まれているか
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const boundsCorners = [
        sw,
        ne,
        new google.maps.LatLng(sw.lat(), ne.lng()), // 北西
        new google.maps.LatLng(ne.lat(), sw.lng()), // 南東
    ];
    for (const corner of boundsCorners) {
        if (pointVsPolygon(corner, cellCorners)) return true;
    }

    // 辺同士が交差しているか（十字に重なっている場合）
    const boundsEdges = [
        [boundsCorners[0], boundsCorners[3]], // 南辺
        [boundsCorners[3], boundsCorners[1]], // 東辺
        [boundsCorners[1], boundsCorners[2]], // 北辺
        [boundsCorners[2], boundsCorners[0]], // 西辺
    ];
    const cellEdges = [
        [cellCorners[0], cellCorners[1]],
        [cellCorners[1], cellCorners[2]],
        [cellCorners[2], cellCorners[3]],
        [cellCorners[3], cellCorners[0]],
    ];
    for (const [boundsEdgePoint1, boundsEdgePoint2] of boundsEdges) {
        for (const cellEdge of cellEdges) {
            if (
                segmentVsSegment(
                    boundsEdgePoint1.lat(),
                    boundsEdgePoint1.lng(),
                    boundsEdgePoint2.lat(),
                    boundsEdgePoint2.lng(),
                    cellEdge[0].lat,
                    cellEdge[0].lng,
                    cellEdge[1].lat,
                    cellEdge[1].lng
                )
            ) {
                return true;
            }
        }
    }

    // 交差していない
    return false;
}

/**
 * @param {google.maps.LatLng} point
 * @param {readonly GLatLngLiteral[]} polygon
 */
function pointVsPolygon(point, polygon) {
    let inside = false;
    const x = point.lng();
    const y = point.lat();

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng,
            yi = polygon[i].lat;
        const xj = polygon[j].lng,
            yj = polygon[j].lat;

        const intersect =
            yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * @param {number} p1x
 * @param {number} p1y
 * @param {number} p2x
 * @param {number} p2y
 * @param {number} p3x
 * @param {number} p3y
 * @param {number} p4x
 * @param {number} p4y
 */
function segmentVsSegment(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
    /**
     * @param {number} ax
     * @param {number} ay
     * @param {number} bx
     * @param {number} by
     * @param {number} cx
     * @param {number} cy
     * @returns
     */
    const ccw = (ax, ay, bx, by, cx, cy) => {
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    };

    const d1 = ccw(p3x, p3y, p4x, p4y, p1x, p1y);
    const d2 = ccw(p3x, p3y, p4x, p4y, p2x, p2y);
    const d3 = ccw(p1x, p1y, p2x, p2y, p3x, p3y);
    const d4 = ccw(p1x, p1y, p2x, p2y, p4x, p4y);

    return (
        ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    );
}

/**
 * @param {google.maps.LatLng | S2LatLng} data
 */
function getLatLngPoint(data) {
    return {
        lat: typeof data.lat == "function" ? data.lat() : data.lat,
        lng: typeof data.lng == "function" ? data.lng() : data.lng,
    };
}
/**
 * @param {google.maps.LatLng | S2LatLng} center
 * @param {google.maps.LatLngBounds} bounds
 * @param {number} level
 */
function collectCoveringS2Cells(center, bounds, level) {
    /** @type {S2Cell[]} */
    const result = [];

    const remainingCells = [
        S2.S2Cell.FromLatLng(getLatLngPoint(center), level),
    ];
    const seenCellIds = new Set();
    for (let cell; (cell = remainingCells.pop()); ) {
        const cellId = cell.toString();
        if (seenCellIds.has(cellId)) continue;
        seenCellIds.add(cellId);

        if (!cellVsBounds(cell, bounds)) continue;
        result.push(cell);
        remainingCells.push(...cell.getNeighbors());
    }
    return result;
}

class S2Overlay {
    /** @type {google.maps.Polyline[]} */
    polyLines = [];

    /**
     * @param {google.maps.Map} map
     */
    static check_map_bounds_ready(map) {
        if (
            !map ||
            map.getBounds === undefined ||
            map.getBounds() === undefined
        ) {
            return false;
        } else {
            return true;
        }
    }

    /**
     * @param {(map: google.maps.Map) => boolean} conditionFunction
     * @param {google.maps.Map} map
     * @returns {Promise<void>}
     */
    until(conditionFunction, map) {
        const poll = (/** @type {() => void} */ resolve) => {
            if (conditionFunction(map)) resolve();
            else setTimeout((_) => poll(resolve), 400);
        };
        return new Promise(poll);
    }

    clearGrid() {
        this.polyLines.forEach((line) => {
            line.setMap(null);
        });
        this.polyLines = []; // クリア
    }

    /**
     * @param {google.maps.Map} map
     * @param {number} gridLevel
     * @param {google.maps.PolylineOptions | null} options
     */
    async drawCellGrid(map, gridLevel, options) {
        await this.until(S2Overlay.check_map_bounds_ready, map);

        // ズームレベルに応じた描画制御
        if (gridLevel < 2 || gridLevel >= (map.getZoom() ?? 0) + 2) return;

        const center = map.getCenter() ?? raise`map center undefined`;
        const bounds = map.getBounds() ?? raise`map bounds undefined`;
        const cellsToDraw = collectCoveringS2Cells(center, bounds, gridLevel);
        for (const cell of cellsToDraw) {
            this.drawCell(map, cell, options);
        }
    }

    /**
     * @param {google.maps.Map} map
     * @param {S2Cell} cell
     * @param {google.maps.PolylineOptions | null} options
     */
    drawCell(map, cell, options) {
        const cellCorners = cell.getCornerLatLngs();
        cellCorners[4] = cellCorners[0]; //Loop it

        const polyline = new google.maps.Polyline({
            ...options,
            path: cellCorners,
            geodesic: true,
            map: map,
            clickable: false, // クリック判定を無効化して操作性を維持
        });
        this.polyLines.push(polyline);
    }
}

/**
 * @typedef {{ lat: number, lng: number }} S2LatLng
 * @typedef {[x: number, y: number, z: number]} S2Xyz
 * @typedef {[u: number, v: number]} S2Uv
 * @typedef {[s: number, t: number]} S2St
 * @typedef {[i: number, j: number]} S2Ij
 */
/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * @typedef {object} S2Namespace
 * @property {{ LatLng: LatLngNamespace }} L
 * @property {S2CellStatic} S2Cell
 * @property {number} FACE_BITS
 * @property {number} MAX_LEVEL
 * @property {number} POS_BITS
 * @property {(latLng: Readonly<S2LatLng>) => S2Xyz} LatLngToXYZ
 * @property {(xyz: Readonly<S2Xyz>) => S2LatLng} XYZToLatLng
 * @property {(xyz: Readonly<S2Xyz>) => [number, S2Uv]} XYZToFaceUV
 * @property {(face: number, uv: Readonly<S2Uv>) => S2Xyz} FaceUVToXYZ
 * @property {(st: Readonly<S2St>) => S2Uv} STToUV
 * @property {(uv: Readonly<S2Uv>) => S2St} UVToST
 * @property {(st: Readonly<S2St>, order: number) => S2Ij} STToIJ
 * @property {(ij: Readonly<S2Ij>, order: number, offsets: Readonly<S2Ij>) => S2St} IJToST
 * @property {(lat: number, lng: number, level: number) => string[]} latLngToNeighborKeys
 * @property {(key: string) => S2LatLng} keyToLatLng
 * @property {(lat: number, lng: number, level: number) => string} latLngToKey
 * @property {(lat: number, lng: number, level: number) => string} latLngToQuadkey
 */
/**
 * @typedef {{
 *      (rawLat: number | string, rawLng: number | string, noWrap?: boolean): S2LatLng,
 *      DEG_TO_RAD: number,
 *     RAD_TO_DEG: number
 * }} LatLngNamespace
 */

/**
 * @typedef {{
 *      new(): S2Cell,
 *      prototype: S2Cell,
 *      FromLatLng(latLng: Readonly<S2LatLng>, level: number): S2Cell,
 *      FromHilbertQuadKey(hilbertQuadkey: string): S2Cell
 *      FromFaceIJ(face: number, ij: Readonly<S2Ij>, level?: number): S2Cell,
 *      latLngToNeighborKeys(lat: number, lng: number, level: number): string[]
 *      keyToLatLng(key: string): S2LatLng
 *      latLngToKey(lat: number, lng: number, level: number): string
 * }} S2CellStatic
 */
/**
 * @typedef {object} S2Cell
 * @property {number} face
 * @property {S2Ij} ij
 * @property {number} level
 * @property {() => readonly S2Cell[]} getNeighbors
 * @property {() => S2LatLng[]} getCornerLatLngs
 * @property {() => S2LatLng} getLatLng
 * @property {() => [face: number, quads: number[]]} getFaceAndQuads
 * @property {() => string} toHilbertQuadkey
 */
(function (exports) {
    "use strict";

    var S2 = /** @type {S2Namespace} */ (
        exports.S2 = {
            L: {},
        }
    );

    S2.L.LatLng = /** @type {LatLngNamespace} */ (
        function (rawLat, rawLng, noWrap) {
            var lat = typeof rawLat === "string" ? parseFloat(rawLat) : rawLat;
            var lng = typeof rawLng === "string" ? parseFloat(rawLng) : rawLng;

            if (isNaN(lat) || isNaN(lng)) {
                throw new Error(
                    "Invalid LatLng object: (" + rawLat + ", " + rawLng + ")"
                );
            }

            if (noWrap !== true) {
                lat = Math.max(Math.min(lat, 90), -90); // clamp latitude into -90..90
                lng =
                    ((lng + 180) % 360) +
                    (lng < -180 || lng === 180 ? 180 : -180); // wrap longtitude into -180..180
            }

            return {
                lat: lat,
                lng: lng,
            };
        }
    );

    S2.L.LatLng.DEG_TO_RAD = Math.PI / 180;
    S2.L.LatLng.RAD_TO_DEG = 180 / Math.PI;

    S2.LatLngToXYZ = function (latLng) {
        var d2r = S2.L.LatLng.DEG_TO_RAD;

        var phi = latLng.lat * d2r;
        var theta = latLng.lng * d2r;

        var cosphi = Math.cos(phi);

        return [
            Math.cos(theta) * cosphi,
            Math.sin(theta) * cosphi,
            Math.sin(phi),
        ];
    };

    S2.XYZToLatLng = function (xyz) {
        var r2d = S2.L.LatLng.RAD_TO_DEG;

        var lat = Math.atan2(
            xyz[2],
            Math.sqrt(xyz[0] * xyz[0] + xyz[1] * xyz[1])
        );
        var lng = Math.atan2(xyz[1], xyz[0]);

        return S2.L.LatLng(lat * r2d, lng * r2d);
    };

    var largestAbsComponent = function (/** @type {Readonly<S2Xyz>} */ xyz) {
        var temp = [Math.abs(xyz[0]), Math.abs(xyz[1]), Math.abs(xyz[2])];

        if (temp[0] > temp[1]) {
            if (temp[0] > temp[2]) {
                return 0;
            } else {
                return 2;
            }
        } else {
            if (temp[1] > temp[2]) {
                return 1;
            } else {
                return 2;
            }
        }
    };

    /** @returns {S2Uv} */
    var faceXYZToUV = function (
        /** @type {number} */ face,
        /** @type {Readonly<S2Xyz>} */ xyz
    ) {
        var u, v;

        switch (face) {
            case 0:
                u = xyz[1] / xyz[0];
                v = xyz[2] / xyz[0];
                break;
            case 1:
                u = -xyz[0] / xyz[1];
                v = xyz[2] / xyz[1];
                break;
            case 2:
                u = -xyz[0] / xyz[2];
                v = -xyz[1] / xyz[2];
                break;
            case 3:
                u = xyz[2] / xyz[0];
                v = xyz[1] / xyz[0];
                break;
            case 4:
                u = xyz[2] / xyz[1];
                v = -xyz[0] / xyz[1];
                break;
            case 5:
                u = -xyz[1] / xyz[2];
                v = -xyz[0] / xyz[2];
                break;
            default:
                throw {
                    error: "Invalid face",
                };
        }

        return [u, v];
    };

    S2.XYZToFaceUV = function (xyz) {
        var face = largestAbsComponent(xyz);

        if (xyz[face] < 0) {
            face += 3;
        }

        var uv = faceXYZToUV(face, xyz);

        return [face, uv];
    };

    S2.FaceUVToXYZ = function (face, uv) {
        var u = uv[0];
        var v = uv[1];

        switch (face) {
            case 0:
                return [1, u, v];
            case 1:
                return [-u, 1, v];
            case 2:
                return [-u, -v, 1];
            case 3:
                return [-1, -v, -u];
            case 4:
                return [v, -1, -u];
            case 5:
                return [v, u, -1];
            default:
                throw {
                    error: "Invalid face",
                };
        }
    };

    var singleSTtoUV = function (/** @type {number} */ st) {
        if (st >= 0.5) {
            return (1 / 3.0) * (4 * st * st - 1);
        } else {
            return (1 / 3.0) * (1 - 4 * (1 - st) * (1 - st));
        }
    };

    S2.STToUV = function (st) {
        return [singleSTtoUV(st[0]), singleSTtoUV(st[1])];
    };

    var singleUVtoST = function (/** @type {number} */ uv) {
        if (uv >= 0) {
            return 0.5 * Math.sqrt(1 + 3 * uv);
        } else {
            return 1 - 0.5 * Math.sqrt(1 - 3 * uv);
        }
    };
    S2.UVToST = function (uv) {
        return [singleUVtoST(uv[0]), singleUVtoST(uv[1])];
    };

    S2.STToIJ = function (st, order) {
        var maxSize = 1 << order;

        var singleSTtoIJ = function (/** @type {number} */ st) {
            var ij = Math.floor(st * maxSize);
            return Math.max(0, Math.min(maxSize - 1, ij));
        };

        return [singleSTtoIJ(st[0]), singleSTtoIJ(st[1])];
    };

    S2.IJToST = function (ij, order, offsets) {
        var maxSize = 1 << order;

        return [(ij[0] + offsets[0]) / maxSize, (ij[1] + offsets[1]) / maxSize];
    };

    var rotateAndFlipQuadrant = function (
        /** @type {number} */ n,
        /** @type {Point} */ point,
        /** @type {number} */ rx,
        /** @type {number} */ ry
    ) {
        var newX, newY;
        if (ry == 0) {
            if (rx == 1) {
                point.x = n - 1 - point.x;
                point.y = n - 1 - point.y;
            }

            var x = point.x;
            point.x = point.y;
            point.y = x;
        }
    };

    // hilbert space-filling curve
    // based on http://blog.notdot.net/2009/11/Damn-Cool-Algorithms-Spatial-indexing-with-Quadtrees-and-Hilbert-Curves
    // note: rather than calculating the final integer hilbert position, we just return the list of quads
    // this ensures no precision issues with large orders (S3 cell IDs use up to 30), and is more
    // convenient for pulling out the individual bits as needed later
    var pointToHilbertQuadList = function (
        /** @type {number} */ x,
        /** @type {number} */ y,
        /** @type {number} */ order,
        /** @type {number} */ face
    ) {
        var hilbertMap = /** @type {const} */ ({
            a: [
                [0, "d"],
                [1, "a"],
                [3, "b"],
                [2, "a"],
            ],
            b: [
                [2, "b"],
                [1, "b"],
                [3, "a"],
                [0, "c"],
            ],
            c: [
                [2, "c"],
                [3, "d"],
                [1, "c"],
                [0, "b"],
            ],
            d: [
                [0, "a"],
                [3, "c"],
                [1, "d"],
                [2, "d"],
            ],
        });
        /** @typedef {keyof typeof hilbertMap} HilbertSquare */

        if ("number" !== typeof face) {
            console.warn(
                new Error(
                    "called pointToHilbertQuadList without face value, defaulting to '0'"
                ).stack
            );
        }
        /** @type {HilbertSquare} */
        var currentSquare = face % 2 ? "d" : "a";
        var positions = [];

        for (var i = order - 1; i >= 0; i--) {
            var mask = 1 << i;

            var quad_x = x & mask ? 1 : 0;
            var quad_y = y & mask ? 1 : 0;

            /** @type {readonly [number, HilbertSquare]} */
            var t = hilbertMap[currentSquare][quad_x * 2 + quad_y];

            positions.push(t[0]);

            currentSquare = t[1];
        }

        return positions;
    };

    // S2Cell class

    S2.S2Cell = /** @type {S2CellStatic} */ (
        /** @type {any} */ (function () {})
    );

    S2.S2Cell.FromHilbertQuadKey = function (hilbertQuadkey) {
        var parts = hilbertQuadkey.split("/");
        var face = parseInt(parts[0]);
        var position = parts[1];
        var maxLevel = position.length;
        var point = {
            x: 0,
            y: 0,
        };
        var i;
        var level;
        var bit;
        var rx, ry;
        var val;

        for (i = maxLevel - 1; i >= 0; i--) {
            level = maxLevel - i;
            bit = position[i];
            rx = 0;
            ry = 0;
            if (bit === "1") {
                ry = 1;
            } else if (bit === "2") {
                rx = 1;
                ry = 1;
            } else if (bit === "3") {
                rx = 1;
            }

            val = Math.pow(2, level - 1);
            rotateAndFlipQuadrant(val, point, rx, ry);

            point.x += val * rx;
            point.y += val * ry;
        }

        if (face % 2 === 1) {
            var t = point.x;
            point.x = point.y;
            point.y = t;
        }

        return S2.S2Cell.FromFaceIJ(face, [point.x, point.y], level);
    };

    //static method to construct
    S2.S2Cell.FromLatLng = function (
        /** @type {Readonly<S2LatLng>} */ latLng,
        /** @type {number} */ level
    ) {
        if (
            (!latLng.lat && latLng.lat !== 0) ||
            (!latLng.lng && latLng.lng !== 0)
        ) {
            throw new Error(
                "Pass { lat: lat, lng: lng } to S2.S2Cell.FromLatLng"
            );
        }
        var xyz = S2.LatLngToXYZ(latLng);

        var faceuv = S2.XYZToFaceUV(xyz);
        var st = S2.UVToST(faceuv[1]);

        var ij = S2.STToIJ(st, level);

        return S2.S2Cell.FromFaceIJ(faceuv[0], ij, level);
    };

    S2.S2Cell.FromFaceIJ = function (
        /** @type {number} */ face,
        /** @type {S2Ij} */ ij,
        /** @type {number} */ level
    ) {
        var cell = new S2.S2Cell();
        cell.face = face;
        cell.ij = ij;
        cell.level = level;

        return cell;
    };

    S2.S2Cell.prototype.toString = function () {
        return (
            "F" +
            this.face +
            "ij[" +
            this.ij[0] +
            "," +
            this.ij[1] +
            "]@" +
            this.level
        );
    };

    S2.S2Cell.prototype.getLatLng = function () {
        var st = S2.IJToST(this.ij, this.level, [0.5, 0.5]);
        var uv = S2.STToUV(st);
        var xyz = S2.FaceUVToXYZ(this.face, uv);

        return S2.XYZToLatLng(xyz);
    };

    S2.S2Cell.prototype.getCornerLatLngs = function () {
        var result = [];

        /** @type {S2Ij[]} */
        var offsets = [
            [0.0, 0.0],
            [0.0, 1.0],
            [1.0, 1.0],
            [1.0, 0.0],
        ];

        for (var i = 0; i < 4; i++) {
            var st = S2.IJToST(this.ij, this.level, offsets[i]);
            var uv = S2.STToUV(st);
            var xyz = S2.FaceUVToXYZ(this.face, uv);

            result.push(S2.XYZToLatLng(xyz));
        }
        return result;
    };

    /** @returns {[face: number, quads: number[]]} */
    S2.S2Cell.prototype.getFaceAndQuads = function () {
        var quads = pointToHilbertQuadList(
            this.ij[0],
            this.ij[1],
            this.level,
            this.face
        );

        return [this.face, quads];
    };
    S2.S2Cell.prototype.toHilbertQuadkey = function () {
        var quads = pointToHilbertQuadList(
            this.ij[0],
            this.ij[1],
            this.level,
            this.face
        );

        return this.face.toString(10) + "/" + quads.join("");
    };

    S2.latLngToNeighborKeys = S2.S2Cell.latLngToNeighborKeys = function (
        lat,
        lng,
        level
    ) {
        return S2.S2Cell.FromLatLng(
            {
                lat: lat,
                lng: lng,
            },
            level
        )
            .getNeighbors()
            .map(function (/** @type {any} */ cell) {
                return cell.toHilbertQuadkey();
            });
    };
    S2.S2Cell.prototype.getNeighbors = function () {
        var fromFaceIJWrap = function (
            /** @type {number} */ face,
            /** @type {Readonly<S2Ij>} */ ij,
            /** @type {number} */ level
        ) {
            var maxSize = 1 << level;
            if (
                ij[0] >= 0 &&
                ij[1] >= 0 &&
                ij[0] < maxSize &&
                ij[1] < maxSize
            ) {
                // no wrapping out of bounds
                return S2.S2Cell.FromFaceIJ(face, ij, level);
            } else {
                // the new i,j are out of range.
                // with the assumption that they're only a little past the borders we can just take the points as
                // just beyond the cube face, project to XYZ, then re-create FaceUV from the XYZ vector

                var st = S2.IJToST(ij, level, [0.5, 0.5]);
                var uv = S2.STToUV(st);
                var xyz = S2.FaceUVToXYZ(face, uv);
                var faceuv = S2.XYZToFaceUV(xyz);
                face = faceuv[0];
                uv = faceuv[1];
                st = S2.UVToST(uv);
                ij = S2.STToIJ(st, level);
                return S2.S2Cell.FromFaceIJ(face, ij, level);
            }
        };

        var face = this.face;
        var i = this.ij[0];
        var j = this.ij[1];
        var level = this.level;

        return [
            fromFaceIJWrap(face, [i - 1, j], level),
            fromFaceIJWrap(face, [i, j - 1], level),
            fromFaceIJWrap(face, [i + 1, j], level),
            fromFaceIJWrap(face, [i, j + 1], level),
        ];
    };

    //
    // Functional Style
    //
    S2.FACE_BITS = 3;
    S2.MAX_LEVEL = 30;
    S2.POS_BITS = 2 * S2.MAX_LEVEL + 1; // 61 (60 bits of data, 1 bit lsb marker)

    S2.keyToLatLng = S2.S2Cell.keyToLatLng = function (key) {
        var cell2 = S2.S2Cell.FromHilbertQuadKey(key);
        return cell2.getLatLng();
    };

    S2.S2Cell.latLngToKey =
        S2.latLngToKey =
        S2.latLngToQuadkey =
            function (lat, lng, level) {
                if (isNaN(level) || level < 1 || level > 30) {
                    throw new Error(
                        "'level' is not a number between 1 and 30 (but it should be)"
                    );
                }
                return S2.S2Cell.FromLatLng(
                    {
                        lat: lat,
                        lng: lng,
                    },
                    level
                ).toHilbertQuadkey();
            };
})("undefined" !== typeof module ? module.exports : window);

/** @type {S2Namespace} */
const S2 = /** @type {any} */ (window).S2;

/**
 * @param {(arg0: Readonly<{ lat: number; lng: number; radius: number; }>, arg1: string) => void} handleResults
 */
function inject(handleResults) {
    const originalOpen = XMLHttpRequest.prototype.open;

    /** @type {(this: XMLHttpRequest, method: string, url: string | URL, ...args: any[]) => void} */
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        if (
            method == "GET" &&
            url.toString().includes("/api/v1/vault/live-pois-in-radius")
        ) {
            this.addEventListener(
                "load",
                function () {
                    if (this.status >= 200 && this.status < 300) {
                        const urlObj = new URL(url, window.location.origin);
                        const params = {
                            lat: Number(urlObj.searchParams.get("lat")),
                            lng: Number(urlObj.searchParams.get("lng")),
                            radius: Number(urlObj.searchParams.get("radius")),
                        };
                        handleResults(params, this.response);
                    }
                },
                false
            );
        }
        originalOpen.apply(
            this,
            /** @type {Parameters<typeof XMLHttpRequest.prototype.open>} */ ([
                method,
                url,
                ...args,
            ])
        );
    };
}

async function setupS2GridOverlay() {
    const gMap = await getGMapObject();

    /**
     * @param {number} level
     * @param {string} [color]
     * @param {number} [zIndex]
     * @returns {GridOptions}
     */
    function grid(level, color, zIndex) {
        let strokeWeight;
        if (color != null) {
            strokeWeight = 2;
        } else {
            strokeWeight = 1;
            switch (level % 4) {
                case 0:
                    color = "#808080";
                    break;
                case 2:
                    color = "#E0E0E0";
                    break;
                default:
                    color = "#C0C0C0";
            }
        }
        return {
            level,
            options: {
                strokeColor: color,
                strokeOpacity: 1,
                strokeWeight,
                zIndex: zIndex ?? (S2.MAX_LEVEL - level + 1) * 10,
            },
        };
    }

    addS2GridOverlay(
        gMap,
        grid(4),
        grid(5),
        grid(6, "#30FFFF", 402), // ショーケース
        grid(7),
        grid(8),
        grid(9),
        grid(10),
        grid(11),
        grid(12),
        // grid(13),
        grid(14, "#3030FF", 401), // ジム昇格判定
        // grid(15),
        // grid(16),
        grid(17, "#FF3030", 400) // ポケストップ
    );
}

/**
 * @typedef {object} ResponseResult
 * @property {Poi[]} pois
 * @property {S2LatLng} location
 * @property {number} radius
 * @property {number} count
 */
/**
 * @typedef {object} Poi
 * @property {string} guid
 * @property {string} title
 * @property {string} description
 * @property {string} imageUrl
 * @property {number} lat
 * @property {number} lng
 */
/**
 * @typedef {object} Response
 * @property {ResponseResult} result
 * @property {null | unknown} message
 * @property {"OK" | unknown} code
 * @property {null | unknown} errorsWithIcon
 * @property {null | unknown} fieldErrors
 * @property {null | unknown} errorDetails
 * @property {string} version
 * @property {boolean} captcha
 */

const livePois = [];

/** @type {google.maps.Circle | null} */
let oldCircle = null;

/**
 * @param {Readonly<{ lat: number; lng: number; radius: number; }>} params
 * @param {string} responseText
 */
async function onPoisResponseReceived(params, responseText) {
    const map = await getGMapObject();
    let response;
    try {
        response = /** @type {Response} */ (JSON.parse(responseText));
    } catch {
        return;
    }
    if (response.code !== "OK" || response.captcha) return;

    livePois.length = 0;
    livePois.push(...response.result.pois);

    if (oldCircle) {
        oldCircle.setMap(null);
        oldCircle = null;
    }
    oldCircle = new google.maps.Circle({
        strokeColor: "#b429dfff",
        strokeOpacity: 0.7,
        strokeWeight: 1,
        fillColor: "#ffffffff",
        fillOpacity: 0.2,
        map: map,
        center: { lat: params.lat, lng: params.lng },
        radius: params.radius,
    });
}

// マップを検出してS2オーバーレイを適用するメイン処理
async function onPageUpdated() {
    // Google Maps APIがロードされるのを待機してから描画
    if (typeof google === "undefined" || typeof google.maps === "undefined") {
        setTimeout(onPageUpdated, 500);
        return;
    }

    await Promise.all([setupS2GridOverlay()]);
}

function observeUrlUpdates() {
    // スクリプト開始
    // URL変更を検知して再実行する簡易的な仕組み
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            onPageUpdated();
        }
    }).observe(document, { subtree: true, childList: true });

    onPageUpdated();
}

function injectEventHandler() {
    inject(async (params, responseText) => {
        try {
            await onPoisResponseReceived(params, responseText);
        } catch (e) {
            console.error(e);
        }
    });
}

injectEventHandler();
observeUrlUpdates();
