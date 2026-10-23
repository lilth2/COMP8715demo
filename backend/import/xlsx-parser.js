"use strict";
// Minimal, dependency-free .xlsx reader for untrusted uploads.
//
// .xlsx is a ZIP archive of XML parts. Rather than pull in a third-party XLSX/ZIP library (more
// attack surface for a file an anonymous-ish admin upload hands us), this hand-rolls just enough
// of the ZIP central-directory format to list entries and decompress the few parts we need, using
// Node's built-in zlib for DEFLATE (method 8) — the only compression method real Excel ever
// writes, but STORED (method 0, no compression) is also handled since the spec allows it.
//
// Explicitly NOT supported, by design: macros (.xlsm is a different content type and rejected by
// the caller's extension/mime check before this module runs), formulas (read as their cached
// value only — see readCellValue, which never reads <f>), and external links (that part of the
// archive, if present, is simply never opened). Nothing here executes anything found in the file.
const zlib = require("node:zlib");

const MAX_UNCOMPRESSED_PART_BYTES = 64 * 1024 * 1024; // guards against a decompression-bomb part
const MAX_ENTRIES = 2000; // a real .xlsx has a few dozen parts; this is a generous ceiling

function readUInt32LE(buf, offset) { return buf.readUInt32LE(offset); }
function readUInt16LE(buf, offset) { return buf.readUInt16LE(offset); }

function findEndOfCentralDirectory(buf) {
  // EOCD is a fixed 22-byte record (plus a variable comment) near the end of the file; signature
  // 0x06054b50. Scan backward for it, bounded to the last 64KB + comment-length field range.
  const maxCommentLen = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLen);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (readUInt32LE(buf, i) === 0x06054b50) return i;
  }
  throw Object.assign(new Error("Not a valid .xlsx file (no ZIP end-of-central-directory record found)."), { status: 400 });
}

function listEntries(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const entryCount = readUInt16LE(buf, eocdOffset + 10);
  const centralDirOffset = readUInt32LE(buf, eocdOffset + 16);
  if (entryCount > MAX_ENTRIES) throw Object.assign(new Error("This file has too many internal parts to be a normal .xlsx workbook."), { status: 400 });
  const entries = {};
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (readUInt32LE(buf, offset) !== 0x02014b50) throw Object.assign(new Error("Corrupt .xlsx file (unexpected central directory signature)."), { status: 400 });
    const compressionMethod = readUInt16LE(buf, offset + 10);
    const compressedSize = readUInt32LE(buf, offset + 20);
    const uncompressedSize = readUInt32LE(buf, offset + 24);
    const nameLen = readUInt16LE(buf, offset + 28);
    const extraLen = readUInt16LE(buf, offset + 30);
    const commentLen = readUInt16LE(buf, offset + 32);
    const localHeaderOffset = readUInt32LE(buf, offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries[name] = { compressionMethod, compressedSize, uncompressedSize, localHeaderOffset };
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  if (entry.uncompressedSize > MAX_UNCOMPRESSED_PART_BYTES) throw Object.assign(new Error("A part of this workbook is too large to process safely."), { status: 413 });
  const lh = entry.localHeaderOffset;
  if (readUInt32LE(buf, lh) !== 0x04034b50) throw Object.assign(new Error("Corrupt .xlsx file (unexpected local file header signature)."), { status: 400 });
  const nameLen = readUInt16LE(buf, lh + 26);
  const extraLen = readUInt16LE(buf, lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw Object.assign(new Error("Unsupported compression in this .xlsx file."), { status: 400 });
}

function decodeXmlEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

// Tolerant, purpose-built extraction (not a general XML parser) for the handful of element shapes
// real spreadsheet XML actually contains. Good enough because we control what we look for and
// never evaluate anything as code.
function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const text = Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(t => decodeXmlEntities(t[1])).join("");
    strings.push(text);
  }
  return strings;
}

function colToIndex(letters) {
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}
function splitCellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: m[1], row: parseInt(m[2], 10) } : null;
}

const MAX_ROWS = 20000; // generous ceiling for a relationship/organisation dataset; rejects a runaway file early

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  let rowsSeen = 0;
  while ((rowMatch = rowRe.exec(xml))) {
    rowsSeen++;
    if (rowsSeen > MAX_ROWS) throw Object.assign(new Error("This sheet has more than " + MAX_ROWS + " rows; split the file or contact an administrator to raise the limit."), { status: 413 });
    const rowNum = parseInt(rowMatch[1], 10);
    const rowXml = rowMatch[2];
    const cells = {};
    let hasFormula = false;
    // Self-closing (<c .../> — an empty cell) must be tried BEFORE the open/close alternative:
    // a greedy `[^>]*` in the first branch would otherwise swallow the cell's own trailing "/"
    // and then consume everything up to the next cell's "</c>" as if it were this cell's content,
    // silently misaligning every subsequent column in the row.
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowXml))) {
      const isSelfClosing = cellMatch[1] !== undefined;
      const attrs = isSelfClosing ? cellMatch[1] : cellMatch[2];
      const inner = isSelfClosing ? "" : (cellMatch[3] || "");
      const refMatch = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (!refMatch) continue;
      const ref = splitCellRef(refMatch[1]);
      if (!ref) continue;
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : null;
      if (/<f[ >]/.test(inner)) hasFormula = true; // never read, only flagged
      let value = null;
      if (type === "inlineStr") {
        const isMatch = /<is>([\s\S]*?)<\/is>/.exec(inner);
        value = isMatch ? Array.from(isMatch[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(t => decodeXmlEntities(t[1])).join("") : "";
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const raw = vMatch ? decodeXmlEntities(vMatch[1]) : null;
        if (raw === null) value = null;
        else if (type === "s") { const idx = parseInt(raw, 10); value = sharedStrings[idx] !== undefined ? sharedStrings[idx] : ""; }
        else if (type === "b") value = raw === "1";
        else if (type === "str") value = raw; // formula-cached string result
        else value = raw; // numeric (including date serials, left as the raw number — caller decides formatting)
      }
      cells[ref.col] = value;
    }
    rows.push({ rowNumber: rowNum, cells, hasFormula });
  }
  return rows;
}

function parseWorkbookSheets(workbookXml, relsXml) {
  const relTargets = {};
  Array.from((relsXml || "").matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)).forEach(m => { relTargets[m[1]] = m[2]; });
  return Array.from(workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g)).map(m => ({
    name: decodeXmlEntities(m[1]), path: "xl/" + relTargets[m[2]],
  }));
}

// `buf` is a Node Buffer of the raw .xlsx file bytes. Returns { sheets: [{name}], readSheet(name) }
// where readSheet returns { rows: [{rowNumber, cells: {A: value, B: value, ...}, hasFormula}] }.
function openWorkbook(buf) {
  const entries = listEntries(buf);
  if (!entries["xl/workbook.xml"]) throw Object.assign(new Error("This does not look like a valid .xlsx workbook (missing xl/workbook.xml)."), { status: 400 });
  const workbookXml = readEntry(buf, entries["xl/workbook.xml"]).toString("utf8");
  const relsXml = entries["xl/_rels/workbook.xml.rels"] ? readEntry(buf, entries["xl/_rels/workbook.xml.rels"]).toString("utf8") : "";
  const sharedStrings = entries["xl/sharedStrings.xml"] ? parseSharedStrings(readEntry(buf, entries["xl/sharedStrings.xml"]).toString("utf8")) : [];
  const sheets = parseWorkbookSheets(workbookXml, relsXml);
  return {
    sheets: sheets.map(s => s.name),
    readSheet(name) {
      const sheet = sheets.find(s => s.name === name);
      if (!sheet || !entries[sheet.path]) throw Object.assign(new Error("Sheet \"" + name + "\" was not found in this workbook."), { status: 400 });
      const xml = readEntry(buf, entries[sheet.path]).toString("utf8");
      return { rows: parseSheet(xml, sharedStrings) };
    },
  };
}

module.exports = { openWorkbook, colToIndex, MAX_ROWS };
