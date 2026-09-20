"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Brand } from "@/components/Brand";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { CameraCapture } from "@/components/CameraCapture";
import { ChatPanel } from "@/components/ChatPanel";
import { ImageViewer } from "@/components/ImageViewer";
import { ProfileDialog, type ProfileTarget } from "@/components/ProfileDialog";
import { RequestsMenu } from "@/components/RequestsMenu";
import { SetupPanel } from "@/components/SetupPanel";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Menu } from "@/components/icons";
import { useShush } from "@/lib/useShush";

/**
 * Client-rendered, and it has to be: this page is a live websocket, a session token held in
 * this browser, and a conversation that only exists once both are up. There is nothing here a
 * server could usefully render ahead of time. The landing page at / is the server component.
 */
export default function Chat() {
  const shush = useShush();
  const [profile, setProfile] = useState<ProfileTarget | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Phone only -- below sm both panes always show. A visibility switch, not a second state.
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  useEffect(() => {
    setMobileView("detail");
  }, [shush.view, shush.conversationId]);

  // Keeps --app-height (globals.css) equal to the actual visible viewport. iOS Safari's own
  // scroll-the-focused-input-into-view heuristic is what dragged the header off the top before
  // this: once the shell's real height already matches what's visible above the keyboard, the
  // composer sits inside it with nothing left for iOS to scroll to reveal.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let settle = 0;
    const sync = () => {
      document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
      window.scrollTo(0, 0);
    };
    /**
     * Measure, then measure again once the animation is over.
     *
     * iOS reports the viewport *during* the keyboard transition, and the bottom browser
     * toolbar collapses on a different frame from the keyboard rising. A single reading taken
     * mid-flight is short by roughly the toolbar's height, and the shell keeps that wrong
     * height afterwards -- which is the band of empty page that appeared under the composer
     * whenever the message box was tapped. Re-reading after it stops moving costs one extra
     * measurement and is the only thing that gets the final number.
     */
    const syncAndSettle = () => {
      sync();
      clearTimeout(settle);
      settle = window.setTimeout(sync, 300);
    };
    sync();
    viewport.addEventListener("resize", syncAndSettle);
    viewport.addEventListener("scroll", sync);
    return () => {
      clearTimeout(settle);
      viewport.removeEventListener("resize", syncAndSettle);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);

  const setup = (bare: boolean) => (
    <SetupPanel
      interests={shush.interests}
      selected={shush.selected}
      setSelected={shush.setSelected}
      customInterests={shush.customInterests}
      onAddInterest={shush.addInterest}
      onRemoveInterest={shush.removeCustomInterest}
      patience={shush.patience}
      setPatience={shush.setPatience}
      findStatus={shush.findStatus}
      searching={shush.searching}
      onFind={shush.findSomeone}
      onCancelFind={shush.cancelFind}
      bare={bare}
    />
  );

  const signedIn = Boolean(shush.session);
  /**
   * A conversation owns the whole phone screen, drawer open or not.
   *
   * <p>This used to also require the drawer to be shut, so opening the drawer from a chat
   * brought the app header back with it -- the page appeared to swap its own header on the way
   * in, for no reason the person could see. The chat has its own header with the same burger
   * in it; the app header belongs to the screen you find people on.
   */
  const chatOpenOnPhone = shush.view === "chat";

  return (
    // flex, not a 2-row grid: a grid-rows-[auto_1fr] here put main in row 2 by explicit template,
    // but when header goes display:none on phone it stops being a grid item at all -- main then
    // auto-places into row 1 (auto-height, sized to its own content) and row 2's real 1fr space
    // sits empty below it. A hidden flex sibling is just removed from flow instead, so the
    // remaining item still grows to fill every time, regardless of which siblings are shown.
    <div className="flex h-full flex-col">
      <header
        className={`relative z-10 items-center gap-3.5 border-b px-5 py-3.5 backdrop-blur-xl ${
          chatOpenOnPhone ? "hidden sm:flex" : "flex"
        }`}
        style={{
          borderColor: "var(--color-line-soft)",
          backgroundColor: "color-mix(in srgb, var(--color-surface) 70%, transparent)",
        }}
      >
        {/* The same burger the chat header has, so the drawer opens from one control wherever
            you are. It replaced a "<" on the setup panel that pointed back at a list the
            panel was not inside. */}
        {shush.session && (
          <button
            id="openDrawer"
            type="button"
            aria-label="Chats and friends"
            title="Chats and friends"
            onClick={() => setMobileView("list")}
            className="btn-ghost -ml-2 grid h-9 w-9 flex-none place-items-center rounded-full p-0 sm:hidden"
          >
            <Menu />
          </button>
        )}
        {/* The logo goes back to the start screen. It only changes what is on screen: walking
            out of a live conversation by navigating away would be a silent disappearance
            for the other person, and Leave is still the button that ends it. */}
        <button
          id="home"
          type="button"
          title="Back to the start"
          onClick={shush.goHome}
          className="-ml-2 cursor-pointer rounded-[10px] px-2 py-1"
        >
          <Brand />
        </button>

        {shush.session && (
          <button
            id="displayName"
            type="button"
            title="Your profile"
            onClick={() =>
              setProfile({
                userId: shush.session!.user.id,
                name: shush.session!.user.displayName,
                sub: "This is you. Nobody sees anything else.",
                mine: true,
                friend: false,
              })
            }
            className="flex cursor-pointer items-center gap-2 rounded-full border p-1 text-xs sm:px-3 sm:py-1.5"
            style={{
              borderColor: "var(--color-line)",
              backgroundColor: "var(--color-surface-2)",
              color: "var(--color-muted)",
            }}
          >
            <Avatar id={shush.session.user.id} name={shush.session.user.displayName} size={18} />
            {/* Your own name, on the one screen where you already know it, was wrapping to two
                lines and taking the width the burger now uses. The avatar still opens the same
                profile; sm and up has the room and keeps the name. */}
            <span data-testid="myName" className="hidden sm:inline">
              {shush.session.user.displayName}
            </span>
          </button>
        )}

        <span className="flex-1" />

        {shush.session && (
          <RequestsMenu
            requests={shush.requests}
            onRefresh={async () => {
              await shush.reloadRequests();
              await shush.refreshLists();
            }}
          />
        )}
        <ThemeToggle />
      </header>

      <main
        className={`relative grid min-h-0 flex-1 ${
          signedIn ? "grid-cols-1 sm:grid-cols-[240px_1fr] lg:grid-cols-[272px_1fr]" : "grid-cols-1"
        }`}
      >
        {shush.session && (
          <Sidebar
            session={shush.session}
            friends={shush.friends}
            conversations={shush.conversations}
            loading={shush.listsLoading}
            openConversationId={shush.conversationId}
            chatOnScreen={shush.view === "chat"}
            hiddenOnPhone={mobileView === "detail"}
            onOpenFriend={(friend) => {
              setMobileView("detail");
              shush.openFriend(friend);
            }}
            onOpenConversation={(conversation) => {
              setMobileView("detail");
              shush.openConversationFromHistory(conversation);
            }}
            onFindSomeone={() => {
              setMobileView("detail");
              shush.goHome();
              // "Find someone" finds someone: with interests already picked there is nothing
              // left to ask, so the search starts here rather than behind a second button.
              if (!shush.searching && shush.selected.length > 0) void shush.findSomeone();
            }}
            onLogout={shush.logout}
            onSaveAccount={shush.saveAccount}
          />
        )}

        {/* The drawer only covers ~78% of the screen -- this is the rest of it, tapping
            anywhere on it (the visible sliver of chat, or the dimmed part over it) closes the
            drawer instead of the chat behind it having no way back without it.
            fixed, not absolute: the drawer stands in front of the app header rather than
            starting underneath it, so opening it no longer swaps one header for another. */}
        {shush.session && mobileView === "list" && (
          <div
            className="fixed inset-0 z-40 sm:hidden"
            style={{ backgroundColor: "var(--color-scrim-soft)" }}
            onClick={() => setMobileView("detail")}
          />
        )}

        <section className="flex min-h-0 flex-col">
          {!signedIn && <div className="min-h-0 flex-1" />}

          {signedIn && shush.view === "setup" && setup(false)}

          {signedIn && shush.view === "chat" && (
            <ChatPanel
              peer={shush.peer}
              items={shush.items}
              meId={shush.session?.user.id}
              typing={shush.typing}
              isFriendConversation={shush.isFriendConversation}
              ended={shush.ended}
              historyLoading={shush.historyLoading}
              searching={shush.searching}
              canFind={shush.selected.length > 0}
              onFind={shush.findSomeone}
              onCancelFind={shush.cancelFind}
              friendRequestSent={shush.friendRequestSent}
              onBack={() => setMobileView("list")}
              onOpenPeer={() =>
                setProfile({
                  userId: shush.peer.userId,
                  name: shush.currentFriend?.displayName ?? shush.peer.name ?? "Someone",
                  sub: shush.currentFriend ? (shush.currentFriend.online ? "Online" : "Offline") : "",
                  mine: false,
                  friend: Boolean(shush.currentFriend),
                })
              }
              replyingTo={shush.replyingTo}
              quotedFor={shush.quotedFor}
              onSend={shush.sendMessage}
              onChooseImage={shush.chooseAttachment}
              onTyping={shush.notifyTyping}
              onAskToKeep={shush.askToKeep}
              onLeave={shush.leave}
              onReply={shush.setReplyingTo}
              onCancelReply={() => shush.setReplyingTo(null)}
              onReact={shush.react}
              onDeleteForEveryone={shush.deleteForEveryone}
              onHideForMe={shush.hideForMe}
              onOpenImage={setViewing}
              onOpenCamera={() => setCameraOpen(true)}
              setupPanel={setup(true)}
            />
          )}
        </section>
      </main>

      {shush.attachment && (
        <AttachmentPreview
          attachment={shush.attachment}
          onCancel={shush.clearAttachment}
          onAdd={() => document.getElementById("imageInput")?.click()}
          onSend={shush.sendAttachment}
        />
      )}

      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            shush.chooseAttachment(file);
          }}
        />
      )}

      {/* Said out loud, because the whole app rides on this one socket. While it was possible
          for the connection to be gone with nothing on screen saying so, every press that
          needed it -- find, send, leave -- looked like it had worked and had not. */}
      {shush.session && !shush.connected && (
        <div
          id="reconnecting"
          role="status"
          className="fixed top-2 left-1/2 z-[70] -translate-x-1/2 rounded-full border px-3.5 py-1.5 text-[12px] shadow-lg"
          style={{
            borderColor: "var(--color-line)",
            backgroundColor: "var(--color-surface-2)",
            color: "var(--color-muted)",
          }}
        >
          Reconnecting…
        </div>
      )}

      {viewing && <ImageViewer mediaKey={viewing} onClose={() => setViewing(null)} />}

      <ProfileDialog
        target={profile}
        onClose={() => setProfile(null)}
        onRemoveFriend={shush.removeFriend}
        onBlock={shush.blockUser}
      />
    </div>
  );
}
