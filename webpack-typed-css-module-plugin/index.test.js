//@ts-check
const { it, expect } = require("@jest/globals");
const path = require("node:path");
const fs = require("node:fs/promises");
const sourceMap = require("source-map");
const Webpack = require("webpack");
const {
    computeLineStarts,
    computeLineAndCharacterOfPosition,
} = require("./line-map");
const TypedCssModulePlugin = require(".");

/**
 * @param {Webpack.Configuration} config
 * @returns {Promise<Webpack.Stats>}
 */
function webpack(config) {
    return new Promise((resolve, reject) => {
        Webpack(config, (error, result) =>
            result ? resolve(result) : reject(error)
        );
    });
}

const positionOf = (
    /** @type {string} */ searchString,
    /** @type {string} */ contents
) => {
    const { line, character } = computeLineAndCharacterOfPosition(
        computeLineStarts(contents),
        contents.indexOf(searchString)
    );
    return { line: line + 1, column: character };
};
/**
 * @param {sourceMap.MappedPosition} position
 */
const normalizeSourcePath = (position) => ({
    ...position,
    source: path.normalize(position.source),
});

it("test", async () => {
    if (typeof global.setImmediate === "undefined") {
        const timers = require("node:timers");
        global.setImmediate = timers.setImmediate;
        global.clearImmediate = timers.clearImmediate;
    }

    const files = {
        "main.ts": `
            import styles, { cssText } from "./styles.module.css";
            const article = styles.article;
            export { styles, cssText, article };
        `,
        "styles.module.css": `
            .article {
                background-color: #fff;
            }
        `,
        "tsconfig.json": `
            {
                "compilerOptions": {
                    "target": "ES5",
                    "lib": [],
                    "module": "ES2015",
                    "esModuleInterop": true,
                    "sourceMap": true,
                    "strict": true,
                }
            }
        `,
    };
    const entryPath = "main.ts";
    const outputPath = "main.js";

    const tempDirectoryPath = path.resolve(
        await fs.mkdtemp(path.join(__dirname, "temp/test_"))
    );
    try {
        for (const filePath in files) {
            await fs.writeFile(
                path.join(tempDirectoryPath, filePath),
                files[filePath]
            );
        }
        const outputFilePath = path.join(tempDirectoryPath, outputPath);
        const stats = await webpack({
            context: tempDirectoryPath,
            plugins: [new TypedCssModulePlugin()],
            mode: "production",
            target: "node",
            entry: path.join(tempDirectoryPath, entryPath),
            module: {
                rules: [
                    {
                        test: /\.ts$/,
                        use: "ts-loader",
                    },
                ],
            },
            resolve: {
                extensions: [".ts", ".js"],
                modules: ["node_modules"],
            },
            optimization: {
                minimize: false,
            },
            output: {
                path: path.dirname(outputFilePath),
                filename: path.basename(outputFilePath),
                libraryTarget: "commonjs",
            },
        });

        const result = stats?.toJson();
        expect(result.errors).toStrictEqual([]);
        expect(result.warnings).toStrictEqual([]);

        const declarationContents = (
            await fs.readFile(
                path.join(tempDirectoryPath, "styles.module.css.d.ts")
            )
        ).toString();
        expect(declarationContents).toContain("article");

        // .d.ts ファイルの中で最初に "article" が現れる位置を取得
        const declarationArticleStart = positionOf(
            "article",
            declarationContents
        );

        const mapContents = (
            await fs.readFile(
                path.join(tempDirectoryPath, "styles.module.css.d.ts.map")
            )
        ).toString();
        const consumer = new sourceMap.SourceMapConsumer(
            JSON.parse(mapContents)
        );

        // .d.ts.map の中に記録されている、.d.ts の中の article の位置に対応する .css ファイルの中の位置を得る
        const cssArticleStart = normalizeSourcePath(
            consumer.originalPositionFor(declarationArticleStart)
        );

        // .css ファイルの中の article の位置と一致しているか確認
        const cssArticlePosition = positionOf(
            "article",
            files["styles.module.css"]
        );
        expect(cssArticleStart).toStrictEqual({
            ...cssArticlePosition,
            source: path.normalize(
                path.join(tempDirectoryPath, "styles.module.css")
            ),
            name: "article",
        });

        const main = require(outputFilePath);
        expect(new Set(Object.keys(main.styles))).toStrictEqual(
            new Set(["article"])
        );
        expect(main.cssText).toContain(main.styles.article);
    } finally {
        await fs.rmdir(tempDirectoryPath, { recursive: true });
    }
}, 50000);
