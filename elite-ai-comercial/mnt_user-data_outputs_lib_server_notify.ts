/**
 * Alertas ao WhatsApp do gestor por endpoint configurável.
 * NOTIFY_API_URL: URL completa de envio de texto. Aceita o marcador {instance}.
 *   Exemplo Evolution: https://SEU-HOST/message/sendText/{instance}
 * NOTIFY_API_KEY: enviada no cabeçalho apikey. Corpo enviado: { number, text }.
 * Destino: número do gestor salvo na conta do usuário (elite_wh_settings) ou NOTIFY_TO.
 */
import { getStore } from "./store";

export async function notificarGestor(owner: string, texto: string): Promise<boolean> {
  const url = process.env.NOTIFY_API_URL || "";
  if (!url) return false;
  const st = getStore(), inst = await st.obterInstancia(owner);
  const numero = ((await st.obterGestor(owner)) || process.env.NOTIFY_TO || "").replace(/\D/g, "");
  if (!numero) return false;
  try {
    const r = await fetch(url.replace("{instance}", encodeURIComponent((inst && inst.instance) || process.env.NOTIFY_INSTANCE || "")), {
      method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.NOTIFY_API_KEY || "" }, body: JSON.stringify({ number: numero, text: texto.slice(0, 1500) }),
    });
    return r.ok;
  } catch { return false; }
}

/** Atrasos: o cliente falou por último, a resposta passou do limite e ainda não houve alerta para essa mensagem. */
export async function verificarAtrasos(owner: string): Promise<number> {
  const st = getStore(), limite = Math.max(5, Number(process.env.NOTIFY_DELAY_MINUTES) || 30) * 60000, agora = Date.now();
  const ev = await st.recentes(owner, new Date(agora - 24 * 3600000).toISOString());
  const ultimo = new Map<string, (typeof ev)[number]>();
  ev.filter((e) => e.tipo === "message").forEach((e) => ultimo.set(e.canal + "|" + e.contato, e));
  let n = 0;
  for (const e of ultimo.values()) {
    if (e.direcao !== "in" || agora - Date.parse(e.ts) < limite) continue;
    const chave = "delay:" + e.canal + ":" + e.contato + ":" + e.ts;
    if (await st.jaAlertado(owner, chave)) continue;
    const min = Math.round((agora - Date.parse(e.ts)) / 60000);
    if (await notificarGestor(owner, `Atraso no atendimento: ${e.nome || e.contato} (${e.canal}) aguarda resposta há ${min} min.`)) { await st.marcarAlerta(owner, chave); n++; }
  }
  return n;
}
