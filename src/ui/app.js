/** Application shell: state, navigation, dialogs and rendering. */

import { BudgetStore } from '../core/store.js';
import { loadState, migrateState, pickStorage, saveState } from '../core/storage.js';
import { append, clear, el, render } from './dom.js';
import { entriesView, entryForm } from './views/entries.js';
import { homeView } from './views/home.js';
import { settingsView, categoryForm } from './views/settings.js';
import { statsView } from './views/stats.js';

const TABS = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'entries', label: 'Entries', icon: '☰' },
  { id: 'stats', label: 'Stats', icon: '◔' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export class App {
  constructor(root, options = {}) {
    this.root = root;
    const picked = options.storage ? { storage: options.storage, kind: 'memory' } : pickStorage();
    this.storageKind = picked.kind === 'localStorage' ? 'local storage' : picked.kind;
    this.storage = picked.storage;
    const loaded = loadState(this.storage);
    this.store = new BudgetStore({
      state: loaded.state,
      persist: (state) => saveState(this.storage, state),
      clock: options.clock,
    });
    this.ui = {
      tab: 'home',
      homePeriod: 'day',
      statsPeriod: 'month',
      currency: null,
      showIncome: false,
      filter: {},
      importPreview: null,
      message: loaded.error ? { text: loaded.error, kind: 'error' } : null,
    };
    this.store.subscribe(() => this.render());
  }

  /** Currency the dashboard and statistics are shown in. */
  viewCurrency() {
    const used = this.store.usedCurrencies();
    return used.includes(this.ui.currency) ? this.ui.currency : used[0];
  }

  setTab(tab) {
    this.ui.tab = tab;
    this.ui.importPreview = null;
    this.render();
  }

  setUi(changes) {
    Object.assign(this.ui, changes);
    this.render();
  }

  notify(text, kind = 'ok') {
    this.focusQuickInput = this.ui.tab === 'home';
    this.ui.message = { text, kind };
    this.render();
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.ui.message = null;
      this.render();
    }, 4000);
  }

  /** Runs an action that may throw a user-facing error. */
  run(action) {
    try {
      const result = action();
      return result;
    } catch (error) {
      this.notify(error.message, 'error');
      return null;
    }
  }

  // ------------------------------------------------------------- dialogs

  openDialog({ title, body, focus }) {
    const dialog = el('dialog.dialog', { on: { cancel: () => this.closeDialog() } }, [
      el('header.dialog-head', {}, [
        el('h2', { text: title }),
        el('button.link', { type: 'button', text: '✕', 'aria-label': 'Close', on: { click: () => this.closeDialog() } }),
      ]),
      body,
    ]);
    this.dialog = dialog;
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', 'open');
    if (focus) focus.focus();
  }

  closeDialog() {
    if (!this.dialog) return;
    if (typeof this.dialog.close === 'function' && this.dialog.open) this.dialog.close();
    this.dialog.remove();
    this.dialog = null;
    this.render();
  }

  editEntry(id) {
    const entry = id ? this.store.entries.find((item) => item.id === id) : null;
    this.openDialog(entryForm(this, entry));
  }

  deleteEntry(id) {
    const entry = this.store.entries.find((item) => item.id === id);
    if (!entry) return;
    if (!window.confirm('Delete this entry?')) return;
    this.run(() => this.store.deleteEntry(id));
    this.notify('Entry deleted');
  }

  editCategory(id) {
    const category = id ? this.store.categories.find((item) => item.id === id) : null;
    this.openDialog(categoryForm(this, category));
  }

  deleteCategory(id) {
    const used = this.store.categoryUsage().get(id) || 0;
    if (used > 0) {
      const target = window.prompt(
        `"${this.store.category(id).name}" has ${used} entries. Move them to which category? Type its name, or cancel.`,
        this.store.category(this.store.settings.defaultCategoryId).name,
      );
      if (target === null) return;
      const moveTo = this.store.categories.find((item) => item.name.toLowerCase() === target.trim().toLowerCase());
      if (!moveTo) {
        this.notify(`No category named "${target}"`, 'error');
        return;
      }
      this.run(() => this.store.deleteCategory(id, moveTo.id));
    } else if (window.confirm('Delete this category?')) {
      this.run(() => this.store.deleteCategory(id));
    }
  }

  clearEntries() {
    if (!window.confirm('Delete all entries? The categories and settings stay.')) return;
    const removed = this.store.clearEntries();
    this.notify(`${removed} entries deleted`);
  }

  restore(rawState) {
    const state = migrateState(rawState);
    this.store.replaceState(state);
    this.notify(`Backup restored: ${state.entries.length} entries`);
  }

  // ------------------------------------------------------------- rendering

  render() {
    const settings = this.store.settings;
    document.body.dataset.mode = settings.uiMode;
    document.body.dataset.theme = settings.theme;
    document.body.classList.toggle('dark', this.prefersDark(settings.theme));
    const view = this.currentView();
    render(this.root, [
      el('header.app-bar', {}, [
        el('div.brand', {}, [el('span.logo', { text: '€' }), el('strong', { text: 'Home Budget' })]),
        el('nav.tabs', {}, TABS.map((tab) => el('button', {
          type: 'button',
          class: tab.id === this.ui.tab ? 'tab active' : 'tab',
          on: { click: () => this.setTab(tab.id) },
        }, [el('span.tab-icon', { text: tab.icon }), el('span.tab-label', { text: tab.label })]))),
      ]),
      this.ui.message ? el('p', { class: `toast ${this.ui.message.kind}`, text: this.ui.message.text }) : null,
      el('main.main', {}, view),
      el('footer.app-footer', {}, [
        el('span', { text: `Stored in your browser (${this.storageKind}) · works offline` }),
      ]),
    ]);
  }

  /** True when the desktop layout is in use (explicit setting or a wide window). */
  isDesktop() {
    const mode = this.store.settings.uiMode;
    if (mode !== 'auto') return mode === 'desktop';
    return typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 721px)').matches;
  }

  /** True when the dark palette should be used. */
  prefersDark(theme) {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  currentView() {
    switch (this.ui.tab) {
      case 'entries': return entriesView(this);
      case 'stats': return statsView(this);
      case 'settings': return settingsView(this);
      default: return homeView(this);
    }
  }
}

/** Creates the application inside a root element. */
export function startApp(root, options) {
  const app = new App(root, options);
  app.render();
  return app;
}
