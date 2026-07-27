# Contributing to Meguri

Thanks for your interest in contributing! Meguri is a personal-scale desktop app,
and contributions of all kinds — bug reports, features, docs, translations — are
welcome. This guide explains the branch model and the workflow for sending a pull
request.

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
npm run typecheck  # type-check both src and electron
npm test           # run the test suites (core, then renderer)
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
