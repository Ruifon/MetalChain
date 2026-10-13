import { BrowserProvider, Contract, FallbackProvider, Interface, JsonRpcProvider, Network } from "ethers";
import abi from "../abi/MetalChain.json";
import { BLOCO_INICIAL, CHAIN_ID, CONTRATO, EXPLORER, RPC_URL } from "../config.js";

export const iface = new Interface(abi);

// ---------------------------------------------------------------------------
// Leitura: nó público, sem carteira e sem custo
// ---------------------------------------------------------------------------

// VITE_RPC_URL aceita mais de um endereço, separados por vírgula: se o
// primeiro nó não responder, a leitura segue pelo próximo.
let leitor;
export function provedorLeitura() {
  if (!leitor) {
    const rede = Network.from(CHAIN_ID);
    const urls = RPC_URL.split(",").map((u) => u.trim()).filter(Boolean);
    const nos = urls.map((u) => new JsonRpcProvider(u, rede, { staticNetwork: rede }));
    leitor = nos.length === 1
      ? nos[0]
      : new FallbackProvider(nos.map((provider, i) => ({ provider, priority: i + 1, weight: 1, stallTimeout: 2500 })), rede, { quorum: 1 });
  }
  return leitor;
}

export function contratoLeitura() {
  return new Contract(CONTRATO, abi, provedorLeitura());
}

/** Peça, bobina de origem e nomes das indústrias, em uma única chamada. */
export async function buscarGenealogia(pecaId) {
  const [peca, bobina, industriaPeca, industriaBobina] =
    await contratoLeitura().consultarGenealogia(BigInt(pecaId));
  return { peca, bobina, industriaPeca, industriaBobina };
}

/** Retorna a bobina ou null, se não houver bobina com esse número. */
export async function buscarBobina(bobinaId) {
  try {
    return await contratoLeitura().consultarBobina(bobinaId);
  } catch (e) {
    if (String(e?.reason || e?.shortMessage || e?.message).includes("bobina inexistente")) return null;
    throw e;
  }
}

/**
 * Encontra a transação que criou a peça. Se o QR Code trouxer o hash da
 * transação, ele só é aceito depois de conferido no recibo: a transação precisa
 * ter emitido PecaGerada, para esta peça, a partir deste contrato.
 */
export async function localizarTransacaoDaPeca(pecaId, hashInformado) {
  const prov = provedorLeitura();
  const id = BigInt(pecaId);
  if (hashInformado && /^0x[0-9a-fA-F]{64}$/.test(hashInformado)) {
    try {
      const rec = await prov.getTransactionReceipt(hashInformado);
      const confere = rec?.status === 1 && rec.logs.some((log) => {
        if (log.address.toLowerCase() !== CONTRATO.toLowerCase()) return false;
        try {
          const ev = iface.parseLog(log);
          return ev?.name === "PecaGerada" && ev.args.pecaId === id;
        } catch {
          return false;
        }
      });
      if (confere) return hashInformado;
    } catch {
      /* segue para a busca por evento */
    }
  }
  try {
    const c = contratoLeitura();
    const eventos = await c.queryFilter(c.filters.PecaGerada(id), BLOCO_INICIAL);
    return eventos[0]?.transactionHash ?? null;
  } catch {
    // Alguns nós limitam a faixa de blocos da busca; a página segue sem o link.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Escrita: carteira MetaMask do operador
// ---------------------------------------------------------------------------

export const temCarteira = () => typeof window !== "undefined" && !!window.ethereum;

export function provedorCarteira() {
  return new BrowserProvider(window.ethereum, "any");
}

export async function contratoEscrita() {
  const signer = await provedorCarteira().getSigner();
  return new Contract(CONTRATO, abi, signer);
}

export async function trocarParaRede() {
  const hex = "0x" + CHAIN_ID.toString(16);
  await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
}

/** Extrai o número da peça do evento PecaGerada de um recibo. */
export function pecaIdDoRecibo(rec) {
  for (const log of rec.logs) {
    try {
      const ev = iface.parseLog(log);
      if (ev?.name === "PecaGerada") return { pecaId: ev.args.pecaId, saldoRestante: ev.args.saldoRestante };
    } catch {
      /* log de outro contrato */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mensagens de erro em linguagem do usuário
// ---------------------------------------------------------------------------

const MENSAGENS = {
  "massa insuficiente": "Massa insuficiente: a bobina não tem saldo para esta peça. O contrato recusou o registro.",
  "bobina inexistente": "Não existe bobina registrada com esse número.",
  "bobina ja registrada": "Já existe uma bobina registrada com esse número.",
  "massa invalida": "Informe uma massa maior que zero.",
  "hash do certificado ausente": "Selecione o arquivo do certificado.",
  "id vazio": "Informe o número da bobina.",
  "peca inexistente": "Não existe peça registrada com esse número.",
  "certificado ja utilizado": "Este certificado já está vinculado a outra bobina. Um certificado não pode sustentar duas bobinas.",
  "massa incompativel com o comprimento": "Massa incompatível com o comprimento: para a bitola ou espessura desta bobina, a peça deveria ter outra massa. O contrato recusou o registro.",
  "comprimento invalido": "Informe o comprimento da peça.",
  "dimensao invalida": "Informe a bitola ou espessura nominal.",
  "massa linear invalida": "Informe a massa linear do produto.",
  "tolerancia invalida": "A tolerância de massa deve ficar entre 0 e 20%.",
};

function traduzir(motivo) {
  const chave = String(motivo).replace(/^MetalChain:\s*/, "").trim();
  return MENSAGENS[chave] || motivo;
}

export function motivoDaRecusa(e) {
  return String(e?.reason || e?.revert?.args?.[0] || "").replace(/^MetalChain:\s*/, "");
}

export function mensagemErro(e) {
  const codigoCarteira = e?.info?.error?.code ?? e?.error?.code;
  if (e?.code === "ACTION_REJECTED" || codigoCarteira === 4001) {
    return "Você cancelou a operação na MetaMask. Nada foi registrado.";
  }
  if (e?.revert?.name === "AccessControlUnauthorizedAccount") {
    return "Esta carteira não é de um operador credenciado. Peça ao administrador para credenciá-la.";
  }
  if (e?.reason) return traduzir(e.reason);
  if (e?.revert?.args?.[0]) return traduzir(e.revert.args[0]);
  const texto = `${e?.shortMessage || ""} ${e?.message || ""} ${e?.info?.error?.message || ""}`;
  const m = texto.match(/MetalChain: [a-z ]+/i);
  if (m) return traduzir(m[0]);
  if (/AccessControlUnauthorizedAccount|0xe2517d3f/.test(texto)) {
    return "Esta carteira não é de um operador credenciado. Peça ao administrador para credenciá-la.";
  }
  if (e?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(texto)) {
    return "A carteira não tem ETH de teste suficiente para pagar a taxa. Peça mais em um faucet da Sepolia.";
  }
  if (e?.code === "NETWORK_ERROR" || e?.code === "SERVER_ERROR" || /failed to fetch|timeout/i.test(texto)) {
    return "Não foi possível falar com a rede agora. Verifique a internet e tente de novo.";
  }
  return e?.shortMessage || e?.message || "Erro desconhecido.";
}

// ---------------------------------------------------------------------------
// Links do explorador de blocos
// ---------------------------------------------------------------------------

export const linkTx = (hash) => (EXPLORER && hash ? `${EXPLORER}/tx/${hash}` : null);
export const linkEndereco = (end) => (EXPLORER && end ? `${EXPLORER}/address/${end}` : null);
