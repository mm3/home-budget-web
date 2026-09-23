/** RFC 4180 style CSV reader and writer with delimiter detection. */

const DELIMITERS = [',', ';', '\t', '|'];

/** Guesses the delimiter from the first lines by counting candidates outside quotes. */
export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  let best = ',';
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < sample.length; index += 1) {
      const char = sample[index];
      if (char === '"') inQuotes = !inQuotes;
      else if (!inQuotes && char === delimiter) count += 1;
    }
    if (count > bestScore) {
      bestScore = count;
      best = delimiter;
    }
  }
  return bestScore > 0 ? best : ',';
}

/**
 * Parses CSV text into rows of strings.
 * @param {string} text
 * @param {{delimiter?: string}} [options]
 * @returns {{rows: string[][], delimiter: string}}
 */
export function parseCsv(text, options = {}) {
  const clean = text.replace(/^﻿/, '');
  const delimiter = options.delimiter || detectDelimiter(clean);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (inQuotes) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.filter((cells) => cells.some((cell) => cell !== '')), delimiter };
}

/**
 * Serializes rows to CSV.
 * @param {Array<Array<string|number>>} rows
 * @param {{delimiter?: string, bom?: boolean, newline?: string}} [options]
 */
export function toCsv(rows, options = {}) {
  const delimiter = options.delimiter || ',';
  const newline = options.newline || '\r\n';
  const body = rows.map((row) => row.map((cell) => {
    const text = cell === null || cell === undefined ? '' : String(cell);
    return /["\n\r]|^\s|\s$/.test(text) || text.includes(delimiter)
      ? `"${text.replace(/"/g, '""')}"`
      : text;
  }).join(delimiter)).join(newline);
  return (options.bom === false ? '' : '﻿') + body + newline;
}
