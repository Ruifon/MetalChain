// Massas são gravadas em gramas e comprimentos em milímetros (Seção 4.4 do TCC).

const kgFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const mFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const dataFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export const kgNumero = (gramas) => kgFmt.format(Number(gramas) / 1000);
export const kg = (gramas) => `${kgNumero(gramas)} kg`;
export const metros = (mm) => `${mFmt.format(Number(mm) / 1000)} m`;
export const dataHora = (ts) => dataFmt.format(new Date(Number(ts) * 1000));

/** "1500,5" ou "1500.5" (kg) -> 1500500n (gramas). Retorna null se inválido. */
export function kgParaGramas(texto) {
  const n = Number(String(texto).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return BigInt(Math.round(n * 1000));
}

/** "12" ou "12,5" (m) -> milímetros. Retorna null se inválido. */
export function metrosParaMm(texto) {
  if (String(texto).trim() === "") return 0n;
  const n = Number(String(texto).trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.round(n * 1000));
}

export const abreviar = (h, ini = 6, fim = 4) => (h ? `${h.slice(0, ini)}…${h.slice(-fim)}` : "");

/** SHA-256 de um arquivo, no formato bytes32 usado pelo contrato. */
export async function sha256Arquivo(arquivo) {
  const buf = await arquivo.arrayBuffer();
  return sha256Buffer(buf);
}

export async function sha256Buffer(buf) {
  const dig = await crypto.subtle.digest("SHA-256", buf);
  return "0x" + [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
