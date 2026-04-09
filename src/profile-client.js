export function createProfileClient(options) {
  const baseUrl = normalizeBaseUrl(options?.baseUrl);
  const fetchImpl = options?.fetchImpl ?? fetch;

  return {
    updateFacts(facts) {
      return postJson(fetchImpl, `${baseUrl}/user-profile/profile/facts`, facts);
    },
    storeDecision(decision) {
      return postJson(fetchImpl, `${baseUrl}/user-profile/profile/decisions`, decision);
    },
    getSummary() {
      return getJson(fetchImpl, `${baseUrl}/user-profile/graph/summary`);
    }
  };
}

function normalizeBaseUrl(input) {
  const value = input ?? "http://127.0.0.1:5400";
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("user-profile-plugin baseUrl must use a loopback host");
  }
  return url.origin;
}

async function postJson(fetchImpl, url, body) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return readEnvelope(response);
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, {});
  return readEnvelope(response);
}

async function readEnvelope(response) {
  if (!response.ok) {
    throw new Error(`user-profile-plugin request failed with status ${response.status ?? "unknown"}`);
  }
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.errors?.join(", ") || "user-profile-plugin returned an error");
  }
  return payload;
}
