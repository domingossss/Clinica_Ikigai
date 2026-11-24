import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escaparTextoHtml } from '../src/indicadores/renderizacao.js';
import { atendimentosComAtrasoRegistrado, calcularOcupacao, contarDiasDeFuncionamento, indexarCapacidade, resumirConversas } from '../src/indicadores/metricas.js';
import {
  SURVEY_STORAGE_KEY, apagarRespostasPesquisa, carregarRespostasPesquisa,
  lerRespostaPesquisa, salvarRespostasPesquisa, surveyFormHtml,
} from '../src/indicadores/pesquisa.js';

function preencherPesquisa() {
  const dados = new FormData();
  for (const campo of ['schedulingEase', 'waitAcceptability', 'receptionAttention', 'professionalClarity', 'safeComfort', 'priceFairness']) {
    dados.set(campo, '4');
  }
  dados.set('aiResolution', 'false');
  dados.set('wouldReturn', 'true');
  dados.set('recommendation', '0');
  dados.set('discovery', 'Indicação');
  return dados;
}

function usarArmazenamento(contexto) {
  const registros = new Map();
  const descritorAnterior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const armazenamento = {
    getItem: chave => registros.get(chave) ?? null,
    setItem: (chave, valor) => registros.set(chave, valor),
    removeItem: chave => registros.delete(chave),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: armazenamento, configurable: true });
  contexto.after(() => {
    if (descritorAnterior) Object.defineProperty(globalThis, 'localStorage', descritorAnterior);
    else delete globalThis.localStorage;
  });
  return armazenamento;
}

test('nomes de especialidades com marcação são exibidos como texto', () => {
  const nome = `Terapia & <b>Cuidados</b> "A" 'B'`;
  assert.equal(escaparTextoHtml(nome), 'Terapia &amp; &lt;b&gt;Cuidados&lt;/b&gt; &quot;A&quot; &#39;B&#39;');
  assert.equal(escaparTextoHtml(0), '0');
});

test('pesquisa aceita a nota zero e uma resposta negativa explícita', () => {
  const resposta = lerRespostaPesquisa(preencherPesquisa());
  assert.equal(resposta.recommendation, 0);
  assert.equal(resposta.aiResolution, false);
  assert.equal(resposta.wouldReturn, true);
});

test('pesquisa rejeita respostas ausentes, nota vazia e valores fora dos limites', () => {
  for (const campo of ['recommendation', 'aiResolution', 'wouldReturn']) {
    const dados = preencherPesquisa();
    dados.delete(campo);
    assert.equal(lerRespostaPesquisa(dados), null);
  }
  for (const nota of ['', '11', '-1', 'abc']) {
    const dados = preencherPesquisa();
    dados.set('recommendation', nota);
    assert.equal(lerRespostaPesquisa(dados), null);
  }
});

test('pesquisa lê respostas existentes e informa armazenamento inválido', contexto => {
  const armazenamento = usarArmazenamento(contexto);
  const resposta = lerRespostaPesquisa(preencherPesquisa());
  armazenamento.setItem(SURVEY_STORAGE_KEY, JSON.stringify([resposta]));
  assert.deepEqual(carregarRespostasPesquisa(), { respostas: [resposta], erro: '' });
  armazenamento.setItem(SURVEY_STORAGE_KEY, '{');
  assert.deepEqual(carregarRespostasPesquisa(), { respostas: [], erro: 'Dados de pesquisa inválidos.' });
});

test('falhas ao gravar ou apagar são sinalizadas sem perder a resposta persistida', contexto => {
  const armazenamento = usarArmazenamento(contexto);
  const respostas = [lerRespostaPesquisa(preencherPesquisa())];
  assert.equal(salvarRespostasPesquisa(respostas), '');
  const apagar = armazenamento.removeItem;
  armazenamento.setItem = () => { throw new Error('QuotaExceededError'); };
  armazenamento.removeItem = () => { throw new Error('SecurityError'); };

  assert.match(salvarRespostasPesquisa([]), /Não foi possível salvar/);
  assert.match(apagarRespostasPesquisa(), /Não foi possível apagar/);
  assert.deepEqual(carregarRespostasPesquisa().respostas, respostas);
  armazenamento.removeItem = apagar;
  assert.equal(apagarRespostasPesquisa(), '');
  assert.deepEqual(carregarRespostasPesquisa().respostas, []);
});

test('formulário anuncia falha de gravação e escapa o texto do aviso', () => {
  const formulario = surveyFormHtml({ erro: '', aviso: { texto: '<b>Falha</b>', falha: true }, total: 0 });
  assert.match(formulario, /role="alert".*&lt;b&gt;Falha&lt;\/b&gt;/);
  assert.doesNotMatch(formulario, /<b>Falha<\/b>/);
});

const diaDaSemana = diasAtras => (6 - diasAtras + 7) % 7;

test('ocupação usa os minutos registrados da clínica e da especialidade sem contar cancelamentos', () => {
  const capacidade = indexarCapacidade([
    { d: 0, sp: -1, minutos: 240 }, { d: 1, sp: -1, minutos: 60 },
    { d: 0, sp: 0, minutos: 120 }, { d: 1, sp: 0, minutos: 0 },
  ]);
  const consultas = [
    { d: 0, sp: 0, s: 'A', minutos: 60 },
    { d: 1, sp: 1, s: 'R', minutos: 30 },
    { d: 0, sp: 0, s: 'C', minutos: 45 },
  ];
  const clinica = calcularOcupacao(consultas, capacidade.get(-1), 0, 2, diaDaSemana);
  assert.equal(clinica.capacidade, 300);
  assert.equal(clinica.ocupados, 90);
  assert.equal(clinica.ociosos, 210);
  assert.equal(clinica.taxa, 30);
  assert.equal(clinica.porDiaDaSemana[6], 25);
  assert.equal(clinica.porDiaDaSemana[5], 50);

  const especialidade = calcularOcupacao(consultas.filter(x => x.sp === 0), capacidade.get(0), 0, 2, diaDaSemana);
  assert.equal(especialidade.capacidade, 120);
  assert.equal(especialidade.taxa, 50);
  assert.equal(especialidade.porDiaDaSemana[5], null);
});

test('ocupação diferencia zero registrado de dias ausentes e de capacidade inexistente', () => {
  const capacidade = new Map([[0, 90], [1, 0]]);
  const semConsultas = calcularOcupacao([], capacidade, 0, 2, diaDaSemana);
  assert.equal(semConsultas.taxa, 0);
  const incompleta = calcularOcupacao([], capacidade, 0, 3, diaDaSemana);
  assert.equal(incompleta.capacidade, null);
  assert.equal(incompleta.taxa, null);
  assert.ok(incompleta.porDiaDaSemana.every(valor => valor === null));
  assert.equal(calcularOcupacao([], capacidade, 1, 2, diaDaSemana).taxa, null);
  assert.equal(calcularOcupacao([], undefined, 0, 2, diaDaSemana).taxa, null);
});

test('atraso conta a pontualidade registrada e ignora valor padrão sem registro', () => {
  const pontual = { s: 'R', atraso_registrado: 1, dl: 0 };
  const atrasado = { s: 'R', atraso_registrado: true, dl: 12 };
  assert.deepEqual(atendimentosComAtrasoRegistrado([
    pontual, atrasado, { s: 'R', atraso_registrado: 0, dl: 0 },
    { s: 'A', atraso_registrado: 1, dl: 0 },
  ]), [pontual, atrasado]);
});

test('conversão e resolução usam sessões globais, com recorte por período', () => {
  const conversas = [
    { d: 0, iniciadas: 5, agendadas: 1, resolvidas: 3 },
    { d: 1, iniciadas: 3, agendadas: 1, resolvidas: 1 },
    { d: 2, iniciadas: 10, agendadas: 5, resolvidas: 7 },
  ];
  const abandonadas = [2, 1, 3];
  assert.deepEqual(resumirConversas(conversas, abandonadas, 0, 2), {
    iniciadas: 8, agendadas: 2, resolvidas: 4, abandonadas: 3, conversao: 25, resolucao: 50,
  });
  assert.equal(resumirConversas(conversas, abandonadas, 3, 4).conversao, null);
});

test('meta diária incorpora domingo aberto ou com agendamento e respeita fechamento registrado', () => {
  const capacidade = new Map([[0, 360], [1, 0], [2, 0]]);
  const diaDaSemana = dia => [0, 1, 0, 6, 0][dia];
  assert.equal(contarDiasDeFuncionamento(0, 5, capacidade, new Set([2]), diaDaSemana), 3);
});
