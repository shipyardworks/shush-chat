"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The device camera, with a live preview and a shutter.
 *
 * <p>A file input with {@code capture} only does this on a phone; on a desktop the attribute is
 * ignored and the browser opens the ordinary file picker -- which is what a camera button did,
 * and it is not a camera. getUserMedia is the same on both.
 *
 * <p>The track is stopped on every exit path. A camera left running is a light left on: the
 * browser keeps showing the recording indicator and the device stays claimed.
 */
export const CameraCapture = ({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  // false = back camera, the default -- what people point at things.
  const [front, setFront] = useState(false);
  const [canSwitch, setCanSwitch] = useState(false);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const open = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: front ? "user" : "environment" },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => {
            // Autoplay can be refused; the controls still work and the frame still arrives.
          });
        }
        // Enumerated only after a stream is granted -- device info is hidden before that.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) {
          setCanSwitch(devices.filter((device) => device.kind === "videoinput").length > 1);
        }
      } catch {
        // Refused, or there is no camera. Say so rather than showing a black rectangle.
        setError("No camera available, or permission was refused.");
      }
    };

    void open();
    return () => {
      cancelled = true;
      stop();
    };
  }, [front, stop]);

  const shoot = () => {
    const source = video.current;
    if (!source || !source.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    canvas.getContext("2d")?.drawImage(source, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      // Straight into the same preview every other image goes through, so a photo can be
      // captioned or thrown away exactly like one picked from disk.
      onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      stop();
    }, "image/jpeg", 0.9);
  };

  return (
    <div
      id="cameraCapture"
      className="fixed inset-0 z-[65] flex flex-col"
      style={{ backgroundColor: "var(--color-scrim-strong)" }}
    >
      <div className="flex items-center gap-3 p-4">
        <button
          id="closeCamera"
          type="button"
          aria-label="Close camera"
          onClick={() => {
            stop();
            onClose();
          }}
          className="btn-ghost px-3"
        >
          ✕
        </button>
        <span className="text-sm" style={{ color: "var(--color-muted)" }}>
          {error ?? "Camera"}
        </span>
        <span className="flex-1" />
        {canSwitch && !error && (
          <button
            id="switchCamera"
            type="button"
            aria-label={front ? "Switch to back camera" : "Switch to front camera"}
            title="Switch camera"
            onClick={() => {
              stop();
              setFront((current) => !current);
            }}
            className="btn-ghost grid h-9 w-9 place-items-center rounded-full p-0"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2l4 4-4 4M7 22l-4-4 4-4M3 6h9a5 5 0 0 1 5 5v1M21 18H12a5 5 0 0 1-5-5v-1" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4">
        {error ? (
          <p className="max-w-sm text-center text-sm" style={{ color: "var(--color-faint)" }}>
            {error} You can still send a picture with the paperclip.
          </p>
        ) : (
          <video
            id="cameraPreview"
            ref={video}
            playsInline
            muted
            className="max-h-full max-w-full rounded-xl"
            style={{ maxHeight: "100%", maxWidth: "100%" }}
          />
        )}
      </div>

      <div className="flex items-center justify-center p-6">
        <button
          id="shutter"
          type="button"
          aria-label="Take photo"
          disabled={Boolean(error)}
          onClick={shoot}
          className="h-16 w-16 rounded-full border-4 border-white/80 bg-white/20 transition hover:bg-white/40 disabled:opacity-40"
        />
      </div>
    </div>
  );
};
