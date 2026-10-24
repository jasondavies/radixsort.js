// Draws sizes.json as light and dark PNG charts for the README, using headless
// Chrome (set CHROME to its path if it isn't in the default macOS location).
//
// Usage: node benchmark/chart.js

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { node, cpu, results } = JSON.parse(readFileSync(new URL('sizes.json', import.meta.url), 'utf8'));

const themes = {
  light: {
    surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
    current: '#2a78d6', previous: '#a8a7a0', native: '#52514e'
  },
  dark: {
    surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835',
    current: '#3987e5', previous: '#6e6d68', native: '#a8a7a0'
  }
};

const W = 1200, H = 675, pad = 56;
const plotX = pad + 56, plotRight = W - pad - 120, plotTop = 222, plotBottom = H - pad - 64;
const [xMin, xMax, yMin, yMax] = [100, 1e7, 2, 100];
const x = n => plotX + Math.log10(n / xMin) / Math.log10(xMax / xMin) * (plotRight - plotX);
const y = v => plotBottom - Math.log10(v / yMin) / Math.log10(yMax / yMin) * (plotBottom - plotTop);

function svg(c) {
  const series = [
    { key: 'native', label: 'Native sort' },
    { key: 'previous', label: '1.0.1' },
    { key: 'current', label: '2.0' }
  ];
  let s = '';
  for (const t of [2, 5, 10, 20, 50, 100]) {
    s += `<line x1="${plotX}" x2="${plotRight}" y1="${y(t)}" y2="${y(t)}" stroke="${t === yMin ? c.axis : c.grid}"/>`;
    s += `<text x="${plotX - 12}" y="${y(t) + 5}" text-anchor="end" fill="${c.muted}" font-size="15">${t}</text>`;
  }
  for (const [t, label] of [[100, '100'], [1e3, '1K'], [1e4, '10K'], [1e5, '100K'], [1e6, '1M'], [1e7, '10M']]) {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${plotTop}" y2="${plotBottom}" stroke="${t === xMin ? c.axis : c.grid}"/>`;
    s += `<text x="${x(t)}" y="${plotBottom + 26}" text-anchor="middle" fill="${c.muted}" font-size="15">${label}</text>`;
  }
  s += `<text x="${plotX - 12}" y="${plotTop - 18}" text-anchor="end" fill="${c.muted}" font-size="15">ns</text>`;
  // End labels are spread at least 22px apart, with a leader line to any
  // label moved away from its line's end.
  const last = results[results.length - 1];
  const labels = series.map(({ key }) => ({ key, y: y(last[key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 22);
  const labelY = Object.fromEntries(labels.map(l => [l.key, l.y]));
  // The current version is drawn last, so it sits on top.
  for (const { key, label } of series) {
    const points = results.map(r => `${x(r.n).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
    const emphasis = key === 'current', end = y(last[key]);
    s += `<polyline points="${points}" fill="none" stroke="${c[key]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (Math.abs(labelY[key] - end) > 2) {
      s += `<line x1="${x(last.n) + 6}" y1="${end}" x2="${x(last.n) + 12}" y2="${labelY[key]}" stroke="${c.muted}"/>`;
    }
    s += `<circle cx="${x(last.n)}" cy="${end}" r="5" fill="${c[key]}" stroke="${c.surface}" stroke-width="2"/>`;
    s += `<text x="${x(last.n) + 14}" y="${labelY[key] + 6}" fill="${emphasis ? c.ink : c.ink2}" font-size="16"`
        + ` font-weight="${emphasis ? 600 : 400}">${label}</text>`;
  }
  // Explain why the current version meets the native sort for small arrays,
  // pointing to where the two lines meet.
  const small = results.find(r => r.n === 200);
  s += `<line x1="${x(160)}" y1="${y(3.2) - 16}" x2="${x(small.n)}" y2="${y(small.current) + 6}" stroke="${c.muted}"/>`;
  s += `<text x="${x(130)}" y="${y(3.2)}" fill="${c.ink2}" font-size="14">Below 320 elements,</text>`;
  s += `<text x="${x(130)}" y="${y(3.2) + 18}" fill="${c.ink2}" font-size="14">2.0 uses the native sort</text>`;
  const legend = (lx, color, label) => `<rect x="${lx}" y="152" width="14" height="14" rx="3" fill="${color}"/>`
      + `<text x="${lx + 22}" y="164" fill="${c.ink2}" font-size="16">${label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    font-family='system-ui, -apple-system, "Segoe UI", sans-serif'>
<rect width="${W}" height="${H}" fill="${c.surface}"/>
<text x="${pad}" y="${pad + 34}" fill="${c.ink}" font-size="40" font-weight="650">radixsort.js 2.0: time per element</text>
<text x="${pad}" y="${pad + 70}" fill="${c.ink2}" font-size="20">Nanoseconds per element to sort random Float32Array values, by array size (lower is better)</text>
${legend(pad, c.current, '2.0')}${legend(pad + 72, c.previous, '1.0.1')}${legend(pad + 158, c.native, 'Native sort')}
${s}
<text x="${pad}" y="${H - pad + 6}" fill="${c.muted}" font-size="15">Node.js ${node.slice(1).split('.')[0]} · ${cpu.replace(/ \d+-Core Processor$/, '')} · best of 12 rounds · log scales</text>
<text x="${W - pad}" y="${H - pad + 6}" text-anchor="end" fill="${c.muted}" font-size="15">github.com/jasondavies/radixsort.js</text>
</svg>`;
}

const dir = mkdtempSync(join(tmpdir(), 'radixsort-chart-'));
for (const [name, colors] of Object.entries(themes)) {
  const html = join(dir, `${name}.html`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${svg(colors)}`);
  const png = fileURLToPath(new URL(`sizes-${name}.png`, import.meta.url));
  execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${W},${H}`, `--screenshot=${png}`, pathToFileURL(html).href], { stdio: 'ignore' });
  console.log(png);
}
