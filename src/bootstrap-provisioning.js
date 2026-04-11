export function createSupabaseProvisioningClient(options) {
  const baseUrl = String(options?.url ?? "").replace(/\/+$/, "");
  const serviceRoleKey = options?.serviceRoleKey ?? "";
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  if (!baseUrl || !serviceRoleKey || !fetchImpl) {
    throw new Error("Supabase provisioning requires url, serviceRoleKey, and fetch");
  }

  return {
    ensureFactory(factory) {
      return upsertRow(fetchImpl, baseUrl, serviceRoleKey, "vivo_factories", "factory_key", factory);
    },
    upsertAudience(factory, audience) {
      return upsertRow(fetchImpl, baseUrl, serviceRoleKey, "vivo_audiences", "audience_key", {
        factory_id: factory.id,
        ...audience
      });
    },
    upsertInstance(factory, audience, instance) {
      return upsertRow(fetchImpl, baseUrl, serviceRoleKey, "vivo_instances", "audience_id", {
        factory_id: factory.id,
        audience_id: audience.id,
        instance_key: instance.instance_key,
        service_name: instance.service_name,
        openclaw_admin_url: instance.openclaw_admin_url,
        profile_base_url: instance.profile_base_url,
        runtime_config: {
          profile_service_name: instance.profile_service_name
        },
        status: "active"
      });
    }
  };
}

async function upsertRow(fetchImpl, baseUrl, serviceRoleKey, table, conflictKey, body) {
  const url = new URL(`${baseUrl}/rest/v1/${table}`);
  url.searchParams.set("on_conflict", conflictKey);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const text = await response.text();
  const rows = text ? JSON.parse(text) : [];
  return rows[0] ?? null;
}
