import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { validarRegraAgendamento, REGRAS_DIA_SEMANA, validarHorarioExpediente } from '../utils/validation.js';
import pool from '../config/database.js';
import {
  sanitizarTexto,
  validarCPF,
  validarFormatoData,
  validarFormatoHorario,
  validarIdNumerico,
  mascaraTelefone
} from '../middleware/security.js';

const router = Router();

// ============================================================================
// AUXILIARY HELPER FUNCTIONS
// ============================================================================

function parseTimeToMins(timeStr: string): number {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return h * 60 + m;
}

function formatMinsToTime(mins: number): string {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}:00`;
}


// ============================================================================
// ENDPOINT: GET /api/categorias (Listar todas as categorias)
// ============================================================================
router.get('/categorias', async (req: Request, res: Response): Promise<any> => {
  try {
    const [rows] = await pool.query('SELECT id, nome FROM categorias ORDER BY nome');
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    console.error('Erro ao buscar categorias:', error);
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
    console.error('Erro ao criar categoria:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ sucesso: false, erro: 'Uma categoria com este nome já existe.' });
    }
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
    console.error('Erro ao atualizar categoria:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ sucesso: false, erro: 'Uma categoria com este nome já existe.' });
    }
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
    console.error('Erro ao excluir categoria:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao excluir categoria.' });
  }
});

// ============================================================================
// ENDPOINT: GET /api/servicos (Listar todos os serviços)
// ============================================================================
router.get('/servicos', async (req: Request, res: Response): Promise<any> => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.nome, s.preco, s.duracao_minutos, c.id as categoria_id, c.nome as categoria_nome 
      FROM servicos s 
      JOIN categorias c ON s.categoria_id = c.id 
      ORDER BY s.nome
    `);
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    console.error('Erro ao buscar serviços:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar serviços.' });
  }
});

// ============================================================================
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

    const duracaoVal = parseInt(duracao_minutos, 10);
    if (isNaN(duracaoVal) || duracaoVal <= 0 || duracaoVal % 30 !== 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'A duração do serviço deve ser um número inteiro positivo múltiplo de 30 minutos.'
      });
    }

    const precoVal = preco !== undefined ? parseFloat(preco) : 0;
    if (isNaN(precoVal) || precoVal < 0) {
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
    console.error('Erro ao criar serviço:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ sucesso: false, erro: 'Um serviço com este nome já existe.' });
    }
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

    const duracaoVal = parseInt(duracao_minutos, 10);
    if (isNaN(duracaoVal) || duracaoVal <= 0 || duracaoVal % 30 !== 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'A duração do serviço deve ser um número inteiro positivo múltiplo de 30 minutos.'
      });
    }

    const precoVal = preco !== undefined ? parseFloat(preco) : 0;
    if (isNaN(precoVal) || precoVal < 0) {
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
    console.error('Erro ao atualizar serviço:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ sucesso: false, erro: 'Um serviço com este nome já existe.' });
    }
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar serviço.' });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/servicos/:id (Excluir um serviço existente)
// ============================================================================
router.delete('/servicos/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do servico invalido.' });
    }

    // Verificar se o serviço existe
    const [servicos] = await pool.query('SELECT id FROM servicos WHERE id = ?', [id]);
    if ((servicos as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Servico nao encontrado.' });
    }

    await pool.query('DELETE FROM servicos WHERE id = ?', [id]);
    return res.status(200).json({
      sucesso: true,
      mensagem: 'Serviço excluído com sucesso!'
    });

  } catch (error: any) {
    console.error('Erro ao excluir serviço:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao excluir serviço.' });
  }
});


// ============================================================================
// ENDPOINT: GET /api/disponibilidade (Buscar horários disponíveis - Matriz Dinâmica)
// ============================================================================
router.get('/disponibilidade', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, servico_id, profissional_id } = req.query;

    if (!data || !servico_id) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Parâmetros data (YYYY-MM-DD) e servico_id são obrigatórios.'
      });
    }

    const profId = profissional_id ? parseInt(profissional_id as string, 10) : 1;
    const servId = parseInt(servico_id as string, 10);

    // 1. Obter informações do serviço
    const [servicos] = await pool.query(
      `SELECT s.*, c.nome as categoria_nome 
       FROM servicos s 
       JOIN categorias c ON s.categoria_id = c.id 
       WHERE s.id = ?`,
      [servId]
    );
    if ((servicos as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Serviço não encontrado.' });
    }
    const servico = (servicos as any[])[0];
    const duracao = servico.duracao_minutos;

    // 2. Obter regras de funcionamento para o dia da semana
    const dataObj = new Date((data as string) + 'T00:00:00');
    const diasSemanaNomes = [
      'Domingo',
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado'
    ];
    const diaSemanaNome = diasSemanaNomes[dataObj.getDay()];

    const diaSemana = dataObj.getDay();
    if (diaSemana === 0 || diaSemana === 6) {
      return res.status(200).json({
        sucesso: true,
        dados: [],
        mensagem: 'A clínica realiza atendimentos apenas de segunda a sexta-feira, das 08:00 às 18:00.'
      });
    }

    // Validar funcionamento da clínica (Segunda a Sexta-feira)
    const respeitaRegraDia = validarRegraAgendamento(dataObj);
    if (!respeitaRegraDia) {
      return res.status(200).json({
        sucesso: true,
        dados: [],
        mensagem: `A clínica não possui expediente aos finais de semana.`
      });
    }

    // Horário operacional fixo: 08:00 às 18:00
    let horaInicio = '08:00:00';
    let horaFim = '18:00:00';

    // 3. Obter agendamentos existentes no dia com detalhes para o frontend
    const [agendamentos] = await pool.query(
      `SELECT a.id, a.horario_inicio, a.horario_fim, p.nome_completo as paciente_nome, s.nome as servico_nome 
       FROM agendamentos a
       JOIN pacientes p ON a.paciente_id = p.id
       JOIN servicos s ON a.servico_id = s.id
       WHERE a.profissional_id = ? AND a.data = ? AND a.status != "Cancelado"
       ORDER BY a.horario_inicio`,
      [profId, data as string]
    );

    // 3b. Obter bloqueios de horário existentes no dia (IK-87)
    let bloqueios: any[] = [];
    try {
      const [blRows] = await pool.query(
        `SELECT id, horario_inicio, horario_fim, motivo 
         FROM bloqueios 
         WHERE profissional_id = ? AND data = ?
         ORDER BY horario_inicio`,
        [profId, data as string]
      );
      bloqueios = blRows as any[];
    } catch {
      bloqueios = [];
    }

    // 4. Gerar slots de 30 em 30 min
    const startMins = parseTimeToMins(horaInicio);
    const endMins = parseTimeToMins(horaFim);

    const slots: { horario: string; disponivel: boolean }[] = [];

    // O tratamento termina até no máximo horaFim
    for (let current = startMins; current + duracao <= endMins; current += 30) {
      const currentStartStr = formatMinsToTime(current);
      const currentEnd = current + duracao + 15; // Duração + 15 min buffer

      // Verificar se este bloco se sobrepõe a algum agendamento existente
      let overlap = false;
      for (const ag of (agendamentos as any[])) {
        const agStart = parseTimeToMins(ag.horario_inicio);
        const agEnd = parseTimeToMins(ag.horario_fim);

        // Se houver qualquer interseção de tempo (S1 < E2 e S2 < E1)
        if (current < agEnd && agStart < currentEnd) {
          overlap = true;
          break;
        }
      }

      // Verificar se este bloco se sobrepõe a algum bloqueio de horário (IK-87)
      if (!overlap && Array.isArray(bloqueios)) {
        for (const bl of bloqueios) {
          const blStart = parseTimeToMins(bl.horario_inicio);
          const blEnd = parseTimeToMins(bl.horario_fim);
          if (current < blEnd && blStart < currentEnd) {
            overlap = true;
            break;
          }
        }
      }

      slots.push({
        horario: currentStartStr.substring(0, 5), // Formato HH:MM
        disponivel: !overlap
      });
    }

    return res.status(200).json({ 
      sucesso: true, 
      dados: slots,
      ocupados: (agendamentos as any[]).map(ag => ({
        id: ag.id,
        horario_inicio: ag.horario_inicio.substring(0, 5),
        horario_fim: ag.horario_fim.substring(0, 5),
        paciente_nome: ag.paciente_nome,
        servico_nome: ag.servico_nome
      })),
      bloqueios: bloqueios.map(bl => ({
        id: bl.id,
        horario_inicio: bl.horario_inicio.substring(0, 5),
        horario_fim: bl.horario_fim.substring(0, 5),
        motivo: bl.motivo
      }))
    });

  } catch (error: any) {
    console.error('Erro ao buscar disponibilidade:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao calcular disponibilidade.' });
  }
});

// ============================================================================
// ENDPOINT: POST /api/agendamentos (Criar agendamento dinâmico)
// ============================================================================
router.post('/agendamentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { paciente_id, profissional_id, servico_id, data, horario_inicio } = req.body;

    // 1. Validacao de dados de entrada obrigatorios
    if (!paciente_id || !profissional_id || !servico_id || !data || !horario_inicio) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe paciente_id, profissional_id, servico_id, data e horario_inicio.'
      });
    }

    // 1b. Validacao de formato de data e horario (prevencao de injection via formatos invalidos)
    if (!validarFormatoData(data)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de data invalido. Use YYYY-MM-DD.' });
    }
    if (!validarFormatoHorario(horario_inicio)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de horario invalido. Use HH:MM.' });
    }

    // 2. Buscar informações do serviço para pegar a duração e categoria
    const [servicos] = await pool.query(
      `SELECT s.*, c.nome as categoria_nome 
       FROM servicos s 
       JOIN categorias c ON s.categoria_id = c.id 
       WHERE s.id = ?`,
      [servico_id]
    );
    if ((servicos as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Servico nao cadastrado.' });
    }
    const servico = (servicos as any[])[0];
    const duracao = servico.duracao_minutos;

    // 3. Validar se o agendamento respeita o funcionamento da clínica (Segunda a Sexta)
    const dataObj = new Date(data + 'T00:00:00');
    const ehDiaValido = validarRegraAgendamento(dataObj);

    if (!ehDiaValido) {
      const diasSemanaNomes = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado'
      ];
      const diaSemanaNome = diasSemanaNomes[dataObj.getDay()];
      return res.status(400).json({
        sucesso: false,
        erro: `Agendamento bloqueado: a clínica não atende aos finais de semana (${diaSemanaNome}).`,
        detalhes: `A Clínica Ikigai realiza atendimentos apenas de segunda a sexta-feira, das 08:00 às 18:00.`
      });
    }

    // 4. Validar se o horário está dentro do expediente (08:00 às 18:00)
    const checagemHorario = validarHorarioExpediente(horario_inicio, duracao);
    if (!checagemHorario.valido) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Horário fora do expediente operacional.',
        detalhes: checagemHorario.motivo || 'Os agendamentos só podem ser realizados das 08:00 às 18:00.'
      });
    }

    // 4. Verificar fisicamente se Paciente e Profissional existem no MySQL
    const [pacientes] = await pool.query('SELECT id FROM pacientes WHERE id = ?', [paciente_id]);
    if ((pacientes as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente nao cadastrado.' });
    }

    const [profissionais] = await pool.query('SELECT id FROM profissionais WHERE id = ?', [profissional_id]);
    if ((profissionais as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional nao cadastrado.' });
    }

    // 4b. Verificar se o profissional está vinculado ao procedimento solicitado (IK-80 CA03)
    const [vinculos]: any = await pool.query(
      'SELECT 1 FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?',
      [profissional_id, servico_id]
    );
    if (vinculos.length === 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Profissional não habilitado para realizar este procedimento.',
        detalhes: 'O profissional selecionado não possui vínculo ativo com o procedimento solicitado.'
      });
    }

    // 5. Calcular horário de término (horario_inicio + duracao + 15 min buffer)
    const inicioMins = parseTimeToMins(horario_inicio);
    const fimMins = inicioMins + duracao + 15;
    const horario_fim = formatMinsToTime(fimMins);

    // 6. Verificar se há sobreposição (Overlap)
    // O conflito ocorre se: novo_inicio < ag_fim E ag_inicio < novo_fim
    const [conflitos] = await pool.query(
      `SELECT id, horario_inicio, horario_fim 
       FROM agendamentos 
       WHERE profissional_id = ? AND data = ? AND status != 'Cancelado' 
         AND ? < horario_fim AND horario_inicio < ?`,
      [profissional_id, data, horario_inicio, horario_fim]
    );

    if ((conflitos as any[]).length > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Conflito de agenda. Ja existe um agendamento neste horario (ou no periodo de respiro).'
      });
    }

    // 6b. Verificar se há sobreposição com bloqueios de agenda (IK-87)
    try {
      const [bloqueiosConflito] = await pool.query(
        `SELECT id, motivo, horario_inicio, horario_fim 
         FROM bloqueios 
         WHERE profissional_id = ? AND data = ? 
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissional_id, data, horario_inicio, horario_fim]
      );
      if ((bloqueiosConflito as any[]).length > 0) {
        const blk = (bloqueiosConflito as any[])[0];
        return res.status(400).json({
          sucesso: false,
          erro: `Horário bloqueado na agenda (${blk.motivo || 'Horário Bloqueado'}). Não é possível realizar agendamentos neste intervalo.`
        });
      }
    } catch {
      // Ignora se tabela/view ainda não estiver disponível
    }

    // 7. Inserir no Banco de Dados
    const [result] = await pool.query(
      `INSERT INTO agendamentos (paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'Agendado')`,
      [paciente_id, profissional_id, servico_id, data, horario_inicio, horario_fim]
    );
    const novoAgendamentoId = (result as any).insertId;

    console.log(`[MySQL] Agendamento criado: ID ${novoAgendamentoId} (${data} das ${horario_inicio} às ${horario_fim})`);

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Agendamento cadastrado com sucesso!',
      dados: {
        id: novoAgendamentoId,
        paciente_id,
        profissional_id,
        servico_id,
        data,
        horario_inicio,
        horario_fim,
        status: 'Agendado'
      }
    });

  } catch (error: any) {
    console.error('Erro ao criar agendamento:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao processar o agendamento.'
    });
  }
});


// ============================================================================
// ENDPOINT: GET /api/pacientes (Listar todos os pacientes registrados)
// ============================================================================
router.get('/pacientes', async (req: Request, res: Response): Promise<any> => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nome_completo, cpf, telefone, whatsapp, endereco, etapa_tratamento, atendimento_status, criado_em 
       FROM pacientes 
       ORDER BY criado_em DESC`
    );
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    console.error('Erro ao buscar pacientes:', error);
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
             id_paciente, 
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
             id_paciente, 
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
       WHERE a.paciente_uuid = ? OR a.id_paciente = ?
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
    console.error('Erro ao buscar histórico do paciente:', error);
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
             id_paciente, 
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
             id_paciente, 
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
    console.error('Erro ao buscar paciente por ID:', error);
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

    console.log(`[MySQL] Paciente criado com UUID: ${id}`);

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
    console.error('Erro ao cadastrar paciente:', error);
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

    // Verificar se já existe paciente com este telefone/whatsapp
    const [existentes] = await pool.query(
      'SELECT id, nome_completo as nome, whatsapp, telefone FROM pacientes WHERE whatsapp = ? OR telefone = ?',
      [cleanTelefone, cleanTelefone]
    );

    const nomeSanitizado = sanitizarTexto(nome_completo);

    if ((existentes as any[]).length > 0) {
      const pacienteEncontrado = (existentes as any[])[0];
      return res.status(200).json({
        sucesso: true,
        mensagem: 'Paciente já cadastrado com este telefone.',
        jaExistia: true,
        dados: {
          id: pacienteEncontrado.id,
          nome: pacienteEncontrado.nome || pacienteEncontrado.nome_completo,
          whatsapp: pacienteEncontrado.whatsapp
        }
      });
    }

    // Se CPF foi informado, valida; senão, gera chave única provisória
    let finalCpf = `PRE_${cleanTelefone.slice(-8)}`;
    if (cpf && cpf.trim()) {
      const cleanCpf = cpf.replace(/\D/g, '');
      if (cleanCpf.length === 11 && validarCPF(cleanCpf)) {
        // Verificar se esse CPF já está em uso
        const [cpfDup] = await pool.query('SELECT id FROM pacientes WHERE cpf = ?', [cleanCpf]);
        if ((cpfDup as any[]).length === 0) {
          finalCpf = cleanCpf;
        }
      }
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

    console.log(`[MySQL] Pré-cadastro rápido de paciente concluído: ${nomeSanitizado} (UUID: ${id})`);

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
    console.error('Erro no pré-cadastro rápido de paciente:', error);
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
router.get('/profissionais', async (req: Request, res: Response): Promise<any> => {
  try {
    const { procedimento_id, servico_id } = req.query;
    const procId = procedimento_id || servico_id;

    if (procId) {
      const [rows] = await pool.query(`
        SELECT p.id, p.nome, p.especialidade, p.ativo 
        FROM profissionais p
        INNER JOIN profissional_procedimento pp ON p.id = pp.id_profissional
        WHERE pp.id_procedimento = ? AND p.ativo = 1
        ORDER BY p.id ASC
      `, [procId]);
      return res.status(200).json({ sucesso: true, dados: rows });
    }

    const [rows] = await pool.query('SELECT id, nome, especialidade, ativo FROM profissionais ORDER BY id ASC');
    return res.status(200).json({ sucesso: true, dados: rows });
  } catch (error: any) {
    console.error('Erro ao buscar profissionais:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar profissionais.' });
  }
});

// ============================================================================
// ENDPOINT: PATCH & PUT /api/profissionais/:id/status (Alternar status ativo/inativo na grade)
// ============================================================================
const handleStatusProfissional = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { ativo } = req.body;

    const novoStatus = (ativo === 1 || ativo === true) ? 1 : 0;

    const [result]: any = await pool.query(
      'UPDATE profissionais SET ativo = ? WHERE id = ?',
      [novoStatus, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: novoStatus === 1 ? 'Profissional ativado na grade com sucesso!' : 'Profissional desativado da grade com sucesso!',
      dados: {
        id: Number(id),
        ativo: novoStatus
      }
    });
  } catch (error: any) {
    console.error('Erro ao atualizar status do profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar status do profissional.' });
  }
};

router.patch('/profissionais/:id/status', handleStatusProfissional);
router.put('/profissionais/:id/status', handleStatusProfissional);

// ============================================================================
// ENDPOINT: POST /api/profissionais (Cadastrar novo profissional/terapeuta)
// ============================================================================
router.post('/profissionais', async (req: Request, res: Response): Promise<any> => {
  try {
    const { nome, especialidade } = req.body;

    if (!nome || typeof nome !== 'string' || !nome.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'O nome do profissional é obrigatório.' });
    }

    const nomeLimpo = nome.trim();
    const especialidadeLimpa = (especialidade && typeof especialidade === 'string' && especialidade.trim())
      ? especialidade.trim()
      : 'Especialista';

    const [result]: any = await pool.query(
      'INSERT INTO profissionais (nome, especialidade, ativo) VALUES (?, ?, 1)',
      [nomeLimpo, especialidadeLimpa]
    );

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Profissional cadastrado com sucesso!',
      dados: {
        id: result.insertId,
        nome: nomeLimpo,
        especialidade: especialidadeLimpa,
        ativo: 1
      }
    });
  } catch (error: any) {
    console.error('Erro ao cadastrar profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao cadastrar profissional.' });
  }
});

// ============================================================================
// ENDPOINT: PUT /api/profissionais/:id (Editar profissional/terapeuta)
// ============================================================================
router.put('/profissionais/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { nome, especialidade } = req.body;

    if (!nome || typeof nome !== 'string' || !nome.trim()) {
      return res.status(400).json({ sucesso: false, erro: 'O nome do profissional é obrigatório.' });
    }

    const nomeLimpo = nome.trim();
    const especialidadeLimpa = (especialidade && typeof especialidade === 'string' && especialidade.trim())
      ? especialidade.trim()
      : 'Especialista';

    const [result]: any = await pool.query(
      'UPDATE profissionais SET nome = ?, especialidade = ? WHERE id = ?',
      [nomeLimpo, especialidadeLimpa, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Profissional atualizado com sucesso!',
      dados: {
        id: Number(id),
        nome: nomeLimpo,
        especialidade: especialidadeLimpa
      }
    });
  } catch (error: any) {
    console.error('Erro ao atualizar profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar profissional.' });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/profissionais/:id (Excluir profissional/terapeuta)
// ============================================================================
router.delete('/profissionais/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    // Verificar se existem agendamentos vinculados a este profissional
    const [agendamentos]: any = await pool.query(
      'SELECT COUNT(*) as total FROM agendamentos WHERE profissional_id = ?',
      [id]
    );

    if (agendamentos[0]?.total > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: `Não é possível excluir este profissional pois existem ${agendamentos[0].total} agendamento(s) vinculado(s) a ele.`
      });
    }

    const [result]: any = await pool.query('DELETE FROM profissionais WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Profissional excluído com sucesso!'
    });
  } catch (error: any) {
    console.error('Erro ao excluir profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao excluir profissional.' });
  }
});

// ============================================================================
// ENDPOINTS: VINCULAÇÃO DE PROCEDIMENTOS AO PROFISSIONAL (IK-80)
// ============================================================================

/**
 * GET /api/profissionais/:id/procedimentos
 * CA01: Retorna todos os procedimentos cadastrados na clínica indicando quais estão vinculados ao profissional.
 */
router.get('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    // Verificar se o profissional existe
    const [profs]: any = await pool.query('SELECT id, nome, especialidade FROM profissionais WHERE id = ?', [id]);
    if (profs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    const [rows]: any = await pool.query(`
      SELECT 
        p.id_procedimento AS id,
        p.nome,
        p.duracao_minutos,
        p.preco,
        p.id_especialidade AS categoria_id,
        COALESCE(e.nome, 'Geral') AS categoria_nome,
        p.ativo,
        CASE WHEN pp.id_profissional IS NOT NULL THEN 1 ELSE 0 END AS vinculado
      FROM procedimento p
      LEFT JOIN especialidade e ON p.id_especialidade = e.id_especialidade
      LEFT JOIN profissional_procedimento pp 
        ON p.id_procedimento = pp.id_procedimento AND pp.id_profissional = ?
      WHERE p.ativo = 1
      ORDER BY p.nome ASC
    `, [id]);

    const vinculados = rows.filter((r: any) => r.vinculado === 1);
    const procedimento_ids = vinculados.map((r: any) => r.id);

    return res.status(200).json({
      sucesso: true,
      profissional: profs[0],
      dados: rows,
      vinculados,
      procedimento_ids
    });
  } catch (error: any) {
    console.error('Erro ao buscar procedimentos do profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar procedimentos do profissional.' });
  }
});

/**
 * PUT /api/profissionais/:id/procedimentos
 * CA01 & CA02: Atualiza a lista completa de procedimentos vinculados ao profissional.
 * Permite selecionar um ou mais procedimentos ativos e salvar, ou remover vínculos.
 */
router.put('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { procedimentos, procedimento_ids } = req.body;

    const lista = procedimentos !== undefined ? procedimentos : procedimento_ids;

    if (!Array.isArray(lista)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Informe uma lista (array) de IDs de procedimentos no corpo da requisição.'
      });
    }

    // Verificar se o profissional existe
    const [profs]: any = await pool.query('SELECT id, nome FROM profissionais WHERE id = ?', [id]);
    if (profs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    const procIds = lista.map(Number).filter(n => !isNaN(n) && n > 0);

    // Se informou procedimentos, verificar se todos existem e estão ativos
    if (procIds.length > 0) {
      const [procsValidos]: any = await pool.query(
        'SELECT id_procedimento FROM procedimento WHERE id_procedimento IN (?) AND ativo = 1',
        [procIds]
      );
      if (procsValidos.length !== procIds.length) {
        return res.status(400).json({
          sucesso: false,
          erro: 'Um ou mais procedimentos informados são inválidos ou inativos.'
        });
      }
    }

    // Atualiza vínculos: remove os antigos e insere os novos
    await pool.query('DELETE FROM profissional_procedimento WHERE id_profissional = ?', [id]);

    if (procIds.length > 0) {
      const valores = procIds.map((procId: number) => [Number(id), procId]);
      await pool.query(
        'INSERT INTO profissional_procedimento (id_profissional, id_procedimento) VALUES ?',
        [valores]
      );
    }

    console.log(`[MySQL] Vínculos atualizados para profissional #${id}: [${procIds.join(', ')}]`);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Vínculos de procedimentos salvos com sucesso!',
      dados: {
        id_profissional: Number(id),
        procedimentos: procIds
      }
    });
  } catch (error: any) {
    console.error('Erro ao atualizar vínculos de procedimentos do profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao salvar vínculos de procedimentos.' });
  }
});

/**
 * POST /api/profissionais/:id/procedimentos
 * CA01: Adiciona vínculo pontual de um procedimento ao profissional.
 */
router.post('/profissionais/:id/procedimentos', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { procedimento_id, servico_id } = req.body;
    const procId = Number(procedimento_id || servico_id);

    if (!procId || isNaN(procId)) {
      return res.status(400).json({ sucesso: false, erro: 'Informe o ID do procedimento válido.' });
    }

    const [profs]: any = await pool.query('SELECT id FROM profissionais WHERE id = ?', [id]);
    if (profs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não encontrado.' });
    }

    const [procs]: any = await pool.query('SELECT id_procedimento FROM procedimento WHERE id_procedimento = ? AND ativo = 1', [procId]);
    if (procs.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Procedimento não encontrado ou inativo.' });
    }

    await pool.query(
      'INSERT IGNORE INTO profissional_procedimento (id_profissional, id_procedimento) VALUES (?, ?)',
      [id, procId]
    );

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Procedimento vinculado com sucesso ao profissional!',
      dados: {
        id_profissional: Number(id),
        id_procedimento: procId
      }
    });
  } catch (error: any) {
    console.error('Erro ao vincular procedimento ao profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao vincular procedimento.' });
  }
});

/**
 * DELETE /api/profissionais/:id/procedimentos/:procedimentoId
 * CA02: Remove vínculo pontual de um procedimento do profissional.
 */
router.delete('/profissionais/:id/procedimentos/:procedimentoId', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id, procedimentoId } = req.params;

    const [result]: any = await pool.query(
      'DELETE FROM profissional_procedimento WHERE id_profissional = ? AND id_procedimento = ?',
      [id, procedimentoId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Vínculo não encontrado entre o profissional e o procedimento informados.'
      });
    }

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Vínculo removido com sucesso!'
    });
  } catch (error: any) {
    console.error('Erro ao remover vínculo do profissional:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao desvincular procedimento.' });
  }
});

/**
 * GET /api/servicos/:id/profissionais e GET /api/procedimentos/:id/profissionais
 * CA03: Retorna somente profissionais habilitados para realizar o procedimento.
 */
const handleProfissionaisPorServico = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const [rows]: any = await pool.query(`
      SELECT 
        p.id, 
        p.nome, 
        p.especialidade, 
        p.ativo 
      FROM profissionais p
      INNER JOIN profissional_procedimento pp ON p.id = pp.id_profissional
      WHERE pp.id_procedimento = ? AND p.ativo = 1
      ORDER BY p.nome ASC
    `, [id]);

    return res.status(200).json({
      sucesso: true,
      procedimento_id: Number(id),
      dados: rows
    });
  } catch (error: any) {
    console.error('Erro ao buscar profissionais vinculados ao procedimento:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar profissionais do procedimento.' });
  }
};

router.get('/servicos/:id/profissionais', handleProfissionaisPorServico);
router.get('/procedimentos/:id/profissionais', handleProfissionaisPorServico);

// ============================================================================
// ENDPOINT: PUT /api/pacientes/:id (Editar paciente existente)
// ============================================================================
router.put('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { nome_completo, cpf, telefone, endereco, etapa_tratamento, historico_clinico, atendimento_status } = req.body;

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

    // Verificar se o paciente existe
    const [existing] = await pool.query('SELECT id FROM pacientes WHERE id = ?', [id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente nao cadastrado.' });
    }

    // Verificar se o novo CPF já está cadastrado em outro paciente
    const [dupCpf] = await pool.query('SELECT id FROM pacientes WHERE cpf = ? AND id != ?', [cleanCpf, id]);
    if ((dupCpf as any[]).length > 0) {
      return res.status(400).json({ sucesso: false, erro: 'Este CPF já está cadastrado em outro paciente.' });
    }

    // Verificar se o novo WhatsApp (telefone limpo) já está cadastrado em outro paciente
    const [dupWa] = await pool.query('SELECT id FROM pacientes WHERE whatsapp = ? AND id != ?', [cleanTelefone, id]);
    if ((dupWa as any[]).length > 0) {
      return res.status(400).json({ sucesso: false, erro: 'Este WhatsApp já está cadastrado em outro paciente.' });
    }

    // Sanitizar campos de texto
    const nomeSanitizado = sanitizarTexto(nome_completo);
    const enderecoSanitizado = sanitizarTexto(endereco);

    // Atualizar no banco de dados
    await pool.query(
      `UPDATE pacientes 
       SET nome_completo = ?, cpf = ?, telefone = ?, whatsapp = ?, endereco = ?, 
           etapa_tratamento = ?, historico_clinico = ?, atendimento_status = ? 
       WHERE id = ?`,
      [
        nomeSanitizado,
        cleanCpf,
        cleanTelefone,
        cleanTelefone,
        enderecoSanitizado,
        etapa_tratamento || 'Avaliacao',
        historico_clinico ? sanitizarTexto(historico_clinico) : null,
        atendimento_status || 'IA',
        id
      ]
    );

    console.log(`[MySQL] Paciente atualizado: ${id}`);

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
        atendimento_status
      }
    });

  } catch (error: any) {
    console.error('Erro ao atualizar paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao atualizar o paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/pacientes/:id (Excluir paciente e agendamentos cascateados)
// ============================================================================
router.delete('/pacientes/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    // Verificar se o paciente existe
    const [existing] = await pool.query('SELECT id FROM pacientes WHERE id = ?', [id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Paciente nao cadastrado.' });
    }

    // Deletar o paciente (a restrição ON DELETE CASCADE apagará seus agendamentos no MySQL)
    await pool.query('DELETE FROM pacientes WHERE id = ?', [id]);
    console.log(`[MySQL] Paciente excluído: ${id}`);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Paciente excluído com sucesso!'
    });

  } catch (error: any) {
    console.error('Erro ao excluir paciente:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao excluir o paciente.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/agendamentos/dia?data=YYYY-MM-DD (Grade de Agenda do Dia)
// ============================================================================
router.get('/agendamentos/dia', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Parâmetro data (YYYY-MM-DD) é obrigatório.'
      });
    }

    if (!validarFormatoData(data as string)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de data inválido. Use YYYY-MM-DD.' });
    }

    const [rows] = await pool.query(
      `SELECT 
         a.id,
         DATE_FORMAT(a.data, '%Y-%m-%d') as data,
         TIME_FORMAT(a.horario_inicio, '%H:%i') as horario_inicio,
         TIME_FORMAT(a.horario_fim, '%H:%i') as horario_fim,
         a.status,
         p.id as paciente_id,
         p.nome_completo as paciente_nome,
         p.whatsapp as paciente_whatsapp,
         pr.id as profissional_id,
         pr.nome as profissional_nome,
         s.nome as servico_nome,
         s.duracao_minutos
       FROM agendamentos a
       JOIN pacientes p ON a.paciente_id = p.id
       JOIN profissionais pr ON a.profissional_id = pr.id
       JOIN servicos s ON a.servico_id = s.id
       WHERE a.data = ? AND a.status != 'Cancelado'
       ORDER BY pr.id, a.horario_inicio`,
      [data as string]
    );

    // Buscar bloqueios de horários do dia (IK-87)
    let bloqueios: any[] = [];
    try {
      const [blRows] = await pool.query(
        `SELECT 
           id,
           profissional_id,
           DATE_FORMAT(data, '%Y-%m-%d') as data,
           TIME_FORMAT(horario_inicio, '%H:%i') as horario_inicio,
           TIME_FORMAT(horario_fim, '%H:%i') as horario_fim,
           motivo
         FROM bloqueios
         WHERE data = ?
         ORDER BY profissional_id, horario_inicio`,
        [data as string]
      );
      bloqueios = blRows as any[];
    } catch {
      bloqueios = [];
    }

    return res.status(200).json({ sucesso: true, dados: rows, bloqueios });

  } catch (error: any) {
    console.error('Erro ao buscar grade de agenda:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao buscar agenda do dia.' });
  }
});

// ============================================================================
// ENDPOINT: PUT /api/agendamentos/:id/status (Atualizar status do agendamento)
// ============================================================================
router.put('/agendamentos/:id/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do agendamento inválido.' });
    }

    const statusValidos = ['Agendado', 'Confirmado', 'Na Recepção', 'Em Atendimento', 'Concluído', 'Cancelado', 'Reagendado'];
    if (!status || !statusValidos.includes(status)) {
      return res.status(400).json({
        sucesso: false,
        erro: `Status inválido. Use um dos seguintes: ${statusValidos.join(', ')}.`
      });
    }

    const [existing] = await pool.query('SELECT id FROM agendamentos WHERE id = ?', [id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Agendamento não encontrado.' });
    }

    await pool.query('UPDATE agendamentos SET status = ? WHERE id = ?', [status, id]);
    console.log(`[MySQL] Status do agendamento ID ${id} alterado para: ${status}`);

    return res.status(200).json({
      sucesso: true,
      mensagem: `Status atualizado para "${status}" com sucesso!`,
      dados: { id: parseInt(id, 10), status }
    });

  } catch (error: any) {
    console.error('Erro ao atualizar status do agendamento:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar status.' });
  }
});

// ============================================================================
// ENDPOINT: PUT /api/agendamentos/:id/reagendar (Reagendar atendimento - IK-85)
// ============================================================================
router.put('/agendamentos/:id/reagendar', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { data, horario_inicio, motivo } = req.body;

    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do agendamento inválido.' });
    }

    if (!data || !horario_inicio) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe nova data (YYYY-MM-DD) e novo horario_inicio (HH:MM).'
      });
    }

    if (!validarFormatoData(data)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de data inválido. Use YYYY-MM-DD.' });
    }

    if (!validarFormatoHorario(horario_inicio)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de horário inválido. Use HH:MM.' });
    }

    // 1. Obter agendamento existente
    const [existing] = await pool.query(
      `SELECT a.*, s.duracao_minutos 
       FROM agendamentos a 
       JOIN servicos s ON a.servico_id = s.id 
       WHERE a.id = ?`,
      [id]
    );

    if ((existing as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Agendamento não encontrado.' });
    }

    const agendamento = (existing as any[])[0];

    if (agendamento.status === 'Cancelado') {
      return res.status(400).json({
        sucesso: false,
        erro: 'Atendimentos cancelados não podem ser reagendados.'
      });
    }

    const duracao = agendamento.duracao_minutos || 60;
    const profissional_id = agendamento.profissional_id;

    // 2. Critério CA02: Validar funcionamento da clínica (Segunda a Sexta)
    const dataObj = new Date(data + 'T00:00:00');
    if (!validarRegraAgendamento(dataObj)) {
      const diasSemanaNomes = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
      const diaSemanaNome = diasSemanaNomes[dataObj.getDay()];
      return res.status(400).json({
        sucesso: false,
        erro: `Reagendamento bloqueado: a clínica não atende aos finais de semana (${diaSemanaNome}).`,
        detalhes: 'A Clínica Ikigai realiza atendimentos apenas de segunda a sexta-feira, das 08:00 às 18:00.'
      });
    }

    // 3. Critério CA02: Validar expediente operacional (08:00 às 18:00)
    const checagemHorario = validarHorarioExpediente(horario_inicio, duracao);
    if (!checagemHorario.valido) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Horário fora do expediente operacional.',
        detalhes: checagemHorario.motivo || 'Os atendimentos devem iniciar a partir das 08:00 e encerrar até 18:00.'
      });
    }

    // 4. Calcular novo horário de término (+15 min buffer)
    const inicioMins = parseTimeToMins(horario_inicio);
    const fimMins = inicioMins + duracao + 15;
    const horario_fim = formatMinsToTime(fimMins);

    // 5. Critério CA03: Verificar conflito com outros agendamentos (preservando o original em caso de conflito)
    const [conflitos] = await pool.query(
      `SELECT id, horario_inicio, horario_fim 
       FROM agendamentos 
       WHERE profissional_id = ? AND data = ? AND id != ? AND status != 'Cancelado' 
         AND ? < horario_fim AND horario_inicio < ?`,
      [profissional_id, data, id, horario_inicio, horario_fim]
    );

    if ((conflitos as any[]).length > 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Conflito de agenda. Já existe outro agendamento neste horário (ou no período de respiro).'
      });
    }

    // 6. Critério CA03: Verificar conflito com bloqueios de agenda
    try {
      const [bloqueiosConflito] = await pool.query(
        `SELECT id, motivo, horario_inicio, horario_fim 
         FROM bloqueios 
         WHERE profissional_id = ? AND data = ? 
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissional_id, data, horario_inicio, horario_fim]
      );

      if ((bloqueiosConflito as any[]).length > 0) {
        const blk = (bloqueiosConflito as any[])[0];
        return res.status(400).json({
          sucesso: false,
          erro: `Conflito de agenda: o período coincide com um bloqueio (${blk.motivo || 'Horário Bloqueado'}).`
        });
      }
    } catch {
      // Ignora se tabela/view ainda não estiver disponível
    }

    // 7. Critério CA04: Atualizar atendimento e refletir na agenda
    await pool.query(
      `UPDATE agendamentos 
       SET data = ?, horario_inicio = ?, horario_fim = ?, status = 'Reagendado' 
       WHERE id = ?`,
      [data, horario_inicio, horario_fim, id]
    );

    // Auditoria opcional no histórico
    try {
      await pool.query(
        `INSERT INTO historico_status_agendamento (id_agendamento, status_anterior, status_novo, motivo, alterado_por)
         VALUES (?, ?, 'Reagendado', ?, 'Recepção')`,
        [id, agendamento.status, motivo || `Reagendado para ${data} às ${horario_inicio}`]
      );
    } catch {
      // Ignora se tabela não existir
    }

    console.log(`[MySQL] Agendamento ID ${id} reagendado para ${data} (${horario_inicio} - ${horario_fim})`);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Atendimento reagendado com sucesso!',
      dados: {
        id: parseInt(id, 10),
        data,
        horario_inicio,
        horario_fim,
        status: 'Reagendado'
      }
    });

  } catch (error: any) {
    console.error('Erro ao reagendar atendimento:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao processar o reagendamento.'
    });
  }
});

// ============================================================================
// ENDPOINT: POST /api/bloqueios (Criar bloqueio de horário na agenda - IK-87)
// ============================================================================
router.post('/bloqueios', async (req: Request, res: Response): Promise<any> => {
  try {
    const { profissional_id, data, horario_inicio, horario_fim, motivo } = req.body;

    if (!profissional_id || !data || !horario_inicio || !horario_fim) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Dados incompletos. Informe profissional_id, data, horario_inicio e horario_fim.'
      });
    }

    if (!validarFormatoData(data)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de data inválido. Use YYYY-MM-DD.' });
    }

    if (!validarFormatoHorario(horario_inicio) || !validarFormatoHorario(horario_fim)) {
      return res.status(400).json({ sucesso: false, erro: 'Formato de horário inválido. Use HH:MM.' });
    }

    const iniMins = parseTimeToMins(horario_inicio);
    const fimMins = parseTimeToMins(horario_fim);

    if (iniMins >= fimMins) {
      return res.status(400).json({
        sucesso: false,
        erro: 'O horário de término deve ser posterior ao horário de início.'
      });
    }

    // 1. Validar dias de atendimento (Segunda a Sexta)
    const dataObj = new Date(data + 'T00:00:00');
    if (!validarRegraAgendamento(dataObj)) {
      const diasSemanaNomes = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
      const diaSemanaNome = diasSemanaNomes[dataObj.getDay()];
      return res.status(400).json({
        sucesso: false,
        erro: `Bloqueio desnecessário: a clínica já permanece fechada aos finais de semana (${diaSemanaNome}).`
      });
    }

    // 2. Validar expediente (08:00 às 18:00)
    const checagemInicio = validarHorarioExpediente(horario_inicio);
    if (!checagemInicio.valido) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Horário de início fora do expediente (08:00 às 18:00).'
      });
    }

    if (fimMins > 18 * 60) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Horário de término ultrapassa o expediente da clínica (18:00).'
      });
    }

    // 3. Validar se o profissional existe
    const [profissionais] = await pool.query('SELECT id FROM profissionais WHERE id = ?', [profissional_id]);
    if ((profissionais as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Profissional não cadastrado.' });
    }

    // 4. Critério CA04 (IK-87): O sistema não deverá criar bloqueio conflitante sem informar o administrador
    const [conflitosAgendamento] = await pool.query(
      `SELECT a.id, TIME_FORMAT(a.horario_inicio, '%H:%i') as horario_inicio, TIME_FORMAT(a.horario_fim, '%H:%i') as horario_fim, p.nome_completo as paciente_nome 
       FROM agendamentos a 
       JOIN pacientes p ON a.paciente_id = p.id
       WHERE a.profissional_id = ? AND a.data = ? AND a.status != 'Cancelado' 
         AND ? < a.horario_fim AND a.horario_inicio < ?`,
      [profissional_id, data, horario_inicio, horario_fim]
    );

    if ((conflitosAgendamento as any[]).length > 0) {
      const ag = (conflitosAgendamento as any[])[0];
      return res.status(400).json({
        sucesso: false,
        erro: `Conflito detectado: já existe o agendamento #${ag.id} (${ag.paciente_nome}, das ${ag.horario_inicio} às ${ag.horario_fim}) neste período. Reagende ou cancele o atendimento antes de bloquear o horário.`
      });
    }

    // 5. Validar se já existe outro bloqueio no mesmo período
    try {
      const [conflitosBloqueio] = await pool.query(
        `SELECT id, horario_inicio, horario_fim, motivo 
         FROM bloqueios 
         WHERE profissional_id = ? AND data = ? 
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissional_id, data, horario_inicio, horario_fim]
      );

      if ((conflitosBloqueio as any[]).length > 0) {
        return res.status(400).json({
          sucesso: false,
          erro: 'Já existe um bloqueio cadastrado para este profissional neste período.'
        });
      }
    } catch {
      // Tabela pode estar sendo inicializada
    }

    const motivoSanitizado = motivo ? sanitizarTexto(motivo) : 'Horário Bloqueado';

    const [result] = await pool.query(
      `INSERT INTO bloqueio_agenda (id_profissional, data, horario_inicio, horario_fim, motivo)
       VALUES (?, ?, ?, ?, ?)`,
      [profissional_id, data, horario_inicio, horario_fim, motivoSanitizado]
    );

    const novoBloqueioId = (result as any).insertId;
    console.log(`[MySQL] Bloqueio ID ${novoBloqueioId} criado para prof #${profissional_id} em ${data} (${horario_inicio} às ${horario_fim})`);

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Horário bloqueado com sucesso na agenda!',
      dados: {
        id: novoBloqueioId,
        profissional_id: Number(profissional_id),
        data,
        horario_inicio,
        horario_fim,
        motivo: motivoSanitizado
      }
    });

  } catch (error: any) {
    console.error('Erro ao registrar bloqueio na agenda:', error);
    return res.status(500).json({
      sucesso: false,
      erro: 'Erro interno no servidor ao registrar bloqueio de horário.'
    });
  }
});

// ============================================================================
// ENDPOINT: GET /api/bloqueios (Consultar bloqueios da agenda - IK-87)
// ============================================================================
router.get('/bloqueios', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, profissional_id } = req.query;

    let sql = `
      SELECT 
        b.id,
        b.profissional_id,
        pr.nome as profissional_nome,
        DATE_FORMAT(b.data, '%Y-%m-%d') as data,
        TIME_FORMAT(b.horario_inicio, '%H:%i') as horario_inicio,
        TIME_FORMAT(b.horario_fim, '%H:%i') as horario_fim,
        b.motivo,
        b.criado_em
      FROM bloqueios b
      JOIN profissionais pr ON b.profissional_id = pr.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (data) {
      sql += ' AND b.data = ?';
      params.push(data);
    }
    if (profissional_id) {
      sql += ' AND b.profissional_id = ?';
      params.push(profissional_id);
    }

    sql += ' ORDER BY b.data, b.horario_inicio';

    const [rows] = await pool.query(sql, params);
    return res.status(200).json({ sucesso: true, dados: rows });

  } catch (error: any) {
    console.error('Erro ao buscar bloqueios:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao consultar bloqueios.' });
  }
});

// ============================================================================
// ENDPOINT: DELETE /api/bloqueios/:id (Remover bloqueio da agenda - IK-87)
// ============================================================================
router.delete('/bloqueios/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    if (!validarIdNumerico(id)) {
      return res.status(400).json({ sucesso: false, erro: 'ID do bloqueio inválido.' });
    }

    const [existing] = await pool.query('SELECT id FROM bloqueio_agenda WHERE id_bloqueio = ?', [id]);
    if ((existing as any[]).length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Bloqueio não encontrado.' });
    }

    await pool.query('DELETE FROM bloqueio_agenda WHERE id_bloqueio = ?', [id]);
    console.log(`[MySQL] Bloqueio ID ${id} removido.`);

    return res.status(200).json({
      sucesso: true,
      mensagem: 'Bloqueio removido com sucesso! O horário voltou a ficar disponível para novos atendimentos.'
    });

  } catch (error: any) {
    console.error('Erro ao remover bloqueio:', error);
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao remover bloqueio.' });
  }
});

// ============================================================================
// AUTO-INICIALIZAÇÃO DA TABELA DE BLOQUEIO DE HORÁRIOS (IK-87)
// ============================================================================
async function garantirTabelaBloqueios() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bloqueio_agenda (
        id_bloqueio INT AUTO_INCREMENT PRIMARY KEY,
        id_profissional INT NOT NULL,
        data DATE NOT NULL,
        horario_inicio TIME NOT NULL,
        horario_fim TIME NOT NULL,
        motivo VARCHAR(255) NOT NULL DEFAULT 'Horário Bloqueado',
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bloqueio_data_prof (data, id_profissional)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
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
    `);
  } catch {
    // Ignora se o banco não estiver disponível durante inicialização estática
  }
}
garantirTabelaBloqueios();

// ============================================================================
// AUTO-INICIALIZAÇÃO DA TABELA PROFISSIONAL X PROCEDIMENTO (IK-80)
// ============================================================================
async function garantirTabelaProfissionalProcedimento() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profissional_procedimento (
        id_profissional INT NOT NULL,
        id_procedimento INT NOT NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id_profissional, id_procedimento),
        INDEX idx_pp_procedimento (id_procedimento)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Popular vínculos iniciais caso a tabela esteja vazia
    const [countRows]: any = await pool.query('SELECT COUNT(*) as total FROM profissional_procedimento');
    if (countRows[0]?.total === 0) {
      await pool.query(`
        INSERT IGNORE INTO profissional_procedimento (id_profissional, id_procedimento)
        VALUES 
          (1, 1), (1, 2),
          (2, 1), (2, 2), (2, 4),
          (3, 3),
          (4, 4),
          (5, 5),
          (6, 6)
      `);
      console.log('[MySQL] Tabela profissional_procedimento inicializada com vínculos padrão.');
    }
  } catch (err) {
    // Ignora se o banco não estiver disponível durante inicialização estática
  }
}
garantirTabelaProfissionalProcedimento();

export default router;

