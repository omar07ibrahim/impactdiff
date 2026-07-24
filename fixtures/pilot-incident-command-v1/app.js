"use strict";

const revision = "pilot-incident-command-v1.0.0-authoring.1";

const root = document.querySelector('[data-testid="incident-command-root"]');
const severityGlyph = document.querySelector('[data-testid="severity-glyph"]');
const alertSelection = document.querySelector('[data-testid="alert-selection"]');
const acknowledgeAlert = document.querySelector('[data-testid="acknowledge-alert"]');
const acknowledgeStatus = document.querySelector(
  '[data-testid="acknowledge-alert-status"]',
);
const responderSelection = document.querySelector(
  '[data-testid="responder-selection"]',
);
const assignResponder = document.querySelector('[data-testid="assign-responder"]');
const responderStatus = document.querySelector(
  '[data-testid="assign-responder-status"]',
);

if (
  !(root instanceof HTMLElement) ||
  !(severityGlyph instanceof HTMLImageElement) ||
  !(alertSelection instanceof HTMLSelectElement) ||
  !(acknowledgeAlert instanceof HTMLButtonElement) ||
  !(acknowledgeStatus instanceof HTMLElement) ||
  !(responderSelection instanceof HTMLSelectElement) ||
  !(assignResponder instanceof HTMLButtonElement) ||
  !(responderStatus instanceof HTMLElement)
) {
  throw new Error("incident command fixture markup is incomplete");
}

const alertChoices = Object.freeze({
  "edge-cache-lag": Object.freeze({
    label: "Edge cache lag",
    service: "Atlas Edge",
  }),
  "ledger-replica-gap": Object.freeze({
    label: "Ledger replica gap",
    service: "Copper Ledger",
  }),
});

const responderChoices = Object.freeze({
  "avery-noor": Object.freeze({
    label: "Avery Noor",
    rotation: "Core services",
  }),
  "min-park": Object.freeze({
    label: "Min Park",
    rotation: "Data systems",
  }),
});

acknowledgeAlert.addEventListener("click", () => {
  const alert = alertChoices[alertSelection.value];
  if (alert === undefined) {
    throw new Error("alert selection is outside the closed incident catalog");
  }

  root.dataset.alertState = `${alertSelection.value}-acknowledged`;
  acknowledgeStatus.textContent = `${alert.label} acknowledged for ${alert.service}.`;
  acknowledgeStatus.focus({ preventScroll: true });
});

assignResponder.addEventListener("click", () => {
  const responder = responderChoices[responderSelection.value];
  if (responder === undefined) {
    throw new Error("responder selection is outside the closed incident catalog");
  }

  root.dataset.responderState = `${responderSelection.value}-assigned`;
  responderStatus.textContent = `${responder.label} assigned from ${responder.rotation}.`;
  responderStatus.focus({ preventScroll: true });
});

const severityGlyphReady = severityGlyph.complete
  ? Promise.resolve()
  : new Promise((resolve, reject) => {
      severityGlyph.addEventListener("load", resolve, { once: true });
      severityGlyph.addEventListener(
        "error",
        () => reject(new Error("the severity glyph did not load")),
        { once: true },
      );
    });

void Promise.all([document.fonts.ready, severityGlyphReady]).then(() => {
  if (!document.fonts.check('16px "ImpactDiff Noto Sans"')) {
    throw new Error("the vendored fixture font did not load");
  }
  if (severityGlyph.naturalWidth === 0 || severityGlyph.naturalHeight === 0) {
    throw new Error("the severity glyph did not decode");
  }

  Object.defineProperty(window, "__impactdiffFixtureV1", {
    value: Object.freeze({
      ready: true,
      revision,
      pendingRequests: 0,
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
});
