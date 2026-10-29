# software-architecture-practice-account

Serviço `account` da [plataforma de trading](https://github.com/erichenriquesm/software-architecture-practice) (projeto de prática de arquitetura de software).

Identidade e Conta: cadastro (nome, e-mail, CPF, senha) e consulta da conta com saldos projetados da carteira.

## O que faz

Cadastra contas (nome, e-mail, CPF e senha com argon2id) e responde a conta com os saldos, lidos só de uma projeção local alimentada pelo evento `wallet.balanceChanged` (conta nova, sem linhas na projeção, responde `assets: []`).

A especificação completa (modelo, casos de uso, dados, testes) está na spec do serviço: [`sdd/services/account.md`](https://github.com/erichenriquesm/software-architecture-practice/blob/main/sdd/services/account.md). As regras de arquitetura valem para todos os serviços: [`sdd/01-principios.md`](https://github.com/erichenriquesm/software-architecture-practice/blob/main/sdd/01-principios.md).

## Comece por aqui

Um cadastro, de ponta a ponta:

1. `src/infra/http/accountRoutes.ts`: a rota `POST /signup` recebe o corpo e chama o caso de uso.
2. `src/application/usecases/signup.ts`: valida, faz o hash da senha e cria a conta.
3. `src/domain/entities/account.ts`: a entidade, com as regras (e-mail, CPF) e o evento `AccountCreated`.
4. `src/infra/database/kyselyAccountRepository.ts`: grava a conta no Postgres.
5. `src/infra/messaging/outboxEventPublisher.ts`: o caso de uso entrega os eventos ao `EventPublisher`, que transforma `AccountCreated` em `account.created` e grava no outbox, na mesma transação; o worker publica no RabbitMQ.

Para a leitura (`GET /accounts/:accountId`): `getAccount.ts` → `kyselyAccountDao.ts` (dados da conta) e `kyselyBalanceDao.ts` (saldos projetados do `wallet`, tabela `account_balance_view`).

## API

| Rota | O que faz |
|---|---|
| `POST /signup` | cria a conta (`201 { accountId }`; `409` e-mail já cadastrado; `422` dado inválido) |
| `GET /accounts/:accountId` | conta + `assets[{ assetId, quantity, available, reserved }]` (da projeção; `[]` enquanto nada foi projetado) · `403` se não for a conta do token |
| `POST /login` | `204` + cookie `session` (`HttpOnly`, `Secure`, `SameSite=Strict`, 12 h) · `401 invalidCredentials` · `429 tooManyLoginAttempts` com `Retry-After` |
| `POST /logout` | `204`, revoga a sessão e apaga o cookie |
| `GET /me` | `{ accountId, name, email }` do usuário do token |
| `GET /internal/session` | só para o edge (`auth_request`): cookie + `X-Audience` → `204` com o JWT em `X-User-Token`; sem sessão viva → `401` |

**Usuário:** `/login`, `/logout`, `/signup` e `/internal/session` são públicas; as demais exigem o JWT interno em `Authorization: Bearer …` (`aud: account`). O `account` é o único que assina esse JWT (`USER_TOKEN_PRIVATE_KEY`, Ed25519) e também o verifica (`USER_TOKEN_PUBLIC_KEY`). A sessão guarda só o SHA-256 do token do cookie (tabela `session`). Bloqueio de login no Redis (`account:login:*`): 5 falhas em 15 min travam o e-mail por 5 min, dobrando até 24 h; 20 falhas por IP por hora. Se o Redis cair, o login segue sem bloqueio.

**gRPC interno:** só servidor, `AccountService.Exists` (usado pelo `wallet`). Toda chamada leva o token compartilhado `GRPC_TOKEN` no metadata `x-service-token`; sem ele, `UNAUTHENTICATED`.

## Eventos (RabbitMQ)

- **Publica:** `account.created`
- **Consome:** `wallet.balanceChanged` (fila `account.walletBalances`)

Os contratos ficam em `src/infra/schemas/`: `published/` (este serviço é o dono) e `consumed/` (cópias do que ele consome, conferidas pelo `make check` do repositório guarda-chuva).

## Como rodar

Este serviço roda junto com a plataforma, a partir do [repositório guarda-chuva](https://github.com/erichenriquesm/software-architecture-practice), que tem a infra compartilhada (RabbitMQ, Redis, edge) e clona todos os serviços:

```bash
git clone https://github.com/erichenriquesm/software-architecture-practice.git
cd software-architecture-practice
make clone
make up
```

Containers: `account-api` (REST + gRPC) · `account-worker` (outbox + projeção de saldos; se a conexão com o RabbitMQ cai, ele sai e o Docker o reinicia) · `account-db`. Portas no host (só para depurar): REST 3001 · gRPC 50051 · Postgres 5433.

Dentro da pasta do serviço (`backend/account/`):

| Comando | O que faz |
|---|---|
| `make up` · `make down` | sobe só este serviço (com RabbitMQ e Redis, sem os outros serviços nem o edge) e roda as migrações · derruba os containers dele |
| `make watch` · `make ps` · `make logs` | o mesmo `up` em primeiro plano com Compose Watch · containers e saúde · logs |
| `make test` | typecheck, lint, regras de arquitetura, testes de unidade e de integração (tudo em container) |
| `make migrate` · `make migrate-status` · `make migrate-rollback` · `make migration name=...` | migrações no estilo Laravel |
| `make deps` | instala o `node_modules` na sua máquina, só para o editor |

## Estrutura

```
src/
  domain/        regras de negócio (entities, valueObjects, events)
  application/   casos de uso (com seus Input/Output) e contratos (interfaces e tipos View dos DAOs)
  infra/         HTTP, mensageria, banco, plataforma técnica, schemas de eventos
test/
  unit/  integration/  fakes/  support/
docker/          Dockerfile e composes (só para ambiente local)
```
