// spell-checker: ignore cacheable csstools
// @ts-check
const { SourceMapGenerator } = require("source-map");
const { renderFieldName } = require("./js-syntax");
const modularize = require("./modularize");
const SourceFileBuilder = require("./source-file-builder");
const Globals = require("./globals");

/**
 * @param {Globals.GlobalFs} fs
 * @param {string} path
 * @param {string} contents
 */
const writeIfChanged = async (fs, path, contents) => {
    /** @type {string | undefined} */
    let oldContents;
    try {
        oldContents = (await fs.readFile.__promisify__(path)).toString();
    } catch {}

    if (oldContents === contents) {
        return;
    }
    await fs.writeFile.__promisify__(path, contents);
};

/**
 * @param {string} cssPath
 * @param {string} cssContents
 */
exports.writeDeclarationAndMapFile = async function (
    cssPath,
    cssContents,
    globals = {}
) {
    const { fs, console } = Globals.fill(globals);
    const declarationPath = cssPath + ".d.ts";
    const declarationMapPath = declarationPath + ".map";

    // TODO: 置き換え後の css はいらないので、生成しないようにしたい
    const { newCssText, nameToSymbol } = modularize(cssContents);

    const declarationMap = new SourceMapGenerator({
        file: declarationPath,
    });
    declarationMap.addMapping({
        generated: {
            line: 1,
            column: 0,
        },
        source: cssPath,
        original: {
            line: 1,
            column: 0,
        },
    });
    const declarationFile = new SourceFileBuilder({
        lineBase: 1,
        columnBase: 0,
    });
    const d = declarationFile;
    d.writeLine(`export const cssText: string;`);

    /**
     * @param {modularize.NameKind} declarationNameKind
     */
    const writeNamesType = (declarationNameKind) => {
        let declarationCount = 0;
        for (const [symbolName, { nameKind, declarations }] of nameToSymbol) {
            if (nameKind !== declarationNameKind) continue;

            for (const declaration of declarations) {
                declarationCount++;
                // *.d.ts ファイルにマッピングオブジェクトの型定義を書き込む
                d.writeLine().write(`    & { readonly `);
                const startLine = d.line;
                const startColumn = d.column;
                d.write(renderFieldName(symbolName));
                const endLine = d.line;
                const endColumn = d.column;
                d.write(`: string; }`);

                // *.d.ts ファイルの型のフィールド名から *.css ファイルの該当セレクタを含むルールへのマッピングを記録し *.d.ts.map ファイルに書き込む
                const cssStart = declaration.start;
                const cssEnd = declaration.end;
                declarationMap.addMapping({
                    generated: {
                        line: startLine,
                        column: startColumn,
                    },
                    source: cssPath,
                    original: {
                        line: cssStart.line + 1,
                        column: cssStart.character,
                    },
                    name: symbolName,
                });
                declarationMap.addMapping({
                    generated: {
                        line: endLine,
                        column: endColumn,
                    },
                    source: cssPath,
                    original: {
                        line: cssEnd.line + 1,
                        column: cssEnd.character,
                    },
                    name: symbolName,
                });
            }
        }
        if (declarationCount === 0) {
            d.write(` Record<string, never>`);
        }
    };

    d.write(`export const variables:`);
    writeNamesType("variable");
    d.writeLine(";");

    d.write(`declare const styles:`);
    writeNamesType("class");
    d.writeLine(";");
    d.writeLine("export default styles;");

    // file watcher を反応させないため、既にあるファイルと書き込もうとするファイルの内容が同じなら書き込まないようにする。
    await Promise.all([
        writeIfChanged(fs, declarationPath, declarationFile.toString()),
        writeIfChanged(fs, declarationMapPath, declarationMap.toString()),
    ]);
};
