/**
 * Persistência isolada por dono (owner = id do usuário no Supabase Auth).
 * Produção: Supabase (REST, chave de serviço apenas no servidor).
 * Desenvolvimento sem Supabase: arquivo JSON local (.data/elite-store.json). Em produção sem Supabase, falha explicitamente.
 * Todas as leituras e gravações exigem owner. Não existe consulta sem filtro de dono.
 */
import fs from "node:fs";
import path from "node:path";

export interface EventoIn { owner: string; canal: "whatsapp" | "instagram"; tipo: string; direcao: "in" | "out"; nome: string; contato: string; texto: string; ts: string; extId?: string; temperatura?: string }
export interface EventoOut { seq: number; canal: string; tipo: string; direcao: string; nome: string; contato: string; texto: string; ts: string; temperatura?: string }
export interface Instancia { owner: string; instance: string; status: string; qr: string | null; updated_at?: string }

export interface Store {
  salvarEvento(e: EventoIn): Promise<void>;
  listarEventos(owner: string, since: number, limit: number): Promise<EventoOut[]>;
  historico(owner: string, canal: string, contato: string, limit: number): Promise<EventoOut[]>;
  recentes(owner: string, desdeIso: string): Promise<EventoOut[]>;
  obterInstancia(owner: string): Promise<Instancia | null>;
  salvarInstancia(i: Partial<Instancia> & { owner: string }): Promise<void>;
  obterGestor(owner: string): Promise<string>;
  salvarGestor(owner: string, telefone: string): Promise<void>;
  jaAlertado(owner: string, chave: string): Promise<boolean>;
  marcarAlerta(owner: string, chave: string): Promise<void>;
  donoInstagram(igId: string): Promise<string | null>;
  donosConectados(): Promise<string[]>;
}

const SB_URL = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, ""), SB_KEY = () => process.env.SUPABASE_KEY || "";
const usaSupabase = () => !!(SB_URL() && SB_KEY());
const enc = encodeURIComponent;

async function sb(rota: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
  const r = await fetch(SB_URL() + "/rest/v1/" + rota, {
    method: init.method || "GET",
    headers: { apikey: SB_KEY(), Authorization: "Bearer " + SB_KEY(), "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!r.ok) throw new Error("supabase " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const COLS = "seq,canal,tipo,direcao,nome,contato,texto,ts,temperatura";

const supabaseStore: Store = {
  async salvarEvento(e) {
    await sb("elite_wh_events?on_conflict=owner,ext_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: [{ owner: e.owner, canal: e.canal, tipo: e.tipo, direcao: e.direcao, nome: e.nome, contato: e.contato, texto: e.texto, ts: e.ts, ext_id: e.extId || null, temperatura: e.temperatura || null }] });
  },
  listarEventos: (owner, since, limit) => sb(`elite_wh_events?owner=eq.${enc(owner)}&seq=gt.${Math.max(0, since | 0)}&order=seq.asc&limit=${limit}&select=${COLS}`),
  async historico(owner, canal, contato, limit) { const r: EventoOut[] = await sb(`elite_wh_events?owner=eq.${enc(owner)}&canal=eq.${enc(canal)}&contato=eq.${enc(contato)}&order=ts.desc&limit=${limit}&select=${COLS}`); return r.reverse(); },
  recentes: (owner, desde) => sb(`elite_wh_events?owner=eq.${enc(owner)}&ts=gte.${enc(desde)}&order=ts.asc&limit=1000&select=${COLS}`),
  async obterInstancia(owner) { const r = await sb(`elite_wh_instances?owner=eq.${enc(owner)}&select=owner,instance,status,qr,updated_at`); return r && r[0] ? r[0] : null; },
  async salvarInstancia(i) { await sb("elite_wh_instances?on_conflict=owner", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: [{ ...i, updated_at: new Date().toISOString() }] }); },
  async obterGestor(owner) { const r = await sb(`elite_wh_settings?owner=eq.${enc(owner)}&select=manager_phone`); return (r && r[0] && r[0].manager_phone) || ""; },
  async salvarGestor(owner, tel) { await sb("elite_wh_settings?on_conflict=owner", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: [{ owner, manager_phone: tel, updated_at: new Date().toISOString() }] }); },
  async jaAlertado(owner, chave) { const r = await sb(`elite_wh_alerts?owner=eq.${enc(owner)}&chave=eq.${enc(chave)}&select=chave`); return !!(r && r.length); },
  async marcarAlerta(owner, chave) { await sb("elite_wh_alerts?on_conflict=owner,chave", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: [{ owner, chave }] }); },
  async donoInstagram(igId) { const r = await sb(`elite_wh_ig_accounts?ig_id=eq.${enc(igId)}&select=owner`); return r && r[0] ? r[0].owner : null; },
  async donosConectados() { const r = await sb("elite_wh_instances?status=eq.conectado&select=owner"); return (r || []).map((x: any) => x.owner); },
};

// ---------- Fallback JSON (somente desenvolvimento) ----------
interface Dev { seq: number; events: (EventoOut & { owner: string; extId?: string })[]; inst: Record<string, Instancia>; set: Record<string, string>; ig: Record<string, string>; alerts: Record<string, true> }
const arq = () => path.resolve(process.env.ELITE_DEV_STORE || ".data/elite-store.json");
const ler = (): Dev => { try { return JSON.parse(fs.readFileSync(arq(), "utf8")); } catch { return { seq: 0, events: [], inst: {}, set: {}, ig: {}, alerts: {} }; } };
const gravar = (d: Dev) => { fs.mkdirSync(path.dirname(arq()), { recursive: true }); fs.writeFileSync(arq(), JSON.stringify(d)); };
const pub = (e: Dev["events"][number]): EventoOut => ({ seq: e.seq, canal: e.canal, tipo: e.tipo, direcao: e.direcao, nome: e.nome, contato: e.contato, texto: e.texto, ts: e.ts, temperatura: e.temperatura });

const jsonStore: Store = {
  async salvarEvento(e) { const d = ler(); if (e.extId && d.events.some((x) => x.owner === e.owner && x.extId === e.extId)) return; d.events.push({ seq: ++d.seq, owner: e.owner, canal: e.canal, tipo: e.tipo, direcao: e.direcao, nome: e.nome, contato: e.contato, texto: e.texto, ts: e.ts, temperatura: e.temperatura, extId: e.extId }); d.events = d.events.slice(-5000); gravar(d); },
  async listarEventos(owner, since, limit) { return ler().events.filter((x) => x.owner === owner && x.seq > since).slice(0, limit).map(pub); },
  async historico(owner, canal, contato, limit) { return ler().events.filter((x) => x.owner === owner && x.canal === canal && x.contato === contato).sort((a, b) => a.ts.localeCompare(b.ts)).slice(-limit).map(pub); },
  async recentes(owner, desde) { return ler().events.filter((x) => x.owner === owner && x.ts >= desde).sort((a, b) => a.ts.localeCompare(b.ts)).map(pub); },
  async obterInstancia(owner) { return ler().inst[owner] || null; },
  async salvarInstancia(i) { const d = ler(); d.inst[i.owner] = { ...(d.inst[i.owner] || { instance: "", status: "desconectado", qr: null }), ...i, updated_at: new Date().toISOString() } as Instancia; gravar(d); },
  async obterGestor(owner) { return ler().set[owner] || ""; },
  async salvarGestor(owner, tel) { const d = ler(); d.set[owner] = tel; gravar(d); },
  async jaAlertado(owner, chave) { return !!ler().alerts[owner + "|" + chave]; },
  async marcarAlerta(owner, chave) { const d = ler(); d.alerts[owner + "|" + chave] = true; gravar(d); },
  async donoInstagram(igId) { return ler().ig[igId] || null; },
  async donosConectados() { return Object.values(ler().inst).filter((i) => i.status === "conectado").map((i) => i.owner); },
};

export function getStore(): Store {
  if (usaSupabase()) return supabaseStore;
  if (process.env.NODE_ENV === "production") throw new Error("Armazenamento não configurado: defina SUPABASE_URL e SUPABASE_KEY");
  return jsonStore;
}
