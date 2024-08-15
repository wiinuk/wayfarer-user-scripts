// spell-checker: ignore csstools
// @ts-check
const { createHash } = require("node:crypto");
const tokenizer = require("@csstools/tokenizer");
const {
    computeLineAndCharacterOfPosition,
    computeLineStarts,
} = require("./line-map");

/**
 * @typedef {Object} LineAndCharacter
 * @property {number} line 0-based
 * @property {number} character 0-based
 *
 * @typedef {Object} TokenLocation
 * @property {LineAndCharacter} start
 * @property {LineAndCharacter} end
 *
 * @typedef {"class" | "variable"} NameKind
 *
 * @typedef {Object} NameSymbol
 * @property {string} uniqueId
 * @property {NameKind} nameKind
 * @property {TokenLocation[]} declarations
 */

/**
 * @param {string} source
 */
const hash = (source) => {
    const sha1 = createHash("sha1");
    sha1.update(source);
    return sha1.digest("hex");
};

/**
 * @param {Map<string, NameSymbol>} nameToSymbol
 * @param {NameKind} nameKind
 * @param {string} name
 * @param {TokenLocation} declaration
 * @param {string} cssTextHash
 */
const addDeclaration = (
    nameToSymbol,
    nameKind,
    name,
    declaration,
    cssTextHash
) => {
    let symbol = nameToSymbol.get(name);
    if (symbol == null) {
        /** @type {NameSymbol["declarations"]} */
        const declarations = [];
        if (declaration != null) {
            declarations.push(declaration);
        }
        symbol = {
            uniqueId: `${name}-${hash(`${cssTextHash}-${name}`)}`,
            nameKind,
            declarations,
        };
        nameToSymbol.set(name, symbol);
    } else {
        if (declaration != null) {
            symbol.declarations.push(declaration);
        }
    }
    return symbol;
};

const CharacterCodes = Object.freeze({
    "-": "-".charCodeAt(0),
});
const TokenType = Object.freeze({
    Symbol: 1,
    Word: 4,
});

/**
 * @typedef {Object} CssReplaceResult
 * @property {string} newCssText
 * @property {Map<string, NameSymbol>} nameToSymbol
 */

/**
 * @param {string} source
 * @returns {CssReplaceResult}
 */
const modularize = (source) => {
    const cssTextHash = hash(source);
    /** @type {number[] | null} */
    let lineStarts = null;
    /**
     * @param {number} position
     */
    const positionToLineAndCharacter = (position) =>
        computeLineAndCharacterOfPosition(
            (lineStarts ??= computeLineStarts(source)),
            position
        );

    /** @type {Map<string, NameSymbol>} */
    const nameToSymbol = new Map();
    let newCssText = "";
    let sliceStart = 0;
    let sliceEnd = 0;

    /**
     * @param {tokenizer.CSSToken | null} prevToken
     * @param {tokenizer.CSSToken} token
     */
    const getNameKind = (prevToken, token) => {
        // class: '.' IDENT
        if (
            prevToken?.type === TokenType.Symbol &&
            prevToken?.data === "." &&
            token.type === TokenType.Word
        ) {
            return "class";
        }
        // dashed-ident: `--*`
        if (
            token.type === TokenType.Word &&
            token.data.codePointAt(0) === CharacterCodes["-"] &&
            token.data.codePointAt(1) === CharacterCodes["-"]
        ) {
            return "variable";
        }
        return;
    };
    /**
     * @param {tokenizer.CSSToken | null} prevToken
     * @param {tokenizer.CSSToken} token
     * @param {tokenizer.CSSToken | null} nextToken
     */
    const copyToken = (prevToken, token, nextToken) => {
        const tokenStart = token.tick;
        const tokenEnd = nextToken?.tick ?? source.length;

        const nameKind = getNameKind(prevToken, token);
        if (nameKind === "class" || nameKind === "variable") {
            const declaration = {
                start: positionToLineAndCharacter(tokenStart),
                end: positionToLineAndCharacter(tokenEnd),
            };
            const symbol = addDeclaration(
                nameToSymbol,
                nameKind,
                token.data,
                declaration,
                cssTextHash
            );
            newCssText += source.slice(sliceStart, sliceEnd);
            newCssText += symbol.uniqueId;
            sliceStart = sliceEnd = tokenEnd;
        } else {
            sliceEnd = tokenEnd;
        }
    };
    /** @type {tokenizer.CSSToken | null} */
    let prevToken = null;
    /** @type {tokenizer.CSSToken | null} */
    let token = null;
    for (const nextToken of tokenizer.tokenize(source)) {
        if (token !== null) {
            copyToken(prevToken, token, nextToken);
        }
        prevToken = token;
        token = nextToken;
    }
    if (token != null) {
        copyToken(prevToken, token, null);
    }
    if (sliceStart !== sliceEnd) {
        newCssText += source.slice(sliceStart, sliceEnd);
    }
    return {
        newCssText,
        nameToSymbol,
    };
};

module.exports = modularize;
