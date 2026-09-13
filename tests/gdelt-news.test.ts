import assert from "node:assert/strict";
import test from "node:test";
import { parseGdeltArticles } from "../src/lib/equities/gdelt";

test("GDELT parser keeps valid HTTPS article metadata and removes duplicates", () => {
  const items = parseGdeltArticles({ articles: [
    { url: "https://example.com/story", title: "Company update", seendate: "20260913T102030Z", domain: "www.example.com" },
    { url: "https://example.com/story", title: "Duplicate", seendate: "20260913T102030Z", domain: "example.com" },
    { url: "http://unsafe.example/story", title: "Unsafe", seendate: "20260913T102030Z", domain: "unsafe.example" },
  ] });
  assert.deepEqual(items, [{
    id: "https://example.com/story",
    headline: "Company update",
    publishedAt: "2026-09-13T10:20:30.000Z",
    publisher: "example.com",
    url: "https://example.com/story",
  }]);
});
