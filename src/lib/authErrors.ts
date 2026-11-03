export function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'E-mail ou senha inválidos.';
  if (normalized.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
  if (normalized.includes('user already registered') || normalized.includes('already registered')) return 'Já existe uma conta com este e-mail. Faça login ou recupere sua senha.';
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns instantes e tente novamente.';
  return message;
}
