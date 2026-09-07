import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessReceipt, isFinalizedSuccess } from '../lib/receipt-outcome';

describe('receipt outcome assessment', () => {
  it('treats FINALIZED with a successful execution as the only success', () => {
    assert.equal(isFinalizedSuccess('FINALIZED', 'FINISHED_WITH_RETURN'), true);
    assert.equal(
      assessReceipt('FINALIZED', 'FINISHED_WITH_RETURN').category,
      'success',
    );
  });

  it('never treats ACCEPTED as success — the accepted-to-appealed window is open', () => {
    const assessment = assessReceipt('ACCEPTED', 'FINISHED_WITH_RETURN');
    assert.equal(assessment.success, false);
    assert.equal(assessment.category, 'not-final');
    assert.match(assessment.message, /appealed or reverted/);
  });

  it('reports an in-flight appeal as not final', () => {
    for (const status of ['APPEAL_REVEALING', 'APPEAL_COMMITTING', 'READY_TO_FINALIZE']) {
      const assessment = assessReceipt(status, 'FINISHED_WITH_RETURN');
      assert.equal(assessment.success, false, status);
      assert.equal(assessment.category, 'not-final', status);
    }
  });

  it('reports a receipt that was appealed and reverted to CANCELED as a failure', () => {
    // Simulates: ACCEPTED, then APPEAL_COMMITTING, then CANCELED.
    const assessment = assessReceipt('CANCELED', 'FINISHED_WITH_RETURN');
    assert.equal(assessment.success, false);
    assert.equal(assessment.category, 'failed-terminal');
  });

  it('reports UNDETERMINED and validator timeouts as failures, never success', () => {
    for (const status of ['UNDETERMINED', 'VALIDATORS_TIMEOUT', 'LEADER_TIMEOUT']) {
      const assessment = assessReceipt(status, 'FINISHED_WITH_RETURN');
      assert.equal(assessment.success, false, status);
      assert.equal(assessment.category, 'failed-terminal', status);
    }
  });

  it('reports a FINALIZED transaction whose execution failed as an error', () => {
    const assessment = assessReceipt('FINALIZED', 'FINISHED_WITH_ERROR');
    assert.equal(assessment.success, false);
    assert.equal(assessment.category, 'execution-error');
  });

  it('reports a FINALIZED transaction with no recorded result as inconclusive', () => {
    for (const result of [undefined, 'NOT_VOTED']) {
      const assessment = assessReceipt('FINALIZED', result);
      assert.equal(assessment.success, false, String(result));
      assert.equal(assessment.category, 'inconclusive', String(result));
    }
  });

  it('reports a receipt with no status as inconclusive', () => {
    const assessment = assessReceipt(undefined, 'FINISHED_WITH_RETURN');
    assert.equal(assessment.success, false);
    assert.equal(assessment.category, 'inconclusive');
  });
});
