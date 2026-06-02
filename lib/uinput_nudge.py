"""Emit a tiny REAL input event via /dev/uinput to reset gamescope's seat idle.

This is the only injection that resets the kernel/libinput idle timer -- SteamClient's
SetMousePosition and on-screen keyboard are UI-level and don't reach gamescope.
On SteamOS /dev/uinput is ACL-writable by the deck user, so this needs NO root.

Implemented with stdlib only (struct + ioctl) so there's no C-extension dependency
to ship for the Deck's architecture.
"""
from __future__ import annotations

import fcntl
import os
import struct
import time

_UINPUT = "/dev/uinput"
_BASE = ord("U")


def _io(nr: int) -> int:
    return (_BASE << 8) | nr


def _iow(nr: int, size: int) -> int:
    # _IOC(_IOC_WRITE=1, type, nr, size)
    return (1 << 30) | (size << 16) | (_BASE << 8) | nr


UI_DEV_CREATE = _io(1)
UI_DEV_DESTROY = _io(2)
UI_SET_EVBIT = _iow(100, 4)
UI_SET_KEYBIT = _iow(101, 4)
UI_SET_RELBIT = _iow(102, 4)

EV_SYN, EV_KEY, EV_REL = 0x00, 0x01, 0x02
REL_X = 0x00
SYN_REPORT = 0
BTN_MOUSE = 0x110

# struct input_event: timeval(long sec, long usec) + u16 type + u16 code + s32 value
_EVENT_FMT = "@llHHi"


class _Device:
    def __init__(self) -> None:
        self.fd = os.open(_UINPUT, os.O_WRONLY | os.O_NONBLOCK)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_REL)
        fcntl.ioctl(self.fd, UI_SET_RELBIT, REL_X)
        # A relative pointer device must declare a button to be recognised.
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        fcntl.ioctl(self.fd, UI_SET_KEYBIT, BTN_MOUSE)

        # struct uinput_user_dev: name[80] + input_id(8) + ff_effects_max(4)
        #   + absmax/absmin/absfuzz/absflat (s32[64] each = 1024)
        name = b"trailer-tv-nudge".ljust(80, b"\x00")
        input_id = struct.pack("@HHHH", 0x03, 0x1234, 0x5678, 1)  # BUS_USB
        ff_effects_max = struct.pack("@i", 0)
        abs_arrays = b"\x00" * (4 * 64 * 4)
        os.write(self.fd, name + input_id + ff_effects_max + abs_arrays)
        fcntl.ioctl(self.fd, UI_DEV_CREATE)
        time.sleep(0.05)  # let udev create the device node

    def _emit(self, etype: int, code: int, value: int) -> None:
        os.write(self.fd, struct.pack(_EVENT_FMT, 0, 0, etype, code, value))

    def jiggle(self) -> None:
        """Emit ONE real 1px move, alternating direction so the cursor doesn't drift.

        A combined +1/-1 in a single report nets zero and gamescope can coalesce it
        away, so we move a real single pixel each call and flip the sign next time.
        """
        self._dir = -getattr(self, "_dir", -1)  # start at +1
        self._emit(EV_REL, REL_X, self._dir)
        self._emit(EV_SYN, SYN_REPORT, 0)

    def close(self) -> None:
        try:
            fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        except OSError:
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass


_device: _Device | None = None


def nudge() -> dict[str, object]:
    """Emit one activity event, creating the virtual device on first use."""
    global _device  # pylint: disable=global-statement
    try:
        if _device is None:
            _device = _Device()
        _device.jiggle()
        return {"ok": True}
    except OSError as exc:
        _device = None
        return {"ok": False, "error": str(exc)}


def close() -> None:
    global _device  # pylint: disable=global-statement
    if _device is not None:
        _device.close()
        _device = None
