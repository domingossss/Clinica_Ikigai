import pool from '../config/database.js';

function parseTimeToMins(timeStr: string): number {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return h * 60 + m;
}

function formatMinsToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}:00`;
}

async function runAvailabilityTests() {
  const [bancos]: any = await pool.query('SELECT DATABASE() AS nome');
  if (!/^ikigai_verificacao_\d+$/.test(String(bancos?.[0]?.nome || ''))) {
    throw new Error('Segurança: test-availability só pode ser executado em banco descartável (ikigai_verificacao_*).');
  }
  console.log("================================================================");
  console.log("🧪 INICIANDO TESTES: MATRIZ DE DISPONIBILIDADE E OVERLAPS");
  console.log("================================================================");

  const testDate = '2026-07-20'; // Segunda-feira (permite Consulta)
  const profissionalId = 1;      // Dr. Ulisses Higo
  const pacienteId = 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d01'; // Carlos Souza (UUID)
  const servicoCurtoId = 3;      // Consulta de Avaliação (60 min)
  const servicoLongoId = 6;      // Cirurgia de Implante (180 min)

  try {
    // 1. Limpar agendamentos de teste
    console.log(`[Setup] Limpando agendamentos do dia ${testDate}...`);
    await pool.query(
      'DELETE FROM agendamentos WHERE data = ? AND profissional_id = ?',
      [testDate, profissionalId]
    );

    // Helper para rodar a lógica da disponibilidade localmente (simulando a API)
    const obterSlotsDisponiveis = async (_servId: number, duracao: number) => {
      const horaInicio = '08:00:00';
      const horaFim = '18:00:00';

      const [agendamentos] = await pool.query(
        'SELECT horario_inicio, horario_fim FROM agendamentos WHERE profissional_id = ? AND data = ? AND status != "Cancelado"',
        [profissionalId, testDate]
      );

      const startMins = parseTimeToMins(horaInicio);
      const endMins = parseTimeToMins(horaFim);
      const slots: string[] = [];

      for (let current = startMins; current + duracao <= endMins; current += 30) {
        const currentStartStr = formatMinsToTime(current);
        const currentEnd = current + duracao + 15; // +15 min buffer

        let overlap = false;
        for (const ag of (agendamentos as any[])) {
          const agStart = parseTimeToMins(ag.horario_inicio);
          const agEnd = parseTimeToMins(ag.horario_fim);

          if (current < agEnd && agStart < currentEnd) {
            overlap = true;
            break;
          }
        }

        if (!overlap) {
          slots.push(currentStartStr.substring(0, 5));
        }
      }

      return slots;
    };

    // 2. Testar agenda livre
    console.log('\n--- Teste 1: Agenda totalmente livre ---');
    const slotsLivre60 = await obterSlotsDisponiveis(servicoCurtoId, 60);
    const slotsLivre180 = await obterSlotsDisponiveis(servicoLongoId, 180);
    
    console.log(`   Slots livres para serviço de 60m: ${slotsLivre60.length} encontrados (Ex: ${slotsLivre60.slice(0, 3).join(', ')}...)`);
    console.log(`   Slots livres para serviço de 180m: ${slotsLivre180.length} encontrados (Ex: ${slotsLivre180.slice(0, 3).join(', ')}...)`);
    
    if (slotsLivre60.includes('14:00') && slotsLivre180.includes('14:00')) {
      console.log('   ✅ PASSOU: Horário das 14:00 está livre para ambos os serviços.');
    } else {
      throw new Error('Falha no Teste 1: 14:00 deveria estar livre.');
    }

    // 3. Criar agendamento às 14:00 de 60min
    // Duração: 60min. Início: 14:00. Término: 15:00. Fim do bloco (+15m buffer): 15:15.
    console.log('\n--- Teste 2: Criando agendamento às 14:00 (60min + 15min buffer) ---');
    const horarioInicio = '14:00:00';
    const horarioFim = '15:15:00'; // 14:00 + 60 min + 15 min buffer
    
    await pool.query(
      `INSERT INTO agendamentos (paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'Agendado')`,
      [pacienteId, profissionalId, servicoCurtoId, testDate, horarioInicio, horarioFim]
    );
    console.log(`   Agendamento inserido: 14:00 às 15:15 (com buffer).`);

    // 4. Testar disponibilidade após agendamento para o serviço curto (60 min)
    console.log('\n--- Teste 3: Disponibilidade para Serviço Curto (60min + 15min buffer) ---');
    const slotsOcupado60 = await obterSlotsDisponiveis(servicoCurtoId, 60);

    // Testar se 14:00 sumiu
    if (!slotsOcupado60.includes('14:00')) {
      console.log('   ✅ PASSOU: Horário das 14:00 sumiu da lista.');
    } else {
      throw new Error('Falha no Teste 3: 14:00 não deveria estar disponível.');
    }

    // Testar se 13:00 sumiu (pois começa 13:00, dura 60m + 15m = acaba 14:15. Overlaps com 14:00)
    if (!slotsOcupado60.includes('13:00')) {
      console.log('   ✅ PASSOU: Horário das 13:00 sumiu devido ao overlap com o agendamento das 14:00.');
    } else {
      throw new Error('Falha no Teste 3: 13:00 deveria sumir por colidir com 14:00.');
    }

    // Testar se 12:30 está disponível (começa 12:30, dura 60m + 15m = acaba 13:45. Não colide com 14:00)
    if (slotsOcupado60.includes('12:30')) {
      console.log('   ✅ PASSOU: Horário das 12:30 está disponível (termina antes do agendamento de início do próximo).');
    } else {
      throw new Error('Falha no Teste 3: 12:30 deveria estar disponível.');
    }

    // Testar se 15:30 está disponível (começa após o fim do bloco)
    if (slotsOcupado60.includes('15:30')) {
      console.log('   ✅ PASSOU: Horário das 15:30 está disponível (inicia após o buffer de respiro do anterior).');
    } else {
      throw new Error('Falha no Teste 3: 15:30 deveria estar disponível.');
    }

    // 5. Testar disponibilidade após agendamento para o serviço longo (180 min)
    console.log('\n--- Teste 4: Disponibilidade para Serviço Longo (180min + 15min buffer) ---');
    const slotsOcupado180 = await obterSlotsDisponiveis(servicoLongoId, 180);

    // Testar se 14:00 sumiu
    if (!slotsOcupado180.includes('14:00')) {
      console.log('   ✅ PASSOU: Horário das 14:00 sumiu.');
    } else {
      throw new Error('Falha no Teste 4: 14:00 não deveria estar disponível.');
    }

    // Testar se 12:00 sumiu (começa 12:00, termina 12:00 + 3h + 15m = 15:15. Colide com 14:00 - 15:15)
    if (!slotsOcupado180.includes('12:00')) {
      console.log('   ✅ PASSOU: Horário das 12:00 sumiu (precisa de 3h15m livres e colidiria com o agendamento).');
    } else {
      throw new Error('Falha no Teste 4: 12:00 deveria sumir por colidir.');
    }

    // Testar se 10:30 está disponível (começa 10:30, termina 10:30 + 3h + 15m = 13:45. Não colide com 14:00)
    if (slotsOcupado180.includes('10:30')) {
      console.log('   ✅ PASSOU: Horário das 10:30 está disponível (cabe perfeitamente antes do das 14:00).');
    } else {
      throw new Error('Falha no Teste 4: 10:30 deveria estar disponível.');
    }

    console.log("\n================================================================");
    console.log("🎉 TODOS OS TESTES PASSARAM COM SUCESSO!");
    console.log("================================================================");
    
    // Limpar após o teste
    await pool.query(
      'DELETE FROM agendamentos WHERE data = ? AND profissional_id = ?',
      [testDate, profissionalId]
    );
    process.exit(0);

  } catch (err: any) {
    console.error('\n🚨 FALHA NOS TESTES DE INTEGRAÇÃO:', err.message);
    process.exit(1);
  }
}

runAvailabilityTests();
