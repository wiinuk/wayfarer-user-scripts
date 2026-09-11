// ==UserScript==
// @name         Wayfarer Draft Submission Enhancement
// @namespace    https://github.com/
// @version      1.19
// @description  下書き座標を数値で指定。他アプリからの自動操作。誤操作防止用シールド。座標変更時のトースト通知。座標移動のUndo/Redo。
// @match        https://wayfarer.scopely.com/*
// @grant        none
// ==/UserScript==
//@ts-check
//spell-checker:words wayspot relock

(function () {
    "use strict";

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
     * @typedef {Object} TypeMap
     * @property {string} string
     * @property {number} number
     * @property {boolean} boolean
     * @property {symbol} symbol
     * @property {undefined} undefined
     * @property {Function} function
     * @property {object} object
     * @property {bigint} bigint
     */

    /**
     * @template T
     * @template {string} K
     * @template {keyof TypeMap} U
     * @param {T} value
     * @param {K} key
     * @param {U} typeName
     * @returns {value is T & Record<K, TypeMap[U]>}
     */
    function hasProperty(value, key, typeName) {
        return (
            typeof value === "object" &&
            value !== null &&
            key in value &&
            typeof (/** @type {Record<K, string>} */ (value)[key]) === typeName
        );
    }
    /**
     * @template T
     * @template {string} K
     * @param {T} value
     * @param {K} key
     * @returns {value is T & Record<K, string>}
     */
    function hasNonEmptyStringProperty(value, key) {
        return hasProperty(value, key, "string") && !!value[key];
    }

    // --- 座標履歴管理 (Undo / Redo) ---

    /** @type {LatLng[]} */
    const historyStack = [];
    let historyIndex = -1;
    let isProgrammaticMove = false; // Undo/Redo による自動移動中フラグ
    /** @type {LatLng | null} */
    let lastHistoryNavigationTarget = null;

    /**
     * 座標履歴に新しい座標を追加する
     * @param {LatLng} latLng
     */
    function pushHistory(latLng) {
        const current = historyStack[historyIndex];
        if (
            current &&
            Math.abs(current.lat - latLng.lat) < 1e-7 &&
            Math.abs(current.lng - latLng.lng) < 1e-7
        ) {
            return;
        }

        if (historyIndex < historyStack.length - 1) {
            historyStack.splice(historyIndex + 1);
        }

        historyStack.push({ lat: latLng.lat, lng: latLng.lng });
        historyIndex = historyStack.length - 1;
        updateUndoRedoButtons();
    }

    /**
     * Undo / Redo ボタンの有効/無効状態を更新
     */
    function updateUndoRedoButtons() {
        const undoBtn = /** @type {HTMLButtonElement | null} */ (
            document.getElementById("custom-coord-undo-btn")
        );
        const redoBtn = /** @type {HTMLButtonElement | null} */ (
            document.getElementById("custom-coord-redo-btn")
        );

        if (undoBtn) {
            undoBtn.disabled = historyIndex <= 0;
            undoBtn.style.opacity = undoBtn.disabled ? "0.4" : "1";
            undoBtn.style.cursor = undoBtn.disabled ? "not-allowed" : "pointer";
        }
        if (redoBtn) {
            redoBtn.disabled = historyIndex >= historyStack.length - 1;
            redoBtn.style.opacity = redoBtn.disabled ? "0.4" : "1";
            redoBtn.style.cursor = redoBtn.disabled ? "not-allowed" : "pointer";
        }
    }

    /**
     * 履歴上の指定位置へ移動する
     * @param {number} newIndex
     */
    function navigateHistory(newIndex) {
        if (newIndex < 0 || newIndex >= historyStack.length) return;
        if (newIndex === historyIndex) {
            updateUndoRedoButtons();
            return;
        }

        const target = historyStack[newIndex];
        if (!target) return;

        const previousIndex = historyIndex;
        historyIndex = newIndex;
        lastHistoryNavigationTarget = {
            lat: target.lat,
            lng: target.lng,
        };

        isProgrammaticMove = true;
        try {
            setPinCoordinate(target.lat, target.lng);
        } catch (err) {
            historyIndex = previousIndex;
            lastHistoryNavigationTarget = null;
            throw err;
        } finally {
            isProgrammaticMove = false;
        }

        updateUndoRedoButtons();
    }

    /**
     * 1つ前の座標に戻る
     */
    function undoCoordinate() {
        if (historyIndex > 0) {
            try {
                navigateHistory(historyIndex - 1);
            } catch (err) {
                alert(
                    "Undoエラー: " +
                        (err instanceof Error ? err.message : String(err))
                );
            }
        }
    }

    /**
     * 1つ後の座標に進む
     */
    function redoCoordinate() {
        if (historyIndex < historyStack.length - 1) {
            try {
                navigateHistory(historyIndex + 1);
            } catch (err) {
                alert(
                    "Redoエラー: " +
                        (err instanceof Error ? err.message : String(err))
                );
            }
        }
    }

    // --- 座標解析処理（度分秒対応） ---

    /**
     * 度分秒（DMS）または十進数の座標文字列を解析して { lat, lng } を返す
     * @param {string} input
     * @returns {LatLng | null}
     */
    function parseCoordinates(input) {
        const str = input.trim();

        const dmsPattern =
            /^\s*(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([NS])[\s,]+(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([EW])\s*$/i;
        const dmsMatch = str.match(dmsPattern);

        if (dmsMatch) {
            const latDeg = assertsNonNull(dmsMatch[1]);
            const latMin = assertsNonNull(dmsMatch[2]);
            const latSec = assertsNonNull(dmsMatch[3]);
            const latDir = assertsNonNull(dmsMatch[4]);
            const lngDeg = assertsNonNull(dmsMatch[5]);
            const lngMin = assertsNonNull(dmsMatch[6]);
            const lngSec = assertsNonNull(dmsMatch[7]);
            const lngDir = assertsNonNull(dmsMatch[8]);

            let lat =
                parseFloat(latDeg) +
                parseFloat(latMin) / 60 +
                parseFloat(latSec) / 3600;
            let lng =
                parseFloat(lngDeg) +
                parseFloat(lngMin) / 60 +
                parseFloat(lngSec) / 3600;

            if (latDir.toUpperCase() === "S") lat = -lat;
            if (lngDir.toUpperCase() === "W") lng = -lng;

            return { lat, lng };
        }

        const [lat, lng] = str.split(/[\s,]+/).map(parseFloat);
        if (
            lat !== undefined &&
            lng !== undefined &&
            !isNaN(lat) &&
            !isNaN(lng)
        ) {
            return { lat, lng };
        }

        return null;
    }

    // --- 地図・コンポーネント解析処理 ---

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

    // --- トースト通知機能 ---

    /**
     * 画面右下にトースト通知を表示する
     * @param {string} message
     */
    function showToast(message) {
        let container = document.getElementById("custom-toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "custom-toast-container";
            container.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 100000;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.style.cssText = `
            background: rgba(220, 38, 38, 0.9);
            color: #ffffff;
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
            pointer-events: auto;
        `;
        toast.textContent = message;
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = "1";
            toast.style.transform = "translateY(0)";
        });

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(10px)";
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // --- 座標変更の監視処理 ---

    let lastObservedCoord = "";
    /** @type {MutationObserver | null} */
    let coordObserver = null;
    /** @type {Element | null} */
    let observedElement = null;

    /**
     * @param {string} currentCoord
     */
    function handleCoordChange(currentCoord) {
        showToast(`📍 座標が更新されました:\n${currentCoord}`);
        const parsed = parseCoordinates(currentCoord);
        if (!parsed) return;

        if (isProgrammaticMove || lastHistoryNavigationTarget) {
            const target = lastHistoryNavigationTarget;
            if (
                target &&
                Math.abs(target.lat - parsed.lat) < 1e-7 &&
                Math.abs(target.lng - parsed.lng) < 1e-7
            ) {
                lastHistoryNavigationTarget = null;
            }
            return;
        }

        pushHistory(parsed);
    }

    function setupCoordObserver() {
        const targetElement = document.querySelector(
            ".submit-coordinates-text"
        );

        if (!targetElement) return;
        if (coordObserver && observedElement === targetElement) return;

        if (coordObserver) {
            coordObserver.disconnect();
        }

        observedElement = targetElement;
        lastObservedCoord = (targetElement.textContent || "").trim();

        if (lastObservedCoord) {
            const parsed = parseCoordinates(lastObservedCoord);
            if (parsed && historyStack.length === 0) {
                pushHistory(parsed);
            }
        }

        coordObserver = new MutationObserver(() => {
            const currentCoord = (targetElement.textContent || "").trim();
            if (currentCoord && currentCoord !== lastObservedCoord) {
                lastObservedCoord = currentCoord;
                handleCoordChange(currentCoord);
            }
        });

        coordObserver.observe(targetElement, {
            childList: true,
            characterData: true,
            subtree: true,
        });
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

    // --- マップ操作誤作動防止用オーバーレイ ---

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

        shield.addEventListener("click", (e) => {
            e.stopPropagation();
            shield.style.display = "none";
            relockBtn.style.display = "block";
        });

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

        const undoBtn = document.createElement("button");
        undoBtn.id = "custom-coord-undo-btn";
        undoBtn.textContent = "↩ ";
        undoBtn.title = "前の座標に戻る";
        undoBtn.style.cssText = `
      padding: 4px 8px;
      background: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;
        undoBtn.addEventListener("click", undoCoordinate);

        const redoBtn = document.createElement("button");
        redoBtn.id = "custom-coord-redo-btn";
        redoBtn.textContent = "↪ ";
        redoBtn.title = "次の座標に進む";
        redoBtn.style.cssText = `
      padding: 4px 8px;
      background: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;
        redoBtn.addEventListener("click", redoCoordinate);

        const input = document.createElement("input");
        input.id = "custom-coord-input-field";
        input.type = "text";
        input.placeholder = "35.6812, 139.7671 または 度分秒";
        input.style.cssText = `
      width: 200px;
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
    `;

        const btn = document.createElement("button");
        btn.textContent = "移動";
        btn.style.cssText = `
      padding: 4px 10px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    `;

        const applyCoordinate = () => {
            const rawValue = input.value;
            const parsed = parseCoordinates(rawValue);

            if (parsed) {
                try {
                    setPinCoordinate(parsed.lat, parsed.lng);
                } catch (err) {
                    alert(
                        "エラー: " +
                            (err instanceof Error ? err.message : String(err))
                    );
                }
            } else {
                alert(
                    "座標の形式が正しくありません。\n例1: 35.6812, 139.7671\n例2: 38°55'27.0\"N 140°20'08.0\"E"
                );
            }
        };

        btn.addEventListener("click", applyCoordinate);

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applyCoordinate();
            }
        });

        container.appendChild(undoBtn);
        container.appendChild(redoBtn);
        container.appendChild(input);
        container.appendChild(btn);

        if (getComputedStyle(mapContainer).position === "static") {
            mapContainer.style.position = "relative";
        }
        mapContainer.appendChild(container);

        updateUndoRedoButtons();
    }

    // --- フォーム入力・Angular連携処理 ---

    /**
     * @param {HTMLTextAreaElement} element
     * @param {string} value
     */
    function setInputValue(element, value) {
        if (!element) return;
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /**
     * @template {string} K
     * @param {Element | null} element
     * @param {unknown} data
     * @param {K} key
     */
    function trySetInputValue(element, data, key) {
        if (
            hasNonEmptyStringProperty(data, key) &&
            element instanceof HTMLTextAreaElement
        ) {
            setInputValue(element, data[key]);
        }
    }

    /**
     * SPAのページ遷移完了を監視してタブを閉じる
     */
    function waitForNavigationAndClose() {
        const initialUrl = window.location.href;

        const checkInterval = setInterval(() => {
            if (window.location.href !== initialUrl) {
                clearInterval(checkInterval);
                window.close();
            }
        }, 300);
    }

    let autoFillProcessed = false;

    function processHashData() {
        if (autoFillProcessed) return;

        const hash = window.location.hash;
        if (!hash.includes("#data=")) return;

        showLoadingGuard();

        try {
            const jsonStr = decodeURIComponent(
                hash.substring(hash.indexOf("#data=") + 6)
            );
            /** @type {unknown} */
            const data = JSON.parse(jsonStr);

            if (
                hasProperty(data, "lat", "number") &&
                hasProperty(data, "lng", "number")
            ) {
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
                    return;
                }
            }

            const nameInput = document.querySelector("textarea#title");
            const descInput = document.querySelector("textarea#description");
            const stmtInput = document.querySelector(
                "textarea#supportingStatement"
            );

            trySetInputValue(nameInput, data, "title");
            trySetInputValue(descInput, data, "description");
            trySetInputValue(stmtInput, data, "statement");

            autoFillProcessed = true;

            // save: true が指定されている場合の保存処理
            if (hasProperty(data, "save", "boolean") && data.save) {
                if (nameInput && nameInput instanceof HTMLTextAreaElement) {
                    if (!nameInput.value || nameInput.value.trim() === "") {
                        setInputValue(nameInput, "<empty>");
                    }
                }

                const saveBtn = /** @type {HTMLButtonElement | null} */ (
                    document.querySelector("button.save-draft-button")
                );

                if (saveBtn) {
                    saveBtn.click();
                    waitForNavigationAndClose();
                } else {
                    console.warn(
                        "「下書きとして保存」ボタンが見つかりませんでした。"
                    );
                }
            }

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
        }
        setupCoordObserver();
        processHashData();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
