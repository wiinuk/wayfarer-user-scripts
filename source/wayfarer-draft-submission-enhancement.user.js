// ==UserScript==
// @name         Wayfarer Draft Submission Enhancement
// @namespace    https://github.com/
// @version      1.4
// @description  申請座標を入力。URLハッシュからの自動入力。誤操作防止用マップシールド。
// @match        https://wayfarer.scopely.com/*
// @grant        none
// ==/UserScript==
//@ts-check
//spell-checker:words wayspot

(function () {
    "use strict";

    // --- 地図・コンポーネント解析処理 ---

    /**
     * @typedef {(...args: unknown[]) => unknown} UnknownFunction
     */

    /**
     * @template T
     * @param {T} value
     */
    function assertsNonNull(value) {
        return /** @type {NonNullable<T>} */ (value);
    }

    /**
     * @typedef {object} GoogleMap
     * @property {UnknownFunction} getCenter
     * @property {UnknownFunction} addListener
     * @property {UnknownFunction} getDiv
     * @property {(value: unknown) => void} setCenter
     * @property {() => number} getZoom
     * @property {(value: number) => unknown} setZoom
     */

    /**
     * @param {unknown} value
     * @return {value is GoogleMap}
     */
    function looksLikeGoogleMap(value) {
        return !!(
            value &&
            typeof value === "object" &&
            "getCenter" in value &&
            typeof value.getCenter === "function" &&
            "addListener" in value &&
            typeof value.addListener === "function" &&
            "getDiv" in value &&
            typeof value.getDiv === "function"
        );
    }

    /**
     * @typedef {{ readonly lat: number, readonly lng: number}} LatLng
     */

    /**
     * @typedef {object} ObservableProperty
     * @property {UnknownFunction} subscribe
     */

    /**
     * @typedef {object} BaseMapDetail
     * @property {unknown[]} componentRef
     * @property {unknown} map
     */

    /**
     * @typedef {object} NiaMapDetail
     * @property {unknown[]} componentRef
     * @property {unknown} map
     */

    /**
     * @typedef {object} SubmitMapComponentBase
     * @property {BaseMapDetail} [baseMap]
     * @property {unknown} [selectedLocation]
     * @property {boolean} [isMobileMode]
     * @property {ObservableProperty} [locationSelected]
     * @property {unknown} [map]
     * @property {NiaMapDetail} [niaMap]
     * @property {unknown[]} [componentRef]
     * @property {unknown[]} [component]
     *
     * @property {unknown} [onMapClick]
     * @property {unknown} [_updateMapSelection]
     * @property {unknown} [_applySelectedMarker]
     *
     */

    /**
     * @typedef {object} SubmitMapComponentExtension1
     * @property {(location: LatLng) => unknown} onMapClick
     */

    /**
     * @typedef {object} SubmitMapComponentExtension2
     * @property {unknown} _updateMapSelection
     * @property {unknown} _applySelectedMarker
     */

    /**
     * @typedef {(SubmitMapComponentBase & SubmitMapComponentExtension1) | (SubmitMapComponentBase & SubmitMapComponentExtension2)} SubmitMapComponent
     */

    /**
     * @param {unknown} value
     * @returns {value is SubmitMapComponent}
     */
    function looksLikeSubmitMapComponent(value) {
        return !!(
            value &&
            typeof value === "object" &&
            ("baseMap" in value || "selectedLocation" in value) &&
            ("isMobileMode" in value || "selectedLocation" in value) &&
            "locationSelected" in value &&
            value.locationSelected &&
            typeof value.locationSelected === "object" &&
            "subscribe" in value.locationSelected &&
            typeof value.locationSelected.subscribe === "function"
        );
    }

    /**
     * @typedef {Record<string, Record<string | number, unknown>>} PageComponentProperties
     */

    /**
     * @param {Element} v
     * @param {Set<unknown>} [seen]
     */
    function collectPossibleObjects(v, seen = new Set()) {
        const value = /** @type {Element & PageComponentProperties} */ (v);
        /** @type {unknown[]} */
        const items = [];

        /**
         * @param {unknown} candidate
         */
        function add(candidate) {
            if (!candidate || typeof candidate !== "object") return;
            if (seen.has(candidate)) return;
            seen.add(candidate);
            items.push(candidate);
        }

        add(value);
        if (Array.isArray(value)) {
            value.forEach((item) => add(item));
        }

        if (value && typeof value === "object") {
            add(value["__ngContext__"]);
            add(value["__ngContext__"]?.[0]);
            add(value["__ngContext__"]?.["$implicit"]);
            add(value["component"]);
            add(value["componentRef"]);
            add(value["baseMap"]);
            add(value["niaMap"]);
            add(value["selectedLocation"]);
            add(value["locationSelected"]);
            add(value["host"]);
        }

        return items;
    }

    function findRawSubmitComponent() {
        /** @type {(Element & PageComponentProperties) | null} */
        const root = document.querySelector("app-submit-wayspot-map");
        const candidates = [];

        if (root) {
            candidates.push(root);
            candidates.push(root["__ngContext__"]);
            const ngContext = root["__ngContext__"];
            if (Array.isArray(ngContext)) {
                candidates.push(...ngContext);
            }

            for (const e of root.querySelectorAll("*")) {
                const element =
                    /** @type {Element & PageComponentProperties} */ (e);
                candidates.push(element);
                candidates.push(element["__ngContext__"]);
                if (Array.isArray(element["__ngContext__"])) {
                    candidates.push(...element["__ngContext__"]);
                }
            }
        }

        const seen = new Set();
        for (const candidate of candidates) {
            for (const item of collectPossibleObjects(candidate, seen)) {
                if (looksLikeSubmitMapComponent(item)) {
                    return item;
                }
            }
        }
        return null;
    }

    /**
     * @param {SubmitMapComponent | null} component
     */
    function resolveMapFromComponent(component) {
        if (!component) return null;

        const directMap =
            component.map ||
            component.baseMap?.componentRef?.map ||
            component.baseMap?.map ||
            component.niaMap?.componentRef?.map ||
            component.niaMap?.map ||
            component.componentRef?.map ||
            component.component?.map ||
            null;

        if (looksLikeGoogleMap(directMap)) return directMap;

        const niaMapHost = document.querySelector(
            "app-submit-wayspot-map nia-map"
        );
        if (niaMapHost) {
            const niaMapValues = collectPossibleObjects(niaMapHost);
            for (const i of niaMapValues) {
                const item = /** @type {unknown & PageComponentProperties} */ (
                    i
                );
                const candidateMap =
                    item["componentRef"]?.["map"] || item["map"] || null;
                if (looksLikeGoogleMap(candidateMap)) return candidateMap;
            }
        }

        return null;
    }

    /**
     * @typedef {object} GoogleMapsEventNamespace
     * @property {(map: GoogleMap, type: string, options: { latLng: LatLng }) => unknown} trigger
     */
    /**
     * @typedef {{ new(lat: number, lng: number): LatLng }} GoogleMapsLatLngConstructor
     * @typedef {typeof window & { google?: { maps?: { LatLng: GoogleMapsLatLngConstructor, event: GoogleMapsEventNamespace } } }} WindowWithGoogle
     */

    /**
     * @param {number} lat
     * @param {number} lng
     */
    function setPinCoordinate(lat, lng) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new Error("有効な数値の緯度・経度を入力してください。");
        }

        const googleMaps = /** @type {WindowWithGoogle} */ (window).google
            ?.maps;
        if (!googleMaps)
            throw new Error("Google Maps APIが読み込まれていません。");

        const submitComponent = findRawSubmitComponent();
        const nativeMap = resolveMapFromComponent(submitComponent);
        const target = new googleMaps.LatLng(lat, lng);

        if (nativeMap) {
            nativeMap.setCenter(target);
            const zoom = nativeMap.getZoom();
            nativeMap.setZoom(Math.max(zoom, 16));
        }

        if (submitComponent) {
            const nextLocation = { lat, lng };
            if (typeof submitComponent.onMapClick === "function") {
                submitComponent.onMapClick(nextLocation);
                return;
            }

            if (
                typeof submitComponent._updateMapSelection === "function" &&
                typeof submitComponent._applySelectedMarker === "function"
            ) {
                submitComponent._updateMapSelection(nextLocation);
                submitComponent._applySelectedMarker();
                return;
            }
        }

        if (nativeMap && googleMaps.event) {
            googleMaps.event.trigger(nativeMap, "click", { latLng: target });
            return;
        }

        throw new Error("コンポーネントまたはマップの取得に失敗しました。");
    }

    // --- マップ操作誤作動防止用オーバーレイ（シールド）機能 ---

    /**
     * @param {HTMLElement} mapContainer
     */
    function setupMapShield(mapContainer) {
        if (document.getElementById("custom-map-shield")) return;

        // 親要素のポディショニング調整
        if (getComputedStyle(mapContainer).position === "static") {
            mapContainer.style.position = "relative";
        }

        const shield = document.createElement("div");
        shield.id = "custom-map-shield";
        shield.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 999;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            backdrop-filter: blur(2px);
            transition: opacity 0.2s ease;
        `;

        const badge = document.createElement("div");
        badge.style.cssText = `
            background: rgba(0, 0, 0, 0.75);
            color: #fff;
            padding: 10px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
            text-align: center;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
            pointer-events: none;
            user-select: none;
        `;
        badge.innerHTML = "🔒 タップしてマップ操作を有効化";
        shield.appendChild(badge);

        // 再ロック用のボタン
        const relockBtn = document.createElement("button");
        relockBtn.id = "custom-map-relock-btn";
        relockBtn.textContent = "🔒 マップをロック";
        relockBtn.style.cssText = `
            position: absolute;
            bottom: 12px;
            right: 12px;
            z-index: 998;
            padding: 6px 12px;
            background: rgba(0, 0, 0, 0.7);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 16px;
            font-size: 12px;
            cursor: pointer;
            display: none;
        `;

        // ロック解除
        shield.addEventListener("click", (e) => {
            e.stopPropagation();
            shield.style.display = "none";
            relockBtn.style.display = "block";
        });

        // 再ロック
        relockBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            shield.style.display = "flex";
            relockBtn.style.display = "none";
        });

        mapContainer.appendChild(shield);
        mapContainer.appendChild(relockBtn);
    }

    // --- 手動座標入力UI ---

    /**
     * @param {HTMLElement} mapContainer
     */
    function createInputUI(mapContainer) {
        if (document.getElementById("custom-coord-input-container")) return;

        const container = document.createElement("div");
        container.id = "custom-coord-input-container";
        container.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 1000;
      background: rgba(255, 255, 255, 0.95);
      padding: 8px 12px;
      border-radius: 6px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      display: flex;
      gap: 6px;
      align-items: center;
      font-family: sans-serif;
    `;

        const input = document.createElement("input");
        input.id = "custom-coord-input-field";
        input.type = "text";
        input.placeholder = "35.6812, 139.7671";
        input.style.cssText = `
      width: 180px;
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
    `;

        const btn = document.createElement("button");
        btn.textContent = "ピン移動";
        btn.style.cssText = `
      padding: 4px 10px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    `;

        btn.addEventListener("click", () => {
            const value = input.value.trim();
            const parts = value.split(",").map((s) => parseFloat(s.trim()));

            if (
                parts.length === 2 &&
                !isNaN(assertsNonNull(parts[0])) &&
                !isNaN(assertsNonNull(parts[1]))
            ) {
                try {
                    setPinCoordinate(
                        assertsNonNull(parts[0]),
                        assertsNonNull(parts[1])
                    );
                } catch (err) {
                    alert(
                        "エラー: " +
                            (err instanceof Error ? err.message : String(err))
                    );
                }
            } else {
                alert("座標の形式が正しくありません。\n例: 35.6812, 139.7671");
            }
        });

        container.appendChild(input);
        container.appendChild(btn);

        if (getComputedStyle(mapContainer).position === "static") {
            mapContainer.style.position = "relative";
        }
        mapContainer.appendChild(container);
    }

    // --- フォーム入力・Angular連携処理 ---

    /**
     * @param {HTMLInputElement} element
     * @param {string} value
     */
    function setInputValue(element, value) {
        if (!element) return;
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }

    let autoFillProcessed = false;

    function processHashData() {
        if (autoFillProcessed) return;

        const hash = window.location.hash;
        if (!hash.includes("#data=")) return;

        try {
            const jsonStr = decodeURIComponent(
                hash.substring(hash.indexOf("#data=") + 6)
            );
            const data = JSON.parse(jsonStr);

            // 1. 座標反映
            if (typeof data.lat === "number" && typeof data.lng === "number") {
                try {
                    setPinCoordinate(data.lat, data.lng);
                    const coordInput = /** @type {HTMLInputElement} */ (
                        document.getElementById("custom-coord-input-field")
                    );
                    if (coordInput) {
                        coordInput.value = `${data.lat}, ${data.lng}`;
                    }
                } catch (e) {
                    console.warn("座標の設定を再試行します", e);
                    return; // 成功するまで次のフレームでやり直す
                }
            }

            // 2. 指定されたIDセレクタで入力
            const nameInput = /** @type {HTMLInputElement} */ (
                document.querySelector("textarea#title")
            );
            const descInput = /** @type {HTMLInputElement} */ (
                document.querySelector("textarea#description")
            );
            const stmtInput = /** @type {HTMLInputElement} */ (
                document.querySelector("textarea#supportingStatement")
            );

            if (data.title && nameInput) setInputValue(nameInput, data.title);
            if (data.description && descInput)
                setInputValue(descInput, data.description);
            if (data.statement && stmtInput)
                setInputValue(stmtInput, data.statement);

            autoFillProcessed = true;
        } catch (e) {
            console.error("ハッシュデータの解析に失敗しました:", e);
            autoFillProcessed = true;
        }
    }

    // --- DOM監視と実行制御 ---

    const observer = new MutationObserver(() => {
        const mapContainer = /** @type {HTMLElement} */ (
            document.querySelector("app-submit-wayspot-map")
        );
        if (mapContainer) {
            setupMapShield(mapContainer);
            createInputUI(mapContainer);
        }
        processHashData();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
