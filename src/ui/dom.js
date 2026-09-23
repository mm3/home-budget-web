/** Tiny DOM helpers - the app builds its interface with plain JavaScript. */

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

/** A labelled form field. */
export function field(labelText, control, hint) {
  // has-hint lets a row of fields reserve room for the hint underneath, so the
  // hint neither grows the field nor overlaps the one next to it.
  return el(hint ? 'label.field.has-hint' : 'label.field', {},
    [el('span.field-label', { text: labelText }), control,
      hint ? el('span.field-hint', { text: hint }) : null]);
}

/** An <option> list for a <select>. */
export function options(items, selected) {
  return items.map((item) => el('option', {
    value: item.value,
    text: item.label,
    selected: String(item.value) === String(selected),
  }));
}
