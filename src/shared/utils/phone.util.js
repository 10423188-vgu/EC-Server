// why: E.164 international format (ITU standard) — optional leading "+", 7-15 digits,
// so numbers from any country (not just VN's 10-11 digit local format) pass validation.
export const PHONE_REGEX = /^\+?[0-9]{7,15}$/;

// why: users type phone numbers with formatting (spaces, dashes, parentheses, dots) —
// strip it before validating/storing so "+1 (881) 291-8051" normalizes to "+18812918051".
export const normalizePhone = (value) => value.replace(/[\s().-]/g, "");
