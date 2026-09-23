/** SVG chart builders. They return markup strings, so they can be tested without a DOM. */

const NS = 'http://www.w3.org/2000/svg';

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/**
 * Grouped bar chart of expenses and income per period.
 * @param {Array<{label: string, fullLabel?: string, expense: number, income: number}>} data
 * @param {{width?: number, height?: number, formatValue?: (value: number) => string, showIncome?: boolean,
 *          average?: number|null, averageLabel?: string}} [options]
 */
export function barChart(data, options = {}) {
  const width = options.width || 640;
  const height = options.height || 220;
  const padding = { top: 12, right: 8, bottom: 26, left: 8 };
  const showIncome = options.showIncome !== false && data.some((point) => point.income > 0);
  const format = options.formatValue || String;
  const plotHeight = height - padding.top - padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const average = Number.isFinite(options.average) && options.average > 0 ? options.average : null;
  const max = Math.max(1, ...data.map((point) => Math.max(point.expense, showIncome ? point.income : 0)),
    average || 0);
  const slot = plotWidth / Math.max(1, data.length);
  const barWidth = Math.max(4, Math.min(28, slot * (showIncome ? 0.3 : 0.55)));

  const parts = [`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart">`];
  for (let line = 0; line <= 2; line += 1) {
    const y = padding.top + (plotHeight / 2) * line;
    parts.push(`<line class="grid" x1="0" y1="${round(y)}" x2="${width}" y2="${round(y)}"/>`);
  }
  if (options.showScale !== false) {
    parts.push(`<text class="chart-scale" x="2" y="${padding.top - 2}">${escapeXml(format(max))}</text>`);
  }
  data.forEach((point, index) => {
    const centre = padding.left + slot * (index + 0.5);
    const bars = showIncome
      ? [{ value: point.expense, cls: 'bar-expense', offset: -barWidth * 0.55 },
        { value: point.income, cls: 'bar-income', offset: barWidth * 0.55 }]
      : [{ value: point.expense, cls: 'bar-expense', offset: 0 }];
    for (const bar of bars) {
      const barHeight = max ? (bar.value / max) * plotHeight : 0;
      const x = centre + bar.offset - barWidth / 2;
      const y = padding.top + plotHeight - barHeight;
      parts.push(`<rect class="${bar.cls}" x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" `
        + `height="${round(Math.max(barHeight, bar.value > 0 ? 2 : 0))}" rx="3">`
        + `<title>${escapeXml(point.fullLabel || point.label)}: ${escapeXml(format(bar.value))}</title></rect>`);
    }
    parts.push(`<text class="chart-label" x="${round(centre)}" y="${height - 8}" text-anchor="middle">`
      + `${escapeXml(point.label)}</text>`);
  });
  if (average !== null) {
    const y = padding.top + plotHeight - (average / max) * plotHeight;
    parts.push(`<line class="average-line" x1="0" y1="${round(y)}" x2="${width}" y2="${round(y)}"/>`);
    const label = options.averageLabel || `avg ${format(average)}`;
    parts.push(`<text class="average-label" x="${width - 4}" y="${round(Math.max(y - 7, 10))}" text-anchor="end">`
      + `${escapeXml(label)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/**
 * Donut chart of category shares.
 * @param {Array<{name: string, amount: number, color: string, share: number}>} slices
 */
export function donutChart(slices, options = {}) {
  const size = options.size || 200;
  const radius = size / 2;
  const inner = radius * 0.62;
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);
  if (!total) {
    return `<svg class="chart donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="No data">`
      + `<circle cx="${radius}" cy="${radius}" r="${round(radius - 1)}" class="donut-empty"/></svg>`;
  }
  const parts = [`<svg class="chart donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending by category">`];
  let angle = -Math.PI / 2;
  for (const slice of slices) {
    const sweep = (slice.amount / total) * Math.PI * 2;
    const end = angle + sweep;
    parts.push(`<path d="${arcPath(radius, radius, radius - 1, inner, angle, end)}" fill="${escapeXml(slice.color)}">`
      + `<title>${escapeXml(slice.name)}: ${slice.share}%</title></path>`);
    angle = end;
  }
  parts.push('</svg>');
  return parts.join('');
}

function arcPath(cx, cy, outer, inner, from, to) {
  const large = to - from > Math.PI ? 1 : 0;
  const sweep = Math.min(to - from, Math.PI * 2 - 1e-6);
  const end = from + sweep;
  const p1 = point(cx, cy, outer, from);
  const p2 = point(cx, cy, outer, end);
  const p3 = point(cx, cy, inner, end);
  const p4 = point(cx, cy, inner, from);
  return `M ${p1} A ${round(outer)} ${round(outer)} 0 ${large} 1 ${p2} L ${p3} `
    + `A ${round(inner)} ${round(inner)} 0 ${large} 0 ${p4} Z`;
}

function point(cx, cy, radius, angle) {
  return `${round(cx + radius * Math.cos(angle))} ${round(cy + radius * Math.sin(angle))}`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * A QR symbol as SVG: one path for every dark module, so the whole code is a
 * single element and scales to any size without a picture file.
 * @param {boolean[][]} modules from encodeQr
 */
export function qrSvg(modules, { quiet = 3, title = '' } = {}) {
  const size = modules.length;
  const side = size + quiet * 2;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (modules[row][column]) path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return `<svg viewBox="0 0 ${side} ${side}" class="qr" role="img" aria-label="${escapeXml(title)}" `
    + 'xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">'
    + `<rect width="${side}" height="${side}" fill="#ffffff"/>`
    + `<path d="${path}" fill="#171a21"/></svg>`;
}
