import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import BarraMassa from "../components/BarraMassa.jsx";
import ConferirCertificado from "../components/ConferirCertificado.jsx";
import { buscarGenealogia, linkEndereco, linkTx, localizarTransacaoDaPeca, mensagemErro } from "../lib/chain.js";
import { abreviar, dataHora, kg, metros } from "../lib/formato.js";
import { CONTRATO, REDE_NOME } from "../config.js";

export default function Peca() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const txInformada = params.get("tx");
  const [estado, setEstado] = useState({ carregando: true });

  useEffect(() => {
    let vivo = true;
    setEstado({ carregando: true });
    if (!/^\d+$/.test(id) || id === "0") {
      setEstado({ erro: "O número da peça deve ser um número inteiro maior que zero." });
      return;
    }
    (async () => {
      try {
        const g = await buscarGenealogia(id);
        if (!vivo) return;
        setEstado({ ...g });
        const tx = await localizarTransacaoDaPeca(id, txInformada);
        if (vivo) setEstado((s) => ({ ...s, tx }));
      } catch (e) {
        if (vivo) setEstado({ erro: mensagemErro(e) });
      }
    })();
    return () => { vivo = false; };
  }, [id, txInformada]);

  useEffect(() => {
    document.title = `Peça nº ${id} · MetalChain`;
    return () => { document.title = "MetalChain"; };
  }, [id]);

  if (estado.carregando) {
    return (
      <main className="pagina">
        <p className="carregando" role="status">Consultando a peça nº {id} na rede {REDE_NOME}…</p>
      </main>
    );
  }

  if (estado.erro) {
    return (
      <main className="pagina">
        <h1 className="titulo">Peça nº {id}</h1>
        <div className="aviso aviso-erro" role="alert"><p>{estado.erro}</p></div>
        <p><Link to="/">Consultar outra peça</Link></p>
      </main>
    );
  }

  const { peca, bobina, industriaPeca, industriaBobina, tx } = estado;
  const outras = bobina.massaInicial - bobina.saldo - peca.massa;

  return (
    <main className="pagina">
      <section className="peca-topo" aria-labelledby="peca-titulo">
        <h1 id="peca-titulo" className="peca-num">Peça nº {peca.id.toString()}</h1>
        <p className="peca-desc">{peca.descricao || "Sem descrição"}</p>
        <dl className="medidas">
          <div><dt>Massa</dt><dd>{kg(peca.massa)}</dd></div>
          {peca.comprimento > 0n && <div><dt>Comprimento</dt><dd>{metros(peca.comprimento)}</dd></div>}
          <div><dt>Registrada em</dt><dd>{dataHora(peca.registradoEm)}</dd></div>
          <div><dt>Por</dt><dd>{industriaPeca || abreviar(peca.operador)}</dd></div>
        </dl>
      </section>

      <div className="selo" role="note">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
        <p>
          <strong>Origem rastreada até a bobina {bobina.id}.</strong> Os dados desta página vêm
          diretamente do contrato na rede {REDE_NOME} e não podem ser alterados depois de gravados,
          nem pela própria indústria.
        </p>
      </div>

      <section className="bloco" aria-labelledby="bobina-titulo">
        <h2 id="bobina-titulo">Bobina de origem</h2>
        <p className="bobina-id">{bobina.id}</p>
        <BarraMassa
          total={bobina.massaInicial}
          segmentos={[
            { valor: peca.massa, tipo: "peca", rotulo: "Esta peça" },
            { valor: outras, tipo: "outras", rotulo: "Outras peças da bobina" },
            { valor: bobina.saldo, tipo: "saldo", rotulo: "Ainda não usado" },
          ]}
        />
        <p className="explica">
          Cada peça registrada dá baixa na massa da bobina. A soma das peças nunca passa
          dos {kg(bobina.massaInicial)} registrados na entrada, por isso o certificado desta
          bobina não pode ser usado para aço que não veio dela.
        </p>
        <dl className="campos">
          <div><dt>Lote ou corrida</dt><dd>{bobina.lote || "Não informado"}</dd></div>
          <div><dt>Norma</dt><dd>{bobina.norma || "Não informada"}</dd></div>
          <div><dt>Grau</dt><dd>{bobina.grau || "Não informado"}</dd></div>
          <div><dt>Certificado de conformidade</dt><dd>{bobina.certConformidade || "Não se aplica"}</dd></div>
          <div><dt>Entrada registrada por</dt><dd>{industriaBobina || abreviar(bobina.operador)}</dd></div>
          <div><dt>Entrada em</dt><dd>{dataHora(bobina.registradoEm)}</dd></div>
        </dl>
      </section>

      <section className="bloco" aria-labelledby="cert-titulo">
        <h2 id="cert-titulo">Certificado de origem</h2>
        <p className="explica">
          O certificado emitido pela usina fica guardado fora da blockchain. Na entrada da
          bobina, foi gravado o seu hash, uma impressão digital que muda se qualquer
          caractere do arquivo for alterado.
        </p>
        <ConferirCertificado bobinaId={bobina.id} hashRegistrado={bobina.hashCertificado} cid={bobina.cidCertificado} />
      </section>

      <section className="bloco" aria-labelledby="registro-titulo">
        <h2 id="registro-titulo">Registro público</h2>
        <p className="explica">Qualquer pessoa pode conferir estes registros no explorador de blocos, sem depender da indústria.</p>
        <ul className="links">
          {linkTx(tx) && (
            <li><a href={linkTx(tx)} target="_blank" rel="noreferrer">Transação que registrou esta peça</a> <span className="hash pequeno">{abreviar(tx, 10, 6)}</span></li>
          )}
          {linkEndereco(CONTRATO) && (
            <li><a href={linkEndereco(CONTRATO)} target="_blank" rel="noreferrer">Contrato MetalChain e todas as suas transações</a> <span className="hash pequeno">{abreviar(CONTRATO, 10, 6)}</span></li>
          )}
          {linkEndereco(peca.operador) && (
            <li><a href={linkEndereco(peca.operador)} target="_blank" rel="noreferrer">Carteira de quem registrou a peça</a> <span className="hash pequeno">{abreviar(peca.operador, 10, 6)}</span></li>
          )}
        </ul>
      </section>

      <p className="limite">
        O MetalChain garante o vínculo entre esta peça e o certificado da bobina de origem.
        A qualidade do aço continua sendo atestada pelos ensaios e pelo certificado da usina.
      </p>
    </main>
  );
}
