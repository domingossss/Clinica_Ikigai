import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import pool, { ErroOperacao } from '../config/database.js';
import { sanitizarTexto, validarCPF, registrarErro } from '../middleware/security.js';
const router = Router();
router.get('/pacientes', async (req: Request, res: Response): Promise<any> => {
  try {
    const pagina = Math.max(1, Math.min(100000, Number(req.query.pagina) || 1));
    const limite = Math.max(1, Math.min(100, Number(req.query.limite) || 100));
    if (!Number.isInteger(pagina) || !Number.isInteger(limite)) return res.status(400).json({sucesso:false,erro:'Paginação inválida.'});
    const busca = String(req.query.busca || '').slice(0,150);
    const termo = '%' + busca + '%';
    const filtro = '(nome_completo LIKE ? OR cpf LIKE ? OR telefone LIKE ?)';
    const [total] = await pool.query<any[]>('SELECT COUNT(*) AS total FROM pacientes WHERE ' + filtro,[termo,termo,termo]);
    const [rows] = await pool.query('SELECT id, versao, nome_completo, cpf, telefone, whatsapp, endereco, etapa_tratamento, atendimento_status, observacoes, historico_clinico, criado_em FROM pacientes WHERE ' + filtro + ' ORDER BY criado_em DESC, id LIMIT ? OFFSET ?', [termo,termo,termo,limite,(pagina-1)*limite]);
    return res.status(200).json({ sucesso:true, dados:rows, total:total[0].total, pagina, limite });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar pacientes:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar pacientes.' });
  }
});

// ============================================================================
// ENDPOINT: GET /api/pacientes/:id/historico (Histórico de atendimentos - IK-77)
// Critérios de Aceite:
// CA01 — Histórico em ordem cronológica
// CA02 — Informações mínimas: data, procedimento, profissional, situação (status)
// CA03 — Sem histórico: informa que não existem registros (total: 0, historico: [])
// ============================================================================
router.get('/pacientes/:id/historico', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { ordem = 'DESC' } = req.query;

    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'ID do paciente inválido ou não informado.' });
    }

    const sortDirection = String(ordem).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const isInteger = /^\d+$/.test(id.trim());

    // 1. Verificar se o paciente existe (suporta UUID ou ID numérico de forma tipada)
    const [pacientes]: any = isInteger
      ? await pool.query(
          `SELECT 
             uuid AS id, 
             id_paciente, versao, 
             nome AS nome_completo, 
             cpf, 
             telefone, 
             whatsapp, 
             endereco, 
             etapa_tratamento, 
             atendimento_status, 
             criado_em 
           FROM paciente 
           WHERE id_paciente = ? 
           LIMIT 1`,
          [parseInt(id.trim(), 10)]
        )
      : await pool.query(
          `SELECT 
             uuid AS id, 
             id_paciente, versao, 
             nome AS nome_completo, 
             cpf, 
             telefone, 
             whatsapp, 
             endereco, 
             etapa_tratamento, 
             atendimento_status, 
             criado_em 
           FROM paciente 
           WHERE uuid = ? 
           LIMIT 1`,
          [id.trim()]
        );

    if (!pacientes || pacientes.length === 0) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Paciente não encontrado no sistema.'
      });
    }

    const paciente = pacientes[0];

    // 2. Buscar histórico de atendimentos em ordem cronológica (CA01 e CA02)
    const [historico]: any = await pool.query(
      `SELECT 
         a.id_agendamento AS id,
         DATE_FORMAT(a.data, '%Y-%m-%d') AS data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') AS horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') AS horario_fim,
         a.status,
         a.tipo_atendimento,
         a.observacoes,
         a.origem,
         a.valor_cobrado,
         p.id_procedimento AS servico_id,
         COALESCE(p.nome, 'Atendimento / Procedimento') AS servico_nome,
         COALESCE(p.duracao_minutos, 60) AS duracao_minutos,
         p.preco AS servico_preco,
         e.nome AS categoria_nome,
         pr.id_profissional AS profissional_id,
         COALESCE(pr.nome, 'Profissional da Clínica') AS profissional_nome,
         COALESCE(pr.especialidade_principal, 'Especialista') AS profissional_especialidade,
         a.criado_em
       FROM agendamento a
       LEFT JOIN procedimento p ON a.id_procedimento = p.id_procedimento
       LEFT JOIN especialidade e ON p.id_especialidade = e.id_especialidade
       LEFT JOIN profissional pr ON a.id_profissional = pr.id_profissional
       WHERE a.paciente_uuid = ? OR (COALESCE(a.paciente_uuid, '') = '' AND a.id_paciente = ?)
       ORDER BY a.data ${sortDirection}, a.horario_inicio ${sortDirection}`,
      [paciente.id, paciente.id_paciente]
    );

    // Resposta estruturada para atender CA01, CA02 e CA03
    return res.status(200).json({
      sucesso: true,
      mensagem: historico.length > 0 
        ? `${historico.length} atendimento(s) encontrado(s) no histórico.` 
        : 'Nenhum registro de atendimento encontrado para este paciente.',
      dados: {
        paciente: {
          id: paciente.id,
          id_paciente: paciente.id_paciente,
          nome_completo: paciente.nome_completo,
          cpf: paciente.cpf,
          telefone: paciente.telefone,
          whatsapp: paciente.whatsapp,
          endereco: paciente.endereco,
          etapa_tratamento: paciente.etapa_tratamento,
          criado_em: paciente.criado_em
        },
        historico,
        total: historico.length
      }
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar histórico do paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao consultar o histórico de atendimentos do paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/pacientes/:id (Detalhes de um paciente por ID ou UUID)
// ============================================================================
router.get('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'ID do paciente inválido.' });
    }

    const isInteger = /^\d+$/.test(id.trim());

    const [rows]: any = isInteger
      ? await pool.query(
          `SELECT 
             uuid AS id, 
             id_paciente, versao, 
             nome AS nome_completo, 
             cpf, 
             telefone, 
             whatsapp, 
             endereco, 
             etapa_tratamento, 
             atendimento_status, 
             criado_em 
           FROM paciente 
           WHERE id_paciente = ? 
           LIMIT 1`,
          [parseInt(id.trim(), 10)]
        )
      : await pool.query(
          `SELECT 
             uuid AS id, 
             id_paciente, versao, 
             nome AS nome_completo, 
             cpf, 
             telefone, 
             whatsapp, 
             endereco, 
             etapa_tratamento, 
             atendimento_status, 
             criado_em 
           FROM paciente 
           WHERE uuid = ? 
           LIMIT 1`,
          [id.trim()]
        );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente não encontrado.' });
    }

    return res.status(200).json({ sucesso: true, dados: rows[0] });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar paciente por ID:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar paciente.' });
  }
});

// ============================================================================
// ENDPOINT: POST /api/pacientes (Criar novo paciente sanitizado com UUID)
// ============================================================================
router.post('/pacientes', async (req: Request, res: Response): Promise<any> => {
  try {
    const { nome_completo, cpf, telefone, endereco } = req.body;

    if (!nome_completo || !cpf || !telefone || !endereco) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe nome_completo, cpf, telefone e endereco.'
      });
    }

    // Sanitizar numeros removendo tudo exceto digitos
    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanTelefone = telefone.replace(/\D/g, '');

    // Validacao algoritmica de CPF (digitos verificadores + rejeicao de CPFs com digitos iguais)
    if (!validarCPF(cleanCpf)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'CPF invalido. Verifique os digitos informados.'
      });
    }

    if (cleanTelefone.length < 10 || cleanTelefone.length > 15) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Telefone inválido. O número de telefone deve conter o DDD e de 10 a 15 dígitos.'
      });
    }

    // Validar CPF único
    const [existing] = await pool.query('SELECT id FROM pacientes WHERE cpf = ?', [cleanCpf]);
    if ((existing as any[]).length > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Este CPF já está cadastrado no sistema.'
      });
    }

    // Gerar ID UUID v4 nativamente no Node.js
    const id = randomUUID();

    // Sanitizar campos de texto (prevencao de XSS armazenado)
    const nomeSanitizado = sanitizarTexto(nome_completo);
    const enderecoSanitizado = sanitizarTexto(endereco);

    // Salvar paciente no MySQL (mapeando whatsapp para o telefone limpo)
    await pool.query(
      `INSERT INTO pacientes (id, nome_completo, cpf, telefone, whatsapp, endereco) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, nomeSanitizado, cleanCpf, cleanTelefone, cleanTelefone, enderecoSanitizado]
    );


    return res.status(201).json({
      sucesso: true,
      mensagem: 'Paciente cadastrado com sucesso!',
      dados: {
        id,
        nome_completo: nomeSanitizado,
        cpf: cleanCpf,
        telefone: cleanTelefone,
        endereco: enderecoSanitizado
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao cadastrar paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao processar o cadastro do paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: POST /api/pacientes/rapido (Pré-cadastro com apenas Nome e WhatsApp)
// ============================================================================
router.post('/pacientes/rapido', async (req: Request, res: Response): Promise<any> => {
  try {
    const { nome_completo, whatsapp, telefone, cpf } = req.body;

    if (!nome_completo || !nome_completo.trim()) {
      return res.status(400).json({
        sucesso: false,
        erro: 'O nome do paciente é obrigatório.'
      });
    }

    const telInput = (whatsapp || telefone || '').toString();
    const cleanTelefone = telInput.replace(/\D/g, '');

    if (cleanTelefone.length < 10 || cleanTelefone.length > 15) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Telefone/WhatsApp inválido. Informe o DDD e o número (mínimo 10 dígitos).'
      });
    }

    const nomeSanitizado = sanitizarTexto(nome_completo);
    const finalCpf = cpf ? cpf.replace(/\D/g, '') : null;
    if (finalCpf !== null && !validarCPF(finalCpf)) return res.status(400).json({ sucesso:false, erro:'CPF inválido.' });
    if (finalCpf) {
      const [duplicados] = await pool.query<any[]>('SELECT id FROM pacientes WHERE cpf = ?', [finalCpf]);
      if (duplicados.length) return res.status(409).json({ sucesso:false, erro:'CPF já cadastrado. Selecione o paciente existente.' });
    }
    const id = randomUUID();

    await pool.query(
      `INSERT INTO pacientes (id, nome_completo, cpf, telefone, whatsapp, endereco, etapa_tratamento, atendimento_status) 
       VALUES (?, ?, ?, ?, ?, ?, 'Avaliação', 'Humano')`,
      [
        id, 
        nomeSanitizado, 
        finalCpf, 
        cleanTelefone, 
        cleanTelefone, 
        'Pré-cadastro rápido - Aguardando dados completos na recepção'
      ]
    );


    return res.status(201).json({
      sucesso: true,
      mensagem: 'Paciente pré-cadastrado com sucesso!',
      dados: {
        id,
        nome: nomeSanitizado,
        nome_completo: nomeSanitizado,
        whatsapp: cleanTelefone,
        telefone: cleanTelefone
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro no pré-cadastro rápido de paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno ao realizar pré-cadastro do paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/profissionais (Listar todos os profissionais/terapeutas)
// Permite filtrar por procedimento_id ou servico_id (IK-80 CA03)
// ============================================================================

router.put('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { nome_completo, cpf, telefone, endereco, etapa_tratamento, historico_clinico, observacoes, atendimento_status } = req.body;

    // Verificar se o paciente existe
    const [existing]: any = await pool.query(
      'SELECT id, versao, nome_completo, cpf, telefone, endereco, etapa_tratamento, historico_clinico, observacoes, atendimento_status FROM pacientes WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente nao cadastrado.' });
    }
    const pacienteAtual = existing[0];

    // Se for PROFISSIONAL, permite editar apenas a evolução clínica (etapa_tratamento, historico_clinico, observacoes)
    if (req.usuario?.perfil === 'PROFISSIONAL') {
      const etapaFinal = etapa_tratamento !== undefined ? sanitizarTexto(String(etapa_tratamento)) : pacienteAtual.etapa_tratamento;
      const histFinal = historico_clinico !== undefined ? sanitizarTexto(String(historico_clinico)) : pacienteAtual.historico_clinico;
      const obsFinal = observacoes !== undefined ? sanitizarTexto(String(observacoes)) : pacienteAtual.observacoes;

      await pool.query(
        `UPDATE pacientes
         SET versao = versao + 1,
             etapa_tratamento = ?,
             historico_clinico = ?,
             observacoes = ?
         WHERE id = ?`,
        [etapaFinal || 'Avaliação', histFinal || null, obsFinal || null, id]
      );

      return res.status(200).json({
        sucesso: true,
        mensagem: 'Evolução clínica do paciente atualizada com sucesso!',
        dados: {
          ...pacienteAtual,
          etapa_tratamento: etapaFinal || 'Avaliação',
          historico_clinico: histFinal || null,
          observacoes: obsFinal || null
        }
      });
    }

    if (!nome_completo || !cpf || !telefone || !endereco) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe nome_completo, cpf, telefone e endereco.'
      });
    }

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanTelefone = telefone.replace(/\D/g, '');

    // Validacao algoritmica de CPF
    if (!validarCPF(cleanCpf)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'CPF invalido. Verifique os digitos informados.'
      });
    }

    if (cleanTelefone.length < 10 || cleanTelefone.length > 15) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Telefone invalido. O numero de telefone deve conter o DDD e de 10 a 15 digitos.'
      });
    }

    // Verificar se o novo CPF já está cadastrado em outro paciente
    const [dupCpf] = await pool.query('SELECT id FROM pacientes WHERE cpf = ? AND id != ?', [cleanCpf, id]);
    if ((dupCpf as any[]).length > 0) {
      return res.status(400).json({ sucesso: false, erro: 'Este CPF já está cadastrado em outro paciente.' });
    }

    // Sanitizar campos de texto
    const nomeSanitizado = sanitizarTexto(nome_completo);
    const enderecoSanitizado = sanitizarTexto(endereco);

    if (!Number.isSafeInteger(req.body.versao) || req.body.versao < 0) return res.status(428).json({ sucesso:false, erro:'Atualize o cadastro antes de editar.' });
    // Compare e grave na mesma instrução para não perder edições concorrentes.
    const [atualizado]: any = await pool.query(
      `UPDATE pacientes 
       SET versao = versao + 1, nome_completo = ?, cpf = ?, telefone = ?, whatsapp = ?, endereco = ?, 
           etapa_tratamento = COALESCE(?, etapa_tratamento),
           historico_clinico = IF(?, ?, historico_clinico),
           observacoes = IF(?, ?, observacoes),
           atendimento_status = COALESCE(?, atendimento_status) 
       WHERE id = ? AND versao = ?`,
      [
        nomeSanitizado,
        cleanCpf,
        cleanTelefone,
        cleanTelefone,
        enderecoSanitizado,
        etapa_tratamento === undefined ? null : sanitizarTexto(etapa_tratamento),
        historico_clinico !== undefined,
        historico_clinico ? sanitizarTexto(historico_clinico) : null,
        observacoes !== undefined,
        observacoes ? sanitizarTexto(observacoes) : null,
        atendimento_status ?? null,
        id, req.body.versao
      ]
    );


    if (!atualizado.affectedRows) return res.status(409).json({ sucesso:false, erro:'Este cadastro foi alterado em outra tela. Recarregue os dados antes de salvar.' });
    return res.status(200).json({
      sucesso: true,
      mensagem: 'Paciente atualizado com sucesso!',
      dados: {
        id,
        nome_completo: nomeSanitizado,
        cpf: cleanCpf,
        telefone: cleanTelefone,
        endereco: enderecoSanitizado,
        etapa_tratamento,
        historico_clinico,
        observacoes,
        atendimento_status
      }
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao atualizar paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao atualizar o paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/pacientes/:id (Excluir paciente sem vínculos de histórico)
// ============================================================================
router.delete('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    // Verificar se o paciente existe
    const [existing] = await pool.query('SELECT id FROM pacientes WHERE id = ?', [id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente nao cadastrado.' });
    }

    // A chave estrangeira impede excluir pacientes com histórico de agendamentos.
    await pool.query('DELETE FROM pacientes WHERE id = ?', [id]);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Paciente excluído com sucesso!'
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({ sucesso:false, erro:error.message });
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao excluir paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao excluir o paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/profissionais/:id/agenda (IK-81: Consultar agenda do profissional)
// CA01: Seleção do profissional e abertura de sua agenda
// CA02: Exibição dos compromissos e bloqueios do profissional no período
// CA03: Navegação entre períodos (dia, semana, mês ou intervalo personalizado)
// ============================================================================

export default router;
