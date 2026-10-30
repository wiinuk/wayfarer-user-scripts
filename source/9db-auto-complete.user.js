// ==UserScript==
// @name         9db map - auto complete
// @namespace    http://tampermonkey.net/
// @version      2026-10-30
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
        let e;
        while ((e = getElement()) == null) {
            await sleep(currentIntervalMs);
            currentIntervalMs = Math.min(maxIntervalMs, currentIntervalMs * 2);
        }
        return e;
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

    /**
     * @typedef {{ genre?: "gym" | "pokestop"; close?: boolean | string }} UrlOptions
     */
    /**
     * @param {string} encodedOptions
     * @returns {UrlOptions}
     */
    function parseUrlOptions(encodedOptions) {
        if (encodedOptions === "") return {};

        /** @type {unknown} */
        let parsed;
        try {
            parsed = JSON.parse(encodedOptions);
        } catch (error) {
            console.error("Failed to parse URL options:", error);
            return {};
        }

        if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            console.error("URL options must be a JSON object.");
            return {};
        }

        /** @type {UrlOptions} */
        const options = {};
        if ("genre" in parsed) {
            if (parsed.genre === "gym" || parsed.genre === "pokestop") {
                options.genre = parsed.genre;
            } else {
                console.error(
                    'URL option "genre" must be "gym" or "pokestop".'
                );
            }
        }
        if ("close" in parsed) {
            if (typeof parsed.close === "boolean") {
                options.close = parsed.close;
            } else if (typeof parsed.close === "string") {
                options.close = parsed.close !== "false";
            } else {
                console.error(
                    'URL option "close" must be a boolean or string.'
                );
            }
        }
        return options;
    }

    const initialUrl = window.location.href;

    async function setupAutoComplete() {
        const hash = new URL(initialUrl).hash;
        console.debug(initialUrl);

        const [
            initialLat = "",
            initialLng = "",
            _zoom,
            title = "",
            encodedOptions = "",
        ] = hash.replace(/^#/, "").split(",").map(decodeURIComponent);
        const options = parseUrlOptions(encodedOptions);

        console.debug("auto complete:", {
            title,
            lat: initialLat,
            lng: initialLng,
            options,
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

        /** @type {HTMLInputElement | null} */
        let submitInput = null;
        if (options.close) {
            submitInput = /** @type {HTMLInputElement} */ (
                await waitElement("#spot_edit_area input.submit")
            );
            let submitRequested = false;
            submitInput.addEventListener("click", () => {
                submitRequested = true;
            });

            const closeObserver = new MutationObserver(() => {
                if (
                    !submitRequested ||
                    getComputedStyle(spotForm).display !== "none"
                ) {
                    return;
                }
                closeObserver.disconnect();
                window.close();
            });
            closeObserver.observe(spotForm, {
                attributes: true,
                attributeFilter: ["class", "style"],
            });
        }

        if (options.genre != null) {
            await openSpotForm(options.genre);
        }

        setValues();
        submitInput?.click();
    }
    /**
     * @param {Readonly<{ classNames: readonly string[]; imgSrc: string; imgAlt: string; spotGenre: "gym" | "pokestop"; shortcutKey: string; }>} options
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
        addSpotButton.addEventListener("click", () => {
            void openSpotForm(options.spotGenre);
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
    /**
     * @param {"gym" | "pokestop"} spotGenre
     */
    async function openSpotForm(spotGenre) {
        const addSpot = /** @type {HTMLElement} */ (
            await waitElement("#add_spot")
        );
        addSpot.click();
        const addSpotImg = /** @type {HTMLElement} */ (
            await waitElement(
                `#add_spot_select .open_spot_form[data-genre=${spotGenre}]`
            )
        );
        addSpotImg.click();
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
    async function setupEnterToSubmit() {
        const submitInput = /** @type {HTMLInputElement} */ (
            await waitElement("#spot_edit_area input.submit")
        );
        document.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                submitInput.click();
            }
        });
    }
    ready(async () => {
        addStyle();

        await Promise.all([
            addGymButton(),
            addStopButton(),
            setupEnterToSubmit(),
            setupAutoComplete(),
        ]);
    });
})();
