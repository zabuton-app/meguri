# Import local audio covers

Use a cover import when you have album artwork as separate images and want
Meguri to show it while you browse or play music. An image can be shared by
multiple tracks on the same album.

1. Put the JPEG or PNG images and a JSON cover list in the same folder.
2. Open the workspace containing the audio in Meguri. Scan it first so Meguri
   can read the files and their durations.
3. Open the arrow beside **Scan**, choose **Import audio covers**, and select
   the JSON list. The result shows the number of tracks matched and skipped.

Each album in the list names an image and one or more tracks. Write each
track's path relative to the workspace, including the audio extension. Use
whole seconds for the duration. Meguri allows up to one second of difference.

```json
{
  "version": 1,
  "albums": [
    {
      "image": "album-cover.jpg",
      "tracks": [
        { "path": "Album/Artist - First Track.wav", "durationSeconds": 155 },
        { "path": "Album/Artist - Second Track.wav", "durationSeconds": 201 }
      ]
    }
  ]
}
```

Meguri uses embedded covers when available. Imported covers are stored locally
in the shared library and follow the same recording across workspaces and
rescans. The audio files themselves stay untouched. The artwork works offline
after import, and you can import a different cover to replace an imported one.
