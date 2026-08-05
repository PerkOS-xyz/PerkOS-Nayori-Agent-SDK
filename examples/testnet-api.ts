export type ExampleFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export async function fetchChainTip(
  apiUrl: string,
  fetchImpl: ExampleFetch = globalThis.fetch.bind(globalThis)
): Promise<bigint> {
  const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/v2/info`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Stacks API returned HTTP ${response.status}.`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") {
    throw new Error("Invalid Stacks API info response.");
  }
  const height = (body as Record<string, unknown>).stacks_tip_height;
  if (typeof height !== "number" || !Number.isSafeInteger(height) || height < 0) {
    throw new Error("Stacks API did not return a valid stacks_tip_height.");
  }
  return BigInt(height);
}
