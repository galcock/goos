// A small Chrome profile where Chrome keeps it on Windows, for win-test.yml:
// three pages of history and two bookmarks, so Goos's Chrome import has
// something to bring over. Only ever run on a throwaway CI machine.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
fs.rmSync(root, { recursive: true, force: true });
const profile = path.join(root, 'Default');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } }, last_used: 'Default' } }));

const db = new DatabaseSync(path.join(profile, 'History'));
db.exec(`create table urls (id integer primary key, url text, title text, visit_count integer default 0, typed_count integer default 0, last_visit_time integer default 0, hidden integer default 0);
create table visits (id integer primary key, url integer, visit_time integer, from_visit integer default 0, transition integer default 0, visit_duration integer default 0);`);
const chromeTime = (ms) => BigInt(ms + 11644473600000) * 1000n;
const pages = [['https://example.com/', 'Example'], ['https://en.wikipedia.org/wiki/Goose', 'Goose - Wikipedia'], ['https://news.ycombinator.com/', 'Hacker News']];
pages.forEach(([url, title], i) => {
  db.prepare('insert into urls (id, url, title) values (?, ?, ?)').run(i + 1, url, title);
  db.prepare('insert into visits (url, visit_time, visit_duration) values (?, ?, ?)').run(i + 1, chromeTime(Date.now() - (i + 1) * 3600e3), 60000000n);
});
db.close();

fs.writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({
  roots: {
    bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [{ type: 'url', name: 'Goos Search', url: 'https://goos.si/' }] },
    other: { type: 'folder', name: 'Other bookmarks', children: [{ type: 'url', name: 'Ameka', url: 'https://ameka.ai/' }] },
  },
}));
console.log(`Chrome profile at ${root}: ${pages.length} pages, 2 bookmarks`);
