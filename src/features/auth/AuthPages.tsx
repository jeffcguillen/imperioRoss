import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { postJson } from '../../services/http';
import './auth.css';
import { TenantLogo } from '../../tenants/TenantProvider';

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><TenantLogo variant="full_slogan" alt="El Imperio de Ross · Tu momento. Tu suerte. Tu fortuna." /></div><div className="auth-heading"><span className="eyebrow">TU MOMENTO. TU SUERTE. TU FORTUNA.</span><h1>{title}</h1><p>{subtitle}</p></div>{children}<div className="auth-security"><ShieldCheck size={15} /><span>Tu información se protege con una conexión segura.</span></div></section><div className="auth-side"><div className="auth-side-art"><div className="auth-circle"><TenantLogo variant="monogram" alt="" /></div><span className="auth-star">✦</span><span className="auth-star second">✧</span></div><h2>La fortuna empieza<br />con una oportunidad.</h2><p>Juega con ilusión. Siempre con responsabilidad.</p></div></main>;
}

function PasswordField({ id, label, value, onChange, autoComplete = 'current-password' }: { id: string; label: string; value: string; onChange: (value: string) => void; autoComplete?: string }) {
  const [visible, setVisible] = useState(false);
  return <label className="field" htmlFor={id}><span>{label}</span><div className="password-wrap"><input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required minLength={10} /><button type="button" className="password-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><small>Usa al menos 10 caracteres.</small></label>;
}

function FormNotice({ text, success = false }: { text: string; success?: boolean }) {
  return <div className={`form-notice ${success ? 'success' : 'error'}`} role="status">{success && <CircleCheck size={17} />}<span>{text}</span></div>;
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <button className="button button-green auth-submit" type="submit" disabled={busy}>{busy ? 'Procesando…' : children}<ArrowRight size={16} /></button>;
}

export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const mutation = useMutation({ mutationFn: () => postJson<{ user: { id: string } }>('/api/auth/login', { identifier: identifier.trim(), password }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['auth'] }); const from = (location.state as { from?: unknown } | null)?.from; const safeLocalPath = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/\\'); navigate(safeLocalPath ? from : '/', { replace: true }); } });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <AuthFrame title="Qué bueno tenerte de vuelta" subtitle="Ingresa con tu teléfono o correo y contraseña."><form className="auth-form" onSubmit={submit}>
    <label className="field" htmlFor="login-identifier"><span>Teléfono o correo</span><input id="login-identifier" autoComplete="username" inputMode="email" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></label>
    <PasswordField id="login-password" label="Contraseña" value={password} onChange={setPassword} />
    {mutation.isError && <FormNotice text={mutation.error.message} />}
    <div className="auth-inline"><Link to="/recuperar">¿Olvidaste tu contraseña?</Link></div>
    <SubmitButton busy={mutation.isPending}>Iniciar sesión</SubmitButton>
    <p className="auth-switch">¿Aún no tienes cuenta? <Link to="/registro">Crear una cuenta</Link></p>
  </form></AuthFrame>;
}

export function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({ mutationFn: () => postJson<{ user: { id: string } }>('/api/auth/register', { fullName: fullName.trim(), phone: phone.trim(), email: email.trim() || undefined, password, adultConfirmed: adult, termsAccepted: terms }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['auth'] }); navigate('/cuenta'); } });
  function submit(event: FormEvent) { event.preventDefault(); if (password !== confirmation) return; mutation.mutate(); }
  return <AuthFrame title="Crea tu cuenta" subtitle="Regístrate para comprar y consultar tus tickets de forma segura."><form className="auth-form" onSubmit={submit}>
    <label className="field" htmlFor="register-name"><span>Nombre completo</span><input id="register-name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={3} /></label>
    <label className="field" htmlFor="register-phone"><span>Teléfono</span><input id="register-phone" autoComplete="tel" type="tel" inputMode="tel" placeholder="+593 99 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
    <label className="field" htmlFor="register-email"><span>Correo electrónico <small>Opcional</small></span><input id="register-email" autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <PasswordField id="register-password" label="Contraseña" value={password} onChange={setPassword} autoComplete="new-password" />
    <label className="field" htmlFor="register-confirm"><span>Confirma tu contraseña</span><input id="register-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} /></label>
    {confirmation && password !== confirmation && <FormNotice text="Las contraseñas no coinciden." />}
    <label className="check-row"><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} required /><span>Confirmo que soy mayor de 18 años.</span></label>
    <label className="check-row"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>Acepto los términos y condiciones del servicio.</span></label>
    {mutation.isError && <FormNotice text={mutation.error.message} />}
    <SubmitButton busy={mutation.isPending}>Crear cuenta</SubmitButton>
    <p className="auth-switch">¿Ya tienes cuenta? <Link to="/acceso">Iniciar sesión</Link></p>
  </form></AuthFrame>;
}

export function RecoveryPage() {
  const [target, setTarget] = useState('');
  const mutation = useMutation({ mutationFn: () => postJson<{ message?: string }>('/api/auth/recovery', { identifier: target.trim() }) });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <AuthFrame title="Recupera tu acceso" subtitle="Ingresa tu teléfono o correo. Si existe una cuenta, recibirás instrucciones para continuar."><form className="auth-form" onSubmit={submit}>
    <label className="field" htmlFor="recovery-target"><span>Teléfono o correo</span><input id="recovery-target" autoComplete="username" value={target} onChange={(event) => setTarget(event.target.value)} required /></label>
    {mutation.isError && <FormNotice text={mutation.error.message} />}
    {mutation.isSuccess && <FormNotice success text={mutation.data.message ?? 'Si encontramos una cuenta, enviaremos las instrucciones de recuperación.'} />}
    <SubmitButton busy={mutation.isPending || mutation.isSuccess}>Enviar instrucciones</SubmitButton>
    <p className="auth-switch"><Link to="/acceso">Volver a iniciar sesión</Link></p>
  </form></AuthFrame>;
}
