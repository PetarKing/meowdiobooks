import { useEffect, useRef } from "react";
import chapterArtwork from "../assets/brand/meowdiobooks-mark.png";

export interface ChapterAudioPlayerProps {
  src: string;
  title: string;
  bookTitle: string;
  author?: string;
}

/** Keep playback native so the browser owns buffering, seeking, and retry behavior. */
export function ChapterAudioPlayer({ src, title, bookTitle, author }: ChapterAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const session = navigator.mediaSession;
    let metadata: MediaMetadata | undefined;
    const publishMetadata = () => {
      metadata = new MediaMetadata({
        title,
        artist: author || "Meowdiobooks",
        album: bookTitle,
        artwork: [{ src: chapterArtwork, sizes: "512x512", type: "image/png" }],
      });
      session.metadata = metadata;
    };
    // Opening a player must not replace metadata for audio already playing elsewhere.
    audio.addEventListener("play", publishMetadata);
    if (!audio.paused) publishMetadata();
    return () => {
      audio.removeEventListener("play", publishMetadata);
      if (metadata && session.metadata === metadata) session.metadata = null;
    };
  }, [src, title, bookTitle, author]);

  return <audio ref={audioRef} controls preload="metadata" src={src} />;
}
