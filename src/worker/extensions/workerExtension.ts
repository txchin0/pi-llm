import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { closeExaMcp } from '../../surface/exaMcpClient.js';
import {
  FILESYSTEM_GUARDED_TOOLS,
  registerFilesystemSandbox,
} from '../../surface/extensions/filesystemSandbox.js';
import { registerWebSearchTool } from '../../surface/extensions/webSearchTool.js';

/** Registers worker tools, write-aware sandboxing, and lifecycle hooks. */
export function createWorkerExtension(pi: ExtensionAPI): void {
  registerFilesystemSandbox(pi, FILESYSTEM_GUARDED_TOOLS);
  registerWebSearchTool(pi);

  pi.on('session_shutdown', async () => {
    await closeExaMcp();
  });
}
