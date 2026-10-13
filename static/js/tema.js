// Comportamentos comuns do layout: modo escuro/claro, menu no celular e data no topo.
// A preferência de tema fica salva no navegador (localStorage), então cada pessoa mantém sua escolha.

(function () {
  const CHAVE = "interclasse-tema";

  function aplicarTema(tema) {
    if (tema === "escuro") {
      document.documentElement.setAttribute("data-tema", "escuro");
    } else {
      document.documentElement.removeAttribute("data-tema");
    }
  }

  function temaAtual() {
    return localStorage.getItem(CHAVE) === "escuro" ? "escuro" : "claro";
  }

  // Aplica antes do resto da página carregar, pra não "piscar" claro e depois escurecer
  aplicarTema(temaAtual());

  function alternarTema() {
    const novoTema = temaAtual() === "escuro" ? "claro" : "escuro";
    localStorage.setItem(CHAVE, novoTema);
    aplicarTema(novoTema);
    atualizarVisual();
  }

  let atualizarVisual = function () {};

  function configurarTema() {
    const botaoMenu = document.getElementById("alternar-tema");

    if (botaoMenu) {
      // Páginas com menu lateral: o interruptor fica dentro do menu
      const texto = document.getElementById("texto-tema");
      const chave = document.getElementById("chave-tema");
      atualizarVisual = function () {
        const escuro = temaAtual() === "escuro";
        texto.textContent = escuro ? "Modo claro" : "Modo escuro";
        chave.classList.toggle("is-on", escuro);
      };
      botaoMenu.addEventListener("click", alternarTema);
    } else {
      // Login e cadastro (sem menu): botão redondo no canto da tela
      const botao = document.createElement("button");
      botao.className = "btn-tema";
      botao.type = "button";
      botao.title = "Alternar modo escuro/claro";
      atualizarVisual = function () {
        botao.textContent = temaAtual() === "escuro" ? "☀️" : "🌙";
      };
      botao.addEventListener("click", alternarTema);
      document.body.appendChild(botao);
    }
    atualizarVisual();
  }

  function configurarMenuCelular() {
    const menu = document.getElementById("menu-lateral");
    const abrir = document.getElementById("abrir-menu");
    const fundo = document.getElementById("fundo-menu");
    if (!menu || !abrir || !fundo) return;

    function fechar() {
      menu.classList.remove("is-open");
      fundo.style.display = "none";
    }
    abrir.addEventListener("click", () => {
      menu.classList.add("is-open");
      fundo.style.display = "block";
    });
    fundo.addEventListener("click", fechar);
  }

  function mostrarData() {
    const hoje = new Date();
    const longa = document.getElementById("data-longa");
    const curta = document.getElementById("data-curta");
    if (longa) {
      longa.textContent = hoje.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(/\./g, "");
    }
    if (curta) {
      curta.textContent = hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    configurarTema();
    configurarMenuCelular();
    mostrarData();
  });
})();
