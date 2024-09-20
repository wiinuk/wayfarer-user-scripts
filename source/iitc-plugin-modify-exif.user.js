// ==UserScript==
// @name         Modify Exif
// @namespace    http://tampermonkey.net/
// @version      2024-09-20
// @description  try to take over the world!
// @author       You
// @match        https://intel.ingress.com/intel
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ingress.com
// @run-at       document-body
// @grant        GM_info
// ==/UserScript==
// spell-checker: ignore exif piexif GPSIFD
//@ts-check

(function () {
    "use strict";

    const classNames = {
        "exif-text": "exif-text",
        "modify-container": "modify-container",
    };
    const css = `
    .${classNames["exif-text"]} {
        width: 100%;
        overflow: auto;
        overflow-wrap: break-word;
    }
    .${classNames["modify-container"]} {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        width: 50%;
        height: 30%;

        background: white;
    }
    `;

    /**
     * @param {TemplateStringsArray} template
     * @param  {...(string | number)} substitutions
     * @returns {never}
     */
    function error(template, ...substitutions) {
        throw new Error(String.raw(template, ...substitutions));
    }
    function newAbortError() {
        const error = new Error("Abort requested");
        error.name = "AbortError";
        return error;
    }
    /**
     * @typedef {{ "array-buffer": ArrayBuffer, "data-url": string }} TypeToBinaryMap
     */
    /**
     * @template {keyof TypeToBinaryMap} TType
     * @param {Blob} blob
     * @param {TType} type
     * @param {AbortSignal} [signal]
     * @returns {Promise<TypeToBinaryMap[TType]>}
     */
    function readFileAs(type, blob, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(newAbortError());

            const fileReader = new FileReader();
            fileReader.onload = function (e) {
                resolve(
                    /** @type {TypeToBinaryMap[TType]} */ (e.target?.result)
                );
            };
            fileReader.onerror = reject;
            if (signal) {
                signal.addEventListener("abort", () => fileReader.abort());
            }
            switch (type) {
                case "array-buffer":
                    return fileReader.readAsArrayBuffer(blob);
                case "data-url":
                    return fileReader.readAsDataURL(blob);
                default:
                    throw error`${
                        /** @satisfies {never} */ (type)
                    } is not implemented`;
            }
        });
    }
    /**
     * @param {string} fileName
     */
    function splitExtension(fileName) {
        const dotIndex = fileName.lastIndexOf(".");
        return dotIndex === -1
            ? /** @type {const} */ ([fileName, ""])
            : /** @type {const} */ ([
                  fileName.slice(0, dotIndex),
                  fileName.slice(dotIndex),
              ]);
    }
    function handleAsyncError(e) {
        console.error(e);
    }
    /**
     * @typedef IITCGlobalExtensions
     * @property {L.Map} map
     */
    async function asyncMain() {
        const window =
            /** @type {typeof unsafeWindow & IITCGlobalExtensions} */ (
                globalThis.unsafeWindow
            );

        /** @type {import("piexif-ts")} */
        const piexifJs = (
            await import(
                //@ts-expect-error
                "https://cdn.jsdelivr.net/npm/piexifjs@2.0.0-beta.9/+esm"
            )
        ).default;
        const {
            GPSHelper,
            TagValues: { GPSIFD },
        } = piexifJs;

        /**
         * @param {import("piexif-ts").IExif} param0
         */
        function getLatLng({ GPS }) {
            if (GPS == null) return;
            const lat = GPSHelper.dmsRationalToDeg(
                GPS[GPSIFD.GPSLatitude],
                GPS[GPSIFD.GPSLatitudeRef]
            );
            const lng = GPSHelper.dmsRationalToDeg(
                GPS[GPSIFD.GPSLongitude],
                GPS[GPSIFD.GPSLongitudeRef]
            );
            return { lat, lng };
        }
        /**
         * @param {import("piexif-ts").IExif} exif
         * @param {number} lat
         * @param {number} lng
         */
        function setLatLng(exif, lat, lng) {
            const GPS = (exif.GPS ??= {});
            GPS[GPSIFD.GPSLatitudeRef] = lat < 0 ? "S" : "N";
            GPS[GPSIFD.GPSLatitude] = GPSHelper.degToDmsRational(lat);
            GPS[GPSIFD.GPSLongitudeRef] = lng < 0 ? "W" : "E";
            GPS[GPSIFD.GPSLongitude] = GPSHelper.degToDmsRational(lng);
        }
        /**
         * @param {import("piexif-ts").IExif} param0
         */
        function removeLatLng({ GPS }) {
            if (!GPS) return;
            delete GPS[GPSIFD.GPSLatitudeRef];
            delete GPS[GPSIFD.GPSLatitude];
            delete GPS[GPSIFD.GPSLongitudeRef];
            delete GPS[GPSIFD.GPSLongitude];
        }
        /**
         * @param {string} text
         */
        function parseLatLng(text) {
            const match = latLngInputPattern.exec(text);
            if (!match) return;

            const { lat = error``, lng = error`` } = match.groups ?? {};
            return { lat: parseFloat(lat), lng: parseFloat(lng) };
        }

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.name = "file";

        const latLngInputPattern =
            /(?<lat>[-+]?\d+(\.\d+)?).*?(?<lng>[-+]?\d+(\.\d+)?)/;
        const latLngInput = document.createElement("input");
        fileInput.pattern = latLngInputPattern.source;

        const exifText = document.createElement("div");
        exifText.className = classNames["exif-text"];

        const moveToLatLngButton = document.createElement("button");
        moveToLatLngButton.textContent = "Move to location";

        const saveButton = document.createElement("button");
        saveButton.textContent = "Save";

        const modifyContainer = document.createElement("div");
        modifyContainer.className = classNames["modify-container"];
        modifyContainer.append(
            fileInput,
            latLngInput,
            exifText,
            moveToLatLngButton,
            saveButton
        );

        const pinLayer = L.marker(window.map.getCenter(), {
            draggable: true,
            title: "exif",
        });

        /** @type {{ imageFile: File | null, exif: import("piexif-ts").IExif }}*/
        const state = {
            imageFile: null,
            exif: {},
        };
        function onStateUpdated() {
            console.debug("state updated");
            exifText.textContent = JSON.stringify(state.exif);
            const latLng = getLatLng(state.exif);
            const nextLatLngValue = latLng
                ? `${latLng.lat}, ${latLng.lng}`
                : "位置情報なし";
            if (nextLatLngValue !== latLngInput.value) {
                latLngInput.value = nextLatLngValue;
            }

            if (latLng) {
                window.map.addLayer(pinLayer);
                const prev = pinLayer.getLatLng();
                if (prev.lat !== latLng.lat || prev.lng !== latLng.lng) {
                    pinLayer.setLatLng(latLng);
                }
            } else {
                window.map.removeLayer(pinLayer);
            }
        }
        async function onChangeFileAsync() {
            const file0 = fileInput.files?.[0];
            if (file0 == null) {
                return console.debug(`ファイルが選択されていません`);
            }

            const dataUrl = await readFileAs("data-url", file0);
            const exif = piexifJs.load(dataUrl);

            state.imageFile = file0;
            state.exif = exif;

            onStateUpdated();
        }
        function onChangeLatLng() {
            const latLng = parseLatLng(latLngInput.value);
            if (latLng) {
                setLatLng(state.exif, latLng.lat, latLng.lng);
            } else {
                removeLatLng(state.exif);
            }
            onStateUpdated();
        }
        function onPinChanged() {
            const latLng = pinLayer.getLatLng();
            setLatLng(state.exif, latLng.lat, latLng.lng);
            onStateUpdated();
        }
        function onMoveToLatLngClicked() {
            const latLng = getLatLng(state.exif);
            if (!latLng) return;
            window.map.setView(latLng);
        }
        async function onSaveButtonClickAsync() {
            if (state.imageFile == null) return;

            const fileName = state.imageFile.name;
            const imageData = await readFileAs("data-url", state.imageFile);
            const newImageData = piexifJs.insert(
                piexifJs.dump(state.exif),
                imageData
            );

            const link = document.createElement("a");
            link.href = newImageData;
            const [name, ext] = splitExtension(fileName);
            link.download = `${name}_modified${ext}`;
            link.click();
        }

        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);

        pinLayer.addEventListener("move", onPinChanged);
        moveToLatLngButton.addEventListener("click", onMoveToLatLngClicked);
        fileInput.addEventListener("change", () =>
            onChangeFileAsync().catch(handleAsyncError)
        );
        latLngInput.addEventListener("change", onChangeLatLng);
        saveButton.addEventListener("click", () =>
            onSaveButtonClickAsync().catch(handleAsyncError)
        );
        document.body.append(modifyContainer);
    }

    unsafeWindow["_modify_exif_ee88b106-f009-4d4a-ba54-8d9c5090fbe3"] = {
        main() {
            asyncMain().catch(handleAsyncError);
        },
    };
})();

(function () {
    function wrapper(plugin_info) {
        /** @type {any} */
        const window = globalThis.window;
        if (typeof window.plugin !== "function") window.plugin = function () {};
        plugin_info.dateTimeVersion = "20240920000000";
        plugin_info.pluginId = "modify exif";
        const setup = function () {
            const key = "_modify_exif_ee88b106-f009-4d4a-ba54-8d9c5090fbe3";
            const mainModule = window[key];
            delete window[key];
            mainModule.main();
        };
        setup.info = plugin_info;
        if (!window.bootPlugins) window.bootPlugins = [];
        window.bootPlugins.push(setup);
        if (window.iitcLoaded && typeof setup === "function") setup();
    }

    const script = document.createElement("script");
    const info = {};
    if (typeof GM_info !== "undefined" && GM_info && GM_info.script)
        info.script = {
            version: GM_info.script.version,
            name: GM_info.script.name,
            description: GM_info.script.description,
        };
    script.appendChild(
        document.createTextNode(
            "(" + wrapper + ")(" + JSON.stringify(info) + ");"
        )
    );
    (document.body || document.head || document.documentElement).appendChild(
        script
    );
})();
