import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { kg, metros } from "../lib/formato.js";

/** URL pública da peça. O hash da transação vai junto para o link do Etherscan. */
export function urlDaPeca(pecaId, txHash) {
  const base = `${window.location.origin}/peca/${pecaId}`;
  return txHash ? `${base}?tx=${txHash}` : base;
}

/**
 * Etiqueta para fixar na peça: QR Code com o link da consulta pública e os
 * dados mínimos para identificação visual. Pode ser baixada em PNG.
 */
export default function Etiqueta({ pecaId, txHash, descricao, bobinaId, massa, comprimento, dimensao }) {
  const url = urlDaPeca(pecaId, txHash);
  const [qr, setQr] = useState(null);

  useEffect(() => {
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 480, color: { dark: "#23313B", light: "#FFFFFF" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  async function baixar() {
    const W = 900, H = 480, P = 36;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#23313B"; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4);

    try { await document.fonts.ready; } catch { /* sem API de fontes */ }
    const img = new Image();
    img.src = qr;
    await img.decode();
    const q = H - 2 * P;
    g.drawImage(img, P, P, q, q);

    const x = P + q + 36;
    const larg = W - x - P;
    g.fillStyle = "#23313B";
    g.font = "600 28px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    g.fillText("MetalChain", x, P + 26);
    g.font = "700 64px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    g.fillText(`Peça nº ${pecaId}`, x, P + 100);

    g.font = "500 24px Barlow, Arial, sans-serif";
    let y = P + 146;
    for (const linha of quebrar(g, descricao || "Sem descrição", larg).slice(0, 2)) {
      g.fillText(linha, x, y); y += 32;
    }
    g.fillStyle = "#5E6B74";
    g.font = "400 22px Barlow, Arial, sans-serif";
    y += 10;
    if (dimensao) { g.fillText(`${dimensao} (herdada da bobina)`, x, y); y += 32; }
    g.fillText(`Bobina de origem: ${bobinaId}`, x, y); y += 32;
    g.fillText(`Massa: ${kg(massa)}${Number(comprimento) > 0 ? `   Comprimento: ${metros(comprimento)}` : ""}`, x, y);

    g.fillStyle = "#23313B";
    g.font = "500 20px Barlow, Arial, sans-serif";
    g.fillText("Escaneie para ver a origem e o certificado.", x, H - P - 8);

    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `etiqueta-peca-${pecaId}.png`;
    a.click();
  }

  return (
    <div className="etiqueta">
      <div className="etiqueta-qr">
        {qr ? <img src={qr} alt={`QR Code da peça nº ${pecaId}`} width="200" height="200" /> : <div className="qr-vazio" />}
      </div>
      <div className="etiqueta-texto">
        <p className="etiqueta-num">Peça nº {pecaId}</p>
        <p>{descricao || "Sem descrição"}</p>
        {dimensao && <p className="secundario">{dimensao}, herdada da bobina</p>}
        <p className="secundario">Bobina de origem: {bobinaId}</p>
        <p className="link-quebra"><a href={url} target="_blank" rel="noreferrer">{url}</a></p>
        <div className="acoes">
          <button type="button" className="btn btn-forte" onClick={baixar} disabled={!qr}>
            Baixar etiqueta (PNG)
          </button>
          <a className="btn btn-quieto" href={url} target="_blank" rel="noreferrer">Abrir página pública</a>
        </div>
      </div>
    </div>
  );
}

function quebrar(g, texto, largura) {
  const palavras = texto.split(/\s+/);
  const linhas = [];
  let atual = "";
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p;
    if (g.measureText(teste).width > largura && atual) { linhas.push(atual); atual = p; } else atual = teste;
  }
  if (atual) linhas.push(atual);
  return linhas;
}
