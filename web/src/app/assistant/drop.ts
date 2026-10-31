/**
 * Files dragged anywhere over `area` show the overlay on `card`. dragenter/dragleave pair up per
 * element, so a depth count says when the file has left; dragover keeps a fallback timer alive.
 */
export function dropTarget(area: HTMLElement, card: HTMLElement, onFiles: (files: FileList) => void): void {
  let depth = 0;
  let idle: number | undefined;
  const isFile = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
  const set = (on: boolean) => {
    if (!on) depth = 0;
    card.classList.toggle("dragging", on);
    clearTimeout(idle);
    if (on) idle = window.setTimeout(() => set(false), 1500);
  };
  area.addEventListener("dragenter", e => {
    if (!isFile(e)) return;
    depth += 1;
    set(true);
  });
  area.addEventListener("dragleave", e => {
    if (!isFile(e)) return;
    depth -= 1;
    if (depth <= 0) set(false);
  });
  area.addEventListener("dragover", e => {
    if (!isFile(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    set(true);
  });
  area.addEventListener("drop", e => {
    if (!isFile(e)) return;
    e.preventDefault();
    set(false);
    onFiles(e.dataTransfer!.files);
  });
}
