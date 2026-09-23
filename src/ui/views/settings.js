/** Settings screen: categories, currencies, defaults, appearance and data management. */

import { el, field, options, render } from '../dom.js';
import { download, MIME } from '../files.js';

export function settingsView(app) {
  const store = app.store;
  const usage = store.categoryUsage();

  return [
    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: 'Defaults' })]),
      el('div.filters', {}, [
        field('Category for quick entries', el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ defaultCategoryId: event.target.value })) },
        }, options(store.categories.map((category) => ({ value: category.id, label: category.name })),
          store.settings.defaultCategoryId))),
        field('Currency', el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ defaultCurrency: event.target.value })) },
        }, options(store.currencies.map((currency) => ({ value: currency.code, label: `${currency.code} ${currency.symbol}` })),
          store.settings.defaultCurrency))),
        field('Display mode', el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ uiMode: event.target.value })) },
        }, options([
          { value: 'auto', label: 'Automatic' },
          { value: 'mobile', label: 'Mobile' },
          { value: 'desktop', label: 'Desktop' },
        ], store.settings.uiMode))),
        field('Theme', el('select', {
          on: { change: (event) => app.run(() => store.updateSettings({ theme: event.target.value })) },
        }, options([
          { value: 'auto', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ], store.settings.theme))),
      ]),
    ]),

    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: 'Categories' })]),
      el('div.table-wrap', {}, el('table.entries-table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Name' }), el('th', { text: 'Type' }), el('th.num', { text: 'Entries' }), el('th', {}),
        ])),
        el('tbody', {}, store.categories.map((category) => el('tr', {}, [
          el('td', {}, [el('span.dot', { style: `background:${category.color}` }), category.name,
            category.id === store.settings.defaultCategoryId ? el('span.badge', { text: 'default' }) : null]),
          el('td', { text: category.kind }),
          el('td.num', { text: String(usage.get(category.id) || 0) }),
          el('td.row-actions', {}, [
            el('button.link', { type: 'button', text: 'Edit', on: { click: () => app.editCategory(category.id) } }),
            category.id === store.settings.defaultCategoryId ? null : el('button.link.danger', {
              type: 'button', text: 'Delete', on: { click: () => app.deleteCategory(category.id) },
            }),
          ]),
        ]))),
      ])),
      el('div.button-row', {}, [
        el('button.primary', { type: 'button', text: '+ New category', on: { click: () => app.editCategory(null) } }),
      ]),
    ]),

    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: 'Currencies' })]),
      el('ul.chips', {}, store.currencies.map((currency) => el('li.chip', {}, [
        `${currency.code} ${currency.symbol}`,
        currency.code === store.settings.defaultCurrency ? el('span.badge', { text: 'default' }) : null,
        currency.code === store.settings.defaultCurrency ? null : el('button.link.danger', {
          type: 'button', text: '×', title: `Remove ${currency.code}`,
          on: { click: () => app.run(() => store.deleteCurrency(currency.code)) },
        }),
      ]))),
      currencyForm(app),
    ]),

    el('section.card', {}, [
      el('header.card-head', {}, [el('h2', { text: 'Data' })]),
      el('p.muted', { text: `Everything is stored in this browser (${app.storageKind}). Nothing is sent anywhere.` }),
      el('div.button-row', {}, [
        el('button', { type: 'button', text: 'Download backup (JSON)', on: { click: () => backup(app) } }),
        el('label.file-button', {}, [
          'Restore backup',
          el('input', {
            type: 'file', accept: '.json', hidden: true,
            on: { change: (event) => restore(app, event.target.files[0]) },
          }),
        ]),
        el('button.danger', { type: 'button', text: 'Delete all entries', on: { click: () => app.clearEntries() } }),
      ]),
    ]),
  ];
}

function currencyForm(app) {
  const code = el('input', { type: 'text', placeholder: 'SEK', maxlength: '5', size: '6' });
  const symbol = el('input', { type: 'text', placeholder: 'kr', maxlength: '4', size: '4' });
  const decimals = el('input', { type: 'number', min: '0', max: '4', value: '2', size: '2' });
  const message = el('p.error');
  return el('form.inline-form', {
    on: {
      submit: (event) => {
        event.preventDefault();
        try {
          app.store.addCurrency({
            code: code.value, symbol: symbol.value, decimals: Number(decimals.value),
          });
          code.value = '';
          symbol.value = '';
        } catch (error) {
          render(message, error.message);
        }
      },
    },
  }, [field('Code', code), field('Symbol', symbol), field('Decimals', decimals),
    el('button', { type: 'submit', text: 'Add currency' }), message]);
}

/** Dialog contents for creating or renaming a category. */
export function categoryForm(app, category) {
  const store = app.store;
  const message = el('p.error');
  const name = el('input', { type: 'text', required: true, maxlength: '40', value: category ? category.name : '' });
  const kind = el('select', {}, options([
    { value: 'expense', label: 'Expense' },
    { value: 'income', label: 'Income' },
  ], category ? category.kind : 'expense'));
  const color = el('input', { type: 'color', value: category ? category.color : '#4f46e5' });

  const form = el('form.dialog-form', {
    on: {
      submit: (event) => {
        event.preventDefault();
        try {
          const data = { name: name.value, kind: kind.value, color: color.value };
          if (category) store.updateCategory(category.id, data);
          else store.addCategory(data);
          app.closeDialog();
        } catch (error) {
          render(message, error.message);
        }
      },
    },
  }, [
    field('Name', name), field('Type', kind), field('Colour', color), message,
    el('div.dialog-actions', {}, [
      el('span.spacer'),
      el('button', { type: 'button', text: 'Cancel', on: { click: () => app.closeDialog() } }),
      el('button.primary', { type: 'submit', text: category ? 'Save' : 'Create' }),
    ]),
  ]);
  return { title: category ? 'Edit category' : 'New category', body: form, focus: name };
}

function backup(app) {
  download(JSON.stringify(app.store.state, null, 2), `home-budget-backup-${app.store.today()}.json`, MIME.json);
  app.notify('Backup downloaded');
}

async function restore(app, file) {
  if (!file) return;
  try {
    const state = JSON.parse(await file.text());
    app.restore(state);
  } catch (error) {
    app.notify(`Could not read the backup: ${error.message}`, 'error');
  }
}
