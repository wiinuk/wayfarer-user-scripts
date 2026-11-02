// ==UserScript==
// @name         Wayfarer Nominations Screenshot
// @namespace    https://github.com/wiinuk/wayfarer-user-scripts
// @version      1.4
// @description  Save screenshots of multiple nominations in one image.
// @author       Wiinuk
// @match        https://wayfarer.scopely.com/submit*
// @grant        none
// @run-at       document-idle
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
            const cols = Math.ceil(tileCount / rows);
            const actualAspectRatio = (cols * tileWidth) / (rows * tileHeight);
            const aspectRatioDiff = Math.abs(
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
        if (!track) return error`No video track available`;

        try {
            track.contentHint = "detail";
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
     * @property {HTMLElement} scrollElement
     * @property {string} itemSelector
     * @property {number} totalItemCount
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
     * @property {number} scaleX
     * @property {number} scaleY
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
                if (entries[0]?.isIntersecting) {
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
        return new Promise((resolve, _reject) => {
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
                    if (entry?.isIntersecting) {
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
        const nextElement =
            itemsContext.previousItemElement?.nextElementSibling;
        const itemElement = itemsContext.previousItemElement
            ? nextElement?.matches(itemsContext.itemSelector)
                ? nextElement
                : null
            : itemsContext.listElement.querySelector(
                  itemsContext.itemSelector
              );
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
            scaleX,
            scaleY,
        } = imageCaptureContext;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(itemWidth * scaleX);
        canvas.height = Math.round(itemHeight * scaleY);
        const context = assertNonNull(canvas.getContext("2d"));
        context.imageSmoothingEnabled = false;

        // 白で塗りつぶす
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);

        // アイテムの画像が読み込まれるまで待機
        await waitForAllImageLoaded(itemElement);

        // キャンバスに画面をキャプチャ
        const rect = itemElement.getBoundingClientRect();
        const bitmap = await track.grabFrame();
        const sourceX = Math.round(rect.left * scaleX);
        const sourceY = Math.round(rect.top * scaleY);
        context.drawImage(
            bitmap,
            sourceX,
            sourceY,
            canvas.width,
            canvas.height,
            0,
            0,
            canvas.width,
            canvas.height
        );

        // 最終画像に画面をコピー
        const itemIndexPerImage = itemIndex % itemCountPerImage;
        const itemIndexX = Math.floor(itemIndexPerImage / tileCountY);
        const itemIndexY = itemIndexPerImage % tileCountY;
        const destinationX = itemIndexX * canvas.width;
        const destinationY = itemIndexY * canvas.height;
        imageContext.drawImage(
            canvas,
            destinationX,
            destinationY,
            canvas.width,
            canvas.height
        );
    }

    /**
     * @param {Track} track
     * @param {ListItemsCaptureContext} listElement
     */
    async function captureElementWithTrack(track, listElement) {
        // キャプチャ中を知らせる通知バーの追加による要素のサイズ変更が収まるのを待つ
        await sleep(1000);

        const firstItem = listElement.listElement.querySelector(
            listElement.itemSelector
        );
        if (!(firstItem instanceof HTMLElement))
            return error`list item element not found`;

        // リストアイテムを何枚の画像に分割するか
        const defaultImageCount = 4;
        const firstItemRect = firstItem.getBoundingClientRect();
        const itemHeight = firstItemRect.height;
        const itemWidth = firstItemRect.width;

        const result = await showConfigDialog({
            imageCount: defaultImageCount,
            imageRatioX: 4,
            imageRatioY: 3,
            rangeStartNth: 1,
            rangeEndNth: listElement.totalItemCount,
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

        await loadItemsThrough(listElement, rangeEndNth);

        const scaleFrame = await track.grabFrame();
        const scaleX = scaleFrame.width / window.innerWidth;
        const scaleY = scaleFrame.height / window.innerHeight;
        scaleFrame.close();
        if (
            !Number.isFinite(scaleX) ||
            !Number.isFinite(scaleY) ||
            scaleX <= 0 ||
            scaleY <= 0
        ) {
            return error`could not determine capture resolution`;
        }

        /** 画像1枚ごとのリストアイテム数 */
        const itemCountPerImage = Math.ceil(itemCount / imageCount);
        const [tileCountX, tileCountY] = getTileCount(
            itemCountPerImage,
            [itemWidth, itemHeight],
            [imageRatioX, imageRatioY]
        );

        // 一番上までスクロールして最初の要素を生成させる
        await waitForScrollTo(listElement.scrollElement, {
            behavior: "instant",
            top: 0,
        });

        let itemIndex = 0;
        const outputTileWidth = Math.round(itemWidth * scaleX);
        const outputTileHeight = Math.round(itemHeight * scaleY);
        /** @type {ListItemsCaptureContext} */
        const itemsContext = {
            previousItemElement: null,
            listElement: listElement.listElement,
            scrollElement: listElement.scrollElement,
            itemSelector: listElement.itemSelector,
            totalItemCount: listElement.totalItemCount,
        };
        // 最初のアイテムまでスキップする
        for (let i = 0; i < skipCount; i++) {
            const itemElement = await moveToNextItemElement(itemsContext);
            if (itemElement === null)
                return error`item element must be an HTML element`;
        }
        for (let imageIndex = 0; imageIndex < imageCount; imageIndex++) {
            const imageCanvas = document.createElement("canvas");
            imageCanvas.width = outputTileWidth * tileCountX;
            imageCanvas.height = outputTileHeight * tileCountY;
            const imageContext = assertNonNull(imageCanvas.getContext("2d"));
            imageContext.imageSmoothingEnabled = false;

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
                scaleX,
                scaleY,
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
     * @param {ListItemsCaptureContext} listElement
     */
    async function captureElement(listElement) {
        const firstItem = listElement.listElement.querySelector(
            listElement.itemSelector
        );
        if (!(firstItem instanceof HTMLElement))
            return error`list item element not found`;

        await waitForScrollIntoView(firstItem, { behavior: "instant" });
        await withCurrentTabVideoTrack0((track) =>
            captureElementWithTrack(track, listElement)
        );
    }

    /**
     * @param {ListItemsCaptureContext} listContext
     * @param {number} requiredItemCount
     */
    async function loadItemsThrough(listContext, requiredItemCount) {
        while (
            listContext.listElement.querySelectorAll(
                listContext.itemSelector
            ).length < requiredItemCount
        ) {
            const previousCount = listContext.listElement.querySelectorAll(
                listContext.itemSelector
            ).length;
            const loadMoreContainer = listContext.listElement.lastElementChild;
            const loadMoreButton =
                loadMoreContainer &&
                !loadMoreContainer.matches(listContext.itemSelector)
                    ? loadMoreContainer.querySelector("button")
                    : null;
            if (!(loadMoreButton instanceof HTMLButtonElement))
                return error`load more button not found`;

            await waitForScrollIntoView(loadMoreButton, {
                behavior: "instant",
            });
            loadMoreButton.click();
            await waitForMoreItems(listContext, previousCount);
        }
    }

    /**
     * @param {ListItemsCaptureContext} listContext
     * @param {number} previousCount
     * @returns {Promise<void>}
     */
    function waitForMoreItems(listContext, previousCount) {
        if (
            listContext.listElement.querySelectorAll(
                listContext.itemSelector
            ).length > previousCount
        ) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
                if (
                    listContext.listElement.querySelectorAll(
                        listContext.itemSelector
                    ).length > previousCount
                ) {
                    clearTimeout(timeoutId);
                    observer.disconnect();
                    resolve(undefined);
                }
            });
            const timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error("Timed out while loading more submissions"));
            }, 10000);
            observer.observe(listContext.listElement, {
                childList: true,
                subtree: true,
            });
        });
    }

    /**
     * @returns {ListItemsCaptureContext}
     */
    function findListItemsContext() {
        const submissionsSection = document.querySelector(
            '[data-testid="submit-submissions"]'
        );
        const firstSubmission = submissionsSection?.querySelector(
            '[data-testid="managed-submission-card"]'
        );

        if (
            submissionsSection instanceof HTMLElement &&
            firstSubmission instanceof HTMLElement &&
            firstSubmission.parentElement instanceof HTMLElement
        ) {
            const activeTab = [...document.querySelectorAll(
                'button[aria-pressed="true"]'
            )].find((button) => /\(\s*\d[\d,]*\s*\)/.test(button.textContent ?? ""));
            const countText = activeTab?.textContent?.match(
                /\(\s*(\d[\d,]*)\s*\)/
            )?.[1];
            const totalItemCount = countText
                ? Number(countText.replace(/,/g, ""))
                : NaN;
            if (!Number.isSafeInteger(totalItemCount) || totalItemCount < 1)
                return error`could not determine the submission count`;

            const scrollElement = document.querySelector(
                '[data-testid="app-route-scroll"]'
            );
            if (!(scrollElement instanceof HTMLElement))
                return error`submission scroll element not found`;

            return {
                previousItemElement: null,
                listElement: firstSubmission.parentElement,
                scrollElement,
                itemSelector: '[data-testid="managed-submission-card"]',
                totalItemCount,
            };
        }

        return error`submission list not found`;
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
        return new Promise((resolve, _reject) => {
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
        e.style.top = "80px";
        e.style.right = "16px";
        e.style.zIndex = "1000";
        document.body.appendChild(e);
        return e;
    }

    appendButton("Capture").addEventListener("click", () => {
        captureElement(findListItemsContext()).catch(
            (e) => console.error("キャプチャ中にエラーが発生しました:", e)
        );
    });
})();
