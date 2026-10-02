import { HttpError } from './http.js';
import { providerJson } from './provider-http.js';
import { graderProblem } from '../app/client/grader.mjs';

// Gemini responseSchema is its legacy Schema message, not unrestricted JSON Schema.
// Keep OpenAI/Claude's required additionalProperties:false out of that wire format.
export function geminiSchema(schema) {
  return {
    type: schema.type.toUpperCase(),
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, geminiSchema(value)])) } : {}),
    ...(schema.items ? { items: geminiSchema(schema.items) } : {}),
    ...(schema.required ? { required: schema.required } : {}),
  };
}

export function graderCredentials(body) {
  const provider = body.graderProvider ?? 'gemini';
  const model = body.grader ?? 'gemini-2.5-flash-lite';
  const problem = graderProblem(provider, model, body.graderKey);
  if (problem) throw new HttpError(400, problem);
  return { provider, model, key: body.graderKey.trim() };
}

// Fixed origins and capability presets prevent user-controlled proxy destinations.
// The key is a header, never part of the prompt, URL, output or usage ledger.
export function graderWire(credentials, request, schema) {
  const { provider, model, key } = credentials;
  const system = request.systemInstruction.parts[0].text;
  const content = request.contents[0].parts[0].text;
  if (provider === 'gemini') return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: { ...request, generationConfig: { ...request.generationConfig, responseSchema: geminiSchema(schema) } },
  };
  if (provider === 'openai') return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: { model, messages: [{ role: 'system', content: system }, { role: 'user', content }], temperature: 0, max_completion_tokens: 2048, store: false,
      response_format: { type: 'json_schema', json_schema: { name: 'answer_grades', strict: true, schema } } },
  };
  if (provider === 'claude') return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: { model, system, messages: [{ role: 'user', content }], temperature: 0, max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema } } },
  };
  throw new HttpError(400, 'Choose a supported grader provider in Configure.');
}

const token = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function graderOutput(provider, data) {
  let content, usage, finish, refused;
  if (provider === 'gemini') {
    const candidate = data?.candidates?.[0];
    finish = candidate?.finishReason;
    refused = Boolean(data?.promptFeedback?.blockReason) || (finish && !['STOP', 'MAX_TOKENS'].includes(finish));
    content = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).filter(part => part && !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    usage = { input_tokens: token(data?.usageMetadata?.promptTokenCount), output_tokens: token(data?.usageMetadata?.candidatesTokenCount), reasoning_tokens: token(data?.usageMetadata?.thoughtsTokenCount) };
  } else if (provider === 'openai') {
    const choice = data?.choices?.[0]; finish = choice?.finish_reason;
    refused = Boolean(choice?.message?.refusal) || (finish && !['stop', 'length'].includes(finish));
    content = choice?.message?.content;
    usage = { input_tokens: token(data?.usage?.prompt_tokens), output_tokens: token(data?.usage?.completion_tokens), reasoning_tokens: token(data?.usage?.completion_tokens_details?.reasoning_tokens) };
  } else {
    finish = data?.stop_reason;
    refused = (finish && !['end_turn', 'max_tokens'].includes(finish)) || (Array.isArray(data?.content) ? data.content : []).some(part => part?.type === 'refusal');
    content = (Array.isArray(data?.content) ? data.content : []).filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('');
    usage = { input_tokens: token(data?.usage?.input_tokens), output_tokens: token(data?.usage?.output_tokens), reasoning_tokens: null };
  }
  if (refused) throw new HttpError(502, 'The grader declined or could not finish this comparison. Review your inputs or choose another grader in Configure. No automatic retry was made.');
  if (['MAX_TOKENS', 'length', 'max_tokens'].includes(finish)) throw new HttpError(502, 'The grader reached its response limit. Shorten the comparison or choose another grader in Configure. No automatic retry was made.');
  const terminal = provider === 'gemini' ? 'STOP' : provider === 'openai' ? 'stop' : 'end_turn';
  if (finish !== terminal) throw new HttpError(502, 'The grader did not confirm a completed response. Your answers are preserved. No automatic retry was made.');
  if (typeof content !== 'string' || content.length > 64000) throw new HttpError(502, 'Grader returned no readable scores. Your answers are preserved.');
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new HttpError(502, 'Grader returned unreadable scores. Your answers are preserved. No automatic retry was made.'); }
  return { parsed, usage };
}

export async function callGrader(credentials, request, schema) {
  const wire = graderWire(credentials, request, schema);
  const data = await providerJson(wire.url, { method: 'POST', headers: wire.headers, body: JSON.stringify(wire.body) });
  try { return graderOutput(credentials.provider, data); }
  catch (error) { if (error instanceof HttpError) { error.category = 'invalid_response'; error.upstreamStatus = 200; } throw error; }
}
