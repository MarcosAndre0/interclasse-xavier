from functools import wraps
import json
import re
from datetime import datetime

from flask import Flask, request, jsonify, session, render_template, redirect, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from database import get_conexao, inicializar_banco

app = Flask(__name__)
app.secret_key = "troque-esta-chave-por-algo-secreto"  # IMPORTANTE: troque antes de usar fora do seu PC

inicializar_banco()

# Só e-mails desse domínio podem se cadastrar sozinhos como aluno.
# Contas de diretor/marcador continuam sendo criadas manualmente no banco (não por aqui).
DOMINIO_ESCOLAR = "escola.pr.gov.br"
REGEX_EMAIL_ESCOLAR = re.compile(rf"^[^\s@]+@{re.escape(DOMINIO_ESCOLAR)}$", re.IGNORECASE)

# Mapa de qual local cada modalidade usa (definido pelo servidor, não pelo cliente)
LOCAIS_POR_MODALIDADE = {
    "Futebol": "Campo de Futebol",
    "Futebol Feminino": "Campo de Futebol",
    "Vôlei": "Quadra de Vôlei",
    "Basquete": "Quadra de Basquete",
    "Handebol": "Quadra de Handebol",
    "Tênis de Mesa Feminino": "Sala de Tênis de Mesa",
    "Tênis de Mesa Masculino": "Sala de Tênis de Mesa",
    "Xadrez": "Sala de Xadrez",
}

# Só faz sentido resolver empate nos pênaltis nessas modalidades
MODALIDADES_COM_PENALTIS = ("Futebol", "Futebol Feminino", "Handebol")

# Modalidades que jogam por sets: melhor de 5 (precisa vencer 3)
SETS_PARA_VENCER = {
    "Vôlei": 3,
    "Tênis de Mesa": 3,
    "Tênis de Mesa Feminino": 3,
    "Tênis de Mesa Masculino": 3,
}

# Xadrez não tem placar numérico: termina por xeque-mate ou empate
MODALIDADES_SEM_PLACAR = ("Xadrez",)

# Modalidades em que, no chaveamento, cada sala escolhe quem joga por ela (uma ou várias pessoas)
MODALIDADES_COM_JOGADORES = ("Xadrez", "Tênis de Mesa", "Tênis de Mesa Feminino", "Tênis de Mesa Masculino")

# ---------- Classificação por turma ----------

PONTOS_VITORIA = 3
PONTOS_EMPATE = 1
PONTOS_DERROTA = 0

# ---------- Chaveamento de mata-mata ----------

# Ordem das fases e quantos confrontos cada uma tem, de acordo com quantas turmas entram
FASES_POR_QUANTIDADE = {
    16: ["oitavas", "quartas", "semifinal", "final"],
    8: ["quartas", "semifinal", "final"],
    4: ["semifinal", "final"],
    2: ["final"],
}
JOGOS_POR_FASE = {"oitavas": 8, "quartas": 4, "semifinal": 2, "final": 1}

# Ordem de exibição de todas as fases possíveis (usada para ordenar o quadro)
ORDEM_SQL_FASES = "CASE fase WHEN 'rodada1' THEN 0 WHEN 'rodada2' THEN 1 WHEN 'oitavas' THEN 2 WHEN 'quartas' THEN 3 WHEN 'semifinal' THEN 4 ELSE 5 END"


def determinar_vencedor(jogo):
    """Retorna 'a', 'b' ou None (empate/indefinido) pra uma partida já encerrada,
    olhando o tipo de placar de cada modalidade."""
    if jogo["modalidade"] in MODALIDADES_SEM_PLACAR:
        if jogo["resultado"] == "vencedor_a":
            return "a"
        if jogo["resultado"] == "vencedor_b":
            return "b"
        return None

    if jogo["modalidade"] in SETS_PARA_VENCER:
        if jogo["sets_vencidos_a"] != jogo["sets_vencidos_b"]:
            return "a" if jogo["sets_vencidos_a"] > jogo["sets_vencidos_b"] else "b"
        return None

    if jogo["em_penaltis"] and jogo["penaltis_a"] != jogo["penaltis_b"]:
        return "a" if jogo["penaltis_a"] > jogo["penaltis_b"] else "b"

    if jogo["placar_a"] != jogo["placar_b"]:
        return "a" if jogo["placar_a"] > jogo["placar_b"] else "b"

    return None


def avancar_chaveamento(conexao, jogo_id):
    """Quando uma partida de mata-mata é encerrada, descobre o vencedor e já
    preenche o confronto da próxima fase com o nome do time que avançou."""
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()
    if not jogo or not jogo["chaveamento_id"]:
        return

    vencedor_lado = determinar_vencedor(jogo)
    if vencedor_lado is None:
        return  # empate sem pênaltis ainda, ou partida sem resultado claro: não avança

    nome_vencedor = jogo["time_a"] if vencedor_lado == "a" else jogo["time_b"]

    linha = conexao.execute("SELECT * FROM chaveamento WHERE id = ?", (jogo["chaveamento_id"],)).fetchone()
    if not linha:
        return

    conexao.execute("UPDATE chaveamento SET vencedor = ? WHERE id = ?", (nome_vencedor, linha["id"]))

    if linha["proximo_chave_id"]:
        coluna = "time_a" if linha["proximo_slot"] == "a" else "time_b"
        coluna_integrantes = "integrantes_a" if linha["proximo_slot"] == "a" else "integrantes_b"
        # No Xadrez, quem jogou pela sala vencedora segue junto com ela para a próxima fase
        integrantes_vencedor = linha["integrantes_a"] if vencedor_lado == "a" else linha["integrantes_b"]
        conexao.execute(
            f"UPDATE chaveamento SET {coluna} = ?, {coluna_integrantes} = ? WHERE id = ?",
            (nome_vencedor, integrantes_vencedor, linha["proximo_chave_id"])
        )


def criar_chaveamento_vazio(conexao, modalidade, tamanho):
    """Apaga o quadro anterior dessa modalidade e monta um quadro novo, com todas as vagas
    "A definir". Quem coloca as salas nas vagas é o marcador (a programação vem da escola).
    `tamanho` precisa ser 2, 4, 8 ou 16 salas."""
    if tamanho not in FASES_POR_QUANTIDADE:
        raise ValueError("Escolha 2, 4, 8 ou 16 salas para montar o chaveamento.")

    fases = FASES_POR_QUANTIDADE[tamanho]

    conexao.execute("DELETE FROM chaveamento WHERE modalidade = ?", (modalidade,))

    ids_por_fase = {}
    for fase in fases:
        ids = []
        for posicao in range(1, JOGOS_POR_FASE[fase] + 1):
            cursor = conexao.execute(
                "INSERT INTO chaveamento (modalidade, fase, posicao) VALUES (?, ?, ?)",
                (modalidade, fase, posicao)
            )
            ids.append(cursor.lastrowid)
        ids_por_fase[fase] = ids

    # Liga cada confronto ao da fase seguinte (o vencedor avança sozinho)
    for indice, fase in enumerate(fases[:-1]):
        proxima_fase = fases[indice + 1]
        proximos_ids = ids_por_fase[proxima_fase]
        for posicao_idx, chave_id in enumerate(ids_por_fase[fase]):
            proximo_id = proximos_ids[posicao_idx // 2]
            slot = "a" if posicao_idx % 2 == 0 else "b"
            conexao.execute(
                "UPDATE chaveamento SET proximo_chave_id = ?, proximo_slot = ? WHERE id = ?",
                (proximo_id, slot, chave_id)
            )


def vaga_recebe_vencedor(conexao, chave_id, lado):
    """True se essa vaga é preenchida pelo vencedor de outra partida (então não se coloca sala à mão)."""
    return conexao.execute(
        "SELECT 1 FROM chaveamento WHERE proximo_chave_id = ? AND proximo_slot = ?", (chave_id, lado)
    ).fetchone() is not None


def linha_da_vaga(conexao, chave_id, lado):
    """Devolve a linha do chaveamento se a vaga aceita sala colocada à mão; senão None.
    Vale para a 1ª fase inteira e também para vagas diretas de fases seguintes (quem entra sem jogar antes)."""
    linha = conexao.execute("SELECT * FROM chaveamento WHERE id = ?", (chave_id,)).fetchone()
    if not linha or vaga_recebe_vencedor(conexao, chave_id, lado):
        return None
    return linha


def pontos_necessarios_set(modalidade, numero_set):
    """Quantos pontos fecham o set atual, considerando a regra oficial de cada modalidade."""
    if modalidade == "Vôlei":
        return 15 if numero_set == 5 else 25
    if modalidade.startswith("Tênis de Mesa"):
        return 11
    return None


def enriquecer_jogo(jogo_row):
    """Converte a linha do banco em dict e adiciona campos calculados
    (necessários pro front-end saber quando o set pode ser fechado)."""
    jogo = dict(jogo_row)
    if jogo["modalidade"] in SETS_PARA_VENCER:
        jogo["pontos_necessarios_set"] = pontos_necessarios_set(jogo["modalidade"], jogo["set_atual"])
        jogo["sets_para_vencer"] = SETS_PARA_VENCER[jogo["modalidade"]]
    try:
        jogo["historico_sets"] = json.loads(jogo["historico_sets"] or "[]")
    except (TypeError, ValueError):
        jogo["historico_sets"] = []

    # Dados pra tela "quem ganhou": só existem em partidas encerradas
    if jogo["status"] == "encerrado":
        lado = determinar_vencedor(jogo)
        jogo["vencedor_lado"] = lado  # "a", "b" ou None (empate)
        jogo["vencedor_nome"] = jogo["time_a"] if lado == "a" else jogo["time_b"] if lado == "b" else None
        jogo["segundos_desde_encerrar"] = None
        if jogo.get("encerrado_em"):
            try:
                momento = datetime.strptime(jogo["encerrado_em"], "%Y-%m-%d %H:%M:%S")
                jogo["segundos_desde_encerrar"] = max(0, int((datetime.utcnow() - momento).total_seconds()))
            except ValueError:
                pass
    return jogo


# ---------- Auxiliares de autenticação ----------

def usuario_atual():
    if "usuario_id" not in session:
        return None
    conexao = get_conexao()
    usuario = conexao.execute(
        "SELECT id, nome, email, cargo FROM usuarios WHERE id = ?", (session["usuario_id"],)
    ).fetchone()
    conexao.close()
    return dict(usuario) if usuario else None


def requer_cargo(*cargos_permitidos):
    """Decorator que bloqueia uma rota de API se o usuário não estiver logado
    ou não tiver um dos cargos permitidos."""
    def decorador(funcao):
        @wraps(funcao)
        def wrapper(*args, **kwargs):
            usuario = usuario_atual()
            if not usuario:
                return jsonify({"erro": "Não autenticado."}), 401
            if usuario["cargo"] not in cargos_permitidos:
                return jsonify({"erro": "Sem permissão para esta ação."}), 403
            return funcao(*args, **kwargs)
        return wrapper
    return decorador


# ---------- Páginas (HTML) ----------

@app.route("/")
def index():
    return redirect(url_for("pagina_placar"))


@app.route("/login")
def pagina_login():
    return render_template("login.html")


@app.route("/cadastro")
def pagina_cadastro():
    return render_template("cadastro.html")


@app.route("/placar")
def pagina_placar():
    # Página pública: qualquer pessoa acompanha o placar ao vivo, sem login
    return render_template("placar.html")


@app.route("/marcador")
def pagina_marcador():
    usuario = usuario_atual()
    if not usuario or usuario["cargo"] not in ("marcador", "diretor"):
        return redirect(url_for("pagina_login"))
    return render_template("marcador.html")


@app.route("/classificacao")
def pagina_classificacao():
    # Página pública: mostra quem está liderando o interclasse
    return render_template("classificacao.html")


@app.route("/chaveamento")
def pagina_chaveamento():
    # Página pública: acompanhar o mata-mata; só marcador/diretor conseguem sortear e iniciar partidas
    return render_template("chaveamento.html")


@app.route("/noticias")
def pagina_noticias():
    return render_template("noticias.html")


@app.route("/telao")
def pagina_telao():
    # Página pública pensada pra projetar: sem navegação, letras grandes, rotação automática
    return render_template("telao.html")


@app.route("/admin")
def pagina_admin():
    usuario = usuario_atual()
    if not usuario or usuario["cargo"] != "diretor":
        return redirect(url_for("pagina_login"))
    return render_template("admin.html")


# ---------- API: autenticação ----------

@app.route("/api/login", methods=["POST"])
def api_login():
    dados = request.get_json(force=True)
    email = (dados.get("email") or "").strip().lower()
    senha = dados.get("senha") or ""

    conexao = get_conexao()
    usuario = conexao.execute("SELECT * FROM usuarios WHERE email = ?", (email,)).fetchone()
    conexao.close()

    if not usuario or not check_password_hash(usuario["senha_hash"], senha):
        return jsonify({"erro": "E-mail ou senha incorretos."}), 401

    session["usuario_id"] = usuario["id"]
    return jsonify({"id": usuario["id"], "nome": usuario["nome"], "cargo": usuario["cargo"]})


@app.route("/api/cadastro", methods=["POST"])
def api_cadastro():
    dados = request.get_json(force=True)
    nome = (dados.get("nome") or "").strip()
    email = (dados.get("email") or "").strip().lower()
    senha = dados.get("senha") or ""

    if not nome or not email or not senha:
        return jsonify({"erro": "Preencha nome, e-mail e senha."}), 400

    if not REGEX_EMAIL_ESCOLAR.match(email):
        return jsonify({"erro": f"Use seu e-mail escolar (@{DOMINIO_ESCOLAR})."}), 400

    if len(senha) < 4:
        return jsonify({"erro": "A senha precisa ter pelo menos 4 caracteres."}), 400

    conexao = get_conexao()
    ja_existe = conexao.execute("SELECT id FROM usuarios WHERE email = ?", (email,)).fetchone()
    if ja_existe:
        conexao.close()
        return jsonify({"erro": "Já existe uma conta com esse e-mail."}), 400

    cursor = conexao.execute(
        "INSERT INTO usuarios (nome, email, senha_hash, cargo) VALUES (?, ?, ?, 'aluno')",
        (nome, email, generate_password_hash(senha))
    )
    conexao.commit()
    novo_id = cursor.lastrowid
    conexao.close()

    # Já loga automaticamente a pessoa recém-cadastrada
    session["usuario_id"] = novo_id
    return jsonify({"id": novo_id, "nome": nome, "cargo": "aluno"}), 201


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def api_me():
    usuario = usuario_atual()
    return jsonify(usuario)  # None (-> null) se não estiver logado


# ---------- API: jogos / placar ----------

@app.route("/api/jogos")
def api_listar_jogos():
    conexao = get_conexao()
    jogos = conexao.execute(
        "SELECT * FROM jogos ORDER BY (status = 'ao_vivo') DESC, id DESC"
    ).fetchall()
    conexao.close()
    return jsonify([enriquecer_jogo(j) for j in jogos])


@app.route("/api/modalidades")
def api_modalidades():
    # Lista fixa de modalidades válidas, com o local correspondente de cada uma
    return jsonify([{"nome": nome, "local": local} for nome, local in LOCAIS_POR_MODALIDADE.items()])


@app.route("/api/jogos", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_criar_jogo():
    dados = request.get_json(force=True)
    modalidade = (dados.get("modalidade") or "").strip()
    time_a = (dados.get("time_a") or "").strip()
    time_b = (dados.get("time_b") or "").strip()
    integrantes_a = (dados.get("integrantes_a") or "").strip() or None
    integrantes_b = (dados.get("integrantes_b") or "").strip() or None

    if not modalidade or not time_a or not time_b:
        return jsonify({"erro": "Preencha modalidade e os dois times."}), 400

    if modalidade not in LOCAIS_POR_MODALIDADE:
        return jsonify({"erro": "Modalidade inválida."}), 400

    usuario = usuario_atual()
    local = LOCAIS_POR_MODALIDADE[modalidade]

    # Um marcador só pode criar partidas atribuídas a ele mesmo.
    # O diretor pode escolher outro marcador (opcional, futuramente).
    if usuario["cargo"] == "marcador":
        marcador_id = usuario["id"]
    else:
        marcador_id = dados.get("marcador_id")

    conexao = get_conexao()
    cursor = conexao.execute(
        "INSERT INTO jogos (modalidade, time_a, time_b, status, marcador_id, local, integrantes_a, integrantes_b) "
        "VALUES (?, ?, ?, 'ao_vivo', ?, ?, ?, ?)",
        (modalidade, time_a, time_b, marcador_id, local, integrantes_a, integrantes_b)
    )
    conexao.commit()
    novo_id = cursor.lastrowid
    conexao.close()
    return jsonify({"id": novo_id, "local": local}), 201


@app.route("/api/jogos/<int:jogo_id>/ponto", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_atualizar_ponto(jogo_id):
    dados = request.get_json(force=True)
    time = dados.get("time")         # "a" ou "b"
    delta = dados.get("delta", 1)    # 1 para somar ponto, -1 para corrigir
    fase = dados.get("fase", "normal")  # "normal" ou "penaltis"

    if time not in ("a", "b"):
        return jsonify({"erro": "Time inválido."}), 400
    if fase not in ("normal", "penaltis"):
        return jsonify({"erro": "Fase inválida."}), 400

    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    # Um marcador só pode alterar o jogo que a direção atribuiu a ele
    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    if jogo["status"] == "encerrado":
        conexao.close()
        return jsonify({"erro": "Esta partida já foi encerrada."}), 400

    if jogo["modalidade"] in MODALIDADES_SEM_PLACAR:
        conexao.close()
        return jsonify({"erro": f"{jogo['modalidade']} não usa placar numérico."}), 400

    if fase == "penaltis" and not jogo["em_penaltis"]:
        conexao.close()
        return jsonify({"erro": "Este jogo ainda não foi para os pênaltis."}), 400

    prefixo = "placar" if fase == "normal" else "penaltis"
    coluna = f"{prefixo}_a" if time == "a" else f"{prefixo}_b"
    valor_anterior = jogo[coluna]
    novo_valor = max(0, valor_anterior + delta)
    delta_efetivo = novo_valor - valor_anterior  # pode ser 0 se já estava em 0 e tentou tirar ponto
    conexao.execute(f"UPDATE jogos SET {coluna} = ? WHERE id = ?", (novo_valor, jogo_id))
    # Guarda o que mudou pra dar pra desfazer com um clique (só o último ponto, não um histórico completo)
    conexao.execute(
        "UPDATE jogos SET ultimo_time = ?, ultimo_delta = ? WHERE id = ?",
        (f"{time}:{fase}", delta_efetivo, jogo_id)
    )
    conexao.commit()
    conexao.close()

    return jsonify({"ok": True, "novo_valor": novo_valor, "fase": fase})


@app.route("/api/jogos/<int:jogo_id>/desfazer", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_desfazer_ponto(jogo_id):
    """Reverte a última mudança de placar (ponto normal ou de pênaltis) desse jogo."""
    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    if not jogo["ultimo_time"] or jogo["ultimo_delta"] in (None, 0):
        conexao.close()
        return jsonify({"erro": "Não há nenhum ponto recente pra desfazer."}), 400

    time, fase = jogo["ultimo_time"].split(":")
    prefixo = "placar" if fase == "normal" else "penaltis"
    coluna = f"{prefixo}_a" if time == "a" else f"{prefixo}_b"
    novo_valor = max(0, jogo[coluna] - jogo["ultimo_delta"])

    conexao.execute(
        f"UPDATE jogos SET {coluna} = ?, ultimo_time = NULL, ultimo_delta = NULL WHERE id = ?",
        (novo_valor, jogo_id)
    )
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True, "novo_valor": novo_valor, "fase": fase, "time": time})


@app.route("/api/jogos/<int:jogo_id>/penaltis", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_iniciar_penaltis(jogo_id):
    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    if jogo["modalidade"] not in MODALIDADES_COM_PENALTIS:
        conexao.close()
        return jsonify({"erro": f"{jogo['modalidade']} não vai para os pênaltis."}), 400

    conexao.execute("UPDATE jogos SET em_penaltis = 1 WHERE id = ?", (jogo_id,))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/jogos/<int:jogo_id>/penaltis/cancelar", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_cancelar_penaltis(jogo_id):
    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    # Desativa a fase de pênaltis e zera o placar dela (era engano/misclick)
    conexao.execute(
        "UPDATE jogos SET em_penaltis = 0, penaltis_a = 0, penaltis_b = 0 WHERE id = ?",
        (jogo_id,)
    )
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/jogos/<int:jogo_id>/status", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_atualizar_status(jogo_id):
    dados = request.get_json(force=True)
    status = dados.get("status")
    if status not in ("aguardando", "ao_vivo", "encerrado"):
        return jsonify({"erro": "Status inválido."}), 400

    conexao = get_conexao()
    conexao.execute("UPDATE jogos SET status = ? WHERE id = ?", (status, jogo_id))
    if status == "encerrado":
        avancar_chaveamento(conexao, jogo_id)
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/jogos/<int:jogo_id>/encerrar", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_encerrar_partida(jogo_id):
    """Botão "Encerrar partida": fecha o jogo com o placar que está valendo agora."""
    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    if jogo["status"] == "encerrado":
        conexao.close()
        return jsonify({"erro": "Esta partida já foi encerrada."}), 400

    if jogo["modalidade"] in MODALIDADES_SEM_PLACAR:
        conexao.close()
        return jsonify({"erro": "No Xadrez, encerre escolhendo quem ganhou (ou empate)."}), 400

    # Nos esportes de set, um set em andamento ainda não conta: vale quem tem mais sets
    if jogo["modalidade"] in SETS_PARA_VENCER and jogo["sets_vencidos_a"] == jogo["sets_vencidos_b"]:
        conexao.close()
        return jsonify({"erro": "Os sets estão empatados. Feche o set em andamento antes de encerrar."}), 400

    conexao.execute("UPDATE jogos SET status = 'encerrado' WHERE id = ?", (jogo_id,))
    jogo_novo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    # Mata-mata precisa de um vencedor; empate sem pênaltis não pode encerrar
    if jogo_novo["chaveamento_id"] and determinar_vencedor(jogo_novo) is None:
        conexao.rollback()
        conexao.close()
        return jsonify({"erro": "Mata-mata precisa de vencedor: desempate o placar ou use os pênaltis."}), 400

    avancar_chaveamento(conexao, jogo_id)
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/jogos/<int:jogo_id>/set/fechar", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_fechar_set(jogo_id):
    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    if jogo["modalidade"] not in SETS_PARA_VENCER:
        conexao.close()
        return jsonify({"erro": f"{jogo['modalidade']} não funciona por sets."}), 400

    if jogo["status"] == "encerrado":
        conexao.close()
        return jsonify({"erro": "Esta partida já foi encerrada."}), 400

    cap = pontos_necessarios_set(jogo["modalidade"], jogo["set_atual"])
    placar_a, placar_b = jogo["placar_a"], jogo["placar_b"]
    maior, menor = max(placar_a, placar_b), min(placar_a, placar_b)

    if not (maior >= cap and (maior - menor) >= 2):
        conexao.close()
        return jsonify({
            "erro": f"Ainda não dá pra fechar o set: precisa de {cap} pontos com pelo menos 2 de vantagem."
        }), 400

    vencedor_set = "a" if placar_a > placar_b else "b"

    historico = json.loads(jogo["historico_sets"] or "[]")
    historico.append({"a": placar_a, "b": placar_b})

    sets_vencidos_a = jogo["sets_vencidos_a"] + (1 if vencedor_set == "a" else 0)
    sets_vencidos_b = jogo["sets_vencidos_b"] + (1 if vencedor_set == "b" else 0)
    sets_para_vencer = SETS_PARA_VENCER[jogo["modalidade"]]

    partida_encerrada = sets_vencidos_a >= sets_para_vencer or sets_vencidos_b >= sets_para_vencer
    novo_status = "encerrado" if partida_encerrada else jogo["status"]
    novo_set_atual = jogo["set_atual"] if partida_encerrada else jogo["set_atual"] + 1

    conexao.execute(
        "UPDATE jogos SET placar_a = 0, placar_b = 0, sets_vencidos_a = ?, sets_vencidos_b = ?, "
        "set_atual = ?, historico_sets = ?, status = ? WHERE id = ?",
        (sets_vencidos_a, sets_vencidos_b, novo_set_atual, json.dumps(historico), novo_status, jogo_id)
    )
    if partida_encerrada:
        avancar_chaveamento(conexao, jogo_id)
    conexao.commit()
    conexao.close()

    return jsonify({
        "ok": True,
        "vencedor_set": vencedor_set,
        "partida_encerrada": partida_encerrada,
        "sets_vencidos_a": sets_vencidos_a,
        "sets_vencidos_b": sets_vencidos_b,
    })


@app.route("/api/jogos/<int:jogo_id>/resultado", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_declarar_resultado(jogo_id):
    dados = request.get_json(force=True)
    resultado = dados.get("resultado")  # "vencedor_a", "vencedor_b" ou "empate"

    if resultado not in ("vencedor_a", "vencedor_b", "empate"):
        return jsonify({"erro": "Resultado inválido."}), 400

    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    if jogo["modalidade"] not in MODALIDADES_SEM_PLACAR:
        conexao.close()
        return jsonify({"erro": f"{jogo['modalidade']} não usa esse tipo de resultado."}), 400

    if jogo["status"] == "encerrado":
        conexao.close()
        return jsonify({"erro": "Esta partida já foi encerrada."}), 400

    conexao.execute(
        "UPDATE jogos SET resultado = ?, status = 'encerrado' WHERE id = ?",
        (resultado, jogo_id)
    )
    avancar_chaveamento(conexao, jogo_id)
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True, "resultado": resultado})


@app.route("/api/proximos-confrontos")
def api_proximos_confrontos():
    conexao = get_conexao()
    confrontos = conexao.execute(
        "SELECT * FROM proximos_confrontos ORDER BY ordem ASC"
    ).fetchall()
    lista = [dict(c) for c in confrontos]
    # O placar e o telão pedem também os jogos da programação oficial (?programacao=1)
    if request.args.get("programacao") == "1":
        lista += jogos_programados_do_quadro(conexao)
    conexao.close()
    return jsonify(lista)


DIAS_SEMANA = {"Segunda": 0, "Terça": 1, "Quarta": 2, "Quinta": 3, "Sexta": 4, "Sábado": 5, "Domingo": 6}


def jogos_programados_do_quadro(conexao, limite=10):
    """Próximos jogos dos quadros que já têm horário, com as duas pontas definidas e ainda não iniciados.
    Esconde os que são de um dia da semana que já passou."""
    hoje = datetime.now().weekday()
    linhas = conexao.execute(
        "SELECT * FROM chaveamento WHERE jogo_id IS NULL AND time_a IS NOT NULL AND time_b IS NOT NULL "
        "AND horario IS NOT NULL AND horario <> ''"
    ).fetchall()

    itens = []
    for l in linhas:
        dia_idx = DIAS_SEMANA.get(l["dia"], 99)
        if dia_idx < hoje:
            continue
        individual = l["modalidade"] in MODALIDADES_COM_JOGADORES

        def lado(sala, integrantes):
            return f"{integrantes} ({sala})" if individual and integrantes else sala

        itens.append((dia_idx, l["horario"], l["numero_jogo"] or 0, {
            "id": None,
            "modalidade": l["modalidade"],
            "sala_a": lado(l["time_a"], l["integrantes_a"]),
            "sala_b": lado(l["time_b"], l["integrantes_b"]),
            "horario": f"{l['dia']} {l['horario']}" if l["dia"] else l["horario"],
            "programacao": True,
        }))

    itens.sort(key=lambda x: x[:3])
    return [x[3] for x in itens[:limite]]


@app.route("/api/proximos-confrontos", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_criar_confronto():
    dados = request.get_json(force=True)
    modalidade = (dados.get("modalidade") or "").strip()
    sala_a = (dados.get("sala_a") or "").strip()
    sala_b = (dados.get("sala_b") or "").strip()
    horario = (dados.get("horario") or "").strip() or None

    if not modalidade or not sala_a or not sala_b:
        return jsonify({"erro": "Preencha modalidade e os dois lados do confronto."}), 400

    conexao = get_conexao()
    maior_ordem = conexao.execute("SELECT COALESCE(MAX(ordem), 0) FROM proximos_confrontos").fetchone()[0]
    cursor = conexao.execute(
        "INSERT INTO proximos_confrontos (modalidade, sala_a, sala_b, ordem, horario) VALUES (?, ?, ?, ?, ?)",
        (modalidade, sala_a, sala_b, maior_ordem + 1, horario)
    )
    conexao.commit()
    novo_id = cursor.lastrowid
    conexao.close()
    return jsonify({"id": novo_id}), 201


@app.route("/api/proximos-confrontos/<int:confronto_id>", methods=["PUT"])
@requer_cargo("marcador", "diretor")
def api_editar_confronto(confronto_id):
    dados = request.get_json(force=True)
    modalidade = (dados.get("modalidade") or "").strip()
    sala_a = (dados.get("sala_a") or "").strip()
    sala_b = (dados.get("sala_b") or "").strip()
    horario = (dados.get("horario") or "").strip() or None

    if not modalidade or not sala_a or not sala_b:
        return jsonify({"erro": "Preencha modalidade e os dois lados do confronto."}), 400

    conexao = get_conexao()
    existe = conexao.execute("SELECT id FROM proximos_confrontos WHERE id = ?", (confronto_id,)).fetchone()
    if not existe:
        conexao.close()
        return jsonify({"erro": "Confronto não encontrado."}), 404

    conexao.execute(
        "UPDATE proximos_confrontos SET modalidade = ?, sala_a = ?, sala_b = ?, horario = ? WHERE id = ?",
        (modalidade, sala_a, sala_b, horario, confronto_id)
    )
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/proximos-confrontos/<int:confronto_id>", methods=["DELETE"])
@requer_cargo("marcador", "diretor")
def api_excluir_confronto(confronto_id):
    conexao = get_conexao()
    existe = conexao.execute("SELECT id FROM proximos_confrontos WHERE id = ?", (confronto_id,)).fetchone()
    if not existe:
        conexao.close()
        return jsonify({"erro": "Confronto não encontrado."}), 404

    conexao.execute("DELETE FROM proximos_confrontos WHERE id = ?", (confronto_id,))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


REGEX_HORARIO = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


@app.route("/api/proximos-confrontos/lote", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_criar_confrontos_em_lote():
    """Cria vários confrontos de uma vez (usado pelo sorteio de rodada).
    Ou entram todos, ou nenhum: se algum item for inválido, nada é salvo."""
    dados = request.get_json(force=True)
    itens = dados.get("confrontos")

    if not isinstance(itens, list) or not itens:
        return jsonify({"erro": "Envie pelo menos um confronto."}), 400
    if len(itens) > 100:
        return jsonify({"erro": "Máximo de 100 confrontos por vez."}), 400

    validos = []
    for item in itens:
        if not isinstance(item, dict):
            return jsonify({"erro": "Confronto inválido."}), 400
        modalidade = (item.get("modalidade") or "").strip()
        sala_a = (item.get("sala_a") or "").strip()
        sala_b = (item.get("sala_b") or "").strip()
        horario = (item.get("horario") or "").strip() or None

        if not modalidade or not sala_a or not sala_b:
            return jsonify({"erro": "Cada confronto precisa de modalidade e dos dois lados."}), 400
        if horario and not REGEX_HORARIO.match(horario):
            return jsonify({"erro": "Horário inválido (use o formato HH:MM)."}), 400
        validos.append((modalidade, sala_a, sala_b, horario))

    conexao = get_conexao()
    maior_ordem = conexao.execute("SELECT COALESCE(MAX(ordem), 0) FROM proximos_confrontos").fetchone()[0]
    ids = []
    for posicao, (modalidade, sala_a, sala_b, horario) in enumerate(validos, start=1):
        cursor = conexao.execute(
            "INSERT INTO proximos_confrontos (modalidade, sala_a, sala_b, ordem, horario) VALUES (?, ?, ?, ?, ?)",
            (modalidade, sala_a, sala_b, maior_ordem + posicao, horario)
        )
        ids.append(cursor.lastrowid)
    conexao.commit()
    conexao.close()
    return jsonify({"adicionados": len(ids), "ids": ids}), 201


# ---------- Turmas participantes (lista usada nos sorteios) ----------

def limpar_nome_turma(nome):
    """Tira espaços sobrando e limita o tamanho. Ex: '  1º   A ' -> '1º A'."""
    return " ".join(str(nome).split())[:30]


# Nomes de turma: letras (com acento), números, espaço e alguns símbolos comuns (º ª - . / parênteses)
REGEX_NOME_TURMA = re.compile(r"^[\w .\-/()ºª°]+$")


def chave_turma(nome):
    """'1º A', '1ºa' e '1º  A' contam como a mesma turma."""
    return re.sub(r"\s+", "", nome).lower()


@app.route("/api/turmas")
@requer_cargo("marcador", "diretor")
def api_listar_turmas():
    conexao = get_conexao()
    turmas = conexao.execute("SELECT id, nome FROM turmas ORDER BY id").fetchall()
    conexao.close()
    return jsonify([dict(t) for t in turmas])


@app.route("/api/turmas", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_adicionar_turmas():
    dados = request.get_json(force=True)
    # Aceita {"nomes": ["1º A", "1º B"]} ou {"nome": "1º A"}
    nomes = dados.get("nomes")
    if nomes is None:
        nomes = [dados.get("nome") or ""]
    if not isinstance(nomes, list):
        return jsonify({"erro": "Formato inválido."}), 400

    nomes_limpos = [limpar_nome_turma(n) for n in nomes if isinstance(n, str)]
    nomes_limpos = [n for n in nomes_limpos if n]
    if not nomes_limpos:
        return jsonify({"erro": "Digite o nome de pelo menos uma turma."}), 400
    if len(nomes_limpos) > 100:
        return jsonify({"erro": "Máximo de 100 turmas por vez."}), 400

    invalidos = [n for n in nomes_limpos if not REGEX_NOME_TURMA.match(n)]
    if invalidos:
        return jsonify({
            "erro": f"Nome inválido: {invalidos[0]}. Use só letras, números, espaço e os símbolos º ª - . / ( )"
        }), 400

    conexao = get_conexao()
    ja_cadastradas = {chave_turma(l["nome"]) for l in conexao.execute("SELECT nome FROM turmas").fetchall()}

    adicionadas, ignoradas = [], []
    for nome in nomes_limpos:
        chave = chave_turma(nome)
        if chave in ja_cadastradas:
            ignoradas.append(nome)
            continue
        conexao.execute("INSERT INTO turmas (nome) VALUES (?)", (nome,))
        ja_cadastradas.add(chave)  # também evita repetir dentro da mesma lista enviada
        adicionadas.append(nome)
    conexao.commit()
    conexao.close()

    if not adicionadas:
        return jsonify({"erro": "Essas turmas já estão cadastradas.", "ignoradas": ignoradas}), 400
    return jsonify({"adicionadas": adicionadas, "ignoradas": ignoradas}), 201


@app.route("/api/turmas/<int:turma_id>", methods=["DELETE"])
@requer_cargo("marcador", "diretor")
def api_excluir_turma(turma_id):
    conexao = get_conexao()
    existe = conexao.execute("SELECT id FROM turmas WHERE id = ?", (turma_id,)).fetchone()
    if not existe:
        conexao.close()
        return jsonify({"erro": "Turma não encontrada."}), 404

    nome = conexao.execute("SELECT nome FROM turmas WHERE id = ?", (turma_id,)).fetchone()["nome"]
    no_quadro = conexao.execute(
        "SELECT c.modalidade FROM chaveamento c WHERE ("
        " (c.time_a = ? AND NOT EXISTS (SELECT 1 FROM chaveamento f WHERE f.proximo_chave_id = c.id AND f.proximo_slot = 'a')) OR"
        " (c.time_b = ? AND NOT EXISTS (SELECT 1 FROM chaveamento f WHERE f.proximo_chave_id = c.id AND f.proximo_slot = 'b')))",
        (nome, nome)
    ).fetchone()
    if no_quadro:
        conexao.close()
        return jsonify({"erro": f"{nome} está no quadro de {no_quadro['modalidade']}. Tire a sala do quadro antes de excluir."}), 400

    conexao.execute("DELETE FROM turmas WHERE id = ?", (turma_id,))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/classificacao")
def api_classificacao():
    """Classificação por turma: soma pontos (vitória/empate/derrota) de todas
    as partidas já encerradas, juntando todas as modalidades, e também separado
    por modalidade. Não precisa cadastrar nada novo: é tudo calculado na hora."""
    conexao = get_conexao()
    jogos_encerrados = conexao.execute("SELECT * FROM jogos WHERE status = 'encerrado'").fetchall()
    conexao.close()

    def turma_vazia():
        return {"pontos": 0, "vitorias": 0, "empates": 0, "derrotas": 0, "jogos": 0}

    geral = {}
    por_modalidade = {}

    for jogo in jogos_encerrados:
        vencedor_lado = determinar_vencedor(jogo)
        modalidade = jogo["modalidade"]
        por_modalidade.setdefault(modalidade, {})

        for turma, resultado_turma in (
            (jogo["time_a"], "vitoria" if vencedor_lado == "a" else ("empate" if vencedor_lado is None else "derrota")),
            (jogo["time_b"], "vitoria" if vencedor_lado == "b" else ("empate" if vencedor_lado is None else "derrota")),
        ):
            for tabela in (geral.setdefault(turma, turma_vazia()), por_modalidade[modalidade].setdefault(turma, turma_vazia())):
                tabela["jogos"] += 1
                if resultado_turma == "vitoria":
                    tabela["vitorias"] += 1
                    tabela["pontos"] += PONTOS_VITORIA
                elif resultado_turma == "empate":
                    tabela["empates"] += 1
                    tabela["pontos"] += PONTOS_EMPATE
                else:
                    tabela["derrotas"] += 1
                    tabela["pontos"] += PONTOS_DERROTA

    def ordenar(tabela_dict):
        linhas = [{"turma": turma, **dados} for turma, dados in tabela_dict.items()]
        linhas.sort(key=lambda l: (-l["pontos"], -l["vitorias"], l["turma"]))
        return linhas

    return jsonify({
        "geral": ordenar(geral),
        "por_modalidade": {mod: ordenar(tabela) for mod, tabela in por_modalidade.items()},
    })


# ---------- API: chaveamento de mata-mata ----------

@app.route("/api/chaveamento/<modalidade>")
def api_ver_chaveamento(modalidade):
    conexao = get_conexao()
    linhas = conexao.execute(
        f"SELECT * FROM chaveamento WHERE modalidade = ? ORDER BY {ORDEM_SQL_FASES}, posicao",
        (modalidade,)
    ).fetchall()
    resultado = []
    for linha in linhas:
        item = dict(linha)
        if linha["jogo_id"]:
            jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (linha["jogo_id"],)).fetchone()
            item["jogo"] = enriquecer_jogo(jogo) if jogo else None
        else:
            item["jogo"] = None
        resultado.append(item)
    conexao.close()
    return jsonify(resultado)


@app.route("/api/chaveamento/<modalidade>/criar", methods=["POST"])
@requer_cargo("marcador")
def api_criar_chaveamento(modalidade):
    """Cria o quadro vazio (2, 4, 8 ou 16 vagas). Só o marcador mexe na programação."""
    if modalidade not in LOCAIS_POR_MODALIDADE:
        return jsonify({"erro": "Modalidade inválida."}), 400

    dados = request.get_json(force=True)
    try:
        tamanho = int(dados.get("tamanho"))
    except (TypeError, ValueError):
        return jsonify({"erro": "Escolha 2, 4, 8 ou 16 salas."}), 400
    if tamanho not in FASES_POR_QUANTIDADE:
        return jsonify({"erro": "Escolha 2, 4, 8 ou 16 salas."}), 400

    conexao = get_conexao()
    ja_existe = conexao.execute("SELECT 1 FROM chaveamento WHERE modalidade = ?", (modalidade,)).fetchone()
    if ja_existe:
        conexao.close()
        return jsonify({"erro": "Já existe um quadro nesta modalidade. Limpe o quadro antes de criar outro."}), 400

    criar_chaveamento_vazio(conexao, modalidade, tamanho)
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True}), 201


@app.route("/api/chaveamento/<int:chave_id>/sala", methods=["POST"])
@requer_cargo("marcador")
def api_colocar_sala_chaveamento(chave_id):
    """Coloca uma sala numa vaga livre da 1ª fase do quadro."""
    dados = request.get_json(force=True)
    lado = dados.get("lado")
    sala = str(dados.get("sala", "")).strip()
    integrantes = " ".join(str(dados.get("integrantes", "")).split())
    if lado not in ("a", "b"):
        return jsonify({"erro": "Lado inválido."}), 400
    if len(integrantes) > 200:
        return jsonify({"erro": "Lista de jogadores muito longa (máximo 200 caracteres)."}), 400

    conexao = get_conexao()
    linha = linha_da_vaga(conexao, chave_id, lado)
    if not linha:
        conexao.close()
        return jsonify({"erro": "Essa vaga é preenchida pelo vencedor de outra partida."}), 400
    if linha["jogo_id"]:
        conexao.close()
        return jsonify({"erro": "Essa partida já foi iniciada."}), 400
    if linha[f"time_{lado}"]:
        conexao.close()
        return jsonify({"erro": "Essa vaga já tem uma sala. Tire a sala antes de trocar."}), 400

    # A sala precisa estar na lista de turmas participantes (usa o nome exatamente como cadastrado)
    turma = next((l for l in conexao.execute("SELECT nome FROM turmas").fetchall()
                  if chave_turma(l["nome"]) == chave_turma(sala)), None)
    if not turma:
        conexao.close()
        return jsonify({"erro": "Essa sala não está na lista. Use 'Adicionar salas' primeiro."}), 400

    # Uma sala não pode ocupar duas vagas do mesmo quadro (exceto nos esportes individuais,
    # onde várias pessoas da mesma sala jogam, cada uma na sua vaga)
    if linha["modalidade"] not in MODALIDADES_COM_JOGADORES:
        repetida = conexao.execute(
            "SELECT 1 FROM chaveamento c WHERE c.modalidade = ? AND ("
            " (c.time_a = ? AND NOT EXISTS (SELECT 1 FROM chaveamento f WHERE f.proximo_chave_id = c.id AND f.proximo_slot = 'a')) OR"
            " (c.time_b = ? AND NOT EXISTS (SELECT 1 FROM chaveamento f WHERE f.proximo_chave_id = c.id AND f.proximo_slot = 'b')))",
            (linha["modalidade"], turma["nome"], turma["nome"])
        ).fetchone()
        if repetida:
            conexao.close()
            return jsonify({"erro": f"{turma['nome']} já está no quadro desta modalidade."}), 400

    # Só Xadrez e Tênis de Mesa guardam os jogadores de cada sala; nos outros esportes joga a sala inteira
    if linha["modalidade"] not in MODALIDADES_COM_JOGADORES:
        integrantes = ""

    conexao.execute(
        f"UPDATE chaveamento SET time_{lado} = ?, integrantes_{lado} = ? WHERE id = ?",
        (turma["nome"], integrantes or None, chave_id)
    )
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/chaveamento/<int:chave_id>/sala/<lado>", methods=["DELETE"])
@requer_cargo("marcador")
def api_tirar_sala_chaveamento(chave_id, lado):
    """Tira uma sala de uma vaga da 1ª fase (útil para corrigir engano)."""
    if lado not in ("a", "b"):
        return jsonify({"erro": "Lado inválido."}), 400

    conexao = get_conexao()
    linha = linha_da_vaga(conexao, chave_id, lado)
    if not linha:
        conexao.close()
        return jsonify({"erro": "Essa vaga é preenchida pelo vencedor de outra partida."}), 400
    if linha["jogo_id"]:
        conexao.close()
        return jsonify({"erro": "Essa partida já foi iniciada."}), 400

    conexao.execute(f"UPDATE chaveamento SET time_{lado} = NULL, integrantes_{lado} = NULL WHERE id = ?", (chave_id,))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/chaveamento/<int:chave_id>/iniciar", methods=["POST"])
@requer_cargo("marcador", "diretor")
def api_iniciar_partida_chaveamento(chave_id):
    usuario = usuario_atual()
    conexao = get_conexao()
    linha = conexao.execute("SELECT * FROM chaveamento WHERE id = ?", (chave_id,)).fetchone()

    if not linha:
        conexao.close()
        return jsonify({"erro": "Confronto do chaveamento não encontrado."}), 404
    if not linha["time_a"] or not linha["time_b"]:
        conexao.close()
        return jsonify({"erro": "Os dois times dessa fase ainda não foram definidos."}), 400
    if linha["jogo_id"]:
        conexao.close()
        return jsonify({"erro": "Essa partida já foi iniciada."}), 400
    if linha["modalidade"] not in LOCAIS_POR_MODALIDADE:
        conexao.close()
        return jsonify({"erro": "Modalidade inválida."}), 400

    marcador_id = usuario["id"] if usuario["cargo"] == "marcador" else None
    local = LOCAIS_POR_MODALIDADE[linha["modalidade"]]

    cursor = conexao.execute(
        "INSERT INTO jogos (modalidade, time_a, time_b, status, marcador_id, local, fase, chaveamento_id, "
        "integrantes_a, integrantes_b) VALUES (?, ?, ?, 'ao_vivo', ?, ?, ?, ?, ?, ?)",
        (linha["modalidade"], linha["time_a"], linha["time_b"], marcador_id, local, linha["fase"], chave_id,
         linha["integrantes_a"], linha["integrantes_b"])
    )
    novo_jogo_id = cursor.lastrowid
    conexao.execute("UPDATE chaveamento SET jogo_id = ? WHERE id = ?", (novo_jogo_id, chave_id))
    conexao.commit()
    conexao.close()
    return jsonify({"id": novo_jogo_id}), 201


@app.route("/api/chaveamento/<modalidade>", methods=["DELETE"])
@requer_cargo("marcador")
def api_excluir_chaveamento(modalidade):
    conexao = get_conexao()
    conexao.execute("DELETE FROM chaveamento WHERE modalidade = ?", (modalidade,))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


# ---------- API: gerenciar usuários (só o diretor) ----------

@app.route("/api/usuarios")
@requer_cargo("diretor")
def api_listar_usuarios():
    conexao = get_conexao()
    usuarios = conexao.execute(
        "SELECT id, nome, email, cargo FROM usuarios ORDER BY (cargo = 'diretor') DESC, nome"
    ).fetchall()
    conexao.close()
    return jsonify([dict(u) for u in usuarios])


@app.route("/api/usuarios/<int:usuario_id>/cargo", methods=["POST"])
@requer_cargo("diretor")
def api_alterar_cargo(usuario_id):
    dados = request.get_json(force=True)
    novo_cargo = dados.get("cargo")
    if novo_cargo not in ("aluno", "marcador"):
        return jsonify({"erro": "Só é possível promover para marcador ou rebaixar para aluno por aqui."}), 400

    conexao = get_conexao()
    usuario = conexao.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    if not usuario:
        conexao.close()
        return jsonify({"erro": "Usuário não encontrado."}), 404
    if usuario["cargo"] == "diretor":
        conexao.close()
        return jsonify({"erro": "Não é possível alterar o cargo de um diretor por aqui."}), 400

    conexao.execute("UPDATE usuarios SET cargo = ? WHERE id = ?", (novo_cargo, usuario_id))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True, "cargo": novo_cargo})


@app.route("/api/jogos/<int:jogo_id>", methods=["DELETE"])
@requer_cargo("marcador", "diretor")
def api_excluir_jogo(jogo_id):
    usuario = usuario_atual()
    conexao = get_conexao()
    jogo = conexao.execute("SELECT * FROM jogos WHERE id = ?", (jogo_id,)).fetchone()

    if not jogo:
        conexao.close()
        return jsonify({"erro": "Jogo não encontrado."}), 404

    # Um marcador só pode excluir o jogo que a direção atribuiu a ele
    if usuario["cargo"] == "marcador" and jogo["marcador_id"] != usuario["id"]:
        conexao.close()
        return jsonify({"erro": "Você não é o marcador deste jogo."}), 403

    conexao.execute("DELETE FROM jogos WHERE id = ?", (jogo_id,))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


# ---------- API: notícias escolares ----------

CATEGORIAS_NOTICIA = ("interclasse", "escola")


def pode_publicar(usuario, categoria):
    """Interclasse: marcador e diretor publicam. Escola (professores, lanche, avisos): só o diretor."""
    if not usuario:
        return False
    if categoria == "interclasse":
        return usuario["cargo"] in ("marcador", "diretor")
    return usuario["cargo"] == "diretor"


@app.route("/api/noticias")
def api_listar_noticias():
    categoria = request.args.get("categoria", "interclasse")
    if categoria not in CATEGORIAS_NOTICIA:
        return jsonify({"erro": "Categoria inválida."}), 400
    conexao = get_conexao()
    linhas = conexao.execute(
        "SELECT * FROM noticias WHERE categoria = ? ORDER BY id DESC LIMIT 60", (categoria,)
    ).fetchall()
    conexao.close()
    return jsonify([dict(l) for l in linhas])


@app.route("/api/noticias", methods=["POST"])
def api_criar_noticia():
    usuario = usuario_atual()
    if not usuario:
        return jsonify({"erro": "Não autenticado."}), 401

    dados = request.get_json(force=True)
    categoria = dados.get("categoria")
    titulo = " ".join(str(dados.get("titulo", "")).split())
    texto = str(dados.get("texto", "")).strip()

    if categoria not in CATEGORIAS_NOTICIA:
        return jsonify({"erro": "Categoria inválida."}), 400
    if not pode_publicar(usuario, categoria):
        return jsonify({"erro": "Sem permissão para publicar nesta aba."}), 403
    if not titulo:
        return jsonify({"erro": "Escreva o título da notícia."}), 400
    if len(titulo) > 160:
        return jsonify({"erro": "Título muito longo (máximo 160 caracteres)."}), 400
    if len(texto) > 600:
        return jsonify({"erro": "Texto muito longo (máximo 600 caracteres)."}), 400

    conexao = get_conexao()
    conexao.execute(
        "INSERT INTO noticias (categoria, titulo, texto, autor_id, autor_nome) VALUES (?, ?, ?, ?, ?)",
        (categoria, titulo, texto or None, usuario["id"], usuario["nome"])
    )
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True}), 201


@app.route("/api/noticias/<int:noticia_id>", methods=["PUT"])
def api_editar_noticia(noticia_id):
    usuario = usuario_atual()
    if not usuario:
        return jsonify({"erro": "Não autenticado."}), 401

    dados = request.get_json(force=True)
    titulo = " ".join(str(dados.get("titulo", "")).split())
    texto = str(dados.get("texto", "")).strip()

    conexao = get_conexao()
    noticia = conexao.execute("SELECT * FROM noticias WHERE id = ?", (noticia_id,)).fetchone()
    if not noticia:
        conexao.close()
        return jsonify({"erro": "Notícia não encontrada."}), 404

    # A categoria da notícia não muda: só quem pode publicar nela pode editar
    if not pode_publicar(usuario, noticia["categoria"]):
        conexao.close()
        return jsonify({"erro": "Sem permissão para editar esta notícia."}), 403
    if not titulo:
        conexao.close()
        return jsonify({"erro": "Escreva o título da notícia."}), 400
    if len(titulo) > 160:
        conexao.close()
        return jsonify({"erro": "Título muito longo (máximo 160 caracteres)."}), 400
    if len(texto) > 600:
        conexao.close()
        return jsonify({"erro": "Texto muito longo (máximo 600 caracteres)."}), 400

    conexao.execute("UPDATE noticias SET titulo = ?, texto = ? WHERE id = ?", (titulo, texto or None, noticia_id))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


@app.route("/api/noticias/<int:noticia_id>", methods=["DELETE"])
def api_excluir_noticia(noticia_id):
    usuario = usuario_atual()
    if not usuario:
        return jsonify({"erro": "Não autenticado."}), 401

    conexao = get_conexao()
    noticia = conexao.execute("SELECT * FROM noticias WHERE id = ?", (noticia_id,)).fetchone()
    if not noticia:
        conexao.close()
        return jsonify({"erro": "Notícia não encontrada."}), 404

    # Mesma regra de publicar: Escola só o diretor; Interclasse marcador e diretor
    if not pode_publicar(usuario, noticia["categoria"]):
        conexao.close()
        return jsonify({"erro": "Sem permissão para apagar esta notícia."}), 403

    conexao.execute("DELETE FROM noticias WHERE id = ?", (noticia_id,))
    conexao.commit()
    conexao.close()
    return jsonify({"ok": True})


if __name__ == "__main__":
    # host="0.0.0.0" permite que outros PCs/celulares na mesma rede acessem pelo seu IP local
    app.run(debug=True, host="0.0.0.0", port=5000)
