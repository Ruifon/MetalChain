// Junta os resultados de scripts/comparar-redes.js em uma tabela comparativa.
// Uso: node scripts/tabela-redes.js   (grava resultados-redes/comparacao.md)
const fs = require("fs");
const path = require("path");

const pasta = path.join(__dirname, "..", "resultados-redes");
const ORDEM = ["hardhat", "localhost", "sepolia", "hoodi", "arbitrumSepolia", "baseSepolia"];
const NOMES = {
  hardhat: "Local (Hardhat)", localhost: "Local (Hardhat)", sepolia: "Sepolia (L1)", hoodi: "Hoodi (L1)",
  arbitrumSepolia: "Arbitrum Sepolia (L2)", baseSepolia: "Base Sepolia (L2)",
};
const LINHAS = [
  ["Implantação do contrato", (r) => r.operacao === "Implantação do contrato"],
  ["credenciarOperador", (r) => r.operacao === "credenciarOperador"],
  ["registrarBobina (CT01)", (r) => r.cenario === "CT01"],
  ["gerarPeca (CT02)", (r) => r.cenario === "CT02"],
  ["Recusa: massa insuficiente (CT03)", (r) => r.cenario === "CT03"],
  ["Recusa: massa incompatível (CT12)", (r) => r.cenario === "CT12"],
  ["Recusa: certificado repetido (CT11)", (r) => r.cenario === "CT11"],
  ["Recusa: bobina de outra indústria (CT14)", (r) => r.cenario === "CT14" && r.situacao !== "aceita"],
];

const redes = fs.readdirSync(pasta).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(pasta, f), "utf8")))
  .sort((a, b) => ORDEM.indexOf(a.rede) - ORDEM.indexOf(b.rede));
if (!redes.length) throw new Error("Nenhum resultado em resultados-redes/. Rode antes scripts/comparar-redes.js.");

const milhar = (n) => BigInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const eth = (wei) => {
  const v = Number(BigInt(wei)) / 1e18;
  return v === 0 ? "0" : v < 0.000001 ? v.toExponential(2).replace(".", ",") : v.toFixed(6).replace(".", ",");
};
const achar = (rede, teste) => rede.registros.find((r) => teste(r) && r.hash);

const cab = `| Operação | ${redes.map((r) => NOMES[r.rede] || r.rede).join(" | ")} |`;
const sep = `|---|${redes.map(() => "---:").join("|")}|`;

const saida = [
  `# Comparação do roteiro de validação entre redes`, ``,
  `Mesmo contrato (versão ${redes[0].versao}), mesmo roteiro e mesmos dados em todas as redes.`, ``,
  `## Gas usado`, ``, cab, sep,
  ...LINHAS.map(([rot, t]) => `| ${rot} | ${redes.map((r) => { const x = achar(r, t); return x ? milhar(x.gasUsado) : "—"; }).join(" | ")} |`),
  ``,
  `## Taxa paga (ETH de teste)`, ``, cab, sep,
  ...LINHAS.map(([rot, t]) => `| ${rot} | ${redes.map((r) => { const x = achar(r, t); return x ? eth(x.taxaTotalWei) : "—"; }).join(" | ")} |`),
  `| **Preço do gas na peça (gwei)** | ${redes.map((r) => { const x = achar(r, LINHAS[3][1]); return x ? (Number(x.precoGasWei) / 1e9).toString().replace(".", ",") : "—"; }).join(" | ")} |`,
  ``,
  `## Conferência`, ``,
  ...redes.map((r) => `- ${NOMES[r.rede] || r.rede}: contrato ${r.contrato}; todos os cenários com o resultado esperado: ${r.todosConferem ? "sim" : "NÃO"}; gasto total ${eth(r.gastoTotalWei)} ETH`),
  ``,
  `Nas redes de camada 2, parte da taxa paga corresponde à publicação dos dados na camada 1:`,
  `na Base, ela aparece separada (l1Fee) e está somada à taxa total; na Arbitrum, ela já está`,
  `embutida no gas usado. Por isso, entre camadas diferentes, a comparação justa é pela taxa, não pelo gas.`,
  ``,
];
fs.writeFileSync(path.join(pasta, "comparacao.md"), saida.join("\n"));
console.log(saida.join("\n"));
