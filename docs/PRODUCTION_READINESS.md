# Production Readiness Checklist

GenLayer mainnet is not live — `genlayer-js` rejects `mainnet` as a network — so
this project runs on **Studionet**. This checklist therefore covers what has been
demonstrated on Studio, and the additional work that would be required before
real funds, on any network, are placed under this contract's control.

Studio state is temporary and gasless, so none of what works there is production
evidence. Everything below that matters for real funds is unverified.

## Product And Evidence

- [x] The Intelligent Contract is implemented and passes `genvm-lint check`.
- [x] Direct-mode tests cover adjudication, every deterministic override,
      narrative-only evidence, artifact-registry verification (requester-typed
      vs merchant-committed digests), delivery-confirmed agent execution, the
      finality-safe `PAYMENT_PENDING` -> `PAID` lifecycle, owner-only
      finalization, failed-transfer unwinding, expiry during finalization,
      confidence-based validator agreement, window accounting, human review,
      access control, and validator agreement and disagreement.
- [x] Receipt finality tests cover the accepted -> appealed / reverted receipt
      path: ACCEPTED is never success, an in-flight appeal is not final, and
      CANCELED, UNDETERMINED, timeouts, and finalized-execution failures are all
      reported as failures (node test runner, wired into `npm test`).
- [x] Contract deployed on Studionet (`0xAaa55C41AC58f1E3Dec6EBDd5323eA010f89EE04`),
      with owner and agent as separate accounts, and the constructor limits
      confirmed through `get_config`.
- [x] End-to-end happy path demonstrated on Studio against this revision:
      funding, an adjudicated approval by real validators (`svc-2`, confidence
      90, risk 12, merchant-committed digest verified), a merchant delivery
      confirmation, and a finalized payment with the treasury debited and the
      merchant balance read matching.
- [ ] `POLICY_OVERRIDE` rejection of a model-approved request, demonstrated live.
- [ ] Narrative-only evidence and an uncommitted digest demoted to
      `MANUAL_REVIEW`, demonstrated live.
- [x] An agent refused for lack of a merchant delivery confirmation, demonstrated
      live: `execute_payment` reverted before `confirm_delivery`, then succeeded
      after it.
- [x] A `PAYMENT_PENDING` record finalized into `PAID`, demonstrated live with a
      settlement reference, `pendingTotal` returning to zero and `totalPaid`
      moving only at finalization.
- [ ] Settlement refused after a post-approval policy change, demonstrated live.
- [ ] Pause/resume cycle, demonstrated live.
- [ ] Integration tests pass against a live network (`npm run test:integration`).
- [ ] Hosted demo and repository URLs are verified, or marked unavailable.

## Testing And Security

- [ ] Reproducible install, linter, direct-mode suite, `tsc`, and production
      build all pass at the release revision.
- [ ] Adversarial prompt-injection cases are tested against a real model, not
      only against a mock. Direct-mode tests prove the deterministic override
      holds; they do not prove the model resists manipulation.
- [ ] Consensus behaviour is measured on a live network: how often validators
      disagree on borderline requests, and what fraction of transactions end
      undetermined.
- [ ] Risk-score tolerance and the confidence floor are tuned against observed
      model behaviour rather than assumed.
- [ ] Dependency review and tracked-secret scan are clean.
- [ ] Independent audit status is stated accurately. No audit has been performed;
      until one has, treasury value and limits stay small and no audit claim is
      made.
- [ ] Threat model covers owner-key, agent-key, validator, RPC, frontend, and
      merchant compromise.

## Contract Design Review

- [ ] The duplicate-detection scan window (last 50 requests) is reviewed against
      expected request volume. A high-volume treasury can push an equivalent
      request out of scan range.
- [ ] Unbounded growth of `request_ids` is reviewed against expected lifetime
      volume and storage cost.
- [ ] The `on='finalized'` timing of merchant transfers is acceptable to the
      merchants being onboarded.
- [ ] Upgradability posture is decided explicitly: this contract has no upgrade
      path, so a fix means a new deployment and a treasury migration.

## Configuration And Ownership

- [ ] The owner account is not the authorized agent.
- [ ] Owner and agent keys are separate, protected, and rotatable.
- [ ] Neither key is ever exposed to a prompt, a log, or the browser.
- [ ] Limits and the initial treasury balance are reviewed as concrete values.
- [ ] Deployment records for each network are kept separately and are not
      overwritten.

## Operations

- [ ] Gas usage is measured from real receipts, including the cost of an
      `submit_request` with its LLM calls.
- [ ] Monitoring covers treasury balance, settlements, rejections, undetermined
      transactions, pauses, policy changes, and agent rotation.
- [ ] A pause operator and an escalation path are assigned.
- [ ] Initial validation uses minimal value and conservative limits.

## Approval And Broadcast

- [ ] The owner reviews the exact network, command, signer, contract revision,
      and constructor arguments before any key is unlocked.
- [ ] The owner explicitly approves each key-use batch. Deployment approval is
      not blanket authorization for funding and configuration.
- [ ] The deploy receipt is confirmed accepted, and the execution result checked,
      before funding.
- [ ] Explorer links are published only after receipts are verified.

## Exit Criteria

- [ ] Approved and rejected scenarios behave as expected on the target network
      with minimal value at risk.
- [ ] The owner can pause, rotate the agent, and withdraw under the contract's
      rules.
- [ ] Public documentation names real deployed addresses and does not overstate
      audit, availability, or consensus behaviour.
- [ ] A post-launch review is scheduled before limits or treasury value rise.
