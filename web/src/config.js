// Valores padrão apontam para o contrato publicado na Sepolia. Para outra rede
// (por exemplo, a rede local do Hardhat), defina as variáveis em .env.local.
const env = import.meta.env;

export const CONTRATO = env.VITE_CONTRATO || "0xB112dc8970Fa8C27beA660f11F7B34B2Fbde1cB7";
export const CHAIN_ID = Number(env.VITE_CHAIN_ID || 11155111);
export const REDE_NOME = env.VITE_REDE_NOME || "Sepolia";
export const RPC_URL = env.VITE_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org";
export const EXPLORER = env.VITE_EXPLORER ?? "https://sepolia.etherscan.io";
export const BLOCO_INICIAL = Number(env.VITE_BLOCO_INICIAL || 11913380);
export const IPFS_GATEWAY = env.VITE_IPFS_GATEWAY || "https://ipfs.io/ipfs/";

// Rede de testes: o Ether não tem valor real.
export const REDE_DE_TESTES = CHAIN_ID !== 1;
