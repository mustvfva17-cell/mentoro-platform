import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

type JsonRecord = Record<string, unknown>;

function response(status: number, body: JsonRecord) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function envJson(name: string): Record<string, string> {
  try {
    const raw = Deno.env.get(name);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
}

function clients() {
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = envJson("SUPABASE_PUBLISHABLE_KEYS").default || Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = envJson("SUPABASE_SECRET_KEYS").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !secretKey) throw new Error("license_service_configuration_missing");

  const userClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const adminClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { userClient, adminClient };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = [...bytes].map((b) => CODE_ALPHABET[b & 31]).join("");
  const chunks = value.match(/.{1,4}/g) || [];
  return prefix + chunks.join("-");
}

function normalizeLicenseCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!normalized.startsWith("MTR") || normalized.length !== 35 || !/^[A-Z0-9]+$/.test(normalized)) return null;
  return normalized;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requireAdmin(request: Request, userClient: ReturnType<typeof createClient>, adminClient: ReturnType<typeof createClient>) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return { userId: null, status: 401 as const };

  const { data, error } = await userClient.auth.getUser(match[1]);
  if (error || !data?.user) return { userId: null, status: 401 as const };

  const { data: roles, error: roleError } = await adminClient
    .from("profile_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .is("revoked_at", null);

  if (roleError || !Array.isArray(roles) ||
      !roles.some((row: { role?: string }) => row.role === "ADMIN" || row.role === "SUPER_ADMIN")) {
    return { userId: null, status: 403 as const };
  }
  return { userId: data.user.id, status: 200 as const };
}

async function checkRateLimit(adminClient: ReturnType<typeof createClient>, installationHash: string, request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  const identifiers = [{ hash: await sha256Hex("device:" + installationHash), maxAttempts: 10 }];
  if (forwarded && forwarded.length <= 128) {
    // Shared networks can legitimately activate many trainees; keep a higher
    // aggregate IP ceiling while retaining the stricter per-installation limit.
    identifiers.push({ hash: await sha256Hex("ip:" + forwarded), maxAttempts: 50 });
  }

  for (const identifier of identifiers) {
    const { data, error } = await adminClient.rpc("consume_mentoro_license_attempt", {
      p_identifier_hash: identifier.hash,
      p_max_attempts: identifier.maxAttempts,
      p_window_seconds: 900,
    });
    if (error || data?.allowed !== true) return false;
  }
  return true;
}

async function handleAdminAction(action: string, body: JsonRecord, request: Request,
  userClient: ReturnType<typeof createClient>, adminClient: ReturnType<typeof createClient>) {
  const auth = await requireAdmin(request, userClient, adminClient);
  if (!auth.userId) return response(auth.status, { error: auth.status === 401 ? "authentication_required" : "administrator_access_required" });

  if (action === "issue") {
    const specialtySlug = typeof body.specialtySlug === "string" ? body.specialtySlug : "";
    const traineeLabel = typeof body.traineeLabel === "string" ? body.traineeLabel.trim() : "";
    const traineeEmail = typeof body.traineeEmail === "string" ? body.traineeEmail.trim().toLowerCase() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const expiresAt = body.expiresAt == null || body.expiresAt === "" ? null : new Date(String(body.expiresAt));
    if (!/^[a-z0-9-]{2,80}$/.test(specialtySlug) || !traineeLabel || traineeLabel.length > 120 ||
        (traineeEmail && (traineeEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(traineeEmail))) ||
        (notes && notes.length > 2000) ||
        (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()))) {
      return response(400, { error: "invalid_license_details" });
    }

    const licenseCode = randomCode("MTR-");
    const normalizedCode = normalizeLicenseCode(licenseCode);
    if (!normalizedCode) return response(500, { error: "license_generation_failed" });
    const licenseHash = await sha256Hex(normalizedCode);
    const licenseHint = normalizedCode.slice(-8);
    const { data, error } = await adminClient.rpc("issue_mentoro_license", {
      p_license_hash: licenseHash,
      p_license_hint: licenseHint,
      p_trainee_label: traineeLabel,
      p_trainee_email: traineeEmail,
      p_specialty_slug: specialtySlug,
      p_expires_at: expiresAt ? expiresAt.toISOString() : null,
      p_notes: notes,
      p_issued_by: auth.userId,
    });
    if (error || data?.ok !== true) return response(400, { error: "license_issue_failed" });
    return response(201, {
      ok: true,
      license: {
        id: data.license_id,
        licenseHint,
        traineeLabel,
        traineeEmail,
        specialtySlug,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        deviceLimit: 2,
      },
      licenseCode,
      displayOnce: true,
    });
  }

  if (action === "list") {
    const { data: licenses, error } = await adminClient
      .from("logbook_licenses")
      .select("id,license_hint,trainee_label,trainee_email,specialty_slug,status,expires_at,device_limit,created_at,logbook_license_devices(id,activated_at,last_validated_at,revoked_at)")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) return response(500, { error: "license_list_failed" });
    return response(200, { licenses: licenses || [] });
  }

  if (action === "revoke") {
    if (!validUuid(body.licenseId) || typeof body.reason !== "string") return response(400, { error: "invalid_request" });
    const { data, error } = await adminClient.rpc("revoke_mentoro_license", {
      p_license_id: body.licenseId, p_actor_profile_id: auth.userId, p_reason: body.reason,
    });
    if (error) return response(400, { error: "license_revoke_failed" });
    return response(data?.ok ? 200 : 409, data || { ok: false });
  }

  if (action === "reset-devices") {
    if (!validUuid(body.licenseId) || typeof body.reason !== "string") return response(400, { error: "invalid_request" });
    const { data, error } = await adminClient.rpc("reset_mentoro_license_devices", {
      p_license_id: body.licenseId, p_actor_profile_id: auth.userId, p_reason: body.reason,
    });
    if (error) return response(400, { error: "device_reset_failed" });
    return response(data?.ok ? 200 : 409, data || { ok: false });
  }

  if (action === "revoke-device") {
    if (!validUuid(body.licenseId) || !validUuid(body.deviceId) || typeof body.reason !== "string") {
      return response(400, { error: "invalid_request" });
    }
    const { data, error } = await adminClient.rpc("revoke_mentoro_license_device", {
      p_license_id: body.licenseId,
      p_device_id: body.deviceId,
      p_actor_profile_id: auth.userId,
      p_reason: body.reason,
    });
    if (error) return response(400, { error: "device_revoke_failed" });
    return response(data?.ok ? 200 : 409, data || { ok: false });
  }

  return response(400, { error: "unknown_action" });
}

async function handleActivation(action: string, body: JsonRecord, request: Request,
  adminClient: ReturnType<typeof createClient>) {
  const specialtySlug = typeof body.specialtySlug === "string" ? body.specialtySlug : "";
  const installationId = body.installationId;
  if (!/^[a-z0-9-]{2,80}$/.test(specialtySlug) || !validUuid(installationId)) {
    return response(400, { error: "invalid_request" });
  }
  const installationHash = await sha256Hex(installationId);
  if (!(await checkRateLimit(adminClient, installationHash, request))) {
    return response(429, { error: "too_many_attempts", retryAfterSeconds: 900 });
  }

  if (action === "activate") {
    const normalizedCode = normalizeLicenseCode(body.licenseCode);
    if (!normalizedCode) return response(403, { error: "license_unavailable" });
    const deviceToken = randomCode("DEV-");
    const licenseHash = await sha256Hex(normalizedCode);
    const deviceTokenHash = await sha256Hex(deviceToken);
    const { data, error } = await adminClient.rpc("activate_mentoro_license", {
      p_license_hash: licenseHash,
      p_specialty_slug: specialtySlug,
      p_installation_hash: installationHash,
      p_device_token_hash: deviceTokenHash,
    });
    if (error) return response(503, { error: "license_service_unavailable" });
    if (data?.ok !== true) {
      return response(data?.error === "device_limit_reached" ? 409 : 403, {
        error: data?.error === "device_limit_reached" ? "device_limit_reached" : "license_unavailable",
      });
    }
    const { data: licenseDetails, error: detailsError } = await adminClient.rpc("validate_mentoro_license", {
      p_device_token_hash: deviceTokenHash,
      p_installation_hash: installationHash,
      p_specialty_slug: specialtySlug,
    });
    if (detailsError || licenseDetails?.ok !== true) {
      return response(503, { error: "license_service_unavailable" });
    }
    return response(200, {
      ok: true,
      deviceToken,
      licenseId: data.license_id,
      deviceId: data.device_id,
      deviceLimit: data.device_limit,
      deviceCount: data.device_count,
      validUntil: licenseDetails.valid_until,
      expiresAt: licenseDetails.expires_at,
      traineeLabel: licenseDetails.trainee_label,
      licenseHint: licenseDetails.license_hint,
    });
  }

  if (action === "validate") {
    const deviceToken = typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";
    if (!/^DEV-[A-Z2-9-]{30,60}$/.test(deviceToken)) return response(403, { error: "license_invalid" });
    const deviceTokenHash = await sha256Hex(deviceToken);
    const { data, error } = await adminClient.rpc("validate_mentoro_license", {
      p_device_token_hash: deviceTokenHash,
      p_installation_hash: installationHash,
      p_specialty_slug: specialtySlug,
    });
    if (error) return response(503, { error: "license_service_unavailable" });
    return response(data?.ok ? 200 : 403, data?.ok ? data : { error: "license_invalid" });
  }

  return response(400, { error: "unknown_action" });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 16_384) return response(413, { error: "request_too_large" });

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return response(400, { error: "invalid_request" });
    body = parsed as JsonRecord;
  } catch {
    return response(400, { error: "invalid_json" });
  }

  const action = typeof body.action === "string" ? body.action : "";
  try {
    const { userClient, adminClient } = clients();
    if (["issue", "list", "revoke", "reset-devices", "revoke-device"].includes(action)) {
      return await handleAdminAction(action, body, request, userClient, adminClient);
    }
    if (["activate", "validate"].includes(action)) {
      return await handleActivation(action, body, request, adminClient);
    }
    return response(400, { error: "unknown_action" });
  } catch (error) {
    console.error("mentoro-license request failed", error instanceof Error ? error.message : "unknown_error");
    return response(503, { error: "license_service_unavailable" });
  }
});
