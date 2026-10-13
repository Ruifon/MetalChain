// Repete na rede Sepolia os cenários centrais do plano de validação, deixando
// cada operação registrada publicamente, com hash conferível no Etherscan:
//   1. gênese de uma bobina de 2.000 kg com o hash do certificado (CT01)
//   2. duas peças legítimas, de 1.500 kg e 400 kg (CT02)
//   3. tentativa de fraude: peça de 600 kg com saldo de 100 kg (CT03)
//   4. consulta pública da genealogia (CT09) e verificação do certificado (CT10)
//
// Uso: npx hardhat run scripts/cenarios-sepolia.js --network sepolia
// O endereço do contrato vem de CONTRATO_ENDERECO no .env.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const KG = 1000n;
const ETHERSCAN = "https://sepolia.etherscan.io/tx/";

async function main() {
  const endereco = process.env.CONTRATO_ENDERECO;
  if (!endereco) throw new Error("Defina CONTRATO_ENDERECO no arquivo .env");

  const [operador] = await ethers.getSigners();
  const mc = await ethers.getContractAt("MetalChain", endereco);
  const registros = [];
  const anotar = (cenario, descricao, tx, rec, situacao) => {
    registros.push({ cenario, descricao, hash: tx.hash, bloco: rec?.blockNumber ?? "-", gas: rec ? rec.gasUsed.toString() : "-", situacao });
    console.log(`  ${situacao.padEnd(9)} ${cenario}  ${descricao}\n            ${ETHERSCAN}${tx.hash}`);
  };

  console.log(`Rede: ${network.name}\nContrato: ${endereco}\nOperador: ${operador.address}\n`);

  // Certificado de demonstração (arquivo versionado no repositório)
  const arquivo = path.join(__dirname, "..", "certificados", "certificado-demonstracao.txt");
  const conteudo = fs.readFileSync(arquivo);
  const hashCert = ethers.sha256(conteudo);
  const bobinaId = process.env.BOBINA_ID || `BOB-SEPOLIA-${new Date().toISOString().slice(0, 10)}-${Date.now() % 100000}`;
  const dados = { lote: "CORRIDA-48213", norma: "ABNT NBR 7480", grau: "CA-50", certConformidade: "CERT-DEMO-0001" };
  console.log(`Bobina: ${bobinaId}\nHash do certificado: ${hashCert}\n`);

  // 1. Gênese
  let tx = await mc.connect(operador).registrarBobina(bobinaId, dados, 2000n * KG, hashCert, "");
  let rec = await tx.wait();
  anotar("CT01", "Gênese da bobina de 2.000 kg", tx, rec, "aceita");

  // 2. Peças legítimas
  const pecas = [];
  for (const [massa, desc] of [[1500n, "Vergalhão CA-50 10 mm - lote A"], [400n, "Vergalhão CA-50 10 mm - lote B"]]) {
    tx = await mc.connect(operador).gerarPeca(bobinaId, desc, 12000n, massa * KG);
    rec = await tx.wait();
    const ev = rec.logs.map((l) => { try { return mc.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "PecaGerada");
    pecas.push(ev.args.pecaId);
    anotar("CT02", `Peça nº ${ev.args.pecaId} de ${massa} kg (saldo restante: ${ev.args.saldoRestante / KG} kg)`, tx, rec, "aceita");
  }

  // 3. Tentativa de fraude: enviada com limite de gas fixo para que a recusa
  //    fique registrada na rede como transação revertida.
  tx = null;
  try {
    tx = await mc.connect(operador).gerarPeca(bobinaId, "Peça fraudulenta", 12000n, 600n * KG, { gasLimit: 300000 });
    rec = await tx.wait();
    anotar("CT03", "Peça de 600 kg com saldo de 100 kg", tx, rec, "ACEITA?!");
  } catch (e) {
    // Na Sepolia a transação é minerada com status de falha; em redes locais a
    // recusa pode ser informada já no envio. Nos dois casos, o saldo não muda.
    const hash = tx?.hash ?? e.receipt?.hash ?? e.transactionHash ?? "(recusada no envio)";
    rec = e.receipt ?? (hash.startsWith("0x") ? await ethers.provider.getTransactionReceipt(hash) : null);
    anotar("CT03", "Peça de 600 kg com saldo de 100 kg (massa insuficiente)", { hash }, rec, "revertida");
  }

  // 4. Leituras públicas (sem transação e sem custo)
  const [peca, bobina, industria] = await mc.consultarGenealogia(pecas[0]);
  const confere = await mc.verificarCertificado(bobinaId, hashCert);
  const alterado = Buffer.from(conteudo); alterado[alterado.indexOf("560")] = "6".charCodeAt(0);
  const diverge = await mc.verificarCertificado(bobinaId, ethers.sha256(alterado));
  const saldoFinal = (await mc.consultarBobina(bobinaId)).saldo;

  console.log(`\nConsulta pública da peça nº ${peca.id}: bobina ${peca.bobinaId}, norma ${bobina.norma}, registrada por "${industria}"`);
  console.log(`Saldo final da bobina: ${saldoFinal / KG} kg (esperado: 100 kg)`);
  console.log(`Certificado original confere: ${confere} | cópia alterada confere: ${diverge}`);

  // Relatório para o TCC
  const linhas = [
    `# Cenários executados na rede Sepolia`, ``,
    `- Data: ${new Date().toISOString()}`,
    `- Contrato: [${endereco}](https://sepolia.etherscan.io/address/${endereco})`,
    `- Operador: ${operador.address}`,
    `- Bobina: ${bobinaId}`,
    `- Hash SHA-256 do certificado: \`${hashCert}\``, ``,
    `| Cenário | Operação | Situação | Bloco | Gas | Transação |`,
    `|---|---|---|---|---|---|`,
    ...registros.map((r) => `| ${r.cenario} | ${r.descricao} | ${r.situacao} | ${r.bloco} | ${r.gas} | [${r.hash.slice(0, 10)}…](${ETHERSCAN}${r.hash}) |`),
    ``,
    `Leituras públicas (sem custo): genealogia da peça nº ${peca.id} retornou a bobina ${peca.bobinaId}, registrada por "${industria}"; saldo final de ${saldoFinal / KG} kg; certificado original confere = ${confere}; cópia alterada confere = ${diverge}.`,
  ];
  fs.writeFileSync("resultados-sepolia.md", linhas.join("\n") + "\n");
  console.log(`\nRelatório gravado em resultados-sepolia.md`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
