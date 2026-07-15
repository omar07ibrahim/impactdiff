import type { Page } from "@playwright/test";

export type ChromiumFontAuditErrorFactory<Failure extends Error> = (
  message: string,
  options?: ErrorOptions,
) => Failure;

export interface ChromiumFontAuditOptions<Failure extends Error> {
  /** The platform family name reported by Chromium for every rendered glyph. */
  readonly expectedPlatformFamilyName: string;
  /** Creates the caller-owned typed error used for every closed-font failure. */
  readonly createError: ChromiumFontAuditErrorFactory<Failure>;
}

class ChromiumFontPolicyFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChromiumFontPolicyFailure";
  }
}

/**
 * Fails closed unless every rendered body glyph uses the expected custom font.
 * The caller owns the public error type and code namespace; this module owns the
 * shared CDP probing and cleanup semantics.
 */
export async function assertClosedChromiumFonts<Failure extends Error>(
  page: Page,
  options: ChromiumFontAuditOptions<Failure>,
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  let auditFailure: { readonly error: unknown } | undefined;
  try {
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    const document = await client.send("DOM.getDocument", {
      depth: 1,
      pierce: false,
    });
    const matches = await client.send("DOM.querySelectorAll", {
      nodeId: document.root.nodeId,
      selector: "body, body *",
    });
    let glyphCount = 0;
    for (const nodeId of matches.nodeIds) {
      const usage = await client.send("CSS.getPlatformFontsForNode", { nodeId });
      for (const font of usage.fonts) {
        glyphCount += font.glyphCount;
        if (
          font.isCustomFont !== true ||
          font.familyName !== options.expectedPlatformFamilyName
        ) {
          throw new ChromiumFontPolicyFailure(
            "fixture text used a font outside the exact custom WOFF2 bundle",
          );
        }
      }
    }
    if (glyphCount < 1) {
      throw new ChromiumFontPolicyFailure(
        "fixture font audit observed no rendered custom glyphs",
      );
    }
  } catch (error) {
    auditFailure = { error };
  }
  let detachFailure: { readonly error: unknown } | undefined;
  try {
    await client.detach();
  } catch (error) {
    detachFailure = { error };
  }
  if (auditFailure !== undefined) {
    if (auditFailure.error instanceof ChromiumFontPolicyFailure) {
      const failure = options.createError(auditFailure.error.message);
      if (detachFailure === undefined) {
        throw failure;
      }
      throw options.createError(auditFailure.error.message, {
        cause: new AggregateError(
          [failure, detachFailure.error],
          "fixture font audit and CDP cleanup both failed",
        ),
      });
    }
    throw options.createError("fixture platform-font usage could not be audited", {
      cause:
        detachFailure === undefined
          ? auditFailure.error
          : new AggregateError(
              [auditFailure.error, detachFailure.error],
              "fixture font audit and CDP cleanup both failed",
            ),
    });
  }
  if (detachFailure !== undefined) {
    throw options.createError(
      "fixture platform-font audit session could not be detached",
      { cause: detachFailure.error },
    );
  }
}
