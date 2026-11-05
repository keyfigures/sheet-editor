# Sheet editor: the workbook viewer

A workbook in the app's panel opens in this editor, in the reader's browser only. It is ONLYOFFICE 9.3 through
[`ranuts/document`](https://github.com/ranuts/document) at the commit in `editor.lock.json`, plus the patches in
`patches/`, trimmed to the spreadsheet editor. It is deployed as a static site on its own origin: no server, no
database, and the app's session cookies never reach it.

The app chooses it with one variable, `NEXT_PUBLIC_SHEET_EDITOR_ORIGIN` (`platform/web/lib/workbook-viewer.mjs`). Unset
means SpreadJS. `platform/web/scripts/launch.mjs` starts `serve.mjs` for local work when `dist/` exists. A page seen through the designer
tunnel cannot reach an editor on this machine, so it gets SpreadJS (`workbookViewerOrigin`).

## Build and run

Needs node 24 or later and git. `pnpm` is fetched by the build.

```bash
node build.mjs                 # clone the pinned commit, apply patches, build, write dist/
node build.mjs --keep-work     # reuse .work/, applying only new patches
node serve.mjs                 # http://127.0.0.1:4178, same headers as hosted
cd ../../testing/sheet-editor && node check.mjs   # the checks in real browsers
```

## Adding a patch

One fault per patch.

```bash
# edit files in .work/, then:
git -C .work add -A
git -C .work diff --cached > patches/000N-name.patch
git -C .work -c user.name=x -c user.email=x@x commit -q -m "kf-patch: 000N-name.patch"
```

List the patch in `NOTICE`: AGPL section 5(a) requires modified versions to say so.

## Upgrading the editor

Change `commit` and `onlyoffice` in `editor.lock.json`, run `node build.mjs`, fix what no longer applies, then run every
check in `testing/sheet-editor/`. The bridge (`lib/kf-bridge.ts` in patch 0007) reaches into editor internals by name, so
an upgrade can break it without any patch failing to apply.

## Licence

AGPL-3.0 with ONLYOFFICE's Section 7 terms: see `LICENSE` and `NOTICE`. Source for what is deployed is published at
https://github.com/keyfigures/sheet-editor. `public/sdkjs` and `public/web-apps` in the upstream build are a third-party
compiled offline build of ONLYOFFICE 9.3.0.

## Files with fixed names

`sdkjs` and `web-apps` keep the same names across builds, so they are served `no-cache` with an ETag: a reader
revalidates and never holds a mix of two versions after an upgrade. Only `/assets/*` is immutable.
