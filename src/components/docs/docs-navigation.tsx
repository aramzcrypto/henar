"use client";

import Link from "next/link";
import { useState } from "react";
import { Search, Menu, X } from "lucide-react";
import { docHref } from "@/lib/docs";
import styles from "@/app/docs/docs.module.css";

type Entry = { slug: string; title: string; group: string; search: string };
export function DocsNavigation({
  entries,
  active,
}: {
  entries: Entry[];
  active: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = entries.filter((entry) =>
    entry.search.includes(query.trim().toLowerCase()),
  );
  const groups = [...new Set(filtered.map((entry) => entry.group))];
  return (
    <>
      <button
        className={styles.mobileToggle}
        type="button"
        aria-expanded={open}
        aria-controls="docs-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={17} /> : <Menu size={17} />} Browse docs
      </button>
      <aside
        id="docs-navigation"
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}
      >
        <label className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search documentation"
            placeholder="Search docs…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <nav className={styles.navigation} aria-label="Documentation">
          {groups.map((group) => (
            <div key={group} className={styles.navGroup}>
              <span>{group}</span>
              {filtered
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <Link
                    key={entry.slug}
                    href={docHref(entry.slug)}
                    aria-current={active === entry.slug ? "page" : undefined}
                    className={
                      active === entry.slug ? styles.active : undefined
                    }
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    {entry.title}
                  </Link>
                ))}
            </div>
          ))}
          {!filtered.length && (
            <p className={styles.noResults}>No matching guides.</p>
          )}
        </nav>
        <div className={styles.sidebarFoot}>
          <span className={styles.dot} /> V1 documentation
        </div>
      </aside>
    </>
  );
}
