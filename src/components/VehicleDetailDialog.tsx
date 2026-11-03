import { useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Paper, Stack, Typography,
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
  const [contacts, setContacts] = useState<VehicleContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !vehicle || !supabase) { setContacts([]); return; }
    setLoading(true);
    setError(null);
    supabase.rpc('get_vehicle_contacts', { p_vehicle_id: vehicle.id }).then(({ data, error: rpcError }) => {
      setLoading(false);
      if (rpcError) { setError(rpcError.message); return; }
      setContacts((data ?? []) as VehicleContact[]);
    });
  }, [open, vehicle]);

  if (!vehicle) return null;

  // O banco já devolve o responsável primeiro.
  const owner = contacts.find((contact) => contact.is_owner) ?? null;
  const others = contacts.filter((contact) => !contact.is_owner);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Detalhes do veículo</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Avatar><DirectionsCarOutlinedIcon /></Avatar>
            <Box sx={{ flexGrow: 1 }}>
              <Typography fontWeight={800} fontSize="1.1rem">{formatPlate(vehicle.plate)}</Typography>
              <Typography fontWeight={650}>{vehicle.brand} {vehicle.model}</Typography>
            </Box>
            <Chip label={`Unidade ${vehicle.unit?.code ?? '—'}`} size="small" color="primary" variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {[vehicle.color, vehicle.category].filter(Boolean).join(' · ')}
          </Typography>
          {vehicle.notes && <Typography variant="body2">{vehicle.notes}</Typography>}

          <Divider />
          {loading ? (
            <CircularProgress size={24} />
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : contacts.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              Nenhum morador aprovado está vinculado a esta unidade no momento.
            </Typography>
          ) : (
            <>
              {owner && (
                <>
                  <Typography variant="subtitle2">Responsável pelo cadastro</Typography>
                  <ContactRow contact={owner} highlight />
                </>
              )}
              {others.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ pt: owner ? 1 : 0 }}>
                    {owner ? 'Outros moradores da unidade' : 'Moradores da unidade'}
                  </Typography>
                  {others.map((contact, index) => <ContactRow key={`${contact.full_name}-${index}`} contact={contact} />)}
                </>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

function ContactRow({ contact, highlight = false }: { contact: VehicleContact; highlight?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: highlight ? 'primary.main' : undefined }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1}>
        <Typography fontWeight={highlight ? 700 : 500}>{contact.full_name ?? 'Morador'}</Typography>
        {contact.phone ? (
          <Button
            size="small" variant={highlight ? 'contained' : 'outlined'} color="success" startIcon={<WhatsAppIcon />}
            component="a" href={whatsAppLink(contact.phone)} target="_blank" rel="noopener noreferrer"
          >
            WhatsApp
          </Button>
        ) : (
          <Typography color="text.secondary" variant="body2">Telefone não disponibilizado</Typography>
        )}
      </Stack>
    </Paper>
  );
}
