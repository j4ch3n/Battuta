export async function cleanupOwned(operations: (() => Promise<unknown>)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const operation of operations) {
    try {
      const result = await operation();
      if (result && typeof result === "object" && "error" in result && result.error)
        errors.push(result.error);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Test-owned cleanup failed");
}
