// ==UserScript==
// @name         New Userscript
// @namespace    http://tampermonkey.net/
// @version      2024-09-06
// @description  try to take over the world!
// @author       You
// @match        https://intel.ingress.com/intel
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ingress.com
// @grant        GM_info
// ==/UserScript==
// spell-checker: ignore protomaps pmtiles maxzoom
//@ts-check

() => {
    const R = 6378137;
    const MAX_LATITUDE = 85.0511287798;
    const MAX_COORD = R * Math.PI;

    /**
     * @param {{lat: number, lng: number}} param0
     */
    function project({ lat, lng }) {
        const d = Math.PI / 180;
        const constrainedLat = Math.max(
            Math.min(MAX_LATITUDE, lat),
            -MAX_LATITUDE
        );
        const sin = Math.sin(constrainedLat * d);
        return {
            x: R * lng * d,
            y: (R * Math.log((1 + sin) / (1 - sin))) / 2,
        };
    }
    /**
     * @param {number} a
     * @param {{ x: number; y: number; }} xy
     */
    function multiplyBy(a, xy) {
        return { x: a * xy.x, y: a * xy.y };
    }
    /**
     * @param {number} lat
     * @param {number} lng
     * @param {number} zoom
     */
    function latLngZoomToZxy(lat, lng, zoom) {
        const projected = project({ lat, lng });
        const normalized = {
            x: (projected.x + MAX_COORD) / (MAX_COORD * 2),
            y: 1 - (projected.y + MAX_COORD) / (MAX_COORD * 2),
        };
        if (normalized.x > 1) {
            normalized.x = normalized.x - Math.floor(normalized.x);
        }
        const onZoom = multiplyBy(1 << zoom, normalized);
        const tileX = Math.floor(onZoom.x);
        const tileY = Math.floor(onZoom.y);
        return { z: zoom, x: tileX, y: tileY };
    }
};

(() => {
    /** @type {StringType} */
    const string = Object.freeze({ kind: "string" });
    /** @type {NumberType} */
    const number = Object.freeze({ kind: "number" });
    /**
     * @typedef {{ readonly kind: "string" }} StringType
     * @typedef {{ readonly kind: "number" }} NumberType
     * @typedef {{ readonly [k in string]: TypeKind }} InterfaceFieldsKind
     * @typedef {{ readonly kind: "interface", readonly fields: InterfaceFieldsKind }} InterfaceTypeKind
     * @typedef {{ readonly kind: "array", readonly element: TypeKind }} ArrayTypeKind
     * @typedef {StringType | NumberType | InterfaceTypeKind | ArrayTypeKind} TypeKind
     */
    /**
     * @template {TypeKind} T
     * @typedef {{ readonly kind: "array", readonly element: T }} ArrayType
     */
    /**
     * @template {InterfaceFieldsKind} TFields
     * @typedef {{ readonly kind: "interface", readonly fields: TFields }} InterfaceType
     */
    /**
     * @template {TypeKind} T
     * @typedef
     * {    T extends StringType ? string :
     *      T extends NumberType ? number :
     *      T extends ArrayType<infer E> ? Infer<E>[] :
     *      T extends InterfaceType<infer TFields> ? InferFields<TFields> :
     *      "unknown type"
     * } Infer
     */
    /**
     * @template {InterfaceFieldsKind} TFields
     * @typedef {{ -readonly [p in keyof TFields]: Infer<TFields[p]> }} InferFields
     */
    /**
     * @template {InterfaceFieldsKind} TFields
     * @param {TFields} fields
     * @returns {InterfaceType<TFields>}
     */
    function interface(fields) {
        return { kind: "interface", fields };
    }
    /**
     * @template {TypeKind} T
     * @param {T} element
     * @returns {ArrayType<T>}
     */
    function array(element) {
        return { kind: "array", element };
    }

    /**
     * @param {TypeKind} expectedType
     * @param {MutablePath} path
     */
    function createValidationError(expectedType, path) {
        const error = new Error(
            `expected type: ${JSON.stringify(expectedType)}, path: root${path
                .map((p) => "." + p)
                .join()}`
        );
        error.name = "ValidationError";
        return error;
    }
    /** @typedef {(string | number)[]} MutablePath */

    /** @type {MutablePath[] | null} */
    let pathCache = null;
    /**
     * @template {TypeKind} TType
     * @param {unknown} value
     * @param {TType} type
     * @returns {Infer<TType>}
     */
    function parseAs(type, value) {
        const currentPath = (pathCache ??= []).pop() ?? [];
        try {
            validateType(value, type, currentPath);
            return /** @type {Infer<TType>} */ (value);
        } finally {
            currentPath.length = 0;
            pathCache.push(currentPath);
        }
    }
    /**
     * @param {unknown} value
     * @param {TypeKind} type
     * @param {MutablePath} currentPath
     */
    function validateType(value, type, currentPath) {
        switch (type.kind) {
            case "number":
                if (typeof value !== "number") {
                    throw createValidationError(type, currentPath);
                }
                return;
            case "string":
                if (typeof value !== "string") {
                    throw createValidationError(type, currentPath);
                }
                return;
            case "array":
                return validateArray(value, type, currentPath);
            case "interface":
                return validateInterface(value, type, currentPath);
            default:
                throw new Error(
                    `invalid type ${/** @satisfies {never} */ (type)}`
                );
        }
    }
    /**
     * @param {unknown} value
     * @param {ArrayTypeKind} type
     * @param {MutablePath} currentPath
     */
    function validateArray(value, type, currentPath) {
        if (!Array.isArray(value))
            throw createValidationError(type, currentPath);

        const { element } = type;
        for (let i = 0; i < value.length; i++) {
            currentPath.push(i);
            try {
                validateType(value[i], element, currentPath);
            } finally {
                currentPath.pop();
            }
        }
    }
    const hasOwnProperty = Object.prototype.hasOwnProperty;
    /**
     * @param {unknown} value
     * @param {InterfaceTypeKind} type
     * @param {MutablePath} currentPath
     */
    function validateInterface(value, type, currentPath) {
        if (value === null || typeof value !== "object") {
            throw createValidationError(type, currentPath);
        }

        const { fields } = type;
        for (const key in fields) {
            if (!hasOwnProperty.call(fields, key)) continue;
            const fieldType = fields[key];

            currentPath.push(key);
            try {
                const field = key in value ? value[key] : undefined;
                validateType(field, fieldType, currentPath);
            } finally {
                currentPath.pop();
            }
        }
    }

    const MetadataType = interface({
        vector_layers: array(interface({ maxzoom: number })),
    });
    const FeaturePropsType = interface({
        "@name": string,
        /** 0..1 */
        confidence: number,
        id: string,
    });
    /**
     * @param {Promise<void>} promise
     */
    async function cancelToReject(promise) {
        try {
            return await promise;
        } catch (e) {
            if (e instanceof Error && e.name === "AbortError") return;
            throw e;
        }
    }
    /**
     * @param {(promise: Promise<void>) => void} handleAsyncError
     */
    function createAsyncCancelScope(handleAsyncError) {
        let lastCancel = new AbortController();
        /**
         * @param {(signal: AbortSignal) => Promise<void>} process
         */
        return (process) => {
            // 前の操作をキャンセル
            lastCancel.abort();
            lastCancel = new AbortController();
            // キャンセル例外を無視する
            cancelToReject(process(lastCancel.signal)).catch(handleAsyncError);
        };
    }

    /**
     * @param {Promise<unknown>} e
     */
    function handleAsyncError(e) {
        console.error(e);
    }
    /**
     * @param {L.Point} latLng
     */
    const project = (latLng) => {
        const d = Math.PI / 180;
        const constrainedLat = Math.max(
            Math.min(MAX_LATITUDE, latLng.y),
            -MAX_LATITUDE
        );
        const sin = Math.sin(constrainedLat * d);
        return L.point(
            R * latLng.x * d,
            (R * Math.log((1 + sin) / (1 - sin))) / 2
        );
    };
    const isIITCMobile =
        //@ts-expect-error
        (typeof android !== "undefined" && android && android.addPane) ||
        navigator.userAgent.toLowerCase().includes("android");

    const R = 6378137;
    const MAX_LATITUDE = 85.0511287798;
    const MAX_COORD = R * Math.PI;

    /**
     * @param {number} y
     * @param {number} z
     */
    function yzToLat(y, z) {
        const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
        return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }
    /**
     * @param {number} x
     * @param {number} z
     */
    function xzToLng(x, z) {
        return (x / Math.pow(2, z)) * 360 - 180;
    }
    /**
     * @param {number} z
     * @param {number} x
     * @param {number} y
     */
    function zxyToLatLng(z, x, y) {
        return { lat: yzToLat(y, z), lng: xzToLng(x, z) };
    }
    /**
     * @callback AddLayerGroup
     * @param {string} name
     * @param {L.LayerGroup<L.ILayer>} layerGroup
     * @param {boolean} [defaultDisplay]
     * @returns {unknown}
     */
    /**
     * @typedef IITCGlobalExtensions
     * @property {L.Map} map
     * @property {AddLayerGroup} addLayerGroup
     * @property {L.Control.Layers} layerChooser
     */

    const RELEASE = "2024-08-20";
    const THEME = "places";
    // "https://d3c1b7bog2u1nn.cloudfront.net/2024-08-20/places.pmtiles";
    const pmTilesUrl = `https://overturemaps-tiles-us-west-2-beta.s3.amazonaws.com/${RELEASE}/${THEME}.pmtiles`;

    /**
     * @param {CanvasRenderingContext2D} c
     * @param {string} lines
     * @param {number} x
     * @param {number} y
     */
    function drawLines(c, lines, x, y) {
        let currentY = y;
        for (const line of lines.split("\n")) {
            const metrics = c.measureText(line);
            const height =
                metrics.actualBoundingBoxAscent +
                metrics.actualBoundingBoxDescent;
            c.strokeText(line, x, currentY);
            c.fillText(line, x, currentY);
            currentY += height;
        }
    }
    /**
     * @param {L.LayerGroup} placesLayerGroup
     */
    async function initializeProtomaps(placesLayerGroup) {
        /** @type {import("protomaps-leaflet")} */
        const protomaps = await import(
            //@ts-expect-error 外部モジュール
            "https://cdn.jsdelivr.net/npm/protomaps-leaflet@4.0.0/+esm"
        );

        const levelDifference = 0; // 1
        const source = new protomaps.PmtilesSource(pmTilesUrl, true);
        const metadata = parseAs(MetadataType, await source.p.getMetadata());
        console.log(metadata);
        const maxDataZoom = metadata.vector_layers[0]?.maxzoom ?? 15;

        const tileWidth = 256;
        const cache = new protomaps.TileCache(
            source,
            tileWidth << levelDifference
        );
        const view = new protomaps.View(cache, maxDataZoom, levelDifference);

        /** @typedef {`${number}/${number}/${number}`} TileId */
        /** @type {Map<TileId, L.ILayer[]>} */
        const tileIdToPlaceLayers = new Map();

        /** @type {Map<TileId, import("protomaps-leaflet").Feature[]>} */
        const dataTileIdToFeatures = new Map();

        /**
         * @param {L.Map} map
         * @param {HTMLCanvasElement} canvas
         * @param {L.Point} tilePoint
         * @param {number} zoom
         * @param {AbortSignal} signal
         */
        async function drawTileAsync(map, canvas, tilePoint, zoom, signal) {
            const w = 2 ** zoom;
            if (
                tilePoint.x < 0 ||
                tilePoint.y < 0 ||
                tilePoint.x >= w ||
                tilePoint.y >= w
            ) {
                return;
            }
            const c = canvas.getContext("2d");
            if (!c) return;

            // 枠
            const { width: canvasWidth, height: canvasHeight } = canvas;
            c.strokeStyle = "#f0f";
            c.strokeRect(0, 0, canvasWidth, canvasHeight);

            const tile = await view.getDisplayTile({
                z: zoom,
                x: tilePoint.x,
                y: tilePoint.y,
            });

            const latLng = zxyToLatLng(zoom, tilePoint.x, tilePoint.y);

            const dataTilePointForPreparedZoom = L.point(
                tile.dataTile.x,
                tile.dataTile.y
            ).multiplyBy(2 ** (zoom - tile.dataTile.z));

            const dataTileToPreparedTileOffset = tilePoint
                .clone()
                .subtract(dataTilePointForPreparedZoom)
                .multiplyBy(tileWidth);

            c.font = "bold 14px Calibri";
            c.fillStyle = "#fff";
            c.strokeStyle = "#00000088";
            c.lineWidth = 2;
            drawLines(
                c,
                [
                    `dataTile: ${tile.dataTile.z}/${tile.dataTile.x}/${tile.dataTile.y}`,
                    // タイルのZXY
                    `zoom,tilePoint: ${zoom}/${tilePoint.x}/${tilePoint.y}`,
                    `offset: ${dataTileToPreparedTileOffset.x},${dataTileToPreparedTileOffset.y}`,
                    // タイルの緯度経度
                    `latLng: ${latLng.lat.toFixed(8)},${latLng.lng.toFixed(8)}`,
                    `features: ${[...tile.data.values()].reduce(
                        (count, fs) => count + fs.length,
                        0
                    )}`,
                    `origin: ${tile.origin.x}, ${tile.origin.y}`,
                ].join("\n"),
                0,
                20
            );

            const dataTileOrigin = tile.origin.clone();
            dataTileOrigin.x = tile.dataTile.x * tile.dim;
            dataTileOrigin.y = tile.dataTile.y * tile.dim;

            console.log(JSON.stringify(tilePoint), JSON.stringify(tile));
            const tileId = /** @type {const} */ (
                `${zoom}/${tilePoint.x}/${tilePoint.y}`
            );

            // 古いレイヤを削除
            let addedLayers = tileIdToPlaceLayers.get(tileId);
            if (!addedLayers) {
                addedLayers = [];
                tileIdToPlaceLayers.set(tileId, addedLayers);
            }
            for (const layer of addedLayers) {
                placesLayerGroup.removeLayer(layer);
            }

            // タイルに存在するPOIをレイヤとして追加
            for (const [featureName, features] of tile.data) {
                for (const feature of features) {
                    // TODO:
                    if (feature.geomType !== protomaps.GeomType.Point) continue;

                    const { x: fx, y: fy } = feature.geom[0][0];
                    const point = L.point(fx, fy)
                        .multiplyBy(tile.scale)
                        .subtract(dataTileToPreparedTileOffset);

                    const latLng = zxyToLatLng(
                        zoom,
                        point.x / tileWidth + tilePoint.x,
                        point.y / tileWidth + tilePoint.y
                    );
                    const circle = L.circleMarker(latLng);

                    const props = parseAs(FeaturePropsType, feature.props);

                    console.log(point.x, point.y, props["@name"], latLng);

                    // 円
                    c.fillStyle = "#ffffff77";
                    c.fillRect(point.x - 3, point.y - 3, 6, 6);
                    // c.beginPath();
                    // c.arc(point.x - 3, point.y - 3, 6, 0, 2 * Math.PI);
                    // c.fill();

                    // 名前
                    c.font = "9px Arial";
                    c.fillStyle = "#0ff";
                    c.fillText(String(props["@name"]), point.x, point.y);

                    placesLayerGroup.addLayer(circle);
                    addedLayers.push(circle);
                }
            }
        }
        return {
            drawTileAsync,
        };
    }
    /**
     * @param {L.Map} map
     * @param {L.ILayer} layer
     * @returns {Promise<void>}
     */
    function waitLayerAdded(map, layer) {
        if (map.hasLayer(layer)) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const onLayerAdd = (/** @type {L.LeafletLayerEvent} */ e) => {
                if (e.layer === layer) {
                    map.off("layeradd", onLayerAdd);
                    resolve();
                }
            };
            map.on("layeradd", onLayerAdd);
        });
    }
    /**
     * @param {() => Promise<void>} asyncMain
     * @param {string} id
     */
    function expose(asyncMain, id) {
        (isIITCMobile || typeof unsafeWindow === "undefined"
            ? globalThis
            : unsafeWindow)[id] = {
            main() {
                asyncMain().catch(handleAsyncError);
            },
        };
    }
    /**
     * @typedef {typeof globalThis & IITCGlobalExtensions} GlobalWithIITCExtensions
     */
    async function asyncMain() {
        const window = /** @type {GlobalWithIITCExtensions} */ (
            isIITCMobile || typeof unsafeWindow === "undefined"
                ? globalThis
                : unsafeWindow
        );

        const placesLayerGroup = L.layerGroup();
        const overtureTileLayer = L.tileLayer.canvas();
        window.addLayerGroup("overture maps | places", placesLayerGroup);
        window.layerChooser.addOverlay(overtureTileLayer, "overture maps");
        await waitLayerAdded(window.map, placesLayerGroup);

        const { drawTileAsync } = await initializeProtomaps(placesLayerGroup);
        const drawTileCancelScope = createAsyncCancelScope(handleAsyncError);
        overtureTileLayer.drawTile = function (canvas, tilePoint, zoom) {
            drawTileCancelScope((signal) =>
                drawTileAsync(window.map, canvas, tilePoint, zoom, signal)
            );
            return this;
        };
    }
    expose(
        asyncMain,
        "_iitc-plugin-overture-map-3798db47-5fe8-4307-a1e0-8092c04133b1"
    );
})();

(() => {
    // 文字列化され、ドキュメントに注入されるラッパー関数
    // このため、通常のクロージャーのルールはここでは適用されない
    function wrapper(plugin_info) {
        /** @type {any} */
        const window = globalThis.window;

        // window.plugin が存在することを確認する
        if (typeof window.plugin !== "function") {
            window.plugin = function () {
                // マーカー関数
            };
        }

        // メタデータを追加する
        plugin_info.dateTimeVersion = "20221226000000"; // TODO:
        plugin_info.pluginId = "plugin-id"; // TODO:

        // setup 内で IITC はロード済みと仮定できる
        const setup = function setup() {
            const pluginModule =
                window[
                    "_iitc-plugin-overture-map-3798db47-5fe8-4307-a1e0-8092c04133b1"
                ];
            delete window[
                "_iitc-plugin-overture-map-3798db47-5fe8-4307-a1e0-8092c04133b1"
            ];
            if (pluginModule == null) {
                console.error(
                    `${plugin_info.pluginId}: メインモジュールが読み込まれていません。`
                );
                return;
            }
            pluginModule.main();
        };
        setup.info = plugin_info;

        // 起動用フックを追加
        (window.bootPlugins ??= []).push(setup);

        // IITC がすでに起動している場合 `setup` 関数を実行する
        if (window.iitcLoaded && typeof setup === "function") setup();
    }

    // UserScript のヘッダからプラグイン情報を取得する
    const info = {};
    if (typeof GM_info !== "undefined" && GM_info && GM_info.script) {
        info.script = {
            version: GM_info.script.version,
            name: GM_info.script.name,
            description: GM_info.script.description,
        };
    }

    // wrapper 関数を文字列化して DOM 内で実行する
    const script = document.createElement("script");
    script.append(`(${wrapper})(${JSON.stringify(info)})`);
    (document.body || document.head || document.documentElement).appendChild(
        script
    );
})();
