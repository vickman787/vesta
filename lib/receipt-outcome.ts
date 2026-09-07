/**
 * Receipt outcome assessment for GenLayer transactions.
 *
 * Pure and dependency-free so the accepted -> appealed / reverted receipt path
 * can be unit-tested without a client or a network. Success is defined
 * narrowly: a transaction only counts as successful once it is FINALIZED with
 * an execution result that is not an error, and never on mere acceptance. An
 * accepted transaction can still be appealed into a CANCELED or UNDETERMINED
 * outcome, or time out — none of those is a success.
 */

export type ReceiptCategory =
  | 'success'
  | 'not-final'
  | 'failed-terminal'
  | 'execution-error'
  | 'inconclusive';

export type ReceiptAssessment = {
  success: boolean;
  category: ReceiptCategory;
  message: string;
};

/** Statuses that mean the consensus run ended without finalizing. */
export const TERMINAL_FAILURE_STATES: ReadonlySet<string> = new Set([
  'UNDETERMINED',
  'CANCELED',
  'VALIDATORS_TIMEOUT',
  'LEADER_TIMEOUT',
  'UNINITIALIZED',
]);

/** Statuses that are not terminal but are not FINALIZED either. */
export const UNFINALIZED_STATES: ReadonlySet<string> = new Set([
  'PENDING',
  'PROPOSING',
  'COMMITTING',
  'REVEALING',
  'ACCEPTED',
  'READY_TO_FINALIZE',
  'APPEAL_REVEALING',
  'APPEAL_COMMITTING',
]);

const SUCCESS_EXECUTION = 'FINISHED_WITH_RETURN';
const ERROR_EXECUTION = 'FINISHED_WITH_ERROR';
const NO_RESULT_EXECUTION = 'NOT_VOTED';

/**
 * Assess a finalized receipt.
 *
 * `statusName` and `executionResultName` are the values genlayer-js surfaces on
 * a transaction receipt. Anything short of FINALIZED — including ACCEPTED, an
 * in-flight appeal, or a reverted outcome — is not a success.
 */
export function assessReceipt(
  statusName: string | undefined,
  executionResultName: string | undefined,
): ReceiptAssessment {
  if (!statusName) {
    return {
      success: false,
      category: 'inconclusive',
      message: 'The receipt carried no status, so no state change is confirmed.',
    };
  }
  if (TERMINAL_FAILURE_STATES.has(statusName)) {
    const message =
      statusName === 'UNDETERMINED'
        ? 'Validators could not agree on this transaction, so it did not change contract state.'
        : `The transaction ended in ${statusName} without finalizing.`;
    return { success: false, category: 'failed-terminal', message };
  }
  if (statusName !== 'FINALIZED') {
    const message =
      UNFINALIZED_STATES.has(statusName)
        ? `The transaction is ${statusName}, not FINALIZED. It can still be appealed or reverted, so its state change is not confirmed.`
        : `The transaction ended in ${statusName} without finalizing.`;
    return { success: false, category: 'not-final', message };
  }

  // FINALIZED: the execution result decides success.
  if (executionResultName === SUCCESS_EXECUTION) {
    return {
      success: true,
      category: 'success',
      message: 'Transaction finalized with a successful execution.',
    };
  }
  if (executionResultName === ERROR_EXECUTION) {
    return {
      success: false,
      category: 'execution-error',
      message: 'Transaction finalized but the execution failed.',
    };
  }
  return {
    success: false,
    category: 'inconclusive',
    message:
      'The transaction finalized without a confirmed execution result, so no state change is reported as successful.',
  };
}

/** True only when a transaction is FINALIZED and did not fail in execution. */
export function isFinalizedSuccess(
  statusName: string | undefined,
  executionResultName: string | undefined,
): boolean {
  return assessReceipt(statusName, executionResultName).success;
}
