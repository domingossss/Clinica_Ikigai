export type PedidoMensagem = {
  id: number;
  whatsapp: string;
  tipo: 'CONFIRMACAO' | 'LEMBRETE';
  ocorrencia: string;
};

export type ResultadoEnvio = {
  estado: 'SUBMETIDA' | 'ENTREGUE' | 'FALHA' | 'INCERTA';
  referencia?: string;
  erro?: string;
};

export interface ProvedorMensagens {
  nome: string;
  enviar(pedido: PedidoMensagem): Promise<ResultadoEnvio>;
}

export function obterProvedor(): ProvedorMensagens | null {
  if (process.env.COMUNICACAO_PROVEDOR !== 'simulado') return null;
  return {
    nome: 'simulado',
    async enviar(pedido) {
      const referencia = 'simulado-' + pedido.id;
      switch (process.env.COMUNICACAO_SIMULAR_RESULTADO || 'submetida') {
        case 'submetida': return { estado: 'SUBMETIDA', referencia };
        case 'entregue': return { estado: 'ENTREGUE', referencia };
        case 'rejeitada': return { estado: 'FALHA', erro: 'Solicitação recusada pelo provedor simulado.' };
        case 'timeout': return { estado: 'INCERTA', erro: 'O provedor simulado não confirmou a submissão.' };
        default: return { estado: 'FALHA', erro: 'Resultado de simulação inválido.' };
      }
    },
  };
}
