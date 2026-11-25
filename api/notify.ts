/**
 * POST /api/notify
 *  - Com sessão (Bearer JWT): atua apenas na própria conta.
 *      { action: "set_manager", phone }  salva o WhatsApp do gestor
 *      { action: "test" }                envia um alerta de teste
 *      { action: "scan" }                verifica atrasos de atendimento da conta
 *  - Agendador: GET/POST ?action=scan_all com "Authorization: Bearer <CRON_SECRET>" (formato do Vercel Cron)
 *    ou cabeçalho x-cron-secret. Verifica todas as contas conectadas.
 * Alertas de Lead Quente são disparados pelos webhooks, usando a mesma função notificarGestor.
 */
import { cors, header, param, type Req, type Res } from "../lib/server/http";
import { usuarioDaSessao } from "../lib/server/auth";
import { getStore } from "../lib/server/store";
import { notificarGestor, verificarAtrasos } from "../lib/server/notify";
import { timingSafeEqual } from "node:crypto";

const igual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "método não permitido" });
  const acao = String(req.body?.action || param(req, "action") || ""), cron = process.env.CRON_SECRET || "";
  if (req.method === "GET" && acao !== "scan_all") return res.status(405).json({ error: "método não permitido" });
  try {
    if (acao === "scan_all") {
      const enviado = header(req, "x-cron-secret") || header(req, "authorization").replace(/^Bearer\s+/i, "");
      if (!cron || !enviado || !igual(enviado, cron)) return res.status(401).json({ error: "não autorizado" });
      let total = 0; for (const o of await getStore().donosConectados()) total += await verificarAtrasos(o);
      return res.status(200).json({ ok: true, alertas: total });
    }
    const u = await usuarioDaSessao(req);
    if (!u) return res.status(401).json({ error: "sessão inválida" });
    if (acao === "set_manager") { const tel = String(req.body?.phone || "").replace(/\D/g, ""); if (tel.length < 10 || tel.length > 15) return res.status(400).json({ error: "número inválido" }); await getStore().salvarGestor(u.id, tel); return res.status(200).json({ ok: true }); }
    if (acao === "test") return res.status(200).json({ ok: await notificarGestor(u.id, "Teste de alerta do Elite 360: as notificações estão funcionando.") });
    if (acao === "scan") return res.status(200).json({ ok: true, alertas: await verificarAtrasos(u.id) });
    return res.status(400).json({ error: "ação desconhecida" });
  } catch {
    return res.status(500).json({ error: "falha ao processar" });
  }
}
