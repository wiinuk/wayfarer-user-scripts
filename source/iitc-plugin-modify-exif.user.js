// ==UserScript==
// @name         IITC plugin: modify exif
// @namespace    http://tampermonkey.net/
// @version      2024-09-20
// @description  Edit the Exif information attached to the photo and save it to a file.
// @author       Wiinuk
// @match        https://intel.ingress.com/intel
// @icon         https://www.google.com/s2/favicons?sz=64&domain=ingress.com
// @run-at       document-body
// @grant        GM_info
// ==/UserScript==
// spell-checker: ignore exif piexif GPSIFD
//@ts-check

(function () {
    "use strict";

    const pluginName = "iitc-plugin-modify-exif";
    const classNames = {
        title: pluginName + "-title",
        "file-image": pluginName + "-file-image",
        "exif-text": pluginName + "-exif-text",
        "modify-container": pluginName + "-modify-container",
    };
    const css = `
    .${classNames["title"]} {
        user-select: none;
        background: #065d498a;
        padding: 0.3em;
        color: #f0ffee;
        text-align: center;
        cursor: move;
    }
    .${classNames["file-image"]} {
        width: 120px;
    }
    .${classNames["exif-text"]} {
        width: 100%;
        overflow: auto;
        overflow-wrap: break-word;
    }
    .${classNames["modify-container"]} {
        position: fixed;
        left: 0;
        top: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        z-index: 9999;
        width: 50%;
        max-width: 100%;
        max-height: 100%;

        resize: both;
        overflow: auto;

        color: #333;
        background: #FFFFFF88;
        backdrop-filter: blur(4px);
        box-shadow: 0px 0px 9px 5px #00000085;
    }
    .${classNames["modify-container"]} button {
        border-radius: 1em;
        border: solid 1px gray;
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

    /**
     * @param {HTMLElement} element
     * @param {{ handleElement?: HTMLElement, propertyNames?: { left: string, top: string } }} [options]
     */
    function makeDraggable(element, options) {
        const handleElement = options?.handleElement ?? element;
        let offsetX = 0,
            offsetY = 0;

        /**
         * @param {number} left
         * @param {number} top
         */
        function setPosition(left, top) {
            if (options?.propertyNames) {
                const { left: leftName, top: topName } = options.propertyNames;
                element.style.setProperty(leftName, `${left}px`);
                element.style.setProperty(topName, `${top}px`);
            } else {
                element.style.left = `${left}px`;
                element.style.top = `${top}px`;
            }
        }

        /** @type {((e: PointerEvent) => void) | null } */
        let onPointerMove = null;
        handleElement.addEventListener("pointerdown", (e) => {
            onPointerMove = (e) => {
                // 画面範囲外に持って行かれないようにする
                if (
                    e.clientX < 0 ||
                    e.clientY < 0 ||
                    window.innerWidth < e.clientX ||
                    window.innerHeight < e.clientY
                ) {
                    return;
                }
                setPosition(e.clientX - offsetX, e.clientY - offsetY);
            };
            handleElement.addEventListener("pointermove", onPointerMove);
            handleElement.setPointerCapture(e.pointerId);
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
        });
        handleElement.addEventListener("pointerup", (e) => {
            if (!onPointerMove) return;

            handleElement.removeEventListener("pointermove", onPointerMove);
            handleElement.releasePointerCapture(e.pointerId);
            onPointerMove = null;
        });

        // ウインドウや要素のサイズ変更で隠れたら見える位置に移動する
        window.addEventListener("resize", tweakBounds);
        element.addEventListener("resize", tweakBounds);
        function tweakBounds() {
            const rect = element.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            let newX = offsetX;
            let newY = offsetY;
            if (rect.left < 0) {
                newX = 0;
            } else if (rect.right > windowWidth) {
                newX = windowWidth - rect.width;
            }

            if (rect.top < 0) {
                newY = 0;
            } else if (rect.bottom > windowHeight) {
                newY = windowHeight - rect.height;
            }

            if (newX !== offsetX || newY !== offsetY) {
                offsetX = newX;
                offsetY = newY;
                setPosition(offsetX, offsetY);
            }
        }
    }

    /**
     * @param {unknown} e
     */
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
            TagValues: { ExifIFD, GPSIFD },
        } = piexifJs;

        /** @type {import("zod")} */
        const zod = await import(
            // @ts-ignore
            "https://cdn.jsdelivr.net/npm/zod@3.23.8/+esm"
        );

        const ExifRational = zod.tuple([zod.number(), zod.number()]);
        const ExifNumber = zod.union([zod.number(), ExifRational]);
        const ExifNumberArray = zod.tuple([ExifNumber]).rest(ExifNumber);
        const ExifData = zod.union([ExifNumber, ExifNumberArray, zod.string()]);
        const IExifElement = zod.record(zod.string(), ExifData);
        const IExifElementOptional = IExifElement.optional();
        const IExif = zod.object({
            "0th": IExifElementOptional,
            "1st": IExifElementOptional,
            Exif: IExifElementOptional,
            Interop: IExifElementOptional,
            GPS: IExifElementOptional,
            thumbnail: zod.string().optional(),
        });
        /**
         * 型安全版
         * @typedef {Zod.infer<typeof IExif>} IExif
         * @typedef {Zod.infer<typeof IExifElement>} IExifElement
         * @typedef {Zod.infer<typeof ExifDmsData>} ExifDmsData
         */
        const ExifDmsData = zod.tuple([
            ExifRational,
            ExifRational,
            ExifRational,
        ]);
        const ExifRefData = zod.string();
        /**
         * @template T
         * @typedef ElementFieldDescriptor
         * @property {number} offset
         * @property {Zod.ZodType<T>} type
         */

        /**
         * @template T
         * @param {number} offset
         * @param {Zod.ZodType<T>} type
         */
        function createField(offset, type) {
            return { offset, type };
        }
        const GPSFields = Object.freeze({
            GPSLatitudeRef: createField(GPSIFD.GPSLatitudeRef, ExifRefData),
            GPSLongitudeRef: createField(GPSIFD.GPSLongitudeRef, ExifRefData),
            GPSLatitude: createField(GPSIFD.GPSLatitude, ExifDmsData),
            GPSLongitude: createField(GPSIFD.GPSLongitude, ExifDmsData),
        });

        /**
         * 実行時にフィールドに記録された型が仕様と合っていないと insert メソッドが例外を吐くため修正する
         * @param {IExif} param0
         */
        function fixExif({ Exif }) {
            if (Exif) {
                // type: byte, value: 1 で保存されている場合
                // type: undefined, value: 1 に修正する
                if (Exif[ExifIFD.SceneType] === 1) {
                    Exif[ExifIFD.SceneType] = "\u0001";
                }
            }
        }

        /**
         * @template T
         * @param {IExifElement} element
         * @param {ElementFieldDescriptor<T>} field
         */
        function getField(element, field) {
            return field.type.parse(element[field.offset]);
        }
        /**
         * @template {Zod.infer<typeof ExifData>} T
         * @param {IExifElement} element
         * @param {ElementFieldDescriptor<T>} field
         * @param {T} value
         */
        function setField(element, field, value) {
            element[field.offset] = field.type.parse(value);
        }

        /**
         * @param {IExif} param0
         */
        function getLatLng({ GPS }) {
            if (GPS == null) return;
            let latRef, lngRef, lat, lng;
            try {
                latRef = getField(GPS, GPSFields.GPSLatitudeRef);
                lngRef = getField(GPS, GPSFields.GPSLongitudeRef);
                lat = getField(GPS, GPSFields.GPSLatitude);
                lng = getField(GPS, GPSFields.GPSLongitude);
            } catch {
                return;
            }
            return {
                lat: GPSHelper.dmsRationalToDeg(lat, latRef),
                lng: GPSHelper.dmsRationalToDeg(lng, lngRef),
            };
        }

        const degToDmsRational = /** @type {(deg: number) => ExifDmsData} */ (
            GPSHelper.degToDmsRational
        );

        /**
         * @param {IExif} exif
         * @param {number} lat
         * @param {number} lng
         */
        function setLatLng(exif, lat, lng) {
            const GPS = (exif.GPS ??= {});
            setField(GPS, GPSFields.GPSLatitudeRef, lat < 0 ? "S" : "N");
            setField(GPS, GPSFields.GPSLatitude, degToDmsRational(lat));
            setField(GPS, GPSFields.GPSLongitudeRef, lng < 0 ? "W" : "E");
            setField(GPS, GPSFields.GPSLongitude, degToDmsRational(lng));
        }
        /**
         * @param {IExif} param0
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

        const defaultOutputNameFormat = "${name}_modified";
        /**
         * @param {string} format
         * @param {string} fileName
         */
        function applyFormat(format, fileName) {
            return format.replace(
                /\$\{([^}]*)}/,
                (_, /** @type {String} */ expression) => {
                    const variableName = expression.trim();
                    if (variableName === "name") {
                        return fileName;
                    }
                    return error`unexpected variable: ${variableName}`;
                }
            );
        }
        /**
         * @param {IExif} exif
         */
        function stringifyExif(exif) {
            return JSON.stringify(exif);
        }
        /**
         * @param {string} source
         * @returns {IExif}
         */
        function parseExif(source) {
            return IExif.parse(JSON.parse(source));
        }

        const titleBar = document.createElement("div");
        titleBar.className = classNames.title;
        titleBar.textContent = "exif editor";

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.name = "file";

        const fileImage = document.createElement("img");
        fileImage.className = classNames["file-image"];

        const latLngInputPattern =
            /(?<lat>[-+]?\d+(\.\d+)?).*?(?<lng>[-+]?\d+(\.\d+)?)/;
        const latLngInput = document.createElement("input");
        fileInput.pattern = latLngInputPattern.source;

        const exifTextArea = document.createElement("textarea");
        exifTextArea.className = classNames["exif-text"];

        const outputNameFormatInput = document.createElement("input");

        const details = document.createElement("details");
        details.append(outputNameFormatInput, exifTextArea);

        const setLatLngButton = document.createElement("button");
        setLatLngButton.textContent = "📍位置情報を設定";

        const moveToLatLngButton = document.createElement("button");
        moveToLatLngButton.textContent = "🎯地図で表示";

        const saveButton = document.createElement("button");
        saveButton.textContent = "📥ファイルに保存";

        const buttonContainer = document.createElement("div");
        buttonContainer.append(setLatLngButton, moveToLatLngButton, saveButton);

        const modifyContainer = document.createElement("div");
        modifyContainer.className = classNames["modify-container"];
        modifyContainer.append(
            titleBar,
            fileInput,
            fileImage,
            latLngInput,
            details,
            buttonContainer
        );
        makeDraggable(modifyContainer, { handleElement: titleBar });

        const pinLayer = L.marker(window.map.getCenter(), {
            draggable: true,
            title: "exif",
        });

        /** @type {{ imageFile: File | null, exif: IExif, outputNameFormat: string }}*/
        const state = {
            imageFile: null,
            exif: {},
            outputNameFormat: defaultOutputNameFormat,
        };
        function onStateUpdated() {
            console.debug("state updated");
            const newExifText = stringifyExif(state.exif);
            if (newExifText !== exifTextArea.value) {
                exifTextArea.value = newExifText;
            }
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
            if (state.outputNameFormat !== outputNameFormatInput.value) {
                outputNameFormatInput.value = state.outputNameFormat;
            }
        }
        async function onChangeFileAsync() {
            const file0 = fileInput.files?.[0];
            if (file0 == null) {
                return console.debug(`ファイルが選択されていません`);
            }

            const dataUrl = await readFileAs("data-url", file0);
            state.exif = IExif.parse(piexifJs.load(dataUrl));
            state.imageFile = file0;

            fileImage.src = dataUrl;
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
        function onExifTextValueChanged() {
            state.exif = parseExif(exifTextArea.value);
            onStateUpdated();
        }
        async function onSaveButtonClickAsync() {
            if (state.imageFile == null) return;

            const fileName = state.imageFile.name;
            const imageData = await readFileAs("data-url", state.imageFile);

            fixExif(state.exif);
            const newImageData = piexifJs.insert(
                piexifJs.dump(state.exif),
                imageData
            );

            const link = document.createElement("a");
            link.href = newImageData;
            const [name, ext] = splitExtension(fileName);
            const formattedName = applyFormat(
                state.outputNameFormat ?? defaultOutputNameFormat,
                name
            );
            link.download = `${formattedName}${ext}`;
            link.click();
        }

        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);

        pinLayer.addEventListener("move", onPinChanged);
        setLatLngButton.addEventListener("click", () => {
            const center = window.map.getCenter();
            setLatLng(state.exif, center.lat, center.lng);
            onStateUpdated();
        });
        outputNameFormatInput.addEventListener("change", () => {
            state.outputNameFormat = outputNameFormatInput.value;
            onStateUpdated();
        });
        exifTextArea.addEventListener("change", onExifTextValueChanged);
        moveToLatLngButton.addEventListener("click", onMoveToLatLngClicked);
        fileInput.addEventListener("change", () =>
            onChangeFileAsync().catch(handleAsyncError)
        );
        latLngInput.addEventListener("change", onChangeLatLng);
        saveButton.addEventListener("click", () =>
            onSaveButtonClickAsync().catch(handleAsyncError)
        );
        document.body.append(modifyContainer);
        onStateUpdated();
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
