import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import type { Browser } from "@playwright/test";

import { parseCaptureSpec } from "../capture/validate.js";
import type { ArtifactRef } from "../contracts/artifacts.js";
import { canonicalJson, sha256Hex } from "../contracts/canonical.js";
import { MutationRuntimeError } from "./errors.js";
import {
  auditProvenanceFileTree,
  readStableProvenanceFile,
} from "./provenance-files.js";

const environmentConstructorToken = Symbol("impactdiff.mutation-fixture-environment");
const environmentStates = new WeakMap<
  MutationFixtureEnvironment,
  MutationFixtureEnvironmentState
>();
const require = createRequire(import.meta.url);
const packageVersion = "1.61.1";
const browserRegistryRevision = "1228";
const browserVersion = "149.0.7827.55";
const browserExecutableName = "chrome-headless-shell";
const browserInstallationDirectoryName = "chrome-headless-shell-linux64";
const captureSpecMediaType = "application/vnd.impactdiff.capture-spec+json";
const maximumPackageFileBytes = 16_777_216;
const maximumPackageTreeBytes = 67_108_864;
const maximumBrowserFileBytes = 268_435_456;
const maximumBrowserTreeBytes = 536_870_912;
const sourceRevisionPattern = /^@[0-9a-f]{40}$/u;
const packageNames = ["@playwright/test", "playwright", "playwright-core"] as const;
const expectedEnvironmentIdentity = Object.freeze({
  playwrightInstalledFileTreeSha256:
    "97ce9a039e4d78d696c6ec11f0c2ee57f53ccdbedcee5620908d56a065f32484",
  browserInstallationFileTreeSha256:
    "68c05e7c809dbcec86ce5289bb2f4220e9f498596bda49e99825c459d40dd542",
  browserExecutableSha256:
    "670ba079b75107746ba41abad131180a31a7c7219aa1bd4061fb471f4535d541",
  browserLaunchProfileSha256:
    "524f0af81e6af704ae4fa67c96b9df3ae3cb63749b5802d8f4604f985d332907",
  browserSourceRevision: "3188f8a607ae7e067593be8aab7f02d2451fec07",
});

const captureProfile = Object.freeze({
  font: Object.freeze({
    path: "fonts/noto-sans-latin-standard-normal.woff2",
    logicalName: "noto-sans-latin-standard-normal",
    sha256: "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097",
    byteLength: 59_928,
  }),
  display: Object.freeze({
    viewport: Object.freeze({ width: 800, height: 600 }),
    screen: Object.freeze({ width: 800, height: 600 }),
    deviceScaleFactor: 1,
  }),
  internationalization: Object.freeze({ locale: "en-US", timezoneId: "UTC" }),
  media: Object.freeze({
    colorScheme: "light",
    reducedMotion: "reduce",
    forcedColors: "none",
  }),
  clock: Object.freeze({ epochMs: 1_735_689_600_000 }),
  budgets: Object.freeze({
    navigationTimeoutMs: 10_000,
    readinessTimeoutMs: 5_000,
    actionTimeoutMs: 2_000,
  }),
});

interface PackageTreeAudit {
  readonly installedFileTreeSha256: string;
  readonly browserRegistryRevision: string;
  readonly browserVersion: string;
}

interface BrowserInspection {
  readonly sourceRevision: string;
  readonly executableSha256: string;
  readonly installationFileTreeSha256: string;
  readonly launchProfileSha256: string;
}

interface MutationFixtureEnvironmentState {
  readonly browser: Browser;
  readonly fixtureDirectory: string;
  readonly captureSpecReference: ArtifactRef;
  readonly captureSpecBytes: Buffer;
  activeLease: boolean;
  lifecycle: "open" | "poisoned" | "closing" | "closed";
}

export interface MutationFixtureCaptureSpecArtifact {
  readonly reference: ArtifactRef;
  readonly bytes: Uint8Array;
}

export interface MutationFixtureEnvironmentLease {
  readonly browser: Browser;
  readonly fixtureDirectory: string;
  readonly release: () => void;
  readonly invalidate: () => void;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new MutationRuntimeError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPathInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== "" && !child.startsWith(`..${sep}`) && child !== "..";
}

function parseJsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      fail("mutation.environment_metadata", `${label} must be a JSON object`);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MutationRuntimeError) {
      throw error;
    }
    fail("mutation.environment_metadata", `${label} is not valid JSON`, {
      cause: error,
    });
  }
}

function assertPackageMetadata(
  bytes: Buffer,
  expectedName: (typeof packageNames)[number],
): void {
  const metadata = parseJsonObject(bytes, `${expectedName} package metadata`);
  if (metadata.name !== expectedName || metadata.version !== packageVersion) {
    fail(
      "mutation.environment_package",
      `${expectedName} must be the exact ${packageVersion} package`,
    );
  }
}

function browserRegistryMetadata(bytes: Buffer): {
  readonly revision: string;
  readonly version: string;
} {
  const registry = parseJsonObject(bytes, "Playwright browser registry");
  if (!Array.isArray(registry.browsers)) {
    fail(
      "mutation.environment_browser_registry",
      "Playwright browser registry must contain a browser array",
    );
  }
  const candidates = registry.browsers.filter(
    (value): value is Record<string, unknown> =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      value.name === "chromium-headless-shell",
  );
  const selected = candidates[0];
  if (
    candidates.length !== 1 ||
    selected === undefined ||
    selected.revision !== browserRegistryRevision ||
    selected.browserVersion !== browserVersion ||
    selected.installByDefault !== true ||
    selected.title !== "Chrome Headless Shell"
  ) {
    fail(
      "mutation.environment_browser_registry",
      "Playwright browser registry does not name the exact Headless Shell build",
    );
  }
  return Object.freeze({
    revision: browserRegistryRevision,
    version: browserVersion,
  });
}

async function auditInstalledPlaywright(): Promise<PackageTreeAudit> {
  const packages = [];
  let registryBytes: Buffer | undefined;
  for (const name of packageNames) {
    let packageJsonPath: string;
    let entryPath: string;
    try {
      packageJsonPath = require.resolve(`${name}/package.json`);
      entryPath = fileURLToPath(import.meta.resolve(name));
    } catch (error) {
      fail(
        "mutation.environment_package",
        `installed package ${name} could not be resolved exactly`,
        { cause: error },
      );
    }
    const root = dirname(packageJsonPath);
    if (
      basename(packageJsonPath) !== "package.json" ||
      !isPathInside(root, entryPath)
    ) {
      fail(
        "mutation.environment_package",
        `installed package ${name} resolves outside its audited package root`,
      );
    }
    const capturePaths = new Set(
      name === "playwright-core" ? ["package.json", "browsers.json"] : ["package.json"],
    );
    const tree = await auditProvenanceFileTree(root, {
      maximumFileBytes: maximumPackageFileBytes,
      maximumTreeBytes: maximumPackageTreeBytes,
      capturePaths,
      captureBytePaths: capturePaths,
    });
    const packageMetadata = tree.captures.get("package.json")?.bytes;
    if (packageMetadata === undefined) {
      fail(
        "mutation.environment_package",
        `installed package ${name} has no audited package metadata`,
      );
    }
    assertPackageMetadata(packageMetadata, name);
    if (name === "playwright-core") {
      registryBytes = tree.captures.get("browsers.json")?.bytes;
    }
    packages.push(
      Object.freeze({
        name,
        version: packageVersion,
        files: tree.files,
      }),
    );
  }
  packages.sort((left, right) => codeUnitCompare(left.name, right.name));
  if (registryBytes === undefined) {
    fail(
      "mutation.environment_browser_registry",
      "the audited playwright-core tree has no browser registry",
    );
  }
  const registry = browserRegistryMetadata(registryBytes);
  const installedFileTreeSha256 = sha256Hex(
    Buffer.from(
      canonicalJson({
        contract: "impactdiff.playwright-installed-file-tree",
        version: 1,
        packages,
      }),
      "utf8",
    ),
  );
  if (
    installedFileTreeSha256 !==
    expectedEnvironmentIdentity.playwrightInstalledFileTreeSha256
  ) {
    fail(
      "mutation.environment_package_identity",
      "installed Playwright bytes differ from the project-pinned package closure",
    );
  }
  return Object.freeze({
    installedFileTreeSha256,
    browserRegistryRevision: registry.revision,
    browserVersion: registry.version,
  });
}

function normalizeLaunchArguments(argumentsValue: unknown): readonly string[] {
  if (
    !Array.isArray(argumentsValue) ||
    argumentsValue.length < 2 ||
    argumentsValue.length > 256 ||
    argumentsValue.some(
      (value) =>
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > 8_192 ||
        /[\u0000-\u001f\u007f]/u.test(value),
    )
  ) {
    fail(
      "mutation.environment_launch_profile",
      "Chromium did not report a bounded command-line argument array",
    );
  }
  const argv = argumentsValue as string[];
  if (!isAbsolute(argv[0]!)) {
    fail(
      "mutation.environment_launch_profile",
      "Chromium executable command-line path must be absolute",
    );
  }
  let userDataDirectories = 0;
  let automationArguments = 0;
  const normalized = argv.map((argument, index) => {
    if (index === 0) {
      return "$BINARY";
    }
    if (argument === "--enable-automation") {
      automationArguments += 1;
    }
    if (argument.startsWith("--user-data-dir=")) {
      if (argument.length === "--user-data-dir=".length) {
        fail(
          "mutation.environment_launch_profile",
          "Chromium user-data directory argument cannot be empty",
        );
      }
      userDataDirectories += 1;
      return "--user-data-dir=$EPHEMERAL";
    }
    return argument;
  });
  if (userDataDirectories !== 1 || automationArguments !== 1) {
    fail(
      "mutation.environment_launch_profile",
      "Chromium must expose one ephemeral profile and one automation capability",
    );
  }
  return Object.freeze(normalized);
}

async function inspectBrowser(browser: Browser): Promise<BrowserInspection> {
  if (
    browser.browserType() !== chromium ||
    browser.browserType().name() !== "chromium" ||
    browser.version() !== browserVersion
  ) {
    fail(
      "mutation.environment_browser",
      "capture environment must own the pinned local Chromium browser",
    );
  }
  const session = await browser.newBrowserCDPSession();
  let version: unknown;
  let commandLine: unknown;
  let queryFailure: { readonly error: unknown } | undefined;
  try {
    version = await session.send("Browser.getVersion");
    commandLine = await session.send("Browser.getBrowserCommandLine");
  } catch (error) {
    queryFailure = { error };
  }
  let detachFailure: { readonly error: unknown } | undefined;
  try {
    await session.detach();
  } catch (error) {
    detachFailure = { error };
  }
  if (queryFailure !== undefined) {
    fail(
      "mutation.environment_browser",
      "live Chromium provenance could not be read through CDP",
      {
        cause:
          detachFailure === undefined
            ? queryFailure.error
            : new AggregateError(
                [queryFailure.error, detachFailure.error],
                "Chromium provenance query and CDP cleanup both failed",
              ),
      },
    );
  }
  if (detachFailure !== undefined) {
    fail(
      "mutation.environment_browser",
      "live Chromium provenance session could not be detached",
      { cause: detachFailure.error },
    );
  }
  if (
    version === null ||
    typeof version !== "object" ||
    Array.isArray(version) ||
    commandLine === null ||
    typeof commandLine !== "object" ||
    Array.isArray(commandLine)
  ) {
    fail(
      "mutation.environment_browser",
      "live Chromium provenance has an invalid protocol shape",
    );
  }
  const browserVersionResult = version as Record<string, unknown>;
  if (
    browserVersionResult.protocolVersion !== "1.3" ||
    browserVersionResult.product !== `HeadlessChrome/${browserVersion}` ||
    typeof browserVersionResult.revision !== "string" ||
    !sourceRevisionPattern.test(browserVersionResult.revision)
  ) {
    fail(
      "mutation.environment_browser",
      "live Chromium version, distribution, protocol, or source revision drifted",
    );
  }
  const normalizedArguments = normalizeLaunchArguments(
    (commandLine as Record<string, unknown>).arguments,
  );
  const rawArguments = (commandLine as { readonly arguments: readonly string[] })
    .arguments;
  const executablePath = rawArguments[0]!;
  const installationDirectory = dirname(executablePath);
  if (
    basename(executablePath) !== browserExecutableName ||
    basename(installationDirectory) !== browserInstallationDirectoryName ||
    basename(dirname(installationDirectory)) !==
      `chromium_headless_shell-${browserRegistryRevision}`
  ) {
    fail(
      "mutation.environment_browser",
      "live Chromium executable is outside the pinned Headless Shell registry layout",
    );
  }
  const installation = await auditProvenanceFileTree(installationDirectory, {
    maximumFileBytes: maximumBrowserFileBytes,
    maximumTreeBytes: maximumBrowserTreeBytes,
    capturePaths: new Set([browserExecutableName]),
    captureBytePaths: new Set(),
  });
  const executable = installation.captures.get(browserExecutableName);
  if (executable === undefined || (executable.mode & 0o111) === 0) {
    fail(
      "mutation.environment_browser",
      "live Chromium executable is missing or is not executable",
    );
  }
  const installationManifest = {
    contract: "impactdiff.chromium-installation-file-tree",
    version: 1,
    distribution: "chromium_headless_shell",
    playwright_registry_revision: browserRegistryRevision,
    files: installation.files,
  };
  const launchManifest = {
    contract: "impactdiff.chromium-launch-profile",
    version: 1,
    argv: normalizedArguments,
  };
  const inspection = Object.freeze({
    sourceRevision: browserVersionResult.revision.slice(1),
    executableSha256: executable.sha256,
    installationFileTreeSha256: sha256Hex(
      Buffer.from(canonicalJson(installationManifest), "utf8"),
    ),
    launchProfileSha256: sha256Hex(Buffer.from(canonicalJson(launchManifest), "utf8")),
  });
  if (
    inspection.sourceRevision !== expectedEnvironmentIdentity.browserSourceRevision ||
    inspection.executableSha256 !==
      expectedEnvironmentIdentity.browserExecutableSha256 ||
    inspection.installationFileTreeSha256 !==
      expectedEnvironmentIdentity.browserInstallationFileTreeSha256 ||
    inspection.launchProfileSha256 !==
      expectedEnvironmentIdentity.browserLaunchProfileSha256
  ) {
    fail(
      "mutation.environment_browser_identity",
      "live Chromium bytes or launch profile differ from the project-pinned identity",
    );
  }
  return inspection;
}

async function verifiedFixtureDirectory(fixtureDirectory: unknown): Promise<string> {
  if (
    typeof fixtureDirectory !== "string" ||
    fixtureDirectory.length < 1 ||
    fixtureDirectory.length > 4_096 ||
    fixtureDirectory.includes("\0")
  ) {
    fail(
      "mutation.environment_fixture",
      "capture environment fixture directory path is invalid",
    );
  }
  const root = resolve(fixtureDirectory);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    fail(
      "mutation.environment_fixture",
      "capture environment fixture directory cannot be resolved",
      { cause: error },
    );
  }
  if (canonicalRoot !== root) {
    fail(
      "mutation.environment_fixture",
      "capture environment fixture directory cannot be a symbolic alias",
    );
  }
  const fontPath = join(root, captureProfile.font.path);
  let canonicalFontPath: string;
  try {
    canonicalFontPath = await realpath(fontPath);
  } catch (error) {
    fail(
      "mutation.environment_font",
      "capture environment font path cannot be resolved exactly",
      { cause: error },
    );
  }
  if (canonicalFontPath !== fontPath) {
    fail(
      "mutation.environment_font",
      "capture environment font cannot use a symbolic path component",
    );
  }
  const font = await readStableProvenanceFile(
    fontPath,
    captureProfile.font.byteLength,
    false,
  );
  if (
    font.byteLength !== captureProfile.font.byteLength ||
    font.sha256 !== captureProfile.font.sha256
  ) {
    fail(
      "mutation.environment_font",
      "capture environment font differs from the closed WOFF2 bytes",
    );
  }
  return root;
}

function buildCaptureSpec(
  packages: PackageTreeAudit,
  browser: BrowserInspection,
): {
  readonly bytes: Buffer;
  readonly reference: ArtifactRef;
} {
  const candidate = {
    contract: "impactdiff.capture-spec",
    version: 1,
    software: {
      playwright: {
        packages: {
          playwright_test: { name: "@playwright/test", version: packageVersion },
          playwright: { name: "playwright", version: packageVersion },
          playwright_core: { name: "playwright-core", version: packageVersion },
        },
        installed_file_tree_sha256: packages.installedFileTreeSha256,
      },
      browser: {
        engine: "chromium",
        distribution: "chromium_headless_shell",
        playwright_registry_revision: packages.browserRegistryRevision,
        version: packages.browserVersion,
        source_revision: browser.sourceRevision,
        installation_file_tree_sha256: browser.installationFileTreeSha256,
        executable_sha256: browser.executableSha256,
        launch_profile_sha256: browser.launchProfileSha256,
      },
    },
    execution: { kind: "host", platform: "linux/amd64" },
    fonts: {
      bundle_format: "closed-font-file-set-v1",
      files: [
        {
          logical_name: captureProfile.font.logicalName,
          format: "woff2",
          sha256: captureProfile.font.sha256,
          byte_length: captureProfile.font.byteLength,
        },
      ],
      loading: "document-fonts-ready",
      fallback_policy: "closed-bundle-only",
    },
    display: {
      viewport: captureProfile.display.viewport,
      screen: captureProfile.display.screen,
      device_scale_factor: captureProfile.display.deviceScaleFactor,
    },
    internationalization: {
      locale: captureProfile.internationalization.locale,
      timezone_id: captureProfile.internationalization.timezoneId,
    },
    media: {
      color_scheme: captureProfile.media.colorScheme,
      reduced_motion: captureProfile.media.reducedMotion,
      forced_colors: captureProfile.media.forcedColors,
    },
    clock: {
      epoch_ms: captureProfile.clock.epochMs,
      progression: "explicit-only",
    },
    screenshot: {
      format: "png",
      full_page: false,
      animations: "disabled",
      caret: "hide",
      scale: "css",
      omit_background: false,
    },
    network: {
      fixture_delivery: "memory",
      external_requests: "abort",
      service_workers: "block",
      connect_policy: "none",
    },
    budgets: {
      navigation_timeout_ms: captureProfile.budgets.navigationTimeoutMs,
      readiness_timeout_ms: captureProfile.budgets.readinessTimeoutMs,
      action_timeout_ms: captureProfile.budgets.actionTimeoutMs,
      maximum_pending_requests: 0,
      maximum_nodes: 4_096,
      maximum_screenshot_bytes: 8_388_608,
    },
    geometry_quantization: {
      unit: "css_px_q64",
      denominator: 64,
      rounding: "nearest-ties-to-even",
    },
  };
  const bytes = Buffer.from(canonicalJson(candidate), "utf8");
  parseCaptureSpec(bytes);
  const reference = Object.freeze({
    sha256: sha256Hex(bytes),
    byte_length: bytes.byteLength,
    media_type: captureSpecMediaType,
    format_version: 1 as const,
  });
  return Object.freeze({ bytes, reference });
}

function environmentState(value: unknown): MutationFixtureEnvironmentState {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== MutationFixtureEnvironment.prototype
  ) {
    fail(
      "mutation.untrusted_environment",
      "capture environment must be created by the verified launcher",
    );
  }
  const state = environmentStates.get(value as MutationFixtureEnvironment);
  if (state === undefined) {
    fail(
      "mutation.untrusted_environment",
      "capture environment capability is not registered",
    );
  }
  return state;
}

export class MutationFixtureEnvironment {
  private constructor(
    token: symbol,
    state: Omit<MutationFixtureEnvironmentState, "activeLease" | "lifecycle">,
  ) {
    if (token !== environmentConstructorToken) {
      fail(
        "mutation.untrusted_environment",
        "capture environments can only be created by the verified launcher",
      );
    }
    environmentStates.set(this, {
      ...state,
      activeLease: false,
      lifecycle: "open",
    });
    Object.freeze(this);
  }

  get capture_spec(): MutationFixtureCaptureSpecArtifact {
    const state = environmentState(this);
    return Object.freeze({
      reference: state.captureSpecReference,
      bytes: Buffer.from(state.captureSpecBytes),
    });
  }

  async close(): Promise<void> {
    const state = environmentState(this);
    if (state.lifecycle === "closed") {
      fail("mutation.environment_closed", "capture environment is already closed");
    }
    if (state.lifecycle === "closing") {
      fail("mutation.environment_closing", "capture environment is already closing");
    }
    if (state.activeLease) {
      fail(
        "mutation.environment_in_use",
        "capture environment cannot close while fixture sessions are active",
      );
    }
    state.lifecycle = "closing";
    try {
      await state.browser.close();
      if (state.browser.isConnected()) {
        fail(
          "mutation.environment_close",
          "capture environment browser remained connected after close",
        );
      }
      state.lifecycle = "closed";
    } catch (error) {
      state.lifecycle = "poisoned";
      fail(
        "mutation.environment_close",
        "capture environment browser failed to close and remains retryable only for cleanup",
        { cause: error },
      );
    }
  }
}

Object.freeze(MutationFixtureEnvironment.prototype);

/**
 * Launches and owns the exact Chromium process used by fixture sessions. The
 * returned canonical CaptureSpec records installed package bytes, the complete
 * browser installation, its live executable and command line, and the closed font.
 */
export async function launchMutationFixtureEnvironment(
  fixtureDirectory: string,
): Promise<MutationFixtureEnvironment> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail(
      "mutation.environment_platform",
      "host capture environments require linux/amd64",
    );
  }
  const verifiedDirectory = await verifiedFixtureDirectory(fixtureDirectory);
  const packages = await auditInstalledPlaywright();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--enable-automation"],
    });
    const inspectedBrowser = await inspectBrowser(browser);
    const captureSpec = buildCaptureSpec(packages, inspectedBrowser);
    return Reflect.construct(MutationFixtureEnvironment, [
      environmentConstructorToken,
      {
        browser,
        fixtureDirectory: verifiedDirectory,
        captureSpecReference: captureSpec.reference,
        captureSpecBytes: captureSpec.bytes,
      },
    ]) as MutationFixtureEnvironment;
  } catch (error) {
    let cleanupFailure: { readonly error: unknown } | undefined;
    if (browser !== undefined) {
      try {
        await browser.close();
      } catch (cleanupError) {
        cleanupFailure = { error: cleanupError };
      }
    }
    if (error instanceof MutationRuntimeError) {
      if (cleanupFailure !== undefined) {
        throw new MutationRuntimeError(error.code, error.message, {
          cause: new AggregateError(
            [error, cleanupFailure.error],
            "capture environment launch and browser cleanup both failed",
          ),
        });
      }
      throw error;
    }
    fail(
      "mutation.environment_launch",
      "verified capture environment could not be launched",
      {
        cause:
          cleanupFailure === undefined
            ? error
            : new AggregateError(
                [error, cleanupFailure.error],
                "capture environment launch and browser cleanup both failed",
              ),
      },
    );
  }
}

function sameArtifactReference(left: ArtifactRef, right: ArtifactRef): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.byte_length === right.byte_length &&
    left.media_type === right.media_type &&
    left.format_version === right.format_version
  );
}

/** @internal Used only by the branded session factory. */
export function acquireMutationFixtureEnvironment(
  environment: unknown,
  captureSpecReference: ArtifactRef,
): MutationFixtureEnvironmentLease {
  const state = environmentState(environment);
  if (state.lifecycle === "closed") {
    fail("mutation.environment_closed", "capture environment browser is not available");
  }
  if (state.lifecycle === "closing") {
    fail("mutation.environment_closing", "capture environment browser is closing");
  }
  if (state.lifecycle === "poisoned") {
    fail(
      "mutation.environment_poisoned",
      "capture environment is poisoned and cannot be reused for capture",
    );
  }
  if (state.activeLease) {
    fail(
      "mutation.environment_in_use",
      "capture environment permits only one active fixture session",
    );
  }
  if (!state.browser.isConnected()) {
    state.lifecycle = "poisoned";
    fail("mutation.environment_poisoned", "capture environment browser disconnected");
  }
  if (!sameArtifactReference(state.captureSpecReference, captureSpecReference)) {
    fail(
      "mutation.environment_binding",
      "runtime CaptureSpec does not match the verified environment capability",
    );
  }
  state.activeLease = true;
  let finalized = false;
  const finish = (reusable: boolean): void => {
    if (finalized) {
      fail(
        "mutation.environment_lease",
        "capture environment lease was finalized more than once",
      );
    }
    finalized = true;
    state.activeLease = false;
    if (!reusable || !state.browser.isConnected()) {
      state.lifecycle = "poisoned";
    }
  };
  return Object.freeze({
    browser: state.browser,
    fixtureDirectory: state.fixtureDirectory,
    release: () => finish(true),
    invalidate: () => finish(false),
  });
}
