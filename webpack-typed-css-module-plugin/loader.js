// spell-checker: ignore
// @ts-check
const schemaUtils = require("schema-utils");
const modularize = require("./modularize");
const { renderFieldName } = require("./js-syntax");
const SourceFileBuilder = require("./source-file-builder");

const loaderName = "Typed css module plugin loader";

/** @type {import("schema-utils/declarations/validate").Schema} */
const schema = {
    type: "object",
};

/** @type {import("webpack").LoaderDefinition<{}, {}>} */
module.exports = async function (cssContents, sourceMap, data) {
    const options = this.getOptions();
    schemaUtils.validate(schema, options, {
        name: loaderName,
        baseDataPath: "options",
    });

    const { newCssText, nameToSymbol } = modularize(cssContents);
    const f = new SourceFileBuilder();
    /**
     * @param {modularize.NameKind} declarationNameKind
     */
    const writeNamesExpression = (declarationNameKind) => {
        let hasDeclaration = false;
        for (const { nameKind } of nameToSymbol.values()) {
            if (nameKind === declarationNameKind) {
                hasDeclaration = true;
                break;
            }
        }
        if (!hasDeclaration) {
            f.write(`{}`);
        } else {
            f.writeLine(`{`);
            for (const [className, { nameKind, uniqueId }] of nameToSymbol) {
                if (nameKind !== declarationNameKind) continue;

                f.write(`    `)
                    .write(renderFieldName(className))
                    .write(": ")
                    .write(JSON.stringify(uniqueId))
                    .writeLine(",");
            }
            f.write(`}`);
        }
    };

    f.write(`export const cssText = `)
        .write(JSON.stringify(newCssText))
        .writeLine(`;`);

    f.write(`export const variables = `);
    writeNamesExpression("variable");
    f.writeLine(`;`);

    f.write(`export default `);
    writeNamesExpression("class");
    f.writeLine(`;`);
    return f.toString();
};
