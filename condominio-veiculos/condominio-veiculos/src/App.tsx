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
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { formatPlate, normalizeBrazilianPhone, vehicleSchema } from './lib/validation';
import type { Unit, Vehicle, VehicleCategory } from './types';

const categories: VehicleCategory[] = ['Carro', 'Motocicleta', 'Utilitário', 'Outro'];

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
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

  useEffect(() => {
    if (!supabase) { setLoadingSession(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void loadData();
    else { setVehicles([]); setUnits([]); setMyUnits([]); }
    // loadData is intentionally triggered only when the authenticated session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function loadData() {
    if (!supabase) return;
    setLoadingData(true);
    const [vehicleResult, unitResult, membershipResult] = await Promise.all([
      supabase.from('vehicles').select('id,unit_id,plate,brand,model,color,category,notes,updated_at,unit:units(code)').order('plate'),
      supabase.from('units').select('id,code').order('code'),
      supabase.from('unit_phone_access').select('unit:units(id,code)').eq('phone_e164', String(session?.user?.phone ?? '')),
    ]);
    if (vehicleResult.error || unitResult.error || membershipResult.error) {
      setNotice({ message: vehicleResult.error?.message ?? unitResult.error?.message ?? membershipResult.error?.message ?? 'Não foi possível carregar os dados.', severity: 'error' });
    } else {
      setVehicles((vehicleResult.data ?? []) as unknown as Vehicle[]);
      setUnits((unitResult.data ?? []) as unknown as Unit[]);
      const memberships = (membershipResult.data ?? []) as unknown as { unit: Unit | null }[];
      setMyUnits(memberships.map((row) => row.unit).filter((unit): unit is Unit => Boolean(unit)));
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

  async function sendOtp() {
    if (!supabase) return;
    try {
      const normalized = normalizeBrazilianPhone(phone);
      const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
      if (error) throw error;
      setPhone(normalized);
      setOtpSent(true);
      setNotice({ message: 'Se o login por SMS estiver habilitado, o código será enviado para o telefone informado.', severity: 'info' });
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : 'Não foi possível enviar o código.', severity: 'error' });
    }
  }

  async function verifyOtp() {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: normalizeBrazilianPhone(phone), token: otp.trim(), type: 'sms' });
      if (error) throw error;
      setOtpSent(false);
      setOtp('');
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : 'Código inválido.', severity: 'error' });
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setNotice({ message: error.message, severity: 'error' });
  }

  function openNewVehicle() {
    setEditing(null);
    setForm({ unit_id: myUnits.length === 1 ? myUnits[0].id : '', plate: '', brand: '', model: '', color: '', category: 'Carro', notes: '' });
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
    if (!supabase) return;
    const parsed = vehicleSchema.safeParse(form);
    if (!parsed.success) {
      setNotice({ message: parsed.error.issues[0]?.message ?? 'Confira os campos do formulário.', severity: 'error' });
      return;
    }
    if (!myUnits.some((unit) => unit.id === parsed.data.unit_id)) {
      setNotice({ message: 'Você só pode cadastrar veículos nas unidades às quais está vinculado.', severity: 'error' });
      return;
    }
    setSaving(true);
    const payload = { ...parsed.data, color: parsed.data.color || null, notes: parsed.data.notes || null };
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

  if (!session) {
    return (
      <Box className="login-page">
        <Paper elevation={0} className="login-card">
          <Avatar className="brand-avatar"><DirectionsCarOutlinedIcon /></Avatar>
          <Typography variant="h5" sx={{ mt: 2 }}>Veículos do Condomínio</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            Entre com o telefone autorizado para consultar os veículos e gerenciar os da sua unidade.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Telefone com DDD" placeholder="(41) 99999-9999" fullWidth
              value={phone} onChange={(event) => setPhone(event.target.value)}
              disabled={otpSent} InputProps={{ startAdornment: <InputAdornment position="start"><PhoneIphoneOutlinedIcon /></InputAdornment> }}
            />
            {otpSent && <TextField label="Código recebido por SMS" value={otp} onChange={(event) => setOtp(event.target.value)} inputProps={{ inputMode: 'numeric', maxLength: 6 }} />}
            {!otpSent
              ? <Button variant="contained" size="large" onClick={sendOtp}>Enviar código por SMS</Button>
              : <><Button variant="contained" size="large" onClick={verifyOtp}>Confirmar código</Button><Button onClick={() => { setOtpSent(false); setOtp(''); }}>Alterar telefone</Button></>}
          </Stack>
          <Alert severity="info" sx={{ mt: 3 }}>
            O número precisa estar autorizado pelo administrador. O envio de SMS deve estar habilitado no Supabase.
          </Alert>
        </Paper>
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
          <IconButton aria-label="Sair" onClick={signOut}><LogoutIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2} sx={{ mb: 3 }}>
          <Box>
            <Typography variant="h4">Veículos cadastrados</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>Consulte os veículos de todas as unidades.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNewVehicle} disabled={myUnits.length === 0}>Cadastrar veículo</Button>
        </Stack>

        {myUnits.length === 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Seu telefone ainda não está vinculado a uma unidade. Solicite ao administrador que autorize seu acesso.
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
              const canEdit = myUnits.some((unit) => unit.id === vehicle.unit_id);
              return (
                <Paper key={vehicle.id} elevation={0} className="vehicle-card">
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
                        <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => openEditVehicle(vehicle)}>Editar</Button>
                        <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => void deleteVehicle(vehicle)}>Excluir</Button>
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
          Para solicitar a inclusão ou correção de um telefone autorizado, fale com o administrador do aplicativo.
        </Typography>
      </Container>

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Editar veículo' : 'Cadastrar veículo'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label="Unidade" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} required>
              {myUnits.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
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