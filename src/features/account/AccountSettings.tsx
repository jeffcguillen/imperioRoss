import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { patchJson, postJson } from '../../services/http';

interface AccountUser { id: string; fullName: string; phone: string; email: string | null; role: string; locationId: string | null; permissions?: string[] }

export function AccountSettings({ user }: { user: AccountUser }) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone);
  const [email, setEmail] = useState(user.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const profile = useMutation({
    mutationFn: () => patchJson<{ user: AccountUser }>('/api/auth/profile', { fullName: fullName.trim(), phone: phone.trim(), email: email.trim() }),
    onSuccess: async (response) => {
      setFullName(response.user.fullName); setPhone(response.user.phone); setEmail(response.user.email ?? '');
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });
  const password = useMutation({
    mutationFn: () => postJson<{ changed: boolean; sessionsRevoked: boolean }>('/api/auth/password/change', { currentPassword, newPassword }),
    onSuccess: async () => {
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });
  const saveProfile = (event: FormEvent) => { event.preventDefault(); profile.mutate(); };
  const changePassword = (event: FormEvent) => { event.preventDefault(); if (newPassword.length >= 10 && newPassword === confirmation && currentPassword !== newPassword) password.mutate(); };

  return <section className="account-settings">
    <form className="panel account-settings-card" onSubmit={saveProfile}>
      <div className="panel-heading"><div><div className="eyebrow">DATOS DE LA CUENTA</div><h2>Información personal</h2></div><UserRound size={19}/></div>
      <label className="field"><span>Nombre completo</span><input autoComplete="name" maxLength={120} minLength={3} value={fullName} onChange={(event) => setFullName(event.target.value)} required/></label>
      <label className="field"><span>Teléfono</span><input autoComplete="tel" type="tel" maxLength={30} minLength={7} value={phone} onChange={(event) => setPhone(event.target.value)} required/></label>
      <label className="field"><span>Correo <small>Opcional</small></span><input autoComplete="email" type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      {profile.isError && <div className="form-notice error" role="alert">{profile.error.message}</div>}
      {profile.isSuccess && <div className="form-notice success" role="status">Tus datos se actualizaron.</div>}
      <button className="button button-green" type="submit" disabled={profile.isPending || fullName.trim().length < 3 || phone.trim().length < 7}><Save size={16}/>{profile.isPending ? 'Guardando…' : 'Guardar cambios'}</button>
    </form>
    <form className="panel account-settings-card" onSubmit={changePassword}>
      <div className="panel-heading"><div><div className="eyebrow">ACCESO Y SEGURIDAD</div><h2>Cambiar contraseña</h2></div><KeyRound size={19}/></div>
      <label className="field"><span>Contraseña actual</span><input autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required/></label>
      <label className="field"><span>Nueva contraseña</span><input autoComplete="new-password" type="password" minLength={10} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required/><small>Usa al menos 10 caracteres.</small></label>
      <label className="field"><span>Confirma la contraseña nueva</span><input autoComplete="new-password" type="password" minLength={10} maxLength={200} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required/></label>
      {confirmation && newPassword !== confirmation && <div className="form-notice error" role="alert">Las contraseñas nuevas no coinciden.</div>}
      {currentPassword && newPassword === currentPassword && <div className="form-notice error" role="alert">Elige una contraseña distinta a la actual.</div>}
      {password.isError && <div className="form-notice error" role="alert">{password.error.message}</div>}
      {password.isSuccess && <div className="form-notice success" role="status">Contraseña actualizada. Las demás sesiones se cerraron.</div>}
      <button className="button button-green" type="submit" disabled={password.isPending || currentPassword.length === 0 || newPassword.length < 10 || newPassword !== confirmation || newPassword === currentPassword}><KeyRound size={16}/>{password.isPending ? 'Actualizando…' : 'Actualizar contraseña'}</button>
    </form>
  </section>;
}
