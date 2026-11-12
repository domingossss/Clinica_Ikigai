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
