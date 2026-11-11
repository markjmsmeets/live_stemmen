'use strict';
// Gedeelde hulpfuncties voor student-, docent- en beamerweergave.
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}

async function api(path, body) {
  const r = await fetch(path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch (_) { /* leeg */ }
  return { ok: r.ok, status: r.status, data };
}

function connect(url, onState, onGone) {
  const es = new EventSource(url);
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('gone', () => { es.close(); onGone(); });
  return es;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* geen opslag */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* geen opslag */ } },
};

// Resultaten tekenen. opts: { correct, onRemove, big }
function renderResults(q, res, opts) {
  opts = opts || {};
  const box = h('div', { class: 'results' });
  if (!res) return box;
  if (q.type === 'choice') {
    const total = res.total || 0;
    q.options.forEach((o, i) => {
      const n = res.counts[i];
      const pct = total ? Math.round((n / total) * 100) : 0;
      const isCorrect = opts.correct === i;
      box.append(h('div', { class: 'bar-row' + (isCorrect ? ' correct' : '') },
        h('div', { class: 'bar-label' }, (isCorrect ? '✓ ' : '') + String.fromCharCode(65 + i) + '. ' + o),
        h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: 'width:' + pct + '%' })),
        h('div', { class: 'bar-num' }, n + ' (' + pct + '%)')));
    });
  } else if (q.type === 'scale') {
    const total = res.total || 0;
    const [lo, hi] = q.scaleLabels || ['', ''];
    res.counts.forEach((n, i) => {
      const pct = total ? Math.round((n / total) * 100) : 0;
      const label = (i + 1) + (i === 0 && lo ? ' · ' + lo : '') + (i === 4 && hi ? ' · ' + hi : '');
      box.append(h('div', { class: 'bar-row' },
        h('div', { class: 'bar-label' }, label),
        h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: 'width:' + pct + '%' })),
        h('div', { class: 'bar-num' }, n + ' (' + pct + '%)')));
    });
    box.append(h('div', { class: 'avg' }, total ? 'Gemiddelde: ' + res.avg.toFixed(1).replace('.', ',') : 'Nog geen antwoorden'));
  } else {
    const words = res.words || [];
    if (!words.length) { box.append(h('p', { class: 'muted' }, 'Nog geen antwoorden.')); return box; }
    const max = Math.max(...words.map((w) => w.count));
    const min = opts.big ? 28 : 16;
    const span = opts.big ? 70 : 40;
    const cloud = h('div', { class: 'cloud' });
    words.forEach((w) => {
      const size = min + span * (max > 1 ? (w.count - 1) / (max - 1) : 0.3);
      const label = w.text + (w.count > 1 ? ' ×' + w.count : '');
      const attrs = { class: 'w', style: 'font-size:' + size.toFixed(0) + 'px', title: w.count + '×' };
      cloud.append(opts.onRemove
        ? h('button', Object.assign(attrs, { title: 'Verwijderen', onclick: () => opts.onRemove(w.key) }), label)
        : h('span', attrs, label));
    });
    box.append(cloud);
  }
  return box;
}

function renderBoard(board, title) {
  const ol = h('ol', { class: 'board' });
  board.forEach((r) => ol.append(h('li', {}, h('span', { class: 'n' }, r.name), h('span', { class: 'p' }, r.score + ' pt'))));
  return h('div', {}, h('h3', {}, title || 'Ranglijst'), board.length ? ol : h('p', { class: 'muted' }, 'Nog geen scores.'));
}
