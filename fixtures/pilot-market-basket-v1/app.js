"use strict";

const revision = "pilot-market-basket-v1.0.0-authoring.2";

const root = document.querySelector('[data-testid="market-basket-root"]');
const wovenTag = document.querySelector('[data-testid="woven-tag-art"]');
const bundleSelect = document.querySelector('[data-testid="bundle-weave"]');
const addBundle = document.querySelector('[data-testid="add-bundle"]');
const bundleStatus = document.querySelector('[data-testid="add-bundle-status"]');
const pickupSelect = document.querySelector('[data-testid="pickup-point"]');
const usePickup = document.querySelector('[data-testid="use-pickup"]');
const pickupStatus = document.querySelector('[data-testid="use-pickup-status"]');

if (
  !(root instanceof HTMLElement) ||
  !(wovenTag instanceof HTMLImageElement) ||
  !(bundleSelect instanceof HTMLSelectElement) ||
  !(addBundle instanceof HTMLButtonElement) ||
  !(bundleStatus instanceof HTMLElement) ||
  !(pickupSelect instanceof HTMLSelectElement) ||
  !(usePickup instanceof HTMLButtonElement) ||
  !(pickupStatus instanceof HTMLElement)
) {
  throw new Error("market basket fixture markup is incomplete");
}

const bundleChoices = Object.freeze({
  "dawn-pantry": Object.freeze({ label: "Dawn Pantry", pieces: 3 }),
  "harbor-picnic": Object.freeze({ label: "Harbor Picnic", pieces: 3 }),
});

const pickupChoices = Object.freeze({
  "north-arcade": Object.freeze({
    label: "North Arcade",
    window: "Friday 4 PM to 6 PM",
  }),
  "river-steps": Object.freeze({
    label: "River Steps",
    window: "Saturday 10 AM to noon",
  }),
});

addBundle.addEventListener("click", () => {
  const choice = bundleChoices[bundleSelect.value];
  if (choice === undefined) {
    throw new Error("bundle selection is outside the closed catalog");
  }

  root.dataset.bundleState = `${bundleSelect.value}-added`;
  bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;
  bundleStatus.focus({ preventScroll: true });
});

usePickup.addEventListener("click", () => {
  const choice = pickupChoices[pickupSelect.value];
  if (choice === undefined) {
    throw new Error("pickup selection is outside the closed catalog");
  }

  root.dataset.pickupState = `${pickupSelect.value}-set`;
  pickupStatus.textContent = `Pickup set to ${choice.label}, ${choice.window}.`;
  pickupStatus.focus({ preventScroll: true });
});

const wovenTagReady = wovenTag.complete
  ? Promise.resolve()
  : new Promise((resolve, reject) => {
      wovenTag.addEventListener("load", resolve, { once: true });
      wovenTag.addEventListener(
        "error",
        () => reject(new Error("the woven tag asset did not load")),
        { once: true },
      );
    });

void Promise.all([document.fonts.ready, wovenTagReady]).then(() => {
  if (!document.fonts.check('16px "ImpactDiff Noto Sans"')) {
    throw new Error("the vendored fixture font did not load");
  }
  if (wovenTag.naturalWidth === 0 || wovenTag.naturalHeight === 0) {
    throw new Error("the woven tag asset did not decode");
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
