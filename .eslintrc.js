//spell-checker: ignore rulesdir
//@ts-check
const rulesDirPlugin = require("eslint-plugin-rulesdir");
rulesDirPlugin.RULES_DIR = "./eslint/rules";

/** @type {import("eslint").Linter.Config<import("eslint").Linter.RulesRecord>} */
const config = {
    root: true,
    env: {
        es6: true,
        browser: true,
        node: true,
        commonjs: true,
    },
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2018,
        ecmaFeatures: {
            jsx: true,
        },
        sourceType: "module",
        project: "./tsconfig.json",
    },
    plugins: ["rulesdir", "@typescript-eslint"],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "prettier",
    ],
    // ignorePatterns: "*.js",
    rules: {
        "rulesdir/no-unused-await": "warn",
        "rulesdir/no-unused-optional-chain": "warn",
        "rulesdir/no-unused-spell-checker-directive": "warn",
        "@typescript-eslint/no-floating-promises": [
            "warn",
            { ignoreVoid: true },
        ],
        "@typescript-eslint/no-empty-function": "warn",
        "@typescript-eslint/no-unused-vars": [
            "warn",
            { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
        ],
        "object-shorthand": "warn",
        "no-useless-rename": "warn",
        "no-duplicate-imports": "warn",
        "prefer-const": "warn",
        "no-undef": "off",
    },
};
module.exports = config;
