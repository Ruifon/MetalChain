import { Link, NavLink } from "react-router-dom";
import { REDE_DE_TESTES, REDE_NOME } from "../config.js";

export default function Cabecalho() {
  return (
    <header className="topo">
      <div className="topo-in">
        <Link to="/" className="marca" aria-label="MetalChain, início">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="marca-icone">
            <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="3.2" />
            <circle cx="16" cy="16" r="4.2" className="marca-nucleo" />
          </svg>
          MetalChain
        </Link>
        <nav className="topo-nav">
          <NavLink to="/" end>Consultar peça</NavLink>
          <NavLink to="/operador">Área da indústria</NavLink>
        </nav>
        <span className="rede" title={REDE_DE_TESTES ? "Rede pública de testes: o Ether usado não tem valor real" : "Rede principal"}>
          {REDE_DE_TESTES ? `Rede ${REDE_NOME} (testes)` : `Rede ${REDE_NOME}`}
        </span>
      </div>
    </header>
  );
}
