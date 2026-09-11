import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const config = {
  api: { responseLimit: false },
};

function isBilibiliUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return (
      host === 'bilibili.com' ||
      host === 'www.bilibili.com' ||
      host.endsWith('.bilibili.com') ||
      host === 'b23.tv' ||
      host === 'www.b23.tv'
    );
  } catch {
    return false;
  }
}

function safeNames(title) {
  const raw = String(title || 'Bilibili Video')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 180) || 'Bilibili Video';

  const ascii = raw.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').trim() || 'video';
  const encoded = encodeURIComponent(raw).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return { ascii, encoded };
}

function formatScore(f) {
  if (!f || !f.url || !f.vcodec || f.vcodec === 'none') return -1;
  const height = Number(f.height || 0);
  const fps = Number(f.fps || 0);
  const tbr = Number(f.tbr || f.vbr || 0);
  const videoCodecBonus =
    String(f.vcodec).startsWith('avc') ? 20 :
    String(f.vcodec).startsWith('hev') ? 15 :
    String(f.vcodec).startsWith('av01') ? 10 : 0;
  return height * 100000 + fps * 100 + tbr + videoCodecBonus;
}

function getHeaders(format) {
  const raw = format?.http_headers || {};
  const headers = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (lower === 'user-agent' || lower === 'referer' || lower === 'origin' || lower === 'cookie') {
      headers[key] = String(value);
    }
  }

  const has = (name) =>
    Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());

  if (!has('User-Agent')) {
    headers['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
  }
  if (!has('Referer')) headers['Referer'] = 'https://www.bilibili.com/';
  if (!has('Origin')) headers['Origin'] = 'https://www.bilibili.com';

  return headers;
}

function headersToFFmpeg(headers) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${String(value).replace(/\r?\n/g, ' ')}`)
    .join('\r\n') + '\r\n';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  const title = typeof req.query.title === 'string' ? req.query.title : '';

  if (!url || !isBilibiliUrl(url)) {
    return res.status(400).json({ error: 'Please enter a valid Bilibili or b23.tv URL.' });
  }

  let info;
  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--no-warnings', '--no-playlist', '--skip-download', '--dump-single-json', url],
      { timeout: 60000, maxBuffer: 30 * 1024 * 1024 }
    );
    info = JSON.parse(stdout.trim());
  } catch (error) {
    console.error('[BiliSave] stream info error:', error);
    return res.status(502).json({
      error: 'Bilibili could not provide this video. It may be private, deleted, region-restricted, or temporarily unavailable.',
    });
  }

  const formats = Array.isArray(info.formats) ? info.formats : [];

  // First choice: a combined MP4 stream. It can be proxied directly, so no
  // server-side video file and no FFmpeg process are needed for this case.
  const progressive = formats
    .filter((f) =>
      f.url &&
      f.vcodec && f.vcodec !== 'none' &&
      f.acodec && f.acodec !== 'none' &&
      (f.ext === 'mp4' || f.ext === 'm4v')
    )
    .sort((a, b) => formatScore(b) - formatScore(a))[0];

  const videoOnly = formats
    .filter((f) =>
      f.url &&
      f.vcodec && f.vcodec !== 'none' &&
      (!f.acodec || f.acodec === 'none')
    )
    .sort((a, b) => formatScore(b) - formatScore(a))[0];

  const audioOnly = formats
    .filter((f) =>
      f.url &&
      f.acodec && f.acodec !== 'none' &&
      (!f.vcodec || f.vcodec === 'none')
    )
    .sort((a, b) =>
      Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0)
    )[0];

  const { ascii, encoded } = safeNames(title || info.title);

  if (progressive) {
    try {
      const upstream = await fetch(progressive.url, {
        headers: getHeaders(progressive),
        redirect: 'follow',
      });

      if (!upstream.ok || !upstream.body) {
        throw new Error(`CDN returned ${upstream.status}`);
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${ascii}.mp4"; filename*=UTF-8''${encoded}.mp4`
      );
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const { Readable } = await import('stream');
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on('error', (error) => {
        console.error('[BiliSave] upstream stream error:', error);
        if (!res.destroyed) res.destroy(error);
      });
      res.on('close', () => {
        if (!nodeStream.destroyed) nodeStream.destroy();
      });
      nodeStream.pipe(res);
      return;
    } catch (error) {
      console.error('[BiliSave] direct CDN stream failed:', error);
      // Fall through to FFmpeg if separate streams are available.
    }
  }

  if (!videoOnly || !audioOnly) {
    return res.status(502).json({ error: 'No downloadable video stream is currently available.' });
  }

  // When Bilibili exposes separate video/audio streams, FFmpeg muxes them
  // directly to HTTP stdout. No MP4 is written to disk.
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-headers', headersToFFmpeg(getHeaders(videoOnly)),
    '-i', videoOnly.url,
    '-headers', headersToFFmpeg(getHeaders(audioOnly)),
    '-i', audioOnly.url,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c', 'copy',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let responseStarted = false;
  let stopping = false;

  ffmpeg.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 12000) stderr = stderr.slice(-12000);
  });

  ffmpeg.stdout.once('data', () => {
    responseStarted = true;
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${ascii}.mp4"; filename*=UTF-8''${encoded}.mp4`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  ffmpeg.stdout.pipe(res);

  ffmpeg.on('error', (error) => {
    console.error('[BiliSave] ffmpeg error:', error);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Could not start the video stream.' });
    }
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0 && !responseStarted && !res.headersSent) {
      console.error('[BiliSave] ffmpeg failed:', stderr);
      res.status(502).json({ error: 'The video stream could not be prepared. Please try again.' });
    }
  });

  const abort = () => {
    if (stopping) return;
    stopping = true;
    if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
  };

  req.on('aborted', abort);
  res.on('close', abort);
}
