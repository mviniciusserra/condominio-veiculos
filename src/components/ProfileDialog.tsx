import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControlLabel, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { supabase } from '../lib/supabase';
import { profileSchema } from '../lib/validation';
import type { AccessRequest, Profile, Unit } from '../types';

const STATUS_LABELS: Record<Profile['status'], string> = {
  pending: 'Pendente de aprovação',
  approved: 'Aprovado',
  rejected: 'Recusado',
  revoked: 'Revogado',
};

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  myAccessRequest: AccessRequest | null;
  currentUnit: Unit | null;
  units: Unit[];
  onSaved: () => void;
  onNotice: (message: string, severity: 'success' | 'error') => void;
}

export default function ProfileDialog({
  open, onClose, profile, myAccessRequest, currentUnit, units, onSaved, onNotice,
}: ProfileDialogProps) {
  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [phone, setPhone] = useState(profile.phone_e164 ?? '');
  const [showPhone, setShowPhone] = useState(profile.show_phone);
  const [saving, setSaving] = useState(false);
  const [requestUnitId, setRequestUnitId] = useState('');
  const [requestingUnit, setRequestingUnit] = useState(false);

  useEffect(() => {
    if (open) {
      setFullName(profile.full_name ?? '');
      setPhone(profile.phone_e164 ?? '');
      setShowPhone(profile.show_phone);
      setRequestUnitId('');
    }
  }, [open, profile]);

  async function saveProfile() {
    if (!supabase) return;
    const parsed = profileSchema.safeParse({ full_name: fullName, phone_e164: phone, show_phone: showPhone });
    if (!parsed.success) {
      onNotice(parsed.error.issues[0]?.message ?? 'Confira os campos do formulário.', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('update_my_profile', {
      p_full_name: parsed.data.full_name,
      p_phone_e164: parsed.data.phone_e164 || null,
      p_show_phone: parsed.data.show_phone,
    });
    setSaving(false);
    if (error) { onNotice(error.message, 'error'); return; }
    onNotice('Perfil atualizado.', 'success');
    onSaved();
  }

  async function requestUnitChange() {
    if (!supabase || !requestUnitId) return;
    setRequestingUnit(true);
    const { error } = await supabase.rpc('request_unit_change', { p_unit_id: requestUnitId });
    setRequestingUnit(false);
    if (error) { onNotice(error.message, 'error'); return; }
    onNotice('Solicitação de troca de unidade enviada ao administrador.', 'success');
    onSaved();
  }

  const hasPendingRequest = myAccessRequest?.status === 'pending';
  const otherUnits = units.filter((unit) => unit.id !== currentUnit?.id);

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Meu perfil</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity={profile.status === 'approved' ? 'success' : 'info'}>
            Status da conta: <strong>{STATUS_LABELS[profile.status]}</strong>
          </Alert>
          <TextField label="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <TextField
            label="Telefone/WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="11988887777" helperText="DDD + número. Deixe em branco para remover."
          />
          <FormControlLabel
            control={<Switch checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} />}
            label="Exibir meu telefone aos demais moradores ao consultarem um veículo meu"
          />
          <DialogActionsButton saving={saving} onSave={() => void saveProfile()} />

          <Divider />
          <Typography variant="subtitle2">Unidade</Typography>
          {profile.status === 'approved' ? (
            <>
              <Typography color="text.secondary">
                Unidade atual: <strong>{currentUnit?.code ?? '—'}</strong>
              </Typography>
              {hasPendingRequest ? (
                <Alert severity="info">
                  Já existe uma solicitação pendente ({myAccessRequest?.kind === 'unit_change' ? 'troca de unidade' : 'cadastro'} para a unidade {myAccessRequest?.unit?.code ?? '—'}).
                </Alert>
              ) : (
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
                  <TextField
                    select label="Solicitar troca para" value={requestUnitId}
                    onChange={(e) => setRequestUnitId(e.target.value)} fullWidth
                  >
                    {otherUnits.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
                  </TextField>
                  <Button
                    variant="outlined" disabled={!requestUnitId || requestingUnit}
                    onClick={() => void requestUnitChange()} sx={{ minWidth: 160 }}
                  >
                    {requestingUnit ? 'Enviando…' : 'Solicitar troca'}
                  </Button>
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary">
                A troca só é efetivada após a aprovação do administrador. Até lá, seu acesso à unidade atual permanece.
              </Typography>
            </>
          ) : (
            <Typography color="text.secondary">
              Unidade solicitada: <strong>{myAccessRequest?.unit?.code ?? '—'}</strong>. Aguarde a aprovação do administrador.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={saving}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

function DialogActionsButton({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <Button variant="contained" onClick={onSave} disabled={saving} sx={{ alignSelf: 'flex-start' }}>
      {saving ? 'Salvando…' : 'Salvar dados'}
    </Button>
  );
}
