(function(){
const item = $input.first().json || {};

const apiBaseUrl = (process.env.FACE_SWAP_BASE_URL || 'http://192.168.1.79:13451').replace(/\/+$/, '');
const apiKey = process.env.FACE_SWAP_API_KEY || process.env.GPU_API_KEY || 'YOUR_GPU_API_KEY';
const pollIntervalMs = Number(process.env.FACE_SWAP_POLL_INTERVAL_MS || 5000);
const maxPollAttempts = Number(process.env.FACE_SWAP_MAX_POLLS || 120);

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(payload) {
  const statusText = asString(
    payload?.status ??
    payload?.state ??
    payload?.job_status ??
    payload?.phase
  ).toLowerCase();

  const done = payload?.done === true || ['done', 'completed', 'complete', 'success', 'succeeded', 'finished', 'ready'].includes(statusText);
  const failed = payload?.failed === true || payload?.ok === false || ['failed', 'error', 'errored', 'cancelled', 'canceled'].includes(statusText);
  const message = asString(payload?.error || payload?.message || payload?.detail);

  return { done, failed, statusText, message };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw_text: text };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }

  return payload;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const requestPayload = {
  source_face_url: item.source_face_url,
  target_video_url: item.source_asset_url
};

async function main() {
  let startPayload = null;
  let statusPayload = null;
  let jobId = '';

  try {
    startPayload = await requestJson(`${apiBaseUrl}/api/video/face-swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(requestPayload)
    });

    jobId = asString(startPayload?.job_id || startPayload?.id);
    if (!jobId) {
      throw new Error(`Face swap API did not return a job_id: ${JSON.stringify(startPayload).slice(0, 500)}`);
    }

    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
      statusPayload = await requestJson(`${apiBaseUrl}/status/${encodeURIComponent(jobId)}`, {
        headers: {
          'x-api-key': apiKey
        }
      });

      const normalized = normalizeStatus(statusPayload);
      if (normalized.failed) {
        throw new Error(normalized.message || `Face swap job ${jobId} failed: ${JSON.stringify(statusPayload).slice(0, 500)}`);
      }

      if (normalized.done) {
        return [{
          json: {
            ...item,
            face_swap_ok: true,
            face_swap_job_id: jobId,
            face_swap_start_response: startPayload,
            face_swap_status_response: statusPayload,
            download_url: `${apiBaseUrl}/download/${encodeURIComponent(jobId)}`
          }
        }];
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Face swap polling timed out after ${maxPollAttempts} attempts for job ${jobId}`);
  } catch (error) {
    return [{
      json: {
        ...item,
        face_swap_ok: false,
        face_swap_job_id: jobId,
        face_swap_start_response: startPayload,
        face_swap_status_response: statusPayload,
        error_message: error?.message || String(error)
      }
    }];
  }
}

return main();
})();
