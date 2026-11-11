'use strict';
// Live stem-app (Sendsteps-achtig). Geen dependencies: alleen Node 18+.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || '';
const PUBLIC = path.join(__dirname, 'public');
const MAX_PARTICIPANTS = 1000;
const MAX_QUESTIONS = 60;
const SESSION_TTL = 8 * 3600 * 1000;

const sessions = new Map();

// ---------- helpers ----------
const rid = (n) => crypto.randomBytes(n).toString('hex');
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 200000) { reject(new Error('too big')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function sanitizeQuestions(input) {
  if (!Array.isArray(input) || !input.length) return null;
  const out = [];
  for (const q of input.slice(0, MAX_QUESTIONS)) {
    const type = ['choice', 'scale', 'open'].includes(q.type) ? q.type : null;
    const text = clip(q.text, 300);
    if (!type || !text) continue;
    const item = { type, text, options: [], correct: null, scaleLabels: ['', ''] };
    if (type === 'choice') {
      item.options = (Array.isArray(q.options) ? q.options : []).map((o) => clip(o, 120)).filter(Boolean).slice(0, 8);
      if (item.options.length < 2) continue;
      const c = Number.isInteger(q.correct) ? q.correct : null;
      item.correct = c !== null && c >= 0 && c < item.options.length ? c : null;
    }
    if (type === 'scale') {
      const l = Array.isArray(q.scaleLabels) ? q.scaleLabels : [];
      item.scaleLabels = [clip(l[0], 40), clip(l[1], 40)];
    }
    out.push(item);
  }
  return out.length ? out : null;
}

// ---------- sessies ----------
function newSession(questions) {
  let code;
  do { code = String(Math.floor(10000 + Math.random() * 90000)); } while (sessions.has(code));
  const s = {
    code,
    hostToken: rid(16),
    questions,
    hasQuiz: questions.some((q) => q.correct !== null),
    current: -1,
    phase: 'lobby', // lobby | open | revealed | ended
    openedAt: 0,
    showLive: false,
    showBoard: false,
    participants: new Map(),
    answers: [],
    hidden: [],
    clients: new Set(),
    timer: null,
    last: Date.now(),
  };
  sessions.set(code, s);
  return s;
}

function results(s, i) {
  const q = s.questions[i];
  const a = s.answers[i] || new Map();
  if (q.type === 'choice') {
    const counts = q.options.map(() => 0);
    a.forEach((x) => { counts[x.value]++; });
    return { counts, total: a.size };
  }
  if (q.type === 'scale') {
    const counts = [0, 0, 0, 0, 0];
    let sum = 0;
    a.forEach((x) => { counts[x.value - 1]++; sum += x.value; });
    return { counts, total: a.size, avg: a.size ? sum / a.size : 0 };
  }
  const hid = s.hidden[i] || new Set();
  const m = new Map();
  let n = 0;
  a.forEach((x) => x.entries.forEach((t) => {
    const k = t.toLowerCase();
    if (hid.has(k)) return;
    n++;
    const e = m.get(k) || { text: t, key: k, count: 0 };
    e.count++;
    m.set(k, e);
  }));
  return { words: [...m.values()].sort((x, y) => y.count - x.count).slice(0, 80), total: n };
}

function ranking(s) {
  return [...s.participants.entries()]
    .map(([id, p]) => ({ id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function view(s, c) {
  const q = s.questions[s.current] || null;
  const revealed = s.phase === 'revealed';
  const v = {
    code: s.code, phase: s.phase, current: s.current, total: s.questions.length,
    participants: s.participants.size, hasQuiz: s.hasQuiz, showLive: s.showLive, showBoard: s.showBoard,
  };
  if (c.role === 'host') v.titles = s.questions.map((x) => x.text);
  if (q && (s.phase === 'open' || revealed)) {
    v.question = {
      type: q.type, text: q.text, options: q.options, scaleLabels: q.scaleLabels, quiz: q.correct !== null,
    };
    if (q.correct !== null && (revealed || c.role === 'host')) v.question.correct = q.correct;
    const a = s.answers[s.current];
    v.answered = a ? a.size : 0;
    if (c.role === 'host' || revealed || s.showLive) v.results = results(s, s.current);
  }
  const rank = ranking(s);
  if (s.hasQuiz && (c.role === 'host' || s.showBoard || s.phase === 'ended')) {
    v.board = rank.slice(0, 10).map(({ name, score }) => ({ name, score }));
  }
  if (c.pid && s.participants.has(c.pid)) {
    const p = s.participants.get(c.pid);
    const rec = s.answers[s.current] && s.answers[s.current].get(c.pid);
    const me = { name: p.name, score: p.score, rank: rank.findIndex((r) => r.id === c.pid) + 1, answer: null };
    if (rec) me.answer = rec.entries ? rec.entries : rec.value;
    if (rec && q && q.correct !== null && revealed) {
      me.points = rec.points || 0;
      me.correct = rec.value === q.correct;
    }
    v.me = me;
  }
  return v;
}

function push(c, s) {
  c.res.write('event: state\ndata: ' + JSON.stringify(view(s, c)) + '\n\n');
}

function broadcast(s) {
  s.last = Date.now();
  if (s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    s.clients.forEach((c) => { try { push(c, s); } catch (_) { /* gesloten */ } });
  }, 120);
}

function openQuestion(s, i) {
  s.current = i;
  s.phase = 'open';
  s.openedAt = Date.now();
  s.showLive = s.questions[i].correct === null;
  s.showBoard = false;
}

function hostAction(s, body) {
  switch (body.action) {
    case 'next':
      if (s.current + 1 < s.questions.length) openQuestion(s, s.current + 1);
      else { s.phase = 'ended'; }
      break;
    case 'goto': {
      const i = body.index | 0;
      if (i >= 0 && i < s.questions.length) openQuestion(s, i);
      break;
    }
    case 'reveal': if (s.phase === 'open') s.phase = 'revealed'; break;
    case 'reopen': if (s.phase === 'revealed') { s.phase = 'open'; s.openedAt = Date.now(); } break;
    case 'toggleLive': s.showLive = !s.showLive; break;
    case 'toggleBoard': s.showBoard = !s.showBoard; break;
    case 'end': s.phase = 'ended'; break;
    case 'remove': {
      const k = clip(body.word, 40).toLowerCase();
      if (s.current >= 0 && k) (s.hidden[s.current] = s.hidden[s.current] || new Set()).add(k);
      break;
    }
    default: return false;
  }
  return true;
}

function handleAnswer(s, pid, value) {
  const p = s.participants.get(pid);
  if (!p) return [404, 'unknown_participant'];
  if (s.phase !== 'open') return [409, 'closed'];
  const q = s.questions[s.current];
  const map = s.answers[s.current] || (s.answers[s.current] = new Map());
  if (q.type === 'choice') {
    const v = Number.isInteger(value) ? value : -1;
    if (v < 0 || v >= q.options.length) return [400, 'bad_value'];
    if (q.correct !== null && map.has(pid)) return [409, 'already_answered'];
    const rec = map.get(pid) || {};
    rec.value = v;
    if (q.correct !== null) {
      const elapsed = Date.now() - s.openedAt;
      rec.points = v === q.correct ? Math.round(1000 - 500 * Math.min(1, elapsed / 30000)) : 0;
      p.score += rec.points;
    }
    map.set(pid, rec);
  } else if (q.type === 'scale') {
    const v = Number.isInteger(value) ? value : 0;
    if (v < 1 || v > 5) return [400, 'bad_value'];
    map.set(pid, { value: v });
  } else {
    const t = clip(value, 40);
    if (!t) return [400, 'bad_value'];
    const rec = map.get(pid) || { entries: [] };
    if (rec.entries.length >= 3) return [409, 'limit'];
    rec.entries.push(t);
    map.set(pid, rec);
  }
  return [200, null];
}

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // spreadsheet-injectie voorkomen
  return '"' + s.replace(/"/g, '""') + '"';
}

function exportCsv(s) {
  const rows = [['Vraag nr', 'Vraag', 'Deelnemer', 'Antwoord', 'Punten']];
  s.questions.forEach((q, i) => {
    const a = s.answers[i];
    if (!a) return;
    a.forEach((rec, pid) => {
      const p = s.participants.get(pid);
      let ans;
      if (q.type === 'choice') ans = q.options[rec.value];
      else if (q.type === 'scale') ans = rec.value;
      else ans = rec.entries.join(' | ');
      rows.push([i + 1, q.text, p ? p.name : '?', ans, rec.points != null ? rec.points : '']);
    });
  });
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
};

function serveStatic(req, res, pathname) {
  const alias = { '/': '/index.html', '/host': '/host.html', '/screen': '/screen.html' };
  const rel = alias[pathname] || pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Niet gevonden'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/config') return json(res, 200, { needsPassword: !!HOST_PASSWORD });

    if (p === '/api/session' && req.method === 'POST') {
      const body = await readBody(req);
      if (HOST_PASSWORD && !safeEq(body.password || '', HOST_PASSWORD)) return json(res, 401, { error: 'wrong_password' });
      const qs = sanitizeQuestions(body.questions);
      if (!qs) return json(res, 400, { error: 'no_valid_questions' });
      const s = newSession(qs);
      return json(res, 200, { code: s.code, token: s.hostToken });
    }

    const m = p.match(/^\/api\/s\/(\d{5})\/(\w+)$/);
    if (m) {
      const s = sessions.get(m[1]);
      const what = m[2];

      if (what === 'events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
        });
        if (!s) { res.write('event: gone\ndata: {}\n\n'); return res.end(); }
        const c = { res, role: 'screen', pid: null };
        const token = url.searchParams.get('token');
        const pid = url.searchParams.get('pid');
        if (token && safeEq(token, s.hostToken)) c.role = 'host';
        else if (pid && s.participants.has(pid)) { c.role = 'student'; c.pid = pid; }
        else if (token || pid) { res.write('event: gone\ndata: {}\n\n'); return res.end(); }
        s.clients.add(c);
        push(c, s);
        req.on('close', () => { s.clients.delete(c); });
        return;
      }

      if (!s) return json(res, 404, { error: 'no_session' });

      if (what === 'join' && req.method === 'POST') {
        const body = await readBody(req);
        const name = clip(body.name, 30);
        if (s.hasQuiz && !name) return json(res, 400, { error: 'name_required' });
        if (body.pid && s.participants.has(body.pid)) {
          if (name) s.participants.get(body.pid).name = name;
          broadcast(s);
          return json(res, 200, { pid: body.pid });
        }
        if (s.participants.size >= MAX_PARTICIPANTS) return json(res, 429, { error: 'full' });
        const pid = rid(8);
        s.participants.set(pid, { name: name || 'Anoniem', score: 0 });
        broadcast(s);
        return json(res, 200, { pid });
      }

      if (what === 'answer' && req.method === 'POST') {
        const body = await readBody(req);
        const [status, error] = handleAnswer(s, String(body.pid || ''), body.value);
        if (status === 200) broadcast(s);
        return json(res, status, error ? { error } : { ok: true });
      }

      if (what === 'host' && req.method === 'POST') {
        const body = await readBody(req);
        if (!safeEq(body.token || '', s.hostToken)) return json(res, 401, { error: 'unauthorized' });
        if (!hostAction(s, body)) return json(res, 400, { error: 'bad_action' });
        broadcast(s);
        return json(res, 200, { ok: true });
      }

      if (what === 'export') {
        if (!safeEq(url.searchParams.get('token') || '', s.hostToken)) return json(res, 401, { error: 'unauthorized' });
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="resultaten-${s.code}.csv"`,
        });
        return res.end(exportCsv(s));
      }
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: 'bad_request' });
  }
});

setInterval(() => {
  const now = Date.now();
  sessions.forEach((s, code) => {
    s.clients.forEach((c) => { try { c.res.write(': hb\n\n'); } catch (_) { /* weg */ } });
    if (now - s.last > SESSION_TTL) {
      s.clients.forEach((c) => { try { c.res.write('event: gone\ndata: {}\n\n'); c.res.end(); } catch (_) { /* weg */ } });
      sessions.delete(code);
    }
  });
}, 15000).unref();

server.listen(PORT, () => console.log(`Stem-app draait op http://localhost:${PORT}  (docent: /host)`));
