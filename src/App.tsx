import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AppBar, Avatar, Box, Button, Chip, CircularProgress, Container, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment,
  MenuItem, Paper, Snackbar, Stack, TextField, Toolbar, Typography,
} from '@mui/material';
import DirectionsCarOutlinedIcon from '@mui/icons-material/DirectionsCarOutlined';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import LogoutIcon from '@mui/icons-material/Logout';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AlternateEmailOutlinedIcon from '@mui/icons-material/AlternateEmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { formatPlate, normalizePhone, signUpSchema, vehicleSchema } from './lib/validation';
import ProfileDialog from './components/ProfileDialog';
import VehicleDetailDialog from './components/VehicleDetailDialog';
import AdminPanel from './components/AdminPanel';
import type { AccessRequest, Profile, Unit, Vehicle, VehicleCategory } from './types';

const categories: VehicleCategory[] = ['Carro', 'Motocicleta', 'Utilitário', 'Outro'];

type AuthView = 'signin' | 'signup' | 'forgot' | 'reset';

const STATUS_TITLES: Record<Profile['status'], string> = {
  pending: 'Acesso pendente de aprovação',
  rejected: 'Solicitação recusada',
  revoked: 'Acesso desativado',
  approved: 'Aprovado',
};

const STATUS_MESSAGES: Record<Profile['status'], string> = {
  pending: 'Seu cadastro foi recebido. Assim que o administrador do condomínio aprovar sua solicitação, você terá acesso aos dados e poderá cadastrar veículos.',
  rejected: 'Sua solicitação de acesso foi recusada. Você pode atualizar seus dados em "Meu perfil" e falar com o administrador.',
  revoked: 'Seu acesso foi revogado pelo administrador. Fale com ele para mais informações.',
  approved: '',
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [authView, setAuthView] = useState<AuthView>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const [suFullName, setSuFullName] = useState('');
  const [suPhone, setSuPhone] = useState('');
  const [suUnitId, setSuUnitId] = useState('');
  const [signUpDone, setSignUpDone] = useState(false);

  const [publicUnits, setPublicUnits] = useState<Unit[]>([]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [myAccessRequest, setMyAccessRequest] = useState<AccessRequest | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [myUnits, setMyUnits] = useState<Unit[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({
    unit_id: '', plate: '', brand: '', model: '', color: '',
    category: 'Carro' as VehicleCategory, notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [detailVehicle, setDetailVehicle] = useState<Vehicle | null>(null);

  useEffect(() => {
    if (!supabase) { setLoadingSession(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      // Supabase redirects here with a recovery token and fires this event;
      // show the "set new password" screen instead of the normal app/login.
      if (event === 'PASSWORD_RECOVERY') setAuthView('reset');
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // The unit list is public (codes only, not sensitive) so the sign-up form can
  // offer it before the person has an account.
  useEffect(() => {
    if (!supabase) return;
    supabase.from('units').select('id,code').order('code').then(({ data }) => {
      const sorted = ((data ?? []) as unknown as Unit[]).slice().sort((a, b) => Number(a.code) - Number(b.code));
      setPublicUnits(sorted);
    });
  }, []);

  useEffect(() => {
    if (session) void loadProfileAndData();
    else {
      setVehicles([]); setUnits([]); setMyUnits([]); setIsAdmin(false);
      setProfile(null); setMyAccessRequest(null); setProfileLoading(true);
    }
    // loadProfileAndData is intentionally triggered only when the authenticated session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function loadProfileAndData() {
    if (!supabase || !session) return;
    setProfileLoading(true);
    const { data: profileRow, error: profileError } = await supabase
      .from('profiles').select('id,full_name,phone_e164,show_phone,status').eq('id', session.user.id).maybeSingle();
    if (profileError) {
      setNotice({ message: profileError.message, severity: 'error' });
      setProfileLoading(false);
      return;
    }
    setProfile((profileRow as unknown as Profile) ?? null);

    if (profileRow) {
      const { data: requestRow } = await supabase
        .from('access_requests')
        .select('id,user_id,unit_id,full_name,phone_e164,kind,status,requested_at,decided_at,decision_note,unit:units(code)')
        .eq('user_id', session.user.id)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setMyAccessRequest((requestRow as unknown as AccessRequest) ?? null);
    }

    setProfileLoading(false);
    if (profileRow && (profileRow as unknown as Profile).status === 'approved') {
      await loadData();
    }
  }

  async function loadData() {
    if (!supabase || !session) return;
    setLoadingData(true);
    // is_admin() is the same SECURITY DEFINER function the RLS policies use, so the
    // frontend flag it feeds can only ever unlock UI that the database would already
    // allow — it never grants access on its own.
    const [vehicleResult, unitResult, adminResult, memberResult] = await Promise.all([
      supabase.from('vehicles').select('id,unit_id,owner_user_id,plate,brand,model,color,category,notes,updated_at,unit:units(code)').order('plate'),
      supabase.from('units').select('id,code').order('code'),
      supabase.rpc('is_admin'),
      supabase.from('unit_members').select('unit_id,unit:units(id,code)').eq('user_id', session.user.id).eq('is_active', true),
    ]);
    if (vehicleResult.error || unitResult.error || adminResult.error || memberResult.error) {
      setNotice({
        message: vehicleResult.error?.message ?? unitResult.error?.message ?? adminResult.error?.message ?? memberResult.error?.message ?? 'Não foi possível carregar os dados.',
        severity: 'error',
      });
    } else {
      setVehicles((vehicleResult.data ?? []) as unknown as Vehicle[]);
      // Sort numerically: `code` is ordered as text by the database (so "1001"
      // sorts before "101"), but unit codes read naturally as numbers (101, 102,
      // 201, ..., 1101, 1102).
      const sortedUnits = ((unitResult.data ?? []) as unknown as Unit[])
        .slice()
        .sort((a, b) => Number(a.code) - Number(b.code));
      setUnits(sortedUnits);
      const memberUnits = ((memberResult.data ?? []) as unknown as { unit: Unit | null }[])
        .map((row) => row.unit)
        .filter((unit): unit is Unit => Boolean(unit));
      setMyUnits(memberUnits);
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

  function translateAuthError(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes('invalid login credentials')) return 'E-mail ou senha inválidos.';
    if (normalized.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
    if (normalized.includes('user already registered') || normalized.includes('already registered')) return 'Já existe uma conta com este e-mail. Faça login ou recupere sua senha.';
    if (normalized.includes('too many requests') || normalized.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns instantes e tente novamente.';
    return message;
  }

  async function signIn() {
    if (!supabase) return;
    if (!email.trim() || !password) {
      setAuthError('Informe e-mail e senha.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setAuthLoading(false);
    if (error) setAuthError(translateAuthError(error.message));
  }

  async function signUp() {
    if (!supabase) return;
    const parsed = signUpSchema.safeParse({
      email, password, full_name: suFullName, phone_e164: suPhone, unit_id: suUnitId,
    });
    if (!parsed.success) {
      setAuthError(parsed.error.issues[0]?.message ?? 'Confira os campos do formulário.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          full_name: parsed.data.full_name,
          phone_e164: parsed.data.phone_e164 || null,
          unit_id: parsed.data.unit_id,
        },
      },
    });
    setAuthLoading(false);
    if (error) { setAuthError(translateAuthError(error.message)); return; }
    setSignUpDone(true);
  }

  function resetSignUpForm() {
    setSuFullName(''); setSuPhone(''); setSuUnitId('');
    setEmail(''); setPassword(''); setSignUpDone(false);
  }

  async function sendPasswordReset() {
    if (!supabase) return;
    if (!email.trim()) {
      setAuthError('Informe o e-mail cadastrado para receber o link de redefinição.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setAuthLoading(false);
    if (error) { setAuthError(translateAuthError(error.message)); return; }
    setResetSent(true);
  }

  async function updatePassword() {
    if (!supabase) return;
    if (newPassword.length < 8) {
      setAuthError('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setAuthLoading(false);
    if (error) { setAuthError(translateAuthError(error.message)); return; }
    setNewPassword('');
    setAuthView('signin');
    setNotice({ message: 'Senha atualizada com sucesso. Você já está conectado.', severity: 'success' });
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setNotice({ message: error.message, severity: 'error' });
    setAuthView('signin');
    setPassword('');
  }

  const assignableUnits = isAdmin ? units : myUnits;

  function openNewVehicle() {
    setEditing(null);
    setForm({ unit_id: assignableUnits.length === 1 ? assignableUnits[0].id : '', plate: '', brand: '', model: '', color: '', category: 'Carro', notes: '' });
    setDialogOpen(true);
  }

  function openEditVehicle(vehicle: Vehicle) {
    setEditing(vehicle);
    setForm({
      unit_id: vehicle.unit_id, plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model,
      color: vehicle.color ?? '', category: vehicle.category, notes: vehicle.notes ?? '',
    });
    setDialogOpen(true);
  }

  async function saveVehicle() {
    if (!supabase || !session) return;
    const parsed = vehicleSchema.safeParse(form);
    if (!parsed.success) {
      setNotice({ message: parsed.error.issues[0]?.message ?? 'Confira os campos do formulário.', severity: 'error' });
      return;
    }
    if (!isAdmin && !myUnits.some((unit) => unit.id === parsed.data.unit_id)) {
      setNotice({ message: 'Você só pode cadastrar veículos nas unidades às quais está vinculado.', severity: 'error' });
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = { ...parsed.data, color: parsed.data.color || null, notes: parsed.data.notes || null };
    if (!editing) payload.owner_user_id = session.user.id;
    const result = editing
      ? await supabase.from('vehicles').update(payload).eq('id', editing.id)
      : await supabase.from('vehicles').insert(payload);
    setSaving(false);
    if (result.error) {
      setNotice({ message: result.error.message, severity: 'error' });
      return;
    }
    setDialogOpen(false);
    setNotice({ message: editing ? 'Veículo atualizado.' : 'Veículo cadastrado.', severity: 'success' });
    await loadData();
  }

  async function deleteVehicle(vehicle: Vehicle) {
    if (!supabase || !window.confirm(`Excluir o veículo ${formatPlate(vehicle.plate)} da unidade ${vehicle.unit?.code ?? ''}?`)) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', vehicle.id);
    if (error) setNotice({ message: error.message, severity: 'error' });
    else {
      setNotice({ message: 'Veículo excluído.', severity: 'success' });
      await loadData();
    }
  }

  if (!isSupabaseConfigured) {
    return <SetupScreen />;
  }

  if (loadingSession) return <CenteredLoading />;

  // Reached either by following the "redefinir senha" link (Supabase opens a session
  // and fires PASSWORD_RECOVERY) or right after requesting it; takes priority over the
  // normal session check since a recovery session is not yet an authorized session.
  if (authView === 'reset') {
    return (
      <Box className="login-page">
        <Paper elevation={0} className="login-card">
          <Avatar className="brand-avatar"><LockOutlinedIcon /></Avatar>
          <Typography variant="h5" sx={{ mt: 2 }}>Definir nova senha</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            Escolha uma nova senha para sua conta.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Nova senha" type="password" fullWidth autoFocus
              value={newPassword} onChange={(event) => setNewPassword(event.target.value)}
              helperText="Mínimo de 8 caracteres."
            />
            {authError && <Alert severity="error">{authError}</Alert>}
            <Button variant="contained" size="large" onClick={() => void updatePassword()} disabled={authLoading}>
              {authLoading ? 'Salvando…' : 'Salvar nova senha'}
            </Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  if (!session) {
    return (
      <Box className="login-page">
        <Paper elevation={0} className="login-card">
          <Avatar className="brand-avatar"><DirectionsCarOutlinedIcon /></Avatar>
          <Typography variant="h5" sx={{ mt: 2 }}>Veículos do Condomínio</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            {authView === 'signup'
              ? 'Crie sua conta para solicitar acesso aos dados do condomínio.'
              : authView === 'forgot'
                ? 'Informe seu e-mail para receber um link de redefinição de senha.'
                : 'Entre com seu e-mail e senha para consultar os veículos e gerenciar os da sua unidade.'}
          </Typography>

          {authView === 'signup' ? (
            signUpDone ? (
              <Stack spacing={2}>
                <Alert severity="success">
                  Conta criada. Se a confirmação por e-mail estiver habilitada, verifique sua caixa de entrada antes de entrar.
                  Sua solicitação de acesso foi registrada e ficará pendente até a aprovação do administrador.
                </Alert>
                <Button onClick={() => { setAuthView('signin'); resetSignUpForm(); }}>Ir para o login</Button>
              </Stack>
            ) : (
              <Stack spacing={2}>
                <TextField label="Nome completo" fullWidth value={suFullName} onChange={(e) => setSuFullName(e.target.value)} />
                <TextField
                  label="Telefone/WhatsApp" fullWidth value={suPhone}
                  onChange={(e) => setSuPhone(e.target.value)} placeholder="11988887777"
                  onBlur={() => setSuPhone((prev) => (prev ? normalizePhone(prev) : prev))}
                />
                <TextField select label="Unidade" fullWidth value={suUnitId} onChange={(e) => setSuUnitId(e.target.value)}>
                  {publicUnits.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
                </TextField>
                <TextField
                  label="E-mail" type="email" fullWidth value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><AlternateEmailOutlinedIcon /></InputAdornment> }}
                />
                <TextField
                  label="Senha" type="password" fullWidth value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  helperText="Mínimo de 8 caracteres."
                  InputProps={{ startAdornment: <InputAdornment position="start"><LockOutlinedIcon /></InputAdornment> }}
                />
                {authError && <Alert severity="error">{authError}</Alert>}
                <Button variant="contained" size="large" onClick={() => void signUp()} disabled={authLoading}>
                  {authLoading ? 'Criando conta…' : 'Criar conta'}
                </Button>
                <Button onClick={() => { setAuthView('signin'); setAuthError(null); }}>Já tenho conta</Button>
              </Stack>
            )
          ) : authView === 'forgot' ? (
            resetSent ? (
              <Stack spacing={2}>
                <Alert severity="success">Se o e-mail informado estiver cadastrado, enviamos um link para redefinir a senha.</Alert>
                <Button onClick={() => { setAuthView('signin'); setResetSent(false); setAuthError(null); }}>Voltar para o login</Button>
              </Stack>
            ) : (
              <Stack spacing={2}>
                <TextField
                  label="E-mail" type="email" fullWidth autoFocus
                  value={email} onChange={(event) => setEmail(event.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><AlternateEmailOutlinedIcon /></InputAdornment> }}
                />
                {authError && <Alert severity="error">{authError}</Alert>}
                <Button variant="contained" size="large" onClick={() => void sendPasswordReset()} disabled={authLoading}>
                  {authLoading ? 'Enviando…' : 'Enviar link de redefinição'}
                </Button>
                <Button onClick={() => { setAuthView('signin'); setAuthError(null); }}>Voltar para o login</Button>
              </Stack>
            )
          ) : (
            <Stack spacing={2}>
              <TextField
                label="E-mail" type="email" fullWidth
                value={email} onChange={(event) => setEmail(event.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><AlternateEmailOutlinedIcon /></InputAdornment> }}
              />
              <TextField
                label="Senha" type="password" fullWidth
                value={password} onChange={(event) => setPassword(event.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><LockOutlinedIcon /></InputAdornment> }}
                onKeyDown={(event) => { if (event.key === 'Enter') void signIn(); }}
              />
              {authError && <Alert severity="error">{authError}</Alert>}
              <Button variant="contained" size="large" onClick={() => void signIn()} disabled={authLoading} startIcon={authLoading ? <CircularProgress size={18} color="inherit" /> : undefined}>
                {authLoading ? 'Entrando…' : 'Entrar'}
              </Button>
              <Button onClick={() => { setAuthView('forgot'); setAuthError(null); }}>Esqueci minha senha</Button>
              <Divider />
              <Button variant="outlined" onClick={() => { setAuthView('signup'); setAuthError(null); }}>Criar conta</Button>
            </Stack>
          )}
          <Alert severity="info" sx={{ mt: 3 }}>
            O acesso aos dados do condomínio depende de um cadastro autorizado pelo administrador, mesmo após o login.
          </Alert>
        </Paper>
      </Box>
    );
  }

  if (profileLoading) return <CenteredLoading />;

  if (!profile || profile.status !== 'approved') {
    const status = profile?.status ?? 'pending';
    return (
      <Box className="login-page">
        <Paper elevation={0} className="login-card">
          <Avatar className="brand-avatar"><LockOutlinedIcon /></Avatar>
          <Typography variant="h5" sx={{ mt: 2 }}>{STATUS_TITLES[status]}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>{STATUS_MESSAGES[status]}</Typography>
          {myAccessRequest && (
            <Alert severity="info" sx={{ mb: 2, textAlign: 'left' }}>
              Unidade solicitada: <strong>{myAccessRequest.unit?.code ?? '—'}</strong>
              {myAccessRequest.decision_note && <> — {myAccessRequest.decision_note}</>}
            </Alert>
          )}
          <Stack direction="row" gap={1.5} justifyContent="center">
            {profile && <Button variant="contained" onClick={() => setProfileDialogOpen(true)}>Editar meus dados</Button>}
            <Button variant="outlined" onClick={() => void signOut()}>Sair</Button>
          </Stack>
        </Paper>
        {profile && (
          <ProfileDialog
            open={profileDialogOpen}
            onClose={() => setProfileDialogOpen(false)}
            profile={profile}
            myAccessRequest={myAccessRequest}
            currentUnit={null}
            units={publicUnits}
            onSaved={() => { setProfileDialogOpen(false); void loadProfileAndData(); }}
            onNotice={(message, severity) => setNotice({ message, severity })}
          />
        )}
      </Box>
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
          <IconButton aria-label="Sair" onClick={signOut}><LogoutIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2} sx={{ mb: 3 }}>
          <Box>
            <Typography variant="h4">Veículos cadastrados</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>Consulte os veículos de todas as unidades.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNewVehicle} disabled={assignableUnits.length === 0}>Cadastrar veículo</Button>
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
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} sx={{ mt: 1.5 }}>
            <TextField select label="Unidade" value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} fullWidth>
              <MenuItem value="all">Todas as unidades</MenuItem>
              {units.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
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
                        <Button size="small" startIcon={<EditOutlinedIcon />} onClick={(event) => { event.stopPropagation(); openEditVehicle(vehicle); }}>Editar</Button>
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

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Editar veículo' : 'Cadastrar veículo'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label="Unidade" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} required>
              {assignableUnits.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
            </TextField>
            <TextField label="Placa" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} required inputProps={{ maxLength: 8 }} placeholder="ABC1D23" />
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
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
          <Button variant="contained" onClick={() => void saveVehicle()} disabled={saving}>{saving ? 'Salvando…' : 'Salvar veículo'}</Button>
        </DialogActions>
      </Dialog>

      <VehicleDetailDialog open={Boolean(detailVehicle)} onClose={() => setDetailVehicle(null)} vehicle={detailVehicle} />

      {profile && (
        <ProfileDialog
          open={profileDialogOpen}
          onClose={() => setProfileDialogOpen(false)}
          profile={profile}
          myAccessRequest={myAccessRequest}
          currentUnit={myUnits[0] ?? null}
          units={units}
          onSaved={() => { setProfileDialogOpen(false); void loadProfileAndData(); }}
          onNotice={(message, severity) => setNotice({ message, severity })}
        />
      )}

      {isAdmin && (
        <AdminPanel
          open={adminOpen}
          onClose={() => setAdminOpen(false)}
          currentUserId={session.user.id}
          onNotice={(message, severity) => setNotice({ message, severity })}
          onChanged={() => void loadData()}
        />
      )}

      <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.message}</Alert> : undefined}
      </Snackbar>
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
