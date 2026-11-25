import { Router, type Request, type Response } from 'express';
import pool, { ErroOperacao } from '../config/database.js';
import { sanitizarTexto, validarIdNumerico, registrarErro } from '../middleware/security.js';
const router = Router();
router.get('/categorias', async (_req: Request, res: Response): Promise<any> => {
  try {
    const [rows] = await pool.query('SELECT id, nome FROM categorias ORDER BY nome');
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar categorias:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar categorias.' });
  }
});

// ============================================================================
// ENDPOINT: POST /api/categorias (Criar uma nova categoria)
// ============================================================================
router.post('/categorias', async (req: Request, res: Response): Promise<any> => {
  try {
    const { nome } = req.body;
    if (!nome || !nome.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'Nome da categoria é obrigatório.' });
    }

    const nomeSanitizado = sanitizarTexto(nome);
    if (!nomeSanitizado) {
      return res.status(400).json({ sucesso: false, erro: 'Nome da categoria contém caracteres inválidos.' });
    }

    const [result] = await pool.query('INSERT INTO categorias (nome) VALUES (?)', [nomeSanitizado]);
    return res.status(201).json({
      sucesso: true,
      mensagem: 'Categoria criada com sucesso!',
      dados: { id: (result as any).insertId, nome: nomeSanitizado }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao criar categoria:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao criar categoria.' });
  }
});

// ============================================================================
// ENDPOINT: PUT /api/categorias/:id (Atualizar o nome de uma categoria)
// ============================================================================
router.put('/categorias/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { nome } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'Nome da categoria é obrigatório.' });
    }

    const nomeSanitizado = sanitizarTexto(nome);
    if (!nomeSanitizado) {
      return res.status(400).json({ sucesso: false, erro: 'Nome da categoria contém caracteres inválidos.' });
    }

    const [existente] = await pool.query('SELECT id FROM categorias WHERE id = ?', [id]);
    if ((existente as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Categoria não encontrada.' });
    }

    await pool.query('UPDATE categorias SET nome = ? WHERE id = ?', [nomeSanitizado, id]);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Categoria atualizada com sucesso!',
      dados: { id: Number(id), nome: nomeSanitizado }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao atualizar categoria:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar categoria.' });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/categorias/:id (Excluir uma categoria e serviços vinculados)
// ============================================================================
router.delete('/categorias/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const [existente] = await pool.query('SELECT id, nome FROM categorias WHERE id = ?', [id]);
    if ((existente as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Categoria não encontrada.' });
    }

    await pool.query('DELETE FROM categorias WHERE id = ?', [id]);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Categoria excluída com sucesso!'
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao excluir categoria:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao excluir categoria.' });
  }
});

// ============================================================================
// ============================================================================
// ENDPOINT: GET /api/servicos (Listar todos os serviços - suporta filtro de ativos - IK-95)
// ============================================================================
router.get('/servicos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { apenas_ativos, ativos } = req.query;
    let sql = `
      SELECT s.id, s.nome, s.preco, s.duracao_minutos, COALESCE(s.ativo, 1) as ativo, c.id as categoria_id, c.nome as categoria_nome 
      FROM servicos s 
      JOIN categorias c ON s.categoria_id = c.id 
    `;

    if (apenas_ativos === 'true' || ativos === '1') {
      sql += ' WHERE (s.ativo = 1 OR s.ativo IS NULL)';
    }

    sql += ' ORDER BY s.nome';

    const [rows] = await pool.query(sql);
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao buscar serviços:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar serviços.' });
  }
});

// ENDPOINT: POST /api/servicos (Criar um novo serviço)
// ============================================================================
router.post('/servicos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { categoria_id, nome, preco, duracao_minutos } = req.body;

    if (!categoria_id || !nome || !nome.trim() || !duracao_minutos) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe a categoria, o nome do serviço e a duração.'
      });
    }

    const nomeSanitizado = sanitizarTexto(nome);

    const duracaoVal = Number(duracao_minutos);
    if (!Number.isSafeInteger(duracaoVal) || duracaoVal <= 0 || duracaoVal > 1440 || duracaoVal % 5 !== 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'A duração do serviço deve ser um número inteiro positivo válido (múltiplo de 5 minutos).'
      });
    }

    const precoVal = preco !== undefined ? Number(preco) : 0;
    if (!Number.isFinite(precoVal) || precoVal < 0 || precoVal > 99999999.99) {
      return res.status(400).json({
        sucesso: false,
        erro: 'O preço do serviço deve ser um número positivo válido.'
      });
    }

    // Verificar se a categoria existe
    const [categorias] = await pool.query('SELECT id FROM categorias WHERE id = ?', [categoria_id]);
    if ((categorias as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Categoria nao encontrada.' });
    }

    const [result] = await pool.query(
      'INSERT INTO servicos (categoria_id, nome, preco, duracao_minutos) VALUES (?, ?, ?, ?)',
      [categoria_id, nomeSanitizado, precoVal, duracaoVal]
    );

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Serviço criado com sucesso!',
      dados: {
        id: (result as any).insertId,
        categoria_id,
        nome: nomeSanitizado,
        preco: precoVal,
        duracao_minutos: duracaoVal
      }
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao criar serviço:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao criar serviço.' });
  }
});

// ============================================================================
// ENDPOINT: PUT /api/servicos/:id (Editar um serviço existente)
// ============================================================================
router.put('/servicos/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do servico invalido.' });
    }

    const { categoria_id, nome, preco, duracao_minutos } = req.body;

    if (!categoria_id || !nome || !nome.trim() || !duracao_minutos) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe a categoria, o nome do serviço e a duração.'
      });
    }

    const nomeSanitizado = sanitizarTexto(nome);

    const duracaoVal = Number(duracao_minutos);
    if (!Number.isSafeInteger(duracaoVal) || duracaoVal <= 0 || duracaoVal > 1440 || duracaoVal % 5 !== 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'A duração do serviço deve ser um número inteiro positivo válido (múltiplo de 5 minutos).'
      });
    }

    const precoVal = preco !== undefined ? Number(preco) : 0;
    if (!Number.isFinite(precoVal) || precoVal < 0 || precoVal > 99999999.99) {
      return res.status(400).json({
        sucesso: false,
        erro: 'O preço do serviço deve ser um número positivo válido.'
      });
    }

    // Verificar se o serviço existe
    const [servicos] = await pool.query('SELECT id FROM servicos WHERE id = ?', [id]);
    if ((servicos as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Servico nao encontrado.' });
    }

    // Verificar se a categoria existe
    const [categorias] = await pool.query('SELECT id FROM categorias WHERE id = ?', [categoria_id]);
    if ((categorias as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Categoria nao encontrada.' });
    }

    await pool.query(
      'UPDATE servicos SET categoria_id = ?, nome = ?, preco = ?, duracao_minutos = ? WHERE id = ?',
      [categoria_id, nomeSanitizado, precoVal, duracaoVal, id]
    );

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Serviço atualizado com sucesso!',
      dados: {
        id: parseInt(id, 10),
        categoria_id,
        nome: nomeSanitizado,
        preco: precoVal,
        duracao_minutos: duracaoVal
      }
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao atualizar serviço:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar serviço.' });
  }
});

// ============================================================================
// ============================================================================
// ENDPOINT: PATCH & PUT /api/servicos/:id/status (Inativar ou reativar procedimento - IK-95)
// ============================================================================
const handleStatusServico = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do serviço inválido.' });
    }

    const { ativo } = req.body;
    const novoStatus = (ativo === 1 || ativo === true) ? 1 : 0;

    const [result]: any = await pool.query(
      'UPDATE procedimento SET ativo = ? WHERE id_procedimento = ?',
      [novoStatus, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Procedimento não encontrado.' });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: novoStatus === 1
        ? 'Procedimento reativado com sucesso!'
        : 'Procedimento inativado com sucesso! Não serão permitidos novos agendamentos e o histórico foi preservado.',
      dados: {
        id: Number(id),
        ativo: novoStatus
      }
    });
  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao atualizar status do serviço:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar status do serviço.' });
  }
};
router.patch('/servicos/:id/status', handleStatusServico);
router.put('/servicos/:id/status', handleStatusServico);

// ============================================================================
// ENDPOINT: DELETE /api/servicos/:id (Inativar procedimento sem perder histórico - IK-95)
// ============================================================================
router.delete('/servicos/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do serviço inválido.' });
    }

    // Verificar se o serviço existe
    const [servicos]: any = await pool.query('SELECT id, nome, ativo FROM servicos WHERE id = ?', [id]);
    if (servicos.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Serviço não encontrado.' });
    }

    // Inativação lógica (Soft-delete): preserva histórico de agendamentos e integridade referencial
    await pool.query('UPDATE procedimento SET ativo = 0 WHERE id_procedimento = ?', [id]);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Procedimento inativado com sucesso! Todos os registros e históricos antigos foram preservados, e ele não será mais oferecido para novos agendamentos.',
      dados: {
        id: Number(id),
        ativo: 0
      }
    });

  } catch (error: any) {
    if (error instanceof ErroOperacao) return res.status(error.status).json({sucesso:false,erro:error.message});
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ sucesso:false, erro:'Registro com vínculos ou histórico não pode ser excluído.' });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ sucesso:false, erro:'Já existe um cadastro com esses dados.' });
    registrarErro('Erro ao inativar serviço:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao inativar serviço.' });
  }
});

// ENDPOINT: GET /api/disponibilidade (Buscar horários disponíveis - Matriz Dinâmica)
// ============================================================================

export default router;
