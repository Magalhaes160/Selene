# 🌿 Selene — Formulador de Ração

Aplicação web para formular rações balanceadas: o usuário escolhe espécie e fase, monta a fórmula com os ingredientes da base, e o sistema compara na hora a composição nutricional com as exigências e calcula o custo.

> **Status:** protótipo funcional. O formulador e a persistência estão prontos; o login ainda é apenas uma simulação visual (veja [Limitações](#limitações-conhecidas)).

## Funcionalidades

- **Formulador** com seleção de ingredientes e percentual de inclusão de cada um
- **Análise nutricional vs. exigência** em tempo real (Adequado / Abaixo / Acima)
- **Custo por kg e custo total** da fórmula, calculados a partir do preço dos ingredientes
- **Fórmulas salvas**: criar, abrir, atualizar, salvar como nova e excluir
- **Preço congelado**: cada fórmula guarda o preço dos ingredientes no momento em que foi salva
- **Laudo técnico** para impressão ou PDF (via `window.print()` do navegador)
- **Página inicial** (`inicio.html`) com apresentação do sistema e tela de login

## Nutrientes analisados

| Nutriente | Unidade |
|---|---|
| Proteína bruta (PB) | % |
| Energia metabolizável (EM) | kcal/kg |
| Cálcio (Ca) | % |
| Fósforo (P) | % |
| Metionina (Met) | % |
| Metionina + cistina (AAS) | % |
| Lisina (Lys) | % |

## Tecnologias

- [Node.js](https://nodejs.org/) + [Express 5](https://expressjs.com/)
- [SQLite](https://www.sqlite.org/) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Front-end em HTML, CSS e JavaScript puros (sem framework e sem etapa de build)

## Como rodar

**Pré-requisito:** Node.js instalado.

```bash
# 1. Clone o repositório
git clone https://github.com/SEU-USUARIO/selene.git
cd selene

# 2. Instale as dependências
npm install

# 3. Inicie o servidor
npm start
```

Acesse **http://localhost:3000**. Para usar outra porta:

```bash
PORT=8080 npm start
```

Na primeira execução o arquivo `selene.db` é criado automaticamente, já com os dados iniciais (espécie, fase, ingredientes e exigências).

> A página inicial fica em `/inicio.html` e o formulador em `/` (`index.html`).

## Estrutura do projeto

```
selene/
├── server.js        # API REST (Express) e servidor dos arquivos estáticos
├── db.js            # Conexão SQLite, criação das tabelas e dados iniciais
├── package.json
└── public/
    ├── index.html   # Formulador de ração
    └── inicio.html  # Página inicial com login
```

## Banco de dados

O banco é um arquivo SQLite (`selene.db`) criado pelo `db.js`, com as tabelas:

| Tabela | Conteúdo |
|---|---|
| `especies` | Espécies atendidas |
| `fases` | Fases de cada espécie |
| `ingredientes` | Preço (R$/kg) e composição nutricional |
| `exigencias` | Mínimo e máximo de cada nutriente por espécie/fase |
| `formulas` | Cabeçalho das fórmulas salvas |
| `formula_itens` | Ingredientes de cada fórmula, com inclusão (%) e preço no momento do salvamento |

### Dados iniciais

Vêm da planilha de formulação "Método tentativa / QP / Custos":

- **Espécie/fase:** Frango de Corte — Corte
- **Ingredientes (12):** Milho, Farelo de Soja, Sorgo, Farinha de Carne, Farelo de Trigo, Óleo, Fosfato Bicálcico, Calcário, DL-Metionina, L-Lisina, Premix e Sal

> ⚠️ Se o `db.js` detectar um banco de uma versão antiga do esquema (sem as colunas `met`/`aas`/`lys`), ele **apaga e recria** as tabelas.

## API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/usuario` | Dados do usuário (atualmente fixos) |
| `GET` | `/api/ingredientes` | Lista os ingredientes ativos |
| `GET` | `/api/especies` | Lista as espécies |
| `GET` | `/api/fases/:especie` | Fases de uma espécie |
| `GET` | `/api/exigencias/:especie/:fase` | Exigências nutricionais (`[mínimo, máximo]` por nutriente) |
| `GET` | `/api/formulas` | Lista as fórmulas salvas |
| `GET` | `/api/formulas/:id` | Detalha uma fórmula e seus itens |
| `POST` | `/api/formulas` | Cria uma fórmula |
| `PUT` | `/api/formulas/:id` | Atualiza uma fórmula |
| `DELETE` | `/api/formulas/:id` | Exclui uma fórmula |

Exemplo de corpo para `POST /api/formulas`:

```json
{
  "nome": "Frango corte — teste 1",
  "especie": "frango",
  "fase": "corte",
  "totalKg": 1000,
  "materiaSeca": 88,
  "itens": [
    { "ingredienteId": 1, "inclusaoPct": 60 },
    { "ingredienteId": 2, "inclusaoPct": 35 }
  ]
}
```

Regras de validação: nome obrigatório, espécie/fase existentes, `totalKg > 0`, matéria seca entre 0 e 100, ao menos um ingrediente, sem ingredientes repetidos e inclusão entre 0 e 100. Erros retornam `{ "erro": "mensagem" }`.

## Limitações conhecidas

- **Login simulado:** a tela de login aceita qualquer usuário e senha, e `/api/usuario` devolve um usuário fixo. Não há autenticação nem sessões; **não exponha esta aplicação na internet** sem implementar um login real.
- Apenas **Frango de Corte** está cadastrado. Novas espécies, fases e ingredientes precisam ser inseridos no banco por enquanto.
- As páginas *Ingredientes*, *Relatórios* e *Configurações* aparecem no menu da página inicial, mas ainda não existem.
- A soma das inclusões é normalizada para 100% pelo botão *Recalcular custo*; o sistema não otimiza a fórmula automaticamente (o balanceamento é feito pelo usuário, no método de tentativa).

## Próximos passos

- [ ] Autenticação real (`/api/login` com sessão ou token)
- [ ] Cadastro de ingredientes, espécies, fases e exigências pela interface
- [ ] Relatórios e histórico de fórmulas
- [ ] Otimização de custo mínimo (programação linear)

## Licença

Distribuído sob a licença MIT.
