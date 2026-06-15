import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import {
  FILESYSTEM_GUARDED_TOOLS,
  registerFilesystemSandbox,
} from '../../surface/extensions/filesystemSandbox.js';

/** Registers core worker tools and write-aware sandboxing. */
export function createWorkerExtension(pi: ExtensionAPI): void {
  registerFilesystemSandbox(pi, FILESYSTEM_GUARDED_TOOLS);
}
