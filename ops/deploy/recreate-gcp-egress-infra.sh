#!/bin/zsh
set -euo pipefail

# recreate-gcp-egress-infra.sh
#
# Rebuilds the Cloud NAT egress path that was torn down on 2026-07-02 to stop
# idle billing (~$32-40/mo). Run this ONLY when returning v3 to a GCP-hosted
# live deployment where Binance API keys are IP-allowlisted and Cloud Run needs
# a fixed egress IP.
#
# What it recreates (reverse of the teardown):
#   1. reserved regional static IP  donbeolja-nat-ip
#   2. Cloud Router                 donbeolja-nat   (on the `default` network)
#   3. Cloud NAT gateway            donbeolja-nat   (NAT all subnet ranges, using
#                                                    the reserved IP as egress)
#
# NOT handled here (already scripted elsewhere):
#   - Cloud Run services (donbeolja / egress / egress-private / exit-worker):
#     rebuilt by `gcloud builds submit` against cloudbuild.yaml.
#   - Firestore: `gcloud firestore databases create --database="(default)"
#     --location=asia-northeast3 --type=firestore-native`.
#
# IMPORTANT — the egress IP will be a NEW address (the old reserved IP was
# released, not parked). After running this, take the printed EGRESS_IP and
# re-add it to the Binance API key IP allowlist; the old allowlist entry is
# stale.
#
# Idempotent: each resource is created only if absent, so re-running is safe.

REGION="${GCP_REGION:-asia-northeast3}"
NETWORK="${GCP_NETWORK:-default}"
IP_NAME="${NAT_IP_NAME:-donbeolja-nat-ip}"
ROUTER_NAME="${NAT_ROUTER_NAME:-donbeolja-nat}"
NAT_NAME="${NAT_GATEWAY_NAME:-donbeolja-nat}"
PROJECT="$(gcloud config get-value project 2>/dev/null)"

echo "[recreate-egress] project=$PROJECT region=$REGION network=$NETWORK"

# 1. reserved static egress IP -------------------------------------------------
if gcloud compute addresses describe "$IP_NAME" --region="$REGION" >/dev/null 2>&1; then
  echo "[recreate-egress] address $IP_NAME already exists — skip"
else
  echo "[recreate-egress] creating reserved IP $IP_NAME ..."
  gcloud compute addresses create "$IP_NAME" --region="$REGION"
fi

# 2. Cloud Router --------------------------------------------------------------
if gcloud compute routers describe "$ROUTER_NAME" --region="$REGION" >/dev/null 2>&1; then
  echo "[recreate-egress] router $ROUTER_NAME already exists — skip"
else
  echo "[recreate-egress] creating router $ROUTER_NAME ..."
  gcloud compute routers create "$ROUTER_NAME" --region="$REGION" --network="$NETWORK"
fi

# 3. Cloud NAT gateway ---------------------------------------------------------
if gcloud compute routers nats describe "$NAT_NAME" --router="$ROUTER_NAME" --region="$REGION" >/dev/null 2>&1; then
  echo "[recreate-egress] NAT $NAT_NAME already exists — skip"
else
  echo "[recreate-egress] creating NAT $NAT_NAME (all subnet ranges, egress via $IP_NAME) ..."
  gcloud compute routers nats create "$NAT_NAME" \
    --router="$ROUTER_NAME" \
    --region="$REGION" \
    --nat-all-subnet-ip-ranges \
    --nat-external-ip-pool="$IP_NAME"
fi

EGRESS_IP="$(gcloud compute addresses describe "$IP_NAME" --region="$REGION" --format='value(address)' 2>/dev/null || echo '?')"
echo ""
echo "[recreate-egress] DONE."
echo "[recreate-egress] EGRESS_IP = $EGRESS_IP"
echo "[recreate-egress] >>> add $EGRESS_IP to the Binance API key IP allowlist (old entry is stale) <<<"
echo "[recreate-egress] then redeploy Cloud Run:  gcloud builds submit --config cloudbuild.yaml ."
