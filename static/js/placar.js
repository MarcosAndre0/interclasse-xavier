// Escapa texto digitado por alguém (ex.: nomes de jogadores) antes de colocar na página
function escaparTexto(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

const listaJogos = document.getElementById("lista-jogos");
const listaModalidades = document.getElementById("lista-modalidades");
const listaProximos = document.getElementById("lista-proximos");

const rotulosStatus = {
  ao_vivo: "Ao vivo",
  aguardando: "Aguardando",
  encerrado: "Encerrado",
};

// Modalidades sempre exibidas no seletor, mesmo sem jogo cadastrado ainda
const MODALIDADES_BASE = ["Vôlei", "Tênis de Mesa Feminino", "Tênis de Mesa Masculino", "Futebol", "Futebol Feminino", "Xadrez"];

let jogosAtuais = [];
let modalidadeSelecionada = null; // null = mostra todos os jogos

const MODALIDADES_COM_SETS = ["Vôlei", "Tênis de Mesa", "Tênis de Mesa Feminino", "Tênis de Mesa Masculino"];
const MODALIDADES_SEM_PLACAR = ["Xadrez"];

function montarCardJogo(jogo) {
  if (MODALIDADES_SEM_PLACAR.includes(jogo.modalidade)) {
    if (jogo.status === "encerrado") {
      const textoResultado = jogo.resultado === "empate"
        ? `🤝 Empate entre ${jogo.time_a} e ${jogo.time_b}`
        : `♟️ Xeque-mate! ${jogo.resultado === "vencedor_a" ? jogo.time_a : jogo.time_b} venceu.`;
      return `
        <div class="card">
          <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
          <span class="status-badge status-encerrado">Encerrado</span>
          <div class="resultado-final">${textoResultado}</div>
        </div>
      `;
    }
    return `
      <div class="card">
        <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
        <span class="status-badge status-${jogo.status}">${rotulosStatus[jogo.status]}</span>
        <div class="placar-jogo">
          <div class="time-nome">${jogo.time_a}</div>
          <div class="vs">×</div>
          <div class="time-nome">${jogo.time_b}</div>
        </div>
      </div>
    `;
  }

  if (MODALIDADES_COM_SETS.includes(jogo.modalidade) && jogo.status === "encerrado") {
    const vencedor = jogo.sets_vencidos_a > jogo.sets_vencidos_b ? jogo.time_a : jogo.time_b;
    const historicoTexto = jogo.historico_sets.length > 0
      ? jogo.historico_sets.map((s) => `${s.a}-${s.b}`).join(", ")
      : "";
    return `
      <div class="card">
        <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
        <span class="status-badge status-encerrado">Encerrado</span>
        <div class="resultado-final">🏆 ${vencedor} venceu por ${jogo.sets_vencidos_a} × ${jogo.sets_vencidos_b} (sets)</div>
        ${historicoTexto ? `<p class="rodape-info" style="text-align:left;">Sets: ${historicoTexto}</p>` : ""}
      </div>
    `;
  }

  const infoSets = MODALIDADES_COM_SETS.includes(jogo.modalidade) ? `
    <p class="rodape-info" style="text-align:left; margin:6px 0;">
      Sets: ${jogo.sets_vencidos_a} × ${jogo.sets_vencidos_b} · Set ${jogo.set_atual} (até ${jogo.pontos_necessarios_set} pontos)
    </p>
  ` : "";

  return `
    <div class="card">
      <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
      <span class="status-badge status-${jogo.status}">${rotulosStatus[jogo.status]}</span>
      ${infoSets}
      <div class="placar-jogo">
        <div class="time-nome">${jogo.time_a}</div>
        <div class="time-pontos">${jogo.placar_a}</div>
        <div class="vs">×</div>
        <div class="time-pontos">${jogo.placar_b}</div>
        <div class="time-nome">${jogo.time_b}</div>
      </div>
      ${(jogo.integrantes_a || jogo.integrantes_b) ? `
        <div class="integrantes-jogo">
          <div class="integrantes-coluna">${escaparTexto(jogo.integrantes_a)}</div>
          <div class="integrantes-coluna">${escaparTexto(jogo.integrantes_b)}</div>
        </div>
      ` : ""}
      ${jogo.em_penaltis ? `
        <div class="bloco-penaltis">
          <div class="penaltis-titulo">🥅 Pênaltis</div>
          <div class="placar-jogo">
            <div class="time-nome">${jogo.time_a}</div>
            <div class="time-pontos pontos-penaltis">${jogo.penaltis_a}</div>
            <div class="vs">×</div>
            <div class="time-pontos pontos-penaltis">${jogo.penaltis_b}</div>
            <div class="time-nome">${jogo.time_b}</div>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderizarJogos() {
  const jogosFiltrados = modalidadeSelecionada
    ? jogosAtuais.filter((j) => j.modalidade === modalidadeSelecionada)
    : jogosAtuais;

  if (jogosFiltrados.length === 0) {
    definirHtml(listaJogos, modalidadeSelecionada
      ? `<p class="rodape-info">Nenhum confronto de ${modalidadeSelecionada} no momento.</p>`
      : '<p class="rodape-info">Nenhum jogo cadastrado ainda.</p>');
    return;
  }

  definirHtml(listaJogos, jogosFiltrados.map(montarCardJogo).join(""));
}

function renderizarModalidades() {
  // Junta a lista base com quaisquer modalidades extras que já tenham jogo cadastrado
  const extras = jogosAtuais.map((j) => j.modalidade);
  const todasModalidades = [...new Set([...MODALIDADES_BASE, ...extras])];

  const botaoTodos = `
    <button class="btn-modalidade ${modalidadeSelecionada === null ? "selecionada" : ""}" data-modalidade="">
      Todas
    </button>
  `;

  const botoes = todasModalidades.map((mod) => `
    <button class="btn-modalidade ${modalidadeSelecionada === mod ? "selecionada" : ""}" data-modalidade="${mod}">
      ${mod}
    </button>
  `).join("");

  if (!definirHtml(listaModalidades, botaoTodos + botoes)) return;

  listaModalidades.querySelectorAll(".btn-modalidade").forEach((botao) => {
    botao.addEventListener("click", () => {
      modalidadeSelecionada = botao.dataset.modalidade || null;
      renderizarModalidades();
      renderizarJogos();
    });
  });
}

// Só mexe na tela quando o conteúdo mudou de verdade; assim a atualização
// automática a cada 3 segundos não faz nada piscar.
function definirHtml(elemento, html) {
  if (elemento.dataset.htmlAtual === html) return false;
  elemento.innerHTML = html;
  elemento.dataset.htmlAtual = html;
  return true;
}

function doisDigitos(n) {
  return String(n).padStart(2, "0");
}

function atualizarNumeros() {
  document.getElementById("num-ao-vivo").textContent = doisDigitos(jogosAtuais.filter((j) => j.status === "ao_vivo").length);
  document.getElementById("num-total").textContent = doisDigitos(jogosAtuais.length);
  document.getElementById("num-encerrados").textContent = doisDigitos(jogosAtuais.filter((j) => j.status === "encerrado").length);
}

async function atualizarPlacar() {
  try {
    const resposta = await fetch("/api/jogos");
    jogosAtuais = await resposta.json();
    atualizarNumeros();
    renderizarModalidades();
    renderizarJogos();
  } catch (erro) {
    definirHtml(listaJogos, '<p class="erro">Não foi possível conectar ao servidor.</p>');
  }
}

async function carregarProximosConfrontos() {
  try {
    const resposta = await fetch("/api/proximos-confrontos?programacao=1");
    const confrontos = await resposta.json();

    document.getElementById("num-proximos").textContent = doisDigitos(confrontos.length);

    if (confrontos.length === 0) {
      definirHtml(listaProximos, '<p class="rodape-info">Nenhum confronto agendado.</p>');
      return;
    }

    definirHtml(listaProximos, confrontos.map((c) => `
      <div class="item-proximo-confronto">
        <div class="modalidade-label">${escaparTexto(c.modalidade)}${c.horario ? ` · ${escaparTexto(c.horario)}` : ""}</div>
        <div class="confronto-salas">${escaparTexto(c.sala_a)} × ${escaparTexto(c.sala_b)}</div>
      </div>
    `).join(""));
  } catch (erro) {
    listaProximos.innerHTML = '<p class="erro">Não foi possível carregar.</p>';
  }
}

async function ajustarLinkLogin() {
  const resposta = await fetch("/api/me");
  const usuario = await resposta.json();
  const link = document.getElementById("link-login");
  if (usuario) {
    link.textContent = `${usuario.nome} · Painel do Marcador`;
    link.href = "/marcador";
  }
}

atualizarPlacar();
carregarProximosConfrontos();
ajustarLinkLogin();
setInterval(atualizarPlacar, 3000); // consulta o servidor a cada 3 segundos
