// Testes do contrato MetalChain v2 — cenários CT01 a CT13 do plano de validação.
// Unidades: massas em GRAMAS (2.000 kg = 2_000_000 g), comprimentos em MILÍMETROS,
// dimensão nominal em MICRÔMETROS, massa linear em GRAMAS POR METRO e tolerância
// em PONTOS-BASE (600 = 6%).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const KG = 1000n; // 1 kg em gramas
const BOBINA_ID = "BOB-2026-00731";

// Vergalhão CA-50 de 10 mm: massa linear nominal de 0,617 kg/m e tolerância
// de ±6% (ABNT NBR 7480).
const MASSA_LINEAR = 617n;
const DADOS = {
  lote: "CORRIDA-48213",
  norma: "ABNT NBR 7480",
  grau: "CA-50",
  certConformidade: "CERT-DEMO-0001",
  dimensaoNominal: 10000n,
  massaLinear: MASSA_LINEAR,
  toleranciaMassa: 600n,
};
const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

// Comprimento total (mm) correspondente a uma massa (g) da bitola de 10 mm.
const mm = (gramas) => (gramas * 1000n) / MASSA_LINEAR;

// Certificado de demonstração (no protótipo real, é o PDF enviado ao IPFS).
const CERTIFICADO = Buffer.from(
  "CERTIFICADO DE QUALIDADE - DEMONSTRACAO\n" +
    "Bobina: BOB-2026-00731 | Corrida: 48213 | Norma: ABNT NBR 7480 | Categoria: CA-50\n" +
    "Massa liquida: 2000 kg | Limite de escoamento: 560 MPa\n"
);
const HASH_CERT = ethers.sha256(CERTIFICADO);
const HASH_OUTRO = ethers.sha256(Buffer.from("Outro certificado"));

async function implantar() {
  const [admin, operador, intruso, consumidor] = await ethers.getSigners();
  const MetalChain = await ethers.getContractFactory("MetalChain");
  const mc = await MetalChain.deploy("Indústria Demonstração Ltda");
  await mc.credenciarOperador(operador.address, "Transformadora Exemplo S.A.");
  return { mc, admin, operador, intruso, consumidor };
}

async function comBobina() {
  const ctx = await implantar();
  await ctx.mc
    .connect(ctx.operador)
    .registrarBobina(BOBINA_ID, DADOS, 2000n * KG, HASH_CERT, CID);
  return ctx;
}

// Soma das massas das peças geradas a partir de uma bobina (via eventos).
async function massaDerivada(mc, bobinaId) {
  const eventos = await mc.queryFilter(mc.filters.PecaGerada());
  return eventos
    .filter((e) => e.args.bobinaId === bobinaId)
    .reduce((soma, e) => soma + e.args.massa, 0n);
}

async function invarianteValida(mc, bobinaId) {
  const b = await mc.consultarBobina(bobinaId);
  return b.massaInicial === b.saldo + (await massaDerivada(mc, bobinaId));
}

describe("MetalChain — plano de validação", function () {
  it("CT01 — gênese legítima: registra bobina de 2.000 kg com certificado e especificação", async function () {
    const { mc, operador } = await loadFixture(implantar);

    await expect(
      mc.connect(operador).registrarBobina(BOBINA_ID, DADOS, 2000n * KG, HASH_CERT, CID)
    )
      .to.emit(mc, "BobinaRegistrada")
      .withArgs(BOBINA_ID, 2000n * KG, HASH_CERT, operador.address);

    const b = await mc.consultarBobina(BOBINA_ID);
    expect(b.massaInicial).to.equal(2000n * KG);
    expect(b.saldo).to.equal(2000n * KG);
    expect(b.dimensaoNominal).to.equal(10000n);
    expect(b.massaLinear).to.equal(MASSA_LINEAR);
    expect(b.toleranciaMassa).to.equal(600n);
    expect(b.hashCertificado).to.equal(HASH_CERT);
    expect(b.cidCertificado).to.equal(CID);
    expect(b.operador).to.equal(operador.address);
    expect(await mc.bobinaDoCertificado(HASH_CERT)).to.equal(BOBINA_ID);
  });

  it("CT02 — transformação legítima: três peças somando 1.500 kg deixam saldo de 500 kg", async function () {
    const { mc, operador } = await loadFixture(comBobina);

    await mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe A", mm(500n * KG), 500n * KG);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe B", mm(600n * KG), 600n * KG);
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe C", mm(400n * KG), 400n * KG)
    )
      .to.emit(mc, "PecaGerada")
      .withArgs(3n, BOBINA_ID, 400n * KG, 500n * KG, operador.address);

    const b = await mc.consultarBobina(BOBINA_ID);
    expect(b.saldo).to.equal(500n * KG);
    expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
  });

  it("CT03 — fraude de massa: peça de 600 kg com saldo de 500 kg é revertida e o estado não muda", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe 1", mm(1500n * KG), 1500n * KG);
    const proximaAntes = await mc.proximaPeca();

    // comprimento coerente com 600 kg: a recusa vem do saldo, não da conferência de massa
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe fraudulento", mm(600n * KG), 600n * KG)
    ).to.be.revertedWith("MetalChain: massa insuficiente");

    expect((await mc.consultarBobina(BOBINA_ID)).saldo).to.equal(500n * KG);
    expect(await mc.proximaPeca()).to.equal(proximaAntes); // nenhuma peça criada
    expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
  });

  it("CT04 — consumo exato do saldo: aceita até zerar e recusa a peça seguinte", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe 1", mm(1500n * KG), 1500n * KG);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe 2 (consome o restante)", mm(500n * KG), 500n * KG);
    expect((await mc.consultarBobina(BOBINA_ID)).saldo).to.equal(0n);

    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Barra extra", mm(1n * KG), 1n * KG)
    ).to.be.revertedWith("MetalChain: massa insuficiente");
    expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
  });

  it("CT05 — origem inexistente: peça de bobina não registrada é revertida", async function () {
    const { mc, operador } = await loadFixture(implantar);
    await expect(
      mc.connect(operador).gerarPeca("BOB-INEXISTENTE", "Peça", mm(100n * KG), 100n * KG)
    ).to.be.revertedWith("MetalChain: bobina inexistente");
  });

  it("CT06 — gênese duplicada: o mesmo número de bobina não pode ser registrado duas vezes", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await expect(
      mc.connect(operador).registrarBobina(BOBINA_ID, DADOS, 9999n * KG, HASH_OUTRO, CID)
    ).to.be.revertedWith("MetalChain: bobina ja registrada");
    // a massa original permanece
    expect((await mc.consultarBobina(BOBINA_ID)).massaInicial).to.equal(2000n * KG);
  });

  it("CT07 — escrita não autorizada: carteira sem papel não registra, não gera peça e não credencia", async function () {
    const { mc, operador, intruso } = await loadFixture(comBobina);
    const OPERADOR = await mc.OPERADOR();
    const ADMIN = await mc.DEFAULT_ADMIN_ROLE();

    await expect(
      mc.connect(intruso).registrarBobina("BOB-FALSA", DADOS, 50000n * KG, HASH_OUTRO, CID)
    )
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount")
      .withArgs(intruso.address, OPERADOR);

    await expect(mc.connect(intruso).gerarPeca(BOBINA_ID, "Peça", mm(100n * KG), 100n * KG))
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount")
      .withArgs(intruso.address, OPERADOR);

    await expect(mc.connect(intruso).credenciarOperador(intruso.address, "Intruso"))
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount")
      .withArgs(intruso.address, ADMIN);

    // operador revogado também perde a escrita
    await mc.revogarOperador(operador.address);
    await expect(mc.connect(operador).gerarPeca(BOBINA_ID, "Peça", mm(100n * KG), 100n * KG))
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount");
  });

  it("CT08 — massa nula: bobina ou peça com massa zero são revertidas", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await expect(
      mc.connect(operador).registrarBobina("BOB-ZERO", DADOS, 0n, HASH_OUTRO, CID)
    ).to.be.revertedWith("MetalChain: massa invalida");
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Peça vazia", 12000n, 0n)
    ).to.be.revertedWith("MetalChain: massa invalida");
  });

  it("CT09 — consulta pública: qualquer carteira lê a genealogia, com a bitola herdada, sem custo", async function () {
    const { mc, operador, consumidor } = await loadFixture(comBobina);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Feixe de barras de 12 m", mm(300n * KG), 300n * KG);

    const saldoAntes = await ethers.provider.getBalance(consumidor.address);
    const [peca, bobina, industriaPeca, industriaBobina] =
      await mc.connect(consumidor).consultarGenealogia(1n);
    const saldoDepois = await ethers.provider.getBalance(consumidor.address);

    expect(peca.bobinaId).to.equal(BOBINA_ID);
    expect(peca.massa).to.equal(300n * KG);
    expect(bobina.norma).to.equal("ABNT NBR 7480");
    expect(bobina.dimensaoNominal).to.equal(10000n); // a peça herda a bitola por referência
    expect(bobina.hashCertificado).to.equal(HASH_CERT);
    expect(bobina.cidCertificado).to.equal(CID);
    expect(industriaPeca).to.equal("Transformadora Exemplo S.A.");
    expect(industriaBobina).to.equal("Transformadora Exemplo S.A.");
    expect(saldoDepois).to.equal(saldoAntes); // leitura não consome Ether

    // o nome continua disponível mesmo após a revogação (histórico)
    await mc.revogarOperador(operador.address);
    const [, , nomeAposRevogar] = await mc.consultarGenealogia(1n);
    expect(nomeAposRevogar).to.equal("Transformadora Exemplo S.A.");
  });

  it("CT10 — integridade do certificado: o original confere e uma cópia com 1 byte alterado diverge", async function () {
    const { mc, consumidor } = await loadFixture(comBobina);

    const alterado = Buffer.from(CERTIFICADO);
    alterado[alterado.indexOf("560")] = "6".charCodeAt(0); // 560 MPa -> 660 MPa

    expect(await mc.connect(consumidor).verificarCertificado(BOBINA_ID, ethers.sha256(CERTIFICADO))).to.equal(true);
    expect(await mc.connect(consumidor).verificarCertificado(BOBINA_ID, ethers.sha256(alterado))).to.equal(false);
  });

  it("CT11 — certificado reutilizado: o mesmo certificado não sustenta uma segunda bobina", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await expect(
      mc.connect(operador).registrarBobina("BOB-COPIA", DADOS, 2000n * KG, HASH_CERT, CID)
    ).to.be.revertedWith("MetalChain: certificado ja utilizado");
    await expect(mc.consultarBobina("BOB-COPIA")).to.be.revertedWith("MetalChain: bobina inexistente");
    expect(await mc.bobinaDoCertificado(HASH_CERT)).to.equal(BOBINA_ID);

    // com outro certificado, a gênese é aceita
    await mc.connect(operador).registrarBobina("BOB-NOVA", DADOS, 2000n * KG, HASH_OUTRO, "");
    expect(await mc.bobinaDoCertificado(HASH_OUTRO)).to.equal("BOB-NOVA");
  });

  it("CT12 — massa incompatível com o comprimento: recusa fora da tolerância e aceita nos limites", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    // barra de 12 m de 10 mm: massa nominal de 12 × 617 g = 7.404 g; tolerância de ±6%
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Barra declarada com 450 kg", 12000n, 450n * KG)
    ).to.be.revertedWith("MetalChain: massa incompativel com o comprimento");
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Barra 6,1% acima", 12000n, 7849n)
    ).to.be.revertedWith("MetalChain: massa incompativel com o comprimento");
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Barra 6,1% abaixo", 12000n, 6959n)
    ).to.be.revertedWith("MetalChain: massa incompativel com o comprimento");

    await mc.connect(operador).gerarPeca(BOBINA_ID, "Barra 6% acima", 12000n, 7848n);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Barra 6% abaixo", 12000n, 6960n);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Barra nominal", 12000n, 7404n);
    expect(await mc.proximaPeca()).to.equal(4n);
    expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
  });

  it("CT13 — especificação inválida: recusa peça sem comprimento e gênese sem dimensão, massa linear ou com tolerância excessiva", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Sem comprimento", 0n, 100n * KG)
    ).to.be.revertedWith("MetalChain: comprimento invalido");

    await expect(
      mc.connect(operador).registrarBobina("BOB-X", { ...DADOS, dimensaoNominal: 0n }, 2000n * KG, HASH_OUTRO, "")
    ).to.be.revertedWith("MetalChain: dimensao invalida");
    await expect(
      mc.connect(operador).registrarBobina("BOB-X", { ...DADOS, massaLinear: 0n }, 2000n * KG, HASH_OUTRO, "")
    ).to.be.revertedWith("MetalChain: massa linear invalida");
    await expect(
      mc.connect(operador).registrarBobina("BOB-X", { ...DADOS, toleranciaMassa: 2001n }, 2000n * KG, HASH_OUTRO, "")
    ).to.be.revertedWith("MetalChain: tolerancia invalida");
  });
});

describe("MetalChain — invariante de massa (sequência aleatória)", function () {
  it("mantém massaInicial = saldo + Σ peças em 60 operações, aceitando só as que cabem no saldo", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    let semente = 20261013n;
    const aleatorio = (max) => {
      semente = (semente * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
      return (semente % max) + 1n;
    };

    let aceitas = 0;
    let recusadas = 0;
    for (let i = 0; i < 60; i++) {
      const { saldo } = await mc.consultarBobina(BOBINA_ID);
      const massa = aleatorio(149n * KG) + 1n * KG; // entre 1 kg e 150 kg
      const comprimento = mm(massa); // coerente com a bitola
      if (massa <= saldo) {
        await mc.connect(operador).gerarPeca(BOBINA_ID, `Peça ${i}`, comprimento, massa);
        aceitas++;
      } else {
        await expect(
          mc.connect(operador).gerarPeca(BOBINA_ID, `Peça ${i}`, comprimento, massa)
        ).to.be.revertedWith("MetalChain: massa insuficiente");
        recusadas++;
      }
      expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
    }
    console.log(`        operações aceitas: ${aceitas} | recusadas pelo contrato: ${recusadas}`);
  });
});
