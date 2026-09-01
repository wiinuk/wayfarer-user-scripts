// ==UserScript==
// @name         IITC plugin: Additional Portals
// @id           dev-iitc-plugin-additional-portals
// @namespace    http://tampermonkey.net/
// @version      2025-08-06
// @description  try to take over the world!
// @author       You
// @match        https://intel.ingress.com/intel
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ingress.com
// @grant        none
// ==/UserScript==
// spell-checker: ignore guids
//@ts-check

/**
 * @param {{ dateTimeVersion: string; pluginId: string; }} plugin_info
 */
function wrapper(plugin_info) {
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
     * @callback IITCRenderPortalDetails
     * @param {IITCGuid} guid
     * @returns {void}
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

    /**
     * @typedef {Object} IITCTileParameters
     * @property {number} level - 最小ポータルレベル（このズームレベルで表示されるポータルの最小レベル）
     * @property {number} maxLevel - ログや参照用の最大レベル（`ZOOM_TO_LEVEL[zoom]`の値をそのまま返す）
     * @property {number} tilesPerEdge - このズームレベルでのタイルの辺ごとの数（通常は 8〜512）
     * @property {number} minLinkLength - このズームレベルで表示されるリンクの最短距離（メートルなど）
     * @property {boolean} hasPortals - このズームレベルでポータルが表示されるかどうか
     * @property {number} zoom - 入力として与えられたズームレベル
     */
    /**
     * @typedef {(zoom: number) => IITCTileParameters} IITCGetMapZoomTileParameters
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
     * @property {IITCRenderPortalDetails} renderPortalDetails
     * @property {IITCGetMapZoomTileParameters} getMapZoomTileParameters
     * @property {(tileY: number, tileParams: IITCTileParameters) => number} tileToLat
     * @property {(tileX: number, tileParams: IITCTileParameters) => number} tileToLng
     * @property {IITCPostAjax} postAjax
     */

    /**
     * @typedef {"ENLIGHTENED" | "RESISTANCE" | "E" | "R" | "N" | "M"} IITCKnownTeamString
     * @typedef {IITCKnownTeamString | string} IITCTeamString
     * @typedef {readonly [kind: "r", ...details: unknown[]]} IITCFieldEntity
     * @typedef {readonly [kind: "e", ...details: unknown[]]} IITCLinkEntity
     * @typedef {readonly [kind: "p", team: IITCTeamString, latE6: number, lngE6: number]} IITCPortalEntityCore
     * @typedef {readonly [...IITCPortalEntityCore, level: number, health: number, resCount: number, image: string | null, title: string, ornaments: readonly string[], mission: boolean, mission50plus: boolean, artifactBrief: null,
      timestamp: number]} IITCPortalEntitySummary
     * @typedef {readonly [...IITCPortalEntitySummary, ...unknownDetails: unknown[]]} IITCPortalEntityDetail
     * @typedef {IITCPortalEntityCore | IITCPortalEntitySummary | IITCPortalEntityDetail} IITCPortalEntity
     * @typedef {IITCFieldEntity | IITCLinkEntity | IITCPortalEntity} IITCGameEntityDetail
     * @typedef {readonly [guid: IITCGuid, timestamp: number, detail: IITCGameEntityDetail]} IITCGameEntity
     */
    /**
     * @typedef {object} IITCTileResponseError
     * @property {string} error "TIMEOUT" など
     */
    /**
     * @typedef {object} IITCTileResponseSuccess
     * @property {undefined} [error]
     * @property {IITCGameEntity[]} [gameEntities]
     * @property {unknown} [deletedGameEntityGuids]
     */
    /**
     * @typedef {string} IITCTileId
     * @typedef {string} IITCGuid "xxxxxxxxxxxxxxxxxxxxxxxxxxxx.16" または "xxxxxxxxxxxxxxxxxxxxxxxxxxxx.22"
     * @typedef {IITCTileResponseError | IITCTileResponseSuccess} IITCTileResponse
     * @typedef {Readonly<Record<IITCTileId, IITCTileResponse>>} IITCTileResponseMap
     * @typedef {Readonly<{ tileKeys?: readonly IITCTileId[] }>} IITCGetEntitiesRequest
     * @typedef {{ readonly result?: { readonly map: IITCTileResponseMap }} | null | undefined} IITCGetEntitiesResponse
     */

    /**
     * @typedef {(data: unknown, textStatus: string, jqXHR: JQueryXHR) => void} IITCPostAjaxSuccessCallback
     * @callback IITCPostAjax
     * @param {string} action
     * @param {unknown} data
     * @param {IITCPostAjaxSuccessCallback} successCallback
     * @param {(jqXHR: JQueryXHR | null, textStatus: string | undefined, errorThrown: unknown) => void} [errorCallback]
     * @param {...unknown[]} restParameters
     * @returns {JQueryXHR}
     */

    const window = /** @type {Window & IITCGlobalExtensions} */ (
        /** @type {unknown} */ (globalThis.window)
    );

    if (typeof window.plugin !== "function") {
        window.plugin = function () {
            // marker function
        };
    }
    plugin_info.dateTimeVersion = "20240825000000";
    plugin_info.pluginId = "portal-names-ex";

    /**
     * @type {<Ts extends any[]>(...args: Ts) => Ts}
     */
    function tuple(...args) {
        return args;
    }

    // 15_28477_12267_0_8_100
    // zoom_x_y_level_8_100
    const tileIdPattern = /^(\d+)_(\d+)_(\d+)/;
    /**
     * @param {IITCTileId} tileId
     */
    function tileIdToBounds(tileId) {
        if (!tileIdPattern.test(tileId)) return;

        const match = tileId.match(tileIdPattern);
        if (!match) return;

        const zoom = parseInt(match[1], 10);
        const x = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        const tileParams = window.getMapZoomTileParameters(zoom);
        const tileSW = L.latLng(
            window.tileToLat(y + 1, tileParams),
            window.tileToLng(x, tileParams)
        );
        const tileNE = L.latLng(
            window.tileToLat(y, tileParams),
            window.tileToLng(x + 1, tileParams)
        );
        return L.latLngBounds(tileSW, tileNE);
    }
    /**
     * 指定された領域を地図上に描画し、任意のラベルを中心に表示する（10秒後に自動削除）
     * @param {L.LatLngBounds} bounds - 描画する地理的領域
     * @param {L.Map} map - 対象の Leaflet マップインスタンス
     * @param {string} [labelText] - 任意のラベル文字列（省略可能）
     */
    function debugDrawBounds(bounds, map, labelText) {
        // 矩形を塗りつぶしで描画
        const rectangle = L.rectangle(bounds, {
            color: "red",
            weight: 1,
            fill: true,
            fillColor: "red",
            fillOpacity: 0.2,
        }).addTo(map);

        let labelMarker;

        if (labelText) {
            // DivIcon を作成して中央に配置
            const icon = L.divIcon({
                className: "debug-label-icon",
                html: `<div class="debug-label">${labelText}</div>`,
            });

            labelMarker = L.marker(bounds.getCenter(), {
                icon,
                clickable: false, // クリックイベントを無効化
                draggable: false, // ドラッグ不可
                keyboard: false, // キーボード操作不可
            }).addTo(map);
        }

        setTimeout(() => {
            map.removeLayer(rectangle);
            if (labelMarker) {
                map.removeLayer(labelMarker);
            }
        }, 3000);
    }

    function generatePortalGuid() {
        return crypto.randomUUID().replace(/-/g, "") + ".16"; // .22 形式もある
    }

    /**
     * @param {number} lat
     * @param {number} lng
     * @param {string} title
     * @returns {IITCGameEntity}
     */
    function createNewSkeletonPortalEntity(lat, lng, title) {
        const guid = generatePortalGuid();
        const timestamp = 0;

        /** @type {IITCPortalEntitySummary} */
        const summary = [
            "p",
            "N",
            Math.round(lat * 1e6),
            Math.round(lng * 1e6),
            1,
            100,
            0,
            null,
            title,
            [],
            false,
            false,
            null,
            timestamp,
        ];
        return [guid, timestamp, summary];
    }

    /**
     * @param {unknown} error
     */
    function handleAsyncError(error) {
        console.error("Async error occurred:", error);
    }

    /**
     * @typedef {object} GameEntityModifier
     * @property {string} [id] - ユニークな識別子。指定しない場合は自動生成される。
     * @property {(bounds: L.LatLngBounds, original: readonly IITCGameEntity[]) => Promise<{ readonly additionalEntities?: readonly IITCGameEntity[] }>} modifyEntitiesInBounds - 指定された領域内のエンティティを取得する関数
     */

    /** @type {Map<string, GameEntityModifier>} */
    const modifiers = new Map();

    /**
     * @param {GameEntityModifier} modifier
     */
    function registerGameEntityModifier(modifier) {
        modifiers.set(modifier.id ?? crypto.randomUUID(), modifier);
    }

    /**
     * @param {L.LatLngBounds} bounds
     * @param {readonly IITCGameEntity[]} original
     * @returns {Promise<readonly IITCGameEntity[]>}
     */
    async function getAdditionalEntitiesInBounds(bounds, original) {
        const entities = [];
        for (const modifier of modifiers.values()) {
            try {
                const { additionalEntities = [] } =
                    await modifier.modifyEntitiesInBounds(bounds, original);
                entities.push(...additionalEntities);
            } catch (error) {
                handleAsyncError(error);
            }
        }
        return entities;
    }
    /**
     * @param {IITCGetEntitiesResponse} data
     */
    async function modifyGetEntitiesResponseAsync(data) {
        const tileMap = data?.result?.map;
        if (tileMap == null) return;

        console.log("modifyGetEntitiesResponseAsync");

        const modifyEntitiesPromises = Object.entries(tileMap).map(
            async ([tileId, tile]) => {
                if ("error" in tile) return;

                const bounds = tileIdToBounds(tileId);
                if (!bounds) return;

                debugDrawBounds(bounds, window.map, `merge: ${tileId}`);

                const entities = await getAdditionalEntitiesInBounds(
                    bounds,
                    tile.gameEntities ?? []
                );
                for (const entity of entities) {
                    (tile.gameEntities ??= []).push(entity);
                }
            }
        );
        await Promise.all(modifyEntitiesPromises);
    }
    function inject() {
        const originalPostAjax = window.postAjax;

        /** @type {IITCPostAjax} */
        window.postAjax = function (...parameters) {
            const [action, data, onSuccess, onError, ...restParameters] =
                parameters;
            if (action !== "getEntities") {
                return originalPostAjax(...parameters);
            }
            return originalPostAjax(
                "getEntities",
                data,
                (data, status, jqXHR) => {
                    const response = /** @type {IITCGetEntitiesResponse} */ (
                        data
                    );
                    modifyGetEntitiesResponseAsync(response)
                        .catch(handleAsyncError)
                        .then(() => {
                            onSuccess(response, status, jqXHR);
                        });
                },
                onError,
                ...restParameters
            );
        };
    }

    const setup = function () {
        registerGameEntityModifier({
            async modifyEntitiesInBounds(bounds) {
                const center = bounds.getCenter();
                const additionalEntities = [
                    createNewSkeletonPortalEntity(
                        center.lat,
                        center.lng,
                        "Center Portal"
                    ),
                ];
                return {
                    additionalEntities,
                };
            },
        });
        inject();
    };
    setup.info = plugin_info;
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded && typeof setup === "function") setup();
}

(() => {
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
