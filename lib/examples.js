import { HttpError } from "./http.js";

const models = ["Qwen/Qwen3-4B-Instruct-2507", "meta-llama/Llama-3.1-8B-Instruct"];
const prompts = [
  { id: "movie-finale", prompt: "Which is the best Avengers movie and why?", reference: "" },
  { id: "movie-romance", prompt: "Recommend a romantic movie. Give three distinct reasons and one caveat, under 120 words.", reference: "" },
  { id: "movie-director", prompt: "Who directed Inception (2010)? Answer with the name only.", reference: "Christopher Nolan" },
];
const answers = {
  "movie-finale": ["Avengers: Endgame is my pick for its payoff to long-running character arcs, the stakes of its final confrontation, and its farewell to several central heroes. That is a subjective preference; The Avengers is a stronger choice if you prefer a simpler, self-contained team story.", "The Avengers is my pick: it introduces the team dynamic clearly, balances humor with conflict, and works without following as many earlier stories. This is a subjective choice, rather than a factual ranking."],
  "movie-romance": ["Try Before Sunrise. Its natural conversations build a believable connection; its single-night structure gives the relationship urgency; and Vienna provides a memorable setting. Caveat: the quiet, dialogue-driven pace may not suit viewers seeking a plot-heavy romance.", "Try Before Sunrise for its thoughtful conversations, charming Vienna setting, and focus on two people learning about one another. Caveat: it is more reflective than action-packed."],
  "movie-director": ["Christopher Nolan", "Christopher Nolan"],
};
export const EXAMPLE = Object.freeze({
  id: "prepared-movie-comparison-v1", title: "Compare movie answers", description: "Prepared answers and illustrative scores. No models are called and this is not a live benchmark.",
  settings: { models, system: "You are a helpful assistant. Answer clearly with specific reasons. If a reference is supplied, use only the reference and say when it does not contain the answer.", corpus: "", placement: "user", maxTokens: 300, temperature: 0, grader: "gemini-2.5-flash-lite" }, prompts,
});

export function examplePrompt(body) {
  if (body.example_id !== EXAMPLE.id) throw new HttpError(400, "Unknown prepared example.");
  const prompt = prompts.find(value => value.id === body.prompt_id);
  if (!prompt) throw new HttpError(400, "Unknown prepared prompt.");
  return prompt;
}
export function preparedGeneration(body) {
  const prompt = examplePrompt(body); const index = models.indexOf(body.model);
  if (index < 0) throw new HttpError(400, "This model is not part of the prepared example.");
  return { text: answers[prompt.id][index], finish: "stop", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, servedModel: body.model, ms: 0, attempts: 0, cached: true, provider: "prepared", example_id: EXAMPLE.id };
}
export function preparedGrade(body) {
  const prompt = examplePrompt(body);
  const scores = Object.fromEntries(models.map((model, index) => {
    const accuracy = prompt.id === "movie-director" ? 10 : 9;
    const helpfulness = prompt.id === "movie-director" ? 10 : 9 - index;
    const format = 10;
    return [model, { accuracy, helpfulness, format, overall: Math.round((accuracy + helpfulness + format) / 3 * 10) / 10, reason: "Illustrative prepared score; no grader was called." }];
  }));
  return { grader: "Prepared example — no grader call", scores, best: models[0], ranking: models, returnedLabels: ["A", "B"], ms: 0, usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }, cached: true, provider: "prepared", example_id: EXAMPLE.id };
}
