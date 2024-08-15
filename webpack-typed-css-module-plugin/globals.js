//@ts-check

const { promisify } = require("node:util");
const nodeFs = require("node:fs");

/**
 * @typedef {Object} FilledGlobals
 * @property {Console | ReturnType<import("webpack").Compiler["getInfrastructureLogger"]>} console
 * @property {GlobalFs} fs
 *
 * @typedef {Partial<FilledGlobals>} Globals
 */

/**
 * @typedef {import("webpack").Compiler["intermediateFileSystem"]} WebpackFs
 * @typedef {import("fs/promises")} NodeFs
 *
 * @typedef {import("fs")} GlobalFs
 * @property {(path: string) => Promise<Buffer | string>} readFile
 * @property {(path: string, contents: Buffer | string) => Promise<void>} writeFile
 */

/**
 * @param {Globals} globals
 * @return {FilledGlobals}
 */
exports.fill = ({ fs = nodeFs, console = globalThis.console }) => ({
    fs,
    console,
});

/** @type {<Ts extends unknown[]>(...args: Ts) => Promise<never>} */
const notImplementedAsync = async () => {
    throw new Error(`not implemented`);
};
const notImplemented = () => {
    throw new Error(`not implemented`);
};

/**
 * @template F
 * @template {string | number | symbol} K, V
 * @param {F} f
 * @param {K} k
 * @param {V} v
 * @returns {F & { [_ in K]: V }}
 */
const withField = (f, k, v) => {
    const x = /** @type {any} */ (f);
    x[k] = v;
    return x;
};

const genericErrorFunction = withField(
    withField(notImplemented, "__promisify__", notImplementedAsync),
    "native",
    notImplemented
);

/**
 * @param {WebpackFs} fs
 */
exports.wrapWebpackFileSystem = (fs) => {
    const partialFs = {
        ...fs,
        readFile: withField(
            fs.readFile,
            "__promisify__",
            promisify(fs.readFile)
        ),
        writeFile: withField(
            fs.writeFile,
            "__promisify__",
            promisify(fs.writeFile)
        ),
    };
    return /** @type {GlobalFs} */ (
        new Proxy(partialFs, {
            get(target, key, receiver) {
                if (key in target) {
                    return target[key];
                }
                return genericErrorFunction;
            },
        })
    );
};
