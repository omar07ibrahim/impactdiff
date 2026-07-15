import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, renameSync, writeFileSync } from "node:fs";
import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import test from "node:test";

import { PNG } from "pngjs";

import {
  ArtifactStore,
  assertDisjointArtifactStores,
  auditArtifactStorePair,
} from "../src/artifacts/cas.js";
import type { ArtifactCodec } from "../src/artifacts/cas.js";
import { ArtifactStoreError } from "../src/artifacts/errors.js";
import { canonicalizePng } from "../src/artifacts/png.js";
import type { ArtifactRef } from "../src/contracts/artifacts.js";

const mediaType = "application/vnd.impactdiff.capture-spec+json";
const otherMediaType = "application/vnd.impactdiff.layout+json";

interface CaptureDocument {
  readonly contract: string;
  readonly [key: string]: unknown;
}

interface TemporaryStore {
  readonly root: string;
  readonly store: ArtifactStore;
}

function normalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry));
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, normalizeJson(entry)]),
  );
}

function parseJson(bytes: Buffer): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

const jsonCodec: ArtifactCodec<CaptureDocument> = Object.freeze({
  mediaType,
  maximumBytes: 65_536,
  canonicalize: (bytes: Buffer) =>
    Buffer.from(JSON.stringify(normalizeJson(parseJson(bytes))), "utf8"),
  validate: (bytes: Buffer) => {
    const value = parseJson(bytes);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("contract" in value) ||
      typeof value.contract !== "string"
    ) {
      throw new TypeError("capture document requires a string contract");
    }
    return value as CaptureDocument;
  },
});

const otherCodec: ArtifactCodec<unknown> = Object.freeze({
  mediaType: otherMediaType,
  maximumBytes: 65_536,
  canonicalize: jsonCodec.canonicalize,
  validate: (bytes: Buffer) => parseJson(bytes),
});

const pngCodec: ArtifactCodec<{ readonly width: number; readonly height: number }> =
  Object.freeze({
    mediaType: "image/png",
    maximumBytes: 8_388_608,
    canonicalize: (bytes: Buffer) => canonicalizePng(bytes).bytes,
    validate: (bytes: Buffer) => {
      const png = canonicalizePng(bytes);
      return Object.freeze({ width: png.width, height: png.height });
    },
  });

function document(contract: string, extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({ contract, ...extra }), "utf8");
}

async function temporaryStore(
  parent?: string,
  codecs: readonly ArtifactCodec<unknown>[] = [jsonCodec],
): Promise<TemporaryStore> {
  const root =
    parent === undefined
      ? await mkdtemp(join(tmpdir(), "impactdiff-cas-"))
      : join(parent, "nested-store");
  if (parent !== undefined) {
    await mkdir(root, { mode: 0o700 });
  }
  return { root, store: await ArtifactStore.open(root, codecs) };
}

async function removeStore(root: string): Promise<void> {
  await rm(root, { force: true, recursive: true });
}

function leafPath(root: string, digest: string): string {
  return join(root, "sha256", digest.slice(0, 2), digest);
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function installRawLeaf(
  root: string,
  bytes: Buffer,
  leafMode = 0o400,
  referenceMediaType = mediaType,
): Promise<ArtifactRef> {
  const sha256 = digest(bytes);
  const path = leafPath(root, sha256);
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, leafMode);
  return Object.freeze({
    sha256,
    byte_length: bytes.length,
    media_type: referenceMediaType,
    format_version: 1,
  });
}

function expectStoreError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ArtifactStoreError && error.code === code;
}

test("put canonicalizes before hashing and publishes exact private modes", async () => {
  const { root, store } = await temporaryStore();
  try {
    const raw = Buffer.from('{ "value": 2, "contract": "capture" }\n');
    const canonical = Buffer.from('{"contract":"capture","value":2}');
    const reference = await store.put(raw, jsonCodec);
    const path = leafPath(root, reference.sha256);

    assert.equal(reference.sha256, digest(canonical));
    assert.equal(reference.byte_length, canonical.length);
    assert.equal(reference.media_type, mediaType);
    assert.deepEqual(await readFile(path), canonical);
    assert.deepEqual(await store.readBytes(reference, jsonCodec), canonical);
    assert.deepEqual(await store.resolve(reference, jsonCodec), {
      contract: "capture",
      value: 2,
    });

    const uid = process.getuid?.();
    for (const directory of [root, join(root, "sha256"), dirname(path)]) {
      const stats = await stat(directory);
      assert.equal(stats.mode & 0o7777, 0o700);
      assert.equal(stats.uid, uid);
    }
    const leafStats = await stat(path);
    assert.equal(leafStats.mode & 0o7777, 0o400);
    assert.equal(leafStats.uid, uid);
    assert.equal(leafStats.nlink, 1);

    const audit = await store.audit([reference]);
    assert.deepEqual([...audit.entries.keys()], [reference.sha256]);
  } finally {
    await removeStore(root);
  }
});

test("writes are serialized and concurrent same-digest puts converge", async () => {
  let activeCanonicalizers = 0;
  let maximumActiveCanonicalizers = 0;
  const delayedCodec: ArtifactCodec<CaptureDocument> = Object.freeze({
    ...jsonCodec,
    canonicalize: async (bytes: Buffer) => {
      activeCanonicalizers += 1;
      maximumActiveCanonicalizers = Math.max(
        maximumActiveCanonicalizers,
        activeCanonicalizers,
      );
      await waitForImmediate();
      try {
        return await jsonCodec.canonicalize(bytes);
      } finally {
        activeCanonicalizers -= 1;
      }
    },
  });
  const { root, store } = await temporaryStore(undefined, [delayedCodec]);
  try {
    const payload = Buffer.from('{ "contract": "same" }');
    const references = await Promise.all(
      Array.from({ length: 16 }, async () => store.put(payload, delayedCodec)),
    );

    assert.equal(maximumActiveCanonicalizers, 1);
    assert.equal(new Set(references.map(({ sha256 }) => sha256)).size, 1);
    const reference = references[0];
    assert.ok(reference !== undefined);
    const path = leafPath(root, reference.sha256);
    assert.equal((await stat(path)).nlink, 1);
    assert.deepEqual(await readdir(dirname(path)), [reference.sha256]);
    assert.equal((await store.audit([reference])).entries.size, 1);
  } finally {
    await removeStore(root);
  }
});

test("only the codec registered at open can authorize an artifact", async () => {
  const { root, store } = await temporaryStore();
  try {
    const permissiveClone: ArtifactCodec<unknown> = {
      mediaType,
      maximumBytes: 65_536,
      canonicalize: (bytes) => bytes,
      validate: () => Object.freeze({}),
    };
    await assert.rejects(
      store.put(Buffer.from("not json"), permissiveClone),
      expectStoreError("cas.codec"),
    );
    await assert.rejects(
      ArtifactStore.open(root, [jsonCodec, permissiveClone]),
      expectStoreError("cas.codec_conflict"),
    );
  } finally {
    await removeStore(root);
  }
});

test("resolver rejects path-like digests and non-data references", async () => {
  const { root, store } = await temporaryStore();
  try {
    const reference = await store.put(document("payload"), jsonCodec);
    const invalidDigests = [
      "../",
      "/absolute/path",
      "a".repeat(63),
      "A".repeat(64),
      `${"a".repeat(62)}\\x`,
      `${"a".repeat(62)}%2e`,
      `${"a".repeat(63)}\0`,
    ];
    for (const sha256 of invalidDigests) {
      await assert.rejects(
        store.readBytes({ ...reference, sha256 }, jsonCodec),
        expectStoreError("cas.digest"),
      );
    }
    await assert.rejects(
      store.readBytes({ ...reference, path: "sealed/result" }, jsonCodec),
      expectStoreError("cas.reference"),
    );
    const accessor = { ...reference } as Record<string, unknown>;
    Object.defineProperty(accessor, "sha256", {
      enumerable: true,
      get: () => reference.sha256,
    });
    await assert.rejects(
      store.readBytes(accessor, jsonCodec),
      expectStoreError("cas.reference"),
    );
  } finally {
    await removeStore(root);
  }
});

test("length, hash, hardlink, and symlink tampering fail closed", async (t) => {
  await t.test("appended bytes", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("short"), jsonCodec);
      const path = leafPath(root, reference.sha256);
      await chmod(path, 0o600);
      await appendFile(path, "x");
      await chmod(path, 0o400);
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.byte_length"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("same-length replacement", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("alpha"), jsonCodec);
      const path = leafPath(root, reference.sha256);
      await chmod(path, 0o600);
      await writeFile(path, document("omega"));
      await chmod(path, 0o400);
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.hash"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("hardlink", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("linked"), jsonCodec);
      await link(leafPath(root, reference.sha256), join(root, "outside-link"));
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.link_count"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("symlink leaf", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("target"), jsonCodec);
      const path = leafPath(root, reference.sha256);
      const outside = join(root, "outside");
      await writeFile(outside, document("target"));
      await unlink(path);
      await symlink(outside, path);
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.symlink"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("symlink shard", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("shard"), jsonCodec);
      const shard = dirname(leafPath(root, reference.sha256));
      const outside = join(root, "outside-directory");
      await mkdir(outside, { mode: 0o700 });
      await rm(shard, { recursive: true });
      await symlink(outside, shard);
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.shard_directory"),
      );
    } finally {
      await removeStore(root);
    }
  });
});

test("exact root, directory, and leaf modes are enforced on every read and audit", async (t) => {
  await t.test("root 0755", async () => {
    const root = await mkdtemp(join(tmpdir(), "impactdiff-cas-mode-"));
    try {
      await chmod(root, 0o755);
      await assert.rejects(
        ArtifactStore.open(root, [jsonCodec]),
        expectStoreError("cas.root_permissions"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("root changed to 0755", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("root-mode"), jsonCodec);
      await chmod(root, 0o755);
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.root_changed_permissions"),
      );
      await assert.rejects(
        store.audit([reference]),
        expectStoreError("cas.root_changed_permissions"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("shard 0755", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("directory-mode"), jsonCodec);
      await chmod(dirname(leafPath(root, reference.sha256)), 0o755);
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.shard_directory_permissions"),
      );
      await assert.rejects(
        store.audit([reference]),
        expectStoreError("cas.shard_directory_permissions"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("leaf 0444", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("leaf-mode"), jsonCodec);
      await chmod(leafPath(root, reference.sha256), 0o444);
      await assert.rejects(
        store.readBytes(reference, jsonCodec),
        expectStoreError("cas.file_permissions"),
      );
      await assert.rejects(
        store.audit([reference]),
        expectStoreError("cas.file_permissions"),
      );
    } finally {
      await removeStore(root);
    }
  });
});

test("store roots reject symbolic aliases and nesting", async () => {
  const outer = await temporaryStore();
  const alias = `${outer.root}-alias`;
  try {
    await symlink(outer.root, alias);
    await assert.rejects(
      ArtifactStore.open(alias, [jsonCodec]),
      expectStoreError("cas.root_alias"),
    );

    const nested = await temporaryStore(outer.root);
    assert.throws(
      () => assertDisjointArtifactStores(outer.store, nested.store),
      expectStoreError("cas.store_alias"),
    );
  } finally {
    await rm(alias, { force: true });
    await removeStore(outer.root);
  }
});

test("audit rejects abandoned temp files and enforces exact membership", async () => {
  const { root, store } = await temporaryStore();
  try {
    const reference = await store.put(document("audited"), jsonCodec);
    const shard = dirname(leafPath(root, reference.sha256));
    await writeFile(join(shard, `.${reference.sha256}.dead.tmp`), "canary", {
      mode: 0o400,
    });

    await assert.rejects(
      store.audit([reference]),
      expectStoreError("cas.unexpected_entry"),
    );
    await unlink(join(shard, `.${reference.sha256}.dead.tmp`));

    const second = await store.put(document("second"), jsonCodec);
    await assert.rejects(
      store.audit([reference]),
      expectStoreError("cas.unexpected_entry"),
    );
    assert.equal((await store.audit([reference, second])).entries.size, 2);
  } finally {
    await removeStore(root);
  }
});

test("audit requires exact digest-directory topology", async (t) => {
  await t.test("extra empty shard", async () => {
    const { root, store } = await temporaryStore();
    try {
      const reference = await store.put(document("topology"), jsonCodec);
      const extraShard = reference.sha256.startsWith("00") ? "ff" : "00";
      await mkdir(join(root, "sha256", extraShard), { mode: 0o700 });
      await assert.rejects(
        store.audit([reference]),
        expectStoreError("cas.unexpected_entry"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("digest directory in an empty store", async () => {
    const { root, store } = await temporaryStore();
    try {
      await mkdir(join(root, "sha256"), { mode: 0o700 });
      await assert.rejects(store.audit([]), expectStoreError("cas.unexpected_entry"));
    } finally {
      await removeStore(root);
    }
  });
});

test("a crash-style temp never exposes a final artifact and audit rejects it", async () => {
  const { root, store } = await temporaryStore();
  try {
    const seed = await store.put(document("seed"), jsonCodec);
    const raw = document("interrupted");
    const interruptedDigest = digest(raw);
    const finalPath = leafPath(root, interruptedDigest);
    const shard = dirname(leafPath(root, seed.sha256));
    const temporaryPath = join(shard, `.${interruptedDigest}.crash.tmp`);
    await writeFile(temporaryPath, raw, { mode: 0o400 });

    await assert.rejects(stat(finalPath), { code: "ENOENT" });
    await assert.rejects(store.audit([seed]), expectStoreError("cas.unexpected_entry"));
  } finally {
    await removeStore(root);
  }
});

test("noncanonical bytes with a matching digest are rejected by resolve and audit", async () => {
  const { root, store } = await temporaryStore();
  try {
    const raw = Buffer.from('{ "value": 1, "contract": "tampered" }\n');
    const reference = await installRawLeaf(root, raw);

    await assert.rejects(
      store.resolve(reference, jsonCodec),
      expectStoreError("cas.noncanonical"),
    );
    await assert.rejects(
      store.audit([reference]),
      expectStoreError("cas.noncanonical"),
    );
  } finally {
    await removeStore(root);
  }
});

test("a raw PNG cannot bypass its codec by using a matching raw-byte digest", async () => {
  const { root, store } = await temporaryStore(undefined, [pngCodec]);
  try {
    const image = new PNG({ width: 2, height: 1 });
    image.data = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
    const raw = PNG.sync.write(image, {
      colorType: 6,
      deflateLevel: 1,
      deflateStrategy: 0,
      filterType: 0,
    });
    assert.equal(raw.equals(canonicalizePng(raw).bytes), false);
    const reference = await installRawLeaf(root, raw, 0o400, "image/png");

    await assert.rejects(
      store.resolve(reference, pngCodec),
      expectStoreError("cas.noncanonical"),
    );
    await assert.rejects(
      store.audit([reference]),
      expectStoreError("cas.noncanonical"),
    );
  } finally {
    await removeStore(root);
  }
});

test("malformed raw and stored artifacts are rejected by the registered codec", async (t) => {
  await t.test("put", async () => {
    const { root, store } = await temporaryStore();
    try {
      await assert.rejects(
        store.put(Buffer.from("not-json"), jsonCodec),
        expectStoreError("cas.codec_canonicalize"),
      );
      await assert.rejects(
        store.put(Buffer.from('{"value":1}'), jsonCodec),
        expectStoreError("cas.codec_validate"),
      );
    } finally {
      await removeStore(root);
    }
  });

  await t.test("resolve and audit", async () => {
    const { root, store } = await temporaryStore();
    try {
      const malformed = Buffer.from("not-json");
      const reference = await installRawLeaf(root, malformed);
      await assert.rejects(
        store.resolve(reference, jsonCodec),
        expectStoreError("cas.codec_canonicalize"),
      );
      await assert.rejects(
        store.audit([reference]),
        expectStoreError("cas.codec_canonicalize"),
      );
    } finally {
      await removeStore(root);
    }
  });
});

test("pair audit detects copied canonical bytes across visible and sealed stores", async () => {
  const visible = await temporaryStore();
  const sealed = await temporaryStore();
  try {
    const visibleReference = await visible.store.put(
      document("cross-store-canary"),
      jsonCodec,
    );
    const sealedReference = await sealed.store.put(
      Buffer.from('{ "contract": "cross-store-canary" }'),
      jsonCodec,
    );

    await assert.rejects(
      auditArtifactStorePair(visible.store, [visibleReference], sealed.store, [
        sealedReference,
      ]),
      expectStoreError("cas.cross_store_digest"),
    );
  } finally {
    await removeStore(visible.root);
    await removeStore(sealed.root);
  }
});

test("resolve validates the verified buffer even if its path is replaced", async () => {
  let replaceDuringValidation = false;
  let path = "";
  let replacement = "";
  const replacingCodec: ArtifactCodec<CaptureDocument> = Object.freeze({
    ...jsonCodec,
    validate: (bytes: Buffer) => {
      if (replaceDuringValidation) {
        renameSync(replacement, path);
        replaceDuringValidation = false;
      }
      return jsonCodec.validate(bytes);
    },
  });
  const { root, store } = await temporaryStore(undefined, [replacingCodec]);
  try {
    const original = document("verified");
    const reference = await store.put(original, replacingCodec);
    path = leafPath(root, reference.sha256);
    replacement = join(dirname(path), "replacement");
    writeFileSync(replacement, document("hostile"), { mode: 0o600 });
    chmodSync(replacement, 0o400);
    replaceDuringValidation = true;

    const decoded = await store.resolve(reference, replacingCodec);
    assert.equal(decoded.contract, "verified");
  } finally {
    await removeStore(root);
  }
});

test("media type and codec-specific byte budgets are enforced", async () => {
  const { root, store } = await temporaryStore(undefined, [jsonCodec, otherCodec]);
  try {
    const reference = await store.put(document("budget"), jsonCodec);
    await assert.rejects(
      store.readBytes(reference, otherCodec),
      expectStoreError("cas.media_type"),
    );
    await assert.rejects(
      store.readBytes({ ...reference, byte_length: 65_537 }, jsonCodec),
      expectStoreError("cas.byte_length"),
    );
  } finally {
    await removeStore(root);
  }
});

test("byte budgets use intrinsic typed-array lengths before copying", async () => {
  let canonicalizeCalls = 0;
  const boundedCodec: ArtifactCodec<Buffer> = Object.freeze({
    mediaType: "application/vnd.impactdiff.intrinsic-length+octets",
    maximumBytes: 16,
    canonicalize: (bytes: Buffer) => {
      canonicalizeCalls += 1;
      if (bytes[0] === 1) {
        const oversizedResult = new Uint8Array(17);
        Object.defineProperty(oversizedResult, "byteLength", { value: 1 });
        return oversizedResult;
      }
      return bytes;
    },
    validate: (bytes: Buffer) => bytes,
  });
  const { root, store } = await temporaryStore(undefined, [boundedCodec]);
  try {
    const oversizedInput = new Uint8Array(17);
    Object.defineProperty(oversizedInput, "byteLength", { value: 1 });
    await assert.rejects(
      store.put(oversizedInput, boundedCodec),
      expectStoreError("cas.byte_length"),
    );
    assert.equal(canonicalizeCalls, 0);

    await assert.rejects(
      store.put(new Uint8Array([1]), boundedCodec),
      expectStoreError("cas.byte_length"),
    );
    assert.equal(canonicalizeCalls, 1);
  } finally {
    await removeStore(root);
  }
});

test("store root and aggregate byte budget are runtime immutable", async () => {
  const widerCodec: ArtifactCodec<Buffer> = Object.freeze({
    mediaType: "application/vnd.impactdiff.immutable-budget+octets",
    maximumBytes: 100,
    canonicalize: (bytes: Buffer) => bytes,
    validate: (bytes: Buffer) => bytes,
  });
  const root = await mkdtemp(join(tmpdir(), "impactdiff-cas-"));
  const store = await ArtifactStore.open(root, [widerCodec], 10);
  try {
    assert.ok(Object.isFrozen(store));
    assert.throws(() => {
      (store as unknown as { maximumArtifactBytes: number }).maximumArtifactBytes = 100;
    }, TypeError);
    assert.throws(() => {
      (store as unknown as { rootPath: string }).rootPath = `${root}-other`;
    }, TypeError);
    assert.equal(store.maximumArtifactBytes, 10);
    assert.equal(store.rootPath, root);
    await assert.rejects(
      store.put(new Uint8Array(50), widerCodec),
      expectStoreError("cas.byte_length"),
    );
  } finally {
    await removeStore(root);
  }
});

test("a successful audit seals publication and exposes no mutable map", async () => {
  const { root, store } = await temporaryStore();
  try {
    const reference = await store.put(document("sealed"), jsonCodec);
    const auditPromise = store.audit([reference]);
    const lateWrite = store.put(document("too-late"), jsonCodec);
    const audit = await auditPromise;

    assert.equal(audit.entries.size, 1);
    assert.equal("set" in audit.entries, false);
    await assert.rejects(lateWrite, expectStoreError("cas.sealed"));
  } finally {
    await removeStore(root);
  }
});
