# Continuous Integration

`github-actions-ci.yml` is a ready-to-use GitHub Actions workflow that runs the
self-test suite on Node 18/20/22 plus a boot smoke test on every push and PR.

## Activate it (one step)

The automation token used to create this branch isn't allowed to publish files
under `.github/workflows/`, so the workflow ships here instead. To enable CI,
copy it into place and push from your own account:

```bash
mkdir -p .github/workflows
cp ci/github-actions-ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable GitHub Actions"
git push
```

GitHub will pick it up automatically and show green checks on every push/PR.
