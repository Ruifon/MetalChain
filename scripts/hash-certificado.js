// Calcula o SHA-256 de um arquivo (ex.: PDF do certificado) no formato bytes32.
// Uso: node scripts/hash-certificado.js caminho/do/certificado.pdf
const fs = require("fs");
const crypto = require("crypto");

const caminho = process.argv[2];
if (!caminho) {
  console.error("Informe o caminho do arquivo. Ex.: node scripts/hash-certificado.js certificado.pdf");
  process.exit(1);
}
const hash = crypto.createHash("sha256").update(fs.readFileSync(caminho)).digest("hex");
console.log(`0x${hash}`);
