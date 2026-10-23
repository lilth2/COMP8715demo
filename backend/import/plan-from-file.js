"use strict";
// Turns an uploaded file (.xlsx or UTF-8 .csv) plus a user-chosen field mapping into the row
// shape admin/dataset-core.js's planBulkUpsert() expects: an array of partial records, each
// carrying `sourceRow` (the original spreadsheet/CSV row number) for error messages and
// provenance, with leading characters / original text preserved exactly as typed (no numeric
// coercion — the caller decides per-field whether a value should become a number/date).
const { openWorkbook } = require("./xlsx-parser");
const { parseCsv } = require("./csv-parser");

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // generous for a few thousand rows of text; blocks runaway uploads

function colLettersFromIndex(index) {
  let s = "";
  index += 1;
  while (index > 0) { const rem = (index - 1) % 26; s = String.fromCharCode(65 + rem) + s; index = Math.floor((index - 1) / 26); }
  return s;
}

// Parses the uploaded buffer into { sheets: [name], readSheet(name) -> { headers: [...], rows: [{sourceRow, cells: {header: value}}] } }.
// `cells` is keyed by header text (from the first non-empty row) falling back to column letter
// when a header cell is blank, so field mapping can refer to either.
function openUpload(buf, filename) {
  if (buf.length > MAX_UPLOAD_BYTES) throw Object.assign(new Error("File is too large (maximum " + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + " MB)."), { status: 413 });
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const wb = openWorkbook(buf);
    return {
      kind: "xlsx",
      sheets: wb.sheets,
      readSheet(sheetName, headerRowNumber) {
        const sheet = wb.readSheet(sheetName);
        return sheetToColumns(sheet.rows.map(r => ({ rowNumber: r.rowNumber, cellsByCol: r.cells, hasFormula: r.hasFormula })), headerRowNumber);
      },
    };
  }
  if (lower.endsWith(".csv")) {
    const text = buf.toString("utf8");
    const rows = parseCsv(text);
    const asRows = rows.map((fields, i) => {
      const cellsByCol = {};
      fields.forEach((v, colIdx) => { cellsByCol[colLettersFromIndex(colIdx)] = v === "" ? null : v; });
      return { rowNumber: i + 1, cellsByCol, hasFormula: false };
    });
    return {
      kind: "csv",
      sheets: ["CSV"],
      readSheet(_sheetName, headerRowNumber) { return sheetToColumns(asRows, headerRowNumber); },
    };
  }
  throw Object.assign(new Error("Unsupported file type. Upload a .xlsx workbook or a UTF-8 .csv file."), { status: 415 });
}

function sheetToColumns(rawRows, headerRowNumber) {
  const headerRow = rawRows.find(r => r.rowNumber === headerRowNumber) || rawRows[0];
  if (!headerRow) return { headers: [], rows: [] };
  const colLetters = Object.keys(headerRow.cellsByCol);
  const headers = {}; // colLetter -> header text (falls back to the letter itself if blank)
  colLetters.forEach(col => { headers[col] = (headerRow.cellsByCol[col] != null && String(headerRow.cellsByCol[col]).trim()) || col; });
  const dataRows = rawRows.filter(r => r.rowNumber > headerRow.rowNumber);
  const anyFormulas = rawRows.some(r => r.hasFormula);
  return {
    headers, // { colLetter: headerText }
    anyFormulas, // surfaced to the caller; formulas are never evaluated, only flagged
    rows: dataRows.map(r => ({ sourceRow: r.rowNumber, cellsByCol: r.cellsByCol })),
  };
}

// `fieldMapping`: { targetField: colLetter }. `collection`: actors|projects|themes|relationships.
// Produces rows in the shape planBulkUpsert expects. Values are trimmed strings; a column mapped
// to a target field that is blank for a given row becomes undefined (not an empty string), so
// "required field" checks behave the same as a hand-typed form.
function rowsFromMapping(parsedSheet, fieldMapping) {
  return parsedSheet.rows.map(r => {
    const out = { sourceRow: r.sourceRow };
    Object.keys(fieldMapping).forEach(target => {
      const col = fieldMapping[target];
      if (!col) return;
      const raw = r.cellsByCol[col];
      if (raw === null || raw === undefined) return;
      const text = String(raw).trim();
      if (text === "") return;
      out[target] = text;
    });
    return out;
  });
}

module.exports = { openUpload, rowsFromMapping, MAX_UPLOAD_BYTES };
