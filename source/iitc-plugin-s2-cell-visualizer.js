// ==UserScript==
// @id             iitc-plugin-s2-cell-visualizer
// @name           IITC plugin: S2 Cell Visualizer
// @category       Layer
// @version        0.1.0
// @namespace      https://github.com/wiinuk/wayfarer-user-scripts
// @updateURL      https://github.com/wiinuk/wayfarer-user-scripts/raw/main/source/iitc-plugin-s2-cell-visualizer.js
// @downloadURL    https://github.com/wiinuk/wayfarer-user-scripts/raw/main/source/iitc-plugin-s2-cell-visualizer.js
// @description    Show S2 Cell information on the map.
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
//spell-checker: ignore lngs moveend

(() => {
    "use strict";

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
     * @template {number} To
     * @template {never[]} [Current = []]
     * @template {number} [Result = never]
     * @typedef {To extends Current["length"] ? (Result | To) :
     *      RangeUnion<To, [...Current, never], Result | Current["length"]>
     * } RangeUnion
     */
    /**
     * e.g. '4/032212303102210'
     * @typedef {`${S2FaceString}/${S2PositionString}`} S2Key
     */
    /**
     * e.g. '4'
     * @typedef {`${S2Face}`} S2FaceString
     */
    /**
     * @typedef {RangeUnion<5>} S2Face
     */
    /**
     * e.g. '032212303102210'
     * @typedef {`${number}`} S2PositionString
     */
    /**
     * e.g. '9749618446378729472'
     * @typedef {`${number}`} S2Id
     */
    /**
     * @typedef {RangeUnion<30>} S2Level
     */
    /**
     * @typedef {RangeUnion<3>} S2Quad
     */

    /**
     * @typedef S2Namespace
     * @property {S2CellNamespace} S2Cell
     * @property {(lat: number, lng: number, level: S2Level) => S2Key} latLngToKey
     * @property {(key: S2Key) => S2Id} keyToId
     * @property {(id: S2Id) => S2Key} idToKey
     * @property {(key: S2Id) => S2LatLng} keyToLatLng
     * @property {(id: S2Id) => S2LatLng} idToLatLng
     * @property {(lat: number, lng: number, level: S2Level) => [S2Key, S2Key, S2Key, S2Key]} latLngToNeighborKeys
     * @property {(key: S2Key) => S2Key} nextKey
     * @property {(key: S2Key) => S2Key} prevKey
     * @property {(key: S2Key, step: number) => S2Key} stepKey
     * @property {(face: S2FaceString | S2Face, position: S2PositionString | string, level: S2Level | number) => S2Id} facePosLevelToId
     */
    /**
     * @typedef S2CellNamespace
     * @property {(latLng: Readonly<S2LatLng>, level: S2Level) => S2Cell} FromLatLng
     * @property {(face: S2Face, ij: readonly [i: number, j: number], level: number) => S2Cell} FromFaceIJ
     */
    /**
     * @typedef {Object} S2LatLng
     * @property {number} lat - Latitude
     * @property {number} lng - Longitude
     */
    /**
     * @typedef {{
        getFaceAndQuads(): [face: S2Face, quads: S2Quad[]];
        readonly face: S2Face;
        readonly ij: readonly [number, number];
        readonly level: S2Level;
        getLatLng(): S2LatLng;
        getCornerLatLngs(): [S2LatLng, S2LatLng, S2LatLng, S2LatLng];
        getNeighbors(): [S2Cell, S2Cell, S2Cell, S2Cell];
        toString(): string;
     }} S2Cell

    /**
     * @param {IITCPluginInfo} plugin_info
     */
    function wrapper(plugin_info) {
        "use strict";

        const window = /** @type {Window & IITCGlobalExtensions} */ (
            /** @type {unknown} */ (globalThis.window)
        );

        if (typeof window.plugin !== "function") window.plugin = function () {};
        plugin_info.dateTimeVersion = "20240827000000";
        plugin_info.pluginId = "s2-cell-visualizer";

        class AbortError extends Error {
            name = "AbortError";
        }
        /**
         * @param {{ signal?: AbortSignal }} [options]
         * @returns {Promise<DOMHighResTimeStamp>}
         */
        function waitForNextAnimationFrame(options) {
            return new Promise((resolve, reject) => {
                if (options?.signal?.aborted) {
                    reject(new AbortError());
                }
                let onResolved = resolve;
                if (options?.signal) {
                    const onAborted = () => reject(new AbortError());
                    options.signal.addEventListener("abort", onAborted);
                    onResolved = (time) => {
                        options.signal?.removeEventListener("abort", onAborted);
                        resolve(time);
                    };
                }
                requestAnimationFrame(onResolved);
            });
        }
        /**
         * @param {(signal: AbortSignal) => Promise<void>} scope
         * @param {(error: unknown) => void} handleAsyncError
         */
        function createAsyncCancelScope(scope, handleAsyncError) {
            /** @type {AbortController | null} */
            let lastCancel = null;
            return () => {
                if (lastCancel) lastCancel.abort();
                lastCancel = new AbortController();
                scope(lastCancel.signal).catch((e) => {
                    if (e instanceof Error && e.name === "AbortError") {
                        return;
                    }
                    handleAsyncError(e);
                });
            };
        }

        /**
         * @param {unknown} e
         */
        function handleAsyncError(e) {
            console.error(e);
        }

        /** @type {(...parameters: Parameters<(typeof L)["polyline"]>) => L.Polyline} */
        function geodesicPolyline(...parameters) {
            return /** @type {any} */ (L).geodesicPolyline(...parameters);
        }
        async function asyncMain() {
            /** @type {S2Namespace} */
            const S2 = (
                await import(
                    //@ts-expect-error
                    "https://cdn.jsdelivr.net/npm/s2-geometry@1.2.10/+esm"
                )
            ).default.S2;

            $("<style>")
                .prop("type", "text/css")
                .html(
                    ".plugin-showcells-name {\
            font-size: 14px;\
            font-weight: bold;\
            color: gold;\
            opacity: 0.7;\
            text-align: center;\
            text-shadow: -1px -1px #000, 1px -1px #000, -1px 1px #000, 1px 1px #000, 0 0 2px #000; \
            pointer-events: none;\
          }"
                )
                .appendTo("head");

            const regionLayer = L.layerGroup();

            const FACE_NAMES = /** @type {const} */ ([
                "AF",
                "AS",
                "NR",
                "PA",
                "AM",
                "ST",
            ]);
            const CODE_WORDS = /** @type {const} */ ([
                "ALPHA",
                "BRAVO",
                "CHARLIE",
                "DELTA",
                "ECHO",
                "FOXTROT",
                "GOLF",
                "HOTEL",
                "JULIET",
                "KILO",
                "LIMA",
                "MIKE",
                "NOVEMBER",
                "PAPA",
                "ROMEO",
                "SIERRA",
            ]);
            /**
             * @param {number} num
             * @param {number} size
             * @return {string}
             */
            function zeroPad(num, size) {
                let s = num + "";
                while (s.length < size) s = "0" + s;
                return s;
            }
            /**
             * @param {S2Cell} cell
             */
            function regionName(cell) {
                // ingress does some odd things with the naming. for some faces, the i and j coords are flipped when converting
                // (and not only the names - but the full quad coords too!). easiest fix is to create a temporary cell with the coords
                // swapped
                if (cell.face == 1 || cell.face == 3 || cell.face == 5) {
                    cell = S2.S2Cell.FromFaceIJ(
                        cell.face,
                        [cell.ij[1], cell.ij[0]],
                        cell.level
                    );
                }

                // first component of the name is the face
                let name = FACE_NAMES[cell.face];

                if (cell.level >= 4) {
                    // next two components are from the most signifitant four bits of the cell I/J
                    var regionI = cell.ij[0] >> (cell.level - 4);
                    var regionJ = cell.ij[1] >> (cell.level - 4);

                    name += zeroPad(regionI + 1, 2) + "-" + CODE_WORDS[regionJ];
                }

                if (cell.level >= 6) {
                    // the final component is based on the hibbert curve for the relevant cell
                    var faceQuads = cell.getFaceAndQuads();
                    var number = faceQuads[1][4] * 4 + faceQuads[1][5];

                    name += "-" + zeroPad(number, 2);
                }

                return name;
            }

            /**
             * @param {S2Face} face
             * @param {readonly S2Quad[]} quads
             */
            function faceQuadsToId(face, quads) {
                return BigInt(
                    S2.facePosLevelToId(face, quads.join(""), quads.length)
                );
            }
            /**
             * @param {S2Cell} cell
             */
            function getCell6IdRatio(cell) {
                if (cell.level <= 6) return null;

                const [face, quads] = cell.getFaceAndQuads();
                const minQuads = quads.slice(0, 6);
                const maxQuads = quads.slice(0, 6);
                for (let i = 6; i < quads.length; i++) {
                    minQuads.push(0);
                    maxQuads.push(3);
                }

                const cellId = faceQuadsToId(face, quads);
                const minCellId = faceQuadsToId(face, minQuads);
                const maxCellId = faceQuadsToId(face, maxQuads);
                console.log(quads, minCellId, maxCellId);
                return (
                    Number(cellId - minCellId) / Number(maxCellId - minCellId)
                );
            }
            /**
             * @param {S2Cell} cell
             */
            function createCellName(cell) {
                const ratio = getCell6IdRatio(cell);
                if (ratio == null) return null;
                return `${Math.round(ratio * 100 * 100) / 100}%`;
            }
            /**
             * @param {S2Cell} cell
             * @param {string} name
             */
            function createCellMarker(cell, name) {
                // center point
                let center = L.latLng(cell.getLatLng());
                // move the label if we're at a high enough zoom level and it's off screen
                if (window.map.getZoom() >= 9) {
                    const nameBounds = window.map.getBounds().pad(-0.1); // pad 10% inside the screen bounds
                    if (!nameBounds.contains(center)) {
                        // name is off-screen. pull it in so it's inside the bounds
                        const newLat = Math.max(
                            Math.min(center.lat, nameBounds.getNorth()),
                            nameBounds.getSouth()
                        );
                        const newLng = Math.max(
                            Math.min(center.lng, nameBounds.getEast()),
                            nameBounds.getWest()
                        );

                        const newPos = L.latLng(newLat, newLng);

                        // ensure the new position is still within the same cell
                        const newPosCell = S2.S2Cell.FromLatLng(newPos, 6);
                        if (newPosCell.toString() == cell.toString()) {
                            center = newPos;
                        }
                        // else we leave the name where it was - offscreen
                    }
                }

                return L.marker(center, {
                    icon: L.divIcon({
                        className: "plugin-showcells-name",
                        iconAnchor: [100, 5],
                        iconSize: [200, 10],
                        html: name,
                    }),
                });
            }
            /**
             * @param {S2Cell} cell
             * @param {(cell: S2Cell) => L.PolylineOptions} getOptions
             * @param {boolean} isMinCell
             */
            function drawCell(cell, getOptions, isMinCell) {
                //TODO: move to function - then call for all cells on screen

                // corner points
                const corners = cell.getCornerLatLngs();

                // the level 6 cells have noticeable errors with non-geodesic lines - and the larger level 4 cells are worse
                // NOTE: we only draw two of the edges. as we draw all cells on screen, the other two edges will either be drawn
                // from the other cell, or be off screen so we don't care
                const region = geodesicPolyline(
                    [corners[0], corners[1], corners[2]],
                    getOptions(cell)
                );
                regionLayer.addLayer(region);

                // if (isMinCell) {
                //     const ratio = getCell6IdRatio(cell);
                //     if (ratio != null) {
                //         const square = L.geodesicPolyline(
                //             [corners[0], corners[1], corners[2], corners[3]],
                //             /** @satisfies {L.PolylineOptions} */ ({
                //                 clickable: false,
                //                 fill: true,
                //                 fillOpacity: 0.3 + ratio * 0.2,
                //                 fillColor: "white",
                //                 stroke: false,
                //             })
                //         );
                //         regionLayer.addLayer(square);
                //     }
                // }
                // const name = createCellName(cell); // regionName(cell);
                // if (name != null) {
                //     const marker = createCellMarker(cell, name);
                //     regionLayer.addLayer(marker);
                // }
            }
            /**
             * @param {L.LatLngBounds} mapBounds
             * @param {S2Cell} initialCell
             * @param {(cell: S2Cell) => L.PolylineOptions} getOptions
             * @param {boolean} isMinCell
             * @param {YieldScheduler} scheduler
             */
            async function drawCellAndNeighbors(
                mapBounds,
                initialCell,
                getOptions,
                isMinCell,
                scheduler
            ) {
                const mapCenter = mapBounds.getCenter();
                /**
                 * @param {S2Cell} cell
                 */
                function distanceToMapCenter(cell) {
                    return mapCenter.distanceTo(cell.getLatLng());
                }
                /**
                 * @param {S2Cell} cell1
                 * @param {S2Cell} cell2
                 */
                function compareByDistanceToMapCenter(cell1, cell2) {
                    return (
                        distanceToMapCenter(cell2) - distanceToMapCenter(cell1)
                    );
                }

                /** @type {Set<string>} */
                const seenCells = new Set();
                const remainingCells = [initialCell];

                let cell;
                while (((cell = remainingCells.pop()), cell)) {
                    const cellKey = cell.toString();

                    // cell not visited - flag it as visited now
                    if (seenCells.has(cellKey)) continue;
                    seenCells.add(cellKey);

                    // is it on the screen?
                    const corners = cell.getCornerLatLngs();
                    const cellBounds = L.latLngBounds([corners[0], corners[1]])
                        .extend(corners[2])
                        .extend(corners[3]);

                    if (!cellBounds.intersects(mapBounds)) continue;

                    // on screen - draw it
                    drawCell(cell, getOptions, isMinCell);
                    if (scheduler.yieldRequested) await scheduler.yield();

                    // and recurse to our neighbors
                    remainingCells.push(...cell.getNeighbors());
                    remainingCells.sort(compareByDistanceToMapCenter);
                }
            }

            const getDrawOptions = ["white", "gold", "red", "purple"].map(
                (color, index) => {
                    const baseOptions = {
                        fill: false,
                        color,
                        opacity: 0.5,
                        weight: 1,
                        clickable: false,
                    };
                    /**
                     * @param {S2Cell} cell
                     * @returns {Readonly<L.PolylineOptions>}
                     */
                    return (cell) => {
                        baseOptions.weight = (5 * 3) / (cell.level - 9);
                        return baseOptions;
                    };
                }
            );
            /** @param {number} index */
            function getOptions(index) {
                return getDrawOptions[index % getDrawOptions.length];
            }

            /** @type {readonly { minZoom: number, level: S2Level }[]} */
            const cellSettings = [
                { minZoom: 19, level: 20 }, // Pgo 捕獲場所, Pgo Exジム判定
                { minZoom: 16, level: 17 }, // Pgo ポケストップ判定
                { minZoom: 14, level: 14 }, // Pgo ジム判定
                { minZoom: 12, level: 12 },
                { minZoom: 8, level: 9 },
                { minZoom: 6, level: 6 }, // Wayfarer Showcase の境界, Pgo レイドポケモンの境界
                { minZoom: 3, level: 3 },
            ];

            /**
             * @param {YieldScheduler} scheduler
             */
            async function drawHugeCells(scheduler) {
                // the six cube side boundaries. we cheat by hard-coding the coords as it's simple enough
                const latLngs = [
                    [45, -180],
                    [35.264389682754654, -135],
                    [35.264389682754654, -45],
                    [35.264389682754654, 45],
                    [35.264389682754654, 135],
                    [45, 180],
                ];

                const globalCellOptions = {
                    color: "red",
                    weight: 7,
                    opacity: 0.5,
                    clickable: false,
                };

                for (let i = 0; i < latLngs.length - 1; i++) {
                    // the geodesic line code can't handle a line/polyline spanning more than (or close to?) 180 degrees, so we draw
                    // each segment as a separate line
                    const poly1 = geodesicPolyline(
                        [latLngs[i], latLngs[i + 1]],
                        globalCellOptions
                    );
                    regionLayer.addLayer(poly1);
                    if (scheduler.yieldRequested) await scheduler.yield();

                    //southern mirror of the above
                    const poly2 = geodesicPolyline(
                        [
                            [-latLngs[i][0], latLngs[i][1]],
                            [-latLngs[i + 1][0], latLngs[i + 1][1]],
                        ],
                        globalCellOptions
                    );
                    regionLayer.addLayer(poly2);
                    if (scheduler.yieldRequested) await scheduler.yield();
                }

                // and the north-south lines. no need for geodesic here
                for (let i = -135; i <= 135; i += 90) {
                    const poly = L.polyline(
                        [
                            [35.264389682754654, i],
                            [-35.264389682754654, i],
                        ],
                        globalCellOptions
                    );
                    regionLayer.addLayer(poly);
                    if (scheduler.yieldRequested) await scheduler.yield();
                }
            }

            /**
             * @typedef {{ readonly yieldRequested: boolean, yield(): Promise<unknown> }} YieldScheduler
             */

            /**
             * @param {AbortSignal} signal
             * @returns {YieldScheduler}
             */
            function createYieldScheduler(signal) {
                let nextYieldTimeStamp = 0;
                return {
                    get yieldRequested() {
                        return nextYieldTimeStamp <= performance.now();
                    },
                    async yield() {
                        await waitForNextAnimationFrame({ signal });
                        nextYieldTimeStamp = performance.now() + 1000 / 60;
                    },
                };
            }
            /**
             * @param {AbortSignal} signal
             */
            async function updateAsync(signal) {
                if (!window.map.hasLayer(regionLayer)) return;

                const scheduler = createYieldScheduler(signal);
                regionLayer.clearLayers();

                await drawHugeCells(scheduler);

                const mapBounds = window.map.getBounds();
                const mapCenter = window.map.getCenter();
                const mapZoom = window.map.getZoom();

                let minCellRendered = false;
                const drawPromises = cellSettings.map(
                    ({ level, minZoom }, index) => {
                        if (mapZoom >= minZoom) {
                            const cell = S2.S2Cell.FromLatLng(mapCenter, level);
                            const isMinCell = !minCellRendered;
                            minCellRendered = true;
                            return drawCellAndNeighbors(
                                mapBounds,
                                cell,
                                getOptions(index),
                                isMinCell,
                                scheduler
                            );
                        }
                    }
                );
                await Promise.all(drawPromises);
            }
            const update = createAsyncCancelScope(
                updateAsync,
                handleAsyncError
            );
            window.addLayerGroup("S2 Cell Lines", regionLayer, true);
            window.map.on("moveend", update);
            update();
        }

        const setup = function () {
            asyncMain().catch(handleAsyncError);
        };
        setup.info = plugin_info;
        if (!window.bootPlugins) window.bootPlugins = [];
        window.bootPlugins.push(setup);
        if (window.iitcLoaded && typeof setup === "function") setup();
    }

    const script = document.createElement("script");
    const info = {};
    if (typeof GM_info !== "undefined" && GM_info && GM_info.script) {
        info.script = {
            version: GM_info.script.version,
            name: GM_info.script.name,
            description: GM_info.script.description,
        };
    }
    script.appendChild(
        document.createTextNode(
            "(" + wrapper + ")(" + JSON.stringify(info) + ");"
        )
    );
    (document.body || document.head || document.documentElement).appendChild(
        script
    );
})();
