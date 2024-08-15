//@ts-check
const path = require("node:path");
const webpack = require("webpack");
const Glob = require("glob");
const { writeDeclarationAndMapFile } = require("./declaration-writer");
const Globals = require("./globals");

const pluginName = path.basename(__dirname);

/**
 * @typedef {import("./schema-type").Schema} Schema
 * @typedef {Readonly<import("./schema-type").SchemaType<typeof optionsSchema>>} PluginOptions
 * @typedef {Required<PluginOptions>} FilledPluginOptions
 */

/** @type {<T extends Schema>(x: T) => T} */
const schema = (x) => x;

const optionsSchema = schema({
    type: "object",
    properties: {
        pattern: {
            type: "string",
        },
    },
    additionalProperties: false,
});

/**
 * @template T
 * @param {string} pattern
 * @param {Glob.IOptions} options
 * @param {(filePath: string) => Promise<T>} asyncAction
 * @returns {Promise<T[]>}
 */
const mapGlobFiles = (pattern, options, asyncAction) => {
    return new Promise((resolve, reject) => {
        const g = new Glob.Glob(pattern, options);

        /** @type {Promise<T>[]} */
        const actionPromises = [];
        /** @type {Set<string>} */
        const paths = new Set();
        g.on("match", (/** @type {string} */ path) => {
            if (paths.has(path)) {
                return;
            }
            paths.add(path);
            actionPromises.push(asyncAction(path));
        });
        g.on("end", () => Promise.all(actionPromises).then(resolve, reject));
        g.on("error", (e) =>
            Promise.all(actionPromises).then(() => reject(e), reject)
        );
    });
};

/**
 * @param {FilledPluginOptions} options
 * @param {Globals.Globals} globals
 * @param {webpack.Compiler} compiler
 */
const writeDeclarationFileAndMaps = async (options, globals, compiler) => {
    const { fs, console } = Globals.fill(globals);

    const rootPath = compiler.context;
    console.log(
        `resolving css modules. pattern: '${options.pattern}', root: '${rootPath}'`
    );
    await mapGlobFiles(
        options.pattern,
        { fs, absolute: true, cwd: rootPath },
        async (filePath) => {
            console.log(`generating declaration file for '${filePath}'`);
            const file = await fs.readFile.__promisify__(filePath);
            await writeDeclarationAndMapFile(
                filePath,
                file.toString(),
                globals
            );
        }
    );
};

/**
 * @param {FilledPluginOptions} options
 * @param {Globals.Globals} globals
 * @param {webpack.Compiler} compiler
 */
const beforeCompileHook = async (options, globals, compiler) => {
    globals = Globals.fill(globals);
    await writeDeclarationFileAndMaps(options, globals, compiler);
};

/**
 * @implements {webpack.WebpackPluginInstance}
 */
module.exports = class TypedCssModulePlugin {
    /**
     * @param {PluginOptions} options
     */
    constructor(options = {}) {
        webpack.validateSchema(optionsSchema, options);
        const { pattern = "**/*.module.css" } = options;

        /** @private @readonly @type {FilledPluginOptions} */
        this._options = {
            pattern,
        };
    }
    /**
     * @param {webpack.Compiler} compiler
     */
    apply(compiler) {
        const globals = {
            console: compiler.getInfrastructureLogger(pluginName),
            fs: Globals.wrapWebpackFileSystem(compiler.intermediateFileSystem),
        };
        const { console } = globals;

        /** @type {webpack.RuleSetRule} */
        const rule = {
            test: /\.module\.css$/,
            use: [
                {
                    loader: require.resolve("./loader"),
                    options: {},
                },
            ],
        };
        console.log(
            "adding rule:",
            JSON.stringify(rule, (_, v) =>
                v instanceof RegExp ? v.toString() : v
            )
        );
        compiler.options.module.rules.push(rule);

        compiler.hooks.beforeRun.tapPromise(
            { name: pluginName },
            async (compiler) => {
                await beforeCompileHook(this._options, globals, compiler);
            }
        );
        compiler.hooks.watchRun.tapPromise(
            { name: pluginName },
            async (compiler) => {
                await beforeCompileHook(this._options, globals, compiler);
            }
        );
    }
};
