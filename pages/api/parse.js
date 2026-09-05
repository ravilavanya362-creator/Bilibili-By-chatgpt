import { createDownloadJob } from '../../lib/downloadJobs';

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

function isBilibiliUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return host === 'b23.tv' || host === 'www.b23.tv' || host === 'bilibili.com' || host === 'www.bilibili.com' || host.endsWith('.bilibili.com');
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: 'Please enter a Bilibili URL.' });
  if (!isBilibiliUrl(url)) return res.status(400).json({ success: false, error: 'Please enter a valid Bilibili or b23.tv URL.' });

  try {
    const job = createDownloadJob(url);
    console.log(`[BiliSave] Download job created: ${job.id}`);

    return res.status(200).json({
      success: true,
      mode: 'job',
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      title: job.title,
      downloadUrl: `/api/download?jobId=${encodeURIComponent(job.id)}`,
    });
  } catch (error) {
    console.error('[BiliSave] Job creation error:', error);
    return res.status(500).json({ success: false, error: 'Could not start this Bilibili download.' });
  }
}

