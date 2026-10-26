-- =====================================================================
-- GUIA TÉCNICO DE BANCO DE DADOS - CLÍNICA IKIGAI
-- Arquivo: seed.sql
-- Descrição: Inserção de Dados Fictícios Coerentes para Testes e Validação
-- Compatibilidade: MySQL 8.0+ / MySQL Workbench
-- =====================================================================

USE clinica_ikigai_db;

-- Limpeza controlada para ambiente de desenvolvimento/teste
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE historico_status_agendamento;
TRUNCATE TABLE avaliacao_atendimento;
TRUNCATE TABLE pagamento;
TRUNCATE TABLE agendamento;
TRUNCATE TABLE capacidade_diaria;
TRUNCATE TABLE sessao_chatbot;
TRUNCATE TABLE paciente;
TRUNCATE TABLE profissional_especialidade;
TRUNCATE TABLE profissional;
TRUNCATE TABLE procedimento;
TRUNCATE TABLE especialidade;
SET FOREIGN_KEY_CHECKS = 1;

-- 1. Inserção das Especialidades (conforme matriz SP do código original)
INSERT INTO especialidade (id_especialidade, nome, descricao) VALUES
(1, 'Acupuntura', 'Terapia tradicional chinesa para alívio de dor, estresse e equilíbrio energético.'),
(2, 'Nutrição integrativa', 'Abordagem nutricional personalizada focada no estilo de vida e fitonutrientes.'),
(3, 'Psicoterapia integrativa', 'Abordagem psicoterapêutica integrando técnicas cognitivas, somáticas e mindfulness.'),
(4, 'Massoterapia', 'Terapias manuais para relaxamento neuromuscular e drenagem.'),
(5, 'Fitoterapia', 'Prescrição e acompanhamento de compostos vegetais e fitoterápicos.'),
(6, 'Naturopatia', 'Sistemas holísticos naturais de promoção da autocura e desintoxicação.');

-- 2. Inserção dos Procedimentos vinculados
INSERT INTO procedimento (id_procedimento, id_especialidade, nome, duracao_minutos, preco_base) VALUES
(1, 1, 'Sessão de Acupuntura Sistêmica', 60, 220.00),
(2, 2, 'Consulta Nutricional Integrativa Inicial', 60, 280.00),
(3, 3, 'Sessão de Psicoterapia Integrativa', 50, 250.00),
(4, 4, 'Massagem Miofascial / Terapêutica', 60, 180.00),
(5, 5, 'Consulta Fitoterápica com Prescrição', 45, 200.00),
(6, 6, 'Avaliação e Conduta Naturopática', 60, 300.00);

-- 3. Inserção dos Profissionais
INSERT INTO profissional (id_profissional, nome, registro_profissional, email, telefone) VALUES
(1, 'Dra. Mayumi Tanaka', 'CRM-SP 189204 / RQE Acupuntura', 'mayumi.tanaka@clinicaikigai.com.br', '(11) 98765-1001'),
(2, 'Dr. Carlos Eduardo Ramos', 'CRN-3 44521', 'carlos.ramos@clinicaikigai.com.br', '(11) 98765-1002'),
(3, 'Dra. Beatriz Albuquerque', 'CRP-06 88319', 'beatriz.albuquerque@clinicaikigai.com.br', '(11) 98765-1003'),
(4, 'Terapeuta Marcelo Prado', 'ABRAMAT 1209', 'marcelo.prado@clinicaikigai.com.br', '(11) 98765-1004'),
(5, 'Dra. Juliana Mendes', 'CRF-SP 55214', 'juliana.mendes@clinicaikigai.com.br', '(11) 98765-1005'),
(6, 'Dr. Rodrigo Shinoda', 'CRBM-SP 9042', 'rodrigo.shinoda@clinicaikigai.com.br', '(11) 98765-1006');

-- 4. Inserção da Tabela Associativa Profissional x Especialidade
INSERT INTO profissional_especialidade (id_profissional, id_especialidade) VALUES
(1, 1), -- Mayumi -> Acupuntura
(2, 2), -- Carlos -> Nutrição
(3, 3), -- Beatriz -> Psicoterapia
(4, 4), -- Marcelo -> Massoterapia
(5, 5), -- Juliana -> Fitoterapia
(6, 6); -- Rodrigo -> Naturopatia

-- 5. Inserção de Pacientes (cobrindo as faixas etárias: 0-17, 18-30, 31-45, 46-60, 60+)
INSERT INTO paciente (id_paciente, nome, cpf, data_nascimento, sexo, telefone, email) VALUES
(1, 'Lucas Silveira Santos', '111.222.333-01', '2010-04-12', 'Masculino', '(11) 99111-0001', 'lucas.silveira@exemplo.com'),   -- Faixa 0-17 (14-16 anos)
(2, 'Mariana Costa Ferreira', '222.333.444-02', '2000-09-25', 'Feminino', '(11) 99111-0002', 'mariana.costa@exemplo.com'),     -- Faixa 18-30 (24-26 anos)
(3, 'Fernanda Rocha Ribeiro', '333.444.555-03', '1988-06-14', 'Feminino', '(11) 99111-0003', 'fernanda.rocha@exemplo.com'),     -- Faixa 31-45 (36-38 anos)
(4, 'Roberto Garcia Lima', '444.555.666-04', '1970-11-03', 'Masculino', '(11) 99111-0004', 'roberto.garcia@exemplo.com'),       -- Faixa 46-60 (54-56 anos)
(5, 'Helena Martins Souza', '555.666.777-05', '1955-03-21', 'Feminino', '(11) 99111-0005', 'helena.martins@exemplo.com'),       -- Faixa 60+ (69-71 anos)
(6, 'Camila Nogueira Pires', '666.777.888-06', '1992-01-18', 'Feminino', '(11) 99111-0006', 'camila.pires@exemplo.com'),        -- Faixa 31-45
(7, 'Thiago Barreto Oliveira', '777.888.999-07', '1985-08-30', 'Masculino', '(11) 99111-0007', 'thiago.barreto@exemplo.com'),   -- Faixa 31-45
(8, 'Patricia Mendes Castro', '888.999.000-08', '1963-12-05', 'Feminino', '(11) 99111-0008', 'patricia.castro@exemplo.com');    -- Faixa 60+

-- 6. Inserção de Sessões do Chatbot de IA
INSERT INTO sessao_chatbot (id_sessao, identificador_chat, data_hora_inicio, data_hora_fim, status_sessao, escalonado_humano) VALUES
(1, 'CHAT-20261001-001', '2026-10-01 09:15:00', '2026-10-01 09:18:22', 'Agendamento_Concluido', 0),
(2, 'CHAT-20261001-002', '2026-10-01 10:20:00', '2026-10-01 10:25:10', 'Agendamento_Concluido', 0),
(3, 'CHAT-20261001-003', '2026-10-01 11:05:00', '2026-10-01 11:08:45', 'Abandonada', 0),
(4, 'CHAT-20261002-001', '2026-10-02 08:30:00', '2026-10-02 08:34:10', 'Agendamento_Concluido', 1), -- Escalonado para humano
(5, 'CHAT-20261002-002', '2026-10-02 14:10:00', '2026-10-02 14:15:30', 'Agendamento_Concluido', 0),
(6, 'CHAT-20261003-001', '2026-10-03 16:00:00', '2026-10-03 16:04:12', 'Agendamento_Concluido', 0),
(7, 'CHAT-20261004-001', '2026-10-04 10:00:00', '2026-10-04 10:03:00', 'Abandonada', 0),
(8, 'CHAT-20261005-001', '2026-10-05 11:30:00', '2026-10-05 11:35:40', 'Agendamento_Concluido', 0);

-- 7. Inserção de Capacidade Diária (amostra de dias úteis)
INSERT INTO capacidade_diaria (data_referencia, vagas_totais, observacao) VALUES
('2026-10-01', 12, 'Dia normal de atendimento'),
('2026-10-02', 12, 'Dia normal de atendimento'),
('2026-10-03', 12, 'Sábado - atendimento matutino/vespertino'),
('2026-10-05', 12, 'Segunda-feira normal'),
('2026-10-06', 12, 'Terça-feira normal'),
('2026-10-07', 12, 'Quarta-feira normal'),
('2026-10-08', 12, 'Quinta-feira normal'),
('2026-10-09', 12, 'Sexta-feira normal'),
('2026-10-10', 12, 'Sábado normal');

-- 8. Inserção de Agendamentos (com variedade de status, origens, atrasos e valores)
INSERT INTO agendamento (id_agendamento, id_paciente, id_profissional, id_procedimento, id_sessao_chatbot, id_agendamento_origem, data_hora_agendamento, status, origem, tipo_atendimento, modalidade_pagamento, data_hora_checkin, data_hora_inicio_atendimento, minutos_atraso, valor_cobrado, escalonado_humano, motivo_cancelamento) VALUES
-- Realizado, pontual, chatbot, particular, retorno
(1, 3, 1, 1, 1, NULL, '2026-10-01 09:00:00', 'Realizado', 'Chatbot', 'Retorno', 'Particular', '2026-10-01 08:55:00', '2026-10-01 09:03:00', 3, 220.00, 0, NULL),
-- Realizado, atraso 12 min, chatbot, convênio, primeira consulta
(2, 2, 2, 2, 2, NULL, '2026-10-01 10:00:00', 'Realizado', 'Chatbot', 'Primeira_Consulta', 'Convenio', '2026-10-01 09:58:00', '2026-10-01 10:12:00', 12, 280.00, 0, NULL),
-- Cancelado pelo paciente com antecedência
(3, 4, 3, 3, NULL, NULL, '2026-10-01 14:00:00', 'Cancelado', 'Humano_Recepcao', 'Primeira_Consulta', 'Particular', NULL, NULL, 0, 250.00, 0, 'Paciente precisou viajar a trabalho'),
-- No-Show (falta sem aviso)
(4, 5, 4, 4, NULL, NULL, '2026-10-01 16:00:00', 'No_Show', 'Telefone', 'Retorno', 'Convenio', NULL, NULL, 0, 180.00, 0, 'Paciente não compareceu e não atendeu contato'),
-- Reagendado (gera o agendamento original como Reagendado)
(5, 6, 1, 1, NULL, NULL, '2026-10-02 09:00:00', 'Reagendado', 'Humano_Recepcao', 'Primeira_Consulta', 'Particular', NULL, NULL, 0, 220.00, 0, 'Solicitou remarcação para o dia seguinte'),
-- Novo agendamento derivado do reagendamento (aponta para o id 5)
(6, 6, 1, 1, NULL, 5, '2026-10-03 10:00:00', 'Realizado', 'Humano_Recepcao', 'Primeira_Consulta', 'Particular', '2026-10-03 09:50:00', '2026-10-03 10:05:00', 5, 220.00, 0, NULL),
-- Realizado com escalonamento humano no chatbot
(7, 7, 5, 5, 4, NULL, '2026-10-02 11:00:00', 'Realizado', 'Chatbot', 'Primeira_Consulta', 'Particular', '2026-10-02 11:02:00', '2026-10-02 11:08:00', 8, 200.00, 1, NULL),
-- Realizado, chatbot sem humano, atraso 2 min
(8, 8, 6, 6, 5, NULL, '2026-10-02 15:00:00', 'Realizado', 'Chatbot', 'Retorno', 'Convenio', '2026-10-02 14:50:00', '2026-10-02 15:02:00', 2, 300.00, 0, NULL),
-- Realizado, chatbot, sábado
(9, 2, 1, 1, 6, NULL, '2026-10-03 11:00:00', 'Realizado', 'Chatbot', 'Retorno', 'Particular', '2026-10-03 10:55:00', '2026-10-03 11:04:00', 4, 220.00, 0, NULL),
-- Realizado, segunda-feira, atraso 15 min
(10, 3, 2, 2, 8, NULL, '2026-10-05 14:00:00', 'Realizado', 'Chatbot', 'Retorno', 'Particular', '2026-10-05 13:58:00', '2026-10-05 14:15:00', 15, 280.00, 0, NULL);

-- 9. Inserção das Avaliações NPS (pós-atendimentos realizados)
INSERT INTO avaliacao_atendimento (id_agendamento, nota_nps, comentario, data_resposta) VALUES
(1, 10, 'Atendimento maravilhoso, a Dra. Mayumi aliviou muito minhas dores.', '2026-10-01 12:00:00'), -- Promotor
(2, 9, 'Muito detalhista e atencioso com a dieta.', '2026-10-01 13:30:00'),                          -- Promotor
(6, 8, 'Bom atendimento, mas tive que aguardar um pouco na recepção.', '2026-10-03 14:00:00'),         -- Neutro
(7, 10, 'Fitoterapia personalizada incrível!', '2026-10-02 16:00:00'),                                  -- Promotor
(8, 5, 'A consulta foi rápida demais pelo valor cobrado.', '2026-10-02 18:00:00'),                      -- Detrator
(9, 10, 'Acupuntura impecável, recomendo fortemente.', '2026-10-03 15:00:00'),                          -- Promotor
(10, 9, 'Ótimo retorno com acompanhamento evolutivo.', '2026-10-05 17:00:00');                          -- Promotor

-- 10. Inserção dos Pagamentos correspondentes
INSERT INTO pagamento (id_pagamento, id_agendamento, valor, forma_pagamento, status_pagamento, data_pagamento) VALUES
(1, 1, 220.00, 'Pix', 'Pago', '2026-10-01 10:05:00'),
(2, 2, 280.00, 'Guia_Convenio', 'Pago', '2026-10-01 11:15:00'),
(3, 6, 220.00, 'Cartao_Credito', 'Pago', '2026-10-03 11:10:00'),
(4, 7, 200.00, 'Pix', 'Pago', '2026-10-02 12:05:00'),
(5, 8, 300.00, 'Guia_Convenio', 'Pago', '2026-10-02 16:05:00'),
(6, 9, 220.00, 'Cartao_Debito', 'Pago', '2026-10-03 12:00:00'),
(7, 10, 280.00, 'Pix', 'Pago', '2026-10-05 15:20:00');

-- 11. Inserção de Trilha de Auditoria (histórico de status)
INSERT INTO historico_status_agendamento (id_agendamento, status_anterior, status_novo, motivo, alterado_por) VALUES
(3, 'Realizado', 'Cancelado', 'Paciente avisou por WhatsApp que precisou viajar', 'Recepcao_Maria'),
(4, 'Realizado', 'No_Show', 'Paciente não compareceu após 20 min de tolerância', 'Sistema_Automatico'),
(5, 'Realizado', 'Reagendado', 'Paciente solicitou alteração de data', 'Recepcao_Maria');
