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
    const webhookUrl = urlWebhook(baseUrlPublica(req), "whatsapp", u.id);
    if (acao === "events" && req.method === "GET") {
      const since = Number(param(req, "since")) || 0, ev = await st.listarEventos(u.id, since, 100);
      const entrada = ev.filter((e) => e.direcao === "in").map((e) => ({ type: "message", channel: e.canal, name: e.nome, contact: e.contato, text: e.texto, timestamp: e.ts, temperature: e.temperatura }));
      return res.status(200).json({ events: entrada, cursor: ev.length ? ev[ev.length - 1].seq : since });
    }
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
    const inst = (await st.obterInstancia(u.id)) || { owner: u.id, instance: nomeInstancia(u.id), status: "desconectado", qr: null };
    if (acao === "connect" && req.method === "POST") {
      await garantirInstancia(inst.instance, webhookUrl);
      const qr = await gerarQr(inst.instance);
      await st.salvarInstancia({ owner: u.id, instance: inst.instance, status: "aguardando", qr });
      return res.status(200).json({ status: "aguardando", qr, webhookUrl });
    }
    if (acao === "disconnect" && req.method === "POST") {
      await sair(inst.instance).catch(() => {});
      await st.salvarInstancia({ owner: u.id, instance: inst.instance, status: "desconectado", qr: null });
      return res.status(200).json({ status: "desconectado", webhookUrl });
    }
    if (acao === "status") {
      let s = inst.status as string;
      if (await st.obterInstancia(u.id)) { try { s = await estado(inst.instance); } catch { /* mantém o último estado salvo */ } }
      const qr = s === "aguardando" ? inst.qr : null;
      if (s !== inst.status) await st.salvarInstancia({ owner: u.id, instance: inst.instance, status: s, qr });
      return res.status(200).json({ status: s, qr, webhookUrl });
    }
    return res.status(404).json({ error: "ação desconhecida" });
  } catch (e: any) {
    return res.status(502).json({ error: "falha na integração" });
  }
}
