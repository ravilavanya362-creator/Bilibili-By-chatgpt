import { spawn } from 'child_process';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const url =
    typeof req.query?.url === 'string'
      ? req.query.url
      : '';

  if (!url || !isBilibiliUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Bilibili URL.',
    });
  }

  const ytDlp = spawn(
    'yt-dlp',
    [
      '--no-playlist',
      '--no-cache-dir',

      // Single file only.
      // Do NOT select separate video + audio streams.
      '-f',
      'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]',

      // Stream directly to browser.
      '-o',
      '-',

      url,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let errorOutput = '';
  let started = false;

  ytDlp.stdout.on('data', (chunk) => {
    if (!started) {
      started = true;

      res.statusCode = 200;

      res.setHeader(
        'Content-Type',
        'video/mp4'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="Bilibili-Video.mp4"'
      );

      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate'
      );

      res.setHeader(
        'X-Content-Type-Options',
        'nosniff'
      );
    }
  });

  ytDlp.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString();
  });

  ytDlp.stdout.pipe(res);

  ytDlp.on('error', (error) => {
    console.error(
      '[BiliSave] yt-dlp error:',
      error
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Could not start video download.',
      });
    }

    res.destroy();
  });

  ytDlp.on('close', (code) => {
    if (code !== 0) {
      console.error(
        '[BiliSave] yt-dlp failed:',
        errorOutput
      );

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error:
            'This video does not have a downloadable single-file format.',
        });
      }

      if (!res.destroyed) {
        res.destroy();
      }
    }
  });

  req.on('close', () => {
    if (!ytDlp.killed) {
      ytDlp.kill('SIGTERM');
    }
  });
}
