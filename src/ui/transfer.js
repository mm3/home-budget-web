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

const FIELD_KEYS = {
  date: 'common.date', amount: 'common.amount', category: 'common.category',
  currency: 'common.currency', note: 'common.note',
};

export function transferPanel(app, entries) {
  const t = app.t;
  return el('section.card', {}, [
    el('header.card-head', {}, [el('h2', { text: t('transfer.title') })]),
    el('div.transfer', {}, [
      el('div.transfer-block', {}, [
        el('h3', { text: t('transfer.exportTitle') }),
        el('div.button-row', {}, [
          el('button', { type: 'button', text: 'CSV', on: { click: () => exportCsv(app, entries) } }),
          el('button', { type: 'button', text: 'Excel (.xlsx)', on: { click: () => exportXlsx(app, entries) } }),
          el('button', { type: 'button', text: 'PDF', on: { click: () => exportPdf(app, entries) } }),
        ]),
      ]),
      el('div.transfer-block', {}, [
        el('h3', { text: t('transfer.importTitle') }),
        el('input', {
          type: 'file', accept: '.csv,.txt,.tsv,.xlsx',
          on: { change: (event) => pickFile(app, event.target.files[0]) },
        }),
        el('p.muted', { text: t('transfer.importHint') }),
      ]),
    ]),
    app.ui.importPreview ? importPreview(app) : null,
  ]);
}

/** Everything the export functions need, including the texts used inside the files. */
function context(app) {
  return {
    categories: app.store.categories,
    currencies: app.store.currencies,
    today: app.store.today(),
    chartCurrency: app.viewCurrency(),
    chartPeriod: app.ui.statsPeriod,
    chartCount: 12,
    periodTexts: app.periodTexts(),
    labels: {
      expenses: app.t('common.expenses'),
      income: app.t('common.income'),
      balance: app.t('common.balance'),
      date: app.t('common.date'),
      category: app.t('common.category'),
      note: app.t('common.note'),
      amount: app.t('common.amount'),
      average: app.t('stats.averageColumn'),
      statistics: app.t('nav.stats'),
      period: app.t('stats.periodColumn'),
    },
  };
}

function exportCsv(app, entries) {
  download(buildCsvExport(entries, context(app)), exportFileName('csv', app.store.today()), MIME.csv);
  app.notify(app.t('transfer.exported', { count: entries.length, format: 'CSV' }));
}

async function exportXlsx(app, entries) {
  const bytes = await buildXlsxExport(entries, context(app));
  download(bytes, exportFileName('xlsx', app.store.today()), MIME.xlsx);
  app.notify(app.t('transfer.exported', { count: entries.length, format: 'Excel' }));
}

function exportPdf(app, entries) {
  const bytes = buildPdfExport(entries, {
    ...context(app),
    subtitle: describeRange(app, entries),
    footer: app.t('app.title'),
  });
  download(bytes, exportFileName('pdf', app.store.today()), MIME.pdf);
  app.notify(app.t('transfer.exported', { count: entries.length, format: 'PDF' }));
}

function describeRange(app, entries) {
  const filter = app.ui.filter;
  if (filter.from || filter.to) {
    return `${filter.from ? formatDate(filter.from) : '...'} - ${filter.to ? formatDate(filter.to) : '...'}`;
  }
  return app.countText(entries.length);
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
    app.notify(app.t('transfer.readError', { message: error.message }), 'error');
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
  const t = app.t;
  const columnOptions = [{ value: '', label: t('transfer.notUsed') },
    ...Array.from({ length: width }, (unused, index) => ({
      value: String(index),
      label: `${t('transfer.column', { number: index + 1 })}${structure.headerRow !== null && rows[structure.headerRow][index]
        ? `: ${rows[structure.headerRow][index]}` : ''}`,
    }))];

  const setMapping = (fieldName, value) => app.setUi({
    importPreview: {
      ...preview,
      structure: { ...structure, mapping: { ...structure.mapping, [fieldName]: value === '' ? null : Number(value) } },
    },
  });

  return el('div.import-preview', {}, [
    el('h3', { text: t('transfer.previewTitle', { file: preview.fileName }) }),
    el('p.muted', {
      text: structure.confidence === 'header' ? t('transfer.byHeader') : t('transfer.byContent'),
    }),
    structure.warnings.length ? el('p.warning', { text: structure.warnings.join('. ') }) : null,
    el('div.filters', {}, Object.keys(FIELD_KEYS).map((fieldName) => field(
      t(FIELD_KEYS[fieldName]),
      el('select', { on: { change: (event) => setMapping(fieldName, event.target.value) } },
        options(columnOptions, structure.mapping[fieldName] === null ? '' : String(structure.mapping[fieldName]))),
    ))),
    el('p.summary', { text: describeImport(result) }),
    result.entries.length ? el('div.table-wrap', {}, el('table.entries-table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: t('common.date') }), el('th', { text: t('common.category') }),
        el('th', { text: t('common.note') }), el('th.num', { text: t('common.amount') }),
      ])),
      el('tbody', {}, result.entries.slice(0, 5).map((entry) => el('tr', {}, [
        el('td', { text: formatDate(entry.date) }),
        el('td', {
          text: entry.categoryName || app.categoryName(app.store.category(app.store.settings.defaultCategoryId)),
        }),
        el('td', { text: entry.note }),
        el('td.num', { text: formatMoney(entry.amount, app.store.currency(entry.currency)) }),
      ]))),
    ])) : null,
    result.skipped.length
      ? el('p.muted', {
        text: t('transfer.skippedRows', {
          rows: result.skipped.slice(0, 5).map((item) => `#${item.row} (${item.reason})`).join(', '),
        }),
      })
      : null,
    el('div.button-row', {}, [
      el('button.primary', {
        type: 'button',
        text: t('transfer.importButton', { count: result.entries.length }),
        disabled: result.entries.length === 0,
        on: { click: () => runImport(app, result) },
      }),
      el('button', { type: 'button', text: t('common.cancel'), on: { click: () => app.setUi({ importPreview: null }) } }),
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
  app.notify(app.t('transfer.imported', { count: added }));
}
