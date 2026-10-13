// Publica o MetalChain na rede escolhida e, se informado, credencia um operador.
// Uso: npx hardhat run scripts/deploy.js --network sepolia
const { ethers, network } = require("hardhat");

async function main() {
  const nome = process.env.NOME_INDUSTRIA || "Indústria Demonstração Ltda";
  const [admin] = await ethers.getSigners();
  console.log(`Rede: ${network.name}`);
  console.log(`Carteira administradora: ${admin.address}`);

  const fabrica = await ethers.getContractFactory("MetalChain");
  const mc = await fabrica.deploy(nome);
  await mc.waitForDeployment();
  const endereco = await mc.getAddress();
  const tx = mc.deploymentTransaction();
  console.log(`\nContrato publicado em: ${endereco}`);
  console.log(`Transação de implantação: ${tx.hash}`);
  if (network.name === "sepolia") {
    console.log(`Etherscan: https://sepolia.etherscan.io/address/${endereco}`);
  }

  const operador = process.env.OPERADOR_CARTEIRA;
  if (operador) {
    const nomeOp = process.env.OPERADOR_NOME || "Operador de demonstração";
    const t = await mc.credenciarOperador(operador, nomeOp);
    await t.wait();
    console.log(`\nOperador credenciado: ${operador} (${nomeOp}) — tx ${t.hash}`);
  }

  console.log(`\nPara verificar o código no Etherscan:`);
  console.log(`npx hardhat verify --network ${network.name} ${endereco} "${nome}"`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
