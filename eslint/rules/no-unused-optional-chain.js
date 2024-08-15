// spell-checker: ignore TSES
//@ts-check
const tsutils = require("tsutils");
const ts = require("typescript");

const nullOrUndefinedLikeTypeFlag =
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Any;

/**
 * @param {ts.TypeChecker} checker
 * @param {ts.Node} node
 */
const isNullableType = (checker, node) => {
    const nodeType = checker.getTypeAtLocation(node);
    for (const t of tsutils.unionTypeParts(checker.getApparentType(nodeType))) {
        if (t.flags & nullOrUndefinedLikeTypeFlag) return true;
    }
    return false;
};

/**
 * @param {ts.SourceFile} sourceFile
 * @param {number} position
 */
const getPosition = (sourceFile, position) => {
    const { line, character } =
        sourceFile.getLineAndCharacterOfPosition(position);
    return {
        line: line + 1,
        column: character,
    };
};
/**
 * @param {ts.SourceFile} sourceFile
 * @param {number} start
 * @param {number} end
 */
const getLocation = (sourceFile, start, end) => {
    return {
        start: getPosition(sourceFile, start),
        end: getPosition(sourceFile, end),
    };
};

const Kind = ts.SyntaxKind;
/**
 * @param {ts.Node} node
 */
const isPureBinaryExpression = (node) => {
    if (!ts.isBinaryExpression(node)) {
        return false;
    }
    const kind = node.operatorToken.kind;

    // =, ||= など
    if (Kind.FirstAssignment <= kind && kind <= Kind.LastAssignment) {
        return false;
    }
    return true;
};
/**
 * @param {ts.Node} node
 */
const isPurePrefixUnaryExpression = (node) => {
    if (!ts.isPrefixUnaryExpression(node)) {
        return false;
    }
    const { operator } = node;

    // ++, -- など
    if (operator === Kind.PlusPlusToken || operator === Kind.MinusMinusToken) {
        return false;
    }
    return true;
};
/**
 * @param {ts.Node} node
 * @returns {ts.Node | undefined}
 */
const findImpureNodeInExpression = (node) => {
    // 子要素が不純でも全体として純粋なノード
    if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassExpression(node) ||
        ts.isIdentifier(node) ||
        ts.isPrivateIdentifier(node) ||
        ts.isLiteralExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeNode(node) ||
        ts.isToken(node)
    ) {
        return;
    }

    // 子ノードが不純だった
    const impureChild = ts.forEachChild(node, findImpureNodeInExpression);
    if (impureChild !== undefined) {
        return impureChild;
    }

    // 子要素が純粋なら全体として純粋なノード
    if (
        ts.isAsExpression(node) ||
        ts.isArrayLiteralExpression(node) ||
        ts.isAwaitExpression(node) ||
        isPureBinaryExpression(node) ||
        ts.isBlock(node) ||
        ts.isCommaListExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isObjectLiteralExpression(node) ||
        ts.isOmittedExpression(node) ||
        ts.isParenthesizedExpression(node) ||
        isPurePrefixUnaryExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isTypeOfExpression(node) ||
        ts.isTemplateExpression(node) ||
        ts.isTemplateSpan(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isVoidExpression(node)
    ) {
        return;
    }

    // 純粋でなかった
    return node;
};
/**
 * 簡易的な実装。true を返すなら純粋。false を返しても純粋な場合がある。
 * @param {ts.Expression} expression
 */
const isPureExpression = (expression) =>
    findImpureNodeInExpression(expression) === undefined;

/**
 * @param {number} _position
 * @param {number} _end
 * @param {ts.CommentKind} kind
 */
const getKind = (_position, _end, kind) => kind;
/**
 * @param {ts.Node} node
 * @returns {ts.CommentKind | undefined}
 */
const findCommentKind = (node) => {
    const source = node.getSourceFile().getFullText();
    const start = node.getFullStart();
    return (
        ts.reduceEachLeadingCommentRange(
            source,
            start,
            getKind,
            undefined,
            undefined
        ) ||
        node.forEachChild(findCommentKind) ||
        ts.reduceEachTrailingCommentRange(
            source,
            start,
            getKind,
            undefined,
            undefined
        )
    );
};
/**
 * @param {ts.Node} node
 */
const includesComment = (node) => findCommentKind(node) !== undefined;

/**
 * @typedef {
    | "replace_unneeded_QuestionDot_with_Dot"
    | "remove_unneeded_QuestionDot"
    | "remove_unneeded_expressions_in_QuestionQuestion_expression"
    | "unneeded_QuestionQuestionOperator"
    | "remove_unneeded_assignment_in_QuestionQuestionEquals_expression"
    | "remove_unneeded_expression_in_QuestionQuestionEquals_expression"
    | "unneeded_QuestionQuestionEqualsOperator"
    | "message"
   } MessageIds
 */

/**
 * @param {ts.Node} startNode
 * @param {ts.Node} endNode
 * @param {MessageIds} reportMessageId
 * @param {MessageIds} suggestionMessageId
 * @param {boolean} isAutoFix
 * @returns {import("@typescript-eslint/utils/dist/ts-eslint").ReportDescriptor<MessageIds>}
 */
const createRemoveReporter = (
    startNode,
    endNode,
    reportMessageId,
    suggestionMessageId,
    isAutoFix
) => {
    const reportStart = startNode.getStart();
    const removeStart = startNode.getFullStart();
    const removeEnd = endNode.getEnd();

    const loc = getLocation(startNode.getSourceFile(), reportStart, removeEnd);
    /**
     * @param {import("@typescript-eslint/utils/dist/ts-eslint").RuleFixer} fixer
     */
    const fix = (fixer) => fixer.removeRange([removeStart, removeEnd]);
    return {
        loc,
        messageId: reportMessageId,
        suggest: [
            {
                messageId: suggestionMessageId,
                fix,
            },
        ],
        fix: isAutoFix ? fix : null,
    };
};

/** @type {import("@typescript-eslint/experimental-utils").TSESLint.RuleModule<MessageIds>} */
const rule = {
    meta: {
        docs: {
            description: "Detect unneeded 'await'.",
            recommended: "warn",
            suggestion: true,
            requiresTypeChecking: true,
        },
        fixable: "code",
        hasSuggestions: true,
        messages: {
            replace_unneeded_QuestionDot_with_Dot:
                "Replace unneeded '?.' with '.'.",
            remove_unneeded_QuestionDot: "Remove unneeded '?.'.",
            remove_unneeded_expressions_in_QuestionQuestion_expression:
                "Remove the unused right-hand side.",
            unneeded_QuestionQuestionOperator:
                "'??' operator's left-hand side does not contain nullish type, so the right-hand side is not executed.",
            remove_unneeded_assignment_in_QuestionQuestionEquals_expression:
                "Remove the unused assignment.",
            remove_unneeded_expression_in_QuestionQuestionEquals_expression:
                "Remove the unused right-hand side.",
            unneeded_QuestionQuestionEqualsOperator:
                "'??=' operator's left-hand side does not contain nullish type, so the right-hand side is not executed.",
            message: "message: {{ message }}",
        },
        schema: [],
        type: "suggestion",
    },
    defaultOptions: [],
    create(context) {
        const parserServices = context.parserServices;
        if (parserServices == null) {
            throw new Error("parser services is required");
        }
        const checker = parserServices.program.getTypeChecker();

        return {
            MemberExpression(node) {
                if (!node.optional) return;
                // `o.p` や `o[k]` のような場合

                const member = parserServices.esTreeNodeToTSNodeMap.get(node);

                if (!isNullableType(checker, member.expression)) {
                    const { questionDotToken } = member;
                    if (questionDotToken == null) {
                        return;
                    }

                    const start = questionDotToken.getStart();
                    const end = questionDotToken.getEnd();
                    const loc = getLocation(member.getSourceFile(), start, end);
                    const range = /** @type {const} */ ([start, end]);

                    if (ts.isPropertyAccessExpression(member)) {
                        // `o.?p` のような場合 `o.p` に置き換え
                        context.report({
                            loc,
                            messageId: "replace_unneeded_QuestionDot_with_Dot",
                            fix(fixer) {
                                return fixer.replaceTextRange(range, ".");
                            },
                        });
                    } else {
                        // `o.?[k]` のような場合 `o[k]` に置き換え
                        context.report({
                            loc,
                            messageId: "remove_unneeded_QuestionDot",
                            fix(fixer) {
                                return fixer.removeRange(range);
                            },
                        });
                    }
                }
            },
            LogicalExpression(node) {
                const logical = parserServices.esTreeNodeToTSNodeMap.get(node);
                const { left, operatorToken, right } = logical;
                if (operatorToken.kind !== Kind.QuestionQuestionToken) {
                    return;
                }
                // `l ?? r` のような場合
                // 左辺が null を含まないなら削除対象
                if (!isNullableType(checker, left)) {
                    // 削除範囲に副作用が無く、コメントもないなら自動削除できる
                    const isAutoFix =
                        isPureExpression(right) &&
                        !includesComment(operatorToken) &&
                        !includesComment(right);

                    const reporter = createRemoveReporter(
                        operatorToken,
                        right,
                        "unneeded_QuestionQuestionOperator",
                        "remove_unneeded_expressions_in_QuestionQuestion_expression",
                        isAutoFix
                    );
                    context.report(reporter);
                }
            },
            AssignmentExpression(node) {
                const assignment =
                    parserServices.esTreeNodeToTSNodeMap.get(node);
                const { left, operatorToken, right } = assignment;
                if (operatorToken.kind !== Kind.QuestionQuestionEqualsToken) {
                    return;
                }
                // `l ??= のような場合`
                if (!isNullableType(checker, left)) {
                    // `l ??= r;` または `for (…; …; l ??= r)` のような場合、全体を削除する
                    const parent = assignment.parent;
                    if (
                        ts.isExpressionStatement(parent) ||
                        ts.isForStatement(parent)
                    ) {
                        const isAutoFix =
                            isPureExpression(left) &&
                            isPureExpression(right) &&
                            !includesComment(assignment);

                        const removeNode = ts.isExpressionStatement(assignment)
                            ? parent
                            : assignment;

                        const reporter = createRemoveReporter(
                            removeNode,
                            removeNode,
                            "unneeded_QuestionQuestionEqualsOperator",
                            "remove_unneeded_assignment_in_QuestionQuestionEquals_expression",
                            isAutoFix
                        );
                        return context.report(reporter);
                    }
                    // 他の場合、右辺を削除する
                    else {
                        const isAutoFix =
                            isPureExpression(right) &&
                            !includesComment(operatorToken) &&
                            !includesComment(right);

                        const reporter = createRemoveReporter(
                            operatorToken,
                            right,
                            "unneeded_QuestionQuestionEqualsOperator",
                            "remove_unneeded_expression_in_QuestionQuestionEquals_expression",
                            isAutoFix
                        );
                        return context.report(reporter);
                    }
                }
            },
        };
    },
};
module.exports = rule;
