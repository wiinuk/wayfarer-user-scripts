// ==UserScript==
// @name         Wayfarer Capture Nominations
// @namespace    https://github.com/wiinuk/wayfarer-user-scripts
// @version      1.2
// @description  Save screenshots of multiple appointments into a single image.
// @author       Wiinuk
// @match        https://wayfarer.nianticlabs.com/*
// @grant        none
// ==/UserScript==

//spell-checker: ignore wiinuk scrollend
//@ts-check

(function () {
    "use strict";

    /**
     * @template T
     * @param {T} value
     */
    function assertNonNull(value) {
        return value == null ? error`value is null` : value;
    }
    /**
     * @param {TemplateStringsArray} template
     * @param {unknown[]} values
     * @returns {never}
     */
    function error(template, ...values) {
        throw new Error(String.raw(template, ...values));
    }

    /**
     * @param {number} milliseconds
     * @returns {Promise<void>}
     */
    function sleep(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }
    /**
     *
     * @param {HTMLCanvasElement} canvas
     * @param {string} [type]
     * @param {number} [quality]
     * @returns {Promise<Blob | null>}
     */
    function canvasToBlobAsync(canvas, type, quality) {
        return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    }

    /**
     * @param {number} tileCount
     * @param {readonly [x: number, y: number]} tileSize
     * @param {readonly [x: number, y: number]} expectedRatio
     */
    function getTileCount(
        tileCount,
        [tileWidth, tileHeight],
        [expectedWidth, expectedHeight]
    ) {
        const expectedAspectRatio = expectedWidth / expectedHeight;

        /** @type {[x: number, y: number] | null} */
        let bestFit = null;
        let minAspectRatioDiff = Infinity;

        for (let rows = 1; rows <= tileCount; rows++) {
            let cols = Math.ceil(tileCount / rows);
            let actualAspectRatio = (cols * tileWidth) / (rows * tileHeight);
            let aspectRatioDiff = Math.abs(
                actualAspectRatio - expectedAspectRatio
            );

            if (aspectRatioDiff < minAspectRatioDiff) {
                minAspectRatioDiff = aspectRatioDiff;
                bestFit = [cols, rows];
            }
        }

        return bestFit ?? [0, 0];
    }

    /**
     * @typedef {{ grabFrame: () => Promise<ImageBitmap> }} Track
     */
    /**
     * @template T
     * @param {(track: Track) => Promise<T>} scope
     */
    async function withCurrentTabVideoTrack0(scope) {
        const options = { video: true, preferCurrentTab: true };
        const stream = await navigator.mediaDevices.getDisplayMedia(options);
        const track = stream.getVideoTracks()[0];
        try {
            const imageCapture = new /** @type {any} */ (
                globalThis
            ).ImageCapture(track);
            return await scope({ grabFrame: () => imageCapture.grabFrame() });
        } finally {
            track.stop();
        }
    }
    /**
     * @typedef {Object} ListItemsCaptureContext
     * @property {HTMLElement | null} previousItemElement
     * @property {HTMLElement} listElement
     */
    /**
     * @typedef {Object} ImageCaptureContext
     * @property {ListItemsCaptureContext} itemsContext
     * @property {Track} track
     * @property {CanvasRenderingContext2D} imageContext
     * @property {number} itemCountPerImage
     * @property {number} imageCount
     * @property {number} itemCount
     * @property {number} tileCountX
     * @property {number} tileCountY
     * @property {number} itemWidth
     * @property {number} itemHeight
     */

    /**
     * @param {Element} element
     * @param {ScrollIntoViewOptions} [options]
     * @returns {Promise<void>}
     */
    function waitForScrollIntoView(element, options) {
        return new Promise((resolve) => {
            element.scrollIntoView(options);
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(element);
        });
    }
    /**
     * @param {HTMLElement} element
     * @param {ScrollToOptions} [options]
     * @returns {Promise<void>}
     */
    function waitForScrollTo(element, options) {
        const left = options?.left ?? element.scrollLeft;
        const top = options?.top ?? element.scrollTop;
        if (left === element.scrollLeft && top === element.scrollTop) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const onScrollEnd = () => {
                element.removeEventListener("scrollend", onScrollEnd);
                resolve();
            };
            element.addEventListener("scrollend", onScrollEnd);
            element.scrollTo(options);
        });
    }
    /**
     * @param {HTMLImageElement} imageElement
     * @returns {Promise<void>}
     */
    function waitForImageLoaded(imageElement) {
        if (imageElement.complete) return Promise.resolve();
        return new Promise((resolve) => {
            const onComplete = () => {
                imageElement.removeEventListener("load", onComplete);
                resolve();
            };
            imageElement.addEventListener("load", onComplete);
            imageElement.addEventListener("error", onComplete);
        });
    }
    /**
     * @param {Element} element
     */
    async function waitForAllImageLoaded(element) {
        await Promise.all(
            [...element.querySelectorAll("img")].map(waitForImageLoaded)
        );
    }
    /**
     * @param {Element} element
     * @returns {Promise<boolean>}
     */
    function isElementFullyVisible(element) {
        return new Promise((resolve) => {
            const observer = new IntersectionObserver(
                (entries) => {
                    const entry = entries[0];
                    if (entry.isIntersecting) {
                        resolve(entry.intersectionRatio === 1);
                        observer.disconnect();
                    }
                },
                {
                    threshold: [0, 1],
                }
            );

            observer.observe(element);
        });
    }
    /**
     * @param {ListItemsCaptureContext} itemsContext
     */
    async function moveToNextItemElement(itemsContext) {
        // 前の要素の次を取得
        const itemElement =
            itemsContext.previousItemElement?.nextElementSibling ??
            itemsContext.listElement.querySelector("app-submissions-list-item");
        if (!(itemElement instanceof HTMLElement)) return null;

        itemsContext.previousItemElement = itemElement;

        // スクロールしてアイテムを表示
        do {
            await waitForScrollIntoView(itemElement, { behavior: "instant" });
        } while (
            // スクロールしても隠れる場合があるので、完全に表示されるまで繰り返す
            !(await isElementFullyVisible(itemElement))
        );
        return itemElement;
    }
    /**
     * @param {ImageCaptureContext} imageCaptureContext
     * @param {HTMLElement} itemElement
     * @param {number} itemIndex
     */
    async function captureItemToCanvas(
        imageCaptureContext,
        itemElement,
        itemIndex
    ) {
        const {
            track,
            imageContext,
            itemCountPerImage,
            tileCountY,
            itemWidth,
            itemHeight,
        } = imageCaptureContext;

        const canvas = document.createElement("canvas");
        canvas.width = itemWidth;
        canvas.height = itemHeight;
        const context = assertNonNull(canvas.getContext("2d"));

        // 白で塗りつぶす
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);

        // アイテムの画像が読み込まれるまで待機
        await waitForAllImageLoaded(itemElement);

        // キャンバスに画面をキャプチャ
        const rect = itemElement.getBoundingClientRect();
        const bitmap = await track.grabFrame();
        context.drawImage(
            bitmap,
            rect.left,
            rect.top,
            itemWidth,
            itemHeight,
            0,
            0,
            canvas.width,
            canvas.height
        );

        // 最終画像に画面をコピー
        const itemIndexPerImage = itemIndex % itemCountPerImage;
        const itemIndexX = Math.floor(itemIndexPerImage / tileCountY);
        const itemIndexY = itemIndexPerImage % tileCountY;
        imageContext.drawImage(
            canvas,
            itemIndexX * itemWidth,
            itemIndexY * itemHeight,
            itemWidth,
            itemHeight
        );
    }

    /**
     * @param {Track} track
     * @param {HTMLElement} listElement
     */
    async function captureElementWithTrack(track, listElement) {
        // キャプチャ中を知らせる通知バーの追加による要素のサイズ変更が収まるのを待つ
        await sleep(1000);

        // リストアイテムを何枚の画像に分割するか
        const defaultImageCount = 4;
        const itemHeight = /** @type {HTMLElement} */ (
            listElement.querySelectorAll("app-submissions-list-item")[0]
        ).offsetHeight;
        const { scrollHeight, clientWidth: itemWidth } = listElement;

        const listWrapper =
            document.querySelector(".cdk-virtual-scroll-content-wrapper") ??
            error`list wrapper element not found`;
        /** @type {number} */
        const allItemCount = listWrapper["__ngContext__"][3][26].length;

        const result = await showConfigDialog({
            imageCount: defaultImageCount,
            imageRatioX: 4,
            imageRatioY: 3,
            rangeStartNth: 1,
            rangeEndNth: allItemCount,
        });
        if (result === "Canceled") return;

        const {
            imageCount,
            imageRatioX,
            imageRatioY,
            // TODO:
            rangeStartNth,
            rangeEndNth,
        } = result;

        const skipCount = rangeStartNth - 1;
        const itemCount = rangeEndNth - rangeStartNth + 1;

        /** 画像1枚ごとのリストアイテム数 */
        const itemCountPerImage = Math.ceil(itemCount / imageCount);
        const [tileCountX, tileCountY] = getTileCount(
            itemCountPerImage,
            [itemWidth, itemHeight],
            [imageRatioX, imageRatioY]
        );

        // 一番上までスクロールして最初の要素を生成させる
        await waitForScrollTo(listElement, { behavior: "instant", top: 0 });

        let itemIndex = 0;
        /** @type {ListItemsCaptureContext} */
        const itemsContext = {
            previousItemElement: null,
            listElement,
        };
        // 最初のアイテムまでスキップする
        for (let i = 0; i < skipCount; i++) {
            const itemElement = await moveToNextItemElement(itemsContext);
            if (itemElement === null)
                return error`item element must be an HTML element`;
        }
        for (let imageIndex = 0; imageIndex < imageCount; imageIndex++) {
            const imageCanvas = document.createElement("canvas");
            imageCanvas.width = itemWidth * tileCountX;
            imageCanvas.height = itemHeight * tileCountY;
            const imageContext = assertNonNull(imageCanvas.getContext("2d"));

            /** @type {ImageCaptureContext} */
            const captureContext = {
                itemsContext,
                imageContext,
                itemCount,
                imageCount,
                itemCountPerImage,
                track,
                tileCountX,
                tileCountY,
                itemHeight,
                itemWidth,
            };
            console.log(captureContext);

            for (
                ;
                itemIndex <
                Math.min((imageIndex + 1) * itemCountPerImage, itemCount);
                itemIndex++
            ) {
                const itemElement = await moveToNextItemElement(itemsContext);
                if (itemElement === null)
                    return error`item element must be an HTML element`;

                await captureItemToCanvas(
                    captureContext,
                    itemElement,
                    itemIndex
                );
            }

            const imageBlob = await canvasToBlobAsync(imageCanvas, "image/png");
            if (imageBlob == null)
                return error`Can not create blob from canvas`;

            let imageUrl;
            try {
                imageUrl = URL.createObjectURL(imageBlob);

                if (
                    (await displayPreview(imageUrl, ["保存", "キャンセル"])) ===
                    "保存"
                ) {
                    const link = document.createElement("a");
                    link.href = imageUrl;
                    link.download = "captured_element.png";
                    link.click();
                }
            } finally {
                if (imageUrl != null) {
                    URL.revokeObjectURL(imageUrl);
                }
            }
        }
    }
    /**
     * @param {HTMLElement} listElement
     */
    async function captureElement(listElement) {
        await waitForScrollIntoView(listElement, { behavior: "instant" });
        await withCurrentTabVideoTrack0((track) =>
            captureElementWithTrack(track, listElement)
        );
    }
    /**
     * @typedef {Object} CaptureConfig
     * @property {number} imageCount - キャプチャ時に何枚の画像に分割するか
     * @property {number} imageRatioX - 一枚の画像の比率（幅）
     * @property {number} imageRatioY - 一枚の画像の比率（高さ）
     * @property {number} rangeStartNth - キャプチャする最初のリストアイテムの番号（1始まり）
     * @property {number} rangeEndNth - キャプチャする最後のリストアイテムの番号（1始まり）
     */

    /**
     * 設定画面を表示し、ユーザーが入力した設定を返す
     * @param {CaptureConfig} initialConfig - 初期設定値
     * @returns {Promise<CaptureConfig | "Canceled">} - 更新された設定、またはキャンセルされた場合は "Canceled"
     */
    function showConfigDialog(initialConfig) {
        return new Promise((resolve, reject) => {
            // ダイアログを作成
            const dialog = document.createElement("dialog");
            dialog.innerHTML = `
        <form method="dialog">
          <h2>キャプチャ設定</h2>
          <label>
            画像分割数:
            <input type="number" id="imageCount" value="${initialConfig.imageCount}" min="1" required>
          </label>
          <label>
            画像比率 (幅):
            <input type="number" id="imageRatioX" value="${initialConfig.imageRatioX}" min="1" required>
          </label>
          <label>
            画像比率 (高さ):
            <input type="number" id="imageRatioY" value="${initialConfig.imageRatioY}" min="1" required>
          </label>
          <label>
            開始アイテム番号:
            <input type="number" id="rangeStartNth" value="${initialConfig.rangeStartNth}" min="1" required>
          </label>
          <label>
            終了アイテム番号:
            <input type="number" id="rangeEndNth" value="${initialConfig.rangeEndNth}" min="1" required>
          </label>
          <button type="submit">保存</button>
          <button type="button" id="cancelButton">キャンセル</button>
        </form>
      `;

            // スタイルを追加
            const style = document.createElement("style");
            style.textContent = `
        dialog {
          padding: 20px;
          border-radius: 5px;
          border: 1px solid #ccc;
        }
        form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        label {
          display: flex;
          justify-content: space-between;
        }
        input {
          width: 100px;
        }
        button {
          padding: 5px 10px;
        }
      `;
            dialog.appendChild(style);

            // ダイアログを body に追加
            document.body.appendChild(dialog);

            // ダイアログを開く
            dialog.showModal();

            /**
             * @param {string} id
             */
            function getDialogValue(id) {
                return /** @type {HTMLInputElement} */ (
                    dialog.querySelector("#" + id)
                ).value;
            }

            // フォームの送信イベントを処理
            assertNonNull(dialog.querySelector("form")).addEventListener(
                "submit",
                (event) => {
                    event.preventDefault();
                    const updatedConfig = {
                        imageCount: parseInt(getDialogValue("imageCount"), 10),
                        imageRatioX: parseFloat(getDialogValue("imageRatioX")),
                        imageRatioY: parseFloat(getDialogValue("imageRatioY")),
                        rangeStartNth: parseInt(
                            getDialogValue("rangeStartNth"),
                            10
                        ),
                        rangeEndNth: parseInt(
                            getDialogValue("rangeEndNth"),
                            10
                        ),
                    };
                    dialog.close();
                    resolve(updatedConfig);
                }
            );

            // キャンセルボタンのイベントを処理
            assertNonNull(
                dialog.querySelector("#cancelButton")
            ).addEventListener("click", () => {
                dialog.close();
                resolve("Canceled");
            });

            // ダイアログが閉じられたときのクリーンアップ
            dialog.addEventListener("close", () => {
                document.body.removeChild(dialog);
            });
        });
    }

    /**
     * @template {string} TChoices
     * @param {string} imageUrl
     * @param {readonly TChoices[]} choices
     * @returns {Promise<TChoices>}
     */
    function displayPreview(imageUrl, choices) {
        return new Promise((resolve) => {
            const previewDiv = document.createElement("div");
            previewDiv.style.position = "fixed";
            previewDiv.style.top = "50%";
            previewDiv.style.left = "50%";
            previewDiv.style.transform = "translate(-50%, -50%)";
            previewDiv.style.background = `
                  repeating-linear-gradient(
                      45deg,
                      #cccccc80,
                      #cccccc80 10px,
                      #ffffff80 10px,
                      #ffffff80 20px
                  )`;
            previewDiv.style.padding = "10px";
            previewDiv.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
            previewDiv.style.zIndex = String(10000);

            const img = document.createElement("img");
            img.src = imageUrl;
            img.style.maxWidth = "100%";
            img.style.maxHeight = "80vh";

            previewDiv.appendChild(img);
            for (const choice of choices) {
                const button = document.createElement("button");
                button.textContent = choice;
                button.style.marginTop = "10px";
                button.style.marginLeft = "10px";
                button.addEventListener("click", () => {
                    document.body.removeChild(previewDiv);
                    resolve(choice);
                });
                previewDiv.appendChild(button);
            }
            document.body.appendChild(previewDiv);
        });
    }

    /**
     * @param {string} message
     */
    function appendButton(message) {
        const e = document.createElement("button");
        e.textContent = message;
        e.style.position = "fixed";
        e.style.right = "0";
        document.body.appendChild(e);
        return e;
    }

    const listItemSelector =
        "body > app-root > app-wayfarer > div > mat-sidenav-container > mat-sidenav-content > div > app-submissions > div > div > div > div > app-submissions-list > div > cdk-virtual-scroll-viewport";
    appendButton("Capture").addEventListener("click", () => {
        const e = document.body.querySelectorAll(listItemSelector)[0];
        captureElement(e instanceof HTMLElement ? e : error`not found`).catch(
            (e) => console.error("キャプチャ中にエラーが発生しました:", e)
        );
    });
})();
