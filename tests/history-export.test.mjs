import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../senai-auth.js', import.meta.url), 'utf8');
const loginHtml = '<form id="senai-login-form"><input id="senai-email"><input id="senai-password"></form><p id="senai-status"></p>';

async function setup(t, options = {}) {
  const dom = new JSDOM(loginHtml, { runScripts: 'outside-only', url: 'https://smartclass.test' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const queries = [];
  const profile = { id: 'actor', role: options.role || 'ADM', status: 'ATIVO', full_name: 'Conta teste' };
  const client = {
    auth: {
      signInWithPassword: async () => ({}),
      setSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { id: 'actor', email: 'teste@example.com', user_metadata: {} } } })
    },
    functions: {
      invoke: async (name) => name === 'senai-login'
        ? { data: { access_token: 'access-token', refresh_token: 'refresh-token' } }
        : { data: {} }
    },
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      return {
        select(fields) { query.fields = fields; return this; },
        eq(column, value) { query.filters.push(['eq', column, value]); return this; },
        gte(column, value) { query.filters.push(['gte', column, value]); return this; },
        lt(column, value) { query.filters.push(['lt', column, value]); return this; },
        order(column, config) { query.order = [column, config]; return this; },
        single: async () => ({ data: profile }),
        limit: async (value) => {
          query.limit = value;
          if (table === 'rooms') return { data: options.noRoom ? [] : [{ id: 'smart-class-room' }], error: options.roomError };
          return { data: [] };
        },
        range: async (from, to) => {
          query.range = [from, to];
          if (options.readError && from >= (options.failAtOffset || 0)) return { data: null, error: options.readError };
          const rows = (options.rows || []).filter((row) => query.filters.every(([operator, column, value]) => {
            if (operator === 'eq') return row[column] === value;
            if (operator === 'gte') return new Date(row[column]) >= new Date(value);
            return new Date(row[column]) < new Date(value);
          })).sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
          return { data: rows.slice(from, Math.min(to + 1, from + (options.serverPageSize || 500))) };
        }
      };
    }
  };
  window.supabase = { createClient: () => client };
  window.eval(script);
  const state = { historico: [{ temperatura: 99, hora: new window.Date('2026-10-29T12:00:00Z') }] };
  state.sensores = { ...state.historico[0] };
  await window.senaiAuth.start(() => {}, state, () => {});
  if (options.authenticated !== false) {
    window.document.getElementById('senai-email').value = 'teste@example.com';
    window.document.getElementById('senai-password').value = 'senha-de-teste';
    window.document.getElementById('senai-login-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { auth: window.senaiAuth, state, queries };
}

const inicio = new Date('2026-10-29T03:00:00.000Z');
const fimExclusivo = new Date('2026-10-30T03:00:00.000Z');
const reading = (recorded_at, attrs = {}) => ({
  room_id: 'smart-class-room', recorded_at,
  temperature: '23.5', humidity: '60', luminosity: '80', people: '12', ...attrs
});

test('exportação consulta somente a sala e inclui o início, excluindo o limite do dia seguinte', async (t) => {
  const rows = [
    reading('2026-10-29T02:59:59.999Z'),
    reading(inicio.toISOString()),
    reading('2026-10-30T02:59:59.999Z'),
    reading(fimExclusivo.toISOString()),
    reading('2026-10-29T12:00:00.000Z', { room_id: 'outra-sala' })
  ];
  const { auth, state, queries } = await setup(t, { rows });
  const estadoAnterior = JSON.stringify(state);
  const registros = await auth.loadHistoryForExport(inicio, fimExclusivo);
  assert.equal(registros.length, 2);
  assert.deepEqual(Array.from(registros, (row) => row.hora.toISOString()), [inicio.toISOString(), '2026-10-30T02:59:59.999Z']);
  assert.equal(registros[0].temperatura, 23.5);
  assert.equal(registros[0].umidade, 60);
  assert.equal(registros[0].luminosidade, 80);
  assert.equal(registros[0].pessoas, 12);
  assert.equal(JSON.stringify(state), estadoAnterior, 'a consulta de download não altera o estado do dashboard');

  const sala = queries.find((query) => query.table === 'rooms');
  assert.deepEqual(sala.filters, [['eq', 'name', 'Sala SENAI Smart Class']]);
  assert.equal(sala.limit, 1);
  const paginas = queries.filter((query) => query.range);
  assert.equal(paginas[0].fields, 'temperature,humidity,luminosity,people,recorded_at');
  assert.deepEqual(paginas[0].filters, [
    ['eq', 'room_id', 'smart-class-room'],
    ['gte', 'recorded_at', inicio.toISOString()],
    ['lt', 'recorded_at', fimExclusivo.toISOString()]
  ]);
  assert.equal(paginas[0].order[0], 'recorded_at');
  assert.equal(paginas[0].order[1].ascending, true);
  assert.deepEqual(paginas.map((query) => query.range), [[0, 499], [2, 501]]);
});

test('professor exporta mais de mil registros mesmo quando o servidor reduz cada página', async (t) => {
  const rows = Array.from({ length: 1205 }, (_, index) => reading(new Date(+inicio + index * 1000).toISOString(), { people: String(index) }));
  const { auth, queries } = await setup(t, { role: 'PROFESSOR', rows, serverPageSize: 200 });
  const registros = await auth.loadHistoryForExport(inicio, fimExclusivo);
  assert.equal(registros.length, 1205);
  assert.deepEqual(Array.from(registros, (row) => row.pessoas), Array.from({ length: 1205 }, (_, index) => index));
  assert.deepEqual(queries.filter((query) => query.range).map((query) => query.range), [
    [0, 499], [200, 699], [400, 899], [600, 1099], [800, 1299], [1000, 1499], [1200, 1699], [1205, 1704]
  ]);
});

test('sala inexistente retorna vazio sem consultar dados de outras salas', async (t) => {
  const { auth, queries } = await setup(t, { noRoom: true });
  assert.equal((await auth.loadHistoryForExport(inicio, fimExclusivo)).length, 0);
  assert.equal(queries.filter((query) => query.range).length, 0);
});

test('exportação propaga erros de sala e de páginas posteriores sem retornar histórico parcial', async (t) => {
  const erroSala = new Error('Falha ao consultar sala');
  const sala = await setup(t, { roomError: erroSala });
  await assert.rejects(sala.auth.loadHistoryForExport(inicio, fimExclusivo), (error) => error === erroSala);

  const erroLeituras = new Error('Falha ao consultar leituras');
  const leituras = await setup(t, {
    rows: [reading(inicio.toISOString())], serverPageSize: 1,
    readError: erroLeituras, failAtOffset: 1
  });
  await assert.rejects(leituras.auth.loadHistoryForExport(inicio, fimExclusivo), (error) => error === erroLeituras);
  assert.deepEqual(leituras.queries.filter((query) => query.range).map((query) => query.range), [[0, 499], [1, 500]]);
});

for (const options of [{ authenticated: false }, { role: 'ALUNO' }]) {
  test(`exportação exige perfil autorizado (${options.role || 'sem login'})`, async (t) => {
    const { auth, queries } = await setup(t, options);
    await assert.rejects(auth.loadHistoryForExport(inicio, fimExclusivo), /permissão/);
    assert.equal(queries.some((query) => query.table === 'rooms' || query.range), false);
  });
}

test('datas inválidas ou invertidas são recusadas antes de consultar o banco', async (t) => {
  const { auth, queries } = await setup(t);
  for (const [de, ate] of [
    [new Date(NaN), fimExclusivo], [inicio, new Date(NaN)],
    [fimExclusivo, inicio], [inicio, inicio], ['2026-10-29', fimExclusivo], [null, fimExclusivo]
  ]) {
    await assert.rejects(auth.loadHistoryForExport(de, ate), /período válido/);
  }
  assert.equal(queries.some((query) => query.table === 'rooms' || query.range), false);
});
