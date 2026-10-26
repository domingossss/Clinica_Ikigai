-- =====================================================================
-- GUIA TÉCNICO DE BANCO DE DADOS - CLÍNICA IKIGAI
-- Arquivo: database/schema.sql
-- Descrição: Criação do Schema e Tabelas Relacionais Normalizadas (3FN)
-- Compatibilidade: MySQL 8.0+ / MySQL Workbench
-- =====================================================================

CREATE DATABASE IF NOT EXISTS clinica_ikigai_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE clinica_ikigai_db;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS especialidade (
    id_especialidade INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE,
    descricao TEXT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procedimento (
    id_procedimento INT AUTO_INCREMENT PRIMARY KEY,
    id_especialidade INT NOT NULL,
    nome VARCHAR(120) NOT NULL,
    duracao_minutos INT NOT NULL DEFAULT 60,
    preco_base DECIMAL(10,2) NOT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_procedimento_especialidade
        FOREIGN KEY (id_especialidade) REFERENCES especialidade (id_especialidade)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_procedimento_especialidade (id_especialidade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profissional (
    id_profissional INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    registro_profissional VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(120) NULL UNIQUE,
    telefone VARCHAR(20) NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS paciente (
    id_paciente INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    cpf VARCHAR(14) NULL UNIQUE,
    data_nascimento DATE NOT NULL,
    sexo ENUM('Feminino', 'Masculino', 'Outro') NOT NULL,
    telefone VARCHAR(20) NULL,
    email VARCHAR(120) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_paciente_nascimento (data_nascimento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessao_chatbot (
    id_sessao INT AUTO_INCREMENT PRIMARY KEY,
    identificador_chat VARCHAR(64) NOT NULL UNIQUE,
    data_hora_inicio DATETIME NOT NULL,
    data_hora_fim DATETIME NULL,
    status_sessao ENUM('Agendamento_Concluido', 'Abandonada', 'Duvida_Resolvida', 'Em_Andamento') NOT NULL DEFAULT 'Em_Andamento',
    escalonado_humano TINYINT(1) NOT NULL DEFAULT 0,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sessao_data_inicio (data_hora_inicio),
    INDEX idx_sessao_status (status_sessao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS capacidade_diaria (
    id_capacidade INT AUTO_INCREMENT PRIMARY KEY,
    data_referencia DATE NOT NULL UNIQUE,
    vagas_totais INT NOT NULL DEFAULT 12,
    observacao VARCHAR(150) NULL,
    INDEX idx_capacidade_data (data_referencia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agendamento (
    id_agendamento INT AUTO_INCREMENT PRIMARY KEY,
    id_paciente INT NOT NULL,
    id_profissional INT NOT NULL,
    id_procedimento INT NOT NULL,
    id_sessao_chatbot INT NULL,
    id_agendamento_origem INT NULL,
    data_hora_agendamento DATETIME NOT NULL,
    status ENUM('Realizado', 'Cancelado', 'No_Show', 'Reagendado') NOT NULL DEFAULT 'Realizado',
    origem ENUM('Chatbot', 'Humano_Recepcao', 'Telefone', 'Outro') NOT NULL DEFAULT 'Chatbot',
    tipo_atendimento ENUM('Primeira_Consulta', 'Retorno') NOT NULL DEFAULT 'Primeira_Consulta',
    modalidade_pagamento ENUM('Particular', 'Convenio') NOT NULL DEFAULT 'Particular',
    data_hora_checkin DATETIME NULL,
    data_hora_inicio_atendimento DATETIME NULL,
    minutos_atraso INT NOT NULL DEFAULT 0,
    valor_cobrado DECIMAL(10,2) NOT NULL,
    escalonado_humano TINYINT(1) NOT NULL DEFAULT 0,
    motivo_cancelamento VARCHAR(255) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_agendamento_paciente
        FOREIGN KEY (id_paciente) REFERENCES paciente (id_paciente)
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
    INDEX idx_agendamento_procedimento (id_procedimento),
    INDEX idx_agendamento_paciente (id_paciente),
    INDEX idx_agendamento_origem (origem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS pagamento (
    id_pagamento INT AUTO_INCREMENT PRIMARY KEY,
    id_agendamento INT NOT NULL,
    valor DECIMAL(10,2) NOT NULL,
    forma_pagamento ENUM('Dinheiro', 'Cartao_Credito', 'Cartao_Debito', 'Pix', 'Guia_Convenio') NOT NULL,
    status_pagamento ENUM('Pago', 'Pendente', 'Cancelado', 'Estornado') NOT NULL DEFAULT 'Pago',
    data_pagamento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pagamento_agendamento
        FOREIGN KEY (id_agendamento) REFERENCES agendamento (id_agendamento)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_pagamento_agendamento (id_agendamento),
    INDEX idx_pagamento_data (data_pagamento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS historico_status_agendamento (
    id_historico INT AUTO_INCREMENT PRIMARY KEY,
    id_agendamento INT NOT NULL,
    status_anterior ENUM('Realizado', 'Cancelado', 'No_Show', 'Reagendado') NULL,
    status_novo ENUM('Realizado', 'Cancelado', 'No_Show', 'Reagendado') NOT NULL,
    motivo VARCHAR(255) NULL,
    alterado_por VARCHAR(100) NOT NULL DEFAULT 'Sistema',
    data_alteracao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_historico_agendamento
        FOREIGN KEY (id_agendamento) REFERENCES agendamento (id_agendamento)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_historico_agendamento (id_agendamento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;