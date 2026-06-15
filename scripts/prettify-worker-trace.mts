import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

type TraceEnvelope = {
  seq?: number;
  at?: string;
  task_id?: string;
  user_id?: string;
  session_id?: string | null;
  retry_count?: number;
  type: string;
};

type TraceRecord = TraceEnvelope & Record<string, unknown>;

type ToolContentBlock = { type?: string; text?: string };

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

/** Parses CLI args and returns the trace file path plus render options. */
function parseArgs(argv: string[]): { filePath: string; color: boolean; raw: boolean } {
  const args = argv.slice(2);
  let color = process.stdout.isTTY === true;
  let raw = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--no-color') {
      color = false;
      continue;
    }

    if (arg === '--color') {
      color = true;
      continue;
    }

    if (arg === '--raw') {
      raw = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }

    positional.push(arg);
  }

  if (positional.length !== 1) {
    printHelp();
    process.exit(positional.length === 0 ? 1 : 1);
  }

  return { filePath: positional[0]!, color, raw };
}

/** Prints usage for the prettify script. */
function printHelp(): void {
  process.stdout.write(`Usage: npx tsx scripts/prettify-worker-trace.mts <trace.jsonl> [options]

Options:
  --no-color   Disable ANSI colors
  --color      Force ANSI colors
  --raw        Show full JSON for tool input/output instead of summaries
  -h, --help   Show this help
`);
}

/** Wraps text with an ANSI style when color output is enabled. */
function paint(text: string, style: string, color: boolean): string {
  return color ? `${style}${text}${ANSI.reset}` : text;
}

/** Formats an ISO timestamp as HH:MM:SS.mmm for compact log lines. */
function formatTime(iso: string | undefined): string {
  if (!iso) {
    return '??:??:??.???';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

/** Indents each line of a multiline string. */
function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${pad}${line}` : ''))
    .join('\n');
}

/** Pretty-prints JSON with stable indentation. */
function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Extracts human-readable text from Pi tool result content blocks. */
function extractToolText(output: unknown): string | undefined {
  if (typeof output === 'string') {
    return output;
  }

  if (!output || typeof output !== 'object') {
    return undefined;
  }

  const record = output as Record<string, unknown>;
  const content = record.content;

  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content
    .filter((block): block is ToolContentBlock => block != null && typeof block === 'object')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .filter((text) => text.length > 0);

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join('\n');
}

/** Extracts optional diff/patch details from a tool result payload. */
function extractToolDetails(output: unknown): { diff?: string; patch?: string } {
  if (!output || typeof output !== 'object') {
    return {};
  }

  const details = (output as Record<string, unknown>).details;
  if (!details || typeof details !== 'object') {
    return {};
  }

  const record = details as Record<string, unknown>;
  return {
    diff: typeof record.diff === 'string' ? record.diff : undefined,
    patch: typeof record.patch === 'string' ? record.patch : undefined,
  };
}

/** Renders one prefix label with sequence and timestamp. */
function linePrefix(record: TraceRecord, color: boolean): string {
  const seq = typeof record.seq === 'number' ? String(record.seq).padStart(4, ' ') : '   ?';
  const time = paint(formatTime(typeof record.at === 'string' ? record.at : undefined), ANSI.dim, color);
  return paint(seq, ANSI.dim, color) + paint(' │ ', ANSI.dim, color) + time + paint(' │ ', ANSI.dim, color);
}

/** Renders the run_start header block. */
function renderRunStart(record: TraceRecord, color: boolean): string[] {
  const lines: string[] = [];
  const title = paint('WORKER TRACE', ANSI.bold + ANSI.cyan, color);
  const fileHint = basename(process.argv[2] ?? 'trace.jsonl');

  lines.push(`${title} ${paint(fileHint, ANSI.dim, color)}`);
  lines.push(paint('─'.repeat(72), ANSI.dim, color));

  if (typeof record.description === 'string') {
    lines.push(`${paint('Task', ANSI.bold, color)}: ${record.description}`);
  }

  const meta: string[] = [];
  if (typeof record.task_id === 'string') {
    meta.push(`id=${record.task_id}`);
  }
  if (typeof record.user_id === 'string') {
    meta.push(`user=${record.user_id}`);
  }
  if (typeof record.session_id === 'string') {
    meta.push(`session=${record.session_id}`);
  }
  if (typeof record.retry_count === 'number') {
    meta.push(`retry=${record.retry_count}`);
  }
  if (typeof record.started_at === 'string') {
    meta.push(`started=${record.started_at}`);
  }

  if (meta.length > 0) {
    lines.push(paint(meta.join('  '), ANSI.dim, color));
  }

  lines.push('');
  return lines;
}

/** Renders a tool_call record. */
function renderToolCall(record: TraceRecord, color: boolean, raw: boolean): string {
  const step = typeof record.step === 'number' ? record.step : '?';
  const toolName = typeof record.tool_name === 'string' ? record.tool_name : 'unknown';
  const header = paint(`tool call`, ANSI.bold + ANSI.blue, color)
    + paint(` step ${step} `, ANSI.dim, color)
    + paint(toolName, ANSI.bold + ANSI.cyan, color);

  const lines = [`${linePrefix(record, color)}${header}`];

  if (raw) {
    lines.push(indent(prettyJson(record.input)));
    return lines.join('\n');
  }

  const input = record.input;
  if (input !== undefined) {
    const summary = summarizeToolInput(toolName, input);
    if (summary) {
      lines.push(indent(summary));
    } else {
      lines.push(indent(prettyJson(input)));
    }
  }

  return lines.join('\n');
}

/** Renders a tool_result record. */
function renderToolResult(record: TraceRecord, color: boolean, raw: boolean): string {
  const step = typeof record.step === 'number' ? record.step : '?';
  const toolName = typeof record.tool_name === 'string' ? record.tool_name : 'unknown';
  const isError = record.is_error === true;
  const label = isError ? 'tool error' : 'tool result';
  const labelStyle = isError ? ANSI.bold + ANSI.red : ANSI.bold + ANSI.green;

  const header = paint(label, labelStyle, color)
    + paint(` step ${step} `, ANSI.dim, color)
    + paint(toolName, ANSI.bold + ANSI.cyan, color);

  const lines = [`${linePrefix(record, color)}${header}`];

  if (raw) {
    lines.push(indent(prettyJson(record.output)));
    return lines.join('\n');
  }

  const text = extractToolText(record.output);
  if (text) {
    lines.push(indent(text));
  }

  const { diff, patch } = extractToolDetails(record.output);
  if (diff) {
    lines.push(indent(paint('diff:', ANSI.dim, color)));
    lines.push(indent(diff));
  } else if (patch) {
    lines.push(indent(paint('patch:', ANSI.dim, color)));
    lines.push(indent(patch));
  }

  if (!text && !diff && !patch && record.output !== undefined) {
    lines.push(indent(prettyJson(record.output)));
  }

  if (isError) {
    const code = typeof record.error_code === 'string' ? record.error_code : undefined;
    const message = typeof record.error_message === 'string' ? record.error_message : undefined;
    if (code || message) {
      lines.push(
        indent(
          paint([code, message].filter(Boolean).join(': '), ANSI.red, color),
        ),
      );
    }
  }

  return lines.join('\n');
}

/** Produces a one-line summary for common tool inputs. */
function summarizeToolInput(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const args = input as Record<string, unknown>;

  switch (toolName) {
    case 'grep':
      if (typeof args.pattern === 'string') {
        const path = typeof args.path === 'string' ? `path: ${args.path}` : undefined;
        return path ? `${path}\npattern: ${args.pattern}` : `pattern: ${args.pattern}`;
      }
      break;
    case 'read':
    case 'write':
    case 'ls':
      if (typeof args.path === 'string') {
        const extras = Object.entries(args)
          .filter(([key]) => key !== 'path' && key !== 'content')
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
        const pathLine = `path: ${args.path}`;
        if (toolName === 'write' && typeof args.content === 'string') {
          return `${pathLine}\ncontent:\n${indent(args.content, 4)}`;
        }
        return extras.length > 0 ? `${pathLine}  (${extras.join(', ')})` : pathLine;
      }
      break;
    case 'edit': {
      const path = typeof args.path === 'string' ? args.path : undefined;
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const editLines = edits.map((edit, index) => {
        if (!edit || typeof edit !== 'object') {
          return `edit ${index + 1}: <invalid>`;
        }
        const e = edit as Record<string, unknown>;
        const oldText = typeof e.oldText === 'string' ? e.oldText : '';
        const newText = typeof e.newText === 'string' ? e.newText : '';
        return [
          `edit ${index + 1}:`,
          indent(`- old: ${JSON.stringify(oldText)}`, 4),
          indent(`+ new: ${JSON.stringify(newText)}`, 4),
        ].join('\n');
      });
      return [path ? `path: ${path}` : undefined, ...editLines].filter(Boolean).join('\n');
    }
    default:
      break;
  }

  return undefined;
}

/** Renders collapsed assistant or thinking text blocks. */
function renderTextBlock(
  kind: 'assistant' | 'thinking',
  text: string,
  firstRecord: TraceRecord,
  color: boolean,
): string {
  const label = kind === 'assistant'
    ? paint('assistant', ANSI.bold + ANSI.magenta, color)
    : paint('thinking', ANSI.bold + ANSI.yellow, color);

  const lines = [`${linePrefix(firstRecord, color)}${label}`];
  if (text.length > 0) {
    lines.push(indent(text));
  }
  return lines.join('\n');
}

/** Renders usage, agent_finished, agent_error, and run_end records. */
function renderMiscRecord(record: TraceRecord, color: boolean): string {
  const prefix = linePrefix(record, color);

  switch (record.type) {
    case 'usage': {
      const usage = record.usage;
      if (!usage || typeof usage !== 'object') {
        return `${prefix}${paint('usage', ANSI.bold, color)}`;
      }
      const u = usage as Record<string, unknown>;
      const parts = ['input_tokens', 'output_tokens', 'total_tokens']
        .map((key) => (typeof u[key] === 'number' ? `${key}=${u[key]}` : undefined))
        .filter(Boolean);
      return `${prefix}${paint('usage', ANSI.bold, color)} ${paint(parts.join('  '), ANSI.dim, color)}`;
    }
    case 'agent_finished': {
      const reason = typeof record.finish_reason === 'string' ? record.finish_reason : 'unknown';
      const completed = typeof record.completed_at === 'string' ? record.completed_at : '';
      return `${prefix}${paint('finished', ANSI.bold + ANSI.green, color)} reason=${reason}${completed ? ` at ${completed}` : ''}`;
    }
    case 'agent_error': {
      const message = typeof record.message === 'string' ? record.message : 'unknown error';
      return `${prefix}${paint('agent error', ANSI.bold + ANSI.red, color)}\n${indent(message)}`;
    }
    case 'run_end': {
      const kind = typeof record.kind === 'string' ? record.kind : 'unknown';
      const lines = [`${prefix}${paint('run end', ANSI.bold + ANSI.cyan, color)} ${paint(kind, ANSI.bold, color)}`];

      if (kind === 'completed' && typeof record.summaryLength === 'number') {
        lines.push(indent(`summary length: ${record.summaryLength} chars`));
      }
      if (kind === 'error' && typeof record.message === 'string') {
        lines.push(indent(record.message));
      }
      if (typeof record.completed_at === 'string') {
        lines.push(indent(paint(`completed at ${record.completed_at}`, ANSI.dim, color)));
      }

      lines.push(paint('─'.repeat(72), ANSI.dim, color));
      return lines.join('\n');
    }
    default: {
      const _exhaustive: never = record.type;
      return `${prefix}${paint(String(_exhaustive), ANSI.dim, color)}\n${indent(prettyJson(record))}`;
    }
  }
}

/** Converts parsed trace records into human-readable lines. */
function prettifyTrace(records: TraceRecord[], options: { color: boolean; raw: boolean }): string {
  const lines: string[] = [];
  let textBuffer = '';
  let textFirst: TraceRecord | undefined;
  let thinkingBuffer = '';
  let thinkingFirst: TraceRecord | undefined;

  const flushText = (): void => {
    if (textFirst && textBuffer.length > 0) {
      lines.push(renderTextBlock('assistant', textBuffer, textFirst, options.color));
      lines.push('');
    }
    textBuffer = '';
    textFirst = undefined;
  };

  const flushThinking = (): void => {
    if (thinkingFirst && thinkingBuffer.length > 0) {
      lines.push(renderTextBlock('thinking', thinkingBuffer, thinkingFirst, options.color));
      lines.push('');
    }
    thinkingBuffer = '';
    thinkingFirst = undefined;
  };

  const flushStreaming = (): void => {
    flushText();
    flushThinking();
  };

  for (const record of records) {
    switch (record.type) {
      case 'run_start':
        flushStreaming();
        lines.push(...renderRunStart(record, options.color));
        break;
      case 'tool_call':
        flushStreaming();
        lines.push(renderToolCall(record, options.color, options.raw));
        lines.push('');
        break;
      case 'tool_result':
        flushStreaming();
        lines.push(renderToolResult(record, options.color, options.raw));
        lines.push('');
        break;
      case 'text_delta': {
        flushThinking();
        const chunk = typeof record.text === 'string' ? record.text : '';
        if (!textFirst) {
          textFirst = record;
        }
        textBuffer += chunk;
        break;
      }
      case 'thinking_delta': {
        flushText();
        const chunk = typeof record.text === 'string' ? record.text : '';
        if (!thinkingFirst) {
          thinkingFirst = record;
        }
        thinkingBuffer += chunk;
        break;
      }
      case 'usage':
      case 'agent_finished':
      case 'agent_error':
      case 'run_end':
        flushStreaming();
        lines.push(renderMiscRecord(record, options.color));
        lines.push('');
        break;
      default:
        flushStreaming();
        lines.push(`${linePrefix(record, options.color)}${paint(String(record.type), ANSI.dim, options.color)}`);
        lines.push(indent(prettyJson(record)));
        lines.push('');
        break;
    }
  }

  flushStreaming();

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return `${lines.join('\n')}\n`;
}

/** Reads one JSONL trace file and prints the prettified output. */
async function main(): Promise<void> {
  const { filePath, color, raw } = parseArgs(process.argv);
  const content = await readFile(filePath, 'utf8');
  const records: TraceRecord[] = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed) as TraceRecord);
    } catch {
      process.stderr.write(`Warning: skipping invalid JSON on line ${index + 1}\n`);
    }
  }

  process.stdout.write(prettifyTrace(records, { color, raw }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
