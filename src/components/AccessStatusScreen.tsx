import { useState } from 'react';
import { Alert, Avatar, Box, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { supabase } from '../lib/supabase';
import type { AccessRequest, Profile, Unit } from '../types';

const STATUS_TITLES: Record<Profile['status'], string> = {
  pending: 'Acesso pendente de aprovação',
  rejected: 'Solicitação recusada',
  revoked: 'Acesso desativado',
  approved: 'Aprovado',
};

const STATUS_MESSAGES: Record<Profile['status'], string> = {
  pending: 'Seu cadastro foi recebido. Assim que o administrador do condomínio aprovar sua solicitação, você terá acesso aos dados e poderá cadastrar veículos.',
  rejected: 'Sua solicitação de acesso foi recusada. Confira seus dados em "Meu perfil" e, se for o caso, envie uma nova solicitação abaixo.',
  revoked: 'Seu acesso foi revogado pelo administrador. Fale com ele para mais informações.',
  approved: '',
};

interface AccessStatusScreenProps {
  profile: Profile | null;
  myAccessRequest: AccessRequest | null;
  units: Unit[];
  onEditProfile: () => void;
  onSignOut: () => void;
  onSubmitted: () => void;
  onNotice: (message: string, severity: 'success' | 'error') => void;
}

export default function AccessStatusScreen({
  profile, myAccessRequest, units, onEditProfile, onSignOut, onSubmitted, onNotice,
}: AccessStatusScreenProps) {
  const [unitId, setUnitId] = useState(myAccessRequest?.unit_id ?? '');
  const [submitting, setSubmitting] = useState(false);

  const status = profile?.status ?? 'pending';
  const hasPendingRequest = myAccessRequest?.status === 'pending';
  // Recusado, ou pendente sem solicitação (ex.: a unidade escolhida no cadastro era inválida).
  const canSubmit = Boolean(profile) && (status === 'rejected' || (status === 'pending' && !hasPendingRequest));

  async function submitRequest() {
    if (!supabase || !unitId) return;
    setSubmitting(true);
    const { error } = await supabase.rpc('submit_access_request', { p_unit_id: unitId });
    setSubmitting(false);
    if (error) { onNotice(error.message, 'error'); return; }
    onNotice('Solicitação de acesso enviada ao administrador.', 'success');
    onSubmitted();
  }

  return (
    <Box className="login-page">
      <Paper elevation={0} className="login-card">
        <Avatar className="brand-avatar"><LockOutlinedIcon /></Avatar>
        <Typography variant="h5" sx={{ mt: 2 }}>{STATUS_TITLES[status]}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          {status === 'pending' && !hasPendingRequest
            ? 'Não encontramos uma solicitação de acesso para a sua conta. Escolha a sua unidade e envie a solicitação ao administrador.'
            : STATUS_MESSAGES[status]}
        </Typography>
        {myAccessRequest && (
          <Alert severity={myAccessRequest.status === 'rejected' ? 'warning' : 'info'} sx={{ mb: 2, textAlign: 'left' }}>
            Unidade solicitada: <strong>{myAccessRequest.unit?.code ?? '—'}</strong>
            {myAccessRequest.decision_note && <> — {myAccessRequest.decision_note}</>}
          </Alert>
        )}
        {canSubmit && (
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} sx={{ mb: 2 }}>
            <TextField select label="Unidade" value={unitId} onChange={(e) => setUnitId(e.target.value)} fullWidth>
              {units.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
            </TextField>
            <Button variant="contained" disabled={!unitId || submitting} onClick={() => void submitRequest()} sx={{ minWidth: 170 }}>
              {submitting ? 'Enviando…' : 'Enviar solicitação'}
            </Button>
          </Stack>
        )}
        <Stack direction="row" gap={1.5} justifyContent="center">
          {profile && <Button variant={canSubmit ? 'outlined' : 'contained'} onClick={onEditProfile}>Editar meus dados</Button>}
          <Button variant="outlined" onClick={onSignOut}>Sair</Button>
        </Stack>
      </Paper>
    </Box>
  );
}
