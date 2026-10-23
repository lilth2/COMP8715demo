"use strict";
// Minimal, dependency-free RFC-4180-ish CSV reader for untrusted uploads. Everything is read as
// a string (so a leading-zero value like "007" or a CJK name is never silently coerced), quoted
// fields with embedded commas/newlines/escaped quotes ("") are handled, and a row-count cap
// guards against an unbounded upload.
const MAX_ROWS = 20000;

// Strips a UTF-8 BOM if present — common from Excel's own "CSV UTF-8" export, and otherwise ends
// up prepended to the first header name, silently breaking column-name matching.
function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function parseCsv(text) {
  text = stripBom(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  function endField() { row.push(field); field = ""; }
  function endRow() { endField(); rows.push(row); row = []; if (rows.length > MAX_ROWS) throw Object.assign(new Error("This file has more than " + MAX_ROWS + " rows; split it or contact an administrator to raise the limit."), { status: 413 }); }
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { endField(); i++; continue; }
    if (ch === "\r") { i++; continue; } // normalize CRLF/CR to the following/implicit LF
    if (ch === "\n") { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || row.length > 0) endRow();
  // Drop a single fully-empty trailing row (common: a trailing newline at EOF).
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

module.exports = { parseCsv, MAX_ROWS };
