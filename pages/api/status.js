import { getDownloadJob } from '../../../lib/downloadJobs';

export default function handler(req, res) {
  if (req.method !== 'GET') {
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
      error: 'Job ID is missing.',
    });
  }

  const job = getDownloadJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Download job was not found or has expired.',
    });
  }

  return res.status(200).json({
    success: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress || 0,
    size: job.size || 0,
    error: job.error || null,
  });
}
