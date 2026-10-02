#!/usr/bin/env python3
"""Sincronizza la memoria agentmemory tra piu' PC senza un server centrale.

Ogni PC fa girare il proprio agentmemory locale. Il DB live (data/state_store.db)
NON si sincronizza: e' binario e scritto di continuo. Si sincronizzano invece
gli export JSON, uno per PC:

    memories/sync/<nodo>.json    scritto SOLO dal PC <nodo>

Cosi' git non ha mai conflitti (ognuno tocca solo il proprio file). Ad ogni sync:
  1. git pull                      (prende i file degli altri PC)
  2. import                        (per ogni record degli altri PC: aggiunto se manca,
                                    sovrascritto se il loro e' piu' recente)
  3. export                        (riscrive il proprio file, ordinato e stabile)
  4. git commit + push             (solo il proprio file)

Con --dir si usa una cartella (OneDrive, share SMB) al posto di git: stessa logica,
senza i passi 1 e 4.

Limiti: le cancellazioni non si propagano (un record cancellato su un PC torna
dagli altri); tutti i PC devono avere la stessa versione di agentmemory.

Uso:
    python3 scripts/memory-sync.py [sync|export|import] [--dir CARTELLA] [--dry-run]

Variabili:
    KB_MEMORY_URL       agentmemory locale (default http://127.0.0.1:3111)
    AGENTMEMORY_SECRET  token Bearer, se il server ne richiede uno
    KB_SYNC_NODE        nome di questo PC nei file (default hostname)
    KB_SYNC_DIR         equivalente di --dir
"""
import argparse
import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DIR = REPO_DIR / "memories" / "sync"

# Collezioni dell'export indicizzate per chiave (come le scrive mem::import)
KEYED = {
    "sessions": "id",
    "memories": "id",
    "summaries": "sessionId",
    "profiles": "project",
    "graphNodes": "id",
    "graphEdges": "id",
    "semanticMemories": "id",
    "proceduralMemories": "id",
    "actions": "id",
    "actionEdges": "id",
    "routines": "id",
    "signals": "id",
    "checkpoints": "id",
    "sentinels": "id",
    "sketches": "id",
    "crystals": "id",
    "facets": "id",
    "lessons": "id",
    "insights": "id",
}
# Cambiano ad ogni lettura: solo rumore nei commit
DROPPED = ("accessLogs", "pagination")
TS_FIELDS = ("updatedAt", "lastUpdated", "createdAt", "timestamp", "startedAt")


def log(msg):
    print(f"[memory-sync] {msg}", flush=True)


def die(msg):
    log(f"ERRORE: {msg}")
    sys.exit(1)


# ---------------------------------------------------------------- API ---
def api(method, path, body=None):
    base = os.environ.get("KB_MEMORY_URL", "http://127.0.0.1:3111").rstrip("/")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    secret = os.environ.get("AGENTMEMORY_SECRET")
    if secret:
        req.add_header("Authorization", f"Bearer {secret}")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        die(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:300]}")
    except urllib.error.URLError as e:
        die(f"agentmemory non raggiungibile su {base} ({e.reason}). E' avviato?")


def fetch_export():
    data = api("GET", "/agentmemory/export")
    if not isinstance(data, dict) or "version" not in data:
        die(f"export inatteso: {str(data)[:300]}")
    if data.get("pagination", {}).get("hasMore"):
        die("export paginato (memoria troppo grande): non supportato ancora")
    return data


# ------------------------------------------------------- normalizzazione ---
def normalize(export):
    """Export stabile: stesso contenuto -> stessi byte (diff git minimi)."""
    out = {"version": export["version"]}
    for name, key in KEYED.items():
        items = export.get(name)
        if items:
            out[name] = sorted(items, key=lambda x: str(x.get(key, "")))
    obs = export.get("observations") or {}
    out["observations"] = {
        sid: sorted(items, key=lambda x: str(x.get("id", "")))
        for sid, items in sorted(obs.items()) if items
    }
    for name in ("sessions", "memories", "summaries"):
        out.setdefault(name, [])
    return out


def ts(record):
    for f in TS_FIELDS:
        v = record.get(f)
        if isinstance(v, str) and v:
            return v
    return ""


def newer(remote, local):
    """True se il record remoto va importato sopra quello locale."""
    if local is None:
        return True
    if remote == local:
        return False
    return ts(remote) > ts(local)


def delta(remote, local):
    """Record di `remote` mancanti o piu' recenti rispetto a `local`."""
    out, count = {}, 0
    for name, key in KEYED.items():
        loc = {str(x.get(key)): x for x in local.get(name) or []}
        picked = [x for x in remote.get(name) or [] if newer(x, loc.get(str(x.get(key))))]
        if picked:
            out[name] = picked
            count += len(picked)
    out_obs = {}
    local_obs = local.get("observations") or {}
    for sid, items in (remote.get("observations") or {}).items():
        loc = {str(x.get("id")): x for x in local_obs.get(sid, [])}
        picked = [x for x in items if newer(x, loc.get(str(x.get("id"))))]
        if picked:
            out_obs[sid] = picked
            count += len(picked)
    out["observations"] = out_obs
    for name in ("sessions", "memories", "summaries"):
        out.setdefault(name, [])
    return out, count


# --------------------------------------------------------------- passi ---
def node_name():
    name = os.environ.get("KB_SYNC_NODE") or socket.gethostname().split(".")[0]
    return re.sub(r"[^A-Za-z0-9_-]", "-", name).lower() or "pc"


def step_import(sync_dir, node, dry_run):
    local = normalize(fetch_export())
    total = 0
    for f in sorted(sync_dir.glob("*.json")):
        if f.stem == node:
            continue
        try:
            remote = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            log(f"salto {f.name}: illeggibile ({e})")
            continue
        if remote.get("version") != local["version"]:
            log(f"salto {f.name}: versione {remote.get('version')} != locale {local['version']}")
            continue
        payload, count = delta(remote, local)
        if not count:
            log(f"{f.stem}: niente di nuovo")
            continue
        log(f"{f.stem}: {count} record nuovi o aggiornati")
        total += count
        if dry_run:
            continue
        payload["version"] = local["version"]
        payload["exportedAt"] = datetime.now(timezone.utc).isoformat()
        res = api("POST", "/agentmemory/import", {"exportData": payload, "strategy": "merge"})
        if isinstance(res, dict) and res.get("success") is False:
            die(f"import da {f.name} fallito: {res.get('error')}")
        # i record importati ora sono locali: non reimportarli dal file successivo
        local = normalize(fetch_export())
    return total


def step_export(sync_dir, node, dry_run):
    data = normalize(fetch_export())
    target = sync_dir / f"{node}.json"
    text = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if target.exists() and target.read_text(encoding="utf-8") == text:
        log(f"{target.name}: invariato")
        return target, False
    if not dry_run:
        sync_dir.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, target)
    log(f"{target.name}: scritto ({len(data['memories'])} memorie, "
        f"{sum(len(v) for v in data['observations'].values())} osservazioni)")
    return target, True


def git(*args, check=True):
    r = subprocess.run(["git", "-C", str(REPO_DIR), *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        die(f"git {' '.join(args)}: {r.stderr.strip() or r.stdout.strip()}")
    return r


def git_pull():
    r = git("pull", "--rebase", "--autostash", check=False)
    if r.returncode != 0:
        git("rebase", "--abort", check=False)
        die(f"git pull fallito, repo lasciato com'era: {r.stderr.strip()}")


def git_push(path, node):
    rel = path.relative_to(REPO_DIR).as_posix()
    git("add", "--", rel)
    if git("diff", "--cached", "--quiet", "--", rel, check=False).returncode == 0:
        return
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    git("commit", "-m", f"memory-sync: {node} {stamp}", "--", rel)
    for _ in range(3):
        if git("push", check=False).returncode == 0:
            log("push completato")
            return
        git_pull()  # qualcun altro ha pushato nel frattempo
    die("push fallito dopo 3 tentativi")


def lock(sync_dir):
    """Evita due sync in parallelo sullo stesso PC (cron + manuale)."""
    try:
        import fcntl
    except ImportError:  # Windows: niente lock
        return None
    sync_dir.mkdir(parents=True, exist_ok=True)
    fh = open(REPO_DIR / ".memory-sync.lock", "w")
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        die("un altro memory-sync e' gia' in corso")
    return fh


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("command", nargs="?", default="sync", choices=("sync", "export", "import"))
    p.add_argument("--dir", default=os.environ.get("KB_SYNC_DIR"),
                   help="cartella condivisa (OneDrive/share) invece di git")
    p.add_argument("--dry-run", action="store_true", help="mostra cosa farebbe, non scrive")
    a = p.parse_args()

    use_git = not a.dir
    sync_dir = Path(a.dir).expanduser() if a.dir else DEFAULT_DIR
    node = node_name()
    _lock = lock(sync_dir)
    log(f"nodo '{node}', cartella {sync_dir}{' (git)' if use_git else ''}")

    if a.command == "sync" and use_git and not a.dry_run:
        git_pull()
    if a.command in ("sync", "import"):
        step_import(sync_dir, node, a.dry_run)
    if a.command in ("sync", "export"):
        path, changed = step_export(sync_dir, node, a.dry_run)
        if a.command == "sync" and use_git and changed and not a.dry_run:
            git_push(path, node)


if __name__ == "__main__":
    main()
