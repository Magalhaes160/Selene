const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());

// Sessão de login via cookie. O "secret" abaixo assina o cookie para que ele não
// possa ser forjado; troque por um valor seu (uma string longa e aleatória) antes
// de colocar isto em produção de verdade.
app.use(session({
  secret: 'selene-nutricao-animal-troque-este-segredo',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' } // sem maxAge = cookie de sessão (some ao fechar o navegador)
}));

app.use(express.static(path.join(__dirname, 'public')));

// Exige login para usar a rota. Só fica na frente das rotas que ALTERAM dados
// (criar, atualizar, excluir fórmula) — ver os ingredientes e as fórmulas já
// salvas é permitido sem login, para dar para "olhar" o formulador sem conta.
function exigirLogin(req, res, next) {
  if (!req.session.usuarioId) return res.status(401).json({ erro: 'É preciso entrar para usar o formulador.' });
  next();
}

/* ---------- Login ---------- */
app.post('/api/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

  // E-mail comparado sem diferenciar maiúsculas/minúsculas. Mesma mensagem de erro
  // tanto para e-mail inexistente quanto para senha errada, para não revelar quais
  // e-mails estão cadastrados.
  const usuario = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ? AND ativo = 1').get(email);
  if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  req.session.regenerate(erro => {
    if (erro) return res.status(500).json({ erro: 'Erro ao iniciar sessão.' });
    req.session.usuarioId = usuario.id;
    req.session.nome = usuario.nome;
    req.session.registro = usuario.registro;
    if (req.body?.manter) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 dias
    res.json({ nome: usuario.nome, registro: usuario.registro });
  });
});

app.post('/api/cadastro', (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');

  if (!nome) return res.status(400).json({ erro: 'Informe seu nome.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE lower(email) = ?').get(email)) {
    return res.status(400).json({ erro: 'Este e-mail já está cadastrado.' });
  }

  const hash = bcrypt.hashSync(senha, 10);
  let r;
  try{
    r = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)').run(nome, email, hash);
  }catch(erro){
    return res.status(400).json({ erro: 'Este e-mail já está cadastrado.' });
  }

  // Conta criada: já entra com ela, sem precisar fazer login de novo em seguida.
  req.session.regenerate(erro => {
    if (erro) return res.status(500).json({ erro: 'Conta criada, mas não foi possível entrar. Tente fazer login.' });
    req.session.usuarioId = Number(r.lastInsertRowid);
    req.session.nome = nome;
    req.session.registro = null;
    res.status(201).json({ nome });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('connect.sid'); res.json({ ok: true }); });
});

app.get('/api/sessao', (req, res) => {
  if (!req.session.usuarioId) return res.json({ logado: false });
  res.json({ logado: true, nome: req.session.nome, registro: req.session.registro });
});

/* ---------- Dados de apoio (visíveis sem login) ---------- */
app.get('/api/ingredientes', (req, res) =>
  res.json(db.prepare('SELECT id, nome, preco, pb, em, ca, p, met, aas, lys FROM ingredientes WHERE ativo = 1 ORDER BY nome').all()));

app.get('/api/especies', (req, res) =>
  res.json(db.prepare('SELECT id, nome FROM especies ORDER BY nome').all()));

app.get('/api/fases/:especie', (req, res) =>
  res.json(db.prepare('SELECT id, nome FROM fases WHERE especie_id = ?').all(req.params.especie)));

app.get('/api/exigencias/:especie/:fase', (req, res) => {
  const linhas = db.prepare('SELECT nutriente, minimo, maximo FROM exigencias WHERE especie_id = ? AND fase_id = ?')
                   .all(req.params.especie, req.params.fase);
  if (!linhas.length) return res.status(404).json({ erro: 'Exigências não cadastradas.' });
  const obj = {};
  linhas.forEach(l => obj[l.nutriente] = [l.minimo, l.maximo]);
  res.json(obj);
});

/* ---------- Fórmulas: ver é livre; criar/editar/excluir exige login ---------- */
function validar(b) {
  if (!b || typeof b.nome !== 'string' || !b.nome.trim()) return 'Informe o nome da fórmula.';
  if (!db.prepare('SELECT 1 FROM fases WHERE id = ? AND especie_id = ?').get(b.fase, b.especie)) return 'Espécie ou fase inválida.';
  if (!(b.totalKg > 0)) return 'Total a produzir deve ser maior que zero.';
  if (!(b.materiaSeca > 0 && b.materiaSeca <= 100)) return 'Matéria seca deve estar entre 0 e 100.';
  if (!Array.isArray(b.itens) || !b.itens.length) return 'Adicione pelo menos um ingrediente.';
  const ids = new Set();
  for (const it of b.itens) {
    if (!db.prepare('SELECT 1 FROM ingredientes WHERE id = ?').get(it.ingredienteId)) return 'Ingrediente inválido.';
    if (!(it.inclusaoPct >= 0 && it.inclusaoPct <= 100)) return 'Inclusão inválida.';
    if (ids.has(it.ingredienteId)) return 'Ingrediente repetido.';
    ids.add(it.ingredienteId);
  }
  return null;
}

const gravarItens = db.transaction((id, itens) => {
  db.prepare('DELETE FROM formula_itens WHERE formula_id = ?').run(id);
  const ins = db.prepare(`INSERT INTO formula_itens (formula_id, ingrediente_id, inclusao_pct, preco_unitario)
                          VALUES (?, ?, ?, (SELECT preco FROM ingredientes WHERE id = ?))`);
  itens.forEach(i => ins.run(id, i.ingredienteId, i.inclusaoPct, i.ingredienteId));
  db.prepare(`UPDATE formulas SET custo_total = total_kg * COALESCE(
      (SELECT SUM(inclusao_pct / 100.0 * preco_unitario) FROM formula_itens WHERE formula_id = formulas.id), 0)
      WHERE id = ?`).run(id);
});

const criar = db.transaction(b => {
  const r = db.prepare('INSERT INTO formulas (nome, especie_id, fase_id, total_kg, materia_seca) VALUES (?,?,?,?,?)')
              .run(b.nome.trim(), b.especie, b.fase, b.totalKg, b.materiaSeca);
  gravarItens(r.lastInsertRowid, b.itens);
  return Number(r.lastInsertRowid);
});

const atualizar = db.transaction((id, b) => {
  db.prepare(`UPDATE formulas SET nome=?, especie_id=?, fase_id=?, total_kg=?, materia_seca=?,
              atualizado_em=CURRENT_TIMESTAMP WHERE id=?`)
    .run(b.nome.trim(), b.especie, b.fase, b.totalKg, b.materiaSeca, id);
  gravarItens(id, b.itens);
});

app.get('/api/formulas', (req, res) =>
  res.json(db.prepare(`SELECT id, nome, especie_id AS especie, fase_id AS fase, total_kg AS totalKg,
                       custo_total AS custoTotal, atualizado_em AS atualizadoEm
                       FROM formulas ORDER BY atualizado_em DESC, id DESC`).all()));

app.get('/api/formulas/:id', (req, res) => {
  const f = db.prepare(`SELECT id, nome, especie_id AS especie, fase_id AS fase, total_kg AS totalKg,
                        materia_seca AS materiaSeca FROM formulas WHERE id = ?`).get(req.params.id);
  if (!f) return res.status(404).json({ erro: 'Fórmula não encontrada.' });
  f.itens = db.prepare('SELECT ingrediente_id AS ingredienteId, inclusao_pct AS inclusaoPct FROM formula_itens WHERE formula_id = ?')
              .all(f.id);
  res.json(f);
});

app.post('/api/formulas', exigirLogin, (req, res) => {
  const erro = validar(req.body);
  if (erro) return res.status(400).json({ erro });
  res.status(201).json({ id: criar(req.body) });
});

app.put('/api/formulas/:id', exigirLogin, (req, res) => {
  if (!db.prepare('SELECT 1 FROM formulas WHERE id = ?').get(req.params.id))
    return res.status(404).json({ erro: 'Fórmula não encontrada.' });
  const erro = validar(req.body);
  if (erro) return res.status(400).json({ erro });
  atualizar(req.params.id, req.body);
  res.json({ id: Number(req.params.id) });
});

app.delete('/api/formulas/:id', exigirLogin, (req, res) => {
  const r = db.prepare('DELETE FROM formulas WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Fórmula não encontrada.' });
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => console.log(`Selene rodando em http://localhost:${PORTA}`));
