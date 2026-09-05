import fs from 'fs';

import {
  getDownloadJob,
  deleteDownloadJob,
  safeFilename,
} from '../../lib/downloadJobs';

export const config = {
  api: {
    responseLimit: false,
    bodyParser: true,
  },
};

function waitForJob(
  id,
  timeout = 25 * 60 * 1000
) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const check = () => {
      const job = getDownloadJob(id);

      if (!job) {
        return reject(
          new Error(
            'Download job was not found or has expired.'
          )
        );
      }

      if (job.status === 'ready') {
        return resolve(job);
      }

      if (job.status === 'error') {
        return reject(
          new Error(
            job.error ||
            'Could not prepare the video.'
          )
        );
      }

      if (
        Date.now() - started >
        timeout
      ) {
        return reject(
          new Error(
            'Video preparation timed out. Please try again.'
          )
        );
      }

      setTimeout(check, 500);
    };

    check();
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const jobId =
    typeof req.query?.jobId === 'string'
      ? req.query.jobId
      : '';

  if (!jobId) {
    return res.status(400).json({
      success: false,
      error: 'Download job is missing.',
    });
  }

  try {
    const job = await waitForJob(jobId);

    if (
      !job.file ||
      !fs.existsSync(job.file)
    ) {
      throw new Error(
        'Prepared MP4 is no longer available.'
      );
    }

    const stat = fs.statSync(job.file);

    const title = safeFilename(
      job.title || 'Bilibili Video'
    );

    res.statusCode = 200;

    res.setHeader(
      'Content-Type',
      'video/mp4'
    );

    res.setHeader(
      'Content-Length',
      stat.size
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Bilibili-Video.mp4"; filename*=UTF-8''${encodeURIComponent(
        title + '.mp4'
      )}`
    );

    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate'
    );

    res.setHeader(
      'Pragma',
      'no-cache'
    );

    res.setHeader(
      'X-Content-Type-Options',
      'nosniff'
    );

    await new Promise(
      (resolve, reject) => {
        const stream =
          fs.createReadStream(
            job.file
          );

        stream.on(
          'error',
          reject
        );

        stream.on(
          'end',
          resolve
        );

        stream.pipe(res);
      }
    );

    console.log(
      `[BiliSave] Job ${jobId}: MP4 sent successfully.`
    );

    deleteDownloadJob(jobId);
  } catch (error) {
    console.error(
      `[BiliSave] Download ${jobId} error:`,
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error:
          error.message ||
          'Could not download the MP4.',
      });
    }

    if (!res.destroyed) {
      res.destroy();
    }
  }
}
