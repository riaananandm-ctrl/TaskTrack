// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver) that TaskTrack's public pages changed.
// Run after a deploy that changes public pages:  node scripts/indexnow.mjs
const HOST = 'tasktrackbm.vercel.app';
const KEY = '56c5de77f9976f55deb78cd1c53bdff2'; // must match public/56c5de77f9976f55deb78cd1c53bdff2.txt
const PATHS = ['/', '/about', '/ib-study-planner', '/managebac-planner', '/ib-cas-tracker', '/signup', '/contact', '/privacy', '/terms', '/refund-policy'];

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: PATHS.map((p) => `https://${HOST}${p}`),
  }),
});
console.log('IndexNow:', res.status, res.status === 200 || res.status === 202 ? 'accepted' : await res.text());
