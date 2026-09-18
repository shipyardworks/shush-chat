import Link from "next/link";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * A server component, and the only page that can be one.
 *
 * Everything past this point is a live websocket and a local session token, which is
 * client-side by nature. This page is static copy and a link, so it is rendered on the server
 * and arrives as HTML -- the visitor sees the product before any JavaScript has run.
 */
export default function Landing() {
  return (
    <div className="grid h-full grid-rows-[auto_1fr]">
      <header
        className="relative z-10 flex items-center gap-3.5 border-b px-5 py-3.5 backdrop-blur-xl"
        style={{
          borderColor: "var(--color-line-soft)",
          backgroundColor: "color-mix(in srgb, var(--color-surface) 70%, transparent)",
        }}
      >
        <Brand />
        <span className="flex-1" />
        <ThemeToggle />
      </header>

      <main className="grid min-h-0 place-items-center overflow-y-auto p-6">
        <div className="max-w-[520px] text-center">
          <h1 className="m-0 mb-2.5 text-[34px] leading-tight font-bold tracking-tight">
            Talk to{" "}
            <span
              style={{
                backgroundImage: "var(--gradient-mark)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              someone new
            </span>
            .
          </h1>
          <p className="mx-auto mb-5.5 max-w-[400px]" style={{ color: "var(--color-muted)" }}>
            No sign-up, no email, no form. Pick a couple of things you are into and we will find
            you someone who is into them too.
          </p>
          <Link id="startChatting" href="/chat" className="btn-primary inline-block px-6 py-3">
            Start chatting
          </Link>
        </div>
      </main>
    </div>
  );
}
