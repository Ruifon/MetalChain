import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Inicio() {
  const [numero, setNumero] = useState("");
  const navegar = useNavigate();
  const valido = /^\d+$/.test(numero.trim()) && numero.trim() !== "0";

  return (
    <main className="pagina pagina-larga inicio">
      <div className="inicio-grade">
      <section className="inicio-topo">
        <h1 className="titulo-grande">De onde veio este aço?</h1>
        <p className="lead">
          Escaneie o QR Code da etiqueta ou digite o número da peça para ver a bobina que lhe
          deu origem e conferir o certificado da usina.
        </p>
        <form
          className="busca"
          onSubmit={(e) => { e.preventDefault(); if (valido) navegar(`/peca/${numero.trim()}`); }}
        >
          <label htmlFor="numero">Número da peça</label>
          <div className="busca-linha">
            <input
              id="numero"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Ex.: 1"
              value={numero}
              onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
            />
            <button className="btn btn-forte" type="submit" disabled={!valido}>Consultar</button>
          </div>
        </form>
      </section>

      <section className="bloco" aria-labelledby="como-titulo">
        <h2 id="como-titulo">Como a origem é garantida</h2>
        <ol className="passos">
          <li>
            <strong>A usina certifica a bobina.</strong> O certificado de origem acompanha a
            bobina até a indústria de transformação.
          </li>
          <li>
            <strong>A indústria registra a bobina na blockchain</strong>, com a massa e o hash do
            certificado. Só carteiras credenciadas podem gravar.
          </li>
          <li>
            <strong>Cada peça cortada dá baixa na massa da bobina.</strong> O contrato recusa
            qualquer peça que ultrapasse o saldo.
          </li>
          <li>
            <strong>Você escaneia o QR Code</strong> e vê a peça, a bobina de origem e o
            certificado, sem precisar de carteira digital e sem custo.
          </li>
        </ol>
      </section>
      </div>

      <p className="secundario">
        É de uma indústria credenciada? <Link to="/operador">Registrar bobinas e peças</Link>.
      </p>
    </main>
  );
}
