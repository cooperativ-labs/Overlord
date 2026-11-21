/** Keep a desktop-owned provider credential scoped to the local child process. */
export function localOpenRouterEnvironment({
  environment,
  userKey,
  packaged
}: {
  environment: NodeJS.ProcessEnv;
  userKey: string | null;
  packaged: boolean;
}): NodeJS.ProcessEnv {
  const result = { ...environment };
  if (packaged) {
    delete result.OPENROUTER_API_KEY;
    delete result.CHAT_OPENROUTER_API_KEY;
  }
  if (userKey) {
    result.OPENROUTER_API_KEY = userKey;
    result.CHAT_OPENROUTER_API_KEY = userKey;
  }
  return result;
}
