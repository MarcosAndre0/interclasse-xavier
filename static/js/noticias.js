// Página de notícias escolares: duas abas (Interclasse e Escola).
// Qualquer pessoa lê; só quem tem permissão vê o formulário de publicar.

const listaNoticias = document.getElementById("lista-noticias");
const painelPublicar = document.getElementById("painel-publicar");
const erroNoticia = document.getElementById("erro-noticia");

let abaAtual = "interclasse";
let usuario = null;
let noticiasAtuais = [];   // últimas notícias carregadas (usadas pelo botão Editar)
let editandoId = null;     // id da notícia sendo editada (null = publicando uma nova)

const TEXTOS_ABA = {
  interclasse: {
    legenda: "o que está acontecendo nos jogos agora",
    vazio: "Nenhuma notícia do interclasse por enquanto.",
    placeholder: "Ex.: Time do 3ºC teve aluno lesionado após jogada do adversário",
  },
  escola: {
    legenda: "avisos de professores, lanche e jogos de amanhã",
    vazio: "Nenhum aviso da escola por enquanto.",
    placeholder: "Ex.: O lanche do intervalo será: macarrão com frango",
  },
};

// Escapa o texto digitado por alguém antes de colocar na página (evita código malicioso)
function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function haQuantoTempo(dataTexto) {
  const data = new Date(dataTexto.replace(" ", "T") + "Z"); // o servidor guarda em UTC
  const minutos = Math.max(0, Math.floor((Date.now() - data.getTime()) / 60000));
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function podePublicar() {
  if (!usuario) return false;
  if (abaAtual === "interclasse") return usuario.cargo === "marcador" || usuario.cargo === "diretor";
  return usuario.cargo === "diretor";
}

// Quem pode publicar numa aba também pode editar e apagar as notícias dela:
// Escola = só o diretor; Interclasse = marcador e diretor.
function podeGerenciar(noticia) {
  if (!usuario) return false;
  if (noticia.categoria === "interclasse") return usuario.cargo === "marcador" || usuario.cargo === "diretor";
  return usuario.cargo === "diretor";
}

function definirHtml(elemento, html) {
  if (elemento.dataset.htmlAtual === html) return;
  elemento.innerHTML = html;
  elemento.dataset.htmlAtual = html;
}

function ajustarPainel() {
  painelPublicar.style.display = podePublicar() ? "block" : "none";
  document.getElementById("noticia-titulo").placeholder = TEXTOS_ABA[abaAtual].placeholder;
  if (!editandoId) document.getElementById("titulo-publicar").textContent =
    abaAtual === "interclasse" ? "Publicar notícia do interclasse" : "Publicar aviso da escola";
  document.getElementById("legenda-aba").textContent = TEXTOS_ABA[abaAtual].legenda;
}

async function carregarNoticias() {
  try {
    const resposta = await fetch(`/api/noticias?categoria=${abaAtual}`);
    const noticias = await resposta.json();
    noticiasAtuais = noticias;

    if (noticias.length === 0) {
      definirHtml(listaNoticias, `<p class="rodape-info">${TEXTOS_ABA[abaAtual].vazio}</p>`);
      return;
    }

    const html = noticias.map((n) => `
      <article class="noticia-card">
        <div class="noticia-topo">
          <span class="noticia-tag noticia-${n.categoria}">${n.categoria === "interclasse" ? "Interclasse" : "Escola"}</span>
          <span class="noticia-hora">${haQuantoTempo(n.criado_em)}</span>
        </div>
        <h3>${escapar(n.titulo)}</h3>
        ${n.texto ? `<p>${escapar(n.texto)}</p>` : ""}
        <div class="noticia-rodape">
          <span>${n.autor_nome ? "por " + escapar(n.autor_nome) : ""}</span>
          ${podeGerenciar(n) ? `
            <span class="noticia-acoes">
              <button type="button" class="btn-editar" data-editar="${n.id}">✏️ Editar</button>
              <button type="button" class="btn-excluir" data-apagar="${n.id}">🗑️ Apagar</button>
            </span>` : ""}
        </div>
      </article>
    `).join("");

    definirHtml(listaNoticias, html);
  } catch (erro) {
    definirHtml(listaNoticias, '<p class="erro">Não foi possível carregar as notícias.</p>');
  }
}

// Um único "ouvinte" na lista cuida dos botões de apagar (funciona mesmo quando a lista é redesenhada)
listaNoticias.addEventListener("click", async (e) => {
  const botaoEditar = e.target.closest("[data-editar]");
  if (botaoEditar) {
    const noticia = noticiasAtuais.find((n) => n.id === Number(botaoEditar.dataset.editar));
    if (noticia) comecarEdicao(noticia);
    return;
  }

  const botao = e.target.closest("[data-apagar]");
  if (!botao) return;
  if (!confirm("Apagar esta notícia?")) return;
  const resposta = await fetch(`/api/noticias/${botao.dataset.apagar}`, { method: "DELETE" });
  if (!resposta.ok) {
    const dados = await resposta.json();
    alert(dados.erro || "Não foi possível apagar.");
    return;
  }
  carregarNoticias();
});

function comecarEdicao(noticia) {
  editandoId = noticia.id;
  document.getElementById("noticia-titulo").value = noticia.titulo;
  document.getElementById("noticia-texto").value = noticia.texto || "";
  document.getElementById("btn-publicar").textContent = "Salvar alterações";
  document.getElementById("btn-cancelar-edicao").style.display = "block";
  document.getElementById("titulo-publicar").textContent = "Editando notícia";
  erroNoticia.textContent = "";
  painelPublicar.scrollIntoView({ behavior: "smooth", block: "center" });
}

function terminarEdicao() {
  editandoId = null;
  document.getElementById("noticia-titulo").value = "";
  document.getElementById("noticia-texto").value = "";
  document.getElementById("btn-publicar").textContent = "Publicar";
  document.getElementById("btn-cancelar-edicao").style.display = "none";
  ajustarPainel();
}

document.getElementById("btn-cancelar-edicao").addEventListener("click", terminarEdicao);

document.querySelectorAll("[data-aba]").forEach((botao) => {
  botao.addEventListener("click", () => {
    abaAtual = botao.dataset.aba;
    if (editandoId) terminarEdicao();
    document.querySelectorAll("[data-aba]").forEach((b) => b.classList.toggle("selecionada", b === botao));
    erroNoticia.textContent = "";
    ajustarPainel();
    listaNoticias.dataset.htmlAtual = "";
    carregarNoticias();
  });
});

document.getElementById("btn-publicar").addEventListener("click", async () => {
  const titulo = document.getElementById("noticia-titulo");
  const texto = document.getElementById("noticia-texto");
  erroNoticia.textContent = "";

  // Se estiver editando, salva por cima da notícia; senão, cria uma nova
  const resposta = await fetch(editandoId ? `/api/noticias/${editandoId}` : "/api/noticias", {
    method: editandoId ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoria: abaAtual, titulo: titulo.value, texto: texto.value }),
  });
  const dados = await resposta.json();
  if (!resposta.ok) {
    erroNoticia.textContent = dados.erro || "Não foi possível publicar.";
    return;
  }
  terminarEdicao();
  carregarNoticias();
});

(async function iniciar() {
  try {
    const resposta = await fetch("/api/me");
    usuario = await resposta.json();
  } catch (erro) {
    usuario = null;
  }
  const link = document.getElementById("link-login");
  if (usuario && link) {
    const ehMarcador = usuario.cargo === "marcador" || usuario.cargo === "diretor";
    link.textContent = ehMarcador ? `${usuario.nome} · Painel do Marcador` : usuario.nome;
    link.href = ehMarcador ? "/marcador" : "#";
  }
  ajustarPainel();
  await carregarNoticias();
  setInterval(carregarNoticias, 10000);
})();
