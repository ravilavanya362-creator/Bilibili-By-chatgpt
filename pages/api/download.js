import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
  },
};

function isBilibiliUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();

    return (
      host === 'b23.tv' ||
      host === 'www.b23.tv' ||
      host === 'bilibili.com' ||
      host === 'www.bilibili.com' ||
      host.endsWith('.bilibili.com')
    );
  } catch {
    return false;
  }
}

function safeFilename(name) {
  return String(name || 'Bilibili Video')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Bilibili Video';
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 8000) stdout = stdout.slice(-8000);
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 15000) stderr = stderr.slice(-15000);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || 'yt-dlp failed.'));
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const url = typeof req.query?.url === 'string' ? req.query.url : '';

  if (!url || !isBilibiliUrl(url)) {
    return res.status(400).json({ success: false, error: 'Invalid Bilibili URL.' });
  }

  const id = crypto.randomBytes(12).toString('hex');
  const base = path.join(os.tmpdir(), `bilisave-direct-${id}`);
  const output = `${base}.mp4`;
  let child = null;
  let finished = false;

  const cleanup = () => {
    try {
      if (fs.existsSync(output)) fs.unlinkSync(output);
    } catch {}
  };

  req.on('close', () => {
    if (!finished && child && !child.killed) {
      try { child.kill('SIGTERM'); } catch {}
    }
    if (finished) cleanup();
  });

  try {
    // Prefer the best publicly available quality up to 1080p.
    // If Bilibili only exposes a lower public quality, yt-dlp falls back to it.
    // The final MP4 is temporary and is deleted immediately after streaming.
    const args = [
      '--no-playlist',
      '--no-cache-dir',
      '--no-warnings',
      '--retries', '2',
      '--fragment-retries', '2',
      '--socket-timeout', '20',
      '--add-header', 'Referer: https://www.bilibili.com/',
      '--add-header', 'Origin: https://www.bilibili.com',
      '--add-header', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      '-f', 'bv*[height<=1080]+ba/b[height<=1080]',
      '--merge-output-format', 'mp4',
      '--remux-video', 'mp4',
      '--print', 'after_move:title',
      '-o', output,
      url,
    ];

    child = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 10000) stdout = stdout.slice(-10000);
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 16000) stderr = stderr.slice(-16000);
    });

    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    if (code !== 0 || !fs.existsSync(output)) {
      throw new Error(stderr.trim() || stdout.trim() || 'Could not download this Bilibili video.');
    }

    const stat = fs.statSync(output);
    if (stat.size < 1024) throw new Error('Generated video is empty or invalid.');

    const titleLine = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    const filename = `${safeFilename(titleLine || 'Bilibili Video')}.mp4`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(output);
      stream.on('error', reject);
      res.on('finish', resolve);
      res.on('close', resolve);
      stream.pipe(res);
    });

    finished = true;
    cleanup();
  } catch (error) {
    console.error('[BiliSave] Download failed:', error);
    cleanup();

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'This video could not be downloaded. It may only have premium/restricted qualities or may be temporarily unavailable.',
      });
    }

    if (!res.destroyed) res.destroy();
  }
}
