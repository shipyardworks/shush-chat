"use client";

import { useEffect, useState } from "react";

const SunIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.7 6.7 0 0 0 10.7 10.7z" />
  </svg>
);

/** An icon, not a word: "Light"/"Dark" named the state you would switch to, which is one more
    thing to read for something people reach for without looking. A sun and a moon do not need
    a caption. */
export const ThemeToggle = () => {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("shush.theme", next);
    } catch {
      // Private browsing. The theme simply will not persist, which is not worth failing over.
    }
  };

  return (
    <button
      id="themeToggle"
      type="button"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
      data-theme-state={theme}
      onClick={toggle}
      className="btn-ghost grid h-9 w-9 place-items-center rounded-full p-0"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
};
