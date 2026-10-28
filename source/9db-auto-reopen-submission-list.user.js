// ==UserScript==
// @name         9db map - auto reopen submission list
// @namespace    http://tampermonkey.net/
// @version      2025-09-28
// @description  try to take over the world!
// @author       You
// @match        https://9db.jp/pokemongo/map
// @icon         https://www.google.com/s2/favicons?sz=64&domain=9db.jp
// @grant        none
// ==/UserScript==
//@ts-check

(function () {
    "use strict";

    /**
     * @param {{ (): Element | null; (): Element | null; (): any; }} getElement
     */
    function waitElementUntil(getElement) {
        return new Promise((resolve) => {
            const maxIntervalMs = 2000;
            let intervalMs = 100;
            function check() {
                const e = getElement();
                if (e) return resolve(e);
                setTimeout(
                    check,
                    (intervalMs = Math.min(intervalMs * 2, maxIntervalMs))
                );
            }
            check();
        });
    }
    /**
     * @param {number | undefined} milliseconds
     */
    function sleep(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    /**
     * @param {HTMLElement} nameSpan
     */
    function isProgress(nameSpan) {
        const stateTd = /** @type {HTMLElement | null | undefined} */ (
            nameSpan.closest("tr")?.querySelector("td.nowrap")
        );
        const text = stateTd?.innerText ?? "";
        return /申請中/.test(text);
    }

    /**
     * @param {HTMLElement} nameSpan
     */
    function getIdFromNameSpan(nameSpan) {
        return `${nameSpan.dataset["lat"]},${nameSpan.dataset["lng"]}`;
    }

    // localStorage を使って確認済みIDを保存・復元
    const STORAGE_KEY = "checked_submission_ids";
    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    const expires = 1 * millisecondsPerDay;

    function loadIds() {
        const now = Date.now();
        /** @type {[id: string, checkTime: number][]} */
        let ids = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        ids = ids.filter((id) => now < id[1] + expires);
        return new Map(ids);
    }
    const checkedIds = loadIds();

    /**
     * @param {string} id
     */
    function markAsChecked(id) {
        checkedIds.set(id, Date.now());
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(Array.from(checkedIds))
        );
    }

    /**
     * @param {HTMLElement} nameSpan
     */
    function maybeProgress(nameSpan) {
        return (
            !checkedIds.has(getIdFromNameSpan(nameSpan)) && isProgress(nameSpan)
        );
    }
    document.addEventListener("click", async function (event) {
        try {
            const nameSpan = event.target;
            if (!(nameSpan instanceof HTMLElement)) return;
            if (!nameSpan.matches("table#post_tab .move_to_spot")) return;
            if (!maybeProgress(nameSpan)) {
                console.debug(`確認済みのスポットがクリックされたので処理完了`);
                return;
            }

            console.debug(`「申請中」ではないスポットがクリックされた`);
            const _poiPopup = await waitElementUntil(() =>
                document.querySelector("#pokemap .leaflet-pane [data-genre]")
            );
            console.debug(`ポップアップが開いている事を確認`);
            const userImg = await waitElementUntil(() =>
                document.querySelector("#user_tips > img")
            );
            await sleep(2000);
            userImg.click();

            // 確定後に即時保存
            if (isProgress(nameSpan)) {
                markAsChecked(getIdFromNameSpan(nameSpan));
            }

            // 残りの未チェックリストを取得して次の処理へ
            const elements = /** @type {NodeListOf<HTMLElement>} */ (
                document.querySelectorAll("table#post_tab .move_to_spot")
            );
            const nextTarget = [...elements].filter(maybeProgress)[0];

            if (nextTarget != null) {
                nextTarget.scrollIntoView();
                console.debug(`次のスポットをクリック`);
                nextTarget.click();
            } else {
                console.debug(`全てのスポットがチェック済みなので処理完了`);
            }
        } catch (e) {
            console.error("非同期エラー発生", e);
        }
    });
})();
