import re
import sqlite3
from werkzeug.security import generate_password_hash

DB_PATH = "interclasse.db"


def get_conexao():
    conexao = sqlite3.connect(DB_PATH)
    conexao.row_factory = sqlite3.Row
    return conexao


# Tabela do chaveamento. Cada linha é um confronto. As fases podem ser: rodada1, rodada2, oitavas,
# quartas, semifinal e final. "numero_jogo", "dia", "horario" e "obs" guardam a programação oficial
# (ex.: Jogo 5, Quarta, 10:30-10:40, Mesa 2).
DDL_CHAVEAMENTO = """
    CREATE TABLE {se_nao_existe}{nome} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        modalidade TEXT NOT NULL,
        fase TEXT NOT NULL CHECK (fase IN ('rodada1', 'rodada2', 'oitavas', 'quartas', 'semifinal', 'final')),
        posicao INTEGER NOT NULL,
        time_a TEXT,
        time_b TEXT,
        vencedor TEXT,
        jogo_id INTEGER,
        proximo_chave_id INTEGER,
        proximo_slot TEXT CHECK (proximo_slot IN ('a', 'b')),
        integrantes_a TEXT,
        integrantes_b TEXT,
        numero_jogo INTEGER,
        dia TEXT,
        horario TEXT,
        obs TEXT,
        FOREIGN KEY (jogo_id) REFERENCES jogos(id),
        FOREIGN KEY (proximo_chave_id) REFERENCES chaveamento(id)
    )
"""


def _migrar_fases_chaveamento(cursor):
    """Bancos antigos só aceitavam quartas/semifinal/final. Recria a tabela aceitando as novas
    fases e copia tudo que já existia (o SQLite não deixa alterar a regra de uma coluna)."""
    sql = cursor.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chaveamento'").fetchone()[0]
    if "'oitavas'" in sql:
        return
    antigas = [linha[1] for linha in cursor.execute("PRAGMA table_info(chaveamento)")]
    cursor.execute(DDL_CHAVEAMENTO.format(nome="chaveamento_nova", se_nao_existe=""))
    novas = [linha[1] for linha in cursor.execute("PRAGMA table_info(chaveamento_nova)")]
    comuns = ", ".join(c for c in antigas if c in novas)
    cursor.execute(f"INSERT INTO chaveamento_nova ({comuns}) SELECT {comuns} FROM chaveamento")
    cursor.execute("DROP TABLE chaveamento")
    cursor.execute("ALTER TABLE chaveamento_nova RENAME TO chaveamento")


def _coluna_existe(cursor, tabela, coluna):
    cursor.execute(f"PRAGMA table_info({tabela})")
    colunas = [linha[1] for linha in cursor.fetchall()]
    return coluna in colunas


def inicializar_banco():
    conexao = get_conexao()
    cursor = conexao.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            cargo TEXT NOT NULL CHECK (cargo IN ('diretor', 'marcador', 'aluno'))
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS jogos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            modalidade TEXT NOT NULL,
            time_a TEXT NOT NULL,
            time_b TEXT NOT NULL,
            placar_a INTEGER NOT NULL DEFAULT 0,
            placar_b INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'ao_vivo' CHECK (status IN ('aguardando', 'ao_vivo', 'encerrado')),
            marcador_id INTEGER,
            em_penaltis INTEGER NOT NULL DEFAULT 0,
            penaltis_a INTEGER NOT NULL DEFAULT 0,
            penaltis_b INTEGER NOT NULL DEFAULT 0,
            local TEXT,
            sets_vencidos_a INTEGER NOT NULL DEFAULT 0,
            sets_vencidos_b INTEGER NOT NULL DEFAULT 0,
            set_atual INTEGER NOT NULL DEFAULT 1,
            historico_sets TEXT NOT NULL DEFAULT '[]',
            resultado TEXT,
            integrantes_a TEXT,
            integrantes_b TEXT,
            fase TEXT NOT NULL DEFAULT 'classificatoria',
            chaveamento_id INTEGER,
            ultimo_time TEXT,
            ultimo_delta INTEGER,
            FOREIGN KEY (marcador_id) REFERENCES usuarios(id)
        )
    """)

    # Chaveamento de mata-mata: cada linha é um confronto de uma fase (quartas, semifinal, final)
    # de uma modalidade. time_a/time_b começam vazios até o sorteio (ou até o vencedor da fase
    # anterior ser definido) e "proximo_chave_id"/"proximo_slot" dizem pra onde o vencedor vai.
    cursor.execute(DDL_CHAVEAMENTO.format(nome="chaveamento", se_nao_existe="IF NOT EXISTS "))
    _migrar_fases_chaveamento(cursor)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS proximos_confrontos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            modalidade TEXT NOT NULL,
            sala_a TEXT NOT NULL,
            sala_b TEXT NOT NULL,
            ordem INTEGER NOT NULL DEFAULT 0,
            horario TEXT
        )
    """)

    # Migração: se o banco já existia antes dessas colunas serem criadas,
    # adiciona elas sem apagar os dados que já estavam lá.
    for coluna, definicao in [
        ("em_penaltis", "INTEGER NOT NULL DEFAULT 0"),
        ("penaltis_a", "INTEGER NOT NULL DEFAULT 0"),
        ("penaltis_b", "INTEGER NOT NULL DEFAULT 0"),
        ("local", "TEXT"),
        ("sets_vencidos_a", "INTEGER NOT NULL DEFAULT 0"),
        ("sets_vencidos_b", "INTEGER NOT NULL DEFAULT 0"),
        ("set_atual", "INTEGER NOT NULL DEFAULT 1"),
        ("historico_sets", "TEXT NOT NULL DEFAULT '[]'"),
        ("resultado", "TEXT"),
        ("integrantes_a", "TEXT"),
        ("integrantes_b", "TEXT"),
        ("fase", "TEXT NOT NULL DEFAULT 'classificatoria'"),
        ("chaveamento_id", "INTEGER"),
        ("ultimo_time", "TEXT"),
        ("ultimo_delta", "INTEGER"),
        ("encerrado_em", "TEXT"),
    ]:
        if not _coluna_existe(cursor, "jogos", coluna):
            cursor.execute(f"ALTER TABLE jogos ADD COLUMN {coluna} {definicao}")

    # Xadrez no chaveamento: quem joga por cada sala (podem ser várias pessoas)
    for coluna in ("integrantes_a", "integrantes_b"):
        if not _coluna_existe(cursor, "chaveamento", coluna):
            cursor.execute(f"ALTER TABLE chaveamento ADD COLUMN {coluna} TEXT")

    # Guarda o momento em que a partida foi encerrada (qualquer que seja o jeito de encerrar).
    # É isso que permite mostrar a tela "quem ganhou" logo depois do fim do jogo.
    cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS jogo_encerrado_em
        AFTER UPDATE OF status ON jogos
        WHEN NEW.status = 'encerrado' AND OLD.status <> 'encerrado'
        BEGIN
            UPDATE jogos SET encerrado_em = strftime('%Y-%m-%d %H:%M:%S', 'now') WHERE id = NEW.id;
        END
    """)

    # Notícias escolares: categoria "interclasse" (o que acontece nos jogos) ou "escola" (avisos gerais)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS noticias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            categoria TEXT NOT NULL CHECK (categoria IN ('interclasse', 'escola')),
            titulo TEXT NOT NULL,
            texto TEXT,
            autor_id INTEGER,
            autor_nome TEXT,
            criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
        )
    """)

    if not _coluna_existe(cursor, "proximos_confrontos", "horario"):
        cursor.execute("ALTER TABLE proximos_confrontos ADD COLUMN horario TEXT")

    # Cria usuários de exemplo só na primeira execução (banco vazio)
    cursor.execute("SELECT COUNT(*) FROM usuarios")
    if cursor.fetchone()[0] == 0:
        usuarios_iniciais = [
            ("Diretor", "diretor@escola.com", generate_password_hash("123"), "diretor"),
            ("Aluno Marcador - Quadra 1", "marcador1@escola.com", generate_password_hash("marca123"), "marcador"),
            ("Aluno Exemplo", "aluno@escola.com", generate_password_hash("123"), "aluno"),
        ]
        cursor.executemany(
            "INSERT INTO usuarios (nome, email, senha_hash, cargo) VALUES (?, ?, ?, ?)",
            usuarios_iniciais
        )

    # Cria um jogo de exemplo, atribuído ao marcador de exemplo (id 2)
    cursor.execute("SELECT COUNT(*) FROM jogos")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO jogos (modalidade, time_a, time_b, placar_a, placar_b, status, marcador_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("Vôlei", "3º DS", "2º FDI", 0, 0, "ao_vivo", 2)
        )

    # Próximos confrontos de exemplo (salas do Normal vão de A a D por ano)
    cursor.execute("SELECT COUNT(*) FROM proximos_confrontos")
    if cursor.fetchone()[0] == 0:
        confrontos_iniciais = [
            ("Vôlei", "1º A", "2º FDI", 1, "09:00"),
            ("Futebol", "3º B", "1º Eletro", 2, "10:00"),
            ("Xadrez", "2º C", "3º DS", 3, "10:30"),
            ("Tênis de Mesa", "1º D", "2º B", 4, "11:00"),
            ("Vôlei", "3º FDI", "1º Eletro", 5, "13:30"),
        ]
        cursor.executemany(
            "INSERT INTO proximos_confrontos (modalidade, sala_a, sala_b, ordem, horario) VALUES (?, ?, ?, ?, ?)",
            confrontos_iniciais
        )

    # Turmas participantes: é a lista usada nos sorteios de confrontos.
    # Na primeira vez que a tabela é criada, ela já nasce preenchida com as turmas que
    # aparecem nos confrontos e jogos existentes (jogos de Xadrez ficam de fora: lá são jogadores).
    tabela_turmas_existia = cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turmas'"
    ).fetchone()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS turmas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE COLLATE NOCASE
        )
    """)
    if not tabela_turmas_existia:
        nomes_existentes = []
        for linha in cursor.execute("SELECT sala_a, sala_b FROM proximos_confrontos ORDER BY ordem").fetchall():
            nomes_existentes.extend([linha[0], linha[1]])
        for linha in cursor.execute("SELECT time_a, time_b FROM jogos WHERE modalidade != 'Xadrez' ORDER BY id").fetchall():
            nomes_existentes.extend([linha[0], linha[1]])
        vistos = set()
        for nome in nomes_existentes:
            nome_limpo = " ".join(str(nome).split())[:30]
            chave = nome_limpo.replace(" ", "").lower()
            # Mesmas regras do cadastro de turmas em app.py: sem repetir e só caracteres seguros
            if nome_limpo and chave not in vistos and re.match(r"^[\w .\-/()ºª°]+$", nome_limpo):
                vistos.add(chave)
                cursor.execute("INSERT OR IGNORE INTO turmas (nome) VALUES (?)", (nome_limpo,))

    conexao.commit()
    conexao.close()
