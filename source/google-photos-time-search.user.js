// ==UserScript==
// @name         Google Photos Time Search
// @namespace    https://github.com/wiinuk/wayfarer-user-scripts
// @version      1.0
// @description  撮影時刻を指定して最も近い写真までスクロールする
// @author       Wiinuk
// @match        https://photos.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//@ts-check

(function () {
    "use strict";

    const PANEL_ID = "google-photos-time-search";
    const PHOTO_SELECTOR = 'a[href*="/photo/"]:not([href*="/top/photo/"])';
    let targetDateTime = 0;
    let debugStartedAt = 0;
    /** @type {{targetTime: string|null, targetDate: string|null, phase: string, lastError: string|null, searchResultCount: number, inspectedPhotoIndexes: number[], events: Array<{elapsedMs: number, message: string}>}} */
    const debugState = {
        targetTime: null,
        targetDate: null,
        phase: "待機中",
        lastError: null,
        searchResultCount: 0,
        inspectedPhotoIndexes: [],
        events: [],
    };
    const ISO_DATE_TIME_PATTERN =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
    const PANEL_STYLE = [
        "position:fixed",
        "top:16px",
        "right:16px",
        "z-index:2147483647",
        "display:flex",
        "gap:6px",
        "padding:8px",
        "border-radius:8px",
        "background:#fff",
        "box-shadow:0 2px 12px #0004",
        "font:14px Arial,sans-serif",
    ].join(";");

    /**
     * @param {string} value
     */
    function parseTargetTime(value) {
        if (!ISO_DATE_TIME_PATTERN.test(value)) return null;
        const time = Date.parse(value);
        return Number.isFinite(time) ? time : null;
    }

    /**
     * @param {number} time
     */
    function getLocalDateQuery(time) {
        const date = new Date(time);
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
        ].join("-");
    }

    /**
     * @param {number} milliseconds
     */
    function delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    /**
     * @param {() => boolean} condition
     * @param {string} errorMessage
     */
    async function waitUntil(condition, errorMessage) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            if (condition()) return;
            await delay(100);
        }
        throw new Error(errorMessage);
    }

    /**
     * @param {string} message
     */
    function setStatus(message) {
        const status = document.querySelector(
            `#${PANEL_ID} [data-role="status"]`
        );
        if (status instanceof HTMLElement) status.textContent = message;
        debugState.phase = message;
        if (debugStartedAt) {
            debugState.events.push({
                elapsedMs: Date.now() - debugStartedAt,
                message,
            });
            if (debugState.events.length > 50) debugState.events.shift();
        }
    }

    /**
     * @param {boolean} disabled
     */
    function setSearchButtonDisabled(disabled) {
        const button = document.querySelector(
            `#${PANEL_ID} [data-role="search"]`
        );
        if (button instanceof HTMLButtonElement) button.disabled = disabled;
    }

    function getDebugInformation() {
        const searchInput = document.querySelector(
            'input[aria-label="写真やアルバムを検索"], input[role="combobox"]'
        );
        const route = location.pathname.includes("/photo/")
            ? "photo"
            : location.pathname.includes("/search/")
              ? "search"
              : "home-or-other";

        return {
            scriptVersion: "1.0",
            capturedAt: new Date().toISOString(),
            route,
            targetDate: debugState.targetDate,
            targetTime: debugState.targetTime,
            searchFieldText:
                searchInput instanceof HTMLInputElement
                    ? searchInput.value
                    : null,
            phase: debugState.phase,
            lastError: debugState.lastError,
            currentPhotoCardCount: getPhotoCards().length,
            topResultCardCount: document.querySelectorAll(
                'a[href*="/top/photo/"]'
            ).length,
            searchResultCount: debugState.searchResultCount,
            inspectedPhotoIndexes: debugState.inspectedPhotoIndexes,
            historyLength: history.length,
            events: debugState.events,
        };
    }

    /**
     * @param {HTMLButtonElement} button
     */
    async function copyDebugInformation(button) {
        button.disabled = true;
        try {
            const text = JSON.stringify(getDebugInformation(), null, 2);
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.cssText =
                    "position:fixed;left:-9999px;top:0;opacity:0;";
                document.body.appendChild(textArea);
                textArea.select();
                const copied = document.execCommand("copy");
                textArea.remove();
                if (!copied) {
                    throw new Error("クリップボードへのコピーに失敗しました。");
                }
            }
            setStatus(
                "デバッグ情報をコピーしました。内容を確認してチャットに貼り付けてください。"
            );
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? `デバッグ情報をコピーできませんでした: ${error.message}`
                    : "デバッグ情報をコピーできませんでした。"
            );
            console.error(
                "[Google Photos Time Search] Copying debug information failed:",
                error
            );
        } finally {
            button.disabled = false;
        }
    }

    /**
     * @param {string} date
     */
    async function searchDate(date) {
        const searchInput = document.querySelector(
            'input[aria-label="写真やアルバムを検索"], input[role="combobox"]'
        );
        if (!(searchInput instanceof HTMLInputElement)) {
            throw new Error("Google フォトの検索欄が見つかりません。");
        }

        const currentUrl = location.href;
        searchInput.focus();
        searchInput.select();
        const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
        )?.set;
        if (!valueSetter) {
            throw new Error("検索欄の値を設定できません。");
        }
        valueSetter.call(searchInput, date);
        searchInput.dispatchEvent(
            new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: date,
            })
        );
        searchInput.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
            })
        );
        searchInput.dispatchEvent(
            new KeyboardEvent("keyup", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
            })
        );

        await waitUntil(
            () =>
                location.pathname.includes("/search/") &&
                !location.pathname.includes("/photo/") &&
                document.title.includes(date) &&
                (location.href !== currentUrl || searchInput.value === date),
            "日付で検索できませんでした。検索欄から日付を検索してください。"
        );
        await delay(1200);
    }

    /**
     * @param {HTMLAnchorElement} card
     */
    function getScrollArea(card) {
        let element = card.parentElement;
        while (element && element !== document.body) {
            const style = getComputedStyle(element);
            if (
                element.scrollHeight > element.clientHeight &&
                /auto|scroll/.test(style.overflowY)
            ) {
                return element;
            }
            element = element.parentElement;
        }
        return document.scrollingElement;
    }

    function getPhotoCards() {
        /** @type {HTMLAnchorElement[]} */
        const cards = [];
        for (const element of document.querySelectorAll(PHOTO_SELECTOR)) {
            if (element instanceof HTMLAnchorElement) cards.push(element);
        }
        return cards;
    }

    async function loadPhotoResults() {
        const firstCard = getPhotoCards()[0];
        if (!firstCard) {
            await delay(1500);
            return [];
        }

        const scrollArea = getScrollArea(firstCard);
        if (!scrollArea) return getPhotoCards().map((card) => card.href);

        let previousCount = -1;
        let stagnantBottomPasses = 0;
        for (let pass = 0; pass < 1000; pass++) {
            const cards = getPhotoCards();
            const maxScrollTop = Math.max(
                0,
                scrollArea.scrollHeight - scrollArea.clientHeight
            );
            if (scrollArea.scrollTop >= maxScrollTop) {
                if (cards.length === previousCount) {
                    stagnantBottomPasses++;
                } else {
                    stagnantBottomPasses = 0;
                }
                if (stagnantBottomPasses >= 3) break;
            } else {
                stagnantBottomPasses = 0;
                scrollArea.scrollTo(
                    0,
                    Math.min(
                        scrollArea.scrollTop + scrollArea.clientHeight * 0.8,
                        maxScrollTop
                    )
                );
            }
            previousCount = cards.length;
            await delay(200);
        }

        const hrefs = [...new Set(getPhotoCards().map((card) => card.href))];
        scrollArea.scrollTo(0, 0);
        await delay(200);
        return hrefs;
    }

    function getCaptureTime() {
        const timeLabels = [...document.querySelectorAll("[aria-label]")]
            .map((element) => element.getAttribute("aria-label") || "")
            .filter((value) => /撮影時刻|time taken/i.test(value));
        const detailText = [...document.querySelectorAll("button")]
            .map((button) => button.textContent?.trim() || "")
            .filter((value) => /\d{1,2}:\d{2}/.test(value));
        const label =
            timeLabels.find((value) => /\d{1,2}:\d{2}/.test(value)) ||
            detailText.find((value) => /\d{1,2}:\d{2}/.test(value)) ||
            "";
        if (!label) return null;
        const timePart = label.split(/撮影時刻:|time taken:?/i).pop() || label;
        const match = timePart.match(
            /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i
        );
        if (!match) return null;

        let hour = Number(match[1]);
        const meridiem = match[4]?.toUpperCase();
        if (meridiem === "PM" && hour < 12) hour += 12;
        if (meridiem === "AM" && hour === 12) hour = 0;
        if (hour > 23) return null;

        const date = new Date(targetDateTime);
        date.setHours(hour, Number(match[2]), Number(match[3] || 0), 0);
        return date.getTime();
    }

    /**
     * @param {string} href
     */
    async function openPhotoAndReadTime(href) {
        const card = getPhotoCards().find((element) => element.href === href);
        if (!card) {
            throw new Error("検索結果の写真を再表示できませんでした。");
        }

        card.click();
        await waitUntil(
            () =>
                location.pathname.includes("/photo/") && location.href === href,
            "写真ページを開けませんでした。"
        );

        if (getCaptureTime() === null) {
            const infoButton = [...document.querySelectorAll("button")].find(
                (button) =>
                    /情報を開く|詳細情報|show details|photo info/i.test(
                        button.getAttribute("aria-label") || ""
                    )
            );
            if (infoButton instanceof HTMLButtonElement) infoButton.click();
        }

        await waitUntil(
            () => getCaptureTime() !== null,
            "写真の情報ペインから撮影時刻を読み取れませんでした。"
        );
        const captureTime = getCaptureTime();
        if (captureTime === null) {
            throw new Error("写真の撮影時刻を読み取れませんでした。");
        }

        const backLink = [...document.querySelectorAll("a[href]")].find(
            (link) => {
                if (!(link instanceof HTMLAnchorElement)) return false;
                const href = link.href;
                return (
                    (link.textContent || "").includes("検索に戻る") ||
                    (href.includes("/search/") && !href.includes("/photo/"))
                );
            }
        );
        if (!(backLink instanceof HTMLAnchorElement)) {
            throw new Error("写真一覧に戻るリンクが見つかりません。");
        }

        backLink.click();
        await waitUntil(
            () =>
                location.pathname.includes("/search/") &&
                !location.pathname.includes("/photo/"),
            "写真一覧に戻れませんでした。"
        );
        await waitUntil(
            () => getPhotoCards().some((element) => element.href === href),
            "検索結果の写真を再表示できませんでした。"
        );
        return captureTime;
    }

    /**
     * @param {number} targetTime
     */
    async function findNearestPhoto(targetTime) {
        setSearchButtonDisabled(true);
        debugStartedAt = Date.now();
        debugState.targetTime = new Date(targetTime).toISOString();
        debugState.targetDate = getLocalDateQuery(targetTime);
        debugState.lastError = null;
        debugState.searchResultCount = 0;
        debugState.inspectedPhotoIndexes = [];
        debugState.events = [];
        try {
            const date = getLocalDateQuery(targetTime);
            setStatus(`${date} の写真を検索しています…`);
            targetDateTime = targetTime;
            await searchDate(date);

            setStatus("撮影時刻順の写真一覧を確認しています…");
            const photoHrefs = await loadPhotoResults();
            debugState.searchResultCount = photoHrefs.length;
            if (photoHrefs.length === 0) {
                setStatus(`${date} に撮影された写真は見つかりませんでした。`);
                return;
            }

            /** @type {Map<number, number>} */
            const captureTimes = new Map();
            /** @param {number} index */
            const inspect = async (index) => {
                if (!captureTimes.has(index)) {
                    debugState.inspectedPhotoIndexes.push(index);
                    setStatus(
                        `撮影時刻を確認しています… (${captureTimes.size + 1})`
                    );
                    const href = photoHrefs[index];
                    if (href === undefined) {
                        throw new Error("検索結果の写真を特定できませんでした。");
                    }
                    captureTimes.set(
                        index,
                        await openPhotoAndReadTime(href)
                    );
                }
                const captureTime = captureTimes.get(index);
                if (captureTime === undefined) {
                    throw new Error("写真の撮影時刻を読み取れませんでした。");
                }
                return captureTime;
            };

            const firstTime = await inspect(0);
            const lastTime =
                photoHrefs.length === 1
                    ? firstTime
                    : await inspect(photoHrefs.length - 1);
            const ascending = firstTime <= lastTime;
            let low = 0;
            let high = photoHrefs.length;

            while (low < high) {
                const middle = Math.floor((low + high) / 2);
                const time = await inspect(middle);
                if (
                    (ascending && time < targetTime) ||
                    (!ascending && time > targetTime)
                ) {
                    low = middle + 1;
                } else {
                    high = middle;
                }
            }

            const nearestIndexes = [
                ...new Set(
                    [low - 1, low].filter(
                        (index) => index >= 0 && index < photoHrefs.length
                    )
                ),
            ];
            for (const index of nearestIndexes) {
                await inspect(index);
            }

            const firstNearestIndex = nearestIndexes[0];
            if (firstNearestIndex === undefined) {
                throw new Error("最も近い写真を特定できませんでした。");
            }
            let closestIndex = firstNearestIndex;
            for (const index of nearestIndexes.slice(1)) {
                const candidateTime = captureTimes.get(index);
                const closestTime = captureTimes.get(closestIndex);
                if (candidateTime === undefined || closestTime === undefined) {
                    throw new Error("写真の撮影時刻を読み取れませんでした。");
                }
                if (
                    Math.abs(candidateTime - targetTime) <
                    Math.abs(closestTime - targetTime)
                ) {
                    closestIndex = index;
                }
            }
            const closestTime = captureTimes.get(closestIndex);
            if (closestTime === undefined) {
                throw new Error("写真の撮影時刻を読み取れませんでした。");
            }

            const closestHref = photoHrefs[closestIndex];
            const closestCard = getPhotoCards().find(
                (card) => card.href === closestHref
            );
            if (!closestCard) {
                throw new Error("見つかった写真を一覧に表示できませんでした。");
            }
            closestCard.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
            setStatus(
                `最も近い写真を表示しました（撮影時刻: ${new Date(
                    closestTime
                ).toLocaleTimeString()}）。`
            );
        } catch (error) {
            debugState.lastError =
                error instanceof Error ? error.message : String(error);
            setStatus(
                debugState.lastError || "検索中にエラーが発生しました。"
            );
            console.error("[Google Photos Time Search] Search failed:", error);
        } finally {
            setSearchButtonDisabled(false);
        }
    }

    function addSearchPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement("form");
        panel.id = PANEL_ID;
        panel.style.cssText = PANEL_STYLE;

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "2026-10-11T13:48:52+09:00";
        input.setAttribute("aria-label", "検索する撮影時刻");
        input.style.cssText =
            "width:220px;padding:6px;border:1px solid #ccc;border-radius:4px;";

        const button = document.createElement("button");
        button.type = "submit";
        button.dataset["role"] = "search";
        button.textContent = "時刻へ移動";
        button.style.cssText =
            "padding:6px 10px;border:0;border-radius:4px;background:#1a73e8;color:#fff;cursor:pointer;";

        const debugButton = document.createElement("button");
        debugButton.type = "button";
        debugButton.textContent = "デバッグ情報をコピー";
        debugButton.title =
            "検索欄の文字列と入力した撮影日時を含みます。写真IDやURLは含みません。";
        debugButton.style.cssText =
            "padding:6px 10px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#333;cursor:pointer;";
        debugButton.addEventListener("click", () => {
            void copyDebugInformation(debugButton);
        });

        const status = document.createElement("span");
        status.dataset["role"] = "status";
        status.style.cssText = "align-self:center;color:#444;";

        panel.append(input, button, debugButton, status);
        panel.addEventListener("submit", (event) => {
            event.preventDefault();
            const targetTime = parseTargetTime(input.value.trim());
            if (targetTime === null) {
                status.textContent = "日時を ISO 8601 形式で入力してください。";
                return;
            }
            void findNearestPhoto(targetTime);
        });
        document.body.appendChild(panel);
    }

    addSearchPanel();
    new MutationObserver(addSearchPanel).observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
