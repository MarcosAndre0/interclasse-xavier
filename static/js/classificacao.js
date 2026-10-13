const containerTabela = document.getElementById("tabela-classificacao-container");
const selectModalidade = document.getElementById("select-modalidade-classificacao");

let ultimaResposta = null;

function montarTabela(linhas) {
  if (linhas.length === 0) {
    return '<p class="rodape-info">Ainda não há partidas encerradas para calcular a classificação.</p>';
  }

  const linhasHtml = linhas.map((linha, indice) => `
    <tr class="${indice === 0 ? "linha-lider" : ""}">
      <td class="posicao-numero">${indice + 1}º</td>
      <td class="col-turma">${linha.turma}</td>
      <td>${linha.jogos}</td>
      <td>${linha.vitorias}</td>
      <td>${linha.empates}</td>
      <td>${linha.derrotas}</td>
      <td class="col-pontos">${linha.pontos}</td>
    </tr>
  `).join("");

  return `
    <table class="tabela-classificacao">
      <thead>
        <tr>
          <th>#</th>
          <th class="col-turma">Turma</th>
          <th>J</th>
          <th>V</th>
          <th>E</th>
          <th>D</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>${linhasHtml}</tbody>
    </table>
  `;
}

function renderizar() {
  if (!ultimaResposta) return;
  const modalidade = selectModalidade.value;
  const linhas = modalidade ? (ultimaResposta.por_modalidade[modalidade] || []) : ultimaResposta.geral;
  containerTabela.innerHTML = montarTabela(linhas);
}

function atualizarOpcoesModalidade() {
  if (!ultimaResposta) return;
  const modalidadesComJogos = Object.keys(ultimaResposta.por_modalidade).sort();
  const valorAtual = selectModalidade.value;
  const opcoesExtras = modalidadesComJogos.map((mod) => `<option value="${mod}">${mod}</option>`).join("");
  selectModalidade.innerHTML = '<option value="">Geral (todas as modalidades)</option>' + opcoesExtras;
  if (modalidadesComJogos.includes(valorAtual)) {
    selectModalidade.value = valorAtual;
  }
}

async function carregarClassificacao() {
  try {
    const resposta = await fetch("/api/classificacao");
    ultimaResposta = await resposta.json();
    atualizarOpcoesModalidade();
    renderizar();
  } catch (erro) {
    containerTabela.innerHTML = '<p class="erro">Não foi possível carregar a classificação.</p>';
  }
}

selectModalidade.addEventListener("change", renderizar);

async function ajustarLinkLogin() {
  const resposta = await fetch("/api/me");
  const usuario = await resposta.json();
  const link = document.getElementById("link-login");
  if (usuario) {
    link.textContent = `${usuario.nome} · Painel do Marcador`;
    link.href = "/marcador";
  }
}

carregarClassificacao();
ajustarLinkLogin();
setInterval(carregarClassificacao, 10000);
