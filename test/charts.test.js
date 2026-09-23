import test from 'node:test';
import assert from 'node:assert/strict';
import { barChart, donutChart } from '../src/core/charts.js';

const points = [
  { label: 'Jul', fullLabel: 'July 2026', expense: 0, income: 0 },
  { label: 'Aug', fullLabel: 'August 2026', expense: 3000, income: 0 },
  { label: 'Sep <b>', fullLabel: 'September 2026', expense: 4200, income: 200000 },
];

test('barChart draws one label and bars per point', () => {
  const svg = barChart(points, { formatValue: (value) => `${value} c` });
  assert.match(svg, /chart-scale/, 'the scale maximum is written out');
  assert.ok(!barChart(points, { showScale: false }).includes('chart-scale'));
  assert.match(svg, /^<svg class="chart"/);
  assert.equal((svg.match(/chart-label/g) || []).length, 3);
  assert.equal((svg.match(/class="bar-expense"/g) || []).length, 3);
  assert.equal((svg.match(/class="bar-income"/g) || []).length, 3);
  assert.match(svg, /September 2026: 200000 c/);
  assert.match(svg, /Sep &lt;b&gt;/, 'labels are escaped');
  assert.ok(!svg.includes('NaN'));
});

test('barChart hides income bars when there is no income', () => {
  const svg = barChart(points.map((point) => ({ ...point, income: 0 })));
  assert.equal((svg.match(/class="bar-income"/g) || []).length, 0);
  assert.equal((svg.match(/class="bar-expense"/g) || []).length, 3);
  assert.ok(barChart([]).includes('</svg>'));
  assert.ok(barChart(points, { showIncome: false, width: 300, height: 100 }).includes('viewBox="0 0 300 100"'));
});

test('the average line is drawn on request', () => {
  const withAverage = barChart(points, { average: 2000, averageLabel: 'avg 20.00' });
  assert.match(withAverage, /average-line/);
  assert.match(withAverage, /avg 20\.00/);
  assert.ok(!barChart(points).includes('average-line'), 'no line without an average');
  assert.ok(!barChart(points, { average: 0 }).includes('average-line'));
  assert.ok(!barChart(points, { average: Number.NaN }).includes('average-line'));
  const huge = barChart([{ label: 'a', expense: 10, income: 0 }], { average: 1000, showScale: true });
  assert.match(huge, /average-line/, 'the scale grows to fit the average');
  assert.ok(!huge.includes('NaN'));
});

test('donutChart draws one path per slice', () => {
  const svg = donutChart([
    { name: 'Food', amount: 70, color: '#ea580c', share: 70 },
    { name: 'Daily', amount: 30, color: '#4f46e5', share: 30 },
  ]);
  assert.equal((svg.match(/<path/g) || []).length, 2);
  assert.match(svg, /Food: 70%/);
  assert.ok(!svg.includes('NaN'));
});

test('donutChart shows an empty ring without data', () => {
  const svg = donutChart([], { size: 120 });
  assert.match(svg, /donut-empty/);
  assert.match(svg, /viewBox="0 0 120 120"/);
  const single = donutChart([{ name: 'All', amount: 5, color: '#000000', share: 100 }]);
  assert.equal((single.match(/<path/g) || []).length, 1);
});
