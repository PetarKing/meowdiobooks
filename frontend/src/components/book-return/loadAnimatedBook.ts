let animationModule: Promise<typeof import("./AnimatedBook")> | undefined;

/** Share background warming and the lazy view's request without allocating WebGL. */
export function loadAnimatedBook() {
  return animationModule ??= import("./AnimatedBook");
}

export function warmBookReturnAnimation() {
  // Graphics are optional: preload failures must not become unhandled rejections.
  void loadAnimatedBook().catch(() => undefined);
}
