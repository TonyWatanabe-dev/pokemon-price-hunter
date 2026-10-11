// Cobertura direta de dois módulos sem teste próprio:
//  A) src/db/partitions.js — partição mensal de price_history. Sem banco: um cliente falso só registra o SQL.
//  B) api/ml-callback.mjs — volta do OAuth do Mercado Livre. Só mostra o código; valores de ambiente sintéticos,
//     fetch falso e console capturado para provar que nada sai da página nem vai para log.
import assert from 'node:assert/strict';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

// ------------------------------------------------------------------ A) partições
const PART = new URL('../src/db/partitions.js', import.meta.url).href;
let inst = 0; // cada instância nova do módulo tem o cache (Set) vazio
const fresh = async () => (await import(`${PART}?i=${++inst}`)).ensureMonth;
const fakeClient = (exists = false) => {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); return { rows: [{ t: /to_regclass/.test(sql) && exists ? 'hunter.x' : null }] }; } };
};
const createOf = (c) => c.calls.find((q) => /^CREATE TABLE/.test(q.sql));
const expectMonth = async (input, name, from, to) => {
  const ensureMonth = await fresh(); const c = fakeClient();
  await ensureMonth(c, input);
  assert.equal(c.calls.length, 2, `${input}: verifica e cria`);
  assert.equal(c.calls[0].sql, 'SELECT to_regclass($1) AS t');
  assert.deepEqual(c.calls[0].params, [`hunter.${name}`], `${input}: nome consultado por parâmetro`);
  assert.equal(createOf(c).sql, `CREATE TABLE IF NOT EXISTS hunter.${name} PARTITION OF hunter.price_history FOR VALUES FROM ('${from}') TO ('${to}')`);
  assert.equal(createOf(c).params, undefined, 'CREATE sem parâmetros (só dígitos derivados da data)');
};

await t('A1. mês comum: nome price_history_AAAA_MM e intervalo [dia 1, dia 1 do mês seguinte)', async () => {
  await expectMonth('2026-03-15T10:00:00Z', 'price_history_2026_03', '2026-03-01', '2026-04-01');
  await expectMonth('2026-10-01T00:00:00Z', 'price_history_2026_10', '2026-10-01', '2026-11-01'); // formato usado por sync.js
});
await t('A2. virada de ano: dezembro termina em 1º de janeiro do ano seguinte', async () => {
  await expectMonth('2026-12-31T23:59:59.999Z', 'price_history_2026_12', '2026-12-01', '2027-01-01');
  await expectMonth('2027-01-01T00:00:00.000Z', 'price_history_2027_01', '2027-01-01', '2027-02-01');
});
await t('A3. limites do mês: último milissegundo fica no mês, o seguinte já é o próximo; fevereiro bissexto', async () => {
  await expectMonth('2026-01-31T23:59:59.999Z', 'price_history_2026_01', '2026-01-01', '2026-02-01');
  await expectMonth('2026-02-01T00:00:00.000Z', 'price_history_2026_02', '2026-02-01', '2026-03-01');
  await expectMonth('2028-02-29T12:00:00Z', 'price_history_2028_02', '2028-02-01', '2028-03-01');
});
await t('A4. fuso: decide sempre em UTC (nome e intervalo coerentes), não no fuso local', async () => {
  // 31/12 23:30 em Brasília = 01/01 02:30 UTC → janeiro
  await expectMonth('2025-12-31T23:30:00-03:00', 'price_history_2026_01', '2026-01-01', '2026-02-01');
  // 01/02 01:00 em +03:00 = 31/01 22:00 UTC → janeiro
  await expectMonth('2026-02-01T01:00:00+03:00', 'price_history_2026_01', '2026-01-01', '2026-02-01');
});
await t('A5. aceita Date e milissegundos além de texto', async () => {
  await expectMonth(new Date(Date.UTC(2026, 5, 30, 23, 0)), 'price_history_2026_06', '2026-06-01', '2026-07-01');
  await expectMonth(Date.UTC(2026, 6, 1), 'price_history_2026_07', '2026-07-01', '2026-08-01');
});
await t('A6. partição já existente: só consulta, não cria', async () => {
  const ensureMonth = await fresh(); const c = fakeClient(true);
  await ensureMonth(c, '2026-04-10T00:00:00Z');
  assert.equal(c.calls.length, 1); assert.equal(createOf(c), undefined);
});
await t('A7. cache por mês no processo: segunda chamada do mesmo mês não toca no banco; outro mês consulta de novo', async () => {
  const ensureMonth = await fresh(); const c = fakeClient();
  await ensureMonth(c, '2026-05-01T00:00:00Z'); await ensureMonth(c, '2026-05-31T23:59:59Z');
  assert.equal(c.calls.length, 2, 'maio: uma verificação + uma criação só');
  await ensureMonth(c, '2026-06-01T00:00:00Z');
  assert.equal(c.calls.length, 4, 'junho consulta e cria');
});
await t('A8. falha do banco propaga e não marca o mês como pronto (próxima chamada tenta de novo)', async () => {
  const ensureMonth = await fresh(); let fail = true; const calls = [];
  const c = { async query(sql) { calls.push(sql); if (fail && /^CREATE/.test(sql)) throw new Error('falha simulada'); return { rows: [{ t: null }] }; } };
  await assert.rejects(ensureMonth(c, '2026-08-01T00:00:00Z'), /falha simulada/);
  fail = false; await ensureMonth(c, '2026-08-01T00:00:00Z');
  assert.equal(calls.length, 4, 'refez verificação e criação');
});
await t('A9. data inválida é recusada antes de qualquer SQL', async () => {
  const ensureMonth = await fresh(); const c = fakeClient();
  for (const bad of ['lixo', '2026-13-01T00:00:00Z', NaN]) await assert.rejects(ensureMonth(c, bad), RangeError, String(bad));
  assert.equal(c.calls.length, 0);
});
await t('A10. SQL gerado só contém identificador e datas canônicas (sem espaço para injeção)', async () => {
  const ensureMonth = await fresh(); const c = fakeClient();
  await assert.rejects(ensureMonth(c, "2026-09-09T00:00:00Z'); DROP TABLE x; --"), RangeError);
  assert.equal(c.calls.length, 0, 'texto com injeção nem vira data válida');
  await ensureMonth(c, '2026-09-09T00:00:00Z');
  assert.match(createOf(c).sql, /^CREATE TABLE IF NOT EXISTS hunter\.price_history_\d{4}_\d{2} PARTITION OF hunter\.price_history FOR VALUES FROM \('\d{4}-\d{2}-01'\) TO \('\d{4}-\d{2}-01'\)$/);
});

// ------------------------------------------------------------------ B) callback OAuth do Mercado Livre
// Valores SINTÉTICOS: se o handler lesse ambiente e vazasse algo, estes marcadores apareceriam na resposta/log.
const FAKE_ENV = { ML_CLIENT_ID: 'fake-client-id-000', ML_CLIENT_SECRET: 'fake-secret-SINTETICO-123', ML_REFRESH_TOKEN: 'fake-refresh-SINTETICO-456', ML_ACCESS_TOKEN: 'APP_USR-fake-SINTETICO-789' };
const savedEnv = {}; for (const [k, v] of Object.entries(FAKE_ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
const realFetch = globalThis.fetch; const fetchCalls = [];
globalThis.fetch = async (...a) => { fetchCalls.push(a); throw new Error('rede proibida no teste'); };
const logs = []; const saved = {};
for (const m of ['log', 'info', 'warn', 'error', 'debug']) { saved[m] = console[m]; console[m] = (...a) => logs.push(a.map(String).join(' ')); }
const { default: handler } = await import('../api/ml-callback.mjs');
const call = async (url, { method = 'GET', headers = {} } = {}) => {
  const res = { headers: {}, body: null, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b ?? ''); } };
  await handler({ url, method, headers }, res);
  return res;
};
const SECRETS = Object.values(FAKE_ENV);
const noLeak = (res, extra = []) => {
  for (const s of [...SECRETS, ...extra]) {
    assert.ok(!res.body.includes(s), `resposta não contém ${s.slice(0, 8)}…`);
    assert.ok(!Object.values(res.headers).some((h) => String(h).includes(s)), 'headers sem segredo');
  }
};
const safeHeaders = (res) => {
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store', 'nunca em cache');
  assert.equal(res.headers['referrer-policy'], 'no-referrer', 'o código não vaza via Referer ao abrir o GitHub');
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(res.headers['set-cookie'], undefined, 'não grava cookie');
  assert.equal(res.headers.location, undefined, 'não redireciona com o código');
};
const CODE = 'TG-0123456789abcdef-SINTETICO';

try {
  await t('B1. código válido: mostra o código (só ele) para colar no workflow, com headers de proteção', async () => {
    const res = await call(`/ml/callback?code=${CODE}&state=qualquer`);
    safeHeaders(res); noLeak(res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Autorizado no Mercado Livre/);
    assert.equal(res.body.split(CODE).length - 1, 1, 'o código aparece uma única vez (no campo para copiar)');
    assert.match(res.body, new RegExp(`<input readonly value="${CODE}"`));
    assert.match(res.body, /href="https:\/\/github\.com\/TonyWatanabe-dev\/pokemon-price-hunter\/actions\/workflows\/ml-auth\.yml" rel="noreferrer"/);
    assert.doesNotMatch(res.body, /<script/i, 'sem script que possa enviar o código a terceiros');
    assert.doesNotMatch(res.body, /access_token|refresh_token|client_secret/i);
  });
  await t('B2. code ausente ou fora do formato TG-…: página de erro, código não é ecoado, nenhuma troca de token', async () => {
    for (const q of ['', '?state=abc', '?code=', '?code=TG-12', '?code=XX-0123456789', `?code=${CODE}%22%3E%3Cscript%3E`, '?code=TG-abc%20def123', `?code=${'TG-' + 'a'.repeat(201)}`]) {
      const res = await call(`/ml/callback${q}`);
      safeHeaders(res); noLeak(res);
      assert.match(res.body, /Não veio código/, q);
      assert.doesNotMatch(res.body, /<input/, `${q}: sem campo de código`);
      assert.doesNotMatch(res.body, /<script/i, `${q}: sem script injetado`);
    }
  });
  await t('B3. erro do provedor: mensagem escapada (sem XSS) e sem segredo; código junto com erro inválido não aparece', async () => {
    const res = await call('/ml/callback?error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E%22%27');
    noLeak(res); safeHeaders(res);
    assert.match(res.body, /Não veio código/);
    assert.ok(res.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;'), 'descrição escapada');
    assert.doesNotMatch(res.body, /<script/i);
    const only = await call('/ml/callback?error=access_denied');
    assert.match(only.body, /access_denied/);
    const bad = await call('/ml/callback?code=nao-e-TG-SINTETICO&error=invalid_grant');
    assert.ok(!bad.body.includes('nao-e-TG-SINTETICO'), 'código inválido não é ecoado');
  });
  await t('B4. state ausente/forjado não muda nada: a página não usa state (nem para sessão, nem para troca)', async () => {
    const a = await call(`/ml/callback?code=${CODE}`);
    const b = await call(`/ml/callback?code=${CODE}&state=forjado%3Cb%3E`);
    assert.equal(a.body, b.body, 'state ignorado por completo — não é refletido nem altera a resposta');
    assert.ok(!b.body.includes('forjado'));
  });
  await t('B5. métodos e headers inesperados: mesma resposta segura, sem efeito colateral', async () => {
    const base = await call(`/ml/callback?code=${CODE}`);
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      const res = await call(`/ml/callback?code=${CODE}`, { method, headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: 'sid=fake', authorization: `Bearer ${FAKE_ENV.ML_ACCESS_TOKEN}` } });
      safeHeaders(res); noLeak(res);
      assert.equal(res.body, base.body, `${method}: não depende de método nem de headers`);
      assert.equal(res.headers['access-control-allow-origin'], undefined, `${method}: sem CORS liberado`);
    }
    const abs = await call(`https://evil.example/ml/callback?code=${CODE}`, { headers: { host: 'evil.example' } });
    assert.equal(abs.body, base.body, 'host/URL absoluta não injeta links');
  });
  await t('B6. nada vai para a rede nem para o log, e o módulo não lê variáveis de ambiente', async () => {
    assert.equal(fetchCalls.length, 0, 'nenhuma chamada de rede (a troca de token acontece no workflow, não aqui)');
    for (const l of logs) for (const s of [...SECRETS, CODE]) assert.ok(!l.includes(s), 'log sem segredo/código');
    assert.equal(logs.length, 0, 'handler não escreve log');
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../api/ml-callback.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /process\.env|fetch\(|console\./, 'sem ambiente, rede ou log no callback');
  });
} finally {
  globalThis.fetch = realFetch;
  for (const m of Object.keys(saved)) console[m] = saved[m];
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

console.log(`✓ Partições e callback do Mercado Livre: ${n} grupos passaram (sem banco, sem rede)`);
