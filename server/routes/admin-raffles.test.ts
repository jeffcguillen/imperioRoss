import Fastify, { type FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminRaffleRoutes } from './admin-raffles.js';
import type { Actor, TenantContext } from '../types.js';

const tenant:TenantContext={id:'a0000000-0000-0000-0000-000000000001',slug:'demo',name:'Demo',tagline:null,timezone:'America/Guayaquil',currency:'USD',locale:'es-EC',branding:{},modules:{}};
const admin:Actor={id:'c0000000-0000-4000-8000-000000000001',tenantId:tenant.id,role:'admin',fullName:'Admin',phone:'0990000001',email:null,locationId:null};
const clientActor:Actor={...admin,id:'c0000000-0000-4000-8000-000000000004',role:'client'};const apps:FastifyInstance[]=[];
async function createApp(actor:Actor,query=vi.fn()) {const app=Fastify();apps.push(app);app.decorateRequest('actor',null);app.decorateRequest('tenant',null);app.decorateRequest('database',null);app.addHook('onRequest',async(request)=>{request.actor=actor;request.tenant=tenant;request.database={client:{query} as unknown as PoolClient,finished:false,cleanupPaths:[]};});await app.register(adminRaffleRoutes,{prefix:'/api/admin'});await app.ready();return{app,query};}
afterEach(async()=>Promise.all(apps.splice(0).map((app)=>app.close())));

describe('special raffle administration',()=>{
 it('blocks non-admin accounts before database access',async()=>{const{app,query}=await createApp(clientActor);const response=await app.inject({method:'GET',url:'/api/admin/raffles/manage'});expect(response.statusCode).toBe(403);expect(query).not.toHaveBeenCalled();});
 it('requires raffle.manage for configuration reads',async()=>{const query=vi.fn().mockResolvedValue({rows:[{allowed:false}]});const{app}=await createApp(admin,query);const response=await app.inject({method:'GET',url:'/api/admin/raffles/manage'});expect(response.statusCode).toBe(403);expect(query).toHaveBeenCalledTimes(1);});
 it('rejects a number range wider than its configured digit count before writing',async()=>{const query=vi.fn();const{app}=await createApp(admin,query);const response=await app.inject({method:'POST',url:'/api/admin/raffles/manage',payload:{name:'Rifa de prueba',prizeDescription:'Premio',numberDigits:2,rangeStart:'0',rangeEnd:'100',priceCents:'100',opensAt:'2026-10-20T10:00:00Z',closeMode:'sold_out'}});expect(response.statusCode).toBe(400);expect(query).not.toHaveBeenCalled();});
 it('requires a meaningful rejection reason before checking the purchase',async()=>{const query=vi.fn();const{app}=await createApp(admin,query);const response=await app.inject({method:'POST',url:'/api/admin/raffles/purchases/d0000000-0000-4000-8000-000000000001/review',payload:{decision:'reject',reason:'no'}});expect(response.statusCode).toBe(400);expect(query).not.toHaveBeenCalled();});
});
