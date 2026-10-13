// Tela de "quem ganhou": aparece sozinha, em qualquer página, quando uma partida acaba de ser encerrada.
// Funciona assim: a cada 3 segundos pergunta ao servidor os jogos; se algum foi encerrado há poucos
// segundos e ainda não foi mostrado neste navegador, abre a tela por alguns segundos.

(function () {
  const JANELA_SEGUNDOS = 20;   // só mostra partidas encerradas há até 20s
  const DURACAO_MS = 9000;      // tempo que a tela fica aberta
  const CHAVE = "interclasse-vitorias-vistas";

  let vistos = [];
  try { vistos = JSON.parse(sessionStorage.getItem(CHAVE) || "[]"); } catch (e) { vistos = []; }

  const fila = [];
  let mostrando = false;
  let temporizador = null;
  let tela = null;

  function escapar(texto) {
    const div = document.createElement("div");
    div.textContent = texto == null ? "" : String(texto);
    return div.innerHTML;
  }

  function criarTela() {
    tela = document.createElement("div");
    tela.className = "vitoria-tela";
    tela.innerHTML = `
      <div class="vitoria-confete">${"<i></i>".repeat(14)}</div>
      <div class="vitoria-caixa">
        <img class="vitoria-logo" src="/static/img/logo.png" alt="">
        <div class="vitoria-modalidade" id="vitoria-modalidade"></div>
        <div class="vitoria-titulo" id="vitoria-titulo"></div>
        <div class="vitoria-placar" id="vitoria-placar"></div>
        <div class="vitoria-dica">toque para fechar</div>
      </div>`;
    tela.addEventListener("click", fechar);
    document.body.appendChild(tela);
  }

  function textoPlacar(jogo) {
    if (jogo.modalidade === "Xadrez") return "";
    if (jogo.sets_para_vencer) {
      return `${jogo.time_a} ${jogo.sets_vencidos_a} × ${jogo.sets_vencidos_b} ${jogo.time_b} (sets)`;
    }
    if (jogo.em_penaltis) {
      return `${jogo.time_a} ${jogo.placar_a} × ${jogo.placar_b} ${jogo.time_b} · pênaltis ${jogo.penaltis_a} × ${jogo.penaltis_b}`;
    }
    return `${jogo.time_a} ${jogo.placar_a} × ${jogo.placar_b} ${jogo.time_b}`;
  }

  function mostrar(jogo) {
    if (!tela) criarTela();
    mostrando = true;

    const empate = !jogo.vencedor_nome;
    document.getElementById("vitoria-modalidade").textContent = jogo.modalidade + (jogo.local ? " · " + jogo.local : "");
    document.getElementById("vitoria-titulo").innerHTML = empate
      ? "Empate! <span>Foi um jogão!</span>"
      : `${escapar(jogo.vencedor_nome)} Ganhou! <span>Boa!</span>`;
    document.getElementById("vitoria-placar").textContent = textoPlacar(jogo);

    tela.classList.toggle("vitoria-empate", empate);
    tela.classList.add("aberta");
    temporizador = setTimeout(fechar, DURACAO_MS);
  }

  function fechar() {
    clearTimeout(temporizador);
    if (tela) tela.classList.remove("aberta");
    mostrando = false;
    setTimeout(proxima, 500);
  }

  function proxima() {
    if (mostrando || fila.length === 0) return;
    mostrar(fila.shift());
  }

  async function verificar() {
    try {
      const resposta = await fetch("/api/jogos");
      if (!resposta.ok) return;
      const jogos = await resposta.json();
      jogos.forEach((jogo) => {
        if (jogo.status !== "encerrado") return;
        if (jogo.segundos_desde_encerrar == null || jogo.segundos_desde_encerrar > JANELA_SEGUNDOS) return;
        if (vistos.includes(jogo.id)) return;
        vistos.push(jogo.id);
        fila.push(jogo);
      });
      sessionStorage.setItem(CHAVE, JSON.stringify(vistos.slice(-50)));
      proxima();
    } catch (erro) {
      // sem conexão: tenta de novo no próximo ciclo
    }
  }

  window.verificarVitoria = verificar; // o marcador chama isso logo depois de encerrar
  verificar();
  setInterval(verificar, 3000);
})();
