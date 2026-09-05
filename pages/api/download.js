import fs from "fs";
import { getDownloadJob, removeDownloadJob } from "../../lib/downloadJobs";

export const config = {
  api: {
    responseLimit: false,
    bodyParser: true,
  },
};

function safeFilename(name) {
  return (
    String(name || "Bilibili Video")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "Bilibili Video"
  );
}

function waitForJob(jobId, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const job = getDownloadJob(jobId);
      if (!job) {
        reject(new Error("Download job was not found or has expired."));
        return;
      }
      if (job.status === "ready") {
        resolve(job);
        return;
      }
      if (job.status === "error") {
        reject(new Error(job.error || "Could not create the MP4."));
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("Video preparation timed out. Please try again."));
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const jobId = typeof req.query?.jobId === "string" ? req.query.jobId : "";
  if (!jobId) {
    return res.status(400).json({ success: false, error: "Download job is missing." });
  }

  try {
    const job = await waitForJob(jobId);

    if (!fs.existsSync(job.file)) {
      throw new Error("Prepared MP4 file is no longer available.");
    }

    const stat = fs.statSync(job.file);
    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Bilibili-Video.mp4"; filename*=UTF-8''${encodeURIComponent(safeFilename(job.title) + ".mp4")}`
    );
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(job.file);
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.pipe(res);
    });

    console.log(`[BiliSave] Job ${jobId} sent to browser successfully.`);
    removeDownloadJob(jobId);
  } catch (error) {
    console.error(`[BiliSave] Download error for job ${jobId}:`, error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error?.message || "Could not download the MP4.",
      });
    }
    if (!res.destroyed) res.destroy();
  }
}
