// ==UserScript==
// @id             iitc-plugin-portal-names-ex
// @name           IITC plugin: Portal Names Ex
// @category       Layer
// @version        0.1.3
// @namespace      https://github.com/wiinuk/wayfarer-user-scripts
// @updateURL      https://github.com/wiinuk/wayfarer-user-scripts/raw/main/source/iitc-plugin-portal-names-ex.user.js
// @downloadURL    https://github.com/wiinuk/wayfarer-user-scripts/raw/main/source/iitc-plugin-portal-names-ex.user.js
// @description    Show portal names on the map.
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/mission/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant          none
// ==/UserScript==
//@ts-check
//spell-checker: ignore moveend overlayadd overlayremove zoomend

/**
 * @typedef {L.CircleMarker & {
 *   _map?: unknown;
 *   options: IITCPortalOptions;
 *   getLatLng(): L.LatLng;
 *   }
 * } IITCPortalInfo
 */

/**
 * @typedef {L.PathOptions & { data: IITCPortalData }} IITCPortalOptions
 */

/**
 * @typedef IITCPortalData
 * @property {unknown} [artifactBrief] example: `null`
 * @property {number} [health] example: 0…100。プロパティーが無い場合もある。
 * @property {string} [image] example: `"http://lh3.googleusercontent.com/…"`
 * @property {number} [latE6] example: `35689885`
 * @property {number} [level] 1…8 example: `1`
 * @property {number} [lngE6] example: `139765518`
 * @property {boolean} [mission] example: `true`
 * @property {boolean} [mission50plus] example: `true`
 * @property {string[]} [ornaments] example: `["sc5_p"]` `["bb_s"]`
 * @property {number} [resCount] 0…8 example: `1`
 * @property {"E" | "R" | "N"} [team]
 * @property {number} [timestamp] Date.now の戻り値
 * @property {string} [title] ポータルのタイトル
 */

/**
 * @typedef {() => void} IITCPlugin
 */

/**
 * @typedef {<Layer extends L.ILayer>(
 * name: string,
 * layerGroup: L.LayerGroup<Layer>,
 * defaultDisplay?: boolean
 * ) => unknown
 * } IITCAddLayerGroup
 */

/**
 * @typedef IITCSearchResult
 * @property {string} [description]
 * @property {string} [icon]
 * @property {string} [title]
 * @property {L.ILayer} [layer]
 * @property {L.LatLngBounds} [bounds]
 */

/**
 * @typedef IITCSearchQuery
 * @property {string} term
 * @property {function(IITCSearchResult): unknown} addResult
 */

/**
 * @typedef IITCHookEventNameDataMap
 * @property {unknown} portalSelected
 * @property {unknown} portalDetailsUpdated
 * @property {unknown} artifactsUpdated
 * @property {unknown} mapDataRefreshStart
 * @property {unknown} mapDataEntityInject
 * @property {unknown} mapDataRefreshEnd
 * @property {unknown} portalAdded
 * @property {unknown} linkAdded
 * @property {unknown} fieldAdded
 * @property {unknown} portalRemoved
 * @property {unknown} linkRemoved
 * @property {unknown} fieldRemoved
 * @property {unknown} publicChatDataAvailable
 * @property {unknown} factionChatDataAvailable
 * @property {unknown} requestFinished
 * @property {unknown} nicknameClicked
 * @property {unknown} geoSearch
 * @property {unknown} search
 * @property {IITCSearchQuery} search
 * @property {unknown} iitcLoaded
 * @property {unknown} portalDetailLoaded
 * @property {unknown} paneChanged
 */

/**
 * @typedef {{
 * <K extends keyof IITCHookEventNameDataMap>(event: K, callback: (data: IITCHookEventNameDataMap[K]) => false | void): void;
 * (event: string, callback: (data: unknown) => false | void): void; }
 * } IITCAddHook
 */

/** @typedef {unknown} IITCSetupHook */

/**
 * @typedef IITCGlobalExtensions
 * @property {Record<string, IITCPortalInfo>} portals
 * @property {L.Map} map
 * @property {IITCAddLayerGroup} addLayerGroup
 * @property {IITCAddHook} addHook
 * @property {IITCPlugin} plugin
 * @property {IITCSetupHook[]} bootPlugins
 * @property {boolean} iitcLoaded
 */

/**
 * @typedef IITCPluginInfo
 * @property {string} [buildName]
 * @property {string} [dateTimeVersion]
 * @property {string} [pluginId]
 * @property {IITCScriptInfo} [script]
 */

/**
 * @typedef IITCScriptInfo
 * @property {string} [version]
 * @property {string} [name]
 * @property {string | null} [description]
 */

/**
 * @param {IITCPluginInfo} plugin_info
 */
function wrapper(plugin_info) {
    "use strict";

    const window = /** @type {Window & IITCGlobalExtensions} */ (
        /** @type {unknown} */ (globalThis.window)
    );

    if (typeof window.plugin !== "function") window.plugin = function () {};
    plugin_info.dateTimeVersion = "20240825000000";
    plugin_info.pluginId = "portal-names-ex";

    const NAME_WIDTH = 80;
    const NAME_HEIGHT = 23;
    const MAX_LABEL_COUNT = 100;
    /** @type {Record<string, L.ILayer>} */
    const labelLayers = {};
    let labelLayerGroup = null;

    function setupCSS() {
        $("<style>")
            .prop("type", "text/css")
            .html(
                "" +
                    ".plugin-portal-names-ex{" +
                    "color:#FFFFBB;" +
                    "font-size:11px;line-height:12px;" +
                    "text-align:center;padding: 2px;" +
                    "overflow:hidden;" +
                    "text-shadow:1px 1px #000,1px -1px #000,-1px 1px #000,-1px -1px #000, 0 0 5px #000;" +
                    "pointer-events:none;" +
                    "}"
            )
            .appendTo("head");
    }

    /**
     * @param {string} guid
     */
    function removeLabel(guid) {
        const previousLayer = labelLayers[guid];
        if (previousLayer) {
            labelLayerGroup.removeLayer(previousLayer);
            delete labelLayers[guid];
        }
    }

    /**
     * @param {string} guid
     * @param {L.LatLngExpression} latLng
     */
    function addLabel(guid, latLng) {
        const previousLayer = labelLayers[guid];
        if (!previousLayer) {
            const d = window.portals[guid].options.data;
            const portalName = d.title;

            const label = L.marker(latLng, {
                icon: L.divIcon({
                    className: "plugin-portal-names-ex",
                    iconAnchor: [NAME_WIDTH / 2, 0],
                    iconSize: [NAME_WIDTH, NAME_HEIGHT],
                    html: portalName,
                }),
            });
            labelLayers[guid] = label;
            label.addTo(labelLayerGroup);
        }
    }

    function clearAllPortalLabels() {
        for (const guid in labelLayers) {
            removeLabel(guid);
        }
    }

    /**
     * @param { { width: number, height: number } } param0
     */
    function createCollisionChecker({ width, height }) {
        /**
         * @typedef {null | boolean | number | bigint | string} Key
         */

        /**
         * @typedef Box
         * @property {number} x
         * @property {number} y
         * @property {Key} id
         */

        /**
         * @typedef {number} BucketKey
         */

        /** @type {Map<Key, Box>} */
        const boxes = new Map();
        /** @type {Map<BucketKey, Set<Key>>} */
        const buckets = new Map();

        /**
         * @param {number} x
         * @param {number} y
         */
        function getBucketKey(x, y) {
            const bucketX = Math.floor(x / width);
            const bucketY = Math.floor(y / height);
            // WARNING: 画面サイズが余り大きくないことに依存しているので汎用的ではない処理
            // キーの重複によりパフォーマンスが低下するかもしれないが、正確性には影響ない
            return bucketX * 10000 + bucketY;
        }

        /**
         * @param {Box} param0
         */
        function addToBucket({ x, y, id }) {
            const key = getBucketKey(x, y);
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = new Set();
                buckets.set(key, bucket);
            }
            bucket.add(id);
        }

        /**
         * @param {number} x
         * @param {number} y
         * @param {BucketKey[]} [result]
         */
        function getNeighborBuckets(x, y, result = []) {
            const bx = Math.floor(x / width);
            const by = Math.floor(y / height);

            result.length = 0;
            result.push(getBucketKey(bx * width, by * height));
            result.push(getBucketKey((bx - 1) * width, by * height));
            result.push(getBucketKey((bx + 1) * width, by * height));
            result.push(getBucketKey(bx * width, (by - 1) * height));
            result.push(getBucketKey(bx * width, (by + 1) * height));
            result.push(getBucketKey((bx - 1) * width, (by - 1) * height));
            result.push(getBucketKey((bx - 1) * width, (by + 1) * height));
            result.push(getBucketKey((bx + 1) * width, (by - 1) * height));
            result.push(getBucketKey((bx + 1) * width, (by + 1) * height));
            return result;
        }
        /**
         * @param {number} x1
         * @param {number} y1
         * @param {number} x2
         * @param {number} y2
         */
        function isColliding(x1, y1, x2, y2) {
            return Math.abs(x1 - x2) < width && Math.abs(y1 - y2) < height;
        }

        /**
         * @param {number} x
         * @param {number} y
         * @param {Key} id
         */
        function addBox(x, y, id) {
            const box = { x, y, id };
            boxes.set(id, box);
            addToBucket(box);
        }

        const tempNeighborBuckets = [];

        /**
         * @param {number} boxX
         * @param {number} boxY
         * @param {Key} id
         */
        function check(boxX, boxY, id) {
            const neighborBucketKeys = getNeighborBuckets(
                boxX,
                boxY,
                tempNeighborBuckets
            );
            for (const bucketKey of neighborBucketKeys) {
                const bucket = buckets.get(bucketKey);
                if (!bucket) continue;
                for (const otherId of bucket) {
                    if (otherId === id) continue;
                    const otherBox = boxes.get(otherId);
                    if (
                        otherBox &&
                        isColliding(boxX, boxY, otherBox.x, otherBox.y)
                    ) {
                        return true;
                    }
                }
            }

            return false;
        }
        return {
            addBox,
            check,
        };
    }

    /**
     * @typedef {object} PortalWithPoint
     * @property {string} guid
     * @property {L.Point} point
     * @property {IITCPortalInfo} portal
     */
    function getNamedPortals() {
        /** @type {PortalWithPoint[]} */
        const portals = [];

        const mapBounds = window.map.getBounds();
        for (const [guid, p] of Object.entries(window.portals)) {
            if (!(p._map && p.options.data.title)) continue;

            const coordinates = p.getLatLng();
            if (!mapBounds.contains(coordinates)) continue;

            const point = window.map.project(coordinates);
            portals.push({ guid, point, portal: p });
        }
        return portals;
    }
    /**
     * @param {readonly PortalWithPoint[]} portals
     */
    function getNotCollidedPortals(portals) {
        const collisionChecker = createCollisionChecker({
            width: NAME_WIDTH,
            height: NAME_HEIGHT,
        });

        const labeledPortals = [];
        for (const portal of portals) {
            const { point, guid } = portal;
            if (!collisionChecker.check(point.x, point.y, guid)) {
                collisionChecker.addBox(point.x, point.y, guid);
                labeledPortals.push(portal);
            }
        }
        return labeledPortals;
    }

    /**
     * @param {IITCPortalData} p
     * @returns 0…1
     */
    function currentPortalCost(p) {
        if (p.team === "N") return 0;
        const level = p.level ?? 0 / 8;
        const resCount = p.resCount ?? 0 / 8;
        const health = p.health ?? 0 / 100;
        return level * 0.6 + resCount * 0.3 + health * 0.1;
    }
    /**
     * @param {IITCPortalData} p
     */
    function portalPriority(p) {
        const eventCount =
            p.ornaments?.filter((o) => o !== "sc5_p")?.length ?? 0;
        return eventCount + currentPortalCost(p);
    }
    /**
     * @param {PortalWithPoint} p1
     * @param {PortalWithPoint} p2
     */
    function compareNamedPortal(p1, p2) {
        const data1 = p1.portal.options.data;
        const data2 = p2.portal.options.data;
        const priority1 = portalPriority(data1);
        const priority2 = portalPriority(data2);
        if (!(priority1 === priority2)) {
            // 優先度が高いポータルを先頭にする
            return priority2 - priority1;
        }
        const timestamp1 = data1.timestamp ?? 0;
        const timestamp2 = data2.timestamp ?? 0;
        if (timestamp1 !== timestamp2) {
            // 最新のポータルを先頭にする
            return timestamp2 - timestamp1;
        }

        const guid1 = p1.guid;
        const guid2 = p2.guid;
        return guid1.localeCompare(guid2);
    }
    function updatePortalLabels() {
        if (!window.map.hasLayer(labelLayerGroup)) return;

        const namedPortals = getNamedPortals();
        // 重要なポータルを残すため重要度でソートする
        namedPortals.sort(compareNamedPortal);

        let notCollidedPortals = getNotCollidedPortals(namedPortals);

        // ラベルの数に上限を設け、重要度が上位のポータルのみを表示する
        notCollidedPortals = notCollidedPortals.slice(0, MAX_LABEL_COUNT);

        /** @type {Map<string, PortalWithPoint>} */
        const labeledPortals = new Map();
        for (const portal of notCollidedPortals) {
            labeledPortals.set(portal.guid, portal);
        }

        for (const guid in labelLayers) {
            if (!labeledPortals.has(guid)) {
                removeLabel(guid);
            }
        }
        for (const guid of labeledPortals.keys()) {
            addLabel(guid, window.portals[guid].getLatLng());
        }
    }

    let timer;
    /**
     * @param {number} wait
     */
    function delayedUpdatePortalLabels(wait) {
        if (timer === undefined) {
            timer = setTimeout(function () {
                timer = undefined;
                updatePortalLabels();
            }, wait * 1000);
        }
    }

    function main() {
        setupCSS();

        labelLayerGroup = new L.LayerGroup();
        window.addLayerGroup("Portal Names Ex", labelLayerGroup, true);

        window.addHook("requestFinished", function () {
            setTimeout(function () {
                delayedUpdatePortalLabels(3.0);
            }, 1);
        });
        window.addHook("mapDataRefreshEnd", function () {
            delayedUpdatePortalLabels(0.5);
        });
        window.map.on("moveend", () => delayedUpdatePortalLabels(0.5));
        function onOverlayChange() {
            setTimeout(function () {
                delayedUpdatePortalLabels(1.0);
            }, 1);
        }
        window.map.on("overlayadd", onOverlayChange);
        window.map.on("overlayremove", onOverlayChange);
        window.map.on("zoomend", clearAllPortalLabels);
    }

    const setup = function () {
        main();
    };
    setup.info = plugin_info;
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded && typeof setup === "function") setup();
}

const script = document.createElement("script");
const info = {};
if (typeof GM_info !== "undefined" && GM_info && GM_info.script)
    info.script = {
        version: GM_info.script.version,
        name: GM_info.script.name,
        description: GM_info.script.description,
    };
script.appendChild(
    document.createTextNode("(" + wrapper + ")(" + JSON.stringify(info) + ");")
);
(document.body || document.head || document.documentElement).appendChild(
    script
);
