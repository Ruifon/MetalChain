import { Link, Route, Routes } from "react-router-dom";
import Cabecalho from "./components/Cabecalho.jsx";
import Inicio from "./pages/Inicio.jsx";
import Peca from "./pages/Peca.jsx";
import Operador from "./pages/Operador.jsx";
import { CONTRATO } from "./config.js";
import { linkEndereco } from "./lib/chain.js";

export default function App() {
  return (
    <>
      <Cabecalho />
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/peca/:id" element={<Peca />} />
        <Route path="/operador" element={<Operador />} />
        <Route
          path="*"
          element={
            <main className="pagina">
              <h1 className="titulo">Página não encontrada</h1>
              <p><Link to="/">Voltar para a consulta de peças</Link></p>
            </main>
          }
        />
      </Routes>
      <footer className="rodape">
        <p>
          MetalChain, protótipo do TCC de Rui de Souza Fontoura Junior (Ifes Cachoeiro, 2026).{" "}
          <a href="https://github.com/Ruifon/MetalChain" target="_blank" rel="noreferrer">Código-fonte</a>
          {linkEndereco(CONTRATO) && (
            <>{" "}e <a href={linkEndereco(CONTRATO)} target="_blank" rel="noreferrer">contrato no explorador de blocos</a></>
          )}
          .
        </p>
      </footer>
    </>
  );
}
