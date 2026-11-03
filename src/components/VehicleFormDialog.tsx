import { useEffect, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material';
import { supabase } from '../lib/supabase';
import { vehicleSchema } from '../lib/validation';
import type { Unit, Vehicle, VehicleCategory, VehicleFormValues } from '../types';

const categories: VehicleCategory[] = ['Carro', 'Motocicleta', 'Utilitário', 'Outro'];

interface VehicleFormDialogProps {
  open: boolean;
  onClose: () => void;
  // null = novo veículo
  vehicle: Vehicle | null;
  units: Unit[];
  currentUserId: string;
  onSaved: (message: string) => void;
  onNotice: (message: string, severity: 'success' | 'error') => void;
}

function initialValues(vehicle: Vehicle | null, units: Unit[]): VehicleFormValues {
  if (vehicle) {
    return {
      unit_id: vehicle.unit_id, plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model,
      color: vehicle.color ?? '', category: vehicle.category, notes: vehicle.notes ?? '',
    };
  }
  return { unit_id: units.length === 1 ? units[0].id : '', plate: '', brand: '', model: '', color: '', category: 'Carro', notes: '' };
}

export default function VehicleFormDialog({
  open, onClose, vehicle, units, currentUserId, onSaved, onNotice,
}: VehicleFormDialogProps) {
  const [form, setForm] = useState<VehicleFormValues>(() => initialValues(vehicle, units));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initialValues(vehicle, units));
  }, [open, vehicle, units]);

  async function save() {
    if (!supabase) return;
    const parsed = vehicleSchema.safeParse(form);
    if (!parsed.success) {
      onNotice(parsed.error.issues[0]?.message ?? 'Confira os campos do formulário.', 'error');
      return;
    }
    if (!units.some((unit) => unit.id === parsed.data.unit_id)) {
      onNotice('Você só pode cadastrar veículos nas unidades às quais está vinculado.', 'error');
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = { ...parsed.data, color: parsed.data.color || null, notes: parsed.data.notes || null };
    if (!vehicle) payload.owner_user_id = currentUserId;
    const result = vehicle
      ? await supabase.from('vehicles').update(payload).eq('id', vehicle.id)
      : await supabase.from('vehicles').insert(payload);
    setSaving(false);
    if (result.error) {
      onNotice(result.error.message, 'error');
      return;
    }
    onSaved(vehicle ? 'Veículo atualizado.' : 'Veículo cadastrado.');
  }

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{vehicle ? 'Editar veículo' : 'Cadastrar veículo'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Unidade" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} required>
            {units.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
          </TextField>
          <TextField label="Placa" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} required slotProps={{ htmlInput: { maxLength: 8 } }} placeholder="ABC1D23" />
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <TextField label="Marca" fullWidth value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} required />
            <TextField label="Modelo" fullWidth value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
            <TextField label="Cor" fullWidth value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            <TextField select label="Categoria" fullWidth value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as VehicleCategory })}>
              {categories.map((category) => <MenuItem key={category} value={category}>{category}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField label="Observações (opcional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} multiline minRows={2} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving}>{saving ? 'Salvando…' : 'Salvar veículo'}</Button>
      </DialogActions>
    </Dialog>
  );
}
