import { getAllPosts } from '../lib/posts';

export default function SiteMap() {
  // getServerSideProps handles the XML generation
}

export async function getServerSideProps({ res }) {
  const baseUrl = 'https://bilisave.com';
  const posts = getAllPosts();

  const staticPages = [
    '',
    '/about',
    '/blog',
    '/contact',
    '/copyright',
    '/disclaimer',
    '/privacy',
    '/terms',
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${staticPages
    .map((slug) => {
      return `
    <url>
      <loc>${baseUrl}${slug}</loc>
      <changefreq>daily</changefreq>
      <priority>${slug === '' ? '1.0' : '0.8'}</priority>
    </url>
  `;
    })
    .join('')}
  ${posts
    .map((post) => {
      return `
    <url>
      <loc>${baseUrl}/blog/${post.slug}</loc>
      <lastmod>${post.date ? new Date(post.date).toISOString() : new Date().toISOString()}</lastmod>
      <changefreq>weekly</changefreq>
      <priority>0.7</priority>
    </url>
  `;
    })
    .join('')}
</urlset>
`;

  res.setHeader('Content-Type', 'text/xml');
  res.write(sitemap);
  res.end();

  return {
    props: {},
  };
}
