const express = require("express");
const passport = require("passport");
const { resolveGoogleCallbackUrl } = require("../auth/google");

const router = express.Router();

function allowLocalNoOauth() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

function hasWorkingGoogleStrategy() {
  try {
    const st = passport && passport._strategy ? passport._strategy("google") : null;
    if (!st) return false;
    const fn = st.authenticate;
    if (typeof fn !== "function") return false;
    const src = String(fn);
    if (src.includes("must be overridden by subclass")) return false;
    return true;
  } catch (_) {
    return false;
  }
}

router.get("/login", (req, res, next) => {
  const hasGoogle = hasWorkingGoogleStrategy();
  if (!hasGoogle) {
    if (allowLocalNoOauth()) return res.redirect("/dashboard/home");
    return res.status(500).send("GOOGLE_OAUTH_NOT_CONFIGURED");
  }
  return res.redirect("/auth/google");
});

router.get("/auth/google", (req, res, next) => {
  const hasGoogle = hasWorkingGoogleStrategy();
  if (!hasGoogle) {
    if (allowLocalNoOauth()) return res.redirect("/dashboard/home");
    return res.status(500).send("GOOGLE_OAUTH_NOT_CONFIGURED");
  }
  const callbackURL = resolveGoogleCallbackUrl(req);
  return passport.authenticate("google", {
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
    callbackURL,
  })(req, res, next);
});

router.get("/auth/google/callback", (req, res, next) => {
  const hasGoogle = hasWorkingGoogleStrategy();
  if (!hasGoogle) {
    if (allowLocalNoOauth()) return res.redirect("/dashboard/home");
    return res.redirect("/login");
  }
  const startedAt = Date.now();
  const callbackURL = resolveGoogleCallbackUrl(req);
  return passport.authenticate("google", { session: true, callbackURL }, (err, user, info) => {
    const elapsedMs = Date.now() - startedAt;
    if (err) {
      console.error("[OAUTH_CALLBACK_ERROR]", err, { elapsedMs });
      return res.redirect("/login");
    }
    if (!user) {
      console.warn("[OAUTH_CALLBACK_DENY]", { info, elapsedMs });
      return res.redirect("/login");
    }
    return req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error("[OAUTH_CALLBACK_LOGIN_ERROR]", loginErr, { elapsedMs });
        return res.redirect("/login");
      }
      console.log("[OAUTH_CALLBACK_OK]", { email: user.email, elapsedMs });
      return res.redirect("/dashboard/home");
    });
  })(req, res, next);
});

router.get("/logout", (req, res) => {
  try {
    req.logout(() => {});
  } catch (_) {}
  try {
    req.session?.destroy?.(() => {});
  } catch (_) {}
  return res.redirect("/login");
});

module.exports = router;
