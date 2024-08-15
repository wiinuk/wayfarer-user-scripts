//@ts-check
module.exports = class SourceFileBuilder {
    /** @private @readonly */ _newLine;
    /** @private @readonly */ _columnBase;
    /** @private @readonly @type {string[]} */ _buffer = [];

    /** @private */ _position = 0;
    /** @private */ _line;
    /** @private */ _column;

    constructor({ newLine = "\r\n", columnBase = 1, lineBase = 1 } = {}) {
        this._newLine = newLine;
        this._column = this._columnBase = columnBase;
        this._line = lineBase;
    }
    get position() {
        return this._position;
    }
    get line() {
        return this._line;
    }
    get column() {
        return this._column;
    }

    /**
     * @param {string} [text]
     */
    writeLine(text) {
        return this.write(text)._writeNewLine();
    }
    /**
     * @param {string} [text]
     */
    write(text = "") {
        this._buffer.push(text);
        this._position += text.length;
        this._column += text.length;
        return this;
    }
    /** @private */ _writeNewLine() {
        this._buffer.push(this._newLine);
        this._position += this._newLine.length;
        this._column = this._columnBase;
        this._line++;
        return this;
    }
    getPosition() {
        return {
            position: this._position,
            line: this._line,
            column: this._column,
        };
    }
    toString() {
        return this._buffer.join("");
    }
};
