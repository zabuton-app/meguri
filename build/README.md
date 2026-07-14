# build resources

The electron-builder `buildResources` directory. Icons placed here are automatically picked up for each OS package (filenames are fixed).

| File        | Purpose | Recommended spec                  |
| ----------- | ------- | --------------------------------- |
| `icon.icns` | macOS   | icns containing 512x512 or larger |
| `icon.ico`  | Windows | multi-size ico including 256x256  |
| `icon.png`  | Linux   | 512x512 or larger (or 1024)       |

If none are present, the default Electron icon is used (the build still succeeds).

Example of generating each format from a single PNG:

```bash
npx electron-icon-builder --input=icon-source.png --output=build
```
