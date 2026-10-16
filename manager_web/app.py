#!/usr/bin/env python3
"""Local-only web console for the Docker client manager."""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
CLIENT_SCRIPT = ROOT / "client"
CLIENTS_DIR = ROOT / "clients"
CORES_DIR = ROOT / "cores"
COMPOSE_FILE = ROOT / "docker" / "compose.yml"
WEB_DIR = Path(__file__).resolve().parent
HOSTS_FILE = Path(os.environ.get("MANAGER_HOSTS_FILE", "/etc/hosts"))
CLIENT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,47}\Z")
HOST_NAME = re.compile(r"[A-Za-z0-9._-]+(?::[0-9]{1,5})?\Z")
CORE_MAJOR = re.compile(r"[1-9][0-9]?\Z")
BACKUP_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.sql(?:\.gz)?\Z")
ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
PHP_IMAGES = [
    "php:7.4-fpm-bullseye",
    "php:8.0-fpm-bullseye",
    "php:8.1-fpm-bullseye",
    "php:8.2-fpm-bookworm",
    "php:8.3-fpm-bookworm",
    "php:8.4-fpm-bookworm",
]
ACTION_ARGS = {
    "start": lambda client, _payload: ["up", client],
    "stop": lambda client, _payload: ["down", client],
    "restart": lambda client, _payload: ["restart", client],
    "build": lambda client, _payload: ["build", client],
    "sanitize": lambda client, _payload: ["sanitize", client],
}
CONFIRM_ACTIONS = {"stop", "restart", "build", "sanitize", "restore"}
MAX_BODY_SIZE = 32 * 1024
MAX_UPLOAD_SIZE = 2_000_000_000
MAX_OUTPUT_SIZE = 120_000


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def client_dir(client: str) -> Path:
    if not CLIENT_NAME.fullmatch(client):
        raise ValueError("Nom d’instance invalide.")
    candidate = (CLIENTS_DIR / client).resolve()
    try:
        candidate.relative_to(CLIENTS_DIR.resolve())
    except ValueError:
        raise ValueError("Instance invalide.")
    if not (candidate / ".env").is_file():
        raise FileNotFoundError("Instance introuvable.")
    return candidate


def clean_output(value: str | bytes | None) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    if not value:
        return ""
    output = ANSI_ESCAPE.sub("", value).strip()
    if len(output) > MAX_OUTPUT_SIZE:
        output = "…\n" + output[-MAX_OUTPUT_SIZE:]
    return output


def version_key(version: str) -> tuple[tuple[int, int | str], ...]:
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part.casefold())
        for part in re.split(r"(\d+)", version)
        if part
    )


def available_versions() -> list[str]:
    versions = []
    if not CORES_DIR.is_dir():
        return versions
    for path in CORES_DIR.iterdir():
        if path.is_dir() and path.name.startswith("dolibarr-") and (path / "htdocs").is_dir():
            versions.append(path.name[len("dolibarr-"):])
    return sorted(versions, key=version_key, reverse=True)


def read_instance(client: str) -> dict[str, str]:
    directory = client_dir(client)
    values = parse_env(directory / ".env")
    core_path = values.get("DOLI_CORE_PATH", "")
    version_match = re.search(r"dolibarr-([^/]+)(?:/htdocs)?/?$", core_path)
    vhost = values.get("VHOST", "")
    url = "http://" + vhost + "/" if HOST_NAME.fullmatch(vhost) else ""
    return {
        "name": client,
        "version": version_match.group(1) if version_match else "—",
        "phpImage": values.get("PHP_IMAGE", "—"),
        "url": url,
        "project": values.get("PROJECT", "") or client,
        "envFile": str(directory / ".env"),
    }


def inspect_instance(client: str) -> dict[str, object]:
    try:
        instance = read_instance(client)
        env_file = instance.pop("envFile")
        command = [
            "docker",
            "compose",
            "-f",
            str(COMPOSE_FILE),
            "--env-file",
            env_file,
            "-p",
            str(instance["project"]),
            "ps",
            "--all",
            "--format",
            "{{.State}}",
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=12,
            check=False,
        )
        if result.returncode != 0:
            instance["status"] = "error"
            instance["statusDetail"] = clean_output(result.stderr or result.stdout)
        else:
            states = [line.strip().casefold() for line in result.stdout.splitlines() if line.strip()]
            running = sum(state == "running" for state in states)
            instance["status"] = (
                "stopped" if not running else "running" if running == len(states) and len(states) >= 2 else "partial"
            )
            instance["statusDetail"] = ""
        return instance
    except subprocess.TimeoutExpired:
        return {"name": client, "status": "error", "statusDetail": "Docker ne répond pas dans le délai imparti."}
    except Exception as error:
        return {"name": client, "status": "error", "statusDetail": str(error)}


def list_instances() -> list[dict[str, object]]:
    if not CLIENTS_DIR.is_dir():
        return []
    names = sorted(
        path.name
        for path in CLIENTS_DIR.iterdir()
        if path.is_dir() and CLIENT_NAME.fullmatch(path.name) and (path / ".env").is_file()
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(inspect_instance, names))


def list_backups(client: str) -> list[dict[str, object]]:
    directory = client_dir(client) / "db"
    if not directory.is_dir():
        return []
    backups = []
    resolved_directory = directory.resolve()
    for path in directory.iterdir():
        if not path.is_file() or not (path.name.endswith(".sql") or path.name.endswith(".sql.gz")):
            continue
        try:
            resolved = path.resolve(strict=True)
            if resolved.parent != resolved_directory:
                continue
            stat = resolved.stat()
            backups.append({"name": path.name, "size": stat.st_size, "modified": stat.st_mtime})
        except OSError:
            continue
    return sorted(backups, key=lambda item: float(item["modified"]), reverse=True)


def run_client(args: list[str], timeout: int, extra_env: dict[str, str] | None = None) -> dict[str, object]:
    environment = os.environ.copy()
    environment.update({"TERM": "dumb", "NO_COLOR": "1"})
    if extra_env:
        environment.update(extra_env)
    command = ["bash", str(CLIENT_SCRIPT), *args]
    client_uid = os.environ.get("MANAGER_CLIENT_UID")
    if client_uid:
        command = [
            "setpriv",
            "--reuid",
            client_uid,
            "--regid",
            os.environ["MANAGER_CLIENT_GID"],
            "--groups",
            os.environ["MANAGER_CLIENT_GROUPS"],
            "--",
            *command,
        ]
        environment["HOME"] = "/tmp"
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        output = clean_output((result.stdout or "") + ("\n" if result.stdout and result.stderr else "") + (result.stderr or ""))
        return {"ok": result.returncode == 0, "output": output, "exitCode": result.returncode}
    except subprocess.TimeoutExpired as error:
        return {
            "ok": False,
            "output": clean_output(error.stdout or error.stderr) or "Délai dépassé pendant l’opération.",
            "exitCode": None,
        }


def ensure_host_entry(host: str) -> None:
    if not HOST_NAME.fullmatch(host) or ":" in host:
        raise ValueError("Nom d’hôte invalide pour /etc/hosts.")

    contents = HOSTS_FILE.read_text(encoding="utf-8", errors="replace")
    addresses = []
    for line in contents.splitlines():
        fields = line.split("#", 1)[0].split()
        if len(fields) > 1 and any(alias.casefold() == host.casefold() for alias in fields[1:]):
            addresses.append(fields[0])
    if addresses:
        if any(address != "127.0.0.1" for address in addresses):
            raise ValueError(f"{host} est déjà associé à une autre adresse dans /etc/hosts.")
        return

    if contents and not contents.endswith("\n"):
        contents += "\n"
    HOSTS_FILE.write_text(contents + f"127.0.0.1 {host}\n", encoding="utf-8")


def get_logs(client: str) -> dict[str, object]:
    instance = read_instance(client)
    command = [
        "docker",
        "compose",
        "-f",
        str(COMPOSE_FILE),
        "--env-file",
        instance["envFile"],
        "-p",
        instance["project"],
        "logs",
        "--no-color",
        "--tail=200",
    ]
    try:
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=20, check=False)
        return {
            "ok": result.returncode == 0,
            "logs": clean_output(result.stdout),
            "error": clean_output(result.stderr) if result.returncode else "",
        }
    except subprocess.TimeoutExpired as error:
        return {"ok": False, "logs": clean_output(error.stdout), "error": "Délai dépassé lors de la lecture des logs."}


class ManagerHandler(BaseHTTPRequestHandler):
    server_version = "ClientManager"
    sys_version = ""

    def log_message(self, format: str, *args: object) -> None:
        print("[%s] %s" % (self.log_date_time_string(), format % args), flush=True)

    def send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8")

    def send_error_json(self, status: int, message: str) -> None:
        self.send_json(status, {"error": message})

    def check_host(self) -> bool:
        allowed = {"127.0.0.1:" + str(self.server.server_port), "localhost:" + str(self.server.server_port)}
        configured_host = self.server.allowed_host
        if configured_host:
            allowed.update({configured_host, configured_host + ":" + str(self.server.server_port)})
        return self.headers.get("Host", "").casefold() in allowed

    def require_access(self) -> bool:
        if not self.check_host():
            self.send_error_json(403, "En-tête Host refusé.")
            return False
        return True

    def read_json(self) -> dict[str, object]:
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Le contenu doit être au format JSON.")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_SIZE:
            raise ValueError("Taille de requête invalide.")
        self.check_origin()
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Corps de requête invalide.")
        return data

    def check_origin(self) -> None:
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            allowed = {"127.0.0.1:" + str(self.server.server_port), "localhost:" + str(self.server.server_port)}
            if self.server.allowed_host:
                allowed.update({self.server.allowed_host, self.server.allowed_host + ":" + str(self.server.server_port)})
            if parsed.scheme != "http" or parsed.netloc.casefold() not in allowed:
                raise PermissionError("Origine de requête refusée.")

    def do_GET(self) -> None:
        if not self.require_access():
            return
        parsed = urlsplit(self.path)
        if parsed.path in {"/", "/instances", "/cores", "/app.css", "/app.js"} or re.fullmatch(r"/instances/[A-Za-z0-9][A-Za-z0-9_-]{0,47}/?", parsed.path):
            file_name = parsed.path.lstrip("/") if parsed.path in {"/app.css", "/app.js"} else "index.html"
            path = WEB_DIR / file_name
            content_type = {
                ".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
            }[path.suffix]
            try:
                self.send_bytes(200, path.read_bytes(), content_type)
            except OSError:
                self.send_error_json(500, "Fichier de l’interface introuvable.")
            return
        if parsed.path == "/api/instances":
            self.send_json(200, {"instances": list_instances()})
            return
        if parsed.path == "/api/catalog":
            self.send_json(200, {"versions": available_versions(), "phpImages": PHP_IMAGES})
            return
        match = re.fullmatch(r"/api/instances/([^/]+)/(logs|backups)", parsed.path)
        if match:
            try:
                client = unquote(match.group(1))
                client_dir(client)
                if match.group(2) == "logs":
                    self.send_json(200, get_logs(client))
                else:
                    self.send_json(200, {"backups": list_backups(client)})
            except (FileNotFoundError, ValueError) as error:
                self.send_error_json(404, str(error))
            except Exception:
                self.send_error_json(500, "Impossible de lire les données de cette instance.")
            return
        self.send_error_json(404, "Route introuvable.")

    def do_POST(self) -> None:
        if not self.require_access():
            return
        try:
            payload = self.read_json()
        except PermissionError as error:
            self.send_error_json(403, str(error))
            return
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            self.send_error_json(400, str(error) or "Corps de requête invalide.")
            return

        path = urlsplit(self.path).path
        if path == "/api/instances":
            self.create_instance(payload)
        elif path == "/api/actions":
            self.run_action(payload)
        elif path == "/api/cores/update":
            self.update_cores()
        elif path == "/api/cores":
            self.add_core(payload)
        elif path == "/api/source/update":
            self.update_source()
        else:
            self.send_error_json(404, "Route introuvable.")

    def do_PUT(self) -> None:
        if not self.require_access():
            return
        try:
            self.check_origin()
        except PermissionError as error:
            self.send_error_json(403, str(error))
            return

        parsed = urlsplit(self.path)
        match = re.fullmatch(r"/api/instances/([^/]+)/backups", parsed.path)
        if not match:
            self.send_error_json(404, "Route introuvable.")
            return
        if self.headers.get_content_type() != "application/octet-stream":
            self.send_error_json(415, "Le dump doit être envoyé en octets bruts.")
            return
        raw_length = self.headers.get("Content-Length", "")
        if not raw_length.isdecimal():
            self.send_error_json(411, "Taille du fichier manquante.")
            return
        length = int(raw_length)
        if length <= 0 or length > MAX_UPLOAD_SIZE:
            self.send_error_json(413, "Le fichier doit peser entre 1 octet et 2 Go.")
            return
        names = parse_qs(parsed.query, keep_blank_values=True).get("filename", [])
        if len(names) != 1 or not BACKUP_NAME.fullmatch(names[0]):
            self.send_error_json(400, "Nom de fichier invalide. Utilisez un fichier .sql ou .sql.gz sans caractères spéciaux.")
            return

        try:
            client = unquote(match.group(1))
            directory = client_dir(client) / "db"
            self.save_backup(directory, names[0], length)
            self.send_json(201, {"backup": names[0]})
        except FileExistsError:
            self.send_error_json(409, "Un fichier portant ce nom existe déjà.")
        except FileNotFoundError as error:
            self.send_error_json(404, str(error))
        except ValueError as error:
            self.send_error_json(400, str(error))
        except OSError:
            self.send_error_json(500, "Impossible d’enregistrer le dump.")

    def save_backup(self, directory: Path, name: str, length: int) -> None:
        client_root = directory.parent.resolve()
        created_directory = not directory.exists()
        directory.mkdir(mode=0o750, exist_ok=True)
        if directory.is_symlink() or directory.resolve().parent != client_root:
            raise ValueError("Dossier de sauvegarde invalide.")
        if created_directory:
            uid = os.environ.get("MANAGER_CLIENT_UID")
            gid = os.environ.get("MANAGER_CLIENT_GID")
            if uid and gid:
                os.chown(directory, int(uid), int(gid))
            os.chmod(directory, 0o750)

        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix=".upload-", delete=False) as dump:
                temporary = Path(dump.name)
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Téléversement interrompu.")
                    dump.write(chunk)
                    remaining -= len(chunk)
            uid = os.environ.get("MANAGER_CLIENT_UID")
            gid = os.environ.get("MANAGER_CLIENT_GID")
            if uid and gid:
                os.chown(temporary, int(uid), int(gid))
            os.chmod(temporary, 0o640)
            os.link(temporary, directory / name)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def update_cores(self) -> None:
        result = run_client(["cores-update"], timeout=1800)
        self.send_json(200 if result["ok"] else 422, result)

    def update_source(self) -> None:
        result = run_client(["source-update"], timeout=1800)
        self.send_json(200 if result["ok"] else 422, result)

    def add_core(self, payload: dict[str, object]) -> None:
        version = payload.get("version")
        if not isinstance(version, str) or not CORE_MAJOR.fullmatch(version):
            self.send_error_json(400, "Saisissez une version stable majeure entre 1 et 99, par exemple 24.")
            return
        result = run_client(["core-add", version], timeout=900)
        self.send_json(200 if result["ok"] else 422, result)

    def create_instance(self, payload: dict[str, object]) -> None:
        name = payload.get("name")
        version = payload.get("version")
        php_image = payload.get("phpImage")
        if not isinstance(name, str) or not CLIENT_NAME.fullmatch(name):
            self.send_error_json(400, "Nom d’instance invalide.")
            return
        if not isinstance(version, str) or version not in available_versions():
            self.send_error_json(400, "Version Dolibarr indisponible.")
            return
        if not isinstance(php_image, str) or php_image not in PHP_IMAGES:
            self.send_error_json(400, "Image PHP indisponible.")
            return
        if (CLIENTS_DIR / name).exists():
            self.send_error_json(409, "Une instance portant ce nom existe déjà.")
            return
        result = run_client(
            ["create", name, version, php_image],
            timeout=300,
            extra_env={"CLIENT_SKIP_HOSTS_UPDATE": "1"},
        )
        if result["ok"]:
            try:
                host = parse_env(CLIENTS_DIR / name / ".env").get("VHOST", "")
                if not host:
                    raise ValueError("Le domaine de l’instance est absent de son fichier .env.")
                ensure_host_entry(host)
            except (OSError, ValueError) as error:
                output = str(result.get("output", "")).strip()
                result["ok"] = False
                result["output"] = f"{output}\n\nInstance créée, mais ajout de son domaine local impossible : {error}".strip()
        self.send_json(200 if result["ok"] else 422, result)

    def run_action(self, payload: dict[str, object]) -> None:
        client = payload.get("client")
        action = payload.get("action")
        if not isinstance(client, str) or not CLIENT_NAME.fullmatch(client):
            self.send_error_json(400, "Instance invalide.")
            return
        if not isinstance(action, str) or action not in (*ACTION_ARGS.keys(), "restore"):
            self.send_error_json(400, "Action indisponible.")
            return
        try:
            client_dir(client)
        except (FileNotFoundError, ValueError) as error:
            self.send_error_json(404, str(error))
            return
        if action in CONFIRM_ACTIONS and payload.get("confirmation") != client:
            self.send_error_json(400, "Confirmation de l’instance requise.")
            return

        if action == "restore":
            backup_name = payload.get("backup")
            if not isinstance(backup_name, str) or Path(backup_name).name != backup_name:
                self.send_error_json(400, "Sauvegarde invalide.")
                return
            try:
                available = {item["name"] for item in list_backups(client)}
            except (ValueError, FileNotFoundError) as error:
                self.send_error_json(404, str(error))
                return
            if backup_name not in available:
                self.send_error_json(400, "Sauvegarde introuvable dans le dossier de cette instance.")
                return
            result = run_client(["restore", client, str(client_dir(client) / "db" / backup_name)], timeout=900)
        else:
            args = ACTION_ARGS[action](client, payload)
            result = run_client(args, timeout=600 if action == "build" else 900 if action == "sanitize" else 300)
        self.send_json(200 if result["ok"] else 422, result)


def main() -> None:
    allowed_host = os.environ.get("MANAGER_ALLOWED_HOST", "")
    if allowed_host and not HOST_NAME.fullmatch(allowed_host):
        raise SystemExit("MANAGER_ALLOWED_HOST doit être un nom d’hôte valide.")
    try:
        port = int(os.environ.get("MANAGER_PORT", "8765"))
        if not 1024 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit("MANAGER_PORT doit être un port entre 1024 et 65535.")

    bind_address = os.environ.get("MANAGER_BIND_ADDRESS", "127.0.0.1")
    server = ThreadingHTTPServer((bind_address, port), ManagerHandler)
    server.allowed_host = allowed_host
    if allowed_host:
        print(f"Console accessible via http://{allowed_host}", flush=True)
    else:
        print(f"Console prête sur http://127.0.0.1:{port}", flush=True)
    print(f"Adresse d’écoute : {bind_address}:{port}.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt de la console.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
