// ==UserScript==
// @name         9db map - auto complete
// @namespace    http://tampermonkey.net/
// @version      2025-10-19
// @description  try to take over the world!
// @author       You
// @match        https://9db.jp/pokemongo/map
// @icon         https://www.google.com/s2/favicons?sz=64&domain=9db.jp
// @grant        none
// @run-at       document-start
// ==/UserScript==

// spell-checker: ignore pokestop
// @ts-check

(function () {
    "use strict";

    /**
     * @param {() => void} f
     */
    function ready(f) {
        switch (document.readyState) {
            case "complete":
            case "interactive":
                return f();
            default:
                return window.addEventListener("DOMContentLoaded", f, {
                    once: true,
                });
        }
    }
    /**
     * @param {number} milliseconds
     */
    function sleep(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
    /**
     * @param {string | (() => Element | null | undefined)} queryOrGetElement
     */
    async function waitElement(queryOrGetElement) {
        const getElement =
            typeof queryOrGetElement === "string"
                ? () => document.querySelector(queryOrGetElement)
                : queryOrGetElement;

        let currentIntervalMs = 100;
        const maxIntervalMs = 1000;
        while (true) {
            const e = getElement();
            if (e) return e;
            await sleep(currentIntervalMs);
            currentIntervalMs = Math.min(maxIntervalMs, currentIntervalMs * 2);
        }
    }
    const classNames = Object.freeze({
        completed: "-completed",
        addSpot: "-add-spot",
        addGym: "-add-gym",
        addStop: "-add-stop",
    });

    function addStyle() {
        const style = document.createElement("style");
        style.textContent = `
            .${classNames.completed} {
                background-color: #e0f7fa !important;
            }
            .${classNames.addSpot} {
                position: absolute;
                border: 2px solid rgba(0, 0, 0, 0.2);
                background-clip: padding-box;
                background-color: rgba(255, 255, 255, 0.9);
                padding: 5px;
                z-index: 10000;
                border-radius: 3px;

                bottom: 115px;
            }
            .${classNames.addSpot} img {
                border-radius: 2px;
                width: 25px;
            }
            .${classNames.addGym} {
                right: 185px;
            }
            .${classNames.addStop} {
                right: 140px;
            }
        `;
        document.head.appendChild(style);
    }
    /**
     * @param {HTMLInputElement} input
     * @param {string} value
     */
    function setValue(input, value) {
        if (input.value !== "") return;
        input.value = value;
        input.classList.add(classNames.completed);
        input.addEventListener(
            "input",
            () => input.classList.remove(classNames.completed),
            { once: true }
        );
        const intervalId = setInterval(() => {
            if (input.value !== value) {
                clearInterval(intervalId);
                input.classList.remove(classNames.completed);
                return;
            }
        }, 500);
    }

    const initialUrl = window.location.href;

    async function setupAutoComplete() {
        const hash = new URL(initialUrl).hash;
        console.debug(initialUrl);

        const [initialLat = "", initialLng = "", _zoom, title = ""] = hash
            .replace(/^#/, "")
            .split(",")
            .map(decodeURIComponent);

        console.debug("auto complete:", {
            title,
            lat: initialLat,
            lng: initialLng,
        });
        if (title == null) return;

        const titleInput = /** @type {HTMLInputElement} */ (
            await waitElement(
                "#spot_edit_area > div:nth-child(3) > input[type=text]"
            )
        );
        const latInput = /** @type {HTMLInputElement} */ (
            await waitElement(
                "#spot_edit_area > div:nth-child(5) > input[type=text]:nth-child(1)"
            )
        );
        const lngInput = /** @type {HTMLInputElement} */ (
            await waitElement(
                "#spot_edit_area > div:nth-child(5) > input[type=text]:nth-child(2)"
            )
        );

        console.debug(titleInput, latInput, lngInput);

        function setValues() {
            setValue(titleInput, title);
            setValue(latInput, initialLat);
            setValue(lngInput, initialLng);
        }

        const spotForm = await waitElement("#spot_form");
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    console.debug("spot form visible");
                    setTimeout(setValues, 0);
                }
            }
        });
        observer.observe(spotForm);

        setValues();
    }
    /**
     * @param {Readonly<{ classNames: readonly string[]; imgSrc: string; imgAlt: string; spotGenre: string; shortcutKey: string; }>} options
     */
    async function addSpotButton(options) {
        const addSpotButton = document.createElement("div");
        addSpotButton.classList.add(
            "cur_p",
            classNames.addSpot,
            ...options.classNames
        );
        const img = document.createElement("img");
        img.src = options.imgSrc;
        img.alt = options.imgAlt;
        addSpotButton.appendChild(img);
        addSpotButton.addEventListener("click", async () => {
            const addSpot = /** @type {HTMLElement} */ (
                await waitElement("#add_spot")
            );
            addSpot.click();
            const addSpotImg = /** @type {HTMLElement} */ (
                await waitElement(
                    `#add_spot_select .open_spot_form[data-genre=${options.spotGenre}]`
                )
            );
            addSpotImg.click();
        });

        const addSpot = await waitElement("#add_spot");
        addSpot.insertAdjacentElement("afterend", addSpotButton);

        window.addEventListener("keydown", (e) => {
            if (
                e.ctrlKey &&
                e.key.toLowerCase() === options.shortcutKey.toLowerCase()
            ) {
                e.preventDefault();
                addSpotButton.click();
            }
        });
    }
    async function addGymButton() {
        return await addSpotButton({
            classNames: [classNames.addGym],
            imgSrc: "https://cdn08.net/pokemongo/wiki/gymoff.png",
            imgAlt: "ジム追加",
            spotGenre: "gym",
            shortcutKey: "g",
        });
    }
    async function addStopButton() {
        return await addSpotButton({
            classNames: [classNames.addStop],
            imgSrc: "https://cdn08.net/pokemongo/wiki/pokestopoff.png",
            imgAlt: "ポケストップ追加",
            spotGenre: "pokestop",
            shortcutKey: "s",
        });
    }
    ready(async () => {
        addStyle();

        await Promise.all([
            addGymButton(),
            addStopButton(),
            setupAutoComplete(),
        ]);
    });
})();
