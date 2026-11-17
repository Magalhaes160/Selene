// Cria o banco (arquivo selene.db) e as tabelas na primeira execução.
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'selene.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Se o banco já existir de uma versão anterior (colunas antigas ee/mf, em vez de
// met/aas/lys), apaga as tabelas para recriar com o esquema novo. Como o conteúdo
// mudou de espécie (cão/gato -> frango de corte), não dá para migrar os dados antigos:
// eles seriam de ingredientes/nutrientes que não existem mais nesta versão.
const colunas = db.prepare("PRAGMA table_info(ingredientes)").all().map(c => c.name);
if (colunas.length && !colunas.includes('met')) {
  db.exec(`
    DROP TABLE IF EXISTS formula_itens;
    DROP TABLE IF EXISTS formulas;
    DROP TABLE IF EXISTS exigencias;
    DROP TABLE IF EXISTS ingredientes;
    DROP TABLE IF EXISTS fases;
    DROP TABLE IF EXISTS especies;
  `);
}

db.exec(`
CREATE TABLE IF NOT EXISTS especies (
  id   TEXT PRIMARY KEY,
  nome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fases (
  id         TEXT NOT NULL,
  especie_id TEXT NOT NULL REFERENCES especies(id),
  nome       TEXT NOT NULL,
  PRIMARY KEY (id, especie_id)
);
CREATE TABLE IF NOT EXISTS ingredientes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,
  preco REAL NOT NULL,          -- R$/kg
  pb    REAL NOT NULL DEFAULT 0,  -- proteína bruta (%)
  em    REAL NOT NULL DEFAULT 0,  -- energia metabolizável (kcal/kg)
  ca    REAL NOT NULL DEFAULT 0,  -- cálcio (%)
  p     REAL NOT NULL DEFAULT 0,  -- fósforo (%)
  met   REAL NOT NULL DEFAULT 0,  -- metionina (%)
  aas   REAL NOT NULL DEFAULT 0,  -- metionina + cistina (%)
  lys   REAL NOT NULL DEFAULT 0,  -- lisina (%)
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS exigencias (
  especie_id TEXT NOT NULL,
  fase_id    TEXT NOT NULL,
  nutriente  TEXT NOT NULL,     -- pb, em, ca, p, met, aas, lys
  minimo     REAL,              -- NULL = sem mínimo
  maximo     REAL,              -- NULL = sem máximo
  PRIMARY KEY (especie_id, fase_id, nutriente)
);
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,     -- login é sempre feito pelo e-mail (sem diferenciar maiúsculas/minúsculas)
  senha_hash TEXT NOT NULL,            -- nunca a senha em texto puro, sempre com hash (bcrypt)
  registro   TEXT,                     -- ex.: CRMV-SP 12345 (opcional, só para exibir no cabeçalho)
  ativo      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS formulas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  especie_id    TEXT NOT NULL REFERENCES especies(id),
  fase_id       TEXT NOT NULL,
  total_kg      REAL NOT NULL,
  materia_seca  REAL NOT NULL,
  custo_total   REAL NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS formula_itens (
  formula_id     INTEGER NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  inclusao_pct   REAL NOT NULL,
  preco_unitario REAL NOT NULL,  -- preço no momento em que a fórmula foi salva
  PRIMARY KEY (formula_id, ingrediente_id)
);
`);

// Dados iniciais (só se o banco estiver vazio), extraídos da planilha do usuário
// "Método tentativa / QP / Custos": tabela de exigências de Frango de Corte, tabela
// de composição de ingredientes para aves e tabela de custos (R$/kg).
if (db.prepare('SELECT COUNT(*) n FROM especies').get().n === 0) {
  const seed = db.transaction(() => {
    db.prepare('INSERT INTO especies (id, nome) VALUES (?, ?)').run('frango', 'Frango de Corte');
    db.prepare('INSERT INTO fases (id, especie_id, nome) VALUES (?, ?, ?)').run('corte', 'frango', 'Corte');

    const ing = db.prepare(`INSERT INTO ingredientes (nome, preco, pb, em, ca, p, met, aas, lys)
                            VALUES (@nome, @preco, @pb, @em, @ca, @p, @met, @aas, @lys)`);
    [
      { nome: 'Milho',             preco: 0.60, pb: 8.57,  em: 3371, ca: 0.03,  p: 0.27,  met: 0.17, aas: 0.37, lys: 0.25 },
      { nome: 'Farelo de Soja',    preco: 0.80, pb: 45.54, em: 2266, ca: 0.32,  p: 0.55,  met: 0.65, aas: 1.27, lys: 2.78 },
      { nome: 'Sorgo',             preco: 0.55, pb: 8.85,  em: 3192, ca: 0.04,  p: 0.25,  met: 0.16, aas: 0.33, lys: 0.22 },
      { nome: 'Farinha de Carne',  preco: 1.40, pb: 40.70, em: 1945, ca: 14.31, p: 6.20,  met: 0.49, aas: 1.16, lys: 1.89 },
      { nome: 'Farelo de Trigo',   preco: 0.70, pb: 16.54, em: 1888, ca: 0.13,  p: 0.95,  met: 0.22, aas: 0.53, lys: 0.63 },
      { nome: 'Óleo',              preco: 1.10, pb: 0,     em: 8790, ca: 0,     p: 0,     met: 0,    aas: 0,    lys: 0 },
      { nome: 'Fosfato Bicálcico', preco: 1.20, pb: 0,     em: 0,    ca: 24.80, p: 18.50, met: 0,    aas: 0,    lys: 0 },
      { nome: 'Calcário',          preco: 0.30, pb: 0,     em: 0,    ca: 38.00, p: 0,     met: 0,    aas: 0,    lys: 0 },
      { nome: 'DL-Metionina',      preco: 1.80, pb: 58.70, em: 5020, ca: 0,     p: 0,     met: 99,   aas: 99,   lys: 0 },
      { nome: 'L-Lisina',          preco: 1.90, pb: 95.60, em: 3990, ca: 0,     p: 0,     met: 0,    aas: 0,    lys: 78.40 },
      { nome: 'Premix',            preco: 2.10, pb: 0,     em: 0,    ca: 0,     p: 0,     met: 0,    aas: 0,    lys: 0 },
      { nome: 'Sal',               preco: 0.90, pb: 0,     em: 0,    ca: 0,     p: 0,     met: 0,    aas: 0,    lys: 0 }
    ].forEach(i => ing.run(i));

    const ex = db.prepare('INSERT INTO exigencias (especie_id, fase_id, nutriente, minimo, maximo) VALUES (?,?,?,?,?)');
    const exigencias = { pb:[21,null], em:[3000,null], ca:[1,null], p:[0.5,null], met:[0.44,null], aas:[0.72,null], lys:[1.1,null] };
    for (const [n, [min, max]] of Object.entries(exigencias)) ex.run('frango', 'corte', n, min, max);
  });
  seed();
}

// Usuário de exemplo, para você conseguir entrar assim que baixar o projeto.
// O login é sempre feito pelo e-mail, e a senha fica guardada com hash (bcrypt),
// nunca em texto puro. Cadastre outros usuários direto no banco (ou peça para eu
// montar uma tela de cadastro) e, por segurança, troque esta senha de exemplo.
if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n === 0) {
  db.prepare(`INSERT INTO usuarios (nome, email, senha_hash, registro) VALUES (?, ?, ?, ?)`)
    .run('Dr. Ana Silva', 'ana.silva@selene.com', bcrypt.hashSync('selene123', 10), 'CRMV-SP 12345');
}

module.exports = db;
