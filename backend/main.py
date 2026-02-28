"""
Vyke IDE – Backend FastAPI
Hébergé sur asmo-01 · Intégration Ollama
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from pathlib import Path
from typing import List

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ─── Chemins ─────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
PROJECTS_DIR = BASE_DIR / "projects"
FRONTEND_DIR = BASE_DIR / "frontend"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

# ─── Config (lue depuis les variables d'env exportées par start.sh) ───────────
OLLAMA_URL         = os.getenv("VYKE_OLLAMA_URL",   "http://localhost:11434")
DEFAULT_CHAT_MODEL = os.getenv("VYKE_CHAT_MODEL",   "mistral-small3.2:24b")
DEFAULT_CODE_MODEL = os.getenv("VYKE_CODE_MODEL",   "qwen2.5-coder:7b")
WORKSPACE_ROOT     = Path(os.getenv("VYKE_WORKSPACE", str(Path.home()))).resolve()

# Dossiers à ignorer dans l'explorateur
_SKIP = frozenset({
    ".git", "__pycache__", ".DS_Store", "node_modules",
    "venv", ".venv", ".mypy_cache", ".pytest_cache",
    "dist", "build", ".next", ".nuxt",
})

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Vyke IDE API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Modèles Pydantic ────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    history: List[dict] = []
    model: str = DEFAULT_CHAT_MODEL
    # Contexte IDE — fichier actuellement ouvert dans l'éditeur
    current_code: str = ""
    current_file: str = ""
    current_language: str = ""

class CompletionRequest(BaseModel):
    code: str
    language: str = "python"
    model: str = DEFAULT_CODE_MODEL

class FileWrite(BaseModel):
    filename: str
    content: str

class RenameRequest(BaseModel):
    old_name: str
    new_name: str

class WorkspaceWrite(BaseModel):
    path: str
    content: str

class RunRequest(BaseModel):
    code: str
    language: str = "python"
    timeout: int = 30   # secondes
    stdin_data: str = ""  # lignes pré-fournies pour input()


# Interprètes supportés (vérifiés à l'exécution)
LANG_RUNNERS: dict[str, list[str]] = {
    "python":     ["python3", "-u"],   # -u = unbuffered → stream immédiat
    "javascript": ["node"],
    "bash":       ["bash"],
    "sh":         ["bash"],
}
LANG_SUFFIXES: dict[str, str] = {
    "python":     ".py",
    "javascript": ".js",
    "bash":       ".sh",
    "sh":         ".sh",
}


# ─── Helpers ─────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = (
    "Tu es Vyke, un assistant de programmation expert. "
    "Tu es précis, concis et tu fournis toujours du code de qualité. "
    "Quand tu montres du code, utilise des blocs markdown avec la syntaxe appropriée. "
    "Si tu n'es pas sûr de quelque chose, dis-le clairement."
)


def build_code_context(code: str, filename: str, language: str) -> str:
    """Formate le code de l'éditeur pour l'injection dans le system prompt."""
    if not code.strip():
        return ""

    lang  = language or "code"
    fname = filename or "fichier actuel"
    lines = code.split("\n")
    total = len(lines)

    # Plafond : 300 lignes ou 12 000 caractères
    MAX_LINES, MAX_CHARS = 300, 12_000
    excerpt = "\n".join(lines[:MAX_LINES])
    if total > MAX_LINES:
        excerpt += f"\n# … {total - MAX_LINES} ligne(s) supplémentaire(s) omise(s) …"
    if len(excerpt) > MAX_CHARS:
        excerpt = excerpt[:MAX_CHARS] + "\n# … [tronqué] …"

    return (
        f"\n\n"
        f"╔══ CONTEXTE IDE (fichier ouvert) ═══════════════╗\n"
        f"║  Fichier  : {fname}\n"
        f"║  Langage  : {lang}   |   {total} ligne(s)\n"
        f"╚════════════════════════════════════════════════╝\n"
        f"```{lang}\n{excerpt}\n```\n"
        f"(Tu as accès à ce fichier en temps réel. "
        f"Quand l'utilisateur parle de « ce code », « cette fonction », "
        f"« mon fichier » etc., réfère-toi à ce contexte.)\n"
    )


def build_prompt(
    history: List[dict],
    message: str,
    current_code: str = "",
    current_file: str = "",
    current_language: str = "",
) -> str:
    code_ctx = build_code_context(current_code, current_file, current_language)
    system   = SYSTEM_PROMPT + code_ctx

    prompt = f"<s>[INST] {system} [/INST]</s>\n"
    for msg in history[-12:]:
        role    = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            prompt += f"[INST] {content} [/INST]"
        else:
            prompt += f" {content} </s>"
    prompt += f"[INST] {message} [/INST]"
    return prompt


def safe_workspace(rel: str) -> Path:
    """Résout un chemin relatif au workspace et vérifie qu'on y reste."""
    target = (WORKSPACE_ROOT / rel).resolve() if rel else WORKSPACE_ROOT
    if not str(target).startswith(str(WORKSPACE_ROOT)):
        raise HTTPException(400, "Accès refusé hors du workspace.")
    return target


def safe_path(filename: str) -> Path:
    """Vérifie qu'on reste dans PROJECTS_DIR (anti path-traversal)."""
    resolved = (PROJECTS_DIR / filename).resolve()
    if not str(resolved).startswith(str(PROJECTS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
    return resolved


# ─── Routes API ──────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    """Vérifie la connexion à Ollama."""
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{OLLAMA_URL}/api/tags")
            models = [m["name"] for m in r.json().get("models", [])]
            return {"status": "ok", "ollama": True, "models": models}
    except Exception as exc:
        return {"status": "degraded", "ollama": False, "error": str(exc)}


@app.get("/api/models")
async def get_models():
    """Liste les modèles Ollama disponibles."""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{OLLAMA_URL}/api/tags")
            models = [m["name"] for m in r.json().get("models", [])]
            return {
                "models": models or [DEFAULT_CHAT_MODEL],
                "default_chat": DEFAULT_CHAT_MODEL,
                "default_code": DEFAULT_CODE_MODEL,
            }
    except Exception:
        return {
            "models": [DEFAULT_CHAT_MODEL, DEFAULT_CODE_MODEL],
            "default_chat": DEFAULT_CHAT_MODEL,
            "default_code": DEFAULT_CODE_MODEL,
        }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Stream de réponse chat depuis Ollama."""
    prompt = build_prompt(
        req.history, req.message,
        current_code=req.current_code,
        current_file=req.current_file,
        current_language=req.current_language,
    )

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=180) as c:
                async with c.stream(
                    "POST",
                    f"{OLLAMA_URL}/api/generate",
                    json={"model": req.model, "prompt": prompt, "stream": True},
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line.strip():
                            try:
                                data = json.loads(line)
                                if token := data.get("response", ""):
                                    yield token
                                if data.get("done"):
                                    break
                            except json.JSONDecodeError:
                                pass
        except Exception as exc:
            yield f"\n\n[ERREUR VYKE: {exc}]"

    return StreamingResponse(generate(), media_type="text/plain")


@app.post("/api/complete")
async def complete(req: CompletionRequest):
    """Auto-complétion de code via Ollama (non-streaming)."""
    lines = req.code.split("\n")
    context = "\n".join(lines[-25:])

    prompt = (
        f"Complete this {req.language} code. "
        "Output ONLY the continuation code, no explanation, no markdown, "
        "no repetition of the existing code. Just the next logical lines:\n\n"
        f"{context}"
    )

    try:
        async with httpx.AsyncClient(timeout=45) as c:
            r = await c.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": req.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.15, "top_p": 0.9, "num_predict": 256},
                },
            )
            data = r.json()
            completion = data.get("response", "").strip()
            # Nettoyer les blocs markdown si présents
            if "```" in completion:
                m = re.search(r"```(?:\w+)?\n?(.*?)```", completion, re.DOTALL)
                if m:
                    completion = m.group(1).strip()
            return {"completion": completion, "model": req.model}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Explorateur de fichiers (workspace) ─────────────────────────────────────

@app.get("/api/browse")
async def browse(path: str = ""):
    """Liste le contenu d'un dossier du workspace (navigation serveur)."""
    target = safe_workspace(path)
    if not target.is_dir():
        raise HTTPException(404, "Dossier introuvable.")
    try:
        raw = list(target.iterdir())
    except PermissionError:
        raise HTTPException(403, "Permission refusée.")

    items = []
    for item in sorted(raw, key=lambda x: (x.is_file(), x.name.lower())):
        if item.name in _SKIP or item.name.startswith("."):
            continue
        is_dir = item.is_dir()
        rel    = str(item.relative_to(WORKSPACE_ROOT))
        try:
            size = item.stat().st_size if not is_dir else None
        except OSError:
            size = None
        items.append({
            "name": item.name,
            "path": rel,
            "type": "dir" if is_dir else "file",
            "ext":  item.suffix.lstrip(".").lower() if not is_dir else "",
            "size": size,
        })

    parent = str(target.parent.relative_to(WORKSPACE_ROOT)) if target != WORKSPACE_ROOT else None
    return {
        "path":     str(target.relative_to(WORKSPACE_ROOT)) if target != WORKSPACE_ROOT else "",
        "abs_path": str(target),
        "name":     target.name,
        "parent":   parent,
        "items":    items,
    }


@app.get("/api/workspace/read")
async def workspace_read(path: str):
    """Lit un fichier du workspace par chemin relatif."""
    fp = safe_workspace(path)
    if not fp.is_file():
        raise HTTPException(404, "Fichier introuvable.")
    try:
        content = fp.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "Fichier binaire non supporté.")
    except OSError as e:
        raise HTTPException(500, str(e))
    return {"path": path, "name": fp.name, "content": content}


@app.post("/api/workspace/write")
async def workspace_write(req: WorkspaceWrite):
    """Écrit un fichier dans le workspace."""
    fp = safe_workspace(req.path)
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(req.content, encoding="utf-8")
    return {"status": "saved", "path": req.path}


# ─── Exécution de code ───────────────────────────────────────────────────────

@app.post("/api/run")
async def run_code(req: RunRequest):
    """Exécute du code et streame stdout/stderr en NDJSON."""
    runner = LANG_RUNNERS.get(req.language)
    if not runner:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Langage '{req.language}' non supporté à l'exécution. "
                f"Langages disponibles : {', '.join(LANG_RUNNERS)}"
            ),
        )

    suffix = LANG_SUFFIXES.get(req.language, ".txt")

    async def generate():
        tmp_path: str | None = None
        proc: asyncio.subprocess.Process | None = None

        try:
            # Écrire le code dans un fichier temporaire
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=suffix, delete=False, encoding="utf-8"
            ) as f:
                f.write(req.code)
                tmp_path = f.name

            proc = await asyncio.create_subprocess_exec(
                *runner, tmp_path,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(PROJECTS_DIR),
                limit=2 * 1024 * 1024,  # 2 MB buffer
            )

            # Envoyer le stdin pré-fourni puis fermer (EOF)
            if req.stdin_data:
                stdin_bytes = req.stdin_data.encode("utf-8")
                if not stdin_bytes.endswith(b"\n"):
                    stdin_bytes += b"\n"
                proc.stdin.write(stdin_bytes)
            await proc.stdin.drain()
            proc.stdin.close()

            # Lire stdout et stderr de manière concurrente via une Queue
            queue: asyncio.Queue = asyncio.Queue()

            async def pump(stream: asyncio.StreamReader, tag: str) -> None:
                try:
                    async for chunk in stream:
                        await queue.put((tag, chunk.decode("utf-8", errors="replace")))
                finally:
                    await queue.put((tag + "_done", None))

            asyncio.create_task(pump(proc.stdout, "out"))
            asyncio.create_task(pump(proc.stderr, "err"))

            done = 0
            deadline = asyncio.get_event_loop().time() + req.timeout

            while done < 2:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    proc.kill()
                    msg = f"\n⏱ TIMEOUT: processus interrompu après {req.timeout}s\n"
                    yield json.dumps({"t": "err", "d": msg}) + "\n"
                    done = 2  # sortir de la boucle
                    break

                try:
                    tag, data = await asyncio.wait_for(
                        queue.get(), timeout=min(remaining, 0.5)
                    )
                except asyncio.TimeoutError:
                    continue

                if tag.endswith("_done"):
                    done += 1
                else:
                    yield json.dumps({"t": tag, "d": data}) + "\n"

            await proc.wait()
            yield json.dumps({"t": "exit", "d": str(proc.returncode)}) + "\n"

        except FileNotFoundError:
            interp = runner[0]
            yield json.dumps({
                "t": "err",
                "d": f"Interprète '{interp}' introuvable sur le serveur.\n"
                     f"Installe-le : sudo apt install {interp}\n",
            }) + "\n"
            yield json.dumps({"t": "exit", "d": "127"}) + "\n"

        except Exception as exc:
            yield json.dumps({"t": "err", "d": f"\n[ERREUR INTERNE: {exc}]\n"}) + "\n"
            yield json.dumps({"t": "exit", "d": "1"}) + "\n"

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    return StreamingResponse(generate(), media_type="application/x-ndjson")


# ─── Gestion des fichiers ─────────────────────────────────────────────────────

@app.get("/api/files")
async def list_files():
    """Liste les fichiers du projet."""
    files = []
    for f in PROJECTS_DIR.iterdir():
        if f.is_file() and not f.name.startswith("."):
            stat = f.stat()
            files.append({
                "name": f.name,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "ext": f.suffix.lstrip(".") or "txt",
            })
    return {"files": sorted(files, key=lambda x: x["modified"], reverse=True)}


@app.get("/api/files/{filename:path}")
async def read_file(filename: str):
    """Lit un fichier projet."""
    fp = safe_path(filename)
    if not fp.exists() or not fp.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    try:
        return {"filename": filename, "content": fp.read_text(encoding="utf-8")}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/files")
async def write_file(req: FileWrite):
    """Sauvegarde un fichier projet."""
    fp = safe_path(req.filename)
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(req.content, encoding="utf-8")
    return {"status": "saved", "filename": req.filename}


@app.delete("/api/files/{filename:path}")
async def delete_file(filename: str):
    """Supprime un fichier projet."""
    fp = safe_path(filename)
    if fp.exists():
        fp.unlink()
    return {"status": "deleted", "filename": filename}


@app.post("/api/files/rename")
async def rename_file(req: RenameRequest):
    """Renomme un fichier projet."""
    old_fp = safe_path(req.old_name)
    new_fp = safe_path(req.new_name)
    if not old_fp.exists():
        raise HTTPException(status_code=404, detail="Fichier source introuvable.")
    old_fp.rename(new_fp)
    return {"status": "renamed", "old_name": req.old_name, "new_name": req.new_name}


# ─── Servir le frontend (DOIT être en dernier) ───────────────────────────────
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
