/**
 * Writing and reading .xlsx without a library: an xlsx file is a ZIP of XML parts.
 * The writer produces one sheet with a header row; the reader returns plain rows.
 */

import { createZip, readZip } from './zip.js';

const DATE_STYLE = 1;

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** Spreadsheet column name for a zero-based index: 0 -> A, 26 -> AA. */
export function columnName(index) {
  let name = '';
  let value = index;
  do {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return name;
}

/** Column index for a cell reference: "B7" -> 1. */
export function columnIndex(reference) {
  const letters = String(reference).match(/^[A-Z]+/i);
  if (!letters) return 0;
  return letters[0].toUpperCase().split('').reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

/** Excel stores dates as days since 1899-12-30. */
export function isoToExcelSerial(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Converts an Excel date serial back to yyyy-mm-dd. */
export function excelSerialToIso(serial) {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Worksheet XML for a table of rows. */
function sheetXml(columns, rows, extra = '') {
  const cells = [];
  cells.push(`<row r="1">${columns.map((column, index) => (
    `<c r="${columnName(index)}1" t="inlineStr" s="2"><is><t>${escapeXml(column.title)}</t></is></c>`
  )).join('')}</row>`);
  rows.forEach((row, rowIndex) => {
    const reference = rowIndex + 2;
    const content = columns.map((column, index) => {
      const value = row[column.key];
      const cell = `${columnName(index)}${reference}`;
      if (value === null || value === undefined || value === '') return '';
      if (column.type === 'number') return `<c r="${cell}"><v>${Number(value)}</v></c>`;
      if (column.type === 'date') {
        return `<c r="${cell}" s="${DATE_STYLE}"><v>${isoToExcelSerial(String(value))}</v></c>`;
      }
      return `<c r="${cell}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    cells.push(`<row r="${reference}">${content}</row>`);
  });
  const columnsXml = columns.map((column, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${column.width || 16}" customWidth="1"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<cols>${columnsXml}</cols><sheetData>${cells.join('')}</sheetData>${extra}</worksheet>`;
}

/** A clustered bar chart with an average line, as Excel stores it. */
function chartXml(chart) {
  const sheet = escapeXml(chart.sheetName);
  const last = chart.points.length + 1;
  const categoryPoints = chart.points.map((point, index) => (
    `<c:pt idx="${index}"><c:v>${escapeXml(point.label)}</c:v></c:pt>`
  )).join('');
  const valuePoints = chart.points.map((point, index) => (
    `<c:pt idx="${index}"><c:v>${Number(point.value)}</c:v></c:pt>`
  )).join('');
  const averagePoints = chart.points.map((unused, index) => (
    `<c:pt idx="${index}"><c:v>${Number(chart.average || 0)}</c:v></c:pt>`
  )).join('');
  const categories = `<c:cat><c:strRef><c:f>'${sheet}'!$A$2:$A$${last}</c:f>`
    + `<c:strCache><c:ptCount val="${chart.points.length}"/>${categoryPoints}</c:strCache></c:strRef></c:cat>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:tx><c:strRef><c:f>'${sheet}'!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(chart.valueTitle)}</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="F97316"/></a:solidFill></c:spPr>
${categories}
<c:val><c:numRef><c:f>'${sheet}'!$B$2:$B$${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${chart.points.length}"/>${valuePoints}</c:numCache></c:numRef></c:val>
</c:ser>
<c:gapWidth val="60"/><c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>
<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>
<c:ser><c:idx val="1"/><c:order val="1"/>
<c:tx><c:strRef><c:f>'${sheet}'!$C$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXml(chart.averageTitle)}</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="4F46E5"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
${categories}
<c:val><c:numRef><c:f>'${sheet}'!$C$2:$C$${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${chart.points.length}"/>${averagePoints}</c:numCache></c:numRef></c:val>
<c:smooth val="0"/></c:ser>
<c:marker val="0"/><c:axId val="111111111"/><c:axId val="222222222"/></c:lineChart>
<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>
<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="0"/><c:crossAx val="111111111"/></c:valAx>
</c:plotArea>
<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart></c:chartSpace>`;
}

const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor>
<xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>15</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>24</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>
</a:graphicData></a:graphic></xdr:graphicFrame>
<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;

/**
 * Builds an .xlsx file with one data sheet and, optionally, a second sheet
 * holding the statistics and a real Excel chart.
 * @param {{sheetName?: string, columns: Array<{key: string, title: string, type?: 'text'|'number'|'date', width?: number}>,
 *          rows: Array<Record<string, any>>,
 *          chart?: {sheetName?: string, title: string, valueTitle: string, averageTitle: string,
 *                   points: Array<{label: string, value: number}>, average: number}}} table
 * @returns {Promise<Uint8Array>}
 */
export function buildXlsx(table) {
  const clean = (name, fallback) => (name || fallback).slice(0, 31).replace(/[\\/?*[\]:]/g, ' ');
  const sheetName = clean(table.sheetName, 'Data');
  const chart = table.chart && table.chart.points && table.chart.points.length
    ? { ...table.chart, sheetName: clean(table.chart.sheetName, 'Statistics') }
    : null;

  const sheet = sheetXml(table.columns, table.rows);
  const statsSheet = chart ? sheetXml(
    [
      { key: 'label', title: chart.categoryTitle || 'Period', width: 16 },
      { key: 'value', title: chart.valueTitle, type: 'number', width: 16 },
      { key: 'average', title: chart.averageTitle, type: 'number', width: 16 },
    ],
    chart.points.map((point) => ({ label: point.label, value: point.value, average: chart.average })),
    '<drawing r:id="rId1"/>',
  ) : null;

  const sheetsXml = [`<sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>`];
  if (chart) sheetsXml.push(`<sheet name="${escapeXml(chart.sheetName)}" sheetId="2" r:id="rId2"/>`);

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetsXml.join('')}</sheets></workbook>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
${chart ? '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
  + '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
${chart ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' : ''}
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];

  if (chart) {
    files.push(
      { name: 'xl/worksheets/sheet2.xml', data: statsSheet },
      {
        name: 'xl/worksheets/_rels/sheet2.xml.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`,
      },
      { name: 'xl/drawings/drawing1.xml', data: DRAWING_XML },
      {
        name: 'xl/drawings/_rels/drawing1.xml.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`,
      },
      { name: 'xl/charts/chart1.xml', data: chartXml(chart) },
    );
  }
  return createZip(files);
}

function decodeXmlEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const code = entity[1] === 'x' || entity[1] === 'X'
      ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function textOf(xml) {
  const parts = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXmlEntities(match[1]));
  return parts.join('');
}

/**
 * Reads the first worksheet of an .xlsx file.
 * @param {Uint8Array} bytes
 * @returns {Promise<{sheetName: string, rows: Array<Array<string|number>>}>}
 */
export async function parseXlsx(bytes) {
  const files = await readZip(bytes);
  const decoder = new TextDecoder();
  const read = (name) => (files.has(name) ? decoder.decode(files.get(name)) : '');

  const sharedXml = read('xl/sharedStrings.xml');
  const shared = sharedXml
    ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]))
    : [];

  const sheetNames = [...read('xl/workbook.xml').matchAll(/<sheet[^>]*name="([^"]*)"/g)]
    .map((match) => decodeXmlEntities(match[1]));
  const sheetFile = [...files.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetFile) throw new Error('No worksheet found in the file');
  const sheetXml = read(sheetFile);

  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [];
    for (const cellMatch of (rowMatch[1] || '').matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] || '';
      const reference = (attributes.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attributes.match(/t="([^"]+)"/) || [])[1];
      const index = reference ? columnIndex(reference) : cells.length;
      let value;
      if (type === 's') {
        const sharedIndex = Number((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
        value = shared[sharedIndex] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else if (type === 'str') {
        value = decodeXmlEntities((body.match(/<v>([\s\S]*?)<\/v>/) || [, ''])[1]);
      } else {
        const raw = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        value = raw === undefined ? '' : Number(raw);
        if (Number.isNaN(value)) value = raw;
      }
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    rows.push(cells);
  }
  return { sheetName: sheetNames[0] || 'Sheet1', rows };
}
