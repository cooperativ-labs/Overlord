import type { ReconcileInput, ReconcileResult } from './types';

export function reconcileEngineAssignments(input: ReconcileInput): ReconcileResult {
  const desiredEngineTagKeys = new Set(
    input.candidates.filter(candidate => candidate.matched).map(candidate => candidate.tagKey)
  );
  const suppressedTagKeys = new Set(input.suppressions.map(item => item.tagKey));
  const existingEngineTagKeys = new Set(
    input.existingAssignments.filter(item => item.source === 'engine').map(item => item.tagKey)
  );
  const userOwnedTagKeys = new Set(
    input.existingAssignments.filter(item => item.source === 'user').map(item => item.tagKey)
  );

  const addEngineTagKeys = [...desiredEngineTagKeys]
    .filter(tagKey => !suppressedTagKeys.has(tagKey))
    .filter(tagKey => !existingEngineTagKeys.has(tagKey))
    .sort();

  const removeEngineTagKeys = [...existingEngineTagKeys]
    .filter(tagKey => !desiredEngineTagKeys.has(tagKey) || suppressedTagKeys.has(tagKey))
    .sort();

  const keptEngineTagKeys = [...existingEngineTagKeys]
    .filter(tagKey => desiredEngineTagKeys.has(tagKey) && !suppressedTagKeys.has(tagKey))
    .sort();

  return {
    addEngineTagKeys,
    removeEngineTagKeys,
    keptEngineTagKeys,
    suppressedTagKeys: [...suppressedTagKeys].sort(),
    userOwnedTagKeys: [...userOwnedTagKeys].sort()
  };
}
