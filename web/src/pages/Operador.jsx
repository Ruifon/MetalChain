import { useCallback, useEffect, useRef, useState } from "react";
import { id as keccakTexto } from "ethers";
import BarraMassa from "../components/BarraMassa.jsx";
import Etiqueta from "../components/Etiqueta.jsx";
import {
  buscarBobina, contratoEscrita, contratoLeitura, linkTx, mensagemErro, motivoDaRecusa,
  pecaIdDoRecibo, provedorCarteira, temCarteira, trocarParaRede,
} from "../lib/chain.js";
import { abreviar, kg, kgParaGramas, metrosParaMm, sha256Arquivo } from "../lib/formato.js";
import { CHAIN_ID, REDE_NOME } from "../config.js";

const PAPEL_OPERADOR = keccakTexto("OPERADOR");
const CHAVE_BOBINAS = "metalchain-bobinas-recentes";

function lerRecentes() {
  try { return JSON.parse(localStorage.getItem(CHAVE_BOBINAS) || "[]"); } catch { return []; }
}
function lembrarBobina(id) {
  try {
    const lista = [id, ...lerRecentes().filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(CHAVE_BOBINAS, JSON.stringify(lista));
  } catch { /* armazenamento indisponível */ }
}

// ---------------------------------------------------------------------------
// Carteira
// ---------------------------------------------------------------------------

function useCarteira() {
  const [conta, setConta] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [perfil, setPerfil] = useState(null); // { operador, nome }
  const [erro, setErro] = useState(null);

  const atualizar = useCallback(async () => {
    if (!temCarteira()) return;
    try {
      const contas = await window.ethereum.request({ method: "eth_accounts" });
      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setConta(contas[0] || null);
      setChainId(Number(cid));
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, []);

  useEffect(() => {
    atualizar();
    if (!temCarteira() || !window.ethereum.on) return;
    window.ethereum.on("accountsChanged", atualizar);
    window.ethereum.on("chainChanged", atualizar);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", atualizar);
      window.ethereum.removeListener?.("chainChanged", atualizar);
    };
  }, [atualizar]);

  useEffect(() => {
    setPerfil(null);
    if (!conta) return;
    let vivo = true;
    const c = contratoLeitura();
    Promise.all([c.hasRole(PAPEL_OPERADOR, conta), c.nomeIndustria(conta)])
      .then(([operador, nome]) => vivo && setPerfil({ operador, nome }))
      .catch((e) => vivo && setErro(mensagemErro(e)));
    return () => { vivo = false; };
  }, [conta]);

  async function conectar() {
    setErro(null);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await atualizar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function trocarRede() {
    setErro(null);
    try { await trocarParaRede(); await atualizar(); } catch (e) { setErro(mensagemErro(e)); }
  }

  return { conta, chainId, perfil, erro, conectar, trocarRede, redeCerta: chainId === CHAIN_ID };
}

// ---------------------------------------------------------------------------
// Acompanhamento de uma transação
// ---------------------------------------------------------------------------

function Andamento({ estado }) {
  if (!estado) return null;
  const { fase, hash, texto } = estado;
  const classes = { assinando: "carregando", minerando: "carregando", ok: "ok", erro: "erro" };
  return (
    <div className={`aviso aviso-${classes[fase]}`} role="status">
      <p>{texto}</p>
      {hash && linkTx(hash) && (
        <p><a href={linkTx(hash)} target="_blank" rel="noreferrer">Ver a transação no explorador de blocos</a> <span className="hash pequeno">{abreviar(hash, 10, 6)}</span></p>
      )}
    </div>
  );
}

/**
 * Envia com limite de gas 30% acima da estimativa. Na Sepolia, desde a
 * atualização Glamsterdam, a criação de estado é cobrada à parte, e a
 * estimativa feita pela carteira pode ficar curta; sem folga, a transação
 * pode falhar por falta de gas.
 */
async function comFolgaDeGas(metodo, args) {
  const estimado = await metodo.estimateGas(...args);
  return metodo(...args, { gasLimit: (estimado * 13n) / 10n });
}

async function enviarEAcompanhar(enviar, setAndamento) {
  setAndamento({ fase: "assinando", texto: "Confirme a operação na MetaMask." });
  const tx = await enviar();
  setAndamento({ fase: "minerando", hash: tx.hash, texto: "Enviada. Aguardando a inclusão em um bloco, o que leva alguns segundos…" });
  try {
    const rec = await tx.wait();
    return { tx, rec };
  } catch (e) {
    e.hashTransacao = tx.hash;
    e.blocoTransacao = e.receipt?.blockNumber;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Gerar peça
// ---------------------------------------------------------------------------

function FormPeca({ bobinaInicial, habilitado }) {
  const [bobinaId, setBobinaId] = useState(bobinaInicial || "");
  const [descricao, setDescricao] = useState("");
  const [comprimento, setComprimento] = useState("");
  const [massa, setMassa] = useState("");
  const [bobina, setBobina] = useState(undefined); // undefined: nada digitado; null: inexistente
  const [buscando, setBuscando] = useState(false);
  const [andamento, setAndamento] = useState(null);
  const [podeForcar, setPodeForcar] = useState(false);
  const [gerada, setGerada] = useState(null);
  const recentes = lerRecentes();
  const consulta = useRef(0);

  useEffect(() => { if (bobinaInicial) setBobinaId(bobinaInicial); }, [bobinaInicial]);

  const carregarBobina = useCallback(async (idBob) => {
    const n = ++consulta.current;
    if (!idBob.trim()) { setBobina(undefined); return; }
    setBuscando(true);
    try {
      const b = await buscarBobina(idBob.trim());
      if (n === consulta.current) setBobina(b);
    } catch {
      if (n === consulta.current) setBobina(undefined);
    } finally {
      if (n === consulta.current) setBuscando(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => carregarBobina(bobinaId), 400);
    return () => clearTimeout(t);
  }, [bobinaId, carregarBobina]);

  const gramas = kgParaGramas(massa);
  const mm = metrosParaMm(comprimento);
  const excesso = bobina && gramas && gramas > bobina.saldo ? gramas - bobina.saldo : 0n;

  async function enviar(forcar) {
    setPodeForcar(false);
    if (!gramas) { setAndamento({ fase: "erro", texto: "Informe a massa da peça em kg." }); return; }
    if (mm === null) { setAndamento({ fase: "erro", texto: "Informe o comprimento em metros, ou deixe em branco." }); return; }
    try {
      const c = await contratoEscrita();
      const args = [bobinaId.trim(), descricao.trim(), mm, gramas];
      const { tx, rec } = await enviarEAcompanhar(
        () => (forcar ? c.gerarPeca(...args, { gasLimit: 300000n }) : comFolgaDeGas(c.gerarPeca, args)),
        setAndamento
      );
      const ev = pecaIdDoRecibo(rec);
      lembrarBobina(bobinaId.trim());
      setAndamento({ fase: "ok", hash: tx.hash, texto: `Peça nº ${ev.pecaId} registrada no bloco ${rec.blockNumber}. Saldo restante da bobina: ${kg(ev.saldoRestante)}.` });
      setGerada({ pecaId: ev.pecaId.toString(), txHash: tx.hash, descricao: descricao.trim(), bobinaId: bobinaId.trim(), massa: gramas, comprimento: mm });
      setDescricao(""); setMassa(""); setComprimento("");
      carregarBobina(bobinaId);
    } catch (e) {
      const recusaMassa = motivoDaRecusa(e) === "massa insuficiente" || /massa insuficiente/.test(e?.message || "");
      if (e.hashTransacao) {
        setAndamento({
          fase: "erro", hash: e.hashTransacao,
          texto: recusaMassa || forcar
            ? `A transação entrou ${e.blocoTransacao ? `no bloco ${e.blocoTransacao}` : "em um bloco"} e foi revertida pelo contrato${recusaMassa ? " por massa insuficiente" : ""}. O saldo da bobina não mudou, e a tentativa fica registrada publicamente.`
            : `A transação entrou ${e.blocoTransacao ? `no bloco ${e.blocoTransacao}` : "em um bloco"}, mas falhou, e nada foi gravado. Veja o motivo no explorador de blocos.`,
        });
      } else {
        setAndamento({ fase: "erro", texto: mensagemErro(e) });
        setPodeForcar(recusaMassa);
      }
    }
  }

  const ocupado = andamento?.fase === "assinando" || andamento?.fase === "minerando";

  return (
    <div className="form-grade">
      <form className="form" onSubmit={(e) => { e.preventDefault(); enviar(false); }}>
        <div className="campo">
          <label htmlFor="p-bobina">Número da bobina de origem</label>
          <input id="p-bobina" list="bobinas-recentes" value={bobinaId} onChange={(e) => setBobinaId(e.target.value)} autoComplete="off" required />
          <datalist id="bobinas-recentes">{recentes.map((b) => <option key={b} value={b} />)}</datalist>
          {bobina === null && !buscando && <p className="campo-erro">Nenhuma bobina registrada com esse número.</p>}
        </div>
        <div className="campo">
          <label htmlFor="p-desc">Descrição da peça</label>
          <input id="p-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Vergalhão CA-50 10 mm, barra de 12 m" maxLength={120} />
          <p className="dica">Textos curtos custam menos para gravar.</p>
        </div>
        <div className="campo-par">
          <div className="campo">
            <label htmlFor="p-comp">Comprimento (m)</label>
            <input id="p-comp" inputMode="decimal" value={comprimento} onChange={(e) => setComprimento(e.target.value)} placeholder="12" />
          </div>
          <div className="campo">
            <label htmlFor="p-massa">Massa (kg)</label>
            <input id="p-massa" inputMode="decimal" value={massa} onChange={(e) => setMassa(e.target.value)} placeholder="500" required />
          </div>
        </div>
        <div className="acoes">
          <button className="btn btn-forte" type="submit" disabled={!habilitado || ocupado || !bobina}>Gerar peça</button>
          {podeForcar && !ocupado && (
            <button type="button" className="btn btn-quieto" onClick={() => enviar(true)}>
              Enviar mesmo assim, para registrar a recusa na rede
            </button>
          )}
        </div>
        <Andamento estado={andamento} />
      </form>

      <aside className="painel-bobina" aria-live="polite">
        {bobina ? (
          <>
            <h3>Bobina {bobina.id}</h3>
            <p className="saldo"><span className="saldo-num">{kg(bobina.saldo)}</span> disponíveis de {kg(bobina.massaInicial)}</p>
            <BarraMassa
              total={bobina.massaInicial + excesso}
              segmentos={[
                { valor: bobina.massaInicial - bobina.saldo, tipo: "outras", rotulo: "Peças já geradas" },
                { valor: gramas ? (gramas > bobina.saldo ? bobina.saldo : gramas) : 0n, tipo: "nova", rotulo: "Esta peça" },
                { valor: gramas && gramas < bobina.saldo ? bobina.saldo - gramas : gramas ? 0n : bobina.saldo, tipo: "saldo", rotulo: gramas ? "Saldo depois desta peça" : "Saldo disponível" },
                { valor: excesso, tipo: "excesso", rotulo: "Acima do saldo" },
              ]}
            />
            {excesso > 0n && (
              <p className="campo-erro">A peça passa do saldo em {kg(excesso)}. O contrato vai recusar o registro.</p>
            )}
            <p className="secundario">{[bobina.norma, bobina.grau, bobina.lote && `lote ${bobina.lote}`].filter(Boolean).join(", ")}</p>
          </>
        ) : (
          <p className="secundario">{buscando ? "Consultando a bobina…" : "Digite o número de uma bobina registrada para ver o saldo disponível."}</p>
        )}
      </aside>

      {gerada && (
        <section className="gerada" aria-labelledby="gerada-titulo">
          <h3 id="gerada-titulo">Etiqueta da peça</h3>
          <Etiqueta {...gerada} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registrar bobina (gênese)
// ---------------------------------------------------------------------------

function FormBobina({ habilitado, aoRegistrar }) {
  const vazio = { id: "", lote: "", norma: "ABNT NBR 7480", grau: "", certConformidade: "", massa: "", cid: "" };
  const [d, setD] = useState(vazio);
  const [arquivo, setArquivo] = useState(null); // { nome, hash }
  const [existe, setExiste] = useState(false);
  const [andamento, setAndamento] = useState(null);
  const [registrada, setRegistrada] = useState(null);
  const mudar = (k) => (e) => setD({ ...d, [k]: e.target.value });

  async function verificarExistencia() {
    if (!d.id.trim()) return setExiste(false);
    try { setExiste(!!(await buscarBobina(d.id.trim()))); } catch { setExiste(false); }
  }

  async function escolherArquivo(f) {
    if (!f) return setArquivo(null);
    setArquivo({ nome: f.name, hash: null });
    setArquivo({ nome: f.name, hash: await sha256Arquivo(f) });
  }

  async function enviar() {
    setRegistrada(null);
    const gramas = kgParaGramas(d.massa);
    if (!gramas) return setAndamento({ fase: "erro", texto: "Informe a massa da bobina em kg." });
    if (!arquivo?.hash) return setAndamento({ fase: "erro", texto: "Selecione o arquivo do certificado de origem." });
    try {
      const c = await contratoEscrita();
      const dados = { lote: d.lote.trim(), norma: d.norma.trim(), grau: d.grau.trim(), certConformidade: d.certConformidade.trim() };
      const { tx, rec } = await enviarEAcompanhar(
        () => comFolgaDeGas(c.registrarBobina, [d.id.trim(), dados, gramas, arquivo.hash, d.cid.trim()]),
        setAndamento
      );
      lembrarBobina(d.id.trim());
      setAndamento({ fase: "ok", hash: tx.hash, texto: `Bobina ${d.id.trim()} registrada no bloco ${rec.blockNumber}, com ${kg(gramas)} e o hash do certificado.` });
      setRegistrada(d.id.trim());
      setD(vazio); setArquivo(null);
    } catch (e) {
      setAndamento({
        fase: "erro", hash: e.hashTransacao,
        texto: e.hashTransacao
          ? `A transação entrou ${e.blocoTransacao ? `no bloco ${e.blocoTransacao}` : "em um bloco"}, mas falhou, e nada foi gravado. ${motivoDaRecusa(e) ? mensagemErro(e) : "Veja o motivo no explorador de blocos."}`
          : mensagemErro(e),
      });
    }
  }

  const ocupado = andamento?.fase === "assinando" || andamento?.fase === "minerando";

  return (
    <form className="form form-largo" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
      <div className="campo-par">
        <div className="campo">
          <label htmlFor="b-id">Número da bobina (etiqueta da usina)</label>
          <input id="b-id" value={d.id} onChange={mudar("id")} onBlur={verificarExistencia} required autoComplete="off" />
          {existe && <p className="campo-erro">Já existe uma bobina registrada com esse número.</p>}
        </div>
        <div className="campo">
          <label htmlFor="b-massa">Massa líquida (kg)</label>
          <input id="b-massa" inputMode="decimal" value={d.massa} onChange={mudar("massa")} placeholder="2000" required />
        </div>
      </div>
      <div className="campo-par">
        <div className="campo">
          <label htmlFor="b-lote">Lote ou corrida</label>
          <input id="b-lote" value={d.lote} onChange={mudar("lote")} />
        </div>
        <div className="campo">
          <label htmlFor="b-grau">Grau ou categoria do aço</label>
          <input id="b-grau" value={d.grau} onChange={mudar("grau")} placeholder="CA-50" />
        </div>
      </div>
      <div className="campo-par">
        <div className="campo">
          <label htmlFor="b-norma">Norma</label>
          <input id="b-norma" list="normas" value={d.norma} onChange={mudar("norma")} />
          <datalist id="normas">
            <option value="ABNT NBR 7480" />
            <option value="ABNT NBR 7008" />
            <option value="ABNT NBR 14513" />
            <option value="ABNT NBR 14514" />
          </datalist>
        </div>
        <div className="campo">
          <label htmlFor="b-cc">Certificado de conformidade (se houver)</label>
          <input id="b-cc" value={d.certConformidade} onChange={mudar("certConformidade")} />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="b-arquivo">Arquivo do certificado de origem</label>
        <input id="b-arquivo" type="file" onChange={(e) => escolherArquivo(e.target.files?.[0])} required />
        {arquivo && (
          <p className="dica">
            {arquivo.hash ? <>Hash SHA-256 que será gravado: <span className="hash">{arquivo.hash}</span></> : "Calculando o hash…"}
          </p>
        )}
      </div>
      <div className="campo">
        <label htmlFor="b-cid">CID do arquivo no IPFS (opcional)</label>
        <input id="b-cid" value={d.cid} onChange={mudar("cid")} placeholder="bafy…" autoComplete="off" />
      </div>
      <div className="acoes">
        <button className="btn btn-forte" type="submit" disabled={!habilitado || ocupado || existe}>Registrar bobina</button>
      </div>
      <Andamento estado={andamento} />
      {registrada && (
        <div className="acoes">
          <button type="button" className="btn" onClick={() => aoRegistrar(registrada)}>Gerar peças da bobina {registrada}</button>
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function Operador() {
  const cart = useCarteira();
  const [aba, setAba] = useState("peca");
  const [bobinaEscolhida, setBobinaEscolhida] = useState("");
  const habilitado = !!(cart.conta && cart.redeCerta && cart.perfil?.operador);

  useEffect(() => { document.title = "Área da indústria · MetalChain"; return () => { document.title = "MetalChain"; }; }, []);

  return (
    <main className="pagina pagina-larga">
      <h1 className="titulo">Área da indústria</h1>
      <p className="lead">Registre a entrada das bobinas e as peças cortadas delas. Cada registro é assinado pela sua carteira.</p>

      <section className="carteira" aria-label="Carteira">
        {!temCarteira() ? (
          <p>
            Para registrar, instale a extensão <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> neste
            navegador. A consulta de peças não precisa de carteira.
          </p>
        ) : !cart.conta ? (
          <>
            <p>Conecte a carteira credenciada da sua indústria.</p>
            <button className="btn btn-forte" onClick={cart.conectar}>Conectar MetaMask</button>
          </>
        ) : !cart.redeCerta ? (
          <>
            <p>A MetaMask está em outra rede. Os registros ficam na rede {REDE_NOME}.</p>
            <button className="btn btn-forte" onClick={cart.trocarRede}>Trocar para a rede {REDE_NOME}</button>
          </>
        ) : (
          <div className="carteira-ok">
            <span className={`ponto ${cart.perfil?.operador ? "ponto-ok" : "ponto-alerta"}`} aria-hidden="true" />
            <div>
              <p className="carteira-nome">{cart.perfil?.nome || "Carteira sem nome registrado"}</p>
              <p className="hash pequeno">{cart.conta}</p>
            </div>
            <p className="carteira-papel">
              {cart.perfil == null ? "Verificando o credenciamento…" : cart.perfil.operador ? "Operador credenciado" : "Esta carteira não é de um operador credenciado"}
            </p>
          </div>
        )}
        {cart.erro && <div className="aviso aviso-erro" role="alert"><p>{cart.erro}</p></div>}
      </section>

      <div className="abas" role="tablist">
        <button role="tab" aria-selected={aba === "peca"} className={aba === "peca" ? "ativa" : ""} onClick={() => setAba("peca")}>Gerar peça</button>
        <button role="tab" aria-selected={aba === "bobina"} className={aba === "bobina" ? "ativa" : ""} onClick={() => setAba("bobina")}>Registrar bobina</button>
      </div>

      <div role="tabpanel">
        {aba === "peca" ? (
          <FormPeca bobinaInicial={bobinaEscolhida} habilitado={habilitado} />
        ) : (
          <FormBobina habilitado={habilitado} aoRegistrar={(id) => { setBobinaEscolhida(id); setAba("peca"); }} />
        )}
      </div>
    </main>
  );
}
