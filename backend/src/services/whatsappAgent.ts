import { validarRegraAgendamento, obterNomeDiaSemana } from '../utils/validation.js';

// Interfaces para tipar as entidades
interface Paciente {
  id: string;
  nome: string;
  whatsapp: string;
  etapa_tratamento: string;
  atendimento_status: 'IA' | 'Humano';
}

interface Agendamento {
  id: number;
  paciente_id: string;
  profissional_id: number;
  tipo: 'Consulta' | 'Retorno' | 'Procedimento';
  data_hora: Date;
  status: 'Agendado' | 'Confirmado' | 'Cancelado';
}

/**
 * SERVIÇO: WhatsAppAgentService
 * Gerencia a conversação e decisões do robô de IA no WhatsApp oficial da Meta.
 */
export class WhatsAppAgentService {
  
  // Conexão simulada do banco de dados (MySQL) para fins demonstrativos
  private db: any; 

  constructor(dbConnection: any) {
    this.db = dbConnection;
  }

  /**
   * Ponto de entrada principal ao receber um webhook de mensagem do WhatsApp.
   * 
   * @param whatsappNumber Número do remetente (Ex: "5511999999999")
   * @param messageText Conteúdo do texto recebido
   * @returns Mensagem de resposta para enviar de volta via API da Meta
   */
  public async processIncomingMessage(whatsappNumber: string, messageText: string): Promise<string> {
    console.log(`[WhatsApp Agent] Mensagem recebida de ***${whatsappNumber.slice(-4)}`);

    // 1. Identificar se o paciente existe no Banco de Dados
    const paciente = await this.identificarPaciente(whatsappNumber);

    if (!paciente) {
      // Caso não exista, fluxo de primeiro contato
      return `Olá! Seja bem-vindo à Clínica Ikigai. 🌸 \n` +
             `Ainda não localizei seu cadastro pelo seu número. ` +
             `Por favor, digite seu *Nome Completo* para que eu possa iniciar seu atendimento, ou aguarde um instante para falar com nossa recepção.`;
    }

    // 2. Verificar se o atendimento já foi transferido para Humano (Transbordo)
    if (paciente.atendimento_status === 'Humano') {
      console.log('[WhatsApp Agent] Atendimento humano ativo.');
      // Retorna nulo ou string vazia indicando que a IA não deve interferir no chat
      return ''; 
    }

    // 3. Analisar se a mensagem requer Transbordo Humano imediato (Gatilhos de Saúde ou Dificuldade)
    if (this.detectarNecessidadeTransbordo(messageText)) {
      await this.atualizarStatusAtendimento(whatsappNumber, 'Humano');
      this.alertarPainelSecretaria(paciente, messageText);
      return `Entendi que você precisa de suporte especializado ou deseja falar com nossa recepção. ` +
             `Estou transferindo você agora mesmo para uma de nossas atendentes humanas. Um momento, por favor! 🙏`;
    }

    // 4. Fluxo de Intenção: Solicitação de Agendamento de Retorno
    if (this.detectarIntencaoAgendamentoRetorno(messageText)) {
      return await this.processarAgendamentoRetorno(paciente);
    }

    // 5. Resposta Geral da IA (Escopo Administrativo Geral)
    return `Olá, ${paciente.nome}! Que bom falar com você. \n` +
           `Identifiquei que você está na etapa: *${paciente.etapa_tratamento}* do seu tratamento. \n\n` +
           `Como posso te ajudar hoje?\n` +
           `👉 Digite *Retorno* se você precisa agendar uma consulta de retorno do seu tratamento.\n` +
           `👉 Digite *Falar com Atendente* se precisar de outro assunto.`;
  }

  /**
   * Helper: Busca o paciente no banco de dados
   */
  private async identificarPaciente(whatsapp: string): Promise<Paciente | null> {
    try {
      const [rows]: any = await this.db.query('SELECT * FROM pacientes WHERE whatsapp = ? LIMIT 1', [whatsapp]);
      return rows && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('[WhatsApp Agent] Erro ao buscar paciente no banco de dados.');
      return null;
    }
  }

  /**
   * Helper: Analisa palavras-chave para detectar transbordo humano
   * (Segurança estrita: impede pareceres médicos e ativa suporte humano se houver dor, exames ou dúvidas fora da agenda)
   */
  private detectarNecessidadeTransbordo(text: string): boolean {
    const cleaned = text.toLowerCase();
    
    // Gatilhos de transbordo por saúde, dor ou exames (A IA não dá pareceres médicos)
    const gatilhosMedicos = [
      'dor', 'dente quebrado', 'sangramento', 'prescrição', 'receita', 'remédio', 'medicamento', 
      'inflamado', 'inchado', 'exame', 'radiografia', 'panorâmica', 'quebrou', 'caiu o braquete'
    ];

    // Gatilhos de atendimento humano direto
    const gatilhosHumanos = [
      'humano', 'falar com pessoa', 'atendente', 'secretaria', 'secretária', 'recepção', 'ajuda', 'não entendi'
    ];

    const contemGatilhoMedico = gatilhosMedicos.some(gatilho => cleaned.includes(gatilho));
    const contemGatilhoHumano = gatilhosHumanos.some(gatilho => cleaned.includes(gatilho));

    return contemGatilhoMedico || contemGatilhoHumano;
  }

  /**
   * Helper: Detecta se o paciente quer agendar um Retorno
   */
  private detectarIntencaoAgendamentoRetorno(text: string): boolean {
    const cleaned = text.toLowerCase();
    return cleaned.includes('retorno') || cleaned.includes('agendar retorno') || cleaned.includes('marcar retorno');
  }

  /**
   * Processamento Inteligente do Agendamento de Retorno
   */
  private async processarAgendamentoRetorno(paciente: Paciente): Promise<string> {
    // Atribuição de profissional padrão (ex: Dr. Ulisses Higo, id: 1)
    const profissionalId = 1; 
    
    // Buscar horários inteligentes disponíveis respeitando a matriz operacional
    const opcoesDisponiveis = await this.buscarHorariosSugeridos(paciente.id, profissionalId);

    if (opcoesDisponiveis.length === 0) {
      // Fallback caso não haja horários próximos livres no banco
      await this.atualizarStatusAtendimento(paciente.whatsapp, 'Humano');
      return `Desculpe, ${paciente.nome}, no momento não encontrei horários livres automaticamente para os próximos dias de Retorno (Terças e Sextas). \n` +
             `Estou acionando nossa recepção para te agendar manualmente agora mesmo!`;
    }

    // Sugere as opções
    let resposta = `Perfeito! Notei que você está na etapa *${paciente.etapa_tratamento}*.\n` +
                   `Para consultas de *Retorno*, nossos dias de atendimento são *Terças e Sextas-feiras*.\n\n` +
                   `Encontrei estas 3 melhores opções de horários livres para você:\n`;

    opcoesDisponiveis.forEach((opcao, index) => {
      resposta += `*${index + 1})* ${opcao}\n`;
    });

    resposta += `\nQual dessas opções fica melhor para você? Responda com o número (*1*, *2* ou *3*).`;
    return resposta;
  }

  /**
   * Algoritmo de Busca de Horários Inteligentes (3 Opções)
   * Valida regras da matriz da clínica e disponibilidade do profissional no MySQL.
   */
  private async buscarHorariosSugeridos(pacienteId: string, profissionalId: number): Promise<string[]> {
    const sugestoes: string[] = [];
    const hoje = new Date();
    
    // Loop para varrer os próximos 14 dias em busca de datas válidas de Retorno
    for (let i = 1; i <= 14 && sugestoes.length < 3; i++) {
      const dataAnalise = new Date(hoje);
      dataAnalise.setDate(hoje.getDate() + i);

      // Valida se o dia da semana permite 'Retorno' com base na matriz operacional (Terças e Sextas)
      const ehDiaValido = validarRegraAgendamento(dataAnalise, 'Retorno');
      
      if (ehDiaValido) {
        // Horários de atendimento sugeridos (ex: 09:00, 14:00, 16:00)
        const horasSimuladas = ['09:00', '14:00', '16:00'];
        
        for (const hora of horasSimuladas) {
          const [h, m] = hora.split(':');
          const dataHoraProposta = new Date(dataAnalise);
          dataHoraProposta.setHours(parseInt(h), parseInt(m), 0, 0);

          // Verifica no banco se o profissional já tem agendamento ativo nesse horário
          const ocupado = await this.verificarHorarioOcupado(profissionalId, dataHoraProposta);
          
          if (!ocupado) {
            const diaFormatado = dataHoraProposta.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const nomeDia = obterNomeDiaSemana(dataHoraProposta.getDay());
            sugestoes.push(`${nomeDia} (${diaFormatado}) às ${hora}`);
            
            if (sugestoes.length === 3) break;
          }
        }
      }
    }

    return sugestoes;
  }

  /**
   * Helper: Consulta banco para verificar se profissional já tem agendamento ativo
   */
  private async verificarHorarioOcupado(profissionalId: number, dataHora: Date): Promise<boolean> {
    try {
      // Formato de data YYYY-MM-DD local (no fuso de Brasília)
      const formatterData = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const partsData = formatterData.formatToParts(dataHora);
      const year = partsData.find(p => p.type === 'year')?.value;
      const month = partsData.find(p => p.type === 'month')?.value;
      const day = partsData.find(p => p.type === 'day')?.value;
      const dateStr = `${year}-${month}-${day}`;

      // Formato de hora HH:MM:SS local
      const formatterHora = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const timeStr = formatterHora.format(dataHora); // HH:MM:SS

      // Assumimos que a IA sugere retornos padrão com 60 minutos de duração
      const partsHora = timeStr.split(':').map(Number);
      const totalStartMins = partsHora[0] * 60 + partsHora[1];
      const totalEndMins = totalStartMins + 60 + 15; // 60 min de consulta + 15 min buffer = 75 min

      const formatMins = (mins: number) => {
        const hrs = Math.floor(mins / 60).toString().padStart(2, '0');
        const mns = (mins % 60).toString().padStart(2, '0');
        return `${hrs}:${mns}:00`;
      };
      const endTimeStr = formatMins(totalEndMins);

      // Conflito ocorre se: inicio_proposto < ag_fim E ag_inicio < fim_proposto
      const result = await this.db.query(
        `SELECT COUNT(*) as count 
         FROM agendamentos 
         WHERE profissional_id = ? AND data = ? AND status != "Cancelado"
           AND ? < horario_fim AND horario_inicio < ?`,
        [profissionalId, dateStr, timeStr, endTimeStr]
      );
      
      const rows = Array.isArray(result) ? result[0] : result;
      const count = Array.isArray(rows) && rows[0] ? (rows[0] as any).count : 0;
      return count > 0;
    } catch (error) {
      throw new Error('Não foi possível verificar a disponibilidade.');
    }
  }

  /**
   * Helper: Atualiza o status do atendimento do paciente no banco (IA vs Humano)
   */
  private async atualizarStatusAtendimento(whatsapp: string, status: 'IA' | 'Humano'): Promise<void> {
    // Exemplo de SQL:
    // UPDATE pacientes SET atendimento_status = ? WHERE whatsapp = ?
    try {
      await this.db.query('UPDATE pacientes SET atendimento_status = ? WHERE whatsapp = ?', [status, whatsapp]);
    } catch {
      throw new Error('Não foi possível atualizar o atendimento.');
    }
  }

  /**
   * Helper de Integração: Envia alerta ao Painel Web (Socket.io ou SSE) indicando transbordo
   */
  private alertarPainelSecretaria(paciente: Paciente, mensagemOriginal: string): void {
    console.warn('[WhatsApp Agent] Transbordo humano solicitado.');
  }
}
