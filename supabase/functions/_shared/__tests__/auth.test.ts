// Unit tests for auth helpers. We mock the SupabaseClient since these helpers
// have no DB-side logic of their own.

import { requireAuthenticatedUser, extractUserIfAuthenticated } from "../auth.ts";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; console.log(`ok : ${msg}`); }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

type MockUserResp = {
  data: { user: { id: string; is_anonymous: boolean; email: string | null } | null };
  error: { message: string } | null;
};

function mockClient(resp: MockUserResp): unknown {
  return {
    auth: {
      getUser: async (_jwt: string) => resp,
    },
  };
}

async function noAuthHeader() {
  const req = new Request("http://x", { method: "POST" });
  const client = mockClient({ data: { user: null }, error: null });
  try {
    await requireAuthenticatedUser(req, client as never);
    return false;
  } catch (r) {
    return r instanceof Response && r.status === 401;
  }
}
assert(await noAuthHeader(), "missing Authorization header throws 401");

async function malformedHeader() {
  const req = new Request("http://x", {
    headers: { Authorization: "Token xyz" },
    method: "POST",
  });
  const client = mockClient({ data: { user: null }, error: null });
  try {
    await requireAuthenticatedUser(req, client as never);
    return false;
  } catch (r) {
    return r instanceof Response && r.status === 401;
  }
}
assert(await malformedHeader(), "non-Bearer Authorization header throws 401");

async function invalidJwt() {
  const req = new Request("http://x", {
    headers: { Authorization: "Bearer expired-jwt" },
    method: "POST",
  });
  const client = mockClient({ data: { user: null }, error: { message: "JWT expired" } });
  try {
    await requireAuthenticatedUser(req, client as never);
    return false;
  } catch (r) {
    return r instanceof Response && r.status === 401;
  }
}
assert(await invalidJwt(), "invalid JWT throws 401");

async function validAnonymousJwt() {
  const req = new Request("http://x", {
    headers: { Authorization: "Bearer valid-anon-jwt" },
    method: "POST",
  });
  const client = mockClient({
    data: { user: { id: "anon-uuid-1", is_anonymous: true, email: null } },
    error: null,
  });
  const result = await requireAuthenticatedUser(req, client as never);
  return result.user_id === "anon-uuid-1" && result.is_anonymous && result.email === null;
}
assert(await validAnonymousJwt(), "valid anonymous JWT returns user with is_anonymous=true");

async function validEmailedJwt() {
  const req = new Request("http://x", {
    headers: { Authorization: "Bearer valid-email-jwt" },
    method: "POST",
  });
  const client = mockClient({
    data: { user: { id: "real-uuid-1", is_anonymous: false, email: "ben@example.com" } },
    error: null,
  });
  const result = await requireAuthenticatedUser(req, client as never);
  return result.user_id === "real-uuid-1" && !result.is_anonymous && result.email === "ben@example.com";
}
assert(await validEmailedJwt(), "valid email JWT returns user with email + is_anonymous=false");

async function extractMissingReturnsNull() {
  const req = new Request("http://x", { method: "POST" });
  const client = mockClient({ data: { user: null }, error: null });
  const result = await extractUserIfAuthenticated(req, client as never);
  return result === null;
}
assert(await extractMissingReturnsNull(), "extract returns null when no header present");

async function extractValidReturnsUser() {
  const req = new Request("http://x", {
    headers: { Authorization: "Bearer valid-jwt" },
    method: "POST",
  });
  const client = mockClient({
    data: { user: { id: "u1", is_anonymous: true, email: null } },
    error: null,
  });
  const result = await extractUserIfAuthenticated(req, client as never);
  return result?.user_id === "u1";
}
assert(await extractValidReturnsUser(), "extract returns user when valid JWT");

async function lowercaseHeader() {
  const req = new Request("http://x", {
    headers: { authorization: "Bearer valid-jwt" },
    method: "POST",
  });
  const client = mockClient({
    data: { user: { id: "u2", is_anonymous: true, email: null } },
    error: null,
  });
  const result = await requireAuthenticatedUser(req, client as never);
  return result.user_id === "u2";
}
assert(await lowercaseHeader(), "lowercase 'authorization' header works (case-insensitive)");

console.log(`\n${passed} passed, ${failed} failed`);
const proc = (globalThis as { Deno?: { exit(c: number): never } }).Deno;
if (failed > 0 && proc) proc.exit(1);
