import { useState } from 'react';
import { Alert, Avatar, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { supabase } from '../lib/supabase';
import { translateAuthError } from '../lib/authErrors';

// Reached by following the "redefinir senha" link: Supabase opens a recovery session
// and fires PASSWORD_RECOVERY.
export default function PasswordResetScreen({ onDone }: { onDone: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updatePassword() {
    if (!supabase) return;
    if (newPassword.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) { setError(translateAuthError(updateError.message)); return; }
    setNewPassword('');
    onDone();
  }

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
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" size="large" onClick={() => void updatePassword()} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
