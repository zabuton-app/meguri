import { useCallback } from "react";
import { PlayerStage } from "./PlayerStage";
import type { StageSnapshot } from "./stageSnapshot";

// Renders a frozen stage — the item that is on its way out. Laid out exactly
// like the live one so the two can slide or dissolve against each other without
// anything shifting.
export function SnapshotStage({
  snapshot,
  ground,
}: {
  snapshot: StageSnapshot;
  ground: string;
}) {
  return (
    <PlayerStage backdropSrc={snapshot.backdropSrc} ground={ground}>
      {snapshot.canvas ? (
        <CanvasFrame canvas={snapshot.canvas} />
      ) : (
        <img
          src={snapshot.imageSrc}
          alt=""
          aria-hidden
          className="h-full w-full object-contain"
          style={{ transform: snapshot.transform }}
        />
      )}
    </PlayerStage>
  );
}

/** A tainted canvas cannot be read back into an <img>, so mount it directly. */
function CanvasFrame({ canvas }: { canvas: HTMLCanvasElement }) {
  const mount = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      node.replaceChildren(canvas);
    },
    [canvas],
  );
  return <div ref={mount} className="h-full w-full" aria-hidden />;
}
