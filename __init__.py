from .PauseToMask import PauseToMask

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {
    "pause_to_mask": PauseToMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "pause_to_mask": "Pause To Mask",
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]