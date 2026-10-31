import { useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Stack, Typography,
} from '@mui/material';
import DirectionsCarOutlinedIcon from '@mui/icons-material/DirectionsCarOutlined';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { supabase } from '../lib/supabase';
import { formatPlate, whatsAppLink } from '../lib/validation';
import type { Vehicle, VehicleContact } from '../types';

interface VehicleDetailDialogProps {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle | null;
}

export default function VehicleDetailDialog({ open, onClose, vehicle }: VehicleDetailDialogProps) {
  const [contact, setContact] = useState<VehicleContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !vehicle || !supabase) { setContact(null); return; }
    setLoading(true);
    setError(null);
    supabase.rpc('get_vehicle_owner_contact', { p_vehicle_id: vehicle.id }).then(({ data, error: rpcError }) => {
      setLoading(false);
      if (rpcError) { setError(rpcError.message); return; }
      const rows = (data ?? []) as VehicleContact[];
      setContact(rows[0] ?? null);
    });
  }, [open, vehicle]);

  if (!vehicle) return null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Detalhes do veículo</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Avatar><DirectionsCarOutlinedIcon /></Avatar>
            <Box>
              <Typography fontWeight={800} fontSize="1.1rem">{formatPlate(vehicle.plate)}</Typography>
              <Typography fontWeight={650}>{vehicle.brand} {vehicle.model}</Typography>
            </Box>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {[vehicle.color, vehicle.category].filter(Boolean).join(' · ')}
          </Typography>
          {vehicle.notes && <Typography variant="body2">{vehicle.notes}</Typography>}

          <Divider />
          <Typography variant="subtitle2">Contato do responsável</Typography>
          {loading ? (
            <CircularProgress size={24} />
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : !contact ? (
            <Typography color="text.secondary" variant="body2">
              Nenhum responsável cadastrado para este veículo.
            </Typography>
          ) : (
            <Stack spacing={1}>
              <Typography>
                <strong>{contact.full_name ?? 'Morador'}</strong> — Unidade {contact.unit_code ?? '—'}
              </Typography>
              {contact.phone_e164 ? (
                <Button
                  variant="contained" color="success" startIcon={<WhatsAppIcon />}
                  component="a" href={whatsAppLink(contact.phone_e164)} target="_blank" rel="noopener noreferrer"
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Conversar pelo WhatsApp
                </Button>
              ) : (
                <Typography color="text.secondary" variant="body2">
                  O responsável não disponibilizou um telefone de contato.
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
