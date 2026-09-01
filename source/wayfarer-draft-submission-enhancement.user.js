// ==UserScript==
// @name         Wayfarer Draft Submission Enhancement
// @namespace    https://github.com/
// @version      1.14
// @description  手動で申請座標入力。URLハッシュからの自動入力。誤操作防止用マップシールド。意図しない自動ピン設定の通知。
// @match        https://wayfarer.scopely.com/*
// @grant        none
// ==/UserScript==
//@ts-check
//spell-checker:words wayspot EXIF relock

(function () {
    "use strict";

    // --- ユーザー操作フラグ・監視管理 ---
    let isUserAction = false;
    let userActionTimeout = /** @type {number | null} */ (null);

    /**
     * ユーザーによる明示的な操作が発生したことを記録する関数
     */
    function markUserAction() {
        isUserAction = true;
        dismissAutoLocationToast(); // 手動操作が行われたら通知を消す

        if (userActionTimeout !== null) {
            clearTimeout(userActionTimeout);
        }
        // ズーム操作後の内部処理完了までの猶予時間
        userActionTimeout = window.setTimeout(() => {
            isUserAction = false;
            userActionTimeout = null;
        }, 1000);
    }

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
     * @typedef {object} GoogleMapListener
     * @property {() => void} remove
     */

    /**
     * @typedef {object} GoogleMap
     * @property {UnknownFunction} getCenter
     * @property {(eventName: string, handler: Function) => GoogleMapListener} addListener
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
     * @property {(listener: (value: LatLng) => unknown) => unknown} subscribe
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
     * @property {LatLng} [selectedLocation]
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

    const monitoredMaps = new WeakSet();
    /**
     * @param {GoogleMap} nativeMap
     */
    function bindMapUserActionEvents(nativeMap) {
        if (!nativeMap || monitoredMaps.has(nativeMap)) return;
        monitoredMaps.add(nativeMap);

        if (typeof nativeMap.addListener === "function") {
            nativeMap.addListener("dragstart", markUserAction);
            nativeMap.addListener("click", markUserAction);
        }
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
        markUserAction(); // ユーザー操作として記録

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new Error("有効な数値の緯度・経度を入力してください。");
        }

        const googleMaps = /** @type {WindowWithGoogle} */ (window).google
            ?.maps;
        if (!googleMaps)
            throw new Error("Google Maps APIが読み込まれていません。");

        const submitComponent = findRawSubmitComponent();
        const nativeMap = resolveMapFromComponent(submitComponent);
        if (nativeMap) {
            bindMapUserActionEvents(nativeMap);
        }

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

    // --- トースト通知 UI 管理 ---

    function dismissAutoLocationToast() {
        const toast = document.getElementById("custom-auto-location-toast");
        if (toast) {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(10px)";
            setTimeout(() => toast.remove(), 200);
        }
    }

    /**
     * @param {LatLng} loc
     */
    function showAutoLocationToast(loc) {
        dismissAutoLocationToast(); // 既存の通知があれば閉じる

        const toast = document.createElement("div");
        toast.id = "custom-auto-location-toast";
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            background: #d9534f;
            color: #ffffff;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
            font-size: 13px;
            line-height: 1.4;
            max-width: 320px;
            display: flex;
            align-items: flex-start;
            gap: 10px;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.2s ease, transform 0.2s ease;
            font-family: sans-serif;
        `;

        const coordsText =
            loc && typeof loc.lat === "number" && typeof loc.lng === "number"
                ? `<div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">（${loc.lat.toFixed(
                      6
                  )}, ${loc.lng.toFixed(6)}）</div>`
                : "";

        const content = document.createElement("div");
        content.style.flex = "1";
        content.innerHTML = `
            <strong>⚠️ 位置情報の自動設定を検出</strong>
            <div>座標が自動設定されました。意図した位置かご確認ください。</div>
            ${coordsText}
        `;

        const closeButton = document.createElement("button");
        closeButton.textContent = "✕";
        closeButton.style.cssText = `
            background: none;
            border: none;
            color: #ffffff;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            padding: 0 2px;
            line-height: 1;
            opacity: 0.8;
        `;
        closeButton.addEventListener("click", (e) => {
            e.stopPropagation();
            dismissAutoLocationToast();
        });

        toast.appendChild(content);
        toast.appendChild(closeButton);
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = "1";
            toast.style.transform = "translateY(0)";
        });
    }

    // --- 座標変更検知コアロジック ---

    /** @type {LatLng | null} */
    let lastKnownLocation = null;

    /**
     * @param {LatLng} loc
     */
    function handleLocationUpdate(loc) {
        if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number")
            return;

        const isSameAsLast =
            lastKnownLocation &&
            Math.abs(lastKnownLocation.lat - loc.lat) < 1e-7 &&
            Math.abs(lastKnownLocation.lng - loc.lng) < 1e-7;

        if (isSameAsLast) {
            return; // 同一座標の連打・初期重複イベントは無視
        }

        // 初回記録
        if (!lastKnownLocation) {
            lastKnownLocation = loc;
            return;
        }

        lastKnownLocation = loc;

        // ユーザー操作以外での更新時に通知
        if (!isUserAction) {
            showAutoLocationToast(loc);
        }
    }

    const subscribedComponents = new WeakSet();

    function watchAutoLocationChange() {
        const comp = findRawSubmitComponent();
        if (!comp) return;

        const nativeMap = resolveMapFromComponent(comp);
        if (nativeMap) {
            bindMapUserActionEvents(nativeMap);
        }

        if (!subscribedComponents.has(comp)) {
            subscribedComponents.add(comp);

            // 初期位置の記録
            if (comp.selectedLocation) {
                handleLocationUpdate(comp.selectedLocation);
            }

            // 1. Observable 監視 (スマホ版・一部イベント用)
            if (
                comp.locationSelected &&
                typeof comp.locationSelected.subscribe === "function"
            ) {
                comp.locationSelected.subscribe((loc) => {
                    handleLocationUpdate(loc);
                });
            }

            // 2. selectedLocation setter 横取り (PC版・直接代入対策)
            let val = comp.selectedLocation;
            Object.defineProperty(comp, "selectedLocation", {
                get() {
                    return val;
                },
                set(newVal) {
                    val = newVal;
                    handleLocationUpdate(newVal);
                },
                configurable: true,
                enumerable: true,
            });
        }
    }

    // --- 読み込み待ちガード UI ---

    function showLoadingGuard() {
        if (document.getElementById("custom-loading-guard-overlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "custom-loading-guard-overlay";
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(255, 255, 255, 0.4);
            z-index: 99999;
            pointer-events: all;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(1px);
        `;

        const banner = document.createElement("div");
        banner.style.cssText = `
            background: rgba(33, 33, 33, 0.85);
            color: #ffffff;
            padding: 10px 20px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
            letter-spacing: 0.5px;
        `;
        banner.textContent = "⏳ 自動設定待機中…";

        overlay.appendChild(banner);
        document.body.appendChild(overlay);
    }

    function removeLoadingGuard() {
        const overlay = document.getElementById("custom-loading-guard-overlay");
        if (overlay) {
            overlay.remove();
        }
    }

    // --- マップ操作誤作動防止用シールド機能 ---

    /**
     * @param {HTMLElement} mapContainer
     */
    function setupMapShield(mapContainer) {
        if (document.getElementById("custom-map-shield")) return;

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

        const relockButton = document.createElement("button");
        relockButton.id = "custom-map-relock-button";
        relockButton.textContent = "🔒 マップをロック";
        relockButton.style.cssText = `
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

        shield.addEventListener("click", (e) => {
            markUserAction();
            e.stopPropagation();
            shield.style.display = "none";
            relockButton.style.display = "block";
        });

        relockButton.addEventListener("click", (e) => {
            markUserAction();
            e.stopPropagation();
            shield.style.display = "flex";
            relockButton.style.display = "none";
        });

        mapContainer.appendChild(shield);
        mapContainer.appendChild(relockButton);
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

        const button = document.createElement("button");
        button.textContent = "移動";
        button.style.cssText = `
            padding: 4px 10px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        `;

        const applyCoordinate = () => {
            markUserAction();
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
        };

        button.addEventListener("click", applyCoordinate);

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applyCoordinate();
            }
        });

        const userEvents = [
            "pointerdown",
            "click",
            "wheel",
            "touchstart",
            "touchmove",
            "dblclick",
        ];
        userEvents.forEach((evtName) => {
            mapContainer.addEventListener(evtName, markUserAction, {
                capture: true,
                passive: true,
            });
        });

        container.appendChild(input);
        container.appendChild(button);

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

        // 1. URLチェック
        const hash = window.location.hash;
        if (!hash.includes("#data=")) return;

        // 2. ガード適用
        showLoadingGuard();

        try {
            const jsonStr = decodeURIComponent(
                hash.substring(hash.indexOf("#data=") + 6)
            );
            const data = JSON.parse(jsonStr);

            // 座標反映
            if (typeof data.lat === "number" && typeof data.lng === "number") {
                try {
                    markUserAction();
                    setPinCoordinate(data.lat, data.lng);
                    const coordInput = /** @type {HTMLInputElement} */ (
                        document.getElementById("custom-coord-input-field")
                    );
                    if (coordInput) {
                        coordInput.value = `${data.lat}, ${data.lng}`;
                    }
                } catch (e) {
                    console.warn("座標の設定を再試行します", e);
                    return;
                }
            }

            // テキスト入力領域
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

            // 3. 反映 & 解除
            autoFillProcessed = true;
            removeLoadingGuard();
        } catch (e) {
            console.error("ハッシュデータの解析に失敗しました:", e);
            autoFillProcessed = true;
            removeLoadingGuard();
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
            watchAutoLocationChange();
        }
        processHashData();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
