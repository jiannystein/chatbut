import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "public");
const runtimePath = path.join(outputDirectory, "chatbut-bookmarklet.min.js");
const bookmarkletPath = path.join(outputDirectory, "chatbut-bookmarklet.txt");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "bookmarklet", "runtime.js")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  outfile: runtimePath,
  legalComments: "none",
});

const runtime = (await readFile(runtimePath, "utf8")).trim();
const bookmarklet = `javascript:${encodeURIComponent(runtime)}`;
const budget = 32 * 1024;
if (Buffer.byteLength(bookmarklet, "utf8") > budget) {
  throw new Error(
    `Encoded bookmarklet is ${Buffer.byteLength(bookmarklet, "utf8")} bytes; budget is ${budget}.`,
  );
}
await writeFile(bookmarkletPath, `${bookmarklet}\n`, "utf8");
console.log(`Bookmarklet: ${Buffer.byteLength(bookmarklet, "utf8")} / ${budget} bytes`);
