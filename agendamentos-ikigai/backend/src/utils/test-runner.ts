import { validarRegraAgendamento, validarHorarioExpediente, obterNomeDiaSemana } from './validation.js';

interface CasoTeste {
  descricao: string;
  data: Date;
  tipo: string;
  esperado: boolean;
}

const casosDias: CasoTeste[] = [
  // Segunda-feira (Permite qualquer serviço)
  {
    descricao: "Segunda-feira com Consulta (Válido)",
    data: new Date('2026-06-15T10:00:00'),
    tipo: 'Consulta',
    esperado: true
  },
  {
    descricao: "Segunda-feira com Retorno (Válido)",
    data: new Date('2026-06-15T14:00:00'),
    tipo: 'Retorno',
    esperado: true
  },
  
  // Terça-feira (Permite qualquer serviço)
  {
    descricao: "Terça-feira com Retorno (Válido)",
    data: new Date('2026-06-16T09:00:00'),
    tipo: 'Retorno',
    esperado: true
  },
  {
    descricao: "Terça-feira com Procedimento (Válido)",
    data: new Date('2026-06-16T11:00:00'),
    tipo: 'Procedimento',
    esperado: true
  },

  // Quarta-feira (Permite qualquer serviço)
  {
    descricao: "Quarta-feira com Procedimento (Válido)",
    data: new Date('2026-06-17T15:30:00'),
    tipo: 'Procedimento',
    esperado: true
  },
  
  // Quinta-feira (Permite qualquer serviço)
  {
    descricao: "Quinta-feira com Consulta (Válido)",
    data: new Date('2026-06-18T16:00:00'),
    tipo: 'Consulta',
    esperado: true
  },

  // Sexta-feira (Permite qualquer serviço)
  {
    descricao: "Sexta-feira com Retorno (Válido)",
    data: new Date('2026-06-19T08:00:00'),
    tipo: 'Retorno',
    esperado: true
  },

  // Sábado (Fechado - Bloqueado)
  {
    descricao: "Sábado com Procedimento (Bloqueado)",
    data: new Date('2026-06-20T10:00:00'),
    tipo: 'Procedimento',
    esperado: false
  },
  {
    descricao: "Sábado com Consulta (Bloqueado)",
    data: new Date('2026-06-20T12:00:00'),
    tipo: 'Consulta',
    esperado: false
  },

  // Domingo (Fechado - Bloqueado)
  {
    descricao: "Domingo com Consulta (Bloqueado)",
    data: new Date('2026-06-14T10:00:00'),
    tipo: 'Consulta',
    esperado: false
  },
  {
    descricao: "Domingo com Retorno (Bloqueado)",
    data: new Date('2026-06-14T14:00:00'),
    tipo: 'Retorno',
    esperado: false
  }
];

const casosHorario = [
  {
    descricao: "Horário 08:00 com 60 min (Válido)",
    horario: "08:00",
    duracao: 60,
    esperado: true
  },
  {
    descricao: "Horário 17:00 com 60 min (Termina às 18:00 - Válido)",
    horario: "17:00",
    duracao: 60,
    esperado: true
  },
  {
    descricao: "Horário 07:30 (Antes das 08:00 - Bloqueado)",
    horario: "07:30",
    duracao: 60,
    esperado: false
  },
  {
    descricao: "Horário 17:30 com 60 min (Passa das 18:00 - Bloqueado)",
    horario: "17:30",
    duracao: 60,
    esperado: false
  },
  {
    descricao: "Horário 18:30 (Depois das 18:00 - Bloqueado)",
    horario: "18:30",
    duracao: 30,
    esperado: false
  }
];

function executarTestes() {
  console.log("================================================================");
  console.log("🧪 INICIANDO TESTES: REGRAS OPERACIONAIS IKIGAI (SEG-SEX, 08H-18H)");
  console.log("================================================================");

  let passados = 0;
  let falhados = 0;

  console.log("\n--- TESTES DE DIAS (Segunda a Sexta) ---");
  casosDias.forEach((caso, index) => {
    const obtido = validarRegraAgendamento(caso.data, caso.tipo);
    const passou = obtido === caso.esperado;

    if (passou) {
      passados++;
      console.log(`✅ [PASSOU] Caso #${index + 1}: ${caso.descricao}`);
    } else {
      falhados++;
      console.log(`❌ [FALHOU] Caso #${index + 1}: ${caso.descricao}`);
    }
  });

  console.log("\n--- TESTES DE HORÁRIO (08:00 às 18:00) ---");
  casosHorario.forEach((caso, index) => {
    const res = validarHorarioExpediente(caso.horario, caso.duracao);
    const passou = res.valido === caso.esperado;

    if (passou) {
      passados++;
      console.log(`✅ [PASSOU] Caso Horário #${index + 1}: ${caso.descricao}`);
    } else {
      falhados++;
      console.log(`❌ [FALHOU] Caso Horário #${index + 1}: ${caso.descricao}`);
    }
  });

  console.log("\n================================================================");
  console.log("RESUMO DA EXECUÇÃO");
  console.log("================================================================");
  console.log(`🎉 Sucessos: ${passados}`);
  console.log(`🚨 Falhas: ${falhados}`);
  console.log(`📈 Taxa de Sucesso: ${((passados / (passados + falhados)) * 100).toFixed(2)}%`);
  console.log("================================================================");

  if (falhados > 0) {
    process.exit(1);
  }
}

executarTestes();
