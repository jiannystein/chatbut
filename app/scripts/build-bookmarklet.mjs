import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";
import { RELEASE_VERSION } from "../src/release.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "public");
const releasePath = path.join(outputDirectory, "chatbut-release.js");
const budget = 32 * 1024;
const mangleProps = /^(handleWindowMessage|handlePortMessage|requestBridge|requestConfig|connectToConfigurator|sendBridge|render|button|setStatus|updateMetrics|updateReleaseState|cancelScheduleWait|armSchedule|syncConversationIndex|enableNow|activate|attachManualGuard|tick|markAutomatedSend|acceptVisibleDirectRequest|acceptVisibleSpaceInvitation|revealSpaceInvitation|connectionNonce|bridgeWindow|bridgePort|connectionTimeout|bridgeRequests|countdownTimer|waitingForSchedule|activating|latestRelease|lastSpaceInviteScan|lastIndexSync|channel|timer|busy|sending|sendChain|automating)$/;
const teamsMangleProps = new RegExp(`${mangleProps.source.slice(0, -2)}|writeDebug|acceptVisibleRequest|switchApp|collectRows|context|indexedConversation|expandChannelParent|navigateTo|restoreContext|resolveSelfName|saveConfig|clearComposer|sendFor|queueConversation|root|scheduleOverride|processed|states|pending|sent|sessionCount|sessionChats|originalContext|unreadState|quarantined|selfName|lastChannelScan|element|ambiguous|unread|muted|mentionedSelf|repliedToSelf|composer|draft|ready)$`);

await mkdir(outputDirectory, { recursive: true });

async function buildBookmarklet({ entry, slug, label, properties = mangleProps }) {
  const runtimePath = path.join(outputDirectory, `chatbut-${slug}-bookmarklet.min.js`);
  const bookmarkletPath = path.join(outputDirectory, `chatbut-${slug}-bookmarklet.txt`);
  await build({
    entryPoints: [path.join(root, "src", "bookmarklet", entry)],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    mangleProps: properties,
    outfile: runtimePath,
    legalComments: "none",
  });
  const bundledRuntime = (await readFile(runtimePath, "utf8")).trim();
  const optimized = await minify(bundledRuntime, {
    compress: { passes: 5 },
    mangle: { toplevel: true },
    ecma: 2022,
    format: { comments: false },
  });
  if (!optimized.code) throw new Error(`${label} could not be optimized.`);
  const runtime = optimized.code.trim();
  await writeFile(runtimePath, `${runtime}\n`, "utf8");
  // Keep URI-safe JavaScript punctuation readable to preserve bookmarklet headroom.
  // A literal # must still be escaped because browsers treat it as a URL fragment.
  const bookmarklet = `javascript:${encodeURI(runtime).replaceAll("#", "%23")}`;
  const distributedBookmarklet = bookmarklet
    .replace("__CHATBUT_PAIRING_TOKEN__", "a".repeat(32))
    .replace(
      "__CHATBUT_BRIDGE_URL__",
      encodeURIComponent("https://jiannystein.github.io/chatbut/chatbut-bridge.html"),
    );
  const bytes = Buffer.byteLength(distributedBookmarklet, "utf8");
  if (bytes > budget) throw new Error(`${label} bookmarklet is ${bytes} bytes; budget is ${budget}.`);
  await writeFile(bookmarkletPath, `${bookmarklet}\n`, "utf8");
  console.log(`${label}: ${bytes} / ${budget} bytes`);
  return { runtimePath, bookmarkletPath };
}

const google = await buildBookmarklet({ entry: "runtime.js", slug: "google", label: "Google Chat bookmarklet" });
await buildBookmarklet({ entry: "teams-runtime.js", slug: "teams", label: "Teams bookmarklet", properties: teamsMangleProps });
// Keep the original artifact names as Google Chat aliases for installed configurators and tests.
await copyFile(google.runtimePath, path.join(outputDirectory, "chatbut-bookmarklet.min.js"));
await copyFile(google.bookmarkletPath, path.join(outputDirectory, "chatbut-bookmarklet.txt"));
await writeFile(
  releasePath,
  `globalThis.CHATBUT_RELEASE_VERSION=${JSON.stringify(RELEASE_VERSION)};\n`,
  "utf8",
);
