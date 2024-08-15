//@ts-check
// from tsc

const carriageReturn = 0x0d;
const lineFeed = 0x0a;
const maxAsciiCharacter = 0x7f;
const lineSeparator = 0x2028;
const paragraphSeparator = 0x2029;

/**
 * @param {number} ch
 */
const isLineBreak = (ch) =>
    // TODO: css の規格に合わせる
    ch === lineFeed ||
    ch === carriageReturn ||
    ch === lineSeparator ||
    ch === paragraphSeparator;
/**
 * @param {string} text
 */
const computeLineStarts = (text) => {
    /** @type {number[]} */
    const result = [];
    let pos = 0;
    let lineStart = 0;
    while (pos < text.length) {
        const ch = text.charCodeAt(pos);
        pos++;
        switch (ch) {
            case carriageReturn:
                if (text.charCodeAt(pos) === lineFeed) {
                    pos++;
                }
            // falls through
            case lineFeed:
                result.push(lineStart);
                lineStart = pos;
                break;
            default:
                if (ch > maxAsciiCharacter && isLineBreak(ch)) {
                    result.push(lineStart);
                    lineStart = pos;
                }
                break;
        }
    }
    result.push(lineStart);
    return result;
};
/**
 * @template {boolean | number | string | bigint} T
 * @param {readonly T[]} array
 * @param {T} key
 * @param {number} [offset]
 */
const binarySearch = (array, key, offset) => {
    if (array.length <= 0) {
        return -1;
    }

    let low = offset || 0;
    let high = array.length - 1;
    while (low <= high) {
        const middle = low + ((high - low) >> 1);
        const midKey = array[middle];
        if (midKey < key) {
            low = middle + 1;
        } else if (midKey === key) {
            return middle;
        } else {
            high = middle - 1;
        }
    }
    return ~low;
};
/**
 * @param {readonly number[]} lineStarts
 * @param {number} position
 * @param {number} [lowerBound]
 */
const computeLineOfPosition = (lineStarts, position, lowerBound) => {
    let lineNumber = binarySearch(lineStarts, position, lowerBound);
    if (lineNumber < 0) {
        lineNumber = ~lineNumber - 1;
    }
    return lineNumber;
};
/**
 * @param {readonly number[]} lineStarts
 * @param {number} position
 */
const computeLineAndCharacterOfPosition = (lineStarts, position) => {
    const lineNumber = computeLineOfPosition(lineStarts, position);
    return {
        line: lineNumber,
        character: position - lineStarts[lineNumber],
    };
};

exports.computeLineStarts = computeLineStarts;
exports.computeLineAndCharacterOfPosition = computeLineAndCharacterOfPosition;
