import type { SystemPromptInputs } from '../agent/readWorkspaceSnapshot.js';
import { formatIntegrationGuidance } from '../integrations/formatIntegrationGuidance.js';
import {
  formatFileListingSection,
  formatIndexSection,
  SURFACE_FILE_LISTING_SECTION_LABEL,
  SURFACE_INDEX_SECTION_LABEL,
  SURFACE_MEMORY_SECTION_HEADING,
  SURFACE_SYSTEM_LINES,
} from '../prompts/index.js';

/** Returns the stable system prompt for a surface agent session. */
export function buildSurfaceSystemPrompt(inputs: SystemPromptInputs): string {
  const parts = [
    ...SURFACE_SYSTEM_LINES,
    '',
    SURFACE_MEMORY_SECTION_HEADING,
    SURFACE_INDEX_SECTION_LABEL,
    formatIndexSection(inputs.workspace),
    '',
    SURFACE_FILE_LISTING_SECTION_LABEL,
    formatFileListingSection(inputs.workspace),
  ];

  const integrationGuidance = formatIntegrationGuidance(inputs.promptFragments);
  if (integrationGuidance.length > 0) {
    parts.push('', integrationGuidance);
  }

  return parts.join('\n');
}
