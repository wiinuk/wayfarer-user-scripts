//@ts-check
const os = require("node:os");
const productionConfig = require("./webpack.config.js");

/** @type {import("webpack").Configuration} */
const config = {
    ...productionConfig,

    mode: "development",
    output: {
        path: os.tmpdir(),
        filename: "tampermonkey_debug_sym.js",
    },
};

module.exports = config;
