// ==UserScript==
// @name         Google Maps to Wayfarer Link Generator
// @namespace    http://tampermonkey.net/
// @version      1.3
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

    // Wayfarer用のURLを作成する関数
    /**
     * @param {string} name
     * @param {string} lat
     * @param {string} lng
     */
    function generateWayfarerUrl(name, lat, lng) {
        const dataObj = {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            title: name,
            save: true,
        };
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

    // UI要素（ボタン/リンク）を画面左下に設置・更新する関数
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
            const wayfarerUrl = generateWayfarerUrl(poi.name, poi.lat, poi.lng);
            // 既に表示中かつ内容が変わっていない場合は再描画しない（チラつき防止）
            if (container.dataset["currentUrl"] !== wayfarerUrl) {
                container.dataset["currentUrl"] = wayfarerUrl;
                container.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 4px;">Wayfarer リンク</div>
                    <a href="${wayfarerUrl}" target="_blank" rel="noopener noreferrer" style="color: #1a73e8; text-decoration: none; word-break: break-all;">
                        🚀 「${poi.name}」を下書きとして保存
                    </a>
                `;
            }
            container.style.display = "block";
        } else {
            container.dataset["currentUrl"] = "";
            container.style.display = "none";
        }
    }

    // 連続発火（負荷）を低減するためのデバウンス処理（requestAnimationFrameを利用）
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

    // 監視を開始
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true, // テキスト書き換え（タイトル確定時など）も検知
    });

    // 初回即時実行
    scheduleUpdate();
})();
