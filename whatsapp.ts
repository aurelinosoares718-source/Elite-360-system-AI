/**
 * POST /api/webhooks/whatsapp?u=<dono>&t=<token>
 * O token é HMAC(WEBHOOK_SECRET, dono): só quem recebeu a URL exclusiva consegue gravar eventos nesse dono.
 * O evento é sempre gravado para o dono da URL e nunca para um dono informado no corpo.
 */
import { cors, param, type Req, type Res } from "../../lib/server/http";
import { tokenValido, donoValido } from "../../lib/server/auth";
import { getStore } from "../../lib/server/store";
import { parsearWhatsApp } from "../../lib/server/wa";
import { notificarGestor } from "../../lib/server/notify";
import { analisarLead } from "../../lib/governance-engine";

export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  const owner = param(req, "u"), token = param(req, "t");
  if (!donoValido(owner) || !tokenValido(owner, token)) return res.status(401).json({ error: "não autorizado" });
  try {
    const st = getStore(), ev = parsearWhatsApp(req.body);
    if (!ev) return res.status(200).json({ ok: true, ignorado: true });
    const inst = await st.obterInstancia(owner);
    if (ev.instance && inst && inst.instance && ev.instance !== inst.instance) return res.status(403).json({ error: "instância não pertence a esta conta" });
    if (ev.kind === "status") { await st.salvarInstancia({ owner, instance: (inst && inst.instance) || ev.instance, status: ev.estado, qr: ev.estado === "aguardando" ? (inst && inst.qr) || null : null }); return res.status(200).json({ ok: true }); }
    if (ev.kind === "qr") { await st.salvarInstancia({ owner, instance: (inst && inst.instance) || ev.instance, status: "aguardando", qr: ev.qr }); return res.status(200).json({ ok: true }); }

    let temperatura: string | undefined;
    if (ev.direcao === "in") {
      const hist = await st.historico(owner, "whatsapp", ev.contato, 8);
      const analise = await analisarLead({ nome: ev.nome, canal: "whatsapp", agora: ev.ts, historico: [...hist.map((h) => ({ direcao: h.direcao as "in" | "out", texto: h.texto, ts: h.ts })), { direcao: "in", texto: ev.texto, ts: ev.ts }] }, { openaiApiKey: process.env.OPENAI_API_KEY, modelo: process.env.OPENAI_MODEL });
      temperatura = analise.temperatura;
      await st.salvarEvento({ owner, canal: "whatsapp", tipo: "message", direcao: "in", nome: ev.nome, contato: ev.contato, texto: ev.texto, ts: ev.ts, extId: ev.extId, temperatura });
      if (temperatura === "QUENTE") {
        const chave = "hot:whatsapp:" + ev.contato + ":" + ev.ts.slice(0, 13);
        if (!(await st.jaAlertado(owner, chave)) && (await notificarGestor(owner, `Lead quente no WhatsApp: ${ev.nome || ev.contato}. ${analise.diagnostico} Prazo: ${analise.followUp.rotulo}.`))) await st.marcarAlerta(owner, chave);
      }
    } else {
      await st.salvarEvento({ owner, canal: "whatsapp", tipo: "message", direcao: "out", nome: ev.nome, contato: ev.contato, texto: ev.texto, ts: ev.ts, extId: ev.extId });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "falha ao processar" });
  }
}
