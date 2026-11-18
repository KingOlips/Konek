<?php
/**
 * Public password-reset verification page used by emails.
 *
 * This is deliberately a different filename from reset_verify.php: the
 * currently installed APK registered an Android App Link for the old path, so
 * using the old URL on a phone would open the app and skip verification. This
 * page always loads in the browser, marks the request verified, and the
 * desktop/tablet where the reset was requested switches to its password form.
 */

require __DIR__ . "/reset_verify.php";
