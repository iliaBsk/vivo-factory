import { EventEmitter } from "node:events";

const JOB_TTL_MS = 5 * 60 * 1000;

export function createOnboardingRelay() {
  const jobs = new Map();

  function startJob(jobId) {
    if (jobs.has(jobId)) return;
    const emitter = new EventEmitter();
    const timer = setTimeout(() => {
      const job = jobs.get(jobId);
      if (job) job.emitter.emit("done");
      cancelJob(jobId);
    }, JOB_TTL_MS);
    jobs.set(jobId, { emitter, timer });
  }

  function postEvent(jobId, event) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.emitter.emit("event", event);
  }

  function complete(jobId, persona) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.emitter.emit("event", { type: "complete", persona: persona ?? null });
    job.emitter.emit("done");
    cancelJob(jobId);
  }

  function streamSSE(jobId, res) {
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Job not found");
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    });
    res.write(":\n\n");

    const keepAlive = setInterval(() => res.write(":\n\n"), 20_000);

    function sendEvent(event) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    function onDone() {
      clearInterval(keepAlive);
      res.end();
    }

    job.emitter.on("event", sendEvent);
    job.emitter.once("done", onDone);

    res.on("close", () => {
      clearInterval(keepAlive);
      job.emitter.off("event", sendEvent);
      job.emitter.off("done", onDone);
    });
  }

  function cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;
    clearTimeout(job.timer);
    jobs.delete(jobId);
  }

  return { startJob, postEvent, complete, streamSSE, cancelJob };
}
