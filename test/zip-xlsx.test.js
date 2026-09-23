import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createZip, readZip } from '../src/core/zip.js';
import {
  buildXlsx, columnIndex, columnName, excelSerialToIso, isoToExcelSerial, parseXlsx,
} from '../src/core/xlsx.js';

test('crc32 matches the known value for "123456789"', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('a zip archive can be written and read back', async () => {
  const long = 'x'.repeat(5000);
  const archive = await createZip([
    { name: 'hello.txt', data: 'Hello, world' },
    { name: 'folder/long.txt', data: long },
    { name: 'binary.bin', data: new Uint8Array([1, 2, 3, 255]) },
  ]);
  assert.equal(archive[0], 0x50);
  const files = await readZip(archive);
  const decoder = new TextDecoder();
  assert.deepEqual([...files.keys()], ['hello.txt', 'folder/long.txt', 'binary.bin']);
  assert.equal(decoder.decode(files.get('hello.txt')), 'Hello, world');
  assert.equal(decoder.decode(files.get('folder/long.txt')), long);
  assert.deepEqual([...files.get('binary.bin')], [1, 2, 3, 255]);
});

test('reading a damaged archive fails with a clear message', async () => {
  await assert.rejects(() => readZip(new Uint8Array(40)), /Not a ZIP file/);
  const archive = await createZip([{ name: 'a.txt', data: 'a' }]);
  const broken = archive.slice();
  const view = new DataView(broken.buffer);
  const endOffset = broken.length - 22;
  view.setUint32(view.getUint32(endOffset + 16, true), 0x01020304, true);
  await assert.rejects(() => readZip(broken), /Damaged ZIP file/);
});

test('spreadsheet column names and date serials convert both ways', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(27), 'AB');
  assert.equal(columnIndex('A1'), 0);
  assert.equal(columnIndex('AB12'), 27);
  assert.equal(columnIndex('12'), 0);
  assert.equal(isoToExcelSerial('1900-01-01'), 2);
  assert.equal(excelSerialToIso(isoToExcelSerial('2026-09-22')), '2026-09-22');
  assert.equal(excelSerialToIso(Number.NaN), null);
});

test('xlsx written by the app can be read by the app', async () => {
  const bytes = await buildXlsx({
    sheetName: 'Home/Budget*2026 with a very long name that must be cut',
    columns: [
      { key: 'date', title: 'Date', type: 'date' },
      { key: 'amount', title: 'Amount', type: 'number' },
      { key: 'note', title: 'Note' },
      { key: 'empty', title: 'Empty' },
    ],
    rows: [
      { date: '2026-09-22', amount: 12.5, note: 'Coffee & "cake" <b>', empty: '' },
      { date: '2026-09-21', amount: -3, note: '', empty: null },
    ],
  });
  const parsed = await parseXlsx(bytes);
  assert.equal(parsed.sheetName.length <= 31, true);
  assert.deepEqual(parsed.rows[0], ['Date', 'Amount', 'Note', 'Empty']);
  assert.equal(excelSerialToIso(parsed.rows[1][0]), '2026-09-22');
  assert.equal(parsed.rows[1][1], 12.5);
  assert.equal(parsed.rows[1][2], 'Coffee & "cake" <b>');
  assert.equal(parsed.rows[2][1], -3);
});

test('xlsx files with shared strings are understood', async () => {
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="str"><v>plain &amp; simple</v></c><c r="B2"><v>7</v></c><c r="C2"><v>oops</v></c></row>
    <row r="3"><c r="A3"/></row></sheetData></worksheet>`;
  const shared = '<?xml version="1.0"?><sst><si><t>Date</t></si><si><r><t>Amo</t></r><r><t>unt</t></r></si></sst>';
  const workbook = '<?xml version="1.0"?><workbook><sheets><sheet name="Budget &amp; more" sheetId="1"/></sheets></workbook>';
  const bytes = await createZip([
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/sharedStrings.xml', data: shared },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
  const parsed = await parseXlsx(bytes);
  assert.equal(parsed.sheetName, 'Budget & more');
  assert.deepEqual(parsed.rows[0], ['Date', '', 'Amount']);
  assert.deepEqual(parsed.rows[1], ['plain & simple', 7, 'oops']);
  assert.deepEqual(parsed.rows[2], ['']);
});

test('a chart sheet is added when chart data is given', async () => {
  const bytes = await buildXlsx({
    sheetName: 'Home Budget',
    columns: [{ key: 'date', title: 'Date', type: 'date' }, { key: 'amount', title: 'Amount', type: 'number' }],
    rows: [{ date: '2026-09-22', amount: -12.5 }],
    chart: {
      sheetName: 'Statistics',
      title: 'Expenses (EUR)',
      categoryTitle: 'Period',
      valueTitle: 'Expenses',
      averageTitle: 'Average',
      points: [{ label: 'Jul 26', value: 120.5 }, { label: 'Aug 26', value: 88 }, { label: 'Sep 26', value: 135.45 }],
      average: 114.65,
    },
  });
  const files = await readZip(bytes);
  const names = [...files.keys()];
  for (const part of ['xl/worksheets/sheet2.xml', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml',
    'xl/drawings/_rels/drawing1.xml.rels', 'xl/worksheets/_rels/sheet2.xml.rels']) {
    assert.ok(names.includes(part), `${part} is in the file`);
  }
  const decoder = new TextDecoder();
  const chart = decoder.decode(files.get('xl/charts/chart1.xml'));
  assert.match(chart, /c:barChart/);
  assert.match(chart, /c:lineChart/, 'the average is drawn as a line');
  assert.match(chart, /'Statistics'!\$B\$2:\$B\$4/);
  assert.match(chart, /<c:v>135\.45<\/c:v>/);
  assert.match(chart, /<c:v>114\.65<\/c:v>/);
  assert.match(decoder.decode(files.get('[Content_Types].xml')), /drawingml\.chart\+xml/);
  assert.match(decoder.decode(files.get('xl/worksheets/sheet2.xml')), /<drawing r:id="rId1"\/>/);

  const statistics = decoder.decode(files.get('xl/worksheets/sheet2.xml'));
  assert.match(statistics, /Jul 26/);
  assert.equal((await parseXlsx(bytes)).sheetName, 'Home Budget', 'the entries stay the first sheet');
});

test('no chart parts are written without chart data', async () => {
  const bytes = await buildXlsx({
    columns: [{ key: 'a', title: 'A' }],
    rows: [{ a: 'x' }],
    chart: { points: [], title: 't', valueTitle: 'v', averageTitle: 'avg', average: 0 },
  });
  const names = [...(await readZip(bytes)).keys()];
  assert.ok(!names.some((name) => name.includes('chart')));
});

test('a file without a worksheet is rejected', async () => {
  const bytes = await createZip([{ name: 'xl/workbook.xml', data: '<workbook/>' }]);
  await assert.rejects(() => parseXlsx(bytes), /No worksheet/);
});
