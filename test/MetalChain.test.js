// Testes do contrato MetalChain — cenários CT01 a CT10 do Quadro 6 do TCC.
// Massas em GRAMAS: 2.000 kg = 2_000_000 g.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const KG = 1000n; // 1 kg em gramas
const BOBINA_ID = "BOB-2026-00731";
const DADOS = {
  lote: "CORRIDA-48213",
  norma: "ABNT NBR 7480",
  grau: "CA-50",
  certConformidade: "CERT-DEMO-0001",
};
const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

// Certificado de demonstração (no protótipo real, é o PDF enviado ao IPFS).
const CERTIFICADO = Buffer.from(
  "CERTIFICADO DE QUALIDADE - DEMONSTRACAO\n" +
    "Bobina: BOB-2026-00731 | Corrida: 48213 | Norma: ABNT NBR 7480 | Categoria: CA-50\n" +
    "Massa liquida: 2000 kg | Limite de escoamento: 560 MPa\n"
);
const HASH_CERT = ethers.sha256(CERTIFICADO);

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

describe("MetalChain — plano de validação (Quadro 6)", function () {
  it("CT01 — gênese legítima: registra bobina de 2.000 kg com hash do certificado", async function () {
    const { mc, operador } = await loadFixture(implantar);

    await expect(
      mc.connect(operador).registrarBobina(BOBINA_ID, DADOS, 2000n * KG, HASH_CERT, CID)
    )
      .to.emit(mc, "BobinaRegistrada")
      .withArgs(BOBINA_ID, 2000n * KG, HASH_CERT, operador.address);

    const b = await mc.consultarBobina(BOBINA_ID);
    expect(b.massaInicial).to.equal(2000n * KG);
    expect(b.saldo).to.equal(2000n * KG);
    expect(b.hashCertificado).to.equal(HASH_CERT);
    expect(b.cidCertificado).to.equal(CID);
    expect(b.operador).to.equal(operador.address);
  });

  it("CT02 — transformação legítima: três peças somando 1.500 kg deixam saldo de 500 kg", async function () {
    const { mc, operador } = await loadFixture(comBobina);

    await mc.connect(operador).gerarPeca(BOBINA_ID, "Vergalhão CA-50 10 mm - lote A", 12000n, 500n * KG);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Vergalhão CA-50 10 mm - lote B", 12000n, 600n * KG);
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Vergalhão CA-50 10 mm - lote C", 12000n, 400n * KG)
    )
      .to.emit(mc, "PecaGerada")
      .withArgs(3n, BOBINA_ID, 400n * KG, 500n * KG, operador.address);

    const b = await mc.consultarBobina(BOBINA_ID);
    expect(b.saldo).to.equal(500n * KG);
    expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
  });

  it("CT03 — fraude de massa: peça de 600 kg com saldo de 500 kg é revertida e o estado não muda", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Peça 1", 12000n, 1500n * KG);
    const proximaAntes = await mc.proximaPeca();

    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Peça fraudulenta", 12000n, 600n * KG)
    ).to.be.revertedWith("MetalChain: massa insuficiente");

    expect((await mc.consultarBobina(BOBINA_ID)).saldo).to.equal(500n * KG);
    expect(await mc.proximaPeca()).to.equal(proximaAntes); // nenhuma peça criada
    expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
  });

  it("CT04 — consumo exato do saldo: aceita até zerar e recusa a peça seguinte", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Peça 1", 12000n, 1500n * KG);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Peça 2 (consome o restante)", 4000n, 500n * KG);
    expect((await mc.consultarBobina(BOBINA_ID)).saldo).to.equal(0n);

    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Peça 3", 10n, 1n) // 1 grama
    ).to.be.revertedWith("MetalChain: massa insuficiente");
    expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
  });

  it("CT05 — origem inexistente: peça de bobina não registrada é revertida", async function () {
    const { mc, operador } = await loadFixture(implantar);
    await expect(
      mc.connect(operador).gerarPeca("BOB-INEXISTENTE", "Peça", 12000n, 100n * KG)
    ).to.be.revertedWith("MetalChain: bobina inexistente");
  });

  it("CT06 — gênese duplicada: o mesmo número de bobina não pode ser registrado duas vezes", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await expect(
      mc.connect(operador).registrarBobina(BOBINA_ID, DADOS, 9999n * KG, HASH_CERT, CID)
    ).to.be.revertedWith("MetalChain: bobina ja registrada");
    // a massa original permanece
    expect((await mc.consultarBobina(BOBINA_ID)).massaInicial).to.equal(2000n * KG);
  });

  it("CT07 — escrita não autorizada: carteira sem papel não registra, não gera peça e não credencia", async function () {
    const { mc, operador, intruso } = await loadFixture(comBobina);
    const OPERADOR = await mc.OPERADOR();
    const ADMIN = await mc.DEFAULT_ADMIN_ROLE();

    await expect(
      mc.connect(intruso).registrarBobina("BOB-FALSA", DADOS, 50000n * KG, HASH_CERT, CID)
    )
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount")
      .withArgs(intruso.address, OPERADOR);

    await expect(mc.connect(intruso).gerarPeca(BOBINA_ID, "Peça", 12000n, 100n * KG))
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount")
      .withArgs(intruso.address, OPERADOR);

    await expect(mc.connect(intruso).credenciarOperador(intruso.address, "Intruso"))
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount")
      .withArgs(intruso.address, ADMIN);

    // operador revogado também perde a escrita
    await mc.revogarOperador(operador.address);
    await expect(mc.connect(operador).gerarPeca(BOBINA_ID, "Peça", 12000n, 100n * KG))
      .to.be.revertedWithCustomError(mc, "AccessControlUnauthorizedAccount");
  });

  it("CT08 — massa nula: bobina ou peça com massa zero são revertidas", async function () {
    const { mc, operador } = await loadFixture(comBobina);
    await expect(
      mc.connect(operador).registrarBobina("BOB-ZERO", DADOS, 0n, HASH_CERT, CID)
    ).to.be.revertedWith("MetalChain: massa invalida");
    await expect(
      mc.connect(operador).gerarPeca(BOBINA_ID, "Peça vazia", 12000n, 0n)
    ).to.be.revertedWith("MetalChain: massa invalida");
  });

  it("CT09 — consulta pública: qualquer carteira lê a genealogia, sem papel e sem custo", async function () {
    const { mc, operador, consumidor } = await loadFixture(comBobina);
    await mc.connect(operador).gerarPeca(BOBINA_ID, "Vergalhão CA-50 10 mm - barra 12 m", 12000n, 300n * KG);

    const saldoAntes = await ethers.provider.getBalance(consumidor.address);
    const [peca, bobina, industriaPeca, industriaBobina] =
      await mc.connect(consumidor).consultarGenealogia(1n);
    const saldoDepois = await ethers.provider.getBalance(consumidor.address);

    expect(peca.bobinaId).to.equal(BOBINA_ID);
    expect(peca.massa).to.equal(300n * KG);
    expect(bobina.norma).to.equal("ABNT NBR 7480");
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
      const massa = aleatorio(150n * KG); // entre 1 g e 150 kg
      if (massa <= saldo) {
        await mc.connect(operador).gerarPeca(BOBINA_ID, `Peça ${i}`, 6000n, massa);
        aceitas++;
      } else {
        await expect(
          mc.connect(operador).gerarPeca(BOBINA_ID, `Peça ${i}`, 6000n, massa)
        ).to.be.revertedWith("MetalChain: massa insuficiente");
        recusadas++;
      }
      expect(await invarianteValida(mc, BOBINA_ID)).to.equal(true);
    }
    console.log(`        operações aceitas: ${aceitas} | recusadas pelo contrato: ${recusadas}`);
  });
});
