declare const legacyGeminiConnector: {
  GEMINI_LEGACY_COMMANDS_DIR: string;
  normalizeManagedSlashContent: (content: string) => string;
  contentMatchesManagedGeminiCommand: (existing: string, expected: string) => boolean;
  geminiLegacyCommandFiles: () => GeminiLegacyCommandFile[];
  isRemovableLegacyGeminiCommandFile: (args: {
    filePath: string;
    content: string;
    manifestFiles: Set<string>;
  }) => boolean;
  removeLegacyGeminiConnector: (args: {
    readManifest: () => GeminiLegacyManifest;
    writeManifest: (manifest: GeminiLegacyManifest) => void;
    readTextFile: (filePath: string) => string;
    existsSync?: (filePath: string) => boolean;
    rmSync?: (filePath: string, options?: { force?: boolean }) => void;
  }) => string[];
};

export = legacyGeminiConnector;

export type GeminiLegacyCommandFile = {
  path: string;
  content: string;
};

export type GeminiLegacyManifest = {
  gemini?: {
    files?: string[];
  };
};
