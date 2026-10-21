/* =====================================================================
 * CLÍNICA IKIGAI - TIPOS DO BACKEND (CLEAN CODE TYPESCRIPT)
 * Arquivo: backend/src/types/index.ts
 * ===================================================================== */

export interface DbSpecialty {
  id_especialidade: number;
  nome: string;
  descricao?: string;
  preco_base?: number;
  ativo: number;
}

export interface DbAppointmentRow {
  d: number;
  w: number;
  h: number;
  sp: number;
  s: 'R' | 'C' | 'N' | 'M';
  dl: number;
  pr: number;
  nt: number | null;
  age: number;
  sx: string;
  cv: string;
  rt: boolean | number;
  bot: boolean | number;
  esc: boolean | number;
}

export interface DbChatbotAbandonedRow {
  d: number;
  total_abandonos: number;
}
