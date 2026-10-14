import { useCallback, useEffect, useRef, useState } from "react";
import { id as keccakTexto, isAddress, ZeroHash } from "ethers";
import BarraMassa from "../components/BarraMassa.jsx";
import Etiqueta from "../components/Etiqueta.jsx";
import {
  buscarBobina, contratoEscrita, contratoLeitura, linkTx, mensagemErro, motivoDaRecusa,
  pecaIdDoRecibo, provedorCarteira, temCarteira, trocarParaRede,
} from "../lib/chain.js";
import { abreviar, kg, kgParaGramas, metros, metrosParaMm, sha256Arquivo } from "../lib/formato.js";
import {
  dimensaoTexto, faixaDeMassa, massaCompativel, massaLinearBitola, massaLinearTexto,
  rotuloDimensao, toleranciaNbr7480, toleranciaTexto,
} from "../lib/especificacao.js";
import { BLOCO_INICIAL, CHAIN_ID, REDE_NOME } from "../config.js";

const kgDecimal = (g) => kg(Math.round(g));
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
  const [versaoPerfil, setVersaoPerfil] = useState(0); // recarrega o papel após credenciar

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
    Promise.all([c.hasRole(PAPEL_OPERADOR, conta), c.hasRole(ZeroHash, conta), c.nomeIndustria(conta)])
      .then(([operador, admin, nome]) => vivo && setPerfil({ operador, admin, nome }))
      .catch((e) => vivo && setErro(mensagemErro(e)));
    return () => { vivo = false; };
  }, [conta, versaoPerfil]);

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

  const recarregarPerfil = () => setVersaoPerfil((v) => v + 1);
  return { conta, chainId, perfil, erro, conectar, trocarRede, recarregarPerfil, redeCerta: chainId === CHAIN_ID };
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

const RECUSAS_DEMONSTRAVEIS = ["massa insuficiente", "massa incompativel com o comprimento", "bobina de outra industria"];

function FormPeca({ bobinaInicial, habilitado, conta }) {
  const [bobinaId, setBobinaId] = useState(bobinaInicial || "");
  const [descricao, setDescricao] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [comprimento, setComprimento] = useState("");
  const [massa, setMassa] = useState("");
  const [bobina, setBobina] = useState(undefined); // undefined: nada digitado; null: inexistente
  const [buscando, setBuscando] = useState(false);
  const [andamento, setAndamento] = useState(null);
  const [podeForcar, setPodeForcar] = useState(false);
  const [gerada, setGerada] = useState(null);
  const [donaBobina, setDonaBobina] = useState(""); // nome da indústria que registrou a bobina
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
      if (b) {
        const nomeDona = await contratoLeitura().nomeIndustria(b.operador).catch(() => "");
        if (n === consulta.current) setDonaBobina(nomeDona);
      }
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
  const qtd = /^\d+$/.test(quantidade.trim()) && Number(quantidade) > 0 ? BigInt(quantidade.trim()) : null;
  const mmUnidade = metrosParaMm(comprimento);
  const mmTotal = qtd && mmUnidade ? qtd * mmUnidade : null;
  const excesso = bobina && gramas && gramas > bobina.saldo ? gramas - bobina.saldo : 0n;
  const faixa = bobina && mmTotal ? faixaDeMassa(mmTotal, bobina.massaLinear, bobina.toleranciaMassa) : null;
  const compativel = bobina && mmTotal && gramas
    ? massaCompativel(gramas, mmTotal, bobina.massaLinear, bobina.toleranciaMassa)
    : null;
  const rotulo = bobina ? rotuloDimensao(bobina.norma) : "Bitola";
  const deOutraIndustria = !!(bobina && conta && bobina.operador.toLowerCase() !== conta.toLowerCase());

  async function enviar(forcar) {
    setPodeForcar(false);
    if (!mmTotal) { setAndamento({ fase: "erro", texto: "Informe a quantidade e o comprimento de cada unidade, em metros." }); return; }
    if (!gramas) { setAndamento({ fase: "erro", texto: "Informe a massa pesada da peça, em kg." }); return; }
    try {
      const c = await contratoEscrita();
      const args = [bobinaId.trim(), descricao.trim(), mmTotal, gramas];
      const { tx, rec } = await enviarEAcompanhar(
        () => (forcar ? c.gerarPeca(...args, { gasLimit: 300000n }) : comFolgaDeGas(c.gerarPeca, args)),
        setAndamento
      );
      const ev = pecaIdDoRecibo(rec);
      lembrarBobina(bobinaId.trim());
      setAndamento({ fase: "ok", hash: tx.hash, texto: `Peça nº ${ev.pecaId} registrada no bloco ${rec.blockNumber}. Saldo restante da bobina: ${kg(ev.saldoRestante)}.` });
      setGerada({
        pecaId: ev.pecaId.toString(), txHash: tx.hash, descricao: descricao.trim(), bobinaId: bobinaId.trim(),
        massa: gramas, comprimento: mmTotal, dimensao: `${rotulo} ${dimensaoTexto(bobina.dimensaoNominal)}`,
      });
      setDescricao(""); setMassa(""); setComprimento(""); setQuantidade("1");
      carregarBobina(bobinaId);
    } catch (e) {
      const motivo = motivoDaRecusa(e) || (e?.message || "").match(/MetalChain: ([a-z ]+)/i)?.[1] || "";
      const demonstravel = RECUSAS_DEMONSTRAVEIS.includes(motivo.trim());
      const onde = e.blocoTransacao ? `no bloco ${e.blocoTransacao}` : "em um bloco";
      if (e.hashTransacao) {
        setAndamento({
          fase: "erro", hash: e.hashTransacao,
          texto: forcar
            ? `A transação entrou ${onde} e foi revertida pelo contrato. O saldo da bobina não mudou, e a tentativa fica registrada publicamente.`
            : `A transação entrou ${onde}, mas falhou, e nada foi gravado. Veja o motivo no explorador de blocos.`,
        });
      } else {
        setAndamento({ fase: "erro", texto: mensagemErro(e) });
        setPodeForcar(demonstravel);
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
          <input id="p-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Feixe de estribos 10x20 cm" maxLength={120} />
          <p className="dica">
            {bobina ? `${rotulo}, norma e grau vêm da bobina; não é preciso escrevê-los.` : "Textos curtos custam menos para gravar."}
          </p>
        </div>
        <div className="campo-trio">
          <div className="campo">
            <label htmlFor="p-qtd">Quantidade</label>
            <input id="p-qtd" inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="campo">
            <label htmlFor="p-comp">Comprimento de cada (m)</label>
            <input id="p-comp" inputMode="decimal" value={comprimento} onChange={(e) => setComprimento(e.target.value)} placeholder="12" required />
          </div>
          <div className="campo">
            <label htmlFor="p-massa">Massa pesada (kg)</label>
            <input id="p-massa" inputMode="decimal" value={massa} onChange={(e) => setMassa(e.target.value)} required />
          </div>
        </div>
        {faixa && (
          <p className={compativel === false ? "campo-erro" : "dica"}>
            Para {metros(mmTotal)} de material, a massa esperada é {kgDecimal(faixa.nominal)}, aceita
            de {kgDecimal(faixa.min)} a {kgDecimal(faixa.max)}.
            {compativel === false && " A massa informada está fora dessa faixa: o contrato vai recusar o registro."}
          </p>
        )}
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
            {deOutraIndustria && (
              <p className="campo-erro">
                Esta bobina foi registrada por {donaBobina || "outra indústria"}. Só a indústria que registrou a
                bobina pode gerar peças dela; o contrato vai recusar o registro.
              </p>
            )}
            <dl className="campos campos-espec">
              <div><dt>{rotulo}</dt><dd>{dimensaoTexto(bobina.dimensaoNominal)}</dd></div>
              <div><dt>Massa linear</dt><dd>{massaLinearTexto(bobina.massaLinear)}</dd></div>
              <div><dt>Tolerância</dt><dd>{toleranciaTexto(bobina.toleranciaMassa)}</dd></div>
            </dl>
            <p className="secundario">{[bobina.norma, bobina.grau, bobina.lote && `lote ${bobina.lote}`].filter(Boolean).join(", ")}</p>
            {donaBobina && !deOutraIndustria && <p className="secundario">Registrada pela sua indústria, {donaBobina}.</p>}
          </>
        ) : (
          <p className="secundario">{buscando ? "Consultando a bobina…" : "Digite o número de uma bobina registrada para ver o saldo e a especificação."}</p>
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

const PRODUTOS = {
  barra: { nome: "Vergalhão ou fio (bitola)", rotulo: "Bitola (mm)", norma: "ABNT NBR 7480" },
  chapa: { nome: "Telha ou chapa (espessura)", rotulo: "Espessura (mm)", norma: "ABNT NBR 14513" },
};

function FormBobina({ habilitado, aoRegistrar }) {
  const vazio = {
    id: "", lote: "", produto: "barra", norma: PRODUTOS.barra.norma, grau: "", certConformidade: "",
    massa: "", dimensao: "", massaLinear: "", tolerancia: "", cid: "",
  };
  const [d, setD] = useState(vazio);
  const [arquivo, setArquivo] = useState(null); // { nome, hash, dono }
  const [existe, setExiste] = useState(false);
  const [andamento, setAndamento] = useState(null);
  const [registrada, setRegistrada] = useState(null);
  const [chaveArquivo, setChaveArquivo] = useState(0); // recria o campo de arquivo após registrar
  const mudar = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const produto = PRODUTOS[d.produto];

  // Para barras e fios, a massa linear e a tolerância saem da bitola (NBR 7480).
  function mudarDimensao(e) {
    const valor = e.target.value;
    const novo = { ...d, dimensao: valor };
    if (d.produto === "barra") {
      const mm = Number(valor.replace(",", "."));
      const ml = massaLinearBitola(mm);
      const tol = toleranciaNbr7480(mm);
      if (ml) novo.massaLinear = (ml / 1000).toFixed(3).replace(".", ",");
      if (tol) novo.tolerancia = String(tol);
    }
    setD(novo);
  }

  function mudarProduto(e) {
    const p = e.target.value;
    setD({ ...d, produto: p, norma: PRODUTOS[p].norma, dimensao: "", massaLinear: "", tolerancia: "" });
  }

  async function verificarExistencia() {
    if (!d.id.trim()) return setExiste(false);
    try { setExiste(!!(await buscarBobina(d.id.trim()))); } catch { setExiste(false); }
  }

  async function escolherArquivo(f) {
    if (!f) return setArquivo(null);
    setArquivo({ nome: f.name, hash: null, dono: "" });
    const hash = await sha256Arquivo(f);
    let dono = "";
    try { dono = await contratoLeitura().bobinaDoCertificado(hash); } catch { /* segue sem a checagem */ }
    setArquivo({ nome: f.name, hash, dono });
  }

  const numero = (txt) => Number(String(txt).trim().replace(",", "."));

  async function enviar() {
    setRegistrada(null);
    const gramas = kgParaGramas(d.massa);
    const dimUm = Math.round(numero(d.dimensao) * 1000);
    const mlGm = Math.round(numero(d.massaLinear) * 1000);
    const tolPb = Math.round(numero(d.tolerancia) * 100);
    if (!gramas) return setAndamento({ fase: "erro", texto: "Informe a massa da bobina em kg." });
    if (!(dimUm > 0)) return setAndamento({ fase: "erro", texto: `Informe a ${produto.rotulo.toLowerCase()} nominal.` });
    if (!(mlGm > 0)) return setAndamento({ fase: "erro", texto: "Informe a massa linear do produto, em kg/m." });
    if (!(tolPb >= 0 && tolPb <= 2000)) return setAndamento({ fase: "erro", texto: "Informe a tolerância de massa, de 0 a 20%." });
    if (!arquivo?.hash) return setAndamento({ fase: "erro", texto: "Selecione o arquivo do certificado de origem." });
    try {
      const c = await contratoEscrita();
      const dados = {
        lote: d.lote.trim(), norma: d.norma.trim(), grau: d.grau.trim(), certConformidade: d.certConformidade.trim(),
        dimensaoNominal: BigInt(dimUm), massaLinear: BigInt(mlGm), toleranciaMassa: BigInt(tolPb),
      };
      const { tx, rec } = await enviarEAcompanhar(
        () => comFolgaDeGas(c.registrarBobina, [d.id.trim(), dados, gramas, arquivo.hash, d.cid.trim()]),
        setAndamento
      );
      lembrarBobina(d.id.trim());
      setAndamento({ fase: "ok", hash: tx.hash, texto: `Bobina ${d.id.trim()} registrada no bloco ${rec.blockNumber}, com ${kg(gramas)}, ${produto.rotulo.replace(" (mm)", "").toLowerCase()} de ${dimensaoTexto(dimUm)} e o hash do certificado.` });
      setRegistrada(d.id.trim());
      setD(vazio); setArquivo(null); setChaveArquivo((k) => k + 1);
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
  const certificadoUsado = !!arquivo?.dono;

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

      <fieldset className="grupo">
        <legend>Especificação do produto</legend>
        <p className="dica">As peças herdam estes valores. O contrato recusa peças cuja massa não corresponda ao comprimento.</p>
        <div className="campo-par">
          <div className="campo">
            <label htmlFor="b-produto">Produto</label>
            <select id="b-produto" value={d.produto} onChange={mudarProduto}>
              {Object.entries(PRODUTOS).map(([k, p]) => <option key={k} value={k}>{p.nome}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="b-dim">{produto.rotulo}</label>
            <input id="b-dim" inputMode="decimal" value={d.dimensao} onChange={mudarDimensao} placeholder={d.produto === "barra" ? "10" : "0,43"} required />
          </div>
        </div>
        <div className="campo-par">
          <div className="campo">
            <label htmlFor="b-ml">Massa linear (kg/m)</label>
            <input id="b-ml" inputMode="decimal" value={d.massaLinear} onChange={mudar("massaLinear")} required />
            <p className="dica">{d.produto === "barra" ? "Calculada pela bitola, como na NBR 7480. Pode ajustar." : "Massa por metro do perfil, conforme o catálogo."}</p>
          </div>
          <div className="campo">
            <label htmlFor="b-tol">Tolerância de massa (%)</label>
            <input id="b-tol" inputMode="decimal" value={d.tolerancia} onChange={mudar("tolerancia")} required />
            <p className="dica">{d.produto === "barra" ? "Pela NBR 7480: ±6% até 12,5 mm, ±5% de 16 a 20 mm, ±4% acima." : "Conforme a norma do produto. Máximo de 20%."}</p>
          </div>
        </div>
      </fieldset>

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
          <label htmlFor="b-grau">Grau ou categoria do aço</label>
          <input id="b-grau" value={d.grau} onChange={mudar("grau")} placeholder={d.produto === "barra" ? "CA-50" : "ZAR-230"} />
        </div>
      </div>
      <div className="campo-par">
        <div className="campo">
          <label htmlFor="b-lote">Lote ou corrida</label>
          <input id="b-lote" value={d.lote} onChange={mudar("lote")} />
        </div>
        <div className="campo">
          <label htmlFor="b-cc">Certificado de conformidade (se houver)</label>
          <input id="b-cc" value={d.certConformidade} onChange={mudar("certConformidade")} />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="b-arquivo">Arquivo do certificado de origem</label>
        <input key={chaveArquivo} id="b-arquivo" type="file" onChange={(e) => escolherArquivo(e.target.files?.[0])} required />
        {arquivo && (
          <p className="dica">
            {arquivo.hash ? <>Hash SHA-256 que será gravado: <span className="hash">{arquivo.hash}</span></> : "Calculando o hash…"}
          </p>
        )}
        {certificadoUsado && (
          <p className="campo-erro">Este certificado já está vinculado à bobina {arquivo.dono}. Um certificado não pode sustentar duas bobinas.</p>
        )}
      </div>
      <div className="campo">
        <label htmlFor="b-cid">CID do arquivo no IPFS (opcional)</label>
        <input id="b-cid" value={d.cid} onChange={mudar("cid")} placeholder="bafy…" autoComplete="off" />
      </div>
      <div className="acoes">
        <button className="btn btn-forte" type="submit" disabled={!habilitado || ocupado || existe || certificadoUsado}>Registrar bobina</button>
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
// Administração: credenciar e revogar indústrias
// ---------------------------------------------------------------------------

function useIndustrias() {
  const [lista, setLista] = useState(null); // null: carregando; [] vazia; undefined: indisponível
  const carregar = useCallback(async () => {
    try {
      const c = contratoLeitura();
      const [cred, rev] = await Promise.all([
        c.queryFilter(c.filters.OperadorCredenciado(), BLOCO_INICIAL),
        c.queryFilter(c.filters.OperadorRevogado(), BLOCO_INICIAL),
      ]);
      const eventos = [...cred, ...rev].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      const mapa = new Map();
      for (const ev of eventos) {
        const carteira = ev.args.carteira;
        if (ev.fragment.name === "OperadorCredenciado") mapa.set(carteira.toLowerCase(), { carteira, nome: ev.args.nome, ativo: true });
        else if (mapa.has(carteira.toLowerCase())) mapa.get(carteira.toLowerCase()).ativo = false;
      }
      setLista([...mapa.values()]);
    } catch {
      setLista(undefined);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  return { lista, carregar };
}

function FormAdmin({ contaAtual, aoMudar }) {
  const [carteira, setCarteira] = useState("");
  const [nome, setNome] = useState("");
  const [situacao, setSituacao] = useState(null); // { operador, nome }
  const [andamento, setAndamento] = useState(null);
  const { lista, carregar } = useIndustrias();
  const valida = isAddress(carteira.trim());

  useEffect(() => {
    setSituacao(null);
    if (!valida) return;
    let vivo = true;
    const c = contratoLeitura();
    Promise.all([c.hasRole(PAPEL_OPERADOR, carteira.trim()), c.nomeIndustria(carteira.trim())])
      .then(([operador, n]) => vivo && setSituacao({ operador, nome: n }))
      .catch(() => {});
    return () => { vivo = false; };
  }, [carteira, valida]);

  async function executar(acao, alvo = carteira.trim(), nomeAlvo = nome.trim()) {
    try {
      const c = await contratoEscrita();
      const { tx, rec } = await enviarEAcompanhar(
        () => (acao === "credenciar" ? comFolgaDeGas(c.credenciarOperador, [alvo, nomeAlvo]) : comFolgaDeGas(c.revogarOperador, [alvo])),
        setAndamento
      );
      setAndamento({
        fase: "ok", hash: tx.hash,
        texto: acao === "credenciar"
          ? `${nomeAlvo} credenciada no bloco ${rec.blockNumber}. A carteira já pode registrar bobinas e peças.`
          : `Acesso revogado no bloco ${rec.blockNumber}. Os registros já feitos por essa carteira continuam valendo e mantêm o nome da indústria.`,
      });
      if (acao === "credenciar") { setCarteira(""); setNome(""); }
      carregar();
      if (alvo.toLowerCase() === contaAtual?.toLowerCase()) aoMudar();
    } catch (e) {
      setAndamento({ fase: "erro", hash: e.hashTransacao, texto: mensagemErro(e) });
    }
  }

  const ocupado = andamento?.fase === "assinando" || andamento?.fase === "minerando";

  return (
    <div className="form-grade">
      <form className="form" onSubmit={(e) => { e.preventDefault(); executar("credenciar"); }}>
        <p className="secundario">
          Só as carteiras credenciadas aqui podem registrar bobinas e peças. O contrato confere o
          credenciamento em cada transação; a interface apenas facilita o pedido.
        </p>
        <div className="campo">
          <label htmlFor="a-carteira">Endereço da carteira da indústria</label>
          <input id="a-carteira" value={carteira} onChange={(e) => setCarteira(e.target.value)} placeholder="0x…" autoComplete="off" required />
          {carteira && !valida && <p className="campo-erro">Endereço inválido. Ele começa com 0x e tem 42 caracteres.</p>}
          {situacao && (
            <p className="dica">
              {situacao.operador
                ? `Esta carteira já está credenciada como ${situacao.nome || "indústria sem nome"}.`
                : situacao.nome ? `Já foi credenciada como ${situacao.nome} e está com o acesso revogado.` : "Esta carteira ainda não foi credenciada."}
            </p>
          )}
        </div>
        <div className="campo">
          <label htmlFor="a-nome">Nome da indústria</label>
          <input id="a-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Metalúrgica Exemplo Ltda." maxLength={60} required />
          <p className="dica">O nome aparece na consulta pública de cada registro feito por essa carteira e fica gravado de forma permanente.</p>
        </div>
        <div className="acoes">
          <button className="btn btn-forte" type="submit" disabled={ocupado || !valida || !nome.trim() || situacao?.operador}>Credenciar indústria</button>
          {situacao?.operador && (
            <button type="button" className="btn btn-quieto" disabled={ocupado} onClick={() => executar("revogar")}>Revogar acesso</button>
          )}
        </div>
        <Andamento estado={andamento} />
      </form>

      <aside className="painel-bobina" aria-live="polite">
        <h3>Indústrias credenciadas</h3>
        {lista === null && <p className="secundario">Consultando o contrato…</p>}
        {lista === undefined && <p className="secundario">Não foi possível listar agora. Use o campo ao lado para consultar uma carteira.</p>}
        {Array.isArray(lista) && lista.length === 0 && <p className="secundario">Nenhuma indústria credenciada ainda.</p>}
        {Array.isArray(lista) && lista.length > 0 && (
          <ul className="industrias">
            {lista.map((i) => (
              <li key={i.carteira}>
                <span className={`ponto ${i.ativo ? "ponto-ok" : "ponto-alerta"}`} aria-hidden="true" />
                <div>
                  <p className="industria-nome">{i.nome}</p>
                  <p className="hash pequeno">{i.carteira}</p>
                </div>
                <span className="industria-estado">{i.ativo ? "Credenciada" : "Revogada"}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function Operador() {
  const cart = useCarteira();
  const [aba, setAba] = useState("peca");
  const [bobinaEscolhida, setBobinaEscolhida] = useState("");
  const [copiado, setCopiado] = useState(false);
  const pronto = !!(cart.conta && cart.redeCerta && cart.perfil);
  const operador = pronto && cart.perfil.operador;
  const admin = pronto && cart.perfil.admin;
  const abaAtual = operador ? aba : "admin";

  useEffect(() => { document.title = "Área da indústria · MetalChain"; return () => { document.title = "MetalChain"; }; }, []);

  async function copiarEndereco() {
    try { await navigator.clipboard.writeText(cart.conta); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sem área de transferência */ }
  }

  const papel = !cart.perfil ? "Verificando o credenciamento…"
    : cart.perfil.operador && cart.perfil.admin ? "Administrador e operador"
    : cart.perfil.operador ? "Operador credenciado"
    : cart.perfil.admin ? "Administrador"
    : "Carteira não credenciada";

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
            <p>O acesso é restrito às indústrias credenciadas. Conecte a carteira da sua indústria.</p>
            <button className="btn btn-forte" onClick={cart.conectar}>Conectar MetaMask</button>
          </>
        ) : !cart.redeCerta ? (
          <>
            <p>A MetaMask está em outra rede. Os registros ficam na rede {REDE_NOME}.</p>
            <button className="btn btn-forte" onClick={cart.trocarRede}>Trocar para a rede {REDE_NOME}</button>
          </>
        ) : (
          <div className="carteira-ok">
            <span className={`ponto ${operador || admin ? "ponto-ok" : "ponto-alerta"}`} aria-hidden="true" />
            <div>
              <p className="carteira-nome">{cart.perfil?.nome || "Carteira sem nome registrado"}</p>
              <p className="hash pequeno">{cart.conta}</p>
            </div>
            <p className="carteira-papel">{papel}</p>
          </div>
        )}
        {cart.erro && <div className="aviso aviso-erro" role="alert"><p>{cart.erro}</p></div>}
      </section>

      {pronto && !operador && !admin && (
        <section className="restrito" aria-labelledby="restrito-titulo">
          <h2 id="restrito-titulo">Acesso restrito às indústrias credenciadas</h2>
          <p>
            Esta carteira não está credenciada para registrar bobinas e peças. O controle não é feito pelo
            site: é o próprio contrato que recusa qualquer gravação de uma carteira não credenciada.
          </p>
          <p>Para obter acesso, envie o endereço abaixo ao administrador do sistema.</p>
          <p className="restrito-endereco"><span className="hash">{cart.conta}</span></p>
          <div className="acoes">
            <button type="button" className="btn" onClick={copiarEndereco}>{copiado ? "Endereço copiado" : "Copiar endereço"}</button>
          </div>
        </section>
      )}

      {(operador || admin) && (
        <>
          <div className="abas" role="tablist">
            {operador && <button role="tab" aria-selected={abaAtual === "peca"} className={abaAtual === "peca" ? "ativa" : ""} onClick={() => setAba("peca")}>Gerar peça</button>}
            {operador && <button role="tab" aria-selected={abaAtual === "bobina"} className={abaAtual === "bobina" ? "ativa" : ""} onClick={() => setAba("bobina")}>Registrar bobina</button>}
            {admin && <button role="tab" aria-selected={abaAtual === "admin"} className={abaAtual === "admin" ? "ativa" : ""} onClick={() => setAba("admin")}>Administração</button>}
          </div>
          <div role="tabpanel">
            {abaAtual === "peca" && <FormPeca bobinaInicial={bobinaEscolhida} habilitado={operador} conta={cart.conta} />}
            {abaAtual === "bobina" && <FormBobina habilitado={operador} aoRegistrar={(id) => { setBobinaEscolhida(id); setAba("peca"); }} />}
            {abaAtual === "admin" && <FormAdmin contaAtual={cart.conta} aoMudar={cart.recarregarPerfil} />}
          </div>
        </>
      )}
    </main>
  );
}
