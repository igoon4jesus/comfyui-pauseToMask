import time
import os
import io
import threading
import numpy as np
import torch
import subprocess
import shutil
import sys
from PIL import Image as PILImage
from aiohttp import web

import comfy
import folder_paths
from server import PromptServer
from comfy.model_management import InterruptProcessingException

REFRESH_INTERVAL_SECONDS = 2

class PauseToMask:
    # node_id -> dict(state, files, mtimes, refresh_stop)
    status_by_id = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "invert_mask": ("BOOLEAN", {"default": False}),
                "auto_refresh": ("BOOLEAN", {"default": True}),
            },
            "hidden": {
                "id": "UNIQUE_ID",
                "prompt": "PROMPT",
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("images", "mask")
    FUNCTION = "execute"
    CATEGORY = "image"
    OUTPUT_NODE = True

    def _clipspace_dir(self):
        path = os.path.join(folder_paths.get_input_directory(), "clipspace")
        os.makedirs(path, exist_ok=True)
        return path

    def _save_images(self, images, node_id):
        clipdir = self._clipspace_dir()
        ts = int(time.time() * 1000)
        results = []
        h, w = images[0].shape[:2]

        for b, image in enumerate(images):
            arr = (255.0 * image.cpu().numpy()).clip(0, 255).astype(np.uint8)
            pil = PILImage.fromarray(arr).convert("RGBA")
            fname = f"pause_to_mask_{node_id}_b{b}_{ts}.png"
            pil.save(os.path.join(clipdir, fname), compress_level=1)
            results.append({"filename": fname, "subfolder": "clipspace", "type": "input"})
        return results, (w, h)

    def _mask_from_alpha(self, path, size, invert):
        img = PILImage.open(path).convert("RGBA")
        alpha = img.getchannel("A")
        if alpha.size != size:
            alpha = alpha.resize(size, PILImage.BILINEAR)
        a = np.asarray(alpha, dtype=np.float32) / 255.0
        mask = 1.0 - a
        if invert:
            mask = 1.0 - mask
        return torch.from_numpy(mask)

    def _send_preview_ui(self, node_id, ui_images, refresh_token=None):
        PromptServer.instance.send_sync("executing", {"node": node_id, "prompt_id": None})
        out = {"images": ui_images}
        # Helps bust frontend caching if needed
        if refresh_token is not None:
            out["_refresh"] = refresh_token
        PromptServer.instance.send_sync(
            "executed",
            {"node": node_id, "output": out, "prompt_id": None},
        )

    def _refresh_worker(self, node_id, interval_s):
        """While paused, poll preview files' mtime and push UI update when changed."""
        clipdir = self._clipspace_dir()

        while True:
            st = self.status_by_id.get(node_id)
            if not st:
                return

            stop_evt = st.get("refresh_stop")
            if stop_evt is not None and stop_evt.is_set():
                return

            if st.get("state") != "paused":
                return

            files = st.get("files", [])
            mtimes = st.get("mtimes", [None] * len(files))

            changed = False
            for i, fname in enumerate(files):
                path = os.path.join(clipdir, fname)
                try:
                    m = os.path.getmtime(path)
                except OSError:
                    m = None

                if i >= len(mtimes):
                    mtimes.append(m)
                    changed = True
                elif mtimes[i] != m:
                    mtimes[i] = m
                    changed = True

            st["mtimes"] = mtimes

            if changed:
                ui_images = [{"filename": f, "subfolder": "clipspace", "type": "input"} for f in files]
                self._send_preview_ui(node_id, ui_images, refresh_token=int(time.time() * 1000))

            # Sleep / wait
            if stop_evt is None:
                time.sleep(interval_s)
            else:
                stop_evt.wait(interval_s)

    def execute(self, images, invert_mask=False, auto_refresh=True, id=None, prompt=None):
        node_id = str(id)

        ui_images, (w, h) = self._save_images(images, node_id)
        clipdir = self._clipspace_dir()
        files = [x["filename"] for x in ui_images]

        mtimes = []
        for f in files:
            try:
                mtimes.append(os.path.getmtime(os.path.join(clipdir, f)))
            except OSError:
                mtimes.append(None)

        refresh_stop = threading.Event()

        self.status_by_id[node_id] = {
            "state": "paused",
            "files": files,
            "mtimes": mtimes,
            "refresh_stop": refresh_stop,
        }

        # Initial preview push
        self._send_preview_ui(node_id, ui_images)

        # Start refresh thread while paused
        if auto_refresh:
            t = threading.Thread(target=self._refresh_worker, args=(node_id, interval), daemon=True)
            t.start()

        try:
            while self.status_by_id[node_id]["state"] == "paused":
                time.sleep(0.1)

            if self.status_by_id[node_id]["state"] == "cancelled":
                raise InterruptProcessingException()

            # Build masks from alpha of edited PNGs
            masks = []
            for b in range(images.shape[0]):
                try:
                    p = os.path.join(clipdir, self.status_by_id[node_id]["files"][b])
                    masks.append(self._mask_from_alpha(p, (w, h), invert_mask))
                except Exception:
                    masks.append(torch.zeros((h, w), dtype=torch.float32))

            return images, torch.stack(masks, dim=0)

        finally:
            st = self.status_by_id.get(node_id)
            if st and st.get("refresh_stop") is not None:
                st["refresh_stop"].set()
            self.status_by_id.pop(node_id, None)


# -------------------------
# Normalized API routes
# -------------------------

@PromptServer.instance.routes.post("/api/pause_to_mask/continue/{node_id}")
async def handle_continue(request):
    node_id = request.match_info["node_id"].strip()
    if node_id in PauseToMask.status_by_id:
        PauseToMask.status_by_id[node_id]["state"] = "continue"
        st = PauseToMask.status_by_id.get(node_id)
        if st and st.get("refresh_stop") is not None:
            st["refresh_stop"].set()
        return web.json_response({"status": "ok", "matched": True})
    return web.json_response({"status": "ok", "matched": False, "known": list(PauseToMask.status_by_id.keys())})


@PromptServer.instance.routes.post("/api/pause_to_mask/cancel")
async def handle_cancel(request):
    comfy.model_management.interrupt_current_processing()
    for k in list(PauseToMask.status_by_id.keys()):
        PauseToMask.status_by_id[k]["state"] = "cancelled"
        st = PauseToMask.status_by_id.get(k)
        if st and st.get("refresh_stop") is not None:
            st["refresh_stop"].set()
    return web.json_response({"ok": True})


@PromptServer.instance.routes.post("/api/pause_to_mask/open_in_krita/{node_id}/{batch}")
async def open_in_krita(request):
    node_id = request.match_info["node_id"].strip()
    batch = int(request.match_info["batch"])
    st = PauseToMask.status_by_id.get(node_id)
    if not st:
        return web.json_response({"error": "not paused"}, status=404)
    if batch < 0 or batch >= len(st["files"]):
        return web.json_response({"error": "invalid batch"}, status=400)

    clipdir = os.path.join(folder_paths.get_input_directory(), "clipspace")
    path = os.path.abspath(os.path.join(clipdir, st["files"][batch]))
    if not os.path.exists(path):
        return web.json_response({"error": "file not found"}, status=404)

    krita = (
        os.environ.get("KRITA_PATH")
        or shutil.which("krita")
        or shutil.which("krita.exe")
    )

    try:
        if krita:
            subprocess.Popen([krita, path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return web.json_response({"ok": True, "launcher": "krita"})
        if sys.platform.startswith("win"):
            os.startfile(path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return web.json_response({"ok": True, "launcher": "default"})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
