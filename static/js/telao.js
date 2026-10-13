const telaoContainer = document.getElementById("telao-container");
const telaoProximos = document.getElementById("telao-proximos");
const telaoQrcode = document.getElementById("telao-qrcode");

const SEGUNDOS_POR_JOGO = 6;

let jogosAoVivo = [];
let indiceAtual = 0;

function montarTelaJogo(jogo) {
  const local = jogo.local ? `<div class="telao-local">📍 ${jogo.local}</div>` : "";

  if (jogo.modalidade === "Xadrez") {
    return `
      <div class="telao-modalidade">${jogo.modalidade}</div>
      ${local}
      <div class="telao-placar">
        <div class="telao-time">${jogo.time_a}</div>
        <div class="telao-vs">×</div>
        <div class="telao-time">${jogo.time_b}</div>
      </div>
    `;
  }

  const infoSets = (jogo.sets_para_vencer)
    ? `<div class="telao-local">Sets: ${jogo.sets_vencidos_a} × ${jogo.sets_vencidos_b} · Set ${jogo.set_atual}</div>`
    : "";

  return `
    <div class="telao-modalidade">${jogo.modalidade}</div>
    ${local}
    ${infoSets}
    <div class="telao-placar">
      <div class="telao-time">${jogo.time_a}</div>
      <div class="telao-pontos">${jogo.placar_a}</div>
      <div class="telao-vs">×</div>
      <div class="telao-pontos">${jogo.placar_b}</div>
      <div class="telao-time">${jogo.time_b}</div>
    </div>
    ${jogo.em_penaltis ? `
      <div class="telao-local" style="margin-top:20px;">
        🥅 Pênaltis: ${jogo.penaltis_a} × ${jogo.penaltis_b}
      </div>
    ` : ""}
  `;
}

function renderizarTela() {
  if (jogosAoVivo.length === 0) {
    telaoContainer.innerHTML = '<p class="telao-vazio">Nenhum jogo ao vivo no momento.</p>';
    return;
  }
  if (indiceAtual >= jogosAoVivo.length) indiceAtual = 0;
  telaoContainer.innerHTML = montarTelaJogo(jogosAoVivo[indiceAtual]);
}

async function atualizarJogos() {
  try {
    const resposta = await fetch("/api/jogos");
    const todos = await resposta.json();
    jogosAoVivo = todos.filter((j) => j.status === "ao_vivo");
    renderizarTela();
  } catch (erro) {
    telaoContainer.innerHTML = '<p class="telao-vazio">Não foi possível conectar ao servidor.</p>';
  }
}

async function atualizarProximos() {
  try {
    const resposta = await fetch("/api/proximos-confrontos?programacao=1");
    const confrontos = await resposta.json();
    if (confrontos.length === 0) {
      telaoProximos.innerHTML = "";
      return;
    }
    const proximo = confrontos[0];
    telaoProximos.innerHTML = `Próximo: ${proximo.modalidade} · ${proximo.sala_a} × ${proximo.sala_b}${proximo.horario ? ` · ${proximo.horario}` : ""}`;
  } catch (erro) {
    telaoProximos.innerHTML = "";
  }
}

function montarQrCode() {
  const url = `${window.location.origin}/placar`;
  telaoQrcode.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
  telaoQrcode.onerror = () => { telaoQrcode.style.display = "none"; };
}

function girarParaProximo() {
  indiceAtual += 1;
  renderizarTela();
}

montarQrCode();
atualizarJogos();
atualizarProximos();
setInterval(atualizarJogos, 4000);
setInterval(atualizarProximos, 15000);
setInterval(girarParaProximo, SEGUNDOS_POR_JOGO * 1000);
