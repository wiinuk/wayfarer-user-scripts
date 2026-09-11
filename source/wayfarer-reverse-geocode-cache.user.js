// ==UserScript==
// @name         Wayfarer Reverse Geocode XHR Cache
// @namespace    https://wayfarer.scopely.com/
// @version      1.0.0
// @description  Cache Wayfarer reverse-geocode XHR responses in IndexedDB
// @match        https://wayfarer.scopely.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    "use strict";
    const NativeXHR = window.XMLHttpRequest;

    // ------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------

    const DB_NAME =
        "wayfarer-reverse-geocode-cache-B2FD3BB0-CB64-43F8-9BA2-9054618CE311";
    const DB_VERSION = 1;
    const STORE_NAME = "responses";

    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
    const MAX_CACHE_ENTRIES = 5000;

    const TARGET_ORIGIN = "https://wayfarer.scopely.com";
    const TARGET_PATH = "/api/v1/vault/reverse-geocode";

    // ------------------------------------------------------------
    // IndexedDB
    // ------------------------------------------------------------

    let dbPromise = null;

    function openDB() {
        if (dbPromise) {
            return dbPromise;
        }

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;

                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, {
                        keyPath: "key",
                    });

                    store.createIndex("timestamp", "timestamp", {
                        unique: false,
                    });
                }
            };

            request.onsuccess = () => {
                const db = request.result;

                db.onversionchange = () => {
                    db.close();
                    dbPromise = null;
                };

                resolve(db);
            };

            request.onerror = () => {
                console.warn(
                    "[ReverseGeocodeCache] IndexedDB open failed:",
                    request.error
                );

                dbPromise = null;
                reject(request.error);
            };
        });

        return dbPromise;
    }

    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ------------------------------------------------------------
    // URL handling
    // ------------------------------------------------------------

    function parseTargetURL(input) {
        try {
            const url = new URL(input, location.href);

            if (url.origin !== TARGET_ORIGIN) {
                return null;
            }

            if (url.pathname !== TARGET_PATH) {
                return null;
            }

            /*
             * lat / lng が存在する形式だけ対象。
             *
             * 例:
             * https://wayfarer.scopely.com/api/v1/vault/reverse-geocode
             *   ?lat=38.123&lng=140.456
             */
            if (!url.searchParams.has("lat") || !url.searchParams.has("lng")) {
                return null;
            }

            // 指定API形式以外の余計なパラメータを除外
            const keys = [...url.searchParams.keys()];

            if (keys.some((key) => key !== "lat" && key !== "lng")) {
                return null;
            }

            /*
             * lat/lng の順番が違っても同じ座標なら
             * 同一キャッシュとして扱う。
             */
            const lat = url.searchParams.get("lat");
            const lng = url.searchParams.get("lng");

            if (lat === null || lng === null) {
                return null;
            }

            return {
                url,
                key: `${TARGET_ORIGIN}${TARGET_PATH}?lat=${lat}&lng=${lng}`,
            };
        } catch {
            return null;
        }
    }

    // ------------------------------------------------------------
    // Cache operations
    // ------------------------------------------------------------

    async function getCached(key) {
        try {
            const db = await openDB();

            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);

            const entry = await requestToPromise(store.get(key));

            if (!entry) {
                return null;
            }

            const age = Date.now() - entry.timestamp;

            // Expired
            if (age >= CACHE_TTL) {
                store.delete(key);
                return null;
            }

            return entry;
        } catch (error) {
            console.warn("[ReverseGeocodeCache] Cache read failed:", error);

            return null;
        }
    }

    async function setCached(key, body, headers, status, statusText) {
        try {
            const db = await openDB();

            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);

                store.put({
                    key,
                    body,
                    headers,
                    status,
                    statusText,
                    timestamp: Date.now(),
                });

                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });

            await enforceCacheLimit();
        } catch (error) {
            console.warn("[ReverseGeocodeCache] Cache write failed:", error);
        }
    }

    async function deleteExpired() {
        try {
            const db = await openDB();

            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("timestamp");

            const cutoff = Date.now() - CACHE_TTL;

            const range = IDBKeyRange.upperBound(cutoff, true);

            await new Promise((resolve, reject) => {
                const request = index.openCursor(range);

                request.onsuccess = () => {
                    const cursor = request.result;

                    if (!cursor) {
                        resolve();
                        return;
                    }

                    cursor.delete();
                    cursor.continue();
                };

                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn(
                "[ReverseGeocodeCache] Expiration cleanup failed:",
                error
            );
        }
    }

    async function enforceCacheLimit() {
        try {
            const db = await openDB();

            const countTx = db.transaction(STORE_NAME, "readonly");
            const countStore = countTx.objectStore(STORE_NAME);

            const count = await requestToPromise(countStore.count());

            if (count <= MAX_CACHE_ENTRIES) {
                return;
            }

            let removeCount = count - MAX_CACHE_ENTRIES;

            /*
             * timestamp index は古い順で cursor が進むので、
             * 超過した分だけ最古のエントリから削除する。
             */
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("timestamp");

            await new Promise((resolve, reject) => {
                const request = index.openCursor();

                request.onsuccess = () => {
                    const cursor = request.result;

                    if (!cursor || removeCount <= 0) {
                        resolve();
                        return;
                    }

                    cursor.delete();

                    removeCount--;
                    cursor.continue();
                };

                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn(
                "[ReverseGeocodeCache] Cache limit cleanup failed:",
                error
            );
        }
    }

    // ------------------------------------------------------------
    // Headers
    // ------------------------------------------------------------

    function parseResponseHeaders(raw) {
        const result = Object.create(null);

        for (const line of raw.trim().split(/[\r\n]+/)) {
            if (!line) {
                continue;
            }

            const index = line.indexOf(":");

            if (index < 0) {
                continue;
            }

            const name = line.slice(0, index).trim().toLowerCase();
            const value = line.slice(index + 1).trim();

            if (result[name]) {
                result[name] += ", " + value;
            } else {
                result[name] = value;
            }
        }

        return result;
    }

    function headersToString(headers) {
        return Object.entries(headers)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\r\n");
    }

    function isJSONContentType(contentType) {
        if (!contentType) {
            return false;
        }

        /*
         * application/json
         * application/json; charset=utf-8
         *
         * のみ許可。
         */
        return /^application\/json(?:\s*;|$)/i.test(contentType.trim());
    }

    // ------------------------------------------------------------
    // Cached XMLHttpRequest wrapper
    // ------------------------------------------------------------

    class CachedXMLHttpRequest extends EventTarget {
        constructor() {
            super();

            this._xhr = new NativeXHR();

            this._method = null;
            this._url = null;
            this._async = true;

            this._target = null;

            this._requestHeaders = [];

            this._servedFromCache = false;
            this._cachedEntry = null;

            this._readyState = NativeXHR.UNSENT;

            this._responseType = "";
            this._timeout = 0;
            this._withCredentials = false;

            this._aborted = false;

            // Traditional XHR event handlers
            this.onreadystatechange = null;
            this.onloadstart = null;
            this.onprogress = null;
            this.onabort = null;
            this.onerror = null;
            this.onload = null;
            this.ontimeout = null;
            this.onloadend = null;

            this._bindNativeEvents();
        }

        // --------------------------------------------------------
        // Static-like constants on instance
        // --------------------------------------------------------

        get UNSENT() {
            return 0;
        }

        get OPENED() {
            return 1;
        }

        get HEADERS_RECEIVED() {
            return 2;
        }

        get LOADING() {
            return 3;
        }

        get DONE() {
            return 4;
        }

        // --------------------------------------------------------
        // XHR properties
        // --------------------------------------------------------

        get readyState() {
            if (this._servedFromCache) {
                return this._readyState;
            }

            return this._xhr.readyState;
        }

        get responseURL() {
            if (this._servedFromCache) {
                return this._url ? new URL(this._url, location.href).href : "";
            }

            return this._xhr.responseURL;
        }

        get status() {
            if (this._servedFromCache) {
                return this._cachedEntry?.status ?? 0;
            }

            return this._xhr.status;
        }

        get statusText() {
            if (this._servedFromCache) {
                return this._cachedEntry?.statusText ?? "";
            }

            return this._xhr.statusText;
        }

        get responseType() {
            return this._responseType;
        }

        set responseType(value) {
            this._responseType = value;

            /*
             * text / json 以外の場合はキャッシュを使用せず
             * Native XHR に任せる。
             */
            this._xhr.responseType = value;
        }

        get responseText() {
            if (this._servedFromCache) {
                if (
                    this._responseType !== "" &&
                    this._responseType !== "text"
                ) {
                    throw new DOMException(
                        'The value is only accessible if responseType is "" or "text".',
                        "InvalidStateError"
                    );
                }

                return this._cachedEntry?.body ?? "";
            }

            return this._xhr.responseText;
        }

        get response() {
            if (!this._servedFromCache) {
                return this._xhr.response;
            }

            const body = this._cachedEntry?.body ?? "";

            switch (this._responseType) {
                case "json":
                    try {
                        return JSON.parse(body);
                    } catch {
                        return null;
                    }

                case "":
                case "text":
                    return body;

                default:
                    return null;
            }
        }

        get responseXML() {
            if (this._servedFromCache) {
                return null;
            }

            return this._xhr.responseXML;
        }

        get timeout() {
            return this._timeout;
        }

        set timeout(value) {
            this._timeout = value;
            this._xhr.timeout = value;
        }

        get withCredentials() {
            return this._withCredentials;
        }

        set withCredentials(value) {
            this._withCredentials = Boolean(value);
            this._xhr.withCredentials = Boolean(value);
        }

        get upload() {
            return this._xhr.upload;
        }

        // --------------------------------------------------------
        // Native event forwarding
        // --------------------------------------------------------

        _bindNativeEvents() {
            const eventNames = [
                "readystatechange",
                "loadstart",
                "progress",
                "abort",
                "error",
                "load",
                "timeout",
                "loadend",
            ];

            for (const type of eventNames) {
                this._xhr.addEventListener(type, (nativeEvent) => {
                    /*
                     * send() がキャッシュ処理中のときに Native XHR
                     * はまだ送信されないので通常ここには来ない。
                     */
                    if (this._servedFromCache) {
                        return;
                    }

                    const event = this._cloneEvent(nativeEvent);

                    this._dispatch(type, event);
                });
            }

            /*
             * Native XHR が完了したら条件を満たすレスポンスを保存。
             */
            this._xhr.addEventListener("load", () => {
                this._storeNativeResponseIfEligible();
            });
        }

        _cloneEvent(nativeEvent) {
            if (nativeEvent instanceof ProgressEvent) {
                return new ProgressEvent(nativeEvent.type, {
                    lengthComputable: nativeEvent.lengthComputable,
                    loaded: nativeEvent.loaded,
                    total: nativeEvent.total,
                });
            }

            return new Event(nativeEvent.type);
        }

        _dispatch(type, event = new Event(type)) {
            super.dispatchEvent(event);

            const handler = this["on" + type];

            if (typeof handler === "function") {
                try {
                    handler.call(this, event);
                } catch (error) {
                    setTimeout(() => {
                        throw error;
                    });
                }
            }
        }

        // --------------------------------------------------------
        // XMLHttpRequest methods
        // --------------------------------------------------------

        open(
            method,
            url,
            async = true,
            username = undefined,
            password = undefined
        ) {
            this._method = String(method).toUpperCase();
            this._url = String(url);
            this._async = async !== false;

            this._target = parseTargetURL(this._url);

            this._servedFromCache = false;
            this._cachedEntry = null;
            this._aborted = false;

            this._requestHeaders = [];

            /*
             * IndexedDB は非同期 API のため同期XHRは
             * キャッシュ対象外。
             */
            if (username !== undefined) {
                this._xhr.open(method, url, async, username, password);
            } else {
                this._xhr.open(method, url, async);
            }

            this._readyState = NativeXHR.OPENED;
        }

        async send(body = null) {
            const eligible =
                this._method === "GET" &&
                this._target !== null &&
                this._async === true &&
                (this._responseType === "" ||
                    this._responseType === "text" ||
                    this._responseType === "json");

            if (!eligible) {
                this._xhr.send(body);
                return;
            }

            /*
             * GET なので body が存在するケースでも Native XHR の
             * 動作との互換性を優先し、そのままキャッシュ対象外にする。
             */
            if (body !== null && body !== undefined) {
                this._xhr.send(body);
                return;
            }

            const entry = await getCached(this._target.key);

            if (this._aborted) {
                return;
            }

            if (entry) {
                this._serveCached(entry);
                return;
            }

            this._xhr.send(null);
        }

        abort() {
            this._aborted = true;

            if (this._servedFromCache) {
                this._readyState = NativeXHR.UNSENT;

                this._dispatch("abort", new ProgressEvent("abort"));

                this._dispatch("loadend", new ProgressEvent("loadend"));

                return;
            }

            this._xhr.abort();
        }

        setRequestHeader(name, value) {
            this._requestHeaders.push([String(name), String(value)]);

            this._xhr.setRequestHeader(name, value);
        }

        getResponseHeader(name) {
            if (!this._servedFromCache) {
                return this._xhr.getResponseHeader(name);
            }

            if (!this._cachedEntry) {
                return null;
            }

            return (
                this._cachedEntry.headers[String(name).toLowerCase()] ?? null
            );
        }

        getAllResponseHeaders() {
            if (!this._servedFromCache) {
                return this._xhr.getAllResponseHeaders();
            }

            if (!this._cachedEntry) {
                return "";
            }

            return headersToString(this._cachedEntry.headers);
        }

        overrideMimeType(mime) {
            /*
             * overrideMimeType が使用された場合は Native XHR に
             * 設定自体は渡す。
             */
            return this._xhr.overrideMimeType(mime);
        }

        // --------------------------------------------------------
        // Cache response
        // --------------------------------------------------------

        _serveCached(entry) {
            this._servedFromCache = true;
            this._cachedEntry = entry;

            const body = entry.body ?? "";

            this._dispatch(
                "loadstart",
                new ProgressEvent("loadstart", {
                    lengthComputable: true,
                    loaded: 0,
                    total: body.length,
                })
            );

            this._readyState = NativeXHR.HEADERS_RECEIVED;
            this._dispatch("readystatechange");

            this._readyState = NativeXHR.LOADING;
            this._dispatch("readystatechange");

            this._dispatch(
                "progress",
                new ProgressEvent("progress", {
                    lengthComputable: true,
                    loaded: body.length,
                    total: body.length,
                })
            );

            this._readyState = NativeXHR.DONE;
            this._dispatch("readystatechange");

            const loadEvent = new ProgressEvent("load", {
                lengthComputable: true,
                loaded: body.length,
                total: body.length,
            });

            this._dispatch("load", loadEvent);

            this._dispatch(
                "loadend",
                new ProgressEvent("loadend", {
                    lengthComputable: true,
                    loaded: body.length,
                    total: body.length,
                })
            );
        }

        async _storeNativeResponseIfEligible() {
            if (this._method !== "GET" || !this._target || !this._async) {
                return;
            }

            /*
             * responseText を安全に取得できるのは
             * "", "text", "json" の場合のみ。
             */
            if (
                this._responseType !== "" &&
                this._responseType !== "text" &&
                this._responseType !== "json"
            ) {
                return;
            }

            /*
             * HTTP成功レスポンスのみ。
             *
             * 4xx/5xx を7日間保持してしまう事故を防ぐ。
             */
            if (this._xhr.status < 200 || this._xhr.status >= 300) {
                return;
            }

            const contentType = this._xhr.getResponseHeader("content-type");

            if (!isJSONContentType(contentType)) {
                return;
            }

            let body;

            try {
                if (this._responseType === "json") {
                    /*
                     * responseType=json の場合 responseText は
                     * 読めないため JSON を再シリアライズ。
                     */
                    if (this._xhr.response === null) {
                        return;
                    }

                    body = JSON.stringify(this._xhr.response);
                } else {
                    body = this._xhr.responseText;
                }
            } catch {
                return;
            }

            /*
             * JSONとして妥当か確認。
             */
            try {
                JSON.parse(body);
            } catch {
                return;
            }

            const rawHeaders = this._xhr.getAllResponseHeaders();

            const headers = parseResponseHeaders(rawHeaders);

            await setCached(
                this._target.key,
                body,
                headers,
                this._xhr.status,
                this._xhr.statusText
            );
        }
    }

    // ------------------------------------------------------------
    // Static constants
    // ------------------------------------------------------------

    CachedXMLHttpRequest.UNSENT = 0;
    CachedXMLHttpRequest.OPENED = 1;
    CachedXMLHttpRequest.HEADERS_RECEIVED = 2;
    CachedXMLHttpRequest.LOADING = 3;
    CachedXMLHttpRequest.DONE = 4;

    // Replace XMLHttpRequest
    window.XMLHttpRequest = CachedXMLHttpRequest;

    /*
     * 起動時に期限切れエントリを非同期削除。
     * ページロードをブロックしない。
     */
    deleteExpired()
        .then(enforceCacheLimit)
        .catch(() => {});

    console.debug("[ReverseGeocodeCache] XMLHttpRequest cache installed");
})();
