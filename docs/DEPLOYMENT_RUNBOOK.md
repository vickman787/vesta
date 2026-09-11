# Setup, Testing, And Deployment Runbook

This runbook covers the local toolchain, the test layers, and deploying the
Guardian Intelligent Contract to Studio.

## Target Network

The app and the deployed contract live on **Studionet** (GenLayer Studio).

| Setting | Value |
| --- | --- |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` |
| Currency | GEN (18 decimals) |
| Deploy from | `https://studio.genlayer.com` |

Studio is a hosted sandbox: state is temporary, transactions are gasless, and
balances are simulated in Studio's own database. It is a build-and-demo
environment, not a production deployment. There is no EVM chain layer and no
ghost contracts; EVM-contract interaction beyond value transfers to plain
addresses is not supported. Native value transfers to addresses — the one thing
this contract needs to pay a merchant — do work, but because the transfer is an
external message that settles on finalization, the contract keeps the request in
`PAYMENT_PENDING` until `finalize_payment` confirms it, and verification should
include reading the recipient's balance after finalization, as Studio does not
model the chain layer.

GenLayer mainnet is not live (`genlayer-js` rejects `mainnet` as a network).

## Local Setup

Node.js 20+ and Python 3.12+.

```powershell
npm install

python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

Copy-Item .env.example .env
# set NEXT_PUBLIC_GUARDIAN_CONTRACT to the deployed address
```

Keep secrets in `.env`, which is ignored. Never place a funded key in a tracked
file.

### Windows notes

`genlayer-test` injects the transaction message by unlinking an open temporary
file, which POSIX permits and Windows does not. `tests/conftest.py` re-implements
that step to defer deletion until interpreter exit. Remove the shim once upstream
handles Windows natively.

`genvm-lint` writes non-ASCII status glyphs, so `PYTHONIOENCODING=utf-8` is needed
under PowerShell. `scripts/preflight.mjs` sets it for you.

## Test Layers

```powershell
npm test            # 1. contract lint + validation, then 79 direct-mode tests
npx tsc --noEmit    # 2. application typecheck
npm run build       # 3. production build
```

`npm test` runs `scripts/preflight.mjs`, which locates the tooling inside `.venv`
directly — no shell activation required. The first `genvm-lint check` downloads a
~130 MB GenVM runner bundle and caches it under `~/.cache/genvm-linter`. Pin the
release with `GENVM_VERSION` for reproducibility.

Direct-mode coverage: deployment guards, adjudication outcomes, malformed model
output, prompt-injection attempts, every deterministic override, input validation,
settlement authorization, expiry, pause, post-approval policy changes, hourly
window exhaustion and reset, human review, configuration access control, two-step
ownership transfer, views, and validator agreement and disagreement.

### Integration tests

Direct mode mocks the LLM, so it proves the plumbing and the policy but not real
consensus. The integration suite deploys a throwaway contract and drives it over
RPC:

```powershell
# Set a Studio account key in .env first:
#   ACCOUNT_PRIVATE_KEY_1=<private key of a Studio account>
npm run test:integration
```

## Deploying From Studio

Deployment is a Studio-website action. Before deploying a new contract revision,
run `npm test` so a contract that does not lint or whose tests fail never reaches
the network.

1. Open [studio.genlayer.com](https://studio.genlayer.com).
2. In Studio's account selector, create two accounts:
   - **Account 1** — the deployer. Becomes the **owner**: sets policy, pauses,
      withdraws, rotates the agent.
   - **Account 2** — the **agent**. May execute already-approved payments, and
      only after the merchant confirms delivery.
   - Create a **third account** later to act as a merchant to receive a payment.
3. Load `contracts/guardian_budget.py` and fill the constructor fields:

   | Field | Value |
   | --- | --- |
   | `authorized_agent` | Account 2's address |
   | `per_transaction_limit` | `10000000000000000` (0.01 GEN) |
   | `hourly_limit` | `50000000000000000` (0.05 GEN) |
   | `settlement_verifier_url` | an http(s) URL template containing `{tx}`, e.g. `https://explorer-studio.genlayer.com/api/transactions/{tx}` |

   Owner and agent must be separate accounts — the whole design depends on it.
   `per_transaction_limit` must not exceed `hourly_limit`, and neither may be
   zero. An empty agent, zero limits, or a verifier URL without `{tx}` reverts
   the deploy. The verifier URL must be reachable from the network the
   validators run on and must return the transfer's status, sender, recipient,
   and amount — the validators fetch it to confirm finalization.
4. Confirm the limits in `get_config` after deploying. They are 17-digit numbers
   near JavaScript's safe-integer edge; the browser could in principle mangle
   them, so verify they come back as the exact strings above.
5. Record the address. If Studio resets, redeploy and update
   `NEXT_PUBLIC_GUARDIAN_CONTRACT`.

The deployed address can be verified independently by calling `get_config` over
RPC with the SDK — see `scripts/` or a throwaway genlayer-py client.

## Post-Deployment Validation

With the app running (`npm run dev`) and the owner wallet connected:

1. Fund the treasury (0.05 GEN).
2. Allowlist a merchant.
3. As the merchant, commit the artifact digest your evidence will cite
   (`commit_artifact`), then submit a request whose evidence carries
   `digest=sha256:<that digest>` and wait for `APPROVED` /
   `VALIDATOR_CONSENSUS` — each validator makes a real LLM call, so this takes
   tens of seconds.
4. As the merchant account, confirm delivery, then execute as the agent or
   owner. The request goes `PAYMENT_PENDING` — the app reports nothing as paid
   yet.
5. Anyone may finalize: submit the transfer identifier, and the validators fetch
   its receipt from `settlement_verifier_url` and confirm it finalized with this
   contract, the merchant, and the amount before the request becomes `PAID` with
   a `paidAt`. Confirm the treasury debited and the merchant balance increased by
   exactly the amount. A transfer that never settled is unwound with
   `resolve_pending_payment`.
6. Exercise the rejection paths: over-limit, duplicate, unallowlisted merchant,
   narrative-only evidence, a digest the merchant never committed, a fetched
   artifact whose contents do not match the digest, an agent trying to execute
   without the merchant's delivery confirmation, stale approval (de-allowlist
   after approval), and pause.

## Evidence To Capture

Do not fill these in from memory.

- Contract address and its explorer page
- Deploy transaction
- Treasury funding transaction
- An adjudicated approval, showing the validator verdict recorded on-chain
- A `POLICY_OVERRIDE` rejection of a model-approved request
- A narrative-only evidence demotion to `MANUAL_REVIEW`
- A settlement refused after a post-approval policy change
- A pause/resume cycle
- A `PAYMENT_PENDING` authorization followed by its finalized `PAID` record,
  with the settlement reference
- A finalized payment and the merchant's balance read matching the debit

## Stop Conditions

Stop and review when the contract revision, constructor arguments, or ownership
does not match intent; when tests are missing or failing; when a secret appears
tracked or logged; when RPC responses are inconsistent; or when Studio state
resets and the recorded address no longer resolves.
