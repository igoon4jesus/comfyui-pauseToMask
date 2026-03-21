import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/**
 * Use ComfyUI's fetch helper when possible (proxy/base-path safe),
 * fall back to fetch otherwise.
 */
async function post(path, options = {}) {
  const opts = { method: "POST", ...options };
  const res = api?.fetchApi ? await api.fetchApi(path, opts) : await fetch(path, opts);

  // Helpful debug output
  let payload;
  try { payload = await res.clone().json(); }
  catch { payload = await res.clone().text(); }
  console.debug("[pause_to_mask] POST", path, "->", res.status, payload);

  return res;
}

const postContinue = (nodeId) => post(`/image_preview_pause/continue/${nodeId}`);
const postCancel = () => post(`/image_preview_pause/cancel`);
const postOpenInKrita = (nodeId, batch = 0) => post(`/image_preview_pause/open_in_krita/${nodeId}/${batch}`);

/** If you still use mask upload in your backend */
const postMask = async (nodeId, batch, blob) => {
  const fd = new FormData();
  fd.append("mask", blob, "mask.png");
  const res = await post(`/image_preview_pause/upload_mask/${nodeId}/${batch}`, { body: fd });
  return res.json().catch(async () => ({ status: res.status, text: await res.text() }));
};

function isTargetNode(node) {
  const comfyClass = node?.comfyClass;
  const title = node?.title;
  const type = node?.type;

  console.debug("[pause_to_mask] nodeCreated:", { id: node?.id, title, comfyClass, type });

  // Match both common node IDs and display titles
  return (
    comfyClass === "pause_to_mask" ||
    type === "pause_to_mask" ||
    comfyClass === "PauseToMask" ||
    type === "PauseToMask" ||
    comfyClass === "ImagePreviewPause" ||
    type === "ImagePreviewPause" ||
    title === "Pause To Mask" ||
    title === "Preview Image with Pause"
  );
}

function labelWrap(text, el) {
  const w = document.createElement("div");
  w.style.display = "flex";
  w.style.alignItems = "center";
  w.style.gap = "6px";
  w.style.color = "#ddd";
  w.style.fontFamily = "sans-serif";
  const l = document.createElement("span");
  l.textContent = text;
  w.appendChild(l);
  w.appendChild(el);
  return w;
}

function createMaskPainter({ nodeId, initialBatch = 0 }) {
  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(0,0,0,0.65)";
  modal.style.zIndex = "9999";
  modal.style.display = "flex";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";

  const panel = document.createElement("div");
  panel.style.background = "#111";
  panel.style.border = "1px solid #444";
  panel.style.borderRadius = "10px";
  panel.style.padding = "12px";
  panel.style.maxWidth = "95vw";
  panel.style.maxHeight = "95vh";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.gap = "10px";
  modal.appendChild(panel);

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "8px";
  header.style.color = "#ddd";
  header.style.fontFamily = "sans-serif";
  header.innerHTML = `<b>Mask Painter</b> (node ${nodeId})`;
  panel.appendChild(header);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.flexWrap = "wrap";
  controls.style.gap = "8px";
  panel.appendChild(controls);

  let brushSize = 24;
  let isEraser = false;
  let overlayOpacity = 0.45;
  let batch = initialBatch;

  const brush = document.createElement("input");
  brush.type = "range";
  brush.min = "1";
  brush.max = "200";
  brush.value = String(brushSize);
  brush.oninput = () => (brushSize = Number(brush.value));
  controls.appendChild(labelWrap("Brush", brush));

  const opacity = document.createElement("input");
  opacity.type = "range";
  opacity.min = "0";
  opacity.max = "100";
  opacity.value = String(Math.round(overlayOpacity * 100));
  opacity.oninput = () => (overlayOpacity = Number(opacity.value) / 100);
  controls.appendChild(labelWrap("Overlay", opacity));

  const modeBtn = document.createElement("button");
  modeBtn.textContent = "Mode: Paint";
  modeBtn.onclick = () => {
    isEraser = !isEraser;
    modeBtn.textContent = isEraser ? "Mode: Erase" : "Mode: Paint";
  };
  controls.appendChild(modeBtn);

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  controls.appendChild(clearBtn);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save Mask";
  controls.appendChild(saveBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.onclick = () => modal.remove();
  controls.appendChild(closeBtn);

  const wrap = document.createElement("div");
  wrap.style.overflow = "auto";
  wrap.style.maxWidth = "90vw";
  wrap.style.maxHeight = "80vh";
  panel.appendChild(wrap);

  const canvas = document.createElement("canvas");
  canvas.style.cursor = "crosshair";
  wrap.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  const maskCanvas = document.createElement("canvas");
  const mctx = maskCanvas.getContext("2d");

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `/image_preview_pause/temp_image/${nodeId}/${batch}?t=${Date.now()}`;

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    maskCanvas.width = img.width;
    maskCanvas.height = img.height;

    mctx.fillStyle = "black";
    mctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    redraw();
  };

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const maskData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const d = maskData.data;

    const overlay = ctx.createImageData(maskCanvas.width, maskCanvas.height);
    const od = overlay.data;

    for (let i = 0; i < d.length; i += 4) {
      const v = d[i];
      od[i + 0] = 255;
      od[i + 1] = 0;
      od[i + 2] = 0;
      od[i + 3] = Math.round(v * overlayOpacity);
    }
    ctx.putImageData(overlay, 0, 0);
  }

  function paintAt(x, y) {
    mctx.fillStyle = isEraser ? "black" : "white";
    mctx.beginPath();
    mctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    mctx.fill();
    redraw();
  }

  let painting = false;
  canvas.addEventListener("mousedown", (e) => {
    painting = true;
    const r = canvas.getBoundingClientRect();
    paintAt(e.clientX - r.left, e.clientY - r.top);
  });
  window.addEventListener("mouseup", () => (painting = false));
  canvas.addEventListener("mousemove", (e) => {
    if (!painting) return;
    const r = canvas.getBoundingClientRect();
    paintAt(e.clientX - r.left, e.clientY - r.top);
  });

  clearBtn.onclick = () => {
    mctx.fillStyle = "black";
    mctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    redraw();
  };

  saveBtn.onclick = async () => {
    maskCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const res = await postMask(nodeId, batch, blob);
      console.debug("[pause_to_mask] mask upload:", res);
      saveBtn.textContent = res?.status === "ok" ? "Saved ✅" : "Save Mask";
      setTimeout(() => (saveBtn.textContent = "Save Mask"), 800);
    }, "image/png");
  };

  document.body.appendChild(modal);
}

/**
 * ✅ SINGLE registration. Unique name.
 * ComfyUI requires extension names to be unique. [2](https://comfyai.run/custom_node/ComfyUI-post-processing-nodes)
 */
app.registerExtension({
  name: "pause_to_mask",

  nodeCreated(node) {
    if (!isTargetNode(node)) return;

    // Avoid duplicates
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