/**
 * Instagram (Meta): GET = verificação do webhook; POST = directs e comentários.
 * - Verificação: IG_VERIFY_TOKEN.
 * - POST: valida X-Hub-Signature-256 com META_APP_SECRET (exige corpo bruto: bodyParser desativado abaixo).
 * - Dono: resolvido por entry.id (conta do Instagram) na tabela elite_wh_ig_accounts. Sem vínculo, o evento é descartado.
 *   O vínculo conta -> usuário deve ser criado por fluxo OAuth da Meta ou pelo administrador.
 */
import { cors, corpoBruto, header, param, type Req, type Res } from "../../lib/server/http";
import { assinaturaMetaValida } from "../../lib/server/auth";
import { getStore } from "../../lib/server/store";
import { notificarGestor } from "../../lib/server/notify";
import { analisarLead } from "../../lib/governance-engine";

export const config = { api: { bodyParser: false } };

export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  if (req.method === "GET") {
    const ok = param(req, "hub.mode") === "subscribe" && !!process.env.IG_VERIFY_TOKEN && param(req, "hub.verify_token") === process.env.IG_VERIFY_TOKEN;
    return ok ? res.status(200).send(param(req, "hub.challenge")) : res.status(403).json({ error: "verificação negada" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "método não permitido" });
  try {
    const bruto = await corpoBruto(req);
    if (!assinaturaMetaValida(bruto, header(req, "x-hub-signature-256"))) return res.status(401).json({ error: "assinatura inválida" });
    const corpo = JSON.parse(bruto), st = getStore();
    for (const entry of Array.isArray(corpo.entry) ? corpo.entry : []) {
      const owner = await st.donoInstagram(String(entry.id || ""));
      if (!owner) continue;
      const itens: { tipo: string; direcao: "in" | "out"; contato: string; nome: string; texto: string; ts: string; extId: string }[] = [];
      for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
        const texto = String(m.message?.text || "").trim().slice(0, 1000); if (!texto) continue;
        const eco = !!m.message?.is_echo;
        itens.push({ tipo: "message", direcao: eco ? "out" : "in", contato: String(eco ? m.recipient?.id : m.sender?.id || ""), nome: "", texto, ts: new Date(Number(m.timestamp) || Date.now()).toISOString(), extId: "ig:" + String(m.message?.mid || "") });
      }
      for (const c of Array.isArray(entry.changes) ? entry.changes : []) {
        if (c.field !== "comments" || !c.value) continue;
        const texto = String(c.value.text || "").trim().slice(0, 1000); if (!texto) continue;
        itens.push({ tipo: "comment", direcao: "in", contato: String(c.value.from?.id || ""), nome: String(c.value.from?.username || "").slice(0, 80), texto, ts: new Date().toISOString(), extId: "ig:c:" + String(c.value.id || "") });
      }
      for (const it of itens) {
        if (!it.contato) continue;
        let temperatura: string | undefined;
        if (it.direcao === "in") {
          const hist = await st.historico(owner, "instagram", it.contato, 8);
          const a = await analisarLead({ nome: it.nome, canal: "instagram", agora: it.ts, historico: [...hist.map((h) => ({ direcao: h.direcao as "in" | "out", texto: h.texto, ts: h.ts })), { direcao: "in", texto: it.texto, ts: it.ts }] }, { openaiApiKey: process.env.OPENAI_API_KEY, modelo: process.env.OPENAI_MODEL });
          temperatura = a.temperatura;
          if (temperatura === "QUENTE") {
            const chave = "hot:instagram:" + it.contato + ":" + it.ts.slice(0, 13);
            if (!(await st.jaAlertado(owner, chave)) && (await notificarGestor(owner, `Lead quente no Instagram (${it.tipo === "comment" ? "comentário" : "direct"}): ${it.nome || it.contato}. ${a.diagnostico} Prazo: ${a.followUp.rotulo}.`))) await st.marcarAlerta(owner, chave);
          }
        }
        await st.salvarEvento({ owner, canal: "instagram", tipo: it.tipo, direcao: it.direcao, nome: it.nome, contato: it.contato, texto: it.texto, ts: it.ts, extId: it.extId, temperatura });
      }
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "falha ao processar" });
  }
}
