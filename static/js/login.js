const btnEntrar = document.getElementById("btn-entrar");
const msgErro = document.getElementById("msg-erro");

async function entrar() {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  msgErro.textContent = "";

  if (!email || !senha) {
    msgErro.textContent = "Preencha e-mail e senha.";
    return;
  }

  try {
    const resposta = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      msgErro.textContent = dados.erro || "Não foi possível entrar.";
      return;
    }

    // Direciona pela função: marcador/diretor vão para a tela de marcação,
    // aluno comum vai para o placar público
    if (dados.cargo === "marcador" || dados.cargo === "diretor") {
      window.location.href = "/marcador";
    } else {
      window.location.href = "/placar";
    }
  } catch (erro) {
    msgErro.textContent = "Erro de conexão com o servidor.";
  }
}

btnEntrar.addEventListener("click", entrar);
document.getElementById("senha").addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrar();
});
