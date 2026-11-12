# Contributing to Meguri

Thanks for your interest in contributing! Meguri is a personal-scale desktop app,
and contributions of all kinds — bug reports, features, docs, translations — are
welcome. This guide explains the branch model and the workflow for sending a pull
request.

## Start with a conversation

For a new feature or another larger change, please talk with us before sending
a pull request. Share what you'd like to solve and what you have in mind, and
let's agree on the direction together before the implementation starts.

We would much rather shape a feature with you from the beginning than see your
time go into work that later has to change course. A short conversation up
front makes things smoother for both of us.

Where to start depends on how far along your idea is:

- **An idea that is still taking shape**: start a thread in [Ideas] in
  Discussions.
- **A concrete proposal you'd like to implement**: open an [issue][issues].
- **A bug report**: open an [issue][issues].
- **A question about using or building Meguri**: ask in [Q&A] in Discussions.

An idea discussed in Ideas becomes an issue once we agree on the direction;
the issue is where the implementation is tracked and what your pull request
links to.

You are welcome to send a pull request directly for:

- Bug fixes
- Documentation and translation updates
- Small, self-contained improvements

If you're not sure whether your change counts as larger, starting a discussion
or opening an issue is always welcome. Issues labelled
[`good first issue`](https://github.com/zabuton-app/meguri/labels/good%20first%20issue)
are a good place to start if you'd like to help but don't have a change in
mind yet. See [Labels](#labels) for what each label means.

## Labels

Issues and pull requests are labelled along a few independent axes. An issue
usually has one type label, one or two `area:` labels, a `feature:` label when
it belongs to a feature tracked across several issues, and a `status:` label
when something has to happen before the work can start. A pull request under
review has a `status:` label that says whose turn it is. Even the labels whose
meaning seems obvious are listed here, so everyone reads them the same way.

### Type

- `bug`: something does not work as intended.
- `enhancement`: a new feature, or an improvement to an existing one.
- `documentation`: a change to the README or `docs/` only.
- `question`: a question rather than a change; more information is requested.

### Area

Where in the code the change lands. These follow the directory layout, so the
label tells you where to start reading.

- `area: ui`: renderer views and components under `src/`, themes,
  accessibility.
- `area: player`: playback UI and behaviour: the video player, the Player
  route, audio.
- `area: scan`: scanning, folder watching and move detection (`scan.ts`,
  `scanManager.ts`).
- `area: db`: schema, queries, the query worker, full-text search, the
  cross-workspace (`All`) merge.
- `area: media-server`: the local media server (`server.ts`), ffmpeg remux and
  transcode, thumbnail serving.
- `area: ipc`: the IPC boundary: `shared/ipc`, the preload script, the
  renderer IPC client.
- `area: app`: main-process foundation: config, tray, updater, CSP,
  permissions.
- `area: i18n`: the translation mechanism and the locale files.
- `area: tests`: test infrastructure and E2E tests.
- `area: ci`: GitHub workflows, builds, releases, store submission.
- `area: deps`: dependency updates.

### Feature

A user-facing feature whose work spans several areas. Add it alongside the
`area:` labels, so all the issues about one feature can be found together.

- `feature: subtitles`: embedded subtitles: track selection, extraction and
  display.

### Status

What has to happen before the work can start. An issue without a `status:`
label is ready to be worked on.

- `status: needs repro`: found by reading the code and not yet reproduced in
  the running app. Reproduce it first; if you can't, say so in the issue. A
  fix should come with a test or reproduction steps.
- `status: needs design`: the scope or design is not settled. Join the
  discussion in the issue instead of sending a pull request.
- `status: blocked`: waiting on another issue or pull request, named in the
  issue.
- `status: proposal`: a suggestion from a contributor, waiting for a
  maintainer decision.
- `on hold`: paused on purpose until there is demand or an external blocker is
  resolved.

On a pull request, the `status:` label says whose turn it is. It has one of
these at a time, and a pull request nobody has reviewed yet has neither.

- `status: in review`: a maintainer is reviewing it, or will review the
  changes you pushed or the reply you gave. Nothing is needed from you.
- `status: changes requested`: a maintainer has reviewed it and is waiting for
  you to address the feedback, given in a review or in a comment. Push your
  changes or reply, and it goes back to `status: in review`.

### Other

- `good first issue`: small and well scoped, with the files to change named in
  the issue. A good place to start. Please comment before you start, so two
  people don't work on the same issue.
- `help wanted`: the maintainers would welcome help with this one.
- `performance`: about speed, memory or resource use. Can be combined with any
  area.
- `dependencies`: added by Dependabot to its dependency update pull requests.
- `javascript`: added by Dependabot to pull requests that update JavaScript
  packages.
- `duplicate`: the same issue or pull request already exists; the original is
  linked.
- `invalid`: not a valid report or change, for example a misunderstanding or a
  change unrelated to Meguri.
- `wontfix`: understood, but will not be worked on, with the reason given in
  the issue.

## Branching model

Meguri follows a simple **GitHub Flow**:

- `main` is the single long-lived branch and is always kept in a releasable state.
- All work happens on short-lived topic branches cut from `main`.
- Changes land on `main` exclusively through pull requests.

There is no `develop` or `release` branch. Releases are marked with tags
(see [Releases](#releases)), not branches.

### Branch naming

Topic branch names are not enforced, but a `type/short-description` style keeps
things readable:

| Prefix      | Use for                                    |
| ----------- | ------------------------------------------ |
| `feat/`     | New features                               |
| `fix/`      | Bug fixes                                  |
| `docs/`     | Documentation changes                      |
| `chore/`    | Tooling, dependencies, maintenance         |
| `refactor/` | Internal refactors with no behavior change |

Example: `feat/scene-bookmark-export`.

## Sending a pull request

External contributors work through a fork:

1. **Fork** this repository to your own account.
2. Clone your fork and create a topic branch from `main`:

   ```bash
   git switch -c feat/my-change
   ```

3. Make your changes, then run the checks locally (see [Development](#development)).
4. Push the branch to your fork and open a pull request.
5. **Target the `main` branch** of this repository. `main` is the default branch,
   so it is preselected as the PR base — please keep it as the base.

A few notes:

- For a new feature or another larger change, please link the issue where we
  discussed the direction (see [Start with a conversation](#start-with-a-conversation)).
- Keep each PR focused on a single concern; smaller PRs are easier to review.
- Pull requests are merged with **squash merge**, so your branch can contain as
  many work-in-progress commits as you like — they will be collapsed into one.
- CI (type check + tests) runs automatically on every pull request, including
  PRs from forks. Please make sure it passes.

## Development

Requirements: Node.js 22.22+ and a C/C++ toolchain (for the native build of
better-sqlite3).

```bash
npm install        # postinstall rebuilds better-sqlite3 for Electron
npm run dev        # start in development mode
```

No extra install flags are needed. `package.json` carries an `overrides` entry
that pins the `react` peer of `@emoji-mart/react` to the version the root project
uses, and that alone is enough: `npm install` and `npm ci` both succeed on React
19, including under `--strict-peer-deps`. Do not add `--legacy-peer-deps`, which
would relax peer resolution for every dependency rather than this one.

The override is load-bearing. `@emoji-mart/react` was last published in 2023 and
still declares a peer range of `^16.8 || ^17 || ^18`, so removing the entry makes
`npm install` fail with `ERESOLVE` on React 19. Note that `package-lock.json`
keeps recording that original range — it mirrors the package's own metadata,
while `overrides` is applied when the dependency graph is resolved, so the
recorded range is not what installs are checked against.

The package itself is safe on React 19: its implementation only uses `useRef`,
`useEffect` and `createElement`, none of which changed. Keep the override until
upstream ships a release that accepts React 19.

Before opening a pull request, run the same checks CI runs:

```bash
npm run typecheck     # type-check both src and electron
npm test              # run the test suites (core, then renderer)
npm run lint          # ESLint
npm run format:check  # Prettier (npm run format to fix)
```

See [README.md](README.md) for the architecture overview, and
[docs/](docs/README.md) for the full developer architecture reference (process
boundaries, IPC, data model, media pipeline, renderer, build/CI).

## Releases

Releases use **Semantic Versioning** with a `v` prefix and an annotated tag:

```bash
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

- `MAJOR` — incompatible / breaking changes
- `MINOR` — backward-compatible feature additions
- `PATCH` — backward-compatible bug fixes

Pushing a `v*` tag triggers the release build workflow
([.github/workflows/build.yml](.github/workflows/build.yml)), which produces the
distributable packages for Linux, Windows, and macOS. Tagging and releasing is
done by maintainers.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers this project.

[Ideas]: https://github.com/zabuton-app/meguri/discussions/categories/ideas
[Q&A]: https://github.com/zabuton-app/meguri/discussions/categories/q-a
[issues]: https://github.com/zabuton-app/meguri/issues
