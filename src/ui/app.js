/** Application shell: state, navigation, dialogs and rendering. */

import { BudgetStore } from '../core/store.js';
import { AppError } from '../core/model.js';
import {
  createTranslator, CUSTOM_LANGUAGE, detectLanguage, LANGUAGES, periodTexts,
} from '../core/i18n.js';
import { APP_VERSION } from '../core/version.js';
import { loadState, migrateState, pickStorage, saveState } from '../core/storage.js';
import { append, clear, el, render } from './dom.js';
import { entriesView, entryForm, PAGE_SIZE } from './views/entries.js';
import { homeView } from './views/home.js';
import { settingsView, categoryForm } from './views/settings.js';
import { statsView } from './views/stats.js';

const TABS = [
  { id: 'home', key: 'nav.home', icon: '\u2302' },
  { id: 'entries', key: 'nav.entries', icon: '\u2630' },
  { id: 'stats', key: 'nav.stats', icon: '\u25d4' },
  { id: 'settings', key: 'nav.settings', icon: '\u2699' },
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
      showAverage: true,
      filter: {},
      // The list draws one row per entry, so a store with tens of thousands of them
      // would spend seconds in the DOM on every render. It grows on demand instead.
      shownEntries: PAGE_SIZE,
      importPreview: null,
      message: loaded.error ? { text: loaded.error, kind: 'error' } : null,
    };
    this.store.subscribe(() => this.render());
    this.t = (key, params) => this.translator()(key, params);
  }

  /** Translator for the language chosen in the settings. */
  translator() {
    const settings = this.store.settings;
    const language = settings.language === 'auto' ? this.detectedLanguage() : settings.language;
    const signature = `${language}|${settings.language === CUSTOM_LANGUAGE ? JSON.stringify(settings.customTranslation) : ''}`;
    if (this.translatorSignature !== signature) {
      this.translatorSignature = signature;
      this.translatorFunction = createTranslator(language, settings.customTranslation);
      this.translatedPeriods = periodTexts(this.translatorFunction);
    }
    return this.translatorFunction;
  }

  /** Month and week names for the charts, the statistics and the exports. */
  periodTexts() {
    this.translator();
    return this.translatedPeriods;
  }

  /** Language code guessed from the browser. */
  detectedLanguage() {
    const navigatorLanguages = typeof navigator === 'object' && navigator
      ? (navigator.languages || [navigator.language]).filter(Boolean)
      : [];
    return detectLanguage(navigatorLanguages);
  }

  detectedLanguageName() {
    const code = this.detectedLanguage();
    const found = LANGUAGES.find((item) => item.code === code);
    return found ? found.name : code;
  }

  /** Category name, translated when it is one of the predefined categories. */
  categoryName(category) {
    return category.nameKey ? this.t(category.nameKey) : category.name;
  }

  /** "3 entries" / "1 entry" in the chosen language. */
  countText(count) {
    return count === 1 ? this.t('common.entriesOne') : this.t('common.entries', { count });
  }

  /** Translates the few error messages that have a key, otherwise shows the message. */
  errorText(error) {
    if (!(error instanceof AppError)) return error.message;
    const map = {
      'Enter an amount, for example 12.50': 'error.amountRequired',
      'Unknown category': 'error.unknownCategory',
      'This amount is too large': 'error.amountTooLarge',
      'This amount is too small': 'error.amountTooSmall',
      'Amount cannot be zero': 'error.amountZero',
    };
    return map[error.message] ? this.t(map[error.message]) : error.message;
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
    // Any new filter starts the list from the top again.
    if (changes.filter !== undefined) this.ui.shownEntries = PAGE_SIZE;
    Object.assign(this.ui, changes);
    this.render();
  }

  /** Shows the next page of entries. */
  showMoreEntries(all = false) {
    this.ui.shownEntries = all ? Number.MAX_SAFE_INTEGER : this.ui.shownEntries + PAGE_SIZE;
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
      this.notify(this.errorText(error), 'error');
      return null;
    }
  }

  // ------------------------------------------------------------- dialogs

  openDialog({ title, body, focus }) {
    const dialog = el('dialog.dialog', { on: { cancel: () => this.closeDialog() } }, [
      el('header.dialog-head', {}, [
        el('h2', { text: title }),
        el('button.link', {
          type: 'button', text: '\u2715', 'aria-label': this.t('common.close'),
          on: { click: () => this.closeDialog() },
        }),
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
    if (!window.confirm(this.t('entries.confirmDelete'))) return;
    this.run(() => this.store.deleteEntry(id));
    this.notify(this.t('entries.deleted'));
  }

  editCategory(id) {
    const category = id ? this.store.categories.find((item) => item.id === id) : null;
    this.openDialog(categoryForm(this, category));
  }

  deleteCategory(id) {
    const used = this.store.categoryUsage().get(id) || 0;
    if (used > 0) {
      const target = window.prompt(
        this.t('settings.moveEntries', { category: this.categoryName(this.store.category(id)), count: used }),
        this.categoryName(this.store.category(this.store.settings.defaultCategoryId)),
      );
      if (target === null) return;
      const wanted = target.trim().toLowerCase();
      const moveTo = this.store.categories.find((item) => item.name.toLowerCase() === wanted
        || this.categoryName(item).toLowerCase() === wanted);
      if (!moveTo) {
        this.notify(this.t('settings.noCategoryNamed', { name: target }), 'error');
        return;
      }
      this.run(() => this.store.deleteCategory(id, moveTo.id));
    } else if (window.confirm(this.t('settings.confirmDeleteCategory'))) {
      this.run(() => this.store.deleteCategory(id));
    }
  }

  clearEntries() {
    if (!window.confirm(this.t('settings.confirmDeleteAll'))) return;
    const removed = this.store.clearEntries();
    this.notify(this.t('settings.deletedEntries', { count: removed }));
  }

  resetAll() {
    if (!window.confirm(this.t('settings.confirmResetAll'))) return;
    this.store.resetAll();
    this.notify(this.t('settings.resetDone'));
  }

  restore(rawState) {
    const state = migrateState(rawState);
    this.store.replaceState(state);
    this.notify(this.t('settings.backupRestored', { count: state.entries.length }));
  }

  // ------------------------------------------------------------- rendering

  render() {
    const settings = this.store.settings;
    document.body.dataset.mode = settings.uiMode;
    document.body.dataset.theme = settings.theme;
    document.body.classList.toggle('dark', this.prefersDark(settings.theme));
    document.documentElement.lang = settings.language === 'auto' ? this.detectedLanguage() : settings.language;
    const view = this.currentView();
    render(this.root, [
      el('header.app-bar', {}, [
        el('div.brand', {}, [
          el('span.logo', { text: '\u20ac' }),
          el('strong', { text: this.t('app.title') }),
        ]),
        el('nav.tabs', {}, TABS.map((tab) => el('button', {
          type: 'button',
          class: tab.id === this.ui.tab ? 'tab active' : 'tab',
          title: this.t(tab.key),
          on: { click: () => this.setTab(tab.id) },
        }, [el('span.tab-icon', { text: tab.icon }), el('span.tab-label', { text: this.t(tab.key) })]))),
      ]),
      this.ui.message ? el('p', { class: `toast ${this.ui.message.kind}`, text: this.ui.message.text }) : null,
      el('main.main', {}, view),
      el('footer.app-footer', {}, [
        el('span', { text: this.t('app.storedIn', { storage: this.storageKind }) }),
        el('span.app-version', { text: ` · v${APP_VERSION}` }),
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
