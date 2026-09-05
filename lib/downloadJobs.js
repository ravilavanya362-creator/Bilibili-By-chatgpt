import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const jobs = global.__biliSaveJobs || new Map();
global.__biliSaveJobs = jobs;

const JOB_TTL = 30 * 60 * 1000;

function safeFilename(name) {
  return String(name || 'Bilibili Video')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Bilibili Video';
}

function cleanupOldJobs() {
  const now = Date.now();

  for (const [id, job] of jobs) {
    if (
      now - job.createdAt > JOB_TTL &&
      job.status !== 'processing'
    ) {
      if (job.file && fs.existsSync(job.file)) {
        try {
          fs.unlinkSync(job.file);
        } catch {}
      }

      jobs.delete(id);
    }
  }
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();

      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() || `${label} failed.`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function prepareMp4(job) {
  const base = path.join(
    os.tmpdir(),
    `bilisave-${job.id}`
  );

  const sourcePattern = `${base}.%(ext)s`;
  const sourceMp4 = `${base}.mp4`;
  const finalFile = `${base}-final.mp4`;

  job.status = 'processing';
  job.progress = 0;

  try {
    console.log(
      `[BiliSave] Job ${job.id}: yt-dlp started (ONE TIME).`
    );

    const args = [
      '--no-playlist',
      '--no-warnings',
      '--retries',
      '2',
      '--fragment-retries',
      '2',
      '--socket-timeout',
      '20',

      '--add-header',
      'Referer: https://www.bilibili.com/',

      '--add-header',
      'Origin: https://www.bilibili.com',

      '--add-header',
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',

      '-f',
      'bv*+ba/b',

      '--merge-output-format',
      'mp4',

      '--remux-video',
      'mp4',

      '--newline',

      '-o',
      sourcePattern,

      job.url,
    ];

    const child = spawn(
      'yt-dlp',
      args,
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stderr = '';
    let output = '';

    const parseProgress = (text) => {
      output += text;

      const matches =
        text.match(/(\d+(?:\.\d+)?)%/g);

      if (matches?.length) {
        const n = parseFloat(
          matches[matches.length - 1]
        );

        if (Number.isFinite(n)) {
          job.progress = Math.max(
            0,
            Math.min(99, n)
          );
        }
      }
    };

    child.stdout.on('data', (d) => {
      parseProgress(d.toString());
    });

    child.stderr.on('data', (d) => {
      const text = d.toString();

      stderr += text;
      parseProgress(text);

      if (stderr.length > 15000) {
        stderr = stderr.slice(-15000);
      }
    });

    await new Promise((resolve, reject) => {
      child.on('error', reject);

      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              stderr.trim() ||
              output.trim() ||
              'Could not download this Bilibili video.'
            )
          );

          return;
        }

        resolve();
      });
    });

    let sourceFile = sourceMp4;

    if (!fs.existsSync(sourceFile)) {
      const files = fs
        .readdirSync(os.tmpdir())
        .filter(
          (name) =>
            name.startsWith(
              `bilisave-${job.id}.`
            ) &&
            !name.endsWith('-final.mp4')
        );

      if (!files.length) {
        throw new Error(
          'yt-dlp finished but no video file was created.'
        );
      }

      sourceFile = path.join(
        os.tmpdir(),
        files[0]
      );
    }

    console.log(
      `[BiliSave] Job ${job.id}: yt-dlp finished. Finalizing MP4.`
    );

    await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',

        '-i',
        sourceFile,

        '-map',
        '0:v:0?',

        '-map',
        '0:a:0?',

        '-c',
        'copy',

        '-movflags',
        '+faststart',

        '-f',
        'mp4',

        '-y',
        finalFile,
      ],
      'MP4 finalization'
    );

    if (!fs.existsSync(finalFile)) {
      throw new Error(
        'Final MP4 was not created.'
      );
    }

    const stat = fs.statSync(finalFile);

    if (stat.size < 1024) {
      throw new Error(
        'Generated MP4 is empty or invalid.'
      );
    }

    if (
      sourceFile !== finalFile &&
      fs.existsSync(sourceFile)
    ) {
      try {
        fs.unlinkSync(sourceFile);
      } catch {}
    }

    job.file = finalFile;
    job.size = stat.size;
    job.progress = 100;
    job.status = 'ready';
    job.readyAt = Date.now();

    console.log(
      `[BiliSave] Job ${job.id}: MP4 ready (${stat.size} bytes).`
    );
  } catch (error) {
    job.status = 'error';
    job.error =
      error.message ||
      'Could not prepare the video.';

    job.progress = 0;

    console.error(
      `[BiliSave] Job ${job.id} failed:`,
      error
    );

    const basePrefix =
      `bilisave-${job.id}`;

    for (const name of fs.readdirSync(
      os.tmpdir()
    )) {
      if (name.startsWith(basePrefix)) {
        try {
          fs.unlinkSync(
            path.join(os.tmpdir(), name)
          );
        } catch {}
      }
    }
  }
}

export function createDownloadJob(url) {
  cleanupOldJobs();

  const id =
    crypto.randomBytes(16).toString('hex');

  const job = {
    id,
    url,
    title: 'Bilibili Video',
    status: 'processing',
    progress: 0,
    file: null,
    size: 0,
    error: null,
    createdAt: Date.now(),
  };

  jobs.set(id, job);

  prepareMp4(job);

  return job;
}

export function getDownloadJob(id) {
  cleanupOldJobs();

  return jobs.get(id) || null;
}

export function deleteDownloadJob(id) {
  const job = jobs.get(id);

  if (
    job?.file &&
    fs.existsSync(job.file)
  ) {
    try {
      fs.unlinkSync(job.file);
    } catch {}
  }

  jobs.delete(id);
}

export { safeFilename };
