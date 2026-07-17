import type { SystemPromptInputs } from '../agent/readWorkspaceSnapshot.js';
import { formatIntegrationGuidance } from '../integrations/formatIntegrationGuidance.js';
import {
  formatConventionsSection,
  formatFileListingSection,
  formatIndexSection,
  WORKER_CONVENTIONS_SECTION_LABEL,
  WORKER_FILE_LISTING_SECTION_LABEL,
  WORKER_INDEX_SECTION_LABEL,
  WORKER_MEMORY_INTRO_LINES,
  WORKER_MEMORY_SECTION_HEADING,
  WORKER_RESULT_FORMAT_HEADING,
  WORKER_RESULT_FORMAT_LINES,
  WORKER_SYSTEM_LINES,
  WORKER_WORKING_RULES_HEADING,
  WORKER_WORKING_RULES_LINES,
} from '../prompts/index.js';

/** Returns the stable system prompt for a worker agent session. */
export function buildWorkerSystemPrompt(inputs: SystemPromptInputs): string {
  const parts = [
    ...WORKER_SYSTEM_LINES,
    '',
    WORKER_MEMORY_SECTION_HEADING,
    ...WORKER_MEMORY_INTRO_LINES,
    '',
    WORKER_CONVENTIONS_SECTION_LABEL,
    formatConventionsSection(inputs.workspace),
    '',
    WORKER_INDEX_SECTION_LABEL,
    formatIndexSection(inputs.workspace),
    '',
    WORKER_FILE_LISTING_SECTION_LABEL,
    formatFileListingSection(inputs.workspace),
    '',
    WORKER_WORKING_RULES_HEADING,
    ...WORKER_WORKING_RULES_LINES,
    '',
    WORKER_RESULT_FORMAT_HEADING,
    ...WORKER_RESULT_FORMAT_LINES,
  ];

  const integrationGuidance = formatIntegrationGuidance(inputs.promptFragments);
  if (integrationGuidance.length > 0) {
    parts.push('', integrationGuidance);
  }

  return parts.join('\n');
}
