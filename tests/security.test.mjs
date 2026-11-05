import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../senai-auth.js', import.meta.url), 'utf8');
const document = new JSDOM(html).window.document;
const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
test('CSP bloqueia scripts inline, eval, objetos e conexões arbitrárias', () => {
  const directives = Object.fromEntries(policy.split(';').map(s => s.trim().split(/\s+/)).filter(s => s[0]).map(([k,...v]) => [k,v]));
  assert.deepEqual(directives['script-src'], ["'self'", 'https://cdn.jsdelivr.net']);
  assert.deepEqual(directives['script-src-attr'], ["'none'"]);
  assert.deepEqual(directives['worker-src'], ["'self'"]);
  assert.deepEqual(directives['media-src'], ["'self'"]);
  assert.deepEqual(directives['manifest-src'], ["'self'"]);
  assert.deepEqual(directives['upgrade-insecure-requests'], []);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['connect-src'], ["'self'", 'https://xjmkftxvwsvxjujgaysd.supabase.co', 'wss://xjmkftxvwsvxjujgaysd.supabase.co']);
  assert.equal(document.querySelectorAll('script:not([src])').length, 0);
});
test('SDK fixado exige SRI SHA-384 e CORS anônimo', () => {
  const sdk = document.querySelector('script[src^="https:"]');
  assert.equal(sdk.src, 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.min.js');
  assert.match(sdk.integrity || sdk.getAttribute('integrity'), /^sha384-[A-Za-z0-9+/]{64}$/);
  assert.equal(sdk.getAttribute('crossorigin'), 'anonymous');
});
test('Vercel entrega a mesma CSP e impede incorporação em iframe', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = Object.fromEntries(config.headers[0].headers.map(h => [h.key, h.value]));
  assert.equal(headers['Content-Security-Policy'], policy + "; frame-ancestors 'none'");
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Strict-Transport-Security'], 'max-age=63072000; includeSubDomains; preload');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(headers['Origin-Agent-Cluster'], '?1');
  assert.equal(headers['X-DNS-Prefetch-Control'], 'off');
  assert.equal(headers['X-Permitted-Cross-Domain-Policies'], 'none');
  assert.equal(headers['X-Robots-Tag'], 'noindex, nofollow, noarchive');
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
  assert.match(headers['Permissions-Policy'], /microphone=\(self\)/);
  // Arduino: só a porta serial do próprio site; WebUSB continua bloqueado.
  assert.match(headers['Permissions-Policy'], /serial=\(self\)/);
  assert.match(headers['Permissions-Policy'], /usb=\(\)/);
});
test('login usa gateway com limite no servidor e não autentica diretamente no navegador', () => {
  assert.match(authSource, /functions\.invoke\("senai-login"/);
  assert.match(authSource, /attempts_remaining/);
  assert.match(authSource, /bloquearLogin/);
  assert.doesNotMatch(authSource, /auth\.signInWithPassword/);
});
test('novas senhas exigem comprimento e diversidade de caracteres', () => {
  const loginEmail = document.getElementById('senai-email');
  const loginPassword = document.getElementById('senai-password');
  assert.equal(loginEmail.maxLength, 254);
  assert.equal(loginPassword.maxLength, 128);
  assert.equal(loginEmail.getAttribute('autocapitalize'), 'none');
  assert.equal(loginEmail.getAttribute('spellcheck'), 'false');
  const password = document.getElementById('nova-senha');
  assert.equal(password.minLength, 12);
  assert.equal(password.maxLength, 128);
  assert.match(password.pattern, /\?=\.\*\[a-z\]/);
  assert.match(password.pattern, /\?=\.\*\[A-Z\]/);
  assert.match(password.pattern, /\?=\.\*\[0-9\]/);
});
test('páginas de erro são genéricas e não expõem detalhes internos', () => {
  for (const file of ['404.html', '500.html']) {
    const errorHtml = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(errorHtml, /noindex,nofollow/);
    assert.doesNotMatch(errorHtml, /stack|exception|supabase|vercel-id|request_id|SQL/i);
    assert.equal(new JSDOM(errorHtml).window.document.querySelectorAll('script').length, 0);
  }
});
test('histórico remoto é limitado explicitamente à sala esperada', () => {
  const loadHistory = authSource.slice(authSource.indexOf('async function loadHistory'), authSource.indexOf('async function loadHistoryForExport'));
  assert.match(loadHistory, /from\("rooms"\)/);
  assert.match(loadHistory, /eq\("room_id", rooms\[0\]\.id\)/);
});
test('inicialização de tema mantém preferências e tolera armazenamento bloqueado', async () => {
  const source = readFileSync(new URL('../theme-init.js', import.meta.url), 'utf8');
  for (const value of ['claro', 'escuro', 'invalido', null]) {
    const dom = new JSDOM(html, {runScripts:'outside-only', url:'https://smartclass.test'});
    if (value) dom.window.localStorage.setItem('tema', value);
    dom.window.eval(source);
    assert.equal(dom.window.document.documentElement.dataset.tema, value === 'claro' ? 'claro' : 'escuro');
    dom.window.close();
  }
  const dom = new JSDOM(html, {runScripts:'outside-only'});
  dom.window.eval(source);
  assert.equal(dom.window.document.documentElement.dataset.tema, 'escuro');
  dom.window.close();
});
