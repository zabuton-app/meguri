// A link for the cards and rows of the media views, standing in for
// react-router's <Link> there.
//
// <Link> is fine anywhere a handful are on screen, but a list view mounts two
// per card and a scroll mounts dozens of cards a frame. Each one computes its
// href with a document.querySelector("base") (the hash history's createHref)
// and subscribes to the location, so every navigation (opening a file, which
// leaves the list mounted underneath) re-rendered every link on screen too.
// This one builds the hash href directly and reads the current location only
// at the moment of a click.
//
// The app has no <base> element, so the href is the path behind a "#", as the
// hash history would write it. The click handling follows <Link>'s: a plain
// primary click in this window navigates in the app, and one onto the place
// already shown replaces it instead of stacking the same entry twice;
// anything else (a modified click, a handler that called preventDefault) is
// left alone.
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useNavigate } from "react-router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** The app path to go to, e.g. "/file/3?ws=…". */
  to: string;
};

function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey;
}

export function HashLink({ to, onClick, target, ...rest }: Props) {
  const navigate = useNavigate();
  return (
    <a
      {...rest}
      href={`#${to}`}
      target={target}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !isPlainClick(e)) return;
        if (target && target !== "_self") return;
        e.preventDefault();
        const current = window.location.hash.slice(1) || "/";
        void navigate(to, { replace: current === to });
      }}
    />
  );
}
