// ==UserScript==
// @name         Wayfarer Drafts List Enhancement
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Sort Niantic Wayfarer drafts using precise coordinates from API response
// @match        https://wayfarer.scopely.com/*
// @grant        none
// ==/UserScript==
//@ts-check

(function () {
    "use strict";

    /**
     * @typedef {Object} PoiItem
     * @property {string} id 例: "25927c35fdac4f79aa3a4fda03a2e788.1"
     * @property {number} portalUserId 例: 4756910530297856
     * @property {number} creationTimestampMs 例: 1787520908540
     * @property {number} updateCount 例: 2
     * @property {number} lastModified 例: 1787521140570
     * @property {string} title 例：タイトル
     * @property {string} description 例：説明
     * @property {string} supportingStatement 例：補足
     * @property {number} lat 例: 38.1
     * @property {number} lng 例: 140.2
     * @property {string} mainImageGcsPath 例: "gs://wayfarer-assets/poi-draft-images/….jpg"
     * @property {string} mainImageServingUrl 例: "https://lh3.googleusercontent.com/WzShgIt7glC3D6hqH..."
     * @property {string[]} supportingImageGcsPaths 例: ["gs://wayfarer-assets/poi-draft-images/..."]
     * @property {string[]} supportingImageServingUrls 例: ["https://lh3.googleusercontent.com/..."]
     * @property {'PENDING' | 'ALLOW' | string} moderationStatus 例: "PENDING"
     * @property {boolean} locationAttested 例: false
     * @property {string[]} allImageGcsPaths 例: ["gs://wayfarer-assets/poi-draft-images/...", "..."]
     * @property {number} supportingImageCount 例: 1
     * @property {string[]} allImageServingUrls 例: ["https://lh3.googleusercontent.com/...", "..."]
     */

    /**
     * @typedef {Object} ResponseResult
     * @property {PoiItem[]} result
     * @property {string} cursor 例: "3"
     */

    /**
     * @typedef {Object} DraftsResponse
     * @property {ResponseResult} result
     * @property {string|null} message 例: null
     * @property {string} code 例: "OK"
     * @property {unknown} [errorsWithIcon]
     * @property {unknown} [fieldErrors]
     * @property {unknown} [errorDetails]
     * @property {string} version 例: "release-wayfarer-web-5-48-0-00238a34-Aug-24-15-52"
     * @property {boolean} captcha 例: false
     */

    // APIから取得した下書きデータを保持するマップ
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
        if (draftStateApplyTimer !== null) {
            window.clearTimeout(draftStateApplyTimer);
        }
        draftStateApplyTimer = window.setTimeout(() => {
            draftStateApplyTimer = null;
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
        }, 100);
    }

    // 2点間の直線距離（km）を計算する関数（Haversine formula）
    /**
     * @param {number} lat1
     * @param {number} lon1
     * @param {number} lat2
     * @param {number} lon2
     */
    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // 地球の半径 (km)
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

    /**
     * @template T
     * @typedef {T & { readonly __ngContext__?: unknown }} WithContext
     */

    /**
     * @typedef {{path: string, value: string}} ContextMatch
     */

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

            const h3 = draftCard.querySelector("h3");
            if (!h3) return;

            // locationAttested バッジの更新・表示
            let locationBadge = /** @type {HTMLElement | null} */ (
                draftCard.querySelector(".location-attested-badge")
            );
            if (!locationBadge) {
                locationBadge = document.createElement("span");
                locationBadge.className = "location-attested-badge";
                h3.appendChild(locationBadge);
            }

            const isAttested = Boolean(draft.locationAttested);

            if (isAttested) {
                locationBadge.style.cssText = `
                    display: inline-flex;
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
                `;
                locationBadge.innerText = "✓";
            } else {
                locationBadge.style.display = "none";
            }

            // 距離バッジの更新・表示
            if (sortMode === "distance") {
                let distBadge = /** @type {HTMLElement | null} */ (
                    draftCard.querySelector(".distance-badge")
                );
                if (!distBadge) {
                    distBadge = document.createElement("span");
                    distBadge.className = "distance-badge";
                    distBadge.style.cssText =
                        "margin-left: 8px; font-size: 12px; color: #f53d00; font-weight: bold; background: #ffebeb; padding: 2px 6px; border-radius: 4px;";
                    h3.appendChild(distBadge);
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
        const parent = assertsNonNull(cardItems[0].element.parentElement);
        const needsReorder = cardItems.some(
            (item, index) => parent.children[index] !== item.element
        );
        cardItems.forEach((item) => {
            if (needsReorder) parent.appendChild(item.element);
        });

        updateDraftCardBadges(userLat, userLon, sortMode);
        return true;
    }

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

    // fetchをフックしてAPIのレスポンスから正確な座標を取得
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
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

    // XMLHttpRequestをフックして、fetchを使わないAPIリクエストも処理
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
            const url = xhrUrls.get(this);
            if (!url || !url.includes("/api/v1/vault/submit/get/drafts"))
                return;

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
        if (state.nodes >= 50000 || depth > 8 || value == null) return;

        if (typeof value === "string") {
            if (value === id) {
                matches.push({ path, value: value.slice(0, 500) });
            }
            return;
        }
        if (typeof value !== "object" && typeof value !== "function") return;
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
            if (matches.length > 0) return id;
        }
        return undefined;
    }

    function applyDraftFilter() {
        document
            .querySelectorAll("app-submission-card")
            .forEach((draftCard) => {
                const card = /** @type {HTMLElement} */ (draftCard);
                const draftId = getDraftIdForCard(draftCard);
                const draft = draftId ? draftMap.get(draftId) : undefined;
                if (!draft) return;

                // 1. 提出準備状態チェック
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

                // 2. locationAttested チェック
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

    // ソート・フィルターボタンの追加
    function addSortButton() {
        if (document.getElementById("sort-drafts-btn")) return;

        const headers = Array.from(document.querySelectorAll("h2, h3"));
        const draftHeader = headers.find((el) =>
            el.textContent.includes("下書き")
        );

        if (!draftHeader) return;

        // ソートボタン
        const btn = document.createElement("button");
        btn.id = "sort-drafts-btn";
        btn.innerText = getSortModeLabel();
        btn.style.cssText =
            "margin-left: 15px; padding: 6px 12px; cursor: pointer; background-color: #f53d00; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold;";
        draftHeader.appendChild(btn);

        // 提出状態フィルターボタン
        const filterBtn = document.createElement("button");
        filterBtn.id = "filter-drafts-btn";
        filterBtn.innerText = `提出: ${getDraftFilterLabel()}`;
        filterBtn.style.cssText =
            "margin-left: 8px; padding: 6px 12px; cursor: pointer; background-color: #1976d2; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold;";
        draftHeader.appendChild(filterBtn);

        // locationAttested フィルターボタン
        const locFilterBtn = document.createElement("button");
        locFilterBtn.id = "filter-location-attested-btn";
        locFilterBtn.innerText = `位置: ${getLocationAttestedFilterLabel()}`;
        locFilterBtn.style.cssText =
            "margin-left: 8px; padding: 6px 12px; cursor: pointer; background-color: #388e3c; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold;";
        draftHeader.appendChild(locFilterBtn);

        if (draftSortState.sortMode === "distance") checkCurrentLocation(btn);

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

    // ページの動的描画に対応
    const observer = new MutationObserver(() => {
        addSortButton();
        scheduleDraftStateApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
