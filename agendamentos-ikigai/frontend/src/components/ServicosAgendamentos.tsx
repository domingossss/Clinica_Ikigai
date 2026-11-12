import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';

interface Categoria {
  id: number;
  nome: string;
}

interface Servico {
  id: number;
  categoria_id: number;
  categoria_nome: string;
  nome: string;
  preco?: number;
  duracao_minutos: number;
  ativo?: number | boolean;
}

export interface ProfissionalItem {
  id: number;
  nome: string;
  especialidade: string;
  ativo?: number | boolean;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface DiaJornada {
  dia_semana: number;
  dia_nome: string;
  ativo: number | boolean;
  horario_inicio: string;
  horario_fim: string;
  intervalo_inicio: string | null;
  intervalo_fim: string | null;
}

export interface ExcecaoItem {
  id: number;
  data: string;
  id_profissional: number | null;
  profissional_nome: string | null;
  tipo_excecao: 'Fechado' | 'Horario_Especial';
  horario_inicio: string | null;
  horario_fim: string | null;
  motivo: string;
}

interface ServicosAgendamentosProps {
  onProfissionaisAtualizados?: () => void;
  onAbrirAgendaProfissional?: (profissionalId: number) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function obterIniciais(nome: string): string {
  if (!nome) return 'PR';
  const limpo = nome.trim();
  const partes = limpo.split(/\s+/).filter(p => !['dr.', 'dra.', 'drª', 'dr', 'dra'].includes(p.toLowerCase()));
  if (partes.length === 0) return limpo.substring(0, 2).toUpperCase();
  if (partes.length === 1) return partes[0].substring(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function ServicosAgendamentos({
  onProfissionaisAtualizados,
  onAbrirAgendaProfissional
}: ServicosAgendamentosProps) {
  // Controle de sub-aba ativa na tela
  const [subAba, setSubAba] = useState<'servicos' | 'profissionais' | 'excecoes'>('servicos');

  // Estados de Serviços e Categorias
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [servicoForm, setServicoForm] = useState({
    nome: '',
    categoria_id: '',
    duracao_minutos: '60'
  });
  const [showNewCatInput, setShowNewCatInput] = useState(false);
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('');
  const [showGerenciarCategorias, setShowGerenciarCategorias] = useState(false);
  const [loadingServicos, setLoadingServicos] = useState(true);
  const [submittingServico, setSubmittingServico] = useState(false);

  // Estados de Profissionais
  const [profissionais, setProfissionais] = useState<ProfissionalItem[]>([]);

  // Estados para Jornada e Intervalos (IK-14)
  const [modalJornadaProf, setModalJornadaProf] = useState<ProfissionalItem | null>(null);
  const [jornadaDias, setJornadaDias] = useState<DiaJornada[]>([]);
  const [carregandoJornada, setCarregandoJornada] = useState(false);
  const [salvandoJornada, setSalvandoJornada] = useState(false);

  // Estados para Exceções de Disponibilidade (IK-83)
  const [excecoes, setExcecoes] = useState<ExcecaoItem[]>([]);
  const [loadingExcecoes, setLoadingExcecoes] = useState(false);
  const [submittingExcecao, setSubmittingExcecao] = useState(false);
  const [excecaoForm, setExcecaoForm] = useState({
    data: '',
    tipo_excecao: 'Fechado' as 'Fechado' | 'Horario_Especial',
    horario_inicio: '08:00',
    horario_fim: '12:00',
    motivo: '',
    id_profissional: ''
  });

  const [loadingProfissionais, setLoadingProfissionais] = useState(false);
  const [submittingProfissional, setSubmittingProfissional] = useState(false);
  const [editingProfissionalId, setEditingProfissionalId] = useState<number | null>(null);
  const [profissionalForm, setProfissionalForm] = useState({
    nome: '',
    especialidade: ''
  });

  // IK-80: Vínculos de Procedimentos por Profissional
  const [vinculosPorProfissional, setVinculosPorProfissional] = useState<Record<number, number[]>>({});
  const [modalVinculosProf, setModalVinculosProf] = useState<ProfissionalItem | null>(null);
  const [modalSelectedProcs, setModalSelectedProcs] = useState<number[]>([]);
  const [modalTermoBusca, setModalTermoBusca] = useState<string>('');
  const [salvandoVinculos, setSalvandoVinculos] = useState<boolean>(false);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  // Carregar dados de Serviços e Categorias
  const carregarDadosServicos = async () => {
    setLoadingServicos(true);
    try {
      const resCat = await fetch(`${API_BASE_URL}/api/categorias`);
      const dataCat = await resCat.json();
      if (dataCat.sucesso) setCategorias(dataCat.dados);

      const resServ = await fetch(`${API_BASE_URL}/api/servicos`);
      const dataServ = await resServ.json();
      if (dataServ.sucesso) setServicos(dataServ.dados);
    } catch (error) {
      console.error(error);
      showToast('Falha na comunicação com o servidor ao carregar serviços.', 'error');
    } finally {
      setLoadingServicos(false);
    }
  };

  // Carregar vínculos de procedimentos para a lista de profissionais (IK-80)
  const carregarVinculosProfissionais = async (profs: ProfissionalItem[]) => {
    if (!profs || profs.length === 0) return;
    const mapa: Record<number, number[]> = {};
    await Promise.all(
      profs.map(async prof => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/profissionais/${prof.id}/procedimentos`);
          const data = await res.json();
          if (data.sucesso && Array.isArray(data.procedimento_ids)) {
            mapa[prof.id] = data.procedimento_ids;
          } else {
            mapa[prof.id] = [];
          }
        } catch {
          mapa[prof.id] = [];
        }
      })
    );
    setVinculosPorProfissional(mapa);
  };

  // Carregar dados de Profissionais
  const carregarProfissionais = async () => {
    setLoadingProfissionais(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais`);
      const data = await res.json();
      if (data.sucesso && Array.isArray(data.dados)) {
        setProfissionais(data.dados);
        carregarVinculosProfissionais(data.dados);
      }
    } catch (error) {
      console.error(error);
      showToast('Falha ao carregar profissionais da clínica.', 'error');
    } finally {
      setLoadingProfissionais(false);
    }
  };

  useEffect(() => {
    carregarDadosServicos();
    carregarProfissionais();
  }, []);

  // ==========================================
  // AÇÕES DE SERVIÇOS & CATEGORIAS
  // ==========================================
  const startEditService = (s: Servico) => {
    setEditingServiceId(s.id);
    setServicoForm({
      nome: s.nome,
      categoria_id: s.categoria_id.toString(),
      duracao_minutos: s.duracao_minutos.toString()
    });
    showToast(`Editando o serviço: ${s.nome}`, 'info');
  };

  const cancelEditService = () => {
    setEditingServiceId(null);
    setServicoForm({
      nome: '',
      categoria_id: '',
      duracao_minutos: '60'
    });
  };

  const handleToggleStatusServico = async (servico: Servico) => {
    const isAtivo = servico.ativo !== 0 && servico.ativo !== false;
    const novoStatus = isAtivo ? 0 : 1;

    if (isAtivo) {
      // CA01 (IK-95): Inativação mediante confirmação
      const result = await Swal.fire({
        title: 'Inativar Procedimento?',
        text: `Deseja inativar o procedimento "${servico.nome}"? Ele não será mais oferecido para novos agendamentos, mas todo o histórico existente continuará preservado.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#262B6B',
        cancelButtonColor: '#6B7280',
        confirmButtonText: 'Sim, inativar!',
        cancelButtonText: 'Cancelar'
      });

      if (!result.isConfirmed) return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/servicos/${servico.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: novoStatus })
      });
      const data = await res.json();
      if (data.sucesso) {
        showToast(
          data.mensagem || (novoStatus === 1 ? 'Procedimento reativado com sucesso!' : 'Procedimento inativado com sucesso!'),
          'success'
        );
        carregarDadosServicos();
      } else {
        showToast(data.erro || 'Erro ao alterar status do procedimento.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao alterar status do procedimento.', 'error');
    }
  };



  const handleCriarCategoria = async () => {
    if (!novaCategoriaNome.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/categorias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novaCategoriaNome })
      });
      const data = await res.json();
      if (data.sucesso) {
        setCategorias(prev => [...prev, data.dados]);
        setServicoForm(prev => ({ ...prev, categoria_id: data.dados.id.toString() }));
        setNovaCategoriaNome('');
        setShowNewCatInput(false);
        showToast('Categoria cadastrada com sucesso!', 'success');
      } else {
        showToast(data.erro || 'Erro ao criar categoria.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao criar categoria.', 'error');
    }
  };

  const handleEditarCategoria = async (catId: number, nomeAtual: string) => {
    const { value: novoNome } = await Swal.fire({
      title: 'Editar Categoria',
      input: 'text',
      inputLabel: 'Novo nome da categoria',
      inputValue: nomeAtual,
      showCancelButton: true,
      confirmButtonText: 'Salvar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#262B6B',
      cancelButtonColor: '#6B7280',
      inputValidator: (value) => {
        if (!value || !value.trim()) {
          return 'O nome da categoria não pode ficar vazio.';
        }
        return null;
      }
    });

    if (novoNome && novoNome.trim() && novoNome.trim() !== nomeAtual) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/categorias/${catId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: novoNome.trim() })
        });
        const data = await res.json();
        if (data.sucesso) {
          showToast('Categoria atualizada com sucesso!', 'success');
          carregarDadosServicos();
        } else {
          showToast(data.erro || 'Falha ao atualizar categoria.', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Erro de rede ao atualizar categoria.', 'error');
      }
    }
  };

  const handleExcluirCategoria = async (catId: number, nome: string) => {
    const servicosVinculados = servicos.filter(s => s.categoria_id === catId);
    const textoAviso = servicosVinculados.length > 0
      ? `Atenção: Existem ${servicosVinculados.length} serviço(s) vinculado(s) a esta categoria. Ao excluí-la, os serviços e agendamentos vinculados também serão excluídos!`
      : 'Tem certeza de que deseja excluir esta categoria? Esta ação não poderá ser desfeita.';

    const result = await Swal.fire({
      title: `Excluir "${nome}"?`,
      text: textoAviso,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/categorias/${catId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.sucesso) {
        showToast('Categoria excluída com sucesso!', 'success');
        if (servicoForm.categoria_id === catId.toString()) {
          setServicoForm(prev => ({ ...prev, categoria_id: '' }));
        }
        carregarDadosServicos();
      } else {
        showToast(data.erro || 'Erro ao excluir categoria.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao excluir categoria.', 'error');
    }
  };

  const handleCriarServico = async (e: React.FormEvent) => {
    e.preventDefault();
    const { nome, categoria_id, duracao_minutos } = servicoForm;

    if (!nome.trim() || !categoria_id || !duracao_minutos) {
      showToast('Preencha todos os campos do serviço.', 'error');
      return;
    }

    setSubmittingServico(true);
    try {
      const isEditing = editingServiceId !== null;
      const url = isEditing 
        ? `${API_BASE_URL}/api/servicos/${editingServiceId}` 
        : `${API_BASE_URL}/api/servicos`;
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoria_id: parseInt(categoria_id),
          nome: nome.trim(),
          duracao_minutos: parseInt(duracao_minutos)
        })
      });
      const data = await res.json();
      if (data.sucesso) {
        showToast(isEditing ? 'Serviço atualizado com sucesso!' : 'Serviço criado com sucesso!', 'success');
        setServicoForm({ nome: '', categoria_id: '', duracao_minutos: '60' });
        setEditingServiceId(null);
        carregarDadosServicos();
      } else {
        showToast(data.erro || 'Erro ao processar serviço.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao processar serviço.', 'error');
    } finally {
      setSubmittingServico(false);
    }
  };

  // ==========================================
  // AÇÕES DE PROFISSIONAIS
  // ==========================================
  const startEditProfissional = (p: ProfissionalItem) => {
    setEditingProfissionalId(p.id);
    setProfissionalForm({
      nome: p.nome,
      especialidade: p.especialidade || ''
    });
    setSubAba('profissionais');
    showToast(`Editando profissional: ${p.nome}`, 'info');
  };

  const cancelEditProfissional = () => {
    setEditingProfissionalId(null);
    setProfissionalForm({
      nome: '',
      especialidade: ''
    });
  };

  const handleSalvarProfissional = async (e: React.FormEvent) => {
    e.preventDefault();
    const { nome, especialidade } = profissionalForm;

    if (!nome.trim()) {
      showToast('Informe o nome do profissional.', 'error');
      return;
    }

    setSubmittingProfissional(true);
    try {
      const isEditing = editingProfissionalId !== null;
      const url = isEditing
        ? `${API_BASE_URL}/api/profissionais/${editingProfissionalId}`
        : `${API_BASE_URL}/api/profissionais`;
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          especialidade: especialidade.trim() || 'Especialista'
        })
      });

      const data = await res.json();
      if (data.sucesso) {
        showToast(
          isEditing ? 'Profissional atualizado com sucesso!' : 'Profissional cadastrado e adicionado à Grade!',
          'success'
        );
        cancelEditProfissional();
        await carregarProfissionais();
        onProfissionaisAtualizados?.();
      } else {
        showToast(data.erro || 'Erro ao processar profissional.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao salvar profissional.', 'error');
    } finally {
      setSubmittingProfissional(false);
    }
  };

  const handleExcluirProfissional = async (p: ProfissionalItem) => {
    const result = await Swal.fire({
      title: `Excluir "${p.nome}"?`,
      text: 'Tem certeza de que deseja remover este profissional da equipe? Ele deixará de aparecer na grade de horários.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais/${p.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (data.sucesso) {
        Swal.fire({
          title: 'Excluído!',
          text: 'Profissional removido com sucesso.',
          icon: 'success',
          timer: 2000,
          showConfirmButton: false
        });
        if (editingProfissionalId === p.id) {
          cancelEditProfissional();
        }
        await carregarProfissionais();
        onProfissionaisAtualizados?.();
      } else {
        Swal.fire('Atenção!', data.erro || 'Não foi possível excluir o profissional.', 'error');
      }
    } catch (err) {
      console.error(err);
      Swal.fire('Erro!', 'Erro de rede ao excluir profissional.', 'error');
    }
  };

  // Alternar status ativo / inativo na grade de horários
  const handleToggleStatusProfissional = async (p: ProfissionalItem) => {
    const isAtivoAtual = p.ativo !== 0 && p.ativo !== false;
    const novoStatus = !isAtivoAtual;
    const valorNumerico = novoStatus ? 1 : 0;

    // Atualização otimista imediata na interface
    setProfissionais(prev =>
      prev.map(item => item.id === p.id ? { ...item, ativo: valorNumerico } : item)
    );

    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais/${p.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: valorNumerico })
      });
      const data = await res.json();

      if (data.sucesso) {
        // Notificação instantânea na tela ("spam" / toast confirmation)
        if (novoStatus) {
          showToast(`✓ ${p.nome} agora está ATIVO na Grade de Horários!`, 'success');
        } else {
          showToast(`✕ ${p.nome} agora está INATIVO e foi retirado da Grade!`, 'info');
        }

        const ToastSwal = Swal.mixin({
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3500,
          timerProgressBar: true,
          didOpen: (toast) => {
            toast.onmouseenter = Swal.stopTimer;
            toast.onmouseleave = Swal.resumeTimer;
          }
        });

        ToastSwal.fire({
          icon: novoStatus ? 'success' : 'info',
          title: novoStatus
            ? `${p.nome}: Ativo na Grade`
            : `${p.nome}: Inativo na Grade`,
          text: novoStatus
            ? 'Coluna de atendimento reativada na agenda.'
            : 'Coluna de atendimento ocultada da agenda.'
        });

        // Sincronizar com a GradeAgenda e DashboardDemo
        onProfissionaisAtualizados?.();
      } else {
        // Reverter em caso de falha da API
        setProfissionais(prev =>
          prev.map(item => item.id === p.id ? { ...item, ativo: isAtivoAtual ? 1 : 0 } : item)
        );
        showToast(data.erro || 'Falha ao alterar status do profissional.', 'error');
      }
    } catch (err) {
      console.error(err);
      setProfissionais(prev =>
        prev.map(item => item.id === p.id ? { ...item, ativo: isAtivoAtual ? 1 : 0 } : item)
      );
      showToast('Erro de comunicação ao alterar status do profissional.', 'error');
    }
  };

  // ==========================================
  // IK-80: AÇÕES DE VINCULAÇÃO DE PROCEDIMENTOS
  // ==========================================
  const abrirModalVincularProcedimentos = async (p: ProfissionalItem) => {
    setModalVinculosProf(p);
    setModalTermoBusca('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais/${p.id}/procedimentos`);
      const data = await res.json();
      if (data.sucesso && Array.isArray(data.procedimento_ids)) {
        setModalSelectedProcs(data.procedimento_ids);
        setVinculosPorProfissional(prev => ({ ...prev, [p.id]: data.procedimento_ids }));
      } else {
        setModalSelectedProcs(vinculosPorProfissional[p.id] || []);
      }
    } catch {
      setModalSelectedProcs(vinculosPorProfissional[p.id] || []);
    }
  };


  // ==========================================
  // IK-14: JORNADA E INTERVALOS
  // ==========================================
  const abrirModalJornada = async (p: ProfissionalItem) => {
    setModalJornadaProf(p);
    setCarregandoJornada(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais/${p.id}/jornada`);
      const data = await res.json();
      if (data.sucesso && Array.isArray(data.dados)) {
        setJornadaDias(data.dados);
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar jornada do profissional.', 'error');
    } finally {
      setCarregandoJornada(false);
    }
  };

  const handleSalvarJornada = async () => {
    if (!modalJornadaProf) return;
    setSalvandoJornada(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais/${modalJornadaProf.id}/jornada`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dias: jornadaDias })
      });
      const data = await res.json();
      if (data.sucesso) {
        showToast('Jornada e intervalos atualizados com sucesso!', 'success');
        setModalJornadaProf(null);
      } else {
        showToast(data.erro || 'Erro ao salvar jornada.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao salvar jornada.', 'error');
    } finally {
      setSalvandoJornada(false);
    }
  };

  // ==========================================
  // IK-83: EXCEÇÕES DE DISPONIBILIDADE
  // ==========================================
  const carregarExcecoes = async () => {
    setLoadingExcecoes(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/excecoes`);
      const data = await res.json();
      if (data.sucesso && Array.isArray(data.dados)) {
        setExcecoes(data.dados);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingExcecoes(false);
    }
  };

  const handleCriarExcecao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excecaoForm.data || !excecaoForm.motivo.trim()) {
      showToast('Preencha a data e o motivo da exceção.', 'error');
      return;
    }
    setSubmittingExcecao(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/excecoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: excecaoForm.data,
          tipo_excecao: excecaoForm.tipo_excecao,
          horario_inicio: excecaoForm.tipo_excecao === 'Horario_Especial' ? excecaoForm.horario_inicio : null,
          horario_fim: excecaoForm.tipo_excecao === 'Horario_Especial' ? excecaoForm.horario_fim : null,
          motivo: excecaoForm.motivo,
          id_profissional: excecaoForm.id_profissional ? Number(excecaoForm.id_profissional) : null
        })
      });
      const data = await res.json();
      if (data.sucesso) {
        showToast('Exceção cadastrada com sucesso!', 'success');
        setExcecaoForm({
          data: '',
          tipo_excecao: 'Fechado',
          horario_inicio: '08:00',
          horario_fim: '12:00',
          motivo: '',
          id_profissional: ''
        });
        carregarExcecoes();
      } else {
        showToast(data.erro || 'Erro ao cadastrar exceção.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao salvar exceção.', 'error');
    } finally {
      setSubmittingExcecao(false);
    }
  };

  const handleExcluirExcecao = async (id: number) => {
    const result = await Swal.fire({
      title: 'Remover Exceção?',
      text: 'A data voltará a seguir a grade de funcionamento padrão.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#262B6B',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'Sim, remover',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/excecoes/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.sucesso) {
        showToast('Exceção removida com sucesso!', 'success');
        carregarExcecoes();
      } else {
        showToast(data.erro || 'Erro ao remover exceção.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao remover exceção.', 'error');
    }
  };

  const fecharModalVinculos = () => {
    setModalVinculosProf(null);
    setModalSelectedProcs([]);
    setModalTermoBusca('');
  };

  const handleToggleProcInModal = (procId: number) => {
    setModalSelectedProcs(prev =>
      prev.includes(procId) ? prev.filter(id => id !== procId) : [...prev, procId]
    );
  };

  const handleSelecionarTodosProcedimentos = () => {
    setModalSelectedProcs(servicos.map(s => s.id));
  };

  const handleLimparTodosProcedimentos = () => {
    setModalSelectedProcs([]);
  };

  const handleSalvarVinculos = async () => {
    if (!modalVinculosProf) return;
    setSalvandoVinculos(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais/${modalVinculosProf.id}/procedimentos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedimentos: modalSelectedProcs })
      });
      const data = await res.json();

      if (data.sucesso) {
        setVinculosPorProfissional(prev => ({
          ...prev,
          [modalVinculosProf.id]: modalSelectedProcs
        }));
        showToast(`Procedimentos vinculados com sucesso para ${modalVinculosProf.nome}!`, 'success');
        fecharModalVinculos();
        onProfissionaisAtualizados?.();
      } else {
        showToast(data.erro || 'Falha ao salvar vínculos.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar vínculos.', 'error');
    } finally {
      setSalvandoVinculos(false);
    }
  };

  const handleDesvincularRapido = async (prof: ProfissionalItem, procId: number) => {
    const servico = servicos.find(s => s.id === procId);
    const nomeProc = servico?.nome || `Procedimento #${procId}`;

    try {
      const res = await fetch(`${API_BASE_URL}/api/profissionais/${prof.id}/procedimentos/${procId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.sucesso) {
        setVinculosPorProfissional(prev => ({
          ...prev,
          [prof.id]: (prev[prof.id] || []).filter(id => id !== procId)
        }));
        showToast(`Vínculo de "${nomeProc}" removido de ${prof.nome}.`, 'info');
        onProfissionaisAtualizados?.();
      } else {
        showToast(data.erro || 'Não foi possível desvincular.', 'error');
      }
    } catch {
      showToast('Erro de conexão ao remover vínculo.', 'error');
    }
  };

  const formatarDuracao = (minutos: number) => {
    if (minutos < 60) return `${minutos}min`;
    const horas = Math.floor(minutos / 60);
    const minsRestantes = minutos % 60;
    if (minsRestantes === 0) return `${horas}h`;
    return `${horas}h ${minsRestantes}min`;
  };

  return (
    <div className="min-h-screen bg-light-gray text-dark font-sans p-2 sm:p-6">
      {/* Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-3 max-w-sm w-full">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`p-4 rounded-2xl shadow-premium border flex items-start gap-3 backdrop-blur-md animate-in slide-in-from-right duration-300 ${
              toast.type === 'success' ? 'bg-primary/10 border-primary/30 text-primary-dark' :
              toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-700' :
              'bg-white/95 border-gray/10 text-dark'
            }`}
          >
            <span className="text-sm font-bold">
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '!'}
              {toast.type === 'info' && 'i'}
            </span>
            <p className="text-xs font-semibold leading-relaxed">{toast.message}</p>
          </div>
        ))}
      </div>

      {/* Sub-Navegação Superior: Serviços e Categorias | Profissionais da Clínica */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="bg-white p-2 rounded-2xl shadow-premium border border-gray/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 p-1 bg-light-gray rounded-xl">
            <button
              type="button"
              onClick={() => setSubAba('servicos')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                subAba === 'servicos'
                  ? 'bg-white text-primary shadow-xs font-extrabold'
                  : 'text-gray hover:text-dark hover:bg-white/50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Serviços e Procedimentos
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                subAba === 'servicos' ? 'bg-primary/10 text-primary' : 'bg-gray/10 text-gray'
              }`}>
                {servicos.length}
              </span>
            </button>

                        <button
              type="button"
              onClick={() => setSubAba('profissionais')}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                subAba === 'profissionais'
                  ? 'bg-white text-primary shadow-xs font-extrabold'
                  : 'text-gray hover:text-dark hover:bg-white/50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Profissionais & Terapeutas
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                subAba === 'profissionais' ? 'bg-primary/10 text-primary' : 'bg-gray/10 text-gray'
              }`}>
                {profissionais.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSubAba('excecoes');
                carregarExcecoes();
              }}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                subAba === 'excecoes'
                  ? 'bg-white text-primary shadow-xs font-extrabold'
                  : 'text-gray hover:text-dark hover:bg-white/50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Exceções & Feriados
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                subAba === 'excecoes' ? 'bg-primary/10 text-primary' : 'bg-gray/10 text-gray'
              }`}>
                {excecoes.length}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 text-xs text-gray font-medium">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Grade de Horários sincronizada em tempo real</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ABA: SERVIÇOS E PROCEDIMENTOS                                             */}
      {/* ========================================================================= */}
      {subAba === 'servicos' && (
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          
          {/* COLUNA ESQUERDA: Cadastro/Edição de Serviços (1/3 de espaço) */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5">
              <h2 className="text-lg font-bold text-dark mb-1 flex items-center gap-2">
                <span className="p-1.5 bg-primary/10 rounded-lg text-primary text-xs font-bold">Serviço</span>
                {editingServiceId !== null ? 'Editar Serviço' : 'Cadastrar Novo Serviço'}
              </h2>
              <p className="text-xs text-gray mb-5">
                {editingServiceId !== null ? 'Atualize as informações do serviço selecionado.' : 'Adicione serviços configurando categoria e tempo dinâmico.'}
              </p>

              <form onSubmit={handleCriarServico} className="flex flex-col gap-4">
                {/* Nome do Serviço */}
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">Nome do Serviço</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Clareamento a Laser"
                    value={servicoForm.nome}
                    onChange={e => setServicoForm(prev => ({ ...prev, nome: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                {/* Categoria */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-dark">Categoria</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowGerenciarCategorias(true)}
                        className="text-[10px] font-bold text-gray hover:text-dark transition-colors uppercase tracking-wider cursor-pointer"
                      >
                        Gerenciar
                      </button>
                      <span className="text-gray/30 text-xs">|</span>
                      <button
                        type="button"
                        onClick={() => setShowNewCatInput(!showNewCatInput)}
                        className="text-[10px] font-bold text-primary hover:text-primary-dark transition-colors uppercase tracking-wider cursor-pointer"
                      >
                        {showNewCatInput ? 'Cancelar' : '+ Nova Categoria'}
                      </button>
                    </div>
                  </div>

                  {showNewCatInput ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Nome da categoria"
                        value={novaCategoriaNome}
                        onChange={e => setNovaCategoriaNome(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCriarCategoria();
                          }
                        }}
                        className="flex-1 px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                      />
                      <button
                        type="button"
                        onClick={handleCriarCategoria}
                        className="px-3 py-2 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl active:scale-95 transition-all cursor-pointer shadow-xs"
                      >
                        Salvar
                      </button>
                    </div>
                  ) : (
                    <select
                      required
                      value={servicoForm.categoria_id}
                      onChange={e => setServicoForm(prev => ({ ...prev, categoria_id: e.target.value }))}
                      className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50 text-dark"
                    >
                      <option value="">Selecione uma categoria...</option>
                      {categorias.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.nome}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Duração em Minutos */}
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">Duração do Atendimento</label>
                  <select
                    value={servicoForm.duracao_minutos}
                    onChange={e => setServicoForm(prev => ({ ...prev, duracao_minutos: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50 text-dark"
                  >
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                    <option value="45">45 minutos</option>
                    <option value="60">1 hora (60 min)</option>
                    <option value="75">1h 15min (75 min)</option>
                    <option value="90">1h 30min (90 min)</option>
                    <option value="120">2 horas (120 min)</option>
                    <option value="150">2h 30min (150 min)</option>
                    <option value="180">3 horas (180 min)</option>
                  </select>
                </div>

                {/* Botões do Formulário de Serviço */}
                <div className="flex gap-2 mt-2">
                  {editingServiceId !== null && (
                    <button
                      type="button"
                      onClick={cancelEditService}
                      className="flex-1 py-2.5 px-4 bg-gray/10 hover:bg-gray/20 text-gray-700 font-bold text-xs rounded-xl active:scale-95 transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={submittingServico}
                    className={`flex-1 py-2.5 px-4 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md shadow-primary/10 hover:shadow-primary/25 cursor-pointer ${
                      submittingServico ? 'opacity-70 cursor-not-allowed' : ''
                    }`}
                  >
                    {submittingServico 
                      ? (editingServiceId !== null ? 'Salvando...' : 'Cadastrando...') 
                      : (editingServiceId !== null ? 'Salvar Alterações' : 'Criar Serviço')}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* COLUNA DIREITA: Lista de Serviços Ativos (2/3 de espaço) */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5 h-full flex flex-col">
              <h2 className="text-base font-bold text-dark mb-4 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                Serviços e Durações Ativas ({servicos.length})
              </h2>

              {loadingServicos ? (
                <div className="flex flex-col gap-3 animate-pulse">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-14 bg-light-gray rounded-xl" />
                  ))}
                </div>
              ) : servicos.length === 0 ? (
                <p className="text-xs text-gray text-center py-6">Nenhum serviço cadastrado ainda.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto max-h-[600px] pr-1">
                  {servicos.map(s => (
                    <div
                      key={s.id}
                      className={`p-4 rounded-xl border flex items-center justify-between transition-all group ${
                        s.ativo !== 0 && s.ativo !== false
                          ? 'bg-light-gray hover:bg-light-gray/80 border-gray/10'
                          : 'bg-gray/5 border-gray/20 opacity-75'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className={`text-xs font-bold ${s.ativo !== 0 && s.ativo !== false ? 'text-dark' : 'text-gray line-through'}`}>
                            {s.nome}
                          </h4>
                          {s.ativo === 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300">
                              Inativo
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray mt-0.5">{s.categoria_nome}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-block text-[9px] font-bold text-dark bg-secondary/20 px-1.5 py-0.5 rounded">
                          {formatarDuracao(s.duracao_minutos)}
                        </span>

                        {/* Status Toggle Button (IK-95) */}
                        <button
                          type="button"
                          onClick={() => handleToggleStatusServico(s)}
                          title={s.ativo !== 0 && s.ativo !== false ? 'Clique para inativar procedimento' : 'Clique para reativar procedimento'}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                            s.ativo !== 0 && s.ativo !== false
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100'
                              : 'bg-gray/10 text-gray hover:text-dark hover:bg-gray/20 border border-gray/20'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              s.ativo !== 0 && s.ativo !== false ? 'bg-emerald-500' : 'bg-gray/40'
                            }`}
                          />
                          <span>{s.ativo !== 0 && s.ativo !== false ? 'Ativo' : 'Inativo'}</span>
                        </button>

                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditService(s)}
                            title="Editar"
                            className="px-2 py-0.5 hover:bg-primary/10 rounded text-primary text-[11px] font-bold transition-colors cursor-pointer"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleToggleStatusServico(s)}
                            title={s.ativo !== 0 && s.ativo !== false ? 'Inativar procedimento' : 'Reativar procedimento'}
                            className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors cursor-pointer ${
                              s.ativo !== 0 && s.ativo !== false
                                ? 'hover:bg-amber-500/10 text-amber-600'
                                : 'hover:bg-emerald-500/10 text-emerald-600'
                            }`}
                          >
                            {s.ativo !== 0 && s.ativo !== false ? 'Inativar' : 'Reativar'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA: PROFISSIONAIS & TERAPEUTAS                                           */}
      {/* ========================================================================= */}
      {subAba === 'profissionais' && (
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          
          {/* COLUNA ESQUERDA: Formulário de Cadastro/Edição de Profissional (1/3) */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5">
              <h2 className="text-lg font-bold text-dark mb-1 flex items-center gap-2">
                <span className="p-1.5 bg-secondary/20 rounded-lg text-primary-dark text-xs font-bold">Equipe</span>
                {editingProfissionalId !== null ? 'Editar Profissional' : 'Cadastrar Profissional'}
              </h2>
              <p className="text-xs text-gray mb-5">
                {editingProfissionalId !== null 
                  ? 'Atualize o nome e especialidade do profissional selecionado.' 
                  : 'Cadastre profissionais para que apareçam automaticamente na grade de horários da clínica.'}
              </p>

              <form onSubmit={handleSalvarProfissional} className="flex flex-col gap-4">
                {/* Nome do Profissional */}
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Nome Completo do Profissional <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Dr. Roberto Alencar"
                    value={profissionalForm.nome}
                    onChange={e => setProfissionalForm(prev => ({ ...prev, nome: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                {/* Especialidade / Área de Atuação */}
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Especialidade / Área de Atuação
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Terapeuta Ortomolecular"
                    value={profissionalForm.especialidade}
                    onChange={e => setProfissionalForm(prev => ({ ...prev, especialidade: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                {/* Card Informativo de Integração com a Grade */}
                <div className="p-3 bg-secondary/10 border border-secondary/25 rounded-xl flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-secondary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-[11px] text-dark/80 leading-relaxed">
                    <strong>Integração Automática:</strong> Ao cadastrar um novo profissional, uma nova coluna é criada imediatamente na <strong>Grade de Horários</strong> e liberada para novos agendamentos.
                  </p>
                </div>

                {/* Botões de Ação */}
                <div className="flex gap-2 mt-2">
                  {editingProfissionalId !== null && (
                    <button
                      type="button"
                      onClick={cancelEditProfissional}
                      className="flex-1 py-2.5 px-4 bg-gray/10 hover:bg-gray/20 text-gray-700 font-bold text-xs rounded-xl active:scale-95 transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={submittingProfissional}
                    className={`flex-1 py-2.5 px-4 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md shadow-primary/10 hover:shadow-primary/25 cursor-pointer flex items-center justify-center gap-1.5 ${
                      submittingProfissional ? 'opacity-70 cursor-not-allowed' : ''
                    }`}
                  >
                    {submittingProfissional ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                        </svg>
                        <span>Salvando...</span>
                      </>
                    ) : (
                      editingProfissionalId !== null ? 'Salvar Alterações' : 'Cadastrar Profissional'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* COLUNA DIREITA: Lista de Profissionais Ativos na Clínica (2/3) */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5 h-full flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-gray/10">
                <div>
                  <h2 className="text-base font-bold text-dark flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-secondary" />
                    Profissionais e Terapeutas na Grade ({profissionais.length})
                  </h2>
                  <p className="text-xs text-gray mt-0.5">
                    Profissionais ativos recebem colunas de agendamento na grade do dia.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={carregarProfissionais}
                  title="Atualizar lista"
                  className="self-start sm:self-auto p-1.5 rounded-lg text-gray hover:text-dark hover:bg-light-gray transition-colors text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Atualizar</span>
                </button>
              </div>

              {loadingProfissionais ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-24 bg-light-gray rounded-xl" />
                  ))}
                </div>
              ) : profissionais.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-gray">
                  <div className="w-14 h-14 rounded-full bg-secondary/15 text-primary flex items-center justify-center mb-3">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-bold text-dark mb-1">Nenhum profissional cadastrado</h3>
                  <p className="text-xs text-gray max-w-sm">
                    Utilize o formulário ao lado para cadastrar os médicos, terapeutas e especialistas da Clínica Ikigai.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto max-h-[600px] pr-1">
                  {profissionais.map(prof => (
                    <div
                      key={prof.id}
                      className={`p-4 rounded-xl border transition-all group flex flex-col justify-between ${
                        editingProfissionalId === prof.id
                          ? 'bg-primary/5 border-primary/40 ring-2 ring-primary/20'
                          : (prof.ativo === 0 || prof.ativo === false)
                          ? 'bg-gray-50/70 border-gray/20 opacity-80 hover:opacity-100 hover:bg-white'
                          : 'bg-light-gray hover:bg-white hover:shadow-md border-gray/10'
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        {/* Avatar com monograma */}
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-sm shadow-sm flex-shrink-0 transition-colors ${
                          prof.ativo === 0 || prof.ativo === false
                            ? 'bg-gray-300 text-gray-600'
                            : 'bg-gradient-to-br from-primary to-primary-dark text-secondary'
                        }`}>
                          {obterIniciais(prof.nome)}
                        </div>

                        {/* Dados do profissional */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-dark truncate">
                              {prof.nome}
                            </h4>
                            {editingProfissionalId === prof.id && (
                              <span className="text-[10px] bg-primary text-white font-bold px-1.5 py-0.5 rounded">
                                Editando
                              </span>
                            )}
                            {(prof.ativo === 0 || prof.ativo === false) && (
                              <span className="text-[10px] bg-gray-200 text-gray-600 font-semibold px-1.5 py-0.5 rounded">
                                Fora da Grade
                              </span>
                            )}
                          </div>
                          <span className="inline-block mt-1 text-[11px] font-semibold text-primary-dark bg-secondary/20 px-2 py-0.5 rounded-md border border-secondary/30 truncate max-w-full">
                            {prof.especialidade || 'Especialista'}
                          </span>
                        </div>
                      </div>

                      {/* Procedimentos Vinculados (IK-80) */}
                      {(() => {
                        const procIds = vinculosPorProfissional[prof.id] || [];
                        const procsVinculados = servicos.filter(s => procIds.includes(s.id));

                        return (
                          <div className="mt-3 pt-2.5 border-t border-gray/10">
                            <div className="flex items-center justify-between gap-1 mb-1.5">
                              <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                Procedimentos ({procsVinculados.length})
                              </span>
                              <button
                                type="button"
                                onClick={() => abrirModalVincularProcedimentos(prof)}
                                className="text-[11px] font-bold text-primary hover:text-primary-dark hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                + Vincular
                              </button>
                            </div>

                            {procsVinculados.length === 0 ? (
                              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/60 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1">
                                <span>⚠️ Nenhum procedimento</span>
                                <button
                                  type="button"
                                  onClick={() => abrirModalVincularProcedimentos(prof)}
                                  className="text-primary font-bold hover:underline"
                                >
                                  Vincular agora
                                </button>
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-0.5">
                                {procsVinculados.map(p => (
                                  <span
                                    key={p.id}
                                    className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-md px-2 py-0.5 text-[11px] text-dark font-medium shadow-2xs group/tag"
                                    title={`${p.nome} (${p.duracao_minutos} min - R$ ${p.preco ? Number(p.preco).toFixed(2) : '0.00'})`}
                                  >
                                    <span className="truncate max-w-[130px]">{p.nome}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDesvincularRapido(prof, p.id);
                                      }}
                                      className="text-gray-400 hover:text-red-500 rounded-full cursor-pointer transition-colors"
                                      title="Remover este vínculo (CA02)"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Footer do Card com status (botão interativo) e botões de ação */}
                      <div className="mt-3 pt-3 border-t border-gray/10 flex items-center justify-between gap-2 flex-wrap">
                        {/* Botão de Status Interativo: Ativo / Inativo na Grade */}
                        <button
                          type="button"
                          onClick={() => handleToggleStatusProfissional(prof)}
                          title={
                            prof.ativo !== 0 && prof.ativo !== false
                              ? 'Clique para inativar e remover da Grade de Horários'
                              : 'Clique para ativar e exibir na Grade de Horários'
                          }
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs active:scale-95 ${
                            prof.ativo !== 0 && prof.ativo !== false
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400'
                              : 'bg-gray/10 text-gray hover:text-dark hover:bg-gray/20 border border-gray/20'
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${
                              prof.ativo !== 0 && prof.ativo !== false
                                ? 'bg-emerald-500 animate-pulse'
                                : 'bg-gray/40'
                            }`}
                          />
                          <span>
                            {prof.ativo !== 0 && prof.ativo !== false
                              ? 'Ativo na Grade'
                              : 'Inativo na Grade'}
                          </span>
                        </button>

                        <div className="flex items-center gap-1">
                          {onAbrirAgendaProfissional && (
                            <button
                              type="button"
                              onClick={() => onAbrirAgendaProfissional(prof.id)}
                              title={`Abrir agenda de ${prof.nome} (IK-81)`}
                              className="px-2.5 py-1 text-xs font-bold text-primary-dark bg-secondary/30 hover:bg-secondary/50 border border-secondary/40 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              <span>Ver Agenda</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => abrirModalJornada(prof)}
                            title="Configurar expediente e intervalos (IK-14)"
                            className="px-2 py-1 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Horários
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditProfissional(prof)}
                            title="Editar profissional"
                            className="px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/10 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExcluirProfissional(prof)}
                            title="Excluir profissional"
                            className="px-2.5 py-1 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Excluir
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Gerenciador Completo de Categorias */}
      {showGerenciarCategorias && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-premium max-w-lg w-full p-6 border border-gray/10 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-4 border-b border-gray/10">
              <div>
                <h3 className="text-base font-bold text-dark flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  Gerenciar Categorias
                </h3>
                <p className="text-xs text-gray mt-0.5">Edite, exclua ou adicione categorias de serviços</p>
              </div>
              <button
                onClick={() => setShowGerenciarCategorias(false)}
                className="text-gray hover:text-dark p-1.5 rounded-lg hover:bg-light-gray transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Criar nova categoria dentro do modal */}
            <div className="pt-4 pb-2">
              <label className="block text-xs font-bold text-dark mb-1.5">Criar Nova Categoria</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nome da nova categoria..."
                  value={novaCategoriaNome}
                  onChange={e => setNovaCategoriaNome(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCriarCategoria();
                    }
                  }}
                  className="flex-1 px-3.5 py-2 border border-gray/15 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/40"
                />
                <button
                  type="button"
                  onClick={handleCriarCategoria}
                  className="px-4 py-2 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl active:scale-95 transition-all cursor-pointer shadow-xs"
                >
                  Adicionar
                </button>
              </div>
            </div>

            {/* Lista de Categorias com ações de Editar e Excluir */}
            <div className="flex-1 overflow-y-auto mt-3 pr-1 divide-y divide-gray/10 border border-gray/10 rounded-xl bg-light-gray/20">
              {categorias.length === 0 ? (
                <p className="text-xs text-gray text-center py-6">Nenhuma categoria cadastrada.</p>
              ) : (
                categorias.map(cat => {
                  const qtdServicos = servicos.filter(s => s.categoria_id === cat.id).length;
                  return (
                    <div
                      key={cat.id}
                      className="p-3.5 flex items-center justify-between hover:bg-white transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs font-bold text-dark">{cat.nome}</span>
                        <span className="text-[10px] font-semibold text-gray bg-gray/10 px-2 py-0.5 rounded-full">
                          {qtdServicos} {qtdServicos === 1 ? 'serviço' : 'serviços'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleEditarCategoria(cat.id, cat.nome)}
                          title="Editar Categoria"
                          className="px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/10 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExcluirCategoria(cat.id, cat.nome)}
                          title="Excluir Categoria"
                          className="px-2.5 py-1 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Excluir
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-gray/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGerenciarCategorias(false)}
                className="px-4 py-2 bg-light-gray hover:bg-gray/15 text-dark font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IK-80: Modal de Vinculação de Procedimentos ao Profissional (CA01 & CA02) */}
      {modalVinculosProf && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-premium max-w-xl w-full p-6 border border-gray/10 flex flex-col max-h-[85vh]">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between pb-4 border-b border-gray/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-dark text-secondary flex items-center justify-center font-extrabold text-sm shadow-sm flex-shrink-0">
                  {obterIniciais(modalVinculosProf.nome)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-dark flex items-center gap-2">
                    Vincular Procedimentos
                  </h3>
                  <p className="text-xs text-gray mt-0.5">
                    Defina quais procedimentos <strong className="text-dark">{modalVinculosProf.nome}</strong> está habilitado a realizar.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={fecharModalVinculos}
                className="text-gray hover:text-dark p-1.5 rounded-lg hover:bg-light-gray transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Barra de Filtro e Ações Rápidas */}
            <div className="py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-b border-gray/10">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Buscar procedimento..."
                  value={modalTermoBusca}
                  onChange={e => setModalTermoBusca(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-primary focus:outline-none"
                />
                <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleSelecionarTodosProcedimentos}
                  className="text-primary hover:underline font-semibold cursor-pointer"
                >
                  Selecionar todos
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={handleLimparTodosProcedimentos}
                  className="text-gray-500 hover:text-red-500 hover:underline font-semibold cursor-pointer"
                >
                  Limpar todos
                </button>
              </div>
            </div>

            {/* Lista de Procedimentos com Checkboxes */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2 max-h-[380px] pr-1">
              {(() => {
                const procedimentosFiltrados = servicos.filter(s =>
                  s.nome.toLowerCase().includes(modalTermoBusca.toLowerCase()) ||
                  (s.categoria_nome && s.categoria_nome.toLowerCase().includes(modalTermoBusca.toLowerCase()))
                );

                if (procedimentosFiltrados.length === 0) {
                  return (
                    <div className="text-center py-8 text-xs text-gray-500">
                      Nenhum procedimento encontrado com o termo informado.
                    </div>
                  );
                }

                return procedimentosFiltrados.map(proc => {
                  const isChecked = modalSelectedProcs.includes(proc.id);

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
                          onChange={() => handleToggleProcInModal(proc.id)}
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

                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                        isChecked ? 'bg-emerald-100 text-emerald-800' : 'text-gray-400'
                      }`}>
                        {isChecked ? 'Vinculado' : 'Não vinculado'}
                      </span>
                    </label>
                  );
                });
              })()}
            </div>

            {/* Rodapé do Modal com contador e botões */}
            <div className="mt-3 pt-3 border-t border-gray/10 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-600 font-medium">
                <strong className="text-dark">{modalSelectedProcs.length}</strong> de {servicos.length} procedimento(s) selecionado(s)
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fecharModalVinculos}
                  disabled={salvandoVinculos}
                  className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSalvarVinculos}
                  disabled={salvandoVinculos}
                  className="px-5 py-2 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {salvandoVinculos ? 'Salvando...' : 'Salvar Vínculos'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    
      {/* ========================================================================= */}
      {/* ABA: EXCEÇÕES DE DISPONIBILIDADE E FERIADOS (IK-83)                       */}
      {/* ========================================================================= */}
      {subAba === 'excecoes' && (
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-200">
          {/* Formulário de Criação de Exceção (1/3) */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5">
              <h2 className="text-lg font-bold text-dark mb-1 flex items-center gap-2">
                <span className="p-1.5 bg-secondary/20 rounded-lg text-primary-dark text-xs font-bold">IK-83</span>
                Nova Exceção
              </h2>
              <p className="text-xs text-gray mb-5">
                Configure feriados, recessos ou datas pontuais com horário especial que prevalecem sobre a grade normal.
              </p>

              <form onSubmit={handleCriarExcecao} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Data da Exceção <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={excecaoForm.data}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, data: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Tipo de Exceção
                  </label>
                  <select
                    value={excecaoForm.tipo_excecao}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, tipo_excecao: e.target.value as any }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  >
                    <option value="Fechado">Fechado (Sem Atendimento)</option>
                    <option value="Horario_Especial">Horário Especial / Reduzido</option>
                  </select>
                </div>

                {excecaoForm.tipo_excecao === 'Horario_Especial' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-dark mb-1">Início</label>
                      <input
                        type="time"
                        value={excecaoForm.horario_inicio}
                        onChange={e => setExcecaoForm(prev => ({ ...prev, horario_inicio: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray/15 rounded-xl text-xs bg-light-gray/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-dark mb-1">Término</label>
                      <input
                        type="time"
                        value={excecaoForm.horario_fim}
                        onChange={e => setExcecaoForm(prev => ({ ...prev, horario_fim: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray/15 rounded-xl text-xs bg-light-gray/50"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Profissional Específico (Opcional)
                  </label>
                  <select
                    value={excecaoForm.id_profissional}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, id_profissional: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  >
                    <option value="">Toda a Clínica (Geral)</option>
                    {profissionais.map(p => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-dark mb-1">
                    Motivo / Descrição <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Feriado de Carnaval, Recesso de Fim de Ano..."
                    value={excecaoForm.motivo}
                    onChange={e => setExcecaoForm(prev => ({ ...prev, motivo: e.target.value }))}
                    className="w-full px-3.5 py-2 border border-gray/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingExcecao}
                  className="w-full py-2.5 px-4 bg-primary hover:bg-primary-dark text-white font-bold text-xs rounded-xl active:scale-95 transition-all shadow-md shadow-primary/10 cursor-pointer"
                >
                  {submittingExcecao ? 'Salvando...' : 'Cadastrar Exceção'}
                </button>
              </form>
            </div>
          </div>

          {/* Lista de Exceções Cadastradas (2/3) */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5 flex flex-col h-full">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-dark">Exceções e Feriados Cadastrados</h3>
                <span className="text-xs bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">
                  {excecoes.length} cadastradas
                </span>
              </div>

              {loadingExcecoes ? (
                <div className="flex justify-center items-center py-12 text-gray">Carregando exceções...</div>
              ) : excecoes.length === 0 ? (
                <div className="text-center py-12 text-gray border border-dashed border-gray/20 rounded-2xl">
                  <p className="text-xs font-medium">Nenhuma exceção ou feriado cadastrado.</p>
                  <p className="text-[11px] text-gray/70 mt-1">A clínica segue a grade padrão de funcionamento.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray/10 overflow-y-auto max-h-[500px]">
                  {excecoes.map(exc => (
                    <div key={exc.id} className="py-3 flex items-center justify-between gap-3 hover:bg-light-gray/40 px-2 rounded-xl transition-colors">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-dark">{exc.data.split('-').reverse().join('/')}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            exc.tipo_excecao === 'Fechado'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {exc.tipo_excecao === 'Fechado' ? 'Fechado' : `Especial: ${exc.horario_inicio} às ${exc.horario_fim}`}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-gray-700 mt-0.5">{exc.motivo}</p>
                        <p className="text-[10px] text-gray">
                          {exc.profissional_nome ? `Aplica-se a: ${exc.profissional_nome}` : 'Aplica-se a toda a clínica'}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleExcluirExcecao(exc.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer text-xs font-bold flex items-center gap-1"
                        title="Remover exceção"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIGURAR JORNADA E INTERVALOS DO PROFISSIONAL (IK-14)            */}
      {/* ========================================================================= */}
      {modalJornadaProf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray/10 max-w-2xl w-full p-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray/10 pb-4 mb-4">
              <div>
                <h3 className="text-base font-bold text-dark flex items-center gap-2">
                  <span className="p-1 bg-primary/10 rounded-lg text-primary text-xs font-bold">IK-14</span>
                  Expediente e Intervalos: {modalJornadaProf.nome}
                </h3>
                <p className="text-xs text-gray mt-0.5">
                  Configure os horários de início, término e intervalo de almoço por dia da semana.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalJornadaProf(null)}
                className="text-gray hover:text-dark p-1 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {carregandoJornada ? (
              <div className="py-12 text-center text-xs text-gray">Carregando jornada do profissional...</div>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y divide-gray/10 pr-1 space-y-3">
                {jornadaDias.map((d, idx) => (
                  <div key={d.dia_semana} className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="w-36 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`dia-${d.dia_semana}`}
                        checked={d.ativo === 1 || d.ativo === true}
                        onChange={e => {
                          const novoAtivo = e.target.checked ? 1 : 0;
                          setJornadaDias(prev => prev.map((item, i) => i === idx ? { ...item, ativo: novoAtivo } : item));
                        }}
                        className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                      />
                      <label htmlFor={`dia-${d.dia_semana}`} className={`text-xs font-bold cursor-pointer ${
                        d.ativo === 1 || d.ativo === true ? 'text-dark' : 'text-gray line-through'
                      }`}>
                        {d.dia_nome}
                      </label>
                    </div>

                    {(d.ativo === 1 || d.ativo === true) ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-gray">Jornada:</span>
                          <input
                            type="time"
                            value={d.horario_inicio || '08:00'}
                            onChange={e => {
                              const v = e.target.value;
                              setJornadaDias(prev => prev.map((item, i) => i === idx ? { ...item, horario_inicio: v } : item));
                            }}
                            className="px-2 py-1 border border-gray/20 rounded-lg text-xs"
                          />
                          <span className="text-gray">às</span>
                          <input
                            type="time"
                            value={d.horario_fim || '18:00'}
                            onChange={e => {
                              const v = e.target.value;
                              setJornadaDias(prev => prev.map((item, i) => i === idx ? { ...item, horario_fim: v } : item));
                            }}
                            className="px-2 py-1 border border-gray/20 rounded-lg text-xs"
                          />
                        </div>

                        <div className="flex items-center gap-1 pl-2 border-l border-gray/15">
                          <span className="text-[11px] text-amber-700 font-semibold">Almoço:</span>
                          <input
                            type="time"
                            value={d.intervalo_inicio || '12:00'}
                            onChange={e => {
                              const v = e.target.value;
                              setJornadaDias(prev => prev.map((item, i) => i === idx ? { ...item, intervalo_inicio: v } : item));
                            }}
                            className="px-2 py-1 border border-gray/20 rounded-lg text-xs"
                          />
                          <span className="text-gray">às</span>
                          <input
                            type="time"
                            value={d.intervalo_fim || '13:00'}
                            onChange={e => {
                              const v = e.target.value;
                              setJornadaDias(prev => prev.map((item, i) => i === idx ? { ...item, intervalo_fim: v } : item));
                            }}
                            className="px-2 py-1 border border-gray/20 rounded-lg text-xs"
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray italic">Folga / Sem expediente</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-gray/10 pt-4 mt-4">
              <button
                type="button"
                onClick={() => setModalJornadaProf(null)}
                className="px-4 py-2 text-xs font-bold text-gray-700 bg-gray/10 hover:bg-gray/20 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvandoJornada}
                onClick={handleSalvarJornada}
                className="px-5 py-2 text-xs font-bold text-white bg-primary hover:bg-primary-dark rounded-xl shadow-md shadow-primary/10 cursor-pointer"
              >
                {salvandoJornada ? 'Salvando...' : 'Salvar Grade do Profissional'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
