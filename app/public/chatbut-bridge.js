const status = document.getElementById("bridge-status");
const [token = "", nonce = "", mode = "", platformValue = "googleChat"] = location.hash.slice(1).split(".");
const platforms = {
  googleChat: {
    label: "Google Chat",
    openerOrigin: "https://chat.google.com",
    cleanUrl: "https://chat.google.com/app/home",
  },
  teams: {
    label: "Teams",
    openerOrigin: "https://teams.microsoft.com",
    cleanUrl: "https://teams.microsoft.com/v2/",
  },
};
const platform = platforms[platformValue];
const releaseVersion = String(globalThis.CHATBUT_RELEASE_VERSION || "");

function fail(message) {
  status.textContent = message;
  status.dataset.tone = "error";
}

if (
  !window.opener
  || window.opener.closed
  || !/^[A-Za-z0-9_-]{32,128}$/.test(token)
  || nonce.length < 8
  || !platform
) {
  fail("This connection request is invalid. Close this tab and retry Chatbut.");
} else if (typeof SharedWorker !== "function") {
  fail("SharedWorker is blocked in this Chrome profile.");
} else {
  try {
    const worker = new SharedWorker("./chatbut-bridge-worker.js", {
      name: "chatbut-config-bridge",
    });
    worker.port.start();
    worker.port.postMessage({
      type: "chatbut:register",
      role: "runtime",
      platform: platformValue,
      token,
      releaseVersion,
    });
    window.opener.postMessage(
      {
        type: "chatbut:bridge-port",
        nonce,
      },
      platform.openerOrigin,
      [worker.port],
    );
    if (mode === "handoff") {
      status.textContent = `Connected. The first tab is now your automation tab; opening a clean ${platform.label} tab…`;
      window.setTimeout(() => location.replace(platform.cleanUrl), 250);
    } else {
      status.textContent = "Connected. This helper tab can close.";
      window.setTimeout(() => window.close(), 250);
    }
  } catch {
    fail("Chrome could not create the local Chatbut bridge.");
  }
}
