"""
Carrega no site a PROGRAMAÇÃO INTERSÉRIES 2026 (documento enviado pela escola).

Como usar (na pasta do projeto, onde está o interclasse.db):

    python importar_programacao.py

O que ele faz:
  1. Cadastra todas as salas que aparecem na programação (as que já existem são ignoradas).
  2. Monta os quadros (chaveamentos) de Futebol, Vôlei, Tênis de Mesa Feminino e Tênis de Mesa
     Masculino, com as salas, os atletas, o número do jogo, o dia e o horário de cada partida.
  3. Cadastra os 2 jogos do Futebol Feminino (2º FDI x Misto) em "Na sequência".

É seguro rodar de novo: ele refaz os quadros. Se algum jogo do quadro já tiver sido iniciado,
ele avisa e NÃO mexe naquela modalidade (use  --forcar  para apagar mesmo assim).

Nos quadros, "V7" significa "vencedor do Jogo 7": o vencedor avança sozinho quando a partida é encerrada.
"""

import sys

from database import get_conexao, inicializar_banco

# ---------------------------------------------------------------------------
# Dados da programação
# ---------------------------------------------------------------------------
# Cada jogo:  numero: (fase, lado A, lado B, dia, horário, observação)
# Nos esportes de equipe, o lado é o nome da sala.  Nos individuais (tênis de mesa),
# o lado é  (sala, atleta).  "V12" = vencedor do jogo 12.

FUTEBOL = {  # Futsal masculino: 16 salas, quarta e sexta
    1: ("oitavas", "2º B", "Professores", "Quarta", "09:30-09:40", None),
    2: ("oitavas", "2º DS A", "1º Eletro A", "Quarta", "09:45-09:55", None),
    3: ("oitavas", "3º A", "1º DS A", "Quarta", "10:00-10:10", None),
    4: ("oitavas", "1º Eletro B", "3º DS", "Quarta", "10:15-10:25", None),
    5: ("oitavas", "2º DS B", "2º A", "Quarta", "10:30-10:40", None),
    6: ("oitavas", "3º B", "2º C", "Quarta", "10:45-10:55", None),
    7: ("oitavas", "1º B", "2º Eletro", "Quarta", "11:00-11:10", None),
    8: ("oitavas", "1º DS B", "1º A", "Quarta", "11:15-11:25", None),
    9: ("quartas", "V1", "V2", "Quarta", "11:30-11:40", None),
    10: ("quartas", "V3", "V4", "Sexta", "07:30-07:40", None),
    11: ("quartas", "V5", "V6", "Sexta", "07:45-07:55", None),
    12: ("quartas", "V7", "V8", "Sexta", "08:00-08:10", None),
    13: ("semifinal", "V9", "V10", "Sexta", "08:30-08:40", None),
    14: ("semifinal", "V11", "V12", "Sexta", "08:45-08:55", None),
    15: ("final", "V13", "V14", "Sexta", "09:30-09:50", None),
}

VOLEI = {  # Voleibol: 16 salas, quinta e sexta (a partir do Jogo 9 os horários ainda não saíram)
    7: ("oitavas", "Professores", "1º Eletro", "Quinta", "09:30-09:50", None),
    1: ("oitavas", "2º C", "3º A", "Quinta", "09:50-10:10", None),
    2: ("oitavas", "2º Eletro", "3º FDI A", "Quinta", "10:10-10:30", None),
    3: ("oitavas", "3º DS", "1º FDI", "Quinta", "10:30-10:50", None),
    4: ("oitavas", "3º B", "1º DS", "Quinta", "10:50-11:10", None),
    5: ("oitavas", "2º DS A", "1º B", "Quinta", "11:10-11:30", None),
    6: ("oitavas", "2º FDI", "2º A", "Quinta", "11:30-11:50", None),
    8: ("oitavas", "2º B", "3º FDI B", "Sexta", "09:55-10:15", None),
    9: ("quartas", "V1", "V2", "Sexta", None, None),
    10: ("quartas", "V3", "V4", "Sexta", None, None),
    11: ("quartas", "V5", "V6", "Sexta", None, None),
    12: ("quartas", "V7", "V8", "Sexta", None, None),
    13: ("semifinal", "V9", "V10", "Sexta", None, None),
    14: ("semifinal", "V11", "V12", "Sexta", None, None),
    15: ("final", "V13", "V14", "Sexta", None, None),
}

TENIS_FEMININO = {  # Mesa 1, quinta, começa 09:30 (12 atletas: 4 entram direto nas quartas)
    1: ("oitavas", ("1º FDI", "Maiumy"), ("3º FDI", "Maria Luiza"), "Quinta", "09:30", "Mesa 1"),
    2: ("oitavas", ("2º FDI", "Izabela R."), ("Secretaria", "Simone"), "Quinta", None, "Mesa 1"),
    3: ("oitavas", ("1º A", "Kauane"), ("3º FDI", "Milena Kosera"), "Quinta", None, "Mesa 1"),
    4: ("oitavas", ("3º B", "Ísis"), ("3º FDI", "Loriany M."), "Quinta", None, "Mesa 1"),
    5: ("quartas", ("1º FDI", "Ana Paula"), "V1", "Quinta", None, "Mesa 1"),
    6: ("quartas", ("2º FDI", "Giovana V."), "V2", "Quinta", None, "Mesa 1"),
    7: ("quartas", ("2º FDI", "Angelina"), "V3", "Quinta", None, "Mesa 1"),
    8: ("quartas", ("3º FDI", "Bruna"), "V4", "Quinta", None, "Mesa 1"),
    9: ("semifinal", "V5", "V6", "Quinta", None, "Mesa 1"),
    10: ("semifinal", "V7", "V8", "Quinta", None, "Mesa 1"),
    11: ("final", "V9", "V10", "Quinta", None, "Mesa 1"),
}

SEM_TURMA = "2º (turma a confirmar)"  # no documento, o Wendel está sem a turma preenchida

TENIS_MASCULINO = {  # Mesas 2, 3 e 4, quinta, começam 09:30 (38 atletas)
    1: ("rodada1", ("1º A", "André Silva"), ("1º Eletro", "Felipe Costa"), "Quinta", "09:30", "Mesa 2"),
    2: ("rodada1", ("2º Eletro", "Victor Rocha"), ("1º Eletro", "José Miotto"), "Quinta", "09:30", "Mesa 3"),
    3: ("rodada1", ("2º A", "João Vitor"), ("1º Eletro", "Carlos"), "Quinta", "09:30", "Mesa 4"),
    4: ("rodada1", ("2º DS A", "Davi Martins"), ("2º C", "Leonardo Guilherme"), "Quinta", None, "Mesa 2"),
    5: ("rodada1", (SEM_TURMA, "Wendel"), ("1º Eletro", "Kauan Menezes"), "Quinta", None, "Mesa 3"),
    6: ("rodada1", ("3º Eletro", "Eduardo Luís"), ("1º Eletro", "Gabriel Nowack"), "Quinta", None, "Mesa 4"),
    7: ("rodada2", ("2º DS A", "Guilherme Renan"), "V1", "Quinta", None, "Mesa 2"),
    8: ("rodada1", ("3º DS", "João Bendoski"), ("2º C", "Iury Gustavo"), "Quinta", None, "Mesa 3"),
    9: ("rodada1", ("1º Eletro", "João Vitor"), ("2º DS A", "Andrei Bozza"), "Quinta", None, "Mesa 4"),
    10: ("rodada1", ("3º DS", "Henrique Gabriel"), ("2º DS A", "Rhuan Kaike"), "Quinta", None, "Mesa 2"),
    11: ("rodada1", ("3º DS", "Matheus Beraldo"), ("3º Eletro", "Leandro Chiqueto"), "Quinta", None, "Mesa 3"),
    12: ("rodada2", ("3º A", "Rafael Cardoso"), "V2", "Quinta", None, "Mesa 4"),
    13: ("rodada2", ("2º Eletro", "Guilherme Rezende"), "V3", "Quinta", None, "Mesa 2"),
    14: ("rodada1", ("3º A", "Matheus Henrique"), ("2º DS A", "Gustavo Henrique"), "Quinta", None, "Mesa 3"),
    15: ("rodada1", ("3º A", "Guilherme Borges"), ("1º A", "Rubens F. R."), "Quinta", None, "Mesa 4"),
    16: ("rodada2", ("2º Eletro", "Leandro Filho"), "V4", "Quinta", None, "Mesa 2"),
    17: ("rodada2", ("2º DS A", "Jonatan Gabriel"), "V5", "Quinta", None, "Mesa 3"),
    18: ("rodada1", ("3º A", "Hyago Gabriel"), ("2º C", "Luís Felipe"), "Quinta", None, "Mesa 4"),
    19: ("rodada1", ("2º DS A", "João Gustavo"), ("2º Eletro", "Lucas Cadmiel"), "Quinta", None, "Mesa 2"),
    20: ("rodada1", ("2º A", "André dos Santos"), ("3º DS", "Gabriel Maidel"), "Quinta", None, "Mesa 3"),
    21: ("rodada1", ("2º DS A", "Alex Gabriel"), ("1º Eletro", "Gabriel Stopassoli"), "Quinta", None, "Mesa 4"),
    22: ("rodada2", ("3º DS", "Yago Santos"), "V6", "Quinta", None, "Mesa 2"),
    23: ("oitavas", "V7", "V8", "Quinta", None, "Mesa 3"),
    24: ("oitavas", "V9", "V10", "Quinta", None, "Mesa 4"),
    25: ("oitavas", "V11", "V12", "Quinta", None, "Mesa 2"),
    26: ("oitavas", "V13", "V14", "Quinta", None, "Mesa 3"),
    27: ("oitavas", "V15", "V16", "Quinta", None, "Mesa 4"),
    28: ("oitavas", "V17", "V18", "Quinta", None, "Mesa 2"),
    29: ("oitavas", "V19", "V20", "Quinta", None, "Mesa 3"),
    30: ("oitavas", "V21", "V22", "Quinta", None, "Mesa 4"),
    31: ("quartas", "V23", "V24", "Quinta", None, "Mesa 2"),
    32: ("quartas", "V25", "V26", "Quinta", None, "Mesa 3"),
    33: ("quartas", "V27", "V28", "Quinta", None, "Mesa 4"),
    34: ("quartas", "V29", "V30", "Quinta", None, "Mesa 2"),
    35: ("semifinal", "V31", "V32", "Quinta", None, "Mesa 3"),
    36: ("semifinal", "V33", "V34", "Quinta", None, "Mesa 4"),
    37: ("final", "V35", "V36", "Quinta", None, "Mesa 2"),
}

QUADROS = {
    "Futebol": FUTEBOL,
    "Vôlei": VOLEI,
    "Tênis de Mesa Feminino": TENIS_FEMININO,
    "Tênis de Mesa Masculino": TENIS_MASCULINO,
}

# Futebol feminino: dois jogos entre 2º FDI e Misto, na sexta
FUTEBOL_FEMININO = [
    ("Futebol Feminino (Sexta)", "2º FDI", "Misto", "08:15"),
    ("Futebol Feminino (Sexta)", "Misto", "2º FDI", "09:00"),
]


# Os 5 confrontos de exemplo que o site cria sozinho na primeira execução (não são da programação real).
# O importador apaga só estes, se ainda estiverem lá, para não aparecerem misturados com os jogos de verdade.
EXEMPLOS_DO_SITE = [
    ("Vôlei", "1º A", "2º FDI", "09:00"),
    ("Futebol", "3º B", "1º Eletro", "10:00"),
    ("Xadrez", "2º C", "3º DS", "10:30"),
    ("Tênis de Mesa", "1º D", "2º B", "11:00"),
    ("Vôlei", "3º FDI", "1º Eletro", "13:30"),
]


# ---------------------------------------------------------------------------
# Funções
# ---------------------------------------------------------------------------

def eh_vencedor(lado):
    """'V12' (texto) significa 'vencedor do jogo 12'."""
    return isinstance(lado, str) and lado[:1] == "V" and lado[1:].isdigit()


def sala_e_atleta(lado):
    """Devolve (sala, atleta) de um lado; nos esportes de equipe o atleta é None."""
    if isinstance(lado, tuple):
        return lado[0], lado[1]
    return lado, None


def todas_as_salas():
    salas = {"Misto"}
    for jogos in QUADROS.values():
        for _, a, b, *_ in jogos.values():
            for lado in (a, b):
                if not eh_vencedor(lado):
                    salas.add(sala_e_atleta(lado)[0])
    return sorted(salas)


def cadastrar_salas(conexao):
    existentes = {l["nome"].replace(" ", "").lower() for l in conexao.execute("SELECT nome FROM turmas")}
    novas = []
    for nome in todas_as_salas():
        if nome.replace(" ", "").lower() not in existentes:
            conexao.execute("INSERT INTO turmas (nome) VALUES (?)", (nome,))
            novas.append(nome)
    return novas


def montar_quadro(conexao, modalidade, jogos):
    ordem_fases = ["rodada1", "rodada2", "oitavas", "quartas", "semifinal", "final"]
    conexao.execute("DELETE FROM chaveamento WHERE modalidade = ?", (modalidade,))

    # 1) cria uma linha por jogo (posição = ordem do número do jogo dentro da fase)
    ids = {}
    posicao_na_fase = {}
    for numero in sorted(jogos, key=lambda n: (ordem_fases.index(jogos[n][0]), n)):
        fase, a, b, dia, horario, obs = jogos[numero]
        posicao_na_fase[fase] = posicao_na_fase.get(fase, 0) + 1

        sala_a, atleta_a = (None, None) if eh_vencedor(a) else sala_e_atleta(a)
        sala_b, atleta_b = (None, None) if eh_vencedor(b) else sala_e_atleta(b)

        cursor = conexao.execute(
            "INSERT INTO chaveamento (modalidade, fase, posicao, time_a, time_b, integrantes_a, integrantes_b, "
            "numero_jogo, dia, horario, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (modalidade, fase, posicao_na_fase[fase], sala_a, sala_b, atleta_a, atleta_b, numero, dia, horario, obs),
        )
        ids[numero] = cursor.lastrowid

    # 2) liga cada "vencedor do jogo N" à vaga onde ele entra
    for numero, (fase, a, b, *_) in jogos.items():
        for slot, lado in (("a", a), ("b", b)):
            if eh_vencedor(lado):
                origem = int(lado[1:])
                conexao.execute(
                    "UPDATE chaveamento SET proximo_chave_id = ?, proximo_slot = ? WHERE id = ?",
                    (ids[numero], slot, ids[origem]),
                )


def quadro_ja_iniciado(conexao, modalidade):
    return conexao.execute(
        "SELECT 1 FROM chaveamento WHERE modalidade = ? AND jogo_id IS NOT NULL", (modalidade,)
    ).fetchone() is not None


def main():
    forcar = "--forcar" in sys.argv
    inicializar_banco()  # garante que o banco está atualizado (novas fases e colunas)
    conexao = get_conexao()

    novas = cadastrar_salas(conexao)
    print(f"Salas cadastradas agora: {len(novas)}" + (f" ({', '.join(novas)})" if novas else ""))

    for modalidade, jogos in QUADROS.items():
        if quadro_ja_iniciado(conexao, modalidade) and not forcar:
            print(f"- {modalidade}: PULADO (já tem partida iniciada; use --forcar para refazer)")
            continue
        montar_quadro(conexao, modalidade, jogos)
        print(f"- {modalidade}: quadro montado com {len(jogos)} jogos")

    removidos = 0
    for modalidade, a, b, horario in EXEMPLOS_DO_SITE:
        removidos += conexao.execute(
            "DELETE FROM proximos_confrontos WHERE modalidade = ? AND sala_a = ? AND sala_b = ? AND horario = ?",
            (modalidade, a, b, horario),
        ).rowcount
    if removidos:
        print(f"- Removidos {removidos} confronto(s) de exemplo de 'Na sequência'")

    maior = conexao.execute("SELECT COALESCE(MAX(ordem), 0) FROM proximos_confrontos").fetchone()[0]
    adicionados = 0
    for modalidade, a, b, horario in FUTEBOL_FEMININO:
        ja_existe = conexao.execute(
            "SELECT 1 FROM proximos_confrontos WHERE modalidade = ? AND sala_a = ? AND sala_b = ? AND horario = ?",
            (modalidade, a, b, horario),
        ).fetchone()
        if not ja_existe:
            maior += 1
            conexao.execute(
                "INSERT INTO proximos_confrontos (modalidade, sala_a, sala_b, ordem, horario) VALUES (?, ?, ?, ?, ?)",
                (modalidade, a, b, maior, horario),
            )
            adicionados += 1
    print(f"- Futebol Feminino: {adicionados} jogo(s) adicionado(s) em 'Na sequência'")

    conexao.commit()
    conexao.close()
    print("Pronto! Abra o site e confira em Chaveamento.")


if __name__ == "__main__":
    main()
