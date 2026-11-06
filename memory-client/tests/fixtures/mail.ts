export const requestContent = (summary: string) => ({
  schema_version: 1 as const,
  summary,
  context: [] as string[],
  findings: [],
  options: [],
  recommendation: null,
  request: {
    action: summary,
    requirements: [],
    expected_response: "Report findings or honest progress.",
  },
  result: null,
  uncertainties: [],
  references: [] as { locator: string; note: string }[],
  related_messages: [],
});
