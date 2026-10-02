#!/usr/bin/env python3
"""Banco di prova per sistemi di memoria via MCP (solo stdlib).

Parla MCP direttamente (stdio o streamable HTTP), quindi lo stesso test gira
su agentmemory, Engram, basic-memory, mcp-memory-service, ecc. Ogni sistema
è descritto in adapters.json: comando di avvio + quale tool usare per
salvare e per cercare, con i nomi dei parametri.

Uso:
  python3 bench/memory/mcp_bench.py list-tools engram       # schema dei tool (per sistemare adapters.json)
  python3 bench/memory/mcp_bench.py run engram              # seed + query, salva results/<sistema>-<host>-<data>.json
  python3 bench/memory/mcp_bench.py run engram --skip-seed  # solo query (es. su un secondo PC dopo la sync)
  python3 bench/memory/mcp_bench.py compare                 # tabella riassuntiva di tutti i results/*.json

ATTENZIONE: "run" scrive 20 memorie finte (progetti bench-*). Usalo su
un'istanza o una data dir di test, non sulla memoria vera.
"""
import argparse
import json
import os
import platform
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
PROTOCOL = "2025-06-18"


class StdioClient:
    def __init__(self, command, args, env):
        full_env = dict(os.environ)
        full_env.update({k: os.path.expandvars(v) for k, v in (env or {}).items()})
        self.proc = subprocess.Popen(
            [command] + [os.path.expandvars(a) for a in args],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=full_env, text=True, bufsize=1,
        )
        self.lines = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _pump(self):
        for line in self.proc.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def _drain_stderr(self):
        for _ in self.proc.stderr:
            pass

    def send(self, msg):
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def request(self, msg, timeout):
        self.send(msg)
        deadline = time.time() + timeout
        while True:
            left = deadline - time.time()
            if left <= 0:
                raise TimeoutError(f"nessuna risposta a {msg['method']} entro {timeout}s")
            line = self.lines.get(timeout=left)
            if line is None:
                raise RuntimeError(f"il server è terminato (exit {self.proc.poll()})")
            line = line.strip()
            if not line.startswith("{"):
                continue  # log spuri su stdout
            data = json.loads(line)
            if data.get("id") == msg["id"]:
                return data

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


class HttpClient:
    def __init__(self, url, headers):
        self.url = os.path.expandvars(url)
        self.headers = {k: os.path.expandvars(v) for k, v in (headers or {}).items()}
        self.session = None

    def _post(self, msg, timeout):
        headers = {"Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream",
                   "MCP-Protocol-Version": PROTOCOL, **self.headers}
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        req = urllib.request.Request(self.url, data=json.dumps(msg).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            self.session = resp.headers.get("Mcp-Session-Id", self.session)
            body = resp.read().decode()
            if "text/event-stream" in resp.headers.get("Content-Type", ""):
                for line in body.splitlines():
                    if line.startswith("data:"):
                        data = json.loads(line[5:])
                        if data.get("id") == msg.get("id"):
                            return data
                return None
            return json.loads(body) if body.strip() else None

    def send(self, msg):
        self._post(msg, 30)

    def request(self, msg, timeout):
        return self._post(msg, timeout)

    def close(self):
        pass


class Mcp:
    def __init__(self, cfg, timeout):
        self.timeout = timeout
        self.next_id = 0
        if cfg.get("transport", "stdio") == "http":
            self.c = HttpClient(cfg["url"], cfg.get("headers"))
        else:
            self.c = StdioClient(cfg["command"], cfg.get("args", []), cfg.get("env"))
        self.call("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                 "clientInfo": {"name": "kb-mcp-bench", "version": "1.0"}})
        self.c.send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def call(self, method, params):
        self.next_id += 1
        resp = self.c.request({"jsonrpc": "2.0", "id": self.next_id, "method": method,
                               "params": params}, self.timeout)
        if resp is None:
            raise RuntimeError(f"risposta vuota a {method}")
        if "error" in resp:
            raise RuntimeError(f"{method}: {resp['error']}")
        return resp["result"]

    def tools(self):
        return self.call("tools/list", {}).get("tools", [])

    def tool(self, name, args):
        res = self.call("tools/call", {"name": name, "arguments": args})
        parts = []
        for item in res.get("content", []):
            if item.get("type") == "text":
                parts.append(item["text"])
            elif item.get("type") == "resource":
                parts.append(json.dumps(item["resource"], ensure_ascii=False))
        if res.get("structuredContent"):
            parts.append(json.dumps(res["structuredContent"], ensure_ascii=False))
        if res.get("isError"):
            raise RuntimeError(f"{name}: {' '.join(parts)[:300]}")
        return "\n".join(parts)

    def close(self):
        self.c.close()


def fill(template, values):
    """Sostituisce {text}, {query}, {id}, {project}, {title} nei valori stringa."""
    if isinstance(template, str):
        m = re.fullmatch(r"\{(\w+)\}", template)
        if m and m.group(1) in values:
            return values[m.group(1)]
        return template.format(**values) if "{" in template else template
    if isinstance(template, list):
        return [fill(t, values) for t in template]
    if isinstance(template, dict):
        return {k: fill(v, values) for k, v in template.items()}
    return template


def load_adapters(path):
    data = json.loads(Path(path).read_text())
    return {k: v for k, v in data.items() if not k.startswith("_")}


def cmd_list_tools(args):
    cfg = load_adapters(args.adapters)[args.system]
    mcp = Mcp(cfg, args.timeout)
    try:
        for t in mcp.tools():
            props = t.get("inputSchema", {}).get("properties", {})
            req = t.get("inputSchema", {}).get("required", [])
            params = ", ".join(f"{p}{'*' if p in req else ''}" for p in props)
            print(f"- {t['name']}({params})\n    {(t.get('description') or '').splitlines()[0][:110] if t.get('description') else ''}")
    finally:
        mcp.close()


def matches(text, fact):
    low = text.lower()
    return all(k.lower() in low for k in fact["keywords"])


def cmd_run(args):
    cfg = load_adapters(args.adapters)[args.system]
    ds = json.loads(Path(args.dataset).read_text())
    facts = {f["id"]: f for f in ds["facts"]}
    mcp = Mcp(cfg, args.timeout)
    out = {"system": args.system, "host": platform.node(), "date": datetime.now().isoformat(timespec="seconds"),
           "seeded": not args.skip_seed, "save_ms": [], "queries": [], "errors": []}
    try:
        if not args.skip_seed:
            print(f"Seed di {len(facts)} fatti su {args.system}...")
            for f in ds["facts"]:
                vals = {"text": f["text"], "id": f["id"], "project": f["project"],
                        "title": f"{f['project']} {f['id']}", "query": ""}
                t0 = time.time()
                try:
                    mcp.tool(cfg["save"]["tool"], fill(cfg["save"]["args"], vals))
                    out["save_ms"].append(round((time.time() - t0) * 1000))
                except Exception as e:
                    out["errors"].append(f"save {f['id']}: {e}")
                    print(f"  ! {f['id']}: {e}", file=sys.stderr)
            settle = cfg.get("settle_seconds", args.settle)
            if settle:
                print(f"Attendo {settle}s per l'indicizzazione...")
                time.sleep(settle)
        for q in ds["queries"]:
            vals = {"query": q["query"], "text": "", "id": q["id"], "title": "",
                    "project": facts[q["fact"]]["project"]}
            t0 = time.time()
            try:
                text = mcp.tool(cfg["search"]["tool"], fill(cfg["search"]["args"], vals))
            except Exception as e:
                out["errors"].append(f"search {q['id']}: {e}")
                text = ""
            ms = round((time.time() - t0) * 1000)
            hit = matches(text, facts[q["fact"]])
            noise = sum(1 for fid, f in facts.items() if fid != q["fact"] and matches(text, f))
            out["queries"].append({"id": q["id"], "kind": q["kind"], "hit": hit, "ms": ms,
                                   "other_facts": noise, "chars": len(text)})
            print(f"  {'OK ' if hit else 'NO '} {q['id']} [{q['kind']:<10}] {ms:>5} ms  altri fatti: {noise}")
    finally:
        mcp.close()
    RESULTS.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    dest = RESULTS / f"{args.system}-{platform.node()}-{stamp}.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print_summary([out])
    print(f"\nRisultati: {dest}")


def summarize(r):
    qs = r["queries"]
    def rate(kind=None):
        sel = [q for q in qs if kind is None or q["kind"] == kind]
        return f"{100 * sum(q['hit'] for q in sel) / len(sel):.0f}%" if sel else "-"
    ms = sorted(q["ms"] for q in qs) or [0]
    save = sorted(r.get("save_ms") or [0])
    noise = sum(q["other_facts"] for q in qs) / max(len(qs), 1)
    return [r["system"], r["host"], rate(), rate("paraphrase"), rate("keyword"), rate("cross"),
            f"{noise:.1f}", str(ms[len(ms) // 2]), str(save[len(save) // 2]), str(len(r["errors"]))]


def print_summary(results):
    head = ["sistema", "host", "recall", "parafrasi", "keyword", "cross", "rumore", "query ms (med)",
            "save ms (med)", "errori"]
    rows = [summarize(r) for r in results]
    print("\n| " + " | ".join(head) + " |\n|" + "---|" * len(head))
    for row in rows:
        print("| " + " | ".join(row) + " |")


def cmd_compare(args):
    files = sorted(RESULTS.glob("*.json"))
    if not files:
        sys.exit("Nessun risultato in bench/memory/results/")
    print_summary([json.loads(f.read_text()) for f in files])
    print("\nrumore = quanti ALTRI fatti del dataset compaiono in media in ogni risposta (più basso = più preciso)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--adapters", default=str(HERE / "adapters.json"))
    p.add_argument("--dataset", default=str(HERE / "dataset.json"))
    p.add_argument("--timeout", type=float, default=120, help="timeout per chiamata MCP (s)")
    sub = p.add_subparsers(dest="cmd", required=True)
    lt = sub.add_parser("list-tools")
    lt.add_argument("system")
    r = sub.add_parser("run")
    r.add_argument("system")
    r.add_argument("--skip-seed", action="store_true", help="non scrivere, solo cercare")
    r.add_argument("--settle", type=float, default=5, help="attesa dopo il seed (s)")
    sub.add_parser("compare")
    args = p.parse_args()
    {"list-tools": cmd_list_tools, "run": cmd_run, "compare": cmd_compare}[args.cmd](args)


if __name__ == "__main__":
    main()
