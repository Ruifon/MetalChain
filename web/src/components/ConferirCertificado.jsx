import { useRef, useState } from "react";
import { contratoLeitura, mensagemErro } from "../lib/chain.js";
import { sha256Arquivo, sha256Buffer } from "../lib/formato.js";
import { IPFS_GATEWAY } from "../config.js";

/**
 * Confere a integridade do certificado de origem: calcula o SHA-256 do arquivo
 * no próprio navegador e pergunta ao contrato se ele coincide com o hash
 * gravado na gênese da bobina (função verificarCertificado).
 */
export default function ConferirCertificado({ bobinaId, hashRegistrado, cid }) {
  const [estado, setEstado] = useState(null); // { tipo, texto, hash }
  const [arrastando, setArrastando] = useState(false);
  const entrada = useRef(null);

  async function conferir(obterHash, origem) {
    setEstado({ tipo: "carregando", texto: `Calculando o hash ${origem}…` });
    try {
      const hash = await obterHash();
      const confere = await contratoLeitura().verificarCertificado(bobinaId, hash);
      setEstado(
        confere
          ? { tipo: "ok", texto: "O certificado é o mesmo registrado na gênese da bobina.", hash }
          : { tipo: "erro", texto: "Este arquivo não é o certificado registrado. Pode ter sido alterado ou ser de outra bobina.", hash }
      );
    } catch (e) {
      setEstado({ tipo: "erro", texto: mensagemErro(e) });
    }
  }

  const doArquivo = (arquivo) => arquivo && conferir(() => sha256Arquivo(arquivo), `de ${arquivo.name}`);

  const doIpfs = () =>
    conferir(async () => {
      const r = await fetch(IPFS_GATEWAY + cid);
      if (!r.ok) throw new Error("O arquivo não pôde ser baixado do IPFS agora. Tente enviar o arquivo manualmente.");
      return sha256Buffer(await r.arrayBuffer());
    }, "do arquivo no IPFS");

  return (
    <div className="cert">
      <dl className="campos campos-1">
        <div>
          <dt>Hash SHA-256 registrado</dt>
          <dd className="hash">{hashRegistrado}</dd>
        </div>
        {cid ? (
          <div>
            <dt>Arquivo no IPFS</dt>
            <dd>
              <a href={IPFS_GATEWAY + cid} target="_blank" rel="noreferrer" className="hash">{cid}</a>
            </dd>
          </div>
        ) : null}
      </dl>

      <div
        className={`soltar${arrastando ? " ativo" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); doArquivo(e.dataTransfer.files?.[0]); }}
      >
        <p>Tem o arquivo do certificado? Confira se ele é o original.</p>
        <div className="acoes">
          <button type="button" className="btn" onClick={() => entrada.current?.click()}>
            Escolher arquivo
          </button>
          {cid ? (
            <button type="button" className="btn btn-quieto" onClick={doIpfs}>
              Conferir o arquivo do IPFS
            </button>
          ) : null}
        </div>
        <input
          ref={entrada}
          type="file"
          hidden
          onChange={(e) => { doArquivo(e.target.files?.[0]); e.target.value = ""; }}
        />
        <p className="dica">O arquivo é lido só no seu aparelho; nada é enviado.</p>
      </div>

      {estado && (
        <div className={`aviso aviso-${estado.tipo}`} role="status">
          <p>{estado.texto}</p>
          {estado.hash && <p className="hash pequeno">Hash do arquivo: {estado.hash}</p>}
        </div>
      )}
    </div>
  );
}
