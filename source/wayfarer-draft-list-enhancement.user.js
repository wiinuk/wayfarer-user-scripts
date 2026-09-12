// ==UserScript==
// @name         Wayfarer Drafts List Enhancement
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Sort Niantic Wayfarer drafts using precise coordinates from API response
// @match        https://wayfarer.scopely.com/*
// @grant        none
// ==/UserScript==
//@ts-check

(function () {
    "use strict";

    const TARGET_PATH = "/new/submit";
    const EDIT_PATH = "/new/submit/new";
    const DRAFT_SUCCESS_PATH = "/new/submit/draft-success";

    // -------------------------------------------------------------------------
    // 自動保存機能の設定
    // -------------------------------------------------------------------------

    const autoSaveStorageKey = "wayfarer-draft-auto-save";

    /**
     * @typedef {{
     *   draftId: string,
     *   startedAt: number
     * }} AutoSaveState
     */

    /**
     * @returns {AutoSaveState | null}
     */
    function getAutoSaveState() {
        try {
            const value = sessionStorage.getItem(autoSaveStorageKey);
            if (!value) return null;

            const state = JSON.parse(value);

            if (
                !state ||
                typeof state.draftId !== "string" ||
                typeof state.startedAt !== "number"
            ) {
                return null;
            }

            // 10分以上経過した状態は古いものとして破棄
            if (Date.now() - state.startedAt > 10 * 60 * 1000) {
                sessionStorage.removeItem(autoSaveStorageKey);
                return null;
            }

            return state;
        } catch (e) {
            console.warn(
                "[Wayfarer Draft Sorter] Could not read auto-save state:",
                e
            );
            return null;
        }
    }

    /**
     * @param {string} draftId
     */
    function setAutoSaveState(draftId) {
        /** @type {AutoSaveState} */
        const state = {
            draftId,
            startedAt: Date.now(),
        };

        try {
            sessionStorage.setItem(autoSaveStorageKey, JSON.stringify(state));
        } catch (e) {
            console.warn(
                "[Wayfarer Draft Sorter] Could not save auto-save state:",
                e
            );
        }
    }

    function clearAutoSaveState() {
        try {
            sessionStorage.removeItem(autoSaveStorageKey);
        } catch (e) {
            console.warn(
                "[Wayfarer Draft Sorter] Could not clear auto-save state:",
                e
            );
        }
    }

    // -------------------------------------------------------------------------
    // 1. クラス名・プレフィックスの設定とスタイルの定義
    // -------------------------------------------------------------------------
    const classNamePrefix = "wf";
    const classNames = {
        styleId: `${classNamePrefix}-enhancement-styles`,
        btn: `${classNamePrefix}-btn`,
        btnSort: `${classNamePrefix}-btn-sort`,
        btnFilter: `${classNamePrefix}-btn-filter`,
        btnLocation: `${classNamePrefix}-btn-location`,
        btnAutoSave: `${classNamePrefix}-btn-auto-save`,
        btnAutoSaveProcessing: `${classNamePrefix}-btn-auto-save-processing`,
        locationBadge: `${classNamePrefix}-location-attested-badge`,
        locationAttested: `${classNamePrefix}-location-attested`,
        distanceBadge: `${classNamePrefix}-distance-badge`,
    };

    const globalStyles = `
        /* ソート・フィルターボタンの基本スタイル */
        .${classNames.btn} {
            margin-left: 8px;
            padding: 6px 12px;
            cursor: pointer;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: bold;
        }

        .${classNames.btnSort} {
            margin-left: 15px;
            background-color: #f53d00;
        }

        .${classNames.btnFilter} {
            background-color: #1976d2;
        }

        .${classNames.btnLocation} {
            background-color: #388e3c;
        }

        /* 位置認証ボタン */
        .${classNames.btnAutoSave} {
            margin-left: 10px;
            padding: 5px 10px;
            cursor: pointer;
            color: white;
            background-color: #7b1fa2;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
        }

        .${classNames.btnAutoSave}:hover {
            background-color: #6a1b9a;
        }

        .${classNames.btnAutoSaveProcessing} {
            opacity: 0.7;
            cursor: wait;
        }

        /* カード内バッジのスタイル */
        .${classNames.locationBadge} {
            display: none;
            align-items: center;
            justify-content: center;
            margin-left: 8px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #2e7d32;
            color: white;
            font-size: 12px;
            font-weight: bold;
            vertical-align: middle;
        }

        .${classNames.locationBadge}.${classNames.locationAttested} {
            display: inline-flex;
        }

        .${classNames.locationBadge}.${classNames.locationAttested}::before {
            content: "✓";
        }

        .${classNames.distanceBadge} {
            margin-left: 8px;
            font-size: 12px;
            color: #f53d00;
            font-weight: bold;
            background: #ffebeb;
            padding: 2px 6px;
            border-radius: 4px;
        }
    `;

    function injectStyles() {
        if (document.getElementById(classNames.styleId)) return;
        const styleElement = document.createElement("style");
        styleElement.id = classNames.styleId;
        styleElement.textContent = globalStyles;
        (document.head || document.documentElement).appendChild(styleElement);
    }

    function removeStyles() {
        const styleElement = document.getElementById(classNames.styleId);
        if (styleElement) styleElement.remove();
    }

    // -------------------------------------------------------------------------
    // 2. 型定義・状態管理
    // -------------------------------------------------------------------------

    /**
     * @typedef {Object} PoiItem
     * @property {string} id
     * @property {number} portalUserId
     * @property {number} creationTimestampMs
     * @property {number} updateCount
     * @property {number} lastModified
     * @property {string} title
     * @property {string} description
     * @property {string} supportingStatement
     * @property {number} lat
     * @property {number} lng
     * @property {string} mainImageGcsPath
     * @property {string} mainImageServingUrl
     * @property {string[]} supportingImageGcsPaths
     * @property {string[]} supportingImageServingUrls
     * @property {'PENDING' | 'ALLOW' | string} moderationStatus
     * @property {boolean} locationAttested
     * @property {string[]} allImageGcsPaths
     * @property {number} supportingImageCount
     * @property {string[]} allImageServingUrls
     */

    /**
     * @typedef {Object} ResponseResult
     * @property {PoiItem[]} result
     * @property {string} cursor
     */

    /**
     * @typedef {Object} DraftsResponse
     * @property {ResponseResult} result
     * @property {string|null} message
     * @property {string} code
     * @property {unknown} [errorsWithIcon]
     * @property {unknown} [fieldErrors]
     * @property {unknown} [errorDetails]
     * @property {string} version
     * @property {boolean} captcha
     */

    /** @type {Map<string, PoiItem>} */
    const draftMap = new Map();

    /** @type {'all' | 'ready' | 'not-ready'} */
    let draftFilterState = "all";

    /** @type {'all' | 'attested' | 'not-attested'} */
    let locationAttestedFilterState = "all";

    const draftStateStorageKey = "wayfarer-draft-list-state";
    const draftStateVersion = "3";

    /**
     * @typedef {{
     *   version: "3",
     *   filter: 'all' | 'ready' | 'not-ready',
     *   locationAttestedFilter: 'all' | 'attested' | 'not-attested',
     *   sortMode: 'unsorted' | 'distance' | 'last-modified',
     *   latitude?: number,
     *   longitude?: number
     * }} DraftListState
     */

    /** @type {DraftListState} */
    let draftSortState = {
        version: draftStateVersion,
        filter: "all",
        locationAttestedFilter: "all",
        sortMode: "unsorted",
    };

    /** @type {number | null} */
    let draftStateApplyTimer = null;

    let locationCheckInProgress = false;

    /** @type {MutationObserver | null} */
    let observer = null;

    /** @type {MutationObserver | null} */
    let saveButtonObserver = null;

    /** @type {number | null} */
    let saveButtonPollTimer = null;

    let isActive = false;

    try {
        /** @type {DraftListState | null} */
        const savedState = JSON.parse(
            localStorage.getItem(draftStateStorageKey) || "null"
        );

        if (savedState && savedState.version === draftStateVersion) {
            draftFilterState = savedState.filter;
            locationAttestedFilterState =
                savedState.locationAttestedFilter || "all";
            draftSortState = savedState;
        }
    } catch (e) {
        console.warn("[Wayfarer Draft Sorter] Could not restore state:", e);
    }

    function saveDraftState() {
        try {
            localStorage.setItem(
                draftStateStorageKey,
                JSON.stringify(draftSortState)
            );
        } catch (e) {
            console.warn("[Wayfarer Draft Sorter] Could not save state:", e);
        }
    }

    /**
     * @param {number} distance
     */
    function formatDistance(distance) {
        return distance < 1
            ? `${Math.round(distance * 1000)} m`
            : `${distance.toFixed(2)} km`;
    }

    /**
     * @param {HTMLButtonElement} sortButton
     */
    function checkCurrentLocation(sortButton) {
        if (
            draftSortState.sortMode !== "distance" ||
            draftSortState.latitude === undefined ||
            draftSortState.longitude === undefined ||
            locationCheckInProgress
        ) {
            return;
        }

        locationCheckInProgress = true;
        sortButton.innerText = "近い順（現在地を確認中...）";

        const sortLatitude = assertsNonNull(draftSortState.latitude);
        const sortLongitude = assertsNonNull(draftSortState.longitude);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                locationCheckInProgress = false;

                const distance = getDistance(
                    sortLatitude,
                    sortLongitude,
                    position.coords.latitude,
                    position.coords.longitude
                );

                sortButton.innerText = `近い順（基準地点から約 ${formatDistance(
                    distance
                )}）`;
            },
            (error) => {
                locationCheckInProgress = false;
                sortButton.innerText = "近い順（現在地を取得できません）";

                console.warn(
                    "[Wayfarer Draft Sorter] Could not check current location:",
                    error
                );
            }
        );
    }

    function scheduleDraftStateApply() {
        if (!isActive) return;

        if (draftStateApplyTimer !== null) {
            window.clearTimeout(draftStateApplyTimer);
        }

        draftStateApplyTimer = window.setTimeout(() => {
            draftStateApplyTimer = null;

            if (!isActive) return;

            applyDraftFilter();

            if (draftSortState.sortMode === "distance") {
                if (
                    draftSortState.latitude === undefined ||
                    draftSortState.longitude === undefined
                ) {
                    return;
                }

                sortDraftCards(
                    draftSortState.latitude,
                    draftSortState.longitude,
                    "distance"
                );
            } else if (draftSortState.sortMode === "last-modified") {
                sortDraftCards(0, 0, "last-modified");
            } else {
                updateDraftCardBadges(0, 0, "unsorted");
            }

            addAutoSaveButtons();
        }, 100);
    }

    // -------------------------------------------------------------------------
    // 3. 距離計算
    // -------------------------------------------------------------------------

    /**
     * @param {number} lat1
     * @param {number} lon1
     * @param {number} lat2
     * @param {number} lon2
     */
    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(dLon / 2) *
                Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * @template T
     * @param {T} value
     */
    function assertsNonNull(value) {
        if (value == null) throw new Error("value is null");
        return value;
    }

    // -------------------------------------------------------------------------
    // 4. カードのバッジ
    // -------------------------------------------------------------------------

    /**
     * @param {number} userLat
     * @param {number} userLon
     * @param {'distance' | 'last-modified' | 'unsorted'} sortMode
     */
    function updateDraftCardBadges(userLat, userLon, sortMode) {
        const draftCards = Array.from(
            document.querySelectorAll("app-submission-card")
        );

        draftCards.forEach((draftCard) => {
            const draftId = getDraftIdForCard(draftCard);
            const draft = draftId ? draftMap.get(draftId) : undefined;
            if (!draft) return;

            const title = draftCard.querySelector(".submission-title");
            if (!title) return;

            let locationBadge = /** @type {HTMLElement | null} */ (
                draftCard.querySelector(`.${classNames.locationBadge}`)
            );

            if (!locationBadge) {
                locationBadge = document.createElement("span");
                locationBadge.className = classNames.locationBadge;
                title.prepend(locationBadge);
            }

            const isAttested = Boolean(draft.locationAttested);

            locationBadge.classList.toggle(
                classNames.locationAttested,
                isAttested
            );

            if (sortMode === "distance") {
                let distBadge = /** @type {HTMLElement | null} */ (
                    draftCard.querySelector(`.${classNames.distanceBadge}`)
                );

                if (!distBadge) {
                    distBadge = document.createElement("span");
                    distBadge.className = classNames.distanceBadge;
                    title.appendChild(distBadge);
                }

                const distance =
                    draft.lat !== undefined && draft.lng !== undefined
                        ? getDistance(userLat, userLon, draft.lat, draft.lng)
                        : Infinity;

                const distanceLabel =
                    distance !== Infinity
                        ? `約 ${distance.toFixed(2)} km`
                        : "位置不明";

                if (distBadge.innerText !== distanceLabel) {
                    distBadge.innerText = distanceLabel;
                }
            }
        });
    }

    // -------------------------------------------------------------------------
    // 5. ソート
    // -------------------------------------------------------------------------

    /**
     * @param {number} userLat
     * @param {number} userLon
     * @param {'distance' | 'last-modified'} sortMode
     * @returns {boolean}
     */
    function sortDraftCards(userLat, userLon, sortMode) {
        const draftCards = Array.from(
            document.querySelectorAll("app-submission-card")
        );

        /** @type {{element: HTMLElement, title: string, distance: number, lastModified: number}[]} */
        const cardItems = [];

        draftCards.forEach((draftCard) => {
            const draftId = getDraftIdForCard(draftCard);
            const draft = draftId ? draftMap.get(draftId) : undefined;
            if (!draft) return;

            cardItems.push({
                element: /** @type {HTMLElement} */ (draftCard),
                title: draft.title,
                distance:
                    sortMode === "distance" &&
                    draft.lat !== undefined &&
                    draft.lng !== undefined
                        ? getDistance(userLat, userLon, draft.lat, draft.lng)
                        : Infinity,
                lastModified:
                    typeof draft.lastModified === "number"
                        ? draft.lastModified
                        : Infinity,
            });
        });

        if (cardItems.length === 0) return false;

        cardItems.sort((a, b) =>
            sortMode === "distance"
                ? a.distance - b.distance
                : b.lastModified - a.lastModified
        );

        const parent = cardItems[0]?.element.parentElement;
        if (!parent) return false;

        const needsReorder = cardItems.some(
            (item, index) => parent.children[index] !== item.element
        );

        cardItems.forEach((item) => {
            if (needsReorder) {
                parent.appendChild(item.element);
            }
        });

        updateDraftCardBadges(userLat, userLon, sortMode);

        return true;
    }

    // -------------------------------------------------------------------------
    // 6. APIから下書きを取得
    // -------------------------------------------------------------------------

    /**
     * @param {DraftsResponse} data
     */
    function loadDraftCoordinates(data) {
        if (data && data.result && Array.isArray(data.result.result)) {
            data.result.result.forEach((item) => {
                if (item.id) {
                    draftMap.set(item.id, item);
                }
            });

            scheduleDraftStateApply();

            console.log("[Wayfarer Draft Sorter] Drafts loaded:", draftMap);
        }
    }

    // fetchフック
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);

        if (!isActive) return response;

        const url =
            typeof args[0] === "string"
                ? args[0]
                : args[0] instanceof URL
                ? String(args[0])
                : args[0].url;

        if (url && url.includes("/api/v1/vault/submit/get/drafts")) {
            try {
                const clone = response.clone();

                /** @type {DraftsResponse} */
                const data = await clone.json();

                loadDraftCoordinates(data);
            } catch (e) {
                console.error(
                    "[Wayfarer Draft Sorter] Error parsing API response:",
                    e
                );
            }
        }

        return response;
    };

    // XHRフック
    /** @type {WeakMap<XMLHttpRequest, string>} */
    const xhrUrls = new WeakMap();

    const originalXhrOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (/** @type {any} */ ...args) {
        xhrUrls.set(this, String(args[1]));
        return originalXhrOpen.apply(this, args);
    };

    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.send = function (/** @type {any} */ ...args) {
        this.addEventListener("load", () => {
            if (!isActive) return;

            const url = xhrUrls.get(this);

            if (!url || !url.includes("/api/v1/vault/submit/get/drafts")) {
                return;
            }

            try {
                const data =
                    this.responseType === "json"
                        ? this.response
                        : JSON.parse(this.responseText);

                loadDraftCoordinates(data);
            } catch (e) {
                console.error(
                    "[Wayfarer Draft Sorter] Error parsing XHR response:",
                    e
                );
            }
        });

        return originalXhrSend.apply(this, args);
    };

    // -------------------------------------------------------------------------
    // 7. Angular内部から下書きIDを取得
    // -------------------------------------------------------------------------

    /**
     * @typedef {Object} ContextMatch
     * @property {string} path
     * @property {string} value
     */

    /**
     * @param {unknown} value
     * @param {string} path
     * @param {string} id
     * @param {ContextMatch[]} matches
     * @param {WeakSet<object>} visited
     * @param {{nodes: number}} state
     * @param {number} depth
     */
    function inspectValue(value, path, id, matches, visited, state, depth) {
        if (state.nodes >= 50000 || depth > 8 || value == null) {
            return;
        }

        if (typeof value === "string") {
            if (value === id) {
                matches.push({
                    path,
                    value: value.slice(0, 500),
                });
            }

            return;
        }

        if (typeof value !== "object" && typeof value !== "function") {
            return;
        }

        if (visited.has(value)) return;

        visited.add(value);
        state.nodes++;

        if (Array.isArray(value)) {
            value.forEach((item, index) => {
                inspectValue(
                    item,
                    `${path}[${index}]`,
                    id,
                    matches,
                    visited,
                    state,
                    depth + 1
                );
            });

            return;
        }

        Object.keys(value).forEach((key) => {
            let child;

            try {
                child = /** @type {Record<string, unknown>} */ (value)[key];
            } catch (e) {
                return;
            }

            inspectValue(
                child,
                `${path}.${key}`,
                id,
                matches,
                visited,
                state,
                depth + 1
            );
        });
    }

    /**
     * @param {Element} element
     * @returns {string | undefined}
     */
    function getDraftIdForCard(element) {
        const card = element.closest("app-submission-card");
        if (!card) return undefined;

        const context = /** @type {WithContext<typeof card>} */ (card)
            .__ngContext__;

        if (!context) return undefined;

        if (
            typeof context === "object" &&
            "23" in context &&
            typeof context[23] === "object" &&
            context[23] != null &&
            "id" in context[23] &&
            typeof context[23].id === "string"
        ) {
            return context[23].id;
        }

        for (const id of draftMap.keys()) {
            /** @type {ContextMatch[]} */
            const matches = [];

            /** @type {WeakSet<object>} */
            const visited = new WeakSet();

            inspectValue(
                context,
                "__ngContext__",
                id,
                matches,
                visited,
                { nodes: 0 },
                0
            );

            if (matches.length > 0) {
                return id;
            }
        }

        return undefined;
    }

    // TypeScriptチェック用
    /**
     * @template T
     * @typedef {T & { readonly __ngContext__?: unknown }} WithContext
     */

    // -------------------------------------------------------------------------
    // 8. フィルター
    // -------------------------------------------------------------------------

    function applyDraftFilter() {
        document
            .querySelectorAll("app-submission-card")
            .forEach((draftCard) => {
                const card = /** @type {HTMLElement} */ (draftCard);

                const draftId = getDraftIdForCard(draftCard);
                const draft = draftId ? draftMap.get(draftId) : undefined;

                if (!draft) return;

                const readiness = Boolean(
                    (draft.mainImageGcsPath || draft.mainImageServingUrl) &&
                        ((draft.supportingImageGcsPaths &&
                            draft.supportingImageGcsPaths.length > 0) ||
                            (draft.supportingImageServingUrls &&
                                draft.supportingImageServingUrls.length > 0)) &&
                        typeof draft.title === "string" &&
                        draft.title.trim().length > 0 &&
                        typeof draft.description === "string" &&
                        draft.description.trim().length > 0
                );

                const readinessHide =
                    draftFilterState !== "all" &&
                    (draftFilterState === "ready") !== readiness;

                const isAttested = Boolean(draft.locationAttested);

                const locationAttestedHide =
                    locationAttestedFilterState !== "all" &&
                    (locationAttestedFilterState === "attested") !== isAttested;

                const shouldHide = readinessHide || locationAttestedHide;

                if (card.hidden !== shouldHide) {
                    card.hidden = shouldHide;
                }
            });
    }

    function getDraftFilterLabel() {
        if (draftFilterState === "ready") return "準備完了";
        if (draftFilterState === "not-ready") return "不可";
        return "すべて";
    }

    function getLocationAttestedFilterLabel() {
        if (locationAttestedFilterState === "attested") return "確認済";

        if (locationAttestedFilterState === "not-attested") return "未確認";

        return "すべて";
    }

    function getSortModeLabel() {
        if (draftSortState.sortMode === "distance") return "近い順";

        if (draftSortState.sortMode === "last-modified")
            return "最近変更した順";

        return "並び替えない";
    }

    // -------------------------------------------------------------------------
    // 9. 追加機能：選択した下書きを何も変更せず保存
    // -------------------------------------------------------------------------

    /**
     * 下書きカードに「位置認証」ボタンを追加する。
     */
    function addAutoSaveButtons() {
        const draftCards = Array.from(
            document.querySelectorAll(".submission-card")
        );

        draftCards.forEach((draftCard) => {
            const card = /** @type {HTMLElement} */ (draftCard);

            // すでに追加済みなら何もしない
            if (card.querySelector(`.${classNames.btnAutoSave}`)) {
                return;
            }

            const draftId = getDraftIdForCard(card);

            if (!draftId) return;

            const draft = draftMap.get(draftId);
            if (!draft) return;

            // 既に位置認証（位置確認）済みの場合はボタンを表示しない
            if (draft.locationAttested) {
                return;
            }

            const title = draftCard.querySelector(".submission-title");
            if (!title) return;

            const button = document.createElement("button");

            button.type = "button";
            button.className = classNames.btnAutoSave;
            button.textContent = "位置認証";
            button.title = "この下書きを変更せずに保存して位置認証します";

            button.addEventListener("click", (event) => {
                // カード自体のクリックイベントを発火させない
                event.preventDefault();
                event.stopPropagation();

                startDraftAutoSave(card, draftId, button);
            });

            title.prepend(button);
        });
    }

    /**
     * @param {HTMLElement} card
     * @param {string} draftId
     * @param {HTMLButtonElement} button
     */
    function startDraftAutoSave(card, draftId, button) {
        const existingState = getAutoSaveState();

        if (existingState) {
            alert("すでに別の下書きの自動保存処理が進行中です。");
            return;
        }

        setAutoSaveState(draftId);

        button.disabled = true;
        button.textContent = "編集画面へ移動中...";
        button.classList.add(classNames.btnAutoSaveProcessing);

        console.log("[Wayfarer Draft Sorter] Starting draft auto-save:", {
            draftId,
            title: draftMap.get(draftId)?.title || "(unknown)",
        });

        /*
         * 元々の app-submission-card のクリック処理を利用する。
         *
         * setTimeout を入れることで、このボタン自身の click イベント
         * が Angular 側のカード処理に干渉する可能性を下げる。
         */
        window.setTimeout(() => {
            if (!document.contains(card)) {
                clearAutoSaveState();
                alert("下書きカードが見つからなくなりました。");
                return;
            }

            card.click();
        }, 50);
    }

    /**
     * 編集画面で「変更を保存」ボタンが有効になるのを待つ。
     */
    function startWaitingForSaveButton() {
        stopWaitingForSaveButton();

        const state = getAutoSaveState();

        if (!state) {
            console.log(
                "[Wayfarer Draft Sorter] No auto-save operation pending."
            );
            return;
        }

        console.log("[Wayfarer Draft Sorter] Waiting for save button...");

        let clicked = false;

        const tryClickSaveButton = () => {
            if (clicked) return;

            const button = /** @type {HTMLButtonElement | null} */ (
                document.querySelector("button.save-draft-button")
            );

            if (!button) return;

            /*
             * Angular側が disabled 属性を解除するまで待つ。
             *
             * :disabled だけでなく button.disabled も確認する。
             */
            if (button.disabled) {
                return;
            }

            // 念のため表示状態も確認
            const style = window.getComputedStyle(button);

            if (style.display === "none" || style.visibility === "hidden") {
                return;
            }

            clicked = true;

            console.log(
                "[Wayfarer Draft Sorter] Save button is enabled. Clicking it."
            );

            button.click();

            stopWaitingForSaveButton();
        };

        // 現在すでにボタンが存在していて有効な場合
        tryClickSaveButton();

        if (clicked) return;

        /*
         * 編集画面では現在地取得などによって Angular が
         * disabled 属性を動的に変更するため MutationObserver を使用。
         */
        saveButtonObserver = new MutationObserver(() => {
            tryClickSaveButton();
        });

        saveButtonObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["disabled", "class", "style"],
        });

        /*
         * MutationObserverだけでは拾いにくいケースに備えて
         * 軽いポーリングも併用する。
         */
        saveButtonPollTimer = window.setInterval(() => {
            tryClickSaveButton();
        }, 250);
    }

    function stopWaitingForSaveButton() {
        if (saveButtonObserver) {
            saveButtonObserver.disconnect();
            saveButtonObserver = null;
        }

        if (saveButtonPollTimer !== null) {
            window.clearInterval(saveButtonPollTimer);
            saveButtonPollTimer = null;
        }
    }

    /**
     * 自動保存成功画面に到達したら下書き一覧へ戻す。
     */
    function handleDraftSuccessPage() {
        const state = getAutoSaveState();

        if (!state) {
            return;
        }

        console.log(
            "[Wayfarer Draft Sorter] Draft saved successfully. Returning to draft list."
        );

        /*
         * 少し待ってから一覧へ戻す。
         *
         * 成功画面の描画を完了させてから遷移するため。
         */
        window.setTimeout(() => {
            clearAutoSaveState();

            /*
             * Angular Router を使わず URL を直接指定。
             */
            window.location.href = "https://wayfarer.scopely.com/new/submit";
        }, 300);
    }

    // -------------------------------------------------------------------------
    // 10. ソート・フィルターボタン
    // -------------------------------------------------------------------------

    function addSortButton() {
        if (document.getElementById("sort-drafts-btn")) return;

        const headers = Array.from(document.querySelectorAll("h2, h3"));

        const draftHeader = headers.find((el) =>
            el.textContent.includes("下書き")
        );

        if (!draftHeader) return;

        const btn = document.createElement("button");
        btn.id = "sort-drafts-btn";
        btn.classList.add(classNames.btn, classNames.btnSort);
        btn.innerText = getSortModeLabel();
        draftHeader.appendChild(btn);

        const filterBtn = document.createElement("button");
        filterBtn.id = "filter-drafts-btn";
        filterBtn.classList.add(classNames.btn, classNames.btnFilter);
        filterBtn.innerText = `提出: ${getDraftFilterLabel()}`;
        draftHeader.appendChild(filterBtn);

        const locFilterBtn = document.createElement("button");

        locFilterBtn.id = "filter-location-attested-btn";

        locFilterBtn.classList.add(classNames.btn, classNames.btnLocation);

        locFilterBtn.innerText = `位置: ${getLocationAttestedFilterLabel()}`;

        draftHeader.appendChild(locFilterBtn);

        if (draftSortState.sortMode === "distance") {
            checkCurrentLocation(btn);
        }

        filterBtn.addEventListener("click", () => {
            draftFilterState =
                draftFilterState === "all"
                    ? "ready"
                    : draftFilterState === "ready"
                    ? "not-ready"
                    : "all";

            draftSortState.filter = draftFilterState;
            saveDraftState();

            filterBtn.innerText = `提出: ${getDraftFilterLabel()}`;

            applyDraftFilter();
        });

        locFilterBtn.addEventListener("click", () => {
            locationAttestedFilterState =
                locationAttestedFilterState === "all"
                    ? "attested"
                    : locationAttestedFilterState === "attested"
                    ? "not-attested"
                    : "all";

            draftSortState.locationAttestedFilter = locationAttestedFilterState;

            saveDraftState();

            locFilterBtn.innerText = `位置: ${getLocationAttestedFilterLabel()}`;

            applyDraftFilter();
        });

        btn.addEventListener("click", () => {
            if (draftSortState.sortMode === "distance") {
                sortDraftCards(0, 0, "last-modified");

                draftSortState = {
                    ...draftSortState,
                    sortMode: "last-modified",
                };

                saveDraftState();

                btn.innerText = getSortModeLabel();

                return;
            }

            if (draftSortState.sortMode === "last-modified") {
                draftSortState = {
                    ...draftSortState,
                    sortMode: "unsorted",
                };

                saveDraftState();

                btn.innerText = getSortModeLabel();

                return;
            }

            btn.innerText = "位置情報を取得中...";

            btn.disabled = true;

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const userLat = pos.coords.latitude;

                    const userLon = pos.coords.longitude;

                    if (!sortDraftCards(userLat, userLon, "distance")) {
                        alert(
                            "ソート対象の下書きが見つかりませんでした。ページを更新して再試行してください。"
                        );

                        btn.innerText = getSortModeLabel();

                        btn.disabled = false;

                        return;
                    }

                    draftSortState = {
                        ...draftSortState,
                        sortMode: "distance",
                        latitude: userLat,
                        longitude: userLon,
                    };

                    saveDraftState();

                    btn.innerText = `近い順（基準地点から約 ${formatDistance(
                        0
                    )}）`;

                    btn.disabled = false;
                },
                (err) => {
                    alert("位置情報の取得に失敗しました: " + err.message);

                    btn.innerText = getSortModeLabel();

                    btn.disabled = false;
                }
            );
        });
    }

    // -------------------------------------------------------------------------
    // 11. UI削除
    // -------------------------------------------------------------------------

    function removeAddedUI() {
        [
            "sort-drafts-btn",
            "filter-drafts-btn",
            "filter-location-attested-btn",
        ].forEach((id) => {
            const el = document.getElementById(id);

            if (el) el.remove();
        });

        document
            .querySelectorAll(
                `.${classNames.locationBadge}, .${classNames.distanceBadge}, .${classNames.btnAutoSave}`
            )
            .forEach((el) => el.remove());
    }

    // -------------------------------------------------------------------------
    // 12. ライフサイクル
    // -------------------------------------------------------------------------

    function start() {
        if (isActive) return;

        isActive = true;

        injectStyles();
        addSortButton();
        addAutoSaveButtons();

        if (!observer) {
            observer = new MutationObserver(() => {
                if (!isActive) return;

                injectStyles();
                addSortButton();
                scheduleDraftStateApply();
                addAutoSaveButtons();
            });
        }

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    function stop() {
        if (!isActive) return;

        isActive = false;

        if (observer) {
            observer.disconnect();
        }

        if (draftStateApplyTimer !== null) {
            clearTimeout(draftStateApplyTimer);
            draftStateApplyTimer = null;
        }

        stopWaitingForSaveButton();

        draftMap.clear();

        removeAddedUI();
        removeStyles();
    }

    // -------------------------------------------------------------------------
    // 13. SPAルーティング変化
    // -------------------------------------------------------------------------

    function handleLocationChange() {
        const path = window.location.pathname;

        if (path === TARGET_PATH) {
            start();
            return;
        }

        if (path === EDIT_PATH) {
            stop();
            startWaitingForSaveButton();
            return;
        }

        if (path === DRAFT_SUCCESS_PATH) {
            stop();
            handleDraftSuccessPage();
            return;
        }

        stop();
    }

    const originalPushState = history.pushState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        handleLocationChange();
    };

    const originalReplaceState = history.replaceState;

    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        handleLocationChange();
    };

    window.addEventListener("popstate", handleLocationChange);

    // 初回実行
    handleLocationChange();
})();
