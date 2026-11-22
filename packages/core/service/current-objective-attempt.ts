// Both expressions are correlated to the outer objective (alias o).
export const activeObjectiveAttemptSql =
  "o.state IN ('launching', 'executing', 'pending_delivery')";

// Choose the attempt before interpreting its provider metadata. In particular,
// a newer direct launch supersedes a mapped terminal from an older attempt.
export const latestObjectiveAttemptIdSql = `SELECT attempt.id FROM execution_requests attempt
  WHERE attempt.objective_id = o.id AND attempt.deleted_at IS NULL
    AND attempt.requested_source <> 'local_target_mutation'
  ORDER BY attempt.created_at DESC, attempt.id DESC LIMIT 1`;
