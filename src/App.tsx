import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Alert, AppBar, Avatar, Box, Button, Chip, CircularProgress, Container, Divider, IconButton,
  InputAdornment, MenuItem, Paper, Snackbar, Stack, TextField, Toolbar, Typography,
} from '@mui/material';
import DirectionsCarOutlinedIcon from '@mui/icons-material/DirectionsCarOutlined';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import LogoutIcon from '@mui/icons-material/Logout';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { formatPlate } from './lib/validation';
import AuthScreen from './components/AuthScreen';
import AccessStatusScreen from './components/AccessStatusScreen';
import PasswordResetScreen from './components/PasswordResetScreen';
import type { AccessRequest, Profile, Unit, Vehicle } from './types';

// Diálogos carregados sob demanda para reduzir o bundle inicial.
const ProfileDialog = lazy(() => import('./components/ProfileDialog'));
const VehicleDetailDialog = lazy(() => import('./components/VehicleDetailDialog'));
const VehicleFormDialog = lazy(() => import('./components/VehicleFormDialog'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));

type Notice = { message: string; severity: 'success' | 'error' | 'info' };

function sortUnits(units: Unit[]): Unit[] {
  // `code` é ordenado como texto pelo banco ("1001" antes de "101"); aqui a ordem é numérica.
  return units.slice().sort((a, b) => Number(a.code) - Number(b.code));
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [publicUnits, setPublicUnits] = useState<Unit[]>([]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [myAccessRequest, setMyAccessRequest] = useState<AccessRequest | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [myUnits, setMyUnits] = useState<Unit[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [detailVehicle, setDetailVehicle] = useState<Vehicle | null>(null);

  const notify = (message: string, severity: Notice['severity']) => setNotice({ message, severity });

  useEffect(() => {
    if (!supabase) { setLoadingSession(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      // O link de redefinição abre uma sessão de recuperação; mostra a tela de nova senha.
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // A lista de unidades é pública (só códigos) para o formulário de cadastro e para
  // os filtros.
  useEffect(() => {
    if (!supabase) return;
    supabase.from('units').select('id,code').order('code').then(({ data }) => {
      setPublicUnits(sortUnits((data ?? []) as Unit[]));
    });
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (userId) void loadProfileAndData();
    else {
      setVehicles([]); setMyUnits([]); setIsAdmin(false);
      setProfile(null); setMyAccessRequest(null); setProfileLoading(true);
    }
    // loadProfileAndData é disparado só quando o usuário autenticado muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadProfileAndData() {
    if (!supabase || !userId) return;
    setProfileLoading(true);
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles').select('id,full_name,phone,show_phone,status').eq('id', userId).maybeSingle();
    if (profileError) {
      notify(profileError.message, 'error');
      setProfileLoading(false);
      return;
    }
    const nextProfile = (profileRow as Profile | null) ?? null;
    setProfile(nextProfile);

    if (nextProfile) {
      const { data: requestRow } = await supabase
        .from('access_requests')
        .select('id,user_id,unit_id,full_name,phone,kind,status,requested_at,decided_at,decision_note,unit:units(code)')
        .eq('user_id', userId)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setMyAccessRequest((requestRow as unknown as AccessRequest | null) ?? null);
    }

    setProfileLoading(false);
    if (nextProfile?.status === 'approved') await loadData();
  }

  async function loadData() {
    if (!supabase || !userId) return;
    setLoadingData(true);
    // is_admin() é a mesma função SECURITY DEFINER usada pelas policies: o flag só
    // libera interface que o banco já permitiria, nunca concede acesso sozinho.
    const [vehicleResult, adminResult, memberResult] = await Promise.all([
      supabase.from('vehicles').select('id,unit_id,owner_user_id,plate,brand,model,color,category,notes,updated_at,unit:units(code)').order('plate'),
      supabase.rpc('is_admin'),
      supabase.from('unit_members').select('unit:units(id,code)').eq('user_id', userId).eq('is_active', true),
    ]);
    const error = vehicleResult.error ?? adminResult.error ?? memberResult.error;
    if (error) {
      notify(error.message, 'error');
    } else {
      setVehicles((vehicleResult.data ?? []) as unknown as Vehicle[]);
      const memberUnits = ((memberResult.data ?? []) as unknown as { unit: Unit | null }[])
        .map((row) => row.unit)
        .filter((unit): unit is Unit => Boolean(unit));
      setMyUnits(sortUnits(memberUnits));
      setIsAdmin(Boolean(adminResult.data));
    }
    setLoadingData(false);
  }

  const filteredVehicles = useMemo(() => vehicles.filter((vehicle) => {
    const needle = search.trim().toLocaleLowerCase('pt-BR');
    const matchesSearch = !needle || [vehicle.plate, vehicle.brand, vehicle.model, vehicle.color ?? '', vehicle.unit?.code ?? '']
      .some((value) => value.toLocaleLowerCase('pt-BR').includes(needle));
    const matchesUnit = unitFilter === 'all' || vehicle.unit_id === unitFilter;
    const matchesMine = !mineOnly || myUnits.some((unit) => unit.id === vehicle.unit_id);
    return matchesSearch && matchesUnit && matchesMine;
  }), [vehicles, search, unitFilter, mineOnly, myUnits]);

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) notify(error.message, 'error');
    setRecoveringPassword(false);
  }

  const assignableUnits = isAdmin ? publicUnits : myUnits;

  function openVehicleForm(vehicle: Vehicle | null) {
    setEditing(vehicle);
    setVehicleFormOpen(true);
  }

  async function deleteVehicle(vehicle: Vehicle) {
    if (!supabase || !window.confirm(`Excluir o veículo ${formatPlate(vehicle.plate)} da unidade ${vehicle.unit?.code ?? ''}?`)) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicle.id);
    if (error) notify(error.message, 'error');
    else {
      notify('Veículo excluído.', 'success');
      await loadData();
    }
  }

  const snackbar = (
    <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.message}</Alert> : undefined}
    </Snackbar>
  );

  const profileDialog = profile && profileDialogOpen && (
    <ProfileDialog
      open
      onClose={() => setProfileDialogOpen(false)}
      profile={profile}
      myAccessRequest={myAccessRequest}
      currentUnit={myUnits[0] ?? null}
      units={publicUnits}
      onSaved={() => { setProfileDialogOpen(false); void loadProfileAndData(); }}
      onNotice={notify}
    />
  );

  if (!isSupabaseConfigured) return <SetupScreen />;
  if (loadingSession) return <CenteredLoading />;

  // Tem prioridade sobre a checagem normal: a sessão de recuperação ainda não é
  // uma sessão autorizada.
  if (recoveringPassword) {
    return (
      <>
        <PasswordResetScreen onDone={() => { setRecoveringPassword(false); notify('Senha atualizada com sucesso. Você já está conectado.', 'success'); }} />
        {snackbar}
      </>
    );
  }

  if (!session) return <><AuthScreen units={publicUnits} />{snackbar}</>;

  if (profileLoading) return <CenteredLoading />;

  if (!profile || profile.status !== 'approved') {
    return (
      <>
        <AccessStatusScreen
          profile={profile}
          myAccessRequest={myAccessRequest}
          units={publicUnits}
          onEditProfile={() => setProfileDialogOpen(true)}
          onSignOut={() => void signOut()}
          onSubmitted={() => void loadProfileAndData()}
          onNotice={notify}
        />
        <Suspense fallback={null}>{profileDialog}</Suspense>
        {snackbar}
      </>
    );
  }

  return (
    <>
      <AppBar position="sticky" color="inherit" elevation={0} className="topbar">
        <Toolbar>
          <Avatar className="small-brand"><DirectionsCarOutlinedIcon /></Avatar>
          <Box sx={{ flexGrow: 1, ml: 1.5 }}>
            <Typography fontWeight={750}>Veículos do Condomínio</Typography>
            <Typography variant="caption" color="text.secondary">Consulta para moradores</Typography>
          </Box>
          {isAdmin && (
            <IconButton aria-label="Administração" onClick={() => setAdminOpen(true)}>
              <AdminPanelSettingsOutlinedIcon />
            </IconButton>
          )}
          <IconButton aria-label="Meu perfil" onClick={() => setProfileDialogOpen(true)}>
            <PersonOutlineIcon />
          </IconButton>
          <IconButton aria-label="Sair" onClick={() => void signOut()}><LogoutIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2} sx={{ mb: 3 }}>
          <Box>
            <Typography variant="h4">Veículos cadastrados</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>Consulte os veículos de todas as unidades.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openVehicleForm(null)} disabled={assignableUnits.length === 0}>Cadastrar veículo</Button>
        </Stack>

        {!isAdmin && myUnits.length === 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Sua conta ainda não está vinculada a uma unidade autorizada. Verifique em "Meu perfil" o status da sua solicitação.
          </Alert>
        )}

        <Paper elevation={0} className="filter-panel">
          <TextField
            fullWidth placeholder="Buscar placa, marca, modelo ou unidade…" value={search}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> } }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} sx={{ mt: 1.5 }}>
            <TextField select label="Unidade" value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} fullWidth>
              <MenuItem value="all">Todas as unidades</MenuItem>
              {publicUnits.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
            </TextField>
            <Button variant={mineOnly ? 'contained' : 'outlined'} onClick={() => setMineOnly(!mineOnly)} sx={{ minWidth: 160 }}>
              {mineOnly ? 'Minhas unidades' : 'Ver minhas unidades'}
            </Button>
          </Stack>
        </Paper>

        {loadingData ? <CenteredLoading /> : (
          <Box className="vehicle-grid">
            {filteredVehicles.map((vehicle) => {
              const canEdit = isAdmin || myUnits.some((unit) => unit.id === vehicle.unit_id);
              return (
                <Paper
                  key={vehicle.id} elevation={0} className="vehicle-card"
                  onClick={() => setDetailVehicle(vehicle)} sx={{ cursor: 'pointer' }}
                >
                  <Stack direction="row" alignItems="flex-start" gap={1.5}>
                    <Avatar className="vehicle-icon"><DirectionsCarOutlinedIcon /></Avatar>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography fontWeight={800} fontSize="1.1rem">{formatPlate(vehicle.plate)}</Typography>
                      <Typography fontWeight={650}>{vehicle.brand} {vehicle.model}</Typography>
                      <Typography variant="body2" color="text.secondary">{[vehicle.color, vehicle.category].filter(Boolean).join(' · ')}</Typography>
                    </Box>
                    <Chip label={`Unidade ${vehicle.unit?.code ?? '—'}`} size="small" color="primary" variant="outlined" />
                  </Stack>
                  {vehicle.notes && <Typography variant="body2" sx={{ mt: 1.5 }}>{vehicle.notes}</Typography>}
                  {canEdit && (
                    <>
                      <Divider sx={{ my: 1.5 }} />
                      <Stack direction="row" justifyContent="flex-end" gap={1}>
                        <Button size="small" startIcon={<EditOutlinedIcon />} onClick={(event) => { event.stopPropagation(); openVehicleForm(vehicle); }}>Editar</Button>
                        <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={(event) => { event.stopPropagation(); void deleteVehicle(vehicle); }}>Excluir</Button>
                      </Stack>
                    </>
                  )}
                </Paper>
              );
            })}
            {filteredVehicles.length === 0 && (
              <Paper elevation={0} className="empty-state">
                <DirectionsCarOutlinedIcon sx={{ fontSize: 42, color: 'text.secondary' }} />
                <Typography fontWeight={700}>Nenhum veículo encontrado</Typography>
                <Typography color="text.secondary" variant="body2">Experimente alterar a busca ou os filtros.</Typography>
              </Paper>
            )}
          </Box>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 4, textAlign: 'center' }}>
          Para solicitar a inclusão ou correção do vínculo da sua conta a uma unidade, use "Meu perfil".
        </Typography>
      </Container>

      <Suspense fallback={null}>
        {vehicleFormOpen && (
          <VehicleFormDialog
            open
            onClose={() => setVehicleFormOpen(false)}
            vehicle={editing}
            units={assignableUnits}
            currentUserId={session.user.id}
            onSaved={(message) => { setVehicleFormOpen(false); notify(message, 'success'); void loadData(); }}
            onNotice={notify}
          />
        )}
        {detailVehicle && (
          <VehicleDetailDialog open onClose={() => setDetailVehicle(null)} vehicle={detailVehicle} />
        )}
        {profileDialog}
        {isAdmin && adminOpen && (
          <AdminPanel
            open
            onClose={() => setAdminOpen(false)}
            currentUserId={session.user.id}
            onNotice={notify}
            onChanged={() => void loadData()}
          />
        )}
      </Suspense>

      {snackbar}
    </>
  );
}

function SetupScreen() {
  return (
    <Box className="login-page">
      <Paper elevation={0} className="login-card">
        <Avatar className="brand-avatar"><DirectionsCarOutlinedIcon /></Avatar>
        <Typography variant="h5" sx={{ mt: 2 }}>Configuração necessária</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Crie o arquivo <code>.env</code> a partir de <code>.env.example</code> e informe a URL e a chave pública do projeto Supabase.
        </Typography>
        <Alert severity="warning" sx={{ mt: 2 }}>Não inclua chaves secretas ou service_role no frontend.</Alert>
      </Paper>
    </Box>
  );
}

function CenteredLoading() {
  return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
}
