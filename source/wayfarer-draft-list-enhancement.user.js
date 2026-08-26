// ==UserScript==
// @name         Wayfarer Drafts Precise Sorter by Distance
// @namespace    http://tampermonkey.net/
// @version      1.0
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

    const draftStateStorageKey = "wayfarer-draft-list-state";
    const draftStateVersion = "2";
    /**
     * @typedef {{version: "2", filter: 'all' | 'ready' | 'not-ready', sortMode: 'unsorted' | 'distance' | 'last-modified', latitude?: number, longitude?: number}} DraftListState
     */
    /** @type {DraftListState} */
    let draftSortState = {
        version: draftStateVersion,
        filter: "all",
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
        sortButton.innerText = "並び順: 距離順（現在地を確認中...）";
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
                sortButton.innerText = `並び順: 距離順（基準地点から約 ${formatDistance(
                    distance
                )}）`;
            },
            (error) => {
                locationCheckInProgress = false;
                sortButton.innerText =
                    "並び順: 距離順（現在地を取得できません）";
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
            if (draftFilterState !== "all") applyDraftFilter();
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
     * @typedef {{type?: string, path: string, value: string}} InvestigationMatch
     */

    /**
     * @typedef {{lat: number, lng: number}} DraftCoordinates
     */
    /**
     * @template T
     * @typedef {T & { readonly __ngContext__?: unknown }} WithContext
     */

    /**
     * @typedef {{id: string, matches: InvestigationMatch[]}} InvestigationResult
     */

    /**
     * @param {number} userLat
     * @param {number} userLon
     * @param {'distance' | 'last-modified'} sortMode
     * @returns {boolean}
     */
    function sortDraftCards(userLat, userLon, sortMode) {
        const h3Elements = Array.from(document.querySelectorAll("h3"));
        /** @type {{element: HTMLElement, title: string, distance: number, lastModified: number}[]} */
        const cardItems = [];

        h3Elements.forEach((h3) => {
            const title = h3.innerText.trim();
            const draftId = getDraftIdForCard(h3);
            const draft = draftId ? draftMap.get(draftId) : undefined;
            const cardContainer = getDraftCardContainer(h3);

            if (cardContainer == null) return;

            cardItems.push({
                element: cardContainer,
                title: title,
                distance:
                    sortMode === "distance" &&
                    draft &&
                    draft.lat !== undefined &&
                    draft.lng !== undefined
                        ? getDistance(userLat, userLon, draft.lat, draft.lng)
                        : Infinity,
                lastModified:
                    draft && typeof draft.lastModified === "number"
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

            if (sortMode === "distance") {
                /** @type {HTMLElement | null} */
                let distBadge = item.element.querySelector(".distance-badge");
                if (!distBadge) {
                    distBadge = document.createElement("span");
                    distBadge.className = "distance-badge";
                    distBadge.style.cssText =
                        "margin-left: 10px; font-size: 12px; color: #f53d00; font-weight: bold; background: #ffebeb; padding: 2px 6px; border-radius: 4px;";
                    const h3 = item.element.querySelector("h3");
                    if (h3) h3.appendChild(distBadge);
                }
                const distanceLabel =
                    item.distance !== Infinity
                        ? `約 ${item.distance.toFixed(2)} km`
                        : "位置不明";
                if (distBadge.innerText !== distanceLabel) {
                    distBadge.innerText = distanceLabel;
                }
            }
        });
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
            if (
                draftFilterState !== "all" ||
                (draftSortState.sortMode !== "unsorted" &&
                    draftSortState.latitude !== undefined &&
                    draftSortState.longitude !== undefined)
            ) {
                scheduleDraftStateApply();
            }
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
                // レスポンスをクローンして解読
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
     * @param {Element} element
     */
    function getElementPath(element) {
        /** @type {string[]} */
        const parts = [];
        /** @type {Element | null} */
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let part = current.tagName.toLowerCase();
            if (current.id) part += `#${current.id}`;
            if (current.classList.length > 0) {
                part += `.${Array.from(current.classList)
                    .slice(0, 2)
                    .join(".")}`;
            }
            parts.unshift(part);
            current = current.parentElement;
        }
        return parts.join(" > ");
    }

    /**
     * @param {unknown} value
     * @param {string} path
     * @param {string} id
     * @param {InvestigationMatch[]} matches
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
            /** @type {InvestigationMatch[]} */
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

    async function investigateDraftIds() {
        const ids = Array.from(draftMap.keys());
        /** @type {InvestigationResult[]} */
        const results = ids.map((id) => ({ id, matches: [] }));
        /** @type {Map<string, InvestigationResult>} */
        const resultById = new Map(
            results.map((result) => [result.id, result])
        );
        const elements = Array.from(document.querySelectorAll("*"));

        elements.forEach((element) => {
            const elementPath = getElementPath(element);
            const attributes = Array.from(element.attributes);
            ids.forEach((id) => {
                const result = resultById.get(id);
                if (!result) return;

                attributes.forEach((attribute) => {
                    if (attribute.value === id) {
                        result.matches.push({
                            type: "attribute",
                            path: `${elementPath}[@${attribute.name}]`,
                            value: attribute.value.slice(0, 500),
                        });
                    }
                });
                if (element.textContent === id) {
                    result.matches.push({
                        type: "textContent",
                        path: elementPath,
                        value: element.textContent.trim().slice(0, 500),
                    });
                }
                const elementWithContext =
                    /** @type {WithContext<typeof element>} */ (element);
                if (elementWithContext.__ngContext__) {
                    /** @type {WeakSet<object>} */
                    const visited = new WeakSet();
                    inspectValue(
                        elementWithContext.__ngContext__,
                        `${elementPath}.__ngContext__`,
                        id,
                        result.matches,
                        visited,
                        { nodes: 0 },
                        0
                    );
                }
            });
        });

        const report = {
            generatedAt: new Date().toISOString(),
            apiIds: ids,
            scannedElements: elements.length,
            results,
        };
        const reportText = JSON.stringify(report, null, 2);
        try {
            await navigator.clipboard.writeText(reportText);
            alert("ID調査結果をクリップボードにコピーしました。");
        } catch (e) {
            const textarea = document.createElement("textarea");
            textarea.value = reportText;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
            alert("ID調査結果をクリップボードにコピーしました。");
        }
        console.log("[Wayfarer Draft Sorter] ID investigation:", report);
    }

    /**
     * @param {Element} element
     * @returns {HTMLElement | null}
     */
    function getDraftCardContainer(element) {
        /** @type {HTMLElement | null} */
        let cardContainer =
            element.closest('div[class*="card"], div[class*="item"]') ||
            element.parentElement;

        if (cardContainer == null) return null;

        while (
            cardContainer.parentElement &&
            cardContainer.parentElement.children.length < 2
        ) {
            cardContainer = cardContainer.parentElement;
        }
        return cardContainer;
    }

    function applyDraftFilter() {
        document.querySelectorAll("h3").forEach((h3) => {
            const draftId = getDraftIdForCard(h3);
            const draft = draftId ? draftMap.get(draftId) : undefined;
            const readiness = draft
                ? Boolean(
                      (draft.mainImageGcsPath || draft.mainImageServingUrl) &&
                          ((draft.supportingImageGcsPaths &&
                              draft.supportingImageGcsPaths.length > 0) ||
                              (draft.supportingImageServingUrls &&
                                  draft.supportingImageServingUrls.length >
                                      0)) &&
                          typeof draft.title === "string" &&
                          draft.title.trim().length > 0 &&
                          typeof draft.description === "string" &&
                          draft.description.trim().length > 0
                  )
                : undefined;
            const cardContainer = getDraftCardContainer(h3);

            if (cardContainer == null || readiness === undefined) return;

            const shouldHide =
                draftFilterState !== "all" &&
                (draftFilterState === "ready") !== readiness;
            if (cardContainer.hidden !== shouldHide) {
                cardContainer.hidden = shouldHide;
            }
        });
    }

    function getDraftFilterLabel() {
        if (draftFilterState === "ready") return "準備完了";
        if (draftFilterState === "not-ready") return "不備";
        return "絞り込まない";
    }

    function getSortModeLabel() {
        if (draftSortState.sortMode === "distance") return "距離順";
        if (draftSortState.sortMode === "last-modified") return "最終更新順";
        return "未ソート";
    }

    // ソートボタンの追加と実行処理
    function addSortButton() {
        if (document.getElementById("sort-drafts-btn")) return;

        // 下書きヘッダー要素を検索
        const headers = Array.from(document.querySelectorAll("h2, h3"));
        const draftHeader = headers.find((el) =>
            el.textContent.includes("下書き")
        );

        if (!draftHeader) return;

        const btn = document.createElement("button");
        btn.id = "sort-drafts-btn";
        btn.innerText = `並び順: ${getSortModeLabel()}`;
        btn.style.cssText =
            "margin-left: 15px; padding: 6px 12px; cursor: pointer; background-color: #f53d00; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold;";

        draftHeader.appendChild(btn);

        const inspectBtn = document.createElement("button");
        inspectBtn.id = "inspect-draft-ids-btn";
        inspectBtn.innerText = "🔎 ID調査結果をコピー";
        inspectBtn.style.cssText =
            "margin-left: 8px; padding: 6px 12px; cursor: pointer; background-color: #444; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold;";
        draftHeader.appendChild(inspectBtn);
        inspectBtn.addEventListener("click", async () => {
            inspectBtn.disabled = true;
            inspectBtn.innerText = "調査中...";
            await investigateDraftIds();
            inspectBtn.innerText = "🔎 ID調査結果をコピー";
            inspectBtn.disabled = false;
        });

        const filterBtn = document.createElement("button");
        filterBtn.id = "filter-drafts-btn";
        filterBtn.innerText = `提出: ${getDraftFilterLabel()}`;
        filterBtn.style.cssText =
            "margin-left: 8px; padding: 6px 12px; cursor: pointer; background-color: #1976d2; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold;";
        draftHeader.appendChild(filterBtn);
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

        btn.addEventListener("click", () => {
            if (draftSortState.sortMode === "distance") {
                sortDraftCards(0, 0, "last-modified");
                draftSortState = {
                    ...draftSortState,
                    sortMode: "last-modified",
                };
                saveDraftState();
                btn.innerText = `並び順: ${getSortModeLabel()}`;
                return;
            }

            if (draftSortState.sortMode === "last-modified") {
                draftSortState = {
                    ...draftSortState,
                    sortMode: "unsorted",
                };
                saveDraftState();
                btn.innerText = `並び順: ${getSortModeLabel()}`;
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
                        btn.innerText = `並び順: ${getSortModeLabel()}`;
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

                    btn.innerText = `並び順: 距離順（基準地点から約 ${formatDistance(
                        0
                    )}）`;
                    btn.disabled = false;
                },
                (err) => {
                    alert("位置情報の取得に失敗しました: " + err.message);
                    btn.innerText = `並び順: ${getSortModeLabel()}`;
                    btn.disabled = false;
                }
            );
        });
    }

    // ページの動的描画に対応
    const observer = new MutationObserver(() => {
        addSortButton();
        if (
            draftFilterState !== "all" ||
            (draftSortState.sortMode !== "unsorted" &&
                draftSortState.latitude !== undefined &&
                draftSortState.longitude !== undefined)
        ) {
            scheduleDraftStateApply();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
