require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;
const contas = PRIVATE_KEY ? [PRIVATE_KEY] : [];

// Apenas para ambientes sem acesso ao download do compilador oficial:
// usa o solcjs instalado pelo npm. No uso normal, deixe SOLC_LOCAL vazio
// e o Hardhat baixa o compilador sozinho.
if (process.env.SOLC_LOCAL === "1") {
  const { subtask } = require("hardhat/config");
  const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    if (args.solcVersion === "0.8.24") {
      return {
        compilerPath: require.resolve("solc/soljson.js"),
        isSolcJs: true,
        version: args.solcVersion,
        longVersion: "0.8.24+commit.e11b9ed9",
      };
    }
    return runSuper();
  });
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // Rede local: NO_THROW=1 faz o nó registrar transações revertidas, como
    // uma rede pública, em vez de interromper o script (scripts/comparar-redes.js).
    hardhat: { throwOnTransactionFailures: process.env.NO_THROW !== "1" },
    sepolia: { url: SEPOLIA_RPC_URL || "", accounts: contas, chainId: 11155111 },
    // Redes usadas na comparação de custos. Os endereços públicos funcionam
    // sem cadastro; com uma chave da Alchemy, use as URLs dela no .env.
    hoodi: {
      url: process.env.HOODI_RPC_URL || "https://ethereum-hoodi-rpc.publicnode.com",
      accounts: contas, chainId: 560048,
    },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: contas, chainId: 421614,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: contas, chainId: 84532,
    },
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "1",
    noColors: true,
    outputFile: process.env.REPORT_GAS === "1" ? "relatorio-gas.txt" : undefined,
    offline: true,
  },
};
