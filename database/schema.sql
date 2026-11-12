-- =====================================================================
-- GUIA TÉCNICO DE BANCO DE DADOS UNIFICADO E NORMALIZADO (3FN)
-- CLÍNICA IKIGAI
-- Arquivo: schema.sql
-- Descrição: Modelo Relacional Centralizado e Semântico
-- Atende simultaneamente:
--   1) Dashboard Gerencial de KPIs (Módulo Analítico)
--   2) Sistema de Grade de Agendamento, Cadastro e WhatsApp (Módulo Operacional)
-- Compatibilidade: MySQL 8.0+ / MySQL Workbench
-- Charset: utf8mb4 (Collation: utf8mb4_unicode_ci)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS clinica_ikigai_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE clinica_ikigai_db;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- 1. TABELA: especialidade (Categorias Clínicas e Terapêuticas)
-- =====================================================================
CREATE TABLE IF NOT EXISTS especialidade (
    id_especialidade INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE,
    descricao TEXT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 2. TABELA: procedimento (Serviços e Tratamentos Oferecidos)
-- =====================================================================
CREATE TABLE IF NOT EXISTS procedimento (
    id_procedimento INT AUTO_INCREMENT PRIMARY KEY,
    id_especialidade INT NOT NULL,
    nome VARCHAR(150) NOT NULL,
    duracao_minutos INT NOT NULL DEFAULT 60,
    preco DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    preco_base DECIMAL(10,2) GENERATED ALWAYS AS (preco) VIRTUAL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_procedimento_especialidade
        FOREIGN KEY (id_especialidade) REFERENCES especialidade (id_especialidade)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_procedimento_especialidade (id_especialidade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 3. TABELA: profissional (Médicos e Terapeutas da Clínica)
-- =====================================================================
CREATE TABLE IF NOT EXISTS profissional (
    id_profissional INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    registro_profissional VARCHAR(50) NULL,
    especialidade_principal VARCHAR(100) NULL,
    email VARCHAR(120) NULL,
    telefone VARCHAR(20) NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_profissional_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 4. TABELA ASSOCIATIVA: profissional_especialidade (N:N)
-- =====================================================================
CREATE TABLE IF NOT EXISTS profissional_especialidade (
    id_profissional INT NOT NULL,
    id_especialidade INT NOT NULL,
    PRIMARY KEY (id_profissional, id_especialidade),
    CONSTRAINT fk_pe_profissional
        FOREIGN KEY (id_profissional) REFERENCES profissional (id_profissional)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_pe_especialidade
        FOREIGN KEY (id_especialidade) REFERENCES especialidade (id_especialidade)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 4b. TABELA ASSOCIATIVA: profissional_procedimento (N:N) (IK-80)
-- =====================================================================
CREATE TABLE IF NOT EXISTS profissional_procedimento (
    id_profissional INT NOT NULL,
    id_procedimento INT NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_profissional, id_procedimento),
    CONSTRAINT fk_pp_profissional
        FOREIGN KEY (id_profissional) REFERENCES profissional (id_profissional)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_pp_procedimento
        FOREIGN KEY (id_procedimento) REFERENCES procedimento (id_procedimento)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_pp_procedimento (id_procedimento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 5. TABELA: paciente (Cadastro Unificado com UUID, Demografia e Contato)
-- =====================================================================
CREATE TABLE IF NOT EXISTS paciente (
    id_paciente INT AUTO_INCREMENT PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    nome VARCHAR(150) NOT NULL,
    cpf VARCHAR(14) NULL UNIQUE,
    data_nascimento DATE NOT NULL DEFAULT '1990-01-01',
    sexo ENUM('Feminino', 'Masculino', 'Outro') NOT NULL DEFAULT 'Outro',
    telefone VARCHAR(20) NULL,
    whatsapp VARCHAR(20) NULL,
    email VARCHAR(120) NULL,
    endereco TEXT NULL,
    etapa_tratamento VARCHAR(100) NOT NULL DEFAULT 'Avaliação',
    atendimento_status ENUM('IA', 'Humano') NOT NULL DEFAULT 'Humano',
    observacoes TEXT NULL,
    historico_clinico TEXT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_paciente_uuid (uuid),
    INDEX idx_paciente_nascimento (data_nascimento),
    INDEX idx_paciente_whatsapp (whatsapp),
    INDEX idx_paciente_cpf (cpf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 6. TABELA: sessao_chatbot (Funil de Conversão e Triagem IA WhatsApp)
-- =====================================================================
CREATE TABLE IF NOT EXISTS sessao_chatbot (
    id_sessao INT AUTO_INCREMENT PRIMARY KEY,
    identificador_chat VARCHAR(64) NOT NULL UNIQUE,
    data_hora_inicio DATETIME NOT NULL,
    data_hora_fim DATETIME NULL,
    status_sessao ENUM('Agendamento_Concluido', 'Abandonada', 'Duvida_Resolvida', 'Em_Andamento', 'Erro_Sistema') NOT NULL DEFAULT 'Em_Andamento',
    escalonado_humano TINYINT(1) NOT NULL DEFAULT 0,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sessao_data_inicio (data_hora_inicio),
    INDEX idx_sessao_status (status_sessao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 7. TABELA: capacidade_diaria (Gestão de Vagas por Dia e Especialidade)
-- =====================================================================
CREATE TABLE IF NOT EXISTS capacidade_diaria (
    id_capacidade INT AUTO_INCREMENT PRIMARY KEY,
    data_referencia DATE NOT NULL,
    id_especialidade INT NULL,
    vagas_totais INT NOT NULL DEFAULT 12,
    observacao VARCHAR(255) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_capacidade_especialidade
        FOREIGN KEY (id_especialidade) REFERENCES especialidade (id_especialidade)
        ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY uq_capacidade_data_esp (data_referencia, id_especialidade),
    INDEX idx_capacidade_data (data_referencia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 8. TABELA: agendamento (Entidade Central Integrada: Grade + KPIs)
-- =====================================================================
CREATE TABLE IF NOT EXISTS agendamento (
    id_agendamento INT AUTO_INCREMENT PRIMARY KEY,
    id_paciente INT NOT NULL DEFAULT 1,
    paciente_uuid VARCHAR(36) NOT NULL DEFAULT '',
    id_profissional INT NOT NULL,
    id_procedimento INT NOT NULL,
    id_sessao_chatbot INT NULL,
    id_agendamento_origem INT NULL,
    data DATE NOT NULL,
    horario_inicio TIME NOT NULL,
    horario_fim TIME NOT NULL,
    data_hora_agendamento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Agendado', 'Confirmado', 'Na Recepção', 'Em Atendimento', 'Concluído', 'Realizado', 'Cancelado', 'No_Show', 'Reagendado') NOT NULL DEFAULT 'Agendado',
    origem ENUM('Chatbot', 'Humano_Recepcao', 'Telefone', 'Outro') NOT NULL DEFAULT 'Chatbot',
    tipo_atendimento ENUM('Primeira_Consulta', 'Retorno') NOT NULL DEFAULT 'Primeira_Consulta',
    modalidade_pagamento ENUM('Particular', 'Convenio') NOT NULL DEFAULT 'Particular',
    data_hora_checkin DATETIME NULL,
    data_hora_inicio_atendimento DATETIME NULL,
    minutos_atraso INT NOT NULL DEFAULT 0,
    valor_cobrado DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    escalonado_humano TINYINT(1) NOT NULL DEFAULT 0,
    motivo_cancelamento VARCHAR(255) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_agendamento_paciente
        FOREIGN KEY (id_paciente) REFERENCES paciente (id_paciente)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_agendamento_paciente_uuid
        FOREIGN KEY (paciente_uuid) REFERENCES paciente (uuid)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_agendamento_profissional
        FOREIGN KEY (id_profissional) REFERENCES profissional (id_profissional)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_agendamento_procedimento
        FOREIGN KEY (id_procedimento) REFERENCES procedimento (id_procedimento)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_agendamento_sessao_bot
        FOREIGN KEY (id_sessao_chatbot) REFERENCES sessao_chatbot (id_sessao)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_agendamento_origem_reagendamento
        FOREIGN KEY (id_agendamento_origem) REFERENCES agendamento (id_agendamento)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_agendamento_data_status (data_hora_agendamento, status),
    INDEX idx_agendamento_grade (data, id_profissional, status),
    INDEX idx_agendamento_procedimento (id_procedimento),
    INDEX idx_agendamento_paciente (id_paciente),
    INDEX idx_agendamento_paciente_uuid (paciente_uuid),
    INDEX idx_agendamento_origem (origem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 9. TABELA: avaliacao_atendimento (NPS 0 a 10)
-- =====================================================================
CREATE TABLE IF NOT EXISTS avaliacao_atendimento (
    id_avaliacao INT AUTO_INCREMENT PRIMARY KEY,
    id_agendamento INT NOT NULL UNIQUE,
    nota_nps TINYINT NOT NULL,
    comentario TEXT NULL,
    data_resposta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_nota_nps CHECK (nota_nps BETWEEN 0 AND 10),
    CONSTRAINT fk_avaliacao_agendamento
        FOREIGN KEY (id_agendamento) REFERENCES agendamento (id_agendamento)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_avaliacao_nota (nota_nps)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 10. TABELA: pagamento (Transações Financeiras)
-- =====================================================================
CREATE TABLE IF NOT EXISTS pagamento (
    id_pagamento INT AUTO_INCREMENT PRIMARY KEY,
    id_agendamento INT NOT NULL,
    valor DECIMAL(10,2) NOT NULL,
    forma_pagamento ENUM('Dinheiro', 'Cartao_Credito', 'Cartao_Debito', 'Pix', 'Guia_Convenio') NOT NULL,
    status_pagamento ENUM('Pago', 'Pendente', 'Cancelado', 'Estornado') NOT NULL DEFAULT 'Pendente',
    data_pagamento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pagamento_agendamento
        FOREIGN KEY (id_agendamento) REFERENCES agendamento (id_agendamento)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_pagamento_agendamento (id_agendamento),
    INDEX idx_pagamento_data (data_pagamento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 11. TABELA: historico_status_agendamento (Auditoria de Ciclo de Vida)
-- =====================================================================
CREATE TABLE IF NOT EXISTS historico_status_agendamento (
    id_historico INT AUTO_INCREMENT PRIMARY KEY,
    id_agendamento INT NOT NULL,
    status_anterior ENUM('Agendado', 'Confirmado', 'Na Recepção', 'Em Atendimento', 'Concluído', 'Realizado', 'Cancelado', 'No_Show', 'Reagendado') NULL,
    status_novo ENUM('Agendado', 'Confirmado', 'Na Recepção', 'Em Atendimento', 'Concluído', 'Realizado', 'Cancelado', 'No_Show', 'Reagendado') NOT NULL,
    motivo VARCHAR(255) NULL,
    alterado_por VARCHAR(100) NOT NULL DEFAULT 'Sistema',
    data_alteracao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_historico_agendamento
        FOREIGN KEY (id_agendamento) REFERENCES agendamento (id_agendamento)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_historico_agendamento (id_agendamento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 12. TABELA: bloqueio_agenda (Bloqueio de Horários/Indisponibilidades)
-- =====================================================================
CREATE TABLE IF NOT EXISTS bloqueio_agenda (
    id_bloqueio INT AUTO_INCREMENT PRIMARY KEY,
    id_profissional INT NOT NULL,
    data DATE NOT NULL,
    horario_inicio TIME NOT NULL,
    horario_fim TIME NOT NULL,
    motivo VARCHAR(255) NOT NULL DEFAULT 'Horário Bloqueado',
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bloqueio_profissional
        FOREIGN KEY (id_profissional) REFERENCES profissional (id_profissional)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_bloqueio_data_prof (data, id_profissional)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- TRIGGERS DE INTEGRIDADE AUTOMÁTICA EM AGENDAMENTO
-- =====================================================================

-- Auto-resolução de campos cruzados na inserção
DROP TRIGGER IF EXISTS trg_agendamento_bi;
DELIMITER //
CREATE TRIGGER trg_agendamento_bi
BEFORE INSERT ON agendamento
FOR EACH ROW
BEGIN
    -- 1. Resolver paciente_id / id_paciente caso apenas um venha informado
    IF (NEW.id_paciente IS NULL OR NEW.id_paciente = 0) AND NEW.paciente_uuid IS NOT NULL THEN
        SET NEW.id_paciente = (SELECT id_paciente FROM paciente WHERE uuid = NEW.paciente_uuid LIMIT 1);
    ELSEIF NEW.paciente_uuid IS NULL AND NEW.id_paciente IS NOT NULL THEN
        SET NEW.paciente_uuid = (SELECT uuid FROM paciente WHERE id_paciente = NEW.id_paciente LIMIT 1);
    END IF;

    -- 2. Resolver data_hora_agendamento ou data + horario_inicio
    IF NEW.data_hora_agendamento IS NULL AND NEW.data IS NOT NULL AND NEW.horario_inicio IS NOT NULL THEN
        SET NEW.data_hora_agendamento = TIMESTAMP(NEW.data, NEW.horario_inicio);
    ELSEIF NEW.data IS NULL AND NEW.data_hora_agendamento IS NOT NULL THEN
        SET NEW.data = DATE(NEW.data_hora_agendamento);
        SET NEW.horario_inicio = TIME(NEW.data_hora_agendamento);
    END IF;

    -- 3. Calcular horário de término padrão se não fornecido
    IF NEW.horario_fim IS NULL THEN
        SET NEW.horario_fim = ADDTIME(NEW.horario_inicio, SEC_TO_TIME(COALESCE(
            (SELECT duracao_minutos * 60 FROM procedimento WHERE id_procedimento = NEW.id_procedimento LIMIT 1),
            3600
        )));
    END IF;

    -- 4. Preço padrão do procedimento se valor_cobrado estiver zerado
    IF NEW.valor_cobrado IS NULL OR NEW.valor_cobrado = 0.00 THEN
        SET NEW.valor_cobrado = COALESCE(
            (SELECT preco FROM procedimento WHERE id_procedimento = NEW.id_procedimento LIMIT 1),
            200.00
        );
    END IF;
END //
DELIMITER ;

-- Sincronia de data e hora em atualizações
DROP TRIGGER IF EXISTS trg_agendamento_bu;
DELIMITER //
CREATE TRIGGER trg_agendamento_bu
BEFORE UPDATE ON agendamento
FOR EACH ROW
BEGIN
    IF NEW.data != OLD.data OR NEW.horario_inicio != OLD.horario_inicio THEN
        SET NEW.data_hora_agendamento = TIMESTAMP(NEW.data, NEW.horario_inicio);
    ELSEIF NEW.data_hora_agendamento != OLD.data_hora_agendamento THEN
        SET NEW.data = DATE(NEW.data_hora_agendamento);
        SET NEW.horario_inicio = TIME(NEW.data_hora_agendamento);
    END IF;
END //
DELIMITER ;

-- Auditoria automática no histórico de status
DROP TRIGGER IF EXISTS trg_agendamento_historico_status;
DELIMITER //
CREATE TRIGGER trg_agendamento_historico_status
AFTER UPDATE ON agendamento
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO historico_status_agendamento (
            id_agendamento,
            status_anterior,
            status_novo,
            motivo,
            alterado_por
        ) VALUES (
            NEW.id_agendamento,
            OLD.status,
            NEW.status,
            COALESCE(NEW.motivo_cancelamento, 'Atualização de status'),
            'Sistema'
        );
    END IF;
END //
DELIMITER ;

-- =====================================================================
-- VIEWS DE COMPATIBILIDADE RETROATIVA (100% TRANSPARENTES)
-- Permitem leitura e consultas legadas sem duplicidade de tabelas físicas
-- =====================================================================

CREATE OR REPLACE VIEW categorias AS 
SELECT 
    id_especialidade AS id, 
    nome 
FROM especialidade;

CREATE OR REPLACE VIEW servicos AS 
SELECT 
    p.id_procedimento AS id, 
    p.id_especialidade AS categoria_id, 
    p.nome, 
    p.preco, 
    p.duracao_minutos,
    p.ativo 
FROM procedimento p;

CREATE OR REPLACE VIEW profissionais AS 
SELECT 
    id_profissional AS id, 
    nome, 
    COALESCE(especialidade_principal, 'Especialista') AS especialidade, 
    ativo 
FROM profissional;

CREATE OR REPLACE VIEW pacientes AS 
SELECT 
    uuid AS id, 
    nome AS nome_completo, 
    cpf, 
    telefone, 
    whatsapp, 
    endereco, 
    etapa_tratamento, 
    atendimento_status, 
    observacoes, 
    historico_clinico, 
    criado_em 
FROM paciente;

CREATE OR REPLACE VIEW agendamentos AS 
SELECT 
    id_agendamento AS id, 
    paciente_uuid AS paciente_id, 
    id_profissional AS profissional_id, 
    id_procedimento AS servico_id, 
    data, 
    horario_inicio, 
    horario_fim, 
    status, 
    criado_em 
FROM agendamento;

CREATE OR REPLACE VIEW bloqueios AS 
SELECT 
    id_bloqueio AS id, 
    id_profissional AS profissional_id, 
    data, 
    horario_inicio, 
    horario_fim, 
    motivo, 
    criado_em 
FROM bloqueio_agenda;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
