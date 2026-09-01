// ==UserScript==
// @name         Wayfarer Submission: Wayspots Details
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Display Wayspots details
// @author       You
// @match        https://wayfarer.nianticlabs.com/new/submit/new
// @grant        none
// @run-at       document-start
// ==/UserScript==

//spell-checker: ignore wayspot Wayspots pois
//@ts-check

(() => {
    "use strict";

    /**
     * @param {TemplateStringsArray} message
     * @param  {...unknown} substitutions
     * @returns {never}
     */
    function raise(message, ...substitutions) {
        throw new Error(String.raw(message, ...substitutions));
    }
    /**
     * @param {unknown} e
     */
    function catchAsyncError(e) {
        console.error("Async Error:", e);
    }
    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * @template T
     * @param {() => T} getElement
     */
    async function awaitElement(getElement) {
        let currentInterval = 50;
        const maxInterval = 1000;
        while (true) {
            const element = getElement();
            if (element) {
                return element;
            }
            await sleep(currentInterval);
            currentInterval = Math.min(currentInterval * 1.5, maxInterval);
        }
    }
    function inject() {
        const originalOpen = XMLHttpRequest.prototype.open;

        /** @type {(this: XMLHttpRequest, method: string, url: string | URL, ...args: any[]) => void} */
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            if (
                method == "GET" &&
                url.toString().includes("/api/v1/vault/live-pois-in-radius")
            ) {
                this.addEventListener(
                    "load",
                    function () {
                        if (this.status >= 200 && this.status < 300) {
                            const urlObj = new URL(url, window.location.origin);
                            const params = {
                                lat: Number(urlObj.searchParams.get("lat")),
                                lng: Number(urlObj.searchParams.get("lng")),
                                radius: Number(
                                    urlObj.searchParams.get("radius")
                                ),
                            };
                            handleResults(params, this.response).catch(
                                catchAsyncError
                            );
                        }
                    },
                    false
                );
            }
            originalOpen.apply(
                this,
                /** @type {Parameters<typeof XMLHttpRequest.prototype.open>} */ ([
                    method,
                    url,
                    ...args,
                ])
            );
        };
    }
    /**
     * @param {{ lat: number, lng: number, radius: number }} params
     * @param {unknown} response
     */
    async function handleResults(params, response) {
        const mapElement = await awaitElement(() =>
            document.querySelector("app-submit-wayspot-map")
        );
        mapElement.after(createWayspotsDetailsElement(params, response));
    }
    /**
     * 2点の緯度経度から距離(メートル)を計算するヘルパー関数 (Haversine formula)
     * @param {number} lat1
     * @param {number} lng1
     * @param {number} lat2
     * @param {number} lng2
     * @returns {number}
     */
    function getDistance(lat1, lng1, lat2, lng2) {
        const R = 6371e3; // 地球の半径 (メートル)
        const φ1 = (lat1 * Math.PI) / 180;
        const φ2 = (lat2 * Math.PI) / 180;
        const Δφ = ((lat2 - lat1) * Math.PI) / 180;
        const Δλ = ((lng2 - lng1) * Math.PI) / 180;

        const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * @typedef {{ result: { pois: Array<{ guid: string, title: string, description: string, imageUrl: string, lat: number, lng: number }> } }} Response
     */

    /**
     * @param {{ lat: number, lng: number, radius: number }} params
     * @param {unknown} response
     * @returns {HTMLElement}
     */
    function createWayspotsDetailsElement(params, response) {
        const container = document.createElement("div");
        container.style.marginTop = "24px";
        container.style.padding = "16px";
        container.style.backgroundColor = "#fff";
        container.style.borderRadius = "8px";
        container.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
        container.style.fontFamily = "sans-serif";

        /** @type {Response} */
        let data;

        try {
            data =
                typeof response === "string" ? JSON.parse(response) : response;
        } catch (e) {
            container.textContent = "Error parsing Wayspots data.";
            return container;
        }

        if (
            !data ||
            !data.result ||
            !data.result.pois ||
            data.result.pois.length === 0
        ) {
            container.innerHTML = `<p style="color: #666;">半径 ${params.radius}m 以内に既存の Wayspot は見つかりませんでした。</p>`;
            return container;
        }

        const header = document.createElement("h3");
        header.textContent = `既存の Wayspot (${data.result.pois.length}件)`;
        header.style.margin = "0 0 10px 0";
        header.style.fontSize = "18px";
        container.appendChild(header);

        // テーブル作成
        const table = document.createElement("table");
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";
        table.style.fontSize = "13px";

        const thead = document.createElement("thead");
        thead.innerHTML = `
            <tr style="background-color: #f5f5f5; border-bottom: 2px solid #ddd;">
                <th style="padding: 8px; text-align: left; width: 60px;">画像</th>
                <th style="padding: 8px; text-align: left; width: 20%;">タイトル</th>
                <th style="padding: 8px; text-align: left;">説明</th>
                <th style="padding: 8px; text-align: right; width: 100px;">距離 / 座標</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement("tbody");

        for (const poi of data.result.pois) {
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid #eee";

            // 距離計算
            const dist = getDistance(params.lat, params.lng, poi.lat, poi.lng);

            // 画像セル
            const imgTd = document.createElement("td");
            imgTd.style.padding = "8px";
            if (poi.imageUrl) {
                const img = document.createElement("img");
                img.src = poi.imageUrl;
                img.style.width = "50px";
                img.style.height = "50px";
                img.style.objectFit = "cover";
                img.style.borderRadius = "4px";
                imgTd.appendChild(img);
            } else {
                imgTd.textContent = "No Img";
                imgTd.style.color = "#ccc";
                imgTd.style.fontSize = "10px";
            }
            tr.appendChild(imgTd);

            // タイトルセル
            const titleTd = document.createElement("td");
            titleTd.style.padding = "8px";
            titleTd.style.fontWeight = "bold";
            titleTd.textContent = poi.title || "(No Title)";
            tr.appendChild(titleTd);

            // 説明セル
            const descTd = document.createElement("td");
            descTd.style.padding = "8px";
            descTd.style.color = "#555";
            descTd.textContent = poi.description || "";
            tr.appendChild(descTd);

            // 距離セル
            const locTd = document.createElement("td");
            locTd.style.padding = "8px";
            locTd.style.textAlign = "right";
            locTd.style.whiteSpace = "nowrap";
            locTd.innerHTML = `
                <div style="font-weight:bold; color: #d9534f;">${Math.round(
                    dist
                )} m</div>
            `;

            // 座標セル
            const coordDiv = document.createElement("div");
            coordDiv.style.fontSize = "10px";
            coordDiv.style.color = "#888";
            coordDiv.textContent = `${poi.lat},${poi.lng}`;

            // クリックで座標コピー
            coordDiv.style.cursor = "pointer";
            coordDiv.addEventListener("click", () => {
                const coords = `${poi.lat},${poi.lng}`;
                navigator.clipboard
                    .writeText(coords)
                    .then(() => {
                        showToast(`座標（${coords}）をコピーしました`);
                    })
                    .catch(catchAsyncError);
            });

            locTd.appendChild(coordDiv);

            tr.appendChild(locTd);

            tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        container.appendChild(table);

        return container;
    }
    /**
     * @param {string} message
     */
    function showToast(message) {
        let toast = document.createElement("div");
        toast.textContent = message;
        toast.style.position = "fixed";
        toast.style.bottom = "24px";
        toast.style.left = "50%";
        toast.style.transform = "translateX(-50%)";
        toast.style.background = "rgba(60,60,60,0.9)";
        toast.style.color = "#fff";
        toast.style.padding = "10px 18px";
        toast.style.borderRadius = "6px";
        toast.style.fontSize = "14px";
        toast.style.zIndex = "99999";
        toast.style.transition = "opacity 0.35s";
        document.body.appendChild(toast);

        setTimeout(() => (toast.style.opacity = "0"), 1500);
        setTimeout(() => toast.remove(), 2000);
    }
    inject();
})();
