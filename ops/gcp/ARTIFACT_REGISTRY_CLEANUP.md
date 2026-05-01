# Artifact Registry Cleanup Policy

Applied in dry-run mode on 2026-05-01 after billing showed excessive Artifact Registry growth.

## Repositories

- `projects/donbeolja-dev/locations/us/repositories/gcr.io`
- `projects/donbeolja-dev/locations/asia-northeast3/repositories/cloud-run-source-deploy`

## Policy

Source file: `ops/gcp/artifact-registry-cleanup-policy-dryrun.json`

- Keep the most recent 50 Docker versions.
- Delete untagged images older than 7 days.
- Delete `v2-*` commit-tagged images older than 45 days, except versions protected by the keep policy.

## Current Mode

Dry-run is enabled. No images are deleted while `cleanupPolicyDryRun=true`.

Verify:

```bash
gcloud artifacts repositories describe gcr.io \
  --location=us \
  --project=donbeolja-dev \
  --format='json(cleanupPolicyDryRun,cleanupPolicies)'

gcloud artifacts repositories describe cloud-run-source-deploy \
  --location=asia-northeast3 \
  --project=donbeolja-dev \
  --format='json(cleanupPolicyDryRun,cleanupPolicies)'
```

## Activation

Only after at least 24 hours of dry-run observation and after confirming no active Cloud Run revision depends on a delete candidate:

```bash
gcloud artifacts repositories set-cleanup-policies gcr.io \
  --location=us \
  --project=donbeolja-dev \
  --policy=ops/gcp/artifact-registry-cleanup-policy-dryrun.json

gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
  --location=asia-northeast3 \
  --project=donbeolja-dev \
  --policy=ops/gcp/artifact-registry-cleanup-policy-dryrun.json
```

Do not remove the keep policy unless Cloud Run revision rollback policy is separately changed.
