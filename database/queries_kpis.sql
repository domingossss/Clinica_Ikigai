-- =====================================================================
-- GUIA TÉCNICO DE BANCO DE DADOS UNIFICADO - CLÍNICA IKIGAI
-- Arquivo: queries_kpis.sql
-- Descrição: Consultas SQL de Alta Performance para Todos os KPIs e Dashboards
-- Compatibilidade: MySQL 8.0+
-- =====================================================================

USE clinica_ikigai_db;

-- Variáveis de Sessão para Simulação de Filtros (Exemplo: 30 dias, Todas as Especialidades)
SET @periodo_dias = 30;
SET @id_especialidade = -1; -- -1 significa 'Todas'
SET @data_fim = NOW();
SET @data_inicio = DATE_SUB(@data_fim, INTERVAL @periodo_dias DAY);
SET @data_inicio_anterior = DATE_SUB(@data_inicio, INTERVAL @periodo_dias DAY);

-- =====================================================================
-- 1. CONSULTA UNIFICADA DE RESUMO (KPIs Principais do Período Atual)
-- =====================================================================
SELECT 
    -- Totais de Agendamentos
    COUNT(a.id_agendamento) AS total_agendamentos,
    SUM(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN 1 ELSE 0 END) AS total_realizados,
    SUM(CASE WHEN a.status = 'Cancelado' THEN 1 ELSE 0 END) AS total_cancelados,
    SUM(CASE WHEN a.status = 'No_Show' THEN 1 ELSE 0 END) AS total_noshow,
    SUM(CASE WHEN a.status = 'Reagendado' THEN 1 ELSE 0 END) AS total_reagendados,

    -- KPI 0: Taxa de Reagendamento (%)
    ROUND(SUM(CASE WHEN a.status = 'Reagendado' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id_agendamento), 0) * 100, 1) AS taxa_reagendamento,

    -- KPI 1: Taxa de Não Comparecimento (%) e desdobramentos
    ROUND(SUM(CASE WHEN a.status IN ('Cancelado', 'No_Show') THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id_agendamento), 0) * 100, 1) AS taxa_nao_comparecimento,
    ROUND(SUM(CASE WHEN a.status = 'Cancelado' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id_agendamento), 0) * 100, 1) AS taxa_cancelamento,
    ROUND(SUM(CASE WHEN a.status = 'No_Show' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id_agendamento), 0) * 100, 1) AS taxa_noshow,

    -- KPI 3: Atraso Médio nas Consultas Realizadas (minutos)
    ROUND(AVG(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN a.minutos_atraso ELSE NULL END), 1) AS atraso_medio_minutos,

    -- KPI 7: Ticket Médio das Consultas Realizadas (R$)
    ROUND(AVG(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN a.valor_cobrado ELSE NULL END), 2) AS ticket_medio,

    -- Receita Total Realizada (R$)
    ROUND(SUM(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN a.valor_cobrado ELSE 0 END), 2) AS receita_total_realizada,

    -- KPI 8: Taxa de Retorno (%)
    ROUND(SUM(CASE WHEN a.status IN ('Realizado', 'Concluído') AND a.tipo_atendimento = 'Retorno' THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN 1 ELSE 0 END), 0) * 100, 1) AS taxa_retorno,

    -- KPI 9: Resolução sem Humano (%)
    ROUND(SUM(CASE WHEN a.origem = 'Chatbot' AND a.status IN ('Realizado', 'Concluído') AND a.escalonado_humano = 0 THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN a.origem = 'Chatbot' THEN 1 ELSE 0 END), 0) * 100, 1) AS resolucao_sem_humano,
    SUM(CASE WHEN a.origem = 'Chatbot' THEN 1 ELSE 0 END) AS agendamentos_bot,
    SUM(CASE WHEN a.origem = 'Chatbot' AND a.status IN ('Realizado', 'Concluído') AND a.escalonado_humano = 0 THEN 1 ELSE 0 END) AS bot_concluidos_sem_humano
FROM agendamento a
JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
WHERE a.data_hora_agendamento >= @data_inicio 
  AND a.data_hora_agendamento < @data_fim
  AND (@id_especialidade = -1 OR pr.id_especialidade = @id_especialidade);

-- =====================================================================
-- 2. KPI 2: OCUPAÇÃO DA AGENDA (%)
-- Fórmula: Horários Preenchidos (Não Cancelados) ÷ Capacidade Total Disponível
-- =====================================================================
SELECT 
    sub.horarios_preenchidos,
    cap.vagas_totais_periodo,
    ROUND(sub.horarios_preenchidos / NULLIF(cap.vagas_totais_periodo, 0) * 100, 1) AS taxa_ocupacao
FROM (
    SELECT COUNT(*) AS horarios_preenchidos
    FROM agendamento a
    JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
    WHERE a.data_hora_agendamento >= @data_inicio 
      AND a.data_hora_agendamento < @data_fim
      AND a.status != 'Cancelado'
      AND (@id_especialidade = -1 OR pr.id_especialidade = @id_especialidade)
) sub
CROSS JOIN (
    SELECT COALESCE(SUM(vagas_totais), 1) AS vagas_totais_periodo
    FROM capacidade_diaria
    WHERE data_referencia >= DATE(@data_inicio) 
      AND data_referencia < DATE(@data_fim)
      AND (@id_especialidade = -1 OR id_especialidade = @id_especialidade OR id_especialidade IS NULL)
) cap;

-- =====================================================================
-- 3. KPI 6: SATISFAÇÃO (NPS)
-- Fórmula: (% Promotores [9-10] - % Detratores [0-6]) entre respondentes
-- =====================================================================
SELECT 
    COUNT(av.id_avaliacao) AS total_avaliacoes,
    SUM(CASE WHEN av.nota_nps >= 9 THEN 1 ELSE 0 END) AS promotores,
    SUM(CASE WHEN av.nota_nps BETWEEN 7 AND 8 THEN 1 ELSE 0 END) AS neutros,
    SUM(CASE WHEN av.nota_nps <= 6 THEN 1 ELSE 0 END) AS detratores,
    ROUND((SUM(CASE WHEN av.nota_nps >= 9 THEN 1 ELSE 0 END) - SUM(CASE WHEN av.nota_nps <= 6 THEN 1 ELSE 0 END)) / NULLIF(COUNT(av.id_avaliacao), 0) * 100, 1) AS nps_score
FROM avaliacao_atendimento av
JOIN agendamento a ON av.id_agendamento = a.id_agendamento
JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
WHERE a.data_hora_agendamento >= @data_inicio 
  AND a.data_hora_agendamento < @data_fim
  AND (@id_especialidade = -1 OR pr.id_especialidade = @id_especialidade);

-- =====================================================================
-- 4. KPI 10: CONVERSÃO EM AGENDAMENTO DO CHATBOT (%)
-- Fórmula: Agendamentos originados no bot ÷ Conversas iniciadas no bot
-- =====================================================================
SELECT 
    ag.agendamentos_bot,
    cv.conversas_iniciadas,
    ROUND(ag.agendamentos_bot / NULLIF(cv.conversas_iniciadas, 0) * 100, 1) AS taxa_conversao_bot
FROM (
    SELECT COUNT(*) AS agendamentos_bot
    FROM agendamento a
    JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
    WHERE a.origem = 'Chatbot'
      AND a.data_hora_agendamento >= @data_inicio 
      AND a.data_hora_agendamento < @data_fim
      AND (@id_especialidade = -1 OR pr.id_especialidade = @id_especialidade)
) ag
CROSS JOIN (
    SELECT COUNT(*) AS conversas_iniciadas
    FROM sessao_chatbot
    WHERE data_hora_inicio >= @data_inicio 
      AND data_hora_inicio < @data_fim
) cv;

-- =====================================================================
-- 5. KPI 4: RANKING DE ATENDIMENTOS POR ESPECIALIDADE
-- =====================================================================
SELECT 
    e.id_especialidade,
    e.nome AS especialidade,
    COUNT(a.id_agendamento) AS total_agendamentos,
    SUM(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN 1 ELSE 0 END) AS atendimentos_realizados,
    ROUND(SUM(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN a.valor_cobrado ELSE 0 END), 2) AS receita_gerada,
    ROUND(AVG(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN a.valor_cobrado ELSE NULL END), 2) AS ticket_medio,
    ROUND(SUM(CASE WHEN a.status IN ('Cancelado', 'No_Show') THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id_agendamento), 0) * 100, 1) AS taxa_nao_comparecimento
FROM especialidade e
LEFT JOIN procedimento pr ON e.id_especialidade = pr.id_especialidade
LEFT JOIN agendamento a ON pr.id_procedimento = a.id_procedimento 
    AND a.data_hora_agendamento >= @data_inicio 
    AND a.data_hora_agendamento < @data_fim
GROUP BY e.id_especialidade, e.nome
ORDER BY atendimentos_realizados DESC;

-- =====================================================================
-- 6. KPI 5: PERFIL DEMOGRÁFICO DO PACIENTE (FAIXA ETÁRIA, SEXO, CONVÊNIO)
-- =====================================================================
-- 6.1 Distribuição por Faixa Etária (Consultas Realizadas)
SELECT 
    CASE 
        WHEN TIMESTAMPDIFF(YEAR, p.data_nascimento, a.data_hora_agendamento) < 18 THEN '0–17'
        WHEN TIMESTAMPDIFF(YEAR, p.data_nascimento, a.data_hora_agendamento) BETWEEN 18 AND 30 THEN '18–30'
        WHEN TIMESTAMPDIFF(YEAR, p.data_nascimento, a.data_hora_agendamento) BETWEEN 31 AND 45 THEN '31–45'
        WHEN TIMESTAMPDIFF(YEAR, p.data_nascimento, a.data_hora_agendamento) BETWEEN 46 AND 60 THEN '46–60'
        ELSE '60+'
    END AS faixa_etaria,
    COUNT(*) AS total_pacientes,
    ROUND(COUNT(*) / NULLIF((
        SELECT COUNT(*) 
        FROM agendamento a2 
        JOIN procedimento pr2 ON a2.id_procedimento = pr2.id_procedimento
        WHERE a2.status IN ('Realizado', 'Concluído') 
          AND a2.data_hora_agendamento >= @data_inicio 
          AND a2.data_hora_agendamento < @data_fim
          AND (@id_especialidade = -1 OR pr2.id_especialidade = @id_especialidade)
    ), 0) * 100, 1) AS percentual
FROM agendamento a
JOIN paciente p ON a.id_paciente = p.id_paciente
JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
WHERE a.status IN ('Realizado', 'Concluído')
  AND a.data_hora_agendamento >= @data_inicio 
  AND a.data_hora_agendamento < @data_fim
  AND (@id_especialidade = -1 OR pr.id_especialidade = @id_especialidade)
GROUP BY faixa_etaria
ORDER BY FIELD(faixa_etaria, '0–17', '18–30', '31–45', '46–60', '60+');

-- 6.2 Proporção Convênio vs Particular
SELECT 
    a.modalidade_pagamento,
    COUNT(*) AS total,
    ROUND(COUNT(*) / NULLIF(SUM(COUNT(*)) OVER(), 0) * 100, 1) AS percentual
FROM agendamento a
JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
WHERE a.status IN ('Realizado', 'Concluído')
  AND a.data_hora_agendamento >= @data_inicio 
  AND a.data_hora_agendamento < @data_fim
  AND (@id_especialidade = -1 OR pr.id_especialidade = @id_especialidade)
GROUP BY a.modalidade_pagamento;

-- =====================================================================
-- 7. CALENDÁRIO ANUAL: MATRIZ MÊS × DIA DA SEMANA
-- =====================================================================
SELECT 
    MONTH(a.data_hora_agendamento) AS mes,
    DAYOFWEEK(a.data_hora_agendamento) AS dia_semana_num, -- 2=Seg, 3=Ter... 7=Sáb
    COUNT(*) AS agendamentos_totais,
    SUM(CASE WHEN a.status IN ('Realizado', 'Concluído') THEN 1 ELSE 0 END) AS realizados,
    SUM(CASE WHEN a.status = 'Cancelado' THEN 1 ELSE 0 END) AS cancelados,
    SUM(CASE WHEN a.status = 'No_Show' THEN 1 ELSE 0 END) AS noshow,
    ROUND(SUM(CASE WHEN a.status IN ('Cancelado', 'No_Show') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100, 1) AS perc_nao_comparecimento
FROM agendamento a
JOIN procedimento pr ON a.id_procedimento = pr.id_procedimento
WHERE YEAR(a.data_hora_agendamento) = 2026
  AND (@id_especialidade = -1 OR pr.id_especialidade = @id_especialidade)
  AND DAYOFWEEK(a.data_hora_agendamento) != 1 -- Clínica não abre aos domingos
GROUP BY MONTH(a.data_hora_agendamento), DAYOFWEEK(a.data_hora_agendamento)
ORDER BY mes, dia_semana_num;
