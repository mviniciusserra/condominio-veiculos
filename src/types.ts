export type VehicleCategory = 'Carro' | 'Motocicleta' | 'Utilitário' | 'Outro';

export interface Vehicle {
  id: string;
  unit_id: string;
  plate: string;
  brand: string;
  model: string;
  color: string | null;
  category: VehicleCategory;
  notes: string | null;
  updated_at: string;
  unit?: { code: string } | null;
}

export interface Unit {
  id: string;
  code: string;
}

export interface VehicleFormValues {
  unit_id: string;
  plate: string;
  brand: string;
  model: string;
  color: string;
  category: VehicleCategory;
  notes: string;
}