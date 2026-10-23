"use strict";
// Builds a minimal, valid .xlsx file in memory for tests, without any third-party zip/xlsx
// library — just enough of the OOXML + ZIP format for backend/import/xlsx-parser.js to read it
// back. Not a general-purpose writer: fixed single string table, one or more sheets of row/cell
// data, STORED (uncompressed) ZIP entries only (simplest to construct correctly by hand).
const zlib = require("node:zlib");

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  // files: [{ name, content: Buffer }]. All entries STORED (no compression) for simplicity.
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, content } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method: stored
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + content.length;
  }
  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, eocd]);
}

function colLetter(index) {
  let s = "";
  index += 1;
  while (index > 0) { const rem = (index - 1) % 26; s = String.fromCharCode(65 + rem) + s; index = Math.floor((index - 1) / 26); }
  return s;
}

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// `sheetsData`: { [sheetName]: string[][] } — row 0 is treated as the header in the parser's
// caller, not here; this just writes whatever rows are given.
function makeXlsx(sheetsData) {
  const sharedStrings = [];
  const stringIndex = new Map();
  function sIndex(value) {
    const key = String(value);
    if (stringIndex.has(key)) return stringIndex.get(key);
    const idx = sharedStrings.length;
    sharedStrings.push(key);
    stringIndex.set(key, idx);
    return idx;
  }

  const sheetNames = Object.keys(sheetsData);
  const sheetXmls = sheetNames.map((name, sheetIdx) => {
    const rows = sheetsData[name];
    const rowsXml = rows.map((row, rowIdx) => {
      const cellsXml = row.map((value, colIdx) => {
        if (value === null || value === undefined || value === "") return "";
        const ref = colLetter(colIdx) + (rowIdx + 1);
        if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
        return `<c r="${ref}" t="s"><v>${sIndex(value)}</v></c>`;
      }).join("");
      return `<row r="${rowIdx + 1}">${cellsXml}</row>`;
    }).join("");
    return { name, idx: sheetIdx + 1, xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>` };
  });

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings.map(s => `<si><t>${escapeXml(s)}</t></si>`).join("") + `</sst>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheetXmls.map(s => `<sheet name="${escapeXml(s.name)}" sheetId="${s.idx}" r:id="rId${s.idx}"/>`).join("") + `</sheets></workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetXmls.map(s => `<Relationship Id="rId${s.idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.idx}.xml"/>`).join("") +
    `<Relationship Id="rIdSS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheetXmls.map(s => `<Override PartName="/xl/worksheets/sheet${s.idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const files = [
    { name: "[Content_Types].xml", content: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", content: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", content: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(workbookRelsXml, "utf8") },
    { name: "xl/sharedStrings.xml", content: Buffer.from(sharedStringsXml, "utf8") },
    ...sheetXmls.map(s => ({ name: `xl/worksheets/sheet${s.idx}.xml`, content: Buffer.from(s.xml, "utf8") })),
  ];
  return zipStore(files);
}

module.exports = { makeXlsx };
