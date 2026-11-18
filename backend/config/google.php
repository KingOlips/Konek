<?php
/**
 * Konek Google Sign-In Configuration
 *
 * Client IDs allowed as the `aud` (audience) claim of Google ID tokens.
 *
 * The Android app signs in with Credential Manager using the **Web** OAuth
 * client ID as its server client ID, so the returned ID tokens carry the Web
 * client ID as their audience. Keep that ID here.
 *
 * Client IDs are public identifiers (they ship inside the app), so it is fine
 * to keep this file in source control.
 */

const KONEK_GOOGLE_CLIENT_IDS = [
    "874151616337-65odpjfqpr4d6okpct0clmgsfrm4ktvg.apps.googleusercontent.com",
];

/**
 * Secret used to sign the short-lived token that carries a verified Google
 * identity through the "complete your profile" step. This token never leaves
 * the Konek app and expires quickly; rotate it to invalidate pending signups.
 */
const KONEK_GOOGLE_SIGNUP_SECRET = "1a56f6a1c6f3a1d2b62a1c9e4f9d3b7c8e2f5a0d4c6b9e1f3a7d2c8b5e9f4a6c";
