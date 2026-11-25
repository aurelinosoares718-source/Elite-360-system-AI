/**
 * Motor de Governança de Leads (Elite 360).
 * Classifica o lead (QUENTE, MORNO, FRIO) a partir do histórico e da última mensagem.
 * Regras locais respondem imediatamente. A análise por LLM é opcional (OPENAI_API_KEY)
 * e, em qualquer falha ou demora, o resultado das regras é usado.
 * Módulo puro: não lê variáveis de ambiente nem acessa banco.
 */
export type Temperatura = "QUENTE" | "MORNO" | "FRIO";

export interface MensagemLead {
  direcao: "in" | "out"; // in = cliente, out = atendimento
  texto: string;
  ts: string; // ISO 8601
  lida?: boolean; // mensagem enviada e visualizada pelo cliente
}

export interface EntradaMotor {
  nome?: string;
  servico?: string;
  canal?: string;
  historico: MensagemLead[];
  agora?: string | Date;
}

export interface Analise {
  temperatura: Temperatura;
  pontuacao: number;
  sinais: string[];
  diagnostico: string;
  mensagem: string;
  followUp: { rotulo: string; minutos: number };
  origem: "regras" | "llm";
}

export interface OpcoesMotor {
  openaiApiKey?: string;
  modelo?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const sem = (t: string): string => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const PADROES: Record<string, RegExp> = {
  preco: /\b(preco|precos|valor|valores|quanto (custa|fica|e|sai|cobra)|orcamento|investimento|tabela)\b/,
  disponibilidade: /\b(disponivel|disponibilidade|tem vaga|vagas|horario livre|tem horario|encaixe|pronta entrega|em estoque)\b/,
  agendamento: /\b(agendar|agendamento|marcar|marcacao|reservar|reserva|visita|consulta|reuniao)\b/,
  pagamento: /\b(pix|cartao|parcel\w*|boleto|forma(s)? de pagamento|a vista|financi\w*)\b/,
  urgencia: /\b(urgente|urgencia|o quanto antes|ainda hoje|para hoje|pra hoje|hoje|agora|rapido|preciso (pra|para|ate))\b/,
  decisao: /\b(quero (fechar|contratar|comprar|agendar|marcar|reservar)|vou querer|fechar|fechado|contratar|comprar|pode ser|topo)\b/,
  info: /\b(informacao|informacoes|detalhes|como funciona|saber mais|me explica|pode explicar|duvida|duvidas|tenho uma pergunta|qual a diferenca|o que inclui|inclui)\b/,
  hesitacao: /\b(vou pensar|depois|talvez|mais tarde|vou ver|vou comparar|comparar)\b/,
  desinteresse: /\b(sem interesse|nao tenho interesse|nao quero|cancel\w*|pare de|nao me chame)\b/,
};
const QUENTES = ["preco", "disponibilidade", "agendamento", "pagamento", "urgencia", "decisao"];
const MORNOS = ["info", "hesitacao"];
const SAUDACAO = /^(oi+|ola+|opa|e ai|bom dia|boa tarde|boa noite|tudo bem\??|tudo bom\??)[\s!.,?]*$/;

const ROTULOS: Record<string, string> = {
  preco: "perguntou sobre valor", disponibilidade: "perguntou sobre disponibilidade", agendamento: "falou em agendamento",
  pagamento: "perguntou sobre pagamento", urgencia: "demonstrou urgência", decisao: "sinalizou decisão de compra",
  info: "pediu informações ou tirou dúvidas", hesitacao: "demonstrou hesitação", desinteresse: "indicou pouco interesse", saudacao: "fez contato genérico",
};

export function sinaisDe(texto: string): string[] {
  const t = sem(texto).trim();
  const achados = Object.keys(PADROES).filter((k) => PADROES[k].test(t));
  if (SAUDACAO.test(t)) achados.push("saudacao");
  return achados;
}

const tempoTxt = (h: number): string => (!isFinite(h) ? "sem registro" : h < 1 ? "agora há pouco" : h < 48 ? "há " + Math.floor(h) + " h" : "há " + Math.floor(h / 24) + " dias");

function montarMensagem(tipo: string, nome?: string, servico?: string): string {
  const n = (nome || "").trim().split(/\s+/)[0] || "tudo bem";
  const sv = servico ? " sobre " + servico : "";
  switch (tipo) {
    case "preco": return `Oi, ${n}! Obrigado por perguntar${sv}. Para te passar a condição certa, preciso de um detalhe rápido: o que você pretende resolver? Com isso eu envio as opções e já te mostro como podemos começar ainda hoje.`;
    case "agenda": return `Oi, ${n}! Vamos encontrar o melhor horário para você${sv}. Consigo te oferecer duas opções: hoje mais tarde ou amanhã cedo. Qual fica melhor?`;
    case "pagamento": return `Oi, ${n}! Sobre o pagamento, podemos conversar sobre as formas disponíveis para ficar confortável para você. Quer que eu te explique as opções e já deixe tudo encaminhado?`;
    case "urgencia": return `Oi, ${n}! Entendi que é para logo. Vou priorizar o seu atendimento agora: me confirma rapidamente o que você precisa e eu já respondo com o próximo passo.`;
    case "decisao": return `Oi, ${n}! Que bom. Vamos seguir${sv}: posso te passar agora os próximos passos para deixar tudo combinado?`;
    case "info": return `Oi, ${n}! Claro, vou te explicar${sv} de forma objetiva. Qual é a sua principal dúvida hoje? Assim eu respondo exatamente o que importa para a sua decisão.`;
    case "visualizou": return `Oi, ${n}! Passando para saber se ficou alguma dúvida${sv}. Se fizer sentido, posso te ajudar a dar o próximo passo ainda hoje.`;
    case "hesitacao": return `Oi, ${n}! Sem pressa. Se ajudar, posso te explicar como funciona${sv} e tirar qualquer dúvida para você decidir com segurança.`;
    case "generico": return `Oi, ${n}! Tudo bem? Para eu te ajudar melhor${sv}: o que você está buscando neste momento?`;
    case "silencio": return `Oi, ${n}! Faz alguns dias que conversamos${sv}. Ainda faz sentido para você? Se preferir, me conta o que mudou e eu te ajudo com a melhor opção.`;
    case "desinteresse": return `Oi, ${n}! Sem problema, obrigado pelo retorno. Se algo mudar, fico à disposição por aqui.`;
    default: return `Oi, ${n}! Passando para dar sequência à nossa conversa${sv}. Como posso te ajudar?`;
  }
}

export function classificarPorRegras(e: EntradaMotor): Analise {
  const agora = new Date(e.agora ?? Date.now()).getTime();
  const h = (e.historico || []).filter((m) => m && typeof m.texto === "string" && !isNaN(Date.parse(m.ts))).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const entradas = h.filter((m) => m.direcao === "in");
  const ultimaIn = entradas[entradas.length - 1], ultima = h[h.length - 1];
  const horas = ultima ? Math.max(0, (agora - Date.parse(ultima.ts)) / 36e5) : Infinity;
  const sp = ultimaIn ? sinaisDe(ultimaIn.texto) : [];
  const ss = entradas.slice(-6, -1).flatMap((m) => sinaisDe(m.texto));
  const qP = sp.filter((s) => QUENTES.includes(s)), qS = ss.filter((s) => QUENTES.includes(s));
  const mP = sp.filter((s) => MORNOS.includes(s)), mS = ss.filter((s) => MORNOS.includes(s));
  const visualizou = !!ultima && ultima.direcao === "out" && ultima.lida === true && entradas.length > 0 && horas >= 1;
  const pontuacao = qP.length * 3 + qS.length + mP.length * 2 + mS.length - (sp.includes("desinteresse") ? 4 : 0) - (horas > 72 ? 5 : 0);

  let temperatura: Temperatura, tipoMsg: string, motivo: string, prazo: { rotulo: string; minutos: number };
  if (sp.includes("desinteresse")) {
    temperatura = "FRIO"; tipoMsg = "desinteresse"; motivo = ROTULOS.desinteresse; prazo = { rotulo: "Retomar em cerca de 15 dias, sem insistir", minutos: 21600 };
  } else if (ultima && horas > 72) {
    temperatura = "FRIO"; tipoMsg = "silencio"; motivo = "sem resposta há mais de 72 horas"; prazo = { rotulo: "Resgate em até 48 horas, com mensagem leve", minutos: 2880 };
  } else if (qP.length > 0 || (qS.length > 0 && horas <= 24)) {
    temperatura = "QUENTE";
    const k = qP[0] || qS[0];
    tipoMsg = (sp.includes("urgencia") ? "urgencia" : k === "disponibilidade" || k === "agendamento" ? "agenda" : k) as string;
    motivo = (qP.length ? qP : qS).map((s) => ROTULOS[s]).join(", ");
    prazo = sp.includes("urgencia") ? { rotulo: "Responder em até 15 minutos", minutos: 15 } : { rotulo: "Responder em até 1 hora", minutos: 60 };
  } else if (mP.length > 0 || mS.length > 0 || visualizou) {
    temperatura = "MORNO"; tipoMsg = visualizou && !mP.length ? "visualizou" : mP.includes("hesitacao") ? "hesitacao" : "info";
    motivo = visualizou && !mP.length ? "visualizou a mensagem, mas ainda não avançou" : (mP.length ? mP : mS).map((s) => ROTULOS[s]).join(", ");
    prazo = { rotulo: "Responder hoje, em até 4 horas", minutos: 240 };
  } else if (!ultimaIn || (sp.length === 1 && sp[0] === "saudacao") || sp.length === 0 && horas > 24) {
    temperatura = "FRIO"; tipoMsg = "generico"; motivo = ultimaIn ? ROTULOS.saudacao : "sem mensagem do cliente registrada"; prazo = { rotulo: "Qualificar em até 24 horas", minutos: 1440 };
  } else {
    temperatura = "MORNO"; tipoMsg = "info"; motivo = "enviou mensagem recente sem sinal claro de decisão"; prazo = { rotulo: "Responder hoje, em até 4 horas", minutos: 240 };
  }
  const diagnostico = `${temperatura === "QUENTE" ? "Lead quente" : temperatura === "MORNO" ? "Lead morno" : "Lead frio"}: ${motivo}. Último registro ${tempoTxt(horas)}.`;
  return { temperatura, pontuacao, sinais: Array.from(new Set([...sp, ...(visualizou ? ["visualizou"] : [])])), diagnostico, mensagem: montarMensagem(tipoMsg, e.nome, e.servico), followUp: prazo, origem: "regras" };
}

const SEM_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

async function refinarComLLM(e: EntradaMotor, base: Analise, o: OpcoesMotor): Promise<Analise | null> {
  const f = o.fetchImpl ?? fetch, ctl = new AbortController(), t = setTimeout(() => ctl.abort(), o.timeoutMs ?? 3500);
  try {
    const hist = (e.historico || []).slice(-8).map((m) => ({ de: m.direcao === "in" ? "cliente" : "atendimento", texto: String(m.texto || "").slice(0, 500), ts: m.ts, lida: m.lida === true }));
    const r = await f("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + o.openaiApiKey },
      body: JSON.stringify({
        model: o.modelo || "gpt-4o-mini", temperature: 0.3, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Você é analista comercial. Classifique o lead como QUENTE (perguntou preço, disponibilidade, agendamento, pagamento ou demonstrou urgência), MORNO (pediu informações, tirou dúvidas, visualizou mas não avançou) ou FRIO (contato genérico ou sem resposta há mais de 72 horas). Escreva a mensagem em português, natural e persuasiva, sem emojis, sem citar valores e sem prometer resultados. Responda somente JSON: {\"temperatura\":\"QUENTE|MORNO|FRIO\",\"diagnostico\":\"...\",\"mensagem\":\"...\",\"followUpMinutos\":numero}." },
          { role: "user", content: JSON.stringify({ lead: { nome: e.nome || "", servico: e.servico || "", canal: e.canal || "" }, agora: new Date(e.agora ?? Date.now()).toISOString(), historico: hist, classificacaoPorRegras: base.temperatura }) },
        ],
      }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const p = JSON.parse(j?.choices?.[0]?.message?.content || "{}");
    const temp = String(p.temperatura || "").toUpperCase();
    const min = Number(p.followUpMinutos);
    if (!["QUENTE", "MORNO", "FRIO"].includes(temp) || typeof p.mensagem !== "string" || typeof p.diagnostico !== "string" || !isFinite(min)) return null;
    const minutos = Math.min(43200, Math.max(5, Math.round(min)));
    return { ...base, temperatura: temp as Temperatura, diagnostico: p.diagnostico.slice(0, 300), mensagem: String(p.mensagem).replace(SEM_EMOJI, "").slice(0, 600), followUp: { rotulo: minutos < 120 ? "Responder em até " + minutos + " minutos" : minutos < 2880 ? "Responder em até " + Math.round(minutos / 60) + " horas" : "Retomar em até " + Math.round(minutos / 1440) + " dias", minutos }, origem: "llm" };
  } catch { return null; } finally { clearTimeout(t); }
}

/** Resultado imediato por regras; com OPENAI_API_KEY tenta refinar e volta às regras em qualquer falha. */
export async function analisarLead(e: EntradaMotor, o: OpcoesMotor = {}): Promise<Analise> {
  const base = classificarPorRegras(e);
  if (!o.openaiApiKey) return base;
  return (await refinarComLLM(e, base, o)) ?? base;
}
