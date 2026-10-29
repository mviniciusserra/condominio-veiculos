import { z } from 'zod';

export const vehicleSchema = z.object({
  unit_id: z.string().uuid('Selecione uma unidade válida.'),
  plate: z.string().trim().min(7, 'Informe a placa.').max(8, 'Placa inválida.')
    .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .refine((value) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value), 'Informe uma placa brasileira válida.'),
  brand: z.string().trim().min(1, 'Informe a marca.').max(60),
  model: z.string().trim().min(1, 'Informe o modelo.').max(80),
  color: z.string().trim().max(40),
  category: z.enum(['Carro', 'Motocicleta', 'Utilitário', 'Outro']),
  notes: z.string().trim().max(300),
});

export type VehicleInput = z.infer<typeof vehicleSchema>;

export function normalizeBrazilianPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  throw new Error('Informe um telefone brasileiro com DDD, por exemplo (41) 99999-9999.');
}

export function formatPlate(plate: string): string {
  const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.length === 7 ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : plate;
}