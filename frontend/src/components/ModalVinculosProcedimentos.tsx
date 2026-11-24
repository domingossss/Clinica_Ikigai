import { useId } from 'react';
import { useDialogAcessivel } from '../hooks/useDialogAcessivel';
import { procedimentoAtivo } from '../utils/servicos';
import { obterIniciais } from '../utils/formatacao';

interface ProcedimentoVinculavel {
  id: number;
  nome: string;
  categoria_nome: string;
  duracao_minutos: number;
  preco?: number;
  ativo?: number | boolean;
}

interface ModalVinculosProcedimentosProps {
  nomeProfissional: string;
  procedimentos: ProcedimentoVinculavel[];
  busca: string;
  selecionados: number[];
  salvando: boolean;
  estado: 'carregando' | 'erro' | 'pronto';
  onRecarregar: () => void;
  onBuscar: (busca: string) => void;
  onSelecionarTodos: () => void;
  onLimpar: () => void;
  onAlternarProcedimento: (id: number) => void;
  onSalvar: () => void;
  onFechar: () => void;
}

export default function ModalVinculosProcedimentos({
  nomeProfissional, procedimentos, busca, selecionados, salvando, estado, onRecarregar,
  onBuscar, onSelecionarTodos, onLimpar, onAlternarProcedimento, onSalvar, onFechar,
}: ModalVinculosProcedimentosProps) {
  const tituloDialogo = useId();
  const dialogo = useDialogAcessivel(true, onFechar, salvando);
  const termo = busca.toLowerCase();
  const procedimentosFiltrados = procedimentos.filter(procedimento =>
    procedimento.nome.toLowerCase().includes(termo) || procedimento.categoria_nome?.toLowerCase().includes(termo)
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div ref={dialogo} role="dialog" aria-modal="true" aria-labelledby={tituloDialogo} tabIndex={-1}
        className="bg-white rounded-2xl shadow-premium max-w-xl w-full p-6 border border-gray/10 flex flex-col max-h-[85vh]">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between pb-4 border-b border-gray/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-dark text-secondary flex items-center justify-center font-extrabold text-sm shadow-sm flex-shrink-0">
              {obterIniciais(nomeProfissional)}
            </div>
            <div>
              <h3 id={tituloDialogo} className="text-base font-bold text-dark flex items-center gap-2">
                Vincular Procedimentos
              </h3>
              <p className="text-xs text-gray mt-0.5">
                Defina quais procedimentos <strong className="text-dark">{nomeProfissional}</strong> está habilitado a realizar.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            disabled={salvando}
            className="text-gray hover:text-dark p-1.5 rounded-lg hover:bg-light-gray transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {estado === 'carregando' && <p role="status" className="py-4 text-sm">Carregando vínculos…</p>}
        {estado === 'erro' && <p role="alert" className="py-4 text-sm">Não foi possível carregar os vínculos.{' '}
          <button type="button" className="underline" onClick={onRecarregar}>Tentar novamente</button></p>}
        {estado === 'pronto' && <>
        {/* Barra de Filtro e Ações Rápidas */}
        <div className="py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-b border-gray/10">
          <div className="relative flex-1">
            <input
              type="text"
              aria-label="Buscar procedimento"
              placeholder="Buscar procedimento..."
              value={busca}
              onChange={e => onBuscar(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-primary focus:outline-none"
            />
            <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={onSelecionarTodos}
              className="text-primary hover:underline font-semibold cursor-pointer"
            >
              Selecionar todos
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={onLimpar}
              className="text-gray-500 hover:text-red-500 hover:underline font-semibold cursor-pointer"
            >
              Limpar todos
            </button>
          </div>
        </div>

        {/* Lista de Procedimentos com Checkboxes */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2 max-h-[380px] pr-1">
          {procedimentosFiltrados.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-500">
              Nenhum procedimento encontrado com o termo informado.
            </div>
          ) : procedimentosFiltrados.map(proc => {
            const isChecked = selecionados.includes(proc.id);

            return (
              <label
                key={proc.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                  isChecked
                    ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/20'
                    : 'bg-white hover:bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onAlternarProcedimento(proc.id)}
                    className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary cursor-pointer"
                  />
                  <div>
                    <div className="text-xs font-bold text-dark flex items-center gap-2">
                      <span>{proc.nome}</span>
                      <span className="text-[10px] bg-secondary/20 text-primary-dark font-semibold px-1.5 py-0.2 rounded border border-secondary/30">
                        {proc.categoria_nome}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      Duração: {proc.duracao_minutos} min • R$ {proc.preco ? Number(proc.preco).toFixed(2) : '0.00'}
                    </div>
                  </div>
                </div>

                {!procedimentoAtivo(proc) && <span className="text-[11px] text-gray-600">Inativo</span>}
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                  isChecked ? 'bg-emerald-100 text-emerald-800' : 'text-gray-400'
                }`}>
                  {isChecked ? 'Vinculado' : 'Não vinculado'}
                </span>
              </label>
            );
          })}
        </div>

        </>}
        {/* Rodapé do Modal com contador e botões */}
        <div className="mt-3 pt-3 border-t border-gray/10 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-600 font-medium">
            <strong className="text-dark">{selecionados.length}</strong> de {procedimentos.length} procedimento(s) selecionado(s)
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onFechar}
              disabled={salvando}
              className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSalvar}
              disabled={salvando || estado !== 'pronto'}
              className="px-5 py-2 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : 'Salvar Vínculos'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
