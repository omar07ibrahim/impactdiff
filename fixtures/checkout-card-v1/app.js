"use strict";

const revision = "checkout-card-v1.0.0";
const root = document.querySelector('[data-testid="app-root"]');
const review = document.querySelector('[data-testid="checkout-review"]');
const placeOrder = document.querySelector('[data-testid="place-order"]');
const confirmation = document.querySelector('[data-testid="order-confirmation"]');

if (
  !(root instanceof HTMLElement) ||
  !(review instanceof HTMLElement) ||
  !(placeOrder instanceof HTMLButtonElement) ||
  !(confirmation instanceof HTMLElement)
) {
  throw new Error("checkout fixture markup is incomplete");
}

placeOrder.addEventListener("click", () => {
  placeOrder.disabled = true;
  review.hidden = true;
  confirmation.hidden = false;
  root.dataset.state = "confirmed";
  confirmation.focus();
});

void document.fonts.ready.then(() => {
  if (!document.fonts.check('16px "ImpactDiff Noto Sans"')) {
    throw new Error("the vendored fixture font did not load");
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
