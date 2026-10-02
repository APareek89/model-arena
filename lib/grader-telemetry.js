import { randomUUID } from 'node:crypto';
import { graderSelection } from '../app/client/grader.mjs';

// Explicit allowlist only: never serialize the request, error, key, message or stack.
export function recordGraderFailure(provider, model, error) {
  const requestId = randomUUID();
  const known = graderSelection(provider, model);
  const categories = ['upstream_http', 'timeout', 'network', 'invalid_response'];
  const record = {
    event: 'arena_grader_failure', requestId,
    provider: known ? provider : 'unknown', model: known ? model : 'unknown',
    category: categories.includes(error?.category) ? error.category : error?.status === 502 ? 'invalid_response' : 'internal',
    upstreamStatus: Number.isInteger(error?.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599 ? error.upstreamStatus : null,
  };
  try { console.warn(JSON.stringify(record)); } catch { /* Telemetry must not mask the original failure. */ }
  return requestId;
}
