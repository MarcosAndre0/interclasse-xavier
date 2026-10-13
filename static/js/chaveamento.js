const selectModalidadeChave = document.getElementById("select-modalidade-chave");
const painelSalas = document.getElementById("painel-salas");
const areaSalas = document.getElementById("area-salas");
const listaSalas = document.getElementById("lista-salas");
const controlesQuadro = document.getElementById("controles-quadro");
const conteudoChaveamento = document.getElementById("chaveamento-conteudo");
const msgChaveamento = document.getElementById("msg-chaveamento");
const msgSalas = document.getElementById("msg-salas");

// Nestas modalidades, ao colocar a sala no quadro, escreve-se quem joga por ela
const MODALIDADES_COM_JOGADORES = ["Xadrez", "Tênis de Mesa", "Tênis de Mesa Feminino", "Tênis de Mesa Masculino"];

// No tênis de mesa cada vaga é de um atleta: o nome dele vem em destaque e a sala fica embaixo
function ehTenis(modalidade) {
  return typeof modalidade === "string" && modalidade.startsWith("Tênis de Mesa");
}

const NOMES_FASE = {
  rodada1: "1ª rodada", rodada2: "2ª rodada", oitavas: "Oitavas de final",
  quartas: "Quartas de final", semifinal: "Semifinal", final: "Final",
};
const ORDEM_FASE = ["rodada1", "rodada2", "oitavas", "quartas", "semifinal", "final"];

let usuarioLogado = null;
let turmasCadastradas = [];   // nomes das salas participantes
let turmasComId = [];         // {id, nome}, usado para excluir salas
let linhasAtuais = [];        // quadro da modalidade escolhida

// Só o marcador mexe na programação (adicionar salas, montar o quadro)
function ehMarcador() {
  return usuarioLogado && usuarioLogado.cargo === "marcador";
}

// Só redesenha um pedaço da tela quando o conteúdo mudou (evita piscar e perder o que a pessoa escolheu)
function definirHtml(elemento, html) {
  if (elemento.dataset.htmlAtual === html) return false;
  elemento.innerHTML = html;
  elemento.dataset.htmlAtual = html;
  return true;
}

function esc(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

async function carregarUsuario() {
  const resposta = await fetch("/api/me");
  usuarioLogado = await resposta.json();
  const link = document.getElementById("link-login");
  if (usuarioLogado) {
    const podeOperar = usuarioLogado.cargo === "marcador" || usuarioLogado.cargo === "diretor";
    link.textContent = podeOperar ? `${usuarioLogado.nome} · Painel do Marcador` : usuarioLogado.nome;
    link.href = podeOperar ? "/marcador" : "#";
    if (ehMarcador()) {
      painelSalas.style.display = "block";
      await carregarTurmas();
    }
  }
}

async function carregarOpcoesModalidade() {
  const resposta = await fetch("/api/modalidades");
  const modalidades = await resposta.json();
  // Xadrez não faz sentido em chaveamento de "times" (é individual), mas deixamos disponível também
  selectModalidadeChave.innerHTML = modalidades.map((m) => `<option value="${m.nome}">${m.nome}</option>`).join("");
}

async function carregarTurmas() {
  try {
    const resposta = await fetch("/api/turmas");
    if (!resposta.ok) return;
    const turmas = await resposta.json();
    turmasCadastradas = turmas.map((t) => t.nome);
    turmasComId = turmas;
    definirHtml(listaSalas, turmas.length === 0
      ? '<p class="rodape-info" style="text-align:left;">Nenhuma sala cadastrada ainda.</p>'
      : turmas.map((t) => `
          <label class="chip-turma chip-check">
            <input type="checkbox" value="${t.id}">
            ${esc(t.nome)}
          </label>`).join(""));
    atualizarControlesQuadro();
  } catch (erro) {
    listaSalas.innerHTML = '<p class="erro">Não foi possível carregar as salas.</p>';
  }
}

// Quem venceu a partida do quadro (o servidor diz o lado; no tênis duas vagas podem ter a mesma sala)
function ehLadoVencedor(linha, lado) {
  if (linha.jogo && linha.jogo.vencedor_lado) return linha.jogo.vencedor_lado === lado;
  return !!linha.vencedor && !linha.jogo && linha.vencedor === linha[`time_${lado}`];
}

function montarConfronto(linha) {
  const temJogo = !!linha.jogo;
  const podeIniciar = linha.time_a && linha.time_b && !linha.jogo_id
    && usuarioLogado && (usuarioLogado.cargo === "marcador" || usuarioLogado.cargo === "diretor");

  function ladoHtml(nome, ehVencedor, lado) {
    const integrantes = lado === "a" ? linha.integrantes_a : linha.integrantes_b;
    if (!nome) return '<div class="lado-chave pendente">A definir</div>';
    let placarTexto = "";
    if (temJogo && linha.jogo.status !== "aguardando") {
      const jogo = linha.jogo;
      if (jogo.modalidade === "Xadrez") {
        placarTexto = "";
      } else if (jogo.sets_vencidos_a !== undefined && (jogo.sets_para_vencer)) {
        placarTexto = `<span class="placar-mini">${nome === linha.time_a ? jogo.sets_vencidos_a : jogo.sets_vencidos_b}</span>`;
      } else {
        placarTexto = `<span class="placar-mini">${nome === linha.time_a ? jogo.placar_a : jogo.placar_b}</span>`;
      }
    }
    const podeTirar = ehMarcador() && vagaManual(linha, lado) && !linha.jogo_id;
    const botaoTirar = podeTirar
      ? `<button type="button" class="btn-tirar-sala" data-tirar-sala="${linha.id}" data-lado="${lado}" title="Tirar esta sala da vaga">✖</button>`
      : "";
    // Tênis de mesa: o atleta em destaque e a sala embaixo; nos outros esportes, a sala em destaque
    const principal = ehTenis(linha.modalidade) && integrantes ? integrantes : nome;
    const secundario = ehTenis(linha.modalidade) && integrantes ? nome : integrantes;
    return `<div class="lado-chave ${ehVencedor ? "vencedor-chave" : ""}"><span>${esc(principal)} ${placarTexto}${secundario ? `<small class="integrantes-chave">${esc(secundario)}</small>` : ""}</span>${botaoTirar}</div>`;
  }

  const partesInfo = [
    linha.numero_jogo ? `Jogo ${linha.numero_jogo}` : "",
    [linha.dia, linha.horario].filter(Boolean).join(" "),
    linha.obs || "",
  ].filter(Boolean);

  return `
    <div class="confronto-chave">
      ${partesInfo.length ? `<div class="info-jogo-chave">${esc(partesInfo.join(" · "))}</div>` : ""}
      ${ladoHtml(linha.time_a, ehLadoVencedor(linha, "a"), "a")}
      ${ladoHtml(linha.time_b, ehLadoVencedor(linha, "b"), "b")}
      ${temJogo ? `<p class="rodape-info" style="text-align:left; margin:6px 0 0;">Status: ${linha.jogo.status}</p>` : ""}
      ${podeIniciar ? `<button class="btn-iniciar-chave" data-iniciar-chave="${linha.id}">▶️ Iniciar esta partida</button>` : ""}
    </div>
  `;
}

// Uma vaga aceita sala colocada à mão quando nenhuma partida anterior manda o vencedor para ela
// (vale para toda a 1ª fase e também para quem entra direto numa fase seguinte)
function vagaManual(linha, lado) {
  return !linhasAtuais.some((outra) => outra.proximo_chave_id === linha.id && outra.proximo_slot === lado);
}

function renderizarChaveamento(linhas) {
  linhasAtuais = linhas;

  if (linhas.length === 0) {
    definirHtml(conteudoChaveamento, `<p class="rodape-info">${ehMarcador()
      ? 'Ainda não há quadro para esta modalidade. Use o botão "Adicionar salas" para montar.'
      : "A programação desta modalidade ainda não foi divulgada."}</p>`);
    atualizarControlesQuadro();
    return;
  }

  const fasesPresentes = ORDEM_FASE.filter((fase) => linhas.some((l) => l.fase === fase));

  const html = `
    <div class="chaveamento-fases">
      ${fasesPresentes.map((fase) => `
        <div class="chaveamento-coluna">
          <h3>${NOMES_FASE[fase]}</h3>
          ${linhas.filter((l) => l.fase === fase).sort((a, b) => a.posicao - b.posicao).map(montarConfronto).join("")}
        </div>
      `).join("")}
    </div>
  `;

  if (definirHtml(conteudoChaveamento, html)) {
    document.querySelectorAll("[data-iniciar-chave]").forEach((botao) => {
      botao.addEventListener("click", () => iniciarPartidaChave(botao.dataset.iniciarChave));
    });
    document.querySelectorAll("[data-tirar-sala]").forEach((botao) => {
      botao.addEventListener("click", () => tirarSala(botao.dataset.tirarSala, botao.dataset.lado));
    });
  }
  atualizarControlesQuadro();
}

// Controles do painel: sem quadro -> "criar quadro"; com quadro -> "colocar sala numa vaga"
function atualizarControlesQuadro() {
  if (!ehMarcador()) return;

  let html;
  if (linhasAtuais.length === 0) {
    html = `
      <label for="select-tamanho">Quantas salas entram no quadro?</label>
      <select id="select-tamanho">
        <option value="2">2 salas (só a final)</option>
        <option value="4">4 salas (semifinal e final)</option>
        <option value="8">8 salas (quartas, semifinal e final)</option>
        <option value="16" selected>16 salas (oitavas, quartas, semifinal e final)</option>
      </select>
      <button type="button" class="btn-primaria" id="btn-criar-quadro" style="margin-top:12px;">Criar quadro vazio</button>`;
  } else {
    const vagas = [];
    linhasAtuais.forEach((l) => {
      ["a", "b"].forEach((lado) => {
        if (vagaManual(l, lado) && !l[`time_${lado}`] && !l.jogo_id) {
          const nomeJogo = l.numero_jogo ? `Jogo ${l.numero_jogo}` : `${NOMES_FASE[l.fase]} ${l.posicao}`;
          vagas.push(`<option value="${l.id}|${lado}">${nomeJogo} · vaga ${lado.toUpperCase()}</option>`);
        }
      });
    });

    if (vagas.length === 0) {
      html = '<p class="rodape-info" style="text-align:left;">Todas as vagas estão preenchidas. 🎉</p>';
    } else {
      // Nos esportes individuais a mesma sala pode ter vários atletas; nos de equipe, cada sala entra uma vez
      const usadas = MODALIDADES_COM_JOGADORES.includes(selectModalidadeChave.value)
        ? []
        : linhasAtuais.flatMap((l) => [vagaManual(l, "a") ? l.time_a : null, vagaManual(l, "b") ? l.time_b : null]).filter(Boolean);
      const salas = turmasCadastradas.filter((nome) => !usadas.includes(nome));
      html = `
        <label for="select-vaga">Vaga</label>
        <select id="select-vaga">${vagas.join("")}</select>
        <label for="select-sala">Sala</label>
        <select id="select-sala">${salas.length ? salas.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("") : '<option value="">Nenhuma sala livre: adicione acima</option>'}</select>
        ${MODALIDADES_COM_JOGADORES.includes(selectModalidadeChave.value) ? `
          <label for="input-integrantes-quadro">Quem joga por esta sala (separe por vírgula)</label>
          <input type="text" id="input-integrantes-quadro" maxlength="200" placeholder="Ex: Ana, Bruno, Carla">` : ""}
        <button type="button" class="btn-primaria" id="btn-colocar-sala" style="margin-top:12px;">Colocar no quadro</button>`;
    }
  }

  // Guarda o que a pessoa tinha escolhido, pra não perder quando a lista é atualizada
  const vagaAntes = document.getElementById("select-vaga")?.value;
  const salaAntes = document.getElementById("select-sala")?.value;
  const jogadoresAntes = document.getElementById("input-integrantes-quadro")?.value;
  if (definirHtml(controlesQuadro, html)) {
    const vaga = document.getElementById("select-vaga");
    const sala = document.getElementById("select-sala");
    // Só devolve a escolha anterior se ela ainda existir na lista (a vaga/sala usada some)
    const aindaExiste = (lista, valor) => lista && valor && [...lista.options].some((o) => o.value === valor);
    if (aindaExiste(vaga, vagaAntes)) vaga.value = vagaAntes;
    if (aindaExiste(sala, salaAntes)) sala.value = salaAntes;
    const campoJogadores = document.getElementById("input-integrantes-quadro");
    if (campoJogadores && jogadoresAntes) campoJogadores.value = jogadoresAntes;
    document.getElementById("btn-criar-quadro")?.addEventListener("click", criarQuadro);
    document.getElementById("btn-colocar-sala")?.addEventListener("click", colocarSala);
  }
}

async function carregarChaveamento() {
  const modalidade = selectModalidadeChave.value;
  if (!modalidade) return;
  try {
    const resposta = await fetch(`/api/chaveamento/${encodeURIComponent(modalidade)}`);
    const linhas = await resposta.json();
    renderizarChaveamento(linhas);
  } catch (erro) {
    definirHtml(conteudoChaveamento, '<p class="erro">Não foi possível carregar o chaveamento.</p>');
  }
}

async function iniciarPartidaChave(id) {
  try {
    const resposta = await fetch(`/api/chaveamento/${id}/iniciar`, { method: "POST" });
    const dados = await resposta.json();
    if (!resposta.ok) {
      alert(dados.erro || "Não foi possível iniciar essa partida.");
      return;
    }
    await carregarChaveamento();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

async function chamarApi(url, opcoes, mensagemEl) {
  mensagemEl.textContent = "";
  try {
    const resposta = await fetch(url, opcoes);
    const dados = await resposta.json();
    if (!resposta.ok) {
      mensagemEl.textContent = dados.erro || "Não foi possível concluir a ação.";
      return null;
    }
    return dados;
  } catch (erro) {
    mensagemEl.textContent = "Erro de conexão com o servidor.";
    return null;
  }
}

function jsonPost(corpo) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) };
}

// Botão "➕ Adicionar salas": abre/fecha a área com o formulário
document.getElementById("btn-abrir-salas")?.addEventListener("click", () => {
  areaSalas.style.display = areaSalas.style.display === "none" ? "block" : "none";
});

// Cadastra as salas que faltam (mesma lista de turmas usada nos sorteios do painel do marcador)
document.getElementById("btn-adicionar-salas")?.addEventListener("click", async () => {
  const campo = document.getElementById("input-novas-salas");
  const nomes = campo.value.split(",").map((n) => n.trim()).filter(Boolean);
  if (nomes.length === 0) {
    msgSalas.textContent = "Digite o nome de pelo menos uma sala.";
    return;
  }
  const dados = await chamarApi("/api/turmas", jsonPost({ nomes }), msgSalas);
  if (!dados) return;
  campo.value = "";
  msgSalas.textContent = `Adicionadas: ${dados.adicionadas.join(", ")}` +
    (dados.ignoradas.length ? ` (já existiam: ${dados.ignoradas.join(", ")})` : "");
  await carregarTurmas();
});

// Exclui as salas marcadas na lista (uma chamada por sala; mostra o motivo se alguma não puder sair)
document.getElementById("btn-excluir-salas")?.addEventListener("click", async () => {
  const ids = [...listaSalas.querySelectorAll("input[type=checkbox]:checked")].map((c) => Number(c.value));
  if (ids.length === 0) {
    msgSalas.textContent = "Marque pelo menos uma sala para excluir.";
    return;
  }
  const nomes = ids.map((id) => turmasComId.find((t) => t.id === id)?.nome).filter(Boolean);
  if (!confirm(`Excluir ${nomes.length === 1 ? "a sala" : "as salas"}: ${nomes.join(", ")}?`)) return;

  const excluidas = [];
  const erros = [];
  for (const id of ids) {
    const nome = turmasComId.find((t) => t.id === id)?.nome || id;
    try {
      const resposta = await fetch(`/api/turmas/${id}`, { method: "DELETE" });
      if (resposta.ok) {
        excluidas.push(nome);
      } else {
        const dados = await resposta.json();
        erros.push(dados.erro || `Não foi possível excluir ${nome}.`);
      }
    } catch (erro) {
      erros.push(`Erro de conexão ao excluir ${nome}.`);
    }
  }
  msgSalas.textContent = (excluidas.length ? `Excluídas: ${excluidas.join(", ")}. ` : "") + erros.join(" ");
  await carregarTurmas();
});

async function criarQuadro() {
  const modalidade = selectModalidadeChave.value;
  const tamanho = Number(document.getElementById("select-tamanho").value);
  const dados = await chamarApi(`/api/chaveamento/${encodeURIComponent(modalidade)}/criar`, jsonPost({ tamanho }), msgChaveamento);
  if (dados) await carregarChaveamento();
}

async function colocarSala() {
  const [id, lado] = document.getElementById("select-vaga").value.split("|");
  const sala = document.getElementById("select-sala").value;
  if (!sala) {
    msgChaveamento.textContent = "Escolha uma sala (ou adicione novas salas acima).";
    return;
  }
  const integrantes = document.getElementById("input-integrantes-quadro")?.value.trim() || "";
  const dados = await chamarApi(`/api/chaveamento/${id}/sala`, jsonPost({ lado, sala, integrantes }), msgChaveamento);
  if (dados) await carregarChaveamento();
}

async function tirarSala(id, lado) {
  const dados = await chamarApi(`/api/chaveamento/${id}/sala/${lado}`, { method: "DELETE" }, msgChaveamento);
  if (dados) await carregarChaveamento();
}

document.getElementById("btn-resetar-chaveamento")?.addEventListener("click", async () => {
  const modalidade = selectModalidadeChave.value;
  if (!confirm(`Apagar todo o quadro de ${modalidade}?`)) return;
  const dados = await chamarApi(`/api/chaveamento/${encodeURIComponent(modalidade)}`, { method: "DELETE" }, msgChaveamento);
  if (dados) await carregarChaveamento();
});

selectModalidadeChave.addEventListener("change", () => {
  msgChaveamento.textContent = "";
  linhasAtuais = [];
  conteudoChaveamento.dataset.htmlAtual = "";
  carregarChaveamento();
});

(async function iniciar() {
  await carregarOpcoesModalidade();
  await carregarUsuario();
  await carregarChaveamento();
  setInterval(carregarChaveamento, 5000);
})();
