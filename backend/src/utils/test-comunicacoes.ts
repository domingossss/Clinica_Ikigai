import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import pool from '../config/database.js';
import { gerarHashSenha } from '../middleware/auth.js';
import { app } from '../server.js';
import { processarFila } from '../services/comunicacoes.js';

export async function runComunicacaoTests() {
  const [base] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS nome');
  if (!/^ikigai_verificacao_\d+$/.test(base[0].nome)) throw new Error('A suíte exige o banco descartável.');
  const parametros = ['COMUNICACAO_PROVEDOR', 'COMUNICACAO_SIMULAR_RESULTADO', 'LEMBRETE_ANTECEDENCIA_MINUTOS', 'LEMBRETE_FUSO'];
  const originais = parametros.map(k => process.env[k]);
  let pass = 0;
  function verificar(condicao: boolean, descricao: string) {
    if (!condicao) throw new Error('Comunicação: ' + descricao);
    pass++;
    console.log('[PASSOU] Comunicação: ' + descricao);
  }
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
    const senha = randomUUID();
    async function sessao(perfil: string) {
      const email = randomUUID() + '@example.invalid';
      await pool.query('INSERT INTO usuario (nome,email,senha_hash,perfil) VALUES (?,?,?,?)', ['Teste comunicação', email, gerarHashSenha(senha), perfil]);
      const login = await fetch(url + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, senha }) });
      if (!login.ok) throw new Error('Falha no login de comunicação (' + login.status + ')');
      return login.headers.get('set-cookie')!.split(';')[0];
    }
    const cookie = await sessao('ADMIN');
    const uuid = randomUUID();
    await pool.query("INSERT INTO paciente (uuid,nome,whatsapp) VALUES (?, 'Paciente fictício de comunicação', '5511999990000')", [uuid]);
    const ocorrencia = '2040-02-07 10:00:00';
    async function criarAtendimento() {
      const [resultado] = await pool.query<ResultSetHeader>(`INSERT INTO agendamento
        (paciente_uuid, id_profissional, id_procedimento, data, horario_inicio, horario_fim)
        VALUES (?,1,1,'2040-02-07','10:00:00','11:00:00')`, [uuid]);
      return resultado.insertId;
    }
    const id = await criarAtendimento();
    await pool.query("UPDATE paciente SET cpf = '11144477735' WHERE uuid = ?", [uuid]);
    const buscar = (termo: string, credencial = cookie) => fetch(url + '/comunicacoes/buscar-atendimentos', {
      method: 'POST', headers: { Cookie: credencial, 'Content-Type': 'application/json' },
      body: JSON.stringify({ termo }),
    });
    for (const termo of [String(id), 'paciente fictício', '111.444.777-35', '(11) 99999-0000']) {
      const resposta = await buscar(termo);
      const resultado = await resposta.json() as { dados: Array<{ id: number; cpf?: string; whatsapp?: string }> };
      verificar(resposta.ok && resultado.dados.some(item => item.id === id && !item.cpf && !item.whatsapp),
        'busca localiza atendimento sem expor CPF ou telefone (' + termo + ')');
    }
    const consultar = (agendamento: number, filtro = '') => fetch(url + '/comunicacoes?agendamento=' + agendamento + filtro, { headers: { Cookie: cookie } });
    const solicitar = (agendamento: number, anterior?: number, credencial = cookie) => fetch(url + '/comunicacoes/' + agendamento + '/confirmacao', {
      method: 'POST', headers: { Cookie: credencial, 'Content-Type': 'application/json' }, body: JSON.stringify({ ocorrencia, tentativaAnterior: anterior }),
    });
    verificar((await fetch(url + '/comunicacoes')).status === 401, 'consulta anônima negada');
    for (const perfil of ['RECEPCAO', 'PROFISSIONAL']) {
      const sessaoRestrita = await sessao(perfil);
      verificar((await fetch(url + '/comunicacoes', { headers: { Cookie: sessaoRestrita } })).status === 403 &&
        (await solicitar(id, undefined, sessaoRestrita)).status === 403 &&
        (await buscar(String(id), sessaoRestrita)).status === 403, 'consulta e envio negados para ' + perfil);
    }
    const vazio = await ((await consultar(id)).json() as Promise<any>);
    verificar(vazio.dados.length === 0 && vazio.atendimento.contatoFinal === '0000', 'lista vazia mostra o contato mascarado do atendimento');
    delete process.env.COMUNICACAO_PROVEDOR;
    verificar((await solicitar(id)).status === 503, 'canal desabilitado impede envio');
    process.env.COMUNICACAO_PROVEDOR = 'simulado';
    process.env.COMUNICACAO_SIMULAR_RESULTADO = 'submetida';
    verificar((await solicitar(2147483647)).status === 404, 'atendimento inexistente');
    const cliques = await Promise.all([solicitar(id), solicitar(id)]);
    const resultados = await Promise.all(cliques.map(r => r.json() as Promise<any>));
    const lista = await ((await consultar(id)).json() as Promise<any>);
    verificar(resultados.every(r => r.dados.id === lista.dados[0].id) && lista.dados.length === 1 &&
      lista.dados[0].estado === 'SUBMETIDA' && !!lista.dados[0].referencia_externa, 'cliques simultâneos registram uma única submissão');
    verificar((await ((await consultar(id, '&estado=ENTREGUE')).json() as Promise<any>)).dados.length === 0, 'submissão não consta como entrega');
    const rejeitada = await criarAtendimento();
    process.env.COMUNICACAO_SIMULAR_RESULTADO = 'rejeitada';
    const falha = await ((await solicitar(rejeitada)).json() as Promise<any>);
    verificar(falha.dados.estado === 'FALHA' && !!falha.dados.erro, 'rejeição consultável');
    process.env.COMUNICACAO_SIMULAR_RESULTADO = 'entregue';
    const repeticoes = await Promise.all([solicitar(rejeitada, falha.dados.id), solicitar(rejeitada, falha.dados.id)]);
    const retornos = await Promise.all(repeticoes.map(r => r.json() as Promise<any>));
    verificar(retornos[0].dados.id === retornos[1].dados.id && retornos[0].dados.estado === 'ENTREGUE' &&
      (await ((await consultar(rejeitada)).json() as Promise<any>)).dados.length === 2, 'reenvio explícito preserva falha e não duplica a tentativa');
    const falhas = await (await consultar(rejeitada, '&estado=FALHA')).json() as {
      dados: Array<{ id: number; ultima_tentativa: number }>;
    };
    verificar(falhas.dados.length === 1 && falhas.dados[0].id === falha.dados.id &&
      falhas.dados[0].ultima_tentativa === 0, 'filtro de falhas preserva histórico e identifica tentativa já substituída');
    await pool.query("UPDATE paciente SET whatsapp = 'inválido' WHERE uuid = ?", [uuid]);
    const invalida = await criarAtendimento();
    verificar((await ((await solicitar(invalida)).json() as Promise<any>)).dados.erro.includes('WhatsApp inválido'), 'contato inválido persiste a falha');
    await pool.query("UPDATE paciente SET whatsapp = '5511999990000' WHERE uuid = ?", [uuid]);
    const incerta = await criarAtendimento();
    process.env.COMUNICACAO_SIMULAR_RESULTADO = 'timeout';
    const timeout = await ((await solicitar(incerta)).json() as Promise<any>);
    verificar(timeout.dados.estado === 'INCERTA' && (await ((await solicitar(incerta, timeout.dados.id)).json() as Promise<any>)).dados.id === timeout.dados.id,
      'resultado incerto não reenvia');
    verificar((await ((await consultar(incerta)).json() as Promise<any>)).atendimento.status === 'Agendado', 'falha do provedor preserva o atendimento');
    process.env.COMUNICACAO_SIMULAR_RESULTADO = 'submetida';
    delete process.env.LEMBRETE_ANTECEDENCIA_MINUTOS;
    delete process.env.LEMBRETE_FUSO;
    const agora = new Date('2040-02-06T13:00:00Z');
    await pool.query("UPDATE agendamento SET status = 'Cancelado' WHERE id_agendamento = ?", [invalida]);
    await pool.query("UPDATE agendamento SET data = '2040-02-08', status = 'Reagendado' WHERE id_agendamento = ?", [incerta]);
    await pool.query("UPDATE agendamento SET data = '2040-02-05' WHERE id_agendamento = ?", [rejeitada]);
    verificar((await solicitar(invalida)).status === 409, 'confirmação manual recusada após cancelamento');
    verificar((await solicitar(incerta)).status === 409, 'confirmação do horário anterior recusada após reagendamento');
    const [tentativas] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM comunicacao_agendamento WHERE tipo = 'CONFIRMACAO' AND id_agendamento IN (?, ?)",
      [invalida, incerta],
    );
    verificar(Number(tentativas[0].total) === 2, 'pedidos desatualizados preservam o histórico sem gerar novas tentativas');
    await processarFila(new Date(agora.getTime() - 1000));
    const [antecipados] = await pool.query<RowDataPacket[]>("SELECT id FROM comunicacao_agendamento WHERE id_agendamento = ? AND tipo = 'LEMBRETE'", [id]);
    verificar(!antecipados.length, 'lembrete aguarda até faltarem 24 horas no fuso de São Paulo');
    await Promise.all([processarFila(agora), processarFila(agora)]);
    await processarFila(agora);
    const [lembretes] = await pool.query<RowDataPacket[]>("SELECT id_agendamento, estado FROM comunicacao_agendamento WHERE tipo = 'LEMBRETE' AND id_agendamento IN (?)", [[id, rejeitada, invalida, incerta]]);
    verificar(lembretes.length === 1 && lembretes[0].id_agendamento === id && lembretes[0].estado === 'SUBMETIDA',
      'concorrência e nova execução geram um lembrete, excluindo passado, cancelado e reagendado fora da janela');
    await pool.query("UPDATE agendamento SET horario_inicio = '10:10:00', status = 'Reagendado' WHERE id_agendamento = ?", [id]);
    await processarFila(new Date(agora.getTime() + 10 * 60000));
    const [ocorrencias] = await pool.query<RowDataPacket[]>("SELECT COUNT(DISTINCT ocorrencia) AS total FROM comunicacao_agendamento WHERE tipo = 'LEMBRETE' AND id_agendamento = ?", [id]);
    verificar(Number(ocorrencias[0].total) === 2, 'novo horário elegível registra ocorrência própria');
    return { pass, fail: 0 };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    parametros.forEach((k, i) => { if (originais[i] === undefined) delete process.env[k]; else process.env[k] = originais[i]; });
  }
}
