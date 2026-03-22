import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

let latest = { nodeId: null, images: null };
let ui = { titleEl: null, imgEl: null, btnContinue: null, btnKrita0: null };

function updateUI() {
  // If sidebar hasn't been rendered yet, do nothing
  if (!ui.titleEl || !ui.imgEl || !ui.btnContinue || !ui.btnKrita0) return;

  const { nodeId, images } = latest;

  if (!nodeId || !images || !images.length) {
    ui.titleEl.textContent = "Waiting for PauseToMask…";
    ui.imgEl.style.display = "none";
    ui.imgEl.removeAttribute("src");
    ui.btnContinue.disabled = true;
    ui.btnKrita0.disabled = true;
    return;
  }

  ui.titleEl.textContent = `Paused at node: ${nodeId}`;
  ui.btnContinue.disabled = false;
  ui.btnKrita0.disabled = false;

  const newest = images[images.length - 1];
  const params = new URLSearchParams({
    filename: newest.filename,
    subfolder: newest.subfolder || "",
    type: newest.type || "input",
  });

  ui.imgEl.src = `/view?${params.toString()}`;
  ui.imgEl.style.display = "block";
}

app.registerExtension({
  name: "pause_to_mask.sidebar",

  setup() {
    // Listen immediately so we don't miss pause events
    api.addEventListener("executed", (ev) => {
      const d = ev.detail;
      const nodeId = String(d?.node ?? "");
      const images = d?.output?.images;

      if (!images || !images.length) return;

      // Filter to your node’s previews by filename prefix:
      // pause_to_mask_{node_id}_b{b}_{ts}.png
      if (!String(images[0]?.filename || "").startsWith("pause_to_mask_")) return;

      latest = { nodeId, images };
      updateUI();
    });

    app.extensionManager.registerSidebarTab({
      id: "pauseToMaskPreview",
      icon: "pi pi-image",
      title: "Pause Preview",
      type: "custom",
      render: (el) => {
        el.innerHTML = `
          <div style="padding:10px; display:flex; flex-direction:column; gap:12px;">
            <div id="ptm_title" style="font-weight:600;">Waiting for PauseToMask…</div>

            <div style="display:flex; flex-direction:column; gap:8px;">
              <button id="ptm_continue" disabled style="text-align:center;">Continue</button>
              <button id="ptm_cancel" style="text-align:center;">Cancel</button>
              <button id="ptm_krita0" disabled style="text-align:center;">Open Krita (b0)</button>
            </div>

            <img id="ptm_img"
                 style="width:100%; border-radius:8px; display:none;" />
          </div>
        `;

        ui.titleEl = el.querySelector("#ptm_title");
        ui.imgEl = el.querySelector("#ptm_img");
        ui.btnContinue = el.querySelector("#ptm_continue");
        ui.btnKrita0 = el.querySelector("#ptm_krita0");

        el.querySelector("#ptm_cancel").onclick = async () => {
          await api.fetchApi(`/api/pause_to_mask/cancel`, { method: "POST" });
        };

        ui.btnContinue.onclick = async () => {
          if (!latest.nodeId) return;
          await api.fetchApi(
            `/api/pause_to_mask/continue/${encodeURIComponent(latest.nodeId)}`,
            { method: "POST" }
          );
        };

        ui.btnKrita0.onclick = async () => {
          if (!latest.nodeId) return;
          await api.fetchApi(
            `/api/pause_to_mask/open_in_krita/${encodeURIComponent(latest.nodeId)}/0`,
            { method: "POST" }
          );
        };

        // If pause already happened before opening tab, render it now
        updateUI();
      },
    });
  },
});