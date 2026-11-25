"""Network-free integrity and publication tests for the GitHub Pages builder."""
from __future__ import annotations

from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare_site.py"
SPEC = importlib.util.spec_from_file_location("let_it_go_prepare_site", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(builder)


def digest(data: bytes) -> tuple[int, str]:
    return len(data), hashlib.sha256(data).hexdigest()


def response(data: bytes) -> io.BytesIO:
    return io.BytesIO(data)


def create_source(root: Path) -> None:
    for filename in builder.PUBLIC_FILES:
        (root / filename).write_text("public:" + filename, encoding="utf-8")
    (root / "assets").mkdir()
    (root / "assets" / "plant.svg").write_text("<svg/>", encoding="utf-8")
    # Removed hosting/storage code, local configuration and credentials must
    # never become public merely because they are beside the authored files.
    for filename in ("config.js", "hosted-share.js", "local-share.js", ".env", ".env.production", "private-key.pem", "README.md"):
        (root / filename).write_text("DO_NOT_PUBLISH_" + filename, encoding="utf-8")
    for directory in ("worker", "drizzle", "checks", "scripts"):
        (root / directory).mkdir()
        (root / directory / "private-source.txt").write_text("DO_NOT_PUBLISH", encoding="utf-8")


def runtime_fixture(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for filename in builder.RUNTIME_FILES:
        (destination / filename).write_bytes(("runtime:" + filename).encode())
    (destination / "LICENSE").write_text("MIT runtime notice", encoding="utf-8")


class IntegrityTests(unittest.TestCase):
    def test_checked_weight_requires_exact_size_and_sha256(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "weights.onnx"
            payload = b"small verified model fixture"
            target.write_bytes(payload)
            self.assertTrue(builder.checked_weight(target, digest(payload)))
            self.assertFalse(builder.checked_weight(target, (len(payload) + 1, digest(payload)[1])))
            self.assertFalse(builder.checked_weight(target, (len(payload), "0" * 64)))
            self.assertFalse(builder.checked_weight(target.with_name("missing.onnx"), digest(payload)))

    def test_download_rejects_bad_hash_without_publishing_partial_or_replacing_existing(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "models" / "weights.onnx"
            target.parent.mkdir()
            target.write_bytes(b"previous verified file")
            supplied = b"wrong model bytes"
            expected = (len(supplied), hashlib.sha256(b"different data").hexdigest())
            with mock.patch.object(builder, "urlopen", side_effect=lambda *_a, **_k: response(supplied)), mock.patch.object(builder.time, "sleep"):
                with self.assertRaisesRegex(RuntimeError, "size/hash"):
                    builder.download("https://example.test/weights.onnx", target, expected)
            self.assertEqual(target.read_bytes(), b"previous verified file")
            self.assertFalse(target.with_name("weights.onnx.part").exists())

    def test_download_rejects_bad_size_and_invalid_json(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "weights.onnx"
            with mock.patch.object(builder, "urlopen", side_effect=lambda *_a, **_k: response(b"short")), mock.patch.object(builder.time, "sleep"):
                with self.assertRaisesRegex(RuntimeError, "size/hash"):
                    builder.download("https://example.test/weights.onnx", target, digest(b"longer fixture"))
            self.assertFalse(target.exists())
            metadata = Path(temporary) / "config.json"
            with mock.patch.object(builder, "urlopen", side_effect=lambda *_a, **_k: response(b"<html>not model metadata</html>")), mock.patch.object(builder.time, "sleep"):
                with self.assertRaises(json.JSONDecodeError):
                    builder.download("https://example.test/config.json", metadata)
            self.assertFalse(metadata.exists())
            self.assertEqual(list(Path(temporary).glob("*.part")), [])

    def test_successful_download_replaces_only_after_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "weights.onnx"
            payload = b"valid fixture weights"
            with mock.patch.object(builder, "urlopen", return_value=response(payload)) as fetch:
                builder.download("https://example.test/weights.onnx", target, digest(payload))
            self.assertEqual(target.read_bytes(), payload)
            self.assertFalse(target.with_name("weights.onnx.part").exists())
            self.assertEqual(fetch.call_count, 1)


class RuntimeTests(unittest.TestCase):
    def mock_npm_pack(self, argv, *, text=True, omit=None, symlink=None):
        self.assertTrue(text)
        self.assertEqual(argv[:4], ["npm", "pack", "--ignore-scripts", "--json"])
        self.assertIn("@huggingface/transformers@3.8.1", argv)
        package_dir = Path(argv[argv.index("--pack-destination") + 1])
        package_name = "huggingface-transformers-3.8.1.tgz"
        records = {"package/dist/" + filename: ("bundled:" + filename).encode() for filename in builder.RUNTIME_FILES if filename != omit}
        records.update({
            "package/LICENSE": b"MIT top-level notice",
            "package/dist/transformers.min.js.LICENSE.txt": b"Bundled dependency notices",
            "package/src/not-public.js": b"source should not ship",
            "package/package.json": b'{"version":"3.8.1"}',
        })
        with tarfile.open(package_dir / package_name, "w:gz") as archive:
            for name, payload in records.items():
                member = tarfile.TarInfo(name)
                if name == "package/dist/" + str(symlink):
                    member.type = tarfile.SYMTYPE
                    member.linkname = "../../../private-key.pem"
                    archive.addfile(member)
                else:
                    member.size = len(payload)
                    archive.addfile(member, io.BytesIO(payload))
        return json.dumps([{"filename": package_name}])

    def test_exact_runtime_paths_and_license_notices_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(builder.subprocess, "check_output", side_effect=self.mock_npm_pack):
            target = Path(temporary) / "runtime"
            builder.prepare_runtime(target)
            self.assertEqual({p.name for p in target.iterdir()}, set(builder.RUNTIME_FILES) | {"LICENSE", "transformers.min.js.LICENSE.txt"})
            for filename in builder.RUNTIME_FILES:
                self.assertEqual((target / filename).read_bytes(), ("bundled:" + filename).encode())
            self.assertEqual((target / "LICENSE").read_text(), "MIT top-level notice")
            self.assertEqual((target / "transformers.min.js.LICENSE.txt").read_text(), "Bundled dependency notices")

    def test_missing_or_nonregular_runtime_file_stops_preparation(self):
        with tempfile.TemporaryDirectory() as temporary:
            for mode in ("missing", "symlink"):
                with self.subTest(mode=mode):
                    def pack(argv, **kwargs):
                        return self.mock_npm_pack(argv, **kwargs, **({"omit": builder.RUNTIME_FILES[-1]} if mode == "missing" else {"symlink": builder.RUNTIME_FILES[-1]}))
                    with mock.patch.object(builder.subprocess, "check_output", side_effect=pack):
                        with self.assertRaises((KeyError, RuntimeError)):
                            builder.prepare_runtime(Path(temporary) / mode)


class PublicationTests(unittest.TestCase):
    def test_successful_manifest_uses_pinned_local_assets_and_whitelisted_site(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_source(root)
            fixture = b"verified tiny weights"
            weights = {"onnx/text_model_quantized.onnx": digest(fixture), "onnx/vision_model_quantized.onnx": digest(fixture)}
            requested = []
            def fetch(request, **_kwargs):
                url = request.full_url
                requested.append(url)
                self.assertIn("/resolve/" + builder.MODEL_REVISION + "/", url)
                # The readiness marker must not exist during any dependency fetch.
                self.assertFalse((root / "_site" / "ai-assets" / "manifest.json").exists())
                return response(fixture if url.endswith(".onnx") else b'{"fixture":true}')
            with mock.patch.object(builder, "prepare_runtime", side_effect=runtime_fixture), mock.patch.object(builder, "WEIGHTS", weights), mock.patch.object(builder, "METADATA_FILES", ("config.json", "preprocessor_config.json")), mock.patch.object(builder, "urlopen", side_effect=fetch), redirect_stdout(io.StringIO()):
                site = builder.build_site(root)
            self.assertEqual(site, root / "_site")
            self.assertEqual({p.name for p in site.iterdir()}, set(builder.PUBLIC_FILES) | {"assets", "ai-assets"})
            for excluded in ("config.js", "hosted-share.js", "local-share.js", ".env", ".env.production", "private-key.pem", "worker", "drizzle", "checks", "scripts", "README.md"):
                self.assertFalse((site / excluded).exists(), excluded)
            self.assertEqual((site / "assets" / "plant.svg").read_text(), "<svg/>")
            manifest_path = site / "ai-assets" / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(manifest["modelId"], "Xenova/clip-vit-base-patch32")
            self.assertEqual(manifest["modelRevision"], "d15189d7028b43f1d3e65039190477f6af591c2a")
            self.assertEqual(manifest["transformersVersion"], "3.8.1")
            paths = {entry["path"] for entry in manifest["files"]}
            self.assertIn("runtime/transformers.min.js", paths)
            self.assertIn("models/Xenova/clip-vit-base-patch32/onnx/vision_model_quantized.onnx", paths)
            self.assertTrue(all(not path.startswith(("/", "http:", "https:")) and ".." not in Path(path).parts for path in paths))
            self.assertEqual(manifest["totalBytes"], sum(entry["bytes"] for entry in manifest["files"]))
            self.assertEqual(manifest["totalBytes"], sum(p.stat().st_size for p in (site / "ai-assets").rglob("*") if p.is_file() and p != manifest_path))
            self.assertEqual(len(requested), 4)

    def test_interrupted_weight_download_removes_stale_readiness_and_partial_file(self):
        class Interrupted(io.BytesIO):
            def __init__(self):
                super().__init__(b"partial model")
                self.reads = 0
            def read(self, *args):
                self.reads += 1
                if self.reads > 1:
                    raise OSError("network interrupted")
                return super().read(*args)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            create_source(root)
            stale = root / "_site" / "ai-assets"
            stale.mkdir(parents=True)
            (stale / "manifest.json").write_text('{"old":true}')
            def fetch(request, **_kwargs):
                return Interrupted() if request.full_url.endswith(".onnx") else response(b'{}')
            with mock.patch.object(builder, "prepare_runtime", side_effect=runtime_fixture), mock.patch.object(builder, "WEIGHTS", {"onnx/text_model_quantized.onnx": digest(b"complete model")}), mock.patch.object(builder, "METADATA_FILES", ("config.json",)), mock.patch.object(builder, "urlopen", side_effect=fetch), mock.patch.object(builder.time, "sleep"), redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(OSError, "network interrupted"):
                    builder.build_site(root)
            self.assertFalse((root / "_site" / "ai-assets" / "manifest.json").exists())
            self.assertEqual(list((root / "_site").rglob("*.part")), [])
            self.assertFalse((root / "_site" / "ai-assets" / "models" / builder.MODEL_ID / "onnx" / "text_model_quantized.onnx").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
