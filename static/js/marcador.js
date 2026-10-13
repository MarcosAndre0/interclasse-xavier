// Escapa texto digitado por alguém (ex.: nomes de jogadores) antes de colocar na página
function escaparTexto(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

const listaJogosMarcador = document.getElementById("lista-jogos-marcador");
let usuarioLogado = null;

// Só faz sentido ir pra pênaltis em modalidades que realmente desempatam assim
const MODALIDADES_COM_PENALTIS = ["Futebol", "Futebol Feminino", "Handebol"];

// Modalidades que jogam por sets (melhor de 5)
const MODALIDADES_COM_SETS = ["Vôlei", "Tênis de Mesa", "Tênis de Mesa Feminino", "Tênis de Mesa Masculino"];

// Xadrez não usa placar numérico: termina por xeque-mate ou empate
const MODALIDADES_SEM_PLACAR = ["Xadrez"];

async function carregarUsuario() {
  const resposta = await fetch("/api/me");
  usuarioLogado = await resposta.json();
  if (!usuarioLogado) {
    window.location.href = "/login";
    return;
  }
  if (usuarioLogado.cargo === "diretor") {
    const linkAdmin = document.getElementById("link-admin");
    if (linkAdmin) linkAdmin.style.display = "";
  }
}

function montarRodapeExcluir(jogo) {
  return `
    <div class="rodape-card">
      <button class="btn-excluir" data-excluir-jogo="${jogo.id}">🗑️ Excluir Partida</button>
    </div>
  `;
}

function montarCardComSets(jogo) {
  const historicoTexto = jogo.historico_sets.length > 0
    ? jogo.historico_sets.map((s) => `${s.a}-${s.b}`).join(", ")
    : "Nenhum set encerrado ainda";

  if (jogo.status === "encerrado") {
    const vencedor = jogo.sets_vencidos_a > jogo.sets_vencidos_b ? jogo.time_a : jogo.time_b;
    return `
      <div class="card">
        <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
        <span class="status-badge status-encerrado">Encerrado</span>
        <div class="resultado-final">🏆 ${vencedor} venceu por ${jogo.sets_vencidos_a} × ${jogo.sets_vencidos_b} (sets)</div>
        <p class="rodape-info" style="text-align:left;">Sets: ${historicoTexto}</p>
        ${montarRodapeExcluir(jogo)}
      </div>
    `;
  }

  const maior = Math.max(jogo.placar_a, jogo.placar_b);
  const menor = Math.min(jogo.placar_a, jogo.placar_b);
  const podeFecharSet = maior >= jogo.pontos_necessarios_set && (maior - menor) >= 2;

  return `
    <div class="card">
      <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
      <span class="status-badge status-${jogo.status}">${jogo.status}</span>
      <p class="rodape-info" style="text-align:left; margin:6px 0;">
        Sets: ${jogo.sets_vencidos_a} × ${jogo.sets_vencidos_b} · Set ${jogo.set_atual} (até ${jogo.pontos_necessarios_set} pontos)
      </p>
      <div class="placar-jogo">
        <div class="time-nome">${jogo.time_a}</div>
        <div class="time-pontos">${jogo.placar_a}</div>
        <div class="vs">×</div>
        <div class="time-pontos">${jogo.placar_b}</div>
        <div class="time-nome">${jogo.time_b}</div>
      </div>
      <div class="controles-marcador">
        <div class="grupo-controle">
          <button class="btn-ponto" data-jogo="${jogo.id}" data-fase="normal" data-time="a" data-delta="1">+1</button>
          <button class="btn-ponto subtrair" data-jogo="${jogo.id}" data-fase="normal" data-time="a" data-delta="-1">−1</button>
        </div>
        <div class="grupo-controle">
          <button class="btn-ponto" data-jogo="${jogo.id}" data-fase="normal" data-time="b" data-delta="1">+1</button>
          <button class="btn-ponto subtrair" data-jogo="${jogo.id}" data-fase="normal" data-time="b" data-delta="-1">−1</button>
        </div>
      </div>
      <button class="btn-desfazer" data-desfazer="${jogo.id}" ${jogo.ultimo_delta ? "" : "disabled"}>↩️ Desfazer último ponto</button>
      <button class="btn-proximo-set" data-fechar-set="${jogo.id}" ${podeFecharSet ? "" : "disabled"}>
        ➡️ Próximo Set ${podeFecharSet ? "" : `(precisa de ${jogo.pontos_necessarios_set} pts, 2 de vantagem)`}
      </button>
      ${jogo.historico_sets.length > 0 ? `<p class="rodape-info" style="text-align:left;">Sets anteriores: ${historicoTexto}</p>` : ""}
      <button class="btn-encerrar-partida" data-encerrar="${jogo.id}">🏁 Encerrar partida</button>
      ${montarRodapeExcluir(jogo)}
    </div>
  `;
}

function montarCardPadrao(jogo) {
  return `
    <div class="card">
      <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
      <span class="status-badge status-${jogo.status}">${jogo.status}</span>
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
      <div class="controles-marcador">
        <div class="grupo-controle">
          <button class="btn-ponto" data-jogo="${jogo.id}" data-fase="normal" data-time="a" data-delta="1">+1</button>
          <button class="btn-ponto subtrair" data-jogo="${jogo.id}" data-fase="normal" data-time="a" data-delta="-1">−1</button>
        </div>
        <div class="grupo-controle">
          <button class="btn-ponto" data-jogo="${jogo.id}" data-fase="normal" data-time="b" data-delta="1">+1</button>
          <button class="btn-ponto subtrair" data-jogo="${jogo.id}" data-fase="normal" data-time="b" data-delta="-1">−1</button>
        </div>
      </div>
      <button class="btn-desfazer" data-desfazer="${jogo.id}" ${jogo.ultimo_delta ? "" : "disabled"}>↩️ Desfazer último ponto</button>

      ${jogo.em_penaltis ? `
        <div class="bloco-penaltis">
          <div class="penaltis-cabecalho">
            <div class="penaltis-titulo">🥅 Pênaltis</div>
            <button class="btn-voltar" data-cancelar-penaltis="${jogo.id}">↩️ Voltar</button>
          </div>
          <div class="placar-jogo">
            <div class="time-nome">${jogo.time_a}</div>
            <div class="time-pontos pontos-penaltis">${jogo.penaltis_a}</div>
            <div class="vs">×</div>
            <div class="time-pontos pontos-penaltis">${jogo.penaltis_b}</div>
            <div class="time-nome">${jogo.time_b}</div>
          </div>
          <div class="controles-marcador">
            <div class="grupo-controle">
              <button class="btn-ponto" data-jogo="${jogo.id}" data-fase="penaltis" data-time="a" data-delta="1">+1</button>
              <button class="btn-ponto subtrair" data-jogo="${jogo.id}" data-fase="penaltis" data-time="a" data-delta="-1">−1</button>
            </div>
            <div class="grupo-controle">
              <button class="btn-ponto" data-jogo="${jogo.id}" data-fase="penaltis" data-time="b" data-delta="1">+1</button>
              <button class="btn-ponto subtrair" data-jogo="${jogo.id}" data-fase="penaltis" data-time="b" data-delta="-1">−1</button>
            </div>
          </div>
        </div>
      ` : (MODALIDADES_COM_PENALTIS.includes(jogo.modalidade) ? `
        <button class="btn-penaltis" data-jogo-penaltis="${jogo.id}">⚽ Foi para os pênaltis</button>
      ` : "")}

      <button class="btn-encerrar-partida" data-encerrar="${jogo.id}">🏁 Encerrar partida</button>
      ${montarRodapeExcluir(jogo)}
    </div>
  `;
}

function montarCardXadrez(jogo) {
  if (jogo.status === "encerrado") {
    const textoResultado = jogo.resultado === "empate"
      ? `🤝 Empate entre ${jogo.time_a} e ${jogo.time_b}`
      : `♟️ Xeque-mate! ${jogo.resultado === "vencedor_a" ? jogo.time_a : jogo.time_b} venceu.`;

    return `
      <div class="card">
        <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
        <span class="status-badge status-encerrado">Encerrado</span>
        <div class="resultado-final">${textoResultado}</div>
        ${montarRodapeExcluir(jogo)}
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="modalidade-label">${jogo.modalidade}${jogo.local ? ` · 📍 ${jogo.local}` : ""}</div>
      <span class="status-badge status-${jogo.status}">${jogo.status}</span>
      <div class="placar-jogo">
        <div class="time-nome">${jogo.time_a}</div>
        <div class="vs">×</div>
        <div class="time-nome">${jogo.time_b}</div>
      </div>
      <div class="controles-xadrez">
        <button class="btn-xeque-mate" data-jogo="${jogo.id}" data-resultado="vencedor_a">
          ♟️ Xeque-mate: ${jogo.time_a}
        </button>
        <button class="btn-xeque-mate" data-jogo="${jogo.id}" data-resultado="vencedor_b">
          ♟️ Xeque-mate: ${jogo.time_b}
        </button>
        <button class="btn-empate" data-jogo="${jogo.id}" data-resultado="empate">
          🤝 Empate
        </button>
      </div>
      ${montarRodapeExcluir(jogo)}
    </div>
  `;
}

function montarCardJogo(jogo) {
  if (MODALIDADES_SEM_PLACAR.includes(jogo.modalidade)) return montarCardXadrez(jogo);
  return MODALIDADES_COM_SETS.includes(jogo.modalidade)
    ? montarCardComSets(jogo)
    : montarCardPadrao(jogo);
}

function renderizarJogosMarcador(jogos) {
  // Diretor vê todos os jogos; marcador só vê o(s) jogo(s) atribuído(s) a ele
  const jogosVisiveis = usuarioLogado.cargo === "diretor"
    ? jogos
    : jogos.filter((j) => j.marcador_id === usuarioLogado.id);

  if (jogosVisiveis.length === 0) {
    listaJogosMarcador.innerHTML = '<p class="rodape-info">Nenhum jogo atribuído a você no momento.</p>';
    listaJogosMarcador.dataset.htmlAtual = "";
    return;
  }

  const html = jogosVisiveis.map(montarCardJogo).join("");
  if (listaJogosMarcador.dataset.htmlAtual === html) return; // nada mudou: não mexe na tela
  listaJogosMarcador.innerHTML = html;
  listaJogosMarcador.dataset.htmlAtual = html;

  document.querySelectorAll(".btn-encerrar-partida").forEach((botao) => {
    botao.addEventListener("click", () => encerrarPartida(botao.dataset.encerrar));
  });

  document.querySelectorAll(".btn-ponto").forEach((botao) => {
    botao.addEventListener("click", () => marcarPonto(
      botao.dataset.jogo, botao.dataset.time, Number(botao.dataset.delta), botao.dataset.fase
    ));
  });

  document.querySelectorAll(".btn-penaltis").forEach((botao) => {
    botao.addEventListener("click", () => iniciarPenaltis(botao.dataset.jogoPenaltis));
  });

  document.querySelectorAll(".btn-voltar").forEach((botao) => {
    botao.addEventListener("click", () => cancelarPenaltis(botao.dataset.cancelarPenaltis));
  });

  document.querySelectorAll(".btn-excluir").forEach((botao) => {
    botao.addEventListener("click", () => excluirJogo(botao.dataset.excluirJogo));
  });

  document.querySelectorAll(".btn-proximo-set").forEach((botao) => {
    botao.addEventListener("click", () => fecharSet(botao.dataset.fecharSet));
  });

  document.querySelectorAll(".btn-desfazer").forEach((botao) => {
    botao.addEventListener("click", () => desfazerPonto(botao.dataset.desfazer));
  });

  document.querySelectorAll(".btn-xeque-mate, .btn-empate").forEach((botao) => {
    botao.addEventListener("click", () => declararResultadoXadrez(botao.dataset.jogo, botao.dataset.resultado));
  });
}

async function encerrarPartida(jogoId) {
  if (!confirm("Encerrar esta partida agora? O resultado final será mostrado para todos.")) return;
  try {
    const resposta = await fetch(`/api/jogos/${jogoId}/encerrar`, { method: "POST" });
    if (!resposta.ok) {
      const dados = await resposta.json();
      alert(dados.erro || "Não foi possível encerrar a partida.");
      return;
    }
    await atualizarLista();
    if (window.verificarVitoria) window.verificarVitoria(); // abre a tela de quem ganhou
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function marcarPonto(jogoId, time, delta, fase) {
  try {
    const resposta = await fetch(`/api/jogos/${jogoId}/ponto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ time, delta, fase }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json();
      alert(dados.erro || "Não foi possível atualizar o placar.");
      return;
    }
    await atualizarLista();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function desfazerPonto(jogoId) {
  try {
    const resposta = await fetch(`/api/jogos/${jogoId}/desfazer`, { method: "POST" });
    const dados = await resposta.json();
    if (!resposta.ok) {
      alert(dados.erro || "Não há ponto recente pra desfazer.");
      return;
    }
    await atualizarLista();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function iniciarPenaltis(jogoId) {
  if (!confirm("Confirma que o jogo foi para os pênaltis?")) return;
  try {
    const resposta = await fetch(`/api/jogos/${jogoId}/penaltis`, { method: "POST" });
    if (!resposta.ok) {
      const dados = await resposta.json();
      alert(dados.erro || "Não foi possível ativar os pênaltis.");
      return;
    }
    await atualizarLista();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function cancelarPenaltis(jogoId) {
  if (!confirm("Voltar do modo pênaltis? O placar de pênaltis desse jogo será zerado.")) return;
  try {
    const resposta = await fetch(`/api/jogos/${jogoId}/penaltis/cancelar`, { method: "POST" });
    if (!resposta.ok) {
      const dados = await resposta.json();
      alert(dados.erro || "Não foi possível voltar.");
      return;
    }
    await atualizarLista();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function excluirJogo(jogoId) {
  if (!confirm("Tem certeza que quer excluir esta partida? Essa ação não pode ser desfeita.")) return;
  try {
    const resposta = await fetch(`/api/jogos/${jogoId}`, { method: "DELETE" });
    if (!resposta.ok) {
      const dados = await resposta.json();
      alert(dados.erro || "Não foi possível excluir a partida.");
      return;
    }
    await atualizarLista();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function fecharSet(jogoId) {
  try {
    const resposta = await fetch(`/api/jogos/${jogoId}/set/fechar`, { method: "POST" });
    const dados = await resposta.json();
    if (!resposta.ok) {
      alert(dados.erro || "Não foi possível fechar o set.");
      return;
    }
    await atualizarLista();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function declararResultadoXadrez(jogoId, resultado) {
  const mensagens = {
    vencedor_a: "Confirma o xeque-mate? Essa partida será encerrada.",
    vencedor_b: "Confirma o xeque-mate? Essa partida será encerrada.",
    empate: "Confirma o empate? Essa partida será encerrada.",
  };
  if (!confirm(mensagens[resultado])) return;

  try {
    const resposta = await fetch(`/api/jogos/${jogoId}/resultado`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultado }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      alert(dados.erro || "Não foi possível registrar o resultado.");
      return;
    }
    await atualizarLista();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function atualizarLista() {
  const resposta = await fetch("/api/jogos");
  const jogos = await resposta.json();
  renderizarJogosMarcador(jogos);
}

document.getElementById("link-sair").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

// ---------- Formulário de Nova Partida ----------

const btnAbrirNovaPartida = document.getElementById("btn-abrir-nova-partida");
const formNovaPartida = document.getElementById("form-nova-partida");
const btnCancelarPartida = document.getElementById("btn-cancelar-partida");
const btnSalvarPartida = document.getElementById("btn-salvar-partida");
const selectModalidade = document.getElementById("input-modalidade");
const previewLocal = document.getElementById("preview-local");
const erroNovaPartida = document.getElementById("erro-nova-partida");
const selectImportarConfronto = document.getElementById("input-importar-confronto");
const opcaoRemoverImportado = document.getElementById("opcao-remover-importado");
const checkboxRemoverImportado = document.getElementById("input-remover-confronto-importado");

let modalidadesDisponiveis = [];
let confrontosParaImportar = [];
let confrontoImportadoId = null;

async function carregarConfrontosParaImportar() {
  try {
    const resposta = await fetch("/api/proximos-confrontos");
    confrontosParaImportar = await resposta.json();

    const opcoes = confrontosParaImportar
      .map((c) => `<option value="${c.id}">${c.modalidade}: ${c.sala_a} × ${c.sala_b}${c.horario ? " — " + c.horario : ""}</option>`)
      .join("");
    selectImportarConfronto.innerHTML = '<option value="">— Preencher manualmente —</option>' + opcoes;
  } catch (erro) {
    selectImportarConfronto.innerHTML = '<option value="">— Preencher manualmente —</option>';
  }
}

selectImportarConfronto.addEventListener("change", () => {
  const id = selectImportarConfronto.value;
  confrontoImportadoId = id || null;

  if (!id) {
    opcaoRemoverImportado.style.display = "none";
    return;
  }

  const confronto = confrontosParaImportar.find((c) => String(c.id) === id);
  if (!confronto) return;

  selectModalidade.value = confronto.modalidade;
  document.getElementById("input-time-a").value = confronto.sala_a;
  document.getElementById("input-time-b").value = confronto.sala_b;
  atualizarPreviewLocal();
  opcaoRemoverImportado.style.display = "block";
});

async function carregarModalidades() {
  try {
    const resposta = await fetch("/api/modalidades");
    modalidadesDisponiveis = await resposta.json();

    // Só reconstrói o select se a lista mudou; assim, uma escolha feita enquanto
    // o carregamento estava em andamento não volta para a primeira opção.
    const nomesNaTela = [...selectModalidade.options].map((o) => o.value).join("|");
    const nomesDoServidor = modalidadesDisponiveis.map((m) => m.nome).join("|");
    if (nomesNaTela !== nomesDoServidor) {
      selectModalidade.innerHTML = modalidadesDisponiveis
        .map((m) => `<option value="${m.nome}">${m.nome}</option>`)
        .join("");
    }
    // Se um confronto foi importado antes desta lista terminar de carregar,
    // mantém a modalidade dele (senão o carregamento voltaria para a primeira da lista)
    const importado = confrontosParaImportar.find((c) => String(c.id) === String(confrontoImportadoId));
    if (importado) selectModalidade.value = importado.modalidade;

    atualizarPreviewLocal();
  } catch (erro) {
    selectModalidade.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

function atualizarPreviewLocal() {
  const modalidade = modalidadesDisponiveis.find((m) => m.nome === selectModalidade.value);
  previewLocal.textContent = modalidade ? `📍 Local: ${modalidade.local}` : "";

  const ehXadrez = selectModalidade.value === "Xadrez";
  // O sorteio de turmas não vale para o Xadrez: lá os lados são jogadores
  document.getElementById("area-sorteio-partida").style.display = ehXadrez ? "none" : "block";
  document.getElementById("label-time-a").textContent = ehXadrez ? "Jogador A" : "Sala / Turma do Time A";
  document.getElementById("label-time-b").textContent = ehXadrez ? "Jogador B" : "Sala / Turma do Time B";
  document.getElementById("input-time-a").placeholder = ehXadrez ? "Ex: Murilo" : "Ex: 1º A";
  document.getElementById("input-time-b").placeholder = ehXadrez ? "Ex: Carlos" : "Ex: 2º FDI";

  const ehBasquete = selectModalidade.value === "Basquete";
  const camposBasquete = document.getElementById("campos-basquete");
  camposBasquete.style.display = ehBasquete ? "block" : "none";
  if (!ehBasquete) {
    document.getElementById("input-integrantes-a").value = "";
    document.getElementById("input-integrantes-b").value = "";
  }
}

btnAbrirNovaPartida.addEventListener("click", () => {
  formNovaPartida.style.display = "block";
  btnAbrirNovaPartida.style.display = "none";
  carregarModalidades();
  carregarConfrontosParaImportar();
});

btnCancelarPartida.addEventListener("click", () => {
  formNovaPartida.style.display = "none";
  btnAbrirNovaPartida.style.display = "block";
  erroNovaPartida.textContent = "";
  document.getElementById("input-time-a").value = "";
  document.getElementById("input-time-b").value = "";
  document.getElementById("input-integrantes-a").value = "";
  document.getElementById("input-integrantes-b").value = "";
  document.getElementById("campos-basquete").style.display = "none";
  selectImportarConfronto.value = "";
  confrontoImportadoId = null;
  opcaoRemoverImportado.style.display = "none";
});

selectModalidade.addEventListener("change", atualizarPreviewLocal);

btnSalvarPartida.addEventListener("click", async () => {
  const modalidade = selectModalidade.value;
  const time_a = document.getElementById("input-time-a").value.trim();
  const time_b = document.getElementById("input-time-b").value.trim();
  const integrantes_a = document.getElementById("input-integrantes-a").value.trim();
  const integrantes_b = document.getElementById("input-integrantes-b").value.trim();
  erroNovaPartida.textContent = "";

  if (!modalidade || !time_a || !time_b) {
    erroNovaPartida.textContent = "Preencha a modalidade e os dois times.";
    return;
  }

  try {
    const resposta = await fetch("/api/jogos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modalidade, time_a, time_b, integrantes_a, integrantes_b }),
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      erroNovaPartida.textContent = dados.erro || "Não foi possível criar a partida.";
      return;
    }

    // Se a partida veio de um confronto importado e a opção está marcada,
    // remove esse confronto da lista de próximos (já virou uma partida de verdade)
    const confrontoImportado = confrontosParaImportar.find((c) => String(c.id) === String(confrontoImportadoId));
    const continuaIgual = confrontoImportado
      && confrontoImportado.modalidade === modalidade
      && confrontoImportado.sala_a === time_a
      && confrontoImportado.sala_b === time_b;

    if (continuaIgual && checkboxRemoverImportado.checked) {
      try {
        await fetch(`/api/proximos-confrontos/${confrontoImportadoId}`, { method: "DELETE" });
      } catch (erro) {
        // Não impede a criação da partida se essa parte falhar
      }
      // Se o painel de gerenciar próximos estiver aberto na mesma tela, atualiza ele também
      if (painelProximos.style.display !== "none") {
        await carregarProximosEditavel();
      }
    }

    btnCancelarPartida.click(); // fecha e limpa o formulário
    await atualizarLista();
  } catch (erro) {
    erroNovaPartida.textContent = "Erro de conexão com o servidor.";
  }
});

(async function iniciar() {
  await carregarUsuario();
  if (usuarioLogado) {
    await atualizarLista();
    setInterval(atualizarLista, 3000);
  }
})();

// ---------- Gerenciar Próximos Confrontos ----------

const btnAbrirProximos = document.getElementById("btn-abrir-proximos");
const painelProximos = document.getElementById("painel-proximos");
const listaProximosEditavel = document.getElementById("lista-proximos-editavel");
const selectNovoConfrontoModalidade = document.getElementById("novo-confronto-modalidade");
const erroNovoConfronto = document.getElementById("erro-novo-confronto");

btnAbrirProximos.addEventListener("click", async () => {
  const abrindo = painelProximos.style.display === "none";
  painelProximos.style.display = abrindo ? "block" : "none";
  if (abrindo) {
    await carregarOpcoesModalidadeConfronto();
    await carregarProximosEditavel();
  }
});

async function carregarOpcoesModalidadeConfronto() {
  if (selectNovoConfrontoModalidade.options.length > 0) return; // já carregou antes
  try {
    const resposta = await fetch("/api/modalidades");
    const modalidades = await resposta.json();
    selectNovoConfrontoModalidade.innerHTML = modalidades
      .map((m) => `<option value="${m.nome}">${m.nome}</option>`)
      .join("");
  } catch (erro) {
    selectNovoConfrontoModalidade.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

async function carregarProximosEditavel() {
  try {
    const resposta = await fetch("/api/proximos-confrontos");
    const confrontos = await resposta.json();

    if (confrontos.length === 0) {
      listaProximosEditavel.innerHTML = '<p class="rodape-info">Nenhum confronto cadastrado.</p>';
      return;
    }

    // As opções de modalidade do formulário de "Adicionar" servem pro seletor de cada linha também
    const opcoesModalidade = selectNovoConfrontoModalidade.innerHTML;

    listaProximosEditavel.innerHTML = confrontos.map((c) => `
      <div class="card linha-confronto-editavel" data-id="${c.id}">
        <select class="edit-modalidade">${opcoesModalidade}</select>
        <input type="text" class="edit-sala-a" value="${c.sala_a}">
        <span class="vs">×</span>
        <input type="text" class="edit-sala-b" value="${c.sala_b}">
        <input type="time" class="edit-horario" value="${c.horario || ''}" title="Horário">
        <div class="botoes-confronto-editavel">
          <button class="btn-salvar-confronto" data-id="${c.id}">💾 Salvar</button>
          <button class="btn-excluir-confronto" data-id="${c.id}">🗑️</button>
        </div>
      </div>
    `).join("");

    // Marca a modalidade certa selecionada em cada linha (não dá pra fazer isso direto no template acima)
    document.querySelectorAll(".linha-confronto-editavel").forEach((linha) => {
      const id = Number(linha.dataset.id);
      const confronto = confrontos.find((c) => c.id === id);
      linha.querySelector(".edit-modalidade").value = confronto.modalidade;
    });

    document.querySelectorAll(".btn-salvar-confronto").forEach((botao) => {
      botao.addEventListener("click", () => salvarConfronto(botao.dataset.id));
    });

    document.querySelectorAll(".btn-excluir-confronto").forEach((botao) => {
      botao.addEventListener("click", () => excluirConfronto(botao.dataset.id));
    });
  } catch (erro) {
    listaProximosEditavel.innerHTML = '<p class="erro">Não foi possível carregar os confrontos.</p>';
  }
}

async function salvarConfronto(id) {
  const linha = document.querySelector(`.linha-confronto-editavel[data-id="${id}"]`);
  const modalidade = linha.querySelector(".edit-modalidade").value;
  const sala_a = linha.querySelector(".edit-sala-a").value.trim();
  const sala_b = linha.querySelector(".edit-sala-b").value.trim();
  const horario = linha.querySelector(".edit-horario").value;

  if (!sala_a || !sala_b) {
    alert("Preencha os dois lados do confronto.");
    return;
  }

  try {
    const resposta = await fetch(`/api/proximos-confrontos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modalidade, sala_a, sala_b, horario }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      alert(dados.erro || "Não foi possível salvar.");
      return;
    }
    await carregarProximosEditavel();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function excluirConfronto(id) {
  if (!confirm("Excluir este confronto da lista de próximos jogos?")) return;
  try {
    const resposta = await fetch(`/api/proximos-confrontos/${id}`, { method: "DELETE" });
    if (!resposta.ok) {
      const dados = await resposta.json();
      alert(dados.erro || "Não foi possível excluir.");
      return;
    }
    await carregarProximosEditavel();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

document.getElementById("btn-adicionar-confronto").addEventListener("click", async () => {
  const modalidade = selectNovoConfrontoModalidade.value;
  const sala_a = document.getElementById("novo-confronto-sala-a").value.trim();
  const sala_b = document.getElementById("novo-confronto-sala-b").value.trim();
  const horario = document.getElementById("novo-confronto-horario").value;
  erroNovoConfronto.textContent = "";

  if (!modalidade || !sala_a || !sala_b) {
    erroNovoConfronto.textContent = "Preencha a modalidade e os dois lados do confronto.";
    return;
  }

  try {
    const resposta = await fetch("/api/proximos-confrontos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modalidade, sala_a, sala_b, horario }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      erroNovoConfronto.textContent = dados.erro || "Não foi possível adicionar.";
      return;
    }
    document.getElementById("novo-confronto-sala-a").value = "";
    document.getElementById("novo-confronto-sala-b").value = "";
    document.getElementById("novo-confronto-horario").value = "";
    await carregarProximosEditavel();
  } catch (erro) {
    erroNovoConfronto.textContent = "Erro de conexão com o servidor.";
  }
});
