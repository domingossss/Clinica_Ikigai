import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';

interface Paciente {
  id: string;
  nome_completo: string;
  cpf: string;
  telefone: string;
  whatsapp: string;
  endereco: string;
  etapa_tratamento: string;
  atendimento_status: 'IA' | 'Humano';
  criado_em: string;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function CadastroPacientes() {
  // Estados de dados
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [loadingPacientes, setLoadingPacientes] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Estados de Formulário
  const [form, setForm] = useState({
    nome_completo: '',
    cpf: '',
    telefone: '',
    endereco: ''
  });

  // Estado para controlar edição
  const [editingPacienteId, setEditingPacienteId] = useState<string | null>(null);

  // Estados de erro de validação (Visual)
  const [errors, setErrors] = useState<Record<string, string | boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  // Estados do Autocomplete de Endereço (ViaCEP)
  const [enderecoSuggestions, setEnderecoSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Sistema de Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  // Carregar todos os pacientes do backend
  const carregarPacientes = async () => {
    setLoadingPacientes(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/pacientes`);
      const data = await res.json();
      if (data.sucesso) {
        setPacientes(data.dados);
      } else {
        showToast(data.erro || 'Falha ao buscar pacientes.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao conectar com o backend.', 'error');
    } finally {
      setLoadingPacientes(false);
    }
  };

  useEffect(() => {
    carregarPacientes();
  }, []);

  // Máscaras Dinâmicas
  const aplicarMascaraCPF = (value: string) => {
    const limpo = value.replace(/\D/g, '').slice(0, 11);
    if (limpo.length <= 3) return limpo;
    if (limpo.length <= 6) return `${limpo.slice(0, 3)}.${limpo.slice(3)}`;
    if (limpo.length <= 9) return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6)}`;
    return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
  };

  const aplicarMascaraTelefone = (value: string) => {
    const limpo = value.replace(/\D/g, '').slice(0, 11);
    if (limpo.length <= 2) return limpo;
    if (limpo.length <= 6) return `(${limpo.slice(0, 2)}) ${limpo.slice(2)}`;
    if (limpo.length <= 10) return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  };

  // Tratar inputs
  const handleInputChange = (field: string, val: string) => {
    let formattedVal = val;
    if (field === 'cpf') formattedVal = aplicarMascaraCPF(val);
    if (field === 'telefone') formattedVal = aplicarMascaraTelefone(val);

    setForm(prev => ({ ...prev, [field]: formattedVal }));

    // Limpar o erro ao digitar
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: false }));
    }
  };

  // Validador manual de CPF (Sênior)
  const validarCPF = (cpf: string): boolean => {
    const clean = cpf.replace(/\D/g, '');
    if (clean.length !== 11) return false;
    
    // Ignorar CPFs com todos os dígitos iguais
    if (/^(\d)\1{10}$/.test(clean)) return false;

    // Calcular dígitos verificadores
    let soma = 0;
    let resto;
    for (let i = 1; i <= 9; i++) soma += parseInt(clean.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(clean.substring(9, 10))) return false;

    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(clean.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(clean.substring(10, 11))) return false;

    return true;
  };

  // Autocomplete ViaCEP com devounce
  useEffect(() => {
    const term = form.endereco;
    if (!term || term.trim().length < 4) {
      setEnderecoSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (term.includes(', ') && term.includes('-') && term.length > 20) {
      return;
    }

    const cleanTerm = term.replace(/\D/g, '');
    
    const delayDebounceFn = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        if (cleanTerm.length === 8) {
          const res = await fetch(`https://viacep.com.br/ws/${cleanTerm}/json/`);
          const data = await res.json();
          if (!data.erro && data.logradouro) {
            const suggest = `${data.logradouro}, ${data.bairro} - ${data.localidade}/${data.uf} (CEP: ${data.cep})`;
            setEnderecoSuggestions([suggest]);
            setShowSuggestions(true);
          } else {
            setEnderecoSuggestions([]);
            setShowSuggestions(false);
          }
        } 
        else if (isNaN(Number(term.trim())) && term.trim().length >= 4) {
          const res = await fetch(
            `https://viacep.com.br/ws/SP/Sao Paulo/${encodeURIComponent(term)}/json/`
          );
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const list = data.slice(0, 5).map(
              (item: any) => `${item.logradouro}, ${item.bairro} - ${item.localidade}/${item.uf} (CEP: ${item.cep})`
            );
            setEnderecoSuggestions(list);
            setShowSuggestions(true);
          } else {
            setEnderecoSuggestions([]);
            setShowSuggestions(false);
          }
        }
      } catch (err) {
        console.error('Erro ao buscar ViaCEP:', err);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 450);

    return () => clearTimeout(delayDebounceFn);
  }, [form.endereco]);

  // Carregar dados no formulário para editar
  const handleEditClick = (p: Paciente) => {
    setEditingPacienteId(p.id);
    setForm({
      nome_completo: p.nome_completo,
      cpf: aplicarMascaraCPF(p.cpf),
      telefone: aplicarMascaraTelefone(p.telefone),
      endereco: p.endereco
    });
    setErrors({});
  };

  // Cancelar modo de edição
  const handleCancelEdit = () => {
    setEditingPacienteId(null);
    setForm({
      nome_completo: '',
      cpf: '',
      telefone: '',
      endereco: ''
    });
    setErrors({});
  };

  // Excluir paciente
  const handleDeleteClick = async (id: string, name: string) => {
    const result = await Swal.fire({
      title: 'Tem certeza?',
      text: `Deseja realmente excluir o(a) paciente ${name}? Todos os agendamentos vinculados a ele também serão excluídos permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#1e3a8a',
      cancelButtonColor: '#ef4444',
      confirmButtonText: 'Sim, excluir!',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/pacientes/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.sucesso) {
        Swal.fire({
          title: 'Excluído!',
          text: 'Paciente excluído com sucesso.',
          icon: 'success',
          timer: 2000,
          showConfirmButton: false
        });
        if (editingPacienteId === id) {
          handleCancelEdit();
        }
        carregarPacientes();
      } else {
        Swal.fire('Erro!', data.erro || 'Falha ao excluir paciente.', 'error');
      }
    } catch (err) {
      console.error(err);
      Swal.fire('Erro!', 'Erro de rede ao conectar com o servidor.', 'error');
    }
  };

  // Tratar submissão de cadastro ou edição
  const handleCadastrarPaciente = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    // Validar campos obrigatórios
    const newErrors: Record<string, string | boolean> = {};
    if (!form.nome_completo.trim()) newErrors.nome_completo = 'Nome completo é obrigatório.';
    
    const cleanCpf = form.cpf.replace(/\D/g, '');
    if (!cleanCpf) {
      newErrors.cpf = 'CPF é obrigatório.';
    } else if (!validarCPF(form.cpf)) {
      newErrors.cpf = 'CPF informado é inválido.';
    }

    const cleanTelefone = form.telefone.replace(/\D/g, '');
    if (!cleanTelefone) {
      newErrors.telefone = 'Telefone é obrigatório.';
    } else if (cleanTelefone.length < 10) {
      newErrors.telefone = 'Telefone deve conter o DDD e pelo menos 10 dígitos.';
    }

    if (!form.endereco.trim()) newErrors.endereco = 'Endereço é obrigatório.';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      showToast('Por favor, corrija os erros do formulário.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const isEditing = !!editingPacienteId;
      const url = isEditing 
        ? `${API_BASE_URL}/api/pacientes/${editingPacienteId}`
        : `${API_BASE_URL}/api/pacientes`;
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();

      if (data.sucesso) {
        showToast(isEditing ? 'Paciente atualizado com sucesso!' : 'Paciente cadastrado com sucesso!', 'success');
        setForm({ nome_completo: '', cpf: '', telefone: '', endereco: '' });
        setEditingPacienteId(null);
        carregarPacientes();
      } else {
        showToast(data.erro || 'Falha ao salvar dados do paciente.', 'error');
        if (data.erro && data.erro.includes('CPF')) {
          setErrors(prev => ({ ...prev, cpf: 'CPF já cadastrado.' }));
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de rede ao salvar paciente.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Formatar CPF para exibição na tabela
  const formatarCPFExibicao = (cpf: string) => {
    if (cpf.length !== 11) return cpf;
    return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  };

  // Formatar Telefone para exibição na tabela
  const formatarTelefoneExibicao = (tel: string) => {
    if (tel.length === 11) {
      return `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`;
    }
    if (tel.length === 10) {
      return `(${tel.slice(0, 2)}) ${tel.slice(2, 6)}-${tel.slice(6)}`;
    }
    return tel;
  };

  // Filtragem da lista
  const filteredPacientes = pacientes.filter(p => 
    p.nome_completo.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.cpf.includes(searchTerm.replace(/\D/g, '')) ||
    p.telefone.includes(searchTerm.replace(/\D/g, ''))
  );

  return (
    <div className="min-h-screen bg-light-gray text-dark font-sans p-6">
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

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLUNA ESQUERDA: Formulário de Cadastro/Edição */}
        <div className="lg:col-span-1">
          <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5 sticky top-24">
            <h2 className="text-lg font-bold text-dark mb-1 flex items-center gap-2">
              <span className="p-1.5 bg-primary/10 rounded-lg text-primary text-xs font-bold">Ficha</span>
              {editingPacienteId ? 'Editar Dados do Paciente' : 'Cadastrar Novo Paciente'}
            </h2>
            <p className="text-xs text-gray mb-5">
              {editingPacienteId 
                ? 'Modifique os dados do paciente. CPF e Telefone serão re-sanitizados.' 
                : 'Insira os dados do paciente. CPF e Telefone serão sanitizados automaticamente.'}
            </p>

            <form onSubmit={handleCadastrarPaciente} className="flex flex-col gap-4">
              
              {/* Nome Completo */}
              <div>
                <label className="block text-xs font-bold text-dark mb-1">Nome Completo</label>
                <input
                  type="text"
                  placeholder="Ex: Carlos Augusto Souza"
                  value={form.nome_completo}
                  onChange={e => handleInputChange('nome_completo', e.target.value)}
                  className={`w-full px-3.5 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50 ${
                    errors.nome_completo ? 'border-red-500 ring-2 ring-red-500/10' : 'border-gray/15'
                  }`}
                />
                {errors.nome_completo && (
                  <span className="text-[10px] text-red-500 font-bold mt-1 block">
                    {errors.nome_completo}
                  </span>
                )}
              </div>

              {/* CPF com Máscara */}
              <div>
                <label className="block text-xs font-bold text-dark mb-1">CPF (apenas números)</label>
                <input
                  type="text"
                  placeholder="000.000.000-00"
                  value={form.cpf}
                  onChange={e => handleInputChange('cpf', e.target.value)}
                  className={`w-full px-3.5 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50 ${
                    errors.cpf ? 'border-red-500 ring-2 ring-red-500/10' : 'border-gray/15'
                  }`}
                />
                {errors.cpf && (
                  <span className="text-[10px] text-red-500 font-bold mt-1 block">
                    {errors.cpf}
                  </span>
                )}
              </div>

              {/* Telefone com Máscara */}
              <div>
                <label className="block text-xs font-bold text-dark mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  placeholder="(00) 00000-0000"
                  value={form.telefone}
                  onChange={e => handleInputChange('telefone', e.target.value)}
                  className={`w-full px-3.5 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50 ${
                    errors.telefone ? 'border-red-500 ring-2 ring-red-500/10' : 'border-gray/15'
                  }`}
                />
                {errors.telefone && (
                  <span className="text-[10px] text-red-500 font-bold mt-1 block">
                    {errors.telefone}
                  </span>
                )}
              </div>

              {/* Endereço com Autocomplete ViaCEP */}
              <div className="relative">
                <label className="block text-xs font-bold text-dark mb-1">
                  Endereço Completo (Ou digite o CEP)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Ex: Av. Paulista ou 01311-200"
                    value={form.endereco}
                    onChange={e => handleInputChange('endereco', e.target.value)}
                    onFocus={() => {
                      if (enderecoSuggestions.length > 0) setShowSuggestions(true);
                    }}
                    className={`w-full px-3.5 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-light-gray/50 ${
                      errors.endereco ? 'border-red-500 ring-2 ring-red-500/10' : 'border-gray/15'
                    }`}
                  />
                  {loadingSuggestions && (
                    <div className="absolute right-3.5 top-2.5">
                      <span className="inline-block h-4.5 w-4.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                </div>

                {/* Dropdown de Sugestões do ViaCEP */}
                {showSuggestions && enderecoSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 z-50 mt-1 bg-white border border-gray/10 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                    {enderecoSuggestions.map((sug, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setForm(prev => ({ ...prev, endereco: sug }));
                          setShowSuggestions(false);
                          setEnderecoSuggestions([]);
                        }}
                        className="w-full text-left px-4 py-2.5 text-xs hover:bg-light-gray transition-colors border-b border-gray/5 font-semibold text-dark flex items-start gap-1.5 cursor-pointer"
                      >
                        <span className="mt-0.5 text-gray">•</span>
                        <span>{sug}</span>
                      </button>
                    ))}
                  </div>
                )}
                {errors.endereco && (
                  <span className="text-[10px] text-red-500 font-bold mt-1 block">
                    {errors.endereco}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary hover:bg-primary-dark text-white font-bold text-xs py-3 rounded-xl shadow-md shadow-primary/15 hover:shadow-primary/25 active:scale-[0.98] transition-all mt-2 flex justify-center items-center gap-1.5 cursor-pointer"
              >
                {submitting ? 'Salvando...' : (editingPacienteId ? 'Salvar Alterações' : 'Cadastrar Paciente')}
              </button>

              {editingPacienteId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="w-full bg-light-gray hover:bg-gray/10 text-dark font-bold text-xs py-2.5 rounded-xl border border-gray/10 transition-all mt-1 cursor-pointer"
                >
                  Cancelar Edição
                </button>
              )}

            </form>
          </div>
        </div>

        {/* COLUNA DIREITA: Lista de Pacientes Cadastrados */}
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-2xl shadow-premium border border-gray/5 flex flex-col min-h-[580px]">
            
            {/* Header da Seção */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-base font-bold text-dark flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  Pacientes Cadastrados ({filteredPacientes.length})
                </h2>
                <p className="text-[11px] text-gray mt-0.5">Lista geral de pacientes cadastrados na clínica</p>
              </div>

              {/* Input de Filtro */}
              <div className="relative min-w-[240px]">
                <input
                  type="text"
                  placeholder="Filtrar por nome, CPF ou WhatsApp..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 border border-gray/15 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all bg-light-gray/50"
                />
                <div className="absolute left-3 top-2.5 text-gray">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Tabela de Dados */}
            <div className="overflow-x-auto flex-1">
              <table className="min-w-full divide-y divide-gray/10">
                <thead>
                  <tr className="bg-light-gray text-left text-[10px] font-extrabold text-gray uppercase tracking-wider">
                    <th className="px-4 py-3 rounded-l-xl">Paciente</th>
                    <th className="px-4 py-3">CPF</th>
                    <th className="px-4 py-3">Telefone</th>
                    <th className="px-4 py-3">Endereço</th>
                    <th className="px-4 py-3">Cadastro</th>
                    <th className="px-4 py-3 text-right rounded-r-xl">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray/5 text-xs">
                  {loadingPacientes ? (
                    Array.from({ length: 4 }).map((_, idx) => (
                      <tr key={idx} className="animate-pulse">
                        <td className="px-4 py-4"><div className="h-4 w-28 bg-gray/10 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-3 w-20 bg-gray/10 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-3 w-24 bg-gray/10 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-3 w-36 bg-gray/10 rounded" /></td>
                        <td className="px-4 py-4"><div className="h-3 w-14 bg-gray/10 rounded" /></td>
                        <td className="px-4 py-4 text-right"><div className="h-8 w-16 bg-gray/10 rounded ml-auto" /></td>
                      </tr>
                    ))
                  ) : filteredPacientes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray font-medium">
                        Nenhum paciente cadastrado encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredPacientes.map(p => (
                      <tr key={p.id} className="hover:bg-light-gray/40 transition-colors">
                        <td className="px-4 py-4 font-bold text-dark">{p.nome_completo}</td>
                        <td className="px-4 py-4 text-gray font-mono">{formatarCPFExibicao(p.cpf)}</td>
                        <td className="px-4 py-4 text-gray font-semibold">{formatarTelefoneExibicao(p.telefone)}</td>
                        <td className="px-4 py-4 text-gray max-w-[150px] truncate" title={p.endereco}>
                          {p.endereco}
                        </td>
                        <td className="px-4 py-4 text-gray font-semibold">
                          {new Date(p.criado_em).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-4 py-4 text-right flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEditClick(p)}
                            title="Editar paciente"
                            className="p-1.5 bg-light-gray hover:bg-primary/15 text-gray hover:text-primary rounded-lg transition-colors cursor-pointer"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteClick(p.id, p.nome_completo)}
                            title="Excluir paciente"
                            className="p-1.5 bg-light-gray hover:bg-red-500/15 text-gray hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
