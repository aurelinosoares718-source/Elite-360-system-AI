import { createHmac, timingSafeEqual } from "node:crypto";
import { header, type Req } from "./http";

export interface Usuario { id: string; email: string }

/**
 * Valida a sessão (JWT do Supabase Auth) e devolve o dono da conta.
 * O dono SEMPRE vem do token. Nunca aceite owner/e-mail enviado no corpo ou na URL.
 */
export async function usuarioDaSessao(req: Req): Promise<Usuario | null> {
  const m = /^Bearer\s+(.+)$/i.exec(header(req, "authorization"));
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, ""), key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || "";
  if (!m) return devUsuario(req);
  if (!url || !key) return null;
  try {
    const r = await fetch(url + "/auth/v1/user", { headers: { apikey: key, Authorization: "Bearer " + m[1] } });
    if (!r.ok) return null;
    const j: any = await r.json();
    return j && j.id && j.email ? { id: String(j.id), email: String(j.email).toLowerCase() } : null;
  } catch { return null; }
}

/** Apenas desenvolvimento local, sem Supabase: DEV_AUTH_OWNER + DEV_AUTH_EMAIL. Nunca vale em produção. */
function devUsuario(_req: Req): Usuario | null {
  if (process.env.NODE_ENV === "production" || process.env.SUPABASE_URL) return null;
  const id = process.env.DEV_AUTH_OWNER, email = process.env.DEV_AUTH_EMAIL;
  return id && email ? { id, email: email.toLowerCase() } : null;
}

const segredo = (): string => { const s = process.env.WEBHOOK_SECRET || ""; if (s.length < 16) throw new Error("WEBHOOK_SECRET ausente ou curto (mínimo 16 caracteres)"); return s; };
export const tokenWebhook = (owner: string): string => createHmac("sha256", segredo()).update("wh:" + owner).digest("hex").slice(0, 32);
export function tokenValido(owner: string, token: string): boolean {
  try { const a = Buffer.from(tokenWebhook(owner)), b = Buffer.from(String(token || "")); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; }
}
export const urlWebhook = (base: string, canal: "whatsapp" | "instagram", owner: string): string => `${base}/api/webhooks/${canal}?u=${encodeURIComponent(owner)}&t=${tokenWebhook(owner)}`;
export const donoValido = (s: string): boolean => /^[A-Za-z0-9_-]{8,64}$/.test(s);

/** Assinatura HMAC SHA-256 da Meta (X-Hub-Signature-256). */
export function assinaturaMetaValida(corpo: string, assinatura: string): boolean {
  const s = process.env.META_APP_SECRET || "";
  if (!s || !assinatura.startsWith("sha256=")) return false;
  const a = Buffer.from(createHmac("sha256", s).update(corpo).digest("hex")), b = Buffer.from(assinatura.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}
