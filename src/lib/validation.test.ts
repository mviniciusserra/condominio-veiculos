import { describe, expect, it } from 'vitest';
import { formatPlate, normalizePhone, profileSchema, signUpSchema, vehicleSchema, whatsAppLink } from './validation';

const unitId = '3f1c2b7e-8d4a-4c1e-9b2a-5e6f7a8b9c0d';

describe('normalizePhone', () => {
  it('mantém só os dígitos', () => {
    expect(normalizePhone('(11) 98888-7777')).toBe('11988887777');
  });

  it('remove o DDI 55 do formato internacional', () => {
    expect(normalizePhone('+55 11 98888-7777')).toBe('11988887777');
  });

  it('não corta números nacionais que começam com 55 (DDD do RS)', () => {
    expect(normalizePhone('55988887777')).toBe('55988887777');
  });
});

describe('profileSchema', () => {
  it('aceita telefone vazio', () => {
    const result = profileSchema.safeParse({ full_name: 'Ana', phone: '', show_phone: false });
    expect(result.success).toBe(true);
  });

  it('rejeita telefone sem DDD', () => {
    const result = profileSchema.safeParse({ full_name: 'Ana', phone: '988887777', show_phone: true });
    expect(result.success).toBe(false);
  });

  it('rejeita nome em branco', () => {
    const result = profileSchema.safeParse({ full_name: '   ', phone: '', show_phone: false });
    expect(result.success).toBe(false);
  });
});

describe('signUpSchema', () => {
  const valid = {
    email: ' ana@exemplo.com ', password: '12345678', full_name: 'Ana', phone: '11 98888-7777',
    show_phone: true, unit_id: unitId,
  };

  it('normaliza e-mail e telefone', () => {
    const result = signUpSchema.parse(valid);
    expect(result.email).toBe('ana@exemplo.com');
    expect(result.phone).toBe('11988887777');
  });

  it('exige senha com 8 caracteres', () => {
    expect(signUpSchema.safeParse({ ...valid, password: '1234567' }).success).toBe(false);
  });

  it('exige unidade', () => {
    expect(signUpSchema.safeParse({ ...valid, unit_id: '' }).success).toBe(false);
  });
});

describe('vehicleSchema', () => {
  const valid = { unit_id: unitId, plate: 'abc-1d23', brand: 'Fiat', model: 'Uno', color: '', category: 'Carro', notes: '' };

  it('aceita placa Mercosul e normaliza', () => {
    expect(vehicleSchema.parse(valid).plate).toBe('ABC1D23');
  });

  it('aceita placa antiga', () => {
    expect(vehicleSchema.parse({ ...valid, plate: 'ABC-1234' }).plate).toBe('ABC1234');
  });

  it('rejeita placa inválida', () => {
    expect(vehicleSchema.safeParse({ ...valid, plate: '1234ABC' }).success).toBe(false);
  });
});

describe('formatação', () => {
  it('formata a placa com hífen', () => {
    expect(formatPlate('ABC1D23')).toBe('ABC-1D23');
  });

  it('monta o link do WhatsApp com DDI 55', () => {
    expect(whatsAppLink('11988887777')).toBe('https://wa.me/5511988887777');
  });
});
