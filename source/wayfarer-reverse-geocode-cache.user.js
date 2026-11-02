// ==UserScript==
// @name         Wayfarer Reverse Geocode Fetch Cache
// @namespace    https://wayfarer.scopely.com/
// @version      1.1.0
// @description  Cache Wayfarer reverse-geocode fetch responses in IndexedDB
// @match        https://wayfarer.scopely.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// @ts-check

(() => {
    "use strict";

    // ------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------

    /** @typedef {{
     * key: string,
     * body: string,
     * headers: Record<string, string>,
     * status: number,
     * statusText: string,
     * timestamp: number
     * }}
     * CacheEntry
     */

    const DB_NAME =
        "wayfarer-reverse-geocode-cache-B2FD3BB0-CB64-43F8-9BA2-9054618CE311";
    const DB_VERSION = 1;
    const STORE_NAME = "responses";

    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
    const MAX_CACHE_ENTRIES = 10000;

    const TARGET_ORIGIN = "https://wayfarer.scopely.com";
    const TARGET_PATH = "/api/v1/vault/reverse-geocode";

    // ------------------------------------------------------------
    // IndexedDB
    // ------------------------------------------------------------

    /** @type {Promise<IDBDatabase> | null} */
    let dbPromise = null;

    /** @returns {Promise<IDBDatabase>} */
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

    /**
     * @template T
     * @param {IDBRequest<T>} request
     * @returns {Promise<T>}
     */
    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ------------------------------------------------------------
    // URL handling
    // ------------------------------------------------------------

    /** @param {string | URL} input */
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

    /**
     * @param {string} key
     * @returns {Promise<CacheEntry | null>}
     */
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

    /** @param {string} key @param {string} body @param {Record<string, string>} headers @param {number} status @param {string} statusText */
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

            await /** @satisfies {Promise<void>} */ (
                new Promise((resolve, reject) => {
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
                })
            );
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

            await /** @satisfies {Promise<void>} */ (
                new Promise((resolve, reject) => {
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
                })
            );
        } catch (error) {
            console.warn(
                "[ReverseGeocodeCache] Cache limit cleanup failed:",
                error
            );
        }
    }

    // ------------------------------------------------------------
    // Cached fetch wrapper
    // ------------------------------------------------------------

    /** @type {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} */
    const nativeFetch = window.fetch.bind(window);

    /** @param {string} contentType */
    function isJSONContentType(contentType) {
        return /^application\/json(?:\s*;|$)/i.test(contentType.trim());
    }

    /** @param {RequestInfo | URL} input @param {RequestInit} [init] @returns {Promise<Response>} */
    window.fetch = async function (input, init) {
        let request;
        try {
            request = new Request(input, init);
        } catch {
            return nativeFetch(input, init);
        }

        const target = parseTargetURL(request.url);
        if (request.method !== "GET" || !target) {
            return nativeFetch(input, init);
        }

        const entry = await getCached(target.key);
        if (entry) {
            return new Response(entry.body, {
                status: entry.status,
                statusText: entry.statusText,
                headers: entry.headers,
            });
        }

        const response = await nativeFetch(input, init);
        const contentType = response.headers.get("content-type");
        if (!response.ok || !isJSONContentType(contentType ?? "")) {
            return response;
        }

        try {
            const body = await response.clone().text();
            JSON.parse(body);
            const headers = Object.fromEntries(response.headers.entries());
            await setCached(
                target.key,
                body,
                headers,
                response.status,
                response.statusText
            );
        } catch (error) {
            console.warn("[ReverseGeocodeCache] Response cache failed:", error);
        }

        return response;
    };

    /*
     * 起動時に期限切れエントリを非同期削除。
     * ページロードをブロックしない。
     */
    deleteExpired()
        .then(enforceCacheLimit)
        .catch(() => {
            // ignore errors
        });

    console.debug("[ReverseGeocodeCache] fetch cache installed");
})();
