export function memoryUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.BATTUTA_MEMORY_URL ?? "http://127.0.0.1:8901/mcp";
  const endpoint = new URL(url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.protocol !== "http:"
  )
    throw new Error("Memory URL must be loopback HTTP");
  return url;
}
