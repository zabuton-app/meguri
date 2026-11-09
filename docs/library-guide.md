# Organize and review your media

Meguri builds a catalogue of files in folders you scan. Your original media stays
where it is. You can find clips across folders, keep reusable searches, and review
footage before bringing it into your edit.

The left rail shows Meguri's version and build ID below the settings cog. Both
also appear in **Settings → App → About**, where you can select and copy them
when reporting an issue.

- [Make a Smart bin](#make-a-smart-bin)
- [Find new downloads](#find-new-downloads)
- [Find audio by its properties](#find-audio-by-its-properties)
- [Understand empty results and paused filters](#understand-empty-results-and-paused-filters)
- [Scrub and review footage](#scrub-and-review-footage)
- [Open a separate player window](#open-a-separate-player-window)

## Make a Smart bin

A **Smart bin** is a saved search. It updates when files are scanned or their tags
and ratings change. You do not have to move or copy files into it.

1. Add a media directory using **Add video directory** in the left rail. Wait for
   the scan to finish. Add more directories the same way.
2. Beside **Smart bins**, choose **Global** to search all scanned directories.
3. Click **+**, then name the bin, for example **Best 4K footage**.
4. Select **Video**, choose **4K UHD (3840 × 2160)**, and set the resolution match
   to **At least**. Click the fourth star to require four stars or more.
5. Check the other conditions in the editor and click **Save**. The editor starts
   from your current browsing filters, so remove any conditions you do not want
   to save. Repeat these steps to create more bins.

Choose **Exactly** when you need a specific preset's dimensions. **At least**
uses Meguri's resolution classes, so larger footage and suitable cropped cinema
footage can match. Portrait and landscape versions are treated consistently.
Choose **Video + Image** to include both visual media types, or **Image** for
stills only.

### Change where a bin searches

**Global** searches every scanned folder. **Local** returns to your last visited
scanned folder and, when browsing by folder, its subfolder. Choose another scanned
folder in the left rail to apply the same bin there. The highlighted location
and the caption under Global/Local show where you are. The selected bin stays
highlighted as you move between locations or change filters.

Think of the search in this order:

| Part             | What it decides                          | Where to change it                   |
| ---------------- | ---------------------------------------- | ------------------------------------ |
| Location         | Which folders can supply files           | **Global / Local** and the left rail |
| Smart bin        | Which files belong to the saved view     | The bin's pencil button              |
| Browsing filters | Which of those files you want to see now | The filter bar above the results     |

For example, apply **New files → Today** to **Best 4K footage** to see only today's
matching clips. The saved four-star and 4K rules remain in place. **Clear all**
removes browsing filters and paused choices while keeping the bin and location.
Choose **All media** or the close button beside the bin name to leave the bin.
Your browsing filters follow you. Opening a manual collection or Watch Later
also leaves the bin.

Meguri remembers the location, last local folder, selected bin, and browsing
filters between launches. A configured default bin opens when there is no
selected bin to restore.

## Find new downloads

1. Open **Watch folders** in the library header, beside **Scan**.
2. Check **Automatically watch scanned folders**. It is on by default. While
   Meguri is running, it listens for changes and waits for downloads to settle
   before indexing them. The menu shows how many folders it is watching. Use
   **Scan** for a folder that cannot be watched or to refresh it yourself.
3. Open **New files** in the filter bar and choose a **Time window**: **Last hour**,
   **Today**, **This week**, **Last 24 hours**, or **Last 7 days**. Today and this
   week follow local time, with Monday as the start of the week.
4. Under **Define new using**, choose the date that fits your work:

   | Choice                                   | What counts as new                                                                                                 |
   | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
   | **First discovered by Meguri** (default) | When the file first entered this catalogue. Useful for a batch of downloads, even if the media was made years ago. |
   | **File creation date**                   | The date stored by the filesystem. A file with no creation date cannot match this choice.                          |

Use the same control in Global, Local, or a Smart bin. To keep a reusable view,
create a bin with **New files** set to **Today**, for example **Today's downloads**.
The time window moves as the day changes; it does not become a fixed date.
The chosen date basis and active browsing filters survive a restart.

**Watch folders** updates the catalogue; **New files** narrows the catalogue you
see. You can use New files after a manual scan even with watching turned off.
Watching uses filesystem notifications rather than repeatedly scanning idle
folders. Network and removable drives can vary in notification support.

## Find audio by its properties

Select **Audio**, then open **Audio properties**. Resolution controls give way to
sample rate, source bit depth, channels, codec, minimum bitrate, and duration.
The audio file's details also show the properties Meguri could read.

For a bin of high-resolution stereo recordings, choose **96 kHz**, set its match
to **At least**, choose **24-bit** with **At least**, and choose **Stereo**. Use
**Exactly** for a delivery requirement such as precisely 48 kHz. Mono and
multichannel are also available. A file with an unknown property does not match
an active filter on that property; for example, a compressed recording may not
have a source bit depth to report.

Choose **Exactly**, **At least**, **At most**, or **Between** for duration. For
**Between**, enter a minimum and maximum in the selected format. The input shows
an example; the following three entries represent the same duration:

| Format                  | Enter for 2 minutes, 30 seconds |
| ----------------------- | ------------------------------- |
| Seconds                 | `150`                           |
| Minutes                 | `2.5`                           |
| Minutes:seconds (MM:SS) | `02:30`                         |

Use a colon for `MM:SS`; the seconds part must be `00`–`59`. Changing format keeps
the duration value. An invalid entry or a minimum above the maximum needs to be
corrected before saving the bin.

## Understand empty results and paused filters

Read the high-contrast summary above the results. It shows the bin's saved rules,
your active browsing conditions, and any remembered filters that are not applied.

- **No files match these filter criteria.** A valid filter can narrow the bin to
  zero. For example, **Exactly 720p** applies to video but cannot match a **4K**
  bin. It stays active. Change or remove it with the × beside its chip.
- **Filter combination has no matches.** Multiple conditions have narrowed the
  view to zero. Review the rules above; try removing one condition at a time.
- **Unavailable.** The filter does not apply to this media type, such as a video
  resolution filter in an audio-only bin. Its value is remembered and paused.
  The file area stays blank, and the message names the paused filter.
- **Off.** The remembered filter can now apply, for example after you edit the
  bin's media type. Click it to enable it, or use its × to remove it. Meguri
  does not enable it automatically while you are still in that bin.

Entering a different bin, or leaving and returning, checks your full incoming
filter set again. An audio choice paused in a video bin can apply in an audio
bin. Changing Global/Local or moving to another folder keeps the current visit's
choices. If you want to see the saved bin on its own, use **Clear all**.

## Scrub and review footage

In grid or list view, hover over a video thumbnail and move the pointer left to
right. The left edge is the beginning of the clip and the right edge is the end.
After a short pause, Meguri shows sampled frames as you move.

| While hovering                                 | macOS                     | Windows / Linux     |
| ---------------------------------------------- | ------------------------- | ------------------- |
| Hide the thumbnail's controls for a clean view | Hold **Option**           | Hold **Alt**        |
| Show a larger clean preview beside it          | Hold **Command + Option** | Hold **Ctrl + Alt** |

Keep the pointer on the **original thumbnail**. The larger preview stays beside
it, fits the available space, and is up to twice the thumbnail's displayed size.
It uses a sharper frame source without getting bigger: 720 pixels wide, or 960
with the High preview setting. Outside enlarged mode, scrubbing uses your
chosen quality. Release the keys to return to the usual controls. Leaving the
thumbnail, pressing Escape, scrolling, resizing, or switching apps dismisses
the preview. If dismissed while the pointer is still there, move away and back
before scrubbing again. Hover preview is a quick visual check; it samples frames
and is silent. Still images, audio, and very short clips keep their poster image.
Use **Hover preview** and **Preview quality** in Settings to adjust ordinary
scrubbing.

Click a video thumbnail to open the compact player. The **Scenes** strip stays
below the video when you resize or scroll through file details. Click a scene to
seek to it, or click its star to make that frame the main thumbnail. Scroll the
strip horizontally for more scenes. You can change the scene count in Settings.

- **Move:** drag the player's title bar inside the Meguri window.
- **Resize:** grab an edge or any corner. The video and scenes fit together, and
  the player remembers its size and position. Focus a handle or the title bar
  and use arrow keys for keyboard resizing or moving.
- **Keep browsing:** use **Open as side peek** to dock the player beside the
  library. Tags, ratings, and history scroll in their own area below the scenes.

### Read filenames and formats

`Interview.final.v2.mov` appears as **Interview.final.v2**. The **MOV** label sits
beside resolution and duration on the card and beside the title in the player.
The original filename is available on hover and in file actions. Search and drag
still use the original name. **MOV** and **MP4** identify file formats; the codec
inside them is shown separately in the file's details.

## Open a separate player window

Use **Open in separate window** in the player header to review video or images
while keeping the full catalogue available. Move the new window by its title bar
or place it on another display. Resize it like any other desktop window. Video
keeps its playback position and play/pause state, and the scene strip remains
attached. Close the preview window to return your attention to the library.

When you are ready to use a clip, hover over its grid or list thumbnail and drag
the arrow beside the selection checkbox into the destination app, such as the
DaVinci Resolve Media Pool. Drag from a selected clip's arrow to carry the whole
selection. The destination app decides how to import the original files.
