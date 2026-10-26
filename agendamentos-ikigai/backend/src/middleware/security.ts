/**
 * Middleware de Seguranca - Clinica Ikigai
 * 
 * Funcoes utilitarias de sanitizacao, validacao e protecao de dados.
 */

// ============================================================================
// SANITIZACAO DE INPUT
// ============================================================================

/**
 * Remove tags HTML/scripts de uma string para prevenir XSS armazenado.
 * Preserva acentos e caracteres especiais do portugues.
 */
export function sanitizarTexto(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')         // Remove todas as tags HTML
    .replace(/[<>]/g, '')            // Remove < e > soltos
    .replace(/javascript:/gi, '')    // Remove protocolo javascript:
    .replace(/on\w+\s*=/gi, '')      // Remove event handlers (onclick=, onerror=, etc.)
    .trim();
}

// ============================================================================
// VALIDACAO DE CPF (ALGORITMO OFICIAL DA RECEITA FEDERAL)
// ============================================================================

/**
 * Valida CPF com verificacao de digitos verificadores.
 * Rejeita CPFs com todos os digitos iguais (ex: 111.111.111-11).
 * 
 * @param cpf String contendo apenas digitos (11 caracteres)
 * @returns true se CPF e valido
 */
export function validarCPF(cpf: string): boolean {
  // Deve ter exatamente 11 digitos
  if (!cpf || cpf.length !== 11 || !/^\d{11}$/.test(cpf)) {
    return false;
  }

  // Rejeitar CPFs com todos os digitos iguais (000.000.000-00, 111.111.111-11, etc.)
  if (/^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  // Validacao do primeiro digito verificador
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf.charAt(9))) {
    return false;
  }

  // Validacao do segundo digito verificador
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(cpf.charAt(i)) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf.charAt(10))) {
    return false;
  }

  return true;
}

// ============================================================================
// VALIDACAO DE FORMATOS
// ============================================================================

/**
 * Valida se a string esta no formato de data YYYY-MM-DD e representa uma data real.
 */
export function validarFormatoData(data: string): boolean {
  if (!data || typeof data !== 'string') return false;

  // Regex para formato YYYY-MM-DD
  const regex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!regex.test(data)) return false;

  // Verificar se a data e real (ex: 2025-02-30 nao existe)
  const [year, month, day] = data.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  return dateObj.getFullYear() === year &&
         dateObj.getMonth() === month - 1 &&
         dateObj.getDate() === day;
}

/**
 * Valida se a string esta no formato de horario HH:MM ou HH:MM:SS.
 * Aceita horas de 00:00 a 23:59.
 */
export function validarFormatoHorario(horario: string): boolean {
  if (!horario || typeof horario !== 'string') return false;

  // Aceita HH:MM ou HH:MM:SS
  const regex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  return regex.test(horario);
}

/**
 * Valida se um ID numerico de parametro de rota e um inteiro positivo valido.
 */
export function validarIdNumerico(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const parsed = parseInt(id, 10);
  return !isNaN(parsed) && parsed > 0 && parsed.toString() === id;
}

// ============================================================================
// MASCARAMENTO DE DADOS SENSIVEIS PARA LOGS
// ============================================================================

/**
 * Mascara numero de telefone/WhatsApp para logs seguros.
 * Ex: "5511999999999" -> "55119****9999"
 */
export function mascaraTelefone(telefone: string): string {
  if (!telefone || telefone.length < 8) return '***';
  const visivel = 4;
  return telefone.substring(0, telefone.length - visivel - 4) +
         '****' +
         telefone.substring(telefone.length - visivel);
}

/**
 * Mascara CPF para logs seguros.
 * Ex: "12345678901" -> "123.***.***-01"
 */
export function mascaraCPF(cpf: string): string {
  if (!cpf || cpf.length !== 11) return '***';
  return `${cpf.substring(0, 3)}.***.***-${cpf.substring(9)}`;
}
