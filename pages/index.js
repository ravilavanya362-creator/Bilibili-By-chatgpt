import { useState } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';
import { getAllPosts } from '../lib/posts';

export default function Home({ allPosts = [] }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [downloadPreparing, setDownloadPreparing] = useState(false);

  const handleDownload = async (e) => {
    e.preventDefault();

    if (loading || !url.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);
    setDownloadPreparing(false);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: url.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.success === false) {
        throw new Error(
          data.error || 'Unable to process this video.'
        );
      }

      const videoUrl =
        data.downloadUrl ||
        data.directUrl ||
        '';

      if (!videoUrl) {
        throw new Error(
          'No downloadable video was found.'
        );
      }

      setResult({
        ...data,
        videoUrl,
      });
    } catch (err) {
      setError(
        err.message || 'Something went wrong.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();

      if (text) {
        setUrl(text.trim());
      }
    } catch (err) {
      console.error('Paste failed:', err);
    }
  };

  const handleVideoDownload = () => {
  if (!result?.videoUrl || downloadPreparing) return;

  setDownloadPreparing(true);
  setError('');

  const link = document.createElement('a');
  link.href = result.videoUrl;
  link.download = 'Bilibili-Video.mp4';
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
  const formatFileSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return '';

    const size = Number(bytes);

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    if (size < 1024 * 1024 * 1024) {
      return `${(
        size /
        (1024 * 1024)
      ).toFixed(1)} MB`;
    }

    return `${(
      size /
      (1024 * 1024 * 1024)
    ).toFixed(2)} GB`;
  };

  const videoSize =
    result?.filesize ||
    result?.fileSize ||
    result?.filesize_approx ||
    result?.size ||
    0;

  return (
    <Layout>
      <section className="hero-section">
        <div
          className="container"
          style={{
            maxWidth: '640px',
          }}
        >
          <div className="badge-tag">
            <span>🔥</span> Fast & Free Bilibili Downloader
          </div>

          <h1 className="hero-title">
            Download Bilibili Videos
            <br />
            <span className="title-accent">
              in HD Quality
            </span>
          </h1>

          <p className="hero-desc">
            Paste your Bilibili link below to download
            videos, anime and clips in HD quality.
          </p>

          <form
            onSubmit={handleDownload}
            className="input-card"
          >
            <div className="input-group">
              <input
                type="text"
                placeholder="Paste Bilibili link here..."
                value={url}
                onChange={(e) =>
                  setUrl(e.target.value)
                }
              />

              <button
                type="button"
                onClick={handlePaste}
                className="paste-btn"
              >
                📋 Paste
              </button>
            </div>

            <button
              type="submit"
              className="btn-main"
              disabled={loading}
              style={{
                opacity: loading ? 0.8 : 1,
                cursor: loading
                  ? 'wait'
                  : 'pointer',
              }}
            >
              {loading
                ? '⏳ Preparing Download...'
                : 'Download Now 🚀'}
            </button>
          </form>

          {loading && (
            <div
              style={{
                marginTop: '18px',
                padding: '18px 20px',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '14px',
                textAlign: 'left',
              }}
            >
              <strong>
                ⏳ Preparing your video...
              </strong>

              <p
                style={{
                  margin: '8px 0 0',
                  color: '#64748b',
                  fontSize: '0.85rem',
                }}
              >
                We're preparing the fastest available
                download. Please wait.
              </p>
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: '16px',
                color: '#ff0844',
                background: '#fff1f2',
                padding: '12px',
                borderRadius: '12px',
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          {result && (
            <div
              style={{
                marginTop: '24px',
                background: '#fff',
                padding: '20px',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                textAlign: 'left',
                display: 'flex',
                gap: '16px',
                alignItems: 'center',
              }}
            >
              {result.thumbnail && (
                <img
                  src={`/api/thumbnail?url=${encodeURIComponent(
                    result.thumbnail
                  )}`}
                  alt="Video thumbnail"
                  style={{
                    width: '120px',
                    height: '75px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    flexShrink: 0,
                  }}
                />
              )}

              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 700,
                    margin: '0 0 8px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {result.title || 'Bilibili Video'}
                </h3>

                {videoSize > 0 && (
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#64748b',
                      marginBottom: '10px',
                    }}
                  >
                    📦 Size:{' '}
                    {formatFileSize(videoSize)}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleVideoDownload}
                  disabled={downloadPreparing}
                  style={{
                    background: '#10b981',
                    color: '#fff',
                    padding: '9px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: downloadPreparing
                      ? 'wait'
                      : 'pointer',
                    opacity: downloadPreparing
                      ? 0.7
                      : 1,
                  }}
                >
                  {downloadPreparing
                    ? '⏳ Preparing...'
                    : 'Download MP4 📥'}
                </button>

                {downloadPreparing && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '10px 12px',
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '9px',
                      color: '#15803d',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                    }}
                  >
                    Your video is preparing
                    for download...
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="trust-bar">
            <span className="trust-item">
              ⚡ Ultra Fast
            </span>

            <span className="trust-item">
              🛡️ 100% Secure
            </span>

            <span className="trust-item">
              ✨ No Registration
            </span>
          </div>
        </div>
      </section>

      <section
        className="howto-section"
        style={{
          paddingBottom: '30px',
        }}
      >
        <div
          className="container"
          style={{
            maxWidth: '920px',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              marginBottom: '32px',
            }}
          >
            <div className="eyebrow">
              SIMPLE STEPS
            </div>

            <h2 className="howto-main-title">
              How to Download Bilibili Videos
            </h2>

            <p className="howto-subtitle">
              Follow these 3 easy steps to save
              any video instantly.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '20px',
            }}
          >
            <div className="howto-card">
              <div className="howto-badge">
                1
              </div>

              <h3 className="howto-step-title">
                Copy Video Link
              </h3>

              <p className="howto-step-desc">
                Open Bilibili, choose your video
                and copy its share link or URL.
              </p>
            </div>

            <div className="howto-card">
              <div className="howto-badge">
                2
              </div>

              <h3 className="howto-step-title">
                Paste into Downloader
              </h3>

              <p className="howto-step-desc">
                Return to Bili Save, paste the
                link and click Download Now.
              </p>
            </div>

            <div className="howto-card">
              <div className="howto-badge">
                3
              </div>

              <h3 className="howto-step-title">
                Save & Enjoy
              </h3>

              <p className="howto-step-desc">
                Tap Download MP4 and save the
                video directly to your device.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        className="featured-article-section"
        style={{
          padding: '20px 16px 70px',
        }}
      >
        <div
          className="container"
          style={{
            maxWidth: '920px',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              marginBottom: '36px',
            }}
          >
            <div className="eyebrow">
              FROM THE BLOG
            </div>

            <h2 className="howto-main-title">
              Guides & Articles
            </h2>

            <p className="howto-subtitle">
              Everything you need to know about
              video streaming and formats.
            </p>
          </div>

          <div
            className="post-list"
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '24px',
            }}
          >
            {allPosts.map((post, index) => {
              const gradients = [
                'linear-gradient(135deg, #ff0844 0%, #ff4e50 100%)',
                'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                'linear-gradient(135deg, #3b82f6 0%, #4f46e5 100%)',
                'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              ];

              return (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="post-card"
                  style={{
                    borderRadius: '24px',
                    background: '#fff',
                    border:
                      '1px solid #e2e8f0',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    textDecoration: 'none',
                  }}
                >
                  <div
                    className="post-thumb"
                    style={{
                      background:
                        post.gradient ||
                        gradients[
                          index %
                            gradients.length
                        ],
                      height: '140px',
                    }}
                  >
                    <div
                      style={{
                        padding: '20px',
                        height: '100%',
                        boxSizing: 'border-box',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent:
                          'space-between',
                      }}
                    >
                      <strong
                        style={{
                          color: '#fff',
                          fontSize: '0.7rem',
                          textTransform:
                            'uppercase',
                        }}
                      >
                        {post.category ||
                          'BILIBILI'}
                      </strong>

                      <div
                        style={{
                          color: '#fff',
                          fontWeight: 800,
                        }}
                      >
                        {post.tagline ||
                          'Bili Save Guide'}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '20px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: '#94a3b8',
                        marginBottom: '8px',
                      }}
                    >
                      {post.date || ''}
                    </div>

                    <h3
                      style={{
                        fontSize: '1.1rem',
                        color: '#0f172a',
                        margin: '0 0 8px',
                      }}
                    >
                      {post.title}
                    </h3>

                    <p
                      style={{
                        fontSize: '0.9rem',
                        color: '#64748b',
                        lineHeight: 1.5,
                        margin: 0,
                      }}
                    >
                      {post.excerpt}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section
        style={{
          padding: '20px 16px 70px',
        }}
      >
        <div
          className="container"
          style={{
            maxWidth: '800px',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              marginBottom: '30px',
            }}
          >
            <div className="eyebrow">
              HELP CENTER
            </div>

            <h2 className="howto-main-title">
              Frequently Asked Questions
            </h2>
          </div>

          <div
            style={{
              display: 'grid',
              gap: '12px',
            }}
          >
            <details className="faq-item">
              <summary>
                Is Bili Save free to use?
              </summary>
              <p>
                Yes. Bili Save is free to use
                without registration.
              </p>
            </details>

            <details className="faq-item">
              <summary>
                Do I need to install an app?
              </summary>
              <p>
                No. You can use Bili Save
                directly from your browser.
              </p>
            </details>

            <details className="faq-item">
              <summary>
                Where is my video saved?
              </summary>
              <p>
                Downloaded videos are normally
                saved in your device's Downloads
                folder.
              </p>
            </details>

            <details className="faq-item">
              <summary>
                Can I download HD videos?
              </summary>
              <p>
                Bili Save uses the best available
                quality provided by Bilibili.
              </p>
            </details>
          </div>
        </div>
      </section>
    </Layout>
  );
}

export async function getStaticProps() {
  const allPosts = getAllPosts();

  return {
    props: {
      allPosts,
    },
  };
                      }
