const DOMINIO_ESCOLAR = "escola.pr.gov.br";

const btnCadastrar = document.getElementById("btn-cadastrar");
const msgErro = document.getElementById("msg-erro");

async function cadastrar() {
  const nome = document.getElementById("nome").value.trim();
  const email = document.getElementById("email").value.trim().toLowerCase();
  const senha = document.getElementById("senha").value;
  const confirmarSenha = document.getElementById("confirmar-senha").value;
  msgErro.textContent = "";

  if (!nome || !email || !senha || !confirmarSenha) {
    msgErro.textContent = "Preencha todos os campos.";
    return;
  }

  // Checagem só de conveniência — quem garante de verdade é o servidor
  if (!email.endsWith("@" + DOMINIO_ESCOLAR)) {
    msgErro.textContent = `Use seu e-mail escolar (@${DOMINIO_ESCOLAR}).`;
    return;
  }

  if (senha.length < 4) {
    msgErro.textContent = "A senha precisa ter pelo menos 4 caracteres.";
    return;
  }

  if (senha !== confirmarSenha) {
    msgErro.textContent = "As senhas não coincidem.";
    return;
  }

  try {
    const resposta = await fetch("/api/cadastro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, email, senha }),
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      msgErro.textContent = dados.erro || "Não foi possível criar a conta.";
      return;
    }

    // Aluno recém-cadastrado já entra logado, vai direto pro placar público
    window.location.href = "/placar";
  } catch (erro) {
    msgErro.textContent = "Erro de conexão com o servidor.";
  }
}

btnCadastrar.addEventListener("click", cadastrar);
document.getElementById("confirmar-senha").addEventListener("keydown", (e) => {
  if (e.key === "Enter") cadastrar();
});
