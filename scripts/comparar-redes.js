// Executa o mesmo roteiro de validação em qualquer rede e grava o consumo de
// gas e a taxa paga em cada operação, para comparar os custos entre redes.
//
// Roteiro (o mesmo em todas as redes):
//   implantação do contrato e credenciamento da indústria que vai operar
//   CT01  gênese de um rolo de vergalhão CA-50 de 10 mm, 2.000 kg
//   CT02  dois feixes de barras de 12 m (745 kg e 590 kg)
//   CT03  fraude de saldo (890 kg com saldo de 665 kg)            -> revertida
//   CT12  fraude de especificação (barra de 12 m com 450 kg)      -> revertida
//   CT11  fraude de certificado (segunda bobina, mesmo certificado) -> revertida
//   CT14  segunda indústria tenta cortar a bobina da primeira     -> revertida
//   CT09/CT10  leituras públicas, sem transação
//
// Uso:
//   npx hardhat run scripts/comparar-redes.js --network sepolia
//   npx hardhat run scripts/comparar-redes.js --network hoodi
//   npx hardhat run scripts/comparar-redes.js --network arbitrumSepolia
//   npx hardhat run scripts/comparar-redes.js --network baseSepolia
//   NO_THROW=1 npx hardhat run scripts/comparar-redes.js        (rede local)
//
// A segunda indústria do CT14 é uma carteira criada na hora pelo script e
// abastecida com o mínimo para uma transação: nenhuma chave extra no .env.
// Os resultados ficam em resultados-redes/<rede>.json e .md; depois,
// node scripts/tabela-redes.js monta a tabela comparativa.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const KG = 1000n;
const EXPLORADORES = {
  11155111: "https://sepolia.etherscan.io",
  560048: "https://hoodi.etherscan.io",
  421614: "https://sepolia.arbiscan.io",
  84532: "https://sepolia.basescan.org",
};

async function main() {
  const prov = ethers.provider;
  const { chainId } = await prov.getNetwork();
  const explorador = EXPLORADORES[Number(chainId)] || null;
  const local = network.name === "hardhat" || network.name === "localhost";
  const signers = await ethers.getSigners();
  const industriaA = signers[0];

  // Contas convertidas em conta inteligente (EIP-7702) só podem ter uma
  // transação pendente por vez, e alguns provedores demoram a perceber que a
  // anterior já foi incluída. Nesse caso, espera alguns segundos e reenvia.
  const enviarOriginal = industriaA.sendTransaction.bind(industriaA);
  industriaA.sendTransaction = async (tx) => {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await enviarOriginal(tx);
      } catch (e) {
        const texto = `${e.message || ""} ${e.error?.message || ""}`;
        if (!/in-flight transaction limit|replacement transaction underpriced|nonce too low/i.test(texto) || tentativa >= 20) throw e;
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };

  const saldoInicial = await prov.getBalance(industriaA.address);
  console.log(`Rede: ${network.name} (chainId ${chainId})`);
  console.log(`Carteira: ${industriaA.address}`);
  console.log(`Saldo: ${ethers.formatEther(saldoInicial)} ETH\n`);
  if (saldoInicial === 0n) throw new Error("A carteira não tem ETH de teste nesta rede.");

  const registros = [];

  // Lê o recibo e calcula a taxa paga. Em redes de camada 2 do tipo OP Stack
  // (Base, Optimism), a taxa de publicação dos dados na camada 1 vem à parte,
  // no campo l1Fee; na Arbitrum ela já está embutida no gas usado
  // (gasUsedForL1 mostra quanto dele corresponde à camada 1).
  async function anotar(cenario, operacao, hash, esperado) {
    const rec = await prov.getTransactionReceipt(hash);
    const bruto = await prov.send("eth_getTransactionReceipt", [hash]);
    const preco = rec.gasPrice ?? 0n;
    const taxaL2 = rec.gasUsed * preco;
    const l1Fee = bruto?.l1Fee ? BigInt(bruto.l1Fee) : 0n;
    const gasL1 = bruto?.gasUsedForL1 ? BigInt(bruto.gasUsedForL1) : null;
    const situacao = rec.status === 1 ? "aceita" : "revertida";
    const r = {
      cenario, operacao, esperado, situacao,
      confere: situacao === esperado,
      hash, bloco: rec.blockNumber,
      gasUsado: rec.gasUsed.toString(),
      gasCamada1: gasL1 === null ? null : gasL1.toString(),
      precoGasWei: preco.toString(),
      taxaExecucaoWei: taxaL2.toString(),
      taxaCamada1Wei: l1Fee.toString(),
      taxaTotalWei: (taxaL2 + l1Fee).toString(),
    };
    registros.push(r);
    const marca = r.confere ? " " : "!";
    console.log(`${marca} ${situacao.padEnd(9)} ${cenario.padEnd(6)} ${operacao}`);
    console.log(`            gas ${rec.gasUsed}  taxa ${ethers.formatEther(taxaL2 + l1Fee)} ETH` +
      (explorador ? `\n            ${explorador}/tx/${hash}` : ""));
    return rec;
  }

  // Envia uma operação que o contrato deve recusar. Antes do envio, simula a
  // chamada para ler o motivo da recusa; o limite de gas vem de uma operação
  // válida equivalente (estimada antes), com folga, para que a recusa aconteça
  // pela regra do contrato e não por falta de gas.
  async function tentarFraude(cenario, operacao, limite, funcao, args, motivoEsperado) {
    let motivo = null;
    try {
      await funcao.staticCall(...args);
    } catch (e) {
      const texto = `${e.reason || ""} ${e.revert?.args?.[0] || ""} ${e.shortMessage || ""} ${e.message || ""}`;
      motivo = texto.match(/MetalChain: ([a-z ]+[a-z])/i)?.[1] ?? (e.shortMessage || "desconhecido");
    }
    let tx = null;
    try {
      tx = await funcao(...args, { gasLimit: limite });
      await tx.wait();
    } catch (e) {
      tx = tx ?? (e.transactionHash ? { hash: e.transactionHash } : null) ?? (e.receipt ? { hash: e.receipt.hash } : null);
      if (!tx) {
        console.log(`! recusada no envio ${cenario} ${operacao}: ${e.shortMessage || e.message}`);
        registros.push({ cenario, operacao, esperado: "revertida", situacao: "recusada no envio", motivo, confere: false });
        return;
      }
    }
    await anotar(cenario, operacao, tx.hash, "revertida");
    const r = registros[registros.length - 1];
    r.motivo = motivo;
    r.confere = r.confere && motivo === motivoEsperado;
    console.log(`            motivo: "${motivo}"${r.confere ? "" : `  (esperado: "${motivoEsperado}")`}`);
  }

  // Implantação
  const nome = process.env.NOME_INDUSTRIA || "Indústria Demonstração Ltda";
  const mc = await (await ethers.getContractFactory("MetalChain", industriaA)).deploy(nome);
  await mc.waitForDeployment();
  const endereco = await mc.getAddress();
  await anotar("—", "Implantação do contrato", mc.deploymentTransaction().hash, "aceita");

  let tx = await mc.credenciarOperador(industriaA.address, "Transformadora Exemplo S.A.");
  await tx.wait();
  await anotar("—", "credenciarOperador", tx.hash, "aceita");

  // Certificado de demonstração e bobina
  const conteudo = fs.readFileSync(path.join(__dirname, "..", "certificados", "certificado-demonstracao.txt"));
  const hashCert = ethers.sha256(conteudo);
  const bobinaId = `BOB-REDES-${network.name}-${Date.now() % 100000}`;
  const dados = {
    lote: "CORRIDA-48213", norma: "ABNT NBR 7480", grau: "CA-50", certConformidade: "CERT-DEMO-0001",
    dimensaoNominal: 10000n, massaLinear: 617n, toleranciaMassa: 600n,
  };

  // Limites para as fraudes, a partir de operações válidas equivalentes
  const estRegistro = await mc.registrarBobina.estimateGas(`${bobinaId}-EST`, dados, 2000n * KG, ethers.id("estimativa"), "");

  tx = await mc.registrarBobina(bobinaId, dados, 2000n * KG, hashCert, "");
  await tx.wait();
  await anotar("CT01", "registrarBobina: rolo de 2.000 kg", tx.hash, "aceita");

  const estPeca = await mc.gerarPeca.estimateGas(bobinaId, "Feixe com 100 barras de 12 m", 100n * 12000n, 745n * KG);
  const limitePeca = estPeca * 2n;

  for (const [barras, massaKg] of [[100n, 745n], [80n, 590n]]) {
    tx = await mc.gerarPeca(bobinaId, `Feixe com ${barras} barras de 12 m`, barras * 12000n, massaKg * KG);
    await tx.wait();
    await anotar("CT02", `gerarPeca: ${barras} barras, ${massaKg} kg`, tx.hash, "aceita");
  }

  await tentarFraude("CT03", "gerarPeca revertida: massa insuficiente", limitePeca, mc.gerarPeca,
    [bobinaId, "Feixe com 120 barras de 12 m", 120n * 12000n, 890n * KG], "massa insuficiente");
  await tentarFraude("CT12", "gerarPeca revertida: massa incompatível", limitePeca, mc.gerarPeca,
    [bobinaId, "Barra de 12 m", 12000n, 450n * KG], "massa incompativel com o comprimento");
  await tentarFraude("CT11", "registrarBobina revertida: certificado já utilizado", estRegistro * 2n, mc.registrarBobina,
    [`${bobinaId}-COPIA`, dados, 2000n * KG, hashCert, ""], "certificado ja utilizado");

  // CT14: segunda indústria
  let industriaB;
  if (local) {
    industriaB = signers[1];
  } else {
    industriaB = ethers.Wallet.createRandom().connect(prov);
    const taxas = await prov.getFeeData();
    const precoMax = taxas.maxFeePerGas ?? taxas.gasPrice ?? 0n;
    const valor = limitePeca * precoMax * 2n + ethers.parseEther("0.0002");
    const abastecer = await industriaA.sendTransaction({ to: industriaB.address, value: valor });
    await abastecer.wait();
    console.log(`  (segunda indústria ${industriaB.address} abastecida com ${ethers.formatEther(valor)} ETH)`);
  }
  tx = await mc.credenciarOperador(industriaB.address, "Metalúrgica Exemplo Ltda.");
  await tx.wait();
  await anotar("CT14", "credenciarOperador: segunda indústria", tx.hash, "aceita");
  await tentarFraude("CT14", "gerarPeca revertida: bobina de outra indústria", limitePeca, mc.connect(industriaB).gerarPeca,
    [bobinaId, "Feixe com 10 barras de 12 m", 10n * 12000n, 74n * KG], "bobina de outra industria");

  // CT09/CT10: leituras públicas
  const [peca, bobina, industria] = await mc.consultarGenealogia(1n);
  const confere = await mc.verificarCertificado(bobinaId, hashCert);
  const saldoBobina = (await mc.consultarBobina(bobinaId)).saldo;
  const leituras = {
    peca: peca.id.toString(), bobina: peca.bobinaId, bitolaMm: Number(bobina.dimensaoNominal) / 1000,
    industria, certificadoConfere: confere, saldoFinalKg: (saldoBobina / KG).toString(),
  };
  console.log(`\nLeitura pública: peça ${leituras.peca} → bobina ${leituras.bobina}, ${leituras.bitolaMm} mm, "${industria}"; ` +
    `certificado confere = ${confere}; saldo final ${leituras.saldoFinalKg} kg (esperado 665)`);

  const saldoFinal = await prov.getBalance(industriaA.address);
  const resultado = {
    rede: network.name, chainId: Number(chainId), data: new Date().toISOString(),
    contrato: endereco, versao: await mc.VERSAO(), carteira: industriaA.address, explorador,
    gastoTotalWei: (saldoInicial - saldoFinal).toString(),
    todosConferem: registros.every((r) => r.confere) && confere && saldoBobina === 665n * KG,
    registros, leituras,
  };

  const pasta = path.join(__dirname, "..", "resultados-redes");
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${network.name}.json`), JSON.stringify(resultado, null, 2) + "\n");

  const link = (h) => (explorador ? `[${h.slice(0, 10)}…](${explorador}/tx/${h})` : `\`${h.slice(0, 10)}…\``);
  const md = [
    `# Roteiro de validação na rede ${network.name}`, ``,
    `- Data: ${resultado.data}`,
    `- Contrato: ${explorador ? `[${endereco}](${explorador}/address/${endereco})` : endereco} (versão ${resultado.versao})`,
    `- Gasto total da carteira: ${ethers.formatEther(resultado.gastoTotalWei)} ETH de teste`,
    `- Todos os cenários com o resultado esperado: ${resultado.todosConferem ? "sim" : "NÃO"}`, ``,
    `| Cenário | Operação | Situação | Motivo | Bloco | Gas usado | Preço do gas (gwei) | Taxa total (ETH) | Transação |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...registros.map((r) => r.hash
      ? `| ${r.cenario} | ${r.operacao} | ${r.situacao} | ${r.motivo ?? ""} | ${r.bloco} | ${r.gasUsado} | ${ethers.formatUnits(r.precoGasWei, "gwei")} | ${ethers.formatEther(r.taxaTotalWei)} | ${link(r.hash)} |`
      : `| ${r.cenario} | ${r.operacao} | ${r.situacao} | ${r.motivo ?? ""} | - | - | - | - | - |`),
    ``,
  ];
  fs.writeFileSync(path.join(pasta, `${network.name}.md`), md.join("\n"));
  console.log(`\nGasto total: ${ethers.formatEther(resultado.gastoTotalWei)} ETH`);
  console.log(`Todos os cenários com o resultado esperado: ${resultado.todosConferem ? "sim" : "NÃO"}`);
  console.log(`Resultados gravados em resultados-redes/${network.name}.json e .md`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
