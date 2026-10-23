"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv } = require("../import/csv-parser");

test("parses a simple CSV into rows of string fields", () => {
  const rows = parseCsv("A,B,C\n1,2,3\n");
  assert.deepEqual(rows, [["A", "B", "C"], ["1", "2", "3"]]);
});

test("a leading zero in a plain numeric-looking cell is preserved as text, not coerced to a number", () => {
  const rows = parseCsv("Code,Name\n007,Agent\n0123,Other\n");
  assert.equal(rows[1][0], "007");
  assert.equal(rows[2][0], "0123");
});

test("quoted fields with embedded commas, newlines and escaped quotes parse correctly", () => {
  const rows = parseCsv('Name,Note\n"Acme, Inc.","Said ""hello"" to\nus"\n');
  assert.equal(rows[1][0], "Acme, Inc.");
  assert.equal(rows[1][1], 'Said "hello" to\nus');
});

test("CJK characters round-trip unchanged", () => {
  const rows = parseCsv("名称,备注\n澳大利亚研究理事会,测试备注\n");
  assert.equal(rows[1][0], "澳大利亚研究理事会");
  assert.equal(rows[1][1], "测试备注");
});

test("a UTF-8 BOM at the start of the file does not corrupt the first header name", () => {
  const rows = parseCsv("﻿Name,Type\nAcme,University\n");
  assert.equal(rows[0][0], "Name");
});

test("CRLF line endings are handled the same as LF", () => {
  const rows = parseCsv("A,B\r\n1,2\r\n3,4\r\n");
  assert.deepEqual(rows, [["A", "B"], ["1", "2"], ["3", "4"]]);
});

test("an empty trailing line at end of file does not produce a spurious empty row", () => {
  const rows = parseCsv("A,B\n1,2\n");
  assert.equal(rows.length, 2);
});

test("more than the row cap is rejected rather than accepted without limit", () => {
  const lines = ["A,B"];
  for (let i = 0; i < 20001; i++) lines.push(i + ",x");
  assert.throws(() => parseCsv(lines.join("\n")), /more than 20000 rows/);
});
