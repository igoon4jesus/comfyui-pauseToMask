import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/**
 * POST helper: uses api.fetchApi when available (proxy-safe).
 * NOTE: api.fetchApi automatically prefixes /api to the request.
 */
async function post(path, options = {}) {
  const opts = { method: "POST", ...options };
  const res = api?.fetchApi ? await api.fetchApi(path, opts) : await fetch(path, opts);

  let payload;
  try { payload = await res.clone().json(); }
  catch { payload = await res.clone().text(); }

  console.debug("[pause_to_mask] POST", path, "->", res.status, payload);
  return res;
}

// IMPORTANT:
// We do NOT include "/api" here because api.fetchApi adds it automatically.
// Backend routes are registered as "/api/pause_to_mask/..." in Python.
const postContinue = (nodeId) => post(`/pause_to_mask/continue/${nodeId}`);
const postCancel   = () => post(`/pause_to_mask/cancel`);
const postOpenInKrita = (nodeId, batch = 0) =>
  post(`/pause_to_mask/open_in_krita/${nodeId}/${batch}`);

function isTargetNode(node) {
  const comfyClass = node?.comfyClass;
  const title = node?.title;
  const type = node?.type;

  console.debug("[pause_to_mask] nodeCreated:", { id: node?.id, title, comfyClass, type });

  return (
    comfyClass === "pause_to_mask" ||
    type === "pause_to_mask" ||
    comfyClass === "PauseToMask" ||
    type === "PauseToMask" ||
    title === "Pause To Mask"
  );
}

app.registerExtension({
  name: "pause_to_mask",

  nodeCreated(node) {
    if (!isTargetNode(node)) return;

    // Avoid duplicates on reload
    if (node.widgets?.some((w) => w?.name === "✔️ Continue")) return;

    node.addWidget("button", "🎨 Send to Krita", "OPEN_KRITA", () => postOpenInKrita(node.id, 0));
    node.addWidget("button", "✔️ Continue", "CONTINUE", () => postContinue(node.id));
    node.addWidget("button", "⛔ Cancel", "CANCEL", () => postCancel());
  },

  setup() {
    // If user hits the global interrupt, treat it like cancel
    const original = api.interrupt;
    api.interrupt = function () {
      postCancel();
      return original.apply(this, arguments);
    };
  },
});