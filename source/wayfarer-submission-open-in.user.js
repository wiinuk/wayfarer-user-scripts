// ==UserScript==
// @name         Wayfarer Submission Open-In
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Wayfarerの申請詳細ページから候補の位置を開くリンクを追加
// @author       You
// @match        https://wayfarer.scopely.com/submit/submission/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//@ts-check
//spell-checker: words noopener noreferrer

(function () {
    "use strict";

    const BUTTON_ID = "wayfarer-submission-open-link";
    const MAP_URL = "https://9db.jp/pokemongo/map";
    const COORDINATE_PATTERN = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/;

    function updateButton() {
        const page = document.querySelector(
            '[data-testid="submission-details-page"]'
        );
        if (!page) {
            document.getElementById(BUTTON_ID)?.remove();
            return;
        }

        const title =
            page
                .querySelector(
                    '[data-testid="submission-details-title-card"] h2'
                )
                ?.textContent?.trim() ??
            page.querySelector("h2")?.textContent?.trim();
        const coordinateElement = [...page.querySelectorAll("*")].find(
            (element) =>
                element.children.length === 0 &&
                COORDINATE_PATTERN.test(element.textContent?.trim() ?? "")
        );

        if (!title || !coordinateElement) {
            document.getElementById(BUTTON_ID)?.remove();
            return;
        }

        const match = coordinateElement.textContent
            ?.trim()
            .match(COORDINATE_PATTERN);
        if (!match) return;

        const lat = Number(match[1]);
        const lng = Number(match[2]);
        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
        ) {
            document.getElementById(BUTTON_ID)?.remove();
            return;
        }

        const url = `${MAP_URL}#${match[1]},${match[2]},17,${encodeURIComponent(
            title
        )}`;
        const existingLink = document.getElementById(BUTTON_ID);
        /** @type {HTMLAnchorElement} */
        let link;
        if (existingLink instanceof HTMLAnchorElement) {
            link = existingLink;
        } else {
            existingLink?.remove();
            link = document.createElement("a");
            link.id = BUTTON_ID;
            link.textContent = "9db";
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.style.cssText =
                "display:inline-block;margin-top:6px;padding:4px 10px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#333;font-size:12px;text-decoration:none;";
        }

        link.href = url;
        if (coordinateElement.nextElementSibling !== link) {
            coordinateElement.after(link);
        }
    }

    const observer = new MutationObserver(updateButton);
    observer.observe(document.body, { childList: true, subtree: true });
    updateButton();
})();
