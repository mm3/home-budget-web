/** Export buttons and the import panel with automatic structure detection. */

import { parseCsv } from '../core/csv.js';
import {
  buildCsvExport, buildPdfExport, buildXlsxExport, exportFileName,
} from '../core/exporter.js';
import { formatDate, formatMoney } from '../core/format.js';
import { convertRows, describeImport, detectStructure } from '../core/importer.js';
import { parseXlsx } from '../core/xlsx.js';
import { el, field, options, render } from './dom.js';
import { download, MIME, readAsBytes, readAsText } from './files.js';

const FIELD_LABELS = { date: 'Date', amount: 'Amount', category: 'Category', currency: 'Currency', note: 'Note' };

export function transferPanel(app, entries) {
  return el('section.card', {}, [
    el('header.card-head', {}, [el('h2', { text: 'Export and import' })]),
    el('div.transfer', {}, [
      el('div.transfer-block', {}, [
        el('h3', { text: 'Export the entries shown above' }),
        el('div.button-row', {}, [
          el('button', { type: 'button', text: 'CSV', on: { click: () => exportCsv(app, entries) } }),
          el('button', { type: 'button', text: 'Excel (.xlsx)', on: { click: () => exportXlsx(app, entries) } }),
          el('button', { type: 'button', text: 'PDF', on: { click: () => exportPdf(app, entries) } }),
        ]),
      ]),
      el('div.transfer-block', {}, [
        el('h3', { text: 'Import from CSV or Excel' }),
        el('input', {
          type: 'file', accept: '.csv,.txt,.tsv,.xlsx',
          on: { change: (event) => pickFile(app, event.target.files[0]) },
        }),
        el('p.muted', { text: 'Columns are detected automatically; you can correct them before importing.' }),
      ]),
    ]),
    app.ui.importPreview ? importPreview(app) : null,
  ]);
}

function context(app) {
  return { categories: app.store.categories, currencies: app.store.currencies };
}

function exportCsv(app, entries) {
  download(buildCsvExport(entries, context(app)), exportFileName('csv', app.store.today()), MIME.csv);
  app.notify(`Exported ${entries.length} entries to CSV`);
}

async function exportXlsx(app, entries) {
  const bytes = await buildXlsxExport(entries, context(app));
  download(bytes, exportFileName('xlsx', app.store.today()), MIME.xlsx);
  app.notify(`Exported ${entries.length} entries to Excel`);
}

function exportPdf(app, entries) {
  const bytes = buildPdfExport(entries, {
    ...context(app),
    subtitle: describeRange(app, entries),
    footer: 'Home Budget',
  });
  download(bytes, exportFileName('pdf', app.store.today()), MIME.pdf);
  app.notify(`Exported ${entries.length} entries to PDF`);
}

function describeRange(app, entries) {
  const filter = app.ui.filter;
  if (filter.from || filter.to) {
    return `${filter.from ? formatDate(filter.from) : '...'} - ${filter.to ? formatDate(filter.to) : '...'}`;
  }
  return `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
}

async function pickFile(app, file) {
  if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name)
      ? (await parseXlsx(await readAsBytes(file))).rows
      : parseCsv(await readAsText(file)).rows;
    const structure = detectStructure(rows);
    app.setUi({ importPreview: { fileName: file.name, rows, structure } });
  } catch (error) {
    app.notify(`Could not read the file: ${error.message}`, 'error');
  }
}

function importPreview(app) {
  const preview = app.ui.importPreview;
  const { rows, structure } = preview;
  const result = convertRows(rows, structure, {
    categories: app.store.categories,
    currencies: app.store.currencies,
    defaultCategoryId: app.store.settings.defaultCategoryId,
    defaultCurrency: app.store.settings.defaultCurrency,
    today: app.store.today(),
  });
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columnOptions = [{ value: '', label: 'not used' },
    ...Array.from({ length: width }, (unused, index) => ({
      value: String(index),
      label: `Column ${index + 1}${structure.headerRow !== null && rows[structure.headerRow][index]
        ? `: ${rows[structure.headerRow][index]}` : ''}`,
    }))];

  const setMapping = (fieldName, value) => app.setUi({
    importPreview: {
      ...preview,
      structure: { ...structure, mapping: { ...structure.mapping, [fieldName]: value === '' ? null : Number(value) } },
    },
  });

  return el('div.import-preview', {}, [
    el('h3', { text: `Import preview - ${preview.fileName}` }),
    el('p.muted', {
      text: structure.confidence === 'header'
        ? 'Columns were matched by their header names.'
        : 'No header was recognised, so the columns were guessed from their contents.',
    }),
    structure.warnings.length ? el('p.warning', { text: structure.warnings.join('. ') }) : null,
    el('div.filters', {}, Object.keys(FIELD_LABELS).map((fieldName) => field(
      FIELD_LABELS[fieldName],
      el('select', { on: { change: (event) => setMapping(fieldName, event.target.value) } },
        options(columnOptions, structure.mapping[fieldName] === null ? '' : String(structure.mapping[fieldName]))),
    ))),
    el('p.summary', { text: describeImport(result) }),
    result.entries.length ? el('div.table-wrap', {}, el('table.entries-table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Date' }), el('th', { text: 'Category' }), el('th', { text: 'Note' }), el('th.num', { text: 'Amount' }),
      ])),
      el('tbody', {}, result.entries.slice(0, 5).map((entry) => el('tr', {}, [
        el('td', { text: formatDate(entry.date) }),
        el('td', { text: entry.categoryName || app.store.category(app.store.settings.defaultCategoryId).name }),
        el('td', { text: entry.note }),
        el('td.num', { text: formatMoney(entry.amount, app.store.currency(entry.currency)) }),
      ]))),
    ])) : null,
    result.skipped.length
      ? el('p.muted', { text: `Skipped rows: ${result.skipped.slice(0, 5).map((item) => `#${item.row} (${item.reason})`).join(', ')}` })
      : null,
    el('div.button-row', {}, [
      el('button.primary', {
        type: 'button',
        text: `Import ${result.entries.length} entries`,
        disabled: result.entries.length === 0,
        on: { click: () => runImport(app, result) },
      }),
      el('button', { type: 'button', text: 'Cancel', on: { click: () => app.setUi({ importPreview: null }) } }),
    ]),
  ]);
}

function runImport(app, result) {
  const store = app.store;
  const prepared = result.entries.map((entry) => {
    const categoryId = entry.categoryId
      || (entry.categoryName ? store.categoryByNameOrCreate(entry.categoryName).id : store.settings.defaultCategoryId);
    return { ...entry, categoryId };
  });
  const added = store.addEntries(prepared);
  app.setUi({ importPreview: null });
  app.notify(`Imported ${added} ${added === 1 ? 'entry' : 'entries'}`);
}
