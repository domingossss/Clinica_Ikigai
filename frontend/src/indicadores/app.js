import {
  apagarRespostasPesquisa, carregarRespostasPesquisa, lerRespostaPesquisa, salvarRespostasPesquisa,
  surveyFormHtml, SURVEY_SOURCES, SURVEY_STORAGE_KEY,
} from './pesquisa.js';
import { escaparTextoHtml } from './renderizacao.js';
import { atendimentosComAtrasoRegistrado, calcularOcupacao, contarDiasDeFuncionamento, indexarCapacidade, resumirConversas } from './metricas.js';

/* =====================================================================
 * CLÍNICA IKIGAI - DASHBOARD DE MÉTRICAS & INDICADORES (KPIs)
 * Arquivo: frontend/src/indicadores/app.js
 * Totalmente integrado ao banco de dados MySQL da clínica.
 * Quando não há dados registrados, exibe "Sem dados" nos cards.
 * ===================================================================== */

export function initDashboard(dashData, containerEl, Chart) {
  if (!containerEl) return () => {};

  // 1. Dados recebidos da API do backend
  let { SP = [], D = [], AB = [], CA = [], CHAT = [], referencia = '' } = dashData || {};

  // Se SP (especialidades) vier do banco de dados
  if (!Array.isArray(SP) || SP.length === 0) {
    SP = [['Geral', 200, 100, 0.12, 1]];
  } else {
    const defaultShare = SP.length ? (100 / SP.length) : 100;
    SP.forEach(s => {
      if (!s[2] || s[2] <= 0) s[2] = defaultShare;
      if (!s[3] || s[3] <= 0) s[3] = 0.12;
    });
  }

  if (!Array.isArray(D)) D = [];
  if (!Array.isArray(AB)) AB = [];
  if (!Array.isArray(CHAT)) CHAT = [];
  const capacidadePorEspecialidade = indexarCapacidade(Array.isArray(CA) ? CA : []);

  const AGE = ['0–17', '18–30', '31–45', '46–60', '60+'];
  const today = referencia ? new Date(referencia + 'T12:00:00') : new Date();

  /* ===== Cálculo dos KPIs com Dados Reais ===== */
  const dow = diasAtras => new Date(today.getFullYear(), today.getMonth(), today.getDate() - diasAtras).getDay();
  const atendimentosPorDia = new Map();
  const datasComAgendamentos = new Set();
  for (const atendimento of D) {
    if (!atendimentosPorDia.has(atendimento.d)) atendimentosPorDia.set(atendimento.d, []);
    atendimentosPorDia.get(atendimento.d).push(atendimento);
    if (atendimento.s !== 'C') datasComAgendamentos.add(atendimento.d);
  }
  const foiReagendado = x => Boolean(x.reagendado) || x.s === 'M';
  const avg = (l, f) => l.length ? l.reduce((s, x) => s + f(x), 0) / l.length : 0;

  function M(a, b, sp) {
    const defaultShare = SP.length ? (100 / SP.length) : 100;
    const share = sp < 0 ? 1 : ((SP[sp] && SP[sp][2] > 0) ? SP[sp][2] / 100 : defaultShare / 100);
    const dy = contarDiasDeFuncionamento(a, b, capacidadePorEspecialidade.get(-1), datasComAgendamentos, dow);
    const L = [];
    const porEspecialidade = SP.map(() => []);
    const revenueByTherapy = SP.map(() => 0);
    for (let dia = a; dia < b; dia++) {
      for (const atendimento of atendimentosPorDia.get(dia) ?? []) {
        if (atendimento.s === 'R' && porEspecialidade[atendimento.sp]) revenueByTherapy[atendimento.sp] += atendimento.pr;
        if (sp >= 0 && atendimento.sp !== sp) continue;
        L.push(atendimento);
        porEspecialidade[atendimento.sp]?.push(atendimento);
      }
    }
    const surveyRows = surveyResponsesInRange(a, b);
    const hasAppointments = L.length > 0;
    const f = s => L.filter(x => x.s === s);
    const Rl = f('R'), C = f('C').length, N = f('N').length, Mm = L.filter(foiReagendado).length;
    const hasRealized = Rl.length > 0;
    const rated = Rl.filter(x => x.nt != null);
    const pro = rated.filter(x => x.nt >= 9).length;
    const det = rated.filter(x => x.nt <= 6).length;
    const bot = L.filter(x => x.bot);
    const conversas = resumirConversas(CHAT, AB, a, b);
    const ocupacao = calcularOcupacao(L, capacidadePorEspecialidade.get(sp), a, b, dow);
    const atrasos = atendimentosComAtrasoRegistrado(Rl);

    const atrasosPorEspecialidade = SP.map(() => []);
    for (const atendimento of atrasos) atrasosPorEspecialidade[atendimento.sp]?.push(atendimento);
    const ss = SP.map((s, i) => {
      const l = porEspecialidade[i], r = l.filter(x => x.s === 'R'), k = l.length;
      const ra = r.filter(x => x.nt != null), pm = ra.filter(x => x.nt >= 9).length, dt = ra.filter(x => x.nt <= 6).length;
      const atrasosDaEspecialidade = atrasosPorEspecialidade[i];
      const cancelados = l.filter(x => x.s === 'C').length;
      const faltas = l.filter(x => x.s === 'N').length;
      const receita = r.reduce((acc, x) => acc + x.pr, 0);
      const spShare = s[2] > 0 ? s[2] : defaultShare;
      return {
        nm: s[0], t: l.length, r: r.length, cr: k ? cancelados / k * 100 : null, nc: k ? (cancelados + faltas) / k * 100 : null, rr: k ? l.filter(foiReagendado).length / k * 100 : null, nsr: k ? faltas / k * 100 : null,
        dl: atrasosDaEspecialidade.length ? avg(atrasosDaEspecialidade, x => x.dl) : null, tk: r.length ? avg(r, x => x.pr) : null, rv: receita,
        rt: r.length ? r.filter(x => x.rt).length / r.length * 100 : null,
        nps: ra.length ? (pm - dt) / ra.length * 100 : null,
        bt: k ? l.filter(x => x.bot).length / k * 100 : null,
        resp: r.length ? ra.length / r.length * 100 : null,
        o60: r.length ? r.filter(x => x.age === 4).length / r.length * 100 : null,
        fat: (r.length && dy) ? receita / (META_DIA * spShare / 100 * dy) * 100 : null
      };
    }).filter(s => s.t > 0);

    const ages = AGE.map((_, i) => Rl.filter(x => x.age === i).length);
    const am = ages.indexOf(Math.max(...ages));
    const top = [...ss].sort((p, q) => q.r - p.r)[0] || { nm: '—', r: 0 };

    return {
      a, b, revenueByTherapy, surveyRows, surveyCount: surveyRows.length, L, Rl, ss, ages,
      n: L.length, nR: Rl.length, C, N, Mm, ocupacao, atrasos, conversas,
      hasAppointments, hasRealized,
      rated: rated.length,
      bsh: hasAppointments ? bot.length / L.length * 100 : null,
      resp: hasRealized ? rated.length / Rl.length * 100 : null,
      p60: hasRealized ? ages[4] / Rl.length * 100 : null,
      fat: (hasRealized && dy) ? Rl.reduce((acc, x) => acc + x.pr, 0) / (META_DIA * share * dy) * 100 : null,
      rr: hasAppointments ? Mm / L.length * 100 : null,
      ns: hasAppointments ? N / L.length * 100 : null,
      nc: hasAppointments ? (C + N) / L.length * 100 : null,
      oc: ocupacao.taxa,
      dl: atrasos.length ? avg(atrasos, x => x.dl) : null,
      cr: hasAppointments ? C / L.length * 100 : null,
      top,
      ageTop: hasRealized ? (AGE[am] || '—') : '—',
      ageSh: hasRealized ? ages[am] / Rl.length * 100 : null,
      cv: hasRealized ? Rl.filter(x => x.cv === 'Convênio').length / Rl.length * 100 : null,
      nps: rated.length ? (pro - det) / rated.length * 100 : null,
      tk: hasRealized ? avg(Rl, x => x.pr) : null,
      rt: hasRealized ? Rl.filter(x => x.rt).length / Rl.length * 100 : null,
      bn: bot.length,
      res: conversas.resolucao,
      conv: conversas.conversao,
    };
  }

  // Formatadores resilientes (retornam "Sem dados" quando null ou undefined)
  const pc = v => (v != null && Number.isFinite(v)) ? v.toFixed(1).replace('.', ',') + '%' : 'Sem dados';
  const rs = v => (v != null && Number.isFinite(v)) ? 'R$ ' + Math.round(v).toLocaleString('pt-BR') : 'Sem dados';
  const nf = v => (v != null && Number.isFinite(v)) ? v.toFixed(1).replace('.', ',') : 'Sem dados';
  const f2 = v => (v != null && Number.isFinite(v)) ? v.toFixed(2).replace('.', ',') : 'Sem dados';

  const horas = minutos => minutos == null ? 'Sem dados' : nf(minutos / 60) + ' h';

  const META_DIA = 1800;
  const DN6 = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const TER = SP.length ? SP.map(s => s[0]) : ['Geral'];

  let { respostas: SURVEY_RESPONSES, erro: surveyStorageError } = carregarRespostasPesquisa();
  let surveyNotice = null;

  function surveyResponsesInRange(a, b) {
    const todayStart = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return SURVEY_RESPONSES.filter(row => {
      const submitted = new Date(row.submittedAt);
      const submittedStart = Date.UTC(submitted.getFullYear(), submitted.getMonth(), submitted.getDate());
      const daysAgo = Math.round((todayStart - submittedStart) / 864e5);
      return daysAgo >= a && daysAgo < b;
    });
  }

  const surveyAverage = (m, key) => m.surveyCount ? avg(m.surveyRows, row => row[key]) : null;
  const surveyYesRate = (m, key) => m.surveyCount ? pct(m.surveyRows, row => row[key]) : null;
  const surveyNps = m => m.surveyCount ? pct(m.surveyRows, row => row.recommendation >= 9) - pct(m.surveyRows, row => row.recommendation <= 6) : null;
  function surveySourceCounts(m) { return SURVEY_SOURCES.map(source => m.surveyRows.filter(row => row.discovery === source).length); }
  function surveySourceSummary(m) {
    const counts = surveySourceCounts(m), total = counts.reduce((sum, value) => sum + value, 0);
    if (!total) return null;
    const index = counts.indexOf(Math.max(...counts));
    return { source: SURVEY_SOURCES[index], count: counts[index], share: counts[index] / total * 100, counts, total };
  }

  const E = () => '';
  const bys = f => { const g = m => TER.map(n => { const s = m.ss.find(x => x.nm === n); return s ? (f(s) || 0) : 0; }); g.n = TER; return g; };

  const kp = (p, id, n, num, dir, unit, fmt, ok, bad, w, sub, fx, sim, cats) => [p, n, m => fmt(num(m), m), num, dir, unit, sub, id, fmt, ok, bad, w, sim, fx, cats];
  const surveyScoreFmt = value => value == null ? 'Sem dados' : `${f2(value)} / 5`;
  const surveyPercentFmt = value => value == null ? 'Sem dados' : pc(value);
  const surveyNpsFmt = value => value == null ? 'Sem dados' : `${Math.round(value)} pontos`;

  // Definições de Indicadores:
  // - Indicadores operacionais (agendamento) usam dados do MySQL (D, L). Se não há consultas, retornam null.
  // - Indicadores de pesquisa usam respostas locais (localStorage). Se vazias, retornam null.
  // - Indicadores que ainda não possuem módulo no banco retornam null ("Sem dados").
  const K0 = [
    kp(0, 'ocup', 'Ocupação da agenda', m => m.oc, 1, 'pp', pc, 85, 75, .20, m => m.oc != null ? `${horas(m.ocupacao.ocupados)} de ${horas(m.ocupacao.capacidade)}` : 'Sem dados suficientes', 'Tempo ocupado (não cancelado) ÷ capacidade registrada'),
    kp(0, 'nc', 'Não comparecimento', m => m.nc, -1, 'pp', pc, 12, 18, .20, m => m.nc != null ? `${m.C + m.N} consultas perdidas · cancel. ${pc(m.cr)} · no-show ${pc(m.ns)}` : 'Sem dados suficientes', '(Cancelamentos + no-show) ÷ agendamentos'),
    kp(0, 'reag', 'Reagendamento', m => m.rr, -1, 'pp', pc, 8, 12, .10, m => m.rr != null ? `${m.Mm} de ${m.n} agendamentos` : 'Sem dados suficientes', 'Agendamentos remarcados ÷ agendamentos'),
    kp(0, 'bot', 'Participação do chatbot', m => m.bsh, 0, 'pp', pc, null, null, 0, m => m.bsh != null ? `${m.bn} de ${m.n} agendamentos` : 'Sem dados no período', 'Agendamentos feitos pelo chatbot ÷ agendamentos', 0, bys(s => s.bt)),
    kp(0, 'res', 'Resolução sem humano', m => m.surveyCount ? surveyYesRate(m, 'aiResolution') : m.res, 1, 'pp', surveyPercentFmt, 85, 80, .20, m => m.surveyCount ? `${m.surveyCount} respostas de pacientes` : (m.conversas.iniciadas ? `${m.conversas.resolvidas} de ${m.conversas.iniciadas} conversas` : 'Sem dados no período'), 'Respostas positivas da pesquisa ou conversas resolvidas sem atendente humano', 0),
    kp(0, 'conv', 'Conversão em agendamento', m => m.conv, 1, 'pp', pc, 75, 65, .15, m => m.conversas.iniciadas ? `${m.conversas.agendadas} de ${m.conversas.iniciadas} conversas` : 'Sem conversas registradas', 'Conversas que viram agendamento ÷ conversas iniciadas'),
    kp(0, 'tconf', 'Tempo para confirmar o agendamento', () => null, -1, 'min', v => v != null ? nf(v) + ' min' : 'Sem dados', 3, 6, .10, E, 'Tempo médio entre o primeiro contato e a confirmação', 1, DN6),
    kp(0, 'facilidade', 'Facilidade para agendar', m => surveyAverage(m, 'schedulingEase'), 1, 'pts', surveyScoreFmt, 4.5, 4.0, 0, m => `${m.surveyCount} respostas de pacientes`, 'Média das respostas sobre facilidade para marcar a consulta', 2),
    kp(0, 'satbot', 'Satisfação com o bot', () => null, 1, 'pts', v => v != null ? f2(v) + ' / 5' : 'Sem dados', 4.5, 4.0, .05, E, 'Nota média (0 a 5) dada ao bot no fim da conversa', 1, DN6),
    kp(1, 'atraso', 'Atraso médio', m => m.dl, -1, 'min', v => v != null ? Math.round(v) + ' min' : 'Sem dados', 10, 15, .40, m => m.dl != null ? 'nas consultas realizadas' : 'Sem dados no período', 'Minutos entre o horário marcado e o início real (média)'),
    kp(2, 'nps', 'NPS — recomendação', surveyNps, 1, 'pts', surveyNpsFmt, 55, 40, .50, m => `${m.surveyCount} respostas reais`, '% promotores (notas 9–10) − % detratores (notas 0–6)', 2),
    kp(2, 'resp', 'Taxa de resposta da pesquisa', m => (m.surveyCount && m.nR) ? Math.min(100, m.surveyCount / m.nR * 100) : null, 1, 'pp', surveyPercentFmt, 60, 40, .15, m => m.surveyCount ? `${m.surveyCount} respostas de ${m.nR} atendimentos` : 'Sem respostas no período', 'Respostas da pesquisa ÷ atendimentos no período', 2),
    kp(2, 'recepcao', 'Atenção da recepção', m => surveyAverage(m, 'receptionAttention'), 1, 'pts', surveyScoreFmt, 4.5, 4.0, .35, m => `${m.surveyCount} respostas de pacientes`, 'Média das respostas sobre educação e atenção da recepção', 2),
    kp(2, 'clareza', 'Clareza das explicações', m => surveyAverage(m, 'professionalClarity'), 1, 'pts', surveyScoreFmt, 4.5, 4.0, .35, m => `${m.surveyCount} respostas de pacientes`, 'Média das respostas sobre clareza das explicações do profissional', 2),
    kp(2, 'recl', 'Reclamações por 100 atendimentos', () => null, -1, '/100', v => v != null ? nf(v) + ' /100' : 'Sem dados', 1, 2, .25, E, 'Reclamações registradas ÷ atendimentos × 100', 1, TER),
    kp(2, 'questionario', 'Questionário de satisfação', m => m.surveyCount, 1, 'rel', value => `${value} ${value === 1 ? 'resposta' : 'respostas'}`, null, null, 0, m => `${m.surveyCount} respostas no período`, 'Pesquisa com perguntas sobre a experiência na clínica', 2),
    kp(3, 'espera', 'Aceitação do tempo de espera', m => surveyAverage(m, 'waitAcceptability'), 1, 'pts', surveyScoreFmt, 4.5, 4.0, 0, m => `${m.surveyCount} respostas de pacientes`, 'Média das respostas sobre tempo de espera', 2),
    kp(3, 'evas', 'Evasão de pacientes', () => null, -1, 'pp', pc, 8, 12, .55, E, 'Pacientes ativos sem retorno em 90 dias ÷ pacientes ativos', 1, AGE),
    kp(3, 'ret', 'Taxa de retorno', m => m.rt, 1, 'pp', pc, 45, 35, .45, m => m.rt != null ? 'atendimentos de retorno' : 'Sem dados no período', 'Atendimentos de retorno ÷ atendimentos realizados'),
    kp(3, 'i60', 'Participação de pacientes 60+', m => m.p60, 0, 'pp', pc, null, null, 0, m => m.p60 != null ? `${m.ages[4]} de ${m.nR} atendimentos` : 'Sem dados no período', 'Atendimentos de pacientes com 60 anos ou mais', 0, bys(s => s.o60)),
    kp(4, 'fat', 'Faturamento × meta', m => m.fat, 1, 'pp', pc, 100, 90, .35, m => m.fat != null ? rs(m.Rl.reduce((acc, x) => acc + x.pr, 0)) + ' faturados' : 'Sem dados no período', 'Faturamento ÷ meta do período', 0, bys(s => s.fat)),
    kp(4, 'ticket', 'Ticket médio', m => m.tk, 1, 'rel', rs, 250, 220, .25, m => m.tk != null ? `${m.nR} atendimentos` : 'Sem atendimentos realizados', 'Receita ÷ atendimentos realizados'),
    kp(4, 'receita_terapias', 'Receita por terapia', m => m.revenueByTherapy.reduce((total, value) => total + value, 0), 1, 'rel', rs, null, null, 0, m => `${m.revenueByTherapy.filter(value => value > 0).length} terapias com receita`, 'Distribuição da receita entre as terapias', 0),
    kp(4, 'pagamento_clareza', 'Clareza do preço e pagamento', m => surveyAverage(m, 'priceFairness'), 1, 'pts', surveyScoreFmt, 4.5, 4.0, 0, m => `${m.surveyCount} respostas de pacientes`, 'Média das respostas sobre clareza e justiça do valor', 2),
    kp(4, 'custo', 'Custo operacional ÷ receita', () => null, -1, 'pp', pc, 65, 75, .25, E, 'Custos operacionais ÷ faturamento', 1, TER),
    kp(4, 'inad', 'Inadimplência', () => null, -1, 'pp', pc, 3, 6, .15, E, 'Valor em atraso ÷ valor a receber', 1, TER),
    kp(6, 'engaj', 'Taxa de engajamento', () => null, 1, 'pp', pc, 4, 2, .35, E, 'Interações ÷ alcance', 1, []),
    kp(6, 'cresc', 'Crescimento de seguidores', () => null, 1, 'pp', pc, 3, 1, .25, E, 'Novos seguidores no mês ÷ seguidores no início do mês', 1, []),
    kp(6, 'agred', 'Agendamentos vindos das redes', () => null, 1, 'pp', pc, 15, 8, .25, E, 'Agendamentos originados nas redes ÷ agendamentos', 1, []),
    kp(6, 'cac', 'Custo por paciente captado', () => null, -1, 'rel', rs, 60, 100, .15, E, 'Investimento em marketing ÷ pacientes novos captados', 1, []),
    kp(6, 'origem', 'Como conheceu a clínica', m => surveySourceSummary(m)?.share ?? null, 1, 'pp', (_value, m) => { const source = surveySourceSummary(m); return source ? `${source.source} · ${pc(source.share)}` : 'Sem respostas'; }, null, null, 0, m => `${m.surveyCount} respostas de pacientes`, 'Canal mais citado na pesquisa', 2),
    kp(6, 'fidelidade', 'Intenção de voltar', m => surveyYesRate(m, 'wouldReturn'), 1, 'pp', surveyPercentFmt, null, null, 0, m => `${m.surveyCount} respostas de pacientes`, 'Respostas "sim" à pergunta sobre voltar à clínica', 2),
    kp(9, 'adesao', 'Adesão ao plano de sessões', () => null, 1, 'pp', pc, 80, 65, .40, E, 'Pacientes que concluem o plano ÷ que iniciaram', 1, TER),
    kp(9, 'confirm', 'Confirmação após lembrete', () => null, 1, 'pp', pc, 85, 70, .35, E, 'Consultas confirmadas após lembrete ÷ lembretes enviados', 1, DN6),
    kp(1, 'desp', 'Despesas administrativas ÷ faturamento', () => null, -1, 'pp', pc, 15, 22, .15, E, 'Despesas administrativas ÷ faturamento', 1, []),
    kp(2, 'melhora', 'Melhora clínica percebida', () => null, 1, 'pp', pc, 80, 60, .40, E, 'Pacientes que relataram melhora clínica', 1, TER),
    kp(2, 'sintomas', 'Redução de queixas agudas', () => null, 1, 'pp', pc, 70, 50, .30, E, 'Redução média da intensidade das queixas', 1, TER),
    kp(2, 'metas_saude', 'Metas terapêuticas atingidas', () => null, 1, 'pp', pc, 75, 60, .30, E, 'Proporção de metas de saúde alcançadas', 1, TER),
    kp(9, 'insumo', 'Custo de insumos por atendimento', () => null, -1, 'rel', rs, 18, 25, .40, E, 'Custo dos insumos ÷ atendimentos realizados', 1, TER),
    kp(9, 'ruptura', 'Ruptura de estoque', () => null, -1, 'pp', pc, 2, 5, .30, E, 'Itens essenciais em falta ÷ itens essenciais', 1, []),
    kp(9, 'perdas', 'Perdas de insumos', () => null, -1, 'pp', pc, 2, 4, .30, E, 'Valor de insumos descartados ÷ valor em estoque', 1, []),
    kp(3, 'tempo_limp', 'Tempo médio de preparo da sala', () => null, -1, 'min', v => v != null ? Math.round(v) + ' min' : 'Sem dados', 10, 15, .35, E, 'Tempo gasto na higienização da sala', 1, []),
    kp(3, 'taxa_falhas', 'Falhas de sistema no atendimento', () => null, -1, 'pp', pc, 2, 5, .40, E, 'Atendimentos com interrupção de sistema', 1, []),
    kp(5, 'ambiente', 'Segurança, conforto e acessibilidade', m => surveyAverage(m, 'safeComfort'), 1, 'pts', surveyScoreFmt, 4.5, 4.0, 0, m => `${m.surveyCount} respostas de pacientes`, 'Média das respostas sobre segurança e conforto', 2)
  ];

  const LAY = {
    ocup: [0, .15], nc: [0, .15], reag: [0, .08], confirm: [0, .10], bot: [0, 0], res: [0, .17], conv: [0, .10], tconf: [0, .08], satbot: [0, .07], facilidade: [0, .10],
    fat: [1, .30], ticket: [1, .15], receita_terapias: [1, 0], pagamento_clareza: [1, .10], custo: [1, .20], desp: [1, .15], inad: [1, .10],
    melhora: [2, .40], sintomas: [2, .30], metas_saude: [2, .30],
    atraso: [3, .20], espera: [3, .35], tempo_limp: [3, .25], taxa_falhas: [3, .20],
    engaj: [4, .35], cresc: [4, .25], agred: [4, .25], cac: [4, .15], origem: [4, 0],
    recepcao: [5, .30], clareza: [5, .30], ambiente: [5, 0], resp: [5, .15], recl: [5, .15], questionario: [5, 0],
    evas: [6, .25], ret: [6, .15], adesao: [6, .15], nps: [6, .45], fidelidade: [6, 0], i60: [6, 0],
    insumo: [7, .40], ruptura: [7, .30], perdas: [7, .30]
  };

  const K = K0.filter(k => LAY[k[7]]).map(k => { k[0] = LAY[k[7]][0]; k[11] = LAY[k[7]][1]; return k; }).sort((a, b) => a[0] - b[0]);
  const KI = {}; K.forEach((k, i) => KI[k[7]] = i);
  const PN = [
    { n: 'Agenda', d: 'Ocupação, perdas de agenda, canais de agendamento (secretária x chatbot de IA) e desempenho do bot' },
    { n: 'Financeiro', d: 'Faturamento, ticket, custos operacionais, despesas e distribuição da receita por terapia' },
    { n: 'Desfechos Clínicos (Outcomes)', d: 'Evolução clínica dos pacientes, alívio de sintomas e alcance das metas terapêuticas' },
    { n: 'Produção/Operacional', d: 'Pontualidade, tempo de espera, eficiência e qualidade do atendimento' },
    { n: 'Redes Sociais', d: 'Engajamento, crescimento, origem dos pacientes e indicações' },
    { n: 'Pesquisa de satisfação', d: 'Atenção da recepção, clareza das explicações, segurança e conforto' },
    { n: 'Perfil de Clientes/Evasão', d: 'Quem volta, quem recomenda, quem some e quem conclui o tratamento' },
    { n: 'Estoque e insumos', d: 'Custo de insumos, falta de itens e perdas' }
  ];
  const EX = { 0: 'canais', 2: 'outcomes', 3: 'top', 6: 'perfil' };

  /* ===== Gráficos e páginas de detalhe ===== */
  const $ = s => containerEl.querySelector(s);
  const css = v => getComputedStyle(containerEl).getPropertyValue(v).trim();
  let CH = [], c, p, A, AP, N, sp, cur = null, pan = null, PV = 'age', TR_TYPE = 'doughnut', TR_SELECTED = new Set(SP.map((_, i) => i));
  const diasDaSemana = [1, 2, 3, 4, 5, 6, 0];
  const dn = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'], HR = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const mk = (id, cfg) => {
    const el = containerEl.querySelector('#' + id);
    if (el) CH.push(new Chart(el, cfg));
  };
  const P = () => [css('--primary') || '#262B6B', css('--secondary') || '#BFA15F', css('--sr') || '#b3382a', css('--slate') || '#6B7280', css('--primary-dark') || '#1E2255', css('--dark') || '#181924'];
  const CAT = [css('--primary') || '#262B6B', css('--secondary') || '#BFA15F', css('--primary-dark') || '#1E2255', css('--gray') || '#6B7280', css('--dark') || '#181924', css('--sr') || '#b3382a'];
  const safeP = i => P()[i % P().length];
  const safeCAT = i => CAT[i % CAT.length];

  const r2 = v => (v != null && Number.isFinite(v)) ? +v.toFixed(Math.abs(v) < 10 ? 2 : 1) : null;
  const f1 = v => (v != null && Number.isFinite(v)) ? +v.toFixed(1) : 0;
  const maxI = a => a.length ? a.indexOf(Math.max(...a)) : 0;
  const sh = n => n.split(' ');
  const rate = (l, s) => l.length ? l.filter(x => x.s === s).length / l.length * 100 : 0;
  const pct = (l, fn) => l.length ? l.filter(fn).length / l.length * 100 : 0;
  const byW = f => diasDaSemana.map(dia => f1(f(c.L.filter(x => x.w === dia))));
  const byH = f => HR.map(h => f1(f(c.L.filter(x => x.h === h))));
  const topS = (k, fm = pc) => { const s = c.ss.filter(item => item[k] != null).sort((x, y) => y[k] - x[k])[0]; return s ? `${s.nm} (${fm(s[k])})` : 'Sem dados'; };
  const sg = (m, n) => m.ss.find(s => s.nm === n);

  function opt(o = {}) {
    const mu = css('--mute') || '#6B7280', ln = css('--line') || '#EFE6D2';
    return {
      maintainAspectRatio: false, indexAxis: o.ix || 'x',
      plugins: { legend: { display: !!o.lg, position: 'bottom', labels: { color: mu, boxWidth: 12 } } },
      scales: o.no ? {} : { x: { stacked: !!o.st, grid: { display: false }, ticks: { color: mu } }, y: { stacked: !!o.st, beginAtZero: true, grid: { color: ln }, ticks: { color: mu } } }
    };
  }

  const ro = () => ({
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: 'bottom', labels: { color: css('--mute') || '#6B7280', boxWidth: 12 } } },
    scales: { r: { beginAtZero: true, grid: { color: css('--line') || '#EFE6D2' }, angleLines: { color: css('--line') || '#EFE6D2' }, pointLabels: { color: css('--ink') || '#181924', font: { size: 11 } }, ticks: { color: css('--mute') || '#6B7280', backdropColor: 'transparent' } } }
  });

  const br = (lb, d, col, o) => ({ type: 'bar', data: { labels: lb, datasets: [{ data: d, backgroundColor: col }] }, options: opt(o) });
  const lc = (lb, sets) => ({ type: 'line', data: { labels: lb, datasets: sets.map(([n, d, col, ds], i) => ({ label: n, data: d, borderColor: col, backgroundColor: col + '26', fill: i === 0 && sets.length < 3, tension: .3, pointRadius: 2, borderDash: ds ? [5, 4] : [], spanGaps: true })) }, options: opt({ lg: 1 }) });
  const rds = (n, d, col) => ({ label: n, data: d, borderColor: col, backgroundColor: col + '33', pointBackgroundColor: col });
  const pie = (lb, d, type) => ({
    type: type || 'doughnut', data: { labels: lb, datasets: [{ data: d, backgroundColor: P(), borderColor: css('--card') || '#fff' }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { color: css('--mute') || '#6B7280', boxWidth: 12 } } }, ...(type === 'polarArea' ? { scales: { r: { grid: { color: css('--line') }, ticks: { display: false } } } } : {}) }
  });

  function tr(fn, t, mi) {
    const B = N <= 7 ? 7 : N <= 30 ? 10 : 12, z = Math.ceil(N / B), lb = [], a = [], b = [];
    for (let i = 0; i < B; i++) {
      const hi = N - i * z, lo = Math.max(0, hi - z); if (hi <= 0) break;
      const m = M(lo, hi, sp), q = M(lo + N, hi + N, sp), d = new Date(today.getTime() - (hi - 1) * 864e5);
      lb.push(String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'));
      a.push(r2(fn(m)));
      b.push(r2(fn(q)));
    }
    const cfg = lc(lb, [['Atual', a, safeP(0)], ['Anterior', b, safeP(3), 1]]), mt_ = mi != null && hasF(mi);
    if (mt_) cfg.data.datasets.push({ label: 'Meta (verde)', data: lb.map(() => K[mi][9]), borderColor: css('--sg') || '#2a7f50', backgroundColor: css('--sg') || '#2a7f50', borderDash: [2, 3], pointRadius: 0, fill: false });
    return { t, h: 'Linha cheia: período atual · tracejada: período anterior' + (mt_ ? ' · pontilhada verde: meta' : ''), cfg };
  }

  function rad(f, t, h, arredondar = f1) {
    const nm = SP.map(s => s[0]), g = m => nm.map(n => { const s = sg(m, n); return arredondar(s && s.t ? f(s) : null); });
    return { t, h: h || 'Compara as terapias com atendimentos no banco', cfg: { type: 'radar', data: { labels: nm.map(sh), datasets: [rds('Atual', g(A), safeP(0)), rds('Anterior', g(AP), safeP(3))] }, options: ro() } };
  }

  function wk() {
    const ws = d => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    const W = new Map();
    for (let d = N - 1; d >= 0; d--) { const x = ws(d), k = x.getTime(); if (!W.has(k)) W.set(k, { x, R: 0, C: 0, N: 0, M: 0 }); }
    c.L.forEach(a => { const item = W.get(ws(a.d).getTime()); if (item && item[a.s] !== undefined) item[a.s]++; });
    const v = [...W.values()].sort((a, b) => a.x - b.x), lb = v.map(w => String(w.x.getDate()).padStart(2, '0') + '/' + String(w.x.getMonth() + 1).padStart(2, '0'));
    return { t: 'Situação dos agendamentos por semana (%)', h: '% de cada situação sobre os agendamentos da semana', w: 1, cfg: { type: 'bar', data: { labels: lb, datasets: [['R', 'Realizadas', 0], ['M', 'Reagendadas', 1], ['C', 'Canceladas', 2], ['N', 'No-show', 3]].map(([k, n, i]) => ({ label: n, data: v.map(w => { const t = w.R + w.C + w.N + w.M; return t ? f1(w[k] / t * 100) : 0; }), backgroundColor: safeP(i) })) }, options: opt({ st: 1, lg: 1 }) } };
  }

  function heat() {
    const g = {};
    const diasPorDiaDaSemana = Array(7).fill(0);
    for (let dia = 0; dia < N; dia++) diasPorDiaDaSemana[dow(dia)]++;
    c.L.filter(x => x.s !== 'C').forEach(x => { const k = x.w + '-' + x.h; g[k] = (g[k] || 0) + 1; });
    let h = '<div class="l"></div>' + dn.map(d => `<div class="l">${d}</div>`).join('');
    for (const hr of HR) {
      h += `<div class="l">${hr}h</div>`;
      for (const w of diasDaSemana) {
        const v = Math.min(2, Math.round((g[w + '-' + hr] || 0) / Math.max(1, diasPorDiaDaSemana[w]))), r = v / 2;
        h += `<div style="background:rgba(${css('--rgb') || '38,43,107'},${(.06 + .9 * r).toFixed(2)});color:${r > .55 ? css('--onacc') || '#fff' : css('--ink') || '#181924'}">${v}</div>`;
      }
    }
    return { t: 'Mapa de demanda', h: 'Média diária de atendimentos por horário', w: 1, html: '<div class="hm">' + h + '</div>' };
  }

  function fun() {
    const f = [['Conversas iniciadas', c.conversas.iniciadas], ['Agendamentos feitos pelo bot', c.conversas.agendadas], ['Resolvidas sem humano', c.conversas.resolvidas]];
    return { t: 'Funil do chatbot', h: 'Resultados das conversas iniciadas no período', w: 1, html: `<div class="fun">${f.map(([n, v]) => `<div><b>${n}</b> · ${v}<div class="bar"><i style="width:${(v / Math.max(1, f[0][1]) * 100).toFixed(0)}%"></i></div></div>`).join('')}</div>` };
  }

  function prof() {
    let pl, d;
    if (PV === 'age') { pl = AGE; d = c.ages; }
    else if (PV === 'tx') { pl = c.ss.map(s => s.nm); d = c.ss.map(s => s.r); }
    else { pl = PV === 'sx' ? ['Feminino', 'Masculino'] : ['Convênio', 'Particular']; d = pl.map(v => c.Rl.filter(x => x[PV] === v).length); }
    const o = [['age', 'Faixa etária'], ['sx', 'Sexo'], ['cv', 'Forma de pagamento'], ['tx', 'Atendimentos realizados']].map(([v, n]) => `<option value="${v}"${v === PV ? ' selected' : ''}>${n}</option>`).join('');
    return { t: 'Perfil do paciente', h: `<select id="pv" aria-label="Perfil por">${o}</select>`, cfg: pie(pl, d) };
  }

  const tx = (l, fn) => l.length ? f1(l.filter(fn).length / l.length * 100) : 0;

  const DT0 = [
    () => ({
      d: 'Agendamentos remarcados para outra data, entre todos os agendamentos do período.',
      st: [['Reagendamentos', c.hasAppointments ? `${c.Mm} (${pc(c.rr)})` : 'Sem dados'], ['Dia com mais remarcações', c.hasAppointments ? dn[maxI(byW(l => l.filter(foiReagendado).length))] : 'Sem dados'], ['Terapia com maior taxa', topS('rr')]],
      pn: [tr(m => m.rr, 'Evolução da taxa de reagendamento', KI.reag), rad(s => s.rr, 'Reagendamento por terapia'), { t: 'Reagendamento por dia da semana', h: '% dos agendamentos de cada dia', cfg: br(dn, byW(l => pct(l, foiReagendado)), safeP(1)) }]
    }),
    () => ({
      d: 'Consultas perdidas: cancelamentos somados às faltas sem aviso (no-show), sobre todos os agendamentos do período.',
      st: [['Consultas perdidas', c.hasAppointments ? `${c.C + c.N} (${pc(c.nc)})` : 'Sem dados'], ['Cancelamentos', c.hasAppointments ? `${c.C} (${pc(c.cr)})` : 'Sem dados'], ['No-show', c.hasAppointments ? `${c.N} (${pc(c.ns)})` : 'Sem dados'], ['Receita potencial perdida', c.hasAppointments ? rs((c.C + c.N) * (c.tk || 0)) : 'Sem dados'], ['Dia da semana mais crítico', (() => { if (!c.hasAppointments) return 'Sem dados'; const v = byW(l => rate(l, 'C') + rate(l, 'N')), i = maxI(v); return dn[i] + ' · ' + pc(v[i]); })()]],
      pn: [
        tr(m => m.nc, 'Evolução do não comparecimento (%)', KI.nc),
        { t: 'Cancelamento e no-show por dia da semana', h: '% dos agendamentos de cada dia', cfg: { type: 'bar', data: { labels: dn, datasets: [['Cancelamentos', byW(l => rate(l, 'C')), safeP(2)], ['No-show', byW(l => rate(l, 'N')), safeP(1)]].map(([n, d, col]) => ({ label: n, data: d, backgroundColor: col })) }, options: opt({ st: 1, lg: 1 }) } },
        rad(s => s.nc, 'Não comparecimento por terapia'),
        { t: 'Não comparecimento por horário', h: '% dos agendamentos de cada hora', cfg: lc(HR.map(h => h + 'h'), [['Não comparecimento (%)', byH(l => rate(l, 'C') + rate(l, 'N')), safeP(2)]]) },
        { t: 'Situação final dos agendamentos', h: 'Para onde vão os agendamentos', cfg: pie(['Realizadas', 'Reagendadas', 'Canceladas', 'No-show'], [c.nR, c.Mm, c.C, c.N]) }
      ]
    }),
    () => ({
      d: 'Tempo ocupado por agendamentos não cancelados em relação à capacidade registrada.',
      st: [['Horas ocupadas', c.hasAppointments || c.ocupacao.capacidade != null ? horas(c.ocupacao.ocupados) : 'Sem dados'], ['Capacidade da agenda', horas(c.ocupacao.capacidade)], ['Horas ociosas', horas(c.ocupacao.ociosos)]],
      pn: [tr(m => m.oc, 'Evolução da ocupação', KI.ocup), { t: 'Ocupação por dia da semana', h: '% da capacidade preenchida em cada dia', cfg: { type: 'radar', data: { labels: dn, datasets: [rds('Atual', diasDaSemana.map(dia => r2(c.ocupacao.porDiaDaSemana[dia])), safeP(0)), rds('Anterior', diasDaSemana.map(dia => r2(p.ocupacao.porDiaDaSemana[dia])), safeP(3))] }, options: ro() } }, heat(), wk()]
    }),
    () => ({
      d: 'Minutos médios entre o horário marcado e o início real da consulta.',
      st: [['Pontuais (até 5 min)', c.atrasos.length ? pc(pct(c.atrasos, x => x.dl <= 5)) : 'Sem dados'], ['Atrasos acima de 30 min', c.atrasos.length ? c.atrasos.filter(x => x.dl > 30).length : 'Sem dados'], ['Maior atraso médio', topS('dl', v => Math.round(v) + ' min')]],
      pn: [tr(m => m.dl, 'Evolução do atraso médio (min)', KI.atraso), { t: 'Distribuição dos atrasos', h: 'Consultas por faixa de atraso', cfg: br(['0–5', '6–10', '11–20', '21–30', '30+ min'], [[0, 5], [6, 10], [11, 20], [21, 30], [31, 999]].map(([a, b]) => c.atrasos.length ? c.atrasos.filter(x => x.dl >= a && x.dl <= b).length : null), safeP(1)) },
      { t: 'Atraso médio por horário', h: 'O atraso se acumula ao longo do dia?', cfg: lc(HR.map(h => h + 'h'), [['Minutos', HR.map(hora => { const amostra = c.atrasos.filter(x => x.h === hora); return amostra.length ? r2(avg(amostra, x => x.dl)) : null; }), safeP(1)]]) }, rad(s => s.dl, 'Atraso médio por terapia (min)', undefined, r2)]
    }),
    () => ({
      d: 'Ranking das terapias concluídas no período.',
      st: [['Atendimentos concluídos', c.nR], ['Terapia líder', c.top.nm], ['Peso das 3 primeiras', c.nR ? pc([...c.ss].sort((x, y) => y.r - x.r).slice(0, 3).reduce((a, s) => a + s.r, 0) / c.nR * 100) : 'Sem dados']],
      pn: [
        { t: 'Ranking de terapias', h: 'Atendimentos concluídos', cfg: br([...c.ss].sort((x, y) => y.r - x.r).map(s => s.nm), [...c.ss].sort((x, y) => y.r - x.r).map(s => s.r), safeP(0), { ix: 'y' }) },
        { t: 'Participação de cada terapia', h: '% dos atendimentos concluídos', cfg: pie(c.ss.map(s => s.nm), c.ss.map(s => s.r), 'polarArea') },
        { t: 'Terapias por dia da semana', h: 'Atendimentos concluídos, empilhados por terapia', w: 1, cfg: { type: 'bar', data: { labels: dn, datasets: SP.map((s, i) => ({ label: s[0], data: diasDaSemana.map(dia => c.Rl.filter(x => x.sp === i && x.w === dia).length), backgroundColor: safeP(i) })) }, options: opt({ st: 1, lg: 1 }) } }
      ]
    }),
    () => ({
      d: 'Quem são os pacientes atendidos: idade, sexo e forma de pagamento.',
      st: [['Faixa predominante', c.hasRealized ? c.ageTop + ' anos' : 'Sem dados'], ['Com convênio', c.hasRealized ? pc(c.cv) : 'Sem dados'], ['Mulheres', c.hasRealized ? pc(pct(c.Rl, x => x.sx === 'Feminino')) : 'Sem dados']],
      pn: [prof(), { t: 'Faixa etária por sexo', h: '% de cada sexo em cada faixa', cfg: { type: 'radar', data: { labels: AGE, datasets: ['Feminino', 'Masculino'].map((s, i) => { const l = c.Rl.filter(x => x.sx === s); return rds(s, AGE.map((_, j) => tx(l, x => x.age === j)), safeP(i)); }) }, options: ro() } },
      { t: 'Faixa etária por terapia', h: '% dos pacientes de cada terapia (todas as terapias)', w: 1, cfg: { type: 'bar', data: { labels: SP.map(s => s[0]), datasets: AGE.map((g, i) => ({ label: g, data: SP.map((_, j) => tx(A.Rl.filter(x => x.sp === j), x => x.age === i)), backgroundColor: safeP(i) })) }, options: opt({ st: 1, lg: 1 }) } }]
    }),
    () => {
      const ratings = c.surveyRows.map(row => row.recommendation), total = ratings.length, share = threshold => pct(ratings, value => threshold(value)), formatShare = value => total ? pc(value) : 'Sem dados';
      const promoter = share(value => value >= 9), neutral = share(value => value >= 7 && value <= 8), detractor = share(value => value <= 6);
      return {
        d: 'NPS calculado com as respostas registradas da pesquisa.',
        st: [['Promotores', formatShare(promoter)], ['Neutros (7–8)', formatShare(neutral)], ['Detratores', formatShare(detractor)]],
        pn: [tr(surveyNps, 'Evolução do NPS', KI.nps), { t: 'Notas de recomendação', h: `${total} respostas no período (0 a 10)`, cfg: br(Array.from({ length: 11 }, (_, i) => i), Array.from({ length: 11 }, (_, i) => ratings.filter(value => value === i).length), Array.from({ length: 11 }, (_, i) => i >= 9 ? safeP(0) : i >= 7 ? safeP(3) : safeP(2))) }]
      };
    },
    () => {
      const mx = Math.max(1, ...A.ss.map(s => s.rv));
      return {
        d: 'Valor médio recebido por atendimento realizado.',
        st: [['Receita no período', rs(c.Rl.reduce((a, x) => a + x.pr, 0))], ['Maior ticket', topS('tk', rs)], ['Terapias analisadas', c.ss.length]],
        pn: [tr(m => m.tk, 'Evolução do ticket médio (R$)', KI.ticket), { t: 'Ticket médio por terapia', h: 'R$ por atendimento realizado', cfg: br(c.ss.map(s => s.nm), c.ss.map(s => Math.round(s.tk || 0)), safeP(0)) },
        { t: 'Volume x valor x receita', h: 'Eixo X: atendimentos · eixo Y: ticket · tamanho: receita', w: 1, cfg: { type: 'bubble', data: { datasets: A.ss.map((s, i) => ({ label: s.nm, data: [{ x: s.r, y: Math.round(s.tk || 0), r: 6 + s.rv / mx * 22 }], backgroundColor: safeP(i) + 'bb' })) }, options: { ...opt({ lg: 1 }), scales: { x: { title: { display: true, text: 'Atendimentos', color: css('--mute') }, grid: { display: false }, ticks: { color: css('--mute') } }, y: { title: { display: true, text: 'Ticket (R$)', color: css('--mute') }, grid: { color: css('--line') }, ticks: { color: css('--mute') } } } } } }]
      };
    },
    () => ({
      d: 'Atendimentos de retorno entre os atendimentos realizados.',
      st: [['Retornos', c.hasRealized ? c.Rl.filter(x => x.rt).length : 'Sem dados'], ['Terapia que mais retorna', topS('rt')], ['Faixa que mais retorna', c.hasRealized ? ((AGE[maxI(AGE.map((_, i) => tx(c.Rl.filter(x => x.age === i), x => x.rt)))] || '—') + ' anos') : 'Sem dados']],
      pn: [tr(m => m.rt, 'Evolução da taxa de retorno', KI.ret), rad(s => s.rt, 'Retorno por terapia'), { t: 'Retorno por faixa etária', h: '% dos atendimentos que são retorno', cfg: br(AGE, AGE.map((_, i) => tx(c.Rl.filter(x => x.age === i), x => x.rt)), safeP(4)) }]
    }),
    () => ({
      d: 'Conversas do chatbot resolvidas sem ajuda de um atendente humano.',
      st: [['Conversas iniciadas', c.conversas.iniciadas], ['Resolvidas sem humano', c.conversas.resolvidas]],
      pn: [tr(m => m.res, 'Evolução da resolução sem humano', KI.res)]
    }),
    () => ({
      d: 'Conversas iniciadas no chatbot que terminaram em um agendamento.',
      st: [['Conversas iniciadas', c.conversas.iniciadas], ['Agendamentos gerados', c.conversas.agendadas], ['Conversas abandonadas', c.conversas.abandonadas]],
      pn: [tr(m => m.conv, 'Evolução da conversão', KI.conv), fun(), { t: 'Origem dos agendamentos', h: 'Chatbot x atendimento humano', cfg: pie(['Chatbot', 'Atendimento humano'], [c.bn, Math.max(0, c.L.length - c.bn)]) }, rad(s => s.bt, 'Uso do chatbot por terapia', '% dos agendamentos de cada terapia feitos pelo bot')]
    })
  ];

  const DT = {};
  ['reag', 'nc', 'ocup', 'atraso', 'top', 'perfil', 'nps', 'ticket', 'ret', 'res', 'conv'].forEach((id, i) => DT[id] = DT0[i]);

  function surveyMetricDetail(key, label, question, type) {
    return () => {
      const rows = c.surveyRows;
      const counts = type === 'rating' ? [1, 2, 3, 4, 5].map(value => rows.filter(row => row[key] === value).length) : type === 'recommendation' ? Array.from({ length: 11 }, (_, value) => rows.filter(row => row[key] === value).length) : type === 'source' ? surveySourceCounts(c) : [rows.filter(row => row[key] === true).length, rows.filter(row => row[key] === false).length];
      const names = type === 'rating' ? ['1', '2', '3', '4', '5'] : type === 'recommendation' ? Array.from({ length: 11 }, (_, value) => String(value)) : type === 'source' ? SURVEY_SOURCES : ['Sim', 'Não'];
      const total = counts.reduce((sum, value) => sum + value, 0), highest = Math.max(1, ...counts);
      const results = total ? `<div class="survey-results">${counts.map((count, index) => `<div><span>${names[index]}</span><div class="survey-result-bar"><i style="width:${count / highest * 100}%"></i></div><b>${count} · ${pc(count / total * 100)}</b></div>`).join('')}</div>` : '<p class="survey-empty">Ainda não há respostas para esta pergunta no período selecionado.</p>';
      const value = type === 'rating' ? surveyAverage(c, key) : type === 'recommendation' ? surveyNps(c) : type === 'source' ? surveySourceSummary(c)?.source : surveyYesRate(c, key);
      const summary = type === 'rating' ? surveyScoreFmt(value) : type === 'recommendation' ? surveyNpsFmt(value) : type === 'source' ? value || 'Sem dados' : surveyPercentFmt(value);
      return { d: question, st: [['Respostas registradas no período', total], ['Resultado', summary]], pn: [{ t: `Respostas · ${label}`, h: `Distribuição entre ${total} resposta${total === 1 ? '' : 's'} no período.`, w: 1, html: results }] };
    };
  }

  DT.questionario = () => ({ d: 'Pesquisa para acompanhar a experiência dos pacientes.', st: [['Respostas no período', c.surveyCount], ['Armazenadas no navegador', SURVEY_RESPONSES.length]], pn: [{ t: 'Responder à pesquisa', w: 1, html: surveyFormHtml({ erro: surveyStorageError, aviso: surveyNotice, total: SURVEY_RESPONSES.length }) }] });
  DT.facilidade = surveyMetricDetail('schedulingEase', 'facilidade para agendar', 'Avaliação de 1 a 5 sobre a facilidade de marcar a consulta.', 'rating');
  const detalheResolucaoConversas = DT.res;
  const detalheResolucaoPesquisa = surveyMetricDetail('aiResolution', 'resolução sem ajuda humana', 'Percentual de respostas "sim" sobre resolver tudo sem ajuda de atendente.', 'boolean');
  DT.res = () => c.surveyCount ? detalheResolucaoPesquisa() : detalheResolucaoConversas();
  DT.resp = () => ({ d: 'Percentual de respostas da pesquisa em relação aos atendimentos do período.', st: [['Respostas', c.surveyCount], ['Atendimentos', c.nR], ['Taxa calculada', c.surveyCount ? surveyPercentFmt(K[KI.resp][3](c)) : 'Sem dados']], pn: [{ t: 'Origem das respostas', h: 'Distribuição das respostas conforme o canal de descoberta da clínica.', cfg: pie(SURVEY_SOURCES, surveySourceCounts(c)) }] });
  DT.espera = surveyMetricDetail('waitAcceptability', 'aceitação do tempo de espera', 'Avaliação de 1 a 5 sobre o tempo de espera.', 'rating');
  DT.recepcao = surveyMetricDetail('receptionAttention', 'atenção da recepção', 'Avaliação de 1 a 5 da educação e atenção da recepção.', 'rating');
  DT.clareza = surveyMetricDetail('professionalClarity', 'clareza das explicações', 'Avaliação de 1 a 5 da clareza das explicações.', 'rating');
  DT.pagamento_clareza = surveyMetricDetail('priceFairness', 'clareza do preço e pagamento', 'Avaliação de 1 a 5 sobre clareza e justiça do valor.', 'rating');
  DT.ambiente = surveyMetricDetail('safeComfort', 'segurança, conforto e acessibilidade', 'Avaliação de 1 a 5 de segurança e conforto.', 'rating');
  DT.fidelidade = surveyMetricDetail('wouldReturn', 'intenção de voltar', 'Percentual de respostas "sim" sobre voltar à clínica.', 'boolean');
  DT.origem = surveyMetricDetail('discovery', 'origem dos pacientes', 'Canais citados em "Como ficou sabendo da clínica?".', 'source');

  function therapyRevenueChart() {
    const indexes = [...TR_SELECTED].sort((a, b) => a - b), labels = indexes.map(i => TER[i] || `Terapia ${i + 1}`), values = indexes.map(i => c.revenueByTherapy[i] || 0), total = values.reduce((sum, value) => sum + value, 0);
    const options = TR_TYPE === 'bar' ? opt({ ix: 'y' }) : { maintainAspectRatio: false, plugins: {} };
    options.plugins = { ...options.plugins, legend: { display: false }, tooltip: { callbacks: { label: item => { const value = Number(item.raw) || 0; return `Receita: ${rs(value)} (${pc(total ? value / total * 100 : 0)})`; } } } };
    return { type: TR_TYPE, data: { labels, datasets: [{ label: 'Receita', data: values, backgroundColor: indexes.map(i => safeP(i)), borderColor: css('--card') || '#fff', borderWidth: 2 }] }, options };
  }

  function therapyRevenueView() {
    const total = c.revenueByTherapy.reduce((sum, value) => sum + value, 0), selectedTotal = [...TR_SELECTED].reduce((sum, index) => sum + (c.revenueByTherapy[index] || 0), 0), included = TR_SELECTED.size;
    return {
      d: 'Visualize a receita dos atendimentos realizados em todas as terapias no período.',
      st: [['Receita total no período', rs(total)], ['Terapias disponíveis', TER.length], ['Atendimentos realizados', A.nR]],
      pn: [{
        t: 'Distribuição da receita por terapia', h: 'A participação percentual considera apenas as terapias selecionadas.', w: 1, cfg: therapyRevenueChart(), html: `<div class="therapy-revenue">
        <div class="cv therapy-revenue-chart"><canvas id="d0"></canvas></div>
        <div class="therapy-filter-list" aria-label="Selecionar terapias no gráfico">${TER.map((name, i) => `<label class="therapy-filter" style="--therapy-color:${safeP(i)}"><input type="checkbox" data-revenue-therapy="${i}"${TR_SELECTED.has(i) ? ' checked' : ''}><span>${escaparTextoHtml(name)}<small data-revenue-share="${i}">${TR_SELECTED.has(i) ? ` · ${pc(selectedTotal ? (c.revenueByTherapy[i] || 0) / selectedTotal * 100 : 0)}` : ''}</small></span></label>`).join('')}</div>
        <p class="therapy-chart-summary" id="therapy-chart-summary" role="status" aria-live="polite">${included} de ${TER.length} terapias selecionadas · receita analisada: ${rs(selectedTotal)}.</p>
        <div class="therapy-chart-controls">
          <label for="therapy-chart-type">Tipo de gráfico<select id="therapy-chart-type"><option value="pie"${TR_TYPE === 'pie' ? ' selected' : ''}>Pizza</option><option value="doughnut"${TR_TYPE === 'doughnut' ? ' selected' : ''}>Rosca</option><option value="bar"${TR_TYPE === 'bar' ? ' selected' : ''}>Barras</option></select></label>
          <label class="therapy-select-all"><input id="therapy-select-all" type="checkbox"${included === TER.length ? ' checked' : ''}> Selecionar todas</label>
        </div>
      </div>`}]
    };
  }

  DT.receita_terapias = therapyRevenueView;

  function refreshTherapyRevenueView() {
    const selectedTotal = [...TR_SELECTED].reduce((sum, index) => sum + (c.revenueByTherapy[index] || 0), 0), all = $('#therapy-select-all');
    if (all) { all.checked = TR_SELECTED.size === TER.length; all.indeterminate = TR_SELECTED.size > 0 && TR_SELECTED.size < TER.length; }
    TER.forEach((_, index) => {
      const input = $(`[data-revenue-therapy="${index}"]`), share = $(`[data-revenue-share="${index}"]`), value = c.revenueByTherapy[index] || 0;
      if (input) input.checked = TR_SELECTED.has(index);
      if (share) share.textContent = TR_SELECTED.has(index) ? ` · ${pc(selectedTotal ? value / selectedTotal * 100 : 0)}` : '';
    });
    const summary = $('#therapy-chart-summary');
    if (summary) summary.textContent = `${TR_SELECTED.size} de ${TER.length} terapias selecionadas · receita analisada: ${rs(selectedTotal)}.`;
    const chartIndex = CH.findIndex(chart => chart.canvas && chart.canvas.id === 'd0');
    if (chartIndex >= 0) { CH[chartIndex].destroy(); CH.splice(chartIndex, 1); }
    if ($('#d0')) mk('d0', therapyRevenueChart());
  }

  DT.outcomes = () => ({
    pn: [
      { t: 'Visão Geral dos Desfechos', h: 'Acompanhamento clínico dos pacientes', cfg: { type: 'radar', data: { labels: ['Melhora clínica', 'Redução de sintomas', 'Metas atingidas'], datasets: [rds('Atual', [0, 0, 0], safeP(0)), rds('Anterior', [0, 0, 0], safeP(3))] }, options: ro() } },
      { t: 'Desfechos por Terapia', h: 'Aguardando evolução clínica dos pacientes no prontuário', w: 1, html: '<p class="h" style="padding: 24px; text-align: center; color: var(--mute);">Sem dados clínicos registrados ainda. Conforme as consultas forem realizadas e os desfechos preenchidos, os dados aparecerão aqui.</p>' }
    ]
  });

  DT.canais = () => {
    const L = c.L, bot = L.filter(x => x.bot).length, hu = L.length - bot;
    return {
      pn: [
        { t: 'Canais de agendamento', h: 'Chatbot de IA x atendimento humano', cfg: pie(['Chatbot (IA)', 'Recepção humana'], [bot, hu]) },
        { t: 'Uso do chatbot por faixa etária', h: '% dos agendamentos feitos pelo bot em cada faixa', cfg: br(AGE, AGE.map((_, i) => tx(L.filter(x => x.age === i), x => x.bot)), safeP(0)) }
      ]
    };
  };

  const dlt = k => {
    if (!k[3]) return '';
    const current = k[3](c), previous = k[3](p);
    if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return '<div class="d flat">Sem dados anteriores para comparação</div>';
    if (k[5] === 'rel' && previous <= 0) return `<div class="d flat">${current > 0 ? 'Novo neste período' : 'Sem variação'}</div>`;
    const d = k[5] === 'rel' ? (current - previous) / previous * 100 : current - previous,
      cl = Math.abs(d) < .05 ? 'flat' : k[4] * d > 0 ? 'up' : 'dn', u = k[5] === 'rel' ? '%' : ' ' + k[5];
    return `<div class="d ${cl}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1).replace('.', ',')}${u} vs anterior</div>`;
  };

  function detail() {
    const k = K[cur], d = (DT[k[7]] || GEN(cur))(), bg = hasF(cur) && k[3](c) != null ? `<span class="badge s${stat(cur, c)}"><i>${SI[stat(cur, c)]}</i>${SN[stat(cur, c)]}</span> <span class="s">${metaTxt(cur)}</span>` : '<span class="badge s3"><i>—</i>Sem dados</span>';
    const dh = $('#dh'); if (dh) dh.innerHTML = `<div class="dh"><div><div class="t">${k[1]}</div><div class="big">${escaparTextoHtml(k[2](c))}</div></div><div>${bg}${dlt(k)}<div class="s">${escaparTextoHtml(k[6](c))}</div></div></div><p class="dd">${escaparTextoHtml(d.d)}</p>`;
    const ch = $('#ch'); if (ch) ch.innerHTML = d.st.map(([rotulo, valor]) => `<div><b>${escaparTextoHtml(valor)}</b><span>${escaparTextoHtml(rotulo)}</span></div>`).join('');
    put(d.pn, '#dg', 'd');
  }

  const SN = ['Vermelho', 'Amarelo', 'Verde'], SI = ['✕', '!', '✓'];
  const hasF = i => K[i] && K[i][9] != null, fv = (i, v) => K[i][8](v);
  const kSourceText = (k, m) => {
    const val = k[3](m);
    if (val == null) return 'Aguardando dados no banco de dados';
    if (k[12] === 2 || (k[7] === 'res' && m.surveyCount)) return 'Pesquisa local';
    return 'Calculado do banco de dados (MySQL)';
  };
  const metaTxt = i => { const k = K[i]; return `Meta ${k[4] < 0 ? '≤' : '≥'} ${fv(i, k[9])} · crítico ${k[4] < 0 ? '>' : '<'} ${fv(i, k[10])}`; };
  const stv = (i, v) => {
    if (v == null) return 3;
    const k = K[i];
    return k[4] < 0 ? (v <= k[9] ? 2 : v <= k[10] ? 1 : 0) : (v >= k[9] ? 2 : v >= k[10] ? 1 : 0);
  };
  const stat = (i, m) => stv(i, K[i][3](m));
  const gap = (i, m) => {
    const k = K[i], v = k[3](m);
    if (v == null) return 0;
    return k[4] < 0 ? (v - k[9]) / (k[10] - k[9]) : (k[9] - v) / (k[9] - k[10]);
  };
  const pen = x => x.st === 2 ? 0 : (x.st === 0 ? 1 : 0) + x.w * Math.max(0, x.g);

  // Calcula a nota macro de cada um dos 8 painéis considerando APENAS os indicadores com dados reais
  function macro(p, m) {
    const ss = K.map((k, i) => [k, i])
      .filter(([k, i]) => k[0] === p && hasF(i) && k[3](m) != null && Number.isFinite(k[3](m)))
      .map(([k, i]) => ({ i, w: k[11], st: stat(i, m), g: gap(i, m) }));

    if (!ss.length) return { ss: [], sc: null, st: null };
    const tw = ss.reduce((a, x) => a + x.w, 0) || 1;
    const sc = Math.round(ss.reduce((a, x) => a + x.w * [0, 50, 100][x.st], 0) / tw);
    let st = sc >= 75 ? 2 : sc >= 30 ? 1 : 0;
    if (ss.some(x => x.st === 0)) st = Math.min(st, 1);
    return { ss, sc, st };
  }

  const srcTag = p => {
    const l = K.filter(k => k[0] === p);
    const withData = l.filter(k => k[3](c) != null).length;
    if (withData === 0) return 'sem dados no banco';
    return `${withData} indicador${withData > 1 ? 'es' : ''} ativo${withData > 1 ? 's' : ''}`;
  };
  function put(list, elSelector, pre) {
    const target = $(elSelector);
    if (!target) return;
    target.innerHTML = list.map((x, i) => `<div class="p${x.w ? ' w' : ''}"><h3>${escaparTextoHtml(x.t)}</h3><div class="h">${escaparTextoHtml(x.h || '')}</div>${x.html || `<div class="cv${/radar|polar|bubble/.test(x.cfg.type) ? ' tall' : ''}"><canvas id="${pre}${i}"></canvas></div>`}</div>`).join('');
    list.forEach((x, i) => x.cfg && mk(pre + i, x.cfg));
    const s = $('#pv'); if (s) s.addEventListener('change', e => { PV = e.target.value; render(); });
  }

  const GEN = i => () => {
    const k = K[i], by = typeof k[14] === 'function', nm = by ? k[14].n : (k[14] || TER), f = hasF(i), val = k[3](c);
    const hasData = val != null;
    const vc = by ? k[14](A) : nm.map(() => 0);
    const gr = nm === TER ? 'terapia' : nm === AGE ? 'faixa etária' : 'grupo';
    return {
      d: k[13],
      st: [['Valor atual', hasData ? k[2](c) : 'Sem dados'], ['Período anterior', k[3](p) != null ? k[8](k[3](p)) : 'Sem dados'], ['Meta (verde)', f ? (k[4] < 0 ? '≤ ' : '≥ ') + fv(i, k[9]) : 'Informativo'], ['Fonte', kSourceText(k, c)]],
      pn: [tr(m => m.hasAppointments ? k[3](m) : null, 'Evolução · ' + k[1], i),
      { t: 'Por ' + gr, h: 'Valor de cada grupo no período', cfg: { type: 'bar', data: { labels: nm.map(sh), datasets: [{ data: vc, backgroundColor: safeP(0) }] }, options: opt({ ix: 'y' }) } }]
    };
  };

  const kcard = i => {
    const k = K[i];
    const val = k[3](c);
    const hasData = val != null && Number.isFinite(val);
    const f = hasF(i) && hasData, s = f ? stat(i, c) : 3;
    const valDisplay = hasData ? k[2](c) : 'Sem dados';
    const subDisplay = hasData
      ? (f ? metaTxt(i) + ' · peso ' + Math.round(k[11] * 100) + '%' : 'Informativo')
      : 'Sem dados suficientes no período';
    const srcDisplay = kSourceText(k, c);
    return `<button class="kc ${f ? 's' + s : 's3'}" data-i="${i}" aria-label="Abrir análise: ${k[1]}">
      <span class="kt">${f ? `<i class="dot">${SI[s]}</i>` : `<i class="dot">—</i>`}${k[1]}</span>
      <b class="kv">${escaparTextoHtml(valDisplay)}</b>
      <span class="km">${subDisplay}</span>
      ${hasData ? dlt(k) : '<div class="d flat">Aguardando dados no banco</div>'}
      <span class="ks">${srcDisplay}</span>
    </button>`;
  };

  function home() {
    const R = PN.map((pn, p) => ({ p, pn, ...macro(p, c) }));
    const rated = R.filter(r => r.sc !== null && Number.isFinite(r.sc));
    const all = R.flatMap(r => r.ss.map(x => ({ ...x, r, pn: pen(x) }))).filter(x => Number.isFinite(x.pn)).sort((a, b) => b.pn - a.pn);

    let geral;
    if (rated.length === 0) {
      geral = `<div class="alerta s3" role="status"><span class="dot">—</span><div><small>Visão geral da clínica</small><b>Aguardando dados operacionais</b><span>Nenhum atendimento suficiente registrado no período selecionado. Os 8 painéis serão avaliados conforme houver registros no banco de dados.</span></div></div><div class="home-spacer"></div>`;
    } else {
      const ov = Math.round(rated.reduce((sum, r) => sum + r.sc, 0) / Math.max(1, rated.length));
      const os = Math.min(ov >= 75 ? 2 : ov >= 30 ? 1 : 0, R.some(r => r.st === 0) ? 1 : 2);
      const nR_ = R.filter(r => r.st === 0).length, nY_ = R.filter(r => r.st === 1).length, nG_ = R.filter(r => r.st === 2).length, nD_ = R.length - rated.length;
      geral = `<div class="alerta s${os}" role="status"><span class="dot">${SI[os]}</span><div><small>Visão geral da clínica</small><b>Nota geral ${ov}/100 · ${SN[os]}</b><span>${nR_} painéis críticos · ${nY_} em atenção · ${nG_} no verde · ${nD_} sem dados suficientes</span></div></div><div class="home-spacer"></div>`;
    }

    const alertaEl = $('#alerta');
    if (alertaEl) {
      if (all.length > 0 && all[0].st < 2 && c.hasAppointments) {
        const t = all[0];
        const rest = all.filter(x => x.st < 2).slice(1, 5);
        alertaEl.innerHTML = geral + `<div class="alerta s${t.st}" role="alert"><span class="dot">${SI[t.st]}</span><div><small>Maior foco de atenção agora</small><b>${K[t.i][1]} <em>· ${t?.r?.pn?.n || 'Geral'}</em></b><span>${escaparTextoHtml(K[t.i][2](c))} · ${metaTxt(t.i)}</span></div><button class="bk" data-i="${t.i}">Abrir análise</button></div>`
          + (rest.length ? `<div class="rk"><span>Depois dele:</span>${rest.map((x, j) => `<button class="s${x.st}" data-i="${x.i}"><i class="dot">${SI[x.st]}</i>${j + 2}º ${K[x.i][1]} · ${escaparTextoHtml(K[x.i][2](c))}</button>`).join('')}</div>` : '');
      } else {
        alertaEl.innerHTML = geral;
      }
    }

    // RENDERIZAÇÃO DOS 8 PAINÉIS
    const tilesEl = $('#tiles');
    if (tilesEl) {
      tilesEl.innerHTML = R.map(r => {
        const w = [...r.ss].sort((a, b) => pen(b) - pen(a))[0];
        const nr = r.ss.filter(x => x.st === 0).length, ny = r.ss.filter(x => x.st === 1).length;
        const noData = r.sc === null;
        const status = noData ? 'Sem dados' : SN[r.st];
        return `<button class="tile ${noData ? 's3' : 's' + r.st}" data-p="${r.p}" aria-label="Abrir painel ${r.pn.n}">
          <header>
            <b>${r.p + 1}. ${r.pn.n}</b>
            <span class="badge ${noData ? 's3' : 's' + r.st}"><i>${noData ? '—' : SI[r.st]}</i>${status}</span>
          </header>
          <div class="sc"><b>${noData ? '—' : r.sc}</b><span>${noData ? '' : '/100'}</span></div>
          <small>${noData ? 'Aguardando registros no banco de dados' : `${nr} crítico${nr === 1 ? '' : 's'} · ${ny} em atenção · ${srcTag(r.p)}`}</small>
          ${!noData && w && w.st < 2 ? `<span class="foco">Foco: ${K[w.i][1]} · ${K[w.i][2](c)}</span>` : `<span class="foco">${noData ? 'Sem dados suficientes' : 'Tudo dentro da meta'}</span>`}
        </button>`;
      }).join('');
    }

    const rtEl = $('#rt');
    if (rtEl) {
      rtEl.innerHTML = '<thead><tr><th>Painel</th><th>Indicador</th><th>Fórmula</th><th>Fonte</th><th>Peso</th><th>Verde</th><th>Amarelo</th><th>Vermelho</th></tr></thead><tbody>' + K.map((k, i) => {
        const f = hasF(i);
        return `<tr><td>${K.findIndex(z => z[0] === k[0]) === i ? '<b>' + (k[0] + 1) + '. ' + PN[k[0]].n + '</b>' : ''}</td><td>${k[1]}</td><td>${k[13]}</td><td>${kSourceText(k, c)}</td><td>${f ? Math.round(k[11] * 100) + '%' : '—'}</td><td>${f ? (k[4] < 0 ? '≤ ' : '≥ ') + fv(i, k[9]) : 'Informativo'}</td><td>${f ? (k[4] < 0 ? fv(i, k[9]) + ' a ' + fv(i, k[10]) : fv(i, k[10]) + ' a ' + fv(i, k[9])) : '—'}</td><td>${f ? (k[4] < 0 ? '> ' : '< ') + fv(i, k[10]) : '—'}</td></tr>`;
      }).join('') + '</tbody>';
    }
  }

  function panel() {
    const r = macro(pan, c), pn = PN[pan];
    const noData = r.sc === null;
    const phEl = $('#ph');
    if (phEl) phEl.innerHTML = `<div class="dh"><div><div class="t">Painel ${pan + 1} de ${PN.length}</div><h2 class="panel-title">${pn.n}</h2></div><div><span class="badge ${noData ? 's3' : 's' + r.st}"><i>${noData ? '—' : SI[r.st]}</i>${noData ? 'Sem dados' : SN[r.st]}</span><div class="sc"><b>${noData ? '—' : r.sc}</b><span>${noData ? '' : '/100 nota do painel'}</span></div></div></div><p class="dd">${pn.d} · ${srcTag(pan)}. ${noData ? 'Os indicadores deste painel serão calculados conforme forem inseridos registros no banco de dados da clínica.' : 'A nota é a soma ponderada dos indicadores ativos no período.'}</p>`;
    const pkEl = $('#pk');
    if (pkEl) pkEl.innerHTML = K.map((k, i) => i).filter(i => K[i][0] === pan).map(kcard).join('');
    if (EX[pan] && c.hasAppointments) put(DT[EX[pan]]().pn, '#px', 'x');
    else if ($('#px')) $('#px').innerHTML = '';
    const calblkEl = $('#calblk');
    if (calblkEl) {
      calblkEl.hidden = pan !== 0;
      if (pan === 0) calendar();
    }
  }

  /* ===== Calendário ===== */
  const MN = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'], PT = ['Início (dias 1–10)', 'Meio (dias 11–20)', 'Final (dia 21 em diante)'], DNF = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const T0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()), OLD = new Date(T0.getFullYear(), T0.getMonth(), T0.getDate() - 729);
  let CMo = null;
  const fdn = i => DNF[i] + (i < 5 ? '-feira' : '');
  const MT = { NC: { n: 'Não comparecimento (%)', s: 'não comparecimento', pc: 1, f: x => x.c + x.n }, C: { n: 'Cancelamentos (%)', s: 'cancelamentos', pc: 1, f: x => x.c }, N: { n: 'No-show (%)', s: 'no-show', pc: 1, f: x => x.n }, R: { n: 'Atendimentos realizados (média por dia)', s: 'atendimentos', pc: 0, f: x => x.r }, A: { n: 'Agendamentos (média por dia)', s: 'agendamentos', pc: 0, f: x => x.t } };
  const hcl = (v, mx) => `background:rgba(${css('--rgb') || '38,43,107'},${(.08 + .87 * Math.min(1, v / (mx || 1))).toFixed(2)});color:${v / (mx || 1) > .55 ? css('--onacc') || '#fff' : css('--ink') || '#181924'}`;

  function calendar() {
    const cyEl = $('#cy'), cmEl = $('#cm');
    if (!cyEl || !cmEl) return;
    const Y = +cyEl.value, mt = cmEl.value, Q = MT[mt] || MT.NC, k3 = {};
    const pr = (l, f) => { const t = l.reduce((a, x) => a + x.t, 0); return t ? l.reduce((a, x) => a + f(x), 0) / t * 100 : 0; };
    const ag = l => Q.pc ? pr(l, Q.f) : (l.length ? l.reduce((a, x) => a + Q.f(x), 0) / l.length : 0);
    const fm = v => Q.pc ? nf(v) + '%' : nf(v), dv = x => Q.pc ? (x.t ? Q.f(x) / x.t * 100 : 0) : Q.f(x), nc = x => x.c + x.n, pts = l => [l.filter(x => x.d <= 10), l.filter(x => x.d > 10 && x.d <= 20), l.filter(x => x.d > 20)];
    D.forEach(x => {
      if (sp >= 0 && x.sp !== sp) return;
      const dt = new Date(T0.getFullYear(), T0.getMonth(), T0.getDate() - x.d);
      if (dt.getFullYear() !== Y) return;
      const k = dt.getMonth() * 32 + dt.getDate(), o = k3[k] || (k3[k] = { R: 0, C: 0, N: 0, M: 0, T: 0 });
      o.T++; if (o[x.s] !== undefined) o[x.s]++;
    });
    const MS = [];
    for (let m = 0; m < 12; m++) {
      const ds = [];
      for (let d = 1, n = new Date(Y, m + 1, 0).getDate(); d <= n; d++) {
        const dt = new Date(Y, m, d), ok = dt >= OLD && dt <= T0, q = (ok && k3[m * 32 + d]) || { R: 0, C: 0, N: 0, M: 0, T: 0 };
        ds.push({ d, w: dt.getDay(), ok, r: q.R, c: q.C, n: q.N, t: q.T });
      }
      const va = ds.filter(x => x.ok), sm = k => va.reduce((a, x) => a + x[k], 0), tR = sm('r'), tC = sm('c'), tN = sm('n'), tT = sm('t');
      MS.push({ m, ds, va, tR, tC, tN, tT, nc: tT ? (tC + tN) / tT * 100 : 0, cr: tT ? tC / tT * 100 : 0, ns: tT ? tN / tT * 100 : 0, agg: ag(va), wd: diasDaSemana.map(w => ag(va.filter(x => x.w === w))), pt: pts(va).map(ag) });
    }
    const all = MS.flatMap(x => x.va), ywd = diasDaSemana.map(w => ag(all.filter(x => x.w === w))), ypt = pts(all).map(ag), yag = ag(all);
    const wdNC = diasDaSemana.map(w => pr(all.filter(x => x.w === w), nc)), wdC = diasDaSemana.map(w => pr(all.filter(x => x.w === w), x => x.c)), wdN = diasDaSemana.map(w => pr(all.filter(x => x.w === w), x => x.n)), ncY = pr(all, nc), ptNC = pts(all).map(l => pr(l, nc));
    const w5 = MS.filter(x => x.va.length >= 5), best = [...w5].sort((a, b) => b.agg - a.agg)[0], mNC = [...w5].sort((a, b) => b.nc - a.nc)[0];
    if (CMo === null || !MS[CMo] || !MS[CMo].va.length) CMo = Y === T0.getFullYear() ? T0.getMonth() : (best ? best.m : 0);
    const dd = (m, x) => String(x.d).padStart(2, '0') + '/' + String(m + 1).padStart(2, '0'), pd = (x, k) => x.t ? Math.round(k / x.t * 100) : 0;
    const mxd = Math.max(1e-9, ...all.map(dv)), tip = (m, x) => `${x.d}/${m + 1}: ${x.r} atendimentos · ${x.c} cancelamentos (${pd(x, x.c)}%) · ${x.n} no-show (${pd(x, x.n)}%) · não comparecimento ${pd(x, nc(x))}% de ${x.t} agendamentos`;

    const ciEl = $('#ci');
    if (ciEl) ciEl.innerHTML = (mNC && all.length > 0) ? `<b>Onde as ausências pesam mais em ${Y}:</b> <strong>${fdn(maxI(wdNC))}</strong> com ${nf(Math.max(...wdNC))}% de não comparecimento (média do ano ${nf(ncY)}%) · pior mês: <strong>${MN[mNC.m]}</strong> (${nf(mNC.nc)}%) · parte do mês: <strong>${PT[maxI(ptNC)].split(' (')[0].toLowerCase()}</strong> (${nf(Math.max(...ptNC))}%).` : '<b>Calendário:</b> Sem atendimentos suficientes registrados neste ano no banco de dados.';

    const bd = [...all.filter(x => !Q.pc || x.t >= 5)].sort((a, b) => dv(b) - dv(a))[0];
    const ccEl = $('#cc');
    if (ccEl) ccEl.innerHTML = [
      [`Mês com maior ${Q.s}`, (best && all.length > 0) ? `${MN[best.m]} · ${fm(best.agg)}` : 'Sem dados'],
      [`Dia da semana com maior ${Q.s}`, all.length ? `${dn[maxI(ywd)]} · ${fm(Math.max(...ywd))}` : 'Sem dados'],
      [`Parte do mês com maior ${Q.s}`, all.length ? `${PT[maxI(ypt)].split(' (')[0]} · ${fm(Math.max(...ypt))}` : 'Sem dados'],
      [`Dia do ano com maior ${Q.s}`, (bd && all.length > 0) ? `${dd(MS.find(z => z.va.includes(bd))?.m || 0, bd)} · ${fm(dv(bd))}` : 'Sem dados']
    ].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');

    const mxv = Math.max(1e-9, ...MS.flatMap(x => x.wd)), cs = v => mt === 'NC' ? `class="f${stat(KI.nc, { nc: v })}"` : `style="${hcl(v, mxv)}"`;
    const mat = `<div class="hm heatmap-year"><div class="l"></div>${dn.map(d => `<div class="l">${d}</div>`).join('')}<div class="l">Mês</div>${MS.map(ms => `<div class="l">${MN[ms.m].slice(0, 3)}</div>` + (ms.va.length ? ms.wd.map(v => `<div ${cs(v)}>${fm(v)}</div>`).join('') + `<div ${cs(ms.agg)}><b>${fm(ms.agg)}</b></div>` : '<div class="l">–</div>'.repeat(diasDaSemana.length + 1))).join('')}<div class="l"><b>Ano</b></div>${ywd.map(v => `<div ${cs(v)}><b>${fm(v)}</b></div>`).join('')}<div ${cs(yag)}><b>${fm(yag)}</b></div></div>`;

    const cyrEl = $('#cyr');
    if (cyrEl) {
      cyrEl.innerHTML = `<div class="p w"><h3>Mês × dia da semana · ${Q.n}</h3><div class="h">${mt === 'NC' ? `Cor pelo farol: verde ≤ ${fv(KI.nc, K[KI.nc][9])} · amarelo ≤ ${fv(KI.nc, K[KI.nc][10])} · vermelho acima` : 'Cor mais forte = valor maior'} · a linha "Ano" e a coluna "Mês" resumem o total</div><div class="scroll-x">${mat}</div></div>
      <div class="p"><h3>Ausências por dia da semana (ano todo)</h3><div class="h">% dos agendamentos · cancelamento + no-show = não comparecimento</div><div class="cv"><canvas id="cwd"></canvas></div></div>
      <div class="p w"><h3>Dia da semana ao longo dos meses</h3><div class="h">${Q.n} · compare os dias sem clicar mês a mês</div><div class="cv"><canvas id="cwm"></canvas></div></div>`;
      mk('cwd', { type: 'bar', data: { labels: dn, datasets: [['Cancelamentos', wdC, safeP(2)], ['No-show', wdN, safeP(1)]].map(([n, d, col]) => ({ label: n, data: d.map(f1), backgroundColor: col })) }, options: opt({ st: 1, lg: 1 }) });
      mk('cwm', { type: 'bar', data: { labels: MN.map(x => x.slice(0, 3)), datasets: dn.map((d, i) => ({ label: d, data: MS.map(ms => ms.va.length ? f1(ms.wd[i]) : null), backgroundColor: safeCAT(i) })) }, options: opt({ lg: 1 }) });
    }

    const calEl = $('#cal');
    if (calEl) {
      calEl.innerHTML = MS.map(ms => `<button class="mc${ms.va.length ? ' s' + stat(KI.nc, { nc: ms.nc }) : ''}${ms.m === CMo ? ' on' : ''}" data-m="${ms.m}" aria-pressed="${ms.m === CMo}"${ms.va.length ? '' : ' disabled'}><b>${MN[ms.m]}</b>${ms.va.length ? `<span>Atend. ${ms.tR} · NC <strong>${nf(ms.nc)}%</strong></span><br><span>Cancel. ${nf(ms.cr)}% · No-show ${nf(ms.ns)}%</span>` : '<span>sem dados</span>'}<div class="mg">${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(x => `<i class="l">${x}</i>`).join('')}${'<i></i>'.repeat((new Date(Y, ms.m, 1).getDay() + 6) % 7)}${ms.ds.map(x => x.ok ? `<i style="${hcl(dv(x), mxd)}" title="${tip(ms.m, x)}">${x.d}</i>` : `<i class="off">${x.d}</i>`).join('')}</div></button>`).join('');
    }

    const S = MS[CMo] || MS[0], wi = maxI(S.wd), pi = maxI(S.pt), bm = [...S.va.filter(x => !Q.pc || x.t >= 3)].sort((a, b) => dv(b) - dv(a))[0], mxM = Math.max(1e-9, ...S.va.map(dv));
    const st = [['Atendimentos realizados', S.tR], ['Não comparecimento', S.tR ? `${nf(S.nc)}% · ${S.tC + S.tN} consultas` : 'Sem dados'], ['Cancelamentos', S.tR ? `${nf(S.cr)}% · ${S.tC}` : 'Sem dados'], ['No-show', S.tR ? `${nf(S.ns)}% · ${S.tN}` : 'Sem dados'], [`Dia da semana com maior ${Q.s}`, S.va.length ? `${dn[wi]} · ${fm(S.wd[wi])}` : '—'], [`Parte do mês com maior ${Q.s}`, S.va.length ? `${PT[pi].split(' (')[0]} · ${fm(S.pt[pi])}` : '—'], [`Dia com maior ${Q.s}`, bm ? `${dd(CMo, bm)} · ${fm(dv(bm))}` : '—']];
    const big = `<div class="cg">${['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(x => `<i class="l">${x}</i>`).join('')}${'<i></i>'.repeat((new Date(Y, CMo, 1).getDay() + 6) % 7)}${S.ds.map(x => x.ok ? `<i title="${tip(CMo, x)}" style="${hcl(dv(x), mxM)}">${x.d}<b>${x.r}</b><small>${x.t ? 'NC ' + pd(x, nc(x)) + '%' : '—'}</small></i>` : `<i class="off">${x.d}</i>`).join('')}</div>`;

    const cdEl = $('#cd');
    if (cdEl) {
      cdEl.innerHTML = `<div class="chips">${st.map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      <div class="grid"><div class="p w"><h3>${MN[CMo]} de ${Y}</h3><div class="h">Número grande: atendimentos realizados · NC: não comparecimento (cancelamentos + no-show ÷ agendamentos do dia) · cor segue &quot;${Q.n}&quot; · passe o mouse no dia para ver os detalhes</div>${big}</div>
      <div class="p w"><h3>Dia a dia em ${MN[CMo]} (%)</h3><div class="h">Não comparecimento, cancelamentos e no-show sobre os agendamentos de cada dia</div><div class="cv"><canvas id="cdl"></canvas></div></div>
      <div class="p"><h3>Dia da semana: mês x média do ano</h3><div class="h">${Q.n}</div><div class="cv"><canvas id="cw"></canvas></div></div>
      <div class="p"><h3>Início, meio e final do mês</h3><div class="h">${Q.n}</div><div class="cv"><canvas id="cp"></canvas></div></div>
      <div class="p w"><h3>Cancelamentos e no-show por mês (%)</h3><div class="h">${Y} · % dos agendamentos de cada mês</div><div class="cv"><canvas id="cmn"></canvas></div></div></div>`;
      const a = safeP(0), b = safeP(1), pdv = (x, f) => x.ok && x.t ? f1(f(x) / x.t * 100) : null;
      mk('cdl', lc(S.ds.map(x => x.d), [['Não comparecimento', S.ds.map(x => pdv(x, nc)), safeP(2)], ['Cancelamentos', S.ds.map(x => pdv(x, y => y.c)), b], ['No-show', S.ds.map(x => pdv(x, y => y.n)), safeP(3)]]));
      mk('cw', { type: 'bar', data: { labels: dn, datasets: [{ label: MN[CMo], data: S.wd.map(f1), backgroundColor: a }, { type: 'line', label: 'Média do ano', data: ywd.map(f1), borderColor: b, backgroundColor: b, tension: .3, pointRadius: 3 }] }, options: opt({ lg: 1 }) });
      mk('cp', { type: 'bar', data: { labels: PT.map(x => x.split(' (')[0]), datasets: [{ label: MN[CMo], data: S.pt.map(f1), backgroundColor: a }, { label: 'Média do ano', data: ypt.map(f1), backgroundColor: b }] }, options: opt({ lg: 1 }) });
      mk('cmn', { type: 'bar', data: { labels: MN.map(x => x.slice(0, 3)), datasets: [['Cancelamentos', 'cr', safeP(2)], ['No-show', 'ns', b]].map(([n, k, col]) => ({ label: n, data: MS.map(x => x.va.length ? f1(x[k]) : null), backgroundColor: col })) }, options: opt({ st: 1, lg: 1 }) });
    }
  }

  function render() {
    CH.forEach(x => { try { x.destroy(); } catch { /* O gráfico pode já ter sido descartado. */ } });
    CH = [];
    const perEl = $('#per'), espEl = $('#esp');
    N = perEl ? +perEl.value : 30;
    sp = espEl ? +espEl.value : -1;
    c = M(0, N, sp); p = M(N, 2 * N, sp); A = sp < 0 ? c : M(0, N, -1); AP = sp < 0 ? p : M(N, 2 * N, -1);
    if (Chart.defaults) Chart.defaults.font.family = 'Figtree,system-ui,sans-serif';
    if ($('#home')) $('#home').hidden = !(pan === null && cur === null);
    if ($('#pan')) $('#pan').hidden = !(pan !== null && cur === null);
    if ($('#det')) $('#det').hidden = cur === null;
    if (cur !== null) detail(); else if (pan !== null) panel(); else home();
  }

  function go(p, i, pop) {
    pan = p; cur = i;
    if (!pop) try { history.pushState({ p, i }, ''); } catch { /* A navegação interna funciona mesmo sem atualizar o histórico. */ }
    render();
    containerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const b = $(i !== null ? '#bk' : '#bk2'); if (p !== null && b) b.focus();
  }
  const back = () => cur !== null ? go(pan, null) : go(null, null);

  // Inicializa selects
  const espEl = $('#esp');
  if (espEl) {
    espEl.replaceChildren(new Option('Todas', '-1'), ...SP.map(([nome], i) => new Option(nome, String(i))));
  }
  const cyEl = $('#cy');
  if (cyEl) {
    cyEl.innerHTML = Array.from({ length: T0.getFullYear() - OLD.getFullYear() + 1 }, (_, i) => OLD.getFullYear() + i).map(y => `<option${y === T0.getFullYear() ? ' selected' : ''}>${y}</option>`).join('');
  }

  // Registra eventos no container
  const onClick = e => {
    const k = e.target.closest('[data-i]'), q = e.target.closest('[data-p]');
    if (e.target.closest('[data-back]')) back();
    else if (k) go(K[+k.dataset.i][0], +k.dataset.i);
    else if (q) go(+q.dataset.p, null);

    const bMonth = e.target.closest('[data-m]');
    if (bMonth && !bMonth.disabled) {
      CMo = +bMonth.dataset.m;
      render();
      const cdEl = $('#cd');
      if (cdEl) cdEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (e.target.closest('#clear-survey')) {
      if (!confirm('Apagar todas as respostas de pesquisa salvas neste navegador?')) return;
      const erro = apagarRespostasPesquisa();
      if (!erro) {
        SURVEY_RESPONSES = [];
        surveyStorageError = '';
      }
      surveyNotice = { texto: erro || 'Respostas locais apagadas.', falha: Boolean(erro) };
      render();
    }
  };

  const onSubmit = e => {
    if (e.target.id !== 'patient-survey') return;
    e.preventDefault();
    if (surveyStorageError) { surveyNotice = { texto: surveyStorageError, falha: true }; render(); return; }
    const resposta = lerRespostaPesquisa(new FormData(e.target));
    if (!resposta) {
      surveyNotice = { texto: 'Confira cada pergunta e tente novamente.', falha: true };
    } else {
      const novasRespostas = [...SURVEY_RESPONSES, resposta];
      const erro = salvarRespostasPesquisa(novasRespostas);
      if (!erro) SURVEY_RESPONSES = novasRespostas;
      surveyNotice = { texto: erro || 'Respostas salvas. Indicadores atualizados.', falha: Boolean(erro) };
    }
    render();
  };

  const onChange = e => {
    if (['per', 'esp', 'cm'].includes(e.target.id)) {
      render();
    } else if (e.target.id === 'cy') {
      CMo = null;
      render();
    } else if (e.target.id === 'therapy-chart-type') {
      TR_TYPE = e.target.value; refreshTherapyRevenueView();
    } else if (e.target.id === 'therapy-select-all') {
      TR_SELECTED = e.target.checked ? new Set(SP.map((_, i) => i)) : new Set();
      refreshTherapyRevenueView();
    } else if (e.target.matches('[data-revenue-therapy]')) {
      const index = Number(e.target.dataset.revenueTherapy);
      if (e.target.checked) TR_SELECTED.add(index); else TR_SELECTED.delete(index);
      refreshTherapyRevenueView();
    }
  };

  const onPopState = e => { const s = e.state || {}; go(s.p ?? null, s.i ?? null, 1); };
  const onKeyDown = e => { if (e.key === 'Escape' && (pan !== null || cur !== null)) back(); };
  const onStorage = e => {
    if (e.key !== SURVEY_STORAGE_KEY) return;
    const { respostas, erro } = carregarRespostasPesquisa();
    SURVEY_RESPONSES = respostas;
    surveyStorageError = erro;
    surveyNotice = erro ? null : { texto: 'As respostas foram atualizadas em outra aba.', falha: false };
    render();
  };

  containerEl.addEventListener('click', onClick);
  containerEl.addEventListener('submit', onSubmit);
  containerEl.addEventListener('change', onChange);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('storage', onStorage);

  // Render inicial
  render();

  // Função de desmontagem (cleanup)
  return () => {
    CH.forEach(x => { try { x.destroy(); } catch { /* O gráfico pode já ter sido descartado. */ } });
    CH = [];
    containerEl.removeEventListener('click', onClick);
    containerEl.removeEventListener('submit', onSubmit);
    containerEl.removeEventListener('change', onChange);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('storage', onStorage);
  };
}
