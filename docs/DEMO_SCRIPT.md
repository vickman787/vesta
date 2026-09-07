# GEN Treasury Guardian Demo Script

**Target duration:** 2-4 minutes
**Status:** rehearsal script. Do not describe the product as deployed, public, or
audited unless current evidence supports each statement.

## Before Recording

- Use GenLayer Studio (studionet, chain `61999`). Show the network and chain ID
  in the footer.
- Prepare a funded treasury, one allowlisted merchant, and an explorer tab.
- Label merchant requests as fixtures when they are fixtures.
- Never show private keys, seed phrases, or unredacted environment files.
- Do not manufacture transaction hashes. If the deployment does not exist, say
  so rather than implying settlement.
- Adjudication takes real time: the leader and every validator each make an LLM
  call. Expect tens of seconds per `submit_request`, and do not cut the wait in
  a way that implies it is instant.

## Script

**0:00-0:25 — Problem and thesis**

"AI agents can buy compute, data, and software, but an unrestricted wallet turns
a model error or a compromised workflow into direct financial loss. Vesta splits
the judgment from the authority. Validator consensus decides whether a purchase
is justified; the contract decides whether it is permitted."

Show the operations console, not a marketing page.

**0:25-0:50 — Network and treasury**

Connect the wallet. Show the network, the contract address, the GEN balance, the
owner, the authorized agent, the per-transaction limit, the hourly window, and
the pause state — all read from the contract.

Say: "There is no server and no database here. The contract holds the requests,
the decisions, and the funds. This dashboard is a view over three read methods."

**0:50-1:45 — Adjudicated approval**

Submit a request to the allowlisted merchant with a real purpose and evidence
that cites a sha256 digest the merchant committed on-chain. While it runs, explain
what is happening: the leader asks its model for a structured judgment; every
validator asks its own model the same question and compares the decision, the
risk score, and the confidence that gates autonomous approval. Disagreement
rotates the leader.

Show the recorded decision: the verdict, the risk score, the confidence, the
reasoning, and `VALIDATOR_CONSENSUS` as the provenance. Then, as the merchant,
confirm delivery of the deliverable; execute as the agent (the request goes
`PAYMENT_PENDING`, not `PAID` — nothing is reported as paid at acceptance); and,
as the owner, verify that the transfer was observed to finalize and the state
reconciles, then finalize. Show the request become `PAID` with its `paidAt` and
the observed settlement reference, and open the explorer receipt.

Say: "The verdict is on-chain, not in a log file. The approval is not a standing
permission — execution re-checks every limit against live state, the agent
cannot pay on a narrative alone, requester-typed evidence is not verification,
and a payment is only reported paid after its transfer is observed to finalize
and reconciled."

**1:45-2:15 — The contract overruling the model**

Submit a request over the per-transaction limit, or to a merchant that is not
allowlisted. Show `REJECTED` with `POLICY_OVERRIDE` and the deterministic reason.

Say: "The validators may well have approved this. The contract rejected it
anyway. That ordering is the entire security argument: judgment is an input to
policy, never a bypass of it."

**2:15-2:45 — Stale approval and emergency control**

Take an approved request. De-allowlist the merchant, then try to settle it —
refused. Then pause the treasury and try again — refused for a second reason.

Say: "The owner can halt autonomous spending independently of the validators and
the agent. Anything already approved still has to pass policy at settlement."

**2:45-3:15 — Human review and the audit trail**

Show a request in `MANUAL_REVIEW` — either a low-confidence approval that the
contract downgraded, or one where the evidence did not substantiate the value.
Approve it as the owner with a written reason, and point out that the reason is
stored on-chain alongside the original verdict.

Say: "Owner review overturns the model, not the policy. An owner-approved
request is still subject to every limit."

## Short Version

For a two-minute cut, keep the thesis, the network read, one adjudicated
approval with an explorer receipt, and one `POLICY_OVERRIDE` rejection. Do not
remove the deployment-status labels.
