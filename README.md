# Vesta — AI Treasury Guardian

Vesta is an AI-native treasury control product on **GenLayer Studio (studionet)**.
The thesis is simple: an AI agent should be able to pay for useful work without
receiving unrestricted control of a wallet. A contract should custody the funds
and enforce the agent's authority, while the human owner keeps policy control and
an emergency stop.

The name is deliberate — Vesta is the Roman goddess of the hearth and its sacred
treasury. The treasury is the hearth; the Intelligent Contract is the flame that
guards it.

What makes this different from a conventional treasury is where the judgment
happens. The decision to approve or reject a purchase is made *inside* the
contract, by validator LLM consensus, and recorded on-chain next to the payment
it authorizes. There is no decision server, no API key, and no database.

> **Status:** the finality-safe revision is deployed on Studionet and verified
> working end to end — funded, adjudicated by real validators, delivery confirmed
> by the merchant, and settled only after the transfer finalized. The contract
> passes `genvm-lint check`, 73 direct-mode tests, and the app typechecks and
> builds. Studio state is temporary and gasless: Studio is for building and
> demoing, not a production deployment, and no independent security audit has
> been performed.

## Why AI Is Necessary

A static limit can reject an oversized payment, but it cannot determine whether a
correctly priced request advances a business objective. Evaluating purpose,
evidence, duplication risk, and expected value against a natural-language
justification is a judgment, not a comparison.

## Why GenLayer

Every other chain forces that judgment off-chain, into a server holding an API
key, and reduces the on-chain record to a hash of whatever that server decided.
The server becomes the trusted party. GenLayer removes it: `gl.nondet.exec_prompt`
runs on the validators, and the Equivalence Principle turns several independent
model answers into one consensus verdict.

The practical consequence is that a treasury decision is reproducible and
contestable. The leader proposes a verdict; each validator asks its own model the
same question and compares the decision and the risk score. A validator that
disagrees rotates the leader. A verdict nobody can agree on leaves contract state
untouched.

## Target Network

| Setting | Value |
| --- | --- |
| Network | Studionet |
| Chain ID | 61999 |
| GenLayer RPC | `https://studio.genlayer.com/api` |
| Explorer | [explorer-studio.genlayer.com](https://explorer-studio.genlayer.com) |
| Currency | GEN (18 decimals) |
| Deploy from | [studio.genlayer.com](https://studio.genlayer.com) |

Studio caveats that shape this project:

- **State is temporary.** If Studio resets, redeploy and update the address.
- **Gasless.** Good for iteration; receipts are not usable as gas benchmarks.
- **No EVM chain layer or ghost contracts.** Balances are simulated in Studio's
  own database. Native value transfers to plain addresses work — which is all
  this contract needs to pay a merchant — but cross-EVM-contract calls would not.

## The Security Argument

The contract does not defer to the model. It uses it, then overrules it.

`submit_request` asks the validators for a judgment, and then applies its own
deterministic checks on top of the answer. A request the validators approved is
demoted to `REJECTED` with `POLICY_OVERRIDE` if the merchant is not allowlisted,
the request duplicates a recent one, or the amount exceeds the per-transaction
limit, the remaining hourly budget, or the treasury balance. An approval below
75% confidence is demoted to `MANUAL_REVIEW`, and so is an approval whose
evidence is narrative-only: requester-supplied text must anchor the purchase to
an independently verifiable artifact (`ticket=`, `quote=`, `invoice=`, a
`sha256:` digest, or a hex/URL reference), and the validators must agree on the
confidence value itself before that 75% threshold can pass.

`execute_payment` then re-checks everything against live state. An approval is a
judgment at a moment in time, not a standing permission — so a merchant
de-allowlisted after approval, a limit lowered after approval, an exhausted
hourly window, an expired request, or a paused treasury all refuse settlement.
The agent's execution authority is bound to a delivery confirmation by the
merchant of record, so an approved narrative alone cannot trigger payment; the
owner keeps an explicit override.

Settlement is finality-safe. `execute_payment` only authorizes: it reserves the
hourly-window debit and moves the record to `PAYMENT_PENDING` while the value
transfer settles on the chain layer. The dapp never reports a funding,
adjudication, configuration change, or payment as successful until the
transaction is `FINALIZED` with a successful execution, and a payment is only
`PAID` once `finalize_payment` confirms the finalized transfer and the resulting
state — recipient, amount, `paidAt`, treasury balance, `totalPaid`, and the
spending-window debit — reconciles. A transfer that never settles can be
unwound with `resolve_pending_payment`, which releases the reservation.

Untrusted merchant text is fenced and explicitly demoted to data in the prompt,
with instruction-like content named as grounds for manual review. That is a
mitigation, not a guarantee: the reason a prompt injection cannot drain the
treasury is the deterministic override, not the prompt engineering.

Detailed flows are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deployed Contract

The Guardian is deployed on Studionet at:

```
0x6FC19feBc5aa3C194C21BEb0C2F085eb9E130d68
```

With `owner` (`0x1eEf8295A36be966D845A040c610c502d41CC78b`) and `authorizedAgent`
(`0xf38D0ee24f71c83c83c99cEEa99158ef61419CFe`) as two separate Studio accounts.
The constructor limits are 0.01 GEN per transaction and 0.05 GEN per one-hour
window, verified through `get_config` after deployment. Deploying again is a
Studio-website action, not a CLI command: paste `contracts/guardian_budget.py`,
fill the three constructor fields, and confirm in `get_config` that the limits
survived the browser intact (they are 17-digit numbers, near JavaScript's
safe-integer edge).

A third account acts as the merchant (`0x369CB3A968C5077E311648F488E755210C138845`
in the verified run). That is not cosmetic: the merchant of record is the only
account that can call `confirm_delivery`, which is what releases the agent's
authority to execute a payment.

The full lifecycle was exercised against this deployment: the treasury was
funded, `svc-1` was approved by real validator consensus at confidence 90 and
risk 20 with the reasoning citing the ticket, quote, and sha256 digest as
substantiation, the agent's `execute_payment` was **refused** until the merchant
confirmed delivery, and the request then moved `APPROVED` → `PAYMENT_PENDING` →
`PAID`, with `totalPaid` moving only at finalization and `pendingTotal`
returning to zero.

## Product Flow

1. The owner deploys the Guardian in Studio; the deploying account becomes the
   owner.
2. The owner funds it with GEN, authorizes an agent, sets limits, and allowlists
   merchants.
3. A merchant or labeled fixture submits a service request with a purpose and
   supporting evidence.
4. Validators adjudicate it inside `submit_request` and the verdict is stored.
5. The contract applies its deterministic policy over the verdict.
6. A rejection is recorded and can never be settled. A manual review waits for an
   owner transaction carrying a written reason.
7. The merchant of record confirms delivery of the verifiable deliverable,
   releasing the agent's authority to pay.
8. The agent authorizes the payment and the contract re-checks the full policy
   before value leaves; the request moves to `PAYMENT_PENDING`.
9. The external transfer finalizes, `finalize_payment` records `PAID` with the
   settlement reference, and the dapp reconciles the resulting state and
   balances. A transfer that never settles is unwound by `resolve_pending_payment`.

## Local Setup

Node.js 20+ and Python 3.12+.

```powershell
npm install

python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

Copy-Item .env.example .env
# set NEXT_PUBLIC_GUARDIAN_CONTRACT to the deployed address
```

Verify everything:

```powershell
npm test          # contract lint + validation, then 73 direct-mode tests
npx tsc --noEmit
npm run build
npm run dev
```

`npm test` runs `scripts/preflight.mjs`, which finds the tooling inside `.venv`
itself — no shell activation needed.

## Testing The Deployed Contract

With the app running and the owner wallet connected:

1. **Fund** the treasury (`0.05` in the Treasury controls panel).
2. **Allowlist** a merchant — a third address.
3. **Submit for adjudication.** This is the slow one: every validator makes a
   real LLM call, so expect tens of seconds before `APPROVED` /
   `VALIDATOR_CONSENSUS` appears.
4. **Confirm delivery as the merchant** (the request's recipient account) with a
   verifiable delivery reference — the agent cannot execute without it.
5. **Execute as the agent or owner.** The request moves to `PAYMENT_PENDING` and
   the transfer settles on the chain layer; nothing is reported as paid yet.
6. **Finalize settlement as the merchant or owner** once the transfer is
   finalized. The record becomes `PAID` with a `paidAt`, and the app reconciles
   the treasury and merchant balances against the resulting state.

Then prove the interesting part — the contract overruling the models:

- **Over-limit:** submit `0.02` (limit is 0.01) → `REJECTED` / `POLICY_OVERRIDE`
- **Duplicate:** resubmit the same merchant + amount + purpose → `POLICY_OVERRIDE`
- **Unallowlisted merchant:** any random address → `POLICY_OVERRIDE`
- **Narrative-only evidence:** evidence with no artifact reference → demoted to
  `MANUAL_REVIEW` even when the model approves
- **Agent without delivery confirmation:** approved request, no merchant
  confirmation → the agent's execute is refused
- **Stale approval:** approve one, de-allowlist the merchant, then execute →
  refused at settlement
- **Pause:** emergency stop, then execute an approved request → refused
- **Failed transfer:** execute (request goes `PAYMENT_PENDING`), then unwind it
  as the merchant or owner → reservation released, request returns to `APPROVED`

In each case the validators may well have approved; the contract refuses anyway.

## Contract Tests

```powershell
npm test                    # lint + 73 direct-mode tests (offline, LLM mocked)
npm run test:integration    # against studionet via RPC (needs a Studio account key)
```

Direct mode runs the contract in-process with mocked LLM replies. It covers
deployment guards, adjudication outcomes, malformed model output, prompt-injection
attempts, every deterministic override, input validation, settlement
authorization, expiry, pause, post-approval policy changes, hourly window
exhaustion and reset, human review, configuration access control, two-step
ownership transfer, the read methods, and validator agreement and disagreement.

## Known Limitations

- No independent security audit. A passing test suite is not an audit.
- Studio state is temporary and gasless — it is a sandbox, not a deployment.
- Prompt-injection resistance is tested against mocked models only. The
  deterministic override is what actually bounds the damage.
- Duplicate detection scans only the most recent 50 requests.
- The request log grows without bound.
- The contract has no upgrade path. A fix means a new deployment and a treasury
  migration.
- Merchant transfers are external messages, so they settle on finalization rather
  than on acceptance.

## Documentation

- [Architecture and flows](docs/ARCHITECTURE.md)
- [Setup and deployment runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [Production readiness checklist](docs/PRODUCTION_READINESS.md)
- [Demo script](docs/DEMO_SCRIPT.md)
