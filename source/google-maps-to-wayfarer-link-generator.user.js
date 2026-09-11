// ==UserScript==
// @name         Google Maps to Wayfarer Link Generator
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  現在選択中のPOIの名称と座標からWayfarer申請用URLを生成・表示する
// @author       You
// @match        https://www.google.com/maps/*
// @match        https://www.google.co.jp/maps/*
// @grant        none
// ==/UserScript==
//@ts-check
//spell-checker: words Wayspot noopener noreferrer

(function () {
    "use strict";

    const STORAGE_KEY_CONFIG =
        "wayfarer_generator-11EBFDEA-0F6E-4D62-A01E-8A524E3F685A";
    const CURRENT_CONFIG_VERSION = "1";

    /**
     * @typedef {object} ScriptConfig
     * @property {"1"} version
     * @property {boolean} [autoSave]
     */

    // デフォルトの設定オブジェクト構造
    /** @type {Required<ScriptConfig>} */
    const DEFAULT_CONFIG = {
        version: CURRENT_CONFIG_VERSION,
        autoSave: true,
    };

    /**
     * ローカルストレージから設定を取得（バージョン差異がある場合はマイグレーション）
     * @returns {ScriptConfig}
     */
    function loadConfig() {
        try {
            const rawData = localStorage.getItem(STORAGE_KEY_CONFIG);
            if (!rawData) return DEFAULT_CONFIG;

            /** @type {unknown} */
            const parsed = JSON.parse(rawData);

            // バージョン情報がない、または古い構造の場合はマイグレーション・初期化を実施
            if (
                parsed == null ||
                typeof parsed !== "object" ||
                !("version" in parsed) ||
                typeof parsed.version !== "string"
            ) {
                return DEFAULT_CONFIG;
            }
            if (parsed.version !== CURRENT_CONFIG_VERSION) {
                return DEFAULT_CONFIG;
            }

            return {
                ...DEFAULT_CONFIG,
                .../** @type {ScriptConfig} */ (parsed),
            };
        } catch (e) {
            console.error("[Wayfarer Generator] Failed to load config:", e);
            return DEFAULT_CONFIG;
        }
    }

    /**
     * ローカルストレージに設定を保存
     * @param {ScriptConfig} config
     */
    function saveConfig(config) {
        try {
            // 保存前に必ず最新バージョンを強制割り当て
            config.version = CURRENT_CONFIG_VERSION;
            localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
        } catch (e) {
            console.error("[Wayfarer Generator] Failed to save config:", e);
        }
    }

    // Wayfarer用のURLを作成する関数
    /**
     * @param {string} name
     * @param {string} lat
     * @param {string} lng
     * @param {boolean} shouldSave
     */
    function generateWayfarerUrl(name, lat, lng, shouldSave) {
        /** @type {{lat: number, lng: number, title: string, save?: boolean}} */
        const dataObj = {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            title: name,
        };

        if (shouldSave) {
            dataObj.save = true;
        }

        const jsonString = JSON.stringify(dataObj);
        return `https://wayfarer.scopely.com/new/submit/new#data=${encodeURIComponent(
            jsonString
        )}`;
    }

    function getMyListDescriptionElement() {
        for (const e of document.querySelectorAll(
            '[role="main"] [role="region"] ~ [role="region"] button .fontBodySmall'
        )) {
            if (e instanceof HTMLElement && e.innerText !== "") return e;
        }
    }
    function getAddressElement() {
        for (const e of document.querySelectorAll(
            `[role="main"] [role="region"] ~ [role="region"] ~ * [role="button"] [role="img"].google-symbols ~ *`
        )) {
            if (e instanceof HTMLElement && e.innerText !== "") return e;
        }
    }

    function getPlaceNameFromUrl() {
        const path = window.location.pathname;
        const match = path.match(/\/place\/([^/]+)/);

        if (match && match[1]) {
            const rawName = match[1].replace(/\+/g, " ");
            try {
                return decodeURIComponent(rawName);
            } catch (e) {
                return rawName;
            }
        }
        return null;
    }
    /**
     * @param {string} title
     */
    function isDefaultTitle(title) {
        if (
            /^\s*\d+°\d+'\d+(?:\.\d+)?"[NS]\s+\d+°\d+'\d+(?:\.\d+)?"[EW]\s*$/.test(
                title
            )
        ) {
            return getPlaceNameFromUrl() === title;
        }

        const addressElement = getAddressElement();
        return addressElement && addressElement.innerText === title;
    }

    // URLから座標、DOMから名称を取得する関数
    function getSelectedPoiInfo() {
        const url = window.location.href;
        const latMatch = url.match(/!3d(-?\d+\.\d+)/);
        const lngMatch = url.match(/!4d(-?\d+\.\d+)/);

        const lat = latMatch ? latMatch[1] : null;
        const lng = lngMatch ? lngMatch[1] : null;

        const titleElement = [...document.querySelectorAll("h1")].at(-1);
        let name = titleElement?.innerText.trim();
        if (name != null && isDefaultTitle(name)) {
            const myDescriptionElement = getMyListDescriptionElement();
            if (myDescriptionElement) {
                name = myDescriptionElement.innerText.split("。")[0];
            }
        }

        if (name && lat && lng) {
            return { name, lat, lng };
        }
        return null;
    }

    // UI要素（ボタン/リンク/設定）を画面左下に設置・更新する関数
    function updateWayfarerButton() {
        const poi = getSelectedPoiInfo();
        let container = document.getElementById("wayfarer-link-container");

        if (!container) {
            container = document.createElement("div");
            container.id = "wayfarer-link-container";
            container.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 20px;
                z-index: 9999;
                background: #ffffff;
                padding: 10px 14px;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                font-family: Roboto, Arial, sans-serif;
                font-size: 13px;
                display: none;
            `;
            document.body.appendChild(container);
        }

        if (poi) {
            const config = loadConfig();
            const wayfarerUrl = generateWayfarerUrl(
                poi.name,
                poi.lat,
                poi.lng,
                config.autoSave ?? DEFAULT_CONFIG.autoSave
            );

            // 表示更新チェック用（URL・設定・バージョン情報からキャッシュキーを生成）
            const currentCacheKey = `${wayfarerUrl}_${config.autoSave}_v${config.version}`;

            if (container.dataset["cacheKey"] !== currentCacheKey) {
                container.dataset["cacheKey"] = currentCacheKey;
                container.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span>Wayfarer リンク</span>
                        <label style="font-weight: normal; font-size: 11px; cursor: pointer; color: #555;">
                            <input type="checkbox" id="wayfarer-auto-save-chk" ${
                                config.autoSave ? "checked" : ""
                            } style="vertical-align: middle; margin-right: 2px;">
                            自動保存
                        </label>
                    </div>
                    <a href="${wayfarerUrl}" target="_blank" rel="noopener noreferrer" style="color: #1a73e8; text-decoration: none; word-break: break-all;">
                        🚀 「${poi.name}」を開く
                    </a>
                `;

                // チェックボックスの変更イベントを登録
                const chk = document.getElementById("wayfarer-auto-save-chk");
                chk?.addEventListener("change", (e) => {
                    const target = /** @type {HTMLInputElement} */ (e.target);
                    const currentConfig = loadConfig();
                    currentConfig.autoSave = target.checked;
                    saveConfig(currentConfig);

                    // 設定更新後にUIを即時反映
                    updateWayfarerButton();
                });
            }
            container.style.display = "block";
        } else {
            container.dataset["cacheKey"] = "";
            container.style.display = "none";
        }
    }

    // 連続発火（負荷）を低減するためのデバウンス処理
    let isScheduled = false;
    function scheduleUpdate() {
        if (!isScheduled) {
            isScheduled = true;
            requestAnimationFrame(() => {
                updateWayfarerButton();
                isScheduled = false;
            });
        }
    }

    // 画面の変化（DOMの構築・更新）を監視
    const observer = new MutationObserver(() => {
        scheduleUpdate();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    scheduleUpdate();
})();
