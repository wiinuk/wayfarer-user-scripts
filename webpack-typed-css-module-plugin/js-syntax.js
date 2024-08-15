//@ts-check
const safeIdPattern = /^[A-Za-z_$][A-Za-z_$0-9]*$/;

/**
 * @param {string} value
 */
module.exports.renderFieldName = (value) => {
    return safeIdPattern.test(value) ? value : JSON.stringify(value);
};
