export type VehicleCategory = 'Carro' | 'Motocicleta' | 'Utilitário' | 'Outro';

export interface Vehicle {
  id: string;
  unit_id: string;
  owner_user_id: string | null;
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

export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface Profile {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  show_phone: boolean;
  status: ProfileStatus;
}

export type AccessRequestKind = 'signup' | 'unit_change';
export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequest {
  id: string;
  user_id: string;
  unit_id: string;
  full_name: string | null;
  phone_e164: string | null;
  kind: AccessRequestKind;
  status: AccessRequestStatus;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  unit?: { code: string } | null;
}

export interface VehicleContact {
  full_name: string | null;
  unit_code: string | null;
  phone_e164: string | null;
}

export interface ApprovedResident {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  show_phone: boolean;
  units: string[];
}