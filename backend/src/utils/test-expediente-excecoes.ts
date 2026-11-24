import pool from '../config/database.js';
import {
  validarJornadaProfissional,
  validarExcecaoDisponibilidade
} from './validation.js';

export async function runExpedienteExcecoesTests() {
  console.log("\n================================================================");
  console.log("🧪 INICIANDO TESTES DE EXPEDIENTE E INTERVALOS (IK-14)");
  console.log("================================================================");

  let pass = 0;
  let fail = 0;

  function assert(cond: boolean, desc: string) {
    if (cond) {
      console.log(`✅ [PASSOU] ${desc}`);
      pass++;
    } else {
      console.error(`🚨 [FALHOU] ${desc}`);
      fail++;
    }
  }

  try {
    // Obter um profissional de teste
    const [profRows]: any = await pool.query('SELECT id FROM profissionais LIMIT 1');
    const profId = profRows[0]?.id || 1;

    // --- TESTE IK-14 / CA04: Validações de Horários Inválidos ou Sobrepostos ---
    const vInvalidaInvertida = validarJornadaProfissional('18:00', '08:00');
    assert(vInvalidaInvertida.valido === false, 'IK-14 CA04: Rejeita horário de início posterior ao fim da jornada');

    const vIntervaloInvertido = validarJornadaProfissional('08:00', '18:00', '13:00', '12:00');
    assert(vIntervaloInvertido.valido === false, 'IK-14 CA04: Rejeita intervalo com início posterior ao término');

    const vIntervaloFora = validarJornadaProfissional('08:00', '18:00', '18:30', '19:30');
    assert(vIntervaloFora.valido === false, 'IK-14 CA04: Rejeita intervalo fora dos limites da jornada do profissional');

    const vValida = validarJornadaProfissional('08:00', '18:00', '12:00', '13:00');
    assert(vValida.valido === true, 'IK-14 CA04: Aceita jornada e intervalo válidos e consistentes');

    // --- TESTE IK-14 / CA01 & CA02: Configurar e Salvar Jornada Própria do Profissional ---
    await pool.query(
      `INSERT INTO jornada_profissional (id_profissional, dia_semana, ativo, horario_inicio, horario_fim, intervalo_inicio, intervalo_fim)
       VALUES (?, 1, 1, '09:00:00', '17:00:00', '12:00:00', '13:00:00')
       ON DUPLICATE KEY UPDATE 
          ativo = 1, horario_inicio = '09:00:00', horario_fim = '17:00:00', intervalo_inicio = '12:00:00', intervalo_fim = '13:00:00'`,
      [profId]
    );

    const [jornadaSalva]: any = await pool.query(
      'SELECT horario_inicio, horario_fim, intervalo_inicio, intervalo_fim FROM jornada_profissional WHERE id_profissional = ? AND dia_semana = 1',
      [profId]
    );
    assert(
      jornadaSalva.length === 1 &&
      jornadaSalva[0].horario_inicio === '09:00:00' &&
      jornadaSalva[0].horario_fim === '17:00:00',
      'IK-14 CA01/CA02: Salva e persiste jornada individual do profissional (Segunda-feira 09:00 às 17:00)'
    );

    // --- TESTE IK-14 / CA03: Intervalo de Almoço Configurado (12h às 13h) ---
    assert(
      jornadaSalva[0].intervalo_inicio === '12:00:00' && jornadaSalva[0].intervalo_fim === '13:00:00',
      'IK-14 CA03: Configuração de pausa/almoço das 12:00 às 13:00 registrada'
    );

    console.log("\n================================================================");
    console.log("🧪 INICIANDO TESTES DE EXCEÇÕES DE DISPONIBILIDADE (IK-83)");
    console.log("================================================================");

    // --- TESTE IK-83 / CA04: Validação de Exceções ---
    const excDataInvalida = validarExcecaoDisponibilidade('data-invalida', 'Fechado');
    assert(excDataInvalida.valido === false, 'IK-83 CA04: Rejeita formato de data incorreto para exceção');

    const excHorarioInvalido = validarExcecaoDisponibilidade('2026-12-25', 'Horario_Especial', '15:00', '10:00');
    assert(excHorarioInvalido.valido === false, 'IK-83 CA04: Rejeita Horário Especial com início posterior ao fim');

    // --- TESTE IK-83 / CA01: Cadastro de Exceção (Feriado / Recesso) ---
    const dataFeriado = '2026-11-25'; // Quarta-feira (dia útil normal)
    const [insExc]: any = await pool.query(
      `INSERT INTO excecao_disponibilidade (data, id_profissional, tipo_excecao, motivo)
       VALUES (?, NULL, 'Fechado', 'Feriado Municipal de Teste')`,
      [dataFeriado]
    );
    const excecaoId = insExc.insertId;

    const [excConsultada]: any = await pool.query(
      'SELECT id_excecao, tipo_excecao, motivo FROM excecao_disponibilidade WHERE id_excecao = ?',
      [excecaoId]
    );
    assert(
      excConsultada.length === 1 && excConsultada[0].tipo_excecao === 'Fechado',
      'IK-83 CA01: Cadastra exceção pontual de feriado para a clínica'
    );

    // --- TESTE IK-83 / CA02: Precedência da Exceção sobre a grade padrão ---
    // A data é uma quarta-feira normal, mas com a exceção 'Fechado', a clínica não opera
    const [excCheck]: any = await pool.query(
      'SELECT tipo_excecao, motivo FROM excecao_disponibilidade WHERE data = ?',
      [dataFeriado]
    );
    assert(
      excCheck.length > 0 && excCheck[0].tipo_excecao === 'Fechado',
      'IK-83 CA02: Precedência ativa: Exceção sobrepõe o dia útil da semana tornando-o fechado'
    );

    // --- TESTE IK-83 / CA03: Remoção da Exceção restaura grade padrão ---
    await pool.query('DELETE FROM excecao_disponibilidade WHERE id_excecao = ?', [excecaoId]);
    const [excAposRemocao]: any = await pool.query(
      'SELECT id_excecao FROM excecao_disponibilidade WHERE id_excecao = ?',
      [excecaoId]
    );
    assert(
      excAposRemocao.length === 0,
      'IK-83 CA03: Remoção da exceção restaura a disponibilidade e funcionamento da data padrão'
    );

  } catch (error) {
    console.error('Erro durante testes de IK-14 e IK-83:', error);
    fail++;
  }

  return { pass, fail };
}

/** Regressões de integridade. Executar somente no banco temporário do test-runner. */
export async function runIntegrityRegressionTests() {
  if (!(process.env.DB_NAME || '').startsWith('ikigai_verificacao_')) throw new Error('As regressões exigem um banco de verificação isolado.');
  const { default: express } = await import('express');
  const { default: router } = await import('../routes/agendamentos.js');
  const { default: dashboard } = await import('../routes/dashboardRoutes.js');
  const { randomUUID } = await import('node:crypto');
  const { transacaoAgenda } = await import('../services/reservasAgenda.js');
  const { acompanharAlteracoes, notificarAlteracoes } = await import('../services/alteracoesClinica.js');
  const app = express();
  app.use(express.json());
  const operador = { id: 37, nome: 'Operadora de teste', email: 'operadora@example.test', perfil: 'RECEPCAO' as 'RECEPCAO' | 'PROFISSIONAL', profissional_id: 0 };
  const { identificarSessao, COOKIE_TOKEN_NAME } = await import('../middleware/auth.js');
  const { randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');
  const [conta] = await pool.query<any>("INSERT INTO usuario(nome,email,senha_hash,perfil) VALUES (?,?,?,?)", [operador.nome,operador.email,'indisponivel',operador.perfil]);
  operador.id = conta.insertId;
  await pool.query('INSERT INTO sessao_usuario(identificador,id_usuario,expira_em) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 1 HOUR)',[identificarSessao(token),operador.id]);
  app.use((req, _res, next) => { req.usuario = operador; next(); });
  app.get('/api/eventos', acompanharAlteracoes);
  app.use('/api', notificarAlteracoes);
  app.use('/api/dashboard', dashboard);
  app.use('/api', router);
  app.use((_erro: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => res.status(500).json({ sucesso: false, erro: 'Erro durante a verificação.' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const porta = (server.address() as { port: number }).port;
  let pass = 0;
  const assert = (valor: unknown, descricao: string) => {
    if (!valor) throw new Error('Regressão: ' + descricao);
    pass++;
    console.log('✅ [PASSOU] ' + descricao);
  };
  const fluxos: AbortController[] = [];
  const abrirFluxo = async () => {
    const controller = new AbortController();
    fluxos.push(controller);
    const resposta = await fetch('http://127.0.0.1:' + porta + '/api/eventos', { signal: controller.signal, headers: {Cookie: COOKIE_TOKEN_NAME+'='+token} });
    if (!resposta.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Fluxo de eventos inválido.');
    const reader = resposta.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const proximo = async (nome: string, timeout = 5000): Promise<{ versao: string; recursos: string[] } | null> => {
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        while (true) {
          let separador: number;
          while ((separador = buffer.indexOf('\n\n')) >= 0) {
            const evento = buffer.slice(0, separador);
            buffer = buffer.slice(separador + 2);
            if (evento.includes('event: ' + nome + '\n')) {
              const dados = evento.split('\n').find(linha => linha.startsWith('data: '));
              if (dados) return JSON.parse(dados.slice(6));
            }
          }
          const chunk = await reader.read();
          if (chunk.done) return null;
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      } catch (erro) { if (controller.signal.aborted) return null; throw erro; }
      finally { clearTimeout(timer); }
    };
    return { proximo, controller };
  };
  const request = async (url: string, method = 'GET', body?: unknown) => {
    const resposta = await fetch('http://127.0.0.1:' + porta + '/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: resposta.status, json: await resposta.json() as any };
  };
  try {
    const [esp]: any = await pool.query('INSERT INTO especialidade (nome) VALUES (?)', ['Verificação ' + randomUUID()]);
    const [proc]: any = await pool.query('INSERT INTO procedimento (id_especialidade, nome, duracao_minutos, preco) VALUES (?, ?, 60, 200)', [esp.insertId, 'Consulta de verificação']);
    const [proc2]: any = await pool.query('INSERT INTO procedimento (id_especialidade, nome, duracao_minutos, preco) VALUES (?, ?, 30, 100)', [esp.insertId, 'Segundo procedimento']);
    const [prof]: any = await pool.query('INSERT INTO profissional (nome) VALUES (?)', ['Profissional de verificação']);
    const profId = prof.insertId;
    const uuid = randomUUID();
    await pool.query('INSERT INTO paciente (uuid, nome) VALUES (?, ?)', [uuid, 'Paciente fictício de verificação']);
    await pool.query('INSERT INTO profissional_procedimento (id_profissional, id_procedimento) VALUES (?, ?)', [profId, proc.insertId]);
    const futuro = new Date();
    futuro.setUTCDate(futuro.getUTCDate() + 14);
    while (futuro.getUTCDay() !== 1) futuro.setUTCDate(futuro.getUTCDate() + 1);
    const data = futuro.toISOString().slice(0, 10);
    const reserva = { paciente_id: uuid, profissional_id: profId, servico_id: proc.insertId, data, horario_inicio: '09:00' };
    const excepcional = { ...reserva, data: '2040-02-07', confirmarFechamento: true };
    await pool.query("INSERT INTO excecao_disponibilidade(data,tipo_excecao,motivo) VALUES (?,'Fechado','Feriado de teste')",[excepcional.data]);
    assert((await request('/agendamentos','POST',excepcional)).status === 409,'Fechamento global impede reserva comum mesmo com confirmação');
    operador.perfil = 'PROFISSIONAL';
    assert((await request('/agendamentos','POST',excepcional)).status === 403,'Profissional não reserva em agenda de terceiro');
    operador.profissional_id = profId;
    assert((await request('/agendamentos','POST',{...excepcional,confirmarFechamento:false})).status === 403,'Reserva excepcional exige confirmação explícita');
    assert((await request('/agendamentos','POST',{...excepcional,data})).status === 409,'Profissional não agenda por exceção em dia aberto');
    const especial = await request('/agendamentos','POST',excepcional);
    assert(especial.status === 201,'Profissional confirma reserva excepcional no feriado');
    assert((await request('/agendamentos','POST',excepcional)).status === 409,'Exceção mantém controle de conflito');
    const rotaPaciente = '/pacientes/' + uuid;
    const rotaStatus = '/agendamentos/' + especial.json.dados.id + '/status';
    assert((await request(rotaPaciente)).status === 404 &&
      (await request(rotaPaciente, 'PUT', { versao: 0, observacoes: 'Paciente fictício' })).status === 404,
      'Reserva excepcional própria ainda não concede acesso ao prontuário');
    assert((await request(rotaStatus, 'PUT', { status: 'Na Recepção' })).status === 403,
      'Autoria da reserva excepcional não valida a chegada do paciente');
    operador.profissional_id = 0;
    const janelaTerceiro = await request('/disponibilidade?data=' + excepcional.data + '&profissional_id=' + profId + '&servico_id=' + proc.insertId);
    const agendaTerceiro = await request('/profissionais/' + profId + '/agenda?data=' + excepcional.data);
    const diarioTerceiro = await request('/agendamentos/dia?data=' + excepcional.data);
    assert(janelaTerceiro.json.ocupados?.some((horario: any) => horario.id === especial.json.dados.id && !('paciente_nome' in horario) && !('servico_nome' in horario)) &&
      [agendaTerceiro, diarioTerceiro].every(agenda => agenda.json.dados?.some((item: any) => item.id === especial.json.dados.id &&
        item.paciente_id === null && item.paciente_nome === 'Horário ocupado' && item.servico_nome === '')),
      'Profissional vê ocupação sem dados de pacientes nas três consultas de outras agendas');
    const fluxoPreparacao = await abrirFluxo();
    await fluxoPreparacao.proximo('pronto');
    operador.perfil = 'RECEPCAO';
    assert((await request(rotaStatus, 'PUT', { status: 'Na Recepção' })).status === 200, 'Recepção valida a chegada da reserva excepcional');
    await fluxoPreparacao.proximo('alteracao');
    operador.perfil = 'PROFISSIONAL';
    operador.profissional_id = profId;
    assert((await request(rotaPaciente)).status === 200, 'Check-in da recepção concede acesso ao prontuário do atendimento próprio');
    const especialId = especial.json.dados.id;
    await pool.query('UPDATE agendamento SET checkin_recepcao = 0 WHERE id_agendamento = ?', [especialId]);
    assert((await request(rotaStatus, 'PUT', { validarChegada: true })).status === 403 &&
      (await request(rotaPaciente)).status === 404,
      'Profissional não valida nem consulta prontuário de reserva excepcional legada pendente');
    operador.perfil = 'RECEPCAO';
    const agendaLegada = await request('/agendamentos/dia?data=' + excepcional.data);
    assert(agendaLegada.json.dados.some((item: any) => item.id === especialId && item.exige_validacao_chegada === 1),
      'Agenda indica reserva excepcional legada pendente à recepção');
    const [antesChegada] = await pool.query<any[]>('SELECT data_hora_checkin FROM agendamento WHERE id_agendamento = ?', [especialId]);
    const validacaoChegada = await request(rotaStatus, 'PUT', { validarChegada: true });
    await fluxoPreparacao.proximo('alteracao');
    const repeticaoChegada = await request(rotaStatus, 'PUT', { validarChegada: true });
    const revisaoNaValidacao = await fluxoPreparacao.proximo('alteracao', 350);
    assert(revisaoNaValidacao === null, 'Repetir a validação de chegada não emite um novo aviso');
    const [depoisChegada] = await pool.query<any[]>(`SELECT a.status, a.data_hora_checkin, a.checkin_recepcao,
      (SELECT COUNT(*) FROM historico_status_agendamento h WHERE h.id_agendamento = a.id_agendamento
        AND h.status_anterior = 'Na Recepção' AND h.status_novo = 'Na Recepção'
        AND h.id_usuario = ? AND h.motivo = 'Chegada validada pela recepção') AS validacoes
      FROM agendamento a WHERE a.id_agendamento = ?`, [operador.id, especialId]);
    assert(validacaoChegada.status === 200 && repeticaoChegada.status === 200 &&
      validacaoChegada.json.dados.status === 'Na Recepção' && depoisChegada[0].status === 'Na Recepção' &&
      depoisChegada[0].checkin_recepcao === 1 && depoisChegada[0].validacoes === 1 &&
      String(antesChegada[0].data_hora_checkin) === String(depoisChegada[0].data_hora_checkin),
      'Recepção valida chegada legada uma vez, com autoria e sem alterar status ou horário');
    operador.perfil = 'PROFISSIONAL';
    assert((await request(rotaPaciente)).status === 200, 'Validação da chegada legada libera o prontuário da agenda própria');
    operador.perfil = 'RECEPCAO';
    const fluxoCancelamento = await abrirFluxo();
    await fluxoCancelamento.proximo('pronto');
    const cancelamentoExcepcional = await request(rotaStatus, 'PUT', { status: 'Cancelado' });
    const avisoCancelamento = await fluxoCancelamento.proximo('alteracao');
    assert(cancelamentoExcepcional.status === 200 && avisoCancelamento?.recursos.includes('agendamentos'),
      'Cancelamento real notifica a agenda após validação de chegada');
    fluxoCancelamento.controller.abort();
    const [paginaAgenda, paginaDashboard] = await Promise.all([abrirFluxo(), abrirFluxo()]);
    const [inicioAgenda, inicioDashboard] = await Promise.all([paginaAgenda.proximo('pronto'), paginaDashboard.proximo('pronto')]);
    assert(inicioAgenda?.versao === inicioDashboard?.versao, 'Abas independentes iniciam com a mesma revisão da API');
    const concorrentes = await Promise.all([request('/agendamentos', 'POST', reserva), request('/agendamentos', 'POST', reserva)]);
    assert(concorrentes.filter(r => r.status === 201).length === 1 && concorrentes.filter(r => r.status === 409).length === 1, 'Duas reservas simultâneas geram uma reserva e um conflito');
    const id = concorrentes.find(r => r.status === 201)!.json.dados.id;
    const [avisoAgenda, avisoDashboard] = await Promise.all([paginaAgenda.proximo('alteracao'), paginaDashboard.proximo('alteracao')]);
    assert(avisoAgenda?.versao === avisoDashboard?.versao && avisoAgenda?.recursos[0] === 'agendamentos', 'Uma gravação concluída notifica todas as páginas conectadas');
    assert(!JSON.stringify(avisoAgenda).includes(uuid) && Object.keys(avisoAgenda || {}).every(k => ['versao', 'recursos'].includes(k)), 'Avisos de atualização não expõem pacientes ou conteúdo dos registros');
    const semAlteracoes = await abrirFluxo();
    await semAlteracoes.proximo('pronto');
    const reservaRejeitada = await request('/agendamentos', 'POST', { ...reserva, horario_inicio: '12:00' });
    const consultaServicos = await request('/servicos');
    assert(reservaRejeitada.status === 409 && consultaServicos.status === 200 &&
      await semAlteracoes.proximo('alteracao', 300) === null,
      'Operação rejeitada e consultas de leitura não emitem avisos de alteração');
    const gradeClinica = { dia_semana:1, ativo:true, horario_inicio:'09:00', horario_fim:'17:00', intervalo_inicio:'14:00', intervalo_fim:'15:00' };
    assert((await request('/expediente-clinica','PUT',gradeClinica)).status === 200,'Configuração da grade semanal da clínica no banco de teste');
    const janelasClinica = await request('/disponibilidade?data='+data+'&servico_id='+proc.insertId+'&profissional_id='+profId);
    const livresClinica: string[] = janelasClinica.json.dados.filter((s: {disponivel:boolean})=>s.disponivel).map((s: {horario:string})=>s.horario);
    assert(livresClinica.includes('10:30') && !livresClinica.includes('08:00') && !livresClinica.includes('12:00') && !livresClinica.includes('14:00'),'Disponibilidade cruza abertura, pausa da clínica e pausa individual');
    await pool.query('DELETE FROM expediente_clinica WHERE dia_semana=1');
    const [gravados]: any = await pool.query('SELECT a.*, p.id_paciente AS esperado FROM agendamento a JOIN paciente p ON p.uuid = a.paciente_uuid WHERE a.id_agendamento = ?', [id]);
    assert(gravados[0].id_paciente === gravados[0].esperado, 'UUID e identificador numérico do paciente permanecem coerentes');
    assert((await request('/agendamentos', 'POST', { ...reserva, horario_inicio: '12:00' })).status === 409, 'Criação respeita intervalo de almoço');
    assert((await request('/agendamentos', 'POST', { ...reserva, horario_inicio: '17:00' })).status === 409, 'O respiro também precisa caber no expediente');
    const disponibilidade = await request('/disponibilidade?data=' + data + '&servico_id=' + proc.insertId + '&profissional_id=' + profId);
    assert(disponibilidade.status === 200 && !disponibilidade.json.dados.some((d: any) => d.horario === '12:00'), 'Consulta e criação usam o mesmo intervalo de almoço');
    assert(disponibilidade.json.dados.find((d: any) => d.horario === '09:00')?.disponivel === false, 'Disponibilidade mostra o horário recém-reservado como ocupado');
    assert(disponibilidade.json.dados.find((d: any) => d.horario === '14:00')?.disponivel === true, 'Consulta apresenta o horário livre compatível com a duração');
    const [aposConsulta]: any = await pool.query('SELECT COUNT(*) AS total FROM agendamento WHERE id_profissional = ? AND data = ?', [profId, data]);
    assert(Number(aposConsulta[0].total) === 1, 'Consultar horários não cria reserva');
    const jornada = await request('/profissionais/' + profId + '/jornada', 'PUT', { dias: [{ dia_semana: 1, ativo: 1, horario_inicio: '10:00', horario_fim: '18:00', intervalo_inicio: null, intervalo_fim: null }] });
    assert(jornada.status === 409, 'Jornada que invalida uma reserva é rejeitada');
    const [dias]: any = await pool.query('SELECT * FROM jornada_profissional WHERE id_profissional = ?', [profId]);
    assert(dias.length === 0, 'Jornada rejeitada é desfeita integralmente');
    const excecao = await request('/excecoes', 'POST', { data, id_profissional: profId, tipo_excecao: 'Fechado', motivo: 'Verificação' });
    assert(excecao.status === 409, 'Fechamento com atendimento reservado é rejeitado');
    const [excecoes]: any = await pool.query('SELECT * FROM excecao_disponibilidade WHERE id_profissional = ?', [profId]);
    assert(excecoes.length === 0, 'Exceção rejeitada não permanece no banco');
    const proximoDia = new Date(data + 'T12:00:00Z'); proximoDia.setUTCDate(proximoDia.getUTCDate() + 1);
    const fechado = proximoDia.toISOString().slice(0, 10);
    assert((await request('/excecoes', 'POST', { data: fechado, id_profissional: profId, tipo_excecao: 'Fechado', motivo: 'Verificação' })).status === 201, 'Fechamento válido é gravado');
    assert((await request('/agendamentos', 'POST', { ...reserva, data: fechado })).status === 409, 'Uma chamada direta não contorna o fechamento');
    const semHorarios = await request('/disponibilidade?data=' + fechado + '&servico_id=' + proc.insertId + '&profissional_id=' + profId);
    assert(semHorarios.status === 200 && semHorarios.json.dados.length === 0, 'Consulta de dia fechado retorna lista vazia');
    assert((await request('/agendamentos/' + id + '/reagendar', 'PUT', { data, horario_inicio: '11:00' })).status === 409, 'Reagendamento também respeita o intervalo e o respiro');
    assert((await request('/agendamentos/' + id + '/reagendar', 'PUT', { data, horario_inicio: '14:00', motivo: 'Mudança de teste' })).status === 200, 'Reagendamento válido é efetivado');
    const [historico]: any = await pool.query('SELECT * FROM historico_status_agendamento WHERE id_agendamento = ? ORDER BY id_historico', [id]);
    assert(historico.length === 2 && historico[0].tipo_evento === 'CRIACAO' && historico[1].motivo === 'Mudança de teste', 'Histórico preserva a criação e registra o reagendamento uma única vez');
    await pool.query('UPDATE agendamento SET data_hora_checkin = NOW() WHERE id_agendamento = ?', [id]);
    assert((await request('/agendamentos/' + id + '/reagendar', 'PUT', { data, horario_inicio: '13:00' })).status === 200, 'Segundo reagendamento registrado mesmo mantendo o status');
    const [[mudanca]]: any = await pool.query(`SELECT TIME_FORMAT(h.ocorrencia_anterior,'%H:%i') AS anterior,
      TIME_FORMAT(h.ocorrencia_nova,'%H:%i') AS nova, a.data_hora_checkin AS checkin
      FROM historico_status_agendamento h JOIN agendamento a USING(id_agendamento)
      WHERE h.id_agendamento = ? ORDER BY id_historico DESC LIMIT 1`, [id]);
    assert(mudanca.anterior === '14:00' && mudanca.nova === '13:00' && mudanca.checkin === null,
      'Reagendamento registra o horário anterior e o novo e limpa o check-in antigo');
    await pool.query("CREATE TRIGGER falha_historico_teste BEFORE INSERT ON historico_status_agendamento FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falha de auditoria simulada'");
    try {
      assert((await request('/agendamentos/' + id + '/reagendar', 'PUT', { data, horario_inicio: '14:00' })).status === 500, 'Falha ao gravar o histórico interrompe o reagendamento');
      const [horario]: any = await pool.query("SELECT TIME_FORMAT(horario_inicio,'%H:%i') AS hora FROM agendamento WHERE id_agendamento = ?", [id]);
      assert(horario[0].hora === '13:00', 'Rollback do reagendamento preserva o horário anterior');
    } finally { await pool.query('DROP TRIGGER falha_historico_teste'); }
    await pool.query("CREATE TRIGGER falha_vinculo_teste BEFORE INSERT ON profissional_procedimento FOR EACH ROW BEGIN IF NEW.id_procedimento = " + proc2.insertId + " THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falha controlada'; END IF; END");
    try {
      assert((await request('/profissionais/' + profId + '/procedimentos', 'PUT', { procedimentos: [proc2.insertId] })).status === 500, 'Falha controlada no meio da substituição retorna erro');
      const [vinculos]: any = await pool.query('SELECT * FROM profissional_procedimento WHERE id_profissional = ?', [profId]);
      assert(vinculos.length === 1 && vinculos[0].id_procedimento === proc.insertId, 'Falha após excluir vínculos restaura os vínculos anteriores');
    } finally { await pool.query('DROP TRIGGER falha_vinculo_teste'); }
    try { await transacaoAgenda([profId], async c => { await c.query('UPDATE profissional SET nome = ? WHERE id_profissional = ?', ['Não persistir', profId]); throw new Error('Interrupção esperada'); }); } catch { /* Falha esperada para verificar rollback. */ }
    const [profs]: any = await pool.query('SELECT nome FROM profissional WHERE id_profissional = ?', [profId]);
    assert(profs[0].nome === 'Profissional de verificação', 'Uma transação interrompida não deixa alteração parcial');
    const bloqueio = await request('/bloqueios', 'POST', { profissional_id: profId, data, horario_inicio: '16:00', horario_fim: '17:00', motivo: 'Verificação' });
    assert(bloqueio.status === 201, 'Bloqueio livre é criado');
    const aposBloqueio = await request('/disponibilidade?data=' + data + '&servico_id=' + proc.insertId + '&profissional_id=' + profId);
    assert(aposBloqueio.json.dados.find((s: any) => s.horario === '16:00')?.disponivel === false, 'Consulta identifica um horário bloqueado');
    assert((await request('/agendamentos', 'POST', { ...reserva, horario_inicio: '16:00' })).status === 409, 'Reserva não contorna um bloqueio');
    assert((await request('/bloqueios/' + bloqueio.json.dados.id, 'DELETE')).status === 200, 'Remoção do bloqueio usa o identificador correto da tabela');
    assert((await request('/agendamentos/' + id + '/status', 'PUT', { status: 'Cancelado' })).status === 200, 'Cancelamento é registrado');
    assert((await request('/agendamentos/' + id + '/status', 'PUT', { status: 'Confirmado' })).status === 409, 'Alteração direta de status não reativa um cancelamento');
    await pool.query("UPDATE historico_status_agendamento SET data_alteracao = '2026-01-01 00:00:00' WHERE id_agendamento = ?", [id]);
    const consultaHistorico = await request('/agendamentos/' + id + '/historico');
    const eventos = consultaHistorico.json.dados.historico;
    assert(eventos.map((e: any) => e.tipo_evento).join() === 'CANCELAMENTO,REAGENDAMENTO,REAGENDAMENTO,CRIACAO', 'Empate de timestamp preserva ordem determinística e cada alteração efetiva aparece uma vez');
    assert(eventos.every((e: any) => e.id_usuario === operador.id && e.alterado_por === operador.nome), 'Eventos preservam identificador e nome do operador da sessão');
    const cpf = '52998224725';
    const cadastro = { nome_completo:'Paciente regressão', cpf, telefone:'11912345678', endereco:'Endereço fictício' };
    const criado = await request('/pacientes','POST',cadastro);
    const pacienteId = criado.json.dados.id;
    await pool.query("UPDATE paciente SET historico_clinico='Preservar', etapa_tratamento='Tratamento', atendimento_status='Humano' WHERE uuid=?",[pacienteId]);
    assert((await request('/pacientes/'+pacienteId,'PUT',{...cadastro,versao:0})).status === 200, 'Edição de cadastro aceita');
    assert((await request('/pacientes/'+pacienteId,'PUT',{...cadastro,versao:0})).status === 409, 'Edição antiga não sobrescreve uma alteração recente');
    const [preservado]: any = await pool.query('SELECT * FROM paciente WHERE uuid=?',[pacienteId]);
    assert(preservado[0].historico_clinico === 'Preservar' && preservado[0].etapa_tratamento === 'Tratamento' && preservado[0].atendimento_status === 'Humano', 'Cadastro preserva dados clínicos não enviados');
    assert(preservado[0].data_nascimento === null, 'Nascimento não informado permanece ausente');
    assert((await request('/pacientes/rapido','POST',{nome_completo:'Outro',whatsapp:'21912345678',cpf})).status === 409,'Pré-cadastro rejeita CPF duplicado');
    assert((await request('/pacientes/rapido','POST',{nome_completo:'Outro',whatsapp:'21912345678',cpf:'11111111111'})).status === 400,'Pré-cadastro rejeita CPF inválido');
    const pessoaA = await request('/pacientes/rapido','POST',{nome_completo:'Pessoa A',whatsapp:'11987654321'});
    const pessoaB = await request('/pacientes/rapido','POST',{nome_completo:'Pessoa B',whatsapp:'21987654321'});
    assert(pessoaA.status === 201 && pessoaB.status === 201 && pessoaA.json.dados.id !== pessoaB.json.dados.id,'Telefones com sufixo igual não colidem');
    assert((await request('/servicos/'+proc.insertId+'/status','PATCH',{})).status === 400,'Status ausente não inativa serviço');
    assert((await request('/servicos','POST',{categoria_id:esp.insertId,nome:'Invalido',preco:'200abc',duracao_minutos:'60abc'})).status === 400,'Números malformados rejeitados');
    const anotado = await request('/agendamentos','POST',{...reserva,observacoes:'Nota fictícia',tipo_atendimento:'Retorno'});
    assert(anotado.status === 201,'Nova reserva após cancelamento aceita');
    const [nota]: any = await pool.query('SELECT observacoes,tipo_atendimento FROM agendamento WHERE id_agendamento=?',[anotado.json.dados.id]);
    assert(nota[0].observacoes === 'Nota fictícia' && nota[0].tipo_atendimento === 'Retorno','Observações e tipo de atendimento persistidos');
    assert((await request('/profissionais/'+profId+'/status','PATCH',{ativo:0})).status === 409,'Profissional com reserva não desaparece da grade');
    const [outroProf]: any = await pool.query("INSERT INTO profissional(nome) VALUES ('Outro profissional fictício')");
    await pool.query('INSERT INTO profissional_procedimento(id_profissional,id_procedimento) VALUES (?,?)',[outroProf.insertId,proc.insertId]);
    assert((await request('/agendamentos','POST',{...reserva,profissional_id:outroProf.insertId})).status === 409,'Paciente não ocupa dois profissionais simultaneamente');
    let intervaloRejeitado = false;
    try { await pool.query('UPDATE agendamento SET data_hora_agendamento=TIMESTAMP(data, ?) WHERE id_agendamento=?',['11:00',anotado.json.dados.id]); } catch { intervaloRejeitado = true; }
    assert(intervaloRejeitado,'Gatilho rejeita término anterior ao novo início');
    await (await import('../services/capacidadeAgenda.js')).registrarCapacidadeHoje();
    await pool.query(`INSERT INTO sessao_chatbot(identificador_chat, data_hora_inicio, status_sessao) VALUES
      (?, CURDATE() - INTERVAL 729 DAY, 'Abandonada'), (?, CURDATE() - INTERVAL 730 DAY, 'Abandonada'),
      (?, CURDATE() + INTERVAL 1 DAY, 'Abandonada')`, [randomUUID(), randomUUID(), randomUUID()]);
    const painel = await request('/dashboard/dados-painel');
    assert(painel.status === 200 && Array.isArray(painel.json.CA) && Array.isArray(painel.json.CHAT), 'Dashboard entrega capacidade e conversas provenientes do banco');
    assert(painel.json.CHAT.some((c: { d: number }) => c.d === 729) && painel.json.AB[729] > 0 &&
      painel.json.CHAT.every((c: { d: number }) => c.d >= 0 && c.d < 730), 'Funil do chatbot respeita os mesmos 730 dias dos indicadores');
    assert(painel.json.CA.some((c: any) => c.sp === -1), 'Capacidade total não depende de proporções fixas');
    const queryOriginal = pool.query;
    let falha;
    try {
      pool.query = (() => Promise.reject(Object.assign(new Error('Interrupção de teste'), { code: 'ECONNREFUSED' }))) as typeof pool.query;
      falha = await request('/profissionais/' + profId + '/agenda?data=' + data);
    } finally { pool.query = queryOriginal; }
    assert(falha.status === 503 && !falha.json.sucesso && !falha.json.dados, 'Falha do banco retorna indisponibilidade sem agenda simulada');
    const reconectada = await abrirFluxo();
    const retomada = await reconectada.proximo('pronto');
    assert(retomada?.versao !== inicioAgenda?.versao && retomada?.recursos.length === 0, 'Reconexão solicita leitura completa e recupera alterações perdidas');
    await pool.query(`INSERT INTO revisao_clinica(recurso, revisao) VALUES ('pacientes', 1)
      ON DUPLICATE KEY UPDATE revisao = revisao + 1`);
    let notificouInstanciaRemota = false;
    for (let tentativa = 0; tentativa < 12 && !notificouInstanciaRemota; tentativa++) {
      const aviso = await reconectada.proximo('alteracao', 4500);
      if (!aviso) break;
      notificouInstanciaRemota = aviso.recursos.includes('pacientes');
    }
    assert(notificouInstanciaRemota, 'Alteração compartilhada pelo banco chega a uma aba sem depender do processo que gravou');
    operador.perfil = 'PROFISSIONAL';
    const novaExcecao = await request('/agendamentos', 'POST', excepcional);
    operador.perfil = 'RECEPCAO';
    const diaComum = new Date(futuro);
    diaComum.setUTCDate(diaComum.getUTCDate() + 14);
    const novaData = diaComum.toISOString().slice(0, 10);
    const destinoComum = await request('/agendamentos/' + novaExcecao.json.dados?.id + '/reagendar', 'PUT', { data: novaData, horario_inicio: '09:00' });
    assert(novaExcecao.status === 201 && destinoComum.status === 200 &&
      (await request('/excecoes', 'POST', { data: novaData, id_profissional: profId, tipo_excecao: 'Fechado', motivo: 'Verificação' })).status === 409,
      'Autorização excepcional da ocorrência original não libera o fechamento da nova data');
    await pool.query('UPDATE procedimento SET ativo = 0 WHERE id_procedimento = ?', [proc2.insertId]);
    await pool.query('INSERT IGNORE INTO profissional_procedimento (id_profissional, id_procedimento) VALUES (?, ?)', [profId, proc2.insertId]);
    const atualizarVinculos = (profissional: number) => request(`/profissionais/${profissional}/procedimentos`, 'PUT', { procedimentos: [proc.insertId, proc2.insertId] });
    assert((await atualizarVinculos(profId)).status === 200 && (await atualizarVinculos(outroProf.insertId)).status === 400,
      'Edição de vínculos preserva procedimento já vinculado e não cria novo vínculo inativo');
    return { pass, fail: 0 };
  } finally {
    fluxos.forEach(controller => controller.abort());
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
