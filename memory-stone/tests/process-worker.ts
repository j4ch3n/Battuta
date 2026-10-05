import { MemoryStore } from "../store.ts";

const [path, projectId, text] = process.argv.slice(2);
const store = await MemoryStore.open(path);
const binding = { name: "atlas", checkout: projectId, projectId };
if (text) {
  for (let i = 0; i < 12; i++) store.remember(binding, { kind: "decision", text: `${text} ${i}` });
  store.remember(binding, { kind: "decision", text: "Shared PostgreSQL decision" });
}
console.log(JSON.stringify(store.list(binding, "project").map((record) => record.text)));
store.close();
