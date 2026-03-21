Pause To Mask (ComfyUI Node)
Pause To Mask is a ComfyUI custom node that pauses workflow execution, exports the current image(s) to disk, lets you edit them externally (for example in Krita), and then resumes execution using the edited image’s alpha channel as a mask.
This node is derived from and inspired by the original ComfyUI‑ImagePreviewPause node by Cordux, and extends it with external‑editor integration and automatic preview refreshing. [github.com]

✨ Features

⏸️ Pauses execution at a specific point in the workflow
🖼️ Exports preview images with an alpha channel
🎨 One‑click “Send to Krita” (or system image editor fallback)
🔄 Auto‑refresh preview while paused

Detects file changes using filesystem mtime
Updates the ComfyUI preview automatically


✅ Resume or cancel execution from the node UI
🧠 Mask derived from alpha channel

Mask = 1.0 - alpha
Optional inversion




🧩 Node Behavior
When the node executes:


The input image(s) are written to:
ComfyUI/input/clipspace/
as RGBA PNG files.


The workflow pauses.


You can click “Send to Krita” to open the image for editing.

If KRITA_PATH is set, Krita is used explicitly.
Otherwise, the system default image editor is used.



While paused:

The node polls file modification time every 2 seconds
If the file changes, the preview updates automatically



Click:

✅ Continue → workflow resumes, mask is read from alpha
⛔ Cancel → workflow aborts




🧪 Mask Semantics


The alpha channel of the edited image is used


Mask is computed as:
mask = 1.0 - alpha


This matches standard ComfyUI masking semantics


Enable Invert Mask if you prefer the opposite behavior



⚙️ Node Inputs

























InputTypeDescriptionimagesIMAGEImage(s) to pause and editinvert_maskBOOLEANInvert the computed maskauto_refreshBOOLEANEnable / disable preview auto‑refresh while paused
🔄 Auto‑refresh uses a fixed 2‑second interval.
If this feels too aggressive, simply turn it off.

🧵 Outputs

















OutputTypeimagesIMAGEmaskMASK

🖥️ Krita Integration (Optional)
To force Krita to be used instead of the system default image viewer, set the KRITA_PATH environment variable.
Windows (PowerShell)
setx KRITA_PATH "C:\Program Files\Krita (x64)\bin\krita.exe"

Linux / macOS
export KRITA_PATH=/usr/bin/krita

⚠️ Restart ComfyUI after setting the variable.

📁 Files & Structure
pause_to_mask/
├─ __init__.py
├─ PauseToMask.py
└─ js/
   └─ mask_pause.js



Backend routes are exposed under:
/api/pause_to_mask/...


Frontend uses api.fetchApi() for proxy‑safe requests



🧠 Design Notes

Auto‑refresh runs only while paused
Polling stops immediately on Continue or Cancel
Uses lightweight filesystem mtime checks (no file reads)
One background thread per paused node, cleaned up safely

This keeps the node responsive and safe for production use.

🙏 Attribution
This project is based on and inspired by:
ComfyUI‑ImagePreviewPause
by Cordux
https://github.com/Cordux/ComfyUI-ImagePreviewPause [github.com]
The original project introduced the core idea of previewing and pausing execution directly on a node.
Pause To Mask builds on that foundation by adding:

external editor workflows (Krita)
alpha‑based mask extraction
automatic preview refreshing
a normalized API and extended control flow

Both projects are released under the MIT License. [github.com]

📜 License
MIT License
