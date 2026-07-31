import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_VERSION } from "../src/release.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "public");
const runtimePath = path.join(outputDirectory, "chatbut-bookmarklet.min.js");
const bookmarkletPath = path.join(outputDirectory, "chatbut-bookmarklet.txt");
const releasePath = path.join(outputDirectory, "chatbut-release.js");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "bookmarklet", "runtime.js")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  mangleProps: /^(handleWindowMessage|handlePortMessage|requestBridge|requestConfig|connectToConfigurator|sendBridge|render|button|setStatus|updateMetrics|updateReleaseState|cancelScheduleWait|armSchedule|syncConversationIndex|enableNow|activate|attachManualGuard|tick|markAutomatedSend|acceptVisibleDirectRequest|acceptVisibleSpaceInvitation|revealSpaceInvitation|connectionNonce|bridgeWindow|bridgePort|connectionTimeout|bridgeRequests|countdownTimer|waitingForSchedule|activating|latestRelease|lastSpaceInviteScan|lastIndexSync|channel|timer|busy|sending|sendChain|automating)$/,
  outfile: runtimePath,
  legalComments: "none",
});

const runtime = (await readFile(runtimePath, "utf8")).trim();
// Keep URI-safe JavaScript punctuation readable to preserve bookmarklet headroom.
// A literal # must still be escaped because browsers treat it as a URL fragment.
const bookmarklet = `javascript:${encodeURI(runtime).replaceAll("#", "%23")}`;
const distributedBookmarklet = bookmarklet
  .replace("__CHATBUT_PAIRING_TOKEN__", "a".repeat(32))
  .replace(
    "__CHATBUT_BRIDGE_URL__",
    encodeURIComponent("https://jiannystein.github.io/chatbut/chatbut-bridge.html"),
  );
const budget = 32 * 1024;
if (Buffer.byteLength(distributedBookmarklet, "utf8") > budget) {
  throw new Error(
    `Distributed bookmarklet is ${Buffer.byteLength(distributedBookmarklet, "utf8")} bytes; budget is ${budget}.`,
  );
}
await writeFile(bookmarkletPath, `${bookmarklet}\n`, "utf8");
await writeFile(
  releasePath,
  `globalThis.CHATBUT_RELEASE_VERSION=${JSON.stringify(RELEASE_VERSION)};\n`,
  "utf8",
);
console.log(`Bookmarklet: ${Buffer.byteLength(distributedBookmarklet, "utf8")} / ${budget} bytes`);
