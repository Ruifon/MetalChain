# MetalChain

Protótipo de rastreabilidade de aço fracionado em *blockchain*. O sistema preserva
o vínculo imutável entre cada peça derivada e o certificado de origem da bobina, e
faz controle de massa por baixa (*burn*) e emissão (*mint*).

TCC do Bacharelado em Sistemas de Informação, Ifes Campus Cachoeiro de Itapemirim
(2026). Autor: Rui de Souza Fontoura Junior. Orientador: Prof. Dr. João Paulo de
Brito Gonçalves.

## Estrutura

```
contracts/MetalChain.sol        contrato (Solidity 0.8.24 + OpenZeppelin AccessControl)
test/MetalChain.test.js         cenários CT01 a CT10 (Quadro 6 do TCC) + invariante de massa
scripts/deploy.js               publicação na Sepolia (e credenciamento opcional de operador)
scripts/medir-gas.js            gas por operação e evolução do custo de gerarPeca
scripts/hash-certificado.js     SHA-256 de um arquivo (PDF do certificado) em formato bytes32
```

## Pré-requisitos

- Node.js 18 ou superior (testado com Node 22)
- Para a Sepolia: carteira MetaMask **de testes**, Ether de teste (*faucet*) e uma
  URL RPC (Alchemy, Infura ou similar)

## Instalação

```bash
npm install
```

## Compilar e testar (rede local, sem custo)

```bash
npx hardhat compile
npx hardhat test
```

Resultado esperado: **11 testes aprovados**, ou seja, os 10 cenários do Quadro 6 e
a verificação da invariante de massa em 60 operações aleatórias.

## Medir o gas

```bash
npx hardhat run scripts/medir-gas.js
```

Para gerar o relatório completo dos testes, rode `REPORT_GAS=1 npx hardhat test`.
No Windows (PowerShell), use `$env:REPORT_GAS=1; npx hardhat test`. O relatório é
gravado em `relatorio-gas.txt`.

## Publicar na Sepolia

1. Copie `.env.example` para `.env` e preencha `SEPOLIA_RPC_URL` e `PRIVATE_KEY`.
   Use **somente** uma carteira criada para testes.
2. Obtenha Ether de teste em um *faucet* da Sepolia.
3. Publique o contrato:
   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```
4. Guarde o endereço do contrato e o *hash* da transação. Eles vão para o capítulo
   de resultados, e qualquer pessoa pode conferi-los no Etherscan.
5. (Opcional) Verifique o código-fonte no Etherscan com o comando que o script
   imprime no final.

## Calcular o hash de um certificado

```bash
node scripts/hash-certificado.js certificado.pdf
```

O valor impresso (`0x…`) é o `hashCertificado` usado em `registrarBobina`.

## Unidades

- Massas: inteiros em **gramas** (2.000 kg = `2000000`)
- Comprimentos: inteiros em **milímetros**

## Observação

A variável `SOLC_LOCAL` no `hardhat.config.js` só serve para ambientes sem acesso
ao download do compilador oficial. No uso normal, deixe-a em branco.
