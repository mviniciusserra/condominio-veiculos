import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Paper, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import BlockIcon from '@mui/icons-material/Block';
import { supabase } from '../lib/supabase';
import type { AccessRequest, ApprovedResident } from '../types';

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
  onNotice: (message: string, severity: 'success' | 'error') => void;
  onChanged: () => void;
}

const KIND_LABELS: Record<AccessRequest['kind'], string> = {
  signup: 'Cadastro inicial',
  unit_change: 'Troca de unidade',
};

export default function AdminPanel({ open, onClose, currentUserId, onNotice, onChanged }: AdminPanelProps) {
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [pending, setPending] = useState<AccessRequest[]>([]);
  const [approved, setApproved] = useState<ApprovedResident[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadPending() {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('access_requests')
      .select('id,user_id,unit_id,full_name,phone_e164,kind,status,requested_at,decided_at,decision_note,unit:units(code)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });
    setLoading(false);
    if (error) { onNotice(error.message, 'error'); return; }
    setPending((data ?? []) as unknown as AccessRequest[]);
  }

  async function loadApproved() {
    if (!supabase) return;
    setLoading(true);
    const [profilesResult, membersResult] = await Promise.all([
      supabase.from('profiles').select('id,full_name,phone_e164,show_phone').eq('status', 'approved').order('full_name'),
      supabase.from('unit_members').select('user_id,is_active,unit:units(code)').eq('is_active', true),
    ]);
    setLoading(false);
    if (profilesResult.error || membersResult.error) {
      onNotice(profilesResult.error?.message ?? membersResult.error?.message ?? 'Erro ao carregar moradores.', 'error');
      return;
    }
    const unitsByUser = new Map<string, string[]>();
    for (const row of (membersResult.data ?? []) as unknown as { user_id: string; unit: { code: string } | null }[]) {
      if (!row.unit) continue;
      const list = unitsByUser.get(row.user_id) ?? [];
      list.push(row.unit.code);
      unitsByUser.set(row.user_id, list);
    }
    const residents: ApprovedResident[] = ((profilesResult.data ?? []) as unknown as { id: string; full_name: string | null; phone_e164: string | null; show_phone: boolean }[])
      .map((profile) => ({ ...profile, units: unitsByUser.get(profile.id) ?? [] }));
    setApproved(residents);
  }

  useEffect(() => {
    if (!open) return;
    if (tab === 'pending') void loadPending();
    else void loadApproved();
    // Reload the active tab whenever the dialog opens or the tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  async function decide(requestId: string, approve: boolean) {
    if (!supabase) return;
    setBusyId(requestId);
    const { error } = await supabase.rpc('decide_access_request', { p_request_id: requestId, p_approve: approve, p_note: null });
    setBusyId(null);
    if (error) { onNotice(error.message, 'error'); return; }
    onNotice(approve ? 'Solicitação aprovada.' : 'Solicitação recusada.', 'success');
    await loadPending();
    onChanged();
  }

  async function revoke(userId: string) {
    if (!supabase || !window.confirm('Revogar o acesso deste morador?')) return;
    setBusyId(userId);
    const { error } = await supabase.rpc('revoke_access', { p_user_id: userId });
    setBusyId(null);
    if (error) { onNotice(error.message, 'error'); return; }
    onNotice('Acesso revogado.', 'success');
    await loadApproved();
    onChanged();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Administração de acessos</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
          <Tab value="pending" label="Solicitações pendentes" />
          <Tab value="approved" label="Moradores aprovados" />
        </Tabs>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : tab === 'pending' ? (
          <Stack spacing={1.5}>
            {pending.length === 0 && <Typography color="text.secondary">Nenhuma solicitação pendente.</Typography>}
            {pending.map((request) => (
              <Paper key={request.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5}>
                  <Box>
                    <Typography fontWeight={700}>{request.full_name ?? 'Nome não informado'}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {request.phone_e164 ?? 'Sem telefone informado'}
                    </Typography>
                    <Stack direction="row" gap={1} sx={{ mt: 0.5 }}>
                      <Chip size="small" label={KIND_LABELS[request.kind]} />
                      <Chip size="small" color="primary" variant="outlined" label={`Unidade ${request.unit?.code ?? '—'}`} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      Solicitado em {new Date(request.requested_at).toLocaleString('pt-BR')}
                    </Typography>
                  </Box>
                  <Stack direction="row" gap={1} alignSelf={{ xs: 'flex-end', sm: 'center' }}>
                    <Button
                      size="small" variant="contained" color="success" startIcon={<CheckIcon />}
                      disabled={busyId === request.id} onClick={() => void decide(request.id, true)}
                    >
                      Aprovar
                    </Button>
                    <Button
                      size="small" variant="outlined" color="error" startIcon={<CloseIcon />}
                      disabled={busyId === request.id} onClick={() => void decide(request.id, false)}
                    >
                      Recusar
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {approved.length === 0 && <Typography color="text.secondary">Nenhum morador aprovado.</Typography>}
            {approved.map((resident) => (
              <Paper key={resident.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5}>
                  <Box>
                    <Typography fontWeight={700}>{resident.full_name ?? 'Nome não informado'}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {resident.phone_e164 ?? 'Sem telefone'} {resident.show_phone ? '· visível aos moradores' : '· telefone privado'}
                    </Typography>
                    <Stack direction="row" gap={1} sx={{ mt: 0.5 }} flexWrap="wrap">
                      {resident.units.length === 0
                        ? <Chip size="small" label="Sem unidade vinculada" />
                        : resident.units.map((code) => <Chip key={code} size="small" color="primary" variant="outlined" label={`Unidade ${code}`} />)}
                    </Stack>
                  </Box>
                  <Button
                    size="small" variant="outlined" color="error" startIcon={<BlockIcon />}
                    disabled={busyId === resident.id || resident.id === currentUserId}
                    onClick={() => void revoke(resident.id)}
                    sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}
                  >
                    Revogar
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
        <Divider sx={{ my: 2 }} />
        <Alert severity="info">
          Administradores não podem revogar o próprio acesso nem o último administrador ativo; o banco bloqueia essas ações mesmo se tentadas por aqui.
        </Alert>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
