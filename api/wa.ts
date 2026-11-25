/**
 * Adaptador do provedor de WhatsApp.
 * Controle (criar instância, QR, estado, logout): Evolution API (v2).
 * Leitura de webhook: aceita payloads da Evolution API e da Z-API.
 * Z-API exige instâncias provisionadas por cliente, então aqui ela só entra pelo recebimento de eventos.
 */
const base = () => (process.env.WA_API_URL || "").replace(/\/+$/, "");
const chave = () => process.env.WA_API_KEY || "";

async function evo(rota: string, metodo = "GET", corpo?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  if (!base() || !chave()) throw new Error("WA_API_URL e WA_API_KEY não configurados");
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(base() + rota, { method: metodo, signal: ctl.signal, headers: { apikey: chave(), "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    let json: any = null; try { json = await r.json(); } catch { json = null; }
    return { ok: r.ok, status: r.status, json };
  } finally { clearTimeout(t); }
}

export const nomeInstancia = (owner: string): string => "elite_" + owner.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
const EVENTOS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"];
const imagemQr = (j: any): string | null => { const b = j?.base64 || j?.qrcode?.base64 || ""; return b ? (String(b).startsWith("data:") ? String(b) : "data:image/png;base64," + b) : null; };

/** Cria a instância do usuário (idempotente) e aponta o webhook exclusivo dele. */
export async function garantirInstancia(instance: string, webhookUrl: string): Promise<void> {
  const c = await evo("/instance/create", "POST", { instanceName: instance, qrcode: false, integration: "WHATSAPP-BAILEYS" });
  if (!c.ok && c.status !== 403 && c.status !== 409) throw new Error("Falha ao criar instância (" + c.status + ")");
  const w = await evo("/webhook/set/" + encodeURIComponent(instance), "POST", { webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVENTOS } });
  if (!w.ok) throw new Error("Falha ao configurar webhook (" + w.status + ")");
}
export async function gerarQr(instance: string): Promise<string | null> { const r = await evo("/instance/connect/" + encodeURIComponent(instance)); return r.ok ? imagemQr(r.json) : null; }
export async function estado(instance: string): Promise<"conectado" | "aguardando" | "desconectado"> {
  const r = await evo("/instance/connectionState/" + encodeURIComponent(instance));
  const s = String(r.json?.instance?.state || r.json?.state || "").toLowerCase();
  return s === "open" ? "conectado" : s === "connecting" ? "aguardando" : "desconectado";
}
export async function sair(instance: string): Promise<void> { await evo("/instance/logout/" + encodeURIComponent(instance), "DELETE"); }
export async function enviarTexto(instance: string, numero: string, texto: string): Promise<boolean> { const r = await evo("/message/sendText/" + encodeURIComponent(instance), "POST", { number: numero, text: texto }); return r.ok; }

export type EventoWa =
  | { kind: "message"; instance: string; extId: string; direcao: "in" | "out"; contato: string; nome: string; texto: string; ts: string }
  | { kind: "status"; instance: string; estado: "conectado" | "aguardando" | "desconectado" }
  | { kind: "qr"; instance: string; qr: string };

const digitos = (s: string) => String(s || "").replace(/\D/g, "");
const isoDe = (t: any): string => { const n = Number(t); if (!isFinite(n) || n <= 0) return new Date().toISOString(); return new Date(n < 1e12 ? n * 1000 : n).toISOString(); };

/** Converte o corpo do webhook (Evolution ou Z-API) em um evento interno. Retorna null para o que deve ser ignorado. */
export function parsearWhatsApp(b: any): EventoWa | null {
  if (!b || typeof b !== "object") return null;
  const ev = String(b.event || "").toLowerCase().replace(/_/g, ".");
  const instance = String(b.instance || b.instanceName || b.instanceId || "");
  if (ev === "connection.update") { const s = String(b.data?.state || "").toLowerCase(); return { kind: "status", instance, estado: s === "open" ? "conectado" : s === "connecting" ? "aguardando" : "desconectado" }; }
  if (ev === "qrcode.updated") { const q = imagemQr(b.data); return q ? { kind: "qr", instance, qr: q } : null; }
  if (ev === "messages.upsert" && b.data) {
    const d = Array.isArray(b.data) ? b.data[0] : b.data, jid = String(d?.key?.remoteJid || "");
    if (!jid || jid.endsWith("@g.us") || jid.startsWith("status@")) return null;
    const m = d.message || {}, texto = String(m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || "").trim().slice(0, 1000);
    if (!texto) return null;
    return { kind: "message", instance, extId: String(d.key.id || ""), direcao: d.key.fromMe ? "out" : "in", contato: digitos(jid.split("@")[0]), nome: String(d.pushName || "").slice(0, 80), texto, ts: isoDe(d.messageTimestamp) };
  }
  if (b.type === "ReceivedCallback" && !b.isGroup) { // Z-API
    const texto = String(b.text?.message || "").trim().slice(0, 1000);
    if (!texto) return null;
    return { kind: "message", instance: String(b.instanceId || ""), extId: String(b.messageId || ""), direcao: b.fromMe ? "out" : "in", contato: digitos(b.phone), nome: String(b.senderName || b.chatName || "").slice(0, 80), texto, ts: isoDe(b.momment) };
  }
  return null;
}
