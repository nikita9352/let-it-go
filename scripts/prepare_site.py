#!/usr/bin/env python3
"""Build static Pages output with same-origin, pinned browser AI assets.

Run on a GitHub-hosted runner or locally with Python 3 and npm installed.
Only public model/runtime files are downloaded. No user photos or API keys.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
from urllib.request import Request, urlopen

MODEL_ID = "Xenova/clip-vit-base-patch32"
MODEL_REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a"
TRANSFORMERS_VERSION = "3.8.1"
RUNTIME_FILES = ("transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm")
METADATA_FILES = ("config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.json", "merges.txt", "README.md")
WEIGHTS = {
    "onnx/text_model_quantized.onnx": (64504507, "73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a"),
    "onnx/vision_model_quantized.onnx": (89117001, "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299"),
}
PUBLIC_FILES = ("index.html", "app.js", "styles.css", "icon.svg", "pdf.js", "pdf-lib.min.js", "ai.js", ".nojekyll")
ROOT = Path(__file__).resolve().parent.parent


def checked_weight(path: Path, expected: tuple[int, str]) -> bool:
    if not path.is_file() or path.stat().st_size != expected[0]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == expected[1]


def download(url: str, destination: Path, expected: tuple[int, str] | None = None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_name(destination.name + ".part")
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "LetItGo-Pages-Build/2.0"})
            with urlopen(request, timeout=120) as response, part.open("wb") as handle:
                shutil.copyfileobj(response, handle, length=1024 * 1024)
            if expected and not checked_weight(part, expected):
                raise RuntimeError("Model size/hash check failed; refusing to publish incomplete AI files")
            if not expected and not part.stat().st_size:
                raise RuntimeError("Downloaded an empty model metadata file")
            if destination.suffix == ".json":
                json.loads(part.read_text())
            part.replace(destination)
            return
        except Exception:
            part.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def prepare_runtime(runtime: Path) -> None:
    runtime.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="let-it-go-runtime-") as temporary:
        # npm verifies the published package integrity. Installation scripts never run.
        output = subprocess.check_output(["npm", "pack", "--ignore-scripts", "--json", f"@huggingface/transformers@{TRANSFORMERS_VERSION}", "--pack-destination", temporary], text=True)
        package = Path(temporary) / json.loads(output)[0]["filename"]
        with tarfile.open(package, "r:gz") as archive:
            for filename in RUNTIME_FILES:
                member = archive.getmember("package/dist/" + filename)
                if not member.isfile():
                    raise RuntimeError("Runtime asset is not a regular file: " + filename)
                with archive.extractfile(member) as source, (runtime / filename).open("wb") as target:
                    shutil.copyfileobj(source, target)
            # Preserve third-party notices shipped beside the bundled library.
            for member in archive.getmembers():
                if member.isfile() and (member.name.startswith("package/dist/") and "LICENSE" in member.name.upper() or member.name == "package/LICENSE"):
                    with archive.extractfile(member) as source, (runtime / Path(member.name).name).open("wb") as target:
                        shutil.copyfileobj(source, target)


def build_site(root: Path = ROOT) -> Path:
    site = root / "_site"
    # Build from a whitelist so old storage code, secrets, tests and source do not ship.
    if site.exists():
        shutil.rmtree(site)
    site.mkdir()
    for filename in PUBLIC_FILES:
        shutil.copy2(root / filename, site / filename)
    shutil.copytree(root / "assets", site / "assets")
    ai_assets = site / "ai-assets"
    prepare_runtime(ai_assets / "runtime")
    model = ai_assets / "models" / MODEL_ID
    for filename in METADATA_FILES:
        print("Preparing model metadata:", filename, flush=True)
        download(f"https://huggingface.co/{MODEL_ID}/resolve/{MODEL_REVISION}/{filename}", model / filename)
    for filename, expected in WEIGHTS.items():
        print("Preparing verified model weights:", filename, flush=True)
        download(f"https://huggingface.co/{MODEL_ID}/resolve/{MODEL_REVISION}/{filename}", model / filename, expected)
    files = [{"path": str(path.relative_to(ai_assets)), "bytes": path.stat().st_size} for path in sorted(ai_assets.rglob("*")) if path.is_file()]
    manifest = {"schemaVersion": 1, "modelId": MODEL_ID, "modelRevision": MODEL_REVISION, "transformersVersion": TRANSFORMERS_VERSION, "totalBytes": sum(item["bytes"] for item in files), "files": files}
    # Publish the readiness marker only after every asset passes its checks.
    (ai_assets / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Static site ready:", site, "AI asset bytes:", manifest["totalBytes"], flush=True)
    return site


if __name__ == "__main__":
    build_site()
