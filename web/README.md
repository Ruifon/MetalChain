# MetalChain — interface web

Publicada em **[metalchain.vercel.app](https://metalchain.vercel.app)**.

Interface do protótipo, feita em React com Vite e ethers.js. Lê e grava no
contrato publicado na Sepolia
([`0xB112…1cB7`](https://sepolia.etherscan.io/address/0xB112dc8970Fa8C27beA660f11F7B34B2Fbde1cB7), versão 3).

| Tela | Endereço | Quem usa | Precisa de carteira? |
|---|---|---|---|
| Consulta de peça | `/` e `/peca/<número>` | Consumidor, engenheiro, fiscal | Não |
| Área da indústria | `/operador` | Operador credenciado | Sim (MetaMask) |

## O que cada tela faz

**Consulta de peça** (a página aberta pelo QR Code)

- mostra a peça, a bitola ou espessura herdada, a bobina de origem e a indústria
  que fez cada registro;
- desenha a bobina inteira em uma barra: a parte que virou esta peça, as outras
  peças e o saldo ainda não usado, que somam a massa registrada na entrada;
- confere o certificado: o arquivo é lido no próprio aparelho, o SHA-256 é
  calculado no navegador e comparado pelo contrato (`verificarCertificado`);
- leva ao Etherscan: a transação da peça, o contrato e a carteira do operador.

**Área da indústria**

- conecta a MetaMask, troca para a rede Sepolia e confere se a carteira é de um
  operador credenciado;
- **Registrar bobina**: calcula o hash do arquivo do certificado, avisa se ele já
  está vinculado a outra bobina e grava a gênese com a especificação do produto
  (bitola ou espessura, massa linear e tolerância). Para vergalhões e fios, a massa
  linear e a tolerância são sugeridas a partir da bitola, como na ABNT NBR 7480;
- **Gerar peça**: a peça herda a bitola da bobina. O operador informa a quantidade,
  o comprimento de cada unidade e a massa pesada; a tela mostra a faixa de massa que
  o contrato aceita para aquele comprimento e uma prévia da baixa no saldo. Se a
  massa passa do saldo ou está fora da faixa, avisa antes de enviar e exibe a recusa
  do contrato;
- depois de gerar, mostra a etiqueta com o QR Code, que pode ser baixada em PNG.

Para a demonstração da fraude, o botão *Enviar mesmo assim* manda a transação
recusada para a rede, para que ela fique registrada no Etherscan como revertida.
A MetaMask avisa que a transação deve falhar; é só confirmar.

### Atenção na MetaMask

Ao confirmar uma transação, **desmarque a opção "Added protection"** (proteção
adicional) e não use a conta como "Smart Account". Com essas opções ligadas, a
MetaMask encaminha a chamada por um contrato intermediário próprio
(`DelegationManager`), a estimativa de gas fica curta e a gênese da bobina falha
por falta de gas. Na tela de confirmação, o destino deve ser o próprio contrato
MetalChain (`0xf8a4…6CdD`).

## Rodar no computador

```bash
cd web
npm install
npm run dev
```

Abra o endereço que aparecer (normalmente http://localhost:5173). Sem nenhum
arquivo `.env`, a interface já usa o contrato da Sepolia.

## Publicar no Vercel

1. Entre em [vercel.com](https://vercel.com) com a conta do GitHub.
2. **Add New → Project** e importe o repositório `Ruifon/MetalChain`.
3. Em **Root Directory**, escolha `web`. O Vercel reconhece o Vite sozinho
   (build `npm run build`, saída `dist`).
4. Clique em **Deploy**. Não é preciso configurar variáveis.

O arquivo `vercel.json` faz os links `/peca/<número>` funcionarem quando abertos
direto pelo QR Code. A cada `git push`, o Vercel publica a nova versão.

## Configuração (opcional)

As variáveis ficam em `.env.example`. Todas têm valor padrão para a Sepolia.

| Variável | Para que serve |
|---|---|
| `VITE_CONTRATO` | Endereço do contrato |
| `VITE_RPC_URL` | Nós de leitura, separados por vírgula (o segundo é usado se o primeiro falhar) |
| `VITE_CHAIN_ID`, `VITE_REDE_NOME` | Rede (11155111 = Sepolia) |
| `VITE_EXPLORER` | Explorador de blocos dos links |
| `VITE_BLOCO_INICIAL` | Bloco a partir do qual procurar a transação de uma peça |

Os valores `VITE_*` ficam visíveis no navegador. **Nunca coloque a chave privada
da carteira em nenhuma variável desta pasta.** As transações são assinadas pela
MetaMask.

## Estrutura

```
src/pages/Inicio.jsx              busca pelo número da peça
src/pages/Peca.jsx                página pública do QR Code
src/pages/Operador.jsx            área da indústria (MetaMask)
src/components/BarraMassa.jsx     a bobina em uma barra: peças + saldo = massa inicial
src/components/ConferirCertificado.jsx  hash do arquivo × hash gravado
src/components/Etiqueta.jsx       QR Code e etiqueta em PNG
src/lib/chain.js                  leitura, escrita e mensagens de erro do contrato
src/abi/MetalChain.json           ABI gerada pela compilação do contrato
```
