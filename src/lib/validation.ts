import { z } from 'zod';

export const vehicleSchema = z.object({
  unit_id: z.uuid('Selecione uma unidade válida.'),
  plate: z.string().trim().min(7, 'Informe a placa.').max(8, 'Placa inválida.')
    .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .refine((value) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value), 'Informe uma placa brasileira válida.'),
  brand: z.string().trim().min(1, 'Informe a marca.').max(60, 'A marca pode ter no máximo 60 caracteres.'),
  model: z.string().trim().min(1, 'Informe o modelo.').max(80, 'O modelo pode ter no máximo 80 caracteres.'),
  color: z.string().trim().max(40, 'A cor pode ter no máximo 40 caracteres.'),
  category: z.enum(['Carro', 'Motocicleta', 'Utilitário', 'Outro']),
  notes: z.string().trim().max(300, 'As observações podem ter no máximo 300 caracteres.'),
});

export type VehicleInput = z.infer<typeof vehicleSchema>;

export function formatPlate(plate: string): string {
  const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.length === 7 ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : plate;
}

// Telefone nacional (DDD + número), sem DDI: todos os moradores são do Brasil.
const PHONE_REGEX = /^[1-9]{2}\d{8,9}$/;

// Só dígitos; remove o DDI 55 se a pessoa colar o número no formato internacional.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
}

const phoneField = z.string().trim()
  .transform((value) => normalizePhone(value))
  .refine((value) => value === '' || PHONE_REGEX.test(value), 'Informe um telefone válido com DDD, ex.: 11988887777.');

const fullNameField = z.string().trim().min(1, 'Informe o nome completo.').max(120, 'O nome pode ter no máximo 120 caracteres.');

export const profileSchema = z.object({
  full_name: fullNameField,
  phone: phoneField,
  show_phone: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export const signUpSchema = z.object({
  email: z.string().trim().pipe(z.email('Informe um e-mail válido.')),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.'),
  full_name: fullNameField,
  phone: phoneField,
  show_phone: z.boolean(),
  unit_id: z.uuid('Selecione a sua unidade.'),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export function whatsAppLink(phoneNational: string): string {
  return `https://wa.me/55${phoneNational.replace(/\D/g, '')}`;
}
