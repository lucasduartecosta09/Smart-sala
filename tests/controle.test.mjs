import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fonte = readFileSync(new URL('../assets/controle.js', import.meta.url), 'utf8');

function carregar() {
  const contexto = vm.createContext({ console });
  contexto.window = contexto;
  vm.runInContext(fonte, contexto);
  return contexto.senaiControle;
}

test('a fala vira o mesmo pedido que a assistente do painel faria', () => {
  const { interpretarFala } = carregar();
  const pedido = (frase) => {
    const resultado = interpretarFala(frase);
    return resultado ? `${resultado.acao}:${resultado.valor}` : null;
  };
  assert.equal(pedido('Ligar o ventilador'), 'ventilador:true');
  assert.equal(pedido('desliga o ventilador por favor'), 'ventilador:false');
  assert.equal(pedido('acende a luz'), 'luz:true');
  assert.equal(pedido('Apague a lâmpada'), 'luz:false');
  assert.equal(pedido('ligar o modo automático'), 'modo:true');
  assert.equal(pedido('desligar a automação'), 'modo:false');
  assert.equal(pedido('desligar tudo'), 'desligar-tudo:true');
  assert.equal(pedido('abra a porta'), 'porta:true');
  assert.equal(pedido('fecha a porta'), 'porta:false');
  assert.equal(pedido('não ligue o ventilador'), null, 'frase negada não aciona');
  assert.equal(pedido('qual a temperatura'), null);
  assert.equal(pedido(''), null);
});
