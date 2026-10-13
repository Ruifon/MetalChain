// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MetalChain
 * @author Rui de Souza Fontoura Junior
 * @notice Preserva o vínculo imutável entre peças siderúrgicas derivadas e o
 *         certificado de origem da bobina, com controle de massa por baixa
 *         (burn) e emissão (mint).
 * @dev Trabalho de Conclusão de Curso - Bacharelado em Sistemas de Informação,
 *      Ifes Campus Cachoeiro de Itapemirim (2026).
 *
 *      Invariante: para toda bobina,
 *          massaInicial == saldo + soma das massas das peças derivadas.
 *
 *      Todas as massas são inteiros em GRAMAS (a EVM não opera com ponto
 *      flutuante). Comprimentos são inteiros em MILÍMETROS.
 */
contract MetalChain is AccessControl {
    // ------------------------------------------------------------------
    // Papéis
    // ------------------------------------------------------------------

    /// @notice Papel de escrita: registra bobinas e gera peças.
    bytes32 public constant OPERADOR = keccak256("OPERADOR");

    // ------------------------------------------------------------------
    // Estruturas
    // ------------------------------------------------------------------

    /// @notice Gênese: bobina recebida pela indústria de transformação.
    struct Bobina {
        string id;                // número atribuído pela usina (etiqueta)
        string lote;              // lote ou corrida de origem
        string norma;             // ex.: "ABNT NBR 7480"
        string grau;              // categoria ou grau do aço, ex.: "CA-50"
        uint256 massaInicial;     // gramas
        uint256 saldo;            // gramas ainda não atribuídas a peças
        bytes32 hashCertificado;  // SHA-256 do arquivo do certificado
        string cidCertificado;    // identificador do arquivo no IPFS
        string certConformidade;  // nº do certificado de conformidade (se houver)
        address operador;         // carteira que registrou
        uint256 registradoEm;     // timestamp do bloco
        bool existe;
    }

    /// @notice Produto derivado de uma bobina.
    struct Peca {
        uint256 id;               // sequencial, gerado pelo contrato
        string bobinaId;          // referência à bobina de origem
        string descricao;         // ex.: "Vergalhão CA-50 10 mm - barra 12 m"
        uint256 comprimento;      // milímetros
        uint256 massa;            // gramas
        address operador;         // carteira que registrou
        uint256 registradoEm;     // timestamp do bloco
    }

    /// @notice Dados descritivos da bobina, agrupados para reduzir parâmetros.
    struct DadosBobina {
        string lote;
        string norma;
        string grau;
        string certConformidade;
    }

    // ------------------------------------------------------------------
    // Estado
    // ------------------------------------------------------------------

    mapping(string => Bobina) private bobinas;
    mapping(uint256 => Peca) private pecas;

    /// @notice Nome da indústria associado a cada carteira credenciada.
    /// @dev Mantido após a revogação, para preservar o histórico das consultas.
    mapping(address => string) public nomeIndustria;

    /// @notice Identificador que será atribuído à próxima peça.
    uint256 public proximaPeca = 1;

    // ------------------------------------------------------------------
    // Eventos
    // ------------------------------------------------------------------

    event OperadorCredenciado(address indexed carteira, string nome);
    event OperadorRevogado(address indexed carteira);
    event BobinaRegistrada(
        string bobinaId,
        uint256 massaInicial,
        bytes32 hashCertificado,
        address indexed operador
    );
    event PecaGerada(
        uint256 indexed pecaId,
        string bobinaId,
        uint256 massa,
        uint256 saldoRestante,
        address indexed operador
    );

    // ------------------------------------------------------------------
    // Construtor
    // ------------------------------------------------------------------

    /// @param nomeAdmin Nome da indústria que publica o contrato.
    constructor(string memory nomeAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        nomeIndustria[msg.sender] = nomeAdmin;
    }

    // ------------------------------------------------------------------
    // Administração
    // ------------------------------------------------------------------

    /// @notice Credencia uma carteira como operadora e registra o nome da indústria.
    function credenciarOperador(address carteira, string calldata nome)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(carteira != address(0), "MetalChain: carteira invalida");
        require(bytes(nome).length > 0, "MetalChain: nome vazio");
        _grantRole(OPERADOR, carteira);
        nomeIndustria[carteira] = nome;
        emit OperadorCredenciado(carteira, nome);
    }

    /// @notice Revoga o papel de operador. O nome é mantido para o histórico.
    function revogarOperador(address carteira) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(OPERADOR, carteira);
        emit OperadorRevogado(carteira);
    }

    // ------------------------------------------------------------------
    // Escrita (operador)
    // ------------------------------------------------------------------

    /// @notice Gênese: registra a entrada de uma bobina com seu certificado.
    /// @param id Número da bobina atribuído pela usina.
    /// @param dados Lote, norma, grau e nº do certificado de conformidade.
    /// @param massa Massa inicial em gramas.
    /// @param hashCertificado SHA-256 do arquivo do certificado de qualidade.
    /// @param cidCertificado CID do arquivo no IPFS.
    function registrarBobina(
        string calldata id,
        DadosBobina calldata dados,
        uint256 massa,
        bytes32 hashCertificado,
        string calldata cidCertificado
    ) external onlyRole(OPERADOR) {
        require(bytes(id).length > 0, "MetalChain: id vazio");
        require(!bobinas[id].existe, "MetalChain: bobina ja registrada");
        require(massa > 0, "MetalChain: massa invalida");
        require(hashCertificado != bytes32(0), "MetalChain: hash do certificado ausente");

        bobinas[id] = Bobina({
            id: id,
            lote: dados.lote,
            norma: dados.norma,
            grau: dados.grau,
            massaInicial: massa,
            saldo: massa,
            hashCertificado: hashCertificado,
            cidCertificado: cidCertificado,
            certConformidade: dados.certConformidade,
            operador: msg.sender,
            registradoEm: block.timestamp,
            existe: true
        });

        emit BobinaRegistrada(id, massa, hashCertificado, msg.sender);
    }

    /// @notice Transformação: dá baixa na bobina (burn) e emite a peça (mint).
    /// @dev Ordem das verificações conforme a Figura 4 do TCC.
    /// @return pecaId Identificador da peça criada.
    function gerarPeca(
        string calldata bobinaId,
        string calldata descricao,
        uint256 comprimento,
        uint256 massa
    ) external onlyRole(OPERADOR) returns (uint256 pecaId) {
        Bobina storage bobina = bobinas[bobinaId];
        require(bobina.existe, "MetalChain: bobina inexistente");
        require(massa > 0, "MetalChain: massa invalida");
        require(massa <= bobina.saldo, "MetalChain: massa insuficiente");

        // Baixa (burn): irreversível.
        bobina.saldo -= massa;

        // Emissão (mint): a peça herda o certificado por referência.
        pecaId = proximaPeca++;
        pecas[pecaId] = Peca({
            id: pecaId,
            bobinaId: bobinaId,
            descricao: descricao,
            comprimento: comprimento,
            massa: massa,
            operador: msg.sender,
            registradoEm: block.timestamp
        });

        emit PecaGerada(pecaId, bobinaId, massa, bobina.saldo, msg.sender);
    }

    // ------------------------------------------------------------------
    // Leitura (pública, sem custo)
    // ------------------------------------------------------------------

    /// @notice Retorna os dados de uma bobina.
    function consultarBobina(string calldata bobinaId)
        external
        view
        returns (Bobina memory)
    {
        require(bobinas[bobinaId].existe, "MetalChain: bobina inexistente");
        return bobinas[bobinaId];
    }

    /// @notice Consulta usada pelo QR Code: peça, bobina de origem e indústrias.
    function consultarGenealogia(uint256 pecaId)
        external
        view
        returns (
            Peca memory peca,
            Bobina memory bobina,
            string memory industriaPeca,
            string memory industriaBobina
        )
    {
        peca = pecas[pecaId];
        require(peca.id != 0, "MetalChain: peca inexistente");
        bobina = bobinas[peca.bobinaId];
        industriaPeca = nomeIndustria[peca.operador];
        industriaBobina = nomeIndustria[bobina.operador];
    }

    /// @notice Confere se o hash de um arquivo coincide com o certificado registrado.
    function verificarCertificado(string calldata bobinaId, bytes32 hashArquivo)
        external
        view
        returns (bool)
    {
        require(bobinas[bobinaId].existe, "MetalChain: bobina inexistente");
        return bobinas[bobinaId].hashCertificado == hashArquivo;
    }
}
