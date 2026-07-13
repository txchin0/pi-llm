export type JudgeCriterionResult = {
  id: number;
  pass: boolean;
  reason: string;
};

export type JudgeResult =
  | { status: 'ok'; score: number; criteria: JudgeCriterionResult[]; raw: string }
  | { status: 'error'; raw: string }
  | { status: 'skipped' };

export type JudgeOptions = {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  /** Rubric criteria, one plain-language statement per entry. */
  rubric: string[];
  /** Scenario transcript and evidence to grade against the rubric. */
  transcript: string;
};

/** Caps a judge input section so the grading prompt fits small context windows. */
export function truncateForJudge(text: string, maxChars = 2000): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n[truncated]`;
}

/**
 * Grades a scenario transcript against rubric criteria via the OpenAI-compatible
 * chat endpoint. Never throws: failures come back as `{ status: 'error' }` so
 * judge problems never fail a test on their own.
 */
export async function runJudge(options: JudgeOptions): Promise<JudgeResult> {
  const criteriaLines = options.rubric
    .map((criterion, index) => `${index + 1}. ${criterion}`)
    .join('\n');

  const systemPrompt = [
    'You are grading an AI assistant\'s behavior in an automated test scenario.',
    'Evaluate each criterion strictly against the transcript below. Require',
    'concrete evidence for a pass; do not give the benefit of the doubt.',
    '',
    'Criteria:',
    criteriaLines,
    '',
    'Respond with ONLY a JSON object, no prose, in exactly this shape:',
    '{"criteria":[{"id":1,"pass":true,"reason":"short evidence"}],"score":0}',
    'Keep each reason under 12 words. "score" is the overall quality on a',
    '0-100 scale (100 = every criterion clearly satisfied).',
  ].join('\n');

  let content: string;
  try {
    const response = await fetch(
      `${options.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.modelId,
          temperature: 0,
          max_tokens: 768,
          // Thinking models spend the whole token budget on reasoning and
          // return an empty content field; llama.cpp honors this toggle.
          chat_template_kwargs: { enable_thinking: false },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: options.transcript },
          ],
        }),
      },
    );

    if (!response.ok) {
      return { status: 'error', raw: `judge request returned HTTP ${response.status}` };
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    content = body.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    return {
      status: 'error',
      raw: error instanceof Error ? error.message : 'judge request failed',
    };
  }

  return parseJudgeContent(content);
}

/** Extracts and validates the judge's JSON verdict from raw model output. */
export function parseJudgeContent(content: string): JudgeResult {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { status: 'error', raw: content };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return { status: 'error', raw: content };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 'error', raw: content };
  }

  const record = parsed as { score?: unknown; criteria?: unknown };
  if (typeof record.score !== 'number' || !Number.isFinite(record.score)) {
    return { status: 'error', raw: content };
  }

  const criteria: JudgeCriterionResult[] = [];
  if (Array.isArray(record.criteria)) {
    for (const entry of record.criteria) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const item = entry as { id?: unknown; pass?: unknown; reason?: unknown };
      criteria.push({
        id: typeof item.id === 'number' ? item.id : criteria.length + 1,
        pass: item.pass === true,
        reason: typeof item.reason === 'string' ? item.reason : '',
      });
    }
  }

  const score = Math.min(100, Math.max(0, Math.round(record.score)));
  return { status: 'ok', score, criteria, raw: content };
}
