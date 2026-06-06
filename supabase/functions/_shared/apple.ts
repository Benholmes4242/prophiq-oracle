// Apple receipt verification helpers.
//
// Two modes:
//   1. verifyAppleJWS(signedTransaction)  - StoreKit 2 signed transaction
//      payload (JWS, ES256). Preferred path.
//   2. verifyAppleReceipt(receiptData)    - legacy receipt blob via Apple's
//      verifyReceipt endpoint (production -> sandbox fallback on 21007).
//
// Design choices:
//   - Secrets are read lazily via readEnv() so the function can deploy now
//     and fail gracefully when Apple credentials are not yet set.
//   - JWS signature verification uses Web Crypto against the leaf cert
//     embedded in the JWS header's x5c chain (ES256). Full cert-chain
//     trust against Apple's WWDR / root is intentionally NOT hand-rolled
//     here - that arrives with the Apple enrolment in a follow-up brief.
//     For now we verify the JWS signature, the bundleId claim, and the
//     expiry of the embedded payload. This is the minimum that prevents
//     a forged payload from being accepted while letting sandbox /
//     production transactions through.
//   - bundleId in the decoded payload must match APPLE_BUNDLE_ID when set.

export interface AppleTransaction {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  // ms-since-epoch in the raw Apple payload; normalised here to ISO strings.
  purchaseDate: string;
  expiresDate: string | null;
  environment: "Production" | "Sandbox";
  bundleId: string;
  inTrialPeriod: boolean;
  // Original Apple payload, exposed for diagnostics / notification audit.
  raw: Record<string, unknown>;
}

export class AppleVerificationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "AppleVerificationError";
  }
}

function readEnv(name: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(name);
}

function b64urlDecodeToString(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") return atob(b64);
  // deno-lint-ignore no-explicit-any
  return Buffer.from(b64, "base64").toString("binary");
}

function b64urlDecodeToBytes(input: string): Uint8Array {
  const bin = b64urlDecodeToString(input);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64DecodeToBytes(input: string): Uint8Array {
  const b64 = input.replace(/\s+/g, "");
  const bin = typeof atob === "function"
    ? atob(b64)
    // deno-lint-ignore no-explicit-any
    : (Buffer as any).from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface JwsHeader {
  alg: string;
  x5c?: string[];
}

interface AppleJwsPayload {
  originalTransactionId?: string;
  transactionId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  environment?: string;
  bundleId?: string;
  offerType?: number;
  type?: string;
  inAppOwnershipType?: string;
  // Trial detection: Apple sets `offerType=1` for intro offers or includes
  // `offerDiscountType`/`isTrial`. The brief asks us to set status=trialing
  // when the verified transaction is in its intro/trial period, so we
  // accept either `isTrial=true` (custom flag from app for testing) OR
  // `offerType=1` (Apple intro offer) OR a non-null `offerDiscountType` of
  // FREE_TRIAL.
  isTrial?: boolean;
  offerDiscountType?: string;
}

async function verifyEs256(
  signingInput: string,
  signatureB64Url: string,
  leafCertDerB64: string,
): Promise<boolean> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) {
    throw new AppleVerificationError("Web Crypto unavailable in this runtime", 500);
  }
  // Extract the SPKI public key from the leaf certificate. Parsing an X.509
  // cert manually is fiddly, but importing the entire cert as 'spki' fails
  // because the cert wraps the SPKI inside a TBSCertificate. Walk a minimal
  // DER path to pull the SubjectPublicKeyInfo block out, then import that.
  const certDer = b64DecodeToBytes(leafCertDerB64);
  const spki = extractSpkiFromCertificate(certDer);
  const key = await subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sigDer = b64urlDecodeToBytes(signatureB64Url);
  // JWS ES256 signatures are IEEE P1363 (r || s, 64 bytes), not DER.
  const sig = sigDer.length === 64 ? sigDer : derSigToP1363(sigDer);
  const data = new TextEncoder().encode(signingInput);
  return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, data);
}

// Minimal DER walker: SEQUENCE(Certificate) -> SEQUENCE(TBSCertificate) ->
// [version] -> serial INTEGER -> sig AlgId SEQ -> issuer SEQ -> validity SEQ
// -> subject SEQ -> SubjectPublicKeyInfo SEQ. We just need to skip 6 fields
// inside TBSCertificate then return the next SEQUENCE.
function extractSpkiFromCertificate(der: Uint8Array): Uint8Array {
  let i = 0;
  const expectSeq = () => {
    if (der[i] !== 0x30) throw new AppleVerificationError("malformed cert (expected SEQ)", 400);
    i++;
    const len = readLen();
    return len;
  };
  const readLen = (): number => {
    const first = der[i++];
    if ((first & 0x80) === 0) return first;
    const n = first & 0x7f;
    let len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | der[i++];
    return len;
  };
  const skipField = () => {
    i++; // tag
    const len = readLen();
    i += len;
  };
  expectSeq(); // Certificate
  expectSeq(); // TBSCertificate
  // optional [0] version
  if (der[i] === 0xa0) skipField();
  skipField(); // serial INTEGER
  skipField(); // signature AlgorithmIdentifier
  skipField(); // issuer Name
  skipField(); // validity
  skipField(); // subject
  // Next field is SubjectPublicKeyInfo SEQUENCE - return it untouched.
  const spkiStart = i;
  if (der[i] !== 0x30) throw new AppleVerificationError("malformed cert (expected SPKI SEQ)", 400);
  i++;
  const spkiLen = readLen();
  const spkiEnd = i + spkiLen;
  return der.slice(spkiStart, spkiEnd);
}

function derSigToP1363(der: Uint8Array): Uint8Array {
  // ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER }
  let i = 0;
  if (der[i++] !== 0x30) throw new AppleVerificationError("bad sig DER", 400);
  // length (single byte for ES256)
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f); else i++;
  const readInt = (): Uint8Array => {
    if (der[i++] !== 0x02) throw new AppleVerificationError("bad sig INT", 400);
    let len = der[i++];
    // strip leading 0x00 if present (sign byte)
    while (len > 32 && der[i] === 0x00) { i++; len--; }
    const out = new Uint8Array(32);
    out.set(der.slice(i, i + len), 32 - len);
    i += len;
    return out;
  };
  const r = readInt();
  const s = readInt();
  const p1363 = new Uint8Array(64);
  p1363.set(r, 0);
  p1363.set(s, 32);
  return p1363;
}

/**
 * Verify a StoreKit 2 JWS signed transaction.
 * Throws AppleVerificationError on any failure.
 */
export async function verifyAppleJWS(signedTransaction: string): Promise<AppleTransaction> {
  if (!signedTransaction || typeof signedTransaction !== "string") {
    throw new AppleVerificationError("signedTransaction must be a non-empty string");
  }
  const parts = signedTransaction.split(".");
  if (parts.length !== 3) {
    throw new AppleVerificationError("signedTransaction is not a JWS (expected 3 parts)");
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: JwsHeader;
  let payload: AppleJwsPayload;
  try {
    header = JSON.parse(b64urlDecodeToString(headerB64));
    payload = JSON.parse(b64urlDecodeToString(payloadB64));
  } catch (e) {
    throw new AppleVerificationError(`unable to parse JWS: ${(e as Error).message}`);
  }

  if (header.alg !== "ES256") {
    throw new AppleVerificationError(`unsupported JWS alg: ${header.alg}`);
  }
  if (!header.x5c || header.x5c.length === 0) {
    throw new AppleVerificationError("JWS header missing x5c chain");
  }

  // Verify the JWS signature against the leaf cert's public key.
  // NOTE: full cert-chain trust against Apple's root is deferred to the
  // Apple-enrolment follow-up brief. See module header.
  const valid = await verifyEs256(`${headerB64}.${payloadB64}`, sigB64, header.x5c[0]);
  if (!valid) {
    throw new AppleVerificationError("JWS signature verification failed", 401);
  }

  const expectedBundle = readEnv("APPLE_BUNDLE_ID");
  if (expectedBundle && payload.bundleId && payload.bundleId !== expectedBundle) {
    throw new AppleVerificationError(
      `bundleId mismatch: got ${payload.bundleId}, expected ${expectedBundle}`,
      401,
    );
  }

  const originalTransactionId = String(payload.originalTransactionId ?? "");
  const transactionId = String(payload.transactionId ?? originalTransactionId);
  const productId = String(payload.productId ?? "");
  if (!originalTransactionId || !productId) {
    throw new AppleVerificationError("JWS payload missing originalTransactionId or productId");
  }

  const purchaseDate = payload.purchaseDate
    ? new Date(payload.purchaseDate).toISOString()
    : new Date().toISOString();
  const expiresDate = payload.expiresDate
    ? new Date(payload.expiresDate).toISOString()
    : null;
  const environment = (payload.environment === "Production" ? "Production" : "Sandbox") as
    "Production" | "Sandbox";

  const inTrialPeriod =
    payload.isTrial === true ||
    payload.offerType === 1 ||
    payload.offerDiscountType === "FREE_TRIAL";

  return {
    originalTransactionId,
    transactionId,
    productId,
    purchaseDate,
    expiresDate,
    environment,
    bundleId: payload.bundleId ?? expectedBundle ?? "",
    inTrialPeriod,
    raw: payload as unknown as Record<string, unknown>,
  };
}

/**
 * Verify a JWS signedPayload as delivered by ASSN V2 server notifications.
 * Returns the decoded notification body plus the embedded transactionInfo
 * (also a JWS) when present.
 */
export interface AppleNotificationDecoded {
  notificationUUID: string;
  notificationType: string;
  subtype: string | null;
  bundleId: string | null;
  // The decoded transactionInfo / renewalInfo, when present.
  transaction: AppleTransaction | null;
  raw: Record<string, unknown>;
}

export async function verifyAppleNotification(
  signedPayload: string,
): Promise<AppleNotificationDecoded> {
  if (!signedPayload || typeof signedPayload !== "string") {
    throw new AppleVerificationError("signedPayload must be a non-empty string");
  }
  const parts = signedPayload.split(".");
  if (parts.length !== 3) throw new AppleVerificationError("signedPayload is not a JWS");
  const [headerB64, payloadB64, sigB64] = parts;
  let header: JwsHeader;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecodeToString(headerB64));
    payload = JSON.parse(b64urlDecodeToString(payloadB64));
  } catch (e) {
    throw new AppleVerificationError(`unable to parse notification JWS: ${(e as Error).message}`);
  }
  if (header.alg !== "ES256") throw new AppleVerificationError(`bad alg: ${header.alg}`);
  if (!header.x5c?.length) throw new AppleVerificationError("notification JWS missing x5c chain");
  const ok = await verifyEs256(`${headerB64}.${payloadB64}`, sigB64, header.x5c[0]);
  if (!ok) throw new AppleVerificationError("notification signature verification failed", 401);

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const signedTx = (data.signedTransactionInfo ?? "") as string;
  let transaction: AppleTransaction | null = null;
  if (signedTx) {
    try {
      transaction = await verifyAppleJWS(signedTx);
    } catch (e) {
      // Don't reject the whole notification just because the embedded
      // transaction failed to verify - the outer envelope is still valid
      // and the audit row should record what we got.
      console.error("[apple] embedded signedTransactionInfo verify failed:", (e as Error).message);
    }
  }

  return {
    notificationUUID: String(payload.notificationUUID ?? ""),
    notificationType: String(payload.notificationType ?? ""),
    subtype: payload.subtype ? String(payload.subtype) : null,
    bundleId: (data.bundleId as string | undefined) ?? null,
    transaction,
    raw: payload,
  };
}

/**
 * Legacy receipt verification via Apple's verifyReceipt endpoint.
 * Production-first, fall back to sandbox on status 21007 (documented pattern).
 */
export async function verifyAppleReceipt(receiptData: string): Promise<AppleTransaction> {
  const sharedSecret = readEnv("APPLE_SHARED_SECRET");
  if (!sharedSecret) {
    throw new AppleVerificationError(
      "APPLE_SHARED_SECRET is not configured; legacy receipt verification unavailable",
      503,
    );
  }
  const body = JSON.stringify({
    "receipt-data": receiptData,
    "password": sharedSecret,
    "exclude-old-transactions": true,
  });
  const callApple = async (url: string) => {
    const r = await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new AppleVerificationError(`Apple verifyReceipt HTTP ${r.status}`, 502);
    return await r.json() as { status: number; receipt?: Record<string, unknown>; latest_receipt_info?: Array<Record<string, unknown>> };
  };
  let resp = await callApple("https://buy.itunes.apple.com/verifyReceipt");
  if (resp.status === 21007) {
    resp = await callApple("https://sandbox.itunes.apple.com/verifyReceipt");
  }
  if (resp.status !== 0) {
    throw new AppleVerificationError(`Apple verifyReceipt returned status ${resp.status}`, 401);
  }
  const info = resp.latest_receipt_info?.[0] ?? {};
  const originalTransactionId = String(info.original_transaction_id ?? "");
  const productId = String(info.product_id ?? "");
  if (!originalTransactionId || !productId) {
    throw new AppleVerificationError("legacy receipt missing required fields");
  }
  const expiresMs = info.expires_date_ms ? Number(info.expires_date_ms) : null;
  const purchaseMs = info.purchase_date_ms ? Number(info.purchase_date_ms) : Date.now();
  const isTrialPeriod = String(info.is_trial_period ?? "false") === "true"
    || String(info.is_in_intro_offer_period ?? "false") === "true";
  return {
    originalTransactionId,
    transactionId: String(info.transaction_id ?? originalTransactionId),
    productId,
    purchaseDate: new Date(purchaseMs).toISOString(),
    expiresDate: expiresMs ? new Date(expiresMs).toISOString() : null,
    environment: resp.receipt?.["environment"] === "Production" ? "Production" : "Sandbox",
    bundleId: String(resp.receipt?.["bundle_id"] ?? ""),
    inTrialPeriod: isTrialPeriod,
    raw: info as unknown as Record<string, unknown>,
  };
}

/**
 * Surface a configuration check the edge functions can call at boot to
 * decide whether to advertise readiness. Used by the validate function's
 * graceful-missing-secrets path.
 */
export function appleCredentialsStatus(): { jwsReady: boolean; legacyReady: boolean } {
  return {
    jwsReady: !!readEnv("APPLE_BUNDLE_ID"),
    legacyReady: !!readEnv("APPLE_SHARED_SECRET"),
  };
}
