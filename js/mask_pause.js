import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/**
 * Use ComfyUI's fetch helper when possible (proxy/base-path safe),
 * fall back to fetch otherwise.
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


const postContinue = (nodeId) => post(`/api/pause_to_mask/continue/${nodeId}`);
const postCancel = () => post(`/api/pause_to_mask/cancel`);
const postOpenInKrita = (nodeId, batch = 0) => post(`/api/pause_to_mask/open_in_krita/${nodeId}/${batch}`);
const postMask = async (nodeId, batch, blob) => {
  const fd = new FormData();
  fd.append("mask", blob, "mask.png");
  const res = await post(`/api/pause_to_mask/upload_mask/${nodeId}/${batch}`, { body: fd });
  return res.json().catch(async () => ({ status: res.status, text: await res.text() }));
};


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

// ... keep the rest of your mask painter unchanged, except the imports above ...

app.registerExtension({
  name: "pause_to_mask",
  nodeCreated(node) {
    if (!isTargetNode(node)) return;
    if (node.widgets?.some((w) => w?.name === "✔️ Continue")) return;

    node.addWidget("button", "🎨 Send to Krita", "OPEN_KRITA", () => postOpenInKrita(node.id, 0));
    node.addWidget("button", "🖌️ Edit Mask", "EDIT_MASK", () => createMaskPainter({ nodeId: node.id, initialBatch: 0 }));
    node.addWidget("button", "✔️ Continue", "CONTINUE", () => postContinue(node.id));
    node.addWidget("button", "⛔ Cancel", "CANCEL", () => postCancel());
  },
  setup() {
    const original_api_interrupt = api.interrupt;
    api.interrupt = function () {
      postCancel();
      return original_api_interrupt.apply(this, arguments);
    };
  },
});