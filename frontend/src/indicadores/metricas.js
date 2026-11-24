function percentual(numerador, denominador) {
  return denominador > 0 ? numerador / denominador * 100 : null;
}

export function indexarCapacidade(registros) {
  const porEspecialidade = new Map();
  for (const { d, sp, minutos } of registros) {
    if (!Number.isInteger(d) || !Number.isInteger(sp) || !Number.isFinite(minutos) || minutos < 0) continue;
    if (!porEspecialidade.has(sp)) porEspecialidade.set(sp, new Map());
    porEspecialidade.get(sp).set(d, minutos);
  }
  return porEspecialidade;
}

export function contarDiasDeFuncionamento(inicio, fim, capacidadeDiaria, datasComAgendamentos, diaDaSemana) {
  let dias = 0;
  for (let dia = inicio; dia < fim; dia++) {
    const minutos = capacidadeDiaria?.get(dia);
    if (datasComAgendamentos.has(dia) || (minutos === undefined ? diaDaSemana(dia) !== 0 : minutos > 0)) dias++;
  }
  return dias;
}

export function calcularOcupacao(agendamentos, capacidadeDiaria, inicio, fim, diaDaSemana) {
  const grupos = Array.from({ length: 7 }, () => ({ capacidade: 0, ocupados: 0 }));
  let capacidade = 0;
  let completo = fim > inicio;
  for (let dia = inicio; dia < fim; dia++) {
    const disponiveis = capacidadeDiaria?.get(dia);
    if (disponiveis === undefined) {
      completo = false;
    } else {
      capacidade += disponiveis;
      grupos[diaDaSemana(dia)].capacidade += disponiveis;
    }
  }
  let ocupados = 0;
  for (const agendamento of agendamentos) {
    if (agendamento.s === 'C' || !Number.isFinite(agendamento.minutos) || agendamento.minutos < 0) continue;
    ocupados += agendamento.minutos;
    grupos[diaDaSemana(agendamento.d)].ocupados += agendamento.minutos;
  }
  const taxa = (usados, disponiveis) => percentual(Math.min(usados, disponiveis), disponiveis);
  return {
    ocupados,
    capacidade: completo ? capacidade : null,
    ociosos: completo ? Math.max(0, capacidade - ocupados) : null,
    taxa: completo ? taxa(ocupados, capacidade) : null,
    porDiaDaSemana: grupos.map(grupo => completo ? taxa(grupo.ocupados, grupo.capacidade) : null),
  };
}

export function atendimentosComAtrasoRegistrado(agendamentos) {
  return agendamentos.filter(x => x.s === 'R' && Number(x.atraso_registrado) === 1 && Number.isFinite(x.dl));
}

export function resumirConversas(registros, abandonosPorDia, inicio, fim) {
  const totais = { iniciadas: 0, agendadas: 0, resolvidas: 0, abandonadas: 0 };
  for (const conversa of registros) {
    if (conversa.d < inicio || conversa.d >= fim) continue;
    totais.iniciadas += conversa.iniciadas;
    totais.agendadas += conversa.agendadas;
    totais.resolvidas += conversa.resolvidas;
    totais.abandonadas += abandonosPorDia[conversa.d] ?? 0;
  }
  return {
    ...totais,
    conversao: percentual(totais.agendadas, totais.iniciadas),
    resolucao: percentual(totais.resolvidas, totais.iniciadas),
  };
}
