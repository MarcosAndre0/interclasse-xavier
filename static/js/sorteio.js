// Sorteio de turmas — quem enfrenta quem.
//
// Três coisas neste arquivo:
//   1. Botão 🎲 no formulário "+ Nova Partida" e no "Adicionar Confronto":
//      sorteia duas turmas e preenche os campos de sala.
//   2. Painel "🏫 Turmas participantes": a lista de turmas que entram nos sorteios.
//   3. Card "🎲 Sortear rodada completa": sorteia todos os confrontos de uma vez,
//      mostra o resultado e só salva depois que você confirmar.
//
// Tudo fica dentro de uma função (IIFE) pra não brigar com os nomes do marcador.js.

const Sorteio = (function () {
  // =====================================================================
  // Parte 1 — lógica do sorteio (não mexe na tela, por isso é fácil de testar)
  // =====================================================================

  // "1º A", "1ºa" e " 1º  A " viram a mesma coisa: "1ºa"
  function normalizarNome(nome) {
    return String(nome).toLowerCase().replace(/\s+/g, "");
  }

  // Chave de uma dupla sem ordem: (A, B) e (B, A) são o mesmo confronto
  function chaveDupla(a, b) {
    return [normalizarNome(a), normalizarNome(b)].sort().join("|");
  }

  function ordenarNatural(nomes) {
    return [...nomes].sort((x, y) => x.localeCompare(y, "pt-BR", { numeric: true, sensitivity: "base" }));
  }

  // Tira nomes repetidos (ignorando maiúsculas e espaços)
  function turmasUnicas(nomes) {
    const vistos = new Set();
    return nomes.filter((nome) => {
      const chave = normalizarNome(nome);
      if (!chave || vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  }

  // Embaralhamento de Fisher-Yates (todas as ordens têm a mesma chance)
  function embaralhar(lista) {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  }

  // Monta o conjunto de duplas que já existem numa modalidade
  // (nos próximos confrontos e nos jogos já criados)
  function montarUsados(modalidade, proximos, jogos) {
    const usados = new Set();
    proximos
      .filter((c) => c.modalidade === modalidade)
      .forEach((c) => usados.add(chaveDupla(c.sala_a, c.sala_b)));
    jogos
      .filter((j) => j.modalidade === modalidade)
      .forEach((j) => usados.add(chaveDupla(j.time_a, j.time_b)));
    return usados;
  }

  // Sorteia UMA dupla. Dá preferência a combinações que ainda não aconteceram
  // nessa modalidade; se todas já foram usadas, sorteia entre todas e avisa.
  function sortearDupla(turmas, usados) {
    const nomes = turmasUnicas(turmas);
    if (nomes.length < 2) return null;

    const todas = [];
    const ineditas = [];
    for (let i = 0; i < nomes.length; i++) {
      for (let j = i + 1; j < nomes.length; j++) {
        const par = [nomes[i], nomes[j]];
        todas.push(par);
        if (!usados.has(chaveDupla(nomes[i], nomes[j]))) ineditas.push(par);
      }
    }

    const base = ineditas.length > 0 ? ineditas : todas;
    const [x, y] = base[Math.floor(Math.random() * base.length)];
    const inverter = Math.random() < 0.5; // pra não ficar sempre em ordem alfabética
    return {
      a: inverter ? y : x,
      b: inverter ? x : y,
      todasUsadas: ineditas.length === 0,
      ineditasRestantes: ineditas.length > 0 ? ineditas.length - 1 : 0,
    };
  }

  // Sorteia uma rodada completa: todo mundo é pareado. Se o número de turmas for
  // ímpar, uma fica de folga. Tenta várias vezes achar uma rodada sem repetir
  // confrontos que já existem; se não der, fica com a que repete menos.
  function sortearRodadaCompleta(turmas, usados) {
    const nomes = turmasUnicas(turmas);
    if (nomes.length < 2) return null;

    let melhor = null;
    for (let tentativa = 0; tentativa < 300; tentativa++) {
      const ordem = embaralhar(nomes);
      const folga = ordem.length % 2 === 1 ? ordem.pop() : null;
      const pares = [];
      let repetidos = 0;
      for (let i = 0; i < ordem.length; i += 2) {
        pares.push([ordem[i], ordem[i + 1]]);
        if (usados.has(chaveDupla(ordem[i], ordem[i + 1]))) repetidos++;
      }
      if (melhor === null || repetidos < melhor.repetidos) {
        melhor = { pares, folga, repetidos };
      }
      if (repetidos === 0) break;
    }
    return melhor;
  }

  // Gera os horários de uma rodada: primeiro jogo às "inicio", depois um a cada
  // "intervalo" minutos. Sem horário inicial, ninguém recebe horário (null).
  // Horários que passariam da meia-noite também ficam sem horário.
  function gerarHorarios(quantidade, inicio, intervaloMinutos) {
    const partes = /^(\d{2}):(\d{2})$/.exec(inicio || "");
    if (!partes) return Array(quantidade).fill(null);

    const passo = Number.isFinite(intervaloMinutos) && intervaloMinutos > 0 ? intervaloMinutos : 30;
    const base = Number(partes[1]) * 60 + Number(partes[2]);

    return Array.from({ length: quantidade }, (_, i) => {
      const total = base + i * passo;
      if (total >= 24 * 60) return null;
      const hh = String(Math.floor(total / 60)).padStart(2, "0");
      const mm = String(total % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    });
  }

  // =====================================================================
  // Parte 2 — a tela (só roda no navegador)
  // =====================================================================

  function iniciarNaTela() {
    const $ = (id) => document.getElementById(id);

    function esc(texto) {
      return String(texto).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      ));
    }

    async function buscarJson(url) {
      const resposta = await fetch(url);
      if (!resposta.ok) throw new Error(`Erro ${resposta.status}`);
      return resposta.json();
    }

    // tipo: "erro" (vermelho), "ok" (verde) ou "info" (cinza)
    function mostrarMensagem(elemento, texto, tipo) {
      elemento.textContent = texto;
      elemento.className = "sorteio-msg" + (tipo === "erro" ? " erro" : tipo === "ok" ? " ok" : "");
    }

    function textoRestantes(n) {
      return n === 1 ? "Ainda resta 1 combinação inédita" : `Ainda restam ${n} combinações inéditas`;
    }

    // ---------- Turmas participantes ----------

    let turmas = []; // [{ id, nome }]
    const desmarcadas = new Set(); // turmas (normalizadas) que ficaram de fora do sorteio de rodada

    const listaTurmas = $("lista-turmas");
    const listaTurmasSorteio = $("sorteio-turmas");
    const inputNovasTurmas = $("input-novas-turmas");
    const msgTurmas = $("msg-turmas");

    function turmasOrdenadas() {
      return [...turmas].sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { numeric: true, sensitivity: "base" }));
    }

    function renderizarTurmas() {
      const ordenadas = turmasOrdenadas();

      if (ordenadas.length === 0) {
        const vazio = '<p class="rodape-info" style="text-align:left;">Nenhuma turma cadastrada ainda.</p>';
        listaTurmas.innerHTML = vazio;
        listaTurmasSorteio.innerHTML = vazio;
        return;
      }

      listaTurmas.innerHTML = ordenadas.map((t) => `
        <span class="chip-turma">
          ${esc(t.nome)}
          <button type="button" class="chip-remover" data-id="${t.id}" title="Remover ${esc(t.nome)}" aria-label="Remover ${esc(t.nome)}">×</button>
        </span>
      `).join("");

      listaTurmasSorteio.innerHTML = ordenadas.map((t) => `
        <label class="chip-turma chip-check">
          <input type="checkbox" value="${esc(t.nome)}" ${desmarcadas.has(normalizarNome(t.nome)) ? "" : "checked"}>
          ${esc(t.nome)}
        </label>
      `).join("");

      listaTurmas.querySelectorAll(".chip-remover").forEach((botao) => {
        botao.addEventListener("click", () => removerTurma(botao.dataset.id));
      });
    }

    async function carregarTurmas() {
      try {
        turmas = await buscarJson("/api/turmas");
      } catch (erro) {
        turmas = [];
      }
      renderizarTurmas();
    }

    async function adicionarTurmas() {
      const nomes = inputNovasTurmas.value.split(/[,;\n]+/).map((n) => n.trim()).filter(Boolean);
      if (nomes.length === 0) {
        mostrarMensagem(msgTurmas, "Digite o nome de pelo menos uma turma.", "erro");
        return;
      }

      try {
        const resposta = await fetch("/api/turmas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nomes }),
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
          mostrarMensagem(msgTurmas, dados.erro || "Não foi possível adicionar.", "erro");
          return;
        }

        inputNovasTurmas.value = "";
        let texto = dados.adicionadas.length === 1 ? "1 turma adicionada." : `${dados.adicionadas.length} turmas adicionadas.`;
        if (dados.ignoradas.length > 0) texto += ` (já existiam: ${dados.ignoradas.join(", ")})`;
        mostrarMensagem(msgTurmas, texto, "ok");
        await carregarTurmas();
      } catch (erro) {
        mostrarMensagem(msgTurmas, "Erro de conexão com o servidor.", "erro");
      }
    }

    async function removerTurma(id) {
      try {
        const resposta = await fetch(`/api/turmas/${id}`, { method: "DELETE" });
        if (!resposta.ok) {
          const dados = await resposta.json();
          mostrarMensagem(msgTurmas, dados.erro || "Não foi possível remover.", "erro");
          return;
        }
        mostrarMensagem(msgTurmas, "", "info");
        await carregarTurmas();
      } catch (erro) {
        mostrarMensagem(msgTurmas, "Erro de conexão com o servidor.", "erro");
      }
    }

    $("btn-abrir-turmas").addEventListener("click", async () => {
      const painel = $("painel-turmas");
      const abrindo = painel.style.display === "none";
      painel.style.display = abrindo ? "block" : "none";
      if (abrindo) await carregarTurmas();
    });
    $("btn-adicionar-turmas").addEventListener("click", adicionarTurmas);
    inputNovasTurmas.addEventListener("keydown", (e) => {
      if (e.key === "Enter") adicionarTurmas();
    });

    // ---------- 🎲 Sortear um confronto (nos dois formulários) ----------

    // Faz os nomes "girarem" nos campos por um instante antes de mostrar o resultado.
    // Quem prefere menos movimento no sistema (prefers-reduced-motion) pula a animação.
    function animarSorteio(nomes, aplicar) {
      const reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduzir || nomes.length < 3) return Promise.resolve();

      return new Promise((resolver) => {
        const inicio = Date.now();
        const timer = setInterval(() => {
          const [x, y] = embaralhar(nomes);
          aplicar(x, y);
          if (Date.now() - inicio >= 900) {
            clearInterval(timer);
            resolver();
          }
        }, 70);
      });
    }

    function ligarSorteioNoFormulario({ botao, mensagem, selectModalidade, campoA, campoB, aoSortear }) {
      botao.addEventListener("click", async () => {
        mostrarMensagem(mensagem, "", "info");
        botao.disabled = true;

        try {
          const modalidade = selectModalidade.value;
          let turmasAtuais, proximos, jogos;
          try {
            [turmasAtuais, proximos, jogos] = await Promise.all([
              buscarJson("/api/turmas"),
              buscarJson("/api/proximos-confrontos"),
              buscarJson("/api/jogos"),
            ]);
          } catch (erro) {
            mostrarMensagem(mensagem, "Não foi possível sortear agora (erro de conexão).", "erro");
            return;
          }

          // Já aproveita pra atualizar a lista de turmas na tela
          turmas = turmasAtuais;
          renderizarTurmas();

          const nomes = turmasUnicas(turmasAtuais.map((t) => t.nome));
          if (nomes.length < 2) {
            mostrarMensagem(mensagem, "Cadastre pelo menos 2 turmas em “🏫 Turmas participantes” para sortear.", "erro");
            return;
          }

          const usados = montarUsados(modalidade, proximos, jogos);
          const sorteado = sortearDupla(nomes, usados);

          campoA.classList.add("sorteando");
          campoB.classList.add("sorteando");
          await animarSorteio(nomes, (x, y) => {
            campoA.value = x;
            campoB.value = y;
          });
          campoA.classList.remove("sorteando");
          campoB.classList.remove("sorteando");

          campoA.value = sorteado.a;
          campoB.value = sorteado.b;
          if (aoSortear) aoSortear();

          let texto = `🎲 Sorteado: ${sorteado.a} × ${sorteado.b}. `;
          if (sorteado.todasUsadas) {
            texto += "Todas as combinações já tinham sido usadas nesta modalidade, então sorteei entre todas.";
          } else if (sorteado.ineditasRestantes === 0) {
            texto += "Era a última combinação inédita desta modalidade.";
          } else {
            texto += textoRestantes(sorteado.ineditasRestantes) + " nesta modalidade.";
          }
          mostrarMensagem(mensagem, texto, "ok");
        } finally {
          campoA.classList.remove("sorteando");
          campoB.classList.remove("sorteando");
          botao.disabled = false;
        }
      });
    }

    // Formulário "+ Nova Partida"
    const selectImportar = $("input-importar-confronto");
    ligarSorteioNoFormulario({
      botao: $("btn-sortear-partida"),
      mensagem: $("msg-sorteio-partida"),
      selectModalidade: $("input-modalidade"),
      campoA: $("input-time-a"),
      campoB: $("input-time-b"),
      aoSortear: () => {
        // A dupla sorteada é outra: solta o vínculo com um confronto importado,
        // pra que ele não seja apagado da lista de próximos por engano.
        if (selectImportar.value) {
          selectImportar.value = "";
          selectImportar.dispatchEvent(new Event("change"));
        }
      },
    });

    // Formulário "Adicionar Confronto"
    ligarSorteioNoFormulario({
      botao: $("btn-sortear-confronto"),
      mensagem: $("msg-sorteio-confronto"),
      selectModalidade: $("novo-confronto-modalidade"),
      campoA: $("novo-confronto-sala-a"),
      campoB: $("novo-confronto-sala-b"),
    });

    // ---------- 🎲 Sortear rodada completa ----------

    const selectRodadaModalidade = $("sorteio-modalidade");
    const inputInicio = $("sorteio-inicio");
    const inputIntervalo = $("sorteio-intervalo");
    const btnSortearRodada = $("btn-sortear-rodada");
    const blocoResultado = $("sorteio-resultado");
    const listaSorteio = $("sorteio-lista");
    const avisoSorteio = $("sorteio-aviso");
    const msgRodada = $("msg-sorteio-rodada");
    let sorteioAtual = null; // { modalidade, pares, horarios, folga }

    function esconderResultado() {
      blocoResultado.style.display = "none";
      sorteioAtual = null;
    }

    async function carregarModalidadesDoSorteio() {
      try {
        const modalidades = await buscarJson("/api/modalidades");
        selectRodadaModalidade.innerHTML = modalidades
          .map((m) => `<option value="${esc(m.nome)}">${esc(m.nome)}</option>`)
          .join("");
      } catch (erro) {
        selectRodadaModalidade.innerHTML = '<option value="">Erro ao carregar</option>';
      }
    }

    function renderizarResultado() {
      const { pares, horarios, folga, repetidos } = sorteioAtual;

      listaSorteio.innerHTML = pares.map(([a, b], i) => `
        <li class="item-sorteio" style="--i:${i}">
          <span class="par-sorteio">${esc(a)} <span class="vs">×</span> ${esc(b)}</span>
          ${horarios[i] ? `<span class="horario-sorteio">${horarios[i]}</span>` : ""}
        </li>
      `).join("");

      const avisos = [];
      if (folga) avisos.push(`😴 Folga nesta rodada: <strong>${esc(folga)}</strong> (número ímpar de turmas).`);
      if (repetidos > 0) {
        avisos.push(`⚠️ ${repetidos === 1 ? "1 confronto já existe" : `${repetidos} confrontos já existem`} nesta modalidade e não deu pra evitar com essas turmas.`);
      }
      avisoSorteio.innerHTML = avisos.map((a) => `<p>${a}</p>`).join("");

      blocoResultado.style.display = "block";
    }

    async function sortearRodadaNaTela() {
      mostrarMensagem(msgRodada, "", "info");
      esconderResultado();

      const modalidade = selectRodadaModalidade.value;
      if (!modalidade) {
        mostrarMensagem(msgRodada, "Escolha a modalidade.", "erro");
        return;
      }

      btnSortearRodada.disabled = true;
      try {
        let turmasAtuais, proximos, jogos;
        try {
          [turmasAtuais, proximos, jogos] = await Promise.all([
            buscarJson("/api/turmas"),
            buscarJson("/api/proximos-confrontos"),
            buscarJson("/api/jogos"),
          ]);
        } catch (erro) {
          mostrarMensagem(msgRodada, "Não foi possível sortear agora (erro de conexão).", "erro");
          return;
        }

        turmas = turmasAtuais;
        renderizarTurmas();

        const participantes = turmasUnicas(
          turmasAtuais.map((t) => t.nome).filter((nome) => !desmarcadas.has(normalizarNome(nome)))
        );
        if (participantes.length < 2) {
          mostrarMensagem(msgRodada, "Selecione pelo menos 2 turmas para sortear.", "erro");
          return;
        }

        const usados = montarUsados(modalidade, proximos, jogos);
        const rodada = sortearRodadaCompleta(participantes, usados);
        const intervalo = parseInt(inputIntervalo.value, 10);
        const horarios = gerarHorarios(rodada.pares.length, inputInicio.value, intervalo);

        sorteioAtual = { modalidade, pares: rodada.pares, horarios, folga: rodada.folga, repetidos: rodada.repetidos };
        renderizarResultado();
      } finally {
        btnSortearRodada.disabled = false;
      }
    }

    async function confirmarSorteio() {
      if (!sorteioAtual) return;
      const botao = $("btn-confirmar-sorteio");
      botao.disabled = true;
      mostrarMensagem(msgRodada, "", "info");

      const confrontos = sorteioAtual.pares.map(([a, b], i) => ({
        modalidade: sorteioAtual.modalidade,
        sala_a: a,
        sala_b: b,
        horario: sorteioAtual.horarios[i],
      }));

      try {
        const resposta = await fetch("/api/proximos-confrontos/lote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confrontos }),
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
          mostrarMensagem(msgRodada, dados.erro || "Não foi possível adicionar os confrontos.", "erro");
          return;
        }

        const n = dados.adicionados;
        esconderResultado();
        mostrarMensagem(msgRodada, `✅ ${n === 1 ? "1 confronto adicionado" : `${n} confrontos adicionados`} aos próximos confrontos.`, "ok");
        // Atualiza a lista editável que fica logo acima (função do marcador.js)
        if (typeof carregarProximosEditavel === "function") await carregarProximosEditavel();
      } catch (erro) {
        mostrarMensagem(msgRodada, "Erro de conexão com o servidor.", "erro");
      } finally {
        botao.disabled = false;
      }
    }

    btnSortearRodada.addEventListener("click", sortearRodadaNaTela);
    $("btn-sortear-de-novo").addEventListener("click", sortearRodadaNaTela);
    $("btn-confirmar-sorteio").addEventListener("click", confirmarSorteio);

    listaTurmasSorteio.addEventListener("change", (e) => {
      if (e.target.type !== "checkbox") return;
      const chave = normalizarNome(e.target.value);
      if (e.target.checked) desmarcadas.delete(chave);
      else desmarcadas.add(chave);
      esconderResultado(); // o resultado antigo não vale mais
    });

    $("sorteio-marcar-todas").addEventListener("click", () => {
      desmarcadas.clear();
      renderizarTurmas();
      esconderResultado();
    });

    $("sorteio-limpar").addEventListener("click", () => {
      turmas.forEach((t) => desmarcadas.add(normalizarNome(t.nome)));
      renderizarTurmas();
      esconderResultado();
    });

    [selectRodadaModalidade, inputInicio, inputIntervalo].forEach((campo) => {
      campo.addEventListener("change", esconderResultado);
    });

    // ---------- Começo ----------
    carregarModalidadesDoSorteio();
    carregarTurmas();
  }

  if (typeof document !== "undefined") iniciarNaTela();

  return { normalizarNome, chaveDupla, ordenarNatural, turmasUnicas, embaralhar, montarUsados, sortearDupla, sortearRodadaCompleta, gerarHorarios };
})();

// Permite testar a lógica no Node (node --test), sem afetar o navegador
if (typeof module !== "undefined" && module.exports) {
  module.exports = Sorteio;
}
