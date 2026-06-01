#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["aiohttp>=3.9"]
# ///
"""Capture the current Steam Deck Game Mode UI via CEF remote debugging.

Connects directly to the Deck's CEF debugger (http://<deck-ip>:8081), picks the
visible Game Mode page, and saves a PNG via Chrome DevTools Page.captureScreenshot.

Remote debugging must be enabled on the Deck (touch ~/.steam/steam/
.cef-enable-remote-debugging, which `make setup-remote-dev` does for you).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
from datetime import datetime
from pathlib import Path

import aiohttp

# Which CEF target to screenshot, in priority order. The visible Game Mode
# window is usually "Steam Big Picture Mode"; SharedJSContext renders the same
# UI tree and is the fallback.
TITLE_PRIORITY = ["Steam Big Picture Mode", "SharedJSContext"]


def pick_target(targets: list) -> dict | None:
    """Choose the best inspectable page target to capture."""
    pages = [t for t in targets if isinstance(t, dict) and t.get("webSocketDebuggerUrl")]
    for wanted in TITLE_PRIORITY:
        for target in pages:
            if target.get("title") == wanted:
                return target
    for target in pages:
        if target.get("type") == "page":
            return target
    return pages[0] if pages else None


async def capture(deck_ip: str, port: int, out_path: Path, debug: bool) -> int:
    base = f"http://{deck_ip}:{port}"
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(
                f"{base}/json/list", timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                targets = await resp.json(content_type=None)
        except Exception as exc:  # noqa: BLE001
            print(
                f"Could not reach CEF debugger at {base}: {exc}\n"
                "Is the Deck on, on the Steam UI, with remote debugging enabled "
                "(make setup-remote-dev)?",
                file=sys.stderr,
            )
            return 1

        if debug:
            for target in targets:
                if isinstance(target, dict):
                    print(
                        f"  target: title={target.get('title')!r} "
                        f"type={target.get('type')} url={target.get('url')}",
                        file=sys.stderr,
                    )

        target = pick_target(targets)
        if not target:
            print("No inspectable CEF target found.", file=sys.stderr)
            return 1
        print(f"Capturing target: {target.get('title')!r} ({target.get('url')})")

        async with session.ws_connect(target["webSocketDebuggerUrl"], timeout=15) as ws:
            await ws.send_str(json.dumps({"id": 1, "method": "Page.enable"}))
            await ws.send_str(
                json.dumps(
                    {
                        "id": 2,
                        "method": "Page.captureScreenshot",
                        "params": {"format": "png", "captureBeyondViewport": False},
                    }
                )
            )
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                data = json.loads(msg.data)
                if data.get("id") != 2:
                    continue
                if "error" in data:
                    print(f"captureScreenshot failed: {data['error']}", file=sys.stderr)
                    return 1
                out_path.write_bytes(base64.b64decode(data["result"]["data"]))
                print(f"Saved screenshot to: {out_path}")
                return 0
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Capture the Steam Deck Game Mode UI via CEF remote debugging."
    )
    parser.add_argument(
        "--deck-ip", default="127.0.0.1", help="Deck IP; omit for a local Steam session"
    )
    parser.add_argument("--deck-user", default="deck", help="Accepted for Makefile parity; unused")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--filename-base", default="trailer-tv")
    parser.add_argument("--debug", action="store_true", help="List all CEF targets to stderr")
    args = parser.parse_args()

    out_dir = Path(args.output_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_path = out_dir / f"{args.filename_base}-{stamp}.png"

    return asyncio.run(capture(args.deck_ip.strip() or "127.0.0.1", args.port, out_path, args.debug))


if __name__ == "__main__":
    raise SystemExit(main())
