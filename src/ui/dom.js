/** Tiny DOM helpers - the app builds its interface with plain JavaScript. */

import { formatDate, parseDateLoose } from '../core/format.js';

/**
 * Creates an element.
 * @param {string} tag tag name, optionally with classes: "div.card.wide"
 * @param {object|null} [props] attributes; `class`, `text`, `html`, `on` and `data` are special
 * @param {Array|Node|string} [children]
 */
export function el(tag, props = null, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = [node.className, value].filter(Boolean).join(' ');
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'on') for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
      else if (key === 'data') for (const [attribute, item] of Object.entries(value)) node.dataset[attribute] = item;
      else if (key in node && key !== 'list' && key !== 'form') node[key] = value;
      else node.setAttribute(key, value);
    }
  }
  append(node, children);
  return node;
}

/** Appends strings, nodes and nested arrays; null and false are skipped. */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

/** Replaces the children of a node. */
export function render(node, children) {
  append(clear(node), children);
  return node;
}

export function byId(id) {
  return document.getElementById(id);
}

/**
 * A labelled form field: always the same three parts in the same order - label,
 * control, hint - even when there is no hint. That fixed shape is what lets a
 * row of fields line up its controls no matter how long one label runs; the
 * stylesheet puts every field in a row on the same three rows.
 */
export function field(labelText, control, hint) {
  return el('label.field', {}, [
    el('span.field-label', { text: labelText }),
    control,
    el('span.field-hint', { text: hint || '' }),
  ]);
}

/**
 * A row action - Edit, Delete - that survives a phone screen.
 *
 * The word is what a mouse user wants; on a narrow screen two words per row push
 * the table off the edge, so the button carries both and the stylesheet shows
 * whichever fits. The word is still the accessible name either way.
 *
 * @param {{icon: string, label: string, danger?: boolean, onClick: () => void,
 *          extraClass?: string}} options
 */
export function actionButton({ icon, label, danger = false, onClick, extraClass = '' }) {
  return el(danger ? 'button.link.danger' : 'button.link', {
    class: extraClass,
    type: 'button', title: label, 'aria-label': label, on: { click: onClick },
  }, [
    el('span.action-icon', { text: icon, 'aria-hidden': 'true' }),
    el('span.action-text', { text: label }),
  ]);
}

/**
 * A cell in a row of fields that has no label of its own - a pair of buttons, a
 * submit. The empty label keeps it on the same rows as the fields beside it, so
 * nothing has to guess a margin when a label next to it wraps to two lines.
 */
export function fieldSlot(control) {
  return el('div.field', {}, [
    el('span.field-label', { 'aria-hidden': 'true' }),
    control,
    el('span.field-hint'),
  ]);
}

/** An <option> list for a <select>. */
export function options(items, selected) {
  return items.map((item) => el('option', {
    value: item.value,
    text: item.label,
    selected: String(item.value) === String(selected),
  }));
}

/**
 * A date field that shows the date the way the rest of the app does (23.09.2026).
 *
 * `<input type="date">` looks tempting, but the format it displays comes from the
 * browser's language setting alone - not from the page, not from the `lang`
 * attribute and not from the chosen interface language - so a browser set to
 * American English shows 09/23/2026 in an otherwise Russian or German app. This
 * field types and shows the date in the app's own format, and the button still
 * opens the browser's native calendar, which is what makes it usable on a phone.
 *
 * @param {{value: string, onChange: (iso: string) => void, t: (key: string) => string,
 *          required?: boolean, clearable?: boolean}} options
 */
export function dateField({ value, onChange, t, required = false, clearable = false }) {
  const text = el('input.date-text', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: false,
    placeholder: t('common.datePlaceholder'), value: value ? formatDate(value) : '',
    required, 'aria-label': t('common.date'),
  });
  const native = el('input.date-native', { type: 'date', value: value || '', tabindex: '-1', 'aria-hidden': 'true' });
  const button = el('button.date-button', {
    type: 'button', text: '📅', title: t('common.pickDate'), 'aria-label': t('common.pickDate'),
  });

  const apply = (iso) => {
    text.value = iso ? formatDate(iso) : '';
    text.classList.remove('invalid');
    native.value = iso || '';
    onChange(iso);
  };

  text.addEventListener('change', () => {
    const typed = text.value.trim();
    if (!typed) {
      if (clearable || !required) apply('');
      else text.classList.add('invalid');
      return;
    }
    const iso = parseDateLoose(typed);
    if (iso) apply(iso);
    else text.classList.add('invalid'); // keep what was typed so it can be corrected
  });
  text.addEventListener('input', () => text.classList.remove('invalid'));
  native.addEventListener('change', () => apply(native.value));
  button.addEventListener('click', () => {
    // showPicker is the supported way to open the calendar; older browsers focus instead.
    if (typeof native.showPicker === 'function') {
      try {
        native.showPicker();
        return;
      } catch {
        // not allowed in this context, fall through
      }
    }
    native.focus();
    native.click();
  });

  const wrap = el('div.date-input', {}, [text, button, native]);
  // `.value` reads what is typed right now, so a form can be submitted without
  // leaving the field first; it is the ISO date, or '' when the text is not one.
  Object.defineProperty(wrap, 'value', {
    get: () => (text.value.trim() ? parseDateLoose(text.value.trim()) || '' : ''),
  });
  wrap.dateText = text;
  return wrap;
}
