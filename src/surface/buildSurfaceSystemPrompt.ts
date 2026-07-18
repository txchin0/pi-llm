import type { SystemPromptInputs } from '../agent/readWorkspaceSnapshot.js';
import { formatIntegrationGuidance } from '../integrations/formatIntegrationGuidance.js';
import {
  formatFileListingSection,
  formatIndexSection,
  SURFACE_BASE_CAPABILITY_LINE,
  SURFACE_DEFERRAL_RULES_LABEL,
  SURFACE_DEFERRAL_RULES_LINES,
  SURFACE_DEFERRED_WORK_HEADING,
  SURFACE_DEFERRED_WORK_INTRO_LINES,
  SURFACE_FILE_LISTING_SECTION_LABEL,
  SURFACE_INDEX_SECTION_LABEL,
  SURFACE_MEMORY_INTRO_LINES,
  SURFACE_MEMORY_RULES_LABEL,
  SURFACE_MEMORY_RULES_LINES,
  SURFACE_MEMORY_SECTION_HEADING,
  SURFACE_SYSTEM_LINES,
  SURFACE_TASK_STATUS_HEADING,
  SURFACE_TASK_STATUS_LINES,
  SURFACE_TIME_HEADING,
  SURFACE_TIME_LINES,
} from '../prompts/index.js';

/** Returns the stable system prompt for a surface agent session. */
export function buildSurfaceSystemPrompt(inputs: SystemPromptInputs): string {
  const capabilityLines = [
    SURFACE_BASE_CAPABILITY_LINE,
    ...inputs.workerCapabilities.map((capability) => `- ${capability}`),
  ];

  const parts = [
    ...SURFACE_SYSTEM_LINES,
    '',
    SURFACE_TIME_HEADING,
    ...SURFACE_TIME_LINES,
    '',
    SURFACE_MEMORY_SECTION_HEADING,
    ...SURFACE_MEMORY_INTRO_LINES,
    '',
    SURFACE_INDEX_SECTION_LABEL,
    formatIndexSection(inputs.workspace),
    '',
    SURFACE_FILE_LISTING_SECTION_LABEL,
    formatFileListingSection(inputs.workspace),
    '',
    SURFACE_MEMORY_RULES_LABEL,
    ...SURFACE_MEMORY_RULES_LINES,
    '',
    SURFACE_DEFERRED_WORK_HEADING,
    ...SURFACE_DEFERRED_WORK_INTRO_LINES,
    ...capabilityLines,
    '',
    SURFACE_DEFERRAL_RULES_LABEL,
    ...SURFACE_DEFERRAL_RULES_LINES,
    '',
    SURFACE_TASK_STATUS_HEADING,
    ...SURFACE_TASK_STATUS_LINES,
  ];

  const integrationGuidance = formatIntegrationGuidance(inputs.promptFragments);
  if (integrationGuidance.length > 0) {
    parts.push('', integrationGuidance);
  }

  return parts.join('\n');
}
