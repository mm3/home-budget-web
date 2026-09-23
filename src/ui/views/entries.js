/** Entries screen: filters, the list itself, and the export / import panel. */

import { formatDate, formatMoney, periodStart, todayIso } from '../../core/format.js';
import { totals } from '../../core/stats.js';
import { el, field, options, render } from '../dom.js';
import { transferPanel } from '../transfer.js';

export function entriesView(app) {
  const store = app.store;
  const filter = app.ui.filter;
  const entries = store.list(filter);
  const currency = store.currency(app.viewCurrency());
  const sums = totals(entries, store.categories);

  const categoryOptions = [{ value: '', label: 'All categories' },
    ...store.categories.map((category) => ({ value: category.id, label: category.name }))];
  const currencyOptions = [{ value: '', label: 'All currencies' },
    ...store.currencies.map((item) => ({ value: item.code, label: item.code }))];

  const update = (changes) => app.setUi({ filter: { ...filter, ...changes } });

  return [
    el('section.card', {}, [
      el('header.card-head', {}, [
        el('h2', { text: 'Entries' }),
        el('button.primary', { type: 'button', text: '+ Add entry', on: { click: () => app.editEntry(null) } }),
      ]),
      el('details.filters-box', { open: app.isDesktop() }, [
        el('summary', { text: 'Filters and search' }),
        el('div.filters', {}, [
        field('From', el('input', {
          type: 'date', value: filter.from || '', on: { change: (event) => update({ from: event.target.value }) },
        })),
        field('To', el('input', {
          type: 'date', value: filter.to || '', on: { change: (event) => update({ to: event.target.value }) },
        })),
        field('Category', el('select', {
          on: { change: (event) => update({ categoryId: event.target.value }) },
        }, options(categoryOptions, filter.categoryId || ''))),
        field('Currency', el('select', {
          on: { change: (event) => update({ currency: event.target.value }) },
        }, options(currencyOptions, filter.currency || ''))),
        field('Search', el('input', {
          type: 'search', value: filter.text || '', placeholder: 'note or category',
          on: { input: (event) => update({ text: event.target.value }) },
        })),
        el('div.filter-actions', {}, [
          el('button', { type: 'button', text: 'This month', on: { click: () => update({
            from: periodStart(store.today(), 'month'), to: store.today(),
          }) } }),
          el('button', { type: 'button', text: 'Clear', on: { click: () => app.setUi({ filter: {} }) } }),
        ]),
        ]),
      ]),
      el('p.summary', {}, [
        el('span', { text: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` }),
        el('span.expense', { text: `Expenses ${formatMoney(sums.expense, currency)}` }),
        sums.income ? el('span.income', { text: `Income ${formatMoney(sums.income, currency)}` }) : null,
        el('span', { text: `Balance ${formatMoney(sums.net, currency, { sign: true })}` }),
      ]),
      entries.length
        ? el('div.table-wrap', {}, el('table.entries-table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Date' }), el('th', { text: 'Category' }), el('th.hide-sm', { text: 'Note' }),
            el('th.num', { text: 'Amount' }), el('th', {}),
          ])),
          el('tbody', {}, entries.map((entry) => entryRow(app, entry))),
        ]))
        : el('p.muted', { text: 'No entries match these filters.' }),
    ]),
    transferPanel(app, entries),
  ];
}

function entryRow(app, entry) {
  const category = app.store.category(entry.categoryId);
  const currency = app.store.currency(entry.currency);
  const signed = category.kind === 'income' ? entry.amount : -entry.amount;
  const open = (event) => {
    if (event.target.closest('button')) return; // the row buttons handle their own click
    app.editEntry(entry.id);
  };
  return el('tr.entry-row', { on: { click: open } }, [
    el('td', { text: formatDate(entry.date) }),
    el('td', {}, [el('span.dot', { style: `background:${category.color}` }), category.name]),
    el('td.hide-sm', { text: entry.note }),
    el('td', { class: `num ${category.kind === 'income' ? 'income' : 'expense'}`,
      text: formatMoney(signed, currency, { sign: true }) }),
    el('td.row-actions', {}, [
      el('button.link', { type: 'button', text: 'Edit', on: { click: () => app.editEntry(entry.id) } }),
      el('button.link.danger', { type: 'button', text: 'Delete', on: { click: () => app.deleteEntry(entry.id) } }),
    ]),
  ]);
}

/** Dialog contents for creating or editing one entry. */
export function entryForm(app, entry) {
  const store = app.store;
  const message = el('p.error');
  const amountInput = el('input', {
    type: 'number', step: '0.01', min: '0', required: true,
    value: entry ? (entry.amount / 10 ** store.currency(entry.currency).decimals).toFixed(
      store.currency(entry.currency).decimals) : '',
  });
  const dateInput = el('input', { type: 'date', required: true, value: entry ? entry.date : todayIso(new Date()) });
  const categorySelect = el('select', {}, options(
    store.categories.map((category) => ({ value: category.id, label: `${category.name} (${category.kind})` })),
    entry ? entry.categoryId : store.settings.defaultCategoryId,
  ));
  const currencySelect = el('select', {}, options(
    store.currencies.map((item) => ({ value: item.code, label: `${item.code} ${item.symbol}` })),
    entry ? entry.currency : store.settings.defaultCurrency,
  ));
  const noteInput = el('input', { type: 'text', maxlength: '200', value: entry ? entry.note : '' });

  const form = el('form.dialog-form', {
    on: {
      submit: (event) => {
        event.preventDefault();
        try {
          const currency = store.currency(currencySelect.value);
          const amount = Math.round(Number(amountInput.value) * 10 ** currency.decimals);
          const data = {
            amount: Math.abs(amount),
            date: dateInput.value,
            categoryId: categorySelect.value,
            currency: currency.code,
            note: noteInput.value,
          };
          if (entry) store.updateEntry(entry.id, data);
          else store.addEntry(data);
          app.closeDialog();
        } catch (error) {
          render(message, error.message);
        }
      },
    },
  }, [
    field('Amount', amountInput),
    field('Category', categorySelect),
    field('Date', dateInput),
    field('Currency', currencySelect),
    field('Note', noteInput),
    message,
    el('div.dialog-actions', {}, [
      entry ? el('button.link.danger', {
        type: 'button', text: 'Delete',
        on: { click: () => { app.closeDialog(); app.deleteEntry(entry.id); } },
      }) : null,
      el('span.spacer'),
      el('button', { type: 'button', text: 'Cancel', on: { click: () => app.closeDialog() } }),
      el('button.primary', { type: 'submit', text: entry ? 'Save' : 'Add' }),
    ]),
  ]);
  return { title: entry ? 'Edit entry' : 'New entry', body: form, focus: amountInput };
}
