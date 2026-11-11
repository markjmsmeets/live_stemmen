'use strict';
// Simulatie: 40 studenten doorlopen alle vraagtypes. Gebruik: node test/sim.js [baseUrl]
const base = process.argv[2] || 'http://localhost:3000';
const assert = require('assert');
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, data: await r.json() }; };

async function latestState(code, qs) {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/api/s/${code}/events?${qs}`, { signal: ctrl.signal });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value } = await reader.read();
    buf += dec.decode(value);
    const m = buf.match(/event: state\ndata: (.*)\n\n/);
    if (m) { ctrl.abort(); return JSON.parse(m[1]); }
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const questions = [
    { type: 'choice', text: 'Quiz?', options: ['A', 'B', 'C'], correct: 1 },
    { type: 'scale', text: 'Zeker?', scaleLabels: ['nee', 'ja'] },
    { type: 'open', text: 'Woord?' },
    { type: 'choice', text: 'Peiling', options: ['x', 'y'] },
  ];
  const s = await post('/api/session', { questions });
  assert.equal(s.status, 200);
  const { code, token } = s.data;
  const host = (action, extra) => post(`/api/s/${code}/host`, { token, action, ...extra });

  assert.equal((await post(`/api/s/${code}/join`, { name: '' })).status, 400, 'naam verplicht bij quiz');
  const pids = [];
  for (let i = 0; i < 40; i++) pids.push((await post(`/api/s/${code}/join`, { name: 'Student ' + i })).data.pid);
  assert.equal((await post(`/api/s/${code}/answer`, { pid: pids[0], value: 1 })).status, 409, 'niet stemmen in lobby');
  assert.equal((await post(`/api/s/${code}/host`, { token: 'fout', action: 'next' })).status, 401);

  // Q1 quiz
  await host('next');
  for (let i = 0; i < 40; i++) {
    const r = await post(`/api/s/${code}/answer`, { pid: pids[i], value: i < 25 ? 1 : 0 });
    assert.equal(r.status, 200);
  }
  assert.equal((await post(`/api/s/${code}/answer`, { pid: pids[0], value: 2 })).status, 409, 'quiz niet wijzigen');
  await wait(300);
  let st = await latestState(code, 'pid=' + pids[0]);
  assert.equal(st.question.correct, undefined, 'goed antwoord niet lekken');
  assert.equal(st.results, undefined, 'quiz: geen live resultaten voor studenten');
  assert.equal(st.me.points, undefined);
  await host('reveal');
  await wait(300);
  st = await latestState(code, 'pid=' + pids[0]);
  assert.equal(st.question.correct, 1);
  assert.deepEqual(st.results.counts, [15, 25, 0]);
  assert.ok(st.me.correct && st.me.points >= 500);
  const stLoser = await latestState(code, 'pid=' + pids[39]);
  assert.equal(stLoser.me.correct, false);
  assert.equal(stLoser.me.points, 0);
  const hostSt = await latestState(code, 'token=' + token);
  assert.equal(hostSt.board.length, 10);
  console.log('quiz ok, top:', hostSt.board[0]);

  // Q2 schaal
  await host('next');
  for (let i = 0; i < 40; i++) await post(`/api/s/${code}/answer`, { pid: pids[i], value: (i % 5) + 1 });
  assert.equal((await post(`/api/s/${code}/answer`, { pid: pids[0], value: 9 })).status, 400);
  await post(`/api/s/${code}/answer`, { pid: pids[0], value: 5 }); // wijzigen mag
  await wait(300);
  st = await latestState(code, 'pid=' + pids[1]);
  assert.ok(st.results, 'peiling: live resultaten zichtbaar');
  assert.equal(st.results.total, 40);
  assert.equal(st.results.counts.reduce((a, b) => a + b), 40);
  console.log('schaal ok, gemiddelde', st.results.avg.toFixed(2));

  // Q3 open
  await host('next');
  const words = ['zorg', 'Zorg ', 'empathie', 'zorg', 'vakmanschap', 'zorg'];
  for (let i = 0; i < 6; i++) await post(`/api/s/${code}/answer`, { pid: pids[i], value: words[i] });
  for (let i = 0; i < 3; i++) await post(`/api/s/${code}/answer`, { pid: pids[10], value: 'w' + i });
  assert.equal((await post(`/api/s/${code}/answer`, { pid: pids[10], value: 'vier' })).status, 409, 'max 3');
  await wait(300);
  st = await latestState(code, 'token=' + token);
  assert.equal(st.results.words[0].count, 4, 'zorg x4 samengevoegd');
  await host('remove', { word: 'zorg' });
  await wait(300);
  st = await latestState(code, 'token=' + token);
  assert.ok(!st.results.words.some((w) => w.key === 'zorg'), 'woord verwijderd');
  console.log('open ok');

  // Q4 peiling, daarna einde
  await host('next');
  await post(`/api/s/${code}/answer`, { pid: pids[3], value: 0 });
  await host('next');
  st = await latestState(code, 'pid=' + pids[0]);
  assert.equal(st.phase, 'ended');
  assert.ok(st.board, 'eindstand zichtbaar');

  // export
  const csv = await (await fetch(`${base}/api/s/${code}/export?token=${token}`)).text();
  assert.ok(csv.split('\r\n').length > 80);
  assert.equal((await fetch(`${base}/api/s/${code}/export?token=nope`)).status, 401);
  // onbekende sessie en pad-traversal
  assert.equal((await fetch(`${base}/..%2f..%2fetc/passwd`)).status === 200, false);
  console.log('ALLES OK');
})().catch((e) => { console.error('FOUT:', e); process.exit(1); });
