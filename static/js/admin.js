const containerUsuarios = document.getElementById("tabela-usuarios-container");

const ROTULOS_CARGO = { diretor: "Diretor", marcador: "Marcador", aluno: "Aluno" };

function montarLinhaUsuario(usuario) {
  let botaoAcao = "";
  if (usuario.cargo === "aluno") {
    botaoAcao = `<button class="btn-cargo" data-promover="${usuario.id}">⬆️ Tornar marcador</button>`;
  } else if (usuario.cargo === "marcador") {
    botaoAcao = `<button class="btn-cargo rebaixar" data-rebaixar="${usuario.id}">⬇️ Voltar a aluno</button>`;
  }

  return `
    <tr>
      <td>${usuario.nome}</td>
      <td>${usuario.email}</td>
      <td><span class="cargo-badge cargo-${usuario.cargo}">${ROTULOS_CARGO[usuario.cargo]}</span></td>
      <td>${botaoAcao}</td>
    </tr>
  `;
}

async function carregarUsuarios() {
  try {
    const resposta = await fetch("/api/usuarios");
    if (resposta.status === 401 || resposta.status === 403) {
      window.location.href = "/login";
      return;
    }
    const usuarios = await resposta.json();
    containerUsuarios.innerHTML = `
      <table class="tabela-usuarios">
        <thead>
          <tr><th>Nome</th><th>E-mail</th><th>Cargo</th><th></th></tr>
        </thead>
        <tbody>${usuarios.map(montarLinhaUsuario).join("")}</tbody>
      </table>
    `;

    document.querySelectorAll("[data-promover]").forEach((botao) => {
      botao.addEventListener("click", () => alterarCargo(botao.dataset.promover, "marcador"));
    });
    document.querySelectorAll("[data-rebaixar]").forEach((botao) => {
      botao.addEventListener("click", () => alterarCargo(botao.dataset.rebaixar, "aluno"));
    });
  } catch (erro) {
    containerUsuarios.innerHTML = '<p class="erro">Não foi possível carregar os usuários.</p>';
  }
}

async function alterarCargo(usuarioId, novoCargo) {
  const mensagem = novoCargo === "marcador"
    ? "Tornar este aluno marcador? Ele passará a poder acessar o painel de marcação."
    : "Rebaixar este marcador de volta a aluno? Ele perderá acesso ao painel de marcação.";
  if (!confirm(mensagem)) return;

  try {
    const resposta = await fetch(`/api/usuarios/${usuarioId}/cargo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cargo: novoCargo }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      alert(dados.erro || "Não foi possível alterar o cargo.");
      return;
    }
    await carregarUsuarios();
  } catch (erro) {
    alert("Erro de conexão com o servidor.");
  }
}

document.getElementById("link-sair").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

carregarUsuarios();
