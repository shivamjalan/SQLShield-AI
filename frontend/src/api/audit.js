import { API_BASE_URL, authHeaders, parseJsonOrThrow, authFetch } from "./client";

export async function fetchAuditLogs(accessToken, filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  }
  const query = params.toString();

  const response = await authFetch(`${API_BASE_URL}/api/audit-logs${query ? `?${query}` : ""}`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}

export async function fetchAuditStats(accessToken) {
  const response = await authFetch(`${API_BASE_URL}/api/audit-logs/stats`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}

export async function fetchPendingApprovals(accessToken) {
  const response = await authFetch(`${API_BASE_URL}/api/audit-logs/pending`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}

export async function reviewApproval(accessToken, id, decision) {
  const response = await authFetch(`${API_BASE_URL}/api/audit-logs/${id}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify({ decision }),
  });
  return parseJsonOrThrow(response);
}

export async function executeApprovedQuery(accessToken, id) {
  const response = await authFetch(`${API_BASE_URL}/api/audit-logs/${id}/execute`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}
