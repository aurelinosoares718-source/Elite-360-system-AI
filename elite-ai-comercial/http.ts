/** Utilitários HTTP mínimos, sem dependências (compatíveis com funções Node de /api). */
export interface Req { method?: string; headers: Record<string, string | string[] | undefined>; query: Record<string, string | string[] | undefined>; body?: any; on?: (ev: string, cb: (...a: any[]) => void) => void; }
export interface Res { status(n: number): Res; json(o: unknown): void; setHeader(k: string, v: string): void; send(b: unknown): void; end(): void; }

export const header = (req: Req, nome: string): string => { const v = req.headers[nome.toLowerCase()]; return Array.isArray(v) ? v[0] || "" : v || ""; };
export const param = (req: Req, nome: string): string => { const v = req.query?.[nome]; return Array.isArray(v) ? v[0] || "" : v || ""; };

/** CORS opcional: só libera a origem definida em ALLOWED_ORIGIN. Retorna true se já respondeu (OPTIONS). */
export function cors(req: Req, res: Res): boolean {
  const o = process.env.ALLOWED_ORIGIN;
  if (o && header(req, "origin") === o) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

/** Corpo bruto para validar assinatura. Exige bodyParser desativado na rota (veja config nas rotas). */
export async function corpoBruto(req: Req): Promise<string> {
  const b = req.body;
  if (typeof b === "string") return b;
  if (b instanceof Uint8Array) return Buffer.from(b).toString("utf8");
  if (b && typeof b === "object") return JSON.stringify(b); // já interpretado: a assinatura tende a falhar (falha fechada)
  return await new Promise<string>((ok, no) => {
    const partes: Buffer[] = []; let n = 0;
    req.on!("data", (c: Buffer) => { n += c.length; if (n > 1_000_000) no(new Error("corpo grande")); else partes.push(Buffer.from(c)); });
    req.on!("end", () => ok(Buffer.concat(partes).toString("utf8")));
    req.on!("error", no);
  });
}

export const baseUrlPublica = (req: Req): string => {
  const env = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  const host = header(req, "x-forwarded-host") || header(req, "host");
  return host ? (header(req, "x-forwarded-proto") || "https") + "://" + host : "";
};
