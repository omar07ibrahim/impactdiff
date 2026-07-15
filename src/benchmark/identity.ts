import { createHash } from "node:crypto";

import { canonicalJson } from "../contracts/canonical.js";

const pilotProtocolIdentityDomain = "impactdiff:pilot-protocol:v1";

export function computePilotProtocolId<
  const Protocol extends { readonly protocol_id: unknown },
>(protocol: Protocol): string {
  const { protocol_id: excluded, ...body } = protocol;
  void excluded;
  const hash = createHash("sha256");
  hash.update(pilotProtocolIdentityDomain, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return `idpp1_${hash.digest("hex")}`;
}
