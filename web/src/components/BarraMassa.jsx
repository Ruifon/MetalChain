import { kg } from "../lib/formato.js";

/**
 * A bobina inteira em uma barra: cada segmento é uma parte da massa inicial.
 * Mostra visualmente a invariante do contrato:
 *   massa inicial = saldo + soma das peças.
 *
 * segmentos: [{ valor: bigint (gramas), tipo: "peca" | "outras" | "nova" | "saldo" | "excesso", rotulo }]
 */
export default function BarraMassa({ total, segmentos, legenda = true }) {
  const t = Number(total) || 1;
  const visiveis = segmentos.filter((s) => Number(s.valor) > 0);
  const resumo = visiveis.map((s) => `${s.rotulo}: ${kg(s.valor)}`).join("; ");

  return (
    <figure className="massa">
      <div className="massa-barra" role="img" aria-label={`Massa da bobina, ${kg(total)}. ${resumo}.`}>
        {visiveis.map((s, i) => (
          <span
            key={i}
            className={`seg seg-${s.tipo}`}
            style={{ flexGrow: Number(s.valor) / t, flexBasis: 0 }}
            title={`${s.rotulo}: ${kg(s.valor)}`}
          />
        ))}
      </div>
      {legenda && (
        <figcaption className="massa-legenda">
          {visiveis.map((s, i) => (
            <span key={i} className="leg">
              <i className={`amostra seg-${s.tipo}`} aria-hidden="true" />
              <span className="leg-rotulo">{s.rotulo}</span>
              <span className="leg-valor">{kg(s.valor)}</span>
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
