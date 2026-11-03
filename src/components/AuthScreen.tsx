import { useState } from 'react';
import {
  Alert, Avatar, Box, Button, Checkbox, CircularProgress, Divider, FormControlLabel,
  InputAdornment, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import DirectionsCarOutlinedIcon from '@mui/icons-material/DirectionsCarOutlined';
import AlternateEmailOutlinedIcon from '@mui/icons-material/AlternateEmailOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { supabase } from '../lib/supabase';
import { translateAuthError } from '../lib/authErrors';
import { normalizePhone, signUpSchema } from '../lib/validation';
import type { Unit } from '../types';

type AuthView = 'signin' | 'signup' | 'forgot';

const emailAdornment = { startAdornment: <InputAdornment position="start"><AlternateEmailOutlinedIcon /></InputAdornment> };
const passwordAdornment = { startAdornment: <InputAdornment position="start"><LockOutlinedIcon /></InputAdornment> };

export default function AuthScreen({ units }: { units: Unit[] }) {
  const [view, setView] = useState<AuthView>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPhone, setShowPhone] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [signUpDone, setSignUpDone] = useState(false);

  function goTo(next: AuthView) {
    setView(next);
    setError(null);
  }

  async function signIn() {
    if (!supabase) return;
    if (!email.trim() || !password) {
      setError('Informe e-mail e senha.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (signInError) setError(translateAuthError(signInError.message));
  }

  async function signUp() {
    if (!supabase) return;
    const parsed = signUpSchema.safeParse({
      email, password, full_name: fullName, phone, show_phone: showPhone, unit_id: unitId,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os campos do formulário.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: signUpError } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          full_name: parsed.data.full_name,
          phone: parsed.data.phone || null,
          show_phone: parsed.data.show_phone && Boolean(parsed.data.phone),
          unit_id: parsed.data.unit_id,
        },
      },
    });
    setLoading(false);
    if (signUpError) { setError(translateAuthError(signUpError.message)); return; }
    setSignUpDone(true);
  }

  function resetSignUpForm() {
    setFullName(''); setPhone(''); setShowPhone(false); setUnitId('');
    setEmail(''); setPassword(''); setSignUpDone(false);
  }

  async function sendPasswordReset() {
    if (!supabase) return;
    if (!email.trim()) {
      setError('Informe o e-mail cadastrado para receber o link de redefinição.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setLoading(false);
    if (resetError) { setError(translateAuthError(resetError.message)); return; }
    setResetSent(true);
  }

  const errorAlert = error && <Alert severity="error">{error}</Alert>;

  return (
    <Box className="login-page">
      <Paper elevation={0} className="login-card">
        <Avatar className="brand-avatar"><DirectionsCarOutlinedIcon /></Avatar>
        <Typography variant="h5" sx={{ mt: 2 }}>Veículos do Condomínio</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          {view === 'signup'
            ? 'Crie sua conta para solicitar acesso aos dados do condomínio.'
            : view === 'forgot'
              ? 'Informe seu e-mail para receber um link de redefinição de senha.'
              : 'Entre com seu e-mail e senha para consultar os veículos e gerenciar os da sua unidade.'}
        </Typography>

        {view === 'signup' ? (
          signUpDone ? (
            <Stack spacing={2}>
              <Alert severity="success">
                Conta criada. Se a confirmação por e-mail estiver habilitada, verifique sua caixa de entrada antes de entrar.
                Sua solicitação de acesso foi registrada e ficará pendente até a aprovação do administrador.
              </Alert>
              <Button onClick={() => { goTo('signin'); resetSignUpForm(); }}>Ir para o login</Button>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <TextField label="Nome completo" fullWidth value={fullName} onChange={(e) => setFullName(e.target.value)} />
              <TextField
                label="Telefone/WhatsApp (opcional)" fullWidth value={phone}
                onChange={(e) => setPhone(e.target.value)} placeholder="11988887777"
                onBlur={() => setPhone((prev) => (prev ? normalizePhone(prev) : prev))}
              />
              <FormControlLabel
                control={<Checkbox checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} disabled={!phone.trim()} />}
                label={
                  <Typography variant="body2">
                    Autorizo exibir meu telefone aos moradores aprovados que consultarem um veículo da minha unidade.
                    Posso desativar a qualquer momento em "Meu perfil".
                  </Typography>
                }
              />
              <TextField select label="Unidade" fullWidth value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {units.map((unit) => <MenuItem key={unit.id} value={unit.id}>{unit.code}</MenuItem>)}
              </TextField>
              <TextField
                label="E-mail" type="email" fullWidth value={email}
                onChange={(event) => setEmail(event.target.value)}
                slotProps={{ input: emailAdornment }}
              />
              <TextField
                label="Senha" type="password" fullWidth value={password}
                onChange={(event) => setPassword(event.target.value)}
                helperText="Mínimo de 8 caracteres."
                slotProps={{ input: passwordAdornment }}
              />
              {errorAlert}
              <Button variant="contained" size="large" onClick={() => void signUp()} disabled={loading}>
                {loading ? 'Criando conta…' : 'Criar conta'}
              </Button>
              <Button onClick={() => goTo('signin')}>Já tenho conta</Button>
            </Stack>
          )
        ) : view === 'forgot' ? (
          resetSent ? (
            <Stack spacing={2}>
              <Alert severity="success">Se o e-mail informado estiver cadastrado, enviamos um link para redefinir a senha.</Alert>
              <Button onClick={() => { goTo('signin'); setResetSent(false); }}>Voltar para o login</Button>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <TextField
                label="E-mail" type="email" fullWidth autoFocus
                value={email} onChange={(event) => setEmail(event.target.value)}
                slotProps={{ input: emailAdornment }}
              />
              {errorAlert}
              <Button variant="contained" size="large" onClick={() => void sendPasswordReset()} disabled={loading}>
                {loading ? 'Enviando…' : 'Enviar link de redefinição'}
              </Button>
              <Button onClick={() => goTo('signin')}>Voltar para o login</Button>
            </Stack>
          )
        ) : (
          <Stack spacing={2}>
            <TextField
              label="E-mail" type="email" fullWidth
              value={email} onChange={(event) => setEmail(event.target.value)}
              slotProps={{ input: emailAdornment }}
            />
            <TextField
              label="Senha" type="password" fullWidth
              value={password} onChange={(event) => setPassword(event.target.value)}
              slotProps={{ input: passwordAdornment }}
              onKeyDown={(event) => { if (event.key === 'Enter') void signIn(); }}
            />
            {errorAlert}
            <Button variant="contained" size="large" onClick={() => void signIn()} disabled={loading} startIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}>
              {loading ? 'Entrando…' : 'Entrar'}
            </Button>
            <Button onClick={() => goTo('forgot')}>Esqueci minha senha</Button>
            <Divider />
            <Button variant="outlined" onClick={() => goTo('signup')}>Criar conta</Button>
          </Stack>
        )}
        <Alert severity="info" sx={{ mt: 3 }}>
          O acesso aos dados do condomínio depende de um cadastro autorizado pelo administrador, mesmo após o login.
        </Alert>
      </Paper>
    </Box>
  );
}
