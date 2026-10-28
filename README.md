# software-architecture-practice-account

Serviço `account` da [plataforma de trading](https://github.com/erichenriquesm/software-architecture-practice) (projeto de prática de arquitetura de software).

Identidade e Conta: cadastro (nome, e-mail, CPF, senha) e consulta da conta com saldos projetados da carteira.

## O que faz

Cadastra contas (nome, e-mail, CPF e senha com argon2id) e responde a conta com os saldos, lidos de uma projeção local alimentada pelo `wallet` (com fallback por gRPC e resposta degradada se o `wallet` estiver fora).

A especificação completa (modelo, casos de uso, dados, testes) está na spec do serviço: [`sdd/services/account.md`](https://github.com/erichenriquesm/software-architecture-practice/blob/main/sdd/services/account.md). As regras de arquitetura valem para todos os serviços: [`sdd/01-principios.md`](https://github.com/erichenriquesm/software-architecture-practice/blob/main/sdd/01-principios.md).

## API

| Rota | O que faz |
|---|---|
| `POST /signup` | cria a conta (`201 { accountId }`; `409` e-mail já cadastrado; `422` dado inválido) |
| `GET /accounts/:accountId` | conta + `assets[{ assetId, quantity, available, reserved }]` + `balancesStatus` |

**gRPC interno:** Servidor `AccountService.Exists` (só o `wallet` pode chamar). Cliente de `WalletService.GetBalances`.

## Eventos (RabbitMQ)

- **Publica:** `account.created`
- **Consome:** `wallet.balanceChanged` (fila `account.walletBalances`)

Os contratos ficam em `src/infra/contracts/`: `published/` (este serviço é o dono) e `consumed/` (cópias do que ele consome, conferidas pelo `make check` do repositório guarda-chuva).

## Como rodar

Este serviço roda junto com a plataforma, a partir do [repositório guarda-chuva](https://github.com/erichenriquesm/software-architecture-practice), que tem a infra compartilhada (RabbitMQ, Redis, edge) e clona todos os serviços:

```bash
git clone https://github.com/erichenriquesm/software-architecture-practice.git
cd software-architecture-practice/backend
make clone
make up
```

Containers: `account-api` (REST + gRPC) · `account-worker` (outbox + projeção de saldos) · `account-db`. Portas no host (só para depurar): REST 3001 · gRPC 50051 · Postgres 5433.

Dentro da pasta do serviço (`backend/account/`):

| Comando | O que faz |
|---|---|
| `make test` | typecheck, lint, regras de arquitetura, testes de unidade e de integração (tudo em container) |
| `make migrate` · `make migrate-status` · `make migrate-rollback` · `make migration name=...` | migrações no estilo Laravel |
| `make deps` | instala o `node_modules` na sua máquina, só para o editor |

## Estrutura

```
src/
  domain/        regras de negócio (entities, valueObjects, domainEvents, domainServices)
  application/   casos de uso, DTOs e contratos (interfaces)
  infra/         HTTP, mensageria, banco, plataforma técnica, contratos de eventos
test/
  unit/  integration/  fakes/  support/
docker/          Dockerfile e composes (só para ambiente local)
```
