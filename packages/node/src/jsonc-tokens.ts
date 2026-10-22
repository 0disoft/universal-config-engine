// jsonc-parser declares ambient const enums, which verbatimModuleSyntax cannot
// import as runtime values. Keep its stable scanner protocol in one place.
export const JSON_TOKEN = {
  OpenBraceToken: 1,
  CloseBraceToken: 2,
  OpenBracketToken: 3,
  CloseBracketToken: 4,
  CommaToken: 5,
  ColonToken: 6,
  StringLiteral: 10,
  LineCommentTrivia: 12,
  BlockCommentTrivia: 13,
  LineBreakTrivia: 14,
  Trivia: 15,
  Unknown: 16,
  EOF: 17
} as const;

export const JSON_SCAN_ERROR_NONE = 0;
