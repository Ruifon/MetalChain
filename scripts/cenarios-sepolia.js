// Repete na rede Sepolia os cenários centrais do plano de validação (contrato v3),
// deixando cada operação registrada publicamente, com hash conferível no Etherscan:
//   CT01  gênese de um rolo de vergalhão CA-50 de 10 mm, 2.000 kg, com o hash do certificado
//   CT02  dois feixes legítimos de barras de 12 m, pesados (massa real dentro da tolerância)
//   CT03  fraude de saldo: feixe coerente com o comprimento, mas maior que o saldo
//   CT12  fraude de especificação: uma barra de 12 m declarada com 450 kg
//   CT11  fraude de certificado: segunda bobina com o mesmo certificado
//   CT09/CT10  consulta pública da genealogia e verificação do certificado
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
  const anotar = (cenario, descricao, hash, rec, situacao) => {
    registros.push({ cenario, descricao, hash, bloco: rec?.blockNumber ?? "-", gas: rec ? rec.gasUsed.toString() : "-", situacao });
    console.log(`  ${situacao.padEnd(9)} ${cenario}  ${descricao}\n            ${ETHERSCAN}${hash}`);
  };

  // Envia uma operação que o contrato deve recusar, com limite de gas fixo, para
  // que a recusa fique registrada na rede como transação revertida.
  async function tentarFraude(cenario, descricao, enviar) {
    let tx = null;
    try {
      tx = await enviar({ gasLimit: 300000 });
      const rec = await tx.wait();
      anotar(cenario, descricao, tx.hash, rec, "ACEITA?!");
    } catch (e) {
      const hash = tx?.hash ?? e.receipt?.hash ?? e.transactionHash ?? "(recusada no envio)";
      const rec = e.receipt ?? (hash.startsWith("0x") ? await ethers.provider.getTransactionReceipt(hash) : null);
      anotar(cenario, descricao, hash, rec, "revertida");
    }
  }

  console.log(`Rede: ${network.name}\nContrato: ${endereco}\nVersão: ${await mc.VERSAO()}\nOperador: ${operador.address}\n`);

  // Certificado de demonstração (arquivo versionado no repositório)
  const arquivo = path.join(__dirname, "..", "certificados", "certificado-demonstracao.txt");
  const conteudo = fs.readFileSync(arquivo);
  const hashCert = ethers.sha256(conteudo);
  const sufixo = `${new Date().toISOString().slice(0, 10)}-${Date.now() % 100000}`;
  const bobinaId = process.env.BOBINA_ID || `BOB-V3-${sufixo}`;

  // Vergalhão CA-50 de 10 mm em rolo: 0,617 kg/m, tolerância de ±6% (ABNT NBR 7480)
  const dados = {
    lote: "CORRIDA-48213", norma: "ABNT NBR 7480", grau: "CA-50", certConformidade: "CERT-DEMO-0001",
    dimensaoNominal: 10000n, massaLinear: 617n, toleranciaMassa: 600n,
  };
  console.log(`Bobina: ${bobinaId}\nHash do certificado: ${hashCert}\n`);

  // CT01 — gênese
  let tx = await mc.connect(operador).registrarBobina(bobinaId, dados, 2000n * KG, hashCert, "");
  let rec = await tx.wait();
  anotar("CT01", "Gênese do rolo de 2.000 kg (10 mm, 617 g/m, ±6%)", tx.hash, rec, "aceita");

  // CT02 — feixes de barras de 12 m, com a massa pesada na balança
  const pecas = [];
  for (const [barras, massaKg] of [[100n, 745n], [80n, 590n]]) {
    const comprimento = barras * 12000n; // mm
    const desc = `Feixe com ${barras} barras de 12 m`;
    tx = await mc.connect(operador).gerarPeca(bobinaId, desc, comprimento, massaKg * KG);
    rec = await tx.wait();
    const ev = rec.logs.map((l) => { try { return mc.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "PecaGerada");
    pecas.push(ev.args.pecaId);
    anotar("CT02", `Peça nº ${ev.args.pecaId}: ${barras} barras, ${massaKg} kg (saldo restante: ${ev.args.saldoRestante / KG} kg)`, tx.hash, rec, "aceita");
  }

  // CT03 — fraude de saldo: 120 barras (888 kg nominais) com saldo de 665 kg
  await tentarFraude("CT03", "Feixe de 120 barras (890 kg) com saldo de 665 kg (massa insuficiente)",
    (o) => mc.connect(operador).gerarPeca(bobinaId, "Feixe com 120 barras de 12 m", 120n * 12000n, 890n * KG, o));

  // CT12 — fraude de especificação: uma barra de 12 m (7,4 kg nominais) declarada com 450 kg
  await tentarFraude("CT12", "Barra de 12 m declarada com 450 kg (massa incompatível com o comprimento)",
    (o) => mc.connect(operador).gerarPeca(bobinaId, "Barra de 12 m", 12000n, 450n * KG, o));

  // CT11 — fraude de certificado: outra bobina com o mesmo certificado
  await tentarFraude("CT11", "Segunda bobina com o mesmo certificado (certificado já utilizado)",
    (o) => mc.connect(operador).registrarBobina(`${bobinaId}-COPIA`, dados, 2000n * KG, hashCert, "", o));

  // CT09/CT10 — leituras públicas (sem transação e sem custo)
  const [peca, bobina, industria] = await mc.consultarGenealogia(pecas[0]);
  const confere = await mc.verificarCertificado(bobinaId, hashCert);
  const alterado = Buffer.from(conteudo); alterado[alterado.indexOf("560")] = "6".charCodeAt(0);
  const diverge = await mc.verificarCertificado(bobinaId, ethers.sha256(alterado));
  const saldoFinal = (await mc.consultarBobina(bobinaId)).saldo;
  const dono = await mc.bobinaDoCertificado(hashCert);

  console.log(`\nConsulta pública da peça nº ${peca.id}: bobina ${peca.bobinaId}, bitola herdada ${Number(bobina.dimensaoNominal) / 1000} mm, registrada por "${industria}"`);
  console.log(`Saldo final da bobina: ${saldoFinal / KG} kg (esperado: 665 kg)`);
  console.log(`Certificado original confere: ${confere} | cópia alterada confere: ${diverge} | certificado vinculado a: ${dono}`);

  // Relatório para o TCC
  const linhas = [
    `# Cenários executados na rede Sepolia (contrato v3)`, ``,
    `- Data: ${new Date().toISOString()}`,
    `- Contrato: [${endereco}](https://sepolia.etherscan.io/address/${endereco})`,
    `- Operador: ${operador.address}`,
    `- Bobina: ${bobinaId} (vergalhão CA-50 10 mm, 617 g/m, tolerância ±6%)`,
    `- Hash SHA-256 do certificado: \`${hashCert}\``, ``,
    `| Cenário | Operação | Situação | Bloco | Gas | Transação |`,
    `|---|---|---|---|---|---|`,
    ...registros.map((r) => `| ${r.cenario} | ${r.descricao} | ${r.situacao} | ${r.bloco} | ${r.gas} | [${r.hash.slice(0, 10)}…](${ETHERSCAN}${r.hash}) |`),
    ``,
    `Leituras públicas (sem custo): genealogia da peça nº ${peca.id} retornou a bobina ${peca.bobinaId}, bitola herdada de ${Number(bobina.dimensaoNominal) / 1000} mm, registrada por "${industria}"; saldo final de ${saldoFinal / KG} kg; certificado original confere = ${confere}; cópia alterada confere = ${diverge}; certificado vinculado à bobina ${dono}.`,
  ];
  fs.writeFileSync("resultados-sepolia-v3.md", linhas.join("\n") + "\n");
  console.log(`\nRelatório gravado em resultados-sepolia-v3.md`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
