import { useId, type FormEvent } from 'react';
import { useDialogAcessivel } from '../hooks/useDialogAcessivel';

export interface DiaJornada {
  dia_semana: number;
  dia_nome: string;
  ativo: number | boolean;
  horario_inicio: string;
  horario_fim: string;
  intervalo_inicio: string | null;
  intervalo_fim: string | null;
}

interface ModalMinhaJornadaProps {
  jornadaDias: DiaJornada[];
  jornadaErro: string | null;
  estadoJornada: 'carregando' | 'erro' | 'pronto';
  onRecarregar: () => void;
  salvandoJornada: boolean;
  onAlterarDia: <Campo extends keyof DiaJornada>(diaSemana: number, campo: Campo, valor: DiaJornada[Campo]) => void;
  onSalvar: (evento: FormEvent<HTMLFormElement>) => void;
  onFechar: () => void;
}

export default function ModalMinhaJornada({
  jornadaDias, jornadaErro, estadoJornada, salvandoJornada, onAlterarDia, onSalvar, onFechar, onRecarregar,
}: ModalMinhaJornadaProps) {
  const titulo = useId();
  const dialogo = useDialogAcessivel(true, onFechar, salvandoJornada);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div ref={dialogo} role="dialog" aria-modal="true" aria-labelledby={titulo} tabIndex={-1}
        className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-gray/10 overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="bg-primary text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">⏰</span>
            <div>
              <h3 id={titulo} className="text-base font-bold">Minha Jornada de Trabalho</h3>
              <p className="text-xs text-white/80 mt-0.5">
                Configure seus dias de atendimento, expediente e intervalo de almoço
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar Minha Jornada"
            disabled={salvandoJornada}
            onClick={onFechar}
            className="text-white/80 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSalvar} className="p-6 space-y-4 overflow-y-auto">
          {jornadaErro && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {jornadaErro}{estadoJornada === 'erro' && <> <button type="button" className="underline" onClick={onRecarregar}>Tentar novamente</button></>}
            </div>
          )}

          {estadoJornada === 'carregando' && (
            <div role="status" className="py-10 text-center text-xs text-gray">
              Carregando sua jornada de trabalho...
            </div>
          )}
          {estadoJornada === 'pronto' && (
            <div className="space-y-2.5">
              {jornadaDias.map(dia => {
                const ativoBool = Boolean(dia.ativo);
                return (
                  <div
                    key={dia.dia_semana}
                    className={`p-3 rounded-xl border text-xs transition-all ${
                      ativoBool
                        ? 'bg-white border-gray/20'
                        : 'bg-light-gray/60 border-gray/10 opacity-75'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 font-bold text-dark min-w-[140px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ativoBool}
                          onChange={e =>
                            onAlterarDia(dia.dia_semana, 'ativo', e.target.checked ? 1 : 0)
                          }
                          className="rounded border-gray/30 text-primary focus:ring-primary"
                        />
                        <span>{dia.dia_nome}</span>
                      </label>

                      {ativoBool ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-gray font-semibold">Expediente:</span>
                            <input
                              type="time"
                              aria-label={`Início do expediente em ${dia.dia_nome}`}
                              value={dia.horario_inicio || '08:00'}
                              onChange={e =>
                                onAlterarDia(dia.dia_semana, 'horario_inicio', e.target.value)
                              }
                              className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                            />
                            <span className="text-gray">às</span>
                            <input
                              type="time"
                              aria-label={`Fim do expediente em ${dia.dia_nome}`}
                              value={dia.horario_fim || '18:00'}
                              onChange={e =>
                                onAlterarDia(dia.dia_semana, 'horario_fim', e.target.value)
                              }
                              className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                            />
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-gray font-semibold">Intervalo:</span>
                            <input
                              type="time"
                              aria-label={`Início do intervalo em ${dia.dia_nome}`}
                              value={dia.intervalo_inicio || ''}
                              onChange={e =>
                                onAlterarDia(
                                  dia.dia_semana,
                                  'intervalo_inicio',
                                  e.target.value || null
                                )
                              }
                              className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                            />
                            <span className="text-gray">às</span>
                            <input
                              type="time"
                              aria-label={`Fim do intervalo em ${dia.dia_nome}`}
                              value={dia.intervalo_fim || ''}
                              onChange={e =>
                                onAlterarDia(
                                  dia.dia_semana,
                                  'intervalo_fim',
                                  e.target.value || null
                                )
                              }
                              className="border border-gray/20 rounded-lg px-2 py-1 text-xs bg-white"
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray italic">Sem expediente neste dia</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 pt-3 border-t border-gray/10">
            <button
              type="button"
              onClick={onFechar}
              disabled={salvandoJornada}
              className="flex-1 py-2.5 px-4 rounded-xl border border-gray/20 text-xs font-bold text-gray hover:bg-light-gray cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvandoJornada || estadoJornada !== 'pronto'}
              className="flex-1 py-2.5 px-4 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all disabled:opacity-50 cursor-pointer"
            >
              {salvandoJornada ? 'Salvando Jornada...' : 'Salvar Minha Jornada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
