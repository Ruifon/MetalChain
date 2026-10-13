// Mede o gas de implantação e de cada função de escrita, e verifica se o custo
// de gerarPeca permanece constante à medida que o número de peças cresce.
// Uso: npx hardhat run scripts/medir-gas.js
const { ethers } = require("hardhat");

async function main() {
  const [admin, operador] = await ethers.getSigners();
  const KG = 1000n;
  const linhas = [];
  const gas = async (txPromise) => (await (await txPromise).wait()).gasUsed;

  const fabrica = await ethers.getContractFactory("MetalChain");
  const mc = await fabrica.deploy("Indústria Demonstração Ltda");
  const recDeploy = await mc.deploymentTransaction().wait();
  linhas.push(["Implantação do contrato", recDeploy.gasUsed]);

  linhas.push(["credenciarOperador", await gas(
    mc.credenciarOperador(operador.address, "Transformadora Exemplo S.A."))]);

  const dados = { lote: "CORRIDA-48213", norma: "ABNT NBR 7480", grau: "CA-50", certConformidade: "CERT-DEMO-0001" };
  const hash = ethers.sha256(ethers.toUtf8Bytes("certificado de demonstracao"));
  const cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
  linhas.push(["registrarBobina", await gas(
    mc.connect(operador).registrarBobina("BOB-2026-00731", dados, 2000n * KG, hash, cid))]);

  // gerarPeca repetido 200 vezes com descrição de mesmo tamanho
  const marcos = new Set([1, 2, 10, 50, 100, 200]);
  const evolucao = [];
  for (let i = 1; i <= 200; i++) {
    const desc = `Vergalhao CA-50 10 mm - barra ${String(i).padStart(3, "0")}`;
    const g = await gas(mc.connect(operador).gerarPeca("BOB-2026-00731", desc, 12000n, 5n * KG));
    if (marcos.has(i)) evolucao.push([i, g]);
  }
  linhas.push(["gerarPeca (1ª peça)", evolucao[0][1]]);
  linhas.push(["gerarPeca (200ª peça)", evolucao[evolucao.length - 1][1]]);

  linhas.push(["revogarOperador", await gas(mc.revogarOperador(operador.address))]);

  // leituras: custo zero para quem consulta (eth_call); estimativa apenas ilustrativa
  const estGen = await mc.consultarGenealogia.estimateGas(1n);
  const estVer = await mc.verificarCertificado.estimateGas("BOB-2026-00731", hash);

  console.log("\nGAS POR OPERAÇÃO (rede local Hardhat, otimizador ligado, 200 runs)");
  console.log("-".repeat(52));
  for (const [nome, g] of linhas) console.log(nome.padEnd(32), g.toString().padStart(10));
  console.log("\nLEITURAS (eth_call: não geram transação nem custo)");
  console.log("consultarGenealogia (estimativa)".padEnd(32), estGen.toString().padStart(10));
  console.log("verificarCertificado (estimativa)".padEnd(32), estVer.toString().padStart(10));
  console.log("\nEVOLUÇÃO DO GAS DE gerarPeca");
  for (const [n, g] of evolucao) console.log(`  peça nº ${String(n).padStart(3)}: ${g}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
