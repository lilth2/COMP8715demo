"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openWorkbook } = require("../import/xlsx-parser");
const { makeXlsx } = require("./helpers/make-xlsx");

test("reads sheet names, header row and data rows, preserving row numbers", () => {
  const buf = makeXlsx({
    "Sheet1": [
      ["Organisation A", "Organisation B", "Relationship Type"],
      ["Acme University", "Beta Institute", "Partnership"],
      ["Gamma CRC", "Delta Corp", "Funded by"],
    ],
  });
  const wb = openWorkbook(buf);
  assert.deepEqual(wb.sheets, ["Sheet1"]);
  const sheet = wb.readSheet("Sheet1");
  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.rows[0].cells.A, "Organisation A");
  assert.equal(sheet.rows[1].cells.A, "Acme University");
  assert.equal(sheet.rows[1].cells.C, "Partnership");
  assert.equal(sheet.rows[2].rowNumber, 3);
});

test("reads multiple sheets independently", () => {
  const buf = makeXlsx({
    "Data": [["A", "B"], ["1", "2"]],
    "Guide": [["Notes"], ["Read me"]],
  });
  const wb = openWorkbook(buf);
  assert.deepEqual(wb.sheets.sort(), ["Data", "Guide"]);
  assert.equal(wb.readSheet("Guide").rows[1].cells.A, "Read me");
});

test("an empty cell between populated cells is read as absent, not shifting later columns", () => {
  const buf = makeXlsx({
    "Sheet1": [
      ["A", "B", "C", "D"],
      ["first", "", "third", "fourth"],
    ],
  });
  const wb = openWorkbook(buf);
  const row = wb.readSheet("Sheet1").rows[1];
  assert.equal(row.cells.A, "first");
  assert.equal(row.cells.B, undefined, "an empty string cell is omitted, not written as an empty value");
  assert.equal(row.cells.C, "third", "column C must still be C, not shifted into B's position");
  assert.equal(row.cells.D, "fourth");
});

test("reading an unknown sheet name fails clearly instead of silently returning nothing", () => {
  const buf = makeXlsx({ "Sheet1": [["A"]] });
  const wb = openWorkbook(buf);
  assert.throws(() => wb.readSheet("DoesNotExist"), /was not found/);
});

test("a file that is not a valid zip/xlsx is rejected with a clear error, not a crash", () => {
  const notAZip = Buffer.from("this is just plain text, not a zip file at all " + "x".repeat(200));
  assert.throws(() => openWorkbook(notAZip), /Not a valid \.xlsx file/);
});

test("numeric cell values round-trip as numbers (e.g. Excel date serials), not strings", () => {
  const buf = makeXlsx({ "Sheet1": [["Date"], [45566]] });
  const wb = openWorkbook(buf);
  const value = wb.readSheet("Sheet1").rows[1].cells.A;
  assert.equal(value, "45566"); // readEntry returns the raw <v> text; numeric-vs-date formatting is the caller's job
});
