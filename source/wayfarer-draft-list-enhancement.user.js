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

    // APIから取得した下書きデータを保持するマップ (id または title -> {lat, lng})
    const draftCoordsMap = new Map();

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
     * @param {DraftsResponse} data
     */
    function loadDraftCoordinates(data) {
        if (data && data.result && Array.isArray(data.result.result)) {
            data.result.result.forEach((item) => {
                if (
                    item.title &&
                    item.lat !== undefined &&
                    item.lng !== undefined
                ) {
                    draftCoordsMap.set(item.title.trim(), {
                        lat: item.lat,
                        lng: item.lng,
                        id: item.id,
                    });
                }
            });
            console.log(
                "[Wayfarer Draft Sorter] Coordinates loaded:",
                draftCoordsMap
            );
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
        btn.innerText = "📍 現在地からの距離順に並び替え";
        btn.style.cssText =
            "margin-left: 15px; padding: 6px 12px; cursor: pointer; background-color: #f53d00; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: bold;";

        draftHeader.appendChild(btn);

        btn.addEventListener("click", () => {
            btn.innerText = "位置情報を取得中...";
            btn.disabled = true;

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const userLat = pos.coords.latitude;
                    const userLon = pos.coords.longitude;

                    // 下書きカード要素を取得
                    // <h3> を含み、下書き用UIカードとして存在しているコンテナを探す
                    const h3Elements = Array.from(
                        document.querySelectorAll("h3")
                    );
                    /** @type {{element: HTMLElement, title: string, distance: number}[]} */
                    const cardItems = [];

                    h3Elements.forEach((h3) => {
                        const title = h3.innerText.trim();
                        const coords = draftCoordsMap.get(title);

                        // h3の親方向へ遡って最も近いカードコンテナ要素を取得
                        /** @type {HTMLElement | null} */
                        let cardContainer =
                            h3.closest(
                                'div[class*="card"], div[class*="item"]'
                            ) || h3.parentElement;

                        if (cardContainer == null) return;

                        while (
                            cardContainer.parentElement &&
                            cardContainer.parentElement.children.length < 2
                        ) {
                            cardContainer = cardContainer.parentElement;
                        }

                        if (coords) {
                            const dist = getDistance(
                                userLat,
                                userLon,
                                coords.lat,
                                coords.lng
                            );
                            cardItems.push({
                                element: cardContainer,
                                title: title,
                                distance: dist,
                            });
                        } else {
                            cardItems.push({
                                element: cardContainer,
                                title: title,
                                distance: Infinity,
                            });
                        }
                    });

                    if (cardItems.length === 0) {
                        alert(
                            "ソート対象の下書きが見つかりませんでした。ページを更新して再試行してください。"
                        );
                        btn.innerText = "📍 現在地からの距離順に並び替え";
                        btn.disabled = false;
                        return;
                    }

                    // 距離が近い順（昇順）にソート
                    cardItems.sort((a, b) => a.distance - b.distance);

                    // DOM上の要素の並び順を並び替え＆距離ラベルの表示
                    const parent = assertsNonNull(
                        cardItems[0].element.parentElement
                    );
                    cardItems.forEach((item) => {
                        parent.appendChild(item.element);

                        // カード内に距離表記を挿入/更新
                        /** @type {HTMLElement | null} */
                        let distBadge =
                            item.element.querySelector(".distance-badge");
                        if (!distBadge) {
                            distBadge = document.createElement("span");
                            distBadge.className = "distance-badge";
                            distBadge.style.cssText =
                                "margin-left: 10px; font-size: 12px; color: #f53d00; font-weight: bold; background: #ffebeb; padding: 2px 6px; border-radius: 4px;";
                            const h3 = item.element.querySelector("h3");
                            if (h3) h3.appendChild(distBadge);
                        }
                        distBadge.innerText =
                            item.distance !== Infinity
                                ? `約 ${item.distance.toFixed(2)} km`
                                : "位置不明";
                    });

                    btn.innerText = "✅ ソート完了";
                    setTimeout(() => {
                        btn.innerText = "📍 現在地からの距離順に並び替え";
                        btn.disabled = false;
                    }, 2500);
                },
                (err) => {
                    alert("位置情報の取得に失敗しました: " + err.message);
                    btn.innerText = "📍 現在地からの距離順に並び替え";
                    btn.disabled = false;
                }
            );
        });
    }

    // ページの動的描画に対応
    const observer = new MutationObserver(() => {
        addSortButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
