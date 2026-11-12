-- =====================================================================
-- GUIA TÉCNICO DE BANCO DE DADOS UNIFICADO - CLÍNICA IKIGAI
-- Arquivo: seed.sql
-- Descrição: Carga de Dados Iniciais Coerentes para o Modelo 3FN Unificado
-- Atende:
--   - Dashboard Gerencial (KPIs, Semáforos, Funil de IA e NPS)
--   - Grade Operacional de Agendamentos, Cadastro de Pacientes e WhatsApp
-- Compatibilidade: MySQL 8.0+ / MySQL Workbench
-- =====================================================================

USE clinica_ikigai_db;

-- 1. Limpeza de dados para carga limpa de desenvolvimento
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE historico_status_agendamento;
TRUNCATE TABLE avaliacao_atendimento;
TRUNCATE TABLE pagamento;
TRUNCATE TABLE agendamento;
TRUNCATE TABLE capacidade_diaria;
TRUNCATE TABLE sessao_chatbot;
TRUNCATE TABLE paciente;
TRUNCATE TABLE profissional_especialidade;
TRUNCATE TABLE profissional_procedimento;
TRUNCATE TABLE profissional;
TRUNCATE TABLE procedimento;
TRUNCATE TABLE especialidade;
SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 2. CADASTRO DE ESPECIALIDADES (Única Fonte da Verdade)
-- =====================================================================
INSERT INTO especialidade (id_especialidade, nome, descricao) VALUES
(1, 'Acupuntura', 'Terapia tradicional chinesa para alívio de dor, estresse e equilíbrio energético.'),
(2, 'Nutrição integrativa', 'Abordagem nutricional personalizada focada no estilo de vida e fitonutrientes.'),
(3, 'Psicoterapia integrativa', 'Abordagem psicoterapêutica integrando técnicas cognitivas e mindfulness.'),
(4, 'Massoterapia', 'Terapias manuais para relaxamento neuromuscular e drenagem.'),
(5, 'Fitoterapia', 'Prescrição e acompanhamento de compostos vegetais e fitoterápicos.'),
(6, 'Naturopatia', 'Sistemas holísticos naturais de promoção da autocura e desintoxicação.');

-- =====================================================================
-- 3. CADASTRO DE PROCEDIMENTOS (Única Fonte da Verdade)
-- =====================================================================
INSERT INTO procedimento (id_procedimento, id_especialidade, nome, duracao_minutos, preco) VALUES
(1, 1, 'Sessão de Acupuntura Sistêmica', 60, 220.00),
(2, 2, 'Consulta Nutricional Integrativa Inicial', 60, 280.00),
(3, 3, 'Sessão de Psicoterapia Integrativa', 50, 250.00),
(4, 4, 'Massagem Miofascial / Terapêutica', 60, 180.00),
(5, 5, 'Consulta Fitoterápica com Prescrição', 45, 200.00),
(6, 6, 'Avaliação e Conduta Naturopática', 60, 300.00);

-- =====================================================================
-- 4. CADASTRO DE PROFISSIONAIS (Única Fonte da Verdade)
-- =====================================================================
INSERT INTO profissional (id_profissional, nome, registro_profissional, especialidade_principal, email, telefone, ativo) VALUES
(1, 'Dr. Ulisses Higo', 'CRM-SP 189204', 'Terapeuta Ortomolecular e Acupunturista', 'ulisses.higo@clinicaikigai.com.br', '(11) 98765-1001', 1),
(2, 'Dra. Samantha Ferreira', 'CRN-3 44521', 'Acupunturista e Massoterapeuta', 'samantha.ferreira@clinicaikigai.com.br', '(11) 98765-1002', 1),
(3, 'Dra. Beatriz Albuquerque', 'CRP-06 88319', 'Psicoterapeuta Integrativa', 'beatriz.albuquerque@clinicaikigai.com.br', '(11) 98765-1003', 1),
(4, 'Terapeuta Marcelo Prado', 'ABRAMAT 1209', 'Massoterapeuta Especialista', 'marcelo.prado@clinicaikigai.com.br', '(11) 98765-1004', 1),
(5, 'Dra. Juliana Mendes', 'CRF-SP 55214', 'Farmacêutica Fitoterapeuta', 'juliana.mendes@clinicaikigai.com.br', '(11) 98765-1005', 1),
(6, 'Dr. Rodrigo Shinoda', 'CRBM-SP 9042', 'Biomédico e Naturopata', 'rodrigo.shinoda@clinicaikigai.com.br', '(11) 98765-1006', 1);

-- Vinculação N:N Profissional x Especialidade
INSERT INTO profissional_especialidade (id_profissional, id_especialidade) VALUES
(1, 1), (1, 2), -- Ulisses -> Acupuntura, Nutrição
(2, 1), (2, 4), -- Samantha -> Acupuntura, Massoterapia
(3, 3),         -- Beatriz -> Psicoterapia
(4, 4),         -- Marcelo -> Massoterapia
(5, 5),         -- Juliana -> Fitoterapia
(6, 6);         -- Rodrigo -> Naturopatia

-- Vinculação N:N Profissional x Procedimento (IK-80)
INSERT INTO profissional_procedimento (id_profissional, id_procedimento) VALUES
(1, 1), (1, 2), -- Ulisses -> Sessão de Acupuntura Sistêmica, Consulta Nutricional Integrativa
(2, 1), (2, 4), -- Samantha -> Sessão de Acupuntura Sistêmica, Massagem Miofascial
(3, 3),         -- Beatriz -> Sessão de Psicoterapia Integrativa
(4, 4),         -- Marcelo -> Massagem Miofascial
(5, 5),         -- Juliana -> Consulta Fitoterápica
(6, 6);         -- Rodrigo -> Avaliação Naturopática

-- =====================================================================
-- 5. CADASTRO DE PACIENTES (Integrado com UUID e Demografia)
-- =====================================================================
INSERT INTO paciente (id_paciente, uuid, nome, cpf, data_nascimento, sexo, telefone, whatsapp, email, endereco, etapa_tratamento, atendimento_status, historico_clinico) VALUES
(1, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d01', 'Lucas Silveira Santos', '11122233301', '2010-04-12', 'Masculino', '(11) 99111-0001', '5511991110001', 'lucas.silveira@exemplo.com', 'Rua das Flores, 120 - Jardins, São Paulo/SP', 'Avaliação', 'Humano', 'Paciente com queixa de lombalgia crônica.'),
(2, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d02', 'Mariana Costa Ferreira', '22233344402', '2000-09-25', 'Feminino', '(11) 99111-0002', '5511991110002', 'mariana.costa@exemplo.com', 'Av. Paulista, 1500 - Bela Vista, São Paulo/SP', 'Retorno', 'IA', 'Acompanhamento nutricional pós-reeducação alimentar.'),
(3, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d03', 'Fernanda Rocha Ribeiro', '33344455503', '1988-06-14', 'Feminino', '(11) 99111-0003', '5511991110003', 'fernanda.rocha@exemplo.com', 'Rua Augusta, 800 - Consolação, São Paulo/SP', 'Manutenção', 'IA', 'Sessões quinzenais de controle de ansiedade.'),
(4, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d04', 'Roberto Garcia Lima', '44455566604', '1970-11-03', 'Masculino', '(11) 99111-0004', '5511991110004', 'roberto.garcia@exemplo.com', 'Alameda Santos, 450 - Cerqueira César, São Paulo/SP', 'Tratamento', 'Humano', 'Tensão cervical e estresse ocupacional.'),
(5, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d05', 'Helena Martins Souza', '55566677705', '1955-03-21', 'Feminino', '(11) 99111-0005', '5511991110005', 'helena.martins@exemplo.com', 'Rua Oscar Freire, 320 - Pinheiros, São Paulo/SP', 'Retorno', 'IA', 'Controle de insônia através de fitoterapia.'),
(6, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d06', 'Camila Nogueira Pires', '66677788806', '1992-01-18', 'Feminino', '(11) 99111-0006', '5511991110006', 'camila.pires@exemplo.com', 'Rua Vergueiro, 910 - Vila Mariana, São Paulo/SP', 'Avaliação', 'Humano', 'Primeira consulta integrativa de desintoxicação.'),
(7, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d07', 'Thiago Barreto Oliveira', '77788899907', '1985-08-30', 'Masculino', '(11) 99111-0007', '5511991110007', 'thiago.barreto@exemplo.com', 'Rua Haddock Lobo, 210 - Cerqueira César, São Paulo/SP', 'Retorno', 'IA', 'Dores articulares em membros inferiores.'),
(8, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d08', 'Patricia Mendes Castro', '88899900008', '1963-12-05', 'Feminino', '(11) 99111-0008', '5511991110008', 'patricia.castro@exemplo.com', 'Av. Brigadeiro Faria Lima, 2000 - Itaim Bibi, São Paulo/SP', 'Manutenção', 'Humano', 'Acompanhamento preventivo e bem-estar.');

-- =====================================================================
-- 6. SESSÕES DE CHATBOT (FUNIL DE ATENDIMENTO)
-- =====================================================================
INSERT INTO sessao_chatbot (id_sessao, identificador_chat, data_hora_inicio, data_hora_fim, status_sessao, escalonado_humano) VALUES
(1, 'CHAT-20261001-001', '2026-10-01 09:15:00', '2026-10-01 09:18:22', 'Agendamento_Concluido', 0),
(2, 'CHAT-20261001-002', '2026-10-01 10:20:00', '2026-10-01 10:25:10', 'Agendamento_Concluido', 0),
(3, 'CHAT-20261001-003', '2026-10-01 11:05:00', '2026-10-01 11:08:45', 'Abandonada', 0),
(4, 'CHAT-20261002-001', '2026-10-02 08:30:00', '2026-10-02 08:34:10', 'Agendamento_Concluido', 1),
(5, 'CHAT-20261002-002', '2026-10-02 14:10:00', '2026-10-02 14:15:30', 'Agendamento_Concluido', 0),
(6, 'CHAT-20261003-001', '2026-10-03 16:00:00', '2026-10-03 16:04:12', 'Agendamento_Concluido', 0),
(7, 'CHAT-20261004-001', '2026-10-04 10:00:00', '2026-10-04 10:03:00', 'Abandonada', 0),
(8, 'CHAT-20261005-001', '2026-10-05 11:30:00', '2026-10-05 11:35:40', 'Agendamento_Concluido', 0);

-- =====================================================================
-- 7. CAPACIDADE DIÁRIA (Com suporte a capacidade global e por especialidade)
-- =====================================================================
INSERT INTO capacidade_diaria (data_referencia, id_especialidade, vagas_totais, observacao) VALUES
('2026-10-01', NULL, 12, 'Dia normal de atendimento global'),
('2026-10-02', NULL, 12, 'Dia normal de atendimento global'),
('2026-10-03', NULL, 12, 'Sábado - atendimento reduzido'),
('2026-10-05', NULL, 12, 'Segunda-feira normal'),
('2026-10-06', NULL, 12, 'Terça-feira normal'),
('2026-10-07', NULL, 12, 'Quarta-feira normal'),
('2026-10-08', NULL, 12, 'Quinta-feira normal'),
('2026-10-09', NULL, 12, 'Sexta-feira normal'),
('2026-10-10', NULL, 12, 'Sábado normal');

-- =====================================================================
-- 8. AGENDAMENTOS (Central Única - Grade Horária e Métricas)
-- =====================================================================
INSERT INTO agendamento (
    id_agendamento, id_paciente, paciente_uuid, id_profissional, id_procedimento,
    id_sessao_chatbot, id_agendamento_origem, data, horario_inicio, horario_fim,
    data_hora_agendamento, status, origem, tipo_atendimento, modalidade_pagamento,
    data_hora_checkin, data_hora_inicio_atendimento, minutos_atraso, valor_cobrado,
    escalonado_humano, motivo_cancelamento
) VALUES
(1, 3, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d03', 1, 1, 1, NULL, '2026-10-01', '09:00:00', '10:00:00', '2026-10-01 09:00:00', 'Realizado', 'Chatbot', 'Retorno', 'Particular', '2026-10-01 08:55:00', '2026-10-01 09:03:00', 3, 220.00, 0, NULL),
(2, 2, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d02', 2, 2, 2, NULL, '2026-10-01', '10:00:00', '11:00:00', '2026-10-01 10:00:00', 'Realizado', 'Chatbot', 'Primeira_Consulta', 'Convenio', '2026-10-01 09:58:00', '2026-10-01 10:12:00', 12, 280.00, 0, NULL),
(3, 1, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d01', 3, 3, NULL, NULL, '2026-10-01', '11:30:00', '12:20:00', '2026-10-01 11:30:00', 'Realizado', 'Humano_Recepcao', 'Primeira_Consulta', 'Particular', '2026-10-01 11:30:00', '2026-10-01 11:34:00', 4, 250.00, 0, NULL),
(4, 4, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d04', 4, 4, NULL, NULL, '2026-10-01', '14:00:00', '15:00:00', '2026-10-01 14:00:00', 'Cancelado', 'Telefone', 'Retorno', 'Particular', NULL, NULL, 0, 180.00, 0, 'Imprevisto no trabalho'),
(5, 5, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d05', 1, 1, 4, NULL, '2026-10-02', '09:00:00', '10:00:00', '2026-10-02 09:00:00', 'Realizado', 'Chatbot', 'Retorno', 'Particular', '2026-10-02 08:50:00', '2026-10-02 09:00:00', 0, 220.00, 1, NULL),
(6, 6, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d06', 5, 5, 5, NULL, '2026-10-02', '10:30:00', '11:15:00', '2026-10-02 10:30:00', 'Realizado', 'Chatbot', 'Primeira_Consulta', 'Particular', '2026-10-02 10:25:00', '2026-10-02 10:38:00', 8, 200.00, 0, NULL),
(7, 7, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d07', 6, 6, NULL, NULL, '2026-10-02', '14:00:00', '15:00:00', '2026-10-02 14:00:00', 'No_Show', 'Chatbot', 'Primeira_Consulta', 'Particular', NULL, NULL, 0, 300.00, 0, 'Paciente não compareceu nem atendeu'),
(8, 8, 'c1a0c7b4-2b6d-4e1a-8c9e-5f6a7b8c9d08', 2, 2, 6, NULL, '2026-10-03', '10:00:00', '11:00:00', '2026-10-03 10:00:00', 'Realizado', 'Chatbot', 'Retorno', 'Convenio', '2026-10-03 09:55:00', '2026-10-03 10:05:00', 5, 280.00, 0, NULL);

-- =====================================================================
-- 9. AVALIAÇÕES NPS (SATISFAÇÃO)
-- =====================================================================
INSERT INTO avaliacao_atendimento (id_avaliacao, id_agendamento, nota_nps, comentario) VALUES
(1, 1, 10, 'Atendimento impecável! O Dr Ulisses é extremamente cuidadoso.'),
(2, 2, 9, 'Muito bom! Consulta clara e plano nutricional realista.'),
(3, 3, 10, 'Acolhimento perfeito na terapia.'),
(4, 5, 8, 'Excelente retorno, ambiente tranquilo.'),
(5, 6, 9, 'Tirei todas as dúvidas sobre fitoterápicos.'),
(6, 8, 10, 'Adorei a pontualidade e dedicação.');

-- =====================================================================
-- 10. REGISTROS DE PAGAMENTO (FINANCEIRO)
-- =====================================================================
INSERT INTO pagamento (id_pagamento, id_agendamento, valor, forma_pagamento, status_pagamento) VALUES
(1, 1, 220.00, 'Pix', 'Pago'),
(2, 2, 280.00, 'Guia_Convenio', 'Pago'),
(3, 3, 250.00, 'Cartao_Credito', 'Pago'),
(4, 5, 220.00, 'Pix', 'Pago'),
(5, 6, 200.00, 'Cartao_Debito', 'Pago'),
(6, 8, 280.00, 'Guia_Convenio', 'Pago');

-- =====================================================================
-- 11. HISTÓRICO DE AUDITORIA DE STATUS (Transições Válidas de Ciclo)
-- =====================================================================
INSERT INTO historico_status_agendamento (id_historico, id_agendamento, status_anterior, status_novo, motivo, alterado_por) VALUES
(1, 1, 'Agendado', 'Realizado', 'Agendamento finalizado e check-in concluído', 'Sistema'),
(2, 4, 'Agendado', 'Cancelado', 'Paciente avisou via telefone impossibilidade de comparecimento', 'Recepcao_Ana'),
(3, 7, 'Agendado', 'No_Show', 'Tolerância de 20min esgotada sem contato do paciente', 'Sistema');
