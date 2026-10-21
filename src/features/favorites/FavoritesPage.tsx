import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { deleteJson, getJson, postJson } from '../../services/http';
import type { ApiList } from '../../types/api';

type Favorite = { id: string; digits: 2 | 3 | 4; number: string; label: string | null; createdAt: string };

export function FavoritesPage() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: ({ signal }) => getJson<{ user: { role: string } }>('/api/auth/me', signal), retry: false });
  const favorites = useQuery({ queryKey: ['/api/favorites'], queryFn: ({ signal }) => getJson<ApiList<Favorite>>('/api/favorites', signal), enabled: auth.data?.user.role === 'client', retry: false });
  const queryClient = useQueryClient();
  const [digits, setDigits] = useState<2 | 3 | 4>(2);
  const [number, setNumber] = useState('');
  const [label, setLabel] = useState('');
  const add = useMutation({
    mutationFn: () => postJson('/api/favorites', { digits, number, label: label.trim() || undefined }),
    onSuccess: async () => { setNumber(''); setLabel(''); await queryClient.invalidateQueries({ queryKey: ['/api/favorites'] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteJson(`/api/favorites/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['/api/favorites'] }),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); if (number.length === digits) add.mutate(); };

  if (auth.isPending) return <><Heading/><section className="panel remote-state"><div className="loader"/><span>Verificando tu cuenta…</span></section></>;
  if (!auth.data) return <><Heading/><section className="panel account-panel"><div className="account-lock"><Heart size={22}/></div><div><h2>Inicia sesión para guardar favoritos</h2><p>Guarda tus números para encontrarlos rápidamente en futuras compras.</p></div><NavLink className="button button-green" to="/acceso">Iniciar sesión</NavLink></section></>;
  if (auth.data.user.role !== 'client') return <><Heading/><section className="panel remote-state"><strong>Disponible para cuentas cliente</strong><span>Cada cuenta administra sus propios números favoritos.</span></section></>;
  return <>
    <Heading/>
    <section className="panel favorite-form-panel">
      <div className="panel-heading"><div><div className="eyebrow">ACCESO RÁPIDO</div><h2>Agregar número</h2></div><Heart size={19}/></div>
      <p className="favorite-description">Tus favoritos se guardan en tu cuenta y conservan los ceros iniciales.</p>
      <form className="favorite-form" onSubmit={submit}>
        <label className="field"><span>Modalidad</span><select value={digits} onChange={(event) => { const next = Number(event.target.value) as 2 | 3 | 4; setDigits(next); setNumber((current) => current.slice(0, next)); }}><option value={2}>2 cifras</option><option value={3}>3 cifras</option><option value={4}>4 cifras</option></select></label>
        <label className="field"><span>Número</span><input inputMode="numeric" autoComplete="off" maxLength={digits} pattern={`[0-9]{${digits}}`} placeholder={'0'.repeat(digits)} value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, '').slice(0, digits))} required/></label>
        <label className="field"><span>Nombre <small>Opcional</small></span><input maxLength={60} placeholder="Ej. Cumpleaños" value={label} onChange={(event) => setLabel(event.target.value)}/></label>
        <button className="button button-green" type="submit" disabled={add.isPending || number.length !== digits}><Plus size={16}/>{add.isPending ? 'Guardando…' : 'Guardar favorito'}</button>
      </form>
      {add.isError && <div className="form-notice error" role="alert">{add.error.message}</div>}
      {add.isSuccess && <div className="form-notice success" role="status">Número agregado a tus favoritos.</div>}
    </section>
    <div className="section-heading favorite-section-heading"><div><div className="eyebrow">TU COLECCIÓN</div><h2>Mis números favoritos</h2></div><span>{favorites.data?.items.length ?? 0} guardados</span></div>
    {favorites.isPending && <section className="panel remote-state"><div className="loader"/><span>Cargando favoritos…</span></section>}
    {favorites.isError && <div className="form-notice error" role="alert">{favorites.error.message}</div>}
    {favorites.data?.items.length === 0 && <section className="panel remote-state"><span className="state-icon"><Heart size={20}/></span><strong>Aún no tienes favoritos</strong><span>Agrega tu primer número y lo tendrás a mano la próxima vez.</span></section>}
    {Boolean(favorites.data?.items.length) && <div className="favorite-list">{favorites.data!.items.map((item) => <article className="panel favorite-card" key={item.id}><span className="favorite-number">{item.number}</span><div className="favorite-info"><strong>{item.label || `${item.digits} cifras`}</strong><small>{item.digits} cifras · Guardado {new Date(item.createdAt).toLocaleDateString('es-EC', { dateStyle: 'medium' })}</small></div><NavLink className="button button-outline favorite-play" to={`/comprar?digits=${item.digits}&number=${encodeURIComponent(item.number)}`} aria-label={`Cargar ${item.number} en compra para revisarlo`}><ShoppingBag size={15}/>Revisar</NavLink><button className="icon-button favorite-delete" type="button" aria-label={`Eliminar ${item.number} de favoritos`} title="Eliminar favorito" disabled={remove.isPending} onClick={() => remove.mutate(item.id)}><Trash2 size={17}/></button></article>)}</div>}
    {remove.isError && <div className="form-notice error" role="alert">{remove.error.message}</div>}
  </>;
}

function Heading() { return <div className="page-heading"><div className="eyebrow">TU EXPERIENCIA PERSONAL</div><h1>Números favoritos</h1><p>Guarda tus números frecuentes y accede a ellos fácilmente.</p></div>; }
