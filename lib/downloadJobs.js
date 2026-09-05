import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";

const JOB_TTL = 30 * 60 * 1000;

const store = globalThis.__biliSaveJobs || new Map();
if (!globalThis.__biliSaveJobs) globalThis.__biliSaveJobs = store;

function safeFilename(name) {
  return (
    String(name || "Bilibili Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "Bilibili Video"
  );
}

function headersToFFmpeg(headers) {
  if (!headers || typeof headers !== "object") return "";
  return Object.entries(headers)
    .filter(([, value]) => value != null && String(value).trim())
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\r\n") + "\r\n";
}

function runFFmpeg(args, outputFile, jobId) {
  return new Promise((resolve, reject) => {
    console.log(`[BiliSave] FFmpeg started for job ${jobId}`);

    const child = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "FFmpeg could not create the MP4."));
        return;
      }
      if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size < 1024) {
        reject(new Error("Generated MP4 is empty or invalid."));
        return;
      }
      console.log(`[BiliSave] MP4 finalized for job ${jobId}`);
      resolve();
    });
  });
}

function cleanupJob(jobId) {
  const job = store.get(jobId);
  if (!job) return;
  if (job.file && fs.existsSync(job.file)) {
    try { fs.unlinkSync(job.file); } catch {}
  }
  store.delete(jobId);
}

function scheduleCleanup(jobId) {
  setTimeout(() => cleanupJob(jobId), JOB_TTL).unref?.();
}

export function createDownloadJob({
  title,
  directUrl,
  directHeaders,
  videoUrl,
  audioUrl,
  videoHeaders,
  audioHeaders,
}) {
  const jobId = crypto.randomBytes(18).toString("hex");
  const outputFile = path.join(os.tmpdir(), `bili-${jobId}.mp4`);

  const job = {
    id: jobId,
    title: safeFilename(title),
    status: "processing",
    file: outputFile,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
  };

  store.set(jobId, job);
  scheduleCleanup(jobId);

  // Start immediately, using the exact URLs and headers produced by this
  // parse request. yt-dlp is never called again for this job.
  (async () => {
    try {
      if (directUrl) {
        const args = [
          "-hide_banner", "-loglevel", "error",
          "-headers", headersToFFmpeg(directHeaders),
          "-i", directUrl,
          "-map", "0:v:0?",
          "-map", "0:a:0?",
          "-c", "copy",
          "-movflags", "+faststart",
          "-f", "mp4",
          outputFile,
        ];
        await runFFmpeg(args, outputFile, jobId);
      } else {
        const args = [
          "-hide_banner", "-loglevel", "error",
          "-headers", headersToFFmpeg(videoHeaders),
          "-i", videoUrl,
          "-headers", headersToFFmpeg(audioHeaders),
          "-i", audioUrl,
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-c:v", "copy",
          "-c:a", "copy",
          "-movflags", "+faststart",
          "-f", "mp4",
          outputFile,
        ];
        await runFFmpeg(args, outputFile, jobId);
      }

      const size = fs.statSync(outputFile).size;
      job.status = "ready";
      job.size = size;
      job.finishedAt = Date.now();
      console.log(`[BiliSave] Job ${jobId} ready: ${size} bytes`);
    } catch (error) {
      job.status = "error";
      job.error = error?.message || "Could not create the MP4.";
      job.finishedAt = Date.now();
      console.error(`[BiliSave] Job ${jobId} failed:`, job.error);
      if (fs.existsSync(outputFile)) {
        try { fs.unlinkSync(outputFile); } catch {}
      }
    }
  })();

  return jobId;
}

export function getDownloadJob(jobId) {
  return store.get(jobId);
}

export function removeDownloadJob(jobId) {
  cleanupJob(jobId);
}
