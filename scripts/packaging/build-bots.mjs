import { build } from "esbuild";
import { readFile, cp, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";

const [source, destination] = process.argv.slice(2).map((path) => resolve(path));
if (!source || !destination) throw new Error("Usage: build-bots.mjs SOURCE DESTINATION");
const entries = {
  "memory-client/configure-scheduler.mjs": "bots/_shared/memory-client/dist/configure-scheduler.js",
  "memory-client/configure-dream.mjs": "bots/_shared/memory-client/dist/configure-dream.js",
};
const builds = Object.entries(entries).map(([entry, output]) => ({ entry, output }));
for (const profile of ["cos-bot", "manager-bot", "worker"]) {
  const map = JSON.parse(
    await readFile(join(destination, "bots", profile, ".pi/extension-build.json"), "utf8"),
  );
  for (const { name, source: entry } of map)
    builds.push({ entry, output: `bots/${profile}/.pi/extensions/${name}/dist/index.js` });
}
for (const { entry, output } of builds) {
  const outfile = join(destination, output);
  const result = await build({
    entryPoints: [join(source, entry)],
    outfile,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: false,
    metafile: true,
    write: true,
  });
  const owner = dirname(dirname(outfile));
  const manifest = JSON.parse(await readFile(join(owner, "package.json"), "utf8"));
  for (const item of Object.values(result.metafile.outputs)) {
    for (const imported of item.imports.filter((value) => value.external)) {
      if (imported.path.startsWith("node:")) continue;
      const name = imported.path.startsWith("@")
        ? imported.path.split("/").slice(0, 2).join("/")
        : imported.path.split("/")[0];
      if (!manifest.dependencies?.[name])
        throw new Error(`Undeclared runtime dependency ${name} for ${output}`);
    }
  }
}
const prompts = join(destination, "bots/_shared/memory-client/dist/prompts");
await mkdir(dirname(prompts), { recursive: true });
await cp(join(source, "memory-client/prompts"), prompts, { recursive: true });
for (const { entry, output } of builds) {
  if (entry.startsWith("memory-client/"))
    await cp(
      join(source, "memory-client/prompts"),
      join(dirname(join(destination, output)), "prompts"),
      { recursive: true },
    );
}
