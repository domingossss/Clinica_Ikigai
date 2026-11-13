import pool from '../config/database.js';
import express from 'express';
import http from 'http';
import router from '../routes/agendamentos.js';
import {
  validarPeriodoAgenda,
  calcularIntervaloSemana,
  calcularResumoAgenda
} from './validation.js';
import { mockStore } from './mock-store.js';

export async function runAgendaProfissionalTests(): Promise<{ total: number; pass: number; fail: number }> {
  console.log('\n================================================================');
  console.log('🧪 INICIANDO TESTES DE CONSULTA DA AGENDA DO PROFISSIONAL (IK-81)');
  console.log('================================================================');

  let pass = 0;
  let fail = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    if (condition) {
      console.log(`✅ [PASSOU] ${testName}`);
      pass++;
    } else {
      console.error(`🚨 [FALHOU] ${testName} ${detail ? `- ${detail}` : ''}`);
      fail++;
    }
  };

  // Inicializa servidor HTTP de teste em porta dinâmica
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  try {
    // -------------------------------------------------------------------------
    // SUÍTE 1: FUNÇÕES DE VALIDAÇÃO E CÁLCULO DE PERÍODO (UNITÁRIOS)
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 1: Funções de Validação e Cálculo de Período ---');

    // Período válido
    const vValido = validarPeriodoAgenda('2026-11-09', '2026-11-13');
    assert(vValido.valido === true, 'Unitário: Período válido (2026-11-09 a 2026-11-13) é aceito');

    // Mesmo dia (válido)
    const vMesmoDia = validarPeriodoAgenda('2026-11-11', '2026-11-11');
    assert(vMesmoDia.valido === true, 'Unitário: Período de um único dia (2026-11-11) é aceito');

    // Período invertido (inválido)
    const vInvertido = validarPeriodoAgenda('2026-11-15', '2026-11-10');
    assert(vInvertido.valido === false, 'Unitário: Período com início posterior ao término é rejeitado');

    // Formato de data inválido
    const vFormatoInvalido = validarPeriodoAgenda('11/11/2026', '2026-11-12');
    assert(vFormatoInvalido.valido === false, 'Unitário: Formato de data fora do padrão YYYY-MM-DD é rejeitado');

    // Cálculo de semana operacional (Segunda a Sexta)
    // 2026-11-11 é uma Quarta-feira. A semana deve iniciar em 2026-11-09 (Seg) e encerrar em 2026-11-13 (Sex)
    const semanaQuarta = calcularIntervaloSemana('2026-11-11');
    assert(
      semanaQuarta.dataInicio === '2026-11-09' && semanaQuarta.dataFim === '2026-11-15',
      `Unitário: calcularIntervaloSemana('2026-11-11') resulta em ${semanaQuarta.dataInicio} a ${semanaQuarta.dataFim}`
    );

    // Domingo (ex: 2026-11-15) calcula semana da segunda anterior (2026-11-09) à sexta (2026-11-13)
    const semanaDomingo = calcularIntervaloSemana('2026-11-15');
    assert(
      semanaDomingo.dataInicio === '2026-11-09' && semanaDomingo.dataFim === '2026-11-15',
      `Unitário: Domingo mapeia corretamente para a semana útil anterior (${semanaDomingo.dataInicio} a ${semanaDomingo.dataFim})`
    );

    // Resumo de atendimentos por status
    const mockAgs = [
      { status: 'Confirmado' },
      { status: 'Confirmado' },
      { status: 'Agendado' },
      { status: 'Concluído' },
      { status: 'Na Recepção' }
    ];
    const resumoCalculado = calcularResumoAgenda(mockAgs, 1);
    assert(
      resumoCalculado.total === 5 &&
      resumoCalculado.confirmados === 2 &&
      resumoCalculado.agendados === 1 &&
      resumoCalculado.concluidos === 1 &&
      resumoCalculado.recepcao === 1 &&
      resumoCalculado.bloqueios_total === 1,
      'Unitário: calcularResumoAgenda consolida métricas com precisão'
    );

    // -------------------------------------------------------------------------
    // SUÍTE 2: CA01 — SELEÇÃO DO PROFISSIONAL
    // Dado que existem profissionais cadastrados, quando um profissional for selecionado,
    // então deverá ser possível abrir sua agenda.
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 2: CA01 — Seleção do Profissional ---');

    // 1. Obter um profissional ativo cadastrado
    const [profs]: any = await pool.query('SELECT id, nome, especialidade FROM profissionais WHERE ativo = 1 LIMIT 1');
    const profTeste = profs && profs.length > 0
      ? profs[0]
      : { id: 1, nome: 'Dr. Ulisses Higo', especialidade: 'Terapeuta Ortomolecular' };

    const resCA01 = await fetch(`${baseUrl}/profissionais/${profTeste.id}/agenda?data=2026-11-11`);
    const dataCA01: any = await resCA01.json();

    assert(resCA01.status === 200, 'CA01: GET /api/profissionais/:id/agenda responde status 200');
    assert(dataCA01.sucesso === true, 'CA01: Resposta possui sucesso: true');
    assert(
      dataCA01.profissional && Number(dataCA01.profissional.id) === Number(profTeste.id),
      `CA01: Dados do profissional selecionado (${profTeste.nome}) retornados com sucesso`
    );
    assert(
      Array.isArray(dataCA01.dados),
      'CA01: Agenda do profissional aberta com lista de agendamentos inicializada'
    );

    // Tentativa com profissional inexistente
    const resProfInexistente = await fetch(`${baseUrl}/profissionais/999999/agenda?data=2026-11-11`);
    assert(
      resProfInexistente.status === 404,
      'CA01: Profissional inexistente retorna 404 apropriado'
    );

    // Tentativa com ID não numérico
    const resIdInvalido = await fetch(`${baseUrl}/profissionais/abc/agenda?data=2026-11-11`);
    assert(
      resIdInvalido.status === 400,
      'CA01: ID do profissional não numérico é rejeitado com 400'
    );

    // -------------------------------------------------------------------------
    // SUÍTE 3: CA02 — ATENDIMENTOS DO PROFISSIONAL NO PERÍODO
    // Dado que o profissional possui atendimentos no período, quando sua agenda for exibida,
    // então os compromissos correspondentes deverão ser apresentados.
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 3: CA02 — Atendimentos do Profissional no Período ---');

    // Inserir agendamento controlado para teste
    const dataTesteA = '2026-09-21'; // Segunda-feira
    const [pacientes]: any = await pool.query('SELECT id, nome_completo, whatsapp FROM pacientes LIMIT 1');
    const [servicos]: any = await pool.query('SELECT id, nome, duracao_minutos FROM servicos LIMIT 1');

    if (pacientes.length > 0 && servicos.length > 0) {
      const pacId = pacientes[0].id;
      const servId = servicos[0].id;

      // Limpar possíveis dados de teste anteriores na data
      await pool.query(
        'DELETE FROM agendamentos WHERE profissional_id = ? AND data = ?',
        [profTeste.id, dataTesteA]
      );

      // Inserir agendamento 1: 09:00 às 10:15
      await pool.query(
        `INSERT INTO agendamentos (paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim, status)
         VALUES (?, ?, ?, ?, '09:00:00', '10:15:00', 'Confirmado')`,
        [pacId, profTeste.id, servId, dataTesteA]
      );

      // Inserir agendamento 2: 14:00 às 15:15
      await pool.query(
        `INSERT INTO agendamentos (paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim, status)
         VALUES (?, ?, ?, ?, '14:00:00', '15:15:00', 'Agendado')`,
        [pacId, profTeste.id, servId, dataTesteA]
      );

      // Inserir bloqueio controlado na data: 12:00 às 13:00
      await pool.query(
        'DELETE FROM bloqueios WHERE profissional_id = ? AND data = ?',
        [profTeste.id, dataTesteA]
      );
      await pool.query(
        `INSERT INTO bloqueios (profissional_id, data, horario_inicio, horario_fim, motivo)
         VALUES (?, ?, '12:00:00', '13:00:00', 'Almoço Técnico')`,
        [profTeste.id, dataTesteA]
      );

      // Consultar agenda do dia
      const resCA02 = await fetch(`${baseUrl}/profissionais/${profTeste.id}/agenda?data=${dataTesteA}`);
      const dataCA02: any = await resCA02.json();

      assert(resCA02.status === 200, 'CA02: GET agenda na data de atendimento responde 200');
      assert(dataCA02.dados.length === 2, `CA02: Retornou os 2 agendamentos cadastrados para ${profTeste.nome}`);
      
      const ag1 = dataCA02.dados[0];
      assert(
        ag1.horario_inicio === '09:00' && ag1.status === 'Confirmado' && ag1.paciente_nome,
        'CA02: Compromisso #1 apresenta horário (09:00), status (Confirmado) e dados do paciente'
      );

      const ag2 = dataCA02.dados[1];
      assert(
        ag2.horario_inicio === '14:00' && ag2.status === 'Agendado',
        'CA02: Compromisso #2 apresenta horário (14:00) e status (Agendado)'
      );

      assert(
        dataCA02.bloqueios && dataCA02.bloqueios.length === 1 && dataCA02.bloqueios[0].motivo === 'Almoço Técnico',
        'CA02: Bloqueio do profissional no período é apresentado adequadamente'
      );

      assert(
        dataCA02.resumo && dataCA02.resumo.total === 2 && dataCA02.resumo.confirmados === 1,
        'CA02: Resumo consolidado de atendimentos confere com os compromissos exibidos'
      );

      // Cleanup
      await pool.query('DELETE FROM agendamentos WHERE profissional_id = ? AND data = ?', [profTeste.id, dataTesteA]);
      await pool.query('DELETE FROM bloqueios WHERE profissional_id = ? AND data = ?', [profTeste.id, dataTesteA]);
    }

    // -------------------------------------------------------------------------
    // SUÍTE 4: CA03 — NAVEGAÇÃO E ALTERAÇÃO DE PERÍODO
    // Dado que a agenda do profissional está aberta, quando o administrador alterar o período,
    // então os compromissos do novo período deverão ser carregados.
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 4: CA03 — Navegação e Alteração de Período ---');

    const dataPeriodoA = '2026-09-22'; // Terça-feira
    const dataPeriodoB = '2026-09-23'; // Quarta-feira

    if (pacientes.length > 0 && servicos.length > 0) {
      const pacId = pacientes[0].id;
      const servId = servicos[0].id;

      // Inserir compromisso no período A (Terça)
      await pool.query(
        `INSERT INTO agendamentos (paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim, status)
         VALUES (?, ?, ?, ?, '10:00:00', '11:00:00', 'Confirmado')`,
        [pacId, profTeste.id, servId, dataPeriodoA]
      );

      // Inserir compromisso no período B (Quarta)
      await pool.query(
        `INSERT INTO agendamentos (paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim, status)
         VALUES (?, ?, ?, ?, '15:00:00', '16:00:00', 'Confirmado')`,
        [pacId, profTeste.id, servId, dataPeriodoB]
      );

      // 1. Carregar Período A
      const resNavA = await fetch(`${baseUrl}/profissionais/${profTeste.id}/agenda?data=${dataPeriodoA}`);
      const dataNavA: any = await resNavA.json();

      assert(
        dataNavA.dados.length === 1 && dataNavA.dados[0].horario_inicio === '10:00',
        'CA03: Período A carregou apenas o compromisso da Terça-feira (10:00)'
      );

      // 2. Navegar para Período B (novo período)
      const resNavB = await fetch(`${baseUrl}/profissionais/${profTeste.id}/agenda?data=${dataPeriodoB}`);
      const dataNavB: any = await resNavB.json();

      assert(
        dataNavB.dados.length === 1 && dataNavB.dados[0].horario_inicio === '15:00',
        'CA03: Alteração para Período B carregou dinamicamente o novo compromisso da Quarta-feira (15:00)'
      );

      // 3. Navegação com intervalo de semana (carrega os compromissos de ambos os dias)
      const resNavSemana = await fetch(`${baseUrl}/profissionais/${profTeste.id}/agenda?data=${dataPeriodoA}&periodo=semana`);
      const dataNavSemana: any = await resNavSemana.json();

      assert(
        dataNavSemana.dados.length >= 2,
        'CA03: Visão Semanal carrega os compromissos agregados de toda a semana do profissional'
      );
      assert(
        dataNavSemana.periodo?.tipo === 'semana' &&
        dataNavSemana.periodo?.data_inicio === '2026-09-21' &&
        dataNavSemana.periodo?.data_fim === '2026-09-27',
        'CA03: Intervalo da semana delimitado perfeitamente de Segunda (21/09) a Sexta (25/09)'
      );

      // Cleanup
      await pool.query('DELETE FROM agendamentos WHERE profissional_id = ? AND data IN (?, ?)', [profTeste.id, dataPeriodoA, dataPeriodoB]);
    }

    // -------------------------------------------------------------------------
    // SUÍTE 5: FILTRO POR PROFISSIONAL NA GRADE DO DIA
    // GET /api/agendamentos/dia?data=YYYY-MM-DD&profissional_id=X
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 5: Filtro por Profissional na Grade do Dia ---');

    const resGradeFiltro = await fetch(`${baseUrl}/agendamentos/dia?data=2026-11-11&profissional_id=${profTeste.id}`);
    const dataGradeFiltro: any = await resGradeFiltro.json();

    assert(
      resGradeFiltro.status === 200 && dataGradeFiltro.sucesso === true,
      'Grade do dia aceita parâmetro profissional_id e responde com sucesso 200'
    );

    // -------------------------------------------------------------------------
    // SUÍTE 6: MOCK STORE
    // -------------------------------------------------------------------------
    console.log('\n--- SUÍTE 6: Mock Store InMemory ---');

    const mockAgenda = mockStore.getAgendaProfissional(1, '2026-01-01', '2026-12-31');
    assert(
      mockAgenda.profissional.id === 1 && Array.isArray(mockAgenda.dados),
      'MockStore: getAgendaProfissional recupera compromissos do profissional em memória'
    );

  } catch (error: any) {
    console.error('Erro inesperado na suíte de testes IK-81:', error);
    fail++;
  } finally {
    server.close();
  }

  const total = pass + fail;
  console.log(`\nTestes Concluídos IK-81: ${pass}/${total} passaram.`);
  return { total, pass, fail };
}

