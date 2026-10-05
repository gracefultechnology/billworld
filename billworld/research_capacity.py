"""Explicit pre-dispatch capacity stops shared by finite source collectors."""
import shutil


class CaptureCapacityLimited(RuntimeError):
    def __init__(self, message, *, free_bytes, required_bytes, snapshot):
        super().__init__(message)
        self.free_bytes = free_bytes
        self.required_bytes = required_bytes
        self.snapshot = snapshot


def require_capacity(directory, reserve_gib, maximum_batch_bytes, snapshot, label):
    free = shutil.disk_usage(directory).free
    required = int(reserve_gib * 1024**3) + maximum_batch_bytes
    if free < required:
        raise CaptureCapacityLimited(label + ' stopped at free-space reserve',
                                     free_bytes=free, required_bytes=required, snapshot=snapshot)
