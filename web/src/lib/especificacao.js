// Especificação do produto gravada na gênese (contrato v2):
//   dimensaoNominal em micrômetros, massaLinear em g/m e tolerância em pontos-base.

const fmtDim = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 3 });
const fmtKgM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtPct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** "Bitola" para barras e fios (NBR 7480); "Espessura" para chapas e telhas. */
export function rotuloDimensao(norma = "") {
  if (/7480/.test(norma)) return "Bitola";
  if (/14513|14514|7008|11888|chapa|telha/i.test(norma)) return "Espessura";
  return "Dimensão nominal";
}

export const dimensaoTexto = (um) => `${fmtDim.format(Number(um) / 1000)} mm`;
export const massaLinearTexto = (gm) => `${fmtKgM.format(Number(gm) / 1000)} kg/m`;
export const toleranciaTexto = (pb) => `±${fmtPct.format(Number(pb) / 100)}%`;

/**
 * Massa linear nominal de barras e fios de seção circular, em g/m:
 * área × 7.850 kg/m³, como na ABNT NBR 7480 (10 mm → 617 g/m).
 */
export function massaLinearBitola(diametroMm) {
  const d = Number(diametroMm);
  if (!Number.isFinite(d) || d <= 0) return null;
  return Math.round((Math.PI / 4) * d * d * 7.85);
}

/** Tolerância de massa linear da ABNT NBR 7480 (edição de 2024), em %. */
export function toleranciaNbr7480(diametroMm) {
  const d = Number(diametroMm);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (d < 16) return 6;  // barras de 6,3 a 12,5 mm e fios CA-60 de 3,4 a 10 mm
  if (d < 22) return 5;  // 16 a 20 mm
  return 4;              // 22 a 40 mm
}

/** Faixa de massa aceita pelo contrato para um comprimento (mm), em gramas. */
export function faixaDeMassa(comprimentoMm, massaLinear, toleranciaPb) {
  const nominal = (Number(comprimentoMm) * Number(massaLinear)) / 1000;
  const t = Number(toleranciaPb) / 10000;
  return { nominal, min: nominal * (1 - t), max: nominal * (1 + t) };
}

/** Mesma conta do contrato (massaCompativel), em inteiros. */
export function massaCompativel(gramas, comprimentoMm, massaLinear, toleranciaPb) {
  const nominal = BigInt(comprimentoMm) * BigInt(massaLinear);
  const real = BigInt(gramas) * 1000n;
  const dif = real > nominal ? real - nominal : nominal - real;
  return dif * 10000n <= nominal * BigInt(toleranciaPb);
}
