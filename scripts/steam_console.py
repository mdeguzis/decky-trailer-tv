#!/usr/bin/env python3
"""Interactive JS console against the Steam Deck's Game Mode UI (SharedJSContext).

Connects to the Deck's CEF remote debugger and evaluates JavaScript in the same
context the Steam UI runs in -- so `SteamClient`, `settingsStore`, etc. are all in
scope. Promises are awaited automatically, so you can type an expression that
returns a Promise and see the resolved value.

Usage:
  make steam-console DECK_IP=192.168.1.x                 # interactive REPL
  make steam-console DECK_IP=192.168.1.x JS='<expr>'     # one-shot

Examples to try in the REPL:
  window.settingsStore.m_ClientSettings.system_idle_screensaver_ac_sec
  Object.keys(SteamClient.System)
  SteamClient.System.Display                              # see what methods exist
  JSON.stringify(await new Promise(r=>SteamClient.System.RegisterForBatteryStateChanges(s=>r(s))))
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

import aiohttp

BANNER = """\
Steam console -- evaluates JS in the Game Mode SharedJSContext.
Promises are auto-awaited. Type an expression and press Enter.
Commands: 'exit' / 'quit' / Ctrl-D to leave.
Tip: `Object.keys(SteamClient.System)` to explore the API.
"""


async def evaluate(ws: aiohttp.ClientWebSocketResponse, idref: list, expr: str) -> str:
    mid = idref[0]
    idref[0] += 1
    await ws.send_str(
        json.dumps(
            {
                "id": mid,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expr,
                    "returnByValue": True,
                    "awaitPromise": True,
                    "userGesture": True,
                },
            }
        )
    )
    async for msg in ws:
        if msg.type != aiohttp.WSMsgType.TEXT:
            continue
        data = json.loads(msg.data)
        if data.get("id") != mid:
            continue  # ignore unrelated events
        if "error" in data:
            return f"PROTOCOL ERROR: {json.dumps(data['error'])}"
        result = data.get("result", {})
        if result.get("exceptionDetails"):
            exc = result["exceptionDetails"].get("exception", {})
            return "JS EXCEPTION: " + (exc.get("description") or json.dumps(result["exceptionDetails"]))
        val = result.get("result", {})
        if "value" in val:
            v = val["value"]
            return json.dumps(v, indent=2) if isinstance(v, (dict, list)) else repr(v)
        # Not serializable by value (function, complex object, etc.)
        bits = [val.get("type", "?")]
        if val.get("subtype"):
            bits.append(val["subtype"])
        if val.get("description"):
            bits.append(val["description"])
        return "<" + " ".join(bits) + ">"
    return "<connection closed>"


async def repl(ws: aiohttp.ClientWebSocketResponse) -> None:
    idref = [100]
    loop = asyncio.get_event_loop()
    print(BANNER)
    while True:
        try:
            expr = await loop.run_in_executor(None, lambda: input("steam> "))
        except (EOFError, KeyboardInterrupt):
            print()
            return
        expr = expr.strip()
        if not expr:
            continue
        if expr in ("exit", "quit", ".exit"):
            return
        print(await evaluate(ws, idref, expr))


async def run(deck_ip: str, port: int, one_shot: str | None) -> int:
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
                "Is the Deck on the Steam UI with remote debugging enabled "
                "(make setup-remote-dev)?",
                file=sys.stderr,
            )
            return 1

        target = next(
            (t for t in targets if t.get("title") == "SharedJSContext" and t.get("webSocketDebuggerUrl")),
            None,
        )
        if not target:
            print(
                "No SharedJSContext target found. Titles seen: "
                + ", ".join(repr(t.get("title")) for t in targets),
                file=sys.stderr,
            )
            return 1

        async with session.ws_connect(target["webSocketDebuggerUrl"], timeout=20) as ws:
            if one_shot:
                print(await evaluate(ws, [1], one_shot))
            else:
                await repl(ws)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Interactive JS console for the Steam Deck UI.")
    parser.add_argument("--deck-ip", default="127.0.0.1", help="Deck IP; omit for a local Steam session")
    parser.add_argument("--deck-user", default="deck", help="Accepted for Makefile parity; unused")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--eval", dest="one_shot", default=None, help="Evaluate one expression and exit")
    args = parser.parse_args()
    return asyncio.run(run(args.deck_ip.strip() or "127.0.0.1", args.port, args.one_shot))


if __name__ == "__main__":
    raise SystemExit(main())
