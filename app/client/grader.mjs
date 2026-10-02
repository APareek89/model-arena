// Public capability presets only. Credentials never belong in saved settings.
export const GRADER_PROVIDERS = [
  { id: 'gemini', name: 'Gemini', models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] },
  { id: 'openai', name: 'OpenAI', models: ['gpt-4.1-mini', 'gpt-4.1-nano'] },
  { id: 'claude', name: 'Claude', models: ['claude-haiku-4-5', 'claude-sonnet-4-5'] },
];

export function graderSelection(provider, model) {
  return GRADER_PROVIDERS.find(item => item.id === provider)?.models.includes(model) === true;
}

export function graderProblem(provider, model, key) {
  if (!graderSelection(provider, model)) return 'Choose a supported grader provider and model in Configure.';
  if (typeof key !== 'string' || !key.trim()) return 'Add your grader API key in Configure. Your completed answers are ready to grade.';
  if (key.trim().length < 8 || key.trim().length > 4096 || !/^[\x21-\x7e]+$/.test(key.trim())) return 'Enter a valid API key without spaces or line breaks in Configure.';
  return null;
}

export function finishWarning(finish) {
  if (finish === 'length' || finish === 'max_tokens') return 'Answer stopped at the token limit. Increase Max new tokens and run again for a complete answer; grading uses the visible partial answer.';
  if (finish && finish !== 'stop') return `The provider stopped this answer (${finish}). Inspect it before grading.`;
  return null;
}
