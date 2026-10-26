/** A bounded, opaque native drag image avoids snapshots of clipped SVG layers on WebKit. */
export function setCastDragImage(transfer: DataTransfer, card: HTMLElement, name: string) {
  if (!transfer.setDragImage) return () => undefined;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  const width = 220, height = 64;
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.cssText = `position:fixed;left:-1000px;top:0;width:${width}px;height:${height}px;pointer-events:none`;
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.castDragImage = "";
  const style = getComputedStyle(card);
  context.scale(scale, scale);
  context.fillStyle = style.backgroundColor;
  context.fillRect(0, 0, width, height);
  // Read resolved colors rather than CSS custom properties (which can contain color-mix()).
  context.fillStyle = getComputedStyle(card, "::before").backgroundColor;
  context.fillRect(0, 0, 5, height);
  context.fillStyle = getComputedStyle(card.querySelector(".cast-roster-name") ?? card).color;
  context.font = `500 18px ${style.getPropertyValue("--font-display") || "serif"}`;
  context.textBaseline = "middle";
  let label = name;
  while (label.length > 1 && context.measureText(label).width > width - 32) label = label.slice(0, -1);
  if (label !== name) label = label.trimEnd().slice(0, -1) + "…";
  context.fillText(label, 16, height / 2);
  document.body.append(canvas);
  transfer.setDragImage(canvas, 24, height / 2);
  return () => canvas.remove();
}
