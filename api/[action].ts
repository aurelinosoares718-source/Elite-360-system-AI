/** /api/whatsapp/status | connect | disconnect | events. Sempre autenticado: o dono vem do JWT. */
import { cors, baseUrlPublica, param, type Req, type Res } from "../../lib/server/http";
import { usuarioDaSessao, urlWebhook } from "../../lib/server/auth";
import { getStore } from "../../lib/server/store";
import { nomeInstancia, garantirInstancia, gerarQr, estado, sair } from "../../lib/server/wa";

export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  const u = await usuarioDaSessao(req);
  if (!u) return res.status(401).json({ error: "sessão inválida" });
  const st = getStore(), acao = param(req, "action");
  try {
    if (acao === "events" && req.method === "GET") {
      const since = Number(param(req, "since")) || 0, ev = await st.listarEventos(u.id, since, 100);
      const entrada = ev.filter((e) => e.direcao === "in").map((e) => ({ type: "message", channel: e.canal, name: e.nome, contact: e.contato, text: e.texto, timestamp: e.ts, temperature: e.temperatura }));
      return res.status(200).json({ events: entrada, cursor: ev.length ? ev[ev.length - 1].seq : since });
    }
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
    const webhookUrl = urlWebhook(baseUrlPublica(req), "whatsapp", u.id);
    const salva = await st.obterInstancia(u.id), instance = salva ? salva.instance : nomeInstancia(u.id);
    if (acao === "connect" && req.method === "POST") {
      await garantirInstancia(instance, webhookUrl);
      const qr = await gerarQr(instance);
      await st.salvarInstancia({ owner: u.id, instance, status: "aguardando", qr });
      return res.status(200).json({ status: "aguardando", qr, webhookUrl });
    }
    if (acao === "disconnect" && req.method === "POST") {
      await sair(instance).catch(() => {});
      await st.salvarInstancia({ owner: u.id, instance, status: "desconectado", qr: null });
      return res.status(200).json({ status: "desconectado", webhookUrl });
    }
    if (acao === "status") {
      let s: string = salva ? salva.status : "desconectado";
      if (salva) {
        try { s = await estado(instance); } catch { /* mantém o último estado salvo */ }
        // Logo após gerar o QR o provedor ainda pode responder "close". Mantém "aguardando" por 2 minutos.
        if (s === "desconectado" && salva.status === "aguardando" && salva.updated_at && Date.now() - Date.parse(salva.updated_at) < 120000) s = "aguardando";
      }
      const qr = s === "aguardando" && salva ? salva.qr : null;
      if (salva && s !== salva.status) await st.salvarInstancia({ owner: u.id, instance, status: s, qr });
      return res.status(200).json({ status: s, qr, webhookUrl });
    }
    return res.status(404).json({ error: "ação desconhecida" });
  } catch {
    return res.status(502).json({ error: "falha na integração" });
  }
}
